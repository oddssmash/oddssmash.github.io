// Prediction disagreement view (display only): the five rating systems, the published blend and,
// when public/data/sim exists, the simulation, side by side, with the main reason for the largest gap.
import fs from "node:fs";
import path from "node:path";
import { readJSON } from "./util.mjs";
import { r1, r2, r3, mean, median, sign, sampleLabel, fmtSigned } from "./insightutil.mjs";

const LABEL = {
  efficiency: "Recent efficiency", players: "Player build-up", elo: "Elo",
  adjusted: "Opponent-adjusted", luckAdjusted: "Luck-adjusted",
};
const OUTLIER_GAP = 4; // points from the median of the other four

// Back-test evidence from finished games: per system, how often the result landed on its side
// when it was the outlier, and accuracy when the systems agree vs disagree.
export function disagreementHistory(past) {
  const ks = Object.keys(LABEL);
  const per = Object.fromEntries(ks.map((k) => [k, { games: 0, mae: [], outlier: 0, sideRight: 0, gapSum: 0 }]));
  const bands = { agree: [], mid: [], split: [] };
  for (const g of past) {
    if (g.stype === 1 || !g.models) continue;
    const ms = ks.map((k) => g.models[k]).filter((x) => x != null);
    if (ms.length < 5) continue;
    const act = g.act.hs - g.act.as;
    const pub = g.pred.hs - g.pred.as;
    for (const k of ks) {
      const m = g.models[k];
      const others = ks.filter((o) => o !== k).map((o) => g.models[o]);
      const med = median(others);
      per[k].games++;
      per[k].mae.push(Math.abs(act - m));
      if (Math.abs(m - med) >= OUTLIER_GAP) {
        per[k].outlier++;
        per[k].gapSum += Math.abs(m - med);
        if (sign(act - med) === sign(m - med)) per[k].sideRight++;
      }
    }
    const spread = Math.max(...ms) - Math.min(...ms);
    const winnerCalled = sign(act) === sign(pub) ? 1 : 0;
    const split = ms.some((m) => m > 0) && ms.some((m) => m < 0);
    (split ? bands.split : spread < 4 ? bands.agree : bands.mid).push([winnerCalled, Math.abs(act - pub)]);
  }
  const band = (a, label) => ({ label, games: a.length, sample: sampleLabel(a.length), winnerAcc: a.length ? r3(mean(a.map((x) => x[0]))) : null, marginMAE: a.length ? r1(mean(a.map((x) => x[1]))) : null });
  return {
    systems: ks.map((k) => {
      const p = per[k];
      return {
        k, label: LABEL[k], games: p.games, marginMAE: r2(mean(p.mae)),
        outlierGames: p.outlier, sideRight: p.sideRight, sideRightPct: p.outlier ? r3(p.sideRight / p.outlier) : null,
        avgGap: p.outlier ? r1(p.gapSum / p.outlier) : null,
      };
    }),
    bands: [band(bands.agree, "all five within 4 points"), band(bands.mid, "spread 4+ points, same winner"), band(bands.split, "systems pick different winners")],
    rule: `A system is an outlier in a game when it is ${OUTLIER_GAP}+ points from the median of the other four. "sideRight" counts the outlier games where the real margin fell on the outlier's side of that median. Preseason excluded.`,
  };
}

// Read the simulation output if another script has written it. Unknown formats are reported, not guessed.
function simFor(pub, id) {
  const dir = path.join(pub, "sim");
  if (!fs.existsSync(dir)) return null;
  const s = readJSON(path.join(dir, `${id}.json`));
  if (!s) return { present: false };
  const pick = (...paths) => {
    for (const p of paths) {
      const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), s);
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  };
  const margin = pick("margin.mean", "summary.margin.mean", "weighted.margin.mean", "all.margin.mean", "overall.margin.mean", "margin");
  const pHome = pick("pHome", "win.home", "summary.pHome", "weighted.pHome", "all.pHome", "overall.pHome", "homeWin");
  const sims = pick("sims", "n", "runs", "summary.sims", "meta.sims");
  if (margin == null && pHome == null) return { present: true, recognised: false };
  return { present: true, recognised: true, margin: r1(margin), pHome: r3(pHome), sims };
}

