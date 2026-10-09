from __future__ import annotations

from app.ai.providers.anthropic import AnthropicProvider
from app.ai.providers.base import Completion, LLMProvider, ProviderError
from app.ai.providers.openai_compat import OpenAICompatibleProvider
from app.core.config import get_settings


def get_provider() -> LLMProvider | None:
    """None means 'deterministic mode' — Lotus then narrates evidence with rule-based templates only. No data leaves the server."""
    s = get_settings()
    key = s.ai_api_key.get_secret_value() if s.ai_api_key else None
    if s.ai_provider == "openai_compatible":
        return OpenAICompatibleProvider(s.ai_base_url, key, s.ai_model, s.ai_timeout_seconds)
    if s.ai_provider == "anthropic":
        return AnthropicProvider(key, s.ai_model, s.ai_timeout_seconds)
    return None


__all__ = ["Completion", "LLMProvider", "ProviderError", "get_provider"]
