// Pulls fresh NBA data into data/ (raw-but-compact cache).
// Sources: ESPN public feeds (schedule, box scores, play-by-play, injuries, news),
// NBA.com stats (advanced, defense, hustle, shot zones, defender tracking, play types),
// CBS / Yahoo / RotoWire RSS headlines.
// Sportsbook lines are stored in ONE place only, data/odds.json, for display-only comparison in the
// Simulation and High-confidence tabs (scripts/lib/odds.mjs). They are never written into
// data/games, data/schedule, data/pbp or any other file the model reads.
// File formats: docs/DATA-RAW.md (play-by-play rows: top of scripts/lib/zones.mjs).
//
// Modes: (none) everything | games | extra | zones | news | matchups | pregame
//   pregame: cheap game-day refresh (scores of the last day, rosters, injuries, referee crews,
//            starting line-ups and inactive lists for games in the next 30 hours, odds for comparison).
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA, readJSON, writeJSON, getJSON, pool, addDays, easternToday, isBetting } from "./lib/util.mjs";
import { normName } from "./lib/stats.mjs";
import { compactPbp, trimSummary, PBP_VERSION } from "./lib/pbp.mjs";
import { compactMatchups, MATCHUP_DIR, MATCHUP_VERSION } from "./lib/matchups.mjs";
import { loadIdMap, saveIdMap, matchPerson, seedFromTables } from "./lib/nbaids.mjs";
import { lineFromEspn, impliedHome } from "./lib/odds.mjs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const START = process.env.START_DATE || "20251001"; // 2025-26 preseason onward
const today = easternToday();
const END = addDays(today, 7); // include next week's schedule
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- teams ----------
async function fetchTeams() {
  const j = await getJSON(`${ESPN}/teams`);
  const teams = j.sports[0].leagues[0].teams.map(({ team: t }) => ({
    id: t.id, abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName,
    color: t.color, alt: t.alternateColor, logo: t.logos?.[0]?.href,
  }));
  writeJSON(path.join(DATA, "teams.json"), teams, true);
  return new Set(teams.map((t) => t.id));
}

// ---------- schedule + box scores ----------
const num = (v) => (v === undefined || v === null || v === "" || v === "--" ? 0 : Number(String(v).replace("+", "")) || 0);
const pair = (v) => { const [a, b] = String(v || "0-0").split("-"); return [num(a), num(b)]; };

function compactEvent(ev) {
  const c = ev.competitions[0];
  const comp = (side) => c.competitors.find((x) => x.homeAway === side);
  const h = comp("home"), a = comp("away");
  return {
    id: ev.id, date: ev.date, season: ev.season?.year, stype: ev.season?.type,
    status: ev.status?.type?.name, completed: !!ev.status?.type?.completed,
    neutral: !!c.neutralSite, venue: c.venue?.fullName,
    home: h?.team?.id, away: a?.team?.id, hs: num(h?.score), as: num(a?.score),
  };
}

async function fetchDay(date, teamIds) {
  const file = path.join(DATA, "schedule", `${date}.json`);
  const cached = readJSON(file);
  const settled = cached && date < addDays(today, -1) && cached.every((e) => e.completed || e.status === "STATUS_POSTPONED" || e.status === "STATUS_CANCELED");
  if (settled) return cached;
  const j = await getJSON(`${ESPN}/scoreboard?dates=${date}&limit=100`);
  const evs = (j?.events || []).map(compactEvent).filter((e) => teamIds.has(e.home) && teamIds.has(e.away));
  writeJSON(file, evs); // compact events only: no odds fields ever reach data/schedule
  // Lines for games not yet started are kept in memory and written to data/odds.json alone.
  for (const ev of j?.events || []) {
    if (ev.status?.type?.name !== "STATUS_SCHEDULED") continue;
    ODDS_SEEN.set(String(ev.id), lineFromEspn((ev.competitions?.[0]?.odds || [])[0]));
  }
  return evs;
}
const ODDS_SEEN = new Map(); // espn event id -> line (or null when ESPN listed none), this run only

function compactSummary(s, ev) {
  const players = [];
  for (const side of s.boxscore?.players || []) {
    const st = side.statistics?.[0];
    if (!st) continue;
    const k = st.keys;
    const idx = (key) => k.indexOf(key);
    for (const a of st.athletes || []) {
      const v = a.stats || [];
      const g = (key) => v[idx(key)];
      const [fgm, fga] = pair(g("fieldGoalsMade-fieldGoalsAttempted"));
      const [tpm, tpa] = pair(g("threePointFieldGoalsMade-threePointFieldGoalsAttempted"));
      const [ftm, fta] = pair(g("freeThrowsMade-freeThrowsAttempted"));
      players.push({
        id: a.athlete.id, n: a.athlete.displayName, pos: a.athlete.position?.abbreviation || "",
        t: side.team.id, st: a.starter ? 1 : 0, dnp: a.didNotPlay || !v.length ? 1 : 0, why: a.reason || "",
        ej: a.ejected ? 1 : 0,
        min: num(g("minutes")), pts: num(g("points")), fgm, fga, tpm, tpa, ftm, fta,
        reb: num(g("rebounds")), oreb: num(g("offensiveRebounds")), dreb: num(g("defensiveRebounds")),
        ast: num(g("assists")), to: num(g("turnovers")), stl: num(g("steals")), blk: num(g("blocks")),
        pf: num(g("fouls")), pm: num(g("plusMinus")),
      });
    }
  }
  // ESPN now and then returns a row with no athlete (no id, no name, no numbers) for a player who
  // did play. The row is stored as it came; scripts/lib/boxfix.mjs rebuilds his line when the
  // model loads the game (team row minus the listed players, id from the play-by-play, name and
  // minutes from the NBA.com game log), and team totals are always read from the team row.
  const blank = players.filter((p) => !p.id).length;
  if (blank) log(`box score ${ev.id}: ${blank} row${blank === 1 ? "" : "s"} without a player - rebuilt at model time from team totals`);
  const teams = (s.boxscore?.teams || []).map((t) => {
    const o = { id: t.team.id };
    for (const x of t.statistics || []) o[x.name] = x.displayValue;
    return o;
  });
  const hdr = s.header?.competitions?.[0];
  const periods = Math.max(...(hdr?.competitors || []).map((c) => (c.linescores || []).length), 4);
  // Injury/inactive list as of game time (public pre-game info).
  const out = [];
  for (const side of s.injuries || []) {
    for (const i of side.injuries || []) out.push({ t: side.team?.id, id: i.athlete?.id, n: i.athlete?.displayName, s: i.status || i.type?.description || "" });
  }
  return { ...ev, periods, players, teams, inj: out, officials: (s.gameInfo?.officials || []).map((o) => o.displayName) };
}

