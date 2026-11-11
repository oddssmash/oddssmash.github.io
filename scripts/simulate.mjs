// Multi-scenario Monte Carlo simulation, high-confidence board, calibration and
// rest-of-season simulation. Runs after scripts/model.mjs:
//
//   node scripts/simulate.mjs
//
// Reads  public/data (projections, past projection pages, results, teams), data/games,
//        data/pbp, data/schedule, data/pregame.json (inactive lists).
// Writes public/data/sim/<gameId>.json, public/data/sim/index.json, public/data/board.json,
//        public/data/season.json, public/data/simcal.json, data/sim-cache.json (calibration cache)
//        and, when data/odds.json exists, the display copy public/data/odds.json.
//
// Betting lines never feed the simulation: data/odds.json is opened only by
// scripts/lib/simodds.mjs, after a game's simulations are finished, to add a separate
// "for comparison only" block.
//
// Environment:
//   SIM_N=10000        simulations per upcoming game
//   SIM_CAL_N=600      simulations per past game in the walk-forward calibration
//   SIM_PILOT=300      pilot simulations per game (measure the engine's own spread first)
//   SIM_SEED=20261111  base seed (each game's seed = hash(base seed, game id))
//   SIM_CAL=on|off|fresh  off keeps the previous simcal.json; fresh ignores the cache
//   SIM_SEASON_N=20000 simulated seasons
//   SIM_GAMES=id,id    only these upcoming games (testing)
import fs from "node:fs";
import path from "node:path";
import { DATA, PUBLIC_DATA, readJSON, writeJSON } from "./lib/util.mjs";
import { createHistory, S } from "./lib/simhist.mjs";
import { buildGame, simulate, shockFor, minutesScale, regStats, tieRateFor, ST, FLAG } from "./lib/simcore.mjs";
import { loadBoxes, loadFlow, loadPage, pastInput, upcomingInput, inactiveFor } from "./lib/simdata.mjs";
import { makeRng, hashSeed } from "./lib/simrng.mjs";
import { summarize, DIST_COLS } from "./lib/simsum.mjs";
import { markets, boardPicks, settle, folded, FAMILIES, BANDS, BOARD_BANDS, bandOf, bandLabel, BOARD_MIN, BOARD_PLAYER_MIN, PLAYER_MIN_FOR_MARKETS, GRID } from "./lib/simmarkets.mjs";
import { loadOdds, publishOddsCopy, comparison, boardComparison, COMPARISON_LABEL } from "./lib/simodds.mjs";
import { seasonSim } from "./lib/simseason.mjs";

// The calibration cache is keyed on the engine code: any change to the simulator's source files
// (engine, history, markets, inputs, random numbers) starts a fresh cache automatically.
const ENGINE_NAME = "courtside-sim 1.0";
const ENGINE_SRC = ["simcore.mjs", "simhist.mjs", "simmarkets.mjs", "simdata.mjs", "simrng.mjs"]
  .map((f) => { try { return fs.readFileSync(new URL(`./lib/${f}`, import.meta.url), "utf8"); } catch { return f; } });
