"""Qualitative use-cases: segments + embeddings, themes (human-editable), codebook annotations, keyword/semantic search."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

import numpy as np
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ConflictError, InsufficientDataError, NotFoundError, ValidationFailed
from app.datasets.storage import Storage
from app.db.models import (
    DatasetVersion,
    QualitativeAnnotation,
    QualitativeCode,
    QualitativeSegment,
    QualitativeTheme,
    ThemeDetectionRun,
    ThemeSegment,
)
from app.qualitative import embeddings as emb
from app.qualitative import themes as themes_engine
from app.qualitative.text import keyword_pattern, make_segments
from app.services import datasets as dataset_service
from app.services.projects import bump_project

log = logging.getLogger("lotus.qualitative")
AUTO_SPLIT_AT_CHARS = 600


def model_path(storage: Storage, version_id: uuid.UUID, column: str):
    return storage.model_path(f"{version_id.hex}-{hashlib.sha1(column.encode()).hexdigest()[:10]}")


async def text_columns(session: AsyncSession, version_id: uuid.UUID) -> list[dict[str, Any]]:
    cols = await dataset_service.version_columns(session, version_id)
    out = []
    for c in cols:
        if c.semantic_type == "text":
            n = (
                await session.execute(
                    select(func.count())
                    .select_from(QualitativeSegment)
                    .where(
                        QualitativeSegment.dataset_version_id == version_id,
                        QualitativeSegment.column_name == c.name,
                    )
                )
            ).scalar_one()
            runs = (
                await session.execute(
                    select(func.count())
                    .select_from(ThemeDetectionRun)
                    .where(
                        ThemeDetectionRun.dataset_version_id == version_id,
                        ThemeDetectionRun.column_name == c.name,
                    )
                )
            ).scalar_one()
            out.append(
                {
                    "column": c.name,
                    "avg_words": c.profile.get("avg_words"),
                    "non_empty": c.profile.get("count"),
                    "segments": n,
                    "theme_runs": runs,
                }
            )
    return out


async def prepare_segments(
    session: AsyncSession, storage: Storage, version: DatasetVersion, column: str, split: str, stage
) -> dict[str, Any]:
    settings = get_settings()
    cols = {c.name: c for c in await dataset_service.version_columns(session, version.id)}
    if column not in cols:
        raise ValidationFailed(f"Unknown column '{column}'.", code="UNKNOWN_COLUMN")
    if cols[column].semantic_type not in ("text", "categorical", "identifier"):
        raise ValidationFailed(
            f"'{column}' is {cols[column].semantic_type.replace('_', ' ')}; choose a text column.",
            code="NOT_A_TEXT_COLUMN",
        )
    existing = (
        await session.execute(
            select(func.count(), func.min(QualitativeSegment.embedding_model)).where(
                QualitativeSegment.dataset_version_id == version.id, QualitativeSegment.column_name == column
            )
        )
    ).one()
    if existing[0] > 0:
        await stage("Segments already prepared")
        return {"segments": existing[0], "embedding_model": existing[1], "created": False}
    await stage("Loading text responses")
    df = await dataset_service.load_frame(storage, version, [column])
    s = df[column].astype("string")
    lens = s.dropna().str.len()
    if split == "auto":
        from app.qualitative.text import split_sentences

        sample = [str(t) for t in s.dropna().tolist()[:2000] if str(t).strip()]
        per_resp = sum(len(split_sentences(t)) for t in sample) / max(len(sample), 1)
        split = (
            "sentences"
            if (len(lens) and float(lens.mean()) > AUTO_SPLIT_AT_CHARS) or per_resp >= 1.3
            else "none"
        )
    segs: list[tuple[int, int, str]] = []
    for i, t in enumerate(s.tolist()):
        if t is None or (isinstance(t, float)) or str(t) in ("<NA>",) or str(t).strip() == "":
            continue
        for j, piece in enumerate(make_segments(str(t), split)):
            segs.append((i, j, piece))
    if len(segs) < 5:
        raise InsufficientDataError(
            f"Only {len(segs)} non-empty text responses were found in '{column}'; at least 5 are needed."
        )
    await stage("Building the semantic model")
    embedder = emb.new_embedder(settings.embedding_provider, settings.embedding_model)
    vectors = await asyncio.to_thread(embedder.fit_transform, [t for _, _, t in segs])
    embedder.save(model_path(storage, version.id, column))
    await stage("Saving segments and embeddings")
    rows = [
        {
            "id": uuid.uuid4(),
            "project_id": None,
            "dataset_version_id": version.id,
            "column_name": column,
            "row_index": r,
            "seg_index": j,
            "text": t,
            "embedding": vectors[k].astype(float).tolist(),
            "embedding_model": embedder.model_id,
        }
        for k, (r, j, t) in enumerate(segs)
    ]
    from app.db.models import Dataset

    ds = await session.get(Dataset, version.dataset_id)
    assert ds is not None
    for r in rows:
        r["project_id"] = ds.project_id
    for i in range(0, len(rows), 1000):
        await session.execute(insert(QualitativeSegment), rows[i : i + 1000])
    await bump_project(session, ds.project_id)
    await session.commit()
    return {"segments": len(rows), "embedding_model": embedder.model_id, "created": True, "split": split}


async def load_segments(session: AsyncSession, version_id: uuid.UUID, column: str, with_vectors: bool = True):
    cols = [
        QualitativeSegment.id,
        QualitativeSegment.row_index,
        QualitativeSegment.seg_index,
        QualitativeSegment.text,
    ]
    if with_vectors:
        cols.append(QualitativeSegment.embedding)
    rows = (
        await session.execute(
            select(*cols)
            .where(
                QualitativeSegment.dataset_version_id == version_id, QualitativeSegment.column_name == column
            )
            .order_by(QualitativeSegment.row_index, QualitativeSegment.seg_index)
        )
    ).all()
    if not rows:
        raise NotFoundError(
            "No text segments are prepared for this column yet. Run 'Prepare text' first.",
            code="SEGMENTS_NOT_PREPARED",
        )
    return rows


def _deterministic_summary(
    name: str, n_seg: int, n_total: int, terms: list[str], quotes: list[str]
) -> dict[str, Any]:
    pct = n_seg / n_total * 100 if n_total else 0
    t = f"{n_seg} of {n_total} responses ({pct:.1f}%) fall in this cluster. Distinguishing vocabulary: {', '.join(terms[:5]) or 'n/a'}."
    return {"text": t, "origin": "deterministic", "quotes": quotes[:2]}


async def detect_themes(
    session: AsyncSession,
    version: DatasetVersion,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    column: str,
    k: int | None,
    stage,
) -> uuid.UUID:
    await stage("Loading segments")
    rows = await load_segments(session, version.id, column)
    model_id = (
        await session.execute(
            select(QualitativeSegment.embedding_model)
            .where(
                QualitativeSegment.dataset_version_id == version.id, QualitativeSegment.column_name == column
            )
            .limit(1)
        )
    ).scalar_one()
    params = {
        "column": column,
        "k": k or "auto",
        "embedding_model": model_id,
        "n_segments": len(rows),
        "algorithm": "kmeans+c-tfidf",
        "seed": 20260101,
    }
    phash = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    run = (
        await session.execute(
            select(ThemeDetectionRun).where(
                ThemeDetectionRun.dataset_version_id == version.id,
                ThemeDetectionRun.column_name == column,
                ThemeDetectionRun.params_hash == phash,
            )
        )
    ).scalar_one_or_none()
    if run:  # idempotent
        return run.id
    texts = [r.text for r in rows]
    vectors = np.array([np.asarray(r.embedding, dtype=float) for r in rows])
    await stage("Clustering responses")
    result = await asyncio.to_thread(themes_engine.detect_themes, texts, vectors, k)
    await stage("Labelling themes and selecting representative quotes")
    run = ThemeDetectionRun(
        project_id=project_id,
        dataset_version_id=version.id,
        column_name=column,
        params=params,
        params_hash=phash,
        embedding_model=model_id,
        stats={
            "k": result.k,
            "silhouette": result.silhouette,
            "unassigned": len(result.unassigned),
            "candidates": result.candidates,
            "segments": len(rows),
        },
        created_by=user_id,
    )
    session.add(run)
    await session.flush()
    for t in result.themes:
        theme = QualitativeTheme(
            project_id=project_id,
            run_id=run.id,
            dataset_version_id=version.id,
            column_name=column,
            name=t.name,
            description="",
            keywords=t.terms,
            origin="auto",
            position=t.index,
            created_by=None,
            summary=_deterministic_summary(
                t.name, t.size, len(rows), t.terms, [texts[i] for i in t.representatives]
            ),
        )
        session.add(theme)
        await session.flush()
        await session.execute(
            insert(ThemeSegment),
            [
                {"theme_id": theme.id, "segment_id": rows[i].id, "score": sc, "source": "auto"}
                for i, sc in zip(t.segment_idx, t.scores, strict=True)
            ],
        )
    await stage("Saving themes")
    await bump_project(session, project_id)
    await session.commit()
    return run.id


async def serialize_themes(session: AsyncSession, themes: list[QualitativeTheme]) -> list[dict[str, Any]]:
    if not themes:
        return []
    ids = [t.id for t in themes]
    counts = dict(
        (
            await session.execute(
                select(ThemeSegment.theme_id, func.count())
                .where(ThemeSegment.theme_id.in_(ids))
                .group_by(ThemeSegment.theme_id)
            )
        ).all()
    )
    resp = dict(
        (
            await session.execute(
                select(ThemeSegment.theme_id, func.count(func.distinct(QualitativeSegment.row_index)))
                .join(QualitativeSegment, QualitativeSegment.id == ThemeSegment.segment_id)
                .where(ThemeSegment.theme_id.in_(ids))
                .group_by(ThemeSegment.theme_id)
            )
        ).all()
    )
    totals: dict[tuple[uuid.UUID, str], int] = {}
    for t in themes:
        key = (t.dataset_version_id, t.column_name)
        if key not in totals:
            totals[key] = (
                await session.execute(
                    select(func.count(func.distinct(QualitativeSegment.row_index))).where(
                        QualitativeSegment.dataset_version_id == t.dataset_version_id,
                        QualitativeSegment.column_name == t.column_name,
                    )
                )
            ).scalar_one()
    out = []
    for t in themes:
        ex = (
            await session.execute(
                select(
                    QualitativeSegment.id,
                    QualitativeSegment.text,
                    QualitativeSegment.row_index,
                    ThemeSegment.score,
                )
                .join(ThemeSegment, ThemeSegment.segment_id == QualitativeSegment.id)
                .where(ThemeSegment.theme_id == t.id)
                .order_by(ThemeSegment.score.desc().nulls_last())
                .limit(3)
            )
        ).all()
        total = totals[(t.dataset_version_id, t.column_name)] or 1
        out.append(
            {
                "id": t.id,
                "project_id": t.project_id,
                "run_id": t.run_id,
                "dataset_version_id": t.dataset_version_id,
                "column_name": t.column_name,
                "name": t.name,
                "description": t.description,
                "keywords": t.keywords,
                "summary": t.summary,
                "origin": t.origin,
                "position": t.position,
                "segment_count": counts.get(t.id, 0),
                "response_count": resp.get(t.id, 0),
                "share_pct": round(resp.get(t.id, 0) / total * 100, 2),
                "examples": [
                    {"segment_id": str(e[0]), "text": e[1], "row_index": e[2], "score": e[3]} for e in ex
                ],
                "created_at": t.created_at,
            }
        )
    return out


async def list_themes(
    session: AsyncSession,
    project_id: uuid.UUID,
    version_id: uuid.UUID | None,
    column: str | None,
    run_id: uuid.UUID | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    q = select(QualitativeTheme).where(QualitativeTheme.project_id == project_id)
    if version_id:
        q = q.where(QualitativeTheme.dataset_version_id == version_id)
    if column:
        q = q.where(QualitativeTheme.column_name == column)
    runs_q = select(ThemeDetectionRun).where(ThemeDetectionRun.project_id == project_id)
    if version_id:
        runs_q = runs_q.where(ThemeDetectionRun.dataset_version_id == version_id)
    if column:
        runs_q = runs_q.where(ThemeDetectionRun.column_name == column)
    runs = (await session.execute(runs_q.order_by(ThemeDetectionRun.created_at.desc()))).scalars().all()
    chosen = run_id or (runs[0].id if runs else None)
    manual_q = (
        q.where((QualitativeTheme.run_id == chosen) | (QualitativeTheme.run_id.is_(None)))
        if chosen
        else q.where(QualitativeTheme.run_id.is_(None))
    )
    themes = (
        (await session.execute(manual_q.order_by(QualitativeTheme.position, QualitativeTheme.created_at)))
        .scalars()
        .all()
    )
    themes_out = await serialize_themes(session, list(themes))
    themes_out.sort(key=lambda t: -t["segment_count"])
    return themes_out, [
        {
            "id": str(r.id),
            "created_at": r.created_at.isoformat(),
            "k": r.stats.get("k"),
            "silhouette": r.stats.get("silhouette"),
            "embedding_model": r.embedding_model,
            "unassigned": r.stats.get("unassigned"),
            "params": r.params,
        }
        for r in runs
    ]


async def merge_themes(
    session: AsyncSession,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    theme_ids: list[uuid.UUID],
    name: str | None,
) -> QualitativeTheme:
    themes = (
        (
            await session.execute(
                select(QualitativeTheme).where(
                    QualitativeTheme.id.in_(theme_ids), QualitativeTheme.project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    if len(themes) != len(set(theme_ids)):
        raise NotFoundError("One or more themes were not found in this project.", code="THEME_NOT_FOUND")
    if len({(t.dataset_version_id, t.column_name) for t in themes}) != 1:
        raise ConflictError(
            "Only themes from the same text column can be merged.", code="THEME_MERGE_MISMATCH"
        )
    sizes = dict(
        (
            await session.execute(
                select(ThemeSegment.theme_id, func.count())
                .where(ThemeSegment.theme_id.in_([t.id for t in themes]))
                .group_by(ThemeSegment.theme_id)
            )
        ).all()
    )
    themes = sorted(themes, key=lambda t: -sizes.get(t.id, 0))
    target = themes[0]
    target_name = name or " + ".join(t.name for t in themes)[:160]
    for t in themes[1:]:
        segs = (
            (await session.execute(select(ThemeSegment).where(ThemeSegment.theme_id == t.id))).scalars().all()
        )
        existing = set(
            (await session.execute(select(ThemeSegment.segment_id).where(ThemeSegment.theme_id == target.id)))
            .scalars()
            .all()
        )
        for s in segs:
            if s.segment_id not in existing:
                session.add(
                    ThemeSegment(theme_id=target.id, segment_id=s.segment_id, score=s.score, source=s.source)
                )
        target.keywords = list(dict.fromkeys([*target.keywords, *t.keywords]))[:10]
        await session.flush()
        await session.delete(t)
    target.name, target.origin = target_name, "merged"
    target.summary = {
        **(target.summary or {}),
        "text": f"Merged from {len(themes)} themes by the researcher.",
        "origin": "deterministic",
    }
    await bump_project(session, project_id)
    await session.commit()
    return target


# ------------------------------------------------------------------------------ coding
async def code_stats(session: AsyncSession, project_id: uuid.UUID) -> list[dict[str, Any]]:
    codes = (
        (
            await session.execute(
                select(QualitativeCode)
                .where(QualitativeCode.project_id == project_id)
                .order_by(QualitativeCode.name)
            )
        )
        .scalars()
        .all()
    )
    rows = (
        await session.execute(
            select(QualitativeAnnotation.code_id, QualitativeAnnotation.status, func.count())
            .join(QualitativeCode, QualitativeCode.id == QualitativeAnnotation.code_id)
            .where(QualitativeCode.project_id == project_id)
            .group_by(QualitativeAnnotation.code_id, QualitativeAnnotation.status)
        )
    ).all()
    cnt: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
    for cid, st, n in rows:
        cnt[cid][st] = n
    return [
        {
            "id": c.id,
            "project_id": c.project_id,
            "name": c.name,
            "description": c.description,
            "color": c.color,
            "category": c.category,
            "keywords": c.keywords,
            "created_at": c.created_at,
            "accepted_count": cnt[c.id].get("accepted", 0),
            "suggested_count": cnt[c.id].get("suggested", 0),
        }
        for c in codes
    ]


async def suggest_codes(
    session: AsyncSession,
    project_id: uuid.UUID,
    version: DatasetVersion,
    column: str,
    threshold: float,
    use_semantic: bool,
    stage,
) -> dict[str, int]:
    await stage("Loading segments and codebook")
    segs = await load_segments(session, version.id, column)
    codes = (
        (await session.execute(select(QualitativeCode).where(QualitativeCode.project_id == project_id)))
        .scalars()
        .all()
    )
    if not codes:
        raise ValidationFailed(
            "Create at least one code first (with keywords for automatic suggestions).", code="NO_CODES"
        )
    existing = {
        (a.segment_id, a.code_id)
        for a in (
            await session.execute(
                select(QualitativeAnnotation).where(
                    QualitativeAnnotation.segment_id.in_([s.id for s in segs])
                )
            )
        ).scalars()
    }
    new: list[dict[str, Any]] = []
    kw_count = sem_count = 0
    await stage("Matching code keywords")
    for code in codes:
        pats = [keyword_pattern(k) for k in code.keywords if str(k).strip()]
        if not pats:
            continue
        for s in segs:
            if (s.id, code.id) in existing:
                continue
            hits = sum(1 for p in pats if p.search(s.text))
            if hits:
                new.append(
                    {
                        "id": uuid.uuid4(),
                        "segment_id": s.id,
                        "code_id": code.id,
                        "source": "keyword",
                        "status": "suggested",
                        "score": min(1.0, hits / max(len(pats), 1) + 0.5 * (hits > 0)),
                        "created_by": None,
                    }
                )
                existing.add((s.id, code.id))
                kw_count += 1
    if use_semantic:
        await stage("Finding semantically similar segments")
        vec = {s.id: np.asarray(s.embedding, dtype=float) for s in segs}
        for code in codes:
            accepted = (
                (
                    await session.execute(
                        select(QualitativeAnnotation.segment_id).where(
                            QualitativeAnnotation.code_id == code.id,
                            QualitativeAnnotation.status == "accepted",
                            QualitativeAnnotation.segment_id.in_(list(vec)),
                        )
                    )
                )
                .scalars()
                .all()
            )
            if len(accepted) < 3:
                continue
            centroid = np.mean([vec[i] for i in accepted], axis=0)
            centroid = centroid / (np.linalg.norm(centroid) or 1)
            for s in segs:
                if (s.id, code.id) in existing:
                    continue
                sim = float(vec[s.id] @ centroid)
                if sim >= threshold:
                    new.append(
                        {
                            "id": uuid.uuid4(),
                            "segment_id": s.id,
                            "code_id": code.id,
                            "source": "semantic",
                            "status": "suggested",
                            "score": sim,
                            "created_by": None,
                        }
                    )
                    existing.add((s.id, code.id))
                    sem_count += 1
    await stage("Saving suggestions")
    for i in range(0, len(new), 1000):
        await session.execute(insert(QualitativeAnnotation), new[i : i + 1000])
    await bump_project(session, project_id)
    await session.commit()
    return {"keyword_suggestions": kw_count, "semantic_suggestions": sem_count}


async def semantic_search(
    session: AsyncSession, storage: Storage, version_id: uuid.UUID, column: str, query: str, limit: int
) -> list[dict[str, Any]]:
    settings = get_settings()
    path = model_path(storage, version_id, column)
    if not path.exists():
        raise NotFoundError(
            "No semantic model exists for this column. Run 'Prepare text' first.",
            code="SEGMENTS_NOT_PREPARED",
        )
    embedder = await asyncio.to_thread(
        emb.load_embedder, path, settings.embedding_provider, settings.embedding_model
    )
    q = (await asyncio.to_thread(embedder.transform, [query]))[0]
    dist = QualitativeSegment.embedding.cosine_distance(q.astype(float).tolist())
    rows = (
        await session.execute(
            select(
                QualitativeSegment.id, QualitativeSegment.row_index, QualitativeSegment.text, dist.label("d")
            )
            .where(
                QualitativeSegment.dataset_version_id == version_id, QualitativeSegment.column_name == column
            )
            .order_by(dist)
            .limit(limit)
        )
    ).all()
    if float(np.linalg.norm(q)) == 0:
        return []  # the query has no vocabulary in common with the corpus
    return [
        {
            "segment_id": str(r.id),
            "row_index": r.row_index,
            "text": r.text,
            "similarity": round(1 - float(r.d), 4),
        }
        for r in rows
        if 1 - float(r.d) > 0.05
    ]


def _unused() -> tuple:
    return delete, update
