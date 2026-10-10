from __future__ import annotations

import httpx
import numpy as np
import pandas as pd
import pytest

from app.ai.providers import anthropic, base, openai_compat
from app.analysis import registry
from app.reports import svg
from app.visualization import builder


@pytest.fixture(scope="module")
def df():
    rng = np.random.default_rng(3)
    n = 200
    x = rng.normal(size=n)
    return pd.DataFrame(
        {
            "x": x,
            "y": 2 * x + rng.normal(size=n),
            "z": rng.gamma(2, 1, n),
            "g": rng.choice(["a", "b<script>", "c"], n),
            "h": rng.choice(["u", "v"], n),
            "bin": (rng.random(n) < 1 / (1 + np.exp(-x))).astype(int),
            "d": pd.date_range("2024-01-01", periods=n, freq="D"),
        }
    )


def test_every_chart_kind_renders_valid_escaped_svg(df):
    specs = []
    for t, cfg in [
        ("correlation", {"variables": ["x", "y", "z"]}),
        ("correlation", {"variables": ["x", "y"]}),
        ("group_comparison", {"outcome": "y", "group": "g"}),
        ("crosstab", {"row": "g", "column": "h"}),
        ("linear_regression", {"outcome": "y", "predictors": ["x", "z", "g"]}),
        ("logistic_regression", {"outcome": "bin", "predictors": ["x", "z"]}),
        ("time_series", {"date_column": "d", "value_column": "y", "frequency": "W"}),
        ("frequency", {"column": "g"}),
        ("descriptive", {"columns": ["x"]}),
    ]:
        res, _ = registry.execute(df, t, cfg)
        specs += res["charts"]
    specs.append(builder.build(df, builder.ChartRequest(kind="donut", x="h")).model_dump())
    kinds = {s["kind"] for s in specs}
    assert {
        "heatmap",
        "scatter",
        "box",
        "bar",
        "stacked_bar",
        "coef",
        "roc",
        "line",
        "histogram",
        "hbar",
        "donut",
    } & kinds >= {
        "heatmap",
        "scatter",
        "box",
        "bar",
        "stacked_bar",
        "coef",
        "roc",
        "line",
        "histogram",
        "donut",
    }
    for s in specs:
        out = svg.render(s)
        assert out.startswith("<svg") and out.endswith("</svg>") and "<title>" in out, s["kind"]
        assert "<script" not in out  # category 'b<script>' must be escaped everywhere
        import xml.dom.minidom as md

        md.parseString(out)  # well-formed XML


def test_svg_empty_inputs_do_not_crash():
    assert svg.render({"kind": "histogram", "title": "t", "data": {"edges": [], "counts": []}}) == ""
    assert svg.render({"kind": "nope", "title": "t", "data": {}}) == ""
    assert "could not be rendered" in svg.render({"kind": "bar", "title": "broken", "data": {}})


REAL_CLIENT = httpx.AsyncClient


def _mock(handler):
    transport = httpx.MockTransport(handler)
    return lambda **kw: REAL_CLIENT(
        transport=transport, **{k: v for k, v in kw.items() if k != "transport"}
    ), REAL_CLIENT


async def test_openai_compatible_provider(monkeypatch):
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"], seen["body"] = req.headers.get("authorization"), req.content
        return httpx.Response(
            200,
            json={
                "model": "m-1",
                "choices": [{"message": {"content": '{"summary":"ok"}'}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 7},
            },
        )

    factory, _ = _mock(handler)
    monkeypatch.setattr(openai_compat.httpx, "AsyncClient", factory)
    p = openai_compat.OpenAICompatibleProvider("http://llm.local/v1/", "sk-test", "m", 5)
    c = await p.complete("sys", "user")
    assert (
        c.text == '{"summary":"ok"}'
        and c.model == "m-1"
        and c.input_tokens == 5
        and seen["auth"] == "Bearer sk-test"
        and b"json_object" in seen["body"]
    )
    for resp, msg in [
        (httpx.Response(500), "HTTP 500"),
        (httpx.Response(200, json={"nope": 1}), "malformed"),
    ]:
        factory, _ = _mock(lambda req, r=resp: r)
        monkeypatch.setattr(openai_compat.httpx, "AsyncClient", factory)
        with pytest.raises(base.ProviderError, match=msg):
            await p.complete("s", "u")

    def boom(req):
        raise httpx.ConnectError("down")

    factory, _ = _mock(boom)
    monkeypatch.setattr(openai_compat.httpx, "AsyncClient", factory)
    with pytest.raises(base.ProviderError, match="unreachable"):
        await p.complete("s", "u")


async def test_anthropic_provider(monkeypatch):
    def handler(req: httpx.Request):
        assert req.headers["x-api-key"] == "k" and req.headers["anthropic-version"]
        return httpx.Response(
            200,
            json={
                "model": "claude-x",
                "content": [{"type": "text", "text": "hello"}],
                "usage": {"input_tokens": 1, "output_tokens": 2},
            },
        )

    factory, _ = _mock(handler)
    monkeypatch.setattr(anthropic.httpx, "AsyncClient", factory)
    c = await anthropic.AnthropicProvider("k", "claude-x", 5).complete("s", "u")
    assert c.text == "hello" and c.provider == "anthropic" and c.output_tokens == 2
    with pytest.raises(base.ProviderError, match="no API key"):
        await anthropic.AnthropicProvider(None, "m", 5).complete("s", "u")
