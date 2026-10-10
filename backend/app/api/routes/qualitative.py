from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, Session, StorageDep
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailed
from app.db.models import (
    QualitativeAnnotation,
    QualitativeCode,
    QualitativeSegment,
    QualitativeTheme,
    ThemeSegment,
)
from app.qualitative.text import keyword_pattern
from app.qualitative.themes import top_terms
from app.schemas.common import ERRORS, Page
from app.schemas.core import JobOut
from app.schemas.qualitative import (
    AnnotationCreate,
    AnnotationOut,
    AnnotationReview,
    CodeIn,
    CodeOut,
    CodeUpdate,
    DetectThemesIn,
    PrepareIn,
    SegmentOut,
    SuggestCodesIn,
    ThemeCreate,
    ThemeMerge,
    ThemeOut,
    ThemeSegmentIn,
    ThemeUpdate,
)
from app.services import access
from app.services import datasets as dataset_service
from app.services import qualitative as svc
from app.services.projects import bump_project
from app.workers.runtime import create_job, dispatch

router = APIRouter(tags=["Qualitative"], responses={401: ERRORS[401], 404: ERRORS[404]})


async def _queue(session, user, project_id, type_, params, key=None) -> JobOut:
    j = await create_job(
        session, project_id=project_id, user_id=user.id, type_=type_, params=params, idempotency_key=key
    )
    await session.commit()
    await dispatch(j.id)
    await session.refresh(j)
    return JobOut.model_validate(j)


@router.get(
    "/projects/{project_id}/qualitative/sources",
    summary="Text columns of a dataset version and their preparation status",
)
async def sources(
    project_id: uuid.UUID, dataset_version_id: uuid.UUID, user: CurrentUser, session: Session
) -> list[dict[str, Any]]:
    await access.require_project(session, user, project_id)
    v, _ = await access.version_in_project(session, project_id, dataset_version_id)
    return await svc.text_columns(session, v.id)


@router.post(
    "/projects/{project_id}/qualitative/prepare",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Segment a text column and build its semantic model (async)",
)
async def prepare(project_id: uuid.UUID, body: PrepareIn, user: CurrentUser, session: Session) -> JobOut:
    await access.require_project(session, user, project_id, "EDITOR")
    v, _ = await access.version_in_project(session, project_id, body.dataset_version_id)
    return await _queue(
        session,
        user,
        project_id,
        "prepare_text",
        body.model_dump(mode="json"),
        f"prepare:{v.id}:{body.column}",
    )


@router.post(
    "/projects/{project_id}/qualitative/themes/detect",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Suggest themes by clustering response embeddings (async)",
)
async def detect(project_id: uuid.UUID, body: DetectThemesIn, user: CurrentUser, session: Session) -> JobOut:
    await access.require_project(session, user, project_id, "EDITOR")
    v, _ = await access.version_in_project(session, project_id, body.dataset_version_id)
    return await _queue(
        session,
        user,
        project_id,
        "detect_themes",
        {**body.model_dump(mode="json"), "project_id": str(project_id), "user_id": str(user.id)},
        f"themes:{v.id}:{body.column}:{body.n_themes}",
    )


