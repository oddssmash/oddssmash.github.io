// Dota 2 model: the MLBB workflow, adapted to Dota 2.
//  1. Walk every pro series in date order. Before each one, project it from what was known then (team rating blended with
//     the ratings of the five players it fielded last, neutral side), then grade it, then learn from each game (the side
//     edge, Radiant vs Dire, is learned as we go).
//  2. Draft layer, learned game by game from earlier games only: pro strength per hero, hero pairs on the same side
//     (combos) and hero-vs-hero results (counters), with older games counting less. Used for the Draft lab and tested
//     walk-forward on every game once both drafts are known.
//  3. Learning: rating speed, how fast an idle rating fades, the player blend, the starting rating of a new team and the
//     draft weight are chosen by replaying all history and keeping the settings with the best Brier score (frozen for a
//     week at a time). A calibration test pulls chances toward 50% only if that helps on series it never saw.
//  4. Upcoming (Liquipedia schedule): series win chance, exact scores, map count, scenarios (signature hero banned, side,
//     short vs long games), head-to-head, our own lines. The last projection before each match is frozen (pre-match
//     record) and graded when the result arrives. No sportsbook data is read.
// Reads data/dota2/*. Writes public-dota2/data/.
import fs from "node:fs";
import path from "node:path";
import { DATA, ROOT, readJSON, writeJSON } from "../lib/util.mjs";

const D = path.join(DATA, "dota2"), OUT = path.join(ROOT, "public-dota2", "data");
for (const d of ["", "teams", "series", "matches"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
for (const d of ["teams", "series", "matches"]) for (const f of fs.readdirSync(path.join(OUT, d))) fs.rmSync(path.join(OUT, d, f));
const lg = (x) => 1 / (1 + Math.exp(-x)), logit = (p) => Math.log(p / (1 - p)), DAY = 86400, now = Math.floor(Date.now() / 1000);
const r3 = (x) => Math.round(x * 1000) / 1000, r1 = (x) => Math.round(x * 10) / 10;
const shr = (w, n, k = 10) => (w + k / 2) / (n + k);

// ---------------------------------------------------------------- load
const G = readJSON(path.join(D, "matches.json"), { matches: [] }).matches;
const TEAMS = readJSON(path.join(D, "teams.json"), {}), LEAGUES = readJSON(path.join(D, "leagues.json"), {});
const HEROES = readJSON(path.join(D, "heroes.json"), { heroes: {} }).heroes, HSTAT = readJSON(path.join(D, "herostats.json"), { heroes: {} }).heroes;
const PLAYERS = readJSON(path.join(D, "players.json"), { players: {} }).players, PATCHES = readJSON(path.join(D, "patches.json"), { patches: [] }).patches;
const PNOTES = readJSON(path.join(D, "patchnotes.json"), null), UP = readJSON(path.join(D, "upcoming.json"), { matches: [] });
const TRAITS = readJSON(path.join(D, "herotraits.json"), { heroes: {} }).heroes;
// DRAFT FACTORS: what a five-hero draft brings, from what heroes do in pro games (OpenDota averages, last 120 days) and Valve's
// role tags. Each trait is a z-score across heroes; a draft's factor is the sum over its five heroes. The power curve (tempo)
// is learned walk-forward from results (record in games under 30 vs 40+ minutes), so it never sees the game it scores.
const FACTORS = [
  ["control", "Control (stuns, disables)", (t, r) => z("stuns", t) + 0.5 * r.Disabler],
  ["teamfight", "Teamfight", (t, r) => z("tf", t) + 0.3 * r.Initiator],
  ["damage", "Hero damage", (t) => z("hd", t)],
  ["push", "Push and towers", (t, r) => z("td", t) + 0.5 * r.Pusher],
  ["objectives", "Roshan and objectives", (t) => z("rosh", t)],
  ["laning", "Laning (gold at 10 min)", (t) => z("g10", t)],
  ["map", "Map control (stacks, wards)", (t) => 0.5 * z("stack", t) + 0.5 * z("obs", t)],
  ["sustain", "Healing and sustain", (t) => z("heal", t)],
  ["scaling", "Late-game farm (carry power)", (t, r) => z("gpm", t) + 0.3 * r.Carry],
  ["initiation", "Initiation", (t, r) => r.Initiator],
  ["durable", "Durability", (t, r) => r.Durable - 0.5 * z("d", t)],
  ["mobility", "Mobility and escape", (t, r) => r.Escape],
  ["tempo", "Early-game lean (power curve)", null],
];
const TSTAT = {}; for (const k of ["stuns", "tf", "hd", "td", "rosh", "g10", "stack", "obs", "heal", "gpm", "d"]) { const v = Object.values(TRAITS).map((t) => t[k]).filter((x) => x != null), m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length)) || 1; TSTAT[k] = [m, sd]; }
function z(k, t) { const x = t?.[k]; return x == null ? 0 : Math.max(-3, Math.min(3, (x - TSTAT[k][0]) / TSTAT[k][1])); }
const HVEC = {}; for (const h of Object.values(HEROES)) { const t = TRAITS[h.id] || {}, r = Object.fromEntries(["Carry", "Disabler", "Initiator", "Nuker", "Pusher", "Escape", "Durable", "Support"].map((x) => [x, h.roles.includes(x) ? 1 : 0])); HVEC[h.id] = FACTORS.map(([, , f]) => (f ? Math.round(f(t, r) * 1000) / 1000 : 0)); }
const NF = FACTORS.length;
const draftVec = (side, tempoOf) => { const v = new Array(NF).fill(0); for (const h of side) { const x = HVEC[h]; if (x) for (let i = 0; i < NF - 1; i++) v[i] += x[i]; v[NF - 1] += tempoOf ? tempoOf(h) : 0; } return v; };
// CHECKLIST TAGS (the user's Dota 2 factor checklist, sections 1 and 1B): what each hero can do, read from Valve's official
// hero data (role levels, base stats, each ability's text, damage type, whether it pierces spell immunity) and item timings
// from pro purchase logs. Used for protection coverage, red flags, BKB-piercing control and item timing in every draft.
const VALVE = readJSON(path.join(D, "herodata.json"), { heroes: {} }).heroes, ITEMT = readJSON(path.join(D, "itemtimings.json"), { heroes: {} }).heroes;
const RX = { hard: /\bstun|\bhex|\bsleep|taunt|\bfear|cyclone|petrif|suppress|lifts? |knock(s|ed)? (back|up|into)|\bpull|vortex|chronosphere|black hole|\bduel\b|\bdoom\b|imprison|frozen|freezes|stasis/i, soft: /\bslow|\broot|silence|disarm|ensnare|leash|\bbreak\b|blind/i,
  save: /invulnerab|banish|untargetable|cannot die|prevent\w* .*death|relocat|disruption|swap|astral|false promise|shallow grave|cold embrace|guardian angel|purif/i, dispel: /dispel|purge|removes? (most )?(negative|debuffs)/i, heal: /\bheal|restor\w* .*health|regenerat/i,
  antiheal: /reduc\w* .*(heal|regenerat|restoration)|healing reduction/i, units: /illusion|summon|spawn|clone|wolves|spiderling|golem|eidolon|familiar|treant|zombie|serpent ward|plague ward|skeleton|undying|minion/i,
  detect: /true sight|reveal\w* .*invisib|detect\w* .*invisib/i, invis: /invisib/i, aoe: /nearby|\barea\b|radius|around|all enemies|\bwave\b|in a line|\bcone\b|circle/i, manaburn: /burn\w* .*mana|mana break|drain\w* .*mana|mana void/i };
const TAG = {};
for (const h of Object.values(HEROES)) { const v = VALVE[h.id] || { ab: [], roles: [] }, R0 = v.roles || [], t = { carry: (R0[0] || 0) >= 2, support: (R0[1] || 0) >= 2, escape: (R0[6] || 0) >= 2, durable: (R0[5] || 0) >= 2 || ((v.armor || 0) >= 5 && (v.hp || 0) >= 700), initiator: (R0[8] || 0) >= 2, pusher: (R0[7] || 0) >= 2, ranged: (v.range || 150) >= 400, hard: 0, soft: 0, bkbcc: 0, save: 0, dispel: 0, heal: 0, antiheal: 0, units: 0, detect: 0, invis: 0, aoe: 0, magic: 0, phys: 0, manaburn: 0, channelUlt: 0 };
  for (const a of v.ab || []) { const d = a.d || "", enemy = a.team === 2 || a.team === 3 || a.team === 0, ally = a.team === 1 || a.team === 3;
    const isHard = enemy && RX.hard.test(d), isSoft = enemy && !isHard && RX.soft.test(d);
    if (isHard) t.hard++; if (isSoft) t.soft++; if ((isHard || isSoft) && a.imm === 3) t.bkbcc++;
    if (RX.save.test(d) && (ally || /ally|allied|friendly/i.test(d))) t.save++; if (RX.dispel.test(d) && (ally || /ally|allied|friendly/i.test(d))) t.dispel++;
    if (RX.heal.test(d) && (ally || /ally|allied|friendly/i.test(d)) && !RX.antiheal.test(d)) t.heal++; if (RX.antiheal.test(d)) t.antiheal++;
    if (RX.units.test(d)) t.units++; if (RX.detect.test(d)) t.detect++; else if (RX.invis.test(d) && !/enem/i.test(d.split("invisib")[0].slice(-30))) t.invis++;
    if (a.dmg && enemy && RX.aoe.test(d)) t.aoe++; if (a.dmg === 2) t.magic++; if (a.dmg === 1) t.phys++; if (RX.manaburn.test(d)) t.manaburn++; if (a.ult && a.ch) t.channelUlt++; }
  const it = ITEMT[h.id] || {}, games = TRAITS[h.id]?.n || 0, share = (k) => (games ? Math.min(1, (it[k]?.n || 0) / games) : 0);
  t.blink = share("blink") >= 0.3 ? it.blink.min : null; t.bkb = share("black_king_bar") >= 0.4 ? it.black_king_bar.min : null; t.sb = share("invis_sword") + share("silver_edge") >= 0.3 ? (it.invis_sword?.min ?? it.silver_edge?.min) : null;
  t.mana = (VALVE[h.id]?.attr === 2) || (t.magic >= 3);
  TAG[h.id] = t; }
// hero lists from the user's factor checklist (1B.4): these heroes always count for that tool, whatever the keyword reading says
const LIST = { save: ["Oracle", "Dazzle", "Abaddon", "Io", "Winter Wyvern", "Shadow Demon", "Omniknight", "Vengeful Spirit", "Earth Spirit", "Chen"], dispel: ["Oracle", "Abaddon", "Legion Commander", "Omniknight"],
  heal: ["Witch Doctor", "Dazzle", "Warlock", "Treant Protector", "Chen", "Omniknight", "Necrophos", "Io", "Oracle"], peel: ["Lion", "Shadow Shaman", "Treant Protector", "Jakiro", "Disruptor"], zone: ["Disruptor", "Mars", "Dark Seer", "Faceless Void"],
  escape: ["Anti-Mage", "Puck", "Weaver", "Slark", "Queen of Pain"], antiheal: ["Ancient Apparition", "Axe", "Doom", "Pugna", "Spirit Breaker"] };
const byName = Object.fromEntries(Object.values(HEROES).map((h) => [h.name, h.id]));
for (const [k, names] of Object.entries(LIST)) for (const n of names) { const t = TAG[byName[n]]; if (!t) continue; if (k === "escape") t.escape = true; else if (k === "peel") t.hard = Math.max(t.hard, 2); else if (k === "zone") t.zone = 1; else t[k] = Math.max(t[k] || 0, 1); }
const CATS = [["save", "Saves"], ["dispel", "Dispels for allies"], ["heal", "Healing"], ["peel", "Peel (disables)"], ["escape", "Escapes"]];
// one side against the other: protection coverage (0-3 per category), red flags and counts
function checklist(side, enemy) {
  const T = side.map((h) => TAG[h] || {}), E = enemy.map((h) => TAG[h] || {}), sum = (A, k) => A.reduce((a, t) => a + (typeof t[k] === "boolean" ? (t[k] ? 1 : 0) : t[k] ? (typeof t[k] === "number" && k !== "blink" && k !== "bkb" && k !== "sb" ? t[k] : 1) : 0), 0);
  const cov = { save: Math.min(3, sum(T, "save")), dispel: Math.min(3, sum(T, "dispel")), heal: Math.min(3, sum(T, "heal")), peel: Math.min(3, Math.floor(T.filter((t) => t.support).reduce((a, t) => a + t.hard, 0) / 1.5)), escape: Math.min(3, sum(T, "escape")) };
  const hard = sum(T, "hard"), enemyHard = sum(E, "hard"), enemyCarries = sum(E, "carry"), enemyBkb = E.filter((t) => t.bkb != null).length;
  const carryIdx = T.findIndex((t) => t.carry), flags = [];
  const F = (on, text) => { if (on) flags.push(text); };
  F(carryIdx >= 0 && !T[carryIdx].escape && cov.save === 0, "Carry has no escape and no save on the team");
  F(cov.dispel === 0 && enemyHard + sum(E, "soft") >= 6, "No dispel against a heavy disable lineup");
  F(sum(T, "bkbcc") === 0 && enemyBkb >= 2, "No control that goes through BKB against BKB carries");
  F(sum(T, "aoe") <= 1 && sum(E, "units") >= 2, "Little area damage against illusions or summons");
  F(sum(T, "aoe") <= 1 && sum(E, "pusher") >= 2, "Little wave clear against a push lineup");
  F(hard <= 1, hard === 0 ? "No stun or hard disable at all" : "Only one hard disable");
  F(sum(T, "durable") === 0, "No frontline: everyone is squishy");
  F(sum(T, "initiator") === 0, "No initiator");
  F(sum(T, "detect") === 0 && sum(E, "invis") >= 1, "No detection against invisible heroes");
  F(sum(T, "heal") === 0 && sum(E, "heal") >= 2, "No healing against a sustain lineup");
  F(sum(T, "antiheal") === 0 && sum(E, "heal") >= 3, "No anti-heal against a heavy healing lineup");
  F(sum(T, "carry") >= 3, "Greedy: three or more carries");
  F(sum(T, "channelUlt") >= 1 && enemyHard >= 5, "Relies on a channelled ultimate against lots of stuns");
  F(T.filter((t) => t.mana).length >= 3 && sum(E, "manaburn") >= 1, "Mana-hungry heroes against mana burn");
  F(T.every((t) => t.magic >= t.phys) || T.every((t) => t.phys > t.magic), "One damage type across the team");
  F(sum(T, "escape") === 0 && enemy.length === 5 && E.filter((t) => t.escape).length >= 3, "No mobility against an elusive lineup");
  const blinks = T.filter((t) => t.blink != null).map((t) => t.blink).sort((a, b) => a - b);
  return { cov, covTotal: Object.values(cov).reduce((a, b) => a + b, 0), flags, hard, soft: sum(T, "soft"), bkbcc: sum(T, "bkbcc"), blinks: blinks.length, blinkMin: blinks[0] ?? null, bkbCores: T.filter((t) => t.bkb != null).length, sb: T.filter((t) => t.sb != null).length };
}
const EXTRA = [["coverage", "Ally protection coverage"], ["redflags", "Red flags (fewer is better)"], ["counters", "Direct counters on the enemy"], ["bkbcc", "Control through BKB"], ["blink", "Blink initiators"]];
const NX = EXTRA.length;
const extraVec = (A, B, cs) => { const a = checklist(A, B), b = checklist(B, A); return [a.covTotal - b.covTotal, a.flags.length - b.flags.length, cs, a.bkbcc - b.bkbcc, a.blinks - b.blinks]; };

