// Monte Carlo game engine: thousands of internally consistent versions of one game.
//
// Inputs: the model's projection of the game (team points, pace, each player's minutes,
// points, rebounds, assists, threes, steals, blocks), each player's shooting and
// per-minute rates as known before tip-off (scripts/lib/simhist.mjs), and the
// scenario rates counted from the back-test (in-game exits, foul trouble, rotation
// changes, blowout minutes, pace and shooting spreads). Never betting lines.
//
// One simulated game is played quarter by quarter:
//   1. game-level draws: possessions (pace), each team's shooting temperature
//      (hot / cold), each player's usage and shooting form for the night, minutes
//      noise, coach's-decision DNPs, in-game exits (with the time he leaves),
//      fouls (5 = foul trouble, 6 = fouled out, minutes cut by the counted amount).
//   2. each quarter: 60 player-minutes per team (12 per player at most) shared out
//      from those draws; lost minutes go first to the same position (share counted
//      from real exits). Before the 4th quarter a big lead triggers the learned
//      blowout minutes (starters rested, bench up) on both sides.
//   3. each quarter: team shots, free-throw trips and turnovers from possessions;
//      shared between the players on the floor by usage x minutes x form (so a hot
//      night for one player takes shots from teammates); makes from each player's
//      own percentages x the team's temperature; rebounds from both teams' misses;
//      assists from made shots; steals from the other team's turnovers; blocks from
//      its missed twos.
//   4. tied after regulation: 5-minute overtimes with the available players
//      (fouled-out and injured players cannot return), until someone wins.
// Every box score adds up: minutes = 240 per team (+25 per overtime), player points =
// team points = sum of quarter points.
import { S, STATS, minBucket, targetsFor } from "./simhist.mjs";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const ST = Object.fromEntries(STATS.map((k, i) => [k, i]));
export const ORB = 0.25; // share of missed shots the shooting team rebounds (league level; player rebound totals are still the projection's)

// Flags: scenario bits per simulated game
export const FLAG = {
  close: 1 << 0, blowH: 1 << 1, blowA: 1 << 2, ot: 1 << 3,
  injH: 1 << 4, injA: 1 << 5, foulH: 1 << 6, foulA: 1 << 7,
  hotH: 1 << 8, coldH: 1 << 9, hotA: 1 << 10, coldA: 1 << 11,
  fast: 1 << 12, slow: 1 << 13, rotH: 1 << 14, rotA: 1 << 15,
};

