// Learned matchup factors.
//
// A factor turns what is known BEFORE a game into one number x for one player
// (for example: his expected rim attempts times how far above or below the league this
// opponent's rim defenders hold shooters). Its effect on a stat is  gate * coefficient * x.
//
//   coefficient  learned online by regressing the LEFTOVER error on x: the error of the
//                unscaled projection with this factor's own contribution removed, so
//                overlapping factors share an error instead of each claiming all of it
//                (backfitting). A ridge term keeps it near zero until there are enough games.
//   gate         0..1, how much of the coefficient is actually used. It opens only when the
//                coefficient, applied to games it had not yet seen, has reduced squared error
//                by a statistically visible amount. 19 factor-stat effects are tested at the same
//                time, so the bar allows for that: the gate opens when t passes 2 and is fully
//                open at 3.5 (with no real effect, the best of 19 t-values is expected near 2).
//                Once open it stays open until t drops below 1.5, so it does not flicker around
//                the threshold.
//                A factor with no out-of-sample value therefore stays at zero in projections
//                while it keeps learning in the background.
//   report()     games seen, coefficient, gate, and the walk-forward error with and without
//                the applied effect.
import { clamp } from "./stats.mjs";
import { Z5, ZVAL } from "./zonestate.mjs";

export const FACTORS = [
  { id: "zone", label: "Zone edge", stats: ["pts"], unit: "points on paper",
    what: "Where he takes his shots x how far above or below league average this opponent holds shooters in each of those zones." },
  { id: "hot", label: "Hot spot vs soft spot", stats: ["pts", "reb"], unit: "overlap score",
    what: "His own above-average zones lining up with the zones this opponent defends worst (and his cold zones with its best)." },
  { id: "rim", label: "Rim-protector edge", stats: ["pts", "reb"], unit: "points on paper",
    what: "His rim attempts x what shooters make inside 6 feet against the opponent's likely rim defenders (NBA.com defender tracking, point-in-time)." },
  { id: "perim", label: "Perimeter-defender edge", stats: ["pts", "tpa"], unit: "points on paper",
    what: "His three-point attempts x what shooters make from three against the opponent's likely defenders at his position (NBA.com defender tracking, point-in-time)." },
  { id: "vol3", label: "Three-point volume allowed", stats: ["tpa"], unit: "three-point attempts on paper",
    what: "His three-point attempts x how many more or fewer threes than league average this opponent allows." },
  { id: "glass", label: "Glass edge", stats: ["reb"], unit: "rebounds on paper",
    what: "His defensive rebounds x the opponent's missed shots and weak offensive rebounding, plus his offensive rebounds x the offensive boards the opponent gives up." },
  { id: "ft", label: "Free-throw edge", stats: ["pts"], unit: "points on paper",
    what: "His free-throw attempts x how much more or less often than league average this opponent sends shooters to the line." },
  { id: "press", label: "Ball-pressure edge", stats: ["ast", "pts"], unit: "turnovers on paper",
    what: "His turnovers x how many more or fewer turnovers than league average this opponent forces." },
  { id: "size", label: "Size edge", stats: ["reb", "pts"], unit: "inches",
    what: "His height minus the average height of the opponent's likely defenders at his position (capped at 6 inches)." },
  { id: "trans", label: "Transition edge", stats: ["pts"], unit: "points on paper",
    what: "His points scored within 6 seconds of a steal or defensive rebound x how many such points this opponent allows versus league average." },
  { id: "ptype", label: "Play-type edge", stats: ["pts"], unit: "points on paper",
    what: "His possessions per game in each Synergy play type x the opponent's points allowed per possession on that play type versus league (previous season's tables in the back-test)." },
  { id: "closer", label: "Closer edge", stats: ["pts"], unit: "points on paper",
    what: "How much closer than usual the game projects x his fourth-quarter share of scoring versus league x his projected points." },
  { id: "age", label: "Age-fatigue", stats: ["min", "pts"], unit: "1 at age 31, +0.25 per year",
    what: "Players aged 31 or older on the second night of a back-to-back or a third game in four nights." },
];
export const FACTOR_BY_ID = Object.fromEntries(FACTORS.map((f) => [f.id, f]));
// Factors whose x depends on the opponent only (used for the "what if he faces team X" table).
export const OPP_FACTORS = ["zone", "hot", "rim", "perim", "vol3", "glass", "ft", "press", "size", "trans", "ptype"];

