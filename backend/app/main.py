from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.routes import analyses, auth, datasets, jobs, projects
from app.cache.redis import close_redis, redis_ping
from app.core.config import get_settings
from app.core.exceptions import install_exception_handlers
from app.core.logging import configure_logging, request_id_var
from app.db.database import dispose_engine, get_engine

log = logging.getLogger("lotus.api")

DESCRIPTION = """
**Lotus Platform** — evidence-grounded data analysis for qualitative, quantitative and mixed-methods research.

* Every number comes from a computation on your data (`/analyses`, `/mixed`, `/qualitative`).
* AI text (`/ai`, insight narratives) is stored separately, cites the computations it explains and is numerically validated.
* Long-running work (ingestion, themes, reports) is asynchronous — poll `GET /jobs/{id}`.

Authenticate with `POST /auth/login`, then send `Authorization: Bearer <access_token>`.
"""

TAGS = [
    {"name": "Authentication", "description": "Registration, login, refresh-token rotation."},
    {"name": "Projects", "description": "Research projects, membership and roles (OWNER / EDITOR / VIEWER)."},
    {"name": "Datasets", "description": "Upload, profile, preview, clean and version datasets."},
    {"name": "Analysis", "description": "Statistical analyses and chart specifications computed from the data."},
    {"name": "Jobs & notifications", "description": "Background job status and notifications."},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    configure_logging(s.log_level, s.log_json)
    from app.api.deps import get_storage

    get_storage()
    log.info("api_started", extra={"environment": s.environment, "job_backend": s.job_backend})
    yield
    await close_redis()
    await dispose_engine()


def create_app() -> FastAPI:
    import app.workers.jobs  # noqa: F401  (register job handlers; required for the inline backend)

    s = get_settings()
    app = FastAPI(title="Lotus Platform API", version="1.0.0", description=DESCRIPTION, openapi_tags=TAGS, lifespan=lifespan, docs_url="/api/docs", redoc_url="/api/redoc",
                  openapi_url="/api/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origin_list, allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                       allow_headers=["Authorization", "Content-Type"], max_age=600)
    install_exception_handlers(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        ms = int((time.perf_counter() - t0) * 1000)
        response.headers["x-request-id"] = rid
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["referrer-policy"] = "no-referrer"
        response.headers["cache-control"] = "no-store"
        if not request.url.path.endswith("/health"):
            log.info("request", extra={"method": request.method, "path": request.url.path, "status": response.status_code, "duration_ms": ms})
        return response

    api = "/api/v1"
    for r in (auth.router, projects.router, datasets.router, analyses.router, jobs.router):
        app.include_router(r, prefix=api)
    _register_optional(app, api)

    @app.get(f"{api}/health", tags=["Health"], summary="Liveness")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(f"{api}/health/ready", tags=["Health"], summary="Readiness: database, Redis, storage")
    async def ready():
        from fastapi.responses import JSONResponse

        checks: dict[str, str] = {}
        try:
            async with get_engine().connect() as c:
                await c.execute(text("select 1"))
            checks["database"] = "ok"
        except Exception:
            checks["database"] = "unavailable"
        checks["redis"] = "ok" if await redis_ping() else "unavailable"
        checks["storage"] = "ok" if s.storage_dir.exists() else "unavailable"
        ok = checks["database"] == "ok" and checks["storage"] == "ok"  # Redis degradation is tolerated (cache fail-open) but reported
        return JSONResponse({"status": "ready" if ok else "unavailable", "checks": checks}, status_code=200 if ok else 503)

    return app


def _register_optional(app: FastAPI, api: str) -> None:
    """Routers added in later phases register themselves here if present."""
    import importlib

    for mod in ("qualitative", "mixed", "insights", "ai", "reports", "search", "overview"):
        try:
            m = importlib.import_module(f"app.api.routes.{mod}")
        except ModuleNotFoundError as e:
            if e.name != f"app.api.routes.{mod}":
                raise
            continue
        app.include_router(m.router, prefix=api)


app = create_app()
