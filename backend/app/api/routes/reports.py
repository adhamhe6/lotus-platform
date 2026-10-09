from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, Session
from app.db.models import Project, Report
from app.schemas.common import ERRORS, ORM
from app.schemas.core import JobOut
from app.services import access
from app.services import reports as svc
from app.services.projects import bump_project
from app.workers.runtime import create_job, dispatch

router = APIRouter(tags=["Reports"], responses={401: ERRORS[401], 404: ERRORS[404]})


class ReportOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    objective: str
    sections: list[Any]
    sources: dict[str, Any]
    status: str
    generation: dict[str, Any]
    created_at: datetime
    updated_at: datetime | None


class ReportCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    objective: str = Field(default="", max_length=4000)
    sections: list[dict[str, Any]] = Field(default_factory=list, max_length=80)


class ReportUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    objective: str | None = Field(default=None, max_length=4000)
    sections: list[dict[str, Any]] | None = Field(default=None, max_length=80)
    status: Literal["DRAFT", "READY"] | None = None


class GenerateReportIn(BaseModel):
    title: str = Field(default="", max_length=300)
    dataset_version_id: uuid.UUID | None = None
    with_ai: bool = False


def _clean(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for s in sections:
        s = {k: v for k, v in s.items() if k in ("id", "type", "title", "body", "ref", "meta", "evidence")}
        s.setdefault("id", uuid.uuid4().hex[:12])
        s["title"] = str(s.get("title", ""))[:300]
        if "body" in s:
            s["body"] = str(s["body"])[:20000]
        out.append(s)
    return out


@router.get("/projects/{project_id}/reports", response_model=list[ReportOut], summary="Reports in a project")
async def list_reports(project_id: uuid.UUID, user: CurrentUser, session: Session) -> list[ReportOut]:
    await access.require_project(session, user, project_id)
    rows = (
        (
            await session.execute(
                select(Report).where(Report.project_id == project_id).order_by(Report.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [ReportOut.model_validate(r) for r in rows]


@router.post(
    "/projects/{project_id}/reports",
    response_model=ReportOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a report from explicit sections",
)
async def create_report(
    project_id: uuid.UUID, body: ReportCreate, user: CurrentUser, session: Session
) -> ReportOut:
    await access.require_project(session, user, project_id, "EDITOR")
    sections = _clean(body.sections)
    sources = await svc.validate_sections(session, project_id, sections)
    r = Report(
        project_id=project_id,
        title=body.title.strip(),
        objective=body.objective,
        sections=sections,
        sources=sources,
        created_by=user.id,
        generation={"manual": True},
    )
    session.add(r)
    await bump_project(session, project_id)
    await session.commit()
    await session.refresh(r)
    return ReportOut.model_validate(r)


@router.post(
    "/projects/{project_id}/reports/generate",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Draft a report from the project's analyses, insights, themes and visualizations (async)",
)
async def generate_report(
    project_id: uuid.UUID, body: GenerateReportIn, user: CurrentUser, session: Session
) -> JobOut:
    await access.require_project(session, user, project_id, "EDITOR")
    if body.dataset_version_id:
        await access.version_in_project(session, project_id, body.dataset_version_id)
    j = await create_job(
        session,
        project_id=project_id,
        user_id=user.id,
        type_="generate_report",
        params={**body.model_dump(mode="json"), "project_id": str(project_id), "user_id": str(user.id)},
    )
    await session.commit()
    await dispatch(j.id)
    await session.refresh(j)
    return JobOut.model_validate(j)


@router.get("/reports/{report_id}", response_model=ReportOut, summary="Get a report")
async def get_report(report_id: uuid.UUID, user: CurrentUser, session: Session) -> ReportOut:
    return ReportOut.model_validate(await access.get_report(session, user, report_id))


@router.put(
    "/reports/{report_id}", response_model=ReportOut, summary="Edit title / reorder, add or remove sections"
)
async def update_report(
    report_id: uuid.UUID, body: ReportUpdate, user: CurrentUser, session: Session
) -> ReportOut:
    r = await access.get_report(session, user, report_id, "EDITOR")
    if body.title is not None:
        r.title = body.title.strip()
    if body.objective is not None:
        r.objective = body.objective
    if body.status is not None:
        r.status = body.status
    if body.sections is not None:
        secs = _clean(body.sections)
        r.sources = await svc.validate_sections(session, r.project_id, secs)
        r.sections = secs
    await bump_project(session, r.project_id)
    await session.commit()
    await session.refresh(r)
    return ReportOut.model_validate(r)


@router.delete("/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a report")
async def delete_report(report_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    r = await access.get_report(session, user, report_id, "EDITOR")
    pid = r.project_id
    await session.delete(r)
    await bump_project(session, pid)
    await session.commit()


@router.get(
    "/reports/{report_id}/render",
    summary="Render for viewing/printing/export: html (print to PDF), markdown or json",
)
async def render(
    report_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    format: Annotated[Literal["html", "markdown", "json"], Query()] = "html",
) -> Response:
    r = await access.get_report(session, user, report_id)
    project = await session.get(Project, r.project_id)
    assert project is not None
    if format == "json":
        return Response(ReportOut.model_validate(r).model_dump_json(), media_type="application/json")
    if format == "markdown":
        md = svc.render_markdown(await svc.markdown_sections(session, r), r)
        return Response(
            md,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="report-{str(r.id)[:8]}.md"'},
        )
    html = await svc.render_html(session, r, project, user.full_name)
    return Response(
        html,
        media_type="text/html; charset=utf-8",
        headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:"},
    )
