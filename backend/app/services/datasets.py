"""Dataset use-cases: upload, ingestion pipeline, versions, preview, profile."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis import cache_delete, cache_get, cache_set
from app.core.config import get_settings
from app.core.exceptions import DatasetProcessingError, NotFoundError, PayloadTooLarge, ValidationFailed
from app.datasets import ingest, profile, transform
from app.datasets.jsonable import frame_records, to_jsonable
from app.datasets.storage import Storage, sha256_file
from app.db.models import Dataset, DatasetColumn, DatasetVersion, User
from app.schemas.datasets import ColumnOut, PreviewFilter, PreviewOut, TransformPreviewOut, VersionOut
from app.services.projects import bump_project

log = logging.getLogger("lotus.datasets")
CELL_LIMIT = 2000


# ----------------------------------------------------------------------------- upload
async def save_upload(session: AsyncSession, storage: Storage, user: User, project_id: uuid.UUID, upload: UploadFile, name: str | None, description: str) -> Dataset:
    settings = get_settings()
    display = ingest.safe_display_name(upload.filename or "dataset")
    tmp = storage.tmp_path()
    size, head = 0, b""
    h = hashlib.sha256()
    try:
        with open(tmp, "wb") as f:
            while chunk := await upload.read(1 << 20):
                if not head:
                    head = chunk[:4096]
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise PayloadTooLarge(f"The file exceeds the {settings.max_upload_mb} MB upload limit.")
                h.update(chunk)
                f.write(chunk)
        file_type = ingest.detect_file_type(display, head, size, settings.max_upload_bytes)
        rel, final = storage.new_raw_path("csv" if file_type == "csv" else "xlsx")
        tmp.replace(final)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    ds = Dataset(project_id=project_id, name=(name or Path(display).stem)[:200] or "Dataset", description=description, original_filename=display, file_type=file_type,
                 status="PROCESSING", raw_path=rel, raw_size=size, raw_sha256=h.hexdigest(), created_by=user.id)
    session.add(ds)
    await session.flush()
    return ds


# ----------------------------------------------------------------------------- versions
async def persist_version(session: AsyncSession, storage: Storage, ds: Dataset, df: pd.DataFrame, *, kind: str, label: str, user_id: uuid.UUID,
                          parent_id: uuid.UUID | None, transformation: dict[str, Any] | None, warnings: list[dict[str, Any]]) -> DatasetVersion:
    cols, quality = profile.profile_frame(df)
    rel, content_hash = storage.write_frame(df)
    try:
        number = (await session.execute(select(func.coalesce(func.max(DatasetVersion.version_number), 0)).where(DatasetVersion.dataset_id == ds.id))).scalar_one() + 1
        v = DatasetVersion(dataset_id=ds.id, version_number=number, parent_version_id=parent_id, kind=kind, label=label, transformation=transformation, storage_path=rel,
                           row_count=len(df), column_count=df.shape[1], content_hash=content_hash, ingest_warnings=warnings, quality=to_jsonable(quality), created_by=user_id)
        session.add(v)
        await session.flush()
        for c in cols:
            session.add(DatasetColumn(version_id=v.id, **to_jsonable(c)))
        await session.flush()
    except Exception:
        storage.delete(rel)
        raise
    return v


async def ingest_dataset(session: AsyncSession, storage: Storage, dataset_id: uuid.UUID, stage) -> uuid.UUID:
    settings = get_settings()
    ds = await session.get(Dataset, dataset_id)
    if ds is None:
        raise NotFoundError("Dataset not found.")
    existing = (await session.execute(select(DatasetVersion.id).where(DatasetVersion.dataset_id == dataset_id, DatasetVersion.kind == "original"))).scalar_one_or_none()
    if existing:  # idempotent: a retried job must not create a second original version
        return existing
    try:
        await stage("Validating the uploaded file")
        raw = storage.resolve(ds.raw_path)
        with open(raw, "rb") as f:
            head = f.read(4096)
        ingest.detect_file_type(ds.original_filename, head, raw.stat().st_size, settings.max_upload_bytes)
        if sha256_file(raw) != ds.raw_sha256:
            raise DatasetProcessingError("The stored file failed its integrity check.", code="INTEGRITY_ERROR")
        await stage("Parsing rows and columns")
        result = await asyncio.to_thread(ingest.read_table, raw, ds.file_type, max_rows=settings.max_rows, max_columns=settings.max_columns)
        await stage("Inferring column types")
        await stage("Profiling variables")
        v = await persist_version(session, storage, ds, result.frame, kind="original", label="Original upload", user_id=ds.created_by, parent_id=None, transformation=None,
                                  warnings=result.warnings)
        await stage("Saving dataset version")
        ds.status, ds.error = "READY", None
        await bump_project(session, ds.project_id)
        await session.commit()
        return v.id
    except Exception as e:
        await session.rollback()
        ds = await session.get(Dataset, dataset_id)
        if ds is not None:
            code = getattr(e, "code", "DATASET_PROCESSING_FAILED")
            msg = getattr(e, "message", "The file could not be processed.")
            ds.status, ds.error = "FAILED", {"code": code, "message": msg}
            await session.commit()
        raise


async def load_frame(storage: Storage, version: DatasetVersion, columns: list[str] | None = None) -> pd.DataFrame:
    return await asyncio.to_thread(storage.read_frame, version.storage_path, columns)


async def apply_transform(session: AsyncSession, storage: Storage, ds: Dataset, parent: DatasetVersion, raw_ops: list[dict[str, Any]], label: str, user_id: uuid.UUID) -> DatasetVersion:
    ops = transform.parse_operations(raw_ops)
    df = await load_frame(storage, parent)
    new_df, log_ = await asyncio.to_thread(transform.apply_operations, df, ops)
    if len(new_df) == 0:
        raise ValidationFailed("The transformation would remove every row.", code="EMPTY_RESULT")
    content_hash = None
    existing = None
    # idempotency: same parent + same operations → return the existing version
    op_hash = hashlib.sha256(json.dumps(raw_ops, sort_keys=True, default=str).encode()).hexdigest()
    for v in (await session.execute(select(DatasetVersion).where(DatasetVersion.dataset_id == ds.id, DatasetVersion.parent_version_id == parent.id))).scalars():
        if (v.transformation or {}).get("ops_hash") == op_hash:
            existing = v
    if existing:
        return existing
    del content_hash
    summary = "; ".join(e["note"] for e in log_)[:190] or "Transformed"
    v = await persist_version(session, storage, ds, new_df, kind="transformed", label=label or summary, user_id=user_id, parent_id=parent.id,
                              transformation={"operations": raw_ops, "log": log_, "ops_hash": op_hash}, warnings=[])
    await bump_project(session, ds.project_id)
    await session.commit()
    return v


async def dry_run_transform(storage: Storage, parent: DatasetVersion, raw_ops: list[dict[str, Any]]) -> TransformPreviewOut:
    if parent.row_count > 300_000:
        raise ValidationFailed("This dataset is too large for an instant preview; apply the transformation to create a new version.", code="TOO_LARGE_FOR_PREVIEW")
    ops = transform.parse_operations(raw_ops)
    df = await load_frame(storage, parent)
    out, log_ = await asyncio.to_thread(transform.apply_operations, df, ops)
    return TransformPreviewOut(log=to_jsonable(log_), rows_before=len(df), rows_after=len(out), sample=frame_records(out.head(8)),
                               columns_after=[{"name": str(c), "semantic_type": profile.classify(out[c], str(c)).value} for c in out.columns])


# ----------------------------------------------------------------------------- reads
async def version_columns(session: AsyncSession, version_id: uuid.UUID) -> list[DatasetColumn]:
    return list((await session.execute(select(DatasetColumn).where(DatasetColumn.version_id == version_id).order_by(DatasetColumn.position))).scalars())


async def latest_version(session: AsyncSession, dataset_id: uuid.UUID) -> DatasetVersion | None:
    return (await session.execute(select(DatasetVersion).where(DatasetVersion.dataset_id == dataset_id).order_by(DatasetVersion.version_number.desc()).limit(1))).scalar_one_or_none()


async def profile_payload(session: AsyncSession, version: DatasetVersion) -> dict[str, Any]:
    key = f"profile:{version.id}"
    if (hit := await cache_get(key)) is not None:
        return hit
    cols = await version_columns(session, version.id)
    payload = {"version": VersionOut.model_validate(version).model_dump(mode="json"), "columns": [ColumnOut.model_validate(c).model_dump(mode="json") for c in cols]}
    await cache_set(key, payload, get_settings().cache_ttl_profile)
    return payload


async def preview(storage: Storage, version: DatasetVersion, columns_meta: list[DatasetColumn], page: int, page_size: int, sort: str | None, order: str,
                  filters: list[PreviewFilter], select_cols: list[str] | None) -> PreviewOut:
    settings = get_settings()
    page_size = max(1, min(page_size, settings.preview_max_page_size))
    names = [c.name for c in columns_meta]
    for col in ([f.column for f in filters] + ([sort] if sort else []) + (select_cols or [])):
        if col not in names:
            raise ValidationFailed(f"Unknown column '{col}'.", code="UNKNOWN_COLUMN")
    out_cols = select_cols or names
    key = "preview:%s:%s" % (version.id, hashlib.sha1(json.dumps([page, page_size, sort, order, [f.model_dump() for f in filters], out_cols], default=str).encode()).hexdigest())
    if (hit := await cache_get(key)) is not None:
        return PreviewOut.model_validate(hit)
    offset = (page - 1) * page_size
    if not filters and not sort:
        df = await asyncio.to_thread(storage.read_slice, version.storage_path, offset, page_size, out_cols)
        total = version.row_count
    else:
        full = await load_frame(storage, version)
        if filters:
            mask = pd.Series(True, index=full.index)
            for f in filters:
                mask &= transform.build_mask(full, f.column, f.operator, f.value)
            full = full[mask]
        if sort:
            full = full.sort_values(sort, ascending=(order != "desc"), kind="stable", na_position="last")
        total = len(full)
        df = full[out_cols].iloc[offset: offset + page_size]
    rows = frame_records(df)
    for r in rows:
        for k, v in r.items():
            if isinstance(v, str) and len(v) > CELL_LIMIT:
                r[k] = v[:CELL_LIMIT] + "…"
    meta = {c.name: c.semantic_type for c in columns_meta}
    out = PreviewOut(version_id=version.id, columns=[{"name": c, "semantic_type": meta[c]} for c in out_cols], rows=rows, total=total, page=page, page_size=page_size, row_offset=offset)
    if not filters:
        await cache_set(key, out.model_dump(mode="json"), settings.cache_ttl_profile)
    return out


async def delete_dataset_files(session: AsyncSession, storage: Storage, ds: Dataset) -> None:
    versions = (await session.execute(select(DatasetVersion).where(DatasetVersion.dataset_id == ds.id))).scalars().all()
    for v in versions:
        storage.delete(v.storage_path)
        await cache_delete(f"profile:{v.id}")
    storage.delete(ds.raw_path)
