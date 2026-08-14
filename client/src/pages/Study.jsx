import { useEffect, useState, useMemo } from 'react';
import * as wanakana from 'wanakana';
import { api } from '../api';
import SpeakButton from '../components/SpeakButton.jsx';

const MODES = [
  { key: 'jp_to_en', label: 'Japanese → English' },
  { key: 'en_to_jp', label: 'English → Japanese' },
  { key: 'en_to_jp_writing', label: 'English → Japanese (type it)' },
];

// Normalizes how each card type exposes its Japanese text / English meaning / reading,
// so the rest of the component doesn't need to branch on card_type everywhere.
// When showKanji is false, "japanese" falls back to the pure reading (kana) — useful for
// practicing reading recognition without leaning on kanji as a crutch.
function getFields(card, showKanji) {
  const c = card?.content;
  if (!c) return { japanese: '', english: '', reading: '' };
  if (card.card_type === 'vocabulary') {
    return { japanese: showKanji ? (c.kanji_form || c.reading) : c.reading, english: c.english, reading: c.reading };
  }
  if (card.card_type === 'kanji') {
    return { japanese: showKanji ? c.character : c.reading, english: c.meaning, reading: c.reading };
  }
  return { japanese: c.pattern, english: c.meaning_en, reading: c.pattern }; // grammar — no kanji/kana distinction to toggle
}

// Accepts romaji or kana input, converts to hiragana, and compares against the stored reading.
function normalize(str) {
  const kana = wanakana.toKana(str || '', { IMEMode: false });
  return wanakana.toHiragana(kana).trim().replace(/[\s、。・ー]/g, '');
}

export default function Study() {
  const [maxLesson, setMaxLesson] = useState('');
  const [activeModes, setActiveModes] = useState(MODES.map((m) => m.key));
  const [showKanji, setShowKanji] = useState(true);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionDone, setSessionDone] = useState(0);

  const loadQueue = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 30, modes: activeModes.join(',') };
      if (maxLesson) params.maxLesson = maxLesson;
      const cards = await api.getDueCards(params);
      setQueue(cards);
      setIdx(0);
      setRevealed(false);
      setChecked(false);
      setTypedAnswer('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadQueue(); /* eslint-disable-next-line */ }, []);

  const toggleMode = (key) => {
    setActiveModes((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  };

  const card = queue[idx];
  const fields = useMemo(() => getFields(card, showKanji), [card, showKanji]);
  const front = useMemo(() => {
    if (!card) return '';
    return card.mode === 'jp_to_en' ? fields.japanese : fields.english;
  }, [card, fields]);
  const back = useMemo(() => {
    if (!card) return '';
    if (card.mode === 'jp_to_en') return fields.english;
    return fields.reading && fields.reading !== fields.japanese ? `${fields.japanese} (${fields.reading})` : fields.japanese;
  }, [card, fields]);
  const frontIsJapanese = card?.mode === 'jp_to_en';
  const correctTyped = fields.reading;

  const advance = () => {
    if (idx + 1 >= queue.length) {
      setQueue([]);
    } else {
      setIdx(idx + 1);
    }
    setRevealed(false);
    setChecked(false);
    setTypedAnswer('');
    setSessionDone((n) => n + 1);
  };

  const rate = async (quality) => {
    await api.answerCard(card.id, quality);
    advance();
  };

  const checkWriting = () => {
    setChecked(true);
    setRevealed(true);
  };

  if (loading) return <p style={{ color: 'var(--paper-dim)' }}>Loading your review queue…</p>;

  return (
    <div>
      <h1 className="page-title">Study</h1>
      <p className="page-subtitle">Cards resurface based on how well you know them — reviewed {sessionDone} this session.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ width: 160, marginBottom: 0 }}>
            <label>Up to lesson</label>
            <input type="number" min="1" value={maxLesson} onChange={(e) => setMaxLesson(e.target.value)} placeholder="All lessons" />
          </div>
          <button className="btn btn-secondary" onClick={loadQueue}>Apply</button>
        </div>
        <div className="tag-list" style={{ marginTop: 16, marginBottom: 0 }}>
          {MODES.map((m) => (
            <button key={m.key} className={'tag-btn' + (activeModes.includes(m.key) ? ' active' : '')} onClick={() => { toggleMode(m.key); }}>
              {m.label}
            </button>
          ))}
          <button
            className={'tag-btn' + (showKanji ? ' active' : '')}
            onClick={() => setShowKanji((v) => !v)}
            title="When off, kanji is replaced with its reading — practice recognizing words by sound/kana alone"
          >
            {showKanji ? '漢字 On' : '漢字 Off'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!card ? (
        <div className="empty-state">
          <h3>All caught up</h3>
          <p>No cards due right now for the selected modes. Nice work — check back later, or add more lessons.</p>
        </div>
      ) : (
        <div className="flashcard-stage">
          <span className="badge">Lesson {card.lesson.number} · {MODES.find((m) => m.key === card.mode)?.label}</span>

          {card.mode === 'en_to_jp_writing' ? (
            <div className="flashcard" style={{ cursor: 'default' }}>
              <div className="hanko-stamp" style={{ opacity: checked ? 0.9 : 0 }}>済</div>
              <div className="flashcard-front" style={{ fontSize: '2.2rem' }}>{front}</div>
              {!checked ? (
                <div style={{ width: '100%', zIndex: 1 }}>
                  <input
                    autoFocus
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    placeholder="Type the reading in kana"
                    onKeyDown={(e) => e.key === 'Enter' && checkWriting()}
                  />
                </div>
              ) : (
                <div style={{ zIndex: 1, textAlign: 'center' }}>
                  <div className="flashcard-back">{back}<SpeakButton text={fields.japanese} /></div>
                  <div className="flashcard-hint" style={{ marginTop: 8 }}>
                    You typed: <span className="mono">{typedAnswer || '(blank)'}</span> —{' '}
                    {normalize(typedAnswer) === normalize(correctTyped) ? 'correct ✓' : 'not quite'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={'flashcard' + (revealed ? ' revealed' : '')} onClick={() => setRevealed(true)}>
              <div className="hanko-stamp">見</div>
              <div className="flashcard-front">{front}{frontIsJapanese && <SpeakButton text={fields.japanese} />}</div>
              {revealed ? (
                <div className="flashcard-back">{back}{!frontIsJapanese && <SpeakButton text={fields.japanese} />}</div>
              ) : (
                <div className="flashcard-hint">Tap to reveal</div>
              )}
            </div>
          )}

          {(revealed || checked) && (
            <div className="rating-row">
              <button className="rating-btn fail" onClick={() => rate(1)}>Again</button>
              <button className="rating-btn" onClick={() => rate(3)}>Hard</button>
              <button className="rating-btn pass" onClick={() => rate(4)}>Good</button>
              <button className="rating-btn pass" onClick={() => rate(5)}>Easy</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
