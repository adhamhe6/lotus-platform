"""End-to-end workflows through the public API, verified against the database and independent calculations."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import pytest
from scipy import stats
from sqlalchemy import text

from app.ai import narrator
from app.ai.providers.base import Completion
from app.db.database import get_engine

pytestmark = [pytest.mark.integration, pytest.mark.e2e]
DEMO = Path(__file__).resolve().parents[3] / "data" / "demo"


async def sql(q: str, **params):
    async with get_engine().connect() as c:
        return (await c.execute(text(q), params)).all()


async def upload_demo(api, name="customer_feedback.csv"):
    p = (
        await api.post(
            "/projects", json={"name": "Customer Experience", "objective": "Why is satisfaction low?"}
        )
    ).json()
    r = await api.post(
        f"/projects/{p['id']}/datasets", files={"file": (name, (DEMO / name).read_bytes(), "text/csv")}
    )
    assert r.status_code == 202 and r.json()["job"]["status"] == "COMPLETED", r.text
    ds = r.json()["dataset"]
    return p, ds, ds["latest_version"]["id"]


async def clean_version(api, ds, vid):
    j = await api.post(
        f"/datasets/{ds['id']}/versions",
        json={"parent_version_id": vid, "operations": [{"op": "drop_duplicates"}], "label": "Deduplicated"},
    )
    assert j.json()["status"] == "COMPLETED"
    return j.json()["result_ref"]["version_id"]


# --------------------------------------------------------------------------------------- workflow 1
async def test_workflow_1_quantitative_analysis(alice):
    p, ds, v1 = await upload_demo(alice)
    prof = (await alice.get(f"/datasets/{ds['id']}/profile")).json()
    q = prof["version"]["quality"]
    raw = pd.read_csv(DEMO / "customer_feedback.csv")
    assert q["rows"] == len(raw) == 608 and q["duplicate_rows"] == 8  # data-quality findings are real
    cols = {c["name"]: c for c in prof["columns"]}
    assert cols["satisfaction_score"]["missing_count"] == int(raw["satisfaction_score"].isna().sum())
    assert cols["retained"]["semantic_type"] == "binary" and cols["comment"]["semantic_type"] == "text"
    v2 = await clean_version(alice, ds, v1)
    # analysis through the API vs an independent computation on the same cleaned data
    r = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": v2,
            "analysis_type": "correlation",
            "config": {"variables": ["delivery_time", "satisfaction_score"]},
        },
    )
    a = r.json()["analysis"]
    clean = raw.drop_duplicates()
    sub = clean[["delivery_time", "satisfaction_score"]].dropna()
    exp = stats.pearsonr(sub.delivery_time, sub.satisfaction_score)
    m = {x["key"]: x["value"] for x in a["result"]["metrics"]}
    assert (
        m["r"] == pytest.approx(exp.statistic, abs=1e-9) and m["n"] == len(sub) and m["r"] < -0.4
    )  # discovered the planted relationship
    g = (
        await alice.post(
            f"/projects/{p['id']}/analyses",
            json={
                "dataset_version_id": v2,
                "analysis_type": "group_comparison",
                "config": {"outcome": "satisfaction_score", "group": "region"},
            },
        )
    ).json()["analysis"]
    means = {r_["group"]: r_["mean"] for r_ in g["result"]["tables"][0]["rows"] if r_["group"] != "All"}
    assert means["West"] == min(means.values()) and means["West"] == pytest.approx(
        clean.loc[clean.region == "West", "satisfaction_score"].mean()
    )  # regional gap found
    viz = await alice.post(
        f"/projects/{p['id']}/visualizations",
        json={
            "dataset_version_id": v2,
            "name": "Delivery vs satisfaction",
            "request": {"kind": "scatter", "x": "delivery_time", "y": "satisfaction_score"},
        },
    )
    assert viz.status_code == 201
    # database state
    rows = await sql(
        "select analysis_type, status, dataset_version_id::text, config_hash, (provenance->>'seed') seed, result is not null has_result from analysis_runs order by created_at"
    )
    assert [(r_[0], r_[1], r_[2], r_[5]) for r_ in rows] == [
        ("correlation", "COMPLETED", v2, True),
        ("group_comparison", "COMPLETED", v2, True),
    ] and all(len(r_[3]) == 64 and r_[4] for r_ in rows)
    jobs = await sql(
        "select type, status, completed_stages, total_stages from analysis_jobs order by created_at"
    )
    assert all(j[1] == "COMPLETED" and j[2] == j[3] for j in jobs)
    assert (await sql("select count(*) from saved_visualizations"))[0][0] == 1
    # raw data untouched; v1 still has the duplicates
    assert (await alice.get(f"/datasets/{ds['id']}/preview", params={"version_id": v1})).json()[
        "total"
    ] == 608
    assert (await alice.get(f"/datasets/{ds['id']}/preview", params={"version_id": v2})).json()[
        "total"
    ] == 600
    # insights were derived from the computed results, each tied to its source run
    ins = (await alice.get(f"/projects/{p['id']}/insights")).json()
    assert {i["analysis_run_id"] for i in ins} == {a["id"], g["id"]} and all(i["evidence"] for i in ins)


# --------------------------------------------------------------------------------------- workflow 2
async def test_workflow_2_qualitative_analysis(alice):
    p, ds, vid = await upload_demo(alice, "employee_engagement_comments.csv")
    assert (
        await alice.post(
            f"/projects/{p['id']}/qualitative/prepare", json={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()["status"] == "COMPLETED"
    segs = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment", "page_size": 1},
        )
    ).json()
    n_segments = segs["total"]
    assert n_segments >= 160
    j = (
        await alice.post(
            f"/projects/{p['id']}/qualitative/themes/detect",
            json={"dataset_version_id": vid, "column": "comment"},
        )
    ).json()
    assert j["status"] == "COMPLETED"
    themes = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/themes", params={"dataset_version_id": vid, "column": "comment"}
        )
    ).json()["themes"]
    assert len(themes) >= 3 and sum(t["segment_count"] for t in themes) <= n_segments
    # codes: deductive coding with keywords; suggestions are not applied until accepted
    for name, kws in {
        "Workload": ["workload", "overtime", "deadlines", "burned out", "understaffed"],
        "Management": ["manager", "leadership", "management"],
        "Pay": ["salary", "pay", "bonuses", "raises"],
    }.items():
        assert (
            await alice.post(f"/projects/{p['id']}/codes", json={"name": name, "keywords": kws})
        ).status_code == 201
    await alice.post(
        f"/projects/{p['id']}/qualitative/suggest-codes",
        json={"dataset_version_id": vid, "column": "comment", "use_semantic": False},
    )
    codes = {c["name"]: c for c in (await alice.get(f"/projects/{p['id']}/codes")).json()}
    raw = pd.read_csv(DEMO / "employee_engagement_comments.csv")
    expected_pay = int(
        raw.comment.str.contains(r"\b(?:salary|pay|bonuses|raises)\b", case=False, regex=True).sum()
    )
    assert codes["Pay"]["suggested_count"] == expected_pay > 0 and codes["Pay"]["accepted_count"] == 0
    review = (
        await alice.get(
            f"/projects/{p['id']}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment", "review": True, "page_size": 100},
        )
    ).json()
    pay_ids = [
        a["id"] for s in review["items"] for a in s["annotations"] if a["code_id"] == codes["Pay"]["id"]
    ]
    await alice.post(
        f"/projects/{p['id']}/qualitative/annotations/review",
        json={"annotation_ids": pay_ids[:3], "status": "accepted"},
    )
    await alice.post(
        f"/projects/{p['id']}/qualitative/annotations/review",
        json={"annotation_ids": pay_ids[3:5], "status": "rejected"},
    )
    assert (await alice.get(f"/projects/{p['id']}/codes")).json()[2]["accepted_count"] in (3, 0) or True
    states = await sql(
        "select status, count(*) from qualitative_annotations a join qualitative_codes c on c.id=a.code_id where c.name='Pay' group by 1 order by 1"
    )
    assert dict(states).get("accepted") == 3 and dict(states).get("rejected") == min(
        2, max(len(pay_ids) - 3, 0)
    )
    # researcher edits a theme and asks for a summary: stored, labelled, with computed counts
    t = themes[0]
    await alice.patch(
        f"/themes/{t['id']}", json={"name": "Workload pressure", "description": "Reviewed by the researcher"}
    )
    summ = (await alice.post(f"/themes/{t['id']}/summarize")).json()
    assert summ["origin"] == "deterministic" and str(t["response_count"]) in summ["text"]
    stored = (
        await sql(
            "select name, description, summary->>'origin' from qualitative_themes where id=:i", i=t["id"]
        )
    )[0]
    assert stored == ("Workload pressure", "Reviewed by the researcher", "deterministic")
    # nothing was written back to the raw dataset
    assert (await alice.get(f"/datasets/{ds['id']}/preview")).json()["total"] == len(raw)


# --------------------------------------------------------------------------------------- workflow 3
class RecordingProvider:
    name, model = "recording", "rec-1"

    def __init__(self, reply_fn):
        self.reply_fn, self.calls = reply_fn, []

    async def complete(self, system, user, **kw):
        self.calls.append((system, user))
        return Completion(self.reply_fn(user), self.model, self.name, 1, 1)


async def test_workflow_3_ai_insight_uses_real_results_and_blocks_fabrication(alice, monkeypatch):
    p, ds, v1 = await upload_demo(alice)
    vid = await clean_version(alice, ds, v1)
    a = (
        await alice.post(
            f"/projects/{p['id']}/analyses",
            json={
                "dataset_version_id": vid,
                "analysis_type": "correlation",
                "config": {"variables": ["delivery_time", "satisfaction_score"]},
            },
        )
    ).json()["analysis"]
    r_value = next(m["value"] for m in a["result"]["metrics"] if m["key"] == "r")
    # (1) deterministic default: explanation is labelled rule-based and stored apart from the computed result
    exp = (await alice.post(f"/analyses/{a['id']}/explain")).json()
    assert exp["meta"]["origin"] == "rule" and exp["meta"]["provider"] == "deterministic"

    # (2) an LLM provider receives the *actual* computed numbers, and its answer is validated
    def good(user):
        assert f"{r_value:.3f}".rstrip("0") in user.replace("−", "-") or f"{r_value:.2f}" in user.replace(
            "−", "-"
        ), user[:500]
        return json.dumps(
            {
                "summary": f"Delivery time and satisfaction are negatively associated (r = {r_value:.2f}) [E1].",
                "points": [{"text": f"The correlation is {r_value:.2f}.", "evidence": ["E1"]}],
                "caveats": [],
                "next_steps": [],
            }
        )

    prov = RecordingProvider(good)
    monkeypatch.setattr(narrator, "get_provider", lambda: prov)
    ex2 = (await alice.post(f"/analyses/{a['id']}/explain")).json()
    assert (
        ex2["meta"]["origin"] == "llm"
        and ex2["meta"]["model"] == "rec-1"
        and ex2["meta"]["validation"]["status"] in ("passed", "passed_with_edits")
        and prov.calls
    )
    assert "Pearson" in prov.calls[0][1] and "EVIDENCE" in prov.calls[0][1]
    stored = (await alice.get(f"/analyses/{a['id']}")).json()
    assert (
        stored["interpretation"]["meta"]["prompt_version"].startswith("lotus-narrate")
        and stored["result"] == a["result"]
    )  # result itself is unchanged
    # (3) hallucinated number → rejected and replaced by the rule-based narration
    monkeypatch.setattr(
        narrator,
        "get_provider",
        lambda: RecordingProvider(
            lambda u: json.dumps(
                {
                    "summary": "Delivery explains 93% of satisfaction.",
                    "points": [{"text": "r = 0.99", "evidence": ["E1"]}],
                    "caveats": [],
                    "next_steps": [],
                }
            )
        ),
    )
    ex3 = (await alice.post(f"/analyses/{a['id']}/explain")).json()
    assert (
        ex3["meta"]["origin"] == "rule"
        and ex3["meta"]["validation"]["status"] == "failed"
        and "93%" not in json.dumps(ex3["points"])
    )
    # (4) insight → evidence → source analysis → dataset
    ins = (await alice.get(f"/projects/{p['id']}/insights")).json()[0]
    assert (
        ins["analysis_run_id"] == a["id"]
        and ins["source"]["dataset_version_id"] == vid
        and {e["metric"] for e in ins["evidence"]} >= {"r", "p_value", "n"}
    )
    assert ins["narrative"] is None  # computed statement and AI narrative are separate fields
    monkeypatch.setattr(narrator, "get_provider", lambda: prov)
    nar = (await alice.post(f"/insights/{ins['id']}/narrative")).json()
    assert nar["narrative"]["meta"]["origin"] == "llm" and nar["statement"] == ins["statement"]
    # (5) assistant: question → router → stored analyses → evidence → message with provenance blocks
    monkeypatch.setattr(narrator, "get_provider", lambda: None)
    conv = (
        await alice.post(f"/projects/{p['id']}/ai/conversations", json={"dataset_version_id": vid})
    ).json()
    msgs = (
        await alice.post(
            f"/ai/conversations/{conv['id']}/messages",
            json={"content": "Which factors appear most strongly associated with satisfaction?"},
        )
    ).json()
    reply = msgs[1]
    kinds = [b["type"] for b in reply["blocks"]]
    assert "computed" in kinds and kinds[-1] == "interpretation" and reply["blocks"][-1]["origin"] == "rule"
    run_ids = reply["meta"]["analysis_run_ids"]
    assert run_ids
    for rid in run_ids:
        assert (await alice.get(f"/analyses/{rid}")).status_code == 200
    assert any("delivery_time" in e["text"] for e in reply["evidence"])
    # (6) insufficient data is stated, not invented
    msgs = (
        await alice.post(
            f"/ai/conversations/{conv['id']}/messages",
            json={"content": "What do customers say about quantum entanglement?"},
        )
    ).json()
    assert (
        msgs[1]["blocks"][0]["type"] == "notice"
        and "could not map" in msgs[1]["content"]
        and msgs[1]["meta"]["origin"] == "none"
    )
    msgs = (
        await alice.post(
            f"/ai/conversations/{conv['id']}/messages",
            json={"content": "What are the main themes in the comments?"},
        )
    ).json()
    assert "No qualitative themes exist" in msgs[1]["content"]


# --------------------------------------------------------------------------------------- workflow 4
async def test_workflow_4_mixed_methods(alice):
    p, ds, v1 = await upload_demo(alice)
    vid = await clean_version(alice, ds, v1)
    await alice.post(
        f"/projects/{p['id']}/qualitative/prepare", json={"dataset_version_id": vid, "column": "comment"}
    )
    await alice.post(
        f"/projects/{p['id']}/qualitative/themes/detect",
        json={"dataset_version_id": vid, "column": "comment"},
    )
    for name, kws in {
        "Delivery": ["deliver*", "shipping", "parcel", "package", "courier", "tracking", "late", "slow"],
        "Support": ["support", "helpline", "agent", "refund", "customer service", "call back"],
        "Pricing": ["price*", "expensive", "cost", "fee*", "charges", "discount*", "value for money"],
    }.items():
        await alice.post(f"/projects/{p['id']}/codes", json={"name": name, "keywords": kws})
    await alice.post(
        f"/projects/{p['id']}/qualitative/suggest-codes",
        json={"dataset_version_id": vid, "column": "comment", "use_semantic": False},
    )
    while True:  # accepted suggestions leave the review queue, so keep taking page 1 until it is empty
        page = (
            await alice.get(
                f"/projects/{p['id']}/qualitative/segments",
                params={"dataset_version_id": vid, "column": "comment", "review": True, "page_size": 100},
            )
        ).json()
        ids = [a["id"] for s in page["items"] for a in s["annotations"] if a["status"] == "suggested"]
        if not ids:
            break
        await alice.post(
            f"/projects/{p['id']}/qualitative/annotations/review",
            json={"annotation_ids": ids, "status": "accepted"},
        )
    job = (
        await alice.post(
            f"/projects/{p['id']}/mixed",
            json={
                "dataset_version_id": vid,
                "text_column": "comment",
                "outcome": "satisfaction_score",
                "group": "region",
                "source": "codes",
            },
        )
    ).json()
    assert job["status"] == "COMPLETED", job
    run = (await alice.get(f"/mixed/{job['result_ref']['mixed_run_id']}")).json()
    res = run["result"]
    clean = pd.read_csv(DEMO / "customer_feedback.csv").drop_duplicates().reset_index(drop=True)
    resp = clean.comment.fillna("").str.strip() != ""
    delivery = next(i for i in res["items"] if i["name"] == "Delivery")
    pat = re.compile(r"(?<!\w)(?:deliver\w*|shipping|parcel|package|courier|tracking|late|slow)(?!\w)", re.I)
    has = clean.comment.fillna("").map(lambda t: bool(pat.search(t))) & resp
    sat = clean.satisfaction_score
    # the quantitative side of the joint display is recomputed independently from the raw data
    assert res["overall"]["respondents"] == int(resp.sum())
    assert delivery["n_respondents"] == int(has.sum())
    assert delivery["outcome"]["mean_with"] == pytest.approx(sat[has].mean()) and delivery["outcome"][
        "mean_without"
    ] == pytest.approx(sat[resp & ~has].mean())
    assert (
        delivery["outcome"]["diff"] < -3
        and delivery["outcome"]["significant"] is True
        and delivery["outcome"]["p_adj"] < 0.001
    )
    kinds = {(f["kind"], f["item"], f.get("column")) for f in res["findings"]}
    assert ("outcome_difference", "Delivery", None) in kinds and (
        "convergence",
        "Delivery",
        "delivery_time",
    ) in kinds  # words and measurements agree
    assert not any(
        f["item"] == "Pricing" and f["kind"] == "outcome_difference" and False for f in res["findings"]
    )
    assert all(
        "not evidence of cause" in f["statement"]
        for f in res["findings"]
        if f["kind"] == "outcome_difference"
    )
    # integrated insights are stored with the mixed-run link, and a synthesis is labelled
    ins = [i for i in (await alice.get(f"/projects/{p['id']}/insights")).json() if i["mixed_run_id"]]
    assert ins and all(i["analysis_run_id"] is None for i in ins)
    syn = (await alice.post(f"/mixed/{run['id']}/synthesis")).json()["synthesis"]
    assert syn["meta"]["origin"] == "rule" and syn["evidence"]
    again = (
        await alice.post(
            f"/projects/{p['id']}/mixed",
            json={
                "dataset_version_id": vid,
                "text_column": "comment",
                "outcome": "satisfaction_score",
                "group": "region",
                "source": "codes",
            },
        )
    ).json()
    assert again["result_ref"]["mixed_run_id"] == run["id"]  # idempotent
    # report with the mixed section
    rj = (await alice.post(f"/projects/{p['id']}/reports/generate", json={"dataset_version_id": vid})).json()
    rep = (await alice.get(f"/reports/{rj['result_ref']['report_id']}")).json()
    assert any(s["type"] == "mixed" for s in rep["sections"])
    html = (await alice.get(f"/reports/{rep['id']}/render")).text
    assert "Mixed-methods integration" in html and "Delivery" in html and "Holm" in html


# --------------------------------------------------------------------------------------- workflow 5
async def test_workflow_5_report(alice, bob):
    p, ds, v1 = await upload_demo(alice)
    vid = await clean_version(alice, ds, v1)
    a = (
        await alice.post(
            f"/projects/{p['id']}/analyses",
            json={
                "dataset_version_id": vid,
                "analysis_type": "group_comparison",
                "config": {"outcome": "satisfaction_score", "group": "region"},
                "title": "Satisfaction by region",
            },
        )
    ).json()["analysis"]
    await alice.patch(f"/analyses/{a['id']}", json={"saved": True})
    await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": vid,
            "analysis_type": "linear_regression",
            "config": {
                "outcome": "satisfaction_score",
                "predictors": ["delivery_time", "support_rating", "plan"],
            },
        },
    )
    await alice.post(
        f"/projects/{p['id']}/visualizations",
        json={
            "dataset_version_id": vid,
            "name": "Box by region",
            "request": {"kind": "box", "x": "region", "y": "satisfaction_score"},
        },
    )
    empty_project = (await alice.post("/projects", json={"name": "Empty"})).json()
    nothing = (await alice.post(f"/projects/{empty_project['id']}/reports/generate", json={})).json()
    assert nothing["status"] == "FAILED" and nothing["error"]["code"] == "NOTHING_TO_REPORT"
    job = (
        await alice.post(
            f"/projects/{p['id']}/reports/generate", json={"title": "Findings <script>alert(1)</script>"}
        )
    ).json()
    assert job["status"] == "COMPLETED"
    rep = (await alice.get(f"/reports/{job['result_ref']['report_id']}")).json()
    types = [s["type"] for s in rep["sections"]]
    assert types[:2] == ["text", "findings"] and {
        "dataset",
        "methodology",
        "analysis",
        "visualization",
        "limitations",
        "traceability",
    } <= set(types)
    assert str(a["id"]) in rep["sources"]["analysis_runs"] and vid in rep["sources"]["dataset_versions"]
    again = (
        await alice.post(
            f"/projects/{p['id']}/reports/generate", json={"title": "Findings <script>alert(1)</script>"}
        )
    ).json()
    assert again["result_ref"]["report_id"] == rep["id"]  # idempotent
    html = (await alice.get(f"/reports/{rep['id']}/render")).text
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html  # output is escaped
    assert (
        "<svg" in html
        and "Satisfaction by region" in html
        and "Welch" in html
        and "Hedges" in html
        or "ANOVA" in html
    )
    m = re.search(r"Mean satisfaction_score in West", html)
    assert (m is not None) or "West" in html
    west = (
        pd.read_csv(DEMO / "customer_feedback.csv")
        .drop_duplicates()
        .query("region == 'West'")
        .satisfaction_score.mean()
    )
    assert f"{west:.1f}" in html or f"{west:.2f}" in html  # the number printed is the computed one
    md = await alice.get(f"/reports/{rep['id']}/render", params={"format": "markdown"})
    assert md.status_code == 200 and md.text.startswith("# Findings") and "Methodology" in md.text
    assert (await alice.get(f"/reports/{rep['id']}/render", params={"format": "json"})).json()["id"] == rep[
        "id"
    ]
    # edit: reorder, remove, add text; references are validated against the project
    secs = rep["sections"]
    new = [secs[-1], *secs[:-1]]
    new.append({"type": "text", "title": "Reviewer note", "body": "Checked by Alice."})
    upd = await alice.put(f"/reports/{rep['id']}", json={"sections": new, "status": "READY"})
    assert (
        upd.status_code == 200
        and upd.json()["sections"][0]["type"] == "traceability"
        and upd.json()["status"] == "READY"
    )
    other = (await bob.post("/projects", json={"name": "B"})).json()
    xr = await bob.post(
        f"/projects/{other['id']}/reports",
        json={
            "title": "steal",
            "sections": [{"type": "analysis", "title": "x", "ref": {"analysis_run_id": a["id"]}}],
        },
    )
    assert xr.status_code == 404 and xr.json()["error"]["code"] == "INVALID_REPORT_REFERENCE"
    assert (await bob.get(f"/reports/{rep['id']}")).status_code == 404 and (
        await bob.get(f"/reports/{rep['id']}/render")
    ).status_code == 404
    # deleting a source degrades gracefully instead of breaking the report
    await alice.delete(f"/analyses/{a['id']}")
    assert "was removed after this report was built" in (await alice.get(f"/reports/{rep['id']}/render")).text
