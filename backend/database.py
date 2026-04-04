from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from datetime import datetime

DATABASE_URL = "sqlite:///./study_timeline.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    course_code = Column(String, nullable=False)
    deadline = Column(DateTime, nullable=False)
    estimated_hours = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed = Column(Boolean, default=False)

    subtasks = relationship("Subtask", back_populates="assignment", cascade="all, delete-orphan")


class Subtask(Base):
    __tablename__ = "subtasks"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    scheduled_date = Column(DateTime, nullable=False)
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
