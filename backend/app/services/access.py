"""Authorization: every resource is reached through its project membership. Non-members get 404 (no existence leak)."""

from __future__ import annotations

import uuid
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.db.models import (
    AIConversation,
    AnalysisJob,
    AnalysisRun,
    Dataset,
    DatasetVersion,
    Insight,
    MixedMethodRun,
    Project,
    ProjectMember,
    QualitativeCode,
    QualitativeSegment,
    QualitativeTheme,
    Report,
    SavedVisualization,
    User,
)

RANK = {"VIEWER": 1, "EDITOR": 2, "OWNER": 3}
T = TypeVar("T")


async def project_role(session: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID) -> str | None:
    return (
        await session.execute(
            select(ProjectMember.role).where(
                ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
            )
        )
    ).scalar_one_or_none()


async def require_project(
    session: AsyncSession, user: User, project_id: uuid.UUID, min_role: str = "VIEWER"
) -> tuple[Project, str]:
    role = await project_role(session, user.id, project_id)
    if role is None:
        raise NotFoundError("Project not found.", code="PROJECT_NOT_FOUND")
    if RANK[role] < RANK[min_role]:
        raise PermissionDeniedError(
            f"This action requires {min_role.lower()} access to the project.", code="INSUFFICIENT_ROLE"
        )
    project = await session.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found.", code="PROJECT_NOT_FOUND")
    return project, role


async def _scoped(
    session: AsyncSession, model: type[T], obj_id: uuid.UUID, user: User, min_role: str, label: str
) -> T:
    obj = await session.get(model, obj_id)
    if obj is None:
        raise NotFoundError(f"{label} not found.", code=f"{label.upper().replace(' ', '_')}_NOT_FOUND")
    await require_project(session, user, obj.project_id, min_role)  # type: ignore[attr-defined]
    return obj


async def get_dataset(
    session: AsyncSession, user: User, dataset_id: uuid.UUID, min_role: str = "VIEWER"
) -> Dataset:
    return await _scoped(session, Dataset, dataset_id, user, min_role, "Dataset")


async def get_version(
    session: AsyncSession, user: User, version_id: uuid.UUID, min_role: str = "VIEWER"
) -> tuple[DatasetVersion, Dataset]:
    v = await session.get(DatasetVersion, version_id)
    if v is None:
        raise NotFoundError("Dataset version not found.", code="DATASET_VERSION_NOT_FOUND")
    ds = await get_dataset(session, user, v.dataset_id, min_role)
    return v, ds


async def version_in_project(
    session: AsyncSession, project_id: uuid.UUID, version_id: uuid.UUID
) -> tuple[DatasetVersion, Dataset]:
    """Resolve a version and make sure it belongs to the given (already authorized) project — prevents cross-project references."""
    v = await session.get(DatasetVersion, version_id)
    ds = await session.get(Dataset, v.dataset_id) if v else None
    if v is None or ds is None or ds.project_id != project_id:
        raise NotFoundError("Dataset version not found in this project.", code="DATASET_VERSION_NOT_FOUND")
    return v, ds


async def get_run(
    session: AsyncSession, user: User, run_id: uuid.UUID, min_role: str = "VIEWER"
) -> AnalysisRun:
    return await _scoped(session, AnalysisRun, run_id, user, min_role, "Analysis")


async def get_insight(
    session: AsyncSession, user: User, insight_id: uuid.UUID, min_role: str = "VIEWER"
) -> Insight:
    return await _scoped(session, Insight, insight_id, user, min_role, "Insight")


async def get_report(
    session: AsyncSession, user: User, report_id: uuid.UUID, min_role: str = "VIEWER"
) -> Report:
    return await _scoped(session, Report, report_id, user, min_role, "Report")


async def get_job(
    session: AsyncSession, user: User, job_id: uuid.UUID, min_role: str = "VIEWER"
) -> AnalysisJob:
    return await _scoped(session, AnalysisJob, job_id, user, min_role, "Job")


async def get_theme(
    session: AsyncSession, user: User, theme_id: uuid.UUID, min_role: str = "VIEWER"
) -> QualitativeTheme:
    return await _scoped(session, QualitativeTheme, theme_id, user, min_role, "Theme")


async def get_code(
    session: AsyncSession, user: User, code_id: uuid.UUID, min_role: str = "VIEWER"
) -> QualitativeCode:
    return await _scoped(session, QualitativeCode, code_id, user, min_role, "Code")


async def get_segment(
    session: AsyncSession, user: User, segment_id: uuid.UUID, min_role: str = "VIEWER"
) -> QualitativeSegment:
    return await _scoped(session, QualitativeSegment, segment_id, user, min_role, "Segment")


async def get_visualization(
    session: AsyncSession, user: User, viz_id: uuid.UUID, min_role: str = "VIEWER"
) -> SavedVisualization:
    return await _scoped(session, SavedVisualization, viz_id, user, min_role, "Visualization")


async def get_mixed(
    session: AsyncSession, user: User, run_id: uuid.UUID, min_role: str = "VIEWER"
) -> MixedMethodRun:
    return await _scoped(session, MixedMethodRun, run_id, user, min_role, "Mixed methods run")


async def get_conversation(session: AsyncSession, user: User, conv_id: uuid.UUID) -> AIConversation:
    conv = await _scoped(session, AIConversation, conv_id, user, "VIEWER", "Conversation")
    if conv.user_id != user.id:  # conversations are private to their author even inside a shared project
        raise NotFoundError("Conversation not found.", code="CONVERSATION_NOT_FOUND")
    return conv
