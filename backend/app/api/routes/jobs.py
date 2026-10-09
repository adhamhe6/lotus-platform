from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select, update

from app.api.deps import CurrentUser, Session
from app.db.models import AnalysisJob, Notification
from app.schemas.common import ERRORS
from app.schemas.core import JobOut, NotificationOut
from app.services import access

router = APIRouter(tags=["Jobs & notifications"], responses={401: ERRORS[401], 404: ERRORS[404]})


@router.get("/jobs/{job_id}", response_model=JobOut, summary="Job status with real stage-based progress")
async def get_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobOut:
    return JobOut.model_validate(await access.get_job(session, user, job_id))


@router.get("/projects/{project_id}/jobs", response_model=list[JobOut], summary="Recent jobs in a project")
async def list_jobs(project_id: uuid.UUID, user: CurrentUser, session: Session, status_: Annotated[str | None, Query(alias="status")] = None, limit: Annotated[int, Query(ge=1, le=100)] = 30) -> list[JobOut]:
    await access.require_project(session, user, project_id)
    q = select(AnalysisJob).where(AnalysisJob.project_id == project_id)
    if status_:
        q = q.where(AnalysisJob.status == status_.upper())
    rows = (await session.execute(q.order_by(AnalysisJob.created_at.desc()).limit(limit))).scalars().all()
    return [JobOut.model_validate(j) for j in rows]


@router.post("/jobs/{job_id}/cancel", response_model=JobOut, summary="Request cancellation (cooperative: takes effect at the next stage boundary)")
async def cancel_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobOut:
    j = await access.get_job(session, user, job_id, "EDITOR")
    if j.status in ("PENDING", "RUNNING"):
        j.cancel_requested = True
        if j.status == "PENDING":
            j.status, j.completed_at, j.stage = "CANCELLED", datetime.now(UTC), "Cancelled"
        await session.commit()
    return JobOut.model_validate(j)


@router.get("/notifications", response_model=list[NotificationOut], summary="Your notifications (newest first)")
async def notifications(user: CurrentUser, session: Session, unread_only: bool = False, limit: Annotated[int, Query(ge=1, le=100)] = 30) -> list[NotificationOut]:
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    rows = (await session.execute(q.order_by(Notification.created_at.desc()).limit(limit))).scalars().all()
    return [NotificationOut.model_validate(n) for n in rows]


@router.get("/notifications/unread-count", summary="Number of unread notifications")
async def unread_count(user: CurrentUser, session: Session) -> dict[str, int]:
    n = (await session.execute(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)))).scalar_one()
    return {"count": n}


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Mark all notifications as read")
async def read_all(user: CurrentUser, session: Session) -> None:
    await session.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    await session.commit()


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT, summary="Mark one notification as read")
async def read_one(notification_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    await session.execute(update(Notification).where(Notification.id == notification_id, Notification.user_id == user.id).values(read_at=datetime.now(UTC)))
    await session.commit()
