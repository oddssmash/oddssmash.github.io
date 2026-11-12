// MLBB model: the NBA/FIBA workflow, adapted to drafts.
//  1. Walk every finished series in date order. Before each one, project it from what was known then (team
//     ratings + a region offset that international events connect), then grade it, then learn from the games.
//  2. Draft layer, learned game by game from earlier games only: pro meta strength per hero, hero pairs on the same
//     side (combos) and hero-vs-hero results (counters). Used for the Draft lab and the scenario cards, and tested
//     walk-forward on every game once both drafts are known.
//  3. Learning: rating speed, region spread, season carry-over and the draft weight are chosen by replaying all
//     history and keeping the settings with the best Brier score; the last projection before each match is also
//     frozen (pre-tip record).
//  4. Upcoming: series win chance, exact scores, map count, scenarios (comfort heroes, likely bans, signature hero
//     banned, side, early vs late games) and our own lines. No sportsbook data is used.
// Reads data/mlbb/pages, data/mlbb/rosters, data/mlbb/heroes-ranked.json. Writes public-mlbb/data/.
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON } from "../lib/util.mjs";
import { EVENTS, ROLES } from "./events.mjs";

const MD = path.join(DATA, "mlbb"), OUT = process.env.MLBB_OUT ? path.resolve(process.env.MLBB_OUT) : path.join(ROOT, "public-mlbb", "data");
for (const d of ["", "matches", "teams", "players"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const DAY = 86400000, now = Date.now(), r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;
const safe = (t) => String(t).replace(/[^A-Za-z0-9]+/g, "_");
const lg = (p) => 1 / (1 + Math.exp(-p)), logit = (p) => Math.log(p / (1 - p));

// ---------------------------------------------------------------- load
const all = [];
for (const f of fs.readdirSync(path.join(MD, "pages"))) for (const m of readJSON(path.join(MD, "pages", f)).matches) all.push(m);
// One name per team: Liquipedia's team templates are case-insensitive ("aurora gaming ph" = "Aurora Gaming PH"),
// and a few teams use a different tag at international events.
const ALIAS = { "srg.og": "Selangor Red Giants", srg: "Selangor Red Giants" };
// Short template names ("bac", "kog", "Onic PH") expanded by Liquipedia (scripts/mlbb/teamnames.mjs). A short name is
// merged only when its full name is already used in the same league, so a name reused by another team elsewhere
// (for example "Alter Ego" in China and Indonesia) is never merged by mistake.
{ const TN = readJSON(path.join(MD, "team-names.json"), {}), inLeague = {};
  for (const m of all) for (const n of [m.a, m.b]) (inLeague[m.league] ||= new Set()).add(String(n).toLowerCase());
  for (const m of all) for (const k of ["a", "b"]) { const raw = String(m[k]).toLowerCase(), full = TN[raw]; if (full && full.toLowerCase() !== raw && !ALIAS[raw] && (inLeague[m.league]?.has(full.toLowerCase()) || /(male team)$/.test(raw))) ALIAS[raw] = full; } }
const cnt = {}; for (const m of all) for (const n of [m.a, m.b]) { const k = n.toLowerCase(); (cnt[k] ||= {})[n] = (cnt[k][n] || 0) + 1; }
for (const v of Object.values(ALIAS)) { const k = v.toLowerCase(); (cnt[k] ||= {})[v] = (cnt[k][v] || 0) + 1; }
const disp = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, Object.entries(v).sort((a, b) => (/[A-Z]/.test(b[0]) - /[A-Z]/.test(a[0])) || b[1] - a[1])[0][0]])); // most common spelling that has capitals
const canon = (n) => { const x = ALIAS[String(n).toLowerCase()] || n; return disp[String(x).toLowerCase()] || x; };
for (const m of all) { m.a = canon(m.a); m.b = canon(m.b); }
// one name per hero: match every spelling ("gatot", "popol and kupa") to Liquipedia's hero names
{ const LPH = Object.keys(readJSON(path.join(MD, "heroes-lp.json"), { heroes: {} }).heroes), strip = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, ""), byStrip = new Map(LPH.map((h) => [strip(h), h])), memo = new Map();
  // short forms used on some Liquipedia match pages
  const SHORT = { paq: "paquito", yss: "yi sun-shin", yi: "yi sun-shin", yz: "yu zhong", yu: "yu zhong", dyr: "dyrroth", kag: "kagura", khu: "khufra", xb: "x.borg", zx: "zhuxin", bea: "beatrix", leo: "leomord", luo: "luo yi", wan: "wanwan", pove: "phoveus", tig: "tigreal", hel: "helcurt", jaw: "jawhead", bal: "balmond", sil: "silvanna", vale: "valentina", "wu zetian": "zetian" };
  const HN = (h) => { if (!h) return h; if (memo.has(h)) return memo.get(h); if (SHORT[String(h).toLowerCase()]) h = SHORT[String(h).toLowerCase()]; const k = strip(h).replace(/and/g, ""); let r = byStrip.get(strip(h)) || [...byStrip].find(([s2]) => s2.replace(/and/g, "") === k)?.[1] || (k.length >= 4 ? [...byStrip].find(([s2]) => s2.startsWith(k))?.[1] : null) || h; memo.set(h, r); return r; };
  for (const m of all) for (const g of m.games) { g.h1 = g.h1.map(HN); g.h2 = g.h2.map(HN); g.b1 = g.b1.map(HN); g.b2 = g.b2.map(HN); if (g.map) g.map = g.map.trim(); } }
const order = Object.fromEntries(EVENTS.map((e, i) => [e.page, i]));
const done = all.filter((m) => m.done && m.games.length && !m.walkover).sort((a, b) => (a.date || "").localeCompare(b.date || "") || order[a.page] - order[b.page]);
const upcoming = all.filter((m) => !m.done && m.date && Date.parse(m.date) > now - 6 * 3600000).sort((a, b) => a.date.localeCompare(b.date));
// rosters by season page: team -> [{player, role, sub}]
const ROST = {}; const RD = path.join(MD, "rosters"); if (fs.existsSync(RD)) for (const f of fs.readdirSync(RD)) { const r = readJSON(path.join(RD, f)); ROST[r.page] = r.teams; }
const seasonOf = (page) => page.split("/").slice(0, -1).join("/");
const rosterFor = (team, page) => { const R0 = ROST[seasonOf(page)] || {}; const k = Object.keys(R0).find((x) => x.toLowerCase() === team.toLowerCase() || ALIAS[x.toLowerCase()] === team); return (k ? R0[k] : []).filter((x) => !x.sub && x.role); };
const ranked = Object.fromEntries((readJSON(path.join(MD, "heroes-ranked.json"), { heroes: [] }).heroes || []).map((h) => [h.slug.replace(/-/g, " ").replace(/ and /g, " & "), h]));
console.log(`MLBB: ${done.length} finished series (${done.reduce((a, m) => a + m.games.length, 0)} games), ${upcoming.length} upcoming`);

// series math: chance to win a best-of-n from a single-game chance
function series(p, bo) {
  const need = Math.ceil(bo / 2), out = {}; let win = 0;
  const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (let l = 0; l < need; l++) { const pr = C(need - 1 + l, l) * p ** need * (1 - p) ** l; out[`${need}-${l}`] = pr; win += pr; }
  for (let w = 0; w < need; w++) out[`${w}-${need}`] = C(need - 1 + w, w) * (1 - p) ** need * p ** w;
  return { win, scores: out };
}

