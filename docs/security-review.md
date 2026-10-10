# Security & privacy review

Scope: the whole repository as built. Method: threat-model walk-through (private research data, file upload, multi-user projects, AI egress) plus tests for each control. "Tested" items are covered by automated tests named below.

| Area | Control | Status |
|---|---|---|
| **Passwords** | Argon2id (`argon2-cffi`), transparent rehash; policy ≥ 10 chars with mixed case + digit; constant-time-ish login (dummy hash for unknown e-mails) | tested (`test_register_login_me_and_password_is_hashed`, bad-credentials test) |
| **Sessions** | 30-min JWT access token (HS256, `typ`, `exp`, `sub`, `jti`), held **in memory** by the SPA; 14-day **opaque** refresh token in an `httpOnly`, `SameSite=Lax`, path-scoped cookie, **single use, rotated**, stored only as SHA-256; re-use of a rotated token revokes all of the user's sessions; logout revokes | tested (`test_refresh_rotation_reuse_detection_and_logout`) |
| **CSRF** | Access token is a bearer header (not ambient). Cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) are POST-only, SameSite=Lax and reject a foreign `Origin` | tested (`test_cookie_endpoints_refuse_foreign_origins`) |
| **Authorization** | Every resource is reached through its project membership (`services/access.py`); non-members receive 404 (no existence leak), insufficient role 403; OWNER-only deletion/sharing; owner cannot be removed. Cross-project references (an analysis on another project's dataset version, a report section pointing at another project's run) are rejected | tested in `test_auth_and_projects.py`, `test_datasets.py`, `test_analyses.py`, `test_qualitative.py`, `test_workflow_5_report` |
| **AI conversations** | Private to their author even inside a shared project | tested (`test_conversations_are_private_…`) |
| **File upload** | Streamed to a temp file with a hard size cap; extension **and** magic bytes checked; MIME type ignored; binary/PDF/ELF/PE content in a `.csv` refused; `.xlsx` must be a ZIP with `xl/workbook.xml`, macro workbooks refused, zip-bomb size check, `defusedxml` guards XML entity expansion; max rows/columns; display names stripped of path/control characters; on-disk names are random UUIDs; raw bytes SHA-256-verified before processing | tested (`test_rejected_uploads`, oversized, traversal-name tests) |
| **Path traversal / file exposure** | Storage paths are generated, resolved and checked to stay under the root; nothing under storage is served statically; there is no download-by-path endpoint | tested (`test_uploaded_files_are_not_web_accessible…`) |
| **Injection** | SQLAlchemy bound parameters throughout; user text in `ILIKE` is escaped; report/SVG HTML output is escaped and served with a restrictive CSP; the SPA renders the report in a sandboxed iframe and never uses `dangerouslySetInnerHTML` | tested (`test_hostile_dataset_values_cannot_inject_into_reports`) |
| **Error handling** | One envelope; no stack traces, SQL, paths or secrets; unexpected errors are logged server-side | tested (`test_unexpected_errors_never_leak_internals`) |
| **Rate limiting** | Redis fixed-window limits on auth (per client address) and AI (per user); the client address is the ASGI peer — `X-Forwarded-For` is honoured only via uvicorn's trusted-proxy handling, and the API port is not published by Compose, so it cannot be spoofed | tested (`test_rate_limiting…`, `test_rate_limit_ignores_spoofed_forwarded_for`) |
| **CORS / headers** | Explicit origin allow-list with credentials; `nosniff`, `no-referrer`, `no-store` from the API; nginx adds CSP (`default-src 'self'`), `X-Frame-Options: DENY`, `Permissions-Policy` | tested (`test_security_headers_and_cors`) |
| **Secrets** | Environment only; `SECRET_KEY` must be ≥ 32 chars; Compose refuses to start without `SECRET_KEY`/`POSTGRES_PASSWORD`; AI keys are `SecretStr`, never logged or returned; `.env` is git-ignored; secret scan of the tree and history is clean (the *legacy* repository's leaked key should be rotated — see `legacy-analysis.md`) | tested (`test_ai_status_never_exposes_secrets`) |
| **Logging** | JSON logs with request/job ids; values matching `password/token/secret/api_key/authorization/cookie` are redacted both in messages and in structured fields; query strings and bodies are not logged; datasets are never logged | tested (`test_log_redaction`) |
| **Privacy / AI egress** | Default AI mode is deterministic: nothing leaves the server. When an external provider is configured only bounded *evidence summaries* (computed statistics, counts, short quotes) are sent — never datasets — and `/ai/status` + Settings state this explicitly. Self-hosted models (Ollama/vLLM) are supported via the OpenAI-compatible provider and an optional Compose profile | by design + tested guarantees in `docs/ai-architecture.md` |
| **Prompt injection** | Respondent text reaches the model only inside evidence items; the system prompt marks evidence as data; outputs must be JSON, cite evidence ids and pass numeric validation, so the worst a hostile quote can do is skew wording, not invent statistics | partly tested (validator); residual risk documented |
| **Dependencies** | Pinned `requirements.lock`; `pip-audit` clean at build time and in CI; `npm audit --omit=dev` in CI; Docker images run as an unprivileged user | CI |
| **Denial of service** | Upload cap, row/column caps, bounded previews/page sizes, scatter down-sampling, per-user AI limits, job timeouts, analysis level/category caps. Not covered: per-user storage quotas | residual |

## Residual risks / hardening backlog

* Access tokens are not individually revocable before expiry (30 min). A revocation list in Redis would close this.
* Registration reveals whether an e-mail exists (`EMAIL_TAKEN`); acceptable for a research tool, disable with `ALLOW_REGISTRATION=false` for closed deployments.
* No at-rest encryption of the storage volume or database beyond what the host provides.
* No antivirus scanning of uploads (content is only ever parsed as CSV/XLSX by pandas/openpyxl).
* A malicious *project member* with EDITOR role can still upload large files up to the quota.
