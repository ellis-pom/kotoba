// Parses a simple plain-text lesson format so lessons can be authored as a single text file
// (e.g. a GitHub Gist) instead of typed into the web form. Mirrors the exact same
// pipe-delimited row format already used in the Add Lesson paste boxes.
//
// Format:
//   LESSON: 26
//   TITLE: Optional title
//   GRAMMAR_NOTES: Optional freeform overview line
//
//   VOCAB:
//   kanji | reading | english
//   | reading only | english   (blank kanji field for kana-only words)
//
//   KANJI:
//   character | reading | meaning
//
//   GRAMMAR:
//   pattern | meaning
//
//   CULTURE:
//   title | body
//
// Section order doesn't matter, all sections are optional except LESSON, blank lines are
// ignored, and section headers are case-insensitive.

const SECTION_HEADERS = new Set(['VOCAB', 'KANJI', 'GRAMMAR', 'CULTURE']);

function parseLessonText(text) {
  const lines = (text || '').split('\n').map((l) => l.trim());

  let number = null, title = '', grammarNotes = '';
  const vocabulary = [], kanji = [], grammarPoints = [], cultureNotes = [];
  let section = null;

  for (const line of lines) {
    if (!line) continue;

    const headerMatch = line.match(/^([A-Z_]+):\s*(.*)$/i);
    if (headerMatch) {
      const key = headerMatch[1].toUpperCase();
      const value = headerMatch[2].trim();

      if (key === 'LESSON') { number = Number(value) || null; section = null; continue; }
      if (key === 'TITLE') { title = value; section = null; continue; }
      if (key === 'GRAMMAR_NOTES') { grammarNotes = value; section = null; continue; }
      if (SECTION_HEADERS.has(key)) { section = key; continue; }
      // Not a recognized header — fall through and treat as a data row if we're in a section
    }

    if (!section) continue;
    const parts = line.split('|').map((p) => p.trim());

    if (section === 'VOCAB') {
      if (parts.length >= 3) vocabulary.push({ kanji_form: parts[0] || null, reading: parts[1], english: parts.slice(2).join(', ') });
      else if (parts.length === 2) vocabulary.push({ kanji_form: null, reading: parts[0], english: parts[1] });
    } else if (section === 'KANJI') {
      if (parts.length >= 3) kanji.push({ character: parts[0], reading: parts[1], meaning: parts.slice(2).join(', ') });
    } else if (section === 'GRAMMAR') {
      if (parts.length >= 2) grammarPoints.push({ pattern: parts[0], meaning_en: parts.slice(1).join(', ') });
    } else if (section === 'CULTURE') {
      if (parts.length >= 2) cultureNotes.push({ title: parts[0] || null, body: parts.slice(1).join(', ') });
    }
  }

  if (!number) {
    const err = new Error('No "LESSON: <number>" line found — every import needs a lesson number.');
    err.status = 400;
    throw err;
  }

  return { number, title, grammar_notes: grammarNotes, vocabulary, kanji, grammar_points: grammarPoints, culture_notes: cultureNotes };
}

module.exports = { parseLessonText };
