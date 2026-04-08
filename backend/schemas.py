from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class AssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    course_code: str = Field(..., min_length=1, max_length=50)
    deadline: datetime
    estimated_hours: float = Field(..., gt=0, le=1000)


class AssignmentResponse(BaseModel):
    id: int
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


class SubtaskUpdate(BaseModel):
    completed: bool


class LLMSubtask(BaseModel):
    title: str
    description: str
    day_offset: int  # days before deadline (0 = deadline day)
    estimated_hours: float
