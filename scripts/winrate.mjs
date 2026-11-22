// Overall prediction win rate for every sport, from the honest ledgers only: picks saved before the game and graded after.
//   NBA:    Picks-tab picks (picks-log.json); main-line record against the saved sportsbook line (mainline-log.json)
//   FIBA:   every pick (picks-log.json)
//   MLBB:   saved series calls at 60%+ (pretip.json; closer calls are listed on the site but not counted)
//   Dota 2: saved series and game lines (lines.json); lines read from a sportsbook (OddsPapi) are also counted separately
// Writes site/<sport>/data/winrate.json and site/winrate.json (all sports together, for the homepage). Voids and pushes are left
// out. Run after the site is assembled. Usage: node scripts/winrate.mjs
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/util.mjs";

const SITE = path.join(ROOT, "site"), now = Date.now(), DAY = 86400000;
const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(SITE, p), "utf8")); } catch { return null; } };
// rows: { t (ms), m (market key), hit (bool) }
function summary(rows, labels) {
  const cnt = (xs) => ({ n: xs.length, hit: xs.filter((x) => x.hit).length });
  const per = (xs) => ({ d7: cnt(xs.filter((x) => x.t > now - 7 * DAY)), d30: cnt(xs.filter((x) => x.t > now - 30 * DAY)), all: cnt(xs) });
  return { ...per(rows), since: rows.length ? new Date(Math.min(...rows.map((x) => x.t))).toISOString() : null,
    markets: Object.entries(labels).map(([k, label]) => ({ key: k, label, ...per(rows.filter((x) => x.m === k)) })).filter((x) => x.all.n) };
}
const ok = (s) => s === "hit" || s === "miss", out = {};

// NBA
{ const L = read("nba/data/picks-log.json"), M = read("nba/data/mainline-log.json"), FAM = { winner: "winner", spread: "spread", total: "total", teamTotal: "total", pts: "props", reb: "props", ast: "props", tpm: "props" };
  const rows = (L?.picks || []).filter((x) => ok(x.status)).map((x) => ({ t: Date.parse(x.date), m: FAM[x.fam] || "other", hit: x.status === "hit" }));
  const book = []; for (const g of M?.games || []) { const t = Date.parse(g.date); for (const k of ["ml", "spread", "total"]) if (ok(g[k]?.status)) book.push({ t, m: k, hit: g[k].status === "hit" }); for (const p of g.props || []) if (ok(p.status)) book.push({ t, m: "props", hit: p.status === "hit" }); }
  out.nba = { name: "NBA", picks: summary(rows, { winner: "Winner", spread: "Spread", total: "Totals", props: "Player props" }), book: book.length ? { label: "Against the sportsbook main line (saved before tip-off)", ...summary(book, { ml: "Moneyline", spread: "Spread", total: "Total", props: "Player props" }) } : null,
    note: "Picks-tab picks, frozen at the last run before tip-off and graded after the final." }; }
// FIBA
{ const L = read("fiba/data/picks-log.json"); const rows = (L?.picks || []).filter((x) => ok(x.status)).map((x) => ({ t: Date.parse(x.date), m: x.kind, hit: x.status === "hit" }));
  out.fiba = { name: "FIBA", picks: summary(rows, { winner: "Winner", total: "Totals", prop: "Player props" }), book: null, note: "Every pick, frozen at the last run before tip-off and graded after the final. No sportsbook data." }; }
// MLBB
{ const L = read("mlbb/data/pretip.json"); const rows = (L?.matches || []).filter((x) => x.score && Math.max(x.pSeries, 1 - x.pSeries) >= 0.6).map((x) => ({ t: Date.parse(x.date), m: "series", hit: !!x.right }));
  out.mlbb = { name: "MLBB", picks: summary(rows, { series: "Series winner" }), book: null, note: "Series calls at 60%+ saved before the match and graded after (closer calls are shown but not counted). No sportsbook data." }; }
// Dota 2
{ const L = read("dota2/data/lines.json"), rows = [], book = [], add = (t, m, x) => { if (x?.result?.won == null) return; const r = { t, m, hit: !!x.result.won }; rows.push(r); if (x.src) book.push(r); };
  for (const s of L?.history || []) { const t = Date.parse(s.date); for (const k of ["ml", "hcap", "total"]) add(t, k, s.picks?.[k]);
    for (const g of Object.values(s.games || {})) { add(t, "game", g); for (const [k, x] of Object.entries(g.markets || {})) add(t, k === "killsA" || k === "killsB" ? "teamKills" : k, x); } }
  const LAB = { ml: "Series winner", hcap: "Map handicap", total: "Total maps", game: "Game winner", totalKills: "Total kills", teamKills: "Team kills", killHcap: "Kill handicap", duration: "Duration" };
  out.dota2 = { name: "Dota 2", picks: summary(rows, LAB), book: book.length ? { label: "Lines read from a sportsbook (OddsPapi)", ...summary(book, LAB) } : null, note: "Series and game lines saved before the match or game and graded after. Estimated lines where no book offers one." }; }

const updated = new Date(now).toISOString();
for (const [k, v] of Object.entries(out)) { const dir = path.join(SITE, k, "data"); if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, "winrate.json"), JSON.stringify({ updated, ...v })); }
const tot = (key) => Object.values(out).reduce((a, v) => ({ n: a.n + v.picks[key].n, hit: a.hit + v.picks[key].hit }), { n: 0, hit: 0 });
fs.writeFileSync(path.join(SITE, "winrate.json"), JSON.stringify({ updated, all: tot("all"), d30: tot("d30"), d7: tot("d7"), sports: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { name: v.name, all: v.picks.all, d30: v.picks.d30, d7: v.picks.d7 }])) }));
console.log("win rate: " + Object.values(out).map((v) => `${v.name} ${v.picks.all.hit}/${v.picks.all.n}`).join(", "));
