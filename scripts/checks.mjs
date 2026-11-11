// Data anomaly checks, run after fetch.mjs and before model.mjs:
//   node scripts/fetch.mjs pregame && node scripts/checks.mjs && node scripts/model.mjs
// Prints a short report and writes data/checks.json. Reads only local files (no network).
// Exit code 1 only for problems that would make projections wrong (level "error"); warnings and
// notes never stop a refresh. Layout of data/checks.json: docs/DATA-RAW.md, section "checks.json".
// Options: --quiet (errors and the summary line only), --json (print the JSON instead of the report).
import fs from "node:fs";
import path from "node:path";
import { DATA, PUBLIC_DATA, readJSON, writeJSON } from "./lib/util.mjs";
import { normName, etDay } from "./lib/stats.mjs";
import { teamBox } from "./lib/boxfix.mjs";

const NOW = Date.now();
const H = 3600e3, D = 864e5;
const args = new Set(process.argv.slice(2));
const checks = [];
// level: error (projections would be wrong), warn (worth a look), note (information), ok
function add(id, level, title, detail, examples = [], count = examples.length) {
  checks.push({ id, level, title, count, detail, examples: examples.slice(0, 8) });
}
const ageH = (iso) => (NOW - Date.parse(iso)) / H;
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []);

// ---------- core files ----------
const teams = readJSON(path.join(DATA, "teams.json"), null);
const rosters = readJSON(path.join(DATA, "rosters.json"), null);
const injFile = readJSON(path.join(DATA, "injuries.json"), null);
const pregame = readJSON(path.join(DATA, "pregame.json"), {});
const logs = readJSON(path.join(DATA, "nbagamelogs.json"), {});
const idMap = readJSON(path.join(DATA, "nbaids.json"), { map: {}, names: {} });
const gameIds = readJSON(path.join(DATA, "nbagameids.json"), { map: {}, missing: [] });
{
  const bad = [];
  if (!Array.isArray(teams) || teams.length !== 30) bad.push(`teams.json: ${Array.isArray(teams) ? teams.length + " teams" : "unreadable"}`);
  if (!rosters || Object.keys(rosters).length < 30) bad.push(`rosters.json: ${rosters ? Object.keys(rosters).length + " teams" : "unreadable"}`);
  for (const [tid, t] of Object.entries(rosters || {})) if ((t.players || []).length < 10) bad.push(`roster of team ${tid}: ${(t.players || []).length} players`);
  if (!injFile || !Array.isArray(injFile.list)) bad.push("injuries.json unreadable");
  add("core-files", bad.length ? "error" : "ok", "Core files readable and complete", bad.length ? "A core file is missing or short: availability and rosters would be wrong." : "teams, rosters (30 teams, 10+ players each) and injuries read fine.", bad);
}
const teamName = new Map((teams || []).map((t) => [t.id, t.abbr]));
const tn = (id) => teamName.get(String(id)) || id;

// ---------- schedule ----------
const events = [];
for (const f of files(path.join(DATA, "schedule"))) for (const e of readJSON(path.join(DATA, "schedule", f), [])) events.push(e);
const byId = new Map(events.map((e) => [String(e.id), e]));
const done = events.filter((e) => e.completed).sort((a, b) => a.date.localeCompare(b.date));
const upcoming = events.filter((e) => !e.completed && !/POSTPONED|CANCELED/.test(e.status || "") && Date.parse(e.date) > NOW - 6 * H);
{
  const month = new Date().getUTCMonth() + 1;
  const offseason = month >= 7 && month <= 9;
  const week = upcoming.filter((e) => Date.parse(e.date) < NOW + 7 * D);
  const stuck = events.filter((e) => !e.completed && !/POSTPONED|CANCELED/.test(e.status || "") && Date.parse(e.date) < NOW - 6 * H && Date.parse(e.date) > NOW - 3 * D);
  const todayFile = path.join(DATA, "schedule", `${etDay(new Date().toISOString()).replace(/-/g, "")}.json`);
  const schedAge = fs.existsSync(todayFile) ? (NOW - fs.statSync(todayFile).mtimeMs) / H : Infinity;
  const ex = stuck.map((e) => `${e.id} ${tn(e.away)} at ${tn(e.home)} ${e.date} still "${e.status}"`);
  if (!offseason && !week.length) ex.push("no games scheduled in the next 7 days");
  if (schedAge > 12) ex.push(`today's schedule file is ${Number.isFinite(schedAge) ? Math.round(schedAge) + " hours old" : "missing"}`);
  // a game that tipped off more than 6 hours ago but is not marked final means the walk-forward misses its result
  add("schedule", stuck.length ? "error" : ex.length ? "warn" : "ok", "Schedule is current",
    stuck.length ? "Games that should be over are not marked final: their results are missing from the learning and from rest-day counts." : ex.length ? "Schedule coverage looks thin or old." : `${week.length} games in the next 7 days; today's schedule refreshed ${Math.round(schedAge * 10) / 10} h ago.`, ex);
}

