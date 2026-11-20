// Dota 2 sportsbook main lines from OddsPapi (oddspapi.io, v4 REST, key in the ODDSPAPI_KEY repository secret).
// FOR DISPLAY AND GRADING ONLY: a book's line chooses which line our pick is tested at; its prices never feed a projection.
// Quota-aware: the monthly allowance is read from /v4/account (unmetered) and the run spends at most its fair share. Sports,
// markets and tournaments are cached; one odds-by-tournaments call per run returns every upcoming Dota 2 fixture with odds.
// The key is read from the environment only and never logged or written. Writes data/dota2/books.json and odds-status.json.
import path from "node:path";
import { DATA, readJSON, writeJSON } from "../lib/util.mjs";

const KEY = process.env.ODDSPAPI_KEY, D = path.join(DATA, "dota2"), API = "https://api.oddspapi.io/v4/";
const STATUS_F = path.join(D, "odds-status.json"), META_F = path.join(D, "oddspapi.json"), BOOKS_F = path.join(D, "books.json");
const status = { run: new Date().toISOString(), ok: false, calls: 0, note: "" };
const done = (note) => { status.note = note; writeJSON(STATUS_F, status); console.log(`OddsPapi: ${note}`); process.exit(0); };
if (!KEY) done("no key in this environment (set the ODDSPAPI_KEY secret); estimated lines only");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function get(p, params = {}, metered = true) {
  const wait = lastCall + 2100 - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now();
  const u = API + p + "?" + new URLSearchParams({ ...params, apiKey: KEY });
  try { const r = await fetch(u, { headers: { "user-agent": "OddssmashAnalyzer/1.0 (https://oddssmash.github.io/)" } }); if (metered) status.calls++;
    if (r.status === 429) { status.limited = true; return null; } if (!r.ok) { (status.errors ||= []).push(`${p} HTTP ${r.status}`); return null; } return await r.json(); }
  catch (e) { (status.errors ||= []).push(`${p} ${e.message.replace(KEY, "***")}`); return null; }
}
const meta = readJSON(META_F, {}), DAY = 86400000, now = Date.now();
// 1) quota (unmetered)
const acct = await get("account", {}, false);
const limit = +(acct?.request_limit ?? acct?.requestLimit ?? 0), used = +(acct?.request_count ?? acct?.requestCount ?? 0);
status.quota = { limit: limit || null, used: used || null };
const d = new Date(), daysLeft = Math.max(1, new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - d) / DAY;
const runBudget = limit ? Math.max(0, Math.floor((limit - used) / (daysLeft * 48))) : 2; // 48 runs a day
status.runBudget = runBudget;
// 2) cached sport id, markets and tournaments
if (!meta.sportId || now - Date.parse(meta.sportsAt || 0) > 14 * DAY) { const sp = await get("sports"); const ds = (sp || []).find((x) => /dota/i.test(`${x.sportName} ${x.slug}`)); if (ds) { meta.sportId = ds.sportId; meta.sportsAt = new Date().toISOString(); } }
if (!meta.sportId) { writeJSON(META_F, meta); done("Dota 2 not found in /v4/sports"); }
if (!meta.markets || now - Date.parse(meta.marketsAt || 0) > 14 * DAY) { const mk = await get("markets"); if (Array.isArray(mk)) { meta.markets = Object.fromEntries(mk.filter((x) => x.sportId === meta.sportId).map((x) => [x.marketId, { name: x.marketName, type: x.marketType, line: x.handicap, period: x.period, outcomes: Object.fromEntries((x.outcomes || []).map((o) => [o.outcomeId, o.outcomeName])) }])); meta.marketsAt = new Date().toISOString(); } }
if (!meta.tours || now - Date.parse(meta.toursAt || 0) > 0.5 * DAY) { const tt = await get("tournaments", { sportId: meta.sportId }); if (Array.isArray(tt)) { meta.tours = tt.filter((t) => (t.upcomingFixtures || 0) + (t.liveFixtures || 0) > 0).map((t) => ({ id: t.tournamentId, name: t.tournamentName })); meta.toursAt = new Date().toISOString(); } }
writeJSON(META_F, meta);
status.sportId = meta.sportId; status.markets = Object.keys(meta.markets || {}).length; status.tournaments = (meta.tours || []).length;
if (!meta.tours?.length) done("no Dota 2 tournament with upcoming fixtures");
if (runBudget < 1 && status.calls >= 1) done(`quota share used up for this run (${used}/${limit} this month)`);
// 3) odds for every upcoming fixture of those tournaments, one bookmaker (Pinnacle first; another is tried on a later run if empty)
const BOOKS = (process.env.ODDSPAPI_BOOKMAKERS || "pinnacle,ggbet,1xbet,bet365,betway,unibet").split(","), bk = meta.book || BOOKS[meta.bookTry || 0] || BOOKS[0];
const ids = meta.tours.map((t) => t.id).slice(0, 25);
const res = await get("odds-by-tournaments", { bookmaker: bk, tournamentIds: ids.join(","), oddsFormat: "decimal" });
const fixtures = Array.isArray(res) ? res : res?.fixtures || [];
// 4) parse each fixture's markets into main lines
const kindOf = (m) => { const n = `${m.name || ""} ${m.type || ""}`.toLowerCase(), map = /map\s*(\d)/.exec(n)?.[1] || (/(1st|first) map/.test(n) ? "1" : null);
  if (/kill/.test(n)) return { kind: /handicap|spread/.test(n) ? "killHcap" : /team|home|away|player/.test(n) && !/total kills/.test(n) ? "teamKills" : "totalKills", map };
  if (/duration|length|time/.test(n)) return { kind: "duration", map };
  if (/handicap|spread/.test(n) && !map) return { kind: "mapHcap" }; if (/total|over|under/.test(n) && /map/.test(n) && !map) return { kind: "totalMaps" };
  if ((/winner|1x2|moneyline|match result|^12/.test(n) || m.type === "12" || m.type === "1x2") && !map) return { kind: "winner" }; if (/winner/.test(n) && map) return { kind: "mapWinner", map }; return null; };
