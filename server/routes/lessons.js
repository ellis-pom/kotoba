const express = require('express');
const router = express.Router();
const db = require('../db');
const { classifyUnclassified } = require('./verbs');
const { parseLessonText } = require('../parseLessonText');

// Only these hosts serve raw plain-text content the way this feature expects — restricting to
// them avoids letting an authenticated request fetch arbitrary/internal URLs from the server.
const ALLOWED_IMPORT_HOSTS = new Set([
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
]);
const MAX_IMPORT_TEXT_LENGTH = 200_000; // characters — generous for a lesson, guards against pathological responses

const REVIEW_MODES = ['jp_to_en', 'en_to_jp', 'en_to_jp_writing'];
const GRAMMAR_MODES = ['jp_to_en', 'en_to_jp']; // no typing mode — typing a full grammar pattern isn't a meaningful drill

async function seedReviewCards(tx, cardType, cardId, lessonId, userId, modes = REVIEW_MODES) {
  const insert = tx.prepare(`
    INSERT OR IGNORE INTO review_cards (card_type, card_id, mode, lesson_id, user_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const mode of modes) await insert.run(cardType, cardId, mode, lessonId, userId);
}

// Shared by the POST / route below and the text/URL import routes — creates or replaces a
// lesson exactly the same way regardless of where the data came from.
async function saveLessonForUser(userId, { number, title, grammar_notes, vocabulary = [], kanji = [], culture_notes = [], grammar_points = [] }) {
  if (!number) { const e = new Error('Lesson number is required'); e.status = 400; throw e; }

  const existing = await db.prepare('SELECT id FROM lessons WHERE number = ? AND user_id = ?').get(number, userId);

  let lessonId;
  const tx = await db.beginTransaction();
  try {
    if (existing) {
      lessonId = existing.id;
      await tx.prepare('UPDATE lessons SET title = ?, grammar_notes = ? WHERE id = ?')
        .run(title || null, grammar_notes || null, lessonId);
      await tx.prepare('DELETE FROM vocabulary WHERE lesson_id = ?').run(lessonId);
      await tx.prepare('DELETE FROM kanji WHERE lesson_id = ?').run(lessonId);
      await tx.prepare('DELETE FROM culture_notes WHERE lesson_id = ?').run(lessonId);
      await tx.prepare('DELETE FROM grammar_points WHERE lesson_id = ?').run(lessonId);
      await tx.prepare("DELETE FROM review_cards WHERE lesson_id = ? AND card_type IN ('vocabulary','kanji','grammar')").run(lessonId);
    } else {
      const info = await tx.prepare('INSERT INTO lessons (number, user_id, title, grammar_notes) VALUES (?, ?, ?, ?)')
        .run(number, userId, title || null, grammar_notes || null);
      lessonId = info.lastInsertRowid;
    }

    const insertVocab = tx.prepare('INSERT INTO vocabulary (lesson_id, kanji_form, reading, english) VALUES (?, ?, ?, ?)');
    for (const v of vocabulary) {
      if (!v.reading || !v.english) continue;
      const info = await insertVocab.run(lessonId, v.kanji_form || null, v.reading, v.english);
      await seedReviewCards(tx, 'vocabulary', info.lastInsertRowid, lessonId, userId);
    }

    const insertKanji = tx.prepare('INSERT INTO kanji (lesson_id, character, reading, meaning) VALUES (?, ?, ?, ?)');
    for (const k of kanji) {
      if (!k.character || !k.reading || !k.meaning) continue;
      const info = await insertKanji.run(lessonId, k.character, k.reading, k.meaning);
      await seedReviewCards(tx, 'kanji', info.lastInsertRowid, lessonId, userId);
    }

    const insertGrammar = tx.prepare('INSERT INTO grammar_points (lesson_id, pattern, meaning_en) VALUES (?, ?, ?)');
    for (const g of grammar_points) {
      if (!g.pattern || !g.meaning_en) continue;
      const info = await insertGrammar.run(lessonId, g.pattern, g.meaning_en);
      await seedReviewCards(tx, 'grammar', info.lastInsertRowid, lessonId, userId, GRAMMAR_MODES);
    }

    const insertCulture = tx.prepare('INSERT INTO culture_notes (lesson_id, title, body) VALUES (?, ?, ?)');
    for (const c of culture_notes) {
      if (!c.body) continue;
      await insertCulture.run(lessonId, c.title || null, c.body);
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  const lesson = await db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);

  // Auto-classify newly-added vocabulary in the background. Never blocks the caller, and
  // silently does nothing if no Gemini key is configured.
  if (vocabulary.length > 0) {
    classifyUnclassified(userId).catch((err) => {
      if (err.code !== 'NO_API_KEY') console.error('Background auto-classify failed:', err.message);
    });
  }

  return lesson;
}

// GET /api/lessons - list this user's lessons with content counts
router.get('/', async (req, res) => {
  const lessons = await db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM vocabulary WHERE lesson_id = l.id) AS vocab_count,
      (SELECT COUNT(*) FROM kanji WHERE lesson_id = l.id) AS kanji_count,
      (SELECT COUNT(*) FROM culture_notes WHERE lesson_id = l.id) AS culture_count,
      (SELECT COUNT(*) FROM grammar_points WHERE lesson_id = l.id) AS grammar_count
    FROM lessons l WHERE l.user_id = ? ORDER BY l.number ASC
  `).all(req.userId);
  res.json(lessons);
});

