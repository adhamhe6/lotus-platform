"""Redis access with fail-open semantics. The database is the source of truth; Redis is only an accelerator.

Key scheme (all prefixed ``lotus:v1:``):

* ``profile:{version_id}``            dataset profile JSON            TTL ``CACHE_TTL_PROFILE``
* ``preview:{version_id}:{hash}``     one preview page                TTL ``CACHE_TTL_PROFILE``
* ``dash:{project_id}:{revision}``    project overview                TTL ``CACHE_TTL_DASHBOARD``
* ``run:{run_id}``                    completed analysis result       TTL ``CACHE_TTL_RESULT``
* ``rl:{scope}:{subject}:{minute}``   rate-limit counters             TTL 70 s
* arq queue keys (``arq:*``)          job transport only

Invalidation: ``bump_project(project_id)`` increments ``Project.revision`` in the database, which is part of the
dashboard key, so stale dashboards are never read; version-scoped keys are immutable because versions are immutable.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import redis.asyncio as aioredis
from redis.exceptions import RedisError

from app.core.config import get_settings

log = logging.getLogger("lotus.cache")
PREFIX = "lotus:v1:"

_client: aioredis.Redis | None = None
_down_until = 0.0


def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(
            get_settings().redis_url, decode_responses=True, socket_timeout=1.5, socket_connect_timeout=1.5
        )
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None


def _available() -> bool:
    return get_settings().cache_enabled and time.monotonic() >= _down_until


def _mark_down(exc: Exception) -> None:
    global _down_until
    _down_until = time.monotonic() + 5.0  # circuit breaker: skip Redis for 5 s after a failure
    log.warning("redis_unavailable", extra={"error": type(exc).__name__})


async def cache_get(key: str) -> Any | None:
    if not _available():
        return None
    try:
        raw = await get_redis().get(PREFIX + key)
        return json.loads(raw) if raw else None
    except (RedisError, OSError, TimeoutError, ValueError) as e:
        if not isinstance(e, ValueError):
            _mark_down(e)
        return None


async def cache_set(key: str, value: Any, ttl: int) -> None:
    if not _available():
        return
    try:
        await get_redis().set(PREFIX + key, json.dumps(value, default=str, allow_nan=False), ex=ttl)
    except (RedisError, OSError, TimeoutError, ValueError) as e:
        if not isinstance(e, ValueError):
            _mark_down(e)


async def cache_delete(*keys: str) -> None:
    if not _available() or not keys:
        return
    try:
        await get_redis().delete(*[PREFIX + k for k in keys])
    except (RedisError, OSError, TimeoutError) as e:
        _mark_down(e)


async def redis_ping() -> bool:
    try:
        return bool(await get_redis().ping())
    except (RedisError, OSError, TimeoutError):
        return False


async def rate_limit_hit(scope: str, subject: str, limit: int) -> bool:
    """Fixed-window counter. Returns True when the request is *allowed*. Fails open if Redis is down."""
    if not get_settings().rate_limit_enabled or not _available():
        return True
    window = int(time.time() // 60)
    key = f"{PREFIX}rl:{scope}:{subject}:{window}"
    try:
        r = get_redis()
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, 70)
        return n <= limit
    except (RedisError, OSError, TimeoutError) as e:
        _mark_down(e)
        return True
