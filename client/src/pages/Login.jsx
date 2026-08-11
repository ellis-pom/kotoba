import { useState } from 'react';
import { api } from '../api';

export default function Login({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const user = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      if (mode === 'register' && user.claimedExistingData) {
        setNotice('Welcome! Your account has inherited the study data already on this site.');
      }
      onAuthenticated(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <h1 className="page-title" style={{ fontSize: '1.6rem', textAlign: 'center' }}>ことば</h1>
        <p className="page-subtitle" style={{ textAlign: 'center', marginBottom: 24 }}>
          {mode === 'login' ? 'Log in to your study deck' : 'Create your account'}
        </p>

        <div className="tag-list" style={{ justifyContent: 'center', marginBottom: 20 }}>
          <button type="button" className={'tag-btn' + (mode === 'login' ? ' active' : '')} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
          <button type="button" className={'tag-btn' + (mode === 'register' ? ' active' : '')} onClick={() => { setMode('register'); setError(''); }}>Register</button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {notice && <p style={{ color: 'var(--success)', fontSize: '0.9rem' }}>{notice}</p>}

        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required minLength={3} />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            {mode === 'register' && <p style={{ fontSize: '0.8rem', color: 'var(--paper-dim)', marginTop: 6 }}>At least 8 characters.</p>}
          </div>
          <button type="submit" className="btn" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
