// On-court reconstruction from play-by-play substitutions, and the walk-forward state built on it.
//
// For every finished game (data/pbp/<id>.json) the five players on the floor for each side are
// rebuilt period by period. ESPN does not say who starts a period, so the five is inferred:
//   period 1: the box-score starters;
//   later periods: a player whose first event in the period is leaving the game, a shot, a free
//   throw, an assist or a block was on the floor at the start; a player whose first event is
//   entering was not. Gaps are filled with the five that ended the previous period, when that
//   player has no "entered first" event in the new period.
// From the rebuilt fives the state counts, per player: seconds on the floor, team points for and
// against while on and off (on/off), seconds and points in each game-flow state (far ahead, far
// behind, tight fourth quarter), points with each teammate / opponent on or off the floor, and
// opponent shots at the rim with him on or off. Per team: substitution timing, who is on the floor
// late in close games, and how many players a coach uses in close and lopsided games.
//
// record(g, pbp, poss) must be called AFTER game g has been projected (like the zone state), so
// a projection only ever reads games played before it. Preseason games are not counted.
import { decodeShot, elapsedSeconds, periodSeconds, FL } from "./zones.mjs";

export const FLOW_RULE = {
  far: 15,          // "far ahead / far behind": leading or trailing by 15 or more
  tight: 5,         // "tight fourth quarter": 4th quarter or overtime, score within 5
  closeAt: 120,     // closers: on the floor with 2:00 left in the 4th quarter and the score within 5
  closeGame: 8, lopsided: 18, // final margins for "close" and "lopsided" games (bench length)
  minPairMin: 100,  // a pair is shown with 100+ minutes together
  minOnOffMin: 300, // on/off is shown with 300+ minutes on the floor
  rimMinAtt: 150,   // rim defence with / without a player is shown with 150+ opponent rim attempts while he was on the floor
};
const STATES = ["ahead", "behind", "tight", "normal"];
const SI = { ahead: 0, behind: 1, tight: 2, normal: 3 };
const stateOf = (per, m) => (m >= FLOW_RULE.far ? 0 : m <= -FLOW_RULE.far ? 1 : per >= 4 && Math.abs(m) <= FLOW_RULE.tight ? 2 : 3);

function blankPl() {
  return {
    g: 0, sec: 0, pts: 0, possOn: 0, onFor: 0, onAg: 0, possOff: 0, offFor: 0, offAg: 0, offSec: 0,
    st: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], // per state: [seconds, points, games with time in the state]
    q4: { blow: [0, 0, 0], norm: [0, 0, 0] },         // [games, 4th-quarter seconds, total seconds] in lopsided / other games
    rim: [0, 0, 0, 0],                                 // opponent rim [attempts, makes] while on, [attempts, makes] while off (games he played)
    rimSec: [0, 0],
    mates: new Map(),                                  // teammate -> [games, secTogether, forTogether, againstTogether, myPtsWithHim, mySecWithout, myPtsWithout]
    opps: new Map(),                                   // opponent -> [games, secTogether, myPtsWithHim, mySecWithout, myPtsWithout]
    close: [0, 0],                                     // [team close games he played, times on the floor at 2:00]
  };
}
function blankTeamSeason() {
  return { g: 0, firstSub: 0, firstSubN: 0, subs: 0, starterRest: 0, starterRestN: 0, closeG: 0, closers: new Map(),
    depthClose: [0, 0], depthBlow: [0, 0], depthAll: [0, 0], starterQ4Blow: [0, 0], starterQ4Norm: [0, 0] };
}

