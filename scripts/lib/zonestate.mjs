// Walk-forward zone state, built game by game from data/pbp/<id>.json and the box score.
//
// record(g) must be called AFTER game g has been projected (model.mjs calls it next to
// recordGame), so everything read from this state for a projection comes from earlier games.
//
// Three layers are kept:
//   d    decayed sums. Every game a player (or team) plays multiplies his old sums by a
//        constant below 1 before the new game is added, so recent games count more; the
//        first game of a new season multiplies them once more (last season carries over at
//        reduced weight). Preseason games count at 0.3. These feed the learned matchup factors.
//   raw  plain counts per season (regular season, play-in, playoffs; no preseason). These
//        are what the website shows, so every displayed number is a real count.
//   facts one compact record per game (period scores, zones, four factors, runs, clutch ...)
//        for head-to-head tables and "when X happened, Y won" scenarios.
import { decodeShots, decodeFreeThrows, decodeTech, decodePlayerCounts, FINE_IDS, FINE_TO_ZONE, STYLES, POSS, FL, elapsedSeconds, SC } from "./zones.mjs";
import { summarizeGame, EARLY_OFFENCE_SECS, CLUTCH } from "./gameflow.mjs";
import { loadPbp } from "./zonedata.mjs";
import { teamBox } from "./boxfix.mjs";

export const Z5 = ["rim", "paint", "mid", "c3", "atb"];
export const Z5_LABEL = { rim: "at the rim", paint: "in the paint (non-restricted)", mid: "from mid-range", c3: "on corner threes", atb: "on above-the-break threes" };
export const ZVAL = [2, 2, 2, 3, 3];                       // points per make in each of the five zones
export const NF = FINE_IDS.length, NS = STYLES.length;     // 11 fine zones (last = heave), 12 styles
export const FINE_VAL = FINE_IDS.map((f) => (f.startsWith("c3") || f.startsWith("atb") || f === "heave" ? 3 : 2));
const FI = Object.fromEntries(FINE_IDS.map((z, i) => [z, i]));
const SI = Object.fromEntries(STYLES.map((s, i) => [s.id, i]));
export const F2Z = FINE_IDS.map((f) => Z5.indexOf(FINE_TO_ZONE[f])); // fine index -> five-zone index (-1 = heave)

export const DECAY = { playerHalfLife: 40, teamHalfLife: 30, leagueHalfLife: 1200, playerCarry: 0.6, teamCarry: 0.5, preseasonWeight: 0.3 };
const LP = 0.5 ** (1 / DECAY.playerHalfLife), LT = 0.5 ** (1 / DECAY.teamHalfLife), LL = 0.5 ** (1 / DECAY.leagueHalfLife);

const arr = (n) => new Array(n).fill(0);
const P_KEYS = ["g", "min", "fga", "fgm", "fta", "ftm", "oreb", "dreb", "to", "pf", "pts", "tra", "trp", "q4", "qpts", "ast"];
const T_KEYS = ["g", "poss", "pts", "oppPts", "fga", "fgm", "tpa", "tpm", "fta", "oreb", "dreb", "tov", "pf", "ast", "oppFga", "oppFgm", "oppTpa", "oppTpm", "oppFta", "oppOreb", "oppDreb", "oppTov",
  "tra", "traA", "sec", "secA", "potov", "potovA", "fb", "fbA", "paint", "paintA"];

const blankPD = () => ({ fa: arr(NF), fm: arr(NF), fas: arr(NF), sa: arr(NS), sm: arr(NS), ...Object.fromEntries(P_KEYS.map((k) => [k, 0])) });
const blankPR = () => ({ g: 0, min: 0, fa: arr(NF), fm: arr(NF), fas: arr(NF), sa: arr(NS), sm: arr(NS), q: arr(5), fga: 0, fgm: 0, fta: 0, ftm: 0, pts: 0,
  cl: { g: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, pts: 0 }, tech: 0, flag: 0, ejec: 0, sf: 0, of: 0, pf: 0, to: 0, tovBad: 0, tovLost: 0, tovViol: 0, tovLive: 0,
  tra: 0, trm: 0, trp: 0, blkZ: arr(6), blkd: 0, astZ: arr(6), ast: 0, oreb: 0, dreb: 0 });
