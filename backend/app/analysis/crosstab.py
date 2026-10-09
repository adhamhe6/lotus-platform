from __future__ import annotations

import numpy as np
import pandas as pd
from pydantic import BaseModel
from scipy import stats

from app.analysis.base import (
    AnalysisResult,
    AnalysisSpec,
    Assumption,
    Metric,
    Table,
    TableColumn,
    VarSpec,
    drop_note,
    effect_label,
    require_grouping,
    require_n,
    sf,
)
from app.visualization.charts import heatmap_chart, stacked_bar_chart


class CrosstabConfig(BaseModel):
    row: str
    column: str


def run(df: pd.DataFrame, cfg: CrosstabConfig) -> AnalysisResult:
    if cfg.row == cfg.column:
        from app.core.exceptions import AnalysisConfigurationError

        raise AnalysisConfigurationError("Choose two different variables.")
    a = require_grouping(df, cfg.row, "row variable")
    b = require_grouping(df, cfg.column, "column variable")
    n_total = len(df)
    pair = pd.DataFrame({"a": a, "b": b}).dropna()
    n = len(pair)
    require_n(n, 10, "paired observations")
    ct = pd.crosstab(pair["a"], pair["b"])
    if ct.shape[0] < 2 or ct.shape[1] < 2:
        from app.core.exceptions import AnalysisConfigurationError

        raise AnalysisConfigurationError(
            "After removing missing values one of the variables has fewer than two levels."
        )
    obs = ct.to_numpy()
    chi2, p, dof, exp = stats.chi2_contingency(obs)
    k = min(obs.shape) - 1
    v = float(np.sqrt(chi2 / (n * k))) if k > 0 else 0.0
    # bias-corrected Cramér's V (Bergsma 2013)
    phi2 = max(0.0, chi2 / n - (obs.shape[0] - 1) * (obs.shape[1] - 1) / (n - 1))
    rc = obs.shape[0] - (obs.shape[0] - 1) ** 2 / (n - 1)
    cc = obs.shape[1] - (obs.shape[1] - 1) ** 2 / (n - 1)
    v_corr = float(np.sqrt(phi2 / min(rc - 1, cc - 1))) if min(rc - 1, cc - 1) > 0 else 0.0
    low_exp = float((exp < 5).mean())
    warnings, decisions = [], []
    assumptions = [
        Assumption(
            name="Expected counts ≥ 5",
            status="met" if low_exp <= 0.2 and exp.min() >= 1 else "violated",
            detail=f"{low_exp:.0%} of cells have expected count < 5 (minimum {exp.min():.2f}). The χ² approximation is reliable when ≤ 20% of cells are below 5 and none below 1.",
        )
    ]
    test_p = float(p)
    fisher_odds = None
    if obs.shape == (2, 2) and exp.min() < 5:
        odds, fp = stats.fisher_exact(obs)
        test_p, fisher_odds = float(fp), float(odds)
        decisions.append("A 2×2 table with an expected count below 5: Fisher's exact test replaces χ².")
    elif assumptions[0].status == "violated":
        warnings.append(
            "Several expected counts are small; the χ² p-value may be unreliable. Merge sparse categories or collect more data."
        )
    if note := drop_note(n_total, n):
        warnings.append(note)
    row_pct = ct.div(ct.sum(axis=1), axis=0) * 100
    resid = (obs - exp) / np.sqrt(exp)
    rows = []
    for i, ri in enumerate(ct.index):
        for j, cj in enumerate(ct.columns):
            rows.append(
                {
                    "row": str(ri),
                    "column": str(cj),
                    "count": int(obs[i, j]),
                    "expected": float(exp[i, j]),
                    "row_percent": float(row_pct.iloc[i, j]),
                    "std_residual": float(resid[i, j]),
                }
            )
    cols_labels = [str(c) for c in ct.columns]
    table = Table(
        name="cells",
        title="Contingency table (cells)",
        columns=[
            TableColumn(key="row", label=cfg.row),
            TableColumn(key="column", label=cfg.column),
            TableColumn(key="count", label="Observed", kind="integer"),
            TableColumn(key="expected", label="Expected", kind="number"),
            TableColumn(key="row_percent", label="Row %", kind="percent"),
            TableColumn(key="std_residual", label="Std. residual", kind="number"),
        ],
        rows=rows,
        note="Standardised residuals beyond ±2 indicate cells that depart notably from independence.",
    )
    charts = [
        stacked_bar_chart(
            [str(i) for i in ct.index],
            {c: [float(row_pct.iloc[i][c]) for i in range(len(ct.index))] for c in ct.columns},
            title=f"{cfg.column} within each {cfg.row} (row %)",
            x_label=cfg.row,
            y_label="Share of row (%)",
        ),
        heatmap_chart(
            [str(i) for i in ct.index],
            cols_labels,
            [[float(x) for x in r] for r in resid],
            title="Standardised residuals",
            domain=(-4, 4),
            diverging=True,
            value_label="Std. residual",
            x_label=cfg.column,
            y_label=cfg.row,
        ),
    ]
    metrics = [
        Metric(key="chi2", label="χ² statistic", value=sf(chi2), primary=True),
        Metric(key="dof", label="Degrees of freedom", value=int(dof)),
        Metric(
            key="p_value",
            label=f"p-value ({'Fisher exact' if fisher_odds is not None else 'χ²'})",
            value=sf(test_p),
        ),
        Metric(
            key="cramers_v",
            label="Cramér's V (bias-corrected)",
            value=sf(v_corr),
            note=f"{effect_label('cramers_v', v_corr)} effect (uncorrected V = {v:.3f})",
        ),
        Metric(key="n", label="Observations (n)", value=n),
    ]
    if fisher_odds is not None:
        metrics.append(Metric(key="odds_ratio", label="Odds ratio (sample)", value=sf(fisher_odds)))
    return AnalysisResult(
        type="crosstab",
        title=f"Cross-tabulation — {cfg.row} × {cfg.column}",
        variables={"row": cfg.row, "column": cfg.column},
        n_total=n_total,
        n_used=n,
        metrics=metrics,
        tables=[table],
        charts=charts,
        assumptions=assumptions,
        warnings=warnings,
        decisions=decisions + ["Rows with a missing value in either variable are excluded."],
        methodology="Observed counts cross-tabulated; independence tested with Pearson's χ² (Yates continuity correction for 2×2), or Fisher's exact test for 2×2 tables with small expected counts. "
        "Effect size is Cramér's V with the Bergsma bias correction. Association is not causation.",
    )


SPEC = AnalysisSpec(
    type="crosstab",
    label="Cross-tabulation (χ²)",
    description="Test whether two categorical variables are associated.",
    roles=[
        VarSpec("row", "Row variable", ["categorical", "boolean", "binary", "numeric_discrete"]),
        VarSpec("column", "Column variable", ["categorical", "boolean", "binary", "numeric_discrete"]),
    ],
    config_model=CrosstabConfig,
    run=run,
)
