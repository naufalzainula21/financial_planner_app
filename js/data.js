// Storage. Everything is saved in this browser's localStorage, on this device only.

// v2 = empty template. Data saved under the old demo key is ignored, so everyone starts clean.
const KEY = 'rencana:v2';
export const STORAGE_KEY = KEY;

export const DEFAULT_PREFS = {
  name: '', hide: false, catFilter: 'all', period: 'weekly', statsTab: 'categories',
  planTab: 'budgets', asset: 'stocks', monthly: 1000000, bannerHiddenOn: ''
};

/** A brand-new, empty app: no transactions, budgets or goals. */
export function emptyState() {
  return {
    v: 2, openingBalance: 0, transactions: [], budgets: {}, goals: [], prefs: { ...DEFAULT_PREFS },
    // sync bookkeeping: when budgets / name last changed, and ids deleted (id -> time)
    budgetsU: 0, nameU: 0, deleted: {}
  };
}

/** The part of the state that is synced to the cloud. */
export function toDoc(s) {
  return {
    transactions: s.transactions, goals: s.goals, budgets: s.budgets, budgetsU: s.budgetsU || 0,
    deleted: s.deleted || {}, openingBalance: s.openingBalance || 0, name: s.prefs?.name || '', nameU: s.nameU || 0
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
    transactions: list(a.transactions, b.transactions),
    goals: list(a.goals, b.goals),
    budgets: (aB >= bB ? a.budgets : b.budgets) || {},
    budgetsU: Math.max(aB, bB),
    deleted,
    openingBalance: a.openingBalance || b.openingBalance || 0,
    name: (aN >= bN ? a.name : b.name) || '',
    nameU: Math.max(aN, bN)
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
          transactions: Array.isArray(s.transactions) ? s.transactions : [],
          goals: Array.isArray(s.goals) ? s.goals : [],
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
