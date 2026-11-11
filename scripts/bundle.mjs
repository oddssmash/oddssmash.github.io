// Builds ./dist: a copy of the site with the thousands of small data files packed
// into a few dozen bundles, for hosts that limit the number of files (for example a
// private Claude artifact). The normal site in ./public is not changed.
//
//   node scripts/bundle.mjs
//
// dist/data/bundles.json maps  <folder> -> <id> -> <bundle name>
// dist/data/bundles/<name>.json holds { <id>: <the original file's JSON>, ... }
// app.js reads the map when meta.json has "bundles": true.
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON, writeJSON } from "./lib/util.mjs";

const SRC = path.join(ROOT, "public");
const OUT = path.join(ROOT, "dist");
const MAX_BUNDLE_BYTES = 3_500_000; // keep each bundle quick to load on a phone
const BUNDLE_THRESHOLD = 40;        // folders with more files than this get packed

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data", "bundles"), { recursive: true });

// 1. static files
for (const f of fs.readdirSync(SRC)) {
  const p = path.join(SRC, f);
  if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(OUT, f));
}

// 1b. adapt the page for a sandboxed viewer: plain "#name-arg" addresses, no query
// strings on data requests, bundle-aware loading, page written without its outer shell.
{
  const must = (s, a, b) => { if (!s.includes(a)) throw new Error(`bundle: expected to find ${a.slice(0, 60)}`); return s.split(a).join(b); };
  let js = fs.readFileSync(path.join(SRC, "app.js"), "utf8");
  js = must(js, "?v=${encodeURIComponent(S.ver)}", "");
  js = must(js, "?t=${Date.now()}", "");
  js = must(js, "location.hash", "__hash()");
  js = must(js, "async function load(p) {", "async function load(p) {\n  const __b = await __bundled(p); if (__b !== undefined) return __b;");
  const shim = `// ---- added by scripts/bundle.mjs for the bundled build ----
const __hash = () => { const h = window.location["hash"]; return h.length < 2 || h.startsWith("#/") ? h : "#/" + h.slice(1).split("-").join("/"); };
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  window.location["hash"] = "#" + a.getAttribute("href").slice(2).split("/").join("-");
}, true);
let __map = null; const __packs = new Map();
async function __bundled(p) {
  const m = /^([a-z]+)\\/([A-Za-z0-9_]+)\\.json$/.exec(p);
  if (!m) return undefined;
  if (!__map) __map = fetch("data/bundles.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const name = (await __map)[m[1]]?.[m[2]];
  if (!name) return undefined;
  if (!__packs.has(name)) __packs.set(name, fetch("data/bundles/" + name + ".json").then((r) => { if (!r.ok) throw new Error(name + ": " + r.status); return r.json(); }));
  return (await __packs.get(name))[m[2]];
}
// ---- end of added code ----
`;
  fs.writeFileSync(path.join(OUT, "app.js"), shim + js);

  const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
    .replace("Player photos and team logos are loaded from ESPN's public image server.", "Player photos and team logos are not shown in this private preview; initials and team colours appear instead.");
  fs.writeFileSync(path.join(OUT, "index.html"), `<title>ODDSSMASH</title>
<link rel="stylesheet" href="styles.css">
<script>try { document.documentElement.dataset.theme = localStorage.getItem("theme") === "light" ? "light" : "dark"; } catch (e) { document.documentElement.dataset.theme = "dark"; }</script>
${body.trim()}
`);
  fs.appendFileSync(path.join(OUT, "styles.css"), `
/* added by scripts/bundle.mjs: keep clear of the phone's system bars */
.top { top: env(safe-area-inset-top, 0px); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 25; background: var(--page); }
`);
}

// 2. data
const dataDir = path.join(SRC, "data");
const map = {};
let bundles = 0, packed = 0, copied = 0;
const weekOf = (iso) => { const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

function groupKey(folder, id, obj) {
  if (obj && typeof obj.date === "string" && /^\d{4}-\d\d-\d\d/.test(obj.date)) return weekOf(obj.date); // games, upcoming
  if (obj && obj.team) return `t${obj.team}`;                                                              // players by team
  return null;
}

for (const name of fs.readdirSync(dataDir)) {
  const p = path.join(dataDir, name);
  const st = fs.statSync(p);
  if (st.isFile()) { fs.copyFileSync(p, path.join(OUT, "data", name)); copied++; continue; }
  const files = fs.readdirSync(p).filter((f) => f.endsWith(".json"));
  if (files.length <= BUNDLE_THRESHOLD) {
    fs.mkdirSync(path.join(OUT, "data", name), { recursive: true });
    for (const f of files) { fs.copyFileSync(path.join(p, f), path.join(OUT, "data", name, f)); copied++; }
    continue;
  }
  // group, then split any group that is too large
  const groups = new Map();
  for (const f of files) {
    const id = f.slice(0, -5);
    const text = fs.readFileSync(path.join(p, f), "utf8");
    let key = null;
    try { key = groupKey(name, id, JSON.parse(text)); } catch { /* fall through to the catch-all group */ }
    key = key || "misc";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([id, text]);
  }
  map[name] = {};
  for (const [key, items] of [...groups.entries()].sort()) {
    let part = 0, size = 0, cur = [];
    const flush = () => {
      if (!cur.length) return;
      const bname = `${name}-${key}${part ? `-${part}` : ""}`.replace(/[^A-Za-z0-9_-]/g, "");
      fs.writeFileSync(path.join(OUT, "data", "bundles", `${bname}.json`), `{${cur.map(([id, text]) => `${JSON.stringify(id)}:${text}`).join(",")}}`);
      for (const [id] of cur) map[name][id] = bname;
      bundles++; packed += cur.length; part++; size = 0; cur = [];
    };
    for (const it of items) {
      if (size + it[1].length > MAX_BUNDLE_BYTES) flush();
      cur.push(it); size += it[1].length;
    }
    flush();
  }
}
writeJSON(path.join(OUT, "data", "bundles.json"), map);
const meta = readJSON(path.join(OUT, "data", "meta.json"), {});
meta.bundles = true;
writeJSON(path.join(OUT, "data", "meta.json"), meta);

// 3. report
let total = 0, count = 0, biggest = ["", 0];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else { count++; total += s.size; if (s.size > biggest[1]) biggest = [path.relative(OUT, p), s.size]; } } };
walk(OUT);
console.log(`dist ready: ${count} files, ${(total / 1048576).toFixed(1)} MB (${packed} data files packed into ${bundles} bundles, ${copied} copied as-is)`);
console.log(`largest file: ${biggest[0]} ${(biggest[1] / 1048576).toFixed(2)} MB`);
