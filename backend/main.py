import os
from dotenv import load_dotenv
import redis
from database import (
    SessionLocal,
)
from fastapi import (
    Request,
    FastAPI,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from database import (
    get_db,
    User,
    Workspace,
    Project,
    Task,
    WorkspaceMembership,
    Comment,
    Notification,
)
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
import bcrypt
import schemas
from typing import List, Optional
import jwt
from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# IMPORT THE NEW EMAIL SERVICE
from email_service import send_notification_email

# Modern FastAPI Lifespan imports
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

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
                Task.is_deleted == False,
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
                    db.add(Notification(user_id=task.assignee_id, message=msg))

        db.commit()
    except Exception as e:
        import logging

        logging.error(f"Cron Worker Error: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    scheduler = BackgroundScheduler()
    scheduler.add_job(check_approaching_deadlines, "interval", hours=1)
    scheduler.start()
    yield
    # Shutdown logic
    scheduler.shutdown()


# Initialize FastAPI with the modern lifespan context
app = FastAPI(lifespan=lifespan)

# ==========================================
# REDIS & RATE LIMITING INFRASTRUCTURE
# ==========================================
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
limiter = Limiter(key_func=get_remote_address, storage_uri=REDIS_URL)


def custom_rate_limit_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=429, content={"detail": "Too many requests."})


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, custom_rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# SECURITY HELPERS
# ==========================================
def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-for-dev")
ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
):
    if redis_client.get(token):
        raise HTTPException(status_code=401, detail="Token revoked.")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
    except jwt.InvalidTokenError:
        # Fixed to match standard OAuth2 expectations in tests
        raise HTTPException(status_code=401, detail="Could not validate credentials")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ==========================================
# WEBSOCKET MANAGER (Real-Time)
# ==========================================
class ConnectionManager:
    def __init__(self):
        # Maps project_id to a list of active WebSocket connections
        self.active_connections: dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, project_id: int):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)

    def disconnect(self, websocket: WebSocket, project_id: int):
        if project_id in self.active_connections:
            if websocket in self.active_connections[project_id]:
                self.active_connections[project_id].remove(websocket)
            if not self.active_connections[project_id]:
                del self.active_connections[project_id]

    async def broadcast_to_project(self, project_id: int, message: dict):
        if project_id in self.active_connections:
            # Send the update to every user currently viewing this project
            for connection in self.active_connections[project_id]:
                await connection.send_json(message)


manager = ConnectionManager()


