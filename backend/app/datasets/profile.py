"""Dataset profiling. Every number is computed from the data; nothing is estimated by a model."""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pandas as pd

from app.datasets.jsonable import to_jsonable
from app.datasets.types import SemanticType

_ID_NAME = re.compile(r"(^id$|_id$|^id_|\bid\b|uuid|guid|^key$|_key$|^code$|_code$|^index$)", re.I)
MAX_BINS = 30
TOP_N = 10


def classify(s: pd.Series, name: str) -> SemanticType:
    n = int(s.notna().sum())
    if n == 0:
        return SemanticType.CATEGORICAL
    nunique = int(s.nunique(dropna=True))
    ratio = nunique / n
    if pd.api.types.is_bool_dtype(s):
        return SemanticType.BOOLEAN
    if pd.api.types.is_datetime64_any_dtype(s):
        return SemanticType.DATETIME
    if pd.api.types.is_numeric_dtype(s):
        is_int = pd.api.types.is_integer_dtype(s)
        if is_int and nunique == n and n > 20 and _ID_NAME.search(name):
            return SemanticType.IDENTIFIER
        vals = set(pd.unique(s.dropna()))
        if nunique == 2 and vals <= {0, 1}:
            return SemanticType.BINARY
        if is_int and nunique <= 12 and nunique < max(n * 0.5, 3):
            return SemanticType.NUMERIC_DISCRETE
        return SemanticType.NUMERIC_CONTINUOUS
    # strings
    txt = s.dropna().astype(str)
    avg_len = float(txt.str.len().mean())
    avg_words = float(txt.str.split().str.len().mean())
    if nunique <= max(30, int(0.05 * n)) and avg_len < 60:
        return SemanticType.CATEGORICAL
    if avg_len >= 40 or avg_words >= 4:
        return SemanticType.TEXT
    if ratio >= 0.9 and (_ID_NAME.search(name) or avg_len < 40):
        return SemanticType.IDENTIFIER
    return SemanticType.CATEGORICAL


def histogram(x: np.ndarray, max_bins: int = MAX_BINS) -> dict[str, Any]:
    if len(x) == 0:
        return {"edges": [], "counts": []}
    if np.ptp(x) == 0:
        return {"edges": [float(x[0]), float(x[0])], "counts": [len(x)]}
    bins = min(max_bins, max(5, len(np.histogram_bin_edges(x, bins="auto")) - 1))
    counts, edges = np.histogram(x, bins=bins)
    return {"edges": [float(e) for e in edges], "counts": [int(c) for c in counts]}


def profile_column(s: pd.Series, name: str, sem: SemanticType | None = None) -> dict[str, Any]:
    sem = sem or classify(s, name)
    total = len(s)
    missing = int(s.isna().sum())
    base: dict[str, Any] = {
        "count": total - missing,
        "missing_count": missing,
        "missing_pct": round(missing / total * 100, 4) if total else 0.0,
        "unique_count": int(s.nunique(dropna=True)),
    }
    if sem in (SemanticType.NUMERIC_CONTINUOUS, SemanticType.NUMERIC_DISCRETE, SemanticType.BINARY):
        x = pd.to_numeric(s, errors="coerce").dropna().astype("float64").to_numpy()
        if len(x):
            q1, med, q3 = np.percentile(x, [25, 50, 75])
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            std = float(np.std(x, ddof=1)) if len(x) > 1 else None
            base.update(
                mean=float(x.mean()),
                median=float(med),
                min=float(x.min()),
                max=float(x.max()),
                std=std,
                q1=float(q1),
                q3=float(q3),
                skewness=float(pd.Series(x).skew()) if len(x) > 2 and std else None,
                outlier_count=int(((x < lo) | (x > hi)).sum()) if iqr > 0 else 0,
                outlier_bounds=[float(lo), float(hi)],
                histogram=histogram(x),
            )
        if sem == SemanticType.NUMERIC_DISCRETE or sem == SemanticType.BINARY:
            vc = s.value_counts(dropna=True).sort_index()
            base["value_counts"] = [{"value": to_jsonable(k), "count": int(v)} for k, v in vc.items()]
    elif sem in (SemanticType.CATEGORICAL, SemanticType.BOOLEAN, SemanticType.IDENTIFIER):
        vc = s.value_counts(dropna=True)
        nn = max(int(vc.sum()), 1)
        base["top_values"] = [
            {"value": to_jsonable(k), "count": int(v), "pct": round(float(v) / nn * 100, 3)}
            for k, v in vc.head(TOP_N).items()
        ]
        base["category_count"] = len(vc)
        base["mode"] = to_jsonable(vc.index[0]) if len(vc) else None
    elif sem == SemanticType.DATETIME:
        d = pd.to_datetime(s, errors="coerce").dropna()
        if len(d):
            span = (d.max() - d.min()).days
            base.update(
                min=d.min().isoformat(),
                max=d.max().isoformat(),
                span_days=int(span),
                distinct_months=int(d.dt.to_period("M").nunique()),
                distinct_days=int(d.dt.normalize().nunique()),
            )
    elif sem == SemanticType.TEXT:
        t = s.dropna().astype(str)
        words = t.str.split().str.len()
        base.update(
            avg_chars=float(t.str.len().mean()) if len(t) else 0.0,
            avg_words=float(words.mean()) if len(t) else 0.0,
            max_chars=int(t.str.len().max()) if len(t) else 0,
            empty_count=int((t.str.strip() == "").sum()),
        )
    return base


