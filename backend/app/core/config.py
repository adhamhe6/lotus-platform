"""Application configuration — environment variables only, no secrets in code."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    log_json: bool = True

    database_url: str = "postgresql+asyncpg://lotus:lotus@localhost:5432/lotus"
    redis_url: str = "redis://localhost:6379/0"

    # --- security -------------------------------------------------------------------------
    secret_key: SecretStr = Field(..., description="JWT signing secret (>= 32 chars)")
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    allow_registration: bool = True
    rate_limit_enabled: bool = True
    auth_rate_limit_per_minute: int = 20
    ai_rate_limit_per_minute: int = 30

    # --- storage / ingestion --------------------------------------------------------------
    storage_dir: Path = Path("./storage")
    max_upload_mb: int = 50
    max_rows: int = 1_000_000
    max_columns: int = 500
    preview_max_page_size: int = 200

    # --- jobs -----------------------------------------------------------------------------
    job_backend: Literal["arq", "inline"] = "arq"
    job_max_tries: int = 3

    # --- AI -------------------------------------------------------------------------------
    ai_provider: Literal["deterministic", "openai_compatible", "anthropic"] = "deterministic"
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: SecretStr | None = None
    ai_model: str = "gpt-4o-mini"
    ai_timeout_seconds: float = 45.0
    ai_max_context_chars: int = 12_000
    embedding_provider: Literal["tfidf-lsa", "sentence-transformers"] = "tfidf-lsa"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

    # --- cache ----------------------------------------------------------------------------
    cache_enabled: bool = True
    cache_ttl_profile: int = 3600
    cache_ttl_dashboard: int = 60
    cache_ttl_result: int = 600

    # --- demo -----------------------------------------------------------------------------
    seed_demo_data: bool = False
    demo_user_email: str = "demo@lotus-demo.org"
    demo_user_password: SecretStr | None = None

    @field_validator("secret_key")
    @classmethod
    def _strong_secret(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
