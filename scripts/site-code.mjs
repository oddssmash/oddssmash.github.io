// Code-only refresh of an already assembled site (./site restored from the last full build): copies the current app code,
// styles and pages over it and stamps a new version tag, leaving every data file as the last full build published it.
// Used by the quick deploy workflow so a code change goes live in a couple of minutes instead of waiting for the data run.
// Usage: node scripts/site-code.mjs <version-tag>
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/util.mjs";

const OUT = path.join(ROOT, "site"), v = process.argv[2] || String(Date.now());
if (!fs.existsSync(path.join(OUT, "nba"))) { console.log("no assembled site to refresh"); process.exit(1); }
const copyCode = (from, to) => { if (!fs.existsSync(from)) return; fs.mkdirSync(to, { recursive: true }); for (const f of fs.readdirSync(from)) { const p = path.join(from, f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(to, f)); } };
for (const f of fs.readdirSync(path.join(ROOT, "web", "home"))) { const p = path.join(ROOT, "web", "home", f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(OUT, f)); }
fs.cpSync(path.join(ROOT, "public", "brand"), path.join(OUT, "brand"), { recursive: true });
copyCode(path.join(ROOT, "public"), path.join(OUT, "nba")); // top-level files only: app.js, styles.css, index.html, sw and icons; data stays
for (const [src, app] of [["public-fiba", "fiba"], ["public-mlbb", "mlbb"], ["public-dota2", "dota2"]]) { copyCode(path.join(ROOT, src), path.join(OUT, app)); if (fs.existsSync(path.join(OUT, app))) fs.copyFileSync(path.join(ROOT, "public", "styles.css"), path.join(OUT, app, "styles.css")); }
for (const app of ["nba", "fiba", "mlbb", "dota2"]) {
  const f = path.join(OUT, app, "index.html"); if (!fs.existsSync(f)) continue;
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/src="app\.js(\?v=[^"]*)?"/, `src="app.js?v=${v}"`).replace(/href="styles\.css(\?v=[^"]*)?"/, `href="styles.css?v=${v}"`).replace(/href="(fiba|mlbb|dota2)\.css(\?v=[^"]*)?"/, `href="$1.css?v=${v}"`));
}
console.log("site code refreshed, version", v);
