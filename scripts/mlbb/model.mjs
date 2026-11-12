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
const cap1 = (x) => String(x || "").replace(/\b\w/g, (c) => c.toUpperCase());
// one player under two names (confirmed by the user): old handle -> current name
const PALIAS = { domengkite: "Domeng", flaptzy: "Flap", kyletzy: "Kyle" }, palias = (n) => PALIAS[String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "")] || null;

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
// ranked (all players) hero rates from mlbb.io, matched by name with punctuation and spaces removed
const RKM = new Map(Object.values(readJSON(path.join(MD, "ranked-counters.json"), { heroes: {} }).heroes).filter((v) => v.wr != null).map((v) => [String(v.name).toLowerCase().replace(/[^a-z]/g, ""), { winRate: v.wr, banRate: v.ban, pickRate: null, tier: v.tier, winRateDelta: null }]));
const rankedOf = (id) => RKM.get(String(id).toLowerCase().replace(/[^a-z]/g, "")) || null;
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
const MOM = [], GDD = [], ALLG = []; // GDD: [team-rating logit before the game, result, picks A, picks B, date, league] // [team-rating logit before the game, result, +1 if side A won the previous game in the series else -1]
// FORM (ideas test, Nov 2026): surprise over a team's last 10 games, FW logit per game of surprise. Fitted walk-forward it
// helped single games slightly (Brier 0.2135 -> 0.2130) but made series slightly worse (0.1938 -> 0.1942) with the same
// winner rate, so it is OFF (FW 0). Re-test with FW=0.05 when more seasons are in.
const FW = process.env.FW != null ? +process.env.FW : 0, formOf = (t) => FW * (t.f || []).slice(-10).reduce((s, v) => s + v, 0);
// CAREER WIN RATE WHEN RATINGS ARE UNCERTAIN (ideas test, Nov 2026): while a team has under 10 series or under 5 games
// this season, the lineup's career win rate (shrunk to 50% with a 20-game prior, from our own games) adds CW logit per point.
const CW = process.env.CW != null ? +process.env.CW : 1, ROLEI = { EXP: 0, Jungle: 1, Mid: 2, Gold: 3, Roam: 4 };
const lineupOf = (team, page) => { const out = []; for (const x of rosterFor(team, page)) if (ROLEI[x.role] != null && out[ROLEI[x.role]] == null) out[ROLEI[x.role]] = String(palias(x.player) || x.player).toLowerCase(); return out.length === 5 && !out.includes(undefined) ? out : null; };
const careerWR = (PLR, L) => L.reduce((s, n) => { const r = PLR.get(n) || { n: 0, w: 0 }; return s + (r.w + 10) / (r.n + 20) - 0.5; }, 0) / 5;
const cwEdge = (PLR, SGc, A, B, LA, LB, season) => { if (!CW || !LA || !LB) return 0; const unc = A.n < 10 || B.n < 10 || (SGc.get(A.name + "|" + season) || 0) < 5 || (SGc.get(B.name + "|" + season) || 0) < 5; return unc ? CW * (careerWR(PLR, LA) - careerWR(PLR, LB)) : 0; };
function replay(P, record = false) {
  const PLR = new Map(), SGc = new Map();
  const T = new Map(), REG = {}, D = makeDraft(); // region offsets, created as regions appear
  const team = (n, region) => { if (!T.has(n)) T.set(n, { name: n, r: 0, n: 0, season: null, region, w: 0, l: 0, gw: 0, gl: 0, f: [] }); return T.get(n); };
  let sb = 0, sll = 0, sn = 0, sright = 0, gb = 0, gn = 0, gbD = 0, ib = 0, inn = 0; const log = [];
  for (const m of done) {
    const A = team(m.a, m.region), B = team(m.b, m.region), season = m.page.split("/").slice(0, -1).join("/");
    for (const t of [A, B]) { if (m.kind === "league" && t.season && t.season !== season) t.r *= P.carry; if (m.kind === "league") { t.season = season; t.region = m.region; } }
    const reg = (t) => (REG[t.region] || 0) * P.regW;
    const LA = lineupOf(m.a, m.page), LB = lineupOf(m.b, m.page);
    const cross = A.region !== B.region, d = (A.r + reg(A) + formOf(A) - (B.r + reg(B) + formOf(B))) * (cross ? P.cx : 1) + cwEdge(PLR, SGc, A, B, LA, LB, season), pg = lg(d), s = series(pg, m.bo), won = m.score[0] > m.score[1] ? 1 : 0;
    const warm = A.n >= 4 && B.n >= 4;
    if (warm && m.kind === "intl" && A.region !== B.region) { ib += (s.win - won) ** 2; inn++; }
    if (warm) { sb += (s.win - won) ** 2; sll += -Math.log(Math.max(1e-6, won ? s.win : 1 - s.win)); sn++; if ((s.win >= 0.5) === !!won) sright++; }
    if (record) log.push({ m, A: A.name, B: B.name, pg, pS: s.win, warm, nA: A.n, nB: B.n });
    // games: grade single games (team-only and with the draft layer), then learn
    let prevW = 0;
    for (const g of m.games) {
      const y = g.w === 1 ? 1 : 0, raw = (A.r + reg(A) - (B.r + reg(B))) * (cross ? P.cx : 1), dd = (A.r + reg(A) + formOf(A) - (B.r + reg(B) + formOf(B))) * (cross ? P.cx : 1) + cwEdge(PLR, SGc, A, B, LA, LB, season), p0 = lg(dd), e = D.edge(g.h1, g.h2), p1 = lg(dd + P.wd * (e.hero * 0.2 + e.syn * 0.1 + e.cnt * 0.04));
      if (warm && D.games > 200) { gb += (p0 - y) ** 2; gbD += (p1 - y) ** 2; gn++; }
      if (record && warm && prevW) MOM.push([dd, y, prevW]); prevW = y ? 1 : -1;
      if (record && warm) GDD.push([dd, y, g.h1, g.h2, m.date, m.league, m.score, g.n, m.bo]);
      if (record) ALLG.push({ base: dd + P.wd * (e.hero * 0.2 + e.syn * 0.1 + e.cnt * 0.04), y, g, m, warm: warm && D.games > 200, nA: A.n, nB: B.n, pre: dd, dr: [P.wd * e.hero * 0.2, P.wd * e.syn * 0.1, P.wd * e.cnt * 0.04] }); // every game with the full pre-game logit, for the ideas test
      const k = P.k * (A.n < 6 || B.n < 6 ? 1.5 : 1), err = y - p0;
      A.r += k * err; B.r -= k * err; if (m.kind === "intl" && A.region !== B.region && A.region !== "INTL" && B.region !== "INTL") { REG[A.region] = (REG[A.region] || 0) + P.kr * err; REG[B.region] = (REG[B.region] || 0) - P.kr * err; }
      { const sp = y - lg(raw); A.f.push(sp); B.f.push(-sp); }
      for (const [L, won] of [[LA, y], [LB, 1 - y]]) if (L) for (const n of L) { const r = PLR.get(n) || PLR.set(n, { n: 0, w: 0 }).get(n); r.n++; r.w += won; }
      for (const t of [A, B]) SGc.set(t.name + "|" + season, (SGc.get(t.name + "|" + season) || 0) + 1); // surprise against the ratings alone (form excluded)
      if (y) { A.gw++; B.gl++; } else { B.gw++; A.gl++; }
      D.learn(g, m.date);
    }
    A.n++; B.n++; if (won) { A.w++; B.l++; } else { B.w++; A.l++; }
    if (record) for (const t of [A, B]) (t.hist ||= []).push([m.date, t.r + (REG[t.region] || 0) * P.regW]); // rating after each series, for the learning page
  }
  return { T, REG, D, PLR, SGc, ibrier: inn ? ib / inn : 0, inn, brier: sb / sn, ll: sll / sn, acc: sright / sn, n: sn, gBrier: gb / gn, gBrierDraft: gbD / gn, gn, log };
}
const grid = []; for (const k of [0.1, 0.16, 0.24, 0.32]) for (const carry of [0.5, 0.7, 0.85, 1]) for (const kr of [0.04]) for (const cx of (process.env.CX ? [+process.env.CX] : [0.1, 0.2, 0.3, 0.5])) for (const regW of [1]) for (const wd of [0, 0.5, 1, 1.5]) grid.push({ k, carry, kr, regW, wd, cx });
let best = null; for (const P of grid) { const r = replay(P); const score = r.brier + 0.5 * r.gBrierDraft + 0.5 * r.ibrier; if (!best || score < best.score) best = { P, r, score }; }
const P = best.P, R = replay(P, true);
// MOMENTUM: does the winner of the previous game in a series win the next one more often than the ratings (already
// updated after that game) expect? Fitted as one logit shift by maximum likelihood over every later game in a series.
const momFit = (() => { let best = { b: 0, ll: -Infinity }; for (let b = -0.6; b <= 0.6001; b += 0.02) { let ll = 0; for (const [d, y, s] of MOM) { const p = lg(d + b * s); ll += Math.log(y ? p : 1 - p); } if (ll > best.ll) best = { b: Math.round(b * 100) / 100, ll }; }
  let ll0 = 0; for (const [d, y] of MOM) { const p = lg(d); ll0 += Math.log(y ? p : 1 - p); } const same = MOM.filter(([, y, s]) => (y ? 1 : -1) === s).length;
  return { b: best.b, n: MOM.length, sameRate: Math.round((same / MOM.length) * 1000) / 1000, lrStat: Math.round(2 * (best.ll - ll0) * 10) / 10 }; })();
