// In-loop learned features (walk-forward) and the small tables behind them.
//
// createGatedLearner: each feature supplies a pre-game number x per player (or team), already in
// the units of the stat it moves (minutes or points), built only from games before the one being
// projected. The applied effect is gate x coefficient x x. The coefficient is a ridge estimate
// learned on the leftover error of the UNSCALED projection with this feature's own effect taken
// out (backfitting, so overlapping features do not each claim the full error). The gate stays at
// zero until the out-of-sample benefit of the full coefficient (measured on each game before the
// coefficient is updated with it) reaches t = T0, and is fully open from T1. A feature whose gate
// never opens is still computed and reported as evidence, but moves nothing.
import { clamp, round, mean } from "./stats.mjs";

export const IX_RULE = { warmup: 400, minN: 800, t0: 2, t1: 3.5, hyst: 0.5, lambda: 0.99997, prior: 1,
  noise: { pts: 6.2, min: 6, tpts: 11 }, partCap: { pts: 3, min: 4, tpts: 4 }, winsor: { pts: 18, min: 18, tpts: 30 } };

// hold: features that are learned and tested like the others but never applied, because an
// end-to-end walk-forward run (published numbers, not just this learner's own error) was worse with them.
export function createGatedLearner(specs, { off = new Set(), allOff = false, hold = new Map() } = {}) {
  const R = IX_RULE;
  const st = {};
  const tot = {};
  for (const f of specs) for (const s of f.stats) st[`${f.id}|${s}`] = { n: 0, sxy: 0, sxx: 0, w: 0, gate: 0, t: 0, open: false, bn: 0, bs: 0, bss: 0, eW: 0, eWo: 0, sv: 0, ax: 0, nx: 0, phases: {} };
  const statsOf = [...new Set(specs.flatMap((f) => f.stats))];
  for (const s of statsOf) tot[s] = { n: 0, eW: 0, eWo: 0, phases: {} };

  function apply(xs) {
    const out = { parts: [] };
    for (const s of statsOf) out[s] = 0;
    if (!xs) return out;
    for (const f of specs) {
      const x = xs[f.id];
      if (!x || !Number.isFinite(x)) continue;
      for (const stat of f.stats) {
        const s = st[`${f.id}|${stat}`];
        const v = allOff || off.has(f.id) || hold.has(f.id) ? 0 : clamp(s.gate * s.w * x, -R.partCap[stat], R.partCap[stat]);
        out.parts.push({ f: f.id, stat, x, v }); out[stat] += v;
      }
    }
    return out;
  }
  // act / raw: { stat: value }. raw already includes every part's v.
  function learn(parts, act, raw, phaseKey) {
    if (!parts || !parts.length) return;
    const sumV = {};
    for (const p of parts) sumV[p.stat] = (sumV[p.stat] || 0) + p.v;
    for (const stat of Object.keys(sumV)) {
      if (raw[stat] == null || act[stat] == null) continue;
      const e = act[stat] - raw[stat], t = tot[stat];
      t.n++; t.eW += Math.abs(e); t.eWo += Math.abs(e + sumV[stat]);
      const ph = (t.phases[phaseKey] ||= { n: 0, eW: 0, eWo: 0 }); ph.n++; ph.eW += Math.abs(e); ph.eWo += Math.abs(e + sumV[stat]);
    }
    for (const p of parts) {
      if (raw[p.stat] == null || act[p.stat] == null) continue;
      const s = st[`${p.f}|${p.stat}`], x = p.x;
      const r0 = act[p.stat] - (raw[p.stat] - p.v);
      const r = clamp(r0, -R.winsor[p.stat], R.winsor[p.stat]);
      const shadow = clamp(s.w * x, -R.partCap[p.stat], R.partCap[p.stat]);
      if (s.n >= R.warmup) { const d = r * r - (r - shadow) ** 2; s.bn++; s.bs += d; s.bss += d * d; }
      s.eWo += Math.abs(r0); s.eW += Math.abs(r0 - p.v); s.sv += Math.abs(p.v);
      const ph = (s.phases[phaseKey] ||= { n: 0, eW: 0, eWo: 0, eFull: 0 }); ph.n++; ph.eWo += Math.abs(r0); ph.eW += Math.abs(r0 - p.v); ph.eFull += Math.abs(r0 - shadow);
      s.n++; s.ax += Math.abs(x); s.nx += x !== 0 ? 1 : 0;
      s.sxy = R.lambda * s.sxy + r * x; s.sxx = R.lambda * s.sxx + x * x;
      s.w = clamp(s.sxy / (s.sxx + (R.noise[p.stat] / R.prior) ** 2), -2, 2);
      if (s.bn >= R.minN) {
        const m = s.bs / s.bn, v = Math.max(1e-12, s.bss / s.bn - m * m);
        s.t = m / Math.sqrt(v / s.bn);
        const close = R.t0 - R.hyst;
        if (!s.open && s.t >= R.t0) s.open = true; else if (s.open && s.t < close) s.open = false;
        s.gate = s.open ? clamp((s.t - close) / (R.t1 - close), 0, 1) : 0;
      }
    }
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  function verdict(s, f) {
    if (allOff || off.has(f.id)) return "switched off for this run";
    if (hold.has(f.id)) return `evidence only: ${hold.get(f.id)}`;
    if (s.n < R.minN + R.warmup) return "not enough games yet: evidence only";
    if (s.gate >= 0.99) return "applied: reduces out-of-sample error";
    if (s.open && s.gate > 0) return "applied in part: small out-of-sample gain";
    if (s.t <= -2) return "evidence only: made projections worse when tried";
    return "evidence only: no measurable out-of-sample gain";
  }
  function report() {
    const rows = [];
    for (const f of specs) for (const stat of f.stats) {
      const s = st[`${f.id}|${stat}`], n = Math.max(1, s.n);
      rows.push({ id: f.id, label: f.label, stat, what: f.what, games: s.n, withValue: s.nx, coef: r3(s.w), gate: Math.round(s.gate * 100) / 100, applied: r3(s.gate * s.w),
        avgAbsX: r3(s.ax / n), avgAbsEffect: r3(s.sv / n), errWithout: r3(s.eWo / n), errWith: r3(s.eW / n), reduction: Math.round((s.eWo - s.eW) / n * 10000) / 10000,
        oosGainIfFull: s.bn ? Math.round(s.bs / s.bn * 10000) / 10000 : null, t: Math.round(s.t * 10) / 10, verdict: verdict(s, f),
        phases: Object.fromEntries(Object.entries(s.phases).map(([k, p]) => [k, { games: p.n, errWithout: r3(p.eWo / p.n), errWith: r3(p.eW / p.n), errIfFull: r3(p.eFull / p.n) }])) });
    }
    const total = {};
    for (const [stat, t] of Object.entries(tot)) if (t.n) total[stat] = { games: t.n, errWithout: r3(t.eWo / t.n), errWith: r3(t.eW / t.n), reduction: Math.round((t.eWo - t.eW) / t.n * 10000) / 10000 };
    return { rows, total };
  }
  const coef = (f, stat) => { const s = st[`${f}|${stat}`]; return s ? s.gate * s.w : 0; };
  return { apply, learn, report, coef };
}

// ---------------------------------------------------------------- return from injury
// Games missed in a row before the return, in buckets; k = which game back (1 = first).
export const RET_BUCKETS = [{ id: "3-5", lo: 3, hi: 5, label: "missed 3-5 games" }, { id: "6-14", lo: 6, hi: 14, label: "missed 6-14 games" }, { id: "15+", lo: 15, hi: 999, label: "missed 15+ games" }];
export const RET_GAMES = 5;
export const retBucket = (missed) => RET_BUCKETS.find((b) => missed >= b.lo && missed <= b.hi)?.id || null;
export function createReturnCurves() {
  const T = {}; // `${bucket}|${k}` -> residual sums (actual minus projection without this effect) and actual / pre-absence sums
  const cell = (b, k) => (T[`${b}|${k}`] ||= { n: 0, min: 0, pts: 0, nr: 0, aMin: 0, pMin: 0, aPts: 0, pPts: 0 });
  // shrunk mean residual for a bucket and game number
  function est(b, k, K = 25) { const c = T[`${b}|${k}`]; if (!c || !c.n) return { min: 0, pts: 0, n: 0 }; return { min: c.min / (c.n + K), pts: c.pts / (c.n + K), n: c.n }; }
  // pre = { min, pts } his averages in the 10 games before the absence; act = { min, pts } tonight
  function add(b, k, resMin, resPts, act, pre) { const c = cell(b, k); c.n++; c.min += resMin; c.pts += resPts; if (pre && pre.min) { c.nr++; c.aMin += act.min; c.pMin += pre.min; c.aPts += act.pts; c.pPts += pre.pts || 0; } }
  function report() {
    return RET_BUCKETS.map((b) => ({ bucket: b.id, label: b.label, games: Array.from({ length: RET_GAMES }, (_, i) => {
      const c = T[`${b.id}|${i + 1}`] || { n: 0, min: 0, pts: 0, nr: 0, aMin: 0, pMin: 0, aPts: 0, pPts: 0 };
      return { k: i + 1, n: c.n, minVsProj: c.n ? round(c.min / c.n, 2) : null, ptsVsProj: c.n ? round(c.pts / c.n, 2) : null,
        minPctOfBefore: c.pMin ? round(c.aMin / c.pMin * 100) : null, ptsPctOfBefore: c.pPts ? round(c.aPts / c.pPts * 100) : null, small: c.n < 30 };
    }) }));
  }
  return { est, add, report };
}

// ---------------------------------------------------------------- quarter shares
// Per team: points scored and allowed in each regulation quarter, from the play-by-play period
// scores of games before the one being projected. Shares are recency weighted and shrunk to the
// league's shares, so the four quarters always add up to the game total they are applied to.
export function createQuarterState() {
  const T = new Map(); const L = { f: [0, 0, 0, 0], n: 0 };
  const LG_DEFAULT = [0.25, 0.25, 0.25, 0.25];
  function record(tid, season, own, opp) {
    if (!own || own.length < 4 || !opp || opp.length < 4) return;
    let t = T.get(tid); if (!t) { t = []; T.set(tid, t); }
    t.push({ season, f: own.slice(0, 4), a: opp.slice(0, 4) });
    if (t.length > 120) t.shift();
    for (let i = 0; i < 4; i++) L.f[i] += own[i];
    L.n++;
  }
  function league() { const s = L.f.reduce((a, b) => a + b, 0); return s ? L.f.map((x) => x / s) : LG_DEFAULT; }
  // weighted shares for offence (f) and allowed (a)
  function shares(tid, season, K = 12) {
    const lg = league(), t = T.get(tid) || [];
    const f = [0, 0, 0, 0], a = [0, 0, 0, 0]; let w = 0, n = 0;
    for (let i = t.length - 1, j = 0; i >= 0; i--, j++) {
      const r = t[i], wt = 0.5 ** (j / 30) * (r.season === season ? 1 : 0.5);
      const sf = r.f.reduce((x, y) => x + y, 0) || 1, sa = r.a.reduce((x, y) => x + y, 0) || 1;
      for (let q = 0; q < 4; q++) { f[q] += wt * r.f[q] / sf; a[q] += wt * r.a[q] / sa; }
      w += wt; if (r.season === season) n++;
    }
    return { f: f.map((x, q) => (x + lg[q] * K) / (w + K)), a: a.map((x, q) => (x + lg[q] * K) / (w + K)), games: t.length, seasonGames: n };
  }
  // projected quarter points for a team that scores `pts` against an opponent
  function project(tid, oid, season, pts) {
    const s = shares(tid, season), o = shares(oid, season);
    const raw = [0, 1, 2, 3].map((q) => (s.f[q] + o.a[q]) / 2), sum = raw.reduce((x, y) => x + y, 0);
    return { q: raw.map((x) => pts * x / sum), n: s.games, oppN: o.games };
  }
  // identity: average margin per quarter and share of own points, recent games of this season (else all)
  function identity(tid, season) {
    const t = (T.get(tid) || []); const cur = t.filter((r) => r.season === season); const rows = cur.length >= 5 ? cur : t;
    if (!rows.length) return null;
    const m = [0, 1, 2, 3].map((q) => mean(rows.map((r) => r.f[q] - r.a[q])));
    const f = [0, 1, 2, 3].map((q) => mean(rows.map((r) => r.f[q])));
    return { games: rows.length, scope: rows === cur ? "this season" : "this season and last", margin: m.map((x) => round(x, 1)), scored: f.map((x) => round(x, 1)) };
  }
  return { record, shares, project, identity, league };
}

// ---------------------------------------------------------------- trust meter
// How well the model has read a player or team: recent mean absolute error against the typical
// error for comparable cases, and the recent bias (actual minus projection).
export const TRUST_RULE = { recent: 15, minGames: 8, good: 0.85, poor: 1.2, biasFlag: 2.5 };
// errs: [{ e: actual minus published projection, typ: typical absolute error for comparable cases at the time }]
export function trustOf(errsIn, unit = "pts") {
  const R = TRUST_RULE;
  const errs = errsIn.map((x) => x.e), recent = errsIn.slice(-R.recent);
  const typs = recent.map((x) => x.typ).filter((x) => x != null), typical = typs.length ? mean(typs) : null;
  if (recent.length < R.minGames || !typical) return recent.length ? { games: recent.length, label: "too few games", small: true } : null;
  const re = recent.map((x) => x.e);
  const mae = mean(re.map((e) => Math.abs(e))), bias = mean(re), ratio = mae / typical;
  const label = ratio <= R.good ? "reads well" : ratio >= R.poor ? "keeps missing" : "typical";
  const lean = bias >= R.biasFlag * (unit === "pts" ? 1 : 2) ? "projections have been too low" : bias <= -R.biasFlag * (unit === "pts" ? 1 : 2) ? "projections have been too high" : "no clear lean";
  return { games: recent.length, mae: round(mae, 2), typical: round(typical, 2), ratio: round(ratio, 2), bias: round(bias, 2), label, lean, allGames: errs.length, allMae: round(mean(errs.map((e) => Math.abs(e))), 2) };
}
