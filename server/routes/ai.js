const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db');
// Uses Node's built-in fetch (available natively since Node 18) — no extra dependency needed.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are supported right now.'));
    cb(null, true);
  },
});

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGeminiParts(parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI features are not configured yet. Add GEMINI_API_KEY to your .env to enable them.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gemini API error (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callGemini(prompt) {
  return callGeminiParts([{ text: prompt }]);
}

// POST /api/ai/practice-sentence  body: { lessonNumber }
// Generates one natural Japanese sentence using vocab/kanji/grammar from that lesson, plus its English translation.
router.post('/practice-sentence', async (req, res) => {
  try {
    const { lessonNumber } = req.body;
    const lesson = await db.prepare('SELECT * FROM lessons WHERE number = ? AND user_id = ?').get(lessonNumber, req.userId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const vocab = await db.prepare('SELECT * FROM vocabulary WHERE lesson_id = ?').all(lesson.id);
    const kanji = await db.prepare('SELECT * FROM kanji WHERE lesson_id = ?').all(lesson.id);
    if (vocab.length === 0) return res.status(400).json({ error: 'Add vocabulary to this lesson first.' });

    const vocabList = vocab.map(v => `${v.kanji_form || v.reading} (${v.reading}) - ${v.english}`).join(', ');
    const kanjiList = kanji.map(k => `${k.character} (${k.reading}) - ${k.meaning}`).join(', ');

    const prompt = `You are helping a college student studying from "Minna no Nihongo", currently on Lesson ${lessonNumber}.
Grammar notes for this lesson: ${lesson.grammar_notes || 'not specified'}
Vocabulary available: ${vocabList}
Kanji available: ${kanjiList || 'none yet'}

Write ONE natural, level-appropriate Japanese practice sentence using this lesson's grammar and at least one of the vocabulary words. Keep it at a beginner/N5-N4 level appropriate for this point in the textbook.
Respond in EXACTLY this format, nothing else:
JP: <sentence in Japanese script>
READING: <full hiragana reading>
EN: <English translation>`;

    const text = await callGemini(prompt);
    res.json({ raw: text });
  } catch (err) {
    if (err.code === 'NO_API_KEY') return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to generate a practice sentence.' });
  }
});

// POST /api/ai/translate-question  body: { lessonNumber, maxLesson }
// Generates a short JP sentence for a "translate this sentence" quiz question, with the correct EN answer.
router.post('/translate-question', async (req, res) => {
  try {
    const { minLesson = 1, maxLesson } = req.body;
    const lessons = await db.prepare('SELECT * FROM lessons WHERE user_id = ? AND number BETWEEN ? AND ? ORDER BY number').all(req.userId, minLesson, maxLesson);
    if (lessons.length === 0) return res.status(400).json({ error: 'No lessons in that range yet.' });

    const allVocab = [];
    for (const l of lessons) {
      allVocab.push(...(await db.prepare('SELECT * FROM vocabulary WHERE lesson_id = ?').all(l.id)));
    }
    const sample = allVocab.sort(() => Math.random() - 0.5).slice(0, 12)
      .map(v => `${v.kanji_form || v.reading} (${v.reading}) - ${v.english}`).join(', ');

    const prompt = `You are writing a quiz question for a college student studying "Minna no Nihongo", who has completed lessons ${minLesson}-${maxLesson}.
Using ONLY grammar and vocabulary appropriate for that range, and preferring these words where natural: ${sample}
Write ONE short Japanese sentence (5-10 words) for a "translate to English" quiz question.
Respond in EXACTLY this format, nothing else:
JP: <sentence>
EN: <correct English translation>`;

    const text = await callGemini(prompt);
    res.json({ raw: text });
  } catch (err) {
    if (err.code === 'NO_API_KEY') return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to generate a translation question.' });
  }
});

// POST /api/ai/extract-lesson  multipart form field "file" (PDF)
// Sends the PDF directly to Gemini's multimodal input and asks for vocab/kanji/culture
// structured into the same shape the Add Lesson form and POST /api/lessons expect.
router.post('/extract-lesson', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That PDF is too large (15MB max).' });
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file was uploaded.' });

    const base64 = req.file.buffer.toString('base64');
    const prompt = `You are helping extract content from a page of the "Minna no Nihongo" Japanese textbook (or a vocab list styled like it) into structured JSON for a flashcard app.

Read the attached PDF and extract:
- vocabulary: Japanese words with their kanji form (if any), reading, and English meaning
- kanji: individual kanji characters taught on this page, with reading(s) and meaning
- culture_notes: any culture/background notes present (title + body text), if any
- grammar_points: individual grammar patterns listed (e.g. "〜てもいいです"), each with a short English meaning gloss (e.g. "permission, may I...")
- grammar_notes: a short plain-text overview of the grammar section, if useful beyond the individual points
- title: a short title for this lesson/page, if apparent (otherwise omit)

Respond with ONLY raw JSON (no markdown fences, no commentary), in EXACTLY this shape:
{
  "title": "string or null",
  "grammar_notes": "string or null",
  "vocabulary": [{"kanji_form": "string or null", "reading": "string", "english": "string"}],
  "kanji": [{"character": "string", "reading": "string", "meaning": "string"}],
  "grammar_points": [{"pattern": "string", "meaning_en": "string"}],
  "culture_notes": [{"title": "string or null", "body": "string"}]
}
If a section has nothing to extract, use an empty array for it. Do not invent content that isn't on the page.`;

    const raw = await callGeminiParts([
      { inline_data: { mime_type: 'application/pdf', data: base64 } },
      { text: prompt },
    ]);

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'The AI response could not be read as structured data. Try again, or a clearer PDF.' });
    }

    res.json({
      title: parsed.title || '',
      grammar_notes: parsed.grammar_notes || '',
      vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
      kanji: Array.isArray(parsed.kanji) ? parsed.kanji : [],
      grammar_points: Array.isArray(parsed.grammar_points) ? parsed.grammar_points : [],
      culture_notes: Array.isArray(parsed.culture_notes) ? parsed.culture_notes : [],
    });
  } catch (err) {
    if (err.code === 'NO_API_KEY') return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to extract content from that PDF.' });
  }
});

