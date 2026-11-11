// Walk-forward NBA analyzer.
// For every game since Oct 2025, in date order:
//   1. project each player and team using ONLY information available before tip-off
//   2. compare with what really happened and explain the gap (minutes, usage, shooting,
//      pace, absences, blowouts, overtime, foul trouble ...)
//   3. feed the gap back into a scenario library that adjusts future projections.
// Then project upcoming games with everything learned up to today.
// No betting odds or sportsbook lines are used anywhere.
import fs from "node:fs";
import path from "node:path";
import { DATA, PUBLIC_DATA, readJSON, writeJSON, isBetting } from "./lib/util.mjs";
import { clamp, round, mean, sd, phi, posGroup, phaseOf, tsa, ew, normName, regress, etDay, gameDaysBetween } from "./lib/stats.mjs";
// Shooting-efficiency regression (see playerBaseline). CL_EFF_K=0 turns it off for comparison runs.
// Back-test (2026-11-11): K=400, half-life 40 games cut points MAE 4.949 -> 4.933 (2025-26) and 4.950 -> 4.922 (2026-27), game Brier unchanged.
const EFF_K = Number(process.env.CL_EFF_K ?? 400), EFF_HL = Number(process.env.CL_EFF_HL ?? 40);
import { teamBox, repairBlankRows, markCupFinals, scoreOnlyGames } from "./lib/boxfix.mjs";
import { loadPbp } from "./lib/zonedata.mjs";
import { buildContext } from "./lib/context.mjs";
import { createZoneState } from "./lib/zonestate.mjs";
import { createFactorEngine, createCentres, opponentInputs, playerInputs, FACTORS, FACTOR_BY_ID, OPP_FACTORS, FACTOR_RULES } from "./lib/factors.mjs";
import { createScout, TAG_RULE, DEF_RULE, CULTURE_MIN, tagOf } from "./lib/scout.mjs";
import { createGameKeys, MIN as SCEN_MIN } from "./lib/gamekeys.mjs";
import { Z5, DECAY } from "./lib/zonestate.mjs";
import { ZONE_LABEL, FINE_ZONES, STYLES } from "./lib/zones.mjs";
import { createFlowState, FLOW_RULE } from "./lib/flow.mjs";
import { createDefMatchState, DM_RULE } from "./lib/defmatch.mjs";
import { createGatedLearner, createReturnCurves, createQuarterState, trustOf, retBucket, IX_RULE, RET_BUCKETS, RET_GAMES, TRUST_RULE } from "./lib/inloop.mjs";

const t0 = Date.now();
const OUT = process.env.CL_OUT ? path.resolve(process.env.CL_OUT) : PUBLIC_DATA; // CL_OUT=<folder> writes a scratch copy instead of public/data
const teams = readJSON(path.join(DATA, "teams.json"), []);
const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
const gameFiles = fs.readdirSync(path.join(DATA, "games")).filter((f) => f.endsWith(".json"));
const games = gameFiles.map((f) => readJSON(path.join(DATA, "games", f))).filter(Boolean)
  .sort((a, b) => a.date.localeCompare(b.date));
// ---- load-time repairs and labels (lib/boxfix.mjs); data/ is never rewritten ----
const dataNotes = { blankRowsRebuilt: 0, blankRowGames: 0, cupFinals: [], scoreOnly: [] };
{
  const logs = readJSON(path.join(DATA, "nbagamelogs.json"), {});
  const logsByDay = new Map();
  for (const rows of Object.values(logs)) for (const r of rows) { if (!logsByDay.has(r[0])) logsByDay.set(r[0], []); logsByDay.get(r[0]).push(r); }
  const NBA_ABBR = { GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };
  const abbrOf = (tid) => NBA_ABBR[teamById[tid]?.abbr] || teamById[tid]?.abbr;
  const names = { byId: new Map(), byName: new Map() };
  for (const t of Object.values(readJSON(path.join(DATA, "rosters.json"), {}))) for (const p of t.players || []) { names.byId.set(String(p.id), p.n); names.byName.set(normName(p.n), String(p.id)); }
  for (const g of games) for (const p of g.players || []) if (p.id) { names.byId.set(String(p.id), p.n); names.byName.set(normName(p.n), String(p.id)); }
  for (const g of games) { if (!(g.players || []).some((p) => !p.id)) continue; dataNotes.blankRowGames++; dataNotes.blankRowsRebuilt += repairBlankRows(g, loadPbp, logsByDay, abbrOf, names); }
  for (const g of games) g.players = (g.players || []).filter((p) => p.id); // rows that stayed blank carry no information
  dataNotes.cupFinals = markCupFinals(games);
}
// Finished games with a final score in the schedule but no box score on ESPN: they count in
// records, meetings, rest days and Elo; everything that needs box-score numbers skips them.
const NOBOX = scoreOnlyGames(path.join(DATA, "schedule"), new Set(games.map((g) => String(g.id)))).filter((e) => teamById[e.home] && teamById[e.away]);
dataNotes.scoreOnly = NOBOX.map((e) => e.id);
const ctx = buildContext(games); // NBA.com, 2K, news, injuries, rosters - point-in-time aware
console.log(`loaded ${games.length} games (${dataNotes.blankRowsRebuilt} blank box rows rebuilt in ${dataNotes.blankRowGames} games, ${NOBOX.length} finished games with a final score only, ${dataNotes.cupFinals.length} NBA Cup final${dataNotes.cupFinals.length === 1 ? "" : "s"})`);
// Zone state (shots by zone, defence by zone, game facts) and the learned matchup factors.
// CL_FACTORS=off runs the same walk-forward with every factor effect held at zero (ablation);
// CL_FACTORS_SKIP=zone,rim switches single factors off.
const ZS = createZoneState();
const FXE = createFactorEngine({ allOff: process.env.CL_FACTORS === "off", disabled: new Set((process.env.CL_FACTORS_SKIP || "").split(",").filter(Boolean)) });
const CEN = createCentres();
// In-loop features of this round (lib/flow.mjs, lib/inloop.mjs). Each is built only from games
// before the one being projected and is applied only as far as its gate opens (out-of-sample test).
// CL_IX=off holds every one at zero (ablation); CL_IX_SKIP=blowMin,mateOut switches single ones off.
const FLOW = createFlowState();
const IX_SPECS = [
  { id: "blowMin", stats: ["min"], label: "Blowout minutes", what: "His (and his team's, by role) minutes against projection in past games decided by 15+, each side weighted by tonight's chance of a 15+ win or loss." },
  { id: "blowPts", stats: ["pts"], label: "Blowout scoring", what: "His points against projection in past games decided by 15+ (stars resting when far ahead, starters pulled or piling up points when far behind), weighted by tonight's blowout chances." },
  { id: "flowPts", stats: ["pts"], label: "Game-flow scoring", what: "His points per minute on the floor when far ahead, far behind and in tight 4th quarters (play-by-play), against his usual rate, weighted by tonight's chances of each script." },
  { id: "retMin", stats: ["min"], label: "Return-from-absence minutes", what: "Minutes against projection in game 1-5 back after missing 3-5, 6-14 or 15+ games in a row (league-wide curve)." },
  { id: "retPts", stats: ["pts"], label: "Return-from-absence scoring", what: "Points against projection in game 1-5 back after an absence (league-wide curve)." },
  { id: "mateOut", stats: ["pts"], label: "On-court effect of an absent teammate", what: "His points per minute on the floor with the absent teammate on the court versus off it (substitution data), times his minutes." },
  { id: "defReal", stats: ["pts"], label: "Real defenders (who guards him)", what: "NBA.com matchup tracking: each opposing defender's expected share of his possessions (previous meetings, else the defender's usual split by position) times that defender's points allowed against expected versus similar scorers, minus the same for an average possession against that team (its defence as a whole is already in the projection), in points." },
  { id: "defPair", stats: ["pts"], label: "His record vs tonight's defenders", what: "His points per partial possession against each of tonight's likely defenders in previous meetings, beyond his own rate and that defender's general record (shrunk), weighted by each defender's expected share." },
  { id: "oppOut", stats: ["pts"], label: "On-court effect of an absent opponent", what: "His points per minute with the absent opposing player on the court versus off it, times his minutes." },
];
const IX_T_SPECS = [{ id: "teamOnOff", stats: ["tpts"], label: "On/off of absent players (team points)", what: "Team points per 100 possessions with each absent player on versus off the floor (own offence, and the opponent's defence for absent opponents), times the possessions he usually plays." }];
// Minutes features held as evidence: their gates open on this learner's own test, but the end-to-end
// walk-forward was slightly worse with them applied (CL_IX_MIN=apply turns them on; see IX_HOLD_NOTE).
const IX_HOLD_NOTE = "its own gate opens (it improves the minutes of deep-bench players), but with it applied the published points error of players projected 15+ minutes was 4.947 instead of 4.944 and the playoff points error 4.864 instead of 4.829 (minutes error 4.589 vs 4.588), so it is kept out of the projection";
const ixOpts = { allOff: process.env.CL_IX === "off", off: new Set((process.env.CL_IX_SKIP || "").split(",").filter(Boolean)),
  hold: process.env.CL_IX_MIN === "apply" ? new Map() : new Map([["blowMin", IX_HOLD_NOTE], ["retMin", IX_HOLD_NOTE]]) };
const IX = createGatedLearner(IX_SPECS, ixOpts), IXT = createGatedLearner(IX_T_SPECS, ixOpts);
const IX_DNP = process.env.CL_IX_DNP !== "off";
const ixLabel = Object.fromEntries(IX_SPECS.map((f) => [f.id, f.label]));
const RET = createReturnCurves();
// Who guarded whom (lib/defmatch.mjs): games are queued after their projection and folded in by
// MUS.flush(iso) only when they tipped off strictly before the game about to be projected.
const DM_MODE = process.env.CL_DM_MODE || "centred"; // ablation: centred (default) | replace | pure | shares (learning.json > inloop.defMatch.ablation)
const MUS = createDefMatchState({ grpOf: (id) => P.get(id)?.g || null });
const QS = createQuarterState();
const qCheck = { n: 0, model: [0, 0, 0, 0], even: [0, 0, 0, 0], league: [0, 0, 0, 0] }; // quarter projection back-test (regulation games)
const TYP = { pts: {}, team: { n: 0, abs: 0 } }; // running typical errors for the trust meter
const BLOW = { lg: {}, team: {} };               // blowout residuals: lg[role][w|l], team[tid|season|role][w|l] = [n, min, pts]

// ------------------------------------------------------------------ state
const P = new Map();   // playerId -> { id, n, pos, g, team, recs: [], res: [], teamsPlayed:Set }
const T = new Map();   // teamId -> { recs: [] }
const league = { pos: { G: blankRates(), F: blankRates(), C: blankRates() }, pts: 0, poss: 0, gm48: 0, paint: 0, fb: 0, tpa: 0, fga: 0, n: 0 };
const STATS = ["pts", "reb", "ast", "tpm", "stl", "blk", "to"];
function blankRates() { return { min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, stl: 0, blk: 0, to: 0, tsa: 0, tpa: 0 }; }

// Learned parameters (online). Start neutral and are updated after every game.
const learn = {
  w: { efficiency: 0.3, players: 0.1, elo: 0.2, adjusted: 0.2, luckAdjusted: 0.2 }, // ensemble weights, learned online
  rt: {}, refs: {}, modelErr: {},
  homeAdv: 2.0, sigma: 13.0, a: 0.13, k: 0.85, sxy: 4250, sxx: 5000,
  rangeZ: { lo: 1.28, hi: 1.28, above: 0, below: 0, n: 0 }, // 80% points range: each side's width is learned so that about 10% of results miss on that side
  scen: {},      // scenario|role|stat -> { w, n, raw }
  teamScen: {},  // team scenario -> { w, n, raw }
  history: [],   // snapshots of learned params over time
};

const getP = (id, n, pos) => {
  if (!P.has(id)) P.set(id, { id, n, pos, g: posGroup(pos), team: null, recs: [], res: [], teamsPlayed: new Set(), splits: {}, stints: [],
    splitAll: { n: 0, pts: 0, tpa: 0, reb: 0, ast: 0, min: 0 }, blow: { w: [0, 0, 0], l: [0, 0, 0] }, errs: [], rets: [] });
  const p = P.get(id); if (pos && !p.pos) { p.pos = pos; p.g = posGroup(pos); }
  return p;
};
const getT = (id) => { if (!T.has(id)) T.set(id, { id, recs: [], vsStyle: {}, vsTeam: {}, res: [], terr: [] }); return T.get(id); };

const INJURY_DNP = (why) => why && !/COACH|DECISION/i.test(why);
const COACH_DNP = (x) => !!x.dnp && /COACH|DECISION/i.test(x.why || "");

// Team membership by date span, not by box-score listing (an inactive player is usually not in
// the box score at all). p.stints = [{ team, first, last }]: runs of consecutive appearances for
// one team. A player was "on team X" for a game dated inside one of his X stints; with open = true
// the latest stint has no end yet (he is still with the team as far as is known).
function onTeamAt(p, tid, date, open) {
  const st = p?.stints; if (!st || !st.length) return false;
  for (let i = 0; i < st.length; i++) {
    const s = st[i]; if (s.team !== tid || date < s.first) continue;
    if (date <= s.last || (open && i === st.length - 1)) return true;
  }
  return false;
}
// Finished team games (no preseason, this season and last) in which the player was on the team,
// split into games he played and games he missed. cd = missed by coach's decision (listed in the box).
function withWithoutGames(tid, pid, before, season, open) {
  const p = P.get(pid), w = [], wo = [];
  let cd = 0;
  for (const r of getT(tid).recs) {
    if (r.stype === 1 || r.season < season - 1 || (before && r.date >= before)) continue;
    if (r.box.get(pid)?.min > 0) { w.push(r); continue; }
    if (!onTeamAt(p, tid, r.date, open)) continue;
    wo.push(r); if (r.cd.has(pid)) cd++;
  }
  return { w, wo, cd };
}
const WW_SKIP_CD = process.env.CL_WW_CD !== "keep"; // a player's "without teammate" sample leaves out the teammate's coach's-decision games (he was available)
const WW_APPLY = process.env.CL_WW_MODE === "apply";  // ablation switch; by default the pairwise evidence is shown, not applied

// ------------------------------------------------------------------ team ratings
function teamProfile(tid, season, date) {
  const t = getT(tid);
  const recs = t.recs.slice(-60);
  const wf = (r) => (r.season === season ? 1 : 0.5) * (r.stype === 1 ? 0.3 : 1);
  const lg = leagueNow();
  const poss = ew(recs, (r) => r.poss, 22, wf), pts = ew(recs, (r) => r.pts, 22, wf), opp = ew(recs, (r) => r.oppPts, 22, wf);
  const pace = ew(recs, (r) => r.pace, 22, wf);
  const K = 6; // pseudo-games toward league average
  const off = (pts.v + lg.ppp * 100 * K * (poss.avg || 100) / 100) / ((poss.v || 0) + K * (poss.avg || 100)) * 100;
  const def = (opp.v + lg.ppp * 100 * K * (poss.avg || 100) / 100) / ((poss.v || 0) + K * (poss.avg || 100)) * 100;
  const pc = (pace.v + lg.pace * K) / (pace.w + K);
  const m = (fn) => { const e = ew(recs, fn, 12, wf); return e.w ? e.avg : null; };
  const style = {
    pace: pc, off, def,
    tpar: m((r) => r.tpa / Math.max(1, r.fga)), ftr: m((r) => r.fta / Math.max(1, r.fga)),
    paint: m((r) => r.paint), fb: m((r) => r.fb), astRate: m((r) => r.ast / Math.max(1, r.fgm)),
    tov: m((r) => r.tov / Math.max(1, r.poss)), orb: m((r) => r.oreb / Math.max(1, r.oreb + r.oppDreb)),
    oppTpar: m((r) => r.oppTpa / Math.max(1, r.oppFga)), oppPaint: m((r) => r.oppPaint), oppTov: m((r) => r.oppTov / Math.max(1, r.poss)),
    depth: m((r) => r.depth), starterShare: m((r) => r.starterShare), benchPts: m((r) => r.benchPts),
    efg: m((r) => r.efg), oppEfg: m((r) => r.oppEfg), games: recs.filter((r) => r.season === season && r.stype !== 1).length,
  };
  style.tags = styleTags(style, lg);
  // Points allowed by position group, per minute, relative to league.
  const allowed = {};
  for (const g of ["G", "F", "C"]) {
    const a = ew(recs, (r) => r.allow[g].pts, 15, wf), am = ew(recs, (r) => r.allow[g].min, 15, wf);
    const ar = ew(recs, (r) => r.allow[g].reb, 15, wf), aa = ew(recs, (r) => r.allow[g].ast, 15, wf);
    const L = lg.pos[g]; const Km = 300;
    allowed[g] = {
      pts: ((a.v + L.pts * Km) / (am.v + Km)) / (L.pts || 1),
      reb: ((ar.v + L.reb * Km) / (am.v + Km)) / (L.reb || 1),
      ast: ((aa.v + L.ast * Km) / (am.v + Km)) / (L.ast || 1),
    };
  }
  style.allowed = allowed;
  return style;
}

function styleTags(s, lg) {
  const tags = [];
  if (s.pace > lg.pace + 2) tags.push("Up-tempo"); else if (s.pace < lg.pace - 2) tags.push("Slow-paced");
  if (s.tpar != null && s.tpar > lg.tpar + 0.04) tags.push("3-point heavy");
  if (s.paint != null && s.paint > lg.paint + 4) tags.push("Paint attack");
  if (s.fb != null && s.fb > lg.fb + 3) tags.push("Transition");
  if (s.astRate != null && s.astRate > 0.66) tags.push("Ball movement"); else if (s.astRate != null && s.astRate < 0.56) tags.push("Isolation-heavy");
  if (s.orb != null && s.orb > 0.30) tags.push("Crashes offensive glass");
  if (s.oppTov != null && s.oppTov > 0.155) tags.push("Turnover-forcing D");
  if (s.def < lg.ppp * 100 - 3) tags.push("Elite defense"); else if (s.def > lg.ppp * 100 + 3) tags.push("Leaky defense");
  if (s.off > lg.ppp * 100 + 3) tags.push("Elite offense");
  if (s.oppTpar != null && s.oppTpar > lg.tpar + 0.03) tags.push("Allows lots of 3s");
  if (s.oppPaint != null && s.oppPaint > lg.paint + 4) tags.push("Soft interior D");
  return tags;
}

function leagueNow() {
  const n = league.n || 1;
  const pos = {};
  for (const g of ["G", "F", "C"]) {
    const L = league.pos[g]; const m = L.min || 1;
    pos[g] = league.pos[g].min > 500
      ? { pts: L.pts / m, reb: L.reb / m, ast: L.ast / m, tpm: L.tpm / m, stl: L.stl / m, blk: L.blk / m, to: L.to / m, tsa: L.tsa / m, tpa: L.tpa / m }
      : DEFAULT_POS[g];
  }
  return {
    ppp: league.poss > 2000 ? league.pts / league.poss : 1.14,
    pace: league.gm48 > 20 ? league.poss / league.gm48 : 99.5,
    paint: league.n > 20 ? league.paint / n : 48, fb: league.n > 20 ? league.fb / n : 14,
    tpar: league.fga > 2000 ? league.tpa / league.fga : 0.42, pos,
  };
}
const DEFAULT_POS = {
  G: { pts: 0.48, reb: 0.13, ast: 0.16, tpm: 0.065, stl: 0.03, blk: 0.01, to: 0.065, tsa: 0.42, tpa: 0.17 },
  F: { pts: 0.44, reb: 0.2, ast: 0.08, tpm: 0.05, stl: 0.028, blk: 0.02, to: 0.05, tsa: 0.37, tpa: 0.13 },
  C: { pts: 0.46, reb: 0.3, ast: 0.08, tpm: 0.02, stl: 0.025, blk: 0.045, to: 0.06, tsa: 0.36, tpa: 0.04 },
};

// ------------------------------------------------------------------ player baseline
function playerBaseline(p, season, date) {
  const lg = leagueNow();
  const recs = p.recs.filter((r) => r.date < date).slice(-50);
  const wPhase = (r) => (r.season === season ? 1 : 0.55) * (r.stype === 1 ? 0.25 : 1);
  const played = recs.filter((r) => r.min > 0);
  const minE = ew(recs.filter((r) => r.avail), (r) => r.min, 6, (r) => (r.season === season ? 1 : 0.4) * (r.stype === 1 ? 0.15 : 1));
  const prior = lg.pos[p.g] || DEFAULT_POS.F;
  const r2k = ctx.rating2k(p.n);
  const boost = r2k ? clamp(1 + (r2k.ovr - 76) * 0.02, 0.8, 1.45) : 1; // 2K overall nudges the scoring prior only
  const K = played.length < 5 ? 150 : 90;
  const rates = {};
  const wsum = ew(played, (r) => r.min, 10, wPhase);
  for (const s of [...STATS, "tsa", "tpa"]) {
    const e = ew(played, (r) => r[s], 10, wPhase);
    const pr = (s === "pts" || s === "tsa" || s === "tpm" || s === "ast") ? prior[s] * boost : prior[s];
    rates[s] = (e.v + pr * K) / (wsum.v + K);
  }
  // Scoring = shot volume x shooting efficiency. Volume follows recent games (role changes show up fast);
  // efficiency is mostly noise over a few games, so it uses a long window and is shrunk hard toward his
  // position's league rate (EFF_K pseudo shot attempts). Learned from games before this one only.
  if (EFF_K > 0) {
    const long = p.recs.filter((r) => r.date < date && r.min > 0).slice(-140);
    const eP = ew(long, (r) => r.pts, EFF_HL, wPhase), eT = ew(long, (r) => r.tsa, EFF_HL, wPhase);
    const lgEff = prior.tsa > 0 ? prior.pts / prior.tsa : 1.1;
    const eff = (eP.v + lgEff * EFF_K) / (eT.v + EFF_K);
    if (rates.tsa > 0 && Number.isFinite(eff)) rates.pts = rates.tsa * eff;
  }
  const startRate = ew(recs.filter((r) => r.avail), (r) => r.st, 6, wPhase).avg;
  let minutes = minE.w ? minE.avg : (r2k ? clamp((r2k.ovr - 65) * 1.3, 6, 32) : 12);
  if (minE.w && minE.w < 2) minutes = minutes * 0.6 + (r2k ? clamp((r2k.ovr - 65) * 1.3, 6, 32) : 14) * 0.4;
  const res = p.res.slice(-15);
  const bias = {};
  for (const s of ["pts", "reb", "ast"]) { const a = res.map((x) => x[s]); bias[s] = a.length ? (mean(a) * a.length) / (a.length + 10) * 0.5 : 0; }
  const usage = rates.tsa + rates.to; // shot + turnover possessions per minute
  return { minutes, rates, startRate, bias, usage, games: played.length, r2k, lastDate: played.at(-1)?.date, recs };
}

// ------------------------------------------------------------------ scenarios
function role(base) {
  if (base.rates.pts * base.minutes >= 19) return "star";
  if (base.minutes >= 25) return "starter";
  return "bench";
}