// src: { id, home, away, pace, hs, as, players:[{ id, n, pos, role, side, min, pts, reb, ast, tpm, tpa, stl?, blk?, blow?, q? }] }
export function buildGame(src, rateOf, params) {
  const rows = src.players.filter((p) => num(p.min) > 0.5);
  const P = rows.length;
  const G = {
    id: src.id, home: src.home, away: src.away, P,
    pace: num(src.pace) > 60 ? num(src.pace) : 99,
    proj: [num(src.hs), num(src.as)],
    side: new Int8Array(P), ids: [], names: [], pos: [], role: [], q: [],
    projMin: new Float64Array(P), bucket: new Int8Array(P), tgt: [],
    fg2a: new Float64Array(P), tpa: new Float64Array(P), p2: new Float64Array(P), p3: new Float64Array(P),
    pft: new Float64Array(P), fta: new Float64Array(P), tov: new Float64Array(P), reb: new Float64Array(P),
    ast: new Float64Array(P), stl: new Float64Array(P), blk: new Float64Array(P), pfPm: new Float64Array(P),
    pts: new Float64Array(P), tpaShare: new Float64Array(P),
    blowWin: new Float64Array(P), blowLose: new Float64Array(P), blowSrc: [],
    teams: [],
    qf: src.qf || [[1, 1, 1, 1], [1, 1, 1, 1]],
  };
  rows.forEach((row, i) => {
    const r = rateOf(row);
    const t = targetsFor(row, r);
    G.side[i] = row.side; G.ids.push(String(row.id)); G.names.push(row.n || ""); G.pos.push(row.pos || "F");
    G.role.push(row.role || "bench"); G.q.push(!!row.q);
    G.projMin[i] = t.min; G.bucket[i] = minBucket(t.min);
    G.fg2a[i] = t.fg2a; G.tpa[i] = t.tpa; G.p2[i] = t.p2; G.p3[i] = t.p3; G.pft[i] = t.pft; G.fta[i] = t.fta;
    G.tov[i] = t.tov; G.reb[i] = t.reb; G.ast[i] = t.ast; G.stl[i] = t.stl; G.blk[i] = t.blk; G.pfPm[i] = t.pfPm; G.pts[i] = t.pts;
    const role = params.blowRole[row.role] ? row.role : "bench";
    if (row.blow && row.blow.win != null) { G.blowWin[i] = num(row.blow.win); G.blowLose[i] = num(row.blow.lose); G.blowSrc.push("player"); }
    else { G.blowWin[i] = params.blowRole[role].win.min; G.blowLose[i] = params.blowRole[role].lose.min; G.blowSrc.push("role"); }
  });
  for (let side = 0; side < 2; side++) {
    const idx = []; for (let i = 0; i < P; i++) if (G.side[i] === side) idx.push(i);
    // scale attempts so the players add up to the team's regulation projection
    const target = G.proj[side] + params.regShift;
    let sum = 0; for (const i of idx) sum += G.pts[i];
    const k = sum > 0 ? clamp(target / sum, 0.8, 1.25) : 1;
    for (const i of idx) { G.fg2a[i] *= k; G.tpa[i] *= k; G.fta[i] *= k; G.pts[i] *= k; }
    const base = { FGA: 0, FTA: 0, TOV: 0, REB: 0, AST: 0, STL: 0, BLK: 0, FGM: 0, miss: 0, miss2: 0, pts: 0, fgPts: 0 };
    for (const i of idx) {
      const fga = G.fg2a[i] + G.tpa[i];
      G.tpaShare[i] = fga > 0 ? G.tpa[i] / fga : 0;
      base.FGA += fga; base.FTA += G.fta[i]; base.TOV += G.tov[i]; base.REB += G.reb[i]; base.AST += G.ast[i];
      base.STL += G.stl[i]; base.BLK += G.blk[i];
      base.FGM += G.fg2a[i] * G.p2[i] + G.tpa[i] * G.p3[i];
      base.miss += G.fg2a[i] * (1 - G.p2[i]) + G.tpa[i] * (1 - G.p3[i]);
      base.miss2 += G.fg2a[i] * (1 - G.p2[i]);
      base.fgPts += 2 * G.fg2a[i] * G.p2[i] + 3 * G.tpa[i] * G.p3[i];
      base.pts += G.pts[i];
    }
    base.shotPoss = Math.max(1, base.FGA - base.miss * ORB);
    const byMin = [...idx].sort((a, b) => G.projMin[b] - G.projMin[a]);
    G.teams.push({ idx, base, key3: byMin.slice(0, 3), key5: byMin.slice(0, 5), target });
  }
  for (let side = 0; side < 2; side++) {
    const B = G.teams[side].base, O = G.teams[1 - side].base;
    G.teams[side].dreb = O.miss > 0 ? clamp((B.REB - B.miss * ORB) / (O.miss * (1 - ORB)), 0.3, 1.3) : 0.75;
  }
  return G;
}

// per-minute weights used to share team counts between the players on the floor
function perMin(G) {
  const P = G.P;
  const w = { fga: new Float64Array(P), fta: new Float64Array(P), tov: new Float64Array(P), reb: new Float64Array(P), ast: new Float64Array(P), stl: new Float64Array(P), blk: new Float64Array(P) };
  for (let i = 0; i < P; i++) {
    const m = Math.max(1, G.projMin[i]);
    w.fga[i] = (G.fg2a[i] + G.tpa[i]) / m; w.fta[i] = G.fta[i] / m; w.tov[i] = G.tov[i] / m;
    w.reb[i] = G.reb[i] / m; w.ast[i] = G.ast[i] / m; w.stl[i] = G.stl[i] / m; w.blk[i] = G.blk[i] / m;
  }
  return w;
}

