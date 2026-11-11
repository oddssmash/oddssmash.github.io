// Assembles the published site in ./site:
//   site/index.html, site/brand/  the homepage (web/home) with the NBA / FIBA choice
//   site/nba/                     the NBA app (./public, unchanged)
//   site/fiba/                    the FIBA app (./public-fiba)
// Usage: node scripts/site.mjs [version-tag]   (the tag is added to app.js / styles.css links so phones reload new code)
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/util.mjs";

const OUT = path.join(ROOT, "site"), v = process.argv[2] || "";
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "web", "home"), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, "public", "brand"), path.join(OUT, "brand"), { recursive: true });
fs.cpSync(path.join(ROOT, "public"), path.join(OUT, "nba"), { recursive: true });
if (fs.existsSync(path.join(ROOT, "public-fiba"))) { fs.cpSync(path.join(ROOT, "public-fiba"), path.join(OUT, "fiba"), { recursive: true }); fs.copyFileSync(path.join(ROOT, "public", "styles.css"), path.join(OUT, "fiba", "styles.css")); } // FIBA shares the NBA stylesheet
if (fs.existsSync(path.join(ROOT, "public-mlbb"))) { fs.cpSync(path.join(ROOT, "public-mlbb"), path.join(OUT, "mlbb"), { recursive: true }); fs.copyFileSync(path.join(ROOT, "public", "styles.css"), path.join(OUT, "mlbb", "styles.css")); const img = path.join(ROOT, "data", "mlbb", "img"); if (fs.existsSync(img)) fs.cpSync(img, path.join(OUT, "mlbb", "img"), { recursive: true }); }
if (v) for (const app of ["nba", "fiba", "mlbb"]) {
  const f = path.join(OUT, app, "index.html"); if (!fs.existsSync(f)) continue;
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/src="app\.js"/, `src="app.js?v=${v}"`).replace(/href="styles\.css"/, `href="styles.css?v=${v}"`).replace(/href="fiba\.css"/, `href="fiba.css?v=${v}"`).replace(/href="mlbb\.css"/, `href="mlbb.css?v=${v}"`));
}
console.log("site assembled in", path.relative(ROOT, OUT));
