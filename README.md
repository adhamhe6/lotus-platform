<p align="center"><img src="frontend/public/favicon.svg" width="72" alt="Lotus" /></p>

# Lotus Platform

**Evidence-grounded data analysis for qualitative, quantitative and mixed-methods research.**
Upload a dataset, understand it, analyse it with statistics you can defend, code and theme open-ended responses, connect what people *say* to what the data *measures*, ask questions, and publish a traceable report — where every number is computed, and AI only ever interprets the computed evidence.

> Lotus is not “ChatGPT + CSV upload”. A language model never calculates anything here. It is optional, sees only bounded evidence summaries, and its output is validated number-by-number against that evidence. The product works completely offline without a model.

## Why Lotus exists

Researchers and analysts juggle spreadsheets, a stats package, a qualitative-coding tool and a chat assistant — and the hand-offs lose provenance. Worse, generic AI assistants happily state statistics they never computed. Lotus keeps one project, one data lineage and one standard of evidence from raw file to report, and labels every piece of content as **Computed**, **Qualitative**, **AI interpretation** or **Rule-based summary**.

## Core capabilities

| Area | What you get |
|---|---|
| **Data** | CSV/TSV/XLSX import with signature validation; encoding/delimiter detection; type inference (numeric, discrete, binary, category, date, text, identifier); per-column profile (quartiles, skew, outliers, categories, date span); data-quality issues; paginated preview with sort/filter; **non-destructive cleaning** that creates immutable, hash-identified dataset versions |
| **Quantitative** | descriptive, frequency, correlation (Pearson/Spearman, Holm-adjusted matrices), χ²/Fisher + Cramér's V, group comparison (Welch t / Mann-Whitney / Welch-ANOVA / Kruskal + post-hoc + effect sizes), linear & logistic regression with diagnostics, time-series trend — each with assumptions, caveats, methodology and reproducibility record |
| **Qualitative** | segmenting, embeddings (pgvector), **theme detection you can edit** (rename, merge, move, delete), a codebook with keyword + semantic *suggestions* that stay suggestions until you accept them, semantic search, keyword frequencies |
| **Mixed methods** | per theme/code: outcome *with vs without* (effect size, CI, Holm-corrected p), convergence with other measured variables, prevalence by group, quotes — as a joint display, with findings emitted only above explicit evidence thresholds |
| **AI assistant** | routes your question to the right computation, reuses stored analyses, answers from an evidence pack, validates numbers, says so when the data can't answer |
| **Insights** | rule-derived statements with evidence and a trace Insight → analysis → variables → dataset version; noise produces no insight |
| **Visualisation** | server-computed chart specs (histogram, bar, box, scatter, line, heatmap, stacked, donut, coefficient, ROC) with chart-type guards, accessible text alternatives and data tables |
| **Reports** | auto-drafted or hand-built, reorderable sections, methodology/limitations composed from the actual analyses, traceability table, print-ready HTML (→ PDF), Markdown, JSON |
| **Platform** | RBAC (owner/editor/viewer), background jobs with real stage progress, Redis caching, notifications, ⌘K search, dark mode |

## Architecture

```
                    ┌──────────────────────┐
                    │      React UI        │
                    │  Analysis Workspace  │
                    └──────────┬───────────┘
                               │  same-origin /api (nginx)
                               ▼
                    ┌──────────────────────┐
                    │       FastAPI        │
                    └──────┬─────┬─────────┘
                ┌──────────┘     └──────────┐
                ▼                           ▼
        ┌──────────────┐            ┌──────────────┐
        │ PostgreSQL   │            │    Redis     │
        │ + pgvector   │            │ Cache / Jobs │
        └──────┬───────┘            └──────┬───────┘
               │                           ▼
               │                    ┌──────────────┐
               │                    │  arq Worker  │
               │                    └──────┬───────┘
               ▼                           ▼
        ┌──────────────┐            ┌──────────────┐
        │  Analysis    │            │ AI / NLP     │
        │  Engine      │            │ Pipeline     │
        └──────────────┘            └──────────────┘
```

Details: [`docs/architecture.md`](docs/architecture.md) · [`docs/analysis-engine.md`](docs/analysis-engine.md) · [`docs/ai-architecture.md`](docs/ai-architecture.md) · [`docs/data-model.md`](docs/data-model.md) · [`docs/security-review.md`](docs/security-review.md) · [`docs/performance.md`](docs/performance.md) · [`docs/legacy-analysis.md`](docs/legacy-analysis.md) · [`docs/implementation-plan.md`](docs/implementation-plan.md) · [`docs/verification.md`](docs/verification.md)

### AI in one paragraph

`question → router → analysis engine (computed, stored, idempotent) → evidence pack E1…En → narrator (LLM or rule-based) → numeric validator → message with typed provenance blocks`. Providers are replaceable (OpenAI-compatible incl. Ollama/vLLM, Anthropic, or none). Prompt and model versions are stored with every AI artifact. Embeddings are pluggable: offline TF-IDF+LSA by default, sentence-transformers optionally.

### Data analysis in one paragraph

