#!/usr/bin/env bash
# Dev helper: rebuild the single initial migration from the models against an empty scratch database.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://postgres:postgres@localhost:5432/lotus}"
export SECRET_KEY="${SECRET_KEY:-regen-secret-regen-secret-regen-secret-1234}"
python - <<'PY'
import asyncio, os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
async def main():
    e = create_async_engine(os.environ["DATABASE_URL"])
    async with e.begin() as c:
        await c.execute(text("DROP SCHEMA public CASCADE")); await c.execute(text("CREATE SCHEMA public"))
    await e.dispose()
asyncio.run(main())
PY
rm -f alembic/versions/*.py
alembic revision --autogenerate -m "initial schema" --rev-id 0001
f=$(ls alembic/versions/*0001*.py)
python - "$f" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("def upgrade() -> None:\n", "def upgrade() -> None:\n    op.execute('CREATE EXTENSION IF NOT EXISTS vector')\n", 1)
open(p, "w").write(s)
PY
alembic upgrade head && alembic check