const SCHED = new Map(); // tid -> not-yet-played games [{date, home}]
// Arena location: [latitude, longitude, hours from UTC, 1 = high altitude]
const ARENA = {
  ATL: [33.76, -84.4, -5, 0], BOS: [42.37, -71.06, -5, 0], BKN: [40.68, -73.98, -5, 0], CHA: [35.23, -80.84, -5, 0], CHI: [41.88, -87.67, -6, 0],
  CLE: [41.5, -81.69, -5, 0], DAL: [32.79, -96.81, -6, 0], DEN: [39.75, -105.01, -7, 1], DET: [42.34, -83.06, -5, 0], GS: [37.77, -122.39, -8, 0],
  HOU: [29.75, -95.36, -6, 0], IND: [39.76, -86.16, -5, 0], LAC: [33.95, -118.34, -8, 0], LAL: [34.04, -118.27, -8, 0], MEM: [35.14, -90.05, -6, 0],
  MIA: [25.78, -80.19, -5, 0], MIL: [43.05, -87.92, -6, 0], MIN: [44.98, -93.28, -6, 0], NO: [29.95, -90.08, -6, 0], NY: [40.75, -73.99, -5, 0],
  OKC: [35.46, -97.52, -6, 0], ORL: [28.54, -81.38, -5, 0], PHI: [39.9, -75.17, -5, 0], PHX: [33.45, -112.07, -7, 0], POR: [45.53, -122.67, -8, 0],
  SAC: [38.58, -121.5, -8, 0], SA: [29.43, -98.44, -6, 0], TOR: [43.64, -79.38, -5, 0], UTAH: [40.77, -111.9, -7, 1], WSH: [38.9, -77.02, -5, 0],
};
Object.assign(ARENA, { GSW: ARENA.GS, NOP: ARENA.NO, NYK: ARENA.NY, SAS: ARENA.SA, UTA: ARENA.UTAH, WAS: ARENA.WSH });
const arenaOf = (tid) => ARENA[teamById[tid]?.abbr] || null;
function milesBetween(a, b) {
  const rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(x));
}
const NOBOX_T = new Map(); // tid -> finished games known by final score only, added as the walk reaches them
function teamSchedule(tid, g) {
  const date = g.date;
  // every finished game before this one (box score or final score only), oldest first
  const nb = (NOBOX_T.get(tid) || []).filter((r) => r.date < date);
  const played = nb.length ? [...getT(tid).recs.filter((r) => r.date < date), ...nb].sort((a, b) => a.date.localeCompare(b.date)) : getT(tid).recs.filter((r) => r.date < date);
  const recs = [...played, ...(SCHED.get(tid) || []).filter((r) => r.date < date)];
  const last = recs.at(-1);
  // Rest is counted in US calendar days (etDay), never UTC dates: an evening tip falls on the
  // next UTC day and an afternoon tip does not, which used to invent and hide back-to-backs.
  const rest = last ? Math.max(0, gameDaysBetween(last.date, date) - 1) : 3;
  const in4 = recs.filter((r) => gameDaysBetween(r.date, date) <= 3).length;
  let away = 0; for (let i = recs.length - 1; i >= 0 && !recs[i].home; i--) away++;
  const seasonGames = recs.filter((r) => r.season === g.season && r.stype === g.stype).length;
  // travel, time zones, altitude
  const here = g.neutral ? null : arenaOf(g.home);
  const from = last ? arenaOf(last.home ? tid : last.opp) : arenaOf(tid);
  const travel = here && from ? Math.round(milesBetween(from, here)) : 0;
  const tz = here && from ? here[2] - from[2] : 0; // positive = travelled east
  const altitude = !!here && here[3] === 1 && g.home !== tid;
  // momentum (only when the previous game has been played)
  const lp = played.at(-1), fresh = lp && lp === last;
  let streak = 0;
  for (let i = played.length - 1; i >= 0 && played[i].season === g.season && played[i].stype !== 1; i--) {
    const w = played[i].margin > 0;
    if (streak === 0) streak = w ? 1 : -1; else if ((streak > 0) === w) streak += w ? 1 : -1; else break;
  }
  // A streak is only attached when the team's previous scheduled game has been played: for a game
  // two or three ahead it may be over by then.
  return { rest, b2b: !!last && rest === 0, threeIn4: in4 >= 2, roadStreak: away, lastHome: last?.home, seasonGames, travel, tz, altitude,
    lastMargin: fresh ? lp.margin : null, lastOT: fresh ? !!lp.ot : false, streak: fresh ? streak : 0 };
}

// scenario keys that can be known BEFORE tip-off
function preGameScenarios(pl, ctxGame) {
  const s = [];
  const { sched, oppSched, home, neutral, teamOut, oppOut, phase, expPace, teamPace, margin, oppStyle, pr, oppTeam } = ctxGame;
  if (sched.b2b) s.push("back-to-back");
  if (sched.threeIn4) s.push("3 games in 4 nights");
  if (sched.rest >= 3) s.push("3+ days rest");
  if (!home && sched.roadStreak >= 3) s.push("long road trip (4th+ away game)");
  if (home && sched.lastHome === false && sched.roadStreak === 0) s.push("first home game after road trip");
  if (oppSched.b2b) s.push("opponent on back-to-back");
  if (sched.travel >= 1000 && sched.rest <= 1) s.push("long flight since last game (1,000+ miles)");
  if (sched.tz >= 2 && sched.rest <= 1) s.push("travelled 2+ time zones east");
  if (sched.tz <= -2 && sched.rest <= 1) s.push("travelled 2+ time zones west");
  if (sched.altitude) s.push("visiting at altitude (Denver / Utah)");
  if (!neutral) s.push(home ? "home" : "away");
  if (phase.stype === 1) s.push("preseason");
  if (phase.stype === 3) s.push("playoffs");
  if (sched.seasonGames < 8 && phase.stype === 2) s.push("early season");
  const topOut = teamOut.filter((o) => o.id !== pl.id);
  if (topOut.some((o) => o.star)) s.push("teammate star out");
  if (topOut.some((o) => o.handler)) s.push("main ball-handler out");
  if (topOut.some((o) => o.big) && pl.g !== "G") s.push("teammate big out");
  if (oppOut.some((o) => o.star)) s.push("opponent star out");
  if (oppOut.some((o) => o.big)) s.push("opponent big out");
  if (oppOut.some((o) => o.g === pl.g && o.stopper)) s.push("opposing stopper at his position out");
  if (pr.returning) s.push("returning from absence (first 2 games)");
  if (pr.revenge) s.push("facing former team");
  if (pr.hot) s.push("hot streak (last 3 games well above projection)");
  if (pr.cold) s.push("cold streak (last 3 games well below projection)");
  if (pr.allowedPts < 0.94) s.push("tough positional defense");
  if (pr.allowedPts > 1.06) s.push("weak positional defense");
  if (expPace > teamPace + 2.5) s.push("faster pace than usual");
  if (expPace < teamPace - 2.5) s.push("slower pace than usual");
  if (Math.abs(margin) > 11) s.push(pl.st ? "projected blowout (starter)" : "projected blowout (bench)");
  if (Math.abs(margin) < 3) s.push("projected close game");
  if (pr.shooter && oppStyle.tags.includes("Allows lots of 3s")) s.push("shooter vs defense that allows 3s");
  if (pr.paintScorer && oppStyle.tags.includes("Soft interior D")) s.push("paint scorer vs soft interior");
  if (pr.paintScorer && oppStyle.tags.includes("Elite defense")) s.push("paint scorer vs elite defense");
  if (pr.fatigue) s.push("heavy minutes load (last 4 days)");
  if (pr.newsLimit) s.push("news: minutes limit / questionable");
  return s;
}

const scenKey = (s, r, stat) => `${s}|${r}|${stat}`;
const ALL = "all games";
function scenEffect(list, r, stat) {
  let e = 0;
  for (const s of [ALL, ...list]) { const k = learn.scen[scenKey(s, r, stat)]; if (k) e += k.w; }
  return clamp(e, stat === "min" ? -10 : -8, stat === "min" ? 10 : 8);
}
// Each scenario that applied to this game takes a small share of the leftover error
// (after every adjustment), so overlapping scenarios do not double count.
function scenLearn(list, r, stat, resid, rawResid) {
  const keys = [ALL, ...list];
  const share = 1 / Math.sqrt(keys.length);
  for (const s of keys) {
    const k = scenKey(s, r, stat);
    const o = (learn.scen[k] ||= { w: 0, n: 0, raw: 0 });
    o.n++; o.raw += rawResid;
    o.w = clamp(o.w + resid * share * Math.max(1 / (o.n + 25), 0.004), -8, 8);
  }
}

// ------------------------------------------------------------------ matchup splits
// Who the player is facing tonight: defenders by position, key opponents, archetypes, size.
function opponentInfo(O, g) {
  const act = O.active.filter((r) => r.base.games > 0);
  const posDef = {}, archByGroup = { G: new Set(), F: new Set(), C: new Set() };
  for (const grp of ["G", "F", "C"]) {
    const rows = act.filter((r) => r.p.g === grp && r.base.minutes >= 12);
    const w = rows.reduce((s, r) => s + r.base.minutes, 0);
    posDef[grp] = w ? rows.reduce((s, r) => s + r.base.minutes * ctx.defScore(r.p.n, g.date), 0) / w : 0;
    for (const r of rows.filter((r) => r.base.minutes >= 20)) { const a = ctx.archetype(r.p.n, g.date, !g.completed); if (a) archByGroup[grp].add(a); }
  }
  const top = [...act].sort((a, b) => b.base.minutes - a.base.minutes).filter((r) => r.base.minutes >= 24).slice(0, 5).map((r) => r.p);
  const avgH = (rows) => { const hs = rows.map((r) => ctx.height(r.p.n)).filter(Boolean); return hs.length ? mean(hs) : null; };
  const byMin = (grps) => act.filter((r) => grps.includes(r.p.g)).sort((a, b) => b.base.minutes - a.base.minutes).slice(0, 2);
  return { posDef, archByGroup, top, guardH: avgH(byMin(["G"])), bigH: avgH(byMin(["F", "C"])) };
}

const SPLIT_W = { opp: 0.4, arena: 0.4, vs: 0.5, vsArch: 0.35, oppGuards: 0.35, oppBigs: 0.35, style: 0.3, rest: 0.3 };
const SPLIT_CAP = { pts: 3.5, tpa: 2.5, reb: 2.5, ast: 2.5, min: 4 };
function splitKeys(p, S, O, g, isHome, info) {
  const k = [`opp:${O.tid}`];
  if (!isHome && !g.neutral) k.push(`arena:${g.home}`);
  for (const q of info.top) k.push(`vs:${q.id}`);
  for (const a of info.archByGroup[p.g] || []) k.push(`vsArch:${a}`);
  if (info.guardH) k.push(`oppGuards:${info.guardH < 75 ? "small" : info.guardH > 77 ? "big" : "avg"}`);
  if (info.bigH) k.push(`oppBigs:${info.bigH < 80 ? "small" : info.bigH > 82 ? "big" : "avg"}`);
  for (const t of O.style.tags) k.push(`style:${t}`);
  k.push(`rest:${S.sched.b2b ? "b2b" : S.sched.rest >= 2 ? "rested" : "1day"}`);
  return k;
}
function splitLabel(key) {
  const [type, v] = key.split(/:(.*)/s);
  const ab = (id) => teamById[id]?.abbr || id;
  switch (type) {
    case "opp": return `vs ${ab(v)}`;
    case "arena": return `at ${ab(v)} arena`;
    case "vs": return `when ${P.get(v)?.n || v} plays`;
    case "vsArch": return `vs ${v}s at his position`;
    case "oppGuards": return `vs ${v === "avg" ? "average-size" : v} backcourts`;
    case "oppBigs": return `vs ${v === "avg" ? "average-size" : v} frontcourts`;
    case "style": return `vs ${v} teams`;
    case "rest": return { b2b: "on back-to-backs", rested: "with 2+ days rest", "1day": "on one day of rest" }[v] || v;
    default: return key;
  }
}
// Each split is measured RELATIVE to the player's own overall gap against projection across all
// his games (p.splitAll), so a player who was under-projected everywhere (a rookie, a breakout)
// does not show the same +8 in every situation. Minimum games before a split is used or listed:
// 5 for a specific opponent, opposing player or arena (head-to-head is capped by the schedule at
// 3-4 meetings a season), 8 for situations, styles, sizes and archetypes. Under 10 = small sample.
// CL_SPLITS=old restores the previous rule (absolute gap, 2+ games) for an ablation run.
const SPLIT_MIN = { opp: 5, vs: 5, arena: 5 }, SPLIT_MIN_DEFAULT = 8, SPLIT_SMALL = 10;
const splitMin = (type) => SPLIT_MIN[type] ?? SPLIT_MIN_DEFAULT;
const SPLITS_OLD = process.env.CL_SPLITS === "old";
const SPLIT_TEAM = process.env.CL_SPLIT_TEAM === "on";
// The lists, notes and labels show the relative split. The projection takes the full gap in that
// situation (shrunk, with the same minimums): in the walk-forward test the relative version gave a
// slightly lower points error but called fewer winners (learning.json > inloop.splits). CL_SPLITS=relproj
// switches the projection to the relative split.
const SPLITS_ABSPROJ = process.env.CL_SPLITS !== "relproj";
const splitRel = (p, s, stat) => s[stat] / s.n - (p.splitAll?.n ? p.splitAll[stat] / p.splitAll.n : 0);
function splitAdjust(p, keys) {
  const adj = { pts: 0, tpa: 0, reb: 0, ast: 0, min: 0 };
  const notes = [];
  const cnt = {};
  const ok = (key, s) => s && (SPLITS_OLD ? s.n >= 2 : s.n >= splitMin(key.split(":")[0]));
  for (const key of keys) { const s = p.splits[key]; if (ok(key, s)) { const t = key.split(":")[0]; cnt[t] = (cnt[t] || 0) + 1; } }
  for (const key of keys) {
    const s = p.splits[key]; if (!ok(key, s)) continue;
    const type = key.split(":")[0];
    const w = (SPLIT_W[type] || 0.3) / cnt[type];
    const val = (stat) => (SPLITS_OLD ? s[stat] / s.n : splitRel(p, s, stat));
    // points, rebounds and assists already carry his overall gap (base.bias), so they take the relative
    // split; three-point attempts and minutes have no such term, so they keep the full gap in that situation
    for (const stat of Object.keys(adj)) adj[stat] += (SPLITS_ABSPROJ || stat === "tpa" || stat === "min" ? s[stat] / s.n : val(stat)) * (s.n / (s.n + 8)) * w;
    if ((SPLITS_OLD ? s.n >= 3 : true) && (Math.abs(val("pts")) >= 2.5 || Math.abs(val("tpa")) >= 1.5))
      notes.push({ key, label: splitLabel(key), n: s.n, pts: round(val("pts")), tpa: round(val("tpa")), reb: round(val("reb")), ast: round(val("ast")), small: s.n < SPLIT_SMALL });
  }
  for (const stat of Object.keys(adj)) adj[stat] = clamp(adj[stat], -SPLIT_CAP[stat], SPLIT_CAP[stat]);
  notes.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  return { adj, notes: notes.slice(0, 5) };
}

// ------------------------------------------------------------------ with/without (pairwise) impact
function withWithout(tid, pid, qid, date, season) {
  // p's per-minute points when teammate q played vs missed (this + last season, same team)
  // "Without" = every team game inside q's stint with the team in which he logged no minutes
  // (not only the games where the box score happened to list him), up to the game being projected.
  const q = P.get(qid), open = q?.stints.at(-1)?.team === tid;
  const recs = getT(tid).recs.filter((r) => r.date < date && (r.season === season || r.season === season - 1) && r.stype !== 1);
  const w = { min: 0, pts: 0, ast: 0, reb: 0, n: 0, gids: [] }, wo = { min: 0, pts: 0, ast: 0, reb: 0, n: 0, gids: [] };
  for (const r of recs) {
    const pp = r.box.get(pid); if (!pp || !pp.min) continue;
    const qPlayed = r.box.get(qid)?.min > 0;
    if (!qPlayed && (!onTeamAt(q, tid, r.date, open) || (WW_SKIP_CD && r.cd.has(qid)))) continue;
    const o = qPlayed ? w : wo;
    o.min += pp.min; o.pts += pp.pts; o.ast += pp.ast; o.reb += pp.reb; o.n++; o.gids.push(r.gid);
  }
  return { w, wo };
}

// ------------------------------------------------------------------ in-loop features: evidence built from earlier games
// Blowout evidence: residuals (actual minus the unscaled projection with this effect taken out) in
// past games decided by 15+ points, for the player, shrunk to his team's same-role players that
// season (the coach's habit), shrunk in turn to the league's same-role players.
const BLOW_K = { player: 4, team: 10 };
const blowCell = (o, side) => (o[side] ||= [0, 0, 0]);
function blowEvidence(p, tid, season, role) {
  const out = {};
  for (const side of ["w", "l"]) {
    const lg = BLOW.lg[role]?.[side] || [0, 0, 0], tm = BLOW.team[`${tid}|${season}|${role}`]?.[side] || [0, 0, 0], me = p.blow[side];
    const lgMin = lg[0] ? lg[1] / (lg[0] + 20) : 0, lgPts = lg[0] ? lg[2] / (lg[0] + 20) : 0;
    const tMin = (tm[1] + lgMin * BLOW_K.team) / (tm[0] + BLOW_K.team), tPts = (tm[2] + lgPts * BLOW_K.team) / (tm[0] + BLOW_K.team);
    out[side] = { min: (me[1] + tMin * BLOW_K.player) / (me[0] + BLOW_K.player), pts: (me[2] + tPts * BLOW_K.player) / (me[0] + BLOW_K.player), n: me[0], teamN: tm[0], teamMin: tMin, teamPts: tPts };
  }
  return out;
}
function blowRecord(p, tid, season, role, side, resMin, resPts) {
  for (const o of [p.blow, (BLOW.team[`${tid}|${season}|${role}`] ||= {}), (BLOW.lg[role] ||= {})]) { const c = blowCell(o, side); c[0]++; c[1] += resMin; c[2] += resPts; }
}
// Game-flow evidence: points per minute on the floor in each script against his overall rate,
// shrunk toward that rate with 20 minutes of pseudo-time, and his usual minutes in that script.
const FLOW_K = 1200;
function flowEvidence(pid) {
  const s = FLOW.states(pid); if (!s || s.sec < 3600) return null;
  const all = s.pts / s.sec;
  const d = (k) => { const o = s.st[k]; return { d: ((o.pts + all * FLOW_K) / (o.sec + FLOW_K) - all) * 60, mpg: o.games ? o.sec / 60 / o.games : 0, games: o.games, min: o.sec / 60, ppm: o.sec ? o.pts / o.sec * 60 : null }; };
  return { ppm: all * 60, games: s.games, ahead: d("ahead"), behind: d("behind"), tight: d("tight"), normal: d("normal") };
}
// His points per minute with another player on the floor versus off it (games both played),
// shrunk toward the "on" rate with 10 minutes of pseudo-time. Needs 30+ minutes each way.
const PAIR_K = 600;
function pairDiff(pid, qid, opp) {
  const w = FLOW.withPlayer(pid, qid, opp); if (!w || w.secOn < 1800 || w.secOff < 1800) return null;
  const rOn = w.ptsOn / w.secOn, rOff = (w.ptsOff + rOn * PAIR_K) / (w.secOff + PAIR_K);
  return { d: (rOff - rOn) * 60, games: w.games, minOn: w.secOn / 60, minOff: w.secOff / 60 };
}
// Return from an absence: which game back this is (1 = first) and how many games he missed in a
// row before it (this season, regular season / play-in / playoffs only, while on the team).
function returnState(p, tid, date, season) {
  const tr = getT(tid).recs;
  let j = tr.length - 1; while (j >= 0 && tr[j].date >= date) j--;
  const skip = (r) => r.stype === 1;
  let k = 1;
  while (j >= 0 && (skip(tr[j]) || tr[j].box.get(p.id)?.min > 0)) { if (!skip(tr[j])) k++; j--; if (k > RET_GAMES) return null; }
  let missed = 0;
  while (j >= 0 && tr[j].season === season && (skip(tr[j]) || !(tr[j].box.get(p.id)?.min > 0)) && onTeamAt(p, tid, tr[j].date, true)) { if (!skip(tr[j])) missed++; j--; if (missed > 82) break; }
  if (j < 0 || !(tr[j].box.get(p.id)?.min > 0)) return null;
  const b = retBucket(missed); if (!b) return null;
  const before = p.recs.filter((r) => r.date < tr[j].date + "~" && r.min > 0 && r.stype !== 1).slice(-10);
  return { k, missed, b, preMin: before.length ? mean(before.map((r) => r.min)) : null, prePts: before.length ? mean(before.map((r) => r.pts)) : null };
}
// Absent players of one side with the share of the team's last 8 games each one played (a long
// absence is already in everybody's recent numbers, so it carries little weight).
function outWeighted(S, date) {
  const last = getT(S.tid).recs.filter((rr) => rr.date < date).slice(-8);
  return [...S.outRows, ...S.satRows].map((o) => ({ ...o, wt: last.length ? last.filter((rr) => rr.box.get(o.p.id)?.min > 0).length / last.length : 0 }));
}
// Team on/off of the absent players: points per 100 possessions with each one on versus off,
// shrunk with 1,500 possessions, times the possessions he usually plays.
const ONOFF_K = 1500;
function onOffDiff(pid) {
  const o = FLOW.onOff(pid); if (!o || o.ortgOn == null || o.ortgOff == null) return null;
  const k = Math.min(o.possOn, o.possOff) / (Math.min(o.possOn, o.possOff) + ONOFF_K);
  return { off: (o.ortgOff - o.ortgOn) * k, def: (o.drtgOff - o.drtgOn) * k, possOn: o.possOn, possOff: o.possOff };
}
function teamOnOffX(own, opp, pace) {
  let x = 0;
  for (const o of own) { const d = onOffDiff(o.p.id); if (d) x += o.wt * d.off * pace * Math.min(1, o.base.minutes / 48) / 100; }
  for (const o of opp) { const d = onOffDiff(o.p.id); if (d) x += o.wt * d.def * pace * Math.min(1, o.base.minutes / 48) / 100; }
  return x;
}

