import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import SpeakButton from '../components/SpeakButton.jsx';

function GrammarPointCard({ point, onExplained }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const explain = async () => {
    setLoading(true);
    setError('');
    try {
      const updated = await api.explainGrammar(point.id);
      onExplained(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: '1.15rem', fontFamily: 'var(--font-display)' }}>{point.pattern}</span>
          <SpeakButton text={point.pattern} />
          <div style={{ color: 'var(--paper-dim)', fontSize: '0.9rem' }}>{point.meaning_en}</div>
        </div>
        {!point.explanation && (
          <button className="btn btn-secondary" onClick={explain} disabled={loading}>
            {loading ? 'Explaining…' : 'Generate explanation'}
          </button>
        )}
      </div>
      {error && <div className="error-banner" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}
      {point.explanation && (
        <div style={{ marginTop: 10, fontSize: '0.9rem' }}>
          <p style={{ margin: '0 0 8px' }}>{point.explanation}</p>
          {point.example_jp && (
            <div className="badge" style={{ display: 'block', width: 'fit-content' }}>
              {point.example_jp}
              <SpeakButton text={point.example_jp} />
              {point.example_reading && <span style={{ color: 'var(--paper-dim)' }}> ({point.example_reading})</span>}
              <br />
              <span style={{ color: 'var(--paper-dim)' }}>{point.example_en}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LessonDetail() {
  const { number } = useParams();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState('');
  const [sentence, setSentence] = useState(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    api.getLesson(number).then(setLesson).catch((e) => setError(e.message));
  }, [number]);

  const generateSentence = async () => {
    setGenLoading(true);
    setGenError('');
    setSentence(null);
    try {
      const res = await api.practiceSentence(Number(number));
      setSentence(res.raw);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenLoading(false);
    }
  };

  const updateGrammarPoint = (updated) => {
    setLesson((prev) => ({
      ...prev,
      grammar_points: prev.grammar_points.map((g) => (g.id === updated.id ? updated : g)),
    }));
  };

  if (error) return <div className="error-banner">{error}</div>;
  if (!lesson) return <p style={{ color: 'var(--paper-dim)' }}>Loading…</p>;

  return (
    <div>
      <h1 className="page-title">Lesson {lesson.number}{lesson.title ? ` — ${lesson.title}` : ''}</h1>
      <p className="page-subtitle">
        <Link to="/lessons" style={{ color: 'var(--indigo)' }}>&larr; All lessons</Link>
        {' · '}
        <Link to={`/lessons/${lesson.number}/edit`} style={{ color: 'var(--indigo)' }}>Edit this lesson</Link>
      </p>

      {lesson.grammar_notes && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Grammar overview</h3>
          <p style={{ whiteSpace: 'pre-wrap', color: 'var(--paper-dim)' }}>{lesson.grammar_notes}</p>
        </div>
      )}

      {lesson.grammar_points.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Grammar points ({lesson.grammar_points.length})</h3>
          {lesson.grammar_points.map((g) => (
            <GrammarPointCard key={g.id} point={g} onExplained={updateGrammarPoint} />
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Practice sentence generator</h3>
          <button className="btn btn-secondary" onClick={generateSentence} disabled={genLoading}>
            {genLoading ? 'Generating…' : 'Generate with AI'}
          </button>
        </div>
        {genError && <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{genError}</div>}
        {sentence && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{sentence}</pre>}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Vocabulary ({lesson.vocabulary.length})</h3>
        {lesson.vocabulary.length === 0 ? <p style={{ color: 'var(--paper-dim)' }}>None added.</p> : (
          <table>
            <thead><tr><th>Kanji</th><th>Reading</th><th>English</th></tr></thead>
            <tbody>
              {lesson.vocabulary.map((v) => (
                <tr key={v.id}>
                  <td>{v.kanji_form || '—'}</td>
                  <td className="mono">{v.reading}<SpeakButton text={v.kanji_form || v.reading} /></td>
                  <td>{v.english}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Kanji ({lesson.kanji.length})</h3>
        {lesson.kanji.length === 0 ? <p style={{ color: 'var(--paper-dim)' }}>None added.</p> : (
          <table>
            <thead><tr><th>Character</th><th>Reading</th><th>Meaning</th></tr></thead>
            <tbody>
              {lesson.kanji.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontSize: '1.2rem' }}>{k.character}<SpeakButton text={k.character} /></td>
                  <td className="mono">{k.reading}</td>
                  <td>{k.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lesson.culture_notes.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Culture notes</h3>
          {lesson.culture_notes.map((c) => (
            <div key={c.id} style={{ marginBottom: 12 }}>
              {c.title && <div style={{ fontWeight: 500, marginBottom: 4 }}>{c.title}</div>}
              <p style={{ color: 'var(--paper-dim)', margin: 0, whiteSpace: 'pre-wrap' }}>{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
