"""Chart-spec builders. They only reshape arrays that were already computed from the dataset."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.datasets.jsonable import to_jsonable
from app.datasets.profile import histogram
from app.visualization.spec import ChartSpec

MAX_SCATTER_POINTS = 2000
MAX_CATEGORIES = 30


def _f(v: Any) -> float | None:
    return to_jsonable(float(v)) if v is not None and not (isinstance(v, float) and np.isnan(v)) else None


def downsample_xy(
    x: np.ndarray, y: np.ndarray, limit: int = MAX_SCATTER_POINTS
) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic thinning (evenly spaced after a stable sort by x) — statistics always use every row."""
    if len(x) <= limit:
        return x, y
    order = np.argsort(x, kind="stable")
    idx = order[np.linspace(0, len(order) - 1, limit).astype(int)]
    return x[idx], y[idx]


def histogram_chart(x: np.ndarray, name: str, *, title: str | None = None) -> ChartSpec:
    h = histogram(x)
    mean = float(np.mean(x)) if len(x) else None
    desc = f"Histogram of {name} ({len(x)} observations)"
    if len(x):
        desc += f", ranging from {np.min(x):.4g} to {np.max(x):.4g}."
    return ChartSpec(
        kind="histogram",
        title=title or f"Distribution of {name}",
        x_label=name,
        y_label="Count",
        data={**h, "mean": mean, "n": len(x)},
        description=desc,
    )


def bar_chart(
    categories: list[str],
    values: list[float],
    *,
    title: str,
    x_label: str,
    y_label: str,
    series_name: str | None = None,
    errors: list[tuple[float, float]] | None = None,
    horizontal: bool = False,
    percent: bool = False,
    subtitle: str | None = None,
    counts: list[int] | None = None,
) -> ChartSpec:
    cats = [str(c) for c in categories]
    top = max(range(len(values)), key=lambda i: values[i]) if values else None
    desc = f"Bar chart of {y_label} by {x_label} for {len(cats)} categories."
    if top is not None:
        desc += f" Highest: {cats[top]} ({values[top]:.4g})."
    series: dict[str, Any] = {"name": series_name or y_label, "values": [_f(v) for v in values]}
    if errors:
        series["errors"] = [[_f(a), _f(b)] for a, b in errors]
    return ChartSpec(
        kind="hbar" if horizontal else "bar",
        title=title,
        subtitle=subtitle,
        x_label=x_label,
        y_label=y_label,
        data={"categories": cats, "series": [series], "percent": percent, "counts": counts},
        description=desc,
    )


def stacked_bar_chart(
    categories: list[str],
    series: dict[str, list[float]],
    *,
    title: str,
    x_label: str,
    y_label: str,
    percent: bool = True,
) -> ChartSpec:
    return ChartSpec(
        kind="stacked_bar",
        title=title,
        x_label=x_label,
        y_label=y_label,
        data={
            "categories": [str(c) for c in categories],
            "series": [{"name": str(k), "values": [_f(v) for v in vs]} for k, vs in series.items()],
            "percent": percent,
        },
        description=f"Stacked bar chart of {y_label} across {len(categories)} categories of {x_label}, split into {len(series)} segments.",
    )


def line_chart(
    x: list[Any],
    series: dict[str, list[float | None]],
    *,
    title: str,
    x_label: str,
    y_label: str,
    x_type: str = "category",
    subtitle: str | None = None,
    dashed: set[str] | None = None,
) -> ChartSpec:
    first = next(iter(series.values()), [])
    valid = [(i, v) for i, v in enumerate(first) if v is not None]
    desc = f"Line chart of {y_label} over {x_label} with {len(x)} points."
    if valid:
        i0, v0 = valid[0]
        i1, v1 = valid[-1]
        desc += f" From {v0:.4g} at {x[i0]} to {v1:.4g} at {x[i1]}."
    return ChartSpec(
        kind="line",
        title=title,
        subtitle=subtitle,
        x_label=x_label,
        y_label=y_label,
        data={
            "x": [to_jsonable(v) for v in x],
            "x_type": x_type,
            "series": [
                {"name": k, "values": [_f(v) for v in vs], "dashed": k in (dashed or set())}
                for k, vs in series.items()
            ],
        },
        description=desc,
    )