// ---------------------------------------------------------------- draft tables (walk-forward)
// hero: pro picks/wins/bans with time decay; pair (same side) and vs (opposing) records. Shrunk toward 50%.
const HL = 120; // days for the draft tables to fade by half (patches change the meta)
function makeDraft() {
  const H = new Map(), PAIR = new Map(), VS = new Map(); let games = 0, lastDate = null;
  const decayAll = (date) => { if (!lastDate || !date) { lastDate = date || lastDate; return; } const f = 0.5 ** (Math.max(0, (Date.parse(date) - Date.parse(lastDate)) / DAY) / HL); if (f > 0.9999) return; for (const m of [H, PAIR, VS]) for (const v of m.values()) { v.n *= f; v.w *= f; if (v.b != null) v.b *= f; } games *= f; lastDate = date; };
  const h = (k) => { if (!H.has(k)) H.set(k, { n: 0, w: 0, b: 0 }); return H.get(k); };
  const rec = (M, k) => { if (!M.has(k)) M.set(k, { n: 0, w: 0 }); return M.get(k); };
  const pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  return {
    H, PAIR, VS, get games() { return games; },
    // draft edge for side 1 in logits, from hero strength, combos and counters (all shrunk)
    edge(h1, h2) {
      const st = (x) => { const v = H.get(x); return v ? logit((v.w + 4) / (v.n + 8)) : 0; };
      let e = h1.reduce((a, x) => a + st(x), 0) - h2.reduce((a, x) => a + st(x), 0), syn = 0, cnt = 0;
      const pr = (a, b) => { const v = PAIR.get(pk(a, b)); return v ? logit((v.w + 3) / (v.n + 6)) : 0; };
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) syn += pr(h1[i], h1[j]) - pr(h2[i], h2[j]);
      for (const a of h1) for (const b of h2) { const v = VS.get(`${a}>${b}`); cnt += v ? logit((v.w + 3) / (v.n + 6)) : 0; }
      return { hero: e, syn, cnt };
    },
    learn(g, date) {
      decayAll(date); games++;
      const w1 = g.w === 1 ? 1 : 0;
      g.h1.forEach((x) => { const v = h(x); v.n++; v.w += w1; }); g.h2.forEach((x) => { const v = h(x); v.n++; v.w += 1 - w1; });
      [...g.b1, ...g.b2].forEach((x) => h(x).b++);
      for (const [hs, w] of [[g.h1, w1], [g.h2, 1 - w1]]) for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const v = rec(PAIR, pk(hs[i], hs[j])); v.n++; v.w += w; }
      for (const a of g.h1) for (const b of g.h2) { const v = rec(VS, `${a}>${b}`); v.n++; v.w += w1; const u = rec(VS, `${b}>${a}`); u.n++; u.w += 1 - w1; }
    },
  };
}

// ---------------------------------------------------------------- replay (team ratings + draft check)
function replay(P, record = false) {
  const T = new Map(), REG = {}, D = makeDraft(); // region offsets, created as regions appear
  const team = (n, region) => { if (!T.has(n)) T.set(n, { name: n, r: 0, n: 0, season: null, region, w: 0, l: 0, gw: 0, gl: 0 }); return T.get(n); };
  let sb = 0, sll = 0, sn = 0, sright = 0, gb = 0, gn = 0, gbD = 0, ib = 0, inn = 0; const log = [];
  for (const m of done) {
    const A = team(m.a, m.region), B = team(m.b, m.region), season = m.page.split("/").slice(0, -1).join("/");
    for (const t of [A, B]) { if (m.kind === "league" && t.season && t.season !== season) t.r *= P.carry; if (m.kind === "league") { t.season = season; t.region = m.region; } }
    const reg = (t) => (REG[t.region] || 0) * P.regW;
    const cross = A.region !== B.region, d = (A.r + reg(A) - (B.r + reg(B))) * (cross ? P.cx : 1), pg = lg(d), s = series(pg, m.bo), won = m.score[0] > m.score[1] ? 1 : 0;
    const warm = A.n >= 4 && B.n >= 4;
    if (warm && m.kind === "intl" && A.region !== B.region) { ib += (s.win - won) ** 2; inn++; }
    if (warm) { sb += (s.win - won) ** 2; sll += -Math.log(Math.max(1e-6, won ? s.win : 1 - s.win)); sn++; if ((s.win >= 0.5) === !!won) sright++; }
    if (record) log.push({ m, A: A.name, B: B.name, pg, pS: s.win, warm, nA: A.n, nB: B.n });
    // games: grade single games (team-only and with the draft layer), then learn
    for (const g of m.games) {
      const y = g.w === 1 ? 1 : 0, dd = (A.r + reg(A) - (B.r + reg(B))) * (cross ? P.cx : 1), p0 = lg(dd), e = D.edge(g.h1, g.h2), p1 = lg(dd + P.wd * (e.hero * 0.2 + e.syn * 0.1 + e.cnt * 0.04));
      if (warm && D.games > 200) { gb += (p0 - y) ** 2; gbD += (p1 - y) ** 2; gn++; }
      const k = P.k * (A.n < 6 || B.n < 6 ? 1.5 : 1), err = y - p0;
      A.r += k * err; B.r -= k * err; if (m.kind === "intl" && A.region !== B.region && A.region !== "INTL" && B.region !== "INTL") { REG[A.region] = (REG[A.region] || 0) + P.kr * err; REG[B.region] = (REG[B.region] || 0) - P.kr * err; }
      if (y) { A.gw++; B.gl++; } else { B.gw++; A.gl++; }
      D.learn(g, m.date);
    }
    A.n++; B.n++; if (won) { A.w++; B.l++; } else { B.w++; A.l++; }
  }
  return { T, REG, D, ibrier: inn ? ib / inn : 0, inn, brier: sb / sn, ll: sll / sn, acc: sright / sn, n: sn, gBrier: gb / gn, gBrierDraft: gbD / gn, gn, log };
}
const grid = []; for (const k of [0.1, 0.16, 0.24, 0.32]) for (const carry of [0.5, 0.7, 0.85, 1]) for (const kr of [0.04]) for (const cx of (process.env.CX ? [+process.env.CX] : [0.1, 0.2, 0.3, 0.5])) for (const regW of [1]) for (const wd of [0, 0.5, 1, 1.5]) grid.push({ k, carry, kr, regW, wd, cx });
let best = null; for (const P of grid) { const r = replay(P); const score = r.brier + 0.5 * r.gBrierDraft + 0.5 * r.ibrier; if (!best || score < best.score) best = { P, r, score }; }
const P = best.P, R = replay(P, true);
console.log("learned", JSON.stringify(P), `series Brier ${r3(R.brier)} (cross-region ${r3(R.ibrier)} on ${R.inn}) winner ${(R.acc * 100).toFixed(1)}% (${R.n}); games Brier team-only ${r3(R.gBrier)} with draft ${r3(R.gBrierDraft)} (${R.gn})`, "regions", JSON.stringify(Object.fromEntries(Object.entries(R.REG).map(([k, v]) => [k, r3(v)]))));

// ---------------------------------------------------------------- heroes, players, teams (from all history)
const D = R.D, HERO = [];
const totalGames = done.reduce((a, m) => a + m.games.length, 0);
const raw = new Map(); // undecayed counts for display
for (const m of done) for (const g of m.games) { for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { hs.forEach((x, i) => { const v = raw.get(x) || { n: 0, w: 0, b: 0, roles: {} }; v.n++; if (w) v.w++; v.roles[ROLES[i]] = (v.roles[ROLES[i]] || 0) + 1; if (w) (v.rw ||= {})[ROLES[i]] = (v.rw?.[ROLES[i]] || 0) + 1; raw.set(x, v); }); bs.forEach((x) => { const v = raw.get(x) || { n: 0, w: 0, b: 0, roles: {} }; v.b++; raw.set(x, v); }); } }
const recent = new Map(); for (const m of done.filter((m) => Date.parse(m.date) > now - 150 * DAY)) for (const g of m.games) { for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { hs.forEach((x) => { const v = recent.get(x) || { n: 0, w: 0, b: 0 }; v.n++; if (w) v.w++; recent.set(x, v); }); bs.forEach((x) => { const v = recent.get(x) || { n: 0, w: 0, b: 0 }; v.b++; recent.set(x, v); }); } }
const recentGames = done.filter((m) => Date.parse(m.date) > now - 150 * DAY).reduce((a, m) => a + m.games.length, 0) || 1;
for (const [name, v] of raw) {
  const d = D.H.get(name) || { n: 0, w: 0, b: 0 }, rc = recent.get(name) || { n: 0, w: 0, b: 0 }, str = logit((d.w + 4) / (d.n + 8));
  const solo = (h) => { const s = D.H.get(h) || { n: 0, w: 0 }; return (s.w + 4) / (s.n + 8); };
  const syn = [...D.PAIR].filter(([k, x]) => k.split("|").includes(name) && x.n >= 3).map(([k, x]) => { const o = k.split("|").find((y) => y !== name), wr = (x.w + 3) / (x.n + 6); return { with: o, n: r1(x.n), wr: r3(wr), lift: r3(wr - (solo(name) + solo(o)) / 2) }; }).sort((a, b) => b.lift - a.lift);
  const cnt = [...D.VS].filter(([k, x]) => k.startsWith(name + ">") && x.n >= 3).map(([k, x]) => ({ vs: k.split(">")[1], n: r1(x.n), wr: r3((x.w + 3) / (x.n + 6)) })).sort((a, b) => b.wr - a.wr);
  const rk = ranked[name];
  HERO.push({ id: name, games: v.n, wins: v.w, wr: r3(v.w / Math.max(1, v.n)), bans: v.b, presence: r3((v.n + v.b) / totalGames), recent: { picks: rc.n, wr: rc.n ? r3(rc.w / rc.n) : null, bans: rc.b, presence: r3((rc.n + rc.b) / recentGames) }, strength: r3(str),
    roles: Object.entries(v.roles).sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ r, n, w: v.rw?.[r] || 0 })), combos: syn.slice(0, 6), combosBad: syn.slice(-3).reverse(), counters: cnt.slice(0, 6), counteredBy: cnt.slice(-6).reverse(), ranked: rk ? { wr: rk.winRate, pick: rk.pickRate, ban: rk.banRate, tier: rk.tier } : null });
}
// ---------------------------------------------------------------- HERO TRAITS, early/late, patch
// Traits from Liquipedia's hero pages (role, specialties, crowd control counted from the skill text, base toughness);
// early and late from pro results: the hero's record in games under 14 minutes vs 18+ minutes (pulled toward 50%).
const LP = readJSON(path.join(MD, "heroes-lp.json"), { heroes: {}, patches: [] });
const secs = (x) => { const [a, b] = String(x || "").split(":").map(Number); return a * 60 + (b || 0); };
const sl = new Map(); // hero -> {s:[w,n], l:[w,n]}
for (const m of done) for (const g of m.games) { const L = secs(g.len); if (!L) continue; const k = L < 14 * 60 ? "s" : L >= 18 * 60 ? "l" : null; if (!k) continue;
  for (const [hs, w] of [[g.h1, g.w === 1], [g.h2, g.w === 2]]) for (const h of hs) { const v = sl.get(h) || { s: [0, 0], l: [0, 0] }; v[k][0] += w ? 1 : 0; v[k][1]++; sl.set(h, v); } }
