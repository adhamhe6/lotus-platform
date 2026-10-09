from __future__ import annotations

from itertools import combinations
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from scipy import stats

from app.analysis.base import (
    AnalysisResult, AnalysisSpec, Assumption, Metric, Table, TableColumn, VarSpec, correlation_strength, drop_note, fisher_ci, holm, normality_assumption,
    require_numeric, sf,
)
from app.core.exceptions import InsufficientDataError, ZeroVarianceError
from app.visualization.charts import heatmap_chart, scatter_chart


class CorrelationConfig(BaseModel):
    variables: list[str] = Field(min_length=2, max_length=25)
    method: Literal["pearson", "spearman"] = "pearson"


def _pair(x: np.ndarray, y: np.ndarray, method: str) -> dict:
    n = len(x)
    if n < 3:
        raise InsufficientDataError(f"Only {n} paired observations; at least 3 are required for a correlation (30+ recommended).")
    if np.ptp(x) == 0 or np.ptp(y) == 0:
        raise ZeroVarianceError("One of the variables is constant, so the correlation is undefined.")
    if method == "pearson":
        r, p = stats.pearsonr(x, y)
        ci = fisher_ci(float(r), n)
    else:
        r, p = stats.spearmanr(x, y)
        ci = fisher_ci(float(r), n, se_factor=float(np.sqrt(1.0 + 0.5 * float(r) ** 2)))  # Bonett–Wright
    return {"n": n, "r": float(r), "p": float(p), "ci": ci}


