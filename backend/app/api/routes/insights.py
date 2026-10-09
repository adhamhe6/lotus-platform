from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import case, select

from app.api.deps import CurrentUser, Session, ai_rate_limit
from app.db.models import AnalysisRun, Insight
from app.schemas.ai import InsightOut
from app.schemas.common import ERRORS
from app.schemas.core import JobOut
from app.services import access
from app.services import insights as svc
from app.services.projects import bump_project
from app.workers.runtime import create_job, dispatch

router = APIRouter(tags=["Insights"], responses={401: ERRORS[401], 404: ERRORS[404]})


async def _out(session, i: Insight) -> InsightOut:
    run = await session.get(AnalysisRun, i.analysis_run_id) if i.analysis_run_id else None
    return InsightOut.model_validate(svc.insight_out(i, run))


@router.get(
    "/projects/{project_id}/insights",
    response_model=list[InsightOut],
    summary="Insights with their evidence (strongest first)",
)
async def list_insights(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    kind: str | None = None,
    pinned: bool | None = None,
    analysis_run_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[InsightOut]:
    await access.require_project(session, user, project_id)
    q = select(Insight).where(Insight.project_id == project_id)
    if kind:
        q = q.where(Insight.kind == kind)
    if pinned is not None:
        q = q.where(Insight.pinned == pinned)
    if analysis_run_id:
        q = q.where(Insight.analysis_run_id == analysis_run_id)
    rank = case((Insight.qualification == "strong", 0), (Insight.qualification == "moderate", 1), else_=2)
    rows = (
        (
            await session.execute(
                q.order_by(Insight.pinned.desc(), rank, Insight.created_at.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [await _out(session, i) for i in rows]


class GenerateIn(BaseModel):
    analysis_run_ids: list[uuid.UUID] | None = None
    with_narratives: bool = False


@router.post(
    "/projects/{project_id}/insights/generate",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="(Re)derive insights from completed analyses; optionally add AI narratives (async)",
)
async def generate(project_id: uuid.UUID, body: GenerateIn, user: CurrentUser, session: Session) -> JobOut:
    """Insights are rule-derived from computed results using explicit thresholds (n ≥ 30, p < 0.05, minimum effect size). Re-running is idempotent."""
    await access.require_project(session, user, project_id, "EDITOR")
    j = await create_job(
        session,
        project_id=project_id,
        user_id=user.id,
        type_="generate_insights",
        params={
            "project_id": str(project_id),
            "run_ids": [str(r) for r in body.analysis_run_ids] if body.analysis_run_ids else None,
            "with_narratives": body.with_narratives,
        },
    )
    await session.commit()
    await dispatch(j.id)
    await session.refresh(j)
    return JobOut.model_validate(j)


@router.get(
    "/insights/{insight_id}",
    response_model=InsightOut,
    summary="Insight with evidence and source analysis (explainability)",
)
async def get_insight(insight_id: uuid.UUID, user: CurrentUser, session: Session) -> InsightOut:
    return await _out(session, await access.get_insight(session, user, insight_id))


@router.post("/insights/{insight_id}/pin", response_model=InsightOut, summary="Pin / unpin an insight")
async def pin(insight_id: uuid.UUID, user: CurrentUser, session: Session, pinned: bool = True) -> InsightOut:
    i = await access.get_insight(session, user, insight_id, "EDITOR")
    i.pinned = pinned
    await bump_project(session, i.project_id)
    await session.commit()
    return await _out(session, i)


@router.post(
    "/insights/{insight_id}/narrative",
    response_model=InsightOut,
    dependencies=[Depends(ai_rate_limit)],
    summary="Generate the AI interpretation of this insight (stored separately from the computed statement)",
)
async def narrative(insight_id: uuid.UUID, user: CurrentUser, session: Session) -> InsightOut:
    i = await access.get_insight(session, user, insight_id, "EDITOR")
    await svc.narrate_insight(session, i)
    return await _out(session, i)


@router.delete("/insights/{insight_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an insight")
async def delete_insight(insight_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    i = await access.get_insight(session, user, insight_id, "EDITOR")
    pid = i.project_id
    await session.delete(i)
    await bump_project(session, pid)
    await session.commit()