const shr = (w, n, k = 8) => (w + k / 2) / (n + k);
const ROLE_T = { Tank: { tank: 1, cc: 0.35, dmg: 0.15, engage: 0.5, sustain: 0.3 }, Fighter: { tank: 0.6, dmg: 0.6, engage: 0.4, sustain: 0.35 }, Assassin: { burst: 0.7, dmg: 0.75, engage: 0.5, tank: 0.1 }, Mage: { burst: 0.55, dmg: 0.85, cc: 0.2, tank: 0.1 }, Marksman: { dmg: 1, push: 0.45, tank: 0.1, late: 0.15 }, Support: { sustain: 0.8, cc: 0.25, tank: 0.35, dmg: 0.25 } };
const SPEC_T = { "Crowd Control": { cc: 0.45 }, Control: { cc: 0.35 }, Initiator: { engage: 0.5, cc: 0.2 }, Charge: { engage: 0.4 }, Chase: { engage: 0.35, burst: 0.1 }, Burst: { burst: 0.45 }, Finisher: { burst: 0.35 }, Reap: { burst: 0.25, dmg: 0.15 }, Damage: { dmg: 0.25 }, "Magic Damage": { dmg: 0.2 }, "Mixed Damage": { dmg: 0.2 }, Push: { push: 0.6 }, Poke: { dmg: 0.15, push: 0.15 }, Regen: { sustain: 0.45, tank: 0.1 }, Guard: { sustain: 0.35, tank: 0.2 }, Support: { sustain: 0.35 } };
const TRAITS = ["cc", "burst", "tank", "dmg", "push", "engage", "sustain", "early", "late"];
function traitsOf(id) {
  const lp = LP.heroes[id] || LP.heroes[id.replace(/ & /g, " and ")] || null, t = Object.fromEntries(TRAITS.map((k) => [k, 0]));
  if (lp) { for (const [k, v] of Object.entries(ROLE_T[lp.role] || {})) t[k] += v; for (const [k, v] of Object.entries(ROLE_T[lp.role2] || {})) t[k] += v * 0.4; for (const sp of lp.spec) for (const [k, v] of Object.entries(SPEC_T[sp] || {})) t[k] += v;
    const c = lp.cc || {}, hard = (c.stun || 0) + (c.airborne || 0) + (c.knockback || 0) + (c.suppress || 0) * 1.5 + (c.immobilize || 0) + (c.taunt || 0) + (c.freeze || 0) + (c.petrify || 0) + (c.silence || 0) * 0.7 + (c.pull || 0) + (c.charm || 0); t.cc += Math.min(0.8, hard * 0.2 + (c.slow || 0) * 0.05); }
  const v = sl.get(id); if (v) { const ws = shr(...v.s), wl = shr(...v.l); t.early += Math.max(0, (ws - wl) * 4); t.late += Math.max(0, (wl - ws) * 4); }
  for (const k of TRAITS) t[k] = Math.round(Math.min(1.5, t[k]) * 100) / 100;
  return { t, lp, sl: v ? { short: v.s, long: v.l } : null };
}
const lastPatch = [...LP.patches].reverse().find((p) => Date.parse(p.release) <= now) || null;
const patchHist = (id) => LP.patches.flatMap((p) => p.changes.filter((c) => c.hero === id).map((c) => ({ patch: p.patch, release: p.release, type: c.type }))).slice(-4).reverse();
for (const h of HERO) { const x = traitsOf(h.id); h.traits = x.t; h.lp = x.lp ? { role: x.lp.role, role2: x.lp.role2, lane: x.lp.lane, spec: x.lp.spec, cc: x.lp.cc } : null; h.shortLong = x.sl; h.patches = patchHist(h.id);
  const since = lastPatch ? done.filter((m) => m.date >= lastPatch.release) : []; let pn = 0, pw = 0, pb = 0; for (const m of since) for (const g of m.games) { if (g.h1.includes(h.id)) { pn++; if (g.w === 1) pw++; } if (g.h2.includes(h.id)) { pn++; if (g.w === 2) pw++; } if (g.b1.includes(h.id) || g.b2.includes(h.id)) pb++; }
  h.thisPatch = lastPatch ? { patch: lastPatch.patch, picks: pn, wins: pw, bans: pb } : null; }
// TIMING CURVE: each hero's pro record in games under 14 minutes vs 18+ minutes (pulled toward 50%); the gap is its
// tempo (positive = early hero). Best lane for heroes played in more than one lane. Heroes changed in the newest
// patch with no pro games on it yet are flagged, since their old record may not hold.
const TC = new Map(); for (const m of done) { if (Date.parse(m.date) <= now - 365 * DAY) continue; for (const g of m.games) { const L = secs(g.len); if (!L) continue; const k = L < 13 * 60 ? "s" : L >= 18 * 60 ? "l" : null; if (!k) continue;
  for (const [hs, w] of [[g.h1, g.w === 1], [g.h2, g.w === 2]]) for (const x of hs) { const v = TC.get(x) || { s: [0, 0], l: [0, 0] }; v[k][1]++; if (w) v[k][0]++; TC.set(x, v); } } }
for (const h of HERO) {
  const tc = TC.get(h.id); if (tc && tc.s[1] >= 10 && tc.l[1] >= 10) { const s = shr(tc.s[0], tc.s[1], 10), l = shr(tc.l[0], tc.l[1], 10); h.timing = { short: r3(s), long: r3(l), ns: tc.s[1], nl: tc.l[1], tempo: r3(s - l), label: s - l >= 0.08 ? "Early-game hero" : l - s >= 0.08 ? "Late-game hero" : "Even across game length" }; }
  const lanes = h.roles.filter((r) => r.n >= 15).map((r) => ({ r: r.r, n: r.n, w: r.w, wr: r3((r.w + 5) / (r.n + 10)) }));
  h.bestLane = lanes.length > 1 ? lanes.sort((a, b) => b.wr - a.wr) : null;
  h.untested = !!(lastPatch && h.patches?.some((p) => p.patch === lastPatch.patch) && !(h.thisPatch?.picks));
}
const TR = Object.fromEntries(HERO.map((h) => [h.id, h.traits]));
// flex picks: share of pro games in each lane; ratings 0-10 (rank among heroes) from our traits (Teamfight, Pick-off, Objectives, Early-mid,
// Late, Damage, Survival, Push, Crowd control); ranked trend from MLBBHub's week-on-week win-rate change.
for (const h of HERO) { const tot = h.roles.reduce((a, r) => a + r.n, 0) || 1; h.laneSplit = h.roles.map((r) => ({ r: r.r, share: r3(r.n / tot) })); h.flex = h.laneSplit.length > 1 && h.laneSplit[1].share >= 0.25;
  const t = h.traits, sc = (x) => x;
  h.ratings = { Teamfight: sc((t.cc + t.tank * 0.6 + t.dmg * 0.4) / 1.4), "Pick-off": sc((t.burst + t.engage) / 1.3), Objectives: sc((t.push + t.dmg * 0.5 + t.tank * 0.3) / 1.0), "Early-mid": sc(0.5 + t.early - t.late * 0.5), Late: sc(0.4 + t.late - t.early * 0.4 + (h.lp?.role === "Marksman" ? 0.2 : 0)), Damage: sc(t.dmg / 1.1), Survival: sc((t.tank + t.sustain * 0.6) / 1.1), Push: sc(t.push / 0.8), "Crowd control": sc(t.cc / 1.1) };
  if (h.ranked) h.rankedTrend = ranked[h.id]?.winRateDelta ?? null; }