const tname = (id) => TEAMS[id]?.name || `Team ${id}`;
const hname = (id) => HEROES[id]?.name || `Hero ${id}`;
// parse each game once: draft (picks and bans in order, 0 = Radiant) and player lines
for (const g of G) {
  g.pick = [[], []]; g.ban = [[], []]; g.order = [];
  for (const x of g.dr ? g.dr.split(",") : []) { const p = x[0] === "p", s = +x[1], h = +x.slice(3); (p ? g.pick : g.ban)[s].push(h); g.order.push([p ? 1 : 0, s, h]); }
  g.lines = [[], []];
  for (const x of g.pl ? g.pl.split(",") : []) { const [acc, hero, slot, k, d, a, gpm, lh] = x.split(":").map(Number); g.lines[slot >= 128 ? 1 : 0].push({ acc, hero, k, d, a, gpm, lh }); }
  if (g.pick[0].length !== 5) { g.pick = [g.lines[0].map((l) => l.hero), g.lines[1].map((l) => l.hero)]; } // drafts not parsed: heroes from the player lines
  g.team = [g.r, g.d];
  g.obj = {}; for (const x of g.ob ? g.ob.split(",") : []) { const [k, t] = x.split(":"), type = k[0], side = +k[1]; if (!(type in g.obj)) g.obj[type] = { side, t: +t }; if (type === "T" || type === "R") g.obj[type + "n"] = (g.obj[type + "n"] || [0, 0]), g.obj[type + "n"][side]++; }
}
// ---------------------------------------------------------------- series
const BO = { 0: 1, 1: 3, 2: 5, 3: 2 };
const SER = new Map();
for (const g of G) { const k = g.sid ? `s${g.sid}` : `g${g.id}`; if (!SER.has(k)) SER.set(k, { key: k, games: [], bo: BO[g.st] ?? 1, league: g.lg }); SER.get(k).games.push(g); }
const series = [...SER.values()].map((s) => {
  s.games.sort((a, b) => a.t - b.t); const A = s.games[0].r, B = s.games[0].d; s.a = A; s.b = B; s.t = s.games[0].t;
  if (s.games.some((g) => !g.team.includes(A) || !g.team.includes(B))) return null;
  const wa = s.games.filter((g) => (g.rw ? g.r : g.d) === A).length, wb = s.games.length - wa; s.score = [wa, wb];
  const need = s.bo === 2 ? 2 : Math.ceil(s.bo / 2);
  s.complete = s.bo === 2 ? s.games.length === 2 : Math.max(wa, wb) >= need;
  s.draw = s.bo === 2 && wa === 1 && wb === 1;
  return s;
}).filter(Boolean).sort((a, b) => a.t - b.t);
console.log(`Dota 2: ${G.length} games, ${series.length} series (${series.filter((s) => s.complete).length} complete)`);

// series math: chance to win a best-of-n from a single-game chance (Bo2: 2-0, 1-1, 0-2)
function seriesP(p, bo) {
  if (bo === 2) return { win: p * p, draw: 2 * p * (1 - p), scores: { "2-0": p * p, "1-1": 2 * p * (1 - p), "0-2": (1 - p) ** 2 } };
  const need = Math.ceil(bo / 2), out = {}; let win = 0; const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (let l = 0; l < need; l++) { const pr = C(need - 1 + l, l) * p ** need * (1 - p) ** l; out[`${need}-${l}`] = pr; win += pr; }
  for (let w = 0; w < need; w++) out[`${w}-${need}`] = C(need - 1 + w, w) * (1 - p) ** need * p ** w;
  return { win, draw: 0, scores: out };
}
// a Bo2 counts as "won" for grading only on 2-0; the headline chance is the 2-0 chance plus half the draw
const headline = (s) => s.win + s.draw / 2;

// ---------------------------------------------------------------- draft tables (walk-forward, older games count less)
function makeDraft(tau = 120 * DAY) {
  const H = new Map(), PR = new Map(), VS = new Map(), SH = new Map(), LO = new Map(); let clock = 0;
  const get = (M, k) => { let x = M.get(k); if (!x) M.set(k, (x = { n: 0, w: 0, b: 0, t: clock })); const f = Math.exp(-(clock - x.t) / tau); x.n *= f; x.w *= f; x.b *= f; x.t = clock; return x; };
  const peek = (M, k) => { const x = M.get(k); if (!x) return { n: 0, w: 0, b: 0 }; const f = Math.exp(-(clock - x.t) / tau); return { n: x.n * f, w: x.w * f, b: x.b * f }; };
  const pk = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  function logitOf(rad, dire) { // Radiant's draft edge in logit
    let h = 0, c = 0;
    for (const x of rad) { const s = peek(H, x); h += logit(shr(s.w, s.n, 20)); } for (const x of dire) { const s = peek(H, x); h -= logit(shr(s.w, s.n, 20)); }
    for (const [side, sg] of [[rad, 1], [dire, -1]]) for (let i = 0; i < side.length; i++) for (let j = i + 1; j < side.length; j++) { const s = peek(PR, pk(side[i], side[j])); c += sg * logit(shr(s.w, s.n, 30)); }
    for (const x of rad) for (const y of dire) { const s = peek(VS, `${x}>${y}`); c += logit(shr(s.w, s.n, 30)); }
    return h + 0.5 * c;
  }
  function learn(g) {
    clock = g.t; const [R, Dd] = g.pick, rw = g.rw;
    for (const [side, won] of [[R, rw], [Dd, 1 - rw]]) { for (const x of side) { const s = get(H, x); s.n++; s.w += won; } for (let i = 0; i < side.length; i++) for (let j = i + 1; j < side.length; j++) { const s = get(PR, pk(side[i], side[j])); s.n++; s.w += won; } }
    for (const x of R) for (const y of Dd) { const a = get(VS, `${x}>${y}`); a.n++; a.w += rw; const b = get(VS, `${y}>${x}`); b.n++; b.w += 1 - rw; }
    for (const s of [0, 1]) for (const x of g.ban[s]) get(H, x).b++;
    if (g.dur < 30 * 60 || g.dur >= 40 * 60) { const M = g.dur < 30 * 60 ? SH : LO; for (const [side, won] of [[R, rw], [Dd, 1 - rw]]) for (const x of side) { const s = get(M, x); s.n++; s.w += won; } }
  }
  // direct counters (checklist 1B.8): for each enemy hero, +2 if we have a hard counter (edge 0.3+ in logit), +1 for a soft one (0.15+)
  const counterScore = (A, B) => { const sc = (X, Y) => Y.reduce((t, y) => { let best = 0; for (const x of X) { const v = peek(VS, `${x}>${y}`); best = Math.max(best, logit(shr(v.w, v.n, 30))); } return t + (best >= 0.3 ? 2 : best >= 0.15 ? 1 : 0); }, 0); return sc(A, B) - sc(B, A); };
  const tempo = (x) => { const a = peek(SH, x), b = peek(LO, x); return 4 * (shr(a.w, a.n, 16) - shr(b.w, b.n, 16)); };
  // PATCH RESET: at each new patch older hero results count less (x0.7 for every hero, pair and matchup); heroes the newest
  // patch changed get pulled harder (5+ change lines: x0.35, 1-4: x0.55), so post-patch games take over quickly.
  const patchShift = (changed = {}) => { const f0 = 0.7; for (const M of [H, SH, LO]) for (const [k, x] of M) { const c = changed[k] || 0, f = c >= 5 ? 0.35 : c >= 1 ? 0.55 : f0; x.n *= f; x.w *= f; x.b *= f; }
    for (const M of [PR, VS]) for (const [k, x] of M) { const ids = k.split(/[->]/).map(Number), c = Math.max(...ids.map((i) => changed[i] || 0)), f = c >= 5 ? 0.35 : c >= 1 ? 0.55 : f0; x.n *= f; x.w *= f; x.b *= f; } };
  return { patchShift, logitOf, learn, H, PR, VS, SH, LO, peek, tempo, counterScore, setClock: (t) => (clock = t) };
}

// ---------------------------------------------------------------- replay (team + player ratings, side edge, draft check)
const PATCH_T = PATCHES.map((p) => ({ t: Date.parse(p.date) / 1000, changed: p.patch === PNOTES?.patch ? PNOTES.heroes : {} }));
const WARM = 8; // games a team needs on record before its series are graded
function replay(P, record = false) {
  const TR = new Map(), PRt = new Map(), DR = makeDraft(), log = [], glog = [];
  const PQ = PATCH_T.filter((p) => p.t > (G[0]?.t || 0)).map((p) => ({ ...p })); let side = { n: 40, w: 20.8 }; // Radiant wins, prior 52%
  const team = (id, t) => { let x = TR.get(id); if (!x) TR.set(id, (x = { r: P.r0, n: 0, last: t, lineup: null, hist: [] })); const f = Math.exp(-(t - x.last) / (P.H * DAY)); x.r = P.r0 + (x.r - P.r0) * f; x.last = t; return x; };
  const player = (acc, t) => { let x = PRt.get(acc); if (!x) PRt.set(acc, (x = { r: P.r0, n: 0, last: t })); const f = Math.exp(-(t - x.last) / (P.H * DAY)); x.r = P.r0 + (x.r - P.r0) * f; x.last = t; return x; };
  const strength = (T, accs, t) => { if (!P.w || !accs || accs.length !== 5) return T.r; const pr = accs.reduce((a, acc) => a + player(acc, t).r, 0) / 5; return (1 - P.w) * T.r + P.w * pr; };
  let bS = 0, nS = 0, bG = 0, nG = 0, bGD = 0, nGD = 0, hit = 0;
  for (const s of series) {
    const A = team(s.a, s.t), B = team(s.b, s.t), warm = A.n >= WARM && B.n >= WARM;
    const sa = strength(A, A.lineup, s.t), sb = strength(B, B.lineup, s.t), pg = lg(sa - sb), sp = seriesP(pg, s.bo);
    if (s.complete) {
      if (record) log.push({ s, pg, sp, warm, ra: sa, rb: sb, na: A.n, nb: B.n });
      if (warm && !s.draw) { const y = s.score[0] > s.score[1] ? 1 : 0, p = headline(sp); bS += (p - y) ** 2; nS++; if ((p >= 0.5) === (y === 1)) hit++; }
    }
    for (const g of s.games) {
      const R = team(g.r, g.t), Dd = team(g.d, g.t), accR = g.lines[0].map((l) => l.acc), accD = g.lines[1].map((l) => l.acc);
      const sideL = logit(side.w / side.n), base = strength(R, accR.length === 5 ? accR : R.lineup, g.t) - strength(Dd, accD.length === 5 ? accD : Dd.lineup, g.t) + sideL;
      const p = lg(base), y = g.rw, wm = R.n >= WARM && Dd.n >= WARM;
      if (wm) { bG += (p - y) ** 2; nG++; }
      if (wm && g.pick[0].length === 5 && g.pick[1].length === 5) { const pd = lg(base + P.dw * DR.logitOf(g.pick[0], g.pick[1])); bGD += (pd - y) ** 2; nGD++; if (record) { const fr = draftVec(g.pick[0], DR.tempo), fd = draftVec(g.pick[1], DR.tempo); glog.push({ g, p, pd, base, dl: DR.logitOf(g.pick[0], g.pick[1]), fv: fr.map((x, i) => x - fd[i]), ex: extraVec(g.pick[0], g.pick[1], DR.counterScore(g.pick[0], g.pick[1])), fr, fd }); } }
      else if (record) glog.push({ g, p, pd: null });
      // learn
      const err = y - p, kR = P.K * (1 + 2 / (1 + R.n / 10)), kD = P.K * (1 + 2 / (1 + Dd.n / 10));
      R.r += kR * err; Dd.r -= kD * err; R.n++; Dd.n++;
      if (P.w) { for (const acc of accR) { const x = player(acc, g.t); x.r += P.K * (1 + 2 / (1 + x.n / 10)) * err; x.n++; } for (const acc of accD) { const x = player(acc, g.t); x.r -= P.K * (1 + 2 / (1 + x.n / 10)) * err; x.n++; } }
      if (accR.length === 5) R.lineup = accR; if (accD.length === 5) Dd.lineup = accD;
      if (record) { R.hist.push([g.t, r3(R.r)]); Dd.hist.push([g.t, r3(Dd.r)]); }
      while (PQ.length && g.t >= PQ[0].t) { const pq = PQ.shift(); DR.patchShift(pq.changed); }
      side.n++; side.w += y; DR.learn(g);
    }
  }
  return { TR, PRt, DR, log, glog, side: side.w / side.n, brier: bS / Math.max(1, nS), n: nS, hit: hit / Math.max(1, nS), gBrier: bG / Math.max(1, nG), gBrierDraft: bGD / Math.max(1, nGD), nGD, strength };
}

