// Dota 2 lineups from Liquipedia (liquipedia.net/dota2, CC-BY-SA 3.0), for every team on the schedule.
//  1) Tournament pages of the scheduled matches: the "Participants" list gives each team's five with positions (role=1-5),
//     subs (status=sub) and, for most players, the Dota account id, which links them to OpenDota. This also covers teams
//     that have no Liquipedia page of their own. Refreshed every 6 hours.
//  2) Team pages (when the team has one): active squad with positions and join dates, captain, coach and staff, inactive
//     players and stand-ins listed in the active squad. Refreshed every 24 hours.
// Liquipedia API terms: wiki text through action=query (not action=parse), up to 50 pages per request, one request every
// 2+ seconds, gzip, and a user agent that says who we are. Writes data/dota2/rosters.json.
import path from "node:path";
import { DATA, readJSON, writeJSON } from "../lib/util.mjs";

const D = path.join(DATA, "dota2"), OUT = path.join(D, "rosters.json"), H = 3600000, now = Date.now();
const UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)", "accept-encoding": "gzip" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function wikitext(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const wait = last + 2500 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
    const q = new URLSearchParams({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", format: "json", redirects: "1", titles: titles.slice(i, i + 50).join("|") });
    try { const r = await fetch("https://liquipedia.net/dota2/api.php?" + q, { headers: UA }); if (!r.ok) { console.log("Liquipedia HTTP", r.status); continue; }
      const j = await r.json(), back = {}; for (const x of [...(j.query?.normalized || []), ...(j.query?.redirects || [])]) back[x.to] = back[x.from] || x.from;
      for (const p of Object.values(j.query?.pages || {})) { const w = p.revisions?.[0]?.slots?.main?.["*"]; const key = back[p.title] || p.title; out[key] = w || null; out[p.title] = w || null; }
    } catch (e) { console.log("Liquipedia fetch failed:", e.message); }
  }
  return out;
}
const clean = (s) => String(s || "").replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").trim();
// template parameters of one {{Person|...}}: named ones, plus the first unnamed one (the player id in tournament lists)
function params(t) { const o = {}; let depth = 0, cur = "", parts = []; for (let i = 0; i < t.length; i++) { const c = t[i], n = t[i + 1];
    if ((c === "{" && n === "{") || (c === "[" && n === "[")) { depth++; cur += c + n; i++; continue; } if ((c === "}" && n === "}") || (c === "]" && n === "]")) { depth--; cur += c + n; i++; continue; }
    if (c === "|" && depth === 0) { parts.push(cur); cur = ""; continue; } cur += c; } parts.push(cur);
  for (const p of parts.slice(1)) { const k = p.indexOf("="); if (k > 0 && /^[a-z_ ]+$/i.test(p.slice(0, k).trim())) o[p.slice(0, k).trim().toLowerCase()] = clean(p.slice(k + 1)); else if (o._ == null && p.trim()) o._ = clean(p); }
  return o; }
// every top-level {{Name ...}} block starting at the given index list
function blocks(w, name) { const out = [], re = new RegExp(`\\{\\{${name}\\s*\\|`, "gi"); let m; while ((m = re.exec(w))) { let d = 0, j = m.index; for (; j < w.length - 1; j++) { if (w[j] === "{" && w[j + 1] === "{") { d++; j++; } else if (w[j] === "}" && w[j + 1] === "}") { d--; j++; if (d === 0) break; } } out.push(w.slice(m.index + 2, j - 1)); re.lastIndex = j; } return out; }
const pos = (x) => { const n = parseInt(x, 10); return n >= 1 && n <= 5 ? n : null; };
const noComments = (w) => w.replace(/<!--[\s\S]*?-->/g, "");
function parseTour(w0) { const teams = {}, w = noComments(w0);
  for (const op of blocks(w, "Opponent")) { const name = clean(op.slice(op.indexOf("|") + 1).split(/\n|\|/)[0]); if (!name) continue; const pl = blocks(op, "Persons")[0]; if (!pl) continue;
    const all = blocks(pl, "Person").map((p) => { const o = params(p); return { name: o._ || o.id || null, acc: /^\d{3,}$/.test(o.id || "") ? +o.id : null, pos: pos(o.role), role: o.role || "", flag: o.flag || null, sub: o.status === "sub" || o.results === "false" }; }).filter((x) => x.name);
    // players have a position (role=1-5); a coach is listed with role=coach; anyone else without a position is left out
    const players = all.filter((x) => x.pos).map(({ role, ...x }) => x), coach = all.filter((x) => !x.pos && /coach/i.test(x.role)).map((x) => ({ name: x.name, role: "Coach" }));
    if (players.length) teams[name] = { players, coach }; }
  return teams; }
