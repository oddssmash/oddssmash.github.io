// One-off, run locally: derive per-player numbers from the MLBBHub scoreboard snapshot of 12 Nov 2026 (MPL ID, PH, MY
// Season 18; MLBBHub takes them from the official stats feed). Checked before use: 498 of 499 games match our
// Liquipedia drafts, winners agree in 495, and every MPL PH player-game is identical to the official MPL PH match data.
// Only derived numbers are written (season averages and player-on-hero records); the raw scoreboards stay private.
// Wins come from Liquipedia where the game matches (it disagreed in 3 games). The pipeline never calls mlbbhub.com.
// Usage: node scripts/mlbb/derive-mlbbhub.mjs <path to mlbbhub-player-games.csv>
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, writeJSON } from "../lib/util.mjs";

const src = process.argv[2]; if (!src) { console.log("usage: derive-mlbbhub.mjs <csv>"); process.exit(1); }
const norm = (x) => String(x || "").toLowerCase().replace(/^wu\/?/, "").replace(/[^a-z]/g, "");
const HERO_FIX = { "wu/zetian": "zetian", wuzetian: "zetian", cici: "cici" };
const heroId = (x) => HERO_FIX[String(x).toLowerCase()] || String(x).toLowerCase().replace(/^wu\//, "");
const t = fs.readFileSync(src, "utf8").split(/\r?\n/).filter(Boolean), H = t[0].split(",");
const rows = t.slice(1).map((r) => { const c = r.split(","); return Object.fromEntries(H.map((k, i) => [k, c[i]])); });
// Liquipedia winners by both drafts
const lib = new Map(), LEN = new Map(), libDir = path.join(ROOT, "public-mlbb", "data", "library");
for (const f of fs.readdirSync(libDir)) for (const row of JSON.parse(fs.readFileSync(path.join(libDir, f), "utf8"))) { const h1 = row[10], h2 = row[11], w = row[6]; if (h1?.length !== 5 || h2?.length !== 5) continue; const a = h1.map(norm).sort().join(","), b = h2.map(norm).sort().join(","); lib.set(`${a}|${b}`, w === 1); lib.set(`${b}|${a}`, w === 2);
  const [mm, ss] = String(row[9] || "").split(":").map(Number); if (mm) { LEN.set(`${a}|${b}`, mm + (ss || 0) / 60); LEN.set(`${b}|${a}`, mm + (ss || 0) / 60); } }
const games = {}; for (const r of rows) { const k = `${r.league}|${r.match}|${r.game}`; ((games[k] ||= {})[r.team] ||= []).push(r); }
let fixed = 0;
for (const g of Object.values(games)) { const ts = Object.values(g); if (ts.length !== 2) continue; for (const [me, op] of [[ts[0], ts[1]], [ts[1], ts[0]]]) { const won = lib.get(`${me.map((r) => norm(r.hero)).sort().join(",")}|${op.map((r) => norm(r.hero)).sort().join(",")}`); if (won == null) continue; for (const r of me) { if ((+r.win === 1) !== won) fixed++; r.win = won ? "1" : "0"; } } }
// game length from the scoreboard file next to the CSV (the flat file leaves it blank for PH)
const DUR = new Map(); try { const sb = JSON.parse(fs.readFileSync(path.join(path.dirname(src), "mlbbhub-scoreboards.json"), "utf8"));
  for (const [lg, list] of Object.entries(sb)) for (const m of list || []) for (const g of m.games || []) { const [mm, ss] = String(g.duration || "").split(":").map(Number); if (mm) DUR.set(`${lg.toUpperCase()}|${m.match_id}|${g.game}`, mm + (ss || 0) / 60); } } catch { /* optional */ }
// per-game shares from team totals (some leagues leave the site's own share columns blank; MPL MY has no gold or damage)
for (const [gk, g] of Object.entries(games)) for (const tm of Object.values(g)) { const other = Object.values(g).find((x) => x !== tm) || [], lk = `${tm.map((r) => norm(r.hero)).sort().join(",")}|${other.map((r) => norm(r.hero)).sort().join(",")}`; if (!DUR.get(gk) && LEN.get(lk)) DUR.set(gk, LEN.get(lk)); const K = tm.reduce((x, r) => x + +r.k, 0), G = tm.reduce((x, r) => x + (+r.gold || 0), 0), Dm = tm.reduce((x, r) => x + (+r.dmg || 0), 0);
  for (const r of tm) { const min = +r.minutes || DUR.get(gk) || 0; r.kp = K ? ((+r.k + +r.a) / K) * 100 : 0; r.hasEcon = G > 0; r.gpm = min && G ? +r.gold / min : 0; r.dpm = min && Dm ? +r.dmg / min : 0; r.goldShare = G ? (+r.gold / G) * 100 : 0; r.dmgShare = Dm ? (+r.dmg / Dm) * 100 : 0; } }
const P = {};
for (const r of rows) { const key = r.player.toLowerCase().replace(/[^a-z0-9]/g, ""), p = (P[key] ||= { player: r.player, names: {}, league: r.league, team: r.team, games: 0, wins: 0, k: 0, d: 0, a: 0, gpm: 0, dpm: 0, kp: 0, gs: 0, ds: 0, heroes: {} });
  p.names[r.player] = (p.names[r.player] || 0) + 1; p.team = r.team; p.games++; if (+r.win) p.wins++; p.k += +r.k; p.d += +r.d; p.a += +r.a; p.kp += +r.kp;
  if (r.hasEcon) { p.econ = (p.econ || 0) + 1; p.gpm += +r.gpm; p.dpm += +r.dpm; p.gs += +r.goldShare; p.ds += +r.dmgShare; }
  const h = (p.heroes[heroId(r.hero)] ||= { n: 0, w: 0 }); h.n++; if (+r.win) h.w++; }
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000, out = {};
for (const [k, p] of Object.entries(P)) { const n = p.games, name = Object.entries(p.names).sort((a, b) => b[1] - a[1])[0][0];
  out[k] = { player: name, league: `MPL ${p.league}`, team: p.team, games: n, wins: p.wins, kills: r1(p.k / n), deaths: r1(p.d / n), assists: r1(p.a / n), kp: r3(p.kp / n / 100), ...(p.econ ? { gpm: Math.round(p.gpm / p.econ), dpm: Math.round(p.dpm / p.econ), goldShare: r3(p.gs / p.econ / 100), dmgShare: r3(p.ds / p.econ / 100) } : { gpm: null, dpm: null, goldShare: null, dmgShare: null }),
    heroes: Object.entries(p.heroes).map(([h, v]) => ({ h, n: v.n, w: v.w })).sort((a, b) => b.n - a.n || b.w - a.w) }; }
writeJSON(path.join(DATA, "mlbb", "s18-players.json"), { source: "MLBBHub scoreboards (official stats feed), MPL ID, PH and MY Season 18, snapshot of 2026-11-12; derived per-player numbers; wins from Liquipedia", games: Object.keys(games).length, winnersCorrectedFromLiquipedia: fixed / 5, players: out });
console.log(`S18 players: ${Object.keys(out).length} from ${Object.keys(games).length} games; ${fixed / 5} team-games took Liquipedia's winner`);