def profile_frame(df: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return (column descriptors, dataset-level quality summary)."""
    cols: list[dict[str, Any]] = []
    for i, name in enumerate(df.columns):
        s = df[name]
        sem = classify(s, str(name))
        prof = profile_column(s, str(name), sem)
        cols.append(
            {
                "position": i,
                "name": str(name),
                "dtype": str(s.dtype),
                "semantic_type": sem.value,
                "missing_count": prof["missing_count"],
                "missing_pct": prof["missing_pct"],
                "unique_count": prof["unique_count"],
                "profile": prof,
            }
        )
    return cols, quality_summary(df, cols)


def quality_summary(df: pd.DataFrame, cols: list[dict[str, Any]]) -> dict[str, Any]:
    n_rows, n_cols = df.shape
    total_cells = n_rows * n_cols
    missing_cells = int(sum(c["missing_count"] for c in cols))
    dup = int(df.duplicated().sum()) if n_rows else 0
    issues: list[dict[str, Any]] = []
    for c in cols:
        if c["missing_pct"] >= 20:
            issues.append(
                {
                    "severity": "warning",
                    "code": "HIGH_MISSING",
                    "column": c["name"],
                    "message": f"'{c['name']}' is {c['missing_pct']:.1f}% missing.",
                }
            )
        elif c["missing_count"] > 0:
            issues.append(
                {
                    "severity": "info",
                    "code": "SOME_MISSING",
                    "column": c["name"],
                    "message": f"'{c['name']}' has {c['missing_count']} missing value(s).",
                }
            )
        if c["unique_count"] <= 1 and n_rows > 1:
            issues.append(
                {
                    "severity": "warning",
                    "code": "CONSTANT_COLUMN",
                    "column": c["name"],
                    "message": f"'{c['name']}' has a single value and carries no information.",
                }
            )
        oc = c["profile"].get("outlier_count", 0)
        if oc and c["profile"].get("count"):
            pct = oc / c["profile"]["count"] * 100
            if pct >= 1:
                issues.append(
                    {
                        "severity": "info",
                        "code": "OUTLIERS",
                        "column": c["name"],
                        "message": f"'{c['name']}' has {oc} IQR outlier(s) ({pct:.1f}%).",
                    }
                )
    if dup:
        issues.append(
            {
                "severity": "warning",
                "code": "DUPLICATE_ROWS",
                "column": None,
                "message": f"{dup} fully duplicated row(s) ({dup / n_rows * 100:.1f}%).",
            }
        )
    counts: dict[str, int] = {}
    for c in cols:
        counts[c["semantic_type"]] = counts.get(c["semantic_type"], 0) + 1
    return {
        "rows": n_rows,
        "columns": n_cols,
        "missing_cells": missing_cells,
        "missing_pct": round(missing_cells / total_cells * 100, 4) if total_cells else 0.0,
        "complete_rows": int(df.dropna().shape[0]),
        "duplicate_rows": dup,
        "type_counts": counts,
        "issues": issues,
        "memory_bytes": int(df.memory_usage(deep=True).sum()),
    }
