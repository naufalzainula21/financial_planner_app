// Add a transaction from an iPhone Shortcut (or any app that can send a web request).
//
//   POST /api/quick-add
//   Authorization: Bearer <your Shortcut key>
//   Content-Type: application/json
//   { "type": "expense", "amount": 35000, "name": "Kopi", "category": "Food", "pocket": "GoPay", "note": "", "date": "2026-10-30" }
//
// Only type and amount are required. category and pocket can be the name you see in the app.
// GET /api/quick-add returns your category and pocket names, for "Choose from List" menus.
import { json, readJson, userFromShortcutKey } from '../../server/lib.js';
import { CATEGORIES } from '../../js/icons.js';

const DEFAULT_POCKETS = [
  { id: 'jago', name: 'Bank Jago' }, { id: 'bca', name: 'BCA' }, { id: 'gopay', name: 'GoPay' }, { id: 'ovo', name: 'OVO' }
];
const norm = (v) => String(v ?? '').trim().toLowerCase();
const fmt = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const alive = (doc, x) => !(doc.deleted && doc.deleted[x.id] && doc.deleted[x.id] >= (x.u || 0));

function lists(doc) {
  const custom = (doc?.categories || []).filter((c) => c && c.id && c.label && alive(doc, c));
  const cats = [
    ...Object.entries(CATEGORIES).filter(([, c]) => c.type !== 'transfer').map(([id, c]) => ({ id, label: c.label, short: c.short, type: c.type })),
    ...custom.map((c) => ({ id: c.id, label: c.label, short: c.label, type: c.type === 'income' ? 'income' : 'expense' }))
  ];
  const pockets = (doc?.accounts?.length ? doc.accounts : DEFAULT_POCKETS).filter((p) => p && p.id && p.name && (!doc || alive(doc, p)));
  return { cats, pockets };
}

// Amount may come as 35000, "35000", "35.000", "Rp 35.000" or "35k"
function parseAmount(v) {
  if (typeof v === 'number') return v;
  let s = norm(v).replace(/rp|idr|\s/g, '');
  let mult = 1;
  if (/(k|rb|ribu)$/.test(s)) { mult = 1000; s = s.replace(/(k|rb|ribu)$/, ''); }
  else if (/(jt|juta|m)$/.test(s)) { mult = 1000000; s = s.replace(/(jt|juta|m)$/, ''); }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * mult : NaN;
}

// Today in Jakarta time unless the Shortcut sends a date
function today() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  const userId = await userFromShortcutKey(request, env.DB);
  if (!userId) return json({ error: 'That Shortcut key is not valid. Make a new one in Jon Pocket → Your data → iPhone Shortcut.' }, 401);
  const row = await env.DB.prepare('SELECT doc FROM states WHERE user_id = ?').bind(userId).first();
  const { cats, pockets } = lists(row ? JSON.parse(row.doc) : null);
  return json({
    expense: cats.filter((c) => c.type === 'expense').map((c) => c.label),
    income: cats.filter((c) => c.type === 'income').map((c) => c.label),
    pockets: pockets.map((p) => p.name)
  });
}

export async function onRequestPost({ request, env }) {
  const userId = await userFromShortcutKey(request, env.DB);
  if (!userId) return json({ error: 'That Shortcut key is not valid. Make a new one in Jon Pocket → Your data → iPhone Shortcut.' }, 401);
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return json({ error: 'Send the details as JSON.' }, 400);

  const type = norm(body.type) === 'income' ? 'income' : norm(body.type) === 'expense' || !body.type ? 'expense' : null;
  if (!type) return json({ error: 'Type must be "expense" or "income".' }, 400);
  const amount = parseAmount(body.amount);
  if (!(amount > 0) || amount > 1e13) return json({ error: 'Enter an amount above zero.' }, 400);
  let date = String(body.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today();

  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await env.DB.prepare('SELECT doc, version FROM states WHERE user_id = ?').bind(userId).first();
    const doc = row ? JSON.parse(row.doc) : { transactions: [], goals: [], accounts: DEFAULT_POCKETS.map((p) => ({ ...p, kind: p.id === 'jago' || p.id === 'bca' ? 'bank' : 'ewallet', u: 1 })), categories: [], budgets: {}, budgetsU: 0, deleted: {} };
    const { cats, pockets } = lists(doc);

    const c = norm(body.category);
    const cat = cats.find((x) => x.type === type && c && (x.id === c || norm(x.label) === c || norm(x.short) === c))
      || cats.find((x) => x.type === type && c && (norm(x.label).startsWith(c) || c.startsWith(norm(x.short))))
      || { id: type === 'income' ? 'gift' : 'other', label: type === 'income' ? 'Gift & Other' : 'Other' };
    const pk = norm(body.pocket);
    const pocket = pockets.find((p) => pk && (p.id === pk || norm(p.name) === pk))
      || pockets.find((p) => pk && norm(p.name).includes(pk))
      || pockets.find((p) => p.id === 'bca') || pockets[0];

    const name = String(body.name || '').trim().slice(0, 80) || CATEGORIES[cat.id]?.label || cat.label;
    const tx = {
      id: uid(), type, cat: cat.id, amount: Math.round(amount), name, note: String(body.note || '').trim().slice(0, 200),
      date, method: type === 'income' ? 'Bank transfer' : 'Shortcut', recurring: false, account: pocket?.id || 'bca', u: Date.now()
    };
    doc.transactions = Array.isArray(doc.transactions) ? doc.transactions : [];
    doc.transactions.push(tx);
    const text = JSON.stringify(doc);
    const now = Date.now();
    const res = row
      ? await env.DB.prepare('UPDATE states SET doc = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?').bind(text, now, userId, row.version).run()
      : await env.DB.prepare('INSERT OR IGNORE INTO states (user_id, doc, version, updated_at) VALUES (?, ?, 1, ?)').bind(userId, text, now).run();
    if (res.meta.changes) {
      const label = CATEGORIES[cat.id]?.label || cat.label;
      return json({
        ok: true,
        message: `${type === 'income' ? 'Income' : 'Expense'} ${fmt(tx.amount)} · ${name} (${label}) → ${pocket?.name || 'BCA'}`,
        transaction: tx
      });
    }
  }
  return json({ error: 'Jon Pocket was busy saving. Try again.' }, 409);
}
