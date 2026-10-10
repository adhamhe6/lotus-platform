from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.analysis import registry
from app.api.deps import CurrentUser, Session, StorageDep
from app.core.exceptions import AnalysisConfigurationError, NotFoundError
from app.db.models import AnalysisRun, Dataset, DatasetVersion, SavedVisualization
from app.schemas.analysis import (
    AnalysisCreate,
    AnalysisCreated,
    AnalysisDetail,
    AnalysisSummary,
    AnalysisUpdate,
    VisualizationCreate,
    VisualizationOut,
)
from app.schemas.common import ERRORS, Page
from app.schemas.core import JobOut
from app.services import access
from app.services import analyses as svc
from app.services import datasets as dataset_service
from app.services.projects import bump_project
from app.visualization import builder
from app.workers.runtime import create_job, dispatch

router = APIRouter(tags=["Analysis"], responses={401: ERRORS[401], 404: ERRORS[404]})


def _headline(run: AnalysisRun) -> dict[str, Any] | None:
    if not run.result:
        return None
    primary = (
        next((m for m in run.result.get("metrics", []) if m.get("primary")), None)
        or (run.result.get("metrics") or [None])[0]
    )
    p = next((m for m in run.result.get("metrics", []) if m["key"] == "p_value"), None)
    return (
        {
            "label": primary["label"],
            "value": primary["value"],
            "p_value": p["value"] if p else None,
            "n": run.result.get("n_used"),
        }
        if primary
        else None
    )


async def _detail(session, run: AnalysisRun) -> AnalysisDetail:
    v = await session.get(DatasetVersion, run.dataset_version_id)
    ds = await session.get(Dataset, v.dataset_id) if v else None
    d = AnalysisDetail.model_validate(run)
    d.result = await svc.cached_result(run)
    d.headline = _headline(run)
    if v and ds:
        d.dataset_name, d.version_label, d.version_number, d.dataset_id = (
            ds.name,
            v.label,
            v.version_number,
            ds.id,
        )
    return d


@router.get(
    "/analysis-types",
    summary="Catalogue of analysis types with variable roles and parameters (drives the builder UI)",
)
async def analysis_types(user: CurrentUser) -> list[dict[str, Any]]:
    return registry.describe_types()


@router.post(
    "/projects/{project_id}/analyses",
    response_model=AnalysisCreated,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Run an analysis",
    responses={422: ERRORS[422], 403: ERRORS[403]},
)
async def create_analysis(
    project_id: uuid.UUID, body: AnalysisCreate, user: CurrentUser, session: Session
) -> AnalysisCreated:
    """Validates the configuration against the dataset's schema (instant 422 for wrong variable types), then queues the computation.
    Identical requests (same dataset version, type and configuration) are idempotent and return the existing run."""
    await access.require_project(session, user, project_id, "EDITOR")
    version, _ = await access.version_in_project(session, project_id, body.dataset_version_id)
    run, reused = await svc.create_run(
        session, user.id, project_id, version, body.analysis_type, body.config, body.title
    )
    job = None
    if not reused:
        job = await create_job(
            session,
            project_id=project_id,
            user_id=user.id,
            type_="run_analysis",
            params={"run_id": str(run.id)},
            idempotency_key=f"run:{run.id}",
        )
    await session.commit()
    if job is not None:
        await dispatch(job.id)
        await session.refresh(job)
        await session.refresh(run)
    return AnalysisCreated(
        analysis=await _detail(session, run), job=JobOut.model_validate(job) if job else None, reused=reused
    )


