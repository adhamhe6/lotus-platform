# Performance

All numbers below were measured on one shared cloud sandbox container (PostgreSQL 16, Redis, uvicorn
with the inline job backend, no tuning), through the real HTTP API with `scripts/benchmark.py`
(`--rows 250000`, a 28.9 MB synthetic CSV). They show the order of magnitude on small hardware, not a
capacity guarantee. Re-run the script on your own hardware before relying on them.

| Step | Time |
|---|---|
| upload + ingest (parse, type inference, profile, Parquet write) | 4991 ms |
| profile read, cold (from DB) / warm (Redis) | 11 ms / 8 ms |
| preview page 1 / page 4000 (Parquet row-group slice) | 24 ms / 20 ms |
| preview filtered + sorted (full column scan) | 67 ms |
| descriptive / correlation / group comparison | 557 / 430 / 575 ms |
| linear regression / time series | 1105 / 208 ms |
| repeat of an identical analysis (idempotent, no recompute) | 20 ms |
| scatter chart (250k rows down-sampled to 2000 points) | 239 ms |
| project overview, cold / warm (cached by project revision) | 28 ms / 6 ms |

## Design choices that produce these numbers

- Each immutable dataset version is stored as Parquet with row groups, so paging reads only the
  needed row group instead of the whole file.
- The profile is computed once at ingestion and stored in PostgreSQL; the Redis copy is only a cache
  (fail-open, 5 s circuit breaker).
- Analyses are keyed by `(dataset_version, type, config_hash)`; a repeated request returns the stored run.
- Dashboard caches are keyed by the project `revision`, which is bumped on every content change, so
  there is no explicit invalidation to get wrong.
- Scatter and similar charts are down-sampled server-side with a fixed seed (deterministic).
- Ingestion numeric coercion uses a fast path (`_to_numeric_fast`); `read_table` on the 250k-row file
  went from 3.76 s to 2.52 s in an earlier measurement.

## Known limits

- Whole-dataset analyses load the needed columns into memory; there is no out-of-core path. Very
  large files (millions of rows, GBs) are not covered by this benchmark.
- Segment similarity search is a scoped scan over a project's segment vectors (the `vector` column
  has no ANN index, to keep dimension and model replaceable). It is fine for thousands to tens of
  thousands of segments; add a per-model index if you pin one embedding dimension.
- Theme quality with the default lexical TF-IDF+LSA embedding is modest: on the demo comments the
  measured NMI against the generating topics was about 0.3. Sentence-transformer embeddings are
  supported by configuration but that path could not be exercised here (model download blocked in the
  sandbox), so it is untested.
