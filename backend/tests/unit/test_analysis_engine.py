"""Known-answer tests for the statistical engine. Expected values are derived by hand or from textbook examples."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from app.analysis import registry
from app.core.exceptions import AnalysisConfigurationError, InsufficientDataError, ZeroVarianceError


def run(df, t, **cfg):
    res, prov = registry.execute(df, t, cfg)
    return res, prov


def metric(res, key):
    return next(m for m in res["metrics"] if m["key"] == key)["value"]


def test_descriptive_known_values():
    df = pd.DataFrame({"x": [2, 4, 4, 4, 5, 5, 7, 9]})
    res, _ = run(df, "descriptive", columns=["x"])
    row = res["tables"][0]["rows"][0]
    assert row["n"] == 8 and row["mean"] == 5.0 and row["median"] == 4.5 and row["mode"] == 4.0
    assert row["std"] == pytest.approx(math.sqrt(32 / 7))  # sample SD, n-1
    assert row["variance"] == pytest.approx(32 / 7)
    assert row["min"] == 2 and row["max"] == 9 and row["q1"] == pytest.approx(4.0) and row["q3"] == pytest.approx(5.5)


def test_descriptive_missing_and_non_numeric():
    df = pd.DataFrame({"x": [1.0, 2.0, np.nan, 4.0], "c": ["a", "b", "c", "d"]})
    res, _ = run(df, "descriptive", columns=["x"])
    assert res["tables"][0]["rows"][0]["n"] == 3 and res["tables"][0]["rows"][0]["missing"] == 1
    with pytest.raises(AnalysisConfigurationError, match="must be numeric"):
        run(df, "descriptive", columns=["c"])


def test_pearson_textbook_example():
    # x=1..5, y=[2,4,5,4,5]: r = 0.7745967 (classic example), r^2 = 0.6
    df = pd.DataFrame({"x": [1, 2, 3, 4, 5], "y": [2, 4, 5, 4, 5]})
    res, _ = run(df, "correlation", variables=["x", "y"])
    assert metric(res, "r") == pytest.approx(0.7745967, abs=1e-6)
    assert metric(res, "r_squared") == pytest.approx(0.6, abs=1e-9)
    assert metric(res, "slope") == pytest.approx(0.6, abs=1e-9)
    assert metric(res, "intercept") == pytest.approx(2.2, abs=1e-9)
    assert 0 < metric(res, "p_value") < 1
    assert res["warnings"], "small-sample warning expected"


def test_correlation_edge_cases():
    with pytest.raises(ZeroVarianceError):
        run(pd.DataFrame({"x": [1, 1, 1, 1], "y": [1, 2, 3, 4]}), "correlation", variables=["x", "y"])
    with pytest.raises(InsufficientDataError):
        run(pd.DataFrame({"x": [1.0, 2.0, np.nan], "y": [1.0, np.nan, 3.0]}), "correlation", variables=["x", "y"])
    with pytest.raises(AnalysisConfigurationError):
        run(pd.DataFrame({"x": [1, 2, 3], "y": ["a", "b", "c"]}), "correlation", variables=["x", "y"])


def test_correlation_matrix_holm_and_ordering():
    rng = np.random.default_rng(1)
    a = rng.normal(size=200)
    df = pd.DataFrame({"a": a, "b": a * 0.9 + rng.normal(scale=0.3, size=200), "c": rng.normal(size=200)})
    res, _ = run(df, "correlation", variables=["a", "b", "c"], method="spearman")
    rows = res["tables"][0]["rows"]
    assert rows[0]["a"] == "a" and rows[0]["b"] == "b" and rows[0]["r"] > 0.9
    assert all(r["p_adj"] >= r["p"] for r in rows)
    assert res["charts"][0]["kind"] == "heatmap"


def test_group_comparison_two_groups_welch():
    a = [5.1, 4.9, 5.6, 5.8, 6.0, 5.5, 5.3, 5.9]
    b = [4.0, 3.9, 4.8, 5.0, 4.2, 4.4, 4.1, 4.6]
    df = pd.DataFrame({"y": a + b, "g": ["A"] * 8 + ["B"] * 8})
    res, _ = run(df, "group_comparison", outcome="y", group="g", test="welch_t")
    assert metric(res, "mean_difference") == pytest.approx(np.mean(a) - np.mean(b))
    assert metric(res, "p_value") < 0.01 and metric(res, "significant") is True
    assert metric(res, "effect_size") > 1.0  # large
    rows = {r["group"]: r for r in res["tables"][0]["rows"]}
    assert rows["A"]["mean"] == pytest.approx(np.mean(a)) and rows["B"]["n"] == 8


def test_group_comparison_auto_chooses_nonparametric_for_skewed_small_groups():
    rng = np.random.default_rng(3)
    df = pd.DataFrame({"y": np.r_[rng.exponential(1, 12), rng.exponential(3, 12)], "g": ["a"] * 12 + ["b"] * 12})
    res, _ = run(df, "group_comparison", outcome="y", group="g")
    assert res["variables"]["test"] in ("mann_whitney", "welch_t")
    assert any("Automatic" in d for d in res["decisions"])


def test_group_comparison_three_groups_with_posthoc_and_effect_size():
    rng = np.random.default_rng(5)
    df = pd.DataFrame({"y": np.r_[rng.normal(10, 2, 40), rng.normal(12, 2, 40), rng.normal(10.2, 2, 40)], "g": ["x"] * 40 + ["y"] * 40 + ["z"] * 40})
    res, _ = run(df, "group_comparison", outcome="y", group="g")
    assert res["variables"]["test"] == "welch_anova"
    pw = next(t for t in res["tables"] if t["name"] == "pairwise")["rows"]
    assert len(pw) == 3 and pw[0]["p_adj"] <= pw[-1]["p_adj"]
    assert {pw[0]["a"], pw[0]["b"]} in ({"x", "y"}, {"y", "z"})
    assert 0 < metric(res, "effect_size") < 1


def test_group_comparison_errors():
    with pytest.raises(AnalysisConfigurationError, match="exactly two"):
        run(pd.DataFrame({"y": range(12), "g": list("abc") * 4}), "group_comparison", outcome="y", group="g", test="welch_t")
    with pytest.raises(AnalysisConfigurationError, match="fewer than two"):
        run(pd.DataFrame({"y": range(12), "g": ["a"] * 12}), "group_comparison", outcome="y", group="g")
    with pytest.raises(AnalysisConfigurationError):
        run(pd.DataFrame({"y": [3.0] * 12, "g": ["a", "b"] * 6}), "group_comparison", outcome="y", group="g")


def test_crosstab_known_chi_square():
    # 2x2 [[20,30],[30,20]] n=100; expected 25 each; chi2 (no correction)=4.0, with Yates=3.24
    rows = [("a", "x")] * 20 + [("a", "y")] * 30 + [("b", "x")] * 30 + [("b", "y")] * 20
    df = pd.DataFrame(rows, columns=["r", "c"])
    res, _ = run(df, "crosstab", row="r", column="c")
    assert metric(res, "chi2") == pytest.approx(3.24, abs=1e-9)
    assert metric(res, "dof") == 1 and 0.05 < metric(res, "p_value") < 0.08
    cells = res["tables"][0]["rows"]
    assert all(c["expected"] == pytest.approx(25.0) for c in cells)


def test_crosstab_small_expected_uses_fisher():
    rows = [("a", "x")] * 6 + [("a", "y")] * 1 + [("b", "x")] * 1 + [("b", "y")] * 6
    res, _ = run(pd.DataFrame(rows, columns=["r", "c"]), "crosstab", row="r", column="c")
    assert "Fisher" in next(m for m in res["metrics"] if m["key"] == "p_value")["label"]
    assert metric(res, "odds_ratio") == pytest.approx(36.0)


def test_frequency_percentages_sum_to_100_and_missing_reported():
    df = pd.DataFrame({"c": ["a", "a", "b", None, "c", "a"]})
    res, _ = run(df, "frequency", column="c")
    rows = res["tables"][0]["rows"]
    assert rows[0]["category"] == "a" and rows[0]["count"] == 3 and rows[0]["percent"] == pytest.approx(60.0)
    assert sum(r["percent"] for r in rows if r["percent"] is not None) == pytest.approx(100.0)
    assert rows[-1]["category"] == "(missing)" and rows[-1]["count"] == 1
    with pytest.raises(AnalysisConfigurationError):
        run(pd.DataFrame({"t": [f"this is long free text number {i} with many words" for i in range(50)]}), "frequency", column="t")


def test_linear_regression_recovers_coefficients():
    rng = np.random.default_rng(11)
    n = 400
    x1, x2 = rng.normal(size=n), rng.normal(size=n)
    g = rng.choice(["ref", "up"], n, p=[0.6, 0.4])
    y = 3 + 2 * x1 - 1 * x2 + 4 * (g == "up") + rng.normal(scale=0.5, size=n)
    df = pd.DataFrame({"y": y, "x1": x1, "x2": x2, "g": g})
    res, _ = run(df, "linear_regression", outcome="y", predictors=["x1", "x2", "g"])
    coefs = {r["term"]: r for r in res["tables"][0]["rows"]}
    assert coefs["x1"]["estimate"] == pytest.approx(2, abs=0.1) and coefs["x2"]["estimate"] == pytest.approx(-1, abs=0.1)
    assert coefs["g[up]"]["estimate"] == pytest.approx(4, abs=0.2) and coefs["(Intercept)"]["estimate"] == pytest.approx(3, abs=0.2)
    assert metric(res, "r_squared") > 0.95
    # compare to closed-form least squares
    X = np.column_stack([np.ones(n), x1, x2, (g == "up").astype(float)])
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    assert coefs["x1"]["estimate"] == pytest.approx(beta[1], abs=1e-9)
    assert any(a["name"].startswith("Homoscedasticity") for a in res["assumptions"])


def test_linear_regression_failures():
    rng = np.random.default_rng(2)
    base = pd.DataFrame({"y": rng.normal(size=50), "a": rng.normal(size=50)})
    base["b"] = base["a"] * 2
    with pytest.raises(AnalysisConfigurationError, match="collinear"):
        run(base, "linear_regression", outcome="y", predictors=["a", "b"])
    base["const"] = 1.0
    with pytest.raises(ZeroVarianceError):
        run(base, "linear_regression", outcome="y", predictors=["a", "const"])
    with pytest.raises(InsufficientDataError):
        run(base.head(5), "linear_regression", outcome="y", predictors=["a"])


def test_logistic_regression_odds_ratio_and_separation():
    rng = np.random.default_rng(21)
    n = 800
    x = rng.normal(size=n)
    p = 1 / (1 + np.exp(-(-0.5 + 1.2 * x)))
    y = (rng.random(n) < p).astype(int)
    df = pd.DataFrame({"y": y, "x": x})
    res, _ = run(df, "logistic_regression", outcome="y", predictors=["x"])
    row = next(r for r in res["tables"][0]["rows"] if r["term"] == "x")
    assert row["odds_ratio"] == pytest.approx(math.exp(1.2), rel=0.2)
    assert row["or_low"] < row["odds_ratio"] < row["or_high"]
    assert 0.7 < metric(res, "auc") < 0.95 and 0.7 < metric(res, "cv_auc") < 0.95
    sep = pd.DataFrame({"y": [0] * 30 + [1] * 30, "x": list(range(30)) + list(range(100, 130))})
    with pytest.raises(AnalysisConfigurationError, match="separat"):
        run(sep, "logistic_regression", outcome="y", predictors=["x"])
    with pytest.raises(AnalysisConfigurationError, match="exactly two"):
        run(pd.DataFrame({"y": list("abc") * 10, "x": range(30)}), "logistic_regression", outcome="y", predictors=["x"])


def test_time_series_linear_trend_exact():
    d = pd.date_range("2024-01-01", periods=24, freq="MS")
    df = pd.DataFrame({"d": d, "v": 10 + 2.0 * np.arange(24)})
    res, _ = run(df, "time_series", date_column="d", value_column="v", frequency="M")
    assert metric(res, "slope") == pytest.approx(2.0, abs=1e-9)
    assert metric(res, "direction") == "increasing"
    assert metric(res, "kendall_tau") == pytest.approx(1.0)
    assert metric(res, "last_value") == pytest.approx(10 + 2 * 23)


def test_time_series_requires_datetime_and_enough_periods():
    with pytest.raises(AnalysisConfigurationError, match="not a date"):
        run(pd.DataFrame({"d": ["x"] * 20, "v": range(20)}), "time_series", date_column="d", value_column="v")
    df = pd.DataFrame({"d": pd.date_range("2024-01-01", periods=5), "v": range(5)})
    with pytest.raises(InsufficientDataError):
        run(df, "time_series", date_column="d", value_column="v")


def test_results_are_deterministic_and_json_safe():
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"y": rng.integers(0, 2, 100), "x": rng.normal(size=100), "z": rng.normal(size=100)})
    a, _ = run(df, "logistic_regression", outcome="y", predictors=["x", "z"])
    b, _ = run(df, "logistic_regression", outcome="y", predictors=["x", "z"])
    assert a == b
    import json
    json.dumps(a, allow_nan=False)


def test_unknown_type_and_bad_config():
    with pytest.raises(AnalysisConfigurationError):
        registry.execute(pd.DataFrame({"x": [1]}), "nope", {})
    with pytest.raises(AnalysisConfigurationError, match="Invalid configuration"):
        registry.execute(pd.DataFrame({"x": [1.0, 2.0, 3.0]}), "correlation", {"variables": ["x"]})