// Play-by-play cache: data/pbp/<id>.json, one compact file per completed game
// (shots with location and style, free throws, score flow, period scores, fouls, turnovers).
const PBP_DIR = path.join(DATA, "pbp");
// Optional developer cache: set PBP_RAW_DIR to a folder outside the project and the trimmed
// plays of every downloaded summary are kept there, so data/pbp can be rebuilt after a
// format change (bump PBP_VERSION) without asking ESPN for 1,600 games again.
const PBP_RAW_DIR = process.env.PBP_RAW_DIR || "";
function pbpVersion(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return Number((buf.toString("utf8").match(/^\{"v":(\d+)/) || [])[1]) || 0;
  } catch { return -1; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// One summary request per game feeds both the box score and the play-by-play file.
async function fetchGames(events) {
  const jobs = [];
  for (const ev of events) {
    if (!ev.completed) continue;
    const needBox = !fs.existsSync(path.join(DATA, "games", `${ev.id}.json`));
    const needPbp = pbpVersion(path.join(PBP_DIR, `${ev.id}.json`)) < PBP_VERSION;
    if (needBox || needPbp) jobs.push({ ev, needBox, needPbp });
  }
  log(`box scores to download: ${jobs.filter((j) => j.needBox).length}; play-by-play files to build: ${jobs.filter((j) => j.needPbp).length}`);
  let done = 0, wrote = 0, empty = 0, waiting = 0, cached = 0;
  await pool(jobs, 6, async ({ ev, needBox, needPbp }) => {
    try {
      const rawFile = PBP_RAW_DIR ? path.join(PBP_RAW_DIR, `${ev.id}.json`) : "";
      let s = !needBox && rawFile ? readJSON(rawFile) : null;
      if (s) cached++;
      else {
        s = await getJSON(`${ESPN}/summary?event=${ev.id}`);
        if (s && rawFile) writeJSON(rawFile, trimSummary(s));
      }
      if (s && needBox) writeJSON(path.join(DATA, "games", `${ev.id}.json`), compactSummary(s, ev));
      if (s && needPbp) {
        const c = compactPbp(s, ev);
        // A game that has only just ended can briefly have no plays: ask again next run
        // instead of caching an empty file. Older games without plays are marked "np".
        if (c.np && Date.now() - Date.parse(ev.date) < 3 * 864e5) waiting++;
        else { writeJSON(path.join(PBP_DIR, `${ev.id}.json`), c); wrote++; if (c.np) empty++; }
      }
    } catch (e) { log("summary fail", ev.id, e.message); }
    if (++done % 50 === 0) log(`  ${done}/${jobs.length}`);
  });
  if (jobs.length) log(`play-by-play files written: ${wrote}${empty ? ` (${empty} games had no plays on ESPN)` : ""}${waiting ? `; ${waiting} waiting for plays` : ""}${cached ? `; ${cached} rebuilt from the local raw cache` : ""}`);
}

// ---------- game day: referee crews, starting line-ups, inactive lists (next 30 hours) ----------
// data/pregame.json, one entry per game not yet played. `officials` is what model.mjs reads;
// `lineups` and `late` are newer fields (layout: docs/DATA-RAW.md, section "pregame.json").
// Line-ups come from NBA.com's daily line-ups feed (expected starters during the day, confirmed
// shortly before tip-off, plus the official inactive list) and from ESPN's game summary when ESPN
// already lists starters. Only games not yet played get entries, so nothing here is a leak.
const PSUMMARY = new Map(); // espn id -> summary fetched by fetchPregame this run (odds fallback reads it)
const etDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)).replace(/-/g, "");
function nbaTeamMap() {
  const out = {};
  for (const S of Object.values(readJSON(path.join(DATA, "nbazones.json"), {}).seasons || {})) for (const [espn, row] of Object.entries(S.teams || {})) out[String(row[0])] = espn;
  return out;
}
async function nbaGet(url) { // NBA.com static JSON (not the /stats API): 404 = not published yet
  if (nbaDown >= 3) throw new Error("stats.nba.com not answering this run - skipped");
  const r = await fetch(url, { headers: NBA_H, signal: AbortSignal.timeout(30000) }).catch((e) => { nbaDown++; throw e; });
  nbaDown = 0;
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function espnStarters(s, ev) {
  // ESPN lists starters in the summary's box score (or rosters) once line-ups are announced
  const side = (tid) => {
    const box = (s?.boxscore?.players || []).find((x) => String(x.team?.id) === String(tid));
    let ath = (box?.statistics?.[0]?.athletes || []).filter((a) => a.starter);
    if (!ath.length) ath = ((s?.rosters || []).find((x) => String(x.team?.id) === String(tid))?.roster || []).filter((a) => a.starter);
    return ath.map((a) => ({ id: String(a.athlete?.id || ""), n: a.athlete?.displayName || "", pos: a.athlete?.position?.abbreviation || a.position?.abbreviation || "" })).filter((a) => a.id);
  };
  const home = side(ev.home), away = side(ev.away);
  return home.length >= 5 && away.length >= 5 ? { home, away } : null;
}
// ESPN id -> games played (minutes > 0) in the team's last 5 completed games with a box score
const ROT = new Map();
function recentRotation(tid) {
  if (ROT.has(tid)) return ROT.get(tid);
  const dir = path.join(DATA, "schedule");
  const evs = [];
  for (let d = addDays(today, -30); d <= today; d = addDays(d, 1)) for (const e of readJSON(path.join(dir, `${d}.json`), [])) if (e.completed && (e.home === tid || e.away === tid)) evs.push(e);
  const m = new Map();
  for (const e of evs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)) {
    for (const p of readJSON(path.join(DATA, "games", `${e.id}.json`), { players: [] }).players) if (String(p.t) === String(tid) && p.min > 0 && p.id) m.set(String(p.id), (m.get(String(p.id)) || 0) + 1);
  }
  ROT.set(tid, m);
  return m;
}
async function fetchPregame(events, rosters) {
  const file = path.join(DATA, "pregame.json");
  const prev = readJSON(file, {});
  const now = Date.now();
  const listed = new Map(events.map((e) => [String(e.id), e]));
  // keep entries of games not yet played; an entry for a game outside this run's window survives until 6 hours after its tip-off
  const out = Object.fromEntries(Object.entries(prev).filter(([id, v]) => {
    const e = listed.get(String(id));
    return e ? !e.completed : !!v.date && Date.parse(v.date) > now - 6 * 3600e3;
  }));
  const soon = events.filter((e) => !e.completed && Date.parse(e.date) - now < 30 * 3600e3 && Date.parse(e.date) - now > -4 * 3600e3);
  await pool(soon, 4, async (ev) => {
    try {
      const s = await getJSON(`${ESPN}/summary?event=${ev.id}`);
      if (!s) return;
      PSUMMARY.set(String(ev.id), s);
      const o = out[ev.id] = { ...(out[ev.id] || {}), date: ev.date, home: ev.home, away: ev.away };
      const crew = (s.gameInfo?.officials || []).map((x) => x.displayName).filter(Boolean);
      if (crew.length) o.officials = crew;
      const st = espnStarters(s, ev);
      if (st) o.espnStarters = { ...st, updated: new Date().toISOString() };
    } catch { /* crew / line-ups simply not known yet */ }
  });

  // NBA.com daily line-ups, one file per US Eastern date
  const nbaTeam = nbaTeamMap();
  const idMap = loadIdMap();
  const injuries = readJSON(path.join(DATA, "injuries.json"), { list: [] }).list;
  let lineupGames = 0, confirmed = 0;
  for (const d of [...new Set(soon.map((e) => etDay(e.date)))]) {
    let j = null;
    try { await nbaPause(); j = await nbaGet(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${d}.json`); }
    catch (e) { log(`nba.com daily line-ups ${d} unavailable (${e.message})`); continue; }
    if (!j) { log(`nba.com daily line-ups ${d}: not published yet`); continue; }
    for (const g of j.games || []) {
      const h = nbaTeam[String(g.homeTeam?.teamId)], a = nbaTeam[String(g.awayTeam?.teamId)];
      const ev = soon.find((e) => etDay(e.date) === d && ((e.home === h && e.away === a) || (e.home === a && e.away === h)));
      if (!ev) continue;
      const side = (t, tid) => {
        const cand = (rosters[tid]?.players || []).map((p) => ({ id: p.id, n: p.n }));
        const rows = t?.players || [];
        const idOf = (p) => matchPerson(idMap, p.personId, p.playerName || `${p.firstName} ${p.lastName}`, cand, "roster") || `nba:${p.personId}`;
        // starters carry a position; a confirmed row wins over an expected one for the same player
        const st = new Map();
        for (const p of rows) if (p.position && (!st.has(p.personId) || p.lineupStatus === "Confirmed")) st.set(p.personId, p);
        const starters = [...st.values()].map((p) => ({ id: idOf(p), n: p.playerName, pos: p.position, status: String(p.lineupStatus || "").toLowerCase() }));
        const inactive = [...new Map(rows.filter((p) => p.rosterStatus === "Inactive").map((p) => [p.personId, p])).values()].map((p) => ({ id: idOf(p), n: p.playerName }));
        const active = new Set(rows.filter((p) => p.rosterStatus === "Active").map((p) => p.personId)).size;
        const status = starters.length >= 5 && starters.every((p) => p.status === "confirmed") ? "confirmed" : starters.length ? "expected" : "none";
        return { status, starters, inactive, activeListed: active, updated: rows.map((p) => p.timestamp).filter(Boolean).sort().at(-1) || null };
      };
      const o = out[ev.id] = { ...(out[ev.id] || {}), date: ev.date, home: ev.home, away: ev.away };
      o.lineups = { src: "NBA.com daily line-ups", fetched: new Date().toISOString(), home: side(ev.home === h ? g.homeTeam : g.awayTeam, ev.home), away: side(ev.home === h ? g.awayTeam : g.homeTeam, ev.away) };
      // late scratch: on the official inactive list, played in 2+ of his team's last 5 games, and not
      // listed out or doubtful on ESPN's injury report (two-way and G League players are left out)
      o.late = [];
      for (const [k, tid] of [["home", ev.home], ["away", ev.away]]) {
        const rec = recentRotation(tid);
        for (const p of o.lineups[k].inactive) {
          const inj = injuries.find((i) => String(i.id) === String(p.id) || normName(i.n) === normName(p.n));
          if ((rec.get(String(p.id)) || 0) >= 2 && (!inj || !/out|doubtful/i.test(inj.status || ""))) o.late.push({ t: tid, id: p.id, n: p.n, injury: inj ? inj.status : "", recentGames: rec.get(String(p.id)) });
        }
      }
      lineupGames++;
      if (o.lineups.home.status === "confirmed" && o.lineups.away.status === "confirmed") confirmed++;
    }
  }
  saveIdMap(idMap);
  writeJSON(file, out);
  log(`game day: referee crews for ${soon.filter((e) => out[e.id]?.officials).length} of ${soon.length} games in the next 30 hours; NBA.com line-ups for ${lineupGames} (${confirmed} confirmed both sides); ESPN starters for ${soon.filter((e) => out[e.id]?.espnStarters).length}`);
}

// ---------- sportsbook lines, FOR COMPARISON ONLY (data/odds.json) ----------
// Never read by model.mjs. Shown only in the Simulation and High-confidence tabs.
async function writeOdds(events) {
  const file = path.join(DATA, "odds.json");
  const prev = readJSON(file, {});
  const now = Date.now(), stamp = new Date().toISOString();
  const games = {};
  let fresh = 0, kept = 0, none = 0;
  for (const e of events) {
    if (e.completed || e.status === "STATUS_POSTPONED" || e.status === "STATUS_CANCELED") continue;
    if (Date.parse(e.date) < now - 6 * 3600e3 || Date.parse(e.date) > now + 8 * 864e5) continue;
    const id = String(e.id);
    let line = ODDS_SEEN.get(id) || null;
    if (!line && PSUMMARY.has(id)) line = lineFromEspn((PSUMMARY.get(id).pickcenter || [])[0]);
    // once a game has started ESPN switches to live lines: keep the last pre-game line instead
    if (line && Date.parse(e.date) > now) { games[id] = { date: e.date, home: e.home, away: e.away, ...line, impliedHome: impliedHome(line.mlHome, line.mlAway), fetched: stamp }; fresh++; }
    else if (prev.games?.[id]) { games[id] = prev.games[id]; kept++; }
    else none++;
  }
  // Player props: ESPN's public core API (no login) lists the same bookmaker's player lines per game,
  // usually from the morning of game day. Only the line (threshold) is kept: ESPN does not label
  // which of the two prices is the over and which the under, so prices are not stored.
  const PROP_STAT = { "Total Points": "pts", "Total Rebounds": "reb", "Total Assists": "ast", "Total 3-Point Field Goals": "tpm", "Total Steals": "stl", "Total Blocks": "blk", "Total Points, Rebounds, and Assists": "pra" };
  const props = { checked: 0, games: 0, players: 0 };
  for (const [id, g] of Object.entries(games)) {
    if (!g.providerId || Date.parse(g.date) - now > 30 * 3600e3 || g.fetched !== stamp) {
      if (prev.games?.[id]?.props && g === prev.games[id]) props.games++; // kept with the kept line
      continue;
    }
    props.checked++;
    const players = {};
    try {
      for (let page = 1; page <= 3; page++) {
        const j = await getJSON(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${id}/competitions/${id}/odds/${g.providerId}/propBets?limit=1000&page=${page}`, 2);
        for (const it of j?.items || []) {
          const stat = PROP_STAT[it.type?.name];
          const pid = (it.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1];
          const line = Number(it.current?.target?.value ?? it.odds?.total?.value);
          if (!stat || !pid || !Number.isFinite(line)) continue;
          players[pid] = players[pid] || {};
          if (players[pid][stat] === undefined) players[pid][stat] = line;
        }
        if (!j || page >= (j.pageCount || 1)) break;
      }
    } catch { /* no props for this game */ }
    if (Object.keys(players).length) { g.props = players; props.games++; props.players += Object.keys(players).length; }
  }
  // Closing lines: the last pre-game line of every game that has tipped off, kept for grading closing line value
  // (did our side's price improve between the first line we saw and the close?). Comparison only, like everything here.
  const closing = { ...(prev.closing || {}) };
  for (const [id, g] of Object.entries(prev.games || {})) {
    if (closing[id] || Date.parse(g.date) > now) continue;
    const { props: _p, ...line } = g; closing[id] = { ...line, closedAt: stamp };
  }
  writeJSON(file, {
    format: 1,
    closingNote: "closing[id]: the last pre-game line stored before tip-off (with the opening line in 'open'), used only to grade closing line value on the Accuracy report.",
    closing,
    note: "FOR COMPARISON ONLY. Sportsbook lines as ESPN publishes them on its scoreboard (pre-game summary as a fallback). Display-only in the Simulation and High-confidence tabs; never an input to projections, learning, scenarios or the simulation. spreadHome is the home team's line (negative = home favoured); moneylines are American odds; impliedHome is the moneyline win chance with the bookmaker margin removed. games[id].props (games in the next 30 hours, when published): ESPN athlete id -> line for pts, reb, ast, tpm, stl, blk, pra from the same bookmaker; only the line is stored because ESPN does not label which price is over and which under.",
    source: "ESPN public scoreboard / summary feeds (site.api.espn.com) for game lines; ESPN public core API propBets (sports.core.api.espn.com) for player lines. The bookmaker is named per game in 'provider'.",
    fetched: stamp, props, games,
  }, true);
  log(`odds (comparison only): ${fresh} games with a fresh line, ${kept} kept from the last run, ${none} upcoming games with no line yet`);
}

