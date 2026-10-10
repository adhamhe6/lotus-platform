# Lotus Platform — implementation plan

Status legend used in `docs/verification.md` at the end of the build: every claim there is backed by a command that was run.

## 1. Product architecture

One workflow, one data model:

```
Project ─┬─ Dataset ─ DatasetVersion (raw → cleaned → transformed; parquet, immutable)
         │              └─ DatasetColumn (inferred type + profile)
         ├─ AnalysisRun (config + result + provenance)  ─┬─ Insight (statement + evidence → run)
         ├─ SavedVisualization                           └─ AIMessage evidence refs
         ├─ Qualitative: Segment ─ Annotation ─ Code ; Theme ─ ThemeSegment
         ├─ MixedMethodsRun
         ├─ Report (ordered sections → runs / insights / charts / themes)
         ├─ AIConversation ─ AIMessage
         └─ AnalysisJob (async work) · Notification
```

The **workspace** is the project: users never see "pages of tools" but a project with
*Overview · Data · Analysis · Qualitative · Mixed methods · Visualizations · Insights · AI Assistant · Reports*.
A separate `Workspace` entity was rejected: a project already is the research context and the permission boundary.

## 2. Application architecture

* **API** — FastAPI (async), Pydantic v2, SQLAlchemy 2 (asyncpg), Alembic. Layering: `api/routes` (HTTP only)
  → `services` (use cases, transactions, authorization-aware) → `repositories` where it pays off →
  pure engines (`datasets`, `analysis`, `qualitative`, `mixed`, `visualization`, `ai`, `reports`) that never import
  FastAPI or SQLAlchemy. Engines take/return DataFrames and Pydantic result models, so they are unit-testable
  with known datasets.
* **Worker** — arq on Redis. Same code base/image as the API. Jobs are rows in `analysis_jobs` (source of truth);
  Redis only transports. `JOB_BACKEND=inline` runs the identical job functions in-process (tests, tiny dev setups).
* **Frontend** — React 19 + TypeScript + Tailwind 4 + Radix primitives (shadcn-style components) + TanStack Query +
  React Hook Form/Zod + Recharts (+ small custom SVG for box plots / heatmaps).
* **Storage** — private volume (`STORAGE_DIR`), never served statically. Raw upload kept byte-for-byte; each dataset
  version is a Parquet file. File names on disk are UUIDs; user filenames are metadata only.

## 3. Data model (PostgreSQL)

Users, refresh_tokens (hashed, rotated, revocable), projects, project_members (OWNER/EDITOR/VIEWER),
datasets, dataset_versions (parent, transformation JSON, schema JSON, content hash, row/col counts),
dataset_columns, analysis_runs (type, config, config_hash, result JSON, status, runtime, library versions, seed),
insights (statement, evidence JSON, source run, qualification, origin = computed|ai), saved_visualizations,
qualitative_codes, qualitative_segments (+ `embedding vector` via pgvector), qualitative_annotations,
qualitative_themes, theme_segments, mixed_method_runs, reports, ai_conversations, ai_messages (provenance,
evidence refs, model/prompt version), analysis_jobs, notifications. Details: `docs/data-model.md`.

Constraints: FK cascade from project; unique `(dataset_id, version_number)`; unique `(version_id, column, row_index, seg_index)`
on segments (idempotent segmentation); unique idempotency key on jobs per project; check constraints on enums/roles;
btree indexes on every FK used in listing + `(project_id, created_at desc)`; an ivfflat/hnsw index is *not* created —
segment searches are always filtered to one dataset version (hundreds–tens of thousands of rows), so an exact scan with
the btree filter is faster and exact; documented in `docs/performance.md`.

## 4. Analysis architecture

`app/analysis` is a registry of analysis types, each = `(ConfigModel, run(df, config) -> AnalysisResult)`:

