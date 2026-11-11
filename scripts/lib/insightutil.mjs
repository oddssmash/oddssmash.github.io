// Shared helpers for scripts/insights.mjs (analysis views; display only, never read by the model).
import fs from "node:fs";
import path from "node:path";
import { readJSON } from "./util.mjs";

export const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
export const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
export const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
export function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}
export const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
export const fmtSigned = (x, d = 1) => (x == null ? "n/a" : (x > 0 ? "+" : "") + x.toFixed(d));

// Sample label used by every view: n under 10 is "small", 10-29 "moderate", 30+ "solid".
export const sampleLabel = (n) => (n < 10 ? "small" : n < 30 ? "moderate" : "solid");

// Philippine time for every date shown (owner rule).
const MNL_DT = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const MNL_D = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const MNL_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
export const manilaDateTime = (iso) => (iso ? MNL_DT.format(new Date(iso)) + " PHT" : null);
export const manilaDate = (iso) => (iso ? MNL_D.format(new Date(iso)) : null);
export const manilaYmd = (iso) => (iso ? MNL_YMD.format(new Date(iso)) : null);

export const stypeOf = (pk) => +String(pk || "").split("-")[1] || 0;
export const phaseKeyFromLabel = (label) => {
  const m = /^(\d{4})-(\d{2})\s+(.*)$/.exec(label || "");
  if (!m) return null;
  const season = String(+m[1] + 1);
  const t = /pre/i.test(m[3]) ? 1 : /play-?in/i.test(m[3]) ? 5 : /playoff/i.test(m[3]) ? 3 : 2;
  return `${season}-${t}`;
};

export function listJson(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; }
}

// Every finished, projected game, oldest first, compacted to what the views need.
export function loadPastGames(pub) {
  const results = readJSON(path.join(pub, "results.json"), []);
  const out = [];
  for (const r of results) {
    const g = readJSON(path.join(pub, "games", `${r.id}.json`));
    if (!g || !g.pred || !g.act) continue;
    const played = new Set((g.players || []).filter((p) => p.act && p.act.min > 0).map((p) => p.id));
    const teams = (g.teams || []).map((t) => {
      const missing = (t.out || []).filter((o) => o && !played.has(o.id));
      return {
        tid: t.tid, isHome: t.isHome, pred: t.pred, act: t.act, sched: t.sched || {},
        tags: Array.isArray(t.style) ? t.style : (t.style && t.style.tags) || [],
        missing: missing.map((o) => ({ id: o.id, n: o.n, ppg: o.ppg || 0 })),
      };
    });
    const home = teams.find((t) => t.isHome) || teams[0];
    const away = teams.find((t) => !t.isHome) || teams[1];
    out.push({
      id: g.id, date: g.date, pk: g.pk, stype: stypeOf(g.pk), phase: g.phase,
      home: g.home, away: g.away, venue: g.venue, pace: g.pace,
      pred: g.pred, act: g.act, models: g.models || null, weights: g.weights || null,
      teams: [home, away],
      players: (g.players || []).map((p) => ({
        id: p.id, n: p.n, t: p.t, st: !!p.st, role: p.role,
        pmin: p.pred ? p.pred.min : null, ppts: p.pred ? p.pred.pts : null,
        min: p.act ? p.act.min || 0 : 0, pts: p.act ? p.act.pts || 0 : 0, dnp: p.act ? p.act.dnp || null : null,
      })),
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export function loadUpcoming(pub) {
  const list = readJSON(path.join(pub, "upcoming.json"), []);
  return list.map((u) => ({ row: u, d: readJSON(path.join(pub, "upcoming", `${u.id}.json`)) })).filter((x) => x.d);
}

export function teamAbbr(teams) {
  const m = new Map();
  for (const t of teams || []) m.set(String(t.id), t.abbr || t.short || String(t.id));
  return (id) => m.get(String(id)) || String(id);
}
