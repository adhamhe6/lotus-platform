"""Reproducible, non-destructive data preparation. Each operation yields a new frame plus a log entry."""

from __future__ import annotations

from typing import Annotated, Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, TypeAdapter

from app.core.exceptions import ValidationFailed
from app.datasets.profile import classify
from app.datasets.types import NUMERIC_TYPES


class _Op(BaseModel):
    model_config = {"extra": "forbid"}


class DropDuplicates(_Op):
    op: Literal["drop_duplicates"]
    subset: list[str] | None = None
    keep: Literal["first", "last"] = "first"


class DropMissing(_Op):
    op: Literal["drop_missing"]
    columns: list[str] | None = None
    how: Literal["any", "all"] = "any"


class FillMissing(_Op):
    op: Literal["fill_missing"]
    column: str
    strategy: Literal["mean", "median", "mode", "constant", "forward_fill"]
    value: str | float | int | None = None


class RenameColumn(_Op):
    op: Literal["rename_column"]
    column: str
    new_name: str = Field(min_length=1, max_length=200)


class CastType(_Op):
    op: Literal["cast_type"]
    column: str
    to: Literal["numeric", "integer", "text", "datetime", "boolean"]
    errors: Literal["coerce", "raise"] = "coerce"
    dayfirst: bool = False
    format: str | None = None


