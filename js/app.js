// Jon Pocket — budget tracker web app (no framework, no build step).
import { load, save, emptyState, STORAGE_KEY, toDoc, mergeDocs, loadCloudMeta, saveCloudMeta } from './data.js';
import {
  idr, idrSigned, idrShort, parseAmount, groupDigits, isoDate, monthKey, monthLabel, shortMonth,
  shortDay, esc, uid
} from './format.js';
import { svg, CATEGORIES, catsOf, catTile, goalTile, GOAL_ICONS, GOAL_COLORS, CATEGORY_ICONS, CATEGORY_COLORS, isCustomCategory, setCustomCategories } from './icons.js';

let state = load();
setCustomCategories(state.categories);
save(state); // first visit: keep the demo data so ids stay stable
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

function commit(msg) {
  save(state);
  render();
  if (msg) toast(msg);
  schedulePush();
}
const stamp = () => Date.now();

/* =========================================================
   Derived numbers
   ========================================================= */
const now = () => new Date();
const DAY = 86400000;
/* ---------- Monthly cycle (e.g. payday on the 25th: 25 Oct – 24 Nov) ---------- */
const cycleDay = () => Math.min(28, Math.max(1, Number(state.cycleDay) || 25));
function cycleRange(d = now(), offset = 0) {
  const cd = cycleDay();
  let m = d.getMonth();
  if (d.getDate() < cd) m -= 1;
  const start = new Date(d.getFullYear(), m + offset, cd);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, cd - 1);
  return { start, end, startIso: isoDate(start), endIso: isoDate(end) };
}
const fmtDM = (x) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const cycleLabel = (r = cycleRange()) => `${fmtDM(r.start)} – ${fmtDM(r.end)}`;
let cycleCache = { key: '', r: null };
function currentCycle() {
  const key = isoDate(now()) + '|' + cycleDay();
  if (cycleCache.key !== key) cycleCache = { key, r: cycleRange() };
  return cycleCache.r;
}
const inMonth = (t) => { const r = currentCycle(); return t.date >= r.startIso && t.date <= r.endIso; };
const toDate = (iso) => new Date(iso + 'T00:00:00');

function totals(list) {
  let income = 0, expense = 0;
  for (const t of list) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount; // transfers between pockets are neither
  }
  return { income, expense, net: income - expense };
}
const monthTx = () => state.transactions.filter((t) => inMonth(t));
/* ---------- Pockets (bank accounts and e-wallets) ---------- */
const pockets = () => state.accounts || [];
const pocketById = (id) => pockets().find((p) => p.id === id);
// Transactions saved before pockets existed belong to BCA (or the first pocket)
const legacyPocket = () => (pocketById('bca') ? 'bca' : (pockets()[0]?.id || ''));
const pocketOf = (t) => (t.account && pocketById(t.account) ? t.account : legacyPocket());
const pocketName = (id) => pocketById(id)?.name || 'No pocket';
const newTxPocket = () => (pocketById(state.prefs.lastPocket) ? state.prefs.lastPocket : legacyPocket());
function pocketBalance(id) {
  const p = pocketById(id);
  let bal = p ? (p.opening || 0) : 0;
  for (const t of state.transactions) {
    if (t.type === 'transfer') {
      if (pocketOf(t) === id) bal -= t.amount;
      if (t.toAccount === id) bal += t.amount;
    } else if (pocketOf(t) === id) bal += t.type === 'income' ? t.amount : -t.amount;
  }
  return bal;
}
const balance = () => (state.openingBalance || 0) + pockets().reduce((s, p) => s + pocketBalance(p.id), 0);
const POCKET_KINDS = { bank: { label: 'Bank', long: 'Bank account', icon: 'bank' }, ewallet: { label: 'E-wallet', long: 'E-wallet', icon: 'wallet' }, cash: { label: 'Cash', long: 'Cash', icon: 'cash' } };
const kindOf = (p) => POCKET_KINDS[p?.kind] || POCKET_KINDS.bank;
const pocketIcon = (p, size = 40) => `<span class="pocket-icon" style="width:${size}px;height:${size}px;background:${p.color || '#5B4CF0'}">${svg(kindOf(p).icon)}</span>`;
// A goal can follow its pocket's balance, or keep its own saved amount
const goalTracksPocket = (g) => g.track === 'pocket' && !!pocketById(g.pocket);
const goalSaved = (g) => (goalTracksPocket(g) ? Math.max(0, pocketBalance(g.pocket)) : (g.saved || 0));
const goalsSaved = () => state.goals.reduce((s, g) => s + goalSaved(g), 0);
const goalPocketLine = (g) => (pocketById(g.pocket) ? `${goalTracksPocket(g) ? 'Follows' : 'In'} ${esc(pocketName(g.pocket))}` : '');

function spentByCat(list) {
  const m = {};
  for (const t of list) if (t.type === 'expense') m[t.cat] = (m[t.cat] || 0) + t.amount;
  return m;
}
function daysLeftInMonth() {
  return Math.round((currentCycle().end - toDate(isoDate(now()))) / DAY) + 1;
}
function monthsUntil(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = now();
  return Math.max(1, (y - d.getFullYear()) * 12 + (m - 1 - d.getMonth()));
}
const sortedTx = (list) => [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
const money = (n, short = false) => (state.prefs.hide ? 'Rp ••••••' : short ? idrShort(n) : idr(n));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function budgetSummary() {
  const spent = spentByCat(monthTx());
  const total = Object.values(state.budgets).reduce((a, b) => a + b, 0);
  const used = Object.keys(state.budgets).reduce((s, cat) => s + (spent[cat] || 0), 0);
  return { spent, total, used, left: total - used, p: pct(used, total) };
}

/* =========================================================
   Shared pieces
   ========================================================= */
function txRow(t) {
  if (t.type === 'transfer') {
    return `
    <div class="tx">
      ${catTile('transfer')}
      <div class="meta">
        <span class="name ellipsis">${esc(t.name)}</span>
        <span class="t-small ellipsis">${esc(pocketName(pocketOf(t)))} → ${esc(pocketName(t.toAccount))}</span>
        <button type="button" class="view" data-action="edit-tx" data-id="${t.id}">View Details</button>
      </div>
      <div class="amt">
        <b style="color:var(--ink-2)">${state.prefs.hide ? '••••' : idr(t.amount)}</b>
        <span class="t-small">${shortDay(t.date)}</span>
      </div>
    </div>`;
  }
  const c = CATEGORIES[t.cat] || CATEGORIES.other;
  const signed = t.type === 'income' ? t.amount : -t.amount;
  const method = t.method && t.method !== 'Recurring' ? t.method : '';
  return `
    <div class="tx">
      ${catTile(t.cat)}
      <div class="meta">
        <span class="name ellipsis">${esc(t.name)}</span>
        <span class="t-small ellipsis">${esc(pocketName(pocketOf(t)))}${method ? ' · ' + esc(method) : ''}${isRecurring(t) ? ' · <span style="color:var(--primary);font-weight:500">Recurring</span>' : ''}</span>
        <button type="button" class="view" data-action="edit-tx" data-id="${t.id}">View Details</button>
      </div>
      <div class="amt">
        <b class="${t.type === 'income' ? 'in' : ''}">${state.prefs.hide ? '••••' : idrSigned(signed).replace('−', '− ').replace('+', '+ ')}</b>
        <span class="t-small">${shortDay(t.date)}</span>
      </div>
    </div>`;
}
const txList = (list) => `<div class="list-card">${list.map(txRow).join('')}</div>`;

const textTabs = (items, action, current, label) => `
  <div class="text-tabs" role="group" aria-label="${label}">
    ${items.map(([v, l]) => `<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${v === current}">${l}</button>`).join('')}
  </div>`;
const seg = (items, action, current) => `
  <div class="segmented" role="group">
    ${items.map(([v, label]) => `<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${v === current}">${label}</button>`).join('')}
  </div>`;
const bar = (p, color, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.min(100, Math.max(0, p))}%;${color ? `background:${color}` : ''}"></i></div>`;

function ring(p, label) {
  const r = 36, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, p)) / 100);
  return `
    <div class="ring-wrap">
      <div class="ring" role="img" aria-label="${p}% used">
        <svg viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="${r}"/><circle class="val" cx="42" cy="42" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
        <b>${p}%</b>
      </div>
      ${label ? `<span class="t-small" style="color:#fff">${label}</span>` : ''}
    </div>`;
}

