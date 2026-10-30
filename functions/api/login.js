import { json, readJson, normEmail, hashPassword, safeEqual, createSession, sessionCookie } from '../../server/lib.js';

const WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_FAILS = 8;

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const email = normEmail(body?.email);
  const password = String(body?.password || '');
  if (!email || !password) return json({ error: 'Enter your email and password.' }, 400);

  const since = Date.now() - WINDOW;
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ts > ?')
    .bind(email, since).first();
  if ((fails?.n || 0) >= MAX_FAILS) {
    return json({ error: 'Too many wrong attempts. Wait 15 minutes and try again.' }, 429);
  }

  const user = await env.DB.prepare('SELECT id, email, pw_hash, salt FROM users WHERE email = ?').bind(email).first();
  // hash even when the user doesn't exist, so response time doesn't reveal which emails have accounts
  const hash = await hashPassword(password, user ? user.salt : 'no-such-user');
  if (!user || !safeEqual(hash, user.pw_hash)) {
    await env.DB.prepare('INSERT INTO login_attempts (email, ts) VALUES (?, ?)').bind(email, Date.now()).run();
    return json({ error: 'That email and password don’t match.' }, 401);
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE email = ? OR ts < ?').bind(email, since).run();
  const token = await createSession(env.DB, user.id);
  return json({ email: user.email }, 200, { 'Set-Cookie': sessionCookie(token) });
}
