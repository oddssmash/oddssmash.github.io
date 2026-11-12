// NBA picks ledger: every pick on the Picks tab (board.json) is frozen at the last run before its game starts, then graded
// against the final box score. Live progress for games in play is worked out in the browser from the live box score.
// Writes data/picks-ledger.json (kept between runs) and public/data/picks-log.json (last 21 days, no sportsbook fields).
// Runs after simulate.mjs.
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON } from "./lib/util.mjs";

const LED = path.join(DATA, "picks-ledger.json"), OUT = path.join(ROOT, "public", "data", "picks-log.json");
const board = readJSON(path.join(ROOT, "public", "data", "board.json"), { picks: [] }), led = readJSON(LED, { format: 1, picks: {} });
const now = Date.now(), DAY = 86400000;
const keyOf = (p) => [p.game, p.fam, p.player?.id || p.team || "game", p.side, p.line].join("|");
const SITE = process.env.SITE_URL || "https://oddssmash.github.io/nba/data";
const getJSON = async (u) => { try { const r = await fetch(u, { headers: { "cache-control": "no-cache" } }); return r.ok ? await r.json() : null; } catch { return null; } };
// 0) the ledger lives in the build cache; if the cache was lost, start again from the published log (last 21 days)
if (!Object.keys(led.picks).length) { const pub = await getJSON(`${SITE}/picks-log.json`); for (const p of pub?.picks || []) led.picks[keyOf({ ...p, player: p.player })] = p; }
// 0b) the Picks list the previous run published is the last pre-tip list for every game that started since then
const prevBoard = await getJSON(`${SITE}/board.json`); let fromPrev = 0;
if (prevBoard?.picks && prevBoard.generated) { const gen = Date.parse(prevBoard.generated);
  for (const p of prevBoard.picks) { const t = Date.parse(p.date); if (!(t > gen && t <= now)) continue; const k = keyOf(p); if (led.picks[k] && led.picks[k].frozen >= prevBoard.generated) continue;
    led.picks[k] = { game: p.game, date: p.date, home: p.home, away: p.away, fam: p.fam, label: p.label, side: p.side, line: p.line, p: p.p, team: p.team || null, player: p.player ? { id: p.player.id, n: p.player.n, t: p.player.t, projMin: p.player.projMin ?? null } : null, hit: p.hit ? { rate: p.hit.rate, band: p.hit.band } : null, frozen: prevBoard.generated, status: "pending" }; fromPrev++; } }
// 1) freeze: picks for games that have not started replace their earlier copy (the last pre-tip run wins)
let frozen = 0;
for (const p of board.picks || []) { if (Date.parse(p.date) <= now) continue; const k = keyOf(p), prev = led.picks[k]; if (prev?.status && prev.status !== "pending") continue;
  led.picks[k] = { game: p.game, date: p.date, home: p.home, away: p.away, fam: p.fam, label: p.label, side: p.side, line: p.line, p: p.p, team: p.team || null, player: p.player ? { id: p.player.id, n: p.player.n, t: p.player.t, projMin: p.player.projMin ?? null } : null, hit: p.hit ? { rate: p.hit.rate, band: p.hit.band } : null, frozen: new Date(now).toISOString(), status: "pending" }; frozen++; }
