// Who guarded whom: NBA.com matchup tracking, one compact file per game in data/matchups/<espnId>.json.
// Written by scripts/fetch.mjs (compactMatchups), read with loadMatchups / matchupsBefore.
// Back-test rule: a projection for game G may only use files of games that tipped off before G
// (matchupsBefore does that filter). Layout: docs/DATA-RAW.md, section "matchups".
import fs from "node:fs";
import path from "node:path";
import { DATA, readJSON } from "./util.mjs";
import { matchPerson } from "./nbaids.mjs";

export const MATCHUP_VERSION = 1;
export const MATCHUP_DIR = path.join(DATA, "matchups");
// One row per offensive player x defender pair.
export const MU_COLS = ["side", "off", "def", "poss", "sec", "pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "ast", "tov", "blk", "sw", "sfl", "pctOff", "pctDef"];
export const MU = Object.fromEntries(MU_COLS.map((c, i) => [c, i]));

const n = (v) => (Number.isFinite(+v) ? +v : 0);
const r1 = (v) => Math.round(n(v) * 10) / 10;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;

// j: boxscorematchupsv3 response. ev: compact schedule event. box: data/games/<id>.json (or null).
// idMap: loadIdMap() object. nbaTeam: NBA team id -> ESPN team id.
export function compactMatchups(j, ev, box, idMap, nbaTeam) {
  const b = j?.boxScoreMatchups;
  const base = { v: MATCHUP_VERSION, id: String(ev.id), date: ev.date, h: ev.home, a: ev.away, nba: b?.gameId || "" };
  if (!b || !(b.homeTeam?.players?.length || b.awayTeam?.players?.length)) return { ...base, empty: 1 };
  // NBA.com home/away must agree with ESPN's (neutral-site games can differ): sides follow ESPN
  const homeEspn = nbaTeam[String(b.homeTeamId)], awayEspn = nbaTeam[String(b.awayTeamId)];
  const flip = homeEspn && homeEspn === ev.away && awayEspn === ev.home;
  const roster = (tid) => (box?.players || []).filter((p) => String(p.t) === String(tid) && p.id).map((p) => ({ id: p.id, n: p.n }));
  const unmapped = [];
  const idOf = (person, tid) => {
    const name = `${person.firstName || ""} ${person.familyName || ""}`.trim() || person.nameI || "";
    const id = matchPerson(idMap, person.personId, name, roster(tid));
    if (id) return id;
    if (!unmapped.some((u) => u[0] === person.personId)) unmapped.push([person.personId, name, String(tid)]);
    return `nba:${person.personId}`; // kept, labelled as unmatched
  };
  const rows = [];
  for (const [key, nbaSide] of [["homeTeam", 0], ["awayTeam", 1]]) {
    const side = flip ? 1 - nbaSide : nbaSide;
    const offTeam = side === 0 ? ev.home : ev.away, defTeam = side === 0 ? ev.away : ev.home;
    for (const p of b[key]?.players || []) {
      const off = idOf(p, offTeam);
      for (const m of p.matchups || []) {
        const s = m.statistics || {};
        rows.push([side, off, idOf(m, defTeam), r1(s.partialPossessions), n(s.matchupMinutesSort), n(s.playerPoints),
          n(s.matchupFieldGoalsMade), n(s.matchupFieldGoalsAttempted), n(s.matchupThreePointersMade), n(s.matchupThreePointersAttempted),
          n(s.matchupFreeThrowsMade), n(s.matchupFreeThrowsAttempted), n(s.matchupAssists), n(s.matchupTurnovers), n(s.matchupBlocks),
          n(s.switchesOn), n(s.shootingFouls), r3(s.percentageOffensiveTotalTime), r3(s.percentageDefenderTotalTime)]);
      }
    }
  }
  const out = { ...base, rows };
  if (flip) out.flip = 1;
  if (unmapped.length) out.un = unmapped;
  return out;
}

// Reader: rows as objects. Ids are strings; an unmatched NBA.com player reads "nba:<personId>".
export function loadMatchups(espnId) {
  const j = readJSON(path.join(MATCHUP_DIR, `${espnId}.json`));
  if (!j || j.empty) return j ? { ...j, rows: [] } : null;
  return { ...j, rows: j.rows.map((r) => Object.fromEntries(MU_COLS.map((c, i) => [c, r[i]]))) };
}

// Every stored game that tipped off strictly before `iso` (leak-free for the back-test).
// Reads the folder once and keeps it; pass fresh = true after new files were written.
let INDEX = null;
export function matchupIndex(fresh = false) {
  if (INDEX && !fresh) return INDEX;
  INDEX = [];
  if (!fs.existsSync(MATCHUP_DIR)) return INDEX;
  for (const f of fs.readdirSync(MATCHUP_DIR)) {
    if (!f.endsWith(".json")) continue;
    const j = readJSON(path.join(MATCHUP_DIR, f));
    if (j && !j.empty) INDEX.push({ id: j.id, date: j.date, h: j.h, a: j.a });
  }
  INDEX.sort((x, y) => x.date.localeCompare(y.date));
  return INDEX;
}
export function matchupsBefore(iso) {
  return matchupIndex().filter((g) => g.date < iso);
}