console.log("momentum", JSON.stringify(momFit));
// IDEAS TEST (run with IDEAS_TEST=<path to the research review-all-players.json>): the research session's model ideas,
// each built as a feature from games played BEFORE the one being predicted, added on top of the full pre-game logit
// (team ratings + draft layer). Each is fitted on the first 70% of games by date and judged on the last 30%; an idea is
// adopted only if it is clear in-sample (likelihood-ratio statistic > 3.84, about p < 0.05) AND lowers the held-out
// Brier score. Results go to derived/mlbb/ideas-test.json.
if (process.env.IDEAS_TEST) {
  const RV = JSON.parse(fs.readFileSync(process.env.IDEAS_TEST, "utf8")), ROLE = { EXP: 0, Jungle: 1, Mid: 2, Gold: 3, Roam: 4 };
  const lineup = (team, page) => { const out = []; for (const x of rosterFor(team, page)) if (ROLE[x.role] != null && out[ROLE[x.role]] == null) out[ROLE[x.role]] = String(palias(x.player) || x.player).toLowerCase(); return out.length === 5 && !out.includes(undefined) ? out : null; };
  const SHORT = readJSON(path.join(MD, "team-short.json"), {}), shortOf = (t) => SHORT[t] || Object.entries(SHORT).find(([k]) => k.toLowerCase() === String(t).toLowerCase())?.[1] || t;
  // per-game research rows: [league, match id, game, team, opp, player, hero, win, minutes, K, D, A, gold, damage, taken, tower, KP]
  const LANE = new Map(RV.season.map((p) => [String(p.p).toLowerCase(), p.lane])); // each player's main lane
  const RG = new Map(); for (const r of RV.log) { const k = `${r[0]}|${r[1]}|${r[2]}`; (RG.get(k) || RG.set(k, []).get(k)).push(r); }
  // join research games to ours: same league, same pair of team tags, k-th meeting of the pair, same game number
  const meet = new Map(); // match ids are numbers in ID/MY and text slugs ending in a date in PH (flcn-rora-20261025): order by number, else by that date
  const mOrd = (m) => (/^d+$/.test(m) ? +m : +(String(m).match(/(d{8})$/)?.[1] || 0));
  const rkeys = [...RG.keys()].sort((a, b) => { const [la, ma, ga] = a.split("|"), [lb, mb, gb] = b.split("|"); return la.localeCompare(lb) || mOrd(ma) - mOrd(mb) || ma.localeCompare(mb) || +ga - +gb; });
  const rOrder = new Map(); { const seen = new Map(); for (const k of rkeys) { const [l, mid] = k.split("|"), rows = RG.get(k), pair = [...new Set(rows.map((r) => r[3]))].sort().join("~"), pk = `${l}|${pair}`; if (!seen.has(pk)) seen.set(pk, []); const lst = seen.get(pk); if (!lst.includes(mid)) lst.push(mid); rOrder.set(k, `${pk}|${lst.indexOf(mid)}|${k.split("|")[2]}`); } }
  const byOrder = new Map([...rOrder].map(([k, o]) => [o, k]));
  // research team names are tags in ID/MY but full names in PH ("Team Falcons", "Smart Omega"): match each of our team names to one research name
  const RTAGS = {}; for (const r of RV.log) (RTAGS[r[0]] ||= new Set()).add(r[3]);
  const st = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""), wordsOf = (x) => String(x || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["team", "esports", "gaming", "pro"].includes(w)), inits = (x) => String(x || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join("");
  const rtagMemo = new Map(), rtag = (lgk, name) => { const k = lgk + "|" + name; if (rtagMemo.has(k)) return rtagMemo.get(k); const sh = st(shortOf(name)), nm = st(name), W = wordsOf(name); let hit = null;
    for (const t of RTAGS[lgk] || []) { const tt = st(t); if (tt === sh || tt === nm || nm.startsWith(tt) || tt.startsWith(nm) || inits(name) === tt || wordsOf(t).some((w) => W.includes(w))) { hit = t; break; } } rtagMemo.set(k, hit); return hit; };
  const oSeen = new Map(); const ourKey = (x) => { if (!/Season 18$/.test(seasonOf(x.m.page)) || !["ID", "PH", "MY"].includes(x.m.region)) return null; const lgk = `${x.m.region} S18`, ta = rtag(lgk, x.m.a), tb = rtag(lgk, x.m.b); if (!ta || !tb || ta === tb) return null; const pair = [ta, tb].sort().join("~"), pk = `${x.m.region} S18|${pair}`; if (!oSeen.has(pk)) oSeen.set(pk, []); const lst = oSeen.get(pk); if (!lst.includes(x.m.id)) lst.push(x.m.id); return `${pk}|${lst.indexOf(x.m.id)}|${x.g.n}`; };
  // MENA S10 team-game rows (deaths come from the opponent's kills)
  const MG = RV.menaGames || []; const mSeen = new Map(), mOrder = new Map(); for (const g of [...MG].sort((a, b) => a.id - b.id)) { const pair = [g.L, g.R].sort().join("~"); if (!mSeen.has(pair)) mSeen.set(pair, 0); mOrder.set(`${pair}|${g.n}|${mSeen.get(pair)}`, g); if (g.n === 1) mSeen.set(pair, mSeen.get(pair) + 1); }
  // walk forward through every game, building features before learning from it
  const PH = new Map(), PL = new Map(), TF = new Map(), ARC = new Map(), ARM = new Map(), PS = new Map(), MD2 = new Map(), FEAT = { comfort: [], comfort70: [], familiar: [], experience: [], intlExp: [], careerWR: [], form10: [], archLane: [], menaDeaths: [], s16Prior: [], s16WinPrior: [], comfortDelta: [], comfortPicks: [], expBigStage: [], careerWRuncertain: [], archMix: [] };
  // recency-weighted records (half-life 240 days) for the comfort delta: the player on this hero against the player overall
  const HL = 240 * DAY, RW = new Map(), rw = (k, t) => { const r = RW.get(k); if (!r) return { n: 0, w: 0 }; const f = 0.5 ** ((t - r.t) / HL); return { n: r.n * f, w: r.w * f }; }, rwAdd = (k, t, won) => { const r = rw(k, t); RW.set(k, { n: r.n + 1, w: r.w + won, t }); };
  const SG = new Map(), ARM2 = new Map(), BIG = /playoff|final|knockout|bracket|upper|lower|elimination/i;
  // Season 16 lines (staff stat posts, derived/mlbb/career-ph.json): KDA percentile within the lane, and win rate shrunk to 50%
  const C16 = readJSON(path.join(ROOT, "derived", "mlbb", "career-ph.json"), { players: {} }).players, ck16 = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byLane16 = {}; for (const p of Object.values(C16)) if (p.s16?.lane && p.s16.kda != null) (byLane16[p.s16.lane] ||= []).push(p.s16.kda);
  const pct16 = (p) => { const L = byLane16[p.s16.lane]; return L.filter((v) => v < p.s16.kda).length / Math.max(1, L.length - 1) - 0.5; };
  const s16Side = (L) => { if (!L) return null; const v = L.map((n) => C16[ck16(n)]).filter((p) => p?.s16?.lane && p.s16.g); return v.length >= 3 ? { k: v.reduce((a, p) => a + pct16(p), 0) / v.length, w: v.reduce((a, p) => a + (p.s16.w + 10) / (p.s16.g + 20) - 0.5, 0) / v.length } : null; };
  const get = (M, k, d) => M.get(k) || (M.set(k, d()), M.get(k));
  const prior = (M, k) => M.get(k) || { n: 0, w: 0 };
  let joined = 0, s18 = 0, mJoin = 0;
  const archOf = (pl) => { const s = PS.get(pl); if (!s || s.n < 3) return null; const m = (k) => s[k] / s.n, all = PS.get("*"), z = (k) => (m(k) - all[k] / all.n) / (all.sd?.[k] || 1);
    const sc = { "Hyper-carry": z("gpm") + z("dpm"), Finisher: z("k") + z("dpm"), Playmaker: z("kp") + z("a"), "Frontline anchor": z("tpm") + z("a") - z("gpm"), "Split-pusher": z("tow"), "Safe efficiency": -z("d") + z("kda"), "High-risk aggressor": z("k") + z("d") + z("kp") };
    const best = Object.entries(sc).sort((a, b) => b[1] - a[1])[0]; return best[1] > 0.5 ? best[0] : "Balanced"; };
  for (const x of ALLG) {
    const LA = lineup(x.m.a, x.m.page), LB = lineup(x.m.b, x.m.page), five = x.g.h1?.length === 5 && x.g.h2?.length === 5 && x.g.h1.every(Boolean) && x.g.h2.every(Boolean);
    const side = (L, H) => { if (!L) return null; let c = 0, c70 = 0, fam = 0, ex = 0, ix = 0, wr = 0; for (let i = 0; i < 5; i++) { const ph = five ? prior(PH, `${L[i]}|${H[i]}`) : { n: 0, w: 0 }, pl = prior(PL, L[i]); c += (ph.w + 2.5) / (ph.n + 5) - 0.5; if (ph.n >= 15 && ph.w / ph.n >= 0.7) c70++; fam += Math.log1p(ph.n); ex += Math.log1p(pl.n); ix += Math.log1p(pl.intl || 0); wr += (pl.w + 10) / (pl.n + 20) - 0.5; } return { c, c70, fam, ex: ex / 5, ix: ix / 5, wr: wr / 5 }; };
    const a = side(LA, x.g.h1), b = side(LB, x.g.h2), tms = Date.parse(x.m.date || 0) || 0;
    const cside = (L, H) => { if (!L || !five) return null; let dl = 0, cp = 0; for (let i = 0; i < 5; i++) { const ph = rw(`${L[i]}|${H[i]}`, tms), pl = rw(L[i], tms), dlt = (ph.w + 2.5) / (ph.n + 5) - (pl.w + 5) / (pl.n + 10); dl += dlt; if (ph.n >= 4 && dlt >= 0.1) cp++; } return { dl, cp }; };
    const ca = cside(LA, x.g.h1), cb = cside(LB, x.g.h2), sk = (t) => `${t}|${seasonOf(x.m.page)}`, unc = x.nA < 10 || x.nB < 10 || (SG.get(sk(x.m.a)) || 0) < 5 || (SG.get(sk(x.m.b)) || 0) < 5, big = BIG.test(x.m.stage || "") || x.m.kind === "intl";
    const tf = (t) => { const h = TF.get(t) || []; return h.slice(-10).reduce((s, v) => s + v, 0); };
    if (x.warm) {
      const row = (k, v) => FEAT[k].push([x.base, x.y, v, x.m.date]);
      if (a && b) { if (five) { row("comfort", a.c - b.c); row("comfort70", a.c70 - b.c70); row("familiar", a.fam - b.fam); } row("experience", a.ex - b.ex); row("intlExp", a.ix - b.ix); row("careerWR", a.wr - b.wr); }
      row("form10", tf(x.m.a) - tf(x.m.b));
      if (ca && cb) { row("comfortDelta", ca.dl - cb.dl); row("comfortPicks", ca.cp - cb.cp); }
      if (a && b) { row("expBigStage", big ? a.ex - b.ex : 0); row("careerWRuncertain", unc ? a.wr - b.wr : 0); }
      if (["MPL/Philippines/Season 17", "MPL/Philippines/Season 18"].includes(seasonOf(x.m.page))) { const sa = s16Side(LA), sb = s16Side(LB); if (sa && sb) { row("s16Prior", sa.k - sb.k); row("s16WinPrior", sa.w - sb.w); } }
    }
    // archetype lane matchups (Season 18 ID/PH/MY): archetypes from each player's earlier S18 games only
    const ok = ourKey(x), rk = ok && byOrder.get(ok);
    if (ok) s18++;
    if (rk) { joined++; const rows = RG.get(rk), tA = rtag(`${x.m.region} S18`, x.m.a);
      const byTeam = (t) => rows.filter((r) => r[3] === t);
      const LI = (r) => ROLE[LANE.get(r[5].toLowerCase())] ?? 9, byLane = (rs) => { const o = [...rs].sort((p, q) => LI(p) - LI(q)); return new Set(o.map(LI)).size === 5 && LI(o[4]) < 9 ? o : []; };
      const ra = byLane(byTeam(tA)), rb = byLane(rows.filter((r) => r[3] !== tA));
      if (x.warm && ra.length === 5 && rb.length === 5) { let f = 0, used = 0; for (let i = 0; i < 5; i++) { const p1 = ra[i][5].toLowerCase(), p2 = rb[i][5].toLowerCase(), A1 = archOf(p1), B1 = archOf(p2); if (A1 && B1) { const c = prior(ARM, `${A1}|${B1}`); f += (c.w + 5) / (c.n + 10) - 0.5; used++; } } if (used >= 3) FEAT.archLane.push([x.base, x.y, f, x.m.date]); }
      if (x.warm && ra.length === 5 && rb.length === 5) { const XA = ra.map((r) => archOf(r[5].toLowerCase())).filter(Boolean), XB = rb.map((r) => archOf(r[5].toLowerCase())).filter(Boolean); if (XA.length >= 3 && XB.length >= 3) { let f = 0; for (const p1 of XA) for (const p2 of XB) { const c = prior(ARM2, `${p1}|${p2}`); f += (c.w + 10) / (c.n + 20) - 0.5; } FEAT.archMix.push([x.base, x.y, f / Math.sqrt(XA.length * XB.length), x.m.date]); } }
      if (ra.length === 5 && rb.length === 5) { const XA = ra.map((r) => archOf(r[5].toLowerCase())).filter(Boolean), XB = rb.map((r) => archOf(r[5].toLowerCase())).filter(Boolean); for (const p1 of XA) for (const p2 of XB) { const c1 = get(ARM2, `${p1}|${p2}`, () => ({ n: 0, w: 0 })), c2 = get(ARM2, `${p2}|${p1}`, () => ({ n: 0, w: 0 })); c1.n++; c2.n++; if (x.y) c1.w++; else c2.w++; } }
      // learn: matchup table, then player stat sums
      if (ra.length === 5 && rb.length === 5) for (let i = 0; i < 5; i++) { const A1 = archOf(ra[i][5].toLowerCase()), B1 = archOf(rb[i][5].toLowerCase()); if (A1 && B1) { const c1 = get(ARM, `${A1}|${B1}`, () => ({ n: 0, w: 0 })), c2 = get(ARM, `${B1}|${A1}`, () => ({ n: 0, w: 0 })); c1.n++; c2.n++; if (x.y) c1.w++; else c2.w++; } }
      for (const r of rows) { const mins = r[8] || 1, v = { k: r[9], d: r[10], a: r[11], gpm: r[12] / mins, dpm: r[13] / mins, tpm: r[14] / mins, tow: r[15] / mins, kp: r[16], kda: Math.min(20, (r[9] + r[11]) / Math.max(1, r[10])) }; if (!isFinite(v.gpm) || !v.gpm) continue;
        for (const key of [r[5].toLowerCase(), "*"]) { const s = get(PS, key, () => ({ n: 0 })); s.n++; for (const [kk, vv] of Object.entries(v)) s[kk] = (s[kk] || 0) + vv; if (key === "*") { s.sq ||= {}; for (const [kk, vv] of Object.entries(v)) s.sq[kk] = (s.sq[kk] || 0) + vv * vv; s.sd = Object.fromEntries(Object.keys(v).map((kk) => [kk, Math.sqrt(Math.max(1e-9, s.sq[kk] / s.n - (s[kk] / s.n) ** 2))])); } } } }
    // MENA S10 deaths per game from earlier games
    if (seasonOf(x.m.page) === "MPL/MENA/Season 10") { const sa = shortOf(x.m.a), sb = shortOf(x.m.b), pair = [sa, sb].sort().join("~");
      const key = [...mOrder.keys()].find((k) => k.startsWith(pair + "|" + x.g.n + "|") && !mOrder.get(k).used);
      const mg = key && mOrder.get(key);
      if (x.warm) { const dA = MD2.get(sa), dB = MD2.get(sb); if (dA?.n >= 3 && dB?.n >= 3) FEAT.menaDeaths.push([x.base, x.y, dB.d / dB.n - dA.d / dA.n, x.m.date]); }
      if (mg) { mg.used = true; mJoin++; const [kL, kR] = mg.kills, dL = kR, dR = kL; for (const [t, d] of [[mg.L, dL], [mg.R, dR]]) { const s = get(MD2, t, () => ({ n: 0, d: 0 })); s.n++; s.d += d; } } }
    // learn from this game
    const res = (t, won) => get(TF, t, () => []).push(won - lg(t === x.m.a ? x.base : -x.base));
    res(x.m.a, x.y); res(x.m.b, 1 - x.y);
    for (const t of [x.m.a, x.m.b]) SG.set(sk(t), (SG.get(sk(t)) || 0) + 1);
    if (five) for (const [L, H, won] of [[LA, x.g.h1, x.y], [LB, x.g.h2, 1 - x.y]]) if (L) for (let i = 0; i < 5; i++) { rwAdd(L[i], tms, won); rwAdd(`${L[i]}|${H[i]}`, tms, won); }
    for (const [L, H, won] of [[LA, x.g.h1, x.y], [LB, x.g.h2, 1 - x.y]]) if (L) for (let i = 0; i < 5; i++) { const pl = get(PL, L[i], () => ({ n: 0, w: 0, intl: 0 })); pl.n++; pl.w += won; if (x.m.kind === "intl") pl.intl++; if (five && H[i]) { const ph = get(PH, `${L[i]}|${H[i]}`, () => ({ n: 0, w: 0 })); ph.n++; ph.w += won; } }
  }
  const fit = (rows) => { let best = { b: 0, ll: -Infinity }; for (let b = -2; b <= 2.0001; b += 0.01) { let ll = 0; for (const [d, y, f] of rows) { const p = lg(d + b * f); ll += Math.log(y ? p : 1 - p); } if (ll > best.ll) best = { b, ll }; } let ll0 = 0; for (const [d, y] of rows) { const p = lg(d); ll0 += Math.log(y ? p : 1 - p); } return { b: Math.round(best.b * 100) / 100, lr: Math.round(2 * (best.ll - ll0) * 10) / 10 }; };
  const brier = (rows, b) => rows.reduce((s, [d, y, f]) => s + (lg(d + b * f) - y) ** 2, 0) / rows.length;
  const out = {};
  for (const [k, rows] of Object.entries(FEAT)) { const nz = rows.filter((r) => r[2] !== 0).length; if (rows.length < 40) { out[k] = { n: rows.length, verdict: "too few games to test" }; continue; }
    const cut = Math.floor(rows.length * 0.7), tr = rows.slice(0, cut), te = rows.slice(cut), all = fit(rows), t = fit(tr), b0 = brier(te, 0), b1 = brier(te, t.b);
    out[k] = { n: rows.length, nonzero: nz, b: all.b, lr: all.lr, test: { n: te.length, b: t.b, brierBase: r3(b0), brierWith: r3(b1), gain: Math.round((b0 - b1) * 10000) / 10000 }, verdict: all.lr > 3.84 && b1 < b0 ? "ADOPT" : all.lr > 3.84 ? "lead: clear in-sample, no held-out gain" : "reject: no clear effect" }; }
  { const parts = ["comfortDelta", "comfortPicks", "expBigStage", "careerWRuncertain", "careerWR", "experience"], byGame = new Map();
    for (const k of parts) { const rows = FEAT[k], cut = Math.floor(rows.length * 0.7), tr = rows.slice(0, cut), sd = Math.sqrt(tr.reduce((a2, r) => a2 + r[2] * r[2], 0) / Math.max(1, tr.length)) || 1, sg = Math.sign(fit(tr).b) || 0; for (const r of rows) { const key2 = r[3] + "|" + r[0]; const e = byGame.get(key2) || byGame.set(key2, [r[0], r[1], 0, r[3]]).get(key2); e[2] += sg * r[2] / sd / parts.length; } }
    const rows = [...byGame.values()], cut = Math.floor(rows.length * 0.7), tr = rows.slice(0, cut), te = rows.slice(cut), all = fit(rows), t = fit(tr), b0 = brier(te, 0), b1 = brier(te, t.b);
    out.contextScore = { n: rows.length, b: all.b, lr: all.lr, test: { n: te.length, b: t.b, brierBase: r3(b0), brierWith: r3(b1), gain: Math.round((b0 - b1) * 10000) / 10000 }, verdict: all.lr > 3.84 && b1 < b0 ? "ADOPT" : all.lr > 3.84 ? "lead: clear in-sample, no held-out gain" : "reject: no clear effect" }; }
  // FIXED SMALL NUDGES (the user wants these signals to count): cost of each at the exact small, capped weight used on the
  // site, on the held-out 30% of games (Brier change; positive = better, negative = worse)
  { const cl = (v, c) => Math.max(-c, Math.min(c, v)), ev2 = (rows, b, cap) => { const cut = Math.floor(rows.length * 0.7), te = rows.slice(cut); let b0 = 0, b1 = 0; for (const [d, y, f] of te) { b0 += (lg(d) - y) ** 2; b1 += (lg(d + cl(b * f, cap)) - y) ** 2; } return { n: te.length, gain: Math.round(((b0 - b1) / te.length) * 100000) / 100000 }; };
    out.nudges = { comfortPicks: { weight: 0.04, cap: 0.12, ...ev2(FEAT.comfortPicks, 0.04, 0.12) }, expBigStage: { weight: 0.05, cap: 0.06, ...ev2(FEAT.expBigStage, 0.05, 0.06) }, archMix: { weight: 0.3, cap: 0.06, ...ev2(FEAT.archMix, 0.3, 0.06) }, archLane: { weight: 0.3, cap: 0.06, ...ev2(FEAT.archLane, 0.3, 0.06) } }; }
  out._joins = { s18Games: s18, s18Joined: joined, menaJoined: mJoin };
  console.log("IDEAS TEST", JSON.stringify(out, null, 1));
  writeJSON(path.join(ROOT, "derived", "mlbb", "ideas-test.json"), { built: new Date().toISOString(), results: out }, true);
}
// COMBINED TEST (run with R7_JSON=<R7 pro drafts file>, private): join R7's pick order to our games by both drafts,
// pool every source, and test the draft-order and series claims raw and after team ratings. Printed only.
if (process.env.R7_JSON) {
  const R7 = JSON.parse(fs.readFileSync(process.env.R7_JSON, "utf8")).games.filter((g) => g.hasDraft), key = (x) => String(x).toLowerCase().replace(/[^a-z]/g, "");
  const wil = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [((c - r) / d * 100).toFixed(1), ((c + r) / d * 100).toFixed(1)]; };
  const set = (hs) => hs.map(key).sort().join(",");
  const ours = new Map(GDD.filter((g) => g[2].length === 5 && g[3].length === 5).map((g) => [set(g[2]) + "|" + set(g[3]), g]));
  const joined = [], r7only = [];
  for (const g of R7) { const pf = g.picksFP.map((p) => p.split(":")[1].split("/")), ps = g.picksSP.map((p) => p.split(":")[1].split("/")), fpSet = set(pf.map((x) => x[0])), spSet = set(ps.map((x) => x[0]));
    const A = ours.get(fpSet + "|" + spSet), B = ours.get(spSet + "|" + fpSet), hit = A || B; const p1 = g.picksFP.find((p) => p.startsWith("P1:")), p10 = g.picksSP.find((p) => p.startsWith("P10:"));
    const rec = { p1role: p1?.split("/")[1] || null, p10role: p10?.split("/")[1] || null, fpWon: g.winner === g.teamFP };
    if (hit) { const ddFP = A ? hit[0] : -hit[0]; joined.push({ ...rec, ddFP, fpWonOurs: A ? !!hit[1] : !hit[1] }); } else r7only.push(rec); }
  console.log("combined: R7 drafted", R7.length, "| joined to our games (ratings known)", joined.length, "| R7-only", r7only.length, "| our drafted games", ours.size, "| union", ours.size + r7only.length);
  const agree = joined.filter((j) => j.fpWon === j.fpWonOurs).length; console.log("  winner agreement on joined games", agree + "/" + joined.length);
  const fit = (rows, feat) => { let best = { b: 0, ll: -Infinity }; for (let b = -0.8; b <= 0.8001; b += 0.01) { let ll = 0; for (const r of rows) { const p = lg(r.ddFP + b * feat(r)); ll += Math.log(r.fpWonOurs ? p : 1 - p); } if (ll > best.ll) best = { b: Math.round(b * 100) / 100, ll }; } let ll0 = 0; for (const r of rows) { const p = lg(r.ddFP); ll0 += Math.log(r.fpWonOurs ? p : 1 - p); } return { b: best.b, lr: Math.round(2 * (best.ll - ll0) * 10) / 10 }; };
  const all = joined.map((j) => ({ role: j.p1role, won: j.fpWonOurs, exp: lg(j.ddFP) })).concat(r7only.map((j) => ({ role: j.p1role, won: j.fpWon, exp: null })));
  const ORD = { note: "First-pick lane: which lane the very first pick of the draft was for, and how often that side won. Pick order from a community draft library joined to our Liquipedia games (winners checked); after ratings = the effect left once both teams' ratings are known.", games: all.length, joined: joined.length, roles: {} };
  for (const role of ["Roam", "Mid", "Jungle", "Gold", "EXP"]) { const rs = all.filter((x) => x.role === role), k = rs.filter((x) => x.won).length, ex = joined.filter((j) => j.p1role === role); const expAvg = ex.length ? (ex.reduce((a, j) => a + lg(j.ddFP), 0) / ex.length * 100).toFixed(1) : "-";
    const ft = fit(joined, (j) => (j.p1role === role ? 1 : 0)); { const ft2 = fit(joined, (j) => (j.p1role === role ? 1 : 0)), ci = wil(k, rs.length).map(Number); ORD.roles[role] = { n: rs.length, k, rate: Math.round(k / rs.length * 1000) / 1000, lo: ci[0] / 100, hi: ci[1] / 100, expected: ex.length ? Math.round(ex.reduce((a, j) => a + lg(j.ddFP), 0) / ex.length * 1000) / 1000 : null, b: ft2.b, lr: ft2.lr }; }
    console.log(`  first pick (P1) ${role}: ${rs.length} games, first-pick side wins ${(k / rs.length * 100).toFixed(1)}% (range ${wil(k, rs.length).join("-")}); ratings expected ${expAvg}%; after ratings logit ${ft.b} LR ${ft.lr}`); }
  for (const role of ["Roam", "Mid", "Jungle", "Gold", "EXP"]) { const rs = joined.concat(r7only).filter((x) => x.p10role === role), k = rs.filter((x) => !(x.fpWonOurs ?? x.fpWon)).length; if (rs.length > 20) console.log(`  last pick (P10) ${role}: ${rs.length} games, second-pick side wins ${(k / rs.length * 100).toFixed(1)}% (range ${wil(k, rs.length).join("-")})`); }
  writeJSON(path.join(MD, "draft-order.json"), ORD);
  // series claims on our full data (every source agrees on results): deciding games and the game after a loss
  let dk = 0, dn = 0, ddSum = 0; for (const g of GDD) { const [dd, y, , , , , score, n, bo] = g; if (!bo || bo < 3) continue; const need = Math.ceil(bo / 2); if (n === 2 * need - 1) { dn++; if (y) dk++; ddSum += lg(dd); } }
  console.log(`  deciding games: ${dn}, side A wins ${(dk / dn * 100).toFixed(1)}%, ratings expected ${(ddSum / dn * 100).toFixed(1)}%`);
  console.log("  momentum (after ratings), all our series games:", JSON.stringify(momFit));
}
// DAMAGE MIX TEST (run with DMG_CSV=<path to the Fandom hero data>): does the side with more physical heroes win more,
// and does that add anything once the team ratings are known? Printed only; nothing is written.
if (process.env.DMG_CSV) {
  const rows = fs.readFileSync(process.env.DMG_CSV, "utf8").split(/\r?\n/).filter(Boolean), head = rows[0].split(","), key = (x) => String(x).toLowerCase().replace(/[^a-z]/g, "");
  const DT = new Map(rows.slice(1).map((r) => { const c = r.split(","); return [key(c[0]), (c[head.indexOf("dmg_type")] || "").replace("Phyiscal", "Physical")]; }));
  const phys = (hs) => hs.filter((h) => DT.get(key(h)) === "Physical").length, known = (hs) => hs.every((h) => DT.has(key(h)));
  const wil = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [((c - r) / d * 100).toFixed(1), ((c + r) / d * 100).toFixed(1)]; };
  const G = GDD.filter(([, , a, b]) => a.length === 5 && b.length === 5 && known(a) && known(b)).map(([dd, y, a, b, date, lgN]) => ({ dd, y, d: phys(a) - phys(b), pa: phys(a), pb: phys(b), date, lgN }));
  const more = (gs) => { let k = 0, n = 0; for (const g of gs) { if (!g.d) continue; n++; if ((g.d > 0) === !!g.y) k++; } return { n, rate: n ? (k / n * 100).toFixed(1) : "-", ci: n ? wil(k, n) : null }; };
  const magic3 = (gs) => { let k = 0, n = 0; for (const g of gs) for (const [p, won] of [[g.pa, g.y], [g.pb, 1 - g.y]]) if (5 - p >= 3) { n++; if (won) k++; } return { n, rate: (k / n * 100).toFixed(1), ci: wil(k, n) }; };
  const fit = (gs, feat) => { let best = { b: 0, ll: -Infinity }; for (let b = -0.5; b <= 0.5001; b += 0.01) { let ll = 0; for (const g of gs) { const p = lg(g.dd + b * feat(g)); ll += Math.log(g.y ? p : 1 - p); } if (ll > best.ll) best = { b: Math.round(b * 100) / 100, ll }; } let ll0 = 0; for (const g of gs) { const p = lg(g.dd); ll0 += Math.log(g.y ? p : 1 - p); } return { b: best.b, lr: Math.round(2 * (best.ll - ll0) * 10) / 10 }; };
  const loss = (gs, b, feat) => gs.reduce((a, g) => { const p = lg(g.dd + b * feat(g)); return a - Math.log(g.y ? p : 1 - p); }, 0) / gs.length;
  const sign = (g) => Math.sign(g.d), lin = (g) => g.d;
  const mix = (gs) => { let n = 0, s2 = 0; for (const g of gs) if (g.d) { n++; s2 += g.d > 0 ? lg(g.dd) : 1 - lg(g.dd); } return n ? (s2 / n * 100).toFixed(1) : "-"; };
  console.log("damage-mix: games with both drafts typed", G.length, "of", GDD.length);
  console.log("  more physical wins:", JSON.stringify(more(G)), "| ratings alone expected the more-physical side to win", mix(G) + "%");
  console.log("  3+ magic/mixed heroes:", JSON.stringify(magic3(G)));
  for (const L of ["MPL MENA", "MCC", "MPL MY", "BetBoom RoL", "MPL PH", "MPL ID", "MTC TR", "MSL TH"]) { const gs = G.filter((g) => g.lgN === L); if (gs.length > 40) console.log("  ", L, JSON.stringify(more(gs)), "ratings expected", mix(gs) + "%"); }
  console.log("  after ratings (sign):", JSON.stringify(fit(G, sign)), "(linear):", JSON.stringify(fit(G, lin)), "| LR > 3.84 = 95%");
  const cut = "2026-06-01", tr = G.filter((g) => g.date < cut), te = G.filter((g) => g.date >= cut), fb = fit(tr, sign);
  console.log("  out of sample: fit before", cut, JSON.stringify(fb), "n", tr.length, "| test n", te.length, "log loss ratings only", loss(te, 0, sign).toFixed(4), "with damage mix", loss(te, fb.b, sign).toFixed(4), "| test more-physical", JSON.stringify(more(te)), "expected", mix(te) + "%");
}
console.log("learned", JSON.stringify(P), `series Brier ${R.brier.toFixed(4)} log-loss ${R.ll.toFixed(4)} (cross-region ${r3(R.ibrier)} on ${R.inn}) winner ${(R.acc * 100).toFixed(1)}% (${R.n}); games Brier team-only ${R.gBrier.toFixed(4)} with draft ${R.gBrierDraft.toFixed(4)} (${R.gn})`, "regions", JSON.stringify(Object.fromEntries(Object.entries(R.REG).map(([k, v]) => [k, r3(v)]))));