// SETTINGS FREEZE: the grid search runs once a week (or with RETUNE=1); in between, the saved settings are reused, so a
// published chance only moves when a game is played, and games after the freeze are graded on settings that never saw them.
const FROZEN_FILE = path.join(D, "frozen-params.json"), FZ = readJSON(FROZEN_FILE, null);
const fzOk = FZ && !process.env.RETUNE && Date.now() - Date.parse(FZ.date) < 7 * 86400000;
let P;
if (fzOk) P = FZ.P;
else {
  let best = null;
  for (const K of [0.1, 0.15, 0.22, 0.3]) for (const H of [180, 365, 730]) for (const w of [0, 0.5, 0.7, 0.85, 1]) for (const r0 of [0, -0.3]) {
    const p = { K, H, w, r0, dw: 0 }, r = replay(p), score = r.brier + 0.5 * r.gBrier; if (!best || score < best.score) best = { P: p, score };
  }
  P = best.P; let bd = null;
  for (const dw of [0, 0.25, 0.5, 0.75, 1]) { const r = replay({ ...P, dw }); if (!bd || r.gBrierDraft < bd.b) bd = { dw, b: r.gBrierDraft }; }
  P.dw = bd.dw; writeJSON(FROZEN_FILE, { date: new Date().toISOString(), P, previous: FZ || null });
}
const R = replay(P, true);
// FACTOR MODEL: logistic regression on the draft factor differences (Radiant minus Dire) plus the hero/combo/counter edge,
// with the rating and side as a fixed offset. Ridge-penalised, fitted on the first 70% of drafted games by date and judged on
// the last 30%. Adopted for draft calls only if it beats the plain draft layer on games it never saw.
const DG = R.glog.filter((x) => x.fv), dcut = Math.floor(DG.length * 0.7);
const XV = (x, j) => (j < NF ? x.fv[j] : j < NF + NX ? x.ex[j - NF] : x.dl);
function fitLogit(rows, lambda = 50) { const k = NF + NX + 1, w = new Array(k).fill(0), sd = new Array(k).fill(1);
  for (let j = 0; j < k; j++) { const v = rows.map((x) => XV(x, j)), m = v.reduce((a, b) => a + b, 0) / v.length; sd[j] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; }
  const X = (x, j) => XV(x, j) / sd[j];
  for (let it = 0; it < 800; it++) { const g = new Array(k).fill(0), hdiag = new Array(k).fill(lambda);
    for (const x of rows) { let l = x.base; for (let j = 0; j < k; j++) l += w[j] * X(x, j); const p = lg(l), e = x.g.rw - p; for (let j = 0; j < k; j++) { g[j] += e * X(x, j); hdiag[j] += p * (1 - p) * X(x, j) ** 2; } }
    for (let j = 0; j < k; j++) w[j] += 2 * (g[j] - lambda * w[j]) / rows.length; }
  const hd = new Array(k).fill(lambda); for (const x of rows) { let l = x.base; for (let j = 0; j < k; j++) l += w[j] * X(x, j); const p = lg(l); for (let j = 0; j < k; j++) hd[j] += p * (1 - p) * X(x, j) ** 2; }
  return { w: w.map((v, j) => v / sd[j]), se: hd.map((h, j) => 1 / Math.sqrt(h) / sd[j]) }; }
const draftPart = (M, x) => { let l = 0; for (let j = 0; j < NF + NX + 1; j++) l += M.w[j] * XV(x, j); return l; };
const FM = fitLogit(DG.slice(0, dcut)), test = DG.slice(dcut);
const brierOn = (rows, f) => rows.reduce((a, x) => a + (f(x) - x.g.rw) ** 2, 0) / Math.max(1, rows.length);
const fBase = brierOn(test, (x) => lg(x.base)), fPlain = brierOn(test, (x) => lg(x.base + P.dw * x.dl)), fFull = brierOn(test, (x) => lg(x.base + draftPart(FM, x)));
const FM_ALL = fitLogit(DG), useFactors = fFull < fPlain;
const PLAIN = { w: [...new Array(NF + NX).fill(0), P.dw], se: new Array(NF + NX + 1).fill(0) };
const DMODEL = useFactors ? FM_ALL : PLAIN;
// draft winner record on the held-out games (out of sample for the fitted weights)
const dwRec = (rows, M) => { const r = rows.filter((x) => Math.abs(draftPart(M, x)) > 0.05); return { n: r.length, hit: r.filter((x) => (draftPart(M, x) > 0) === (x.g.rw === 1)).length }; };
const DRAFT_EVAL = { games: DG.length, train: dcut, test: test.length, brier: { ratings: +fBase.toFixed(4), plainDraft: +fPlain.toFixed(4), factors: +fFull.toFixed(4) }, adopted: useFactors,
  winner: dwRec(test, FM), winnerPlain: dwRec(test, PLAIN),
  weights: [...FACTORS, ...EXTRA, ["heroes", "Hero strength, combos and counters (results)"]].map(([k, label], j) => ({ k, label, w: +FM_ALL.w[j].toFixed(4), se: +FM_ALL.se[j].toFixed(4), z: +(FM_ALL.w[j] / FM_ALL.se[j]).toFixed(2) })) };
console.log(`draft factors: held-out Brier ratings ${fBase.toFixed(4)}, + plain draft ${fPlain.toFixed(4)}, + factors ${fFull.toFixed(4)} (${useFactors ? "adopted" : "not adopted"}); draft winner ${DRAFT_EVAL.winner.hit}/${DRAFT_EVAL.winner.n} (plain ${DRAFT_EVAL.winnerPlain.hit}/${DRAFT_EVAL.winnerPlain.n})`);
console.log(DRAFT_EVAL.weights.map((x) => `${x.k} ${x.w} (z ${x.z})`).join(", "));
// plain-English read of one draft: strengths, weaknesses and gameplan, from factor values against the average pro draft
const FAVG = (() => { const a = new Array(NF).fill(0), q = new Array(NF).fill(0); let n = 0; for (const x of DG.slice(-1500)) for (const v of [x.fr, x.fd]) { n++; for (let j = 0; j < NF; j++) { a[j] += v[j]; q[j] += v[j] ** 2; } } return a.map((s0, j) => [s0 / n, Math.sqrt(Math.max(1e-9, q[j] / n - (s0 / n) ** 2))]); })();
function readDraft(v) { const zz = v.map((x, j) => (x - FAVG[j][0]) / FAVG[j][1]), lab = (j) => FACTORS[j][1];
  const order = zz.map((x, j) => [x, j]).sort((a, b) => b[0] - a[0]), strengths = order.filter(([x]) => x >= 0.6).slice(0, 3).map(([, j]) => lab(j)), weak = order.filter(([x]) => x <= -0.6).slice(-3).reverse().map(([, j]) => lab(j));
  const Z = Object.fromEntries(FACTORS.map(([k], j) => [k, zz[j]]));
  const plans = [["Teamfight", Z.teamfight + Z.control + 0.5 * Z.initiation], ["Push", Z.push + 0.5 * Z.objectives], ["Pick-off", Z.control + Z.mobility + 0.5 * Z.damage - 0.5 * Z.teamfight], ["Scale to late game", Z.scaling - Z.tempo], ["Early pressure", Z.tempo + 0.5 * Z.laning]].sort((a, b) => b[1] - a[1]);
  const plan = plans[0][1] > 0.8 ? plans[0][0] : "Balanced";
  const winCon = plan === "Scale to late game" && Z.scaling < 0.3 ? "Wants a long game but has little carry power." : plan === "Push" && Z.push < 0.5 ? "Wants to push but has low tower damage." : plan === "Teamfight" && Z.initiation < -0.5 ? "Wants fights but has no clear initiator." : null;
  return { strengths, weak, plan, winCon, z: Object.fromEntries(Object.entries(Z).map(([k, x]) => [k, Math.round(x * 100) / 100])) }; }

console.log(`settings K ${P.K}, fade ${P.H} days, player blend ${P.w}, new team ${P.r0}, draft weight ${P.dw}${fzOk ? " (frozen)" : " (retuned)"}`);
console.log(`series: Brier ${R.brier.toFixed(4)}, winners ${(R.hit * 100).toFixed(1)}% of ${R.n}; games: Brier ${R.gBrier.toFixed(4)}, with draft ${R.gBrierDraft.toFixed(4)} (${R.nGD} games); Radiant wins ${(R.side * 100).toFixed(1)}%`);

// CALIBRATION TEST: pull single-game chances toward 50% (logit x T), fitted on the first 70% of graded series by date and
// judged on the last 30% (series Brier). Adopted only if it helps on the held-out part.
const GR = R.log.filter((x) => x.warm && !x.s.draw), cut = Math.floor(GR.length * 0.7);
const brierT = (arr, T) => arr.reduce((a, x) => { const p = headline(seriesP(lg(T * logit(x.pg)), x.s.bo)), y = x.s.score[0] > x.s.score[1] ? 1 : 0; return a + (p - y) ** 2; }, 0) / Math.max(1, arr.length);
let bestT = 1; for (let T = 0.6; T <= 1.3001; T += 0.05) if (brierT(GR.slice(0, cut), T) < brierT(GR.slice(0, cut), bestT)) bestT = Math.round(T * 100) / 100;
const heldBase = brierT(GR.slice(cut), 1), heldT = brierT(GR.slice(cut), bestT), T = heldT < heldBase ? bestT : 1;
console.log(`calibration: fitted T ${bestT}, held-out Brier ${heldBase.toFixed(4)} -> ${heldT.toFixed(4)}; ${T !== 1 ? "adopted" : "not adopted"}`);
const cal = (pg) => lg(T * logit(Math.min(0.995, Math.max(0.005, pg))));

// ---------------------------------------------------------------- heroes
const latestPatch = PATCHES.at(-1), patchT = latestPatch ? Date.parse(latestPatch.date) / 1000 : 0;
const recentT = now - 60 * DAY;
const HA = {}; // hero aggregates
const hagg = (id) => (HA[id] ||= { id, all: { n: 0, w: 0, b: 0 }, rec: { n: 0, w: 0, b: 0 }, patch: { n: 0, w: 0, b: 0 }, short: { n: 0, w: 0 }, long: { n: 0, w: 0 }, pos: [0, 0, 0, 0, 0] });
let recGames = 0, patchGames = 0;
for (const g of G) {
  if (g.pick[0].length !== 5) continue; const rec = g.t >= recentT, pt = g.t >= patchT; if (rec) recGames++; if (pt) patchGames++;
  for (const s of [0, 1]) {
    const won = s === 0 ? g.rw : 1 - g.rw;
    for (const h of g.pick[s]) { const a = hagg(h); a.all.n++; a.all.w += won; if (rec) { a.rec.n++; a.rec.w += won; } if (pt) { a.patch.n++; a.patch.w += won; } if (g.dur < 30 * 60) { a.short.n++; a.short.w += won; } else if (g.dur >= 40 * 60) { a.long.n++; a.long.w += won; } }
    for (const h of g.ban[s]) { const a = hagg(h); a.all.b++; if (rec) a.rec.b++; if (pt) a.patch.b++; }
    // position by farm: rank the five by last hits in that game (1 = most)
    const ln = [...g.lines[s]].sort((x, y) => y.lh - x.lh); ln.forEach((l, i) => { if (rec && i < 5) hagg(l.hero).pos[i]++; });
  }
}
const POS = ["Carry", "Mid", "Offlane", "Soft support", "Hard support"];
// Positions by farm rank merge mid and carry (both farm most), so label pos 1-2 "Core (farm)", 3 "Offlane", 4-5 "Support"
const posLabel = (p) => { const tot = p.reduce((a, b) => a + b, 0); if (!tot) return null; const core = (p[0] + p[1]) / tot, off = p[2] / tot, sup = (p[3] + p[4]) / tot; return core >= 0.55 ? "Core" : sup >= 0.55 ? "Support" : off >= 0.4 ? "Offlane" : core > sup ? "Core / flex" : "Support / flex"; };
const DRf = R.DR; DRf.setClock(now);
const heroList = Object.values(HEROES).map((h) => {
  const a = HA[h.id] || hagg(h.id), st = HSTAT[h.id] || {};
  const pres = recGames ? (a.rec.n + a.rec.b) / recGames : 0;
  const pairs = [], vs = [];
  for (const o of Object.values(HEROES)) { if (o.id === h.id) continue;
    const p = DRf.peek(DRf.PR, h.id < o.id ? `${h.id}-${o.id}` : `${o.id}-${h.id}`); if (p.n >= 6) pairs.push({ h: o.id, n: Math.round(p.n), wr: r3(p.w / p.n), s: shr(p.w, p.n, 30) });
    const v = DRf.peek(DRf.VS, `${h.id}>${o.id}`); if (v.n >= 6) vs.push({ h: o.id, n: Math.round(v.n), wr: r3(v.w / v.n), s: shr(v.w, v.n, 30) }); }
  pairs.sort((x, y) => y.s - x.s); vs.sort((x, y) => y.s - x.s);
  return { id: h.id, name: h.name, key: h.key, attr: h.attr, attack: h.attack, roles: h.roles, pos: posLabel(a.pos),
    rec: { pick: a.rec.n, ban: a.rec.b, wr: a.rec.n ? r3(a.rec.w / a.rec.n) : null, pres: r3(pres) },
    patch: { pick: a.patch.n, ban: a.patch.b, wr: a.patch.n ? r3(a.patch.w / a.patch.n) : null, notes: PNOTES?.heroes?.[h.id] || 0 },
    all: { pick: a.all.n, ban: a.all.b, wr: a.all.n ? r3(a.all.w / a.all.n) : null },
    tempo: a.short.n >= 8 && a.long.n >= 8 ? r3(shr(a.short.w, a.short.n) - shr(a.long.w, a.long.n)) : null,
    pub: st.highPick ? { wr: r3(st.highWin / st.highPick), pick: st.highPick, allWr: st.pubPick ? r3(st.pubWin / st.pubPick) : null } : null,
    tier: pres >= 0.4 ? "S" : pres >= 0.2 ? "A" : pres >= 0.08 ? "B" : "C",
    combos: pairs.slice(0, 6).map(({ s, ...x }) => x), beats: vs.slice(0, 6).map(({ s, ...x }) => x), losesTo: vs.slice(-6).reverse().map(({ s, ...x }) => x) };
}).sort((a, b) => b.rec.pres - a.rec.pres);
writeJSON(path.join(OUT, "heroes.json"), heroList);
// Draft lab tables: each hero's shrunk strength, and pairs / counters with at least 4 recent-weighted games
const dl = { heroes: {}, pairs: {}, vs: {}, dw: P.dw, side: r3(logit(R.side)), factors: FACTORS.map(([k, l]) => [k, l]), hvec: HVEC, favg: FAVG.map(([m, sd]) => [r3(m), r3(sd)]), weights: DMODEL.w.map(r3), nx: NX, extra: EXTRA, tags: TAG, cats: CATS, adopted: useFactors, tempo: Object.fromEntries(Object.keys(HEROES).map((id) => [id, r3(DRf.tempo(+id))])), eval: DRAFT_EVAL };
for (const h of heroList) { const s = DRf.peek(DRf.H, h.id); dl.heroes[h.id] = r3(logit(shr(s.w, s.n, 20))); }
for (const [k] of DRf.PR) { const s = DRf.peek(DRf.PR, k); if (s.n >= 4) dl.pairs[k] = r3(logit(shr(s.w, s.n, 30))); }
for (const [k] of DRf.VS) { const s = DRf.peek(DRf.VS, k); if (s.n >= 4) dl.vs[k] = r3(logit(shr(s.w, s.n, 30))); }
writeJSON(path.join(OUT, "draft.json"), dl);

