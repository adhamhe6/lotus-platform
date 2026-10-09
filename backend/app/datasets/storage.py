"""Private file storage. Paths are always generated from UUIDs — never from user input."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterable
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ROW_GROUP_SIZE = 50_000


class Storage:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        for sub in ("raw", "versions", "models", "tmp"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)

    def resolve(self, rel: str) -> Path:
        p = (self.root / rel).resolve()
        if self.root not in p.parents:
            raise ValueError("path escapes storage root")
        return p

    def new_raw_path(self, ext: str) -> tuple[str, Path]:
        rel = f"raw/{uuid.uuid4().hex}.{ext}"
        return rel, self.resolve(rel)

    def new_version_path(self) -> tuple[str, Path]:
        rel = f"versions/{uuid.uuid4().hex}.parquet"
        return rel, self.resolve(rel)

    def model_path(self, name: str) -> Path:
        if not name.replace("-", "").replace("_", "").isalnum():
            raise ValueError("invalid model name")
        return self.resolve(f"models/{name}.joblib")

    def tmp_path(self) -> Path:
        return self.resolve(f"tmp/{uuid.uuid4().hex}")

    def delete(self, rel: str) -> None:
        try:
            self.resolve(rel).unlink(missing_ok=True)
        except ValueError:
            pass

    # ---- parquet ---------------------------------------------------------------------
    def write_frame(self, df: pd.DataFrame) -> tuple[str, str]:
        """Write a typed frame; returns (relative path, content hash)."""
        rel, path = self.new_version_path()
        table = pa.Table.from_pandas(df, preserve_index=False)
        pq.write_table(table, path, row_group_size=ROW_GROUP_SIZE, compression="zstd")
        return rel, frame_hash(df)

    def read_frame(self, rel: str, columns: Iterable[str] | None = None) -> pd.DataFrame:
        return pq.read_table(self.resolve(rel), columns=list(columns) if columns is not None else None).to_pandas()

    def read_slice(self, rel: str, offset: int, limit: int, columns: list[str] | None = None) -> pd.DataFrame:
        """Read rows [offset, offset+limit) touching only the needed row groups."""
        pf = pq.ParquetFile(self.resolve(rel))
        md = pf.metadata
        parts: list[pd.DataFrame] = []
        start = 0
        need_end = offset + limit
        for i in range(md.num_row_groups):
            n = md.row_group(i).num_rows
            end = start + n
            if end > offset and start < need_end:
                g = pf.read_row_group(i, columns=columns).to_pandas()
                parts.append(g.iloc[max(offset - start, 0): min(need_end - start, n)])
            start = end
            if start >= need_end:
                break
        if not parts:
            return pf.schema_arrow.empty_table().to_pandas()
        return pd.concat(parts, ignore_index=True)


def frame_hash(df: pd.DataFrame) -> str:
    h = hashlib.sha256()
    h.update("|".join(f"{c}:{t}" for c, t in zip(df.columns, df.dtypes.astype(str), strict=True)).encode())
    h.update(pd.util.hash_pandas_object(df, index=False).values.tobytes())
    return h.hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