def run(df: pd.DataFrame, cfg: CorrelationConfig) -> AnalysisResult:
    vars_ = list(dict.fromkeys(cfg.variables))
    if len(vars_) < 2:
        raise InsufficientDataError("Select at least two different variables.")
    data = {v: require_numeric(df, v) for v in vars_}
    frame = pd.DataFrame(data)
    n_total = len(frame)
    warnings: list[str] = []
    method_name = cfg.method.capitalize()
    if len(vars_) == 2:
        sub = frame.dropna()
        n_used = len(sub)
        x, y = sub[vars_[0]].to_numpy(), sub[vars_[1]].to_numpy()
        res = _pair(x, y, cfg.method)
        r, p, ci, n = res["r"], res["p"], res["ci"], res["n"]
        slope, intercept = np.polyfit(x, y, 1)
        sr = stats.spearmanr(x, y)[0] if cfg.method == "pearson" else r
        assumptions = [normality_assumption(x, vars_[0]), normality_assumption(y, vars_[1])] if cfg.method == "pearson" else []
        z = np.abs(stats.zscore(x)) > 3, np.abs(stats.zscore(y)) > 3
        n_out = int((z[0] | z[1]).sum())
        if cfg.method == "pearson":
            assumptions.append(Assumption(name="Linearity / influential points", status="met" if abs(sr - r) < 0.15 and n_out == 0 else "violated",
                                          detail=f"Spearman ρ = {sr:.3f} vs Pearson r = {r:.3f}; {n_out} observation(s) lie more than 3 SD from the mean on either variable."
                                                 " A large gap or several extremes suggests a non-linear relationship or outlier influence."))
        if n < 30:
            warnings.append(f"Small sample (n = {n}); the confidence interval is wide and the estimate unstable.")
        if (note := drop_note(n_total, n_used)):
            warnings.append(note)
        metrics = [
            Metric(key="r", label=f"{method_name} {'r' if cfg.method == 'pearson' else 'ρ'}", value=sf(r), ci=(ci[0], ci[1]) if ci else None, primary=True),
            Metric(key="p_value", label="p-value (two-sided)", value=sf(p)), Metric(key="n", label="Paired observations (n)", value=n),
            Metric(key="r_squared", label="r² (shared variance)", value=sf(r**2), note="Proportion of rank/linear variance shared; not causal."),
            Metric(key="strength", label="Strength (Cohen's guide)", value=correlation_strength(r)),
            Metric(key="direction", label="Direction", value="positive" if r > 0 else "negative" if r < 0 else "none"),
        ]
        if cfg.method == "pearson":
            metrics += [Metric(key="slope", label=f"Slope ({vars_[1]} per unit {vars_[0]})", value=sf(slope)), Metric(key="intercept", label="Intercept", value=sf(intercept))]
        charts = [scatter_chart(x, y, vars_[0], vars_[1], line=(float(slope), float(intercept)) if cfg.method == "pearson" else None,
                                subtitle=f"{method_name} {'r' if cfg.method == 'pearson' else 'ρ'} = {r:.3f}, n = {n}")]
        tables = []
        out = AnalysisResult(type="correlation", title=f"Correlation — {vars_[0]} × {vars_[1]}", variables={"variables": vars_, "method": cfg.method},
                             n_total=n_total, n_used=n_used, metrics=metrics, tables=tables, charts=charts, assumptions=assumptions, warnings=warnings)
    else:
        rows, matrix, ps = [], np.full((len(vars_), len(vars_)), np.nan), []
        pair_n = []
        for (i, a), (j, b) in combinations(list(enumerate(vars_)), 2):
            sub = frame[[a, b]].dropna()
            try:
                res = _pair(sub[a].to_numpy(), sub[b].to_numpy(), cfg.method)
            except (InsufficientDataError, ZeroVarianceError) as e:
                warnings.append(f"{a} × {b}: {e.message}")
                rows.append({"a": a, "b": b, "n": len(sub), "r": None, "p": None, "p_adj": None, "ci_low": None, "ci_high": None, "strength": "undefined"})
                continue
            matrix[i, j] = matrix[j, i] = res["r"]
            ps.append(res["p"])
            pair_n.append(res["n"])
            rows.append({"a": a, "b": b, "n": res["n"], "r": res["r"], "p": res["p"], "p_adj": None, "ci_low": res["ci"][0] if res["ci"] else None,
                         "ci_high": res["ci"][1] if res["ci"] else None, "strength": correlation_strength(res["r"])})
        adj = holm(ps)
        it = iter(adj)
        for row in rows:
            if row["p"] is not None:
                row["p_adj"] = next(it)
        np.fill_diagonal(matrix, 1.0)
        valid_rows = [r for r in rows if r["r"] is not None]
        if not valid_rows:
            raise InsufficientDataError("No variable pair has enough usable observations.")
        valid_rows.sort(key=lambda r: -abs(r["r"]))
        rows = valid_rows + [r for r in rows if r["r"] is None]
        n_used = int(frame.dropna().shape[0])
        if (note := drop_note(n_total, n_used)):
            warnings.append("Correlations use pairwise-complete observations (n varies per pair). " + note.replace("were excluded", "would be excluded under listwise deletion"))
        top = valid_rows[0]
        metrics = [Metric(key="pairs", label="Variable pairs", value=len(rows), primary=True),
                   Metric(key="strongest_r", label=f"Strongest: {top['a']} × {top['b']}", value=sf(top["r"])),
                   Metric(key="strongest_p_adj", label="Its Holm-adjusted p", value=sf(top["p_adj"])),
                   Metric(key="significant_pairs", label="Pairs with adjusted p < 0.05", value=sum(1 for r in valid_rows if r["p_adj"] is not None and r["p_adj"] < 0.05))]
        charts = [heatmap_chart(vars_, vars_, [[sf(matrix[i, j]) for j in range(len(vars_))] for i in range(len(vars_))], title=f"{method_name} correlation matrix",
                                domain=(-1, 1), diverging=True, value_label=f"{method_name} correlation")]
        tables = [Table(name="pairs", title="Pairwise correlations (strongest first)", columns=[
            TableColumn(key="a", label="Variable A"), TableColumn(key="b", label="Variable B"), TableColumn(key="n", label="n", kind="integer"),
            TableColumn(key="r", label="r" if cfg.method == "pearson" else "ρ", kind="number"), TableColumn(key="ci_low", label="95% CI low", kind="number"),
            TableColumn(key="ci_high", label="95% CI high", kind="number"), TableColumn(key="p", label="p", kind="p_value"),
            TableColumn(key="p_adj", label="Holm-adj. p", kind="p_value"), TableColumn(key="strength", label="Strength")], rows=rows,
            note="p-values are adjusted for the number of pairs tested (Holm–Bonferroni) to limit false discoveries.")]
        top_pair = valid_rows[0]
        sub = frame[[top_pair["a"], top_pair["b"]]].dropna()
        slope, intercept = np.polyfit(sub[top_pair["a"]], sub[top_pair["b"]], 1)
        charts.append(scatter_chart(sub[top_pair["a"]].to_numpy(), sub[top_pair["b"]].to_numpy(), top_pair["a"], top_pair["b"],
                                    line=(float(slope), float(intercept)) if cfg.method == "pearson" else None, title=f"Strongest pair: {top_pair['a']} × {top_pair['b']}"))
        assumptions = [Assumption(name="Multiple comparisons", status="met", detail=f"{len(ps)} tests; Holm-adjusted p-values are reported.")]
        out = AnalysisResult(type="correlation", title=f"Correlation matrix — {len(vars_)} variables", variables={"variables": vars_, "method": cfg.method},
                             n_total=n_total, n_used=n_used, metrics=metrics, tables=tables, charts=charts, assumptions=assumptions, warnings=warnings)
    out.decisions = [
        f"{method_name} correlation was used" + (" (linear association, assumes roughly bivariate-normal data for inference)." if cfg.method == "pearson"
                                                  else " (rank-based; robust to outliers and monotone non-linear relationships)."),
        "Rows with missing values in the pair are excluded for that pair." if len(vars_) > 2 else "Rows with a missing value in either variable were excluded.",
    ]
    out.methodology = (
        "Pearson's product-moment correlation (or Spearman's rank correlation) with a two-sided test of H0: ρ = 0. Confidence intervals use the Fisher z-transformation "
        "(Spearman: Bonett–Wright variance). Strength labels follow Cohen's conventions (|r| <0.1 negligible, <0.3 weak, <0.5 moderate, otherwise strong). "
        "Correlation does not imply causation; r² is shared variance, not explanatory power." + (" For several variables, p-values are Holm-adjusted across all pairs." if len(vars_) > 2 else "")
    )
    return out


SPEC = AnalysisSpec(
    type="correlation", label="Correlation", description="Strength and direction of association between numeric variables (pair or matrix).",
    roles=[VarSpec("variables", "Numeric variables", ["numeric_continuous", "numeric_discrete", "binary"], multiple=True, min_count=2,
                   help="Pick two for a scatter plot with fit line, or several for a correlation matrix.")],
    config_model=CorrelationConfig, run=run,
    parameters=[{"key": "method", "label": "Method", "type": "select", "default": "pearson",
                 "options": [{"value": "pearson", "label": "Pearson (linear)"}, {"value": "spearman", "label": "Spearman (rank / monotone)"}]}],
)
