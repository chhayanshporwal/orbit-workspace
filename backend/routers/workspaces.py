from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session

from core.database import (
    get_db,
    User,
    Workspace,
    WorkspaceMembership,
    Notification,
    AuditLog,
    Task,
    TaskEditHistory,
    Project,
)
from core.security import get_current_user
from services.email_service import send_notification_email
from services.algorithms import workload_balancer
from core.websocket import manager
from models import schemas

router = APIRouter()


class WorkspaceUpdate(schemas.BaseModel):
    name: str = schemas.Field(..., min_length=1, max_length=100)
    description: str | None = None


@router.post("/workspaces/", response_model=schemas.WorkspaceResponse)
def create_workspace(
    workspace: schemas.WorkspaceCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_workspace = Workspace(name=workspace.name)
    now = datetime.now(timezone.utc)
    new_membership = WorkspaceMembership(
        user=current_user,
        role="admin",
        is_pending=False,
        status="accepted",
        invited_at=now,
        joined_at=now,
    )
    new_workspace.memberships.append(new_membership)
    db.add(new_workspace)
    db.commit()
    db.refresh(new_workspace)

    # Log workspace creation activity
    db.add(
        AuditLog(
            action="workspace_created",
            details=f"Workspace '{new_workspace.name}' was created.",
            workspace_id=new_workspace.id,
            user_id=current_user.id,
        )
    )
    db.add(
        Notification(
            user_id=current_user.id,
            message=f"You successfully created the workspace '{new_workspace.name}'.",
            workspace_id=new_workspace.id,
        )
    )
    db.commit()

    # Trigger WebSocket refresh for user
    background_tasks.add_task(
        manager.send_personal_message, {"event": "workspace_updated"}, current_user.id
    )

    return new_workspace


@router.get(
    "/users/{user_id}/workspaces", response_model=List[schemas.WorkspaceResponse]
)
def get_user_workspaces(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Enforce IDOR protection: user can only fetch their own workspaces
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized.")

    return (
        db.query(Workspace)
        .join(WorkspaceMembership)
        .filter(WorkspaceMembership.user_id == user_id, Workspace.is_deleted.is_(False))
        .filter(WorkspaceMembership.is_pending.is_(False))
        .all()
    )


@router.post(
    "/workspaces/{workspace_id}/members",
    response_model=schemas.WorkspaceMembershipResponse,
)
def invite_user_to_workspace(
    workspace_id: int,
    invite: schemas.WorkspaceInvite,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted.is_(False))
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    admin_check = (
        db.query(WorkspaceMembership)
        .filter_by(
            workspace_id=workspace_id,
            user_id=current_user.id,
            role="admin",
            is_pending=False,
        )
        .first()
    )
    if not admin_check:
        raise HTTPException(status_code=403, detail="Only Admins can invite users.")

    invited_user = db.query(User).filter(User.email == invite.email).first()
    if not invited_user or invited_user.deletion_scheduled_at:
        raise HTTPException(
            status_code=404, detail="User email not found. They must register first."
        )

    existing_membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=invited_user.id)
        .first()
    )

    msg = f"You were invited to workspace: {workspace.name}"

    if existing_membership:
        if existing_membership.status == "invited":
            raise HTTPException(
                status_code=400,
                detail="An invitation is already pending for this user.",
            )
        elif existing_membership.status == "accepted":
            raise HTTPException(
                status_code=400, detail="User is already in this workspace."
            )
        elif existing_membership.status == "rejected":
            # Re-invite rejected user
            existing_membership.status = "invited"
            existing_membership.role = invite.role
            existing_membership.is_pending = True
            existing_membership.invited_at = datetime.now(timezone.utc)
            existing_membership.joined_at = None

            # Database In-App Notification with metadata
            notification = Notification(
                user_id=invited_user.id,
                message=msg,
                workspace_id=workspace_id,
                target_user_id=invited_user.id,
                membership_id=existing_membership.id,
            )
            db.add(notification)
            db.commit()
            db.refresh(existing_membership)

            # Log invite
            db.add(
                AuditLog(
                    action="member_invited",
                    details=f"User {invited_user.name or invited_user.email} was invited to join workspace.",
                    workspace_id=workspace_id,
                    user_id=current_user.id,
                )
            )
            db.commit()

            # High-Priority Email Trigger
            background_tasks.add_task(
                send_notification_email,
                to_email=invited_user.email,
                subject=f"Welcome to Orbit - You've been invited to {workspace.name}",
                body=msg,
            )

            # WebSocket notify invited user
            background_tasks.add_task(
                manager.send_personal_message,
                {"event": "invitation_received"},
                invited_user.id,
            )

            return existing_membership

    new_membership = WorkspaceMembership(
        workspace_id=workspace_id,
        user_id=invited_user.id,
        role=invite.role,
        is_pending=True,
        status="invited",
        invited_at=datetime.now(timezone.utc),
    )
    db.add(new_membership)
    db.commit()
    db.refresh(new_membership)

    # Database In-App Notification with metadata
    notification = Notification(
        user_id=invited_user.id,
        message=msg,
        workspace_id=workspace_id,
        target_user_id=invited_user.id,
        membership_id=new_membership.id,
    )
    db.add(notification)

    # Log invite
    db.add(
        AuditLog(
            action="member_invited",
            details=f"User {invited_user.name or invited_user.email} was invited to join workspace.",
            workspace_id=workspace_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    # High-Priority Email Trigger
    background_tasks.add_task(
        send_notification_email,
        to_email=invited_user.email,
        subject=f"Welcome to Orbit - You've been invited to {workspace.name}",
        body=msg,
    )

    # WebSocket notify invited user
    background_tasks.add_task(
        manager.send_personal_message, {"event": "invitation_received"}, invited_user.id
    )

    return new_membership


@router.put(
    "/workspaces/{workspace_id}/members/{user_id}",
    response_model=schemas.WorkspaceMembershipResponse,
)
def update_member_role(
    workspace_id: int,
    user_id: int,
    role_update: schemas.RoleUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    admin_check = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id, role="admin")
        .first()
    )
    if not admin_check:
        raise HTTPException(status_code=403, detail="Only Admins can change roles.")

    target_membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=user_id)
        .first()
    )
    if not target_membership:
        raise HTTPException(
            status_code=404, detail="User is not a member of this workspace."
        )

    if target_membership.role == "admin" and role_update.role != "admin":
        admin_count = (
            db.query(WorkspaceMembership)
            .filter_by(workspace_id=workspace_id, role="admin")
            .count()
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot demote the last admin. Promote another user to admin first.",
            )

    old_role = target_membership.role
    target_membership.role = role_update.role
    db.commit()
    db.refresh(target_membership)

    target_user = db.query(User).filter_by(id=user_id).first()
    workspace = db.query(Workspace).filter_by(id=workspace_id).first()

    if not target_user or not workspace:
        raise HTTPException(status_code=404, detail="User or Workspace not found")

    msg = f"Your role in {workspace.name} has been updated to '{role_update.role}'."
    db.add(
        Notification(
            user_id=user_id,
            message=msg,
            workspace_id=workspace_id,
            target_user_id=user_id,
        )
    )

    # Log role update
    db.add(
        AuditLog(
            action="member_role_updated",
            details=f"User {target_user.name or target_user.email} role updated from {old_role} to {role_update.role}.",
            workspace_id=workspace_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    background_tasks.add_task(
        send_notification_email,
        to_email=target_user.email,
        subject="Orbit Security Alert: Role Updated",
        body=msg,
    )

    # Broadcast updates to workspace members
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {"event": "workspace_updated", "workspace_id": workspace_id},
    )

    return target_membership


@router.delete("/workspaces/{workspace_id}/members/{user_id}")
def remove_member(
    workspace_id: int,
    user_id: int,
    background_tasks: BackgroundTasks,
    reason: Optional[str] = Query(None, description="Optional reason for removal"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=user_id)
        .first()
    )
    if not target_membership:
        raise HTTPException(
            status_code=404, detail="User is not a member of this workspace."
        )

    is_self = current_user.id == user_id

    if not is_self:
        admin_check = (
            db.query(WorkspaceMembership)
            .filter_by(workspace_id=workspace_id, user_id=current_user.id, role="admin")
            .first()
        )
        if not admin_check:
            raise HTTPException(
                status_code=403, detail="Only Admins can remove other users."
            )

    if target_membership.role == "admin":
        admin_count = (
            db.query(WorkspaceMembership)
            .filter_by(workspace_id=workspace_id, role="admin")
            .count()
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot remove the last admin. Promote another user to admin or delete the workspace.",
            )

    workspace = db.query(Workspace).filter_by(id=workspace_id).first()
    target_user = db.query(User).filter_by(id=user_id).first()

    if not target_user or not workspace:
        raise HTTPException(status_code=404, detail="User or Workspace not found")

    # Log membership removal activity
    action_type = "member_left" if is_self else "member_removed"
    details_str = (
        f"User {target_user.name or target_user.email} left the workspace."
        if is_self
        else f"User {target_user.name or target_user.email} was removed by {current_user.name or current_user.email}."
    )
    if not is_self and reason:
        details_str += f" Reason: {reason}"

    # Send Tier 1 notification if a user is removed (not left on their own)
    if not is_self:
        notif_msg = f"You have been removed from the workspace '{workspace.name}' by {current_user.name or current_user.email}."
        if reason:
            notif_msg += f" Reason: {reason}"
        db.add(
            Notification(
                user_id=user_id,
                message=notif_msg,
                workspace_id=workspace_id,
            )
        )
        background_tasks.add_task(
            send_notification_email,
            target_user.email,
            f"Removed from Workspace: {workspace.name}",
            notif_msg,
        )

    # Auto-Reassign active tasks
    # 1. Fetch remaining active members of the workspace
    remaining_members = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id != user_id,
            WorkspaceMembership.is_pending.is_(False),
        )
        .all()
    )
    remaining_user_ids = [m.user_id for m in remaining_members]

    # 2. Query all uncompleted active tasks assigned to the leaving user in this workspace
    assigned_tasks = (
        db.query(Task)
        .join(Project)
        .filter(
            Project.workspace_id == workspace_id,
            Task.assignee_id == user_id,
            Task.status != "Done",
            Task.is_deleted.is_(False),
        )
        .all()
    )

    reassigned_logs = []
    if remaining_user_ids:
        # Fetch active workloads for remaining members
        active_tasks = (
            db.query(Task)
            .join(Project)
            .filter(
                Project.workspace_id == workspace_id,
                Task.assignee_id.in_(remaining_user_ids),
                Task.status != "Done",
                Task.is_deleted.is_(False),
            )
            .all()
        )

        for task in assigned_tasks:
            # Recompile workloads
            workloads = []
            for uid in remaining_user_ids:
                user_tasks = [
                    {"priority": t.priority_level, "due_date": t.due_date}
                    for t in active_tasks
                    if t.assignee_id == uid
                ]
                workloads.append({"user_id": uid, "tasks": user_tasks})

            best_assignee_id = workload_balancer(workloads)
            if best_assignee_id:
                new_assignee = db.query(User).filter_by(id=best_assignee_id).first()
                new_name = (
                    new_assignee.name or new_assignee.email
                    if new_assignee
                    else f"User {best_assignee_id}"
                )

                # Update task
                task.assignee_id = best_assignee_id

                # History log
                history = TaskEditHistory(
                    task_id=task.id,
                    editor_id=current_user.id,
                    field_name="Assignee",
                    old_value=target_user.name or target_user.email,
                    new_value=new_name,
                )
                db.add(history)

                # Send Notification
                msg_reassign = f"Task '{task.title}' was automatically reassigned to you because {target_user.name or target_user.email} left the workspace."
                db.add(
                    Notification(
                        user_id=best_assignee_id,
                        message=msg_reassign,
                        workspace_id=workspace_id,
                        target_user_id=best_assignee_id,
                    )
                )

                # Add to active_tasks list for dynamic incremental workload calculations
                active_tasks.append(task)
                reassigned_logs.append(f"'{task.title}' -> {new_name}")

                # Add individual audit log for the reassignment so it shows up in Project history
                db.add(
                    AuditLog(
                        action="task_reassigned",
                        details=f"Task '{task.title}' was automatically reassigned to {new_name} because the original assignee left.",
                        workspace_id=workspace_id,
                        project_id=task.project_id,
                        user_id=current_user.id,
                    )
                )

    created_tasks = (
        db.query(Task)
        .join(Project)
        .filter(
            Project.workspace_id == workspace_id,
            Task.assignor_id == user_id,
            Task.is_deleted.is_(False),
        )
        .all()
    )
    if created_tasks:
        admin_member = (
            db.query(WorkspaceMembership)
            .filter_by(workspace_id=workspace_id, role="admin", is_pending=False)
            .filter(WorkspaceMembership.user_id != user_id)
            .first()
        )
        if admin_member:
            admin_user = db.query(User).filter_by(id=admin_member.user_id).first()
            admin_name = (
                admin_user.name or admin_user.email
                if admin_user
                else f"Admin {admin_member.user_id}"
            )
            for t in created_tasks:
                t.assignor_id = admin_member.user_id
                db.add(
                    AuditLog(
                        action="task_transferred",
                        details=f"Task '{t.title}' ownership was transferred to {admin_name} because the creator left.",
                        workspace_id=workspace_id,
                        project_id=t.project_id,
                        user_id=current_user.id,
                    )
                )
            reassigned_logs.append(
                f"Transferred creator ownership of {len(created_tasks)} tasks to {admin_name}"
            )

    # Remove membership
    db.delete(target_membership)

    # Save Audit Log (Workspace Level)
    db.add(
        AuditLog(
            action=action_type,
            details=details_str,
            workspace_id=workspace_id,
            user_id=current_user.id,
        )
    )

    # Auto-resolve pending leave notifications regarding this user/workspace
    db.query(Notification).filter_by(
        workspace_id=workspace_id, target_user_id=user_id
    ).update({"is_read": True})
    db.commit()

    # Broadcast to all remaining members that a member was removed so they refresh their task boards
    background_tasks.add_task(
        manager.broadcast_to_users,
        remaining_user_ids + [current_user.id],
        {"event": "member_removed", "workspace_id": workspace_id},
    )

    if not is_self:
        msg = f"Your access to the workspace '{workspace.name}' has been revoked."
        background_tasks.add_task(
            send_notification_email,
            to_email=target_user.email,
            subject="Orbit Security Alert: Workspace Access Revoked",
            body=msg,
        )

    # Broadcast updates to workspace members (and target user)
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]
    # Include both remaining users and the leaving user so they receive the deletion event
    all_notified_user_ids = list(set(user_ids + [user_id]))

    background_tasks.add_task(
        manager.broadcast_to_users,
        all_notified_user_ids,
        {"event": "workspace_updated", "workspace_id": workspace_id},
    )

    return {"status": "success", "message": "User successfully removed from workspace."}