// ---------- who guarded whom: NBA.com matchup tracking (data/matchups/<espnId>.json) ----------
// data/nbagameids.json pairs ESPN event ids with NBA.com game ids (team game logs, then the
// NBA.com scoreboard of that date for anything left over, e.g. the NBA Cup final).
const SEASON_TYPE = { 1: "Pre Season", 2: "Regular Season", 3: "Playoffs", 5: "PlayIn" };
async function nbaGameIds(events, nbaTeam) {
  const file = path.join(DATA, "nbagameids.json");
  const st = readJSON(file, {});
  st.map = st.map || {}; st.done = st.done || {}; st.dates = st.dates || {};
  const want = events.filter((e) => e.completed && !st.map[e.id]);
  if (!want.length) return st;
  const key = (d, x, y) => `${d}|${[x, y].sort().join("-")}`;
  const byKey = new Map(want.map((e) => [key(etDay(e.date), e.home, e.away), e]));
  const live = `${+today.slice(0, 4) - (+today.slice(4, 6) >= 9 ? 0 : 1)}`;
  const sets = [...new Set(want.map((e) => `${e.season - 1}-${String(e.season).slice(2)}|${SEASON_TYPE[e.stype] || ""}`))].filter((s) => !s.endsWith("|"));
  for (const s of sets) {
    const [season, type] = s.split("|");
    if (st.done[s] && !season.startsWith(live)) continue; // finished season already read once
    try {
      await nbaPause();
      const rows = await nbaStats("leaguegamelog", `Counter=0&Direction=ASC&LeagueID=00&PlayerOrTeam=T&Season=${season}&SeasonType=${encodeURIComponent(type)}&Sorter=DATE`);
      const games = new Map();
      for (const r of rows) { const g = games.get(r.GAME_ID) || { d: r.GAME_DATE.replace(/-/g, ""), t: [] }; g.t.push(nbaTeam[String(r.TEAM_ID)]); games.set(r.GAME_ID, g); }
      for (const [gid, g] of games) { const e = g.t.length === 2 && byKey.get(key(g.d, g.t[0], g.t[1])); if (e) st.map[e.id] = gid; }
      st.done[s] = new Date().toISOString();
    } catch (e) { log(`nba.com game ids ${s} unavailable (${e.message})`); }
  }
  // leftovers: the NBA.com scoreboard of that US date (one call per date, finished dates once)
  for (const d of [...new Set(want.filter((e) => !st.map[e.id]).map((e) => etDay(e.date)))]) {
    if (st.dates[d] && d < addDays(today, -3)) continue;
    try {
      await nbaPause();
      const j = await nbaRaw("scoreboardv3", `GameDate=${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}&LeagueID=00`);
      for (const g of j?.scoreboard?.games || []) { const e = byKey.get(key(d, nbaTeam[String(g.homeTeam?.teamId)], nbaTeam[String(g.awayTeam?.teamId)])); if (e) st.map[e.id] = g.gameId; }
      st.dates[d] = 1;
    } catch (e) { log(`nba.com scoreboard ${d} unavailable (${e.message})`); }
  }
  st.format = 1; st.note = "ESPN event id -> NBA.com game id. done: season/type game logs already read; dates: NBA.com scoreboards already read for leftovers.";
  st.missing = events.filter((e) => e.completed && !st.map[e.id]).map((e) => e.id);
  writeJSON(file, st);
  return st;
}
const muVersion = (file) => { const j = readJSON(file); return j ? (j.v || 0) : -1; };
async function fetchMatchups(events) {
  const nbaTeam = nbaTeamMap();
  if (Object.keys(nbaTeam).length < 30) { log("matchups: NBA.com team ids not known yet (run `node scripts/fetch.mjs zones` first) - skipped"); return; }
  const ids = await nbaGameIds(events, nbaTeam);
  const max = Number(process.env.MATCHUP_MAX || 200); // per run; a cloud refresh has a time limit, the backlog is filled over several runs
  const todo = events.filter((e) => e.completed && ids.map[e.id] && muVersion(path.join(MATCHUP_DIR, `${e.id}.json`)) < MATCHUP_VERSION)
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first: those matter most for the live projections
  const idMap = loadIdMap();
  if (!Object.keys(idMap.map).length) log(`nba ids: seeded ${seedFromTables(idMap, readJSON(path.join(DATA, "rosters.json"), {}), readJSON(path.join(DATA, "nbazones.json"), {}))} from NBA.com season tables`);
  log(`matchups to download: ${todo.length}${todo.length > max ? ` (this run: ${max}, newest first; set MATCHUP_MAX to change)` : ""}; ESPN games without an NBA.com game id: ${ids.missing.length}`);
  let wrote = 0, empty = 0, failed = 0, waiting = 0, unm = 0;
  for (const ev of todo.slice(0, max)) {
    if (nbaDown >= 3) { log("matchups: stats.nba.com stopped answering - the rest waits for the next run"); break; }
    try {
      await nbaPause();
      const j = await nbaRaw("boxscorematchupsv3", `GameID=${ids.map[ev.id]}&LeagueID=00&endPeriod=0&endRange=31800&rangeType=0&startPeriod=0&startRange=0`);
      const c = compactMatchups(j, ev, readJSON(path.join(DATA, "games", `${ev.id}.json`)), idMap, nbaTeam);
      // a game that has only just ended may not be tracked yet: ask again next run
      if (c.empty && Date.now() - Date.parse(ev.date) < 3 * 864e5) { waiting++; continue; }
      writeJSON(path.join(MATCHUP_DIR, `${ev.id}.json`), c);
      wrote++; if (c.empty) empty++; if (c.un) unm += c.un.length;
    } catch (e) { failed++; log(`matchups ${ev.id} unavailable (${e.message})`); }
    if ((wrote + failed + waiting) % 50 === 0) { saveIdMap(idMap); log(`  matchups ${wrote + failed + waiting}/${Math.min(todo.length, max)}`); }
  }
  saveIdMap(idMap);
  log(`matchups written: ${wrote} (${empty} games with no tracking on NBA.com)${waiting ? `; ${waiting} just-finished games waiting` : ""}${failed ? `; ${failed} failed (kept for the next run)` : ""}; ${unm} player rows not matched to an ESPN id (stored as nba:<id>)`);
}

