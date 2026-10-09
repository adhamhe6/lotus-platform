from __future__ import annotations

import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-test-secret-key-0123456789")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("JOB_BACKEND", "inline")
os.environ.setdefault("LOG_JSON", "false")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/lotus_test"))
os.environ.setdefault("REDIS_URL", os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15"))
import tempfile

os.environ.setdefault("STORAGE_DIR", tempfile.mkdtemp(prefix="lotus-test-storage-"))