// ------------------------------------------------------------------ projection for one team in one game
function projectTeam(g, tid, oid, isHome, known) {
  const date = g.date, season = g.season;
  const phase = phaseOf(g.season, g.stype);
  const style = teamProfile(tid, season, date), oStyle = teamProfile(oid, season, date);
  const sched = teamSchedule(tid, g), oppSched = teamSchedule(oid, g);
  const lg = leagueNow();

  // Who is available: `known.available` = players expected to play, `known.out` = known absences.
  const roster = known.roster.map((pid) => P.get(pid)).filter(Boolean);
  const rows = roster.map((p) => ({ p, base: playerBaseline(p, season, date) }));
  const outSet = new Set(known.out);
  const questionable = new Set(known.questionable || []);
  // known.sat (upcoming games only): players who did not play in the team's previous game and are
  // not on the injury list. A regular starter among them is taken to have had a night off and is
  // expected back; a bench player is left out of tonight's rotation (the same assumption the
  // live-like back-test track makes), and his recent minutes are shared out like an absentee's.
  // He is not shown as "out": teamOut holds the injury list only.
  const satIds = new Set((known.sat || []).filter((id) => !outSet.has(id) && !questionable.has(id)));
  const sat = (r) => satIds.has(r.p.id) && r.base.startRate < 0.5;
  const active = rows.filter((r) => !outSet.has(r.p.id) && !sat(r));
  const outRows = rows.filter((r) => outSet.has(r.p.id) && r.base.games > 0 && r.base.minutes >= 8);
  const satRows = rows.filter((r) => sat(r) && r.base.games > 0);

  // Identify roles of absentees (star / handler / big / stopper) for scenario detection.
  const tag = (rowsArr) => {
    const byPts = [...rowsArr].sort((a, b) => b.base.rates.pts * b.base.minutes - a.base.rates.pts * a.base.minutes);
    const byAst = [...rowsArr].sort((a, b) => b.base.rates.ast * b.base.minutes - a.base.rates.ast * a.base.minutes);
    const byReb = [...rowsArr].sort((a, b) => b.base.rates.reb * b.base.minutes - a.base.rates.reb * a.base.minutes);
    return (r) => ({
      id: r.p.id, n: r.p.n, g: r.p.g, min: r.base.minutes,
      star: byPts.slice(0, 2).includes(r) && r.base.rates.pts * r.base.minutes >= 16,
      handler: byAst[0] === r && r.base.rates.ast * r.base.minutes >= 4.5,
      big: byReb[0] === r && r.base.rates.reb * r.base.minutes >= 7,
      stopper: ctx.defScore(r.p.n, date) > 0.8 && r.base.minutes >= 20,
      ppg: r.base.rates.pts * r.base.minutes,
    });
  };
  const teamOut = outRows.map(tag(rows));
  return { tid, oid, isHome, style, oStyle, sched, oppSched, rows, active, outRows, satRows, teamOut, questionable, phase, lg };
}

function finishGame(g, H, A, known) {
  // Combine both sides (needs opponent info) and produce projections.
  const lg = H.lg;
  const neutral = g.neutral;
  const expPace = clamp(H.style.pace + A.style.pace - lg.pace, 88, 112);
  const homeAdv = neutral ? 0 : learn.homeAdv;
  const teamModel = (S, O, sign) => expPace * (S.style.off / 100) * (O.style.def / (lg.ppp * 100)) + sign * homeAdv / 2;
  let hModel = teamModel(H, A, 1), aModel = teamModel(A, H, -1);
  let marginGuess = hModel - aModel;

  const zlg = ZS.leagueNow();
  const cen = known.shadow ? CEN_RO : CEN; // a shadow (live-like) projection reads the running centres but never moves them
  const sdGuess = 1.7 / learn.a;
  const closeProb = phi((5 - marginGuess) / sdGuess) - phi((-5 - marginGuess) / sdGuess); // chance the game ends within 5, before player work
  cen.push("close", closeProb);
  // chances of a 15+ win and a 15+ loss for the home side, before player work (blowout features)
  const pBig = (m) => ({ w: 1 - phi((FLOW_RULE.far - m) / sdGuess), l: phi((-FLOW_RULE.far - m) / sdGuess) });
  const outBy = new Map([[H.tid, outWeighted(H, g.date)], [A.tid, outWeighted(A, g.date)]]);
  const sides = [[H, A, true], [A, H, false]].map(([S, O, isHome]) => {
    // ---- minutes ----
    const out = outBy.get(S.tid), oppOut = outBy.get(O.tid);
    const big = pBig(isHome ? marginGuess : -marginGuess);
    const players = S.active.map(({ p, base }) => {
      let min = base.minutes;
      const st = known.starters ? known.starters.has(p.id) : base.startRate > 0.5;
      if (st === true && base.startRate < 0.4) min = min * 0.5 + 27 * 0.5;
      if (known.starters && st === false && base.startRate > 0.6) min = min * 0.75;
      if (S.questionable.has(p.id)) min *= 0.8;
      return { p, base, st: !!st, min, extra: 0 };
    });
    // redistribute minutes of absent players, favouring same position group
    for (const o of out) {
      const pool = players.filter((x) => x.base.minutes > 4 || x.st);
      const wsum = pool.reduce((s, x) => s + x.min * (x.p.g === o.p.g ? 1.6 : 1), 0) || 1;
      for (const x of pool) x.extra += o.wt * o.base.minutes * (x.min * (x.p.g === o.p.g ? 1.6 : 1)) / wsum;
    }
    for (const x of players) x.min = Math.min(40, x.min + x.extra);
    [...players].sort((a, b) => b.min - a.min).forEach((x, i) => { if (i >= 12) x.min *= 0.2; else if (i >= 10) x.min *= 0.5; });
    let tot = players.reduce((s, x) => s + x.min, 0);
    for (let k = 0; k < 3 && tot > 0; k++) { const f = 240 / tot; players.forEach((x) => (x.min = Math.min(40, x.min * f))); tot = players.reduce((s, x) => s + x.min, 0); }

    // usage lost from absentees beyond what replacement minutes cover
    const lostUse = out.reduce((s, o) => s + o.wt * o.base.usage * o.base.minutes, 0);
    const lostAst = out.reduce((s, o) => s + o.wt * o.base.rates.ast * o.base.minutes, 0);
    const lostReb = out.reduce((s, o) => s + o.wt * o.base.rates.reb * o.base.minutes, 0);
    const coveredUse = players.reduce((s, x) => s + x.base.usage * x.extra, 0);
    const coveredAst = players.reduce((s, x) => s + x.base.rates.ast * x.extra, 0);
    const coveredReb = players.reduce((s, x) => s + x.base.rates.reb * x.extra, 0);
    const extraUse = Math.max(0, lostUse - coveredUse), extraAst = Math.max(0, lostAst - coveredAst), extraReb = Math.max(0, lostReb - coveredReb);
    const useW = players.reduce((s, x) => s + x.base.usage * x.min * (x.base.usage > 0.45 ? 1.4 : 1), 0) || 1;
    const astW = players.reduce((s, x) => s + x.base.rates.ast * x.min, 0) || 1;
    const rebW = players.reduce((s, x) => s + x.base.rates.reb * x.min, 0) || 1;

    const teamPace = S.style.pace;
    const paceF = Math.pow(expPace / teamPace, 0.85);
    const oppInfo = opponentInfo(O, g);
    const oppDefs = O.active.filter((r) => r.base.games > 0).map((r) => ({ id: r.p.id, n: r.p.n, g: r.p.g, min: r.base.minutes }));
    // opponent-level inputs for the learned matchup factors (zone defence, likely rim and perimeter defenders, tendencies)
    const oppIn = opponentInputs({ zs: ZS, ctx, centres: cen, oid: O.tid, date: g.date, lg: zlg, live: !g.completed, // current-season play-type tables only for games not yet played
      defenders: O.active.filter((r) => r.base.games > 0).map((r) => ({ n: r.p.n, g: r.p.g, min: r.base.minutes })) });
    // Minutes features move minutes between teammates, never the team's total: each player's x is
    // centred on the team (the balance is shared in proportion to projected minutes), so the 240-minute
    // rescaling does not undo or distort them. Without centring, the effects mostly tracked how far the
    // raw minutes summed from 240 and made published minutes worse.
    const pre = players.map((x) => {
      const be = blowEvidence(x.p, S.tid, g.season, x.st ? "starter" : "bench");
      const rs = returnState(x.p, S.tid, g.date, g.season), rc = rs ? RET.est(rs.b, rs.k) : null;
      return { be, rs, rc, blowMin: big.w * be.w.min + big.l * be.l.min, retMin: rc ? rc.min : 0 };
    });
    { const totMin = players.reduce((z, x) => z + x.min, 0) || 1;
      for (const k of ["blowMin", "retMin"]) { const sum = pre.reduce((z, q) => z + q[k], 0); players.forEach((x, i) => { pre[i][k] -= sum * x.min / totMin; }); } }
    const proj = players.map((x, xi) => {
      const { p, base } = x;
      const r = role(base);
      const al = O.style.allowed[p.g] || { pts: 1, reb: 1, ast: 1 };
      const defQ = oppInfo.posDef[p.g] || 0; // opponent defender quality at his position (z, point-in-time NBA.com hustle/defense)
      const res3 = p.res.slice(-3).map((z) => z.pts);
      const prevTeams = [...p.teamsPlayed].filter((t) => t !== S.tid);
      const lastGames = base.recs.filter((rr) => gameDaysBetween(rr.date, g.date) <= 4);
      const missedStreak = (() => { let n = 0; const tr = getT(S.tid).recs.filter((rr) => rr.date < g.date); for (let i = tr.length - 1; i >= 0; i--) { const b = tr[i].box.get(p.id); if (b && b.min > 0) break; n++; } return n; })();
      const sinceBack = (() => { const tr = getT(S.tid).recs.filter((rr) => rr.date < g.date).slice(-6); let k = 0; for (let i = tr.length - 1; i >= 0; i--) { if (tr[i].box.get(p.id)?.min > 0) k++; else break; } return { k, gapBefore: tr.length - k >= 3 ? 3 : 0 }; })();
      const scoring = ctx.playerStyle(p.n, g.date, !g.completed);
      const pr = {
        returning: missedStreak === 0 && sinceBack.k <= 2 && sinceBack.gapBefore >= 3 && base.games > 3,
        revenge: prevTeams.includes(O.tid),
        hot: res3.length === 3 && mean(res3) > 5, cold: res3.length === 3 && mean(res3) < -5,
        allowedPts: al.pts * (1 - 0.03 * defQ),
        shooter: base.rates.tpa / Math.max(0.01, base.rates.tsa) > 0.5 && base.rates.tpa * base.minutes >= 4,
        paintScorer: scoring ? scoring.paintShare > 0.5 : base.rates.tpa / Math.max(0.01, base.rates.tsa) < 0.2,
        fatigue: lastGames.reduce((s, rr) => s + rr.min, 0) > 72 && base.minutes > 28,
        newsLimit: known.newsLimit?.has(p.id),
      };
      const scen = preGameScenarios({ id: p.id, g: p.g, st: x.st }, {
        sched: S.sched, oppSched: S === H ? A.sched : H.sched, home: isHome, neutral, teamOut: S.teamOut, oppOut: O.teamOut,
        phase: S.phase, expPace, teamPace, margin: isHome ? marginGuess : -marginGuess, oppStyle: O.style, pr, oppTeam: O.tid,
      });
      let min = clamp(x.min + scenEffect(scen, r, "min"), 0, 44);
      if (pr.newsLimit) min *= 0.8;
      // learned matchup factors: x from pre-game information, effect = gate * coefficient * x (see lib/factors.mjs)
      const fin = playerInputs({ zs: ZS, ctx, centres: cen, name: p.n, pid: p.id, grp: p.g, min, rates: base.rates, opp: oppIn, date: g.date, closeProb, b2b: S.sched.b2b, in4: S.sched.threeIn4 });
      const fx = FXE.apply(fin.x);
      min = clamp(min + fx.min, 0, 44);
      // in-loop features (evidence from earlier games only; applied as far as each gate is open)
      const { be, rs, rc } = pre[xi];
      const fe = flowEvidence(p.id);
      const mates = [], opps = [];
      for (const o of out) { const d = pairDiff(p.id, o.p.id, false); if (d) mates.push({ id: o.p.id, n: o.p.n, wt: o.wt, ...d, x: o.wt * d.d * min }); }
      for (const o of oppOut) { const d = pairDiff(p.id, o.p.id, true); if (d) opps.push({ id: o.p.id, n: o.p.n, wt: o.wt, ...d, x: o.wt * d.d * min }); }
      // real defenders (NBA.com matchup tracking, games before this one), gated like every in-loop feature.
      // centred (default): who guards HIM against the team's average defender (team defence is already in
      // the projection). replace: minus the position-based adjustment for the covered share. pure: neither.
      // The position-based method (defQ in allowedPts) stays in the projection in every mode.
      const dm = MUS.scorer(p.id, p.g, oppDefs);
      const dmScale = base.rates.pts * min * paceF, dmOld = Math.pow(1 - 0.03 * defQ, 0.8) - 1;
      const ixX = {
        defReal: dm ? dmScale * (DM_MODE === "pure" ? dm.real : DM_MODE === "centred" ? dm.real - dm.team : DM_MODE === "shares" ? dm.real - dm.teamPrior : dm.real - dm.cover * dmOld) : 0, defPair: dm ? dmScale * dm.pair : 0,
        blowMin: pre[xi].blowMin, blowPts: big.w * be.w.pts + big.l * be.l.pts,
        flowPts: fe ? big.w * fe.ahead.d * fe.ahead.mpg + big.l * fe.behind.d * fe.behind.mpg + closeProb * fe.tight.d * fe.tight.mpg : 0,
        retMin: pre[xi].retMin, retPts: rc ? rc.pts : 0,
        mateOut: mates.reduce((z, m) => z + m.x, 0), oppOut: opps.reduce((z, m) => z + m.x, 0),
      };
      const ix = IX.apply(ixX);
      min = clamp(min + ix.min, 0, 44);
      const mF = min / Math.max(1, x.min);
      const useShare = extraUse * (base.usage * x.min * (base.usage > 0.45 ? 1.4 : 1)) / useW;
      const ppsa = base.rates.pts / Math.max(0.05, base.rates.tsa);
      // Pairwise with/without evidence: his scoring in the games an absent teammate missed versus
      // the games they shared. Counted for upcoming games and shown as evidence (adj.wwD), but NOT
      // applied to the projection: once "without" is counted properly (every game the teammate
      // missed, not only those where the box score listed him) the back-test is better without it
      // (learning.json > withWithout). CL_WW_MODE=apply turns it back on for an ablation run; the
      // estimate is then weighted by o.wt, because a long absence is already in his recent numbers.
      let wwPts = 0, wwNote = [], wwD = [];
      if (WW_APPLY || !g.completed) for (const o of out) {
        const { w, wo } = withWithout(S.tid, p.id, o.p.id, g.date, g.season);
        if (wo.n >= 3 && w.n >= 5 && w.min > 0 && wo.min > 0) {
          const diff = (wo.pts / wo.min - w.pts / w.min) * min * (wo.n / (wo.n + 6)) * o.wt;
          if (WW_APPLY && o.wt > 0) { wwPts += diff; wwNote.push(`${o.p.n} out: ${diff >= 0 ? "+" : ""}${round(diff)} pts (${wo.n} games without)`); }
          wwD.push({ id: o.p.id, n: o.p.n, diff, without: { n: wo.n, ppg: wo.pts / wo.n, mpg: wo.min / wo.n, gids: wo.gids }, with: { n: w.n, ppg: w.pts / w.n, mpg: w.min / w.n } });
        }
      }
      const formulaPts = useShare * ppsa;
      const absencePts = wwNote.length ? 0.5 * formulaPts + 0.5 * wwPts : formulaPts;
      const mult = {
        pts: paceF * Math.pow(pr.allowedPts, 0.8), reb: paceF * Math.pow(al.reb, 0.7), ast: paceF * Math.pow(al.ast, 0.7),
        tpm: paceF, stl: paceF, blk: paceF, to: paceF,
      };
      const out1 = { min };
      for (const s of STATS) out1[s] = base.rates[s] * min * mult[s];
      out1.pts += absencePts * mF;
      out1.ast += extraAst * (base.rates.ast * x.min) / astW * mF;
      out1.reb += extraReb * (base.rates.reb * x.min) / rebW * mF;
      out1.tpa = base.rates.tpa * min * paceF;
      // factor effects are part of the unscaled projection, so every later learner sees them
      out1.pts += fx.pts; out1.reb += fx.reb; out1.ast += fx.ast; out1.tpa += fx.tpa;
      out1.pts += ix.pts; // in-loop feature effects are part of the unscaled projection too
      out1.tpm += fx.tpa * (base.rates.tpm / Math.max(0.01, base.rates.tpa));
      // matchup splits learned game by game: vs this team, at this arena, vs specific opposing players,
      // vs defender archetypes, vs opponent size, vs opponent style, by rest
      const keys = splitKeys(p, S, O, g, isHome, oppInfo);
      const sp = splitAdjust(p, keys);
      const baseline = { min: x.min, pts: out1.pts, reb: out1.reb, ast: out1.ast, tpa: out1.tpa };
      out1.pts += base.bias.pts + scenEffect(scen, r, "pts") + sp.adj.pts;
      out1.reb += base.bias.reb + scenEffect(scen, r, "reb") + sp.adj.reb;
      out1.ast += base.bias.ast + scenEffect(scen, r, "ast") + sp.adj.ast;
      out1.tpa += sp.adj.tpa;
      out1.tpm += sp.adj.tpa * (base.rates.tpm / Math.max(0.01, base.rates.tpa));
      for (const s of [...STATS, "tpa"]) out1[s] = Math.max(0, out1[s]);
      out1.tsa = base.rates.tsa * min * mult.pts + useShare * mF;
      return {
        id: p.id, n: p.n, pos: p.pos, g: p.g, role: r, st: x.st, scen, baseline, proj: out1, ppsa, keys, sdPts: ptsSd(p, r),
        rates: base.rates, adj: { pace: paceF, defense: pr.allowedPts, matchups: sp.notes, splitPts: sp.adj.pts, splitTpa: sp.adj.tpa, absence: absencePts, bias: base.bias.pts, ww: wwNote, wwD },
        r2k: base.r2k?.ovr ?? null, fx, fin, opp: oppIn,
        ix, ixX, ixEv: { big, be, fe, rs, rc, mates, opps, dm, dmScale, dmOld },
      };
    });
    const f240 = 240 / Math.max(1, proj.reduce((s, x) => s + x.proj.min, 0));
    for (const x of proj) { x.rawPts = x.proj.pts; x.rawMin = x.proj.min; x.raw = { pts: x.proj.pts, reb: x.proj.reb, ast: x.proj.ast, tpa: x.proj.tpa, min: x.proj.min }; for (const k of Object.keys(x.proj)) x.proj[k] *= f240; x.f240 = f240; }
    return { S, O, isHome, proj };
  });

  // Team totals: blend bottom-up (players) with top-down (ratings) + team scenario effects.
  const teamScenarios = (S, O, isHome) => {
    const s = [];
    if (S.sched.b2b) s.push("back-to-back"); if (O.sched.b2b) s.push("opponent on back-to-back");
    if (S.sched.rest - O.sched.rest >= 2) s.push("rest advantage (2+ days)");
    if (!isHome && S.sched.roadStreak >= 3) s.push("long road trip");
    const stars = S.teamOut.filter((o) => o.star).length; if (stars === 1) s.push("one star out"); if (stars >= 2) s.push("two+ stars out");
    if (O.teamOut.some((o) => o.star)) s.push("opponent star out");
    if (S.phase.stype === 1) s.push("preseason"); if (S.phase.stype === 3) s.push("playoffs");
    if (S.sched.seasonGames < 8 && S.phase.stype === 2) s.push("early season");
    if (S.sched.travel >= 1000 && S.sched.rest <= 1) s.push("long flight since last game (1,000+ miles)");
    if (S.sched.tz >= 2 && S.sched.rest <= 1) s.push("travelled 2+ time zones east");
    if (S.sched.tz <= -2 && S.sched.rest <= 1) s.push("travelled 2+ time zones west");
    if (S.sched.altitude) s.push("visiting at altitude (Denver / Utah)");
    if (S.sched.lastMargin != null && S.sched.lastMargin <= -20) s.push("after a blowout loss");
    if (S.sched.lastMargin != null && S.sched.lastMargin >= 20) s.push("after a blowout win");
    if (S.sched.lastOT && S.sched.rest <= 1) s.push("after an overtime game");
    if (S.sched.streak >= 4) s.push("on a 4+ game win streak");
    if (S.sched.streak <= -4) s.push("on a 4+ game losing streak");
    for (const tg of O.style.tags) s.push(`vs ${tg}`);
    return s;
  };
  const totals = sides.map((side) => {
    const sumPts = side.proj.reduce((s, x) => s + x.proj.pts, 0);
    // SPLIT_TEAM off: the team-level blend and the player build-up model use the player sum without the
    // personal matchup splits (they redistribute points between players more than they move a team)
    const sumTeam = SPLIT_TEAM ? sumPts : side.proj.reduce((s, x) => s + Math.max(0, x.proj.pts - x.adj.splitPts * (x.f240 || 1)), 0);
    const model = side.isHome ? hModel : aModel;
    const ts = teamScenarios(side.S, side.O, side.isHome);
    let eff = 0; for (const k of [ALL, ...ts]) eff += learn.teamScen[k]?.w || 0;
    eff = clamp(eff, -10, 10);
    // team vs opponent style history (residual-based)
    let vs = 0; for (const tg of side.O.style.tags) { const v = getT(side.S.tid).vsStyle[tg]; if (v && v.n >= 4) vs += (v.off / (v.n + 6)) * 0.4; }
    vs = clamp(vs, -4, 4);
    const tx = IXT.apply({ teamOnOff: teamOnOffX(outBy.get(side.S.tid), outBy.get(side.O.tid), expPace) }); // on/off of absent players, gated
    const pts = 0.25 * sumTeam + 0.75 * model + eff + vs + tx.tpts; // blend weight chosen from the back-test
    return { ...side, sumPts, sumTeam, model, teamScen: ts, teamEff: eff, vsStyle: vs, tx, pts, rawPts: pts };
  });
  // ---- ensemble of independent rating systems for the margin ----
  const rm = ratingMargins(g, expPace, homeAdv);
  const models = { efficiency: hModel - aModel, players: totals[0].sumTeam - totals[1].sumTeam, elo: rm.elo, adjusted: rm.adjusted, luckAdjusted: rm.luckAdjusted };
  const ensemble = MODEL_KEYS.reduce((s, k) => s + learn.w[k] * models[k], 0);
  let ref = { tot: 0, home: 0 };
  {
    const [h0, a0] = totals;
    const tot = h0.pts + a0.pts;
    const rawM = ensemble + (h0.teamEff - a0.teamEff) + (h0.vsStyle - a0.vsStyle) + (h0.tx.tpts - a0.tx.tpts);
    h0.rawPts = (tot + rawM) / 2; a0.rawPts = (tot - rawM) / 2;
    // calibrate the margin with the learned shrink factor (keeps probabilities honest)
    const m = rawM * learn.k;
    h0.pts = (tot + m) / 2; a0.pts = (tot - m) / 2;
    // referee crew tendency (crews are announced on the morning of the game)
    const crew = (g.officials || []).map((n) => learn.refs[n]).filter((r) => r && r.n >= 15);
    if (crew.length >= 2) {
      ref = { tot: clamp(mean(crew.map((r) => r.tot / (r.n + 30))), -3, 3), home: clamp(mean(crew.map((r) => r.home / (r.n + 30))), -1.5, 1.5) };
      h0.pts += ref.tot / 2 + ref.home / 2; a0.pts += ref.tot / 2 - ref.home / 2;
    }
  }
  // scale players to match team total
  // fxNet = what the learned factor effects are worth in the PUBLISHED points: take the effects out
  // for the whole team, re-blend the team total (it takes 25% of the player sum) and compare.
  // An opponent-wide effect is largely cancelled by the rescaling, so fxNet is usually well below
  // the unscaled fx.pts the coefficient was validated on.
  for (const t of totals) {
    const f = t.pts / Math.max(1, t.sumPts);
    const noFx = t.proj.map((x) => (x.raw.pts > 0 ? Math.max(0, x.raw.pts - x.fx.pts) * (x.proj.pts / x.raw.pts) : x.proj.pts));
    const sumNo = noFx.reduce((s, v) => s + v, 0), fNo = (t.pts - 0.25 * (t.sumPts - sumNo)) / Math.max(1, sumNo);
    t.proj.forEach((x, i) => { x.fxNet = x.proj.pts * f - noFx[i] * fNo; x.proj.pts *= f; });
  }
  const [h, a] = totals;
  const margin = h.pts - a.pts;
  const pHome = 1 / (1 + Math.exp(-learn.a * margin)); // slope learned from results, keeps percentages honest
  const sdM = 1.7 / learn.a;
  const within = (x) => phi((x - margin) / sdM) - phi((-x - margin) / sdM);
  return { h, a, margin, pHome, expPace, homeAdv, models, ensemble, ref, shape: { close: within(5), blowout: 1 - within(15) }, pBig: pBig(marginGuess), closeProb };
}