@router.get(
    "/workspace-invitations", response_model=List[schemas.WorkspaceInvitationResponse]
)
def get_workspace_invitations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.user_id == current_user.id,
            WorkspaceMembership.status == "invited",
        )
        .all()
    )


@router.post("/workspace-invitations/{membership_id}/accept")
def accept_workspace_invitation(
    membership_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.id == membership_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Invitation not found")

    membership.is_pending = False
    membership.status = "accepted"
    membership.joined_at = datetime.now(timezone.utc)

    # Auto-resolve notification
    db.query(Notification).filter_by(
        user_id=current_user.id, membership_id=membership_id
    ).update({"is_read": True})

    # Log accept activity
    db.add(
        AuditLog(
            action="member_joined",
            details=f"User {current_user.name or current_user.email} accepted the invitation and joined the workspace.",
            workspace_id=membership.workspace_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    # Broadcast workspace updates to all members
    workspace_users = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=membership.workspace_id)
        .all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {"event": "workspace_updated", "workspace_id": membership.workspace_id},
    )

    return {"status": "success", "message": "Invitation accepted"}


@router.post("/workspace-invitations/{membership_id}/reject")
def reject_workspace_invitation(
    membership_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.id == membership_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Invitation not found")

    membership.status = "rejected"

    # Auto-resolve notification
    db.query(Notification).filter_by(
        user_id=current_user.id, membership_id=membership_id
    ).update({"is_read": True})

    # Log reject activity
    db.add(
        AuditLog(
            action="member_rejected",
            details=f"User {current_user.name or current_user.email} rejected the invitation.",
            workspace_id=membership.workspace_id,
            user_id=current_user.id,
        )
    )
    db.commit()

    # Broadcast workspace updates to all admins
    admins = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=membership.workspace_id, role="admin")
        .all()
    )
    admin_ids = [a.user_id for a in admins]
    background_tasks.add_task(
        manager.broadcast_to_users,
        admin_ids,
        {"event": "workspace_updated", "workspace_id": membership.workspace_id},
    )

    return {"status": "success", "message": "Invitation rejected"}


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted.is_(False))
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == current_user.id,
            WorkspaceMembership.is_pending.is_(False),
        )
        .first()
    )

    if not membership or membership.role != "admin":
        raise HTTPException(
            status_code=403, detail="Not authorized. Admin access required."
        )

    workspace.is_deleted = True
    workspace.deleted_at = datetime.now(timezone.utc)

    # Log workspace deletion
    db.add(
        AuditLog(
            action="workspace_deleted",
            details=f"Workspace '{workspace.name}' was deleted.",
            workspace_id=workspace_id,
            user_id=current_user.id,
        )
    )

    # Auto-resolve delete request notifications
    db.query(Notification).filter_by(workspace_id=workspace_id).update(
        {"is_read": True}
    )

    # Notify every member that the workspace was deleted
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=workspace_id).all()
    )
    for member in workspace_users:
        message = f"The workspace '{workspace.name}' has been permanently deleted by the administrator."
        db.add(
            Notification(
                user_id=member.user_id,
                message=message,
                workspace_id=workspace_id,
                target_user_id=member.user_id,
            )
        )
        if member.user_id != current_user.id and member.user and member.user.email:
            background_tasks.add_task(
                send_notification_email,
                to_email=member.user.email,
                subject="Workspace Deleted",
                body=message,
            )
    db.commit()

    # Broadcast workspace updates to members
    workspace_users = (
        db.query(WorkspaceMembership).filter_by(workspace_id=workspace_id).all()
    )
    user_ids = [m.user_id for m in workspace_users]
    background_tasks.add_task(
        manager.broadcast_to_users,
        user_ids,
        {"event": "workspace_deleted", "workspace_id": workspace_id},
    )

    return {"status": "success", "message": "Workspace moved to trash"}


