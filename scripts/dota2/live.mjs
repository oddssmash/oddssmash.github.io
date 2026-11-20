// Dota 2 live feed: pro games being played right now (OpenDota /live: teams, heroes, kills, gold lead, game clock) and
// the latest finished pro games (OpenDota /proMatches: teams, winner, series). Two API calls. Runs every 10 minutes in the
// live workflow (published on the live-data branch, which the site polls) and before the model in the main update.
// Writes live/dota2.json. No betting data.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/util.mjs";

const UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)" };
const get = async (u) => { try { const r = await fetch(u, { headers: UA }); return r.ok ? await r.json() : null; } catch { return null; } };
const [live, recent] = await Promise.all([get("https://api.opendota.com/api/live"), get("https://api.opendota.com/api/proMatches")]);
const out = { updated: new Date().toISOString(), source: "OpenDota (live pro games and latest pro matches)",
  live: (live || []).filter((g) => g.league_id > 0 && g.team_id_radiant && g.team_id_dire).map((g) => ({ id: +g.match_id, sid: +g.series_id || 0, league: g.league_id, r: g.team_id_radiant, d: g.team_id_dire, rn: g.team_name_radiant, dn: g.team_name_dire,
    t: g.game_time, rk: g.radiant_score, dk: g.dire_score, lead: g.radiant_lead, hr: (g.players || []).filter((p) => p.team === 0).map((p) => p.hero_id).filter(Boolean), hd: (g.players || []).filter((p) => p.team === 1).map((p) => p.hero_id).filter(Boolean) })),
  recent: (recent || []).filter((m) => m.radiant_team_id && m.dire_team_id && m.radiant_win != null).map((m) => ({ id: m.match_id, sid: m.series_id || 0, st: m.series_type, start: m.start_time, dur: m.duration, r: m.radiant_team_id, d: m.dire_team_id, rw: m.radiant_win ? 1 : 0, rk: m.radiant_score, dk: m.dire_score, league: m.league_name })) };
fs.mkdirSync(path.join(ROOT, "live"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "live", "dota2.json"), JSON.stringify(out));
console.log(`Dota 2 live: ${out.live.length} pro games in progress, ${out.recent.length} recent results`);
