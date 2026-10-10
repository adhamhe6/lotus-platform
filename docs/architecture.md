# Architecture

```
                    ┌──────────────────────┐
                    │  React SPA (nginx)    │  /api/* reverse-proxied (same origin → first-party cookie)
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐        ┌──────────────┐
                    │   FastAPI (uvicorn)   │───────▶│    Redis     │  cache · rate limits · arq queue
                    └──────┬────────┬──────┘        └──────┬───────┘
                           │        │                      ▼
                           │        │              ┌──────────────┐
                           ▼        │              │  arq worker   │  same image, same code
                    ┌──────────────┐│              └──────┬───────┘
                    │ PostgreSQL 16 ││                     │
                    │  + pgvector   │◀────────────────────┘
                    └──────┬───────┘│
                           │        ▼
                           │  ┌──────────────┐   ┌────────────────────────────┐
                           │  │ Storage vol.  │   │ Engines (pure Python)       │
                           │  │ raw · parquet │   │ datasets · analysis · mixed │
                           │  │ models        │   │ qualitative · visualization │
                           │  └──────────────┘   │ ai (router/narrator) · reports │
                           ▼                      └────────────────────────────┘
                    source of truth
```

## Layers (backend)

`api/routes` (HTTP, validation, status codes) → `services` (use cases, authorization-aware, transactions) → pure **engines** → `db`/`storage`. Engines take and return DataFrames/Pydantic models; they are unit-tested without HTTP or a database. Authorization lives in `services/access.py`: every resource resolves through its project, non-members get `404`, insufficient role `403`.

## Request/job flow

1. `POST /projects/{id}/datasets` streams the upload to a temp file (size-capped), validates extension + magic bytes, stores it under a UUID name, creates `datasets` + an `analysis_jobs` row and returns **202**.
2. The job runs in the worker (or inline in dev/tests): parse → infer types → profile → write an immutable Parquet version → mark READY. Each stage updates `analysis_jobs.stage/completed_stages` (progress = completed/total, never invented). Failures store `{code, message}` and create a notification.
3. Analyses, theme detection, suggestions, mixed methods, insights and reports use the same job runtime. Jobs are idempotent (re-delivery of a finished job is a no-op), retried only for `TransientError` (≤ `JOB_MAX_TRIES`), cancellable at stage boundaries.

## Redis (keys `lotus:v1:*`, all fail-open with a 5 s circuit breaker)

| Key | Content | TTL | Invalidation |
|---|---|---|---|
| `profile:{version}` | column profile JSON | 1 h | versions are immutable → never stale; removed on dataset delete |
| `preview:{version}:{hash}` | unfiltered preview page | 1 h | immutable version |
| `dash:{project}:{revision}` | project overview | 60 s | `projects.revision` increments on every content change, so old keys are simply never read again |
| `run:{id}` | completed result | 10 min | results are immutable |
| `rl:{scope}:{subject}:{minute}` | rate-limit counters | 70 s | expire |
| `arq:*` / `lotus:jobs` | job transport | — | job rows in PostgreSQL are authoritative |

If Redis is down: reads fall back to PostgreSQL, rate limiting is skipped, readiness reports `redis: unavailable` (still 200); enqueueing in `arq` mode fails fast with `503 QUEUE_UNAVAILABLE` and the job row is marked FAILED (tested).

## Frontend

Feature folders over a small design system; server state in TanStack Query; a global job tracker polls real job status and refreshes dependent queries; a single `ChartSpec` renderer displays what the API computed; the access token lives in memory, the rotating refresh token in an httpOnly cookie. See `docs/frontend-guide.md`.

## Design system

Papyrus surfaces, deep-Nile ink, lotus-teal actions; Fraunces (display) + Inter (UI) + JetBrains Mono. Provenance has semantic colours: *Computed* teal, *Qualitative* lapis, *AI interpretation* terracotta, *Rule-based* slate. The lotus identity is restrained: the geometric lotus mark, a faint papyrus-column line pattern on the sign-in panel, and one "petal" corner shape on hero cards. Chart series use a colour-vision-deficiency-safe validated palette (light and dark variants), a text/table alternative for every chart, and 2 px surface gaps between adjacent fills.

## Key decisions

| Decision | Rationale |
|---|---|
| FastAPI + async SQLAlchemy + arq | one async stack end-to-end; arq is small and sufficient for ~10 job types (Celery would add a broker abstraction we do not need) |
| Parquet per dataset version, metadata in Postgres | typed, columnar, fast row-group slicing; immutable → reproducible and trivially cacheable |
| Engines as pure functions | known-answer tests; no HTTP/DB coupling |
| LLM only narrates evidence + numeric validator | prevents fabricated statistics by construction |
| Deterministic provider always available | the product is fully usable offline/self-hosted; AI is an enhancement |
| pgvector without ANN index | searches are scoped to one column slice; exact scan is accurate and fast at this scale |
| Refresh cookie + in-memory access token | limits XSS token theft; same-origin proxy keeps the cookie first-party |