/* Smooth area chart (Catmull-Rom → Bézier) */
function areaChart(values, labels, highlightLabel) {
  const W = 320, H = 170, padL = 34, padB = 22, padT = 26;
  const max = Math.max(1, ...values) * 1.15;
  const step = (W - padL - 6) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [padL + i * step, padT + (H - padT - padB) * (1 - v / max)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const floor = H - padB;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const base = H - padB;
  const last = pts[pts.length - 1];
  const grid = [0, 0.5, 1].map((f) => {
    const y = padT + (H - padT - padB) * (1 - f);
    return `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" stroke="#EEEEF5"/><text x="0" y="${y + 3}">${idrShort((max / 1.15) * f).replace('Rp ', '')}</text>`;
  }).join('');
  const every = Math.ceil(labels.length / 7);
  const xl = labels.map((l, i) => (i % every === 0 || i === labels.length - 1)
    ? `<text x="${pts[i][0]}" y="${H - 4}" text-anchor="middle" ${i === labels.length - 1 ? 'style="fill:#1B1A2E;font-weight:600"' : ''}>${l}</text>` : '').join('');
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Spending chart">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5B4CF0" stop-opacity="0.45"/><stop offset="1" stop-color="#5B4CF0" stop-opacity="0.04"/></linearGradient></defs>
      ${grid}
      <path d="${d} L${last[0]},${base} L${pts[0][0]},${base} Z" fill="url(#ag)"/>
      <path d="${d}" fill="none" stroke="#5B4CF0" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${last[0]}" x2="${last[0]}" y1="${last[1]}" y2="${base}" stroke="#5B4CF0" stroke-dasharray="3 3" opacity="0.5"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="#fff" stroke="#5B4CF0" stroke-width="2.5"/>
      ${highlightLabel ? `<text x="${last[0] - 4}" y="${Math.max(12, last[1] - 12)}" text-anchor="end" style="fill:#1B1A2E;font-weight:600;font-size:10px">${highlightLabel}</text>` : ''}
      ${xl}
    </svg>`;
}


/* ---------- "Spent this month" slides: Budget · Pace · Categories ---------- */
let homeSlide = 0;
const SLIDE_NAMES = ['Budget', 'Spending pace', 'By category'];

function budgetSlide(b, noBudget, budgetMsg, topBudgets) {
  if (noBudget) {
    return `
      <button type="button" class="tile-btn" data-action="add-budget" style="background:var(--primary-50);border:0;width:100%">
        <span class="stack" style="gap:0"><span class="t-strong">Set a monthly budget</span><span class="t-small">See how much you can still spend</span></span>${svg('chev', 'class="chev"')}
      </button>`;
  }
  return `
    ${bar(b.p, b.p >= 100 ? 'var(--neg)' : b.p >= 90 ? '#F29E0C' : '')}
    <span class="t-small" style="color:${b.p >= 100 ? 'var(--neg)' : 'var(--ink-2)'}">${budgetMsg}</span>
    <div class="stack" style="gap:10px;padding-top:4px">
      ${topBudgets.map(([cat, limit]) => {
        const sp = b.spent[cat] || 0, p = pct(sp, limit), c = CATEGORIES[cat] || CATEGORIES.other;
        return `<div class="row" style="gap:10px">${catTile(cat, true)}<div class="grow stack" style="gap:5px">
          <div class="between"><span class="t-body" style="font-weight:500">${esc(c.short)}</span><span class="t-small" style="color:${p >= 90 ? 'var(--neg)' : 'var(--muted)'}">${idrShort(sp)} / ${idrShort(limit)}</span></div>
          ${bar(p, p >= 90 ? 'var(--neg)' : c.color, 'thin')}</div></div>`;
      }).join('')}
    </div>`;
}

function paceSlide(b, noBudget) {
  const r = currentCycle();
  const days = Math.round((r.end - r.start) / DAY) + 1;
  const todayIdx = Math.min(days - 1, Math.round((toDate(isoDate(now())) - r.start) / DAY));
  const daily = new Array(days).fill(0);
  for (const t of monthTx()) if (t.type === 'expense') {
    const i = Math.round((toDate(t.date) - r.start) / DAY);
    if (i >= 0 && i < days) daily[i] += t.amount;
  }
  const W = 300, H = 130, top = 14, bottom = 20, left = 2, right = 2;
  const x = (i) => left + (i / Math.max(1, days - 1)) * (W - left - right);
  const fmtTick = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const spentSoFar = daily.slice(0, todayIdx + 1).reduce((a, v) => a + v, 0);
  const avg = spentSoFar / (todayIdx + 1);

  if (noBudget) {
    // Daily bars with an average line
    const max = Math.max(1, ...daily) * 1.15;
    const y = (v) => top + (H - top - bottom) * (1 - v / max);
    const bw = Math.max(2, (W - left - right) / days - 2);
    const peak = daily.indexOf(Math.max(...daily));
    return `
      <svg viewBox="0 0 ${W} ${H}" class="mini-chart" role="img" aria-label="Spending per day this month">
        ${daily.map((v, i) => i <= todayIdx ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - bottom - y(v)).toFixed(1)}" rx="2" fill="${i === todayIdx ? 'var(--primary)' : 'var(--primary-100)'}"/>` : '').join('')}
        ${avg > 0 ? `<line x1="${left}" x2="${W - right}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" stroke="#F29E0C" stroke-dasharray="4 4" stroke-width="1.5"/>` : ''}
        <text x="${left}" y="${H - 4}" class="tick">${fmtTick(r.start)}</text>
        <text x="${W - right}" y="${H - 4}" class="tick" text-anchor="end">${fmtTick(r.end)}</text>
      </svg>
      <div class="legend-row"><span><i class="key" style="background:#F29E0C"></i>Average ${money(avg, true)}/day</span>
        ${Math.max(...daily) > 0 ? `<span>Highest ${money(daily[peak], true)} · ${fmtTick(new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate() + peak))}</span>` : ''}</div>`;
  }

  // Cumulative spending vs an even budget pace
  const cum = []; let run = 0;
  for (let i = 0; i <= todayIdx; i++) { run += daily[i]; cum.push(run); }
  const max = Math.max(b.total, run) * 1.1 || 1;
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const line = cum.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const pace = b.total * ((todayIdx + 1) / days);
  const diff = run - pace;
  const ahead = diff > 0;
  return `
    <svg viewBox="0 0 ${W} ${H}" class="mini-chart" role="img" aria-label="Spending so far compared with your budget pace">
      <line x1="${left}" x2="${W - right}" y1="${y(b.total).toFixed(1)}" y2="${y(b.total).toFixed(1)}" stroke="var(--line-strong)" stroke-width="1"/>
      <text x="${W - right}" y="${(y(b.total) - 4).toFixed(1)}" class="tick" text-anchor="end">Budget ${money(b.total, true)}</text>
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(days - 1)}" y2="${y(b.total).toFixed(1)}" stroke="#A3A3B8" stroke-dasharray="4 4" stroke-width="1.5"/>
      <path d="${line} L${x(todayIdx).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z" fill="var(--primary)" opacity="0.12"/>
      <path d="${line}" fill="none" stroke="${ahead ? 'var(--neg)' : 'var(--primary)'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(todayIdx).toFixed(1)}" cy="${y(run).toFixed(1)}" r="4.5" fill="#fff" stroke="${ahead ? 'var(--neg)' : 'var(--primary)'}" stroke-width="2.5"/>
      <text x="${left}" y="${H - 4}" class="tick">${fmtTick(r.start)}</text>
      <text x="${W - right}" y="${H - 4}" class="tick" text-anchor="end">${fmtTick(r.end)}</text>
    </svg>
    <div class="legend-row"><span><i class="key" style="background:${ahead ? 'var(--neg)' : 'var(--primary)'}"></i>Spent so far</span><span><i class="key dashed"></i>Even pace</span></div>
    <span class="t-small" style="color:${ahead ? 'var(--neg)' : 'var(--ink-2)'}">${run === 0 ? 'No spending yet this month.'
      : ahead ? `${money(diff)} ahead of pace. Slow down to ${money(Math.max(0, b.total - run) / Math.max(1, days - todayIdx - 1), true)}/day to stay on budget.`
      : `${money(-diff)} under pace. Average so far ${money(avg, true)}/day.`}</span>`;
}

function categorySlide() {
  const by = Object.entries(spentByCat(monthTx())).sort((a, z) => z[1] - a[1]);
  const total = by.reduce((a, [, v]) => a + v, 0);
  if (!total) return '<p class="empty" style="padding:28px 0">No spending yet this month.</p>';
  const top = by.slice(0, 4);
  const rest = by.slice(4).reduce((a, [, v]) => a + v, 0);
  const parts = rest ? [...top, ['__rest', rest]] : top;
  const R = 46, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = parts.map(([cat, v]) => {
    const len = (v / total) * C;
    const color = cat === '__rest' ? '#D8D8E4' : (CATEGORIES[cat]?.color || '#A3A3B8');
    const a = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${(C - Math.max(0, len - 1.5)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += len;
    return a;
  }).join('');
  const biggest = monthTx().filter((t) => t.type === 'expense').sort((a, z) => z.amount - a.amount)[0];
  return `
    <div class="row" style="gap:16px;align-items:center">
      <svg viewBox="0 0 120 120" class="donut" role="img" aria-label="Spending by category">
        <g transform="rotate(-90 60 60)">${arcs}</g>
        <text x="60" y="57" text-anchor="middle" class="donut-label">Total</text>
        <text x="60" y="73" text-anchor="middle" class="donut-value">${state.prefs.hide ? '••••' : idrShort(total).replace('Rp ', '')}</text>
      </svg>
      <div class="grow stack" style="gap:8px">
        ${parts.map(([cat, v]) => `<div class="between" style="gap:6px"><span class="row t-small" style="gap:6px;color:var(--ink-2);min-width:0"><i class="key" style="background:${cat === '__rest' ? '#D8D8E4' : (CATEGORIES[cat]?.color || '#A3A3B8')}"></i><span class="ellipsis">${cat === '__rest' ? 'Others' : esc(CATEGORIES[cat]?.short || cat)}</span></span><span class="t-small" style="font-weight:600;color:var(--ink)">${pct(v, total)}%</span></div>`).join('')}
      </div>
    </div>
    ${biggest ? `<span class="t-small" style="color:var(--ink-2)">Biggest expense: <b>${esc(biggest.name)}</b> · ${money(biggest.amount)}</span>` : ''}`;
}

function spentSlides(m, b, noBudget, budgetMsg, topBudgets) {
  const slides = [budgetSlide(b, noBudget, budgetMsg, topBudgets), paceSlide(b, noBudget), categorySlide()];
  const names = noBudget ? ['Budget', 'Daily spending', 'By category'] : SLIDE_NAMES;
  return `
    <div class="slides" id="spent-slides" aria-roledescription="carousel" aria-label="Spending details">
      ${slides.map((html, i) => `<div class="slide stack" role="group" aria-roledescription="slide" aria-label="${names[i]} (${i + 1} of 3)" style="gap:10px">
        <span class="slide-title">${names[i]}</span>${html}</div>`).join('')}
    </div>
    <div class="dots" role="tablist" aria-label="Choose a slide">
      ${names.map((n, i) => `<button type="button" class="dot" role="tab" data-action="spent-slide" data-value="${i}" aria-label="${n}" aria-selected="${i === homeSlide}"></button>`).join('')}
    </div>`;
}

function fitSlides(i) {
  const el = $('#spent-slides');
  const slide = el?.children[i];
  if (slide) el.style.height = slide.offsetHeight + 'px';
}
function initSlides() {
  const el = $('#spent-slides');
  if (!el) return;
  el.scrollLeft = homeSlide * el.clientWidth;
  fitSlides(homeSlide);
  let t;
  el.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      fitSlides(i);
      if (i !== homeSlide) {
        homeSlide = i;
        document.querySelectorAll('[data-action="spent-slide"]').forEach((d) => d.setAttribute('aria-selected', String(Number(d.dataset.value) === i)));
      }
    }, 60);
  }, { passive: true });
}

/* =========================================================
   Pages
   ========================================================= */
const TX_FILTERS = [
  ['all', 'All', 'grid'], ['income', 'Income', 'income'], ['recurring', 'Recurring', 'repeat'], ['food', 'Food', 'food'], ['transport', 'Transport', 'transport'],
  ['shopping', 'Shopping', 'shopping'], ['bills', 'Bills', 'bills'], ['health', 'Health', 'health'], ['fun', 'Fun', 'fun']
];
// Built-in filters, then your own categories, then Other
const txFilters = () => [...TX_FILTERS, ...(state.categories || []).filter((c) => CATEGORIES[c.id]).map((c) => [c.id, CATEGORIES[c.id].short, CATEGORIES[c.id].icon]), ['other', 'Other', 'other']];
const isRecurring = (t) => !!t.recurring || t.method === 'Recurring';

const PAGES = {
  home() {
    const m = totals(monthTx());
    const b = budgetSummary();
    const recent = sortedTx(state.transactions).slice(0, 5);
    const monthName = now().toLocaleDateString('en-GB', { month: 'long' });
    const noBudget = b.total === 0;
    const budgetMsg = b.p < 75 ? `You're doing great: ${idr(b.left)} left, about ${idrShort(Math.max(0, b.left) / daysLeftInMonth())} a day.`
      : b.p < 100 ? `Heads up: only ${idr(b.left)} left for ${daysLeftInMonth()} days.`
      : `Over budget by ${idr(-b.left)} this month.`;
    const topBudgets = Object.entries(state.budgets).sort((x, y) => pct(b.spent[y[0]] || 0, y[1]) - pct(b.spent[x[0]] || 0, x[1])).slice(0, 3);
    const isNew = !state.transactions.length;
    const steps = [
      { done: pockets().some((p) => (p.u || 0) > 0), title: 'Set your pocket balances', sub: 'How much is in Jago, BCA, GoPay and OVO now', action: 'manage-pockets' },
      { done: state.transactions.some((t) => t.type === 'income'), title: 'Add your income', sub: 'Salary, freelance or any money in', action: 'open-income' },
      { done: !noBudget, title: 'Set a monthly budget', sub: 'Choose limits for food, transport and more', action: 'add-budget' },
      { done: state.goals.length > 0, title: 'Create a savings goal', sub: 'An emergency fund is a good first goal', action: 'add-goal' }
    ];
    const showSteps = steps.some((s) => !s.done);

    return {
      header: 'welcome',
      html: `
      ${showSteps ? `
      <section class="card lg stack" aria-label="Get started" style="gap:12px">
        <div class="stack" style="gap:2px"><span class="t-h3">Get started</span><span class="t-label">${steps.filter((s) => s.done).length} of ${steps.length} done</span></div>
        ${steps.map((s, i) => `
          <button type="button" class="row" data-action="${s.action}" ${s.done ? 'disabled' : ''} style="border:0;background:none;padding:6px 0;text-align:left;width:100%;color:var(--ink);opacity:${s.done ? 0.55 : 1}">
            <span style="width:32px;height:32px;border-radius:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;${s.done ? 'background:#E3F6EC;color:var(--pos)' : 'background:var(--primary-50);color:var(--primary)'}">${s.done ? '✓' : i + 1}</span>
            <span class="grow stack" style="gap:0"><span class="t-strong" style="${s.done ? 'text-decoration:line-through' : ''}">${s.title}</span><span class="t-small">${s.sub}</span></span>
            ${s.done ? '' : svg('chev', 'style="width:16px;height:16px;fill:none;stroke:#A3A3B8;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"')}
          </button>`).join('')}
      </section>` : ''}

      ${cloud.available && !cloud.email ? `
      <button type="button" class="tile-btn" data-action="open-auth" style="width:100%">
        <span class="row" style="gap:12px"><span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('shield')}</span>
          <span class="stack" style="gap:0"><span class="t-strong">Back up your data</span><span class="t-small">Sign in to sync across your devices</span></span></span>
        ${svg('chev', 'class="chev"')}
      </button>` : ''}

      <section class="hero" aria-label="Balance">
        <div class="stack" style="gap:4px">
          <span class="t-label">Total balance</span>
          <span class="t-display" style="font-size:34px">${money(balance())}</span>
          <span class="t-small">${cycleLabel()} · ${m.net >= 0 ? 'saved' : 'overspent'} ${money(Math.abs(m.net), true)}</span>
        </div>
        <div class="grid-2" style="gap:10px">
          <div class="glass"><span class="t-small row" style="gap:6px">${svg('up', 'style="width:14px;height:14px;fill:none;stroke:#C8F7D9;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"')}Income</span><b style="font-size:16px">${money(m.income)}</b></div>
          <div class="glass"><span class="t-small row" style="gap:6px">${svg('down', 'style="width:14px;height:14px;fill:none;stroke:#FFC9CF;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"')}Expenses</span><b style="font-size:16px">${money(m.expense)}</b></div>
        </div>
      </section>

      <div class="section-head"><h2>Pockets</h2><button type="button" class="see-all" data-action="manage-pockets">Manage</button></div>
      <div class="pocket-row" role="list">
        ${pockets().map((p) => `
          <button type="button" class="pocket-card" role="listitem" data-action="open-pocket" data-id="${p.id}">
            ${pocketIcon(p, 36)}
            <span class="t-small ellipsis" style="color:var(--ink-2)">${esc(p.name)}</span>
            <b class="ellipsis">${money(pocketBalance(p.id), true)}</b>
          </button>`).join('')}
        <button type="button" class="pocket-card add" data-action="add-pocket">
          <span class="pocket-icon" style="width:36px;height:36px;background:var(--primary-50);color:var(--primary)">${svg('plus')}</span>
          <span class="t-small" style="color:var(--primary);font-weight:600">Add pocket</span>
        </button>
      </div>

      <section class="card lg stack" aria-label="Spent this month" style="gap:12px;overflow:hidden">
        <div class="between"><span class="stack" style="gap:0"><span class="t-h3">Spent this month</span><span class="t-small">${cycleLabel()} · ${daysLeftInMonth()} day${daysLeftInMonth() === 1 ? '' : 's'} left</span></span><a class="see-all" href="#/plan/budgets">Budgets</a></div>
        <div class="between" style="align-items:flex-end">
          <span class="t-stat">${money(m.expense)}</span>
          ${noBudget ? '' : `<span class="t-label">${b.p}% of budget</span>`}
        </div>
        ${spentSlides(m, b, noBudget, budgetMsg, topBudgets)}
      </section>

      <section class="card lg stack" aria-label="Goals" style="gap:12px">
        <div class="between"><span class="t-h3">Goals</span><a class="see-all" href="#/plan/goals">${state.goals.length ? 'See all' : ''}</a></div>
        ${state.goals.length ? state.goals.slice(0, 3).map((g) => {
          const p = pct(goalSaved(g), g.target);
          return `<button type="button" class="row" data-action="edit-goal" data-id="${g.id}" style="gap:10px;border:0;background:none;padding:0;text-align:left;width:100%;color:var(--ink)">
            ${goalTile(g.icon, g.color)}
            <span class="grow stack" style="gap:5px">
              <span class="between"><span class="t-body ellipsis" style="font-weight:500">${esc(g.name)}</span><span class="t-small">${p}%</span></span>
              ${bar(p, g.color, 'thin')}
              <span class="t-small">${money(goalSaved(g), true)} of ${idrShort(g.target)}${pocketById(g.pocket) ? ` · ${goalPocketLine(g)}` : ''}</span>
            </span>
          </button>`;
        }).join('') : `
          <button type="button" class="tile-btn" data-action="add-goal" style="background:var(--primary-50);border:0">
            <span class="stack" style="gap:0"><span class="t-strong">Create a savings goal</span><span class="t-small">An emergency fund is a good first goal</span></span>${svg('chev', 'class="chev"')}
          </button>`}
      </section>

      <div class="section-head"><h2>Recent</h2>${isNew ? '' : '<a class="see-all" href="#/activity">See All</a>'}</div>
      ${recent.length ? txList(recent) : `<div class="list-card"><p class="empty">No transactions yet.<br>Tap the <b style="color:var(--primary)">+</b> button below to add your first one.</p></div>`}
      `
    };
  },

  activity() {
    const f = state.prefs.catFilter;
    return {
      header: 'title', title: 'Transactions', action: 'data',
      html: `
      <div class="search-row">
        <label class="search">${svg('search')}<span class="sr-only">Search transactions</span>
          <input type="search" id="tx-search" placeholder="Search for transactions" autocomplete="off" value="${esc(activitySearch)}">
        </label>
        <button type="button" class="icon-btn soft" data-action="data-menu" aria-label="Data options">${svg('sliders')}</button>
      </div>
      ${textTabs([['all', 'All pockets'], ...pockets().map((p) => [p.id, p.name])], 'pocket-filter-here', pocketById(state.prefs.pocketFilter) ? state.prefs.pocketFilter : 'all', 'Filter by pocket')}
      <div class="cat-grid five" role="group" aria-label="Filter by category">
        ${txFilters().map(([id, label, icon]) => `
          <button type="button" class="cat-btn" data-action="cat-filter-here" data-value="${id}" aria-pressed="${id === f}">
            <span class="circle">${svg(icon)}</span><span class="ellipsis" style="max-width:100%">${esc(label)}</span>
          </button>`).join('')}
        <button type="button" class="cat-btn add" data-action="manage-categories">
          <span class="circle">${svg('plus')}</span>Add
        </button>
      </div>
      <div class="stack" id="tx-list" style="gap:18px">${activityList()}</div>`
    };
  },

  stats() {
    const period = state.prefs.period;
    const d = now();
    let values = [], labels = [], from, to = d, rangeLabel = '';
    const exp = (a, b) => state.transactions.filter((t) => t.type === 'expense' && toDate(t.date) >= a && toDate(t.date) <= b).reduce((s, t) => s + t.amount, 0);
    const today0 = toDate(isoDate(d));
    if (period === 'weekly') {
      from = new Date(today0 - 6 * DAY);
      for (let i = 0; i < 7; i++) { const day = new Date(from.getTime() + i * DAY); values.push(exp(day, day)); labels.push(day.toLocaleDateString('en-GB', { weekday: 'short' })); }
      rangeLabel = `${from.toLocaleDateString('en-GB', { day: 'numeric' })} – ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    } else if (period === 'monthly') {
      from = currentCycle().start;
      for (let day = new Date(from); day <= today0; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) { values.push(exp(day, day)); labels.push(String(day.getDate())); }
      if (values.length === 1) { values.unshift(0); labels.unshift(''); }
      rangeLabel = cycleLabel();
    } else {
      const first = cycleRange(d, -11);
      from = first.start;
      for (let i = -11; i <= 0; i++) {
        const r = cycleRange(d, i);
        values.push(exp(r.start, r.end)); labels.push(r.start.toLocaleDateString('en-GB', { month: 'short' }));
      }
      rangeLabel = `${fmtDM(first.start)} ${first.start.getFullYear()} – ${fmtDM(currentCycle().end)} ${currentCycle().end.getFullYear()}`;
    }
    const inRange = state.transactions.filter((t) => toDate(t.date) >= from && toDate(t.date) <= to);
    const tt = totals(inRange);
    const weekTx = state.transactions.filter((t) => toDate(t.date) > new Date(today0 - 7 * DAY));
    const weekSaved = totals(weekTx).net;
    const showBanner = weekTx.length > 0 && state.prefs.bannerHiddenOn !== isoDate(d);
    const hasData = values.some((v) => v > 0);

    const tab = state.prefs.statsTab;
    let listHtml;
    if (tab === 'categories') {
      const rows = Object.entries(spentByCat(inRange)).sort((a, b) => b[1] - a[1]);
      const max = rows.length ? rows[0][1] : 1;
      listHtml = rows.length ? `<div class="list-card">${rows.map(([cat, v]) => `
        <div class="tx">
          ${catTile(cat)}
          <div class="meta" style="gap:6px"><div class="between"><span class="name">${esc(CATEGORIES[cat]?.label || cat)}</span><b style="font-size:14px">${money(v)}</b></div>${bar(pct(v, max), CATEGORIES[cat]?.color, 'thin')}</div>
        </div>`).join('')}</div>` : '<p class="empty">No spending in this period.</p>';
    } else {
      const type = tab === 'top-income' ? 'income' : 'expense';
      const top = inRange.filter((t) => t.type === type).sort((a, b) => b.amount - a.amount).slice(0, 6);
      listHtml = top.length ? txList(top) : `<p class="empty">No ${type} in this period.</p>`;
    }

    return {
      header: 'title', title: 'Statistics', action: 'calendar',
      html: `
      ${showBanner ? `
      <div class="banner">
        <span class="art">${svg('piggy')}</span>
        <p>${weekSaved >= 0 ? `You have saved <b>${money(weekSaved)}</b> this week` : `You spent <b>${money(-weekSaved)}</b> more than you earned this week`}</p>
        <button type="button" class="x" data-action="hide-banner" aria-label="Dismiss">${svg('close')}</button>
      </div>` : ''}
      ${textTabs([['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']], 'set-period', period, 'Period')}
      <span class="t-label" style="margin-top:-8px">${rangeLabel}</span>
      <div class="card lg" style="padding:16px 14px 14px">
        ${hasData ? areaChart(values, labels, state.prefs.hide ? '' : idrShort(values[values.length - 1]))
          : `<div class="empty" style="height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
               <span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('invest')}</span>
               No spending in this period yet.<br>Your chart appears once you add expenses.
             </div>`}
        <div class="legend-row">
          <span>Income : <b class="pos">${state.prefs.hide ? '••••' : '+' + idrShort(tt.income)}</b></span>
          <span>Expense : <b class="neg">${state.prefs.hide ? '••••' : '−' + idrShort(tt.expense)}</b></span>
        </div>
      </div>
      ${textTabs([['categories', 'Categories'], ['top-spending', 'Top Spending'], ['top-income', 'Top Income']], 'set-stats-tab', tab, 'Breakdown')}
      ${listHtml}`
    };
  },

  plan() {
    const tab = state.prefs.planTab;
    const inner = tab === 'goals' ? planGoals() : tab === 'portfolio' ? planPortfolio() : planBudgets();
    return {
      header: 'title', title: tab === 'goals' ? 'Goals' : tab === 'portfolio' ? 'Portfolio' : 'Budgets',
      action: tab === 'goals' ? 'add-goal' : tab === 'budgets' ? 'add-budget' : 'bell',
      html: `${textTabs([['budgets', 'Budgets'], ['goals', 'Goals'], ['portfolio', 'Portfolio']], 'set-plan-tab', tab, 'Plan section')}${inner}`
    };
  }
};

// Compares what you've planned to spend (all budgets) with what came in this month
function budgetVsIncome(b) {
  const m = totals(monthTx());
  const income = m.income, allocated = b.total, spent = m.expense;
  const top = Math.max(income, allocated, spent, 1);
  const row = (label, value, color, note = '') => `
    <div class="stack" style="gap:6px">
      <div class="between"><span class="t-small" style="color:var(--ink-2)">${label}</span><b style="font-size:14px">${money(value)}</b></div>
      ${bar(value / top * 100, color)}
      ${note ? `<span class="t-small">${note}</span>` : ''}
    </div>`;
  const gap = income - allocated;
  const share = income ? Math.round(allocated / income * 100) : 0;
  let verdict;
  if (!income && !allocated) verdict = 'Add your income and budgets to see how they compare.';
  else if (!income) verdict = `No income recorded since ${fmtDM(currentCycle().start)} yet.`;
  else if (gap >= 0) verdict = `<b class="pos">${money(gap)}</b> of your income isn't budgeted yet — room for savings or goals.`;
  else verdict = `Budgets are <b class="neg">${money(-gap)}</b> more than your income this month.`;
  return `
    <section class="card stack" style="gap:14px" aria-label="Budget vs income">
      <div class="between">
        <div class="stack" style="gap:0"><h2 style="font-size:16px">Budget vs income</h2><span class="t-small">${cycleLabel()}</span></div>
        ${income ? `<span class="pill" style="pointer-events:none;min-height:30px;padding:4px 12px;font-weight:600;${share > 100 ? 'color:var(--neg)' : ''}">${share}% budgeted</span>` : ''}
      </div>
      ${row('Income this month', income, 'var(--pos)')}
      ${row('Total budget allocated', allocated, 'var(--primary)', `${Object.keys(state.budgets).length} categor${Object.keys(state.budgets).length === 1 ? 'y' : 'ies'}`)}
      ${row('Spent so far', spent, spent > income && income ? 'var(--neg)' : '#F29E0C', b.total ? `${money(b.used)} of it in budgeted categories` : '')}
      <p class="t-small" style="color:var(--ink-2);border-top:1px solid var(--line);padding-top:12px">${verdict}</p>
    </section>`;
}

function planBudgets() {
  const b = budgetSummary();
  const perDay = Math.max(0, b.left) / daysLeftInMonth();
  const recurring = new Set(state.transactions.filter((t) => t.type === 'expense' && isRecurring(t)).map((t) => t.name.toLowerCase())).size;
  return `
    <section class="hero">
      <div class="between">
        <div class="stack" style="gap:2px">
          <span class="t-label">Left to spend</span>
          <span class="t-display">${money(b.left)}</span>
          <span class="t-small">${money(b.used)} spent of ${money(b.total)}</span>
        </div>
        ${ring(b.p, `${daysLeftInMonth()} days left`)}
      </div>
      <div class="glass"><span class="t-small">Daily allowance until ${fmtDM(currentCycle().end)}</span><b style="font-size:16px">${money(perDay)}/day</b></div>
    </section>

    ${budgetVsIncome(b)}

    <button type="button" class="tile-btn" data-action="payments">
      <span class="row" style="gap:12px">${catTile('bills')}<span class="stack" style="gap:0"><span class="t-strong">Recurring payments</span><span class="t-small">${recurring ? `${recurring} marked` : 'Mark rent, bills and subscriptions'}</span></span></span>
      ${svg('chev', 'class="chev"')}
    </button>

    <div class="section-head"><h2>Categories</h2></div>
    <div class="list-card">
      ${Object.keys(state.budgets).length ? '' : '<p class="empty">No budgets yet.<br>Add one for each category you want to keep an eye on.</p>'}
      ${Object.entries(state.budgets).map(([cat, limit]) => {
        const s = b.spent[cat] || 0, p = pct(s, limit), warn = p >= 90, c = CATEGORIES[cat] || CATEGORIES.other;
        return `
        <div class="tx" style="align-items:flex-start">
          ${catTile(cat)}
          <div class="meta" style="gap:6px">
            <div class="between"><span class="name">${esc(c.label)}</span><b style="font-size:14px;color:${warn ? 'var(--neg)' : 'var(--ink)'}">${p}%</b></div>
            ${bar(p, warn ? 'var(--neg)' : c.color)}
            <div class="between"><span class="t-small">${idr(s)} of ${idr(limit)}</span><span class="t-small" style="color:${warn ? 'var(--neg)' : 'var(--muted)'};font-weight:${warn ? 600 : 400}">${s > limit ? `Over ${idrShort(s - limit)}` : `${idrShort(limit - s)} left`}</span></div>
            <button type="button" class="view" data-action="edit-budget" data-id="${cat}">Edit budget</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <button type="button" class="dashed-btn" data-action="add-budget">+ Add a budget</button>`;
}

function planGoals() {
  const m = totals(monthTx());
  const income = m.income;
  let needs = 0, wants = 0;
  for (const [cat, v] of Object.entries(spentByCat(monthTx()))) (CATEGORIES[cat]?.group === 'needs' ? (needs += v) : (wants += v));
  const plan = [
    { name: 'Needs', share: 0.5, actual: needs, color: 'var(--primary)', saving: false },
    { name: 'Wants', share: 0.3, actual: wants, color: '#F7B731', saving: false },
    { name: 'Savings', share: 0.2, actual: income - needs - wants, color: '#1FAA6B', saving: true }
  ];
  const monthly = state.prefs.monthly;
  const fv = (y) => { const r = 0.06 / 12, n = y * 12; return monthly * ((Math.pow(1 + r, n) - 1) / r); };

  return `
    <section class="hero" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
      <div class="glass"><span class="t-small">Total saved</span><span class="t-stat">${money(goalsSaved(), true)}</span></div>
      <div class="glass"><span class="t-small">Saved this month</span><span class="t-stat soft-pos">${money(Math.max(0, m.net), true)}</span></div>
    </section>

    <div class="list-card">
      ${state.goals.length ? state.goals.map((g) => {
        const saved = goalSaved(g);
        const p = pct(saved, g.target);
        const per = Math.ceil(Math.max(0, g.target - saved) / monthsUntil(g.due) / 10000) * 10000;
        const due = shortMonth(new Date(g.due + '-01T00:00:00'));
        return `
        <div class="tx" style="align-items:flex-start">
          ${goalTile(g.icon, g.color)}
          <div class="meta" style="gap:6px">
            <div class="between"><span class="name ellipsis">${esc(g.name)}</span><b style="font-size:14px">${money(saved, true)}</b></div>
            ${g.members?.length ? `<span class="row" style="gap:6px"><span class="avatars">${g.members.map((mb) => `<span style="background:${mb.bg}">${esc(mb.i)}</span>`).join('')}</span><span class="t-small">${g.members.length} members · by ${due}</span></span>`
              : `<span class="t-small">By ${due} · of ${idrShort(g.target)}</span>`}
            ${pocketById(g.pocket) ? `<span class="row" style="gap:6px">${pocketIcon(pocketById(g.pocket), 20)}<span class="t-small">${goalPocketLine(g)}</span></span>` : ''}
            ${bar(p, g.color)}
            <div class="between"><button type="button" class="view" data-action="edit-goal" data-id="${g.id}">${goalTracksPocket(g) ? 'Open' : 'Add money'}</button><span class="t-small">${p >= 100 ? 'Goal reached' : `Save ${idrShort(per)}/mo · ${p}%`}</span></div>
          </div>
        </div>`;
      }).join('') : '<p class="empty">No goals yet.</p>'}
    </div>
    <button type="button" class="dashed-btn" data-action="add-goal">+ New goal</button>

    <div class="card lg stack">
      <div class="stack" style="gap:2px"><span class="between"><span class="t-h3">50/30/20 check</span><button type="button" class="see-all" data-action="lesson" style="color:var(--primary)">What is this?</button></span><span class="t-label">Based on ${idr(income)} income this month</span></div>
      ${income ? plan.map((p) => {
        const target = income * p.share, diff = p.actual - target;
        const good = p.saving ? diff >= 0 : diff <= 0;
        const status = p.saving ? (diff >= 0 ? `Ahead by ${idr(diff)}` : `Short by ${idr(-diff)}`) : (diff > 0 ? `Over by ${idr(diff)}` : `Under by ${idr(-diff)}`);
        return `
        <div class="stack" style="gap:6px">
          <div class="between t-body"><span style="font-weight:600">${p.name} <span style="color:var(--muted);font-weight:400">· ${p.share * 100}%</span></span><span style="font-weight:600">${idr(p.actual)}</span></div>
          ${bar(pct(Math.max(0, p.actual), target), p.color)}
          <div class="between t-small"><span>Plan ${idr(target)}</span><span style="font-weight:600;color:${good ? 'var(--pos)' : 'var(--neg)'}">${status}</span></div>
        </div>`;
      }).join('') : '<p class="empty">Add this month’s income to see your split.</p>'}
    </div>

    <div class="card lg stack">
      <div class="stack" style="gap:2px"><span class="t-h3">Savings calculator</span><span class="t-label">If you invest monthly at 6% a year</span></div>
      <div class="pills" role="group" aria-label="Monthly amount">
        ${[1000000, 2000000, 3000000, 5000000].map((v) => `<button type="button" class="pill" data-action="set-monthly" data-value="${v}" aria-pressed="${v === monthly}">${idrShort(v)}/mo</button>`).join('')}
      </div>
      <div class="grid-2" style="gap:10px">
        ${[5, 10, 20, 30].map((y) => `<div class="stack" style="gap:2px;background:var(--primary-50);border-radius:14px;padding:12px 14px"><span class="t-small">In ${y} years</span><span class="t-h3" style="font-weight:700;color:var(--primary-700)">${idrShort(fv(y))}</span></div>`).join('')}
      </div>
    </div>`;
}

function planPortfolio() {
  return `
    <section class="hero" style="gap:4px">
      <span class="t-label">Portfolio value</span>
      <span class="t-display">${money(0)}</span>
      <span class="t-small">Stocks and crypto</span>
    </section>
    <div class="card lg stack" style="align-items:center;text-align:center;gap:10px;padding:28px 20px">
      <span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('invest')}</span>
      <span class="t-h3">No investments yet</span>
      <span class="t-body" style="color:var(--muted);max-width:30ch">Tracking stocks and crypto with live prices is coming in a later update.</span>
    </div>`;
}

/* Transactions list is rendered separately so typing in search keeps focus. */
let activitySearch = '';
function matchesPocket(t) {
  const pf = state.prefs.pocketFilter;
  if (!pf || pf === 'all' || !pocketById(pf)) return true;
  return pocketOf(t) === pf || (t.type === 'transfer' && t.toAccount === pf);
}
function matchesFilter(t, f) {
  if (!matchesPocket(t)) return false;
  if (f === 'all') return true;
  if (f === 'income') return t.type === 'income';
  if (t.type === 'transfer') return false;
  if (f === 'recurring') return isRecurring(t);
  return t.cat === f;
}
function activityList() {
  const q = activitySearch.trim().toLowerCase();
  const f = state.prefs.catFilter;
  const list = sortedTx(state.transactions).filter((t) => matchesFilter(t, f) &&
    (!q || t.name.toLowerCase().includes(q) || (CATEGORIES[t.cat]?.label || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)));
  if (!list.length) return `<p class="empty">${q ? 'No transactions match your search.' : 'Nothing here yet. Tap + to add a transaction.'}</p>`;
  const groups = [];
  for (const t of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t); else groups.push({ date: t.date, items: [t] });
  }
  return groups.map((g) => {
    const label = shortDay(g.date);
    const pretty = toDate(g.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `<h3 class="day-head">${label}${label === pretty ? '' : `<small>${pretty}</small>`}</h3>${txList(g.items)}`;
  }).join('');
}

/* =========================================================
   App bar
   ========================================================= */
function notifications() {
  const out = [];
  const spent = spentByCat(monthTx());
  for (const [cat, limit] of Object.entries(state.budgets)) {
    const p = pct(spent[cat] || 0, limit);
    if (p >= 100) out.push({ icon: cat, text: `${CATEGORIES[cat].label} is over budget (${p}%).` });
    else if (p >= 90) out.push({ icon: cat, text: `${CATEGORIES[cat].label} is at ${p}% of its budget.` });
  }
  for (const g of state.goals) {
    const m = monthsUntil(g.due);
    if (goalSaved(g) < g.target && m <= 3) out.push({ goal: g, text: `${g.name}: ${idr(g.target - goalSaved(g))} to go, due in ${m} month${m === 1 ? '' : 's'}.` });
  }
  return out;
}

function actionButton(kind) {
  const alerts = notifications().length;
  switch (kind) {
    case 'bell': return `<button type="button" class="icon-btn" data-action="notifications" aria-label="Notifications${alerts ? ` (${alerts})` : ''}">${svg('bell')}${alerts ? '<span class="badge"></span>' : ''}</button>`;
    case 'data': return `<button type="button" class="icon-btn" data-action="toggle-hide" aria-label="${state.prefs.hide ? 'Show' : 'Hide'} amounts">${svg(state.prefs.hide ? 'eyeOff' : 'eye')}</button>`;
    case 'calendar': return `<button type="button" class="icon-btn" data-action="toggle-hide" aria-label="${state.prefs.hide ? 'Show' : 'Hide'} amounts">${svg(state.prefs.hide ? 'eyeOff' : 'eye')}</button>`;
    case 'add-budget': return `<button type="button" class="icon-btn soft" data-action="add-budget" aria-label="Add budget">${svg('plus')}</button>`;
    case 'add-goal': return `<button type="button" class="icon-btn soft" data-action="add-goal" aria-label="Add goal">${svg('plus')}</button>`;
    default: return '';
  }
}

function appbarHtml(page) {
  if (page.header === 'welcome') {
    return `
      <button type="button" class="avatar" data-action="data-menu" aria-label="Account and data" style="cursor:pointer"><span class="logo-n">n</span><span class="logo-dot"></span></button>
      <div class="appbar-title">${state.prefs.name
        ? `<span class="hello">Welcome back</span><h1>${esc(state.prefs.name)}</h1>`
        : `<span class="hello">Welcome to</span><h1>Jon Pocket</h1>`}</div>
      <div class="appbar-action">
        <button type="button" class="icon-btn" data-action="toggle-hide" aria-label="${state.prefs.hide ? 'Show' : 'Hide'} amounts">${svg(state.prefs.hide ? 'eyeOff' : 'eye')}</button>
        ${actionButton('bell')}
      </div>`;
  }
  return `
    <div class="appbar-title"><h1>${esc(page.title)}</h1></div>
    <div class="appbar-action">${actionButton(page.action)}</div>`;
}

/* =========================================================
   Render + routing
   ========================================================= */
const ALIASES = { budgets: ['plan', 'budgets'], goals: ['plan', 'goals'], portfolio: ['plan', 'portfolio'], transactions: ['activity'] };
let currentTab = 'home';
function render() {
  let [tab, sub] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  if (ALIASES[tab]) [tab, sub] = [ALIASES[tab][0], ALIASES[tab][1] || sub];
  if (tab === 'plan' && sub && ['budgets', 'goals', 'portfolio'].includes(sub)) state.prefs.planTab = sub;
  currentTab = PAGES[tab] ? tab : 'home';
  const page = PAGES[currentTab]();
  $('#appbar').innerHTML = appbarHtml(page);
  const keepScroll = view.dataset.tab === currentTab ? view.scrollTop : 0;
  view.innerHTML = page.html;
  view.dataset.tab = currentTab;
  view.scrollTop = keepScroll;
  if (currentTab === 'home') initSlides();
  document.title = `${page.title || 'Home'} · Jon Pocket`;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === currentTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', () => { closeSheet(); render(); view.scrollTop = 0; });

/* =========================================================
   Bottom sheet
   ========================================================= */
const sheetEl = $('#sheet');
let sheetSubmit = null;
let lastFocus = null;

function openSheet(title, body, onSubmit) {
  lastFocus = document.activeElement;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = body;
  sheetSubmit = onSubmit || null;
  sheetEl.hidden = false;
  const first = $('#sheet-body input:not([type=hidden]), #sheet-body select');
  setTimeout(() => (first || $('[data-action="close-sheet"]')).focus({ preventScroll: true }), 50);
}
function closeSheet() {
  if (sheetEl.hidden) return;
  sheetEl.hidden = true;
  $('#sheet-body').innerHTML = '';
  sheetSubmit = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------- Transaction sheet ---------- */
let txDraft = null;
const METHODS = ['Debit card', 'Credit card', 'E-wallet', 'QRIS', 'Bank transfer', 'Cash', 'Split bill'];

function txSheet(existing) {
  txDraft = existing ? { ...existing, account: pocketOf(existing) }
    : { id: null, type: 'expense', cat: 'food', amount: '', name: '', note: '', date: isoDate(now()), method: 'Debit card', account: newTxPocket() };
  if (!txDraft.toAccount) txDraft.toAccount = (pockets().find((p) => p.id !== txDraft.account) || {}).id || '';
  drawTxSheet();
}
function readTxForm() {
  const f = $('#tx-form');
  if (!f) return;
  txDraft.amount = f.amount.value; txDraft.name = f.name.value; txDraft.date = f.date.value;
  if (f.method) txDraft.method = f.method.value;
  txDraft.note = f.note.value;
  if (f.account) txDraft.account = f.account.value;
  if (f.toAccount) txDraft.toAccount = f.toAccount.value;
  txDraft.recurring = !!(f.recurring && f.recurring.checked);
}
function drawTxSheet() {
  const d = txDraft;
  const cats = catsOf(d.type);
  if (!cats.includes(d.cat)) d.cat = cats[0];
  const amount = typeof d.amount === 'number' ? groupDigits(d.amount) : d.amount;
  const isTransfer = d.type === 'transfer';
  const pocketSelect = (name, value, label) => `<label class="field"><span>${label}</span><select class="input" name="${name}">${pockets().map((p) => `<option value="${p.id}" ${p.id === value ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
  const body = `
    <form id="tx-form" class="stack" style="gap:16px" novalidate>
      ${seg([['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']], 'tx-type', d.type)}
      <label class="field"><span>Amount</span>
        <span class="amount-input"><b>Rp</b><input name="amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(amount)}" data-money required></span>
      </label>
      ${isTransfer ? `
      <div class="grid-2">${pocketSelect('account', d.account, 'From')}${pocketSelect('toAccount', d.toAccount, 'To')}</div>
      <p class="t-small" style="margin-top:-8px">Moving money between your pockets, like a GoPay top-up from BCA. It isn't counted as income or spending.</p>
      <label class="field"><span>Description (optional)</span><input class="input" name="name" maxlength="60" placeholder="e.g. GoPay top-up" value="${esc(d.name)}"></label>
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${esc(d.date)}" required></label>` : `
      <div class="field"><span>Category</span>
        <div class="pills" role="group" aria-label="Category">
          ${cats.map((c) => `<button type="button" class="pill" data-action="tx-cat" data-value="${c}" aria-pressed="${c === d.cat}">${esc(CATEGORIES[c].label)}</button>`).join('')}
          <button type="button" class="pill pill-add" data-action="new-category-from-tx">+ New category</button>
        </div>
      </div>
      <label class="field"><span>Description</span><input class="input" name="name" maxlength="60" placeholder="${d.type === 'expense' ? 'e.g. Lunch with team' : 'e.g. Monthly salary'}" value="${esc(d.name)}"></label>
      <div class="grid-2">
        ${pocketSelect('account', d.account, d.type === 'income' ? 'Into pocket' : 'From pocket')}
        <label class="field"><span>Paid with</span><select class="input" name="method">${(METHODS.includes(d.method) || !d.method || d.method === 'Recurring' ? METHODS : [...METHODS, d.method]).map((m) => `<option ${m === d.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${esc(d.date)}" required></label>`}
      ${d.type === 'expense' ? `<label class="check-row"><input type="checkbox" name="recurring" ${isRecurring(d) ? 'checked' : ''}>
        <span class="stack" style="gap:0"><span class="t-strong">Recurring payment</span><span class="t-small">Repeats every month, like rent, bills or subscriptions</span></span></label>` : ''}
      <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="120" value="${esc(d.note)}"></label>
      <p class="t-small neg" id="tx-error" role="alert"></p>
      <div class="btn-row">
        ${d.id ? '<button type="button" class="btn danger" data-action="delete-tx">Delete</button>' : ''}
        <button type="submit" class="btn primary">${d.id ? 'Save changes' : 'Save transaction'}</button>
      </div>
    </form>`;
  const title = d.id ? 'Transaction details' : 'Add transaction';
  if (sheetEl.hidden) openSheet(title, body, saveTx);
  else { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = body; sheetSubmit = saveTx; }
}
function saveTx() {
  readTxForm();
  const amount = parseAmount(txDraft.amount);
  if (!amount || amount <= 0) { $('#tx-error').textContent = 'Enter an amount above zero.'; $('#tx-form').amount.focus(); return; }
  if (!txDraft.date) { $('#tx-error').textContent = 'Pick a date.'; return; }
  if (!pockets().length) { $('#tx-error').textContent = 'Add a pocket first (Home → Pockets → Add pocket).'; return; }
  if (txDraft.type === 'transfer') {
    if (!txDraft.account || !txDraft.toAccount || txDraft.account === txDraft.toAccount) { $('#tx-error').textContent = 'Choose two different pockets.'; return; }
    const tr = {
      id: txDraft.id || uid(), type: 'transfer', cat: 'transfer', amount: Math.round(amount), account: txDraft.account, toAccount: txDraft.toAccount,
      name: txDraft.name.trim() || `Transfer to ${pocketName(txDraft.toAccount)}`, note: txDraft.note.trim(), date: txDraft.date, method: 'Transfer', u: stamp()
    };
    const j = state.transactions.findIndex((t) => t.id === tr.id);
    if (j >= 0) state.transactions[j] = tr; else state.transactions.push(tr);
    closeSheet();
    commit(j >= 0 ? 'Transfer updated' : 'Transfer saved');
    return;
  }
  state.prefs.lastPocket = txDraft.account;
  const rec = {
    id: txDraft.id || uid(), type: txDraft.type, cat: txDraft.cat, amount: Math.round(amount),
    name: txDraft.name.trim() || CATEGORIES[txDraft.cat].label, note: txDraft.note.trim(), date: txDraft.date, method: txDraft.method === 'Recurring' ? 'Bank transfer' : txDraft.method,
    recurring: txDraft.type === 'expense' && !!txDraft.recurring, account: txDraft.account || legacyPocket(), u: stamp()
  };
  const i = state.transactions.findIndex((t) => t.id === rec.id);
  if (i >= 0) state.transactions[i] = rec; else state.transactions.push(rec);
  closeSheet();
  commit(i >= 0 ? 'Transaction updated' : 'Transaction added');
}

/* ---------- Budget sheet ---------- */
function budgetSheet(cat) {
  const editing = !!cat;
  const available = catsOf('expense').filter((c) => editing ? c === cat : !(c in state.budgets));
  if (!available.length) { toast('Every category already has a budget'); return; }
  const current = cat || available[0];
  openSheet(editing ? `${CATEGORIES[cat].label} budget` : 'Add budget', `
    <form id="budget-form" class="stack" style="gap:16px" novalidate>
      ${editing ? `<input type="hidden" name="cat" value="${cat}">` : `
      <label class="field"><span>Category</span><select class="input" name="cat">${available.map((c) => `<option value="${c}">${CATEGORIES[c].label}</option>`).join('')}</select></label>`}
      <label class="field"><span>Monthly limit</span>
        <span class="amount-input"><b>Rp</b><input name="limit" inputmode="numeric" placeholder="0" data-money value="${editing ? groupDigits(state.budgets[cat]) : ''}"></span>
      </label>
      <p class="t-small neg" id="budget-error" role="alert"></p>
      <div class="btn-row">
        ${editing ? '<button type="button" class="btn danger" data-action="delete-budget" data-id="' + cat + '">Remove</button>' : ''}
        <button type="submit" class="btn primary">${editing ? 'Save' : 'Add budget'}</button>
      </div>
    </form>`, () => {
    const f = $('#budget-form');
    const limit = parseAmount(f.limit.value);
    if (!limit || limit <= 0) { $('#budget-error').textContent = 'Enter a limit above zero.'; return; }
    state.budgets[f.cat.value || current] = Math.round(limit);
    state.budgetsU = stamp();
    closeSheet();
    commit(editing ? 'Budget updated' : 'Budget added');
  });
}

/* ---------- Goal sheets ---------- */
let goalMode = 'add';
let newGoalIcon = 'goal';

function pocketOptions(selected, { none = 'Not linked', exclude = '' } = {}) {
  return `${none !== null ? `<option value="">${esc(none)}</option>` : ''}${pockets().filter((p) => p.id !== exclude).map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
}

function goalSheet(id) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return newGoalSheet();
  const saved = goalSaved(g);
  const left = Math.max(0, g.target - saved);
  const tracks = goalTracksPocket(g);
  const gp = pocketById(g.pocket);
  const body = `
    <form id="goal-form" class="stack" style="gap:16px" novalidate>
      <div class="stack" style="gap:8px;background:var(--primary-50);border-radius:16px;padding:16px">
        <div class="between"><span class="t-label">Saved</span><span class="t-strong">${idr(saved)} of ${idr(g.target)}</span></div>
        ${bar(pct(saved, g.target), g.color)}
        <span class="t-small">${left ? `${idr(left)} to go` : 'Goal reached!'}${tracks ? ` · follows the ${esc(gp.name)} balance` : ''}</span>
      </div>

      <div class="stack" style="gap:10px">
        <label class="field"><span>Saved in pocket</span><select class="input" id="goal-pocket">${pocketOptions(g.pocket)}</select></label>
        ${gp ? `<label class="check-row"><input type="checkbox" id="goal-track" ${tracks ? 'checked' : ''}>
          <span class="stack" style="gap:0"><span class="t-strong">Use ${esc(gp.name)}'s balance as the saved amount</span><span class="t-small">Best when this pocket holds only this goal</span></span></label>` : ''}
      </div>

      ${tracks ? `
        <p class="t-body" style="color:var(--ink-2)">To add money, move it into ${esc(gp.name)} with a transfer. The goal updates by itself.</p>
        <button type="button" class="btn primary" data-action="goal-transfer" data-id="${g.id}">Move money into ${esc(gp.name)}</button>
        <button type="button" class="btn danger" data-action="delete-goal" data-id="${g.id}">Delete goal</button>` : `
        ${seg([['add', 'Add money'], ['withdraw', 'Take out']], 'goal-mode', goalMode)}
        <label class="field"><span>Amount</span>
          <span class="amount-input"><b>Rp</b><input name="amount" inputmode="numeric" placeholder="0" data-money></span>
        </label>
        <div class="pills">${[500000, 1000000, 2000000].map((v) => `<button type="button" class="pill" data-action="quick-amount" data-value="${v}">+${idrShort(v)}</button>`).join('')}</div>
        ${gp ? `<label class="field"><span id="goal-move-label">${goalMode === 'add' ? `Move it into ${esc(gp.name)} from` : `Move it from ${esc(gp.name)} to`}</span>
          <select class="input" name="movePocket">${pocketOptions('', { none: 'Don’t record a transfer', exclude: gp.id })}</select></label>
          <p class="t-small" style="margin-top:-8px">Choosing a pocket also records a transfer, so both pocket balances stay right.</p>` : ''}
        <p class="t-small neg" id="goal-error" role="alert"></p>
        <div class="btn-row">
          <button type="button" class="btn danger" data-action="delete-goal" data-id="${g.id}">Delete</button>
          <button type="submit" class="btn primary">Update goal</button>
        </div>`}
    </form>`;
  setSheet(g.name, body, tracks ? null : () => {
    const f = $('#goal-form');
    const amt = parseAmount(f.amount.value);
    if (!amt || amt <= 0) { $('#goal-error').textContent = 'Enter an amount above zero.'; return; }
    const adding = goalMode === 'add';
    g.saved = Math.max(0, (g.saved || 0) + (adding ? amt : -amt));
    g.u = stamp();
    const other = f.movePocket ? f.movePocket.value : '';
    if (gp && other && pocketById(other)) {
      state.transactions.push({
        id: uid(), type: 'transfer', cat: 'transfer', amount: Math.round(amt),
        account: adding ? other : gp.id, toAccount: adding ? gp.id : other,
        name: adding ? `Saving for ${g.name}` : `From ${g.name} savings`, note: '', date: isoDate(now()), method: 'Transfer', u: stamp()
      });
    }
    closeSheet();
    commit(adding ? `Added ${idr(amt)} to ${g.name}` : `Took ${idr(amt)} from ${g.name}`);
  });
}

function newGoalSheet() {
  const d = now();
  const def = `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  openSheet('New goal', `
    <form id="newgoal-form" class="stack" style="gap:16px" novalidate>
      <label class="field"><span>Goal name</span><input class="input" name="name" maxlength="40" placeholder="e.g. Wedding fund" required></label>
      <div class="field"><span>Icon</span><div class="pills" role="group" aria-label="Icon">
        ${GOAL_ICONS.map((ic) => `<button type="button" class="pill" data-action="goal-icon" data-value="${ic}" aria-pressed="${ic === newGoalIcon}" aria-label="${ic}" style="padding:0 12px">${svg(ic, 'style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round"')}</button>`).join('')}
      </div></div>
      <label class="field"><span>Target amount</span><span class="amount-input"><b>Rp</b><input name="target" inputmode="numeric" placeholder="0" data-money></span></label>
      <label class="field"><span>Saved in pocket</span><select class="input" name="pocket" id="newgoal-pocket">${pocketOptions('')}</select></label>
      <label class="check-row" id="newgoal-track-row" hidden><input type="checkbox" name="track">
        <span class="stack" style="gap:0"><span class="t-strong">Use this pocket's balance as the saved amount</span><span class="t-small">Best when the pocket holds only this goal</span></span></label>
      <div class="grid-2">
        <label class="field" id="newgoal-saved-field"><span>Already saved</span><input class="input" name="saved" inputmode="numeric" placeholder="0" data-money></label>
        <label class="field"><span>Target month</span><input class="input" type="month" name="due" value="${def}"></label>
      </div>
      <p class="t-small neg" id="newgoal-error" role="alert"></p>
      <button type="submit" class="btn primary">Create goal</button>
    </form>`, () => {
    const f = $('#newgoal-form');
    const name = f.name.value.trim();
    const target = parseAmount(f.target.value);
    const saved = parseAmount(f.saved.value) || 0;
    if (!name) { $('#newgoal-error').textContent = 'Give your goal a name.'; f.name.focus(); return; }
    if (!target || target <= 0) { $('#newgoal-error').textContent = 'Enter a target above zero.'; return; }
    const pocket = pocketById(f.pocket.value) ? f.pocket.value : '';
    const track = pocket && f.track.checked ? 'pocket' : 'manual';
    state.goals.push({ id: uid(), name, icon: newGoalIcon, color: GOAL_COLORS[state.goals.length % GOAL_COLORS.length], saved: track === 'pocket' ? 0 : Math.round(saved), target: Math.round(target), due: f.due.value || def, members: [], pocket, track, u: stamp() });
    closeSheet();
    commit('Goal created');
  });
}

/* ---------- Other sheets ---------- */
function notificationsSheet() {
  const list = notifications();
  openSheet('Notifications', list.length ? `<div class="list-card" >${list.map((n) => `
    <div class="tx">${n.goal ? goalTile(n.goal.icon, n.goal.color) : catTile(n.icon)}<span class="t-body">${esc(n.text)}</span></div>`).join('')}</div>`
    : '<p class="empty">You’re all caught up.</p>');
}
/* ---------- Pocket sheets ---------- */
const POCKET_COLORS = ['#0B5CAB', '#E89A00', '#00A6CF', '#4C3494', '#1FAA6B', '#E0457B', '#5B4CF0', '#44435A'];
const pocketHasTx = (id) => state.transactions.some((t) => t.account === id || t.toAccount === id);

function setSheet(title, body, submit = null) {
  if (sheetEl.hidden) openSheet(title, body, submit);
  else { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = body; sheetSubmit = submit; }
}

function managePockets() {
  setSheet('Pockets', `
    <p class="t-body" style="color:var(--ink-2)">Your bank accounts and e-wallets. Set each balance to what you see in that app today.</p>
    <div class="list-card">
      ${pockets().map((p) => `
        <div class="tx">
          ${pocketIcon(p)}
          <div class="meta"><span class="name ellipsis">${esc(p.name)}</span><span class="t-small">${kindOf(p).label} · ${money(pocketBalance(p.id))}</span></div>
          <button type="button" class="pill" data-action="edit-pocket" data-id="${p.id}" style="flex-shrink:0;min-height:36px">Edit</button>
        </div>`).join('') || '<p class="empty">No pockets yet.</p>'}
    </div>
    <button type="button" class="btn primary" data-action="add-pocket">+ Add pocket</button>`);
}

function openPocket(id) {
  const p = pocketById(id);
  if (!p) return;
  const list = sortedTx(state.transactions.filter((t) => pocketOf(t) === id || t.toAccount === id));
  const month = list.filter((t) => inMonth(t));
  let inM = 0, outM = 0;
  for (const t of month) {
    if (t.type === 'transfer') { if (t.toAccount === id) inM += t.amount; else outM += t.amount; }
    else if (t.type === 'income') inM += t.amount; else outM += t.amount;
  }
  setSheet(p.name, `
    <div class="stack" style="gap:6px;background:${p.color}14;border-radius:18px;padding:16px">
      <div class="row" style="gap:12px">${pocketIcon(p, 44)}<span class="stack" style="gap:0"><span class="t-small">${kindOf(p).long} balance</span><span class="t-stat">${money(pocketBalance(id))}</span></span></div>
      <div class="between t-small" style="padding-top:6px"><span>In this month: <b class="pos">${money(inM, true)}</b></span><span>Out: <b class="neg">${money(outM, true)}</b></span></div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" style="min-height:46px;background:var(--chip);color:var(--ink)" data-action="edit-pocket" data-id="${id}">Edit pocket</button>
      <button type="button" class="btn" style="min-height:46px;background:var(--primary-50);color:var(--primary)" data-action="pocket-transactions" data-id="${id}">All transactions</button>
    </div>
    ${state.goals.some((g) => g.pocket === id) ? `
    <div class="stack" style="gap:8px"><span class="t-label">Goals saved here</span>
      ${state.goals.filter((g) => g.pocket === id).map((g) => `<button type="button" class="row" data-action="edit-goal" data-id="${g.id}" style="gap:10px;border:0;background:none;padding:0;text-align:left;width:100%;color:var(--ink)">${goalTile(g.icon, g.color)}<span class="grow stack" style="gap:4px"><span class="between"><span class="t-body" style="font-weight:500">${esc(g.name)}</span><span class="t-small">${pct(goalSaved(g), g.target)}%</span></span>${bar(pct(goalSaved(g), g.target), g.color, 'thin')}</span></button>`).join('')}
    </div>` : ''}
    <div class="section-head" style="margin:0"><h2 style="font-size:15px">Recent</h2></div>
    ${list.length ? txList(list.slice(0, 6)) : '<p class="empty">No transactions in this pocket yet.</p>'}`);
}

let pocketDraft = null;
function pocketForm(id) {
  const p = id ? pocketById(id) : null;
  pocketDraft = p ? { ...p } : { id: null, name: '', kind: 'bank', color: POCKET_COLORS[pockets().length % POCKET_COLORS.length] };
  drawPocketForm(p ? groupDigits(Math.max(0, pocketBalance(p.id))) : '');
}
function drawPocketForm(balanceText, nameText) {
  const d = pocketDraft;
  setSheet(d.id ? `Edit ${d.name}` : 'Add pocket', `
    <form id="pocket-form" class="stack" style="gap:16px" novalidate>
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="30" placeholder="${d.kind === 'cash' ? 'e.g. Cash, Wallet' : d.kind === 'ewallet' ? 'e.g. Dana, ShopeePay' : 'e.g. Mandiri, BRI'}" value="${esc(nameText ?? d.name)}" required></label>
      ${seg([['bank', 'Bank'], ['ewallet', 'E-wallet'], ['cash', 'Cash']], 'pocket-kind', d.kind)}
      <label class="field"><span>Current balance</span>
        <span class="amount-input"><b>Rp</b><input name="balance" inputmode="numeric" placeholder="0" data-money value="${esc(balanceText)}"></span>
      </label>
      <p class="t-small" style="margin-top:-8px">${d.kind === 'cash' ? 'Count the cash you have right now.' : `Type what the ${d.kind === 'ewallet' ? 'e-wallet' : 'bank'} app shows right now.`} Jon Pocket keeps it up to date as you add transactions.</p>
      <div class="field"><span>Colour</span><div class="pills" role="group" aria-label="Colour">
        ${POCKET_COLORS.map((c) => `<button type="button" class="swatch" data-action="pocket-color" data-value="${c}" aria-pressed="${c === d.color}" aria-label="Colour ${c}" style="background:${c}"></button>`).join('')}
      </div></div>
      <p class="t-small neg" id="pocket-error" role="alert"></p>
      <div class="btn-row">
        ${d.id ? `<button type="button" class="btn danger" data-action="delete-pocket" data-id="${d.id}">Delete</button>` : ''}
        <button type="submit" class="btn primary">${d.id ? 'Save' : 'Add pocket'}</button>
      </div>
    </form>`, savePocket);
}
function savePocket() {
  const f = $('#pocket-form');
  const name = f.name.value.trim();
  if (!name) { $('#pocket-error').textContent = 'Give the pocket a name.'; f.name.focus(); return; }
  const current = parseAmount(f.balance.value) || 0;
  const d = pocketDraft;
  if (d.id) {
    const p = pocketById(d.id);
    const movement = pocketBalance(d.id) - (p.opening || 0);
    Object.assign(p, { name, kind: d.kind, color: d.color, opening: Math.round(current - movement), u: stamp() });
  } else {
    if (!state.accounts) state.accounts = [];
    state.accounts.push({ id: uid(), name, kind: d.kind, color: d.color, opening: Math.round(current), u: stamp() });
  }
  closeSheet();
  commit(d.id ? 'Pocket updated' : `${name} added`);
}

/* ---------- Categories (your own) ---------- */
let catDraft = null;
let catReturnToTx = false;

function manageCategories() {
  const mine = state.categories || [];
  const row = (id) => {
    const c = CATEGORIES[id];
    const used = state.transactions.filter((t) => t.cat === id).length;
    return `<div class="tx">${catTile(id)}
      <div class="meta"><span class="name ellipsis">${esc(c.label)}</span><span class="t-small">${c.type === 'income' ? 'Income' : (c.group === 'needs' ? 'Expense · Need' : 'Expense · Want')} · ${used} transaction${used === 1 ? '' : 's'}</span></div>
      ${isCustomCategory(id) ? `<button type="button" class="pill" data-action="edit-category" data-id="${id}" style="flex-shrink:0;min-height:36px">Edit</button>` : '<span class="t-small" style="flex-shrink:0">Built-in</span>'}</div>`;
  };
  setSheet('Categories', `
    <button type="button" class="btn primary" data-action="new-category">+ New category</button>
    <div class="stack" style="gap:8px"><span class="t-label">Your categories</span>
      ${mine.length ? `<div class="list-card">${mine.filter((c) => CATEGORIES[c.id]).map((c) => row(c.id)).join('')}</div>`
        : '<p class="empty" style="padding:16px">None yet. Make one for things like Coffee, Pets, Kids or Charity.</p>'}
    </div>
    <div class="stack" style="gap:8px"><span class="t-label">Built-in expense categories</span>
      <div class="list-card">${catsOf('expense').filter((id) => !isCustomCategory(id)).map(row).join('')}</div></div>
    <div class="stack" style="gap:8px"><span class="t-label">Built-in income categories</span>
      <div class="list-card">${catsOf('income').filter((id) => !isCustomCategory(id)).map(row).join('')}</div></div>`);
}

function categoryForm(id, type = 'expense') {
  const c = id ? (state.categories || []).find((x) => x.id === id) : null;
  catDraft = c ? { ...c } : { id: null, label: '', type, icon: type === 'income' ? 'income' : 'other', color: CATEGORY_COLORS[(state.categories || []).length % CATEGORY_COLORS.length], group: 'wants' };
  drawCategoryForm();
}
function drawCategoryForm(nameText) {
  const d = catDraft;
  const used = d.id ? state.transactions.filter((t) => t.cat === d.id).length : 0;
  setSheet(d.id ? 'Edit category' : 'New category', `
    <form id="cat-form" class="stack" style="gap:16px" novalidate>
      <div class="row" style="gap:12px">
        <span class="cat" style="background:${d.color}1F;color:${d.color};width:52px;height:52px;border-radius:16px">${svg(d.icon)}</span>
        <label class="field grow"><span>Name</span><input class="input" name="label" maxlength="24" placeholder="e.g. Coffee, Pets, Charity" value="${esc(nameText ?? d.label)}" required></label>
      </div>
      ${d.id ? '' : seg([['expense', 'Expense'], ['income', 'Income']], 'cat-type', d.type)}
      ${d.type === 'expense' ? `<div class="field"><span>For the 50/30/20 check, this is a</span>${seg([['needs', 'Need'], ['wants', 'Want']], 'cat-group', d.group)}</div>` : ''}
      <div class="field"><span>Icon</span><div class="icon-grid" role="group" aria-label="Icon">
        ${CATEGORY_ICONS.map((ic) => `<button type="button" class="icon-choice" data-action="cat-icon" data-value="${ic}" aria-pressed="${ic === d.icon}" aria-label="${ic}">${svg(ic)}</button>`).join('')}
      </div></div>
      <div class="field"><span>Colour</span><div class="pills" role="group" aria-label="Colour">
        ${CATEGORY_COLORS.map((c) => `<button type="button" class="swatch" data-action="cat-color" data-value="${c}" aria-pressed="${c === d.color}" aria-label="Colour ${c}" style="background:${c}"></button>`).join('')}
      </div></div>
      <p class="t-small neg" id="cat-error" role="alert"></p>
      <div class="btn-row">
        ${d.id ? `<button type="button" class="btn danger" data-action="delete-category" data-id="${d.id}">Delete</button>` : ''}
        <button type="submit" class="btn primary">${d.id ? 'Save' : 'Add category'}</button>
      </div>
      ${d.id && used ? `<p class="t-small">${used} transaction${used === 1 ? ' uses' : 's use'} this category.</p>` : ''}
    </form>`, saveCategory);
}
function saveCategory() {
  const f = $('#cat-form');
  const label = f.label.value.trim();
  if (!label) { $('#cat-error').textContent = 'Give the category a name.'; f.label.focus(); return; }
  const clash = Object.entries(CATEGORIES).find(([id, c]) => id !== catDraft.id && c.type === catDraft.type && [c.label, c.short].some((n) => (n || '').toLowerCase() === label.toLowerCase()));
  if (clash) { $('#cat-error').textContent = `There's already a category called ${clash[1].label}.`; return; }
  if (!state.categories) state.categories = [];
  const d = catDraft;
  let id = d.id;
  if (id) Object.assign(state.categories.find((x) => x.id === id), { label, icon: d.icon, color: d.color, group: d.group, u: stamp() });
  else { id = 'c_' + uid(); state.categories.push({ id, label, type: d.type, icon: d.icon, color: d.color, group: d.group, u: stamp() }); }
  setCustomCategories(state.categories);
  save(state); render(); schedulePush();
  toast(d.id ? 'Category updated' : `${label} added`);
  if (catReturnToTx && txDraft) {
    catReturnToTx = false;
    if (!d.id && d.type === txDraft.type) txDraft.cat = id;
    drawTxSheet();
  } else manageCategories();
}

/* ---------- Recurring payments ---------- */
// One row per payment name (e.g. "Netflix"), using its most recent transaction.
function latestByName(list) {
  const m = new Map();
  for (const t of sortedTx(list)) { const k = t.name.trim().toLowerCase(); if (!m.has(k)) m.set(k, t); }
  return [...m.values()];
}
function recurringRow(t, marked, view) {
  return `
    <div class="tx">
      ${catTile(t.cat)}
      <div class="meta"><span class="name ellipsis">${esc(t.name)}</span><span class="t-small">${money(t.amount)} · last ${shortDay(t.date)}</span></div>
      <button type="button" class="pill${marked ? '' : ' pill-primary'}" data-action="toggle-recurring" data-id="${t.id}" data-view="${view}" aria-label="${marked ? 'Unmark' : 'Mark'} ${esc(t.name)} as recurring" style="flex-shrink:0;min-height:36px">${marked ? 'Unmark' : 'Mark'}</button>
    </div>`;
}
function paymentsSheet() {
  const items = latestByName(state.transactions.filter((t) => t.type === 'expense' && isRecurring(t)));
  const monthly = items.reduce((s, t) => s + t.amount, 0);
  const body = `
    <div class="stack" style="gap:2px;background:var(--primary-50);border-radius:16px;padding:14px 16px">
      <span class="t-small">Leaves your account about every month</span>
      <span class="t-stat">${money(monthly)}</span>
      <span class="t-small">${items.length} recurring payment${items.length === 1 ? '' : 's'}</span>
    </div>
    ${items.length ? `<div class="list-card">${items.map((t) => recurringRow(t, true, 'list')).join('')}</div>`
      : '<p class="empty">Nothing marked yet. Mark rent, bills and subscriptions so you can see what leaves your account every month.</p>'}
    <button type="button" class="btn primary" data-action="recurring-picker">+ Mark a payment as recurring</button>`;
  if (sheetEl.hidden) openSheet('Recurring payments', body);
  else { $('#sheet-title').textContent = 'Recurring payments'; $('#sheet-body').innerHTML = body; sheetSubmit = null; }
}
function recurringPicker() {
  const since = isoDate(new Date(Date.now() - 62 * DAY));
  const items = latestByName(state.transactions.filter((t) => t.type === 'expense' && !isRecurring(t) && t.date >= since)).slice(0, 40);
  const body = `
    <p class="t-body" style="color:var(--ink-2)">Choose the payments that repeat every month. Every transaction with the same name is marked too.</p>
    ${items.length ? `<div class="list-card">${items.map((t) => recurringRow(t, false, 'picker')).join('')}</div>`
      : '<p class="empty">No expenses from the last two months to choose from. Add one with the + button, or tick “Recurring payment” when you add it.</p>'}
    <button type="button" class="btn" style="background:var(--chip);color:var(--ink)" data-action="payments">Done</button>`;
  $('#sheet-title').textContent = 'Mark as recurring';
  $('#sheet-body').innerHTML = body;
  sheetSubmit = null;
}
function toggleRecurring(el) {
  const t = state.transactions.find((x) => x.id === el.dataset.id);
  if (!t) return;
  const mark = !isRecurring(t);
  const key = t.name.trim().toLowerCase();
  const u = stamp();
  for (const x of state.transactions) {
    if (x.type === 'expense' && x.name.trim().toLowerCase() === key) {
      x.recurring = mark;
      if (!mark && x.method === 'Recurring') x.method = 'Bank transfer';
      x.u = u;
    }
  }
  save(state); render(); schedulePush();
  if (el.dataset.view === 'picker') recurringPicker(); else paymentsSheet();
  toast(mark ? `${t.name} marked as recurring` : `${t.name} is no longer recurring`);
}
function lessonSheet() {
  openSheet('The 50/30/20 rule', `
    <p class="t-body">Split your take-home income into three buckets:</p>
    <div class="list-card" >
      <div class="tx"><span class="t-h2" style="width:56px;color:var(--primary)">50%</span><span class="t-body"><b>Needs</b>: rent, food, transport, bills, health.</span></div>
      <div class="tx"><span class="t-h2" style="width:56px;color:#B87A00">30%</span><span class="t-body"><b>Wants</b>: eating out, shopping, entertainment.</span></div>
      <div class="tx"><span class="t-h2" style="width:56px;color:var(--pos)">20%</span><span class="t-body"><b>Savings</b>: emergency fund, goals, investing.</span></div>
    </div>
    <p class="t-body" style="color:var(--ink-2)">It’s a starting point, not a law. If rent is high where you live, needs may take more. Just keep savings growing every month.</p>
    <a class="btn primary" href="#/plan/goals" style="display:flex;align-items:center;justify-content:center;text-decoration:none">See my 50/30/20 check</a>`);
}
function cloudCard() {
  if (window.RENCANA_PREVIEW) return '<p class="t-body" style="color:var(--ink-2)">This preview saves data only in this browser. Cloud sync works on the live site.</p>';
  const box = (inner) => `<div class="stack" style="gap:10px;background:var(--primary-50);border-radius:16px;padding:16px">${inner}</div>`;
  if (cloud.available === false) {
    return box(`<span class="t-strong">Cloud sync</span><span class="t-small">${cloud.reason === 'no_db'
      ? 'The cloud database isn’t connected to this site yet. Follow the setup steps in the README, then reload.'
      : 'Cloud sync isn’t available here. Open the live site to sign in. Your data is saved on this device.'}</span>`);
  }
  if (!cloud.email) {
    return box(`<span class="t-strong">Back up and sync</span>
      <span class="t-small">Sign in to keep your data safe in the cloud and use it on your phone and computer.</span>
      <button type="button" class="btn primary" data-action="open-auth" style="min-height:46px">Sign in or create account</button>`);
  }
  return box(`<div class="between"><span class="stack" style="gap:0;min-width:0"><span class="t-small">Signed in as</span><span class="t-strong ellipsis">${esc(cloud.email)}</span></span>
      <span class="chip lg" id="sync-chip" style="${syncChipStyle()}">${esc(syncLabel())}</span></div>
    <div class="btn-row"><button type="button" class="btn" style="min-height:44px;background:#fff;color:var(--primary)" data-action="sync-now">Sync now</button>
      <button type="button" class="btn" style="min-height:44px;background:#fff;color:var(--ink-2)" data-action="sign-out">Sign out</button></div>`);
}

function dataSheet() {
  openSheet('Your data', `
    <div id="cloud-card">${cloudCard()}</div>
    <label class="field"><span>Your name</span><input class="input" id="name-input" maxlength="24" placeholder="Shown on the Home screen" value="${esc(state.prefs.name)}"></label>
    <label class="field"><span>Month starts on (payday)</span><select class="input" id="cycle-day">${Array.from({ length: 28 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === cycleDay() ? 'selected' : ''}>${n === 1 ? '1st (calendar month)' : `${n}${n === 2 || n === 22 ? 'nd' : n === 3 || n === 23 ? 'rd' : n === 21 ? 'st' : 'th'} of each month`}</option>`).join('')}</select></label>
    ${window.RENCANA_PREVIEW ? '' : `<button type="button" class="tile-btn" data-action="export-csv" ><span class="row" style="gap:12px">${catTile('income')}<span class="stack" style="gap:0"><span class="t-strong">Export transactions</span><span class="t-small">Download a CSV for Excel or Sheets</span></span></span></button>`}
    ${cloud.email && !window.RENCANA_PREVIEW ? `<button type="button" class="tile-btn" data-action="shortcut-setup"><span class="row" style="gap:12px"><span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('phone')}</span><span class="stack" style="gap:0"><span class="t-strong">iPhone Shortcut</span><span class="t-small">Add income or expenses from Shortcuts or Siri</span></span></span>${svg('chev', 'class="chev"')}</button>` : ''}
    <button type="button" class="tile-btn" data-action="manage-categories"><span class="row" style="gap:12px"><span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('grid')}</span><span class="stack" style="gap:0"><span class="t-strong">Categories</span><span class="t-small">Add your own, like Coffee or Pets</span></span></span>${svg('chev', 'class="chev"')}</button>
    <label class="field"><span>Imported transactions go to</span><select class="input" id="import-pocket">${pockets().map((p) => `<option value="${p.id}" ${p.id === (pocketById(state.prefs.importPocket) ? state.prefs.importPocket : legacyPocket()) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="tile-btn" style="cursor:pointer"><span class="row" style="gap:12px"><span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('download')}</span><span class="stack" style="gap:0"><span class="t-strong">Import transactions</span><span class="t-small">Add a CSV file (same format as the export)</span></span></span><input type="file" id="import-file" accept=".csv,text/csv" class="sr-only"></label>
    <button type="button" class="tile-btn" data-action="start-empty" ><span class="row" style="gap:12px"><span class="cat" style="background:#FDE7E7;color:#B42318">${svg('reset')}</span><span class="stack" style="gap:0"><span class="t-strong">Delete all data</span><span class="t-small">Remove every transaction, budget and goal</span></span></span></button>`);
}
/* ---------- iPhone Shortcut ---------- */
let shortcutKey = null; // shown once, right after it's made
const shortcutUrl = () => `${location.origin}/api/quick-add`;

async function shortcutSheet() {
  setSheet('iPhone Shortcut', '<p class="t-body" style="color:var(--ink-2)">Loading…</p>');
  const r = await api('shortcut-key').catch(() => null);
  if (!r || !r.ok) { setSheet('iPhone Shortcut', '<p class="t-body" style="color:var(--ink-2)">Couldn’t reach the cloud. Check your connection and try again.</p>'); return; }
  drawShortcutSheet(r.data);
}

function drawShortcutSheet(info) {
  const copyRow = (label, value, id) => `
    <div class="field"><span>${label}</span>
      <div class="row" style="gap:8px"><input class="input grow" id="${id}" readonly value="${esc(value)}" style="font-size:13px;font-family:ui-monospace,Menlo,monospace">
      <button type="button" class="pill" data-action="copy-field" data-value="${id}" style="flex-shrink:0;min-height:44px">Copy</button></div></div>`;
  const when = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const keyPart = shortcutKey
    ? `${copyRow('Your Shortcut key (shown only now — copy it into the Shortcut)', shortcutKey, 'sc-key')}`
    : info.exists
      ? `<div class="stack" style="gap:4px;background:var(--primary-50);border-radius:16px;padding:14px 16px"><span class="t-strong">Shortcut key is on</span><span class="t-small">Made ${when(info.createdAt)}${info.lastUsed ? ` · last used ${when(info.lastUsed)}` : ' · not used yet'}. Lost it? Make a new one — the old one stops working.</span></div>`
      : '';
  setSheet('iPhone Shortcut', `
    <p class="t-body" style="color:var(--ink-2)">Add an expense or income from the Shortcuts app, your Home Screen, the Action Button or by asking Siri — without opening Jon Pocket. It shows up here the next time the app syncs.</p>
    ${keyPart}
    ${copyRow('Web address (URL)', shortcutUrl(), 'sc-url')}
    <div class="btn-row">
      ${info.exists || shortcutKey ? '<button type="button" class="btn danger" data-action="shortcut-off">Turn off</button>' : ''}
      <button type="button" class="btn primary" data-action="shortcut-new">${info.exists || shortcutKey ? 'Make a new key' : 'Create Shortcut key'}</button>
    </div>
    <div class="stack" style="gap:8px"><span class="t-label">Build the Shortcut (about 2 minutes)</span>
      <ol class="steps">
        <li>Open <b>Shortcuts</b> → <b>+</b>. Name it “Add expense”.</li>
        <li>Add <b>Ask for Input</b> → Number, prompt “How much?”.</li>
        <li>Add <b>Ask for Input</b> → Text, prompt “What for?”.</li>
        <li>Optional: add <b>Choose from Menu</b> with your categories (e.g. Food, Transport, Shopping) and pockets (e.g. GoPay, BCA). Use the names you see in the app.</li>
        <li>Add <b>Get Contents of URL</b>. Paste the web address above. Tap <b>Show More</b>: Method <b>POST</b>.</li>
        <li>Headers: add <b>Authorization</b> with the value <b>Bearer</b> + a space + your key.</li>
        <li>Request Body <b>JSON</b>, add fields: <b>type</b> = expense, <b>amount</b> = Provided Input (number), <b>name</b> = Provided Input (text), and optionally <b>category</b>, <b>pocket</b>.</li>
        <li>Add <b>Get Dictionary Value</b> “message” → <b>Show Notification</b>. Done!</li>
      </ol>
      <p class="t-small">For income, duplicate the Shortcut and set <b>type</b> = income (category e.g. Salary). Leave out pocket to use BCA, and leave out category to use Other. You can say “Hey Siri, Add expense”.</p>
    </div>`);
}

/* ---------- CSV import ---------- */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function catFromLabel(label, type) {
  const l = String(label || '').trim().toLowerCase();
  const hit = Object.entries(CATEGORIES).find(([id, c]) => c.type === type && (id === l || c.label.toLowerCase() === l || c.short.toLowerCase() === l));
  return hit ? hit[0] : (type === 'income' ? 'gift' : 'other');
}

function importCsvText(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no transactions.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iDate = col('date', 'tanggal'), iType = col('type', 'jenis'), iCat = col('category', 'kategori');
  const iName = col('description', 'keterangan', 'name'), iAmt = col('amount', 'jumlah', 'nominal');
  const iMethod = col('paid with', 'method'), iNote = col('note', 'catatan'), iRec = col('recurring');
  const iPocket = col('pocket', 'account', 'akun'), iTo = col('to pocket', 'to account');
  const fallback = pocketById(state.prefs.importPocket) ? state.prefs.importPocket : legacyPocket();
  const findPocket = (v) => {
    const k = String(v || '').trim().toLowerCase();
    if (!k) return '';
    const hit = pockets().find((p) => p.id === k || p.name.toLowerCase() === k);
    return hit ? hit.id : '';
  };
  if (iDate < 0 || iAmt < 0) throw new Error('The file needs at least "Date" and "Amount" columns.');
  const key = (t) => `${t.date}|${t.type}|${t.amount}|${t.name.toLowerCase()}`;
  const existing = new Set(state.transactions.map(key));
  let added = 0, skipped = 0, bad = 0;
  for (const r of rows.slice(1)) {
    const date = (r[iDate] || '').trim();
    const raw = parseFloat(String(r[iAmt] || '').replace(/[^\d.-]/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !raw) { bad++; continue; }
    const typeCell = iType >= 0 ? (r[iType] || '').trim().toLowerCase() : '';
    let type = typeCell.startsWith('inc') || typeCell === 'cr' || (!typeCell && raw > 0) ? 'income' : 'expense';
    const account = findPocket(iPocket >= 0 ? r[iPocket] : '') || fallback;
    const toAccount = findPocket(iTo >= 0 ? r[iTo] : '');
    if (typeCell.startsWith('trans') && toAccount && toAccount !== account) type = 'transfer';
    const cat = type === 'transfer' ? 'transfer' : catFromLabel(iCat >= 0 ? r[iCat] : '', type);
    const t = {
      id: uid(), type, cat, amount: Math.round(Math.abs(raw)), date, account, ...(type === 'transfer' ? { toAccount } : {}),
      name: ((iName >= 0 ? r[iName] : '') || '').trim() || CATEGORIES[cat].label,
      method: ((iMethod >= 0 ? r[iMethod] : '') || '').trim() || 'Bank transfer',
      note: ((iNote >= 0 ? r[iNote] : '') || '').trim()
    };
    if (type === 'expense' && iRec >= 0 && /^(yes|y|true|1|ya)$/i.test((r[iRec] || '').trim())) t.recurring = true;
    if (existing.has(key(t))) { skipped++; continue; }
    t.u = stamp();
    existing.add(key(t)); state.transactions.push(t); added++;
  }
  return { added, skipped, bad };
}

function exportCsv() {
  const rows = [['Date', 'Type', 'Category', 'Description', 'Amount', 'Paid with', 'Note', 'Recurring', 'Pocket', 'To pocket']];
  for (const t of sortedTx(state.transactions)) rows.push([t.date, t.type, CATEGORIES[t.cat]?.label || t.cat, t.name, t.type === 'expense' ? -t.amount : t.amount, t.method, t.note || '', isRecurring(t) ? 'yes' : '', pocketName(pocketOf(t)), t.type === 'transfer' ? pocketName(t.toAccount) : '']);
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `rencana-${isoDate(now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =========================================================
   Events (one listener for everything with data-action)
   ========================================================= */
function pressIn(el, action) {
  document.querySelectorAll(`[data-action="${action}"]`).forEach((b) => b.setAttribute('aria-pressed', b === el));
}

/* In-app confirmation (browser confirm() pop-ups are blocked in some embeds) */
let confirmFn = null;
function askConfirm(title, message, okLabel, onYes) {
  confirmFn = onYes;
  const body = `
    <p class="t-body" style="color:var(--ink-2)">${esc(message)}</p>
    <div class="btn-row">
      <button type="button" class="btn" style="background:var(--chip);color:var(--ink)" data-action="close-sheet">Cancel</button>
      <button type="button" class="btn danger" data-action="confirm-yes">${esc(okLabel)}</button>
    </div>`;
  if (sheetEl.hidden) openSheet(title, body);
  else { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = body; sheetSubmit = null; }
}

const ACTIONS = {
  'open-tx': () => txSheet(),
  'edit-tx': (el) => { const t = state.transactions.find((x) => x.id === el.dataset.id); if (t) { closeSheet(); txSheet(t); } },
  'tx-type': (el) => {
    readTxForm(); txDraft.type = el.dataset.value;
    if (txDraft.type === 'income' && txDraft.method === 'Debit card') txDraft.method = 'Bank transfer';
    if (txDraft.type === 'expense' && txDraft.method === 'Bank transfer' && !txDraft.id) txDraft.method = 'Debit card';
    drawTxSheet();
  },
  'tx-cat': (el) => { readTxForm(); txDraft.cat = el.dataset.value; drawTxSheet(); },
  'delete-tx': () => {
    readTxForm();
    const id = txDraft.id;
    askConfirm('Delete transaction?', `"${txDraft.name || 'This transaction'}" will be removed.`, 'Delete', () => {
      state.transactions = state.transactions.filter((t) => t.id !== id);
      state.deleted[id] = stamp();
      closeSheet(); commit('Transaction deleted');
    });
  },
  'confirm-yes': () => { const f = confirmFn; confirmFn = null; if (f) f(); },
  'close-sheet': closeSheet,
  'toggle-hide': () => { state.prefs.hide = !state.prefs.hide; commit(state.prefs.hide ? 'Amounts hidden' : ''); },
  'cat-filter': (el) => { state.prefs.catFilter = el.dataset.value; activitySearch = ''; save(state); location.hash = '#/activity'; },
  'spent-slide': (el) => {
    const box = $('#spent-slides'); const i = Number(el.dataset.value);
    homeSlide = i;
    document.querySelectorAll('[data-action="spent-slide"]').forEach((d) => d.setAttribute('aria-selected', String(Number(d.dataset.value) === i)));
    fitSlides(i);
    if (box) box.scrollTo({ left: i * box.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  },
  'shortcut-setup': () => { shortcutKey = null; shortcutSheet(); },
  'shortcut-new': async () => {
    const r = await api('shortcut-key', { method: 'POST', body: {} }).catch(() => null);
    if (!r || !r.ok) { toast('Couldn’t make a key. Try again.'); return; }
    shortcutKey = r.data.key;
    drawShortcutSheet({ exists: true, createdAt: r.data.createdAt, lastUsed: 0 });
    toast('Shortcut key created');
  },
  'shortcut-off': () => askConfirm('Turn off the Shortcut?', 'Shortcuts using the current key will stop working.', 'Turn off', async () => {
    const r = await api('shortcut-key', { method: 'DELETE', body: {} }).catch(() => null);
    if (!r || !r.ok) { toast('Couldn’t turn it off. Try again.'); return; }
    shortcutKey = null;
    drawShortcutSheet({ exists: false });
    toast('Shortcut turned off');
  }),
  'copy-field': async (el) => {
    const input = $('#' + el.dataset.value);
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    toast('Copied');
  },
  'manage-categories': () => { catReturnToTx = false; manageCategories(); },
  'new-category': () => { catReturnToTx = false; categoryForm(null); },
  'edit-category': (el) => { catReturnToTx = false; categoryForm(el.dataset.id); },
  'new-category-from-tx': () => { readTxForm(); catReturnToTx = true; categoryForm(null, txDraft.type === 'income' ? 'income' : 'expense'); },
  'cat-type': (el) => { catDraft.type = el.dataset.value; catDraft.icon = catDraft.type === 'income' ? 'income' : (catDraft.icon === 'income' ? 'other' : catDraft.icon); drawCategoryForm($('#cat-form').label.value); },
  'cat-group': (el) => { catDraft.group = el.dataset.value; pressIn(el, 'cat-group'); },
  'cat-icon': (el) => { catDraft.icon = el.dataset.value; drawCategoryForm($('#cat-form').label.value); },
  'cat-color': (el) => { catDraft.color = el.dataset.value; drawCategoryForm($('#cat-form').label.value); },
  'delete-category': (el) => {
    const id = el.dataset.id;
    const c = CATEGORIES[id];
    const used = state.transactions.filter((t) => t.cat === id);
    const fallback = c.type === 'income' ? 'gift' : 'other';
    askConfirm(`Delete ${c.label}?`, used.length ? `${used.length} transaction${used.length === 1 ? '' : 's'} will move to ${CATEGORIES[fallback].label}.` : 'This category will be removed.', 'Delete', () => {
      const t0 = stamp();
      for (const t of used) { t.cat = fallback; t.u = t0; }
      if (state.budgets[id] !== undefined) { delete state.budgets[id]; state.budgetsU = t0; }
      state.categories = state.categories.filter((x) => x.id !== id);
      state.deleted[id] = t0;
      if (state.prefs.catFilter === id) state.prefs.catFilter = 'all';
      setCustomCategories(state.categories);
      save(state); render(); schedulePush();
      toast('Category deleted');
      manageCategories();
    });
  },
  'manage-pockets': managePockets,
  'open-pocket': (el) => openPocket(el.dataset.id),
  'add-pocket': () => pocketForm(null),
  'edit-pocket': (el) => pocketForm(el.dataset.id),
  'pocket-kind': (el) => { pocketDraft.kind = el.dataset.value; const f = $('#pocket-form'); drawPocketForm(f.balance.value, f.name.value); },
  'pocket-color': (el) => { pocketDraft.color = el.dataset.value; pressIn(el, 'pocket-color'); },
  'delete-pocket': (el) => {
    const id = el.dataset.id;
    if (pocketHasTx(id)) { $('#pocket-error').textContent = 'This pocket has transactions. Move or delete them first.'; return; }
    askConfirm(`Delete ${pocketName(id)}?`, 'The pocket will be removed. This cannot be undone.', 'Delete', () => {
      state.accounts = pockets().filter((p) => p.id !== id);
      state.deleted[id] = stamp();
      for (const g of state.goals) if (g.pocket === id) { if (g.track === 'pocket') g.saved = 0; g.pocket = ''; g.track = 'manual'; g.u = stamp(); }
      if (state.prefs.pocketFilter === id) state.prefs.pocketFilter = 'all';
      closeSheet(); commit('Pocket deleted');
    });
  },
  'pocket-transactions': (el) => { state.prefs.pocketFilter = el.dataset.id; state.prefs.catFilter = 'all'; save(state); closeSheet(); if (location.hash === '#/activity') render(); else location.hash = '#/activity'; },
  'pocket-filter-here': (el) => { state.prefs.pocketFilter = el.dataset.value; save(state); pressIn(el, 'pocket-filter-here'); $('#tx-list').innerHTML = activityList(); },
  'cat-filter-here': (el) => { state.prefs.catFilter = el.dataset.value; save(state); pressIn(el, 'cat-filter-here'); $('#tx-list').innerHTML = activityList(); },
  'set-period': (el) => { state.prefs.period = el.dataset.value; commit(); },
  'set-stats-tab': (el) => { state.prefs.statsTab = el.dataset.value; commit(); },
  'set-plan-tab': (el) => { state.prefs.planTab = el.dataset.value; save(state); if (location.hash !== '#/plan') location.hash = '#/plan'; else render(); },
  'hide-banner': () => { state.prefs.bannerHiddenOn = isoDate(now()); commit(); },
  'set-asset': (el) => { state.prefs.asset = el.dataset.value; commit(); },
  'set-monthly': (el) => { state.prefs.monthly = Number(el.dataset.value); commit(); },
  'add-budget': () => budgetSheet(),
  'edit-budget': (el) => budgetSheet(el.dataset.id),
  'delete-budget': (el) => { delete state.budgets[el.dataset.id]; state.budgetsU = stamp(); closeSheet(); commit('Budget removed'); },
  'add-goal': () => { newGoalIcon = 'goal'; newGoalSheet(); },
  'edit-goal': (el) => { goalMode = 'add'; goalSheet(el.dataset.id); },
  'goal-mode': (el) => {
    goalMode = el.dataset.value; pressIn(el, 'goal-mode');
    const lbl = $('#goal-move-label'); const sel = $('#goal-pocket');
    if (lbl && sel) { const n = pocketName(sel.value); lbl.textContent = goalMode === 'add' ? `Move it into ${n} from` : `Move it from ${n} to`; }
  },
  'goal-transfer': (el) => {
    const g = state.goals.find((x) => x.id === el.dataset.id);
    if (!g) return;
    closeSheet(); txSheet();
    txDraft.type = 'transfer'; txDraft.toAccount = g.pocket;
    txDraft.account = (pockets().find((p) => p.id !== g.pocket && p.id === newTxPocket()) || pockets().find((p) => p.id !== g.pocket) || {}).id || '';
    txDraft.name = `Saving for ${g.name}`;
    drawTxSheet();
  },
  'goal-icon': (el) => { newGoalIcon = el.dataset.value; pressIn(el, 'goal-icon'); },
  'quick-amount': (el) => {
    const input = $('#goal-form').amount;
    input.value = groupDigits((parseAmount(input.value) || 0) + Number(el.dataset.value));
  },
  'delete-goal': (el) => {
    const id = el.dataset.id;
    const g = state.goals.find((x) => x.id === id);
    askConfirm('Delete goal?', `"${g ? g.name : 'This goal'}" and its saved amount will be removed.`, 'Delete', () => {
      state.goals = state.goals.filter((x) => x.id !== id);
      state.deleted[id] = stamp();
      closeSheet(); commit('Goal deleted');
    });
  },
  notifications: notificationsSheet,
  payments: paymentsSheet,
  'recurring-picker': recurringPicker,
  'toggle-recurring': toggleRecurring,
  lesson: lessonSheet,
  'data-menu': dataSheet,
  'export-csv': () => { exportCsv(); toast('CSV downloaded'); },
  'start-empty': () => askConfirm('Delete all data?',
    cloud.email ? 'Every transaction, budget and goal will be removed from this device and from your cloud account. This cannot be undone.'
      : 'Every transaction, budget and goal on this device will be removed. This cannot be undone.', 'Delete all', () => {
    const t = stamp();
    const deleted = { ...state.deleted };
    for (const x of [...state.transactions, ...state.goals]) deleted[x.id] = t;
    const { prefs, nameU, accounts } = state;
    state = emptyState(); state.prefs = prefs; state.nameU = nameU; state.deleted = deleted; state.budgetsU = t;
    state.accounts = accounts || state.accounts; // keep your pockets
    closeSheet(); commit('All data deleted');
  }),
  'open-auth': () => authSheet('signin'),
  'auth-mode': (el) => (gateEl.hidden ? authSheet(el.dataset.value, true) : showGate(el.dataset.value)),
  'sync-now': () => { syncNow(true); },
  'sign-out': () => askConfirm('Sign out?', 'Your data stays safe in your account. It will be removed from this device until you sign in again.', 'Sign out', signOut),
  'open-income': () => { txSheet(); txDraft.type = 'income'; txDraft.method = 'Bank transfer'; drawTxSheet(); },
  soon: (el) => toast(`${el.dataset.value} is coming soon`)
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('submit', (e) => {
  if (!sheetSubmit) return;
  e.preventDefault();
  sheetSubmit();
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-money]')) {
    const atEnd = el.selectionStart === el.value.length;
    el.value = groupDigits(el.value);
    if (atEnd) el.setSelectionRange(el.value.length, el.value.length);
  }
  if (el.id === 'tx-search') {
    activitySearch = el.value;
    $('#tx-list').innerHTML = activityList();
  }
  if (el.id === 'name-input') {
    state.prefs.name = el.value.trim();
    state.nameU = stamp();
    save(state);
    schedulePush();
    if (currentTab === 'home') $('#appbar').innerHTML = appbarHtml({ header: 'welcome' });
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-pocket') { state.prefs.importPocket = el.value; save(state); return; }
  if (el.id === 'goal-pocket' || el.id === 'goal-track') {
    const title = $('#sheet-title').textContent;
    const g = state.goals.find((x) => x.name === title) || null;
    const gid = $('#goal-form [data-action="delete-goal"]')?.dataset.id;
    const goal = state.goals.find((x) => x.id === gid) || g;
    if (!goal) return;
    if (el.id === 'goal-pocket') {
      if (goalTracksPocket(goal)) goal.saved = goalSaved(goal); // keep the amount when unlinking
      goal.pocket = el.value; if (!el.value) goal.track = 'manual';
    } else {
      if (!el.checked) goal.saved = goalSaved(goal);
      goal.track = el.checked ? 'pocket' : 'manual';
    }
    goal.u = stamp(); save(state); render(); schedulePush();
    goalSheet(goal.id);
    return;
  }
  if (el.id === 'newgoal-pocket') {
    const row = $('#newgoal-track-row'); if (row) row.hidden = !el.value;
    if (!el.value) { const cb = row?.querySelector('input'); if (cb) cb.checked = false; $('#newgoal-saved-field').hidden = false; }
    return;
  }
  if (el.name === 'track' && el.closest('#newgoal-form')) { $('#newgoal-saved-field').hidden = el.checked; return; }
  if (el.id === 'cycle-day') { state.cycleDay = Number(el.value); state.cycleU = stamp(); save(state); render(); schedulePush(); toast(`Your month now runs ${cycleLabel()}`); return; }
  if (el.id === 'import-file' && el.files && el.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = importCsvText(String(reader.result));
        closeSheet();
        commit(`Imported ${r.added} transaction${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} already in the app` : ''}${r.bad ? `, ${r.bad} unreadable` : ''}`);
      } catch (err) { toast(err.message || 'Could not read that file'); }
    };
    reader.onerror = () => toast('Could not read that file');
    reader.readAsText(el.files[0]);
  }
});

