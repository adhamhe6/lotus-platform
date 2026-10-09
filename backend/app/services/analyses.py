from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis import registry
from app.analysis.base import AnalysisSpec
from app.cache.redis import cache_get, cache_set
from app.core.config import get_settings
from app.core.exceptions import AnalysisConfigurationError, LotusError
from app.datasets.storage import Storage
from app.db.models import AnalysisRun, DatasetColumn, DatasetVersion
from app.services import datasets as dataset_service
from app.services.projects import bump_project

log = logging.getLogger("lotus.analysis")

_NUMERIC = {"numeric_continuous", "numeric_discrete", "binary"}
_CATEGORICAL = {"categorical", "boolean", "binary", "numeric_discrete"}


def _accepts_label(accepts: list[str]) -> str:
    s = set(accepts)
    if s <= _NUMERIC:
        return "numeric"
    if s == {"datetime"}:
        return "a date/time column"
    if s <= _CATEGORICAL | {"categorical"} and "numeric_continuous" not in s:
        return "categorical"
    return "one of: " + ", ".join(a.replace("_", " ") for a in accepts)


def referenced_columns(spec: AnalysisSpec, config: dict[str, Any]) -> list[str]:
    cols: list[str] = []
    for r in spec.roles:
        v = config.get(r.key)
        cols.extend(v if isinstance(v, list) else [v] if v else [])
    return list(dict.fromkeys(cols))


def validate_roles(spec: AnalysisSpec, config: dict[str, Any], columns: list[DatasetColumn]) -> None:
    """Reject impossible variable selections *before* queueing work (instant, uses the stored schema)."""
    meta = {c.name: c.semantic_type for c in columns}
    for r in spec.roles:
        v = config.get(r.key)
        vals = v if isinstance(v, list) else ([v] if v else [])
        if not vals and r.required:
            raise AnalysisConfigurationError(f"Select {r.label.lower()}.")
        if r.multiple and len(vals) < r.min_count:
            raise AnalysisConfigurationError(f"{r.label}: select at least {r.min_count}.")
        for name in vals:
            if name not in meta:
                raise AnalysisConfigurationError(
                    f"Column '{name}' does not exist in this dataset version.", code="UNKNOWN_COLUMN"
                )
            if meta[name] not in r.accepts:
                art = "an" if _accepts_label(r.accepts)[0] in "aeiou" else "a"
                raise AnalysisConfigurationError(
                    f"The selected {r.label.lower()} '{name}' must be {art} {_accepts_label(r.accepts)} variable (it is {meta[name].replace('_', ' ')})."
                    if _accepts_label(r.accepts) in ("numeric", "categorical")
                    else f"'{name}' cannot be used as {r.label.lower()}: expected {_accepts_label(r.accepts)} (it is {meta[name].replace('_', ' ')})."
                )


async def create_run(
    session: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    version: DatasetVersion,
    analysis_type: str,
    config: dict[str, Any],
    title: str | None,
) -> tuple[AnalysisRun, bool]:
    spec = registry.get_spec(analysis_type)
    cfg = registry.parse_config(analysis_type, config)
    cols = await dataset_service.version_columns(session, version.id)
    validate_roles(spec, cfg.model_dump(mode="json"), cols)
    h = registry.config_hash(analysis_type, cfg)
    existing = (
        await session.execute(
            select(AnalysisRun).where(
                AnalysisRun.dataset_version_id == version.id,
                AnalysisRun.analysis_type == analysis_type,
                AnalysisRun.config_hash == h,
                AnalysisRun.status.in_(["PENDING", "RUNNING", "COMPLETED"]),
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing, True
    run = AnalysisRun(
        project_id=project_id,
        dataset_version_id=version.id,
        analysis_type=analysis_type,
        title=(title or spec.label)[:300],
        config=cfg.model_dump(mode="json"),
        config_hash=h,
        status="PENDING",
        created_by=user_id,
    )
    session.add(run)
    try:
        await session.flush()
    except IntegrityError:  # concurrent identical request: the partial unique index guarantees a single run
        await session.rollback()
        run = (
            await session.execute(
                select(AnalysisRun).where(
                    AnalysisRun.dataset_version_id == version.id,
                    AnalysisRun.config_hash == h,
                    AnalysisRun.status.in_(["PENDING", "RUNNING", "COMPLETED"]),
                )
            )
        ).scalar_one()
        return run, True
    return run, False


async def execute_run(session: AsyncSession, storage: Storage, run_id: uuid.UUID, stage) -> uuid.UUID:
    run = await session.get(AnalysisRun, run_id)
    if run is None:
        raise LotusError("Analysis not found.")
    if run.status == "COMPLETED":  # idempotent re-delivery
        return run.id
    version = await session.get(DatasetVersion, run.dataset_version_id)
    assert version is not None
    spec = registry.get_spec(run.analysis_type)
    run.status, run.started_at = "RUNNING", datetime.now(UTC)
    await session.commit()
    try:
        await stage("Loading the selected variables")
        cols = referenced_columns(spec, run.config)
        df = await dataset_service.load_frame(storage, version, cols)
        await stage("Computing statistics")
        result, prov = await asyncio.to_thread(registry.execute, df, run.analysis_type, run.config)
        await stage("Preparing charts and tables")
        prov = {
            **prov,
            "dataset_version_id": str(version.id),
            "dataset_content_hash": version.content_hash,
            "rows_in_version": version.row_count,
        }
        run.result, run.provenance, run.error, run.status = result, prov, None, "COMPLETED"
        run.title = run.title if run.title != spec.label else result["title"][:300]
        run.duration_ms = prov["compute_ms"]
        run.completed_at = datetime.now(UTC)
        try:
            from app.services import insights as insight_service

            await insight_service.create_for_run(session, run)
        except Exception:  # insight extraction must never fail an otherwise successful analysis
            log.exception("insight_extraction_failed")
        await bump_project(session, run.project_id)
        await session.commit()
        await cache_set(f"run:{run.id}", {"result": result}, get_settings().cache_ttl_result)
        return run.id
    except LotusError as e:
        await session.rollback()
        run = await session.get(AnalysisRun, run_id)
        assert run is not None
        run.status, run.error, run.completed_at = (
            "FAILED",
            {"code": e.code, "message": e.message},
            datetime.now(UTC),
        )
        await session.commit()
        raise
    except Exception:
        await session.rollback()
        run = await session.get(AnalysisRun, run_id)
        assert run is not None
        run.status, run.error, run.completed_at = (
            "FAILED",
            {"code": "ANALYSIS_FAILED", "message": "The analysis could not be completed with this data."},
            datetime.now(UTC),
        )
        await session.commit()
        raise


async def cached_result(run: AnalysisRun) -> dict[str, Any] | None:
    if run.status != "COMPLETED":
        return run.result
    hit = await cache_get(f"run:{run.id}")
    if hit is not None:
        return hit["result"]
    if run.result is not None:
        await cache_set(f"run:{run.id}", {"result": run.result}, get_settings().cache_ttl_result)
    return run.result
