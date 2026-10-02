import crypto from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './books.js';

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'הסיסמה צריכה להיות באורך 8 תווים לפחות');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    sha256(token),
    userId,
    `+${config.sessionDays} days`
  );
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function sessionCookie(token, maxAgeSeconds = config.sessionDays * 86400) {
  return [
    `sid=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    config.cookieSecure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sessionToken(req) {
  return readCookie(req, 'sid');
}

export function loadUser(db) {
  return (req, _res, next) => {
    const token = sessionToken(req);
    req.user = null;
    if (token) {
      const user = db
        .prepare(
          `SELECT u.id, u.email, u.name, u.role, u.client_id, c.name AS client_name
           FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN clients c ON c.id = u.client_id
           WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`
        )
        .get(sha256(token));
      if (user) req.user = user;
    }
    next();
  };
}

// Every state-changing request must come from our own page (a custom header
// cannot be sent cross-site without CORS, which this server never allows).
export function requireSameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'fetch') return next(new HttpError(403, 'בקשה לא מורשית'));
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'צריך להתחבר'));
  next();
}

export function requireStaff(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'צריך להתחבר'));
  if (req.user.role !== 'staff') return next(new HttpError(403, 'אין הרשאה'));
  next();
}

/** A client user sees only its own file; staff sees every file. */
export function assertClientAccess(user, clientId) {
  if (user.role === 'staff') return;
  if (Number(user.client_id) !== Number(clientId)) throw new HttpError(404, 'לא נמצא');
}

// Login throttle: at most 10 failed attempts per address and e-mail in 15 minutes.
const failures = new Map();
export function checkLoginThrottle(key) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  failures.set(key, list);
  if (list.length >= 10) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה');
}
export function recordLoginFailure(key) {
  failures.set(key, [...(failures.get(key) || []), Date.now()]);
}
export function clearLoginFailures(key) {
  failures.delete(key);
}
