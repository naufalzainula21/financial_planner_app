// Storage. Everything is saved in this browser's localStorage, on this device only.

// v2 = empty template. Data saved under the old demo key is ignored, so everyone starts clean.
const KEY = 'rencana:v2';
export const STORAGE_KEY = KEY;

export const DEFAULT_PREFS = {
  name: '', hide: false, catFilter: 'all', period: 'weekly', statsTab: 'categories',
  planTab: 'budgets', asset: 'stocks', monthly: 1000000, bannerHiddenOn: '',
  pocketFilter: 'all', lastPocket: '', importPocket: ''
};

/** Starting pockets. Fixed ids so two devices never create duplicates. */
export const DEFAULT_POCKETS = [
  { id: 'jago', name: 'Bank Jago', kind: 'bank', color: '#E89A00', opening: 0, u: 0 },
  { id: 'bca', name: 'BCA', kind: 'bank', color: '#0B5CAB', opening: 0, u: 0 },
  { id: 'gopay', name: 'GoPay', kind: 'ewallet', color: '#00A6CF', opening: 0, u: 0 },
  { id: 'ovo', name: 'OVO', kind: 'ewallet', color: '#4C3494', opening: 0, u: 0 }
];
const defaultPockets = () => DEFAULT_POCKETS.map((p) => ({ ...p }));

/** A brand-new, empty app: no transactions, budgets or goals. */
export function emptyState() {
  return {
    v: 2, openingBalance: 0, transactions: [], budgets: {}, goals: [], accounts: defaultPockets(), categories: [], prefs: { ...DEFAULT_PREFS },
    // sync bookkeeping: when budgets / name last changed, and ids deleted (id -> time)
    budgetsU: 0, nameU: 0, deleted: {},
    cycleDay: 25, cycleU: 0 // month runs from this day (payday) to the day before, next month
  };
}

/** Drop records that are missing what the app needs, so one bad entry can't break a screen. */
export const validTx = (t) => !!t && typeof t.id === 'string' && (t.type === 'income' || t.type === 'expense' || t.type === 'transfer')
  && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number(t.amount) > 0;
export const validCategory = (c) => !!c && typeof c.id === 'string' && typeof c.label === 'string' && c.label.trim() !== '' && (c.type === 'expense' || c.type === 'income');
export const validAccount = (a) => !!a && typeof a.id === 'string' && typeof a.name === 'string' && a.name.trim() !== '';
export const validGoal = (g) => !!g && typeof g.id === 'string' && typeof g.name === 'string'
  && Number(g.target) > 0 && typeof g.due === 'string' && /^\d{4}-\d{2}$/.test(g.due);

/** The part of the state that is synced to the cloud. */
export function toDoc(s) {
  return {
    transactions: s.transactions, goals: s.goals, accounts: s.accounts || [], categories: s.categories || [], budgets: s.budgets, budgetsU: s.budgetsU || 0,
    deleted: s.deleted || {}, openingBalance: s.openingBalance || 0, name: s.prefs?.name || '', nameU: s.nameU || 0,
    cycleDay: s.cycleDay || 25, cycleU: s.cycleU || 0
  };
}

/**
 * Merge two synced documents item by item: newest edit wins, deletions win over older edits.
 * Used when signing in with data already on the device, and when two devices saved at once.
 */
export function mergeDocs(a, b) {
  a = a || {}; b = b || {};
  const deleted = { ...(a.deleted || {}) };
  for (const [id, ts] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const list = (x = [], y = []) => {
    const m = new Map();
    for (const it of [...x, ...y]) {
      if (!it || !it.id) continue;
      const cur = m.get(it.id);
      if (!cur || (it.u || 0) > (cur.u || 0)) m.set(it.id, it);
    }
    return [...m.values()].filter((it) => !(deleted[it.id] >= (it.u || 0)));
  };
  const aB = a.budgetsU || 0, bB = b.budgetsU || 0;
  const aN = a.nameU || 0, bN = b.nameU || 0;
  return {
    transactions: list(a.transactions, b.transactions).filter(validTx),
    goals: list(a.goals, b.goals).filter(validGoal),
    accounts: list(a.accounts, b.accounts).filter(validAccount),
    categories: list(a.categories, b.categories).filter(validCategory),
    budgets: (aB >= bB ? a.budgets : b.budgets) || {},
    budgetsU: Math.max(aB, bB),
    deleted,
    openingBalance: a.openingBalance || b.openingBalance || 0,
    name: (aN >= bN ? a.name : b.name) || '',
    nameU: Math.max(aN, bN),
    cycleDay: ((a.cycleU || 0) >= (b.cycleU || 0) ? a.cycleDay : b.cycleDay) || 25,
    cycleU: Math.max(a.cycleU || 0, b.cycleU || 0)
  };
}

const CLOUD_KEY = 'jonpocket:cloud';
export function loadCloudMeta() {
  try { return JSON.parse(localStorage.getItem(CLOUD_KEY)) || {}; } catch (e) { return {}; }
}
export function saveCloudMeta(meta) {
  try { localStorage.setItem(CLOUD_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 2) {
        return {
          ...emptyState(), ...s,
          transactions: Array.isArray(s.transactions) ? s.transactions.filter(validTx) : [],
          goals: Array.isArray(s.goals) ? s.goals.filter(validGoal) : [],
          accounts: Array.isArray(s.accounts) ? s.accounts.filter(validAccount) : defaultPockets(),
          categories: Array.isArray(s.categories) ? s.categories.filter(validCategory) : [],
          budgets: s.budgets && typeof s.budgets === 'object' ? s.budgets : {},
          deleted: s.deleted && typeof s.deleted === 'object' ? s.deleted : {},
          prefs: { ...DEFAULT_PREFS, ...s.prefs }
        };
      }
    }
    localStorage.removeItem('rencana:v1'); // old demo data
  } catch (e) { /* private mode or corrupted data: start empty */ }
  return emptyState();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}
