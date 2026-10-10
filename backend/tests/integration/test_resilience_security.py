"""Failure injection and security behaviour: Redis/DB/queue/worker failures, rate limits, headers, log redaction, idempotent jobs."""

from __future__ import annotations

import logging
import uuid

import pytest
import redis.asyncio as aioredis
from arq.connections import RedisSettings
from arq.worker import Worker
from sqlalchemy import text

from app.cache import redis as cache
from app.core.config import get_settings
from app.core.logging import JsonFormatter, redact
from app.db.database import get_engine
from app.workers import queue, runtime
from tests.helpers import csv_bytes, survey_frame

pytestmark = pytest.mark.integration


async def project_with_dataset(api, n=80):
    p = (await api.post("/projects", json={"name": "R"})).json()
    ds = (
        await api.post(
            f"/projects/{p['id']}/datasets", files={"file": ("s.csv", csv_bytes(survey_frame(n)), "text/csv")}
        )
    ).json()["dataset"]
    return p, ds


async def test_redis_down_is_tolerated_everywhere(alice, client, monkeypatch):
    p, ds = await project_with_dataset(alice)
    dead = aioredis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2, socket_timeout=0.2)
    monkeypatch.setattr(cache, "_client", dead)
    monkeypatch.setattr(cache, "_down_until", 0.0)
    # reads fall back to the database, writes still succeed
    assert (await alice.get(f"/datasets/{ds['id']}/profile")).status_code == 200
    assert (await alice.get(f"/datasets/{ds['id']}/preview")).status_code == 200
    assert (await alice.get(f"/projects/{p['id']}/overview")).status_code == 200
    r = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": ds["latest_version"]["id"],
            "analysis_type": "frequency",
            "config": {"column": "region"},
        },
    )
    assert r.status_code == 202 and r.json()["analysis"]["status"] == "COMPLETED"
    ready = await client.get("/api/v1/health/ready")
    assert (
        ready.status_code == 200 and ready.json()["checks"]["redis"] == "unavailable"
    )  # degraded but serving, and reported honestly


async def test_database_down_readiness_and_error_envelope(client, monkeypatch):
    from sqlalchemy.ext.asyncio import create_async_engine

    bad = create_async_engine("postgresql+asyncpg://postgres:nope@127.0.0.1:1/none")
    monkeypatch.setattr("app.main.get_engine", lambda: bad)
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 503 and r.json()["checks"]["database"] == "unavailable"
    assert "127.0.0.1" not in r.text and "nope" not in r.text
    await bad.dispose()


async def test_unexpected_errors_never_leak_internals(client, alice, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("secret connection string postgresql://user:pw@db/internal")

    monkeypatch.setattr("app.api.routes.projects.project_service.list_projects", boom)
    r = await alice.get("/projects")
    assert r.status_code == 500 and r.json() == {
        "error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred. Please try again."}
    }


async def test_worker_failure_marks_job_failed_with_notification(alice, monkeypatch):
    p, ds = await project_with_dataset(alice)

    async def crash(ctx, params):
        raise ValueError("kaboom with /etc/passwd path")

    monkeypatch.setitem(
        runtime.JOB_TYPES, "run_analysis", runtime.JobSpec("run_analysis", ["a", "b"], crash, "analysis")
    )
    r = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": ds["latest_version"]["id"],
            "analysis_type": "frequency",
            "config": {"column": "region"},
        },
    )
    job = r.json()["job"]
    assert job["status"] == "FAILED" and job["error"] == {
        "code": "INTERNAL_ERROR",
        "message": "The job failed unexpectedly. The error has been logged.",
    }
    assert "passwd" not in str(job)
    n = (await alice.get("/notifications")).json()
    assert (
        n[0]["kind"] == "job_failed" and (await alice.get("/notifications/unread-count")).json()["count"] >= 1
    )


