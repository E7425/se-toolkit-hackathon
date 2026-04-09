import { useState } from 'react';
import { register, login } from './api';

export default function AuthPage({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        const res = await login(email, password);
        localStorage.setItem('token', res.access_token);
        localStorage.setItem('user', JSON.stringify(res.user));
        onLogin(res.user);
      } else {
        await register(email, password, displayName);
        setIsLogin(true);
        setError('Account created! Please sign in.');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">📚 Study Timeline</div>
        <h2>{isLogin ? 'Sign In' : 'Register'}</h2>
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="auth-field">
              <label>Name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div className="auth-field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" required />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} />
          </div>
          {error && <div className={`auth-error ${error.includes('created') ? 'success' : ''}`}>{error}</div>}
          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'Loading...' : (isLogin ? 'Sign In' : 'Register')}
          </button>
        </form>
        <div className="auth-toggle">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button className="auth-link" onClick={() => { setIsLogin(!isLogin); setError(''); }}>
            {isLogin ? 'Register' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
