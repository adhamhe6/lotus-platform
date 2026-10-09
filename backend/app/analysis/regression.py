from __future__ import annotations

import warnings as pywarnings
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from pydantic import BaseModel, Field
from scipy import stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score, roc_curve
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.stattools import durbin_watson

from app.analysis.base import (
    SEED, AnalysisResult, AnalysisSpec, Assumption, Metric, Table, TableColumn, VarSpec, drop_note, normality_assumption, require_columns, require_n,
    require_numeric, semantic, sf,
)
from app.core.exceptions import AnalysisConfigurationError, ZeroVarianceError
from app.datasets.types import NUMERIC_TYPES, SemanticType
from app.visualization.charts import coef_chart, roc_chart, scatter_chart

MAX_LEVELS = 12


class LinearRegressionConfig(BaseModel):
    outcome: str
    predictors: list[str] = Field(min_length=1, max_length=15)
    robust_se: bool = False


class LogisticRegressionConfig(BaseModel):
    outcome: str
    predictors: list[str] = Field(min_length=1, max_length=15)
    positive_class: str | None = None


def _design(df: pd.DataFrame, predictors: list[str]) -> tuple[pd.DataFrame, dict[str, str], list[str]]:
    """Return (design matrix without constant, term→predictor map, notes). Categorical → dummies vs the most frequent level."""
    preds = list(dict.fromkeys(predictors))
    cols: dict[str, pd.Series] = {}
    owner: dict[str, str] = {}
    notes: list[str] = []
    for p in preds:
        require_columns(df, p)
        sem = semantic(df, p)
        if sem in NUMERIC_TYPES and sem != SemanticType.BINARY or sem == SemanticType.BINARY:
            cols[p] = pd.to_numeric(df[p], errors="coerce").astype("float64")
            owner[p] = p
        elif sem in (SemanticType.CATEGORICAL, SemanticType.BOOLEAN):
            s = df[p].astype("string")
            levels = s.dropna().value_counts()
            if len(levels) < 2:
                raise AnalysisConfigurationError(f"Predictor '{p}' has fewer than two levels.")
            if len(levels) > MAX_LEVELS:
                raise AnalysisConfigurationError(f"Predictor '{p}' has {len(levels)} levels (limit {MAX_LEVELS}); group rare levels first.")
            ref = levels.index[0]
            notes.append(f"'{p}': reference level is '{ref}' (most frequent); coefficients are differences from it.")
            for lv in levels.index[1:]:
                name = f"{p}[{lv}]"
                col = (s == lv).astype("float64").where(s.notna())
                cols[name] = col
                owner[name] = p
        else:
            raise AnalysisConfigurationError(f"Predictor '{p}' is {sem.value.replace('_', ' ')} and cannot be used in a regression.")
    return pd.DataFrame(cols), owner, notes


def _check_design(X: pd.DataFrame) -> None:
    for c in X.columns:
        if X[c].nunique(dropna=True) < 2:
            raise ZeroVarianceError(f"Predictor '{c}' is constant among the complete rows, so its effect cannot be estimated.")
    Xc = sm.add_constant(X, has_constant="add")
    if np.linalg.matrix_rank(Xc.to_numpy()) < Xc.shape[1]:
        raise AnalysisConfigurationError("The predictors are perfectly collinear (one is an exact combination of others). Remove a redundant predictor.")


def _vifs(X: pd.DataFrame) -> dict[str, float]:
    if X.shape[1] < 2:
        return {}
    Xc = sm.add_constant(X, has_constant="add").to_numpy()
    out = {}
    for i, c in enumerate(X.columns, start=1):
        try:
            out[c] = float(variance_inflation_factor(Xc, i))
        except Exception:
            out[c] = float("nan")
    return out