function reasonFor(hi, lo, d, teamsById, abbr) {
  const [h, a] = [d.teams.find((t) => t.isHome) || d.teams[0], d.teams.find((t) => !t.isHome) || d.teams[1]];
  const H = abbr(d.home), A = abbr(d.away);
  const pair = new Set([hi.k, lo.k]);
  const outs = (t) => (t.out || []).filter((o) => (o.ppg || 0) >= 8).map((o) => `${o.n} (${(o.ppg || 0).toFixed(1)} a game)`);
  const th = teamsById.get(String(d.home)) || {}, ta = teamsById.get(String(d.away)) || {};
  const games = Math.min(h.sched?.seasonGames ?? 0, a.sched?.seasonGames ?? 0);
  if (pair.has("players")) {
    const oh = outs(h), oa = outs(a);
    const parts = [];
    if (oh.length) parts.push(`${H} without ${oh.join(", ")}`);
    if (oa.length) parts.push(`${A} without ${oa.join(", ")}`);
    const pm = d.models.find((m) => m.k === "players").margin;
    const other = pair.has("players") ? (hi.k === "players" ? lo : hi) : lo;
    return {
      kind: "availability",
      t: parts.length
        ? `The player build-up counts who is actually available tonight (${parts.join("; ")}), while ${LABEL[other.k]} rates the teams on games played with their usual line-ups. Player build-up ${fmtSigned(pm)} for ${H}, ${LABEL[other.k]} ${fmtSigned(other.margin)}.`
        : `The player build-up adds up tonight's projected players (${h.sumTeamPts != null && a.sumTeamPts != null ? `${H} ${h.sumTeamPts} points, ${A} ${a.sumTeamPts}, ` : ""}${fmtSigned(pm)} for ${H}), while ${LABEL[other.k]} rates whole-team results. With nobody major out, the gap comes from how the current rotations are rated against the team results so far (${games} games this season for the less-played side).`,
    };
  }
  if (pair.has("elo")) {
    const eh = th.ratings?.elo, ea = ta.ratings?.elo;
    const nh = th.ratings?.adjNet, na = ta.ratings?.adjNet;
    return {
      kind: "memory",
      t: `Elo moves slowly and still carries last season's results (${H} ${eh ?? "?"}, ${A} ${ea ?? "?"}); the efficiency systems react to this season's possessions (opponent-adjusted net rating ${H} ${fmtSigned(nh)}, ${A} ${fmtSigned(na)} per 100). The less-played side has ${games} games this season.`,
    };
  }
  if (pair.has("luckAdjusted")) {
    const lh = th.ratings?.threeLuck, la = ta.ratings?.threeLuck;
    return {
      kind: "threeLuck",
      t: `The luck-adjusted system removes three-point shooting luck (opponents' and own three-point % against normal). Three-point luck: ${H} ${fmtSigned(lh)}, ${A} ${fmtSigned(la)} points per 100. When one side has been lucky, the luck-adjusted margin moves against it.`,
    };
  }
  if (pair.has("efficiency") && pair.has("adjusted")) {
    const l10 = (t) => {
      const g = (t.last10 || []);
      return g.length ? mean(g.map((x) => x.pts - x.oppPts)) : null;
    };
    return {
      kind: "recentForm",
      t: `Recent efficiency weighs the latest games most; the opponent-adjusted system corrects for who they played. Average margin over the last 10: ${H} ${fmtSigned(l10(th))}, ${A} ${fmtSigned(l10(ta))}; opponent-adjusted net rating ${H} ${fmtSigned(th.ratings?.adjNet)}, ${A} ${fmtSigned(ta.ratings?.adjNet)}.`,
    };
  }
  return { kind: "other", t: `${LABEL[hi.k]} and ${LABEL[lo.k]} differ by ${(hi.margin - lo.margin).toFixed(1)} points; no single input explains it.` };
}

