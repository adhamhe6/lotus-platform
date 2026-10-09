from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError, ConflictError, PermissionDeniedError
from app.core.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    new_refresh_token,
    verify_password,
)
from app.db.models import RefreshToken, User

# a fixed valid hash so unknown e-mails cost the same time as wrong passwords (no user enumeration by timing)
_DUMMY_HASH = hash_password("lotus-dummy-password")


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def register(session: AsyncSession, email: str, password: str, full_name: str) -> User:
    if not get_settings().allow_registration:
        raise PermissionDeniedError("Registration is disabled on this server.", code="REGISTRATION_DISABLED")
    user = User(
        email=normalize_email(email), full_name=full_name.strip(), password_hash=hash_password(password)
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise ConflictError("An account with this e-mail already exists.", code="EMAIL_TAKEN") from e
    return user


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    user = (
        await session.execute(select(User).where(func.lower(User.email) == normalize_email(email)))
    ).scalar_one_or_none()
    ok = verify_password(password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok or not user.is_active:
        raise AuthenticationError("Incorrect e-mail or password.", code="INVALID_CREDENTIALS")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = datetime.now(UTC)
    await session.commit()
    return user


async def issue_tokens(
    session: AsyncSession, user: User, user_agent: str | None = None
) -> tuple[str, int, str]:
    access, ttl = create_access_token(user.id)
    raw, hashed = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hashed,
            user_agent=(user_agent or "")[:300] or None,
            expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_expire_days),
        )
    )
    await session.commit()
    return access, ttl, raw


async def rotate_refresh(
    session: AsyncSession, raw: str, user_agent: str | None = None
) -> tuple[User, str, int, str]:
    """Single-use refresh tokens. Presenting an already-used token revokes every session of that user (theft signal)."""
    row = (
        await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise AuthenticationError("Invalid refresh token.", code="INVALID_REFRESH")
    now = datetime.now(UTC)
    if row.revoked_at is not None:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await session.commit()
        raise AuthenticationError(
            "This session is no longer valid. Please sign in again.", code="REFRESH_REUSED"
        )
    if row.expires_at < now:
        raise AuthenticationError("Your session has expired. Please sign in again.", code="TOKEN_EXPIRED")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Account unavailable.", code="INVALID_REFRESH")
    row.revoked_at = now
    await session.flush()
    access, ttl, new_raw = await issue_tokens(session, user, user_agent)
    return user, access, ttl, new_raw


async def revoke_refresh(session: AsyncSession, raw: str | None) -> None:
    if not raw:
        return
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(raw), RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await session.commit()


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)