// ---------- rosters + head coaches ----------
async function fetchRosters(teamIds) {
  const out = readJSON(path.join(DATA, "rosters.json"), {}); // start from the stored copy: a failed request keeps that team's previous roster
  let ok = 0;
  await pool([...teamIds], 6, async (id) => {
    try {
      const r = await getJSON(`${ESPN}/teams/${id}/roster`);
      const c = r?.coach?.[0];
      const entry = {
        coach: c ? `${c.firstName} ${c.lastName}` : null, coachExp: c?.experience ?? null,
        players: (r?.athletes || []).map((a) => ({
          id: a.id, n: a.displayName, pos: a.position?.abbreviation, h: a.height, w: a.weight,
          age: a.age, exp: a.experience?.years ?? null, jersey: a.jersey,
          inj: (a.injuries || []).map((i) => i.status).join(", "),
        })),
      };
      if (!r?.athletes?.length) throw new Error("empty roster");
      out[id] = entry; ok++;
    } catch (e) { log("roster fail", id, e.message, out[id] ? "- keeping previous copy" : ""); }
  });
  writeJSON(path.join(DATA, "rosters.json"), out);
  log(`rosters: ${ok} refreshed, ${Object.keys(out).length} stored`);
}

// ---------- injuries ----------
async function fetchInjuries() {
  const j = await getJSON(`${ESPN}/injuries`);
  const list = [];
  for (const t of j?.injuries || []) {
    for (const i of t.injuries || []) {
      list.push({
        team: t.id, id: i.athlete?.id || ((i.athlete?.links || []).map((l) => (l.href || "").match(/\/id\/(\d+)/)?.[1]).find(Boolean) ?? null), n: i.athlete?.displayName, status: i.status,
        date: i.date, detail: i.shortComment || "", long: (i.longComment || "").slice(0, 400),
        type: i.details?.type || "", returnDate: i.details?.returnDate || null,
      });
    }
  }
  writeJSON(path.join(DATA, "injuries.json"), { fetched: new Date().toISOString(), list }, true);
  log(`injuries: ${list.length}`);
}