Pure functions over DataFrames with type/role validation, explicit missing-data handling, assumption checks surfaced beside results, fixed seeds, effect sizes and confidence intervals, multiple-comparison correction, and typed errors (`ZERO_VARIANCE`, `INSUFFICIENT_OBSERVATIONS`, …) instead of nonsense. Known-answer unit tests cover each method.

## Run it with Docker

```bash
cp .env.example .env
# set SECRET_KEY and POSTGRES_PASSWORD (and optionally SEED_DEMO_DATA=true + DEMO_USER_PASSWORD)
python3 -c "import secrets; print(secrets.token_urlsafe(48))"      # use as SECRET_KEY
docker compose up --build
```

* UI → <http://localhost:8080> · API docs (Swagger) → <http://localhost:8080/api/docs>
* Services: `postgres` (pgvector) · `redis` · `migrate` (one-shot `alembic upgrade head` + optional seed) · `api` · `worker` · `frontend`; every long-running service has a health check and dependencies wait for readiness.
* Self-hosted AI (optional): `docker compose --profile ollama up`, then set `AI_PROVIDER=openai_compatible`, `AI_BASE_URL=http://ollama:11434/v1`, `AI_MODEL=<model>`.

## Local development

Requirements: Python ≥ 3.11 (tested 3.13), Node 22, PostgreSQL 16 **with the pgvector extension**, Redis 7.

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.lock && pip install -e . pytest pytest-asyncio pytest-cov ruff mypy pandas-stubs
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
export DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/lotus
export REDIS_URL=redis://localhost:6379/0
alembic upgrade head
uvicorn app.main:app --reload                        # JOB_BACKEND=inline runs jobs in-process; or:  arq app.workers.queue.WorkerSettings
DEMO_USER_PASSWORD='DemoPassw0rd!' python -m app.scripts.seed_demo     # optional demo workspace

# frontend
cd frontend && npm ci && npm run dev                  # http://localhost:5173 (proxies /api → :8000)
```

## Testing

```bash
scripts/verify                                        # everything CI runs
cd backend  && pytest -q                              # unit + integration + e2e (needs PostgreSQL+pgvector and Redis; TEST_DATABASE_URL / TEST_REDIS_URL)
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
BASE_URL=http://localhost:5173 node frontend/e2e/tour.mjs screenshots   # browser tour of every screen (desktop/mobile/dark)
python scripts/benchmark.py --email … --password … --rows 250000        # throughput on a large file
```

The five end-to-end workflows (quantitative, qualitative, AI insight, mixed methods, report) are in `backend/tests/e2e/test_workflows.py` and verify results against independent computations and the database.

## The demo (every step is real functionality)

Seed (`SEED_DEMO_DATA=true`) creates **Customer Experience Study 2026**: 608 survey rows (delivery time, support rating, satisfaction, spend, retention, region, plan, survey date) with realistic mess (missing values, 8 duplicates) and a free-text comment per customer, plus a qualitative-only **Employee Engagement Pulse**. Relationships are *planted in the generator* (`scripts/generate_demo_data.py`) but never shipped as results — Lotus rediscovers them: delivery time ↔ satisfaction (r ≈ −0.5), West region lowest, satisfaction → spend/retention, delivery complaints voiced by lower-satisfaction customers who also record longer delivery times.

1. Sign in (`demo@lotus-demo.org`) → open the project → **Overview**.
2. **Data** → dataset → *Overview* shows the duplicates/missing issues → *Prepare* → drop duplicates → new version.
3. **Analysis** → run correlation / group comparison / regression → read assumptions, charts, methodology → **Explain this result**.
4. **Qualitative** → prepare the comment column → detect themes → review codes and accept suggestions.
5. **Mixed methods** → themes/codes × satisfaction → joint display and convergence findings.
6. **AI Assistant** → “Which factors appear most strongly associated with satisfaction?”
7. **Insights** → open *Why this insight?* · **Reports** → generate → preview → print/export.

## Key engineering decisions

See `docs/architecture.md`. In short: FastAPI + async SQLAlchemy + arq; Parquet per immutable dataset version; pure analysis engines; LLM-narrates-evidence with a numeric validator and an always-available rule-based fallback; pgvector without ANN index (searches are scoped to one text column); refresh token in an httpOnly cookie with in-memory access token; one `ChartSpec` rendered by the UI and by the report exporter.

## Known limitations

* The offline TF-IDF/LSA embedding groups text by shared vocabulary; for heavily paraphrased text enable the sentence-transformers provider or rely on codes. (`docs/ai-architecture.md`)
* UI is English-only (text processing handles Arabic; full RTL translation is future work).
* Not included: Monte-Carlo decision simulation and PDF-reading from the legacy app, forecasting, mixed-effects models, real-time collaboration.
* Access tokens are not individually revocable before their 30-minute expiry.

## Repository layout

```
backend/    FastAPI app (api · services · analysis · qualitative · mixed · ai · datasets · reports · workers), Alembic, tests
frontend/   React SPA (design system, feature folders, tests, browser tour)
docs/       architecture, engine, AI, data model, security, performance, legacy analysis, plan, verification, OpenAPI snapshot
data/demo/  deterministic demo datasets (generated by scripts/generate_demo_data.py)
scripts/    demo-data generator, benchmark, verify
docker-compose.yml · .env.example · .github/workflows/ci.yml
```