@app.websocket("/ws/projects/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: int):
    await manager.connect(websocket, project_id)
    try:
        while True:
            # We keep the socket open. The client just listens.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)


# ==========================================
# AUTH ROUTES
# ==========================================
@app.post("/users/", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = User(email=user.email, hashed_password=get_password_hash(user.password))
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.post("/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    email = form_data.username
    lockout_key, failed_attempts_key = f"lockout:{email}", f"failed_attempts:{email}"

    if redis_client.get(lockout_key):
        raise HTTPException(status_code=403, detail="Account locked.")

    user = db.query(User).filter(User.email == email).first()
    dummy_hash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjIQqiRQYq"
    is_valid = (
        verify_password(form_data.password, user.hashed_password)
        if user
        else verify_password(form_data.password, dummy_hash)
    )

    if not user or not is_valid:
        redis_client.incr(failed_attempts_key)
        if redis_client.ttl(failed_attempts_key) == -1:
            redis_client.expire(failed_attempts_key, 600)
        if int(redis_client.get(failed_attempts_key) or 0) >= 10:
            redis_client.set(name=lockout_key, value="locked", ex=900)
            redis_client.delete(failed_attempts_key)
            raise HTTPException(status_code=403, detail="Account locked.")
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    redis_client.delete(failed_attempts_key)
    return {
        "access_token": create_access_token({"sub": user.email}),
        "token_type": "bearer",
    }


@app.post("/logout")
def logout(token: str = Depends(oauth2_scheme)):
    try:
        expire_timestamp = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get(
            "exp"
        )
        if expire_timestamp is None:
            raise HTTPException(
                status_code=401, detail="Invalid token: Missing expiration claim"
            )

        time_remaining = int(expire_timestamp - datetime.now(timezone.utc).timestamp())
        if time_remaining > 0:
            redis_client.set(name=token, value="revoked", ex=time_remaining)
        return {"status": "success", "message": "Successfully logged out"}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ==========================================
# WORKSPACE ROUTES
# ==========================================
@app.post("/workspaces/", response_model=schemas.WorkspaceResponse)
def create_workspace(
    workspace: schemas.WorkspaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_workspace = Workspace(name=workspace.name)
    new_workspace.memberships.append(
        WorkspaceMembership(user=current_user, role="admin")
    )
    db.add(new_workspace)
    db.commit()
    db.refresh(new_workspace)
    return new_workspace


@app.get("/users/{user_id}/workspaces", response_model=List[schemas.WorkspaceResponse])
def get_user_workspaces(user_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Workspace)
        .join(WorkspaceMembership)
        .filter(WorkspaceMembership.user_id == user_id, Workspace.is_deleted.is_(False))
        .all()
    )


@app.post(
    "/workspaces/{workspace_id}/members",
    response_model=schemas.WorkspaceMembershipResponse,
)
def invite_user_to_workspace(
    workspace_id: int,
    invite: schemas.WorkspaceInvite,
    background_tasks: BackgroundTasks,  # TIER 1 NOTIFICATION ADDED
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
        .filter_by(workspace_id=workspace_id, user_id=current_user.id, role="admin")
        .first()
    )
    if not admin_check:
        raise HTTPException(status_code=403, detail="Only Admins can invite users.")

    invited_user = db.query(User).filter(User.email == invite.email).first()
    if not invited_user:
        raise HTTPException(
            status_code=404, detail="User email not found. They must register first."
        )

    existing_membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=invited_user.id)
        .first()
    )
    if existing_membership:
        raise HTTPException(
            status_code=400, detail="User is already in this workspace."
        )

    new_membership = WorkspaceMembership(
        workspace_id=workspace_id, user_id=invited_user.id, role=invite.role
    )

    # Database In-App Notification
    msg = f"You were invited to workspace: {workspace.name}"
    notification = Notification(user_id=invited_user.id, message=msg)

    db.add(notification)
    db.add(new_membership)
    db.commit()
    db.refresh(new_membership)

    # High-Priority Email Trigger
    background_tasks.add_task(
        send_notification_email,
        to_email=invited_user.email,
        subject=f"Welcome to Orbit - You've been invited to {workspace.name}",
        body=msg,
    )

    return new_membership


@app.put(
    "/workspaces/{workspace_id}/members/{user_id}",
    response_model=schemas.WorkspaceMembershipResponse,
)
def update_member_role(
    workspace_id: int,
    user_id: int,
    role_update: schemas.RoleUpdate,
    background_tasks: BackgroundTasks,  # TIER 1 NOTIFICATION ADDED
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

    target_membership.role = role_update.role
    db.commit()
    db.refresh(target_membership)

    # Notify the user of security/role change
    target_user = db.query(User).filter_by(id=user_id).first()
    workspace = db.query(Workspace).filter_by(id=workspace_id).first()

    if not target_user or not workspace:
        raise HTTPException(status_code=404, detail="User or Workspace not found")

    msg = f"Your role in {workspace.name} has been updated to '{role_update.role}'."
    db.add(Notification(user_id=user_id, message=msg))
    db.commit()

    # High-Priority Email Trigger
    background_tasks.add_task(
        send_notification_email,
        to_email=target_user.email,
        subject="Orbit Security Alert: Role Updated",
        body=msg,
    )

    return target_membership


@app.delete("/workspaces/{workspace_id}/members/{user_id}")
def remove_member(
    workspace_id: int,
    user_id: int,
    background_tasks: BackgroundTasks,  # TIER 1 NOTIFICATION ADDED
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

    if current_user.id != user_id:
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
                detail=(
                    "Cannot remove the last admin. "
                    "Promote another user to admin or delete the workspace."
                ),
            )

    workspace = db.query(Workspace).filter_by(id=workspace_id).first()
    target_user = db.query(User).filter_by(id=user_id).first()

    if not target_user or not workspace:
        raise HTTPException(status_code=404, detail="User or Workspace not found")

    db.delete(target_membership)
    db.commit()

    # Only send email if the user was kicked out by an admin (not if they left voluntarily)
    if current_user.id != user_id:
        msg = f"Your access to the workspace '{workspace.name}' has been revoked."
        background_tasks.add_task(
            send_notification_email,
            to_email=target_user.email,
            subject="Orbit Security Alert: Workspace Access Revoked",
            body=msg,
        )

    return {"status": "success", "message": "User successfully removed from workspace."}


@app.delete("/workspaces/{workspace_id}")
def delete_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted == False)
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership or membership.role != "admin":
        raise HTTPException(
            status_code=403, detail="Not authorized. Admin access required."
        )

    workspace.is_deleted = True
    workspace.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "success", "message": "Workspace moved to trash"}


