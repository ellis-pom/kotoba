const express = require('express');
const router = express.Router();
const db = require('../db');
const { conjugate, FORM_KEYS, conjugateAdjNoun, ADJ_NOUN_FORM_KEYS } = require('../conjugate');

const VERB_FORM_LABELS = {
  masu: 'ます-form (polite)', nai: 'ない-form (negative)', ta: 'た-form (plain past)', te: 'て-form',
  potential: 'potential form', volitional: 'volitional form ("let\'s...")', ba: 'ば-form (conditional)', tara: 'たら-form (if/when)',
};
const ADJ_NOUN_FORM_LABELS_QUIZ = {
  plain: 'plain (だ) form', negative: 'negative form', past: 'past (た) form', tara: 'たら-form (if)',
  negativeTara: 'negative たら-form', te: 'て/で-form', temo: 'ても-form (even if)', negativeTemo: 'negative ても-form',
};

// Builds a pool of {dictForm, english, lesson_number, formsKanji, formsReading, formLabels} for
// every classified verb/adjective/noun in range, used to generate "conjugate X into Y-form" questions.
async function getConjugationPool(userId, minLesson, maxLesson) {
  const rows = await db.prepare(`
    SELECT v.english, l.number AS lesson_number, vc.part_of_speech, vc.dictionary_form, vc.dictionary_reading, vc.verb_group
    FROM verb_conjugations vc
    JOIN vocabulary v ON v.id = vc.vocab_id
    JOIN lessons l ON l.id = v.lesson_id
    WHERE l.user_id = ? AND l.number BETWEEN ? AND ? AND vc.part_of_speech IS NOT NULL AND vc.part_of_speech != 'other'
  `).all(userId, minLesson, maxLesson);

  return rows.map((r) => {
    const isVerb = r.part_of_speech === 'verb';
    const formsKanji = isVerb ? conjugate(r.dictionary_form, r.dictionary_reading, r.verb_group) : conjugateAdjNoun(r.dictionary_form, r.part_of_speech);
    const formsReading = isVerb ? conjugate(r.dictionary_reading, r.dictionary_reading, r.verb_group) : conjugateAdjNoun(r.dictionary_reading, r.part_of_speech);
    return {
      dictForm: r.dictionary_form, english: r.english, lesson_number: r.lesson_number,
      formsKanji, formsReading, formLabels: isVerb ? VERB_FORM_LABELS : ADJ_NOUN_FORM_LABELS_QUIZ,
    };
  }).filter((item) => item.formsKanji);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

// GET /api/quiz/generate?maxLesson=27&minLesson=1&count=10&kind=quiz&focusLesson=27
// `focusLesson` (optional): weight questions toward one lesson, still pulling some from earlier ones.
router.get('/generate', async (req, res) => {
  const maxLesson = Number(req.query.maxLesson || 27);
  const minLesson = Number(req.query.minLesson || 1);
  const requestedCount = Number(req.query.count || 10);
  const focusLesson = req.query.focusLesson ? Number(req.query.focusLesson) : maxLesson;

  // Reserve up to ~25% of the quiz for conjugation questions if there's classified vocabulary to draw from.
  const conjugationPool = await getConjugationPool(req.userId, minLesson, maxLesson);
  const conjugationCount = conjugationPool.length > 0
    ? Math.max(1, Math.min(Math.round(requestedCount * 0.25), conjugationPool.length * 2, requestedCount - 2))
    : 0;
  const count = requestedCount - conjugationCount;

  const vocab = await db.prepare(`
    SELECT v.*, l.number AS lesson_number FROM vocabulary v
    JOIN lessons l ON l.id = v.lesson_id
    WHERE l.user_id = ? AND l.number BETWEEN ? AND ?
  `).all(req.userId, minLesson, maxLesson);

  const kanjiRows = await db.prepare(`
    SELECT k.*, l.number AS lesson_number FROM kanji k
    JOIN lessons l ON l.id = k.lesson_id
    WHERE l.user_id = ? AND l.number BETWEEN ? AND ?
  `).all(req.userId, minLesson, maxLesson);

  const grammarRows = await db.prepare(`
    SELECT g.*, l.number AS lesson_number FROM grammar_points g
    JOIN lessons l ON l.id = g.lesson_id
    WHERE l.user_id = ? AND l.number BETWEEN ? AND ?
  `).all(req.userId, minLesson, maxLesson);

  const pool = [
    ...vocab.map(v => ({ ...v, type: 'vocabulary', front: v.kanji_form || v.reading, reading: v.reading, answer: v.english })),
    ...kanjiRows.map(k => ({ ...k, type: 'kanji', front: k.character, reading: k.reading, answer: k.meaning })),
    ...grammarRows.map(g => ({ ...g, type: 'grammar', front: g.pattern, reading: g.pattern, answer: g.meaning_en })),
  ];

  if (pool.length < 4) {
    return res.status(400).json({ error: 'Not enough content uploaded yet in this lesson range to build a quiz — add at least 4 vocabulary/kanji/grammar items total.' });
  }

  // Weight ~60% toward the focus lesson if it has enough content, rest from the full range
  const focusPool = pool.filter(p => p.lesson_number === focusLesson);
  const restPool = pool.filter(p => p.lesson_number !== focusLesson);
  const focusCount = Math.min(Math.ceil(count * 0.6), focusPool.length);
  const chosen = [
    ...sample(focusPool, focusCount),
    ...sample(restPool, count - focusCount),
  ];
  const finalItems = chosen.length >= count ? chosen : sample(pool, Math.min(count, pool.length));

  const questionTypes = ['multiple_choice', 'fill_in_blank'];
  const questions = finalItems.map((item, idx) => {
    const qType = questionTypes[idx % questionTypes.length];
    if (qType === 'multiple_choice') {
      const distractorPool = pool.filter(p => p.answer !== item.answer);
      const distractors = sample(distractorPool, 3).map(d => d.answer);
      const options = shuffle([item.answer, ...distractors]);
      return {
        id: `${item.type}-${item.id}-${idx}`,
        type: 'multiple_choice',
        prompt: `What does "${item.front}"${item.reading && item.reading !== item.front ? ` (${item.reading})` : ''} mean?`,
        speak: item.front,
        options,
        correct_answer: item.answer,
        lesson_number: item.lesson_number,
      };
    }
    return {
      id: `${item.type}-${item.id}-${idx}`,
      type: 'fill_in_blank',
      prompt: `Type the English meaning of: ${item.front}${item.reading && item.reading !== item.front ? ` (${item.reading})` : ''}`,
      speak: item.front,
      correct_answer: item.answer,
      lesson_number: item.lesson_number,
    };
  });

  // Mix in the reserved conjugation questions
  const conjugationItems = [];
  const usedFormKeys = new Set();
  for (let i = 0; i < conjugationCount; i++) {
    const item = conjugationPool[Math.floor(Math.random() * conjugationPool.length)];
    const formKeys = Object.keys(item.formsKanji).filter((k) => item.formsKanji[k] != null);
    const formKey = formKeys[Math.floor(Math.random() * formKeys.length)];
    const dedupeKey = `${item.dictForm}:${formKey}`;
    if (usedFormKeys.has(dedupeKey)) { i--; continue; } // avoid literal duplicate questions, retry
    usedFormKeys.add(dedupeKey);
    conjugationItems.push({
      id: `conjugate-${item.dictForm}-${formKey}-${i}`,
      type: 'conjugate',
      prompt: `Conjugate ${item.dictForm} (${item.english}) into the ${item.formLabels[formKey]}:`,
      speak: item.dictForm,
      correct_answer: item.formsKanji[formKey],
      correct_answer_reading: item.formsReading[formKey],
      lesson_number: item.lesson_number,
    });
    if (usedFormKeys.size >= conjugationPool.length * FORM_KEYS.length) break; // safety valve against infinite retry
  }

  res.json({ questions: shuffle([...questions, ...conjugationItems]) });
});

// POST /api/quiz/submit  body: { kind: 'quiz'|'test', lesson_numbers: [1,2,3], score, total }
router.post('/submit', async (req, res) => {
  const { kind, lesson_numbers, score, total } = req.body;
  await db.prepare('INSERT INTO quiz_results (kind, lesson_ids, score, total, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(kind, JSON.stringify(lesson_numbers || []), score, total, req.userId);
  res.status(201).json({ success: true });
});

// GET /api/quiz/history
router.get('/history', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM quiz_results WHERE user_id = ? ORDER BY taken_at DESC LIMIT 50').all(req.userId);
  res.json(rows);
});

module.exports = router;
