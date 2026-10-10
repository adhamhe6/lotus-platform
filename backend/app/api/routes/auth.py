from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response, status

from app.api.deps import CurrentUser, Session, auth_rate_limit, refresh_rate_limit, same_origin_only
from app.core.config import get_settings
from app.core.exceptions import AuthenticationError
from app.schemas.common import ERRORS
from app.schemas.core import LoginIn, ProfileUpdate, RegisterIn, TokenOut, UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])
COOKIE = "lotus_refresh"


def _set_cookie(resp: Response, token: str) -> None:
    s = get_settings()
    resp.set_cookie(
        COOKIE,
        token,
        max_age=s.refresh_token_expire_days * 86400,
        httponly=True,
        secure=s.cookie_secure,
        samesite=s.cookie_samesite,
        path="/api/v1/auth",
    )


@router.post(
    "/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit)],
    summary="Create an account",
    responses={409: ERRORS[422]},
)
async def register(body: RegisterIn, request: Request, response: Response, session: Session) -> TokenOut:
    """Creates a user (Argon2id-hashed password) and signs them in. The refresh token is set as an httpOnly cookie."""
    user = await auth_service.register(session, body.email, body.password, body.full_name)
    access, ttl, raw = await auth_service.issue_tokens(session, user, request.headers.get("user-agent"))
    _set_cookie(response, raw)
    return TokenOut(access_token=access, expires_in=ttl, user=UserOut.model_validate(user))


@router.post(
    "/login",
    response_model=TokenOut,
    dependencies=[Depends(auth_rate_limit)],
    summary="Sign in",
    responses={401: ERRORS[401]},
)
async def login(body: LoginIn, request: Request, response: Response, session: Session) -> TokenOut:
    user = await auth_service.authenticate(session, body.email, body.password)
    access, ttl, raw = await auth_service.issue_tokens(session, user, request.headers.get("user-agent"))
    _set_cookie(response, raw)
    return TokenOut(access_token=access, expires_in=ttl, user=UserOut.model_validate(user))


@router.post(
    "/refresh",
    response_model=TokenOut,
    dependencies=[Depends(refresh_rate_limit), Depends(same_origin_only)],
    summary="Rotate the refresh token and get a new access token",
    responses={401: ERRORS[401]},
)
async def refresh(
    request: Request,
    response: Response,
    session: Session,
    lotus_refresh: Annotated[str | None, Cookie()] = None,
) -> TokenOut:
    if not lotus_refresh:
        raise AuthenticationError("No active session.", code="NO_REFRESH_TOKEN")
    try:
        user, access, ttl, raw = await auth_service.rotate_refresh(
            session, lotus_refresh, request.headers.get("user-agent")
        )
    except AuthenticationError:
        response.delete_cookie(COOKIE, path="/api/v1/auth")
        raise
    _set_cookie(response, raw)
    return TokenOut(access_token=access, expires_in=ttl, user=UserOut.model_validate(user))


@router.post(
    "/logout",
    dependencies=[Depends(same_origin_only)],
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke the current refresh token",
)
async def logout(
    response: Response, session: Session, lotus_refresh: Annotated[str | None, Cookie()] = None
) -> Response:
    await auth_service.revoke_refresh(session, lotus_refresh)
    response.delete_cookie(COOKIE, path="/api/v1/auth")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut, summary="Current user", responses={401: ERRORS[401]})
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut, summary="Update profile")
async def update_me(body: ProfileUpdate, user: CurrentUser, session: Session) -> UserOut:
    user.full_name = body.full_name.strip()
    await session.commit()
    return UserOut.model_validate(user)
