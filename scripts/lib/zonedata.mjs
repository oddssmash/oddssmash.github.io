// Read-side helpers for the raw zone caches written by scripts/fetch.mjs:
//   data/pbp/<id>.json     play-by-play shots (layout: top of zones.mjs)
//   data/nbazones.json     NBA.com season totals: shot locations, defender tracking, play types
//   data/defsnapshots.json NBA.com defender tracking as it stood each Monday
// Formats are spelled out in docs/DATA-RAW.md.
//
// Back-test rule: a season-total table of the season being replayed is a leak. For a past
// game use tableSeason(date) (the previous season) or defenderAsOf() (a snapshot dated
// strictly before the game), or build the numbers game by game from data/pbp.
import path from "node:path";
import { DATA, readJSON } from "./util.mjs";
import { normName } from "./stats.mjs";

const etDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)).replace(/-/g, "");
const seasonStr = (y) => `${y - 1}-${String(y).slice(2)}`; // 2027 -> "2026-27"
const seasonOfDate = (iso) => { const d = new Date(iso); const y = d.getUTCFullYear(); return d.getUTCMonth() >= 8 ? y + 1 : y; };
const pct = (m, a) => (a ? m / a : null);

export function loadPbp(id) { return readJSON(path.join(DATA, "pbp", `${id}.json`)); }

export function loadZoneData() {
  const nz = readJSON(path.join(DATA, "nbazones.json"), {});
  const ds = readJSON(path.join(DATA, "defsnapshots.json"), {});
  const seasons = nz.seasons || {}, zones = nz.zones || [], snaps = ds.snaps || {};
  const snapKeys = Object.keys(snaps).sort();

  // Season whose full-season tables may be used for a game on this date: the same season only
  // for a game that has not been played yet (the caller passes live = !game.completed; the clock
  // is never consulted), otherwise the one before.
  const seasonOf = (iso) => seasonStr(seasonOfDate(iso));
  const tableSeason = (iso, live = false) => (live ? seasonOf(iso) : seasonStr(seasonOfDate(iso) - 1));

  const zoneRow = (r) => {
    if (!r) return null;
    const o = { fga: 0, fgm: 0, zones: {} };
    zones.forEach((z, i) => { const m = r[i * 2], a = r[i * 2 + 1]; o.zones[z] = { fgm: m, fga: a, pct: pct(m, a) }; o.fga += a; o.fgm += m; });
    for (const z of zones) o.zones[z].share = pct(o.zones[z].fga, o.fga);
    return o;
  };
  const defRow = (r) => (r ? { gp: r[0], freq: r[1], fgm: r[2], fga: r[3], pct: pct(r[2], r[3]), nsPct: r[4], diff: r[3] ? r[2] / r[3] - r[4] : null } : null);
  // League-wide pct allowed in one snapshot and category: a baseline that is itself point-in-time.
  const lgCache = new Map();
  const leaguePct = (key, cat) => {
    const ck = key + cat;
    if (!lgCache.has(ck)) { let m = 0, a = 0; for (const r of Object.values(snaps[key]?.[cat] || {})) { m += r[1]; a += r[2]; } lgCache.set(ck, pct(m, a)); }
    return lgCache.get(ck);
  };
  const synRow = (r) => (r ? { gp: r[0], possPct: r[1], ppp: r[2], poss: r[3], pts: r[4], fgm: r[5], fga: r[6], efgPct: r[7], tovPct: r[8], ftPct: r[9], scorePct: r[10], pctile: r[11] } : null);
  const synAll = (tbl, key) => { const o = {}; for (const [pt, rows] of Object.entries(tbl || {})) if (rows[key]) o[pt] = synRow(rows[key]); return Object.keys(o).length ? o : null; };

  return {
    seasons: Object.keys(seasons), zones, playTypes: nz.playTypes || [], snapshotDates: snapKeys,
    seasonOf, tableSeason,
    // [nbaId, name, team, pos] for a player in that season's tables
    player: (name, season) => seasons[season]?.players?.[normName(name)] || null,
    // season totals by NBA.com zone: { fga, fgm, zones: { RA: { fgm, fga, pct, share }, ... } }
    shotLoc: (name, season) => zoneRow(seasons[season]?.shotLoc?.[normName(name)]),
    teamShotLoc: (espnTeamId, season) => zoneRow(seasons[season]?.teamShotLoc?.[espnTeamId]),
    teamOppShotLoc: (espnTeamId, season) => zoneRow(seasons[season]?.teamOppShotLoc?.[espnTeamId]),
    // defender tracking, season total. cat: overall | fg3 | fg2 | lt6 | lt10 | gt15. diff < 0 = shooters do worse than usual
    defender: (name, season, cat = "overall") => defRow(seasons[season]?.defend?.[cat]?.[normName(name)]),
    // Point-in-time defender numbers for a game: latest Monday snapshot of the game's season dated
    // strictly before its US Eastern date; cat: lt6 | fg3 | gt15. Returns null when there is none
    // (first week of a season) - fall back to defender(name, tableSeason(date), cat).
    // vsLeague = pct allowed minus the league pct allowed in the same snapshot (negative = better).
    // The file's nsPct column is deliberately NOT returned here: NBA.com fills it with the shooters'
    // full-season percentages even when DateTo is set, so for a past game it looks ahead.
    defenderAsOf(name, iso, cat = "lt6") {
      const season = seasonOf(iso), day = etDay(iso);
      let best = null;
      for (const k of snapKeys) { const [s, d] = k.split("|"); if (s === season && d < day) best = k; }
      const r = best ? snaps[best]?.[cat]?.[normName(name)] : null;
      if (!r) return null;
      const lg = leaguePct(best, cat), p = pct(r[1], r[2]);
      return { gp: r[0], fgm: r[1], fga: r[2], pct: p, lgPct: lg, vsLeague: p != null && lg != null ? p - lg : null, asOf: best.split("|")[1] };
    },
    // Synergy play types, season totals: { Isolation: { gp, possPct, ppp, poss, pts, ... }, ... }
    synergyPlayer: (name, season) => synAll(seasons[season]?.synP, normName(name)),
    synergyTeam: (espnTeamId, season, side = "off") => synAll(side === "def" ? seasons[season]?.synD : seasons[season]?.synT, espnTeamId),
    // shot creation, season totals. cat: catch | pullup | lt10
    ptShot(name, season, cat = "catch") {
      const r = seasons[season]?.ptShot?.[cat]?.[normName(name)];
      return r ? { gp: r[0], freq: r[1], fgm: r[2], fga: r[3], pct: pct(r[2], r[3]), efgPct: r[4], fg3m: r[5], fg3a: r[6], fg3Pct: pct(r[5], r[6]) } : null;
    },
  };
}
