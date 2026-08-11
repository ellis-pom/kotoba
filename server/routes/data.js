const express = require('express');
const router = express.Router();
const db = require('../db');

const REVIEW_MODES = new Set(['jp_to_en', 'en_to_jp', 'en_to_jp_writing']);
const GRAMMAR_MODES = new Set(['jp_to_en', 'en_to_jp']);

// GET /api/data/export
// Full snapshot: every lesson's content, each item's SRS scheduling state and (for vocab) its
// verb/adjective classification, plus quiz history. Note: review_log (day-by-day activity used
// for streaks on the Stats page) is intentionally NOT included — it's tied to review_card ids
// that don't survive a re-import, so streak history resets on restore even though SRS progress doesn't.
router.get('/export', async (req, res) => {
  const lessons = await db.prepare('SELECT * FROM lessons WHERE user_id = ? ORDER BY number').all(req.userId);

  const srsFor = async (cardType, itemId) => {
    const cards = await db.prepare('SELECT * FROM review_cards WHERE card_type = ? AND card_id = ?').all(cardType, itemId);
    const out = {};
    for (const c of cards) {
      out[c.mode] = { ease_factor: c.ease_factor, interval_days: c.interval_days, repetitions: c.repetitions, due_at: c.due_at, last_reviewed_at: c.last_reviewed_at };
    }
    return out;
  };

  const exportLessons = [];
  for (const l of lessons) {
    const vocabRows = await db.prepare('SELECT * FROM vocabulary WHERE lesson_id = ?').all(l.id);
    const vocabulary = [];
    for (const v of vocabRows) {
      const cls = await db.prepare('SELECT part_of_speech, dictionary_form, dictionary_reading, verb_group FROM verb_conjugations WHERE vocab_id = ?').get(v.id);
      vocabulary.push({
        kanji_form: v.kanji_form, reading: v.reading, english: v.english,
        srs: await srsFor('vocabulary', v.id),
        classification: cls || null,
      });
    }

    const kanjiRows = await db.prepare('SELECT * FROM kanji WHERE lesson_id = ?').all(l.id);
    const kanji = [];
    for (const k of kanjiRows) {
      kanji.push({ character: k.character, reading: k.reading, meaning: k.meaning, srs: await srsFor('kanji', k.id) });
    }

    const grammarRows = await db.prepare('SELECT * FROM grammar_points WHERE lesson_id = ?').all(l.id);
    const grammar_points = [];
    for (const g of grammarRows) {
      grammar_points.push({
        pattern: g.pattern, meaning_en: g.meaning_en, explanation: g.explanation,
        example_jp: g.example_jp, example_reading: g.example_reading, example_en: g.example_en,
        srs: await srsFor('grammar', g.id),
      });
    }

    const culture_notes = await db.prepare('SELECT title, body FROM culture_notes WHERE lesson_id = ?').all(l.id);

    exportLessons.push({ number: l.number, title: l.title, grammar_notes: l.grammar_notes, vocabulary, kanji, grammar_points, culture_notes });
  }

  const quiz_results = await db.prepare('SELECT kind, lesson_ids, score, total, taken_at FROM quiz_results WHERE user_id = ?').all(req.userId);

  res.setHeader('Content-Disposition', `attachment; filename="kotoba-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    format: 'kotoba-nihongo-app-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    lessons: exportLessons,
    quiz_results,
  });
});

// POST /api/data/import  body: the export JSON above
// Same replace-on-conflict behavior as normal lesson saves (re-importing a lesson number
// overwrites its content), but restores actual SRS progress and classifications instead of
// reseeding everything from scratch.
router.post('/import', async (req, res) => {
  const { lessons, quiz_results } = req.body;
  if (!Array.isArray(lessons)) {
    return res.status(400).json({ error: 'This doesn\'t look like a valid backup file — missing a "lessons" array.' });
  }

  let lessonsImported = 0, itemsImported = 0;
  const tx = await db.beginTransaction();

  try {
    const insertCard = tx.prepare(`
      INSERT INTO review_cards (card_type, card_id, mode, lesson_id, user_id, ease_factor, interval_days, repetitions, due_at, last_reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_type, card_id, mode) DO UPDATE SET ease_factor=excluded.ease_factor, interval_days=excluded.interval_days,
        repetitions=excluded.repetitions, due_at=excluded.due_at, last_reviewed_at=excluded.last_reviewed_at
    `);
    const restoreSrs = async (cardType, cardId, lessonId, srs, allowedModes) => {
      if (!srs) return;
      for (const mode of Object.keys(srs)) {
        if (!allowedModes.has(mode)) continue;
        const s = srs[mode] || {};
        await insertCard.run(cardType, cardId, mode, lessonId, req.userId, s.ease_factor ?? 2.5, s.interval_days ?? 0, s.repetitions ?? 0, s.due_at || new Date().toISOString(), s.last_reviewed_at || null);
      }
    };

    const insertClassification = tx.prepare(`
      INSERT INTO verb_conjugations (vocab_id, is_verb, part_of_speech, dictionary_form, dictionary_reading, verb_group, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vocab_id) DO UPDATE SET is_verb=excluded.is_verb, part_of_speech=excluded.part_of_speech,
        dictionary_form=excluded.dictionary_form, dictionary_reading=excluded.dictionary_reading, verb_group=excluded.verb_group
    `);

    for (const l of lessons) {
      if (!l.number) continue;
      const existing = await tx.prepare('SELECT id FROM lessons WHERE number = ? AND user_id = ?').get(l.number, req.userId);
      let lessonId;
      if (existing) {
        lessonId = existing.id;
        await tx.prepare('UPDATE lessons SET title = ?, grammar_notes = ? WHERE id = ?').run(l.title || null, l.grammar_notes || null, lessonId);
        await tx.prepare('DELETE FROM vocabulary WHERE lesson_id = ?').run(lessonId);
        await tx.prepare('DELETE FROM kanji WHERE lesson_id = ?').run(lessonId);
        await tx.prepare('DELETE FROM grammar_points WHERE lesson_id = ?').run(lessonId);
        await tx.prepare('DELETE FROM culture_notes WHERE lesson_id = ?').run(lessonId);
        await tx.prepare("DELETE FROM review_cards WHERE lesson_id = ? AND card_type IN ('vocabulary','kanji','grammar')").run(lessonId);
      } else {
        const info = await tx.prepare('INSERT INTO lessons (number, user_id, title, grammar_notes) VALUES (?, ?, ?, ?)').run(l.number, req.userId, l.title || null, l.grammar_notes || null);
        lessonId = info.lastInsertRowid;
      }
      lessonsImported++;

      for (const v of l.vocabulary || []) {
        if (!v.reading || !v.english) continue;
        const info = await tx.prepare('INSERT INTO vocabulary (lesson_id, kanji_form, reading, english) VALUES (?, ?, ?, ?)')
          .run(lessonId, v.kanji_form || null, v.reading, v.english);
        const vocabId = info.lastInsertRowid;
        await restoreSrs('vocabulary', vocabId, lessonId, v.srs, REVIEW_MODES);
        if (v.classification?.part_of_speech) {
          const c = v.classification;
          await insertClassification.run(vocabId, c.part_of_speech === 'verb' ? 1 : 0, c.part_of_speech, c.dictionary_form || null, c.dictionary_reading || null, c.verb_group || null, req.userId);
        }
        itemsImported++;
      }

      for (const k of l.kanji || []) {
        if (!k.character || !k.reading || !k.meaning) continue;
        const info = await tx.prepare('INSERT INTO kanji (lesson_id, character, reading, meaning) VALUES (?, ?, ?, ?)')
          .run(lessonId, k.character, k.reading, k.meaning);
        await restoreSrs('kanji', info.lastInsertRowid, lessonId, k.srs, REVIEW_MODES);
        itemsImported++;
      }

      for (const g of l.grammar_points || []) {
        if (!g.pattern || !g.meaning_en) continue;
        const info = await tx.prepare(`
          INSERT INTO grammar_points (lesson_id, pattern, meaning_en, explanation, example_jp, example_reading, example_en)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(lessonId, g.pattern, g.meaning_en, g.explanation || null, g.example_jp || null, g.example_reading || null, g.example_en || null);
        await restoreSrs('grammar', info.lastInsertRowid, lessonId, g.srs, GRAMMAR_MODES);
        itemsImported++;
      }

      for (const c of l.culture_notes || []) {
        if (!c.body) continue;
        await tx.prepare('INSERT INTO culture_notes (lesson_id, title, body) VALUES (?, ?, ?)').run(lessonId, c.title || null, c.body);
      }
    }

    for (const q of quiz_results || []) {
      await tx.prepare('INSERT INTO quiz_results (kind, lesson_ids, score, total, taken_at, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(q.kind, typeof q.lesson_ids === 'string' ? q.lesson_ids : JSON.stringify(q.lesson_ids || []), q.score, q.total, q.taken_at || new Date().toISOString(), req.userId);
    }

    await tx.commit();
    res.json({ success: true, lessonsImported, itemsImported });
  } catch (err) {
    await tx.rollback();
    console.error(err);
    res.status(500).json({ error: 'Import failed partway through — nothing was changed (the whole import was rolled back). ' + err.message });
  }
});

module.exports = router;
