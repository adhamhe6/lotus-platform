from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import CurrentUser, Session, ai_rate_limit
from app.db.models import MixedMethodRun
from app.schemas.ai import MixedRunIn, MixedRunOut
from app.schemas.common import ERRORS
from app.schemas.core import JobOut
from app.services import access
from app.services import mixed as svc
from app.workers.runtime import create_job, dispatch

router = APIRouter(tags=["Mixed methods"], responses={401: ERRORS[401], 404: ERRORS[404]})


@router.post(
    "/projects/{project_id}/mixed",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Integrate qualitative themes/codes with quantitative evidence (async)",
)
async def create(project_id: uuid.UUID, body: MixedRunIn, user: CurrentUser, session: Session) -> JobOut:
    """For each theme (or accepted code), compares the outcome — and optional comparison variables — between respondents who voiced it and those who did not,
    with effect sizes and Holm-corrected p-values. Findings are emitted only when explicit evidence thresholds are met."""
    await access.require_project(session, user, project_id, "EDITOR")
    await access.version_in_project(session, project_id, body.dataset_version_id)
    j = await create_job(
        session,
        project_id=project_id,
        user_id=user.id,
        type_="mixed_methods",
        params={**body.model_dump(mode="json"), "project_id": str(project_id), "user_id": str(user.id)},
    )
    await session.commit()
    await dispatch(j.id)
    await session.refresh(j)
    return JobOut.model_validate(j)


@router.get("/projects/{project_id}/mixed", response_model=list[MixedRunOut], summary="Mixed-methods runs")
async def list_runs(project_id: uuid.UUID, user: CurrentUser, session: Session) -> list[MixedRunOut]:
    await access.require_project(session, user, project_id)
    rows = (
        (
            await session.execute(
                select(MixedMethodRun)
                .where(MixedMethodRun.project_id == project_id)
                .order_by(MixedMethodRun.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [MixedRunOut.model_validate(r) for r in rows]


@router.get(
    "/mixed/{run_id}", response_model=MixedRunOut, summary="One mixed-methods run (joint display data)"
)
async def get_run(run_id: uuid.UUID, user: CurrentUser, session: Session) -> MixedRunOut:
    return MixedRunOut.model_validate(await access.get_mixed(session, user, run_id))


@router.post(
    "/mixed/{run_id}/synthesis",
    response_model=MixedRunOut,
    dependencies=[Depends(ai_rate_limit)],
    summary="Generate the integrated interpretation (AI or rule-based; clearly labelled)",
)
async def synthesize(run_id: uuid.UUID, user: CurrentUser, session: Session) -> MixedRunOut:
    run = await access.get_mixed(session, user, run_id, "EDITOR")
    await svc.synthesize(session, run)
    return MixedRunOut.model_validate(run)


@router.delete(
    "/mixed/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a mixed-methods run and its insights",
)
async def delete(run_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    run = await access.get_mixed(session, user, run_id, "EDITOR")
    await session.delete(run)
    await session.commit()