// ---------------------------------------------------------------- players
const PA = {};
for (const g of G) for (const s of [0, 1]) { const won = s === 0 ? g.rw : 1 - g.rw, ranked = [...g.lines[s]].sort((x, y) => y.lh - x.lh);
  for (const l of g.lines[s]) { if (!l.acc) continue; const p = (PA[l.acc] ||= { id: l.acc, n: 0, w: 0, k: 0, d: 0, a: 0, gpm: 0, heroes: {}, team: null, last: 0, farm: [0, 0, 0, 0, 0] });
    p.n++; p.w += won; p.k += l.k; p.d += l.d; p.a += l.a; p.gpm += l.gpm; const h = (p.heroes[l.hero] ||= { n: 0, w: 0 }); h.n++; h.w += won; if (g.t >= p.last) { p.last = g.t; p.team = g.team[s]; } p.farm[ranked.indexOf(l)]++; } }
const pname = (acc) => PLAYERS[acc]?.name || null;
const roleOf = (f) => { const tot = f.reduce((a, b) => a + b, 0); if (!tot) return null; const i = f.indexOf(Math.max(...f)); return ["Core (pos 1)", "Core (pos 2)", "Offlane (pos 3)", "Support (pos 4)", "Support (pos 5)"][i]; };
const playersOut = Object.values(PA).filter((p) => p.n >= 10 && p.last > now - 180 * DAY).map((p) => ({ id: p.id, name: pname(p.id) || `Player ${p.id}`, named: !!pname(p.id), team: tname(p.team), teamId: p.team, country: PLAYERS[p.id]?.country || null,
  games: p.n, wr: r3(p.w / p.n), kda: r1((p.k + p.a) / Math.max(1, p.d)), k: r1(p.k / p.n), d: r1(p.d / p.n), a: r1(p.a / p.n), gpm: Math.round(p.gpm / p.n), role: roleOf(p.farm), rating: r3(R.PRt.get(p.id)?.r ?? 0),
  top: Object.entries(p.heroes).map(([h, v]) => ({ h: +h, n: v.n, wr: r3(v.w / v.n) })).sort((a, b) => b.n - a.n).slice(0, 8) })).sort((a, b) => b.games - a.games);
writeJSON(path.join(OUT, "players.json"), playersOut);

// ---------------------------------------------------------------- teams
const teamSeries = new Map(); for (const s of series) for (const id of [s.a, s.b]) (teamSeries.get(id) || teamSeries.set(id, []).get(id)).push(s);
const teamRating = (id) => { const T = R.TR.get(id); if (!T) return null; const f = Math.exp(-(now - T.last) / (P.H * DAY)); return P.r0 + (T.r - P.r0) * f; };
const lineupRating = (id) => { const T = R.TR.get(id); if (!T) return null; const tr = teamRating(id); if (!P.w || !T.lineup) return tr; const pr = T.lineup.reduce((a, acc) => { const x = R.PRt.get(acc); return a + (x ? P.r0 + (x.r - P.r0) * Math.exp(-(now - x.last) / (P.H * DAY)) : P.r0); }, 0) / 5; return (1 - P.w) * tr + P.w * pr; };
const elo = (r) => Math.round(1500 + (r ?? 0) * 173.7); // logit points shown on the familiar 1500 scale
function profile(id) {
  const gs = G.filter((g) => g.team.includes(id) && g.t > now - 120 * DAY), use = gs.length >= 6 ? gs : G.filter((g) => g.team.includes(id)).slice(-15);
  const picks = {}, bansBy = {}, bansVs = {}; let rad = [0, 0], dire = [0, 0], short = [0, 0], long = [0, 0], dur = 0;
  for (const g of use) { const s = g.team.indexOf(id), won = s === 0 ? g.rw : 1 - g.rw; for (const h of g.pick[s]) { const x = (picks[h] ||= { n: 0, w: 0 }); x.n++; x.w += won; }
    for (const h of g.ban[s]) bansBy[h] = (bansBy[h] || 0) + 1; for (const h of g.ban[1 - s]) bansVs[h] = (bansVs[h] || 0) + 1;
    (s === 0 ? rad : dire)[0] += won; (s === 0 ? rad : dire)[1]++; if (g.dur < 30 * 60) { short[0] += won; short[1]++; } else if (g.dur >= 40 * 60) { long[0] += won; long[1]++; } dur += g.dur; }
  const comfort = Object.entries(picks).map(([h, v]) => ({ h: +h, n: v.n, wr: r3(v.w / v.n) })).sort((a, b) => b.n - a.n || b.wr - a.wr).slice(0, 8);
  const top = (o) => Object.entries(o).map(([h, n]) => ({ h: +h, n })).sort((a, b) => b.n - a.n).slice(0, 6);
  // signature hero effect: record with vs without its most-played hero (shrunk), for "if it is banned"
  let signature = null; const sig = comfort[0];
  if (sig && sig.n >= 5) { const all = G.filter((g) => g.team.includes(id) && g.t > now - 200 * DAY), w = [0, 0], wo = [0, 0];
    for (const g of all) { const s = g.team.indexOf(id), won = s === 0 ? g.rw : 1 - g.rw, x = g.pick[s].includes(sig.h) ? w : wo; x[0] += won; x[1]++; }
    signature = { hero: sig.h, with: w, without: wo, effect: r3(shr(w[0], w[1]) - shr(wo[0], wo[1])), banned: bansVs[sig.h] || 0 }; }
  const ob = { fb: [0, 0], torm: [0, 0], rosh: [0, 0], tower: [0, 0], hg: [0, 0], fbMin: [] }; for (const g of use) { const sd = g.team.indexOf(id), won = sd === 0 ? g.rw : 1 - g.rw, o = g.obj || {}; for (const [k, key] of [["F", "fb"], ["T", "torm"], ["R", "rosh"], ["W", "tower"]]) if (o[k]) { ob[key][1]++; if (o[k].side === sd) ob[key][0]++; } if (o.F && o.F.side === sd) ob.fbMin.push(o.F.t); if (o.X && o.X.side !== sd) { ob.hg[1]++; ob.hg[0] += won; } }
  ob.fbMin = ob.fbMin.length ? Math.round(ob.fbMin.sort((a, b) => a - b)[Math.floor(ob.fbMin.length / 2)] / 6) / 10 : null;
  return { obj: ob, games: use.length, comfort, bansBy: top(bansBy), bansVs: top(bansVs), radiant: rad, dire, short, long, avgMin: use.length ? Math.round(dur / use.length / 60) : null, signature };
}
function rosterOf(id) {
  const T = R.TR.get(id); if (!T?.lineup) return [];
  const gs = G.filter((g) => g.team.includes(id)).slice(-12);
  return T.lineup.map((acc) => { const f = [0, 0, 0, 0, 0]; for (const g of gs) { const s = g.team.indexOf(id), rk = [...g.lines[s]].sort((x, y) => y.lh - x.lh).findIndex((l) => l.acc === acc); if (rk >= 0) f[rk]++; }
    return { id: acc, name: pname(acc) || `Player ${acc}`, role: roleOf(f), pos: f.indexOf(Math.max(...f)) + 1, country: PLAYERS[acc]?.country || null }; }).sort((a, b) => a.pos - b.pos);
}
const active = [...R.TR.entries()].filter(([id, T]) => T.n >= WARM && T.last > now - 120 * DAY);
const ranked = active.map(([id]) => ({ id, r: lineupRating(id) })).sort((a, b) => b.r - a.r);
const rankOf = new Map(ranked.map((x, i) => [x.id, i + 1]));
const leagueName = (id) => LEAGUES[id]?.name || `League ${id}`;
const teamsOut = active.map(([id, T]) => { const ss = (teamSeries.get(id) || []).filter((s) => s.complete), last10 = ss.slice(-10), won = (s) => (s.a === id ? s.score[0] > s.score[1] : s.score[1] > s.score[0]);
  const gm = G.filter((g) => g.team.includes(id) && g.t > now - 120 * DAY), gw = gm.filter((g) => (g.rw ? g.r : g.d) === id).length;
  return { id, name: tname(id), tag: TEAMS[id]?.tag || null, logo: TEAMS[id]?.logo || null, elo: elo(lineupRating(id)), rank: rankOf.get(id), games: gm.length, wr: gm.length ? r3(gw / gm.length) : null,
    form: last10.map((s) => (s.draw ? "D" : won(s) ? "W" : "L")).join(""), lastLeague: leagueName(ss.at(-1)?.league), last: new Date(T.last * 1000).toISOString() }; }).sort((a, b) => a.rank - b.rank);
writeJSON(path.join(OUT, "teams.json"), teamsOut);
const fileId = (id) => String(id);

// ---------------------------------------------------------------- series pages and results (walk-forward record)
const seriesRow = (x) => { const s = x.s, p = cal(x.pg), sp = seriesP(p, s.bo), pa = headline(sp), y = s.score[0] > s.score[1];
  return { id: s.key, date: new Date(s.t * 1000).toISOString(), league: leagueName(s.league), bo: s.bo, a: tname(s.a), b: tname(s.b), aId: s.a, bId: s.b, score: s.score, p: r3(pa),
    graded: x.warm && !s.draw, draw: s.draw, close: Math.abs(pa - 0.5) < 0.1, right: (pa >= 0.5) === y }; };
const graded = R.log.filter((x) => x.warm && !x.s.draw);
const res = R.log.slice(-400).reverse().map(seriesRow);
writeJSON(path.join(OUT, "results.json"), res);
// series pages: every game with both drafts, side, length, our pre-game chance and the draft layer's chance
const gIndex = new Map(R.glog.map((x) => [x.g.id, x]));
for (const x of R.log.slice(-400)) { const s = x.s;
  writeJSON(path.join(OUT, "series", `${s.key}.json`), { ...seriesRow(x), elo: [elo(x.ra), elo(x.rb)], games: s.games.map((g) => { const gl = gIndex.get(g.id), aSide = g.r === s.a ? 0 : 1, flip = (v) => (v == null ? null : r3(aSide === 0 ? v : 1 - v));
    return { id: g.id, aSide: aSide === 0 ? "Radiant" : "Dire", obj: Object.fromEntries(Object.entries({ fb: "F", torm: "T", rosh: "R", tower: "W", rax: "X" }).filter(([, k]) => g.obj?.[k]).map(([n, k]) => [n, { a: (g.obj[k].side === 0) === (aSide === 0), min: Math.round(g.obj[k].t / 60) }])), winA: (g.rw ? g.r : g.d) === s.a, min: Math.round(g.dur / 60), pA: flip(gl?.p), pDraftA: flip(gl?.pd), draft: gl?.fv ? (() => { const part = draftPart(DMODEL, gl), pa0 = lg(part), ckR = checklist(g.pick[0], g.pick[1]), ckD = checklist(g.pick[1], g.pick[0]); return { pA: r3(aSide === 0 ? pa0 : 1 - pa0), readA: readDraft(aSide === 0 ? gl.fr : gl.fd), readB: readDraft(aSide === 0 ? gl.fd : gl.fr), ckA: aSide === 0 ? ckR : ckD, ckB: aSide === 0 ? ckD : ckR }; })() : null,
      pickA: g.pick[aSide], pickB: g.pick[1 - aSide], banA: g.ban[aSide], banB: g.ban[1 - aSide], order: g.order.map(([p, sd, h]) => [p, sd === aSide ? "a" : "b", h]),
      playersA: g.lines[aSide].map((l) => ({ id: l.acc, n: pname(l.acc), h: l.hero, k: l.k, d: l.d, a: l.a, gpm: l.gpm })), playersB: g.lines[1 - aSide].map((l) => ({ id: l.acc, n: pname(l.acc), h: l.hero, k: l.k, d: l.d, a: l.a, gpm: l.gpm })) }; }) }); }

// ---------------------------------------------------------------- accuracy
function bucketTable(rows) { const B = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]]; return B.map(([lo, hi]) => { const r = rows.filter((x) => Math.max(x.p, 1 - x.p) >= lo && Math.max(x.p, 1 - x.p) < hi); const hit = r.filter((x) => (x.p >= 0.5) === x.y).length;
  return { lo, hi: Math.min(hi, 1), n: r.length, hit, said: r.length ? r3(r.reduce((a, x) => a + Math.max(x.p, 1 - x.p), 0) / r.length) : null, real: r.length ? r3(hit / r.length) : null }; }); }
const gRows = graded.map((x) => ({ p: headline(seriesP(cal(x.pg), x.s.bo)), y: x.s.score[0] > x.s.score[1], bo: x.s.bo, t: x.s.t, tier: LEAGUES[x.s.league]?.tier }));
const summ = (rows) => { const n = rows.length, hit = rows.filter((x) => (x.p >= 0.5) === x.y).length, picks = rows.filter((x) => Math.abs(x.p - 0.5) >= 0.1), ph = picks.filter((x) => (x.p >= 0.5) === x.y).length;
  return { n, hit, rate: n ? r3(hit / n) : null, brier: n ? r3(rows.reduce((a, x) => a + (x.p - (x.y ? 1 : 0)) ** 2, 0) / n) : null, picks: picks.length, pickHit: ph, pickRate: picks.length ? r3(ph / picks.length) : null }; };
const last90 = gRows.filter((x) => x.t > now - 90 * DAY);
const gd = R.glog.filter((x) => x.pd != null && x.g.t > now - 365 * DAY);
const accuracy = { draft: DRAFT_EVAL, overall: summ(gRows), last90: summ(last90), byBo: Object.fromEntries([1, 2, 3, 5].map((b) => [b, summ(gRows.filter((x) => x.bo === b))])), byTier: { premium: summ(gRows.filter((x) => x.tier === "premium")), professional: summ(gRows.filter((x) => x.tier === "professional")) },
  buckets: bucketTable(gRows), last90Buckets: bucketTable(last90),
  games: { n: gd.length, brier: r3(gd.reduce((a, x) => a + (x.p - x.g.rw) ** 2, 0) / Math.max(1, gd.length)), brierDraft: r3(gd.reduce((a, x) => a + (x.pd - x.g.rw) ** 2, 0) / Math.max(1, gd.length)), hit: r3(gd.filter((x) => (x.p >= 0.5) === (x.g.rw === 1)).length / Math.max(1, gd.length)), hitDraft: r3(gd.filter((x) => (x.pd >= 0.5) === (x.g.rw === 1)).length / Math.max(1, gd.length)) },
  calibration: { fittedT: bestT, used: T, heldBase: r3(heldBase), heldT: r3(heldT), held: GR.length - cut }, params: P, side: r3(R.side) };

