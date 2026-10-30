// Shared helpers for the Jon Pocket API (Cloudflare Pages Functions + D1).

const enc = new TextEncoder();

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });

const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64u(a);
}

export async function sha256(str) {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

/** PBKDF2-SHA256, 100k iterations (the Workers maximum). */
export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return b64u(bits);
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- Database schema (created automatically on first request) ---------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     pw_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS states (
     user_id INTEGER PRIMARY KEY,
     doc TEXT NOT NULL,
     version INTEGER NOT NULL,
     updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     email TEXT NOT NULL,
     ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_attempts_email ON login_attempts(email, ts)`
];
let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

/* ---------- Sessions ---------- */
export const SESSION_COOKIE = 'jp_session';
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export const sessionCookie = (token) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
export const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export async function createSession(db, userId) {
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now() + MAX_AGE * 1000).run();
  // tidy up expired sessions now and then
  if (Math.random() < 0.1) await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  return token;
}

export const normEmail = (v) => String(v || '').trim().toLowerCase();
export const validEmail = (e) => e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
