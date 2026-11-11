// Self-check for the play-by-play cache and the zone classifier. Prints, never writes.
//   node scripts/lib/zonecheck.mjs            top 40 players by attempts
//   node scripts/lib/zonecheck.mjs 150        top 150
// 1. data/pbp vs the ESPN box score in data/games (same game, player by player).
// 2. Zone attempt shares and FG% built from data/pbp vs NBA.com's shot-location table
//    (data/nbazones.json), regular season, for the highest-volume players.
// 3. Points from "rim" + "paint" zone shots vs the box score's points in the paint.
// 4. Score flow (gameflow.mjs) vs the box score's largest lead and lead changes.
import fs from "node:fs";
import path from "node:path";
import { DATA, readJSON } from "./util.mjs";
import { normName } from "./stats.mjs";
import { GEOM, FL, classifyShot, decodeShots, decodeFreeThrows, decodePlayerCounts } from "./zones.mjs";
import { summarizeGame } from "./gameflow.mjs";
import { markCupFinals } from "./boxfix.mjs";

const TOP = Number(process.argv[2]) || 40;
const NZ = ["RA", "PAINT", "MID", "LC3", "RC3", "ATB3", "BC"];
const nbaTables = readJSON(path.join(DATA, "nbazones.json"), {}).seasons || {};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f2 = (x) => x.toFixed(2);

// NBA.com has no heave bucket: file those shots where NBA.com does (backcourt or above the break).
const NO_HEAVE = { ...GEOM, heaveMinFt: 1e9, lateHeaveMinFt: 1e9, midcourtY: 1e9 };
function nbaZone(s) {
  if (s.pts === 3 && Number.isFinite(s.y) && s.y >= GEOM.midcourtY) return "BC";
  const c = classifyShot(s, NO_HEAVE);
  return c.fine === "c3L" ? "LC3" : c.fine === "c3R" ? "RC3" : c.zone === "atb" ? "ATB3" : c.zone === "rim" ? "RA" : c.zone === "paint" ? "PAINT" : "MID";
}

const files = fs.existsSync(path.join(DATA, "pbp")) ? fs.readdirSync(path.join(DATA, "pbp")).filter((f) => f.endsWith(".json")) : [];
// The NBA Cup final is a regular-season game for ESPN but is not in NBA.com's season totals: leave it out of that comparison.
const cupIds = new Set(markCupFinals(files.map((f) => readJSON(path.join(DATA, "games", f))).filter(Boolean)).map(String));
const box = { games: 0, noPlays: 0, gap: 0, playerGames: 0, miss: { fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, pts: 0, ast: 0, blk: 0, pf: 0, to: 0 } };
const paint = { n: 0, absDiff: 0, mine: 0, box: 0 };
const flowChk = { teams: 0, leadOk: 0, games: 0, changesOk: 0 };
const bySeason = {}; // "2025-26" -> Map(normName -> { RA: [made, att], ... })
let shotsTotal = 0;

for (const f of files) {
  const c = readJSON(path.join(DATA, "pbp", f)), g = readJSON(path.join(DATA, "games", f));
  if (!c || !g) continue;
  box.games++;
  if (c.np) { box.noPlays++; continue; }
  if (c.gap) box.gap++;
  const shots = decodeShots(c);
  shotsTotal += shots.length;
  const name = new Map(g.players.map((p) => [p.id, normName(p.n)]));
  const agg = new Map();
  const get = (pid) => { if (!agg.has(pid)) agg.set(pid, { fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, pts: 0, ast: 0, blk: 0, pf: 0, to: 0 }); return agg.get(pid); };
  const paintPts = [0, 0];
  const season = `${c.season - 1}-${String(c.season).slice(2)}`;
  const zmap = c.stype === 2 && !cupIds.has(String(c.id)) ? (bySeason[season] = bySeason[season] || new Map()) : null;
  for (const s of shots) {
    if (s.made && (s.zone === "rim" || s.zone === "paint")) paintPts[s.side] += s.pts;
    if (s.blk) get(s.blk).blk++;
    if (s.fl & FL.HEAVE) continue; // missed end-of-period heave: charged to the team, not the player
    const a = get(s.pid);
    a.fga++; a.fgm += s.made; a.pts += s.made * s.pts;
    if (s.pts === 3) { a.tpa++; a.tpm += s.made; }
    if (s.ast) get(s.ast).ast++;
    if (zmap) {
      const k = name.get(s.pid); if (!k) continue;
      let z = zmap.get(k); if (!z) zmap.set(k, z = Object.fromEntries(NZ.map((n) => [n, [0, 0]])));
      const cell = z[nbaZone(s)]; cell[0] += s.made; cell[1]++;
    }
  }
  for (const t of decodeFreeThrows(c)) { const a = get(t.pid); a.fta++; a.ftm += t.made; a.pts += t.made; }
  for (const r of decodePlayerCounts(c)) { const a = get(r.pid); a.pf += r.shootingFouls + r.offensiveFouls + r.otherFouls; a.to += r.tovBadPass + r.tovLostBall + r.tovViolation + r.tovOffFoul; }
  for (const p of g.players) {
    if (p.dnp) continue;
    box.playerGames++;
    const a = agg.get(p.id) || get(p.id);
    for (const k of Object.keys(box.miss)) if (a[k] !== p[k]) box.miss[k]++;
  }
  const story = c.gap ? null : summarizeGame(c);
  if (story) {
    const hb = (g.teams || []).find((x) => x.id === c.h), ab = (g.teams || []).find((x) => x.id === c.a);
    for (const [i, b] of [[0, hb], [1, ab]]) if (b && Number.isFinite(Number(b.largestLead))) { flowChk.teams++; if (Number(b.largestLead) === story.sides[i].largestLead) flowChk.leadOk++; }
    if (hb && Number.isFinite(Number(hb.leadChanges))) { flowChk.games++; if (Number(hb.leadChanges) === story.leadChanges) flowChk.changesOk++; }
  }
  if (!c.gap) [c.h, c.a].forEach((tid, side) => {
    const t = (g.teams || []).find((x) => x.id === tid);
    if (!t || t.pointsInPaint == null) return;
    paint.n++; paint.absDiff += Math.abs(paintPts[side] - Number(t.pointsInPaint)); paint.mine += paintPts[side]; paint.box += Number(t.pointsInPaint);
  });
}

