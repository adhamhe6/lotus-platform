from __future__ import annotations

import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from app.cache.redis import close_redis, get_redis
from app.core.config import get_settings
from app.db.database import dispose_engine, get_engine

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrate_database(request) -> None:
    """Build the schema from the real Alembic migrations (so the migration itself is under test). Skipped for DB-free unit runs."""
    import asyncio

    if not any(i.get_closest_marker("integration") for i in request.session.items):
        return

    from sqlalchemy.ext.asyncio import create_async_engine

    async def reset() -> None:
        eng = create_async_engine(get_settings().database_url)
        async with eng.begin() as c:
            await c.execute(text("DROP SCHEMA public CASCADE"))
            await c.execute(text("CREATE SCHEMA public"))
        await eng.dispose()

    asyncio.run(reset())
    r = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, capture_output=True, text=True
    )
    assert r.returncode == 0, r.stderr


@pytest_asyncio.fixture(autouse=True)
async def clean_state(request) -> AsyncIterator[None]:
    if request.node.get_closest_marker("integration") is None:
        yield
        return
    eng = get_engine()
    async with eng.begin() as c:
        names = (
            (
                await c.execute(
                    text(
                        "select tablename from pg_tables where schemaname='public' and tablename <> 'alembic_version'"
                    )
                )
            )
            .scalars()
            .all()
        )
        await c.execute(text("TRUNCATE " + ", ".join(f'"{n}"' for n in names) + " RESTART IDENTITY CASCADE"))
    try:
        await get_redis().flushdb()
    except Exception:
        pass
    yield


@pytest_asyncio.fixture(scope="session", autouse=True)
async def teardown_engine() -> AsyncIterator[None]:
    yield
    await close_redis()
    await dispose_engine()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    from app.main import create_app

    app = create_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as c:
        yield c


class Api:
    """Tiny helper around the test client: registers users and sends authenticated requests."""

    def __init__(self, client: httpx.AsyncClient, token: str, user: dict):
        self.client, self.token, self.user = client, token, user

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def req(self, method: str, url: str, **kw) -> httpx.Response:
        return await self.client.request(
            method, "/api/v1" + url, headers={**self.headers, **kw.pop("headers", {})}, **kw
        )

    async def get(self, url: str, **kw):
        return await self.req("GET", url, **kw)

    async def post(self, url: str, **kw):
        return await self.req("POST", url, **kw)

    async def patch(self, url: str, **kw):
        return await self.req("PATCH", url, **kw)

    async def put(self, url: str, **kw):
        return await self.req("PUT", url, **kw)

    async def delete(self, url: str, **kw):
        return await self.req("DELETE", url, **kw)


async def make_user(client: httpx.AsyncClient, email: str | None = None, name: str = "Test User") -> Api:
    email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "Str0ngPassw0rd!", "full_name": name}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return Api(client, body["access_token"], body["user"])


@pytest_asyncio.fixture
async def alice(client) -> Api:
    return await make_user(client, "alice@example.com", "Alice Researcher")


@pytest_asyncio.fixture
async def bob(client) -> Api:
    return await make_user(client, "bob@example.com", "Bob Analyst")
