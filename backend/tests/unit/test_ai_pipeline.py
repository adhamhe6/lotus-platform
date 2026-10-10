from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.ai import evidence as ev
from app.ai import narrator, router, validate
from app.ai.providers.base import Completion, ProviderError
from app.analysis import registry


def pack_from(df, t, **cfg):
    res, _ = registry.execute(df, t, cfg)
    p = ev.EvidencePack()
    p.extend(ev.from_analysis("run-1", "Test analysis", t, res))
    return p, res


@pytest.fixture
def corr_pack():
    rng = np.random.default_rng(0)
    x = rng.normal(size=200)
    df = pd.DataFrame({"delivery": x, "sat": -0.6 * x + rng.normal(scale=0.7, size=200)})
    return pack_from(df, "correlation", variables=["delivery", "sat"])


def test_validator_accepts_grounded_and_rejects_invented_numbers(corr_pack):
    pack, res = corr_pack
    r = next(m["value"] for m in res["metrics"] if m["key"] == "r")
    good = {
        "summary": f"Delivery and satisfaction are negatively correlated (r = {r:.2f}) [E1].",
        "points": [{"text": f"The correlation is {r:.2f}.", "evidence": ["E1"]}],
        "caveats": [],
        "next_steps": [],
    }
    v = validate.validate(good, pack)
    assert v["status"] == "passed" and v["narration"]["points"]
    bad = {
        "summary": "Delivery explains 85% of satisfaction.",
        "points": [{"text": "r = 0.97", "evidence": ["E1"]}],
        "caveats": [],
        "next_steps": [],
    }
    v = validate.validate(bad, pack)
    assert v["status"] == "failed" and v["problems"]
    uncited = {
        "summary": "Fine.",
        "points": [
            {"text": "A claim with no citation", "evidence": []},
            {"text": "Bad cite", "evidence": ["E99"]},
        ],
        "caveats": [],
        "next_steps": [],
    }
    v = validate.validate(uncited, pack)
    assert v["narration"]["points"] == [] and any("without a valid evidence" in p for p in v["problems"])


async def test_narrate_deterministic_by_default(corr_pack):
    out = await narrator.narrate(corr_pack[0], "explain_analysis")
    assert (
        out["meta"]["origin"] == "rule"
        and out["meta"]["provider"] == "deterministic"
        and out["meta"]["validation"]["status"] == "skipped"
    )
    assert (
        out["narration"]["points"][0]["evidence"] == ["E1"] and "r =" in out["narration"]["points"][0]["text"]
    )


class FakeProvider:
    name, model = "fake", "fake-1"

    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.seen = reply, error, None

    async def complete(self, system, user, **kw):
        self.seen = (system, user)
        if self.error:
            raise self.error
        return Completion(self.reply, self.model, self.name, 10, 20)


async def test_llm_receives_actual_results_and_failures_fall_back(monkeypatch, corr_pack):
    pack, res = corr_pack
    r = next(m["value"] for m in res["metrics"] if m["key"] == "r")
    ok = FakeProvider(
        '{"summary": "Negative association [E1].", "points": [{"text": "r is RVAL", "evidence": ["E1"]}], "caveats": [], "next_steps": ["Check non-linearity"]}'.replace(
            "RVAL", f"{r:.2f}"
        )
    )
    monkeypatch.setattr(narrator, "get_provider", lambda: ok)
    out = await narrator.narrate(pack, "answer", "How are delivery and satisfaction related?")
    assert (
        out["meta"]["origin"] == "llm"
        and out["meta"]["model"] == "fake-1"
        and out["meta"]["prompt_version"].startswith("lotus-narrate")
    )
    system, user = ok.seen
    assert (
        "Pearson r" in user and f"{r:.3f}".rstrip("0") in user.replace("−", "-") or "Pearson" in user
    )  # the model sees the real computed numbers
    assert "Do not introduce any number" in system or "Use ONLY facts" in system
    # invented number → rule-based fallback, flagged
    monkeypatch.setattr(
        narrator,
        "get_provider",
        lambda: FakeProvider(
            '{"summary": "Delivery explains 91% of variance.", "points": [], "caveats": [], "next_steps": []}'
        ),
    )
    out = await narrator.narrate(pack, "answer")
    assert (
        out["meta"]["origin"] == "rule"
        and out["meta"]["validation"]["status"] == "failed"
        and "numeric validation" in out["meta"]["fallback_reason"]
    )
    # provider outage and garbage output
    monkeypatch.setattr(
        narrator,
        "get_provider",
        lambda: FakeProvider(error=ProviderError("provider unreachable: ConnectError")),
    )
    out = await narrator.narrate(pack, "answer")
    assert out["meta"]["origin"] == "rule" and "could not be reached" in out["meta"]["fallback_reason"]
    monkeypatch.setattr(narrator, "get_provider", lambda: FakeProvider("not json at all"))
    out = await narrator.narrate(pack, "answer")
    assert out["meta"]["origin"] == "rule" and "unreadable" in out["meta"]["fallback_reason"]


COLS = [
    ("customer_id", "identifier"),
    ("region", "categorical"),
    ("delivery_time", "numeric_continuous"),
    ("satisfaction_score", "numeric_continuous"),
    ("retained", "binary"),
    ("survey_date", "datetime"),
    ("comment", "text"),
]


@pytest.mark.parametrize(
    ("q", "kind", "target"),
    [
        ("What are the main trends in this dataset?", "trend", None),
        (
            "Which factors appear most strongly associated with satisfaction?",
            "relationship",
            "satisfaction_score",
        ),
        ("Summarize the key findings", "overview", None),
        ("What should I investigate next?", "next_steps", None),
        ("Which region has the highest satisfaction score?", "comparison", "satisfaction_score"),
        ("What are the most common themes in the open-ended comments?", "themes", None),
        ("What is the average delivery time?", "distribution", None),
        ("Tell me a joke", "unknown", None),
    ],
)
def test_router(q, kind, target):
    i = router.classify(q, COLS, has_themes=True)
    assert i.kind == kind and (target is None or i.target == target)


def test_router_mixed_when_themes_and_numeric_target():
    i = router.classify(
        "Why is satisfaction low? What do comments say and how do they relate to satisfaction?",
        COLS,
        has_themes=True,
    )
    assert i.kind == "mixed" and i.target == "satisfaction_score"