// ---------------------------------------------------------------- upcoming (Liquipedia schedule -> our team ids)
const nk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const strip = (s) => nk(String(s || "").replace(/\b(team|esports?|gaming|club|e-?sports)\b/gi, ""));
const lastSeen = (id) => R.TR.get(+id)?.last || 0;
function findTeam(o) {
  const all = Object.values(TEAMS), byRecent = (arr) => arr.sort((a, b) => lastSeen(b.id) - lastSeen(a.id))[0];
  let c = all.filter((t) => nk(t.name) === nk(o.name) || nk(t.name) === nk(String(o.page || "").replace(/_/g, " "))); if (c.length) return byRecent(c);
  c = all.filter((t) => strip(t.name) && strip(t.name) === strip(o.name)); if (c.length) return byRecent(c);
  if (o.short && o.short.length >= 3) { c = all.filter((t) => t.tag && nk(t.tag) === nk(o.short) && lastSeen(t.id) > now - 90 * DAY); if (c.length === 1 && (strip(c[0].name).includes(strip(o.name).slice(0, 4)) || strip(o.name).includes(strip(c[0].name).slice(0, 4)))) return c[0]; }
  return null;
}
const PRE_F = path.join(D, "pretip.json"), PRE = readJSON(PRE_F, { entries: {} });
const sid = (s) => String(s).replace(/[^A-Za-z0-9]+/g, "_");
const h2h = (a, b) => series.filter((s) => s.complete && ((s.a === a && s.b === b) || (s.a === b && s.b === a))).slice(-6).reverse().map((s) => ({ date: new Date(s.t * 1000).toISOString(), league: leagueName(s.league), score: s.a === a ? s.score : [s.score[1], s.score[0]], id: s.key }));
// KILLS AND DURATION (per game): each team's pace, learned game by game from earlier games only: kills it scores, kills it
// gives up and how long its games last (moving averages pulled toward the pro average), plus the rating gap for the kill
// handicap. Lines are TYPICAL MAIN LINES (no sportsbook feed is open to us): total kills and duration at the pro median of
// the last 60 days (x.5), each team's kills at half the total, and the kill handicap from the rating gap at average pace.
// Fitted on the first 70% of games by date and judged on the last 30%.
const kOf = (g, s) => g.lines[s].reduce((a, l) => a + (l.k || 0), 0);
const KG = G.filter((g) => g.lines[0].length === 5 && g.lines[1].length === 5 && g.dur > 600);
const Phi = (z) => 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
function paceReplay(alpha, k0, record) {
  const T = new Map(), glob = { k: 26, d: 38 * 60 }, rows = [];
  const tm = (id) => T.get(id) || T.set(id, { kf: glob.k / 2, ka: glob.k / 2, d: glob.d, n: 0 }).get(id);
  for (const g of KG) { const A = tm(g.r), B = tm(g.d), wA = A.n / (A.n + k0), wB = B.n / (B.n + k0), half = glob.k / 2;
    const eA = half + wA * (A.kf - half) / 2 + wB * (B.ka - half) / 2, eB = half + wB * (B.kf - half) / 2 + wA * (A.ka - half) / 2, eD = glob.d + (wA * (A.d - glob.d) + wB * (B.d - glob.d)) / 2;
    const ka = kOf(g, 0), kb = kOf(g, 1); if (record) rows.push({ g, eA, eB, eD, ka, kb, d: g.dur });
    for (const [X, kf, ka2] of [[A, ka, kb], [B, kb, ka]]) { X.kf += alpha * (kf - X.kf); X.ka += alpha * (ka2 - X.ka); X.d += alpha * (g.dur - X.d); X.n++; }
    glob.k += 0.01 * (ka + kb - glob.k); glob.d += 0.01 * (g.dur - glob.d); }
  return { T, glob, rows };
}
let PB = null; { const cutK = Math.floor(KG.length * 0.7);
  for (const alpha of [0.08, 0.15, 0.25]) for (const k0 of [3, 8, 20]) { const r = paceReplay(alpha, k0, true).rows.slice(0, cutK); const mse = r.reduce((a, x) => a + (x.eA + x.eB - x.ka - x.kb) ** 2 + ((x.eD - x.d) / 60) ** 2, 0) / r.length; if (!PB || mse < PB.mse) PB = { alpha, k0, mse }; } }
const PACE = paceReplay(PB.alpha, PB.k0, true), PR_ = PACE.rows, cutK = Math.floor(PR_.length * 0.7);
// rating effect on the kill margin: margin = b * pre-game logit (Radiant view), fitted on the first 70%
const plog = (g) => { const x = gIndex.get(g.id); return x ? logit(Math.min(0.99, Math.max(0.01, x.p))) : 0; };
const KB = (() => { let sxy = 0, sxx = 0; for (const x of PR_.slice(0, cutK)) { const l = plog(x.g); sxy += l * (x.ka - x.kb - (x.eA - x.eB)); sxx += l * l; } return sxx ? sxy / sxx : 0; })();
const sdOf = (f) => Math.sqrt(PR_.slice(0, cutK).reduce((a, x) => a + f(x) ** 2, 0) / Math.max(1, cutK));
const SD = { tot: sdOf((x) => x.eA + x.eB - x.ka - x.kb), team: sdOf((x) => x.eA - x.ka), mar: sdOf((x) => x.eA - x.eB + KB * plog(x.g) - (x.ka - x.kb)), dur: sdOf((x) => (x.eD - x.d) / 60) };
const recentK = KG.filter((g) => g.t > now - 60 * DAY), med = (arr) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const LINE = { tot: Math.floor(med(recentK.map((g) => kOf(g, 0) + kOf(g, 1)))) + 0.5, dur: Math.floor(med(recentK.map((g) => g.dur / 60))) + 0.5 }; LINE.team = Math.floor(LINE.tot / 2) + 0.5;
// one game's markets, Team A's view: expected kills each, total, margin and minutes, and our chance at each typical line
function gameMarkets(eA, eB, eD, lA, nameA, nameB) {
  const mar = eA - eB + KB * lA, hcLine = Math.floor(Math.abs(KB * lA)) + 0.5, favA = lA >= 0, P = (mu, line, sd) => 1 - Phi((line - mu) / sd);
  const pTot = P(eA + eB, LINE.tot, SD.tot), pA = P(eA, LINE.team, SD.team), pB = P(eB, LINE.team, SD.team), pD = P(eD / 60, LINE.dur, SD.dur), pH = favA ? P(mar, hcLine, SD.mar) : 1 - P(mar, -hcLine, SD.mar);
  const ou = (p, line, what) => ({ pick: `${p >= 0.5 ? "Over" : "Under"} ${line} ${what}`, over: p >= 0.5, line, p: r3(Math.max(p, 1 - p)) });
  return { exp: { killsA: r1(eA), killsB: r1(eB), total: r1(eA + eB), margin: r1(mar), minutes: r1(eD / 60) },
    totalKills: ou(pTot, LINE.tot, "total kills"), killsA: { ...ou(pA, LINE.team, `${nameA} kills`), team: "a" }, killsB: { ...ou(pB, LINE.team, `${nameB} kills`), team: "b" },
    killHcap: { pick: pH >= 0.5 ? `${favA ? nameA : nameB} -${hcLine} kills` : `${favA ? nameB : nameA} +${hcLine} kills`, fav: favA ? "a" : "b", line: hcLine, takeFav: pH >= 0.5, p: r3(Math.max(pH, 1 - pH)) },
    duration: ou(pD, LINE.dur, "minutes") };
}
// held-out test per market at the typical lines
const KTEST = (() => { const out = {}; const add = (k, p, won) => { const o = (out[k] ||= { n: 0, hit: 0, b: 0, picks: 0, pickHit: 0 }); o.n++; if (won) o.hit++; o.b += (p - (won ? 1 : 0)) ** 2; if (p >= 0.55) { o.picks++; if (won) o.pickHit++; } };
  for (const x of PR_.slice(cutK)) { const l = plog(x.g), M = gameMarkets(x.eA, x.eB, x.eD, l, "A", "B"), tot = x.ka + x.kb, mar = x.ka - x.kb, mins = x.d / 60;
    add("totalKills", M.totalKills.p, M.totalKills.over === tot > LINE.tot); add("teamKills", M.killsA.p, M.killsA.over === x.ka > LINE.team); add("teamKills", M.killsB.p, M.killsB.over === x.kb > LINE.team);
    const favMar = M.killHcap.fav === "a" ? mar : -mar; add("killHcap", M.killHcap.p, M.killHcap.takeFav === favMar > M.killHcap.line); add("duration", M.duration.p, M.duration.over === mins > LINE.dur); }
  for (const o of Object.values(out)) { o.rate = r3(o.hit / o.n); o.brier = r3(o.b / o.n); o.pickRate = o.picks ? r3(o.pickHit / o.picks) : null; delete o.b; } return out; })();
console.log(`kills/duration: pace ${PB.alpha}/${PB.k0}, lines total ${LINE.tot} team ${LINE.team} dur ${LINE.dur}, margin b ${KB.toFixed(2)}; held-out ${Object.entries(KTEST).map(([k, o]) => `${k} ${o.pickHit}/${o.picks} picks (${o.pickRate})`).join(", ")}`);
const nextMarkets = (Aid, Bid, pg, nameA, nameB) => { const A = PACE.T.get(Aid), B = PACE.T.get(Bid); if (!A || !B) return null; const glob = PACE.glob, half = glob.k / 2, wA = A.n / (A.n + PB.k0), wB = B.n / (B.n + PB.k0);
  const eA = half + wA * (A.kf - half) / 2 + wB * (B.ka - half) / 2, eB = half + wB * (B.kf - half) / 2 + wA * (A.ka - half) / 2, eD = glob.d + (wA * (A.d - glob.d) + wB * (B.d - glob.d)) / 2; return gameMarkets(eA, eB, eD, logit(Math.min(0.99, Math.max(0.01, pg))), nameA, nameB); };
