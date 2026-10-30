// Runs before every /api/* request: checks the database, the request origin and the session.
import { json, ensureSchema, readCookie, sha256, SESSION_COOKIE } from '../../server/lib.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: 'The cloud database is not connected yet.', code: 'no_db' }, 503);
  }

  // Block requests that come from other websites
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    const host = new URL(request.url).host;
    let sameSite = true;
    if (origin) {
      try { sameSite = new URL(origin).host === host; } catch { sameSite = false; }
    }
    if (!sameSite) return json({ error: 'Request blocked.' }, 403);
    if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
      return json({ error: 'Expected JSON.' }, 415);
    }
  }

  try {
    await ensureSchema(env.DB);
  } catch (e) {
    return json({ error: 'The cloud database could not be prepared.' }, 500);
  }

  context.data.user = null;
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    const row = await env.DB.prepare(
      'SELECT u.id AS id, u.email AS email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
    ).bind(await sha256(token), Date.now()).first();
    if (row) context.data.user = row;
  }

  try {
    return await context.next();
  } catch (e) {
    return json({ error: 'Something went wrong on the server. Try again.' }, 500);
  }
}
