// FIBA model: the same workflow as the NBA side, sized for FIBA basketball.
//  1. Walk every finished game in date order. Before each game, project it from what was known then
//     (team offence/defence/pace ratings, home court); grade it after; then learn from the box score.
//  2. Learning: the update speed, home-court edge, rating decay between windows and the spread of results
//     are chosen by replaying all history (walk-forward) and keeping the settings with the best Brier score.
//  3. Players: per-minute rates learned the same way (one record per player across national team and club
//     games), minutes from his recent role, adjusted for pace and the opponent's defence.
//  4. Upcoming games: projected score, win chance, quarters, player lines, and a 10,000-run simulation for
//     our own lines and picks. Sportsbook data is never read.
// Reads data/fiba/events/*.json and data/fiba/games/*.json. Writes public-fiba/data/.
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON } from "../lib/util.mjs";
import { EVENTS } from "./events.mjs";

const FD = path.join(DATA, "fiba"), OUT = process.env.FIBA_OUT ? path.resolve(process.env.FIBA_OUT) : path.join(ROOT, "public-fiba", "data");
for (const d of ["", "games", "teams", "players"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const EVK = Object.fromEntries(EVENTS.map((e) => [e.slug, e]));
const DAY = 86400000, now = Date.now();
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;
const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

// ---------------------------------------------------------------- load
const sched = [];
for (const f of fs.readdirSync(path.join(FD, "events"))) { const e = readJSON(path.join(FD, "events", f)); if (!e) continue; for (const g of e.games) sched.push({ ...g, kind: e.kind, comp: e.short, compName: e.name }); }
const box = new Map();
for (const f of fs.readdirSync(path.join(FD, "games"))) { const g = readJSON(path.join(FD, "games", f)); if (g?.players?.length) box.set(g.id, g); }
const games = sched.filter((g) => box.has(g.id)).map((g) => ({ ...g, box: box.get(g.id) })).sort((a, b) => a.date.localeCompare(b.date));
const upcoming = sched.filter((g) => !box.has(g.id) && g.status !== "VALID" && Date.parse(g.date) > now - 3 * 3600000 && Date.parse(g.date) < now + 45 * DAY && g.a.tid && g.b.tid && g.a.name !== "TBD" && g.b.name !== "TBD").sort((a, b) => a.date.localeCompare(b.date));
console.log(`FIBA: ${games.length} finished games with box scores, ${upcoming.length} upcoming in the next 45 days`);

// Home court: home-and-away rounds give team A home; at a tournament, a team playing in its own country is at home.
const homeOf = (g) => (g.system === "HA" || g.box?.system === "HA" ? 0 : g.host && g.host === g.a.code && g.kind === "nt" ? 0 : g.host && g.host === g.b.code && g.kind === "nt" ? 1 : -1);
// possessions from a team box line
const teamLine = (b, side) => { const ps = b.players.filter((p) => p.side === side); const s = (k) => ps.reduce((a, p) => a + (p[k] || 0), 0); return { pts: b.teams[side].score, fga: s("fga"), fgm: s("fgm"), f3a: s("f3a"), f3m: s("f3m"), fta: s("fta"), ftm: s("ftm"), or: s("or"), dr: s("dr"), to: s("to"), ast: s("ast"), min: s("min") }; };
const possOf = (t) => t.fga - t.or + t.to + 0.44 * t.fta;

// ---------------------------------------------------------------- walk-forward replay (team ratings)
function replay(P, record = false) {
  const T = new Map(), lg = { nt: { ppp: 105, pace: 74 }, club: { ppp: 108, pace: 74 } };
  const team = (tid, kind) => { if (!T.has(tid)) T.set(tid, { tid, kind, off: 0, def: 0, pace: 0, n: 0, last: null, w: 0, l: 0, pf: 0, pa: 0 }); return T.get(tid); };
  const decay = (t, d) => { if (t.last) { const f = Math.exp(-Math.max(0, (Date.parse(d) - Date.parse(t.last)) / DAY) / P.hl); t.off *= f; t.def *= f; t.pace *= f; } };
  let brier = 0, ll = 0, n = 0, right = 0, mae = 0, tmae = 0; const log = [];
  for (const g of games) {
    const A = team(g.box.teams[0].tid, g.kind), B = team(g.box.teams[1].tid, g.kind), L = lg[g.kind];
    decay(A, g.date); decay(B, g.date);
    const h = homeOf(g), H = P.hca[g.kind], hca = h === 0 ? H : h === 1 ? -H : 0;
    const wA = A.n / (A.n + P.k0) || 0, wB = B.n / (B.n + P.k0) || 0; // thin records are pulled toward average (k0 learned)
    const pace = L.pace + (A.pace * wA + B.pace * wB) / 2, pa = pace * (L.ppp + A.off * wA - B.def * wB) / 100 + hca / 2, pb = pace * (L.ppp + B.off * wB - A.def * wA) / 100 - hca / 2;
    const margin = pa - pb, sd = P.sd * (1 + 1.2 / Math.sqrt(1 + Math.min(A.n, B.n))), pA = Phi(margin / sd);
    const ta = teamLine(g.box, 0), tb = teamLine(g.box, 1), sa = g.box.teams[0].score, sb = g.box.teams[1].score, won = sa > sb ? 1 : 0;
    const warm = A.n >= 3 && B.n >= 3;
    if (warm) { brier += (pA - won) ** 2; ll += -Math.log(Math.max(1e-6, won ? pA : 1 - pA)); n++; right += (pA >= 0.5) === !!won ? 1 : 0; mae += Math.abs(margin - (sa - sb)); tmae += Math.abs(pa + pb - sa - sb); }
    if (record) log.push({ g, A: A.tid, B: B.tid, pa, pb, pA, sd, warm, nA: A.n, nB: B.n, home: h, ta, tb });
    // learn from the result
    const poss = (possOf(ta) + possOf(tb)) / 2 || pace, oa = (100 * sa) / poss, ob = (100 * sb) / poss, k = P.k;
    const ea = L.ppp + A.off - B.def + (hca / 2) * 100 / pace, eb = L.ppp + B.off - A.def - (hca / 2) * 100 / pace;
    const ka = k * (A.n < 5 ? 1.6 : 1), kb = k * (B.n < 5 ? 1.6 : 1);
    A.off += ka * (oa - ea) / 2; B.def -= kb * (oa - ea) / 2; B.off += kb * (ob - eb) / 2; A.def -= ka * (ob - eb) / 2;
    A.pace += ka * (poss - pace) / 2; B.pace += kb * (poss - pace) / 2;
    L.ppp += 0.01 * ((oa + ob) / 2 - L.ppp); L.pace += 0.01 * (poss - L.pace);
    A.n++; B.n++; A.last = B.last = g.date; A.pf += sa; A.pa += sb; B.pf += sb; B.pa += sa; if (won) { A.w++; B.l++; } else { B.w++; A.l++; }
  }
  return { T, lg, brier: brier / n, ll: ll / n, acc: right / n, mae: mae / n, tmae: tmae / n, n, log };
}
// learn the settings: walk-forward grid, best Brier
const grid = []; for (const k of [0.1, 0.16, 0.24, 0.32, 0.42]) for (const hn of [0, 0.75, 1.5, 2.5]) for (const hc of [2, 3, 4, 5, 6]) for (const hl of [365, 730]) for (const sd of [9, 10.5, 12]) for (const k0 of (process.env.K0 ? [+process.env.K0] : [4, 6, 10])) /* owner rule: thin records are always pulled toward average (at least 4 games' worth); back-test: 90%+ calls went from 87.5% to 90.5% right for +0.002 Brier */ grid.push({ k, hca: { nt: hn, club: hc }, hl, sd, k0 });
let best = null; for (const P of grid) { const r = replay(P); if (!best || r.brier < best.r.brier) best = { P, r }; }
const P = best.P, R = replay(P, true);
console.log("learned", JSON.stringify(P), "Brier", r3(R.brier), "winner", (R.acc * 100).toFixed(1) + "%", "margin MAE", r1(R.mae), "total MAE", r1(R.tmae), "graded", R.n);

// ---------------------------------------------------------------- players (walk-forward per-minute rates)
const PL = new Map(), STAT = ["pts", "reb", "ast", "stl", "blk", "to", "fga", "fgm", "f3a", "f3m", "fta", "ftm", "or", "dr", "pf"];
const pPred = [];
for (const x of R.log) {
  const g = x.g;
  for (const p of g.box.players) {
    const tid = g.box.teams[p.side].tid; let s = PL.get(p.pid);
    if (!s) PL.set(p.pid, (s = { pid: p.pid, n: p.n, pos: p.pos, no: p.no, gp: 0, min: 0, rate: Object.fromEntries(STAT.map((k) => [k, 0])), wsum: 0, teams: {}, log: [], last: null, shots: [] }));
    // grade the pre-game player projection (only once he has a record)
    if (s.gp >= 3 && p.min > 0) { const proj = s.rate.pts * s.min; pPred.push([proj, p.pts]); }
    const a = s.gp < 4 ? 1 / (s.gp + 1) : 0.18, am = s.gp < 4 ? 1 / (s.gp + 1) : 0.25;
    s.min += am * (p.min - s.min);
    if (p.min >= 4) for (const k of STAT) s.rate[k] += a * ((p[k] || 0) / p.min - s.rate[k]);
    s.gp++; s.last = g.date; s.n = p.n; s.pos = p.pos || s.pos; s.no = p.no || s.no; s.team = tid; s.kind = g.kind;
    (s.teams[tid] ||= { tid, kind: g.kind, gp: 0, code: g.box.teams[p.side].code, name: g.box.teams[p.side].name }).gp++;
    s.log.push([g.id, g.date, tid, g.box.teams[1 - p.side].tid, p.min, p.pts, p.reb, p.ast, p.stl, p.blk, p.to, p.fgm, p.fga, p.f3m, p.f3a, p.ftm, p.fta, p.start ? 1 : 0, p.pm]);
  }
  for (const sh of g.box.shots) { const s = PL.get(sh[0]); if (s) s.shots.push(sh); }
}
const pMae = pPred.length ? pPred.reduce((a, [q, y]) => a + Math.abs(q - y), 0) / pPred.length : null;

// ---------------------------------------------------------------- shot zones (FIBA court: x across 0-280 = 15 m, y from the baseline, 18.67 units a metre)
const U = 280 / 15, ZONES = [["rim", "At the rim"], ["paint", "Paint (non-restricted)"], ["mid", "Mid-range"], ["c3", "Corner three"], ["atb", "Above-the-break three"]];
const zoneOf = (x, y, pts) => { if (!x && !y) return null; const dx = (x - 140) / U, dy = y / U - 1.575, d = Math.hypot(dx, dy); if (pts === 3) return y / U < 2.99 ? "c3" : "atb"; if (d < 1.25) return "rim"; if (Math.abs(dx) < 2.45 && y / U < 5.8) return "paint"; return "mid"; };
const lgZ = {}; for (const [z] of ZONES) lgZ[z] = { a: 0, m: 0 };
for (const g of games) for (const s of g.box.shots) { const z = zoneOf(s[3], s[4], s[6]); if (z) { lgZ[z].a++; lgZ[z].m += s[5]; } }
function zonesFor(shots) {
  const c = {}; for (const [z] of ZONES) c[z] = { a: 0, m: 0 };
  for (const s of shots) { const z = zoneOf(s[3], s[4], s[6]); if (z) { c[z].a++; c[z].m += s[5]; } }
  const tot = Object.values(c).reduce((a, x) => a + x.a, 0);
  return ZONES.map(([id, label]) => { const x = c[id], lp = lgZ[id].a ? lgZ[id].m / lgZ[id].a : 0, pct = x.a ? x.m / x.a : null, diff = pct == null ? null : (pct - lp) * 100, se = x.a ? Math.sqrt(lp * (1 - lp) / x.a) * 100 : 99;
    return { id, label, att: x.a, made: x.m, pct: pct == null ? null : r1(pct * 100), lgPct: r1(lp * 100), share: tot ? r1((x.a / tot) * 100) : 0, diff: diff == null ? null : r1(diff), tag: x.a >= 15 && Math.abs(diff) >= 4 && Math.abs(diff) / se >= 1.3 ? (diff > 0 ? "hot" : "cold") : "neutral" }; });
}

// ---------------------------------------------------------------- projections for upcoming games
// Owner-supplied lineups and retirements (config/fiba-rosters.json), matched to our players by name.
const CFG = readJSON(path.join(ROOT, "config", "fiba-rosters.json"), { lineups: [], retired: [] });
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
function findPlayer(name, tid) {
  const t = norm(name).split(" "), first = t[0], last = t.slice(-1)[0], full = t.join(" ");
  const cands = [...PL.values()].filter((s) => { const u = norm(s.n).split(" "); return u.join(" ") === full || (u[0] === first && u.slice(-1)[0] === last) || (u.slice(-1)[0] === last && u[0][0] === first[0] && u.length > 1); });
  return cands.sort((a, b) => (b.teams?.[tid] ? 1 : 0) - (a.teams?.[tid] ? 1 : 0) || b.gp - a.gp)[0] || null;
}
const tidOfCode = (code) => [...R.T.keys()].find((tid) => games.some((g) => g.box.teams.some((t) => t.tid === tid && t.code === code)));
const RETIRED = new Set(); for (const r of CFG.retired || []) { const p = findPlayer(r.n, tidOfCode(r.team)); if (p) RETIRED.add(p.pid); }
function manualLineup(code, date) {
  const L = (CFG.lineups || []).find((l) => l.team === code && date.slice(0, 10) >= l.from && date.slice(0, 10) <= l.to); if (!L) return null;
  const tid = tidOfCode(code);
  return { source: L.source, list: L.players.map((x) => { const p = findPlayer(x.n, tid); return p ? { pid: p.pid, n: p.n, pos: p.pos || x.pos || "", no: p.no || "" } : { pid: `new-${norm(x.n).replace(/ /g, "-")}`, n: x.n, pos: x.pos || "F", no: "", min: x.min || null }; }) };
}
// FIBA roster trackers (fetch.mjs): final 12s are used as announced; from a preliminary pool the 12 most likely
// (established players by recent minutes first, then newcomers) are projected, and the page says so.
const TRK = readJSON(path.join(FD, "trackers.json"), { trackers: [] });
function trackerLineup(g, t) {
  if (Date.parse(g.date) > now + 21 * DAY) return null;
  for (const tr of TRK.trackers.filter((x) => x.event === g.slug)) {
    const e = tr.teams[t.name] || Object.entries(tr.teams).find(([k]) => norm(k) === norm(t.name))?.[1]; if (!e) continue;
    let list = e.players.map((n) => { const p = findPlayer(n, t.tid); return p ? { pid: p.pid, n: p.n, pos: p.pos || "", no: p.no || "", known: p } : { pid: `new-${norm(n).replace(/ /g, "-")}`, n, pos: "F", no: "" }; }).filter((x) => !RETIRED.has(x.pid));
    const w = (x) => (x.known ? (x.known.teams?.[t.tid] ? 2 : 1) * x.known.min : 0);
    if (e.status === "preliminary" && list.length > 12) list = [...list].sort((a, b) => w(b) - w(a)).slice(0, 12);
    return { source: e.status === "final" ? `final 12 from FIBA's roster tracker (window ${tr.window})` : `preliminary pool of ${e.players.length} from FIBA's roster tracker (window ${tr.window}); projected with the 12 most likely (regulars first) until the final 12 is posted`, list: list.map(({ known, ...x }) => x) };
  }
  return null;
}
const lastRoster = (tid) => { // players from the team's most recent game (retired players left out)
  const last = [...games].reverse().find((g) => g.box.teams.some((t) => t.tid === tid)); if (!last) return { date: null, list: [] };
  const side = last.box.teams[0].tid === tid ? 0 : 1;
  return { date: last.date, gid: last.id, list: last.box.players.filter((p) => p.side === side && !RETIRED.has(p.pid)).map((p) => PL.get(p.pid)).filter(Boolean) };
};
// A player new to our data (first FIBA game in a competition we follow): start from what players at his position
// usually produce per minute in FIBA, a little below average, in a bench role. He is marked "new" on the page.
const grpOf = (pos) => (/C/i.test(pos || "") ? "C" : /F/i.test(pos || "") ? "F" : "G");
const PRIOR = {}; for (const g of ["G", "F", "C"]) { const ps = [...PL.values()].filter((s) => s.gp >= 5 && grpOf(s.pos) === g); const w = ps.reduce((a, s) => a + s.min, 0) || 1; PRIOR[g] = Object.fromEntries(STAT.map((k) => [k, (ps.reduce((a, s) => a + s.rate[k] * s.min, 0) / w) * 0.85])); }
const ROSTERS = new Map(); { const RDIR = path.join(FD, "rosters"); if (fs.existsSync(RDIR)) for (const f of fs.readdirSync(RDIR)) { const r = readJSON(path.join(RDIR, f)); if (r) ROSTERS.set(r.id, r); } }
function projectPlayers(tid, oppTid, pace, kind, announced = null, source = null) {
  const ro = lastRoster(tid), L = R.lg[kind], opp = R.T.get(oppTid);
  // the announced 12 when FIBA has posted them, else the players from the team's last game
  let list;
  if (announced?.length) list = announced.map((a) => { const s = PL.get(a.pid); return s ? { s, min: s.min, kinds: s.teams } : { s: { pid: a.pid, n: a.n, pos: a.pos, no: a.no, gp: 0, rate: PRIOR[grpOf(a.pos)], log: [] }, min: a.min || 12, isNew: true }; });
  else list = ro.list.map((s) => ({ s, min: s.min }));
  list = list.filter((x) => x.min > 1);
  // Minutes add up to 200. Too many: players keep their usual minutes in order of role and the deep bench is cut
  // (how coaches trim). Too few: everyone is scaled up, capped at 38.
  const tot = list.reduce((a, x) => a + x.min, 0) || 1;
  if (tot > 200) { let left = 200; for (const x of [...list].sort((a, b) => b.min - a.min)) { x.min = Math.max(0, Math.min(x.min, left)); left -= x.min; } }
  else list.forEach((x) => (x.min = Math.min(38, (x.min * 200) / tot)));
  const fPace = pace / L.pace, fDef = opp ? (L.ppp - opp.def) / L.ppp : 1;
  return { from: announced?.length ? null : ro.date, announced: !!announced?.length, source, gid: ro.gid, players: list.sort((a, b) => b.min - a.min).map(({ s, min, isNew }) => {
    const other = Object.values(s.teams || {}).filter((t) => t.kind !== kind).reduce((a, t) => a + t.gp, 0), same = Object.values(s.teams || {}).filter((t) => t.kind === kind).reduce((a, t) => a + t.gp, 0);
    return { pid: s.pid, n: s.n, pos: s.pos, no: s.no, min: r1(min), isNew: !!isNew, src: isNew ? "new: no FIBA games in our data, estimated from his position" : same === 0 && other ? `first ${kind === "nt" ? "national-team" : "club"} game in our data: rates from his ${other} ${kind === "nt" ? "club" : "national-team"} games` : null,
      pts: r1(s.rate.pts * min * fPace * fDef), reb: r1(s.rate.reb * min * fPace), ast: r1(s.rate.ast * min * fPace), stl: r1(s.rate.stl * min * fPace), blk: r1(s.rate.blk * min * fPace), f3m: r1(s.rate.f3m * min * fPace * fDef), gp: s.gp, avgPts: s.log.length ? r1(s.log.reduce((a, l) => a + l[5], 0) / s.log.length) : null, avgMin: s.log.length ? r1(s.log.reduce((a, l) => a + l[4], 0) / s.log.length) : null }; }) };
}// seeded RNG so a refresh without new data gives the same numbers
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const N = 10000;
function simulate(pa, pb, sd, pls) {
  const sA = [], sB = [], qs = [], pts = pls.map(() => []);
  for (let i = 0; i < N; i++) {
    const shared = gauss() * sd * 0.55, a = pa + shared + gauss() * sd * 0.6, b = pb + shared + gauss() * sd * 0.6; // shared part moves the total, the rest the margin
    sA.push(a); sB.push(b);
    pls.forEach((p, j) => { const sc = (p.side === 0 ? a / pa : b / pb); pts[j].push(Math.max(0, p.pts * sc + gauss() * Math.sqrt(Math.max(1, p.pts)) * 1.25)); });
  }
  return { sA, sB, pts };
}
const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const share = (arr, f) => arr.filter(f).length / arr.length;
const halfLine = (x) => Math.floor(x) + 0.5;

// home / away / neutral records from finished games (home court as decided by homeOf)
const HA = new Map(); for (const g of games) { const h = homeOf(g); g.box.teams.forEach((t, i) => { const r = HA.get(t.tid) || { home: [0, 0], away: [0, 0], neutral: [0, 0] }; const k = h === -1 ? "neutral" : h === i ? "home" : "away", won = t.score > g.box.teams[1 - i].score; r[k][won ? 0 : 1]++; HA.set(t.tid, r); }); }
const haRec = (tid) => HA.get(tid) || { home: [0, 0], away: [0, 0], neutral: [0, 0] };
// One confidence rule: thin records cap it (under 4 games: low; under 10: medium at most), and so does a
// competition with fewer than 20 graded games in our data.
const COMP_N = {}; for (const x of R.log) if (x.warm) COMP_N[x.g.comp] = (COMP_N[x.g.comp] || 0) + 1;
function confOf(pA, nmin, comp) {
  const d = Math.abs(pA - 0.5);
  if (nmin < 4) return "low (thin record)";
  if ((COMP_N[comp] || 0) < 20) return "low (few graded games in this competition)";
  if (d < 0.15) return "low (near coin-flip)";
  if (nmin < 10) return "medium (fewer than 10 games for one side)";
  return d >= 0.3 ? "high" : "medium";
}
const upOut = [], picks = [];
for (const g of upcoming) {
  const A = R.T.get(g.a.tid), B = R.T.get(g.b.tid), L = R.lg[g.kind];
  const h = homeOf(g), hca = h === 0 ? P.hca[g.kind] : h === 1 ? -P.hca[g.kind] : 0;
  const wA = (A?.n || 0) / ((A?.n || 0) + P.k0) || 0, wB = (B?.n || 0) / ((B?.n || 0) + P.k0) || 0;
  const offA = (A?.off || 0) * wA, defA = (A?.def || 0) * wA, offB = (B?.off || 0) * wB, defB = (B?.def || 0) * wB, pace = L.pace + ((A?.pace || 0) * wA + (B?.pace || 0) * wB) / 2;
  const pa = pace * (L.ppp + offA - defB) / 100 + hca / 2, pb = pace * (L.ppp + offB - defA) / 100 - hca / 2, nmin = Math.min(A?.n || 0, B?.n || 0);
  const sd = P.sd * (1 + 1.2 / Math.sqrt(1 + nmin)), pA = Phi((pa - pb) / sd);
  // roster priority: FIBA-posted 12 for this game, then an owner-supplied lineup, then FIBA's roster tracker, then the last game
  const RO = ROSTERS.get(g.id), mA = RO?.a?.length ? null : manualLineup(g.a.code, g.date) || trackerLineup(g, g.a), mB = RO?.b?.length ? null : manualLineup(g.b.code, g.date) || trackerLineup(g, g.b);
  const prA = projectPlayers(g.a.tid, g.b.tid, pace, g.kind, RO?.a?.length ? RO.a : mA?.list, RO?.a?.length ? "official roster posted by FIBA" : mA?.source), prB = projectPlayers(g.b.tid, g.a.tid, pace, g.kind, RO?.b?.length ? RO.b : mB?.list, RO?.b?.length ? "official roster posted by FIBA" : mB?.source);
  // scale player points so each side adds up to the team projection (free throws and bench included)
  for (const [pr, tot] of [[prA, pa], [prB, pb]]) { const s = pr.players.reduce((a, p) => a + p.pts, 0); if (s > 0) pr.players.forEach((p) => { p.raw = p.pts; p.pts = r1((p.pts * tot) / s); }); }
  const pls = [...prA.players.slice(0, 12).map((p) => ({ ...p, side: 0 })), ...prB.players.slice(0, 12).map((p) => ({ ...p, side: 1 }))];
  const sim = simulate(pa, pb, sd, pls), mg = sim.sA.map((a, i) => a - sim.sB[i]), tt = sim.sA.map((a, i) => a + sim.sB[i]);
  const spread = Math.round((pa - pb) * 2) / 2, total = halfLine(pa + pb);
  const why = [];
  if (A && B) {
    const net = (t) => (t === A ? (A.off + A.def) * wA : (B.off + B.def) * wB); // + better; the ratings as used (thin records pulled toward average)
    if (Math.abs(net(A) - net(B)) >= 1) why.push([Math.abs(net(A) - net(B)) * pace / 100, `${net(A) > net(B) ? g.a.name : g.b.name} rate better: net ${r1(Math.max(net(A), net(B)))} vs ${r1(Math.min(net(A), net(B)))} points per 100 possessions, adjusted for opponents and pulled toward average on thin records`]);
    if (hca) why.push([Math.abs(hca), `${h === 0 ? g.a.name : g.b.name} at home (+${r1(P.hca[g.kind])} pts, learned from ${g.kind === "nt" ? "national-team" : "club"} results)`]);
    if (Math.abs(offA - offB) >= 3) why.push([Math.abs(offA - offB) * pace / 200, `${offA > offB ? g.a.name : g.b.name} have the stronger offence`]);
    if (Math.abs(defA - defB) >= 3) why.push([Math.abs(defA - defB) * pace / 200, `${defA > defB ? g.a.name : g.b.name} have the stronger defence`]);
  }
  if (nmin < 4) why.push([0, `Thin record: ${Math.min(A?.n || 0, B?.n || 0)} game${nmin === 1 ? "" : "s"} for one side in our data, so the range is wider`]);
  for (const [pr, t] of [[prA, g.a], [prB, g.b]]) why.push([0, pr.announced ? `${t.name}: ${pr.source || "official roster posted by FIBA"}` : `${t.name}: roster from their last game${pr.from ? ` (${pr.from.slice(0, 10)})` : ""}; the final 12 is not posted yet${g.kind === "nt" ? " and national-team rosters change between windows" : ""}`]);
  const nNew = [...prA.players, ...prB.players].filter((p) => p.isNew).length; if (nNew) why.push([0, `${nNew} player${nNew > 1 ? "s" : ""} new to our data: estimated from their position until they play`]);
  const quarters = [0.255, 0.245, 0.25, 0.25].map((f) => [r1(pa * f), r1(pb * f)]);
  // Our line for a player sits at his average (what the projection is measured against). It is shown only for
  // 10+ projected minutes, with the reason when the projection differs; a gap over 30% with no minutes change is
  // flagged and kept out of the picks (that is where data errors hide).
  const players = pls.map((p, j) => { const s = sim.pts[j], base = p.avgPts ?? p.pts, ln = p.min >= 10 ? halfLine(base) : null, gap = p.pts - base;
    const minChg = p.avgMin ? (p.min - p.avgMin) / p.avgMin : 0, why = Math.abs(gap) < 1.5 || p.avgPts == null ? null : Math.abs(minChg) >= 0.15 ? `${r1(p.min)} projected minutes vs his usual ${r1(p.avgMin)}` : p.raw && Math.abs(p.pts / p.raw - 1) >= 0.1 && Math.sign(p.pts - p.raw) === Math.sign(gap) ? `this roster leaves ${p.pts > p.raw ? "more" : "fewer"} of the team's projected points for him (his share is scaled so the team adds up to its projected score)` : `${gap > 0 ? "softer" : "tougher"} opponent defence and the game pace`;
    const flagged = p.avgPts != null && base >= 4 && Math.abs(gap) / base > 0.3 && Math.abs(minChg) < 0.15 && !(p.raw && Math.abs(p.pts / p.raw - 1) >= 0.1);
    const noPick = p.avgPts == null || (base >= 4 && Math.abs(gap) / base > (p.gp < 10 ? 0.2 : 0.25)) || Math.abs(minChg) > 0.2 || (p.raw > 0 && Math.abs(p.pts / p.raw - 1) >= 0.15); // a 30%+ gap, a 20%+ minutes change or a 15%+ roster-share scaling (all from our own allocation) is not a named reason or a 20%+ minutes change from our own allocation is not a named reason
    return { ...p, lo: r1(q(s, 0.1)), hi: r1(q(s, 0.9)), line: ln, pOver: ln == null ? null : r3(share(s, (v) => v > ln)), lineWhy: why, flagged, noPick, m10: r3(share(s, (v) => v >= 10)), m15: r3(share(s, (v) => v >= 15)), m20: r3(share(s, (v) => v >= 20)) }; });
  const rec = { id: g.id, date: g.date, timed: g.timed, comp: g.comp, compName: g.compName, kind: g.kind, round: g.round, group: g.group, city: g.city, venue: g.venue, home: h,
    a: { ...g.a, n: A?.n || 0, w: A?.w || 0, l: A?.l || 0, off: r1(offA), def: r1(defA) }, b: { ...g.b, n: B?.n || 0, w: B?.w || 0, l: B?.l || 0, off: r1(offB), def: r1(defB) },
    proj: { a: r1(pa), b: r1(pb), pA: r3(pA), spread, total, pace: r1(pace), sd: r1(sd), lo: [r1(q(sim.sA, 0.1)), r1(q(sim.sB, 0.1))], hi: [r1(q(sim.sA, 0.9)), r1(q(sim.sB, 0.9))],
      close: r3(share(mg, (m) => Math.abs(m) <= 5)), blowout: r3(share(mg, (m) => Math.abs(m) >= 20)), ot: r3(share(mg, (m) => Math.abs(m) < 0.6)), coverA: r3(share(mg, (m) => m > spread)), over: r3(share(tt, (t) => t > total)) },
    quarters, why: why.sort((x, y) => y[0] - x[0]).map((w) => w[1]), players, rosterFrom: [prA.from, prB.from], announced: [prA.announced, prB.announced], rosterSource: [prA.source, prB.source], ha: [haRec(g.a.tid), haRec(g.b.tid)], confidence: confOf(pA, nmin, g.comp) };
  writeJSON(path.join(OUT, "games", `${g.id}.json`), rec);
  upOut.push({ id: g.id, date: g.date, timed: g.timed, comp: g.comp, kind: g.kind, round: g.round, group: g.group, a: rec.a, b: rec.b, proj: { a: rec.proj.a, b: rec.proj.b, pA: rec.proj.pA, spread, total }, confidence: rec.confidence, home: h });
  // picks: our own lines (no sportsbook). Winner, our spread side, total side, and player points at his average.
  const fav = pA >= 0.5 ? g.a.name : g.b.name, pf = Math.max(pA, 1 - pA);
  if (nmin >= 3) {
    picks.push({ gid: g.id, date: g.date, comp: g.comp, kind: "winner", pick: `${fav} to win`, p: r3(Math.min(0.92, pf)), game: `${g.a.code || g.a.name} vs ${g.b.code || g.b.name}`, fair: r1(1 / Math.min(0.92, pf) * 100) / 100 });
    picks.push({ gid: g.id, date: g.date, comp: g.comp, kind: "total", pick: `${rec.proj.over >= 0.5 ? "Over" : "Under"} ${total}`, p: r3(Math.max(rec.proj.over, 1 - rec.proj.over)), game: `${g.a.code || g.a.name} vs ${g.b.code || g.b.name}`, fair: r1(1 / Math.max(rec.proj.over, 1 - rec.proj.over) * 100) / 100 });
    let perGame = 0;
    for (const p of players.filter((x) => x.gp >= 3 && x.avgPts >= 8 && x.line != null && !x.flagged && !x.noPick).sort((a, b) => Math.abs(b.pOver - 0.5) - Math.abs(a.pOver - 0.5))) { if (perGame >= 2) break; perGame++; const po = p.pOver, side = po >= 0.5 ? "over" : "under", pp = Math.min(p.gp < 10 ? 0.85 : 0.9, Math.max(po, 1 - po)); /* cap: a handful of games cannot support 95% */
      const hl = (PL.get(p.pid)?.log || []).slice(-10).filter((l) => l[5] !== p.line), hov = hl.filter((l) => l[5] > p.line).length; /* his last 10 games at this line (counts only, shown with the pick) */
      picks.push({ gid: g.id, date: g.date, comp: g.comp, kind: "prop", pick: `${p.n} ${side} ${p.line} points`, p: r3(pp), pid: p.pid, l10: [side === "over" ? hov : hl.length - hov, hl.length], game: `${g.a.code || g.a.name} vs ${g.b.code || g.b.name}`, proj: p.pts, avg: p.avgPts, fair: r1(1 / pp * 100) / 100, why: `projected ${p.pts} (range ${p.lo}-${p.hi}) vs his ${p.avgPts} average over ${p.gp} games${p.lineWhy ? ": " + p.lineWhy : ""}` }); }
  }
}

// ---------------------------------------------------------------- results, accuracy, teams, players
const results = R.log.map((x) => ({ id: x.g.id, date: x.g.date, comp: x.g.comp, kind: x.g.kind, round: x.g.round, a: { tid: x.A, code: x.g.box.teams[0].code, name: x.g.box.teams[0].name, score: x.g.box.teams[0].score }, b: { tid: x.B, code: x.g.box.teams[1].code, name: x.g.box.teams[1].name, score: x.g.box.teams[1].score },
  proj: { a: r1(x.pa), b: r1(x.pb), pA: r3(x.pA) }, graded: x.warm, right: (x.pA >= 0.5) === (x.g.box.teams[0].score > x.g.box.teams[1].score),
  why: (() => { const e = (x.g.box.teams[0].score - x.g.box.teams[1].score) - (x.pa - x.pb), t = e > 0 ? x.ta : x.tb, o = e > 0 ? x.tb : x.ta, who = e > 0 ? x.g.box.teams[0].name : x.g.box.teams[1].name, bits = [];
    if (t.f3a && o.f3a) { const d = t.f3m / t.f3a - o.f3m / o.f3a; if (d > 0.08) bits.push(`${who} shot ${Math.round((t.f3m / t.f3a) * 100)}% from three`); }
    if (o.to - t.to >= 5) bits.push(`${who} forced ${o.to} turnovers`); if (t.or - o.or >= 5) bits.push(`${who} won the offensive glass ${t.or}-${o.or}`); if (t.ftm - o.ftm >= 8) bits.push(`${who} made ${t.ftm} free throws to ${o.ftm}`);
    return Math.abs(e) >= 8 ? `Missed by ${r1(Math.abs(e))} pts toward ${who}${bits.length ? ": " + bits.join(", ") : ""}.` : null; })() })).reverse();
writeJSON(path.join(OUT, "results.json"), results);

const cal = Array.from({ length: 5 }, (_, i) => ({ lo: 50 + i * 10, hi: 60 + i * 10, n: 0, won: 0 }));
for (const x of R.log.filter((x) => x.warm)) { const p = Math.max(x.pA, 1 - x.pA), won = (x.pA >= 0.5) === (x.g.box.teams[0].score > x.g.box.teams[1].score), b = cal[Math.min(4, Math.floor((p - 0.5) * 10))]; b.n++; if (won) b.won++; }
const byComp = {}; for (const x of R.log.filter((x) => x.warm)) { const c = (byComp[x.g.comp] ||= { comp: x.g.comp, n: 0, right: 0, mae: 0 }); c.n++; if ((x.pA >= 0.5) === (x.g.box.teams[0].score > x.g.box.teams[1].score)) c.right++; c.mae += Math.abs((x.pa - x.pb) - (x.g.box.teams[0].score - x.g.box.teams[1].score)); }
const accuracy = { graded: R.n, brier: r3(R.brier), logloss: r3(R.ll), winner: r3(R.acc), marginMAE: r1(R.mae), totalMAE: r1(R.tmae), playerPtsMAE: pMae == null ? null : r1(pMae), playerGraded: pPred.length,
  calibration: cal.map((b) => ({ ...b, rate: b.n ? r3(b.won / b.n) : null })), byComp: Object.values(byComp).map((c) => ({ comp: c.comp, n: c.n, winner: r3(c.right / c.n), marginMAE: r1(c.mae / c.n), low: c.n < 20 })).sort((a, b) => b.n - a.n),
  learned: { ...P, note: "Chosen by replaying every FIBA game in date order and keeping the settings with the best Brier score: k = how fast ratings react to a result, hca = home-court points, hl = days for ratings to fade halfway back to average between windows, sd = spread of results, k0 = how many games of average a team's rating is blended with (a minimum of 4 is a rule, so thin records are never trusted fully)." },
  grid: grid.length, rule: "Each game is projected only from games before it, then graded. A game counts once both teams have 3+ games in our data." };
writeJSON(path.join(OUT, "accuracy.json"), accuracy);

const REGION = { "WCQ Asia": "Asia", "Asia Cup": "Asia", "WCQ Europe": "Europe", EuroBasket: "Europe", "WCQ Americas": "Americas", AmeriCup: "Americas", "WCQ Africa": "Africa", AfroBasket: "Africa" };
const regionOf = (tid, kind) => { const c = {}; for (const g of games) if (g.box.teams.some((t) => t.tid === tid)) { const r = kind === "nt" ? REGION[g.comp] || "World" : g.comp; c[r] = (c[r] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "Other"; };
const teams = [...R.T.values()].map((t) => { const last = [...games].reverse().find((g) => g.box.teams.some((x) => x.tid === t.tid)), side = last.box.teams[0].tid === t.tid ? 0 : 1, info = last.box.teams[side];
  const w = t.n / (t.n + P.k0) || 0; // shown as used in projections: thin records pulled toward average
  return { tid: t.tid, code: info.code, name: info.name, kind: t.kind, comp: last.comp, region: regionOf(t.tid, t.kind), ha: haRec(t.tid), off: r1(t.off * w), def: r1(t.def * w), net: r1((t.off + t.def) * w), netRaw: r1(t.off + t.def), pace: r1(R.lg[t.kind].pace + t.pace), gp: t.n, w: t.w, l: t.l, ppg: r1(t.pf / t.n), oppg: r1(t.pa / t.n), last: t.last }; })
  .sort((a, b) => b.net - a.net);
writeJSON(path.join(OUT, "teams.json"), teams);
for (const t of teams) {
  const tg = games.filter((g) => g.box.teams.some((x) => x.tid === t.tid)), shots = [], oppShots = [];
  for (const g of tg) { const side = g.box.teams[0].tid === t.tid ? 0 : 1; for (const s of g.box.shots) (s[1] === side ? shots : oppShots).push(s); }
  const ro = lastRoster(t.tid);
  writeJSON(path.join(OUT, "teams", `${t.tid}.json`), { ...t, zonesOff: zonesFor(shots), zonesDef: zonesFor(oppShots), roster: ro.list.map((s) => ({ pid: s.pid, n: s.n, pos: s.pos, no: s.no, min: r1(s.min), pts: r1(s.rate.pts * s.min), reb: r1(s.rate.reb * s.min), ast: r1(s.rate.ast * s.min), gp: s.gp })), rosterFrom: ro.date,
    games: tg.map((g) => { const side = g.box.teams[0].tid === t.tid ? 0 : 1; return { id: g.id, date: g.date, comp: g.comp, opp: g.box.teams[1 - side].name, oppCode: g.box.teams[1 - side].code, oppTid: g.box.teams[1 - side].tid, us: g.box.teams[side].score, them: g.box.teams[1 - side].score }; }).reverse(),
    next: upOut.filter((u) => u.a.tid === t.tid || u.b.tid === t.tid).map((u) => u.id) });
}
// ---------------------------------------------------------------- archetypes
// Playstyle labels for every player, from his per-36 rates and where he shoots, ranked against FIBA players with
// 5+ games and 12+ minutes. Up to three labels; "Role player" when nothing stands out.
const ARCH_POOL = [...PL.values()].filter((s) => s.gp >= 5 && s.min >= 12);
const pctl = (k) => { const v = ARCH_POOL.map((s) => s.rate[k] * 36).sort((a, b) => a - b); return (p) => v[Math.floor(p * (v.length - 1))] || 0; };
const Q = { pts: pctl("pts"), ast: pctl("ast"), reb: pctl("reb"), or: pctl("or"), blk: pctl("blk"), stl: pctl("stl") };
function archetypes(s) {
  if (s.gp < 3) return ["Not enough games yet"];
  const r = (k) => s.rate[k] * 36, fga = s.rate.fga || 1e-9, g = grpOf(s.pos), z = {}; let tot = 0;
  for (const sh of s.shots) { const k = zoneOf(sh[3], sh[4], sh[6]); if (k) { z[k] = (z[k] || 0) + 1; tot++; } }
  const sh = (k) => (tot ? (z[k] || 0) / tot : 0), three = s.rate.f3a / fga, ftr = s.rate.fta / fga, p3 = s.rate.f3a ? s.rate.f3m / s.rate.f3a : 0, out = [];
  if (r("pts") >= Q.pts(0.85)) out.push("Primary scorer");
  if (r("ast") >= Q.ast(0.85) || (g === "G" && r("ast") >= Q.ast(0.75))) out.push("Floor general");
  if (three >= 0.5 && p3 >= 0.36 && s.rate.f3a * s.min * s.gp >= 25) out.push("Sharpshooter"); else if (three >= 0.5) out.push("Spot-up shooter");
  if (g !== "G" && three >= 0.3) out.push("Stretch big");
  if (g !== "C" && sh("rim") >= 0.35 && ftr >= 0.3) out.push("Slasher");
  if (g === "C" && sh("rim") >= 0.5 && three < 0.1) out.push("Rim runner");
  if (sh("paint") >= 0.3) out.push("Post / paint scorer");
  if (sh("mid") >= 0.3) out.push("Mid-range shooter");
  if (r("reb") >= Q.reb(0.85) || r("or") >= Q.or(0.9)) out.push("Glass cleaner");
  if (r("blk") >= Q.blk(0.85)) out.push("Rim protector");
  if (r("stl") >= Q.stl(0.85)) out.push("Ball hawk");
  return out.length ? out.slice(0, 3) : ["Role player"];
}
const players = [];
for (const s of PL.values()) {
  if (!s.gp) continue;
  const avg = (i) => r1(s.log.reduce((a, l) => a + l[i], 0) / s.log.length), z = zonesFor(s.shots);
  const idx = { pid: s.pid, n: s.n, pos: s.pos, team: s.team, kind: s.kind, teamName: s.teams[s.team]?.name, teamCode: s.teams[s.team]?.code, gp: s.gp, min: avg(4), pts: avg(5), reb: avg(6), ast: avg(7), hot: z.filter((x) => x.tag === "hot").map((x) => x.id), cold: z.filter((x) => x.tag === "cold").map((x) => x.id), last: s.last, arch: archetypes(s) };
  players.push(idx);
  const fg = s.log.reduce((a, l) => [a[0] + l[11], a[1] + l[12], a[2] + l[13], a[3] + l[14], a[4] + l[15], a[5] + l[16]], [0, 0, 0, 0, 0, 0]);
  writeJSON(path.join(OUT, "players", `${s.pid}.json`), { ...idx, no: s.no, teams: Object.values(s.teams), zones: z, shooting: { fg: fg[1] ? r1((fg[0] / fg[1]) * 100) : null, three: fg[3] ? r1((fg[2] / fg[3]) * 100) : null, ft: fg[5] ? r1((fg[4] / fg[5]) * 100) : null, fga: r1(fg[1] / s.gp), f3a: r1(fg[3] / s.gp), fta: r1(fg[5] / s.gp) },
    rates: Object.fromEntries(Object.entries(s.rate).map(([k, v]) => [k, r3(v * 36)])), projMin: r1(s.min),
    log: s.log.slice(-40).reverse().map((l) => ({ id: l[0], date: l[1], tid: l[2], opp: l[3], min: l[4], pts: l[5], reb: l[6], ast: l[7], stl: l[8], blk: l[9], to: l[10], fg: `${l[11]}/${l[12]}`, three: `${l[13]}/${l[14]}`, ft: `${l[15]}/${l[16]}`, start: l[17], pm: l[18] })),
    shots: s.shots.filter((x) => x[3] || x[4]).slice(-300).map((x) => [x[3], x[4], x[5], x[6]]) });
}
players.sort((a, b) => b.pts - a.pts);
writeJSON(path.join(OUT, "players.json"), players);
writeJSON(path.join(OUT, "upcoming.json"), upOut);
// ---------------------------------------------------------------- pre-tip ledger (frozen at tip-off, graded after)
// The last projection made before tip-off is kept and never recomputed, so this record cannot be flattered by
// re-learning later. Started 2026-11-11.
const PT_FILE = path.join(FD, "pretip.json"), PT = readJSON(PT_FILE, { started: new Date().toISOString(), games: {} });
for (const u of upOut) if (Date.parse(u.date) > now) PT.games[u.id] = { id: u.id, date: u.date, comp: u.comp, kind: u.kind, a: u.a.name, b: u.b.name, pA: u.proj.pA, pa: u.proj.a, pb: u.proj.b, spread: u.proj.spread, total: u.proj.total, conf: u.confidence, saved: new Date().toISOString(), params: P };
for (const [id, x] of Object.entries(PT.games)) { const b = box.get(id); if (b && !x.act) { x.act = { a: b.teams[0].score, b: b.teams[1].score }; x.right = (x.pA >= 0.5) === (x.act.a > x.act.b); } }
writeJSON(PT_FILE, PT);
const ptg = Object.values(PT.games).filter((x) => x.act);
writeJSON(path.join(OUT, "pretip.json"), { started: PT.started, graded: ptg.length, waiting: Object.values(PT.games).filter((x) => !x.act).length,
  winner: ptg.length ? r3(ptg.filter((x) => x.right).length / ptg.length) : null, brier: ptg.length ? r3(ptg.reduce((a, x) => a + (x.pA - (x.act.a > x.act.b ? 1 : 0)) ** 2, 0) / ptg.length) : null,
  marginMAE: ptg.length ? r1(ptg.reduce((a, x) => a + Math.abs((x.pa - x.pb) - (x.act.a - x.act.b)), 0) / ptg.length) : null, games: ptg.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100) });
picks.sort((a, b) => b.p - a.p);
writeJSON(path.join(OUT, "picks.json"), { generated: new Date().toISOString(), note: "Our own lines from the simulation (10,000 runs per game). No sportsbook data is used or shown. Player lines are set at his average; the pick is the side our projection favours.", picks });
const comps = EVENTS.map((e) => ({ slug: e.slug, name: e.name, short: e.short, kind: e.kind, games: games.filter((g) => g.slug === e.slug).length, upcoming: upOut.filter((u) => sched.find((s) => s.id === u.id)?.slug === e.slug).length }));
writeJSON(path.join(OUT, "meta.json"), { lg: { nt: { ppp: r1(R.lg.nt.ppp), pace: r1(R.lg.nt.pace) }, club: { ppp: r1(R.lg.club.ppp), pace: r1(R.lg.club.pace) } }, hca: P.hca, sd: P.sd, built: new Date().toISOString(), games: games.length, upcoming: upOut.length, players: players.length, teams: teams.length, comps, zones: ZONES.map(([id, label]) => ({ id, label })),
  source: "fiba.basketball public game pages: schedules, box scores and play-by-play shot locations. No betting data.", accuracy: { graded: R.n, winner: r3(R.acc), brier: r3(R.brier) } });
console.log(`wrote ${upOut.length} upcoming, ${teams.length} teams, ${players.length} players, ${picks.length} picks; player points MAE ${pMae == null ? "-" : r1(pMae)} on ${pPred.length}`);
