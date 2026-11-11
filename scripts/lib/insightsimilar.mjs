// Historical game similarity finder (display only).
// Every number describing a past game is what was known before its tip-off (the walk-forward
// projection, projected pace, rest, style tags), except "missing players": players on that game's
// stored out list who did not play (the stored list is not point-in-time, so we keep only the
// ones the box score confirms were absent).
import { r1, r2, r3, mean, sd, corr, sign, sampleLabel, manilaDate, stypeOf, phaseKeyFromLabel } from "./insightutil.mjs";

const K_SUMMARY = 10;   // neighbours behind the summary numbers
const K_SHOW = 6;       // rows shown per game
const STAR_PPG = 15;

export const SIM_WEIGHTS = { margin: 2.0, total: 0.6, pace: 0.6, rest: 0.25, b2b: 0.5, missing: 0.8, style: 0.8, phase: 0.6, sameHome: 0.35, sameAway: 0.2 };

function missPpg(list) { return Math.min(45, (list || []).reduce((s, o) => s + (o.ppg || 0), 0)); }
function stars(list) { return (list || []).filter((o) => (o.ppg || 0) >= STAR_PPG); }

export function pastFeatures(g) {
  const [h, a] = g.teams;
  return {
    id: g.id, date: g.date, stype: g.stype, home: g.home, away: g.away,
    margin: g.pred.hs - g.pred.as, total: g.pred.hs + g.pred.as, pace: g.pace || null,
    restH: Math.min(3, h.sched.rest ?? 1), restA: Math.min(3, a.sched.rest ?? 1),
    b2bH: h.sched.b2b ? 1 : 0, b2bA: a.sched.b2b ? 1 : 0,
    missH: missPpg(h.missing), missA: missPpg(a.missing),
    starsH: stars(h.missing), starsA: stars(a.missing),
    tagsH: new Set(h.tags), tagsA: new Set(a.tags),
    pHome: g.pred.pHome,
    res: (g.act.hs - g.act.as) - (g.pred.hs - g.pred.as),
    actMargin: g.act.hs - g.act.as, actTotal: g.act.hs + g.act.as, ot: g.act.ot || 0,
  };
}

export function upcomingFeatures(d) {
  const h = d.teams.find((t) => t.isHome) || d.teams[0];
  const a = d.teams.find((t) => !t.isHome) || d.teams[1];
  const out = (t) => (t.out || []).map((o) => ({ id: o.id, n: o.n, ppg: o.ppg || 0 }));
  return {
    id: d.id, date: d.date, stype: stypeOf(phaseKeyFromLabel(d.phase)) || 2, home: d.home, away: d.away,
    margin: d.pred.hs - d.pred.as, total: d.pred.hs + d.pred.as, pace: d.pred.pace || null,
    restH: Math.min(3, h.sched?.rest ?? 1), restA: Math.min(3, a.sched?.rest ?? 1),
    b2bH: h.sched?.b2b ? 1 : 0, b2bA: a.sched?.b2b ? 1 : 0,
    missH: missPpg(out(h)), missA: missPpg(out(a)), starsH: stars(out(h)), starsA: stars(out(a)),
    tagsH: new Set(h.style?.tags || []), tagsA: new Set(a.style?.tags || []), pHome: d.pred.pHome,
  };
}

