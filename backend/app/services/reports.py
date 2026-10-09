"""Report builder and renderer. Sections hold *references* to immutable, stored results; text is only what the researcher (or an explicitly-labelled AI step) wrote."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from html import escape
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import evidence as ev
from app.ai.narrator import narrate
from app.analysis.base import library_versions
from app.core.exceptions import NotFoundError, ValidationFailed
from app.db.models import (
    AnalysisRun,
    Dataset,
    DatasetVersion,
    Insight,
    MixedMethodRun,
    Project,
    QualitativeTheme,
    Report,
    SavedVisualization,
    ThemeDetectionRun,
    User,
)
from app.reports import svg
from app.services import qualitative as qual_service

SECTION_TYPES = {
    "text",
    "ai_summary",
    "findings",
    "dataset",
    "analysis",
    "visualization",
    "themes",
    "mixed",
    "methodology",
    "limitations",
    "traceability",
}
QUAL_ORDER = {"strong": 0, "moderate": 1, "tentative": 2}


def new_section(type_: str, title: str, **kw: Any) -> dict[str, Any]:
    return {"id": uuid.uuid4().hex[:12], "type": type_, "title": title, **kw}


# ----------------------------------------------------------------------------- validation / sources
async def validate_sections(
    session: AsyncSession, project_id: uuid.UUID, sections: list[dict[str, Any]]
) -> dict[str, list[str]]:
    """Every reference must belong to the same project (no cross-project leakage). Returns the traceability index."""
    src: dict[str, set[str]] = {
        "analysis_runs": set(),
        "insights": set(),
        "dataset_versions": set(),
        "mixed_runs": set(),
        "visualizations": set(),
        "theme_runs": set(),
    }

    async def owned(model: Any, key: str, bucket: str, label: str) -> None:
        for raw in key_values[key]:
            try:
                oid = uuid.UUID(str(raw))
            except ValueError as e:
                raise ValidationFailed(f"Invalid {label} reference.", code="INVALID_REPORT_REFERENCE") from e
            obj = await session.get(model, oid)
            if obj is None or getattr(obj, "project_id", None) != project_id:
                raise NotFoundError(
                    f"A referenced {label} does not exist in this project.", code="INVALID_REPORT_REFERENCE"
                )
            src[bucket].add(str(oid))

    key_values: dict[str, list[Any]] = {
        "analysis_run_id": [],
        "insight_ids": [],
        "mixed_run_id": [],
        "visualization_id": [],
        "dataset_version_id": [],
        "run_id": [],
    }
    for s in sections:
        if s.get("type") not in SECTION_TYPES:
            raise ValidationFailed(f"Unknown section type '{s.get('type')}'.", code="INVALID_REPORT_SECTION")
        ref = s.get("ref") or {}
        for k in ("analysis_run_id", "mixed_run_id", "visualization_id", "dataset_version_id", "run_id"):
            if ref.get(k):
                key_values[k].append(ref[k])
        key_values["insight_ids"].extend(ref.get("insight_ids", []))
    await owned(AnalysisRun, "analysis_run_id", "analysis_runs", "analysis")
    await owned(Insight, "insight_ids", "insights", "insight")
    await owned(MixedMethodRun, "mixed_run_id", "mixed_runs", "mixed-methods run")
    await owned(SavedVisualization, "visualization_id", "visualizations", "visualization")
    await owned(ThemeDetectionRun, "run_id", "theme_runs", "theme run")
    for raw in key_values["dataset_version_id"]:
        v = await session.get(DatasetVersion, uuid.UUID(str(raw)))
        ds = await session.get(Dataset, v.dataset_id) if v else None
        if ds is None or ds.project_id != project_id:
            raise NotFoundError(
                "A referenced dataset version does not exist in this project.",
                code="INVALID_REPORT_REFERENCE",
            )
        assert v is not None
        src["dataset_versions"].add(str(v.id))
    # runs imply their dataset versions
    for rid in list(src["analysis_runs"]):
        run = await session.get(AnalysisRun, uuid.UUID(rid))
        if run:
            src["dataset_versions"].add(str(run.dataset_version_id))
    return {k: sorted(v) for k, v in src.items()}


# ----------------------------------------------------------------------------- draft generation
async def generate_draft(
    session: AsyncSession,
    project: Project,
    user: User,
    title: str,
    version_id: uuid.UUID | None,
    with_ai: bool,
    stage,
) -> Report:
    await stage("Collecting analyses, insights and themes")
    run_q = select(AnalysisRun).where(AnalysisRun.project_id == project.id, AnalysisRun.status == "COMPLETED")
    if version_id:
        run_q = run_q.where(AnalysisRun.dataset_version_id == version_id)
    runs = (
        (
            await session.execute(
                run_q.order_by(AnalysisRun.saved.desc(), AnalysisRun.created_at.desc()).limit(10)
            )
        )
        .scalars()
        .all()
    )
    runs = sorted(runs, key=lambda r: r.created_at)
    insights = (
        (await session.execute(select(Insight).where(Insight.project_id == project.id))).scalars().all()
    )
    if runs:
        ids = {r.id for r in runs}
        insights = [i for i in insights if i.analysis_run_id in ids or i.mixed_run_id]
    insights = sorted(
        insights, key=lambda i: (QUAL_ORDER.get(i.qualification, 3), -i.created_at.timestamp())
    )[:8]
    viz = (
        (
            await session.execute(
                select(SavedVisualization)
                .where(SavedVisualization.project_id == project.id)
                .order_by(SavedVisualization.created_at)
            )
        )
        .scalars()
        .all()
    )
    if version_id:
        viz = [v for v in viz if v.dataset_version_id == version_id]
    mixed = (
        (
            await session.execute(
                select(MixedMethodRun)
                .where(MixedMethodRun.project_id == project.id)
                .order_by(MixedMethodRun.created_at.desc())
                .limit(2)
            )
        )
        .scalars()
        .all()
    )
    theme_runs = (
        (
            await session.execute(
                select(ThemeDetectionRun)
                .where(ThemeDetectionRun.project_id == project.id)
                .order_by(ThemeDetectionRun.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    seen_cols: set[tuple[uuid.UUID, str]] = set()
    latest_theme_runs = []
    for tr in theme_runs:
        key = (tr.dataset_version_id, tr.column_name)
        if key not in seen_cols and (not version_id or tr.dataset_version_id == version_id):
            seen_cols.add(key)
            latest_theme_runs.append(tr)
    if not (runs or latest_theme_runs or mixed or viz):
        raise ValidationFailed(
            "There are no completed analyses, themes or visualizations to report on yet. Run an analysis first.",
            code="NOTHING_TO_REPORT",
        )
    version_ids = list(
        dict.fromkeys(
            [str(r.dataset_version_id) for r in runs]
            + [str(t.dataset_version_id) for t in latest_theme_runs]
            + ([str(version_id)] if version_id else [])
        )
    )
    gen_key = hashlib.sha256(
        json.dumps(
            {
                "p": str(project.id),
                "t": title,
                "runs": [str(r.id) for r in runs],
                "ins": [str(i.id) for i in insights],
                "viz": [str(v.id) for v in viz],
                "mixed": [str(m.id) for m in mixed],
                "themes": [str(t.id) for t in latest_theme_runs],
                "ai": with_ai,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    existing = (await session.execute(select(Report).where(Report.project_id == project.id))).scalars().all()
    for r in existing:
        if r.generation.get("key") == gen_key:  # idempotent: identical inputs → same draft
            return r
    await stage("Assembling sections")
    sections: list[dict[str, Any]] = []
    if project.objective.strip():
        sections.append(new_section("text", "Research objective", body=project.objective.strip()))
    if insights:
        sections.append(
            new_section("findings", "Key findings", ref={"insight_ids": [str(i.id) for i in insights]})
        )
    if with_ai and insights:
        pack = ev.EvidencePack()
        pack.extend(ev.from_insights(insights))
        out = await narrate(pack, "report_summary")
        if out["meta"]["origin"] == "llm":
            n = out["narration"]
            sections.append(
                new_section(
                    "ai_summary",
                    "AI-assisted summary",
                    body=n["summary"]
                    + "\n"
                    + "\n".join(f"- {p['text']} [{', '.join(p['evidence'])}]" for p in n["points"]),
                    meta=out["meta"],
                    evidence=[i.public() for i in pack.items],
                )
            )
    for vid in version_ids:
        sections.append(new_section("dataset", "Data", ref={"dataset_version_id": vid}))
    sections.append(new_section("methodology", "Methodology"))
    for run_ in runs:
        sections.append(
            new_section(
                "analysis", run_.title, ref={"analysis_run_id": str(run_.id), "charts": True, "tables": True}
            )
        )
    for v in viz:
        sections.append(new_section("visualization", v.name, ref={"visualization_id": str(v.id)}))
    for tr in latest_theme_runs:
        sections.append(
            new_section(
                "themes",
                f"Qualitative themes — {tr.column_name}",
                ref={
                    "dataset_version_id": str(tr.dataset_version_id),
                    "column": tr.column_name,
                    "run_id": str(tr.id),
                },
            )
        )
    for m in mixed:
        sections.append(
            new_section(
                "mixed", f"Mixed-methods integration — {m.outcome_column}", ref={"mixed_run_id": str(m.id)}
            )
        )
    sections.append(new_section("limitations", "Limitations"))
    sections.append(new_section("traceability", "Traceability"))
    await stage("Validating references")
    sources = await validate_sections(session, project.id, sections)
    rep = Report(
        project_id=project.id,
        title=title.strip() or f"{project.name} — report",
        objective=project.objective,
        sections=sections,
        sources=sources,
        status="DRAFT",
        generation={
            "key": gen_key,
            "generated_at": datetime.now(UTC).isoformat(),
            "with_ai": with_ai,
            "by": str(user.id),
        },
        created_by=user.id,
    )
    session.add(rep)
    await session.commit()
    return rep


# ----------------------------------------------------------------------------- rendering
CSS = """
:root{--ink:#17313b;--muted:#5d7078;--line:#dfe6e3;--teal:#1d6f6a;--sand:#f6f3ec;--lapis:#2b4c8c;--terra:#b25a2e}
*{box-sizing:border-box}body{font:15px/1.6 'Georgia','Times New Roman',serif;color:var(--ink);margin:0;background:#fff}
main{max-width:820px;margin:0 auto;padding:44px 28px 80px}h1{font-size:30px;line-height:1.2;margin:.2em 0 .1em;font-weight:600}
h2{font-size:21px;margin:2em 0 .5em;padding-top:.8em;border-top:1px solid var(--line);font-weight:600}h3{font-size:16px;margin:1.2em 0 .3em}
.meta{color:var(--muted);font:13px system-ui,sans-serif}.brand{font:600 12px system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--teal)}
table{border-collapse:collapse;width:100%;font:13px system-ui,sans-serif;margin:.6em 0}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left}th{background:var(--sand);font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}.badge{display:inline-block;font:600 10.5px system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:99px;margin-right:6px;vertical-align:1px}
.b-computed{background:#e2f0ee;color:var(--teal)}.b-qual{background:#e7ecf6;color:var(--lapis)}.b-ai{background:#f6e8df;color:var(--terra)}.b-rule{background:#eceff0;color:var(--muted)}
.card{border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:.8em 0;background:#fff}.card.q-strong{border-left:4px solid var(--teal)}.card.q-moderate{border-left:4px solid #5c8a5a}.card.q-tentative{border-left:4px solid #b8963a}
.metrics{display:flex;flex-wrap:wrap;gap:10px;margin:.6em 0}.metric{border:1px solid var(--line);border-radius:6px;padding:6px 12px;font:12px system-ui,sans-serif;min-width:120px}.metric b{display:block;font-size:17px}
.muted{color:var(--muted)}blockquote{margin:.4em 0;padding:.2em 1em;border-left:3px solid var(--line);color:#2e4750;font-style:italic}.warn{background:#fbf3e4;border-left:3px solid #b8963a;padding:6px 12px;font:13px system-ui,sans-serif;margin:.4em 0}
figure{margin:1em 0}figcaption{font:12px system-ui,sans-serif;color:var(--muted)}ul{padding-left:1.2em}.legend{margin:1.5em 0;font:12px system-ui,sans-serif;color:var(--muted)}
@media print{main{max-width:none;padding:0}h2{break-after:avoid}.card,figure,table{break-inside:avoid}}
"""


def _fnum(v: Any, kind: str = "number") -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, str):
        return escape(v)
    if kind == "p_value":
        return "< 0.001" if v < 0.001 else f"{v:.3f}"
    if kind == "integer":
        return f"{int(v):,}"
    if kind == "percent":
        return f"{v:.1f}%"
    if isinstance(v, int):
        return f"{v:,}"
    return f"{v:.3f}".rstrip("0").rstrip(".") if abs(v) < 100 else f"{v:,.1f}"


def _table_html(t: dict[str, Any], max_rows: int = 14) -> str:
    cols = t["columns"]
    head = "".join(f"<th>{escape(c['label'])}</th>" for c in cols)
    body = ""
    for r in t["rows"][:max_rows]:
        body += (
            "<tr>"
            + "".join(
                f"<td class='{'n' if c['kind'] != 'text' else ''}'>{_fnum(r.get(c['key']), c['kind'])}</td>"
                for c in cols
            )
            + "</tr>"
        )
    more = (
        f"<p class='muted'>{len(t['rows']) - max_rows} more row(s) not shown.</p>"
        if len(t["rows"]) > max_rows
        else ""
    )
    note = f"<p class='muted'>{escape(t['note'])}</p>" if t.get("note") else ""
    return f"<h3>{escape(t['title'])}</h3><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>{more}{note}"


def _metrics_html(ms: list[dict[str, Any]], limit: int = 8) -> str:
    cells = ""
    for m in [m for m in ms if m["value"] is not None][:limit]:
        ci = f"<span class='muted'> [{_fnum(m['ci'][0])}, {_fnum(m['ci'][1])}]</span>" if m.get("ci") else ""
        v = _fnum(
            m["value"], "p_value" if m["key"] in ("p_value", "trend_p", "kendall_p", "llr_p") else "number"
        )
        cells += f"<div class='metric'>{escape(m['label'])}<b>{v}{ci}</b></div>"
    return f"<div class='metrics'>{cells}</div>"


def _fig(spec: dict[str, Any]) -> str:
    s = svg.render(spec)
    if not s:
        return ""
    sub = f" — {escape(spec['subtitle'])}" if spec.get("subtitle") else ""
    notes = "".join(f" {escape(n)}" for n in spec.get("notes", []))
    return f"<figure>{s}<figcaption><b>{escape(spec['title'])}</b>{sub}.{notes}</figcaption></figure>"


def _badge(kind: str) -> str:
    return {
        "computed": "<span class='badge b-computed'>Computed</span>",
        "qual": "<span class='badge b-qual'>Qualitative</span>",
        "ai": "<span class='badge b-ai'>AI interpretation</span>",
        "rule": "<span class='badge b-rule'>Rule-based summary</span>",
    }[kind]


def _interp_html(it: dict[str, Any] | None) -> str:
    if not it:
        return ""
    meta = it.get("meta", {})
    llm = meta.get("origin") == "llm"
    pts = "".join(
        f"<li>{escape(p['text'])} <span class='muted'>[{escape(', '.join(p['evidence']))}]</span></li>"
        for p in it.get("points", [])
    )
    who = (
        f" <span class='muted'>({escape(str(meta.get('model')))}, prompt {escape(str(meta.get('prompt_version')))}; numbers validated against the computed evidence)</span>"
        if llm
        else ""
    )
    return f"<div class='card'>{_badge('ai' if llm else 'rule')}{who}<p>{escape(it.get('summary', ''))}</p><ul>{pts}</ul></div>"


async def _resolve(session: AsyncSession, report: Report) -> dict[str, Any]:
    ctx: dict[str, Any] = {"runs": {}, "insights": {}, "versions": {}, "mixed": {}, "viz": {}}
    s = report.sources
    for rid in s.get("analysis_runs", []):
        if r := await session.get(AnalysisRun, uuid.UUID(rid)):
            ctx["runs"][rid] = r
    for iid in {i for sec in report.sections for i in (sec.get("ref") or {}).get("insight_ids", [])}:
        if i := await session.get(Insight, uuid.UUID(iid)):
            ctx["insights"][iid] = i
    for vid in s.get("dataset_versions", []):
        v = await session.get(DatasetVersion, uuid.UUID(vid))
        if v:
            ctx["versions"][vid] = (v, await session.get(Dataset, v.dataset_id))
    for mid in s.get("mixed_runs", []):
        if m := await session.get(MixedMethodRun, uuid.UUID(mid)):
            ctx["mixed"][mid] = m
    for vid in s.get("visualizations", []):
        if viz_ := await session.get(SavedVisualization, uuid.UUID(vid)):
            ctx["viz"][vid] = viz_
    return ctx


def _removed(title: str) -> str:
    return f"<p class='warn'>The source for “{escape(title)}” was removed after this report was built.</p>"


async def render_html(session: AsyncSession, report: Report, project: Project, author: str) -> str:
    ctx = await _resolve(session, report)
    parts: list[str] = []
    for sec in report.sections:
        h = escape(sec["title"])
        ref = sec.get("ref") or {}
        t = sec["type"]
        body = ""
        if t == "text":
            body = "".join(f"<p>{escape(p)}</p>" for p in str(sec.get("body", "")).split("\n\n"))
        elif t == "ai_summary":
            body = (
                f"<div class='card'>{_badge('ai')}<span class='muted'>({escape(str(sec.get('meta', {}).get('model')))}; numbers validated against the findings below)</span>"
                + "".join(
                    f"<p>{escape(line)}</p>" for line in str(sec.get("body", "")).split("\n") if line.strip()
                )
                + "</div>"
            )
        elif t == "findings":
            for iid in ref.get("insight_ids", []):
                i = ctx["insights"].get(iid)
                if not i:
                    body += _removed("insight")
                    continue
                evid = "".join(
                    f"<li>{escape(str(e['label']))}: <b>{_fnum(e['value'])}</b></li>" for e in i.evidence[:5]
                )
                body += (
                    f"<div class='card q-{i.qualification}'>{_badge('computed')}<b>{escape(i.title)}</b> <span class='muted'>({i.qualification} evidence)</span><p>{escape(i.statement)}</p>"
                    f"<ul>{evid}</ul>{_interp_html(i.narrative)}</div>"
                )
        elif t == "dataset":
            pair = ctx["versions"].get(str(ref.get("dataset_version_id")))
            if not pair:
                body = _removed("dataset")
            else:
                v, ds = pair
                q = v.quality
                issues = "".join(
                    f"<li>{escape(x['message'])}</li>"
                    for x in q.get("issues", [])
                    if x["severity"] == "warning"
                )
                body = (
                    f"<p>{_badge('computed')}<b>{escape(ds.name)}</b> — version {v.version_number} (“{escape(v.label)}”), file <code>{escape(ds.original_filename)}</code>. "
                    f"{q['rows']:,} rows × {q['columns']} columns; {q['missing_pct']:.1f}% of cells missing; {q['duplicate_rows']} duplicate rows. Content hash <code>{v.content_hash[:12]}</code>.</p>"
                    + (f"<ul>{issues}</ul>" if issues else "")
                )
        elif t == "analysis":
            r = ctx["runs"].get(str(ref.get("analysis_run_id")))
            if not r or not r.result:
                body = _removed(sec["title"])
            else:
                res = r.result
                body = (
                    f"<p>{_badge('computed')}<span class='muted'>{escape(r.analysis_type.replace('_', ' '))} · n used = {res['n_used']:,} of {res['n_total']:,} rows · analysis {str(r.id)[:8]}</span></p>"
                    + _metrics_html(res["metrics"])
                )
                if ref.get("charts", True):
                    body += "".join(_fig(c) for c in res["charts"][:3])
                if ref.get("tables", True):
                    body += "".join(_table_html(tb) for tb in res["tables"][:2])
                if res.get("assumptions"):
                    body += (
                        "<h3>Assumptions</h3><ul>"
                        + "".join(
                            f"<li><b>{escape(a['name'])}</b> — {a['status']}. {escape(a['detail'])}</li>"
                            for a in res["assumptions"]
                        )
                        + "</ul>"
                    )
                body += "".join(f"<div class='warn'>{escape(w)}</div>" for w in res["warnings"])
                body += _interp_html(r.interpretation)
        elif t == "visualization":
            v = ctx["viz"].get(str(ref.get("visualization_id")))
            body = (_badge("computed") + _fig(v.spec)) if v else _removed(sec["title"])
        elif t == "themes":
            themes, _ = await qual_service.list_themes(
                session,
                report.project_id,
                uuid.UUID(ref["dataset_version_id"]),
                ref["column"],
                uuid.UUID(ref["run_id"]) if ref.get("run_id") else None,
            )
            if not themes:
                body = _removed(sec["title"])
            else:
                body = f"<p>{_badge('qual')}<span class='muted'>Themes are suggestions from embedding clustering; names and membership reflect the researcher's edits. Counts are computed from stored memberships.</span></p>"
                body += (
                    "<table><thead><tr><th>Theme</th><th>Responses</th><th>Share</th><th>Key terms</th></tr></thead><tbody>"
                    + "".join(
                        f"<tr><td>{escape(x['name'])}</td><td class='n'>{x['response_count']}</td><td class='n'>{x['share_pct']:.1f}%</td><td>{escape(', '.join(x['keywords'][:5]))}</td></tr>"
                        for x in themes
                    )
                    + "</tbody></table>"
                )
                for x in themes[:6]:
                    if x["examples"]:
                        body += f"<h3>{escape(x['name'])}</h3>" + "".join(
                            f"<blockquote>{escape(e['text'][:300])}</blockquote>" for e in x["examples"][:2]
                        )
                        if x.get("description"):
                            body += f"<p>{escape(x['description'])}</p>"
        elif t == "mixed":
            m = ctx["mixed"].get(str(ref.get("mixed_run_id")))
            if not m:
                body = _removed(sec["title"])
            else:
                r = m.result
                body = f"<p>{_badge('computed')}{_badge('qual')}<span class='muted'>{r['overall']['respondents']} respondents · outcome: {escape(m.outcome_column)} · {r['overall']['tests_run']} tests, Holm-corrected</span></p>"
                body += (
                    "<table><thead><tr><th>Theme / code</th><th>Voiced by</th><th>Mean with</th><th>Mean without</th><th>Diff</th><th>g</th><th>adj. p</th></tr></thead><tbody>"
                    + "".join(
                        f"<tr><td>{escape(i['name'])}</td><td class='n'>{i['n_respondents']} ({i['prevalence_pct']:.0f}%)</td><td class='n'>{_fnum(i['outcome'].get('mean_with'))}</td><td class='n'>{_fnum(i['outcome'].get('mean_without'))}</td>"
                        f"<td class='n'>{_fnum(i['outcome'].get('diff'))}</td><td class='n'>{_fnum(i['outcome'].get('effect'))}</td><td class='n'>{_fnum(i['outcome'].get('p_adj'), 'p_value')}</td></tr>"
                        for i in r["items"]
                    )
                    + "</tbody></table>"
                )
                body += "".join(
                    f"<div class='card q-{f['qualification']}'><b>{escape(f['kind'].replace('_', ' ').title())}</b> <span class='muted'>({f['qualification']})</span><p>{escape(f['statement'])}</p></div>"
                    for f in r["findings"]
                )
                body += "".join(f"<div class='warn'>{escape(w)}</div>" for w in r["warnings"])
                body += _interp_html(m.synthesis)
        elif t == "methodology":
            kinds = {r.analysis_type: r.result["methodology"] for r in ctx["runs"].values() if r.result}
            lv = library_versions()
            body = (
                "".join(
                    f"<h3>{escape(k.replace('_', ' ').title())}</h3><p>{escape(v)}</p>"
                    for k, v in kinds.items()
                )
                or "<p class='muted'>No statistical analyses are included.</p>"
            )
            if ctx["mixed"]:
                body += f"<h3>Mixed methods</h3><p>{escape(next(iter(ctx['mixed'].values())).result['methodology'])}</p>"
            if any(s["type"] == "themes" for s in report.sections):
                body += (
                    "<h3>Qualitative theme detection</h3><p>Responses were embedded (TF-IDF → latent semantic analysis by default, or a configured transformer model), clustered with k-means "
                    "(k chosen by silhouette score unless fixed; seed fixed), and each cluster labelled with its most distinguishing terms. Themes are suggestions that the researcher reviewed and could rename, merge or delete.</p>"
                )
            body += f"<p class='muted'>Software: Lotus engine {lv['engine']}; numpy {lv['numpy']}, pandas {lv['pandas']}, scipy {lv['scipy']}, statsmodels {lv['statsmodels']}, scikit-learn {lv['scikit-learn']}. Analyses are deterministic (fixed seeds).</p>"
        elif t == "limitations":
            items = [
                "Associations reported here are not evidence of causation.",
                "Statistical significance depends on sample size and on assumptions that are listed beside each analysis.",
                "AI-assisted text, where present, is labelled and was checked only for numerical consistency with the computed evidence; it can still be incomplete.",
            ]
            for r in ctx["runs"].values():
                for w in (r.result or {}).get("warnings", []):
                    items.append(f"{r.title}: {w}")
                for a in (r.result or {}).get("assumptions", []):
                    if a["status"] == "violated":
                        items.append(f"{r.title}: assumption “{a['name']}” appears violated. {a['detail']}")
            for v, ds in ctx["versions"].values():
                for q in v.quality.get("issues", []):
                    if q["severity"] == "warning":
                        items.append(f"{ds.name}: {q['message']}")
            if any(s["type"] in ("themes", "mixed") for s in report.sections):
                items.append(
                    "Automatically detected themes assign each response to a single theme and may miss secondary topics; code-based items (multi-label) address this where used."
                )
            body = (
                "<ul>"
                + "".join(f"<li>{escape(i)}</li>" for i in dict.fromkeys(items))
                + "</ul>"
                + (f"<p>{escape(sec['body'])}</p>" if sec.get("body") else "")
            )
        elif t == "traceability":
            rows = ""
            for rid, r in ctx["runs"].items():
                ver = ctx["versions"].get(str(r.dataset_version_id))
                rows += (
                    f"<tr><td>Analysis</td><td>{escape(r.title)}</td><td><code>{rid[:8]}</code></td><td>{escape(ver[1].name) if ver else ''} v{ver[0].version_number if ver else ''} <code>{ver[0].content_hash[:10] if ver else ''}</code></td>"
                    f"<td>{r.created_at:%Y-%m-%d %H:%M}</td></tr>"
                )
            for mid, m in ctx["mixed"].items():
                rows += f"<tr><td>Mixed methods</td><td>{escape(m.outcome_column)} × {escape(m.column_name)}</td><td><code>{mid[:8]}</code></td><td></td><td>{m.created_at:%Y-%m-%d %H:%M}</td></tr>"
            body = (
                "<table><thead><tr><th>Type</th><th>Title</th><th>ID</th><th>Dataset version (content hash)</th><th>Created</th></tr></thead><tbody>"
                + rows
                + "</tbody></table><p class='muted'>Every figure in this report was computed from the dataset version listed, with the stored configuration; open the analysis by ID in Lotus to reproduce it.</p>"
            )
        parts.append(f"<section id='{sec['id']}'><h2>{h}</h2>{body}</section>")
    legend = f"<p class='legend'>{_badge('computed')} computed by the statistics engine &nbsp; {_badge('qual')} qualitative evidence &nbsp; {_badge('ai')} AI-assisted text &nbsp; {_badge('rule')} rule-based summary</p>"
    return (
        f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{escape(report.title)}</title><style>{CSS}</style></head>"
        f"<body><main><div class='brand'>Lotus Platform · Research report</div><h1>{escape(report.title)}</h1>"
        f"<div class='meta'>{escape(project.name)} · prepared by {escape(author)} · {report.updated_at or report.created_at:%d %B %Y}</div>{legend}{''.join(parts)}</main></body></html>"
    )


def render_markdown(html_sections: list[dict[str, Any]], report: Report) -> str:
    """Lightweight Markdown export of section titles, text and findings (charts/tables live in the HTML export)."""
    out = [f"# {report.title}", ""]
    for s in html_sections:
        out += [f"## {s['title']}", s.get("text", ""), ""]
    return "\n".join(out)


async def markdown_sections(session: AsyncSession, report: Report) -> list[dict[str, Any]]:
    ctx = await _resolve(session, report)
    res = []
    for sec in report.sections:
        ref = sec.get("ref") or {}
        text = ""
        if sec["type"] in ("text", "ai_summary"):
            text = str(sec.get("body", "")) + (
                "\n\n*AI-assisted text.*" if sec["type"] == "ai_summary" else ""
            )
        elif sec["type"] == "findings":
            text = "\n".join(
                f"- **{ctx['insights'][i].title}** ({ctx['insights'][i].qualification}): {ctx['insights'][i].statement}"
                for i in ref.get("insight_ids", [])
                if i in ctx["insights"]
            )
        elif sec["type"] == "analysis":
            r = ctx["runs"].get(str(ref.get("analysis_run_id")))
            if r and r.result:
                text = (
                    "\n".join(
                        f"- {m['label']}: {m['value']}" for m in r.result["metrics"] if m["value"] is not None
                    )
                    + f"\n\n*{r.result['methodology']}*"
                )
        elif sec["type"] == "mixed":
            m = ctx["mixed"].get(str(ref.get("mixed_run_id")))
            if m:
                text = "\n".join(f"- {f['statement']}" for f in m.result["findings"])
        res.append({"title": sec["title"], "text": text})
    return res


_ = QualitativeTheme