// ratings as a rank among all heroes (0 = lowest, 10 = highest), so each scale spreads out
for (const k of Object.keys(HERO[0]?.ratings || {})) { const xs = HERO.map((h) => h.ratings[k]).sort((x, y) => x - y), n = xs.length - 1 || 1; for (const h of HERO) { const lo = xs.indexOf(h.ratings[k]), hi = xs.lastIndexOf(h.ratings[k]); h.ratings[k] = Math.round(((lo + hi) / 2 / n) * 100) / 10; } }
// a lineup's profile: sum of its heroes' traits (5 heroes); the pro average lineup is the reference
const profileOf = (hs) => { const p = Object.fromEntries(TRAITS.map((k) => [k, 0])); for (const h of hs) for (const k of TRAITS) p[k] += TR[h]?.[k] || 0; return p; };
const avgLineup = (() => { const acc = Object.fromEntries(TRAITS.map((k) => [k, 0])); let n = 0; for (const m of done.slice(-600)) for (const g of m.games) for (const hs of [g.h1, g.h2]) { const p = profileOf(hs); for (const k of TRAITS) acc[k] += p[k]; n++; } for (const k of TRAITS) acc[k] = Math.round((acc[k] / Math.max(1, n)) * 100) / 100; return acc; })();
HERO.sort((a, b) => b.recent.presence - a.recent.presence);
const tier = (h) => (h.recent.presence >= 0.4 ? "S" : h.recent.presence >= 0.2 ? "A" : h.recent.presence >= 0.08 ? "B" : "C");
HERO.forEach((h) => (h.tier = tier(h)));

// players: hero by role from each game's pick order and that season's roster
const PL = new Map();
for (const m of done) for (const g of m.games) for (const [team, hs, won] of [[m.a, g.h1, g.w === 1], [m.b, g.h2, g.w === 2]]) {
  const ro = rosterFor(team, m.page); if (!ro.length) continue;
  hs.forEach((hero, i) => { const pl = ro.find((x) => x.role === ROLES[i]); if (!pl) return; const k = pl.page || pl.player; let s = PL.get(k);
    if (!s) PL.set(k, (s = { id: safe(k), page: pl.page && !/does not exist/.test(pl.page) ? pl.page : null, name: pl.player, role: pl.role, teams: {}, heroes: {}, games: 0, wins: 0, mvp: 0, last: null }));
    s.games++; if (won) s.wins++; s.teams[team] = (s.teams[team] || 0) + 1; s.team = team; s.role = pl.role; s.last = m.date;
    const hh = (s.heroes[hero] ||= { n: 0, w: 0 }); hh.n++; if (won) hh.w++; });
}
for (const m of done) if (m.mvp) { const s = [...PL.values()].find((x) => x.name.toLowerCase() === m.mvp.toLowerCase() && x.teams[m.a] + x.teams[m.b] > 0) || [...PL.values()].find((x) => x.name.toLowerCase() === m.mvp.toLowerCase()); if (s) s.mvp++; }
// official league stats (MPL PH Data tab, MPL ID Statistics tab): matched by name, letters and digits only
const nk = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const OFF = fs.readdirSync(MD).filter((f) => f.startsWith("official-")).map((f) => readJSON(path.join(MD, f)));
const offPlayer = new Map(), abbr = {};
for (const o of OFF) for (const p of o.players) offPlayer.set(nk(p.player), { ...p, league: o.league, season: o.season });
// player archetype: his role plus what his heroes bring, his pool depth and (where published) his KDA profile
function playerArch(s) {
  const tot = Object.values(s.heroes).reduce((a, v) => a + v.n, 0) || 1, p = Object.fromEntries(TRAITS.map((k) => [k, 0]));
  for (const [h, v] of Object.entries(s.heroes)) for (const k of TRAITS) p[k] += (TR[h]?.[k] || 0) * v.n / tot;
  const A = { EXP: p.tank > 0.75 ? "Tank EXP laner" : p.push > 0.35 ? "Split-push EXP laner" : "Fighter EXP laner", Jungle: p.burst > 0.7 ? "Assassin jungler" : p.tank > 0.55 ? "Tank / fighter jungler" : "Carry jungler", Mid: p.cc > 0.55 ? "Control mage" : p.burst > 0.6 ? "Burst mage" : "Utility mid", Gold: p.late > 0.15 ? "Hypercarry marksman" : p.burst > 0.45 ? "Burst gold laner" : p.tank > 0.4 ? "Fighter gold laner" : "Damage marksman", Roam: p.tank > 0.8 && p.cc > 0.6 ? "Engage roamer" : p.sustain > 0.55 ? "Support roamer" : p.burst > 0.5 ? "Assassin roamer" : "Flex roamer" };
  const out = [A[s.role] || "Flex"]; const pool = Object.values(s.heroes).filter((v) => v.n >= 2).length, top = Math.max(...Object.values(s.heroes).map((v) => v.n)) / tot;
  if (pool >= 10) out.push("Deep hero pool"); else if (top >= 0.3 && tot >= 10) out.push("Specialist");
  return { labels: out, profile: Object.fromEntries(TRAITS.map((k) => [k, Math.round(p[k] * 100) / 100])) };
}
const playersOut = [...PL.values()].map((s) => ({ page: s.page, arch: playerArch(s), official: offPlayer.get(nk(s.name)) || null, id: s.id, name: s.name, role: s.role, team: s.team, games: s.games, wr: r3(s.wins / s.games), mvp: s.mvp, last: s.last,
  pool: Object.entries(s.heroes).map(([h, v]) => ({ h, n: v.n, wr: r3(v.w / v.n) })).sort((a, b) => b.n - a.n).slice(0, 12),
  signature: Object.entries(s.heroes).filter(([, v]) => v.n >= 4).map(([h, v]) => ({ h, n: v.n, wr: r3(v.w / v.n), score: (v.w + 2) / (v.n + 4) * Math.log(1 + v.n) })).sort((a, b) => b.score - a.score).slice(0, 3).map(({ score, ...x }) => x),
  teams: Object.entries(s.teams).map(([t, n]) => ({ t, n })) })).sort((a, b) => b.games - a.games);

// teams: profile from recent games (last 150 days, else all)
const teamGames = (name) => { const ms = done.filter((m) => m.a === name || m.b === name); const rec = ms.filter((m) => Date.parse(m.date) > now - 150 * DAY); return rec.length >= 3 ? rec : ms.slice(-12); };
const ARCH_T = (p, tempo) => { const r = (k) => p[k] / (avgLineup[k] || 1), out = [];
  if (r("early") > 1.25 || (tempo.short > 0.4)) out.push("Early aggression"); if (r("late") > 1.25 || tempo.long > 0.45) out.push("Late-game scaling");
  if (r("cc") > 1.12) out.push("Teamfight CC"); if (r("burst") > 1.12 && r("engage") > 1.05) out.push("Pick-off / burst"); if (r("push") > 1.2) out.push("Split push / objectives");
  if (r("tank") > 1.12) out.push("Frontline heavy"); if (r("sustain") > 1.2) out.push("Sustain"); return out.length ? out.slice(0, 3) : ["Balanced"]; };