function allocate(b, idx, total, cap, out) {
  // water-filling: shares proportional to b, nobody above cap, exact total
  const n = idx.length;
  const fixed = new Uint8Array(n);
  let remaining = total;
  for (let iter = 0; iter < 8; iter++) {
    let s = 0;
    for (let j = 0; j < n; j++) if (!fixed[j]) s += b[idx[j]];
    if (s <= 0) break;
    const k = remaining / s;
    let over = false;
    for (let j = 0; j < n; j++) {
      if (fixed[j]) continue;
      const x = b[idx[j]] * k;
      if (x > cap) { out[idx[j]] = cap; fixed[j] = 1; remaining -= cap; over = true; }
      else out[idx[j]] = x;
    }
    if (!over) return;
  }
  // degenerate (too few players): spread what is left evenly over everyone not capped
  let s = 0; for (let j = 0; j < n; j++) s += out[idx[j]];
  if (s < total - 1e-6) { const k = total / Math.max(1e-9, s); for (let j = 0; j < n; j++) out[idx[j]] *= k; }
}

// opt: { shock: { l11, l21, l22 } | null (points), blow: { pH, pA } | null (centering), regOnly }
export function simulate(G, params, N, rng, opt = {}) {
  const P = G.P;
  const w = perMin(G);
  const out = {
    N, P,
    hs: new Int16Array(N), as: new Int16Array(N), hq: new Int16Array(N * 4), aq: new Int16Array(N * 4),
    ot: new Uint8Array(N), phi: new Float32Array(N), flags: new Uint32Array(N),
    efgD: new Float32Array(N * 2), exitKey: new Int16Array(N * 2), blowState: new Int8Array(N),
    pl: new Float32Array(N * P * S),
  };
  const T = G.teams;
  const shock = opt.shock;
  const fgPts = [Math.max(20, T[0].base.fgPts), Math.max(20, T[1].base.fgPts)];
  const blowC = new Float64Array(P);
  if (opt.blow) for (let i = 0; i < P; i++) {
    const own = G.side[i] === 0 ? [opt.blow.pH, opt.blow.pA] : [opt.blow.pA, opt.blow.pH]; // [P(own team leads big), P(trails big)]
    blowC[i] = own[0] * G.blowWin[i] + own[1] * G.blowLose[i];
  }
  // scratch
  const g = new Float64Array(P), sp2 = new Float64Array(P), sp3 = new Float64Array(P), m = new Float64Array(P);
  const exitT = new Float64Array(P), pf = new Int8Array(P), ev = new Uint8Array(P), dnp = new Uint8Array(P);
  const bq = new Float64Array(P), xq = new Float64Array(P), nominal = new Float64Array(P);
  const acc = new Float64Array(P * S);
  const wt = new Float64Array(64), cnt = new Float64Array(64), cum = new Float64Array(64);
  const baseSh = opt.baseSh || [1, 1];
  const revert = opt.noRevert ? null : params.revert;
  const minScale = opt.minScale || [1, 1, 1, 1];
  const foulScale = params.foulScale == null ? 1 : params.foulScale;
  const tieRate = opt.tieRate || 0;
  const tmpA = new Float64Array(P);
  const posArr = G.pos;
  const { paceSd, minSd, dnp: dnpRate, exitPerMin, exitFracs, fcut5, fcut6, usageCV, shootSd2, shootSd3, samePos, q3thr } = params;

  function share(n, weights, idx, into) {
    // multinomial over idx with weights[] -> adds into acc column `into`
    const k = idx.length;
    for (let j = 0; j < k; j++) { wt[j] = weights[idx[j]]; cnt[j] = 0; }
    rng.multinom(n, wt, k, cnt);
    for (let j = 0; j < k; j++) if (cnt[j]) acc[idx[j] * S + into] += cnt[j];
    return cnt;
  }

  for (let s = 0; s < N; s++) {
    acc.fill(0);
    const phi = Math.exp(paceSd * rng.normal());
    let sh0 = 1, sh1 = 1;
    if (shock) {
      const z1 = rng.normal(), z2 = rng.normal();
      const dh = shock.l11 * z1, da = shock.l21 * z1 + shock.l22 * z2;
      sh0 = clamp(1 + dh / fgPts[0], 0.6, 1.4); sh1 = clamp(1 + da / fgPts[1], 0.6, 1.4);
    }
    const shT = [sh0, sh1];
    // game-level player draws
    for (let i = 0; i < P; i++) {
      g[i] = Math.exp(usageCV * rng.normal() - usageCV * usageCV / 2);
      sp2[i] = shootSd2 * rng.normal(); sp3[i] = shootSd3 * rng.normal();
      const pm = G.projMin[i];
      ev[i] = 0; dnp[i] = 0; exitT[i] = 99; pf[i] = 0;
      if (rng.next() < dnpRate[G.bucket[i]]) { m[i] = 0; dnp[i] = 1; ev[i] = 1; continue; }
      const bk = G.bucket[i], emp = params.minRel && params.minRel[bk];
      if (emp) m[i] = Math.max(0, pm * (1 + minScale[bk] * emp[Math.floor(rng.next() * emp.length)]));
      else { const sd = minSd[bk] * minScale[bk]; m[i] = pm * Math.exp(sd * rng.normal() - sd * sd / 2); }
      if (rng.next() < exitPerMin * pm) { exitT[i] = 48 * exitFracs[Math.floor(rng.next() * exitFracs.length)]; ev[i] = 2; }
      let f = rng.poisson(G.pfPm[i] * pm);
      if (f > 6) f = 6;
      if (f >= 5 && foulScale < 1 && rng.next() > foulScale) f = 4;
      pf[i] = f;
      if (f >= 6) { m[i] = Math.max(0, m[i] + fcut6); ev[i] = ev[i] || 3; }
      else if (f === 5) { m[i] = Math.max(0, m[i] + fcut5); ev[i] = ev[i] || 3; }
    }
    let score0 = 0, score1 = 0, blowState = 0;
    const effA = [0, 0], effE = [0, 0], fgaT = [0, 0];
    // regulation quarters + overtimes
    for (let q = 0; q < 14; q++) {
      const isOT = q >= 4;
      if (q === 4 && tieRate > 0) {
        // end-of-game tying play: real games within 3 points at the end go to overtime more often than
        // possession-by-possession play gives (fouling, tying threes); rate counted from finished games
        const d = score0 - score1, ad = Math.abs(d);
        if (ad >= 1 && ad <= 3 && rng.next() < tieRate) {
          const side = d > 0 ? 1 : 0, idx = T[side].idx;
          let tot = 0; for (const i of idx) tot += w.fga[i] * tmpA[i] * g[i];
          let u = rng.next() * tot, pick = idx[0];
          for (const i of idx) { u -= w.fga[i] * tmpA[i] * g[i]; if (u <= 0) { pick = i; break; } }
          const o = pick * S;
          if (ad === 3) { acc[o + ST.fga]++; acc[o + ST.fgm]++; acc[o + ST.tpa]++; acc[o + ST.tpm]++; }
          else if (ad === 2) { acc[o + ST.fga]++; acc[o + ST.fgm]++; }
          else { acc[o + ST.fta]++; acc[o + ST.ftm]++; }
          acc[o + ST.pts] += ad;
          if (side === 0) { score0 += ad; out.hq[s * 4 + 3] += ad; } else { score1 += ad; out.aq[s * 4 + 3] += ad; }
        }
      }
      if (isOT && score0 !== score1) break;
      const len = isOT ? 5 : 12;
      if (q === 3) {
        const lead = score0 - score1;
        blowState = lead >= q3thr ? 1 : lead <= -q3thr ? 2 : 0;
      }
      // minutes for this period
      for (let side = 0; side < 2; side++) {
        const idx = T[side].idx;
        if (!isOT) {
          const t0 = q * 12;
          for (const i of idx) {
            const avail = clamp((exitT[i] - t0) / 12, 0, 1);
            let base = m[i] / 4 * avail;
            let nom = G.projMin[i] / 4;
            if (q === 3) {
              let d = -blowC[i];
              if (blowState) {
                const leads = (blowState === 1) === (side === 0);
                d += leads ? G.blowWin[i] : G.blowLose[i];
              }
              base = Math.max(0, base + d * (base > 0 ? 1 : 0));
              nom = Math.max(0, nom + d);
            }
            bq[i] = base; nominal[i] = nom;
          }
          // minutes lost to events go first to the same position
          if (samePos > 0) {
            const lost = { G: 0, F: 0, C: 0 }, have = { G: 0, F: 0, C: 0 };
            for (const i of idx) {
              const p = posArr[i] in lost ? posArr[i] : "F";
              if (ev[i]) lost[p] += Math.max(0, nominal[i] - bq[i]); else have[p] += bq[i];
            }
            for (const i of idx) {
              if (ev[i]) continue;
              const p = posArr[i] in lost ? posArr[i] : "F";
              if (lost[p] > 0 && have[p] > 0) bq[i] += samePos * lost[p] * bq[i] / have[p];
            }
          }
          allocate(bq, idx, 60, 12, xq);

        } else {
          for (const i of idx) {
            const reg = acc[i * S + 0];
            bq[i] = exitT[i] < 48 || pf[i] >= 6 ? 0 : Math.pow(reg, 1.5);
          }
          let s2 = 0; for (const i of idx) s2 += bq[i];
          if (s2 <= 0) for (const i of idx) bq[i] = 1;
          allocate(bq, idx, 25, 5, xq);
        }
        for (const i of idx) acc[i * S + 0] += xq[i];
        // keep this period's minutes per player for the share step
        for (const i of idx) tmpA[i] = xq[i];
      }
      // counts per team
      const fgmQ = [0, 0], missQ = [0, 0], miss2Q = [0, 0], tovQ = [0, 0], ptsQ = [0, 0], orebQ = [0, 0];
      const scaleQ = phi * len / 48;
      const halves = isOT ? 1 : 2;
      for (let hf = 0; hf < halves; hf++) {
      // score effects (counted from real games): at each 6-minute mark the team ahead of its
      // projection scores a little less over the next six minutes
      let rv0 = 1, rv1 = 1;
      const seg = 2 * q + hf;
      if (!isOT && seg >= 1 && revert) {
        let pl = 0; for (let z = 0; z < seg; z++) { const qq = z >> 1; pl += (T[0].target * G.qf[0][qq] - T[1].target * G.qf[1][qq]) / 8; }
        const lr = (score0 + ptsQ[0] - score1 - ptsQ[1]) - pl, d = revert[seg - 1] * lr / 2;
        rv0 = clamp(1 + d / (fgPts[0] / 8), 0.7, 1.3); rv1 = clamp(1 - d / (fgPts[1] / 8), 0.7, 1.3);
      }
      const rvT = [rv0, rv1];
      for (let side = 0; side < 2; side++) {
        const idx = T[side].idx, B = T[side].base, sh = shT[side] * baseSh[side] * rvT[side];
        const k = idx.length;
        const scale = scaleQ * (isOT ? 1 : G.qf[side][q]) / halves;
        // possessions end in a turnover, a free-throw trip or a shot; fewer of one means more of the others
        const Etov = B.TOV * scale, Etrip = B.FTA * scale / 2, Eshot = B.shotPoss * scale;
        const nTov = rng.poisson(Etov), trips = rng.poisson(Etrip);
        const spf = Eshot + (Etov - nTov) + 0.9 * (Etrip - trips);
        let nPoss = Math.floor(spf); if (rng.next() < spf - nPoss) nPoss++;
        if (nPoss < 0) nPoss = 0;
        // shooters on the floor: usage x minutes x form tonight
        let tot = 0;
        for (let j = 0; j < k; j++) { const i = idx[j]; tot += w.fga[i] * tmpA[i] * g[i]; cum[j] = tot; }
        if (tot > 0) for (let pz = 0; pz < nPoss; pz++) {
          for (;;) { // one shot possession, extended by offensive rebounds
            const u = rng.next() * tot;
            let j = 0; while (j < k - 1 && cum[j] < u) j++;
            const i = idx[j], o = i * S;
            const three = rng.next() < G.tpaShare[i];
            const p = three ? clamp(G.p3[i] * sh + sp3[i], 0.05, 0.7) : clamp(G.p2[i] * sh + sp2[i], 0.15, 0.85);
            const made = rng.next() < p;
            acc[o + ST.fga]++; fgaT[side]++;
            effE[side] += three ? 1.5 * G.p3[i] : G.p2[i];
            if (three) acc[o + ST.tpa]++;
            if (made) {
              const v = three ? 3 : 2;
              acc[o + ST.fgm]++; acc[o + ST.pts] += v; if (three) acc[o + ST.tpm]++;
              ptsQ[side] += v; fgmQ[side]++; effA[side] += three ? 1.5 : 1;
              break;
            }
            missQ[side]++; if (!three) miss2Q[side]++;
            if (rng.next() < ORB) { orebQ[side]++; continue; }
            break;
          }
        }
        // free throws (trips of two)
        for (const i of idx) bq[i] = w.fta[i] * tmpA[i] * g[i];
        for (let j = 0; j < k; j++) { wt[j] = bq[idx[j]]; cnt[j] = 0; }
        rng.multinom(trips, wt, k, cnt);
        for (let j = 0; j < k; j++) {
          if (!cnt[j]) continue;
          const i = idx[j], a = 2 * cnt[j], made = rng.binom(a, G.pft[i]), o = i * S;
          acc[o + ST.fta] += a; acc[o + ST.ftm] += made; acc[o + ST.pts] += made; ptsQ[side] += made;
        }
        // turnovers
        for (const i of idx) bq[i] = w.tov[i] * tmpA[i];
        share(nTov, bq, idx, ST.tov);
        tovQ[side] += nTov;
      }
      } // halves
      for (let side = 0; side < 2; side++) {
        const idx = T[side].idx, B = T[side].base, O = T[1 - side].base;

        // rebounds: own offensive rebounds + a share of the other team's misses it did not rebound
        const dAvail = missQ[1 - side] - orebQ[1 - side];
        const c = T[side].dreb;
        const dreb = c <= 1 ? rng.binom(dAvail, c) : dAvail + rng.poisson((c - 1) * dAvail);
        for (const i of idx) bq[i] = w.reb[i] * tmpA[i];
        share(orebQ[side] + dreb, bq, idx, ST.reb);
        const astRate = B.FGM > 0 ? clamp(B.AST / B.FGM, 0, 0.9) : 0;
        for (const i of idx) bq[i] = w.ast[i] * tmpA[i];
        share(rng.binom(fgmQ[side], astRate), bq, idx, ST.ast);
        const stlRate = O.TOV > 0 ? clamp(B.STL / O.TOV, 0, 0.9) : 0;
        for (const i of idx) bq[i] = w.stl[i] * tmpA[i];
        share(rng.binom(tovQ[1 - side], stlRate), bq, idx, ST.stl);
        const blkRate = O.miss2 > 0 ? clamp(B.BLK / O.miss2, 0, 0.6) : 0;
        for (const i of idx) bq[i] = w.blk[i] * tmpA[i];
        share(rng.binom(miss2Q[1 - side], blkRate), bq, idx, ST.blk);
      }
      score0 += ptsQ[0]; score1 += ptsQ[1];
      if (q < 4) { out.hq[s * 4 + q] = ptsQ[0]; out.aq[s * 4 + q] = ptsQ[1]; }
      else out.ot[s]++;
      if (q === 13 && score0 === score1) { if (rng.next() < 0.5) score0++; else score1++; } // practically never
    }
    // write the box score
    for (let i = 0; i < P; i++) {
      acc[i * S + ST.pf] = pf[i];
      const o = (s * P + i) * S;
      for (let k = 0; k < S; k++) out.pl[o + k] = acc[i * S + k];
    }
    // repair the (practically impossible) forced overtime point
    out.hs[s] = score0; out.as[s] = score1; out.phi[s] = phi; out.blowState[s] = blowState;
    // flags
    let f = 0;
    const mg = score0 - score1;
    if (Math.abs(mg) <= 5) f |= FLAG.close;
    if (mg >= 15) f |= FLAG.blowH;
    if (mg <= -15) f |= FLAG.blowA;
    if (out.ot[s]) f |= FLAG.ot;
    if (phi >= 1.06) f |= FLAG.fast;
    if (phi <= 0.94) f |= FLAG.slow;
    for (let side = 0; side < 2; side++) {
      const d = fgaT[side] ? (effA[side] - effE[side]) / fgaT[side] : 0;
      out.efgD[s * 2 + side] = d;
      if (d >= 0.05) f |= side ? FLAG.hotA : FLAG.hotH;
      if (d <= -0.05) f |= side ? FLAG.coldA : FLAG.coldH;
      let ek = -1;
      for (const i of T[side].key3) if (ev[i] === 2) { ek = i; break; }
      out.exitKey[s * 2 + side] = ek;
      if (ek >= 0) f |= side ? FLAG.injA : FLAG.injH;
      for (const i of T[side].key5) if (pf[i] >= 5) { f |= side ? FLAG.foulA : FLAG.foulH; break; }
      const lops = Math.abs(mg) >= 15;
      let rot = false;
      for (const i of T[side].idx) {
        if (G.projMin[i] < 10) continue;
        if (dnp[i]) { rot = true; break; }
        if (!lops && ev[i] !== 2 && pf[i] < 5 && Math.abs(acc[i * S] - G.projMin[i]) >= 10) { rot = true; break; }
      }
      if (rot) f |= side ? FLAG.rotA : FLAG.rotH;
    }
    out.flags[s] = f;
  }
  return out;
}