@router.post("/workspaces/{workspace_id}/leave-requests")
def request_leave_workspace(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted.is_(False))
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=403, detail="You are not a member of this workspace"
        )

    admins = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, role="admin")
        .all()
    )
    if not admins:
        db.delete(membership)
        db.commit()
        return {"status": "success", "message": "Left workspace directly."}

    msg = f"User {current_user.name or current_user.email} requests to leave workspace: {workspace.name}"
    admin_ids = []
    for admin in admins:
        notif = Notification(
            user_id=admin.user_id,
            message=msg,
            workspace_id=workspace_id,
            target_user_id=current_user.id,
        )
        db.add(notif)
        admin_ids.append(admin.user_id)

    db.commit()

    # WebSocket notify admins in real-time
    background_tasks.add_task(
        manager.broadcast_to_users, admin_ids, {"event": "notification_received"}
    )

    return {
        "status": "success",
        "message": "Leave request submitted to workspace admins.",
    }


@router.post("/workspaces/{workspace_id}/delete-requests")
def request_delete_workspace(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted.is_(False))
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id, role="admin")
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=403, detail="Only Admins can delete a workspace."
        )

    admins = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, role="admin")
        .all()
    )
    other_admins = [a for a in admins if a.user_id != current_user.id]

    if not other_admins:
        workspace.is_deleted = True
        workspace.deleted_at = datetime.now(timezone.utc)

        db.add(
            AuditLog(
                action="workspace_deleted",
                details=f"Workspace '{workspace.name}' was deleted.",
                workspace_id=workspace_id,
                user_id=current_user.id,
            )
        )

        # Auto-resolve delete request notifications
        db.query(Notification).filter_by(workspace_id=workspace_id).update(
            {"is_read": True}
        )

        # Broadcast and notify
        workspace_users = (
            db.query(WorkspaceMembership).filter_by(workspace_id=workspace_id).all()
        )
        user_ids = [m.user_id for m in workspace_users]

        for member in workspace_users:
            message = f"The workspace '{workspace.name}' has been permanently deleted by the administrator."
            db.add(
                Notification(
                    user_id=member.user_id,
                    message=message,
                    workspace_id=workspace_id,
                    target_user_id=member.user_id,
                )
            )
            if member.user_id != current_user.id and member.user and member.user.email:
                background_tasks.add_task(
                    send_notification_email,
                    to_email=member.user.email,
                    subject="Workspace Deleted",
                    body=message,
                )

        db.commit()

        background_tasks.add_task(
            manager.broadcast_to_users,
            user_ids,
            {"event": "workspace_deleted", "workspace_id": workspace_id},
        )

        return {"status": "deleted", "message": "Workspace deleted successfully."}

    msg = f"Admin {current_user.name or current_user.email} requests to delete workspace: {workspace.name}"
    other_admin_ids = []
    for admin in other_admins:
        notif = Notification(
            user_id=admin.user_id, message=msg, workspace_id=workspace_id
        )
        db.add(notif)
        other_admin_ids.append(admin.user_id)

    db.commit()

    # WebSocket notify other admins
    background_tasks.add_task(
        manager.broadcast_to_users, other_admin_ids, {"event": "notification_received"}
    )

    return {
        "status": "requested",
        "message": "Delete request submitted to other admins.",
    }


