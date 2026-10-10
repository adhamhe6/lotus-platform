# AI architecture

**Principle:** Lotus computes; the model words. A language model never produces a statistic, and the system works fully without one.

```
 question ─▶ Router ─▶ Analysis engine / stored results ─▶ Evidence pack (E1…En) ─▶ Narrator ─▶ Validator ─▶ Message
 (rules)      picks WHICH   computes or reuses a stored     every fact has a source   LLM (if configured)   numbers must    typed blocks +
              computation   AnalysisRun (idempotent)        id + deterministic text   or rule-based          match evidence   provenance
```

## Components (`backend/app/ai`)

* **Router** (`router.py`) — rule-based intent classification (overview, relationship, comparison, trend, distribution, themes, mixed, next steps) and fuzzy column resolution against the dataset schema (`customers` does not resolve to `customer_id`). Numeric questions always go to the analysis engine, categorical ones to counts/group comparison, text ones to theme/code evidence, "why" questions with themes to the mixed-methods engine. Unanswerable questions yield an explicit **notice** that lists the available variables — no LLM call, no guess.
* **Evidence packs** (`evidence.py`) — the only thing a provider ever sees: short, deterministic statements built from stored results (metrics, top table rows, significant coefficients, theme counts + a representative quote, mixed findings), capped at `AI_MAX_CONTEXT_CHARS`. Caveat items (violated assumptions, warnings, data-quality notes) travel with them. Raw datasets are never sent.
* **Providers** (`providers/`) — `openai_compatible` (OpenAI, Ollama, vLLM, LM Studio, OpenRouter…), `anthropic`, or none (`deterministic`). Configured by environment variables; keys are `SecretStr`, never logged or returned (`GET /ai/status` reports only whether one is set and whether data would leave the server).
* **Narrator** (`narrator.py`) — builds the versioned prompt (`prompts.py`, `PROMPT_VERSION`), requires one JSON object `{summary, points[{text, evidence[]}], caveats, next_steps}`, then **validates**. If the provider is down, returns garbage or fails validation, Lotus falls back to the rule-based narration and records `fallback_reason`.
* **Validator** (`validate.py`) — hallucination guard. Every number in the prose must appear in the cited evidence (rounding-aware; differences of two numbers from one item and ×/÷100 are allowed; integers ≤ 3 are free as list markers). Points without a valid `E#` citation are dropped. Failing summaries are rejected wholesale.
* **Message provenance** — each assistant message stores typed `blocks` (`computed`, `qualitative`, `mixed`, `interpretation`, `notice`), the `evidence` list, and `meta` (`origin: llm|rule|none`, provider, model, prompt version, validation status, latency, intent, analysis run ids). The UI shows **Computed / Qualitative / AI interpretation / Rule-based** badges accordingly. Stored interpretations of analyses, insights, themes and mixed runs live in separate fields from the computed content they explain.

## Tested guarantees (`tests/unit/test_ai_pipeline.py`, `tests/e2e/test_workflows.py`)

The provider receives the *actual* computed numbers; an answer that invents a number is replaced by the rule-based text; a provider outage degrades gracefully; "quantum entanglement" questions get an honest notice; assistant answers reference real stored analyses; conversations are private even inside a shared project; secrets never appear in `/ai/status`.

## Embeddings and qualitative NLP (`backend/app/qualitative`)

* `EmbeddingProvider` interface. **Default `tfidf-lsa`**: TF-IDF (1–2-grams, bilingual EN/AR stop-words, Arabic normalisation) → truncated SVD (≤ 40 dims, seeded) → L2. It is deterministic, offline and fitted per text column; the fitted model is persisted (`storage/models/*.joblib`) so search queries are embedded into the same space. **Optional `sentence-transformers`** (`pip install .[nlp]`, `EMBEDDING_PROVIDER=sentence-transformers`) gives true semantic similarity across paraphrases.
* Vectors are stored in pgvector beside the producing model id; cosine search is a SQL `ORDER BY embedding <=> $q` scoped to one text column.
* **Theme detection**: k-means (seeded), `k` chosen as the smallest value whose silhouette is within 15% of the best (silhouette alone rewards ever-finer splits), labels from class-based TF-IDF (terms frequent inside the cluster and rare outside), representative quotes nearest the centroid. Counts are `COUNT(*)` over stored memberships. Themes are *suggestions*: rename, merge, move responses, delete.
* **Honest limitation:** lexical LSA clusters by shared vocabulary. On heavily paraphrased text it recovers topics only partially (measured NMI ≈ 0.3 on the demo comments, see `docs/performance.md`); use the transformer provider or the **codebook** (keyword + accepted annotations, multi-label) when precision matters. The mixed-methods engine accepts either source.
* Sentence-level segmentation is applied automatically to multi-sentence responses; fillers are merged into neighbours, so no text is dropped.

## Cost / resource control

No LLM call happens for numeric work; one narration call per user action, with a bounded evidence pack; analyses are idempotent and cached, so repeated questions reuse stored runs; embeddings are computed once per column; per-user AI rate limiting (`AI_RATE_LIMIT_PER_MINUTE`); everything long runs in the worker.
