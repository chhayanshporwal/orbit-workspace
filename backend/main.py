from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, get_db, User, Workspace, Project, Task
from sqlalchemy.orm import Session
from passlib.context import CryptContext
import schemas
from typing import List
import jwt
from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

Base.metadata.create_all(bind=engine) 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# SECURITY SETTINGS
# ==========================================
# In a real app, this secret goes in an .env file so hackers can't see it.
# For local MVP development, this string is fine.
SECRET_KEY = "orbit-super-secret-development-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# This tells FastAPI where the frontend will go to get the token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def create_access_token(data: dict):
    to_encode = data.copy()
    # Set the expiration time
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    # Create the cryptographic string
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ==========================================
# USER ROUTES
# ==========================================
@app.post("users/", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    existing_user=db.query(User).filter(User.email==user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_pw=pwd_context.hash(user.password)
    new_user=User(email=user.email, hashed_password=hashed_pw)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # 1. Find the user in the database
    # (FastAPI's OAuth2 form always uses the variable name 'username', even if we use emails)
    user = db.query(User).filter(User.email == form_data.username).first()
    
    # 2. If no user, or the hashed password doesn't match the typed password, reject them
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
    # 3. Create the VIP wristband holding their email
    access_token = create_access_token(data={"sub": user.email})
    
    # 4. Hand it to the frontend
    return {"access_token": access_token, "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401, 
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # 1. Decode the token using our secret key
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str | None = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception
    
    # 2. Ensure the user actually still exists in the database
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
    current_user: User = Depends(get_current_user) # <-- THE SECURITY GUARD
):
    new_workspace = Workspace(name=workspace.name, owner_id=current_user.id)
    db.add(new_workspace)
    db.commit()
    db.refresh(new_workspace)
    return new_workspace

@app.get("/users/{user_id}/workspaces", response_model=List[schemas.WorkspaceResponse])
def get_user_workspaces(user_id: int, db: Session = Depends(get_db)):
    return db.query(Workspace).filter(Workspace.owner_id == user_id).all()

# ==========================================
# PROJECT ROUTES
# ==========================================
@app.post("/projects/", response_model=schemas.ProjectResponse)
def create_project(project: schemas.ProjectCreate, db: Session = Depends(get_db)):
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
def get_workspace_projects(workspace_id: int, db: Session = Depends(get_db)):
    return db.query(Project).filter(Project.workspace_id == workspace_id).all()

# ==========================================
# TASK ROUTES (The Kanban Core)
# ==========================================
@app.post("/projects/{project_id}/tasks", response_model=schemas.TaskResponse)
def create_task(project_id: int, task: schemas.TaskCreate, db: Session = Depends(get_db)):
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
def get_project_tasks(project_id: int, db: Session = Depends(get_db)):
    return db.query(Task).filter(Task.project_id == project_id).all()

# This is the route your React app will call when a user drags a card to a new column
@app.put("/tasks/{task_id}", response_model=schemas.TaskResponse)
def update_task_status(task_id: int, task_update: schemas.TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.status = task_update.status 
    db.commit()
    db.refresh(task)
    return task

@app.get("/")
def read_root():
    return {"status": "success", "message": "Orbit Backend is officially running!"}