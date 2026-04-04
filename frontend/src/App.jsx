import { useState, useEffect, useCallback } from 'react';
import { fetchAssignments, createAssignment, toggleSubtask, deleteAssignment } from './api';

function App() {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [form, setForm] = useState({
    title: '',
    course_code: '',
    deadline: '',
    estimated_hours: '',
  });

  const loadAssignments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAssignments();
      setAssignments(data);
      setError(null);
    } catch (err) {
      setError('Failed to load assignments. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.course_code || !form.deadline || !form.estimated_hours) return;

    setSubmitting(true);
    setError(null);
    try {
      await createAssignment({
        title: form.title,
        course_code: form.course_code,
        deadline: new Date(form.deadline).toISOString(),
        estimated_hours: parseFloat(form.estimated_hours),
      });
      setForm({ title: '', course_code: '', deadline: '', estimated_hours: '' });
      await loadAssignments();
    } catch (err) {
      setError(err.message || 'Failed to create assignment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSubtask = async (subtaskId, currentStatus) => {
    try {
      await toggleSubtask(subtaskId, !currentStatus);
      await loadAssignments();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this assignment and all subtasks?')) return;
    try {
      await deleteAssignment(id);
      await loadAssignments();
    } catch (err) {
      setError(err.message);
    }
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const getDaysUntil = (dateStr) => {
    const now = new Date();
    const deadline = new Date(dateStr);
    const diff = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'Overdue';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `In ${diff} days`;
  };

  return (
    <div className="container">
      <header>
        <h1>📚 Study Timeline</h1>
        <p>Turn assignment deadlines into a clear, actionable study plan</p>
      </header>

      {/* Form */}
      <div className="form-card">
        <h2>➕ Add New Assignment</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="title">Assignment Name</label>
              <input
                id="title"
                name="title"
                type="text"
                placeholder="e.g. Final Essay"
                value={form.title}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="course_code">Course Code</label>
              <input
                id="course_code"
                name="course_code"
                type="text"
                placeholder="e.g. CS101"
                value={form.course_code}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="deadline">Deadline</label>
              <input
                id="deadline"
                name="deadline"
                type="datetime-local"
                value={form.deadline}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="estimated_hours">Estimated Hours</label>
              <input
                id="estimated_hours"
                name="estimated_hours"
                type="number"
                min="0.5"
                step="0.5"
                placeholder="e.g. 12"
                value={form.estimated_hours}
                onChange={handleFormChange}
                required
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Generating Plan...' : 'Generate Study Plan'}
          </button>
        </form>
      </div>

      {/* Error */}
      {error && <div className="error">⚠️ {error}</div>}

      {/* Loading */}
      {loading && <div className="loading">Loading assignments...</div>}

      {/* Assignments */}
      {!loading && assignments.length === 0 && (
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>No assignments yet. Add your first one above!</p>
        </div>
      )}

      <div className="assignments-list">
        {assignments.map((a) => {
          const subtasks = a.subtasks || [];
          const completedCount = subtasks.filter((s) => s.completed).length;
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
                    <span>Deadline: {formatDate(a.deadline)}</span>
                  </div>
                </div>
                <button className="btn btn-danger" onClick={() => handleDelete(a.id)}>
                  🗑 Delete
                </button>
              </div>

              {/* Progress */}
              <div className="progress-container">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="progress-text">
                  {completedCount}/{totalCount} tasks ({progress}%)
                </div>
              </div>

              {/* Timeline */}
              {a.subtasks.length > 0 && (
                <div className="timeline">
                  <h4>📅 Study Plan</h4>
                  {a.subtasks
                    .sort((x, y) => new Date(x.scheduled_date) - new Date(y.scheduled_date))
                    .map((sub) => (
                      <div key={sub.id} className="subtask">
                        <input
                          type="checkbox"
                          checked={sub.completed}
                          onChange={() => handleToggleSubtask(sub.id, sub.completed)}
                        />
                        <div className="subtask-content">
                          <div className={`subtask-title ${sub.completed ? 'completed' : ''}`}>
                            {sub.title}
                          </div>
                          {sub.description && (
                            <div className="subtask-desc">{sub.description}</div>
                          )}
                        </div>
                        <div className="subtask-date">
                          {formatDate(sub.scheduled_date)}
                          <br />
                          {sub.estimated_hours}h
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
