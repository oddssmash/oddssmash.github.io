// One-off, run locally: derive per-player numbers from official league stat graphics (MLBB Esports MENA and MPL Cambodia
// Facebook pages, read by the research session). Only derived numbers are written; the raw rows stay private.
//  - MPL MENA S10 scoreboards: K/D/A, kill participation, gold share and gold per minute per player; hero, side and winner
//    joined from our Liquipedia games by teams, stage and game number (games with two possible matches are skipped).
//  - MPL KH S11 season leaderboards: each player's top-10 ranks.
// Usage: node scripts/mlbb/derive-facebook.mjs <folder with the facebook-*.csv files>
import fs from "node:fs";
import path from "node:path";
import { DATA, writeJSON } from "../lib/util.mjs";

const dir = process.argv[2]; if (!dir) { console.log("usage: derive-facebook.mjs <folder>"); process.exit(1); }
const MD = path.join(DATA, "mlbb"), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"];
const csv = (f) => { const t = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean), H = t[0].split(","); return t.slice(1).map((r) => { const c = r.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "")); return Object.fromEntries(H.map((k, i) => [k, c[i]])); }); };
const nk = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// hero short forms on some match pages -> the hero ids the site uses
const IDS = JSON.parse(fs.readFileSync(path.join(path.dirname(DATA), "public-mlbb", "data", "heroes.json"), "utf8")).map((h) => h.id);
const SHORT = { paq: "paquito", yss: "yi sun-shin", yz: "yu zhong", rafa: "rafaela", dyr: "dyrroth", kag: "kagura", khu: "khufra", xb: "x.borg", zx: "zhuxin", bea: "beatrix", leo: "leomord", wan: "wanwan", tig: "tigreal", hel: "helcurt", jaw: "jawhead", bal: "balmond", sil: "silvanna", vale: "valentina", lapu: "lapu-lapu" };
const heroId = (x) => { const l = String(x || "").toLowerCase(); if (SHORT[l]) return SHORT[l]; const e = IDS.find((i) => nk(i) === nk(l)); if (e) return e; const p = IDS.filter((i) => nk(i).startsWith(nk(l))); return p.length === 1 ? p[0] : l; };
// ---- MENA S10
const CODE = { FLCN: "Team Falcons", TEC: "Titan Esports Club AR", GK: "Geekay Esports", XP: "XProjekt Esports", TWIS: "Twisted Minds", GS: "GS Team", WOD: "Will of D", XO: "Axe Okami" };
const games = csv("facebook-mpl-mena-s10-scoreboards-games.csv"), rows = csv("facebook-mpl-mena-s10-scoreboards-players.csv");
const lp = []; for (const f of ["MPL_MENA_Season_10_Regular_Season", "MPL_MENA_Season_10_Playoffs"]) { const pg = JSON.parse(fs.readFileSync(path.join(MD, "pages", `${f}.json`), "utf8")); for (const m of pg.matches) lp.push({ ...m, stageKey: /Playoffs/.test(f) ? "Playoffs" : "Regular Season" }); }
const roster = (() => { try { return JSON.parse(fs.readFileSync(path.join(MD, "rosters", "MPL_MENA_Season_10.json"), "utf8")).teams || {}; } catch { return {}; } })();
const roleOf = (team, player) => { const k = Object.keys(roster).find((t) => nk(t) === nk(team)); const r = (roster[k] || []).find((x) => nk(x.player) === nk(player)); return r?.role || null; };
const join = new Map(); let skipped = 0;
for (const g of games) { const A = CODE[g.team_left], B = CODE[g.team_right]; const cand = lp.filter((m) => m.stageKey === (/Play/i.test(g.stage) ? "Playoffs" : "Regular Season") && [nk(m.a), nk(m.b)].sort().join() === [nk(A), nk(B)].sort().join());
  if (cand.length !== 1) { skipped++; continue; } const m = cand[0], x = m.games.find((q) => q.n === +g.game_no); if (!x) { skipped++; continue; } join.set(g.game_id, { m, x }); }
const P = {};
for (const r of rows) { const key = nk(r.player), j = join.get(r.game_id), team = CODE[r.team] || r.team, [mm, ss] = String(r.duration || "").split(":").map(Number), min = mm + (ss || 0) / 60;
  const p = (P[key] ||= { player: r.player, team, games: 0, wins: 0, joined: 0, k: 0, d: 0, a: 0, kp: 0, gs: 0, gpm: 0, heroes: {} }); p.games++; p.k += +r.kills; p.d += +r.deaths; p.a += +r.assists; p.kp += +r.kill_participation_pct; p.gs += +r.gold_share_pct; if (min) p.gpm += +r.gold / min;
  if (j) { const one = nk(j.m.a) === nk(team), won = (j.x.w === 1) === one; p.joined++; if (won) p.wins++; const role = roleOf(team, r.player), i = ROLES.indexOf(role), hero = i >= 0 ? heroId((one ? j.x.h1 : j.x.h2)?.[i]) : null; if (hero) { const h = (p.heroes[hero] ||= { n: 0, w: 0 }); h.n++; if (won) h.w++; } } }
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000, out = {};
for (const [k, p] of Object.entries(P)) { const n = p.games; out[k] = { player: p.player, league: "MPL MENA", season: "S10", team: p.team, games: p.joined, wins: p.wins, kills: r1(p.k / n), deaths: r1(p.d / n), assists: r1(p.a / n), kp: r3(p.kp / n / 100), goldShare: r3(p.gs / n / 100), gpm: Math.round(p.gpm / n), dpm: null, dmgShare: null, scoreboards: n, heroes: Object.entries(p.heroes).map(([h, v]) => ({ h, n: v.n, w: v.w })).sort((a, b) => b.n - a.n) }; }
writeJSON(path.join(MD, "mena-s10-players.json"), { source: "MLBB Esports MENA (official league page) scoreboard graphics, MPL MENA Season 10; derived per-player numbers; heroes and wins from Liquipedia", games: games.length, joined: join.size, players: out });
console.log(`MENA S10: ${Object.keys(out).length} players from ${games.length} scoreboards; ${join.size} joined to Liquipedia, ${skipped} skipped (no single match)`);
// ---- KH S11 leaderboards
const LB = { mvp_points: "MVP points", kda_points: "KDA points", kills: "Kills", assists: "Assists", hero_damage: "Hero damage", damage_taken: "Damage taken", turret_damage: "Turret damage" };
const kh = {}; for (const r of csv("facebook-mpl-kh-s11-season-leaderboards.csv")) (kh[nk(r.player)] ||= { player: r.player, ranks: [] }).ranks.push({ stat: LB[r.stat] || r.stat, rank: +r.rank, value: +r.value });
writeJSON(path.join(MD, "kh-s11-leaders.json"), { source: "MPL Cambodia (official league page), Season 11 regular-season top-10 leaderboards", players: kh });
console.log(`KH S11 leaderboards: ${Object.keys(kh).length} players`);
