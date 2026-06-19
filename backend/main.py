import os
from dotenv import load_dotenv
import redis
from fastapi import Request, FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from database import get_db, User, Workspace, Project, Task, WorkspaceMembership
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

load_dotenv()

app = FastAPI()

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
        # 1. Decode the token payload
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        expire_timestamp = payload.get("exp")

        # 2. THE GUARD CLAUSE: Explicitly handle the 'None' case
        if expire_timestamp is None:
            raise HTTPException(
                status_code=401, detail="Invalid token: Missing expiration claim"
            )

        # 3. Safe Math: Pylance now knows expire_timestamp is definitely a float
        current_timestamp = datetime.now(timezone.utc).timestamp()
        time_remaining = int(expire_timestamp - current_timestamp)

        # 4. Blacklist the token in Redis
        if time_remaining > 0:
            redis_client.set(name=token, value="revoked", ex=time_remaining)

        return {"status": "success", "message": "Successfully logged out"}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ==========================================
# WORKSPACE & PROJECT ROUTES
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
    )  # noqa: E712


# MVP Req 2: Invite Users to Workspace
@app.post(
    "/workspaces/{workspace_id}/members",
    response_model=schemas.WorkspaceMembershipResponse,
)
def invite_user_to_workspace(
    workspace_id: int,
    invite: schemas.WorkspaceInvite,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.is_deleted.is_(False))
        .first()
    )  # noqa: E712
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
    db.add(new_membership)
    db.commit()
    db.refresh(new_membership)
    return new_membership


# MVP Req 9: Analytics Dashboard
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
    )  # noqa: E712

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
    )  # noqa: E712

    # Process SQLAlchemy Aggregation into a dictionary
    status_counts = {status: count for status, count in status_aggregation}

    # Count Overdue
    current_time = datetime.now(timezone.utc)
    overdue_tasks = tasks_query.filter(
        Task.due_date < current_time, Task.status != "Done"
    ).count()

    return {
        "total_tasks": total_tasks,
        "status_counts": status_counts,
        "overdue_tasks": overdue_tasks,
    }


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


# ==========================================
# TASK ROUTES (Search & Filters)
# ==========================================
@app.post("/projects/{project_id}/tasks", response_model=schemas.TaskResponse)
def create_task(
    project_id: int,
    task: schemas.TaskCreate,
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
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


# MVP Req 8: Deep Search & Filtering
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
    if not membership or membership.role not in ["admin", "editor"]:
        raise HTTPException(status_code=403, detail="Editor access required.")

    task.status = task_update.status
    db.commit()
    db.refresh(task)
    return task


@app.get("/")
def read_root():
    return {"message": "Orbit Backend MVP V1 running!"}
