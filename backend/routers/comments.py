from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from core.database import (
    get_db,
    User,
    Task,
    WorkspaceMembership,
    Comment,
    Notification,
    AuditLog,
)
from core.security import get_current_user
from core.websocket import manager
from models import schemas

router = APIRouter()


@router.post("/tasks/{task_id}/comments", response_model=schemas.CommentResponse)
def create_comment(
    task_id: int,
    comment: schemas.CommentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter_by(id=task_id, is_deleted=False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=task.project.workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized.")

    new_comment = Comment(
        content=comment.content, task_id=task_id, author_id=current_user.id
    )

    if task.assignee_id and task.assignee_id != current_user.id:
        notif = Notification(
            user_id=task.assignee_id,
            message=f"{current_user.name or current_user.email} commented on your task: {task.title}",
            workspace_id=task.project.workspace_id,
            target_user_id=task.assignee_id,
        )
        db.add(notif)

        # Notify the assignee via WS
        background_tasks.add_task(
            manager.send_personal_message,
            {"event": "notification_received"},
            task.assignee_id,
        )

    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)

    # Log comment activity
    db.add(
        AuditLog(
            action="comment_added",
            details=f"Comment was added to task '{task.title}' by {current_user.name or current_user.email}.",
            workspace_id=task.project.workspace_id,
            project_id=task.project_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    # WebSocket Broadcast to all workspace members
    workspace_users = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=task.project.workspace_id)
        .all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {
            "event": "comment_added",
            "task_id": task_id,
            "comment_id": new_comment.id,
            "workspace_id": task.project.workspace_id,
        },
    )

    return new_comment


@router.get("/tasks/{task_id}/comments", response_model=List[schemas.CommentResponse])
def get_task_comments(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter_by(id=task_id, is_deleted=False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if (
        not db.query(WorkspaceMembership)
        .filter_by(workspace_id=task.project.workspace_id, user_id=current_user.id)
        .first()
    ):
        raise HTTPException(status_code=403, detail="Not authorized.")

    return (
        db.query(Comment)
        .filter_by(task_id=task_id)
        .order_by(Comment.created_at.asc())
        .all()
    )
