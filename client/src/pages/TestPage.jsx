import { useEffect, useState } from 'react';
import { api, parseAiSentence } from '../api';
import QuizRunner from '../components/QuizRunner.jsx';

// Fetches a couple of AI-generated "translate this sentence" questions and shuffles
// them into the local question set. Skipped silently if AI isn't configured yet.
async function withTranslateQuestions(questions, minLesson, maxLesson) {
  const translateCount = Math.min(3, Math.max(1, Math.round(questions.length * 0.15)));
  const extras = [];
  for (let i = 0; i < translateCount; i++) {
    try {
      const res = await api.translateQuestion(minLesson, maxLesson);
      const { japanese, english } = parseAiSentence(res.raw);
      if (japanese && english) {
        extras.push({
          id: `translate-${i}-${Date.now()}`,
          type: 'translate',
          prompt: `Translate to English: ${japanese}`,
          speak: japanese,
          correct_answer: english,
          lesson_number: maxLesson,
        });
      }
    } catch {
      break; // AI not configured or request failed — just run the test without these
    }
  }
  const combined = [...questions, ...extras];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

export default function TestPage() {
  const [lessons, setLessons] = useState([]);
  const [minLesson, setMinLesson] = useState(1);
  const [maxLesson, setMaxLesson] = useState('');
  const [count, setCount] = useState(20);
  const [questions, setQuestions] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getLessons().then((ls) => {
      setLessons(ls);
      if (ls.length) setMaxLesson(String(ls[ls.length - 1].number));
    });
  }, []);

  const start = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.generateQuiz({ maxLesson: Number(maxLesson), minLesson: Number(minLesson), count, focusLesson: Number(maxLesson) });
      const withTranslations = await withTranslateQuestions(res.questions, Number(minLesson), Number(maxLesson));
      setQuestions(withTranslations);
      setResult(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const finish = async (score, total) => {
    setResult({ score, total });
    setQuestions(null);
    try {
      const nums = [];
      for (let n = Number(minLesson); n <= Number(maxLesson); n++) nums.push(n);
      await api.submitQuiz({ kind: 'test', lesson_numbers: nums, score, total });
    } catch { /* non-blocking */ }
  };

  if (questions) {
    return <QuizRunner questions={questions} kind="test" onFinish={finish} />;
  }

  return (
    <div>
      <h1 className="page-title">Test</h1>
      <p className="page-subtitle">A cumulative test across a range of lessons — good for chapter or midterm review.</p>

      {error && <div className="error-banner">{error}</div>}

      {result && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Last result: {result.score}/{result.total} ({Math.round((result.score / result.total) * 100)}%)</h3>
        </div>
      )}

      {lessons.length === 0 ? (
        <div className="empty-state"><h3>No lessons yet</h3><p>Add lessons with vocabulary before testing.</p></div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>From lesson</label>
              <select value={minLesson} onChange={(e) => setMinLesson(e.target.value)}>
                {lessons.map((l) => <option key={l.number} value={l.number}>{l.number}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Through lesson</label>
              <select value={maxLesson} onChange={(e) => setMaxLesson(e.target.value)}>
                {lessons.map((l) => <option key={l.number} value={l.number}>{l.number}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Number of questions</label>
            <input type="number" min="10" max="60" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <button className="btn btn-hanko" onClick={start} disabled={loading}>{loading ? 'Building test…' : 'Start test'}</button>
        </div>
      )}
    </div>
  );
}