// ---------- NBA.com stats (advanced / defense / hustle) ----------
const NBA_H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  Referer: "https://www.nba.com/", Origin: "https://www.nba.com", Accept: "application/json, text/plain, */*",
};
const DASH = "LeagueID=00&PerMode=PerGame&LastNGames=0&Month=0&OpponentTeamID=0&PaceAdjust=N&Period=0&PlusMinus=N&Rank=N&DateFrom=&DateTo=&GameScope=&GameSegment=&Location=&Outcome=&PORound=0&PlayerExperience=&PlayerPosition=&SeasonSegment=&StarterBench=&TeamID=0&VsConference=&VsDivision=&Conference=&Division=&DraftPick=&DraftYear=&Height=&ISTRound=&College=&Country=&TwoWay=0&Weight=";
// stats.nba.com sometimes stops answering cloud servers altogether. After three calls in a
// row that time out or cannot connect, the rest of this run's NBA.com calls are skipped
// (each would otherwise wait 30 seconds) and every table keeps its previous copy.
let nbaDown = 0;
async function nbaRaw(endpoint, params) {
  if (nbaDown >= 3) throw new Error("stats.nba.com not answering this run - skipped");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(`https://stats.nba.com/stats/${endpoint}?${params}`, { headers: NBA_H, signal: ac.signal });
    nbaDown = 0;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (!/^HTTP \d/.test(e.message)) nbaDown++;
    throw e;
  } finally { clearTimeout(t); }
}
async function nbaStats(endpoint, params) {
  const j = await nbaRaw(endpoint, params);
  const rs = j.resultSets?.[0] || j.resultSet;
  return rs.rowSet.map((row) => Object.fromEntries(rs.headers.map((h, i) => [h, row[i]])));
}
const nbaPause = () => new Promise((r) => setTimeout(r, 700)); // be polite to stats.nba.com
async function fetchNbaStats() {
  const seasons = ["2025-26", "2026-27"];
  const out = readJSON(path.join(DATA, "nbastats.json"), {});
  for (const season of seasons) {
    const S = `Season=${season}&SeasonType=Regular%20Season`;
    const PT = (m, who = "Player") => ["leaguedashptstats", `PtMeasureType=${m}&PlayerOrTeam=${who}&${S}&PerMode=PerGame&LeagueID=00&LastNGames=0&Month=0&OpponentTeamID=0&TeamID=0&College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&Height=&Location=&Outcome=&PORound=0&PlayerExperience=&PlayerPosition=&SeasonSegment=&StarterBench=&VsConference=&VsDivision=&Weight=`];
    const jobs = {
      playerBase: ["leaguedashplayerstats", `MeasureType=Base&${S}&${DASH}`],
      playerAdvanced: ["leaguedashplayerstats", `MeasureType=Advanced&${S}&${DASH}`],
      playerUsage: ["leaguedashplayerstats", `MeasureType=Usage&${S}&${DASH}`],
      playerScoring: ["leaguedashplayerstats", `MeasureType=Scoring&${S}&${DASH}`],
      playerMisc: ["leaguedashplayerstats", `MeasureType=Misc&${S}&${DASH}`],
      playerClutch: ["leaguedashplayerclutch", `MeasureType=Base&${S}&${DASH}&AheadBehind=Ahead%20or%20Behind&ClutchTime=Last%205%20Minutes&PointDiff=5`],
      playerDrives: PT("Drives"),
      playerPassing: PT("Passing"),
      playerTouches: PT("Possessions"),
      playerRebounding: PT("Rebounding"),
      playerSpeed: PT("SpeedDistance"),
      teamSpeed: PT("SpeedDistance", "Team"),
      teamFourFactors: ["leaguedashteamstats", `MeasureType=Four%20Factors&${S}&${DASH}`],
      teamOpponent: ["leaguedashteamstats", `MeasureType=Opponent&${S}&${DASH}`],
      teamScoring: ["leaguedashteamstats", `MeasureType=Scoring&${S}&${DASH}`],
      teamMisc: ["leaguedashteamstats", `MeasureType=Misc&${S}&${DASH}`],
      lineups: ["leaguedashlineups", `MeasureType=Advanced&GroupQuantity=5&${S}&${DASH}`],
      playerDefense: ["leaguedashplayerstats", `MeasureType=Defense&${S}&${DASH}`],
      playerHustle: ["leaguehustlestatsplayer", `${S}&PerMode=PerGame&LeagueID=00&PlayerExperience=&PlayerPosition=&TeamID=0&College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&Height=&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&SeasonSegment=&VsConference=&VsDivision=&Weight=`],
      teamAdvanced: ["leaguedashteamstats", `MeasureType=Advanced&${S}&${DASH}`],
      teamHustle: ["leaguehustlestatsteam", `${S}&PerMode=PerGame&LeagueID=00&TeamID=0&College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&Height=&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PlayerExperience=&PlayerPosition=&SeasonSegment=&VsConference=&VsDivision=&Weight=`],
    };
    out[season] = out[season] || {};
    // Past season is final: only fetch once.
    for (const [key, [ep, params]] of Object.entries(jobs)) {
      if (season === "2025-26" && out[season][key]?.length) continue;
      await new Promise((r) => setTimeout(r, 700)); // be polite to stats.nba.com
      try {
        let rows = await nbaStats(ep, params);
        if (key === "lineups") rows = rows.filter((r) => r.MIN * r.GP >= 40); // meaningful lineups only
        out[season][key] = rows; log(`nba.com ${season} ${key}: ${rows.length}`);
      }
      catch (e) { log(`nba.com ${season} ${key} unavailable (${e.message}) - keeping previous copy`); }
    }
  }
  out.fetched = new Date().toISOString();
  writeJSON(path.join(DATA, "nbastats.json"), out);
}

// ---------- official NBA.com game logs (cross-check for ESPN box scores) ----------
async function fetchGameLogs() {
  const file = path.join(DATA, "nbagamelogs.json");
  const out = readJSON(file, {});
  const sets = [
    ["2025-26", "Pre Season"], ["2025-26", "Regular Season"], ["2025-26", "PlayIn"], ["2025-26", "Playoffs"],
    ["2026-27", "Pre Season"], ["2026-27", "Regular Season"],
  ];
  for (const [season, type] of sets) {
    const key = `${season}|${type}`;
    if (season === "2025-26" && out[key]?.length) continue; // finished season
    await new Promise((r) => setTimeout(r, 700));
    try {
      const rows = await nbaStats("leaguegamelog", `Counter=0&Direction=ASC&LeagueID=00&PlayerOrTeam=P&Season=${season}&SeasonType=${encodeURIComponent(type)}&Sorter=DATE`);
      out[key] = rows.map((r) => [r.GAME_DATE, r.PLAYER_NAME, r.TEAM_ABBREVIATION, r.MIN, r.PTS, r.REB, r.AST, r.FG3M]);
      log(`nba.com gamelog ${key}: ${rows.length}`);
    } catch (e) { log(`nba.com gamelog ${key} unavailable (${e.message})`); }
  }
  writeJSON(file, out);
}

// ---------- weekly point-in-time NBA.com snapshots (leak-free back-test) ----------
// Season-to-date advanced / hustle / defense numbers exactly as they stood each Monday.
async function fetchSnapshots() {
  const file = path.join(DATA, "nbasnapshots.json");
  const out = readJSON(file, {});
  const seasons = [["2025-26", "20251027", "20260412"], ["2026-27", "20261026", today]];
  for (const [season, from, to] of seasons) {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const key = `${season}|${d}`;
      if (out[key] && d < addDays(today, -7)) continue;
      const dt = `${d.slice(4, 6)}%2F${d.slice(6, 8)}%2F${d.slice(0, 4)}`;
      const S = `Season=${season}&SeasonType=Regular%20Season`;
      const dash = DASH.replace("DateTo=", `DateTo=${dt}`);
      const snap = {};
      try {
        await new Promise((r) => setTimeout(r, 600));
        snap.adv = (await nbaStats("leaguedashplayerstats", `MeasureType=Advanced&${S}&${dash}`))
          .map((r) => [r.PLAYER_NAME, r.GP, r.MIN, r.USG_PCT, r.TS_PCT, r.NET_RATING, r.DEF_RATING, r.PIE, r.AST_PCT, r.REB_PCT]);
        await new Promise((r) => setTimeout(r, 600));
        snap.hustle = (await nbaStats("leaguehustlestatsplayer", `${S}&PerMode=PerGame&LeagueID=00&DateTo=${dt}&DateFrom=&PlayerExperience=&PlayerPosition=&TeamID=0&College=&Conference=&Country=&Division=&DraftPick=&DraftYear=&Height=&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&SeasonSegment=&VsConference=&VsDivision=&Weight=`))
          .map((r) => [r.PLAYER_NAME, r.MIN, r.CONTESTED_SHOTS, r.DEFLECTIONS, r.LOOSE_BALLS_RECOVERED, r.CHARGES_DRAWN, r.BOX_OUTS, r.SCREEN_ASSISTS]);
        out[key] = snap;
        log(`snapshot ${key}: ${snap.adv.length} players`);
      } catch (e) { log(`snapshot ${key} unavailable (${e.message})`); }
    }
  }
  writeJSON(file, out);
}

