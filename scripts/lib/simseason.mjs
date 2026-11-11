// Rest-of-season simulation: standings, seeding, play-in and playoff chances.
// Statistical only: current ratings + the model's projections for the games it has
// already projected. No betting data.
//
// Schedule: the real dates for every game in data/schedule (played games and the next
// week or so). ESPN's feed gives only about a week ahead, so the rest of each team's 82
// games is filled with the NBA's schedule formula (4 games against each division rival,
// 3.6 on average against the other 10 conference teams, 2 against each team of the other
// conference), minus the meetings already played or scheduled, balanced so every team
// reaches 82. Those meetings have no dates, so rest and travel are not simulated for them.
import fs from "node:fs";
import path from "node:path";
import { DATA, readJSON } from "./util.mjs";
import { markCupFinals } from "./boxfix.mjs";
import { makeRng } from "./simrng.mjs";

export const LEAGUE = {
  East: { Atlantic: ["2", "17", "18", "20", "28"], Central: ["4", "5", "8", "11", "15"], Southeast: ["1", "30", "14", "19", "27"] },
  West: { Northwest: ["7", "16", "25", "22", "26"], Pacific: ["9", "12", "13", "21", "23"], Southwest: ["6", "10", "29", "3", "24"] },
};
const CONF = {}, DIV = {};
for (const [c, divs] of Object.entries(LEAGUE)) for (const [d, ids] of Object.entries(divs)) for (const id of ids) { CONF[id] = c; DIV[id] = d; }
const TEAMS = Object.keys(CONF);

const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function PhiInv(p) { // bisection is plenty here
  p = Math.min(0.9999, Math.max(0.0001, p));
  let lo = -6, hi = 6;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function loadSchedule() {
  const dir = path.join(DATA, "schedule");
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const evs = readJSON(path.join(dir, f), []);
    for (const e of evs || []) out.push(e);
  }
  const seen = new Set();
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.date.localeCompare(b.date));
}

