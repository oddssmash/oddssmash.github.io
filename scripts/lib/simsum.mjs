// Turns the simulated games of one matchup into the published summary:
// probability-weighted forecast, scenario views, player distributions, the model's
// own fair lines and same-game joint probabilities (counted, never multiplied).
import { S } from "./simhist.mjs";
import { ST, FLAG } from "./simcore.mjs";

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const pct = (x) => Math.round(x * 1000) / 10;
export const DIST_COLS = ["mean", "median", "sd", "p10", "p25", "p75", "p90"];

function quantile(sorted, q) {
  const n = sorted.length; if (!n) return null;
  const pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function distArr(vals) {
  const a = Float64Array.from(vals).sort();
  const n = a.length; if (!n) return null;
  let m = 0; for (const v of a) m += v; m /= n;
  let v2 = 0; for (const v of a) v2 += (v - m) * (v - m);
  return [r1(m), r1(quantile(a, 0.5)), r1(Math.sqrt(v2 / Math.max(1, n - 1))), r1(quantile(a, 0.1)), r1(quantile(a, 0.25)), r1(quantile(a, 0.75)), r1(quantile(a, 0.9))];
}
export const distObj = (vals) => { const d = distArr(vals); return d ? Object.fromEntries(DIST_COLS.map((k, i) => [k, d[i]])) : null; };

function histogram(vals, step, lo, hi) {
  const bins = Math.ceil((hi - lo) / step);
  const c = new Array(bins).fill(0);
  for (const v of vals) { const k = Math.floor((Math.max(lo, Math.min(hi - 1e-9, v)) - lo) / step); c[k]++; }
  return { from: lo, step, share: c.map((x) => pct(x / vals.length)), note: "share of simulations (%) per bin; the first and last bins include everything beyond them" };
}

// x.5 line where P(over) is closest to 50%
function fairLine(vals) {
  const a = Float64Array.from(vals).sort();
  const med = quantile(a, 0.5);
  let best = null;
  for (let L = Math.floor(med) - 2.5; L <= Math.ceil(med) + 2.5; L += 1) {
    if (L < 0) continue;
    let over = 0; for (const v of vals) if (v > L) over++;
    const p = over / vals.length;
    if (!best || Math.abs(p - 0.5) < Math.abs(best.pOver - 0.5)) best = { line: L, pOver: r3(p), pUnder: r3(1 - p) };
  }
  return best;
}
export function american(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}

const PLAYER_DIST = ["min", "pts", "reb", "ast", "tpm", "stl", "blk", "tov"];
const THRESH = { pts: [10, 15, 20, 25, 30, 35, 40], reb: [4, 6, 8, 10, 12, 15], ast: [2, 4, 6, 8, 10, 12], tpm: [1, 2, 3, 4, 5, 6], stl: [1, 2, 3], blk: [1, 2, 3] };
const PROP_STATS = ["pts", "reb", "ast", "tpm", "stl", "blk", "pra"];

export const SCENARIOS = [
  { id: "normal", label: "Ordinary game (decided by 6-14 points, no overtime, no early exit)", test: (f) => (f & (FLAG.close | FLAG.blowH | FLAG.blowA | FLAG.ot | FLAG.injH | FLAG.injA)) === 0 },
  { id: "close", label: "Close game (final margin 5 or less)", test: (f) => f & FLAG.close },
  { id: "blowH", label: "HOME wins by 15+", test: (f) => f & FLAG.blowH },
  { id: "blowA", label: "AWAY wins by 15+", test: (f) => f & FLAG.blowA },
  { id: "ot", label: "Overtime", test: (f) => f & FLAG.ot },
  { id: "injH", label: "HOME key player leaves injured", test: (f) => f & FLAG.injH },
  { id: "injA", label: "AWAY key player leaves injured", test: (f) => f & FLAG.injA },
  { id: "foulH", label: "HOME foul trouble (a top-5 player picks up 5+ fouls)", test: (f) => f & FLAG.foulH },
  { id: "foulA", label: "AWAY foul trouble (a top-5 player picks up 5+ fouls)", test: (f) => f & FLAG.foulA },
  { id: "hotH", label: "HOME shoots hot (5+ eFG points above expectation)", test: (f) => f & FLAG.hotH },
  { id: "coldH", label: "HOME shoots cold (5+ eFG points below expectation)", test: (f) => f & FLAG.coldH },
  { id: "hotA", label: "AWAY shoots hot (5+ eFG points above expectation)", test: (f) => f & FLAG.hotA },
  { id: "coldA", label: "AWAY shoots cold (5+ eFG points below expectation)", test: (f) => f & FLAG.coldA },
  { id: "fast", label: "Fast pace (6%+ more possessions than projected)", test: (f) => f & FLAG.fast },
  { id: "slow", label: "Slow pace (6%+ fewer possessions than projected)", test: (f) => f & FLAG.slow },
  { id: "rotH", label: "HOME rotation change (a starter sits, or a rotation player's minutes move by 15+)", test: (f) => f & FLAG.rotH },
  { id: "rotA", label: "AWAY rotation change (a starter sits, or a rotation player's minutes move by 15+)", test: (f) => f & FLAG.rotA },
];
const FAMILY = { close: "margin", blowH: "margin", blowA: "margin", ot: "margin", injH: "inj", injA: "inj", foulH: "foul", foulA: "foul", hotH: "shootH", coldH: "shootH", hotA: "shootA", coldA: "shootA", fast: "pace", slow: "pace", rotH: "rot", rotA: "rot" };

function histRate(id, params, projMargin) {
  const h = params.hist;
  const b = h.byMargin[Math.abs(projMargin) < 4 ? 0 : Math.abs(projMargin) < 8 ? 1 : Math.abs(projMargin) < 12 ? 2 : 3];
  const homeFav = projMargin >= 0;
  const team = (rate, n, what) => (rate == null ? null : { rate: r3(rate), n, what });
  switch (id) {
    case "close": return team(b.close, b.n, `finished games projected ${b.bucket} points apart`);
    case "ot": return team(b.ot, b.n, `finished games projected ${b.bucket} points apart`);
    case "blowH": return team(homeFav ? b.favBlow : b.dogBlow, b.n, `${homeFav ? "favourites" : "underdogs"} winning by 15+ in games projected ${b.bucket} points apart`);
    case "blowA": return team(homeFav ? b.dogBlow : b.favBlow, b.n, `${homeFav ? "underdogs" : "favourites"} winning by 15+ in games projected ${b.bucket} points apart`);
    case "injH": case "injA": return team(h.keyExit, h.teamGames, "team-games where one of the three highest-minute players left early and missed the next game");
    case "foulH": case "foulA": return team(h.foulTrouble, h.teamGames, "team-games where a top-5 minutes player had 5+ fouls");
    case "hotH": case "hotA": return team(h.hot, h.shootGames, "team-games shooting 5+ eFG points above the players' pre-game percentages");
    case "coldH": case "coldA": return team(h.cold, h.shootGames, "team-games shooting 5+ eFG points below the players' pre-game percentages");
    case "fast": return team(h.fast, h.paceGames, "games 6%+ faster than the projected pace");
    case "slow": return team(h.slow, h.paceGames, "games 6%+ slower than the projected pace");
    case "rotH": case "rotA": return team(h.rotation, h.teamGames, "team-games with a rotation change of this kind (blowouts left out)");
    default: return null;
  }
}

// G: built game, out: simulate() result, ctx: { abbr: [home, away], params, pilotInfo }
export function summarize(G, out, ctx) {
  const N = out.N, P = G.P;
  const [HA, AA] = ctx.abbr;
  const lab = (s) => s.replace("HOME", HA).replace("AWAY", AA);
  const margin = new Float64Array(N), total = new Float64Array(N), hsA = new Float64Array(N), asA = new Float64Array(N);
  let hw = 0, otN = 0;
  for (let s = 0; s < N; s++) { hsA[s] = out.hs[s]; asA[s] = out.as[s]; margin[s] = out.hs[s] - out.as[s]; total[s] = hsA[s] + asA[s]; if (margin[s] > 0) hw++; if (out.ot[s]) otN++; }
  const pHome = hw / N;
  const val = (s, i, k) => out.pl[(s * P + i) * S + k];
  // quarters and halves
  const qm = [[0, 0, 0, 0], [0, 0, 0, 0]];
  for (let s = 0; s < N; s++) for (let q = 0; q < 4; q++) { qm[0][q] += out.hq[s * 4 + q]; qm[1][q] += out.aq[s * 4 + q]; }
  const quarters = { home: qm[0].map((x) => r1(x / N)), away: qm[1].map((x) => r1(x / N)) };
  const h1 = new Float64Array(N), h2 = new Float64Array(N);
  let otPts = [0, 0];
  for (let s = 0; s < N; s++) {
    h1[s] = out.hq[s * 4] + out.hq[s * 4 + 1] - out.aq[s * 4] - out.aq[s * 4 + 1];
    h2[s] = out.hq[s * 4 + 2] + out.hq[s * 4 + 3] - out.aq[s * 4 + 2] - out.aq[s * 4 + 3];
    const rh = out.hq[s * 4] + out.hq[s * 4 + 1] + out.hq[s * 4 + 2] + out.hq[s * 4 + 3];
    const ra = out.aq[s * 4] + out.aq[s * 4 + 1] + out.aq[s * 4 + 2] + out.aq[s * 4 + 3];
    otPts[0] += out.hs[s] - rh; otPts[1] += out.as[s] - ra;
  }
  quarters.halves = { home: [r1((qm[0][0] + qm[0][1]) / N), r1((qm[0][2] + qm[0][3]) / N)], away: [r1((qm[1][0] + qm[1][1]) / N), r1((qm[1][2] + qm[1][3]) / N)] };
  quarters.overtime = { home: r1(otPts[0] / N), away: r1(otPts[1] / N), note: "average overtime points over all simulations (most have none)" };
  quarters.firstHalfMargin = distObj(h1); quarters.secondHalfMargin = distObj(h2);
  let q1w = 0, h1w = 0; for (let s = 0; s < N; s++) { if (out.hq[s * 4] > out.aq[s * 4]) q1w++; if (h1[s] > 0) h1w++; }
  quarters.pHomeWinsQ1 = r3(q1w / N); quarters.pHomeLeadsHalf = r3(h1w / N);

  const forecast = {
    pHome: r3(pHome), pAway: r3(1 - pHome), pOT: r3(otN / N),
    margin: { ...distObj(margin), hist: histogram(margin, 2, -40, 40), note: "home minus away, overtime included" },
    total: { ...distObj(total), hist: histogram(total, 4, Math.floor((total.reduce((a, b) => a + b, 0) / N - 40) / 4) * 4, Math.floor((total.reduce((a, b) => a + b, 0) / N - 40) / 4) * 4 + 80) },
    home: distObj(hsA), away: distObj(asA),
    quarters,
  };
  // fair lines (the simulation's own; never a sportsbook's)
  const sp = (() => {
    // home line = -(x.5 nearest the median margin); home covers when margin > -line
    let best = null;
    const med = forecast.margin.median;
    for (let L = Math.floor(med) - 2.5; L <= Math.ceil(med) + 2.5; L += 1) {
      let c = 0; for (const m of margin) if (m > L) c++;
      const p = c / N;
      if (!best || Math.abs(p - 0.5) < Math.abs(best.p - 0.5)) best = { L, p };
    }
    const hl = -best.L;
    const note = hl > 0 ? `${HA} +${hl}: ${HA} covers if it wins or loses by ${Math.floor(hl)} or fewer; ${AA} -${hl} covers if it wins by ${Math.ceil(hl)}+` : `${HA} ${hl}: ${HA} covers if it wins by ${Math.ceil(-hl)}+; ${AA} +${-hl} covers otherwise`;
    return { homeLine: hl, pHomeCovers: r3(best.p), pAwayCovers: r3(1 - best.p), note };
  })();
  const lines = {
    note: "The simulation's own fair lines (50/50 points and break-even odds), not sportsbook lines.",
    spread: sp,
    winOdds: { home: american(pHome), away: american(1 - pHome), note: "fair American odds from the win chance, no bookmaker margin" },
    total: fairLine(total),
    teamTotals: { home: fairLine(hsA), away: fairLine(asA) },
  };

  // players
  const players = [];
  const pmeans = new Float64Array(P * S);
  for (let i = 0; i < P; i++) {
    const cols = {};
    for (const st of PLAYER_DIST) { const k = ST[st]; const v = new Float64Array(N); for (let s = 0; s < N; s++) v[s] = val(s, i, k); cols[st] = v; }
    const pra = new Float64Array(N); for (let s = 0; s < N; s++) pra[s] = cols.pts[s] + cols.reb[s] + cols.ast[s];
    cols.pra = pra;
    let fgm = 0, fga = 0, ftm = 0, fta = 0, tpa = 0, pf = 0, f5 = 0, f6 = 0, dnp = 0;
    for (let s = 0; s < N; s++) {
      fgm += val(s, i, ST.fgm); fga += val(s, i, ST.fga); ftm += val(s, i, ST.ftm); fta += val(s, i, ST.fta); tpa += val(s, i, ST.tpa);
      const f = val(s, i, ST.pf); pf += f; if (f >= 5) f5++; if (f >= 6) f6++;
      if (val(s, i, ST.min) <= 0) dnp++;
    }
    for (let k = 0; k < S; k++) { let m = 0; for (let s = 0; s < N; s++) m += val(s, i, k); pmeans[i * S + k] = m / N; }
    const dist = {}; for (const st of [...PLAYER_DIST, "pra"]) dist[st] = distArr(cols[st]);
    const thr = {};
    for (const [st, ts] of Object.entries(THRESH)) thr[st] = ts.map((t) => { let c = 0; for (const v of cols[st]) if (v >= t) c++; return [t, r3(c / N)]; });
    const props = {};
    for (const st of PROP_STATS) props[st] = fairLine(cols[st]);
    players.push({
      id: G.ids[i], n: G.names[i], side: G.side[i], pos: G.pos[i], role: G.role[i], q: G.q[i] || undefined,
      proj: { min: r1(G.projMin[i]), pts: r1(G.pts[i]) },
      dist, thr, props,
      shooting: { fgm: r1(fgm / N), fga: r1(fga / N), tpa: r1(tpa / N), ftm: r1(ftm / N), fta: r1(fta / N), fgPct: fga ? r1(100 * fgm / fga) : null },
      fouls: { mean: r1(pf / N), p5: r3(f5 / N), p6: r3(f6 / N) },
      pDnp: r3(dnp / N),
      blowSrc: G.blowSrc[i],
    });
  }

  // scenarios
  const projM = G.proj[0] - G.proj[1];
  const allMean = { margin: forecast.margin.mean, total: forecast.total.mean };
  const scenarios = [];
  for (const sc of SCENARIOS) {
    const idx = []; for (let s = 0; s < N; s++) if (sc.test(out.flags[s])) idx.push(s);
    const freq = idx.length / N;
    const row = { id: sc.id, label: lab(sc.label), freq: r3(freq), sims: idx.length, hist: histRate(sc.id, ctx.params, projM) };
    if (idx.length >= Math.max(30, N * 0.003)) {
      let w = 0, mg = 0, tt = 0, hh = 0, aa = 0;
      for (const s of idx) { if (margin[s] > 0) w++; mg += margin[s]; tt += total[s]; hh += hsA[s]; aa += asA[s]; }
      const n = idx.length;
      Object.assign(row, { pHome: r3(w / n), margin: r1(mg / n), total: r1(tt / n), home: r1(hh / n), away: r1(aa / n) });
      const deltas = [];
      for (let i = 0; i < P; i++) {
        let mp = 0, mm = 0, rb = 0, as = 0;
        for (const s of idx) { mp += val(s, i, ST.pts); mm += val(s, i, ST.min); rb += val(s, i, ST.reb); as += val(s, i, ST.ast); }
        deltas.push({ i, pts: mp / n - pmeans[i * S + ST.pts], min: mm / n - pmeans[i * S + ST.min], reb: rb / n - pmeans[i * S + ST.reb], ast: as / n - pmeans[i * S + ST.ast], ptsC: mp / n });
      }
      const fmt = (d) => ({ id: G.ids[d.i], n: G.names[d.i], side: G.side[d.i], pts: r1(d.pts), min: r1(d.min), reb: r1(d.reb), ast: r1(d.ast), ptsIn: r1(d.ptsC) });
      const sorted = deltas.filter((d) => G.projMin[d.i] >= 8).sort((a, b) => b.pts - a.pts);
      row.gains = sorted.slice(0, 3).filter((d) => d.pts > 0.3).map(fmt);
      row.losses = sorted.slice(-3).reverse().filter((d) => d.pts < -0.3).map(fmt);
      row.players = deltas.filter((d) => G.projMin[d.i] >= 8).map((d) => [G.ids[d.i], r1(d.ptsC), r1(d.min + pmeans[d.i * S + ST.min]), r1(d.reb + pmeans[d.i * S + ST.reb]), r1(d.ast + pmeans[d.i * S + ST.ast])]);
      if (sc.id === "injH" || sc.id === "injA") {
        const side = sc.id === "injH" ? 0 : 1, cnt = new Map();
        for (const s of idx) { const k = out.exitKey[s * 2 + side]; if (k >= 0) cnt.set(k, (cnt.get(k) || 0) + 1); }
        row.who = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => {
          let w2 = 0, m2 = 0; for (const s of idx) if (out.exitKey[s * 2 + side] === k) { if (margin[s] > 0) w2++; m2 += margin[s]; }
          return { id: G.ids[k], n: G.names[k], share: r3(c / n), pHome: r3(w2 / c), margin: r1(m2 / c) };
        });
      }
      row.text = explain(sc.id, row, { HA, AA, freq, allMean, pHome, params: ctx.params, G });
    } else {
      row.text = `Too rare in these simulations to describe (${idx.length} of ${N}).`;
    }
    scenarios.push(row);
  }

  // combinations of two scenarios from different families
  const ids = SCENARIOS.slice(1).map((s) => s.id);
  const freqOf = Object.fromEntries(scenarios.map((s) => [s.id, s.freq]));
  const combos = [];
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    if (FAMILY[ids[a]] === FAMILY[ids[b]]) continue;
    const ta = SCENARIOS.find((s) => s.id === ids[a]).test, tb = SCENARIOS.find((s) => s.id === ids[b]).test;
    const idx = []; for (let s = 0; s < N; s++) if (ta(out.flags[s]) && tb(out.flags[s])) idx.push(s);
    if (idx.length < N * 0.02) continue;
    let w = 0, mg = 0, tt = 0; for (const s of idx) { if (margin[s] > 0) w++; mg += margin[s]; tt += total[s]; }
    const n = idx.length, f = n / N, ind = freqOf[ids[a]] * freqOf[ids[b]];
    combos.push({ ids: [ids[a], ids[b]], label: `${scenarios.find((s) => s.id === ids[a]).label} + ${scenarios.find((s) => s.id === ids[b]).label}`, freq: r3(f), lift: ind > 0 ? r1(f / ind) : null, pHome: r3(w / n), margin: r1(mg / n), total: r1(tt / n) });
  }
  combos.sort((x, y) => y.freq * Math.abs(Math.log(Math.max(0.01, y.lift || 1))) - x.freq * Math.abs(Math.log(Math.max(0.01, x.lift || 1))));
  const combosOut = combos.slice(0, 8).map((c) => ({ ...c, text: `${pct(c.freq)}% of simulations; ${c.lift >= 1 ? `${c.lift} times as often as if the two were unrelated` : `less often than if unrelated (x${c.lift})`}. ${HA} wins ${pct(c.pHome)}%, average margin ${c.margin > 0 ? HA + " +" + c.margin : c.margin < 0 ? AA + " +" + (-c.margin) : "even"}, total ${c.total}.` }));

  // joint probabilities, counted in the same simulated games
  const joint = [];
  const topOf = (side) => players.map((p, i) => ({ p, i })).filter((x) => x.p.side === side && x.p.proj.min >= 15).sort((a, b) => b.p.dist.pts[0] - a.p.dist.pts[0]);
  const overLine = (i, st, L) => { const k = st === "pra" ? -1 : ST[st]; const a = new Uint8Array(N); for (let s = 0; s < N; s++) { const v = k < 0 ? val(s, i, ST.pts) + val(s, i, ST.reb) + val(s, i, ST.ast) : val(s, i, k); a[s] = v > L ? 1 : 0; } return a; };
  const evWin = (side) => { const a = new Uint8Array(N); for (let s = 0; s < N; s++) a[s] = (side === 0 ? margin[s] > 0 : margin[s] < 0) ? 1 : 0; return a; };
  const evTotal = (L, over) => { const a = new Uint8Array(N); for (let s = 0; s < N; s++) a[s] = (over ? total[s] > L : total[s] < L) ? 1 : 0; return a; };
  const addJoint = (label, A, la, B, lb) => {
    let a = 0, b = 0, ab = 0; for (let s = 0; s < N; s++) { a += A[s]; b += B[s]; ab += A[s] & B[s]; }
    joint.push({ label, p: r3(ab / N), a: { label: la, p: r3(a / N) }, b: { label: lb, p: r3(b / N) }, ifUnrelated: r3((a / N) * (b / N)) });
  };
  const fav = pHome >= 0.5 ? 0 : 1, favA = fav ? AA : HA;
  const th = topOf(0), ta = topOf(1), tf = fav ? ta : th;
  const tl = lines.total ? lines.total.line : null;
  if (tf[0]) { const x = tf[0]; const L = x.p.props.pts.line; addJoint(`${favA} wins and ${x.p.n} over ${L} points`, evWin(fav), `${favA} wins`, overLine(x.i, "pts", L), `${x.p.n} over ${L} points`); }
  if (th[0] && ta[0]) { const a = th[0], b = ta[0]; addJoint(`${a.p.n} and ${b.p.n} both over their points lines`, overLine(a.i, "pts", a.p.props.pts.line), `${a.p.n} over ${a.p.props.pts.line}`, overLine(b.i, "pts", b.p.props.pts.line), `${b.p.n} over ${b.p.props.pts.line}`); }
  if (tl != null) addJoint(`${favA} wins and the total goes over ${tl}`, evWin(fav), `${favA} wins`, evTotal(tl, true), `Total over ${tl}`);
  if (tl != null && tf[0]) { const x = tf[0]; addJoint(`Total over ${tl} and ${x.p.n} over ${x.p.props.pts.line} points`, evTotal(tl, true), `Total over ${tl}`, overLine(x.i, "pts", x.p.props.pts.line), `${x.p.n} over ${x.p.props.pts.line} points`); }
  if (tf[0] && tf[1]) { const a = tf[0], b = tf[1]; addJoint(`${a.p.n} and teammate ${b.p.n} both over their points lines`, overLine(a.i, "pts", a.p.props.pts.line), `${a.p.n} over ${a.p.props.pts.line}`, overLine(b.i, "pts", b.p.props.pts.line), `${b.p.n} over ${b.p.props.pts.line}`); }
  const dog = 1 - fav, td = dog ? ta : th;
  if (td[0]) { const x = td[0]; const L = x.p.props.pra.line; addJoint(`${dog ? AA : HA} wins and ${x.p.n} over ${L} points + rebounds + assists`, evWin(dog), `${dog ? AA : HA} wins`, overLine(x.i, "pra", L), `${x.p.n} over ${L} P+R+A`); }

  return { forecast, lines, players, scenarios, combos: combosOut, joint };
}

