from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.core.exceptions import ValidationFailed
from app.datasets import transform as T


def apply(df, *ops):
    out, log = T.apply_operations(df, T.parse_operations(list(ops)))
    return out, log


@pytest.fixture
def df():
    return pd.DataFrame(
        {
            "a": [1.0, 2.0, np.nan, 4.0, 100.0, 2.0],
            "c": [" Cairo ", "giza", "GIZA", None, "Cairo", "giza"],
            "n": pd.array([1, 2, 3, 4, 5, 2], dtype="Int64"),
            "d": ["2024-01-05", "2024-02-10", "bad", "2024-03-01", "2024-04-01", "2024-02-10"],
        }
    )


def test_drop_duplicates_and_missing(df):
    out, log = apply(df, {"op": "drop_duplicates", "subset": ["a", "c"]})
    assert len(out) == 5 and log[0]["cells_or_rows_affected"] == 1
    out, _ = apply(df, {"op": "drop_missing", "columns": ["a"]})
    assert out["a"].notna().all() and len(out) == 5
    out, _ = apply(df, {"op": "drop_missing", "how": "all"})
    assert len(out) == 6


@pytest.mark.parametrize(("strategy", "expected"), [("mean", 21.8), ("median", 2.0)])
def test_fill_missing_numeric(df, strategy, expected):
    out, _ = apply(df, {"op": "fill_missing", "column": "a", "strategy": strategy})
    assert (
        out.loc[2, "a"] == pytest.approx(expected)
        and out["a"].isna().sum() == 0
        and df["a"].isna().sum() == 1
    )  # original untouched


def test_fill_missing_other_strategies_and_errors(df):
    out, _ = apply(df, {"op": "fill_missing", "column": "c", "strategy": "mode"})
    assert out["c"].isna().sum() == 0
    out, _ = apply(df, {"op": "fill_missing", "column": "c", "strategy": "constant", "value": "Unknown"})
    assert out.loc[3, "c"] == "Unknown"
    out, _ = apply(df, {"op": "fill_missing", "column": "a", "strategy": "forward_fill"})
    assert out.loc[2, "a"] == 2.0
    with pytest.raises(ValidationFailed, match="not numeric"):
        apply(df, {"op": "fill_missing", "column": "c", "strategy": "mean"})
    with pytest.raises(ValidationFailed, match="constant"):
        apply(df, {"op": "fill_missing", "column": "a", "strategy": "constant"})
    with pytest.raises(ValidationFailed, match="must be a number"):
        apply(df, {"op": "fill_missing", "column": "a", "strategy": "constant", "value": "abc"})


def test_rename_select_drop(df):
    out, _ = apply(df, {"op": "rename_column", "column": "a", "new_name": "score"})
    assert "score" in out and "a" not in out
    with pytest.raises(ValidationFailed, match="already exists"):
        apply(df, {"op": "rename_column", "column": "a", "new_name": "c"})
    out, _ = apply(df, {"op": "select_columns", "columns": ["a", "n"]})
    assert list(out.columns) == ["a", "n"]
    out, _ = apply(df, {"op": "drop_columns", "columns": ["a"]})
    assert "a" not in out
    with pytest.raises(ValidationFailed, match="every column"):
        apply(df, {"op": "drop_columns", "columns": list(df.columns)})
    with pytest.raises(ValidationFailed, match="Unknown column"):
        apply(df, {"op": "select_columns", "columns": ["zzz"]})


def test_cast_types(df):
    out, log = apply(df, {"op": "cast_type", "column": "d", "to": "datetime"})
    assert (
        pd.api.types.is_datetime64_any_dtype(out["d"])
        and out["d"].isna().sum() == 1
        and log[0]["cells_or_rows_affected"] == 1
    )
    with pytest.raises(ValidationFailed, match="cannot be converted"):
        apply(df, {"op": "cast_type", "column": "d", "to": "datetime", "errors": "raise"})
    out, _ = apply(df, {"op": "cast_type", "column": "n", "to": "text"})
    assert out["n"].tolist()[:2] == ["1", "2"]
    out, _ = apply(
        pd.DataFrame({"p": ["1,200", "3%", "x"]}), {"op": "cast_type", "column": "p", "to": "numeric"}
    )
    assert out["p"].tolist()[:2] == [1200.0, 3.0] and np.isnan(out["p"].iloc[2])
    out, _ = apply(
        pd.DataFrame({"b": ["yes", "No", "maybe"]}), {"op": "cast_type", "column": "b", "to": "boolean"}
    )
    assert out["b"].tolist()[:2] == [True, False] and pd.isna(out["b"].iloc[2])