class FilterRows(_Op):
    op: Literal["filter_rows"]
    column: str
    operator: Literal["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "is_null", "not_null", "between"]
    value: Any = None


class NormalizeCategories(_Op):
    op: Literal["normalize_categories"]
    column: str
    strip: bool = True
    collapse_whitespace: bool = True
    case: Literal["none", "lower", "upper", "title"] = "none"
    mapping: dict[str, str] | None = None


class HandleOutliers(_Op):
    op: Literal["handle_outliers"]
    column: str
    method: Literal["iqr", "zscore"] = "iqr"
    threshold: float = Field(default=1.5, gt=0)
    action: Literal["remove", "clip", "set_missing"] = "set_missing"


class SelectColumns(_Op):
    op: Literal["select_columns"]
    columns: list[str] = Field(min_length=1)


class DropColumns(_Op):
    op: Literal["drop_columns"]
    columns: list[str] = Field(min_length=1)


Operation = Annotated[
    DropDuplicates | DropMissing | FillMissing | RenameColumn | CastType | FilterRows | NormalizeCategories | HandleOutliers | SelectColumns | DropColumns,
    Field(discriminator="op"),
]
OPERATIONS = TypeAdapter(list[Operation])


def parse_operations(raw: list[dict[str, Any]]) -> list[Any]:
    try:
        return OPERATIONS.validate_python(raw)
    except Exception as e:  # pydantic ValidationError → friendly
        raise ValidationFailed(f"Invalid transformation: {str(e).splitlines()[0]}", code="INVALID_TRANSFORMATION") from e


def _need(df: pd.DataFrame, *cols: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValidationFailed(f"Unknown column(s): {', '.join(missing)}", code="UNKNOWN_COLUMN")


def apply_operations(df: pd.DataFrame, ops: list[Any]) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    log: list[dict[str, Any]] = []
    for op in ops:
        before = len(df)
        df, affected, note = _apply(df, op)
        log.append({"op": op.op, "params": op.model_dump(exclude={"op"}), "rows_before": before, "rows_after": len(df),
                    "cells_or_rows_affected": affected, "note": note})
    return df, log


def _apply(df: pd.DataFrame, op: Any) -> tuple[pd.DataFrame, int, str]:
    if isinstance(op, DropDuplicates):
        if op.subset:
            _need(df, *op.subset)
        out = df.drop_duplicates(subset=op.subset, keep=op.keep).reset_index(drop=True)
        return out, len(df) - len(out), f"removed {len(df) - len(out)} duplicate row(s)"
    if isinstance(op, DropMissing):
        if op.columns:
            _need(df, *op.columns)
        out = df.dropna(subset=op.columns, how=op.how).reset_index(drop=True)
        return out, len(df) - len(out), f"removed {len(df) - len(out)} row(s) with missing values"
    if isinstance(op, FillMissing):
        _need(df, op.column)
        s = df[op.column]
        n = int(s.isna().sum())
        if op.strategy in ("mean", "median"):
            if not pd.api.types.is_numeric_dtype(s):
                raise ValidationFailed(f"'{op.column}' is not numeric; use mode or constant.", code="INVALID_TRANSFORMATION")
            num = pd.to_numeric(s, errors="coerce").astype("float64")
            fill = num.mean() if op.strategy == "mean" else num.median()
            if np.isnan(fill):
                raise ValidationFailed(f"'{op.column}' has no values to compute the {op.strategy} from.", code="INVALID_TRANSFORMATION")
            new = num.fillna(fill)
            if pd.api.types.is_integer_dtype(s) and op.strategy == "median" and float(fill).is_integer():
                new = new.astype("Int64")
        elif op.strategy == "mode":
            m = s.mode(dropna=True)
            if m.empty:
                raise ValidationFailed(f"'{op.column}' has no values to compute the mode from.", code="INVALID_TRANSFORMATION")
            new = s.fillna(m.iloc[0])
        elif op.strategy == "forward_fill":
            new = s.ffill()
        else:
            if op.value is None:
                raise ValidationFailed("A constant value is required.", code="INVALID_TRANSFORMATION")
            val: Any = op.value
            if pd.api.types.is_numeric_dtype(s):
                try:
                    val = float(op.value)
                except (TypeError, ValueError) as e:
                    raise ValidationFailed(f"'{op.column}' is numeric; the constant must be a number.", code="INVALID_TRANSFORMATION") from e
                if pd.api.types.is_integer_dtype(s) and float(val).is_integer():
                    val = int(val)
            new = s.fillna(val)
        out = df.copy()
        out[op.column] = new
        return out, n - int(new.isna().sum()), f"filled {n - int(new.isna().sum())} missing value(s) in '{op.column}'"
    if isinstance(op, RenameColumn):
        _need(df, op.column)
        new_name = op.new_name.strip()
        if new_name != op.column and new_name in df.columns:
            raise ValidationFailed(f"A column named '{new_name}' already exists.", code="DUPLICATE_COLUMN")
        return df.rename(columns={op.column: new_name}), 1, f"renamed '{op.column}' to '{new_name}'"
    if isinstance(op, CastType):
        return _cast(df, op)
    if isinstance(op, FilterRows):
        return _filter(df, op)
    if isinstance(op, NormalizeCategories):
        _need(df, op.column)
        s = df[op.column].astype("string")
        new = s
        if op.strip:
            new = new.str.strip()
        if op.collapse_whitespace:
            new = new.str.replace(r"\s+", " ", regex=True)
        if op.case != "none":
            new = getattr(new.str, {"lower": "lower", "upper": "upper", "title": "title"}[op.case])()
        if op.mapping:
            new = new.replace(op.mapping)
        changed = int((new.fillna("§") != s.fillna("§")).sum())
        out = df.copy()
        out[op.column] = new
        return out, changed, f"normalised {changed} value(s) in '{op.column}'"
    if isinstance(op, HandleOutliers):
        _need(df, op.column)
        x = pd.to_numeric(df[op.column], errors="coerce").astype("float64")
        if x.notna().sum() < 4:
            raise ValidationFailed("Not enough numeric values to detect outliers.", code="INSUFFICIENT_OBSERVATIONS")
        if op.method == "iqr":
            q1, q3 = x.quantile(0.25), x.quantile(0.75)
            lo, hi = q1 - op.threshold * (q3 - q1), q3 + op.threshold * (q3 - q1)
        else:
            sd = x.std(ddof=1)
            if not sd or np.isnan(sd):
                raise ValidationFailed("The column has zero variance; z-scores are undefined.", code="ZERO_VARIANCE")
            lo, hi = x.mean() - op.threshold * sd, x.mean() + op.threshold * sd
        mask = (x < lo) | (x > hi)
        n = int(mask.sum())
        out = df.copy()
        if op.action == "remove":
            out = out.loc[~mask.fillna(False)].reset_index(drop=True)
        elif op.action == "clip":
            out[op.column] = x.clip(lo, hi) if not pd.api.types.is_integer_dtype(df[op.column]) else x.clip(lo, hi).round().astype("Int64")
        else:
            out[op.column] = x.mask(mask)
        return out, n, f"{op.action.replace('_', ' ')}: {n} outlier(s) outside [{lo:.4g}, {hi:.4g}] in '{op.column}'"
    if isinstance(op, SelectColumns):
        _need(df, *op.columns)
        return df[op.columns].copy(), len(op.columns), f"kept {len(op.columns)} column(s)"
    if isinstance(op, DropColumns):
        _need(df, *op.columns)
        out = df.drop(columns=op.columns)
        if out.shape[1] == 0:
            raise ValidationFailed("Cannot drop every column.", code="INVALID_TRANSFORMATION")
        return out, len(op.columns), f"dropped {len(op.columns)} column(s)"
    raise ValidationFailed("Unsupported operation.", code="INVALID_TRANSFORMATION")


def _cast(df: pd.DataFrame, op: CastType) -> tuple[pd.DataFrame, int, str]:
    _need(df, op.column)
    s = df[op.column]
    before_missing = int(s.isna().sum())
    if op.to in ("numeric", "integer"):
        raw = s.astype("string").str.replace(r"[,\s_]", "", regex=True).str.replace(r"%$", "", regex=True) if not pd.api.types.is_numeric_dtype(s) else s
        new = pd.to_numeric(raw, errors="coerce").astype("float64")
        if op.to == "integer":
            new = new.round().astype("Int64") if bool(new.dropna().apply(float.is_integer).all()) or True else new
    elif op.to == "datetime":
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            new = pd.to_datetime(s, errors="coerce", dayfirst=op.dayfirst, format=op.format)
        if getattr(new.dt, "tz", None) is not None:
            new = new.dt.tz_localize(None)
    elif op.to == "boolean":
        mp = {"true": True, "yes": True, "y": True, "1": True, "t": True, "false": False, "no": False, "n": False, "0": False, "f": False}
        new = s.astype("string").str.strip().str.lower().map(mp).astype("boolean")
    else:
        new = s.astype("string")
    created_missing = int(new.isna().sum()) - before_missing
    if op.errors == "raise" and created_missing > 0:
        raise ValidationFailed(f"{created_missing} value(s) in '{op.column}' cannot be converted to {op.to}.", code="INVALID_TYPE_CONVERSION")
    out = df.copy()
    out[op.column] = new
    return out, max(created_missing, 0), f"converted '{op.column}' to {op.to}; {max(created_missing, 0)} invalid value(s) became missing"


def _filter(df: pd.DataFrame, op: FilterRows) -> tuple[pd.DataFrame, int, str]:
    mask = build_mask(df, op.column, op.operator, op.value)
    out = df.loc[mask].reset_index(drop=True)
    return out, len(df) - len(out), f"kept {len(out)} of {len(df)} row(s) where {op.column} {op.operator} {op.value!r}"


def build_mask(df: pd.DataFrame, column: str, operator: str, value: Any) -> pd.Series:
    _need(df, column)
    s = df[column]
    if operator == "is_null":
        return s.isna()
    if operator == "not_null":
        return s.notna()
    if value is None:
        raise ValidationFailed("A value is required for this filter.", code="INVALID_FILTER")
    is_num = pd.api.types.is_numeric_dtype(s)
    is_dt = pd.api.types.is_datetime64_any_dtype(s)

    def conv(v: Any) -> Any:
        try:
            if is_num:
                return float(v)
            if is_dt:
                return pd.Timestamp(v)
        except (TypeError, ValueError) as e:
            raise ValidationFailed(f"Value {v!r} is not valid for column '{column}'.", code="INVALID_FILTER") from e
        return str(v)

    if operator in ("in", "not_in"):
        vals = value if isinstance(value, list) else [x.strip() for x in str(value).split(",")]
        vals = [conv(v) for v in vals]
        m = s.isin(vals) if not is_num else pd.to_numeric(s, errors="coerce").isin(vals)
        return m if operator == "in" else ~m
    if operator == "between":
        if not isinstance(value, list) or len(value) != 2:
            raise ValidationFailed("'between' needs [low, high].", code="INVALID_FILTER")
        lo, hi = conv(value[0]), conv(value[1])
        x = pd.to_numeric(s, errors="coerce") if is_num else s
        return ((x >= lo) & (x <= hi)).fillna(False).astype(bool)
    if operator == "contains":
        return s.astype("string").str.contains(str(value), case=False, regex=False, na=False)
    v = conv(value)
    x = pd.to_numeric(s, errors="coerce") if is_num else s
    if not is_num and not is_dt and operator in ("gt", "gte", "lt", "lte"):
        raise ValidationFailed(f"'{column}' is not numeric/date; ordering comparisons are not valid.", code="INVALID_FILTER")
    ops = {"eq": lambda: x == v, "ne": lambda: x != v, "gt": lambda: x > v, "gte": lambda: x >= v, "lt": lambda: x < v, "lte": lambda: x <= v}
    return ops[operator]().fillna(False).astype(bool)


def describe_schema_change(df: pd.DataFrame) -> dict[str, str]:
    return {str(c): classify(df[c], str(c)).value for c in df.columns}


__all__ = ["NUMERIC_TYPES", "apply_operations", "build_mask", "parse_operations"]
