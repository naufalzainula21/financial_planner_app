// The user's data as one JSON document with a version number.
// PUT must send the version it was based on; if someone else saved in between, the server
// answers 409 with the current document so the app can merge and try again.
import { json, readJson } from '../../server/lib.js';

const MAX_BYTES = 1900000; // D1 limit per value is ~2 MB

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Sign in first.' }, 401);
  const row = await env.DB.prepare('SELECT doc, version, updated_at FROM states WHERE user_id = ?').bind(data.user.id).first();
  return json({ doc: row ? JSON.parse(row.doc) : null, version: row ? row.version : 0, updatedAt: row ? row.updated_at : 0 });
}

export async function onRequestPut({ request, env, data }) {
  if (!data.user) return json({ error: 'Sign in first.' }, 401);
  const body = await readJson(request);
  const doc = body?.doc;
  const base = Number(body?.baseVersion);
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.transactions) || !Number.isInteger(base)) {
    return json({ error: 'That data could not be saved.' }, 400);
  }
  const text = JSON.stringify(doc);
  if (text.length > MAX_BYTES) return json({ error: 'Your data is too large to sync.' }, 413);

  const now = Date.now();
  let res;
  if (base === 0) {
    res = await env.DB.prepare('INSERT OR IGNORE INTO states (user_id, doc, version, updated_at) VALUES (?, ?, 1, ?)')
      .bind(data.user.id, text, now).run();
  } else {
    res = await env.DB.prepare('UPDATE states SET doc = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?')
      .bind(text, now, data.user.id, base).run();
  }

  if (!res.meta.changes) {
    const row = await env.DB.prepare('SELECT doc, version FROM states WHERE user_id = ?').bind(data.user.id).first();
    return json({ error: 'conflict', doc: row ? JSON.parse(row.doc) : null, version: row ? row.version : 0 }, 409);
  }
  return json({ version: base + 1, updatedAt: now });
}
