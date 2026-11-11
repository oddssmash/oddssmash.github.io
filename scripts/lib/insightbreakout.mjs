// Breakout watch (display only) and the back-tests behind it and behind the trust meter.
// One chronological pass over finished games; every number for a game uses only earlier games.
import { r1, r2, r3, mean, sampleLabel } from "./insightutil.mjs";

const JUMP_BUCKETS = [
  { k: "control", label: "projected within 2 minutes of his recent average", lo: -2, hi: 2 },
  { k: "4-6", label: "projected 4-6 minutes above", lo: 4, hi: 6 },
  { k: "6-10", label: "projected 6-10 minutes above", lo: 6, hi: 10 },
  { k: "10+", label: "projected 10+ minutes above", lo: 10, hi: Infinity },
];
const bucketOf = (j) => JUMP_BUCKETS.find((b) => j >= b.lo && j < b.hi) || null;

const HOT = { last: 5, minPrior: 15, longWin: 20, ptsUp: 5, minFlat: 3 };

function hotStreak(apps) {
  if (apps.length < HOT.minPrior) return null;
  const last = apps.slice(-HOT.last);
  const long = apps.slice(-(HOT.last + HOT.longWin), -HOT.last);
  const lp = mean(last.map((x) => x.pts)), lm = mean(last.map((x) => x.min));
  const gp = mean(long.map((x) => x.pts)), gm = mean(long.map((x) => x.min));
  return { lastPts: lp, lastMin: lm, longPts: gp, longMin: gm, longN: long.length, hot: lp - gp >= HOT.ptsUp && Math.abs(lm - gm) < HOT.minFlat };
}

export function chronoPass(past) {
  const logs = new Map(); // pid -> appearances [{date, gid, t, st, min, pts}]
  const jump = Object.fromEntries(JUMP_BUCKETS.map((b) => [b.k, { n: 0, hit: 0, projJump: 0, actJump: 0 }]));
  const hot = { n: 0, vsLast: 0, vsLong: 0, vsModel: 0, aboveLast: 0, absModel: 0 };
  // trust persistence
  const typ = new Map(); // pts bucket -> [sumErr, n]
  const perr = new Map(); // pid -> [{e, t}]
  const trustNext = { "reads well": [0, 0, 0], typical: [0, 0, 0], "keeps missing": [0, 0, 0] };
  const teamTyp = [0, 0];
  const terr = new Map();
  const teamNext = { "reads well": [0, 0, 0], typical: [0, 0, 0], "keeps missing": [0, 0, 0] };
  const label = (ratio) => (ratio <= 0.85 ? "reads well" : ratio >= 1.2 ? "keeps missing" : "typical");

  for (const g of past) {
    const live = g.stype !== 1;
    for (const p of g.players) {
      const apps = logs.get(p.id) || [];
      if (live && p.pmin != null && apps.length >= 5) {
        const last5 = apps.slice(-5);
        const rMin = mean(last5.map((x) => x.min));
        const j = p.pmin - rMin;
        const b = bucketOf(j);
        if (b) {
          const s = jump[b.k];
          s.n++; s.projJump += j; s.actJump += p.min - rMin;
          if (b.k === "control" ? Math.abs(p.min - rMin) < 3 : p.min >= rMin + 3) s.hit++;
        }
        const h = hotStreak(apps);
        if (h && h.hot && p.min > 0) {
          hot.n++; hot.vsLast += p.pts - h.lastPts; hot.vsLong += p.pts - h.longPts; hot.vsModel += p.pts - p.ppts;
          hot.absModel += Math.abs(p.pts - p.ppts);
          if (p.pts >= h.lastPts) hot.aboveLast++;
        }
      }
      // trust persistence (players projected 10+ minutes who played)
      if (live && p.ppts != null && p.pmin >= 10 && p.min > 0) {
        const bk = Math.min(12, Math.floor(p.ppts / 3));
        const tb = typ.get(bk);
        const t = tb && tb[1] >= 30 ? tb[0] / tb[1] : null;
        const e = Math.abs(p.pts - p.ppts);
        const hist = perr.get(p.id) || [];
        const recent = hist.slice(-15);
        if (t != null && recent.length >= 8) {
          const ratio = mean(recent.map((x) => x.e)) / mean(recent.map((x) => x.t));
          const acc = trustNext[label(ratio)];
          acc[0] += e; acc[1] += t; acc[2]++;
        }
        if (t != null) { hist.push({ e, t }); perr.set(p.id, hist); }
        const cur = typ.get(bk) || [0, 0];
        cur[0] += e; cur[1]++; typ.set(bk, cur);
      }
      if (p.min > 0) { apps.push({ date: g.date, gid: g.id, t: p.t, st: p.st, min: p.min, pts: p.pts }); logs.set(p.id, apps); }
    }
    if (live) {
      for (const t of g.teams) {
        const e = Math.abs(t.act - t.pred);
        const tt = teamTyp[1] >= 200 ? teamTyp[0] / teamTyp[1] : null;
        const hist = terr.get(t.tid) || [];
        const recent = hist.slice(-15);
        if (tt != null && recent.length >= 8) {
          const ratio = mean(recent.map((x) => x.e)) / mean(recent.map((x) => x.t));
          const acc = teamNext[label(ratio)];
          acc[0] += e; acc[1] += tt; acc[2]++;
        }
        if (tt != null) { hist.push({ e, t: tt }); terr.set(t.tid, hist); }
        teamTyp[0] += e; teamTyp[1]++;
      }
    }
  }
  const jumpEvidence = JUMP_BUCKETS.map((b) => {
    const s = jump[b.k];
    return { k: b.k, label: b.label, games: s.n, sample: sampleLabel(s.n), hitRate: s.n ? r3(s.hit / s.n) : null, avgProjJump: s.n ? r1(s.projJump / s.n) : null, avgActualJump: s.n ? r1(s.actJump / s.n) : null };
  });
  const persist = (o) => Object.entries(o).map(([k, [e, t, n]]) => ({ label: k, games: n, nextGameRatio: n ? r2(e / t) : null }));
  return {
    logs,
    evidence: {
      minutes: {
        rule: "Recent average = his last 5 games played. A jump bucket counts as a hit when he really played 3+ minutes above that average (for the control row: within 3 minutes). Back-test projections are the tip-off track (they knew the inactive list and starters); tonight's rows are made earlier, so expect somewhat lower hit rates.",
        buckets: jumpEvidence,
      },
      hotStreak: {
        rule: `Hot streak = last ${HOT.last} games' points ${HOT.ptsUp}+ above his previous ${HOT.longWin} games with minutes within ${HOT.minFlat} (needs ${HOT.minPrior}+ earlier games).`,
        games: hot.n, sample: sampleLabel(hot.n),
        nextVsStreak: hot.n ? r1(hot.vsLast / hot.n) : null,
        nextVsLonger: hot.n ? r1(hot.vsLong / hot.n) : null,
        nextVsProjection: hot.n ? r1(hot.vsModel / hot.n) : null,
        matchedStreak: hot.n ? r3(hot.aboveLast / hot.n) : null,
        projectionMAE: hot.n ? r2(hot.absModel / hot.n) : null,
        t: hot.n
          ? `In ${hot.n} games right after a hot streak, players scored ${Math.abs(hot.vsLast / hot.n).toFixed(1)} points ${hot.vsLast >= 0 ? "above" : "below"} their streak average and ${Math.abs(hot.vsLong / hot.n).toFixed(1)} ${hot.vsLong >= 0 ? "above" : "below"} their longer average; they matched or beat the streak ${(100 * hot.aboveLast / hot.n).toFixed(0)}% of the time. Against the projection they were ${(hot.vsModel / hot.n).toFixed(1)} on average.`
          : null,
      },
    },
    trustPersistence: {
      players: persist(trustNext), teams: persist(teamNext),
      rule: "Label from the previous 15 projected games (8+ needed): error divided by the typical error for similar projections, with the same thresholds as the trust meter (0.85 / 1.2). nextGameRatio = the following game's error over typical. If the labels carried real information, 'keeps missing' would stay well above 1 and 'reads well' well below. 'Typical' here is the league's running error by projected points (3-point buckets) for players and the league's running team error, which approximates the model's own measure.",
    },
  };
}