export function buildDisagreement(pub, upcoming, past, teams, abbr, learning) {
  const teamsById = new Map((teams || []).map((t) => [String(t.id), t]));
  const history = disagreementHistory(past);
  const hist = new Map(history.systems.map((s) => [s.k, s]));
  const phaseAcc = new Map((learning?.models || []).map((m) => [m.k, m.phases || []]));
  const games = {};
  let simSeen = 0, simUnrecognised = 0;
  for (const { d } of upcoming) {
    const models = (d.models || []).filter((m) => m.margin != null);
    if (models.length < 2) continue;
    const blendM = d.pred.hs - d.pred.as;
    const parts = models.map((m) => ({ k: m.k, label: LABEL[m.k] || m.label, margin: r1(m.margin), weight: m.weight, part: r1(m.margin * (m.weight || 0)) }));
    const partSum = parts.reduce((s, p) => s + (p.part || 0), 0);
    const sorted = [...parts].sort((x, y) => y.margin - x.margin);
    const hi = sorted[0], lo = sorted[sorted.length - 1];
    const med = median(parts.map((p) => p.margin));
    const outlier = [...parts].sort((x, y) => Math.abs(y.margin - med) - Math.abs(x.margin - med))[0];
    const winners = new Set(parts.map((p) => sign(p.margin)).filter(Boolean));
    const sim = simFor(pub, d.id);
    if (sim?.present) simSeen++;
    if (sim?.present && !sim.recognised) simUnrecognised++;
    const H = abbr(d.home), A = abbr(d.away);
    const reason = reasonFor(hi, lo, d, teamsById, abbr);
    const oh = hist.get(outlier.k);
    const rows = parts.map((p) => {
      const ph = (phaseAcc.get(p.k) || []).find((x) => x.pk === "2027-2");
      const h = hist.get(p.k);
      return { ...p, thisSeason: ph ? { winnerAcc: ph.acc, marginMAE: ph.mae } : null, outlierRecord: h ? { games: h.outlierGames, sideRight: h.sideRight } : null };
    });
    games[d.id] = {
      blend: { margin: r1(blendM), pHome: r3(d.pred.pHome), partsSum: r1(partSum), otherAdj: r1(blendM - partSum) },
      systems: rows,
      sim,
      spread: r1(hi.margin - lo.margin),
      splitWinner: winners.size > 1,
      outlier: { k: outlier.k, label: outlier.label, gap: r1(outlier.margin - med) },
      biggest: { hi: hi.k, lo: lo.k, reason },
      t: `${winners.size > 1 ? "The systems disagree on the winner. " : `All systems pick ${blendM >= 0 ? H : A}. `}Spread ${(hi.margin - lo.margin).toFixed(1)} points: ${hi.label} ${fmtSigned(hi.margin)} vs ${lo.label} ${fmtSigned(lo.margin)} (home ${H} minus road ${A}).`
        + (Math.abs(outlier.margin - med) >= OUTLIER_GAP && oh?.outlierGames
          ? ` ${outlier.label} is the outlier by ${Math.abs(outlier.margin - med).toFixed(1)}; when it stood out like this before, the result fell on its side in ${oh.sideRight} of ${oh.outlierGames} games.`
          : ""),
    };
  }
  return {
    note: "Margins are home minus road, in points. The published projection is not an average of the five: the back-test stacks them with weights that add up to more than 1 (each system alone is too cautious), then adds home court, referees and situations (otherAdj). The simulation column appears only when public/data/sim/<id>.json exists.",
    sim: { files: simSeen, unrecognised: simUnrecognised, note: simSeen ? (simUnrecognised ? "Some simulation files have a format this view does not read; they are listed as present without numbers." : "Simulation margins read from public/data/sim.") : "No simulation output yet (public/data/sim is missing)." },
    history,
    games,
  };
}
