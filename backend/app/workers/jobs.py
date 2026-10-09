"""Job handlers. Each is a thin orchestration layer over a service function; progress comes from real stage boundaries."""

from __future__ import annotations

import uuid
from typing import Any

from app.services import analyses as analysis_service
from app.services import datasets as dataset_service
from app.workers.runtime import JobContext, job


@job("ingest_dataset", ["Validating the uploaded file", "Parsing rows and columns", "Inferring column types", "Profiling variables", "Saving dataset version"], "dataset import")
async def ingest_dataset(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    async with ctx.sessionmaker() as s:
        vid = await dataset_service.ingest_dataset(s, ctx.storage, uuid.UUID(params["dataset_id"]), ctx.stage)
    return {"type": "dataset", "dataset_id": params["dataset_id"], "version_id": str(vid)}


@job("apply_transform", ["Loading the source version", "Applying operations", "Profiling the new version"], "data preparation")
async def apply_transform(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import Dataset, DatasetVersion

    async with ctx.sessionmaker() as s:
        await ctx.stage()
        ds = await s.get(Dataset, uuid.UUID(params["dataset_id"]))
        parent = await s.get(DatasetVersion, uuid.UUID(params["parent_version_id"]))
        assert ds is not None and parent is not None
        await ctx.stage()
        v = await dataset_service.apply_transform(s, ctx.storage, ds, parent, params["operations"], params.get("label", ""), uuid.UUID(params["user_id"]))
        await ctx.stage()
    return {"type": "dataset", "dataset_id": str(ds.id), "version_id": str(v.id)}


@job("run_analysis", ["Loading the selected variables", "Computing statistics", "Preparing charts and tables"], "analysis")
async def run_analysis(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    async def stage(name: str | None = None) -> None:
        await ctx.stage(name)

    async with ctx.sessionmaker() as s:
        rid = await analysis_service.execute_run(s, ctx.storage, uuid.UUID(params["run_id"]), stage)
    return {"type": "analysis", "run_id": str(rid)}