async def test_real_arq_worker_executes_queued_jobs_and_retries_transient_failures(alice, monkeypatch):
    p, ds = await project_with_dataset(alice)
    monkeypatch.setattr(get_settings(), "job_backend", "arq")
    monkeypatch.setattr(queue, "_pool", None)
    r = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": ds["latest_version"]["id"],
            "analysis_type": "correlation",
            "config": {"variables": ["delivery_time", "satisfaction"]},
        },
    )
    assert r.status_code == 202
    job = r.json()["job"]
    assert (
        job["status"] == "PENDING" and r.json()["analysis"]["status"] == "PENDING"
    )  # API returned immediately; nothing ran in the request
    worker = Worker(
        functions=[queue.execute_job],
        redis_settings=RedisSettings.from_dsn(get_settings().redis_url),
        queue_name="lotus:jobs",
        burst=True,
        handle_signals=False,
        max_tries=3,
    )
    await worker.main()
    await worker.close()
    done = (await alice.get(f"/jobs/{job['id']}")).json()
    assert (
        done["status"] == "COMPLETED"
        and done["progress"] == 1.0
        and done["attempts"] == 1
        and done["started_at"]
        and done["completed_at"]
    )
    a = (await alice.get(f"/analyses/{r.json()['analysis']['id']}")).json()
    assert a["status"] == "COMPLETED" and a["result"]["metrics"]
    # redelivering a finished job is a no-op (idempotent)
    assert await runtime.run_job(uuid.UUID(job["id"])) == "COMPLETED"
    assert (await alice.get(f"/jobs/{job['id']}")).json()["attempts"] == 1
    # transient error → retried by arq → succeeds on attempt 2
    calls = {"n": 0}

    async def flaky(ctx, params):
        calls["n"] += 1
        if calls["n"] == 1:
            from app.core.exceptions import TransientError

            raise TransientError("temporary")
        return {"type": "flaky"}

    monkeypatch.setitem(
        runtime.JOB_TYPES, "run_analysis", runtime.JobSpec("run_analysis", ["x"], flaky, "analysis")
    )
    r2 = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": ds["latest_version"]["id"],
            "analysis_type": "frequency",
            "config": {"column": "region"},
        },
    )
    jid = r2.json()["job"]["id"]
    w2 = Worker(
        functions=[queue.execute_job],
        redis_settings=RedisSettings.from_dsn(get_settings().redis_url),
        queue_name="lotus:jobs",
        burst=True,
        handle_signals=False,
        max_tries=3,
        poll_delay=0.1,
    )
    await w2.main()
    await w2.close()
    j = (await alice.get(f"/jobs/{jid}")).json()
    assert calls["n"] == 2 and j["status"] == "COMPLETED" and j["attempts"] == 2


async def test_queue_unavailable_fails_fast_and_cleanly(alice, monkeypatch):
    p, ds = await project_with_dataset(alice)
    monkeypatch.setattr(get_settings(), "job_backend", "arq")
    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    monkeypatch.setattr(queue, "_pool", None)
    r = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": ds["latest_version"]["id"],
            "analysis_type": "frequency",
            "config": {"column": "region"},
        },
    )
    assert r.status_code == 503 and r.json()["error"]["code"] == "QUEUE_UNAVAILABLE"
    async with get_engine().connect() as c:
        st = (
            await c.execute(
                text("select status, error->>'code' from analysis_jobs where type = 'run_analysis'")
            )
        ).all()
    assert st == [("FAILED", "QUEUE_UNAVAILABLE")]


async def test_cancel_pending_job(alice, monkeypatch):
    p, ds = await project_with_dataset(alice)
    monkeypatch.setattr(get_settings(), "job_backend", "arq")
    monkeypatch.setattr(queue, "_pool", None)
    r = await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": ds["latest_version"]["id"],
            "analysis_type": "frequency",
            "config": {"column": "region"},
        },
    )
    jid = r.json()["job"]["id"]
    c = (await alice.post(f"/jobs/{jid}/cancel")).json()
    assert c["status"] == "CANCELLED"
    worker = Worker(
        functions=[queue.execute_job],
        redis_settings=RedisSettings.from_dsn(get_settings().redis_url),
        queue_name="lotus:jobs",
        burst=True,
        handle_signals=False,
    )
    await worker.main()
    await worker.close()
    assert (await alice.get(f"/jobs/{jid}")).json()[
        "status"
    ] == "CANCELLED"  # the worker honoured the cancellation


async def test_rate_limiting_on_auth_and_ai(client, alice, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "rate_limit_enabled", True)
    monkeypatch.setattr(s, "auth_rate_limit_per_minute", 3)
    codes = [
        (
            await client.post(
                "/api/v1/auth/login", json={"email": "x@example.com", "password": "wrong-pass-123"}
            )
        ).status_code
        for _ in range(5)
    ]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    monkeypatch.setattr(s, "ai_rate_limit_per_minute", 1)
    p, ds = await project_with_dataset(alice)
    conv = (await alice.post(f"/projects/{p['id']}/ai/conversations", json={})).json()
    assert (
        await alice.post(
            f"/ai/conversations/{conv['id']}/messages", json={"content": "summarize the findings"}
        )
    ).status_code == 201
    r = await alice.post(
        f"/ai/conversations/{conv['id']}/messages", json={"content": "summarize the findings"}
    )
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"


async def test_conversations_are_private_even_inside_a_shared_project(alice, bob):
    p, ds = await project_with_dataset(alice)
    await alice.post(f"/projects/{p['id']}/members", json={"email": "bob@example.com", "role": "EDITOR"})
    conv = (await alice.post(f"/projects/{p['id']}/ai/conversations", json={})).json()
    assert (await bob.get(f"/ai/conversations/{conv['id']}")).status_code == 404
    assert (
        await bob.post(
            f"/ai/conversations/{conv['id']}/messages", json={"content": "what is the average delivery_time?"}
        )
    ).status_code == 404
    assert (await bob.get(f"/projects/{p['id']}/ai/conversations")).json() == []
    bconv = (await bob.post(f"/projects/{p['id']}/ai/conversations", json={})).json()
    assert (await alice.get(f"/ai/conversations/{bconv['id']}")).status_code == 404