// pilot check of the minutes spread: the engine adds spread of its own when it shares out
// minutes lost to events, so the drawn noise is scaled down until ordinary games show the
// counted spread (params.minSd, by projected-minute bucket)
export function minutesScale(G, pilot, params) {
  const n = pilot.N, P = G.P;
  const acc = [0, 1, 2, 3].map(() => ({ n: 0, ss: 0 }));
  for (let s = 0; s < n; s++) {
    if (Math.abs(pilot.hs[s] - pilot.as[s]) >= 15 || pilot.ot[s]) continue;
    for (let i = 0; i < P; i++) {
      const o = (s * P + i) * S, m = pilot.pl[o + ST.min];
      if (m <= 0 || pilot.pl[o + ST.pf] >= 5) continue;
      const rel = (m - G.projMin[i]) / Math.max(G.projMin[i], 8), a = acc[G.bucket[i]];
      a.n++; a.ss += rel * rel;
    }
  }
  return acc.map((a, b) => (a.n < 50 ? 1 : clamp(params.minSd[b] / Math.sqrt(a.ss / a.n), 0.3, 1)));
}

// sum of regulation quarters for team side
export function regPts(out, s, side) {
  const q = side ? out.aq : out.hq;
  return q[s * 4] + q[s * 4 + 1] + q[s * 4 + 2] + q[s * 4 + 3];
}