// ---------------------------------------------------------------- heroes, players, teams (from all history)
const D = R.D, HERO = [];
const totalGames = done.reduce((a, m) => a + m.games.length, 0);
const raw = new Map(); // undecayed counts for display
for (const m of done) for (const g of m.games) { for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { hs.forEach((x, i) => { const v = raw.get(x) || { n: 0, w: 0, b: 0, roles: {} }; v.n++; if (w) v.w++; v.roles[ROLES[i]] = (v.roles[ROLES[i]] || 0) + 1; if (w) (v.rw ||= {})[ROLES[i]] = (v.rw?.[ROLES[i]] || 0) + 1; raw.set(x, v); }); bs.forEach((x) => { const v = raw.get(x) || { n: 0, w: 0, b: 0, roles: {} }; v.b++; raw.set(x, v); }); } }
const recent = new Map(); for (const m of done.filter((m) => Date.parse(m.date) > now - 150 * DAY)) for (const g of m.games) { for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { hs.forEach((x) => { const v = recent.get(x) || { n: 0, w: 0, b: 0 }; v.n++; if (w) v.w++; recent.set(x, v); }); bs.forEach((x) => { const v = recent.get(x) || { n: 0, w: 0, b: 0 }; v.b++; recent.set(x, v); }); } }
const recentGames = done.filter((m) => Date.parse(m.date) > now - 150 * DAY).reduce((a, m) => a + m.games.length, 0) || 1;
for (const [name, v] of raw) {
  if (!name || /^(none|-|tbd)$/i.test(name)) continue; // blank pick slots on a few match pages
  const d = D.H.get(name) || { n: 0, w: 0, b: 0 }, rc = recent.get(name) || { n: 0, w: 0, b: 0 }, str = logit((d.w + 4) / (d.n + 8));
  const solo = (h) => { const s = D.H.get(h) || { n: 0, w: 0 }; return (s.w + 4) / (s.n + 8); };
  const syn = [...D.PAIR].filter(([k, x]) => k.split("|").includes(name) && x.n >= 3).map(([k, x]) => { const o = k.split("|").find((y) => y !== name), wr = (x.w + 3) / (x.n + 6); return { with: o, n: r1(x.n), wr: r3(wr), lift: r3(wr - (solo(name) + solo(o)) / 2) }; }).sort((a, b) => b.lift - a.lift);
  const cnt = [...D.VS].filter(([k, x]) => k.startsWith(name + ">") && x.n >= 3).map(([k, x]) => ({ vs: k.split(">")[1], n: r1(x.n), wr: r3((x.w + 3) / (x.n + 6)) })).sort((a, b) => b.wr - a.wr);
  const rk = rankedOf(name);
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
// patches not on Liquipedia yet (config/mlbb-patches.json); Liquipedia's own entry wins once it exists
for (const p of readJSON(path.join(ROOT, "config", "mlbb-patches.json"), { patches: [] }).patches) if (!LP.patches.some((x) => x.patch === p.patch)) LP.patches.push({ patch: p.patch, release: p.release, changes: p.changes, manual: true });
LP.patches.sort((a, b) => (a.release || "").localeCompare(b.release || ""));
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
// Late, Damage, Survival, Push, Crowd control); ranked trend (none at present: mlbb.io gives no week-on-week change).
for (const h of HERO) { const tot = h.roles.reduce((a, r) => a + r.n, 0) || 1; h.laneSplit = h.roles.map((r) => ({ r: r.r, share: r3(r.n / tot) })); h.flex = h.laneSplit.length > 1 && h.laneSplit[1].share >= 0.25;
  const t = h.traits, sc = (x) => x;
  h.ratings = { Teamfight: sc((t.cc + t.tank * 0.6 + t.dmg * 0.4) / 1.4), "Pick-off": sc((t.burst + t.engage) / 1.3), Objectives: sc((t.push + t.dmg * 0.5 + t.tank * 0.3) / 1.0), "Early-mid": sc(0.5 + t.early - t.late * 0.5), Late: sc(0.4 + t.late - t.early * 0.4 + (h.lp?.role === "Marksman" ? 0.2 : 0)), Damage: sc(t.dmg / 1.1), Survival: sc((t.tank + t.sustain * 0.6) / 1.1), Push: sc(t.push / 0.8), "Crowd control": sc(t.cc / 1.1) };
  if (h.ranked) h.rankedTrend = rankedOf(h.id)?.winRateDelta ?? null; }
// ranked (all players) counters from mlbb.io, a background layer kept apart from the pro numbers
{ const RC = readJSON(path.join(MD, "ranked-counters.json"), { heroes: {} }), key = (x) => String(x).toLowerCase().replace(/[^a-z]/g, "");
  const ids = new Map(HERO.map((h) => [key(h.id), h.id])), byKey = new Map(Object.values(RC.heroes).map((v) => [key(v.name), v]));
  for (const h of HERO) { const v = byKey.get(key(h.id)); if (v) h.rankedCounters = { by: v.by.map((x) => ({ h: ids.get(key(x.h)) || x.h, adv: x.adv })), into: v.into.map((x) => ids.get(key(x)) || x), at: v.fetched?.slice(0, 10) }; } }
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
  hs.forEach((hero, i) => { const pl = ro.find((x) => x.role === ROLES[i]); if (!pl) return; const al = palias(pl.page) || palias(pl.player), k = al || pl.page || pl.player; let s = PL.get(k);
    if (!s) PL.set(k, (s = { id: safe(k), page: pl.page && !/does not exist/.test(pl.page) ? pl.page : null, name: al || pl.player, role: pl.role, teams: {}, heroes: {}, games: 0, wins: 0, mvp: 0, last: null }));
    s.games++; if (won) s.wins++; s.teams[team] = (s.teams[team] || 0) + 1; s.team = team; s.role = pl.role; s.last = m.date;
    const hh = (s.heroes[hero] ||= { n: 0, w: 0 }); hh.n++; if (won) hh.w++; });
}
for (const m of done) if (m.mvp) { const s = [...PL.values()].find((x) => x.name.toLowerCase() === m.mvp.toLowerCase() && x.teams[m.a] + x.teams[m.b] > 0) || [...PL.values()].find((x) => x.name.toLowerCase() === m.mvp.toLowerCase()); if (s) s.mvp++; }
// official league stats (MPL PH Data tab, MPL ID Statistics tab): matched by name, letters and digits only
const nk = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const OFF = fs.readdirSync(MD).filter((f) => f.startsWith("official-")).map((f) => readJSON(path.join(MD, f)));
const offPlayer = new Map(), abbr = {};
for (const o of OFF) { const pools = Object.fromEntries(Object.entries(o.pools || {}).map(([k, v]) => [nk(k), v])); for (const p of o.players) offPlayer.set(nk(p.player), { ...p, league: o.league, season: o.season, pool: pools[nk(p.player)]?.slice(0, 12) || null }); }
// player archetype: his role plus what his heroes bring, his pool depth and (where published) his KDA profile
function playerArch(s) {
  const tot = Object.values(s.heroes).reduce((a, v) => a + v.n, 0) || 1, p = Object.fromEntries(TRAITS.map((k) => [k, 0]));
  for (const [h, v] of Object.entries(s.heroes)) for (const k of TRAITS) p[k] += (TR[h]?.[k] || 0) * v.n / tot;
  const A = { EXP: p.tank > 0.75 ? "Tank EXP laner" : p.push > 0.35 ? "Split-push EXP laner" : "Fighter EXP laner", Jungle: p.burst > 0.7 ? "Assassin jungler" : p.tank > 0.55 ? "Tank / fighter jungler" : "Carry jungler", Mid: p.cc > 0.55 ? "Control mage" : p.burst > 0.6 ? "Burst mage" : "Utility mid", Gold: p.late > 0.15 ? "Hypercarry marksman" : p.burst > 0.45 ? "Burst gold laner" : p.tank > 0.4 ? "Fighter gold laner" : "Damage marksman", Roam: p.tank > 0.8 && p.cc > 0.6 ? "Engage roamer" : p.sustain > 0.55 ? "Support roamer" : p.burst > 0.5 ? "Assassin roamer" : "Flex roamer" };
  const out = [A[s.role] || "Flex"]; const pool = Object.values(s.heroes).filter((v) => v.n >= 2).length, top = Math.max(...Object.values(s.heroes).map((v) => v.n)) / tot;
  if (pool >= 10) out.push("Deep hero pool"); else if (top >= 0.3 && tot >= 10) out.push("Specialist");
  return { labels: out, profile: Object.fromEntries(TRAITS.map((k) => [k, Math.round(p[k] * 100) / 100])) };
}
// per-game shares from the official MPL PH match pages (derived file; raw data kept private)
// Season 18 per-player numbers (MPL ID, PH, MY) derived from the MLBBHub scoreboard snapshot, with the real player in each game
const S18 = new Map(["s18-players.json", "mena-s10-players.json"].flatMap((f) => Object.values(readJSON(path.join(MD, f), { players: {} }).players)).map((p) => [nk(p.player), { ...p, heroes: p.heroes.slice(0, 12).map((h) => ({ h: h.h, n: h.n, w: h.w, wr: Math.round((h.w / h.n) * 1000) / 1000 })) }]));
// name matching for the Season 18 numbers: exact, then with repeated letters collapsed ("Morenooo" = "Moreno"), then a
// prefix of 3+ letters ("NETS" = "Netskie") only when the team also agrees (initials or a shared word)
const collapse = (x) => nk(x).replace(/(.)\1+/g, "$1"), S18C = new Map(); for (const p of S18.values()) { const c = collapse(p.player); (S18C.get(c) || S18C.set(c, []).get(c)).push(p); }
const teamWords = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean), initials = (t) => teamWords(t).map((w) => w[0]).join("");
const sameTeam = (a, b) => { const A = teamWords(a), B = teamWords(b), ia = initials(a), ib = initials(b), ja = A.join(""), jb = B.join(""); return A.some((w) => w.length > 2 && B.includes(w)) || ja.startsWith(jb) || jb.startsWith(ja) || ia === jb || ib === ja || ia.startsWith(jb) || ib.startsWith(ja); };
const KHL = readJSON(path.join(MD, "kh-s11-leaders.json"), { players: {} }).players; // MPL KH S11 season top-10 leaderboards (official league page)
const s18Of = (name, team) => { const e = S18.get(nk(name)); if (e) return e; const c = collapse(name), list = S18C.get(c) || [];
  if (list.length === 1) return list[0]; if (list.length > 1) return list.find((p) => sameTeam(p.team, team)) || null;
  if (c.length >= 3) { const hits = [...S18.values()].filter((p) => { const q = collapse(p.player); return q.length >= 3 && (q.startsWith(c) || c.startsWith(q)) && sameTeam(p.team, team); }); if (hits.length === 1) return hits[0]; }
  return null; };