// picks dropped from the board before tip-off (the chance fell under 85%) are removed if their game has not started
const onBoard = new Set((board.picks || []).filter((p) => Date.parse(p.date) > now).map(keyOf));
for (const [k, p] of Object.entries(led.picks)) if (Date.parse(p.date) > now && p.status === "pending" && !onBoard.has(k)) delete led.picks[k];
// 2) grade from the final box score
const box = new Map(); const game = (id) => { if (!box.has(id)) box.set(id, readJSON(path.join(DATA, "games", `${id}.json`), null)); return box.get(id); };
export function grade(p, g) { // g: { hs, as, home, away, players: [{ id, t, pts, reb, ast, tpm, min, dnp }] }
  const ts = (t) => (String(t) === String(g.home) ? g.hs : g.as), os = (t) => (String(t) === String(g.home) ? g.as : g.hs);
  let actual = null;
  if (["pts", "reb", "ast", "tpm"].includes(p.fam)) { const pl = (g.players || []).find((x) => String(x.id) === String(p.player?.id)); if (!pl || pl.dnp || !pl.min) return { status: "void", actual: null, why: "did not play" }; actual = pl[p.fam]; return { status: actual > p.line ? "hit" : "miss", actual }; }
  if (p.fam === "total") { actual = g.hs + g.as; return { status: (p.side === "over" ? actual > p.line : actual < p.line) ? "hit" : "miss", actual }; }
  if (p.fam === "teamTotal") { actual = ts(p.team); return { status: (p.side === "over" ? actual > p.line : actual < p.line) ? "hit" : "miss", actual }; }
  if (p.fam === "winner") { actual = ts(p.team) - os(p.team); return { status: actual > 0 ? "hit" : "miss", actual }; }
  if (p.fam === "spread") { actual = ts(p.team) - os(p.team); return { status: (p.side === "plus" ? actual + p.line > 0 : actual > p.line) ? "hit" : "miss", actual }; }
  return { status: "pending", actual: null };
}
// why a pick missed, from the final box score (player picks) or the game's own miss explanation (team picks)
function whyMissed(p, g) {
  const out = [], margin = Math.abs((g.hs || 0) - (g.as || 0));
  if (p.player) { const pl = (g.players || []).find((x) => String(x.id) === String(p.player.id)); if (!pl) return null; const need = Math.floor(p.line) + 1, got = pl[p.fam] || 0;
    if (p.player.projMin && pl.min < p.player.projMin * 0.75) out.push(`played ${pl.min} min vs ${Math.round(p.player.projMin)} projected${margin >= 20 ? " (blowout, starters sat late)" : pl.pf >= 5 ? ` (foul trouble: ${pl.pf} fouls)` : ""}`);
    if (p.fam === "pts" && pl.fga >= 6 && pl.fgm / pl.fga < 0.36) out.push(`cold shooting: ${pl.fgm}-${pl.fga} from the field`);
    if (p.fam === "pts" && pl.fga < 6 && pl.min >= 15) out.push(`only ${pl.fga} shots`);
    if (p.fam === "tpm") out.push(`${pl.tpm}-${pl.tpa} from three${pl.tpa <= 2 ? " (few attempts)" : ""}`);
    if (need - got === 1) out.push("missed by one");
    if (!out.length) out.push(`${got} against the ${need} needed in ${pl.min} min`);
    return out.join("; "); }
  const page = readJSON(path.join(ROOT, "public", "data", "games", `${p.game}.json`), null), w = String(page?.headline || "").split("Why: ")[1];
  if (w) return w.trim(); if (margin >= 20) return `blowout (${margin}-point final margin)`; return null;
}
let graded = 0;
for (const p of Object.values(led.picks)) { if (p.status !== "pending") continue; const g = game(p.game); if (!g?.completed) continue; Object.assign(p, grade(p, g)); if (p.status === "miss") p.why = whyMissed(p, g); p.gradedAt = new Date(now).toISOString(); graded++; }
// keep 60 days in the ledger
for (const [k, p] of Object.entries(led.picks)) if (Date.parse(p.date) < now - 60 * DAY) delete led.picks[k];
writeJSON(LED, led);
const recent = Object.values(led.picks).filter((p) => Date.parse(p.date) > now - 21 * DAY).sort((a, b) => b.date.localeCompare(a.date) || b.p - a.p);
const done = recent.filter((p) => p.status === "hit" || p.status === "miss"), hits = done.filter((p) => p.status === "hit").length;
const fams = {}; for (const p of done) { const f = (fams[p.fam] ||= { n: 0, hit: 0 }); f.n++; if (p.status === "hit") f.hit++; }
writeJSON(OUT, { format: 1, note: "Every Picks-tab pick, frozen at the last run before its game started and graded against the final box score. Live progress is worked out in the browser. No sportsbook data.", updated: new Date(now).toISOString(), record: { n: done.length, hit: hits }, byFamily: fams, picks: recent });
console.log(`picks ledger: ${frozen} frozen, ${fromPrev} taken from the published pre-tip list, ${graded} graded; last 21 days ${hits}/${done.length} hit`);
