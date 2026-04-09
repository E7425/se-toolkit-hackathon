import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchGroupDetail, generateInviteKey, fetchInviteKey, deleteGroup, updateMemberRole, removeMember, fetchGroupAssignments, createGroupAssignment, createGroupManualAssignment, toggleGroupSubtask, getUserProfile, moveSubtask } from './api';
import CalendarView from './CalendarView';

const ROLE_LABELS = {
  owner: '👑 Owner',
  admin: '🛡️ Admin',
  member: '👤 Member',
};

// ===== UTC+3 Date Formatter =====
function toLocalDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  // Treat as UTC+3 (add 3h offset if it's stored as UTC)
  const offset = 3 * 60 * 60 * 1000;
  return new Date(d.getTime() + offset);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return toLocalDate(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getDaysUntil(dateStr) {
  if (!dateStr) return '';
  const diff = Math.ceil((toLocalDate(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'Overdue'; if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

/* ===== User Profile Modal ===== */
function UserProfileModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await getUserProfile(userId);
        setProfile(data);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };
    load();
  }, [userId]);

  const isImage = profile && profile.avatar_url && profile.avatar_url.startsWith('data:image');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box user-profile-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>👤 Profile</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading && <div className="loading">Loading...</div>}
          {profile && (
            <div className="user-profile-content">
              <div className="user-avatar-display">
                {isImage ? <img src={profile.avatar_url} alt="avatar" className="avatar-img" /> : <span className="avatar-emoji">🤓</span>}
              </div>
              <h4>{profile.display_name || profile.email}</h4>
              <p className="user-profile-email">{profile.email}</p>
              <p className="user-profile-since">Member since {formatDate(profile.created_at)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GroupDetailPage({ groupId, onBack, user }) {
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Invite key
  const [inviteKey, setInviteKey] = useState(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const keyInputRef = useRef(null);

  // Group assignments
  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [groupView, setGroupView] = useState('list');

  // Assignment form
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [assignForm, setAssignForm] = useState({ title: '', course_code: '', deadline: '', estimated_hours: '' });
  const [manualSubtasks, setManualSubtasks] = useState([]);
  const [submittingAssignment, setSubmittingAssignment] = useState(false);

  // User profile modal
  const [viewingUserId, setViewingUserId] = useState(null);

  const loadGroup = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchGroupDetail(groupId);
      setGroup(data);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [groupId]);

  const loadAssignments = useCallback(async () => {
    try {
      setLoadingAssignments(true);
      const data = await fetchGroupAssignments(groupId);
      setAssignments(data);
    } catch (e) { setError(e.message); }
    finally { setLoadingAssignments(false); }
  }, [groupId]);

  const loadInviteKey = useCallback(async () => {
    try {
      const data = await fetchInviteKey(groupId);
      if (data) setInviteKey(data.key);
      else setInviteKey(null);
    } catch { setInviteKey(null); }
  }, [groupId]);

  useEffect(() => { loadGroup(); loadAssignments(); loadInviteKey(); }, [loadGroup, loadAssignments, loadInviteKey]);

  const isOwner = group && group.my_role === 'owner';
  const isAdmin = group && (group.my_role === 'owner' || group.my_role === 'admin');

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const data = await generateInviteKey(groupId);
      setInviteKey(data.key);
      setCopied(false);
    } catch (e) { setError(e.message); }
    finally { setGeneratingKey(false); }
  };

  const handleCopyKey = () => {
    if (inviteKey) {
      if (keyInputRef.current) {
        keyInputRef.current.select();
        keyInputRef.current.setSelectionRange(0, 99999);
        try {
          document.execCommand('copy');
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        } catch { /* fallback */ }
      }
      navigator.clipboard.writeText(inviteKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => setError('Failed to copy'));
    }
  };

  const handleChangeRole = async (userId, currentRole) => {
    if (!isOwner) return;
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    try { await updateMemberRole(groupId, userId, newRole); await loadGroup(); }
    catch (e) { setError(e.message); }
  };

  const handleRemoveMember = async (userId) => {
    if (!isOwner) return;
    if (!confirm('Remove this member from the group?')) return;
    try { await removeMember(groupId, userId); await loadGroup(); }
    catch (e) { setError(e.message); }
  };

  const handleDeleteGroup = async () => {
    if (!isOwner) return;
    if (!confirm('Delete this group? All data will be lost.')) return;
    try { await deleteGroup(groupId); onBack(); }
    catch (e) { setError(e.message); }
  };

  const handleAssignFormChange = (e) => setAssignForm({ ...assignForm, [e.target.name]: e.target.value });

  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    if (!assignForm.title || !assignForm.course_code || !assignForm.deadline || !assignForm.estimated_hours) return;
    setSubmittingAssignment(true);
    try {
      if (manualMode) {
        await createGroupManualAssignment(groupId, {
          title: assignForm.title, course_code: assignForm.course_code,
          deadline: new Date(assignForm.deadline).toISOString(),
          estimated_hours: parseFloat(assignForm.estimated_hours),
          subtasks: manualSubtasks.map(s => {
            const dt = s.start_time ? `${s.scheduled_date}T${s.start_time}:00` : `${s.scheduled_date}T09:00:00`;
            return {
              title: s.title, description: s.description || '',
              scheduled_date: new Date(dt).toISOString(),
              start_time: s.start_time, end_time: s.end_time,
              estimated_hours: parseFloat(s.estimated_hours),
            };
          }),
        });
      } else {
        await createGroupAssignment(groupId, {
          title: assignForm.title, course_code: assignForm.course_code,
          deadline: new Date(assignForm.deadline).toISOString(),
          estimated_hours: parseFloat(assignForm.estimated_hours),
        });
      }
      setAssignForm({ title: '', course_code: '', deadline: '', estimated_hours: '' });
      setManualSubtasks([]);
      setShowAssignmentForm(false);
      await loadAssignments();
    } catch (e) { setError(e.message); }
    finally { setSubmittingAssignment(false); }
  };

  const addSubtask = () => {
    const baseDate = assignForm.deadline ? assignForm.deadline.slice(0, 10) : '';
    setManualSubtasks([...manualSubtasks, { title: '', description: '', scheduled_date: baseDate, start_time: '09:00', end_time: '11:00', estimated_hours: 2 }]);
  };
  const removeSubtask = (i) => setManualSubtasks(manualSubtasks.filter((_, idx) => idx !== i));
  const updateSubtask = (i, field, val) => {
    const updated = [...manualSubtasks];
    updated[i] = { ...updated[i], [field]: val };
    setManualSubtasks(updated);
  };

  const handleToggleSubtask = async (subtaskId, currentStatus) => {
    try { await toggleGroupSubtask(subtaskId, !currentStatus); await loadAssignments(); }
    catch (e) { setError(e.message); }
  };

  const handleMoveSubtask = async (subtaskId, scheduledDate, startTime, endTime) => {
    await moveSubtask(subtaskId, scheduledDate, startTime, endTime, true);
    await loadAssignments();
  };

  if (loading) return <div className="loading">Loading group...</div>;
  if (!group) return <div className="error">Group not found</div>;

  return (
    <div className="group-detail">
      <div className="group-detail-header">
        <button className="btn btn-ghost back-btn" onClick={onBack}>← Back</button>
        <div className="group-title-section">
          <h2>{group.name}</h2>
          {group.description && <p className="group-desc">{group.description}</p>}
          <span className={`role-badge role-${group.my_role}`}>{ROLE_LABELS[group.my_role]}</span>
        </div>
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      {/* Invite Key */}
      {isOwner && (
        <div className="detail-section">
          <h3>🔑 Invite Key</h3>
          <div className="invite-section">
            {inviteKey ? (
              <div className="invite-key-display">
                <input ref={keyInputRef} type="text" readOnly value={inviteKey} className="invite-key-input" />
                <button className="btn btn-sm btn-secondary" onClick={handleCopyKey}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
            ) : (
              <p className="hint-text">No key yet. Generate one below.</p>
            )}
            <button className="btn btn-primary" onClick={handleGenerateKey} disabled={generatingKey}>
              {generatingKey ? 'Generating...' : inviteKey ? '🔄 Refresh Key' : '🔑 Generate Key'}
            </button>
          </div>
        </div>
      )}

      {/* Group Assignments */}
      <div className="detail-section">
        <div className="section-header-row">
          <h3>📋 Group Assignments</h3>
          <div className="assignment-header-actions">
            <div className="view-toggle-small">
              <button className={`toggle-sm ${groupView === 'list' ? 'active' : ''}`} onClick={() => setGroupView('list')}>📋 List</button>
              <button className={`toggle-sm ${groupView === 'calendar' ? 'active' : ''}`} onClick={() => setGroupView('calendar')}>📅 Calendar</button>
            </div>
            {isAdmin && (
              <button className="btn btn-sm btn-primary" onClick={() => setShowAssignmentForm(!showAssignmentForm)}>➕ Add</button>
            )}
          </div>
        </div>

        {showAssignmentForm && isAdmin && (
          <div className="group-assign-form">
            <div className="form-mode-toggle">
              <button className={`mode-btn ${!manualMode ? 'active' : ''}`} onClick={() => setManualMode(false)}>🤖 AI</button>
              <button className={`mode-btn ${manualMode ? 'active' : ''}`} onClick={() => setManualMode(true)}>✏️ Manual</button>
            </div>
            <form onSubmit={handleCreateAssignment}>
              <div className="form-grid">
                <div className="form-group"><label>Title</label><input name="title" type="text" value={assignForm.title} onChange={handleAssignFormChange} required /></div>
                <div className="form-group"><label>Course</label><input name="course_code" type="text" value={assignForm.course_code} onChange={handleAssignFormChange} required /></div>
                <div className="form-group"><label>Deadline</label><input name="deadline" type="datetime-local" value={assignForm.deadline} onChange={handleAssignFormChange} required /></div>
                <div className="form-group"><label>Hours</label><input name="estimated_hours" type="number" min="0.5" step="0.5" value={assignForm.estimated_hours} onChange={handleAssignFormChange} required /></div>
              </div>
              {manualMode && (
                <div className="manual-subtasks">
                  <div className="manual-subtasks-header"><h4>Subtasks</h4><button type="button" className="add-subtask-btn" onClick={addSubtask}>+ Add</button></div>
                  {manualSubtasks.map((s, i) => (
                    <div key={i} className="manual-subtask-row">
                      <input type="text" placeholder="Title" value={s.title} onChange={e => updateSubtask(i, 'title', e.target.value)} required />
                      <input type="text" placeholder="Description" value={s.description} onChange={e => updateSubtask(i, 'description', e.target.value)} />
                      <input type="date" value={s.scheduled_date} onChange={e => updateSubtask(i, 'scheduled_date', e.target.value)} required />
                      <input type="time" value={s.start_time} onChange={e => updateSubtask(i, 'start_time', e.target.value)} required />
                      <input type="time" value={s.end_time} onChange={e => updateSubtask(i, 'end_time', e.target.value)} required />
                      <input type="number" placeholder="Hours" min="0.5" step="0.5" value={s.estimated_hours} onChange={e => updateSubtask(i, 'estimated_hours', e.target.value)} required style={{ width: 80 }} />
                      <button type="button" className="remove-subtask-btn" onClick={() => removeSubtask(i)}>✕</button>
                    </div>
                  ))}
                  {manualSubtasks.length === 0 && <p className="no-subtasks">Add subtasks</p>}
                </div>
              )}
              <div className="group-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAssignmentForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submittingAssignment}>{submittingAssignment ? 'Creating...' : (manualMode ? 'Create' : 'Generate Plan')}</button>
              </div>
            </form>
          </div>
        )}

        {/* List View */}
        {groupView === 'list' && (
          <>
            {loadingAssignments && <div className="loading">Загрузка заданий...</div>}
            {!loadingAssignments && assignments.length === 0 && <p className="hint-text" style={{ textAlign: 'center', padding: '1rem' }}>Заданий пока нет.</p>}
            {!loadingAssignments && assignments.length > 0 && (
              <div className="group-assignments-list">
                {assignments.map(a => {
                  const subtasks = a.subtasks || [];
                  const completedCount = subtasks.filter(s => s.completed).length;
                  const totalCount = subtasks.length;
                  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                  return (
                    <div key={a.id} className="assignment-card">
                      <div className="assignment-header">
                        <div>
                          <h3>{a.title}</h3>
                          <div className="assignment-meta">
                            <span className="badge badge-course">{a.course_code}</span>
                            <span className="badge badge-hours">⏱ {a.estimated_hours}h</span>
                            <span className="badge badge-deadline">📅 {getDaysUntil(a.deadline)}</span>
                            {a.completed && <span className="badge badge-complete">✅ Complete</span>}
                          </div>
                          <div className="assignment-meta" style={{ marginTop: '0.3rem' }}>
                            <span>Creator: {a.creator_name}</span>
                            <span style={{ marginLeft: '1rem' }}>Deadline: {formatDate(a.deadline)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="progress-container">
                        <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${progress}%` }}></div></div>
                        <div className="progress-text">{completedCount}/{totalCount} tasks ({progress}%)</div>
                      </div>
                      {subtasks.length > 0 && (
                        <div className="timeline">
                          <h4>📅 Plan</h4>
                          {subtasks.sort((x, y) => new Date(x.scheduled_date) - new Date(y.scheduled_date)).map((sub) => (
                            <div key={sub.id} className="subtask">
                              <input type="checkbox" checked={sub.completed} onChange={() => handleToggleSubtask(sub.id, sub.completed)} />
                              <div className="subtask-content">
                                <div className={`subtask-title ${sub.completed ? 'completed' : ''}`}>{sub.title}</div>
                                {sub.description && <div className="subtask-desc">{sub.description}</div>}
                              </div>
                              <div className="subtask-date">
                                {formatDate(sub.scheduled_date)}<br />
                                {sub.start_time && sub.end_time ? `${sub.start_time} – ${sub.end_time}` : `${sub.estimated_hours}h`}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Calendar View */}
        {groupView === 'calendar' && (
          <CalendarView assignments={assignments} onToggleSubtask={handleToggleSubtask} onRefresh={loadAssignments} onMoveSubtask={handleMoveSubtask} />
        )}
      </div>

      {/* Members */}
      <div className="detail-section">
        <h3>👥 Members ({group.members.length})</h3>
        <div className="members-list">
          {group.members.map(m => (
            <div key={m.id} className="member-row" onClick={() => setViewingUserId(m.user_id)}>
              <div className="member-info">
                <span className="member-name">{m.display_name || m.email}</span>
                <span className="member-email">{m.email}</span>
              </div>
              <div className="member-actions" onClick={e => e.stopPropagation()}>
                <span className={`role-badge role-${m.role}`}>{ROLE_LABELS[m.role]}</span>
                {isOwner && m.role !== 'owner' && (
                  <>
                    <button className="btn btn-sm btn-ghost" onClick={() => handleChangeRole(m.user_id, m.role)} title={m.role === 'admin' ? 'Demote' : 'Promote'}>
                      {m.role === 'admin' ? '⬇️' : '⬆️'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleRemoveMember(m.user_id)} title="Remove">✕</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="hint-text" style={{ marginTop: '0.75rem' }}>Click on a member to view their profile.</p>
      </div>

      {/* Danger Zone */}
      {isOwner && (
        <div className="detail-section danger-zone">
          <h3>⚠️ Danger Zone</h3>
          <p>Deleting the group will permanently remove all group data.</p>
          <button className="btn btn-danger" onClick={handleDeleteGroup}>🗑 Delete Group</button>
        </div>
      )}

      {/* User Profile Modal */}
      {viewingUserId && <UserProfileModal userId={viewingUserId} onClose={() => setViewingUserId(null)} />}
    </div>
  );
}
