from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import ORM

Role = Literal["OWNER", "EDITOR", "VIEWER"]


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128, description="At least 10 characters.")
    full_name: str = Field(min_length=1, max_length=200)

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        if v.lower() == v or v.upper() == v or not any(c.isdigit() for c in v):
            raise ValueError("Password must mix upper- and lower-case letters and include a digit.")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORM):
    id: uuid.UUID
    email: str
    full_name: str
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    objective: str = Field(default="", max_length=4000, description="Research objective; used in reports.")


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    objective: str | None = Field(default=None, max_length=4000)


class ProjectOut(ORM):
    id: uuid.UUID
    name: str
    description: str
    objective: str
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    role: Role | None = None
    counts: dict[str, int] = Field(default_factory=dict)


class MemberIn(BaseModel):
    email: EmailStr
    role: Literal["EDITOR", "VIEWER"]


class MemberUpdate(BaseModel):
    role: Literal["EDITOR", "VIEWER"]


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    role: Role


class JobOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    type: str
    status: str
    stage: str | None
    progress: float
    total_stages: int
    completed_stages: int
    params: dict[str, Any]
    result_ref: dict[str, Any] | None
    error: dict[str, Any] | None
    attempts: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class NotificationOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    kind: str
    title: str
    body: str
    link: dict[str, Any] | None
    read_at: datetime | None
    created_at: datetime
