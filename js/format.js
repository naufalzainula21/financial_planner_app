// Formatting helpers (Indonesian Rupiah, dates) and HTML escaping.

const nf = new Intl.NumberFormat('id-ID');

/** Rp 1.250.000 */
export const idr = (n) => 'Rp ' + nf.format(Math.round(n));

/** Signed: +Rp 2.800.000 / −Rp 48.000 */
export const idrSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + idr(Math.abs(n));

/** Short: Rp 18,5 jt / Rp 1,2 M */
export function idrShort(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e9) return sign + 'Rp ' + (a / 1e9).toFixed(2).replace('.', ',') + ' M';
  if (a >= 1e6) return sign + 'Rp ' + (a / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' jt';
  if (a >= 1e3) return sign + 'Rp ' + Math.round(a / 1e3) + ' rb';
  return sign + idr(a);
}

/** Parse "1.250.000" or "1250000" or "1,5jt" style input into a number. */
export function parseAmount(str) {
  if (typeof str === 'number') return str;
  const s = String(str || '').toLowerCase().replace(/\s|rp/g, '');
  const m = s.match(/^([\d.,]+)(jt|rb|k|m)?$/);
  if (!m) return NaN;
  let num = m[1];
  if (m[2]) num = num.replace(/\./g, '').replace(',', '.');
  else num = num.replace(/[.,]/g, '');
  let v = parseFloat(num);
  if (m[2] === 'jt' || m[2] === 'm') v *= 1e6;
  if (m[2] === 'rb' || m[2] === 'k') v *= 1e3;
  return v;
}

/** Thousands separators while typing. */
export const groupDigits = (str) => {
  const d = String(str).replace(/\D/g, '');
  return d ? nf.format(Number(d)) : '';
};

export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthLabel = (d) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
export const shortMonth = (d) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

export function dayLabel(iso, today = new Date()) {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(isoDate(today) + 'T00:00:00');
  const diff = Math.round((t - d) / 86400000);
  const pretty = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (diff === 0) return 'Today · ' + pretty;
  if (diff === 1) return 'Yesterday · ' + pretty;
  return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' · ' + pretty;
}

export function shortDay(iso, today = new Date()) {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(isoDate(today) + 'T00:00:00');
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 11) return 'Good morning';
  if (h < 15) return 'Good afternoon';
  if (h < 19) return 'Good evening';
  return 'Good night';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape anything typed by the user before putting it in HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
