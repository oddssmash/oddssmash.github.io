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
const cnt = {}; for (const m of all) for (const n of [m.a, m.b]) { const k = n.toLowerCase(); (cnt[k] ||= {})[n] = (cnt[k][n] || 0) + 1; }
const disp = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, Object.entries(v).sort((a, b) => (/[A-Z]/.test(b[0]) - /[A-Z]/.test(a[0])) || b[1] - a[1])[0][0]])); // most common spelling that has capitals
const canon = (n) => { const a = ALIAS[String(n).toLowerCase()]; return a || disp[String(n).toLowerCase()] || n; };
for (const m of all) { m.a = canon(m.a); m.b = canon(m.b); }
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
for (const m of done) for (const g of m.games) { for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { hs.forEach((x, i) => { const v = raw.get(x) || { n: 0, w: 0, b: 0, roles: {} }; v.n++; if (w) v.w++; v.roles[ROLES[i]] = (v.roles[ROLES[i]] || 0) + 1; raw.set(x, v); }); bs.forEach((x) => { const v = raw.get(x) || { n: 0, w: 0, b: 0, roles: {} }; v.b++; raw.set(x, v); }); } }
const recent = new Map(); for (const m of done.filter((m) => Date.parse(m.date) > now - 150 * DAY)) for (const g of m.games) { for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { hs.forEach((x) => { const v = recent.get(x) || { n: 0, w: 0, b: 0 }; v.n++; if (w) v.w++; recent.set(x, v); }); bs.forEach((x) => { const v = recent.get(x) || { n: 0, w: 0, b: 0 }; v.b++; recent.set(x, v); }); } }
const recentGames = done.filter((m) => Date.parse(m.date) > now - 150 * DAY).reduce((a, m) => a + m.games.length, 0) || 1;
for (const [name, v] of raw) {
  const d = D.H.get(name) || { n: 0, w: 0, b: 0 }, rc = recent.get(name) || { n: 0, w: 0, b: 0 }, str = logit((d.w + 4) / (d.n + 8));
  const syn = [...D.PAIR].filter(([k, x]) => k.split("|").includes(name) && x.n >= 3).map(([k, x]) => ({ with: k.split("|").find((y) => y !== name), n: r1(x.n), wr: r3((x.w + 3) / (x.n + 6)) })).sort((a, b) => b.wr - a.wr);
  const cnt = [...D.VS].filter(([k, x]) => k.startsWith(name + ">") && x.n >= 3).map(([k, x]) => ({ vs: k.split(">")[1], n: r1(x.n), wr: r3((x.w + 3) / (x.n + 6)) })).sort((a, b) => b.wr - a.wr);
  const rk = ranked[name];
  HERO.push({ id: name, games: v.n, wins: v.w, wr: r3(v.w / Math.max(1, v.n)), bans: v.b, presence: r3((v.n + v.b) / totalGames), recent: { picks: rc.n, wr: rc.n ? r3(rc.w / rc.n) : null, bans: rc.b, presence: r3((rc.n + rc.b) / recentGames) }, strength: r3(str),
    roles: Object.entries(v.roles).sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ r, n })), combos: syn.slice(0, 6), combosBad: syn.slice(-3).reverse(), counters: cnt.slice(0, 6), counteredBy: cnt.slice(-6).reverse(), ranked: rk ? { wr: rk.winRate, pick: rk.pickRate, ban: rk.banRate, tier: rk.tier } : null });
}
HERO.sort((a, b) => b.recent.presence - a.recent.presence);
const tier = (h) => (h.recent.presence >= 0.4 ? "S" : h.recent.presence >= 0.2 ? "A" : h.recent.presence >= 0.08 ? "B" : "C");
HERO.forEach((h) => (h.tier = tier(h)));

// players: hero by role from each game's pick order and that season's roster
const PL = new Map();
for (const m of done) for (const g of m.games) for (const [team, hs, won] of [[m.a, g.h1, g.w === 1], [m.b, g.h2, g.w === 2]]) {
  const ro = rosterFor(team, m.page); if (!ro.length) continue;
  hs.forEach((hero, i) => { const pl = ro.find((x) => x.role === ROLES[i]); if (!pl) return; const k = pl.page || pl.player; let s = PL.get(k);
    if (!s) PL.set(k, (s = { id: safe(k), name: pl.player, role: pl.role, teams: {}, heroes: {}, games: 0, wins: 0, mvp: 0, last: null }));
    s.games++; if (won) s.wins++; s.teams[team] = (s.teams[team] || 0) + 1; s.team = team; s.role = pl.role; s.last = m.date;
    const hh = (s.heroes[hero] ||= { n: 0, w: 0 }); hh.n++; if (won) hh.w++; });
}
for (const m of done) if (m.mvp) { const s = [...PL.values()].find((x) => x.name.toLowerCase() === m.mvp.toLowerCase() && x.teams[m.a] + x.teams[m.b] > 0) || [...PL.values()].find((x) => x.name.toLowerCase() === m.mvp.toLowerCase()); if (s) s.mvp++; }
// official league stats (MPL PH Data tab, MPL ID Statistics tab): matched by name, letters and digits only
const nk = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const OFF = fs.readdirSync(MD).filter((f) => f.startsWith("official-")).map((f) => readJSON(path.join(MD, f)));
const offPlayer = new Map(), abbr = {};
for (const o of OFF) for (const p of o.players) offPlayer.set(nk(p.player), { ...p, league: o.league, season: o.season });
const playersOut = [...PL.values()].map((s) => ({ official: offPlayer.get(nk(s.name)) || null, id: s.id, name: s.name, role: s.role, team: s.team, games: s.games, wr: r3(s.wins / s.games), mvp: s.mvp, last: s.last,
  pool: Object.entries(s.heroes).map(([h, v]) => ({ h, n: v.n, wr: r3(v.w / v.n) })).sort((a, b) => b.n - a.n).slice(0, 12),
  signature: Object.entries(s.heroes).filter(([, v]) => v.n >= 4).map(([h, v]) => ({ h, n: v.n, wr: r3(v.w / v.n), score: (v.w + 2) / (v.n + 4) * Math.log(1 + v.n) })).sort((a, b) => b.score - a.score).slice(0, 3).map(({ score, ...x }) => x),
  teams: Object.entries(s.teams).map(([t, n]) => ({ t, n })) })).sort((a, b) => b.games - a.games);

