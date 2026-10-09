"""Job handlers. Each is a thin orchestration layer over a service function; progress comes from real stage boundaries."""

from __future__ import annotations

import uuid
from typing import Any

from app.services import analyses as analysis_service
from app.services import datasets as dataset_service
from app.workers.runtime import JobContext, job


@job(
    "ingest_dataset",
    [
        "Validating the uploaded file",
        "Parsing rows and columns",
        "Inferring column types",
        "Profiling variables",
        "Saving dataset version",
    ],
    "dataset import",
)
async def ingest_dataset(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    async with ctx.sessionmaker() as s:
        vid = await dataset_service.ingest_dataset(s, ctx.storage, uuid.UUID(params["dataset_id"]), ctx.stage)
    return {"type": "dataset", "dataset_id": params["dataset_id"], "version_id": str(vid)}


@job(
    "apply_transform",
    ["Loading the source version", "Applying operations", "Profiling the new version"],
    "data preparation",
)
async def apply_transform(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import Dataset, DatasetVersion

    async with ctx.sessionmaker() as s:
        await ctx.stage()
        ds = await s.get(Dataset, uuid.UUID(params["dataset_id"]))
        parent = await s.get(DatasetVersion, uuid.UUID(params["parent_version_id"]))
        assert ds is not None and parent is not None
        await ctx.stage()
        v = await dataset_service.apply_transform(
            s,
            ctx.storage,
            ds,
            parent,
            params["operations"],
            params.get("label", ""),
            uuid.UUID(params["user_id"]),
        )
        await ctx.stage()
    return {"type": "dataset", "dataset_id": str(ds.id), "version_id": str(v.id)}


@job(
    "run_analysis",
    ["Loading the selected variables", "Computing statistics", "Preparing charts and tables"],
    "analysis",
)
async def run_analysis(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    async def stage(name: str | None = None) -> None:
        await ctx.stage(name)

    async with ctx.sessionmaker() as s:
        rid = await analysis_service.execute_run(s, ctx.storage, uuid.UUID(params["run_id"]), stage)
    return {"type": "analysis", "run_id": str(rid)}


@job(
    "prepare_text",
    ["Loading text responses", "Building the semantic model", "Saving segments and embeddings"],
    "text preparation",
)
async def prepare_text(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import DatasetVersion
    from app.services import qualitative as q

    async with ctx.sessionmaker() as s:
        v = await s.get(DatasetVersion, uuid.UUID(params["dataset_version_id"]))
        assert v is not None
        out = await q.prepare_segments(
            s, ctx.storage, v, params["column"], params.get("split", "auto"), ctx.stage
        )
    return {
        "type": "segments",
        "dataset_version_id": params["dataset_version_id"],
        "column": params["column"],
        **out,
    }


@job(
    "detect_themes",
    [
        "Loading segments",
        "Clustering responses",
        "Labelling themes and selecting representative quotes",
        "Saving themes",
    ],
    "theme detection",
)
async def detect_themes(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import DatasetVersion
    from app.services import qualitative as q

    async with ctx.sessionmaker() as s:
        v = await s.get(DatasetVersion, uuid.UUID(params["dataset_version_id"]))
        assert v is not None
        run_id = await q.detect_themes(
            s,
            v,
            uuid.UUID(params["project_id"]),
            uuid.UUID(params["user_id"]),
            params["column"],
            params.get("n_themes"),
            ctx.stage,
        )
    return {
        "type": "themes",
        "run_id": str(run_id),
        "dataset_version_id": params["dataset_version_id"],
        "column": params["column"],
    }


@job(
    "suggest_codes",
    [
        "Loading segments and codebook",
        "Matching code keywords",
        "Finding semantically similar segments",
        "Saving suggestions",
    ],
    "code suggestions",
)
async def suggest_codes(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import DatasetVersion
    from app.services import qualitative as q

    async with ctx.sessionmaker() as s:
        v = await s.get(DatasetVersion, uuid.UUID(params["dataset_version_id"]))
        assert v is not None
        out = await q.suggest_codes(
            s,
            uuid.UUID(params["project_id"]),
            v,
            params["column"],
            params.get("semantic_threshold", 0.55),
            params.get("use_semantic", True),
            ctx.stage,
        )
    return {"type": "codes", **out}


@job(
    "mixed_methods",
    ["Loading qualitative evidence", "Comparing quantitative measures", "Saving integrated findings"],
    "mixed-methods analysis",
)
async def mixed_methods(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import DatasetVersion
    from app.services import mixed as m

    async with ctx.sessionmaker() as s:
        await ctx.stage()
        v = await s.get(DatasetVersion, uuid.UUID(params["dataset_version_id"]))
        assert v is not None
        await ctx.stage()
        run = await m.run_mixed(
            s,
            ctx.storage,
            uuid.UUID(params["project_id"]),
            uuid.UUID(params["user_id"]),
            v,
            params["text_column"],
            params["outcome"],
            params.get("group"),
            params.get("compare"),
            params.get("source", "themes"),
            uuid.UUID(params["theme_run_id"]) if params.get("theme_run_id") else None,
        )
        await ctx.stage()
    return {"type": "mixed", "mixed_run_id": str(run.id)}


@job(
    "generate_insights",
    ["Collecting completed analyses", "Applying evidence thresholds", "Writing interpretations"],
    "insight generation",
)
async def generate_insights(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from sqlalchemy import select

    from app.db.models import AnalysisRun, Insight
    from app.services import insights as svc

    pid = uuid.UUID(params["project_id"])
    async with ctx.sessionmaker() as s:
        await ctx.stage()
        q = select(AnalysisRun).where(AnalysisRun.project_id == pid, AnalysisRun.status == "COMPLETED")
        if params.get("run_ids"):
            q = q.where(AnalysisRun.id.in_([uuid.UUID(r) for r in params["run_ids"]]))
        runs = (await s.execute(q)).scalars().all()
        await ctx.stage()
        created = []
        for r in runs:
            created.extend(await svc.create_for_run(s, r))
        await s.commit()
        await ctx.stage()
        narrated = 0
        if params.get("with_narratives"):
            rows = (
                (
                    await s.execute(
                        select(Insight)
                        .where(Insight.project_id == pid, Insight.narrative.is_(None))
                        .limit(25)
                    )
                )
                .scalars()
                .all()
            )
            for i in rows:
                await svc.narrate_insight(s, i)
                narrated += 1
    return {
        "type": "insights",
        "created": len(created),
        "narrated": narrated,
        "analyses_considered": len(runs),
    }


@job(
    "generate_report",
    ["Collecting analyses, insights and themes", "Assembling sections", "Validating references"],
    "report generation",
)
async def generate_report(ctx: JobContext, params: dict[str, Any]) -> dict[str, Any]:
    from app.db.models import Project, User
    from app.services import reports as svc

    async with ctx.sessionmaker() as s:
        project = await s.get(Project, uuid.UUID(params["project_id"]))
        user = await s.get(User, uuid.UUID(params["user_id"]))
        assert project is not None and user is not None
        rep = await svc.generate_draft(
            s,
            project,
            user,
            params.get("title") or f"{project.name} — research report",
            uuid.UUID(params["dataset_version_id"]) if params.get("dataset_version_id") else None,
            bool(params.get("with_ai")),
            ctx.stage,
        )
    return {"type": "report", "report_id": str(rep.id)}
