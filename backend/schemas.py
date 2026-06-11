from pydantic import BaseModel
from datetime import datetime
from typing import Optional

# ==========================================
# USER SCHEMAS
# ==========================================
class UserCreate(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    role: str

    class Config:
        from_attributes = True

# ==========================================
# WORKSPACE SCHEMAS
# ==========================================
class WorkspaceCreate(BaseModel):
    name: str
    owner_id: int # In a real app, this comes from the JWT token, but we will pass it manually for now

class WorkspaceResponse(BaseModel):
    id: int
    name: str
    owner_id: int

    class Config:
        from_attributes = True

# ==========================================
# PROJECT SCHEMAS
# ==========================================
class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    workspace_id: int

class ProjectResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    workspace_id: int

    class Config:
        from_attributes = True

# ==========================================
# TASK SCHEMAS
# ==========================================
class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority_level: int = 1
    assignee_id: Optional[int] = None

class TaskUpdate(BaseModel):
    status: str # Used for moving "To Do" -> "In Progress"
    
class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    status: str
    priority_level: int
    project_id: int
    assignee_id: Optional[int] = None

    class Config:
        from_attributes = True