def scatter_chart(
    x: np.ndarray,
    y: np.ndarray,
    x_name: str,
    y_name: str,
    *,
    line: tuple[float, float] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
) -> ChartSpec:
    xs, ys = downsample_xy(x, y)
    data: dict[str, Any] = {
        "points": [[float(a), float(b)] for a, b in zip(xs, ys, strict=True)],
        "n_total": len(x),
        "n_shown": len(xs),
    }
    notes = []
    if line is not None and len(x):
        slope, intercept = line
        x0, x1 = float(np.min(x)), float(np.max(x))
        data["line"] = {"x0": x0, "y0": intercept + slope * x0, "x1": x1, "y1": intercept + slope * x1}
    if len(xs) < len(x):
        notes.append(
            f"Showing {len(xs)} of {len(x)} points for performance; all points are used in the statistics."
        )
    return ChartSpec(
        kind="scatter",
        title=title or f"{y_name} vs {x_name}",
        subtitle=subtitle,
        x_label=x_name,
        y_label=y_name,
        data=data,
        description=f"Scatter plot of {y_name} against {x_name} with {len(x)} observations.",
        notes=notes,
    )


def box_chart(groups: dict[str, np.ndarray], *, title: str, x_label: str, y_label: str) -> ChartSpec:
    items = []
    for name, arr in groups.items():
        if len(arr) == 0:
            continue
        q1, med, q3 = np.percentile(arr, [25, 50, 75])
        iqr = q3 - q1
        lo_fence, hi_fence = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        inside = arr[(arr >= lo_fence) & (arr <= hi_fence)]
        outliers = arr[(arr < lo_fence) | (arr > hi_fence)]
        items.append(
            {
                "name": str(name),
                "n": len(arr),
                "q1": float(q1),
                "median": float(med),
                "q3": float(q3),
                "mean": float(np.mean(arr)),
                "whisker_low": float(inside.min()) if len(inside) else float(q1),
                "whisker_high": float(inside.max()) if len(inside) else float(q3),
                "outliers": [float(v) for v in np.sort(outliers)[:60]],
                "n_outliers": len(outliers),
            }
        )
    return ChartSpec(
        kind="box",
        title=title,
        x_label=x_label,
        y_label=y_label,
        data={"groups": items},
        description=f"Box plot of {y_label} for {len(items)} group(s) of {x_label}; boxes show the interquartile range and median.",
    )


def heatmap_chart(
    rows: list[str],
    cols: list[str],
    values: list[list[float | None]],
    *,
    title: str,
    domain: tuple[float, float] | None = None,
    diverging: bool = False,
    value_label: str = "Value",
    x_label: str = "",
    y_label: str = "",
) -> ChartSpec:
    flat = [v for r in values for v in r if v is not None]
    dom = domain or ((min(flat), max(flat)) if flat else (0.0, 1.0))
    return ChartSpec(
        kind="heatmap",
        title=title,
        x_label=x_label,
        y_label=y_label,
        data={
            "rows": rows,
            "cols": cols,
            "values": [[_f(v) for v in r] for r in values],
            "domain": [float(dom[0]), float(dom[1])],
            "diverging": diverging,
            "value_label": value_label,
        },
        description=f"Heatmap of {value_label} for {len(rows)} by {len(cols)} cells.",
    )


def donut_chart(names: list[str], values: list[float], *, title: str) -> ChartSpec:
    return ChartSpec(
        kind="donut",
        title=title,
        data={"slices": [{"name": str(n), "value": float(v)} for n, v in zip(names, values, strict=True)]},
        description=f"Donut chart of {len(names)} parts of a whole.",
    )


def coef_chart(items: list[dict[str, Any]], *, title: str, x_label: str, reference: float = 0.0) -> ChartSpec:
    return ChartSpec(
        kind="coef",
        title=title,
        x_label=x_label,
        data={"items": items, "reference": reference},
        description=f"Coefficient plot with {len(items)} term(s) and 95% confidence intervals around the estimate.",
    )


def roc_chart(fpr: np.ndarray, tpr: np.ndarray, auc: float, *, title: str = "ROC curve") -> ChartSpec:
    idx = np.unique(np.linspace(0, len(fpr) - 1, min(len(fpr), 200)).astype(int))
    return ChartSpec(
        kind="roc",
        title=title,
        x_label="False positive rate",
        y_label="True positive rate",
        data={"points": [[float(fpr[i]), float(tpr[i])] for i in idx], "auc": float(auc)},
        description=f"ROC curve with area under the curve {auc:.3f}.",
    )


def frame_to_category_values(s: pd.Series) -> tuple[list[str], list[int]]:
    vc = s.value_counts(dropna=True)
    return [str(i) for i in vc.index], [int(v) for v in vc.values]
