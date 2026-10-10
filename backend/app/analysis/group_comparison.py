from __future__ import annotations

from itertools import combinations
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel
from scipy import stats
from statsmodels.stats.oneway import anova_oneway

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
    holm,
    mean_ci,
    normality_assumption,
    require_grouping,
    require_n,
    require_numeric,
    sf,
)
from app.core.exceptions import AnalysisConfigurationError
from app.visualization.charts import bar_chart, box_chart

TEST_LABELS = {
    "welch_t": "Welch's t-test",
    "mann_whitney": "Mann–Whitney U test",
    "welch_anova": "Welch's one-way ANOVA",
    "kruskal": "Kruskal–Wallis H test",
}


class GroupComparisonConfig(BaseModel):
    outcome: str
    group: str
    test: Literal["auto", "welch_t", "mann_whitney", "anova", "kruskal"] = "auto"
    alpha: float = 0.05


def hedges_g(a: np.ndarray, b: np.ndarray) -> tuple[float, tuple[float, float] | None]:
    n1, n2 = len(a), len(b)
    sp = np.sqrt(((n1 - 1) * np.var(a, ddof=1) + (n2 - 1) * np.var(b, ddof=1)) / (n1 + n2 - 2))
    if sp == 0:
        return float("nan"), None
    d = (np.mean(a) - np.mean(b)) / sp
    j = 1 - 3 / (4 * (n1 + n2) - 9)
    g = d * j
    se = np.sqrt((n1 + n2) / (n1 * n2) + g**2 / (2 * (n1 + n2)))
    return float(g), (float(g - 1.96 * se), float(g + 1.96 * se))


