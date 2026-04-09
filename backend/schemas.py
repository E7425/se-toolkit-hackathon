from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class UserRegister(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    display_name: str = ""


class UserLogin(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str = ""
    avatar_url: str = ""
    created_at: datetime

    class Config:
        from_attributes = True


class UserProfileUpdate(BaseModel):
    display_name: str = ""


class UserAvatarUpdate(BaseModel):
    avatar_url: str = ""


class UserStats(BaseModel):
    total_completed_hours: float = 0
    total_completed_tasks: int = 0
    total_completed_assignments: int = 0
    period_start: str = ""
    period_end: str = ""


class AssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    course_code: str = Field(..., min_length=1, max_length=50)
    deadline: datetime
    estimated_hours: float = Field(..., gt=0, le=1000)


class ManualSubtaskCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ""
    scheduled_date: datetime
    start_time: str = ""
    end_time: str = ""
    estimated_hours: float = Field(..., gt=0)


class ManualAssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    course_code: str = Field(..., min_length=1, max_length=50)
    deadline: datetime
    estimated_hours: float = Field(..., gt=0, le=1000)
    subtasks: List[ManualSubtaskCreate] = []


class AssignmentResponse(BaseModel):
    id: int
    user_id: int
    title: str
    course_code: str
    deadline: datetime
    estimated_hours: float
    created_at: datetime
    completed: bool

    class Config:
        from_attributes = True


class SubtaskResponse(BaseModel):
    id: int
    assignment_id: int
    title: str
    description: str
    scheduled_date: datetime
    start_time: str = ""
    end_time: str = ""
    estimated_hours: float
    completed: bool

    class Config:
        from_attributes = True


class AssignmentDetail(AssignmentResponse):
    subtasks: List[SubtaskResponse] = []
    creator_name: str = ""


class SubtaskUpdate(BaseModel):
    completed: bool


class SubtaskTimeUpdate(BaseModel):
    start_time: str = ""
    end_time: str = ""


class SubtaskFullUpdate(BaseModel):
    title: str = ""
    description: str = ""
    scheduled_date: Optional[datetime] = None
    start_time: str = ""
    end_time: str = ""
    estimated_hours: Optional[float] = None
    completed: Optional[bool] = None


class LLMSubtask(BaseModel):
    title: str
    description: str
    day_offset: int
    estimated_hours: float


# ===== Group Schemas =====

class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""


class GroupMemberInfo(BaseModel):
    id: int
    user_id: int
    display_name: str = ""
    email: str
    role: str
    joined_at: datetime

    class Config:
        from_attributes = True


class GroupResponse(BaseModel):
    id: int
    name: str
    description: str = ""
    created_at: datetime
    owner_id: int
    my_role: str = "member"

    class Config:
        from_attributes = True


class GroupDetail(GroupResponse):
    members: List[GroupMemberInfo] = []


class InviteKeyResponse(BaseModel):
    key: str
    created_at: datetime


class JoinGroupRequest(BaseModel):
    invite_key: str


class UpdateMemberRole(BaseModel):
    user_id: int
    role: str  # "admin" or "member"


# ===== Group Assignment Schemas =====

class GroupAssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    course_code: str = Field(..., min_length=1, max_length=50)
    deadline: datetime
    estimated_hours: float = Field(..., gt=0, le=1000)


class GroupManualSubtaskCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ""
    scheduled_date: datetime
    start_time: str = ""
    end_time: str = ""
    estimated_hours: float = Field(..., gt=0)


class GroupManualAssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    course_code: str = Field(..., min_length=1, max_length=50)
    deadline: datetime
    estimated_hours: float = Field(..., gt=0, le=1000)
    subtasks: List[GroupManualSubtaskCreate] = []


class GroupAssignmentDetail(AssignmentDetail):
    pass


# ===== Subtask Drag & Drop =====

class SubtaskMove(BaseModel):
    scheduled_date: datetime
    start_time: str = ""
    end_time: str = ""
