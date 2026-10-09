"""Domain errors and the consistent API error envelope.

Every non-2xx response has the shape ``{"error": {"code", "message", "details"?}}`` and never contains
stack traces, SQL, file-system paths or secrets.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("lotus.errors")


class LotusError(Exception):
    status_code = 400
    code = "BAD_REQUEST"

    def __init__(
        self, message: str, *, code: str | None = None, details: Any = None, status_code: int | None = None
    ):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details


class NotFoundError(LotusError):
    status_code = 404
    code = "NOT_FOUND"


class PermissionDeniedError(LotusError):
    status_code = 403
    code = "FORBIDDEN"


class AuthenticationError(LotusError):
    status_code = 401
    code = "UNAUTHENTICATED"


class ConflictError(LotusError):
    status_code = 409
    code = "CONFLICT"


class ValidationFailed(LotusError):
    status_code = 422
    code = "VALIDATION_ERROR"


class PayloadTooLarge(LotusError):
    status_code = 413
    code = "PAYLOAD_TOO_LARGE"


class UnsupportedFile(LotusError):
    status_code = 415
    code = "UNSUPPORTED_FILE"


class RateLimited(LotusError):
    status_code = 429
    code = "RATE_LIMITED"


class ServiceUnavailable(LotusError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"


class AnalysisConfigurationError(LotusError):
    """The requested analysis cannot be run with the selected variables/parameters."""

    status_code = 422
    code = "INVALID_ANALYSIS_CONFIGURATION"


class InsufficientDataError(AnalysisConfigurationError):
    code = "INSUFFICIENT_OBSERVATIONS"


class ZeroVarianceError(AnalysisConfigurationError):
    code = "ZERO_VARIANCE"


class DatasetProcessingError(LotusError):
    status_code = 422
    code = "DATASET_PROCESSING_FAILED"


class TransientError(Exception):
    """Infrastructure hiccup worth retrying (never used for user/data errors)."""


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    return {"error": err}


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(LotusError)
    async def _lotus(_: Request, exc: LotusError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {
                "field": ".".join(str(p) for p in e["loc"] if p not in ("body", "query", "path")),
                "message": e["msg"],
            }
            for e in exc.errors()
        ]
        return JSONResponse(_body("VALIDATION_ERROR", "The request is invalid.", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}
        return JSONResponse(
            _body(codes.get(exc.status_code, "HTTP_ERROR"), str(exc.detail)),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", extra={"path": request.url.path, "method": request.method})
        return JSONResponse(
            _body("INTERNAL_ERROR", "An unexpected error occurred. Please try again."), status_code=500
        )
