const express = require('express');
const router = express.Router();
const db = require('../db');
const { schedule } = require('../srs');

const CARD_TABLES = { vocabulary: 'vocabulary', kanji: 'kanji', grammar: 'grammar_points' };

async function hydrateCard(rc) {
  const table = CARD_TABLES[rc.card_type] || 'vocabulary';
  const content = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rc.card_id);
  const lesson = await db.prepare('SELECT number, title FROM lessons WHERE id = ?').get(rc.lesson_id);
  return { ...rc, content, lesson };
}

// GET /api/review/due?maxLesson=27&limit=20&modes=jp_to_en,en_to_jp
router.get('/due', async (req, res) => {
  const maxLesson = req.query.maxLesson ? Number(req.query.maxLesson) : null;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const modes = req.query.modes ? req.query.modes.split(',') : ['jp_to_en', 'en_to_jp', 'en_to_jp_writing'];

  const modePlaceholders = modes.map(() => '?').join(',');
  let sql = `
    SELECT rc.* FROM review_cards rc
    JOIN lessons l ON l.id = rc.lesson_id
    WHERE rc.user_id = ? AND rc.due_at <= datetime('now') AND rc.mode IN (${modePlaceholders})
  `;
  const params = [req.userId, ...modes];
  if (maxLesson) {
    sql += ' AND l.number <= ?';
    params.push(maxLesson);
  }
  sql += ' ORDER BY rc.due_at ASC LIMIT ?';
  params.push(limit);

  const rawCards = await db.prepare(sql).all(...params);
  const cards = await Promise.all(rawCards.map(hydrateCard));
  res.json(cards);
});

// GET /api/review/stats?maxLesson=27
router.get('/stats', async (req, res) => {
  const maxLesson = req.query.maxLesson ? Number(req.query.maxLesson) : null;
  let sql = `
    SELECT
      COUNT(*) AS total_cards,
      SUM(CASE WHEN rc.due_at <= datetime('now') THEN 1 ELSE 0 END) AS due_now,
      SUM(CASE WHEN rc.repetitions = 0 THEN 1 ELSE 0 END) AS never_reviewed
    FROM review_cards rc
    JOIN lessons l ON l.id = rc.lesson_id
    WHERE rc.user_id = ?
  `;
  const params = [req.userId];
  if (maxLesson) {
    sql += ' AND l.number <= ?';
    params.push(maxLesson);
  }
  const row = await db.prepare(sql).get(...params);
  res.json(row);
});

// POST /api/review/:id/answer  body: { quality: 0-5 }
router.post('/:id/answer', async (req, res) => {
  const { quality } = req.body;
  if (quality === undefined || quality < 0 || quality > 5) {
    return res.status(400).json({ error: 'quality must be 0-5' });
  }
  // Scoped by user_id too — without this, guessing another card's numeric id would let
  // one person answer/reschedule a card that belongs to someone else's deck.
  const card = await db.prepare('SELECT * FROM review_cards WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const updated = schedule(card, quality);
  await db.prepare(`
    UPDATE review_cards
    SET ease_factor = ?, interval_days = ?, repetitions = ?, due_at = ?, last_reviewed_at = datetime('now')
    WHERE id = ?
  `).run(updated.ease_factor, updated.interval_days, updated.repetitions, updated.due_at, card.id);

  await db.prepare(`
    INSERT INTO review_log (review_card_id, lesson_id, quality, correct, user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(card.id, card.lesson_id, quality, quality >= 3 ? 1 : 0, req.userId);

  res.json({ ...card, ...updated });
});

module.exports = router;