// ---------- missing and partial games ----------
// ESPN answers "not found" for these summaries (docs/DATA-RAW.md): walked by final score only.
const KNOWN_404 = new Set(["401869391", "401869377", "401869373", "401869402", "401871334", "401871154", "401871337", "401873343"]);
const box = new Map();
for (const f of files(path.join(DATA, "games"))) { const g = readJSON(path.join(DATA, "games", f)); if (g) box.set(String(g.id), g); else box.set(f.replace(".json", ""), null); }
{
  const recentMissing = [], oldMissing = [], known = [];
  for (const e of done) {
    if (box.has(String(e.id))) continue;
    const h = ageH(e.date);
    if (KNOWN_404.has(String(e.id))) known.push(e.id);
    else if (h > 12 && h < 7 * 24) recentMissing.push(`${e.id} ${tn(e.away)} at ${tn(e.home)} ${etDay(e.date)}`);
    else if (h >= 7 * 24) oldMissing.push(`${e.id} ${tn(e.away)} at ${tn(e.home)} ${etDay(e.date)}`);
  }
  const unreadable = [...box.entries()].filter(([, g]) => g === null).map(([id]) => `${id}: file unreadable`);
  add("missing-games", recentMissing.length || unreadable.length ? "error" : oldMissing.length ? "warn" : "ok", "Every finished game has a box score",
    `${done.length} finished games, ${box.size} box scores. ${known.length} known ESPN gaps (8 playoff games of 2025-26, walked by final score only).` +
    (recentMissing.length ? " Games from the last 7 days without a box score: the newest form, minutes and injuries would be missing." : "") +
    (oldMissing.length ? ` ${oldMissing.length} older games without a box score (score-only in the back-test).` : ""),
    [...unreadable, ...recentMissing, ...oldMissing], unreadable.length + recentMissing.length + oldMissing.length);

  const partial = [], repaired = [], scoreDiff = [], minutes = [];
  for (const e of done) {
    const g = box.get(String(e.id));
    if (!g) continue;
    const recent = ageH(e.date) < 7 * 24;
    const exp = 240 + 25 * Math.max(0, (g.periods || 4) - 4);
    if ((g.hs !== e.hs || g.as !== e.as) && e.hs + e.as > 0) scoreDiff.push({ recent, s: `${e.id} schedule ${e.as}-${e.hs}, box file ${g.as}-${g.hs}` });
    for (const [tid, sc] of [[e.home, e.hs], [e.away, e.as]]) {
      const ps = (g.players || []).filter((p) => String(p.t) === String(tid));
      const played = ps.filter((p) => p.min > 0);
      const tb = teamBox(g, tid);
      const teamPts = tb ? 2 * tb.fgm + tb.tpm + tb.ftm : null;
      const sumPts = ps.reduce((a, p) => a + (p.pts || 0), 0);
      const sumMin = ps.reduce((a, p) => a + (p.min || 0), 0);
      const blank = ps.some((p) => !p.id);
      if (played.length < 5 || (teamPts !== null && teamPts !== sc)) partial.push({ recent, s: `${e.id} ${tn(tid)}: ${played.length} players with minutes, team row ${teamPts ?? "missing"} pts vs final ${sc}` });
      else if (sumPts !== sc) (blank ? repaired : partial).push({ recent, s: `${e.id} ${tn(tid)}: players add up to ${sumPts}, final ${sc}${blank ? " (blank ESPN row, rebuilt when the model loads it)" : ""}` });
      else if (Math.abs(sumMin - exp) > 10) minutes.push({ recent, s: `${e.id} ${tn(tid)}: player minutes add up to ${sumMin}, expected about ${exp}` });
    }
  }
  const bad = [...partial, ...scoreDiff];
  add("partial-games", bad.some((x) => x.recent) ? "error" : bad.length ? "warn" : "ok", "Box scores are complete and agree with the final score",
    bad.length ? "Some box scores do not add up to the final score (partial download or a later score correction). Recent ones would feed wrong numbers into the learning." : "Every box score's team row and player rows add up to the final score.",
    bad.map((x) => x.s), bad.length);
  add("repaired-rows", repaired.length ? "note" : "ok", "Blank ESPN box rows (repaired at load time)", `${repaired.length} team-games have a box row with no player; scripts/lib/boxfix.mjs rebuilds it from the team row and the NBA.com game log.`, repaired.map((x) => x.s), repaired.length);
  add("minutes", minutes.some((x) => x.recent) ? "warn" : minutes.length ? "note" : "ok", "Player minutes add up to the game length", minutes.length ? "Minutes in these box scores are off by more than 10 from 240 (+25 per overtime)." : "All team-games within 10 minutes of the game length.", minutes.map((x) => x.s), minutes.length);
}

