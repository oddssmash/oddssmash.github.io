// Walk-forward history for the Monte Carlo simulator.
//
// The simulator never assumes a scenario rate: every rate and spread it uses is
// counted here from finished games, in date order, using only games that tipped off
// before the one being simulated. `absorb()` adds one finished game; `params()` and
// `playerRates()` read what is known at that moment.
//
// Inputs per finished game: the ESPN box score (data/games/<id>.json), the
// walk-forward projection made before it (public/data/games/<id>.json, when the
// model projected it) and the period scores from the play-by-play (data/pbp).
// Betting data is never read here.

export const STATS = ["min", "pts", "reb", "ast", "tpm", "tpa", "fgm", "fga", "ftm", "fta", "stl", "blk", "tov", "pf"];
export const S = STATS.length;
export const MIN_BUCKETS = [0, 8, 15, 25]; // projected-minute buckets: <8, 8-15, 15-25, 25+
export const minBucket = (m) => (m >= 25 ? 3 : m >= 15 ? 2 : m >= 8 ? 1 : 0);
export const MARGIN_BUCKETS = ["0-4", "4-8", "8-12", "12+"];
export const marginBucket = (m) => { const a = Math.abs(m); return a < 4 ? 0 : a < 8 ? 1 : a < 12 ? 2 : 3; };
export const ROLES = ["star", "starter", "bench"];
const POS = ["G", "F", "C"];
const posKey = (p) => (POS.includes(p) ? p : "F");

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pair = (v) => { const [a, b] = String(v || "0-0").split("-"); return [num(a), num(b)]; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- player targets: turn a projection row into shot attempts that reproduce it ----------
// pts = 2*p2*fg2a + 3*tpm + pft*fta, with fta = ftr*(fg2a+tpa)  ->  solve for fg2a.
export function targetsFor(row, r) {
  const min = Math.max(0, num(row.min));
  const tpa = Math.max(0, num(row.tpa));
  let p3 = tpa > 0.4 && row.tpm != null ? num(row.tpm) / tpa : r.p3;
  p3 = clamp(p3, 0.12, 0.6);
  const tpm = tpa * p3;
  const p2 = r.p2, pft = r.pft, ftr = r.ftr;
  const pts = Math.max(0, num(row.pts));
  let fg2a = (pts - 3 * tpm - pft * ftr * tpa) / (2 * p2 + pft * ftr);
  let fta;
  if (fg2a < 0) { fg2a = 0; fta = Math.max(0, (pts - 3 * tpm) / Math.max(0.3, pft)); }
  else fta = ftr * (fg2a + tpa);
  const has = (k) => row[k] != null && Number.isFinite(Number(row[k]));
  return {
    min, fg2a, tpa, p2, p3, pft, fta,
    reb: has("reb") ? Math.max(0, num(row.reb)) : r.rebPm * min,
    ast: has("ast") ? Math.max(0, num(row.ast)) : r.astPm * min,
    stl: has("stl") ? Math.max(0, num(row.stl)) : r.stlPm * min,
    blk: has("blk") ? Math.max(0, num(row.blk)) : r.blkPm * min,
    tov: r.tovPm * min,
    pfPm: r.pfPm,
    pts,
  };
}

function emptyLine() { return { g: 0, min: 0, fg2m: 0, fg2a: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, stl: 0, blk: 0, pf: 0, reb: 0, ast: 0, season: 0 }; }
const LINE_KEYS = ["g", "min", "fg2m", "fg2a", "tpm", "tpa", "ftm", "fta", "tov", "stl", "blk", "pf", "reb", "ast"];

export function createHistory() {
  const players = new Map();       // pid -> decayed sums
  const league = {};               // pos -> decayed sums
  for (const p of POS) league[p] = emptyLine();
  const pending = new Map();       // tid -> exit candidates waiting for the team's next game
  const H = {
    games: 0, paged: 0,
    reg: { n: 0, sh: 0, sa: 0, shh: 0, saa: 0, sha: 0 },
    pace: { n: 0, s: 0, ss: 0, fast: 0, slow: 0 },
    tie: { close3: 0, ot: 0 },
    mb: MARGIN_BUCKETS.map(() => ({ n: 0, close: 0, favBlow: 0, dogBlow: 0, ot: 0 })),
    q3: { n: 0, final15: 0, hist: new Array(61).fill(0) },
    rev: [0, 1, 2, 3, 4, 5, 6].map(() => ({ n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 })),
    shoot: { teamGames: 0, hot: 0, cold: 0 },
    dnp: MIN_BUCKETS.map(() => ({ n: 0, k: 0 })),
    minN: MIN_BUCKETS.map(() => ({ n: 0, s: 0, ss: 0, recent: [] })),
    blow: Object.fromEntries(ROLES.map((r) => [r, { win: { n: 0, min: 0, pts: 0 }, lose: { n: 0, min: 0, pts: 0 }, base: { n: 0, min: 0, pts: 0 } }])),
    foul: { n4: 0, d4: 0, n5: 0, d5: 0, n6: 0, d6: 0, playerGames: 0, pf5: 0, pf6: 0, pred5: 0 },
    exit: { minDen: 0, events: 0, fracs: [], keyEvents: 0, sameGain: 0, allGain: 0 },
    usage: { a: 0, b: 0, n: 0 },
    shot: { a2: 0, b2: 0, a3: 0, b3: 0 },
    team: { games: 0, foulTrouble: 0, rotation: 0 },
  };

  function decayed(line, f) { for (const k of LINE_KEYS) line[k] *= f; }

  function playerRates(pid, pos) {
    const L = league[posKey(pos)];
    const lg = (a, b, d) => (b > 0 ? a / b : d);
    const Lp2 = lg(L.fg2m, L.fg2a, 0.535), Lp3 = lg(L.tpm, L.tpa, 0.36), Lft = lg(L.ftm, L.fta, 0.78);
    const Lfga = L.fg2a + L.tpa;
    const Lftr = lg(L.fta, Lfga, 0.26);
    const pm = (k, d) => lg(L[k], L.min, d);
    const p = players.get(String(pid)) || emptyLine();
    const fga = p.fg2a + p.tpa;
    const sh = (made, att, prior, k) => (made + prior * k) / (att + k);
    const perMin = (k, d) => (p[k] + pm(k, d) * 120) / (p.min + 120);
    return {
      games: p.g,
      p2: clamp(sh(p.fg2m, p.fg2a, Lp2, 80), 0.3, 0.75),
      p3: clamp(sh(p.tpm, p.tpa, Lp3, 60), 0.15, 0.5),
      pft: clamp(sh(p.ftm, p.fta, Lft, 30), 0.4, 0.95),
      ftr: clamp((p.fta + Lftr * 40) / (fga + 40), 0.03, 0.8),
      tovPm: perMin("tov", 0.055), stlPm: perMin("stl", 0.03), blkPm: perMin("blk", 0.02),
      pfPm: perMin("pf", 0.075), rebPm: perMin("reb", 0.18), astPm: perMin("ast", 0.11),
    };
  }

  function regulation(box, q) {
    if (num(box.periods) <= 4) return [num(box.hs), num(box.as)];
    if (!q || !q[0] || !q[1]) return null;
    return [q[0].slice(0, 4).reduce((a, c) => a + c, 0), q[1].slice(0, 4).reduce((a, c) => a + c, 0)];
  }
  function possessions(box) {
    let poss = 0, k = 0;
    for (const t of box.teams || []) {
      const [, fga] = pair(t["fieldGoalsMade-fieldGoalsAttempted"]);
      const [, fta] = pair(t["freeThrowsMade-freeThrowsAttempted"]);
      if (!fga) continue;
      const to = t.totalTurnovers != null ? num(t.totalTurnovers) : num(t.turnovers);
      poss += fga - num(t.offensiveRebounds) + to + 0.44 * fta; k++;
    }
    if (k !== 2) return null;
    const per = Math.max(4, num(box.periods));
    return (poss / 2) * 48 / (48 + 5 * (per - 4));
  }

  // one finished game. page = walk-forward projection page or null; q = period scores or null
  function absorb(box, page, flow) {
    const q = flow && flow.q, sc = flow && flow.sc;
    H.games++;
    const tids = [String(box.home), String(box.away)];
    const byPid = new Map();
    for (const p of box.players || []) if (p.id) byPid.set(String(p.id), p);
    const margin = num(box.hs) - num(box.as);

    // resolve exit candidates of both teams: confirmed when he does not play this next game
    for (const tid of tids) {
      const list = pending.get(tid);
      if (!list) continue;
      for (const c of list) {
        const now = byPid.get(c.pid);
        if (now && num(now.min) > 0) {
          // he played the next game: an ordinary (large) minutes surprise, not an injury exit
          const m = H.minN[c.bk]; m.n++; m.s += c.rel; m.ss += c.rel * c.rel;
          m.recent.push(c.rel); if (m.recent.length > 3000) m.recent.shift();
          continue;
        }
        H.exit.events++;
        if (c.key) H.exit.keyEvents++;
        H.exit.fracs.push(c.frac);
        if (H.exit.fracs.length > 400) H.exit.fracs.shift();
        H.exit.sameGain += c.same; H.exit.allGain += c.all;
      }
      pending.delete(tid);
    }

    // preseason games are not counted in the scenario rates (rotations there are not regular-season
    // rotations: rest DNPs, short stints); they only feed the 0.3-weighted player shooting rates below
    const preGame = num(box.stype) === 1;
    if (page && page.pred && page.players && !preGame) {
      H.paged++;
      const reg = regulation(box, q);
      const pm = num(page.pred.hs) - num(page.pred.as);
      if (reg) {
        const rh = reg[0] - num(page.pred.hs), ra = reg[1] - num(page.pred.as);
        const R = H.reg; R.n++; R.sh += rh; R.sa += ra; R.shh += rh * rh; R.saa += ra * ra; R.sha += rh * ra;
        if (Math.abs(reg[0] - reg[1]) <= 3) { H.tie.close3++; if (num(box.periods) > 4) H.tie.ot++; }
      }
      const poss = possessions(box);
      if (poss && num(page.pace) > 60) {
        const phi = poss / num(page.pace), l = Math.log(phi);
        H.pace.n++; H.pace.s += l; H.pace.ss += l * l;
        if (phi >= 1.06) H.pace.fast++; if (phi <= 0.94) H.pace.slow++;
      }
      const b = H.mb[marginBucket(pm)];
      b.n++;
      if (Math.abs(margin) <= 5) b.close++;
      if (box.periods > 4) b.ot++;
      const favHome = pm >= 0;
      if ((favHome ? margin : -margin) >= 15) b.favBlow++;
      if ((favHome ? -margin : margin) >= 15) b.dogBlow++;
      if (q && q[0] && q[1] && q[0].length >= 3) {
        const l3 = Math.abs(q[0].slice(0, 3).reduce((a, c) => a + c, 0) - q[1].slice(0, 3).reduce((a, c) => a + c, 0));
        H.q3.n++; H.q3.hist[Math.min(60, l3)]++;
        if (Array.isArray(sc) && sc.length > 20) {
          // lead at every 6-minute mark of regulation, from the score after each scoring play
          const marks = new Array(9).fill(0);
          let h = 0, a = 0, k = 1;
          for (const row of sc) {
            const per = row[0]; if (per > 4) break;
            const el = (per - 1) * 12 + (12 - row[1] / 60);
            while (k <= 8 && el > k * 6 + 1e-9) { marks[k] = h - a; k++; }
            h = row[2]; a = row[3];
          }
          while (k <= 8) { marks[k] = h - a; k++; }
          for (let s = 1; s < 8; s++) { const x = marks[s] - pm * s / 8, y = marks[s + 1] - marks[s] - pm / 8, A = H.rev[s - 1]; A.n++; A.sx += x; A.sy += y; A.sxx += x * x; A.sxy += x * y; }
        }
        if (Math.abs(margin) >= 15) H.q3.final15++;
      }

      // players
      const lopsided = Math.abs(margin) >= 15;
      for (let side = 0; side < 2; side++) {
        const tid = tids[side];
        const rows = page.players.filter((p) => String(p.t) === tid && p.pred && num(p.pred.min) > 0);
        if (!rows.length) continue;
        const won = side === 0 ? margin > 0 : margin < 0;
        const sorted = [...rows].sort((a, b2) => num(b2.pred.min) - num(a.pred.min));
        const key3 = new Set(sorted.slice(0, 3).map((p) => String(p.id)));
        const key5 = new Set(sorted.slice(0, 5).map((p) => String(p.id)));
        let foulTrouble = false, rotation = false;
        const cands = [];
        let shootY2 = 0, shootA2 = 0, shootY3 = 0, shootA3 = 0;
        const shooters = [];
        for (const row of rows) {
          const pid = String(row.id);
          const bx = byPid.get(pid);
          const proj = num(row.pred.min);
          const act = bx ? num(bx.min) : 0;
          const pf = bx ? num(bx.pf) : 0;
          const bk = minBucket(proj);
          H.dnp[bk].n++;
          if (act <= 0) H.dnp[bk].k++;
          const role = ROLES.includes(row.role) ? row.role : "bench";
          const ptsAct = bx ? num(bx.pts) : 0;
          const dMin = act - proj, dPts = ptsAct - num(row.pred.pts);
          const bl = H.blow[role];
          if (lopsided) { const s = won ? bl.win : bl.lose; s.n++; s.min += dMin; s.pts += dPts; }
          else { bl.base.n++; bl.base.min += dMin; bl.base.pts += dPts; }
          if (act <= 0) { if (proj >= 24 && !lopsided) rotation = true; continue; }
          if (key5.has(pid) && pf >= 4 && !lopsided && proj - act >= 5) foulTrouble = true; // as in the simulation: 4+ fouls and 5+ minutes lost
          if (proj >= 15) {
            H.foul.playerGames++;
            { const lam = playerRates(pid, row.pos).pfPm * proj; let c = 0, t = Math.exp(-lam); for (let k = 0; k < 5; k++) { c += t; t *= lam / (k + 1); } H.foul.pred5 += 1 - c; }
            if (pf >= 6) { H.foul.pf6++; H.foul.n6++; H.foul.d6 += dMin; }
            else if (pf === 5) { H.foul.pf5++; H.foul.n5++; H.foul.d5 += dMin; }
            else if (!lopsided) { H.foul.n4++; H.foul.d4 += dMin; }
            H.exit.minDen += proj;
          }
          const cand = proj >= 15 && act < 0.6 * proj && !lopsided && pf < 5;
          if (cand) cands.push({ pid, pos: posKey(row.pos), frac: act / proj, key: key3.has(pid), lost: proj - act, bk, rel: (act - proj) / Math.max(proj, 8) });
          if (!cand && !lopsided && pf < 5) {
            const rel = (act - proj) / Math.max(proj, 8);
            const m = H.minN[bk]; m.n++; m.s += rel; m.ss += rel * rel;
            m.recent.push(rel); if (m.recent.length > 3000) m.recent.shift();
            if (proj >= 15 && Math.abs(act - proj) >= 15) rotation = true;
          }
          // usage / shooting overdispersion (rates as known before this game)
          if (act >= 10 && proj >= 5) {
            const r = playerRates(pid, row.pos);
            const t = targetsFor(row.pred, r);
            const e = (t.fg2a + t.tpa) * act / proj;
            const obs = num(bx.fga);
            if (e >= 3) { const X = obs - e; H.usage.a += X * X - e; H.usage.b += e * e; H.usage.n++; }
            const a3 = num(bx.tpa), m3 = num(bx.tpm), a2 = num(bx.fga) - a3, m2 = num(bx.fgm) - m3;
            shooters.push({ p2: r.p2, p3: t.p3, a2, m2, a3, m3 });
            shootY2 += m2 - r.p2 * a2; shootA2 += a2; shootY3 += m3 - t.p3 * a3; shootA3 += a3;
          }
        }
        // within-team shooting overdispersion (team-wide hot/cold removed) and team hot/cold
        const t2 = shootA2 ? shootY2 / shootA2 : 0, t3 = shootA3 ? shootY3 / shootA3 : 0;
        let expM = 0, actM = 0, fgaT = 0;
        for (const s of shooters) {
          const y2 = s.m2 - s.p2 * s.a2 - t2 * s.a2, y3 = s.m3 - s.p3 * s.a3 - t3 * s.a3;
          H.shot.a2 += y2 * y2 - s.p2 * (1 - s.p2) * s.a2; H.shot.b2 += s.a2 * s.a2;
          H.shot.a3 += y3 * y3 - s.p3 * (1 - s.p3) * s.a3; H.shot.b3 += s.a3 * s.a3;
          expM += s.p2 * s.a2 + 1.5 * s.p3 * s.a3; actM += s.m2 + 1.5 * s.m3; fgaT += s.a2 + s.a3;
        }
        if (fgaT >= 40) {
          const d = (actM - expM) / fgaT;
          H.shoot.teamGames++;
          if (d >= 0.05) H.shoot.hot++;
          if (d <= -0.05) H.shoot.cold++;
        }
        H.team.games++;
        if (foulTrouble) H.team.foulTrouble++;
        if (rotation) H.team.rotation++;
        // exit candidates: who absorbed the lost minutes (same position vs all teammates)
        if (cands.length) {
          const list = [];
          for (const c of cands) {
            let same = 0, all = 0;
            for (const row of rows) {
              const pid = String(row.id);
              if (pid === c.pid) continue;
              const bx = byPid.get(pid);
              const g = (bx ? num(bx.min) : 0) - num(row.pred.min);
              if (g <= 0) continue;
              all += g; if (posKey(row.pos) === c.pos) same += g;
            }
            list.push({ ...c, same, all });
          }
          pending.set(tid, list);
        }
      }
    }

    // update player and league rates with this game
    const season = num(box.season), pre = num(box.stype) === 1;
    const w = pre ? 0.3 : 1;
    for (const p of box.players || []) {
      if (!p.id || !(num(p.min) > 0)) continue;
      const pid = String(p.id);
      let line = players.get(pid);
      if (!line) { line = emptyLine(); line.season = season; players.set(pid, line); }
      if (line.season !== season) { decayed(line, 0.6); line.season = season; }
      decayed(line, 0.965);
      const a3 = num(p.tpa), m3 = num(p.tpm);
      const add = { g: 1, min: num(p.min), fg2m: num(p.fgm) - m3, fg2a: num(p.fga) - a3, tpm: m3, tpa: a3, ftm: num(p.ftm), fta: num(p.fta), tov: num(p.to), stl: num(p.stl), blk: num(p.blk), pf: num(p.pf), reb: num(p.reb), ast: num(p.ast) };
      for (const k of LINE_KEYS) line[k] += w * add[k];
      const L = league[posKey(p.pos)];
      decayed(L, 0.9995);
      for (const k of LINE_KEYS) L[k] += w * add[k];
    }
  }

  // ---------- what the simulator uses, as known now ----------
  function params() {
    const R = H.reg;
    const blend = (s, n, prior, k) => (s + prior * k) / (n + k);
    let regShift = 0, vh = 144, va = 144, cha = 0.2 * 144;
    if (R.n > 0) {
      const mh = R.sh / R.n, ma = R.sa / R.n;
      regShift = clamp(blend((R.sh + R.sa) / 2, R.n, 0, 50), -2, 2);
      vh = blend(R.shh - R.n * mh * mh, R.n, 144, 100); va = blend(R.saa - R.n * ma * ma, R.n, 144, 100);
      cha = blend(R.sha - R.n * mh * ma, R.n, 0.2 * 144, 100);
    }
    const pv = H.pace.n > 1 ? (H.pace.ss - H.pace.s * H.pace.s / H.pace.n) : 0;
    const paceSd = Math.sqrt(blend(pv, H.pace.n, 0.045 * 0.045, 50));
    const dnp = H.dnp.map((d, i) => blend(d.k, d.n, [0.3, 0.06, 0.02, 0.01][i], 50));
    const minSd = H.minN.map((m, i) => { const v = m.n > 1 ? m.ss - m.s * m.s / m.n : 0; return Math.sqrt(blend(v, m.n, [0.5, 0.3, 0.2, 0.12][i] ** 2, 50)); });
    // the counted shape of minutes surprises (not only their spread), centred so the projection stays the average
    const minRel = H.minN.map((m) => { if (m.recent.length < 200) return null; const mu = m.recent.reduce((a, b) => a + b, 0) / m.recent.length; return Float64Array.from(m.recent, (x) => x - mu); });
    const F = H.foul;
    const base4 = F.n4 ? F.d4 / F.n4 : 0;
    const fcut5 = clamp(blend(F.d5 - base4 * F.n5, F.n5, -3, 30), -15, 0);
    const fcut6 = clamp(blend(F.d6 - base4 * F.n6, F.n6, -6, 20), -20, 0);
    // real foul counts bunch below 5 more than a Poisson count would (players avoid the 5th and 6th)
    const foulScale = clamp(blend(F.pf5 + F.pf6, F.pred5, 1, 200), 0.3, 1);
    const E = H.exit;
    const exitPerMin = blend(E.events, E.minDen, 0.0004, 20000);
    const fracs = E.fracs.length >= 20 ? E.fracs.slice() : [0.1, 0.2, 0.3, 0.4, 0.5, 0.3, 0.2, 0.45];
    const samePos = clamp(blend(E.sameGain, E.allGain, 0.5, 200), 0.2, 0.9);
    const usageCV = Math.sqrt(clamp(blend(H.usage.a, H.usage.b, 0.06, 2000), 0.005, 0.25));
    const shootSd2 = Math.sqrt(clamp(blend(H.shot.a2, H.shot.b2, 0.001, 20000), 0, 0.01));
    const shootSd3 = Math.sqrt(clamp(blend(H.shot.a3, H.shot.b3, 0.001, 10000), 0, 0.01));
    const blowRole = {};
    for (const r of ROLES) {
      const b = H.blow[r];
      const bm = b.base.n ? b.base.min / b.base.n : 0, bp = b.base.n ? b.base.pts / b.base.n : 0;
      blowRole[r] = {
        win: { min: blend(b.win.min - bm * b.win.n, b.win.n, 0, 30), pts: blend(b.win.pts - bp * b.win.n, b.win.n, 0, 30), n: b.win.n },
        lose: { min: blend(b.lose.min - bm * b.lose.n, b.lose.n, 0, 30), pts: blend(b.lose.pts - bp * b.lose.n, b.lose.n, 0, 30), n: b.lose.n },
      };
    }
    // lead after three quarters that is as common as a final margin of 15+
    let q3thr = 15;
    if (H.q3.n >= 100) {
      const target = H.q3.final15 / H.q3.n;
      let acc = 0;
      for (let l = 60; l >= 0; l--) { acc += H.q3.hist[l]; if (acc / H.q3.n >= target) { q3thr = l; break; } }
    }
    // score effects: how much of its lead over the projection, at each 6-minute mark, a team gives back in the next six minutes
    const revert = H.rev.map((a) => { if (a.n < 30) return 0; const vx = a.sxx - a.sx * a.sx / a.n; const b = vx > 0 ? (a.sxy - a.sx * a.sy / a.n) / vx : 0; return clamp(b * a.n / (a.n + 100), -0.3, 0.1); });
    const hist = {
      games: H.paged,
      byMargin: H.mb.map((b, i) => ({ bucket: MARGIN_BUCKETS[i], n: b.n, close: b.n ? b.close / b.n : null, favBlow: b.n ? b.favBlow / b.n : null, dogBlow: b.n ? b.dogBlow / b.n : null, ot: b.n ? b.ot / b.n : null })),
      teamGames: H.team.games,
      hot: H.shoot.teamGames ? H.shoot.hot / H.shoot.teamGames : null,
      cold: H.shoot.teamGames ? H.shoot.cold / H.shoot.teamGames : null,
      shootGames: H.shoot.teamGames,
      fast: H.pace.n ? H.pace.fast / H.pace.n : null,
      slow: H.pace.n ? H.pace.slow / H.pace.n : null,
      paceGames: H.pace.n,
      keyExit: H.team.games ? E.keyEvents / H.team.games : null,
      foulTrouble: H.team.games ? H.team.foulTrouble / H.team.games : null,
      rotation: H.team.games ? H.team.rotation / H.team.games : null,
    };
    return {
      regShift, cov: { hh: vh, aa: va, ha: cha }, regGames: R.n,
      paceSd, paceGames: H.pace.n,
      dnp, minSd, minRel, fcut5, fcut6, foulScale, foulGames: { pf5: F.n5, pf6: F.n6 },
      exitPerMin, exitEvents: E.events, exitFracs: fracs, samePos,
      usageCV, shootSd2, shootSd3,
      blowRole, q3thr, revert,
      // share of games within 3 points at the end of regulation that were actually tied (went to overtime)
      otShare: blend(H.tie.ot, H.tie.close3, 0.3, 50), otGames: H.tie.close3,
      hist,
    };
  }

  return { absorb, params, playerRates, H };
}
