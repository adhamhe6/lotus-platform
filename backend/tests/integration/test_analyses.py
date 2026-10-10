from __future__ import annotations

import pytest
from scipy import stats

from tests.helpers import csv_bytes, survey_frame

pytestmark = pytest.mark.integration


async def setup_dataset(api, df=None):
    df = survey_frame() if df is None else df
    p = (await api.post("/projects", json={"name": "Study"})).json()
    ds = (
        await api.post(f"/projects/{p['id']}/datasets", files={"file": ("s.csv", csv_bytes(df), "text/csv")})
    ).json()["dataset"]
    return p, ds, ds["latest_version"]["id"], df


async def run_analysis(api, p, vid, type_, config, title=None):
    return await api.post(
        f"/projects/{p['id']}/analyses",
        json={"dataset_version_id": vid, "analysis_type": type_, "config": config, "title": title},
    )


async def test_correlation_matches_scipy_and_is_persisted_with_provenance(alice):
    p, ds, vid, df = await setup_dataset(alice)
    r = await run_analysis(alice, p, vid, "correlation", {"variables": ["delivery_time", "satisfaction"]})
    assert r.status_code == 202, r.text
    a = r.json()["analysis"]
    assert (
        a["status"] == "COMPLETED"
        and r.json()["reused"] is False
        and r.json()["job"]["status"] == "COMPLETED"
    )
    sub = df[["delivery_time", "satisfaction"]].dropna()
    expected = stats.pearsonr(sub["delivery_time"], sub["satisfaction"])
    m = {x["key"]: x for x in a["result"]["metrics"]}
    assert m["r"]["value"] == pytest.approx(expected.statistic) and m["p_value"]["value"] == pytest.approx(
        expected.pvalue
    )
    assert m["r"]["value"] < -0.5 and a["result"]["n_used"] == len(sub)
    assert a["result"]["charts"][0]["kind"] == "scatter"
    assert (
        a["provenance"]["libraries"]["scipy"]
        and a["provenance"]["seed"]
        and a["provenance"]["dataset_version_id"] == vid
    )
    assert a["provenance"]["config"] == {"variables": ["delivery_time", "satisfaction"], "method": "pearson"}
    assert a["headline"]["label"].startswith("Pearson")
    # reopen from history
    got = (await alice.get(f"/analyses/{a['id']}")).json()
    assert got["result"] == a["result"] and got["dataset_name"] == "s"
    hist = (await alice.get(f"/projects/{p['id']}/analyses")).json()
    assert (
        hist["total"] == 1
        and hist["items"][0]["id"] == a["id"]
        and hist["items"][0]["headline"]["n"] == len(sub)
    )


async def test_identical_request_is_idempotent(alice):
    p, ds, vid, _ = await setup_dataset(alice)
    cfg = {"outcome": "satisfaction", "group": "region"}
    first = (await run_analysis(alice, p, vid, "group_comparison", cfg)).json()
    second = (await run_analysis(alice, p, vid, "group_comparison", cfg)).json()
    assert (
        second["reused"] is True
        and second["job"] is None
        and second["analysis"]["id"] == first["analysis"]["id"]
    )
    third = (await run_analysis(alice, p, vid, "group_comparison", {**cfg, "test": "kruskal"})).json()
    assert third["analysis"]["id"] != first["analysis"]["id"]
    assert (await alice.get(f"/projects/{p['id']}/analyses")).json()["total"] == 2