@pytest.mark.parametrize(
    ("op", "val", "n"),
    [
        ("eq", "giza", 2),
        ("ne", "giza", 4),
        ("contains", "cai", 2),
        ("in", ["Cairo", "giza"], 4),
        ("not_in", ["giza"], 4),
        ("is_null", None, 1),
        ("not_null", None, 5),
    ],
)
def test_filter_text(df, op, val, n):
    d2 = df.assign(c=df["c"].str.strip())
    out, _ = apply(d2, {"op": "filter_rows", "column": "c", "operator": op, "value": val})
    assert len(out) == n


def test_filter_numeric_dates_and_errors(df):
    assert len(apply(df, {"op": "filter_rows", "column": "a", "operator": "gt", "value": 2})[0]) == 2
    assert (
        len(apply(df, {"op": "filter_rows", "column": "a", "operator": "between", "value": [1, 2]})[0]) == 3
    )
    with pytest.raises(ValidationFailed, match="not numeric/date"):
        apply(df, {"op": "filter_rows", "column": "c", "operator": "gt", "value": "a"})
    with pytest.raises(ValidationFailed, match="not valid for column"):
        apply(df, {"op": "filter_rows", "column": "a", "operator": "eq", "value": "abc"})
    with pytest.raises(ValidationFailed, match="between"):
        apply(df, {"op": "filter_rows", "column": "a", "operator": "between", "value": 3})
    dts = pd.DataFrame({"t": pd.to_datetime(["2024-01-01", "2024-06-01", None])})
    assert (
        len(apply(dts, {"op": "filter_rows", "column": "t", "operator": "gte", "value": "2024-03-01"})[0])
        == 1
    )


def test_normalize_categories(df):
    out, log = apply(
        df,
        {
            "op": "normalize_categories",
            "column": "c",
            "case": "title",
            "mapping": {"Giza": "Giza (Greater Cairo)"},
        },
    )
    assert (
        set(out["c"].dropna()) == {"Cairo", "Giza (Greater Cairo)"} and log[0]["cells_or_rows_affected"] >= 4
    )


def test_outliers(df):
    out, log = apply(
        df,
        {"op": "handle_outliers", "column": "a", "method": "iqr", "threshold": 1.5, "action": "set_missing"},
    )
    assert np.isnan(out.loc[4, "a"]) and log[0]["cells_or_rows_affected"] == 1
    out, _ = apply(df, {"op": "handle_outliers", "column": "a", "action": "remove"})
    assert len(out) == 5 and out["a"].max() < 100
    out, _ = apply(df, {"op": "handle_outliers", "column": "a", "action": "clip"})
    assert out["a"].max() < 100
    out, _ = apply(
        df,
        {
            "op": "handle_outliers",
            "column": "a",
            "method": "zscore",
            "threshold": 1.5,
            "action": "set_missing",
        },
    )
    assert np.isnan(out.loc[4, "a"])
    with pytest.raises(ValidationFailed, match="zero variance"):
        apply(pd.DataFrame({"k": [1.0] * 6}), {"op": "handle_outliers", "column": "k", "method": "zscore"})
    with pytest.raises(ValidationFailed, match="Not enough"):
        apply(pd.DataFrame({"k": [1.0, 2.0]}), {"op": "handle_outliers", "column": "k"})


def test_invalid_operations_are_rejected_with_a_clean_error():
    with pytest.raises(ValidationFailed) as e:
        T.parse_operations([{"op": "delete_everything"}])
    assert e.value.code == "INVALID_TRANSFORMATION"
    with pytest.raises(ValidationFailed):
        T.parse_operations([{"op": "fill_missing", "column": "a", "strategy": "magic"}])
    with pytest.raises(ValidationFailed):
        T.parse_operations([{"op": "drop_duplicates", "unexpected": 1}])
