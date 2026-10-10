from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.mixed.engine import Item, run_mixed


def make(n=400, seed=1):
    rng = np.random.default_rng(seed)
    delivery_issue = rng.random(n) < 0.3
    region = rng.choice(["East", "West"], n, p=[0.5, 0.5])
    delivery_issue = np.where(region == "West", rng.random(n) < 0.5, rng.random(n) < 0.1)
    delivery_time = 3 + 3 * delivery_issue + rng.normal(0, 1, n)
    sat = 80 - 12 * delivery_issue + rng.normal(0, 8, n)
    noise_theme = rng.random(n) < 0.3  # unrelated to anything
    frame = pd.DataFrame(
        {"sat": sat, "delivery_time": delivery_time, "region": region, "age": rng.normal(40, 10, n)}
    )
    return frame, delivery_issue, noise_theme


def test_recovers_known_association_and_ignores_noise():
    frame, deliv, noise = make()
    items = [
        Item("t1", "Delivery delays", "theme", set(np.where(deliv)[0].tolist()), ["late parcel"]),
        Item("t2", "Random chatter", "theme", set(np.where(noise)[0].tolist())),
    ]
    res = run_mixed(frame, set(range(len(frame))), items, "sat", ["delivery_time", "age"], "region")
    top = res["items"][0]
    assert top["name"] == "Delivery delays"
    o = top["outcome"]
    assert o["mean_with"] == pytest.approx(frame.loc[deliv, "sat"].mean()) and o[
        "mean_without"
    ] == pytest.approx(frame.loc[~deliv, "sat"].mean())
    assert o["diff"] < -9 and o["significant"] and o["p_adj"] < 0.001 and o["test"] == "Welch t-test"
    kinds = {(f["kind"], f.get("item"), f.get("column")) for f in res["findings"]}
    assert ("outcome_difference", "Delivery delays", None) in kinds
    assert (
        "convergence",
        "Delivery delays",
        "delivery_time",
    ) in kinds  # qualitative theme converges with the measured variable
    assert ("group_prevalence", "Delivery delays", "region") in kinds
    assert not any(f["item"] == "Random chatter" for f in res["findings"] if f["kind"] != "group_prevalence")
    assert not any(c["significant"] for c in top["comparisons"] if c["column"] == "age")
    stmt = next(f for f in res["findings"] if f["kind"] == "outcome_difference")["statement"]
    assert "not evidence of cause" in stmt and "Holm-adjusted" in stmt
    assert res["overall"]["respondents"] == 400 and res["overall"]["tests_run"] == 2 * 3 + 2


def test_small_groups_and_missing_outcome_are_reported_not_tested():
    frame, deliv, _ = make(60)
    frame.loc[:9, "sat"] = np.nan
    tiny = Item("t", "Tiny", "theme", {1, 2, 3})
    res = run_mixed(frame, set(range(60)), [tiny], "sat", [], None)
    assert res["items"][0]["outcome"]["status"] == "insufficient_n" and res["findings"] == []
    assert any("no value for 'sat'" in w for w in res["warnings"]) and any(
        "Too few respondents" in w for w in res["warnings"]
    )
    with pytest.raises(ValueError):
        run_mixed(frame, {1, 2, 3}, [tiny], "sat", [], None)


def test_respondent_universe_excludes_non_commenters():
    frame, deliv, _ = make(200)
    commenters = set(range(0, 200, 2))
    item = Item("t", "Delivery", "theme", {i for i in commenters if deliv[i]})
    res = run_mixed(frame, commenters, [item], "sat", [])
    o = res["items"][0]["outcome"]
    assert o["n_with"] + o["n_without"] == len(commenters)
