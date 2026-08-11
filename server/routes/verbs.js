const express = require('express');
const router = express.Router();
const db = require('../db');
const { conjugate, conjugateAdjNoun } = require('../conjugate');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI features are not configured yet. Add GEMINI_API_KEY to your .env to enable them.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gemini API error (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

const BATCH_SIZE = 40;

// Runs one batch classification pass over whatever vocabulary hasn't been checked yet.
// Shared by the manual POST /classify route and the automatic post-save hook in lessons.js.
// Throws NO_API_KEY if no Gemini key is configured — callers decide how to handle that
// (the manual route surfaces it to the person; the automatic hook just skips silently).
async function classifyUnclassified(userId) {
  const unclassified = await db.prepare(`
    SELECT v.* FROM vocabulary v
    JOIN lessons l ON l.id = v.lesson_id
    LEFT JOIN verb_conjugations vc ON vc.vocab_id = v.id
    WHERE l.user_id = ? AND (vc.id IS NULL OR vc.part_of_speech IS NULL)
    LIMIT ?
  `).all(userId, BATCH_SIZE);

  if (unclassified.length === 0) {
    return { classified: 0, verbsFound: 0, adjNounFound: 0, remaining: 0 };
  }

  const wordList = unclassified.map(v => `${v.id}: ${v.kanji_form || v.reading} (${v.reading}) - ${v.english}`).join('\n');
  const prompt = `You are classifying Japanese vocabulary words for a study app that builds conditional-form (たら/ても) conjugation tables. For EACH word below, determine its part of speech and dictionary form.

Words (format is "id: word (reading) - english meaning"):
${wordList}

Respond with ONLY raw JSON (no markdown fences, no commentary): an array with one object per word, in this exact shape:
[{"id": <number>, "part_of_speech": "verb"|"i_adjective"|"na_adjective"|"noun"|"other", "dictionary_form": "string or null", "dictionary_reading": "string or null", "group": "ichidan"|"godan"|"irregular"|null}]

Rules:
- "verb": dictionary_form is the plain dictionary form (convert from ます-form if needed, e.g. 休みます -> 休む). group is required: "ichidan" = ru-verbs where you just drop る (食べる, 見る); "godan" = u-verbs (飲む, 書く, 帰る, 買う); "irregular" = する, verbs ending in する, and 来る only.
- "i_adjective": word ends in い in its dictionary form (e.g. たかい, さむい, いい). dictionary_form is that い-ending form. group is null.
- "na_adjective": word takes な before a noun and だ/です as copula (e.g. ひま, きれい, べんり, すき). dictionary_form is the BARE STEM with no trailing な, だ, or です. group is null.
- "noun": dictionary_form is the noun itself, no trailing copula. group is null.
- "other": particles, adverbs, conjunctions, expressions that don't fit the above — dictionary_form and group are null.
- dictionary_reading is always the pure kana reading of dictionary_form (null only for "other").
- Include every id from the list exactly once.`;

  const raw = await callGemini(prompt);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  let results;
  try {
    results = JSON.parse(cleaned);
  } catch {
    const err = new Error('The AI response could not be read as structured data.');
    err.code = 'BAD_RESPONSE';
    throw err;
  }

  const insert = db.prepare(`
    INSERT INTO verb_conjugations (vocab_id, is_verb, part_of_speech, dictionary_form, dictionary_reading, verb_group, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vocab_id) DO UPDATE SET is_verb=excluded.is_verb, part_of_speech=excluded.part_of_speech,
      dictionary_form=excluded.dictionary_form, dictionary_reading=excluded.dictionary_reading, verb_group=excluded.verb_group
  `);

  let verbsFound = 0, adjNounFound = 0;
  const validPos = new Set(['verb', 'i_adjective', 'na_adjective', 'noun', 'other']);
  for (const r of results) {
    if (!unclassified.find(v => v.id === r.id)) continue; // ignore hallucinated ids
    const pos = validPos.has(r.part_of_speech) ? r.part_of_speech : 'other';
    if (pos === 'verb') verbsFound++;
    else if (pos === 'i_adjective' || pos === 'na_adjective' || pos === 'noun') adjNounFound++;
    await insert.run(pos === 'verb' ? 1 : 0, pos === 'verb' ? 1 : 0, pos, r.dictionary_form || null, r.dictionary_reading || null, r.group || null, userId);
  }

  const remainingRow = await db.prepare(`
    SELECT COUNT(*) AS n FROM vocabulary v
    JOIN lessons l ON l.id = v.lesson_id
    LEFT JOIN verb_conjugations vc ON vc.vocab_id = v.id
    WHERE l.user_id = ? AND (vc.id IS NULL OR vc.part_of_speech IS NULL)
  `).get(userId);

  return { classified: results.length, verbsFound, adjNounFound, remaining: remainingRow.n };
}

// POST /api/verbs/classify
// Finds this user's vocabulary words that haven't been checked yet, asks AI once for each
// word's part of speech (verb/i-adjective/na-adjective/noun/other) plus dictionary form, and
// caches the verdict permanently — the actual conjugated forms are computed by conjugate.js, not AI.
router.post('/classify', async (req, res) => {
  try {
    const result = await classifyUnclassified(req.userId);
    res.json(result);
  } catch (err) {
    if (err.code === 'NO_API_KEY') return res.status(503).json({ error: err.message });
    if (err.code === 'BAD_RESPONSE') return res.status(502).json({ error: err.message + ' Try again.' });
    console.error(err);
    res.status(500).json({ error: 'Failed to classify vocabulary.' });
  }
});

// GET /api/verbs/table?minLesson=1&maxLesson=27&includeIrregular=true
// Returns both the verb table and the adjective/noun conditional table for this user's lessons in range.
router.get('/table', async (req, res) => {
  const maxLesson = Number(req.query.maxLesson || 9999);
  const minLesson = Number(req.query.minLesson || 1);
  const includeIrregular = req.query.includeIrregular !== 'false';

  let sql = `
    SELECT v.id AS vocab_id, v.kanji_form, v.reading, v.english, l.number AS lesson_number,
      vc.part_of_speech, vc.dictionary_form, vc.dictionary_reading, vc.verb_group
    FROM verb_conjugations vc
    JOIN vocabulary v ON v.id = vc.vocab_id
    JOIN lessons l ON l.id = v.lesson_id
    WHERE l.user_id = ? AND (l.number BETWEEN ? AND ?
  `;
  const params = [req.userId, minLesson, maxLesson];
  if (includeIrregular) sql += " OR vc.verb_group = 'irregular'";
  sql += ') AND vc.part_of_speech IS NOT NULL';

  const rows = await db.prepare(sql).all(...params);

  const verbs = rows.filter(r => r.part_of_speech === 'verb').map(r => ({
    vocab_id: r.vocab_id, kanji_form: r.kanji_form, reading: r.reading, english: r.english,
    lesson_number: r.lesson_number, dictionary_form: r.dictionary_form,
    dictionary_reading: r.dictionary_reading, verb_group: r.verb_group,
    forms: conjugate(r.dictionary_form, r.dictionary_reading, r.verb_group),
    forms_reading: conjugate(r.dictionary_reading, r.dictionary_reading, r.verb_group),
  })).filter(v => v.forms);

  const adjNouns = rows.filter(r => ['i_adjective', 'na_adjective', 'noun'].includes(r.part_of_speech)).map(r => ({
    vocab_id: r.vocab_id, kanji_form: r.kanji_form, reading: r.reading, english: r.english,
    lesson_number: r.lesson_number, dictionary_form: r.dictionary_form,
    dictionary_reading: r.dictionary_reading, part_of_speech: r.part_of_speech,
    forms: conjugateAdjNoun(r.dictionary_form, r.part_of_speech),
    forms_reading: conjugateAdjNoun(r.dictionary_reading, r.part_of_speech),
  })).filter(v => v.forms);

  const pendingRow = await db.prepare(`
    SELECT COUNT(*) AS n FROM vocabulary v
    JOIN lessons l ON l.id = v.lesson_id
    LEFT JOIN verb_conjugations vc ON vc.vocab_id = v.id
    WHERE l.user_id = ? AND (vc.id IS NULL OR vc.part_of_speech IS NULL)
  `).get(req.userId);

  res.json({ verbs, adjNouns, pending: pendingRow.n });
});

module.exports = router;
module.exports.classifyUnclassified = classifyUnclassified;
