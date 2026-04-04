const API_URL = '/api';

export async function fetchAssignments() {
  const res = await fetch(`${API_URL}/assignments`);
  if (!res.ok) throw new Error('Failed to fetch assignments');
  return res.json();
}

export async function getAssignment(id) {
  const res = await fetch(`${API_URL}/assignments/${id}`);
  if (!res.ok) throw new Error('Assignment not found');
  return res.json();
}

export async function createAssignment(data) {
  const res = await fetch(`${API_URL}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create assignment');
  return res.json();
}

export async function toggleSubtask(subtaskId, completed) {
  const res = await fetch(`${API_URL}/subtasks/${subtaskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  if (!res.ok) throw new Error('Failed to update subtask');
  return res.json();
}

export async function deleteAssignment(id) {
  const res = await fetch(`${API_URL}/assignments/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete assignment');
  return res.json();
}
