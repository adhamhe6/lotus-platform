"""Password hashing (Argon2id), JWT access tokens and opaque refresh tokens."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings
from app.core.exceptions import AuthenticationError

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    return _hasher.check_needs_rehash(hashed)


def create_access_token(user_id: uuid.UUID) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=s.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": now,
        "exp": exp,
        "typ": "access",
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(
        payload, s.secret_key.get_secret_value(), algorithm=ALGORITHM
    ), s.access_token_expire_minutes * 60


def decode_access_token(token: str) -> uuid.UUID:
    s = get_settings()
    try:
        data = jwt.decode(
            token,
            s.secret_key.get_secret_value(),
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        if data.get("typ") != "access":
            raise AuthenticationError("Invalid token type.", code="INVALID_TOKEN")
        return uuid.UUID(data["sub"])
    except jwt.ExpiredSignatureError as e:
        raise AuthenticationError(
            "Your session has expired. Please sign in again.", code="TOKEN_EXPIRED"
        ) from e
    except (jwt.PyJWTError, ValueError) as e:
        raise AuthenticationError("Invalid authentication credentials.", code="INVALID_TOKEN") from e


def new_refresh_token() -> tuple[str, str]:
    """Return (raw token for the cookie, sha256 hash for the database)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
