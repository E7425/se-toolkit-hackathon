from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime, timedelta, date
from typing import List, Dict, Optional
import logging
from dotenv import load_dotenv

load_dotenv()

from database import get_db, User, Assignment, Subtask, Group, GroupMember, InviteKey
from schemas import (
    UserRegister, UserLogin, TokenResponse, UserResponse, UserProfileUpdate, UserAvatarUpdate, UserStats,
    AssignmentCreate, AssignmentResponse, AssignmentDetail, ManualAssignmentCreate,
    SubtaskResponse, SubtaskUpdate, SubtaskTimeUpdate, SubtaskFullUpdate,
    GroupCreate, GroupResponse, GroupDetail, GroupMemberInfo, InviteKeyResponse, JoinGroupRequest, UpdateMemberRole,
    GroupAssignmentCreate, GroupManualAssignmentCreate, GroupAssignmentDetail,
    SubtaskMove,
)
from auth import (
    verify_password, get_password_hash, create_access_token, get_current_user
)
from llm import generate_subtasks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Study Timeline API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== Auth Endpoints =====

@app.post("/api/auth/register", response_model=UserResponse)
def register(data: UserRegister, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        display_name=data.display_name or data.email.split("@")[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": user.email})
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)):
    return user


@app.patch("/api/auth/profile", response_model=UserResponse)
def update_profile(data: UserProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.display_name:
        user.display_name = data.display_name
    db.commit()
    db.refresh(user)
    return user


@app.patch("/api/auth/avatar", response_model=UserResponse)
def update_avatar(data: UserAvatarUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update user avatar (base64 image or URL)."""
    user.avatar_url = data.avatar_url
    db.commit()
    db.refresh(user)
    return user


@app.get("/api/auth/stats", response_model=UserStats)
def get_stats(
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get user statistics for a given period."""
    query = db.query(Subtask).join(Assignment).filter(Assignment.user_id == user.id)

    if period_start:
        query = query.filter(Subtask.scheduled_date >= period_start)
    if period_end:
        query = query.filter(Subtask.scheduled_date <= period_end)

    completed_subtasks = query.filter(Subtask.completed == True).all()
    completed_assignments = db.query(Assignment).filter(
        Assignment.user_id == user.id,
        Assignment.completed == True,
    )
    if period_start:
        completed_assignments = completed_assignments.filter(Assignment.deadline >= period_start)
    if period_end:
        completed_assignments = completed_assignments.filter(Assignment.deadline <= period_end)

    total_hours = sum(s.estimated_hours for s in completed_subtasks)

    return UserStats(
        total_completed_hours=round(total_hours, 1),
        total_completed_tasks=len(completed_subtasks),
        total_completed_assignments=completed_assignments.count(),
        period_start=period_start or "",
        period_end=period_end or "",
    )


# ===== Helper Functions =====

def _get_occupied_dates(db: Session, user_id: int) -> Dict[date, int]:
    rows = db.query(func.date(Subtask.scheduled_date), func.count(Subtask.id)).join(
        Assignment
    ).filter(Assignment.user_id == user_id).group_by(
        func.date(Subtask.scheduled_date)
    ).all()
    return {datetime.strptime(r[0], "%Y-%m-%d").date(): r[1] for r in rows}


def _get_occupied_time_slots(db: Session, user_id: int) -> Dict[date, list]:
    rows = db.query(Subtask.scheduled_date, Subtask.start_time, Subtask.end_time).join(
        Assignment
    ).filter(
        Assignment.user_id == user_id,
        Subtask.start_time != None, Subtask.start_time != "",
        Subtask.end_time != None, Subtask.end_time != "",
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


def _time_to_minutes(t: str) -> int:
    h, m = t.split(':')
    return int(h) * 60 + int(m)

def _ranges_overlap(s1: int, e1: int, s2: int, e2: int) -> bool:
    """Check if two time ranges overlap."""
    return s1 < e2 and s2 < e1

def _pick_time_slot(hours: float, occupied_slots: list) -> tuple:
    needed_minutes = int(round(hours * 60))
    for (sh, sm) in [(8,0), (10,0), (12,0), (14,0), (16,0), (18,0), (20,0)]:
        start_str = f"{sh:02d}:{sm:02d}"
        start_mins = sh * 60 + sm
        end_mins = start_mins + needed_minutes
        # Check for actual time range overlap, not just start time equality
        is_overlapping = False
        for (occ_start, occ_end) in occupied_slots:
            occ_start_mins = _time_to_minutes(occ_start)
            occ_end_mins = _time_to_minutes(occ_end)
            if _ranges_overlap(start_mins, end_mins, occ_start_mins, occ_end_mins):
                is_overlapping = True
                break
        if not is_overlapping:
            eh = min(end_mins // 60, 23)
            em = end_mins % 60 if eh < 23 else 0
            return start_str, f"{eh:02d}:{em:02d}"
    # Fallback: find any gap between occupied slots
    occupied_sorted = sorted(
        [(_time_to_minutes(s), _time_to_minutes(e)) for s, e in occupied_slots],
        key=lambda x: x[0]
    )
    current = 8 * 60  # start from 08:00
    for occ_start, occ_end in occupied_sorted:
        gap = occ_start - current
        if gap >= needed_minutes:
            sh = current // 60
            sm = current % 60
            end_total = current + needed_minutes
            eh = min(end_total // 60, 23)
            em = end_total % 60 if eh < 23 else 0
            return f"{sh:02d}:{sm:02d}", f"{eh:02d}:{em:02d}"
        current = max(current, occ_end)
    # Last resort: after last occupied slot
    end_total = current + needed_minutes
    eh = min(end_total // 60, 23)
    em = end_total % 60 if eh < 23 else 0
    sh = current // 60
    sm = current % 60
    return f"{sh:02d}:{sm:02d}", f"{eh:02d}:{em:02d}"


def _distribute_subtasks(llm_subtasks, deadline, occupied_dates, occupied_slots):
    today = date.today()
    deadline_date = deadline.date()
    days_available = max(1, (deadline_date - today).days)
    sorted_subtasks = sorted(llm_subtasks, key=lambda s: s.day_offset, reverse=True)
    scheduled = []
    for sub in sorted_subtasks:
        preferred = deadline_date - timedelta(days=sub.day_offset)
        preferred = max(today, min(preferred, deadline_date))
        current = preferred
        for _ in range(days_available + 10):
            if occupied_dates.get(current, 0) == 0 and current not in [s[0] for s in scheduled]:
                break
            current -= timedelta(days=1)
            if current < today:
                current = min(preferred + timedelta(days=1), deadline_date)
        occupied_dates[current] = occupied_dates.get(current, 0) + 1
        start_t, end_t = _pick_time_slot(sub.estimated_hours, occupied_slots.get(current, []))
        occupied_slots.setdefault(current, []).append((start_t, end_t))
        scheduled.append((current, start_t, end_t))
    return scheduled


# ===== Group Endpoints =====

def get_member_role(user_id: int, group_id: int, db) -> str:
    member = db.query(GroupMember).filter(GroupMember.user_id == user_id, GroupMember.group_id == group_id).first()
    return member.role if member else ""


def require_role(user_id: int, group_id: int, db, roles: list) -> GroupMember:
    member = db.query(GroupMember).filter(GroupMember.user_id == user_id, GroupMember.group_id == group_id).first()
    if not member or member.role not in roles:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return member


import secrets


@app.post("/api/groups", response_model=GroupResponse)
def create_group(data: GroupCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = Group(name=data.name, description=data.description, owner_id=user.id)
    db.add(group)
    db.commit()
    db.refresh(group)
    # Add owner as owner member
    db.add(GroupMember(group_id=group.id, user_id=user.id, role="owner"))
    # Generate initial invite key
    key = secrets.token_urlsafe(16)
    db.add(InviteKey(group_id=group.id, key=key))
    db.commit()
    db.refresh(group)
    return GroupResponse(id=group.id, name=group.name, description=group.description,
                         created_at=group.created_at, owner_id=group.owner_id, my_role="owner")


@app.get("/api/groups", response_model=List[GroupResponse])
def list_groups(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = db.query(GroupMember).filter(GroupMember.user_id == user.id).all()
    groups = []
    for m in memberships:
        g = db.query(Group).filter(Group.id == m.group_id).first()
        if g:
            groups.append(GroupResponse(id=g.id, name=g.name, description=g.description,
                                        created_at=g.created_at, owner_id=g.owner_id, my_role=m.role))
    return groups


@app.get("/api/groups/{group_id}", response_model=GroupDetail)
def get_group(group_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user.id, group_id, db, ["owner", "admin", "member"])
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    members = db.query(GroupMember).filter(GroupMember.group_id == group_id).all()
    member_infos = []
    for m in members:
        u = db.query(User).filter(User.id == m.user_id).first()
        if u:
            member_infos.append(GroupMemberInfo(id=m.id, user_id=m.user_id, display_name=u.display_name,
                                                email=u.email, role=m.role, joined_at=m.joined_at))
    my_role = get_member_role(user.id, group_id, db)
    return GroupDetail(id=group.id, name=group.name, description=group.description,
                       created_at=group.created_at, owner_id=group.owner_id, my_role=my_role, members=member_infos)


@app.post("/api/groups/{group_id}/invite-key", response_model=InviteKeyResponse)
def generate_invite_key(group_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user.id, group_id, db, ["owner"])
    # Deactivate old keys
    db.query(InviteKey).filter(InviteKey.group_id == group_id, InviteKey.is_active == True).update({"is_active": False})
    db.commit()
    # Generate new key
    key = secrets.token_urlsafe(16)
    ik = InviteKey(group_id=group_id, key=key)
    db.add(ik)
    db.commit()
    db.refresh(ik)
    return InviteKeyResponse(key=ik.key, created_at=ik.created_at)


@app.get("/api/groups/{group_id}/invite-key", response_model=InviteKeyResponse)
def get_invite_key(group_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current active invite key (owner only)."""
    require_role(user.id, group_id, db, ["owner"])
    ik = db.query(InviteKey).filter(InviteKey.group_id == group_id, InviteKey.is_active == True).first()
    if not ik:
        raise HTTPException(status_code=404, detail="No active invite key found")
    return InviteKeyResponse(key=ik.key, created_at=ik.created_at)


@app.get("/api/users/{user_id}", response_model=UserResponse)
def get_user_profile(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get public profile of another user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse.model_validate(user)


@app.post("/api/groups/join", response_model=GroupResponse)
def join_group(data: JoinGroupRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ik = db.query(InviteKey).filter(InviteKey.key == data.invite_key, InviteKey.is_active == True).first()
    if not ik:
        raise HTTPException(status_code=404, detail="Invalid or expired invite key")
    # Check if already a member
    existing = db.query(GroupMember).filter(GroupMember.user_id == user.id, GroupMember.group_id == ik.group_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already a member of this group")
    db.add(GroupMember(group_id=ik.group_id, user_id=user.id, role="member"))
    db.commit()
    g = db.query(Group).filter(Group.id == ik.group_id).first()
    return GroupResponse(id=g.id, name=g.name, description=g.description,
                         created_at=g.created_at, owner_id=g.owner_id, my_role="member")


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user.id, group_id, db, ["owner"])
    group = db.query(Group).filter(Group.id == group_id).first()
    db.delete(group)
    db.commit()
    return {"status": "deleted"}


@app.patch("/api/groups/{group_id}/members/role")
def update_member_role(group_id: int, data: UpdateMemberRole, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user.id, group_id, db, ["owner"])
    member = db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == data.user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=403, detail="Cannot change owner role")
    if data.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")
    member.role = data.role
    db.commit()
    return {"status": "updated"}


@app.delete("/api/groups/{group_id}/members/{member_user_id}")
def remove_member(group_id: int, member_user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user.id, group_id, db, ["owner"])
    member = db.query(GroupMember).filter(GroupMember.group_id == group_id, GroupMember.user_id == member_user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=403, detail="Cannot remove owner")
    db.delete(member)
    db.commit()
    return {"status": "removed"}


# ===== Group Assignment Endpoints =====

@app.post("/api/groups/{group_id}/assignments", response_model=GroupAssignmentDetail)
async def create_group_assignment(
    group_id: int,
    data: GroupAssignmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create assignment for a group with AI-generated subtasks."""
    require_role(user.id, group_id, db, ["owner", "admin"])
    assignment = Assignment(
        user_id=user.id,
        group_id=group_id,
        title=data.title,
        course_code=data.course_code,
        deadline=data.deadline,
        estimated_hours=data.estimated_hours,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    try:
        llm_subtasks = await generate_subtasks(
            title=assignment.title,
            course_code=assignment.course_code,
            deadline=assignment.deadline,
            estimated_hours=assignment.estimated_hours,
        )
        occupied_dates = _get_occupied_dates(db, user.id)
        occupied_slots = _get_occupied_time_slots(db, user.id)
        scheduled = _distribute_subtasks(llm_subtasks, assignment.deadline, occupied_dates, occupied_slots)

        for sub, (sched_date, start_t, end_t) in zip(llm_subtasks, scheduled):
            db.add(Subtask(
                assignment_id=assignment.id,
                title=sub.title,
                description=sub.description,
                scheduled_date=datetime.combine(sched_date, datetime.min.time()),
                start_time=start_t,
                end_time=end_t,
                estimated_hours=sub.estimated_hours,
            ))
        db.commit()
        db.refresh(assignment)
    except Exception as e:
        logger.error(f"Subtask generation failed: {e}")

    db.refresh(assignment)
    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    return _build_group_assignment_detail(assignment, subtasks, user.display_name or user.email)


@app.post("/api/groups/{group_id}/assignments/manual", response_model=GroupAssignmentDetail)
def create_group_manual_assignment(
    group_id: int,
    data: GroupManualAssignmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create assignment for a group with user-defined subtasks (no LLM)."""
    require_role(user.id, group_id, db, ["owner", "admin"])
    assignment = Assignment(
        user_id=user.id,
        group_id=group_id,
        title=data.title,
        course_code=data.course_code,
        deadline=data.deadline,
        estimated_hours=data.estimated_hours,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    for sub in data.subtasks:
        db.add(Subtask(
            assignment_id=assignment.id,
            title=sub.title,
            description=sub.description,
            scheduled_date=sub.scheduled_date,
            start_time=sub.start_time,
            end_time=sub.end_time,
            estimated_hours=sub.estimated_hours,
        ))
    db.commit()
    db.refresh(assignment)

    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    return _build_group_assignment_detail(assignment, subtasks, user.display_name or user.email)


@app.get("/api/groups/{group_id}/assignments", response_model=List[GroupAssignmentDetail])
def list_group_assignments(
    group_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all assignments for a group (visible to all members)."""
    require_role(user.id, group_id, db, ["owner", "admin", "member"])
    assignments = db.query(Assignment).filter(Assignment.group_id == group_id).order_by(Assignment.deadline).all()
    result = []
    for a in assignments:
        subtasks = db.query(Subtask).filter(Subtask.assignment_id == a.id).all()
        creator = db.query(User).filter(User.id == a.user_id).first()
        creator_name = creator.display_name if creator and creator.display_name else creator.email if creator else ""
        result.append(_build_group_assignment_detail(a, subtasks, creator_name))
    return result


@app.patch("/api/groups/assignments/{subtask_id}", response_model=SubtaskResponse)
def update_group_subtask(
    subtask_id: int,
    data: SubtaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle subtask completion for group assignment."""
    subtask = db.query(Subtask).join(Assignment).filter(
        Subtask.id == subtask_id,
        Assignment.group_id != None,
    ).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    # Check member access
    assignment = db.query(Assignment).filter(Assignment.id == subtask.assignment_id).first()
    if not assignment or not assignment.group_id:
        raise HTTPException(status_code=404, detail="Assignment not found")
    require_role(user.id, assignment.group_id, db, ["owner", "admin", "member"])
    subtask.completed = data.completed
    db.commit()
    db.refresh(subtask)
    # Update assignment completion
    all_subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    assignment.completed = len(all_subtasks) > 0 and all(s.completed for s in all_subtasks)
    db.commit()
    return SubtaskResponse.model_validate(subtask)


# ===== Assignment Endpoints =====

@app.post("/api/assignments/manual", response_model=AssignmentDetail)
def create_manual_assignment(data: ManualAssignmentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create assignment with user-defined subtasks (no LLM)."""
    assignment = Assignment(
        user_id=user.id,
        title=data.title,
        course_code=data.course_code,
        deadline=data.deadline,
        estimated_hours=data.estimated_hours,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    for sub in data.subtasks:
        db.add(Subtask(
            assignment_id=assignment.id,
            title=sub.title,
            description=sub.description,
            scheduled_date=sub.scheduled_date,
            start_time=sub.start_time,
            end_time=sub.end_time,
            estimated_hours=sub.estimated_hours,
        ))
    db.commit()
    db.refresh(assignment)

    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    return _build_assignment_detail(assignment, subtasks)


@app.post("/api/assignments", response_model=AssignmentDetail)
async def create_assignment(data: AssignmentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = Assignment(
        user_id=user.id,
        title=data.title,
        course_code=data.course_code,
        deadline=data.deadline,
        estimated_hours=data.estimated_hours,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    try:
        llm_subtasks = await generate_subtasks(
            title=assignment.title,
            course_code=assignment.course_code,
            deadline=assignment.deadline,
            estimated_hours=assignment.estimated_hours,
        )
        occupied_dates = _get_occupied_dates(db, user.id)
        occupied_slots = _get_occupied_time_slots(db, user.id)
        scheduled = _distribute_subtasks(llm_subtasks, assignment.deadline, occupied_dates, occupied_slots)

        for sub, (sched_date, start_t, end_t) in zip(llm_subtasks, scheduled):
            db.add(Subtask(
                assignment_id=assignment.id,
                title=sub.title,
                description=sub.description,
                scheduled_date=datetime.combine(sched_date, datetime.min.time()),
                start_time=start_t,
                end_time=end_t,
                estimated_hours=sub.estimated_hours,
            ))
        db.commit()
        db.refresh(assignment)
    except Exception as e:
        logger.error(f"Subtask generation failed: {e}")

    db.refresh(assignment)
    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    return _build_assignment_detail(assignment, subtasks)


@app.get("/api/assignments", response_model=List[AssignmentDetail])
def list_assignments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Only personal assignments (not group assignments)
    assignments = db.query(Assignment).options(joinedload(Assignment.user)).filter(
        Assignment.user_id == user.id,
        Assignment.group_id == None
    ).order_by(Assignment.deadline).all()
    result = []
    for a in assignments:
        subtasks = db.query(Subtask).filter(Subtask.assignment_id == a.id).all()
        result.append(_build_assignment_detail(a, subtasks))
    return result


@app.get("/api/assignments/{assignment_id}", response_model=AssignmentDetail)
def get_assignment(assignment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id, Assignment.user_id == user.id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment_id).all()
    return _build_assignment_detail(assignment, subtasks)


# NOTE: /time route must come BEFORE /{subtask_id} to avoid being caught by it
@app.patch("/api/subtasks/{subtask_id}/time", response_model=SubtaskResponse)
def update_subtask_time(subtask_id: int, data: SubtaskTimeUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    subtask = db.query(Subtask).join(Assignment).filter(Subtask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    assignment = db.query(Assignment).filter(Assignment.id == subtask.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    # Check: either personal assignment or group member
    if assignment.user_id == user.id:
        pass  # Personal assignment
    elif assignment.group_id:
        require_role(user.id, assignment.group_id, db, ["owner", "admin", "member"])
    else:
        raise HTTPException(status_code=403, detail="Not your subtask")
    subtask.start_time = data.start_time
    subtask.end_time = data.end_time
    db.commit()
    db.refresh(subtask)
    return SubtaskResponse.model_validate(subtask)


@app.patch("/api/subtasks/{subtask_id}", response_model=SubtaskResponse)
def update_subtask(subtask_id: int, data: SubtaskFullUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update subtask fields: completed, title, description, scheduled_date, start_time, end_time, estimated_hours."""
    subtask = db.query(Subtask).join(Assignment).filter(Subtask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    assignment = db.query(Assignment).filter(Assignment.id == subtask.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    # Check: either personal assignment or group member
    if assignment.user_id == user.id:
        pass
    elif assignment.group_id:
        require_role(user.id, assignment.group_id, db, ["owner", "admin", "member"])
    else:
        raise HTTPException(status_code=403, detail="Not your subtask")
    # Update fields if provided
    if data.completed is not None:
        subtask.completed = data.completed
    if data.title:
        subtask.title = data.title
    if data.description:
        subtask.description = data.description
    if data.scheduled_date:
        subtask.scheduled_date = data.scheduled_date
    if data.start_time:
        subtask.start_time = data.start_time
    if data.end_time:
        subtask.end_time = data.end_time
    if data.estimated_hours is not None:
        subtask.estimated_hours = data.estimated_hours
    db.commit()
    db.refresh(subtask)
    # Update assignment completion status
    all_subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment.id).all()
    assignment.completed = len(all_subtasks) > 0 and all(s.completed for s in all_subtasks)
    db.commit()
    return SubtaskResponse.model_validate(subtask)


@app.delete("/api/subtasks/{subtask_id}")
def delete_subtask(subtask_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    subtask = db.query(Subtask).join(Assignment).filter(Subtask.id == subtask_id, Assignment.user_id == user.id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    assignment_id = subtask.assignment_id
    db.delete(subtask)
    db.commit()
    if assignment_id:
        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        if assignment:
            all_subtasks = db.query(Subtask).filter(Subtask.assignment_id == assignment_id).all()
            assignment.completed = len(all_subtasks) > 0 and all(s.completed for s in all_subtasks)
            db.commit()
    return {"status": "deleted"}


@app.delete("/api/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id, Assignment.user_id == user.id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(assignment)
    db.commit()
    return {"status": "deleted"}


# ===== Subtask Move =====

@app.patch("/api/subtasks/{subtask_id}/move", response_model=SubtaskResponse)
def move_subtask(
    subtask_id: int,
    data: SubtaskMove,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move subtask to a different date/time."""
    subtask = db.query(Subtask).join(Assignment).filter(Subtask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    assignment = db.query(Assignment).filter(Assignment.id == subtask.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your subtask")
    subtask.scheduled_date = data.scheduled_date
    if data.start_time:
        subtask.start_time = data.start_time
    if data.end_time:
        subtask.end_time = data.end_time
    db.commit()
    db.refresh(subtask)
    return SubtaskResponse.model_validate(subtask)


@app.patch("/api/groups/assignments/subtasks/{subtask_id}/move", response_model=SubtaskResponse)
def move_group_subtask(
    subtask_id: int,
    data: SubtaskMove,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move group subtask to a different date/time."""
    subtask = db.query(Subtask).join(Assignment).filter(Subtask.id == subtask_id).first()
    if not subtask:
        raise HTTPException(status_code=404, detail="Subtask not found")
    assignment = db.query(Assignment).filter(Assignment.id == subtask.assignment_id).first()
    if not assignment or not assignment.group_id:
        raise HTTPException(status_code=404, detail="Assignment not found")
    require_role(user.id, assignment.group_id, db, ["owner", "admin", "member"])
    subtask.scheduled_date = data.scheduled_date
    if data.start_time:
        subtask.start_time = data.start_time
    if data.end_time:
        subtask.end_time = data.end_time
    db.commit()
    db.refresh(subtask)
    return SubtaskResponse.model_validate(subtask)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ===== Helpers =====

def _build_assignment_detail(assignment, subtasks):
    creator_name = assignment.user.display_name if assignment.user and assignment.user.display_name else ""
    return AssignmentDetail(
        id=assignment.id,
        user_id=assignment.user_id,
        title=assignment.title,
        course_code=assignment.course_code,
        deadline=assignment.deadline,
        estimated_hours=assignment.estimated_hours,
        created_at=assignment.created_at,
        completed=assignment.completed,
        creator_name=creator_name,
        subtasks=[
            SubtaskResponse(
                id=s.id, assignment_id=s.assignment_id, title=s.title,
                description=s.description, scheduled_date=s.scheduled_date,
                start_time=s.start_time, end_time=s.end_time,
                estimated_hours=s.estimated_hours, completed=s.completed,
            )
            for s in subtasks
        ],
    )


def _build_group_assignment_detail(assignment, subtasks, creator_name=""):
    return GroupAssignmentDetail(
        id=assignment.id,
        user_id=assignment.user_id,
        title=assignment.title,
        course_code=assignment.course_code,
        deadline=assignment.deadline,
        estimated_hours=assignment.estimated_hours,
        created_at=assignment.created_at,
        completed=assignment.completed,
        subtasks=[
            SubtaskResponse(
                id=s.id, assignment_id=s.assignment_id, title=s.title,
                description=s.description, scheduled_date=s.scheduled_date,
                start_time=s.start_time, end_time=s.end_time,
                estimated_hours=s.estimated_hours, completed=s.completed,
            )
            for s in subtasks
        ],
    )
