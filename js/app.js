// Rencana — budget tracker web app (no framework, no build step).
import { load, save, demoState, emptyState, PORTFOLIO } from './data.js';
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
}

/* =========================================================
   Derived numbers
   ========================================================= */
const now = () => new Date();
const DAY = 86400000;
const inMonth = (t, d = now()) => t.date.slice(0, 7) === monthKey(d);
const toDate = (iso) => new Date(iso + 'T00:00:00');

function totals(list) {
  let income = 0, expense = 0;
  for (const t of list) t.type === 'income' ? (income += t.amount) : (expense += t.amount);
  return { income, expense, net: income - expense };
}
const monthTx = () => state.transactions.filter((t) => inMonth(t));
const balance = () => state.openingBalance + totals(state.transactions).net;
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
  const c = CATEGORIES[t.cat] || CATEGORIES.other;
  const signed = t.type === 'income' ? t.amount : -t.amount;
  return `
    <div class="tx">
      ${catTile(t.cat)}
      <div class="meta">
        <span class="name ellipsis">${esc(t.name)}</span>
        <span class="t-small ellipsis">${esc(t.method || c.label)}</span>
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
const HOME_CATS = [
  ['recurring', 'Recurring', 'repeat'], ['food', 'Food', 'food'], ['transport', 'Transport', 'transport'], ['shopping', 'Shopping', 'shopping'],
  ['bills', 'Bills', 'bills'], ['health', 'Health', 'health'], ['fun', 'Fun', 'fun'], ['income', 'Income', 'income']
];

const PAGES = {
  home() {
    const m = totals(monthTx());
    const b = budgetSummary();
    const recent = sortedTx(state.transactions).slice(0, 5);
    const monthName = now().toLocaleDateString('en-GB', { month: 'long' });
    const banner = b.p < 75 ? `You're doing great! <b>${idr(b.left)}</b> left in your budget.`
      : b.p < 100 ? `Heads up: only <b>${idr(b.left)}</b> left for ${daysLeftInMonth()} days.`
      : `You're over budget by <b>${idr(-b.left)}</b> this month.`;

    return {
      header: 'welcome',
      html: `
      <section class="hero" aria-label="Spending this month">
        <div class="between" style="align-items:center">
          <div class="stack" style="gap:2px;min-width:0">
            <span class="t-label">Spent</span>
            <span class="t-display">${money(b.used)}</span>
            <span class="t-small">of ${money(b.total)}</span>
          </div>
          ${ring(b.p, monthName)}
        </div>
        <div class="grid-3" style="gap:8px">
          <div class="glass"><span class="t-small">Balance</span><b style="font-size:14px">${money(balance(), true)}</b></div>
          <div class="glass"><span class="t-small">Income</span><b style="font-size:14px">${money(m.income, true)}</b></div>
          <div class="glass"><span class="t-small">Saved</span><b class="soft-pos" style="font-size:14px">${money(m.net, true)}</b></div>
        </div>
      </section>

      <div class="section-head"><h2>Categories</h2><a class="see-all" href="#/stats">See All</a></div>
      <div class="cat-grid">
        ${HOME_CATS.map(([id, label, icon]) => `
          <button type="button" class="cat-btn" data-action="cat-filter" data-value="${id}">
            <span class="circle">${svg(icon)}</span>${label}
          </button>`).join('')}
      </div>

      <button type="button" class="banner" data-action="lesson">
        <span class="art">${svg('piggy')}</span>
        <p>${banner}<br><span style="font-size:12px;font-weight:500;opacity:0.8">Tap to learn the 50/30/20 rule</span></p>
      </button>

      <div class="section-head"><h2>Recent</h2><a class="see-all" href="#/activity">See All</a></div>
      ${recent.length ? txList(recent) : '<p class="empty">No transactions yet. Tap + to add your first one.</p>'}
      `
    };
  },

  activity() {
    const f = state.prefs.catFilter;
    const chips = [['all', 'All'], ['income', 'Income'], ['recurring', 'Recurring'], ...catsOf('expense').map((c) => [c, CATEGORIES[c].short])];
    return {
      header: 'title', title: 'Transactions', action: 'data',
      html: `
      <div class="search-row">
        <label class="search">${svg('search')}<span class="sr-only">Search transactions</span>
          <input type="search" id="tx-search" placeholder="Search for transactions" autocomplete="off" value="${esc(activitySearch)}">
        </label>
        <button type="button" class="icon-btn soft" data-action="data-menu" aria-label="Data options">${svg('sliders')}</button>
      </div>
      ${textTabs(chips, 'cat-filter-here', f, 'Filter')}
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
    const showBanner = state.prefs.bannerHiddenOn !== isoDate(d);

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
        ${areaChart(values, labels, state.prefs.hide ? '' : idrShort(values[values.length - 1]))}
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
  const recurring = monthTx().filter((t) => t.method === 'Recurring').length;
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
      <span class="row" style="gap:12px">${catTile('bills')}<span class="stack" style="gap:0"><span class="t-strong">Recurring payments</span><span class="t-small">${recurring} this month</span></span></span>
      ${svg('chev', 'class="chev"')}
    </button>

    <div class="section-head"><h2>Categories</h2></div>
    <div class="list-card">
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
      <div class="stack" style="gap:2px"><span class="t-h3">50/30/20 check</span><span class="t-label">Based on ${idr(income)} income this month</span></div>
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
  const pf = PORTFOLIO[state.prefs.asset];
  const vals = pf.line.map((y) => 120 - y);
  const months = ['May', '', 'Jun', '', 'Jul', '', 'Aug', '', 'Sep', '', 'Oct'];
  const tiles = [['Available', 'Cash'], ['Compare with IHSG', 'Analytics'], ['Payouts & income', 'Dividends'], ['Prices & payouts', 'Alerts'], ['Diversification', 'Risk'], ['Profit this year', 'Taxes']];
  return `
    ${seg([['stocks', 'Stocks'], ['crypto', 'Crypto']], 'set-asset', state.prefs.asset)}
    <section class="hero" style="gap:4px">
      <span class="t-label">Portfolio value · sample data</span>
      <span class="t-display">${money(pf.value)}</span>
      <span class="row" style="gap:8px;margin-top:6px"><span class="chip gain">▲ ${idr(pf.gain)} · ${pf.pct}</span><span class="t-small">all time</span></span>
    </section>
    <div class="card" style="padding:14px">${areaChart(vals, months, '')}</div>
    <div class="grid-2">
      ${tiles.map(([sub, title]) => `<button type="button" class="tile-btn" data-action="soon" data-value="${title}"><span class="stack" style="gap:0;min-width:0"><span class="t-small">${sub}</span><span class="t-strong">${title}</span></span>${svg('chev', 'class="chev"')}</button>`).join('')}
    </div>
    <div class="section-head"><h2>Holdings</h2></div>
    <div class="list-card">
      ${pf.holdings.map((h) => `
        <div class="tx">
          <span class="cat" style="background:var(--primary-50);color:var(--primary-700);font-size:11px;font-weight:700">${h.sym}</span>
          <div class="meta"><span class="name">${h.name}</span><span class="t-small">${h.qty}</span></div>
          <div class="amt"><b style="color:var(--ink)">${money(h.value)}</b><span class="t-small" style="font-weight:600;color:${h.chg >= 0 ? 'var(--pos)' : 'var(--neg)'}">${h.chg > 0 ? '+' : ''}${h.chg.toFixed(1).replace('.', ',')}%</span></div>
        </div>`).join('')}
    </div>`;
}

/* Transactions list is rendered separately so typing in search keeps focus. */
let activitySearch = '';
function matchesFilter(t, f) {
  if (f === 'all') return true;
  if (f === 'income') return t.type === 'income';
  if (f === 'recurring') return t.method === 'Recurring';
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
      <a class="avatar" href="#/home" aria-label="Rencana home"><span class="logo-n">n</span><span class="logo-dot"></span></a>
      <div class="appbar-title"><span class="hello">Welcome back</span><h1>${esc(state.prefs.name)}</h1></div>
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
  document.title = `${page.title || 'Home'} · Rencana`;
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
const METHODS = ['Debit card', 'Credit card', 'E-wallet', 'Bank transfer', 'Cash', 'Recurring', 'Split bill'];

function txSheet(existing) {
  txDraft = existing ? { ...existing } : { id: null, type: 'expense', cat: 'food', amount: '', name: '', note: '', date: isoDate(now()), method: 'Debit card' };
  drawTxSheet();
}
function readTxForm() {
  const f = $('#tx-form');
  if (!f) return;
  txDraft.amount = f.amount.value; txDraft.name = f.name.value; txDraft.date = f.date.value;
  txDraft.method = f.method.value; txDraft.note = f.note.value;
}
function drawTxSheet() {
  const d = txDraft;
  const cats = catsOf(d.type);
  if (!cats.includes(d.cat)) d.cat = cats[0];
  const amount = typeof d.amount === 'number' ? groupDigits(d.amount) : d.amount;
  const body = `
    <form id="tx-form" class="stack" style="gap:16px" novalidate>
      ${seg([['expense', 'Expense'], ['income', 'Income']], 'tx-type', d.type)}
      <label class="field"><span>Amount</span>
        <span class="amount-input"><b>Rp</b><input name="amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(amount)}" data-money required></span>
      </label>
      <div class="field"><span>Category</span>
        <div class="pills" role="group" aria-label="Category">
          ${cats.map((c) => `<button type="button" class="pill" data-action="tx-cat" data-value="${c}" aria-pressed="${c === d.cat}">${CATEGORIES[c].label}</button>`).join('')}
        </div>
      </div>
      <label class="field"><span>Description</span><input class="input" name="name" maxlength="60" placeholder="${d.type === 'expense' ? 'e.g. Lunch with team' : 'e.g. Monthly salary'}" value="${esc(d.name)}"></label>
      <div class="grid-2">
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${esc(d.date)}" required></label>
        <label class="field"><span>Paid with</span><select class="input" name="method">${METHODS.map((m) => `<option ${m === d.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      </div>
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
  const rec = {
    id: txDraft.id || uid(), type: txDraft.type, cat: txDraft.cat, amount: Math.round(amount),
    name: txDraft.name.trim() || CATEGORIES[txDraft.cat].label, note: txDraft.note.trim(), date: txDraft.date, method: txDraft.method
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
    state.goals.push({ id: uid(), name, icon: newGoalIcon, color: GOAL_COLORS[state.goals.length % GOAL_COLORS.length], saved: Math.round(saved), target: Math.round(target), due: f.due.value || def, members: [] });
    closeSheet();
    commit('Goal created');
  });
}

/* ---------- Other sheets ---------- */
function notificationsSheet() {
  const list = notifications();
  openSheet('Notifications', list.length ? `<div class="list-card" style="box-shadow:none;border:1px solid var(--line)">${list.map((n) => `
    <div class="tx">${n.goal ? goalTile(n.goal.icon, n.goal.color) : catTile(n.icon)}<span class="t-body">${esc(n.text)}</span></div>`).join('')}</div>`
    : '<p class="empty">You’re all caught up.</p>');
}
function paymentsSheet() {
  const rec = sortedTx(monthTx().filter((t) => t.method === 'Recurring'));
  const total = rec.reduce((s, t) => s + t.amount, 0);
  openSheet('Recurring payments', `
    <p class="t-label">${rec.length} this month · ${idr(total)} total</p>
    ${rec.length ? txList(rec) : '<p class="empty">Mark a transaction as “Recurring” to see it here.</p>'}`);
}
function lessonSheet() {
  openSheet('The 50/30/20 rule', `
    <p class="t-body">Split your take-home income into three buckets:</p>
    <div class="list-card" style="box-shadow:none;border:1px solid var(--line)">
      <div class="tx"><span class="t-h2" style="width:56px;color:var(--primary)">50%</span><span class="t-body"><b>Needs</b>: rent, food, transport, bills, health.</span></div>
      <div class="tx"><span class="t-h2" style="width:56px;color:#B87A00">30%</span><span class="t-body"><b>Wants</b>: eating out, shopping, entertainment.</span></div>
      <div class="tx"><span class="t-h2" style="width:56px;color:var(--pos)">20%</span><span class="t-body"><b>Savings</b>: emergency fund, goals, investing.</span></div>
    </div>
    <p class="t-body" style="color:var(--ink-2)">It’s a starting point, not a law. If rent is high where you live, needs may take more. Just keep savings growing every month.</p>
    <a class="btn primary" href="#/plan/goals" style="display:flex;align-items:center;justify-content:center;text-decoration:none">See my 50/30/20 check</a>`);
}
function dataSheet() {
  openSheet('Your data', `
    <p class="t-body" style="color:var(--ink-2)">Everything is saved only in this browser on this device. Nothing is sent to a server.</p>
    <label class="field"><span>Your name</span><input class="input" id="name-input" maxlength="24" value="${esc(state.prefs.name)}"></label>
    ${window.RENCANA_PREVIEW ? '' : `<button type="button" class="tile-btn" data-action="export-csv" style="box-shadow:none;border:1px solid var(--line)"><span class="row" style="gap:12px">${catTile('income')}<span class="stack" style="gap:0"><span class="t-strong">Export transactions</span><span class="t-small">Download a CSV for Excel or Sheets</span></span></span></button>`}
    <button type="button" class="tile-btn" data-action="reset-demo" style="box-shadow:none;border:1px solid var(--line)"><span class="row" style="gap:12px">${catTile('other')}<span class="stack" style="gap:0"><span class="t-strong">Reload demo data</span><span class="t-small">Replace everything with sample data</span></span></span></button>
    <button type="button" class="tile-btn" data-action="start-empty" style="box-shadow:none;border:1px solid var(--line)"><span class="row" style="gap:12px">${catTile('shopping')}<span class="stack" style="gap:0"><span class="t-strong">Start fresh</span><span class="t-small">Clear transactions and goals, keep budgets</span></span></span></button>`);
}
function exportCsv() {
  const rows = [['Date', 'Type', 'Category', 'Description', 'Amount', 'Paid with', 'Note']];
  for (const t of sortedTx(state.transactions)) rows.push([t.date, t.type, CATEGORIES[t.cat]?.label || t.cat, t.name, t.type === 'income' ? t.amount : -t.amount, t.method, t.note || '']);
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
  'tx-type': (el) => { readTxForm(); txDraft.type = el.dataset.value; drawTxSheet(); },
  'tx-cat': (el) => { readTxForm(); txDraft.cat = el.dataset.value; drawTxSheet(); },
  'delete-tx': () => {
    readTxForm();
    const id = txDraft.id;
    askConfirm('Delete transaction?', `"${txDraft.name || 'This transaction'}" will be removed.`, 'Delete', () => {
      state.transactions = state.transactions.filter((t) => t.id !== id);
      closeSheet(); commit('Transaction deleted');
    });
  },
  'confirm-yes': () => { const f = confirmFn; confirmFn = null; if (f) f(); },
  'close-sheet': closeSheet,
  'toggle-hide': () => { state.prefs.hide = !state.prefs.hide; commit(state.prefs.hide ? 'Amounts hidden' : ''); },
  'cat-filter': (el) => { state.prefs.catFilter = el.dataset.value; activitySearch = ''; save(state); location.hash = '#/activity'; },
  'cat-filter-here': (el) => { state.prefs.catFilter = el.dataset.value; save(state); pressIn(el, 'cat-filter-here'); $('#tx-list').innerHTML = activityList(); },
  'set-period': (el) => { state.prefs.period = el.dataset.value; commit(); },
  'set-stats-tab': (el) => { state.prefs.statsTab = el.dataset.value; commit(); },
  'set-plan-tab': (el) => { state.prefs.planTab = el.dataset.value; save(state); if (location.hash !== '#/plan') location.hash = '#/plan'; else render(); },
  'hide-banner': () => { state.prefs.bannerHiddenOn = isoDate(now()); commit(); },
  'set-asset': (el) => { state.prefs.asset = el.dataset.value; commit(); },
  'set-monthly': (el) => { state.prefs.monthly = Number(el.dataset.value); commit(); },
  'add-budget': () => budgetSheet(),
  'edit-budget': (el) => budgetSheet(el.dataset.id),
  'delete-budget': (el) => { delete state.budgets[el.dataset.id]; closeSheet(); commit('Budget removed'); },
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
      closeSheet(); commit('Goal deleted');
    });
  },
  notifications: notificationsSheet,
  payments: paymentsSheet,
  lesson: lessonSheet,
  'data-menu': dataSheet,
  'export-csv': () => { exportCsv(); toast('CSV downloaded'); },
  'reset-demo': () => askConfirm('Reload demo data?', 'All your transactions, budgets and goals will be replaced with sample data.', 'Replace', () => {
    const name = state.prefs.name; state = demoState(); state.prefs.name = name; closeSheet(); commit('Demo data loaded');
  }),
  'start-empty': () => askConfirm('Start fresh?', 'All transactions and goals will be cleared. Your budgets stay. This cannot be undone.', 'Clear', () => {
    const { budgets, prefs } = state; state = emptyState(); state.budgets = budgets; state.prefs = prefs; closeSheet(); commit('Starting fresh');
  }),
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
    state.prefs.name = el.value.trim() || 'there';
    save(state);
    if (currentTab === 'home') $('#appbar h1').textContent = state.prefs.name;
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
window.addEventListener('storage', (e) => { if (e.key === 'rencana:v1') { state = load(); render(); } });

/* Installable + offline */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

render();