// POST /api/ai/explain-grammar  body: { grammarPointId }
// Generates a plain-English explanation plus one example sentence for a grammar point,
// and caches the result on the row so repeat visits don't re-spend API quota.
router.post('/explain-grammar', async (req, res) => {
  try {
    const { grammarPointId } = req.body;
    const point = await db.prepare(`
      SELECT gp.* FROM grammar_points gp
      JOIN lessons l ON l.id = gp.lesson_id
      WHERE gp.id = ? AND l.user_id = ?
    `).get(grammarPointId, req.userId);
    if (!point) return res.status(404).json({ error: 'Grammar point not found.' });

    if (point.explanation) return res.json(point); // already cached

    const lesson = await db.prepare('SELECT * FROM lessons WHERE id = ?').get(point.lesson_id);
    const prompt = `You are helping a college student studying "Minna no Nihongo" understand a grammar point from Lesson ${lesson?.number ?? '?'}.

Grammar pattern: ${point.pattern}
Short meaning: ${point.meaning_en}

Write a clear, beginner-friendly explanation (2-4 sentences) of how and when this pattern is used, at a level appropriate for someone early in Japanese study. Then give ONE natural example sentence using it.
Respond in EXACTLY this format, nothing else:
EXPLANATION: <2-4 sentence explanation>
JP: <example sentence in Japanese script>
READING: <full hiragana reading of the example>
EN: <English translation of the example>`;

    const raw = await callGemini(prompt);
    const get = (label) => {
      const m = raw.match(new RegExp(`${label}:\\s*([\\s\\S]+?)(?=\\n[A-Z]+:|$)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const explanation = get('EXPLANATION');
    const exampleJp = get('JP');
    const exampleReading = get('READING');
    const exampleEn = get('EN');

    await db.prepare(`
      UPDATE grammar_points
      SET explanation = ?, example_jp = ?, example_reading = ?, example_en = ?
      WHERE id = ?
    `).run(explanation, exampleJp, exampleReading, exampleEn, point.id);

    res.json({ ...point, explanation, example_jp: exampleJp, example_reading: exampleReading, example_en: exampleEn });
  } catch (err) {
    if (err.code === 'NO_API_KEY') return res.status(503).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to generate a grammar explanation.' });
  }
});

module.exports = router;
