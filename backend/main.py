from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, date
from typing import List, Dict
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


def _get_occupied_dates(db: Session) -> Dict[date, int]:
    """Return dict of date -> number of subtasks already scheduled on that date."""
    rows = db.query(func.date(Subtask.scheduled_date), func.count(Subtask.id)).group_by(
        func.date(Subtask.scheduled_date)
    ).all()
    return {datetime.strptime(r[0], "%Y-%m-%d").date(): r[1] for r in rows}


# Time slots for scheduling (start, end) as (hour, minute) tuples
TIME_SLOTS = [
    ((9, 0), (11, 0)),
    ((11, 0), (13, 0)),
    ((14, 0), (16, 0)),
    ((16, 0), (18, 0)),
    ((18, 0), (20, 0)),
    ((20, 0), (22, 0)),
]


def _get_occupied_time_slots(db: Session) -> Dict[date, list]:
    """Return dict of date -> list of occupied (start_time, end_time) strings."""
    rows = db.query(Subtask.scheduled_date, Subtask.start_time, Subtask.end_time).filter(
        Subtask.start_time != None, Subtask.start_time != "",
        Subtask.end_time != None, Subtask.end_time != ""
    ).all()
    result = {}
    for sched_dt, start_t, end_t in rows:
        if sched_dt is None:
            continue
        d = sched_dt.date() if hasattr(sched_dt, 'date') else datetime.strptime(sched_dt, "%Y-%m-%d").date()
        if d not in result:
            result[d] = []
        result[d].append((start_t, end_t))
    return result


def _fmt(hm):
    """Format (hour, minute) tuple to 'HH:MM' string."""
    return f"{hm[0]:02d}:{hm[1]:02d}"


def _pick_time_slot(hours: float, occupied_slots: list) -> tuple:
    """Pick a time slot that fits the estimated hours and isn't occupied. Returns (start_str, end_str)."""
    needed_minutes = int(hours * 60)
    for (sh, sm), (eh, em) in TIME_SLOTS:
        slot_minutes = (eh * 60 + em) - (sh * 60 + sm)
        if slot_minutes >= needed_minutes:
            start_str = f"{sh:02d}:{sm:02d}"
            is_occupied = any(s == start_str for s, e in occupied_slots)
            if not is_occupied:
                return start_str, f"{eh:02d}:{em:02d}"
    # Fallback: find any free slot
    for (sh, sm), (eh, em) in TIME_SLOTS:
        start_str = f"{sh:02d}:{sm:02d}"
        is_occupied = any(s == start_str for s, e in occupied_slots)
        if not is_occupied:
            return start_str, f"{eh:02d}:{em:02d}"
    # All occupied — assign evening
    return "20:00", "22:00"


def _distribute_subtasks(
    llm_subtasks,
    deadline: datetime,
    occupied_dates: Dict[date, int],
    occupied_slots: Dict[date, list],
) -> List[tuple]:
    """Assign each subtask to a unique date and time slot. Returns list of (date, start_str, end_str)."""
    today = date.today()
    deadline_date = deadline.date()
    days_available = (deadline_date - today).days
    if days_available < 1:
        days_available = 1

    sorted_subtasks = sorted(llm_subtasks, key=lambda s: s.day_offset, reverse=True)

    scheduled = []
    for sub in sorted_subtasks:
        preferred_date = deadline_date - timedelta(days=sub.day_offset)
        if preferred_date < today:
            preferred_date = today
        if preferred_date > deadline_date:
            preferred_date = deadline_date

        current = preferred_date
        attempts = 0
        max_attempts = days_available + 10
        while attempts < max_attempts:
            existing_count = occupied_dates.get(current, 0)
            if existing_count == 0 and current not in [s[0] for s in scheduled]:
                break
            current -= timedelta(days=1)
            if current < today:
                current = preferred_date + timedelta(days=1)
                if current > deadline_date:
                    current = deadline_date
            attempts += 1

        occupied_dates[current] = occupied_dates.get(current, 0) + 1
        day_slots = occupied_slots.get(current, [])
        start_t, end_t = _pick_time_slot(sub.estimated_hours, day_slots)
        occupied_slots.setdefault(current, []).append((start_t, end_t))
        scheduled.append((current, start_t, end_t))

    return scheduled


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

        occupied_dates = _get_occupied_dates(db)
        occupied_slots = _get_occupied_time_slots(db)
        scheduled = _distribute_subtasks(llm_subtasks, assignment.deadline, occupied_dates, occupied_slots)

        for sub, (sched_date, start_t, end_t) in zip(llm_subtasks, scheduled):
            db_subtask = Subtask(
                assignment_id=assignment.id,
                title=sub.title,
                description=sub.description,
                scheduled_date=datetime.combine(sched_date, datetime.min.time()),
                start_time=start_t,
                end_time=end_t,
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
                start_time=s.start_time,
                end_time=s.end_time,
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
                    start_time=s.start_time,
                    end_time=s.end_time,
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
                start_time=s.start_time,
                end_time=s.end_time,
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
        start_time=subtask.start_time,
        end_time=subtask.end_time,
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
