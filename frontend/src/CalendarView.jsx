import { useState, useMemo } from 'react';

const HOUR_HEIGHT = 60; // px per hour
const START_HOUR = 8;
const END_HOUR = 22;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const COURSE_COLORS = [
  '#4285f4', '#ea4335', '#fbbc04', '#34a853',
  '#8e44ad', '#e67e22', '#1abc9c', '#e91e63',
  '#00bcd4', '#795548', '#607d8b', '#3f51b5',
];

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
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

function timeToHeight(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return HOUR_HEIGHT;
  const [h, m] = timeStr.split(':').map(Number);
  return h * HOUR_HEIGHT + m;
}

function formatHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

export default function CalendarView({ assignments, onToggleSubtask }) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // Collect all subtasks for this week
  const subtasksByDay = useMemo(() => {
    const map = {};
    weekDays.forEach(d => {
      const key = d.toISOString().slice(0, 10);
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

  const todayStr = new Date().toISOString().slice(0, 10);

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const todayBtn = () => setWeekStart(getWeekStart(new Date()));

  const startDate = weekDays[0];
  const endDate = weekDays[6];
  const weekLabel = startDate.getDate() === weekDays[6].getDate() && startDate.getMonth() === weekDays[6].getMonth()
    ? `${startDate.getDate()} ${MONTHS_RU[startDate.getMonth()]}`
    : startDate.getMonth() === endDate.getMonth()
      ? `${startDate.getDate()} – ${endDate.getDate()} ${MONTHS_RU[startDate.getMonth()]} ${startDate.getFullYear()}`
      : `${startDate.getDate()} ${MONTHS_RU[startDate.getMonth()]} – ${endDate.getDate()} ${MONTHS_RU[endDate.getMonth()]} ${endDate.getFullYear()}`;

  return (
    <div className="calendar-container">
      {/* Header */}
      <div className="calendar-header">
        <div className="calendar-nav">
          <button className="cal-nav-btn" onClick={prevWeek}>◀</button>
          <button className="cal-nav-btn today-btn" onClick={todayBtn}>Сегодня</button>
          <button className="cal-nav-btn" onClick={nextWeek}>▶</button>
          <h2>{weekLabel}</h2>
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
          const dateKey = day.toISOString().slice(0, 10);
          const daySubtasks = subtasksByDay[dateKey] || [];
          const isToday = dateKey === todayStr;

          return (
            <div key={dateKey} className={`cal-day-col ${isToday ? 'cal-today' : ''}`}>
              <div className={`cal-day-header ${isToday ? 'cal-today-header' : ''}`}>
                <span className="cal-day-name">{DAYS_RU[idx]}</span>
                <span className="cal-day-num">{day.getDate()}</span>
              </div>
              <div className="cal-day-body" style={{ height: HOURS.length * HOUR_HEIGHT }}>
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="cal-hour-line" style={{ height: HOUR_HEIGHT }}></div>
                ))}
                {/* Subtask blocks */}
                {daySubtasks.map(s => {
                  const top = timeToOffset(s.start_time);
                  if (top === null || top < 0) return null;
                  const color = getCourseColor(s.courseCode);
                  const startTime = s.start_time || '09:00';
                  const endTime = s.end_time || '11:00';
                  const [sh] = startTime.split(':').map(Number);
                  const [eh] = endTime.split(':').map(Number);
                  const height = Math.max(((eh - sh) * 60) / 60 * HOUR_HEIGHT, 30);

                  return (
                    <div
                      key={s.id}
                      className={`cal-event ${s.completed ? 'cal-event-done' : ''}`}
                      style={{
                        top: top + 'px',
                        height: height + 'px',
                        backgroundColor: color + '22',
                        borderLeft: `3px solid ${color}`,
                      }}
                      onClick={() => onToggleSubtask && onToggleSubtask(s.id, s.completed)}
                      title={`${s.title}\n${s.courseCode} | ${s.description || ''}`}
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
    </div>
  );
}