function profile(name) {
  const ms = teamGames(name), picks = {}, bansFor = {}, bansVs = {}; let blue = [0, 0], red = [0, 0], early = [0, 0], late = [0, 0], g = 0;
  const secs = (s) => { const [a, b] = String(s || "").split(":").map(Number); return a * 60 + (b || 0); };
  for (const m of ms) for (const x of m.games) { const one = m.a === name, mine = one ? x.h1 : x.h2, myB = one ? x.b1 : x.b2, opB = one ? x.b2 : x.b1, won = (x.w === 1) === one, side = one ? x.side1 : x.side1 === "blue" ? "red" : x.side1 === "red" ? "blue" : null; g++;
    mine.forEach((h, i) => { const k = `${ROLES[i]}:${h}`; const v = (picks[k] ||= { role: ROLES[i], h, n: 0, w: 0 }); v.n++; if (won) v.w++; });
    myB.forEach((h) => (bansFor[h] = (bansFor[h] || 0) + 1)); opB.forEach((h) => (bansVs[h] = (bansVs[h] || 0) + 1));
    if (side === "blue") { blue[0] += won; blue[1]++; } else if (side === "red") { red[0] += won; red[1]++; }
    const L = secs(x.len); if (L) { if (L < 14 * 60) { early[0] += won; early[1]++; } else if (L >= 18 * 60) { late[0] += won; late[1]++; } } }
  const comfort = Object.values(picks).filter((v) => v.n >= 2).map((v) => ({ ...v, wr: r3(v.w / v.n), share: r3(v.n / g) })).sort((a, b) => b.n - a.n);
  const top = (o, k = 6) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([h, n]) => ({ h, n, share: r3(n / g) }));
  // their average draft profile and tempo (share of short and long games) -> team archetype
  const dp = Object.fromEntries(TRAITS.map((k) => [k, 0])); let dn = 0, sh = 0, lo = 0, lenSum = 0, lenN = 0;
  for (const m of ms) for (const x of m.games) { const mine = m.a === name ? x.h1 : x.h2, p = profileOf(mine); for (const k of TRAITS) dp[k] += p[k]; dn++; const L = secs(x.len); if (L) { lenSum += L; lenN++; if (L < 14 * 60) sh++; else if (L >= 18 * 60) lo++; } }
  for (const k of TRAITS) dp[k] = Math.round((dp[k] / Math.max(1, dn)) * 100) / 100;
  const tempo = { short: lenN ? sh / lenN : 0, long: lenN ? lo / lenN : 0, avgMin: lenN ? Math.round((lenSum / lenN / 60) * 10) / 10 : null };
  // SCOUTING EXTRAS
  const maps = {}, stage = {}, firstBans = {}, phase1 = {};
  for (const m of ms) { const sk = /Playoff|Knockout|Final/i.test(m.stage) ? "Playoffs" : m.kind === "intl" ? "International" : "Regular season"; const one = m.a === name;
    for (const x of m.games) { const won = (x.w === 1) === one; if (x.map) { const v = (maps[x.map.trim()] ||= [0, 0]); v[1]++; if (won) v[0]++; } const st2 = (stage[sk] ||= [0, 0]); st2[1]++; if (won) st2[0]++;
      const myB = one ? x.b1 : x.b2; if (myB[0]) firstBans[myB[0]] = (firstBans[myB[0]] || 0) + 1; myB.slice(0, 3).forEach((h) => (phase1[h] = (phase1[h] || 0) + 1)); } }
  const topN = (o, k = 5) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([h, n]) => ({ h, n }));
  const reg = ms.filter((m) => !/Playoff|Knockout|Final/i.test(m.stage) && m.kind !== "intl").sort((a, b) => (a.date || "").localeCompare(b.date || "")), lastPage = reg.at(-1)?.page;
  const season = reg.filter((m) => m.page === lastPage), half = Math.ceil(season.length / 2), halves = { first: [0, 0], second: [0, 0] };
  season.forEach((m, i) => { const one = m.a === name, v = i < half ? halves.first : halves.second; for (const x of m.games) { v[1]++; if ((x.w === 1) === one) v[0]++; } });
  return { halves: season.length >= 4 ? halves : null, maps, stages: stage, firstBan: topN(firstBans), phase1Bans: topN(phase1), games: g, draft: dp, tempo, archetype: ARCH_T(dp, tempo), comfort: comfort.slice(0, 15), bansTheyMake: top(bansFor), bansAgainstThem: top(bansVs), side: { blue: blue[1] ? { w: blue[0], n: blue[1] } : null, red: red[1] ? { w: red[0], n: red[1] } : null }, early: { w: early[0], n: early[1] }, late: { w: late[0], n: late[1] } };
}
// coaching staff (head coach, coaches, analysts) from the Staff tab of the newest season page that lists the team
const STAFF = {}; // page -> team (lower case) -> list
for (const f of fs.readdirSync(path.join(MD, "rosters"))) { const r = readJSON(path.join(MD, "rosters", f)); if (!r?.staff) continue; const by = (STAFF[r.page] ||= {}); for (const [t, list] of Object.entries(r.staff)) if (list.length) by[canon(t).toLowerCase()] = list; }
const staffFor = (name) => { const k = name.toLowerCase(), ms = [...done].reverse().filter((m) => m.a === name || m.b === name);
  for (const m of ms) for (const [pg, by] of Object.entries(STAFF)) if (by[k] && String(m.page || "").replace(/_/g, " ").startsWith(pg)) return { page: pg, list: by[k].map((x) => ({ name: x.name, role: x.role })) };
  return null; };
// signature hero effect: team record with vs without its most-played hero (shrunk), for "if it is banned"
function sigEffect(name, prof) {
  const top = prof.comfort[0]; if (!top) return null; const ms = teamGames(name); let wi = [0, 0], wo = [0, 0];
  for (const m of ms) for (const x of m.games) { const one = m.a === name, mine = one ? x.h1 : x.h2, won = (x.w === 1) === one; if (mine[ROLES.indexOf(top.role)] === top.h) { wi[0] += won; wi[1]++; } else { wo[0] += won; wo[1]++; } }
  return { hero: top.h, role: top.role, with: wi, without: wo, delta: r3((wi[0] + 2) / (wi[1] + 4) - (wo[0] + 2) / (wo[1] + 4)) };
}

// official team totals, matched through the players' teams (the sites use abbreviations like TLPH)
for (const p of playersOut) if (p.official) { const k = `${p.official.league}|${p.official.team}`; (abbr[k] ||= {})[p.team] = (abbr[k][p.team] || 0) + 1; }
const offTeam = new Map(); for (const o of OFF) for (const t of o.teams) { const cands = abbr[`${o.league}|${t.team}`]; const name = cands ? Object.entries(cands).sort((a, b) => b[1] - a[1])[0][0] : [...new Set(done.map((m) => m.a))].find((n) => nk(n) === nk(t.team)); if (name) offTeam.set(name, { ...t, league: o.league, season: o.season }); }
const crossOf = (a, b) => { const ra = R.T.get(a)?.region, rb = R.T.get(b)?.region; return ra && rb && ra !== rb ? P.cx : 1; };
const ratingOf = (name) => { const t = R.T.get(name); return t ? t.r + (R.REG[t.region] || 0) * P.regW : 0; };
const teamsOut = [...R.T.values()].filter((t) => t.n >= 3).map((t) => { const prof = profile(t.name); const lastM = [...done].reverse().find((m) => m.a === t.name || m.b === t.name);
  return { id: safe(t.name), name: t.name, region: t.region, rating: r3(ratingOf(t.name)), elo: Math.round(1500 + ratingOf(t.name) * 173.7), series: [t.w, t.l], games: [t.gw, t.gl], last: lastM?.date || null, league: lastM?.league || null, staff: staffFor(t.name), official: offTeam.get(t.name) || null, roster: rosterFor(t.name, lastM?.page || "").map((x) => { const pl = PL.get(x.page || x.player); return { player: x.player, role: x.role, id: safe(x.page || x.player), pool: pl ? Object.entries(pl.heroes).map(([h, v]) => ({ h, n: v.n, wr: r3(v.w / v.n) })).sort((a, b) => b.n - a.n).slice(0, 6) : [] }; }), profile: prof, signature: sigEffect(t.name, prof) }; })
  .sort((a, b) => b.rating - a.rating);
