from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import evidence as ev
from app.ai.narrator import narrate
from app.analysis import insights as rules
from app.db.models import AnalysisRun, Insight, MixedMethodRun

log = logging.getLogger("lotus.insights")


async def create_for_run(session: AsyncSession, run: AnalysisRun) -> list[Insight]:
    """Derive insights from a completed run (idempotent through the per-project dedupe key)."""
    if run.status != "COMPLETED" or not run.result:
        return []
    created = []
    for c in rules.extract(str(run.id), run.analysis_type, run.config, run.result):
        exists = (
            await session.execute(
                select(Insight.id).where(
                    Insight.project_id == run.project_id, Insight.dedupe_key == c["dedupe"]
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue
        i = Insight(
            project_id=run.project_id,
            analysis_run_id=run.id,
            kind=c["kind"],
            title=c["title"][:300],
            statement=c["statement"],
            evidence=c["evidence"],
            variables=c["variables"],
            qualification=c["qualification"],
            origin="rule",
            dedupe_key=c["dedupe"],
            created_by=run.created_by,
        )
        session.add(i)
        created.append(i)
    await session.flush()
    return created


async def create_for_mixed(session: AsyncSession, run: MixedMethodRun) -> list[Insight]:
    import hashlib

    created = []
    for f in run.result["findings"]:
        key = hashlib.sha256(f"{run.id}|{f['id']}".encode()).hexdigest()[:40]
        if (
            await session.execute(
                select(Insight.id).where(Insight.project_id == run.project_id, Insight.dedupe_key == key)
            )
        ).scalar_one_or_none():
            continue
        nums = f.get("numbers", {})
        evidence = [
            {
                "label": k.replace("_", " "),
                "value": v,
                "metric": None,
                "table": "mixed_findings",
                "unit": None,
            }
            for k, v in nums.items()
        ]
        i = Insight(
            project_id=run.project_id,
            mixed_run_id=run.id,
            kind="mixed" if f["kind"] != "group_prevalence" else "theme",
            title=f"{f['item']}: {f['kind'].replace('_', ' ')}"[:300],
            statement=f["statement"],
            evidence=evidence,
            variables=[run.outcome_column, f.get("column")] if f.get("column") else [run.outcome_column],
            qualification=f["qualification"],
            origin="rule",
            dedupe_key=key,
            created_by=run.created_by,
        )
        session.add(i)
        created.append(i)
    await session.flush()
    return created


def insight_out(i: Insight, run: AnalysisRun | None = None) -> dict[str, Any]:
    return {
        "id": i.id,
        "project_id": i.project_id,
        "analysis_run_id": i.analysis_run_id,
        "mixed_run_id": i.mixed_run_id,
        "kind": i.kind,
        "title": i.title,
        "statement": i.statement,
        "evidence": i.evidence,
        "variables": i.variables,
        "qualification": i.qualification,
        "origin": i.origin,
        "narrative": i.narrative,
        "pinned": i.pinned,
        "created_at": i.created_at,
        "source": (
            {
                "analysis_run_id": str(run.id),
                "analysis_type": run.analysis_type,
                "title": run.title,
                "dataset_version_id": str(run.dataset_version_id),
                "config": run.config,
            }
            if run
            else None
        ),
    }


async def narrate_insight(session: AsyncSession, insight: Insight) -> dict[str, Any]:
    pack = ev.EvidencePack()
    if insight.analysis_run_id:
        run = await session.get(AnalysisRun, insight.analysis_run_id)
        if run and run.result:
            pack.extend(ev.from_analysis(str(run.id), run.title, run.analysis_type, run.result))
    pack.add(
        ev.EvidenceItem(
            "computed",
            f"Insight ({insight.qualification})",
            insight.statement,
            {"type": "insight", "insight_id": str(insight.id)},
        )
    )
    out = await narrate(pack, "insight_narrative")
    insight.narrative = {
        **out["narration"],
        "meta": out["meta"],
        "evidence": [i.public() for i in pack.items],
    }
    await session.commit()
    return insight.narrative


_ = uuid