def run(df: pd.DataFrame, cfg: GroupComparisonConfig) -> AnalysisResult:
    y = require_numeric(df, cfg.outcome, "outcome")
    g = require_grouping(df, cfg.group, "grouping variable")
    n_total = len(df)
    frame = pd.DataFrame({"y": y, "g": g}).dropna()
    # groups with < 2 observations cannot contribute variance
    counts = frame["g"].value_counts()
    small = counts[counts < 2].index.tolist()
    warnings, decisions = [], []
    if small:
        warnings.append(
            f"Group(s) {', '.join(map(str, small))} have fewer than 2 observations and were excluded."
        )
        frame = frame[~frame["g"].isin(small)]
    n_used = len(frame)
    levels = sorted(frame["g"].unique(), key=lambda v: (-int((frame["g"] == v).sum()), str(v)))
    k = len(levels)
    if k < 2:
        raise AnalysisConfigurationError("At least two groups with two or more observations each are needed.")
    require_n(n_used, 6, "observations")
    groups = {str(lv): frame.loc[frame["g"] == lv, "y"].to_numpy() for lv in levels}
    if note := drop_note(n_total, n_used):
        warnings.append(note)
    if np.ptp(frame["y"].to_numpy()) == 0:
        raise AnalysisConfigurationError(
            f"'{cfg.outcome}' is constant across all rows; there is nothing to compare."
        )
    min_n = min(len(v) for v in groups.values())
    if min_n < 5:
        warnings.append(f"The smallest group has only {min_n} observations; results are fragile.")

    # ---- assumptions
    assumptions = []
    normal_ok = []
    for name, arr in groups.items():
        a = normality_assumption(arr, f"{cfg.outcome} in '{name}'") if k <= 6 else None
        if a is not None:
            assumptions.append(a)
        normal_ok.append(
            len(arr) >= 30
            or (a is not None and a.status in ("met", "unknown"))
            or (a is None and len(arr) >= 15)
        )
    if all(np.ptp(v) > 0 for v in groups.values()):
        lev_stat, lev_p = stats.levene(*groups.values(), center="median")
        assumptions.append(
            Assumption(
                name="Homogeneity of variance",
                status="met" if lev_p >= 0.05 else "violated",
                test="Brown–Forsythe (Levene, median-centred)",
                statistic=float(lev_stat),
                p_value=float(lev_p),
                detail=f"p = {lev_p:.3g}. "
                + (
                    "Variances look similar."
                    if lev_p >= 0.05
                    else "Variances differ — Welch-type tests (used here) remain valid."
                ),
            )
        )
    assumptions.append(
        Assumption(
            name="Independent observations",
            status="unknown",
            detail="Cannot be verified from the data: each row must be an independent unit (not repeated measures).",
        )
    )

    # ---- choose test
    chosen = cfg.test
    if chosen == "auto":
        parametric = all(normal_ok)
        chosen = (
            ("welch_t" if k == 2 else "welch_anova")
            if parametric
            else ("mann_whitney" if k == 2 else "kruskal")
        )
        decisions.append(
            f"Automatic test selection: {'normality is acceptable (or groups are large, n ≥ 30)' if parametric else 'normality is violated in at least one small group'} "
            f"→ {TEST_LABELS[chosen]}."
        )
    else:
        chosen = {"anova": "welch_anova"}.get(chosen, chosen)
        if (chosen in ("welch_t", "mann_whitney")) and k != 2:
            raise AnalysisConfigurationError(
                f"{TEST_LABELS[chosen]} compares exactly two groups but '{cfg.group}' has {k}. Use ANOVA or Kruskal–Wallis."
            )
        if chosen in ("welch_anova", "kruskal") and k == 2:
            decisions.append("Two groups: the multi-group test is equivalent to its two-group counterpart.")
        decisions.append(f"Test chosen by the analyst: {TEST_LABELS[chosen]}.")
        if chosen in ("welch_t", "welch_anova") and not all(normal_ok):
            warnings.append("Normality looks violated in a small group; a rank-based test would be safer.")

    arrays = list(groups.values())
    names = list(groups.keys())
    metrics: list[Metric] = []
    n_all = n_used
    if chosen == "welch_t":
        a, b = arrays
        t = stats.ttest_ind(a, b, equal_var=False)
        ci = t.confidence_interval(0.95)
        diff = float(np.mean(a) - np.mean(b))
        gval, gci = hedges_g(a, b)
        stat, pval, df_ = float(t.statistic), float(t.pvalue), float(t.df)
        metrics = [
            Metric(key="statistic", label="Welch t", value=sf(stat), primary=True),
            Metric(key="df", label="Degrees of freedom", value=sf(df_)),
            Metric(key="p_value", label="p-value (two-sided)", value=sf(pval)),
            Metric(
                key="mean_difference",
                label=f"Mean difference ({names[0]} − {names[1]})",
                value=sf(diff),
                ci=(float(ci.low), float(ci.high)),
            ),
            Metric(
                key="effect_size",
                label="Hedges' g",
                value=sf(gval),
                ci=gci,
                note=effect_label("g", gval) + " effect" if gval == gval else None,
            ),
        ]
    elif chosen == "mann_whitney":
        a, b = arrays
        u = stats.mannwhitneyu(a, b, alternative="two-sided")
        rb = 1 - 2 * float(u.statistic) / (
            len(a) * len(b)
        )  # rank-biserial for group a relative to b: positive if a tends to be larger
        rb = -rb
        cles = float(u.statistic) / (len(a) * len(b))
        stat, pval = float(u.statistic), float(u.pvalue)
        metrics = [
            Metric(key="statistic", label="Mann–Whitney U", value=sf(stat), primary=True),
            Metric(key="p_value", label="p-value (two-sided)", value=sf(pval)),
            Metric(
                key="effect_size",
                label="Rank-biserial r",
                value=sf(rb),
                note=effect_label("rank_biserial", rb) + f" effect; positive = {names[0]} tends to be larger",
            ),
            Metric(
                key="prob_superiority",
                label=f"P({names[0]} > {names[1]})",
                value=sf(cles),
                note="Probability that a random member of the first group exceeds one of the second (ties count ½).",
            ),
        ]
    elif chosen == "welch_anova":
        res = anova_oneway(
            np.concatenate(arrays),
            groups=np.concatenate([[i] * len(a) for i, a in enumerate(arrays)]),
            use_var="unequal",
            welch_correction=True,
        )
        stat, pval = float(res.statistic), float(res.pvalue)
        grand = np.concatenate(arrays)
        ssb = sum(len(a) * (np.mean(a) - np.mean(grand)) ** 2 for a in arrays)
        sst = float(((grand - grand.mean()) ** 2).sum())
        eta2 = float(ssb / sst) if sst else float("nan")
        dfb = k - 1
        dfw = n_all - k
        omega2 = (
            float(max(0.0, (ssb - dfb * (sst - ssb) / dfw) / (sst + (sst - ssb) / dfw)))
            if sst
            else float("nan")
        )
        metrics = [
            Metric(key="statistic", label="Welch F", value=sf(stat), primary=True),
            Metric(key="df", label="df (between, within)", value=f"{res.df_num:.0f}, {res.df_denom:.1f}"),
            Metric(key="p_value", label="p-value", value=sf(pval)),
            Metric(
                key="effect_size",
                label="η² (eta squared)",
                value=sf(eta2),
                note=effect_label("eta2", eta2) + " effect",
            ),
            Metric(key="omega_squared", label="ω² (less biased)", value=sf(omega2)),
        ]
    else:
        h = stats.kruskal(*arrays)
        eps2 = float(h.statistic / (n_all - 1))
        stat, pval = float(h.statistic), float(h.pvalue)
        metrics = [
            Metric(key="statistic", label="Kruskal–Wallis H", value=sf(stat), primary=True),
            Metric(key="df", label="Degrees of freedom", value=k - 1),
            Metric(key="p_value", label="p-value", value=sf(pval)),
            Metric(
                key="effect_size",
                label="ε² (epsilon squared)",
                value=sf(eps2),
                note=effect_label("epsilon2", eps2) + " effect",
            ),
        ]
    metrics.append(Metric(key="n", label="Observations (n)", value=n_all))
    metrics.append(
        Metric(key="significant", label=f"Significant at α = {cfg.alpha}", value=bool(pval < cfg.alpha))
    )

    # ---- tables
    gs_rows = []
    for name, arr in groups.items():
        ci = mean_ci(arr)
        gs_rows.append(
            {
                "group": name,
                "n": len(arr),
                "mean": sf(np.mean(arr)),
                "std": sf(np.std(arr, ddof=1)),
                "median": sf(np.median(arr)),
                "sem": sf(stats.sem(arr)),
                "ci_low": sf(ci[0]) if ci else None,
                "ci_high": sf(ci[1]) if ci else None,
                "min": sf(arr.min()),
                "max": sf(arr.max()),
            }
        )
    overall = frame["y"].to_numpy()
    gs_rows.append(
        {
            "group": "All",
            "n": len(overall),
            "mean": sf(np.mean(overall)),
            "std": sf(np.std(overall, ddof=1)),
            "median": sf(np.median(overall)),
            "sem": sf(stats.sem(overall)),
            "ci_low": None,
            "ci_high": None,
            "min": sf(overall.min()),
            "max": sf(overall.max()),
        }
    )
    tables = [
        Table(
            name="groups",
            title=f"{cfg.outcome} by {cfg.group}",
            columns=[
                TableColumn(key="group", label=cfg.group),
                TableColumn(key="n", label="n", kind="integer"),
                TableColumn(key="mean", label="Mean", kind="number"),
                TableColumn(key="std", label="Std. dev.", kind="number"),
                TableColumn(key="median", label="Median", kind="number"),
                TableColumn(key="sem", label="Std. error", kind="number"),
                TableColumn(key="ci_low", label="95% CI low", kind="number"),
                TableColumn(key="ci_high", label="95% CI high", kind="number"),
                TableColumn(key="min", label="Min", kind="number"),
                TableColumn(key="max", label="Max", kind="number"),
            ],
            rows=gs_rows,
        )
    ]
    if k > 2:
        pw, praw = [], []
        for (na, a), (nb, b) in combinations(groups.items(), 2):
            if chosen == "kruskal":
                pv = float(stats.mannwhitneyu(a, b, alternative="two-sided").pvalue)
                eff = -(1 - 2 * float(stats.mannwhitneyu(a, b).statistic) / (len(a) * len(b)))
            else:
                pv = float(stats.ttest_ind(a, b, equal_var=False).pvalue)
                eff = hedges_g(a, b)[0]
            praw.append(pv)
            pw.append(
                {
                    "a": na,
                    "b": nb,
                    "mean_diff": sf(np.mean(a) - np.mean(b)),
                    "p": pv,
                    "p_adj": None,
                    "effect": sf(eff),
                }
            )
            if len(pw) >= 105:
                break
        for row, adj in zip(pw, holm(praw), strict=True):
            row["p_adj"] = adj
        pw.sort(key=lambda r: r["p_adj"])
        tables.append(
            Table(
                name="pairwise",
                title="Pairwise comparisons (Holm-adjusted)",
                columns=[
                    TableColumn(key="a", label="Group A"),
                    TableColumn(key="b", label="Group B"),
                    TableColumn(key="mean_diff", label="Mean diff (A−B)", kind="number"),
                    TableColumn(key="effect", label="Effect size", kind="number"),
                    TableColumn(key="p", label="p", kind="p_value"),
                    TableColumn(key="p_adj", label="Holm-adj. p", kind="p_value"),
                ],
                rows=pw,
                note="Post-hoc: pairwise "
                + ("Mann–Whitney" if chosen == "kruskal" else "Welch t")
                + " tests with Holm–Bonferroni correction. Effect size is Hedges' g (rank-biserial r for Kruskal). "
                "Interpret only if the omnibus test is significant.",
            )
        )
    means_sorted = sorted(gs_rows[:-1], key=lambda r: -r["mean"])
    charts = [
        box_chart(groups, title=f"{cfg.outcome} by {cfg.group}", x_label=cfg.group, y_label=cfg.outcome),
        bar_chart(
            [r["group"] for r in means_sorted],
            [r["mean"] for r in means_sorted],
            title=f"Mean {cfg.outcome} by {cfg.group} (95% CI)",
            x_label=cfg.group,
            y_label=f"Mean {cfg.outcome}",
            errors=[
                (r["ci_low"], r["ci_high"]) if r["ci_low"] is not None else (r["mean"], r["mean"])
                for r in means_sorted
            ],
            counts=[r["n"] for r in means_sorted],
            subtitle="Error bars: 95% confidence interval of the mean",
        ),
    ]
    return AnalysisResult(
        type="group_comparison",
        title=f"Group comparison — {cfg.outcome} by {cfg.group}",
        variables={"outcome": cfg.outcome, "group": cfg.group, "test": chosen},
        n_total=n_total,
        n_used=n_used,
        metrics=metrics,
        tables=tables,
        charts=charts,
        assumptions=assumptions,
        warnings=warnings,
        decisions=decisions,
        methodology=(
            "Compares a numeric outcome across the levels of a categorical variable. Two groups: Welch's t-test (unequal variances) with Hedges' g, or the Mann–Whitney U test with the "
            "rank-biserial correlation. Three or more groups: Welch's ANOVA (η², ω²) or the Kruskal–Wallis test (ε²), followed by Holm-adjusted pairwise tests. 'Auto' uses parametric tests "
            "when every group is large (n ≥ 30) or not clearly non-normal, otherwise rank-based tests. Groups with fewer than two observations are dropped. "
            "A significant difference does not establish a causal effect."
        ),
    )


SPEC = AnalysisSpec(
    type="group_comparison",
    label="Group comparison",
    description="Compare a numeric outcome across groups (t-test / ANOVA / non-parametric alternatives).",
    roles=[
        VarSpec("outcome", "Outcome (numeric)", ["numeric_continuous", "numeric_discrete", "binary"]),
        VarSpec("group", "Grouping variable", ["categorical", "boolean", "binary", "numeric_discrete"]),
    ],
    config_model=GroupComparisonConfig,
    run=run,
    parameters=[
        {
            "key": "test",
            "label": "Test",
            "type": "select",
            "default": "auto",
            "options": [
                {"value": "auto", "label": "Automatic (recommended)"},
                {"value": "welch_t", "label": "Welch's t-test (2 groups)"},
                {"value": "mann_whitney", "label": "Mann–Whitney U (2 groups)"},
                {"value": "anova", "label": "Welch's ANOVA (3+ groups)"},
                {"value": "kruskal", "label": "Kruskal–Wallis (3+ groups)"},
            ],
        }
    ],
)
