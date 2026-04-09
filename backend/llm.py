import httpx
import os
import json
import logging
from typing import List
from datetime import datetime, timedelta
from schemas import LLMSubtask

logger = logging.getLogger(__name__)

# Determine which LLM provider to use (priority: Qwen Code API > DashScope > OpenRouter)
LLM_API_BASE_URL = os.getenv("LLM_API_BASE_URL", "").strip()
LLM_API_KEY = os.getenv("LLM_API_KEY", "").strip()
LLM_API_MODEL = os.getenv("LLM_API_MODEL", "coder-model")

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "").strip()
DASHSCOPE_API_URL = os.getenv("DASHSCOPE_API_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
DASHSCOPE_MODEL = os.getenv("DASHSCOPE_MODEL", "qwen-plus")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_API_URL = os.getenv("OPENROUTER_API_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")


def _get_provider_config():
    """Return (url, key, model) for the active provider."""
    if LLM_API_BASE_URL and LLM_API_KEY:
        # Ensure URL ends with /chat/completions
        url = LLM_API_BASE_URL.rstrip("/")
        if not url.endswith("/chat/completions"):
            url = f"{url}/chat/completions"
        return url, LLM_API_KEY, LLM_API_MODEL
    if DASHSCOPE_API_KEY:
        return DASHSCOPE_API_URL, DASHSCOPE_API_KEY, DASHSCOPE_MODEL
    if OPENROUTER_API_KEY:
        return OPENROUTER_API_URL, OPENROUTER_API_KEY, OPENROUTER_MODEL
    return None, None, None


async def generate_subtasks(
    title: str,
    course_code: str,
    deadline: datetime,
    estimated_hours: float,
) -> List[LLMSubtask]:
    """Generate subtasks using LLM API with structured JSON output."""

    api_url, api_key, model = _get_provider_config()

    if not api_url:
        # No provider configured — use fallback immediately
        days_until_deadline = max(1, (deadline - datetime.utcnow()).days)
        return _generate_fallback_subtasks(title, estimated_hours, days_until_deadline)

    days_until_deadline = (deadline - datetime.utcnow()).days
    if days_until_deadline < 1:
        days_until_deadline = 1

    prompt = f"""Break this university assignment into 4-6 logical subtasks in CHRONOLOGICAL ORDER.

Assignment: "{title}"
Course: {course_code}
Deadline: {deadline.strftime('%Y-%m-%d')}
Total estimated hours: {estimated_hours}
Days until deadline: {days_until_deadline}

STEP ORDER (follow this structure):
1. FIRST: Research & Planning — read materials, plan approach, gather resources
2. SECOND: Implementation — write code / draft content / do the main work
3. THIRD: Testing & Debugging — check correctness, fix issues
4. FOURTH: Review & Polish — final review, formatting, submission prep

IMPORTANT — distribute hours proportionally by task complexity:
- Implementation should get the MOST hours (50-60% of total)
- Research & Planning: 15-20%
- Testing & Debugging: 15-20%
- Review & Polish: 5-10%

CRITICAL: The SUM of all subtask estimated_hours MUST EXACTLY equal {estimated_hours}.
Do NOT exceed this total.

day_offset RULES:
- day_offset = number of days BEFORE the deadline
- day_offset=0 means deadline day, day_offset=1 means 1 day before, etc.
- The FIRST subtask (Research) gets the HIGHEST day_offset (furthest from deadline)
- The LAST subtask (Review/Polish) gets the LOWEST day_offset (closest to deadline)
- Subtasks must be in CHRONOLOGICAL ORDER: first subtask = start working, last = final check

Example with deadline on May 15, 12 hours total, 10 days available:
[
  {{"title": "Research & Planning", "description": "Read materials, plan approach, gather resources", "day_offset": 10, "estimated_hours": 2.0}},
  {{"title": "Implement Core Features", "description": "Write the main code/content", "day_offset": 7, "estimated_hours": 6.0}},
  {{"title": "Test & Debug", "description": "Verify correctness, fix issues", "day_offset": 3, "estimated_hours": 2.5}},
  {{"title": "Review & Final Polish", "description": "Final review, formatting, prepare submission", "day_offset": 1, "estimated_hours": 1.5}}
]

Return ONLY valid JSON array, no markdown, no explanation."""

    messages = [
        {
            "role": "system",
            "content": "You are a study planning assistant. Return ONLY JSON arrays with subtask breakdowns. No markdown, no code blocks, no explanation text."
        },
        {"role": "user", "content": prompt}
    ]

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 2000,
                }
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]

            # Try to extract JSON from response (in case there's extra text)
            subtasks = _parse_json_response(content)
            # Normalize hours so total equals estimated_hours
            subtasks = _normalize_subtask_hours(subtasks, estimated_hours)
            # Enforce logical chronological order by re-assigning day_offset
            subtasks = _enforce_chronological_order(subtasks, days_until_deadline)
            return subtasks

    except Exception as e:
        logger.error(f"LLM API call failed: {e}")
        # Fallback: generate basic subtasks algorithmically
        return _generate_fallback_subtasks(title, estimated_hours, days_until_deadline)


