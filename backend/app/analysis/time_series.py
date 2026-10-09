from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from scipy import stats

from app.analysis.base import AnalysisResult, AnalysisSpec, Assumption, Metric, Table, TableColumn, VarSpec, drop_note, require_columns, require_n, require_numeric, sf
from app.core.exceptions import AnalysisConfigurationError
from app.datasets.types import SemanticType
from app.analysis.base import semantic
from app.visualization.charts import line_chart

FREQ_LABEL = {"D": "day", "W": "week", "M": "month", "Q": "quarter", "Y": "year"}
PANDAS_FREQ = {"D": "D", "W": "W", "M": "MS", "Q": "QS", "Y": "YS"}


class TimeSeriesConfig(BaseModel):
    date_column: str
    value_column: str
    frequency: Literal["auto", "D", "W", "M", "Q", "Y"] = "auto"
    aggregation: Literal["mean", "sum", "median", "count"] = "mean"
    window: int = Field(default=3, ge=2, le=24)


def _auto_freq(span_days: int) -> str:
    return "D" if span_days <= 70 else "W" if span_days <= 200 else "M" if span_days <= 365 * 6 else "Q" if span_days <= 365 * 15 else "Y"


def run(df: pd.DataFrame, cfg: TimeSeriesConfig) -> AnalysisResult:
    require_columns(df, cfg.date_column)
    if semantic(df, cfg.date_column) != SemanticType.DATETIME:
        raise AnalysisConfigurationError(f"'{cfg.date_column}' is not a date/time column. Convert it with the 'cast to datetime' cleaning step first.")
    v = require_numeric(df, cfg.value_column, "value variable")
    d = pd.to_datetime(df[cfg.date_column], errors="coerce")
    frame = pd.DataFrame({"d": d, "v": v})
    n_total = len(frame)
    frame = frame.dropna(subset=["d"])
    if cfg.aggregation != "count":
        frame = frame.dropna(subset=["v"])
    n_used = len(frame)
    require_n(n_used, 8, "dated observations")
    span = int((frame["d"].max() - frame["d"].min()).days)
    freq = _auto_freq(span) if cfg.frequency == "auto" else cfg.frequency
    decisions = [f"Observations were aggregated per {FREQ_LABEL[freq]} using the {cfg.aggregation}" + (" (frequency chosen from the date span)." if cfg.frequency == "auto" else ".")]
    g = frame.set_index("d")["v"].resample(PANDAS_FREQ[freq])
    series = {"mean": g.mean, "sum": g.sum, "median": g.median, "count": g.count}[cfg.aggregation]()
    counts = g.count()
    empty = int((counts == 0).sum())
    if cfg.aggregation == "sum":
        series = series.where(counts > 0)
    require_n(int(series.notna().sum()), 8, f"{FREQ_LABEL[freq]}s with data")
    warnings = []
    if (note := drop_note(n_total, n_used)):
        warnings.append(note)
    if empty:
        warnings.append(f"{empty} {FREQ_LABEL[freq]}(s) in the range contain no observations; they appear as gaps and are excluded from trend estimation.")
    last_period_start = series.index[-1]
    full_end = last_period_start + (pd.tseries.frequencies.to_offset(PANDAS_FREQ[freq]))
    if frame["d"].max() < full_end - pd.Timedelta(days=1) and freq != "D":
        warnings.append(f"The last {FREQ_LABEL[freq]} ({last_period_start:%Y-%m-%d}) may be incomplete (data ends {frame['d'].max():%Y-%m-%d}); period-over-period comparisons involving it can mislead.")
    valid = series.dropna()
    t = np.arange(len(series))[series.notna().to_numpy()]
    lr = stats.linregress(t, valid.to_numpy())
    tau, tau_p = stats.kendalltau(t, valid.to_numpy())
    ma = series.rolling(cfg.window, min_periods=cfg.window).mean()
    pct = series.pct_change(fill_method=None) * 100
    fmt = "%Y-%m-%d" if freq in ("D", "W") else "%Y-%m" if freq == "M" else "%Y-%m" if freq == "Q" else "%Y"
    labels = [i.strftime(fmt) for i in series.index]
    sd = float(valid.std(ddof=1)) if len(valid) > 1 else 0.0
    rows = [{"period": lab, "value": sf(val), "n": int(c), "moving_average": sf(m), "change_pct": sf(pc)}
            for lab, val, c, m, pc in zip(labels, series, counts, ma, pct, strict=True)]
    last, prev = valid.iloc[-1], valid.iloc[-2]
    total_change = (valid.iloc[-1] - valid.iloc[0]) / abs(valid.iloc[0]) * 100 if valid.iloc[0] != 0 else None
    first_half, second_half = valid.iloc[: len(valid) // 2].mean(), valid.iloc[len(valid) // 2:].mean()
    metrics = [Metric(key="slope", label=f"Trend (change per {FREQ_LABEL[freq]})", value=sf(lr.slope), primary=True, ci=(float(lr.slope - 1.96 * lr.stderr), float(lr.slope + 1.96 * lr.stderr))),
               Metric(key="trend_p", label="Trend p-value (linear)", value=sf(lr.pvalue)), Metric(key="kendall_tau", label="Mann–Kendall τ", value=sf(tau)),
               Metric(key="kendall_p", label="Mann–Kendall p", value=sf(tau_p)),
               Metric(key="direction", label="Direction", value="increasing" if lr.slope > 0 and lr.pvalue < 0.05 else "decreasing" if lr.slope < 0 and lr.pvalue < 0.05 else "no clear trend"),
               Metric(key="last_value", label=f"Latest {FREQ_LABEL[freq]} ({labels[-1]})", value=sf(series.iloc[-1])),
               Metric(key="last_change_pct", label="Change vs previous period", value=sf(pct.iloc[-1]), unit="%"),
               Metric(key="total_change_pct", label="Change first → last period", value=sf(total_change), unit="%"),
               Metric(key="first_half_mean", label="Mean, first half", value=sf(first_half)), Metric(key="second_half_mean", label="Mean, second half", value=sf(second_half)),
               Metric(key="periods", label="Periods with data", value=int(valid.size)), Metric(key="std", label="Std. dev. of period values", value=sf(sd))]
    ac = None
    if len(valid) >= 12:
        r1 = float(np.corrcoef(valid.to_numpy()[:-1], valid.to_numpy()[1:])[0, 1])
        ac = Assumption(name="Serial dependence", status="violated" if abs(r1) > 0.5 else "met", statistic=sf(r1),
                        detail=f"Lag-1 autocorrelation = {r1:.2f}. Strong autocorrelation makes the linear-trend p-value optimistic; the Mann–Kendall test shares this limitation.")
    charts = [line_chart(labels, {f"{cfg.aggregation.capitalize()} {cfg.value_column}": [sf(x) for x in series], f"{cfg.window}-period moving average": [sf(x) for x in ma]},
                         title=f"{cfg.value_column} per {FREQ_LABEL[freq]}", x_label=cfg.date_column, y_label=f"{cfg.aggregation} of {cfg.value_column}", x_type="time",
                         dashed={f"{cfg.window}-period moving average"})]
    table = Table(name="periods", title="Period table", columns=[TableColumn(key="period", label="Period"), TableColumn(key="value", label=f"{cfg.aggregation.capitalize()}", kind="number"),
                                                                  TableColumn(key="n", label="Rows", kind="integer"), TableColumn(key="moving_average", label=f"MA({cfg.window})", kind="number"),
                                                                  TableColumn(key="change_pct", label="Change vs prev. %", kind="percent")], rows=rows)
    _ = prev, last
    return AnalysisResult(
        type="time_series", title=f"Time series — {cfg.value_column} over {cfg.date_column}", variables={"date_column": cfg.date_column, "value_column": cfg.value_column, "frequency": freq,
                                                                                                         "aggregation": cfg.aggregation, "window": cfg.window},
        n_total=n_total, n_used=n_used, metrics=metrics, tables=[table], charts=charts, assumptions=[ac] if ac else [], warnings=warnings, decisions=decisions,
        methodology=("Rows are bucketed by calendar period and aggregated; empty periods stay as gaps. The trend is the OLS slope of the period values on time (95% CI shown) with a non-parametric "
                     "Mann–Kendall (Kendall τ) check. The moving average is a trailing window. Period-over-period change is the percentage difference to the previous period. "
                     "No seasonality adjustment or forecasting is performed."),
    )


SPEC = AnalysisSpec(
    type="time_series", label="Time series & trend", description="Trend, moving average and period-over-period change of a numeric measure over time.",
    roles=[VarSpec("date_column", "Date column", ["datetime"]), VarSpec("value_column", "Value", ["numeric_continuous", "numeric_discrete", "binary"])],
    config_model=TimeSeriesConfig, run=run,
    parameters=[{"key": "frequency", "label": "Period", "type": "select", "default": "auto", "options": [{"value": "auto", "label": "Automatic"}, {"value": "D", "label": "Day"},
                {"value": "W", "label": "Week"}, {"value": "M", "label": "Month"}, {"value": "Q", "label": "Quarter"}, {"value": "Y", "label": "Year"}]},
                {"key": "aggregation", "label": "Aggregate by", "type": "select", "default": "mean", "options": [{"value": "mean", "label": "Mean"}, {"value": "sum", "label": "Sum"},
                 {"value": "median", "label": "Median"}, {"value": "count", "label": "Count"}]},
                {"key": "window", "label": "Moving-average window", "type": "integer", "default": 3, "min": 2, "max": 24}],
)