def run_linear(df: pd.DataFrame, cfg: LinearRegressionConfig) -> AnalysisResult:
    y = require_numeric(df, cfg.outcome, "outcome")
    if cfg.outcome in cfg.predictors:
        raise AnalysisConfigurationError("The outcome cannot also be a predictor.")
    Xall, owner, notes = _design(df, cfg.predictors)
    data = pd.concat([y.rename("__y"), Xall], axis=1)
    n_total = len(data)
    data = data.dropna()
    n = len(data)
    p = Xall.shape[1]
    require_n(n, max(10, p + 3), "complete rows")
    if np.ptp(data["__y"].to_numpy()) == 0:
        raise ZeroVarianceError(f"Outcome '{cfg.outcome}' is constant among the complete rows.")
    X = data[Xall.columns]
    _check_design(X)
    warnings, decisions = [], list(notes)
    if (note := drop_note(n_total, n)):
        warnings.append(note + " (listwise deletion)")
    if n < 10 * p:
        warnings.append(f"Only {n} rows for {p} estimated term(s) (< 10 per term); estimates may be unstable or overfit.")
    Xc = sm.add_constant(X, has_constant="add")
    model = sm.OLS(data["__y"], Xc)
    fit = model.fit(cov_type="HC3") if cfg.robust_se else model.fit()
    if cfg.robust_se:
        decisions.append("Heteroscedasticity-robust (HC3) standard errors were requested.")
    ci = fit.conf_int()
    sd_y = float(data["__y"].std(ddof=1))
    rows = []
    items = []
    for term in fit.params.index:
        std_beta = None
        if term != "const" and Xall[term].nunique() > 2 and sd_y:
            std_beta = float(fit.params[term] * X[term].std(ddof=1) / sd_y)
        rows.append({"term": "(Intercept)" if term == "const" else term, "estimate": sf(fit.params[term]), "std_error": sf(fit.bse[term]), "t": sf(fit.tvalues[term]),
                     "p": sf(fit.pvalues[term]), "ci_low": sf(ci.loc[term, 0]), "ci_high": sf(ci.loc[term, 1]), "std_beta": sf(std_beta)})
        if term != "const":
            items.append({"name": term, "estimate": sf(fit.params[term]), "lo": sf(ci.loc[term, 0]), "hi": sf(ci.loc[term, 1]), "p": sf(fit.pvalues[term])})
    resid = np.asarray(fit.resid)
    fitted = np.asarray(fit.fittedvalues)
    assumptions = [normality_assumption(resid, "residuals")]
    try:
        bp_stat, bp_p, _, _ = het_breuschpagan(resid, Xc.to_numpy())
        assumptions.append(Assumption(name="Homoscedasticity (constant error variance)", status="met" if bp_p >= 0.05 else "violated", test="Breusch–Pagan", statistic=float(bp_stat),
                                      p_value=float(bp_p), detail=f"p = {bp_p:.3g}. " + ("No evidence of changing variance." if bp_p >= 0.05 else "Error variance changes with the predictors; consider robust standard errors.")))
    except Exception:
        pass
    dw = float(durbin_watson(resid))
    assumptions.append(Assumption(name="Independence of errors", status="unknown", test="Durbin–Watson", statistic=dw,
                                  detail=f"Durbin–Watson = {dw:.2f} (≈2 means no first-order autocorrelation). Only meaningful if row order is meaningful (e.g. time)."))
    vif = _vifs(X)
    if vif:
        worst = max(vif.items(), key=lambda kv: (np.nan_to_num(kv[1], nan=0.0)))
        assumptions.append(Assumption(name="Low multicollinearity", status="met" if worst[1] < 5 else "violated" if worst[1] >= 10 else "unknown",
                                      detail=f"Largest VIF = {worst[1]:.2f} ({worst[0]}). VIF < 5 is comfortable; ≥ 10 indicates serious collinearity; 5–10 is borderline.", statistic=sf(worst[1])))
    infl = fit.get_influence()
    cooks = infl.cooks_distance[0]
    n_infl = int((cooks > 4 / n).sum())
    assumptions.append(Assumption(name="No dominant influential observations", status="met" if np.max(cooks) < 1 else "violated",
                                  detail=f"{n_infl} observation(s) exceed Cook's D > 4/n; the largest is {np.max(cooks):.3f} (> 1 would be problematic)."))
    rmse = float(np.sqrt(np.mean(resid**2)))
    metrics = [Metric(key="r_squared", label="R²", value=sf(fit.rsquared), primary=True), Metric(key="adj_r_squared", label="Adjusted R²", value=sf(fit.rsquared_adj)),
               Metric(key="f_stat", label=f"F({int(fit.df_model)}, {int(fit.df_resid)})", value=sf(fit.fvalue)), Metric(key="p_value", label="Model p-value", value=sf(fit.f_pvalue)),
               Metric(key="rmse", label="RMSE (in-sample)", value=sf(rmse), unit=cfg.outcome), Metric(key="n", label="Observations (n)", value=n),
               Metric(key="aic", label="AIC", value=sf(fit.aic))]
    sig = [r for r in rows if r["term"] != "(Intercept)" and r["p"] is not None and r["p"] < 0.05]
    tables = [Table(name="coefficients", title="Coefficients", columns=[
        TableColumn(key="term", label="Term"), TableColumn(key="estimate", label="Estimate", kind="number"), TableColumn(key="std_error", label="Std. error", kind="number"),
        TableColumn(key="t", label="t", kind="number"), TableColumn(key="p", label="p", kind="p_value"), TableColumn(key="ci_low", label="95% CI low", kind="number"),
        TableColumn(key="ci_high", label="95% CI high", kind="number"), TableColumn(key="std_beta", label="Std. β", kind="number")], rows=rows,
        note="Estimates are per unit of the predictor (dummies: difference from the reference level) holding other predictors constant. Std. β is shown for continuous predictors.")]
    charts = [coef_chart(items, title="Coefficients with 95% CI", x_label=f"Effect on {cfg.outcome} (raw units)"),
              scatter_chart(fitted, resid, "Fitted values", "Residuals", title="Residuals vs fitted", subtitle="Look for a flat, patternless band around 0")]
    return AnalysisResult(
        type="linear_regression", title=f"Linear regression — {cfg.outcome}", variables={"outcome": cfg.outcome, "predictors": cfg.predictors, "robust_se": cfg.robust_se},
        n_total=n_total, n_used=n, metrics=metrics + [Metric(key="significant_terms", label="Terms with p < 0.05", value=len(sig))], tables=tables, charts=charts,
        assumptions=assumptions, warnings=warnings, decisions=decisions + ["Rows with a missing value in the outcome or any predictor are dropped (listwise)."],
        methodology=("Ordinary least squares regression (statsmodels) of a numeric outcome on numeric predictors and dummy-coded categorical predictors (reference = most frequent level). "
                     "Reported: coefficients with t-tests and 95% CIs, R²/adjusted R², overall F-test, RMSE (in-sample, optimistic). Diagnostics: Shapiro–Wilk on residuals, Breusch–Pagan, "
                     "Durbin–Watson, variance inflation factors, Cook's distance. Associations are conditional on the other predictors and are not necessarily causal."),
    )


