"""Ad-hoc chart builder for the Visualizations workspace — with guards against misleading chart/data combinations."""

from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from app.analysis.base import require_columns, semantic
from app.core.exceptions import AnalysisConfigurationError
from app.datasets.types import NUMERIC_TYPES, SemanticType
from app.visualization import charts
from app.visualization.spec import ChartSpec

Agg = Literal["count", "mean", "sum", "median"]


class ChartRequest(BaseModel):
    kind: Literal["histogram", "bar", "box", "scatter", "line", "heatmap", "stacked_bar", "donut"]
    x: str | None = None
    y: str | None = None
    group: str | None = None
    columns: list[str] = Field(default_factory=list)
    aggregation: Agg = "count"
    frequency: Literal["D", "W", "M", "Q", "Y"] = "M"
    top_n: int = Field(default=15, ge=2, le=50)
    trendline: bool = True


def _need(v: str | None, what: str) -> str:
    if not v:
        raise AnalysisConfigurationError(f"Choose {what} for this chart.")
    return v


def _num(df: pd.DataFrame, col: str, what: str) -> pd.Series:
    require_columns(df, col)
    if semantic(df, col) not in NUMERIC_TYPES:
        raise AnalysisConfigurationError(f"{what} '{col}' must be numeric for this chart.")
    return pd.to_numeric(df[col], errors="coerce").astype("float64")


def _cat(df: pd.DataFrame, col: str, what: str, max_levels: int = 200) -> pd.Series:
    require_columns(df, col)
    sem = semantic(df, col)
    if sem in (SemanticType.TEXT, SemanticType.NUMERIC_CONTINUOUS, SemanticType.DATETIME):
        raise AnalysisConfigurationError(
            f"{what} '{col}' must be categorical (it is {sem.value.replace('_', ' ')})."
        )
    return df[col].astype("string")


def required_columns(req: ChartRequest) -> list[str]:
    return list(dict.fromkeys([c for c in [req.x, req.y, req.group, *req.columns] if c]))