// ---------- NBA.com shot zones, defender tracking, play types, shot creation ----------
// data/nbazones.json. Season totals, so for a past game of the season being replayed these
// tables are a leak: the back-test must use the previous season here, the dated defender
// snapshots below, or zones built game by game from data/pbp. Layout: docs/DATA-RAW.md.
const liveSeason = (() => { const y = +today.slice(0, 4), s = +today.slice(4, 6) >= 9 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; })();
const ZONE_SEASONS = [...new Set(["2024-25", "2025-26", "2026-27", liveSeason])].sort();
const ZBASE = "LeagueID=00&PerMode=Totals&LastNGames=0&Month=0&OpponentTeamID=0&PaceAdjust=N&Period=0&PlusMinus=N&Rank=N&DateFrom=&GameScope=&GameSegment=&Location=&Outcome=&PORound=0&PlayerExperience=&PlayerPosition=&SeasonSegment=&StarterBench=&TeamID=0&VsConference=&VsDivision=&Conference=&Division=&DraftPick=&DraftYear=&Height=&ISTRound=&College=&Country=&Weight=";
const NBA_ZONES = ["RA", "PAINT", "MID", "LC3", "RC3", "ATB3", "BC"];
const NBA_ZONE_NAME = { "Restricted Area": "RA", "In The Paint (Non-RA)": "PAINT", "Mid-Range": "MID", "Left Corner 3": "LC3", "Right Corner 3": "RC3", "Above the Break 3": "ATB3", Backcourt: "BC" };
const DEF_CATS = { // key: [DefenseCategory, made column, attempts column, shooters' usual pct column]
  overall: ["Overall", "D_FGM", "D_FGA", "NORMAL_FG_PCT"],
  fg3: ["3 Pointers", "FG3M", "FG3A", "NS_FG3_PCT"],
  fg2: ["2 Pointers", "FG2M", "FG2A", "NS_FG2_PCT"],
  lt6: ["Less Than 6Ft", "FGM_LT_06", "FGA_LT_06", "NS_LT_06_PCT"],
  lt10: ["Less Than 10Ft", "FGM_LT_10", "FGA_LT_10", "NS_LT_10_PCT"],
  gt15: ["Greater Than 15Ft", "FGM_GT_15", "FGA_GT_15", "NS_GT_15_PCT"],
};
const PLAY_TYPES = ["Isolation", "Transition", "PRBallHandler", "PRRollman", "Postup", "Spotup", "Handoff", "Cut", "OffScreen", "OffRebound", "Misc"];
const PT_SHOT = { catch: "Catch and Shoot", pullup: "Pullups", lt10: "Less Than 10 ft" };
const ZONE_COLS = {
  players: ["nbaId", "name", "team", "pos"],
  shotLoc: "fgm, fga for each zone in `zones` order (season totals)",
  defend: ["gp", "freq", "fgm", "fga", "nsPct"],
  synergy: ["gp", "possPct", "ppp", "poss", "pts", "fgm", "fga", "efgPct", "tovPct", "ftPct", "scorePct", "pctile", "team (player rows only, from synFormat 2; 'NYK+CHI' when two stints were merged)"],
  ptShot: ["gp", "freq", "fgm", "fga", "efgPct", "fg3m", "fg3a"],
};
const n0 = (v) => (Number.isFinite(v) ? v : 0);
const r3 = (v) => Math.round(n0(v) * 1000) / 1000;

// Shot-location endpoints nest their headers: zone names on top, FGM/FGA/FG_PCT repeated below.
function shotLocRows(j) {
  const rs = Array.isArray(j.resultSets) ? j.resultSets[0] : j.resultSets;
  const [cat, cols] = rs.headers;
  const skip = cat.columnsToSkip, span = cat.columnSpan || 3;
  const at = NBA_ZONES.map((z) => cat.columnNames.findIndex((n) => NBA_ZONE_NAME[n] === z));
  return rs.rowSet.map((row) => {
    const o = {};
    for (let i = 0; i < skip; i++) o[cols.columnNames[i]] = row[i];
    o.z = at.flatMap((zi) => (zi < 0 ? [0, 0] : [n0(row[skip + zi * span]), n0(row[skip + zi * span + 1])]));
    return o;
  });
}
const defRow = (r, [, m, a, ns]) => [r.GP, r3(r.FREQ), n0(r[m]), n0(r[a]), r3(r[ns])];
// Synergy row; the last column is the team the row belongs to (format 2).
const SYN_FORMAT = 2;
const synRow = (r) => [r.GP, r3(r.POSS_PCT), r3(r.PPP), n0(r.POSS), n0(r.PTS), n0(r.FGM), n0(r.FGA), r3(r.EFG_PCT), r3(r.TOV_POSS_PCT), r3(r.FT_POSS_PCT), r3(r.SCORE_POSS_PCT), r3(r.PERCENTILE), r.TEAM_ABBREVIATION || ""];
// A traded player: NBA.com is NOT consistent here. For some play types it returns one row per
// team, for others a single row covering one stint only (checked on a live call: Spot-up 400 rows
// for 400 players, Roll-man 269 rows for 266). Rows of the same play type are merged (counts
// added, rates weighted by possessions, teams joined as "NYK+CHI"); a play type that came back
// for one stint only keeps that stint's games and team, so a player's rows can cover different
// games. Readers detect that from differing gp (scout.mjs marks the block "partial").
function synMerge(x, y) {
  const big = y[3] > x[3] ? y : x, poss = x[3] + y[3];
  const w = (i) => (poss ? r3((x[i] * x[3] + y[i] * y[3]) / poss) : 0);
  const all = (r) => (r[1] ? r[3] / r[1] : 0); // the stint's total possessions
  return [x[0] + y[0], all(x) + all(y) ? r3(poss / (all(x) + all(y))) : 0, poss ? r3((x[4] + y[4]) / poss) : 0, poss, x[4] + y[4], x[5] + y[5], x[6] + y[6], w(7), w(8), w(9), w(10), big[11],
    [...new Set([x[12], y[12]].flatMap((t) => String(t || "").split("+")).filter(Boolean))].join("+")];
}

