from __future__ import annotations

import httpx

from app.ai.providers.base import Completion, ProviderError


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self, api_key: str | None, model: str, timeout: float, base_url: str = "https://api.anthropic.com"
    ):
        self.api_key, self.model, self.timeout, self.base_url = api_key, model, timeout, base_url.rstrip("/")

    async def complete(
        self, system: str, user: str, *, max_tokens: int = 900, json_mode: bool = True
    ) -> Completion:
        if not self.api_key:
            raise ProviderError("no API key configured")
        body = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as c:
                r = await c.post(
                    f"{self.base_url}/v1/messages",
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json=body,
                )
        except httpx.HTTPError as e:
            raise ProviderError(f"provider unreachable: {type(e).__name__}") from e
        if r.status_code >= 400:
            raise ProviderError(f"provider returned HTTP {r.status_code}")
        try:
            data = r.json()
            text = "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
        except (ValueError, KeyError, TypeError) as e:
            raise ProviderError("malformed provider response") from e
        u = data.get("usage") or {}
        return Completion(
            text=text,
            model=data.get("model", self.model),
            provider=self.name,
            input_tokens=u.get("input_tokens"),
            output_tokens=u.get("output_tokens"),
        )
