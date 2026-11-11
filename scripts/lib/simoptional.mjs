// Runs a step of `npm run refresh` only if its script exists, so the refresh does not fail
// while a later step (for example scripts/insights.mjs) has not been written yet.
//   node scripts/lib/simoptional.mjs scripts/insights.mjs [args...]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./util.mjs";

const [rel, ...args] = process.argv.slice(2);
if (!rel) { console.error("usage: node scripts/lib/simoptional.mjs <script> [args]"); process.exit(2); }
const file = path.resolve(ROOT, rel);
if (!fs.existsSync(file)) { console.log(`${rel} not found; step skipped.`); process.exit(0); }
const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit", cwd: ROOT });
process.exit(r.status == null ? 1 : r.status);
