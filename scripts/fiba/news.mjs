// FIBA news and talk: headlines about the teams and players in upcoming FIBA games.
// Sources that can be read without logging in: Google News search feeds (one per team in the next 10 days, plus
// competition-wide searches), Reddit search feeds and FIBA's YouTube channel. Facebook, Instagram and X need a
// login and are not read; score sites such as AiScore do not allow automated reading.
// Headlines never move a projection; they are shown so roster news (call-ups, injuries, withdrawals) is visible.
// Runs after model.mjs (it tags items with the players in upcoming rosters). Writes public-fiba/data/news.json
// and keeps a 21-day cache in data/fiba/news.json.
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON, pool } from "../lib/util.mjs";

const OUT = process.env.FIBA_OUT ? path.resolve(process.env.FIBA_OUT) : path.join(ROOT, "public-fiba", "data");
const CACHE = path.join(DATA, "fiba", "news.json"), DAY = 86400000;
const up = readJSON(path.join(OUT, "upcoming.json"), []);
const soon = up.filter((g) => Date.parse(g.date) < Date.now() + 10 * DAY);
// what people call national teams in headlines
const ALIAS = { Philippines: ["Gilas Pilipinas", "Gilas"], Korea: ["South Korea", "Korea"], "Chinese Taipei": ["Chinese Taipei", "Taiwan"], USA: ["Team USA", "USA Basketball"], Iran: ["Iran"], "Islamic Republic of Iran": ["Iran"], Japan: ["Akatsuki Japan", "Japan"], Australia: ["Boomers", "Australia"], "New Zealand": ["Tall Blacks", "New Zealand"], China: ["China"], Lebanon: ["Lebanon"], Jordan: ["Jordan"], Serbia: ["Serbia"], Greece: ["Greece"] };
const names = (t, kind) => (kind === "nt" ? ALIAS[t.name] || [t.name] : [t.name]);
const UA = { "user-agent": "Mozilla/5.0 (oddssmash analyzer)" };
async function grab(url) { try { const r = await fetch(url, { headers: UA }); return r.ok ? await r.text() : ""; } catch { return ""; } }
const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;|&#8217;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, "-").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
function items(xml, outlet, kind) {
  const out = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/g)) {
    const b = m[0], tag = (n) => { const r = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)); return r ? dec(r[1]) : ""; };
    let title = tag("title"), src = tag("source") || outlet; const link = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || tag("link");
    if (kind === "news") { const k = title.lastIndexOf(" - "); if (k > 20) { src = title.slice(k + 3); title = title.slice(0, k); } } // Google News: "Headline - Outlet"
    const d = new Date(tag("pubDate") || tag("published") || tag("updated") || Date.now());
    if (title) out.push({ title, url: link, outlet: src, kind, date: (isNaN(d) ? new Date() : d).toISOString() });
  }
  return out;
}
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const feeds = [
  { url: gnews("FIBA Basketball World Cup 2027 qualifiers"), outlet: "Google News", kind: "news" },
  { url: gnews("FIBA Europe Cup basketball"), outlet: "Google News", kind: "news" },
  { url: gnews("Basketball Champions League Americas"), outlet: "Google News", kind: "news" },
  { url: gnews("Liga Sudamericana baloncesto"), outlet: "Google News", kind: "news" },
  { url: "https://www.reddit.com/search.rss?q=FIBA%20qualifiers&sort=new", outlet: "Reddit", kind: "community" },
  { url: "https://www.reddit.com/r/basketball/search.rss?q=FIBA&restrict_sr=1&sort=new", outlet: "Reddit r/basketball", kind: "community" },
  { url: "https://www.reddit.com/r/PBA/search.rss?q=Gilas&restrict_sr=1&sort=new", outlet: "Reddit r/PBA", kind: "community" },
];
// one Google News search per team playing in the next 10 days (national teams: "<name> basketball FIBA")
const teamQ = new Map();
for (const g of soon) for (const t of [g.a, g.b]) if (!teamQ.has(t.tid)) teamQ.set(t.tid, { t, kind: g.kind });
for (const { t, kind } of teamQ.values()) feeds.push({ url: gnews(kind === "nt" ? `"${names(t, kind)[0]}" basketball FIBA` : `"${t.name}" basketball`), outlet: "Google News", kind: "news", team: t.tid });
// FIBA's YouTube channel (the channel id is read from the channel page)
const yt = await grab("https://www.youtube.com/@FIBA"), ch = (yt.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
if (ch) feeds.push({ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, outlet: "FIBA (YouTube)", kind: "video" });

const got = [];
await pool(feeds, 4, async (f) => { const xml = await grab(f.url); const it = items(xml, f.outlet, f.kind); got.push(...it.map((x) => ({ ...x, q: f.team || null }))); });
console.log(`FIBA news: ${got.length} items from ${feeds.length} feeds`);

// tag teams and players; flag roster news
const roster = /roster|pool|line-?up|squad|named|call[- ]?up|injur|ruled out|out for|withdr|replace|natural[iy][sz]|debut|returns?|cut|final 12/i;
const PROMO = /highlights|recap|full game|live stream|livestream|watch live|top \d+ plays|condensed/i;
const tagT = [...teamQ.values()].map(({ t, kind }) => ({ tid: t.tid, re: new RegExp(`\\b(${names(t, kind).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i") }));
const players = new Map(); for (const g of soon) { const gm = readJSON(path.join(OUT, "games", `${g.id}.json`)); for (const p of gm?.players || []) if (p.n && p.n.split(" ").length >= 2) players.set(p.pid, p.n); }
const tagP = [...players].map(([pid, n]) => ({ pid, n, re: new RegExp(`\\b${n.split(" ").slice(-1)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), first: n.split(" ")[0].toLowerCase() }));
const old = readJSON(CACHE, []), seen = new Set(), all = [];
for (const x of [...got, ...old]) {
  if (!x.title || PROMO.test(x.title) || Date.parse(x.date) < Date.now() - 21 * DAY) continue;
  const key = x.title.toLowerCase().replace(/\W+/g, " ").slice(0, 90); if (seen.has(key)) continue; seen.add(key);
  const teams = new Set(tagT.filter((t) => t.re.test(x.title)).map((t) => t.tid)); if (x.q) teams.add(x.q);
  const pl = tagP.filter((p) => p.re.test(x.title) && (x.title.toLowerCase().includes(p.first) || teams.size)).map((p) => p.pid);
  all.push({ title: x.title, url: x.url, outlet: x.outlet, kind: x.kind, date: x.date, teams: [...teams], players: pl, roster: roster.test(x.title) });
}
all.sort((a, b) => b.date.localeCompare(a.date));
writeJSON(CACHE, all.slice(0, 1500));
writeJSON(path.join(OUT, "news.json"), { fetched: new Date().toISOString(), note: "Headlines from Google News searches, Reddit and FIBA's YouTube channel, tagged to the teams and players in upcoming games. Facebook, Instagram and X need a login and are not read. Headlines never change a projection.", items: all.slice(0, 600) });
console.log(`FIBA news: kept ${all.length} (${all.filter((x) => x.roster).length} roster-related)`);
