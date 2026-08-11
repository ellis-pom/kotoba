import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Lessons() {
  const [lessons, setLessons] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.getLessons().then(setLessons).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const handleDelete = async (number) => {
    if (!confirm(`Delete Lesson ${number} and all its content? This can't be undone.`)) return;
    await api.deleteLesson(number);
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Lessons</h1>
        <Link to="/lessons/new" className="btn">+ Add lesson</Link>
      </div>
      <p className="page-subtitle">Everything you've uploaded so far, in Minna no Nihongo order.</p>

      {error && <div className="error-banner">{error}</div>}

      {lessons.length === 0 ? (
        <div className="empty-state">
          <h3>No lessons uploaded</h3>
          <p>Add your first lesson to start building your review deck.</p>
        </div>
      ) : (
        lessons.map((l) => (
          <div className="lesson-row" key={l.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div className="num">{String(l.number).padStart(2, '0')}</div>
              <div>
                <div style={{ fontWeight: 500 }}>{l.title || `Lesson ${l.number}`}</div>
                <div style={{ color: 'var(--paper-dim)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                  {l.vocab_count} vocab · {l.kanji_count} kanji · {l.grammar_count} grammar · {l.culture_count} culture
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to={`/lessons/${l.number}`} className="btn btn-secondary">View</Link>
              <Link to={`/lessons/${l.number}/edit`} className="btn btn-secondary">Edit</Link>
              <button className="btn btn-secondary" onClick={() => handleDelete(l.number)}>Delete</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
