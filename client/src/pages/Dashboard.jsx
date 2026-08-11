import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [lessons, setLessons] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getLessons().then(setLessons).catch((e) => setError(e.message));
    api.getReviewStats({}).then(setStats).catch(() => {});
  }, []);

  const latest = lessons[lessons.length - 1];
  const totalVocab = lessons.reduce((sum, l) => sum + l.vocab_count, 0);
  const totalKanji = lessons.reduce((sum, l) => sum + l.kanji_count, 0);

  return (
    <div>
      <h1 className="page-title">おかえりなさい</h1>
      <p className="page-subtitle">Welcome back. Here's where your study stands.</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-grid">
        <div className="stat-box"><div className="value">{lessons.length}</div><div className="label">Lessons uploaded</div></div>
        <div className="stat-box"><div className="value">{totalVocab}</div><div className="label">Vocabulary words</div></div>
        <div className="stat-box"><div className="value">{totalKanji}</div><div className="label">Kanji</div></div>
        <div className="stat-box"><div className="value">{stats?.due_now ?? '—'}</div><div className="label">Cards due now</div></div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Quick actions</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/study" className="btn">Start reviewing{stats?.due_now ? ` (${stats.due_now} due)` : ''}</Link>
          <Link to="/lessons/new" className="btn btn-secondary">Add a lesson</Link>
          <Link to="/quiz" className="btn btn-secondary">Take a quiz</Link>
          <Link to="/stats" className="btn btn-secondary">View progress</Link>
        </div>
      </div>

      {latest && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Most recent lesson</h3>
          <p style={{ color: 'var(--paper-dim)', marginBottom: 12 }}>
            Lesson {latest.number}{latest.title ? ` — ${latest.title}` : ''}: {latest.vocab_count} words, {latest.kanji_count} kanji, {latest.culture_count} culture note(s).
          </p>
          <Link to={`/lessons/${latest.number}`} className="btn btn-secondary">View lesson</Link>
        </div>
      )}

      {lessons.length === 0 && !error && (
        <div className="empty-state">
          <h3>No lessons yet</h3>
          <p>Add Lesson 1 to get started — paste in your vocabulary, kanji, culture notes, and grammar points.</p>
          <Link to="/lessons/new" className="btn" style={{ marginTop: 12 }}>Add your first lesson</Link>
        </div>
      )}
    </div>
  );
}
