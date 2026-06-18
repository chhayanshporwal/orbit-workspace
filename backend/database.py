import os
from datetime import datetime
from typing import Optional, List
from sqlalchemy import create_engine, String, ForeignKey, DateTime, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship, sessionmaker, DeclarativeBase

# 1. The Connection String 
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql+psycopg2://orbit_admin:supersecretpassword@db:5432/orbit_database"
)

# 2. The Engine
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# 3. The Session 
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 4. The NEW SQLAlchemy 2.0 Base
class Base(DeclarativeBase):
    pass

# 5. The Dependency 
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================
# THE JOIN TABLE (For Team Members)
# ==========================================
workspace_members = Table(
    "workspace_members",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("workspace_id", ForeignKey("workspaces.id"), primary_key=True),
    Column("role", String, nullable=False, default="member") # "admin" or "member"
)

# ==========================================
# 1. THE USERS TABLE
# ==========================================
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="member") 

    workspaces: Mapped[List["Workspace"]] = relationship(secondary=workspace_members, back_populates="members")
    tasks: Mapped[List["Task"]] = relationship(back_populates="assignee")

# ==========================================
# 2. THE WORKSPACES TABLE
# ==========================================
class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    members: Mapped[List["User"]] = relationship(secondary=workspace_members, back_populates="workspaces")
    
    projects: Mapped[List["Project"]] = relationship(back_populates="workspace")

# ==========================================
# 3. THE PROJECTS TABLE
# ==========================================
class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"))

    workspace: Mapped["Workspace"] = relationship(back_populates="projects")
    tasks: Mapped[List["Task"]] = relationship(back_populates="project")

# ==========================================
# 4. THE TASKS TABLE
# ==========================================
class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="To Do")
    priority_level: Mapped[int] = mapped_column(default=1) 
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    project: Mapped["Project"] = relationship(back_populates="tasks")
    assignee: Mapped[Optional["User"]] = relationship(back_populates="tasks")