// ---------- play-by-play vs box score ----------
{
  const pbpFiles = new Set(files(path.join(DATA, "pbp")).map((f) => f.replace(".json", "")));
  const missing = [], empty = [], gaps = [], final = [], playerDiff = [];
  let compared = 0, pg = 0;
  for (const e of done) {
    const g = box.get(String(e.id));
    if (!g) continue;
    if (!pbpFiles.has(String(e.id))) { if (ageH(e.date) > 12) missing.push(`${e.id} ${etDay(e.date)}`); continue; }
    const p = readJSON(path.join(DATA, "pbp", `${e.id}.json`));
    if (!p) { missing.push(`${e.id}: unreadable`); continue; }
    if (p.np) { empty.push(`${e.id} ${etDay(e.date)}`); continue; }
    if (p.gap) gaps.push(`${e.id}: plays short of the final score by ${p.gap[0]} (home) / ${p.gap[1]} (away)`);
    const last = (p.sc || []).at(-1);
    if (last && !p.gap && (last[2] !== e.hs || last[3] !== e.as)) final.push(`${e.id}: plays end ${last[3]}-${last[2]}, final ${e.as}-${e.hs}`);
    // per player points
    const pts = new Map();
    for (const s of p.shots || []) if (s[8]) pts.set(String(s[0]), (pts.get(String(s[0])) || 0) + s[7]);
    for (const f of p.ft || []) if (f[4]) pts.set(String(f[0]), (pts.get(String(f[0])) || 0) + 1);
    compared++;
    for (const pl of g.players || []) {
      if (!pl.id || !(pl.min > 0)) continue;
      pg++;
      const v = pts.get(String(pl.id)) || 0;
      if (v !== pl.pts) playerDiff.push({ recent: ageH(e.date) < 7 * 24, s: `${e.id} ${pl.n}: box ${pl.pts}, plays ${v}` });
    }
  }
  const share = pg ? Math.round((playerDiff.length / pg) * 10000) / 100 : 0;
  const recentBad = final.length || playerDiff.filter((x) => x.recent).length > 3;
  add("pbp-vs-box", missing.length || recentBad ? "warn" : "ok", "Play-by-play agrees with the box score",
    `${compared} games compared. Player points differ in ${playerDiff.length} of ${pg} player-games (${share}%). ${gaps.length} games have plays that do not add up to the final score (flagged "gap" in the file), ${empty.length} games had no plays on ESPN.` +
    (missing.length ? ` ${missing.length} games with a box score but no play-by-play file (zones and lineups skip them).` : ""),
    [...missing.map((m) => `no play-by-play: ${m}`), ...final, ...playerDiff.filter((x) => x.recent).map((x) => x.s), ...gaps], missing.length + final.length + playerDiff.length);
}

