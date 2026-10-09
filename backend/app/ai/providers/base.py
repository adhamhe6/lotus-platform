from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class ProviderError(Exception):
    """Any failure talking to a model provider (network, auth, rate limit, malformed reply)."""


@dataclass
class Completion:
    text: str
    model: str
    provider: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(Protocol):
    name: str
    model: str

    async def complete(
        self, system: str, user: str, *, max_tokens: int = 900, json_mode: bool = True
    ) -> Completion: ...
