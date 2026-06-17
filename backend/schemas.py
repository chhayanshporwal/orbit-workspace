from pydantic import BaseModel, ConfigDict, Field, field_validator, EmailStr
from typing import Optional, List, Literal, Dict
from datetime import datetime
import re


# ==========================================
# 1. USER SCHEMAS
# ==========================================
class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    # Strict validation: Minimum 8 characters for passwords
    password: str = Field(..., min_length=8, max_length=128)


class UserResponse(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 2. RBAC MEMBERSHIP SCHEMAS
# ==========================================
class WorkspaceMembershipResponse(BaseModel):
    id: int
    user_id: int
    role: str
    user: UserResponse
    model_config = ConfigDict(from_attributes=True)


class WorkspaceInvite(BaseModel):
    email: EmailStr
    role: Literal["admin", "editor", "viewer"]


# ==========================================
# 3. WORKSPACE SCHEMAS
# ==========================================
class WorkspaceBase(BaseModel):
    # Strict Validation: Cannot be empty, max 100 chars
    name: str = Field(..., min_length=1, max_length=100)


class WorkspaceCreate(WorkspaceBase):
    pass


class WorkspaceResponse(WorkspaceBase):
    id: int
    name: str
    memberships: List[WorkspaceMembershipResponse] = []
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 4. PROJECT SCHEMAS
# ==========================================
class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
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
    title: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    priority_level: int = Field(
        default=1, ge=1, le=5
    )  # Restrict priorities from 1 to 5
    assignee_id: Optional[int] = None
    due_date: Optional[datetime] = None

    @field_validator("title", "description")
    @classmethod
    def check_xss(cls, v):
        if v is not None and re.search(r"<[^>]*>", v):
            raise ValueError("HTML tags and scripts are strictly forbidden.")
        return v


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    status: Literal["To Do", "In Progress", "Done"]


class TaskResponse(TaskBase):
    id: int
    project_id: int
    status: str
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 6. ANALYTICS SCHEMAS (MVP Req 9)
# ==========================================
class AnalyticsResponse(BaseModel):
    total_tasks: int
    status_counts: Dict[str, int]
    overdue_tasks: int
