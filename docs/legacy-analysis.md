# Legacy analysis — the original `Lotus` repository

> The old repository (`adhamhe6/Lotus`, two commits: `first commit`, `Remove API key`) was studied as
> reference material only. It was **not modified** and none of its code was copied into this repository.
> This document records what it tried to do, what is worth keeping, and what was deliberately discarded.

## 1. What the old project attempted

A Django 5.2 monolith ("Lotus Platform – Data Analysis Solution") with a marketing website (home, pricing,
careers, newsroom, …) and four loosely related "tools" rendered as separate server-side dashboards:

| Legacy tool | Where | What it actually did |
|---|---|---|
| **Quant analysis** ("Scientific Correlation Analyzer") | `products/tools/analysis_tool.py`, `views.quant_analysis_*` | Upload CSV → choose Y → Pearson r / p for numeric X, group counts + group means for categorical X → matplotlib PNG + templated sentence + ReportLab PDF (Arabic/English) |
| **Decision analytics** | `views.decision_*` | CSV of decisions (`distribution`, `params`, `success_prob`) → Monte-Carlo simulation (10 distributions) → EV, success rate, ECDF/hist/box charts |
| **Content analyzer** ("Qualitative & Sentiment") | `analysis_utils.py` | Upload PDF/XLSX/CSV/TXT → user-supplied keyword (+ WordNet synonym) frequency counting → PDF/XLSX/CSV report + a Perplexity chat |
| **Paper AI** | `paper_ai_server.py` | Separate FastAPI process running `google/mt5-base` to summarise papers in Arabic/English (chunked, truncated to 10 chunks) |

There was no project concept, no dataset model, no persisted analysis lineage, and the "qualitative" tool
was keyword counting rather than coding/theming. The README promised features (market-trend analyzer,
predictive suite, multi-tenancy, REST APIs) that did not exist in code.

## 2. Valuable features and ideas worth carrying forward

* **Bilingual intent (Arabic/English)** — real researcher audience in the region. Carried forward as
  Unicode-aware text processing, Arabic+English stop-word handling and RTL-safe rendering of text content.
  (Full UI translation is a documented future item, not faked.)
* **Pearson correlation with r², significance and plain-language reading** — kept, but rebuilt on a
  proper engine with confidence intervals, assumption checks and a hard separation between *computed*
  numbers and *interpretation text*.
* **Categorical-vs-numeric comparison** (counts + group means) — kept and upgraded to proper
  group-comparison tests (Welch t / Mann-Whitney / ANOVA / Kruskal, effect sizes, post-hoc).
* **Keyword / codebook frequency with synonym expansion** — kept as the *deductive coding* path of the
  qualitative module (`QualitativeCode.keywords`), now alongside embedding-based inductive theme detection.
* **Monte-Carlo decision simulation with named distributions** — a genuinely good idea. Kept in scope as
  a documented future analysis type (the analysis registry makes it a drop-in); *not* shipped in v1 to avoid
  breadth over correctness.
* **Report exports (PDF/XLSX/CSV)** — carried forward as a traceable report builder with HTML (print→PDF),
  Markdown and JSON export.
* **Domain vocabulary**: runs, dependent (Y) variable, categorical vs numeric analysis, keyword frequency,
  success probability / expected value. Reused in the UI copy where it is accurate.
* **Design inspiration**: lotus / ancient-Egyptian "knowledge system" identity. Reinterpreted as a restrained
  design language (see `docs/architecture.md` → Design system).

## 3. Problems found

### Architecture
* Four unrelated tools bolted onto a marketing site; no shared data model, no notion of project/dataset.
* Business logic inside Django views (`views.py` 946 lines; `perform_analysis` is even **defined twice**, once
  nested in a view, once in `analysis_tool.py`).
* A second, undeployed FastAPI service (`paper_ai_server.py`) loads `mt5-base` at import time and is called
  from a view at a hard-coded `http://localhost:800/process-text` (typo'd port, error text says 8000).
* Analytical text was produced by f-string templates mixed into the computation functions (also duplicated per
  language), so numbers, prose and rendering could not be tested independently.
* Many commented-out URL routes and half-finished views (`chat_with_ai`, `download_report`, …).

### Statistical / data-science correctness
* `perform_analysis` calls `scipy.stats.pearsonr` with no NaN handling, no minimum-n check and no
  constant-input check; on failure NaN is silently replaced with `r = 0, p = 1` ("no relationship") — a
  **wrong, confident answer** instead of an error.
* Strength labels hard-coded (`|r| ≥ 0.7 strong`) with no CI, no effect-size context, no sample size.
* Categorical analysis reports only the highest/lowest group *mean* — no test, no variance, no minimum group size —
  and so invites over-interpretation of noise.
* Monte-Carlo uses the global `np.random` with no seed → non-reproducible results; `parse_params` retries JSON
  after blind quote replacement.
* Perplexity chat used a deprecated model id (`pplx-7b-online`) and temperature 0.7 over free-form context;
  nothing prevented the model from asserting numbers.

### Security
* `SECRET_KEY` hard-coded and committed; `DEBUG = True`; `ALLOWED_HOSTS = []`.
* An API key was committed and then removed in a follow-up commit (`Remove API key`) — it remains in git history
  and must be treated as compromised.
* `@csrf_exempt` on the analysis APIs; analysis endpoints unauthenticated (only some views `@login_required`).
* Uploaded files stored under the web-served `media/`/`quant_uploads/` trees with user-controlled names; ~128 MB of
  uploads, `db.sqlite3` and `__pycache__` committed to git.
* Upload validation by filename only; no size limit; PDF/Excel parsed in-process with no limits.
* Error messages returned raw exception text and upstream API response bodies to the browser.

### Code quality / performance / operations
* No tests (`tests.py` files are empty stubs), no CI, no Docker, no migrations story beyond Django defaults,
  SQLite only, no background processing (long NLP/AI work in the request cycle), no caching.
* `matplotlib` PNGs rendered synchronously per request, with `arabic_reshaper`/`bidi` hacks in the plotting path.
* Whole files read into pandas in the request thread; no streaming, no pagination.
* Marketing-site content (pricing, careers, newsroom) occupied far more code than analysis.

## 4. Decisions

| Concept | Decision |
|---|---|
| Django monolith + templates | **Discard.** Replaced by FastAPI + React SPA |
| Marketing pages | **Discard** (not a product feature) |
| Per-tool silos | **Redesign** into one project → dataset → analysis → insight → report workflow |
| `r=0,p=1` on NaN | **Discard**; typed analysis errors (`INSUFFICIENT_OBSERVATIONS`, `ZERO_VARIANCE`, …) |
| Pearson + categorical means | **Preserve concept**, rebuild with assumptions, effect sizes, CI, tests |
| Keyword/synonym frequency | **Preserve** as codebook-driven deductive coding |
| mt5 summariser microservice | **Discard** (heavy, undeployable, truncating). Replaced by a pluggable LLM provider interface with a deterministic, evidence-only fallback |
| Perplexity chat | **Discard**; provider-agnostic (OpenAI-compatible / Anthropic / local) with evidence grounding and numeric validation |
| Monte-Carlo decision tool | **Defer** (documented extension point) |
| ReportLab PDF with Arabic reshaping | **Redesign**: self-contained HTML report (print to PDF) + Markdown + JSON; server-side SVG charts |
| Committed uploads / sqlite / key | **Discard**; uploads in a private storage volume, `.env` based config, the leaked key must be rotated |