console.log(`play-by-play files: ${box.games} (${box.noPlays} without plays, ${box.gap} where plays do not add up to the final score), ${shotsTotal} field-goal attempts`);
console.log(`\n1. Box-score agreement, ${box.playerGames} player-games. Player-games where the count differs:`);
console.log("  " + Object.entries(box.miss).map(([k, v]) => `${k} ${v} (${(v / box.playerGames * 100).toFixed(2)}%)`).join(", "));

console.log(`\n2. Zones vs NBA.com shot locations, top ${TOP} players by attempts (regular season). Shares in percentage points.`);
for (const [season, zmap] of Object.entries(bySeason).sort()) {
  const nba = nbaTables[season]?.shotLoc;
  if (!nba || !Object.keys(nba).length) { console.log(`  ${season}: no NBA.com table in data/nbazones.json - run "node scripts/fetch.mjs zones"`); continue; }
  const rows = [];
  for (const [k, z] of zmap) {
    const n = nba[k]; if (!n) continue;
    rows.push({ k, z, n, mine: NZ.reduce((x, zn) => x + z[zn][1], 0), theirs: NZ.reduce((x, zn, i) => x + n[i * 2 + 1], 0) });
  }
  rows.sort((a, b) => b.theirs - a.theirs);
  const top = rows.slice(0, TOP);
  const stat = Object.fromEntries(NZ.map((z) => [z, { share: [], pct: [] }]));
  let worstShare = { v: -1 }, worstPct = { v: -1 };
  for (const r of top) NZ.forEach((z, i) => {
    const ms = r.z[z][1] / r.mine * 100, ns = r.n[i * 2 + 1] / r.theirs * 100, d = Math.abs(ms - ns);
    stat[z].share.push(d);
    if (d > worstShare.v) worstShare = { v: d, txt: `${r.k} ${z}: play-by-play ${ms.toFixed(1)}% vs NBA.com ${ns.toFixed(1)}%` };
    if (r.z[z][1] >= 50 && r.n[i * 2 + 1] >= 50) {
      const mp = r.z[z][0] / r.z[z][1] * 100, np = r.n[i * 2] / r.n[i * 2 + 1] * 100, e = Math.abs(mp - np);
      stat[z].pct.push(e);
      if (e > worstPct.v) worstPct = { v: e, txt: `${r.k} ${z}: ${mp.toFixed(1)}% on ${r.z[z][1]} vs ${np.toFixed(1)}% on ${r.n[i * 2 + 1]}` };
    }
  });
  const core = NZ.filter((z) => z !== "BC");
  console.log(`  ${season}: ${top.length} players, attempts ${top.reduce((x, r) => x + r.mine, 0)} (play-by-play) vs ${top.reduce((x, r) => x + r.theirs, 0)} (NBA.com)`);
  for (const z of core) console.log(`    ${z.padEnd(5)} share gap avg ${f2(avg(stat[z].share))} max ${f2(Math.max(0, ...stat[z].share))} | FG% gap avg ${f2(avg(stat[z].pct))} max ${f2(Math.max(0, ...stat[z].pct))} (${stat[z].pct.length} players with 50+ attempts)`);
  console.log(`    all zones: share gap avg ${f2(avg(core.flatMap((z) => stat[z].share)))}, worst ${f2(worstShare.v)} (${worstShare.txt})`);
  console.log(`               FG% gap avg ${f2(avg(core.flatMap((z) => stat[z].pct)))}, worst ${f2(worstPct.v)} (${worstPct.txt})`);
  const lg = NZ.map((z, i) => `${z} ${rows.reduce((x, r) => x + r.z[z][1], 0)}/${rows.reduce((x, r) => x + r.n[i * 2 + 1], 0)}`).join(", ");
  console.log(`    league attempts, play-by-play/NBA.com (${rows.length} matched players): ${lg}`);
}

console.log(`\n3. Rim + paint zone points vs box-score points in the paint, ${paint.n} team-games: ${f2(paint.mine / (paint.n || 1))} vs ${f2(paint.box / (paint.n || 1))} per game, average gap ${f2(paint.absDiff / (paint.n || 1))} points`);
console.log(`\n4. Score flow vs box score: largest lead equal in ${flowChk.leadOk} of ${flowChk.teams} team-games, lead changes equal in ${flowChk.changesOk} of ${flowChk.games} games that list them`);
