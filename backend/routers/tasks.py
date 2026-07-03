from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from core.database import (
    get_db,
    User,
    Project,
    WorkspaceMembership,
    Task,
    Notification,
    TaskEditHistory,
    AuditLog,
)
from core.security import get_current_user
from services.algorithms import workload_balancer
from core.websocket import manager
from models import schemas

router = APIRouter()


@router.post("/projects/{project_id}/tasks", response_model=schemas.TaskResponse)
def create_task(
    project_id: int,
    task: schemas.TaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter_by(id=project_id, is_deleted=False).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=project.workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership or membership.role not in ["admin", "editor"]:
        raise HTTPException(status_code=403, detail="Editor access required.")

    new_task = Task(
        title=task.title,
        description=task.description,
        priority_level=task.priority_level,
        due_date=task.due_date,
        project_id=project_id,
        assignee_id=task.assignee_id,
        assignor_id=current_user.id,
    )

    if task.assignee_id and task.assignee_id != current_user.id:
        db.add(
            Notification(
                user_id=task.assignee_id,
                message=f"You were assigned to a new task: {task.title}",
                workspace_id=project.workspace_id,
                target_user_id=task.assignee_id,
            )
        )

    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    # Log task creation activity
    db.add(
        AuditLog(
            action="task_created",
            details=f"Task '{new_task.title}' was created.",
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    # WebSocket Broadcast to all workspace members
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=project.workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {
            "event": "task_created",
            "task_id": new_task.id,
            "workspace_id": project.workspace_id,
        },
    )

    return new_task


@router.post(
    "/projects/{project_id}/tasks/auto-assign", response_model=schemas.TaskResponse
)
def create_and_auto_assign_task(
    project_id: int,
    task: schemas.TaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter_by(id=project_id, is_deleted=False).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=project.workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership or membership.role not in ["admin", "editor"]:
        raise HTTPException(status_code=403, detail="Editor access required.")

    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=project.workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]

    active_tasks_data = (
        db.query(Task.assignee_id, Task.priority_level, Task.due_date)
        .join(Project)
        .filter(
            Project.workspace_id == project.workspace_id,
            Task.assignee_id.in_(user_ids),
            Task.status != "Done",
            Task.is_deleted.is_(False),
        )
        .all()
    )

    workloads_dict = {uid: [] for uid in user_ids}
    for assignee_id, priority_level, due_date in active_tasks_data:
        if assignee_id in workloads_dict:
            workloads_dict[assignee_id].append(
                {"priority": priority_level, "due_date": due_date}
            )

    workloads = [
        {"user_id": uid, "tasks": tasks} for uid, tasks in workloads_dict.items()
    ]

    best_assignee_id = workload_balancer(workloads)

    new_task = Task(
        title=task.title,
        description=task.description,
        priority_level=task.priority_level,
        due_date=task.due_date,
        project_id=project_id,
        assignee_id=best_assignee_id,
        assignor_id=current_user.id,
    )

    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    if best_assignee_id:
        msg = (
            f"Smart Assign: You were automatically routed a new task "
            f"'{task.title}' based on your bandwidth."
        )
        db.add(
            Notification(
                user_id=best_assignee_id,
                message=msg,
                workspace_id=project.workspace_id,
                target_user_id=best_assignee_id,
            )
        )
        db.commit()

    # Log task creation (auto-assign)
    db.add(
        AuditLog(
            action="task_created",
            details=f"Task '{new_task.title}' was created and auto-assigned.",
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    # Broadcast to all workspace members
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=project.workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {
            "event": "task_created",
            "task_id": new_task.id,
            "workspace_id": project.workspace_id,
        },
    )

    return new_task


@router.get("/projects/{project_id}/tasks", response_model=List[schemas.TaskResponse])
def get_project_tasks(
    project_id: int,
    keyword: Optional[str] = Query(None, description="Search in title or description"),
    assignee_id: Optional[int] = Query(None, description="Filter by user ID"),
    status: Optional[str] = Query(None, description="Filter by status (e.g., 'To Do')"),
    skip: int = Query(0, ge=0, description="Pagination skip"),
    limit: int = Query(100, ge=1, description="Pagination limit"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter_by(id=project_id, is_deleted=False).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if (
        not db.query(WorkspaceMembership)
        .filter_by(
            workspace_id=project.workspace_id, user_id=current_user.id, is_pending=False
        )
        .first()
    ):
        raise HTTPException(status_code=403, detail="Not authorized.")

    query = db.query(Task).filter_by(project_id=project_id, is_deleted=False)
    if keyword:
        query = query.filter(
            or_(
                Task.title.ilike(f"%{keyword}%"), Task.description.ilike(f"%{keyword}%")
            )
        )
    if assignee_id:
        query = query.filter(Task.assignee_id == assignee_id)
    if status:
        query = query.filter(Task.status == status)

    return query.offset(skip).limit(limit).all()


@router.get("/tasks/{task_id}", response_model=schemas.TaskResponse)
def get_task_by_id(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted.is_(False)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=task.project.workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=403, detail="Not authorized. Workspace membership required."
        )

    return task


@router.put("/tasks/{task_id}", response_model=schemas.TaskResponse)
def update_task_status(
    task_id: int,
    task_update: schemas.TaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted.is_(False)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == task.project.workspace_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership:
        raise HTTPException(
            status_code=403, detail="Not authorized. Workspace membership required."
        )

    is_admin = membership.role == "admin"
    is_creator = task.assignor_id == current_user.id
    is_assignee = task.assignee_id == current_user.id

    updates = task_update.model_dump(exclude_unset=True)
    reassignment_reason = updates.pop("reassignment_reason", None)

    if "assignee_id" in updates and updates["assignee_id"] is None:
        raise HTTPException(
            status_code=400,
            detail="A task cannot be unassigned. Please assign it to a valid member.",
        )

    change_messages = []

    non_status_modified = any(
        k for k in updates if k != "status" and getattr(task, k) != updates[k]
    )
    status_modified = (
        "status" in updates and getattr(task, "status", None) != updates["status"]
    )

    has_full_edit_access = False
    if is_creator:
        has_full_edit_access = True
    elif is_admin and not is_assignee:
        has_full_edit_access = True

    has_status_edit_access = False
    if is_creator or is_admin or is_assignee:
        has_status_edit_access = True

    if non_status_modified and not has_full_edit_access:
        raise HTTPException(
            status_code=403,
            detail="Permission Denied: You do not have permission to edit task details.",
        )

    if status_modified and not has_status_edit_access:
        raise HTTPException(
            status_code=403,
            detail="Permission Denied: You do not have permission to edit task status.",
        )

    if (
        status_modified
        and getattr(task, "status", "").lower() == "done"
        and updates["status"].lower() != "done"
    ):
        if is_creator:
            pass
        elif is_admin and not is_assignee:
            pass
        elif is_admin and is_assignee:
            db.add(
                AuditLog(
                    action="task_override",
                    details=f"Admin {current_user.name or current_user.email} used Oversight Override to unlock Task '{task.title}'.",
                    workspace_id=task.project.workspace_id,
                    project_id=task.project_id,
                    user_id=current_user.id,
                )
            )
        else:
            raise HTTPException(
                status_code=403,
                detail="Permission Denied: Only the creator or an admin can unlock a Done task.",
            )

    field_labels = {
        "title": "Title",
        "description": "Description",
        "priority_level": "Priority Level",
        "assignee_id": "Assignee",
        "due_date": "Due Date",
        "status": "Status",
    }

    for field, new_val in updates.items():
        old_val = getattr(task, field)

        if field == "due_date":
            old_str = old_val.isoformat() if old_val else None
            new_str = new_val.isoformat() if new_val else None
            if old_str == new_str:
                continue
        elif field == "assignee_id":
            if old_val == new_val:
                continue
        elif str(old_val) == str(new_val):
            continue

        setattr(task, field, new_val)

        old_display = str(old_val) if old_val is not None else "None"
        new_display = str(new_val) if new_val is not None else "None"

        if field == "assignee_id":
            if old_val:
                old_u = db.query(User).filter_by(id=old_val).first()
                old_display = old_u.name or old_u.email if old_u else f"User {old_val}"
            else:
                old_display = "Unassigned"
            if new_val:
                new_u = db.query(User).filter_by(id=new_val).first()
                new_display = new_u.name or new_u.email if new_u else f"User {new_val}"
            else:
                new_display = "Unassigned"

            change_msg = f"{field_labels.get(field, field)} changed from {old_display} to {new_display}."
            if reassignment_reason:
                change_msg += f" Reason: {reassignment_reason}"
            change_messages.append(change_msg)

            if old_val:
                db.add(
                    Notification(
                        user_id=old_val,
                        message=f"Task '{task.title}' was reassigned from you to {new_display}. Reason: {reassignment_reason or 'No reason provided.'}",
                        workspace_id=task.project.workspace_id,
                        target_user_id=old_val,
                    )
                )
            if new_val:
                db.add(
                    Notification(
                        user_id=new_val,
                        message=f"You have been assigned Task '{task.title}'. Reason: {reassignment_reason or 'No reason provided.'}",
                        workspace_id=task.project.workspace_id,
                        target_user_id=new_val,
                    )
                )
        else:
            if field == "due_date":
                old_display = old_val.strftime("%Y-%m-%d") if old_val else "None"
                new_display = new_val.strftime("%Y-%m-%d") if new_val else "None"
            change_messages.append(
                f"{field_labels.get(field, field)} changed from '{old_display}' to '{new_display}'."
            )

        history_entry = TaskEditHistory(
            task_id=task.id,
            editor_id=current_user.id,
            field_name=field_labels.get(field, field),
            old_value=old_display,
            new_value=new_display,
        )
        db.add(history_entry)

    db.commit()
    db.refresh(task)

    # Log task update activity
    if change_messages:
        editor_name = current_user.name or current_user.email
        details = f"{editor_name} updated Task '{task.title}': " + " ".join(
            change_messages
        )
        db.add(
            AuditLog(
                action="task_updated",
                details=details,
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
            "event": "task_updated",
            "task_id": task.id,
            "workspace_id": task.project.workspace_id,
        },
    )

    return task


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted.is_(False)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == task.project.workspace_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership or membership.role not in ["admin", "editor"]:
        raise HTTPException(
            status_code=403, detail="Not authorized. Editor access required."
        )

    task.is_deleted = True
    task.deleted_at = datetime.now(timezone.utc)
    db.commit()

    # Log task deletion activity
    db.add(
        AuditLog(
            action="task_deleted",
            details=f"Task '{task.title}' was deleted.",
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
            "event": "task_deleted",
            "task_id": task_id,
            "workspace_id": task.project.workspace_id,
        },
    )

    return {"status": "success", "message": "Task moved to trash"}
