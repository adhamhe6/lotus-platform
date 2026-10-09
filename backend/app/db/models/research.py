"""Analyses, insights, visualizations, qualitative, mixed-methods, reports, AI, jobs, notifications."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime

from app.db.models.base import Base, created_at_col, uuid_pk


def _fk(target: str, *, ondelete: str = "CASCADE", nullable: bool = False, index: bool = True):
    return mapped_column(ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    dataset_version_id: Mapped[uuid.UUID] = _fk("dataset_versions.id")
    analysis_type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="PENDING", nullable=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    saved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = created_at_col()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("status in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')", name="status_valid"),
        Index("ix_analysis_runs_project_created", "project_id", "created_at"),
        # Idempotency: one live/completed run per (version, type, config). Failed runs may be retried.
        Index(
            "uq_analysis_runs_idempotent", "dataset_version_id", "analysis_type", "config_hash",
            unique=True, postgresql_where=text("status in ('PENDING','RUNNING','COMPLETED')"),
        ),
    )


class Insight(Base):
    __tablename__ = "insights"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    analysis_run_id: Mapped[uuid.UUID | None] = _fk("analysis_runs.id", nullable=True)
    mixed_run_id: Mapped[uuid.UUID | None] = _fk("mixed_method_runs.id", nullable=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)  # association | group_difference | trend | theme | mixed | ...
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    variables: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    qualification: Mapped[str] = mapped_column(String(12), nullable=False)  # strong | moderate | tentative
    origin: Mapped[str] = mapped_column(String(16), default="rule", nullable=False)  # rule (computed) | user
    narrative: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # AI interpretation, clearly separate
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = _fk("users.id", ondelete="SET NULL", nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (UniqueConstraint("project_id", "dedupe_key", name="uq_insights_project_dedupe"),)


class SavedVisualization(Base):
    __tablename__ = "saved_visualizations"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    dataset_version_id: Mapped[uuid.UUID] = _fk("dataset_versions.id")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    request: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = created_at_col()


# ----------------------------------------------------------------------------- qualitative


class ThemeDetectionRun(Base):
    __tablename__ = "theme_detection_runs"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    dataset_version_id: Mapped[uuid.UUID] = _fk("dataset_versions.id")
    column_name: Mapped[str] = mapped_column(String(300), nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    params_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(120), nullable=False)
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_by: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (UniqueConstraint("dataset_version_id", "column_name", "params_hash", name="uq_theme_runs_params"),)


class QualitativeSegment(Base):
    __tablename__ = "qualitative_segments"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    dataset_version_id: Mapped[uuid.UUID] = _fk("dataset_versions.id")
    column_name: Mapped[str] = mapped_column(String(300), nullable=False)
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    seg_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Any] = mapped_column(Vector(), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(120))
    __table_args__ = (
        UniqueConstraint("dataset_version_id", "column_name", "row_index", "seg_index", name="uq_segments_position"),
    )


class QualitativeCode(Base):
    __tablename__ = "qualitative_codes"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    color: Mapped[str] = mapped_column(String(9), default="#2f7f79", nullable=False)
    category: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    keywords: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    created_by: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_codes_project_name"),)


class QualitativeAnnotation(Base):
    __tablename__ = "qualitative_annotations"
    id: Mapped[uuid.UUID] = uuid_pk()
    segment_id: Mapped[uuid.UUID] = _fk("qualitative_segments.id")
    code_id: Mapped[uuid.UUID] = _fk("qualitative_codes.id")
    source: Mapped[str] = mapped_column(String(10), nullable=False)  # manual | keyword | semantic
    status: Mapped[str] = mapped_column(String(10), nullable=False)  # accepted | suggested | rejected
    score: Mapped[float | None] = mapped_column(Float)
    created_by: Mapped[uuid.UUID | None] = _fk("users.id", ondelete="SET NULL", nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        UniqueConstraint("segment_id", "code_id", name="uq_annotations_segment_code"),
        CheckConstraint("status in ('accepted','suggested','rejected')", name="status_valid"),
        CheckConstraint("source in ('manual','keyword','semantic')", name="source_valid"),
    )


class QualitativeTheme(Base):
    __tablename__ = "qualitative_themes"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    run_id: Mapped[uuid.UUID | None] = _fk("theme_detection_runs.id", nullable=True)
    dataset_version_id: Mapped[uuid.UUID] = _fk("dataset_versions.id")
    column_name: Mapped[str] = mapped_column(String(300), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    keywords: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # {text, origin: deterministic|ai, model, ...}
    origin: Mapped[str] = mapped_column(String(10), default="auto", nullable=False)  # auto | manual | merged
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = _fk("users.id", ondelete="SET NULL", nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    segments: Mapped[list[ThemeSegment]] = relationship(back_populates="theme", cascade="all, delete-orphan")


class ThemeSegment(Base):
    __tablename__ = "theme_segments"
    theme_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("qualitative_themes.id", ondelete="CASCADE"), primary_key=True)
    segment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("qualitative_segments.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    score: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(8), default="auto", nullable=False)  # auto | manual
    theme: Mapped[QualitativeTheme] = relationship(back_populates="segments")


class MixedMethodRun(Base):
    __tablename__ = "mixed_method_runs"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    dataset_version_id: Mapped[uuid.UUID] = _fk("dataset_versions.id")
    column_name: Mapped[str] = mapped_column(String(300), nullable=False)
    outcome_column: Mapped[str] = mapped_column(String(300), nullable=False)
    group_column: Mapped[str | None] = mapped_column(String(300))
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    theme_snapshot: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)  # theme ids+names+counts at run time
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    synthesis: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (UniqueConstraint("dataset_version_id", "config_hash", name="uq_mixed_runs_config"),)


# ----------------------------------------------------------------------------- reports / AI / jobs


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    objective: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sections: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    sources: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)  # runs / versions / insights referenced
    status: Mapped[str] = mapped_column(String(10), default="DRAFT", nullable=False)
    generation: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_by: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"), onupdate=text("now()"))


class AIConversation(Base):
    __tablename__ = "ai_conversations"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    dataset_version_id: Mapped[uuid.UUID | None] = _fk("dataset_versions.id", ondelete="SET NULL", nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    messages: Mapped[list[AIMessage]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="AIMessage.created_at"
    )


class AIMessage(Base):
    __tablename__ = "ai_messages"
    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = _fk("ai_conversations.id")
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    blocks: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    evidence: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)  # provider, model, prompt_version, validation
    created_at: Mapped[datetime] = created_at_col()
    conversation: Mapped[AIConversation] = relationship(back_populates="messages")
    __table_args__ = (CheckConstraint("role in ('user','assistant')", name="role_valid"),)


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = _fk("projects.id")
    user_id: Mapped[uuid.UUID] = _fk("users.id", ondelete="RESTRICT")
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="PENDING", nullable=False)
    stage: Mapped[str | None] = mapped_column(String(120))
    total_stages: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    completed_stages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    result_ref: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    idempotency_key: Mapped[str | None] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("status in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')", name="status_valid"),
        Index("ix_jobs_project_created", "project_id", "created_at"),
        Index(
            "uq_jobs_idempotency_active", "project_id", "idempotency_key",
            unique=True, postgresql_where=text("idempotency_key is not null and status in ('PENDING','RUNNING')"),
        ),
    )

    @property
    def progress(self) -> float:
        if self.status == "COMPLETED":
            return 1.0
        return round(self.completed_stages / self.total_stages, 3) if self.total_stages else 0.0


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    project_id: Mapped[uuid.UUID | None] = _fk("projects.id", nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    link: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)


__all__ = [n for n in dir() if n[0].isupper() and n not in {"Mapped", "Vector"}] + ["BigInteger", "Integer"]
