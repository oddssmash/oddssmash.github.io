// Analysis views for the site. Runs AFTER scripts/model.mjs and reads only its output
// (public/data), data/history snapshots and data/pregame.json. Nothing here feeds the projections,
// the learning or the scenario library, and no betting odds are read.
//
//   node scripts/insights.mjs
//
// Writes public/data/insights.json, public/data/compare/players.json, public/data/compare/teams.json.
// CL_OUT=<folder> reads and writes that folder instead of public/data (same switch as model.mjs).
// CL_HISTORY_DIR=<folder> reads snapshots from another folder (for testing the "what changed" diff).
import path from "node:path";
import { DATA, PUBLIC_DATA, readJSON, writeJSON } from "./lib/util.mjs";
import { loadPastGames, loadUpcoming, teamAbbr, manilaDateTime, r1 } from "./lib/insightutil.mjs";
import { buildSimilar } from "./lib/insightsimilar.mjs";
import { buildDisagreement } from "./lib/insightdisagree.mjs";
import { chronoPass, buildBreakout } from "./lib/insightbreakout.mjs";
import { buildChanges } from "./lib/insightchanges.mjs";
import { buildComparePlayers, buildCompareTeams, buildTrust } from "./lib/insightcompare.mjs";

const t0 = Date.now();
const PUB = process.env.CL_OUT ? path.resolve(process.env.CL_OUT) : PUBLIC_DATA;
const HIST = process.env.CL_HISTORY_DIR ? path.resolve(process.env.CL_HISTORY_DIR) : path.join(DATA, "history");

const meta = readJSON(path.join(PUB, "meta.json"), {});
const teams = readJSON(path.join(PUB, "teams.json"), []);
const index = readJSON(path.join(PUB, "players.json"), []);
const learning = readJSON(path.join(PUB, "learning.json"), {});
const pregame = readJSON(path.join(DATA, "pregame.json"), {});
const abbr = teamAbbr(teams);

const past = loadPastGames(PUB);
const upcoming = loadUpcoming(PUB);
console.log(`insights: ${past.length} finished games, ${upcoming.length} upcoming (${((Date.now() - t0) / 1000).toFixed(1)}s to load)`);

const similar = buildSimilar(past, upcoming, abbr);
const disagreement = buildDisagreement(PUB, upcoming, past, teams, abbr, learning);
const pass = chronoPass(past);
const breakout = buildBreakout(upcoming, pass.logs, pass.evidence, pregame, abbr);

const names = new Map(index.map((p) => [String(p.id), p.n]));
const injuries = new Map();
for (const { d } of upcoming) for (const t of d.teams) for (const o of t.out || []) {
  const inj = (t.injuries || []).find((x) => x.n === o.n);
  injuries.set(`${d.id}:${o.id}`, inj ? `${inj.status}: ${inj.detail || ""}`.trim() : null);
  if (!names.has(String(o.id))) names.set(String(o.id), o.n);
}
const changes = buildChanges(HIST, {
  nameOf: (id) => names.get(String(id)) || `player ${id}`,
  abbr,
  injuryDetail: (gid, pid) => injuries.get(`${gid}:${pid}`) || null,
});

const cmpPlayers = buildComparePlayers(PUB, index);
const cmpTeams = buildCompareTeams(teams);
const trust = buildTrust(cmpPlayers.files, teams, upcoming, pass.trustPersistence, abbr);

// per-game index so the site can open one game without scanning every block
const games = upcoming.map(({ d }) => ({
  id: d.id, date: d.date, when: manilaDateTime(d.date), home: d.home, away: d.away,
  margin: r1(d.pred.hs - d.pred.as), pHome: d.pred.pHome,
  spread: disagreement.games[d.id]?.spread ?? null, splitWinner: disagreement.games[d.id]?.splitWinner ?? false,
  similarFavWon: similar.games[d.id] ? [similar.games[d.id].summary.favWon, similar.games[d.id].summary.n] : null,
  breakout: breakout.opportunity.filter((r) => r.gid === d.id).map((r) => r.id),
}));

const out = {
  format: 1,
  updated: new Date().toISOString(),
  updatedManila: manilaDateTime(new Date().toISOString()),
  modelRun: meta.updated || null,
  note: "Analysis views built from the model's published output. Display only: nothing here changes a projection. No betting odds are read. Dates in Philippine time.",
  games,
  similar,
  disagreement,
  breakout,
  changes,
  trust,
  compare: { players: "compare/players.json", teams: "compare/teams.json" },
};

writeJSON(path.join(PUB, "insights.json"), out);
writeJSON(path.join(PUB, "compare", "players.json"), cmpPlayers.file);
writeJSON(path.join(PUB, "compare", "teams.json"), cmpTeams);

const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0) + " KB";
console.log(`insights: wrote insights.json (${kb(out)}), compare/players.json (${kb(cmpPlayers.file)}, ${cmpPlayers.file.rows.length} players), compare/teams.json (${kb(cmpTeams)})`);
console.log(`  similar: ${Object.keys(similar.games).length} games; self-test ${similar.selfTest.games} games, residual corr ${similar.selfTest.corrResidual}, margin MAE ${similar.selfTest.marginMAE.projection} -> ${similar.selfTest.marginMAE.plusNeighbourGap}`);
console.log(`  disagreement: ${Object.keys(disagreement.games).length} games; sim: ${disagreement.sim.note}`);
console.log(`  breakout: ${breakout.opportunity.length} opportunity, ${breakout.matchup.length} matchup, ${breakout.hotStreaks.length} hot streaks`);
console.log(`  changes: ${changes.snapshots} snapshot(s); ${changes.message || (changes.sinceLast ? changes.sinceLast.lines.join(" ") : "")}`);
console.log(`  trust: ${trust.players.labelled} players labelled; ${trust.persistence.t || ""}`);
console.log(`insights: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
