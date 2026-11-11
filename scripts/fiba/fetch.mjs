// FIBA fetcher. Source: the public event and game pages on fiba.basketball, which carry the schedule,
// box scores (minutes and full counting stats), rosters and play-by-play with shot locations.
// Writes data/fiba/events/<slug>.json (schedule) and data/fiba/games/<gameId>.json (one compact file per
// finished game). Finished games are fetched once; schedules are refreshed every run.
// Betting odds are not fetched: FIBA projections use game data only.
import path from "node:path";
import fs from "node:fs";
import { DATA, readJSON, writeJSON, pool } from "../lib/util.mjs";
import { EVENTS } from "./events.mjs";

const FD = path.join(DATA, "fiba"), GD = path.join(FD, "games"), ED = path.join(FD, "events");
fs.mkdirSync(GD, { recursive: true }); fs.mkdirSync(ED, { recursive: true });
const UA = { "user-agent": "Mozilla/5.0 (oddssmash analyzer)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return await r.text(); if (r.status === 404) return null; } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}
// Next.js pages stream their data as string chunks: self.__next_f.push([1,"..."]). Decode and join them.
function flight(html) {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) { try { out += JSON.parse('"' + m[1] + '"'); } catch { /* skip */ } }
  return out;
}
// The JSON value that follows `"key":` at or after `from` (string-aware bracket matching).
// Occurrences whose value is not an object or array (a label such as "games":"Games") are skipped.
function valueAfter(s, key, from = 0) {
  let k = from - 1, i, open, close;
  for (;;) { k = s.indexOf(`"${key}":`, k + 1); if (k < 0) return null; i = k + key.length + 3; open = s[i]; close = open === "[" ? "]" : open === "{" ? "}" : null; if (close) break; }
  let d = 0, str = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (str) { if (c === "\\") j++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === open) d++; else if (c === close && --d === 0) { try { return { v: JSON.parse(s.slice(i, j + 1)), end: j + 1 }; } catch { return null; } }
  }
  return null;
}
// First occurrence of `"key":` whose value passes `ok` (pages also carry same-named label objects).
function valueWhere(s, key, ok) { let from = 0; for (let n = 0; n < 40; n++) { const r = valueAfter(s, key, from); if (!r) return null; if (ok(r.v)) return r.v; from = r.end; } return null; }
const minutes = (tp) => { if (!tp || typeof tp !== "string") return 0; const [m, s] = tp.split(":").map(Number); return (m || 0) + (s || 0) / 60; };

// ---------------------------------------------------------------- schedules
const all = [];
for (const ev of EVENTS) {
  const html = await page(`https://www.fiba.basketball/en/events/${ev.slug}/games`);
  if (!html) { console.log("event page missing", ev.slug); continue; }
  const f = flight(html); let got = null, from = 0;
  // the page can carry several "games" arrays (widgets); keep the biggest one that has gameId entries
  for (let n = 0; n < 12; n++) { const r = valueAfter(f, "games", from); if (!r) break; from = r.end; if (Array.isArray(r.v) && r.v[0]?.gameId && (!got || r.v.length > got.length)) got = r.v; }
  if (!got) { console.log("no games in", ev.slug); continue; }
  const games = got.map((g) => ({
    id: String(g.gameId), slug: ev.slug, status: g.statusCode, live: !!g.isLive, date: g.gameDateTimeUTC ? g.gameDateTimeUTC.replace(/(\.\d+)?$/, "Z") : null, timed: !!g.hasTimeGameDateTime,
    a: { tid: String(g.teamA?.organisationId ?? g.teamA?.teamId ?? ""), code: g.teamA?.code || "", name: g.teamA?.shortName || g.teamA?.officialName || "TBD", score: g.teamAScore ?? null },
    b: { tid: String(g.teamB?.organisationId ?? g.teamB?.teamId ?? ""), code: g.teamB?.code || "", name: g.teamB?.shortName || g.teamB?.officialName || "TBD", score: g.teamBScore ?? null },
    city: g.hostCity || null, host: g.hostCountryCode || null, venue: g.venueName || null, round: g.round?.roundName || null, roundCode: g.round?.roundCode || null,
    system: g.round?.gameSystemCode || null, group: g.groupPairingCode || null, period: g.currentPeriod || null, postponed: !!g.isPostponed,
  })).filter((g) => g.date && !g.date.startsWith("0001"));
  writeJSON(path.join(ED, `${ev.slug}.json`), { slug: ev.slug, name: ev.name, short: ev.short, kind: ev.kind, fetched: new Date().toISOString(), games });
  console.log(ev.slug, games.length, "games");
  for (const g of games) all.push({ ...g, ev });
  await sleep(400);
}

