"""Rule-based insight extraction from *computed* analysis results.

An insight is only emitted when the effect clears explicit thresholds (sample size, significance, effect size).
The statement is assembled from the stored numbers — no model is involved — and carries its evidence.
"""

from __future__ import annotations

import hashlib
from typing import Any

THRESHOLDS = {
    "min_n": 30,
    "alpha": 0.05,
    "min_abs_r": 0.3,
    "min_g": 0.2,
    "min_eta2": 0.01,
    "min_v": 0.1,
    "min_r2": 0.1,
    "min_auc": 0.65,
}


def _m(result: dict[str, Any], key: str) -> Any:
    return next((m["value"] for m in result["metrics"] if m["key"] == key), None)


def _mm(result: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((m for m in result["metrics"] if m["key"] == key), None)


def _table(result: dict[str, Any], name: str) -> list[dict[str, Any]]:
    return next((t["rows"] for t in result["tables"] if t["name"] == name), [])


def _f(x: float | None, d: int = 2) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def _p(p: float | None) -> str:
    return "n/a" if p is None else "< 0.001" if p < 0.001 else f"= {p:.3f}"


def _ev(
    label: str, value: Any, metric: str | None = None, table: str | None = None, unit: str | None = None
) -> dict[str, Any]:
    return {"label": label, "value": value, "metric": metric, "table": table, "unit": unit}


def _key(run_id: str, *parts: str) -> str:
    return hashlib.sha256("|".join([run_id, *parts]).encode()).hexdigest()[:40]


def _qual(strong: bool, moderate: bool) -> str:
    return "strong" if strong else "moderate" if moderate else "tentative"


def extract(
    run_id: str, analysis_type: str, config: dict[str, Any], result: dict[str, Any]
) -> list[dict[str, Any]]:
    fn = {
        "correlation": _correlation,
        "group_comparison": _group,
        "crosstab": _crosstab,
        "linear_regression": _linear,
        "logistic_regression": _logistic,
        "time_series": _trend,
    }.get(analysis_type)
    return fn(run_id, config, result) if fn else []


def _correlation(run_id: str, cfg: dict[str, Any], r: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    method = cfg.get("method", "pearson")
    sym = "r" if method == "pearson" else "ρ"
    if len(cfg["variables"]) == 2:
        rv, p, n = _m(r, "r"), _m(r, "p_value"), _m(r, "n")
        ci = (_mm(r, "r") or {}).get("ci")
        if (
            rv is None
            or n is None
            or n < THRESHOLDS["min_n"]
            or p is None
            or p >= THRESHOLDS["alpha"]
            or abs(rv) < THRESHOLDS["min_abs_r"]
        ):
            return []
        a, b = cfg["variables"]
        direction = "positive" if rv > 0 else "negative"
        out.append(
            {
                "kind": "association",
                "title": f"{a} and {b} are {_m(r, 'strength')}ly associated",
                "variables": [a, b],
                "statement": (
                    f"{a} and {b} show a {_m(r, 'strength')} {direction} association ({method.capitalize()} {sym} = {_f(rv)}"
                    + (f", 95% CI {_f(ci[0])} to {_f(ci[1])}" if ci else "")
                    + f", p {_p(p)}, n = {n}). "
                    f"Higher {a} goes with {'higher' if rv > 0 else 'lower'} {b}; this is an association, not proof of cause."
                ),
                "qualification": _qual(
                    abs(rv) >= 0.5 and p < 0.001 and n >= 100, abs(rv) >= 0.3 and p < 0.01
                ),
                "evidence": [
                    _ev(f"{method.capitalize()} {sym}", rv, "r"),
                    _ev("p-value", p, "p_value"),
                    _ev("n", n, "n"),
                    _ev("r²", _m(r, "r_squared"), "r_squared"),
                ],
                "dedupe": _key(run_id, "pair", a, b),
            }
        )
    else:
        for row in _table(r, "pairs")[:3]:
            if (
                row["r"] is None
                or row["p_adj"] is None
                or row["p_adj"] >= THRESHOLDS["alpha"]
                or abs(row["r"]) < THRESHOLDS["min_abs_r"]
                or row["n"] < THRESHOLDS["min_n"]
            ):
                continue
            a, b = row["a"], row["b"]
            out.append(
                {
                    "kind": "association",
                    "title": f"{a} × {b}: {row['strength']} {'positive' if row['r'] > 0 else 'negative'} association",
                    "variables": [a, b],
                    "statement": f"{a} and {b} are {row['strength']}ly {'positively' if row['r'] > 0 else 'negatively'} correlated ({method.capitalize()} {sym} = {_f(row['r'])}, Holm-adjusted p {_p(row['p_adj'])}, n = {row['n']}).",
                    "qualification": _qual(
                        abs(row["r"]) >= 0.5 and row["p_adj"] < 0.001,
                        abs(row["r"]) >= 0.3 and row["p_adj"] < 0.01,
                    ),
                    "evidence": [
                        _ev(f"{sym}", row["r"], table="pairs"),
                        _ev("Holm-adjusted p", row["p_adj"], table="pairs"),
                        _ev("n", row["n"], table="pairs"),
                    ],
                    "dedupe": _key(run_id, "pair", a, b),
                }
            )
    return out


def _group(run_id: str, cfg: dict[str, Any], r: dict[str, Any]) -> list[dict[str, Any]]:
    p, eff = _m(r, "p_value"), _m(r, "effect_size")
    n = _m(r, "n")
    if p is None or eff is None or n is None or n < THRESHOLDS["min_n"] or p >= THRESHOLDS["alpha"]:
        return []
    test = r["variables"]["test"]
    floor = THRESHOLDS["min_g"] if test in ("welch_t", "mann_whitney") else THRESHOLDS["min_eta2"]
    if abs(eff) < floor:
        return []
    rows = [g for g in _table(r, "groups") if g["group"] != "All"]
    hi, lo = max(rows, key=lambda g: g["mean"]), min(rows, key=lambda g: g["mean"])
    y, g = cfg["outcome"], cfg["group"]
    m_eff = _mm(r, "effect_size") or {}
    label = {
        "welch_t": "Welch t-test",
        "mann_whitney": "Mann–Whitney U",
        "welch_anova": "Welch ANOVA",
        "kruskal": "Kruskal–Wallis",
    }[test]
    ev = [
        _ev(f"Mean {y} in {hi['group']}", hi["mean"], table="groups"),
        _ev(f"Mean {y} in {lo['group']}", lo["mean"], table="groups"),
        _ev(f"{label} p-value", p, "p_value"),
        _ev(m_eff.get("label", "Effect size"), eff, "effect_size"),
        _ev("n", n, "n"),
    ]
    return [
        {
            "kind": "group_difference",
            "title": f"{y} differs by {g}: lowest in {lo['group']}",
            "variables": [y, g],
            "statement": (
                f"Mean {y} is lowest for {g} = {lo['group']} ({_f(lo['mean'])}, n = {lo['n']}) and highest for {hi['group']} ({_f(hi['mean'])}, n = {hi['n']}), "
                f"a gap of {_f(hi['mean'] - lo['mean'])}; the groups differ overall ({label} p {_p(p)}; {m_eff.get('label', 'effect size')} = {_f(eff)}"
                f"{', ' + m_eff['note'] if m_eff.get('note') else ''})."
            ),
            "qualification": _qual(
                p < 0.001 and (abs(eff) >= 0.5 if test in ("welch_t", "mann_whitney") else eff >= 0.14),
                p < 0.01,
            ),
            "evidence": ev,
            "dedupe": _key(run_id, "group", y, g),
        }
    ]


def _crosstab(run_id: str, cfg: dict[str, Any], r: dict[str, Any]) -> list[dict[str, Any]]:
    p, v, n = _m(r, "p_value"), _m(r, "cramers_v"), _m(r, "n")
    if (
        p is None
        or v is None
        or n is None
        or n < THRESHOLDS["min_n"]
        or p >= THRESHOLDS["alpha"]
        or v < THRESHOLDS["min_v"]
    ):
        return []
    cells = _table(r, "cells")
    top = max(cells, key=lambda c: abs(c["std_residual"]))
    a, b = cfg["row"], cfg["column"]
    return [
        {
            "kind": "association",
            "title": f"{a} and {b} are associated",
            "variables": [a, b],
            "statement": (
                f"{a} and {b} are statistically associated (p {_p(p)}, Cramér's V = {_f(v)}, n = {n}). The largest departure from independence is "
                f"{a} = {top['row']} with {b} = {top['column']}: {top['count']} observed vs {top['expected']:.1f} expected (standardised residual {_f(top['std_residual'])})."
            ),
            "qualification": _qual(p < 0.001 and v >= 0.3, p < 0.01 and v >= 0.2),
            "evidence": [
                _ev("p-value", p, "p_value"),
                _ev("Cramér's V", v, "cramers_v"),
                _ev("n", n, "n"),
                _ev("Largest standardised residual", top["std_residual"], table="cells"),
            ],
            "dedupe": _key(run_id, "crosstab", a, b),
        }
    ]


def _linear(run_id: str, cfg: dict[str, Any], r: dict[str, Any]) -> list[dict[str, Any]]:
    r2, fp, n = _m(r, "r_squared"), _m(r, "p_value"), _m(r, "n")
    if (
        r2 is None
        or fp is None
        or n is None
        or n < THRESHOLDS["min_n"]
        or fp >= THRESHOLDS["alpha"]
        or r2 < THRESHOLDS["min_r2"]
    ):
        return []
    terms = [
        t
        for t in _table(r, "coefficients")
        if t["term"] != "(Intercept)" and t["p"] is not None and t["p"] < THRESHOLDS["alpha"]
    ]
    if not terms:
        return []
    terms.sort(key=lambda t: -abs(t["std_beta"] if t["std_beta"] is not None else t["t"]))
    t = terms[0]
    y = cfg["outcome"]
    names = ", ".join(x["term"] for x in terms[:4])
    return [
        {
            "kind": "driver",
            "title": f"{t['term']} is the strongest independent predictor of {y}",
            "variables": [y, *cfg["predictors"]],
            "statement": (
                f"In a linear model of {y} (R² = {_f(r2)}, n = {n}), {t['term']} has the largest independent association: each one-unit increase is associated with a "
                f"{_f(t['estimate'])} change in {y} (95% CI {_f(t['ci_low'])} to {_f(t['ci_high'])}, p {_p(t['p'])}), holding the other predictors constant. "
                f"Significant terms: {names}."
            ),
            "qualification": _qual(r2 >= 0.3 and t["p"] < 0.001, t["p"] < 0.01),
            "evidence": [
                _ev("R²", r2, "r_squared"),
                _ev(f"Coefficient of {t['term']}", t["estimate"], table="coefficients"),
                _ev("p-value", t["p"], table="coefficients"),
                _ev("n", n, "n"),
            ],
            "dedupe": _key(run_id, "linear", y),
        }
    ]


def _logistic(run_id: str, cfg: dict[str, Any], r: dict[str, Any]) -> list[dict[str, Any]]:
    auc, n = _m(r, "cv_auc") or _m(r, "auc"), _m(r, "n")
    if auc is None or n is None or n < THRESHOLDS["min_n"] or auc < THRESHOLDS["min_auc"]:
        return []
    terms = [
        t
        for t in _table(r, "coefficients")
        if t["term"] != "(Intercept)" and t["p"] is not None and t["p"] < THRESHOLDS["alpha"]
    ]
    if not terms:
        return []
    t = max(terms, key=lambda x: abs(x["z"] or 0))
    pos = r["variables"]["positive_class"]
    ratio = t["odds_ratio"]
    return [
        {
            "kind": "driver",
            "title": f"{t['term']} predicts {cfg['outcome']} = {pos}",
            "variables": [cfg["outcome"], *cfg["predictors"]],
            "statement": (
                f"Each unit increase in {t['term']} multiplies the odds of {cfg['outcome']} = {pos} by {_f(ratio, 3)} (95% CI {_f(t['or_low'], 3)} to {_f(t['or_high'], 3)}, p {_p(t['p'])}). "
                f"The model discriminates with a cross-validated AUC of {_f(auc, 3)} (n = {n})."
            ),
            "qualification": _qual(auc >= 0.8 and t["p"] < 0.001, t["p"] < 0.01),
            "evidence": [
                _ev(f"Odds ratio of {t['term']}", ratio, table="coefficients"),
                _ev("p-value", t["p"], table="coefficients"),
                _ev("Cross-validated AUC", auc, "cv_auc"),
                _ev("n", n, "n"),
            ],
            "dedupe": _key(run_id, "logistic", cfg["outcome"]),
        }
    ]


def _trend(run_id: str, cfg: dict[str, Any], r: dict[str, Any]) -> list[dict[str, Any]]:
    p, kp, slope, periods = _m(r, "trend_p"), _m(r, "kendall_p"), _m(r, "slope"), _m(r, "periods")
    if (
        p is None
        or kp is None
        or slope is None
        or periods is None
        or periods < 8
        or p >= THRESHOLDS["alpha"]
        or kp >= THRESHOLDS["alpha"]
    ):
        return []
    freq = {"D": "day", "W": "week", "M": "month", "Q": "quarter", "Y": "year"}[r["variables"]["frequency"]]
    v = cfg["value_column"]
    first, second = _m(r, "first_half_mean"), _m(r, "second_half_mean")
    return [
        {
            "kind": "trend",
            "title": f"{v} is {_m(r, 'direction')} over time",
            "variables": [cfg["date_column"], v],
            "statement": (
                f"{v} shows a statistically supported {_m(r, 'direction')} trend of {_f(slope, 3)} per {freq} (linear p {_p(p)}, Mann–Kendall p {_p(kp)}, {periods} periods). "
                f"The mean was {_f(first)} in the first half of the period and {_f(second)} in the second half."
            ),
            "qualification": _qual(p < 0.001 and kp < 0.001 and periods >= 12, p < 0.01),
            "evidence": [
                _ev(f"Trend per {freq}", slope, "slope"),
                _ev("Linear trend p", p, "trend_p"),
                _ev("Mann–Kendall p", kp, "kendall_p"),
                _ev("Periods", periods, "periods"),
            ],
            "dedupe": _key(run_id, "trend", v),
        }
    ]
