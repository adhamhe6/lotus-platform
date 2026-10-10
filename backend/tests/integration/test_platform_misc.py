"""Assistant routing across intents, overview cache + invalidation, search, jobs, notifications, suggestions."""

from __future__ import annotations

from pathlib import Path

import pytest

pytestmark = pytest.mark.integration
DEMO = Path(__file__).resolve().parents[3] / "data" / "demo" / "customer_feedback.csv"


async def demo_project(api):
    p = (await api.post("/projects", json={"name": "Demo", "objective": "Why is satisfaction low?"})).json()
    ds = (
        await api.post(
            f"/projects/{p['id']}/datasets",
            files={"file": ("customer_feedback.csv", DEMO.read_bytes(), "text/csv")},
        )
    ).json()["dataset"]
    return p, ds, ds["latest_version"]["id"]


async def ask(api, conv, q):
    r = await api.post(f"/ai/conversations/{conv}/messages", json={"content": q})
    assert r.status_code == 201, r.text
    return r.json()[1]


async def test_assistant_answers_each_question_type_from_computed_results(alice):
    p, ds, vid = await demo_project(alice)
    conv = (
        await alice.post(f"/projects/{p['id']}/ai/conversations", json={"dataset_version_id": vid})
    ).json()["id"]
    cases = {
        "Which factors appear most strongly associated with satisfaction?": (
            "relationship",
            {"correlation", "group_comparison"},
        ),
        "Which region has the highest satisfaction score?": ("comparison", {"group_comparison"}),
        "How has satisfaction changed over time?": ("trend", {"time_series"}),
        "What is the average delivery time?": ("distribution", {"descriptive"}),
        "Summarize the key findings": ("overview", set()),
        "What should I investigate next?": ("next_steps", set()),
    }
    for q, (intent, types) in cases.items():
        m = await ask(alice, conv, q)
        assert m["meta"]["intent"] == intent, (q, m["meta"])
        assert m["blocks"][-1]["type"] == "interpretation" and m["blocks"][-1]["origin"] == "rule"
        ran = {
            (await alice.get(f"/analyses/{rid}")).json()["analysis_type"]
            for rid in m["meta"].get("analysis_run_ids", [])
        }
        assert types <= ran, (q, ran)
        assert m["evidence"] and all(e["id"].startswith("E") for e in m["evidence"])
    # the relationship answer is built from real numbers of the stored correlation matrix
    rel = await ask(alice, conv, "Which factors appear most strongly associated with satisfaction?")
    text = " ".join(e["text"] for e in rel["evidence"])
    assert "delivery_time" in text and "support_rating" in text
    # asking again reuses stored analyses (idempotent) instead of recomputing
    n_before = (await alice.get(f"/projects/{p['id']}/analyses")).json()["total"]
    await ask(alice, conv, "Which factors appear most strongly associated with satisfaction?")
    assert (await alice.get(f"/projects/{p['id']}/analyses")).json()["total"] == n_before
    # next steps are the dataset-specific suggestions, not generic advice
    nxt = await ask(alice, conv, "What should I investigate next?")
    assert any("satisfaction_score" in e["text"] or "delivery_time" in e["text"] for e in nxt["evidence"])


async def test_assistant_with_themes_answers_theme_and_mixed_questions(alice):
    p, ds, vid = await demo_project(alice)
    await alice.post(
        f"/projects/{p['id']}/qualitative/prepare", json={"dataset_version_id": vid, "column": "comment"}
    )
    await alice.post(
        f"/projects/{p['id']}/qualitative/themes/detect",
        json={"dataset_version_id": vid, "column": "comment", "n_themes": 4},
    )
    conv = (
        await alice.post(f"/projects/{p['id']}/ai/conversations", json={"dataset_version_id": vid})
    ).json()["id"]
    m = await ask(alice, conv, "What are the main themes in the comments?")
    assert m["meta"]["intent"] == "themes" and any(b["type"] == "qualitative" for b in m["blocks"])
    themes = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/themes", params={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()["themes"]
    assert any(
        str(t["response_count"]) in " ".join(e["text"] for e in m["evidence"]) for t in themes
    )  # counts come from stored memberships
    m = await ask(
        alice,
        conv,
        "Why is satisfaction low? What do the comments say and how do they relate to satisfaction?",
    )
    assert m["meta"]["intent"] == "mixed" and any(b["type"] == "mixed" for b in m["blocks"])
    assert len((await alice.get(f"/projects/{p['id']}/mixed")).json()) == 1


async def test_overview_is_cached_and_invalidated_by_content_changes(alice):
    p, ds, vid = await demo_project(alice)
    first = (await alice.get(f"/projects/{p['id']}/overview")).json()
    again = (await alice.get(f"/projects/{p['id']}/overview")).json()
    assert first["cached"] is False and again["cached"] is True and again["counts"] == first["counts"]
    assert first["datasets"][0]["rows"] == 608 and first["datasets"][0]["warnings"] >= 1
    await alice.post(
        f"/projects/{p['id']}/analyses",
        json={"dataset_version_id": vid, "analysis_type": "frequency", "config": {"column": "region"}},
    )
    after = (await alice.get(f"/projects/{p['id']}/overview")).json()
    assert (
        after["cached"] is False and after["counts"]["analyses"] == 1
    )  # revision bump → fresh data, no stale dashboard
    assert after["recent_analyses"][0]["headline"]["label"]