const PART_CAP = { pts: 2.5, reb: 1.2, ast: 1.0, tpa: 1.2, min: 2.5 };   // one factor, one stat
const TOTAL_CAP = { pts: 4, reb: 2, ast: 1.5, tpa: 2, min: 3 };          // all factors together
const WINSOR = { pts: 15, reb: 7, ast: 6, tpa: 6, min: 14 };             // one freak game cannot move a coefficient far
const W_CAP = { size: 0.3, closer: 6, age: 3 };                          // coefficient caps; 2 for the rest
// Shrinkage: the coefficient is the ridge estimate Sxy / (Sxx + noise^2 / prior^2), i.e. a prior
// centred on "no effect". NOISE is the typical size of one player-game error in that stat; PRIOR is
// how large a coefficient is considered plausible before any evidence (0.5 = half of the paper edge).
const NOISE = { pts: 6.2, reb: 2.6, ast: 1.9, tpa: 2.1, min: 6 };
const PRIOR = { size: 0.05, closer: 1.5, age: 0.6, hot: 0.3 };           // 0.5 for the rest
const LAMBDA = 0.99997, WARMUP = 500, GATE_MIN_N = 1000;
// Gate thresholds on the out-of-sample t-value. GATE_T0 = 2 instead of 1 because FACTORS holds 19
// factor-stat pairs tested together; GATE_HYST = how far below GATE_T0 an open gate may fall before it closes.
const GATE_T0 = 2, GATE_T1 = 3.5, GATE_HYST = 0.5;
export const FACTOR_RULES = { partCap: PART_CAP, totalCap: TOTAL_CAP, winsor: WINSOR, noise: NOISE, priorDefault: 0.5, prior: PRIOR, warmupGames: WARMUP, gateMinGames: GATE_MIN_N,
  gate: `0 until the out-of-sample benefit reaches t = ${GATE_T0} (${FACTORS.reduce((n, f) => n + f.stats.length, 0)} effects are tested at once); fully open at t >= ${GATE_T1}; once open it closes again only below t = ${GATE_T0 - GATE_HYST}`,
  gateT0: GATE_T0, gateT1: GATE_T1, gateClose: GATE_T0 - GATE_HYST };

