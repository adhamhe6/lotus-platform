from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models import (
    AnalysisRun,
    Dataset,
    Insight,
    Project,
    ProjectMember,
    QualitativeTheme,
    Report,
    User,
)
from app.schemas.core import MemberOut, ProjectOut


async def create_project(
    session: AsyncSession, user: User, name: str, description: str, objective: str
) -> Project:
    p = Project(
        name=name.strip(), description=description.strip(), objective=objective.strip(), owner_id=user.id
    )
    session.add(p)
    await session.flush()
    session.add(ProjectMember(project_id=p.id, user_id=user.id, role="OWNER"))
    await session.commit()
    return p


async def bump_project(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Content changed → bump the revision used in cache keys (flushes the dashboard cache implicitly)."""
    await session.execute(
        update(Project).where(Project.id == project_id).values(revision=Project.revision + 1)
    )


async def project_counts(
    session: AsyncSession, project_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict[str, int]]:
    out: dict[uuid.UUID, dict[str, int]] = {pid: {} for pid in project_ids}
    if not project_ids:
        return out
    models: list[tuple[str, Any]] = [
        ("datasets", Dataset),
        ("analyses", AnalysisRun),
        ("insights", Insight),
        ("reports", Report),
        ("themes", QualitativeTheme),
    ]
    for key, model in models:
        rows = await session.execute(
            select(model.project_id, func.count())
            .where(model.project_id.in_(project_ids))
            .group_by(model.project_id)
        )
        for pid, n in rows:
            out[pid][key] = n
    return out


async def list_projects(session: AsyncSession, user: User) -> list[ProjectOut]:
    rows = (
        await session.execute(
            select(Project, ProjectMember.role)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user.id)
            .order_by(Project.updated_at.desc())
        )
    ).all()
    counts = await project_counts(session, [p.id for p, _ in rows])
    return [
        ProjectOut.model_validate(p).model_copy(update={"role": role, "counts": counts[p.id]})
        for p, role in rows
    ]


async def members(session: AsyncSession, project_id: uuid.UUID) -> list[MemberOut]:
    rows = (
        await session.execute(
            select(ProjectMember, User)
            .join(User, User.id == ProjectMember.user_id)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at)
        )
    ).all()
    return [MemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role) for m, u in rows]


async def add_member(session: AsyncSession, project_id: uuid.UUID, email: str, role: str) -> MemberOut:
    user = (
        await session.execute(select(User).where(func.lower(User.email) == email.strip().lower()))
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("No registered user has that e-mail address.", code="USER_NOT_FOUND")
    exists = await session.get(ProjectMember, (project_id, user.id))
    if exists:
        raise ConflictError("That user is already a member of the project.", code="ALREADY_MEMBER")
    session.add(ProjectMember(project_id=project_id, user_id=user.id, role=role))
    await session.commit()
    return MemberOut(user_id=user.id, email=user.email, full_name=user.full_name, role=role)  # type: ignore[arg-type,unused-ignore]


async def change_member(
    session: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID, role: str | None
) -> None:
    m = await session.get(ProjectMember, (project_id, user_id))
    if m is None:
        raise NotFoundError("Member not found.", code="MEMBER_NOT_FOUND")
    if m.role == "OWNER":
        raise ConflictError("The owner cannot be changed or removed.", code="OWNER_PROTECTED")
    if role is None:
        await session.execute(
            delete(ProjectMember).where(
                ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
            )
        )
    else:
        m.role = role
    await session.commit()
