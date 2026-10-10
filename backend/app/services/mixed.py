from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import evidence as ev
from app.ai.narrator import narrate
from app.core.exceptions import InsufficientDataError, NotFoundError, ValidationFailed
from app.datasets.storage import Storage
from app.db.models import (
    DatasetVersion,
    MixedMethodRun,
    QualitativeAnnotation,
    QualitativeCode,
    QualitativeSegment,
    QualitativeTheme,
    ThemeSegment,
)
from app.mixed import engine
from app.services import datasets as dataset_service
from app.services import insights as insight_service
from app.services import qualitative as q
from app.services.projects import bump_project

NUMERIC = {"numeric_continuous", "numeric_discrete", "binary"}


async def run_mixed(
    session: AsyncSession,
    storage: Storage,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    version: DatasetVersion,
    text_column: str,
    outcome: str,
    group: str | None,
    compare: list[str] | None,
    source: str,
    theme_run_id: uuid.UUID | None,
) -> MixedMethodRun:
    cols = {c.name: c for c in await dataset_service.version_columns(session, version.id)}
    for name in [outcome, *([group] if group else []), *(compare or [])]:
        if name not in cols:
            raise ValidationFailed(f"Unknown column '{name}'.", code="UNKNOWN_COLUMN")
    if cols[outcome].semantic_type not in NUMERIC:
        raise ValidationFailed(
            f"The outcome '{outcome}' must be numeric (it is {cols[outcome].semantic_type.replace('_', ' ')}).",
            code="INVALID_ANALYSIS_CONFIGURATION",
        )
    if group and cols[group].semantic_type not in ("categorical", "boolean", "binary", "numeric_discrete"):
        raise ValidationFailed(
            f"The grouping variable '{group}' must be categorical.", code="INVALID_ANALYSIS_CONFIGURATION"
        )
    if compare is None:
        compare = [
            n
            for n, c in cols.items()
            if n != outcome
            and c.semantic_type in ("numeric_continuous", "numeric_discrete")
            and c.missing_pct < 40
        ][:8]
    compare = [c for c in compare if c != outcome]
    for c in compare:
        if cols[c].semantic_type not in NUMERIC:
            raise ValidationFailed(
                f"Comparison variable '{c}' must be numeric.", code="INVALID_ANALYSIS_CONFIGURATION"
            )
    segs = await q.load_segments(session, version.id, text_column, with_vectors=False)
    seg_row = {s.id: s.row_index for s in segs}
    respondents = set(seg_row.values())
    items: list[engine.Item] = []
    if source == "themes":
        themes, _runs = await q.list_themes(session, project_id, version.id, text_column, theme_run_id)
        if not themes:
            raise NotFoundError(
                "No themes exist for this text column yet. Detect themes first.", code="NO_THEMES"
            )
        for t in themes:
            rows = (
                (
                    await session.execute(
                        select(ThemeSegment.segment_id).where(ThemeSegment.theme_id == t["id"])
                    )
                )
                .scalars()
                .all()
            )
            items.append(
                engine.Item(
                    str(t["id"]),
                    t["name"],
                    "theme",
                    {seg_row[i] for i in rows if i in seg_row},
                    [e["text"] for e in t["examples"][:2]],
                )
            )
        snapshot = [
            {
                "id": str(t["id"]),
                "name": t["name"],
                "responses": t["response_count"],
                "run_id": str(t["run_id"]) if t["run_id"] else None,
            }
            for t in themes
        ]
    else:
        codes = (
            (await session.execute(select(QualitativeCode).where(QualitativeCode.project_id == project_id)))
            .scalars()
            .all()
        )
        for code in codes:
            ann = (
                (
                    await session.execute(
                        select(QualitativeAnnotation.segment_id).where(
                            QualitativeAnnotation.code_id == code.id,
                            QualitativeAnnotation.status == "accepted",
                        )
                    )
                )
                .scalars()
                .all()
            )
            code_rows = {seg_row[i] for i in ann if i in seg_row}
            if code_rows:
                texts = {s.row_index: s.text for s in segs}
                items.append(
                    engine.Item(
                        str(code.id), code.name, "code", code_rows, [texts[r] for r in sorted(code_rows)[:2]]
                    )
                )
        if not items:
            raise NotFoundError(
                "No accepted code annotations exist for this text column yet.", code="NO_CODES"
            )
        snapshot = [{"id": i.id, "name": i.name, "responses": len(i.rows)} for i in items]
    cfg = {
        "text_column": text_column,
        "outcome": outcome,
        "group": group,
        "compare": compare,
        "source": source,
        "theme_run_id": str(theme_run_id) if theme_run_id else None,
        "items": sorted((s["id"], s["responses"]) for s in snapshot),
        "version": str(version.id),
    }
    h = engine.config_hash(cfg)
    existing = (
        await session.execute(
            select(MixedMethodRun).where(
                MixedMethodRun.dataset_version_id == version.id, MixedMethodRun.config_hash == h
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    frame = await dataset_service.load_frame(
        storage, version, list(dict.fromkeys([outcome, *compare, *([group] if group else [])]))
    )
    try:
        result = await asyncio.to_thread(engine.run_mixed, frame, respondents, items, outcome, compare, group)
    except ValueError as e:
        raise InsufficientDataError(
            f"Too few respondents with written responses ({len(respondents)}) for a mixed-methods comparison (at least {2 * engine.MIN_GROUP} needed)."
        ) from e
    from app.datasets.jsonable import to_jsonable

    run = MixedMethodRun(
        project_id=project_id,
        dataset_version_id=version.id,
        column_name=text_column,
        outcome_column=outcome,
        group_column=group,
        config=cfg,
        config_hash=h,
        theme_snapshot=snapshot,
        result=to_jsonable(result),
        created_by=user_id,
    )
    session.add(run)
    await session.flush()
    await insight_service.create_for_mixed(session, run)
    await bump_project(session, project_id)
    await session.commit()
    return run


async def synthesize(session: AsyncSession, run: MixedMethodRun) -> dict[str, Any]:
    pack = ev.EvidencePack()
    pack.extend(ev.from_mixed(str(run.id), run.result))
    for it in run.result["items"][:5]:
        if it["quotes"]:
            pack.add(
                ev.EvidenceItem(
                    "qualitative",
                    f"Representative response — {it['name']}",
                    f"“{it['quotes'][0][:200]}”",
                    {"type": "quote", "item": it["name"]},
                )
            )
    out = await narrate(pack, "mixed_synthesis")
    run.synthesis = {**out["narration"], "meta": out["meta"], "evidence": [i.public() for i in pack.items]}
    await session.commit()
    return run.synthesis


_ = (pd, QualitativeSegment, QualitativeTheme)
