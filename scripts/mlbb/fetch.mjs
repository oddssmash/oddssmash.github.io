// MLBB fetcher. Source: Liquipedia's MediaWiki API (wikitext of each tournament stage page and team page), used
// within Liquipedia's API terms: a descriptive user agent, gzip, one request every 2 seconds, and only pages whose
// revision changed are downloaded again. Content is CC-BY-SA; the site credits Liquipedia on every MLBB page.
// Ranked-game hero rates come from mlbb.io (scripts/mlbb/ranked.mjs), not from here.
// Writes data/mlbb/pages/<page>.json (parsed matches), data/mlbb/teams/<team>.json (roster), data/mlbb/heroes-ranked.json.
// No betting data.
import path from "node:path";
import fs from "node:fs";
import { DATA, readJSON, writeJSON } from "../lib/util.mjs";
import { EVENTS } from "./events.mjs";

const MD = path.join(DATA, "mlbb"), PD = path.join(MD, "pages"), TD = path.join(MD, "teams");
for (const d of [PD, TD]) fs.mkdirSync(d, { recursive: true });
const UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)", "accept-encoding": "gzip" };
const API = "https://liquipedia.net/mobilelegends/api.php";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function api(params) {
  const wait = last + 2100 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
  for (let i = 0; i < 3; i++) { try { const r = await fetch(API + "?" + new URLSearchParams({ format: "json", ...params }), { headers: UA }); if (r.ok) return await r.json(); if (r.status === 429) await sleep(30000); } catch { await sleep(5000); } }
  return null;
}
const safe = (t) => t.replace(/[^A-Za-z0-9]+/g, "_");

