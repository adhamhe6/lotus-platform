from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ORM


class ConversationCreate(BaseModel):
    dataset_version_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=200)


class ConversationOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    dataset_version_id: uuid.UUID | None
    title: str
    created_at: datetime


class MessageIn(BaseModel):
    content: str = Field(min_length=2, max_length=2000)


class MessageOut(ORM):
    id: uuid.UUID
    role: str
    content: str
    blocks: list[Any]
    evidence: list[Any]
    meta: dict[str, Any]
    created_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class InsightOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    analysis_run_id: uuid.UUID | None
    mixed_run_id: uuid.UUID | None
    kind: str
    title: str
    statement: str
    evidence: list[Any]
    variables: list[Any]
    qualification: str
    origin: str
    narrative: dict[str, Any] | None
    pinned: bool
    created_at: datetime
    source: dict[str, Any] | None = None


class MixedRunIn(BaseModel):
    dataset_version_id: uuid.UUID
    text_column: str
    outcome: str
    group: str | None = None
    compare: list[str] | None = None
    source: str = Field(default="themes", pattern="^(themes|codes)$")
    theme_run_id: uuid.UUID | None = None


class MixedRunOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    dataset_version_id: uuid.UUID
    column_name: str
    outcome_column: str
    group_column: str | None
    config: dict[str, Any]
    theme_snapshot: list[Any]
    result: dict[str, Any]
    synthesis: dict[str, Any] | None
    created_at: datetime
