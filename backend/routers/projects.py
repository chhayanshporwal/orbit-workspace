from typing import List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session

from core.database import (
    get_db,
    User,
    WorkspaceMembership,
    Project,
    AuditLog,
    UserProjectView,
    Notification,
)
from core.security import get_current_user
from core.websocket import manager
from models import schemas


class ProjectUpdate(schemas.BaseModel):
    name: str = schemas.Field(..., min_length=1, max_length=100)
    description: str | None = None


router = APIRouter()


@router.post("/projects/", response_model=schemas.ProjectResponse)
def create_project(
    project: schemas.ProjectCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    admin_check = (
        db.query(WorkspaceMembership)
        .filter_by(
            workspace_id=project.workspace_id, user_id=current_user.id, role="admin"
        )
        .first()
    )
    if not admin_check:
        raise HTTPException(
            status_code=403, detail="Not authorized. Workspace Admin role required."
        )

    new_project = Project(
        name=project.name,
        description=project.description,
        workspace_id=project.workspace_id,
    )
    db.add(new_project)
    db.flush()  # Assigns ID without committing, so we can reference new_project.id

    # Log project creation activity
    db.add(
        AuditLog(
            action="project_created",
            details=f"Project '{new_project.name}' was created.",
            workspace_id=new_project.workspace_id,
            project_id=new_project.id,
            user_id=current_user.id,
        )
    )

    # Notifications to all workspace members
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=project.workspace_id).all()
    )

    notifications = [
        Notification(
            user_id=member.user_id,
            message=f"Project '{new_project.name}' was created by {current_user.name}.",
            workspace_id=new_project.workspace_id,
        )
        for member in workspace_users
    ]
    db.bulk_save_objects(notifications)

    # Single atomic commit — project, audit log, and notifications all succeed or all fail
    db.commit()
    db.refresh(new_project)

    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {"event": "workspace_updated", "workspace_id": project.workspace_id},
    )

    return new_project


@router.get(
    "/workspaces/{workspace_id}/projects", response_model=List[schemas.ProjectResponse]
)
def get_workspace_projects(
    workspace_id: int,
    skip: int = Query(0, ge=0, description="Pagination skip"),
    limit: int = Query(100, ge=1, description="Pagination limit"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")

    return (
        db.query(Project)
        .filter(Project.workspace_id == workspace_id, Project.is_deleted.is_(False))
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_deleted.is_(False))
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=project.workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership or membership.role != "admin":
        raise HTTPException(
            status_code=403, detail="Not authorized. Workspace Admin required."
        )

    project.is_deleted = True
    project.deleted_at = datetime.now(timezone.utc)

    # Log project deletion
    db.add(
        AuditLog(
            action="project_deleted",
            details=f"Project '{project.name}' was moved to trash.",
            workspace_id=project.workspace_id,
            project_id=project.id,
            user_id=current_user.id,
        )
    )

    # Broadcast to all workspace members and send email notifications
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=project.workspace_id).all()
    )
    from services.email_service import send_notification_email

    for member in workspace_users:
        db.add(
            Notification(
                user_id=member.user_id,
                message=f"Project '{project.name}' was permanently deleted by {current_user.name}.",
                workspace_id=project.workspace_id,
            )
        )
        if member.user_id != current_user.id and member.user and member.user.email:
            background_tasks.add_task(
                send_notification_email,
                to_email=member.user.email,
                subject="Project Deleted",
                body=f"The project '{project.name}' has been permanently deleted by the administrator.",
            )

    # Single atomic commit
    db.commit()

    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {"event": "workspace_updated", "workspace_id": project.workspace_id},
    )

    return {"status": "success", "message": "Project moved to trash"}


@router.put("/projects/{project_id}", response_model=schemas.ProjectResponse)
def update_project(
    project_id: int,
    project_data: ProjectUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_deleted.is_(False))
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(
            workspace_id=project.workspace_id, user_id=current_user.id, role="admin"
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Only Admins can edit the project.")

    project.name = project_data.name
    if project_data.description is not None:
        project.description = project_data.description

    # Log project update activity
    db.add(
        AuditLog(
            action="project_updated",
            details=f"Project updated to '{project.name}'.",
            workspace_id=project.workspace_id,
            project_id=project.id,
            user_id=current_user.id,
        )
    )
    db.commit()
    db.refresh(project)

    # Broadcast updates to workspace members
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=project.workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {"event": "workspace_updated", "workspace_id": project.workspace_id},
    )

    return project


@router.post("/projects/{project_id}/view")
def update_project_view(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    view = (
        db.query(UserProjectView)
        .filter_by(user_id=current_user.id, project_id=project_id)
        .first()
    )
    if view:
        view.last_viewed_at = datetime.now(timezone.utc)
    else:
        view = UserProjectView(user_id=current_user.id, project_id=project_id)
        db.add(view)
    db.commit()
    return {"status": "success", "last_viewed_at": view.last_viewed_at}


@router.get("/user/project-views")
def get_user_project_views(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    views = db.query(UserProjectView).filter_by(user_id=current_user.id).all()
    return {v.project_id: v.last_viewed_at for v in views}
