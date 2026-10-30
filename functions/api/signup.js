import { json, readJson, normEmail, validEmail, randomToken, hashPassword, createSession, sessionCookie } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const email = normEmail(body?.email);
  const password = String(body?.password || '');

  if (!validEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return json({ error: 'Use a password with at least 8 characters.' }, 400);
  if (password.length > 200) return json({ error: 'That password is too long.' }, 400);
  if (env.SIGNUP_CODE && String(body?.code || '') !== env.SIGNUP_CODE) {
    return json({ error: 'That invite code is not right.' }, 403);
  }

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return json({ error: 'An account with this email already exists. Sign in instead.' }, 409);

  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  const res = await env.DB.prepare('INSERT INTO users (email, pw_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .bind(email, hash, salt, Date.now()).run();
  const token = await createSession(env.DB, res.meta.last_row_id);

  return json({ email }, 200, { 'Set-Cookie': sessionCookie(token) });
}
