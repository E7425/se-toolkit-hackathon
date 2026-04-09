import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchAssignments, createAssignment, toggleSubtask, deleteAssignment, getMe, createManualAssignment, updateSubtaskFull } from './api';
import CalendarView from './CalendarView';
import AuthPage from './AuthPage';
import ProfilePage from './ProfilePage';
import GroupsPage from './GroupsPage';
import GroupDetailPage from './GroupDetailPage';
import NotificationsPage from './NotificationsPage';

function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return { page: 'list', groupId: null };
  const parts = hash.split('/');
  if (parts[0] === 'groups' && parts[1]) return { page: 'groups', groupId: parseInt(parts[1], 10) };
  if (parts[0] === 'groups') return { page: 'groups', groupId: null };
  if (parts[0] === 'calendar') return { page: 'calendar', groupId: null };
  if (parts[0] === 'profile') return { page: 'profile', groupId: null };
  if (parts[0] === 'notifications') return { page: 'notifications', groupId: null };
  return { page: 'list', groupId: null };
}

function setHash(page, groupId) {
  if (page === 'groups' && groupId) window.location.hash = `groups/${groupId}`;
  else if (page === 'groups') window.location.hash = 'groups';
  else if (page === 'calendar') window.location.hash = 'calendar';
  else if (page === 'profile') window.location.hash = 'profile';
  else if (page === 'notifications') window.location.hash = 'notifications';
  else window.location.hash = 'list';
}

/* ===== Notif Bell ===== */
function NotifBell({ count, onClick }) {
  if (!count || count <= 0) return null;
  return (
    <button className="notif-bell-btn" onClick={onClick} title="Уведомления">
      🔔<span className="notif-badge">{count}</span>
    </button>
  );
}

/* ===== Compute Notifications ===== */
function computeNotifs(assignments, lastSeen) {
  if (!lastSeen || lastSeen <= 0) return 0;
  const now = new Date();
  let count = 0;
  (assignments || []).forEach(a => {
    if (a.completed) return;
    // Only count if this assignment was created AFTER the user last checked
    const createdAt = new Date(a.created_at).getTime();
    if (createdAt <= lastSeen) return;
    const deadline = new Date(a.deadline);
    const diffMin = (deadline - now) / (1000 * 60);
    if (diffMin > 0 && diffMin <= 25 * 60) count++;
    (a.subtasks || []).forEach(s => {
      if (s.completed) return;
      const schedDate = new Date(s.scheduled_date);
      if (s.start_time) {
        const [h, m] = s.start_time.split(':').map(Number);
        schedDate.setHours(h, m, 0, 0);
      }
      const subDiffMin = (schedDate - now) / (1000 * 60);
      if (subDiffMin > -30 && subDiffMin <= 30) count++;
    });
  });
  return count;
}

