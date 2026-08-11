import { useState } from 'react';
import * as wanakana from 'wanakana';
import SpeakButton from './SpeakButton.jsx';

function normalize(str) {
  return (str || '').trim().toLowerCase();
}

// Conjugation answers can be typed as romaji or kana — accept either and compare against
// the reading, since expecting exact kanji input without an IME isn't realistic.
function normalizeKana(str) {
  const kana = wanakana.toKana(str || '', { IMEMode: false });
  return wanakana.toHiragana(kana).trim().replace(/[\s、。・ー]/g, '');
}

export default function QuizRunner({ questions, kind, lessonNumbers, onFinish }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [typed, setTyped] = useState('');
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);

  const q = questions[idx];
  const isLast = idx + 1 >= questions.length;

  const [revealedOnly, setRevealedOnly] = useState(false);

  const submitAnswer = (isCorrect) => {
    setAnswered(true);
    if (isCorrect) setScore((s) => s + 1);
  };

  const handleChoice = (opt) => {
    if (answered) return;
    setSelected(opt);
    submitAnswer(opt === q.correct_answer);
  };

  const handleTypedSubmit = () => {
    if (answered) return;
    if (q.type === 'conjugate') {
      submitAnswer(normalizeKana(typed) === normalizeKana(q.correct_answer_reading || q.correct_answer));
    } else {
      submitAnswer(normalize(typed) === normalize(q.correct_answer));
    }
  };

  // Free-form translation can't be exactly string-matched, so reveal the reference
  // answer and let the person self-grade — same approach Anki uses for open cards.
  const revealTranslation = () => setRevealedOnly(true);
  const selfGrade = (isCorrect) => submitAnswer(isCorrect);

  const next = () => {
    if (isLast) {
      onFinish(score, questions.length);
      return;
    }
    setIdx(idx + 1);
    setSelected(null);
    setTyped('');
    setAnswered(false);
    setRevealedOnly(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, color: 'var(--paper-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
        <span>{kind === 'test' ? 'Test' : 'Quiz'} · Question {idx + 1} of {questions.length}</span>
        <span>Score: {score}/{idx + (answered ? 1 : 0)}</span>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <span className="badge" style={{ marginBottom: 12, display: 'inline-block' }}>Lesson {q.lesson_number}</span>
        <h3 style={{ marginTop: 0 }}>{q.prompt}{q.speak && <SpeakButton text={q.speak} />}</h3>

        {q.type === 'translate' ? (
          <div style={{ marginTop: 16 }}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !revealedOnly && revealTranslation()}
              placeholder="Type your English translation"
              disabled={revealedOnly}
              autoFocus
            />
            {!revealedOnly && <button className="btn" style={{ marginTop: 12 }} onClick={revealTranslation}>Reveal reference answer</button>}
            {revealedOnly && !answered && (
              <div style={{ marginTop: 12 }}>
                <p style={{ color: 'var(--paper-dim)' }}>Reference translation: <strong style={{ color: 'var(--paper)' }}>{q.correct_answer}</strong></p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="rating-btn pass" onClick={() => selfGrade(true)}>I got it right</button>
                  <button className="rating-btn fail" onClick={() => selfGrade(false)}>I got it wrong</button>
                </div>
              </div>
            )}
            {answered && (
              <p style={{ marginTop: 12, color: 'var(--success)' }}>Reference translation: {q.correct_answer}</p>
            )}
          </div>
        ) : q.type === 'multiple_choice' ? (
          <div style={{ marginTop: 16 }}>
            {q.options.map((opt) => {
              let cls = 'quiz-option';
              if (answered && opt === q.correct_answer) cls += ' correct';
              else if (answered && opt === selected) cls += ' incorrect';
              return (
                <button key={opt} className={cls} onClick={() => handleChoice(opt)} disabled={answered}>
                  {opt}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTypedSubmit()}
              placeholder={q.type === 'conjugate' ? 'type romaji or kana…' : 'Type your answer'}
              disabled={answered}
              autoFocus
            />
            {!answered && <button className="btn" style={{ marginTop: 12 }} onClick={handleTypedSubmit}>Submit</button>}
            {answered && (
              <p style={{
                marginTop: 12,
                color: (q.type === 'conjugate'
                  ? normalizeKana(typed) === normalizeKana(q.correct_answer_reading || q.correct_answer)
                  : normalize(typed) === normalize(q.correct_answer))
                  ? 'var(--success)' : 'var(--hanko)',
              }}>
                Correct answer: {q.correct_answer}
              </p>
            )}
          </div>
        )}
      </div>

      {answered && (
        <button className="btn" onClick={next}>{isLast ? 'Finish' : 'Next question'}</button>
      )}
    </div>
  );
}