async def test_ai_status_never_exposes_secrets(alice, monkeypatch):
    from pydantic import SecretStr

    monkeypatch.setattr(get_settings(), "ai_api_key", SecretStr("sk-super-secret-value"))
    monkeypatch.setattr(get_settings(), "ai_provider", "openai_compatible")
    body = (await alice.get("/ai/status")).text
    assert (
        "sk-super-secret-value" not in body
        and '"api_key_configured":true' in body.replace(" ", "")
        and '"external_data_sharing":true' in body.replace(" ", "")
    )


async def test_security_headers_and_cors(client):
    r = await client.get("/api/v1/health", headers={"Origin": "http://localhost:8080"})
    assert (
        r.headers["x-content-type-options"] == "nosniff"
        and r.headers["cache-control"] == "no-store"
        and r.headers["x-request-id"]
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:8080"
    evil = await client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in evil.headers


def test_log_redaction():
    assert "hunter2" not in redact('password="hunter2" token=abc.def.ghi Authorization: Bearer xyz')
    rec = logging.LogRecord("t", logging.INFO, "", 0, "login failed password=hunter2", (), None)
    rec.api_key = "sk-123456"
    out = JsonFormatter().format(rec)
    assert "hunter2" not in out and "sk-123456" not in out and "[REDACTED]" in out


async def test_cascade_delete_project_removes_files_and_rows(alice):
    from app.core.config import get_settings as gs

    p, ds = await project_with_dataset(alice)
    before = len(list((gs().storage_dir / "versions").glob("*.parquet")))
    assert (await alice.delete(f"/projects/{p['id']}")).status_code == 204
    async with get_engine().connect() as c:
        for t in ("datasets", "dataset_versions", "dataset_columns", "analysis_jobs"):
            assert (await c.execute(text(f"select count(*) from {t}"))).scalar_one() == 0
    assert len(list((gs().storage_dir / "versions").glob("*.parquet"))) == before - 1


async def test_cookie_endpoints_refuse_foreign_origins(client, alice):
    r = await client.post("/api/v1/auth/refresh", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CROSS_ORIGIN_REFUSED"
    assert (
        await client.post("/api/v1/auth/logout", headers={"Origin": "https://evil.example"})
    ).status_code == 403
    ok = await client.post("/api/v1/auth/refresh", headers={"Origin": "http://localhost:8080"})
    assert ok.status_code in (200, 401)  # allowed origin reaches the handler (401 = no cookie in this client)


async def test_rate_limit_ignores_spoofed_forwarded_for(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "rate_limit_enabled", True)
    monkeypatch.setattr(s, "auth_rate_limit_per_minute", 2)
    codes = [
        (
            await client.post(
                "/api/v1/auth/login",
                json={"email": "x@example.com", "password": "wrong-pass-123"},
                headers={"X-Forwarded-For": f"10.0.0.{i}"},
            )
        ).status_code
        for i in range(4)
    ]
    assert codes == [401, 401, 429, 429]


async def test_hostile_dataset_values_cannot_inject_into_reports(alice):
    evil = "<img src=x onerror=alert(1)>"
    csv = (
        "region,score,comment\n"
        + "\n".join(f"{evil if i % 2 else 'ok'},{i % 7 + i / 10},Slow delivery {i}" for i in range(60))
    ).encode()
    p = (await alice.post("/projects", json={"name": "X"})).json()
    ds = (
        await alice.post(f"/projects/{p['id']}/datasets", files={"file": ("e.csv", csv, "text/csv")})
    ).json()["dataset"]
    vid = ds["latest_version"]["id"]
    await alice.post(
        f"/projects/{p['id']}/analyses",
        json={
            "dataset_version_id": vid,
            "analysis_type": "group_comparison",
            "config": {"outcome": "score", "group": "region"},
        },
    )
    await alice.post(
        f"/projects/{p['id']}/analyses",
        json={"dataset_version_id": vid, "analysis_type": "frequency", "config": {"column": "region"}},
    )
    rep = (await alice.post(f"/projects/{p['id']}/reports/generate", json={})).json()
    html = (await alice.get(f"/reports/{rep['result_ref']['report_id']}/render")).text
    assert "<img src=x" not in html and "&lt;img src=x" in html
    assert (
        "script-src"
        not in (await alice.get(f"/reports/{rep['result_ref']['report_id']}/render")).headers[
            "content-security-policy"
        ]
    )