// ---------- name mapping ----------
{
  const ex = [];
  // injury entries that cannot be tied to a rostered player (the model ignores them)
  const rosterIds = new Map(), rosterNames = new Map();
  for (const [tid, t] of Object.entries(rosters || {})) for (const p of t.players || []) { rosterIds.set(String(p.id), tid); rosterNames.set(`${tid}|${normName(p.n)}`, String(p.id)); }
  const injUnmatched = (injFile?.list || []).filter((i) => !(i.id && rosterIds.has(String(i.id))) && !rosterNames.has(`${i.team}|${normName(i.n)}`));
  for (const i of injUnmatched) ex.push(`injury list: ${i.n} (${tn(i.team)}, ${i.status}) not on that team's roster - ignored by the model`);
  // same normalised name twice in one team
  for (const [tid, t] of Object.entries(rosters || {})) {
    const seen = new Map();
    for (const p of t.players || []) { const k = normName(p.n); if (seen.has(k)) ex.push(`roster ${tn(tid)}: ${seen.get(k)} and ${p.n} share the normalised name "${k}"`); seen.set(k, p.n); }
  }
  // NBA.com -> ESPN ids: two NBA.com players on one ESPN id
  const rev = new Map();
  for (const [nba, espn] of Object.entries(idMap.map || {})) { if (rev.has(espn)) ex.push(`nbaids.json: NBA.com ${rev.get(espn)} and ${nba} (${idMap.names?.[nba] || "?"}) both point to ESPN ${espn}`); else rev.set(espn, nba); }
  // matchup rows that kept an NBA.com id
  const un = new Map();
  let muFiles = 0;
  for (const f of files(path.join(DATA, "matchups"))) { const j = readJSON(path.join(DATA, "matchups", f)); muFiles++; for (const [pid, name, tid] of j?.un || []) un.set(pid, `${name} (${tn(tid)})`); }
  for (const [pid, s] of un) ex.push(`matchups: NBA.com player ${pid} ${s} not matched to an ESPN id (rows kept as nba:${pid})`);
  // NBA.com game-log names that never match an ESPN box-score name on the same date (affects the box-score cross-check and blank-row repair)
  // compared per date and team, and only where ESPN has that team's box score that day
  const NBA_ABBR = { GSW: "GS", NYK: "NY", SAS: "SA", NOP: "NO", UTA: "UTAH", WAS: "WSH" };
  const espnByDay = new Map(), blankDay = new Set(), logBlank = new Map();
  for (const g of box.values()) {
    if (!g) continue;
    const d = etDay(g.date);
    for (const p of g.players || []) { const k = `${d}|${tn(p.t)}`; if (!espnByDay.has(k)) espnByDay.set(k, new Set()); if (p.n) espnByDay.get(k).add(normName(p.n)); else blankDay.add(k); }
  }
  const logMiss = new Map();
  for (const rows of Object.values(logs)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) { const s = espnByDay.get(`${r[0]}|${NBA_ABBR[r[2]] || r[2]}`); if (s && r[3] > 0 && !s.has(normName(r[1]))) { logMiss.set(r[1], (logMiss.get(r[1]) || 0) + 1); if (blankDay.has(`${r[0]}|${NBA_ABBR[r[2]] || r[2]}`)) logBlank.set(r[1], (logBlank.get(r[1]) || 0) + 1); } }
  }
  for (const [n, c] of [...logMiss].sort((a, b) => b[1] - a[1])) ex.push(`NBA.com game log name "${n}" matches no ESPN name on ${c} game day${c === 1 ? "" : "s"}${logBlank.get(n) ? ` (${logBlank.get(n)} of them with a blank ESPN box row for his team: boxfix.mjs rebuilds that row from this log)` : ""}`);
  add("name-mapping", ex.length ? "warn" : "ok", "Names map between sources",
    `${injUnmatched.length} injury entries not on a roster, ${un.size} NBA.com matchup players without an ESPN id (in ${muFiles} matchup files), ${logMiss.size} NBA.com game-log names without an ESPN match, ${Object.keys(idMap.map || {}).length} NBA.com ids mapped.`, ex, ex.length);
}