// PICK EXPLANATIONS: for every pick on a match page, the reasons with their numbers and where each number comes from.
// Only facts our data supports; anything uncertain is labelled as such. Rebuilt every run (and so between games).
const pctS = (x) => `${Math.round(x * 100)}%`;
function usualFive(id) { const gs = G.filter((g) => g.team.includes(id)).slice(-15), cnt = {}; for (const g of gs) for (const l of g.lines[g.team.indexOf(id)]) cnt[l.acc] = (cnt[l.acc] || 0) + 1; return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => +a); }
function standIns(id) { const T = R.TR.get(id); if (!T?.lineup) return []; const usual = new Set(usualFive(id)); return T.lineup.filter((a) => !usual.has(a)).map((a) => pname(a) || `player ${a}`); }
const bucketHit = (p) => { const b = accuracy.buckets.find((x) => Math.max(p, 1 - p) >= x.lo && Math.max(p, 1 - p) < x.hi); return b && b.n ? `When we have said ${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}% before, it happened ${pctS(b.real)} of the time (${b.n} past series, walk-forward back-test).` : null; };
function explainMatch(up, A, B, pa, pb, mk) {
  const an = up.a.name, bn = up.b.name, fav = up.pSeries >= 0.5 ? "a" : "b", F = fav === "a" ? an : bn, U = fav === "a" ? bn : an, FS = fav === "a" ? up.a : up.b, US = fav === "a" ? up.b : up.a, fp = fav === "a" ? pa : pb, upf = fav === "a" ? pb : pa;
  const base = [];
  if (FS.elo && US.elo) base.push(`Rating ${F} ${FS.elo} (#${FS.rank ?? "-"}) against ${U} ${US.elo} (#${US.rank ?? "-"}): ratings come from each of the five players' results in every pro game of the last 400 days (OpenDota).`);
  if (FS.form || US.form) base.push(`Last five series: ${F} ${FS.form || "-"}, ${U} ${US.form || "-"} (W win, L loss, D draw).`);
  for (const [t, T0] of [[an, A], [bn, B]]) { const si = T0 ? standIns(+T0.id) : []; if (si.length) base.push(`${t} fielded ${si.join(", ")} last game, not one of their usual five (last 15 games): ratings follow the players who played, so this is already in the chance, but a stand-in adds uncertainty.`); }
  if (up.h2h.length) { const w = up.h2h.filter((x) => (fav === "a" ? x.score[0] > x.score[1] : x.score[1] > x.score[0])).length; base.push(`Head-to-head: ${F} won ${w} of the last ${up.h2h.length} meetings (last 400 days).`); }
  const risks = [];
  if (!up.known) risks.push("A team has fewer than 8 games in our data, so its rating is a starting guess.");
  if (fp?.signature && fp.signature.effect > 0.05) risks.push(`${F} are ${fp.signature.with[0]}-${fp.signature.with[1] - fp.signature.with[0]} with ${hname(fp.signature.hero)} and ${fp.signature.without[0]}-${fp.signature.without[1] - fp.signature.without[0]} without it (last 200 days): a ban on it hurts them.`);
  if (patchGames < 300) risks.push(`Patch ${latestPatch?.patch} is new (${patchGames} pro games so far): hero strengths are still settling.`);
  if (Math.abs(up.pSeries - 0.5) < 0.1) risks.push("Close to a coin flip: under 60%, so we do not count it as a pick.");
  const draftPts = [];
  for (const [t, L] of [[an, up.likelyA], [bn, up.likelyB]]) if (L) draftPts.push(`${t}'s five most-played heroes read as "${L.plan}"${L.strengths.length ? `, strong in ${L.strengths.join(", ").toLowerCase()}` : ""}${L.weak.length ? `, weak in ${L.weak.join(", ").toLowerCase()}` : ""} (hero traits from pro games, OpenDota and Valve). A guide to style, not the real draft.`);
  for (const [t, p0] of [[an, pa], [bn, pb]]) if (p0?.comfort?.length) { const blink = p0.comfort.filter((c) => TAG[c.h]?.blink != null).map((c) => `${hname(c.h)} (~${TAG[c.h].blink} min)`), bkb = p0.comfort.filter((c) => TAG[c.h]?.bkb != null).map((c) => `${hname(c.h)} (~${TAG[c.h].bkb} min)`);
    if (blink.length || bkb.length) draftPts.push(`${t} item timings on their comfort heroes (median pro purchase, OpenDota): ${blink.length ? `Blink ${blink.slice(0, 3).join(", ")}` : ""}${blink.length && bkb.length ? "; " : ""}${bkb.length ? `BKB ${bkb.slice(0, 3).join(", ")}` : ""}.`); }
  const objPts = []; for (const [t, p0] of [[an, pa], [bn, pb]]) { const o = p0?.obj; if (o && o.torm[1]) objPts.push(`${t} in their last ${p0.games} games: first tower ${pctS(o.tower[0] / Math.max(1, o.tower[1]))}, first Tormentor ${pctS(o.torm[0] / Math.max(1, o.torm[1]))}, first Roshan ${pctS(o.rosh[0] / Math.max(1, o.rosh[1]))}, first blood ${pctS(o.fb[0] / Math.max(1, o.fb[1]))}. Across pro games the team taking the first Roshan wins about three in four.`); }
  const E = {}, line = (s0, p, label) => ({ title: label, pick: s0.pick, p: s0.p, fair: (1 / s0.p).toFixed(2) });
  E.ml = { title: "Series winner", pick: `${F} to win the series`, p: r3(Math.max(up.pSeries, 1 - up.pSeries)), short: `${F} rate higher on the five players' results${FS.form ? ` and come in ${FS.form}` : ""}.`, points: [...base, ...draftPts, ...objPts, bucketHit(up.pSeries)].filter(Boolean), risks };
  const sc = up.scores, games = (k) => k.split("-").reduce((x, y) => +x + +y, 0);
  if (up.bo === 3 || up.bo === 5) { const sweep = fav === "a" ? (up.bo === 3 ? sc["2-0"] : sc["3-0"] + sc["3-1"]) : (up.bo === 3 ? sc["0-2"] : sc["0-3"] + sc["1-3"]);
    E.hcap = { title: "Map handicap", pick: sweep >= 0.5 ? `${F} -1.5 maps` : `${U} +1.5 maps`, p: r3(Math.max(sweep, 1 - sweep)), short: `${F} win ${pctS(Math.max(up.pGame, 1 - up.pGame))} of single games in our model; ${up.bo === 3 ? "a 2-0" : "winning by 2+"} needs it ${up.bo === 3 ? "twice in a row" : "often"}.`, points: [`Single-game chance ${F} ${pctS(Math.max(up.pGame, 1 - up.pGame))} on a neutral side; the exact-score split comes from the best-of math.`, `Most likely score: ${Object.entries(sc).sort((a, b) => b[1] - a[1])[0][0]} (${pctS(Object.entries(sc).sort((a, b) => b[1] - a[1])[0][1])}).`, ...base.slice(0, 2)], risks: [...risks, "Map handicaps lose to a single upset game."] };
    const tl = up.bo === 3 ? 2.5 : 4.5, over = Object.entries(sc).reduce((x, [k, v]) => x + (games(k) > tl ? v : 0), 0);
    E.total = { title: "Total maps", pick: `${over >= 0.5 ? "Over" : "Under"} ${tl} maps`, p: r3(Math.max(over, 1 - over)), short: over >= 0.5 ? "The teams are close enough that a deciding map is likely." : `${F} are favoured enough that the series often ends early.`, points: [`About ${up.expMaps} maps expected.`, `Single-game chance ${pctS(Math.max(up.pGame, 1 - up.pGame))} for ${F}: the closer to 50%, the more maps.`], risks: ["Day-to-day form swings make sweeps more common than the plain math says."] }; }
  if (mk) { const pA = A && PACE.T.get(+A.id), pB = B && PACE.T.get(+B.id), paceTxt = `${an} average ${r1(pA?.kf ?? 0)} kills for and ${r1(pA?.ka ?? 0)} against, games about ${r1((pA?.d ?? 0) / 60)} min; ${bn} ${r1(pB?.kf ?? 0)} for, ${r1(pB?.ka ?? 0)} against, about ${r1((pB?.d ?? 0) / 60)} min (recent games weighted more, OpenDota).`;
    const kt = (k) => KTEST[k] && KTEST[k].picks ? `Tested on ${KTEST[k].n.toLocaleString("en-US")} newer games: ${KTEST[k].pickHit} of ${KTEST[k].picks} picks at 55%+ were right (${pctS(KTEST[k].pickRate)}).` : null;
    const tempo = [up.likelyA, up.likelyB].map((L, i) => (L ? `${i ? bn : an} lean ${L.z.tempo > 0.3 ? "early" : L.z.tempo < -0.3 ? "late" : "neither early nor late"} on their comfort heroes (power curve from pro results)` : null)).filter(Boolean).join("; ");
    E.totalKills = { title: "Total kills", pick: mk.totalKills.pick, p: mk.totalKills.p, short: `We expect about ${mk.exp.total} kills against a typical line of ${LINE.tot}.`, points: [paceTxt, `Projection: ${an} ${mk.exp.killsA}, ${bn} ${mk.exp.killsB} kills.`, tempo ? `${tempo}.` : null, `Typical line ${LINE.tot}: the median total in pro games of the last 60 days.`, kt("totalKills")].filter(Boolean), risks: ["Kill totals swing a lot game to game (spread about ±" + Math.round(SD.tot) + " kills)."] };
    E.killsA = { title: `${an} kills`, pick: mk.killsA.pick, p: mk.killsA.p, short: `${an} projected ${mk.exp.killsA} kills against a typical team line of ${LINE.team}.`, points: [paceTxt, kt("teamKills")].filter(Boolean), risks: ["One-sided games inflate the winner's kills."] };
    E.killsB = { title: `${bn} kills`, pick: mk.killsB.pick, p: mk.killsB.p, short: `${bn} projected ${mk.exp.killsB} kills against a typical team line of ${LINE.team}.`, points: [paceTxt, kt("teamKills")].filter(Boolean), risks: ["One-sided games inflate the winner's kills."] };
    E.killHcap = { title: "Kill handicap", pick: mk.killHcap.pick, p: mk.killHcap.p, short: `Projected kill margin ${mk.exp.margin > 0 ? an : bn} +${Math.abs(mk.exp.margin)}; line ${mk.killHcap.line}.`, points: [`The line is set from the rating gap at average pace (each logit point of pre-game edge is worth about ${Math.abs(KB).toFixed(1)} kills in pro games).`, paceTxt, kt("killHcap")].filter(Boolean), risks: ["Comebacks and throw games flip kill margins."] };
    E.duration = { title: "Game duration", pick: mk.duration.pick, p: mk.duration.p, short: `We expect about ${mk.exp.minutes} min against a typical line of ${LINE.dur}.`, points: [paceTxt, tempo ? `${tempo}.` : null, `Typical line ${LINE.dur} min: the median pro game of the last 60 days.`, kt("duration")].filter(Boolean), risks: ["Lopsided games end early; close ones run long."] }; }
  return E;
}
// LIVE SERIES: games already played in a scheduled series (from our match file and OpenDota's latest results), the game
// being played now (OpenDota live), the score, each game's pre-game chance and result, and the series chance from the score.
const LIVE = readJSON(path.join(ROOT, "live", "dota2.json"), { live: [], recent: [] });
const remainP = (p, a, b, bo) => { if (bo === 2) { const left = 2 - a - b; if (left <= 0) return a > b ? 1 : a === b ? 0.5 : 0; if (left === 1) return a === 1 ? p + (1 - p) * 0.5 : p * 0.5; return p * p + p * (1 - p); }
  const need = Math.ceil(bo / 2); if (a >= need) return 1; if (b >= need) return 0; return p * remainP(p, a + 1, b, bo) + (1 - p) * remainP(p, a, b + 1, bo); };
function seriesState(Aid, Bid, start, bo, pg) {
  const pair = (r, d) => (r === Aid && d === Bid) || (r === Bid && d === Aid), seen = new Set(), games = [];
  for (const g of G) if (pair(g.r, g.d) && g.t >= start - 7200 && g.t <= start + 36000) { seen.add(g.id); games.push({ id: g.id, t: g.t, r: g.r, rw: g.rw, dur: g.dur, pick: g.pick, kr: kOf(g, 0), kd: kOf(g, 1), src: "match" }); }
  for (const m of LIVE.recent || []) if (!seen.has(m.id) && pair(m.r, m.d) && m.start >= start - 7200 && m.start <= start + 36000) { seen.add(m.id); games.push({ id: m.id, t: m.start, r: m.r, rw: m.rw, dur: m.dur, pick: null, kr: m.rk ?? null, kd: m.dk ?? null, src: "recent" }); }
  games.sort((a, b) => a.t - b.t);
  const sideL = logit(R.side), need = bo === 2 ? 2 : Math.ceil(bo / 2), out = []; let a = 0, b = 0;
  for (const g of games) { const aRad = g.r === Aid, gl = gIndex.get(g.id), pre = gl ? (aRad ? gl.p : 1 - gl.p) : cal(lg(logit(pg) + (aRad ? sideL : -sideL)));
    const draft = g.pick && g.pick[0].length === 5 ? cal(lg(logit(pre) + (aRad ? 1 : -1) * P.dw * DRf.logitOf(g.pick[0], g.pick[1]))) : null, aWon = (g.rw === 1) === aRad;
    if (aWon) a++; else b++; out.push({ n: out.length + 1, id: g.id, status: "done", aSide: aRad ? "Radiant" : "Dire", pA: r3(pre), pDraftA: draft != null ? r3(draft) : null, aWon, min: Math.round((g.dur || 0) / 60), hit: (pre >= 0.5) === aWon, killsA: aRad ? g.kr : g.kd, killsB: aRad ? g.kd : g.kr, picksA: g.pick ? g.pick[aRad ? 0 : 1] : null, picksB: g.pick ? g.pick[aRad ? 1 : 0] : null }); }
  const done = bo === 2 ? a + b >= 2 : a >= need || b >= need;
  const lv = (LIVE.live || []).find((g) => pair(g.r, g.d) && !seen.has(g.id));
  if (lv && !done) { const aRad = lv.r === Aid, base = cal(lg(logit(pg) + (aRad ? sideL : -sideL))), drafted = lv.hr.length === 5 && lv.hd.length === 5;
    const draft = drafted ? cal(lg(logit(base) + (aRad ? 1 : -1) * P.dw * DRf.logitOf(lv.hr, lv.hd))) : null;
    out.push({ n: out.length + 1, id: lv.id, status: "live", aSide: aRad ? "Radiant" : "Dire", pA: r3(base), pDraftA: draft != null ? r3(draft) : null, clock: Math.round(lv.t / 60), killsA: aRad ? lv.rk : lv.dk, killsB: aRad ? lv.dk : lv.rk, leadA: aRad ? lv.lead : -lv.lead, picksA: aRad ? lv.hr : lv.hd, picksB: aRad ? lv.hd : lv.hr }); }
  if (!done) { const maxG = bo === 2 ? 2 : bo; for (let n = out.length + 1; n <= Math.min(maxG, out.filter((x) => x.status === "done").length + (lv ? 2 : 1) + (bo >= 3 ? 1 : 0)) && n <= maxG; n++) out.push({ n, status: "next", pA: r3(pg) }); }
  return { score: [a, b], done, games: out, pSeriesNow: r3(done ? (a > b ? 1 : a === b ? 0.5 : 0) : remainP(pg, a, b, bo)), live: !!lv };
}
const LN_F = path.join(D, "lines.json"), LN = readJSON(LN_F, { matches: {} });
const upcoming = [];
for (const m of UP.matches) {
  const start = Date.parse(m.date) / 1000; if (start < now - 10 * 3600) continue; // started more than 4 hours ago: the result arrives through OpenDota
  const A = findTeam(m.a), B = findTeam(m.b), ta = A && R.TR.get(+A.id), tb = B && R.TR.get(+B.id);
  const ra = A ? lineupRating(+A.id) ?? P.r0 : P.r0, rb = B ? lineupRating(+B.id) ?? P.r0 : P.r0, pg = cal(lg(ra - rb)), sp = seriesP(pg, m.bo);
  const id = sid(`${m.date.slice(0, 16)}_${m.a.name}_${m.b.name}`), known = (ta?.n || 0) >= WARM && (tb?.n || 0) >= WARM;
  const side = (id2) => id2 ? profile(+id2) : null, pa = side(A?.id), pb = side(B?.id);
  const scen = [];
  if (pa?.signature && pa.signature.effect > 0.05) scen.push({ t: `If ${m.a.name}'s ${hname(pa.signature.hero)} is banned`, d: `${m.a.name} are ${pa.signature.with[0]}-${pa.signature.with[1] - pa.signature.with[0]} with it and ${pa.signature.without[0]}-${pa.signature.without[1] - pa.signature.without[0]} without it in the last 200 days. Opponents have banned it ${pa.signature.banned} times in their recent games.`, pA: r3(headline(seriesP(cal(lg(ra - rb - Math.min(0.4, pa.signature.effect * 1.2))), m.bo))) });
  if (pb?.signature && pb.signature.effect > 0.05) scen.push({ t: `If ${m.b.name}'s ${hname(pb.signature.hero)} is banned`, d: `${m.b.name} are ${pb.signature.with[0]}-${pb.signature.with[1] - pb.signature.with[0]} with it and ${pb.signature.without[0]}-${pb.signature.without[1] - pb.signature.without[0]} without it in the last 200 days.`, pA: r3(headline(seriesP(cal(lg(ra - rb + Math.min(0.4, pb.signature.effect * 1.2))), m.bo))) });
  const sideL = logit(R.side);
  scen.push({ t: `Game on Radiant for ${m.a.name}`, d: `Radiant has won ${(R.side * 100).toFixed(1)}% of pro games in our data. Single game: ${m.a.name} ${Math.round(cal(lg(ra - rb + sideL)) * 100)}% on Radiant, ${Math.round(cal(lg(ra - rb - sideL)) * 100)}% on Dire.`, pA: null });
  if (pa && pb && pa.short[1] >= 4 && pa.long[1] >= 4 && pb.short[1] >= 4 && pb.long[1] >= 4) scen.push({ t: "Short games vs long games", d: `Under 30 minutes: ${m.a.name} ${pa.short[0]}-${pa.short[1] - pa.short[0]}, ${m.b.name} ${pb.short[0]}-${pb.short[1] - pb.short[0]}. 40 minutes or more: ${m.a.name} ${pa.long[0]}-${pa.long[1] - pa.long[0]}, ${m.b.name} ${pb.long[0]}-${pb.long[1] - pb.long[0]}. Average game: ${pa.avgMin} vs ${pb.avgMin} minutes.`, pA: null });
  const exp = Object.entries(sp.scores).reduce((a, [k, v]) => a + v * k.split("-").reduce((x, y) => +x + +y, 0), 0);
  const tside = (o, T0, Tm, r, prof) => ({ name: o.name, short: o.short, id: T0?.id ?? null, logo: T0?.logo || null, elo: T0 ? elo(r) : null, rank: T0 ? rankOf.get(+T0.id) ?? null : null, games: Tm?.n || 0, roster: T0 ? rosterOf(+T0.id) : [], profile: prof,
    form: T0 ? (teamSeries.get(+T0.id) || []).filter((s) => s.complete).slice(-5).map((s) => (s.draw ? "D" : (s.a === +T0.id ? s.score[0] > s.score[1] : s.score[1] > s.score[0]) ? "W" : "L")).join("") : "" });
  const likely = (prof) => { if (!prof?.comfort?.length) return null; const hs = prof.comfort.slice(0, 5).map((c) => c.h); if (hs.length < 5) return null; return { heroes: hs, ...readDraft(draftVec(hs, (h) => DRf.tempo(h))) }; };
  const up = { id, date: m.date, likelyA: likely(pa), likelyB: likely(pb), started: start <= now, bo: m.bo, tournament: m.tournament, stage: m.stage, a: tside(m.a, A, ta, ra, pa), b: tside(m.b, B, tb, rb, pb), known,
    pGame: r3(pg), pSeries: r3(headline(sp)), pDraw: r3(sp.draw), scores: Object.fromEntries(Object.entries(sp.scores).map(([k, v]) => [k, r3(v)])), expMaps: r1(exp), h2h: A && B ? h2h(+A.id, +B.id) : [], scenarios: scen };
  upcoming.push(up);
  writeJSON(path.join(OUT, "matches", `${id}.json`), up);
  // pre-match record: keep overwriting until the match starts, then it stays frozen
  up.markets = A && B ? nextMarkets(+A.id, +B.id, pg, m.a.name, m.b.name) : null; up.explain = explainMatch(up, A, B, pa, pb, up.markets);
  if (A && B) { up.series = seriesState(+A.id, +B.id, start, m.bo, pg); if (up.series.done && start < now - 3600) { upcoming.pop(); } else writeJSON(path.join(OUT, "matches", `${id}.json`), up); }
  // ESTIMATED MAIN LINES (no sportsbook feed for Dota 2 is open to us): series winner, map handicap and total maps saved
  // until the series starts, and a game-winner pick for each game saved until that game starts. Graded from the results.
  if (A && B) { const L = (LN.matches[id] ||= { id, date: m.date, tournament: m.tournament, a: m.a.name, b: m.b.name, bo: m.bo, picks: {}, games: {} }); const st0 = up.series || { score: [0, 0], games: [] };
    if (!up.started && !st0.games.some((g) => g.status !== "next")) { const fav = up.pSeries >= 0.5 ? "a" : "b", fn = fav === "a" ? m.a.name : m.b.name, pf = (x) => (fav === "a" ? x : 1 - x), sc = up.scores, games = (k) => k.split("-").reduce((x, y) => +x + +y, 0);
      L.picks.ml = { pick: `${fn} to win the series`, side: fav, p: r3(Math.min(0.9, pf(up.pSeries))) };
      if (m.bo === 3) L.picks.hcap = { pick: `${fn} -1.5 maps`, side: fav, line: -1.5, p: r3(fav === "a" ? sc["2-0"] : sc["0-2"]) };
      if (m.bo === 5) L.picks.hcap = { pick: `${fn} -1.5 maps`, side: fav, line: -1.5, p: r3(fav === "a" ? sc["3-0"] + sc["3-1"] : sc["0-3"] + sc["1-3"]) };
      if (m.bo === 2) L.picks.hcap = { pick: `${fn} +0.5 maps (no loss)`, side: fav, line: 0.5, p: r3(fav === "a" ? sc["2-0"] + sc["1-1"] : sc["0-2"] + sc["1-1"]) };
      const tl = m.bo === 3 ? 2.5 : m.bo === 5 ? 4.5 : null; if (tl) { const over = Object.entries(sc).reduce((x, [k, v]) => x + (games(k) > tl ? v : 0), 0); L.picks.total = { pick: `${over >= 0.5 ? "Over" : "Under"} ${tl} maps`, over: over >= 0.5, line: tl, p: r3(Math.max(over, 1 - over)) }; }
      L.savedAt = new Date().toISOString(); }
    for (const g of st0.games) if (g.status === "next" && !L.games[g.n]) { /* the next game to start gets a saved pick; later games wait */ if (g.n === (st0.games.filter((x) => x.status !== "next").length + 1)) L.games[g.n] = { pick: `${g.pA >= 0.5 ? m.a.name : m.b.name} to win game ${g.n}`, side: g.pA >= 0.5 ? "a" : "b", p: r3(Math.max(g.pA, 1 - g.pA)), savedAt: new Date().toISOString(), markets: up.markets ? { totalKills: up.markets.totalKills, killsA: up.markets.killsA, killsB: up.markets.killsB, killHcap: up.markets.killHcap, duration: up.markets.duration } : null }; }
      else if (g.status === "next" && L.games[g.n] && !L.games[g.n].result && g.n === (st0.games.filter((x) => x.status !== "next").length + 1)) Object.assign(L.games[g.n], { pick: `${g.pA >= 0.5 ? m.a.name : m.b.name} to win game ${g.n}`, side: g.pA >= 0.5 ? "a" : "b", p: r3(Math.max(g.pA, 1 - g.pA)), savedAt: new Date().toISOString() });
    for (const g of st0.games) if (g.status === "done" && L.games[g.n] && !L.games[g.n].result) L.games[g.n].result = { won: (L.games[g.n].side === "a") === g.aWon };
    for (const g of st0.games) { const M = L.games[g.n]?.markets; if (g.status !== "done" || !M || g.killsA == null || M.graded) continue; const tot = g.killsA + g.killsB, mar = g.killsA - g.killsB, gr = (x, won) => { if (x) x.result = { won }; };
      gr(M.totalKills, M.totalKills && M.totalKills.over === tot > M.totalKills.line); gr(M.killsA, M.killsA && M.killsA.over === g.killsA > M.killsA.line); gr(M.killsB, M.killsB && M.killsB.over === g.killsB > M.killsB.line);
      if (M.killHcap) { const fm = M.killHcap.fav === "a" ? mar : -mar; gr(M.killHcap, M.killHcap.takeFav === fm > M.killHcap.line); } if (M.duration && g.min) gr(M.duration, M.duration.over === g.min > M.duration.line); M.graded = true; }
    L.score = st0.score; L.live = !!up.series?.live; L.started = up.started || st0.games.some((g) => g.status !== "next");
    if (up.series?.done) L.final = st0.score; }
  if (!up.started && A && B) PRE.entries[id] = { id, date: m.date, tournament: m.tournament, stage: m.stage, bo: m.bo, a: m.a.name, b: m.b.name, aId: +A.id, bId: +B.id, p: up.pSeries, known, frozenAt: new Date().toISOString(), result: PRE.entries[id]?.result || null };
}
upcoming.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
// grade frozen pre-match projections from finished OpenDota series (same two teams, first game within 8 hours of the listed start)
for (const e of Object.values(PRE.entries)) { if (e.result) continue; const t0 = Date.parse(e.date) / 1000;
  const s = series.find((s) => s.complete && ((s.a === e.aId && s.b === e.bId) || (s.a === e.bId && s.b === e.aId)) && Math.abs(s.t - t0) < 8 * 3600);
  if (s) { const sc = s.a === e.aId ? s.score : [s.score[1], s.score[0]]; e.result = { score: sc, series: s.key, draw: sc[0] === sc[1], right: sc[0] === sc[1] ? null : (e.p >= 0.5) === (sc[0] > sc[1]) }; }
  else if (t0 < now - 3 * DAY) e.result = { missing: true }; }