// calibrated team shooting temperature: empirical covariance of regulation scores minus what
// the engine already produces without it (measured on a pilot run of the same game)
// chance of a tying play for games within 3 at the end of regulation, so that overtime is as common
// (relative to close finishes) as in finished games
export function tieRateFor(params, pilot) {
  let p0 = 0, p3 = 0;
  for (let s = 0; s < pilot.N; s++) { const d = Math.abs(regPts(pilot, s, 0) - regPts(pilot, s, 1)); if (d === 0) p0++; if (d <= 3) p3++; }
  if (p3 <= p0 || !params.otShare) return 0;
  return clamp((params.otShare * p3 - p0) / (p3 - p0), 0, 0.9);
}

export function regStats(pilot) {
  const n = pilot.N;
  let mh = 0, ma = 0;
  for (let s = 0; s < n; s++) { mh += regPts(pilot, s, 0); ma += regPts(pilot, s, 1); }
  mh /= n; ma /= n;
  let vh = 0, va = 0, c = 0;
  for (let s = 0; s < n; s++) { const a = regPts(pilot, s, 0) - mh, b = regPts(pilot, s, 1) - ma; vh += a * a; va += b * b; c += a * b; }
  return { mh, ma, vh: vh / (n - 1), va: va / (n - 1), c: c / (n - 1) };
}