async function fetchNbaZones() {
  const file = path.join(DATA, "nbazones.json");
  const out = readJSON(file, {});
  out.format = 1;
  out.note = "Official NBA.com season totals (regular season). Finished seasons are fetched once; the current one is refreshed every run.";
  out.zones = NBA_ZONES; out.playTypes = PLAY_TYPES; out.cols = ZONE_COLS;
  out.seasons = out.seasons || {};
  const teamList = readJSON(path.join(DATA, "teams.json"), []);
  const nick = (s) => String(s || "").toLowerCase().split(" ").pop();
  const espnTeam = (name) => (teamList.find((t) => t.name === name) || teamList.find((t) => nick(t.name) === nick(name)))?.id || null;
  let calls = 0, failed = 0;

  for (const season of ZONE_SEASONS) {
    if (season > liveSeason) continue;
    const past = season < liveSeason;
    const S = out.seasons[season] = out.seasons[season] || {};
    for (const k of ["players", "teams", "shotLoc", "teamShotLoc", "teamOppShotLoc", "defend", "synP", "synT", "synD", "ptShot", "final"]) S[k] = S[k] || {};
    const sq = `Season=${season}&SeasonType=Regular%20Season`;
    const who = (id, name, team, pos) => {
      const k = normName(name);
      const p = S.players[k] || [id, name, team || "", ""];
      if (p[0] !== id) return null; // two different players share a normalised name: keep the first
      p[1] = name; if (team) p[2] = team; if (pos) p[3] = pos;
      S.players[k] = p;
      return k;
    };
    const teamKey = (r) => {
      const id = espnTeam(r.TEAM_NAME);
      if (id) S.teams[id] = [r.TEAM_ID, r.TEAM_NAME];
      return id;
    };
    const byTeam = (rows, fn) => { const m = {}; for (const r of rows) { const id = teamKey(r); if (id) m[id] = fn(r); } return m; };
    const byPlayer = (rows, idCol, teamCol, fn, merge) => {
      const m = {};
      for (const r of rows) {
        const k = who(r[idCol], r.PLAYER_NAME, r[teamCol], r.PLAYER_POSITION);
        if (!k) continue;
        m[k] = m[k] && merge ? merge(m[k], fn(r)) : fn(r);
      }
      return m;
    };
    const syn = (pt, pOrT, grp) => `LeagueID=00&PerMode=Totals&PlayType=${pt}&PlayerOrTeam=${pOrT}&SeasonType=Regular%20Season&SeasonYear=${season}&TypeGrouping=${grp}`;

    // [where it is stored, key, loader]
    const jobs = [
      [S, "shotLoc", async () => byPlayer(shotLocRows(await nbaRaw("leaguedashplayershotlocations", `DistanceRange=By%20Zone&MeasureType=Base&${sq}&DateTo=&${ZBASE}`)), "PLAYER_ID", "TEAM_ABBREVIATION", (r) => r.z)],
      [S, "teamShotLoc", async () => byTeam(shotLocRows(await nbaRaw("leaguedashteamshotlocations", `DistanceRange=By%20Zone&MeasureType=Base&${sq}&DateTo=&${ZBASE}`)), (r) => r.z)],
      [S, "teamOppShotLoc", async () => byTeam(shotLocRows(await nbaRaw("leaguedashteamshotlocations", `DistanceRange=By%20Zone&MeasureType=Opponent&${sq}&DateTo=&${ZBASE}`)), (r) => r.z)],
      ...Object.entries(DEF_CATS).map(([k, cat]) => [S.defend, k, async () => byPlayer(await nbaStats("leaguedashptdefend", `DefenseCategory=${encodeURIComponent(cat[0])}&${sq}&DateTo=&${ZBASE}`), "CLOSE_DEF_PERSON_ID", "PLAYER_LAST_TEAM_ABBREVIATION", (r) => defRow(r, cat))]),
      ...PLAY_TYPES.map((pt) => [S.synP, pt, async () => byPlayer(await nbaStats("synergyplaytypes", syn(pt, "P", "offensive")), "PLAYER_ID", "TEAM_ABBREVIATION", synRow, synMerge)]),
      ...PLAY_TYPES.map((pt) => [S.synT, pt, async () => byTeam(await nbaStats("synergyplaytypes", syn(pt, "T", "offensive")), synRow)]),
      ...PLAY_TYPES.map((pt) => [S.synD, pt, async () => byTeam(await nbaStats("synergyplaytypes", syn(pt, "T", "defensive")), synRow)]),
      ...Object.entries(PT_SHOT).map(([k, range]) => [S.ptShot, k, async () => byPlayer(await nbaStats("leaguedashplayerptshot", `GeneralRange=${encodeURIComponent(range)}&${sq}&DateTo=&${ZBASE}&CloseDefDistRange=&DribbleRange=&ShotClockRange=&ShotDistRange=&TouchTimeRange=`), "PLAYER_ID", "PLAYER_LAST_TEAM_ABBREVIATION", (r) => [r.GP, r3(r.FGA_FREQUENCY), n0(r.FGM), n0(r.FGA), r3(r.EFG_PCT), n0(r.FG3M), n0(r.FG3A)])]),
    ];
    let got = 0, kept = 0;
    for (const [store, key, load] of jobs) {
      const tag = `${store === S ? "" : Object.keys(S).find((k) => S[k] === store) + "."}${key}`;
      // a finished season never changes; player play-type rows are fetched once more when they predate the team column
      const need = store === S.synP ? SYN_FORMAT : 1;
      if (past && S.final[tag] >= need) { kept++; continue; }
      await nbaPause();
      try {
        calls++;
        const rows = await load();
        if (!Object.keys(rows).length) throw new Error("no rows");
        store[key] = rows; got++;
        if (past) S.final[tag] = need;
        if (store === S.synP) S.synFormat = SYN_FORMAT;
      } catch (e) { failed++; log(`nba.com zones ${season} ${tag} unavailable (${e.message}) - keeping previous copy`); }
    }
    if (got) S.fetched = new Date().toISOString();
    log(`nba.com zones ${season}: ${got} tables fetched, ${kept} already final, ${Object.keys(S.players).length} players, ${Object.keys(S.shotLoc).length} with shot locations`);
  }
  out.fetched = new Date().toISOString();
  writeJSON(file, out);
  log(`nba.com zones: ${calls} calls, ${failed} failed`);
}

// ---------- weekly point-in-time defender snapshots (leak-free back-test) ----------
// data/defsnapshots.json: what each defender had allowed at the rim, on threes and on long
// shots as it stood each Monday (same Mondays as nbasnapshots.json). A game may only use a
// snapshot dated strictly before its own US Eastern date, and only gp / fgm / fga from it:
// the nsPct column is not point-in-time (see the note written into the file).
const DEF_SNAP_CATS = ["lt6", "fg3", "gt15"];
async function fetchDefSnapshots() {
  const file = path.join(DATA, "defsnapshots.json");
  const out = readJSON(file, {});
  out.format = 1;
  out.note = "NBA.com defender tracking, season to date through each Monday (DateTo). gp, fgm and fga are as of that date; pct allowed = fgm / fga. nsPct (what the same shooters usually make) is filled by NBA.com from the shooters' WHOLE season even for an old date, so it looks ahead: do not use nsPct when replaying a past game.";
  out.cats = DEF_SNAP_CATS; out.cols = ["gp", "fgm", "fga", "nsPct"];
  out.snaps = out.snaps || {};
  const seasons = [["2025-26", "20251027", "20260412"], ["2026-27", "20261026", today]];
  let got = 0, failed = 0;
  for (const [season, from, to] of seasons) {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const key = `${season}|${d}`;
      if (out.snaps[key] && d < addDays(today, -7)) continue;
      const dt = `${d.slice(4, 6)}%2F${d.slice(6, 8)}%2F${d.slice(0, 4)}`;
      const snap = {};
      try {
        for (const cat of DEF_SNAP_CATS) {
          const [name, m, a, ns] = DEF_CATS[cat];
          await nbaPause();
          const rows = await nbaStats("leaguedashptdefend", `DefenseCategory=${encodeURIComponent(name)}&Season=${season}&SeasonType=Regular%20Season&DateTo=${dt}&${ZBASE}`);
          snap[cat] = {};
          for (const r of rows) if (r[a] > 0) snap[cat][normName(r.PLAYER_NAME)] = [r.GP, n0(r[m]), n0(r[a]), r3(r[ns])];
        }
        out.snaps[key] = snap; got++;
        log(`defender snapshot ${key}: ${Object.keys(snap.lt6).length} defenders`);
      } catch (e) { failed++; log(`defender snapshot ${key} unavailable (${e.message})`); if (nbaDown >= 3) break; }
    }
  }
  writeJSON(file, out);
  log(`defender snapshots: ${Object.keys(out.snaps).length} stored (${got} fetched this run, ${failed} failed)`);
}

// ---------- NBA 2K27 ratings (unofficial community datasets on GitHub) ----------
async function fetch2K() {
  const sources = [
    { name: "nba-2k-player-merge (GitHub: forrestgump2000)", url: "https://raw.githubusercontent.com/forrestgump2000/nba-2k-player-merge/HEAD/src/data/players.json",
      map: (p) => ({ n: p.name, ovr: p.ovr, arch: p.archetype, badges: (p.badges || []).filter((b) => Array.isArray(b)).map(([bn, tier]) => [bn, tier]), pos: (p.positions || []).join("/"), age: p.age, h: p.height, ws: p.wingspan,
        dur: p.attrs?.durability ?? null,
        attrs: p.attrs ? { three: p.attrs.threePoint, mid: p.attrs.midRange, close: p.attrs.closeShot, perD: p.attrs.perimeterD, intD: p.attrs.interiorD, stam: p.attrs.stamina, hustle: p.attrs.hustle, offCons: p.attrs.offConsistency, defCons: p.attrs.defConsistency, iq: p.attrs.shotIQ, pass: p.attrs.passIQ } : null }) },
    { name: "nba2k-ratings (GitHub: lostboyy24, via 2kAuction)", url: "https://raw.githubusercontent.com/lostboyy24/nba2k-ratings/HEAD/players.json",
      map: (p) => ({ n: p.n, ovr: p.o, pos: p.p }) },
  ];
  const out = { fetched: new Date().toISOString(), note: "Unofficial community datasets - not affiliated with 2K. Used only as a light prior.", sources: [] };
  for (const s of sources) {
    try {
      const j = await getJSON(s.url);
      const arr = Array.isArray(j) ? j : j.players || Object.values(j);
      out.sources.push({ name: s.name, url: s.url, players: arr.map(s.map).filter((p) => p.n && p.ovr) });
      log(`2K ratings ${s.name}: ${arr.length}`);
    } catch (e) { log(`2K ratings ${s.name} unavailable (${e.message})`); }
  }
  if (out.sources.length) writeJSON(path.join(DATA, "ratings2k.json"), out);
}