const SH = new Map(Object.values(readJSON(path.join(MD, "shares-ph-s18.json"), { players: {} }).players).map((p) => [nk(p.player), p]));
const playersOut = [...PL.values()].map((s) => ({ page: s.page, arch: playerArch(s), official: offPlayer.get(nk(s.name)) || null, shares: SH.get(nk(s.name)) || null, s18: s18Of(s.name, s.team), leaders: (KHL[nk(s.name)] || Object.values(KHL).find((x) => collapse(x.player) === collapse(s.name)))?.ranks || null, id: s.id, name: s.name, role: s.role, team: s.team, games: s.games, wr: r3(s.wins / s.games), mvp: s.mvp, last: s.last,
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
const ratingOf = (name) => { const t = R.T.get(name); return t ? t.r + (R.REG[t.region] || 0) * P.regW + formOf(t) : 0; };
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
// MPL PH career context (S16 line, all-time record, M-series, top heroes) from derived/mlbb/career-ph.json, attached only to
// players who have played for a Philippine team, so a shared name in another region is never given a PH career
{ const CAR = readJSON(path.join(ROOT, "derived", "mlbb", "career-ph.json"), { players: {} }).players, ck = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); let n = 0;
  for (const p of playersOut) { const c = CAR[ck(p.name)]; if (c && p.teams.some((t) => R.T.get(t.t)?.region === "PH")) { p.career = c; n++; } } console.log(`career context attached to ${n} players`); writeJSON(path.join(OUT, "career-ph.json"), { players: CAR }); }
for (const p of playersOut) writeJSON(path.join(OUT, "players", `${p.id}.json`), p);
writeJSON(path.join(OUT, "players.json"), playersOut.map(({ pool, ...p }) => ({ ...p, top: pool.slice(0, 3) })));
// draft tables for the Draft lab (client-side): hero strength, combos and counters with 3+ games
writeJSON(path.join(OUT, "draft.json"), { traits: TR, avgLineup, shortLong: Object.fromEntries(HERO.filter((h) => h.shortLong).map((h) => [h.id, h.shortLong])), patch: lastPatch ? { patch: lastPatch.patch, release: lastPatch.release } : null, wd: P.wd, scale: { hero: 0.2, syn: 0.1, cnt: 0.04 }, heroes: Object.fromEntries([...D.H].map(([k, v]) => [k, [r1(v.n), r1(v.w)]])), pairs: Object.fromEntries([...D.PAIR].filter(([, v]) => v.n >= 3).map(([k, v]) => [k, [r1(v.n), r1(v.w)]])), vs: Object.fromEntries([...D.VS].filter(([, v]) => v.n >= 3).map(([k, v]) => [k, [r1(v.n), r1(v.w)]])) });
writeJSON(path.join(OUT, "heroes.json"), HERO);

// ---------------------------------------------------------------- projections: upcoming matches and any pairing
// MATCH CONTEXT shown on match pages: experience, career win rate and archetype mix of the listed lineups. Experience and
// archetypes are context only (they did not pass the ideas test); career win rate is in the prediction only while a team's
// rating is uncertain (CW above).
const PEXP = new Map(); { const BIG = /playoff|final|knockout|bracket|upper|lower|elimination/i; for (const m of done) { const big = BIG.test(m.stage || "") || m.kind === "intl"; for (const t of [m.a, m.b]) { const L = lineupOf(t, m.page); if (L) for (const n of L) { const e = PEXP.get(n) || PEXP.set(n, { g: 0, intl: 0, big: 0 }).get(n); e.g += m.games.length; if (m.kind === "intl") e.intl += m.games.length; if (big) e.big += m.games.length; } } } }
const PSI = readJSON(path.join(ROOT, "derived", "mlbb", "pstats", "index.json"), { players: [], archMatrix: [] }), ARCH = new Map();
for (const p of PSI.players) { const k = String(palias(p.p) || p.p).toLowerCase(); if (!ARCH.has(k) || ARCH.get(k).g < p.g) ARCH.set(k, { arch: String(p.arch || "").replace(/\s*\(.*\)$/, ""), conf: p.archConfLabel || null, g: p.g, lg: p.lg }); }
// SMALL NUDGES (the user asked for these signals to count): capped, and labelled on the site as not proven. Measured cost on
// held-out games at these weights: experience -0.00003 Brier, archetype lane matchups -0.0013 (97 games), so both are small.
const EXPW = 0.05, EXPCAP = 0.06, ARCW = 0.3, ARCCAP = 0.06, BIGST = /playoff|final|knockout|bracket|upper|lower|elimination/i, clampN = (v, c) => Math.max(-c, Math.min(c, v));
const cellOf = (a, b) => (PSI.archMatrix || []).find((r) => r.a === a && r.b === b) || null;
function nudgeOf(m, ctx) { if (!ctx) return { exp: 0, arch: 0, total: 0 }; const big = BIGST.test(m.stage || "") || m.kind === "intl", ml = (S) => S.players.reduce((x, q) => x + Math.log1p(q.g), 0) / 5;
  const exp = big ? clampN(EXPW * (ml(ctx.a) - ml(ctx.b)), EXPCAP) : 0; let av = 0; for (const l of ctx.lanes || []) if (l.n) av += (l.wp / 100 - 0.5) * l.n / (l.n + 100); const arch = clampN(ARCW * av, ARCCAP);
  return { exp: r3(exp), arch: r3(arch), total: r3(exp + arch) }; }
let rec0ctx = null;
function contextFor(m) {
  const side = (t) => { const L = lineupOf(t, m.page); if (!L) return null; const ro = rosterFor(t, m.page);
    const players = L.map((n, i) => { const e = PEXP.get(n) || { g: 0, intl: 0, big: 0 }, r = R.PLR.get(n) || { n: 0, w: 0 }, ar = ARCH.get(n); return { n: ro.find((x) => String(palias(x.player) || x.player).toLowerCase() === n)?.player || n, role: Object.keys(ROLEI)[i], g: e.g, intl: e.intl, big: e.big, wr: r.n ? r3((r.w + 10) / (r.n + 20)) : null, arch: ar?.arch || null }; });
    const mix = {}; for (const p of players) if (p.arch) mix[p.arch] = (mix[p.arch] || 0) + 1;
    return { players, g: players.reduce((x, p) => x + p.g, 0), intl: players.reduce((x, p) => x + p.intl, 0), big: players.reduce((x, p) => x + p.big, 0), wr: r3(careerWR(R.PLR, L) + 0.5), mix }; };
  const A = side(m.a), B = side(m.b); if (!A || !B) return null;
  const TA = R.T.get(m.a), TB = R.T.get(m.b), edge = TA && TB ? cwEdge(R.PLR, R.SGc, TA, TB, lineupOf(m.a, m.page), lineupOf(m.b, m.page), seasonOf(m.page)) : 0;
  const cells = []; for (const x of Object.keys(A.mix)) for (const y of Object.keys(B.mix)) { const c = (PSI.archMatrix || []).find((r) => r.a === x && r.b === y); if (c && c.n >= 20) cells.push({ a: x, b: y, wp: c.wp, n: c.n }); }
  cells.sort((p, q) => Math.abs(q.wp - 50) - Math.abs(p.wp - 50));
  const lanes = A.players.map((q, i) => { const o = B.players[i], c = q.arch && o.arch ? cellOf(q.arch, o.arch) : null; return { role: q.role, a: q.arch, aConf: ARCH.get(String(palias(q.n) || q.n).toLowerCase())?.conf || null, b: o.arch, bConf: ARCH.get(String(palias(o.n) || o.n).toLowerCase())?.conf || null, ...(c ? { wp: c.wp, lo: c.lo ?? null, hi: c.hi ?? null, n: c.n } : {}) }; });
  return { a: A, b: B, careerEdge: r3(edge), careerApplied: !!edge, cells: cells.slice(0, 4), lanes };
}
function project(a, b, bo, page, nudge = 0) {
  const TA = R.T.get(a), TB = R.T.get(b), pg = lg((ratingOf(a) - ratingOf(b)) * crossOf(a, b) + (TA && TB ? cwEdge(R.PLR, R.SGc, TA, TB, lineupOf(a, page), lineupOf(b, page), seasonOf(page)) : 0) + nudge), s = series(pg, bo), pa = profile(a), pb = profile(b), sa = sigEffect(a, pa), sb2 = sigEffect(b, pb), scen = [];
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
  rec0ctx = contextFor(m); const ndg = nudgeOf(m, rec0ctx); if (rec0ctx) rec0ctx.nudge = ndg;
  const pr = project(m.a, m.b, m.bo, m.page, ndg.total), n = Math.min(nA(m.a), nA(m.b));
  // the same prediction without the archetype nudge, for the site's archetype on/off switch
  const prN = ndg.arch ? project(m.a, m.b, m.bo, m.page, ndg.total - ndg.arch) : pr, noArch = { pGame: prN.pGame, pSeries: prN.pSeries, scores: prN.scores, expMaps: prN.expMaps };
  // the parts of the single-game chance (logits), so the site's analysis switches can rebuild the odds: ratings, career win
  // rate while ratings settle, big-stage experience, archetype matchups
  const TA0 = R.T.get(m.a), TB0 = R.T.get(m.b), parts = { base: Math.round((ratingOf(m.a) - ratingOf(m.b)) * crossOf(m.a, m.b) * 10000) / 10000, cw: TA0 && TB0 ? Math.round(cwEdge(R.PLR, R.SGc, TA0, TB0, lineupOf(m.a, m.page), lineupOf(m.b, m.page), seasonOf(m.page)) * 10000) / 10000 : 0, exp: ndg.exp, arch: ndg.arch };
  const rec = { context: rec0ctx, noArch, parts, id: m.id, date: m.date, timed: m.timed, league: m.league, stage: m.stage, bo: m.bo, a: m.a, b: m.b, ...pr, confidence: confOf(pr.pSeries, n), records: [R.T.get(m.a)?.w + "-" + R.T.get(m.a)?.l, R.T.get(m.b)?.w + "-" + R.T.get(m.b)?.l] };
  writeJSON(path.join(OUT, "matches", `${m.id}.json`), rec);
  upOut.push({ noArch: { pSeries: noArch.pSeries, pGame: noArch.pGame, expMaps: noArch.expMaps }, parts, id: m.id, date: m.date, timed: m.timed, league: m.league, stage: m.stage, bo: m.bo, a: m.a, b: m.b, pSeries: pr.pSeries, pGame: pr.pGame, expMaps: pr.expMaps, confidence: rec.confidence });
  if (n >= 6) { const fav = pr.pSeries >= 0.5 ? m.a : m.b, pf = Math.min(0.9, Math.max(pr.pSeries, 1 - pr.pSeries)); picks.push({ id: m.id, date: m.date, league: m.league, kind: "series", pick: `${fav} to win the series`, p: r3(pf), game: `${m.a} vs ${m.b}` });
    if (pr.over != null) picks.push({ id: m.id, date: m.date, league: m.league, kind: "maps", pick: `${pr.over >= 0.5 ? "Over" : "Under"} ${pr.mapsLine} maps`, p: r3(Math.min(0.85, Math.max(pr.over, 1 - pr.over))), game: `${m.a} vs ${m.b}` }); }
}
for (const p of picks) if (p.p < 0.6) { p.noPick = true; p.why = "Too close to call: under 60%."; }
picks.sort((a, b) => b.p - a.p);
writeJSON(path.join(OUT, "upcoming.json"), upOut);
writeJSON(path.join(OUT, "picks.json"), { note: "Our own lines from the series math (game chance from team ratings). Capped at 90% (maps 85%) and only for teams with 6+ series in our data; under 60% is listed as too close to call. No sportsbook data.", picks });

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
  const LG = {}, cut = now - 150 * DAY, LEN = {};
  for (const m of done) { if (Date.parse(m.date) <= cut || m.kind === "intl") continue; const L = (LG[m.league] ||= { games: 0, blue: [0, 0], b1: {}, b2: {}, h: {} });
    for (const g of m.games) { L.games++; { const sec = secs(g.len); if (sec) (LEN[m.league] ||= []).push(sec / 60); } if (g.side1 === "blue" || g.side1 === "red") { L.blue[1]++; if ((g.side1 === "blue") === (g.w === 1)) L.blue[0]++;
        const [bb, rb] = g.side1 === "blue" ? [g.b1, g.b2] : [g.b2, g.b1]; if (bb[0]) L.b1[bb[0]] = (L.b1[bb[0]] || 0) + 1; if (rb[0]) L.b2[rb[0]] = (L.b2[rb[0]] || 0) + 1; }
      for (const [hs, bs, w] of [[g.h1, g.b1, g.w === 1], [g.h2, g.b2, g.w === 2]]) { for (const h of hs) { const v = (L.h[h] ||= { p: 0, w: 0, b: 0 }); v.p++; if (w) v.w++; } for (const h of bs) { const v = (L.h[h] ||= { p: 0, w: 0, b: 0 }); v.b++; } } } }
  const top5 = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, n]) => ({ h, n }));
  const med = (xs) => { if (!xs?.length) return null; const a = [...xs].sort((x, y) => x - y); return Math.round(a[Math.floor(a.length / 2)] * 10) / 10; };
  const leagues = Object.entries(LG).filter(([, L]) => L.games >= 20).map(([lg2, L]) => ({ league: lg2, games: L.games, medianMin: med(LEN[lg2]), blue: L.blue, b1: top5(L.b1), b2: top5(L.b2),
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
// why a series was missed: how sure we were, the drafts in the games the favourite lost, its signature hero banned,
// a deciding game, a cross-region match
const SIG = new Map(teamsOut.filter((t) => t.signature).map((t) => [t.name, t.signature.hero]));
function whyMissed(x) {
  const aFav = x.pS >= 0.5, fav = aFav ? x.A : x.B, dog = aFav ? x.B : x.A, fp = Math.max(x.pS, 1 - x.pS), out = [];
  out.push(fp < 0.6 ? `close to a coin flip: we gave ${fav} only ${Math.round(fp * 100)}%` : fp >= 0.75 ? `a real upset: ${fav} were ${Math.round(fp * 100)}% favourites` : `${dog} won as the underdog (${Math.round((1 - fp) * 100)}%)`);
  const lost = x.m.games.filter((g) => (g.w === 1) !== aFav); let draftLost = 0, sigBanned = 0; const sig = SIG.get(fav);
  for (const g of lost) { const gx = GAMEX.get(g); if (gx && g.h1.every(Boolean) && g.h2.every(Boolean)) { const v = lg(gx.base) - lg(gx.pre); if ((aFav ? -v : v) >= 0.01) draftLost++; } /* the draft tables as they stood before that game */ if (sig && [...(aFav ? g.b2 : g.b1)].includes(sig)) sigBanned++; }
  if (draftLost) out.push(`our draft model favoured ${dog}'s picks in ${draftLost} of the ${lost.length} games ${fav} lost`);
  if (sigBanned) out.push(`${fav}'s signature ${cap1(sig)} was banned in ${sigBanned} of those games`);
  const [s1, s2] = x.m.score; if (x.m.bo > 1 && Math.abs(s1 - s2) === 1 && s1 + s2 === x.m.bo) out.push("lost the deciding game");
  if (x.m.kind === "intl" && R.T.get(x.A)?.region !== R.T.get(x.B)?.region) out.push("cross-region match: ratings between regions are less certain");
  return out.join("; ");
}
// each game's own pre-game win chance (ratings + draft, walk-forward: made before that game was played)
const GAMEP = new Map(ALLG.map((x) => [x.g, lg(x.base)])), GAMEX = new Map(ALLG.map((x) => [x.g, x]));
// one game, in plain words: ratings before the draft, what the drafts changed and why, the side, the length, and our call
const mmss = (t) => { const [a, b] = String(t || "").split(":").map(Number); return isFinite(a) ? a + (b || 0) / 60 : null; };
function gameNotes(x, g) { const gx = GAMEX.get(g); if (!gx) return null; const A = x.A, B = x.B, pre = lg(gx.pre), post = lg(gx.base), wA = g.w === 1, notes = [];
  const drafted = g.h1?.every(Boolean) && g.h2?.every(Boolean);
  if (drafted) { const [h, sy, c] = gx.dr, tot = h + sy + c, side = tot >= 0 ? A : B, parts = [[h, "hero strength in the current meta"], [sy, "combos on the same side"], [c, "counter match-ups"]].filter(([v]) => Math.sign(v) === Math.sign(tot) && Math.abs(v) > 0.01).sort((p2, q) => Math.abs(q[0]) - Math.abs(p2[0])).map(([, l]) => l);
    const mv = Math.round((post - pre) * 1000) / 10;
    notes.push(Math.abs(mv) < 1 ? "the drafts were about even" : `the drafts favoured ${side} (${mv > 0 ? "+" : ""}${mv} points for ${A})${parts.length ? `, mainly ${parts.join(" and ")}` : ""}`);
    if ((pre >= 0.5) !== (post >= 0.5)) notes.push(`the draft swung our call: ratings favoured ${pre >= 0.5 ? A : B}, both drafts together favoured ${post >= 0.5 ? A : B}`);
    const sigW = SIG.get(wA ? A : B), sigL = SIG.get(wA ? B : A);
    if (sigW && (wA ? g.h1 : g.h2).includes(sigW)) notes.push(`${wA ? A : B} got their signature ${cap1(sigW)}`);
    if (sigL && (wA ? g.b1 : g.b2).includes(sigL)) notes.push(`${wA ? B : A}'s signature ${cap1(sigL)} was banned`);
  } else notes.push("no draft recorded for this game, so the call used ratings only");
  const len = mmss(g.len); if (len != null) notes.push(len < 12 ? `a fast game (${g.len}): early pressure decided it` : len >= 18 ? `a long game (${g.len}): it went to the late game` : `a mid-length game (${g.len})`);
  const hit = (post >= 0.5) === wA; notes.push(hit ? `our call held: ${post >= 0.5 ? A : B} at ${Math.round(Math.max(post, 1 - post) * 100)}%` : Math.max(post, 1 - post) < 0.56 ? `close to a coin flip (${Math.round(Math.max(post, 1 - post) * 100)}%), and it went the other way` : `an upset: ${post >= 0.5 ? A : B} were ${Math.round(Math.max(post, 1 - post) * 100)}% favourites for this game`);
  return { pre: r3(pre), post: r3(post), notes }; }
function whyHit(x) {
  const aFav = x.pS >= 0.5, fav = aFav ? x.A : x.B, dog = aFav ? x.B : x.A, fp = Math.max(x.pS, 1 - x.pS), out = [];
  out.push(fp >= 0.75 ? `a clear favourite delivered: we gave ${fav} ${Math.round(fp * 100)}%` : fp >= 0.6 ? `${fav} won as the favourite (${Math.round(fp * 100)}%)` : `a close call went our way: ${fav} at ${Math.round(fp * 100)}%`);
  const won = x.m.games.filter((g) => (g.w === 1) === aFav); let draftWon = 0, sigPlayed = 0; const sig = SIG.get(fav);
  for (const g of won) { const pg = GAMEP.get(g); if (pg != null && (aFav ? pg : 1 - pg) > 0.5) draftWon++; if (sig && (aFav ? g.h1 : g.h2).includes(sig)) sigPlayed++; }
  if (draftWon) out.push(`our game-by-game picks (ratings plus both drafts) also favoured ${fav} in ${draftWon} of the ${won.length} games they won`);
  if (sigPlayed) out.push(`${fav} got their signature ${cap1(sig)} in ${sigPlayed} of those wins`);
  const [s1, s2] = x.m.score; if (x.m.bo > 1 && Math.min(s1, s2) === 0) out.push(`a clean sweep: ${dog} did not take a game`); else if (x.m.bo > 1 && Math.abs(s1 - s2) === 1 && s1 + s2 === x.m.bo) out.push("won the deciding game");
  return out.join("; ");
}
const results = R.log.map((x) => { const right = (x.pS >= 0.5) === (x.m.score[0] > x.m.score[1]); return { id: safe(x.m.id), date: x.m.date, league: x.m.league, stage: x.m.stage, bo: x.m.bo, a: x.A, b: x.B, score: x.m.score, pSeries: r3(x.pS), graded: x.warm, right, mvp: x.m.mvp, ...(right ? { whyHit: whyHit(x) } : { why: whyMissed(x) }) }; }).reverse();
// HISTORY: every finished series, with every game (drafts, sides, length, winner) and our predictions before the series and
// before each game. history.json is the index; series/<id>.json holds one series.
{ fs.rmSync(path.join(OUT, "series"), { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, "series"), { recursive: true });
  const idx = [];
  for (const x of R.log) { const id = safe(x.m.id), right = (x.pS >= 0.5) === (x.m.score[0] > x.m.score[1]);
    idx.push([id, x.m.date, x.m.league, x.m.stage, x.A, x.B, x.m.score[0], x.m.score[1], r3(x.pS), x.warm ? 1 : 0, right ? 1 : 0]);
    writeJSON(path.join(OUT, "series", id + ".json"), { id, date: x.m.date, league: x.m.league, stage: x.m.stage, bo: x.m.bo, a: x.A, b: x.B, score: x.m.score, pSeries: r3(x.pS), graded: x.warm, right, mvp: x.m.mvp || null, why: right ? whyHit(x) : whyMissed(x),
      games: x.m.games.map((g) => { const pg = GAMEP.get(g), an = gameNotes(x, g); return { n: g.n, w: g.w, len: g.len || null, map: g.map || null, side1: g.side1 || null, pA: pg == null ? null : r3(pg), pre: an?.pre ?? null, notes: an?.notes || [], h1: g.h1, h2: g.h2, b1: g.b1, b2: g.b2 }; }) }); }
  writeJSON(path.join(OUT, "history.json"), idx.reverse()); }
writeJSON(path.join(OUT, "results.json"), results.slice(0, 400));
// LEARNING LEDGER (after every game and every refresh). Every finished game updates team ratings, the hero/combo/counter
// tables and player career records before the next game is predicted; every refresh re-tunes the settings on all history.
// The settings and accuracy are saved once a day in data/mlbb/learning-history.json (kept between runs), so the page can
// show how the model has moved over time.
{ const G = R.log.filter((x) => x.warm), wk = (d) => { const t = new Date(d); t.setUTCHours(0, 0, 0, 0); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  const right = (x) => (x.pS >= 0.5) === (x.m.score[0] > x.m.score[1]), won = (x) => (x.m.score[0] > x.m.score[1] ? 1 : 0);
  const weeks = new Map(); for (const x of G) { if (!x.m.date) continue; const k = wk(x.m.date), w = weeks.get(k) || weeks.set(k, { week: k, n: 0, right: 0, brier: 0 }).get(k); w.n++; w.right += right(x) ? 1 : 0; w.brier += (x.pS - won(x)) ** 2; }
  let cn = 0, cr = 0; const timeline = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => { cn += w.n; cr += w.right; return { week: w.week, n: w.n, acc: r3(w.right / w.n), brier: r3(w.brier / w.n), cumAcc: r3(cr / cn) }; }).slice(-60);
  const cal = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([lo, hi]) => { const rows = G.map((x) => (x.pS >= 0.5 ? { p: x.pS, y: won(x) } : { p: 1 - x.pS, y: 1 - won(x) })).filter((r) => r.p >= lo && r.p < hi); return { bucket: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: rows.length, said: rows.length ? r3(rows.reduce((a, r) => a + r.p, 0) / rows.length) : null, won: rows.length ? r3(rows.reduce((a, r) => a + r.y, 0) / rows.length) : null }; });
  const byL = new Map(); for (const x of G) { const k = x.m.league, v = byL.get(k) || byL.set(k, { league: k, n: 0, right: 0, brier: 0, last: null }).get(k); v.n++; v.right += right(x) ? 1 : 0; v.brier += (x.pS - won(x)) ** 2; if (!v.last || x.m.date > v.last) v.last = x.m.date; }
  const leagues = [...byL.values()].filter((v) => v.n >= 10).map((v) => ({ league: v.league, n: v.n, acc: r3(v.right / v.n), brier: r3(v.brier / v.n), last: v.last })).sort((a, b) => (b.last || "").localeCompare(a.last || "")).slice(0, 14);
  const last = (days) => { const cut = new Date(now - days * DAY).toISOString(); const rows = G.filter((x) => x.m.date >= cut); return { n: rows.length, right: rows.filter(right).length }; };
  const moverCut = new Date(now - 7 * DAY).toISOString(), movers = [...R.T.values()].filter((t) => t.hist?.length && t.hist.at(-1)[0] >= moverCut).map((t) => { const before = [...t.hist].reverse().find(([d]) => d < moverCut)?.[1] ?? 0, after = t.hist.at(-1)[1]; return { team: t.name, region: t.region, from: Math.round(1500 + before * 173.7), to: Math.round(1500 + after * 173.7), change: Math.round((after - before) * 173.7) }; }).filter((x) => x.change).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10);
  const lessons = results.filter((x) => x.graded && !x.right).slice(0, 10).map((x) => ({ date: x.date, league: x.league, a: x.a, b: x.b, score: x.score, pSeries: x.pSeries, why: x.why }));
  const today = new Date(now).toISOString().slice(0, 10), HF = path.join(MD, "learning-history.json"), hist = readJSON(HF, []).filter((h) => h.date !== today);
  hist.push({ date: today, k: P.k, carry: P.carry, cx: P.cx, wd: P.wd, cw: CW, series: R.n, games: R.gn, brier: r3(R.brier), acc: r3(R.acc), gBrier: r3(R.gBrierDraft), regions: Object.fromEntries(Object.entries(R.REG).map(([k, v]) => [k, r3(v)])) });
  writeJSON(HF, hist.slice(-120));
  writeJSON(path.join(OUT, "learning.json"), { built: new Date(now).toISOString(), series: R.n, games: R.gn, acc: r3(R.acc), brier: r3(R.brier), gBrier: r3(R.gBrierDraft), heroes: HERO.length, last7: last(7), last30: last(30), timeline, calibration: cal, leagues, movers, lessons, history: hist.slice(-30) }); }
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
// ---------------------------------------------------------------- PLAYBOOK and PATCH TRACKER
// Plain rules from our own Liquipedia games, each with its evidence: the rate, the games behind it and a 95% range
// (Wilson). SOLID = the range clears the reference (50%, or the other group); LEAD = it points that way but does not.
{
  const wil = (k, n) => { if (!n) return [0, 1]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [r3((c - r) / d), r3((c + r) / d)]; };
  const ev = (k, n) => { const ci = wil(k, n); return { k, n, rate: n ? r3(k / n) : null, lo: ci[0], hi: ci[1], tag: ci[0] > 0.5 || ci[1] < 0.5 ? "solid" : "lead" }; };
  const yr = done.filter((m) => Date.parse(m.date) > now - 365 * DAY), rules = [];
  // sides
  let bw = 0, bn = 0; const byMap = {}, byLg = {};
  for (const m of yr) for (const g of m.games) { if (g.side1 !== "blue" && g.side1 !== "red") continue; const blueWon = (g.side1 === "blue") === (g.w === 1); bn++; if (blueWon) bw++;
    if (g.map) { const v = (byMap[g.map.trim()] ||= [0, 0]); v[1]++; if (blueWon) v[0]++; } if (m.kind === "league") { const v = (byLg[m.league] ||= [0, 0]); v[1]++; if (blueWon) v[0]++; } }
  const mapsE = Object.entries(byMap).filter(([, v]) => v[1] >= 30).map(([k, v]) => ({ name: k, ...ev(v[0], v[1]) })).sort((a, b) => b.rate - a.rate);
  const lgE = Object.entries(byLg).filter(([, v]) => v[1] >= 60).map(([k, v]) => ({ name: k, ...ev(v[0], v[1]) })).sort((a, b) => b.rate - a.rate);
  const all = ev(bw, bn);
  rules.push({ id: "sides", group: "Sides", title: all.tag === "solid" ? "First pick (blue side) is a real but small edge" : "First pick (blue side) is close to a coin flip overall",
    stats: [{ v: all.rate, l: `blue side, all games (${all.n})`, ...all }, ...(mapsE[0] ? [{ v: mapsE[0].rate, l: `on ${mapsE[0].name} (${mapsE[0].n})`, ...mapsE[0] }] : []), ...(lgE[0] ? [{ v: lgE[0].rate, l: `in ${lgE[0].name} (${lgE[0].n})`, ...lgE[0] }] : [])],
    tag: all.tag, use: "check the league and the map event before trusting a side edge; across all games it is small.", detail: { maps: mapsE, leagues: lgE } });
  // series
  let lt = 0, ltn = 0, same = 0, sn = 0;
  for (const m of yr) { const gs = m.games.filter((g) => g.w === 1 || g.w === 2); for (let i = 1; i < gs.length; i++) { const prev = gs[i - 1].w; sn++; if (gs[i].w === prev) same++; if (gs[i].side1 === "blue" || gs[i].side1 === "red") { ltn++; const loser = prev === 1 ? 2 : 1; if ((gs[i].side1 === "blue") === (loser === 1)) lt++; } } }
  const ltE = ev(lt, ltn), sameE = ev(same, sn), momPts = Math.round((lg(momFit.b) - 0.5) * 1000) / 10;
  rules.push({ id: "series", group: "Series", title: "The last winner usually wins again, mostly because it is the better team", stats: [{ v: ltE.rate, l: `loser takes first pick next game (${ltE.n})`, ...ltE }, { v: sameE.rate, l: `last winner wins the next game (${sameE.n})`, ...sameE }, { v: null, text: `+${momPts} pts`, l: "extra edge after team strength", tag: momFit.lrStat >= 3.84 ? "solid" : "lead" }],
    tag: "solid", use: "in a live series, update on the score but do not add much extra for momentum: the ratings already explain most of it." });
  // draft order (first-pick lane), from the saved summary
  const ORDS = readJSON(path.join(MD, "draft-order.json"), null);
  if (ORDS?.roles?.Roam && ORDS.roles.Mid) { const R = ORDS.roles.Roam, M = ORDS.roles.Mid, sig = (x) => x.lr >= 3.84;
    rules.push({ id: "order", group: "Draft order", title: "Open the draft with a roam, not a mid laner", tag: sig(R) && sig(M) ? "lead" : "lead",
      stats: [{ v: R.rate, l: `roam first (${R.n} games; ratings expected ${Math.round(R.expected * 100)}%)`, lo: R.lo, hi: R.hi, tag: sig(R) ? "solid" : "lead" }, { v: M.rate, l: `mid first (${M.n} games; ratings expected ${Math.round(M.expected * 100)}%)`, lo: M.lo, hi: M.hi, tag: sig(M) ? "solid" : "lead" }, ...(ORDS.roles.Jungle ? [{ v: ORDS.roles.Jungle.rate, l: `jungle first (${ORDS.roles.Jungle.n} games)`, lo: ORDS.roles.Jungle.lo, hi: ORDS.roles.Jungle.hi, tag: "lead" }] : [])],
      use: "with the first pick, lock the roam (or a contested roam/EXP flex) and keep the mid hidden; both effects survive team ratings but only just, so treat it as a lead.", detail: { order: ORDS } }); }
  // heroes: popular is not strong
  const rec = HERO.filter((h) => h.recent.picks >= 40 && h.recent.wr != null).map((h) => { const w = Math.round(h.recent.wr * h.recent.picks); return { h: h.id, pres: h.recent.presence, ...ev(w, h.recent.picks) }; });
  const popular = [...rec].sort((a, b) => b.pres - a.pres).slice(0, 3), weak = [...rec].sort((a, b) => a.rate - b.rate).slice(0, 3), strong = [...rec].sort((a, b) => b.rate - a.rate).slice(0, 3);
  rules.push({ id: "popular", group: "Heroes", title: "Popular is not the same as strong", stats: popular.map((x) => ({ v: x.rate, l: `${x.h}: ${Math.round(x.pres * 100)}% picked or banned, ${x.n} picks`, hero: x.h, ...x })), tag: popular.some((x) => x.tag === "solid") ? "solid" : "lead",
    use: "do not rate a draft higher just because it has the most contested heroes.", detail: { weak, strong } });
  // bans
  const top2 = [...HERO].sort((a, b) => b.recent.presence - a.recent.presence).slice(0, 2);
  rules.push({ id: "bans", group: "Heroes", title: `${cap1(top2[0]?.id)} and ${cap1(top2[1]?.id)} decide the ban phase`, stats: top2.map((h) => ({ v: h.recent.presence, l: `${h.id} picked or banned (${h.recent.picks} picks, ${h.recent.bans} bans)`, hero: h.id, tag: "solid" })), tag: "solid", use: "if either gets through the bans, expect the draft chance to move." });
  // lanes
  const lanes = HERO.filter((h) => h.bestLane && h.bestLane.length > 1 && h.bestLane[0].n >= 20 && h.bestLane[1].n >= 20 && h.bestLane[0].wr - h.bestLane[1].wr >= 0.05).map((h) => { const [a, b] = h.bestLane; const sep = wil(a.w, a.n)[0] > wil(b.w, b.n)[1]; return { h: h.id, a, b, tag: sep ? "solid" : "lead" }; }).sort((x, y) => (y.a.wr - y.b.wr) - (x.a.wr - x.b.wr)).slice(0, 4);
  if (lanes.length) rules.push({ id: "lanes", group: "Lanes", title: "Some flex heroes win more in one lane", stats: lanes.slice(0, 3).map((x) => ({ v: x.a.wr, l: `${x.h} ${x.a.r} (${x.b.r} ${Math.round(x.b.wr * 100)}%)`, hero: x.h, tag: x.tag })), tag: lanes.some((x) => x.tag === "solid") ? "solid" : "lead", use: "score a flex hero by the lane it is actually played in.", detail: { lanes } });
  // timing
  const tim = HERO.filter((h) => h.timing), early = tim.filter((h) => h.timing.tempo >= 0.08).sort((a, b) => b.timing.tempo - a.timing.tempo).slice(0, 5), late = tim.filter((h) => h.timing.tempo <= -0.08).sort((a, b) => a.timing.tempo - b.timing.tempo).slice(0, 5);
  const lens = yr.flatMap((m) => m.games.map((g) => secs(g.len)).filter(Boolean)).sort((a, b) => a - b), median = lens.length ? Math.round(lens[Math.floor(lens.length / 2)] / 6) / 10 : null;
  writeJSON(path.join(OUT, "playbook.json"), { note: "Our own Liquipedia games, last 365 days (heroes: last 150 days). 95% ranges by the Wilson method.", games: yr.reduce((a, m) => a + m.games.length, 0), rules,
    timing: { median, early: early.map((h) => ({ h: h.id, short: h.timing.short, long: h.timing.long })), late: late.map((h) => ({ h: h.id, short: h.timing.short, long: h.timing.long })) },
    cannot: "Draft order (which lane to pick first) is not measured: Liquipedia lists each team's picks by role, not in the order they were made." });
  // patch tracker: watch list, did the last real patch change anything, risers and fallers by date
  const real = LP.patches.filter((p) => !p.manual && Date.parse(p.release) <= now), prevP = real.at(-1), cutP = prevP ? Date.parse(prevP.release) : now - 60 * DAY;
  const win2 = (h, from, to) => { let w = 0, n = 0; for (const m of done) { const t = Date.parse(m.date); if (t < from || t >= to) continue; for (const g of m.games) { if (g.h1.includes(h)) { n++; if (g.w === 1) w++; } if (g.h2.includes(h)) { n++; if (g.w === 2) w++; } } } return [w, n]; };
  const changed = (prevP?.changes || []).map((c) => { const b = win2(c.hero, cutP - 90 * DAY, cutP), a = win2(c.hero, cutP, now + DAY); return { h: c.hero, type: c.type, before: ev(b[0], b[1]), after: ev(a[0], a[1]) }; }).filter((x) => x.before.n + x.after.n > 0);
  const moves = HERO.map((h) => { const b = win2(h.id, cutP - 90 * DAY, cutP), a = win2(h.id, cutP, now + DAY); return { h: h.id, before: ev(b[0], b[1]), after: ev(a[0], a[1]) }; }).filter((x) => x.before.n >= 20 && x.after.n >= 20).map((x) => ({ ...x, d: r3(x.after.rate - x.before.rate) }));
  const sepd = (x) => x.after.lo > x.before.hi || x.after.hi < x.before.lo;
  writeJSON(path.join(OUT, "patch.json"), { cut: prevP ? { patch: prevP.patch, release: prevP.release } : null, current: lastPatch ? { patch: lastPatch.patch, release: lastPatch.release, manual: !!lastPatch.manual } : null,
    patches: LP.patches.slice(-6).reverse().map((p) => ({ patch: p.patch, release: p.release, manual: !!p.manual, changes: p.changes })),
    watch: HERO.filter((h) => h.untested || (lastPatch && h.patches?.some((p) => p.patch === lastPatch.patch))).map((h) => ({ h: h.id, picks: h.thisPatch?.picks || 0, type: h.patches.find((p) => p.patch === lastPatch.patch)?.type || "" })),
    changed, risers: moves.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5).map((x) => ({ ...x, tag: sepd(x) ? "solid" : "lead" })), fallers: moves.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5).map((x) => ({ ...x, tag: sepd(x) ? "solid" : "lead" })),
    note: "Before = 90 days before the patch date; after = since. Heroes need 20+ pro games on each side." });
}
{ const SHT = readJSON(path.join(MD, "team-short.json"), {}), out = {}; for (const t of teamsOut) { const s2 = SHT[t.name] || Object.entries(SHT).find(([k]) => k.toLowerCase() === t.name.toLowerCase())?.[1]; if (s2) out[t.name] = s2; } writeJSON(path.join(OUT, "short.json"), out); }
// Player Stats tab: derived files from scripts/mlbb/derive-pstats.mjs, copied as they are
{ const PS = path.join(ROOT, "derived", "mlbb", "pstats"); if (fs.existsSync(PS)) { fs.rmSync(path.join(OUT, "pstats"), { recursive: true, force: true }); fs.cpSync(PS, path.join(OUT, "pstats"), { recursive: true }); } }
writeJSON(path.join(OUT, "meta.json"), { momentum: momFit, patch: lastPatch ? { patch: lastPatch.patch, release: lastPatch.release, changes: lastPatch.changes } : null, patches: LP.patches.slice(-8).reverse().map((p) => ({ patch: p.patch, release: p.release, changes: p.changes.length })), built: new Date().toISOString(), series: done.length, games: totalGames, teams: teamsOut.length, players: playersOut.length, heroes: HERO.length, upcoming: upOut.length, leagues: [...new Set(EVENTS.map((e) => e.league))], ratingScale: "Elo-style: 1500 average, 100 points = about 64% in a single game",
  roles: ROLES, source: "Liquipedia (CC-BY-SA) for matches, drafts and rosters; mlbb.io for ranked-game hero rates and counters. No betting data." });
console.log(`wrote ${upOut.length} upcoming, ${teamsOut.length} teams, ${playersOut.length} players, ${HERO.length} heroes, ${picks.length} picks`);
