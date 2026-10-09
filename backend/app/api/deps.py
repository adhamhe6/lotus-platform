from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis import rate_limit_hit
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, RateLimited
from app.core.security import decode_access_token
from app.datasets.storage import Storage
from app.db.database import get_session
from app.db.models import User

bearer = HTTPBearer(auto_error=False, description="Access token from `POST /api/v1/auth/login`.")

Session = Annotated[AsyncSession, Depends(get_session)]


async def current_user(session: Session, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> User:
    if creds is None:
        raise AuthenticationError("Authentication required.", code="NOT_AUTHENTICATED")
    user_id = decode_access_token(creds.credentials)
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Account unavailable.", code="INVALID_TOKEN")
    return user


CurrentUser = Annotated[User, Depends(current_user)]

_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None or _storage.root != get_settings().storage_dir.resolve():
        _storage = Storage(get_settings().storage_dir)
    return _storage


StorageDep = Annotated[Storage, Depends(get_storage)]


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))


async def auth_rate_limit(request: Request) -> None:
    if not await rate_limit_hit("auth", client_ip(request), get_settings().auth_rate_limit_per_minute):
        raise RateLimited("Too many attempts. Please wait a minute and try again.")


async def ai_rate_limit(request: Request, user: CurrentUser) -> None:
    if not await rate_limit_hit("ai", str(user.id), get_settings().ai_rate_limit_per_minute):
        raise RateLimited("You are sending AI requests too quickly. Please wait a moment.")
