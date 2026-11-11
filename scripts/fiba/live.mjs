// FIBA live scores. FIBA's pages cannot be read from another website in the browser, so this runs on a schedule
// (every 10 minutes, .github/workflows/live.yml) while games are on, and writes live/fiba-live.json, which the site
// reads from the repository's live-data branch. Only events with a game starting between 3.5 hours ago and 15
// minutes from now are read (one page per event). No betting data.
import path from "node:path";
import fs from "node:fs";
import { DATA, ROOT, readJSON, writeJSON } from "../lib/util.mjs";

const ED = path.join(DATA, "fiba", "events"), OUT = path.join(ROOT, "live", "fiba-live.json"), now = Date.now();
const window = []; for (const f of fs.readdirSync(ED)) { const e = readJSON(path.join(ED, f)); for (const g of e.games) { const t = Date.parse(g.date); if (t > now - 3.5 * 3600000 && t < now + 15 * 60000) window.push({ ...g, slug: e.slug }); } }
if (!window.length) { console.log("FIBA live: no game in the window"); writeJSON(OUT, { fetched: new Date().toISOString(), games: [] }); process.exit(0); }
const flight = (html) => { let o = ""; for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) { try { o += JSON.parse('"' + m[1] + '"'); } catch {} } return o; };
function valueAfter(s, key, from = 0) { let k = from - 1, i, open, close; for (;;) { k = s.indexOf(`"${key}":`, k + 1); if (k < 0) return null; i = k + key.length + 3; open = s[i]; close = open === "[" ? "]" : open === "{" ? "}" : null; if (close) break; }
  let d = 0, str = false; for (let j = i; j < s.length; j++) { const c = s[j]; if (str) { if (c === "\\") j++; else if (c === '"') str = false; continue; } if (c === '"') str = true; else if (c === open) d++; else if (c === close && --d === 0) { try { return { v: JSON.parse(s.slice(i, j + 1)), end: j + 1 }; } catch { return null; } } } return null; }
const want = new Set(window.map((g) => g.id)), out = [];
for (const slug of [...new Set(window.map((g) => g.slug))]) {
  try {
    const r = await fetch(`https://www.fiba.basketball/en/events/${slug}/games`, { headers: { "user-agent": "Mozilla/5.0 (oddssmash analyzer)" } }); if (!r.ok) continue;
    const f = flight(await r.text()); let from = 0, best = null;
    for (let n = 0; n < 12; n++) { const x = valueAfter(f, "games", from); if (!x) break; from = x.end; if (Array.isArray(x.v) && x.v[0]?.gameId && (!best || x.v.length > best.length)) best = x.v; }
    for (const g of best || []) if (want.has(String(g.gameId))) out.push({ id: String(g.gameId), live: !!g.isLive, final: g.statusCode === "VALID" || g.currentPeriodStatus === "E" && /Q4|OT/.test(g.currentPeriod || "") && !g.isLive, period: g.currentPeriod || null, clock: g.chrono || null, a: g.teamAScore ?? 0, b: g.teamBScore ?? 0 });
  } catch (e) { console.log("live fetch failed", slug, e.message); }
}
writeJSON(OUT, { fetched: new Date().toISOString(), games: out });
console.log(`FIBA live: ${out.filter((g) => g.live).length} live, ${out.length} in the window`);
