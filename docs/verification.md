# Verification log

What was actually run for this repository, and the result. Anything not listed here was not verified.

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check app tests` | pass |
| Backend format | `ruff format --check app tests` | 119 files formatted |
| Backend types | `mypy app` | no issues in 97 files |
| Backend tests | `pytest -q` (PostgreSQL+pgvector, Redis) | 127 passed |
| Frontend types | `npm run typecheck` | pass |
| Frontend lint | `npm run lint` (oxlint) | pass |
| Frontend tests | `npm test` (Vitest) | 19 files, 240 tests passed |
| Frontend build | `npm run build` | success |
| API contract | `python -m app.scripts.export_openapi`, `npm run gen:api` | no diff against committed files |
| Docker stack | `docker compose build && docker compose up -d` | postgres, redis, api, worker, frontend all healthy |
| Browser tour | `BASE_URL=http://localhost:8080 node frontend/e2e/tour.mjs` | desktop, mobile and dark pages: no console errors, 5xx responses or horizontal overflow |
| Benchmark | `scripts/benchmark.py --rows 250000` | see `docs/performance.md` |

The Docker benchmark path was not used: `benchmark.py` assumes the inline job backend, and the compose
stack runs a real arq worker (the dataset stays `PROCESSING` when the script checks immediately).

## Not verified

- The sentence-transformers embedding path and real LLM providers (OpenAI-compatible, Anthropic):
  no network access to them from the sandbox. Only the deterministic provider and fake providers
  in tests were exercised.
- GitHub Actions results are tracked on the pull request, not here.
- No external penetration test; see `docs/security-review.md` for the self-review.
