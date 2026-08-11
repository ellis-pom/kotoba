import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/lessons', label: 'Lessons' },
  { to: '/lessons/new', label: 'Add Lesson' },
  { to: '/study', label: 'Study' },
  { to: '/quiz', label: 'Quiz' },
  { to: '/test', label: 'Test' },
  { to: '/verbs', label: 'Verbs' },
  { to: '/stats', label: 'Stats' },
  { to: '/backup', label: 'Backup' },
];

export default function Sidebar({ username, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="kanji-mark">言</span>Kotoba</div>
      <div className="sidebar-sub">みんなの日本語 companion</div>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
        >
          {l.label}
        </NavLink>
      ))}
      {username && (
        <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--paper-dim)', marginBottom: 8 }}>Logged in as <strong>{username}</strong></div>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onLogout}>Log out</button>
        </div>
      )}
    </aside>
  );
}