async def test_profile_cache_hit_after_first_read(alice):
    from app.cache.redis import get_redis

    p, ds, vid = await demo_project(alice)
    await alice.get(f"/datasets/{ds['id']}/profile")
    assert await get_redis().exists(f"lotus:v1:profile:{vid}") == 1
    a = (await alice.get(f"/datasets/{ds['id']}/profile")).json()
    assert a["version"]["id"] == vid


async def test_search_respects_project_boundaries(alice, bob):
    p, ds, vid = await demo_project(alice)
    await alice.post(f"/projects/{p['id']}/codes", json={"name": "Delivery speed", "keywords": ["fast"]})
    hits = (await alice.get("/search", params={"q": "deliver"})).json()
    assert "codes" in hits and hits["codes"][0]["title"] == "Delivery speed"
    assert (await alice.get("/search", params={"q": "customer"})).json()["datasets"][0]["id"] == ds["id"]
    assert (await bob.get("/search", params={"q": "customer"})).json() == {}  # nothing leaks to another user
    assert (
        await alice.get("/search", params={"q": "100%_wild"})
    ).json() == {}  # wildcards are escaped, not interpreted
    assert (await alice.get("/search", params={"q": "x"})).status_code == 422


async def test_suggestions_come_from_the_actual_data(alice):
    p, ds, vid = await demo_project(alice)
    s = (await alice.get(f"/datasets/{ds['id']}/suggestions")).json()
    titles = " | ".join(x["title"] for x in s)
    assert "satisfaction_score" in titles and "delivery_time" in titles
    assert any(x["analysis_type"] == "qualitative_themes" and x["config"]["column"] == "comment" for x in s)
    assert any(x["analysis_type"] == "time_series" for x in s)
    corr = next(x for x in s if x["analysis_type"] == "correlation")
    assert corr["reason"].startswith("Preliminary scan") and set(corr["config"]["variables"]) <= {
        "age",
        "delivery_time",
        "support_rating",
        "satisfaction_score",
        "purchase_frequency",
        "monthly_spend",
    }
    # every suggestion is runnable as written
    for x in s:
        if x["analysis_type"] in (
            "correlation",
            "group_comparison",
            "descriptive",
            "time_series",
            "logistic_regression",
        ):
            r = await alice.post(
                f"/projects/{p['id']}/analyses",
                json={"dataset_version_id": vid, "analysis_type": x["analysis_type"], "config": x["config"]},
            )
            assert r.status_code == 202 and r.json()["analysis"]["status"] == "COMPLETED", (x, r.text)


async def test_jobs_and_notifications_api(alice, bob):
    p, ds, vid = await demo_project(alice)
    jobs = (await alice.get(f"/projects/{p['id']}/jobs")).json()
    assert (
        jobs[0]["type"] == "ingest_dataset"
        and jobs[0]["status"] == "COMPLETED"
        and jobs[0]["completed_stages"] == jobs[0]["total_stages"] == 5
    )
    assert (await alice.get(f"/projects/{p['id']}/jobs", params={"status": "failed"})).json() == []
    assert (await bob.get(f"/jobs/{jobs[0]['id']}")).status_code == 404 and (
        await bob.post(f"/jobs/{jobs[0]['id']}/cancel")
    ).status_code == 404
    unread = (await alice.get("/notifications/unread-count")).json()["count"]
    assert unread >= 1
    first = (await alice.get("/notifications")).json()[0]
    assert (await alice.post(f"/notifications/{first['id']}/read")).status_code == 204
    assert (await alice.get("/notifications/unread-count")).json()["count"] == unread - 1
    assert (await alice.post("/notifications/read-all")).status_code == 204 and (
        await alice.get("/notifications/unread-count")
    ).json()["count"] == 0
    assert (await bob.get("/notifications")).json() == []
    cancelled = (await alice.post(f"/jobs/{jobs[0]['id']}/cancel")).json()  # finished jobs are unaffected
    assert cancelled["status"] == "COMPLETED"


async def test_members_listing_and_leave(alice, bob):
    p = (await alice.post("/projects", json={"name": "Team"})).json()
    assert (
        await alice.post(
            f"/projects/{p['id']}/members", json={"email": "ghost@example.com", "role": "VIEWER"}
        )
    ).json()["error"]["code"] == "USER_NOT_FOUND"
    await alice.post(f"/projects/{p['id']}/members", json={"email": "bob@example.com", "role": "EDITOR"})
    assert (
        await alice.post(f"/projects/{p['id']}/members", json={"email": "bob@example.com", "role": "EDITOR"})
    ).status_code == 409
    roles = {m["email"]: m["role"] for m in (await bob.get(f"/projects/{p['id']}/members")).json()}
    assert roles == {"alice@example.com": "OWNER", "bob@example.com": "EDITOR"}
    assert (
        await bob.delete(f"/projects/{p['id']}/members/{alice.user['id']}")
    ).status_code == 403  # editors cannot remove others
    assert (
        await bob.delete(f"/projects/{p['id']}/members/{bob.user['id']}")
    ).status_code == 204  # but may leave
    assert (await bob.get(f"/projects/{p['id']}")).status_code == 404
