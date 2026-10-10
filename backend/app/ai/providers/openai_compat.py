"""OpenAI-compatible chat completions: OpenAI, Azure-style gateways, Ollama, vLLM, LM Studio, OpenRouter, Perplexity …"""

from __future__ import annotations

import httpx

from app.ai.providers.base import Completion, ProviderError


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, base_url: str, api_key: str | None, model: str, timeout: float):
        self.base_url, self.api_key, self.model, self.timeout = base_url.rstrip("/"), api_key, model, timeout

    async def complete(
        self, system: str, user: str, *, max_tokens: int = 900, json_mode: bool = True
    ) -> Completion:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body: dict = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as c:
                r = await c.post(f"{self.base_url}/chat/completions", headers=headers, json=body)
        except httpx.HTTPError as e:
            raise ProviderError(f"provider unreachable: {type(e).__name__}") from e
        if r.status_code >= 400:
            raise ProviderError(f"provider returned HTTP {r.status_code}")
        try:
            data = r.json()
            text = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise ProviderError("malformed provider response") from e
        usage = data.get("usage") or {}
        return Completion(
            text=text or "",
            model=data.get("model", self.model),
            provider=self.name,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )
