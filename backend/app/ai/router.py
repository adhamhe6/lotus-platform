"""Question router: decides WHICH computation answers a question. The model never decides the numbers."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.qualitative.text import STOPWORDS

NUMERIC = {"numeric_continuous", "numeric_discrete", "binary"}
CATEG = {"categorical", "boolean", "binary"}

KEYS = {
    "relationship": [
        "correlat",
        "associat",
        "relat",
        "factor",
        "driver",
        "affect",
        "influenc",
        "predict",
        "explain",
        "impact",
        "linked",
        "connection",
        "determin",
    ],
    "comparison": [
        "compare",
        "comparison",
        "differ",
        "highest",
        "lowest",
        "best",
        "worst",
        "which category",
        "which categories",
        "which region",
        "by region",
        "across",
        "rate",
        "breakdown",
        "per ",
    ],
    "trend": [
        "trend",
        "over time",
        "increase",
        "decrease",
        "decline",
        "grow",
        "month",
        "quarter",
        "weekly",
        "seasonal",
        "change over",
    ],
    "distribution": [
        "distribution",
        "describe",
        "average",
        "mean",
        "median",
        "spread",
        "typical",
        "range",
        "how many",
        "count",
        "frequency",
        "percent",
    ],
    "themes": [
        "theme",
        "open-ended",
        "open ended",
        "comment",
        "feedback",
        "complain",
        "said",
        "respon",
        "qualitative",
        "topic",
        "text",
        "verbatim",
    ],
    "overview": [
        "summar",
        "overview",
        "key finding",
        "main pattern",
        "tell me about",
        "what can i learn",
        "insight",
        "highlights",
        "main finding",
    ],
    "next_steps": [
        "next",
        "investigate",
        "should i",
        "suggest",
        "recommend",
        "explore",
        "what else",
        "where to start",
    ],
}


@dataclass
class Intent:
    kind: str
    columns: list[str] = field(default_factory=list)
    target: str | None = None
    wants_text: bool = False
    reason: str = ""


GENERIC = {
    "time",
    "score",
    "rate",
    "count",
    "total",
    "number",
    "value",
    "date",
    "level",
    "type",
    "data",
    "dataset",
    "overall",
    "main",
    "key",
    "average",
    "mean",
}


def _stems(s: str, *, drop_generic: bool = False) -> set[str]:
    toks = [
        t
        for t in re.split(r"[^a-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", s).lower())
        if len(t) > 2 and t not in STOPWORDS
    ]
    specific = [t for t in toks if t not in GENERIC]
    return {t[:6] for t in (specific if drop_generic and specific else toks)}


def resolve_columns(question: str, columns: list[tuple[str, str]]) -> list[tuple[str, float]]:
    q = question.lower()
    qs = _stems(question)
    scored = []
    for name, sem in columns:
        score = 0.0
        if name.lower() in q or name.lower().replace("_", " ") in q:
            score += 3
        cs = _stems(name, drop_generic=True)
        overlap = len(cs & qs)
        if (
            overlap and sem != "identifier"
        ):  # 'customers' must not resolve to customer_id; identifiers match only when named literally
            score += 1.0 + 0.5 * overlap / len(cs)
        if score > 0:
            scored.append((name, score))
    return sorted(scored, key=lambda x: -x[1])


def classify(question: str, columns: list[tuple[str, str]], *, has_themes: bool) -> Intent:
    q = question.lower()
    hits = {k: sum(1 for w in ws if w in q) for k, ws in KEYS.items()}
    resolved = resolve_columns(question, columns)
    types = dict(columns)
    cols = [c for c, s in resolved if s >= 1.0][:4]
    order = ["overview", "next_steps", "trend", "relationship", "comparison", "themes", "distribution"]
    num_cols = [c for c in cols if types.get(c) in NUMERIC]
    if (
        has_themes
        and hits["themes"] > 0
        and num_cols
        and (hits["relationship"] > 0 or "why" in q or "what drives" in q or "reason" in q)
    ):
        return Intent("mixed", columns=cols, target=num_cols[0], wants_text=True)
    best = max(order, key=lambda k: (hits[k], -order.index(k))) if any(hits.values()) else None
    if best is None:
        if cols:
            best = "distribution" if len(cols) == 1 else "relationship"
        else:
            return Intent("unknown", reason="no recognisable analytical intent or variable")
    if (
        best == "themes"
        and has_themes
        and hits["relationship"]
        and any(types.get(c) in NUMERIC for c in cols)
    ):
        return Intent(
            "mixed", columns=cols, target=next(c for c in cols if types.get(c) in NUMERIC), wants_text=True
        )
    if best == "themes":
        return Intent("themes", columns=cols, wants_text=True)
    if best in ("overview", "next_steps"):
        return Intent(best, columns=cols)
    if best == "trend":
        return Intent("trend", columns=cols, target=next((c for c in cols if types.get(c) in NUMERIC), None))
    if best == "relationship":
        tgt = next((c for c in cols if types.get(c) in NUMERIC), None)
        if tgt is None:
            return Intent(
                "unknown",
                columns=cols,
                reason="the question is about an association but no numeric target variable could be identified",
            )
        return Intent("relationship", columns=cols, target=tgt)
    if best == "comparison":
        cat = next(
            (c for c in cols if types.get(c) in CATEG | {"numeric_discrete"} and types.get(c) != "binary"),
            None,
        ) or next((c for c in cols if types.get(c) in CATEG), None)
        num = next((c for c in cols if types.get(c) in NUMERIC and c != cat), None)
        if cat is None and num is None:
            return Intent(
                "unknown", columns=cols, reason="no grouping or measure variable could be identified"
            )
        return Intent("comparison", columns=cols, target=num, reason=cat or "")
    return Intent("distribution", columns=cols)
