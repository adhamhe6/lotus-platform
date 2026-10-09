"""Numeric grounding: every number in AI prose must exist in the evidence it cites (within the precision it was written)."""

from __future__ import annotations

import re
from typing import Any

from app.ai.evidence import EvidenceItem, EvidencePack, numbers_in

_TOKEN = re.compile(r"(?<![\w.])[-−+]?\d+(?:\.\d+)?%?")
_CITE = re.compile(r"\[?\bE\d+\b\]?")


def _allowed_for(items: list[EvidenceItem]) -> set[float]:
    base: set[float] = set()
    for it in items:
        nums = numbers_in(it.text)
        base.update(nums)
        for i, a in enumerate(nums[:40]):
            for b in nums[i + 1 : 40]:
                base.add(abs(a - b))
    out = set(base)
    for a in base:
        out.update({abs(a), a / 100.0, a * 100.0})
    return out


def _matches(x: float, decimals: int, allowed: set[float]) -> bool:
    tol = 0.5 * 10 ** (-decimals) + 1e-9
    return any(abs(abs(x) - abs(a)) <= tol for a in allowed)


def check_text(text: str, items: list[EvidenceItem]) -> list[str]:
    """Return the list of ungrounded numbers found in ``text``."""
    allowed = _allowed_for(items)
    bad = []
    for tok in _TOKEN.findall(_CITE.sub(" ", text)):
        raw = tok.rstrip("%").replace("−", "-")
        try:
            x = float(raw)
        except ValueError:
            continue
        dec = len(raw.split(".")[1]) if "." in raw else 0
        if dec == 0 and abs(x) <= 3 and not tok.endswith("%"):
            continue  # list markers / "two or three" style counts
        if not _matches(x, dec, allowed):
            bad.append(tok)
    return bad


def validate(narration: dict[str, Any], pack: EvidencePack) -> dict[str, Any]:
    """Validate an LLM narration dict {summary, points, caveats, next_steps}. Returns {status, problems, narration (cleaned)}."""
    problems: list[str] = []
    ids = pack.ids()
    by_id = {i.id: i for i in pack.items}
    all_items = pack.items
    cleaned_points = []
    for p in narration.get("points", [])[:6]:
        cites = [c for c in p.get("evidence", []) if c in ids]
        if not cites:
            problems.append(f"point without a valid evidence citation dropped: {str(p.get('text'))[:60]!r}")
            continue
        bad = check_text(str(p.get("text", "")), [by_id[c] for c in cites])
        if bad:
            problems.append(f"ungrounded number(s) {bad} in a point citing {cites}")
            continue
        cleaned_points.append({"text": str(p["text"]), "evidence": cites})
    summary = str(narration.get("summary", ""))
    bad_summary = check_text(summary, all_items)
    if bad_summary:
        problems.append(f"ungrounded number(s) {bad_summary} in the summary")
    caveats = []
    for c in narration.get("caveats", [])[:4]:
        b = check_text(str(c), all_items)
        if b:
            problems.append(f"ungrounded number(s) {b} in a caveat")
        else:
            caveats.append(str(c))
    steps = []
    for s in narration.get("next_steps", [])[:3]:
        b = check_text(str(s), all_items)
        if b:
            problems.append(f"ungrounded number(s) {b} in a next step")
        else:
            steps.append(str(s))
    ok = not bad_summary and bool(summary) and (bool(cleaned_points) or not narration.get("points"))
    return {
        "status": "passed" if ok and not problems else ("passed_with_edits" if ok else "failed"),
        "problems": problems,
        "narration": {"summary": summary, "points": cleaned_points, "caveats": caveats, "next_steps": steps},
    }
