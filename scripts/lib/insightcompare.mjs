// Compare data (two players or two teams side by side) and the trust meter summary. Display only.
import path from "node:path";
import { readJSON } from "./util.mjs";
import { r1, r2, r3, mean } from "./insightutil.mjs";

const PCT_MIN = { gp: 5, min: 10 };

function percentiles(rows, colIdx, qualIdx, higherBetter = true) {
  const vals = rows.filter((r) => r[qualIdx] && r[colIdx] != null).map((r) => r[colIdx]).sort((a, b) => a - b);
  const n = vals.length;
  return (v) => {
    if (v == null || !n) return null;
    let lo = 0; while (lo < n && vals[lo] < v) lo++;
    let hi = lo; while (hi < n && vals[hi] === v) hi++;
    const p = Math.round((100 * (lo + (hi - lo) / 2)) / n);
    return higherBetter ? p : 100 - p;
  };
}

export function buildComparePlayers(pub, index) {
  const cols = ["id", "n", "team", "pos", "height", "arch", "gp", "min", "pts", "reb", "ast", "tpm", "stl", "blk", "to", "ts", "usg", "net", "onOffSwing", "onOffMin", "prevGp", "prevPts", "prevReb", "prevAst", "last5Pts", "last5Min", "rimShare", "threeShare", "trust", "trustRatio", "trustBias", "trustGames", "k2", "q"];
  const rows = [];
  const files = new Map();
  for (const it of index) {
    const p = readJSON(path.join(pub, "players", `${it.id}.json`));
    if (!p) continue;
    files.set(it.id, p);
    const c = p.cur || {}, v = p.prev || {}, l5 = p.last5 || {};
    const five = p.zones?.five || [];
    const share = (ids) => { const s = five.filter((z) => ids.includes(z.id)).reduce((a, z) => a + (z.share || 0), 0); return five.length ? r1(s) : null; };
    const qualified = (c.gp || 0) >= PCT_MIN.gp && (c.min || 0) >= PCT_MIN.min;
    rows.push([
      p.id, p.n, p.team ?? it.team ?? null, p.pos ?? null, p.height ?? null, p.archetype ?? it.arch ?? null,
      c.gp ?? null, c.min ?? null, c.pts ?? null, c.reb ?? null, c.ast ?? null, c.tpm ?? null, c.stl ?? null, c.blk ?? null, c.to ?? null, c.ts != null ? r1(c.ts * 100) : null,
      p.nba?.usg ?? null, p.nba?.net ?? null, p.onOff?.swing ?? null, p.onOff?.min ?? null,
      v.gp ?? null, v.pts ?? null, v.reb ?? null, v.ast ?? null, l5.pts ?? null, l5.min ?? null,
      share(["rim"]), share(["c3", "atb"]),
      p.trust?.label ?? null, p.trust?.ratio ?? null, p.trust?.bias ?? null, p.trust?.games ?? null, p.k2?.ovr ?? it.k2 ?? null,
      qualified ? 1 : 0,
    ]);
  }
  const qi = cols.indexOf("q");
  const pctCols = ["min", "pts", "reb", "ast", "tpm", "stl", "blk", "ts", "usg", "onOffSwing"];
  const pct = {};
  for (const k of pctCols) {
    const ci = cols.indexOf(k);
    const f = percentiles(rows, ci, qi);
    pct[k] = rows.map((r) => (r[qi] ? f(r[ci]) : null));
  }
  const toIdx = cols.indexOf("to");
  const ft = percentiles(rows, toIdx, qi, false);
  pct.to = rows.map((r) => (r[qi] ? ft(r[toIdx]) : null));
  return {
    file: {
      note: `One row per player with a page. Season numbers are this regular season (cur), prev = last regular season. Percentiles (0-100, same order as rows) compare players with ${PCT_MIN.gp}+ games and ${PCT_MIN.min}+ minutes a game this season (q = 1); turnovers are reversed (high = fewer). ts in %, usg and net from NBA.com, onOffSwing = team net rating per 100 with him on minus off (onOffMin minutes on). rimShare / threeShare = % of his shots (last season and this). trust = trust meter label. For everything else load players/<id>.json.`,
      cols, rows, pct,
    },
    files,
  };
}