// ------------------------------------------------------------------ rating systems used by the ensemble
// Proven public methods, each kept as its own model so the back-test can score them separately:
//   elo          - Elo with margin-of-victory multiplier and season carry-over
//   adjusted     - opponent-adjusted offensive/defensive efficiency (strength of schedule built in)
//   luckAdjusted - the same, but with 3-point shooting luck removed from every past score
const MODEL_KEYS = ["efficiency", "players", "elo", "adjusted", "luckAdjusted"];
const MODEL_LABEL = { efficiency: "Recent efficiency (pace x offence x defence)", players: "Player-by-player build-up (who is actually playing)", elo: "Elo with margin of victory", adjusted: "Opponent-adjusted efficiency", luckAdjusted: "Opponent-adjusted, 3-point luck removed" };
const ELO_HFA = 65;
const rt = (tid) => (learn.rt[tid] ||= { elo: 1500, o: 0, d: 0, n: 0, oL: 0, dL: 0, tpm: 0, tpa: 0, season: null });
function ratingMargins(g, pace, homeAdv) {
  const h = rt(g.home), a = rt(g.away);
  const hca100 = homeAdv * 100 / pace;
  return {
    elo: (h.elo - a.elo + (g.neutral ? 0 : ELO_HFA)) / 28,
    adjusted: ((h.o + a.d) - (a.o + h.d) + hca100) * pace / 100,
    luckAdjusted: ((h.oL + a.dL) - (a.oL + h.dL) + hca100) * pace / 100,
  };
}
function updateRatings(g, eloOnly = false) {
  if (g.stype === 1) return; // preseason results do not move ratings
  const h = rt(g.home), a = rt(g.away);
  for (const r of [h, a]) {
    if (r.season !== null && r.season !== g.season) { r.elo = 0.75 * r.elo + 0.25 * 1505; for (const k of ["o", "d", "oL", "dL"]) r[k] *= 0.6; r.n = Math.min(r.n, 8); r.tpm *= 0.3; r.tpa *= 0.3; }
    r.season = g.season;
  }
  // Elo
  const d = h.elo - a.elo + (g.neutral ? 0 : ELO_HFA), mov = g.hs - g.as;
  const we = 1 / (1 + 10 ** (-d / 400)), won = mov > 0 ? 1 : 0;
  const mult = (Math.abs(mov) + 3) ** 0.8 / (7.5 + 0.006 * (won ? d : -d));
  const shift = 20 * mult * (won - we);
  h.elo += shift; a.elo -= shift;
  if (eloOnly) return; // a game known by its final score only: no possessions or threes to rate
  // opponent-adjusted efficiency, raw and with 3-point luck removed
  const bh = boxTotals(g, g.home), ba = boxTotals(g, g.away);
  const poss = Math.max(60, (bh.poss + ba.poss) / 2);
  const lgNow = leagueNow(), lg = lgNow.ppp * 100;
  const lg3 = league.tpa > 2000 ? league.tpm / league.tpa : 0.36;
  const x3 = (r) => (r.tpm + lg3 * 400) / (r.tpa + 400);
  const hca = g.neutral ? 0 : learn.homeAdv * 100 / lgNow.pace / 2;
  const hsL = g.hs - 3 * (bh.tpm - bh.tpa * x3(h)), asL = g.as - 3 * (ba.tpm - ba.tpa * x3(a));
  const kh = Math.max(0.08, 1.5 / (h.n + 6)) * 0.5, ka = Math.max(0.08, 1.5 / (a.n + 6)) * 0.5;
  for (const [o, dd, hp, ap] of [["o", "d", g.hs, g.as], ["oL", "dL", hsL, asL]]) {
    const eH = hp / poss * 100 - (lg + h[o] + a[dd] + hca), eA = ap / poss * 100 - (lg + a[o] + h[dd] - hca);
    h[o] += kh * eH; a[dd] += ka * eH; a[o] += ka * eA; h[dd] += kh * eA;
  }
  h.n++; a.n++;
  h.tpm = h.tpm * 0.995 + bh.tpm; h.tpa = h.tpa * 0.995 + bh.tpa; a.tpm = a.tpm * 0.995 + ba.tpm; a.tpa = a.tpa * 0.995 + ba.tpa;
}

const ROLE_SD = { star: 7.5, starter: 6, bench: 4.5 };
function ptsSd(p, r) {
  const a = p.res.slice(-30).map((x) => x.pts), n = a.length, d = ROLE_SD[r] || 5;
  const v = n >= 2 ? sd(a) ** 2 : d * d;
  return Math.sqrt((n * v + 8 * d * d) / (n + 8));
}

// ------------------------------------------------------------------ actual game → records + explanation
function boxTotals(g, tid) {
  const ps = g.players.filter((x) => x.t === tid);
  const sum = (k) => ps.reduce((s, x) => s + (x[k] || 0), 0);
  const tm = g.teams.find((x) => x.id === tid) || {};
  const teamTO = Number(tm.teamTurnovers || 0);
  const tb = teamBox(g, tid); // ESPN's own team row; the player sum is only the fallback (a player row can be missing)
  const r = tb ? { fga: tb.fga, fgm: tb.fgm, fta: tb.fta, ftm: tb.ftm, tpa: tb.tpa, tpm: tb.tpm, oreb: tb.oreb, dreb: tb.dreb, tov: tb.to + teamTO, ast: tb.ast, pts: tid === g.home ? g.hs : g.as }
    : { fga: sum("fga"), fgm: sum("fgm"), fta: sum("fta"), ftm: sum("ftm"), tpa: sum("tpa"), tpm: sum("tpm"), oreb: sum("oreb"), dreb: sum("dreb"), tov: sum("to") + teamTO, ast: sum("ast"), pts: sum("pts") };
  r.poss = r.fga - r.oreb + r.tov + 0.44 * r.fta;
  r.paint = Number(tm.pointsInPaint || 0); r.fb = Number(tm.fastBreakPoints || 0);
  r.efg = r.fga ? (r.fgm + 0.5 * r.tpm) / r.fga : 0;
  return r;
}

function explainPlayer(pp, act, g, teamMargin) {
  // Exact decomposition of points error: minutes + usage (shot volume) + efficiency
  const pr = pp.proj;
  const rTsa = pr.tsa / Math.max(1, pr.min);
  const typ = pr.pts / Math.max(0.5, pr.tsa);
  const aTsa = tsa(act);
  const minutes = (act.min - pr.min) * rTsa * typ;
  const usage = (aTsa - act.min * rTsa) * typ;
  const efficiency = act.pts - aTsa * typ;
  const tags = [];
  if (act.dnp && pr.min > 8) tags.push(INJURY_DNP(act.why) ? "Late scratch / injury" : "Unexpected DNP (coach)");
  if (act.ej) tags.push("Ejected");
  if (act.pf >= 5 && act.min < pr.min - 3) tags.push("Foul trouble");
  if (Math.abs(teamMargin) >= 20 && act.min < pr.min - 5) tags.push("Blowout minutes cut");
  if (!act.dnp && act.min < pr.min * 0.5 && act.pf < 5 && Math.abs(teamMargin) < 20 && pr.min > 15) tags.push("Left early / limited");
  if (g.periods > 4 && act.min > pr.min + 4) tags.push("Overtime minutes");
  if (act.min > pr.min + 8 && g.periods === 4) tags.push("Expanded role");
  if (aTsa >= 8 && act.pts / aTsa - typ > 0.3) tags.push("Hot shooting");
  if (aTsa >= 8 && act.pts / aTsa - typ < -0.3) tags.push("Cold shooting");
  if (act.tpm - pr.tpm >= 3) tags.push("Hot from three"); if (pr.tpm - act.tpm >= 2.5 && act.tpa >= 5) tags.push("Cold from three");
  if (usage >= 5) tags.push("Usage spike"); if (usage <= -5) tags.push("Usage drop");
  return { minutes, usage, efficiency, tags };
}

// ------------------------------------------------------------------ main walk-forward loop
const results = [];          // per game summary
const details = {};          // per game detail (written to files)
const ledger = [];           // per game error attribution rows
const playerGameRes = [];    // for tradeoff / buhat analysis: {gid, tid, pid, pts, ast, reb, res...}

function knownFromBox(g, tid) {
  // What was public before tip-off: injury report (inactive / out), starting lineup, roster.
  const box = g.players.filter((x) => x.t === tid);
  const t = getT(tid);
  const recent = t.recs.slice(-10);
  const rosterIds = new Set(box.map((x) => x.id));
  for (const r of recent) for (const pid of r.box.keys()) { const pl = P.get(pid); if (pl && pl.team === tid) rosterIds.add(pid); }
  const out = [];
  const injOut = new Set(g.inj.filter((i) => i.t === tid && /out|doubtful/i.test(i.s)).map((i) => i.id));
  for (const pid of rosterIds) {
    const b = box.find((x) => x.id === pid);
    if (!b) { out.push(pid); continue; }
    if (b.dnp && (INJURY_DNP(b.why) || injOut.has(pid))) out.push(pid);
  }
  // players in the box without history still need a state entry
  for (const b of box) getP(b.id, b.n, b.pos);
  return { roster: [...rosterIds], out, starters: new Set(box.filter((x) => x.st).map((x) => x.id)) };
}

// ---- one roster rule for games that have not been played (and for the live-like back-test track) ----
// A player is expected to take the floor when he logged minutes in one of the team's last
// ROSTER_RECENT games and still belongs to the team. Rostered players with no recent minutes are
// not given default minutes; they come in only as recent arrivals from another team or through
// the injury list (out, or back and questionable).
const ROSTER_RECENT = 10;
function recentIds(tid) {
  const ids = new Set();
  for (const r of getT(tid).recs.slice(-ROSTER_RECENT)) for (const pid of r.box.keys()) ids.add(pid);
  return ids;
}
// Live-like knowledge for a finished game: no starting line-ups and no inactive list. The stored
// injury list of a past game is not point-in-time (it is ESPN's list on the day the game was
// downloaded), so it is not used; a player is assumed out only when he missed his team's
// previous game. Trades are public, so a player in tonight's box whose last game was for
// another team is counted as an arrival.
function knownLiveLike(g, tid) {
  const t = getT(tid), last = t.recs.at(-1);
  const ids = new Set([...recentIds(tid)].filter((pid) => P.get(pid)?.team === tid));
  for (const b of g.players) if (b.t === tid && !ids.has(b.id)) { const p = P.get(b.id); if (p && p.team && p.team !== tid && p.recs.some((r) => r.min > 0)) ids.add(b.id); }
  const out = [...ids].filter((pid) => P.get(pid)?.team === tid && last && !(last.box.get(pid)?.min > 0));
  return { roster: [...ids], out, starters: null };
}
const liveTrack = {}; // phase key -> accuracy of the live-like projection
function scoreLive(g, phase, predL) {
  const o = (liveTrack[phase.key] ||= { label: phase.label, g: 0, win: 0, mErr: 0, proj15: 0, absent: 0, n: 0, pts: 0, min: 0 });
  const actMargin = g.hs - g.as;
  o.g++; o.win += (actMargin > 0) === (predL.pHome >= 0.5) ? 1 : 0; o.mErr += Math.abs(actMargin - predL.margin);
  for (const side of [predL.h, predL.a]) {
    const top = [...side.proj].sort((a, b) => b.proj.min - a.proj.min).slice(0, 5);
    o.teams = (o.teams || 0) + 1; o.top5 = (o.top5 || 0) + top.reduce((s, x) => s + x.proj.min, 0); o.cnt1 = (o.cnt1 || 0) + side.proj.filter((x) => x.proj.min >= 1).length;
    for (const x of top) { const act = g.players.find((b) => b.id === x.id && b.t === side.S.tid); if (act && act.min > 0) { o.topN = (o.topN || 0) + 1; o.topMinBias = (o.topMinBias || 0) + act.min - x.proj.min; o.topPtsBias = (o.topPtsBias || 0) + act.pts - x.proj.pts; } }
  }
  for (const side of [predL.h, predL.a]) for (const x of side.proj) {
    if (x.proj.min < 15) continue;
    o.proj15++;
    const act = g.players.find((b) => b.id === x.id && b.t === side.S.tid);
    if (!act || act.dnp || !(act.min > 0)) { o.absent++; continue; }
    o.n++; o.pts += Math.abs(act.pts - x.proj.pts); o.min += Math.abs(act.min - x.proj.min);
  }
}

function recordGame(g) {
  const phase = phaseOf(g.season, g.stype);
  const gameMin = 240 + 25 * Math.max(0, g.periods - 4);
  for (const [tid, oid, home] of [[g.home, g.away, true], [g.away, g.home, false]]) {
    const me = boxTotals(g, tid), op = boxTotals(g, oid);
    const box = new Map();
    const allow = { G: { min: 0, pts: 0, reb: 0, ast: 0 }, F: { min: 0, pts: 0, reb: 0, ast: 0 }, C: { min: 0, pts: 0, reb: 0, ast: 0 } };
    for (const x of g.players.filter((x) => x.t === oid && x.min > 0)) { const a = allow[posGroup(x.pos)]; a.min += x.min; a.pts += x.pts; a.reb += x.reb; a.ast += x.ast; }
    const mine = g.players.filter((x) => x.t === tid);
    for (const x of mine) if (x.min > 0) box.set(x.id, { min: x.min, pts: x.pts, ast: x.ast, reb: x.reb });
    const starters = mine.filter((x) => x.st);
    getT(tid).recs.push({
      gid: g.id, date: g.date, season: g.season, stype: g.stype, cup: !!g.cup, opp: oid, home,
      pts: home ? g.hs : g.as, oppPts: home ? g.as : g.hs, poss: (me.poss + op.poss) / 2, pace: ((me.poss + op.poss) / 2) * 240 / gameMin,
      fga: me.fga, fgm: me.fgm, fta: me.fta, tpa: me.tpa, ast: me.ast, tov: me.tov, oreb: me.oreb, oppDreb: op.dreb,
      paint: me.paint, fb: me.fb, efg: me.efg, oppEfg: op.efg, oppTpa: op.tpa, oppFga: op.fga, oppPaint: op.paint, oppTov: op.tov,
      depth: mine.filter((x) => x.min >= 12).length, starterShare: starters.reduce((s, x) => s + x.min, 0) / gameMin,
      benchPts: mine.filter((x) => !x.st).reduce((s, x) => s + x.pts, 0), margin: (home ? g.hs - g.as : g.as - g.hs), ot: g.periods > 4,
      box, roster: new Set(mine.map((x) => x.id)), cd: new Set(mine.filter(COACH_DNP).map((x) => x.id)), allow,
    });
    if (phase.stype !== 1) {
      league.pts += me.pts; league.poss += me.poss; league.gm48 += gameMin / 240; league.n++;
      league.paint += me.paint; league.fb += me.fb; league.tpa += me.tpa; league.fga += me.fga; league.tpm = (league.tpm || 0) + me.tpm;
    }
  }
  for (const x of g.players) {
    const p = getP(x.id, x.n, x.pos);
    const avail = !(x.dnp && INJURY_DNP(x.why));
    if (x.min > 0 || x.dnp) {
      p.recs.push({ gid: g.id, date: g.date, season: g.season, stype: g.stype, cup: !!g.cup, opp: x.t === g.home ? g.away : g.home, team: x.t, avail, st: x.st,
        min: x.min, pts: x.pts, reb: x.reb, ast: x.ast, tpm: x.tpm, tpa: x.tpa, stl: x.stl, blk: x.blk, to: x.to, fga: x.fga, fta: x.fta, tsa: tsa(x), pf: x.pf });
    }
    if (x.min > 0) {
      p.team = x.t; p.teamsPlayed.add(x.t);
      const s = p.stints.at(-1);
      if (s && s.team === x.t) s.last = g.date; else p.stints.push({ team: x.t, first: g.date, last: g.date });
    }
    if (x.min > 0 && phase.stype !== 1) {
      const L = league.pos[posGroup(x.pos)];
      L.min += x.min; for (const s of STATS) L[s] += x[s] || 0; L.tsa += tsa(x); L.tpa += x.tpa;
    }
  }
}