def build(df: pd.DataFrame, req: ChartRequest) -> ChartSpec:
    k = req.kind
    if k == "histogram":
        x = _num(df, _need(req.x, "a numeric variable"), "Variable").dropna().to_numpy()
        if len(x) < 2:
            raise AnalysisConfigurationError("Not enough values to draw a histogram.")
        return charts.histogram_chart(x, req.x or "")
    if k in ("bar", "donut"):
        xc = _need(req.x, "a category variable")
        cat = _cat(df, xc, "Category variable")
        if k == "donut":
            vc = cat.value_counts()
            if len(vc) > 6:
                raise AnalysisConfigurationError(
                    f"A donut chart is only suitable for up to 6 parts of a whole; '{xc}' has {len(vc)}. Use a bar chart instead."
                )
            if len(vc) < 2:
                raise AnalysisConfigurationError("A donut chart needs at least two categories.")
            if req.aggregation != "count":
                raise AnalysisConfigurationError("Donut charts show shares, so they only support 'count'.")
            return charts.donut_chart(
                [str(i) for i in vc.index], [float(v) for v in vc.values], title=f"Share of {xc}"
            )
        if req.aggregation == "count" or not req.y:
            vc = cat.value_counts()
            vals, names = vc.iloc[: req.top_n], list(vc.index[: req.top_n])
            return charts.bar_chart(
                [str(n) for n in names],
                [float(v) for v in vals.values],
                title=f"Count by {xc}",
                x_label=xc,
                y_label="Count",
                horizontal=len(names) > 6,
            )
        y = _num(df, req.y, "Measure")
        g = (
            pd.DataFrame({"c": cat, "y": y})
            .dropna()
            .groupby("c")["y"]
            .agg(req.aggregation)
            .sort_values(ascending=False)
            .iloc[: req.top_n]
        )
        return charts.bar_chart(
            [str(i) for i in g.index],
            [float(v) for v in g.values],
            title=f"{req.aggregation.capitalize()} of {req.y} by {xc}",
            x_label=xc,
            y_label=f"{req.aggregation.capitalize()} of {req.y}",
            horizontal=len(g) > 6,
            subtitle="Bars start at zero" if (g >= 0).all() else None,
        )
    if k == "box":
        y = _num(df, _need(req.y, "a numeric variable"), "Variable")
        if req.x:
            cat = _cat(df, req.x, "Group variable")
            fr = pd.DataFrame({"g": cat, "y": y}).dropna()
            order = fr["g"].value_counts().index[: req.top_n]
            groups = {str(o): fr.loc[fr["g"] == o, "y"].to_numpy() for o in order}
            return charts.box_chart(groups, title=f"{req.y} by {req.x}", x_label=req.x, y_label=req.y or "")
        return charts.box_chart(
            {req.y or "": y.dropna().to_numpy()}, title=f"Spread of {req.y}", x_label="", y_label=req.y or ""
        )
    if k == "scatter":
        x = _num(df, _need(req.x, "an X variable"), "X variable")
        y = _num(df, _need(req.y, "a Y variable"), "Y variable")
        fr = pd.DataFrame({"x": x, "y": y}).dropna()
        if len(fr) < 3:
            raise AnalysisConfigurationError("Not enough paired observations for a scatter plot.")
        line = None
        if req.trendline and fr["x"].nunique() > 1:
            slope, intercept = np.polyfit(fr["x"], fr["y"], 1)
            line = (float(slope), float(intercept))
        return charts.scatter_chart(
            fr["x"].to_numpy(), fr["y"].to_numpy(), req.x or "", req.y or "", line=line
        )
    if k == "line":
        xc = _need(req.x, "a date column")
        require_columns(df, xc)
        if semantic(df, xc) != SemanticType.DATETIME:
            raise AnalysisConfigurationError(
                f"A line chart needs a date/time on the X axis; '{xc}' is not one. Use a bar chart for categories."
            )
        d = pd.to_datetime(df[xc], errors="coerce")
        yc = req.y
        if req.aggregation == "count" or not yc:
            s = pd.Series(1.0, index=d).dropna()
            ser = s.groupby(
                pd.Grouper(freq={"D": "D", "W": "W", "M": "MS", "Q": "QS", "Y": "YS"}[req.frequency])
            ).sum()
            ylabel = "Count"
        else:
            y = _num(df, yc, "Measure")
            fr = pd.DataFrame({"d": d, "y": y}).dropna().set_index("d")["y"]
            ser = getattr(
                fr.groupby(
                    pd.Grouper(freq={"D": "D", "W": "W", "M": "MS", "Q": "QS", "Y": "YS"}[req.frequency])
                ),
                req.aggregation,
            )()
            ylabel = f"{req.aggregation.capitalize()} of {yc}"
        if ser.notna().sum() < 3:
            raise AnalysisConfigurationError(
                "Fewer than three periods have data; a line chart would not be meaningful."
            )
        fmt = "%Y-%m-%d" if req.frequency in ("D", "W") else "%Y-%m" if req.frequency in ("M", "Q") else "%Y"
        return charts.line_chart(
            [i.strftime(fmt) for i in ser.index],
            {ylabel: [None if pd.isna(v) else float(v) for v in ser.values]},
            title=f"{ylabel} over time",
            x_label=xc,
            y_label=ylabel,
            x_type="time",
        )
    if k == "stacked_bar":
        xc, gc = _need(req.x, "a category variable"), _need(req.group, "a stack (colour) variable")
        a, b = _cat(df, xc, "Category variable"), _cat(df, gc, "Stack variable")
        if b.nunique() > 8:
            raise AnalysisConfigurationError(
                f"'{gc}' has {b.nunique()} levels; stacked charts become unreadable beyond 8."
            )
        ct = pd.crosstab(a, b)
        ct = ct.loc[ct.sum(axis=1).sort_values(ascending=False).index[: req.top_n]]
        pct = ct.div(ct.sum(axis=1), axis=0) * 100
        return charts.stacked_bar_chart(
            [str(i) for i in pct.index],
            {str(c): [float(v) for v in pct[c].values] for c in pct.columns},
            title=f"{gc} within {xc} (100% stacked)",
            x_label=xc,
            y_label="Share (%)",
        )
    if k == "heatmap":
        cols = req.columns or ([c for c in [req.x, req.y] if c])
        if len(cols) < 2:
            raise AnalysisConfigurationError("Choose at least two numeric columns for a correlation heatmap.")
        frame = pd.DataFrame({c: _num(df, c, "Variable") for c in cols})
        const = [c for c in cols if frame[c].nunique(dropna=True) < 2]
        if const:
            raise AnalysisConfigurationError(f"Constant column(s) have no correlation: {', '.join(const)}.")
        m = frame.corr(method="pearson", min_periods=3)
        return charts.heatmap_chart(
            cols,
            cols,
            [[None if pd.isna(v) else float(v) for v in m.loc[r]] for r in cols],
            title="Pearson correlation matrix",
            domain=(-1, 1),
            diverging=True,
            value_label="Pearson r",
        )
    raise AnalysisConfigurationError("Unsupported chart type.")


def recommend(columns: list[tuple[str, str]]) -> list[dict[str, object]]:
    """Suggest sensible charts from (name, semantic_type) pairs."""
    out: list[dict[str, object]] = []
    nums = [n for n, t in columns if t in ("numeric_continuous", "numeric_discrete")]
    cats = [n for n, t in columns if t in ("categorical", "boolean", "binary")]
    dates = [n for n, t in columns if t == "datetime"]
    for n in nums[:4]:
        out.append({"kind": "histogram", "x": n, "reason": f"See the distribution of {n}."})
    if len(nums) >= 2:
        out.append(
            {
                "kind": "scatter",
                "x": nums[0],
                "y": nums[1],
                "reason": f"Check the relationship between {nums[0]} and {nums[1]}.",
            }
        )
    for c in cats[:2]:
        out.append(
            {
                "kind": "bar",
                "x": c,
                "aggregation": "count",
                "reason": f"Compare how many records fall in each {c}.",
            }
        )
        if nums:
            out.append(
                {
                    "kind": "box",
                    "x": c,
                    "y": nums[0],
                    "reason": f"Compare the spread of {nums[0]} across {c}.",
                }
            )
    if dates and nums:
        out.append(
            {
                "kind": "line",
                "x": dates[0],
                "y": nums[0],
                "aggregation": "mean",
                "reason": f"Track {nums[0]} over {dates[0]}.",
            }
        )
    if len(nums) >= 3:
        out.append(
            {"kind": "heatmap", "columns": nums[:8], "reason": "Scan all numeric relationships at once."}
        )
    return out
