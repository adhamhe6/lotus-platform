from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, UploadFile, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, Session, StorageDep
from app.core.exceptions import NotFoundError, ValidationFailed
from app.db.models import Dataset, DatasetVersion
from app.schemas.common import ERRORS
from app.schemas.core import JobOut
from app.schemas.datasets import (
    DatasetOut,
    DatasetUpdate,
    PreviewFilter,
    PreviewOut,
    ProfileOut,
    TransformIn,
    TransformPreviewOut,
    UploadResponse,
    VersionOut,
)
from app.services import access
from app.services import datasets as svc
from app.services.projects import bump_project
from app.workers.runtime import create_job, dispatch

router = APIRouter(tags=["Datasets"], responses={401: ERRORS[401], 404: ERRORS[404]})


async def dataset_out(session, ds: Dataset) -> DatasetOut:
    latest = await svc.latest_version(session, ds.id)
    n = (
        await session.execute(
            select(func.count()).select_from(DatasetVersion).where(DatasetVersion.dataset_id == ds.id)
        )
    ).scalar_one()
    out = DatasetOut.model_validate(ds)
    out.latest_version = VersionOut.model_validate(latest) if latest else None
    out.version_count = n
    return out


@router.post(
    "/projects/{project_id}/datasets",
    response_model=UploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a dataset (CSV / TSV / XLSX)",
    responses={413: ERRORS[422], 415: ERRORS[422], 403: ERRORS[403]},
)
async def upload_dataset(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    storage: StorageDep,
    file: Annotated[UploadFile, File(description="CSV, TSV or XLSX file")],
    name: Annotated[str | None, Form(max_length=200)] = None,
    description: Annotated[str, Form(max_length=4000)] = "",
) -> UploadResponse:
    """Streams the file to private storage, validates extension + signature + size, creates the dataset and queues the ingestion job
    (parse → infer types → profile → write an immutable Parquet version)."""
    await access.require_project(session, user, project_id, "EDITOR")
    ds = await svc.save_upload(session, storage, user, project_id, file, name, description)
    j = await create_job(
        session,
        project_id=project_id,
        user_id=user.id,
        type_="ingest_dataset",
        params={"dataset_id": str(ds.id)},
        idempotency_key=f"ingest:{ds.id}",
    )
    await session.commit()
    await dispatch(j.id)
    await session.refresh(ds)
    await session.refresh(j)
    return UploadResponse(dataset=await dataset_out(session, ds), job=JobOut.model_validate(j))


