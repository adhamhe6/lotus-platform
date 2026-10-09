"""Convert pandas/numpy scalars into strict-JSON-safe Python values."""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd


def to_jsonable(v: Any) -> Any:
    if v is None or v is pd.NaT or v is pd.NA:
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer, int)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, np.ndarray):
        return [to_jsonable(x) for x in v.tolist()]
    if isinstance(v, dict):
        return {str(k): to_jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [to_jsonable(x) for x in v]
    if isinstance(v, (str, bytes)):
        return v.decode("utf-8", "replace") if isinstance(v, bytes) else v
    return str(v)


def frame_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    cols = list(df.columns)
    return [{c: to_jsonable(v) for c, v in zip(cols, row, strict=True)} for row in df.itertuples(index=False, name=None)]