export function createFlowState() {
  const PL = new Map(), TM = new Map();
  let recorded = 0, missing = 0, partial = 0;
  const pl = (id) => { let o = PL.get(id); if (!o) { o = blankPl(); PL.set(id, o); } return o; };
  const tm = (tid, season) => { let t = TM.get(tid); if (!t) { t = {}; TM.set(tid, t); } return (t[season] ||= blankTeamSeason()); };

  // g: game record (box players with t, st, min); pbp: play-by-play; poss: possessions per team in the game
  function record(g, pbp, poss) {
    if (g.stype === 1) return null;
    if (!pbp || pbp.np || !Array.isArray(pbp.subs) || !pbp.subs.length) { missing++; return null; }
    recorded++;
    const tids = [g.home, g.away];
    const periods = Math.max(pbp.q?.[0]?.length || 0, pbp.q?.[1]?.length || 0, 4);
    const gameSec = elapsedSeconds(periods, 0);
    const box = [0, 1].map((s) => g.players.filter((x) => x.t === tids[s] && x.min > 0));
    const played = [0, 1].map((s) => new Set(box[s].map((x) => String(x.id))));
    const starters = [0, 1].map((s) => box[s].filter((x) => x.st).map((x) => String(x.id)));
    const finalM = g.hs - g.as;

    // ---- events, in game time; at the same moment: score, then shot / free throw, then substitution ----
    const ev = [];
    for (const r of pbp.sc || []) ev.push({ t: elapsedSeconds(r[0], r[1]), per: r[0], k: 0, h: r[2], a: r[3] });
    for (const r of pbp.shots || []) {
      const s = decodeShot(r, pbp);
      ev.push({ t: elapsedSeconds(s.per, s.sec), per: s.per, k: 1, side: s.side, pid: s.pid, pts: s.made ? s.pts : 0, rim: s.zone === "rim" && !(s.fl & FL.HEAVE), made: s.made, ast: s.ast, blk: s.blk, m: s.margin });
    }
    for (const r of pbp.ft || []) ev.push({ t: elapsedSeconds(r[2], r[3]), per: r[2], k: 1, side: r[1], pid: r[0] ? String(r[0]) : null, pts: r[4] ? 1 : 0, ft: true });
    for (const r of pbp.subs) ev.push({ t: elapsedSeconds(r[0], r[1]), per: r[0], k: 2, side: r[2], in: r[3] ? String(r[3]) : null, out: r[4] ? String(r[4]) : null });
    ev.sort((a, b) => a.t - b.t || a.k - b.k);
    const byPer = new Map();
    for (const e of ev) { if (!byPer.has(e.per)) byPer.set(e.per, []); byPer.get(e.per).push(e); }

    // ---- per-game accumulators ----
    const gsec = new Map(), gpts = new Map(), gst = new Map(), gq4 = new Map();
    const iv = new Map();         // pid -> [[start, end], ...]
    const pairPts = new Map();    // "p|q" -> p's points while q on the floor (teammate or opponent)
    const pairScore = new Map();  // "p|q" teammates -> [for, against] while both on
    const rimOn = new Map();      // pid -> [att, made] opponent rim shots while on
    const gFor = new Map(), gAg = new Map(); // pid -> team points for / against while he was on
    const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    let rimTot = [[0, 0], [0, 0]]; // opponent rim shots against side s: [att, made]
    const on = [new Set(), new Set()], start = new Map();
    let hScore = 0, aScore = 0, snapped = false, closeSnap = null;
    const T2 = elapsedSeconds(4, FLOW_RULE.closeAt);
    let prevEnd = [[], []], firstSub = [null, null], incomplete = false;

    const enter = (s, pid, t) => { if (!pid || on[s].has(pid)) return; on[s].add(pid); start.set(pid, t); };
    const leave = (s, pid, t) => { if (!pid || !on[s].has(pid)) return false; on[s].delete(pid); const t0 = start.get(pid); if (t > t0) { if (!iv.has(pid)) iv.set(pid, []); iv.get(pid).push([t0, t]); } return true; };
    let lastT = 0;
    const tick = (t, per) => {
      const dt = t - lastT; if (dt <= 0) { lastT = Math.max(lastT, t); return; }
      const m0 = hScore - aScore;
      for (let s = 0; s < 2; s++) {
        const si = stateOf(per, s ? -m0 : m0);
        for (const pid of on[s]) {
          add(gsec, pid, dt);
          let a = gst.get(pid); if (!a) { a = [0, 0, 0, 0, 0, 0, 0, 0]; gst.set(pid, a); } a[si * 2] += dt;
          if (per === 4) add(gq4, pid, dt);
        }
      }
      lastT = t;
    };

    for (let per = 1; per <= periods; per++) {
      const list = byPer.get(per) || [];
      const p0 = elapsedSeconds(per, periodSeconds(per)), p1 = elapsedSeconds(per, 0);
      lastT = p0;
      // infer who started the period
      for (let s = 0; s < 2; s++) {
        const first = new Map();
        const seen = (pid, how) => { if (pid && played[s].has(pid) && !first.has(pid)) first.set(pid, how); };
        for (const e of list) {
          if (e.k === 2 && e.side === s) { seen(e.out, "start"); seen(e.in, "in"); }
          else if (e.k === 1) { if (e.side === s) { seen(e.pid, "start"); if (e.ast) seen(e.ast, "start"); } else if (e.blk) seen(e.blk, "start"); }
        }
        let five = per === 1 && starters[s].length === 5 ? [...starters[s]] : [...first].filter(([, h]) => h === "start").map(([pid]) => pid);
        if (per === 1 && starters[s].length !== 5) for (const pid of starters[s]) if (!five.includes(pid)) five.unshift(pid);
        for (const pid of prevEnd[s]) { if (five.length >= 5) break; if (!five.includes(pid) && first.get(pid) !== "in") five.push(pid); }
        if (five.length !== 5) incomplete = true;
        on[s].clear(); for (const pid of five.slice(0, 5)) enter(s, pid, p0);
      }
      for (const e of list) {
        if (!snapped && per === 4 && e.t > T2) { closeSnap = { m: hScore - aScore, on: [[...on[0]], [...on[1]]] }; snapped = true; }
        tick(Math.min(e.t, p1), per);
        if (e.k === 0) {
          const dh = e.h - hScore, da = e.a - aScore;
          if (dh || da) for (let s = 0; s < 2; s++) {
            const f = s ? da : dh, ag = s ? dh : da, arr = [...on[s]];
            for (const pid of arr) { add(gFor, pid, f); add(gAg, pid, ag); }
            for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr.length; j++) if (i !== j) { const k = arr[i] + "|" + arr[j]; let v = pairScore.get(k); if (!v) { v = [0, 0]; pairScore.set(k, v); } v[0] += f; v[1] += ag; }
          }
          hScore = e.h; aScore = e.a;
        } else if (e.k === 1) {
          const s = e.side;
          if (e.pts && e.pid) {
            add(gpts, e.pid, e.pts);
            const m = e.ft ? (s ? aScore - hScore : hScore - aScore) : e.m;
            let a = gst.get(e.pid); if (!a) { a = [0, 0, 0, 0, 0, 0, 0, 0]; gst.set(e.pid, a); } a[stateOf(per, m) * 2 + 1] += e.pts;
            for (const q of on[s]) if (q !== e.pid) add(pairPts, e.pid + "|" + q, e.pts);
            for (const q of on[1 - s]) add(pairPts, e.pid + "|" + q, e.pts);
          }
          if (e.rim) {
            const d = 1 - s; rimTot[d][0]++; rimTot[d][1] += e.made;
            for (const q of on[d]) { let a = rimOn.get(q); if (!a) { a = [0, 0]; rimOn.set(q, a); } a[0]++; a[1] += e.made; }
          }
        } else {
          const s = e.side;
          if (firstSub[s] == null) firstSub[s] = e.t;
          const was = leave(s, e.out, e.t);
          if (!was && on[s].size >= 5 && e.in && !on[s].has(e.in)) incomplete = true;
          enter(s, e.in, e.t);
        }
      }
      if (!snapped && per === 4) { closeSnap = { m: hScore - aScore, on: [[...on[0]], [...on[1]]] }; snapped = true; }
      tick(p1, per);
      for (let s = 0; s < 2; s++) { prevEnd[s] = [...on[s]]; for (const pid of [...on[s]]) leave(s, pid, p1); }
    }
    if (incomplete) partial++;

    // ---- fold the game into the running state ----
    const overlap = (a, b) => { let o = 0; for (const x of a) for (const y of b) { const lo = Math.max(x[0], y[0]), hi = Math.min(x[1], y[1]); if (hi > lo) o += hi - lo; } return o; };
    const tPts = [g.hs, g.as];
    const lopsided = Math.abs(finalM) >= FLOW_RULE.lopsided, closeG = Math.abs(finalM) <= FLOW_RULE.closeGame;
    for (let s = 0; s < 2; s++) {
      const ids = [...played[s]].filter((pid) => (gsec.get(pid) || 0) > 0);
      for (const pid of ids) {
        const P = pl(pid), sec = gsec.get(pid) || 0, pts = gpts.get(pid) || 0;
        P.g++; P.sec += sec; P.pts += pts;
        const onFor = gFor.get(pid) || 0, onAg = gAg.get(pid) || 0;
        const a = gst.get(pid) || [0, 0, 0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 4; k++) { P.st[k][0] += a[k * 2]; P.st[k][1] += a[k * 2 + 1]; if (a[k * 2] > 0) P.st[k][2]++; }
        const q = lopsided ? P.q4.blow : P.q4.norm; q[0]++; q[1] += gq4.get(pid) || 0; q[2] += sec;
        const r = rimOn.get(pid) || [0, 0]; P.rim[0] += r[0]; P.rim[1] += r[1]; P.rim[2] += rimTot[s][0] - r[0]; P.rim[3] += rimTot[s][1] - r[1];
        P.rimSec[0] += sec; P.rimSec[1] += gameSec - sec;
        P.onFor += onFor; P.onAg += onAg; P.possOn += poss * sec / gameSec;
        P.offFor += tPts[s] - onFor; P.offAg += tPts[1 - s] - onAg; P.possOff += poss * (gameSec - sec) / gameSec; P.offSec += gameSec - sec;
        const myIv = iv.get(pid) || [];
        for (const q2 of ids) {
          if (q2 === pid) continue;
          const tog = overlap(myIv, iv.get(q2) || []), sc = pairScore.get(pid + "|" + q2) || [0, 0], wp = pairPts.get(pid + "|" + q2) || 0;
          let m = P.mates.get(q2); if (!m) { m = [0, 0, 0, 0, 0, 0, 0]; P.mates.set(q2, m); }
          m[0]++; m[1] += tog; m[2] += sc[0]; m[3] += sc[1]; m[4] += wp; m[5] += sec - tog; m[6] += pts - wp;
        }
        for (const q2 of played[1 - s]) {
          const qi = iv.get(q2); if (!qi) continue;
          const tog = overlap(myIv, qi), wp = pairPts.get(pid + "|" + q2) || 0;
          let m = P.opps.get(q2); if (!m) { m = [0, 0, 0, 0, 0]; P.opps.set(q2, m); }
          m[0]++; m[1] += tog; m[2] += wp; m[3] += sec - tog; m[4] += pts - wp;
        }
      }
      // team / coach habits for this season
      const T = tm(tids[s], g.season);
      T.g++; T.subs += pbp.subs.filter((r) => r[2] === s).length;
      if (firstSub[s] != null) { T.firstSub += firstSub[s]; T.firstSubN++; }
      for (const pid of starters[s]) { const f = iv.get(pid)?.[0]; if (f && f[0] === 0 && f[1] < 2880) { T.starterRest += f[1]; T.starterRestN++; } }
      const depth = box[s].filter((x) => x.min >= 1).length;
      T.depthAll[0]++; T.depthAll[1] += depth;
      if (closeG) { T.depthClose[0]++; T.depthClose[1] += depth; }
      if (lopsided) { T.depthBlow[0]++; T.depthBlow[1] += depth; }
      const stQ4 = starters[s].reduce((z, pid) => z + (gq4.get(pid) || 0), 0) / 60;
      const sq = lopsided ? T.starterQ4Blow : T.starterQ4Norm; sq[0]++; sq[1] += stQ4;
      if (closeSnap && Math.abs(closeSnap.m) <= FLOW_RULE.tight) {
        T.closeG++;
        for (const pid of closeSnap.on[s]) T.closers.set(pid, (T.closers.get(pid) || 0) + 1);
        for (const pid of ids) { const P = pl(pid); P.close[0]++; if (closeSnap.on[s].includes(pid)) P.close[1]++; }
      }
    }
    return { incomplete };
  }

  // ---------------------------------------------------------------- queries (games recorded so far)
  const per100 = (pts, poss) => (poss > 0 ? pts / poss * 100 : null);
  function onOff(pid) {
    const P = PL.get(pid); if (!P || !P.sec) return null;
    const ortgOn = per100(P.onFor, P.possOn), drtgOn = per100(P.onAg, P.possOn), ortgOff = per100(P.offFor, P.possOff), drtgOff = per100(P.offAg, P.possOff);
    return { games: P.g, min: P.sec / 60, offMin: P.offSec / 60, possOn: P.possOn, possOff: P.possOff, ortgOn, drtgOn, ortgOff, drtgOff,
      netOn: ortgOn != null && drtgOn != null ? ortgOn - drtgOn : null, netOff: ortgOff != null && drtgOff != null ? ortgOff - drtgOff : null };
  }
  // his points per minute with a teammate (or opponent) on the floor and off it, in games both played
  function withPlayer(pid, qid, opp = false) {
    const P = PL.get(pid); if (!P) return null;
    const m = (opp ? P.opps : P.mates).get(qid); if (!m) return null;
    return opp ? { games: m[0], secOn: m[1], ptsOn: m[2], secOff: m[3], ptsOff: m[4] } : { games: m[0], secOn: m[1], forOn: m[2], agOn: m[3], ptsOn: m[4], secOff: m[5], ptsOff: m[6] };
  }
  function states(pid) {
    const P = PL.get(pid); if (!P || !P.sec) return null;
    return { games: P.g, sec: P.sec, pts: P.pts, st: Object.fromEntries(STATES.map((k, i) => [k, { sec: P.st[i][0], pts: P.st[i][1], games: P.st[i][2] }])) };
  }
  const player = (pid) => PL.get(pid) || null;
  const team = (tid, season) => TM.get(tid)?.[season] || null;
  const stats = () => ({ recorded, missing, partial });
  return { record, onOff, withPlayer, states, player, team, stats, STATES };
}