let predicted = 0;
const refCheck = { n: 0, applied: 0, withRef: 0, without: 0 };
const coverage = { n: 0, inside: 0, above: 0, below: 0 };
const RANGE_LEARN = process.env.CL_RANGE !== "fixed", LIVE_TRACK = process.env.CL_LIVE_TRACK !== "off";
const rangeLo = (pp) => Math.max(0, Math.round(pp.proj.pts - learn.rangeZ.lo * pp.sdPts));
const rangeHi = (pp) => Math.round(pp.proj.pts + learn.rangeZ.hi * pp.sdPts);
const CEN_RO = { get: CEN.get, push() {} };
const walk = NOBOX.length ? [...games, ...NOBOX].sort((a, b) => a.date.localeCompare(b.date)) : games;
for (const g of walk) {
  MUS.flush(g.date); // matchup state: only games that tipped off strictly before this one
  let qProj = null; // quarter projection made before tip-off, scored once the play-by-play is read
  if (g.noBox) { // final score only: Elo, rest days, streaks and records; nothing that needs a box score
    updateRatings(g, true);
    MUS.queue(g); // NBA.com tracked some games ESPN has no box score for
    for (const [tid, home] of [[g.home, true], [g.away, false]]) { if (!NOBOX_T.has(tid)) NOBOX_T.set(tid, []); NOBOX_T.get(tid).push({ gid: g.id, date: g.date, season: g.season, stype: g.stype, opp: home ? g.away : g.home, home, margin: home ? g.hs - g.as : g.as - g.hs, ot: false, noBox: true }); }
    continue;
  }
  if (!g.completed || !g.players?.length) continue;
  const phase = phaseOf(g.season, g.stype);
  const hT = getT(g.home), aT = getT(g.away);
  const ready = hT.recs.length >= 3 && aT.recs.length >= 3;
  if (ready) {
    const kH = knownFromBox(g, g.home), kA = knownFromBox(g, g.away);
    const H = projectTeam(g, g.home, g.away, true, kH), A = projectTeam(g, g.away, g.home, false, kA);
    const starters = new Set([...kH.starters, ...kA.starters]);
    const pred = finishGame(g, H, A, { starters });
    predicted++;
    if (phase.stype !== 1) qProj = [QS.project(g.home, g.away, g.season, pred.h.pts).q, QS.project(g.away, g.home, g.season, pred.a.pts).q, [pred.h.pts, pred.a.pts]];
    // live-like shadow projection (scored, never learned from): what the procedure used for
    // upcoming games would have said with no line-ups and no inactive list
    if (phase.stype !== 1 && LIVE_TRACK) scoreLive(g, phase, finishGame(g, projectTeam(g, g.home, g.away, true, knownLiveLike(g, g.home)), projectTeam(g, g.away, g.home, false, knownLiveLike(g, g.away)), { starters: null, shadow: true }));
    const actMargin = g.hs - g.as;
    // ---------- explain the result ----------
    const playerRows = [];
    const teamAnalysis = [];
    for (const side of [pred.h, pred.a]) {
      const tid = side.S.tid, isHome = side.isHome;
      const actPts = isHome ? g.hs : g.as, oppPts = isHome ? g.as : g.hs;
      const teamMargin = actPts - oppPts;
      const me = boxTotals(g, tid);
      const gameMin = 240 + 25 * Math.max(0, g.periods - 4);
      const actPace = ((me.poss + boxTotals(g, side.O.tid).poss) / 2) * 240 / gameMin;
      // player-level
      const decomp = { minutes: 0, usage: 0, efficiency: 0 };
      let surpriseAbsPts = 0;
      for (const pp of side.proj) {
        const act = g.players.find((x) => x.id === pp.id && x.t === tid) || { min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, tpa: 0, fga: 0, fta: 0, pf: 0, dnp: 1, why: "not in box" };
        const ex = explainPlayer(pp, act, g, teamMargin);
        decomp.minutes += ex.minutes; decomp.usage += ex.usage; decomp.efficiency += ex.efficiency;
        if (act.dnp) surpriseAbsPts += pp.proj.pts;
        const res = { pts: act.pts - pp.rawPts, reb: act.reb - pp.proj.reb, ast: act.ast - pp.proj.ast, min: act.min - pp.rawMin };
        playerRows.push({
          id: pp.id, n: pp.n, t: tid, pos: pp.pos, role: pp.role, st: pp.st, r2k: pp.r2k,
          pred: { min: round(pp.proj.min), pts: round(pp.proj.pts), reb: round(pp.proj.reb), ast: round(pp.proj.ast), tpm: round(pp.proj.tpm), tpa: round(pp.proj.tpa),
            lo: rangeLo(pp), hi: rangeHi(pp) },
          act: { min: act.min, pts: act.pts, reb: act.reb, ast: act.ast, tpm: act.tpm, tpa: act.tpa, fg: `${act.fgm ?? 0}-${act.fga ?? 0}`, tp: `${act.tpm ?? 0}-${act.tpa ?? 0}`, pf: act.pf, dnp: act.dnp ? act.why || "DNP" : null },
          why: { minutes: round(ex.minutes), usage: round(ex.usage), efficiency: round(ex.efficiency) }, tags: ex.tags, scen: pp.scen,
          adj: { pace: round(pp.adj.pace, 3), defense: round(pp.adj.defense, 3), split: round(pp.adj.splitPts), absence: round(pp.adj.absence), ww: pp.adj.ww, matchups: pp.adj.matchups,
            fx: round(pp.fxNet, 2), fxRaw: round(pp.fx.pts, 2), fxParts: pp.fx.parts.filter((q) => Math.abs(q.v) >= 0.05).map((q) => [q.f, q.stat, round(q.v, 2)]) },
        });
        // ---------- learning ----------
        if (!act.dnp && act.min > 0) {
          const p = P.get(pp.id);
          if (phase.stype !== 1 && pp.proj.min >= 12) {
            const lo = rangeLo(pp), hi = rangeHi(pp), z = learn.rangeZ;
            coverage.n++; if (act.pts >= lo && act.pts <= hi) coverage.inside++;
            if (act.pts > hi) coverage.above++; if (act.pts < lo) coverage.below++;
            // quantile tracking: each side widens after a miss and narrows a little otherwise, settling where 10% miss on that side
            if (RANGE_LEARN) { z.hi = clamp(z.hi + 0.004 * ((act.pts > hi ? 1 : 0) - 0.10), 0.9, 1.8); z.lo = clamp(z.lo + 0.004 * ((act.pts < lo ? 1 : 0) - 0.10), 0.9, 1.8); }
          }
          p.res.push({ gid: g.id, ...res });
          if (phase.stype !== 1) FXE.learn(pp.fx.parts, act, pp.raw, phase.key); // factors learn from the leftover error of the unscaled projection
          if (phase.stype !== 1) {
            // in-loop features: coefficients learn from the leftover error of the unscaled projection; the
            // evidence tables store residuals with each feature's own effect taken out (no feedback loop)
            // minutes are measured on the published (240-scaled) minutes: a raw-minutes residual mostly
            // measures how far the team's raw sum is from 240, and moving raw minutes made published minutes worse
            const pubMin = pp.proj.min, f = pp.f240 || 1;
            IX.learn(pp.ix.parts, { pts: act.pts, min: act.min }, { pts: pp.raw.pts, min: pubMin }, phase.key);
            const v = (fid) => pp.ix.parts.find((q) => q.f === fid)?.v || 0;
            if (Math.abs(teamMargin) >= FLOW_RULE.far) blowRecord(p, tid, g.season, pp.st ? "starter" : "bench", teamMargin > 0 ? "w" : "l", act.min - (pubMin - v("blowMin") * f), act.pts - (pp.raw.pts - v("blowPts")));
            const rs = pp.ixEv.rs;
            if (rs) {
              RET.add(rs.b, rs.k, act.min - (pubMin - v("retMin") * f), act.pts - (pp.raw.pts - v("retPts")), { min: act.min, pts: act.pts }, rs.preMin ? { min: rs.preMin, pts: rs.prePts } : null);
              p.rets.push({ d: g.date.slice(0, 10), k: rs.k, missed: rs.missed, min: act.min, pts: act.pts, preMin: round(rs.preMin), prePts: round(rs.prePts) });
            }
            if (pp.proj.min >= 10) { // trust meter: published error against the typical error for similar projections at the time
              const b = Math.min(6, Math.floor(pp.proj.pts / 5)), T0 = (TYP.pts[b] ||= { n: 0, abs: 0 }), e = act.pts - pp.proj.pts;
              p.errs.push({ e, typ: T0.n >= 50 ? T0.abs / T0.n : null }); T0.n++; T0.abs += Math.abs(e);
            }
          }
          // matchup splits: residual vs the baseline (before split adjustment) so splits learn the raw situational gap
          const rawTpa = act.tpa - pp.baseline.tpa, rawPts = act.pts - (pp.rawPts - pp.adj.splitPts);
          for (const key of pp.keys) {
            const s = (p.splits[key] ||= { n: 0, pts: 0, tpa: 0, reb: 0, ast: 0, min: 0 });
            s.n++; s.pts += rawPts; s.tpa += rawTpa; s.reb += res.reb; s.ast += res.ast; s.min += res.min;
          }
          { const s = p.splitAll; s.n++; s.pts += rawPts; s.tpa += rawTpa; s.reb += res.reb; s.ast += res.ast; s.min += res.min; } // his overall gap, the reference for every split
          for (const stat of ["pts", "reb", "ast"]) scenLearn(pp.scen, pp.role, stat, res[stat], act[stat] - pp.baseline[stat]);
          scenLearn(pp.scen, pp.role, "min", res.min, act.min - pp.baseline.min);
          if (phase.stype !== 1) playerGameRes.push({ gid: g.id, date: g.date, t: tid, opp: side.O.tid, id: pp.id, pts: act.pts, ast: act.ast, reb: act.reb, rp: res.pts, ra: res.ast, rr: res.reb, min: act.min });
        } else if (act.dnp && !INJURY_DNP(act.why) && act.why !== "not in box") {
          scenLearn(pp.scen, pp.role, "min", res.min, -pp.baseline.min); // healthy scratch: learn that these minutes do not always happen
          if (phase.stype !== 1 && IX_DNP) { // a coach's-decision DNP is a real 0 minutes: counting only players who got in would inflate garbage-time minutes
            const p = P.get(pp.id), f = pp.f240 || 1, v = (fid) => pp.ix.parts.find((q) => q.f === fid)?.v || 0;
            IX.learn(pp.ix.parts.filter((q) => q.stat === "min"), { min: 0 }, { min: pp.proj.min }, phase.key);
            if (Math.abs(teamMargin) >= FLOW_RULE.far) blowRecord(p, tid, g.season, pp.st ? "starter" : "bench", teamMargin > 0 ? "w" : "l", -(pp.proj.min - v("blowMin") * f), -(pp.raw.pts - v("blowPts")));
          }
        }
      }
      // players who played but were not projected (call-ups, unexpected returns)
      const projected = new Set(side.proj.map((x) => x.id));
      let unprojPts = 0;
      for (const x of g.players.filter((x) => x.t === tid && x.min > 0 && !projected.has(x.id))) {
        unprojPts += x.pts;
        playerRows.push({ id: x.id, n: x.n, t: tid, pos: x.pos, role: "unprojected", pred: null, act: { min: x.min, pts: x.pts, reb: x.reb, ast: x.ast, tpm: x.tpm, fg: `${x.fgm}-${x.fga}`, tp: `${x.tpm}-${x.tpa}`, pf: x.pf }, tags: ["Not expected to play"], why: null });
      }
      // team-level attribution
      const err = actPts - side.pts;
      const paceEff = (actPace / pred.expPace - 1) * side.pts;
      const expEfg = side.S.style.efg ?? me.efg;
      const shootEff = (me.efg - (0.5 * expEfg + 0.5 * (side.O.style.oppEfg ?? expEfg))) * 2 * me.fga;
      const otEff = g.periods > 4 ? actPts * (25 * (g.periods - 4)) / gameMin : 0;
      const expTov = (side.S.style.tov ?? 0.13) * me.poss;
      const tovEff = -(me.tov - expTov) * leagueNow().ppp;
      const absEff = -surpriseAbsPts + unprojPts;
      const other = err - paceEff - shootEff - otEff - tovEff - absEff;
      const teamWhy = { pace: round(paceEff), shooting: round(shootEff), overtime: round(otEff), turnovers: round(tovEff), lineup: round(absEff), other: round(other) };
      const tTags = [];
      if (Math.abs(teamMargin) >= 20) tTags.push(teamMargin > 0 ? "Blowout win" : "Blowout loss");
      if (g.periods > 4) tTags.push("Overtime");
      if (Math.abs(actPace / pred.expPace - 1) > 0.06) tTags.push(actPace > pred.expPace ? "Much faster pace" : "Much slower pace");
      if (shootEff > 8) tTags.push("Shot well above norm"); if (shootEff < -8) tTags.push("Shot well below norm");
      if (tovEff < -6) tTags.push("Turnover problems"); if (absEff < -10) tTags.push("Key late absences");
      const benchAct = g.players.filter((x) => x.t === tid && !x.st).reduce((s, x) => s + x.pts, 0);
      if (benchAct > (side.S.style.benchPts ?? 35) + 15) tTags.push("Bench explosion");
      teamAnalysis.push({ tid, isHome, pred: round(side.pts), act: actPts, err: round(err), why: teamWhy, tags: tTags, players: decomp, scen: side.teamScen, style: side.S.style.tags, sched: side.S.sched, out: side.S.teamOut.map((o) => ({ id: o.id, n: o.n, ppg: round(o.ppg) })) });
      // learning: team scenarios + team vs style
      const tRes = actPts - side.pts;
      { const keys = [ALL, ...side.teamScen]; const share = 1 / Math.sqrt(keys.length);
        for (const k of keys) { const o = (learn.teamScen[k] ||= { w: 0, n: 0, raw: 0 }); o.n++; o.raw += actPts - (side.rawPts - side.teamEff); o.w = clamp(o.w + tRes * share * Math.max(1 / (o.n + 25), 0.004), -6, 6); } }
      const tm = getT(tid);
      tm.res.push({ gid: g.id, off: tRes, def: (isHome ? g.as : g.hs) - (isHome ? pred.a.pts : pred.h.pts) });
      if (phase.stype !== 1) {
        IXT.learn(side.tx.parts, { tpts: actPts }, { tpts: side.pts }, phase.key);
        tm.terr.push({ e: tRes, typ: TYP.team.n >= 50 ? TYP.team.abs / TYP.team.n : null, m: teamMargin - (isHome ? pred.margin : -pred.margin) });
        TYP.team.n++; TYP.team.abs += Math.abs(tRes);
      }
      for (const tg of side.O.style.tags) { const v = (tm.vsStyle[tg] ||= { n: 0, off: 0, def: 0 }); v.n++; v.off += tRes; v.def += (isHome ? g.as - pred.a.pts : g.hs - pred.h.pts); }
      const vt = (tm.vsTeam[side.O.tid] ||= { n: 0, margin: 0 }); vt.n++; vt.margin += teamMargin - (isHome ? pred.margin : -pred.margin);
    }
    // learned global params
    if (!g.neutral && phase.stype !== 1) learn.homeAdv = clamp(learn.homeAdv + 0.004 * (actMargin - pred.margin), 0, 5);
    if (phase.stype !== 1) {
      learn.sigma = Math.sqrt(0.99 * learn.sigma ** 2 + 0.01 * (actMargin - pred.margin) ** 2);
      const rawM = pred.h.rawPts - pred.a.rawPts;
      learn.sxy = 0.998 * learn.sxy + rawM * actMargin; learn.sxx = 0.998 * learn.sxx + rawM * rawM;
      learn.k = clamp(learn.sxy / learn.sxx, 0.5, 1.1);
      learn.a = clamp(learn.a + 0.0004 * ((actMargin > 0 ? 1 : 0) - pred.pHome) * pred.margin, 0.07, 0.22);
      // ensemble: move weight toward the rating systems that would have been closer
      const target = actMargin - (pred.h.teamEff - pred.a.teamEff) - (pred.h.vsStyle - pred.a.vsStyle) - (pred.h.tx.tpts - pred.a.tx.tpts);
      const e = target - pred.ensemble, norm = MODEL_KEYS.reduce((s, k) => s + pred.models[k] ** 2, 0) + 50;
      for (const k of MODEL_KEYS) learn.w[k] = clamp(learn.w[k] + 0.02 * e * pred.models[k] / norm, 0, 1);
      for (const k of MODEL_KEYS) { const o = (learn.modelErr[phase.key + "|" + k] ||= { n: 0, abs: 0, hit: 0 }); o.n++; o.abs += Math.abs(actMargin - pred.models[k]); o.hit += (pred.models[k] > 0) === (actMargin > 0) ? 1 : 0; }
      // referee crews
      for (const n of g.officials || []) { const r = (learn.refs[n] ||= { n: 0, tot: 0, home: 0 }); r.n++; r.tot += g.hs + g.as - (pred.h.pts + pred.a.pts - pred.ref.tot); r.home += actMargin - (pred.margin - pred.ref.home); }
    }

    const favHome = pred.pHome >= 0.5;
    const correct = (actMargin > 0) === favHome;
    const dogProb = favHome ? 1 - pred.pHome : pred.pHome;
    const upset = !correct;
    const upsetWatch = upsetSignals(pred, H, A);
    const sum = {
      id: g.id, date: g.date, phase: phase.label, pk: phase.key, home: g.home, away: g.away,
      pred: { hs: round(pred.h.pts), as: round(pred.a.pts), pHome: round(pred.pHome, 3) },
      act: { hs: g.hs, as: g.as, ot: g.periods > 4 ? g.periods - 4 : 0 }, correct, upset, dogProb: round(dogProb, 3),
      upsetFlag: upsetWatch.flag,
      err: round(Math.abs(actMargin - pred.margin)), totErr: round(g.hs + g.as - pred.h.pts - pred.a.pts),
    };
    results.push(sum);
    refCheck.n++; refCheck.withRef += Math.abs(g.hs + g.as - pred.h.pts - pred.a.pts); refCheck.without += Math.abs(g.hs + g.as - (pred.h.pts + pred.a.pts - pred.ref.tot)); if (pred.ref.tot) refCheck.applied++;
    details[g.id] = { ...sum, models: Object.fromEntries(MODEL_KEYS.map((k) => [k, round(pred.models[k])])), weights: Object.fromEntries(MODEL_KEYS.map((k) => [k, round(learn.w[k], 2)])), ref: { tot: round(pred.ref.tot), home: round(pred.ref.home) }, headline: headline(g, pred, teamAnalysis, playerRows), upsetReasons: upsetWatch.reasons, teams: teamAnalysis, players: playerRows, pace: round(pred.expPace), homeAdv: round(pred.homeAdv), sigma: round(learn.sigma), officials: g.officials, venue: g.venue };
    for (const ta of teamAnalysis) ledger.push({ date: g.date.slice(0, 10), pk: phase.key, tid: ta.tid, ...ta.why, absErr: Math.abs(ta.err), players: ta.players, tags: ta.tags });
    if (predicted % 100 === 0) {
      learn.history.push({ date: g.date.slice(0, 10), homeAdv: round(learn.homeAdv, 2), sigma: round(learn.sigma, 2), shrink: round(learn.k, 2), slope: round(learn.a, 3), scenarios: Object.keys(learn.scen).length });
      console.log(`  ${predicted} games walked (${g.date.slice(0, 10)})`);
    }
  }
  updateRatings(g);
  recordGame(g);
  MUS.queue(g); // folded into the matchup state before the next game with a later tip-off
  const pbp = loadPbp(g.id);
  ZS.record(g, pbp); // zone state is updated only after the game has been projected
  { const bh = boxTotals(g, g.home), ba = boxTotals(g, g.away); FLOW.record(g, pbp, (bh.poss + ba.poss) / 2); } // on-court state, same rule
  if (pbp && !pbp.np && g.stype !== 1 && pbp.q?.[0]?.length >= 4) {
    if (qProj && pbp.q[0].length === 4) { // regulation games only: projected quarters vs even split vs league shares, same game total
      const lg = QS.league();
      for (let s = 0; s < 2; s++) for (let q = 0; q < 4; q++) { const act = pbp.q[s][q]; qCheck.model[q] += Math.abs(act - qProj[s][q]); qCheck.even[q] += Math.abs(act - qProj[2][s] / 4); qCheck.league[q] += Math.abs(act - qProj[2][s] * lg[q]); }
      qCheck.n += 2;
    }
    QS.record(g.home, g.season, pbp.q[0], pbp.q[1]); QS.record(g.away, g.season, pbp.q[1], pbp.q[0]);
  }
}
MUS.flush(null); // every finished game, for the upcoming projections and the published tables
learn.history.push({ date: games.at(-1)?.date.slice(0, 10), homeAdv: round(learn.homeAdv, 2), sigma: round(learn.sigma, 2), shrink: round(learn.k, 2), scenarios: Object.keys(learn.scen).length });

function upsetSignals(pred, H, A) {
  const favHome = pred.pHome >= 0.5;
  const fav = favHome ? H : A, dog = favHome ? A : H;
  const dogP = favHome ? 1 - pred.pHome : pred.pHome;
  const reasons = [];
  if (fav.sched.b2b && !dog.sched.b2b) reasons.push("Favourite on a back-to-back, underdog rested");
  if (dog.sched.rest - fav.sched.rest >= 2) reasons.push("Underdog has a 2+ day rest edge");
  if (fav.teamOut.some((o) => o.star)) reasons.push(`Favourite missing ${fav.teamOut.filter((o) => o.star).map((o) => o.n).join(", ")}`);
  if (!pred.h.isHome || fav === A) { if (fav === A && fav.sched.roadStreak >= 3) reasons.push("Favourite deep into a road trip"); }
  const favT = getT(fav.tid), dogT = getT(dog.tid);
  const favRes = favT.res.slice(-5).map((r) => r.off - r.def), dogRes = dogT.res.slice(-5).map((r) => r.off - r.def);
  if (favRes.length === 5 && mean(favRes) < -5) reasons.push("Favourite underperforming projections lately");
  if (dogRes.length === 5 && mean(dogRes) > 5) reasons.push("Underdog outperforming projections lately");
  for (const tg of fav.style.tags) { const v = dogT.vsStyle[tg]; if (v && v.n >= 5 && (v.off - v.def) / v.n > 4) reasons.push(`Underdog historically beats expectations vs "${tg}" teams`); }
  const h2h = dogT.vsTeam[fav.tid]; if (h2h && h2h.n >= 2 && h2h.margin / h2h.n > 6) reasons.push("Underdog has outplayed projections in this matchup");
  const flag = dogP >= 0.3 && (dogP >= 0.45 || reasons.length >= 2);
  return { flag, reasons, dogP };
}

function headline(g, pred, ta, rows) {
  const ab = (id) => teamById[id]?.abbr || id;
  const fav = pred.pHome >= 0.5 ? g.home : g.away;
  const winner = g.hs > g.as ? g.home : g.away;
  const parts = [`Projected ${ab(g.home)} ${round(pred.h.pts, 0)}-${round(pred.a.pts, 0)} ${ab(g.away)} (${ab(fav)} ${Math.round(Math.max(pred.pHome, 1 - pred.pHome) * 100)}%). Final ${ab(g.home)} ${g.hs}-${g.as} ${ab(g.away)}.`];
  const reasons = [];
  for (const t of ta) for (const [k, v] of Object.entries(t.why)) if (k !== "other" && Math.abs(v) >= 5) reasons.push({ v, txt: `${ab(t.tid)} ${{ pace: "game pace", shooting: "shot-making", overtime: "overtime", turnovers: "turnovers", lineup: "who actually played" }[k]} ${v > 0 ? "+" : ""}${v} pts` });
  const big = rows.filter((r) => r.pred && Math.abs(r.act.pts - r.pred.pts) >= 9).sort((a, b) => Math.abs(b.act.pts - b.pred.pts) - Math.abs(a.act.pts - a.pred.pts)).slice(0, 2);
  for (const b of big) reasons.push({ v: b.act.pts - b.pred.pts, txt: `${b.n} ${b.act.pts} pts vs ${b.pred.pts} projected${b.tags.length ? ` (${b.tags.slice(0, 2).join(", ")})` : ""}` });
  reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  if (reasons.length) parts.push((winner === fav ? "Called it. Swing factors: " : "Missed. Why: ") + reasons.slice(0, 4).map((r) => r.txt).join("; ") + ".");
  return parts.join(" ");
}

// ------------------------------------------------------------------ upcoming games
const today = new Date();
const injuries = readJSON(path.join(DATA, "injuries.json"), { list: [] }).list;
const rosters = readJSON(path.join(DATA, "rosters.json"), {});
const upcoming = [];
const upcomingCtx = []; // projection objects kept for the keys / scenarios step
const schedDir = path.join(DATA, "schedule");
const futureEvents = fs.readdirSync(schedDir).flatMap((f) => readJSON(path.join(schedDir, f), []))
  .filter((e) => !e.completed && e.status !== "STATUS_POSTPONED" && e.status !== "STATUS_CANCELED" && Date.parse(e.date) > Date.now() - 6 * 3600e3)
  .filter((e) => Date.parse(e.date) < Date.now() + 7 * 864e5).sort((a, b) => a.date.localeCompare(b.date));
