// MLBB team names: match pages often name a team by its short template ("bac", "kog", "Onic PH"), which split one
// team into several. Liquipedia's {{TeamName|...}} template turns any of these into the team's full name. One API
// call expands up to 40 names; results are cached in data/mlbb/team-names.json, so later runs only ask about new names.
// Runs after fetch.mjs, before model.mjs.
import fs from "node:fs";
import path from "node:path";
import { DATA, readJSON, writeJSON } from "../lib/util.mjs";

const MD = path.join(DATA, "mlbb"), FILE = path.join(MD, "team-names.json");
const UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)", "accept-encoding": "gzip" };
const API = "https://liquipedia.net/mobilelegends/api.php", sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = readJSON(FILE, {});
const names = new Set();
for (const f of fs.readdirSync(path.join(MD, "pages"))) for (const m of readJSON(path.join(MD, "pages", f)).matches) for (const n of [m.a, m.b]) if (n && !/^(tbd|bye)$/i.test(n)) names.add(String(n).trim());
const todo = [...names].filter((n) => !(n.toLowerCase() in cache) && !/[{}|[\]]/.test(n));
const SEP = " @@ ";
let asked = 0;
for (let i = 0; i < todo.length; i += 40) {
  const chunk = todo.slice(i, i + 40), text = chunk.map((n) => `{{TeamName|${n}}}`).join(SEP);
  if (i) await sleep(2100);
  try {
    const r = await fetch(API + "?" + new URLSearchParams({ action: "expandtemplates", format: "json", prop: "wikitext", text }), { headers: UA });
    if (!r.ok) { console.log("team names: HTTP", r.status); break; }
    const out = (await r.json()).expandtemplates?.wikitext?.split(SEP) || [];
    if (out.length !== chunk.length) { console.log("team names: unexpected reply length"); continue; }
    chunk.forEach((n, j) => { const full = out[j].replace(/<[^>]+>/g, "").trim(); cache[n.toLowerCase()] = full && !/[{}<]|error|does not exist/i.test(full) && full.length < 60 ? full : null; });
    asked += chunk.length;
  } catch (e) { console.log("team names:", e.message); break; }
}
writeJSON(FILE, cache);
// short names (the tag shown where a full name does not fit), cached in data/mlbb/team-short.json
const SFILE = path.join(MD, "team-short.json"), short = readJSON(SFILE, {}), want = [...new Set([...names].map((n) => cache[n.toLowerCase()] || n))].filter((n) => !(n in short) && !/[{}|[\]]/.test(n));
for (let i = 0; i < want.length; i += 40) { const chunk = want.slice(i, i + 40); await sleep(2100);
  try { const r = await fetch(API + "?" + new URLSearchParams({ action: "expandtemplates", format: "json", prop: "wikitext", text: chunk.map((n) => `{{TeamShort|${n}}}`).join(SEP) }), { headers: UA }); if (!r.ok) break;
    const out = (await r.json()).expandtemplates?.wikitext?.split(SEP) || []; if (out.length !== chunk.length) continue;
    chunk.forEach((n, j) => { const t = out[j].replace(/\[\[File:[^\]]*\]\]/g, "").replace(/<[^>]+>/g, " "), m = /\[\[[^\]|]*\|([^\]]+)\]\]/.exec(t) || /^\s*([^{[]{1,14}?)\s*$/.exec(t); short[n] = m ? m[1].trim() : null; }); } catch { break; } }
writeJSON(SFILE, short);
console.log(`team short names: ${Object.values(short).filter(Boolean).length} on file`);
const changed = Object.entries(cache).filter(([k, v]) => v && v.toLowerCase() !== k);
console.log(`team names: ${names.size} seen, ${asked} looked up now, ${changed.length} short names mapped to a full name`);
