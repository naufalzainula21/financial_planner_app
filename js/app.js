// Jon Pocket — budget tracker web app (no framework, no build step).
import { load, save, emptyState, STORAGE_KEY, toDoc, mergeDocs, loadCloudMeta, saveCloudMeta } from './data.js';
import {
  idr, idrSigned, idrShort, parseAmount, groupDigits, isoDate, monthKey, monthLabel, shortMonth,
  shortDay, esc, uid
} from './format.js';
import { svg, CATEGORIES, catsOf, catTile, goalTile, GOAL_ICONS, GOAL_COLORS } from './icons.js';

let state = load();
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
const inMonth = (t, d = now()) => t.date.slice(0, 7) === monthKey(d);
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
const pocketIcon = (p, size = 40) => `<span class="pocket-icon" style="width:${size}px;height:${size}px;background:${p.color || '#5B4CF0'}">${svg(p.kind === 'ewallet' ? 'wallet' : 'bank')}</span>`;
const goalsSaved = () => state.goals.reduce((s, g) => s + g.saved, 0);

function spentByCat(list) {
  const m = {};
  for (const t of list) if (t.type === 'expense') m[t.cat] = (m[t.cat] || 0) + t.amount;
  return m;
}
function daysLeftInMonth() {
  const d = now();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
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

/* =========================================================
   Pages
   ========================================================= */
const TX_FILTERS = [
  ['all', 'All', 'grid'], ['income', 'Income', 'income'], ['recurring', 'Recurring', 'repeat'], ['food', 'Food', 'food'], ['transport', 'Transport', 'transport'],
  ['shopping', 'Shopping', 'shopping'], ['bills', 'Bills', 'bills'], ['health', 'Health', 'health'], ['fun', 'Fun', 'fun'], ['other', 'Other', 'other']
];
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
          <span class="t-small">${monthName} ${now().getFullYear()} · ${m.net >= 0 ? 'saved' : 'overspent'} ${money(Math.abs(m.net), true)}</span>
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

      <section class="card lg stack" aria-label="Spent this month" style="gap:12px">
        <div class="between"><span class="t-h3">Spent this month</span><a class="see-all" href="#/plan/budgets">Budgets</a></div>
        <div class="between" style="align-items:flex-end">
          <span class="t-stat">${money(m.expense)}</span>
          ${noBudget ? '' : `<span class="t-label">${b.p}% of budget</span>`}
        </div>
        ${noBudget ? `
          <button type="button" class="tile-btn" data-action="add-budget" style="background:var(--primary-50);border:0">
            <span class="stack" style="gap:0"><span class="t-strong">Set a monthly budget</span><span class="t-small">See how much you can still spend</span></span>${svg('chev', 'class="chev"')}
          </button>` : `
          ${bar(b.p, b.p >= 100 ? 'var(--neg)' : b.p >= 90 ? '#F29E0C' : '')}
          <span class="t-small" style="color:${b.p >= 100 ? 'var(--neg)' : 'var(--ink-2)'}">${budgetMsg}</span>
          <div class="stack" style="gap:10px;padding-top:4px">
            ${topBudgets.map(([cat, limit]) => {
              const sp = b.spent[cat] || 0, p = pct(sp, limit), c = CATEGORIES[cat] || CATEGORIES.other;
              return `<div class="row" style="gap:10px">${catTile(cat, true)}<div class="grow stack" style="gap:5px">
                <div class="between"><span class="t-body" style="font-weight:500">${esc(c.short)}</span><span class="t-small" style="color:${p >= 90 ? 'var(--neg)' : 'var(--muted)'}">${idrShort(sp)} / ${idrShort(limit)}</span></div>
                ${bar(p, p >= 90 ? 'var(--neg)' : c.color, 'thin')}</div></div>`;
            }).join('')}
          </div>`}
      </section>

      <section class="card lg stack" aria-label="Goals" style="gap:12px">
        <div class="between"><span class="t-h3">Goals</span><a class="see-all" href="#/plan/goals">${state.goals.length ? 'See all' : ''}</a></div>
        ${state.goals.length ? state.goals.slice(0, 3).map((g) => {
          const p = pct(g.saved, g.target);
          return `<button type="button" class="row" data-action="edit-goal" data-id="${g.id}" style="gap:10px;border:0;background:none;padding:0;text-align:left;width:100%;color:var(--ink)">
            ${goalTile(g.icon, g.color)}
            <span class="grow stack" style="gap:5px">
              <span class="between"><span class="t-body ellipsis" style="font-weight:500">${esc(g.name)}</span><span class="t-small">${p}%</span></span>
              ${bar(p, g.color, 'thin')}
              <span class="t-small">${money(g.saved, true)} of ${idrShort(g.target)}</span>
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
        ${TX_FILTERS.map(([id, label, icon]) => `
          <button type="button" class="cat-btn" data-action="cat-filter-here" data-value="${id}" aria-pressed="${id === f}">
            <span class="circle">${svg(icon)}</span>${label}
          </button>`).join('')}
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
      from = new Date(d.getFullYear(), d.getMonth(), 1);
      for (let i = 1; i <= d.getDate(); i++) { const day = new Date(d.getFullYear(), d.getMonth(), i); values.push(exp(day, day)); labels.push(String(i)); }
      rangeLabel = monthLabel(d);
    } else {
      from = new Date(d.getFullYear(), d.getMonth() - 11, 1);
      for (let i = 0; i < 12; i++) {
        const a = new Date(from.getFullYear(), from.getMonth() + i, 1), b = new Date(a.getFullYear(), a.getMonth() + 1, 0);
        values.push(exp(a, b)); labels.push(a.toLocaleDateString('en-GB', { month: 'short' }));
      }
      rangeLabel = `${shortMonth(from)} – ${shortMonth(d)}`;
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
      <div class="glass"><span class="t-small">Daily allowance for the rest of ${now().toLocaleDateString('en-GB', { month: 'long' })}</span><b style="font-size:16px">${money(perDay)}/day</b></div>
    </section>

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
        const p = pct(g.saved, g.target);
        const per = Math.ceil(Math.max(0, g.target - g.saved) / monthsUntil(g.due) / 10000) * 10000;
        const due = shortMonth(new Date(g.due + '-01T00:00:00'));
        return `
        <div class="tx" style="align-items:flex-start">
          ${goalTile(g.icon, g.color)}
          <div class="meta" style="gap:6px">
            <div class="between"><span class="name ellipsis">${esc(g.name)}</span><b style="font-size:14px">${money(g.saved, true)}</b></div>
            ${g.members?.length ? `<span class="row" style="gap:6px"><span class="avatars">${g.members.map((mb) => `<span style="background:${mb.bg}">${esc(mb.i)}</span>`).join('')}</span><span class="t-small">${g.members.length} members · by ${due}</span></span>`
              : `<span class="t-small">By ${due} · of ${idrShort(g.target)}</span>`}
            ${bar(p, g.color)}
            <div class="between"><button type="button" class="view" data-action="edit-goal" data-id="${g.id}">Add money</button><span class="t-small">${p >= 100 ? 'Goal reached' : `Save ${idrShort(per)}/mo · ${p}%`}</span></div>
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
    if (g.saved < g.target && m <= 3) out.push({ goal: g, text: `${g.name}: ${idr(g.target - g.saved)} to go, due in ${m} month${m === 1 ? '' : 's'}.` });
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
          ${cats.map((c) => `<button type="button" class="pill" data-action="tx-cat" data-value="${c}" aria-pressed="${c === d.cat}">${CATEGORIES[c].label}</button>`).join('')}
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

function goalSheet(id) {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return newGoalSheet();
  const left = Math.max(0, g.target - g.saved);
  openSheet(g.name, `
    <form id="goal-form" class="stack" style="gap:16px" novalidate>
      <div class="stack" style="gap:8px;background:var(--primary-50);border-radius:16px;padding:16px">
        <div class="between"><span class="t-label">Saved</span><span class="t-strong">${idr(g.saved)} of ${idr(g.target)}</span></div>
        ${bar(pct(g.saved, g.target), g.color)}
        <span class="t-small">${left ? `${idr(left)} to go` : 'Goal reached!'}</span>
      </div>
      ${seg([['add', 'Add money'], ['withdraw', 'Take out']], 'goal-mode', goalMode)}
      <label class="field"><span>Amount</span>
        <span class="amount-input"><b>Rp</b><input name="amount" inputmode="numeric" placeholder="0" data-money></span>
      </label>
      <div class="pills">${[500000, 1000000, 2000000].map((v) => `<button type="button" class="pill" data-action="quick-amount" data-value="${v}">+${idrShort(v)}</button>`).join('')}</div>
      <p class="t-small neg" id="goal-error" role="alert"></p>
      <div class="btn-row">
        <button type="button" class="btn danger" data-action="delete-goal" data-id="${g.id}">Delete</button>
        <button type="submit" class="btn primary">Update goal</button>
      </div>
    </form>`, () => {
    const amt = parseAmount($('#goal-form').amount.value);
    if (!amt || amt <= 0) { $('#goal-error').textContent = 'Enter an amount above zero.'; return; }
    g.saved = Math.max(0, g.saved + (goalMode === 'add' ? amt : -amt));
    g.u = stamp();
    closeSheet();
    commit(goalMode === 'add' ? `Added ${idr(amt)} to ${g.name}` : `Took ${idr(amt)} from ${g.name}`);
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
      <div class="grid-2">
        <label class="field"><span>Already saved</span><input class="input" name="saved" inputmode="numeric" placeholder="0" data-money></label>
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
    state.goals.push({ id: uid(), name, icon: newGoalIcon, color: GOAL_COLORS[state.goals.length % GOAL_COLORS.length], saved: Math.round(saved), target: Math.round(target), due: f.due.value || def, members: [], u: stamp() });
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
          <div class="meta"><span class="name ellipsis">${esc(p.name)}</span><span class="t-small">${p.kind === 'ewallet' ? 'E-wallet' : 'Bank'} · ${money(pocketBalance(p.id))}</span></div>
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
      <div class="row" style="gap:12px">${pocketIcon(p, 44)}<span class="stack" style="gap:0"><span class="t-small">${p.kind === 'ewallet' ? 'E-wallet' : 'Bank account'} balance</span><span class="t-stat">${money(pocketBalance(id))}</span></span></div>
      <div class="between t-small" style="padding-top:6px"><span>In this month: <b class="pos">${money(inM, true)}</b></span><span>Out: <b class="neg">${money(outM, true)}</b></span></div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" style="min-height:46px;background:var(--chip);color:var(--ink)" data-action="edit-pocket" data-id="${id}">Edit pocket</button>
      <button type="button" class="btn" style="min-height:46px;background:var(--primary-50);color:var(--primary)" data-action="pocket-transactions" data-id="${id}">All transactions</button>
    </div>
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
      <label class="field"><span>Name</span><input class="input" name="name" maxlength="30" placeholder="e.g. Bank Jago, Dana, Cash" value="${esc(nameText ?? d.name)}" required></label>
      ${seg([['bank', 'Bank account'], ['ewallet', 'E-wallet']], 'pocket-kind', d.kind)}
      <label class="field"><span>Current balance</span>
        <span class="amount-input"><b>Rp</b><input name="balance" inputmode="numeric" placeholder="0" data-money value="${esc(balanceText)}"></span>
      </label>
      <p class="t-small" style="margin-top:-8px">Type what the ${d.kind === 'ewallet' ? 'e-wallet' : 'bank'} app shows right now. Jon Pocket keeps it up to date as you add transactions.</p>
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
    ${window.RENCANA_PREVIEW ? '' : `<button type="button" class="tile-btn" data-action="export-csv" ><span class="row" style="gap:12px">${catTile('income')}<span class="stack" style="gap:0"><span class="t-strong">Export transactions</span><span class="t-small">Download a CSV for Excel or Sheets</span></span></span></button>`}
    <label class="field"><span>Imported transactions go to</span><select class="input" id="import-pocket">${pockets().map((p) => `<option value="${p.id}" ${p.id === (pocketById(state.prefs.importPocket) ? state.prefs.importPocket : legacyPocket()) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="tile-btn" style="cursor:pointer"><span class="row" style="gap:12px"><span class="cat" style="background:var(--primary-50);color:var(--primary)">${svg('download')}</span><span class="stack" style="gap:0"><span class="t-strong">Import transactions</span><span class="t-small">Add a CSV file (same format as the export)</span></span></span><input type="file" id="import-file" accept=".csv,text/csv" class="sr-only"></label>
    <button type="button" class="tile-btn" data-action="start-empty" ><span class="row" style="gap:12px"><span class="cat" style="background:#FDE7E7;color:#B42318">${svg('reset')}</span><span class="stack" style="gap:0"><span class="t-strong">Delete all data</span><span class="t-small">Remove every transaction, budget and goal</span></span></span></button>`);
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
  'goal-mode': (el) => { goalMode = el.dataset.value; pressIn(el, 'goal-mode'); },
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