@app.get(
    "/workspaces/{workspace_id}/analytics", response_model=schemas.AnalyticsResponse
)
def get_workspace_analytics(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = (
        db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized")

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

    return {
        "total_tasks": total_tasks,
        "status_counts": status_counts,
        "overdue_tasks": overdue_tasks,
    }


# ==========================================
# PROJECT ROUTES
# ==========================================
@app.post("/projects/", response_model=schemas.ProjectResponse)
def create_project(
    project: schemas.ProjectCreate,
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
            status_code=403, detail="Admin required to create projects."
        )

    new_project = Project(
        name=project.name,
        description=project.description,
        workspace_id=project.workspace_id,
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return new_project


@app.get(
    "/workspaces/{workspace_id}/projects", response_model=List[schemas.ProjectResponse]
)
def get_workspace_projects(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if (
        not db.query(WorkspaceMembership)
        .filter_by(workspace_id=workspace_id, user_id=current_user.id)
        .first()
    ):
        raise HTTPException(status_code=403, detail="Not authorized.")
    return (
        db.query(Project).filter_by(workspace_id=workspace_id, is_deleted=False).all()
    )


@app.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_deleted == False)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == project.workspace_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership or membership.role != "admin":
        raise HTTPException(
            status_code=403, detail="Not authorized. Admin access required."
        )

    project.is_deleted = True
    project.deleted_at = datetime.now(timezone.utc)
    db.commit()

    # TRIGGER REAL-TIME BROADCAST: Tell everyone looking at this board to leave
    background_tasks.add_task(
        manager.broadcast_to_project,
        project_id,
        {"event": "project_deleted", "project_id": project_id},
    )

    return {"status": "success", "message": "Project moved to trash"}


# ==========================================
# TASK ROUTES
# ==========================================
@app.post("/projects/{project_id}/tasks", response_model=schemas.TaskResponse)
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
    )

    if task.assignee_id and task.assignee_id != current_user.id:
        db.add(
            Notification(
                user_id=task.assignee_id,
                message=f"You were assigned to a new task: {task.title}",
            )
        )

    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    # TRIGGER REAL-TIME BROADCAST
    background_tasks.add_task(
        manager.broadcast_to_project,
        project_id,
        {"event": "task_created", "task_id": new_task.id},
    )

    return new_task


@app.get("/projects/{project_id}/tasks", response_model=List[schemas.TaskResponse])
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
        .filter_by(workspace_id=project.workspace_id, user_id=current_user.id)
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


@app.put("/tasks/{task_id}", response_model=schemas.TaskResponse)
def update_task_status(
    task_id: int,
    task_update: schemas.TaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
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

    task.status = task_update.status
    db.commit()
    db.refresh(task)

    # TRIGGER REAL-TIME BROADCAST
    background_tasks.add_task(
        manager.broadcast_to_project,
        task.project_id,
        {"event": "task_updated", "task_id": task.id, "new_status": task.status},
    )

    return task


@app.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
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

    # TRIGGER REAL-TIME BROADCAST
    background_tasks.add_task(
        manager.broadcast_to_project,
        task.project_id,
        {"event": "task_deleted", "task_id": task_id},
    )

    return {"status": "success", "message": "Task moved to trash"}


# ==========================================
# COMMENTS & NOTIFICATIONS
# ==========================================
@app.post("/tasks/{task_id}/comments", response_model=schemas.CommentResponse)
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
            message=f"{current_user.email} commented on your task: {task.title}",
        )
        db.add(notif)

    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)

    # TRIGGER REAL-TIME BROADCAST
    background_tasks.add_task(
        manager.broadcast_to_project,
        task.project_id,
        {"event": "comment_added", "task_id": task_id, "comment_id": new_comment.id},
    )

    return new_comment


@app.get("/tasks/{task_id}/comments", response_model=List[schemas.CommentResponse])
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


@app.get("/notifications", response_model=List[schemas.NotificationResponse])
def get_user_notifications(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return (
        db.query(Notification)
        .filter_by(user_id=current_user.id)
        .order_by(Notification.created_at.desc())
        .all()
    )


@app.put("/notifications/{notif_id}/read", response_model=schemas.NotificationResponse)
def mark_notification_read(
    notif_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = (
        db.query(Notification).filter_by(id=notif_id, user_id=current_user.id).first()
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    notif.is_read = True
    db.commit()
    db.refresh(notif)
    return notif


@app.get("/users/me", response_model=schemas.UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/")
def read_root():
    return {"message": "Orbit Backend MVP V1 running!"}
