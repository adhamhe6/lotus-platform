from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import CurrentUser, Session, StorageDep, ai_rate_limit
from app.core.exceptions import NotFoundError
from app.db.models import AIConversation, AIMessage, Dataset, DatasetVersion, QualitativeTheme
from app.schemas.ai import ConversationCreate, ConversationDetail, ConversationOut, MessageIn, MessageOut
from app.schemas.analysis import AnalysisDetail
from app.schemas.common import ERRORS
from app.services import access
from app.services import ai as svc
from app.services import datasets as dataset_service
from app.services import qualitative as qual_service
from app.services.projects import bump_project

router = APIRouter(tags=["AI assistant"], responses={401: ERRORS[401], 404: ERRORS[404]})


@router.get("/ai/status", summary="Which AI mode is active (no secrets are ever returned)")
async def ai_status(user: CurrentUser) -> dict[str, Any]:
    return svc.settings_summary()


@router.post(
    "/projects/{project_id}/ai/conversations",
    response_model=ConversationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Start a conversation about a dataset version",
)
async def create_conversation(
    project_id: uuid.UUID, body: ConversationCreate, user: CurrentUser, session: Session
) -> ConversationOut:
    await access.require_project(session, user, project_id)
    if body.dataset_version_id:
        await access.version_in_project(session, project_id, body.dataset_version_id)
    c = AIConversation(
        project_id=project_id,
        user_id=user.id,
        dataset_version_id=body.dataset_version_id,
        title=(body.title or "New conversation")[:200],
    )
    session.add(c)
    await session.commit()
    return ConversationOut.model_validate(c)


@router.get(
    "/projects/{project_id}/ai/conversations",
    response_model=list[ConversationOut],
    summary="Your conversations in this project",
)
async def list_conversations(
    project_id: uuid.UUID, user: CurrentUser, session: Session
) -> list[ConversationOut]:
    await access.require_project(session, user, project_id)
    rows = (
        (
            await session.execute(
                select(AIConversation)
                .where(AIConversation.project_id == project_id, AIConversation.user_id == user.id)
                .order_by(AIConversation.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [ConversationOut.model_validate(c) for c in rows]


@router.get(
    "/ai/conversations/{conversation_id}",
    response_model=ConversationDetail,
    summary="Conversation with messages, evidence and provenance blocks",
)
async def get_conversation(
    conversation_id: uuid.UUID, user: CurrentUser, session: Session
) -> ConversationDetail:
    c = await access.get_conversation(session, user, conversation_id)
    msgs = (
        (
            await session.execute(
                select(AIMessage).where(AIMessage.conversation_id == c.id).order_by(AIMessage.created_at)
            )
        )
        .scalars()
        .all()
    )
    return ConversationDetail(
        **ConversationOut.model_validate(c).model_dump(),
        messages=[MessageOut.model_validate(m) for m in msgs],
    )


@router.delete(
    "/ai/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a conversation",
)
async def delete_conversation(conversation_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    c = await access.get_conversation(session, user, conversation_id)
    await session.delete(c)
    await session.commit()


@router.post(
    "/ai/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
    dependencies=[Depends(ai_rate_limit)],
    status_code=status.HTTP_201_CREATED,
    summary="Ask a question; the answer is computed from the project's data and then interpreted",
)
async def ask(
    conversation_id: uuid.UUID, body: MessageIn, user: CurrentUser, session: Session, storage: StorageDep
) -> list[MessageOut]:
    """Pipeline: route the question → run (or reuse) the right analysis → build an evidence pack → narrate → validate numbers.
    Each assistant message carries typed blocks: `computed`, `qualitative`, `mixed`, `interpretation` (origin `llm` or `rule`), `notice`."""
    conv = await access.get_conversation(session, user, conversation_id)
    await access.require_project(session, user, conv.project_id, "EDITOR")
    version = None
    if conv.dataset_version_id:
        version = await session.get(DatasetVersion, conv.dataset_version_id)
    if version is None:
        ds = (
            await session.execute(
                select(Dataset)
                .where(Dataset.project_id == conv.project_id, Dataset.status == "READY")
                .order_by(Dataset.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        version = await dataset_service.latest_version(session, ds.id) if ds else None
        if version is None:
            raise NotFoundError("Upload a dataset before asking questions about it.", code="NO_DATASET")
        conv.dataset_version_id = version.id
    ds = await session.get(Dataset, version.dataset_id)
    assert ds is not None
    user_msg = AIMessage(
        conversation_id=conv.id, role="user", content=body.content.strip(), blocks=[], evidence=[], meta={}
    )
    session.add(user_msg)
    if conv.title == "New conversation":
        conv.title = body.content.strip()[:80]
    await session.commit()
    reply = await svc.answer(
        session, storage, user, conv.project_id, conv, version, ds.name, body.content.strip()
    )
    await bump_project(session, conv.project_id)
    await session.commit()
    return [MessageOut.model_validate(user_msg), MessageOut.model_validate(reply)]


@router.post(
    "/analyses/{analysis_id}/explain",
    dependencies=[Depends(ai_rate_limit)],
    summary="Explain a stored analysis in plain language (AI or rule-based; stored apart from the result)",
)
async def explain(analysis_id: uuid.UUID, user: CurrentUser, session: Session) -> dict[str, Any]:
    run = await access.get_run(session, user, analysis_id, "EDITOR")
    v = await session.get(DatasetVersion, run.dataset_version_id)
    ds = await session.get(Dataset, v.dataset_id) if v else None
    if run.status != "COMPLETED":
        raise NotFoundError("Only completed analyses can be explained.", code="ANALYSIS_NOT_COMPLETED")
    return await svc.explain_run(session, run, ds.name if ds else "dataset")


@router.post(
    "/themes/{theme_id}/summarize",
    dependencies=[Depends(ai_rate_limit)],
    summary="Write a theme summary from its computed profile (AI or rule-based, labelled)",
)
async def summarize_theme(theme_id: uuid.UUID, user: CurrentUser, session: Session) -> dict[str, Any]:
    t = await access.get_theme(session, user, theme_id, "EDITOR")
    out = (await qual_service.serialize_themes(session, [t]))[0]
    from sqlalchemy import func

    from app.db.models import QualitativeSegment

    total = (
        await session.execute(
            select(func.count(func.distinct(QualitativeSegment.row_index))).where(
                QualitativeSegment.dataset_version_id == t.dataset_version_id,
                QualitativeSegment.column_name == t.column_name,
            )
        )
    ).scalar_one()
    return await svc.summarize_theme(session, t, total, {**out, "id": str(out["id"])})


@router.get(
    "/datasets/{dataset_id}/suggestions",
    summary="Suggested analyses generated from this dataset's schema and a preliminary data scan",
)
async def suggestions(
    dataset_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    storage: StorageDep,
    version_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    ds = await access.get_dataset(session, user, dataset_id)
    v = (
        await dataset_service.latest_version(session, ds.id)
        if version_id is None
        else await session.get(DatasetVersion, version_id)
    )
    if v is None or v.dataset_id != ds.id:
        raise NotFoundError("Dataset version not found.", code="DATASET_VERSION_NOT_FOUND")
    return await svc.suggestions_for(session, storage, v)


_ = (AnalysisDetail, QualitativeTheme, bump_project)
