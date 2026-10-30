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
  return { v: 2, openingBalance: 0, transactions: [], budgets: {}, goals: [], prefs: { ...DEFAULT_PREFS } };
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