def _normalize_subtask_hours(subtasks: List[LLMSubtask], target_total: float) -> List[LLMSubtask]:
    """Scale subtask hours proportionally so they sum exactly to target_total.
    Preserves the LLM's relative distribution (harder tasks get more time)."""
    n = len(subtasks)
    if n == 0:
        return subtasks
    current_total = sum(s.estimated_hours for s in subtasks)
    if current_total <= 0 or abs(current_total - target_total) < 0.01:
        return subtasks
    # Scale proportionally — preserve relative weights
    for s in subtasks:
        s.estimated_hours = round(s.estimated_hours * (target_total / current_total), 1)
    # Fix rounding — adjust the largest subtask
    current_total = sum(s.estimated_hours for s in subtasks)
    diff = round(target_total - current_total, 1)
    if abs(diff) > 0:
        # Add to the subtask with the most hours
        largest = max(subtasks, key=lambda s: s.estimated_hours)
        largest.estimated_hours = round(largest.estimated_hours + diff, 1)
    return subtasks


def _enforce_chronological_order(subtasks: List[LLMSubtask], days_until_deadline: int) -> List[LLMSubtask]:
    """Sort subtasks by their original day_offset (LLM's intended order)
    and re-assign evenly-spaced day_offset values to guarantee chronological order."""
    n = len(subtasks)
    if n <= 1:
        return subtasks
    # Sort by original day_offset descending (highest = first to do)
    subtasks.sort(key=lambda s: s.day_offset, reverse=True)
    # Re-assign day_offset: evenly spaced from days_until_deadline down to 1
    for i, s in enumerate(subtasks):
        # First subtask gets furthest day, last gets closest to deadline
        if n == 1:
            s.day_offset = max(1, days_until_deadline)
        else:
            step = max(1, days_until_deadline // n)
            s.day_offset = max(1, days_until_deadline - i * step)
    return subtasks


def _parse_json_response(content: str) -> List[LLMSubtask]:
    """Parse JSON from LLM response, handling common issues."""
    # Try direct parse first
    try:
        raw = json.loads(content)
        if isinstance(raw, list):
            return [LLMSubtask(**item) for item in raw]
    except (json.JSONDecodeError, KeyError):
        pass

    # Try to find JSON array in text
    try:
        start = content.find('[')
        end = content.rfind(']') + 1
        if start >= 0 and end > start:
            json_str = content[start:end]
            raw = json.loads(json_str)
            if isinstance(raw, list):
                return [LLMSubtask(**item) for item in raw]
    except (json.JSONDecodeError, KeyError):
        pass

    raise ValueError(f"Could not parse LLM response as JSON: {content[:200]}")


def _generate_fallback_subtasks(
    title: str,
    estimated_hours: float,
    days_until_deadline: int,
) -> List[LLMSubtask]:
    """Generate basic subtasks without LLM (fallback). Always in chronological order."""
    generic_subtasks = [
        {"title": "Research & Planning", "desc": "Gather materials and outline scope"},
        {"title": "Implement Main Content", "desc": "Write the main body of the assignment"},
        {"title": "Test & Debug", "desc": "Verify correctness, fix issues"},
        {"title": "Review & Final Polish", "desc": "Proofread, format, submit"},
    ]

    num_tasks = min(4, max(3, days_until_deadline))
    base_hours = round(estimated_hours / num_tasks, 1)

    subtasks = []
    for i, task in enumerate(generic_subtasks[:num_tasks]):
        # Evenly space: first task furthest from deadline, last task closest
        step = max(1, days_until_deadline // num_tasks)
        day_offset = max(1, days_until_deadline - i * step)
        subtasks.append(LLMSubtask(
            title=task["title"],
            description=task["desc"],
            day_offset=day_offset,
            estimated_hours=base_hours,
        ))

    # Fix rounding so total equals estimated_hours exactly
    current_total = sum(s.estimated_hours for s in subtasks)
    diff = round(estimated_hours - current_total, 1)
    if subtasks and abs(diff) > 0:
        subtasks[0].estimated_hours = round(subtasks[0].estimated_hours + diff, 1)

    return subtasks
