const API_URL = '/api';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ===== Auth =====
export async function register(email, password, displayName) {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Registration failed');
  }
  return res.json();
}

export async function login(email, password) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Invalid credentials');
  }
  return res.json();
}

export async function getMe() {
  const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Not authenticated');
  return res.json();
}

export async function updateProfile(displayName, avatarUrl) {
  const res = await fetch(`${API_URL}/auth/profile`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName, avatar_url: avatarUrl }),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

export async function getStats(periodStart) {
  const params = periodStart ? `?period_start=${periodStart}` : '';
  const res = await fetch(`${API_URL}/auth/stats${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to get stats');
  return res.json();
}

// ===== Assignments =====
export async function fetchAssignments() {
  const res = await fetch(`${API_URL}/assignments`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch assignments');
  return res.json();
}

export async function createAssignment(data) {
  const res = await fetch(`${API_URL}/assignments`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create assignment');
  return res.json();
}

export async function toggleSubtask(subtaskId, completed) {
  const res = await fetch(`${API_URL}/subtasks/${subtaskId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  if (!res.ok) throw new Error('Failed to update subtask');
  return res.json();
}

export async function deleteAssignment(id) {
  const res = await fetch(`${API_URL}/assignments/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete assignment');
  return res.json();
}

export async function deleteSubtask(subtaskId) {
  const res = await fetch(`${API_URL}/subtasks/${subtaskId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete subtask');
  return res.json();
}

export async function updateSubtaskTime(subtaskId, startTime, endTime) {
  const res = await fetch(`${API_URL}/subtasks/${subtaskId}/time`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: startTime, end_time: endTime }),
  });
  if (!res.ok) throw new Error('Failed to update subtask time');
  return res.json();
}

export async function uploadAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch(`${API_URL}/auth/avatar`, {
          method: 'PATCH',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar_url: reader.result }),
        });
        if (!res.ok) throw new Error('Failed to upload avatar');
        resolve(await res.json());
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function createManualAssignment(data) {
  const res = await fetch(`${API_URL}/assignments/manual`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create assignment');
  return res.json();
}

// ===== Groups =====
export async function createGroup(name, description) {
  const res = await fetch(`${API_URL}/groups`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to create group');
  }
  return res.json();
}

export async function fetchGroups() {
  const res = await fetch(`${API_URL}/groups`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch groups');
  return res.json();
}

export async function fetchGroupDetail(groupId) {
  const res = await fetch(`${API_URL}/groups/${groupId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch group');
  return res.json();
}

export async function joinGroup(inviteKey) {
  const res = await fetch(`${API_URL}/groups/join`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_key: inviteKey }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to join group');
  }
  return res.json();
}

export async function generateInviteKey(groupId) {
  const res = await fetch(`${API_URL}/groups/${groupId}/invite-key`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to generate invite key');
  }
  return res.json();
}

export async function fetchInviteKey(groupId) {
  const res = await fetch(`${API_URL}/groups/${groupId}/invite-key`, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error('Failed to fetch invite key');
  }
  return res.json();
}

export async function getUserProfile(userId) {
  const res = await fetch(`${API_URL}/users/${userId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch user profile');
  return res.json();
}

export async function deleteGroup(groupId) {
  const res = await fetch(`${API_URL}/groups/${groupId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete group');
  return res.json();
}

export async function updateMemberRole(groupId, userId, role) {
  const res = await fetch(`${API_URL}/groups/${groupId}/members/role`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, role }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to update member role');
  }
  return res.json();
}

export async function removeMember(groupId, memberUserId) {
  const res = await fetch(`${API_URL}/groups/${groupId}/members/${memberUserId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to remove member');
  }
  return res.json();
}

// ===== Group Assignments =====
export async function fetchGroupAssignments(groupId) {
  const res = await fetch(`${API_URL}/groups/${groupId}/assignments`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch group assignments');
  return res.json();
}

export async function createGroupAssignment(groupId, data) {
  const res = await fetch(`${API_URL}/groups/${groupId}/assignments`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to create assignment');
  }
  return res.json();
}

export async function createGroupManualAssignment(groupId, data) {
  const res = await fetch(`${API_URL}/groups/${groupId}/assignments/manual`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Failed to create assignment');
  }
  return res.json();
}

export async function toggleGroupSubtask(subtaskId, completed) {
  const res = await fetch(`${API_URL}/groups/assignments/${subtaskId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  if (!res.ok) throw new Error('Failed to update subtask');
  return res.json();
}

// ===== Subtask Move (Drag & Drop) =====
export async function moveSubtask(subtaskId, scheduledDate, startTime, endTime, isGroup = false) {
  const url = isGroup
    ? `${API_URL}/groups/assignments/subtasks/${subtaskId}/move`
    : `${API_URL}/subtasks/${subtaskId}/move`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduled_date: scheduledDate, start_time: startTime, end_time: endTime }),
  });
  if (!res.ok) throw new Error('Failed to move subtask');
  return res.json();
}

// ===== Subtask Full Update =====
export async function updateSubtaskFull(subtaskId, data) {
  const res = await fetch(`${API_URL}/subtasks/${subtaskId}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update subtask');
  }
  return res.json();
}