function explain(id, row, c) {
  const { HA, AA, freq, allMean } = c;
  const P = (x) => `${pct(x)}%`;
  const winTxt = row.pHome >= 0.5 ? `${HA} wins ${P(row.pHome)} of these` : `${AA} wins ${P(1 - row.pHome)} of these`;
  const mTxt = row.margin > 0 ? `${HA} by ${row.margin}` : row.margin < 0 ? `${AA} by ${-row.margin}` : "even";
  const dt = row.total - allMean.total;
  const histTxt = row.hist && row.hist.rate != null ? ` Back-test: ${P(row.hist.rate)} of ${row.hist.n} ${row.hist.what}.` : "";
  const g = (list) => list.map((d) => `${d.n} ${d.pts > 0 ? "+" : ""}${d.pts} pts (${d.min > 0 ? "+" : ""}${d.min} min)`).join(", ");
  const why = {
    normal: "No close finish, blowout, overtime or early exit: rotations run as usual and the result sits near the projection.",
    close: "The finish is tight, so starters play their usual closing minutes and the score is decided late.",
    blowH: `With a 15+ point win, starters sit more of the 4th quarter (learned blowout minutes, applied when a lead of ${c.params.q3thr}+ stands after three quarters) and bench players pick up minutes on both sides.`,
    blowA: `With a 15+ point win, starters sit more of the 4th quarter (learned blowout minutes, applied when a lead of ${c.params.q3thr}+ stands after three quarters) and bench players pick up minutes on both sides.`,
    ot: "Overtime adds 5-minute periods played mostly by the starters who are still available (fouled-out and injured players cannot return), so their totals rise.",
    injH: `A key player leaves partway through; his remaining minutes and shots are shared out (in real exits ${pct(c.params.samePos)}% of the lost minutes went to teammates at his position).`,
    injA: `A key player leaves partway through; his remaining minutes and shots are shared out (in real exits ${pct(c.params.samePos)}% of the lost minutes went to teammates at his position).`,
    foulH: "Fouls pile up on a regular; the back-test shows only a small minutes cut on average for 5 fouls, larger when he fouls out.",
    foulA: "Fouls pile up on a regular; the back-test shows only a small minutes cut on average for 5 fouls, larger when he fouls out.",
    hotH: "The team makes clearly more of its shots than its players' percentages suggest; scorers gain the most.",
    coldH: "The team makes clearly fewer of its shots than its players' percentages suggest; more misses also mean more rebounds for both teams.",
    hotA: "The team makes clearly more of its shots than its players' percentages suggest; scorers gain the most.",
    coldA: "The team makes clearly fewer of its shots than its players' percentages suggest; more misses also mean more rebounds for both teams.",
    fast: "More possessions for both teams: every counting stat rises, the margin barely moves.",
    slow: "Fewer possessions for both teams: every counting stat falls.",
    rotH: "A starter sits or a rotation player's minutes move by 15+ (coach's decision or a hunch), and the minutes go to others.",
    rotA: "A starter sits or a rotation player's minutes move by 15+ (coach's decision or a hunch), and the minutes go to others.",
  }[id] || "";
  const who = row.who && row.who.length ? ` Most often ${row.who.slice(0, 2).map((w) => `${w.n} (${P(w.share)})`).join(", ")}.` : "";
  return `Happens in ${P(freq)} of the simulations.${histTxt} ${winTxt}; average margin ${mTxt}, total ${row.total} (${dt >= 0 ? "+" : ""}${r1(dt)} versus all simulations). ${why}${who}${row.gains && row.gains.length ? ` Gains: ${g(row.gains)}.` : ""}${row.losses && row.losses.length ? ` Drops: ${g(row.losses)}.` : ""}`;
}