// opts: { teams (public teams.json), upcoming (upcoming.json), results (results.json), sigma, homeAdv, N, seed }
export function seasonSim(opts) {
  const { teams, upcoming, results } = opts;
  const N = opts.N || 20000;
  const rng = makeRng(opts.seed || 1);
  const sched = loadSchedule();
  const season = Math.max(...sched.filter((e) => e.stype === 2).map((e) => e.season));
  const reg = sched.filter((e) => e.season === season && e.stype === 2 && CONF[String(e.home)] && CONF[String(e.away)]);
  const cupIds = new Set(markCupFinals(reg.map((e) => ({ ...e }))));
  const played = reg.filter((e) => e.completed && !cupIds.has(e.id) && e.hs !== e.as);
  const future = reg.filter((e) => !e.completed);
  const W = Object.fromEntries(TEAMS.map((t) => [t, 0])), L = Object.fromEntries(TEAMS.map((t) => [t, 0]));
  const h2h = new Map(); // "a|b" -> wins of a over b
  const pairPlayed = new Map();
  const pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of played) {
    const h = String(e.home), a = String(e.away), hw = e.hs > e.as;
    W[hw ? h : a]++; L[hw ? a : h]++;
    const k = `${hw ? h : a}|${hw ? a : h}`; h2h.set(k, (h2h.get(k) || 0) + 1);
    pairPlayed.set(pk(h, a), (pairPlayed.get(pk(h, a)) || 0) + 1);
  }
  for (const e of future) pairPlayed.set(pk(String(e.home), String(e.away)), (pairPlayed.get(pk(String(e.home), String(e.away))) || 0) + 1);

  // ratings: opponent-adjusted net rating as the prior, pulled toward the model's own projected margins
  const byId = new Map(teams.map((t) => [String(t.id), t]));
  const prior = Object.fromEntries(TEAMS.map((t) => [t, Number(byId.get(t)?.ratings?.adjNet) || 0]));
  const h = opts.homeAdv;
  const upById = new Map((upcoming || []).map((u) => [String(u.id), u]));
  const obs = (upcoming || []).filter((u) => u.pred && CONF[String(u.home)] && CONF[String(u.away)]).map((u) => ({ h: String(u.home), a: String(u.away), m: u.pred.hs - u.pred.as }));
  const s = { ...prior };
  const lam = 3;
  for (let it = 0; it < 200; it++) {
    for (const t of TEAMS) {
      let num = lam * prior[t], den = lam;
      for (const o of obs) {
        if (o.h === t) { num += o.m - h + s[o.a]; den++; }
        else if (o.a === t) { num += s[o.h] + h - o.m; den++; }
      }
      s[t] = num / den;
    }
  }
  const sigma = opts.sigma;
  // how far a team's true level can sit from today's rating over the rest of a season:
  // block means of the walk-forward margin errors (20-game blocks, 2025-26 regular season) minus pure noise
  let tau = 2.5, tauN = 0;
  {
    const byTeam = new Map();
    for (const r of results || []) {
      if (r.pk !== "2026-2") continue;
      const e = (r.act.hs - r.act.as) - (r.pred.hs - r.pred.as);
      for (const [t, v] of [[r.home, e], [r.away, -e]]) { if (!byTeam.has(t)) byTeam.set(t, []); byTeam.get(t).push(v); }
    }
    const means = []; let all = [];
    for (const arr of byTeam.values()) { for (let i = 0; i + 20 <= arr.length; i += 20) means.push(arr.slice(i, i + 20).reduce((a, b) => a + b, 0) / 20); all = all.concat(arr); }
    if (means.length >= 20) {
      const mm = means.reduce((a, b) => a + b, 0) / means.length;
      const vb = means.reduce((a, b) => a + (b - mm) ** 2, 0) / (means.length - 1);
      const ma = all.reduce((a, b) => a + b, 0) / all.length;
      const va = all.reduce((a, b) => a + (b - ma) ** 2, 0) / (all.length - 1);
      tau = Math.sqrt(Math.max(0.25, vb - va / 20)); tauN = means.length;
    }
  }

  // remaining meetings without dates
  const E = (a, b) => (DIV[a] === DIV[b] ? 4 : CONF[a] === CONF[b] ? 3.6 : 2);
  const gamesSoFar = Object.fromEntries(TEAMS.map((t) => [t, W[t] + L[t]]));
  for (const e of future) { gamesSoFar[String(e.home)]++; gamesSoFar[String(e.away)]++; }
  const R = Object.fromEntries(TEAMS.map((t) => [t, Math.max(0, 82 - gamesSoFar[t])]));
  const pairs = [];
  for (let i = 0; i < TEAMS.length; i++) for (let j = i + 1; j < TEAMS.length; j++) {
    const a = TEAMS[i], b = TEAMS[j];
    pairs.push({ a, b, r: Math.max(0, E(a, b) - (pairPlayed.get(pk(a, b)) || 0)) });
  }
  for (let it = 0; it < 60; it++) {
    const rs = Object.fromEntries(TEAMS.map((t) => [t, 0]));
    for (const p of pairs) { rs[p.a] += p.r; rs[p.b] += p.r; }
    for (const p of pairs) { if (p.r <= 0) continue; const fa = rs[p.a] > 0 ? R[p.a] / rs[p.a] : 0, fb = rs[p.b] > 0 ? R[p.b] / rs[p.b] : 0; p.r *= Math.sqrt(fa * fb); }
  }
  const approxGames = pairs.reduce((a, p) => a + p.r, 0);

  // simulate
  const idx = Object.fromEntries(TEAMS.map((t, i) => [t, i]));
  const T = TEAMS.length;
  const winsAll = TEAMS.map(() => new Int16Array(N));
  const seedCount = TEAMS.map(() => new Int32Array(16));
  const cnt = { top6: new Int32Array(T), playIn: new Int32Array(T), playoffs: new Int32Array(T), r2: new Int32Array(T), cf: new Int32Array(T), finals: new Int32Array(T), title: new Int32Array(T) };
  const futureP = future.map((e) => {
    const u = upById.get(String(e.id));
    const hh = String(e.home), aa = String(e.away);
    const m = u && u.pred && Number.isFinite(u.pred.pHome) ? sigma * PhiInv(u.pred.pHome) : (e.neutral ? 0 : h) + s[hh] - s[aa];
    return { h: idx[hh], a: idx[aa], m, src: u ? "model" : "rating" };
  });
  const delta = new Float64Array(T), wins = new Int16Array(T), h2hSim = new Map();
  const S0 = TEAMS.map((t) => s[t]);
  const game = (hi, ai, neutral) => rng.next() < Phi(((neutral ? 0 : h) + S0[hi] - S0[ai] + delta[hi] - delta[ai]) / sigma);
  const series = (hi, lo) => { // hi has home court; 2-2-1-1-1
    let a = 0, b = 0; const home = [1, 1, 0, 0, 1, 0, 1];
    for (let g = 0; g < 7 && a < 4 && b < 4; g++) { const hiHome = home[g] === 1; const w = hiHome ? game(hi, lo) : !game(lo, hi); if (w) a++; else b++; }
    return a === 4 ? hi : lo;
  };
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < T; i++) { delta[i] = tau * rng.normal(); wins[i] = W[TEAMS[i]]; }
    h2hSim.clear();
    const addH = (w, l) => { const k = w * 64 + l; h2hSim.set(k, (h2hSim.get(k) || 0) + 1); };
    for (const f of futureP) { const hw = rng.next() < Phi((f.m + delta[f.h] - delta[f.a]) / sigma); const w = hw ? f.h : f.a; wins[w]++; addH(w, hw ? f.a : f.h); }
    for (const p of pairs) {
      let k = Math.floor(p.r); if (rng.next() < p.r - k) k++;
      const ia = idx[p.a], ib = idx[p.b];
      for (let g = 0; g < k; g++) { const aHome = (g % 2 === 0) === (rng.next() < 0.5); const aw = aHome ? game(ia, ib) : !game(ib, ia); const w = aw ? ia : ib; wins[w]++; addH(w, aw ? ib : ia); }
    }
    for (let i = 0; i < T; i++) winsAll[i][n] = wins[i];
    const champs = [];
    for (const conf of ["East", "West"]) {
      const ids = TEAMS.filter((t) => CONF[t] === conf).map((t) => idx[t]);
      const tb = new Map(ids.map((i) => [i, rng.next()]));
      const hh = (a, b) => (h2h.get(`${TEAMS[a]}|${TEAMS[b]}`) || 0) + (h2hSim.get(a * 64 + b) || 0);
      ids.sort((a, b) => wins[b] - wins[a] || (hh(b, a) - hh(a, b)) || (tb.get(a) - tb.get(b)));
      ids.forEach((i, k) => { seedCount[i][k + 1]++; if (k < 6) cnt.top6[i]++; else if (k < 10) cnt.playIn[i]++; });
      // play-in: 7 v 8 (winner = 7 seed), 9 v 10 (loser out), loser of 7/8 v winner of 9/10 (winner = 8 seed)
      const [s7, s8, s9, s10] = ids.slice(6, 10);
      const wA = game(s7, s8) ? s7 : s8, lA = wA === s7 ? s8 : s7;
      const wB = game(s9, s10) ? s9 : s10;
      const wC = game(lA, wB) ? lA : wB;
      const seeds = [...ids.slice(0, 6), wA, wC];
      for (const i of seeds) cnt.playoffs[i]++;
      const r1w = [series(seeds[0], seeds[7]), series(seeds[3], seeds[4]), series(seeds[2], seeds[5]), series(seeds[1], seeds[6])];
      for (const i of r1w) cnt.r2[i]++;
      const rank = new Map(seeds.map((i, k) => [i, k]));
      const ser = (a, b) => (rank.get(a) < rank.get(b) ? series(a, b) : series(b, a));
      const r2w = [ser(r1w[0], r1w[1]), ser(r1w[2], r1w[3])];
      for (const i of r2w) cnt.cf[i]++;
      const cw = ser(r2w[0], r2w[1]);
      cnt.finals[cw]++; champs.push(cw);
    }
    const [e, w] = champs;
    const title = wins[e] > wins[w] || (wins[e] === wins[w] && rng.next() < 0.5) ? series(e, w) : series(w, e);
    cnt.title[title]++;
  }

  const rows = TEAMS.map((t) => {
    const i = idx[t];
    const arr = Int16Array.from(winsAll[i]).sort();
    let m = 0; for (const v of arr) m += v; m /= N;
    const tm = byId.get(t) || {};
    return {
      id: t, abbr: tm.abbr || t, conf: CONF[t], div: DIV[t], w: W[t], l: L[t],
      rating: r1(s[t]), ratingPrior: r1(prior[t]),
      wins: { mean: r1(m), p10: arr[Math.floor(0.1 * (N - 1))], median: arr[Math.floor(0.5 * (N - 1))], p90: arr[Math.floor(0.9 * (N - 1))] },
      losses: { mean: r1(82 - m) },
      seed: { avg: r1(seedCount[i].reduce((a, c, k) => a + c * k, 0) / N), dist: Array.from(seedCount[i].slice(1)).map((c) => r3(c / N)) },
      pTop6: r3(cnt.top6[i] / N), pPlayIn: r3(cnt.playIn[i] / N), pPlayoffs: r3(cnt.playoffs[i] / N),
      pSecondRound: r3(cnt.r2[i] / N), pConfFinals: r3(cnt.cf[i] / N), pFinals: r3(cnt.finals[i] / N), pTitle: r3(cnt.title[i] / N),
      pFirstSeed: r3(seedCount[i][1] / N),
    };
  });
  const conferences = {};
  for (const c of ["East", "West"]) conferences[c] = rows.filter((r) => r.conf === c).sort((a, b) => a.seed.avg - b.seed.avg).map((r) => r.id);
  return {
    season: `${season - 1}-${String(season).slice(2)}`,
    sims: N,
    method: {
      ratings: `Team strength in points per game: opponent-adjusted net rating (teams.json) pulled toward the model's own projected margins for the ${obs.length} games it has projected (each projected game counts as much as a third of the prior). Home court ${r1(h)} points.`,
      games: `Each game: win chance from the strength gap and a normal spread of ${r1(sigma)} points (the walk-forward margin error). The model's own win chance is used for the ${futureP.filter((f) => f.src === "model").length} scheduled games it has already projected.`,
      uncertainty: `Each simulated season also draws a lasting strength shift per team, standard deviation ${r1(tau)} points, measured from 20-game blocks of the walk-forward margin errors in 2025-26 (${tauN} blocks): a team can turn out better or worse than today's rating for the rest of the year.`,
      tiebreak: "Ties: head-to-head wins (played and simulated), then a coin flip. The other official tiebreakers (division, conference record) are not modelled.",
      playoffs: "Seeds 1-6 go straight in; 7-10 play the play-in (7 v 8, 9 v 10, then the loser of 7/8 v the winner of 9/10). Best-of-seven series with 2-2-1-1-1 home court for the higher seed; the Finals home court goes to the better record.",
    },
    schedule: {
      played: played.length, scheduledWithDates: future.length, filledWithoutDates: r1(approxGames),
      cupFinalsExcluded: [...cupIds],
      note: "ESPN's schedule feed in data/schedule covers only about a week ahead. The other remaining meetings follow the NBA schedule formula (4 per division rival, 3.6 on average per other conference team, 2 per other-conference team) minus meetings already played or scheduled, balanced so each team reaches 82. They have no dates, so rest and travel are not simulated for them.",
    },
    teams: rows,
    conferences,
  };
}