for (const e of futureEvents) for (const [tid, home] of [[e.home, true], [e.away, false]]) { if (!SCHED.has(tid)) SCHED.set(tid, []); SCHED.get(tid).push({ date: e.date, home, opp: home ? e.away : e.home, season: e.season, stype: e.stype }); }
const pregame = readJSON(path.join(DATA, "pregame.json"), {});
// Rostered players whose last game (within 30 days) was for another team: recent arrivals. Read
// before the roster overwrites p.team; every rostered player then gets a state entry and his current team.
const ARRIVALS = new Map();
for (const [tid, t] of Object.entries(rosters)) {
  const arr = new Set();
  for (const x of t.players || []) { const l = (P.get(String(x.id))?.recs || []).filter((r) => r.min > 0).at(-1); if (l && l.team !== tid && Date.now() - Date.parse(l.date) < 30 * 864e5) arr.add(String(x.id)); }
  ARRIVALS.set(tid, arr);
  for (const x of t.players || []) { const p = getP(String(x.id), x.n, x.pos); p.team = tid; }
}
for (const e of futureEvents) {
  const known = (tid) => {
    const r = rosters[tid]?.players || [];
    const hasPlayed = (id) => (P.get(String(id))?.recs || []).some((x) => x.min > 0);
    const onRoster = r.length ? new Set(r.map((x) => String(x.id))) : new Set([...P.values()].filter((p) => p.team === tid).map((p) => p.id)); // no roster file for this team: fall back to who last played for it
    const byName = new Map(r.map((x) => [normName(x.n), x.id]));
    const inj = injuries.filter((i) => i.team === tid).map((i) => ({ ...i, id: String(i.id || byName.get(normName(i.n)) || "") })).filter((i) => i.id && onRoster.has(i.id) && hasPlayed(i.id));
    // "Out" with an expected return on or before this game counts as questionable, not out
    const backBy = (i) => i.returnDate && i.returnDate <= etDay(e.date);
    const out = inj.filter((i) => /out|doubtful/i.test(i.status) && !backBy(i)).map((i) => i.id);
    const q = inj.filter((i) => /questionable|day-to-day/i.test(i.status) || (/out|doubtful/i.test(i.status) && backBy(i))).map((i) => i.id);
    // same rule as the live-like back-test track: recent minutes for this team, recent arrivals, and the injury list
    const ids = new Set([...recentIds(tid)].filter((pid) => onRoster.has(pid)));
    for (const id of ARRIVALS.get(tid) || []) if (onRoster.has(id)) ids.add(id);
    for (const i of inj) ids.add(i.id);
    const lastRec = getT(tid).recs.at(-1);
    const sat = lastRec ? [...ids].filter((id) => !(lastRec.box.get(id)?.min > 0) && !(ARRIVALS.get(tid) || new Set()).has(id)) : [];
    return { roster: [...ids], out, questionable: q, sat, newsLimit: ctx.newsMinutesLimit(tid) };
  };
  const g = { ...e, players: [], officials: pregame[e.id]?.officials || [] };
  if (getT(e.home).recs.length < 3 || getT(e.away).recs.length < 3) continue;
  const kH = known(e.home), kA = known(e.away);
  const H = projectTeam(g, e.home, e.away, true, kH), A = projectTeam(g, e.away, e.home, false, kA);
  const pred = finishGame(g, H, A, { starters: null, newsLimit: new Set([...kH.newsLimit, ...kA.newsLimit]) });
  const up = upsetSignals(pred, H, A);
  const sideOut = (side, inj) => side.proj.sort((a, b) => b.proj.pts - a.proj.pts).map((x) => ({
    id: x.id, n: x.n, pos: x.pos, role: x.role, r2k: x.r2k, min: round(x.proj.min), pts: round(x.proj.pts), reb: round(x.proj.reb), ast: round(x.proj.ast), tpm: round(x.proj.tpm),
    stl: round(x.proj.stl), blk: round(x.proj.blk), scen: x.scen.map((s) => ({ s, pts: round(learn.scen[scenKey(s, x.role, "pts")]?.w || 0, 2), n: learn.scen[scenKey(s, x.role, "pts")]?.n || 0 })),
    tpa: round(x.proj.tpa), lo: rangeLo(x), hi: rangeHi(x),
    adj: { pace: round(x.adj.pace, 3), defense: round(x.adj.defense, 3), split: round(x.adj.splitPts), splitTpa: round(x.adj.splitTpa), absence: round(x.adj.absence), bias: round(x.adj.bias), ww: x.adj.ww, matchups: x.adj.matchups },
    wwD: x.adj.wwD.map((w) => ({ id: w.id, n: w.n, pts: round(w.diff), without: { n: w.without.n, ppg: round(w.without.ppg), mpg: round(w.without.mpg) }, with: { n: w.with.n, ppg: round(w.with.ppg), mpg: round(w.with.mpg) } })),
    q: side.S.questionable.has(x.id),
    fx: x.fx.parts.filter((q) => Math.abs(q.v) >= 0.02).map((q) => ({ f: q.f, label: FACTOR_BY_ID[q.f].label, stat: q.stat, v: round(q.v, 2) })), // v = effect on the unscaled projection
    fxNet: round(x.fxNet, 2), // what all points effects together are worth in the published points (after the team-total blend)
    zm: null, // filled once the scouting tables exist (zoneNote)
    ix: ixOut(x, side), // in-loop features: blowout minutes, game flow, return from absence, on-court effects of absent players
    dm: dmOut(x), // who is likely to guard him tonight (NBA.com matchup tracking), meta.json > defMatch
    trust: trustOf(P.get(x.id)?.errs || []),
  }));
  upcomingCtx.push({ id: e.id, pred });
  upcoming.push({
    id: e.id, date: e.date, phase: phaseOf(e.season, e.stype).label, home: e.home, away: e.away, venue: e.venue,
    pred: { hs: round(pred.h.pts), as: round(pred.a.pts), pHome: round(pred.pHome, 3), pace: round(pred.expPace), close: round(pred.shape.close, 3), blowout: round(pred.shape.blowout, 3) },
    models: MODEL_KEYS.map((k) => ({ k, label: MODEL_LABEL[k], margin: round(pred.models[k]), weight: round(learn.w[k], 2) })),
    ref: pred.ref.tot || pred.ref.home ? { tot: round(pred.ref.tot), home: round(pred.ref.home), crew: g.officials } : null,
    conf: confidence(pred, H, A, e),
    upset: up,
    teams: [pred.h, pred.a].map((side) => ({
      tid: side.S.tid, isHome: side.isHome, pts: round(side.pts), model: round(side.model), sumPlayers: round(side.sumPts), sumTeamPts: round(side.sumTeam), teamEff: round(side.teamEff), vsStyle: round(side.vsStyle),
      scen: side.teamScen.map((k) => ({ k, w: round(learn.teamScen[k]?.w || 0, 2), n: learn.teamScen[k]?.n || 0 })),
      sched: side.S.sched, style: pickStyle(side.S.style), out: side.S.teamOut.map((o) => ({ ...o, ppg: round(o.ppg), min: round(o.min) })),
      injuries: injuries.filter((i) => i.team === side.S.tid).map((i) => ({ n: i.n, status: i.status, detail: i.detail })),
      players: sideOut(side),
      quarters: quarterOut(side, side === pred.h ? pred.a : pred.h, e.season),
      trust: trustOf(getT(side.S.tid).terr),
      onOffOut: { x: round(side.tx.parts[0]?.x ?? 0, 2), applied: round(side.tx.tpts, 2) }, // meta.json > flow.notes.onOffOut
    })),
    news: ctx.newsFor([e.home, e.away], []).slice(0, 8).map(({ athletes, teams, ...x }) => x),
  });
}
// In-loop feature evidence for one player in one upcoming game (all from finished games).
function injDetail(pid, name) { const i = injuries.find((r) => String(r.id || "") === String(pid)) || injuries.find((r) => normName(r.n) === normName(name)); return i ? (i.detail || i.status || null) : null; }
function ixOut(x, side) {
  const ev = x.ixEv; if (!ev) return null;
  const { big, be, fe, rs, rc, mates, opps } = ev;
  const st = (o) => (o && o.games ? { min: round(o.min), games: o.games, mpg: round(o.mpg), ppm36: o.ppm == null ? null : round(o.ppm * 36), vsUsual36: round(o.d * 36), small: o.games < 10 } : null);
  return {
    effects: x.ix.parts.map((q) => ({ f: q.f, label: ixLabel[q.f], stat: q.stat, x: round(q.x, 2), v: round(q.v, 2) })).filter((q) => Math.abs(q.x) >= 0.05 || q.v),
    blowout: { winBy15: round(big.w, 3), loseBy15: round(big.l, 3),
      ifWinBig: { min: round(be.w.min), pts: round(be.w.pts), games: be.w.n, teamGames: be.w.teamN }, ifLoseBig: { min: round(be.l.min), pts: round(be.l.pts), games: be.l.n, teamGames: be.l.teamN },
      small: be.w.n + be.l.n < 10 },
    flow: fe ? { usual36: round(fe.ppm * 36), games: fe.games, ahead: st(fe.ahead), behind: st(fe.behind), tight4th: st(fe.tight) } : null,
    returning: rs ? { gameBack: rs.k, missed: rs.missed, bucket: rs.b, curveMin: round(rc?.min ?? 0), curvePts: round(rc?.pts ?? 0), curveGames: rc?.n ?? 0, injury: injDetail(x.id, x.n), beforeMin: round(rs.preMin), beforePts: round(rs.prePts) } : null,
    absentMates: mates.map((m) => ({ id: m.id, n: m.n, per36: round(m.d * 36), minWith: Math.round(m.minOn), minWithout: Math.round(m.minOff), games: m.games, weight: round(m.wt, 2), pts: round(m.x) })),
    absentOpps: opps.map((m) => ({ id: m.id, n: m.n, per36: round(m.d * 36), minWith: Math.round(m.minOn), minWithout: Math.round(m.minOff), games: m.games, weight: round(m.wt, 2), pts: round(m.x) })),
  };
}
// Likely defenders for one player in one upcoming game (matchup tracking from finished games only).
// share = expected % of his partial possessions; vsExpPct = that defender's points allowed against
// what the same kind of scorers usually score (shrunk, negative = tougher); h2h = his own record
// against that defender in earlier games; excessPct = his gap against that defender beyond the
// defender's general record (shrunk). v = what the two gated features add to his unscaled points.
// Players projected under 8 minutes get null; up to 4 defenders with a 5%+ expected share.
function dmOut(x) {
  const ev = x.ixEv, dm = ev?.dm; if (!dm || x.proj.min < 8) return null;
  const v = (fid) => x.ix.parts.find((q) => q.f === fid) || { x: 0, v: 0 };
  const per100 = (a, b) => (b > 0 ? round(a / b * 100, 1) : null), pct = (a, b) => (b > 0 ? round(a / b * 100, 1) : null);
  const rows = dm.rows.filter((r) => r.share >= 0.05).slice(0, 4).map((r) => ({
    id: r.id, n: r.n, pos: r.g, share: round(r.share * 100, 1), fromMeetings: r.obs != null, meetingShare: r.obs == null ? null : round(r.obs * 100, 1),
    vsExpPct: r.has ? round(r.rel * 100, 1) : null, defPoss: Math.round(r.defPoss || 0), vsTypePoss: Math.round(r.typePoss || 0),
    h2h: r.p && r.p.poss > 0 ? { games: r.p.games, met: r.p.met, poss: Math.round(r.p.poss), pts: r.p.pts, per100: per100(r.p.pts, r.p.poss), exp100: per100(r.p.exp, r.p.poss), fgm: r.p.fgm, fga: r.p.fga, fgPct: pct(r.p.fgm, r.p.fga), small: r.p.poss < DM_RULE.smallPoss || r.p.games < DM_RULE.smallGames } : null,
    excessPct: r.p && r.p.poss > 0 ? round(r.excess * 100, 1) : null,
  }));
  return { src: dm.src, scorerType: dm.oType, coverage: round(dm.cover * 100), meetings: dm.met, realPct: round(dm.real * 100, 1), pairPct: round(dm.pair * 100, 1),
    positionPct: round(ev.dmOld * 100, 1), basePts: round(ev.dmScale), defenders: rows,
    effect: { defReal: { x: round(v("defReal").x, 2), v: round(v("defReal").v, 2) }, defPair: { x: round(v("defPair").x, 2), v: round(v("defPair").v, 2) } } };
}
// Projected quarters for one team (they add up to its projected points) and its quarter identity.
function quarterOut(side, other, season) {
  const pr = QS.project(side.S.tid, side.O.tid, season, side.pts);
  const q = pr.q.map((v) => round(v)); const diff = round(side.pts - q.reduce((a, b) => a + b, 0)); q[3] = round(q[3] + diff); // rounding stays inside the total
  const sh = QS.shares(side.S.tid, season), lg = QS.league();
  return { proj: q, total: round(side.pts), games: pr.n, oppGames: pr.oppN, shares: sh.f.map((v) => round(v * 100)), allowedShares: sh.a.map((v) => round(v * 100)), league: lg.map((v) => round(v * 100)), identity: QS.identity(side.S.tid, season) };
}

// The zone / defender matchup that applies to one player in one upcoming game.
// The tag follows the published sample rule (meta.scout.zoneTagRule), from the same plain counts
// as the Scout tables: "hot" / "cold" for the player needs 30 attempts in the zone, 3 points of
// FG% versus league and 1.5 standard errors; "soft" / "strong" for the opponent needs 150
// attempts allowed. own / opp stay the recency-weighted, shrunk values the model itself uses.
// paper = points if the opponent's zone percentages carried over in full; applied = what the
// learned factor effects are worth in his published points (after the team-total blend).
function zoneNote(x, side, SC) {
  const ZONE_TXT = { rim: "at the rim", paint: "in the paint", mid: "from mid-range", c3: "on corner threes", atb: "on above-the-break threes" };
  const zs = x.fin?.zones; if (!zs || !zs.length || x.proj.min < 10) return null;
  const top = [...zs].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
  const opp = teamById[side.O.tid]?.abbr || side.O.tid;
  const paper = (x.fin.x.zone || 0) + (x.fin.x.rim || 0);
  const zi = Z5.indexOf(top.z), zw = SC.playerZoneWindow(x.id), att = zw ? zw.a[zi] : 0, made = zw ? zw.m[zi] : 0;
  const lgPct = SC.lg5.a[zi] ? SC.lg5.m[zi] / SC.lg5.a[zi] : null;
  const ownTag = tagOf(att, made, lgPct, TAG_RULE.minAtt.five);          // hot | cold | neutral, exactly as on the Scout page
  const dz = SC.teamDefZone(side.O.tid, zi) || { att: 0, made: 0, pct: null, tag: "neutral" }; // soft | strong | neutral
  const tag = ownTag === "hot" && dz.tag === "soft" ? "hot spot meets soft spot" : ownTag === "cold" && dz.tag === "strong" ? "cold spot meets strong spot" : dz.tag === "soft" ? "soft spot" : dz.tag === "strong" ? "strong spot" : "neutral";
  const who = (x.opp?.rim?.who || []).map((w) => ({ n: w.n, diff: round(w.diff * 100), fga: w.fga, src: w.src }));
  const per = x.opp?.per?.[x.g];
  const p1 = (m, a) => (a > 0 ? round(m / a * 100) : null);
  let txt = `${round(top.att)} attempts a game ${ZONE_TXT[top.z]}. He has made ${made} of ${att} there (${att ? p1(made, att) + "%" : "no attempts"}; league ${lgPct == null ? "n/a" : round(lgPct * 100) + "%"})${ownTag !== "neutral" ? `, a ${ownTag} zone for him` : att < TAG_RULE.minAtt.five ? `, too few attempts to call it hot or cold (${TAG_RULE.minAtt.five} needed)` : ""}; ${opp} has allowed ${dz.made} of ${dz.att} there (${dz.pct == null ? "n/a" : dz.pct + "%"})${dz.tag !== "neutral" ? `, a ${dz.tag} spot of its defence` : ""}. Counts are ${SC.windowLabel}.`;
  if (top.z === "rim" && who.length) txt += ` Likely rim defenders: ${who.map((w) => `${w.n} ${w.diff >= 0 ? "+" : ""}${w.diff} versus league on ${w.fga} shots`).join(", ")}.`;
  return { zone: top.z, tag, att: round(top.att), own: round(top.own * 100), opp: round(top.diff * 100), paper: round(paper, 2), applied: round(x.fxNet, 2), appliedRaw: round(x.fx.pts, 2),
    n: [made, att], pct: p1(made, att), lgPct: lgPct == null ? null : round(lgPct * 100), ownTag, oppN: [dz.made, dz.att], oppPct: dz.pct, oppTag: dz.tag,
    zones: zs.map((z) => [z.z, round(z.att), round(z.diff * 100), round(z.pts, 2)]), rimDefenders: who, perimeter: per ? { diff: round(per.centred * 100), fga: per.fga } : null, txt };
}

// How much to trust a projection, from how complete the information is.
function confidence(pred, H, A, e) {
  const why = [];
  for (const side of [pred.h, pred.a]) {
    const q = side.proj.filter((x) => (x.role === "star" || x.proj.min >= 26) && side.S.questionable.has(x.id)).map((x) => x.n);
    if (q.length) why.push(`${q.join(", ")} questionable`);
    if (side.S.sched.seasonGames < 5) why.push(`${teamById[side.S.tid]?.abbr} has played fewer than 5 games this season`);
  }
  if (e.stype === 1) why.push("Preseason game: rotations are unpredictable");
  const models = MODEL_KEYS.map((k) => pred.models[k]);
  const split = models.some((m) => m > 2) && models.some((m) => m < -2);
  if (split) why.push("The rating systems disagree on the winner");
  const grade = why.length >= 2 || e.stype === 1 ? "Low" : why.length === 1 ? "Medium" : "High";
  return { grade, why };
}
function pickStyle(s) { return { pace: round(s.pace), off: round(s.off), def: round(s.def), net: round(s.off - s.def), tags: s.tags, tpar: round(s.tpar, 3), paint: round(s.paint), fb: round(s.fb), depth: round(s.depth), starterShare: round(s.starterShare, 3), benchPts: round(s.benchPts), efg: round(s.efg, 3), oppEfg: round(s.oppEfg, 3) }; }

// ------------------------------------------------------------------ profiles: players + teams
const lastSeason = games.at(-1)?.season;
const nowISO = new Date().toISOString();
const baseCache = new Map();
const baseOf = (id) => { const k = String(id); if (!baseCache.has(k)) { const p = P.get(k); baseCache.set(k, p ? playerBaseline(p, lastSeason, nowISO) : null); } return baseCache.get(k); };
const SC = createScout({ ZS, ctx, FXE, P, teams, teamById, lastSeason, nowISO, baseOf, rosters, injuries, centres: CEN, tRecs: (tid) => getT(tid).recs });
const playerProfiles = [];
const dmName = (id) => P.get(String(id))?.n || null, dmTeam = (id) => P.get(String(id))?.team || null;
const resByTeam = {};
for (const r of playerGameRes) (resByTeam[r.t] ||= []).push(r);
const teamOffRes = new Map(); // "gid|tid" -> team points minus its projection (team -> player interaction)
for (const [tid, t] of T) for (const r of t.res) teamOffRes.set(`${r.gid}|${tid}`, r.off);
for (const p of P.values()) {
  // regular-season lines follow the official count: the NBA Cup final is left out
  const cur = p.recs.filter((r) => r.season === lastSeason && r.stype === 2 && !r.cup && r.min > 0);
  const prev = p.recs.filter((r) => r.season === lastSeason - 1 && r.stype === 2 && !r.cup && r.min > 0);
  if (!cur.length && prev.length < 10) continue;
  const avg = (arr, k) => round(mean(arr.map((r) => r[k])));
  const line = (arr) => arr.length ? { gp: arr.length, min: avg(arr, "min"), pts: avg(arr, "pts"), reb: avg(arr, "reb"), ast: avg(arr, "ast"), tpm: avg(arr, "tpm"), stl: avg(arr, "stl"), blk: avg(arr, "blk"), to: avg(arr, "to"),
    ts: round(arr.reduce((s, r) => s + r.pts, 0) / Math.max(1, 2 * arr.reduce((s, r) => s + r.tsa, 0)), 3) } : null;
  // tradeoff: when he scores above projection, what happens to his assists?
  const mine = playerGameRes.filter((r) => r.id === p.id);
  const self = regress(mine.map((r) => r.rp), mine.map((r) => r.ra));
  // teammate ripple: teammate points residual vs his points residual in shared games
  const ripple = [];
  const teamRes = resByTeam[p.team] || [];
  const byGame = new Map(); for (const r of teamRes) { if (!byGame.has(r.gid)) byGame.set(r.gid, []); byGame.get(r.gid).push(r); }
  const mates = new Map();
  for (const r of mine.filter((x) => x.t === p.team)) for (const o of byGame.get(r.gid) || []) {
    if (o.id === p.id) continue; if (!mates.has(o.id)) mates.set(o.id, { x: [], y: [], ya: [] });
    const m = mates.get(o.id); m.x.push(r.rp); m.y.push(o.rp); m.ya.push(o.ra);
  }
  for (const [mid, m] of mates) {
    if (m.x.length < 12) continue;
    const rp = regress(m.x, m.y), ra = regress(m.x, m.ya);
    if (Math.abs(rp.r) >= 0.2 || Math.abs(ra.r) >= 0.2) ripple.push({ id: mid, n: P.get(mid)?.n, games: m.x.length, ptsPer10: round(rp.slope * 10), ptsR: round(rp.r, 2), astPer10: round(ra.slope * 10), astR: round(ra.r, 2) });
  }
  ripple.sort((a, b) => Math.abs(b.ptsR) - Math.abs(a.ptsR));
  // matchup splits (gap vs expectation): best and worst situations, for points and 3PA
  // pts / tpa / reb / ast / min = gap in that situation MINUS his overall gap (p.splitAll); raw = the plain gap
  const splitRows = Object.entries(p.splits).filter(([k, v]) => v.n >= splitMin(k.split(":")[0])).map(([k, v]) => {
    const rel = (stat) => splitRel(p, v, stat);
    return { key: k, type: k.split(":")[0], label: splitLabel(k), n: v.n, small: v.n < SPLIT_SMALL,
      pts: round(rel("pts")), tpa: round(rel("tpa")), reb: round(rel("reb")), ast: round(rel("ast")), min: round(rel("min")),
      raw: { pts: round(v.pts / v.n), tpa: round(v.tpa / v.n) }, score: round(rel("pts") * v.n / (v.n + 6), 2) };
  });
  // A "when X plays" row only says something new if it differs from the row for X's team
  // (X missed some of those games, or changed teams). Otherwise it just repeats the team row.
  const oppRow = new Map(splitRows.filter((s) => s.type === "opp").map((s) => [s.key.slice(4), s]));
  const seen = new Set();
  const distinct = splitRows.filter((s) => {
    if (s.type !== "vs") return true;
    const o = oppRow.get(P.get(s.key.slice(3))?.team);
    if (o && o.n - s.n < 2 && Math.abs(o.pts - s.pts) < 1.5) return false;
    const sig = `${s.n}|${s.pts}|${s.tpa}`; if (seen.has(sig)) return false; seen.add(sig);
    return true;
  });
  const bySc = [...distinct].sort((a, b) => b.score - a.score);
  const byTpa = [...distinct].filter((s) => s.n >= 4).sort((a, b) => b.tpa - a.tpa);
  const resPts = p.res.map((r) => r.pts);
  const ppl = ctx.playerExtras(p.n);
  const prof = {
    id: p.id, n: p.n, pos: p.pos, team: p.team, cur: line(cur), prev: line(prev),
    last5: line(p.recs.filter((r) => r.min > 0 && r.stype !== 1).slice(-5)),
    consistency: round(sd(resPts.slice(-30))), bias: round(mean(resPts.slice(-15))),
    tradeoff: self.n >= 12 ? { games: self.n, astPer10Pts: round(self.slope * 10), r: round(self.r, 2) } : null,
    ripple: ripple.slice(0, 6),
    splits: { best: bySc.slice(0, 6), worst: bySc.slice(-6).reverse(), moreThrees: byTpa.slice(0, 3).filter((s) => s.tpa > 0.5), fewerThrees: byTpa.slice(-3).reverse().filter((s) => s.tpa < -0.5),
      players: distinct.filter((s) => s.type === "vs").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 6),
      arenas: splitRows.filter((s) => s.type === "arena").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 4),
      archetypes: splitRows.filter((s) => s.type === "vsArch" || s.type.startsWith("opp") && s.type !== "opp").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5),
      overall: p.splitAll.n ? { n: p.splitAll.n, pts: round(p.splitAll.pts / p.splitAll.n), tpa: round(p.splitAll.tpa / p.splitAll.n) } : null,
      rule: { minGames: { opponent: SPLIT_MIN.opp, opposingPlayer: SPLIT_MIN.vs, arena: SPLIT_MIN.arena, other: SPLIT_MIN_DEFAULT }, smallSample: SPLIT_SMALL },
      note: `Each number is his gap against the projection in that situation minus his overall gap across all ${p.splitAll.n} of his projected games${p.splitAll.n ? ` (${round(p.splitAll.pts / p.splitAll.n) >= 0 ? "+" : ""}${round(p.splitAll.pts / p.splitAll.n)} points)` : ""}. Counts already include last season (2025-26, with its play-in and playoffs), this season and preseason games. Listed from ${SPLIT_MIN.opp} games against a specific team, opposing player or arena (the schedule allows only 3-4 meetings a season) and from ${SPLIT_MIN_DEFAULT} games for situations, styles, sizes and archetypes; under ${SPLIT_SMALL} games is a small sample.` },
    log: p.recs.filter((r) => r.stype !== 1).slice(-12).reverse().map((r) => ({ d: r.date, opp: r.opp, min: r.min, pts: r.pts, reb: r.reb, ast: r.ast, dnp: r.min ? 0 : 1 })),
    absence: absenceImpact(p),
    ...ppl,
    ...playerFlowBlocks(p),
  };
  Object.assign(prof, SC.player(p, prof)); // zones, styles, defense, playstyle, culture, quarters, scout, vsTeams
  prof.interactions = interactionsOf(p, prof);
  // who guarded whom (NBA.com matchup tracking, this season and last, preseason left out)
  prof.guardedBy = MUS.guardedBy(p.id, dmName, dmTeam);
  prof.guards = MUS.guards(p.id, dmName, dmTeam);
  playerProfiles.push(prof);
}

