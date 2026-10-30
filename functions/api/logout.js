import { json, readCookie, sha256, clearCookie, SESSION_COOKIE } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
}
