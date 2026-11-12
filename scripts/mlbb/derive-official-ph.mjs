// One-off, run locally: derive per-player shares from the official MPL PH per-game data (ph-mpl.com/data/match pages,
// Moonton's content, collected by the research session). Only derived numbers are written; the raw per-game file
// stays private. No winners are used here (the private file's winners came from another source); win records on
// the site come from Liquipedia. Usage: node scripts/mlbb/derive-official-ph.mjs <path to official-mplph-s18-player-games.csv>
import fs from "node:fs";
import path from "node:path";
import { DATA, writeJSON } from "../lib/util.mjs";

const src = process.argv[2]; if (!src) { console.log("usage: derive-official-ph.mjs <csv>"); process.exit(1); }
const rows = fs.readFileSync(src, "utf8").split(/\r?\n/).filter(Boolean), H = rows[0].split(",");
const rec = rows.slice(1).map((r) => Object.fromEntries(r.split(",").map((v, i) => [H[i], v])));
const team = {}; for (const r of rec) { const k = `${r.match}|${r.game}|${r.teamIdx}`; const t = (team[k] ||= { k: 0, gold: 0, dmg: 0, taken: 0, tower: 0 }); t.k += +r.k; t.gold += +r.gold; t.dmg += +r.heroDmg; t.taken += +r.dmgTaken; t.tower += +r.towerDmg; }
const P = {};
for (const r of rec) { const t = team[`${r.match}|${r.game}|${r.teamIdx}`], name = r.player.replace(/\.$/, "").trim(), p = (P[name.toLowerCase()] ||= { player: name, team: r.team, games: 0, k: 0, d: 0, a: 0, kp: 0, dmg: 0, gold: 0, taken: 0, tower: 0 });
  p.games++; p.k += +r.k; p.d += +r.d; p.a += +r.a; p.kp += t.k ? (+r.k + +r.a) / t.k : 0; p.dmg += t.dmg ? +r.heroDmg / t.dmg : 0; p.gold += t.gold ? +r.gold / t.gold : 0; p.taken += t.taken ? +r.dmgTaken / t.taken : 0; p.tower += t.tower ? +r.towerDmg / t.tower : 0; }
const r3 = (x) => Math.round(x * 1000) / 1000, out = {};
for (const [k, p] of Object.entries(P)) { const n = p.games; out[k] = { player: p.player, team: p.team, games: n, kills: r3(p.k / n), deaths: r3(p.d / n), assists: r3(p.a / n), kp: r3(p.kp / n), dmgShare: r3(p.dmg / n), goldShare: r3(p.gold / n), takenShare: r3(p.taken / n), towerShare: r3(p.tower / n) }; }
writeJSON(path.join(DATA, "mlbb", "shares-ph-s18.json"), { source: "MPL PH official site, per-match data pages (ph-mpl.com/data), Season 18, derived per-player averages", games: new Set(rec.map((r) => r.match + "|" + r.game)).size, players: out });
console.log(`official PH S18 shares: ${Object.keys(out).length} players from ${rec.length} player-games`);