const jac = (a, b) => {
  if (!a.size && !b.size) return 1;
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

export function makeScales(cands) {
  const s = (k) => sd(cands.map((c) => c[k]).filter((x) => x != null)) || 1;
  return { margin: s("margin"), total: s("total"), pace: s("pace"), miss: Math.max(4, s("missH")) };
}

export function distance(q, c, sc, w = SIM_WEIGHTS) {
  let d = 0;
  d += w.margin * ((q.margin - c.margin) / sc.margin) ** 2;
  d += w.total * ((q.total - c.total) / sc.total) ** 2;
  if (q.pace != null && c.pace != null) d += w.pace * ((q.pace - c.pace) / sc.pace) ** 2;
  d += w.rest * ((q.restH - c.restH) ** 2 + (q.restA - c.restA) ** 2);
  d += w.b2b * (Math.abs(q.b2bH - c.b2bH) + Math.abs(q.b2bA - c.b2bA));
  d += w.missing * (((q.missH - c.missH) / sc.miss) ** 2 + ((q.missA - c.missA) / sc.miss) ** 2);
  d += w.style * ((1 - jac(q.tagsH, c.tagsH)) + (1 - jac(q.tagsA, c.tagsA)));
  if ((q.stype === 3) !== (c.stype === 3)) d += w.phase;
  if (q.home === c.home) d -= w.sameHome;
  if (q.away === c.away) d -= w.sameAway;
  return d;
}

function nearest(q, cands, sc, k) {
  const scored = [];
  for (const c of cands) scored.push([distance(q, c, sc), c]);
  scored.sort((x, y) => x[0] - y[0]);
  return scored.slice(0, k);
}

function whySimilar(q, c, abbr) {
  const why = [];
  why.push(`projected margin ${c.margin > 0 ? abbr(c.home) : abbr(c.away)} by ${Math.abs(c.margin).toFixed(1)} (tonight ${q.margin > 0 ? abbr(q.home) : abbr(q.away)} by ${Math.abs(q.margin).toFixed(1)})`);
  if (q.pace != null && c.pace != null && Math.abs(q.pace - c.pace) <= 2) why.push(`similar projected pace (${c.pace.toFixed(1)})`);
  if (q.b2bH && c.b2bH) why.push("home side on a back-to-back in both");
  if (q.b2bA && c.b2bA) why.push("road side on a back-to-back in both");
  if (q.missH >= 8 && c.missH >= 8) why.push(`home side missing ${c.missH.toFixed(0)} points a game (tonight ${q.missH.toFixed(0)})`);
  if (q.missA >= 8 && c.missA >= 8) why.push(`road side missing ${c.missA.toFixed(0)} points a game (tonight ${q.missA.toFixed(0)})`);
  const shared = [...q.tagsH].filter((t) => c.tagsH.has(t)).concat([...q.tagsA].filter((t) => c.tagsA.has(t)));
  if (shared.length) why.push(`shared style tags: ${[...new Set(shared)].slice(0, 3).join(", ")}`);
  if (q.home === c.home) why.push("same arena");
  if (q.home === c.home && q.away === c.away) why.push("same matchup");
  return why;
}

function summarise(nbrs, q) {
  const cs = nbrs.map(([, c]) => c);
  const n = cs.length;
  const favWon = cs.filter((c) => sign(c.margin) !== 0 && sign(c.actMargin) === sign(c.margin)).length;
  const favSaid = mean(cs.map((c) => Math.max(c.pHome, 1 - c.pHome)));
  const homeRes = mean(cs.map((c) => c.res));
  // residual from the favourite's side: positive = favourites did better than projected
  const favRes = mean(cs.map((c) => c.res * (sign(c.margin) || 1)));
  const absErr = mean(cs.map((c) => Math.abs(c.res)));
  const close = cs.filter((c) => Math.abs(c.actMargin) <= 5).length;
  const blow = cs.filter((c) => Math.abs(c.actMargin) >= 15).length;
  const ot = cs.filter((c) => c.ot > 0).length;
  const totErr = mean(cs.map((c) => c.actTotal - c.total));
  return {
    n, sample: sampleLabel(n), favWon, favSaid: r3(favSaid), favRes: r1(favRes), homeRes: r1(homeRes), marginMAE: r1(absErr),
    totalVsProj: r1(totErr), close, blowouts: blow, overtime: ot,
    t: `In the ${n} most similar past games the projected favourite won ${favWon} (the projection gave favourites ${(favSaid * 100).toFixed(0)}% on average). `
      + `Favourites finished ${Math.abs(favRes).toFixed(1)} points ${favRes >= 0 ? "better" : "worse"} than projected on average; the typical margin miss was ${absErr.toFixed(1)}. `
      + `${close} ended within 5 points, ${blow} by 15 or more${ot ? `, ${ot} in overtime` : ""}. Combined score ${Math.abs(totErr).toFixed(1)} ${totErr >= 0 ? "above" : "below"} projection on average.`,
  };
}

// Leak-free self-test: for each past game, neighbours come only from games dated strictly before it.
function selfTest(feats, k = K_SUMMARY, warm = 300) {
  const pred = [], act = [], base = [], with1 = [], withHalf = [], fav = [];
  for (let i = warm; i < feats.length; i++) {
    const q = feats[i];
    if (q.stype === 1) continue;
    const prior = [];
    for (let j = 0; j < i && feats[j].date < q.date; j++) if (feats[j].stype !== 1) prior.push(feats[j]);
    if (prior.length < warm) continue;
    const sc = makeScales(prior);
    const nb = nearest(q, prior, sc, k).map(([, c]) => c);
    const rh = mean(nb.map((c) => c.res));
    pred.push(rh); act.push(q.res);
    base.push(Math.abs(q.res)); with1.push(Math.abs(q.res - rh)); withHalf.push(Math.abs(q.res - rh / 2));
    const fw = nb.filter((c) => sign(c.actMargin) === sign(c.margin)).length / nb.length;
    fav.push([fw, sign(q.actMargin) === sign(q.margin) ? 1 : 0, Math.max(q.pHome, 1 - q.pHome)]);
  }
  const n = pred.length;
  const c = corr(pred, act);
  const hiFav = fav.filter((x) => x[0] >= 0.8), loFav = fav.filter((x) => x[0] <= 0.5);
  const rate = (a, i) => (a.length ? r3(mean(a.map((x) => x[i]))) : null);
  const helps = n && mean(with1) < mean(base) - 0.02;
  return {
    games: n, k, warmup: warm, corrResidual: r3(c),
    marginMAE: { projection: r2(mean(base)), plusNeighbourGap: r2(mean(with1)), plusHalfGap: r2(mean(withHalf)) },
    favouritesWhenNeighboursAgree: { games: hiFav.length, won: rate(hiFav, 1), said: rate(hiFav, 2) },
    favouritesWhenNeighboursSplit: { games: loFav.length, won: rate(loFav, 1), said: rate(loFav, 2) },
    verdict: helps
      ? "Adding the similar games' average miss would have lowered the margin error in this test; it is still not used in the projection until it passes the model's own gate."
      : "Adding the similar games' average miss to the projection would not have lowered the margin error, so it stays out of the projection. The similar games are context, not a correction.",
    note: "Each past game (preseason excluded, after the first 300) was matched only against games played before it, with the same rule as the live view.",
  };
}

export function buildSimilar(past, upcoming, abbr) {
  const feats = past.filter((g) => g.stype !== 1).map(pastFeatures);
  const sc = makeScales(feats);
  const byId = new Map(past.map((g) => [g.id, g]));
  const games = {};
  for (const { d } of upcoming) {
    const q = upcomingFeatures(d);
    const nb = nearest(q, feats, sc, K_SUMMARY);
    const rows = nb.slice(0, K_SHOW).map(([dist, c]) => {
      const g = byId.get(c.id);
      const called = sign(c.actMargin) === sign(c.margin);
      return {
        id: c.id, date: c.date, day: manilaDate(c.date), phase: g.phase, home: c.home, away: c.away,
        sim: Math.round(100 * Math.exp(-Math.max(0, dist) / 4)),
        proj: { hs: r1(g.pred.hs), as: r1(g.pred.as), pHome: r3(g.pred.pHome) },
        act: { hs: g.act.hs, as: g.act.as, ot: g.act.ot || 0 },
        called, marginErr: r1(Math.abs(c.res)),
        missing: [c.starsH.map((o) => o.n), c.starsA.map((o) => o.n)],
        why: whySimilar(q, c, abbr),
      };
    });
    games[d.id] = {
      tonight: { margin: r1(q.margin), total: r1(q.total), pace: r1(q.pace), rest: [q.restH, q.restA], b2b: [q.b2bH, q.b2bA], missingPpg: [r1(q.missH), r1(q.missA)], missingStars: [q.starsH.map((o) => o.n), q.starsA.map((o) => o.n)] },
      summary: summarise(nb, q),
      games: rows,
    };
  }
  return {
    note: "Past games (regular season, play-in and playoffs since October 2025) closest to tonight on: projected margin and total, projected pace, rest and back-to-backs, points a game of missing players, team style tags, arena. Past games are described by what was known before their tip-off; missing players are those on the stored out list whose box score confirms they did not play. Similar games are a hint, not evidence of what will happen.",
    weights: SIM_WEIGHTS, k: K_SUMMARY, shown: K_SHOW, candidates: feats.length,
    selfTest: selfTest(feats),
    games,
  };
}
