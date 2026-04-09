import { useState, useEffect, useRef } from 'react';
import { getStats, updateProfile, uploadAvatar } from './api';

export default function ProfilePage({ user, onLogout }) {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [period, setPeriod] = useState('all');
  const [stats, setStats] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  useEffect(() => { loadStats(); }, [period]);

  const loadStats = async () => {
    const now = new Date();
    let start = '';
    if (period === 'week') { const w = new Date(now); w.setDate(w.getDate() - 7); start = w.toISOString().slice(0, 10); }
    else if (period === 'month') { const m = new Date(now); m.setMonth(m.getMonth() - 1); start = m.toISOString().slice(0, 10); }
    const data = await getStats(start);
    setStats(data);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile(displayName);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {} finally { setSaving(false); }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadAvatar(file);
      setAvatarUrl(res.avatar_url);
      localStorage.setItem('user', JSON.stringify({ ...user, avatar_url: res.avatar_url }));
    } catch {} finally { setUploading(false); }
  };

  const avatarDisplay = avatarUrl || '🤓';
  const isImage = avatarUrl && avatarUrl.startsWith('data:image');

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar-big">
          {isImage ? <img src={avatarDisplay} alt="avatar" className="avatar-img" /> : <span>{avatarDisplay}</span>}
        </div>
        <h2>{displayName || user.email}</h2>
        <p className="profile-email">{user.email}</p>
      </div>

      {/* Avatar Upload */}
      <div className="profile-section">
        <h3>📷 Avatar</h3>
        <div className="avatar-upload-row">
          <input type="file" accept="image/*" ref={fileRef} onChange={handleAvatarUpload} style={{ display: 'none' }} />
          <button className="avatar-upload-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload Image'}
          </button>
        </div>
      </div>

      {/* Name */}
      <div className="profile-section">
        <h3>Name</h3>
        <div className="profile-name-row">
          <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
          <button className="profile-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? '...' : saved ? '✓' : '💾'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="profile-section">
        <div className="stats-header">
          <h3>📊 Statistics</h3>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="stats-period">
            <option value="all">All time</option>
            <option value="week">Last week</option>
            <option value="month">Last month</option>
          </select>
        </div>
        {stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.total_completed_hours}</div>
              <div className="stat-label">Hours completed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_completed_tasks}</div>
              <div className="stat-label">Subtasks completed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_completed_assignments}</div>
              <div className="stat-label">Assignments completed</div>
            </div>
          </div>
        )}
      </div>

      {/* Logout */}
      <button className="profile-logout" onClick={onLogout}>🚪 Sign Out</button>
    </div>
  );
}
