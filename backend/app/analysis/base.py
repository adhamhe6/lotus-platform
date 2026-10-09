"""Result model + shared validation/statistics helpers for the analysis engine.

The engine returns *numbers, tables, charts and caveats* only. Prose interpretation lives in the AI layer and
is always stored separately.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from scipy import stats

from app.core.exceptions import AnalysisConfigurationError, InsufficientDataError, ZeroVarianceError
from app.datasets.profile import classify
from app.datasets.types import GROUPING_TYPES, NUMERIC_TYPES, SemanticType
from app.visualization.spec import ChartSpec

ENGINE_VERSION = "1.0.0"
SEED = 20260101


class Metric(BaseModel):
    key: str
    label: str
    value: float | int | str | bool | None
    unit: str | None = None
    ci: tuple[float, float] | None = None
    note: str | None = None
    primary: bool = False


class TableColumn(BaseModel):
    key: str
    label: str
    kind: Literal["text", "number", "percent", "p_value", "integer"] = "text"


class Table(BaseModel):
    name: str
    title: str
    columns: list[TableColumn]
    rows: list[dict[str, Any]]
    note: str | None = None


class Assumption(BaseModel):
    name: str
    status: Literal["met", "violated", "unknown", "not_applicable"]
    detail: str
    test: str | None = None
    statistic: float | None = None
    p_value: float | None = None


class AnalysisResult(BaseModel):
    type: str
    title: str
    variables: dict[str, Any]
    n_total: int
    n_used: int
    metrics: list[Metric] = Field(default_factory=list)
    tables: list[Table] = Field(default_factory=list)
    charts: list[ChartSpec] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)  # methodological choices the engine made, and why
    methodology: str = ""

    @property
    def n_dropped(self) -> int:
        return self.n_total - self.n_used

    def metric(self, key: str) -> Metric | None:
        return next((m for m in self.metrics if m.key == key), None)


@dataclass
class VarSpec:
    """Role definition used by the UI builder (what each slot accepts) and by validation."""

    key: str
    label: str
    accepts: list[str]
    multiple: bool = False
    required: bool = True
    min_count: int = 1
    help: str = ""


@dataclass
class AnalysisSpec:
    type: str
    label: str
    description: str
    roles: list[VarSpec]
    config_model: type[BaseModel]
    run: Callable[[pd.DataFrame, Any], AnalysisResult]
    category: str = "quantitative"
    parameters: list[dict[str, Any]] = field(default_factory=list)


# --------------------------------------------------------------------------- validation helpers
def require_columns(df: pd.DataFrame, *cols: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise AnalysisConfigurationError(
            f"Column(s) not found in this dataset version: {', '.join(missing)}."
        )


def semantic(df: pd.DataFrame, col: str) -> SemanticType:
    return classify(df[col], col)


def require_numeric(df: pd.DataFrame, col: str, role: str = "variable") -> pd.Series:
    require_columns(df, col)
    sem = semantic(df, col)
    if sem not in NUMERIC_TYPES:
        raise AnalysisConfigurationError(
            f"The {role} '{col}' must be numeric (it is {sem.value.replace('_', ' ')})."
        )
    return pd.to_numeric(df[col], errors="coerce").astype("float64")


def require_grouping(
    df: pd.DataFrame, col: str, role: str = "grouping variable", *, max_levels: int = 30
) -> pd.Series:
    require_columns(df, col)
    sem = semantic(df, col)
    if sem not in GROUPING_TYPES:
        raise AnalysisConfigurationError(
            f"The {role} '{col}' must be categorical (it is {sem.value.replace('_', ' ')})."
        )
    s = df[col]
    k = int(s.nunique(dropna=True))
    if k < 2:
        raise AnalysisConfigurationError(f"The {role} '{col}' has fewer than two distinct values.")
    if k > max_levels:
        raise AnalysisConfigurationError(
            f"The {role} '{col}' has {k} levels (limit {max_levels}); group rare levels first."
        )
    return (
        s.astype("string")
        if not pd.api.types.is_numeric_dtype(s)
        else s.map(lambda v: _level_name(v) if pd.notna(v) else pd.NA).astype("string")
    )


def _level_name(v: Any) -> str:
    return (
        str(int(v))
        if isinstance(v, (int, float, np.integer, np.floating)) and float(v).is_integer()
        else str(v)
    )


def require_n(n: int, minimum: int, what: str = "observations") -> None:
    if n < minimum:
        raise InsufficientDataError(
            f"Only {n} complete {what} are available; at least {minimum} are required."
        )


def require_variance(x: np.ndarray | pd.Series, name: str) -> None:
    arr = np.asarray(x, dtype=float)
    if len(arr) == 0 or float(np.nanmax(arr)) == float(np.nanmin(arr)):
        raise ZeroVarianceError(f"'{name}' is constant (zero variance), so this statistic is undefined.")


def listwise(df: pd.DataFrame, cols: list[str]) -> tuple[pd.DataFrame, int, int]:
    sub = df[cols]
    n_total = len(sub)
    complete = sub.dropna()
    return complete, n_total, len(complete)


def drop_note(n_total: int, n_used: int) -> str | None:
    d = n_total - n_used
    return (
        None
        if d == 0
        else f"{d} of {n_total} rows ({d / n_total:.1%}) were excluded because of missing values in the selected variables."
    )


# --------------------------------------------------------------------------- statistics helpers
def holm(p: list[float]) -> list[float]:
    """Holm–Bonferroni adjusted p-values (monotone), preserving input order."""
    m = len(p)
    if m == 0:
        return []
    order = np.argsort(p)
    adj = np.empty(m)
    running = 0.0
    for rank, idx in enumerate(order):
        running = max(running, (m - rank) * p[idx])
        adj[idx] = min(1.0, running)
    return [float(a) for a in adj]


def fisher_ci(r: float, n: int, alpha: float = 0.05, se_factor: float = 1.0) -> tuple[float, float] | None:
    if n <= 3 or abs(r) >= 1:
        return None
    z = np.arctanh(r)
    se = se_factor / math.sqrt(n - 3)
    crit = stats.norm.ppf(1 - alpha / 2)
    return float(np.tanh(z - crit * se)), float(np.tanh(z + crit * se))


def mean_ci(x: np.ndarray, alpha: float = 0.05) -> tuple[float, float] | None:
    n = len(x)
    if n < 2:
        return None
    sem = stats.sem(x)
    if sem == 0 or np.isnan(sem):
        m = float(np.mean(x))
        return m, m
    lo, hi = stats.t.interval(1 - alpha, n - 1, loc=np.mean(x), scale=sem)
    return float(lo), float(hi)


def correlation_strength(r: float) -> str:
    a = abs(r)
    return "negligible" if a < 0.1 else "weak" if a < 0.3 else "moderate" if a < 0.5 else "strong"


def effect_label(kind: str, value: float) -> str:
    a = abs(value)
    if kind in ("d", "g"):
        return "negligible" if a < 0.2 else "small" if a < 0.5 else "medium" if a < 0.8 else "large"
    if kind in ("eta2", "epsilon2", "omega2"):
        return "negligible" if a < 0.01 else "small" if a < 0.06 else "medium" if a < 0.14 else "large"
    if kind == "cramers_v":
        return "negligible" if a < 0.1 else "small" if a < 0.3 else "medium" if a < 0.5 else "large"
    if kind == "rank_biserial":
        return "negligible" if a < 0.1 else "small" if a < 0.3 else "medium" if a < 0.5 else "large"
    return ""


def normality_assumption(x: np.ndarray, label: str) -> Assumption:
    n = len(x)
    if n < 3:
        return Assumption(
            name=f"Normality of {label}", status="unknown", detail=f"n={n} is too small to test normality."
        )
    if np.ptp(x) == 0:
        return Assumption(name=f"Normality of {label}", status="not_applicable", detail="Constant values.")
    if n > 5000:
        stat, p = stats.normaltest(x)
        test = "D'Agostino–Pearson"
    else:
        stat, p = stats.shapiro(x)
        test = "Shapiro–Wilk"
    ok = p >= 0.05
    detail = f"{test} p = {p:.3g} (n = {n}). " + (
        "No evidence against normality." if ok else "Distribution departs from normality."
    )
    if n >= 200 and not ok:
        detail += " With large samples small departures are flagged; inspect the histogram."
    return Assumption(
        name=f"Normality of {label}",
        status="met" if ok else "violated",
        detail=detail,
        test=test,
        statistic=float(stat),
        p_value=float(p),
    )


def sf(v: Any) -> float | None:
    """Safe float: NaN/inf → None."""
    if v is None:
        return None
    f = float(v)
    return None if (math.isnan(f) or math.isinf(f)) else f


def library_versions() -> dict[str, str]:
    import sklearn
    import statsmodels

    return {
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scipy": __import__("scipy").__version__,
        "statsmodels": statsmodels.__version__,
        "scikit-learn": sklearn.__version__,
        "engine": ENGINE_VERSION,
    }