// ---- on-court, game-flow, blowout, return and trust blocks of a player profile (all from finished games) ----
function playerFlowBlocks(p) {
  const out = {}, F = FLOW.player(p.id);
  const oo = FLOW.onOff(p.id);
  out.onOff = oo && oo.min >= 60 ? { games: oo.games, min: Math.round(oo.min), netOn: round(oo.netOn), netOff: round(oo.netOff), swing: round(oo.netOn - oo.netOff),
    ortgOn: round(oo.ortgOn), ortgOff: round(oo.ortgOff), drtgOn: round(oo.drtgOn), drtgOff: round(oo.drtgOff), small: oo.min < FLOW_RULE.minOnOffMin } : null;
  if (F) {
    const per36 = (pts, sec) => (sec > 0 ? round(pts / sec * 2160) : null);
    const pr = [];
    for (const [q, m] of F.mates) { if (m[1] / 60 < FLOW_RULE.minPairMin) continue; const Q = P.get(q); pr.push({ id: q, n: Q?.n || null, games: m[0], min: Math.round(m[1] / 60), net48: round((m[2] - m[3]) / m[1] * 2880), current: !!Q && Q.team === p.team }); }
    pr.sort((a, b) => b.net48 - a.net48);
    const best = pr.slice(0, 4), worst = pr.slice(Math.max(best.length, pr.length - 4)).reverse();
    out.pairs = pr.length ? { best, worst, count: pr.length, note: `Team points minus opponent points per 48 minutes with both on the floor, from rebuilt on-court fives; pairs with ${FLOW_RULE.minPairMin}+ minutes together, this season and last.` } : null;
    const sc = [];
    for (const [q, m] of F.mates) { if (m[1] < 6000 || m[5] < 6000) continue; sc.push({ id: q, n: P.get(q)?.n || null, games: m[0], with36: per36(m[4], m[1]), without36: per36(m[6], m[5]), minWith: Math.round(m[1] / 60), minWithout: Math.round(m[5] / 60) }); }
    sc.forEach((r) => { r.diff = round(r.without36 - r.with36); }); sc.sort((a, b) => Math.abs(b.diff) * Math.sqrt(Math.min(b.minWith, b.minWithout)) - Math.abs(a.diff) * Math.sqrt(Math.min(a.minWith, a.minWithout)));
    out.scoringWithMates = sc.slice(0, 5);
    const op = [];
    for (const [q, m] of F.opps) { if (m[1] < 3600 || m[3] < 3600) continue; op.push({ id: q, n: P.get(q)?.n || null, team: P.get(q)?.team || null, games: m[0], with36: per36(m[2], m[1]), without36: per36(m[4], m[3]), minWith: Math.round(m[1] / 60), minWithout: Math.round(m[3] / 60) }); }
    op.forEach((r) => { r.diff = round(r.with36 - r.without36); }); op.sort((a, b) => Math.abs(b.diff) * Math.sqrt(Math.min(b.minWith, b.minWithout)) - Math.abs(a.diff) * Math.sqrt(Math.min(a.minWith, a.minWithout)));
    out.scoringVsOpponents = op.slice(0, 5);
    if ((p.g === "C" || p.g === "F") && F.rim[0] >= FLOW_RULE.rimMinAtt && F.rim[2] >= 50) {
      out.rimDefense = { attOn: F.rim[0], madeOn: F.rim[1], fgOn: round(F.rim[1] / F.rim[0] * 100), attOff: F.rim[2], madeOff: F.rim[3], fgOff: round(F.rim[3] / F.rim[2] * 100),
        att36On: round(F.rim[0] / F.rimSec[0] * 2160), att36Off: F.rimSec[1] ? round(F.rim[2] / F.rimSec[1] * 2160) : null,
        note: "Opponent shots in the restricted area with him on the floor versus off it, in games he played (this season and last). att36 = opponent rim attempts per 36 minutes." };
    }
    const fe = flowEvidence(p.id);
    if (fe) {
      const st = (o) => ({ min: Math.round(o.min), games: o.games, mpg: round(o.mpg), per36: o.ppm == null ? null : round(o.ppm * 36), small: o.min < 60 });
      out.gameFlow = { usual36: round(fe.ppm * 36), games: fe.games, ahead: st(fe.ahead), behind: st(fe.behind), tight4th: st(fe.tight), normal: st(fe.normal),
        note: `Points per 36 minutes on the floor by score: far ahead / far behind = his team leading / trailing by ${FLOW_RULE.far}+; tight 4th = 4th quarter or overtime within ${FLOW_RULE.tight}; normal = everything else. Play-by-play, this season and last, preseason left out.` };
    }
    const q4 = (a) => (a[0] ? { games: a[0], q4min: round(a[1] / 60 / a[0]), min: round(a[2] / 60 / a[0]) } : null);
    out.blowout = { win: p.blow.w[0] ? { games: p.blow.w[0], minVsProj: round(p.blow.w[1] / p.blow.w[0]), ptsVsProj: round(p.blow.w[2] / p.blow.w[0]) } : null,
      loss: p.blow.l[0] ? { games: p.blow.l[0], minVsProj: round(p.blow.l[1] / p.blow.l[0]), ptsVsProj: round(p.blow.l[2] / p.blow.l[0]) } : null,
      fourthQuarter: { lopsided: q4(F.q4.blow), other: q4(F.q4.norm) },
      note: `Games decided by ${FLOW_RULE.far}+ (win / loss): his minutes and points against the projection (coach's-decision DNPs count as 0 minutes). fourthQuarter: average 4th-quarter and total minutes in games decided by ${FLOW_RULE.lopsided}+ versus all others.` };
    out.closing = F.close[0] ? { closeGames: F.close[0], onFloor: F.close[1], share: round(F.close[1] / F.close[0] * 100), note: `Games his team played within ${FLOW_RULE.tight} with 2:00 left in the 4th: how often he was on the floor at that moment.` } : null;
  }
  out.returns = p.rets.length ? { games: p.rets.length, recent: p.rets.slice(-8), note: "Games 1-5 after missing 3+ games in a row: minutes and points against his averages in the 10 games before the absence." } : null;
  out.trust = trustOf(p.errs);
  return out;
}
// Two-way interaction effects, each with its sample. Everything is measured, none is a judgment.
function interactionsOf(p, prof) {
  const mine = playerGameRes.filter((r) => r.id === p.id && teamOffRes.has(`${r.gid}|${r.t}`));
  const reg = regress(mine.map((r) => teamOffRes.get(`${r.gid}|${r.t}`)), mine.map((r) => r.rp));
  const ab = prof.absence;
  return {
    playerToTeam: { onOff: prof.onOff ? { swing: prof.onOff.swing, min: prof.onOff.min, small: prof.onOff.small } : null,
      absence: ab && ab.netSwing != null ? { netSwing: ab.netSwing, with: ab.with, without: ab.without, small: ab.without < 10 } : null,
      note: "onOff.swing: team net points per 100 possessions with him on the floor minus off it. absence.netSwing: team net rating in games he played minus games he missed (shrunk)." },
    teamToPlayer: reg.n >= 12 ? { games: reg.n, ptsPer10TeamPts: round(reg.slope * 10), r: round(reg.r, 2), small: reg.n < 30,
      note: "How his points against projection move when his team scores above or below its own projection (per 10 team points)." } : null,
    teammates: { onCourtPairs: prof.pairs ? { best: prof.pairs.best.slice(0, 3), worst: prof.pairs.worst.slice(0, 3) } : null, scoring: prof.scoringWithMates || [], ripple: (prof.ripple || []).slice(0, 3), absence: (ab?.teammates || []).slice(0, 3),
      note: "onCourtPairs: net per 48 with both on the floor. scoring: his points per 36 with the teammate on the floor versus off it (games both played; diff = without minus with). ripple: teammates' points against projection when his own are higher. absence: teammates' numbers in games he missed." },
    opposingPlayers: { onCourt: prof.scoringVsOpponents || [], splits: (prof.splits?.players || []).slice(0, 4),
      note: "onCourt: his points per 36 with the opposing player on the floor versus off it (diff = with minus without; 60+ minutes each way). splits: his gap in games that player played, relative to his overall gap." },
    opposingTeams: (prof.splits ? [...(prof.splits.best || []), ...(prof.splits.worst || [])].filter((s) => s.type === "opp") : []).slice(0, 6),
  };
}

// Is the player still with this team? The current roster decides; without a roster file, his last game does.
function stillOn(p, tid) { return !!p && (rosters[tid]?.players?.length ? rosters[tid].players.some((x) => String(x.id) === String(p.id)) : p.stints.at(-1)?.team === tid); }
function absenceImpact(p) {
  // Team, teammates and opponents with vs without this player (current + last season, same team).
  if (!p.team) return null;
  // "On the team" = every team game from his first appearance for it (this season or last) while
  // he still belongs to it; a game he logged no minutes in counts as "without", whether or not
  // the box score listed him.
  const { w, wo, cd } = withWithoutGames(p.team, p.id, null, lastSeason, stillOn(p, p.team));
  const recs = [...w, ...wo];
  if (w.length < 8 || wo.length < 3) return wo.length ? { with: w.length, without: wo.length, coachDecisions: cd } : null;
  const net = (arr) => mean(arr.map((r) => (r.pts - r.oppPts) / r.poss * 100));
  const opp = (arr) => mean(arr.map((r) => r.oppPts / r.poss * 100));
  const off = (arr) => mean(arr.map((r) => r.pts / r.poss * 100));
  const k = wo.length / (wo.length + 5);
  const mates = [];
  const ids = new Set(); for (const r of recs) for (const id of r.box.keys()) if (id !== p.id) ids.add(id);
  for (const id of ids) {
    const a = w.map((r) => r.box.get(id)).filter((x) => x?.min > 0), b = wo.map((r) => r.box.get(id)).filter((x) => x?.min > 0);
    if (a.length < 5 || b.length < 3) continue;
    const per36 = (arr, s) => arr.reduce((z, x) => z + x[s], 0) / arr.reduce((z, x) => z + x.min, 0) * 36;
    const dm = mean(b.map((x) => x.min)) - mean(a.map((x) => x.min));
    const dp = mean(b.map((x) => x.pts)) - mean(a.map((x) => x.pts));
    mates.push({ id, n: P.get(id)?.n, without: b.length, minDiff: round(dm), ptsDiff: round(dp), ptsPer36Diff: round(per36(b, "pts") - per36(a, "pts")), astDiff: round(mean(b.map((x) => x.ast)) - mean(a.map((x) => x.ast))) });
  }
  mates.sort((a, b) => Math.abs(b.ptsDiff) - Math.abs(a.ptsDiff));
  // opponents at his position: residual vs expectation when he plays vs sits
  const oppRes = (arr) => { const gids = new Set(arr.map((r) => r.gid)); const xs = playerGameRes.filter((r) => gids.has(r.gid) && r.opp === p.team && P.get(r.id)?.g === p.g); return { n: xs.length, pts: round(mean(xs.map((x) => x.rp))) }; };
  return {
    with: w.length, without: wo.length, coachDecisions: cd, // coachDecisions = games of "without" that the box score lists as a coach's decision
    netWith: round(net(w)), netWithout: round(net(wo)), netSwing: round((net(w) - net(wo)) * k),
    offSwing: round((off(w) - off(wo)) * k), defSwing: round((opp(wo) - opp(w)) * k),
    winPctWith: round(w.filter((r) => r.margin > 0).length / w.length, 3), winPctWithout: round(wo.filter((r) => r.margin > 0).length / wo.length, 3),
    teammates: mates.slice(0, 6), oppPosWith: oppRes(w), oppPosWithout: oppRes(wo),
  };
}

const rostersAll = rosters;
const teamProfiles = teams.map((t) => {
  const st = teamProfile(t.id, lastSeason, nowISO);
  const tr = getT(t.id);
  const cur = tr.recs.filter((r) => r.season === lastSeason && r.stype === 2 && !r.cup); // official regular-season record: no NBA Cup final
  const vsStyle = Object.entries(tr.vsStyle).filter(([, v]) => v.n >= 4).map(([k, v]) => ({ k, n: v.n, off: round(v.off / v.n), def: round(v.def / v.n), net: round((v.off - v.def) / v.n) })).sort((a, b) => a.net - b.net);
  const blowouts = cur.filter((r) => Math.abs(r.margin) >= 18), close = cur.filter((r) => Math.abs(r.margin) <= 8);
  const coach = rostersAll[t.id]?.coach;
  const coachTags = [];
  if (st.depth >= 10) coachTags.push("Deep rotation"); else if (st.depth && st.depth <= 8.3) coachTags.push("Tight rotation");
  if (st.starterShare >= 0.7) coachTags.push("Leans on starters"); else if (st.starterShare && st.starterShare <= 0.6) coachTags.push("Bench-reliant");
  if (blowouts.length >= 3 && close.length >= 3 && mean(blowouts.map((r) => r.starterShare)) < mean(close.map((r) => r.starterShare)) - 0.08) coachTags.push("Pulls starters early in blowouts");
  coachTags.push(...st.tags.filter((x) => ["Up-tempo", "Slow-paced", "3-point heavy", "Ball movement", "Isolation-heavy"].includes(x)));
  return {
    ...t, coach, coachExp: rostersAll[t.id]?.coachExp, coachTags, style: pickStyle(st),
    record: { w: cur.filter((r) => r.margin > 0).length, l: cur.filter((r) => r.margin < 0).length },
    last10: tr.recs.filter((r) => r.stype !== 1).slice(-10).map((r) => ({ d: r.date.slice(0, 10), opp: r.opp, home: r.home, pts: r.pts, oppPts: r.oppPts })),
    ratings: (() => { const r = rt(t.id); return { elo: Math.round(r.elo), adjOff: round(r.o), adjDef: round(r.d), adjNet: round(r.o - r.d), luckNet: round(r.oL - r.dL), threeLuck: round((r.o - r.d) - (r.oL - r.dL)) }; })(),
    vsModel: (() => { const lr = tr.res.slice(-10); return lr.length >= 5 ? { n: lr.length, off: round(mean(lr.map((r) => r.off))), def: round(mean(lr.map((r) => r.def))), net: round(mean(lr.map((r) => r.off - r.def))) } : null; })(),
    vsStyle, vsTeam: Object.entries(tr.vsTeam).filter(([, v]) => v.n >= 2).map(([k, v]) => ({ t: k, n: v.n, margin: round(v.margin / v.n) })),
    allowed: Object.fromEntries(Object.entries(st.allowed).map(([g, v]) => [g, { pts: round(v.pts, 3), reb: round(v.reb, 3), ast: round(v.ast, 3) }])),
    nba: ctx.teamExtras(t.id, t.abbr),
    lineups: ctx.lineups(t.abbr),
    news: ctx.newsFor([t.id], []).slice(0, 6).map(({ athletes, teams, ...x }) => x),
    ...SC.team(t.id), // zones, playTypes, playstyle, culture
    ...teamFlowBlocks(t.id, tr),
  };
});
// Coach rotation habits (play-by-play substitutions), quarter identity, trust, on/off and
// two-way interaction effects for one team. Coach changes inside a season are not known, so the
// team-season is the unit.
function teamFlowBlocks(tid, tr) {
  const habits = (season) => {
    const T = FLOW.team(tid, season); if (!T || !T.g) return null;
    const avg = (a) => (a[0] ? round(a[1] / a[0], 1) : null);
    const closers = [...T.closers].map(([id, n]) => ({ id, n: P.get(id)?.n || null, games: n, share: round(n / Math.max(1, T.closeG) * 100) })).sort((a, b) => b.games - a.games).slice(0, 6);
    const role = (r) => { const o = BLOW.team[`${tid}|${season}|${r}`] || {}; const f = (c) => (c && c[0] ? { games: c[0], minVsProj: round(c[1] / c[0]), ptsVsProj: round(c[2] / c[0]) } : null); return { win: f(o.w), loss: f(o.l) }; };
    return { season, games: T.g, firstSubMin: T.firstSubN ? round(T.firstSub / T.firstSubN / 60, 1) : null, subsPerGame: round(T.subs / T.g, 1),
      starterFirstStint: T.starterRestN ? round(T.starterRest / T.starterRestN / 60, 1) : null,
      playersUsed: { all: avg(T.depthAll), close: avg(T.depthClose), lopsided: avg(T.depthBlow), closeGames: T.depthClose[0], lopsidedGames: T.depthBlow[0] },
      starterQ4Min: { lopsided: avg(T.starterQ4Blow), other: avg(T.starterQ4Norm) },
      closers, closeGames: T.closeG, blowout: { starters: role("starter"), bench: role("bench") } };
  };
  const cur = habits(lastSeason), prev = habits(lastSeason - 1);
  const onOff = []; for (const p of P.values()) { if (!stillOn(p, tid)) continue; const o = FLOW.onOff(p.id); if (o && o.min >= FLOW_RULE.minOnOffMin) onOff.push({ id: p.id, n: p.n, min: Math.round(o.min), netOn: round(o.netOn), netOff: round(o.netOff), swing: round(o.netOn - o.netOff) }); }
  onOff.sort((a, b) => b.swing - a.swing);
  const tied = []; const byPlayer = new Map();
  for (const r of playerGameRes) { if (r.t !== tid || !teamOffRes.has(`${r.gid}|${tid}`)) continue; if (!byPlayer.has(r.id)) byPlayer.set(r.id, { x: [], y: [] }); const b = byPlayer.get(r.id); b.x.push(teamOffRes.get(`${r.gid}|${tid}`)); b.y.push(r.rp); }
  for (const [id, b] of byPlayer) { if (b.x.length < 20 || !stillOn(P.get(id), tid)) continue; const rg = regress(b.x, b.y); tied.push({ id, n: P.get(id)?.n || null, games: rg.n, ptsPer10TeamPts: round(rg.slope * 10), r: round(rg.r, 2) }); }
  tied.sort((a, b) => b.r - a.r);
  return {
    rotation: cur || prev ? { current: cur, previous: prev } : null, // field notes: meta.json > flow.notes.rotation
    quarterIdentity: QS.identity(tid, lastSeason),
    trust: trustOf(tr.terr),
    onOff: onOff.length ? { top: onOff.slice(0, 4), bottom: onOff.slice(-3).reverse().filter((r) => !onOff.slice(0, 4).includes(r)) } : null,
    interactions: { playersToTeam: playerProfiles.filter((pf) => pf.team === tid && pf.absence?.netSwing != null && stillOn(P.get(pf.id), tid)).map((pf) => ({ id: pf.id, n: pf.n, netSwing: pf.absence.netSwing, with: pf.absence.with, without: pf.absence.without, small: pf.absence.without < 10 })).sort((a, b) => Math.abs(b.netSwing) - Math.abs(a.netSwing)).slice(0, 5), teamToPlayers: tied.slice(0, 5), vsTeams: Object.entries(tr.vsTeam).filter(([, v]) => v.n >= 3).map(([k, v]) => ({ t: k, n: v.n, margin: round(v.margin / v.n), small: v.n < 5 })).sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin)).slice(0, 5),
    },
  };
}

// ------------------------------------------------------------------ upcoming games: keys, previous meetings, provable scenarios
{
  const GK = createGameKeys({ ZS, SC, learn, teamById, getT, P, results, details, playerGameRes, lastSeason, FXE, profById: new Map(playerProfiles.map((p) => [p.id, p])), MODEL_KEYS, MODEL_LABEL,
    phaseLabel: (season, stype) => phaseOf(season, stype).label, scoreOnly: NOBOX,
    withWithoutGames: (tid, pid) => withWithoutGames(tid, pid, null, lastSeason, stillOn(P.get(pid), tid)) });
  for (const u of upcoming) {
    const c = upcomingCtx.find((x) => x.id === u.id); if (!c) continue;
    for (const side of [c.pred.h, c.pred.a]) { const rows = u.teams.find((t) => t.tid === side.S.tid)?.players || []; for (const x of side.proj) { const row = rows.find((r) => r.id === x.id); if (row) row.zm = zoneNote(x, side, SC); } }
    Object.assign(u, GK.build(u, c.pred));
  }
}

// ------------------------------------------------------------------ ledger: why predictions missed, building up to today
const phases = [...new Set(results.map((r) => r.pk))];
const phaseSummary = phases.map((pk) => {
  const rs = results.filter((r) => r.pk === pk);
  const led = ledger.filter((l) => l.pk === pk);
  const cats = ["pace", "shooting", "overtime", "turnovers", "lineup", "other"];
  const abs = Object.fromEntries(cats.map((c) => [c, round(mean(led.map((l) => Math.abs(l[c] || 0))))]));
  const pl = Object.fromEntries(["minutes", "usage", "efficiency"].map((c) => [c, round(mean(led.map((l) => Math.abs(l.players[c]))))]));
  const flagged = rs.filter((r) => r.upsetFlag);
  return {
    pk, label: rs[0]?.phase, games: rs.length, winnerAcc: round(rs.filter((r) => r.correct).length / rs.length, 3),
    marginMAE: round(mean(rs.map((r) => r.err))), teamPtsMAE: round(mean(led.map((l) => l.absErr))),
    upsets: rs.filter((r) => r.upset).length, upsetFlags: flagged.length, upsetFlagHits: flagged.filter((r) => r.upset).length,
    teamErrorSources: abs, playerErrorSources: pl,
  };
});
// weekly timeline (cumulative + rolling)
const weeks = new Map();
for (const r of results) { const wk = weekKey(r.date); if (!weeks.has(wk)) weeks.set(wk, []); weeks.get(wk).push(r); }
function weekKey(d) { const x = new Date(d); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); }
let cumN = 0, cumC = 0;
const timeline = [...weeks.entries()].sort().map(([wk, rs]) => {
  cumN += rs.length; cumC += rs.filter((r) => r.correct).length;
  const led = ledger.filter((l) => weekKey(l.date) === wk);
  const tagCount = {}; for (const l of led) for (const t of l.tags) tagCount[t] = (tagCount[t] || 0) + 1;
  return {
    week: wk, phase: rs[0].phase, games: rs.length, acc: round(rs.filter((r) => r.correct).length / rs.length, 3), cumAcc: round(cumC / cumN, 3),
    marginMAE: round(mean(rs.map((r) => r.err))),
    sources: Object.fromEntries(["pace", "shooting", "overtime", "turnovers", "lineup", "other"].map((c) => [c, round(mean(led.map((l) => Math.abs(l[c] || 0))))])),
    playerSources: Object.fromEntries(["minutes", "usage", "efficiency"].map((c) => [c, round(mean(led.map((l) => Math.abs(l.players[c]))))])),
    tags: tagCount,
  };
});
// Scenario library (the learned "real situations" table)
const scenarioLib = {};
for (const [k, v] of Object.entries(learn.scen)) {
  const [s, r, stat] = k.split("|");
  const row = (scenarioLib[s] ||= { s, roles: {} });
  (row.roles[r] ||= {})[stat] = { effect: round(v.w, 2), n: v.n, rawAvg: round(v.raw / v.n, 2) };
}
const teamScenLib = Object.entries(learn.teamScen).map(([k, v]) => ({ k, effect: round(v.w, 2), n: v.n, rawAvg: round(v.raw / v.n, 2) })).sort((a, b) => b.n - a.n);
// Player tag frequency across the whole back-test ("what really happens")
const tagFreq = {};
for (const d of Object.values(details)) for (const pr of d.players) for (const t of pr.tags || []) {
  const o = (tagFreq[t] ||= { n: 0, pts: 0 }); o.n++; if (pr.pred) o.pts += pr.act.pts - pr.pred.pts;
}

