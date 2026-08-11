require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db');
const { COOKIE_NAME } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// credentials: true + explicit origin reflection is needed for cookies to survive cross-origin
// requests (e.g. the Vite dev server on :5173 talking to the API on :3001). In production both
// are served from the same origin, so this is mostly relevant for local development.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Optional extra gate on top of real accounts: set SITE_USERNAME + SITE_PASSWORD to require a
// single shared login (a basic-auth prompt) before the site is even reachable at all — useful if
// you don't want the login/register page itself visible to random visitors. Real per-person data
// isolation is handled by the account system below, not this — this is just an outer door.
function siteAuth(req, res, next) {
  const user = process.env.SITE_USERNAME;
  const pass = process.env.SITE_PASSWORD;
  if (!user || !pass) return next(); // gate not configured — stay open
  if (req.path === '/api/health') return next(); // let hosting platform health checks through

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const reqUser = decoded.slice(0, sep);
    const reqPass = decoded.slice(sep + 1);
    if (reqUser === user && reqPass === pass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Kotoba"');
  res.status(401).send('Authentication required.');
}
app.use(siteAuth);

// Real per-account authentication. Looks up the session cookie, and if valid, attaches
// req.userId/req.username for every route to use. Routes under /api/auth, plus health,
// plus non-API requests (the React app itself, so it can render its own login screen),
// are allowed through without a session. Every other /api/* route requires one.
const PUBLIC_PATHS = new Set(['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/health']);
async function requireAuth(req, res, next) {
  // Always try to resolve the session if a cookie is present — /api/auth/me needs req.userId
  // populated to answer correctly even though it's reachable without an existing session.
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const session = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (session && new Date(session.expires_at) >= new Date()) {
      const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
      if (user) {
        req.userId = user.id;
        req.username = user.username;
      }
    }
  }

  const isPublic = !req.path.startsWith('/api/') || PUBLIC_PATHS.has(req.path);
  if (isPublic) return next();

  if (!req.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}
app.use(requireAuth);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/review', require('./routes/review'));
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/verbs', require('./routes/verbs'));
app.use('/api/data', require('./routes/data'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve the built React app in production (single Render deployment)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Wait for the database schema to finish setting up before accepting any requests —
// avoids a race where a request arrives before tables exist.
db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Nihongo app server running on port ${PORT}`);
    if (process.env.SITE_USERNAME && process.env.SITE_PASSWORD) {
      console.log('Outer site-wide gate is ENABLED (SITE_USERNAME/SITE_PASSWORD are set).');
    }
    if (process.env.TURSO_DATABASE_URL) {
      console.log('Using Turso database:', process.env.TURSO_DATABASE_URL);
    } else {
      console.log('Using local database file (no TURSO_DATABASE_URL set).');
    }
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