const blankTD = () => ({ offA: arr(NF), offM: arr(NF), defA: arr(NF), defM: arr(NF), ...Object.fromEntries(T_KEYS.map((k) => [k, 0])) });
const blankWL = () => [0, 0];
const blankTR = () => ({ g: 0, w: 0, l: 0, offA: arr(NF), offM: arr(NF), offAst: arr(NF), defA: arr(NF), defM: arr(NF), sa: arr(NS), sm: arr(NS), dsa: arr(NS), dsm: arr(NS),
  qf: arr(5), qa: arr(5), qw: arr(4), ...Object.fromEntries(T_KEYS.map((k) => [k, 0])),
  tech: 0, coachTech: 0, flag: 0, ejec: 0, liveTov: 0, lead: 0, deficit: 0, run: 0, led: 0, lc: 0,
  afterLoss: blankWL(), afterWin: blankWL(), close: blankWL(), clutch: blankWL(), down10: blankWL(), up10: blankWL(), down10q4: blankWL(), up10q4: blankWL(),
  ledHalf: blankWL(), trailHalf: blankWL(), ledQ1: blankWL(), trailQ1: blankWL(), home: blankWL(), road: blankWL(), homeNet: 0, roadNet: 0, ot: blankWL(), blowout: blankWL(),
  clutchNet: 0, gids: [] });