// RELATIVE ARCHETYPES: a team's labels are the traits where it stands out from other teams (z-score 0.75+ among teams
// with 10+ recent games); tempo uses its share of short and long games.
{
  const pool = teamsOut.filter((t) => t.profile.games >= 10), feats = { early: (t) => t.profile.draft.early + t.profile.tempo.short, late: (t) => t.profile.draft.late + t.profile.tempo.long, cc: (t) => t.profile.draft.cc, burst: (t) => t.profile.draft.burst + t.profile.draft.engage * 0.5, push: (t) => t.profile.draft.push, tank: (t) => t.profile.draft.tank, sustain: (t) => t.profile.draft.sustain };
  const LBL = { early: "Early aggression", late: "Late-game scaling", cc: "Teamfight CC", burst: "Pick-off / burst", push: "Split push / objectives", tank: "Frontline heavy", sustain: "Sustain" };
  const stat = Object.fromEntries(Object.entries(feats).map(([k, fn]) => { const v = pool.map(fn), m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) || 1; return [k, { m, sd }]; }));
  for (const t of teamsOut) { const z = Object.entries(feats).map(([k, fn]) => [k, (fn(t) - stat[k].m) / stat[k].sd]).sort((a, b) => b[1] - a[1]);
    t.profile.archetype = t.profile.games < 10 ? ["Not enough games yet"] : z.filter(([, v]) => v >= 0.75).slice(0, 3).map(([k]) => LBL[k]); if (!t.profile.archetype.length) t.profile.archetype = ["Balanced"];
    t.profile.traitZ = Object.fromEntries(z.map(([k, v]) => [k, Math.round(v * 100) / 100])); }
}
for (const t of teamsOut) writeJSON(path.join(OUT, "teams", `${t.id}.json`), { ...t, matches: done.filter((m) => m.a === t.name || m.b === t.name).slice(-30).reverse().map((m) => ({ date: m.date, league: m.league, stage: m.stage, opp: m.a === t.name ? m.b : m.a, score: m.a === t.name ? m.score : [m.score[1], m.score[0]] })) });
writeJSON(path.join(OUT, "teams.json"), teamsOut.map(({ profile, matches, ...t }) => ({ ...t, comfort: profile.comfort.slice(0, 3) })));
{
  const byRole = {}; for (const p of playersOut.filter((x) => x.games >= 15)) (byRole[p.role] ||= []).push(p.pool.filter((h) => h.n >= 2).length / Math.sqrt(p.games)); /* pool size for the games played, so long careers do not win by default */
  const below = (arr, x) => arr.filter((v) => v < x).length / arr.length, atMost = (arr, x) => arr.filter((v) => v <= x).length / arr.length;
  for (const p of playersOut) { p.arch.labels = p.arch.labels.filter((l) => l !== "Deep hero pool" && l !== "Specialist"); const arr = byRole[p.role] || [], n = p.pool.filter((h) => h.n >= 2).length / Math.sqrt(Math.max(1, p.games));
    if (p.games >= 15 && arr.length >= 8) { const srt = [...arr].sort((a, b) => a - b), pc = (x) => srt[Math.floor(x * (srt.length - 1))], med = pc(0.5); if (n >= pc(0.85) && n > med) p.arch.labels.push("Deep hero pool"); else if (n <= pc(0.15) && n < med) p.arch.labels.push("Narrow pool / specialist"); }
    if (p.official) { if (p.official.kda >= 5) p.arch.labels.push("Safe, high-KDA"); else if (p.official.kills >= 3 && p.official.deaths >= 2.5) p.arch.labels.push("High-risk playmaker"); } }
}
for (const p of playersOut) writeJSON(path.join(OUT, "players", `${p.id}.json`), p);
writeJSON(path.join(OUT, "players.json"), playersOut.map(({ pool, ...p }) => ({ ...p, top: pool.slice(0, 3) })));
// draft tables for the Draft lab (client-side): hero strength, combos and counters with 3+ games
writeJSON(path.join(OUT, "draft.json"), { traits: TR, avgLineup, shortLong: Object.fromEntries(HERO.filter((h) => h.shortLong).map((h) => [h.id, h.shortLong])), patch: lastPatch ? { patch: lastPatch.patch, release: lastPatch.release } : null, wd: P.wd, scale: { hero: 0.2, syn: 0.1, cnt: 0.04 }, heroes: Object.fromEntries([...D.H].map(([k, v]) => [k, [r1(v.n), r1(v.w)]])), pairs: Object.fromEntries([...D.PAIR].filter(([, v]) => v.n >= 3).map(([k, v]) => [k, [r1(v.n), r1(v.w)]])), vs: Object.fromEntries([...D.VS].filter(([, v]) => v.n >= 3).map(([k, v]) => [k, [r1(v.n), r1(v.w)]])) });
writeJSON(path.join(OUT, "heroes.json"), HERO);

// ---------------------------------------------------------------- projections: upcoming matches and any pairing
function project(a, b, bo, page) {
  const pg = lg((ratingOf(a) - ratingOf(b)) * crossOf(a, b)), s = series(pg, bo), pa = profile(a), pb = profile(b), sa = sigEffect(a, pa), sb2 = sigEffect(b, pb), scen = [];
  // scenarios: signature hero banned, likely ban targets, side, early vs late games
  for (const [t, sig, other] of [[a, sa, b], [b, sb2, a]]) if (sig && sig.with[1] >= 3) { const pBan = (t === a ? pb : pa).bansTheyMake.find((x) => x.h === sig.hero); const adj = Math.max(-0.15, Math.min(0.15, -sig.delta * 0.5)); const p2 = Math.min(0.97, Math.max(0.03, pg + (t === a ? adj : -adj))); scen.push({ k: "sigban", team: t, hero: sig.hero, role: sig.role, text: `If ${other} bans ${t}'s ${sig.role} ${sig.hero} (${sig.with[0]}-${sig.with[1] - sig.with[0]} with it, ${sig.without[0]}-${sig.without[1] - sig.without[0]} without): ${a} wins a game ${Math.round(p2 * 100)}% (from ${Math.round(pg * 100)}%)`, pGame: r3(p2), pSeries: r3(series(p2, bo).win), banRate: pBan ? pBan.share : 0 }); }
  const sideTxt = (t, p) => p.side.blue && p.side.red ? `${t}: ${p.side.blue.w}-${p.side.blue.n - p.side.blue.w} on blue, ${p.side.red.w}-${p.side.red.n - p.side.red.w} on red` : null;
  const tempo = (t, p) => p.early.n + p.late.n >= 4 ? `${t}: ${p.early.w}-${p.early.n - p.early.w} in games under 14 min, ${p.late.w}-${p.late.n - p.late.w} in games of 18+ min` : null;
  const banTargets = (t, p) => p.comfort.slice(0, 3).map((c) => `${c.h} (${c.role}, ${c.n} games)`).join(", ");
  const exp = Object.entries(s.scores).reduce((acc, [k, v]) => acc + v * k.split("-").reduce((x, y) => +x + +y, 0), 0);
  return { pGame: r3(pg), pSeries: r3(s.win), scores: Object.fromEntries(Object.entries(s.scores).map(([k, v]) => [k, r3(v)])), expMaps: r1(exp), mapsLine: bo === 3 ? 2.5 : bo === 5 ? 4.5 : bo === 7 ? 5.5 : null,
    over: bo >= 3 ? r3(Object.entries(s.scores).filter(([k]) => k.split("-").reduce((x, y) => +x + +y, 0) > (bo === 3 ? 2.5 : bo === 5 ? 4.5 : 5.5)).reduce((x, [, v]) => x + v, 0)) : null,
    scenarios: scen, sides: [sideTxt(a, pa), sideTxt(b, pb)].filter(Boolean), tempo: [tempo(a, pa), tempo(b, pb)].filter(Boolean), comfort: [banTargets(a, pa), banTargets(b, pb)], profiles: [pa, pb] };
}
const nA = (name) => R.T.get(name)?.n || 0;
const confOf = (p, n) => (n < 4 ? "low (thin record)" : Math.abs(p - 0.5) < 0.12 ? "low (near coin-flip)" : n < 10 ? "medium (fewer than 10 series for one side)" : Math.abs(p - 0.5) >= 0.25 ? "high" : "medium");
const upOut = [], picks = [];
for (const m of upcoming) {
  const pr = project(m.a, m.b, m.bo, m.page), n = Math.min(nA(m.a), nA(m.b));
  const rec = { id: m.id, date: m.date, timed: m.timed, league: m.league, stage: m.stage, bo: m.bo, a: m.a, b: m.b, ...pr, confidence: confOf(pr.pSeries, n), records: [R.T.get(m.a)?.w + "-" + R.T.get(m.a)?.l, R.T.get(m.b)?.w + "-" + R.T.get(m.b)?.l] };
  writeJSON(path.join(OUT, "matches", `${m.id}.json`), rec);
  upOut.push({ id: m.id, date: m.date, timed: m.timed, league: m.league, stage: m.stage, bo: m.bo, a: m.a, b: m.b, pSeries: pr.pSeries, pGame: pr.pGame, expMaps: pr.expMaps, confidence: rec.confidence });
  if (n >= 6) { const fav = pr.pSeries >= 0.5 ? m.a : m.b, pf = Math.min(0.9, Math.max(pr.pSeries, 1 - pr.pSeries)); picks.push({ id: m.id, date: m.date, league: m.league, kind: "series", pick: `${fav} to win the series`, p: r3(pf), game: `${m.a} vs ${m.b}` });
    if (pr.over != null) picks.push({ id: m.id, date: m.date, league: m.league, kind: "maps", pick: `${pr.over >= 0.5 ? "Over" : "Under"} ${pr.mapsLine} maps`, p: r3(Math.min(0.85, Math.max(pr.over, 1 - pr.over))), game: `${m.a} vs ${m.b}` }); }
}
picks.sort((a, b) => b.p - a.p);
writeJSON(path.join(OUT, "upcoming.json"), upOut);
writeJSON(path.join(OUT, "picks.json"), { note: "Our own lines from the series math (game chance from team ratings). Capped at 90% (maps 85%) and only for teams with 6+ series in our data. No sportsbook data.", picks });

