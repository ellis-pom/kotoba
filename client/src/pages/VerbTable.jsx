import { useEffect, useMemo, useState } from 'react';
import * as wanakana from 'wanakana';
import { api } from '../api';
import SpeakButton from '../components/SpeakButton.jsx';

const VERB_FORM_LABELS = {
  masu: 'ます', te: 'て', ta: 'た', nai: 'ない',
  potential: 'potential', volitional: 'volitional', ba: 'ば', tara: 'たら',
};
const VERB_FORM_KEYS = Object.keys(VERB_FORM_LABELS);

const ADJ_NOUN_FORM_LABELS = {
  plain: 'plain (だ)', negative: 'negative', past: 'past (た)', tara: 'たら (if)',
  negativeTara: 'neg. たら', te: 'て/で', temo: 'ても (even if)', negativeTemo: 'neg. ても',
};
const ADJ_NOUN_FORM_KEYS = Object.keys(ADJ_NOUN_FORM_LABELS);

const POS_LABELS = { i_adjective: 'い-adj', na_adjective: 'な-adj', noun: 'noun' };

function normalize(str) {
  const kana = wanakana.toKana(str || '', { IMEMode: false });
  return wanakana.toHiragana(kana).trim().replace(/[\s、。・ー]/g, '');
}

// One conjugation drill table, reused for both the verb table and the adjective/noun table —
// they share the same blank/reveal/check/shuffle mechanics, just with different columns.
function ConjugationTable({ items, formKeys, formLabels, revealPct, labelColumns }) {
  const [blankMap, setBlankMap] = useState({});
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState(false);

  const shuffle = () => {
    const map = {};
    for (const item of items) {
      for (const key of formKeys) {
        map[`${item.vocab_id}:${key}`] = Math.random() * 100 >= revealPct;
      }
    }
    setBlankMap(map);
    setAnswers({});
    setChecked(false);
  };

  useEffect(() => { if (items.length) shuffle(); /* eslint-disable-next-line */ }, [items, revealPct]);

  const setAnswer = (key, value) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const results = useMemo(() => {
    if (!checked) return {};
    const out = {};
    for (const item of items) {
      for (const key of formKeys) {
        const cellKey = `${item.vocab_id}:${key}`;
        if (!blankMap[cellKey]) continue;
        const correct = item.forms_reading[key];
        if (correct == null) continue;
        out[cellKey] = normalize(answers[cellKey]) === normalize(correct);
      }
    }
    return out;
  }, [checked, items, blankMap, answers]); // eslint-disable-line

  const blankedCount = Object.values(blankMap).filter(Boolean).length;
  const correctCount = Object.values(results).filter(Boolean).length;

  if (items.length === 0) return null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={shuffle}>🔀 Shuffle blanks</button>
        {blankedCount > 0 && <button className="btn" onClick={() => setChecked(true)}>Check answers</button>}
        {checked && blankedCount > 0 && <span>Score: <strong>{correctCount}/{blankedCount}</strong></span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {labelColumns.map((c) => <th key={c}>{c}</th>)}
              {formKeys.map((k) => <th key={k}>{formLabels[k]}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.vocab_id}>
                <td>{item.dictionary_form}<SpeakButton text={item.dictionary_form} /></td>
                {labelColumns.length > 1 && <td style={{ color: 'var(--paper-dim)' }}>{item.english}</td>}
                {formKeys.map((key) => {
                  const cellKey = `${item.vocab_id}:${key}`;
                  const isBlank = blankMap[cellKey];
                  const correctForm = item.forms[key];
                  if (correctForm == null) return <td key={key} style={{ color: 'var(--paper-dim)' }}>—</td>;
                  if (!isBlank) return <td key={key}>{correctForm}<SpeakButton text={correctForm} /></td>;
                  return (
                    <td key={key}>
                      <input
                        value={answers[cellKey] || ''}
                        onChange={(e) => setAnswer(cellKey, e.target.value)}
                        disabled={checked}
                        placeholder="type it"
                        style={{
                          width: 90, fontSize: '0.85rem', padding: '4px 6px',
                          borderColor: checked ? (results[cellKey] ? 'var(--success)' : 'var(--hanko)') : undefined,
                        }}
                      />
                      {checked && !results[cellKey] && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--hanko)', marginTop: 2 }}>{correctForm}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function VerbTable() {
  const [lessons, setLessons] = useState([]);
  const [minLesson, setMinLesson] = useState('');
  const [maxLesson, setMaxLesson] = useState('');
  const [includeIrregular, setIncludeIrregular] = useState(true);
  const [verbs, setVerbs] = useState([]);
  const [adjNouns, setAdjNouns] = useState([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('verbs'); // 'verbs' | 'adjNouns'

  const [classifying, setClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState('');
  const [classifyNotice, setClassifyNotice] = useState('');

  const [revealPct, setRevealPct] = useState(50);

  useEffect(() => {
    api.getLessons().then((ls) => {
      setLessons(ls);
      if (ls.length) {
        const latest = Math.max(...ls.map((l) => l.number));
        setMinLesson(String(latest));
        setMaxLesson(String(latest));
      }
    });
  }, []);

  const loadTable = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getVerbTable({
        minLesson: minLesson || 1,
        maxLesson: maxLesson || 9999,
        includeIrregular: String(includeIrregular),
      });
      setVerbs(res.verbs);
      setAdjNouns(res.adjNouns);
      setPending(res.pending);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (minLesson && maxLesson) loadTable();
    // eslint-disable-next-line
  }, [minLesson, maxLesson, includeIrregular]);

  const handleClassify = async () => {
    setClassifying(true);
    setClassifyError('');
    setClassifyNotice('');
    try {
      const res = await api.classifyVerbs();
      setClassifyNotice(
        res.classified === 0
          ? 'All your vocabulary has already been checked.'
          : `Checked ${res.classified} word(s) — ${res.verbsFound} verb(s), ${res.adjNounFound} adjective/noun(s). ${res.remaining} word(s) still to check.`
      );
      await loadTable();
    } catch (e) {
      setClassifyError(e.message);
    } finally {
      setClassifying(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Conjugation Practice</h1>
      <p className="page-subtitle">Drill tables built from your own vocabulary — verb forms, plus い/な-adjective and noun conditional forms (たら / ても).</p>

      {pending > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <strong>{pending} word(s)</strong> haven't been checked for part of speech yet.
              <div style={{ color: 'var(--paper-dim)', fontSize: '0.85rem' }}>Runs in batches of 40 — click again if there are more than that.</div>
            </div>
            <button className="btn" onClick={handleClassify} disabled={classifying}>
              {classifying ? 'Checking…' : 'Classify my vocabulary'}
            </button>
          </div>
          {classifyError && <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{classifyError}</div>}
          {classifyNotice && <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--success)', fontSize: '0.9rem' }}>{classifyNotice}</p>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 130, marginBottom: 0 }}>
            <label>From lesson</label>
            <input type="number" min="1" value={minLesson} onChange={(e) => setMinLesson(e.target.value)} />
          </div>
          <div className="field" style={{ width: 130, marginBottom: 0 }}>
            <label>To lesson</label>
            <input type="number" min="1" value={maxLesson} onChange={(e) => setMaxLesson(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <input type="checkbox" checked={includeIrregular} onChange={(e) => setIncludeIrregular(e.target.checked)} />
            Always include irregular verbs (する, 来る)
          </label>
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>How much of the table is filled in already</span>
            <span className="mono">{revealPct}%</span>
          </label>
          <input type="range" min="0" max="100" value={revealPct} onChange={(e) => setRevealPct(Number(e.target.value))} style={{ width: '100%' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--paper-dim)' }}>
            <span>0% — pure quiz</span>
            <span>100% — reference table</span>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p style={{ color: 'var(--paper-dim)' }}>Loading…</p>}

      {!loading && verbs.length === 0 && adjNouns.length === 0 && (
        <div className="empty-state">
          <h3>Nothing to show in this range</h3>
          <p>{pending > 0 ? 'Classify your vocabulary above first.' : 'Try widening the lesson range, or add more vocabulary.'}</p>
        </div>
      )}

      {(verbs.length > 0 || adjNouns.length > 0) && (
        <>
          <div className="tag-list" style={{ marginBottom: 16 }}>
            <button className={'tag-btn' + (tab === 'verbs' ? ' active' : '')} onClick={() => setTab('verbs')} disabled={verbs.length === 0}>
              Verbs ({verbs.length})
            </button>
            <button className={'tag-btn' + (tab === 'adjNouns' ? ' active' : '')} onClick={() => setTab('adjNouns')} disabled={adjNouns.length === 0}>
              Adjectives &amp; Nouns ({adjNouns.length})
            </button>
          </div>

          <div className="card">
            {tab === 'verbs' && (
              <ConjugationTable items={verbs} formKeys={VERB_FORM_KEYS} formLabels={VERB_FORM_LABELS} revealPct={revealPct} labelColumns={['Dictionary', 'Meaning']} />
            )}
            {tab === 'adjNouns' && (
              <>
                <p style={{ color: 'var(--paper-dim)', fontSize: '0.85rem', marginTop: 0 }}>
                  な-adjectives and nouns share the same です/だ-based conditional pattern, so they're combined here.
                </p>
                <ConjugationTable items={adjNouns} formKeys={ADJ_NOUN_FORM_KEYS} formLabels={ADJ_NOUN_FORM_LABELS} revealPct={revealPct} labelColumns={['Dictionary', 'Meaning']} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
