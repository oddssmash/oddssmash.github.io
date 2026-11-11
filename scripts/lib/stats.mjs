// Small numeric + basketball helpers used by the model.

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

export function phi(z) { // standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function posGroup(pos = "") {
  const p = pos.toUpperCase();
  if (p.includes("C")) return "C";
  if (p.startsWith("G") || p === "PG" || p === "SG") return "G";
  return "F";
}

export function phaseOf(season, stype) {
  const label = `${season - 1}-${String(season).slice(2)}`;
  const name = { 1: "Preseason", 2: "Regular Season", 3: "Playoffs", 5: "Play-In" }[stype] || "Other";
  return { key: `${season}-${stype}`, label: `${label} ${name}`, season, stype };
}

export const tsa = (r) => r.fga + 0.44 * r.fta;

// Exponentially weighted sums over newest-last records.
export function ew(records, fn, hl, wfn = () => 1) {
  let sw = 0, sv = 0;
  const n = records.length;
  for (let i = n - 1; i >= 0; i--) {
    const w = 0.5 ** ((n - 1 - i) / hl) * wfn(records[i]);
    if (!w) continue;
    sw += w; sv += w * fn(records[i]);
  }
  return { w: sw, v: sv, avg: sw ? sv / sw : 0 };
}

export function normName(s = "") {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z]/g, "");
}

// Least-squares slope + correlation of y on x.
export function regress(xs, ys) {
  const n = xs.length;
  if (n < 3) return { n, slope: 0, r: 0 };
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return { n, slope: sxx ? sxy / sxx : 0, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}

export function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }

// US Eastern calendar day ("YYYY-MM-DD") of a tip-off time. NBA game days are US days: a 7pm ET
// tip is 23:00Z or 00:00Z depending on the month, so UTC dates must never be used for rest days.
const ET_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etCache = new Map();
export function etDay(iso) {
  let d = etCache.get(iso);
  if (d === undefined) { d = ET_FMT.format(new Date(iso)); etCache.set(iso, d); }
  return d;
}
// Whole US calendar days from game a to game b (0 = same day, 1 = consecutive days).
export const gameDaysBetween = (a, b) => daysBetween(etDay(a), etDay(b));