writeJSON(PRE_F, PRE);
// final scores also come from the saved-before-start ledger (series that dropped off the schedule)
for (const L of Object.values(LN.matches)) { const e = PRE.entries[L.id]; if (!L.final && e?.result?.score) L.final = e.result.score;
  if (L.final) { const [x, y] = L.final, favWon = (sd) => (sd === "a" ? x > y : y > x), tot = x + y, P0 = L.picks;
    if (P0.ml && !P0.ml.result) P0.ml.result = { won: x === y ? null : favWon(P0.ml.side) };
    if (P0.hcap && !P0.hcap.result) { const m0 = P0.hcap.side === "a" ? x - y : y - x; P0.hcap.result = { won: P0.hcap.line < 0 ? m0 >= 2 : m0 >= 0 }; }
    if (P0.total && !P0.total.result) P0.total.result = { won: P0.total.over ? tot > P0.total.line : tot < P0.total.line }; } }
for (const [k, L] of Object.entries(LN.matches)) if (Date.parse(L.date) < Date.now() - 40 * 86400000) delete LN.matches[k];
writeJSON(LN_F, LN);
{ const rows = Object.values(LN.matches).filter((L) => Object.keys(L.picks).length || Object.keys(L.games).length), rec = {};
  for (const L of rows) { for (const [k, x] of [...Object.entries(L.picks), ...Object.entries(L.games).map(([n, x]) => ["game", x]), ...Object.values(L.games).flatMap((x) => Object.entries(x.markets || {}).map(([mk, y]) => [mk === "killsA" || mk === "killsB" ? "teamKills" : mk, y]))]) { if (!x) continue; if (!x.result || x.result.won == null) continue; const r = (rec[k] ||= { n: 0, hit: 0, strong: [0, 0] }); r.n++; if (x.result.won) r.hit++; if (x.p >= 0.6) { r.strong[1]++; if (x.result.won) r.strong[0]++; } } }
  const pack = (L) => ({ id: L.id, date: L.date, tournament: L.tournament, a: L.a, b: L.b, bo: L.bo, score: L.score || null, final: L.final || null, live: !!L.live, picks: L.picks, games: L.games });
  writeJSON(path.join(OUT, "lines.json"), { note: "Estimated main lines: there is no sportsbook feed for Dota 2 that its terms let us read, so these are standard main lines (series winner, -1.5 maps, total maps 2.5 / 4.5, each game's winner) priced by our model. Saved before the series or game starts and never changed after.",
    record: rec, upcoming: rows.filter((L) => !L.started && !L.final).sort((a, b) => a.date.localeCompare(b.date)).map(pack), ongoing: rows.filter((L) => L.started && !L.final).sort((a, b) => a.date.localeCompare(b.date)).map(pack), history: rows.filter((L) => L.final).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150).map(pack) }); }
const preDone = Object.values(PRE.entries).filter((e) => e.result && !e.result.missing && !e.result.draw && e.known);
accuracy.prematch = { n: preDone.length, hit: preDone.filter((e) => e.result.right).length, brier: preDone.length ? r3(preDone.reduce((a, e) => a + (e.p - (e.result.score[0] > e.result.score[1] ? 1 : 0)) ** 2, 0) / preDone.length) : null,
  list: Object.values(PRE.entries).filter((e) => e.result && !e.result.missing).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60) };
accuracy.kills = { test: KTEST, lines: LINE, pace: PB, sd: Object.fromEntries(Object.entries(SD).map(([k, v]) => [k, r1(v)])) };
writeJSON(path.join(OUT, "accuracy.json"), accuracy);
writeJSON(path.join(OUT, "upcoming.json"), upcoming.map(({ a, b, scenarios, h2h, ...m }) => ({ ...m, a: { name: a.name, short: a.short, id: a.id, logo: a.logo, elo: a.elo, rank: a.rank, form: a.form }, b: { name: b.name, short: b.short, id: b.id, logo: b.logo, elo: b.elo, rank: b.rank, form: b.form } })));

// team pages (after upcoming, so each can show its next match)
for (const t of teamsOut) { const ss = (teamSeries.get(t.id) || []).filter((s) => s.complete).slice(-25).reverse(), T0 = R.TR.get(t.id);
  writeJSON(path.join(OUT, "teams", `${fileId(t.id)}.json`), { ...t, profile: profile(t.id), roster: rosterOf(t.id), hist: (T0?.hist || []).slice(-60).map(([d, r]) => [new Date(d * 1000).toISOString().slice(0, 10), elo(r)]),
    next: upcoming.find((m) => m.a.id === t.id || m.b.id === t.id) ? (({ id, date, bo, tournament, a, b, pSeries }) => ({ id, date, bo, tournament, opp: a.id === t.id ? b.name : a.name, p: a.id === t.id ? pSeries : r3(1 - pSeries) }))(upcoming.find((m) => m.a.id === t.id || m.b.id === t.id)) : null,
    series: ss.map((s) => ({ id: s.key, date: new Date(s.t * 1000).toISOString(), league: leagueName(s.league), bo: s.bo, opp: tname(s.a === t.id ? s.b : s.a), oppId: s.a === t.id ? s.b : s.a, score: s.a === t.id ? s.score : [s.score[1], s.score[0]], page: fs.existsSync(path.join(OUT, "series", `${s.key}.json`)) })) }); }

// ---------------------------------------------------------------- picks: our own lines per scheduled match (no sportsbook data)
const picks = [];
for (const m of upcoming) { const line = m.bo === 3 ? 2.5 : m.bo === 5 ? 4.5 : null, games = (k) => k.split("-").reduce((x, y) => +x + +y, 0);
  const base = { id: m.id, date: m.date, league: m.tournament, game: `${m.a.name} vs ${m.b.name}`, fewGames: !m.known };
  if (m.bo === 2) { const top = Object.entries(m.scores).sort((a, b) => b[1] - a[1])[0]; picks.push({ ...base, kind: "score", pick: `${top[0] === "1-1" ? "Draw 1-1" : top[0] === "2-0" ? `${m.a.name} 2-0` : `${m.b.name} 2-0`}`, p: top[1], noPick: true, why: "Reference only: best-of-2 can end in a draw." }); continue; }
  const fav = m.pSeries >= 0.5 ? m.a.name : m.b.name, p = Math.min(0.9, Math.max(m.pSeries, 1 - m.pSeries));
  picks.push({ ...base, kind: "series", pick: `${fav} to win the series`, p: r3(p), noPick: !m.known || p < 0.6, why: !m.known ? "Reference only: a team has too few games in our data." : p < 0.6 ? "Too close to call: under 60%." : undefined });
  if (line) { const over = Object.entries(m.scores).reduce((a, [k, v]) => a + (games(k) > line ? v : 0), 0), q = Math.min(0.85, Math.max(over, 1 - over)); picks.push({ ...base, kind: "maps", pick: `${over >= 0.5 ? "Over" : "Under"} ${line} maps`, p: r3(q), noPick: !m.known || q < 0.6, why: !m.known ? "Reference only: a team has too few games in our data." : q < 0.6 ? "Too close to call: under 60%." : undefined }); }
  const top = Object.entries(m.scores).sort((a, b) => b[1] - a[1])[0]; const [x, y] = top[0].split("-").map(Number);
  picks.push({ ...base, kind: "score", pick: `${x > y ? m.a.name : m.b.name} ${Math.max(x, y)}-${Math.min(x, y)}`, p: r3(top[1]), noPick: true, why: "Reference only: an exact score is a long shot." }); }
writeJSON(path.join(OUT, "picks.json"), { picks, note: "Series chances are capped at 90% and map totals at 85%, because upsets and stand-ins happen. A pick needs 60% or more and both teams with 8+ games in our data." });