@router.get(
    "/projects/{project_id}/datasets", response_model=list[DatasetOut], summary="List datasets in a project"
)
async def list_datasets(project_id: uuid.UUID, user: CurrentUser, session: Session) -> list[DatasetOut]:
    await access.require_project(session, user, project_id)
    rows = (
        (
            await session.execute(
                select(Dataset).where(Dataset.project_id == project_id).order_by(Dataset.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [await dataset_out(session, d) for d in rows]


@router.get("/datasets/{dataset_id}", response_model=DatasetOut, summary="Get a dataset")
async def get_dataset(dataset_id: uuid.UUID, user: CurrentUser, session: Session) -> DatasetOut:
    return await dataset_out(session, await access.get_dataset(session, user, dataset_id))


@router.patch("/datasets/{dataset_id}", response_model=DatasetOut, summary="Rename / describe a dataset")
async def update_dataset(
    dataset_id: uuid.UUID, body: DatasetUpdate, user: CurrentUser, session: Session
) -> DatasetOut:
    ds = await access.get_dataset(session, user, dataset_id, "EDITOR")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(ds, k, v.strip())
    await bump_project(session, ds.project_id)
    await session.commit()
    return await dataset_out(session, ds)


@router.delete(
    "/datasets/{dataset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a dataset, its versions and derived analyses",
)
async def delete_dataset(
    dataset_id: uuid.UUID, user: CurrentUser, session: Session, storage: StorageDep
) -> None:
    ds = await access.get_dataset(session, user, dataset_id, "EDITOR")
    await svc.delete_dataset_files(session, storage, ds)
    pid = ds.project_id
    await session.delete(ds)
    await bump_project(session, pid)
    await session.commit()


@router.get(
    "/datasets/{dataset_id}/versions",
    response_model=list[VersionOut],
    summary="List dataset versions (lineage)",
)
async def list_versions(dataset_id: uuid.UUID, user: CurrentUser, session: Session) -> list[VersionOut]:
    ds = await access.get_dataset(session, user, dataset_id)
    rows = (
        (
            await session.execute(
                select(DatasetVersion)
                .where(DatasetVersion.dataset_id == ds.id)
                .order_by(DatasetVersion.version_number)
            )
        )
        .scalars()
        .all()
    )
    return [VersionOut.model_validate(v) for v in rows]


async def _resolve_version(session, user, ds: Dataset, version_id: uuid.UUID | None) -> DatasetVersion:
    if version_id is None:
        v = await svc.latest_version(session, ds.id)
        if v is None:
            raise NotFoundError(
                "This dataset has no ready version yet (still processing or failed).",
                code="DATASET_NOT_READY",
            )
        return v
    v = await session.get(DatasetVersion, version_id)
    if v is None or v.dataset_id != ds.id:
        raise NotFoundError("Dataset version not found.", code="DATASET_VERSION_NOT_FOUND")
    return v


@router.get(
    "/datasets/{dataset_id}/profile",
    response_model=ProfileOut,
    summary="Column profile + data-quality summary",
)
async def dataset_profile(
    dataset_id: uuid.UUID, user: CurrentUser, session: Session, version_id: uuid.UUID | None = None
) -> dict[str, Any]:
    ds = await access.get_dataset(session, user, dataset_id)
    return await svc.profile_payload(session, await _resolve_version(session, user, ds, version_id))


@router.get(
    "/datasets/{dataset_id}/preview",
    response_model=PreviewOut,
    summary="Paginated row preview with optional sort and filters",
)
async def dataset_preview(
    dataset_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    storage: StorageDep,
    version_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    sort: str | None = None,
    order: Annotated[str, Query(pattern="^(asc|desc)$")] = "asc",
    filters: Annotated[str | None, Query(description='JSON list: [{"column","operator","value"}]')] = None,
    columns: Annotated[str | None, Query(description="Comma-separated column subset")] = None,
) -> PreviewOut:
    ds = await access.get_dataset(session, user, dataset_id)
    v = await _resolve_version(session, user, ds, version_id)
    try:
        flt = [PreviewFilter.model_validate(f) for f in json.loads(filters)] if filters else []
    except (ValueError, TypeError) as e:
        raise ValidationFailed("Invalid filters parameter.", code="INVALID_FILTER") from e
    cols = await svc.version_columns(session, v.id)
    return await svc.preview(
        storage,
        v,
        cols,
        page,
        page_size,
        sort,
        order,
        flt,
        [c for c in columns.split(",") if c] if columns else None,
    )


@router.post(
    "/datasets/{dataset_id}/versions",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Create a cleaned/transformed version (non-destructive)",
    response_model=JobOut | TransformPreviewOut,
)
async def create_version(
    dataset_id: uuid.UUID, body: TransformIn, user: CurrentUser, session: Session, storage: StorageDep
) -> Any:
    """Applies an ordered list of operations (drop duplicates, fill/drop missing, cast types, rename, filter, normalise categories, outliers, select columns)
    to a parent version and stores the result as a new immutable version. With ``dry_run`` nothing is stored and a summary of the effect is returned."""
    ds = await access.get_dataset(session, user, dataset_id, "EDITOR")
    parent = await _resolve_version(session, user, ds, body.parent_version_id)
    if body.dry_run:
        return await svc.dry_run_transform(storage, parent, body.operations)
    from app.datasets.transform import parse_operations

    parse_operations(body.operations)  # fail fast on malformed operations
    j = await create_job(
        session,
        project_id=ds.project_id,
        user_id=user.id,
        type_="apply_transform",
        params={
            "dataset_id": str(ds.id),
            "parent_version_id": str(parent.id),
            "operations": body.operations,
            "label": body.label,
            "user_id": str(user.id),
        },
    )
    await session.commit()
    await dispatch(j.id)
    await session.refresh(j)
    return JobOut.model_validate(j)
