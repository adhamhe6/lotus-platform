"""Analysis suggestions derived from the actual schema and a quick, labelled-preliminary scan of the data."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def suggest(df: pd.DataFrame, columns: list[dict[str, Any]], max_items: int = 8) -> list[dict[str, Any]]:
    meta = {c["name"]: c for c in columns}
    nums = [
        c["name"]
        for c in columns
        if c["semantic_type"] in ("numeric_continuous", "numeric_discrete")
        and c["unique_count"] > 2
        and c["missing_pct"] < 50
    ]
    cats = [
        c["name"]
        for c in columns
        if c["semantic_type"] in ("categorical", "boolean")
        and 2 <= c["unique_count"] <= 12
        and c["missing_pct"] < 50
    ]
    bins = [
        c["name"]
        for c in columns
        if c["semantic_type"] == "binary"
        or (c["semantic_type"] in ("categorical", "boolean") and c["unique_count"] == 2)
    ]
    texts = [c["name"] for c in columns if c["semantic_type"] == "text"]
    dates = [c["name"] for c in columns if c["semantic_type"] == "datetime"]
    out: list[dict[str, Any]] = []
    if len(nums) >= 2:
        sub = df[nums[:12]].apply(pd.to_numeric, errors="coerce")
        corr = sub.corr(min_periods=20)
        pairs = []
        for i, a in enumerate(corr.columns):
            for b in corr.columns[i + 1 :]:
                r = corr.loc[a, b]
                if not np.isnan(r):
                    pairs.append((abs(r), r, a, b))
        for _, r, a, b in sorted(pairs, reverse=True)[:3]:
            if abs(r) >= 0.2:
                out.append(
                    {
                        "title": f"Analyze the correlation between {a} and {b}",
                        "analysis_type": "correlation",
                        "config": {"variables": [a, b], "method": "pearson"},
                        "reason": f"Preliminary scan: |r| ≈ {abs(r):.2f} between these variables on the data as loaded. Run the analysis for the tested result.",
                        "score": float(abs(r)),
                    }
                )
    for g in cats[:4]:
        for y in nums[:6]:
            sub = pd.DataFrame(
                {"g": df[g].astype("string"), "y": pd.to_numeric(df[y], errors="coerce")}
            ).dropna()
            if len(sub) < 30 or sub["y"].nunique() < 3:
                continue
            grand, tot = float(sub["y"].mean()), float(((sub["y"] - sub["y"].mean()) ** 2).sum())
            if tot == 0:
                continue
            stats_ = sub.groupby("g")["y"].agg(["count", "mean"])
            ssb = float((stats_["count"] * (stats_["mean"] - grand) ** 2).sum())
            eta2 = float(ssb / tot)
            if eta2 >= 0.02:
                out.append(
                    {
                        "title": f"Compare {y} across {g}",
                        "analysis_type": "group_comparison",
                        "config": {"outcome": y, "group": g, "test": "auto"},
                        "reason": f"Preliminary scan: {g} accounts for about {eta2:.0%} of the variance in {y}.",
                        "score": eta2,
                    }
                )
    if dates and nums:
        out.append(
            {
                "title": f"Examine the trend of {nums[0]} over {dates[0]}",
                "analysis_type": "time_series",
                "config": {
                    "date_column": dates[0],
                    "value_column": nums[0],
                    "frequency": "auto",
                    "aggregation": "mean",
                },
                "reason": f"'{dates[0]}' is a date column with {meta[dates[0]]['unique_count']} distinct values.",
                "score": 0.25,
            }
        )
    for b in bins[:1]:
        if nums:
            out.append(
                {
                    "title": f"Model what predicts {b}",
                    "analysis_type": "logistic_regression",
                    "config": {"outcome": b, "predictors": nums[:4]},
                    "reason": f"'{b}' is a two-level outcome; logistic regression estimates how the numeric variables relate to it.",
                    "score": 0.2,
                }
            )
    if nums:
        out.append(
            {
                "title": f"Examine the distribution of {nums[0]}",
                "analysis_type": "descriptive",
                "config": {"columns": nums[:3]},
                "reason": "Start with the spread and shape of the key measures before testing relationships.",
                "score": 0.1,
            }
        )
    for t in texts[:1]:
        out.append(
            {
                "title": f"Find recurring themes in '{t}'",
                "analysis_type": "qualitative_themes",
                "config": {"column": t},
                "reason": f"'{t}' contains free text (avg {meta[t]['profile'].get('avg_words', 0):.0f} words). Prepare it and detect themes in the Qualitative workspace.",
                "score": 0.3,
            }
        )
    miss = [c for c in columns if c["missing_pct"] >= 20]
    if miss:
        out.append(
            {
                "title": f"Review missing data in {', '.join(c['name'] for c in miss[:3])}",
                "analysis_type": "data_cleaning",
                "config": {},
                "reason": "These columns are at least 20% missing; analyses on them will drop many rows.",
                "score": 0.15,
            }
        )
    out.sort(key=lambda s: -s["score"])
    return out[:max_items]
