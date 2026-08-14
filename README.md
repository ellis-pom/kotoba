# Kotoba — Minna no Nihongo Study Companion

A personal Japanese study site built around the pacing of *Minna no Nihongo*: paste in each
lesson's vocabulary, kanji, culture notes, and grammar points, then review with spaced-repetition
flashcards, quizzes, and cumulative tests.

## What's inside

- **Backend:** Node.js + Express, database access via `@libsql/client` — the driver for
  [Turso](https://turso.tech), a hosted SQLite-compatible database with a genuinely persistent
  free tier. By default (no config needed) it points at a local file, so local development and
  testing need no Turso account at all — the exact same code path just talks to a file on disk
  instead of the network. Set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` to point it at a real
  Turso database for a live deployment. (This app has gone through two database layers: it
  started on `better-sqlite3`, a native module that failed to install on some Windows setups
  without a C++ build toolchain; then moved to Node's built-in `node:sqlite`, which fixed that
  but only works with a database sitting on local disk; now on `@libsql/client` specifically so
  the data can live somewhere durable if you deploy it. It also uses a native binary locally —
  but the modern kind, prebuilt per-platform via npm and built on Node's stable N-API, not the
  compile-per-Node-version kind that caused the original Windows install trouble.)
- **Frontend:** React (Vite).
- **Spaced repetition:** SM-2 algorithm (same core logic as Anki) — each card is scheduled per-mode
  (Japanese→English, English→Japanese, English→Japanese typing).
- **Quizzes/tests:** generated from your uploaded content — multiple choice and fill-in-the-blank,
  weighted toward a focus lesson while still mixing in earlier ones. Tests also mix in a couple of
  AI-generated "translate this sentence" questions (self-graded, since free translation can't be
  exact-matched) when a Gemini key is configured.
- **AI (optional):** a "Generate with AI" button on each lesson page can produce a natural practice
  sentence from that lesson's vocab/grammar, using Google's **free-tier** Gemini API. You can also
  upload a **PDF vocab list** on the Add Lesson page and have AI extract vocabulary/kanji/culture
  notes into the form for you to review and edit before saving. Both are entirely optional — the
  app works fully without them, and your key never reaches the browser (it stays on the server).
- **Editing lessons:** every lesson has an "Edit" link that reloads its content into the same form
  used to add it, so fixing a typo doesn't mean retyping the whole lesson.
- **Progress page:** streak, overall accuracy, a card-mastery breakdown (new/learning/young/mature),
  a 30-day review activity chart, and per-lesson progress — all computed from your actual review
  history, no setup needed.
- **Grammar system:** grammar points are structured rows (`pattern | meaning`), not just a text
  blob — each one gets its own spaced-repetition flashcards (pattern→meaning and meaning→pattern),
  joins the quiz/test question pool alongside vocab and kanji, and can get a full AI-generated
  explanation + example sentence on demand, cached so it only costs one API call per point.
- **Audio pronunciation:** a speaker button next to any Japanese text (vocab, kanji, grammar
  patterns, quiz questions) reads it aloud using the browser's own built-in text-to-speech — no
  API key, no server call, works even without a Gemini key configured.
- **Conjugation practice:** AI classifies each saved vocabulary word's part of speech — verb,
  い-adjective, な-adjective, or noun — a one-time check per word, cached permanently. The actual
  conjugated forms are computed by a deterministic rule-based engine (`server/conjugate.js`), not
  AI, so there's no hallucination risk on the grammar itself; it's been tested against 30+
  known-correct conjugations including the tricky irregulars (帰る's godan-る ambiguity, 行く's
  euphonic exception, ある's irregular negative, する-compounds, 来る's vowel shift, いい's
  irregular stem). Two tables: verb forms (ます/て/た/ない/potential/volitional/ば/たら), and
  adjective/noun conditional forms (たら "if" / ても "even if", both positive and negative — な-
  adjectives and nouns share one table since both conjugate off the です/だ copula). Defaults to
  your most recent lesson plus the common irregulars, with a slider controlling how much of the
  table is pre-filled vs. left blank to quiz yourself on, and a shuffle button to re-randomize
  which cells are blanked. Classification now also runs automatically in the background whenever
  you save a lesson with new vocabulary — no need to visit the Verbs page and classify manually
  unless you want to (it never blocks or slows down the save, and does nothing if no Gemini key
  is configured).
- **Conjugation questions in quizzes/tests:** once vocabulary is classified, quizzes and tests mix
  in "conjugate X into Y-form" questions alongside the usual multiple-choice/fill-in-blank ones —
  pulling from your real classified verbs/adjectives/nouns, graded the same kana-aware way as the
  conjugation table's typing mode (type romaji or kana, checked against the reading).
- **Backup & restore:** a dedicated page to download your entire deck as one JSON file — every
  lesson's content, your actual spaced-repetition progress per card (not just the content),
  verb/adjective classifications, and quiz history. Re-importing restores all of it, not just a
  fresh copy of the text; re-importing a lesson number replaces its content the same way re-saving
  it normally does. (Day-by-day activity history for the Stats page streak/chart isn't included,
  since it's tied to internal ids that don't survive a re-import — only current SRS scheduling
  state does.)
- **Accounts:** real per-person logins, not just a shared password. Register/log in from the
  app itself; passwords are hashed with Node's built-in `scrypt` (no external dependency), and
  sessions are stored server-side and survive restarts. Every lesson, flashcard, quiz result, and
  classification is scoped to the account that created it — two people using the same deployment
  each get their own completely separate deck, including being able to both have their own
  "Lesson 1". The **first person to register automatically inherits any data that already existed**
  (relevant if you're upgrading from before accounts existed — nothing gets orphaned). There's
  still an optional outer `SITE_USERNAME`/`SITE_PASSWORD` gate too (see the deploy section below)
  — that's a separate, simpler layer for keeping the login page itself from being publicly
  reachable at all, not a substitute for real accounts.

## Running it locally

Requires [Node.js](https://nodejs.org) 18+. Check yours with `node -v`.

```bash
# from the project root
npm run build   # installs server + client deps, then builds the React app into client/dist

cp .env.example .env
# (optional) paste a free Gemini key into .env — see below

npm start
```

Visit `http://localhost:3001`. The server serves both the API and the built frontend from one process.

For active frontend development with hot reload, run these in two terminals instead:
```bash
npm run dev:server   # API on :3001
npm run dev:client   # Vite dev server on :5173, already proxies /api to :3001
```

## Getting a free Gemini API key (optional, for AI practice sentences)

1. Go to https://aistudio.google.com/app/apikey and sign in with a Google account.
2. Click "Create API key" — no credit card required.
3. Paste it into `.env` as `GEMINI_API_KEY=...`.
4. Restart the server.

The free tier (Gemini 2.5 Flash, as of 2026) allows several requests per minute and hundreds per
day — more than enough for personal study use. If you skip this, everything else in the app
(flashcards, quizzes, tests, lesson management) works exactly the same; only the "Generate with AI"
button will show a message that it's not configured.

## Deploying it live (optional)

Everything above runs entirely on your own computer — that's the default, and it's genuinely
free forever with no account needed anywhere. Deploying it live (so you can reach it from your
phone or another computer) is optional, and involves two separate pieces:

**1. A durable place for the data.** The app's data normally lives in a local file
(`server/data/nihongo.db`). That's fine on your own computer, but most free hosting has an
*ephemeral* filesystem — Render's free tier, for example, wipes local files every time the
service spins down from inactivity (which happens after just 15 minutes idle). [Turso](https://turso.tech)
solves this: it's a hosted, SQLite-compatible database with a genuinely persistent free tier.

1. Create a free account at [turso.tech](https://turso.tech) and install their CLI.
2. `turso db create kotoba` — creates your database.
3. `turso db show kotoba --url` — gives you the `TURSO_DATABASE_URL`.
4. `turso db tokens create kotoba` — gives you the `TURSO_AUTH_TOKEN`.
5. Put both into your `.env` (locally) or your hosting provider's environment variables
   (in production). That's it — the app automatically switches from the local file to Turso
   the moment `TURSO_DATABASE_URL` is set. No code changes, no migration script needed for a
   fresh start (though see "moving existing data" below if you already have lessons saved locally).

**2. Somewhere to actually run the app.** [Render](https://render.com)'s free web service tier
works well for this, now that the data itself isn't stored on Render's disk:

1. Push this project to a GitHub repository.
2. On Render, click **New → Blueprint** and point it at your repo — it'll pick up the included
   `render.yaml` automatically. (Or click **New → Web Service** manually: build command
   `npm run build`, start command `npm start`, instance type Free.)
3. In the Render dashboard, set these environment variables:
   - `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — from the Turso steps above
   - `GEMINI_API_KEY` — optional, for the AI features
   - `SITE_USERNAME` / `SITE_PASSWORD` — **set these once the site is public.** Without them the
     site is wide open to anyone with the URL; with them, it prompts for a simple login before
     anything loads. Pick any username/password you like.
4. Deploy. Render gives you a URL like `https://your-app.onrender.com`.

**Moving data you already have locally:** use the Backup page (`/backup` in the app) to export
your existing local data as JSON, then import that same file on the freshly-deployed live site —
it restores your lessons, SRS progress, and classifications, not just a blank copy of the content.

**What's still true about Render's free tier even with Turso handling the data:** the web
service itself still spins down after ~15 minutes idle and takes ~30-60 seconds to wake back up
on your next visit. That's unrelated to where the data lives and can't be avoided on the free
tier — it's a fine tradeoff for a personal study app, just not instant on a cold visit.

## How content input works

On the **Add Lesson** page, paste content directly — no file upload needed:

- **Vocabulary**, one word per line: `kanji | reading | english` (leave the kanji blank for words
  with no kanji form, e.g. `| これ | this one`)
- **Kanji**, one per line: `character | reading(s) | meaning`
- **Grammar** and **culture notes** are plain text boxes — paste however your notes are formatted.

Saving a lesson number that already exists **replaces** its content, so you can re-paste a lesson
if you need to fix something.

**Importing without opening the form** (e.g. from your phone, no laptop needed): write a lesson as
one plain-text file using `LESSON:`/`TITLE:`/`VOCAB:`/`KANJI:`/`GRAMMAR:`/`CULTURE:` section
headers (same `kanji | reading | english` row format throughout — see `server/parseLessonText.js`
for the exact grammar), save it as a GitHub Gist, and either paste its raw URL or paste the text
itself into the "Import from a text file" box on the Add Lesson page. For safety, URL imports are
only allowed from `raw.githubusercontent.com` and `gist.githubusercontent.com`. This saves
immediately with no review step, since it's a deterministic parse rather than an AI guess.

**Studying without the kanji crutch:** the Study page has a 漢字 On/Off toggle next to the mode
filters — switch it off to have flashcards show readings only, useful for practicing recognizing
words by sound/kana before you're solid on the kanji itself.

## Project structure

```
server/          Express API + libsql (Turso-compatible) database
  routes/        auth (accounts/sessions), lessons, review (SRS), quiz, ai, verbs, stats, data (backup/restore)
  db.js          schema + database connection (local file by default, Turso when configured)
  auth.js        password hashing (scrypt) + session token generation
  parseLessonText.js  parser for the plain-text lesson import format
  srs.js         SM-2 scheduling
  conjugate.js   deterministic verb/adjective conjugation engine
client/          React app (Vite)
  src/pages/     Login, Dashboard, Lessons, AddLesson, LessonDetail, Study, Quiz, Test, VerbTable, Stats, Backup
render.yaml      Render Blueprint — used by "New → Blueprint" for one-step deploy config
```

## Extending it later

Some things still on the list:
- Kanji stroke-order / handwriting practice
- Extracting from file types beyond PDF (photos, docx) — the `/api/ai/extract-lesson` route
  already sends the file straight to Gemini, so supporting images is mostly a matter of relaxing
  the multer file filter and mime type
- Password reset (currently there's no "forgot password" flow — losing your password means
  losing access to that account's data, so treat it like any other password worth writing down)