/* ===== Subtask Edit Modal ===== */
function SubtaskEditModal({ subtask, onSave, onClose }) {
  const rawDate = subtask.scheduled_date ? subtask.scheduled_date.slice(0, 10) : '';
  const [title, setTitle] = useState(subtask.title || '');
  const [description, setDescription] = useState(subtask.description || '');
  const [schedDate, setSchedDate] = useState(rawDate);
  const [startTime, setStartTime] = useState(subtask.start_time || '09:00');
  const [endTime, setEndTime] = useState(subtask.end_time || '11:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!startTime || !endTime) { setError('Please fill in the time'); return; }
    if (startTime >= endTime) { setError('End time must be after start time'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { title, description, start_time: startTime, end_time: endTime };
      if (schedDate) payload.scheduled_date = new Date(schedDate + 'T' + startTime + ':00').toISOString();
      await onSave(subtask.id, payload);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="modal-header">
          <h3>✏️ Edit</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-fields" style={{ flexDirection: 'column', gap: '0.75rem' }}>
            <div className="modal-field"><label>Title</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div className="modal-field"><label>Description</label><input type="text" value={description} onChange={e => setDescription(e.target.value)} /></div>
            <div className="modal-field"><label>Date</label><input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="modal-field" style={{ flex: 1 }}><label>Start</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} step={900} /></div>
              <div className="modal-field" style={{ flex: 1 }}><label>End</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} step={900} /></div>
            </div>
          </div>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-modal-save" onClick={handleSave} disabled={saving}>{saving ? '...' : '💾 Save'}</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  const initial = parseHash();
  const [page, setPage] = useState(initial.page);
  const [currentGroupId, setCurrentGroupId] = useState(initial.groupId);

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // AI form
  const [form, setForm] = useState({ title: '', course_code: '', deadline: '', estimated_hours: '' });

  // Manual form
  const [manualMode, setManualMode] = useState(false);
  const [manualSubtasks, setManualSubtasks] = useState([]);

  // Listen to hash changes
  useEffect(() => {
    const onHashChange = () => {
      const h = parseHash();
      setPage(h.page);
      setCurrentGroupId(h.groupId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigateTo = (p, groupId) => {
    if (p === 'notifications') {
      // Mark all as seen — this triggers immediate re-render via state update
      setLastNotifSeen(Date.now());
    }
    setHash(p, groupId);
  };

  // Notification count — reactive state, not just localStorage
  const [lastNotifSeen, setLastNotifSeen] = useState(() => {
    const stored = localStorage.getItem('lastNotifSeen');
    return stored ? parseInt(stored, 10) : 0;
  });
  const notifCount = useMemo(() => computeNotifs(assignments, lastNotifSeen), [assignments, lastNotifSeen]);

  // Sync lastNotifSeen to localStorage whenever it changes
  useEffect(() => {
    if (lastNotifSeen > 0) {
      localStorage.setItem('lastNotifSeen', lastNotifSeen.toString());
    }
  }, [lastNotifSeen]);

  // Sync assignments to NotificationsPage
  useEffect(() => {
    window._notifData = { assignments };
  }, [assignments]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) { setAuthChecking(false); return; }
        const userData = await getMe();
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
      } catch (e) {
        if (e.message === 'Not authenticated' || e.message.includes('401')) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } finally { setAuthChecking(false); }
    };
    checkAuth();
  }, []);

  const loadAssignments = useCallback(async () => {
    if (!user) return;
    try { setLoading(true); const data = await fetchAssignments(); setAssignments(data); setError(null); }
    catch { setError('Не удалось загрузить задания.'); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { if (user) loadAssignments(); }, [user, loadAssignments]);

  const handleLogin = (userData) => { setUser(userData); loadAssignments(); };
  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); setAssignments([]); setPage('list'); setCurrentGroupId(null); };

  const openGroup = (groupId) => { setCurrentGroupId(groupId); };
  const backFromGroup = () => { setCurrentGroupId(null); };

  const handleFormChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.course_code || !form.deadline || !form.estimated_hours) return;
    setSubmitting(true); setError(null);
    try {
      if (manualMode) {
        await createManualAssignment({
          title: form.title, course_code: form.course_code,
          deadline: new Date(form.deadline).toISOString(),
          estimated_hours: parseFloat(form.estimated_hours),
          subtasks: manualSubtasks.map(s => {
            const dt = s.start_time ? `${s.scheduled_date}T${s.start_time}:00` : `${s.scheduled_date}T09:00:00`;
            return {
              title: s.title, description: s.description || '',
              scheduled_date: new Date(dt).toISOString(),
              start_time: s.start_time,
              end_time: s.end_time,
              estimated_hours: parseFloat(s.estimated_hours),
            };
          }),
        });
      } else {
        await createAssignment({
          title: form.title, course_code: form.course_code,
          deadline: new Date(form.deadline).toISOString(),
          estimated_hours: parseFloat(form.estimated_hours),
        });
      }
      setForm({ title: '', course_code: '', deadline: '', estimated_hours: '' });
      setManualSubtasks([]);
      await loadAssignments();
    } catch (err) { setError(err.message || 'Не удалось создать задание'); }
    finally { setSubmitting(false); }
  };

  const addSubtask = () => {
    const baseDate = form.deadline ? form.deadline.slice(0, 10) : '';
    setManualSubtasks([...manualSubtasks, { title: '', description: '', scheduled_date: baseDate, start_time: '09:00', end_time: '11:00', estimated_hours: 2 }]);
  };
  const removeSubtask = (i) => setManualSubtasks(manualSubtasks.filter((_, idx) => idx !== i));
  const updateSubtask = (i, field, val) => {
    const updated = [...manualSubtasks];
    updated[i] = { ...updated[i], [field]: val };
    setManualSubtasks(updated);
  };

  const handleToggleSubtask = async (subtaskId, currentStatus) => {
    try { await toggleSubtask(subtaskId, !currentStatus); await loadAssignments(); }
    catch (err) { setError(err.message); }
  };

  const [editingSubtask, setEditingSubtask] = useState(null);

  const handleEditSubtask = async (subtaskId, data) => {
    try {
      await updateSubtaskFull(subtaskId, data);
      await loadAssignments();
      setEditingSubtask(null);
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this assignment and all subtasks?')) return;
    try { await deleteAssignment(id); await loadAssignments(); }
    catch (err) { setError(err.message); }
  };

  const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const getDaysUntil = (dateStr) => {
    const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'Overdue'; if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow';
    return `In ${diff} days`;
  };

  if (authChecking) return <div className="loading">Loading...</div>;
  if (!user) return <AuthPage onLogin={handleLogin} />;

  const NavButtons = ({ activePage }) => (
    <div className="view-toggle">
      <button className={`toggle-btn ${activePage === 'list' ? 'active' : ''}`} onClick={() => navigateTo('list')}>📋 List</button>
      <button className={`toggle-btn ${activePage === 'calendar' ? 'active' : ''}`} onClick={() => navigateTo('calendar')}>📅 Calendar</button>
      <button className={`toggle-btn ${activePage === 'notifications' ? 'active' : ''}`} onClick={() => navigateTo('notifications')}>
        🔔 Notifications{notifCount > 0 && <span className="nav-notif-badge">{notifCount}</span>}
      </button>
      <button className={`toggle-btn ${activePage === 'groups' ? 'active' : ''}`} onClick={() => navigateTo('groups')}>👥 Groups</button>
      <button className={`toggle-btn ${activePage === 'profile' ? 'active' : ''}`} onClick={() => navigateTo('profile')}>👤 Profile</button>
    </div>
  );

  if (page === 'profile') {
    return (
      <div className="container">
        <header>
          <h1>📚 Study Timeline</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <NavButtons activePage="profile" />
          </div>
        </header>
        <ProfilePage user={user} onLogout={handleLogout} />
      </div>
    );
  }

  if (page === 'notifications') {
    return (
      <div className="container">
        <header>
          <h1>📚 Study Timeline</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <NavButtons activePage="notifications" />
          </div>
        </header>
        <NotificationsPage />
      </div>
    );
  }

  if (page === 'groups') {
    if (currentGroupId) {
      return (
        <div className="container">
          <header>
            <h1>📚 Study Timeline</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
              <NavButtons activePage="groups" />
            </div>
          </header>
          <GroupDetailPage groupId={currentGroupId} onBack={backFromGroup} user={user} />
        </div>
      );
    }
    return (
      <div className="container">
        <header>
          <h1>📚 Study Timeline</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <NavButtons activePage="groups" />
          </div>
        </header>
        <GroupsPage onOpenGroup={openGroup} />
      </div>
    );
  }

  if (page === 'calendar') {
    return (
      <div className="container">
        <header>
          <h1>📚 Study Timeline</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
            <NavButtons activePage="calendar" />
          </div>
        </header>
        {!loading && <CalendarView assignments={assignments} onToggleSubtask={handleToggleSubtask} onRefresh={loadAssignments} />}
        {loading && <div className="loading">Loading...</div>}
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <h1>📚 Study Timeline</h1>
        <p>Turn assignment deadlines into a clear, actionable study plan</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
          <NavButtons activePage="list" />
          <NotifBell count={notifCount} onClick={() => navigateTo('notifications')} />
        </div>
      </header>

      {/* Form */}
      <div className="form-card">
        <div className="form-card-header">
          <h2>➕ Add New Assignment</h2>
          <div className="mode-toggle">
            <button className={`mode-btn ${!manualMode ? 'active' : ''}`} onClick={() => setManualMode(false)}>🤖 AI</button>
            <button className={`mode-btn ${manualMode ? 'active' : ''}`} onClick={() => setManualMode(true)}>✏️ Manual</button>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Assignment Name</label>
              <input name="title" type="text" placeholder="e.g. Final Essay" value={form.title} onChange={handleFormChange} required />
            </div>
            <div className="form-group">
              <label>Course Code</label>
              <input name="course_code" type="text" placeholder="e.g. CS101" value={form.course_code} onChange={handleFormChange} required />
            </div>
            <div className="form-group">
              <label>Deadline</label>
              <input name="deadline" type="datetime-local" value={form.deadline} onChange={handleFormChange} required />
            </div>
            <div className="form-group">
              <label>Estimated Hours</label>
              <input name="estimated_hours" type="number" min="0.5" step="0.5" placeholder="e.g. 12" value={form.estimated_hours} onChange={handleFormChange} required />
            </div>
          </div>

          {/* Manual subtasks */}
          {manualMode && (
            <div className="manual-subtasks">
              <div className="manual-subtasks-header">
                <h4>Subtasks</h4>
                <button type="button" className="add-subtask-btn" onClick={addSubtask}>+ Add</button>
              </div>
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

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating...' : (manualMode ? 'Create Assignment' : 'Generate Plan')}
          </button>
        </form>
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      {page === 'calendar' && !loading && (
        <CalendarView assignments={assignments} onToggleSubtask={handleToggleSubtask} onRefresh={loadAssignments} />
      )}

      {page === 'list' && (
        <>
          {loading && <div className="loading">Loading assignments...</div>}
          {!loading && assignments.length === 0 && <div className="empty-state"><div className="icon">📋</div><p>No assignments yet. Add your first one above!</p></div>}
          <div className="assignments-list">
            {assignments.map((a) => {
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
                      <div className="assignment-meta" style={{ marginTop: '0.3rem' }}><span>Deadline: {formatDate(a.deadline)}</span></div>
                    </div>
                    <button className="btn btn-danger" onClick={() => handleDelete(a.id)}>🗑 Delete</button>
                  </div>
                  <div className="progress-container">
                    <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${progress}%` }}></div></div>
                    <div className="progress-text">{completedCount}/{totalCount} tasks ({progress}%)</div>
                  </div>
                  {subtasks.length > 0 && (
                    <div className="timeline">
                      <h4>📅 Study Plan</h4>
                      {subtasks.sort((x, y) => {
                        const da = new Date(x.scheduled_date).getTime();
                        const db = new Date(y.scheduled_date).getTime();
                        if (da !== db) return da - db;
                        // Same date — sort by start_time
                        const ta = x.start_time || '00:00';
                        const tb = y.start_time || '00:00';
                        return ta.localeCompare(tb);
                      }).map((sub) => (
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
                          <button className="subtask-edit-btn" onClick={() => setEditingSubtask(sub)} title="Edit">✏️</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Subtask Edit Modal */}
      {editingSubtask && (
        <SubtaskEditModal subtask={editingSubtask} onSave={handleEditSubtask} onClose={() => setEditingSubtask(null)} />
      )}
    </div>
  );
}

export default App;