export function buildBreakout(upcoming, logs, evidence, pregame, abbr) {
  const bucketHit = new Map(evidence.minutes.buckets.map((b) => [b.k, b]));
  const opp = [], match = [], hotList = [];
  const seen = new Set(); // each player once, at his next game (the list is soonest first)
  const order = [...upcoming].sort((a, b) => (a.d.date < b.d.date ? -1 : a.d.date > b.d.date ? 1 : 0));
  for (const { d } of order) {
    const pg = pregame?.[d.id]?.lineups || null;
    for (const t of d.teams) {
      const side = t.isHome ? "home" : "away";
      const lu = pg?.[side];
      const starters = lu && lu.status !== "none" ? new Set((lu.starters || []).map((s) => String(s.id))) : null;
      for (const p of t.players || []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if ((p.min || 0) < 12) continue;
        const apps = logs.get(p.id) || [];
        if (apps.length < 3) continue;
        const last5 = apps.slice(-5);
        const rMin = mean(last5.map((x) => x.min)), rPts = mean(last5.map((x) => x.pts));
        const starts = last5.filter((x) => x.st).length;
        const minJump = p.min - rMin, ptsJump = p.pts - rPts;
        const reasons = [];
        for (const o of t.out || []) {
          if (!((o.min || 0) >= 18 || o.star)) continue;
          const w = (p.wwD || []).find((x) => x.id === o.id);
          if (w && w.without?.n >= 3 && w.with?.n >= 3 && w.without.mpg - w.with.mpg >= 2) {
            reasons.push({ k: "teammateOut", id: o.id, t: `${o.n} is out: in ${w.without.n} games without him he played ${w.without.mpg} minutes and scored ${w.without.ppg} (with him: ${w.with.mpg} and ${w.with.ppg} in ${w.with.n}).`, n: w.without.n, small: w.without.n < 10 });
          } else if (o.g && p.pos && o.g === p.pos[0] && minJump >= 2) {
            reasons.push({ k: "teammateOut", id: o.id, t: `${o.n} (${(o.min || 0).toFixed(1)} minutes a game, same position group) is out.`, n: null });
          }
        }
        if (starters && starters.has(String(p.id)) && starts <= 1) {
          reasons.push({ k: "newStarter", t: `NBA.com lists him as ${lu.status === "expected" ? "an expected" : "a confirmed"} starter; he started ${starts} of his last ${last5.length} games.`, n: last5.length });
        }
        const ret = p.ix?.returning;
        if (ret && ret.beforeMin != null && ret.beforeMin >= rMin + 3) {
          reasons.push({ k: "minutesReturning", t: `Game ${ret.gameBack} back after missing ${ret.missed}; he played ${ret.beforeMin} minutes a game before the absence against ${rMin.toFixed(1)} in his last games. League curve for that absence: ${ret.curveMin >= 0 ? "+" : ""}${ret.curveMin} minutes against projection (${ret.curveGames} games).`, n: ret.curveGames });
        }
        // matchup edges count only for the part the projection really applies: the zone edge is listed
        // when the model applies 0.5+ points of it (it is often shown "on paper" but applied at 0)
        const zm = p.zm;
        let edge = 0;
        if (zm && zm.tag === "hot spot meets soft spot" && (zm.applied || 0) >= 0.5) { reasons.push({ k: "matchup", t: zm.txt, n: zm.n ? zm.n[1] : null }); edge += zm.applied; }
        const splitRows = (p.adj?.matchups || []).filter((m) => (m.pts || 0) >= 2 && !m.small);
        if ((p.adj?.split || 0) >= 2 && splitRows.length) {
          edge += p.adj.split;
          reasons.push({ k: "matchup", t: `Personal splits for tonight's situation: ${splitRows.slice(0, 2).map((m) => `${m.label || m.key} ${m.pts > 0 ? "+" : ""}${m.pts} points against his usual gap (${m.n} games)`).join("; ")}.`, n: splitRows[0].n });
        }
        const h = hotStreak(apps);
        const isOpp = minJump >= 4 || (minJump >= 2 && reasons.some((r) => r.k !== "matchup"));
        const b = bucketOf(minJump);
        const row = {
          gid: d.id, date: d.date, team: t.tid, opp: t.isHome ? d.away : d.home, id: p.id, n: p.n, pos: p.pos,
          proj: { min: p.min, pts: p.pts, reb: p.reb, ast: p.ast }, recent: { games: last5.length, min: r1(rMin), pts: r1(rPts), starts },
          minJump: r1(minJump), ptsJump: r1(ptsJump), matchupPts: edge ? r1(edge) : null,
          reasons,
          hot: h ? { hot: h.hot, lastPts: r1(h.lastPts), longPts: r1(h.longPts), longGames: h.longN } : null,
          backtest: b && b.k !== "control" ? { bucket: b.k, games: bucketHit.get(b.k).games, hitRate: bucketHit.get(b.k).hitRate } : null,
        };
        if (isOpp) {
          if (!reasons.some((r) => r.k !== "matchup")) reasons.push({ k: "rotation", t: `The projection gives him ${minJump.toFixed(1)} more minutes than his last ${last5.length} games; no single absence explains it (rotation share, recent role).`, n: last5.length });
          row.kind = "opportunity"; row.score = r2(minJump + 0.5 * Math.max(0, ptsJump));
          opp.push(row);
        } else if (edge >= 1 && ptsJump >= 0 && (!h || p.pts >= h.longPts)) {
          // ranked by the matchup part of the projection, not by the bounce-back from a cold last 5;
          // the projection must also reach his longer average (20 games before the last 5)
          row.kind = "matchup"; row.score = r2(edge); match.push(row);
        } else if (h && h.hot) {
          row.kind = "hotStreak"; row.score = r2(h.lastPts - h.longPts);
          row.reasons = [{ k: "hotStreak", t: `Scored ${h.lastPts.toFixed(1)} a game over his last 5 against ${h.longPts.toFixed(1)} in the ${h.longN} before, with about the same minutes. That is a scoring run, not a bigger role.` }];
          hotList.push(row);
        }
      }
    }
  }
  const top = (a, n) => a.sort((x, y) => y.score - x.score).slice(0, n);
  return {
    note: "Real opportunity = more minutes or a bigger role tonight, with the reason (teammate out, listed starter, minutes returning after an absence). Matchup edges raise expected scoring without more minutes: listed by the points the projection actually adds for the matchup (matchupPts), only when the projection also reaches his recent and longer averages. Hot streaks are listed separately: a scoring run with the same minutes, which the back-test says mostly fades. Each player appears once, for his next game; only players projected 12+ minutes with 3+ recent games.",
    evidence,
    opportunity: top(opp, 30),
    matchup: top(match, 15),
    hotStreaks: top(hotList, 15),
  };
}