// intr (optional): the engine's own regulation spread to use instead of the pilot's
export function shockFor(params, pilot, G, intr = null) {
  const n = pilot.N;
  const st = regStats(pilot);
  const { mh, ma } = st;
  const { vh, va, c } = intr || st;
  const E = params.cov;
  let sh = Math.max(4, E.hh - vh), sa = Math.max(4, E.aa - va), sc = E.ha - c;
  const lim = 0.9 * Math.sqrt(sh * sa);
  sc = clamp(sc, -lim, lim);
  const l11 = Math.sqrt(sh), l21 = sc / l11, l22 = Math.sqrt(Math.max(1e-6, sa - l21 * l21));
  let pH = 0, pA = 0;
  for (let s = 0; s < n; s++) { if (pilot.blowState[s] === 1) pH++; else if (pilot.blowState[s] === 2) pA++; }
  const fg = [Math.max(20, G.teams[0].base.fgPts), Math.max(20, G.teams[1].base.fgPts)];
  const baseSh = [clamp(1 + (G.teams[0].target - mh) / fg[0], 0.85, 1.15), clamp(1 + (G.teams[1].target - ma) / fg[1], 0.85, 1.15)];
  return { baseSh, shock: { l11, l21, l22 }, intrinsic: { vh, va, c }, empirical: { hh: E.hh, aa: E.aa, ha: E.ha }, blow: { pH: pH / n, pA: pA / n } };
}
