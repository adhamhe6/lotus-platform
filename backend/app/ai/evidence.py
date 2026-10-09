"""Evidence packs: the ONLY thing an AI provider ever sees. Every item is built from stored, computed results."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.core.config import get_settings


@dataclass
class EvidenceItem:
    kind: str  # computed | qualitative | mixed | dataset | caveat
    label: str
    text: str
    source: dict[str, Any] = field(default_factory=dict)
    id: str = ""

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "text": self.text,
            "source": self.source,
        }


@dataclass
class EvidencePack:
    items: list[EvidenceItem] = field(default_factory=list)
    dropped: int = 0

    def add(self, item: EvidenceItem) -> EvidenceItem:
        item.id = f"E{len(self.items) + 1}"
        self.items.append(item)
        return item

    def extend(self, items: list[EvidenceItem]) -> None:
        for i in items:
            self.add(i)

    def ids(self) -> set[str]:
        return {i.id for i in self.items}

    def render(self, max_chars: int | None = None) -> str:
        budget = max_chars or get_settings().ai_max_context_chars
        lines: list[str] = []
        used = 0
        for i in self.items:
            line = f"[{i.id}] ({i.kind}) {i.label}: {i.text}"
            if used + len(line) > budget:
                self.dropped = len(self.items) - len(lines)
                break
            lines.append(line)
            used += len(line)
        return "\n".join(lines)

    def usable(self) -> list[EvidenceItem]:
        return [i for i in self.items if i.kind != "caveat"]

    def caveats(self) -> list[EvidenceItem]:
        return [i for i in self.items if i.kind == "caveat"]


def fmt(v: Any) -> str:
    if v is None:
        return "n/a"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, int):
        return f"{v:,}".replace(",", "") if abs(v) < 10000 else f"{v:,}"
    if isinstance(v, float):
        if abs(v) != 0 and abs(v) < 0.001:
            return "< 0.001"
        return f"{v:.3f}".rstrip("0").rstrip(".") if abs(v) < 10 else f"{v:.1f}"
    return str(v)


def _pfmt(m: dict[str, Any]) -> str:
    v = m["value"]
    if m["key"] in ("p_value", "trend_p", "kendall_p", "llr_p") and isinstance(v, float):
        return "< 0.001" if v < 0.001 else f"{v:.3f}"
    return fmt(v)


def from_analysis(
    run_id: str, title: str, analysis_type: str, result: dict[str, Any], *, limit_rows: int = 6
) -> list[EvidenceItem]:
    src = {"type": "analysis", "analysis_run_id": run_id, "analysis_type": analysis_type, "title": title}
    parts = []
    for m in result["metrics"][:9]:
        if m["value"] is None:
            continue
        ci = f" (95% CI {fmt(m['ci'][0])} to {fmt(m['ci'][1])})" if m.get("ci") else ""
        parts.append(f"{m['label']} = {_pfmt(m)}{ci}")
    items = [
        EvidenceItem(
            "computed",
            title,
            "; ".join(parts) + f". Rows used: {result['n_used']} of {result['n_total']}.",
            src,
        )
    ]
    for t in result["tables"]:
        rows = t["rows"]
        if t["name"] == "groups":
            body = "; ".join(
                f"{r['group']}: mean {fmt(r['mean'])}, n = {r['n']}" for r in rows[: limit_rows + 2]
            )
            items.append(EvidenceItem("computed", t["title"], body, {**src, "table": t["name"]}))
        elif t["name"] == "coefficients":
            sig = [
                r for r in rows if r["term"] != "(Intercept)" and r.get("p") is not None and r["p"] < 0.05
            ][:limit_rows]
            key = "odds_ratio" if "odds_ratio" in (rows[0] if rows else {}) else "estimate"
            body = (
                "; ".join(
                    f"{r['term']}: {key.replace('_', ' ')} {fmt(r[key])}, p {'< 0.001' if r['p'] < 0.001 else fmt(r['p'])}"
                    for r in sig
                )
                or "No term reached p < 0.05."
            )
            items.append(EvidenceItem("computed", "Significant terms", body, {**src, "table": t["name"]}))
        elif t["name"] == "pairs":
            body = "; ".join(
                f"{r['a']} × {r['b']}: r = {fmt(r['r'])}, adj. p {fmt(r['p_adj'])}, n = {r['n']}"
                for r in rows[:limit_rows]
                if r["r"] is not None
            )
            items.append(
                EvidenceItem("computed", "Strongest correlations", body, {**src, "table": t["name"]})
            )
        elif t["name"] == "frequencies":
            body = "; ".join(
                f"{r['category']}: {r['count']}"
                + (f" ({fmt(r['percent'])}%)" if r["percent"] is not None else "")
                for r in rows[: limit_rows + 2]
            )
            items.append(EvidenceItem("computed", "Category counts", body, {**src, "table": t["name"]}))
        elif t["name"] == "pairwise":
            body = "; ".join(
                f"{r['a']} vs {r['b']}: diff {fmt(r['mean_diff'])}, adj. p {fmt(r['p_adj'])}"
                for r in rows[:limit_rows]
            )
            items.append(EvidenceItem("computed", "Pairwise comparisons", body, {**src, "table": t["name"]}))
        elif t["name"] == "summary":
            body = "; ".join(
                f"{r['variable']}: mean {fmt(r['mean'])}, median {fmt(r['median'])}, sd {fmt(r['std'])}, n = {r['n']}"
                for r in rows[:limit_rows]
            )
            items.append(EvidenceItem("computed", "Summary statistics", body, {**src, "table": t["name"]}))
    for a in result.get("assumptions", []):
        if a["status"] == "violated":
            items.append(EvidenceItem("caveat", f"Assumption: {a['name']}", a["detail"], src))
    for w in result.get("warnings", [])[:4]:
        items.append(EvidenceItem("caveat", "Data note", w, src))
    return items


def from_themes(themes: list[dict[str, Any]], column: str, total: int | None = None) -> list[EvidenceItem]:
    out = []
    for t in themes[:8]:
        quote = t["examples"][0]["text"][:160] if t.get("examples") else ""
        txt = (
            f"{t['response_count']} of {total or '?'} responses ({fmt(t['share_pct'])}%) in column '{column}'. Distinguishing terms: {', '.join(t.get('keywords', [])[:5]) or 'n/a'}."
            + (f" Representative response: “{quote}”" if quote else "")
        )
        out.append(
            EvidenceItem(
                "qualitative",
                f"Theme “{t['name']}”",
                txt,
                {"type": "theme", "theme_id": str(t["id"]), "column": column},
            )
        )
    return out


def from_mixed(run_id: str, result: dict[str, Any]) -> list[EvidenceItem]:
    src = {"type": "mixed", "mixed_run_id": run_id}
    o = result["overall"]
    items = [
        EvidenceItem(
            "mixed",
            "Mixed-methods scope",
            f"{o['respondents']} respondents with a written response; {o['items']} theme/code item(s); {o['tests_run']} tests with Holm correction; "
            f"mean {o['outcome']} among respondents = {fmt(o['outcome_mean'])}.",
            src,
        )
    ]
    for f in result["findings"][:8]:
        items.append(
            EvidenceItem(
                "mixed",
                f"{f['kind'].replace('_', ' ').title()} — {f['item']}",
                f["statement"],
                {**src, "finding": f["id"]},
            )
        )
    for w in result.get("warnings", [])[:3]:
        items.append(EvidenceItem("caveat", "Mixed-methods note", w, src))
    return items


def from_profile(
    dataset_name: str, version: dict[str, Any], columns: list[dict[str, Any]]
) -> list[EvidenceItem]:
    q = version["quality"]
    src = {"type": "dataset", "dataset_version_id": str(version["id"])}
    types = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in q["type_counts"].items())
    items = [
        EvidenceItem(
            "dataset",
            f"Dataset “{dataset_name}” (version {version['version_number']})",
            f"{q['rows']} rows × {q['columns']} columns ({types}); {fmt(q['missing_pct'])}% of cells missing; {q['duplicate_rows']} duplicate rows.",
            src,
        )
    ]
    for i in q["issues"][:5]:
        if i["severity"] == "warning":
            items.append(EvidenceItem("caveat", "Data quality", i["message"], src))
    num = [
        c
        for c in columns
        if c["semantic_type"] in ("numeric_continuous", "numeric_discrete")
        and c["profile"].get("mean") is not None
    ][:8]
    if num:
        items.append(
            EvidenceItem(
                "dataset",
                "Numeric variables",
                "; ".join(
                    f"{c['name']}: mean {fmt(c['profile']['mean'])}, sd {fmt(c['profile'].get('std'))}, missing {fmt(c['missing_pct'])}%"
                    for c in num
                ),
                src,
            )
        )
    cat = [c for c in columns if c["semantic_type"] == "categorical" and c["profile"].get("top_values")][:5]
    if cat:
        items.append(
            EvidenceItem(
                "dataset",
                "Categorical variables",
                "; ".join(
                    f"{c['name']}: "
                    + ", ".join(f"{t['value']} {fmt(t['pct'])}%" for t in c["profile"]["top_values"][:3])
                    for c in cat
                ),
                src,
            )
        )
    return items


def from_insights(rows: list[Any]) -> list[EvidenceItem]:
    return [
        EvidenceItem(
            "computed",
            f"Stored insight ({i.qualification})",
            i.statement,
            {
                "type": "insight",
                "insight_id": str(i.id),
                "analysis_run_id": str(i.analysis_run_id) if i.analysis_run_id else None,
            },
        )
        for i in rows
    ]


_NUM = re.compile(r"(?<![\w.])[-−+]?\d+(?:\.\d+)?")


def numbers_in(text: str) -> list[float]:
    out = []
    for m in _NUM.findall(re.sub(r"\[E\d+\]|\bE\d+\b", " ", text)):
        try:
            out.append(float(m.replace("−", "-")))
        except ValueError:
            pass
    return out