// ---------------------------------------------------------------- finished games: box score, roster, shots
function parseGame(html, g) {
  const f = flight(html);
  const det = valueWhere(f, "gameDetails", (v) => Array.isArray(v?.c) && v.c[0]?.Children)?.c; if (!Array.isArray(det) || det.length < 2) return null;
  const roster = {}; for (const k of ["playersTeamA", "playersTeamB"]) for (const p of valueWhere(f, k, (v) => Array.isArray(v) && v[0]?.personId) || []) roster[p.personId] = p;
  const side = [g.a, g.b], players = [];
  det.forEach((t, si) => {
    for (const c of t.Children || []) {
      const s = c.Stats; if (!s || typeof s !== "object" || !s.HasPlayed) continue;
      const pid = c.Id.replace(/^P_/, ""), r = roster[pid] || {};
      players.push({ pid, n: [r.firstName, r.lastName].filter(Boolean).join(" ") || pid, pos: r.position || "", no: r.uniformNumber || "", side: si, start: !!s.Starter,
        min: Math.round(minutes(s.TP) * 10) / 10, pts: s.PTS | 0, reb: s.REB | 0, or: s.OR | 0, dr: s.DR | 0, ast: s.AS | 0, stl: s.ST | 0, blk: s.BS | 0, to: s.TO | 0, pf: s.PF | 0, fd: s.FD | 0,
        fga: s.FGA | 0, fgm: s.FGM | 0, f3a: s.FG3A | 0, f3m: s.FG3M | 0, fta: s.FTA | 0, ftm: s.FTM | 0, pm: s.PM | 0, eff: s.EFF | 0 });
    }
  });
  if (!players.length) return null;
  const periods = (det[0].Periods || []).map((p, i) => [p.Score ?? null, det[1].Periods?.[i]?.Score ?? null]);
  // play-by-play shots: [pid, side, period, x, y, made, pts, secondsLeft]
  const shots = [], pbp = valueWhere(f, "playByPlay", (v) => v?.items && typeof v.items === "object" && !Array.isArray(v.items))?.items || {}, orgOf = { [String(det[0].Id).replace(/^T_/, "")]: 0, [String(det[1].Id).replace(/^T_/, "")]: 1 };
  Object.keys(pbp).forEach((per, pi) => {
    for (const a of pbp[per]?.items || []) if (a.act === "shot" && a.x != null && a.y != null) {
      const [mm, ss] = String(a.Time || "0:0").split(":").map(Number);
      shots.push([String(a.pId), orgOf[String(a.oId)] ?? -1, pi + 1, a.x, a.y, a.made ? 1 : 0, a.pts || (/3pt|P3/.test(a.ac + a.txt) ? 3 : 2), (mm || 0) * 60 + (ss || 0)]);
    }
  });
  return { id: g.id, slug: g.slug, date: g.date, city: g.city, host: g.host, system: g.system, round: g.round, roundCode: g.roundCode,
    teams: [{ ...g.a, tid: String(det[0].Id).replace(/^T_/, "") || g.a.tid, score: det[0].Score ?? g.a.score }, { ...g.b, tid: String(det[1].Id).replace(/^T_/, "") || g.b.tid, score: det[1].Score ?? g.b.score }],
    periods, players, shots };
}
const todo = all.filter((g) => g.status === "VALID" && g.a.score != null && (g.a.score || g.b.score) && !fs.existsSync(path.join(GD, `${g.id}.json`)));
console.log("finished games to fetch:", todo.length);
let ok = 0, bad = 0;
await pool(todo, 4, async (g) => {
  const url = `https://www.fiba.basketball/en/events/${g.slug}/games/${g.id}-${encodeURIComponent(g.a.code || "A")}-${encodeURIComponent(g.b.code || "B")}`;
  const html = await page(url); const rec = html && parseGame(html, g);
  if (rec) { writeJSON(path.join(GD, `${g.id}.json`), rec); ok++; } else { bad++; console.log("no box score", g.id, g.slug, g.a.code, g.b.code); }
  if ((ok + bad) % 50 === 0) console.log(`  ${ok + bad}/${todo.length}`);
});
console.log(`fetched ${ok} games, ${bad} without a box score`);

// ---------------------------------------------------------------- announced rosters for upcoming games
// FIBA posts each team's 12 on the game page before tip-off (national teams usually a few days before a window). Check games in the next 21 days every run (every 3 hours);
// once a roster is there it replaces "last game's roster" in the projections.
const RD = path.join(FD, "rosters"); fs.mkdirSync(RD, { recursive: true });
const soon = all.filter((g) => g.status !== "VALID" && Date.parse(g.date) > Date.now() - 3 * 3600000 && Date.parse(g.date) < Date.now() + 21 * 86400000 && g.a.code && g.b.code);
let rosters = 0;
await pool(soon, 4, async (g) => {
  const html = await page(`https://www.fiba.basketball/en/events/${g.slug}/games/${g.id}-${encodeURIComponent(g.a.code)}-${encodeURIComponent(g.b.code)}`); if (!html) return;
  const f = flight(html), pick = (k) => (valueWhere(f, k, (v) => Array.isArray(v) && v[0]?.personId) || []).map((p) => ({ pid: String(p.personId), n: [p.firstName, p.lastName].filter(Boolean).join(" "), pos: p.position || "", no: p.uniformNumber || "", captain: !!p.isCaptain }));
  const a = pick("playersTeamA"), b = pick("playersTeamB");
  if (a.length || b.length) { writeJSON(path.join(RD, `${g.id}.json`), { id: g.id, fetched: new Date().toISOString(), a, b }); rosters++; }
});
console.log(`announced rosters found for ${rosters} of ${soon.length} games in the next 21 days`);
writeJSON(path.join(FD, "fetch-meta.json"), { fetched: new Date().toISOString(), events: EVENTS.length, source: "fiba.basketball public event and game pages (schedule, box scores, play-by-play with shot locations). No betting data." });
