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

    prompt = f"""Break this university assignment into 4-6 logical subtasks with suggested daily completion windows.

Assignment: "{title}"
Course: {course_code}
Deadline: {deadline.strftime('%Y-%m-%d')}
Total estimated hours: {estimated_hours}
Days until deadline: {days_until_deadline}

Requirements:
- Create 4-6 subtasks that make sense for a university assignment (e.g., Research, Outline, Draft, Revise, Final Review)
- Distribute the estimated hours across subtasks (total should equal {estimated_hours})
- Spread work across available days, with lighter loads on earlier days and buffer before deadline
- day_offset means days before deadline (0 = deadline day, 1 = day before, etc.)
- Earlier subtasks should have higher day_offset values

Return ONLY valid JSON array, no markdown, no explanation. Format:
[
  {{
    "title": "Research & Gather Materials",
    "description": "Collect sources, read relevant chapters, take notes",
    "day_offset": {days_until_deadline},
    "estimated_hours": 2.5
  }}
]"""

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
            return subtasks

    except Exception as e:
        logger.error(f"LLM API call failed: {e}")
        # Fallback: generate basic subtasks algorithmically
        return _generate_fallback_subtasks(title, estimated_hours, days_until_deadline)


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
    """Generate basic subtasks without LLM (fallback)."""
    generic_subtasks = [
        {"title": "Research & Planning", "desc": "Gather materials and outline scope"},
        {"title": "Draft - Main Content", "desc": "Write the main body of the assignment"},
        {"title": "Review & Refine", "desc": "Check arguments, improve clarity"},
        {"title": "Final Polish", "desc": "Proofread, format, submit"},
    ]

    num_tasks = min(4, max(3, days_until_deadline))
    hours_per_task = round(estimated_hours / num_tasks, 1)

    subtasks = []
    for i, task in enumerate(generic_subtasks[:num_tasks]):
        day_offset = max(0, days_until_deadline - i - 1)
        subtasks.append(LLMSubtask(
            title=task["title"],
            description=task["desc"],
            day_offset=day_offset,
            estimated_hours=hours_per_task,
        ))

    return subtasks