function parseTeam(w0) { const out = { players: [], coach: [], inactive: [], standins: [] }, w = noComments(w0);
  // squads: active (players, and staff with type=staff), inactive; former squads and tournament squads (a title, no status) are skipped
  for (const sq of blocks(w, "Squad")) { const head = sq.split("\n")[0], status = /status=(\w+)/.exec(head)?.[1] || (/title=/.test(head) ? "former" : "active"); if (status === "former") continue;
    for (const p of blocks(sq, "Person")) { const o = params(p), name = o.id || o._; if (!name) continue; const role = o.role || "", join = (o.joindate || "").slice(0, 10) || null;
      const x = { name, pos: pos(o.position), flag: o.flag || null, join, captain: o.captain === "yes" || undefined };
      if (status === "inactive") { if (x.pos) out.inactive.push({ ...x, since: (o.inactivedate || "").slice(0, 10) || null }); }
      else if (/coach|analyst|manager/i.test(role) || /staff/i.test(head)) out.coach.push({ name, role: role || "Coach" });
      else if (/stand-?in|loan/i.test(role)) out.standins.push({ ...x, role });
      else if (x.pos) out.players.push(x); } }
  return out; }

const UP = readJSON(path.join(D, "upcoming.json"), { matches: [] }).matches.filter((m) => Date.parse(m.date) > now - 12 * H);
const store = readJSON(OUT, { tours: {}, teams: {} });
const tours = [...new Set(UP.map((m) => m.tpage).filter(Boolean))], teamPages = [...new Set(UP.flatMap((m) => [m.a.page, m.b.page]).filter((p) => p && !/redlink|index\.php/.test(p)))];
const dueT = tours.filter((p) => !store.tours[p] || now - Date.parse(store.tours[p].fetched) > 6 * H), dueP = teamPages.filter((p) => !store.teams[p] || now - Date.parse(store.teams[p].fetched) > 24 * H);
if (dueT.length) { const w = await wikitext(dueT); for (const p of dueT) { const t = w[p] ?? w[p.replace(/_/g, " ")]; if (t != null || !store.tours[p]) store.tours[p] = { fetched: new Date().toISOString(), teams: t ? parseTour(t) : {} }; } }
if (dueP.length) { const w = await wikitext(dueP); for (const p of dueP) { const t = w[p] ?? w[p.replace(/_/g, " ")]; if (t != null || !store.teams[p]) store.teams[p] = { fetched: new Date().toISOString(), ...(t ? parseTeam(t) : { players: [], coach: [], inactive: [], standins: [], missing: true }) }; } }
// drop pages no longer on the schedule after a week
for (const k of ["tours", "teams"]) for (const [p, v] of Object.entries(store[k])) if (now - Date.parse(v.fetched) > 7 * 24 * H) delete store[k][p];
store.source = "Liquipedia Dota 2 (liquipedia.net/dota2), CC-BY-SA 3.0: tournament participant lists and team pages";
writeJSON(OUT, store);
const nT = Object.values(store.tours).reduce((a, t) => a + Object.keys(t.teams).length, 0);
console.log(`rosters (Liquipedia): ${tours.length} tournaments (${dueT.length} fetched, ${nT} team lists), ${teamPages.length} team pages (${dueP.length} fetched)`);
