"""Mixed-methods engine (pure): joins qualitative membership (which respondents voiced a theme/code) to quantitative variables.

Design rules
* Universe = respondents who actually wrote a response. Not commenting is not evidence of not holding a view.
* Every comparison is *with the item* vs *without the item* among respondents; effect sizes with CIs; Holm correction across all tests.
* Statements are generated only when n, adjusted p and effect size clear explicit thresholds; wording is associational, never causal.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from app.analysis.base import effect_label, holm, sf
from app.analysis.group_comparison import hedges_g

MIN_GROUP = 8
ALPHA = 0.05
MIN_ABS_G = 0.2


@dataclass
class Item:
    id: str
    name: str
    kind: str  # theme | code
    rows: set[int]
    quotes: list[str] = field(default_factory=list)


def _compare(a: np.ndarray, b: np.ndarray) -> dict[str, Any]:
    """With vs without. Welch t when both groups are large (n ≥ 30) or roughly normal; otherwise Mann–Whitney."""
    na, nb = len(a), len(b)
    out: dict[str, Any] = {
        "n_with": na,
        "n_without": nb,
        "mean_with": sf(a.mean()) if na else None,
        "mean_without": sf(b.mean()) if nb else None,
        "median_with": sf(np.median(a)) if na else None,
        "median_without": sf(np.median(b)) if nb else None,
    }
    if na < MIN_GROUP or nb < MIN_GROUP:
        return {
            **out,
            "status": "insufficient_n",
            "test": None,
            "p": None,
            "diff": None,
            "effect": None,
            "ci": None,
        }
    if np.ptp(np.concatenate([a, b])) == 0:
        return {**out, "status": "constant", "test": None, "p": None, "diff": 0.0, "effect": None, "ci": None}
    normal_ok = (na >= 30 and nb >= 30) or all(
        stats.shapiro(x).pvalue >= 0.05 for x in (a, b) if np.ptp(x) > 0
    )
    diff = float(a.mean() - b.mean())
    g, gci = hedges_g(a, b)
    if normal_ok:
        t = stats.ttest_ind(a, b, equal_var=False)
        ci = t.confidence_interval(0.95)
        return {
            **out,
            "test": "Welch t-test",
            "p": float(t.pvalue),
            "diff": diff,
            "ci": [float(ci.low), float(ci.high)],
            "effect": sf(g),
            "effect_ci": gci,
            "effect_kind": "Hedges' g",
        }
    u = stats.mannwhitneyu(a, b, alternative="two-sided")
    rb = 2 * float(u.statistic) / (na * nb) - 1
    return {
        **out,
        "test": "Mann–Whitney U",
        "p": float(u.pvalue),
        "diff": diff,
        "ci": None,
        "effect": sf(g),
        "effect_ci": gci,
        "effect_kind": "Hedges' g",
        "rank_biserial": sf(rb),
    }


def _qualify(p_adj: float, effect: float, n_with: int) -> str:
    a = abs(effect)
    if p_adj < 0.001 and a >= 0.5 and n_with >= 30:
        return "strong"
    if p_adj < 0.01 and a >= 0.3:
        return "moderate"
    return "tentative"


def _fmt(x: float | None, d: int = 2) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def _fp(p: float | None) -> str:
    return "n/a" if p is None else "< 0.001" if p < 0.001 else f"= {p:.3f}"


def run_mixed(
    frame: pd.DataFrame,
    respondents: set[int],
    items: list[Item],
    outcome: str,
    compare: list[str],
    group: str | None = None,
) -> dict[str, Any]:
    """``frame`` is indexed by row position; columns include the outcome, comparison columns and optional group column."""
    resp = sorted(r for r in respondents if r in frame.index)
    if len(resp) < 2 * MIN_GROUP:
        raise ValueError("insufficient respondents")
    yfull = pd.to_numeric(frame[outcome], errors="coerce").astype("float64")
    warnings: list[str] = []
    n_resp = len(resp)
    n_valid = int(yfull.loc[resp].notna().sum())
    if n_valid < n_resp:
        warnings.append(
            f"{n_resp - n_valid} of {n_resp} respondents have no value for '{outcome}' and are excluded from outcome comparisons."
        )
    out_items, all_p = [], []

    def collect(item: Item, col: str) -> dict[str, Any]:
        x = pd.to_numeric(frame[col], errors="coerce").astype("float64")
        has = [r for r in resp if r in item.rows and not math.isnan(x.get(r, np.nan))]
        no = [r for r in resp if r not in item.rows and not math.isnan(x.get(r, np.nan))]
        return _compare(x.loc[has].to_numpy(), x.loc[no].to_numpy())

    for it in items:
        voiced = [r for r in resp if r in it.rows]
        entry: dict[str, Any] = {
            "id": it.id,
            "name": it.name,
            "kind": it.kind,
            "n_respondents": len(voiced),
            "prevalence_pct": round(len(voiced) / n_resp * 100, 2),
            "quotes": it.quotes[:2],
            "outcome": {"column": outcome, **collect(it, outcome)},
            "comparisons": [],
            "by_group": None,
        }
        all_p.append(entry["outcome"])
        for col in compare:
            c = {"column": col, **collect(it, col)}
            entry["comparisons"].append(c)
            all_p.append(c)
        if group:
            g = frame[group].astype("string")
            tab = pd.crosstab(g.loc[resp], pd.Series([r in it.rows for r in resp], index=resp, name="voiced"))
            if tab.shape[0] >= 2 and tab.shape[1] == 2 and (tab.sum(axis=1) >= 5).all():
                chi2, p, dof, _ = stats.chi2_contingency(tab.to_numpy())
                v = float(np.sqrt(chi2 / (tab.to_numpy().sum() * 1)))
                rates = {
                    str(k): {
                        "n": int(tab.loc[k].sum()),
                        "voiced": int(tab.loc[k].get(True, 0)),
                        "pct": round(float(tab.loc[k].get(True, 0)) / float(tab.loc[k].sum()) * 100, 2),
                    }
                    for k in tab.index
                }
                entry["by_group"] = {
                    "column": group,
                    "rates": rates,
                    "chi2": sf(chi2),
                    "dof": int(dof),
                    "p": float(p),
                    "cramers_v": sf(v),
                    "status": "tested",
                }
                all_p.append(entry["by_group"])
            else:
                entry["by_group"] = {"column": group, "status": "insufficient_n", "rates": {}}
        out_items.append(entry)
    # Holm over every test run in this analysis
    tested = [d for d in all_p if d.get("p") is not None]
    for d, adj in zip(tested, holm([d["p"] for d in tested]), strict=True):
        d["p_adj"] = adj
    findings: list[dict[str, Any]] = []
    for e in out_items:
        o = e["outcome"]
        if o.get("p") is not None:
            o["significant"] = bool(o["p_adj"] < ALPHA and abs(o["effect"] or 0) >= MIN_ABS_G)
            if o["significant"]:
                direction = "higher" if o["diff"] > 0 else "lower"
                ci = f" (95% CI {_fmt(o['ci'][0])} to {_fmt(o['ci'][1])})" if o.get("ci") else ""
                findings.append(
                    {
                        "id": f"{e['id']}:outcome",
                        "kind": "outcome_difference",
                        "item": e["name"],
                        "qualification": _qualify(o["p_adj"], o["effect"], o["n_with"]),
                        "statement": (
                            f"Respondents whose comments voice “{e['name']}” have {direction} {outcome} ({_fmt(o['mean_with'])} vs {_fmt(o['mean_without'])}; difference {_fmt(o['diff'])}{ci}; "
                            f"Hedges' g = {_fmt(o['effect'])}, {effect_label('g', o['effect'])}; Holm-adjusted p {_fp(o['p_adj'])}; n = {o['n_with']} vs {o['n_without']}). "
                            "This is an association among respondents, not evidence of cause."
                        ),
                        "numbers": {
                            "mean_with": o["mean_with"],
                            "mean_without": o["mean_without"],
                            "diff": o["diff"],
                            "g": o["effect"],
                            "p_adj": o["p_adj"],
                            "n_with": o["n_with"],
                            "n_without": o["n_without"],
                        },
                    }
                )
        for c in e["comparisons"]:
            if c.get("p") is None:
                continue
            c["significant"] = bool(c["p_adj"] < ALPHA and abs(c["effect"] or 0) >= 0.3)
            if c["significant"]:
                direction = "higher" if c["diff"] > 0 else "lower"
                findings.append(
                    {
                        "id": f"{e['id']}:{c['column']}",
                        "kind": "convergence",
                        "item": e["name"],
                        "column": c["column"],
                        "qualification": _qualify(c["p_adj"], c["effect"], c["n_with"]),
                        "statement": (
                            f"Convergent evidence: respondents voicing “{e['name']}” also record {direction} {c['column']} ({_fmt(c['mean_with'])} vs {_fmt(c['mean_without'])}; "
                            f"g = {_fmt(c['effect'])}; Holm-adjusted p {_fp(c['p_adj'])}), so the comments and the measured variable point the same way."
                        ),
                        "numbers": {
                            "mean_with": c["mean_with"],
                            "mean_without": c["mean_without"],
                            "g": c["effect"],
                            "p_adj": c["p_adj"],
                            "n_with": c["n_with"],
                            "n_without": c["n_without"],
                        },
                    }
                )
        bg = e.get("by_group")
        if bg and bg.get("p") is not None:
            bg["significant"] = bool(bg["p_adj"] < ALPHA and (bg["cramers_v"] or 0) >= 0.1)
            if bg["significant"]:
                top = max(bg["rates"].items(), key=lambda kv: kv[1]["pct"])
                low = min(bg["rates"].items(), key=lambda kv: kv[1]["pct"])
                findings.append(
                    {
                        "id": f"{e['id']}:{group}",
                        "kind": "group_prevalence",
                        "item": e["name"],
                        "column": group,
                        "qualification": "moderate" if bg["p_adj"] < 0.01 else "tentative",
                        "statement": (
                            f"“{e['name']}” is voiced most in {group} = {top[0]} ({top[1]['pct']:.1f}% of respondents) and least in {low[0]} ({low[1]['pct']:.1f}%) "
                            f"(χ² p {_fp(bg['p_adj'])} Holm-adjusted; Cramér's V = {_fmt(bg['cramers_v'])})."
                        ),
                        "numbers": {
                            "top_group": top[0],
                            "top_pct": top[1]["pct"],
                            "low_group": low[0],
                            "low_pct": low[1]["pct"],
                            "p_adj": bg["p_adj"],
                        },
                    }
                )
    out_items.sort(key=lambda e: -abs(e["outcome"].get("effect") or 0))
    ok = [e for e in out_items if e["outcome"].get("p") is not None]
    insufficient = [e["name"] for e in out_items if e["outcome"].get("status") == "insufficient_n"]
    if insufficient:
        warnings.append(
            f"Too few respondents (<{MIN_GROUP} with or without the item) to test: {', '.join(insufficient)}."
        )
    if not findings:
        warnings.append(
            "No theme/code reached the evidence thresholds (Holm-adjusted p < 0.05 and |g| ≥ 0.2). Lotus does not report weaker patterns as findings."
        )
    overall = {
        "respondents": n_resp,
        "respondents_with_outcome": n_valid,
        "outcome": outcome,
        "outcome_mean": sf(yfull.loc[resp].mean()),
        "outcome_median": sf(yfull.loc[resp].median()),
        "tests_run": len(tested),
        "items": len(items),
    }
    return {
        "overall": overall,
        "items": out_items,
        "findings": findings,
        "warnings": warnings,
        "thresholds": {
            "alpha": ALPHA,
            "min_abs_g_outcome": MIN_ABS_G,
            "min_abs_g_convergence": 0.3,
            "min_group_n": MIN_GROUP,
            "correction": "Holm–Bonferroni across all tests in this run",
        },
        "methodology": (
            "Respondents who wrote a response form the analysis universe. For every theme/code the outcome (and each comparison variable) is compared between respondents whose response "
            "carries the item and those whose response does not, using Welch's t-test (groups ≥ 30 or roughly normal) or the Mann–Whitney U test, with Hedges' g as the effect size. "
            "If a grouping variable is given, prevalence of each item across its levels is tested with χ². All p-values are Holm-adjusted across the whole run. "
            "Hard (single-label) themes understate secondary mentions; code-based items (multi-label) are preferred when available."
        ),
        "tested_items": len(ok),
    }


def config_hash(cfg: dict[str, Any]) -> str:
    import json

    return hashlib.sha256(json.dumps(cfg, sort_keys=True, default=str).encode()).hexdigest()
