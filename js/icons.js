// Category definitions and line icons (same set as the design prototype).

const P = {
  food: '<path d="M4 3v7a3 3 0 0 0 6 0V3"/><path d="M7 3v18"/><path d="M18 3c-2 0-3.5 2-3.5 5.5S16 13 18 13v8"/>',
  transport: '<path d="M4 16l2-6.5A2 2 0 0 1 7.9 8h8.2a2 2 0 0 1 1.9 1.5L20 16v3H4z"/><path d="M7.5 19v1.5M16.5 19v1.5"/><path d="M7 13.5h.01M17 13.5h.01"/>',
  bills: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  fun: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5l4.5 2.5-4.5 2.5z"/>',
  shopping: '<path d="M5 8h14l-1.2 12.5H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  health: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  income: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  freelance: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  invest: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  goal: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  plane: '<path d="M3 13.5l18-7-5.5 14-3-5.5z"/><path d="M12.5 15l3-3.5"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5V6z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  car: '<path d="M4 16l2-6.5A2 2 0 0 1 7.9 8h8.2a2 2 0 0 1 1.9 1.5L20 16v3H4z"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M12 9v11M4 13h16"/><path d="M12 9c-2-4-6-3-5 0M12 9c2-4 6-3 5 0"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  piggy: '<path d="M5 11a7 6 0 0 1 12.5-3.5L21 7l-1 4a6 6 0 0 1-2 4v3h-3v-2h-4v2H8v-3a6 6 0 0 1-3-4z"/><path d="M15 10h.01"/><path d="M5 11H3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  // UI icons
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4"/><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h.01"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>'
};

export const svg = (name, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${P[name] || P.other}</svg>`;

/** Expense & income categories. `group` drives the 50/30/20 check. */
export const CATEGORIES = {
  food:      { label: 'Food & Groceries', short: 'Food',      icon: 'food',      tint: '#FFF0E5', ink: '#B8520F', color: '#FF8A3D', type: 'expense', group: 'needs' },
  transport: { label: 'Transport',        short: 'Transport', icon: 'transport', tint: '#E6F0FD', ink: '#1F5FBF', color: '#2F80ED', type: 'expense', group: 'needs' },
  bills:     { label: 'Bills & Utilities', short: 'Bills',    icon: 'bills',     tint: '#EFEDFE', ink: '#4436D6', color: '#5B4CF0', type: 'expense', group: 'needs' },
  health:    { label: 'Health',           short: 'Health',    icon: 'health',    tint: '#E3F6EC', ink: '#17834F', color: '#1FAA6B', type: 'expense', group: 'needs' },
  fun:       { label: 'Entertainment',    short: 'Fun',       icon: 'fun',       tint: '#FDE8F0', ink: '#B4235A', color: '#E0457B', type: 'expense', group: 'wants' },
  shopping:  { label: 'Shopping',         short: 'Shopping',  icon: 'shopping',  tint: '#FEF4D9', ink: '#8A5A00', color: '#F7B731', type: 'expense', group: 'wants' },
  other:     { label: 'Other',            short: 'Other',     icon: 'other',     tint: '#F2F2F8', ink: '#44435A', color: '#A3A3B8', type: 'expense', group: 'wants' },
  salary:    { label: 'Salary',           short: 'Salary',    icon: 'income',    tint: '#E3F6EC', ink: '#17834F', color: '#1FAA6B', type: 'income' },
  freelance: { label: 'Freelance',        short: 'Freelance', icon: 'freelance', tint: '#EFEDFE', ink: '#4436D6', color: '#5B4CF0', type: 'income' },
  invest:    { label: 'Investments',      short: 'Invest',    icon: 'invest',    tint: '#E6F0FD', ink: '#1F5FBF', color: '#2F80ED', type: 'income' },
  gift:      { label: 'Gifts & other',    short: 'Gifts',     icon: 'gift',      tint: '#FEF4D9', ink: '#8A5A00', color: '#F7B731', type: 'income' }
};

export const catsOf = (type) => Object.entries(CATEGORIES).filter(([, c]) => c.type === type).map(([id]) => id);

export function catTile(catId, small = false) {
  const c = CATEGORIES[catId] || CATEGORIES.other;
  return `<span class="cat${small ? ' sm' : ''}" style="background:${c.tint};color:${c.ink}">${svg(c.icon)}</span>`;
}

export function goalTile(icon, color) {
  return `<span class="cat" style="background:${color}1A;color:${color}">${svg(icon)}</span>`;
}

export const GOAL_ICONS = ['shield', 'plane', 'laptop', 'home', 'car', 'gift', 'goal'];
export const GOAL_COLORS = ['#1FAA6B', '#5B4CF0', '#2F80ED', '#E0457B', '#F29E0C'];
