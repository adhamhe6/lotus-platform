from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, Session, StorageDep
from app.schemas.common import ERRORS
from app.schemas.core import MemberIn, MemberOut, MemberUpdate, ProjectCreate, ProjectOut, ProjectUpdate
from app.services import access
from app.services import datasets as dataset_service
from app.services import projects as project_service
from app.db.models import Dataset
from sqlalchemy import select

router = APIRouter(prefix="/projects", tags=["Projects"], responses={401: ERRORS[401], 404: ERRORS[404]})


@router.get("", response_model=list[ProjectOut], summary="List the projects you can access")
async def list_projects(user: CurrentUser, session: Session) -> list[ProjectOut]:
    return await project_service.list_projects(session, user)


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED, summary="Create a project")
async def create_project(body: ProjectCreate, user: CurrentUser, session: Session) -> ProjectOut:
    p = await project_service.create_project(session, user, body.name, body.description, body.objective)
    return ProjectOut.model_validate(p).model_copy(update={"role": "OWNER"})


@router.get("/{project_id}", response_model=ProjectOut, summary="Get a project")
async def get_project(project_id: uuid.UUID, user: CurrentUser, session: Session) -> ProjectOut:
    p, role = await access.require_project(session, user, project_id)
    counts = (await project_service.project_counts(session, [p.id]))[p.id]
    return ProjectOut.model_validate(p).model_copy(update={"role": role, "counts": counts})


@router.patch("/{project_id}", response_model=ProjectOut, summary="Update a project", responses={403: ERRORS[403]})
async def update_project(project_id: uuid.UUID, body: ProjectUpdate, user: CurrentUser, session: Session) -> ProjectOut:
    p, role = await access.require_project(session, user, project_id, "EDITOR")
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(p, k, v.strip() if isinstance(v, str) else v)
    await project_service.bump_project(session, p.id)
    await session.commit()
    await session.refresh(p)
    return ProjectOut.model_validate(p).model_copy(update={"role": role})


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a project and all of its data", responses={403: ERRORS[403]})
async def delete_project(project_id: uuid.UUID, user: CurrentUser, session: Session, storage: StorageDep) -> None:
    p, _ = await access.require_project(session, user, project_id, "OWNER")
    for ds in (await session.execute(select(Dataset).where(Dataset.project_id == p.id))).scalars():
        await dataset_service.delete_dataset_files(session, storage, ds)
    await session.delete(p)
    await session.commit()


@router.get("/{project_id}/members", response_model=list[MemberOut], summary="List project members")
async def list_members(project_id: uuid.UUID, user: CurrentUser, session: Session) -> list[MemberOut]:
    await access.require_project(session, user, project_id)
    return await project_service.members(session, project_id)


@router.post("/{project_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED, summary="Add a member by e-mail (owner only)", responses={403: ERRORS[403]})
async def add_member(project_id: uuid.UUID, body: MemberIn, user: CurrentUser, session: Session) -> MemberOut:
    await access.require_project(session, user, project_id, "OWNER")
    return await project_service.add_member(session, project_id, body.email, body.role)


@router.patch("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Change a member's role (owner only)")
async def update_member(project_id: uuid.UUID, member_id: uuid.UUID, body: MemberUpdate, user: CurrentUser, session: Session) -> None:
    await access.require_project(session, user, project_id, "OWNER")
    await project_service.change_member(session, project_id, member_id, body.role)


@router.delete("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove a member (owner only; members may leave themselves)")
async def remove_member(project_id: uuid.UUID, member_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    await access.require_project(session, user, project_id, "VIEWER" if member_id == user.id else "OWNER")
    await project_service.change_member(session, project_id, member_id, None)
