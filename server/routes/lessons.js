const express = require('express');
const router = express.Router();
const db = require('../db');
const { classifyUnclassified } = require('./verbs');

const REVIEW_MODES = ['jp_to_en', 'en_to_jp', 'en_to_jp_writing'];
const GRAMMAR_MODES = ['jp_to_en', 'en_to_jp']; // no typing mode — typing a full grammar pattern isn't a meaningful drill

async function seedReviewCards(tx, cardType, cardId, lessonId, userId, modes = REVIEW_MODES) {
  const insert = tx.prepare(`
    INSERT OR IGNORE INTO review_cards (card_type, card_id, mode, lesson_id, user_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const mode of modes) await insert.run(cardType, cardId, mode, lessonId, userId);
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
  const { number, title, grammar_notes, vocabulary = [], kanji = [], culture_notes = [], grammar_points = [] } = req.body;
  if (!number) return res.status(400).json({ error: 'Lesson number is required' });

  const existing = await db.prepare('SELECT id FROM lessons WHERE number = ? AND user_id = ?').get(number, req.userId);

  let lessonId;
  const tx = await db.beginTransaction();
  try {
    if (existing) {
      lessonId = existing.id;
      await tx.prepare('UPDATE lessons SET title = ?, grammar_notes = ? WHERE id = ?')
        .run(title || null, grammar_notes || null, lessonId);
      // Clear old content so re-pasting a lesson replaces it cleanly
      await tx.prepare('DELETE FROM vocabulary WHERE lesson_id = ?').run(lessonId);
      await tx.prepare('DELETE FROM kanji WHERE lesson_id = ?').run(lessonId);
      await tx.prepare('DELETE FROM culture_notes WHERE lesson_id = ?').run(lessonId);
      await tx.prepare('DELETE FROM grammar_points WHERE lesson_id = ?').run(lessonId);
      await tx.prepare("DELETE FROM review_cards WHERE lesson_id = ? AND card_type IN ('vocabulary','kanji','grammar')").run(lessonId);
    } else {
      const info = await tx.prepare('INSERT INTO lessons (number, user_id, title, grammar_notes) VALUES (?, ?, ?, ?)')
        .run(number, req.userId, title || null, grammar_notes || null);
      lessonId = info.lastInsertRowid;
    }

    const insertVocab = tx.prepare('INSERT INTO vocabulary (lesson_id, kanji_form, reading, english) VALUES (?, ?, ?, ?)');
    for (const v of vocabulary) {
      if (!v.reading || !v.english) continue;
      const info = await insertVocab.run(lessonId, v.kanji_form || null, v.reading, v.english);
      await seedReviewCards(tx, 'vocabulary', info.lastInsertRowid, lessonId, req.userId);
    }

    const insertKanji = tx.prepare('INSERT INTO kanji (lesson_id, character, reading, meaning) VALUES (?, ?, ?, ?)');
    for (const k of kanji) {
      if (!k.character || !k.reading || !k.meaning) continue;
      const info = await insertKanji.run(lessonId, k.character, k.reading, k.meaning);
      await seedReviewCards(tx, 'kanji', info.lastInsertRowid, lessonId, req.userId);
    }

    const insertGrammar = tx.prepare('INSERT INTO grammar_points (lesson_id, pattern, meaning_en) VALUES (?, ?, ?)');
    for (const g of grammar_points) {
      if (!g.pattern || !g.meaning_en) continue;
      const info = await insertGrammar.run(lessonId, g.pattern, g.meaning_en);
      await seedReviewCards(tx, 'grammar', info.lastInsertRowid, lessonId, req.userId, GRAMMAR_MODES);
    }

    const insertCulture = tx.prepare('INSERT INTO culture_notes (lesson_id, title, body) VALUES (?, ?, ?)');
    for (const c of culture_notes) {
      if (!c.body) continue;
      await insertCulture.run(lessonId, c.title || null, c.body);
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Failed to save the lesson — nothing was changed.' });
  }

  const lesson = await db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  res.status(201).json(lesson);

  // Auto-classify newly-added vocabulary for the verb/adjective conjugation tables, in the
  // background. Never blocks the save response, and silently does nothing if no Gemini key
  // is configured — classification stays fully optional, same as every other AI feature here.
  if (vocabulary.length > 0) {
    classifyUnclassified(req.userId).catch((err) => {
      if (err.code !== 'NO_API_KEY') console.error('Background auto-classify failed:', err.message);
    });
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
