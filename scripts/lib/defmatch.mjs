// Who guarded whom, as walk-forward state for the model (NBA.com matchup tracking, data/matchups/).
//
// Leak-free: games are queued after they are projected and only folded into the state by
// flush(iso), which takes games that tipped off STRICTLY before iso. The model calls flush(g.date)
// before projecting game g, so two games with the same tip-off time never see each other.
// Preseason games are left out (rotations and defensive effort are not representative).
//
// What is kept (all sums over partial possessions, "poss" = NBA.com partial possessions):
//   off[o]        his points per partial possession against everyone (his own rate)
//   def[d]        points he allowed, and the points the same scorers were EXPECTED to score on
//                 those possessions (each scorer's own rate before that game), overall and by
//                 scorer type (position group x scoring tier = "similar scorers")
//   pair[o|d]     o's possessions and output with d guarding him, the number of games they were on
//                 opposite sides (met) and o's total tracked possessions in those games (oTot)
//   lgMat         league share of each defender group's possessions spent on each scorer group
//                 (the learned "defender at his position" fallback)
import { loadMatchups } from "./matchups.mjs";

export const DM_RULE = {
  offK: 25,        // possessions of league rate added to a scorer's own rate
  defK: 120,       // a defender's allowed-vs-expected is shrunk to 0 with this many possessions
  typeK: 80,       // his record vs one scorer type is shrunk to his overall record with this many possessions
  pairK: 40,       // a pair's excess (beyond the defender's general record) is shrunk with this many possessions
  shareK: 2,       // previous-meeting shares are blended with the prior with this many games
  minDefPoss: 30,  // a defender counts as "has a matchup record" from this many possessions
  smallPoss: 50,   // rows under this many possessions are labelled small
  smallGames: 3,   // pairs from fewer meetings than this are labelled small
  tiers: [[18, "high-volume"], [9, "mid-volume"], [0, "low-volume"]], // tracked points per game
};
// CL_DM_K=defK,typeK,pairK overrides the shrinkage for an ablation run
if (process.env.CL_DM_K) { const [a, b, c] = process.env.CL_DM_K.split(",").map(Number); if (a) DM_RULE.defK = a; if (b) DM_RULE.typeK = b; if (c) DM_RULE.pairK = c; }
const GROUPS = ["G", "F", "C"];
const tierOf = (ppg) => DM_RULE.tiers.find(([lo]) => ppg >= lo)[1];
const blank = () => ({ poss: 0, pts: 0, exp: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, ast: 0, tov: 0, blk: 0, sec: 0 });
const addRow = (o, r, exp) => { o.poss += r.poss; o.pts += r.pts; o.exp += exp; o.fgm += r.fgm; o.fga += r.fga; o.tpm += r.tpm; o.tpa += r.tpa; o.ftm += r.ftm; o.fta += r.fta; o.ast += r.ast; o.tov += r.tov; o.blk += r.blk; o.sec += r.sec; };

