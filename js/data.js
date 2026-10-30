// Storage + demo data. Everything is saved in this browser's localStorage.
import { isoDate, uid } from './format.js';

const KEY = 'rencana:v1';

// One month of typical activity. `d` = day of month.
const MONTH_TEMPLATE = [
  { d: 1,  type: 'income',  cat: 'salary',    name: 'Monthly salary',         amount: 15000000, method: 'Bank transfer' },
  { d: 1,  type: 'expense', cat: 'bills',     name: 'Rent share',             amount: 1500000,  method: 'Bank transfer' },
  { d: 2,  type: 'expense', cat: 'food',      name: 'Supermarket',            amount: 642000,   method: 'Debit card' },
  { d: 3,  type: 'expense', cat: 'transport', name: 'Ride-hailing',           amount: 48000,    method: 'E-wallet' },
  { d: 4,  type: 'expense', cat: 'fun',       name: 'Streaming subscription', amount: 186000,   method: 'Recurring' },
  { d: 5,  type: 'expense', cat: 'food',      name: 'Coffee shop',            amount: 58000,    method: 'E-wallet' },
  { d: 6,  type: 'expense', cat: 'bills',     name: 'Internet',               amount: 385000,   method: 'Recurring' },
  { d: 7,  type: 'expense', cat: 'transport', name: 'Fuel',                   amount: 250000,   method: 'Debit card' },
  { d: 8,  type: 'expense', cat: 'shopping',  name: 'Online marketplace',     amount: 349000,   method: 'E-wallet' },
  { d: 9,  type: 'expense', cat: 'food',      name: 'Lunch with team',        amount: 125000,   method: 'Split bill' },
  { d: 10, type: 'income',  cat: 'invest',    name: 'Dividend payout',        amount: 700000,   method: 'Bank transfer' },
  { d: 11, type: 'expense', cat: 'health',    name: 'Gym membership',         amount: 375000,   method: 'Recurring' },
  { d: 12, type: 'expense', cat: 'food',      name: 'Supermarket',            amount: 588000,   method: 'Debit card' },
  { d: 13, type: 'expense', cat: 'fun',       name: 'Cinema',                 amount: 120000,   method: 'E-wallet' },
  { d: 14, type: 'expense', cat: 'transport', name: 'Commuter train top-up',  amount: 200000,   method: 'E-wallet' },
  { d: 15, type: 'expense', cat: 'bills',     name: 'Phone plan',             amount: 150000,   method: 'Recurring' },
  { d: 16, type: 'expense', cat: 'shopping',  name: 'Clothing',               amount: 420000,   method: 'Credit card' },
  { d: 17, type: 'expense', cat: 'food',      name: 'Dinner out',             amount: 285000,   method: 'Credit card' },
  { d: 18, type: 'expense', cat: 'transport', name: 'Ride-hailing',           amount: 64000,    method: 'E-wallet' },
  { d: 19, type: 'expense', cat: 'fun',       name: 'Concert ticket',         amount: 450000,   method: 'Credit card' },
  { d: 20, type: 'expense', cat: 'food',      name: 'Supermarket',            amount: 610000,   method: 'Debit card' },
  { d: 21, type: 'expense', cat: 'other',     name: 'Haircut',                amount: 85000,    method: 'Cash' },
  { d: 22, type: 'expense', cat: 'bills',     name: 'Water bill',             amount: 165000,   method: 'Recurring' },
  { d: 23, type: 'expense', cat: 'food',      name: 'Coffee shop',            amount: 48000,    method: 'E-wallet' },
  { d: 24, type: 'expense', cat: 'transport', name: 'Parking',                amount: 30000,    method: 'Cash' },
  { d: 25, type: 'expense', cat: 'shopping',  name: 'Running shoes',          amount: 890000,   method: 'Credit card' },
  { d: 26, type: 'expense', cat: 'health',    name: 'Pharmacy',               amount: 125000,   method: 'Debit card' },
  { d: 27, type: 'expense', cat: 'fun',       name: 'Streaming add-on',       amount: 65000,    method: 'Recurring' },
  { d: 28, type: 'income',  cat: 'freelance', name: 'Freelance project',      amount: 2800000,  method: 'Bank transfer' },
  { d: 28, type: 'expense', cat: 'bills',     name: 'Electricity token',      amount: 450000,   method: 'E-wallet' },
  { d: 29, type: 'expense', cat: 'transport', name: 'Ride-hailing',           amount: 32000,    method: 'E-wallet' },
  { d: 30, type: 'expense', cat: 'food',      name: 'Minimarket',             amount: 186500,   method: 'Debit card' },
  { d: 30, type: 'expense', cat: 'food',      name: 'Coffee shop',            amount: 48000,    method: 'E-wallet' }
];

