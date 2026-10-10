from __future__ import annotations

import numpy as np
import pandas as pd

from app.analysis import insights, registry


def ins(df, t, **cfg):
    res, _ = registry.execute(df, t, cfg)
    return insights.extract("run-1", t, registry.parse_config(t, cfg).model_dump(mode="json"), res)


def test_real_effects_become_insights_with_evidence():
    rng = np.random.default_rng(0)
    n = 300
    x = rng.normal(size=n)
    df = pd.DataFrame(
        {"x": x, "y": -0.6 * x + rng.normal(scale=0.7, size=n), "g": rng.choice(["a", "b", "c"], n)}
    )
    df.loc[df.g == "c", "y"] -= 1.2
    c = ins(df, "correlation", variables=["x", "y"])
    assert (
        len(c) == 1
        and "negative" in c[0]["statement"]
        and "association, not proof of cause" in c[0]["statement"]
    )
    assert {e["metric"] for e in c[0]["evidence"]} >= {"r", "p_value", "n"}
    g = ins(df, "group_comparison", outcome="y", group="g")
    assert len(g) == 1 and "lowest for g = c" in g[0]["statement"]


def test_noise_and_small_samples_produce_no_insights():
    rng = np.random.default_rng(1)
    noise = pd.DataFrame(
        {"x": rng.normal(size=300), "y": rng.normal(size=300), "g": rng.choice(["a", "b"], 300)}
    )
    assert ins(noise, "correlation", variables=["x", "y"]) == []
    assert ins(noise, "group_comparison", outcome="y", group="g") == []
    small = pd.DataFrame({"x": np.arange(12.0), "y": np.arange(12.0) * 2 + rng.normal(size=12)})
    assert ins(small, "correlation", variables=["x", "y"]) == []  # strong, but n = 12 < 30
