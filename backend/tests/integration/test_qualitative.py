from __future__ import annotations

import pytest

from tests.helpers import csv_bytes, survey_frame

pytestmark = pytest.mark.integration


async def setup(api, n=240):
    df = survey_frame(n)
    p = (await api.post("/projects", json={"name": "Q"})).json()
    ds = (
        await api.post(f"/projects/{p['id']}/datasets", files={"file": ("s.csv", csv_bytes(df), "text/csv")})
    ).json()["dataset"]
    return p, ds, ds["latest_version"]["id"], df


async def prepare(api, p, vid, column="comment"):
    r = await api.post(
        f"/projects/{p['id']}/qualitative/prepare", json={"dataset_version_id": vid, "column": column}
    )
    assert r.status_code == 202, r.text
    return r.json()


async def test_prepare_and_theme_detection_counts_come_from_data(alice):
    p, ds, vid, df = await setup(alice)
    src = (
        await alice.get(f"/projects/{p['id']}/qualitative/sources", params={"dataset_version_id": vid})
    ).json()
    assert (
        src == [] or src[0]["column"] == "comment"
    )  # three distinct comment strings → treated as categorical by the profiler
    job = await prepare(alice, p, vid)
    assert job["status"] == "COMPLETED", job
    again = await prepare(alice, p, vid)  # idempotent
    assert again["result_ref"]["created"] is False
    j = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/themes/detect",
            json={"dataset_version_id": vid, "column": "comment"},
        )
    ).json()
    assert j["status"] == "COMPLETED", j
    out = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/themes", params={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()
    themes = out["themes"]
    assert (
        3 <= len(themes) <= 10 and out["runs"][0]["silhouette"] > 0.2 and out["runs"][0]["k"] >= len(themes)
    )
    # counts are COUNT(*) over stored memberships (themes smaller than 3 responses would be left unassigned)
    assert sum(t["segment_count"] for t in themes) + (out["runs"][0]["unassigned"] or 0) == len(df)
    pure = total = 0
    for t in themes:
        assert (
            t["share_pct"] == pytest.approx(t["response_count"] / len(df) * 100, abs=0.01)
            and t["summary"]["origin"] == "deterministic"
            and t["examples"]
        )
        # purity: each theme is dominated by one true category (delivery / support / positive)
        segs = (
            await alice.get(
                f"/projects/{p['id']}/qualitative/segments",
                params={
                    "dataset_version_id": vid,
                    "column": "comment",
                    "theme_id": t["id"],
                    "page_size": 100,
                },
            )
        ).json()["items"]
        cats = [
            (
                "delivery"
                if any(w in s["text"].lower() for w in ("deliver", "shipping", "courier"))
                else "support"
                if any(w in s["text"].lower() for w in ("support", "helpline", "customer service"))
                else "good"
            )
            for s in segs
        ]
        pure += max(cats.count(c) for c in set(cats))
        total += len(cats)
    assert (
        pure / total >= 0.85
    )  # themes recover the true categories (comments of different categories rarely share a theme)
    # idempotent re-run (same parameters) returns the same run; a different k is a new, separate run
    j2 = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/themes/detect",
            json={"dataset_version_id": vid, "column": "comment"},
        )
    ).json()
    assert j2["result_ref"]["run_id"] == j["result_ref"]["run_id"]
    auto = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/themes/detect",
            json={"dataset_version_id": vid, "column": "comment", "n_themes": 3},
        )
    ).json()
    assert auto["status"] == "COMPLETED" and auto["result_ref"]["run_id"] != j["result_ref"]["run_id"]
    runs = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/themes", params={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()["runs"]
    assert len(runs) == 2


async def test_human_review_rename_merge_move_delete(alice):
    p, ds, vid, df = await setup(alice)
    await prepare(alice, p, vid)
    await alice.post(
        f"/projects/{p['id']}/qualitative/themes/detect",
        json={"dataset_version_id": vid, "column": "comment", "n_themes": 3},
    )
    themes = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/themes", params={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()["themes"]
    t0, t1 = themes[0], themes[1]
    r = await alice.patch(
        f"/themes/{t0['id']}", json={"name": "Delivery delays", "description": "Slow, late parcels"}
    )
    assert r.json()["name"] == "Delivery delays" and r.json()["description"] == "Slow, late parcels"
    segs = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment", "theme_id": t1["id"], "page_size": 5},
        )
    ).json()
    assert segs["total"] == t1["segment_count"] and all(
        s["themes"][0]["id"] == t1["id"] for s in segs["items"]
    )
    sid = segs["items"][0]["id"]
    assert (await alice.post(f"/themes/{t0['id']}/segments", json={"segment_id": sid})).status_code == 204
    assert (await alice.get(f"/themes/{t0['id']}")).json()["segment_count"] == t0["segment_count"] + 1
    assert (await alice.delete(f"/themes/{t0['id']}/segments/{sid}")).status_code == 204
    merged = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/themes/merge",
            json={"theme_ids": [t0["id"], t1["id"]], "name": "Service problems"},
        )
    ).json()
    assert (
        merged["name"] == "Service problems"
        and merged["origin"] == "merged"
        and merged["segment_count"] == t0["segment_count"] + t1["segment_count"]
    )
    assert (await alice.get(f"/themes/{t1['id']}")).status_code in (404,)
    assert (await alice.delete(f"/themes/{merged['id']}")).status_code == 204
    remaining = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/themes", params={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()["themes"]
    assert len(remaining) == 1
    # underlying responses untouched
    assert (
        await alice.get(
            f"/projects/{p['id']}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment"},
        )
    ).json()["total"] == len(df)


