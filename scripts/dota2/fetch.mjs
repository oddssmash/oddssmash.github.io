// Dota 2 fetcher. The MLBB workflow, with Dota 2 sources:
//  1. OpenDota (open API, data from Valve's match replays): every professional / premium-tier match of the last 400 days
//     with its full draft (picks and bans in order) and each player's hero and line, read in bulk through OpenDota's
//     public SQL explorer (one request per 20 days of matches; only new matches after the first run). Teams, leagues,
//     pro player names, hero list and hero meta (pro picks / bans / wins and public ranked rates by bracket).
//  2. Liquipedia Dota 2 (MediaWiki API, CC-BY-SA, credited on every page): the upcoming match list (teams, start time,
//     best-of, tournament) from Liquipedia:Matches. One page render per run (Liquipedia allows one every 30 seconds),
//     descriptive user agent, gzip.
//  3. Valve: the official patch list (dota2.com datafeed).
// Polite: OpenDota allows 60 calls a minute without a key; this uses about 30 a run. No betting data.
// Writes data/dota2/{matches,teams,leagues,players,heroes,herostats,patches,upcoming}.json.
import path from "node:path";
import fs from "node:fs";
import { DATA, readJSON, writeJSON } from "../lib/util.mjs";

const D = path.join(DATA, "dota2"); fs.mkdirSync(D, { recursive: true });
const UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)", "accept-encoding": "gzip" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), DAY = 86400, now = Math.floor(Date.now() / 1000);
let last = 0;
async function od(pathq, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const wait = last + 1100 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
    try { const r = await fetch("https://api.opendota.com/api/" + pathq, { headers: UA }); if (r.ok) return await r.json(); if (r.status === 429) await sleep(20000); else await sleep(3000); } catch { await sleep(5000); }
  }
  return null;
}
const sql = async (q) => { const j = await od("explorer?" + new URLSearchParams({ sql: q })); if (!j || j.err) { console.log("explorer:", j?.err || "no reply"); return null; } return j.rows; };

// ---------------------------------------------------------------- 1) matches with drafts and player lines
const MF = path.join(D, "matches.json"), store = readJSON(MF, { matches: [] });
const byId = new Map(store.matches.map((m) => [m.id, m]));
const newest = store.matches.reduce((a, m) => Math.max(a, m.t), 0);
const from = newest ? newest - 3 * DAY : now - 400 * DAY; // re-read the last 3 days so late-parsed drafts fill in
const Q = (a, b) => `SELECT m.match_id, m.start_time, m.duration, m.radiant_win, m.radiant_team_id rt, m.dire_team_id dt, m.leagueid, m.series_id, m.series_type,
  (SELECT string_agg(CASE WHEN is_pick THEN 'p' ELSE 'b' END || team || ':' || hero_id, ',' ORDER BY ord) FROM picks_bans pb WHERE pb.match_id = m.match_id) d,
  (SELECT string_agg(pm.account_id || ':' || pm.hero_id || ':' || pm.player_slot || ':' || pm.kills || ':' || pm.deaths || ':' || pm.assists || ':' || pm.gold_per_min || ':' || pm.last_hits, ',') FROM player_matches pm WHERE pm.match_id = m.match_id) pl
  FROM matches m JOIN leagues l USING(leagueid)
  WHERE m.start_time >= ${a} AND m.start_time < ${b} AND l.tier IN ('premium', 'professional') AND m.radiant_team_id IS NOT NULL AND m.dire_team_id IS NOT NULL AND m.radiant_team_id <> m.dire_team_id
  ORDER BY m.match_id`;
let added = 0, windows = 0;
for (let a = from; a < now; a += 20 * DAY) {
  const rows = await sql(Q(a, Math.min(now + DAY, a + 20 * DAY))); windows++; if (!rows) continue;
  for (const r of rows) {
    if (r.radiant_win == null) continue;
    const m = { id: +r.match_id, t: +r.start_time, dur: +r.duration, rw: r.radiant_win ? 1 : 0, r: +r.rt, d: +r.dt, lg: +r.leagueid, sid: +r.series_id || 0, st: +r.series_type || 0, dr: r.d || "", pl: r.pl || "" };
    if (!byId.has(m.id)) added++; byId.set(m.id, m);
  }
}
const cutoff = now - 420 * DAY;
store.matches = [...byId.values()].filter((m) => m.t >= cutoff).sort((a, b) => a.t - b.t || a.id - b.id);
store.fetched = new Date().toISOString(); store.source = "OpenDota (opendota.com) public explorer: professional and premium-tier leagues";
writeJSON(MF, store);
console.log(`Dota 2 matches: ${added} new over ${windows} windows, ${store.matches.length} on file (${store.matches.filter((m) => m.dr).length} with drafts)`);

