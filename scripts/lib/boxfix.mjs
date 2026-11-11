// Repairs and labels applied to the stored games when they are loaded (nothing in data/ is rewritten).
//
// 1. teamBox(g, tid)      team totals from ESPN's own team row of the box score. Player rows can be
//                         incomplete (see 2), so team FG / 3P / FT / rebounds / assists / turnovers
//                         are read from the team row and only fall back to the player sum.
// 2. repairBlankRows(...) ESPN sometimes returns a box-score row with no athlete id, no name and no
//                         numbers for a player who did play (Chicago, 2025-26: 48 games). His line
//                         is rebuilt as "team row minus the other players", his id comes from the
//                         play-by-play participants who are not in the box score, his name and
//                         minutes from the official NBA.com game log of that day.
// 3. markCupFinals(games) The NBA Cup final is labelled a regular-season game by ESPN but does not
//                         count in official records or statistics. It is flagged cup: true so that
//                         regular-season records and comparisons with NBA.com totals leave it out,
//                         while the model still learns from it.
// 4. scoreOnlyGames(...)  finished games that have a final score in the schedule but no box score
//                         on ESPN (8 playoff games of 2025-26). They count in win-loss records,
//                         previous meetings, rest days and Elo, and are skipped by anything that
//                         needs box-score numbers.
import fs from "node:fs";
import path from "node:path";
import { normName, etDay } from "./stats.mjs";

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pair = (v) => { const [a, b] = String(v || "0-0").split("-"); return [num(a), num(b)]; };

export function teamBox(g, tid) {
  const t = (g.teams || []).find((x) => x.id === tid);
  if (!t || t["fieldGoalsMade-fieldGoalsAttempted"] == null) return null;
  const [fgm, fga] = pair(t["fieldGoalsMade-fieldGoalsAttempted"]);
  if (!fga) return null;
  const [tpm, tpa] = pair(t["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);
  const [ftm, fta] = pair(t["freeThrowsMade-freeThrowsAttempted"]);
  return { fgm, fga, tpm, tpa, ftm, fta, oreb: num(t.offensiveRebounds), dreb: num(t.defensiveRebounds), reb: num(t.totalRebounds), ast: num(t.assists), stl: num(t.steals), blk: num(t.blocks),
    to: num(t.turnovers), teamTO: num(t.teamTurnovers), pf: num(t.fouls) };
}

// logsByDay: Map("YYYY-MM-DD" ET -> [[date, name, teamAbbr, min, pts, reb, ast, fg3m], ...]); names: Map(id -> name)
export function repairBlankRows(g, loadPbp, logsByDay, abbrOf, names) {
  const blanks = (g.players || []).filter((p) => !p.id);
  if (!blanks.length) return 0;
  let fixed = 0, pbp;
  for (const tid of [g.home, g.away]) {
    const mine = g.players.filter((p) => p.t === tid), blank = mine.filter((p) => !p.id);
    if (blank.length !== 1) continue; // two unnamed rows cannot be told apart
    const row = blank[0], tb = teamBox(g, tid);
    if (!tb) continue;
    const others = mine.filter((p) => p.id);
    const sum = (k) => others.reduce((s, p) => s + (p[k] || 0), 0);
    const line = { pts: (tid === g.home ? g.hs : g.as) - sum("pts") };
    for (const k of ["fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "to", "pf"]) line[k] = tb[k] - sum(k);
    if (Object.values(line).some((v) => v < 0)) continue; // the team row does not cover the listed players: leave it
    // who he is: the one play-by-play participant of this side who is not in the box score
    pbp ??= loadPbp(g.id) || {};
    const side = tid === g.home ? 0 : 1, known = new Set(others.map((p) => String(p.id))), cand = new Set();
    for (const r of pbp.shots || []) if (r[1] === side && r[0] && !known.has(String(r[0]))) cand.add(String(r[0]));
    for (const r of pbp.ft || []) if (r[1] === side && r[0] && !known.has(String(r[0]))) cand.add(String(r[0]));
    for (const r of pbp.pf || []) if (r[1] === side && r[0] && !known.has(String(r[0]))) cand.add(String(r[0]));
    for (const r of pbp.subs || []) if (r[2] === side) for (const id of [r[3], r[4]]) if (id && !known.has(String(id))) cand.add(String(id));
    // official log rows of that day for this team whose name is not in the box score
    const boxNames = new Set(others.map((p) => normName(p.n)));
    const logRows = (logsByDay.get(etDay(g.date)) || []).filter((r) => r[2] === abbrOf(tid) && !boxNames.has(normName(r[1])));
    const log = logRows.length === 1 ? logRows[0] : null;
    const played = Object.values(line).some((v) => v > 0) || (log && num(log[3]) > 0);
    if (!played) { row.dnp = 1; continue; } // nothing is missing from the team totals: he did not play
    if (cand.size !== 1 && !(log && names.byName.get(normName(log[1])))) continue;
    const id = cand.size === 1 ? [...cand][0] : names.byName.get(normName(log[1]));
    const name = log ? log[1] : names.byId.get(id);
    if (!id || !name) continue;
    if (log && (num(log[4]) !== line.pts)) continue; // the official log disagrees with the remainder: do not guess
    const gameMin = 240 + 25 * Math.max(0, (g.periods || 4) - 4);
    Object.assign(row, line, { id, n: name, dnp: 0, why: "", min: log ? Math.round(num(log[3])) : Math.max(1, Math.min(48, gameMin - sum("min"))), fixed: 1 });
    fixed++;
  }
  return fixed;
}

// NBA Cup final: the last of 3 or more neutral-site regular-season games in the same arena in
// December of one season (two semi-finals, which do count, then the final, which does not).
export function markCupFinals(games) {
  const groups = new Map();
  for (const g of games) {
    if (g.stype !== 2 || !g.neutral || !g.completed || new Date(g.date).getUTCMonth() !== 11) continue;
    const k = `${g.season}|${g.venue || ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  const out = [];
  for (const arr of groups.values()) {
    if (arr.length < 3) continue;
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const last = arr.at(-1), semis = arr.slice(-3, -1);
    // the finalists are the two semi-final winners
    const winners = new Set(semis.map((s) => (s.hs > s.as ? s.home : s.away)));
    if (winners.has(last.home) && winners.has(last.away)) { last.cup = true; out.push(last.id); }
  }
  return out;
}

// Completed schedule events that have no data/games/<id>.json file.
export function scoreOnlyGames(schedDir, haveIds) {
  const out = [];
  for (const f of fs.readdirSync(schedDir)) {
    let evs; try { evs = JSON.parse(fs.readFileSync(path.join(schedDir, f), "utf8")); } catch { continue; }
    for (const e of evs || []) if (e.completed && !haveIds.has(String(e.id)) && (e.hs || e.as) && e.hs !== e.as) out.push({ ...e, noBox: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
