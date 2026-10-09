"""Job runtime shared by the arq worker and the inline backend.

``analysis_jobs`` rows are the source of truth; Redis (arq) only transports ``job_id``. A job function receives a
``JobContext`` and reports *real* progress through ``ctx.stage()``: progress = completed_stages / total_stages.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.exceptions import LotusError, TransientError
from app.core.logging import job_id_var
from app.datasets.storage import Storage
from app.db.database import get_sessionmaker
from app.db.models import AnalysisJob, Notification

log = logging.getLogger("lotus.jobs")


class JobCancelled(Exception):
    pass


@dataclass
class JobSpec:
    name: str
    stages: list[str]
    handler: Callable[[JobContext, dict[str, Any]], Awaitable[dict[str, Any] | None]]
    label: str = ""


JOB_TYPES: dict[str, JobSpec] = {}


def job(name: str, stages: list[str], label: str = "") -> Callable:
    def deco(fn: Callable[[JobContext, dict[str, Any]], Awaitable[dict[str, Any] | None]]):
        JOB_TYPES[name] = JobSpec(name, stages, fn, label or name.replace("_", " "))
        return fn
    return deco


class JobContext:
    def __init__(self, job_id: uuid.UUID, sessionmaker: async_sessionmaker[AsyncSession], storage: Storage, settings: Settings, spec: JobSpec):
        self.job_id = job_id
        self.sessionmaker = sessionmaker
        self.storage = storage
        self.settings = settings
        self.spec = spec
        self._done = 0

    async def stage(self, name: str | None = None, *, advance: bool = True) -> None:
        """Mark the start of the next stage (records the stage label and the number of completed ones)."""
        async with self.sessionmaker() as s:
            j = await s.get(AnalysisJob, self.job_id, with_for_update=True)
            assert j is not None
            if j.cancel_requested:
                raise JobCancelled()
            if advance and self._done < len(self.spec.stages):
                label = name or self.spec.stages[self._done]
                j.stage = label
                j.completed_stages = self._done
                self._done += 1
            elif name:
                j.stage = name
            await s.commit()


async def create_job(session: AsyncSession, *, project_id: uuid.UUID, user_id: uuid.UUID, type_: str, params: dict[str, Any],
                     idempotency_key: str | None = None) -> AnalysisJob:
    spec = JOB_TYPES[type_]
    if idempotency_key:
        existing = (await session.execute(select(AnalysisJob).where(
            AnalysisJob.project_id == project_id, AnalysisJob.idempotency_key == idempotency_key, AnalysisJob.status.in_(["PENDING", "RUNNING"])))).scalar_one_or_none()
        if existing:
            return existing
    j = AnalysisJob(project_id=project_id, user_id=user_id, type=type_, params=params, total_stages=len(spec.stages), idempotency_key=idempotency_key, stage="Queued")
    session.add(j)
    await session.flush()
    return j


async def dispatch(job_id: uuid.UUID) -> None:
    """Hand a committed job to the configured backend."""
    s = get_settings()
    if s.job_backend == "inline":
        await run_job(job_id)
        return
    from app.workers.queue import enqueue

    await enqueue(job_id)


async def run_job(job_id: uuid.UUID, *, attempt_hint: int | None = None, sessionmaker: async_sessionmaker[AsyncSession] | None = None,
                  storage: Storage | None = None) -> str:
    """Execute a job. Idempotent: jobs that are not PENDING are left alone. Returns the final status.

    Raises ``TransientError`` (to let arq retry) only while attempts remain."""
    settings = get_settings()
    sm = sessionmaker or get_sessionmaker()
    storage = storage or Storage(settings.storage_dir)
    token = job_id_var.set(str(job_id))
    try:
        async with sm() as s:
            j = await s.get(AnalysisJob, job_id, with_for_update=True)
            if j is None:
                log.warning("job_missing")
                return "MISSING"
            if j.status != "PENDING":
                log.info("job_skipped_not_pending", extra={"status": j.status})
                return j.status
            if j.cancel_requested:
                j.status, j.completed_at, j.stage = "CANCELLED", datetime.now(UTC), "Cancelled"
                await s.commit()
                return "CANCELLED"
            j.status, j.started_at, j.attempts, j.stage = "RUNNING", datetime.now(UTC), j.attempts + 1, "Starting"
            type_, params, project_id, user_id, attempts = j.type, dict(j.params), j.project_id, j.user_id, j.attempts
            await s.commit()
        spec = JOB_TYPES[type_]
        ctx = JobContext(job_id, sm, storage, settings, spec)
        t0 = time.perf_counter()
        log.info("job_started", extra={"job_type": type_, "attempt": attempts})
        status, result_ref, error = "COMPLETED", None, None
        try:
            result_ref = await spec.handler(ctx, params)
        except JobCancelled:
            status = "CANCELLED"
        except TransientError as e:
            if attempts < settings.job_max_tries:
                async with sm() as s:
                    j = await s.get(AnalysisJob, job_id)
                    assert j is not None
                    j.status, j.stage = "PENDING", f"Retrying after a temporary error (attempt {attempts + 1})"
                    await s.commit()
                log.warning("job_retry", extra={"job_type": type_, "attempt": attempts, "error": str(e)[:200]})
                raise
            status, error = "FAILED", {"code": "TRANSIENT_ERROR", "message": "A required service was unavailable. Please try again later."}
        except LotusError as e:
            status, error = "FAILED", {"code": e.code, "message": e.message}
        except Exception:
            log.exception("job_crashed", extra={"job_type": type_})
            status, error = "FAILED", {"code": "INTERNAL_ERROR", "message": "The job failed unexpectedly. The error has been logged."}
        async with sm() as s:
            j = await s.get(AnalysisJob, job_id)
            assert j is not None
            j.status, j.completed_at = status, datetime.now(UTC)
            j.result_ref, j.error = result_ref, error
            if status == "COMPLETED":
                j.completed_stages, j.stage = j.total_stages, "Done"
            elif status == "CANCELLED":
                j.stage = "Cancelled"
            else:
                j.stage = "Failed"
            if status in ("COMPLETED", "FAILED"):
                label = spec.label.capitalize()
                s.add(Notification(user_id=user_id, project_id=project_id, kind=f"job_{status.lower()}",
                                   title=f"{label} {'finished' if status == 'COMPLETED' else 'failed'}",
                                   body=(error or {}).get("message", "") if error else "", link={"job_id": str(job_id), **(result_ref or {})}))
            await s.commit()
        log.info("job_finished", extra={"job_type": type_, "status": status, "duration_ms": int((time.perf_counter() - t0) * 1000)})
        return status
    finally:
        job_id_var.reset(token)
