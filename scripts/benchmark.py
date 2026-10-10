#!/usr/bin/env python
"""Measure the pipeline on a large synthetic dataset through the real HTTP API.

    python scripts/benchmark.py --base http://localhost:8000 --email demo@lotus-demo.org --password '…' --rows 250000
"""
from __future__ import annotations

import argparse
import io
import time

import httpx
import numpy as np
import pandas as pd


def make(rows: int) -> bytes:
    rng = np.random.default_rng(1)
    x = rng.normal(size=rows)
    df = pd.DataFrame({
        "id": np.arange(rows), "region": rng.choice(list("ABCDE"), rows), "plan": rng.choice(["basic", "std", "pro"], rows),
        "x1": x, "x2": 0.6 * x + rng.normal(size=rows), "x3": rng.gamma(2, 2, rows), "score": 70 + 5 * x + rng.normal(0, 8, rows),
        "d": (pd.Timestamp("2020-01-01") + pd.to_timedelta(rng.integers(0, 1800, rows), unit="D")).strftime("%Y-%m-%d"),
        "note": rng.choice(["fast delivery", "slow support reply", "great value", "app keeps crashing"], rows),
    })
    df.loc[rng.choice(rows, rows // 50, replace=False), "x3"] = np.nan
    return df.to_csv(index=False).encode()


def timed(label: str, fn):
    t = time.perf_counter()
    out = fn()
    print(f"{label:<46}{(time.perf_counter() - t) * 1000:>9.0f} ms")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--rows", type=int, default=250_000)
    a = ap.parse_args()
    c = httpx.Client(base_url=a.base + "/api/v1", timeout=600)
    tok = c.post("/auth/login", json={"email": a.email, "password": a.password}).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    raw = make(a.rows)
    print(f"dataset: {a.rows:,} rows, {len(raw) / 1e6:.1f} MB CSV\n")
    pid = c.post("/projects", json={"name": f"Benchmark {a.rows}"}).json()["id"]
    r = timed("upload + ingest (parse, infer, profile, parquet)", lambda: c.post(f"/projects/{pid}/datasets", files={"file": ("b.csv", raw, "text/csv")}))
    ds = r.json()["dataset"]
    assert ds["status"] == "READY", ds
    vid, did = ds["latest_version"]["id"], ds["id"]
    timed("profile (cold, from DB)", lambda: c.get(f"/datasets/{did}/profile"))
    timed("profile (warm, Redis)", lambda: c.get(f"/datasets/{did}/profile"))
    timed("preview page 1 (row-group slice)", lambda: c.get(f"/datasets/{did}/preview", params={"page_size": 50}))
    timed("preview page 4000 (row-group slice)", lambda: c.get(f"/datasets/{did}/preview", params={"page": 4000, "page_size": 50}))
    timed("preview filtered+sorted (full scan)", lambda: c.get(f"/datasets/{did}/preview", params={"sort": "score", "order": "desc", "filters": '[{"column":"region","operator":"eq","value":"A"}]'}))
    for t, cfg in [("descriptive", {"columns": ["x1", "x2", "x3", "score"]}), ("correlation", {"variables": ["x1", "x2", "x3", "score"]}),
                   ("group_comparison", {"outcome": "score", "group": "region"}), ("linear_regression", {"outcome": "score", "predictors": ["x1", "x2", "plan"]}),
                   ("time_series", {"date_column": "d", "value_column": "score", "frequency": "M"})]:
        timed(f"analysis: {t}", lambda t=t, cfg=cfg: c.post(f"/projects/{pid}/analyses", json={"dataset_version_id": vid, "analysis_type": t, "config": cfg}))
    timed("analysis: repeat (idempotent, no recompute)", lambda: c.post(f"/projects/{pid}/analyses", json={"dataset_version_id": vid, "analysis_type": "correlation", "config": {"variables": ["x1", "x2", "x3", "score"]}}))
    timed("chart: scatter (250k → 2000 points)", lambda: c.post(f"/projects/{pid}/visualizations/preview", json={"dataset_version_id": vid, "kind": "scatter", "x": "x1", "y": "score"}))
    timed("overview (cold)", lambda: c.get(f"/projects/{pid}/overview"))
    timed("overview (warm, cached by revision)", lambda: c.get(f"/projects/{pid}/overview"))
    c.delete(f"/projects/{pid}")
    _ = io


if __name__ == "__main__":
    main()
