from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORM
from app.schemas.core import JobOut


class ColumnOut(ORM):
    position: int
    name: str
    dtype: str
    semantic_type: str
    missing_count: int
    missing_pct: float
    unique_count: int
    profile: dict[str, Any]


class VersionOut(ORM):
    id: uuid.UUID
    dataset_id: uuid.UUID
    version_number: int
    parent_version_id: uuid.UUID | None
    kind: str
    label: str
    transformation: dict[str, Any] | None
    row_count: int
    column_count: int
    content_hash: str
    ingest_warnings: list[Any]
    quality: dict[str, Any]
    created_by: uuid.UUID
    created_at: datetime


class DatasetOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str
    original_filename: str
    file_type: str
    status: str
    error: dict[str, Any] | None
    raw_size: int
    created_at: datetime
    latest_version: VersionOut | None = None
    version_count: int = 0


class UploadResponse(BaseModel):
    dataset: DatasetOut
    job: JobOut
    warnings: list[str] = Field(default_factory=list)


class DatasetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)


class ProfileOut(BaseModel):
    version: VersionOut
    columns: list[ColumnOut]


class PreviewFilter(BaseModel):
    column: str
    operator: str
    value: Any = None


class PreviewOut(BaseModel):
    version_id: uuid.UUID
    columns: list[dict[str, str]]
    rows: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
    row_offset: int


class TransformIn(BaseModel):
    parent_version_id: uuid.UUID | None = None
    label: str = Field(default="", max_length=200)
    operations: list[dict[str, Any]] = Field(min_length=1, max_length=30)
    dry_run: bool = False


class TransformPreviewOut(BaseModel):
    log: list[dict[str, Any]]
    rows_before: int
    rows_after: int
    columns_after: list[dict[str, str]]
    sample: list[dict[str, Any]]
