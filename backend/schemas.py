from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List, Literal
import re


# ==========================================
# 1. USER SCHEMAS
# ==========================================
class UserBase(BaseModel):
    email: str


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    id: int
    email: str

    # Required in Pydantic v2 to read SQLAlchemy models
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 2. RBAC MEMBERSHIP SCHEMAS
# ==========================================
class WorkspaceMembershipResponse(BaseModel):
    id: int
    user_id: int
    role: str
    user: UserResponse  # Nested user details so the frontend can display emails

    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 3. WORKSPACE SCHEMAS
# ==========================================
class WorkspaceBase(BaseModel):
    name: str


class WorkspaceCreate(WorkspaceBase):
    pass


class WorkspaceResponse(WorkspaceBase):
    id: int
    name: str
    # V2 Architecture: Return memberships (with roles) instead of raw members
    memberships: List[WorkspaceMembershipResponse] = []

    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 4. PROJECT SCHEMAS
# ==========================================
class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    workspace_id: int


class ProjectCreate(ProjectBase):
    pass


class ProjectResponse(ProjectBase):
    id: int
    name: str
    description: Optional[str] = None
    workspace_id: int

    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 5. TASK SCHEMAS
# ==========================================
class TaskBase(BaseModel):
    # ANTI-OOM: Strictly limit lengths
    title: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    priority_level: int = 1
    assignee_id: Optional[int] = None

    # ANTI-XSS: Reject HTML/Script tags
    @field_validator("title", "description")
    @classmethod
    def check_xss(cls, v):
        if v is not None and re.search(r"<[^>]*>", v):
            raise ValueError("HTML tags and scripts are strictly forbidden.")
        return v


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    # ANTI-CORRUPTION: Strictly limit allowed task states
    status: Literal["To Do", "In Progress", "Done"]


class TaskResponse(TaskBase):
    id: int
    project_id: int
    status: str

    model_config = ConfigDict(from_attributes=True)