/* Toast */
let toastTimer;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* Keep data in sync if the app is open in two tabs */
window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); render(); } });

/* =========================================================
   Cloud sync (Cloudflare Pages Functions + D1)
   ========================================================= */
const cloud = {
  available: window.RENCANA_PREVIEW ? false : null, // null = not checked yet
  reason: '', needsCode: false,
  email: null, owner: null, version: 0, status: 'idle', lastSync: 0, lastPushed: ''
};
{
  const meta = loadCloudMeta();
  if (!window.RENCANA_PREVIEW) {
    cloud.owner = meta.owner || meta.email || null;
    if (meta.email) { cloud.email = meta.email; cloud.version = meta.version || 0; cloud.lastSync = meta.lastSync || 0; }
  }
}
const persistMeta = () => saveCloudMeta({ email: cloud.email || null, owner: cloud.owner || null, version: cloud.email ? cloud.version : 0, lastSync: cloud.email ? cloud.lastSync : 0 });

function syncLabel() {
  if (cloud.status === 'syncing') return 'Syncing…';
  if (cloud.status === 'offline') return 'Offline';
  if (cloud.status === 'error') return 'Not synced';
  if (!cloud.lastSync) return 'Not synced yet';
  const mins = Math.round((Date.now() - cloud.lastSync) / 60000);
  return mins < 1 ? 'Synced just now' : mins < 60 ? `Synced ${mins} min ago` : `Synced ${new Date(cloud.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
function syncChipStyle() {
  return cloud.status === 'error' || cloud.status === 'offline' ? 'background:#FDE7E7;color:#B42318' : 'background:#fff;color:var(--pos)';
}
function refreshCloudUi() {
  const card = $('#cloud-card');
  if (card) card.innerHTML = cloudCard();
}
function setStatus(s) { cloud.status = s; refreshCloudUi(); }

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  const type = res.headers.get('Content-Type') || '';
  if (type.includes('application/json')) data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data, json: !!data };
}

function applyDoc(doc) {
  state.transactions = doc.transactions || [];
  state.goals = doc.goals || [];
  state.accounts = doc.accounts || [];
  state.categories = doc.categories || [];
  setCustomCategories(state.categories);
  state.cycleDay = doc.cycleDay || 25;
  state.cycleU = doc.cycleU || 0;
  state.budgets = doc.budgets || {};
  state.budgetsU = doc.budgetsU || 0;
  state.deleted = doc.deleted || {};
  state.openingBalance = doc.openingBalance || 0;
  state.prefs.name = doc.name || '';
  state.nameU = doc.nameU || 0;
  save(state);
}

let pushTimer = null, busy = false, again = false;
function schedulePush() {
  if (!cloud.email || cloud.available === false) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow(false), 1200);
}

/** Pull the cloud copy, merge it with this device, and upload the result if anything changed. */
async function syncNow(manual) {
  if (!cloud.email || cloud.available === false) return;
  if (busy) { again = true; return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  busy = true; setStatus('syncing');
  try {
    const got = await api('state');
    if (got.status === 401) return sessionExpired();
    if (!got.ok || !got.json) throw new Error(got.data?.error || 'Sync failed');
    let serverVersion = got.data.version;
    let merged = mergeDocs(toDoc(state), got.data.doc || {});
    const before = JSON.stringify(toDoc(state));
    if (JSON.stringify(merged) !== before) { applyDoc(merged); render(); }

    let text = JSON.stringify(merged);
    if (text !== JSON.stringify(got.data.doc) ) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const put = await api('state', { method: 'PUT', body: { doc: merged, baseVersion: serverVersion } });
        if (put.ok) { serverVersion = put.data.version; break; }
        if (put.status === 409 && put.data) {
          merged = mergeDocs(toDoc(state), put.data.doc || {});
          applyDoc(merged); render();
          serverVersion = put.data.version;
          continue;
        }
        if (put.status === 401) return sessionExpired();
        throw new Error(put.data?.error || 'Sync failed');
      }
    }
    cloud.version = serverVersion; cloud.lastSync = Date.now(); cloud.lastPushed = text;
    persistMeta(); setStatus('synced');
    if (manual) toast('Synced');
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline');
    if (manual) toast(navigator.onLine ? 'Couldn’t sync. Try again in a moment.' : 'You’re offline. It will sync when you’re back online.');
  } finally {
    busy = false;
    if (again) { again = false; schedulePush(); }
  }
}

function sessionExpired() {
  cloud.email = null; cloud.version = 0; persistMeta(); setStatus('idle');
  showGate('signin', 'Your session ended. Sign in again to continue.');
}

async function checkCloud() {
  if (window.RENCANA_PREVIEW) return;
  try {
    const me = await api('me');
    if (!me.json) { cloud.available = false; cloud.reason = 'missing'; refreshCloudUi(); hideGate(); return; }
    if (me.status === 503) { cloud.available = false; cloud.reason = me.data.code || 'no_db'; refreshCloudUi(); hideGate(); return; }
    cloud.available = true;
    cloud.needsCode = !!me.data.needsCode;
    if (me.data.signedIn) {
      if (cloud.owner && cloud.owner !== me.data.email) wipeLocal();
      cloud.email = me.data.email; cloud.owner = me.data.email; persistMeta();
      hideGate(); render();
      syncNow(false);
    } else if (cloud.email) {
      sessionExpired();
    } else {
      showGate('signin');
    }
    refreshCloudUi();
  } catch (e) {
    // offline or no server
    if (cloud.email) setStatus('offline');
    else showGate('signin', 'You’re offline. Connect to the internet to sign in.');
  }
}

/* ---------- Sign-in front page ---------- */
const gateEl = document.createElement('div');
gateEl.className = 'gate';
gateEl.id = 'gate';
gateEl.hidden = true;
$('#app').appendChild(gateEl);

function authFormHtml(mode, note, intro) {
  const create = mode === 'create';
  return `
    <form id="auth-form" class="stack" style="gap:16px" novalidate>
      ${seg([['signin', 'Sign in'], ['create', 'Create account']], 'auth-mode', mode)}
      ${note ? `<p class="t-small" style="color:var(--primary-700);background:var(--primary-50);padding:10px 12px;border-radius:12px">${esc(note)}</p>` : ''}
      ${intro ? `<p class="t-body" style="color:var(--ink-2)">${intro}</p>` : ''}
      <label class="field"><span>Email</span><input class="input" type="email" name="email" id="auth-email" autocomplete="email" inputmode="email" required></label>
      <label class="field"><span>Password${create ? ' (at least 8 characters)' : ''}</span><input class="input" type="password" name="password" id="auth-password" autocomplete="${create ? 'new-password' : 'current-password'}" minlength="8" required></label>
      ${create && cloud.needsCode ? '<label class="field"><span>Invite code</span><input class="input" name="code" id="auth-code" autocomplete="off" required></label>' : ''}
      <p class="t-small neg" id="auth-error" role="alert"></p>
      <button type="submit" class="btn primary" id="auth-submit">${create ? 'Create account' : 'Sign in'}</button>
    </form>`;
}

let gateNote = '';
function showGate(mode = 'signin', note) {
  if (window.RENCANA_PREVIEW) return;
  authMode = mode;
  if (note !== undefined) gateNote = note;
  const keepEmail = $('#auth-email')?.value || '';
  closeSheet();
  const loading = cloud.available === null && !gateNote;
  gateEl.innerHTML = `
    <div class="gate-hero">
      <div class="gate-logo" aria-hidden="true"><span class="logo-n">n</span><span class="logo-dot"></span></div>
      <h1>Jon Pocket</h1>
      <p>Track your spending, plan budgets and grow your savings.</p>
    </div>
    <div class="gate-card">
      ${loading ? '<p class="t-label" style="text-align:center;padding:24px 0">Loading…</p>' : authFormHtml(mode, gateNote)}
      <p class="t-small" style="text-align:center">Your data is private to your account. Nobody else can see it.</p>
    </div>`;
  gateEl.hidden = false;
  sheetSubmit = submitAuth;
  if (keepEmail && $('#auth-email')) $('#auth-email').value = keepEmail;
}
function hideGate() {
  if (gateEl.hidden) return;
  gateEl.hidden = true;
  gateEl.innerHTML = '';
  gateNote = '';
  sheetSubmit = null;
}

let authMode = 'signin';
function authSheet(mode = 'signin', redraw = false) {
  authMode = mode;
  const body = authFormHtml(mode, '', mode === 'create'
    ? 'Create an account to back up your data. Anything already on this device will be added to it.'
    : 'Sign in to load your data. Anything on this device will be merged with your account.');
  const keep = redraw ? { email: $('#auth-email')?.value || '' } : null;
  const title = mode === 'create' ? 'Create account' : 'Sign in';
  if (sheetEl.hidden || !redraw) openSheet(title, body, submitAuth);
  else { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = body; sheetSubmit = submitAuth; }
  if (keep) $('#auth-email').value = keep.email;
}

/** Remove everything from this device (used when a different account signs in). */
function wipeLocal() {
  const prefs = { ...state.prefs, name: '', catFilter: 'all' };
  state = emptyState(); state.prefs = prefs; save(state);
}

async function submitAuth() {
  const f = $('#auth-form');
  const err = $('#auth-error');
  const email = f.email.value.trim();
  const password = f.password.value;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }
  if (authMode === 'create' && password.length < 8) { err.textContent = 'Use a password with at least 8 characters.'; return; }
  const btn = $('#auth-submit'); btn.disabled = true; btn.textContent = authMode === 'create' ? 'Creating account…' : 'Signing in…';
  const reset = () => { btn.disabled = false; btn.textContent = authMode === 'create' ? 'Create account' : 'Sign in'; };
  try {
    const res = await api(authMode === 'create' ? 'signup' : 'login', { method: 'POST', body: { email, password, code: f.code ? f.code.value.trim() : undefined } });
    if (!res.ok) {
      err.textContent = res.data?.error || (res.json ? 'That didn’t work. Try again.' : 'Sign-in isn’t available here.');
      reset();
      return;
    }
    const account = res.data.email;
    // Data on this device that belongs to a different account must never reach this one.
    if (cloud.owner && cloud.owner !== account) wipeLocal();
    cloud.available = true;
    cloud.email = account; cloud.owner = account; cloud.version = 0; persistMeta();
    closeSheet(); hideGate(); render();
    toast(authMode === 'create' ? 'Welcome to Jon Pocket!' : 'Signed in');
    await syncNow(false);
  } catch (e) {
    err.textContent = 'Couldn’t reach the server. Check your connection and try again.';
    reset();
  }
}

async function signOut() {
  clearTimeout(pushTimer);
  try { if (navigator.onLine) await syncNow(false); } catch (e) { /* ignore */ }
  try { await api('logout', { method: 'POST', body: {} }); } catch (e) { /* ignore */ }
  cloud.email = null; cloud.owner = null; cloud.version = 0; cloud.lastSync = 0; persistMeta();
  wipeLocal();
  closeSheet(); render();
  if (cloud.available) showGate('signin', '');
  toast('Signed out');
}

window.addEventListener('online', () => { if (cloud.email) syncNow(false); });
let lastFocusSync = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cloud.email && Date.now() - lastFocusSync > 30000) {
    lastFocusSync = Date.now();
    syncNow(false);
  }
});

/* Installable + offline */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

render();
if (!window.RENCANA_PREVIEW && !cloud.email) showGate('signin');
checkCloud();
