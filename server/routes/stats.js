const express = require('express');
const router = express.Router();
const db = require('../db');

// Standard SRS mastery buckets based on current interval length
function masteryBucket(intervalDays, repetitions) {
  if (repetitions === 0) return 'new';
  if (intervalDays < 1) return 'learning';
  if (intervalDays < 21) return 'young';
  return 'mature';
}

// GET /api/stats/overview
router.get('/overview', async (req, res) => {
  const cards = await db.prepare('SELECT interval_days, repetitions, due_at FROM review_cards WHERE user_id = ?').all(req.userId);
  const buckets = { new: 0, learning: 0, young: 0, mature: 0 };
  let dueNow = 0;
  const now = new Date();
  for (const c of cards) {
    buckets[masteryBucket(c.interval_days, c.repetitions)] += 1;
    if (new Date(c.due_at) <= now) dueNow += 1;
  }

  const totalReviewsRow = await db.prepare('SELECT COUNT(*) AS n FROM review_log WHERE user_id = ?').get(req.userId);
  const totalReviews = totalReviewsRow.n;
  const totalCorrectRow = await db.prepare('SELECT COUNT(*) AS n FROM review_log WHERE user_id = ? AND correct = 1').get(req.userId);
  const totalCorrect = totalCorrectRow.n;
  const accuracy = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : null;

  // Current streak: walk backwards from today counting consecutive days with at least one review.
  // If today has no reviews yet, the streak is still "alive" as long as yesterday had one.
  const dayRows = await db.prepare('SELECT DISTINCT date(reviewed_at) AS d FROM review_log WHERE user_id = ?').all(req.userId);
  const daySet = new Set(dayRows.map((r) => r.d));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!daySet.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  res.json({
    totalCards: cards.length,
    dueNow,
    mastery: buckets,
    totalReviews,
    accuracy,
    streakDays: streak,
  });
});

// GET /api/stats/lessons — per-lesson progress for this user
router.get('/lessons', async (req, res) => {
  const rows = await db.prepare(`
    SELECT
      l.number, l.title,
      COUNT(rc.id) AS card_count,
      SUM(CASE WHEN rc.repetitions > 0 THEN 1 ELSE 0 END) AS started_count,
      SUM(CASE WHEN rc.interval_days >= 21 THEN 1 ELSE 0 END) AS mature_count,
      AVG(rc.ease_factor) AS avg_ease
    FROM lessons l
    LEFT JOIN review_cards rc ON rc.lesson_id = l.id
    WHERE l.user_id = ?
    GROUP BY l.id
    ORDER BY l.number ASC
  `).all(req.userId);
  res.json(rows.map((r) => ({
    ...r,
    mastered_pct: r.card_count ? Math.round((r.mature_count / r.card_count) * 100) : 0,
  })));
});

// GET /api/stats/activity?days=30 — reviews per day + accuracy for this user, for a simple bar chart
router.get('/activity', async (req, res) => {
  const days = Math.min(90, Number(req.query.days) || 30);
  const rows = await db.prepare(`
    SELECT date(reviewed_at) AS day, COUNT(*) AS total, SUM(correct) AS correct
    FROM review_log
    WHERE user_id = ? AND reviewed_at >= datetime('now', ?)
    GROUP BY day ORDER BY day ASC
  `).all(req.userId, `-${days} days`);

  const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = byDay[key];
    result.push({ day: key, total: row?.total || 0, correct: row?.correct || 0 });
  }
  res.json(result);
});

module.exports = router;
