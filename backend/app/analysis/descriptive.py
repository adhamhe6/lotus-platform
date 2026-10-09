from __future__ import annotations

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from scipy import stats

from app.analysis.base import (
    AnalysisResult,
    AnalysisSpec,
    Assumption,
    Metric,
    Table,
    TableColumn,
    VarSpec,
    mean_ci,
    normality_assumption,
    require_numeric,
    sf,
)
from app.core.exceptions import AnalysisConfigurationError
from app.visualization.charts import box_chart, histogram_chart


class DescriptiveConfig(BaseModel):
    columns: list[str] = Field(min_length=1, max_length=40)


def run(df: pd.DataFrame, cfg: DescriptiveConfig) -> AnalysisResult:
    cols = list(dict.fromkeys(cfg.columns))
    rows, charts, assumptions, warnings = [], [], [], []
    arrays: dict[str, np.ndarray] = {}
    for c in cols:
        s = require_numeric(df, c)
        x = s.dropna().to_numpy()
        if len(x) == 0:
            raise AnalysisConfigurationError(f"'{c}' has no non-missing values.")
        arrays[c] = x
        n = len(x)
        sd = float(np.std(x, ddof=1)) if n > 1 else None
        modes = stats.mode(x, keepdims=False)
        mode_count = int(modes.count)
        ci = mean_ci(x)
        q1, med, q3 = np.percentile(x, [25, 50, 75])
        rows.append(
            {
                "variable": c,
                "n": n,
                "missing": int(len(s) - n),
                "mean": sf(np.mean(x)),
                "ci_low": sf(ci[0]) if ci else None,
                "ci_high": sf(ci[1]) if ci else None,
                "median": sf(med),
                "mode": sf(modes.mode) if mode_count > 1 else None,
                "std": sf(sd),
                "variance": sf(sd**2) if sd is not None else None,
                "sem": sf(stats.sem(x)) if n > 1 else None,
                "min": sf(np.min(x)),
                "q1": sf(q1),
                "q3": sf(q3),
                "max": sf(np.max(x)),
                "iqr": sf(q3 - q1),
                "skewness": sf(stats.skew(x, bias=False)) if n > 2 and sd else None,
                "kurtosis": sf(stats.kurtosis(x, bias=False)) if n > 3 and sd else None,
                "cv": sf(sd / abs(np.mean(x))) if sd is not None and np.mean(x) != 0 else None,
            }
        )
        if n < 30:
            warnings.append(f"'{c}': only {n} observations — summary statistics are unstable.")
        if len(cols) <= 3:
            assumptions.append(normality_assumption(x, c))
    table = Table(
        name="summary",
        title="Descriptive statistics",
        columns=[TableColumn(key="variable", label="Variable")]
        + [
            TableColumn(key=k, label=lab, kind="integer" if k in ("n", "missing") else "number")
            for k, lab in [
                ("n", "N"),
                ("missing", "Missing"),
                ("mean", "Mean"),
                ("median", "Median"),
                ("mode", "Mode"),
                ("std", "Std. dev."),
                ("variance", "Variance"),
                ("min", "Min"),
                ("q1", "Q1"),
                ("q3", "Q3"),
                ("max", "Max"),
                ("iqr", "IQR"),
                ("skewness", "Skewness"),
                ("kurtosis", "Excess kurtosis"),
                ("sem", "Std. error"),
                ("ci_low", "95% CI low"),
                ("ci_high", "95% CI high"),
            ]
        ],
        rows=rows,
        note="Mode is shown only when at least one value repeats. Variance and standard deviation use n−1.",
    )
    for c in cols[:6]:
        charts.append(histogram_chart(arrays[c], c))
    if len(cols) == 1:
        charts.append(
            box_chart({cols[0]: arrays[cols[0]]}, title=f"Spread of {cols[0]}", x_label="", y_label=cols[0])
        )
    n_total = len(df)
    n_used = int(min(int(r["n"]) for r in rows))
    first = rows[0]
    metrics = (
        [
            Metric(key="n", label="Observations (N)", value=first["n"], primary=True),
            Metric(
                key="mean",
                label=f"Mean of {first['variable']}",
                value=first["mean"],
                ci=(first["ci_low"], first["ci_high"]) if first["ci_low"] is not None else None,
            ),
            Metric(key="median", label=f"Median of {first['variable']}", value=first["median"]),
            Metric(key="std", label=f"Std. deviation of {first['variable']}", value=first["std"]),
        ]
        if len(cols) == 1
        else [
            Metric(key="variables", label="Variables summarised", value=len(cols), primary=True),
            Metric(key="min_n", label="Smallest N across variables", value=n_used),
        ]
    )
    return AnalysisResult(
        type="descriptive",
        title=f"Descriptive statistics — {', '.join(cols[:3])}{'…' if len(cols) > 3 else ''}",
        variables={"columns": cols},
        n_total=n_total,
        n_used=n_used,
        metrics=metrics,
        tables=[table],
        charts=charts,
        assumptions=assumptions,
        warnings=warnings,
        decisions=[
            "Each variable is summarised on its own non-missing values (available-case), so N can differ between variables."
        ],
        methodology=(
            "Standard descriptive statistics computed with NumPy/SciPy on each variable's non-missing values. Sample variance and standard deviation use the "
            "n−1 denominator; the confidence interval for the mean uses the t distribution; skewness and kurtosis are the bias-corrected sample estimators "
            "(kurtosis is excess kurtosis). Normality is assessed with Shapiro–Wilk (n ≤ 5000) or D'Agostino–Pearson."
        ),
    )


SPEC = AnalysisSpec(
    type="descriptive",
    label="Descriptive statistics",
    description="Mean, median, spread, shape and distribution of one or more numeric variables.",
    roles=[
        VarSpec(
            "columns",
            "Variables",
            ["numeric_continuous", "numeric_discrete", "binary"],
            multiple=True,
            help="Numeric variables to summarise.",
        )
    ],
    config_model=DescriptiveConfig,
    run=run,
)

__all__ = ["SPEC", "Assumption"]
