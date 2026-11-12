// Ranked (all players) counters, win rate, ban rate and tier from mlbb.io: each hero's public counter page names its five strongest counters with
// their win-rate edge and the heroes it does well into, from the past 7 days of ranked games on the current patch.
// This is a large-sample background layer only, shown labelled "ranked (all players)" and kept apart from the pro
// numbers. mlbb.io's robots.txt allows all pages. Polite: one page every 3 seconds, at most 40 heroes per run (the
// oldest first), each hero refreshed after 7 days. Writes data/mlbb/ranked-counters.json. Credit: mlbb.io.
import path from "node:path";
import { DATA, readJSON, writeJSON } from "../lib/util.mjs";

const FILE = path.join(DATA, "mlbb", "ranked-counters.json"), UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), DAY = 86400000, MAX = +(process.env.RANKED_MAX || 40);
const store = readJSON(FILE, { source: "mlbb.io (ranked, all players, past 7 days)", heroes: {} });
const get = async (u) => { try { const r = await fetch(u, { headers: UA }); return r.ok ? await r.text() : null; } catch { return null; } };
const map = await get("https://mlbb.io/sitemap-0.xml");
const slugs = [...new Set([...(map || "").matchAll(/<loc>https:\/\/mlbb\.io\/en\/hero\/([a-z0-9-]+)\/counter<\/loc>/g)].map((m) => m[1]))];
const todo = slugs.filter((s) => !store.heroes[s] || store.heroes[s].wr == null || Date.now() - Date.parse(store.heroes[s].fetched) > 7 * DAY).sort((a, b) => (store.heroes[a]?.fetched || "").localeCompare(store.heroes[b]?.fetched || "")).slice(0, MAX);
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
let n = 0;
for (const slug of todo) {
  if (n) await sleep(3000);
  const html = await get(`https://mlbb.io/en/hero/${slug}/counter`); n++; if (!html) continue;
  const t = text(html), name = (t.match(/How to Counter (.+?) in MLBB/) || [])[1]?.trim() || slug;
  const part = (t.split(/Which heroes counter [^?]+\?/)[1] || "").split(/Best Counters to/)[0];
  const by = [...part.matchAll(/\d+ ([A-Z][A-Za-z.'& -]+?) — [^+−-]*?([+−-]\d+(?:\.\d+)?)% win rate advantage/g)].map((m) => ({ h: m[1].trim().toLowerCase(), adv: +m[2].replace("−", "-") })).slice(0, 5);
  const into = ((html.match(/performs well into ([^.]+)\./) || [])[1] || "").split(/,\s*|\s+and\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 5);
  const rate = t.match(/currently has a ([\d.]+)% ban rate and a ([\d.]+)% win rate at ([A-Z+]+) tier/) || html.match(/currently has a ([\d.]+)% ban rate and a ([\d.]+)% win rate at ([A-Z+]+) tier/);
  if (by.length || into.length || rate) store.heroes[slug] = { name: name.toLowerCase(), by, into, ban: rate ? +rate[1] : null, wr: rate ? +rate[2] : null, tier: rate ? rate[3] : null, fetched: new Date().toISOString() };
}
store.updated = new Date().toISOString();
writeJSON(FILE, store);
console.log(`ranked counters (mlbb.io): ${n} pages read, ${Object.keys(store.heroes).length}/${slugs.length} heroes on file`);