// ------------------------------------------------------------------ learned matchup factors: what the back-test says
const factorReport = (() => {
  const rep = FXE.report();
  const count = (v) => rep.rows.filter((r) => r.verdict === v).length;
  const tp = rep.total.pts, tr = rep.total.reb, ta = rep.total.ast, t3 = rep.total.tpa;
  const d4 = (t) => (t ? `${t.reduction > 0 ? "-" : t.reduction < 0 ? "+" : ""}${Math.abs(t.reduction).toFixed(4)}` : "n/a");
  return {
    summary: `${rep.rows.length} factor effects tested walk-forward: ${count("helps")} help${count("helps") === 1 ? "s" : ""}, ${count("small")} ${count("small") === 1 ? "is" : "are"} small, ${rep.rows.length - count("helps") - count("small")} show no measurable effect yet and are held at zero. Change in mean absolute error of the unscaled projection from all applied effects together: points ${d4(tp)}, rebounds ${d4(tr)}, assists ${d4(ta)}, three-point attempts ${d4(t3)} (negative = better).`,
    note: "Each factor is a pre-game number x per player; its effect is gate x coefficient x x. Coefficients are learned from the leftover error of the unscaled projection (regular season, play-in and playoffs), game by game. errWithout / errWith are mean absolute errors of that unscaled projection over the games where the factor had a value, with the applied effect removed / included.",
    rules: FACTOR_RULES, zoneStateGames: ZS.stats(), ...rep,
  };
})();

// ------------------------------------------------------------------ in-loop features: what the back-test says
function inloopReport() {
  const p = IX.report(), t = IXT.report();
  const q = qCheck.n ? { games: qCheck.n / 2, teamQuarters: qCheck.n * 4,
    maeModel: round(mean(qCheck.model) / qCheck.n, 3), maeEvenSplit: round(mean(qCheck.even) / qCheck.n, 3), maeLeagueShares: round(mean(qCheck.league) / qCheck.n, 3),
    byQuarter: [0, 1, 2, 3].map((i) => ({ q: i + 1, model: round(qCheck.model[i] / qCheck.n, 3), even: round(qCheck.even[i] / qCheck.n, 3), league: round(qCheck.league[i] / qCheck.n, 3) })),
    note: "Regulation games only (regular season, play-in, playoffs). Each team's projected points are split into quarters with its own scoring shares and its opponent's allowed shares from earlier games (shrunk to the league's shares), so the four quarters always add up to the projected total. maeEvenSplit splits the same total evenly; maeLeagueShares uses the league's shares. Quarter splits do not change any game total or player projection." } : null;
  return {
    note: "Features learned inside the walk-forward loop, each from games before the one being projected. Each feature's effect is gate x coefficient x x; the gate opens only when the full coefficient would have reduced the error on games it had not yet learned from (t >= " + IX_RULE.t0 + "). errWithout / errWith: mean absolute error of the unscaled projection over the games where the feature had a value, with its applied effect removed / included. oosGainIfFull: average reduction in squared error had the full coefficient been applied (positive = helps). A feature with gate 0 moves nothing and is reported as evidence only.",
    rule: IX_RULE, players: p, team: t,
    returnCurves: { note: "League-wide, all players who missed 3+ games in a row and came back (this season's games only, regular season / play-in / playoffs). minVsProj / ptsVsProj: actual minus projection without the return effect. minPctOfBefore / ptsPctOfBefore: actual as a share of his averages in the 10 games before the absence. Injury type is not point-in-time for past games (ESPN's stored list is the one on the download day), so the curves are by absence length only; the type is shown for upcoming games when the current injury report gives it.", rows: RET.report() },
    quarters: q,
    defMatch: { ...MUS.report(), rule: DM_RULE, features: ["defReal", "defPair"], mode: DM_MODE,
      ablation: "Walk-forward over the 2025-26 and 2026-27 seasons, defReal t-value of its out-of-sample gain (needs " + IX_RULE.t0 + " to open): centred 1.5 (coef 0.19, published); replace (minus the position adjustment) 0.6; pure 0.6; shares (only where the expected shares differ from his position-based shares) -0.4; centred with 3x shrinkage 1.2; with 8x shrinkage 0.8. defPair: -0.2 (default shrinkage), -0.8 and -1.5 with more. With both gates closed the published projections are identical to the run without them.",
      note: "Who guarded whom, from NBA.com matchup tracking (partial possessions of each defender on each scorer), folded into the walk-forward state only for games that tipped off strictly before the game being projected; preseason left out. defReal: the expected share of a scorer's possessions taken by each of tonight's defenders (previous meetings, else the defender's usual split by position) times that defender's points allowed against expected versus similar scorers (defenders with " + DM_RULE.minDefPoss + "+ possessions), minus the same for an average possession against that team. defPair is his own record against tonight's likely defenders beyond their general record. Both are gated like every in-loop feature: applied only as far as they reduced out-of-sample error. Neither gate opened, so the position-based defender adjustment (\"likely defender at his position\") stays the method used in the projection and the matchup data is evidence only. groupMatrix: league share (%) of each defender group's possessions spent on guards / forwards / centres, the learned position fallback for shares." },
    splits: { rule: { minGames: { opponent: 5, opposingPlayer: 5, arena: 5, other: SPLIT_MIN_DEFAULT }, smallSample: SPLIT_SMALL, relative: !SPLITS_OLD },
      note: "Each split is his average gap against projection in that situation minus his overall gap across all his games, so a player projected too low everywhere does not show the same gap in every situation. Used in projections and listed only from 5 games (a specific opponent, opposing player or arena: the schedule allows only 3-4 meetings a season) or 8 games (situations, styles, sizes, archetypes). Under 10 games is a small sample.",
      projection: SPLITS_OLD ? "previous rule" : SPLITS_ABSPROJ ? "full gap in the situation, new minimums" : "relative gap, new minimums",
      ablation: "Walk-forward, 2025-26 / 2026-27 regular season (winner %, margin MAE, points MAE of players projected 15+ minutes). Previous rule (plain gap from 2 games, splits in the team total): 67.9 / 68.2, 11.41 / 11.73, 4.980 / 4.993. New minimums, full gap in the projection, splits kept out of the team-level sum (published): 68.0 / 68.8, 11.37 / 11.55, 4.949 / 4.957. Same with the relative gap in the projection: 67.8 / 67.5, 11.37 / 11.54, 4.939 / 4.953 (better points, fewer winners called). Same with splits left in the team-level sum: 67.5 / 68.2, 11.39 / 11.65, 4.950 / 4.958. Three-point attempts and minutes always take the full gap: they have no overall-gap term of their own." },
    flow: { ...FLOW.stats(), rule: FLOW_RULE, note: "On-court fives rebuilt from substitutions. Checked against box scores over all 2025-26 and 2026-27 games after preseason: minutes within 0.25 a player-game on average, play-by-play points within 0.002, and plus-minus within 0.03. partial = games where the five could not be fully inferred for some stretch." },
  };
}

// ------------------------------------------------------------------ write
fs.rmSync(path.join(OUT, "games"), { recursive: true, force: true });
for (const [id, d] of Object.entries(details)) writeJSON(path.join(OUT, "games", `${id}.json`), d);
writeJSON(path.join(OUT, "results.json"), results);
// ---- takes from analysts, blogs and video channels, each checked against the numbers ----
const profById = new Map(playerProfiles.map((p) => [p.id, p]));
const takes = ctx.allNews().filter((n) => !isBetting(n) && Date.parse(n.date) > Date.now() - 14 * 864e5).map((n) => { // betting content is already dropped in fetch.mjs and context.mjs; this is the last guard
  const checks = [];
  for (const id of n.athletes.slice(0, 3)) {
    const p = profById.get(String(id)); if (!p || !p.last5 || !(p.cur || p.prev)) continue;
    const seasonLine = p.cur || p.prev;
    const form = p.last5.pts - seasonLine.pts, vsModel = p.bias ?? 0;
    let verdict = "No clear signal in the numbers";
    if (n.tone > 0) verdict = form >= 2 || vsModel >= 2 ? "Numbers agree" : form <= -2 ? "Numbers disagree" : "Not confirmed by the numbers";
    if (n.tone < 0) verdict = form <= -2 || vsModel <= -2 ? "Numbers agree" : form >= 2 ? "Numbers disagree" : "Not confirmed by the numbers";
    if (n.tone === 0) verdict = "Neutral report";
    checks.push({ id: p.id, n: p.n, verdict, last5: p.last5.pts, season: seasonLine.pts, vsModel: round(vsModel) });
  }
  return { outlet: n.outlet, kind: n.kind, title: n.title, url: n.url, date: n.date, summary: n.summary, flags: n.flags, tone: n.tone, teams: n.teams, athletes: n.athletes.map(String), checks };
});
writeJSON(path.join(OUT, "takes.json"), takes);

fs.rmSync(path.join(OUT, "upcoming"), { recursive: true, force: true });
for (const u of upcoming) writeJSON(path.join(OUT, "upcoming", `${u.id}.json`), u);
writeJSON(path.join(OUT, "upcoming.json"), upcoming.map((u) => ({
  id: u.id, date: u.date, phase: u.phase, home: u.home, away: u.away, venue: u.venue, pred: u.pred,
  upset: { flag: u.upset.flag, n: u.upset.reasons.length, dogP: round(u.upset.dogP, 3) },
  out: u.teams.map((t) => t.out.filter((o) => o.star).map((o) => o.n)),
  top: u.teams.map((t) => t.players.slice(0, 3).map((p) => ({ n: p.n, pts: p.pts, reb: p.reb, ast: p.ast }))),
  q: u.teams.map((t) => t.quarters?.proj || null), // projected points by quarter [home, away]
  keys: u.keys ? u.keys.teams.map((k) => ({ tid: k.tid, win: k.win.slice(0, 2).map((x) => x.t) })) : null, // a team's reasons to lose are the other team's reasons to win
  h2h: u.h2h ? { n: u.h2h.n, record: u.h2h.record } : null, scenarios: u.scenarios ? u.scenarios.list.length : 0,
})));
// ---- snapshot of this run's upcoming projections (data/history), so a later view can show what changed ----
// One small file per run, named by the run's Philippine date and time; the newest 120 are kept.
// A scratch run (CL_OUT) does not write one unless CL_HISTORY=1.
if (!process.env.CL_OUT || process.env.CL_HISTORY === "1") {
  const HIST = path.join(DATA, "history");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowISO)).map((x) => [x.type, x.value]));
  const stamp = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
  fs.mkdirSync(HIST, { recursive: true });
  writeJSON(path.join(HIST, `projections-${stamp}.json`), {
    format: 1, run: nowISO, runManila: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`, games: upcoming.map((u) => ({
      id: u.id, date: u.date, home: u.home, away: u.away, hs: u.pred.hs, as: u.pred.as, pHome: u.pred.pHome,
      out: u.teams.map((t) => t.out.map((o) => o.id)), q: u.teams.map((t) => t.players.filter((p) => p.q).map((p) => p.id)),
      players: u.teams.map((t) => t.players.filter((p) => p.min >= 8).slice(0, 10).map((p) => [p.id, p.n, p.min, p.pts, p.reb, p.ast])),
    })) });
  const old = fs.readdirSync(HIST).filter((f) => /^projections-.*\.json$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 120))) fs.rmSync(path.join(HIST, f), { force: true });
}
fs.rmSync(path.join(OUT, "players"), { recursive: true, force: true });
for (const p of playerProfiles) writeJSON(path.join(OUT, "players", `${p.id}.json`), p);
writeJSON(path.join(OUT, "players.json"), playerProfiles.map((p) => ({ id: p.id, n: p.n, pos: p.pos, team: p.team, arch: p.archetype, k2: p.k2?.ovr ?? null, cur: p.cur ? [p.cur.gp, p.cur.min, p.cur.pts, p.cur.reb, p.cur.ast] : null, prev: p.prev ? [p.prev.gp, p.prev.min, p.prev.pts, p.prev.reb, p.prev.ast] : null,
  hot: p.zones ? p.zones.five.filter((z) => z.tag === "hot").map((z) => z.id) : [], cold: p.zones ? p.zones.five.filter((z) => z.tag === "cold").map((z) => z.id) : [], tags: p.playstyle?.tags || [] })));
// The four scouting blocks of a team are also written to teams/<id>.json so the site can load them
  // on demand. TEAMS_JSON_SLIM = true drops them from teams.json (498 KB -> about 200 KB on first
  // load); it stays false until the site reads teams/<id>.json, because the team page and the Scout
  // matchup lab still take them from teams.json.
const TEAMS_JSON_SLIM = process.env.CL_TEAMS_SLIM === "1";
const TEAM_SCOUT_KEYS = ["zones", "zones14", "playTypes", "playstyle", "culture"];
fs.rmSync(path.join(OUT, "teams"), { recursive: true, force: true });
for (const t of teamProfiles) writeJSON(path.join(OUT, "teams", `${t.id}.json`), { id: t.id, ...Object.fromEntries(TEAM_SCOUT_KEYS.map((k) => [k, t[k] ?? null])) });
writeJSON(path.join(OUT, "teams.json"), TEAMS_JSON_SLIM ? teamProfiles.map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !TEAM_SCOUT_KEYS.includes(k)))) : teamProfiles);
writeJSON(path.join(OUT, "learning.json"), {
  phaseSummary, timeline, scenarios: Object.values(scenarioLib), teamScenarios: teamScenLib,
  calibration: [50, 60, 70, 80, 90].map((lo) => {
    const rs = results.filter((r) => !r.pk.endsWith("-1")).filter((r) => { const p = Math.max(r.pred.pHome, 1 - r.pred.pHome) * 100; return p >= lo && p < lo + 10.01; });
    return { bucket: `${lo}-${lo + 10}%`, games: rs.length, said: rs.length ? round(mean(rs.map((r) => Math.max(r.pred.pHome, 1 - r.pred.pHome))) * 100) : null, happened: rs.length ? round(rs.filter((r) => r.correct).length / rs.length * 100) : null };
  }),
  models: MODEL_KEYS.map((k) => ({ k, label: MODEL_LABEL[k], weight: round(learn.w[k], 2),
    phases: phases.filter((pk) => learn.modelErr[pk + "|" + k]).map((pk) => { const o = learn.modelErr[pk + "|" + k]; return { pk, acc: round(o.hit / o.n, 3), mae: round(o.abs / o.n) }; }) })),
  rangeCoverage: { target: 80, actual: coverage.n ? round(coverage.inside / coverage.n * 100) : null, n: coverage.n,
    above: coverage.n ? round(coverage.above / coverage.n * 100) : null, below: coverage.n ? round(coverage.below / coverage.n * 100) : null, zHi: round(learn.rangeZ.hi, 3), zLo: round(learn.rangeZ.lo, 3),
    note: "lo / hi = projected points minus zLo and plus zHi standard deviations. Both widths start at 1.28 and are adjusted after every player-game so that about 10% of results land above the range and 10% below it. above / below are the walk-forward shares over all games counted." },
  // Two tracks. phaseSummary (and every stored game page) is the tip-off track: the projection knows
  // the confirmed inactive list and the starting five, as they are announced shortly before a game.
  // liveTrack is the same model with neither: only who played recently, with a player assumed out
  // when he missed the previous game. Upcoming games are projected hours or days ahead with the
  // injury report, which sits between the two.
  withWithout: { applied: WW_APPLY, note: "Pairwise with/without evidence (a player's scoring in the games an absent teammate missed versus the games they shared) is counted and shown, but not added to projections. With 'without' counted as every game the teammate missed while on the team, the walk-forward points error for players projected 15+ minutes was: 4.980 (2025-26 regular season) and 4.993 (2026-27) without it; 4.990 and 5.001 with it, weighted by how recent the absence is; 5.020 and 5.019 with it unweighted. Absences still move projections through the minutes and usage that are redistributed." },
  liveTrack: { note: "Same walk-forward model, scored a second time without the starting line-ups and without the inactive list (a player is assumed out only if he missed his team's previous game; the stored injury list of a past game is not point-in-time, so it is not used). This is a lower bound for projections made ahead of time: upcoming games also have the current injury report. Never learned from. ptsMAE / minMAE: players projected 15+ minutes who played; absentShare: players projected 15+ minutes who did not play.",
    rosterRule: `Players with minutes in the team's last ${ROSTER_RECENT} games who are still on its roster, recent arrivals from another team, and players on the injury list who have played before. Rostered players with no recent minutes get no default minutes.`,
    phases: Object.entries(liveTrack).map(([pk, o]) => ({ pk, label: o.label, games: o.g, winnerAcc: round(o.win / o.g, 3), marginMAE: round(o.mErr / o.g, 2), players: o.n, ptsMAE: o.n ? round(o.pts / o.n, 2) : null, minMAE: o.n ? round(o.min / o.n, 2) : null, absentShare: o.proj15 ? round(o.absent / o.proj15, 3) : null,
      top5Min: round(o.top5 / o.teams), rotation: round(o.cnt1 / o.teams), top5MinBias: round(o.topMinBias / o.topN, 2), top5PtsBias: round(o.topPtsBias / o.topN, 2) })) },
  referees: { games: refCheck.n, applied: refCheck.applied, totalErrWith: round(refCheck.withRef / Math.max(1, refCheck.n), 2), totalErrWithout: round(refCheck.without / Math.max(1, refCheck.n), 2),
    crews: Object.entries(learn.refs).filter(([, r]) => r.n >= 25).map(([n, r]) => ({ n, games: r.n, total: round(r.tot / r.n), home: round(r.home / r.n) })).sort((a, b) => b.total - a.total) },
  tagFreq: Object.entries(tagFreq).map(([k, v]) => ({ k, n: v.n, avgPts: round(v.pts / v.n) })).sort((a, b) => b.n - a.n),
  params: learn.history,
  factors: factorReport,
  inloop: inloopReport(),
  efficiency: { applied: EFF_K > 0, k: EFF_K, halfLife: EFF_HL, note: "Scoring rate = shot volume (recent games, half-life 10) x shooting efficiency (points per true shot attempt over a long window, half-life " + EFF_HL + " games, shrunk toward his position average with " + EFF_K + " attempts of league shooting). A hot or cold week moves the volume, not the efficiency. Walk-forward test (2026-11-11), players projected 15+ minutes: points error 4.949 -> 4.933 (2025-26 regular season) and 4.950 -> 4.922 (2026-27); game-level Brier score unchanged." },
});
writeJSON(path.join(OUT, "meta.json"), {
  updated: nowISO, games: games.length, predicted, upcoming: upcoming.length, players: playerProfiles.length,
  sources: ctx.sourceSummary(),
  note: "Walk-forward: every past game was projected using only data available before tip-off. No betting odds or sportsbook lines are used.",
  data: { scoreOnlyGames: dataNotes.scoreOnly, blankBoxRowsRebuilt: dataNotes.blankRowsRebuilt, cupFinals: dataNotes.cupFinals,
    note: "scoreOnlyGames: finished games ESPN has no box score for; they count in records, meetings, rest days and Elo only. blankBoxRowsRebuilt: box-score rows ESPN returned without a player (rebuilt as team totals minus the listed players). cupFinals: NBA Cup finals, left out of regular-season records and season lines as in official statistics. Rest days and back-to-backs are counted in US Eastern calendar days." },
  flow: { rule: FLOW_RULE, trustRule: TRUST_RULE, notes: {
    rotation: `teams.json > rotation (current / previous season), from play-by-play substitutions, preseason left out. firstSubMin: minutes into the game of the first substitution. subsPerGame: substitutions a game. starterFirstStint: minutes a starter plays before his first rest. playersUsed: players with 1+ minute in all games, in games decided by ${FLOW_RULE.closeGame} or fewer (close) and by ${FLOW_RULE.lopsided}+ (lopsided). starterQ4Min: 4th-quarter minutes of the five starters together. closers: on the floor with 2:00 left in the 4th and the score within ${FLOW_RULE.tight} (games = how often, share = of closeGames). blowout: minutes and points against projection for starters and bench in games won / lost by ${FLOW_RULE.far}+. Coach changes inside a season are not known: the unit is the team-season.`,
    onOff: "teams.json > onOff / interactions.playersToTeam: team net points per 100 possessions with each player on the floor minus off it (300+ minutes, this season and last, current roster).",
    teamInteractions: "teams.json > interactions. teamToPlayers: players whose points against projection move most with the team's own scoring against its projection (per 10 team points, 20+ games). vsTeams: margin against projection versus one opponent (3+ meetings; under 5 = small).",
    quarterIdentity: "teams.json > quarterIdentity and upcoming teams[].quarters.identity: average margin and points per quarter, this season (all games when fewer than 5). quarters.proj: projected points by quarter, adding up to the projected total.",
    trust: `trust on players, teams and upcoming rows: mean absolute error of the published projection over the last ${TRUST_RULE.recent} games against the typical error for similar projections at the time. ratio <= ${TRUST_RULE.good}: reads well; >= ${TRUST_RULE.poor}: keeps missing. bias = actual minus projection (positive = projected too low). Fewer than ${TRUST_RULE.minGames} games: too few games.`,
    onOffOut: "upcoming teams[].onOffOut: team points implied by the on/off records of tonight's absent players (own offence, opponent's defence). applied = what moved the projection (0 while the feature's gate is closed, see learning.json > inloop.team).",
  } },
  scout: { window: SC.windowLabel, teamScope: SC.scopeLabel, zoneTagRule: TAG_RULE, defenderTagRule: DEF_RULE, scenarioMinGames: SCEN_MIN, zoneDecay: DECAY, cultureMin: CULTURE_MIN,
    zoneBias: "Versus NBA.com's own zone table (2025-26 regular season, all teams): corner threes are counted about 1.5% high and above-the-break threes a little under 1% low, because ESPN's shot coordinates are whole feet and 753 threes sit exactly on the corner line. FG% by zone is within 0.1 points.",
    zones: Z5.map((id) => ({ id, label: ZONE_LABEL[id] })), fineZones: FINE_ZONES.filter((z) => z.id !== "heave").map((z) => ({ id: z.id, zone: z.zone, label: z.label })), styles: STYLES.filter((s) => s.id !== "heave"),
    factors: FACTORS.map((f) => ({ id: f.id, label: f.label, stats: f.stats, unit: f.unit, what: f.what })),
    note: "Hot / cold zones need zoneTagRule.minAtt attempts, a gap of minDiff points of FG% versus league and minZ standard errors. 'On paper' edges assume the opponent's zone percentages carry over in full; learning.json > factors shows how much of each edge the back-test supports." },
});
console.log(`done: ${predicted} games walked, ${upcoming.length} upcoming, ${playerProfiles.length} players, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(phaseSummary.map((p) => `${p.label}: ${p.games} games, winner ${Math.round(p.winnerAcc * 100)}%, margin MAE ${p.marginMAE}`).join("\n"));