@router.put("/workspaces/{workspace_id}", response_model=schemas.WorkspaceResponse)
def update_workspace(
    workspace_id: int,
    workspace_data: WorkspaceUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id, role="admin")
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=403, detail="Only Admins can rename the workspace."
        )

    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted.is_(False))
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    old_name = workspace.name
    old_description = workspace.description

    changes = []
    if workspace_data.name != old_name:
        workspace.name = workspace_data.name
        changes.append(f"name from '{old_name}' to '{workspace_data.name}'")

    if (
        workspace_data.description is not None
        and workspace_data.description != old_description
    ):
        workspace.description = workspace_data.description
        changes.append("description updated")

    if changes:
        details = "Workspace " + " and ".join(changes) + "."
        db.add(
            AuditLog(
                action="workspace_updated",
                details=details,
                workspace_id=workspace_id,
                user_id=current_user.id,
            )
        )
        db.commit()
        db.refresh(workspace)

        # Broadcast rename and notify
        workspace_users = (
            db.query(WorkspaceMembership).filter_by(workspace_id=workspace_id).all()
        )
        for member in workspace_users:
            db.add(
                Notification(
                    user_id=member.user_id,
                    message=f"Workspace '{old_name}' was renamed to '{workspace_data.name}'.",
                    workspace_id=workspace_id,
                )
            )
        db.commit()

        user_ids = [m.user_id for m in workspace_users]
        background_tasks.add_task(
            manager.broadcast_to_users,
            user_ids,
            {"event": "workspace_updated", "workspace_id": workspace_id},
        )

    return workspace


@router.get(
    "/workspaces/{workspace_id}/audit-logs",
    response_model=List[schemas.AuditLogResponse],
)
def get_workspace_audit_logs(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Enforce membership check
    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized.")

    return (
        db.query(AuditLog)
        .filter(AuditLog.workspace_id == workspace_id)
        .order_by(AuditLog.created_at.desc())
        .all()
    )
