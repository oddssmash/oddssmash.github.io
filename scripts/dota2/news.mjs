// Dota 2 news and talk: headlines about the teams in upcoming Dota 2 matches and the pro scene.
// Sources that can be read without logging in, each within its own terms:
//  - Google News search feeds (pro-scene searches plus one per team playing in the next 7 days)
//  - Reddit feeds (r/DotA2 and r/CompetitiveDota2: community talk, roster threads, match threads)
//  - YouTube channel feeds (Dota 2 official, PGL, BLAST and the tournament channels below)
//  - Steam news for Dota 2 (Valve's own posts and press coverage Steam lists)
// Facebook, Instagram and X need a login and are not read. Headlines never move a projection; they are shown so roster
// news (stand-ins, transfers, visa issues) is visible next to the numbers. Runs after model.mjs.
// Writes public-dota2/data/news.json and keeps a 21-day cache in data/dota2/news.json.
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON, pool } from "../lib/util.mjs";

const OUT = path.join(ROOT, "public-dota2", "data"), CACHE = path.join(DATA, "dota2", "news.json"), DAY = 86400000;
const up = readJSON(path.join(OUT, "upcoming.json"), []), teams = readJSON(path.join(OUT, "teams.json"), []);
const UA = { "user-agent": "Mozilla/5.0 (oddssmash analyzer; https://oddssmash.github.io/)" };
async function grab(url) { try { const r = await fetch(url, { headers: UA }); return r.ok ? await r.text() : ""; } catch { return ""; } }
const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;|&#8217;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, "-").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
function items(xml, outlet, kind) {
  const out = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/g)) {
    const b = m[0], tag = (n) => { const r = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)); return r ? dec(r[1]) : ""; };
    let title = tag("title"), src = tag("source") || outlet; const link = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || tag("link");
    if (kind === "news") { const k = title.lastIndexOf(" - "); if (k > 20) { src = title.slice(k + 3); title = title.slice(0, k); } }
    const d = new Date(tag("pubDate") || tag("published") || tag("updated") || Date.now());
    if (title) out.push({ title, url: link, outlet: src, kind, date: (isNaN(d) ? new Date() : d).toISOString() });
  }
  return out;
}
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const feeds = [
  { url: gnews("Dota 2 esports"), outlet: "Google News", kind: "news" },
  { url: gnews("Dota 2 roster stand-in"), outlet: "Google News", kind: "news" },
  { url: gnews("Dota 2 tournament BLAST OR DreamLeague OR PGL OR ESL"), outlet: "Google News", kind: "news" },
  { url: "https://www.reddit.com/r/DotA2/search.rss?q=esports%20OR%20roster%20OR%20tournament&restrict_sr=1&sort=new", outlet: "Reddit r/DotA2", kind: "community" },
  { url: "https://www.reddit.com/r/CompetitiveDota2/new/.rss", outlet: "Reddit r/CompetitiveDota2", kind: "community" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCTQKT5QqO3h7y32G8VzuySQ", outlet: "Dota 2 (YouTube)", kind: "video" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC7VWLs_Ivccq22rM2_xo0Rg", outlet: "PGL Dota 2 (YouTube)", kind: "video" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCAvIC2XmBLLXFPdveirTrmw", outlet: "BLAST Dota (YouTube)", kind: "video" },
];
// more YouTube channels, ids read from their channel pages (skipped quietly when a page does not answer)
for (const [h, name] of [["ESLDota2", "ESL Dota 2"], ["dreamhackdota2", "DreamLeague"], ["EPICENTERDota2", "EPICENTER"], ["BTSDota", "BTS Dota"], ["TeamSpirit", "Team Spirit"], ["TeamLiquid", "Team Liquid"]]) {
  const page = await grab(`https://www.youtube.com/@${h}?hl=en`), id = (page.match(/channel_id=(UC[\w-]{22})/) || page.match(/"externalId":"(UC[\w-]{22})"/) || [])[1];
  if (id && !feeds.some((f) => f.url.includes(id))) feeds.push({ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, outlet: `${name} (YouTube)`, kind: "video", dota: !/Dota|DreamLeague|EPICENTER|BTS/.test(name) });
}
// one Google News search per team playing in the next 7 days
const soon = up.filter((m) => Date.parse(m.date) < Date.now() + 7 * DAY), tq = new Map();
for (const m of soon) for (const t of [m.a, m.b]) if (!tq.has(t.name)) tq.set(t.name, t);
for (const t of tq.values()) feeds.push({ url: gnews(`"${t.name}" Dota 2`), outlet: "Google News", kind: "news", team: t.name });

const got = [];
await pool(feeds, 4, async (f) => { const xml = await grab(f.url); let it = items(xml, f.outlet, f.kind); if (f.dota) it = it.filter((x) => /dota/i.test(x.title)); got.push(...it.map((x) => ({ ...x, q: f.team || null }))); });
// Steam news for Dota 2 (Valve posts and press coverage listed on Steam)
try { const j = JSON.parse(await grab("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=570&count=30&maxlength=1"));
  for (const n of j?.appnews?.newsitems || []) got.push({ title: n.title, url: n.url, outlet: n.feedlabel === "Community Announcements" ? "Valve (Steam)" : n.feedlabel || "Steam news", kind: n.feedlabel === "Community Announcements" ? "official" : "news", date: new Date(n.date * 1000).toISOString(), q: null }); } catch { /* optional */ }
console.log(`Dota 2 news: ${got.length} items from ${feeds.length + 1} feeds`);

const roster = /roster|stand-?in|substitute|transfer|joins?|leaves?|depart|parts? ways|benched|inactive|visa|sign(s|ed)|new (carry|mid|offlane|support|captain|coach)/i;
const PROMO = /live stream|livestream|watch live|giveaway|drops|bbet(s|ting)?b|odds|tips?b|prediction market|parlay|wager/i;
const BETTING_OUTLET = /robinhood|coinbase|kalshi|polymarket|freetips|prediction|bet|odds|tips|sportsbook|casino/i;
const names = [...new Set([...tq.keys(), ...teams.slice(0, 60).map((t) => t.name)])].filter((n) => n.length >= 3);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tagT = names.map((n) => ({ n, re: new RegExp(`(^|[^A-Za-z0-9])${esc(n)}([^A-Za-z0-9]|$)`, "i") }));
const old = readJSON(CACHE, []), seen = new Set(), all = [];
for (const x of [...got, ...old]) {
  if (!x.title || PROMO.test(x.title) || BETTING_OUTLET.test(x.outlet || "") || Date.parse(x.date) < Date.now() - 21 * DAY) continue;
  const key = x.title.toLowerCase().replace(/\W+/g, " ").slice(0, 90); if (seen.has(key)) continue; seen.add(key);
  const tt = new Set(tagT.filter((t) => t.re.test(x.title)).map((t) => t.n)); if (x.q) tt.add(x.q);
  if (x.kind === "news" && !tt.size && !/dota/i.test(x.title)) continue; // general searches can wander off topic
  all.push({ title: x.title, url: x.url, outlet: x.outlet, kind: x.kind, date: x.date, teams: [...tt], roster: roster.test(x.title) });
}
all.sort((a, b) => b.date.localeCompare(a.date));
writeJSON(CACHE, all.slice(0, 1500));
writeJSON(`${OUT}/news.json`, { fetched: new Date().toISOString(), note: "Headlines from Google News searches, Reddit (r/DotA2, r/CompetitiveDota2), YouTube channels (Dota 2, PGL, BLAST and tournament and team channels) and Steam news, tagged to the teams in upcoming matches. Facebook, Instagram and X need a login and are not read. Headlines never change a projection.", items: all.slice(0, 500) });
console.log(`Dota 2 news: kept ${all.length} (${all.filter((x) => x.roster).length} roster-related, ${all.filter((x) => x.teams.length).length} tagged to a team)`);
