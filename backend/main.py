import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from typing import List
from fastapi import (
    FastAPI,
    Request,
    WebSocket,
    WebSocketDisconnect,
    Depends,
)
from fastapi import Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
import jwt

import os

from core.database import (
    SessionLocal,
    Task,
    Notification,
    get_db,
    User,
    AuditLog,
    UserSession,
    Project,
)
from core.redis_client import limiter, redis_client
from routers import (
    auth,
    workspaces,
    projects,
    tasks,
    comments,
    notifications,
    analytics,
)
from core.security import get_current_user, SECRET_KEY, ALGORITHM
from core.websocket import manager
from models import schemas

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
)
logger = logging.getLogger("orbit.main")

load_dotenv()


# ==========================================
# TIME-DRIVEN CRON WORKER
# ==========================================
def check_approaching_deadlines():
    """
    Runs periodically to check for tasks due in the next 24 hours.
    Generates an in-app notification for the assignee.
    """
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        tomorrow = now + timedelta(days=1)

        urgent_tasks = (
            db.query(Task)
            .filter(
                Task.due_date > now,
                Task.due_date <= tomorrow,
                Task.status != "Done",
                Task.is_deleted.is_(False),
            )
            .all()
        )

        for task in urgent_tasks:
            if task.assignee_id:
                msg = f"⏳ Reminder: The task '{task.title}' is due in less than 24 hours!"
                existing_notif = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == task.assignee_id,
                        Notification.message == msg,
                        Notification.created_at >= now - timedelta(hours=24),
                    )
                    .first()
                )

                if not existing_notif:
                    db.add(
                        Notification(
                            user_id=task.assignee_id,
                            message=msg,
                            workspace_id=task.project.workspace_id,
                            target_user_id=task.assignee_id,
                        )
                    )

        db.commit()
    except Exception as e:
        logger.error(f"Cron Worker Error: {e}")
    finally:
        db.close()


def hard_delete_expired_accounts():
    """
    Runs daily to permanently delete accounts that were scheduled for deletion
    more than 30 days ago. Not exposed as an HTTP endpoint.
    """
    db = SessionLocal()
    try:
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        users_to_delete = (
            db.query(User).filter(User.deletion_scheduled_at <= thirty_days_ago).all()
        )
        count = 0
        for u in users_to_delete:
            db.delete(u)
            count += 1
        db.commit()
        if count > 0:
            logger.info(f"🗑️ Hard-deleted {count} expired account(s).")
    except Exception as e:
        logger.error(f"Hard Delete Cron Error: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic: Start the BackgroundScheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(check_approaching_deadlines, "interval", hours=1)
    scheduler.add_job(hard_delete_expired_accounts, "interval", hours=24)
    scheduler.start()
    yield
    # Shutdown logic
    scheduler.shutdown()


# Initialize FastAPI app with modern lifespan context
app = FastAPI(lifespan=lifespan)


def custom_rate_limit_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=429, content={"detail": "Too many requests."})


# Register Limiter infrastructure
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, custom_rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)

origins = [
    os.environ.get("FRONTEND_URL", "http://localhost:3000"),
    "https://orbitworkspace.xyz",
    "https://www.orbitworkspace.xyz",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# INCLUDE ROUTERS
# ==========================================
app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(comments.router)
app.include_router(notifications.router)
app.include_router(analytics.router)


@app.get("/")
def read_root():
    return {"message": "Orbit Backend MVP V1 running!"}


@app.post("/client-errors")
@limiter.limit("10/minute")
def log_client_error(
    request: Request,
    payload: dict = Body(..., max_length=10000),
    current_user: User = Depends(get_current_user),
):
    err_msg = str(payload.get("error", "Unknown error"))[:2000]
    stack = str(payload.get("componentStack", ""))[:5000]
    url = str(payload.get("url", ""))[:500]

    log_line = (
        f"User: {current_user.email} | URL: {url} | Error: {err_msg}\nStack: {stack}\n"
    )
    logger.error(f"🔴 CLIENT RUNTIME ERROR: {log_line}")

    return {"status": "logged"}


@app.get("/audit-logs", response_model=List[schemas.AuditLogResponse])
def get_user_audit_logs(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    workspace_ids = [
        m.workspace_id for m in current_user.memberships if m.status == "accepted"
    ]
    # Filter out audit logs for deleted projects
    from core.database import Project

    return (
        db.query(AuditLog)
        .outerjoin(Project, AuditLog.project_id == Project.id)
        .filter(AuditLog.workspace_id.in_(workspace_ids))
        .filter(
            (Project.is_deleted.is_(False))
            | (AuditLog.project_id.is_(None))
            | (AuditLog.action == "project_deleted")
        )
        .order_by(AuditLog.created_at.desc())
        .limit(30)
        .all()
    )


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, token: str = None, db: Session = Depends(get_db)
):
    if not token:
        await websocket.close(code=1008)
        return
    try:
        # Check if token was revoked via Redis
        if redis_client.get(token):
            await websocket.close(code=1008)
            return

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        jti: str = payload.get("jti")
        if email is None or jti is None:
            await websocket.close(code=1008)
            return
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            await websocket.close(code=1008)
            return

        # Verify the session is still active in the database
        if jti:
            session = (
                db.query(UserSession).filter_by(token_jti=jti, is_active=True).first()
            )
            if not session:
                await websocket.close(code=1008)
                return
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user.id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, user.id)


