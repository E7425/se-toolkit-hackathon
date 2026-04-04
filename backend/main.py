from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List
import logging
from dotenv import load_dotenv

load_dotenv()

from database import get_db, Assignment, Subtask
from schemas import (
    AssignmentCreate,
    AssignmentResponse,
    AssignmentDetail,
    SubtaskResponse,
    SubtaskUpdate,
)
from llm import generate_subtasks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Study Timeline API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/assignments", response_model=AssignmentDetail)
async def create_assignment(data: AssignmentCreate, db: Session = Depends(get_db)):
    """Create assignment and generate subtasks via LLM."""
    assignment = Assignment(
        title=data.title,
        course_code=data.course_code,
        deadline=data.deadline,
        estimated_hours=data.estimated_hours,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    # Generate subtasks
    try:
        llm_subtasks = await generate_subtasks(
            title=assignment.title,
            course_code=assignment.course_code,
            deadline=assignment.deadline,
            estimated_hours=assignment.estimated_hours,
        )

        for sub in llm_subtasks:
            scheduled_date = assignment.deadline - timedelta(days=sub.day_offset)
            db_subtask = Subtask(
                assignment_id=assignment.id,
                title=sub.title,
                description=sub.description,
                scheduled_date=scheduled_date,
                estimated_hours=sub.estimated_hours,
            )
            db.add(db_subtask)

        db.commit()
        db.refresh(assignment)

    except Exception as e:
        logger.error(f"Subtask generation failed: {e}")
        # Assignment still gets created even if LLM fails

    # Load subtasks
    db.refresh(assignment)
    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()

    return AssignmentDetail(
        id=assignment.id,
        title=assignment.title,
        course_code=assignment.course_code,
        deadline=assignment.deadline,
        estimated_hours=assignment.estimated_hours,
        created_at=assignment.created_at,
        completed=assignment.completed,
        subtasks=[
            SubtaskResponse(
                id=s.id,
                assignment_id=s.assignment_id,
                title=s.title,
                description=s.description,
                scheduled_date=s.scheduled_date,
                estimated_hours=s.estimated_hours,
                completed=s.completed,
            )
            for s in subtasks
        ],
    )


@app.get("/api/assignments", response_model=List[AssignmentDetail])
def list_assignments(db: Session = Depends(get_db)):
    """List all assignments with subtasks."""
    assignments = db.query(Assignment).order_by(Assignment.deadline).all()
    result = []
    for a in assignments:
        subtasks = db.query(Subtask).filter(Subtask.assignment_id == a.id).all()
        result.append(AssignmentDetail(
            id=a.id,
            title=a.title,
            course_code=a.course_code,
            deadline=a.deadline,
            estimated_hours=a.estimated_hours,
            created_at=a.created_at,
            completed=a.completed,
            subtasks=[
                SubtaskResponse(
                    id=s.id,
                    assignment_id=s.assignment_id,
                    title=s.title,
                    description=s.description,
                    scheduled_date=s.scheduled_date,
                    estimated_hours=s.estimated_hours,
                    completed=s.completed,
                )
                for s in subtasks
            ],
        ))
    return result


@app.get("/api/assignments/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(assignment_id: int, db: Session = Depends(get_db)):
    """Get assignment with subtasks."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment_id).all()

    return AssignmentDetail(
        id=assignment.id,
        title=assignment.title,
        course_code=assignment.course_code,
        deadline=assignment.deadline,
        estimated_hours=assignment.estimated_hours,
        created_at=assignment.created_at,
        completed=assignment.completed,
        subtasks=[
            SubtaskResponse(
                id=s.id,
                assignment_id=s.assignment_id,
                title=s.title,
                description=s.description,
                scheduled_date=s.scheduled_date,
                estimated_hours=s.estimated_hours,
                completed=s.completed,
            )
            for s in subtasks
        ],
    )


@app.patch("/api/subtasks/{subtask_id}", response_model=SubtaskResponse)
def update_subtask(subtask_id: int, data: SubtaskUpdate, db: Session = Depends(get_db)):
    """Toggle subtask completion."""
    subtask = db.query(Subtask).filter(Subtask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")

    subtask.completed = data.completed
    db.commit()
    db.refresh(subtask)

    # Update assignment completion status
    assignment = subtask.assignment
    all_subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    assignment.completed = all(s.completed for s in all_subtasks)
    db.commit()

    return SubtaskResponse(
        id=subtask.id,
        assignment_id=subtask.assignment_id,
        title=subtask.title,
        description=subtask.description,
        scheduled_date=subtask.scheduled_date,
        estimated_hours=subtask.estimated_hours,
        completed=subtask.completed,
    )


@app.delete("/api/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    """Delete assignment and its subtasks."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    db.delete(assignment)
    db.commit()
    return {"status": "deleted"}


@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