@router.get(
    "/projects/{project_id}/qualitative/themes",
    summary="Themes for a text column (latest detection run unless run_id is given) + run history",
)
async def list_themes(
    project_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    dataset_version_id: uuid.UUID | None = None,
    column: str | None = None,
    run_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    await access.require_project(session, user, project_id)
    themes, runs = await svc.list_themes(session, project_id, dataset_version_id, column, run_id)
    return {"themes": [ThemeOut.model_validate(t).model_dump(mode="json") for t in themes], "runs": runs}


@router.post(
    "/projects/{project_id}/qualitative/themes",
    response_model=ThemeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a theme manually",
)
async def create_theme(
    project_id: uuid.UUID, body: ThemeCreate, user: CurrentUser, session: Session
) -> ThemeOut:
    await access.require_project(session, user, project_id, "EDITOR")
    v, _ = await access.version_in_project(session, project_id, body.dataset_version_id)
    t = QualitativeTheme(
        project_id=project_id,
        dataset_version_id=v.id,
        column_name=body.column,
        name=body.name.strip(),
        description=body.description,
        keywords=[],
        origin="manual",
        created_by=user.id,
    )
    session.add(t)
    await bump_project(session, project_id)
    await session.commit()
    return ThemeOut.model_validate((await svc.serialize_themes(session, [t]))[0])


@router.post(
    "/projects/{project_id}/qualitative/themes/merge",
    response_model=ThemeOut,
    summary="Merge several themes into one",
)
async def merge(project_id: uuid.UUID, body: ThemeMerge, user: CurrentUser, session: Session) -> ThemeOut:
    await access.require_project(session, user, project_id, "EDITOR")
    t = await svc.merge_themes(session, project_id, user.id, body.theme_ids, body.name)
    return ThemeOut.model_validate((await svc.serialize_themes(session, [t]))[0])


@router.get(
    "/themes/{theme_id}",
    response_model=ThemeOut,
    summary="Theme with its metrics and representative responses",
)
async def get_theme(theme_id: uuid.UUID, user: CurrentUser, session: Session) -> ThemeOut:
    t = await access.get_theme(session, user, theme_id)
    return ThemeOut.model_validate((await svc.serialize_themes(session, [t]))[0])


@router.patch("/themes/{theme_id}", response_model=ThemeOut, summary="Rename / re-describe a theme")
async def update_theme(
    theme_id: uuid.UUID, body: ThemeUpdate, user: CurrentUser, session: Session
) -> ThemeOut:
    t = await access.get_theme(session, user, theme_id, "EDITOR")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(t, k, v.strip())
    await bump_project(session, t.project_id)
    await session.commit()
    return ThemeOut.model_validate((await svc.serialize_themes(session, [t]))[0])


@router.delete(
    "/themes/{theme_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a theme (the underlying responses are untouched)",
)
async def delete_theme(theme_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    t = await access.get_theme(session, user, theme_id, "EDITOR")
    pid = t.project_id
    await session.delete(t)
    await bump_project(session, pid)
    await session.commit()


@router.post(
    "/themes/{theme_id}/segments",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Assign a response to a theme (manual review)",
)
async def add_theme_segment(
    theme_id: uuid.UUID, body: ThemeSegmentIn, user: CurrentUser, session: Session
) -> None:
    t = await access.get_theme(session, user, theme_id, "EDITOR")
    seg = await session.get(QualitativeSegment, body.segment_id)
    if seg is None or seg.dataset_version_id != t.dataset_version_id or seg.column_name != t.column_name:
        raise NotFoundError("Segment not found for this theme's text column.", code="SEGMENT_NOT_FOUND")
    if await session.get(ThemeSegment, (t.id, seg.id)) is None:
        session.add(ThemeSegment(theme_id=t.id, segment_id=seg.id, score=None, source="manual"))
        await bump_project(session, t.project_id)
        await session.commit()


@router.delete(
    "/themes/{theme_id}/segments/{segment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a response from a theme",
)
async def remove_theme_segment(
    theme_id: uuid.UUID, segment_id: uuid.UUID, user: CurrentUser, session: Session
) -> None:
    t = await access.get_theme(session, user, theme_id, "EDITOR")
    ts = await session.get(ThemeSegment, (t.id, segment_id))
    if ts is not None:
        await session.delete(ts)
        await bump_project(session, t.project_id)
        await session.commit()


@router.get(
    "/projects/{project_id}/qualitative/segments",
    response_model=Page[SegmentOut],
    summary="Browse responses with their themes and code annotations",
)
async def segments(
    project_id: uuid.UUID,
    dataset_version_id: uuid.UUID,
    column: str,
    user: CurrentUser,
    session: Session,
    theme_id: uuid.UUID | None = None,
    code_id: uuid.UUID | None = None,
    q: str | None = None,
    unthemed: bool = False,
    review: Annotated[bool, Query(description="Only responses with pending code suggestions")] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
) -> Page[SegmentOut]:
    await access.require_project(session, user, project_id)
    v, _ = await access.version_in_project(session, project_id, dataset_version_id)
    base = select(QualitativeSegment).where(
        QualitativeSegment.dataset_version_id == v.id, QualitativeSegment.column_name == column
    )
    if theme_id:
        await access.get_theme(session, user, theme_id)
        base = base.where(
            QualitativeSegment.id.in_(
                select(ThemeSegment.segment_id).where(ThemeSegment.theme_id == theme_id)
            )
        )
    if code_id:
        base = base.where(
            QualitativeSegment.id.in_(
                select(QualitativeAnnotation.segment_id).where(
                    QualitativeAnnotation.code_id == code_id, QualitativeAnnotation.status == "accepted"
                )
            )
        )
    if review:
        base = base.where(
            QualitativeSegment.id.in_(
                select(QualitativeAnnotation.segment_id).where(QualitativeAnnotation.status == "suggested")
            )
        )
    if unthemed:
        base = base.where(~QualitativeSegment.id.in_(select(ThemeSegment.segment_id)))
    if q:
        esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        base = base.where(QualitativeSegment.text.ilike(f"%{esc}%", escape="\\"))
    total = (await session.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    segs = (
        (
            await session.execute(
                base.order_by(QualitativeSegment.row_index, QualitativeSegment.seg_index)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    ids = [s.id for s in segs]
    th = (
        (
            await session.execute(
                select(ThemeSegment.segment_id, QualitativeTheme.id, QualitativeTheme.name)
                .join(QualitativeTheme, QualitativeTheme.id == ThemeSegment.theme_id)
                .where(ThemeSegment.segment_id.in_(ids))
            )
        ).all()
        if ids
        else []
    )
    an = (
        (
            await session.execute(
                select(QualitativeAnnotation).where(QualitativeAnnotation.segment_id.in_(ids))
            )
        )
        .scalars()
        .all()
        if ids
        else []
    )
    by_theme: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for sid, tid, tname in th:
        by_theme.setdefault(sid, []).append({"id": str(tid), "name": tname})
    by_an: dict[uuid.UUID, list[AnnotationOut]] = {}
    for a in an:
        by_an.setdefault(a.segment_id, []).append(AnnotationOut.model_validate(a))
    return Page(
        items=[
            SegmentOut(
                id=s.id,
                row_index=s.row_index,
                seg_index=s.seg_index,
                text=s.text,
                themes=by_theme.get(s.id, []),
                annotations=by_an.get(s.id, []),
            )
            for s in segs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/projects/{project_id}/qualitative/keywords",
    summary="Most frequent terms (computed counts) in a text column",
)
async def keywords(
    project_id: uuid.UUID,
    dataset_version_id: uuid.UUID,
    column: str,
    user: CurrentUser,
    session: Session,
    limit: Annotated[int, Query(ge=5, le=100)] = 30,
) -> dict[str, Any]:
    await access.require_project(session, user, project_id)
    v, _ = await access.version_in_project(session, project_id, dataset_version_id)
    rows = await svc.load_segments(session, v.id, column, with_vectors=False)
    texts = [r.text for r in rows]
    return {"segments": len(texts), "terms": top_terms(texts, limit)}


@router.get(
    "/projects/{project_id}/qualitative/keyword-count",
    summary="Count responses matching a keyword list (whole-word, `*` suffix wildcard)",
)
async def keyword_count(
    project_id: uuid.UUID,
    dataset_version_id: uuid.UUID,
    column: str,
    terms: str,
    user: CurrentUser,
    session: Session,
) -> dict[str, Any]:
    await access.require_project(session, user, project_id)
    v, _ = await access.version_in_project(session, project_id, dataset_version_id)
    rows = await svc.load_segments(session, v.id, column, with_vectors=False)
    pats = [(t.strip(), keyword_pattern(t)) for t in terms.split(",") if t.strip()][:20]
    out = [
        {
            "term": t,
            "responses": sum(1 for r in rows if p.search(r.text)),
            "pct": round(sum(1 for r in rows if p.search(r.text)) / len(rows) * 100, 2),
        }
        for t, p in pats
    ]
    return {"segments": len(rows), "terms": out}


@router.get(
    "/projects/{project_id}/qualitative/search",
    summary="Semantic search over responses (cosine similarity in pgvector)",
)
async def search(
    project_id: uuid.UUID,
    dataset_version_id: uuid.UUID,
    column: str,
    q: Annotated[str, Query(min_length=2, max_length=300)],
    user: CurrentUser,
    session: Session,
    storage: StorageDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict[str, Any]:
    await access.require_project(session, user, project_id)
    v, _ = await access.version_in_project(session, project_id, dataset_version_id)
    res = await svc.semantic_search(session, storage, v.id, column, q, limit)
    m = (
        await session.execute(
            select(QualitativeSegment.embedding_model)
            .where(QualitativeSegment.dataset_version_id == v.id, QualitativeSegment.column_name == column)
            .limit(1)
        )
    ).scalar_one_or_none()
    return {"query": q, "embedding_model": m, "results": res}


# ------------------------------------------------------------------------------ codes
@router.get(
    "/projects/{project_id}/codes", response_model=list[CodeOut], summary="Codebook with annotation counts"
)
async def list_codes(project_id: uuid.UUID, user: CurrentUser, session: Session) -> list[CodeOut]:
    await access.require_project(session, user, project_id)
    return [CodeOut.model_validate(c) for c in await svc.code_stats(session, project_id)]


@router.post(
    "/projects/{project_id}/codes",
    response_model=CodeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a code",
)
async def create_code(project_id: uuid.UUID, body: CodeIn, user: CurrentUser, session: Session) -> CodeOut:
    await access.require_project(session, user, project_id, "EDITOR")
    c = QualitativeCode(
        project_id=project_id,
        created_by=user.id,
        **{
            **body.model_dump(),
            "name": body.name.strip(),
            "keywords": [k.strip() for k in body.keywords if k.strip()],
        },
    )
    session.add(c)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise ConflictError("A code with this name already exists in the project.", code="CODE_EXISTS") from e
    return CodeOut.model_validate(c)


@router.patch("/codes/{code_id}", response_model=CodeOut, summary="Update a code")
async def update_code(code_id: uuid.UUID, body: CodeUpdate, user: CurrentUser, session: Session) -> CodeOut:
    c = await access.get_code(session, user, code_id, "EDITOR")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(
                c,
                k,
                [x.strip() for x in v if x.strip()]
                if k == "keywords"
                else (v.strip() if isinstance(v, str) else v),
            )
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise ConflictError("A code with this name already exists in the project.", code="CODE_EXISTS") from e
    return CodeOut.model_validate(c)


@router.delete(
    "/codes/{code_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a code and its annotations"
)
async def delete_code(code_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    c = await access.get_code(session, user, code_id, "EDITOR")
    await session.delete(c)
    await session.commit()


@router.post(
    "/segments/{segment_id}/annotations",
    response_model=AnnotationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Apply a code to a response (manual)",
)
async def annotate(
    segment_id: uuid.UUID, body: AnnotationCreate, user: CurrentUser, session: Session
) -> AnnotationOut:
    seg = await access.get_segment(session, user, segment_id, "EDITOR")
    code = await access.get_code(session, user, body.code_id, "EDITOR")
    if code.project_id != seg.project_id:
        raise NotFoundError("Code not found.", code="CODE_NOT_FOUND")
    a = (
        await session.execute(
            select(QualitativeAnnotation).where(
                QualitativeAnnotation.segment_id == seg.id, QualitativeAnnotation.code_id == code.id
            )
        )
    ).scalar_one_or_none()
    if a is None:
        a = QualitativeAnnotation(
            segment_id=seg.id,
            code_id=code.id,
            source="manual",
            status="accepted",
            score=None,
            created_by=user.id,
        )
        session.add(a)
    else:
        a.status, a.created_by = "accepted", user.id
    await bump_project(session, seg.project_id)
    await session.commit()
    return AnnotationOut.model_validate(a)


@router.delete(
    "/segments/{segment_id}/annotations/{code_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a code from a response",
)
async def unannotate(segment_id: uuid.UUID, code_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    seg = await access.get_segment(session, user, segment_id, "EDITOR")
    a = (
        await session.execute(
            select(QualitativeAnnotation).where(
                QualitativeAnnotation.segment_id == seg.id, QualitativeAnnotation.code_id == code_id
            )
        )
    ).scalar_one_or_none()
    if a is not None:
        await session.delete(a)
        await bump_project(session, seg.project_id)
        await session.commit()


@router.post(
    "/projects/{project_id}/qualitative/annotations/review",
    summary="Accept or reject suggested annotations in bulk",
)
async def review_annotations(
    project_id: uuid.UUID, body: AnnotationReview, user: CurrentUser, session: Session
) -> dict[str, int]:
    await access.require_project(session, user, project_id, "EDITOR")
    rows = (
        (
            await session.execute(
                select(QualitativeAnnotation)
                .join(QualitativeCode, QualitativeCode.id == QualitativeAnnotation.code_id)
                .where(
                    QualitativeAnnotation.id.in_(body.annotation_ids),
                    QualitativeCode.project_id == project_id,
                )
            )
        )
        .scalars()
        .all()
    )
    for a in rows:
        a.status, a.created_by = body.status, user.id
    await bump_project(session, project_id)
    await session.commit()
    return {"updated": len(rows)}


@router.post(
    "/projects/{project_id}/qualitative/suggest-codes",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Suggest code annotations (keywords + semantic similarity); nothing is applied until you accept",
)
async def suggest_codes(
    project_id: uuid.UUID, body: SuggestCodesIn, user: CurrentUser, session: Session
) -> JobOut:
    await access.require_project(session, user, project_id, "EDITOR")
    _v, _ = await access.version_in_project(session, project_id, body.dataset_version_id)
    return await _queue(
        session,
        user,
        project_id,
        "suggest_codes",
        {**body.model_dump(mode="json"), "project_id": str(project_id)},
    )


_ = (or_, ValidationFailed, dataset_service)