export function createFactorEngine({ disabled = new Set(), allOff = false } = {}) {
  const st = {};
  const tot = {};
  for (const f of FACTORS) for (const s of f.stats) st[`${f.id}|${s}`] = { n: 0, sxy: 0, sxx: 0, w: 0, gate: 0, t: 0, ax: 0, bn: 0, bs: 0, bss: 0, eW: 0, eWo: 0, e2W: 0, e2Wo: 0, sv: 0, nApplied: 0 };
  for (const s of ["pts", "reb", "ast", "tpa", "min"]) tot[s] = { n: 0, eW: 0, eWo: 0, e2W: 0, e2Wo: 0, phases: {} };

  // xs: { factorId: x }. Returns the adjustments to add to the unscaled projection.
  function apply(xs) {
    const out = { pts: 0, reb: 0, ast: 0, tpa: 0, min: 0, parts: [] };
    if (!xs) return out;
    for (const f of FACTORS) {
      const x = xs[f.id];
      if (!x || !Number.isFinite(x)) continue;
      for (const stat of f.stats) {
        const s = st[`${f.id}|${stat}`];
        const v = allOff || disabled.has(f.id) ? 0 : clamp(s.gate * s.w * x, -PART_CAP[stat], PART_CAP[stat]);
        out.parts.push({ f: f.id, stat, x, v }); out[stat] += v;
      }
    }
    for (const stat of Object.keys(TOTAL_CAP)) {
      if (Math.abs(out[stat]) > TOTAL_CAP[stat]) { const k = TOTAL_CAP[stat] / Math.abs(out[stat]); for (const p of out.parts) if (p.stat === stat) p.v *= k; out[stat] *= k; }
    }
    return out;
  }

  // act: what happened; raw: the unscaled projection (which already includes every part's v).
  function learn(parts, act, raw, phaseKey) {
    if (!parts) return;
    const sumV = { pts: 0, reb: 0, ast: 0, tpa: 0, min: 0 };
    for (const p of parts) sumV[p.stat] += p.v;
    for (const stat of Object.keys(sumV)) {
      if (raw[stat] == null || act[stat] == null) continue;
      const e = act[stat] - raw[stat], t = tot[stat];
      t.n++; t.eW += Math.abs(e); t.eWo += Math.abs(e + sumV[stat]); t.e2W += e * e; t.e2Wo += (e + sumV[stat]) ** 2;
      const ph = (t.phases[phaseKey] ||= { n: 0, eW: 0, eWo: 0 }); ph.n++; ph.eW += Math.abs(e); ph.eWo += Math.abs(e + sumV[stat]);
    }
    for (const p of parts) {
      if (raw[p.stat] == null || act[p.stat] == null) continue;
      const s = st[`${p.f}|${p.stat}`], x = p.x;
      const r0 = act[p.stat] - (raw[p.stat] - p.v);                 // error with this factor taken out
      const r = clamp(r0, -WINSOR[p.stat], WINSOR[p.stat]);
      const shadow = clamp(s.w * x, -PART_CAP[p.stat], PART_CAP[p.stat]); // what the full coefficient would have added
      if (s.n >= WARMUP) { const d = r * r - (r - shadow) ** 2; s.bn++; s.bs += d; s.bss += d * d; }
      s.eWo += Math.abs(r0); s.eW += Math.abs(r0 - p.v); s.e2Wo += r0 * r0; s.e2W += (r0 - p.v) ** 2; s.sv += Math.abs(p.v); if (p.v) s.nApplied++;
      s.n++; s.ax += Math.abs(x);
      s.sxy = LAMBDA * s.sxy + r * x; s.sxx = LAMBDA * s.sxx + x * x;
      const cap = W_CAP[p.f] ?? 2, prior = PRIOR[p.f] ?? 0.5;
      s.w = clamp(s.sxy / (s.sxx + (NOISE[p.stat] / prior) ** 2), -cap, cap);
      if (s.bn >= GATE_MIN_N) {
        const m = s.bs / s.bn, v = Math.max(1e-12, s.bss / s.bn - m * m);
        s.t = m / Math.sqrt(v / s.bn);
        const close = GATE_T0 - GATE_HYST;
        if (!s.open && s.t >= GATE_T0) s.open = true; else if (s.open && s.t < close) s.open = false;
        s.gate = s.open ? clamp((s.t - close) / (GATE_T1 - close), 0, 1) : 0;
      }
    }
  }

  const r3 = (x) => Math.round(x * 1000) / 1000;
  function verdict(s) {
    if (s.n < GATE_MIN_N + WARMUP) return "not enough games yet";
    if (s.gate >= 0.99) return "helps";
    if (s.open && s.gate > 0) return "small"; // t between the closing limit and the fully-open limit
    if (s.t <= -2) return "made projections worse when tried; kept at zero";
    return "no measurable effect yet";
  }
  function report() {
    const rows = [];
    for (const f of FACTORS) for (const stat of f.stats) {
      const s = st[`${f.id}|${stat}`], n = Math.max(1, s.n);
      rows.push({ id: f.id, label: f.label, stat, unit: f.unit, what: f.what, games: s.n, coef: r3(s.w), gate: Math.round(s.gate * 100) / 100, applied: r3(s.gate * s.w),
        avgAbsX: r3(s.ax / n), avgAbsEffect: r3(s.sv / n), errWithout: r3(s.eWo / n), errWith: r3(s.eW / n), reduction: Math.round((s.eWo - s.eW) / n * 10000) / 10000,
        t: Math.round(s.t * 10) / 10, verdict: allOff || disabled.has(f.id) ? "switched off for this run" : verdict(s) });
    }
    const total = {};
    for (const [stat, t] of Object.entries(tot)) if (t.n) total[stat] = { games: t.n, errWithout: r3(t.eWo / t.n), errWith: r3(t.eW / t.n), reduction: Math.round((t.eWo - t.eW) / t.n * 10000) / 10000,
      phases: Object.fromEntries(Object.entries(t.phases).map(([k, p]) => [k, { games: p.n, errWithout: r3(p.eWo / p.n), errWith: r3(p.eW / p.n) }])) };
    return { rows, total };
  }
  const coef = (f, stat) => { const s = st[`${f}|${stat}`]; return s ? s.gate * s.w : 0; };
  const rawCoef = (f, stat) => st[`${f}|${stat}`]?.w || 0;
  return { apply, learn, report, coef, rawCoef, state: st };
}

