from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORM
from app.schemas.core import JobOut


class AnalysisCreate(BaseModel):
    dataset_version_id: uuid.UUID
    analysis_type: str
    config: dict[str, Any]
    title: str | None = Field(default=None, max_length=300)


class AnalysisUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    saved: bool | None = None


class AnalysisSummary(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    dataset_version_id: uuid.UUID
    analysis_type: str
    title: str
    config: dict[str, Any]
    status: str
    error: dict[str, Any] | None
    duration_ms: int | None
    saved: bool
    created_by: uuid.UUID
    created_at: datetime
    completed_at: datetime | None
    headline: dict[str, Any] | None = None


class AnalysisDetail(AnalysisSummary):
    result: dict[str, Any] | None
    provenance: dict[str, Any]
    dataset_name: str | None = None
    version_label: str | None = None
    version_number: int | None = None


class AnalysisCreated(BaseModel):
    analysis: AnalysisDetail
    job: JobOut | None
    reused: bool


class VisualizationCreate(BaseModel):
    dataset_version_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    request: dict[str, Any]


class VisualizationOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    dataset_version_id: uuid.UUID
    name: str
    request: dict[str, Any]
    spec: dict[str, Any]
    created_at: datetime