@app.websocket("/ws/projects/{project_id}")
async def project_websocket_endpoint(
    websocket: WebSocket,
    project_id: int,
    token: str = None,
    db: Session = Depends(get_db),
):
    if not token:
        await websocket.close(code=1008)
        return
    try:
        if redis_client.get(token):
            await websocket.close(code=1008)
            return

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        jti: str = payload.get("jti")
        if email is None or jti is None:
            await websocket.close(code=1008)
            return
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            await websocket.close(code=1008)
            return

        if jti:
            session = (
                db.query(UserSession).filter_by(token_jti=jti, is_active=True).first()
            )
            if not session:
                await websocket.close(code=1008)
                return
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect_project(websocket, project_id, user.id)
    try:
        while True:
            data = await websocket.receive_json()
            # Broadcast incoming drag/drop events to other users in the same project
            if data.get("event") in ["drag_start", "drag_end"]:
                data["user_id"] = user.id
                data["user_name"] = user.name or email.split("@")[0]
                await manager.broadcast_to_project(
                    project_id, data, exclude_user_id=user.id
                )
    except WebSocketDisconnect:
        manager.disconnect_project(websocket, project_id, user.id)
        # Notify others that this user left so their drag locks are released
        await manager.broadcast_to_project(
            project_id,
            {"event": "user_left", "user_id": user.id},
            exclude_user_id=user.id,
        )


@app.get("/users/me/all-tasks")
def get_all_user_tasks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregate endpoint: returns all tasks across all workspaces the user belongs to,
    in a single query. Replaces the O(N*M) frontend pattern.
    """
    workspace_ids = [
        m.workspace_id
        for m in current_user.memberships
        if m.status in ("accepted", "joined")
        and m.workspace
        and not m.workspace.is_deleted
    ]
    if not workspace_ids:
        return {"tasks": [], "projects": []}

    # Fetch all non-deleted projects across user's workspaces
    user_projects = (
        db.query(Project)
        .filter(
            Project.workspace_id.in_(workspace_ids),
            Project.is_deleted.is_(False),
        )
        .all()
    )
    project_ids = [p.id for p in user_projects]

    if not project_ids:
        return {"tasks": [], "projects": []}

    # Fetch all non-deleted tasks in those projects
    all_tasks = (
        db.query(Task)
        .filter(
            Task.project_id.in_(project_ids),
            Task.is_deleted.is_(False),
        )
        .all()
    )

    # Build lookup maps
    project_map = {p.id: p for p in user_projects}
    workspace_map = {}
    for ws in current_user.memberships:
        if ws.workspace and ws.workspace_id in workspace_ids:
            workspace_map[ws.workspace_id] = ws.workspace.name

    tasks_out = []
    for t in all_tasks:
        proj = project_map.get(t.project_id)
        tasks_out.append(
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "status": t.status,
                "priority_level": t.priority_level,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "project_id": t.project_id,
                "assignee_id": t.assignee_id,
                "assignor_id": t.assignor_id,
                "reassignment_reason": t.reassignment_reason,
                "project_name": proj.name if proj else None,
                "workspace_id": proj.workspace_id if proj else None,
                "workspace_name": (
                    workspace_map.get(proj.workspace_id) if proj else None
                ),
            }
        )

    projects_out = []
    for p in user_projects:
        projects_out.append(
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "workspace_id": p.workspace_id,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
        )

    return {"tasks": tasks_out, "projects": projects_out}