// teams: profile from recent games (last 150 days, else all)
const teamGames = (name) => { const ms = done.filter((m) => m.a === name || m.b === name); const rec = ms.filter((m) => Date.parse(m.date) > now - 150 * DAY); return rec.length >= 3 ? rec : ms.slice(-12); };
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
  return { games: g, comfort: comfort.slice(0, 15), bansTheyMake: top(bansFor), bansAgainstThem: top(bansVs), side: { blue: blue[1] ? { w: blue[0], n: blue[1] } : null, red: red[1] ? { w: red[0], n: red[1] } : null }, early: { w: early[0], n: early[1] }, late: { w: late[0], n: late[1] } };
}
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
  return { id: safe(t.name), name: t.name, region: t.region, rating: r3(ratingOf(t.name)), elo: Math.round(1500 + ratingOf(t.name) * 173.7), series: [t.w, t.l], games: [t.gw, t.gl], last: lastM?.date || null, league: lastM?.league || null, official: offTeam.get(t.name) || null, roster: rosterFor(t.name, lastM?.page || "").map((x) => ({ player: x.player, role: x.role, id: safe(x.page || x.player) })), profile: prof, signature: sigEffect(t.name, prof) }; })
  .sort((a, b) => b.rating - a.rating);
for (const t of teamsOut) writeJSON(path.join(OUT, "teams", `${t.id}.json`), { ...t, matches: done.filter((m) => m.a === t.name || m.b === t.name).slice(-30).reverse().map((m) => ({ date: m.date, league: m.league, stage: m.stage, opp: m.a === t.name ? m.b : m.a, score: m.a === t.name ? m.score : [m.score[1], m.score[0]] })) });
writeJSON(path.join(OUT, "teams.json"), teamsOut.map(({ profile, matches, ...t }) => ({ ...t, comfort: profile.comfort.slice(0, 3) })));
for (const p of playersOut) writeJSON(path.join(OUT, "players", `${p.id}.json`), p);
writeJSON(path.join(OUT, "players.json"), playersOut.map(({ pool, ...p }) => ({ ...p, top: pool.slice(0, 3) })));
// draft tables for the Draft lab (client-side): hero strength, combos and counters with 3+ games
writeJSON(path.join(OUT, "draft.json"), { wd: P.wd, scale: { hero: 0.2, syn: 0.1, cnt: 0.04 }, heroes: Object.fromEntries([...D.H].map(([k, v]) => [k, [r1(v.n), r1(v.w)]])), pairs: Object.fromEntries([...D.PAIR].filter(([, v]) => v.n >= 3).map(([k, v]) => [k, [r1(v.n), r1(v.w)]])), vs: Object.fromEntries([...D.VS].filter(([, v]) => v.n >= 3).map(([k, v]) => [k, [r1(v.n), r1(v.w)]])) });
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
      const order = field.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      for (const grp of [order.slice(0, 5), order.slice(5, 10)]) {
        const wins = new Map(grp.map((x) => [x, 0]));
        for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) { const p = lg((grp[i].r - grp[j].r) * (grp[i].reg !== grp[j].reg ? P.cx : 1)); /* same cross-region pull as every projection */ if (rnd() < p) wins.set(grp[i], wins.get(grp[i]) + 1); else wins.set(grp[j], wins.get(grp[j]) + 1); }
        const top = Math.max(...wins.values()), tied = grp.filter((x) => wins.get(x) === top); tied[Math.floor(rnd() * tied.length)].adv++;
      }
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
writeJSON(path.join(OUT, "meta.json"), { built: new Date().toISOString(), series: done.length, games: totalGames, teams: teamsOut.length, players: playersOut.length, heroes: HERO.length, upcoming: upOut.length, leagues: [...new Set(EVENTS.map((e) => e.league))], ratingScale: "Elo-style: 1500 average, 100 points = about 64% in a single game",
  roles: ROLES, source: "Liquipedia (CC-BY-SA) for matches, drafts and rosters; MLBBHub for ranked-game hero rates. No betting data." });
console.log(`wrote ${upOut.length} upcoming, ${teamsOut.length} teams, ${playersOut.length} players, ${HERO.length} heroes, ${picks.length} picks`);
