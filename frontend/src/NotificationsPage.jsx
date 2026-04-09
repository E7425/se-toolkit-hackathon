import { useState, useEffect } from 'react';

const ICONS = {
  deadline_24h: '⏰',
  deadline_30m: '🔴',
  subtask_start: '▶️',
  group_assignment: '👥',
};

const TITLES = {
  deadline_24h: 'Deadline in 24 hours',
  deadline_30m: 'Deadline in 30 minutes!',
  subtask_start: 'Time to start subtask',
  group_assignment: 'Group assignment',
};

function generateNotifications(assignments, groupData) {
  const now = new Date();
  const HOURS_24 = 24 * 60 * 60 * 1000;
  const notifs = [];

  function addNotif(id, type, title, desc, time, group, groupName) {
    const diffMs = time - now;
    // Show if event is within ±24 hours from now
    if (Math.abs(diffMs) <= HOURS_24) {
      notifs.push({ id, type, title, desc, time, group, groupName: groupName || '' });
    }
  }

  // Personal assignments
  (assignments || []).forEach(a => {
    if (a.completed) return;
    const deadline = new Date(a.deadline);
    const diffH = (deadline - now) / (1000 * 60 * 60);
    const diffMin = (deadline - now) / (1000 * 60);

    if (diffH > 0 && diffH <= 25) {
      addNotif(
        `p24h-${a.id}`, 'deadline_24h',
        `${a.title} (${a.course_code})`,
        `Deadline: ${deadline.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
        deadline, false
      );
    }

    if (diffMin > -1440 && diffMin <= 45) {
      // Still show for 24h after deadline
      addNotif(
        `p30m-${a.id}`, 'deadline_30m',
        `${a.title} (${a.course_code})`,
        diffMin > 0 ? 'Almost there!' : 'Deadline passed!',
        deadline, false
      );
    }

    (a.subtasks || []).forEach(s => {
      if (s.completed) return;
      const schedDate = new Date(s.scheduled_date);
      if (s.start_time) {
        const [h, m] = s.start_time.split(':').map(Number);
        schedDate.setHours(h, m, 0, 0);
      }
      const subDiffMin = (schedDate - now) / (1000 * 60);

      // Show for 24h after start time
      if (subDiffMin > -1440 && subDiffMin <= 30) {
        addNotif(
          `sub-${s.id}`, 'subtask_start',
          s.title,
          `${a.title} · ${a.course_code}`,
          schedDate, false
        );
      }
    });
  });

  // Group assignments
  if (groupData) {
    groupData.forEach(({ group, assignments: ga }) => {
      (ga || []).forEach(a => {
        if (a.completed) return;
        const deadline = new Date(a.deadline);
        const diffH = (deadline - now) / (1000 * 60 * 60);
        const diffMin = (deadline - now) / (1000 * 60);

        if (diffH > 0 && diffH <= 25) {
          addNotif(
            `g24h-${a.id}`, 'deadline_24h',
            `${a.title} (${a.course_code})`,
            `Deadline: ${deadline.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
            deadline, true, group.name
          );
        }

        if (diffMin > -1440 && diffMin <= 45) {
          addNotif(
            `g30m-${a.id}`, 'deadline_30m',
            `${a.title} (${a.course_code})`,
            diffMin > 0 ? 'Almost there!' : 'Deadline passed!',
            deadline, true, group.name
          );
        }

        (a.subtasks || []).forEach(s => {
          if (s.completed) return;
          const schedDate = new Date(s.scheduled_date);
          if (s.start_time) {
            const [h, m] = s.start_time.split(':').map(Number);
            schedDate.setHours(h, m, 0, 0);
          }
          const subDiffMin = (schedDate - now) / (1000 * 60);

          if (subDiffMin > -1440 && subDiffMin <= 30) {
            addNotif(
              `gsub-${s.id}`, 'subtask_start',
              s.title,
              `${a.title} · ${a.course_code}`,
              schedDate, true, group.name
            );
          }
        });
      });
    });
  }

  // Sort by time (most urgent first)
  notifs.sort((a, b) => a.time - b.time);
  return notifs;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, personal, group

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        // We'll receive assignments via props — but since this is standalone,
        // we compute in App.jsx and pass down. For now, use window._notifData
        const data = window._notifData || { assignments: [], groupData: [] };
        const notifs = generateNotifications(data.assignments, data.groupData);
        setNotifications(notifs);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const filtered = notifications.filter(n => {
    if (filter === 'personal') return !n.group;
    if (filter === 'group') return n.group;
    return true;
  });

  const urgentCount = notifications.filter(n => n.type === 'deadline_30m').length;
  const upcomingCount = notifications.filter(n => n.type === 'deadline_24h').length;
  const startingCount = notifications.filter(n => n.type === 'subtask_start').length;

  const formatTime = (date) => {
    const now = new Date();
    const diff = (date - now) / (1000 * 60);
    if (diff < 0) return `${Math.abs(Math.round(diff))}m ago`;
    if (diff < 60) return `in ${Math.round(diff)}m`;
    return `in ${Math.round(diff / 60)}h`;
  };

  return (
    <div className="notif-page">
      <div className="notif-page-header">
        <h2>🔔 Notifications</h2>
      </div>

      {/* Stats */}
      <div className="notif-stats">
        {urgentCount > 0 && (
          <div className="notif-stat urgent">
            <span className="notif-stat-icon">🔴</span>
            <div>
              <div className="notif-stat-value">{urgentCount}</div>
              <div className="notif-stat-label">Critical</div>
            </div>
          </div>
        )}
        {upcomingCount > 0 && (
          <div className="notif-stat upcoming">
            <span className="notif-stat-icon">⏰</span>
            <div>
              <div className="notif-stat-value">{upcomingCount}</div>
              <div className="notif-stat-label">Within 24h</div>
            </div>
          </div>
        )}
        {startingCount > 0 && (
          <div className="notif-stat starting">
            <span className="notif-stat-icon">▶️</span>
            <div>
              <div className="notif-stat-value">{startingCount}</div>
              <div className="notif-stat-label">Starting now</div>
            </div>
          </div>
        )}
        {notifications.length === 0 && (
          <div className="notif-stat">
            <div className="notif-stat-value" style={{ color: 'var(--success)' }}>✓</div>
            <div className="notif-stat-label">All clear</div>
          </div>
        )}
      </div>

      {/* Filter */}
      {notifications.length > 0 && (
        <div className="notif-filters">
          <button className={`notif-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All ({notifications.length})
          </button>
          <button className={`notif-filter-btn ${filter === 'personal' ? 'active' : ''}`} onClick={() => setFilter('personal')}>
            Personal ({notifications.filter(n => !n.group).length})
          </button>
          <button className={`notif-filter-btn ${filter === 'group' ? 'active' : ''}`} onClick={() => setFilter('group')}>
            Group ({notifications.filter(n => n.group).length})
          </button>
        </div>
      )}

      {/* List */}
      {loading && <div className="loading">Loading notifications...</div>}
      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <div className="icon">🔔</div>
          <p>No active notifications</p>
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <div className="notif-list">
          {filtered.map(n => (
            <div key={n.id} className={`notif-card ${n.type} ${n.group ? 'notif-group' : ''}`}>
              <div className="notif-card-icon">
                <span className="notif-icon-type">{ICONS[n.type]}</span>
                {n.group && <span className="notif-group-badge">👥</span>}
              </div>
              <div className="notif-card-body">
                <div className="notif-card-title">{n.title}</div>
                <div className="notif-card-desc">{n.desc}</div>
                {n.group && n.groupName && (
                  <div className="notif-card-group">Group: {n.groupName}</div>
                )}
              </div>
              <div className="notif-card-time">{formatTime(n.time)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