// ---------------------------------------------------------------- history (every graded series, compact) and learning timeline
const hist = R.log.filter((x) => x.s.complete).map((x) => { const r = seriesRow(x); return [r.date.slice(0, 10), r.league, r.a, r.b, r.score[0], r.score[1], r.p, r.graded ? 1 : 0, fs.existsSync(path.join(OUT, "series", `${r.id}.json`)) ? r.id : null]; }).reverse();
writeJSON(path.join(OUT, "history.json"), hist);
const months = {}; for (const x of gRows) { const k = new Date(x.t * 1000).toISOString().slice(0, 7); const o = (months[k] ||= { n: 0, hit: 0, b: 0 }); o.n++; if ((x.p >= 0.5) === x.y) o.hit++; o.b += (x.p - (x.y ? 1 : 0)) ** 2; }
let cn = 0, ch = 0; const timeline = Object.entries(months).sort().map(([m, o]) => { cn += o.n; ch += o.hit; return { month: m, n: o.n, acc: r3(o.hit / o.n), brier: r3(o.b / o.n), cumAcc: r3(ch / cn) }; });
writeJSON(path.join(OUT, "learning.json"), { built: new Date().toISOString(), params: P, frozen: fzOk ? FZ.date : new Date().toISOString(), previous: FZ?.previous?.P || null, timeline, calibration: accuracy.calibration, side: r3(R.side),
  lessons: [
    `The five players matter more than the team name: the best setting rates each team by the players it fielded last (player blend ${P.w}), so a roster change moves a team's rating at once.`,
    `Ratings fade slowly (setting: ${P.H} days) and a brand-new team starts ${P.r0 < 0 ? "a little below" : "at"} the pro average.`,
    `Radiant has won ${(R.side * 100).toFixed(1)}% of pro games; the side is in every single-game chance, and is neutral before the coin toss.`,
    `The draft layer helps a little on single games (Brier ${accuracy.games.brier} -> ${accuracy.games.brierDraft}) at weight ${P.dw}, so draft numbers are a guide, not the main driver.`,
    T !== 1 ? `Chances are pulled toward 50% (factor ${T}) because that helped on series the fit never saw.` : `A pull toward 50% was tested (best fit ${bestT}) but did not help on series the fit never saw, so chances are used as they come.` ] });

// ---------------------------------------------------------------- meta by league (last 120 days, leagues with 30+ games)
const LG = {}; for (const g of G) { if (g.t < now - 120 * DAY || g.pick[0].length !== 5) continue; const o = (LG[g.lg] ||= { id: g.lg, league: leagueName(g.lg), tier: LEAGUES[g.lg]?.tier, n: 0, rad: 0, dur: 0, h: {}, fp: {} });
  o.n++; o.rad += g.rw; o.dur += g.dur; for (const s of [0, 1]) { const won = s === 0 ? g.rw : 1 - g.rw; for (const h of g.pick[s]) { const x = (o.h[h] ||= { p: 0, b: 0, w: 0 }); x.p++; x.w += won; } for (const h of g.ban[s]) (o.h[h] ||= { p: 0, b: 0, w: 0 }).b++; }
  const firstPick = g.order.find((x) => x[0] === 1); if (firstPick) { const x = (o.fp[firstPick[2]] ||= 0); o.fp[firstPick[2]] = x + 1; } }
const leaguesOut = Object.values(LG).filter((o) => o.n >= 30).sort((a, b) => b.n - a.n).slice(0, 20).map((o) => ({ id: o.id, league: o.league, tier: o.tier, games: o.n, radiant: r3(o.rad / o.n), avgMin: Math.round(o.dur / o.n / 60),
  top: Object.entries(o.h).map(([h, x]) => ({ h: +h, p: x.p, b: x.b, wr: x.p ? r3(x.w / x.p) : null, pres: r3((x.p + x.b) / o.n) })).sort((a, b) => b.pres - a.pres).slice(0, 12),
  openers: Object.entries(o.fp).map(([h, n]) => ({ h: +h, n })).sort((a, b) => b.n - a.n).slice(0, 6) }));
writeJSON(path.join(OUT, "leagues.json"), { leagues: leaguesOut });

// ---------------------------------------------------------------- draft library (each league's latest 150 games with both drafts)
fs.mkdirSync(path.join(OUT, "library"), { recursive: true }); for (const f of fs.readdirSync(path.join(OUT, "library"))) fs.rmSync(path.join(OUT, "library", f));
const libIdx = [];
for (const o of leaguesOut.slice(0, 14)) { const rows = G.filter((g) => g.lg === o.id && g.pick[0].length === 5).slice(-150).reverse().map((g) => ({ id: g.id, date: new Date(g.t * 1000).toISOString().slice(0, 10), r: tname(g.r), d: tname(g.d), rw: g.rw, min: Math.round(g.dur / 60), pr: g.pick[0], pd: g.pick[1], br: g.ban[0], bd: g.ban[1], s: SER.has(`s${g.sid}`) && fs.existsSync(path.join(OUT, "series", `s${g.sid}.json`)) ? `s${g.sid}` : null }));
  writeJSON(path.join(OUT, "library", `${o.id}.json`), rows); libIdx.push({ id: o.id, league: o.league, games: rows.length }); }
writeJSON(path.join(OUT, "library.json"), libIdx);

// ---------------------------------------------------------------- playbook: plain rules from pro games, with how sure we are
const zOf = (k, n, p0 = 0.5) => (n ? (k / n - p0) / Math.sqrt((p0 * (1 - p0)) / n) : 0);
const rules = [], rule = (group, text, k, n, extra = {}) => { const z = zOf(k, n); rules.push({ group, text, n, v: n ? r3(k / n) : null, tag: Math.abs(z) >= 2 && n >= 60 ? "solid" : "lean", z: r1(z), ...extra }); };
const G12 = G.filter((g) => g.t > now - 365 * DAY && g.pick[0].length === 5);
{ const k = G12.reduce((a, g) => a + g.rw, 0); rule("Sides", `Radiant wins ${pct0(k / G12.length)} of pro games.`, k, G12.length); }
{ let k = 0, n = 0; for (const g of G12) { const fp = g.order.find((x) => x[0] === 1); if (!fp) continue; n++; if ((fp[1] === 0) === (g.rw === 1)) k++; } rule("Draft order", `The side that makes the first pick wins ${pct0(k / Math.max(1, n))} of games.`, k, n); }
{ let k = 0, n = 0; for (const s of series) { if (!s.complete || s.bo !== 3 || s.games.length < 2) continue; const g1 = s.games[0], w1 = g1.rw ? g1.r : g1.d, ws = s.score[0] > s.score[1] ? s.a : s.b; n++; if (w1 === ws) k++; } rule("Series", `The winner of game 1 goes on to win the best-of-3 ${pct0(k / Math.max(1, n))} of the time.`, k, n, { p0: 0.5 }); }
{ const by = { short: [0, 0], long: [0, 0] }; for (const x of R.glog) { const g = x.g; if (x.p == null || Math.abs(x.p - 0.5) < 0.05) continue; const favWon = (x.p >= 0.5) === (g.rw === 1), b = g.dur < 30 * 60 ? by.short : g.dur >= 40 * 60 ? by.long : null; if (b) { b[1]++; if (favWon) b[0]++; } }
  rule("Game length", `In games under 30 minutes the rating favourite wins ${pct0(by.short[0] / Math.max(1, by.short[1]))}; in games of 40+ minutes, ${pct0(by.long[0] / Math.max(1, by.long[1]))}. Long games are where upsets live.`, by.long[0], by.long[1]); }
for (const b of [1, 3]) { const rows = gRows.filter((x) => x.bo === b), k = rows.filter((x) => (x.p >= 0.5) === x.y).length; rule("Formats", `In best-of-${b} series the favourite wins ${pct0(k / Math.max(1, rows.length))} (${rows.length} graded series).`, k, rows.length); }
for (const h of heroList.filter((h) => h.rec.pick >= 40).sort((a, b) => b.rec.wr - a.rec.wr).slice(0, 3)) rule("Heroes", `${h.name} has won ${pct0(h.rec.wr)} of ${h.rec.pick} pro games in the last 60 days.`, Math.round(h.rec.wr * h.rec.pick), h.rec.pick, { h: h.id });
for (const h of heroList.filter((h) => h.rec.pick >= 40).sort((a, b) => a.rec.wr - b.rec.wr).slice(0, 2)) rule("Heroes", `${h.name} is picked a lot but has won only ${pct0(h.rec.wr)} of ${h.rec.pick} games in the last 60 days.`, Math.round(h.rec.wr * h.rec.pick), h.rec.pick, { h: h.id });
{ const pr = []; for (const [k] of DRf.PR) { const s = DRf.peek(DRf.PR, k); if (s.n >= 25) pr.push({ k, n: s.n, w: s.w }); } pr.sort((a, b) => b.w / b.n - a.w / a.n);
  for (const x of pr.slice(0, 3)) { const [a, b] = x.k.split("-").map(Number); rule("Combos", `${hname(a)} with ${hname(b)} on the same side: ${pct0(x.w / x.n)} won (about ${Math.round(x.n)} recent-weighted games).`, Math.round(x.w), Math.round(x.n), { h: a, h2: b }); } }
{ const vs = []; for (const [k] of DRf.VS) { const s = DRf.peek(DRf.VS, k); if (s.n >= 25) vs.push({ k, n: s.n, w: s.w }); } vs.sort((a, b) => b.w / b.n - a.w / a.n);
  for (const x of vs.slice(0, 3)) { const [a, b] = x.k.split(">").map(Number); rule("Counters", `${hname(a)} against ${hname(b)}: ${pct0(x.w / x.n)} won (about ${Math.round(x.n)} recent-weighted games).`, Math.round(x.w), Math.round(x.n), { h: a, h2: b }); } }
for (const [k, label] of [["F", "first blood"], ["W", "the first tower"], ["T", "the first Tormentor"], ["R", "the first Roshan"], ["X", "the first barracks"]]) { let n = 0, w = 0; for (const g of G12) { const o = g.obj?.[k]; if (!o) continue; n++; if ((o.side === 0) === (g.rw === 1)) w++; } if (n >= 60) rule("Objectives", `The team that takes ${label} wins ${pct0(w / n)} of games.`, w, n); }
{ let n = 0, w = 0; for (const g of G12) { const x = g.obj?.X; if (!x) continue; n++; if ((x.side === 0) !== (g.rw === 1)) w++; } if (n >= 60) rule("High ground", `A team that loses the first barracks still wins ${pct0(w / n)} of the time: high-ground defence and comebacks.`, w, n); }
function pct0(x) { return `${Math.round((x || 0) * 100)}%`; }
writeJSON(path.join(OUT, "playbook.json"), { rules, note: "Solid: at least 60 games and about 2 standard errors from 50%. Lean: a pattern worth watching, not proven." });

// ---------------------------------------------------------------- patch tracker: heroes before and after the newest patches
const pts = PATCHES.slice(-4).reverse().map((p, i, arr) => { const t0 = Date.parse(p.date) / 1000, t1 = i === 0 ? now + DAY : Date.parse(arr[i - 1].date) / 1000, prev = t0 - 45 * DAY;
  const agg = (a, b) => { const o = {}; let n = 0; for (const g of G) { if (g.t < a || g.t >= b || g.pick[0].length !== 5) continue; n++; for (const s of [0, 1]) { const won = s === 0 ? g.rw : 1 - g.rw; for (const h of g.pick[s]) { const x = (o[h] ||= { n: 0, w: 0, b: 0 }); x.n++; x.w += won; } for (const h of g.ban[s]) (o[h] ||= { n: 0, w: 0, b: 0 }).b++; } } return { o, n }; };
  const before = agg(prev, t0), after = agg(t0, t1);
  const heroes = Object.values(HEROES).map((h) => { const b = before.o[h.id] || { n: 0, w: 0, b: 0 }, a = after.o[h.id] || { n: 0, w: 0, b: 0 };
    return { h: h.id, before: { n: b.n, rate: b.n ? r3(b.w / b.n) : null, pres: before.n ? r3((b.n + b.b) / before.n) : 0 }, after: { n: a.n, rate: a.n ? r3(a.w / a.n) : null, pres: after.n ? r3((a.n + a.b) / after.n) : 0 }, notes: i === 0 ? PNOTES?.heroes?.[h.id] || 0 : null }; })
    .filter((x) => x.before.n + x.after.n >= 5).sort((a, b) => (b.after.pres - b.before.pres) - (a.after.pres - a.before.pres));
  return { patch: p.patch, release: p.date, gamesBefore: before.n, gamesAfter: after.n, heroes }; });
writeJSON(path.join(OUT, "patch.json"), { patches: pts });

// ---------------------------------------------------------------- events: tournaments on the schedule, with each team's standing in our ratings
const EV = {}; for (const m of upcoming) { const k = m.tournament || "Other"; const e = (EV[k] ||= { name: k, page: UP.matches.find((x) => x.tournament === k)?.tpage || null, matches: [], teams: {} }); e.matches.push({ id: m.id, date: m.date, a: m.a.name, b: m.b.name, p: m.pSeries, bo: m.bo, stage: m.stage });
  for (const t of [m.a, m.b]) e.teams[t.name] = { name: t.name, id: t.id, elo: t.elo, rank: t.rank }; }
// field strength: each team's average chance to beat every other team in the field in a best-of-3
const events = Object.values(EV).map((e) => { const T0 = Object.values(e.teams), rOf = (t) => (t.id != null ? lineupRating(+t.id) ?? P.r0 : P.r0);
  for (const t of T0) { const others = T0.filter((o) => o !== t); t.vsField = others.length ? r3(others.reduce((a, o) => a + headline(seriesP(cal(lg(rOf(t) - rOf(o))), 3)), 0) / others.length) : null; }
  const rated = T0.filter((t) => t.elo != null), strength = rated.length ? rated.reduce((x, t) => x + t.elo, 0) / rated.length : 0; return { ...e, strength: Math.round(strength), teams: T0.sort((a, b) => (b.vsField ?? 0) - (a.vsField ?? 0)) }; }).sort((a, b) => b.strength - a.strength);
writeJSON(path.join(OUT, "events.json"), events);

// ---------------------------------------------------------------- meta
const meta = { updated: new Date().toISOString(), players: playersOut.length, games: G.length, series: series.length, graded: gRows.length, upcoming: upcoming.length, teams: teamsOut.length, heroes: heroList.length, patch: latestPatch || null, patchGames, recentGames: recGames,
  firstGame: G[0] ? new Date(G[0].t * 1000).toISOString() : null, params: P, calT: T, side: r3(R.side), leagues: [...new Set(upcoming.map((m) => m.tournament).filter(Boolean))] };
writeJSON(path.join(OUT, "meta.json"), meta);
console.log(`Dota 2 out: ${upcoming.length} upcoming, ${teamsOut.length} teams, ${playersOut.length} players, ${heroList.length} heroes; pre-match record ${accuracy.prematch.hit}/${accuracy.prematch.n}`);