export function buildCompareTeams(teams) {
  const cols = ["id", "abbr", "name", "w", "l", "last10W", "last10Margin", "elo", "adjNet", "adjOff", "adjDef", "luckNet", "threeLuck", "pace", "off", "def", "net", "tpar", "efg", "oppEfg", "ftr", "tov", "orb", "oppTov", "depth", "benchPts", "q1", "q2", "q3", "q4", "trust", "trustMae", "trustBias", "playersUsedClose", "firstSubMin", "tags"];
  const rows = (teams || []).map((t) => {
    const l10 = t.last10 || [];
    const ff = t.nba?.fourFactors || {};
    const qm = t.quarterIdentity?.margin || [];
    const rc = t.rotation?.current || {};
    return [
      t.id, t.abbr, t.name, t.record?.w ?? null, t.record?.l ?? null,
      l10.filter((g) => g.pts > g.oppPts).length, l10.length ? r1(mean(l10.map((g) => g.pts - g.oppPts))) : null,
      t.ratings?.elo ?? null, t.ratings?.adjNet ?? null, t.ratings?.adjOff ?? null, t.ratings?.adjDef ?? null, t.ratings?.luckNet ?? null, t.ratings?.threeLuck ?? null,
      t.style?.pace ?? null, t.style?.off ?? null, t.style?.def ?? null, t.style?.net ?? null, t.style?.tpar != null ? r1(t.style.tpar * 100) : null,
      t.style?.efg != null ? r1(t.style.efg * 100) : null, t.style?.oppEfg != null ? r1(t.style.oppEfg * 100) : null,
      ff.ftr ?? null, ff.tov ?? null, ff.orb ?? null, ff.oppTov ?? null,
      t.style?.depth ?? null, t.style?.benchPts ?? null, qm[0] ?? null, qm[1] ?? null, qm[2] ?? null, qm[3] ?? null,
      t.trust?.label ?? null, t.trust?.mae ?? null, t.trust?.bias ?? null, rc.playersUsed?.close ?? null, rc.firstSubMin ?? null,
      t.style?.tags || [],
    ];
  });
  // rank 1 = best (lower is better for def, oppEfg, tov)
  const lowBetter = new Set(["def", "oppEfg", "tov", "adjDef"]);
  const rankCols = ["elo", "adjNet", "adjOff", "adjDef", "pace", "off", "def", "net", "tpar", "efg", "oppEfg", "ftr", "tov", "orb", "oppTov", "depth", "benchPts"];
  const ranks = {};
  for (const k of rankCols) {
    const ci = cols.indexOf(k);
    // adjDef in teams.json: points allowed per 100 against average (negative = better defence)
    const low = lowBetter.has(k);
    const sorted = rows.map((r) => r[ci]).filter((x) => x != null).sort((a, b) => (low ? a - b : b - a));
    ranks[k] = rows.map((r) => (r[ci] == null ? null : sorted.indexOf(r[ci]) + 1));
  }
  return {
    note: "One row per team. Ranks 1-30 (1 = best; pace and three-point rate 1 = highest). adjNet / adjOff / adjDef: opponent-adjusted, points per 100 against average (adjDef negative = allows fewer, ranked 1 = lowest). Four-factor numbers from NBA.com this season. q1-q4 = average margin by quarter (quarterIdentity). Records exclude the NBA Cup final. For more load teams/<id>.json or teams.json.",
    cols, rows, ranks,
  };
}

export function buildTrust(playerFiles, teams, upcoming, persistence, abbr) {
  const players = [];
  for (const [, p] of playerFiles) if (p.trust && p.trust.games) players.push({ id: p.id, n: p.n, team: p.team ?? null, ...p.trust });
  const counted = players.filter((p) => !p.small && p.games >= 8);
  const counts = {};
  for (const p of counted) counts[p.label] = (counts[p.label] || 0) + 1;
  const pick = (a, f, s, n = 12) => a.filter(f).sort(s).slice(0, n).map((p) => ({ id: p.id, n: p.n, team: p.team, games: p.games, mae: p.mae, typical: p.typical, ratio: p.ratio, bias: p.bias, lean: p.lean }));
  const tms = (teams || []).filter((t) => t.trust).map((t) => ({ id: t.id, abbr: t.abbr, ...t.trust }));
  const teamCounts = {};
  for (const t of tms) teamCounts[t.label] = (teamCounts[t.label] || 0) + 1;
  const tonight = {};
  for (const { d } of upcoming) {
    const rows = [];
    for (const t of d.teams) for (const p of t.players || []) if (p.trust && (p.trust.label === "keeps missing" || p.trust.label === "reads well") && (p.min || 0) >= 15) rows.push({ id: p.id, n: p.n, team: t.tid, label: p.trust.label, ratio: p.trust.ratio, bias: p.trust.bias, games: p.trust.games });
    tonight[d.id] = { teams: d.teams.map((t) => (t.trust ? { tid: t.tid, label: t.trust.label, mae: t.trust.mae, bias: t.trust.bias, games: t.trust.games } : null)), players: rows.sort((x, y) => y.ratio - x.ratio) };
  }
  const pp = persistence.players.find((x) => x.label === "keeps missing");
  const pw = persistence.players.find((x) => x.label === "reads well");
  return {
    note: "Trust meter = the model's recent 15-game error on that player or team against the typical error for similar projections (model's own numbers, evidence only: it does not change any projection). Players need 8+ games to get a label.",
    players: { labelled: counted.length, counts, keepsMissing: pick(counted, (p) => p.label === "keeps missing", (a, b) => b.ratio - a.ratio), readsWell: pick(counted, (p) => p.label === "reads well", (a, b) => a.ratio - b.ratio),
      projectedTooLow: pick(counted, (p) => p.bias >= 2.5, (a, b) => b.bias - a.bias, 10), projectedTooHigh: pick(counted, (p) => p.bias <= -2.5, (a, b) => a.bias - b.bias, 10) },
    teams: { counts: teamCounts, rows: tms.sort((a, b) => b.ratio - a.ratio).map((t) => ({ id: t.id, abbr: t.abbr, label: t.label, games: t.games, mae: t.mae, typical: t.typical, ratio: t.ratio, bias: t.bias, lean: t.lean })) },
    tonight,
    persistence: {
      ...persistence,
      t: pp && pw && pp.games && pw.games
        ? `Does the label last? In the back-test, players labelled "keeps missing" had a next-game error ${pp.nextGameRatio} times typical (${pp.games} games); "reads well" ${pw.nextGameRatio} (${pw.games} games). ${Math.abs(pp.nextGameRatio - pw.nextGameRatio) < 0.1 ? "The gap is small, so treat the label as a description of the past, not a forecast." : "Part of the gap persists, so the label carries some information about the next game."}`
        : null,
    },
  };
}
