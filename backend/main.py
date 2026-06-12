import os
from dotenv import load_dotenv
import redis
from fastapi import Request, FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import get_db, User, Workspace, Project, Task, WorkspaceMembership
from sqlalchemy.orm import Session
import bcrypt
import schemas
from typing import List
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
redis_client = redis.Redis(host="redis", port=6379, db=0, decode_responses=True)
limiter = Limiter(key_func=get_remote_address, storage_uri="redis://redis:6379/0")


def custom_rate_limit_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please wait a minute and try again."},
    )


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
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("FATAL ERROR: SECRET_KEY is missing. Check your .env file.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    # ANTI-GHOST: Check if this exact token is in the Redis blacklist!
    if redis_client.get(token):
        raise HTTPException(
            status_code=401, detail="Token has been revoked. Please log in again."
        )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception

    return user


# ==========================================
# AUTH ROUTES
# ==========================================
@app.post("/users/", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_pw = get_password_hash(user.password)
    new_user = User(email=user.email, hashed_password=hashed_pw)

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
    password = form_data.password

    # BOTNET DEFENSE
    lockout_key = f"lockout:{email}"
    failed_attempts_key = f"failed_attempts:{email}"

    if redis_client.get(lockout_key):
        raise HTTPException(
            status_code=403,
            detail="Account locked due to suspicious activity. Try again in 15 minutes.",  # noqa: E501
        )

    user = db.query(User).filter(User.email == email).first()

    # TIMING ATTACK DEFENSE
    dummy_hash = (
        "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjIQqiRQYq"  # noqa: E501
    )

    is_valid_password = False
    if user:
        is_valid_password = verify_password(password, user.hashed_password)
    else:
        verify_password(password, dummy_hash)

    # VALIDATION & LOCKOUT LOGIC
    if not user or not is_valid_password:
        redis_client.incr(failed_attempts_key)

        if redis_client.ttl(failed_attempts_key) == -1:
            redis_client.expire(failed_attempts_key, 600)

        attempts = int(redis_client.get(failed_attempts_key) or 0)

        if attempts >= 10:
            redis_client.set(name=lockout_key, value="locked", ex=900)
            redis_client.delete(failed_attempts_key)
            raise HTTPException(
                status_code=403,
                detail="Account locked due to suspicious activity. Try again in 15 minutes.",  # noqa: E501
            )

        raise HTTPException(status_code=400, detail="Incorrect email or password")

    redis_client.delete(failed_attempts_key)

    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/logout")
def logout(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        expire_timestamp = payload.get("exp")

        if expire_timestamp is None:
            raise HTTPException(
                status_code=401, detail="Invalid token: Missing expiration"
            )

        current_timestamp = datetime.now(timezone.utc).timestamp()
        time_remaining = int(expire_timestamp - current_timestamp)

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
    # The creator is automatically assigned the "admin" role
    admin_membership = WorkspaceMembership(user=current_user, role="admin")
    new_workspace.memberships.append(admin_membership)

    db.add(new_workspace)
    db.commit()
    db.refresh(new_workspace)
    return new_workspace


@app.get("/users/{user_id}/workspaces", response_model=List[schemas.WorkspaceResponse])
def get_user_workspaces(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Fetch Workspaces by joining through the new WorkspaceMembership table
    active_workspaces = (
        db.query(Workspace)
        .join(WorkspaceMembership, Workspace.id == WorkspaceMembership.workspace_id)
        .filter(
            WorkspaceMembership.user_id == user_id,
            Workspace.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    return active_workspaces


@app.delete("/workspaces/{workspace_id}")
def delete_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(
            Workspace.id == workspace_id, Workspace.is_deleted == False
        )  # noqa: E712
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # RBAC: Verify the user is an explicitly defined "admin"
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


# ==========================================
# PROJECT ROUTES
# ==========================================
@app.post("/projects/", response_model=schemas.ProjectResponse)
def create_project(
    project: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(
            Workspace.id == project.workspace_id, Workspace.is_deleted == False
        )  # noqa: E712
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # RBAC: Only Admins can create new projects inside a Workspace
    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == workspace.id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership or membership.role != "admin":
        raise HTTPException(
            status_code=403, detail="Not authorized. Admin access required."
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
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workspace = (
        db.query(Workspace)
        .filter(
            Workspace.id == workspace_id, Workspace.is_deleted == False
        )  # noqa: E712
        .first()
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # RBAC: Any member (Admin, Editor, or Viewer) can view projects
    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == workspace.id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership:
        raise HTTPException(
            status_code=403, detail="Not authorized to view this workspace."
        )

    return (
        db.query(Project)
        .filter(
            Project.workspace_id == workspace_id, Project.is_deleted == False
        )  # noqa: E712
        .offset(skip)
        .limit(limit)
        .all()
    )


@app.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_deleted == False)  # noqa: E712
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # RBAC: Only Admins can delete projects
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
    return {"status": "success", "message": "Project moved to trash"}


# ==========================================
# TASK ROUTES
# ==========================================
@app.post("/projects/{project_id}/tasks", response_model=schemas.TaskResponse)
def create_task(
    project_id: int,
    task: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_deleted == False)  # noqa: E712
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # RBAC: Admins and Editors can create tasks, Viewers cannot
    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == project.workspace_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership or membership.role not in ["admin", "editor"]:
        raise HTTPException(
            status_code=403, detail="Not authorized. Editor access required."
        )

    new_task = Task(
        title=task.title,
        description=task.description,
        priority_level=task.priority_level,
        project_id=project_id,
        assignee_id=task.assignee_id,
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@app.get("/projects/{project_id}/tasks", response_model=List[schemas.TaskResponse])
def get_project_tasks(
    project_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_deleted == False)  # noqa: E712
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # RBAC: Any member (Admin, Editor, or Viewer) can view tasks
    membership = (
        db.query(WorkspaceMembership)
        .filter(
            WorkspaceMembership.workspace_id == project.workspace_id,
            WorkspaceMembership.user_id == current_user.id,
        )
        .first()
    )

    if not membership:
        raise HTTPException(
            status_code=403, detail="Not authorized to view this project."
        )

    return (
        db.query(Task)
        .filter(Task.project_id == project_id, Task.is_deleted == False)  # noqa: E712
        .offset(skip)
        .limit(limit)
        .all()
    )


@app.put("/tasks/{task_id}", response_model=schemas.TaskResponse)
def update_task_status(
    task_id: int,
    task_update: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.is_deleted == False)  # noqa: E712
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # RBAC: Admins and Editors can edit tasks, Viewers cannot
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
    return task


@app.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.is_deleted == False)  # noqa: E712
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # RBAC: Admins and Editors can soft-delete tasks, Viewers cannot
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
    return {"status": "success", "message": "Task moved to trash"}


@app.get("/")
def read_root():
    return {"status": "success", "message": "Orbit Backend is officially running!"}
