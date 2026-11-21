// Plans the next data refresh from the games on the four boards (NBA, FIBA, MLBB, Dota 2) and writes site/refresh.json,
// which every app shows next to "Data refreshed". GitHub's own cron starts scheduled runs only a few times a day, so the
// refresh timer (.github/workflows/timer.yml) waits the planned number of minutes and then starts the next full refresh.
//   game time   (a game started in the last 3 hours or starts within 45 minutes): wait 10 minutes after a run
//   match day   (next game within 6 hours): wait 20 minutes
//   quiet       (nothing for 6+ hours): wait 50 minutes
// The wait is also cut so a run finishes about 30 minutes before the next start: picks freeze at the last run before a game.
// A full run takes about 9 minutes, so a cycle is roughly 20 / 30 / 60 minutes.
// Usage: node scripts/next-run.mjs   (prints wait=<minutes> to $GITHUB_OUTPUT when it is set)
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/util.mjs";

const SITE = path.join(ROOT, "site"), now = Date.now(), MIN = 60000, H = 60 * MIN;
const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(SITE, p), "utf8")); } catch { return null; } };
const list = (j) => (Array.isArray(j) ? j : j?.matches || j?.games || []);
const starts = [];
for (const [sport, file] of [["NBA", "nba/data/upcoming.json"], ["FIBA", "fiba/data/upcoming.json"], ["MLBB", "mlbb/data/upcoming.json"], ["Dota 2", "dota2/data/upcoming.json"]])
  for (const g of list(read(file))) { const t = Date.parse(g.date || g.start || g.time || ""); if (Number.isFinite(t) && g.timed !== false) starts.push({ sport, t }); }
const live = starts.filter((s) => s.t > now - 3 * H && s.t < now + 45 * MIN), next = starts.filter((s) => s.t > now).sort((a, b) => a.t - b.t)[0];
let mode, wait;
if (live.length) { mode = "game time"; wait = 10; }
else if (next && next.t - now < 6 * H) { mode = "match day"; wait = 20; }
else { mode = "quiet"; wait = 50; }
if (next && !live.length) { const before = Math.floor((next.t - now) / MIN) - 9 - 30; if (before >= 5 && before < wait) wait = before; }
const sports = [...new Set(live.map((s) => s.sport))];
const out = { built: new Date(now).toISOString(), mode, waitMinutes: wait, next: new Date(now + (wait + 10) * MIN).toISOString(), live: sports,
  nextGame: next ? { sport: next.sport, at: new Date(next.t).toISOString() } : null,
  note: "Full refresh of all four boards (results, lineups, injuries, odds where we have them, predictions). About every 20 minutes while games are on, 30 on match days, 60 otherwise. GitHub can start a run a few minutes late." };
fs.mkdirSync(SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, "refresh.json"), JSON.stringify(out));
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `wait=${wait}\n`);
console.log(`next refresh: ${mode}${sports.length ? ` (${sports.join(", ")} on)` : ""}, wait ${wait} min${next ? `; next game ${next.sport} ${out.nextGame.at}` : ""}`);
