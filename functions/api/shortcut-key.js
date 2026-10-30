// Create, check or remove the private key that iPhone Shortcuts use to add transactions.
// Needs a signed-in session. The key is shown once; only its hash is stored.
import { json, randomToken, sha256 } from '../../server/lib.js';

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Sign in first.' }, 401);
  const row = await env.DB.prepare('SELECT created_at, last_used FROM shortcut_keys WHERE user_id = ?').bind(data.user.id).first();
  return json({ exists: !!row, createdAt: row?.created_at || 0, lastUsed: row?.last_used || 0 });
}

// POST makes a new key and replaces any old one (the old one stops working).
export async function onRequestPost({ env, data }) {
  if (!data.user) return json({ error: 'Sign in first.' }, 401);
  const key = 'jp_' + randomToken(24);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO shortcut_keys (user_id, key_hash, created_at, last_used) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used = NULL'
  ).bind(data.user.id, await sha256(key), now).run();
  return json({ key, createdAt: now });
}

export async function onRequestDelete({ env, data }) {
  if (!data.user) return json({ error: 'Sign in first.' }, 401);
  await env.DB.prepare('DELETE FROM shortcut_keys WHERE user_id = ?').bind(data.user.id).run();
  return json({ ok: true });
}
