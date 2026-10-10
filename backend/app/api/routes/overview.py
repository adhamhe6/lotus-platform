from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import case, func, select

from app.api.deps import CurrentUser, Session
from app.cache.redis import cache_get, cache_set
from app.core.config import get_settings
from app.db.models import (
    AnalysisJob,
    AnalysisRun,
    Dataset,
    DatasetVersion,
    Insight,
    MixedMethodRun,
    Project,
    ProjectMember,
    QualitativeCode,
    QualitativeTheme,
    Report,
    SavedVisualization,
)
from app.schemas.common import ERRORS
from app.services import access
from app.services import qualitative as qual_service

router = APIRouter(tags=["Overview & search"], responses={401: ERRORS[401], 404: ERRORS[404]})


@router.get(
    "/projects/{project_id}/overview",
    summary="Project dashboard: datasets, health, recent analyses, key insights, themes, activity (cached per project revision)",
)
async def overview(project_id: uuid.UUID, user: CurrentUser, session: Session) -> dict[str, Any]:
    project, role = await access.require_project(session, user, project_id)
    key = f"dash:{project_id}:{project.revision}"
    if (hit := await cache_get(key)) is not None:
        return {**hit, "role": role, "cached": True}
    datasets = []
    for d in (
        await session.execute(
            select(Dataset).where(Dataset.project_id == project_id).order_by(Dataset.created_at.desc())
        )
    ).scalars():
        v = (
            await session.execute(
                select(DatasetVersion)
                .where(DatasetVersion.dataset_id == d.id)
                .order_by(DatasetVersion.version_number.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        nv = (
            await session.execute(
                select(func.count()).select_from(DatasetVersion).where(DatasetVersion.dataset_id == d.id)
            )
        ).scalar_one()
        q = v.quality if v else {}
        datasets.append(
            {
                "id": str(d.id),
                "name": d.name,
                "status": d.status,
                "error": d.error,
                "latest_version_id": str(v.id) if v else None,
                "version_count": nv,
                "rows": v.row_count if v else None,
                "columns": v.column_count if v else None,
                "missing_pct": q.get("missing_pct"),
                "duplicate_rows": q.get("duplicate_rows"),
                "warnings": sum(1 for i in q.get("issues", []) if i["severity"] == "warning"),
                "created_at": d.created_at.isoformat(),
            }
        )
    runs = (
        (
            await session.execute(
                select(AnalysisRun)
                .where(AnalysisRun.project_id == project_id)
                .order_by(AnalysisRun.created_at.desc())
                .limit(6)
            )
        )
        .scalars()
        .all()
    )
    rank = case((Insight.qualification == "strong", 0), (Insight.qualification == "moderate", 1), else_=2)
    insights = (
        (
            await session.execute(
                select(Insight)
                .where(Insight.project_id == project_id)
                .order_by(Insight.pinned.desc(), rank, Insight.created_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    themes_rows = (
        (
            await session.execute(
                select(QualitativeTheme)
                .where(QualitativeTheme.project_id == project_id)
                .order_by(QualitativeTheme.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    themes = await qual_service.serialize_themes(session, list(themes_rows[:40]))
    themes.sort(key=lambda t: -t["response_count"])
    reports = (
        (
            await session.execute(
                select(Report)
                .where(Report.project_id == project_id)
                .order_by(Report.created_at.desc())
                .limit(3)
            )
        )
        .scalars()
        .all()
    )
    viz = (
        (
            await session.execute(
                select(SavedVisualization)
                .where(SavedVisualization.project_id == project_id)
                .order_by(SavedVisualization.created_at.desc())
                .limit(3)
            )
        )
        .scalars()
        .all()
    )
    jobs = (
        (
            await session.execute(
                select(AnalysisJob)
                .where(AnalysisJob.project_id == project_id)
                .order_by(AnalysisJob.created_at.desc())
                .limit(6)
            )
        )
        .scalars()
        .all()
    )
    n_mixed = (
        await session.execute(
            select(func.count()).select_from(MixedMethodRun).where(MixedMethodRun.project_id == project_id)
        )
    ).scalar_one()
    n_codes = (
        await session.execute(
            select(func.count()).select_from(QualitativeCode).where(QualitativeCode.project_id == project_id)
        )
    ).scalar_one()
    counts = {
        "datasets": len(datasets),
        "analyses": (
            await session.execute(
                select(func.count()).select_from(AnalysisRun).where(AnalysisRun.project_id == project_id)
            )
        ).scalar_one(),
        "insights": (
            await session.execute(
                select(func.count()).select_from(Insight).where(Insight.project_id == project_id)
            )
        ).scalar_one(),
        "themes": len(themes_rows),
        "reports": (
            await session.execute(
                select(func.count()).select_from(Report).where(Report.project_id == project_id)
            )
        ).scalar_one(),
        "mixed": n_mixed,
        "codes": n_codes,
    }
    activity = sorted(
        [
            {
                "kind": "analysis",
                "title": r.title,
                "status": r.status,
                "id": str(r.id),
                "at": r.created_at.isoformat(),
            }
            for r in runs
        ]
        + [
            {"kind": "insight", "title": i.title, "id": str(i.id), "at": i.created_at.isoformat()}
            for i in insights
        ]
        + [
            {"kind": "dataset", "title": d["name"], "id": d["id"], "at": d["created_at"]}
            for d in datasets[:3]
        ]
        + [
            {"kind": "report", "title": r.title, "id": str(r.id), "at": r.created_at.isoformat()}
            for r in reports
        ],
        key=lambda a: str(a["at"]),
        reverse=True,
    )[:8]
    payload = {
        "project": {
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "objective": project.objective,
            "created_at": project.created_at.isoformat(),
        },
        "counts": counts,
        "datasets": datasets,
        "recent_analyses": [
            {
                "id": str(r.id),
                "title": r.title,
                "analysis_type": r.analysis_type,
                "status": r.status,
                "created_at": r.created_at.isoformat(),
                "headline": next(
                    (
                        {"label": m["label"], "value": m["value"]}
                        for m in (r.result or {}).get("metrics", [])
                        if m.get("primary")
                    ),
                    None,
                ),
            }
            for r in runs
        ],
        "key_insights": [
            {
                "id": str(i.id),
                "title": i.title,
                "statement": i.statement,
                "qualification": i.qualification,
                "kind": i.kind,
                "pinned": i.pinned,
                "evidence": i.evidence[:3],
            }
            for i in insights
        ],
        "themes": [
            {
                "id": str(t["id"]),
                "name": t["name"],
                "column_name": t["column_name"],
                "response_count": t["response_count"],
                "share_pct": t["share_pct"],
            }
            for t in themes[:6]
        ],
        "reports": [
            {"id": str(r.id), "title": r.title, "status": r.status, "created_at": r.created_at.isoformat()}
            for r in reports
        ],
        "visualizations": [{"id": str(v.id), "name": v.name, "spec": v.spec} for v in viz],
        "jobs": [
            {
                "id": str(j.id),
                "type": j.type,
                "status": j.status,
                "stage": j.stage,
                "progress": j.progress,
                "created_at": j.created_at.isoformat(),
            }
            for j in jobs
        ],
        "activity": activity,
    }
    await cache_set(key, payload, get_settings().cache_ttl_dashboard)
    return {**payload, "role": role, "cached": False}


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get(
    "/search",
    summary="Search projects, datasets, analyses, insights, themes, codes and reports you can access",
)
async def search(
    q: Annotated[str, Query(min_length=2, max_length=100)],
    user: CurrentUser,
    session: Session,
    project_id: uuid.UUID | None = None,
) -> dict[str, list[dict[str, Any]]]:
    pids = [
        r
        for (r,) in (
            await session.execute(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id))
        ).all()
    ]
    if project_id:
        pids = [p for p in pids if p == project_id]
    pat = _like(q)
    lim = 8

    async def run(stmt: Any) -> list[Any]:
        return list((await session.execute(stmt.limit(lim))).all())

    out: dict[str, list[dict[str, Any]]] = {}
    if not project_id:
        out["projects"] = [
            {"id": str(i), "title": n, "project_id": str(i)}
            for i, n in await run(
                select(Project.id, Project.name).where(
                    Project.id.in_(pids),
                    Project.name.ilike(pat, escape="\\") | Project.description.ilike(pat, escape="\\"),
                )
            )
        ]
    out["datasets"] = [
        {"id": str(i), "title": n, "project_id": str(p)}
        for i, n, p in await run(
            select(Dataset.id, Dataset.name, Dataset.project_id).where(
                Dataset.project_id.in_(pids),
                Dataset.name.ilike(pat, escape="\\") | Dataset.original_filename.ilike(pat, escape="\\"),
            )
        )
    ]
    out["analyses"] = [
        {"id": str(i), "title": n, "project_id": str(p), "subtitle": t}
        for i, n, p, t in await run(
            select(
                AnalysisRun.id, AnalysisRun.title, AnalysisRun.project_id, AnalysisRun.analysis_type
            ).where(AnalysisRun.project_id.in_(pids), AnalysisRun.title.ilike(pat, escape="\\"))
        )
    ]
    out["insights"] = [
        {"id": str(i), "title": n, "project_id": str(p), "subtitle": s[:120]}
        for i, n, p, s in await run(
            select(Insight.id, Insight.title, Insight.project_id, Insight.statement).where(
                Insight.project_id.in_(pids),
                Insight.title.ilike(pat, escape="\\") | Insight.statement.ilike(pat, escape="\\"),
            )
        )
    ]
    out["themes"] = [
        {"id": str(i), "title": n, "project_id": str(p)}
        for i, n, p in await run(
            select(QualitativeTheme.id, QualitativeTheme.name, QualitativeTheme.project_id).where(
                QualitativeTheme.project_id.in_(pids),
                QualitativeTheme.name.ilike(pat, escape="\\")
                | QualitativeTheme.description.ilike(pat, escape="\\"),
            )
        )
    ]
    out["codes"] = [
        {"id": str(i), "title": n, "project_id": str(p)}
        for i, n, p in await run(
            select(QualitativeCode.id, QualitativeCode.name, QualitativeCode.project_id).where(
                QualitativeCode.project_id.in_(pids), QualitativeCode.name.ilike(pat, escape="\\")
            )
        )
    ]
    out["reports"] = [
        {"id": str(i), "title": n, "project_id": str(p)}
        for i, n, p in await run(
            select(Report.id, Report.title, Report.project_id).where(
                Report.project_id.in_(pids), Report.title.ilike(pat, escape="\\")
            )
        )
    ]
    return {k: v for k, v in out.items() if v}