function seedTransactions(today = new Date()) {
  const out = [];
  // last month (all of it, a bit lower spending so "vs last month" has something to say)
  const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lmDays = new Date(lm.getFullYear(), lm.getMonth() + 1, 0).getDate();
  for (const t of MONTH_TEMPLATE) {
    const day = Math.min(t.d, lmDays);
    const amt = t.type === 'expense' ? Math.round((t.amount * 0.9) / 500) * 500 : t.amount;
    out.push({ id: uid(), type: t.type, cat: t.cat, name: t.name, amount: amt, method: t.method, note: '',
      date: isoDate(new Date(lm.getFullYear(), lm.getMonth(), day)) });
  }
  // this month, up to today
  for (const t of MONTH_TEMPLATE) {
    if (t.d > today.getDate()) continue;
    out.push({ id: uid(), type: t.type, cat: t.cat, name: t.name, amount: t.amount, method: t.method, note: '',
      date: isoDate(new Date(today.getFullYear(), today.getMonth(), t.d)) });
  }
  return out;
}

function monthsFromNow(n, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function demoState(today = new Date()) {
  return {
    v: 1,
    openingBalance: 12000000,
    transactions: seedTransactions(today),
    budgets: { food: 4500000, transport: 2000000, bills: 2800000, fun: 1500000, shopping: 3000000, health: 1500000 },
    goals: [
      { id: uid(), name: 'Emergency fund', icon: 'shield', color: '#1FAA6B', saved: 24000000, target: 36000000, due: monthsFromNow(8, today), members: [] },
      { id: uid(), name: 'Trip to Japan', icon: 'plane', color: '#5B4CF0', saved: 8500000, target: 25000000, due: monthsFromNow(14, today),
        members: [{ i: 'A', bg: '#5B4CF0' }, { i: 'S', bg: '#E0457B' }, { i: 'R', bg: '#1FAA6B' }] },
      { id: uid(), name: 'New laptop', icon: 'laptop', color: '#2F80ED', saved: 9000000, target: 18000000, due: monthsFromNow(5, today), members: [] }
    ],
    prefs: { ...DEFAULT_PREFS }
  };
}

export const DEFAULT_PREFS = {
  name: 'Naufal', hide: false, catFilter: 'all', period: 'weekly', statsTab: 'categories',
  planTab: 'budgets', asset: 'stocks', monthly: 2000000, bannerHiddenOn: ''
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1) { s.prefs = { ...DEFAULT_PREFS, ...s.prefs }; return s; }
    }
  } catch (e) { /* private mode or corrupted data: fall back to demo */ }
  return demoState();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
}

export function emptyState() {
  const s = demoState();
  return { ...s, openingBalance: 0, transactions: [], goals: [] };
}

// Sample portfolio (not live prices). Replace with a real quotes API later.
export const PORTFOLIO = {
  stocks: {
    value: 44400000, gain: 4100000, pct: '+10,2%',
    line: [92, 84, 88, 70, 74, 58, 64, 46, 52, 34, 26],
    holdings: [
      { sym: 'IDX30', name: 'Index fund', qty: '1.650 units', value: 14110000, chg: 9.8 },
      { sym: 'BBCA', name: 'Bank stock A', qty: '1.200 shares', value: 11640000, chg: 12.4 },
      { sym: 'BBRI', name: 'Bank stock B', qty: '2.500 shares', value: 10250000, chg: 4.1 },
      { sym: 'TLKM', name: 'Telecom stock', qty: '3.000 shares', value: 8400000, chg: -6.2 }
    ]
  },
  crypto: {
    value: 18000000, gain: 4800000, pct: '+36,4%',
    line: [100, 90, 96, 72, 80, 50, 66, 40, 58, 28, 18],
    holdings: [
      { sym: 'BTC', name: 'Bitcoin', qty: '0,0125 BTC', value: 13200000, chg: 31.0 },
      { sym: 'ETH', name: 'Ethereum', qty: '0,085 ETH', value: 4800000, chg: 18.0 }
    ]
  }
};