// GET /api/lessons/:number - full detail for one of this user's lessons
router.get('/:number', async (req, res) => {
  const lesson = await db.prepare('SELECT * FROM lessons WHERE number = ? AND user_id = ?').get(req.params.number, req.userId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

  lesson.vocabulary = await db.prepare('SELECT * FROM vocabulary WHERE lesson_id = ?').all(lesson.id);
  lesson.kanji = await db.prepare('SELECT * FROM kanji WHERE lesson_id = ?').all(lesson.id);
  lesson.culture_notes = await db.prepare('SELECT * FROM culture_notes WHERE lesson_id = ?').all(lesson.id);
  lesson.grammar_points = await db.prepare('SELECT * FROM grammar_points WHERE lesson_id = ?').all(lesson.id);
  res.json(lesson);
});

// POST /api/lessons - create or replace one of this user's lessons with pasted-in content
// body: { number, title, grammar_notes, vocabulary: [{kanji_form, reading, english}],
//         kanji: [{character, reading, meaning}], culture_notes: [{title, body}],
//         grammar_points: [{pattern, meaning_en}] }
router.post('/', async (req, res) => {
  try {
    const lesson = await saveLessonForUser(req.userId, req.body);
    res.status(201).json(lesson);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to save the lesson — nothing was changed.' });
  }
});

// POST /api/lessons/import-text  body: { text }
// Parses the plain-text lesson format (see parseLessonText.js) and saves it — same effect
// as pasting into the Add Lesson form, but from one combined block of text.
router.post('/import-text', async (req, res) => {
  try {
    const parsed = parseLessonText(req.body.text);
    const lesson = await saveLessonForUser(req.userId, parsed);
    res.status(201).json({
      lesson,
      counts: { vocabulary: parsed.vocabulary.length, kanji: parsed.kanji.length, grammar_points: parsed.grammar_points.length, culture_notes: parsed.culture_notes.length },
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to import — nothing was changed.' });
  }
});

// POST /api/lessons/import-url  body: { url }
// Fetches a raw text file (e.g. a GitHub Gist raw URL) and imports it the same way as
// import-text — lets you push a lesson file to git from any device and pull it in without
// ever opening the app's paste form.
router.post('/import-url', async (req, res) => {
  try {
    const { url } = req.body;
    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'That doesn\'t look like a valid URL.' }); }
    if (parsed.protocol !== 'https:' || !ALLOWED_IMPORT_HOSTS.has(parsed.hostname)) {
      return res.status(400).json({ error: `For safety, only these hosts are allowed: ${[...ALLOWED_IMPORT_HOSTS].join(', ')}. A GitHub Gist's "raw" link works well for this.` });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) return res.status(502).json({ error: `Couldn't fetch that URL (${resp.status}).` });

    const text = await resp.text();
    if (text.length > MAX_IMPORT_TEXT_LENGTH) return res.status(400).json({ error: 'That file is too large.' });

    const lessonData = parseLessonText(text);
    const lesson = await saveLessonForUser(req.userId, lessonData);
    res.status(201).json({
      lesson,
      counts: { vocabulary: lessonData.vocabulary.length, kanji: lessonData.kanji.length, grammar_points: lessonData.grammar_points.length, culture_notes: lessonData.culture_notes.length },
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timed out fetching that URL.' });
    console.error(err);
    res.status(500).json({ error: 'Failed to import — nothing was changed.' });
  }
});

// DELETE /api/lessons/:number - only this user's own lesson
router.delete('/:number', async (req, res) => {
  const lesson = await db.prepare('SELECT id FROM lessons WHERE number = ? AND user_id = ?').get(req.params.number, req.userId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  await db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
  res.json({ success: true });
});

module.exports = router;
module.exports.saveLessonForUser = saveLessonForUser;