async def test_codebook_keyword_suggestions_require_human_acceptance(alice):
    p, ds, vid, df = await setup(alice)
    await prepare(alice, p, vid)
    code = (
        await alice.post(
            f"/projects/{p['id']}/codes",
            json={"name": "Delivery", "color": "#1d4ed8", "keywords": ["deliver*", "slow", "late"]},
        )
    ).json()
    dup = await alice.post(f"/projects/{p['id']}/codes", json={"name": "Delivery"})
    assert dup.status_code == 409
    j = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/suggest-codes",
            json={"dataset_version_id": vid, "column": "comment", "use_semantic": False},
        )
    ).json()
    n_expected = int(
        df["comment"].str.contains(r"\b(?:deliver\w*|slow|late)\b", case=False, regex=True).sum()
    )
    assert j["status"] == "COMPLETED" and j["result_ref"]["keyword_suggestions"] == n_expected > 0
    stats = (await alice.get(f"/projects/{p['id']}/codes")).json()[0]
    assert stats["suggested_count"] == n_expected and stats["accepted_count"] == 0  # nothing auto-accepted
    review = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment", "review": True, "page_size": 100},
        )
    ).json()
    ids = [a["id"] for s in review["items"] for a in s["annotations"]]
    accepted = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/annotations/review",
            json={"annotation_ids": ids[:5], "status": "accepted"},
        )
    ).json()
    assert accepted["updated"] == 5
    assert (await alice.get(f"/projects/{p['id']}/codes")).json()[0]["accepted_count"] == 5
    seg = review["items"][-1]["id"]
    man = await alice.post(f"/segments/{seg}/annotations", json={"code_id": code["id"]})
    assert man.status_code == 201 and man.json()["status"] == "accepted"
    assert (await alice.delete(f"/segments/{seg}/annotations/{code['id']}")).status_code == 204


async def test_semantic_search_and_keywords(alice):
    p, ds, vid, df = await setup(alice)
    await prepare(alice, p, vid)
    r = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/search",
            params={"dataset_version_id": vid, "column": "comment", "q": "parcel arrived late"},
        )
    ).json()
    assert (
        r["results"]
        and "slow" in r["results"][0]["text"].lower()
        or "late" in r["results"][0]["text"].lower()
    )
    assert r["results"][0]["similarity"] >= r["results"][-1]["similarity"]
    kc = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/keyword-count",
            params={"dataset_version_id": vid, "column": "comment", "terms": "deliver*,support,banana"},
        )
    ).json()
    got = {t["term"]: t["responses"] for t in kc["terms"]}
    assert (
        got["deliver*"] == int(df["comment"].str.contains(r"\bdeliver\w*", case=False, regex=True).sum())
        and got["banana"] == 0
    )
    kw = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/keywords",
            params={"dataset_version_id": vid, "column": "comment"},
        )
    ).json()
    assert kw["terms"][0]["responses"] >= kw["terms"][-1]["responses"]


async def test_qualitative_failures_and_isolation(alice, bob):
    p, ds, vid, df = await setup(alice, 40)
    r = await alice.post(
        f"/projects/{p['id']}/qualitative/themes/detect",
        json={"dataset_version_id": vid, "column": "comment"},
    )
    assert r.json()["status"] == "FAILED" and r.json()["error"]["code"] == "SEGMENTS_NOT_PREPARED"
    bad = await alice.post(
        f"/projects/{p['id']}/qualitative/prepare", json={"dataset_version_id": vid, "column": "satisfaction"}
    )
    assert bad.json()["status"] == "FAILED" and bad.json()["error"]["code"] == "NOT_A_TEXT_COLUMN"
    await prepare(alice, p, vid)
    for path in (f"/projects/{p['id']}/qualitative/themes", f"/projects/{p['id']}/codes"):
        assert (await bob.get(path)).status_code == 404
    assert (
        await bob.post(
            f"/projects/{p['id']}/qualitative/prepare", json={"dataset_version_id": vid, "column": "comment"}
        )
    ).status_code == 404
    seg = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment", "page_size": 1},
        )
    ).json()["items"][0]["id"]
    code = (await alice.post(f"/projects/{p['id']}/codes", json={"name": "X"})).json()
    assert (await bob.post(f"/segments/{seg}/annotations", json={"code_id": code["id"]})).status_code == 404
    pb = (await bob.post("/projects", json={"name": "B"})).json()
    cross = await bob.get(
        f"/projects/{pb['id']}/qualitative/segments", params={"dataset_version_id": vid, "column": "comment"}
    )
    assert cross.status_code == 404
    tiny = (
        await alice.post(
            f"/projects/{p['id']}/datasets",
            files={
                "file": (
                    "t.csv",
                    b"id,comment\n1,hello world\n2,hello again there\n3,something else entirely\n",
                    "text/csv",
                )
            },
        )
    ).json()["dataset"]
    r2 = await alice.post(
        f"/projects/{p['id']}/qualitative/prepare",
        json={"dataset_version_id": tiny["latest_version"]["id"], "column": "comment"},
    )
    assert r2.json()["status"] == "FAILED" and r2.json()["error"]["code"] == "INSUFFICIENT_OBSERVATIONS"
