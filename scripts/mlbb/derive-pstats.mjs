// Player Stats tab data, derived from the research review file (review-all-players.json, built from the MLBBHub Season 18
// scoreboards, Liquipedia winners and heroes, the MLBB Esports MENA scoreboard graphics and the MPL KH leaderboards).
// Run by hand when the research file changes:  node scripts/mlbb/derive-pstats.mjs "<path to review-all-players.json>"
// Writes derived/mlbb/pstats/index.json (list, leaders, archetypes) and derived/mlbb/pstats/p/<id>.json (one per player).
// Publishing rule: derived numbers only. MENA comes from scoreboard graphics on Facebook, so only season averages and
// splits are kept for it, never its per-game rows; the raw 5,500-row game log is not published at all.
import fs from "node:fs";
import path from "node:path";
import { ROOT, writeJSON } from "../lib/util.mjs";

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.log("usage: node scripts/mlbb/derive-pstats.mjs <review-all-players.json>"); process.exit(1); }
const d = JSON.parse(fs.readFileSync(SRC, "utf8")), OUT = path.join(ROOT, "derived", "mlbb", "pstats"); // outside data/: the workflow restores a cached data/ over the checkout
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, "p"), { recursive: true });
const idOf = (lg, p) => `${lg}-${String(p).replace(/[^A-Za-z0-9]+/g, "_")}`.toLowerCase(); // lower case: file names must not clash on Windows/macOS
// the research file sometimes lists one player twice under different capitalisation (MAYKIDSS / Maykidss): keep the larger entry
const keep = (rows, lg) => { const best = new Map(); for (const s of rows) { const k = `${lg(s)}|${s.p}|${s.t}`.toLowerCase(); if (!best.has(k) || best.get(k).g < s.g) best.set(k, s); } return rows.filter((s) => best.get(`${lg(s)}|${s.p}|${s.t}`.toLowerCase()) === s); };
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const split = (r) => ({ label: r.label, n: r.n, wp: r1(r.wp), kda: r1(r.kda), gpm: r.gpm, dpm: r.dpm || null, kp: r1(r.kp), dwp: r1(r.dwp), dkda: r1(r.dkda), dgpm: r.dgpm, small: !!r.small || r.n < 5 });
const players = [];
for (const s of keep(d.season, (x) => x.lg)) {
  const id = idOf(s.lg, s.p), det = d.detail[`${s.lg}|${s.p}`] || {};
  players.push({ id, lg: s.lg, p: s.p, t: s.t, role: s.role, lane: s.lane, laneShare: s.laneShare, g: s.g, w: s.w, wp: s.wp, k: s.k, d: s.d, a: s.a, kda: s.kda, kp: s.kp ?? det.base?.kp, gpm: s.gpm || det.base?.gpm || null, dpm: s.dpm || det.base?.dpm || null, tpm: s.tpm, gs: s.gs || null, ds: s.ds || null, tow: s.tow || null, hp: s.hp, arch: s.arch, arch2: s.arch2, archWhy: s.archWhy, tags: s.tags, blend: s.blend, radar: s.radar });
  writeJSON(path.join(OUT, "p", id + ".json"), {
    vsLaneArch: (det.vsLaneArch || []).map(split), vsTeamArch: (det.vsTeamArch || []).map(split), vsTeam: (det.vsTeam || []).map(split), vsLanePlayer: (det.vsLanePlayer || []).map(split), splits: (det.splits || []).map(split),
    heroes: (det.heroes || []).map((h) => ({ h: h.h, n: h.n, wp: r1(h.wp), kda: r1(h.kda), gpm: h.gpm || null, dpm: h.dpm || null })), emblems: det.emblems || [], items: det.items || [], talents: det.talents || [], lanes: det.lanes || [],
    series: (det.series || []).map((g) => ({ m: g.m, g: g.g, h: g.h, w: g.w ? 1 : 0, kda: r1(g.kda), gpm: g.gpm || null, dpm: g.dpm || null, kp: g.kp })),
  });
}
for (const s of keep(d.mena, () => "MENA")) {
  const id = idOf("MENA", s.p), det = d.mdetail[s.p] || {};
  players.push({ id, lg: "MENA", p: s.p, t: s.t, g: s.g, w: s.w, wp: s.wp, k: s.k, d: s.d, a: s.a, kda: s.kda, kp: s.kp, gpm: s.gpm, gs: s.gs, arch: s.arch, arch2: s.arch2, archWhy: s.archWhy, tags: s.tags, blend: s.blend, radar: s.radar });
  writeJSON(path.join(OUT, "p", id + ".json"), { vsTeamArch: (det.vsTeamArch || []).map(split), vsTeam: (det.vsTeam || []).map(split), splits: (det.splits || []).map(split) }); // no per-game rows for MENA
}
writeJSON(path.join(OUT, "index.json"), {
  built: new Date().toISOString(), players,
  kh: { players: d.khPlayers, boards: d.kh.map((x) => ({ stat: x.stat, rank: x.rank, p: x.p, t: x.t, v: x.v })) },
  archMatrix: d.archMatrix, archDefs: d.archDefs,
});
console.log(`player stats: ${players.length} players (${d.season.length} S18, ${d.mena.length} MENA), ${d.khPlayers.length} KH`);