// ---------------------------------------------------------------- 2) teams, leagues, players
const recent = store.matches.filter((m) => m.t > now - 400 * DAY);
const teamIds = [...new Set(recent.flatMap((m) => [m.r, m.d]))], leagueIds = [...new Set(recent.map((m) => m.lg))];
const TF = path.join(D, "teams.json"), teams = readJSON(TF, {});
for (let i = 0; i < teamIds.length; i += 300) {
  const rows = await sql(`SELECT team_id, name, tag, logo_url FROM teams WHERE team_id IN (${teamIds.slice(i, i + 300).join(",")})`);
  for (const r of rows || []) teams[r.team_id] = { id: +r.team_id, name: (r.name || "").trim() || `Team ${r.team_id}`, tag: (r.tag || "").trim() || null, logo: r.logo_url || null };
}
writeJSON(TF, teams);
const LF = path.join(D, "leagues.json"), leagues = readJSON(LF, {});
const needL = leagueIds.filter((id) => !leagues[id]);
for (let i = 0; i < needL.length; i += 300) { const rows = await sql(`SELECT leagueid, name, tier FROM leagues WHERE leagueid IN (${needL.slice(i, i + 300).join(",")})`); for (const r of rows || []) leagues[r.leagueid] = { id: +r.leagueid, name: (r.name || "").trim(), tier: r.tier }; }
writeJSON(LF, leagues);
const PF = path.join(D, "players.json"), oldP = readJSON(PF, null);
if (!oldP || Date.now() - Date.parse(oldP.fetched) > 2 * 86400000) {
  const pro = await od("proPlayers");
  if (Array.isArray(pro)) { const seen = new Set(recent.flatMap((m) => m.pl.split(",").map((x) => +x.split(":")[0]))); const players = {};
    for (const p of pro) if (seen.has(p.account_id)) players[p.account_id] = { id: p.account_id, name: p.name || p.personaname, team: p.team_id || null, country: p.country_code || null, role: p.fantasy_role || null, avatar: p.avatarfull || null };
    writeJSON(PF, { fetched: new Date().toISOString(), players }); console.log(`pro players named: ${Object.keys(players).length}`); }
}
console.log(`teams ${Object.keys(teams).length}, leagues ${Object.keys(leagues).length}`);

// ---------------------------------------------------------------- 3) heroes, hero meta, patches
const HF = path.join(D, "heroes.json"), oldH = readJSON(HF, null);
if (!oldH || Date.now() - Date.parse(oldH.fetched) > 3 * 86400000) {
  const h = await od("constants/heroes");
  if (h) writeJSON(HF, { fetched: new Date().toISOString(), heroes: Object.fromEntries(Object.values(h).map((x) => [x.id, { id: x.id, name: x.localized_name, key: x.name.replace("npc_dota_hero_", ""), attr: x.primary_attr, attack: x.attack_type, roles: x.roles || [] }])) });
}
const hs = await od("heroStats");
if (Array.isArray(hs)) writeJSON(path.join(D, "herostats.json"), { fetched: new Date().toISOString(), source: "OpenDota hero stats (pro games and public ranked games by bracket)",
  heroes: Object.fromEntries(hs.map((x) => { const br = [1, 2, 3, 4, 5, 6, 7, 8].map((b) => [x[`${b}_pick`] || 0, x[`${b}_win`] || 0]); const hiP = br[6][0] + br[7][0], hiW = br[6][1] + br[7][1], allP = br.reduce((a, b) => a + b[0], 0), allW = br.reduce((a, b) => a + b[1], 0);
    return [x.id, { proPick: x.pro_pick || 0, proWin: x.pro_win || 0, proBan: x.pro_ban || 0, pubPick: allP, pubWin: allW, highPick: hiP, highWin: hiW, turboPick: x.turbo_picks || 0 }]; })) });
// hero traits from pro games (last 120 days): what each hero does in a game, not whether it wins. Control (stuns), teamfight
// participation, hero damage, tower damage, Roshan kills, camps stacked, wards, healing, gold and last hits at 10 minutes
// (laning), farm (gold a minute), deaths. Refetched every 2 days. Used for the draft factors and the draft write-ups.
{ const TF = path.join(D, "herotraits.json"), old = readJSON(TF, null);
  if (!old || Date.now() - Date.parse(old.fetched) > 2 * 86400000) {
    const rows = await sql(`SELECT pm.hero_id, count(*) n, avg(pm.stuns) stuns, avg(pm.teamfight_participation) tf, avg(pm.hero_damage) hd, avg(pm.tower_damage) td, avg(pm.roshans_killed) rosh, avg(pm.camps_stacked) stack,
      avg(pm.obs_placed) obs, avg(pm.hero_healing) heal, avg(pm.gold_per_min) gpm, avg(pm.deaths) d, avg(pm.gold_t[11]) g10, avg(pm.lh_t[11]) lh10, avg(CASE WHEN pm.is_roaming THEN 1 ELSE 0 END) roam, avg(m.duration) dur
      FROM player_matches pm JOIN matches m USING(match_id) JOIN leagues l USING(leagueid) WHERE m.start_time > ${now - 120 * DAY} AND l.tier IN ('premium', 'professional') GROUP BY pm.hero_id`);
    if (rows?.length) { writeJSON(TF, { fetched: new Date().toISOString(), source: "OpenDota explorer: pro games, last 120 days, per-hero averages", heroes: Object.fromEntries(rows.map((r) => [r.hero_id, Object.fromEntries(Object.entries(r).filter(([k]) => k !== "hero_id").map(([k, v]) => [k, v == null ? null : Math.round(+v * 1000) / 1000]))])) }); console.log(`hero traits: ${rows.length} heroes`); }
  } }
