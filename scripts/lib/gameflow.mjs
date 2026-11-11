// What happened in one game, counted straight from its play-by-play file (data/pbp/<id>.json).
// Pure helpers. Every number is a count from that game's plays, so anything built on it
// ("won the third quarter in 3 of their 4 meetings") can be traced back to the games.
// Works on finished games only, so it is safe for the back-test as long as the caller
// only passes games played before the one being projected.
import { POSS, FL, ZONE_IDS, decodeShots, decodeFreeThrows, decodeTech, decodePlayerCounts, scoreFlow, elapsedSeconds } from "./zones.mjs";

export const EARLY_OFFENCE_SECS = 6; // a shot this soon after a steal or defensive rebound counts as transition
export const CLUTCH = { lastSecs: 300, within: 5 }; // last 5 minutes of the 4th or overtime, score within 5

const blankSide = () => ({
  q: [], firstHalf: 0, secondHalf: 0, overtime: 0, final: 0,
  largestLead: 0, largestDeficit: 0, secondsLed: 0, bestRun: 0,
  clutchPts: 0,
  fg: [0, 0], three: [0, 0], ft: [0, 0], assistedFgm: 0, blockedAtt: 0,
  zones: Object.fromEntries(ZONE_IDS.map((z) => [z, { made: 0, att: 0, pts: 0 }])),
  styles: {},
  transitionPts: 0, secondChancePts: 0, ptsAfterTurnover: 0, halfCourtPts: 0,
  turnovers: 0, liveTurnovers: 0, teamTurnovers: 0, shootingFouls: 0, offensiveFouls: 0,
  technicals: 0, flagrants: 0, ejections: 0,
});

// Returns { id, date, home, away, winner (0 home / 1 away / -1 tie or unknown), periods,
//           leadChanges, ties, incomplete, sides: [homeStats, awayStats] }.
// Field points (transitionPts, secondChancePts, ptsAfterTurnover, halfCourtPts) count made
// field goals only: free throws are in ft and in the period scores, not in those four.
export function summarizeGame(g) {
  if (!g || g.np) return null;
  const sides = [blankSide(), blankSide()];
  for (const i of [0, 1]) {
    const q = g.q?.[i] || [];
    const s = sides[i];
    s.q = q.slice();
    s.firstHalf = (q[0] || 0) + (q[1] || 0); s.secondHalf = (q[2] || 0) + (q[3] || 0);
    s.overtime = q.slice(4).reduce((x, y) => x + y, 0);
    s.final = q.reduce((x, y) => x + y, 0);
  }

  // ---- score flow: leads, runs, clutch ----
  const flow = scoreFlow(g);
  const periods = Math.max(g.q?.[0]?.length || 0, g.q?.[1]?.length || 0, 4);
  const endT = elapsedSeconds(periods, 0);
  let leadChanges = 0, ties = 0, lastLeader = -1, prev = { t: 0, home: 0, away: 0, margin: 0 };
  let run = [0, 0];
  for (const f of flow) {
    // time with the previous score on the board
    if (prev.margin > 0) sides[0].secondsLed += f.t - prev.t; else if (prev.margin < 0) sides[1].secondsLed += f.t - prev.t;
    const scorer = f.home > prev.home ? 0 : 1, pts = (f.home - prev.home) + (f.away - prev.away);
    run[scorer] += pts; run[1 - scorer] = 0;
    sides[scorer].bestRun = Math.max(sides[scorer].bestRun, run[scorer]);
    if (f.per >= 4 && f.sec <= CLUTCH.lastSecs && Math.abs(prev.margin) <= CLUTCH.within) sides[scorer].clutchPts += pts;
    sides[0].largestLead = Math.max(sides[0].largestLead, f.margin); sides[1].largestLead = Math.max(sides[1].largestLead, -f.margin);
    const leader = f.margin > 0 ? 0 : f.margin < 0 ? 1 : -1;
    if (leader < 0) ties++;
    else { if (lastLeader >= 0 && leader !== lastLeader) leadChanges++; lastLeader = leader; }
    prev = f;
  }
  if (prev.margin > 0) sides[0].secondsLed += Math.max(0, endT - prev.t); else if (prev.margin < 0) sides[1].secondsLed += Math.max(0, endT - prev.t);
  sides[0].largestDeficit = sides[1].largestLead; sides[1].largestDeficit = sides[0].largestLead;

  // ---- shots ----
  for (const s of decodeShots(g)) {
    const o = sides[s.side];
    const z = o.zones[s.zone]; z.att++; z.made += s.made; z.pts += s.made * s.pts;
    const st = o.styles[s.style] || (o.styles[s.style] = { made: 0, att: 0, pts: 0 }); st.att++; st.made += s.made; st.pts += s.made * s.pts;
    if (s.blk) o.blockedAtt++;
    if (!(s.fl & FL.HEAVE)) { o.fg[1]++; if (s.pts === 3) o.three[1]++; } // a missed end-of-period heave is not a box-score attempt
    if (!s.made) continue;
    o.fg[0]++; if (s.pts === 3) o.three[0]++;
    if (s.ast) o.assistedFgm++;
    const early = !s.whistle && (s.poss === POSS.STEAL || s.poss === POSS.DEF_REBOUND) && s.possSecs <= EARLY_OFFENCE_SECS;
    if (early) o.transitionPts += s.pts; else if (s.poss !== POSS.OFF_REBOUND) o.halfCourtPts += s.pts;
    if (s.poss === POSS.OFF_REBOUND) o.secondChancePts += s.pts;
    if (s.poss === POSS.STEAL || s.poss === POSS.DEAD_TURNOVER) o.ptsAfterTurnover += s.pts;
  }
  for (const t of decodeFreeThrows(g)) { sides[t.side].ft[1]++; sides[t.side].ft[0] += t.made; }
  for (const r of decodePlayerCounts(g)) {
    const o = sides[r.side];
    o.turnovers += r.tovBadPass + r.tovLostBall + r.tovViolation + r.tovOffFoul; o.liveTurnovers += r.tovStolen;
    o.shootingFouls += r.shootingFouls; o.offensiveFouls += r.offensiveFouls;
  }
  for (const i of [0, 1]) { sides[i].teamTurnovers = g.tto?.[i] || 0; sides[i].turnovers += sides[i].teamTurnovers; }
  for (const t of decodeTech(g)) {
    const o = sides[t.side];
    if (t.kind === 1 || t.kind === 2 || t.kind === 3 || t.kind === 9) o.technicals++;
    else if (t.kind === 6 || t.kind === 7) o.flagrants++;
    else if (t.kind === 8) o.ejections++;
  }
  const d = sides[0].final - sides[1].final;
  return {
    id: g.id, date: g.date, home: g.h, away: g.a, winner: d > 0 ? 0 : d < 0 ? 1 : -1, periods,
    leadChanges, ties, incomplete: !!g.gap, gameSeconds: endT, sides,
  };
}

// Margin for one side at the end of each period (cumulative), e.g. [-3, 4, 9, 12].
export function marginByPeriod(g, side = 0) {
  const a = g.q?.[side] || [], b = g.q?.[1 - side] || [];
  let m = 0;
  return a.map((v, i) => (m += v - (b[i] || 0)));
}