@pytest.mark.parametrize(
    ("type_", "cfg", "msg"),
    [
        ("correlation", {"variables": ["delivery_time", "region"]}, "must be a numeric"),
        ("group_comparison", {"outcome": "region", "group": "region"}, "must be a numeric"),
        ("group_comparison", {"outcome": "satisfaction", "group": "delivery_time"}, "must be a categorical"),
        ("correlation", {"variables": ["delivery_time", "ghost"]}, "does not exist"),
        ("correlation", {"variables": ["delivery_time"]}, "Invalid configuration"),
        ("time_series", {"date_column": "region", "value_column": "satisfaction"}, "date"),
        ("nonsense", {}, "Unknown analysis type"),
    ],
)
async def test_invalid_configurations_are_rejected_before_queueing(alice, type_, cfg, msg):
    p, ds, vid, _ = await setup_dataset(alice)
    r = await run_analysis(alice, p, vid, type_, cfg)
    assert r.status_code == 422, r.text
    assert msg in r.json()["error"]["message"]
    assert r.json()["error"]["code"] in (
        "INVALID_ANALYSIS_CONFIGURATION",
        "UNKNOWN_COLUMN",
        "UNKNOWN_ANALYSIS_TYPE",
    )
    assert (await alice.get(f"/projects/{p['id']}/analyses")).json()["total"] == 0


async def test_runtime_statistical_failure_is_stored_as_failed_run(alice):
    df = survey_frame(60)
    df["flat"] = 5.0
    p, ds, vid, _ = await setup_dataset(alice, df)
    r = await run_analysis(alice, p, vid, "correlation", {"variables": ["flat", "satisfaction"]})
    assert r.status_code == 202
    a = r.json()["analysis"]
    assert (
        a["status"] == "FAILED"
        and a["error"]["code"] == "ZERO_VARIANCE"
        and r.json()["job"]["status"] == "FAILED"
    )
    # a failed run can be retried (e.g. after cleaning) — failed rows don't block the idempotency index
    again = await run_analysis(alice, p, vid, "correlation", {"variables": ["flat", "satisfaction"]})
    assert again.json()["reused"] is False


async def test_all_analysis_types_run_on_realistic_data(alice):
    p, ds, vid, df = await setup_dataset(alice)
    df_ids = {}
    cases = {
        "descriptive": {"columns": ["delivery_time", "satisfaction"]},
        "frequency": {"column": "region"},
        "crosstab": {"row": "region", "column": "support_rating"},
        "linear_regression": {
            "outcome": "satisfaction",
            "predictors": ["delivery_time", "support_rating", "region"],
        },
        "time_series": {"date_column": "survey_date", "value_column": "satisfaction", "frequency": "M"},
    }
    for t, cfg in cases.items():
        r = await run_analysis(alice, p, vid, t, cfg)
        assert r.status_code == 202, (t, r.text)
        assert r.json()["analysis"]["status"] == "COMPLETED", (t, r.json()["analysis"]["error"])
        df_ids[t] = r.json()["analysis"]["result"]
    lin = {m["key"]: m["value"] for m in df_ids["linear_regression"]["metrics"]}
    assert lin["r_squared"] > 0.7
    coef = {r["term"]: r["estimate"] for r in df_ids["linear_regression"]["tables"][0]["rows"]}
    assert coef["delivery_time"] == pytest.approx(-3, abs=0.8) and coef["support_rating"] == pytest.approx(
        4, abs=0.8
    )
    # binary logistic: derive outcome through a cleaning step? use support_rating>3 via transform is out of scope: use region West vs others via categorical with 3 levels → error
    r = await run_analysis(
        alice, p, vid, "logistic_regression", {"outcome": "region", "predictors": ["satisfaction"]}
    )
    assert (
        r.json()["analysis"]["status"] == "FAILED"
        and "exactly two" in r.json()["analysis"]["error"]["message"]
    )


