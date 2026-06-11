from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional
from enum import Enum

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

    model_config = ConfigDict(from_attributes=True)

# ==========================================
# WORKSPACE SCHEMAS
# ==========================================
class WorkspaceCreate(BaseModel):
    name: str

class WorkspaceResponse(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)

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

    model_config = ConfigDict(from_attributes=True)

# ==========================================
# TASK SCHEMAS
# ==========================================
class TaskStatus(str, Enum):
    TODO = "To Do"
    IN_PROGRESS = "In Progress"
    DONE = "Done"

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority_level: int = 1
    assignee_id: Optional[int] = None

class TaskUpdate(BaseModel):
    status: TaskStatus 
    
class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    status: TaskStatus 
    priority_level: int
    project_id: int
    assignee_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)