"""arq transport + worker settings. Start with:  ``arq app.workers.queue.WorkerSettings``."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from arq.worker import Retry

from app.core.config import get_settings
from app.core.exceptions import ServiceUnavailable, TransientError
from app.core.logging import configure_logging
from app.db.database import dispose_engine
from app.workers import runtime

log = logging.getLogger("lotus.worker")
_pool: ArqRedis | None = None


async def _get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url), default_queue_name="lotus:jobs")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
    _pool = None


async def enqueue(job_id: uuid.UUID) -> None:
    try:
        pool = await _get_pool()
        await pool.enqueue_job("execute_job", str(job_id), _job_id=f"lotus-{job_id}", _queue_name="lotus:jobs")
    except Exception as e:  # Redis down: the job row exists but cannot be delivered
        log.error("enqueue_failed", extra={"error": type(e).__name__})
        from app.db.database import get_sessionmaker
        from app.db.models import AnalysisJob
        from datetime import UTC, datetime

        async with get_sessionmaker()() as s:
            j = await s.get(AnalysisJob, job_id)
            if j:
                j.status, j.completed_at, j.stage = "FAILED", datetime.now(UTC), "Failed"
                j.error = {"code": "QUEUE_UNAVAILABLE", "message": "The background queue is unavailable. Please try again shortly."}
                await s.commit()
        raise ServiceUnavailable("The background job queue is unavailable. Please try again shortly.", code="QUEUE_UNAVAILABLE") from e


async def execute_job(ctx: dict[str, Any], job_id: str) -> str:
    try:
        return await runtime.run_job(uuid.UUID(job_id))
    except TransientError as e:
        raise Retry(defer=ctx["job_try"] * 5) from e


async def on_startup(ctx: dict[str, Any]) -> None:
    s = get_settings()
    configure_logging(s.log_level, s.log_json)
    import app.workers.jobs  # noqa: F401  (registers job handlers)

    log.info("worker_started")


async def on_shutdown(ctx: dict[str, Any]) -> None:
    await dispose_engine()
    log.info("worker_stopped")


class WorkerSettings:
    functions = [execute_job]
    queue_name = "lotus:jobs"
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    on_startup = on_startup
    on_shutdown = on_shutdown
    max_jobs = 4
    job_timeout = 1800
    max_tries = get_settings().job_max_tries + 1
    keep_result = 60
    health_check_interval = 30
