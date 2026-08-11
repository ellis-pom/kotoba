const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, verifyPassword, generateSessionToken } = require('../auth');

const SESSION_DAYS = 30;
const COOKIE_NAME = 'kotoba_session';

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

async function createSession(userId) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

// POST /api/auth/register  body: { username, password }
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const cleanUsername = username.trim().toLowerCase();

  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) return res.status(409).json({ error: 'That username is already taken.' });

  // The very first person to register inherits any data that existed before accounts did
  // (this app started single-user — see README). Every account after that starts empty.
  const userCountRow = await db.prepare('SELECT COUNT(*) AS n FROM users').get();
  const isFirstUser = userCountRow.n === 0;

  const passwordHash = hashPassword(password);
  const info = await db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(cleanUsername, passwordHash);
  const userId = info.lastInsertRowid;

  if (isFirstUser) {
    await db.prepare('UPDATE lessons SET user_id = ? WHERE user_id IS NULL').run(userId);
    await db.prepare('UPDATE review_cards SET user_id = ? WHERE user_id IS NULL').run(userId);
    await db.prepare('UPDATE verb_conjugations SET user_id = ? WHERE user_id IS NULL').run(userId);
    await db.prepare('UPDATE quiz_results SET user_id = ? WHERE user_id IS NULL').run(userId);
    await db.prepare('UPDATE review_log SET user_id = ? WHERE user_id IS NULL').run(userId);
  }

  const token = await createSession(userId);
  setSessionCookie(res, token);
  res.status(201).json({ id: userId, username: cleanUsername, claimedExistingData: isFirstUser });
});

// POST /api/auth/login  body: { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ id: user.id, username: user.username });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// GET /api/auth/me — used by the frontend on load to check login state
router.get('/me', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ id: req.userId, username: req.username });
});

module.exports = router;
module.exports.COOKIE_NAME = COOKIE_NAME;