async def test_analysis_isolation_rename_save_delete(alice, bob):
    p, ds, vid, _ = await setup_dataset(alice)
    a = (await run_analysis(alice, p, vid, "frequency", {"column": "region"})).json()["analysis"]
    assert (await bob.get(f"/analyses/{a['id']}")).status_code == 404
    assert (await bob.get(f"/projects/{p['id']}/analyses")).status_code == 404
    assert (await run_analysis(bob, p, vid, "frequency", {"column": "region"})).status_code == 404
    # bob's own project cannot reference alice's dataset version
    pb = (await bob.post("/projects", json={"name": "B"})).json()
    cross = await run_analysis(bob, pb, vid, "frequency", {"column": "region"})
    assert cross.status_code == 404 and cross.json()["error"]["code"] == "DATASET_VERSION_NOT_FOUND"
    upd = (await alice.patch(f"/analyses/{a['id']}", json={"title": "Regional split", "saved": True})).json()
    assert upd["title"] == "Regional split" and upd["saved"] is True
    saved = (await alice.get(f"/projects/{p['id']}/analyses", params={"saved": True})).json()
    assert saved["total"] == 1
    assert (await alice.delete(f"/analyses/{a['id']}")).status_code == 204
    assert (await alice.get(f"/analyses/{a['id']}")).status_code == 404


async def test_visualization_preview_save_and_guards(alice):
    p, ds, vid, df = await setup_dataset(alice)
    ok = await alice.post(
        f"/projects/{p['id']}/visualizations/preview",
        json={"dataset_version_id": vid, "kind": "histogram", "x": "satisfaction"},
    )
    assert ok.status_code == 200
    spec = ok.json()
    assert sum(spec["data"]["counts"]) == int(df["satisfaction"].notna().sum()) and spec["description"]
    sc = (
        await alice.post(
            f"/projects/{p['id']}/visualizations/preview",
            json={"dataset_version_id": vid, "kind": "scatter", "x": "delivery_time", "y": "satisfaction"},
        )
    ).json()
    assert sc["data"]["line"]["y1"] < sc["data"]["line"]["y0"]  # negative slope found in the data
    bar = (
        await alice.post(
            f"/projects/{p['id']}/visualizations/preview",
            json={
                "dataset_version_id": vid,
                "kind": "bar",
                "x": "region",
                "y": "satisfaction",
                "aggregation": "mean",
            },
        )
    ).json()
    west = bar["data"]["categories"].index("West")
    assert bar["data"]["series"][0]["values"][west] == pytest.approx(
        df.loc[df.region == "West", "satisfaction"].mean()
    )
    # misleading combos are refused with an explanation
    r = await alice.post(
        f"/projects/{p['id']}/visualizations/preview",
        json={"dataset_version_id": vid, "kind": "donut", "x": "support_rating"},
    )
    assert r.status_code == 200  # 5 levels is fine
    r = await alice.post(
        f"/projects/{p['id']}/visualizations/preview",
        json={
            "dataset_version_id": vid,
            "kind": "line",
            "x": "region",
            "y": "satisfaction",
            "aggregation": "mean",
        },
    )
    assert r.status_code == 422 and "date" in r.json()["error"]["message"]
    r = await alice.post(
        f"/projects/{p['id']}/visualizations/preview",
        json={"dataset_version_id": vid, "kind": "scatter", "x": "region", "y": "satisfaction"},
    )
    assert r.status_code == 422
    saved = await alice.post(
        f"/projects/{p['id']}/visualizations",
        json={
            "dataset_version_id": vid,
            "name": "Sat by region",
            "request": {"kind": "box", "x": "region", "y": "satisfaction"},
        },
    )
    assert saved.status_code == 201 and saved.json()["spec"]["kind"] == "box"
    assert len((await alice.get(f"/projects/{p['id']}/visualizations")).json()) == 1
    sugg = (await alice.get(f"/datasets/{ds['id']}/chart-suggestions")).json()
    assert any(s["kind"] == "line" for s in sugg) and any(s["kind"] == "scatter" for s in sugg)


async def test_analysis_types_catalogue(alice):
    types = (await alice.get("/analysis-types")).json()
    names = {t["type"] for t in types}
    assert {
        "descriptive",
        "frequency",
        "correlation",
        "crosstab",
        "group_comparison",
        "linear_regression",
        "logistic_regression",
        "time_series",
    } <= names
    corr = next(t for t in types if t["type"] == "correlation")
    assert corr["roles"][0]["multiple"] is True and "numeric_continuous" in corr["roles"][0]["accepts"]