// ---------- news headlines (title + short summary + link only) ----------
function rssItems(xml, outlet, kind = "news") {
  const items = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const blk = m[0];
    const tag = (n) => {
      const r = blk.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`));
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim() : "";
    };
    const d = new Date(tag("pubDate") || tag("dc:date") || Date.now());
    items.push({ outlet, kind, title: tag("title"), url: tag("link"), date: (isNaN(d) ? new Date() : d).toISOString(), summary: tag("description").slice(0, 280) });
  }
  // Atom feeds (YouTube, Reddit)
  for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const blk = m[0];
    const tag = (n) => { const r = blk.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)); return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&lt;[^&]*&gt;/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim() : ""; };
    const link = (blk.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    const d = new Date(tag("published") || tag("updated") || Date.now());
    items.push({ outlet, kind, title: tag("title"), url: link.replace(/&amp;/g, "&"), date: (isNaN(d) ? new Date() : d).toISOString(), summary: (tag("media:description") || "").replace(/\s+/g, " ").slice(0, 280) });
  }
  return items;
}
async function fetchNews() {
  const all = [];
  try {
    const j = await getJSON(`${ESPN}/news?limit=50`);
    for (const a of j?.articles || []) {
      all.push({
        outlet: "ESPN", kind: "news", title: a.headline, url: a.links?.web?.href, date: a.published, summary: (a.description || "").slice(0, 280),
        athletes: (a.categories || []).filter((c) => c.type === "athlete").map((c) => String(c.athleteId || c.athlete?.id)),
        teams: (a.categories || []).filter((c) => c.type === "team").map((c) => String(c.teamId || c.team?.id)),
      });
    }
  } catch (e) { log("espn news fail", e.message); }
  // Sources are listed in config/sources.json so they can be edited without touching code.
  const cfg = readJSON(path.join(ROOT, "config", "sources.json"), { feeds: [], youtube: [] });
  const UA = { "User-Agent": NBA_H["User-Agent"], "Accept-Language": "en-US,en;q=0.9" };
  const grab = async (url) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000); try { const r = await fetch(url, { headers: UA, signal: ac.signal }); return r.ok ? await r.text() : ""; } finally { clearTimeout(t); } };
  for (const f of cfg.feeds) {
    try { const items = rssItems(await grab(f.url), f.name, f.kind || "news"); all.push(...items.map((x) => ({ ...x, general: !!f.general }))); log(`feed ${f.name}: ${items.length}`); }
    catch (e) { log(`${f.name} feed fail`, e.message); }
  }
  const ytCache = readJSON(path.join(DATA, "youtube-channels.json"), {});
  for (const c of cfg.youtube) {
    try {
      if (!ytCache[c.handle]) { const page = await grab(`https://www.youtube.com/@${c.handle}`); ytCache[c.handle] = (page.match(/"channelId":"(UC[\w-]{22})"/) || page.match(/channel_id=(UC[\w-]{22})/) || [])[1] || null; }
      if (!ytCache[c.handle]) { log(`youtube ${c.handle}: channel not found`); continue; }
      const items = rssItems(await grab(`https://www.youtube.com/feeds/videos.xml?channel_id=${ytCache[c.handle]}`), `${c.name} (YouTube)`, "video");
      all.push(...items.map((x) => ({ ...x, general: !!c.general }))); log(`youtube ${c.name}: ${items.length}`);
    } catch (e) { log(`youtube ${c.handle} fail`, e.message); }
  }
  writeJSON(path.join(DATA, "youtube-channels.json"), ytCache, true);
  // Keep a rolling 21-day archive.
  const file = path.join(DATA, "news.json");
  const prev = readJSON(file, []);
  const byUrl = new Map([...prev, ...all].filter((x) => x.url && x.title).map((x) => [x.url, x]));
  const cutoff = Date.now() - 21 * 864e5;
  // Owner rule: no betting content. The filter runs over the merged archive, so items stored by
  // an earlier run are purged too (odds / picks / props articles, sportsbook promotions).
  const fresh = [...byUrl.values()].filter((x) => Date.parse(x.date) > cutoff);
  const merged = fresh.filter((x) => !isBetting(x)).sort((a, b) => b.date.localeCompare(a.date));
  writeJSON(file, merged);
  log(`news items: ${merged.length} (${fresh.length - merged.length} betting items dropped)`);
}

// ---------- main ----------
const only = process.argv[2];
const teamIds = await fetchTeams();
const scanDays = async (from, to) => {
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  log(`scanning ${dates.length} days ${from}..${to}`);
  const days = await pool(dates, 8, (d) => fetchDay(d, teamIds).catch((e) => { log("day fail", d, e.message); return []; }));
  const events = days.flat();
  log(`events: ${events.length}`);
  return events;
};
const stored = () => readJSON(path.join(DATA, "rosters.json"), {});
if (only === "pregame") {
  // Game-day refresh, a few dozen requests: yesterday's and today's scores (box score and
  // play-by-play of games that just ended), rosters, injuries, referee crews, starting line-ups
  // and inactive lists for games in the next 30 hours, odds for comparison, and the matchup
  // tracking of games that just ended. No NBA.com season tables, news or snapshots.
  const events = await scanDays(addDays(today, -1), addDays(today, 2));
  await fetchGames(events);
  await fetchRosters(teamIds).catch((e) => log("rosters fail", e.message));
  await fetchInjuries().catch((e) => log("injuries fail", e.message));
  await fetchPregame(events, stored()).catch((e) => log("pregame fail", e.message));
  await writeOdds(events).catch((e) => log("odds fail", e.message));
  await fetchMatchups(events).catch((e) => log("matchups fail", e.message));
}
if (!only || only === "games" || only === "matchups") {
  const events = await scanDays(START, END);
  if (only !== "matchups") {
    await fetchGames(events);
    await fetchPregame(events, stored()).catch((e) => log("pregame fail", e.message));
    await writeOdds(events).catch((e) => log("odds fail", e.message));
  }
  // default run and "matchups": NBA.com matchup tracking (MATCHUP_MAX games per run, newest first)
  if (!only || only === "matchups") await fetchMatchups(events).catch((e) => log("matchups fail", e.message));
}
if (only === "news") await fetchNews().catch((e) => log("news fail", e.message));
if (!only || only === "extra") {
  await fetchRosters(teamIds).catch((e) => log("rosters fail", e.message));
  await fetchInjuries().catch((e) => log("injuries fail", e.message));
  await fetchNbaStats().catch((e) => log("nba stats fail", e.message));
  await fetchNews().catch((e) => log("news fail", e.message));
  await fetch2K().catch((e) => log("2K fail", e.message));
  await fetchGameLogs().catch((e) => log("gamelogs fail", e.message));
  await fetchSnapshots().catch((e) => log("snapshots fail", e.message));
}
// "zones" alone refreshes just the shot-zone / defender / play-type tables.
if (!only || only === "extra" || only === "zones") {
  await fetchNbaZones().catch((e) => log("nba zones fail", e.message));
  await fetchDefSnapshots().catch((e) => log("defender snapshots fail", e.message));
}
log("fetch complete");