// ---------------------------------------------------------------- inputs
// Running centres, so "the opponent's rim defenders" is measured against what teams usually
// put on the floor rather than against zero. Updated only from pre-game values.
export function createCentres() {
  const c = {};
  return {
    get: (k, dflt = 0) => (c[k] && c[k].n >= 20 ? c[k].m : dflt),
    push: (k, v) => { if (v == null || !Number.isFinite(v)) return; const o = (c[k] ||= { m: v, n: 0 }); o.n++; o.m += (v - o.m) * Math.max(1 / o.n, 0.004); },
  };
}

// Opponent-level inputs. defenders: [{ n, g, min }] = who is expected to play for the opponent.
export function opponentInputs({ zs, ctx, centres, oid, defenders, date, lg, live = false }) {
  const team = zs.teamNow(oid, lg);
  const act = defenders.filter((d) => d.min >= 8);
  const wavg = (rows, kind) => {
    let sw = 0, sv = 0, n = 0, fga = 0; const who = [];
    for (const d of rows) {
      const info = ctx.defenderAt(d.n, date, kind); if (!info) continue;
      // shots he defends per game already reflect his usual minutes; tonight's minutes adjust it mildly
      const w = Math.max(0.2, info.perGame || 0) * Math.sqrt(d.min / 24);
      sw += w; sv += w * info.diff; n++; fga += info.fga; who.push({ n: d.n, w, diff: info.diff, fga: info.fga, src: info.src });
    }
    return sw ? { diff: sv / sw, n, fga, who: who.sort((a, b) => b.w - a.w).slice(0, 2) } : null;
  };
  // rim protection is frontcourt work: forwards and centres when at least two of them have tracking data
  const bigs = act.filter((d) => d.g !== "G" && ctx.defenderAt(d.n, date, "rim"));
  const rimRaw = wavg(bigs.length >= 2 ? bigs : act, "rim");
  const per = {};
  for (const grp of ["G", "F", "C"]) { const rows = act.filter((d) => d.g === grp); per[grp] = wavg(rows.length ? rows : act, "three"); }
  const height = {};
  for (const grp of ["G", "F", "C"]) {
    let sw = 0, sv = 0;
    for (const d of act.filter((d) => d.g === grp && d.min >= 12)) { const h = ctx.height(d.n); if (h) { sw += d.min; sv += d.min * h; } }
    height[grp] = sw ? sv / sw : null;
  }
  const rim = rimRaw ? { ...rimRaw, centred: rimRaw.diff - centres.get("rim", rimRaw.diff) } : null;
  for (const grp of ["G", "F", "C"]) if (per[grp]) per[grp].centred = per[grp].diff - centres.get(`per${grp}`, per[grp].diff);
  if (rimRaw) centres.push("rim", rimRaw.diff);
  for (const grp of ["G", "F", "C"]) if (per[grp]) centres.push(`per${grp}`, per[grp].diff);
  // Synergy defence by play type (season allowed by the leak rule)
  const season = ctx.playTypeSeason(date, (s) => ctx.synTeamDef(oid, s)?.gp || 0, live);
  const sd = ctx.synTeamDef(oid, season), lgPpp = ctx.leagueSynDef(season);
  const syn = {};
  if (sd) for (const [pt, r] of Object.entries(sd.rows)) { const l = lgPpp[pt]; if (l != null) syn[pt] = (r[4] + 150 * l) / (r[3] + 150) - l; }
  return { oid, team, rim, per, height, syn, synSeason: season, lg, live };
}

