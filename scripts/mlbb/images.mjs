// MLBB pictures: hero portraits, team logos (light and dark versions) and pro player photos from Liquipedia.
// The image name comes from each page's infobox; the thumbnail URL from Liquipedia commons. Thumbnails are
// downloaded once and served from our own site (data/mlbb/img, copied to /mlbb/img), so readers do not load
// Liquipedia's servers. Credit: Liquipedia (images are their uploaders' / rights holders'). Rechecked every 30 days.
// Runs after model.mjs (it needs the team and player lists). Writes data/mlbb/images.json and public-mlbb/data/images.json.
import path from "node:path";
import fs from "node:fs";
import { DATA, ROOT, readJSON, writeJSON } from "../lib/util.mjs";

const MD = path.join(DATA, "mlbb"), IMG = path.join(MD, "img"), OUT = path.join(ROOT, "public-mlbb", "data");
const UA = { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/; non-commercial research)", "accept-encoding": "gzip" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function api(base, params) { const w = last + 2100 - Date.now(); if (w > 0) await sleep(w); last = Date.now(); try { const r = await fetch(`https://liquipedia.net/${base}/api.php?` + new URLSearchParams({ format: "json", ...params }), { headers: UA }); return r.ok ? r.json() : null; } catch { return null; } }
const safe = (t) => String(t).replace(/[^A-Za-z0-9]+/g, "_");
const MAP = readJSON(path.join(MD, "images.json"), { heroes: {}, teams: {}, players: {}, checked: {} });
const fresh = (k) => MAP.checked[k] && Date.now() - Date.parse(MAP.checked[k]) < 30 * 86400000;

const heroes = Object.values(readJSON(path.join(MD, "heroes-lp.json"), { heroes: {} }).heroes).map((h) => ({ key: h.name.toLowerCase(), title: h.name }));
const teams = readJSON(path.join(OUT, "teams.json"), []).map((t) => ({ key: t.name, title: t.name }));
const players = readJSON(path.join(OUT, "players.json"), []).filter((p) => p.page && p.last && Date.parse(p.last) > Date.now() - 400 * 86400000).map((p) => ({ key: p.id, title: p.page }));

async function infoboxImages(list, kind) {
  const todo = list.filter((x) => !fresh(`${kind}:${x.key}`)), out = new Map();
  for (let i = 0; i < todo.length; i += 50) {
    const part = todo.slice(i, i + 50), j = await api("mobilelegends", { action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: part.map((x) => x.title).join("|") });
    const red = Object.fromEntries((j?.query?.redirects || []).map((r) => [r.to, r.from])), norm = Object.fromEntries((j?.query?.normalized || []).map((r) => [r.to, r.from]));
    for (const pg of Object.values(j?.query?.pages || {})) {
      const t = pg.revisions?.[0]?.slots?.main?.["*"] || "", orig = red[pg.title] || norm[red[pg.title]] || norm[pg.title] || pg.title, it = part.find((x) => x.title === orig || x.title === pg.title || x.title.replace(/_/g, " ") === orig); if (!it) continue;
      const im = (t.match(/\|\s*image\s*=\s*([^|\n}]+)/) || [])[1]?.trim(), dk = (t.match(/\|\s*imagedark\s*=\s*([^|\n}]+)/) || [])[1]?.trim();
      out.set(it.key, { light: im || null, dark: dk || null });
    }
    for (const x of part) MAP.checked[`${kind}:${x.key}`] = new Date().toISOString();
  }
  return out;
}
async function thumbs(files, width) {
  const res = new Map(), list = [...new Set(files.filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) { const j = await api("commons", { action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: String(width), titles: list.slice(i, i + 50).map((f) => `File:${f}`).join("|") });
    const norm = Object.fromEntries((j?.query?.normalized || []).map((r) => [r.to, r.from]));
    for (const pg of Object.values(j?.query?.pages || {})) { const u = pg.imageinfo?.[0]?.thumburl; if (u) res.set((norm[pg.title] || pg.title).replace(/^File:/, ""), u); } }
  return res;
}
async function download(url, rel) {
  const file = path.join(IMG, rel); if (fs.existsSync(file)) return rel; fs.mkdirSync(path.dirname(file), { recursive: true });
  await sleep(250); try { const r = await fetch(url, { headers: UA }); if (!r.ok) return null; fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return rel; } catch { return null; }
}
const ext = (f) => (/\.jpe?g$/i.test(f) ? ".jpg" : /\.webp$/i.test(f) ? ".webp" : ".png");
let got = 0;
for (const [kind, list, width] of [["heroes", heroes, 96], ["teams", teams, 96], ["players", players, 120]]) {
  const names = await infoboxImages(list, kind), urls = await thumbs([...names.values()].flatMap((v) => [v.light, v.dark]), width);
  for (const [key, v] of names) {
    const one = async (f, tag) => (f && urls.get(f) ? download(urls.get(f), `${kind[0]}/x_${safe(key)}${tag}${ext(f)}`) /* x_ prefix: Windows refuses names like AUX or CON */ : null);
    const light = await one(v.light, ""), dark = await one(v.dark, "-dark");
    if (light || dark) { MAP[kind][key] = kind === "teams" ? { light: light || dark, dark: dark || light } : light || dark; got++; }
  }
  console.log(`MLBB images ${kind}: ${Object.keys(MAP[kind]).length} with pictures (${names.size} checked this run)`);
}
writeJSON(path.join(MD, "images.json"), MAP);
writeJSON(path.join(OUT, "images.json"), { heroes: MAP.heroes, teams: MAP.teams, players: MAP.players, credit: "Pictures: Liquipedia (liquipedia.net/mobilelegends); rights belong to their owners." });