// ---------- injury list freshness, players listed out who played ----------
const soon = upcoming.filter((e) => Date.parse(e.date) < NOW + 30 * H);
const playsSoon = new Set(soon.flatMap((e) => [e.home, e.away]));
{
  const age = injFile?.fetched ? ageH(injFile.fetched) : Infinity;
  const stale = age > 36 && soon.length;
  add("injuries-fresh", stale ? "error" : age > 12 ? "warn" : "ok", "Injury list is fresh",
    `ESPN injury list fetched ${Number.isFinite(age) ? Math.round(age * 10) / 10 + " hours ago" : "never"}; ${soon.length} games in the next 30 hours.` + (stale ? " Availability for those games would be guessed from an old list." : ""), []);

  // last game each player appeared in (minutes > 0)
  const lastPlayed = new Map();
  for (const e of done) { const g = box.get(String(e.id)); if (!g) continue; for (const p of g.players || []) if (p.id && p.min > 0) lastPlayed.set(String(p.id), e); }
  const errs = [], warns = [];
  for (const i of injFile?.list || []) {
    if (!/out|doubtful/i.test(i.status || "") || !i.id || !i.date) continue;
    const e = lastPlayed.get(String(i.id));
    // listed out, last update more than 2 hours before a game he then played in: the entry is stale
    if (e && Date.parse(e.date) > Date.parse(i.date) + 2 * H) {
      const s = `${i.n} (${tn(i.team)}) listed "${i.status}" since ${i.date.slice(0, 10)} but played ${etDay(e.date)} (${e.id})`;
      (playsSoon.has(String(i.team)) ? errs : warns).push(s);
    }
  }
  // the list ESPN keeps with each box score: listed out, yet played that game (last 30 days, not
  // preseason). ESPN's list is as of the download, which is after the game, so a player hurt in
  // that game shows up here too: a note, not a fault.
  const gameTime = [];
  for (const e of done) {
    if (ageH(e.date) > 30 * 24 || e.stype === 1) continue;
    const g = box.get(String(e.id)); if (!g) continue;
    for (const i of g.inj || []) { if (!/^out$/i.test(i.s || "")) continue; const p = (g.players || []).find((x) => String(x.id) === String(i.id)); if (p && p.min > 0) gameTime.push(`${i.n} listed Out for ${e.id} (${etDay(e.date)}) but played ${p.min} min`); }
  }
  add("out-but-played", errs.length ? "error" : warns.length ? "warn" : gameTime.length ? "note" : "ok", "Players listed out did not play",
    errs.length ? "A player the injury list calls out has played since that entry, and his team plays in the next 30 hours: the model would leave him out." : `${warns.length} stale out entries on the current injury list (teams not playing in the next 30 hours). ${gameTime.length} players in the last 30 days played in a game whose stored ESPN list calls them out (that list is saved after the game, so it can include an injury from the game itself).`,
    [...errs, ...warns, ...gameTime], errs.length + warns.length + gameTime.length);
}

// ---------- conflicting sources ----------
{
  const errs = [], warns = [], notes = [];
  // NBA.com line-ups vs ESPN injury list for games in the next 30 hours
  for (const e of soon) {
    const pg = pregame[e.id];
    if (!pg?.lineups) continue;
    for (const side of ["home", "away"]) {
      const L = pg.lineups[side];
      const tid = side === "home" ? e.home : e.away;
      for (const st of L.starters || []) {
        const inj = (injFile?.list || []).find((i) => String(i.id) === String(st.id) || (String(i.team) === String(tid) && normName(i.n) === normName(st.n)));
        if (inj && /out|doubtful/i.test(inj.status || "") && !(inj.returnDate && inj.returnDate <= etDay(e.date))) {
          (st.status === "confirmed" ? errs : warns).push(`${st.n} (${tn(tid)}) is a ${st.status} NBA.com starter for ${e.id} but ESPN lists him "${inj.status}"`);
        }
      }
      for (const p of pg.late || []) if (String(p.t) === String(tid)) notes.push(`late scratch: ${p.n} (${tn(tid)}) on NBA.com's inactive list for ${e.id}, ESPN injury status "${p.injury || "not listed"}"`);
    }
  }
  // ESPN box score vs NBA.com official game log (points), by date and name
  const logIdx = new Map();
  for (const rows of Object.values(logs)) if (Array.isArray(rows)) for (const r of rows) logIdx.set(`${r[0]}|${normName(r[1])}`, r);
  let cmp = 0; const ptsDiff = [];
  for (const g of box.values()) {
    if (!g) continue;
    const d = etDay(g.date);
    for (const p of g.players || []) {
      if (!p.id || !(p.min > 0)) continue;
      const r = logIdx.get(`${d}|${normName(p.n)}`);
      if (!r) continue;
      cmp++;
      if (r[4] !== p.pts) ptsDiff.push({ recent: ageH(g.date) < 7 * 24, s: `${g.id} ${p.n}: ESPN ${p.pts} pts, NBA.com ${r[4]}` });
    }
  }
  for (const x of ptsDiff) (x.recent ? warns : notes).push(x.s);
  // matchup tracking vs the final score
  let muGames = 0, low = 0;
  for (const f of files(path.join(DATA, "matchups"))) {
    const j = readJSON(path.join(DATA, "matchups", f));
    if (!j || j.empty) continue;
    const e = byId.get(String(j.id)); if (!e) continue;
    muGames++;
    const s = [0, 0];
    for (const r of j.rows) s[r[0]] += r[5];
    const share = Math.min(s[0] / (e.hs || 1), s[1] / (e.as || 1));
    if (share < 0.8) { low++; notes.push(`matchups ${j.id}: tracked points cover ${Math.round(share * 100)}% of a team's score (${s[1]}/${e.as} away, ${s[0]}/${e.hs} home)`); }
  }
  add("conflicts", errs.length ? "error" : warns.length ? "warn" : notes.length ? "note" : "ok", "Sources agree",
    `ESPN vs NBA.com game-log points: ${ptsDiff.length} differences in ${cmp} player-games. Matchup tracking: ${low} of ${muGames} games cover less than 80% of a team's points. ${(errs.length + warns.length)} line-up vs injury-list conflicts for games in the next 30 hours.` +
    (errs.length ? " A confirmed starter is listed out by ESPN: the model would leave out a player who is starting." : ""),
    [...errs, ...warns, ...notes], errs.length + warns.length + notes.length);
}

