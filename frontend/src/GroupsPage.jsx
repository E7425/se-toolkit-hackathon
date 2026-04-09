import { useState, useEffect } from 'react';
import { createGroup, fetchGroups, joinGroup } from './api';

export default function GroupsPage({ onOpenGroup }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Join form
  const [showJoin, setShowJoin] = useState(false);
  const [joinKey, setJoinKey] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => { loadGroups(); }, []);

  const loadGroups = async () => {
    try {
      setLoading(true);
      const data = await fetchGroups();
      setGroups(data);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const group = await createGroup(createName, createDesc);
      setCreateName('');
      setCreateDesc('');
      setShowCreate(false);
      onOpenGroup(group.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinKey.trim()) return;
    setJoining(true);
    try {
      const group = await joinGroup(joinKey);
      setJoinKey('');
      setShowJoin(false);
      onOpenGroup(group.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="groups-page">
      <div className="groups-header">
        <h2>👥 My Groups</h2>
        <div className="groups-actions">
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); setShowJoin(false); }}>
            ➕ Create Group
          </button>
          <button className="btn btn-secondary" onClick={() => { setShowJoin(true); setShowCreate(false); }}>
            🔑 Join with Key
          </button>
        </div>
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      {/* Create form */}
      {showCreate && (
        <div className="group-form-card">
          <h3>Create New Group</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="e.g., CS101 Study Group"
                required
              />
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <input
                type="text"
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                placeholder="Group description"
              />
            </div>
            <div className="group-form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Join form */}
      {showJoin && (
        <div className="group-form-card">
          <h3>Join Group</h3>
          <form onSubmit={handleJoin}>
            <div className="form-group">
              <label>Invite Key</label>
              <input
                type="text"
                value={joinKey}
                onChange={e => setJoinKey(e.target.value)}
                placeholder="Paste the invite key from a group member"
                required
              />
            </div>
            <div className="group-form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowJoin(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={joining}>
                {joining ? 'Joining...' : 'Join'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Groups list */}
      {loading && <div className="loading">Loading groups...</div>}
      {!loading && groups.length === 0 && !showCreate && !showJoin && (
        <div className="empty-state">
          <div className="icon">👥</div>
          <p>No groups yet. Create one or join with an invite key!</p>
        </div>
      )}
      {!loading && groups.length > 0 && (
        <div className="groups-list">
          {groups.map(g => (
            <div key={g.id} className="group-card" onClick={() => onOpenGroup(g.id)}>
              <div className="group-card-info">
                <h3>{g.name}</h3>
                {g.description && <p>{g.description}</p>}
                <div className="group-card-meta">
                  <span className={`role-badge role-${g.my_role}`}>
                    {g.my_role === 'owner' ? '👑 Owner' : g.my_role === 'admin' ? '🛡️ Admin' : '👤 Member'}
                  </span>
                </div>
              </div>
              <span className="group-card-arrow">▶</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