try { const r = await fetch("https://www.dota2.com/datafeed/patchnoteslist?language=english", { headers: UA }); if (r.ok) { const j = await r.json(); const ps = (j.patches || []).filter((p) => p.patch_timestamp > now - 500 * DAY).map((p) => ({ patch: p.patch_number, date: new Date(p.patch_timestamp * 1000).toISOString() }));
  writeJSON(path.join(D, "patches.json"), { fetched: new Date().toISOString(), source: "Valve (dota2.com patch list)", patches: ps }); console.log(`patches: latest ${ps.at(-1)?.patch} (${ps.at(-1)?.date?.slice(0, 10)})`);
  // the newest patch's notes: how many changes each hero got (hero, ability and talent lines), refetched when the patch changes
  const NF = path.join(D, "patchnotes.json"), oldN = readJSON(NF, null), lastP = ps.at(-1)?.patch;
  if (lastP && (!oldN || oldN.patch !== lastP || Date.now() - Date.parse(oldN.fetched) > 86400000)) { const n = await (await fetch(`https://www.dota2.com/datafeed/patchnotes?version=${encodeURIComponent(lastP)}&language=english`, { headers: UA })).json();
    const cnt = (h) => (h.hero_notes || []).length + (h.talent_notes || []).length + (h.abilities || []).reduce((a, x) => a + (x.ability_notes || []).length, 0) + (h.subsections || []).reduce((a, s) => a + (s.abilities || []).reduce((b, x) => b + (x.ability_notes || []).length, 0) + (s.general_notes || []).length, 0);
    writeJSON(NF, { fetched: new Date().toISOString(), patch: lastP, date: ps.at(-1).date, heroes: Object.fromEntries((n.heroes || []).map((h) => [h.hero_id, cnt(h)]).filter(([, c]) => c > 0)) }); } } } catch (e) { console.log("patches:", e.message); }

// ---------------------------------------------------------------- 4) upcoming matches (Liquipedia:Matches)
const dec = (s) => s.replace(/&#95;/g, "_").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#124;/g, "|");
try {
  const r = await fetch("https://liquipedia.net/dota2/api.php?" + new URLSearchParams({ action: "parse", page: "Liquipedia:Matches", prop: "text", format: "json" }), { headers: UA });
  const html = r.ok ? dec((await r.json())?.parse?.text?.["*"] || "") : "";
  const upcomingPart = html.split('data-toggle-area-content="2"')[0];
  const out = [];
  for (const c of upcomingPart.split('<div class="match-ticker-card"').slice(1)) {
    const ts = +(c.match(/data-timestamp="(\d+)"/) || [])[1]; if (!ts) continue;
    const head = (c.match(/data-format="compact">[\s\S]*?<\/span><\/span><div>([^<]*)<\/div>/) || [])[1] || "";
    const bo = +(head.match(/Bo(\d)/i) || [])[1] || 3, stage = head.replace(/\s*-?\s*Bo\d/i, "").trim();
    const opp = c.split('class="match-ticker-card__opponent"').slice(1, 3).map((o) => ({ name: (o.match(/class="team-name">([^<]+)</) || [])[1]?.trim() || null, short: (o.match(/class="team-shortname">([^<]+)</) || [])[1]?.trim() || null, page: (o.match(/class="name[^"]*"[^>]*><a href="\/dota2\/([^"]+)"/) || [])[1] || null }));
    const tour = (c.match(/match-ticker-card-tournament-name"><a href="\/dota2\/([^"#]+)[^"]*" title="[^"]*">([^<]+)</) || []);
    if (opp.length < 2 || !opp[0].name || !opp[1].name || /^TBD$/i.test(opp[0].name) || /^TBD$/i.test(opp[1].name)) continue;
    out.push({ date: new Date(ts * 1000).toISOString(), bo, stage, a: opp[0], b: opp[1], tournament: tour[2]?.trim() || null, tpage: tour[1] || null });
  }
  if (html) { writeJSON(path.join(D, "upcoming.json"), { fetched: new Date().toISOString(), source: "Liquipedia Dota 2 (Liquipedia:Matches)", matches: out }); console.log(`upcoming (Liquipedia): ${out.length} matches with both teams set`); }
} catch (e) { console.log("upcoming:", e.message); }