// ---------------------------------------------------------------- DRAFT LIBRARY, counter matrix, maps, ban priority
// Every pro game with its draft, side, battlefield map, length and result, one file per league for the Library page.
{
  fs.mkdirSync(path.join(OUT, "library"), { recursive: true });
  const byL = {};
  for (const m of done) for (const g of m.games) (byL[m.league] ||= []).push([m.date?.slice(0, 10), m.stage, m.a, m.b, m.bo, g.n, g.w, g.side1, g.map, g.len, g.h1, g.h2, g.b1, g.b2, m.score]);
  const index = [];
  for (const [lgName, rows] of Object.entries(byL)) { const id = safe(lgName); writeJSON(path.join(OUT, "library", `${id}.json`), rows.reverse()); index.push({ id, league: lgName, games: rows.length, last: rows[0]?.[0] }); }
  writeJSON(path.join(OUT, "library.json"), index.sort((a, b) => (b.last || "").localeCompare(a.last || "")));
  // counter matrix: every hero pair with 4+ games against each other, graded like a coaching board
  const grade = (wr, n) => (n < 4 ? 0 : wr >= 0.65 ? 2 : wr >= 0.56 ? 1 : wr <= 0.35 ? -2 : wr <= 0.44 ? -1 : 0);
  const mx = {}; for (const [k, v] of D.VS) { if (v.n < 4) continue; const [a, b] = k.split(">"); const wr = (v.w + 3) / (v.n + 6), gr = grade(wr, v.n); if (gr) (mx[a] ||= {})[b] = [gr, Math.round(v.n), Math.round(wr * 100)]; }
  writeJSON(path.join(OUT, "matrix.json"), { note: "Hero vs hero in pro games, fading by half every 120 days, pulled toward 50%: hard counter 65%+, favoured 56%+, losing 44% or less, hard loss 35% or less; 4+ games needed.", lanes: Object.fromEntries(HERO.map((h) => [h.id, h.roles[0]?.r || null])), m: mx });
  // maps (annual map events): team and hero records per battlefield, and how often blue side wins there
  const MAPS = {}; for (const m of done) for (const g of m.games) if (g.map) { const M = (MAPS[g.map] ||= { games: 0, blue: 0, teams: {}, heroes: {} }); M.games++; if ((g.side1 === "blue" && g.w === 1) || (g.side1 === "red" && g.w === 2)) M.blue++;
    for (const [t, hs, won] of [[m.a, g.h1, g.w === 1], [m.b, g.h2, g.w === 2]]) { const T = (M.teams[t] ||= [0, 0]); T[1]++; if (won) T[0]++; for (const h of hs) { const H = (M.heroes[h] ||= [0, 0]); H[1]++; if (won) H[0]++; } } }
  writeJSON(path.join(OUT, "maps.json"), Object.fromEntries(Object.entries(MAPS).map(([k, v]) => [k, { games: v.games, blueWin: r3(v.blue / v.games), teams: v.teams, heroes: Object.fromEntries(Object.entries(v.heroes).filter(([, x]) => x[1] >= 5)) }])));
  // ban priority: share of each hero's bans that come in the first ban phase (bans 1-3) over the last 150 days
  const BP = {}; for (const m of done.filter((x) => Date.parse(x.date) > now - 150 * DAY)) for (const g of m.games) for (const bs of [g.b1, g.b2]) bs.forEach((h, i) => { const v = (BP[h] ||= [0, 0]); v[1]++; if (i < 3) v[0]++; });
  for (const h of HERO) { const v = BP[h.id]; h.firstPhaseBan = v && v[1] >= 5 ? r3(v[0] / v[1]) : null; }
  // LEAGUE META: each league has its own meta, so hero presence and win rate per league (last 150 days), how often
  // the first-pick (blue) side wins, and the opening bans: blue bans first, so blue's first ban is B1 and red's is B2.
  const LG = {}, cut = now - 150 * DAY;
  for (const m of done) { if (Date.parse(m.date) <= cut || m.kind === "intl") continue; const L = (LG[m.league] ||= { games: 0, blue: [0, 0], b1: {}, b2: {}, h: {} });
    for (const g of m.games) { L.games++; if (g.side1 === "blue" || g.side1 === "red") { L.blue[1]++; if ((g.side1 === "blue") === (g.w === 1)) L.blue[0]++;
        const [bb, rb] = g.side1 === "blue" ? [g.b1, g.b2] : [g.b2, g.b1]; if (bb[0]) L.b1[bb[0]] = (L.b1[bb[0]] || 0) + 1; if (rb[0]) L.b2[rb[0]] = (L.b2[rb[0]] || 0) + 1; }
      for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { for (const h of hs) { const v = (L.h[h] ||= { p: 0, w: 0, b: 0 }); v.p++; if (w) v.w++; } for (const h of bs) { const v = (L.h[h] ||= { p: 0, w: 0, b: 0 }); v.b++; } } } }
  const top5 = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, n]) => ({ h, n }));
  const leagues = Object.entries(LG).filter(([, L]) => L.games >= 20).map(([lg2, L]) => ({ league: lg2, games: L.games, blue: L.blue, b1: top5(L.b1), b2: top5(L.b2),
    top: Object.entries(L.h).map(([h, v]) => ({ h, pres: r3((v.p + v.b) / L.games), p: v.p, b: v.b, wr: v.p ? r3(v.w / v.p) : null })).sort((a, b) => b.pres - a.pres).slice(0, 12) })).sort((a, b) => b.games - a.games);
  const allBlue = Object.values(LG).reduce((a, L) => [a[0] + L.blue[0], a[1] + L.blue[1]], [0, 0]);
  writeJSON(path.join(OUT, "leagues.json"), { note: "Last 150 days of league games (international events left out). Blue side picks first.", blueAll: allBlue, leagues });
  for (const h of HERO) h.byLeague = leagues.map((L) => { const v = LG[L.league].h[h.id]; return v ? { league: L.league, pres: r3((v.p + v.b) / L.games), p: v.p, b: v.b, wr: v.p ? r3(v.w / v.p) : null } : null; }).filter((x) => x && x.pres >= 0.05).sort((a, b) => b.pres - a.pres);
  // lane matchups: the heroes in the same role on the two sides, last 365 days
  const LM = {}; for (const m of done) { if (Date.parse(m.date) <= now - 365 * DAY) continue; for (const g of m.games) for (let i = 0; i < 5; i++) { const a = g.h1[i], b = g.h2[i]; if (!a || !b) continue;
    for (const [x, y, w] of [[a, b, g.w === 1], [b, a, g.w === 2]]) { const v = ((LM[x] ||= {})[y] ||= [0, 0, ROLES[i]]); v[1]++; if (w) v[0]++; } } }
  for (const h of HERO) h.laneVs = Object.entries(LM[h.id] || {}).filter(([, v]) => v[1] >= 4).map(([o, v]) => ({ vs: o, role: v[2], w: v[0], n: v[1], wr: r3((v[0] + 2) / (v[1] + 4)) })).sort((a, b) => b.n - a.n).slice(0, 10);
  writeJSON(path.join(OUT, "heroes.json"), HERO);
  console.log(`leagues: ${leagues.length}, blue side ${allBlue[0]}-${allBlue[1] - allBlue[0]}`);
  console.log(`library: ${index.length} leagues · matrix: ${Object.values(mx).reduce((a, x) => a + Object.keys(x).length, 0)} graded pairs · maps: ${Object.keys(MAPS).length}`);
}
// ---------------------------------------------------------------- M8 field and Wildcard simulation
// Teams from Liquipedia's M8 qualification table. The Wildcard is two groups of five, best-of-one round robin, top
// team of each group advances. Groups are not drawn yet, so each run draws them at random; teams with no games in
// our data (and slots still to be decided) start at an average rating, which the page says.
{
  const M8 = readJSON(path.join(MD, "m8.json"));
  if (M8) {
    const known = (n) => (n ? [...R.T.keys()].find((k) => k.toLowerCase() === canon(n).toLowerCase()) : null);
    const row = (x) => { const k = known(x.team), t = k ? R.T.get(k) : null, ro = x.team ? rosterFor(canon(x.team), "M8 World Championship/Wildcard") : [];
      return { team: x.team ? canon(x.team) : null, via: x.via, inData: !!t, id: t ? safe(k) : null, rating: t ? r3(ratingOf(k)) : null, elo: t ? Math.round(1500 + ratingOf(k) * 173.7) : null, series: t ? [t.w, t.l] : null, region: t?.region || null, roster: ro.map((p) => ({ player: p.player, role: p.role })) }; };
    // teams Liquipedia already lists on the M8 page but not yet in the qualification table fill the empty main-stage slots
    const listed = new Set([...M8.main, ...M8.wildcard].filter((x) => x.team).map((x) => canon(x.team).toLowerCase()));
    const extra = Object.keys(ROST["M8 World Championship"] || {}).map(canon).filter((t) => !listed.has(t.toLowerCase()));
    const routeRegions = (via) => (/Indonesia/.test(via) ? ["ID"] : /Philippines/.test(via) ? ["PH"] : /Malaysia/.test(via) ? ["MY"] : /MTC|Turkiye/.test(via) ? ["TR"] : /MENA/.test(via) ? ["MENA"] : /MCC/.test(via) ? ["CIS"] : /AMER/.test(via) ? ["BR", "LATAM", "AMER"] : /\bEA\b|East Asia/.test(via) ? ["EA", "CN", "JP"] : /SEA/.test(via) ? ["PH", "ID", "MY", "SG", "KH", "MM", "TH"] : []);
    const unplaced = [];
    for (const t of extra) { const reg = R.T.get([...R.T.keys()].find((k) => k.toLowerCase() === t.toLowerCase()) || "")?.region; const slot = M8.main.find((x) => !x.team && routeRegions(x.via).includes(reg)) || M8.wildcard.find((x) => !x.team && routeRegions(x.via).includes(reg)); if (slot) slot.team = t; else unplaced.push(t); }
    const main = M8.main.map(row), wild = M8.wildcard.map(row);
    // Wildcard simulation (seeded so a refresh without new data gives the same numbers)
    let seed = 777; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const field = wild.map((w, i) => ({ key: w.team || `TBD (${w.via}) #${i + 1}`, r: w.rating ?? 0, reg: w.region || `?${i}`, adv: 0 }));
    const N = 20000;
    for (let it = 0; it < N; it++) {
      const order = field.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); let runners = null;
      for (const grp of [order.slice(0, 5), order.slice(5, 10)]) {
        const wins = new Map(grp.map((x) => [x, 0]));
        for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) { const p = lg((grp[i].r - grp[j].r) * (grp[i].reg !== grp[j].reg ? P.cx : 1)); /* same cross-region pull as every projection */ if (rnd() < p) wins.set(grp[i], wins.get(grp[i]) + 1); else wins.set(grp[j], wins.get(grp[j]) + 1); }
        const ranked = [...grp].sort((a, b) => wins.get(b) - wins.get(a) || rnd() - 0.5); ranked[0].adv++; (runners ||= []).push([ranked[1], wins.get(ranked[1])]);
      }
      // third slot (Moonton: 3 of 10 advance): the stronger runner-up, as an approximation of the decider match
      const [r1x, r2x] = runners; const pR = lg((r1x[0].r - r2x[0].r) * (r1x[0].reg !== r2x[0].reg ? P.cx : 1)); (rnd() < pR ? r1x[0] : r2x[0]).adv++;
    }
    wild.forEach((w, i) => (w.pAdvance = r3(field[i].adv / N)));
    writeJSON(path.join(OUT, "m8.json"), { fetched: M8.fetched, format: M8.wildcardFormat, main, wildcard: wild, alsoListed: unplaced.map((t) => row({ team: t, via: "listed on Liquipedia's M8 page; qualifying slot not confirmed" })),
      cx: P.cx, note: "Ratings are earned inside each team's own league, so they do not compare across regions: teams from different regions have rarely met, and in our back-test cross-region results were close to coin flips. Head-to-head chances between regions are therefore pulled most of the way to 50%. Ratings come from each team's games in our data. Slots still to be decided, and teams without games in our data, start at an average rating; Wildcard groups are drawn at random in each simulated run until the real draw is published." });
    console.log(`M8: main ${main.filter((x) => x.team).length}/${main.length}, wildcard ${wild.filter((x) => x.team).length}/${wild.length}`);
  }
}
// ---------------------------------------------------------------- results, accuracy, pre-tip ledger
const results = R.log.map((x) => ({ date: x.m.date, league: x.m.league, stage: x.m.stage, bo: x.m.bo, a: x.A, b: x.B, score: x.m.score, pSeries: r3(x.pS), graded: x.warm, right: (x.pS >= 0.5) === (x.m.score[0] > x.m.score[1]), mvp: x.m.mvp })).reverse();
writeJSON(path.join(OUT, "results.json"), results.slice(0, 400));
const cal = Array.from({ length: 5 }, (_, i) => ({ lo: 50 + i * 10, hi: 60 + i * 10, n: 0, won: 0 }));
for (const x of R.log.filter((x) => x.warm)) { const p = Math.max(x.pS, 1 - x.pS), won = (x.pS >= 0.5) === (x.m.score[0] > x.m.score[1]), b = cal[Math.min(4, Math.floor((p - 0.5) * 10))]; b.n++; if (won) b.won++; }
const byL = {}; for (const x of R.log.filter((x) => x.warm)) { const c = (byL[x.m.league] ||= { league: x.m.league, n: 0, right: 0 }); c.n++; if ((x.pS >= 0.5) === (x.m.score[0] > x.m.score[1])) c.right++; }
writeJSON(path.join(OUT, "accuracy.json"), { graded: R.n, brier: r3(R.brier), logloss: r3(R.ll), winner: r3(R.acc), games: { n: R.gn, brierTeam: r3(R.gBrier), brierDraft: r3(R.gBrierDraft) }, calibration: cal.map((b) => ({ ...b, rate: b.n ? r3(b.won / b.n) : null })),
  byLeague: Object.values(byL).map((c) => ({ ...c, winner: r3(c.right / c.n), low: c.n < 20 })), learned: { ...P, regions: Object.fromEntries(Object.entries(R.REG).map(([k, v]) => [k, r3(v)])), note: "k = how fast team ratings react to each game; carry = share of a team's rating kept into a new season; kr = how fast international results move the region offsets; wd = weight of the draft layer (hero strength, combos, counters) once drafts are known." }, grid: grid.length,
  rule: "Each series is projected only from games before it, then graded. A series counts once both teams have 4+ series in our data." });