def run_logistic(df: pd.DataFrame, cfg: LogisticRegressionConfig) -> AnalysisResult:
    require_columns(df, cfg.outcome)
    if cfg.outcome in cfg.predictors:
        raise AnalysisConfigurationError("The outcome cannot also be a predictor.")
    ys = df[cfg.outcome]
    levels = [lv for lv in pd.unique(ys.dropna())]
    if len(levels) != 2:
        raise AnalysisConfigurationError(f"The outcome '{cfg.outcome}' must have exactly two distinct values for logistic regression (found {len(levels)}).")
    labels = sorted(levels, key=str)
    decisions: list[str] = []
    if cfg.positive_class is not None:
        pos = next((lv for lv in levels if str(lv) == cfg.positive_class or (isinstance(lv, (int, float, np.integer, np.floating)) and str(int(lv)) == cfg.positive_class)), None)
        if pos is None:
            raise AnalysisConfigurationError(f"positive_class '{cfg.positive_class}' is not one of the outcome values: {', '.join(map(str, labels))}.")
    elif set(map(str, levels)) <= {"0", "1", "0.0", "1.0", "True", "False"}:
        pos = next(lv for lv in levels if str(lv) in ("1", "1.0", "True"))
    else:
        pos = labels[-1]
        decisions.append(f"No positive class was chosen; '{pos}' (alphabetically last) is treated as the event.")
    neg = next(lv for lv in levels if lv != pos)
    yb = ys.map(lambda v: np.nan if pd.isna(v) else (1.0 if v == pos else 0.0)).astype("float64")
    Xall, _, notes = _design(df, cfg.predictors)
    data = pd.concat([yb.rename("__y"), Xall], axis=1)
    n_total = len(data)
    data = data.dropna()
    n = len(data)
    p = Xall.shape[1]
    n1 = int(data["__y"].sum())
    n0 = n - n1
    require_n(n, 20, "complete rows")
    if min(n1, n0) < 5:
        raise AnalysisConfigurationError(f"Too few observations in one outcome class (event n = {n1}, non-event n = {n0}); at least 5 of each are required.")
    X = data[Xall.columns]
    _check_design(X)
    warnings = []
    if (note := drop_note(n_total, n)):
        warnings.append(note)
    epv = min(n1, n0) / p
    if epv < 10:
        warnings.append(f"Only {epv:.1f} events per estimated term (guideline ≥ 10): the model may overfit.")
    Xc = sm.add_constant(X, has_constant="add")
    with pywarnings.catch_warnings(record=True) as caught:
        pywarnings.simplefilter("always")
        try:
            fit = sm.Logit(data["__y"], Xc).fit(disp=0, maxiter=200)
        except (np.linalg.LinAlgError, sm.tools.sm_exceptions.PerfectSeparationError) as e:
            raise AnalysisConfigurationError("The model cannot be estimated: a predictor perfectly separates the outcome classes (or predictors are collinear).") from e
    for w in caught:
        if "converge" in str(w.message).lower():
            warnings.append("The optimiser reported a convergence warning; treat estimates with caution.")
            break
    if not np.isfinite(fit.params).all() or float(np.abs(fit.params).max()) > 30:
        raise AnalysisConfigurationError("The model is (quasi-)separated: a predictor almost perfectly predicts the outcome, so coefficients are not finite.")
    ci = fit.conf_int()
    rows, items = [], []
    for term in fit.params.index:
        orr = float(np.exp(fit.params[term]))
        rows.append({"term": "(Intercept)" if term == "const" else term, "log_odds": sf(fit.params[term]), "std_error": sf(fit.bse[term]), "odds_ratio": sf(orr),
                     "or_low": sf(np.exp(ci.loc[term, 0])), "or_high": sf(np.exp(ci.loc[term, 1])), "z": sf(fit.tvalues[term]), "p": sf(fit.pvalues[term])})
        if term != "const":
            items.append({"name": term, "estimate": sf(orr), "lo": sf(np.exp(ci.loc[term, 0])), "hi": sf(np.exp(ci.loc[term, 1])), "p": sf(fit.pvalues[term])})
    prob = np.asarray(fit.predict(Xc))
    yv = data["__y"].to_numpy()
    auc = float(roc_auc_score(yv, prob))
    pred = (prob >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(yv, pred, labels=[0, 1]).ravel()
    sens = tp / (tp + fn) if (tp + fn) else float("nan")
    spec = tn / (tn + fp) if (tn + fp) else float("nan")
    cv_auc = None
    try:
        skf = StratifiedKFold(n_splits=min(5, int(min(n1, n0))), shuffle=True, random_state=SEED)
        cv_prob = cross_val_predict(LogisticRegression(C=1e6, max_iter=1000), (X - X.mean()) / X.std(ddof=0).replace(0, 1), yv, cv=skf, method="predict_proba")[:, 1]
        cv_auc = float(roc_auc_score(yv, cv_prob))
    except Exception:
        warnings.append("Cross-validated AUC could not be computed.")
    fpr, tpr, _ = roc_curve(yv, prob)
    base_rate = n1 / n
    metrics = [Metric(key="auc", label="AUC (in-sample)", value=sf(auc), primary=True), Metric(key="cv_auc", label="AUC (5-fold cross-validated)", value=sf(cv_auc), note="Honest estimate of out-of-sample discrimination; seeded."),
               Metric(key="pseudo_r2", label="McFadden pseudo-R²", value=sf(fit.prsquared)), Metric(key="llr_p", label="Likelihood-ratio test p", value=sf(fit.llr_pvalue)),
               Metric(key="accuracy", label="Accuracy at 0.5 (in-sample)", value=sf(accuracy_score(yv, pred)), note=f"Baseline (always predict majority) = {max(base_rate, 1 - base_rate):.3f}"),
               Metric(key="sensitivity", label="Sensitivity", value=sf(sens)), Metric(key="specificity", label="Specificity", value=sf(spec)),
               Metric(key="event_rate", label=f"Event rate ({cfg.outcome} = {pos})", value=sf(base_rate)), Metric(key="n", label="Observations (n)", value=n), Metric(key="aic", label="AIC", value=sf(fit.aic))]
    tables = [Table(name="coefficients", title="Coefficients and odds ratios", columns=[
        TableColumn(key="term", label="Term"), TableColumn(key="odds_ratio", label="Odds ratio", kind="number"), TableColumn(key="or_low", label="OR 95% CI low", kind="number"),
        TableColumn(key="or_high", label="OR 95% CI high", kind="number"), TableColumn(key="log_odds", label="Log-odds", kind="number"), TableColumn(key="std_error", label="Std. error", kind="number"),
        TableColumn(key="z", label="z", kind="number"), TableColumn(key="p", label="p", kind="p_value")], rows=rows,
        note=f"Odds ratio > 1 raises the odds of {cfg.outcome} = {pos} (vs {neg}). Odds ratios are not risk ratios.")]
    tables.append(Table(name="confusion", title="Confusion matrix (threshold 0.5, in-sample)", columns=[TableColumn(key="actual", label="Actual"), TableColumn(key="pred_neg", label=f"Predicted {neg}", kind="integer"),
                                                                                                         TableColumn(key="pred_pos", label=f"Predicted {pos}", kind="integer")],
                         rows=[{"actual": str(neg), "pred_neg": int(tn), "pred_pos": int(fp)}, {"actual": str(pos), "pred_neg": int(fn), "pred_pos": int(tp)}]))
    assumptions = [Assumption(name="Sufficient events per variable", status="met" if epv >= 10 else "violated", detail=f"{epv:.1f} events per estimated term (guideline ≥ 10)."),
                   Assumption(name="Independent observations", status="unknown", detail="Cannot be verified from the data."),
                   Assumption(name="No perfect separation", status="met", detail="The model converged with finite coefficients.")]
    vif = _vifs(X)
    if vif:
        worst = max(vif.items(), key=lambda kv: np.nan_to_num(kv[1], nan=0.0))
        assumptions.append(Assumption(name="Low multicollinearity", status="met" if worst[1] < 5 else "violated" if worst[1] >= 10 else "unknown", detail=f"Largest VIF = {worst[1]:.2f} ({worst[0]})."))
    return AnalysisResult(
        type="logistic_regression", title=f"Logistic regression — {cfg.outcome} = {pos}", variables={"outcome": cfg.outcome, "predictors": cfg.predictors, "positive_class": str(pos)},
        n_total=n_total, n_used=n, metrics=metrics, tables=tables, charts=[coef_chart(items, title="Odds ratios with 95% CI", x_label="Odds ratio (1 = no effect)", reference=1.0), roc_chart(fpr, tpr, auc)],
        assumptions=assumptions, warnings=warnings, decisions=decisions + notes + [f"Event = '{pos}', reference = '{neg}'. Listwise deletion of missing values."],
        methodology=("Binary logistic regression by maximum likelihood (statsmodels Logit). Reports odds ratios with Wald 95% CIs, McFadden pseudo-R², a likelihood-ratio test, AUC, and classification metrics "
                     "at a 0.5 threshold. In-sample metrics are optimistic, so a seeded 5-fold cross-validated AUC is also reported. Separation and events-per-variable are checked."),
    )


LINEAR_SPEC = AnalysisSpec(
    type="linear_regression", label="Linear regression", description="Model a numeric outcome from numeric and categorical predictors (OLS).",
    roles=[VarSpec("outcome", "Outcome (numeric)", ["numeric_continuous", "numeric_discrete"]),
           VarSpec("predictors", "Predictors", ["numeric_continuous", "numeric_discrete", "binary", "categorical", "boolean"], multiple=True)],
    config_model=LinearRegressionConfig, run=run_linear,
    parameters=[{"key": "robust_se", "label": "Robust (HC3) standard errors", "type": "boolean", "default": False}],
)
LOGISTIC_SPEC = AnalysisSpec(
    type="logistic_regression", label="Logistic regression", description="Model the odds of a binary outcome from predictors.",
    roles=[VarSpec("outcome", "Binary outcome", ["binary", "boolean", "categorical"], help="Must have exactly two distinct values."),
           VarSpec("predictors", "Predictors", ["numeric_continuous", "numeric_discrete", "binary", "categorical", "boolean"], multiple=True)],
    config_model=LogisticRegressionConfig, run=run_logistic,
    parameters=[{"key": "positive_class", "label": "Event (positive) value", "type": "text", "default": None, "help": "Defaults to 1/True, else the alphabetically last value."}],
)

_unused: Any = stats
