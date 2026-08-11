import { useEffect, useState } from 'react';
import { api } from '../api';
import QuizRunner from '../components/QuizRunner.jsx';

export default function Quiz() {
  const [lessons, setLessons] = useState([]);
  const [focusLesson, setFocusLesson] = useState('');
  const [count, setCount] = useState(10);
  const [questions, setQuestions] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getLessons().then((ls) => {
      setLessons(ls);
      if (ls.length) setFocusLesson(String(ls[ls.length - 1].number));
    });
  }, []);

  const start = async () => {
    setError('');
    setLoading(true);
    try {
      const maxLesson = Number(focusLesson);
      const res = await api.generateQuiz({ maxLesson, minLesson: 1, count, focusLesson: maxLesson });
      setQuestions(res.questions);
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
      await api.submitQuiz({ kind: 'quiz', lesson_numbers: [Number(focusLesson)], score, total });
    } catch { /* non-blocking */ }
  };

  if (questions) {
    return <QuizRunner questions={questions} kind="quiz" onFinish={finish} />;
  }

  return (
    <div>
      <h1 className="page-title">Quiz</h1>
      <p className="page-subtitle">A quick check on one lesson, with a few older words mixed in.</p>

      {error && <div className="error-banner">{error}</div>}

      {result && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Last result: {result.score}/{result.total}</h3>
        </div>
      )}

      {lessons.length === 0 ? (
        <div className="empty-state"><h3>No lessons yet</h3><p>Add a lesson with vocabulary before quizzing.</p></div>
      ) : (
        <div className="card">
          <div className="field">
            <label>Focus lesson</label>
            <select value={focusLesson} onChange={(e) => setFocusLesson(e.target.value)}>
              {lessons.map((l) => <option key={l.number} value={l.number}>Lesson {l.number}{l.title ? ` — ${l.title}` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Number of questions</label>
            <input type="number" min="5" max="30" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <button className="btn" onClick={start} disabled={loading}>{loading ? 'Building quiz…' : 'Start quiz'}</button>
        </div>
      )}
    </div>
  );
}
