"""Upload validation, parsing and type inference. Pure functions: bytes/path in, typed DataFrame out."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.core.exceptions import DatasetProcessingError, PayloadTooLarge, UnsupportedFile

ALLOWED_EXT = {"csv": {"csv", "tsv", "txt"}, "xlsx": {"xlsx"}}
NA_TOKENS = {"", "na", "n/a", "nan", "null", "none", "nil", "#n/a", "-", "--", "?"}
TRUE_TOKENS = {"true", "yes", "y", "t"}
FALSE_TOKENS = {"false", "no", "n", "f"}
MAX_ZIP_UNCOMPRESSED = 500 * 1024 * 1024


@dataclass
class IngestResult:
    frame: pd.DataFrame
    warnings: list[dict[str, Any]] = field(default_factory=list)
    original_columns: list[str] = field(default_factory=list)


def _warn(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **extra}


# ------------------------------------------------------------------ upload validation
def detect_file_type(filename: str, head: bytes, size: int, max_bytes: int) -> str:
    """Validate extension AND content signature. The MIME type sent by the client is never trusted."""
    if size == 0:
        raise DatasetProcessingError("The uploaded file is empty.", code="EMPTY_FILE")
    if size > max_bytes:
        raise PayloadTooLarge(f"The file exceeds the {max_bytes // (1024 * 1024)} MB upload limit.")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    kind = next((k for k, exts in ALLOWED_EXT.items() if ext in exts), None)
    if kind is None:
        raise UnsupportedFile("Unsupported file type. Upload a .csv, .tsv or .xlsx file.")
    is_zip = head[:4] == b"PK\x03\x04"
    if kind == "xlsx" and not is_zip:
        raise UnsupportedFile("The file is not a valid .xlsx workbook (bad signature).")
    if kind == "csv":
        if is_zip or head[:4] in (b"%PDF", b"\x7fELF") or head[:2] == b"MZ":
            raise UnsupportedFile("The file content does not look like delimited text.")
        if head[:2] not in (b"\xff\xfe", b"\xfe\xff") and b"\x00" in head[:4096]:
            raise UnsupportedFile("The file appears to be binary, not delimited text.")
    return kind


def safe_display_name(filename: str) -> str:
    """Display-only name: no path components, control characters or excessive length."""
    base = re.split(r"[\\/]", filename)[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    return (base or "dataset")[:200]


# ------------------------------------------------------------------ parsing
def _decode(raw: bytes, warnings: list[dict[str, Any]]) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig",):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    try:
        text = raw.decode("cp1252")
    except UnicodeDecodeError as e:
        raise DatasetProcessingError(
            "The file encoding could not be determined. Save it as UTF-8 and upload again.",
            code="INVALID_ENCODING",
        ) from e
    warnings.append(
        _warn(
            "ENCODING_FALLBACK",
            "The file is not valid UTF-8; it was decoded as Windows-1252. Check accented/Arabic text.",
        )
    )
    return text


def _sniff_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample else ""
        counts = {d: first.count(d) for d in ",;\t|"}
        best = max(counts, key=lambda d: counts[d])
        return best if counts[best] > 0 else ","


def _dedupe_header(raw_header: list[Any], warnings: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    seen: dict[str, int] = {}
    for i, h in enumerate(raw_header):
        name = (
            re.sub(r"\s+", " ", str(h).strip())
            if h is not None and not (isinstance(h, float) and np.isnan(h))
            else ""
        )
        if name == "":
            name = f"column_{i + 1}"
            warnings.append(
                _warn("BLANK_COLUMN_NAME", f"Column {i + 1} had no name and was called '{name}'.")
            )
        base, k = name, seen.get(name, 0)
        if k:
            while f"{base}_{k + 1}" in seen:
                k += 1
            name = f"{base}_{k + 1}"
            warnings.append(
                _warn(
                    "DUPLICATE_COLUMN",
                    f"Duplicate column name '{base}' was renamed to '{name}'.",
                    column=name,
                )
            )
        seen[base] = seen.get(base, 0) + 1
        seen[name] = seen.get(name, 0) + (0 if name == base else 1)
        names.append(name)
    return names


def read_table(path: Path, file_type: str, *, max_rows: int, max_columns: int) -> IngestResult:
    warnings: list[dict[str, Any]] = []
    try:
        if file_type == "csv":
            raw = path.read_bytes()
            text = _decode(raw, warnings)
            delim = _sniff_delimiter(text[:65536])
            df = pd.read_csv(
                io.StringIO(text),
                sep=delim,
                header=None,
                dtype=str,
                keep_default_na=False,
                na_filter=False,
                nrows=max_rows + 2,
                skip_blank_lines=True,
                engine="python" if len(delim) > 1 else "c",
                on_bad_lines="error",
                quotechar='"',
            )
        elif file_type == "xlsx":
            _check_zip_bomb(path)
            df = pd.read_excel(
                path, sheet_name=0, header=None, dtype=object, engine="openpyxl", nrows=max_rows + 2
            )
            if len(pd.ExcelFile(path, engine="openpyxl").sheet_names) > 1:
                warnings.append(
                    _warn("MULTIPLE_SHEETS", "The workbook has several sheets; only the first was imported.")
                )
        else:
            raise UnsupportedFile("Unsupported file type.")
    except pd.errors.EmptyDataError as e:
        raise DatasetProcessingError("The file contains no data.", code="EMPTY_DATASET") from e
    except (pd.errors.ParserError, UnicodeDecodeError) as e:
        raise DatasetProcessingError(
            f"The file could not be parsed: {_short(e)}", code="MALFORMED_FILE"
        ) from e
    except zipfile.BadZipFile as e:
        raise DatasetProcessingError(
            "The workbook is corrupted and could not be opened.", code="MALFORMED_FILE"
        ) from e
    except (KeyError, ValueError, OSError) as e:
        raise DatasetProcessingError(f"The file could not be read: {_short(e)}", code="MALFORMED_FILE") from e

    df = df.dropna(how="all")
    if df.empty or len(df) < 2:
        raise DatasetProcessingError(
            "The dataset has no data rows (a header row alone is not a dataset).", code="EMPTY_DATASET"
        )
    df = df.dropna(axis=1, how="all") if file_type == "xlsx" else df
    if df.shape[1] > max_columns:
        raise DatasetProcessingError(
            f"The dataset has {df.shape[1]} columns; the limit is {max_columns}.", code="TOO_MANY_COLUMNS"
        )
    original = [str(x) for x in df.iloc[0].tolist()]
    header = _dedupe_header(df.iloc[0].tolist(), warnings)
    body = df.iloc[1:].reset_index(drop=True)
    body.columns = header
    if len(body) > max_rows:
        raise DatasetProcessingError(
            f"The dataset has more than {max_rows:,} rows, the current limit.", code="TOO_MANY_ROWS"
        )
    typed, type_warnings = infer_types(body)
    warnings.extend(type_warnings)
    return IngestResult(typed, warnings, original)


def _check_zip_bomb(path: Path) -> None:
    with zipfile.ZipFile(path) as z:
        total = sum(i.file_size for i in z.infolist())
        if total > MAX_ZIP_UNCOMPRESSED:
            raise DatasetProcessingError(
                "The workbook expands to an unreasonable size.", code="MALFORMED_FILE"
            )
        names = {i.filename for i in z.infolist()}
        if any(n.lower().endswith("vbaproject.bin") for n in names):
            raise UnsupportedFile("Macro-enabled workbooks are not accepted.")
        if "xl/workbook.xml" not in names:
            raise DatasetProcessingError("The file is not a valid Excel workbook.", code="MALFORMED_FILE")


def _short(e: Exception) -> str:
    return str(e).splitlines()[0][:160]


# ------------------------------------------------------------------ type inference
_DATE_HINT = re.compile(
    r"^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\s*$|^\s*\d{4}-\d{2}\s*$"
)
_NUM_CLEAN = re.compile(r"[,\s_]")


def infer_types(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    out: dict[str, pd.Series] = {}
    warnings: list[dict[str, Any]] = []
    for col in df.columns:
        s, w = _infer_series(df[col], str(col))
        out[str(col)] = s
        warnings.extend(w)
    return pd.DataFrame(out), warnings


def _infer_series(s: pd.Series, name: str) -> tuple[pd.Series, list[dict[str, Any]]]:
    warns: list[dict[str, Any]] = []
    # Native (Excel) typed cells
    non_null = s.dropna()
    if non_null.empty:
        return s.astype("string"), warns
    if s.dtype == object:
        kinds = {type(v) for v in non_null}
        if kinds <= {bool, np.bool_}:
            return s.astype("boolean"), warns
        if kinds <= {int, float, np.integer, np.floating}:
            return _numeric_series(pd.to_numeric(s, errors="coerce")), warns
        if all(
            isinstance(v, (pd.Timestamp, np.datetime64)) or hasattr(v, "isoformat") for v in non_null
        ) and not (kinds <= {str}):
            return pd.to_datetime(s, errors="coerce"), warns
    # String path
    st = s.astype("string")
    st = st.str.strip()
    st = st.mask(st.str.lower().isin(NA_TOKENS))
    nn = st.dropna()
    if nn.empty:
        return st, warns
    low = nn.str.lower()
    if low.isin(TRUE_TOKENS | FALSE_TOKENS).all():
        return low.reindex(st.index).map(
            lambda v: pd.NA if v is pd.NA or pd.isna(v) else v in TRUE_TOKENS
        ).astype("boolean"), warns
    num = _to_numeric_fast(nn)
    ok = num.notna().mean()
    if ok == 1.0 and not nn.str.contains(r"^0\d+$", regex=True).any():
        full = pd.Series(np.nan, index=st.index, dtype="float64")
        full.loc[nn.index] = num.astype("float64").values
        return _numeric_series(full), warns
    if ok >= 0.9 and ok < 1.0:
        bad = nn[num.isna()]
        examples = ", ".join(repr(x) for x in bad.unique()[:3])
        warns.append(
            _warn(
                "MIXED_NUMERIC_TEXT",
                f"Column '{name}' is {ok:.0%} numeric but has {len(bad)} non-numeric value(s) ({examples}); kept as text. "
                "Use the 'cast to numeric' cleaning step to convert (invalid values become missing).",
                column=name,
                invalid_count=len(bad),
            )
        )
    if nn.str.match(_DATE_HINT).all():
        parsed = _parse_dates(nn)
        if parsed is not None:
            full = pd.Series(pd.NaT, index=st.index, dtype="datetime64[ns]")
            full.loc[nn.index] = parsed.values
            return full, warns
    return st, warns


def _to_numeric_fast(nn: pd.Series) -> pd.Series:
    """Vectorised numeric parse; the (slow) separator/percent clean-up only runs on values that failed AND only if a sample suggests the column is numeric."""
    num = pd.to_numeric(nn, errors="coerce")
    bad = num.isna()
    if not bad.any():
        return num
    sample = nn[bad].head(300).str.replace(_NUM_CLEAN, "", regex=True).str.replace(r"%$", "", regex=True)
    if pd.to_numeric(sample, errors="coerce").notna().mean() < 0.5:
        return num
    fixed = pd.to_numeric(
        nn[bad].str.replace(_NUM_CLEAN, "", regex=True).str.replace(r"%$", "", regex=True), errors="coerce"
    )
    num = num.copy()
    num[bad] = fixed
    return num


def _numeric_series(f: pd.Series) -> pd.Series:
    """Integers (no fractional part, within int range) become nullable Int64; everything else float64."""
    nn = f.dropna()
    if len(nn) and (np.isfinite(nn).all()) and (nn == np.floor(nn)).all() and nn.abs().max() < 2**53:
        return f.astype("Int64")
    return f.astype("float64")


def _parse_dates(nn: pd.Series) -> pd.Series | None:
    import warnings as _w

    with _w.catch_warnings():
        _w.simplefilter("ignore")
        try:
            iso = pd.to_datetime(nn, errors="raise", format="ISO8601", utc=False)
            return iso.dt.tz_localize(None) if iso.dt.tz is not None else iso
        except (ValueError, TypeError):
            pass
        try:
            parsed = pd.to_datetime(nn, errors="raise", dayfirst=False)
            return parsed.dt.tz_localize(None) if parsed.dt.tz is not None else parsed
        except (ValueError, TypeError):
            return None


def numeric_view(df: pd.DataFrame, col: str) -> pd.Series:
    """float64 view of a column (NaN for missing/invalid) — used by the analysis engine."""
    return pd.to_numeric(df[col], errors="coerce").astype("float64")
