from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from datetime import datetime

import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////app/data/study_timeline.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    display_name = Column(String, default="")
    avatar_url = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    assignments = relationship("Assignment", back_populates="user", cascade="all, delete-orphan")
    group_memberships = relationship("GroupMember", back_populates="user", cascade="all, delete-orphan")
    owned_groups = relationship("Group", back_populates="owner", cascade="all, delete-orphan")


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    owner = relationship("User", back_populates="owned_groups")
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")
    invite_keys = relationship("InviteKey", back_populates="group", cascade="all, delete-orphan")
    assignments_rel = relationship("Assignment", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String, nullable=False)  # "owner", "admin", "member"
    joined_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("Group", back_populates="members")
    user = relationship("User", back_populates="group_memberships")


class InviteKey(Base):
    __tablename__ = "invite_keys"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    key = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

    group = relationship("Group", back_populates="invite_keys")


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    title = Column(String, nullable=False)
    course_code = Column(String, nullable=False)
    deadline = Column(DateTime, nullable=False)
    estimated_hours = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed = Column(Boolean, default=False)

    user = relationship("User", back_populates="assignments")
    group = relationship("Group", back_populates="assignments_rel")
    subtasks = relationship("Subtask", back_populates="assignment", cascade="all, delete-orphan")


class Subtask(Base):
    __tablename__ = "subtasks"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    scheduled_date = Column(DateTime, nullable=False)
    start_time = Column(String(5), default="")
    end_time = Column(String(5), default="")
    estimated_hours = Column(Float, nullable=False)
    completed = Column(Boolean, default=False)

    assignment = relationship("Assignment", back_populates="subtasks")


Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
