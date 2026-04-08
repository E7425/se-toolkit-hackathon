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
    start_time = Column(String(5), default="")
    end_time = Column(String(5), default="")
    estimated_hours = Column(Float, nullable=False)
    completed = Column(Boolean, default=False)

    assignment = relationship("Assignment", back_populates="subtasks")


# Create all tables first
Base.metadata.create_all(bind=engine)


# Auto-migrate: add time columns if they don't exist (after table creation)
def _migrate_add_time_columns():
    """Add start_time/end_time columns if they don't exist."""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "subtasks" not in inspector.get_table_names():
        return
    columns = [col["name"] for col in inspector.get_columns("subtasks")]
    with engine.connect() as conn:
        if "start_time" not in columns:
            conn.execute(text("ALTER TABLE subtasks ADD COLUMN start_time VARCHAR(5)"))
            conn.commit()
        if "end_time" not in columns:
            conn.execute(text("ALTER TABLE subtasks ADD COLUMN end_time VARCHAR(5)"))
            conn.commit()


_migrate_add_time_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