const PT_FILE = path.join(MD, "pretip.json"), PT = readJSON(PT_FILE, { started: new Date().toISOString(), matches: {} });
for (const u of upOut) if (Date.parse(u.date) > now) PT.matches[u.id] = { ...u, saved: new Date().toISOString() };
for (const [id, x] of Object.entries(PT.matches)) if (!x.score) { const m = done.find((d) => d.id === id); if (m) { x.score = m.score; x.right = (x.pSeries >= 0.5) === (m.score[0] > m.score[1]); } }
writeJSON(PT_FILE, PT);
const ptg = Object.values(PT.matches).filter((x) => x.score);
writeJSON(path.join(OUT, "pretip.json"), { started: PT.started, graded: ptg.length, waiting: Object.values(PT.matches).filter((x) => !x.score).length, winner: ptg.length ? r3(ptg.filter((x) => x.right).length / ptg.length) : null, matches: ptg.slice(-100).reverse() });
const nextEvents = all.filter((m) => !m.done && m.date && Date.parse(m.date) > now).map((m) => m.league);
writeJSON(path.join(OUT, "meta.json"), { patch: lastPatch ? { patch: lastPatch.patch, release: lastPatch.release, changes: lastPatch.changes } : null, patches: LP.patches.slice(-8).reverse().map((p) => ({ patch: p.patch, release: p.release, changes: p.changes.length })), built: new Date().toISOString(), series: done.length, games: totalGames, teams: teamsOut.length, players: playersOut.length, heroes: HERO.length, upcoming: upOut.length, leagues: [...new Set(EVENTS.map((e) => e.league))], ratingScale: "Elo-style: 1500 average, 100 points = about 64% in a single game",
  roles: ROLES, source: "Liquipedia (CC-BY-SA) for matches, drafts and rosters; MLBBHub for ranked-game hero rates. No betting data." });
console.log(`wrote ${upOut.length} upcoming, ${teamsOut.length} teams, ${playersOut.length} players, ${HERO.length} heroes, ${picks.length} picks`);
