from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.database import get_db, User, WorkspaceMembership, Task, Project, Workspace
from core.security import get_current_user
from models import schemas

router = APIRouter()


@router.get(
    "/workspaces/{workspace_id}/analytics", response_model=schemas.AnalyticsResponse
)
def get_workspace_analytics(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. Auth Check
    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id, is_pending=False)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized")

    # 2. Standard Analytics (2-Table Join)
    tasks_query = (
        db.query(Task)
        .join(Project)
        .filter(
            Project.workspace_id == workspace_id,
            Task.is_deleted.is_(False),
            Project.is_deleted.is_(False),
        )
    )

    total_tasks = tasks_query.count()
    status_aggregation = (
        db.query(Task.status, func.count(Task.id))
        .join(Project)
        .filter(
            Project.workspace_id == workspace_id,
            Task.is_deleted.is_(False),
            Project.is_deleted.is_(False),
        )
        .group_by(Task.status)
        .all()
    )

    status_counts = {status: count for status, count in status_aggregation}
    current_time = datetime.now(timezone.utc)
    overdue_tasks = tasks_query.filter(
        Task.due_date < current_time, Task.status != "Done"
    ).count()
    bottleneck_data = (
        db.query(User.email, func.count(Task.id).label("overdue_count"))
        .select_from(Workspace)
        .join(Project, Project.workspace_id == Workspace.id)
        .join(Task, Task.project_id == Project.id)
        .join(User, Task.assignee_id == User.id)
        .filter(
            Workspace.id == workspace_id,
            Task.due_date < current_time,
            Task.status != "Done",
            Task.is_deleted.is_(False),
            Project.is_deleted.is_(False),
        )
        .group_by(User.email)
        .order_by(func.count(Task.id).desc())
        .limit(5)
        .all()
    )

    # Format the data for Pydantic
    bottlenecks = [
        {"user_email": row.email, "overdue_count": row.overdue_count}
        for row in bottleneck_data
    ]

    return {
        "total_tasks": total_tasks,
        "status_counts": status_counts,
        "overdue_tasks": overdue_tasks,
        "bottlenecks": bottlenecks,
    }