@router.get(
    "/projects/{project_id}/analyses", response_model=Page[AnalysisSummary], summary="Analysis history"
)
async def list_analyses(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    analysis_type: str | None = None,
    dataset_version_id: uuid.UUID | None = None,
    saved: bool | None = None,
    status_: Annotated[str | None, Query(alias="status")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[AnalysisSummary]:
    await access.require_project(session, user, project_id)
    q = select(AnalysisRun).where(AnalysisRun.project_id == project_id)
    if analysis_type:
        q = q.where(AnalysisRun.analysis_type == analysis_type)
    if dataset_version_id:
        q = q.where(AnalysisRun.dataset_version_id == dataset_version_id)
    if saved is not None:
        q = q.where(AnalysisRun.saved == saved)
    if status_:
        q = q.where(AnalysisRun.status == status_.upper())
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        (
            await session.execute(
                q.order_by(AnalysisRun.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    vmap = (
        dict(
            (
                await session.execute(
                    select(DatasetVersion.id, DatasetVersion.dataset_id).where(
                        DatasetVersion.id.in_({r.dataset_version_id for r in rows})
                    )
                )
            ).all()
        )
        if rows
        else {}
    )
    items = []
    for r in rows:
        s = AnalysisSummary.model_validate(r)
        s.headline = _headline(r)
        s.dataset_id = vmap.get(r.dataset_version_id)
        items.append(s)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get(
    "/analyses/{analysis_id}",
    response_model=AnalysisDetail,
    summary="Open a stored analysis (config, result, provenance)",
)
async def get_analysis(analysis_id: uuid.UUID, user: CurrentUser, session: Session) -> AnalysisDetail:
    return await _detail(session, await access.get_run(session, user, analysis_id))


@router.patch(
    "/analyses/{analysis_id}", response_model=AnalysisDetail, summary="Rename or save/unsave an analysis"
)
async def update_analysis(
    analysis_id: uuid.UUID, body: AnalysisUpdate, user: CurrentUser, session: Session
) -> AnalysisDetail:
    run = await access.get_run(session, user, analysis_id, "EDITOR")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(run, k, v)
    await bump_project(session, run.project_id)
    await session.commit()
    return await _detail(session, run)


@router.delete(
    "/analyses/{analysis_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an analysis and the insights derived from it",
)
async def delete_analysis(analysis_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    run = await access.get_run(session, user, analysis_id, "EDITOR")
    pid = run.project_id
    await session.delete(run)
    await bump_project(session, pid)
    await session.commit()


# ------------------------------------------------------------------------------ visualizations
@router.post(
    "/projects/{project_id}/visualizations/preview",
    summary="Build a chart specification from real data",
    responses={422: ERRORS[422]},
)
async def preview_visualization(
    project_id: uuid.UUID, body: dict[str, Any], user: CurrentUser, session: Session, storage: StorageDep
) -> dict[str, Any]:
    await access.require_project(session, user, project_id)
    try:
        version_id = uuid.UUID(str(body.pop("dataset_version_id")))
        req = builder.ChartRequest.model_validate(body)
    except (KeyError, ValueError) as e:
        raise AnalysisConfigurationError("A valid dataset_version_id and chart request are required.") from e
    version, _ = await access.version_in_project(session, project_id, version_id)
    df = await dataset_service.load_frame(storage, version, builder.required_columns(req))
    return builder.build(df, req).model_dump(mode="json")


@router.get(
    "/datasets/{dataset_id}/chart-suggestions", summary="Chart suggestions derived from the column types"
)
async def chart_suggestions(
    dataset_id: uuid.UUID, user: CurrentUser, session: Session, version_id: uuid.UUID | None = None
) -> list[dict[str, object]]:
    ds = await access.get_dataset(session, user, dataset_id)
    v = (
        await dataset_service.latest_version(session, ds.id)
        if version_id is None
        else await session.get(DatasetVersion, version_id)
    )
    if v is None or v.dataset_id != ds.id:
        raise NotFoundError("Dataset version not found.")
    cols = await dataset_service.version_columns(session, v.id)
    return builder.recommend([(c.name, c.semantic_type) for c in cols])


@router.post(
    "/projects/{project_id}/visualizations",
    response_model=VisualizationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Save a visualization",
)
async def save_visualization(
    project_id: uuid.UUID, body: VisualizationCreate, user: CurrentUser, session: Session, storage: StorageDep
) -> VisualizationOut:
    await access.require_project(session, user, project_id, "EDITOR")
    version, _ = await access.version_in_project(session, project_id, body.dataset_version_id)
    req = builder.ChartRequest.model_validate(body.request)
    df = await dataset_service.load_frame(storage, version, builder.required_columns(req))
    spec = builder.build(df, req).model_dump(mode="json")
    viz = SavedVisualization(
        project_id=project_id,
        dataset_version_id=version.id,
        name=body.name.strip(),
        request=req.model_dump(mode="json"),
        spec=spec,
        created_by=user.id,
    )
    session.add(viz)
    await bump_project(session, project_id)
    await session.commit()
    return VisualizationOut.model_validate(viz)


@router.get(
    "/projects/{project_id}/visualizations",
    response_model=list[VisualizationOut],
    summary="Saved visualizations",
)
async def list_visualizations(
    project_id: uuid.UUID, user: CurrentUser, session: Session
) -> list[VisualizationOut]:
    await access.require_project(session, user, project_id)
    rows = (
        (
            await session.execute(
                select(SavedVisualization)
                .where(SavedVisualization.project_id == project_id)
                .order_by(SavedVisualization.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [VisualizationOut.model_validate(r) for r in rows]


@router.delete(
    "/visualizations/{viz_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a saved visualization"
)
async def delete_visualization(viz_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    v = await access.get_visualization(session, user, viz_id, "EDITOR")
    pid = v.project_id
    await session.delete(v)
    await bump_project(session, pid)
    await session.commit()
