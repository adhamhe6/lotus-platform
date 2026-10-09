from __future__ import annotations

import pandas as pd
from pydantic import BaseModel, Field

from app.analysis.base import AnalysisResult, AnalysisSpec, Metric, Table, TableColumn, VarSpec, require_columns, require_n
from app.core.exceptions import AnalysisConfigurationError
from app.datasets.types import SemanticType
from app.analysis.base import semantic
from app.visualization.charts import bar_chart, donut_chart


class FrequencyConfig(BaseModel):
    column: str
    top_n: int = Field(default=20, ge=2, le=100)


def run(df: pd.DataFrame, cfg: FrequencyConfig) -> AnalysisResult:
    require_columns(df, cfg.column)
    sem = semantic(df, cfg.column)
    if sem in (SemanticType.TEXT, SemanticType.NUMERIC_CONTINUOUS, SemanticType.DATETIME):
        raise AnalysisConfigurationError(
            f"'{cfg.column}' is {sem.value.replace('_', ' ')}; frequency tables need a categorical, binary or discrete variable. "
            "Use descriptive statistics (numeric) or the qualitative workspace (text) instead."
        )
    s = df[cfg.column]
    n_total = len(s)
    vc = s.value_counts(dropna=True)
    n_used = int(vc.sum())
    require_n(n_used, 1)
    pct = vc / n_used * 100
    cum = pct.cumsum()
    rows = [{"category": str(k), "count": int(v), "percent": float(p), "cumulative_percent": float(c)}
            for (k, v), p, c in zip(vc.items(), pct, cum, strict=True)]
    missing = n_total - n_used
    if missing:
        rows.append({"category": "(missing)", "count": missing, "percent": None, "cumulative_percent": None})
    shown = rows[: cfg.top_n] if len(vc) > cfg.top_n else [r for r in rows if r["category"] != "(missing)"]
    other = sum(r["count"] for r in rows[cfg.top_n:] if r["category"] != "(missing)") if len(vc) > cfg.top_n else 0
    cats = [r["category"] for r in shown] + (["Other"] if other else [])
    vals = [float(r["count"]) for r in shown] + ([float(other)] if other else [])
    charts = [bar_chart(cats, vals, title=f"Frequency of {cfg.column}", x_label=cfg.column, y_label="Count", horizontal=len(cats) > 6)]
    if 2 <= len(vc) <= 6:
        charts.append(donut_chart([str(k) for k in vc.index], [float(v) for v in vc.values], title=f"Share of {cfg.column}"))
    warnings = []
    if len(vc) > 50:
        warnings.append(f"'{cfg.column}' has {len(vc)} categories; consider grouping rare ones.")
    if int((vc < 5).sum()) and len(vc) > 2:
        warnings.append(f"{int((vc < 5).sum())} categor{'y has' if int((vc < 5).sum()) == 1 else 'ies have'} fewer than 5 observations; percentages for them are imprecise.")
    top = rows[0]
    return AnalysisResult(
        type="frequency", title=f"Frequency distribution — {cfg.column}", variables={"column": cfg.column}, n_total=n_total, n_used=n_used,
        metrics=[Metric(key="n", label="Valid responses (N)", value=n_used, primary=True), Metric(key="categories", label="Categories", value=int(len(vc))),
                 Metric(key="mode", label="Most frequent", value=top["category"]), Metric(key="mode_pct", label="Share of most frequent", value=top["percent"], unit="%"),
                 Metric(key="missing", label="Missing", value=missing)],
        tables=[Table(name="frequencies", title="Frequency table", columns=[
            TableColumn(key="category", label="Category"), TableColumn(key="count", label="Count", kind="integer"),
            TableColumn(key="percent", label="Percent", kind="percent"), TableColumn(key="cumulative_percent", label="Cumulative %", kind="percent")],
            rows=rows, note="Percentages are of valid (non-missing) responses.")],
        charts=charts, warnings=warnings,
        decisions=["Percentages use valid responses as the denominator; missing values are reported separately."],
        methodology="Counts and percentages of each distinct value of the selected variable. Bars are sorted by frequency; a donut chart is added only when there are at most six categories.",
    )


SPEC = AnalysisSpec(
    type="frequency", label="Frequency analysis", description="Counts and percentages of each category.",
    roles=[VarSpec("column", "Variable", ["categorical", "boolean", "binary", "numeric_discrete"])], config_model=FrequencyConfig, run=run,
    parameters=[{"key": "top_n", "label": "Categories shown", "type": "integer", "default": 20, "min": 2, "max": 100}],
)