// ---------- game-day coverage ----------
{
  const noCrew = soon.filter((e) => !pregame[e.id]?.officials?.length).map((e) => `${e.id} ${tn(e.away)} at ${tn(e.home)}: no referee crew yet`);
  const conf = (e) => pregame[e.id]?.lineups?.home?.status === "confirmed" && pregame[e.id]?.lineups?.away?.status === "confirmed";
  const noLineup = soon.filter((e) => Date.parse(e.date) - NOW < 1 * H && !conf(e)).map((e) => `${e.id} ${tn(e.away)} at ${tn(e.home)}: tips off within the hour, starters not confirmed in pregame.json`);
  noCrew.push(...soon.filter((e) => Date.parse(e.date) - NOW >= 1 * H && Date.parse(e.date) - NOW < 3 * H && !conf(e)).map((e) => `${e.id} ${tn(e.away)} at ${tn(e.home)}: within 3 hours, starters expected but not confirmed yet`));
  const pgAge = fs.existsSync(path.join(DATA, "pregame.json")) ? (NOW - fs.statSync(path.join(DATA, "pregame.json")).mtimeMs) / H : Infinity;
  if (soon.length && pgAge > 6) noLineup.unshift(`pregame.json last written ${Number.isFinite(pgAge) ? Math.round(pgAge) + " hours ago" : "never"} - run node scripts/fetch.mjs pregame`);
  add("game-day", noLineup.length ? "warn" : noCrew.length ? "note" : "ok", "Game-day details (crews, starters) for the next 30 hours",
    `${soon.length} games in the next 30 hours: ${soon.filter((e) => pregame[e.id]?.officials?.length).length} with a referee crew, ${soon.filter((e) => pregame[e.id]?.lineups).length} with NBA.com line-ups (${soon.filter((e) => pregame[e.id]?.lineups?.home?.status === "confirmed" && pregame[e.id]?.lineups?.away?.status === "confirmed").length} confirmed).`,
    [...noLineup, ...noCrew], noLineup.length + noCrew.length);
}

// ---------- matchup coverage ----------
{
  const have = new Set(files(path.join(DATA, "matchups")).map((f) => f.replace(".json", "")));
  let empty = 0;
  for (const id of have) if (readJSON(path.join(DATA, "matchups", `${id}.json`))?.empty) empty++;
  const reg = done.filter((e) => e.stype !== 1);
  const missing = reg.filter((e) => !have.has(String(e.id)) && ageH(e.date) > 24);
  const noId = (gameIds.missing || []).length;
  add("matchups", missing.length > 50 ? "note" : "ok", "Who-guarded-whom coverage",
    `${have.size - empty} games with NBA.com matchup tracking, ${empty} with none on NBA.com (mostly preseason). ${missing.length} regular-season / play-in / playoff games finished over a day ago still without a file (filled ${process.env.MATCHUP_MAX || 200} per run, newest first). ${noId} finished games without an NBA.com game id.`,
    missing.slice(-8).map((e) => `${e.id} ${etDay(e.date)}`), missing.length);
}

