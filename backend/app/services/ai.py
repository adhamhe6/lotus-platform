"""AI assistant orchestration: route → COMPUTE (analysis engine / stored results) → evidence pack → narrate → validated, provenance-tagged message."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import evidence as ev
from app.ai import router as intent_router
from app.ai.narrator import narrate
from app.analysis import suggest as suggest_engine
from app.core.config import get_settings
from app.core.exceptions import LotusError
from app.datasets.storage import Storage
from app.db.models import (
    AIConversation,
    AIMessage,
    AnalysisRun,
    DatasetVersion,
    Insight,
    MixedMethodRun,
    QualitativeSegment,
    QualitativeTheme,
    User,
)
from app.schemas.datasets import ColumnOut, VersionOut
from app.services import analyses as analysis_service
from app.services import datasets as dataset_service
from app.services import insights as insight_service
from app.services import mixed as mixed_service
from app.services import qualitative as qual_service

log = logging.getLogger("lotus.ai")
QUAL_RANK = {"strong": 0, "moderate": 1, "tentative": 2}


async def _ensure_run(
    session: AsyncSession,
    storage: Storage,
    user: User,
    project_id: uuid.UUID,
    version: DatasetVersion,
    analysis_type: str,
    config: dict[str, Any],
    notes: list[str],
) -> AnalysisRun | None:
    """Create (or reuse) a stored analysis run and execute it now. Failures become caveats, never fabricated results."""
    try:
        run, reused = await analysis_service.create_run(
            session, user.id, project_id, version, analysis_type, config, None
        )
        await session.commit()
        if not reused or run.status == "PENDING":

            async def noop(_: str | None = None) -> None:
                return None

            await analysis_service.execute_run(session, storage, run.id, noop)
            await insight_service.create_for_run(session, run)
            await session.commit()
        await session.refresh(run)
        return run if run.status == "COMPLETED" else None
    except LotusError as e:
        await session.rollback()
        notes.append(
            f"The {analysis_type.replace('_', ' ')} on {', '.join(str(v) for v in config.values() if isinstance(v, str))} could not be run: {e.message}"
        )
        return None


async def suggestions_for(
    session: AsyncSession, storage: Storage, version: DatasetVersion
) -> list[dict[str, Any]]:
    cols = await dataset_service.version_columns(session, version.id)
    meta = [ColumnOut.model_validate(c).model_dump() for c in cols]
    names = [
        c["name"]
        for c in meta
        if c["semantic_type"]
        in ("numeric_continuous", "numeric_discrete", "binary", "categorical", "boolean")
    ]
    df = await dataset_service.load_frame(storage, version, names[:40])
    return suggest_engine.suggest(df, meta)


async def _latest_theme_evidence(
    session: AsyncSession, project_id: uuid.UUID, version_id: uuid.UUID
) -> tuple[list[ev.EvidenceItem], str | None]:
    col = (
        await session.execute(
            select(QualitativeTheme.column_name)
            .where(
                QualitativeTheme.project_id == project_id, QualitativeTheme.dataset_version_id == version_id
            )
            .order_by(QualitativeTheme.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if col is None:
        return [], None
    themes, _ = await qual_service.list_themes(session, project_id, version_id, col, None)
    total = (
        await session.execute(
            select(func.count(func.distinct(QualitativeSegment.row_index))).where(
                QualitativeSegment.dataset_version_id == version_id, QualitativeSegment.column_name == col
            )
        )
    ).scalar_one()
    return ev.from_themes(themes, col, total), col


def _pairs_with_target(run: AnalysisRun, target: str) -> ev.EvidenceItem | None:
    rows = [
        r
        for r in next((t["rows"] for t in (run.result or {})["tables"] if t["name"] == "pairs"), [])
        if r["r"] is not None and target in (r["a"], r["b"])
    ]
    if not rows:
        return None
    rows.sort(key=lambda r: -abs(r["r"]))
    body = "; ".join(
        f"{r['b'] if r['a'] == target else r['a']}: r = {ev.fmt(r['r'])}, Holm-adjusted p {ev.fmt(r['p_adj'])}, n = {r['n']}"
        for r in rows[:8]
    )
    return ev.EvidenceItem(
        "computed",
        f"Correlations with {target} (strongest first)",
        body,
        {
            "type": "analysis",
            "analysis_run_id": str(run.id),
            "analysis_type": "correlation",
            "table": "pairs",
            "title": run.title,
        },
    )


async def answer(
    session: AsyncSession,
    storage: Storage,
    user: User,
    project_id: uuid.UUID,
    conv: AIConversation,
    version: DatasetVersion,
    dataset_name: str,
    question: str,
) -> AIMessage:
    cols = await dataset_service.version_columns(session, version.id)
    colinfo = [(c.name, c.semantic_type) for c in cols]
    types = dict(colinfo)
    theme_count = (
        await session.execute(
            select(func.count())
            .select_from(QualitativeTheme)
            .where(
                QualitativeTheme.project_id == project_id, QualitativeTheme.dataset_version_id == version.id
            )
        )
    ).scalar_one()
    intent = intent_router.classify(question, colinfo, has_themes=theme_count > 0)
    pack = ev.EvidencePack()
    runs_used: list[AnalysisRun] = []
    notes: list[str] = []
    insufficient: str | None = None
    ctx_blocks: list[dict[str, Any]] = []

    def add_run(run: AnalysisRun, items: list[ev.EvidenceItem] | None = None) -> None:
        runs_used.append(run)
        added = [
            pack.add(i)
            for i in (
                items
                if items is not None
                else ev.from_analysis(str(run.id), run.title, run.analysis_type, run.result or {})
            )
        ]
        ctx_blocks.append(
            {
                "type": "computed",
                "title": run.title,
                "analysis_run_id": str(run.id),
                "analysis_type": run.analysis_type,
                "evidence_ids": [a.id for a in added],
            }
        )

    numeric_cols = [n for n, t in colinfo if t in ("numeric_continuous", "numeric_discrete")]
    cat_cols = [
        n
        for n, t in colinfo
        if t in ("categorical", "boolean") and 2 <= next(c.unique_count for c in cols if c.name == n) <= 12
    ]
    kind = intent.kind

    if kind == "trend":
        date = next((n for n, t in colinfo if t == "datetime"), None)
        val = intent.target or next((n for n in numeric_cols), None)
        if date is None or val is None:
            notes.append(
                "A trend needs a date column and a numeric measure; this dataset version has no usable date column, so an overview is shown instead."
            )
            kind = "overview"
        else:
            if intent.target is None:
                notes.append(f"No measure was named, so '{val}' (the first numeric column) was used.")
            run = await _ensure_run(
                session,
                storage,
                user,
                project_id,
                version,
                "time_series",
                {"date_column": date, "value_column": val, "frequency": "auto", "aggregation": "mean"},
                notes,
            )
            if run:
                add_run(run)
    if kind == "relationship":
        tgt = intent.target
        others = [n for n in numeric_cols + [n for n, t in colinfo if t == "binary"] if n != tgt][:9]
        named_other = [c for c in intent.columns if c != tgt]
        if named_other and len(intent.columns) == 2:
            o = named_other[0]
            if types[o] in ("numeric_continuous", "numeric_discrete", "binary"):
                run = await _ensure_run(
                    session,
                    storage,
                    user,
                    project_id,
                    version,
                    "correlation",
                    {"variables": [tgt, o], "method": "pearson"},
                    notes,
                )
            elif types[o] in ("categorical", "boolean"):
                run = await _ensure_run(
                    session,
                    storage,
                    user,
                    project_id,
                    version,
                    "group_comparison",
                    {"outcome": tgt, "group": o, "test": "auto"},
                    notes,
                )
            else:
                run = None
            if run:
                add_run(run)
        else:
            if others:
                run = await _ensure_run(
                    session,
                    storage,
                    user,
                    project_id,
                    version,
                    "correlation",
                    {"variables": [tgt, *others], "method": "pearson"},
                    notes,
                )
                if run:
                    item = _pairs_with_target(run, tgt or "")
                    add_run(
                        run,
                        ([item] if item else [])
                        + [
                            i
                            for i in ev.from_analysis(
                                str(run.id), run.title, run.analysis_type, run.result or {}
                            )
                            if i.kind == "caveat"
                        ][:2],
                    )
            for g in cat_cols[:4]:
                run = await _ensure_run(
                    session,
                    storage,
                    user,
                    project_id,
                    version,
                    "group_comparison",
                    {"outcome": tgt, "group": g, "test": "auto"},
                    notes,
                )
                if run:
                    add_run(
                        run,
                        [ev.from_analysis(str(run.id), run.title, run.analysis_type, run.result or {})[0]],
                    )
    if kind == "comparison":
        cat = (
            intent.reason
            if intent.reason in types
            else next((c for c in intent.columns if types.get(c) in ("categorical", "boolean")), None)
        )
        tgt = intent.target
        if cat and tgt:
            run = await _ensure_run(
                session,
                storage,
                user,
                project_id,
                version,
                "group_comparison",
                {"outcome": tgt, "group": cat, "test": "auto"},
                notes,
            )
            if run:
                add_run(run)
        elif cat:
            run = await _ensure_run(
                session, storage, user, project_id, version, "frequency", {"column": cat}, notes
            )
            if run:
                add_run(run)
        else:
            notes.append(
                "I could not tell which categorical variable to compare by. Mention one of: "
                + ", ".join(cat_cols[:6])
                + "."
            )
    if kind == "distribution":
        nums_q = [
            c for c in intent.columns if types.get(c) in ("numeric_continuous", "numeric_discrete", "binary")
        ]
        cats_q = [c for c in intent.columns if types.get(c) in ("categorical", "boolean")]
        if nums_q:
            run = await _ensure_run(
                session, storage, user, project_id, version, "descriptive", {"columns": nums_q[:4]}, notes
            )
            if run:
                add_run(run)
        if cats_q:
            run = await _ensure_run(
                session, storage, user, project_id, version, "frequency", {"column": cats_q[0]}, notes
            )
            if run:
                add_run(run)
        if not nums_q and not cats_q:
            kind = "overview"
    if kind == "themes":
        items, col = await _latest_theme_evidence(session, project_id, version.id)
        if not items:
            insufficient = "No qualitative themes exist for this dataset version yet. Open the Qualitative workspace, prepare a text column and detect themes; then I can describe them with real counts."
        else:
            pack.extend(items)
            ctx_blocks.append(
                {"type": "qualitative", "title": f"Themes in “{col}”", "evidence_ids": [i.id for i in items]}
            )
    if kind == "mixed":
        items, col = await _latest_theme_evidence(session, project_id, version.id)
        if not items or col is None:
            insufficient = (
                "A mixed-methods answer needs themes for a text column. Detect themes first, then ask again."
            )
        else:
            try:
                mrun = await mixed_service.run_mixed(
                    session,
                    storage,
                    project_id,
                    user.id,
                    version,
                    col,
                    intent.target or numeric_cols[0],
                    None,
                    None,
                    "themes",
                    None,
                )
                before = len(pack.items)
                pack.extend(ev.from_mixed(str(mrun.id), mrun.result))
                ctx_blocks.append(
                    {
                        "type": "mixed",
                        "title": f"Mixed-methods evidence: {mrun.outcome_column} × themes in “{col}”",
                        "mixed_run_id": str(mrun.id),
                        "evidence_ids": [i.id for i in pack.items[before:]],
                    }
                )
                tq = pack.items[:0]
                _ = tq
            except LotusError as e:
                notes.append(e.message)
    if kind == "overview":
        before = len(pack.items)
        pack.extend(
            ev.from_profile(
                dataset_name,
                VersionOut.model_validate(version).model_dump(),
                [ColumnOut.model_validate(c).model_dump() for c in cols],
            )
        )
        ctx_blocks.append(
            {
                "type": "computed",
                "title": f"Profile of {dataset_name}",
                "evidence_ids": [i.id for i in pack.items[before:]],
            }
        )
        stored = (
            (
                await session.execute(
                    select(Insight)
                    .join(AnalysisRun, AnalysisRun.id == Insight.analysis_run_id)
                    .where(Insight.project_id == project_id, AnalysisRun.dataset_version_id == version.id)
                )
            )
            .scalars()
            .all()
        )
        stored = sorted(stored, key=lambda i: (QUAL_RANK.get(i.qualification, 3), -i.created_at.timestamp()))[
            :6
        ]
        if stored:
            before = len(pack.items)
            pack.extend(ev.from_insights(stored))
            ctx_blocks.append(
                {
                    "type": "computed",
                    "title": "Stored insights (rule-derived from computed analyses)",
                    "evidence_ids": [i.id for i in pack.items[before:]],
                }
            )
        else:
            notes.append(
                "No analyses have been run on this dataset yet, so there are no stored insights. Try the suggested analyses."
            )
        titems, col = await _latest_theme_evidence(session, project_id, version.id)
        if titems:
            before = len(pack.items)
            pack.extend(titems[:4])
            ctx_blocks.append(
                {
                    "type": "qualitative",
                    "title": f"Themes in “{col}”",
                    "evidence_ids": [i.id for i in pack.items[before:]],
                }
            )
    if kind == "next_steps":
        sug = await suggestions_for(session, storage, version)
        before = len(pack.items)
        for s in sug[:6]:
            pack.add(
                ev.EvidenceItem(
                    "dataset",
                    s["title"],
                    s["reason"],
                    {"type": "suggestion", "analysis_type": s["analysis_type"], "config": s["config"]},
                )
            )
        ctx_blocks.append(
            {
                "type": "computed",
                "title": "Suggestions from the schema and a preliminary scan",
                "evidence_ids": [i.id for i in pack.items[before:]],
            }
        )
    if kind == "unknown":
        insufficient = (
            f"I can only answer from this project's data, and I could not map that question to an analysis ({intent.reason or 'no matching variable or method'}). "
            f"Available variables: {', '.join(n for n, _ in colinfo)}. Try naming variables, e.g. “How is {numeric_cols[0] if numeric_cols else 'a measure'} related to {cat_cols[0] if cat_cols else 'a category'}?”"
        )
    for n in notes:
        pack.add(ev.EvidenceItem("caveat", "Note", n, {"type": "router"}))

    blocks: list[dict[str, Any]] = []
    meta: dict[str, Any]
    if insufficient and not pack.usable():
        blocks.append({"type": "notice", "text": insufficient})
        meta = {
            "origin": "none",
            "provider": None,
            "model": None,
            "prompt_version": None,
            "validation": {"status": "not_applicable", "problems": []},
            "intent": kind,
        }
        content = insufficient
    elif not pack.usable():
        txt = "I could not compute anything for that question. " + " ".join(notes)
        blocks.append({"type": "notice", "text": txt})
        meta = {
            "origin": "none",
            "provider": None,
            "model": None,
            "prompt_version": None,
            "validation": {"status": "not_applicable", "problems": []},
            "intent": kind,
        }
        content = txt
    else:
        blocks.extend(ctx_blocks)
        out = await narrate(pack, "answer", question)
        n = out["narration"]
        blocks.append(
            {
                "type": "interpretation",
                "origin": out["meta"]["origin"],
                "summary": n["summary"],
                "points": n["points"],
                "next_steps": n["next_steps"],
                "caveats": n["caveats"],
                "provider": out["meta"]["provider"],
                "model": out["meta"]["model"],
                "fallback_reason": out["meta"].get("fallback_reason"),
                "validation": out["meta"]["validation"],
            }
        )
        meta = {**out["meta"], "intent": kind, "analysis_run_ids": [str(r.id) for r in runs_used]}
        content = n["summary"] + "".join(f"\n- {p['text']}" for p in n["points"])
    msg = AIMessage(
        conversation_id=conv.id,
        role="assistant",
        content=content,
        blocks=blocks,
        evidence=[i.public() for i in pack.items],
        meta=meta,
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    return msg


async def explain_run(session: AsyncSession, run: AnalysisRun, dataset_name: str) -> dict[str, Any]:
    pack = ev.EvidencePack()
    pack.extend(
        ev.from_analysis(
            str(run.id),
            run.title,
            run.analysis_type,
            run.result
            or {"metrics": [], "tables": [], "assumptions": [], "warnings": [], "n_used": 0, "n_total": 0},
            limit_rows=8,
        )
    )
    pack.add(
        ev.EvidenceItem(
            "dataset", "Method", run.result["methodology"] if run.result else "", {"type": "methodology"}
        )
    )
    out = await narrate(pack, "explain_analysis")
    run.interpretation = {
        **out["narration"],
        "meta": out["meta"],
        "evidence": [i.public() for i in pack.items],
    }
    await session.commit()
    return run.interpretation


async def summarize_theme(
    session: AsyncSession, theme: QualitativeTheme, total: int, themes_out: dict[str, Any]
) -> dict[str, Any]:
    pack = ev.EvidencePack()
    pack.extend(ev.from_themes([themes_out], theme.column_name, total))
    out = await narrate(pack, "theme_summary")
    n = out["narration"]
    text = n["summary"] + " " + " ".join(p["text"] for p in n["points"])
    theme.summary = {
        "text": text.strip(),
        "origin": "ai" if out["meta"]["origin"] == "llm" else "deterministic",
        "model": out["meta"]["model"],
        "prompt_version": out["meta"]["prompt_version"],
        "validation": out["meta"]["validation"],
        "quotes": (theme.summary or {}).get("quotes", []),
    }
    await session.commit()
    return theme.summary


def settings_summary() -> dict[str, Any]:
    s = get_settings()
    return {
        "provider": s.ai_provider,
        "model": s.ai_model if s.ai_provider != "deterministic" else None,
        "base_url_host": s.ai_base_url.split("//")[-1].split("/")[0]
        if s.ai_provider == "openai_compatible"
        else None,
        "api_key_configured": bool(s.ai_api_key),
        "embedding_provider": s.embedding_provider,
        "external_data_sharing": s.ai_provider != "deterministic",
        "mode": "rule-based (no model, nothing leaves the server)"
        if s.ai_provider == "deterministic"
        else "LLM narration of computed evidence with numeric validation",
    }


_ = MixedMethodRun