// Player-level x for every factor, for a player projected to play `min` minutes.
// Returns { x: {factorId: number}, zones: [{ z, att, diff, pts }] } (zones = the zone edge split by zone).
export function playerInputs({ zs, ctx, centres, name, pid, grp, min, rates, opp, date, closeProb, b2b, in4 }) {
  const lg = opp.lg, zp = zs.playerNow(pid, lg), T = opp.team;
  const x = {}, zones = [];
  const tpaProj = rates.tpa * min;
  if (zp && T && zp.att >= 15) {
    const fga = zp.fgaPerMin * min;
    let ze = 0, hot = 0;
    for (let i = 0; i < 5; i++) {
      const att = zp.share[i] * fga, pv = att * ZVAL[i] * T.defDiff[i];
      ze += pv; zones.push({ z: Z5[i], att, diff: T.defDiff[i], pts: pv, own: zp.pct[i] - lg.pct[i] });
      hot += att * ZVAL[i] * clamp(zp.pct[i] - lg.pct[i], -0.08, 0.08) * clamp(T.defDiff[i], -0.05, 0.05) * 100;
    }
    x.zone = ze; x.hot = hot;
    if (opp.rim) x.rim = zp.share[0] * fga * 2 * opp.rim.centred;
  }
  if (opp.per[grp] && tpaProj > 0.3) x.perim = tpaProj * 3 * opp.per[grp].centred;
  if (T) {
    if (tpaProj > 0.3) x.vol3 = tpaProj * T.tpaAllowedRel;
    if (zp) {
      x.glass = zp.drebPerMin * min * ((1 + T.missRel) * (1 - T.orbPct) / (1 - lg.orbPct) - 1) + zp.orebPerMin * min * (T.orbAllowedPct / lg.orbPct - 1);
      x.ft = zp.ftaPerMin * min * zp.ftPct * T.foulRel;
      x.press = zp.toPerMin * min * T.forceTovRel;
      x.trans = zp.trPtsPerMin * min * T.traAllowedRel;
    }
  }
  const h = ctx.height(name), oh = opp.height[grp];
  if (h && oh) x.size = clamp(h - oh, -6, 6);
  // play types
  const ps = ctx.playTypeSeason(date, (s) => ctx.synPlayer(name, s)?.gp || 0, opp.live);
  if (ps === opp.synSeason) {
    const sp = ctx.synPlayer(name, ps);
    if (sp) { let v = 0; for (const [pt, r] of Object.entries(sp.rows)) if (opp.syn[pt] != null && pt !== "Misc") v += (r[3] / Math.max(1, r[0])) * opp.syn[pt]; x.ptype = v * clamp(min / 30, 0.3, 1.3); }
  }
  if (zp && closeProb != null) {
    const dev = closeProb - centres.get("close", closeProb);
    x.closer = dev * (zp.q4Share / lg.q4Share - 1) * rates.pts * min;
  }
  if (b2b || in4) { const a = ctx.age(name, date); if (a && a >= 31) x.age = 1 + (a - 31) * 0.25; }
  return { x, zones, zp };
}
