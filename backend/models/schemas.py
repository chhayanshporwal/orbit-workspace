from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    EmailStr,
    model_validator,
)
from typing import Optional, List, Literal
from datetime import datetime
import re


# ==========================================
# 1. USER SCHEMAS
# ==========================================
class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = Field(None, max_length=100)


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)
    name: Optional[str] = Field(None, max_length=100)

    @field_validator("password", "name")
    @classmethod
    def check_xss_and_complexity(cls, v, info):
        if v is not None:
            if info.field_name == "name" and re.search(r"<[^>]*>", v):
                raise ValueError("HTML tags and scripts are strictly forbidden.")
            if info.field_name == "password":
                if len(v) < 8:
                    raise ValueError("Password must be at least 8 characters")
                if not re.search(r"[A-Z]", v):
                    raise ValueError("Password must contain an uppercase letter")
                if not re.search(r"\d", v):
                    raise ValueError("Password must contain a number")
                if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
                    raise ValueError("Password must contain a special character")
        return v


class UserResponse(UserBase):
    id: int
    deletion_scheduled_at: Optional[datetime] = None

    @model_validator(mode="after")
    def obfuscate_deleted_user(self):
        if getattr(self, "deletion_scheduled_at", None):
            old_name = self.name or "User"
            self.name = f"Deleted User ({old_name})"
            self.email = "deleted@orbit.com"
        return self

    model_config = ConfigDict(from_attributes=True)


class UserProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    current_password: Optional[str] = None

    @field_validator("name", "password")
    @classmethod
    def check_xss_and_complexity(cls, v, info):
        if v is not None:
            if info.field_name == "name" and re.search(r"<[^>]*>", v):
                raise ValueError("HTML tags and scripts are strictly forbidden.")
            if info.field_name == "password":
                if len(v) < 8:
                    raise ValueError("Password must be at least 8 characters")
                if not re.search(r"[A-Z]", v):
                    raise ValueError("Password must contain an uppercase letter")
                if not re.search(r"\d", v):
                    raise ValueError("Password must contain a number")
                if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
                    raise ValueError("Password must contain a special character")
        return v


# ==========================================
# 2. RBAC MEMBERSHIP SCHEMAS
# ==========================================
class WorkspaceMembershipResponse(BaseModel):
    id: int
    user_id: int
    role: str
    user: UserResponse
    is_pending: bool = True
    status: str = "invited"
    invited_at: Optional[datetime] = None
    joined_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class WorkspaceInvite(BaseModel):
    email: EmailStr
    role: Literal["admin", "editor", "viewer"]


class RoleUpdate(BaseModel):
    role: Literal["admin", "editor", "viewer"]


# ==========================================
# 3. WORKSPACE SCHEMAS
# ==========================================
class WorkspaceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)

    @field_validator("name")
    @classmethod
    def check_xss(cls, v):
        if v is not None and re.search(r"<[^>]*>", v):
            raise ValueError("HTML tags and scripts are strictly forbidden.")
        return v


class WorkspaceCreate(WorkspaceBase):
    pass


class WorkspaceUpdate(WorkspaceBase):
    pass


class WorkspaceResponse(WorkspaceBase):
    id: int
    name: str
    description: str | None = None
    created_at: Optional[datetime] = None
    memberships: List[WorkspaceMembershipResponse] = []
    model_config = ConfigDict(from_attributes=True)


class WorkspaceInvitationResponse(BaseModel):
    id: int
    role: str
    workspace_id: int
    workspace: WorkspaceResponse
    is_pending: bool
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 4. PROJECT SCHEMAS
# ==========================================
class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    workspace_id: int

    @field_validator("name", "description")
    @classmethod
    def check_xss(cls, v):
        if v is not None and re.search(r"<[^>]*>", v):
            raise ValueError("HTML tags and scripts are strictly forbidden.")
        return v


class ProjectCreate(ProjectBase):
    pass


class ProjectResponse(ProjectBase):
    id: int
    name: str
    description: Optional[str] = None
    workspace_id: int
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 5. TASK SCHEMAS
# ==========================================
class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    priority_level: int = Field(default=1, ge=1, le=5)
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
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    priority_level: Optional[int] = Field(None, ge=1, le=5)
    assignee_id: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[Literal["To Do", "In Progress", "Done"]] = None
    reassignment_reason: Optional[str] = Field(None, max_length=500)

    @field_validator("title", "description")
    @classmethod
    def check_xss(cls, v):
        if v is not None and re.search(r"<[^>]*>", v):
            raise ValueError("HTML tags and scripts are strictly forbidden.")
        return v


class TaskEditHistoryResponse(BaseModel):
    id: int
    task_id: int
    editor_id: Optional[int] = None
    edited_at: datetime
    field_name: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    editor: Optional[UserResponse] = None
    model_config = ConfigDict(from_attributes=True)


class TaskResponse(TaskBase):
    id: int
    project_id: int
    status: str
    assignor_id: Optional[int] = None
    assignor: Optional[UserResponse] = None
    reassignment_reason: Optional[str] = None
    edit_histories: List[TaskEditHistoryResponse] = []
    model_config = ConfigDict(from_attributes=True)


# ==========================================
# 5.5 USER SECURITY SCHEMAS
# ==========================================
class UserVerify(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def check_password_complexity(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain an uppercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain a number")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
            raise ValueError("Password must contain a special character")
        return v


class VerifyResetOTPRequest(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=6, max_length=6)


class DeletionScheduleRequest(BaseModel):
    password: Optional[str] = None
    otp: Optional[str] = None


# ==========================================
# 6. ANALYTICS SCHEMAS
# ==========================================
class BottleneckReport(BaseModel):
    user_email: str
    overdue_count: int


class AnalyticsResponse(BaseModel):
    total_tasks: int
    status_counts: dict[str, int]
    overdue_tasks: int
    bottlenecks: List[BottleneckReport] = []


# ==========================================
# 7. COMMENTS, NOTIFICATIONS & AUDIT LOGS
# ==========================================
class CommentBase(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)

    @field_validator("content")
    @classmethod
    def check_xss(cls, v):
        if v is not None and re.search(r"<[^>]*>", v):
            raise ValueError("HTML tags and scripts are strictly forbidden.")
        return v


class CommentCreate(CommentBase):
    pass


class CommentResponse(CommentBase):
    id: int
    content: str
    created_at: datetime
    task_id: int
    author_id: int
    author: UserResponse
    model_config = ConfigDict(from_attributes=True)


class NotificationResponse(BaseModel):
    id: int
    message: str
    is_read: bool
    created_at: datetime
    user_id: int
    workspace_id: Optional[int] = None
    target_user_id: Optional[int] = None
    membership_id: Optional[int] = None
    model_config = ConfigDict(from_attributes=True)


class RegistrationResponse(BaseModel):
    email: EmailStr
    status: str
    message: str


class AuditLogResponse(BaseModel):
    id: int
    action: str
    details: str
    created_at: datetime
    workspace_id: Optional[int] = None
    project_id: Optional[int] = None
    user_id: Optional[int] = None
    user: Optional[UserResponse] = None
    model_config = ConfigDict(from_attributes=True)


class UserSessionResponse(BaseModel):
    id: int
    device_id: str
    device_name: Optional[str] = None
    ip_address: Optional[str] = None
    location: Optional[str] = None
    is_active: bool
    login_at: datetime
    logout_at: Optional[datetime] = None
    last_activity_at: datetime
    is_current_session: Optional[bool] = False
    model_config = ConfigDict(from_attributes=True)


class GoogleLoginRequest(BaseModel):
    code: str
    redirect_uri: str
