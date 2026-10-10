from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Not authenticated or token expired."},
    403: {
        "model": ErrorResponse,
        "description": "Authenticated but not allowed (insufficient project role).",
    },
    404: {"model": ErrorResponse, "description": "Not found — or not visible to the caller."},
    422: {"model": ErrorResponse, "description": "Validation error or invalid analysis configuration."},
}

UUID = uuid.UUID
DT = datetime
