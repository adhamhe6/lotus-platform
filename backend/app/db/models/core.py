"""Users, projects, membership, datasets and versions."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, created_at_col, updated_at_col, uuid_pk


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("uq_users_email_lower", func.lower(email), unique=True),)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()
    user_agent: Mapped[str | None] = mapped_column(String(300))


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    objective: Mapped[str] = mapped_column(Text, default="", nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    revision: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )  # bumped on content change (cache busting)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    members: Mapped[list[ProjectMember]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ProjectMember(Base):
    __tablename__ = "project_members"
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship()
    __table_args__ = (CheckConstraint("role in ('OWNER','EDITOR','VIEWER')", name="role_valid"),)


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    original_filename: Mapped[str] = mapped_column(String(300), nullable=False)
    file_type: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="PROCESSING", nullable=False)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    raw_path: Mapped[str] = mapped_column(String(300), nullable=False)
    raw_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    raw_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = created_at_col()
    versions: Mapped[list[DatasetVersion]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan", order_by="DatasetVersion.version_number"
    )
    __table_args__ = (
        CheckConstraint("status in ('PROCESSING','READY','FAILED')", name="status_valid"),
        Index("ix_datasets_project_created", "project_id", "created_at"),
    )


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"
    id: Mapped[uuid.UUID] = uuid_pk()
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String(12), nullable=False)  # original | transformed
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    transformation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    storage_path: Mapped[str] = mapped_column(String(300), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    ingest_warnings: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    quality: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = created_at_col()
    dataset: Mapped[Dataset] = relationship(back_populates="versions")
    columns: Mapped[list[DatasetColumn]] = relationship(
        back_populates="version", cascade="all, delete-orphan", order_by="DatasetColumn.position"
    )
    __table_args__ = (
        UniqueConstraint("dataset_id", "version_number", name="uq_dataset_versions_dataset_number"),
        CheckConstraint("kind in ('original','transformed')", name="kind_valid"),
    )


class DatasetColumn(Base):
    __tablename__ = "dataset_columns"
    id: Mapped[uuid.UUID] = uuid_pk()
    version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    dtype: Mapped[str] = mapped_column(String(40), nullable=False)
    semantic_type: Mapped[str] = mapped_column(String(24), nullable=False)
    missing_count: Mapped[int] = mapped_column(Integer, nullable=False)
    missing_pct: Mapped[float] = mapped_column(nullable=False)
    unique_count: Mapped[int] = mapped_column(Integer, nullable=False)
    profile: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    version: Mapped[DatasetVersion] = relationship(back_populates="columns")
    __table_args__ = (UniqueConstraint("version_id", "name", name="uq_dataset_columns_version_name"),)


__all__ = [
    "UUID",
    "Dataset",
    "DatasetColumn",
    "DatasetVersion",
    "Project",
    "ProjectMember",
    "RefreshToken",
    "User",
]
