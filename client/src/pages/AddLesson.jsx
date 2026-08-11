import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

function parseVocab(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 3) return { kanji_form: parts[0] || null, reading: parts[1], english: parts.slice(2).join(', ') };
    if (parts.length === 2) return { kanji_form: null, reading: parts[0], english: parts[1] };
    return null;
  }).filter(Boolean);
}

function parseKanji(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 3) return null;
    return { character: parts[0], reading: parts[1], meaning: parts.slice(2).join(', ') };
  }).filter(Boolean);
}

function parseGrammar(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 2) return null;
    return { pattern: parts[0], meaning_en: parts.slice(1).join(', ') };
  }).filter(Boolean);
}

// Inverse of the parsers above — turns saved rows back into editable pipe-delimited text.
function vocabToText(rows) {
  return (rows || []).map((v) => `${v.kanji_form || ''} | ${v.reading} | ${v.english}`).join('\n');
}
function kanjiToText(rows) {
  return (rows || []).map((k) => `${k.character} | ${k.reading} | ${k.meaning}`).join('\n');
}
function grammarToText(rows) {
  return (rows || []).map((g) => `${g.pattern} | ${g.meaning_en}`).join('\n');
}

export default function AddLesson() {
  const navigate = useNavigate();
  const { number: editingNumber } = useParams(); // present only on /lessons/:number/edit
  const isEditing = Boolean(editingNumber);

  const [number, setNumber] = useState(editingNumber || '');
  const [title, setTitle] = useState('');
  const [grammarNotes, setGrammarNotes] = useState('');
  const [grammarPointsText, setGrammarPointsText] = useState('');
  const [vocabText, setVocabText] = useState('');
  const [kanjiText, setKanjiText] = useState('');
  const [cultureNotes, setCultureNotes] = useState([{ title: '', body: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(isEditing);

  const [pdfFile, setPdfFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractNotice, setExtractNotice] = useState('');

  useEffect(() => {
    if (!isEditing) return;
    api.getLesson(editingNumber)
      .then((lesson) => {
        setTitle(lesson.title || '');
        setGrammarNotes(lesson.grammar_notes || '');
        setGrammarPointsText(grammarToText(lesson.grammar_points));
        setVocabText(vocabToText(lesson.vocabulary));
        setKanjiText(kanjiToText(lesson.kanji));
        setCultureNotes(lesson.culture_notes.length ? lesson.culture_notes.map((c) => ({ title: c.title || '', body: c.body })) : [{ title: '', body: '' }]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingExisting(false));
  }, [isEditing, editingNumber]);

  const updateCulture = (i, field, value) => {
    setCultureNotes((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  };
  const addCultureNote = () => setCultureNotes((prev) => [...prev, { title: '', body: '' }]);
  const removeCultureNote = (i) => setCultureNotes((prev) => prev.filter((_, idx) => idx !== i));

  const handleExtract = async () => {
    if (!pdfFile) return;
    setExtracting(true);
    setExtractError('');
    setExtractNotice('');
    try {
      const extracted = await api.extractLessonFromPdf(pdfFile);
      if (extracted.title && !title) setTitle(extracted.title);
      if (extracted.grammar_notes && !grammarNotes) setGrammarNotes(extracted.grammar_notes);
      if (extracted.grammar_points?.length) {
        setGrammarPointsText((prev) => (prev ? prev + '\n' : '') + grammarToText(extracted.grammar_points));
      }
      if (extracted.vocabulary.length) {
        setVocabText((prev) => (prev ? prev + '\n' : '') + vocabToText(extracted.vocabulary));
      }
      if (extracted.kanji.length) {
        setKanjiText((prev) => (prev ? prev + '\n' : '') + kanjiToText(extracted.kanji));
      }
      if (extracted.culture_notes.length) {
        setCultureNotes((prev) => {
          const cleanedPrev = prev.filter((c) => c.title.trim() || c.body.trim());
          return [...cleanedPrev, ...extracted.culture_notes];
        });
      }
      const total = extracted.vocabulary.length + extracted.kanji.length + (extracted.grammar_points?.length || 0);
      setExtractNotice(
        total > 0
          ? `Pulled in ${extracted.vocabulary.length} vocabulary word(s), ${extracted.kanji.length} kanji, and ${extracted.grammar_points?.length || 0} grammar point(s). Review everything below before saving — AI extraction can misread the occasional character.`
          : 'The PDF was read, but no content was found on it. You can still fill in the fields manually below.'
      );
    } catch (e) {
      setExtractError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!number) { setError('Lesson number is required.'); return; }
    setSaving(true);
    try {
      await api.saveLesson({
        number: Number(number),
        title,
        grammar_notes: grammarNotes,
        vocabulary: parseVocab(vocabText),
        kanji: parseKanji(kanjiText),
        grammar_points: parseGrammar(grammarPointsText),
        culture_notes: cultureNotes.filter((c) => c.body.trim()),
      });
      navigate(`/lessons/${number}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loadingExisting) return <p style={{ color: 'var(--paper-dim)' }}>Loading lesson…</p>;

  return (
    <div>
      <h1 className="page-title">{isEditing ? `Edit Lesson ${editingNumber}` : 'Add a lesson'}</h1>
      <p className="page-subtitle">
        {isEditing
          ? 'Update this lesson\'s content. Saving replaces what was there before.'
          : 'Paste in this lesson\'s content, or generate a first draft from a PDF below. Re-saving the same lesson number replaces its content.'}
      </p>

      {error && <div className="error-banner">{error}</div>}

      {!isEditing && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Generate from a PDF</h3>
          <p style={{ color: 'var(--paper-dim)', fontSize: '0.9rem', marginTop: 0 }}>
            Upload a PDF vocab list or textbook page — AI will read it and fill in the fields below for you to review and edit before saving.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} style={{ maxWidth: 320 }} />
            <button type="button" className="btn btn-secondary" onClick={handleExtract} disabled={!pdfFile || extracting}>
              {extracting ? 'Reading PDF…' : 'Extract with AI'}
            </button>
          </div>
          {extractError && <div className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>{extractError}</div>}
          {extractNotice && <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--success)', fontSize: '0.9rem' }}>{extractNotice}</p>}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="field" style={{ width: 140 }}>
              <label>Lesson number</label>
              <input type="number" min="1" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 12" required disabled={isEditing} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Title (optional)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. て-form requests" />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Grammar overview (optional, freeform)</label>
            <textarea
              className="paste-area"
              value={grammarNotes}
              onChange={(e) => setGrammarNotes(e.target.value)}
              placeholder="Any general notes about this lesson's grammar section — the individual grammar points with flashcards go in their own box below."
            />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <label>Vocabulary — one word per line: kanji | reading | english (leave kanji blank if none)</label>
          <textarea
            className="paste-area"
            value={vocabText}
            onChange={(e) => setVocabText(e.target.value)}
            placeholder={'休みます | やすみます | to rest, to take a day off\n| これ | this one'}
          />
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <label>Kanji — one per line: character | reading(s) | meaning</label>
          <textarea
            className="paste-area"
            value={kanjiText}
            onChange={(e) => setKanjiText(e.target.value)}
            placeholder={'休 | キュウ, やす.む | rest\n体 | タイ | body'}
          />
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <label>Grammar points — one per line: pattern | short meaning. Each becomes its own flashcard, and you can generate a full AI explanation for any of them from the lesson page.</label>
          <textarea
            className="paste-area"
            value={grammarPointsText}
            onChange={(e) => setGrammarPointsText(e.target.value)}
            placeholder={'〜てもいいです | permission, "may I..."\n〜てはいけません | prohibition, "must not..."'}
          />
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ marginBottom: 0 }}>Culture notes</label>
            <button type="button" className="btn btn-secondary" onClick={addCultureNote}>+ Add note</button>
          </div>
          {cultureNotes.map((c, i) => (
            <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < cultureNotes.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div className="field">
                <input value={c.title} onChange={(e) => updateCulture(i, 'title', e.target.value)} placeholder="Note title (optional)" />
              </div>
              <div className="field" style={{ marginBottom: cultureNotes.length > 1 ? 8 : 0 }}>
                <textarea className="paste-area" style={{ minHeight: 90 }} value={c.body} onChange={(e) => updateCulture(i, 'body', e.target.value)} placeholder="Paste the culture blurb here" />
              </div>
              {cultureNotes.length > 1 && (
                <button type="button" className="btn btn-secondary" onClick={() => removeCultureNote(i)}>Remove</button>
              )}
            </div>
          ))}
        </div>

        <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save lesson'}</button>
      </form>
    </div>
  );
}