const ENGINE = `${ENGINE_NAME} #${hashSeed(...ENGINE_SRC).toString(16)}`;
const env = (k, d) => (process.env[k] != null && process.env[k] !== "" ? process.env[k] : d);
const cfg = {
  N: Number(env("SIM_N", 10000)), calN: Number(env("SIM_CAL_N", 600)), pilot: Number(env("SIM_PILOT", 300)), calPilot: 150,
  seed: Number(env("SIM_SEED", 20261111)), cal: env("SIM_CAL", "on"), seasonN: Number(env("SIM_SEASON_N", 20000)),
  only: env("SIM_GAMES", "") ? new Set(env("SIM_GAMES", "").split(",").map((s) => s.trim())) : null,
  warmup: 100,
};
const T0 = Date.now();
const lap = (msg) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}`);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);

const meta = readJSON(path.join(PUBLIC_DATA, "meta.json"), {});
const teamsPub = readJSON(path.join(PUBLIC_DATA, "teams.json"), []);
const abbrOf = new Map(teamsPub.map((t) => [String(t.id), t.abbr]));
const results = readJSON(path.join(PUBLIC_DATA, "results.json"), []);
const upcoming = readJSON(path.join(PUBLIC_DATA, "upcoming.json"), []);
const pregame = readJSON(path.join(DATA, "pregame.json"), {});
const resultById = new Map(results.map((r) => [String(r.id), r]));
const generated = new Date().toISOString();
const dataUpdated = meta.updated || null;

function runGame(G, params, N, pilotN, seed) {
  const rng = makeRng(seed);
  // pilot 0: no pace noise (measures the minutes spread and the engine's spread without pace)
  const p0 = simulate(G, { ...params, paceSd: 0 }, pilotN, rng, {});
  const minScale = minutesScale(G, p0, params);
  // pilot 1: full engine. Pace noise is the shared part of both scores; if the engine already makes
  // the two scores move together more than real games do, the pace noise is scaled down
  const p1 = simulate(G, params, pilotN, rng, { minScale });
  const s0 = regStats(p0), s1 = regStats(p1);
  let f2 = 1;
  if (s1.c > params.cov.ha && s1.c > s0.c) f2 = Math.max(0.1, Math.min(1, (params.cov.ha - s0.c) / (s1.c - s0.c)));
  const PP = f2 < 1 ? { ...params, paceSd: params.paceSd * Math.sqrt(f2) } : params;
  const intr = { vh: s0.vh + f2 * (s1.vh - s0.vh), va: s0.va + f2 * (s1.va - s0.va), c: s0.c + f2 * (s1.c - s0.c) };
  const sk = shockFor(PP, p1, G, intr);
  // pilot 2: how often a big lead stands after three quarters (centres the blowout minutes)
  const p2 = simulate(G, PP, pilotN, rng, { shock: sk.shock, baseSh: sk.baseSh, minScale });
  const blow = shockFor(PP, p2, G).blow;
  const tieRate = tieRateFor(PP, p2);
  const out = simulate(G, PP, N, rng, { shock: sk.shock, baseSh: sk.baseSh, blow, minScale, tieRate });
  return { out, sk, blow, minScale, paceScale: Math.sqrt(f2), tieRate };
}

// every parameter the engine reads (the descriptive `hist` block is left out); typed arrays as plain lists
function paramsDigest(p) {
  const { hist, ...rest } = p;
  return String(hashSeed(JSON.stringify(rest, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v))));
}

// ---------- 1. walk forward through every finished game: calibration + history ----------
const boxes = loadBoxes();
lap(`${boxes.length} finished box scores`);
const hist = createHistory();
const cachePath = path.join(DATA, "sim-cache.json");
let cache = cfg.cal === "fresh" ? null : readJSON(cachePath, null);
if (!cache || cache.engine !== ENGINE || cache.calN !== cfg.calN) cache = { engine: ENGINE, calN: cfg.calN, games: {} };
const doCal = cfg.cal !== "off";
const calRecs = [];
let nonPre = 0, simulatedNow = 0, fromCache = 0;
for (let i = 0; i < boxes.length;) {
  let j = i; while (j < boxes.length && boxes[j].date === boxes[i].date) j++;
  const group = boxes.slice(i, j).map((b) => ({ b, page: resultById.has(String(b.id)) ? loadPage(b.id) : null }));
  let params = null, pDigest = null;
  for (const { b, page } of group) {
    const r = resultById.get(String(b.id));
    if (!page || !r || r.pk.endsWith("-1")) continue;
    nonPre++;
    if (!doCal || nonPre <= cfg.warmup) continue;
    if (!params) { params = hist.params(); pDigest = paramsDigest(params); }
    const src = pastInput(page);
    // key = projection rows + every engine parameter + the shooting rates of these players as known now
    const rates = hashSeed(JSON.stringify(src.players.map((p) => hist.playerRates(p.id, p.pos))));
    const fp = `${hashSeed(JSON.stringify(src.players.map((p) => [p.id, p.min, p.pts, p.reb, p.ast, p.tpm, p.tpa])), src.hs, src.as, src.pace)}|${pDigest}|${rates}`;
    const hit = cache.games[b.id];
    if (hit && hit.fp === fp) { calRecs.push(hit); fromCache++; continue; }
    const G = buildGame(src, (row) => hist.playerRates(row.id, row.pos), params);
    const { out } = runGame(G, params, cfg.calN, cfg.calPilot, hashSeed(cfg.seed, b.id, "cal"));
    calRecs.push((cache.games[b.id] = calibrateOne(G, out, b, r, fp)));
    simulatedNow++;
  }
  for (const { b, page } of group) hist.absorb(b, page, loadFlow(b.id));
  i = j;
}
lap(`history built; calibration games: ${calRecs.length} (${simulatedNow} simulated now, ${fromCache} from cache)`);
if (doCal) writeJSON(cachePath, cache);

function calibrateOne(G, out, box, r, fp) {
  const act = { hs: Number(box.hs), as: Number(box.as), players: new Map() };
  const byPid = new Map((box.players || []).filter((p) => p.id).map((p) => [String(p.id), p]));
  for (let i = 0; i < G.P; i++) {
    const p = byPid.get(G.ids[i]);
    act.players.set(i, p ? { pts: Number(p.pts) || 0, reb: Number(p.reb) || 0, ast: Number(p.ast) || 0, tpm: Number(p.tpm) || 0, min: Number(p.min) || 0 } : { pts: 0, reb: 0, ast: 0, tpm: 0, min: 0 });
  }
  const list = markets(out, G);
  const tab = {}, board = {};
  for (const f of FAMILIES) { tab[f] = BANDS.map(() => [0, 0, 0]); board[f] = BOARD_BANDS.map(() => [0, 0, 0]); }
  for (const m of folded(list)) {
    let p = m.p, h = settle(m, act);
    if (p < 0.5) { p = 1 - p; h = 1 - h; }
    if (p > 0.99) continue;
    const k = bandOf(p); if (k < 0) continue;
    const t = tab[m.fam][k]; t[0]++; t[1] += p; t[2] += h;
  }
  for (const m of boardPicks(list, G)) {
    const k = bandOf(m.p, BOARD_BANDS); if (k < 0) continue;
    const t = board[m.fam][k]; t[0]++; t[1] += m.p; t[2] += settle(m, act);
  }
  // 80% ranges (10th-90th percentile) of the simulations versus what happened
  const N = out.N, P = G.P;
  // where the result fell in the simulated distribution (ties at whole numbers split in half, so whole-number
  // stats are not flattered): inside = between the 10th and 90th percentile
  const cover = (vals, a) => { let lt = 0, eq = 0; for (const v of vals) { if (v < a) lt++; else if (v === a) eq++; } const u = (lt + 0.5 * eq) / vals.length; return u >= 0.9 ? [1, 0, 1, 0] : u <= 0.1 ? [1, 0, 0, 1] : [1, 1, 0, 0]; };
  const marg = new Float64Array(N), tot = new Float64Array(N);
  for (let s = 0; s < N; s++) { marg[s] = out.hs[s] - out.as[s]; tot[s] = out.hs[s] + out.as[s]; }
  const cov = { margin: cover(marg, act.hs - act.as), total: cover(tot, act.hs + act.as), pts: [0, 0, 0, 0], reb: [0, 0, 0, 0], ast: [0, 0, 0, 0] };
  for (let i = 0; i < P; i++) {
    if (G.projMin[i] < 15) continue;
    const a = act.players.get(i); if (!a || a.min <= 0) continue; // played (as the model's range rule)
    for (const st of ["pts", "reb", "ast"]) {
      const v = new Float64Array(N); for (let s = 0; s < N; s++) v[s] = out.pl[(s * P + i) * S + ST[st]];
      const c = cover(v, a[st]); for (let k = 0; k < 4; k++) cov[st][k] += c[k];
    }
  }
  let pH = 0, pc = 0, pbh = 0, pba = 0, pot = 0, mSum = 0;
  for (let s = 0; s < N; s++) { const f = out.flags[s]; if (out.hs[s] > out.as[s]) pH++; if (f & FLAG.close) pc++; if (f & FLAG.blowH) pbh++; if (f & FLAG.blowA) pba++; if (f & FLAG.ot) pot++; mSum += marg[s]; }
  const am = act.hs - act.as;
  return {
    fp, id: String(box.id), pk: r.pk, date: box.date,
    w: [r3(pH / N), am > 0 ? 1 : 0, r.pred.pHome],
    m: [r1(mSum / N), am, r1(r.pred.hs - r.pred.as)],
    tab, board, cov,
    scen: [r3(pc / N), r3(pbh / N), r3(pba / N), r3(pot / N), Math.abs(am) <= 5 ? 1 : 0, am >= 15 ? 1 : 0, am <= -15 ? 1 : 0, Number(box.periods) > 4 ? 1 : 0],
  };
}

// ---------- 2. simcal.json ----------
function buildSimcal(recs) {
  const sumTab = (bands, get) => { const t = bands.map(() => [0, 0, 0]); for (const r of recs) { const x = get(r); if (!x) continue; for (let k = 0; k < bands.length; k++) for (let z = 0; z < 3; z++) t[k][z] += x[k][z]; } return t; };
  const fin = (t, bands) => t.map((x, k) => ({ band: bandLabel(bands[k]), n: x[0], said: x[0] ? pct(x[1] / x[0]) : null, happened: x[0] ? pct(x[2] / x[0]) : null }));
  const byFam = {}, boardFam = {};
  for (const f of FAMILIES) { byFam[f] = fin(sumTab(BANDS, (r) => r.tab[f]), BANDS); boardFam[f] = fin(sumTab(BOARD_BANDS, (r) => r.board[f]), BOARD_BANDS); }
  const all = fin(sumTab(BANDS, (r) => { const t = BANDS.map(() => [0, 0, 0]); for (const f of FAMILIES) for (let k = 0; k < BANDS.length; k++) for (let z = 0; z < 3; z++) t[k][z] += r.tab[f][k][z]; return t; }), BANDS);
  const boardAll = fin(sumTab(BOARD_BANDS, (r) => { const t = BOARD_BANDS.map(() => [0, 0, 0]); for (const f of FAMILIES) for (let k = 0; k < BOARD_BANDS.length; k++) for (let z = 0; z < 3; z++) t[k][z] += r.board[f][k][z]; return t; }), BOARD_BANDS);
  // winner: simulated chance of the favourite
  const wt = BANDS.map(() => [0, 0, 0]);
  let brierSim = 0, brierModel = 0, maeSim = 0, maeModel = 0;
  for (const r of recs) {
    const [p, y, pm] = r.w;
    const fp = p >= 0.5 ? p : 1 - p, fy = p >= 0.5 ? y : 1 - y;
    const k = bandOf(fp); if (k >= 0) { wt[k][0]++; wt[k][1] += fp; wt[k][2] += fy; }
    brierSim += (p - y) ** 2; brierModel += (pm - y) ** 2;
    maeSim += Math.abs(r.m[0] - r.m[1]); maeModel += Math.abs(r.m[2] - r.m[1]);
  }
  const n = recs.length || 1;
  const covSum = (k) => { const c = [0, 0, 0, 0]; for (const r of recs) for (let z = 0; z < 4; z++) c[z] += r.cov[k][z]; return { n: c[0], inside: c[0] ? pct(c[1] / c[0]) : null, above: c[0] ? pct(c[2] / c[0]) : null, below: c[0] ? pct(c[3] / c[0]) : null }; };
  const sc = [0, 0, 0, 0, 0, 0, 0, 0]; for (const r of recs) for (let z = 0; z < 8; z++) sc[z] += r.scen[z];
  const scen = ["Close game (5 or less)", "Home wins by 15+", "Away wins by 15+", "Overtime"].map((label, z) => ({ label, simulated: pct(sc[z] / n), happened: pct(sc[z + 4] / n) }));
  const phases = {};
  for (const r of recs) { const ph = phases[r.pk] || (phases[r.pk] = { games: 0, brierSim: 0, brierModel: 0 }); ph.games++; ph.brierSim += (r.w[0] - r.w[1]) ** 2; ph.brierModel += (r.w[2] - r.w[1]) ** 2; }
  for (const ph of Object.values(phases)) { ph.brierSim = r3(ph.brierSim / ph.games); ph.brierModel = r3(ph.brierModel / ph.games); }
  return {
    format: 1, generated, dataUpdated, engine: ENGINE,
    note: "Walk-forward calibration: each finished game was simulated using only its pre-game projection (the tip-off track, public/data/games/<id>.json) and scenario rates and player percentages counted from games played before it. 'said' is the average simulated probability in the band, 'happened' how often it came true.",
    method: {
      games: recs.length, simsPerGame: cfg.calN, warmup: `the first ${cfg.warmup} projected non-preseason games are left out while the history fills; preseason games are not calibrated`,
      span: recs.length ? [recs[0].date, recs[recs.length - 1].date] : null,
      markets: `winner; "wins by more than L" for L in ${GRID.spread.join(", ")}; game totals ${GRID.total[0]}-${GRID.total[GRID.total.length - 1]} and team totals ${GRID.team[0]}-${GRID.team[GRID.team.length - 1]} every 5 points; player points / rebounds / assists / threes thresholds (${GRID.pts.join(", ")} / ${GRID.reb.join(", ")} / ${GRID.ast.join(", ")} / ${GRID.tpm.join(", ")}) for players projected ${PLAYER_MIN_FOR_MARKETS}+ minutes. Each over/under pair is counted once, from the side with 50%+. Events above 99% are left out of the reliability table (they are mostly trivial, such as a bench player under 40 points).`,
      dnp: "A player who did not play counts as 0 (the simulations include the counted coach's-decision DNP rate).",
      tipoffTrack: "Past projections knew the confirmed inactive list; upcoming games are simulated earlier, so their real hit rates can be a little lower (see learning.json > liveTrack for the model's own gap).",
    },
    winner: { table: fin(wt, BANDS), brierSim: r3(brierSim / n), brierModel: r3(brierModel / n), marginMaeSimMean: r1(maeSim / n), marginMaeModel: r1(maeModel / n), byPhase: phases },
    markets: { all, byFamily: byFam },
    board: { min: BOARD_MIN, rule: "per game, family, team or player and side: the strictest grid line with a simulated chance of 85%+ (the same rule as board.json)", all: boardAll, byFamily: boardFam },
    ranges: { note: "share of results inside the simulations' 10th-90th percentile (target 80%), above it and below it; a result equal to a whole-number value counts half below and half above that value; players projected 15+ minutes who played", margin: covSum("margin"), total: covSum("total"), pts: covSum("pts"), reb: covSum("reb"), ast: covSum("ast") },
    scenarios: { note: "average simulated chance versus how often it happened, same games", rows: scen },
  };
}
let simcal = null;
if (doCal && calRecs.length) {
  calRecs.sort((a, b) => a.date.localeCompare(b.date));
  simcal = buildSimcal(calRecs);
  writeJSON(path.join(PUBLIC_DATA, "simcal.json"), simcal);
  lap("simcal.json written");
} else simcal = readJSON(path.join(PUBLIC_DATA, "simcal.json"), null);

function bandHit(fam, p) {
  if (!simcal) return null;
  const k = bandOf(p, BOARD_BANDS); if (k < 0) return null;
  const f = simcal.board.byFamily[fam] && simcal.board.byFamily[fam][k];
  if (f && f.n >= 30) return { rate: f.happened, n: f.n, band: f.band, scope: "this market type" };
  const a = simcal.board.all[k];
  return a && a.n ? { rate: a.happened, n: a.n, band: a.band, scope: "all market types (fewer than 30 of this type)", typeN: f ? f.n : 0 } : null;
}

// ---------- 3. upcoming games ----------
const params = hist.params();
const odds = loadOdds(); // display-only comparison; read after nothing else depends on it
const simDir = path.join(PUBLIC_DATA, "sim");
fs.mkdirSync(simDir, { recursive: true });
const keep = new Set();
const index = [], picks = [];
const pub = (p) => ({
  regShift: r1(p.regShift), regulationErrorSd: [r1(Math.sqrt(p.cov.hh)), r1(Math.sqrt(p.cov.aa))], regulationErrorCorr: r3(p.cov.ha / Math.sqrt(p.cov.hh * p.cov.aa)),
  paceSd: r3(p.paceSd), scoreEffects: p.revert.map(r3), dnpRate: p.dnp.map(r3), minutesSd: p.minSd.map(r3),
  foulCut: { five: r1(p.fcut5), six: r1(p.fcut6), games: p.foulGames }, foulTroubleScale: r3(p.foulScale), exitPer100Min: r3(p.exitPerMin * 100), exitEvents: p.exitEvents, samePosition: r3(p.samePos),
  otShareOfClose: r3(p.otShare), otCloseGames: p.otGames, usageCV: r3(p.usageCV), extraShootingSd: [r3(p.shootSd2), r3(p.shootSd3)], blowoutLead: p.q3thr,
  blowoutRole: Object.fromEntries(Object.entries(p.blowRole).map(([k, v]) => [k, { win: { min: r1(v.win.min), games: v.win.n }, lose: { min: r1(v.lose.min), games: v.lose.n } }])),
  games: p.hist.games,
});
const paramsPub = pub(params);
let simCount = 0;
for (const u of upcoming) {
  if (cfg.only && !cfg.only.has(String(u.id))) continue;
  const d = readJSON(path.join(PUBLIC_DATA, "upcoming", `${u.id}.json`), null);
  if (!d || !d.pred || !d.teams) continue;
  const src = upcomingInput(d, inactiveFor(pregame, String(u.id)));
  const G = buildGame(src, (row) => hist.playerRates(row.id, row.pos), params);
  if (G.teams[0].idx.length < 5 || G.teams[1].idx.length < 5) continue;
  const seed = hashSeed(cfg.seed, u.id);
  const { out, sk, blow, minScale, paceScale, tieRate } = runGame(G, params, cfg.N, cfg.pilot, seed);
  simCount++;
  const abbr = [abbrOf.get(G.home) || G.home, abbrOf.get(G.away) || G.away];
  const sum = summarize(G, out, { abbr, params });
  const entry = odds && odds.games ? odds.games[String(u.id)] : null;
  const file = {
    format: 1, id: String(u.id), date: d.date, phase: d.phase, home: G.home, away: G.away, venue: d.venue || null,
    generated, dataUpdated,
    label: "Statistical simulation built from the model's projection and rates counted from finished games. No betting lines are used.",
    config: {
      engine: ENGINE, sims: cfg.N, seed, pilotSims: cfg.pilot * 3,
      reproduce: `SIM_SEED=${cfg.seed} SIM_N=${cfg.N} SIM_PILOT=${cfg.pilot} SIM_GAMES=${u.id} node scripts/simulate.mjs (same data files)`,
      calibrated: { shootingSd: [r1(sk.shock.l11), r1(Math.hypot(sk.shock.l21, sk.shock.l22))], engineSd: [r1(Math.sqrt(sk.intrinsic.vh)), r1(Math.sqrt(sk.intrinsic.va))], targetSd: [r1(Math.sqrt(sk.empirical.hh)), r1(Math.sqrt(sk.empirical.aa))], meanCorrection: sk.baseSh.map(r3), minutesNoiseScale: minScale.map(r3), paceNoiseScale: r3(paceScale), tyingPlay: r3(tieRate), blowoutStart: blow ? [r3(blow.pH), r3(blow.pA)] : null,
        note: "Team shooting temperature is drawn so that regulation scores spread like the walk-forward errors (targetSd); engineSd is the spread the possession-by-possession play already produces without it. meanCorrection keeps each team's average on its projection." },
      params: paramsPub,
    },
    inputs: {
      proj: { hs: d.pred.hs, as: d.pred.as, pHome: d.pred.pHome, pace: d.pred.pace },
      lateOut: src.lateOut,
      notes: [
        "Each player's minutes, points, rebounds, assists, threes, steals and blocks are the model's projection; shooting percentages, free-throw rate, turnovers and fouls come from his box scores before this game.",
        src.lateOut.length ? "Players on NBA.com's inactive list are left out of the simulation; their minutes are shared out." : "No NBA.com inactive list applied (not published yet for this game).",
        "Questionable players (q) are simulated as projected; late scratches beyond the counted coach's-decision rate are not simulated.",
        "Blowout minutes (starters rested, bench up when a lead reaches the counted size after three quarters) are by role, counted walk-forward from finished regular-season and playoff games; the same values are used in the calibration.",
      ],
    },
    distCols: DIST_COLS,
    // headline numbers at the top level, for other views (same values as in forecast)
    sims: cfg.N, pHome: sum.forecast.pHome, margin: sum.forecast.margin.mean, total: sum.forecast.total.mean,
    ...sum,
  };
  const cmp = comparison(entry, out, G, abbr);
  if (cmp) file.comparison = cmp;
  writeJSON(path.join(simDir, `${u.id}.json`), file);
  keep.add(`${u.id}.json`);
  index.push({ id: String(u.id), date: d.date, home: G.home, away: G.away, pHome: sum.forecast.pHome, margin: sum.forecast.margin.median, total: sum.forecast.total.median, pOT: sum.forecast.pOT,
    spread: sum.lines.spread.homeLine, totalLine: sum.lines.total ? sum.lines.total.line : null, comparison: !!cmp });
  // board
  const ms = markets(out, G, abbr);
  for (const m of boardPicks(ms, G)) {
    const pk = {
      game: String(u.id), date: d.date, home: G.home, away: G.away, fam: m.fam, label: m.label, side: m.side, line: m.line, p: r3(m.p),
      team: m.subj === 0 ? G.home : m.subj === 1 && ["winner", "spread", "teamTotal"].includes(m.fam) ? G.away : undefined,
      player: ["pts", "reb", "ast", "tpm"].includes(m.fam) ? { id: G.ids[m.subj], n: G.names[m.subj], t: G.side[m.subj] === 0 ? G.home : G.away, projMin: r1(G.projMin[m.subj]) } : undefined,
      hit: bandHit(m.fam, m.p),
    };
    if (m.fam === "total") pk.team = undefined;
    const bc = boardComparison(entry, m, out, G);
    if (bc) pk.comparison = bc;
    picks.push(pk);
  }
  if (simCount % 10 === 0) lap(`${simCount} games simulated`);
}
for (const f of fs.readdirSync(simDir)) if (f.endsWith(".json") && f !== "index.json" && !keep.has(f) && !cfg.only) fs.rmSync(path.join(simDir, f));
index.sort((a, b) => a.date.localeCompare(b.date));
writeJSON(path.join(simDir, "index.json"), { format: 1, generated, dataUpdated, sims: cfg.N, games: index });
lap(`${simCount} upcoming games simulated`);

// ---------- 4. board.json ----------
picks.sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game) || b.p - a.p);
writeJSON(path.join(PUBLIC_DATA, "board.json"), {
  format: 1, generated, dataUpdated, min: BOARD_MIN,
  note: "Every market where the simulation gives 85% or more, for upcoming games. For each game, team or player and side only the strictest line that still reaches 85% is listed. 'hit' is how often picks chosen by exactly this rule came true in the walk-forward calibration (simcal.json), for the same market type and confidence band. Statistical simulation only.",
  rules: { grid: GRID, players: `overs only, players projected ${BOARD_PLAYER_MIN}+ minutes (an 85% under is almost always a small line for a low-minute player, so unders are left off the board; they are still in the calibration table)`, dnp: "a player who does not play counts as 0" },
  comparisonLabel: odds ? COMPARISON_LABEL : null,
  calibration: simcal ? { games: simcal.method.games, all: simcal.board.all, byFamily: simcal.board.byFamily } : null,
  picks,
});
lap(`board.json written (${picks.length} picks)`);

// ---------- 5. odds display copy (comparison only) ----------
const oddsCopied = publishOddsCopy(odds);

// ---------- 6. season.json ----------
{
  const sigma = Math.sqrt(params.cov.hh + params.cov.aa - 2 * params.cov.ha);
  const pages = results.slice(-200).map((r) => loadPage(r.id)).filter(Boolean);
  // home court: the model's current learned value (the same number the Why page shows), else the recent per-game average
  const learnedHome = readJSON(path.join(PUBLIC_DATA, "learning.json"), null)?.params?.at(-1)?.homeAdv;
  const homeAdv = Number.isFinite(learnedHome) ? learnedHome : pages.length ? pages.reduce((a, p) => a + (Number(p.homeAdv) || 0), 0) / pages.length : 2;
  const season = seasonSim({ teams: teamsPub, upcoming, results, sigma, homeAdv, N: cfg.seasonN, seed: hashSeed(cfg.seed, "season") });
  writeJSON(path.join(PUBLIC_DATA, "season.json"), { format: 1, generated, dataUpdated, seed: hashSeed(cfg.seed, "season"), note: "Rest-of-season simulation from current ratings and the remaining schedule. Statistical only; no betting data.", ...season });
  lap("season.json written");
}

lap(`done. ${simCount} games x ${cfg.N} simulations; calibration ${calRecs.length} games; odds copy ${oddsCopied ? "written" : "not present"}`);
