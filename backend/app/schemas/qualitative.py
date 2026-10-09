from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORM


class PrepareIn(BaseModel):
    dataset_version_id: uuid.UUID
    column: str
    split: Literal["auto", "none", "sentences"] = "auto"


class DetectThemesIn(BaseModel):
    dataset_version_id: uuid.UUID
    column: str
    n_themes: int | None = Field(
        default=None, ge=2, le=15, description="Leave empty to choose k by silhouette score."
    )


class CodeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    color: str = Field(default="#2f7f79", pattern=r"^#[0-9a-fA-F]{6}$")
    category: str = Field(default="", max_length=120)
    keywords: list[str] = Field(
        default_factory=list, max_length=60, description="Whole-word matches; 'deliver*' matches any suffix."
    )


class CodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    category: str | None = Field(default=None, max_length=120)
    keywords: list[str] | None = Field(default=None, max_length=60)


class CodeOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str
    color: str
    category: str
    keywords: list[Any]
    created_at: datetime
    accepted_count: int = 0
    suggested_count: int = 0


class AnnotationOut(ORM):
    id: uuid.UUID
    segment_id: uuid.UUID
    code_id: uuid.UUID
    source: str
    status: str
    score: float | None


class AnnotationCreate(BaseModel):
    code_id: uuid.UUID


class AnnotationReview(BaseModel):
    annotation_ids: list[uuid.UUID] = Field(min_length=1, max_length=2000)
    status: Literal["accepted", "rejected"]


class SuggestCodesIn(BaseModel):
    dataset_version_id: uuid.UUID
    column: str
    semantic_threshold: float = Field(default=0.55, ge=0.2, le=0.95)
    use_semantic: bool = True


class SegmentOut(BaseModel):
    id: uuid.UUID
    row_index: int
    seg_index: int
    text: str
    themes: list[dict[str, Any]]
    annotations: list[AnnotationOut]


class ThemeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)


class ThemeCreate(BaseModel):
    dataset_version_id: uuid.UUID
    column: str
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)


class ThemeMerge(BaseModel):
    theme_ids: list[uuid.UUID] = Field(min_length=2, max_length=15)
    name: str | None = Field(default=None, min_length=1, max_length=160)


class ThemeSegmentIn(BaseModel):
    segment_id: uuid.UUID


class ThemeOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    run_id: uuid.UUID | None
    dataset_version_id: uuid.UUID
    column_name: str
    name: str
    description: str
    keywords: list[Any]
    summary: dict[str, Any] | None
    origin: str
    position: int
    segment_count: int
    response_count: int
    share_pct: float
    examples: list[dict[str, Any]]
    created_at: datetime