// ---------------------------------------------------------------- wikitext parsing
// All {{Name ...}} blocks for a template name, with nested braces handled.
function blocks(text, name) {
  const out = [], re = new RegExp(`\\{\\{\\s*${name}\\b`, "g"); let m;
  while ((m = re.exec(text))) { let d = 0, i = m.index; for (; i < text.length - 1; i++) { if (text[i] === "{" && text[i + 1] === "{") { d++; i++; } else if (text[i] === "}" && text[i + 1] === "}") { d--; i++; if (d === 0) break; } } out.push(text.slice(m.index, i + 1)); re.lastIndex = i; }
  return out;
}
// top-level |key=value pairs of one template (nested templates kept whole)
function params(block) {
  const inner = block.replace(/^\{\{\s*[\w ]+/, "").replace(/\}\}$/, ""), out = {}; let d = 0, cur = "";
  const push = () => { const k = cur.indexOf("="); if (k > 0) out[cur.slice(0, k).trim()] = cur.slice(k + 1).replace(/<!--[\s\S]*?-->/g, "").trim(); };
  for (let i = 0; i < inner.length; i++) { const c = inner[i], n = inner[i + 1];
    if (c === "{" && n === "{") { d++; cur += "{{"; i++; continue; } if (c === "}" && n === "}") { d--; cur += "}}"; i++; continue; }
    if (c === "[" && n === "[") { d++; cur += "[["; i++; continue; } if (c === "]" && n === "]") { d--; cur += "]]"; i++; continue; }
    if (c === "|" && d === 0) { push(); cur = ""; continue; } cur += c; }
  push(); return out;
}
const TZ = { MMT: 6.5, IST: 5.5, SGT: 8, PHT: 8, PST: 8, MYT: 8, WIB: 7, WITA: 8, WIT: 9, ICT: 7, KST: 9, JST: 9, CST: 8, CET: 1, CEST: 2, EET: 2, EEST: 3, TRT: 3, GST: 4, AST: 3, MSK: 3, UTC: 0, GMT: 0, BST: 1, EST: -5, EDT: -4, CDT: -5, PDT: -7, BRT: -3 };
function parseDate(s) {
  if (!s) return null; const tz = ((s.match(/abbr\/(\w+)/i) || [])[1] || "SGT").toUpperCase(), clean = s.replace(/\{\{[^}]*\}\}/g, "").replace(/,(\d)/, ", $1").trim();
  const iso = clean.match(/(\d{4})-(\d{2})-(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/); // "2026-11-12 - 13:00"
  if (iso) { const t = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] ?? 12), +(iso[5] ?? 0)) - (TZ[tz] ?? 8) * 3600000; return { iso: new Date(t).toISOString(), timed: iso[4] != null }; }
  const m = clean.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2}))?/); if (!m) return null;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].slice(0, 3).toLowerCase()); if (mon < 0) return null;
  const t = Date.UTC(+m[3], mon, +m[2], +(m[4] ?? 12), +(m[5] ?? 0)) - (TZ[tz] ?? 8) * 3600000;
  return { iso: new Date(t).toISOString(), timed: m[4] != null };
}
const teamOf = (v) => { const m = (v || "").match(/TeamOpponent\s*\|\s*([^|}]+)/); return m ? m[1].trim() : null; };
const scoreOf = (v) => { const m = (v || "").match(/\|\s*score\s*=\s*(\w+)/); return m ? m[1] : null; };
const hero = (h) => (h || "").toLowerCase().replace(/[^a-z0-9 &'.-]/g, "").trim();
function parseMatches(text, ev) {
  const out = [];
  for (const b of blocks(text, "Match")) {
    const p = params(b), A = teamOf(p.opponent1), B = teamOf(p.opponent2); if (!A || !B || A === "TBD" || B === "TBD") continue;
    const d = parseDate(p.date), games = [];
    for (let i = 1; i <= 7; i++) { const mb = p[`map${i}`]; if (!mb) continue; const q = params(blocks(mb, "Map")[0] || "{{Map}}"); if (q.finished === "skip" || !q.winner) continue;
      games.push({ n: i, w: +q.winner, side1: q.team1side || null, len: q.length || null, map: (q.comment || "").match(/picked\s*<b>\[\[([^\]]+)\]\]/)?.[1] || null,
        h1: [1, 2, 3, 4, 5].map((k) => hero(q[`t1h${k}`])), h2: [1, 2, 3, 4, 5].map((k) => hero(q[`t2h${k}`])), b1: [1, 2, 3, 4, 5].map((k) => hero(q[`t1b${k}`])).filter(Boolean), b2: [1, 2, 3, 4, 5].map((k) => hero(q[`t2b${k}`])).filter(Boolean) }); }
    const s1 = games.filter((g) => g.w === 1).length, s2 = games.filter((g) => g.w === 2).length, bo = +p.bestof || 3, sc1 = scoreOf(p.opponent1), sc2 = scoreOf(p.opponent2);
    const need = Math.ceil(bo / 2), done = s1 >= need || s2 >= need || (sc1 != null && sc2 != null && /^\d+$/.test(sc1) && (+sc1 >= need || +sc2 >= need)) || /W|FF/.test(`${sc1}${sc2}`);
    out.push({ id: `${safe(ev.page)}-${out.length + 1}`, page: ev.page, league: ev.league, season: ev.season, stage: ev.stage, region: ev.region, kind: ev.kind, bo, a: A, b: B, date: d?.iso || null, timed: !!d?.timed,
      mvp: p.mvp || null, done, score: games.length ? [s1, s2] : sc1 != null && /^\d+$/.test(sc1) ? [+sc1, +sc2] : null, walkover: /W|FF/.test(`${sc1}${sc2}`), games });
  }
  return out;
}
// Team page squad: {{SquadPlayer|id=...|name=...|position=...}} rows (active players)
function parseSquad(text) {
  const act = text.split(/==+\s*(?:Former|Inactive|Organization|Staff)/i)[0];
  return blocks(act, "SquadPlayer").map((b) => { const q = params(b); return { id: q.id || q.link || null, name: q.name || null, role: (q.position || q.role || "").toLowerCase(), joined: q.joindate || null }; }).filter((x) => x.id);
}

// ---------------------------------------------------------------- run
// 1) which pages changed (one batched revision query per 40 titles)
const titles = EVENTS.map((e) => e.page), rev = {};
for (let i = 0; i < titles.length; i += 40) { const j = await api({ action: "query", prop: "revisions", rvprop: "ids", titles: titles.slice(i, i + 40).join("|") }); for (const pg of Object.values(j?.query?.pages || {})) if (pg.revisions) rev[pg.title] = pg.revisions[0].revid; }
let fetched = 0;
for (const ev of EVENTS) {
  const f = path.join(PD, `${safe(ev.page)}.json`), old = readJSON(f);
  if (!rev[ev.page]) continue; // stage not on Liquipedia for this season (or not created yet)
  if (old && old.revid === rev[ev.page]) continue;
  const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: ev.page });
  const text = Object.values(j?.query?.pages || {})[0]?.revisions?.[0]?.slots?.main?.["*"]; if (!text) continue;
  const matches = parseMatches(text, ev); writeJSON(f, { page: ev.page, revid: rev[ev.page], fetched: new Date().toISOString(), matches }); fetched++;
  console.log(`${ev.page}: ${matches.length} matches (${matches.filter((m) => m.done).length} done, ${matches.reduce((a, m) => a + m.games.length, 0)} games with drafts)`);
}
console.log(`MLBB: ${fetched} stage pages updated`);
// 2) season rosters: the rendered season page (action=parse, which Liquipedia limits to one call every 30 seconds)
// lists each team's five starters with their lane, plus subs. Refetched when the page changes or after 7 days.
const RD = path.join(MD, "rosters"); fs.mkdirSync(RD, { recursive: true });
const ROLE = { "EXP Lane": "EXP", Jungle: "Jungle", Jungler: "Jungle", "Mid Lane": "Mid", Mid: "Mid", Middle: "Mid", "Mid Laner": "Mid", "Gold Lane": "Gold", Roam: "Roam", Roamer: "Roam" };
const dec = (s) => s.replace(/&#95;/g, "_").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const staffOf = {}; // team -> [{ name, page, role }] from the Staff tab, filled by parseCards
function parseCards(html) {
  const h = dec(html), out = {};
  for (const card of h.split('class="general-collapsible collapsed team-participant-card"').slice(1)) {
    const team = (card.match(/team-participant-card__opponent-compact[\s\S]*?title="([^"]+)"/) || [])[1]; if (!team) continue;
    const main = (card.split('data-toggle-area-content="1"')[1] || "").split('data-toggle-area-content="2"')[0];
    const subs = (card.split('data-toggle-area-content="2"')[1] || "").split('data-toggle-area-content="3"')[0];
    const members = (part, sub) => part.split('class="team-participant-card__member"').slice(1).map((m) => ({ player: (m.match(/class="block-player"[\s\S]*?<a [^>]*title="([^"]+)"[^>]*>([^<]+)<\/a>/) || [])[2]?.trim() || null, page: (m.match(/class="block-player"[\s\S]*?<a [^>]*title="([^"]+)"/) || [])[1] || null, role: ROLE[(m.match(/member-role-left"><img alt="([^"]+)"/) || [])[1]] || null, sub })).filter((x) => x.player);
    out[team] = [...members(main, false), ...members(subs, true)];
    const staffPart = (card.split('data-toggle-area-content="3"')[1] || "").split('data-toggle-area-content="4"')[0];
    staffOf[team] = staffPart.split('class="team-participant-card__member"').slice(1).map((m) => ({ name: (m.match(/class="block-player"[\s\S]*?<a [^>]*title="([^"]+)"[^>]*>([^<]+)<\/a>/) || [])[2]?.trim() || null, page: (m.match(/class="block-player"[\s\S]*?<a [^>]*title="([^"]+)"/) || [])[1]?.replace(/ \(page does not exist\)$/, "") || null, role: (m.match(/member-role-right">([^<]+)</) || [])[1]?.trim() || "Staff" })).filter((x) => x.name);
  }
  return out;
}
const seasonPages = [...new Set(EVENTS.map((e) => e.page.split("/").slice(0, -1).join("/")))];
const srev = {}; for (let i = 0; i < seasonPages.length; i += 40) { const j = await api({ action: "query", prop: "revisions", rvprop: "ids", titles: seasonPages.slice(i, i + 40).join("|") }); for (const pg of Object.values(j?.query?.pages || {})) if (pg.revisions) srev[pg.title] = pg.revisions[0].revid; } /* batches of 40: the API caps titles per request */
let lastParse = 0, rosterPages = 0;
const MAX_ROSTER = +(process.env.MLBB_ROSTER_MAX || 8); // each page render waits 30 s (Liquipedia limit); spread a full refresh over runs
for (const sp of seasonPages) {
  const f = path.join(RD, `${safe(sp)}.json`), old = readJSON(f);
  if (!srev[sp] || (old && old.staff && old.revid === srev[sp] && Date.now() - Date.parse(old.fetched) < 7 * 86400000)) continue;
  if (rosterPages >= MAX_ROSTER) { console.log(`rosters: ${sp} left for a later run`); continue; }
  const wait = lastParse + 31000 - Date.now(); if (wait > 0) await sleep(wait); lastParse = Date.now();
  const j = await api({ action: "parse", page: sp, prop: "text" }); const html = j?.parse?.text?.["*"]; if (!html) continue;
  for (const k of Object.keys(staffOf)) delete staffOf[k]; const teamsR = parseCards(html); writeJSON(f, { page: sp, revid: srev[sp], fetched: new Date().toISOString(), teams: teamsR, staff: { ...staffOf } }); rosterPages++;
  console.log(`rosters ${sp}: ${Object.keys(teamsR).length} teams`);
}
console.log(`MLBB: ${rosterPages} season roster pages updated`);
// 3) team pages (kept for links; their squads are generated from transfers, so the season pages above are the roster source)
const teams = new Set(); for (const f of fs.readdirSync(PD)) for (const m of readJSON(path.join(PD, f)).matches) if (!m.date || Date.parse(m.date) > Date.now() - 400 * 86400000) { teams.add(m.a); teams.add(m.b); }
const tl = [...teams], trev = {};
for (let i = 0; i < tl.length; i += 40) { const j = await api({ action: "query", prop: "revisions", rvprop: "ids", titles: tl.slice(i, i + 40).join("|"), redirects: "1" }); const red = Object.fromEntries((j?.query?.redirects || []).map((r) => [r.to, r.from])); for (const pg of Object.values(j?.query?.pages || {})) if (pg.revisions) trev[red[pg.title] || pg.title] = { revid: pg.revisions[0].revid, title: pg.title }; }
let tf = 0;
for (const t of tl) {
  const f = path.join(TD, `${safe(t)}.json`), old = readJSON(f), r = trev[t]; if (!r || (old && old.revid === r.revid)) continue;
  const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: r.title });
  const text = Object.values(j?.query?.pages || {})[0]?.revisions?.[0]?.slots?.main?.["*"]; if (!text) continue;
  writeJSON(f, { team: t, page: r.title, revid: r.revid, fetched: new Date().toISOString(), squad: parseSquad(text) }); tf++;
}
console.log(`MLBB: ${tf} team rosters updated (${tl.length} teams)`);
// Heroes and patches from Liquipedia: hero role, lane, specialties, base toughness and ability text (crowd control is
// counted from what the skills do); patch release dates and which heroes each patch buffed, nerfed or reworked.
// Batched: up to 50 pages per request. Refetched weekly.
{
  const HF = path.join(MD, "heroes-lp.json"), old = readJSON(HF);
  if (!old || Date.now() - Date.parse(old.fetched) > 7 * 86400000) {
    const cm = []; let cont = null;
    for (let i = 0; i < 6; i++) { const j = await api({ action: "query", list: "categorymembers", cmtitle: "Category:Hero", cmlimit: "500", ...(cont ? { cmcontinue: cont } : {}) }); cm.push(...(j?.query?.categorymembers || []).filter((x) => x.ns === 0).map((x) => x.title)); cont = j?.continue?.cmcontinue; if (!cont) break; }
    const CC = { stun: /\bstun/gi, airborne: /airborne|knock(?:s|ed|ing)? (?:them |enemies |targets )?(?:up|airborne)/gi, knockback: /knock(?:s|ed|ing)? (?:them |enemies |targets )?back|knockback/gi, suppress: /suppress/gi, immobilize: /immobiliz|root(?:s|ed)?\b|bind/gi, taunt: /taunt/gi, freeze: /freez/gi, petrify: /petrif/gi, silence: /silenc/gi, slow: /\bslow/gi, pull: /\bpull(?:s|ed|ing)?\b/gi, charm: /charm/gi };
    const heroes = {};
    for (let i = 0; i < cm.length; i += 50) {
      const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: cm.slice(i, i + 50).join("|") });
      for (const pg of Object.values(j?.query?.pages || {})) {
        const t = pg.revisions?.[0]?.slots?.main?.["*"]; if (!t || !/\{\{Infobox hero/i.test(t)) continue;
        const ib = params(blocks(t, "Infobox hero")[0] || ""), ab = blocks(t, "AbilityCard").map((b) => params(b).desc || "").join(" ").replace(/\{\{[^{}]*\|([^{}|]*)\}\}/g, "$1");
        const cc = Object.fromEntries(Object.entries(CC).map(([k, re]) => [k, (ab.match(re) || []).length]));
        heroes[pg.title.toLowerCase()] = { name: pg.title, lane: ib.lane || null, role: ib.primaryrole || null, role2: ib.secondaryrole || null, spec: [ib.specialty1, ib.specialty2, ib.specialty3].filter(Boolean), hp: +ib.hp || null, def: +ib.phydef || null, mdef: +ib.magdef || null, released: ib.releasedate || null, cc };
      }
    }
    // patches since 2025: release date and hero adjustments
    const pp = []; cont = null;
    for (const pre of ["Patch 1.9.", "Patch 2."]) { const j = await api({ action: "query", list: "allpages", apprefix: pre, aplimit: "500" }); pp.push(...(j?.query?.allpages || []).map((x) => x.title)); }
    const patches = [];
    for (let i = 0; i < pp.length; i += 50) {
      const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: pp.slice(i, i + 50).join("|") });
      for (const pg of Object.values(j?.query?.pages || {})) {
        const t = pg.revisions?.[0]?.slots?.main?.["*"]; if (!t) continue; const ib = params(blocks(t, "Infobox patch")[0] || ""); if (!ib.release || ib.release < "2025-01-01") continue;
        const changes = [...t.matchAll(/\{\{Herobc\/[^|]*\|[\s\S]*?\|\s*hero\s*=\s*([^|\n]+)[\s\S]*?\|\s*type\s*=\s*([^|\n]+)/g)].map((m) => ({ hero: m[1].trim().toLowerCase(), type: m[2].trim() }));
        patches.push({ patch: pg.title.replace("Patch ", ""), release: ib.release, changes });
      }
    }
    patches.sort((a, b) => a.release.localeCompare(b.release));
    writeJSON(HF, { fetched: new Date().toISOString(), heroes, patches });
    console.log(`heroes ${Object.keys(heroes).length}, patches since 2025: ${patches.length} (latest ${patches.at(-1)?.patch} ${patches.at(-1)?.release}, ${patches.at(-1)?.changes.length} hero changes)`);
  }
}
// M8 qualification: who is seeded into the main stage and who plays the Wildcard (empty slots = still to be decided)
{
  const j = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: "M8 World Championship/Qualification" });
  const text = Object.values(j?.query?.pages || {})[0]?.revisions?.[0]?.slots?.main?.["*"];
  if (text) {
    const table = text.split("==Qualification Timeline==")[0], out = { main: [], wildcard: [] }; let sect = null;
    for (const row of table.split(/\n\|-/)) {
      if (/Seeded into Main Stage/i.test(row)) sect = "main"; else if (/Seeded into Wild ?Card/i.test(row)) sect = "wildcard";
      if (!sect) continue;
      const via = (row.match(/\[\[[^|\]]+\|([^\]]+)\]\]/) || [])[1]; if (!via) continue;
      const teams = [...row.matchAll(/\{\{Team\|([^}]*)\}\}/gi)].map((m) => m[1].trim());
      const seeds = +(row.match(/align="center"\s*\|\s*(\d+)\s*$/m) || [])[1] || teams.length;
      for (let i = 0; i < Math.max(seeds, teams.length); i++) out[sect].push({ team: teams[i] || null, via });
    }
    writeJSON(path.join(MD, "m8.json"), { fetched: new Date().toISOString(), ...out, wildcardFormat: "10 teams in two groups of five (best-of-one round robin) in Bangkok from December 17, 2026; three advance to the 16-team main stage in Türkiye (January 2027): the two group winners and a third team from the runners-up (Moonton, M8 slot allocation)." });
    console.log(`M8 qualification: main ${out.main.filter((x) => x.team).length}/${out.main.length} set, wildcard ${out.wildcard.filter((x) => x.team).length}/${out.wildcard.length} set`);
  }
}
// 4) official league statistics (MPL PH "Data" tab, MPL ID "Statistics" tab): server-rendered tables for teams
// (kills, gold, damage, Lord / Turtle / towers), players (kills, deaths, assists, KDA, kill participation) and
// heroes (pick / ban / win). The Malaysia site has no statistics tab and does not answer scripts.
function tables(html) {
  const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => {
    const t = m[0], head = [...(t.match(/<thead[\s\S]*?<\/thead>/)?.[0] || t.match(/<tr[\s\S]*?<\/tr>/)?.[0] || "").matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((x) => clean(x[1]));
    const body = t.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] || t;
    const rows = [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => [...r[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => clean(x[1]))).filter((r) => r.length >= 3);
    return { head, rows };
  }).filter((t) => t.rows.length);
}
for (const [league, url] of [["MPL PH", "https://ph-mpl.com/data"], ["MPL ID", "https://id-mpl.com/en/statistics"]]) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (oddssmash analyzer)" } }); if (!r.ok) continue;
    const html = await r.text(), T = tables(html), num = (s) => +String(s || "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "") || 0;
    const find = (re) => T.find((t) => re.test(t.head.join(" ")));
    const tp = find(/kda/i), th = find(/pick/i), tt = find(/gold/i);
    const seasons = [...html.matchAll(/season\s*(\d{2})/gi)].map((m) => +m[1]), season = seasons.length ? String(Math.max(...seasons)) : null;
    // hero pools (MPL ID): each hero with every player's games and win rate on it -> per-player pools
    const pools = {}; for (const row of html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?player-pool-info[\s\S]*?<\/tr>/g) || []) { const hero = (row.match(/class="hero-name[^"]*">\s*<b>\s*([^<]+?)\s*<\/b>/) || [])[1]; if (!hero) continue;
      for (const c of row.matchAll(/player-pool-info">\s*([^<]+?)\s*<\/div>\s*<div class="player-pool-pick[^"]*">\s*(\d+)\s*<\/div>\s*<div class="player-pool-count">\s*(\d+)%/g)) { const name = c[1].split(" - ").slice(1).join(" - ").trim() || c[1].trim(); (pools[name] ||= []).push({ h: hero.toLowerCase(), n: +c[2], wr: +c[3] / 100 }); } }
    for (const k of Object.keys(pools)) pools[k].sort((a, b) => b.n - a.n);
    const hi = (t, re) => t.head.findIndex((h) => re.test(h));
    const players = tp ? tp.rows.map((c) => ({ player: c[0], team: c[1], kills: num(c[hi(tp, /avg kills/i)]), deaths: num(c[hi(tp, /avg deaths/i)]), assists: num(c[hi(tp, /avg assists/i)]), kda: num(c[hi(tp, /kda/i)]), kp: num(c[hi(tp, /participation|kp/i)]) })).filter((p) => p.kda || p.kills) : [];
    const heroes = th ? th.rows.map((c) => ({ hero: c[0].toLowerCase(), pick: num(c[1]), ban: num(c[hi(th, /^ban$/i)] ?? c[3]), win: num(c[hi(th, /^win$/i)] ?? c[5]) })).filter((h) => h.pick || h.ban) : [];
    const teams = tt ? tt.rows.map((c) => ({ team: c[0], kills: num(c[1]), deaths: num(c[2]), assists: num(c[3]), gold: num(c[4]), damage: num(c[5]), lord: num(c[6]), turtle: num(c[7]), towers: num(c[8]) })) : [];
    writeJSON(path.join(MD, `official-${league.replace(/\W+/g, "")}.json`), { league, url, season, fetched: new Date().toISOString(), teams, players, heroes, pools });
    console.log(`official ${league} S${season}: ${teams.length} teams, ${players.length} players, ${heroes.length} heroes, ${Object.keys(pools).length} player pools`);
  } catch (e) { console.log(`official ${league} failed: ${e.message}`); }
}
// 5) ranked-game hero stats (meta reference; not pro play)
// MLBBHub is no longer read: its robots.txt disallows /api/ and its terms forbid automated extraction without written
// permission. Ranked hero rates now come from mlbb.io (scripts/mlbb/ranked.mjs).
if (false) try { const r = await fetch("https://mlbbhub.com/api/stats", { headers: UA }); if (r.ok) { const j = await r.json(); writeJSON(path.join(MD, "heroes-ranked.json"), { fetched: new Date().toISOString(), source: "MLBBHub public stats (ranked games)", heroes: j.heroes || [] }); console.log(`ranked hero stats: ${(j.heroes || []).length}`); } } catch { /* optional */ }
