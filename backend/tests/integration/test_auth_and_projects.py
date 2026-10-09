from __future__ import annotations

import pytest

from tests.integration.conftest import make_user

pytestmark = pytest.mark.integration


async def test_register_login_me_and_password_is_hashed(client):
    r = await client.post("/api/v1/auth/register", json={"email": "Ann@Example.com", "password": "Str0ngPassw0rd!", "full_name": "Ann"})
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "ann@example.com"
    assert "lotus_refresh" in r.cookies
    dup = await client.post("/api/v1/auth/register", json={"email": "ann@example.com", "password": "Str0ngPassw0rd!", "full_name": "Ann"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "EMAIL_TAKEN"
    from sqlalchemy import text

    from app.db.database import get_engine

    async with get_engine().connect() as c:
        h = (await c.execute(text("select password_hash from users"))).scalar_one()
    assert h.startswith("$argon2id$") and "Str0ng" not in h
    login = await client.post("/api/v1/auth/login", json={"email": "ANN@example.com", "password": "Str0ngPassw0rd!"})
    assert login.status_code == 200
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"})
    assert me.status_code == 200 and me.json()["full_name"] == "Ann"


async def test_bad_credentials_weak_password_and_missing_token(client):
    await make_user(client, "x@example.com")
    bad = await client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "wrong-password"})
    assert bad.status_code == 401 and bad.json() == {"error": {"code": "INVALID_CREDENTIALS", "message": "Incorrect e-mail or password."}}
    unknown = await client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "whatever-123"})
    assert unknown.status_code == 401 and unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"
    weak = await client.post("/api/v1/auth/register", json={"email": "w@example.com", "password": "alllowercase1", "full_name": "W"})
    assert weak.status_code == 422 and weak.json()["error"]["code"] == "VALIDATION_ERROR"
    assert (await client.get("/api/v1/projects")).status_code == 401
    assert (await client.get("/api/v1/projects", headers={"Authorization": "Bearer garbage"})).json()["error"]["code"] == "INVALID_TOKEN"


async def test_refresh_rotation_reuse_detection_and_logout(client):
    r = await client.post("/api/v1/auth/register", json={"email": "r@example.com", "password": "Str0ngPassw0rd!", "full_name": "R"})
    old_cookie = r.cookies["lotus_refresh"]
    ok = await client.post("/api/v1/auth/refresh")
    assert ok.status_code == 200 and ok.cookies["lotus_refresh"] != old_cookie
    new_cookie = ok.cookies["lotus_refresh"]
    # replaying the already-used token is treated as theft: everything is revoked
    client.cookies.set("lotus_refresh", old_cookie, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401 and replay.json()["error"]["code"] == "REFRESH_REUSED"
    client.cookies.set("lotus_refresh", new_cookie, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401
    # logout revokes
    r2 = await client.post("/api/v1/auth/login", json={"email": "r@example.com", "password": "Str0ngPassw0rd!"})
    assert r2.status_code == 200
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401


async def test_project_ownership_isolation_and_roles(client, alice, bob):
    p = (await alice.post("/projects", json={"name": "Customer Satisfaction Study", "description": "d", "objective": "o"})).json()
    assert p["role"] == "OWNER"
    # bob cannot see, read or change it — 404, not 403 (no existence leak)
    assert (await bob.get("/projects")).json() == []
    assert (await bob.get(f"/projects/{p['id']}")).status_code == 404
    assert (await bob.patch(f"/projects/{p['id']}", json={"name": "hack"})).status_code == 404
    assert (await bob.delete(f"/projects/{p['id']}")).status_code == 404
    # share as viewer: read ok, write forbidden
    m = await alice.post(f"/projects/{p['id']}/members", json={"email": "bob@example.com", "role": "VIEWER"})
    assert m.status_code == 201
    assert (await bob.get(f"/projects/{p['id']}")).json()["role"] == "VIEWER"
    forbidden = await bob.patch(f"/projects/{p['id']}", json={"name": "nope"})
    assert forbidden.status_code == 403 and forbidden.json()["error"]["code"] == "INSUFFICIENT_ROLE"
    assert (await bob.post(f"/projects/{p['id']}/members", json={"email": "alice@example.com", "role": "EDITOR"})).status_code == 403
    await alice.patch(f"/projects/{p['id']}/members/{bob.user['id']}", json={"role": "EDITOR"})
    assert (await bob.patch(f"/projects/{p['id']}", json={"name": "Renamed by editor"})).status_code == 200
    assert (await bob.delete(f"/projects/{p['id']}")).status_code == 403  # only owner may delete
    assert (await alice.delete(f"/projects/{p['id']}/members/{alice.user['id']}")).status_code == 409  # owner is protected
    assert (await alice.delete(f"/projects/{p['id']}")).status_code == 204
    assert (await bob.get(f"/projects/{p['id']}")).status_code == 404


async def test_validation_errors_use_the_error_envelope(client, alice):
    r = await alice.post("/projects", json={"name": ""})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR" and r.json()["error"]["details"][0]["field"] == "name"
    r = await alice.get("/projects/not-a-uuid")
    assert r.status_code == 422
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404 and "error" in r.json()


async def test_health_endpoints(client):
    assert (await client.get("/api/v1/health")).json() == {"status": "ok"}
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 200 and r.json()["checks"]["database"] == "ok" and r.json()["checks"]["redis"] == "ok"
