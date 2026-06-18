from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, get_db, User, Workspace, Project, Task
from sqlalchemy.orm import Session
import bcrypt  
import schemas
from typing import List
import jwt
from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# BCRYPT PASSWORD HASHING
# ==========================================
def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

# ==========================================
# SECURITY SETTINGS
# ==========================================
SECRET_KEY = "orbit-super-secret-development-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ==========================================
# USER ROUTES
# ==========================================
@app.post("/users/", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    existing_user=db.query(User).filter(User.email==user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pw = get_password_hash(user.password)
    new_user = User(email=user.email, hashed_password=hashed_pw)
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401, 
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
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
# WORKSPACE ROUTES
# ==========================================
@app.post("/workspaces/", response_model=schemas.WorkspaceResponse)
def create_workspace(
    workspace: schemas.WorkspaceCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    new_workspace = Workspace(name=workspace.name)
    new_workspace.members.append(current_user)
    
    db.add(new_workspace)
    db.commit()
    db.refresh(new_workspace)
    return new_workspace

@app.get("/users/{user_id}/workspaces", response_model=List[schemas.WorkspaceResponse])
def get_user_workspaces(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user.workspaces

# ==========================================
# PROJECT ROUTES
# ==========================================
@app.post("/projects/", response_model=schemas.ProjectResponse)
def create_project(
    project: schemas.ProjectCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) 
):
    workspace = db.query(Workspace).filter(Workspace.id == project.workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    if current_user not in workspace.members:
        raise HTTPException(status_code=403, detail="Not authorized to access this workspace")

    new_project = Project(
        name=project.name, 
        description=project.description, 
        workspace_id=project.workspace_id
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return new_project

@app.get("/workspaces/{workspace_id}/projects", response_model=List[schemas.ProjectResponse])
def get_workspace_projects(
    workspace_id: int, 
    skip: int = 0,     # <-- Start at record 0
    limit: int = 100,  # <-- Cap at 100 records
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) 
):
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace or current_user not in workspace.members:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    return db.query(Project).filter(Project.workspace_id == workspace_id).offset(skip).limit(limit).all()

# ==========================================
# TASK ROUTES (The Kanban Core)
# ==========================================
@app.post("/projects/{project_id}/tasks", response_model=schemas.TaskResponse)
def create_task(
    project_id: int, 
    task: schemas.TaskCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) 
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if current_user not in project.workspace.members:
        raise HTTPException(status_code=403, detail="Not authorized to modify this project")

    new_task = Task(
        title=task.title,
        description=task.description,
        priority_level=task.priority_level,
        project_id=project_id,
        assignee_id=task.assignee_id
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task

@app.get("/projects/{project_id}/tasks", response_model=List[schemas.TaskResponse])
def get_project_tasks(
    project_id: int, 
    skip: int = 0,     # <-- Start at record 0
    limit: int = 100,  # <-- Cap at 100 records
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) 
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or current_user not in project.workspace.members:
        raise HTTPException(status_code=404, detail="Project not found")
        
    return db.query(Task).filter(Task.project_id == project_id).offset(skip).limit(limit).all()

@app.put("/tasks/{task_id}", response_model=schemas.TaskResponse)
def update_task_status(
    task_id: int, 
    task_update: schemas.TaskUpdate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user) 
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if current_user not in task.project.workspace.members:
        raise HTTPException(status_code=403, detail="Not authorized to modify this task")
    
    task.status = task_update.status 
    db.commit()
    db.refresh(task)
    return task

# ==========================================
# ROOT ROUTE
# ==========================================
@app.get("/")
def read_root():
    return {"status": "success", "message": "Orbit Backend is officially running!"}