// grpOf(id) -> "G" | "F" | "C" (the model's position group); load(espnId) -> loadMatchups-like object
export function createDefMatchState({ grpOf = () => "F", load = loadMatchups } = {}) {
  const R = DM_RULE;
  const lg = { poss: 0, pts: 0, mat: Object.fromEntries(GROUPS.map((d) => [d, Object.fromEntries(GROUPS.map((o) => [o, 0]))])) };
  const off = new Map(), def = new Map(), pair = new Map();
  const offPairs = new Map(), defPairs = new Map();
  const pending = [];
  const stats = { games: 0, rows: 0, missing: 0, skippedPre: 0 };
  const lgRate = () => (lg.poss > 500 ? lg.pts / lg.poss : 1.1);
  const offRate = (o) => { const s = off.get(o); return s ? (s.pts + lgRate() * R.offK) / (s.poss + R.offK) : lgRate(); };
  const offPpg = (o) => { const s = off.get(o); return s && s.games ? s.pts / s.games : 0; };
  const typeOf = (o) => `${grpOf(o) || "F"}|${tierOf(offPpg(o))}`;
  const getDef = (d) => { if (!def.has(d)) def.set(d, { ...blank(), games: 0, byG: Object.fromEntries(GROUPS.map((x) => [x, blank()])), byT: {} }); return def.get(d); };
  const getPair = (o, d) => {
    const k = `${o}|${d}`;
    if (!pair.has(k)) {
      pair.set(k, { ...blank(), games: 0, met: 0, oTot: 0, last: null, team: null });
      if (!offPairs.has(o)) offPairs.set(o, new Set()); offPairs.get(o).add(d);
      if (!defPairs.has(d)) defPairs.set(d, new Set()); defPairs.get(d).add(o);
    }
    return pair.get(k);
  };

  function queue(g) { if (g.stype === 1) { stats.skippedPre++; return; } pending.push({ id: String(g.id), date: g.date }); }
  function flush(beforeIso) {
    if (!pending.length) return;
    pending.sort((a, b) => a.date.localeCompare(b.date));
    while (pending.length && (beforeIso == null || pending[0].date < beforeIso)) ingest(pending.shift());
  }
  function ingest({ id, date }) {
    const m = load(id);
    if (!m || !m.rows?.length) { stats.missing++; return; }
    stats.games++;
    const rows = m.rows.filter((r) => !String(r.off).startsWith("nba:") && !String(r.def).startsWith("nba:") && r.poss > 0);
    stats.rows += rows.length;
    // rates and types BEFORE this game (the expectation for each possession)
    const rate = new Map(), type = new Map(), gOf = new Map();
    for (const r of rows) for (const pid of [r.off, r.def]) if (!gOf.has(pid)) gOf.set(pid, grpOf(pid) || "F");
    for (const r of rows) if (!rate.has(r.off)) { rate.set(r.off, offRate(r.off)); type.set(r.off, typeOf(r.off)); }
    // per side: scorers, defenders, scorer's total possessions in this game
    const sides = [0, 1].map(() => ({ offs: new Map(), defs: new Set() }));
    for (const r of rows) { const s = sides[r.side]; s.offs.set(r.off, (s.offs.get(r.off) || 0) + r.poss); s.defs.add(r.def); }
    const defTeam = (side) => (side === 0 ? m.a : m.h);
    // pairs that met (on opposite sides in this game), whether or not d ever guarded o
    for (let side = 0; side < 2; side++) {
      const s = sides[side];
      for (const [o, tot] of s.offs) for (const d of s.defs) { const p = getPair(o, d); p.met++; p.oTot += tot; p.last = date; p.team = defTeam(side); }
    }
    const offGame = new Map(), defGame = new Set();
    for (const r of rows) {
      const exp = r.poss * rate.get(r.off);
      const p = getPair(r.off, r.def); addRow(p, r, exp); p.games++;
      const D = getDef(r.def); addRow(D, r, exp); defGame.add(r.def);
      addRow(D.byG[gOf.get(r.off)] || D.byG.F, r, exp);
      const t = type.get(r.off); addRow((D.byT[t] ||= blank()), r, exp);
      lg.mat[gOf.get(r.def)][gOf.get(r.off)] += r.poss;
      const og = offGame.get(r.off) || { poss: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 };
      og.poss += r.poss; og.pts += r.pts; og.fgm += r.fgm; og.fga += r.fga; og.tpm += r.tpm; og.tpa += r.tpa; offGame.set(r.off, og);
    }
    for (const d of defGame) getDef(d).games++;
    for (const [o, og] of offGame) {
      const s = off.get(o) || { poss: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, games: 0 };
      s.poss += og.poss; s.pts += og.pts; s.fgm += og.fgm; s.fga += og.fga; s.tpm += og.tpm; s.tpa += og.tpa; s.games++; off.set(o, s);
      lg.poss += og.poss; lg.pts += og.pts;
    }
  }

  // ---- queries (state as of the last flush) ----
  // allowed-vs-expected as a fraction of expected points (negative = held scorers below their rate)
  function defRel(d, oType) {
    const D = def.get(d); if (!D || D.poss < 1) return { rel: 0, poss: 0, has: false };
    const lr = lgRate();
    const overall = (D.pts - D.exp) / (D.exp + R.defK * lr);
    let rel = overall, tPoss = 0;
    const T = oType && D.byT[oType];
    if (T && T.poss > 0) { tPoss = T.poss; rel = (T.pts - T.exp + overall * R.typeK * lr) / (T.exp + R.typeK * lr); }
    return { rel, overall, poss: D.poss, typePoss: tPoss, has: D.poss >= R.minDefPoss };
  }
  function lgFrac(dg, og) { const row = lg.mat[dg] || lg.mat.F, s = GROUPS.reduce((z, x) => z + row[x], 0); return s > 0 ? row[og] / s : dg === og ? 0.6 : 0.2; }
  // Expected share of scorer o's possessions guarded by each opposing defender tonight.
  // defenders: [{ id, n, g, min }] (projected available, minutes = his usual minutes)
  // prior: defender's own split of possessions by scorer group (shrunk to the league split for his group)
  // x minutes; then blended with the shares seen in previous meetings (pair.poss / pair.oTot).
  function shares(o, og, defenders) {
    const rows = [];
    for (const dd of defenders) {
      if (!(dd.min > 0)) continue;
      const D = def.get(dd.id), lf = lgFrac(dd.g || "F", og);
      const frac = D ? ((D.byG[og]?.poss || 0) + lf * 40) / (D.poss + 40) : lf;
      rows.push({ ...dd, prior: dd.min * frac, frac, p: pair.get(`${o}|${dd.id}`) || null });
    }
    const ps = rows.reduce((z, r) => z + r.prior, 0) || 1;
    for (const r of rows) {
      r.prior /= ps;
      const p = r.p;
      const met = p && p.oTot > 0 ? p.met : 0;
      r.obs = met ? p.poss / p.oTot : null;
      r.share = met ? (met * r.obs + R.shareK * r.prior) / (met + R.shareK) : r.prior;
    }
    const ss = rows.reduce((z, r) => z + r.share, 0) || 1;
    for (const r of rows) r.share /= ss;
    return rows.sort((a, b) => b.share - a.share);
  }
  // The pre-game matchup picture for one scorer. Returns null when there is nothing to say.
  //   real   : sum of share x (defender's allowed-vs-expected vs similar scorers), defenders with a record only
  //   pair   : sum of share x (his excess against that defender beyond the defender's general record)
  //   cover  : share of his expected possessions guarded by defenders who have a matchup record
  function scorer(o, og, defenders) {
    if (!defenders?.length) return null;
    const oType = `${og}|${tierOf(offPpg(o))}`;
    const rows = shares(o, og, defenders), lr = lgRate();
    let real = 0, pr = 0, cover = 0, met = 0, team = 0, tw = 0, tp = 0;
    for (const r of rows) {
      const dr = defRel(r.id, oType);
      r.rel = dr.has ? dr.rel : 0; r.defPoss = dr.poss; r.typePoss = dr.typePoss; r.has = dr.has;
      if (dr.has) { real += r.share * r.rel; cover += r.share; }
      tw += r.min; if (dr.has) { team += r.min * r.rel; tp += r.prior * r.rel; } // team: minutes-weighted; tp: his position-based expected shares (no meetings)
      const p = r.p;
      r.excess = 0;
      if (p && p.poss > 0) { r.excess = (p.pts - p.exp * (1 + (dr.has ? dr.overall : 0))) / (p.exp + R.pairK * lr); pr += r.share * r.excess; }
      if (p && p.met) met += p.met;
    }
    return { oType, rows, real, team: tw ? team / tw : 0, teamPrior: tp, pair: pr, cover, met, src: met > 0 ? "previous meetings + matchup records" : cover > 0 ? "matchup records" : "position only" };
  }

  // ---- publishing ----
  const per100 = (pts, poss) => (poss > 0 ? Math.round(pts / poss * 1000) / 10 : null);
  const pct = (m, a) => (a > 0 ? Math.round(m / a * 1000) / 10 : null);
  const line = (s) => ({ poss: Math.round(s.poss), pts: s.pts, per100: per100(s.pts, s.poss), exp100: per100(s.exp, s.poss), vsExp100: s.poss > 0 ? Math.round((s.pts - s.exp) / s.poss * 1000) / 10 : null,
    fgm: s.fgm, fga: s.fga, fgPct: pct(s.fgm, s.fga), tpm: s.tpm, tpa: s.tpa, min: Math.round(s.sec / 6) / 10 });
  // who guarded scorer o most, and how he did against each
  function guardedBy(o, nameOf, teamOf, k = 8) {
    const S = off.get(o); if (!S || !offPairs.has(o)) return null;
    const rows = [...offPairs.get(o)].map((d) => ({ d, p: pair.get(`${o}|${d}`) })).filter((x) => x.p.poss > 0)
      .sort((a, b) => b.p.poss - a.p.poss).slice(0, k)
      .map(({ d, p }) => ({ id: d, n: nameOf(d), team: teamOf(d), games: p.games, met: p.met, share: p.oTot ? Math.round(p.poss / p.oTot * 1000) / 10 : null, ...line(p), last: p.last ? p.last.slice(0, 10) : null, small: p.poss < R.smallPoss || p.games < R.smallGames }));
    return { poss: Math.round(S.poss), games: S.games, per100: per100(S.pts, S.poss), fgm: S.fgm, fga: S.fga, fgPct: pct(S.fgm, S.fga), rows };
  }
  // whom defender d guarded, and the results; plus his record against each scorer type
  function guards(d, nameOf, teamOf, k = 8) {
    const D = def.get(d); if (!D || D.poss < 1) return null;
    const rel = defRel(d);
    const rows = [...(defPairs.get(d) || [])].map((o) => ({ o, p: pair.get(`${o}|${d}`) })).filter((x) => x.p.poss > 0)
      .sort((a, b) => b.p.poss - a.p.poss).slice(0, k)
      .map(({ o, p }) => ({ id: o, n: nameOf(o), team: teamOf(o), games: p.games, ...line(p), last: p.last ? p.last.slice(0, 10) : null, small: p.poss < R.smallPoss || p.games < R.smallGames }));
    const byType = Object.entries(D.byT).filter(([, s]) => s.poss >= 20).sort((a, b) => b[1].poss - a[1].poss)
      .map(([t, s]) => { const [g, tier] = t.split("|"); return { type: t, label: `${tier} ${{ G: "guards", F: "forwards", C: "centres" }[g] || g}`, ...line(s), small: s.poss < 150 }; });
    const total = GROUPS.reduce((z, x) => z + D.byG[x].poss, 0) || 1;
    return { games: D.games, ...line(D), shrunkVsExpPct: Math.round(rel.rel * 1000) / 10, small: D.poss < 300,
      groupShare: Object.fromEntries(GROUPS.map((x) => [x, Math.round(D.byG[x].poss / total * 1000) / 10])), byType, rows };
  }
  function report() {
    const lr = lgRate();
    return { ...stats, leagueRate100: Math.round(lr * 1000) / 10, scorers: off.size, defenders: def.size, pairs: pair.size,
      groupMatrix: Object.fromEntries(GROUPS.map((dg) => [dg, Object.fromEntries(GROUPS.map((og) => [og, Math.round(lgFrac(dg, og) * 1000) / 10]))])), pending: pending.length };
  }
  return { queue, flush, scorer, guardedBy, guards, report, defRel, lgRate };
}