descriptive · frequency · correlation (pair + matrix, Pearson/Spearman) · crosstab (χ², Fisher 2×2, Cramér's V) ·
group_comparison (auto Welch-t / Mann-Whitney / one-way ANOVA / Kruskal + Tukey, effect sizes) · linear_regression (OLS, HC3 option,
VIF, diagnostics) · logistic_regression (odds ratios, AUC, separation detection) · time_series (resample, trend, moving average, PoP).

Rules: validate variable types → drop-missing report (n used / n dropped, never silent) → min-n and zero-variance guards →
assumption checks surfaced (not hidden) → deterministic (seeded) → result object separates `metrics` (numbers),
`tables`, `charts` (declarative `ChartSpec`), `assumptions`, `warnings`, `methodology`. **No prose interpretation inside the
engine.** Methodological decisions are in `docs/analysis-engine.md`.

## 5. AI architecture

* **Providers** (`app/ai/providers`): `openai_compatible` (OpenAI, Ollama, vLLM, LM Studio…), `anthropic`, and `deterministic`
  (template narration of the evidence pack — always available, clearly labeled). Config by env; keys never leave the server.
* **Grounding pipeline**: question → *router* (rule-based intent + column resolution) → *analysis engine* (computes or
  reuses a stored `AnalysisRun`) → *evidence pack* (`E1..En`, every fact tied to a run/column/theme) → provider narrates
  with a strict JSON contract → **validator** checks cited ids exist and every number in the prose appears in the evidence
  (within rounding) → on failure fall back to deterministic narration and mark `validation=failed`.
* Message provenance is stored per message: `computed` blocks, `qualitative` blocks, `ai_interpretation` text, model name,
  prompt version, evidence ids. The UI renders them with distinct badges.
* **Embeddings** (`app/qualitative/embeddings`): `EmbeddingProvider` interface. Default `tfidf-lsa` (scikit-learn, offline,
  deterministic, fitted per dataset-column and persisted); optional `sentence-transformers` (multilingual MiniLM) via
  `pip install .[nlp]` and `EMBEDDING_PROVIDER=sentence-transformers`. Vectors stored in pgvector.
* Prompts are versioned constants in `app/ai/prompts.py`.

## 6. Qualitative / quantitative / mixed workflows

* **Qualitative**: choose text column → segmentation job (row = response; long transcripts split into sentences) →
  preprocessing + embeddings → theme detection (KMeans, k by silhouette, seed fixed) → c-TF-IDF labels, representative quotes,
  counts → *suggestions* only: researcher renames/merges/deletes themes, creates codes, accepts/rejects suggested code
  annotations. Frequencies are always `COUNT(*)` over stored memberships.
* **Quantitative**: analysis builder → job (or inline for small data) → stored run → charts/insights.
* **Mixed**: join theme membership to quantitative columns by `(dataset_version, row_index)`. For each theme, compare a numeric
  outcome between respondents who voiced it and those who did not (effect size, CI, Holm-adjusted p), and theme prevalence across
  groups. Output = joint display with three clearly separated layers: *quantitative evidence*, *qualitative evidence*,
  *AI synthesis* (optional). Claims are only emitted when thresholds (n, adj-p, effect size) hold.

## 7. Visualization strategy

Backend builds `ChartSpec` (kind, encodings, aggregated data, labels, units, a11y description) from *computed* data.
Frontend renders specs (Recharts + custom SVG). The same specs are rendered to SVG server-side for reports.
Chart-type guard (`visualization/recommend.py`) refuses/redirects misleading combos (pie > 6 slices, line on unordered categories, bar axes not starting at zero, etc.).
Scatter payloads are downsampled deterministically (≤ 2 000 points) while statistics use all rows.

## 8. Background processing, caching

Jobs: ingest_dataset, apply_transform, run_analysis, build_segments+embed, detect_themes, generate_insights, mixed_methods,
generate_report. States PENDING/RUNNING/COMPLETED/FAILED/CANCELLED, `stage` + `progress = completed_stages/total_stages` (real),
retries only for transient infrastructure errors (`max_tries=3`, backoff), idempotency keys.
Redis keys (all `lotus:v1:*`, fail-open): dataset profile/preview (TTL 1 h, bust by version id), dashboard summary (TTL 60 s + project
revision counter), analysis result reads (TTL 10 min), rate limiting (fixed window), arq queue. DB is source of truth. See `docs/architecture.md`.

## 9. Security

Argon2id; short-lived JWT access + rotating hashed refresh token in httpOnly cookie; per-project RBAC enforced in services (404 for
non-members); upload validation (extension ∩ magic bytes ∩ size ∩ parse); UUID file names; no static serving of storage; strict error
envelope without internals; log redaction; CORS allow-list; rate limits on auth & AI; outbound AI only if explicitly configured; security
headers; dependency audit in CI. `docs/security-review.md` at the end.

## 10. Testing

pytest (unit with known-answer statistics; integration against real PostgreSQL+pgvector and Redis; e2e API workflows 1–5; failure injection),
vitest + Testing Library + MSW for UI, a Playwright browser pass against the live stack for the visual/UX gate, CI mirrors all of it.

## 11. Deployment / observability

Docker Compose: `postgres` (pgvector image), `redis`, `migrate` (one-shot), `api`, `worker`, `frontend` (nginx, proxies `/api`), optional `ollama` profile.
Health: `/api/v1/health` (liveness), `/api/v1/health/ready` (DB, Redis, storage). Structured JSON logs with request id, job id, timings.

## 12. Phases

1. Foundation: config, db, auth, projects/RBAC, error model, logging, migrations, tests harness
2. Datasets: ingestion, schema inference, profiling, preview, transforms, versions, jobs/worker, Redis cache
3. Analysis engine + visualization specs + runs API + reproducibility
4. Qualitative + embeddings + themes + coding; mixed methods
5. Insights + AI (providers, router, evidence, validator, assistant) + suggestions
6. Reports + search + notifications + demo data/seed
7. Frontend shell/design system → feature pages → tests
8. Docker, CI, docs, security/perf review, browser visual QA, final verification

## 13. Major decisions (ADR summary)

| # | Decision | Why |
|---|---|---|
| 1 | FastAPI + async SQLAlchemy + arq (not Celery) | Same async stack end-to-end; arq is tiny and enough for ~8 job types |
| 2 | Parquet per dataset version, metadata in Postgres | Typed, columnar, fast previews; immutable → reproducible |
| 3 | Engines are pure functions | Testable with known answers; no HTTP/DB coupling |
| 4 | LLM only explains computed evidence | Prevents fabricated statistics; numeric validator enforces it |
| 5 | Deterministic provider always present | The product works fully offline; AI is an enhancement, never a dependency |
| 6 | TF-IDF+LSA default embeddings | No model download/GPU; deterministic; swap to transformers by config |
| 7 | pgvector, no ANN index | Searches are scoped to one version; exact scan is accurate and fast at this scale |
| 8 | Refresh token in httpOnly cookie, access token in memory | Limits XSS token theft |
| 9 | Declarative `ChartSpec` | One chart definition for UI, report SVG and tests |