export function createZoneState() {
  const players = new Map(), teams = new Map(), facts = new Map();
  const league = { d: blankTD(), raw: {}, pd: { sa: arr(NS), sm: arr(NS), fas: arr(NF), q4: 0, qpts: 0 } };
  const lastResult = new Map(); // tid -> { season, won } of its last non-preseason game (for "after a loss")
  let missing = 0, recorded = 0;

  const getP = (id) => { if (!players.has(id)) players.set(id, { id, d: blankPD(), raw: {}, vs: {}, season: null }); return players.get(id); };
  const getT = (id) => { if (!teams.has(id)) teams.set(id, { id, d: blankTD(), raw: {}, season: null }); return teams.get(id); };
  const scale = (o, f) => { for (const k of Object.keys(o)) { const v = o[k]; if (Array.isArray(v)) for (let i = 0; i < v.length; i++) v[i] *= f; else if (typeof v === "number") o[k] = v * f; } };

  function record(g, pbpIn) {
    const pbp = pbpIn !== undefined ? pbpIn : loadPbp(g.id); // the caller may pass the file it already loaded
    const hasPlays = !!pbp && !pbp.np && Array.isArray(pbp.shots);
    if (!hasPlays) missing++;
    recorded++;
    const pre = g.stype === 1, w = pre ? DECAY.preseasonWeight : 1, rawOK = !pre;
    const tids = [g.home, g.away];
    const boxBy = [g.players.filter((x) => x.t === g.home), g.players.filter((x) => x.t === g.away)];

    // ---- per-game accumulators ----
    const pg = new Map(); // pid -> game counts
    const gp = (pid, side) => { if (!pg.has(pid)) pg.set(pid, { side, fa: arr(NF), fm: arr(NF), fas: arr(NF), sa: arr(NS), sm: arr(NS), q: arr(5), tra: 0, trm: 0, trp: 0, cl: { fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, pts: 0 }, blkZ: arr(6), blkd: 0, astZ: arr(6), tech: 0, flag: 0, ejec: 0, sf: 0, of: 0, tovBad: 0, tovLost: 0, tovViol: 0, tovLive: 0 }); return pg.get(pid); };
    const tg = [0, 1].map(() => ({ fa: arr(NF), fm: arr(NF), fas: arr(NF), sa: arr(NS), sm: arr(NS) }));
    let sum = null, clutchGame = false;
    if (hasPlays) {
      const flowT = [], flowM = [];
      for (const r of pbp.sc || []) { flowT.push(elapsedSeconds(r[SC.PER], r[SC.SEC])); flowM.push(r[SC.HOME] - r[SC.AWAY]); }
      const marginBefore = (t) => { let m = 0; for (let i = 0; i < flowT.length && flowT[i] < t; i++) m = flowM[i]; return m; };
      for (const s of decodeShots(pbp)) {
        const fi = FI[s.fine], si = SI[s.style], zi = F2Z[fi] < 0 ? 5 : F2Z[fi];
        const t = tg[s.side]; t.fa[fi]++; t.fm[fi] += s.made; t.sa[si]++; t.sm[si] += s.made; if (s.made && s.ast) t.fas[fi]++;
        if (s.pid) {
          const o = gp(s.pid, s.side);
          o.fa[fi]++; o.fm[fi] += s.made; o.sa[si]++; o.sm[si] += s.made;
          if (s.made) { if (s.ast) o.fas[fi]++; o.q[Math.min(s.per, 5) - 1] += s.pts; }
          const early = !s.whistle && (s.poss === POSS.STEAL || s.poss === POSS.DEF_REBOUND) && s.possSecs <= EARLY_OFFENCE_SECS;
          if (early && !(s.fl & FL.HEAVE)) { o.tra++; o.trm += s.made; o.trp += s.made * s.pts; }
          if (s.per >= 4 && s.sec <= CLUTCH.lastSecs && Math.abs(s.margin) <= CLUTCH.within && !(s.fl & FL.HEAVE)) {
            clutchGame = true; o.cl.fga++; o.cl.fgm += s.made; o.cl.pts += s.made * s.pts; if (s.pts === 3) { o.cl.tpa++; o.cl.tpm += s.made; }
          }
          if (s.blk) o.blkd++;
        }
        if (s.made && s.ast) gp(s.ast, s.side).astZ[zi]++;
        if (s.blk) gp(s.blk, 1 - s.side).blkZ[zi]++;
      }
      for (const f of decodeFreeThrows(pbp)) {
        if (!f.pid) continue;
        const o = gp(f.pid, f.side);
        if (f.made) o.q[Math.min(f.per, 5) - 1]++;
        if (f.per >= 4 && f.sec <= CLUTCH.lastSecs) {
          const m = marginBefore(elapsedSeconds(f.per, f.sec));
          if (Math.abs(m) <= CLUTCH.within) { clutchGame = true; o.cl.fta++; o.cl.ftm += f.made; o.cl.pts += f.made; }
        }
      }
      for (const t of decodeTech(pbp)) {
        if (!t.pid) continue;
        const o = gp(t.pid, t.side);
        if (t.kind === 1 || t.kind === 2 || t.kind === 3) o.tech++; else if (t.kind === 6 || t.kind === 7) o.flag++; else if (t.kind === 8) o.ejec++;
      }
      for (const r of decodePlayerCounts(pbp)) {
        if (!r.pid) continue;
        const o = gp(r.pid, r.side);
        o.sf += r.shootingFouls; o.of += r.offensiveFouls; o.tovBad += r.tovBadPass; o.tovLost += r.tovLostBall; o.tovViol += r.tovViolation + r.tovOffFoul; o.tovLive += r.tovStolen;
      }
      sum = summarizeGame(pbp);
    }

    // ---- players ----
    for (const side of [0, 1]) for (const x of boxBy[side]) {
      if (!(x.min > 0)) continue;
      const P = getP(x.id), o = pg.get(x.id);
      if (P.season !== null && P.season !== g.season) scale(P.d, DECAY.playerCarry);
      P.season = g.season;
      scale(P.d, LP ** w);
      const d = P.d;
      d.g += w; d.min += w * x.min; d.fga += w * x.fga; d.fgm += w * x.fgm; d.fta += w * x.fta; d.ftm += w * x.ftm; d.oreb += w * (x.oreb || 0); d.dreb += w * (x.dreb || 0);
      d.to += w * x.to; d.pf += w * x.pf; d.pts += w * x.pts; d.ast += w * x.ast;
      if (o) {
        for (let i = 0; i < NF; i++) { d.fa[i] += w * o.fa[i]; d.fm[i] += w * o.fm[i]; d.fas[i] += w * o.fas[i]; }
        for (let i = 0; i < NS; i++) { d.sa[i] += w * o.sa[i]; d.sm[i] += w * o.sm[i]; }
        d.tra += w * o.tra; d.trp += w * o.trp; d.q4 += w * (o.q[3] + o.q[4]); d.qpts += w * (o.q[0] + o.q[1] + o.q[2] + o.q[3] + o.q[4]);
      }
      if (!rawOK) continue;
      const r = (P.raw[g.season] ||= blankPR());
      r.g++; r.min += x.min; r.fga += x.fga; r.fgm += x.fgm; r.fta += x.fta; r.ftm += x.ftm; r.pts += x.pts; r.pf += x.pf; r.to += x.to; r.ast += x.ast; r.oreb += x.oreb || 0; r.dreb += x.dreb || 0;
      if (clutchGame) r.cl.g++;
      if (o) {
        for (let i = 0; i < NF; i++) { r.fa[i] += o.fa[i]; r.fm[i] += o.fm[i]; r.fas[i] += o.fas[i]; }
        for (let i = 0; i < NS; i++) { r.sa[i] += o.sa[i]; r.sm[i] += o.sm[i]; }
        for (let i = 0; i < 5; i++) r.q[i] += o.q[i];
        for (let i = 0; i < 6; i++) { r.blkZ[i] += o.blkZ[i]; r.astZ[i] += o.astZ[i]; }
        for (const k of ["fga", "fgm", "tpa", "tpm", "fta", "ftm", "pts"]) r.cl[k] += o.cl[k];
        for (const k of ["tech", "flag", "ejec", "sf", "of", "tovBad", "tovLost", "tovViol", "tovLive", "tra", "trm", "trp", "blkd"]) r[k] += o[k];
        const v = (P.vs[tids[1 - side]] ||= { g: 0, fa: arr(6), fm: arr(6), pts: 0, gids: [] });
        v.g++; v.pts += x.pts; v.gids.push(g.id);
        for (let i = 0; i < NF; i++) { const zi = F2Z[i] < 0 ? 5 : F2Z[i]; v.fa[zi] += o.fa[i]; v.fm[zi] += o.fm[i]; }
      }
    }

    // ---- teams ----
    const tot = boxBy.map((ps, i) => {
      const s = (k) => ps.reduce((a, x) => a + (x[k] || 0), 0);
      const tm = g.teams?.find((t) => t.id === tids[i]) || {};
      // team totals come from ESPN's own team row; the player sum is only the fallback (a player row can be missing from the box score)
      const tb = teamBox(g, tids[i]) || { fga: s("fga"), fgm: s("fgm"), tpa: s("tpa"), tpm: s("tpm"), fta: s("fta"), ftm: s("ftm"), oreb: s("oreb"), dreb: s("dreb"), ast: s("ast"), stl: s("stl"), blk: s("blk"), to: s("to"), pf: s("pf") };
      const o = { pts: i ? g.as : g.hs, fga: tb.fga, fgm: tb.fgm, tpa: tb.tpa, tpm: tb.tpm, fta: tb.fta, ftm: tb.ftm, oreb: tb.oreb, dreb: tb.dreb, ast: tb.ast, stl: tb.stl, blk: tb.blk,
        tov: tb.to + Number(tm.teamTurnovers || 0), pf: tb.pf, paint: Number(tm.pointsInPaint || 0), fb: Number(tm.fastBreakPoints || 0),
        bench: ps.filter((x) => !x.st).reduce((a, x) => a + x.pts, 0) };
      o.poss = o.fga - o.oreb + o.tov + 0.44 * o.fta;
      return o;
    });
    const poss = (tot[0].poss + tot[1].poss) / 2;
    const margin = g.hs - g.as;
    const fact = { id: g.id, date: g.date, season: g.season, stype: g.stype, home: g.home, away: g.away, hs: g.hs, as: g.as, ot: Math.max(0, (g.periods || 4) - 4), poss: Math.round(poss * 10) / 10,
      lc: sum ? sum.leadChanges : null, clutch: hasPlays ? clutchGame : null, s: [] };
    for (const i of [0, 1]) {
      const me = tot[i], op = tot[1 - i], ss = sum?.sides[i], os = sum?.sides[1 - i], z = tg[i], zo = tg[1 - i];
      const five = Z5.map(() => [0, 0]);
      for (let f = 0; f < NF; f++) if (F2Z[f] >= 0) { five[F2Z[f]][0] += z.fm[f]; five[F2Z[f]][1] += z.fa[f]; }
      fact.s.push({ pts: me.pts, q: pbp?.q?.[i]?.slice() || null, fg: [me.fgm, me.fga], tp: [me.tpm, me.tpa], ft: [me.ftm, me.fta], oreb: me.oreb, dreb: me.dreb, ast: me.ast, tov: me.tov, stl: me.stl, blk: me.blk, pf: me.pf,
        paint: me.paint, fb: me.fb, bench: me.bench, tra: ss ? ss.transitionPts : null, sec: ss ? ss.secondChancePts : null, potov: ss ? ss.ptsAfterTurnover : null,
        lead: ss ? ss.largestLead : null, run: ss ? ss.bestRun : null, clutchPts: ss ? ss.clutchPts : null, led: ss && sum.gameSeconds ? Math.round(ss.secondsLed / sum.gameSeconds * 100) : null,
        z: hasPlays ? five : null, tech: ss ? ss.technicals : null });

      const T = getT(tids[i]);
      if (T.season !== null && T.season !== g.season) scale(T.d, DECAY.teamCarry);
      T.season = g.season;
      scale(T.d, LT ** w);
      const add = (o, f) => {
        o.g += f; o.poss += f * poss; o.pts += f * me.pts; o.oppPts += f * op.pts;
        for (const k of ["fga", "fgm", "tpa", "tpm", "fta", "oreb", "dreb", "tov", "pf", "ast", "fb", "paint"]) o[k] += f * me[k];
        o.oppFga += f * op.fga; o.oppFgm += f * op.fgm; o.oppTpa += f * op.tpa; o.oppTpm += f * op.tpm; o.oppFta += f * op.fta; o.oppOreb += f * op.oreb; o.oppDreb += f * op.dreb; o.oppTov += f * op.tov;
        o.fbA += f * op.fb; o.paintA += f * op.paint;
        if (ss) { o.tra += f * ss.transitionPts; o.traA += f * os.transitionPts; o.sec += f * ss.secondChancePts; o.secA += f * os.secondChancePts; o.potov += f * ss.ptsAfterTurnover; o.potovA += f * os.ptsAfterTurnover; }
        for (let k = 0; k < NF; k++) { o.offA[k] += f * z.fa[k]; o.offM[k] += f * z.fm[k]; o.defA[k] += f * zo.fa[k]; o.defM[k] += f * zo.fm[k]; }
      };
      add(T.d, w);
      // league (each team-game adds its own offence)
      scale(league.d, LL ** w);
      { const L = league.d; L.g += w; L.poss += w * poss; L.pts += w * me.pts;
        for (const k of ["fga", "fgm", "tpa", "tpm", "fta", "oreb", "dreb", "tov", "pf", "ast", "fb", "paint"]) L[k] += w * me[k];
        if (ss) { L.tra += w * ss.transitionPts; L.sec += w * ss.secondChancePts; L.potov += w * ss.ptsAfterTurnover; }
        for (let k = 0; k < NF; k++) { L.offA[k] += w * z.fa[k]; L.offM[k] += w * z.fm[k]; }
        scale(league.pd, LL ** w);
        for (let k = 0; k < NS; k++) { league.pd.sa[k] += w * z.sa[k]; league.pd.sm[k] += w * z.sm[k]; }
        for (let k = 0; k < NF; k++) league.pd.fas[k] += w * z.fas[k];
        if (pbp?.q?.[i]) { const q = pbp.q[i]; league.pd.q4 += w * q.slice(3).reduce((a, b) => a + b, 0); league.pd.qpts += w * q.reduce((a, b) => a + b, 0); } }
      if (!rawOK) continue;
      const R = (T.raw[g.season] ||= blankTR());
      add(R, 1);
      const won = i === 0 ? margin > 0 : margin < 0, my = i === 0 ? margin : -margin;
      R.w += won ? 1 : 0; R.l += won ? 0 : 1; R.gids.push(g.id);
      const wl = (b) => { b[won ? 0 : 1]++; };
      if (hasPlays) {
        for (let k = 0; k < NF; k++) R.offAst[k] += z.fas[k];
        for (let k = 0; k < NS; k++) { R.sa[k] += z.sa[k]; R.sm[k] += z.sm[k]; R.dsa[k] += zo.sa[k]; R.dsm[k] += zo.sm[k]; }
        const q = pbp.q?.[i] || [], oq = pbp.q?.[1 - i] || [];
        for (let k = 0; k < Math.max(q.length, oq.length); k++) { const j = Math.min(k, 4); R.qf[j] += q[k] || 0; R.qa[j] += oq[k] || 0; if (k < 4 && (q[k] || 0) > (oq[k] || 0)) R.qw[k]++; }
        const q1 = (q[0] || 0) - (oq[0] || 0), half = q1 + (q[1] || 0) - (oq[1] || 0), q3 = half + (q[2] || 0) - (oq[2] || 0);
        if (q1 > 0) wl(R.ledQ1); else if (q1 < 0) wl(R.trailQ1);
        if (half > 0) wl(R.ledHalf); else if (half < 0) wl(R.trailHalf);
        if (q3 <= -10) wl(R.down10q4); if (q3 >= 10) wl(R.up10q4);
        if (ss.largestDeficit >= 10) wl(R.down10); if (ss.largestLead >= 10) wl(R.up10);
        if (clutchGame) { wl(R.clutch); R.clutchNet += ss.clutchPts - os.clutchPts; }
        R.tech += ss.technicals; R.flag += ss.flagrants; R.ejec += ss.ejections; R.liveTov += ss.liveTurnovers; R.lead += ss.largestLead; R.deficit += ss.largestDeficit; R.run += ss.bestRun;
        R.led += sum.gameSeconds ? ss.secondsLed / sum.gameSeconds : 0; R.lc += sum.leadChanges;
        R.coachTech += decodeTech(pbp).filter((t) => t.side === i && t.kind === 9).length;
      }
      if (Math.abs(my) <= 5 || fact.ot) wl(R.close);
      if (Math.abs(my) >= 20) wl(R.blowout);
      if (fact.ot) wl(R.ot);
      if (!g.neutral) { if (i === 0) { wl(R.home); R.homeNet += my; } else { wl(R.road); R.roadNet += my; } }
      { const lr = lastResult.get(tids[i]); if (lr && lr.season === g.season) wl(lr.won ? R.afterWin : R.afterLoss); } // the previous game of the same season
    }
    if (rawOK) { lastResult.set(g.home, { season: g.season, won: margin > 0 }); lastResult.set(g.away, { season: g.season, won: margin < 0 });
      const LR = (league.raw[g.season] ||= { g: 0, fa: arr(NF), fm: arr(NF), fas: arr(NF), sa: arr(NS), sm: arr(NS), q: arr(5), pts: 0, poss: 0, clFga: 0, clFgm: 0 });
      LR.g += 2; LR.pts += g.hs + g.as; LR.poss += 2 * poss;
      for (const i of [0, 1]) { for (let k = 0; k < NF; k++) { LR.fa[k] += tg[i].fa[k]; LR.fm[k] += tg[i].fm[k]; LR.fas[k] += tg[i].fas[k]; } for (let k = 0; k < NS; k++) { LR.sa[k] += tg[i].sa[k]; LR.sm[k] += tg[i].sm[k]; }
        const q = pbp?.q?.[i] || []; for (let k = 0; k < q.length; k++) LR.q[Math.min(k, 4)] += q[k]; }
      for (const o of pg.values()) { LR.clFga += o.cl.fga; LR.clFgm += o.cl.fgm; }
    }
    facts.set(g.id, fact);
  }

  // ---------------- read side (decayed, for projections) ----------------
  const five = (a) => { const o = arr(5); for (let i = 0; i < NF; i++) if (F2Z[i] >= 0) o[F2Z[i]] += a[i]; return o; };
  function leagueNow() {
    const L = league.d, a = five(L.offA), m = five(L.offM), fga = a.reduce((x, y) => x + y, 0) || 1;
    const dflt = [0.66, 0.43, 0.41, 0.385, 0.355], dShare = [0.28, 0.2, 0.1, 0.11, 0.31];
    const ok = fga > 3000;
    return {
      ok, pct: Z5.map((_, i) => (ok && a[i] > 200 ? m[i] / a[i] : dflt[i])), share: Z5.map((_, i) => (ok ? a[i] / fga : dShare[i])),
      ftaPerFga: L.fga > 3000 ? L.fta / L.fga : 0.26, tovPerPoss: L.poss > 3000 ? L.tov / L.poss : 0.135, orbPct: L.oreb + L.dreb > 1000 ? L.oreb / (L.oreb + L.dreb) : 0.26,
      missPerPoss: L.poss > 3000 ? (L.fga - L.fgm) / L.poss : 0.48, tpaPerFga: L.fga > 3000 ? L.tpa / L.fga : 0.42, traPerG: L.g > 40 ? L.tra / L.g : 15, fbPerG: L.g > 40 ? L.fb / L.g : 15,
      q4Share: league.pd.qpts > 3000 ? league.pd.q4 / league.pd.qpts : 0.245, pfPerPoss: L.poss > 3000 ? L.pf / L.poss : 0.2,
    };
  }
  // Player offence as the model sees it before a game (decayed sums).
  function playerNow(pid, lg = leagueNow()) {
    const P = players.get(pid); if (!P || P.d.g < 0.5) return null;
    const d = P.d, a = five(d.fa), m = five(d.fm), tot = a.reduce((x, y) => x + y, 0);
    const min = Math.max(1, d.min);
    const K = 25; // attempts of league-average shooting mixed into each zone percentage
    return {
      g: d.g, att: tot, share: a.map((v) => (tot > 0 ? v / tot : 0)), zAtt: a,
      pct: a.map((v, i) => (m[i] + K * lg.pct[i]) / (v + K)), fgaPerMin: d.fga / min, ftaPerMin: d.fta / min, ftPct: (d.ftm + 8 * 0.78) / (d.fta + 8),
      orebPerMin: d.oreb / min, drebPerMin: d.dreb / min, toPerMin: d.to / min, trPtsPerMin: d.trp / min, trShare: d.fga > 0 ? d.tra / d.fga : 0,
      q4Share: (d.q4 + 40 * lg.q4Share) / (d.qpts + 40), ptsPerMin: d.pts / min,
    };
  }
  // Team defence and tendencies before a game (decayed sums), relative to the league.
  function teamNow(tid, lg = leagueNow()) {
    const T = teams.get(tid); if (!T || T.d.g < 1) return null;
    const d = T.d, da = five(d.defA), dm = five(d.defM), oa = five(d.offA), om = five(d.offM);
    const dTot = da.reduce((x, y) => x + y, 0) || 1, oTot = oa.reduce((x, y) => x + y, 0) || 1;
    const K = 150, sh = (v, n, base, k) => (v + k * base) / (n + k);
    const rel = (v, n, base, k) => sh(v, n, base, k) / base - 1;
    return {
      g: d.g,
      defDiff: Z5.map((_, i) => sh(dm[i], da[i], lg.pct[i], K) - lg.pct[i]), defAtt: da, defShare: da.map((v) => v / dTot),
      offDiff: Z5.map((_, i) => sh(om[i], oa[i], lg.pct[i], K) - lg.pct[i]), offShare: oa.map((v) => v / oTot),
      foulRel: rel(d.oppFta, d.oppFga, lg.ftaPerFga, 500),                       // free throws allowed per opponent shot
      forceTovRel: rel(d.oppTov, d.poss, lg.tovPerPoss, 600),                     // turnovers forced per possession
      tovRel: rel(d.tov, d.poss, lg.tovPerPoss, 600),
      orbAllowedRel: rel(d.oppOreb, d.oppOreb + d.dreb, lg.orbPct, 400),          // offensive rebounds allowed
      orbRel: rel(d.oreb, d.oreb + d.oppDreb, lg.orbPct, 400),                    // own offensive rebounding
      orbPct: sh(d.oreb, d.oreb + d.oppDreb, lg.orbPct, 400), orbAllowedPct: sh(d.oppOreb, d.oppOreb + d.dreb, lg.orbPct, 400),
      missRel: rel(d.fga - d.fgm, d.poss, lg.missPerPoss, 600),                   // own missed shots per possession
      tpaAllowedRel: rel(d.oppTpa, d.oppFga, lg.tpaPerFga, 500),
      tpaRel: rel(d.tpa, d.fga, lg.tpaPerFga, 500),
      traAllowedRel: rel(d.traA, d.g, lg.traPerG, 8), traRel: rel(d.tra, d.g, lg.traPerG, 8),
      ftRel: rel(d.fta, d.fga, lg.ftaPerFga, 500),
    };
  }

  return { players, teams, league, facts, record, leagueNow, playerNow, teamNow, five, stats: () => ({ recorded, missing }) };
}
