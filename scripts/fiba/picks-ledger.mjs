// FIBA picks ledger: every pick on the FIBA Picks page (winners, totals, player props) frozen at the last run before
// its game starts, graded against the final box score, with a short reason for each miss. Runs after fiba/model.mjs.
// Writes data/fiba/picks-ledger.json (kept between runs) and public-fiba/data/picks-log.json (last 30 days).
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON } from "../lib/util.mjs";

const FD = path.join(DATA, "fiba"), LED = path.join(FD, "picks-ledger.json"), OUT = path.join(ROOT, "public-fiba", "data", "picks-log.json");
const SITE = process.env.FIBA_SITE_URL || "https://oddssmash.github.io/fiba/data";
const now = Date.now(), DAY = 86400000, led = readJSON(LED, { format: 1, picks: {} });
const cur = readJSON(path.join(ROOT, "public-fiba", "data", "picks.json"), { picks: [] });
const getJSON = async (u) => { try { const r = await fetch(u, { headers: { "cache-control": "no-cache" } }); return r.ok ? await r.json() : null; } catch { return null; } };
const keyOf = (p) => `${p.gid}|${p.kind}|${p.pick}`;
const keep = (p, at) => ({ gid: p.gid, date: p.date, comp: p.comp, kind: p.kind, pick: p.pick, p: p.p, game: p.game, proj: p.proj ?? null, avg: p.avg ?? null, frozen: at, status: "pending" });
if (!Object.keys(led.picks).length) { const pub = await getJSON(`${SITE}/picks-log.json`); for (const p of pub?.picks || []) led.picks[keyOf(p)] = p; }
// the list the previous run published is the last pre-tip list for games that started since; then this run's list
const prev = await getJSON(`${SITE}/picks.json`), prevAt = prev?.generated || null; let fromPrev = 0, frozen = 0;
for (const p of prev?.picks || []) { const t = Date.parse(p.date); if (t > now || t < now - 2 * DAY) continue; const k = keyOf(p); if (led.picks[k]) continue; led.picks[k] = keep(p, prevAt || "published list"); fromPrev++; }
for (const p of cur.picks || []) { if (Date.parse(p.date) <= now) continue; const k = keyOf(p); if (led.picks[k]?.status && led.picks[k].status !== "pending") continue; led.picks[k] = keep(p, new Date(now).toISOString()); frozen++; }
const onList = new Set((cur.picks || []).filter((p) => Date.parse(p.date) > now).map(keyOf));
for (const [k, p] of Object.entries(led.picks)) if (Date.parse(p.date) > now && p.status === "pending" && !onList.has(k)) delete led.picks[k];
// grade
const results = new Map((readJSON(path.join(ROOT, "public-fiba", "data", "results.json"), []) || []).map((r) => [String(r.id), r]));
const nk = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
const STAT = { points: "pts", rebounds: "reb", assists: "ast" };
function grade(p, g) {
  const [A, B] = g.teams, total = A.score + B.score;
  if (p.kind === "winner") { const name = p.pick.replace(/ to win$/, ""), mine = [A, B].find((t) => nk(t.name) === nk(name) || nk(t.code) === nk(name)); if (!mine) return null; const other = mine === A ? B : A; return { status: mine.score > other.score ? "hit" : "miss", actual: `${mine.score}-${other.score}` }; }
  if (p.kind === "total") { const m = /^(Over|Under) ([\d.]+)/.exec(p.pick); if (!m) return null; const ok = m[1] === "Over" ? total > +m[2] : total < +m[2]; return { status: ok ? "hit" : "miss", actual: total }; }
  if (p.kind === "prop") { const m = /^(.+?) (over|under) ([\d.]+) (points|rebounds|assists)/.exec(p.pick); if (!m) return null; const pl = (g.players || []).find((x) => nk(x.n) === nk(m[1])); if (!pl) return { status: "void", actual: null, why: "not on the box score" };
    if (!pl.min) return { status: "void", actual: null, why: "did not play" }; const v = pl[STAT[m[4]]] || 0, ok = m[2] === "over" ? v > +m[3] : v < +m[3]; return { status: ok ? "hit" : "miss", actual: v, pl, stat: STAT[m[4]], side: m[2], line: +m[3] }; }
  return null;
}
function whyMissed(p, g, r) {
  if (p.kind === "prop" && r.pl) { const pl = r.pl, out = [];
    const usualMin = p.avg && p.proj ? null : null; if (pl.min < 15) out.push(`played only ${Math.round(pl.min)} minutes`);
    if (r.side === "under" && r.stat === "pts") { if (pl.fga && pl.fgm / pl.fga >= 0.55) out.push(`hot shooting: ${pl.fgm}-${pl.fga} from the field`); if (pl.fta >= 8) out.push(`${pl.ftm}-${pl.fta} at the line`); if (pl.min >= 30) out.push(`heavy minutes (${Math.round(pl.min)})`); }
    if (r.side === "over" && r.stat === "pts" && pl.fga >= 6 && pl.fgm / pl.fga < 0.36) out.push(`cold shooting: ${pl.fgm}-${pl.fga}`);
    if (Math.abs(r.actual - r.line) <= 1) out.push(`missed by ${Math.abs(r.actual - r.line) === 0.5 ? "half a point" : "one"}`);
    if (!out.length) out.push(`${r.actual} against our ${p.proj ?? "-"} projection`); return out.join("; "); }
  const res = results.get(String(p.gid)); return res?.why || null;
}
let graded = 0;
for (const p of Object.values(led.picks)) { if (p.status !== "pending") continue; const g = readJSON(path.join(FD, "games", `${p.gid}.json`), null); if (!g?.teams?.[0] || g.teams[0].score == null || !(g.players || []).length) continue;
  const r = grade(p, g); if (!r) continue; p.status = r.status; p.actual = r.actual; if (r.why) p.why = r.why; if (r.status === "miss") p.why = whyMissed(p, g, r); p.gradedAt = new Date(now).toISOString(); graded++; }
for (const [k, p] of Object.entries(led.picks)) if (Date.parse(p.date) < now - 90 * DAY) delete led.picks[k];
writeJSON(LED, led);
const recent = Object.values(led.picks).filter((p) => Date.parse(p.date) > now - 30 * DAY).sort((a, b) => b.date.localeCompare(a.date) || b.p - a.p);
const done = recent.filter((p) => p.status === "hit" || p.status === "miss"), byKind = {}; for (const p of done) { const k = (byKind[p.kind] ||= { n: 0, hit: 0 }); k.n++; if (p.status === "hit") k.hit++; }
writeJSON(OUT, { format: 1, note: "Every FIBA pick, frozen at the last run before its game started and graded against the final box score; each miss carries a short reason. No sportsbook data.", updated: new Date(now).toISOString(), record: { n: done.length, hit: done.filter((p) => p.status === "hit").length }, byKind, picks: recent });
console.log(`FIBA picks ledger: ${frozen} frozen, ${fromPrev} from the published list, ${graded} graded`);
