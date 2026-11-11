// Turns one ESPN game summary into the compact play-by-play file data/pbp/<id>.json.
// The file layout is documented at the top of scripts/lib/zones.mjs.
// Only plays, the period line score and box-score player ids are read here:
// odds, pickcenter, win probability and every other betting field are never touched.
import { FL, POSS, GEOM, styleFlags, coordDist, periodSeconds } from "./zones.mjs";

export const PBP_VERSION = 1;

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const idNum = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

// "11:39" -> 699, "45.2" -> 45.2 (ESPN switches to tenths inside the final minute).
export function clockSeconds(display) {
  const s = String(display ?? "");
  if (s.includes(":")) { const [m, x] = s.split(":"); return int(m) * 60 + int(x); }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

const TURNOVER = /turnover|^traveling$/i;
const WHISTLE = /timeout|challenge|review|delay of game|kicked ball|jump ?ball|violation|goaltending|lane|ejection/i;

function techKind(type) {
  if (/^double technical/i.test(type)) return 2;
  if (/flopping/i.test(type)) return 3;
  if (/defensive 3-?seconds/i.test(type)) return 4;
  if (/delay/i.test(type)) return 5;
  if (/flagrant foul type 1/i.test(type)) return 6;
  if (/flagrant foul type 2/i.test(type)) return 7;
  if (/^ejection/i.test(type)) return 8;
  if (/^technical foul/i.test(type)) return 1;
  return 10;
}

// Keep only what the compact file is built from (used for the optional developer cache).
export function trimSummary(s) {
  return {
    plays: (s.plays || []).map((p) => ({
      type: { text: p.type?.text }, text: p.text, period: { number: p.period?.number }, clock: { displayValue: p.clock?.displayValue },
      team: p.team?.id != null ? { id: p.team.id } : undefined, participants: (p.participants || []).map((x) => ({ athlete: { id: x.athlete?.id } })),
      scoringPlay: p.scoringPlay, scoreValue: p.scoreValue, shootingPlay: p.shootingPlay, pointsAttempted: p.pointsAttempted,
      coordinate: p.coordinate, homeScore: p.homeScore, awayScore: p.awayScore,
    })),
    header: { competitions: [{ competitors: (s.header?.competitions?.[0]?.competitors || []).map((c) => ({ homeAway: c.homeAway, team: { id: c.team?.id }, linescores: (c.linescores || []).map((l) => ({ displayValue: l.displayValue })) })) }] },
    boxscore: { players: (s.boxscore?.players || []).map((side) => ({ team: { id: side.team?.id }, statistics: [{ athletes: (side.statistics?.[0]?.athletes || []).map((a) => ({ athlete: { id: a.athlete?.id } })) }] })) },
  };
}

// s: ESPN summary (or a trimSummary() copy). ev: the schedule entry { id, date, season, stype, home, away }.
export function compactPbp(s, ev) {
  const comps = s.header?.competitions?.[0]?.competitors || [];
  const hc = comps.find((c) => c.homeAway === "home"), ac = comps.find((c) => c.homeAway === "away");
  const h = String(ev.home ?? hc?.team?.id ?? ""), a = String(ev.away ?? ac?.team?.id ?? "");
  const q = [hc, ac].map((c) => (c?.linescores || []).map((l) => int(l.displayValue)));
  const out = { v: PBP_VERSION, id: String(ev.id), date: ev.date, season: ev.season, stype: ev.stype, h, a, q, shots: [], ft: [], sc: [], tech: [], pf: [], tto: [0, 0], subs: [] };
  const plays = s.plays || [];
  if (!plays.length) { out.np = 1; return out; }

  // which side each box-score player is on (also tells players from coaches)
  const boxSide = new Map();
  for (const side of s.boxscore?.players || []) {
    const sd = String(side.team?.id) === h ? 0 : 1;
    for (const at of side.statistics?.[0]?.athletes || []) if (at.athlete?.id) boxSide.set(String(at.athlete.id), sd);
  }
  const sideOfTeam = (tid) => (tid == null ? -1 : String(tid) === h ? 0 : String(tid) === a ? 1 : -1);

  const counts = new Map(); // pid -> pf row
  const cnt = (pid, side) => {
    if (!counts.has(pid)) counts.set(pid, [idNum(pid), side, 0, 0, 0, 0, 0, 0, 0, 0]);
    return counts.get(pid);
  };

  // possession tracker for the "how did they get the ball" columns
  let poss = { side: -1, src: POSS.UNKNOWN, sec: 0, whistle: false }, curPer = 0;
  let lastFt = null; // { n, of, kind } of the previous play when it was a free throw
  const give = (side, src, sec, whistle = false) => { poss = { side, src, sec, whistle }; };
  // every shot and free throw, so the running score can be rebuilt in game-time order afterwards
  const scoring = []; // { per, sec, i, side, pts, row }

  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    const type = String(p.type?.text || "").replace(/\s+/g, " ").trim();
    const text = String(p.text || "");
    const per = int(p.period?.number);
    const sec = clockSeconds(p.clock?.displayValue);
    const parts = (p.participants || []).map((x) => (x?.athlete?.id != null ? String(x.athlete.id) : null));
    const p0 = parts[0] || null;
    let side = sideOfTeam(p.team?.id);
    if (side < 0 && p0 && boxSide.has(p0)) side = boxSide.get(p0);
    if (per !== curPer) { curPer = per; give(-1, POSS.UNKNOWN, periodSeconds(per)); lastFt = null; }
    const wasFt = lastFt; lastFt = null;

    // ---- free throws ----
    if (/^free throw/i.test(type)) {
      const m = type.match(/(\d) of (\d)/);
      const n = m ? int(m[1]) : 1, of = m ? int(m[2]) : 1;
      const kind = /technical/i.test(type) ? 1 : /flagrant/i.test(type) ? 2 : /clear path/i.test(type) ? 3 : 0;
      const made = p.scoringPlay ? 1 : 0;
      if (side >= 0) { out.ft.push([idNum(p0), side, per, sec, made, n * 10 + of, kind]); scoring.push({ per, sec, i, side, pts: made, row: null }); }
      lastFt = { n, of, kind };
      if (made && kind === 0 && n === of && side >= 0) give(1 - side, POSS.AFTER_SCORE, sec);
      continue;
    }

    // ---- field-goal attempts ----
    if (p.shootingPlay) {
      if (side < 0) continue;
      const c = p.coordinate || {};
      const okXY = Number.isFinite(c.x) && Number.isFinite(c.y) && Math.abs(c.x) < 200 && Math.abs(c.y) < 200;
      const x = okXY ? Math.round(c.x) : null, y = okXY ? Math.round(c.y) : null;
      let fl = styleFlags(type);
      const dm = text.match(/(\d+)-foot/);
      let dist;
      if (dm) dist = int(dm[1]);
      else { dist = okXY ? Math.floor(coordDist(x, y, GEOM)) : 0; fl |= FL.XY_DIST; } // ESPN text distances are whole feet, rounded down
      const pts = int(p.pointsAttempted) === 3 || /three point/i.test(text) ? 3 : 2;
      const made = p.scoringPlay ? 1 : 0;
      const blocked = /\bblocks\b/i.test(text);
      const ast = made && /assists\)/i.test(text) ? idNum(parts[1]) : 0;
      const blk = !made && blocked ? idNum(parts[1]) : 0;
      const mine = poss.side === side;
      const ps = mine ? poss.src + (poss.whistle ? 10 : 0) : 0;
      const pt = mine && poss.src !== POSS.UNKNOWN ? Math.max(0, Math.min(99, Math.round(poss.sec - sec))) : 0;
      const row = [idNum(p0), side, per, sec, x, y, dist, pts, made, fl, ast, blk, 0, ps, pt];
      out.shots.push(row);
      scoring.push({ per, sec, i, side, pts: made ? int(p.scoreValue) || pts : 0, row });
      if (made) give(1 - side, POSS.AFTER_SCORE, sec);
      continue;
    }

    // ---- rebounds ----
    if (/rebound/i.test(type)) {
      // a team "rebound" between two free throws of the same trip is a bookkeeping entry, not a possession
      if (!p0 && wasFt && (wasFt.n < wasFt.of || wasFt.kind !== 0)) { lastFt = wasFt; continue; }
      if (side >= 0) give(side, /offensive/i.test(type) ? POSS.OFF_REBOUND : POSS.DEF_REBOUND, sec, !p0);
      continue;
    }

    // ---- turnovers ----
    if (TURNOVER.test(type)) {
      const live = /steals\)/i.test(text);
      if (side >= 0) {
        if (p0) {
          const r = cnt(p0, side);
          if (/bad pass/i.test(type)) r[5]++;
          else if (/lost ball/i.test(type)) r[6]++;
          else if (/offensive foul/i.test(type)) r[8]++;
          else r[7]++;
          if (live) r[9]++;
        } else out.tto[side]++;
        give(1 - side, live ? POSS.STEAL : POSS.DEAD_TURNOVER, sec);
      }
      continue;
    }

    // ---- technicals, flagrants, ejections ----
    const isTech = /technical|techfoul/i.test(type), isFlagrant = /flagrant/i.test(type), isEject = /^ejection/i.test(type);
    if (isTech || isFlagrant || isEject) {
      const kind = techKind(type);
      const who = kind === 2 ? parts.filter(Boolean) : [p0];
      for (const pid of who) {
        const isPlayer = pid && boxSide.has(pid);
        const sd = isPlayer ? boxSide.get(pid) : side;
        if (sd < 0) continue;
        out.tech.push([isPlayer ? idNum(pid) : 0, sd, per, sec, !isPlayer && kind === 1 ? 9 : kind]);
        if (isFlagrant && isPlayer) cnt(pid, sd)[4]++;
      }
      poss.whistle = true;
      continue;
    }

    // ---- personal fouls ----
    if (/foul|offensive charge/i.test(type)) {
      const col = /shooting/i.test(type) ? 2 : /offensive/i.test(type) ? 3 : 4;
      const who = /^double personal/i.test(type) ? parts.filter(Boolean) : [p0];
      for (const pid of who) { const sd = pid ? boxSide.get(pid) ?? side : -1; if (sd >= 0) cnt(pid, sd)[col]++; }
      poss.whistle = true;
      continue;
    }

    // ---- substitutions ----
    if (/^substitution/i.test(type)) {
      if (side >= 0) out.subs.push([per, sec, side, idNum(parts[0]), idNum(parts[1])]);
      poss.whistle = true;
      continue;
    }

    // ---- jump balls: the third participant gains possession ----
    if (/^jumpball$/i.test(type)) {
      const winner = parts[2] && boxSide.has(parts[2]) ? boxSide.get(parts[2]) : -1;
      give(winner, POSS.UNKNOWN, sec, true);
      continue;
    }

    if (WHISTLE.test(type)) poss.whistle = true;
  }

  // Running score, rebuilt from the plays in game-time order. ESPN's own per-play score fields
  // are not used: they drift in about 2% of games and its play order has rare out-of-order entries.
  scoring.sort((x, y) => x.per - y.per || y.sec - x.sec || x.i - y.i);
  const score = [0, 0];
  for (const e of scoring) {
    if (e.row) e.row[12] = score[e.side] - score[1 - e.side];
    if (e.pts) { score[e.side] += e.pts; out.sc.push([e.per, e.sec, score[0], score[1]]); }
  }
  out.pf = [...counts.values()].filter((r) => r.slice(2).some(Boolean));
  // Honesty flag: points in the final score that no play accounts for (ESPN feed gaps).
  const gap = q.map((per, i) => per.reduce((x, y) => x + y, 0) - score[i]);
  if (q[0].length && q[1].length && (gap[0] || gap[1])) out.gap = gap;
  return out;
}
