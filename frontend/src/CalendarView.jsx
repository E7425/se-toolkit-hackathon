import { useState, useMemo, useCallback, useRef } from 'react';
import { deleteSubtask, updateSubtaskTime, moveSubtask, updateSubtaskFull } from './api';

const HOUR_HEIGHT = 60;
const START_HOUR = 8;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const DAYS_RU = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS_RU = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const COURSE_COLORS = [
  '#4285f4', '#ea4335', '#fbbc04', '#34a853',
  '#8e44ad', '#e67e22', '#1abc9c', '#e91e63',
  '#00bcd4', '#795548', '#607d8b', '#3f51b5',
];

// Available time slots for the dropdown
const TIME_OPTIONS = [];
for (let h = START_HOUR; h <= END_HOUR; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === END_HOUR && m > 0) break;
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function getCourseColor(courseCode) {
  let hash = 0;
  for (let i = 0; i < courseCode.length; i++) {
    hash = courseCode.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
}

function timeToOffset(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return (h - START_HOUR) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
}

function formatHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

/* ===== Hover Tooltip ===== */
function EventTooltip({ subtask, mouseX, mouseY }) {
  if (!subtask) return null;
  const startTime = subtask.start_time || '09:00';
  const endTime = subtask.end_time || '11:00';
  const dateStr = subtask.scheduled_date ? subtask.scheduled_date.slice(0, 10) : '';
  const [durSh, durSm] = startTime.split(':').map(Number);
  const [durEh, durEm] = endTime.split(':').map(Number);
  const durMin = (durEh * 60 + durEm) - (durSh * 60 + durSm);
  const durH = Math.floor(durMin / 60);
  const durM = durMin % 60;
  const durStr = durH > 0 ? `${durH}ч ${durM > 0 ? durM + 'м' : ''}` : `${durM}м`;
  const color = subtask._color || '#4285f4';

  return (
    <div
      className="cal-tooltip"
      style={{
        left: mouseX + 16,
        top: mouseY - 10,
      }}
    >
      <div className="cal-tooltip-accent" style={{ backgroundColor: color }}></div>
      <div className="cal-tooltip-body">
        <div className="cal-tooltip-title">{subtask.title}</div>
        {subtask.description && <div className="cal-tooltip-desc">{subtask.description}</div>}
        <div className="cal-tooltip-meta">
          <span>📅 {dateStr}</span>
          <span>🕐 {startTime} – {endTime}</span>
          <span>⏱ {durStr}</span>
          {subtask.courseCode && <span style={{ color, fontWeight: 600 }}>{subtask.courseCode}</span>}
          {subtask.completed && <span>✅</span>}
        </div>
      </div>
    </div>
  );
}

/* ===== Edit Modal ===== */
function EditTimeModal({ subtask, onClose, onRefresh }) {
  const rawStart = subtask.start_time || '09:00';
  const rawEnd = subtask.end_time || '11:00';
  const rawDate = subtask.scheduled_date ? subtask.scheduled_date.slice(0, 10) : '';
  const [title, setTitle] = useState(subtask.title || '');
  const [description, setDescription] = useState(subtask.description || '');
  const [schedDate, setSchedDate] = useState(rawDate);
  const [startTime, setStartTime] = useState(rawStart);
  const [endTime, setEndTime] = useState(rawEnd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!startTime || !endTime) { setError('Please fill in the time'); return; }
    if (startTime >= endTime) { setError('End time must be after start time'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title,
        description,
        start_time: startTime,
        end_time: endTime,
      };
      if (schedDate) {
        payload.scheduled_date = new Date(schedDate + 'T' + startTime + ':00').toISOString();
      }
      await updateSubtaskFull(subtask.id, payload);
      if (onRefresh) await onRefresh();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete subtask "${subtask.title}"?`)) return;
    setSaving(true);
    try {
      await deleteSubtask(subtask.id);
      if (onRefresh) await onRefresh();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="modal-header">
          <h3>✏️ Edit</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-subtitle">{subtask.courseCode}</p>
          <div className="modal-fields" style={{ flexDirection: 'column', gap: '0.75rem' }}>
            <div className="modal-field">
              <label>Title</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Description</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Date</label>
              <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Start</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} step={900} min="08:00" max="23:00" />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>End</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} step={900} min="08:00" max="23:30" />
              </div>
            </div>
          </div>
          {error && <div className="modal-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-modal-delete" onClick={handleDelete}>🗑 Delete</button>
          <button className="btn-modal-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : '💾 Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarView({ assignments, onToggleSubtask, onRefresh, onMoveSubtask }) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [editingSubtask, setEditingSubtask] = useState(null);

  // Hover tooltip
  const [hoveredSubtask, setHoveredSubtask] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Drag & drop
  const [draggingSubtask, setDraggingSubtask] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [dragOverMinutes, setDragOverMinutes] = useState(null); // minutes from START_HOUR
  const dragCounter = useRef(0);

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const subtasksByDay = useMemo(() => {
    const map = {};
    weekDays.forEach(d => {
      const key = localDateStr(d);
      map[key] = [];
    });
    assignments.forEach(a => {
      (a.subtasks || []).forEach(s => {
        const dateKey = s.scheduled_date.slice(0, 10);
        if (map[dateKey]) {
          map[dateKey].push({ ...s, courseCode: a.course_code, courseTitle: a.title });
        }
      });
    });
    return map;
  }, [assignments, weekDays]);

  const todayStr = localDateStr(new Date());

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };
  const todayBtn = () => setWeekStart(getWeekStart(new Date()));

  const startDate = weekDays[0];
  const endDate = weekDays[6];
  const weekLabel = startDate.getMonth() === endDate.getMonth()
    ? `${startDate.getDate()} – ${endDate.getDate()} ${MONTHS_RU[startDate.getMonth()]} ${startDate.getFullYear()}`
    : `${startDate.getDate()} ${MONTHS_RU[startDate.getMonth()]} – ${endDate.getDate()} ${MONTHS_RU[endDate.getMonth()]} ${endDate.getFullYear()}`;

  const handleEventClick = useCallback((e, s) => {
    if (dragCounter.current > 0) return;
    e.stopPropagation();
    setEditingSubtask(s);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (onRefresh) await onRefresh();
  }, [onRefresh]);

  // ===== Pixel-Precise Drag & Drop =====
  const SNAP_MINUTES = 15; // snap to 15-min slots for precision
  const columnRects = useRef({});

  const pixelYtoMinutes = useCallback((clientY, dateKey) => {
    const rect = columnRects.current[dateKey];
    if (!rect) return null;
    const y = clientY - rect.top;
    const totalMinutes = Math.max(0, (y / HOUR_HEIGHT) * 60);
    // Snap to nearest slot
    return Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  }, []);

  const minutesToTimeStr = useCallback((mins) => {
    const totalMins = START_HOUR * 60 + Math.max(0, mins);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(Math.min(h, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }, []);

  const handleDragStart = useCallback((e, subtask) => {
    setDraggingSubtask(subtask);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', subtask.id);
    if (e.target) {
      e.dataTransfer.setDragImage(e.target, 40, 10);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingSubtask(null);
    setDragOverDay(null);
    setDragOverMinutes(null);
    dragCounter.current = 0;
  }, []);

  const handleColumnDragEnter = useCallback((e, dateKey) => {
    dragCounter.current++;
    // Measure column rect immediately
    columnRects.current[dateKey] = e.currentTarget.getBoundingClientRect();
    setDragOverDay(dateKey);
    const mins = pixelYtoMinutes(e.clientY, dateKey);
    setDragOverMinutes(mins);
  }, [pixelYtoMinutes]);

  const handleColumnDragOver = useCallback((e, dateKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Always measure fresh rect in case of scroll
    columnRects.current[dateKey] = e.currentTarget.getBoundingClientRect();
    setDragOverDay(dateKey);
    const mins = pixelYtoMinutes(e.clientY, dateKey);
    setDragOverMinutes(mins);
  }, [pixelYtoMinutes]);

  const handleColumnDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOverDay(null);
      setDragOverMinutes(null);
    }
  }, []);

  const handleColumnDrop = useCallback(async (e, dateKey) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverDay(null);
    setDragOverMinutes(null);
    if (!draggingSubtask) return;

    let startMins = dragOverMinutes;
    if (startMins === null || startMins < 0) startMins = 0;
    startMins = Math.max(0, Math.min(startMins, (END_HOUR - START_HOUR) * 60));
    const newStart = minutesToTimeStr(startMins);

    const [sh, sm] = (draggingSubtask.start_time || '09:00').split(':').map(Number);
    const [eh, em] = (draggingSubtask.end_time || '11:00').split(':').map(Number);
    const durMin = Math.max((eh * 60 + em) - (sh * 60 + sm), 30);
    const endTotalMins = START_HOUR * 60 + startMins + durMin;
    const endH = Math.min(Math.floor(endTotalMins / 60), 23);
    const endM = endH < 23 ? endTotalMins % 60 : 0;
    const newEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    const schedDate = `${dateKey}T${newStart}:00`;
    try {
      if (onMoveSubtask) {
        await onMoveSubtask(draggingSubtask.id, new Date(schedDate).toISOString(), newStart, newEnd);
      } else {
        await moveSubtask(draggingSubtask.id, new Date(schedDate).toISOString(), newStart, newEnd, false);
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Failed to move subtask:', err);
    }
    setDraggingSubtask(null);
  }, [draggingSubtask, dragOverMinutes, minutesToTimeStr, onRefresh, onMoveSubtask]);

  // Ghost element: pixel position + precise height
  const ghostTop = dragOverMinutes !== null
    ? Math.max(0, (dragOverMinutes / 60)) * HOUR_HEIGHT
    : null;

  const ghostHeight = useMemo(() => {
    if (!draggingSubtask) return 120;
    const [sh, sm] = (draggingSubtask.start_time || '09:00').split(':').map(Number);
    const [eh, em] = (draggingSubtask.end_time || '11:00').split(':').map(Number);
    const durMin = Math.max((eh * 60 + em) - (sh * 60 + sm), 30);
    return (durMin / 60) * HOUR_HEIGHT;
  }, [draggingSubtask]);

  return (
    <div className="calendar-container">
      {/* Header */}
      <div className="calendar-header">
        <div className="calendar-nav">
          <button className="cal-nav-btn" onClick={prevWeek}>◀</button>
          <button className="cal-nav-btn today-btn" onClick={todayBtn}>Today</button>
          <button className="cal-nav-btn" onClick={nextWeek}>▶</button>
          <h2>{weekDays[0].getDate()} – {weekDays[6].getDate()} {MONTHS_RU[weekDays[0].getMonth()]} {weekDays[0].getFullYear()}</h2>
        </div>
      </div>

      {/* Grid */}
      <div className="calendar-grid">
        {/* Time column */}
        <div className="cal-time-col">
          <div className="cal-time-header"></div>
          {HOURS.map(h => (
            <div key={h} className="cal-time-label" style={{ height: HOUR_HEIGHT }}>
              {formatHour(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, idx) => {
          const dateKey = localDateStr(day);
          const daySubtasks = subtasksByDay[dateKey] || [];
          const isToday = dateKey === todayStr;
          const isDragOver = dragOverDay === dateKey;

          return (
            <div
              key={dateKey}
              className={`cal-day-col ${isToday ? 'cal-today' : ''} ${isDragOver ? 'drag-over' : ''}`}
              onDragEnter={(e) => handleColumnDragEnter(e, dateKey)}
              onDragOver={(e) => handleColumnDragOver(e, dateKey)}
              onDragLeave={handleColumnDragLeave}
              onDrop={(e) => handleColumnDrop(e, dateKey)}
            >
              <div className={`cal-day-header ${isToday ? 'cal-today-header' : ''}`}>
                <span className="cal-day-name">{DAYS_RU[idx]}</span>
                <span className="cal-day-num">{day.getDate()}</span>
              </div>
              <div className="cal-day-body" style={{ height: HOURS.length * HOUR_HEIGHT, position: 'relative' }}>
                {HOURS.map(h => (
                  <div key={h} className="cal-hour-line" style={{ height: HOUR_HEIGHT }}></div>
                ))}
                {/* Ghost drop indicator */}
                {isDragOver && ghostTop !== null && draggingSubtask && (
                  <div
                    className="cal-ghost-event"
                    style={{
                      top: ghostTop + 'px',
                      height: ghostHeight + 'px',
                    }}
                  >
                    <div className="cal-ghost-title">{draggingSubtask.title}</div>
                    <div className="cal-ghost-time">{minutesToTimeStr(dragOverMinutes)} – {(() => { const [sh,sm]=(draggingSubtask.start_time||'09:00').split(':').map(Number); const [eh,em]=(draggingSubtask.end_time||'11:00').split(':').map(Number); const dur=(eh*60+em)-(sh*60+sm); const total=START_HOUR*60+dragOverMinutes+dur; const h=Math.min(Math.floor(total/60),23); const m=h<23?total%60:0; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; })()}</div>
                  </div>
                )}
                {daySubtasks.map(s => {
                  const top = timeToOffset(s.start_time);
                  if (top === null || top < 0) return null;
                  const color = getCourseColor(s.courseCode);
                  const startTime = s.start_time || '09:00';
                  const endTime = s.end_time || '11:00';
                  const [sh, sm] = startTime.split(':').map(Number);
                  const [eh, em] = endTime.split(':').map(Number);
                  const height = Math.max((((eh * 60 + em) - (sh * 60 + sm)) / 60) * HOUR_HEIGHT, 30);
                  const isDragging = draggingSubtask && draggingSubtask.id === s.id;

                  return (
                    <div
                      key={s.id}
                      className={`cal-event ${s.completed ? 'cal-event-done' : ''} ${isDragging ? 'drag-preview' : ''}`}
                      style={{
                        top: top + 'px',
                        height: height + 'px',
                        backgroundColor: color + '22',
                        borderLeft: `3px solid ${color}`,
                        opacity: isDragging ? 0.3 : 1,
                      }}
                      draggable={!isDragging}
                      onDragStart={(e) => handleDragStart(e, s)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => handleEventClick(e, s)}
                      onMouseEnter={(e) => {
                        if (!draggingSubtask) {
                          setHoveredSubtask({ ...s, _color: color });
                          setMousePos({ x: e.clientX, y: e.clientY });
                        }
                      }}
                      onMouseMove={(e) => {
                        if (hoveredSubtask && hoveredSubtask.id === s.id) {
                          setMousePos({ x: e.clientX, y: e.clientY });
                        }
                      }}
                      onMouseLeave={() => setHoveredSubtask(null)}
                    >
                      <div className="cal-event-title">{s.title}</div>
                      <div className="cal-event-course" style={{ color }}>{s.courseCode}</div>
                      <div className="cal-event-time">{startTime} – {endTime}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover Tooltip */}
      <EventTooltip subtask={hoveredSubtask} mouseX={mousePos.x} mouseY={mousePos.y} />

      {/* Edit Modal */}
      {editingSubtask && (
        <EditTimeModal
          subtask={editingSubtask}
          onClose={() => setEditingSubtask(null)}
          onSave={() => {}}
          onDelete={() => {}}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}
