// Career context for MPL PH players, derived from the stat posts of an MPL PH staff member in the "MLBB PH News Events
// and Tournaments" Facebook group, as transcribed by the research session (fb-mplph-staff-stats.json).
// Run by hand when that file changes:  node scripts/mlbb/derive-career.mjs "<path to fb-mplph-staff-stats.json>"
// Writes derived/mlbb/career-ph.json: per player a Season 16 line, all-time MPL PH record, M-series record and top heroes.
// Publishing rule: summary numbers per player only, never the tables themselves; the source is credited on the page.
import fs from "node:fs";
import path from "node:path";
import { ROOT, writeJSON } from "../lib/util.mjs";

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.log("usage: node scripts/mlbb/derive-career.mjs <fb-mplph-staff-stats.json>"); process.exit(1); }
const d = JSON.parse(fs.readFileSync(SRC, "utf8")), key = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const T = (re) => d.tables.filter((t) => re.test(t.title || ""));
const rows = (t) => t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
const num = (x) => { const v = parseFloat(String(x ?? "").replace(/[,%]/g, "")); return isFinite(v) ? v : null; };
const P = new Map(), at = (n) => { const k = key(n); if (!k) return null; if (!P.has(k)) P.set(k, { name: String(n).trim() }); return P.get(k); };

// Season 16 regular season, by lane (roam covers the first half only)
for (const [re, lane, part] of [[/S16 regular season, Mid lane/, "Mid"], [/S16 regular season, Jungle/, "Jungle"], [/S16 regular season, EXP lane/, "EXP"], [/S16 regular season 1st half, Roam/, "Roam", "first half"]])
  for (const t of T(re)) for (const r of rows(t)) { const p = at(r.Player); if (!p) continue; const [w, l] = String(r["W-L"] || "").split("-").map(Number);
    p.s16 = { lane, part: part || null, g: num(r.G), w, l, k: num(r.K), d: num(r.D), a: num(r.A), kda: num(r.KDA), gpm: num(r.GPM), dpm: num(r.DPM), dtpm: num(r.DTPM), mvps: num(r.MVPs), heroes: num(r.heroes), turtles: num(r.turtles), lords: num(r.lords) }; }
// gold laners and others only appear in the all-lanes top-20 KDA table
for (const t of T(/S16 regular season highest KDA/)) for (const r of rows(t)) { const p = at(r.player); if (p && !p.s16) p.s16 = { lane: null, k: num(r.K), d: num(r.D), a: num(r.A), kda: num(r.KDA), top20: true }; }
for (const t of T(/S16 regular season game MVP count/)) for (const r of rows(t)) { const p = at(r.Name); if (p) (p.s16 ||= {}).mvps ??= num(r.game_mvps); }
// all-time MPL PH (S1-S16)
for (const t of T(/most games played \(S1-S16\)/)) for (const r of rows(t)) { const p = at(r.Name); if (p) (p.allTime ||= {}).games = num(r.games); }
for (const t of T(/highest game win rate|TLPH players all-time MPL PH game win rate/)) for (const r of rows(t)) { const p = at(r.Name); if (p) Object.assign((p.allTime ||= {}), { games: num(r.games), w: num(r.W), l: num(r.L), wr: num(r.WR) }); }
for (const t of T(/Legends of the EXP lane|Mid lane prodigies/)) for (const r of rows(t)) { const p = at(r.player); if (p) Object.assign((p.allTime ||= {}), { games: num(r.games), w: num(r.won), l: num(r.games) - num(r.won), wr: num(r.WR), kda: num(r["avg KDA"]), debut: r.debut, teams: r.teams, results: r["results by season"] || r.results }); }
// M-series (M1-M6)
for (const t of T(/M-series players with the most games played/)) for (const r of rows(t)) { const p = at(r.Name); if (p) Object.assign((p.mseries ||= {}), { games: num(r.games), wr: num(r.game_WR) }); }
for (const t of T(/M-series players with the most game MVPs/)) for (const r of rows(t)) { const p = at(r.Name); if (p) (p.mseries ||= {}).mvps = num(r.game_mvps); }
// top heroes in MPL PH, all-time
const addHero = (n, h, g, wl) => { const p = at(n); if (!p || !h) return; const [w, l] = String(wl || "").split("-").map(Number); if (!(w + l)) return; const list = (p.heroes ||= []); if (!list.some((x) => key(x.h) === key(h))) list.push({ h: String(h).trim(), g: num(g) || w + l, w, l }); };
for (const t of T(/top 3 heroes in MPL PH|top heroes in MPL PH/)) for (const r of rows(t)) addHero(r.Player || r.player, r.Hero || r.hero, r.Played || r.played, r["W-L"]);
for (const t of T(/All-time MPL PH EXP hero rankings/)) for (const r of rows(t)) addHero(r.player, r.hero, r.games, r["W-L"]);
for (const p of P.values()) if (p.heroes) p.heroes = p.heroes.sort((a, b) => b.g - a.g).slice(0, 5);
const out = Object.fromEntries([...P].filter(([, p]) => p.s16 || p.allTime || p.mseries));
writeJSON(path.join(ROOT, "derived", "mlbb", "career-ph.json"), { built: new Date().toISOString(), source: "MPL PH staff stat posts, MLBB PH News Events and Tournaments group (Facebook)", players: out });
console.log(`career context: ${Object.keys(out).length} players (${Object.values(out).filter((p) => p.s16).length} with a Season 16 line, ${Object.values(out).filter((p) => p.allTime).length} all-time, ${Object.values(out).filter((p) => p.mseries).length} M-series)`);