// ---------- odds stay out of everything the model reads ----------
{
  // sportsbook fields as data/odds.json stores them
  const KEYS = /"(overUnder|moneyline|moneyLine|mlHome|mlAway|spreadHome|spreadOddsHome|spreadOddsAway|overOdds|underOdds|impliedHome|providerId|pickcenter|propBets|againstTheSpread)"\s*:/;
  // the "for comparison only" blocks the simulator adds: allowed only in public/data/sim/ and board.json
  const CMP = /"(bookLine|bookProb|ourProbAtBookLine|comparison)"\s*:/;
  const hits = [];
  const rel = (file) => path.relative(path.dirname(DATA), file).split(path.sep).join("/");
  const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }; // unreadable files are reported above
  const scan = (file) => { if (KEYS.test(read(file))) hits.push(rel(file)); };
  let scanned = 0;
  for (const f of files(path.join(DATA, "schedule"))) { scan(path.join(DATA, "schedule", f)); scanned++; }
  // every box score, play-by-play and matchup file (a substring test, about a second)
  for (const sub of ["games", "pbp", "matchups"]) for (const f of files(path.join(DATA, sub))) { scan(path.join(DATA, sub, f)); scanned++; }
  for (const f of ["pregame.json", "injuries.json", "rosters.json", "news.json", "nbastats.json"]) { scan(path.join(DATA, f)); scanned++; }
  // every published file, recursively: lines only in odds.json; comparison blocks only in sim/ and board.json
  const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".json") ? [path.join(dir, e.name)] : [])) : []);
  for (const file of walk(PUBLIC_DATA)) {
    const r = path.relative(PUBLIC_DATA, file).split(path.sep).join("/");
    scanned++;
    if (r === "odds.json") continue;
    const txt = read(file);
    if (KEYS.test(txt)) hits.push(`public/data/${r}`);
    else if (CMP.test(txt) && !(r.startsWith("sim/") || r === "board.json")) hits.push(`public/data/${r} (comparison block outside the Simulation / High-confidence data)`);
  }
  add("odds-isolation", hits.length ? "error" : "ok", "Sportsbook lines stay in odds.json only",
    hits.length ? "Odds fields were found in a file the model reads or a version 1 page shows. Owner rule: lines are display-only in the Simulation and High-confidence tabs." : `No odds fields in ${scanned} files: schedule, every box score, play-by-play and matchup file, game-day, injury, roster, news and NBA.com files, and every published file (all folders of public/data) other than odds.json; "for comparison only" blocks appear only in public/data/sim/ and board.json.`, hits);
  const odds = readJSON(path.join(DATA, "odds.json"), null);
  if (odds) {
    const n = Object.keys(odds.games || {}).length;
    const old = odds.fetched ? ageH(odds.fetched) : Infinity;
    add("odds-file", old > 24 && soon.length ? "note" : "ok", "Odds file (comparison only)", `${n} upcoming games with a line, ${Object.values(odds.games || {}).filter((g) => g.props).length} with player lines; fetched ${Number.isFinite(old) ? Math.round(old * 10) / 10 + " hours ago" : "never"}.`, []);
  }
}

// ---------- report ----------
const order = { error: 0, warn: 1, note: 2, ok: 3 };
checks.sort((a, b) => order[a.level] - order[b.level]);
const summary = { errors: checks.filter((c) => c.level === "error").length, warnings: checks.filter((c) => c.level === "warn").length, notes: checks.filter((c) => c.level === "note").length, ok: checks.filter((c) => c.level === "ok").length };
const out = { format: 1, ran: new Date().toISOString(), summary, checks };
writeJSON(path.join(DATA, "checks.json"), out, true);
if (args.has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  const tag = { error: "ERROR", warn: "warn ", note: "note ", ok: "ok   " };
  for (const c of checks) {
    if (args.has("--quiet") && c.level !== "error") continue;
    console.log(`${tag[c.level]} ${c.title}${c.count ? ` (${c.count})` : ""}: ${c.detail}`);
    if (c.level !== "ok") for (const x of c.examples.slice(0, c.level === "note" ? 3 : 5)) console.log(`        - ${x}`);
  }
  console.log(`checks: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.notes} notes, ${summary.ok} ok -> data/checks.json`);
}
process.exit(summary.errors ? 1 : 0);