const out = [];
for (const f of fixtures) { const B = f.bookmakerOdds?.[bk]; if (!B?.markets) continue; const lines = [];
  for (const [mid, mk] of Object.entries(B.markets)) { const def = meta.markets?.[mid] || {}, k = kindOf(def); if (!k || mk.marketActive === false) continue;
    const outs = Object.entries(mk.outcomes || {}).map(([oid, o]) => { const pl = o.players?.["0"] || Object.values(o.players || {})[0] || {}; return { id: oid, name: def.outcomes?.[oid] || pl.bookmakerOutcomeId || oid, price: +pl.price || null, main: !!pl.mainLine, raw: pl.bookmakerOutcomeId || "" }; }).filter((o) => o.price > 1);
    if (outs.length < 2) continue; const inv = outs.reduce((a, o) => a + 1 / o.price, 0);
    lines.push({ ...k, marketId: +mid, name: def.name || null, line: def.line ?? null, main: outs.some((o) => o.main), outcomes: outs.map((o) => ({ name: o.name, raw: o.raw, price: o.price, p: Math.round((1 / o.price / inv) * 1000) / 1000 })) }); }
  // keep the main line per kind (flagged by the book, else the line priced closest to even)
  const best = {}; for (const l of lines) { const key = `${l.kind}|${l.map || ""}`, even = Math.abs((l.outcomes[0]?.p ?? 0.5) - 0.5); const cur = best[key]; if (!cur || (l.main && !cur.main) || (l.main === cur.main && even < cur.even)) best[key] = { ...l, even }; }
  if (Object.keys(best).length) out.push({ fixtureId: f.fixtureId, a: f.participant1Name, b: f.participant2Name, aShort: f.participant1ShortName || f.participant1Abbr || null, bShort: f.participant2ShortName || f.participant2Abbr || null, start: f.startTime, tournament: f.tournamentName, lines: Object.values(best).map(({ even, ...l }) => l) }); }
if (!out.length) { meta.bookTry = ((meta.bookTry || 0) + 1) % BOOKS.length; delete meta.book; writeJSON(META_F, meta); }
else { meta.book = bk; writeJSON(META_F, meta); }
const store = readJSON(BOOKS_F, { fixtures: [] }), keep = store.fixtures.filter((x) => Date.parse(x.start) > now - 2 * DAY && !out.some((y) => y.fixtureId === x.fixtureId));
writeJSON(BOOKS_F, { source: "OddsPapi (oddspapi.io)", bookmaker: out.length ? bk : store.bookmaker || null, fetched: out.length ? new Date().toISOString() : store.fetched || null, fixtures: [...keep, ...out.map((x) => ({ ...x, book: bk, fetchedAt: new Date().toISOString() }))] });
status.ok = true; status.bookmaker = bk; status.fixtures = fixtures.length; status.withLines = out.length; status.kinds = [...new Set(out.flatMap((x) => x.lines.map((l) => l.kind)))];
done(`${bk}: ${out.length} of ${fixtures.length} fixtures with main lines (${status.kinds.join(", ") || "none"}); quota ${used}/${limit || "?"} before this run, ${status.calls} metered calls`);
