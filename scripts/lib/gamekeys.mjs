// Why a team can win or lose an upcoming game, the previous meetings of the two teams, and
// "provable scenarios": if-then statements that are plain counts over past games, each with
// the number of games behind it and their ids so the website can link to them.
//
// Built after the walk-forward loop, for upcoming games only. Nothing here changes a projection.
// Rules for honest reporting:
//   - a scenario needs a minimum number of games (MIN below) and says how many it has;
//   - 3 or 4 games is labelled "small", 5-9 "moderate", 10+ "solid";
//   - every scenario is sorted by a strength score that grows with both the size of the gap
//     and the number of games;
//   - "known" is only set for things that are already true for the game (schedule, absences,
//     history). A conditional record ("X is 5-9 when it is outrebounded") is never known; when
//     the opponent's profile makes the condition more likely it carries likely: true instead;
//   - a conditional record is measured against what the same condition does to every team
//     (league-wide win rate under it, adjusted for the team's own record), not against 50%;
//   - one situation gives one line. Where the league-wide learned effect and the team's own
//     record point in opposite directions the line is marked mixed and favours neither side;
//   - finished games ESPN has no box score for count in records and meetings (final score only).
import { round, mean, sd, clamp } from "./stats.mjs";
import { ZONE_LABEL } from "./zones.mjs";
import { Z5, ZVAL } from "./zonestate.mjs";
import { FACTOR_BY_ID } from "./factors.mjs";

export const MIN = { h2h: 3, team: 5, player: 3 };
const sampleOf = (n) => (n >= 10 ? "solid" : n >= 5 ? "moderate" : "small");
const sign = (x, d = 1) => (x > 0 ? "+" : "") + round(x, d);
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const pc = (m, a, d = 1) => (a > 0 ? round(m / a * 100, d) : null);
// Rank in words, read from the nearer end of the table: rw(27, "lowest", "highest") -> "4th highest".
const rw = (r, lo, hi) => (r == null ? "n/a" : r <= 15 ? (r === 1 ? `the ${lo}` : `${ord(r)} ${lo}`) : (r === 30 ? `the ${hi}` : `${ord(31 - r)} ${hi}`));
const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;
const ZTXT = { rim: "at the rim", paint: "in the paint", mid: "from mid-range", c3: "on corner threes", atb: "on above-the-break threes" };
const SCEN_PHRASE = {
  "back-to-back": "on the second night of a back-to-back", "opponent on back-to-back": "when its opponent is on a back-to-back", "rest advantage (2+ days)": "with a rest advantage of 2 or more days",
  "long road trip": "from the 4th straight road game on", "one star out": "with one of its top two scorers out", "two+ stars out": "with both of its top two scorers out", "opponent star out": "when the opponent is missing a top scorer",
  "early season": "in the first 8 games of a season", "long flight since last game (1,000+ miles)": "after a flight of 1,000 miles or more on short rest", "travelled 2+ time zones east": "after travelling 2 or more time zones east",
  "travelled 2+ time zones west": "after travelling 2 or more time zones west", "visiting at altitude (Denver / Utah)": "visiting Denver or Utah", "after a blowout loss": "in the game after a loss by 20 or more",
  "after a blowout win": "in the game after a win by 20 or more", "after an overtime game": "right after an overtime game", "on a 4+ game win streak": "on a win streak of 4 or more", "on a 4+ game losing streak": "on a losing streak of 4 or more", playoffs: "in the playoffs",
};

export function createGameKeys(env) {
  const { ZS, SC, learn, teamById, getT, P, results, details, playerGameRes, lastSeason, FXE, profById, MODEL_KEYS, MODEL_LABEL, phaseLabel, scoreOnly = [], withWithoutGames } = env;
  const ab = (id) => teamById[id]?.abbr || String(id);
  const resById = new Map(results.map((r) => [r.id, r]));
  const sinceTxt = `since October ${lastSeason - 2}`;

  // ---- per-team list of finished games (no preseason), oldest first ----
  const TG = new Map();
  for (const f of ZS.facts.values()) {
    if (f.stype === 1) continue;
    for (const i of [0, 1]) {
      const tid = i ? f.away : f.home;
      if (!TG.has(tid)) TG.set(tid, []);
      TG.get(tid).push({ id: f.id, date: f.date, season: f.season, f, i, me: f.s[i], op: f.s[1 - i], opp: i ? f.home : f.away, home: i === 0, margin: i ? f.as - f.hs : f.hs - f.as, won: i ? f.as > f.hs : f.hs > f.as });
    }
  }
  // finished games known by their final score only (no box score on ESPN): they count in records,
  // never in a condition that needs box-score numbers (me / op / f are null)
  for (const e of scoreOnly) {
    if (e.stype === 1) continue;
    for (const i of [0, 1]) {
      const tid = i ? e.away : e.home;
      if (!TG.has(tid)) TG.set(tid, []);
      TG.get(tid).push({ id: e.id, date: e.date, season: e.season, f: null, i, me: null, op: null, opp: i ? e.home : e.away, home: i === 0, margin: i ? e.as - e.hs : e.hs - e.as, won: i ? e.as > e.hs : e.hs > e.as, noBox: true });
    }
  }
  for (const a of TG.values()) a.sort((x, y) => x.date.localeCompare(y.date));
  const logit = (p) => Math.log(p / (1 - p)), expit = (x) => 1 / (1 + Math.exp(-x));
  const rec = (rows) => { const w = rows.filter((r) => r.won).length; return { n: rows.length, w, l: rows.length - w, ids: rows.slice(-15).map((r) => r.id) }; };
  // z-score of a record against a baseline win rate
  const zOf = (w, n, p0) => { const p = clamp(p0, 0.15, 0.85); return n ? (w - n * p) / Math.sqrt(n * p * (1 - p)) : 0; };
  const rk = (tid, k) => SC.tRank[k]?.get(tid) ?? null;
  const tm = (tid) => SC.teamMetric.get(tid);

  // ------------------------------------------------------------------ previous meetings
  function decidedText(id) {
    const d = details[id]; if (!d) return null;
    const lab = { pace: "game pace", shooting: "shot-making", overtime: "overtime", turnovers: "turnovers", lineup: "who actually played" };
    const parts = [];
    for (const t of d.teams) for (const [k, v] of Object.entries(t.why)) if (k !== "other" && Math.abs(v) >= 4) parts.push({ v, txt: `${ab(t.tid)} ${lab[k]} ${sign(v)}` });
    parts.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return parts.length ? `Versus the projection: ${parts.slice(0, 3).map((p) => p.txt).join(", ")} points.` : "No single cause moved a team's score by 4 or more points versus the projection.";
  }
  function factEdges(f) {
    // counted stat edges of the winner, largest first
    const w = f.hs > f.as ? 0 : 1, a = f.s[w], b = f.s[1 - w], out = [];
    const push = (gap, txt) => out.push({ gap, txt });
    push((a.tp[0] - b.tp[0]) * 3, `threes ${a.tp[0]}-${b.tp[0]} made`);
    push(a.ft[0] - b.ft[0], `free throws ${a.ft[0]}-${b.ft[0]} made`);
    push(a.paint - b.paint, `paint points ${a.paint}-${b.paint}`);
    push((b.tov - a.tov) * 1.1, `turnovers ${a.tov}-${b.tov}`);
    push((a.oreb - b.oreb) * 1.1, `offensive rebounds ${a.oreb}-${b.oreb}`);
    push(a.fb - b.fb, `fast-break points ${a.fb}-${b.fb}`);
    return out.filter((x) => x.gap >= 4).sort((x, y) => y.gap - x.gap).slice(0, 3).map((x) => x.txt);
  }
  function meetings(A, B) {
    const rows = [];
    for (const f of ZS.facts.values()) if ((f.home === A && f.away === B) || (f.home === B && f.away === A)) rows.push(f);
    for (const e of scoreOnly) if ((e.home === A && e.away === B) || (e.home === B && e.away === A)) rows.push(e); // final score only
    rows.sort((x, y) => x.date.localeCompare(y.date));
    return rows;
  }
  function h2hBlock(A, B) {
    const all = meetings(A, B);
    const games = all.map((f) => {
      if (f.noBox) return { id: f.id, date: f.date, phase: phaseLabel(f.season, f.stype), pre: f.stype === 1, home: f.home, away: f.away, hs: f.hs, as: f.as, ot: 0, winner: f.hs > f.as ? f.home : f.away, noBox: true,
        pred: null, called: null, marginErr: null, decided: "Final score only: ESPN has no box score for this game, so it was not projected and has no game numbers.", edges: null, swing: null, q: null, lead: null, lc: null, clutch: null, tp: null, reb: null, tov: null, paint: null, ft: null };
      const r = resById.get(f.id), win = f.hs > f.as ? f.home : f.away, edges = factEdges(f);
      let swingQ = null;
      if (f.s[0].q && f.s[1].q) { let best = 0; for (let k = 0; k < 4; k++) { const d = (f.s[0].q[k] || 0) - (f.s[1].q[k] || 0); if (Math.abs(d) > Math.abs(best)) { best = d; swingQ = { q: k + 1, t: d > 0 ? f.home : f.away, by: Math.abs(d) }; } } }
      return { id: f.id, date: f.date, phase: phaseLabel(f.season, f.stype), pre: f.stype === 1, home: f.home, away: f.away, hs: f.hs, as: f.as, ot: f.ot, winner: win,
        pred: r ? r.pred : null, called: r ? r.correct : null, marginErr: r ? r.err : null,
        decided: decidedText(f.id), edges: edges.length ? `${ab(win)} won ${edges.join(", ")}.` : null, swing: swingQ,
        q: f.s[0].q && f.s[1].q ? [f.s[0].q, f.s[1].q] : null, lead: [f.s[0].lead, f.s[1].lead], lc: f.lc, clutch: f.clutch,
        tp: [f.s[0].tp, f.s[1].tp], reb: [f.s[0].oreb + f.s[0].dreb, f.s[1].oreb + f.s[1].dreb], tov: [f.s[0].tov, f.s[1].tov], paint: [f.s[0].paint, f.s[1].paint], ft: [f.s[0].ft, f.s[1].ft] };
    });
    const real = games.filter((g) => !g.pre);
    const wA = real.filter((g) => g.winner === A).length;
    const proj = real.filter((g) => g.pred);
    const patterns = [];
    if (real.length >= 2) {
      const mA = mean(real.map((g) => (g.home === A ? g.hs - g.as : g.as - g.hs)));
      patterns.push(`${ab(A)} ${wA}-${real.length - wA} ${ab(B)} in ${real.length} meetings ${sinceTxt}; average margin ${ab(mA >= 0 ? A : B)} by ${round(Math.abs(mA))}.`);
      const homeW = real.filter((g) => g.winner === g.home).length;
      patterns.push(`The home team won ${homeW} of ${real.length}.`);
      if (proj.length >= 2) { const hit = proj.filter((g) => g.called).length; patterns.push(`The projection picked the winner in ${hit} of ${proj.length}; average margin miss ${round(mean(proj.map((g) => g.marginErr)))} points.`); }
      const withBox = real.filter((g) => !g.noBox);
      const cl = withBox.filter((g) => g.clutch); if (cl.length) patterns.push(`${cl.length} of ${withBox.length} were within 5 points in the last 5 minutes.`);
    }
    const noBox = real.filter((g) => g.noBox).length;
    if (noBox) patterns.push(`${noBox} meeting${noBox === 1 ? " has" : "s have"} a final score only (ESPN has no box score for ${noBox === 1 ? "it" : "them"}): counted in the record, not in the stat patterns.`);
    return { n: real.length, noBox, preseason: games.length - real.length, record: { [A]: wA, [B]: real.length - wA }, games: games.reverse(), patterns,
      note: "Every finished meeting since the 2025-26 preseason, newest first, including games ESPN has no box score for (noBox: final score only). pred / called are the walk-forward projection made before that game. decided = the stored error breakdown; edges = counted box-score gaps of the winner." };
  }

  // ------------------------------------------------------------------ scenarios
  const WIN_TXT = (season) => (season ? `this season` : sinceTxt);
  function teamRows(tid, seasonOnly) { const a = TG.get(tid) || []; return seasonOnly ? a.filter((r) => r.season === lastSeason) : a; }
  // Pick this season when the condition has MIN.team games there, otherwise everything since Oct 2025.
  // A conditional record is compared with what the same condition does to EVERY team: lg = the
  // league-wide win rate under it (all team-games with a box score since October 2025), exp = that
  // rate moved by the team's own overall record (on the log-odds scale), so a strong team is not
  // credited for simply being strong and "trails at half-time" is not read against 50%.
  const lgCond = new Map();
  function leagueRate(c) {
    if (!lgCond.has(c.id)) { let n = 0, w = 0; for (const rows of TG.values()) for (const r of rows) if (r.me && c.test(r)) { n++; if (r.won) w++; } lgCond.set(c.id, { n, w, p: n ? w / n : 0.5 }); }
    return lgCond.get(c.id);
  }
  function condRecord(tid, c) {
    const lg = leagueRate(c);
    for (const seasonOnly of [true, false]) {
      const base = teamRows(tid, seasonOnly), rows = base.filter((r) => r.me && c.test(r));
      if (rows.length >= MIN.team || !seasonOnly) {
        const r = rec(rows), b = rec(base), pb = clamp(b.n ? (b.w + 1) / (b.n + 2) : 0.5, 0.1, 0.9);
        const exp = expit(logit(clamp(lg.p, 0.05, 0.95)) + logit(pb));
        return { ...r, base: b, lg, exp, when: WIN_TXT(seasonOnly), z: zOf(r.w, r.n, exp), gap: r.n ? r.w / r.n - exp : 0 };
      }
    }
    return null;
  }
  const rebOf = (s) => s.oreb + s.dreb;
  const tp3 = (s) => (s.tp[1] ? s.tp[0] / s.tp[1] : 0);
  const q1 = (r) => (r.me.q && r.op.q ? r.me.q[0] - r.op.q[0] : 0);
  const half = (r) => (r.me.q && r.op.q ? r.me.q[0] + r.me.q[1] - r.op.q[0] - r.op.q[1] : 0);
  // condition on team X's game, and the opponent trait (as of today) that makes it likely tonight
  const CONDS = [
    { id: "lostReb", when: "it is outrebounded", test: (r) => rebOf(r.me) < rebOf(r.op), trait: (y) => (rk(y, "orb") <= 10 ? `${ab(y)} rebounds ${round(tm(y).orb * 100)}% of its own misses (${ord(rk(y, "orb"))} in the league)` : null) },
    { id: "wonReb", when: "it wins the rebounding battle", test: (r) => rebOf(r.me) > rebOf(r.op), trait: (y) => (rk(y, "drb") >= 21 ? `${ab(y)} is ${ord(rk(y, "drb"))} in defensive rebound rate (${round(tm(y).drb * 100)}%)` : null) },
    { id: "tov15", when: "it commits 15 or more turnovers", test: (r) => r.me.tov >= 15, trait: (y) => (rk(y, "oppTovPer100") <= 10 ? `${ab(y)} forces ${round(tm(y).oppTovPer100)} turnovers per 100 possessions (${ord(rk(y, "oppTovPer100"))} most)` : null) },
    { id: "force15", when: "it forces 15 or more turnovers", test: (r) => r.op.tov >= 15, trait: (y) => (rk(y, "tovPer100") >= 21 ? `${ab(y)} commits ${round(tm(y).tovPer100)} per 100 possessions (${ord(31 - rk(y, "tovPer100"))} most)` : null) },
    { id: "opp15threes", when: "its opponent makes 15 or more threes", test: (r) => r.op.tp[0] >= 15, trait: (y) => (rk(y, "tpar") <= 10 ? `${ab(y)} takes ${round(tm(y).tpar * 100)}% of its shots from three (${ord(rk(y, "tpar"))} most)` : null) },
    { id: "own15threes", when: "it makes 15 or more threes", test: (r) => r.me.tp[0] >= 15, trait: (y) => (rk(y, "oppTpar") >= 21 ? `${ab(y)} lets opponents take ${round(tm(y).oppTpar * 100)}% of their shots from three (${ord(31 - rk(y, "oppTpar"))} most)` : null) },
    { id: "oppPaint54", when: "its opponent scores 54 or more in the paint", test: (r) => r.op.paint >= 54, trait: (y) => { const k = SC.zRanks.offShare[0].get(y); return k <= 10 ? `${ab(y)} takes the ${ord(k)} largest share of its shots at the rim` : null; } },
    { id: "ownPaint54", when: "it scores 54 or more in the paint", test: (r) => r.me.paint >= 54, trait: (y) => { const k = SC.zRanks.defPct[0].get(y); return k >= 21 ? `${ab(y)} allows the ${ord(31 - k)} highest FG% at the rim` : null; } },
    { id: "oppFb18", when: "its opponent scores 18 or more fast-break points", test: (r) => r.op.fb >= 18, trait: (y) => (rk(y, "traPg") <= 10 ? `${ab(y)} is ${ord(rk(y, "traPg"))} in early-offence scoring (${round(tm(y).traPg)} points a game within 6 seconds of a stop)` : null) },
    { id: "ftGap", when: "it attempts fewer free throws than its opponent", test: (r) => r.me.ft[1] < r.op.ft[1], trait: (y) => (rk(y, "ftr") <= 10 ? `${ab(y)} is ${ord(rk(y, "ftr"))} in free throws per shot` : null) },
    { id: "trailQ1", when: "it trails after the first quarter", test: (r) => q1(r) < 0, trait: (y) => (rk(y, "q0") <= 10 ? `${ab(y)} wins first quarters by ${sign(tm(y).qNet[0])} on average (${ord(rk(y, "q0"))})` : null) },
    { id: "leadQ1", when: "it leads after the first quarter", test: (r) => q1(r) > 0, trait: (y) => (rk(y, "q0") >= 21 ? `${ab(y)} loses first quarters by ${round(Math.abs(tm(y).qNet[0]))} on average (${ord(rk(y, "q0"))})` : null) },
    { id: "trailHalf", when: "it trails at half-time", test: (r) => half(r) < 0, trait: () => null },
    { id: "cold3", when: "it shoots under 33% from three", test: (r) => r.me.tp[1] >= 15 && tp3(r.me) < 0.33, trait: () => null },
    { id: "hot3", when: "it shoots 40% or better from three", test: (r) => r.me.tp[1] >= 15 && tp3(r.me) >= 0.4, trait: () => null },
    { id: "clutch", when: "the game is within 5 points in the last 5 minutes", test: (r) => r.f.clutch === true, trait: (y, pred) => (pred.shape.close >= 0.28 ? `the projection gives a ${Math.round(pred.shape.close * 100)}% chance of a finish within 5` : null) },
    { id: "fast", when: "the game has 102 or more possessions", test: (r) => r.f.poss >= 102, trait: (y, pred) => (pred.expPace >= 101.5 ? `the projected pace is ${round(pred.expPace)} possessions` : null) },
    { id: "slow", when: "the game has 96 or fewer possessions", test: (r) => r.f.poss <= 96, trait: (y, pred) => (pred.expPace <= 97 ? `the projected pace is ${round(pred.expPace)} possessions` : null) },
  ];

  function scenariosFor(A, B, pred, hb) {
    const out = [];
    // games keeps only ids that have a games/<id>.json page (a team's first three games on record were not projected)
    const push = (o) => { if (o.n >= 1) out.push({ ...o, games: (o.games || []).filter((id) => details[id]), sample: sampleOf(o.n), strength: round(o.strength, 2) }); };
    const sides = [[A, B, pred.h], [B, A, pred.a]];
    const realAll = hb.games.filter((g) => !g.pre).slice().reverse(); // oldest first, every finished meeting
    const real = realAll.filter((g) => !g.noBox);                     // meetings with a box score (stat patterns)

    // ---- A. previous meetings ----
    if (realAll.length >= MIN.h2h) {
      const nAll = realAll.length, wAll = realAll.filter((g) => g.winner === A).length, nb = nAll - real.length;
      if (wAll !== nAll - wAll) { const X = wAll > nAll - wAll ? A : B, w = Math.max(wAll, nAll - wAll);
        push({ kind: "h2h", t: `${ab(X)} has won ${w} of the ${nAll} meetings ${sinceTxt}.`, ev: realAll.map((g) => `${ab(g.home)} ${g.hs}-${g.as} ${ab(g.away)}`).join("; ") + (nb ? `. ${nb} of them ${nb === 1 ? "has" : "have"} a final score only (no box score on ESPN).` : ""), n: nAll, games: realAll.map((g) => g.id), fav: X, known: true, strength: Math.abs(zOf(w, nAll, 0.5)) }); }
    }
    if (real.length >= MIN.h2h) {
      const n = real.length;
      const proj = real.filter((g) => g.pred);
      if (proj.length >= MIN.h2h) {
        const d = proj.map((g) => { const act = g.hs - g.as, pm = g.pred.hs - g.pred.as; return g.home === A ? act - pm : pm - act; }), m = mean(d);
        if (Math.abs(m) >= 3) { const X = m > 0 ? A : B;
          push({ kind: "h2h", t: `${ab(X)} has beaten its projected margin by ${round(Math.abs(m))} points on average in ${proj.length} meetings with ${ab(X === A ? B : A)}.`, ev: `Actual minus projected margin, game by game: ${d.map((v) => sign(X === A ? v : -v)).join(", ")}.`, n: proj.length, games: proj.map((g) => g.id), fav: X, known: true, strength: Math.abs(m) / (13 / Math.sqrt(proj.length)) }); }
      }
      // "the team that won battle X won k of n"
      const idx = (g, tid) => (g.home === tid ? 0 : 1);
      const BATTLES = [
        ["won the rebounding battle", (g, i) => g.reb[i] - g.reb[1 - i], (x) => (rk(x, "orb") + rk(x, "drb")) / 2, "rebounding rank (offensive and defensive rate)"],
        ["made more threes", (g, i) => g.tp[i][0] - g.tp[1 - i][0], (x) => rk(x, "tpar"), "three-point attempt rate rank"],
        ["committed fewer turnovers", (g, i) => g.tov[1 - i] - g.tov[i], (x) => rk(x, "tovPer100"), "turnover rate rank"],
        ["scored more in the paint", (g, i) => g.paint[i] - g.paint[1 - i], (x) => SC.zRanks.offShare[0].get(x), "share of shots at the rim rank"],
        ["made more free throws", (g, i) => g.ft[i][0] - g.ft[1 - i][0], (x) => rk(x, "ftr"), "free-throw rate rank"],
        ["led after the first quarter", (g, i) => (g.q ? g.q[i][0] - g.q[1 - i][0] : 0), (x) => rk(x, "q0"), "first-quarter margin rank"],
        ["led at half-time", (g, i) => (g.q ? g.q[i][0] + g.q[i][1] - g.q[1 - i][0] - g.q[1 - i][1] : 0), (x) => (rk(x, "q0") + rk(x, "q1")) / 2, "first-half margin rank"],
      ];
      for (const [label, diff, rankFn, rankTxt] of BATTLES) {
        const dec = real.filter((g) => diff(g, 0) !== 0);
        if (dec.length < MIN.h2h) continue;
        const k = dec.filter((g) => (diff(g, 0) > 0 ? g.home : g.away) === g.winner).length;
        if (k / dec.length < 0.75) continue;
        // Who it favours: the team that actually won this battle in most of the meetings. Only when
        // the meetings are split does the season rank decide, and the evidence line says so.
        const bA = dec.filter((g) => diff(g, idx(g, A)) > 0).length, bB = dec.length - bA;
        const ra = rankFn(A), rb = rankFn(B);
        const rankTxt2 = `${rankTxt}, ${SC.scopeLabel}: ${ab(A)} ${ra != null ? ord(Math.round(ra)) : "n/a"}, ${ab(B)} ${rb != null ? ord(Math.round(rb)) : "n/a"}`;
        let fav = null, ev;
        if (bA !== bB) { fav = bA > bB ? A : B; ev = `${ab(fav)} ${label} in ${Math.max(bA, bB)} of those ${dec.length} meetings. Season context (${rankTxt2}).`; }
        else { fav = ra != null && rb != null && Math.abs(ra - rb) >= 5 ? (ra < rb ? A : B) : null; ev = `Each side ${label} in ${bA} of them, so the meetings do not pick a side; ${fav ? `the season rank favours ${ab(fav)}` : "neither does the season rank"} (${rankTxt2}).`; }
        push({ kind: "h2h", t: `The team that ${label} won ${k} of ${dec.length} meetings.`, ev,
          n: dec.length, games: dec.map((g) => g.id), fav, known: false, strength: Math.abs(zOf(k, dec.length, 0.5)) * (fav ? 1 : 0.6) });
      }
      // thresholds on one team's line: "when X shot under 34% from three, Y won 3 of 3"
      for (const [X, Y] of [[A, B], [B, A]]) {
        const TH = [
          [`${ab(X)} shot under 34% from three`, (g) => { const s = g.tp[idx(g, X)]; return s[1] >= 15 && s[0] / s[1] < 0.34; }, Y],
          [`${ab(X)} shot 38% or better from three`, (g) => { const s = g.tp[idx(g, X)]; return s[1] >= 15 && s[0] / s[1] >= 0.38; }, X],
          [`${ab(X)} committed 15 or more turnovers`, (g) => g.tov[idx(g, X)] >= 15, Y],
          [`${ab(X)} scored 50 or more in the paint`, (g) => g.paint[idx(g, X)] >= 50, X],
          [`${ab(X)} was held under 110`, (g) => (g.home === X ? g.hs : g.as) < 110, Y],
        ];
        for (const [label, test, exp] of TH) {
          const sub = real.filter(test); if (sub.length < MIN.h2h || sub.length === real.length) continue;
          const k = sub.filter((g) => g.winner === exp).length; if (k / sub.length < 0.75) continue;
          const other = real.filter((g) => !test(g)), ko = other.filter((g) => g.winner === exp).length;
          if (k / sub.length - ko / other.length < 0.3) continue; // little different from the rest of the series (3 of 3 against 3 of 4): says nothing about the condition
          push({ kind: "h2h", t: `When ${label}, ${ab(exp)} won ${k} of ${sub.length} meetings.`, ev: `In the other ${other.length} meeting${other.length === 1 ? "" : "s"} ${ab(exp)} won ${ko}.`, n: sub.length, games: sub.map((g) => g.id), fav: exp, known: false, strength: Math.abs(zOf(k, sub.length, 0.5)) * 0.8 });
        }
      }
      // quarters: "X won the third quarter in 5 of 7 meetings"
      for (let q = 0; q < 4; q++) {
        const withQ = real.filter((g) => g.q && g.q[0][q] != null && g.q[1][q] != null);
        if (withQ.length < MIN.h2h) continue;
        const dA = withQ.map((g) => (g.home === A ? g.q[0][q] - g.q[1][q] : g.q[1][q] - g.q[0][q]));
        const kA = dA.filter((v) => v > 0).length, kB = dA.filter((v) => v < 0).length, k = Math.max(kA, kB), X = kA >= kB ? A : B;
        if (k / withQ.length < 0.75) continue;
        const avg = mean(dA) * (X === A ? 1 : -1);
        push({ kind: "h2h", t: `${ab(X)} won the ${["first", "second", "third", "fourth"][q]} quarter in ${k} of ${withQ.length} meetings (average ${sign(avg)}).`, ev: `Quarter margins for ${ab(X)}, oldest first: ${dA.map((v) => sign(X === A ? v : -v, 0)).join(", ")}. All quarters this ${SC.scopeLabel.includes("and") ? "window" : "season"}: ${ab(A)} ${sign(tm(A)?.qNet[q] ?? 0)} a game, ${ab(B)} ${sign(tm(B)?.qNet[q] ?? 0)}.`,
          n: withQ.length, games: withQ.map((g) => g.id), fav: X, known: false, strength: Math.abs(zOf(k, withQ.length, 0.5)) * 0.7 });
      }
      // team shooting by zone in the meetings versus its usual
      const rawMeet = meetings(A, B).filter((f) => !f.noBox && f.stype !== 1 && f.s[0].z && f.s[1].z);
      if (rawMeet.length >= MIN.h2h) for (const [X, Y] of [[A, B], [B, A]]) {
        const usual = SC.teamWin.get(X)?.R; if (!usual) continue;
        const ua = SC.five(usual.offA), um = SC.five(usual.offM);
        for (let i = 0; i < 5; i++) {
          let m = 0, a = 0; for (const f of rawMeet) { const z = f.s[f.home === X ? 0 : 1].z[i]; m += z[0]; a += z[1]; }
          if (a < 50 || ua[i] < 300) continue;
          const here = m / a, u = um[i] / ua[i], d = here - u, z = d / Math.sqrt(u * (1 - u) / a);
          if (Math.abs(d) < 0.05 || Math.abs(z) < 1.6) continue;
          push({ kind: "h2h", t: `In ${rawMeet.length} meetings ${ab(X)} has shot ${round(here * 100)}% ${ZTXT[Z5[i]]} against ${ab(Y)} (${m} of ${a}); its usual is ${round(u * 100)}%.`, ev: `${ab(X)}'s usual: ${um[i]} of ${ua[i]} (${SC.windowLabel}). ${ab(Y)} allows ${SC.teamZonePct(Y, i)}% there to everyone (${rw(SC.zRanks.defPct[i].get(Y), "lowest", "highest")} of 30).`,
            n: rawMeet.length, games: rawMeet.map((f) => f.id), fav: d > 0 ? X : Y, known: true, strength: Math.abs(z) * 0.6 });
        }
      }
      const cl = real.filter((g) => g.clutch);
      if (cl.length >= MIN.h2h) { const k = cl.filter((g) => g.winner === A).length; if (k !== cl.length - k) { const X = k > cl.length - k ? A : B, w = Math.max(k, cl.length - k);
        push({ kind: "h2h", t: `${cl.length} of the ${n} meetings were within 5 points in the last 5 minutes; ${ab(X)} won ${w} of them.`, ev: `Projection for this game: ${Math.round(pred.shape.close * 100)}% chance of a finish within 5.`, n: cl.length, games: cl.map((g) => g.id), fav: X, known: false, strength: Math.abs(zOf(w, cl.length, 0.5)) * 0.8 }); } }
    }

    // ---- B. conditional records crossed with what the opponent does ----
    for (const [X, Y] of [[A, B], [B, A]]) {
      if (!tm(X) || !tm(Y)) continue;
      for (const c of CONDS) {
        const r = condRecord(X, c); if (!r || r.n < MIN.team) continue;
        let trait = null; try { trait = c.trait(Y, pred); } catch { trait = null; }
        if (Math.abs(r.gap) < 0.15 || Math.abs(r.z) < (trait ? 1 : 1.6)) continue;
        // better than a team of its record usually does in that spot -> a strength of X; worse -> a spot for Y
        const fav = r.gap < 0 ? Y : X, p100 = (v) => Math.round(v * 100);
        push({ kind: trait ? "team" : "teamIf", t: `${ab(X)} is ${r.w}-${r.l} ${r.when} when ${c.when} (${p100(r.w / r.n)}%; teams league-wide win ${p100(r.lg.p)}% of such games)${trait ? `. That is more likely than usual here: ${trait}` : ""}.`,
          ev: `League-wide ${sinceTxt}: ${r.lg.w}-${r.lg.n - r.lg.w} in ${r.lg.n} team-games when that happens. ${ab(X)} overall ${r.when}: ${r.base.w}-${r.base.l}, so a team of its record would be expected to win about ${p100(r.exp)}% of them; ${ab(X)} is ${r.gap > 0 ? "above" : "below"} that by ${Math.abs(p100(r.w / r.n) - p100(r.exp))} points.${trait ? " The condition has not happened yet; it is only more likely than usual." : " Nothing in the opponent's profile makes this more likely than usual; it applies only if it happens."}`,
          n: r.n, games: r.ids, fav, known: false, likely: !!trait, trait: trait || null, cond: c.id, strength: Math.abs(r.z) * (trait ? 1 : 0.55) });
      }
    }

    // ---- C. situations that are known before tip-off (schedule, absences, opponent style) ----
    for (const [X, Y, side] of sides) {
      const past = (TG.get(X) || []).filter((r) => details[r.id]);
      const baseAll = rec(past);
      for (const k of side.teamScen) {
        if (k === "preseason") continue;
        const rows = past.filter((r) => details[r.id].teams.find((t) => t.tid === X)?.scen.includes(k));
        if (rows.length < MIN.team) continue;
        const r = rec(rows), z = zOf(r.w, r.n, baseAll.n ? baseAll.w / baseAll.n : 0.5);
        const vsProj = mean(rows.map((q) => { const d = details[q.id]; const pm = d.pred.hs - d.pred.as; return q.margin - (q.home ? pm : -pm); }));
        if (Math.abs(z) < 1 && Math.abs(vsProj) < 3) continue;
        const good = Math.abs(vsProj) >= 3 ? vsProj > 0 : z > 0;
        const phrase = SCEN_PHRASE[k] || (k.startsWith("vs ") ? `against teams tagged "${k.slice(3)}"` : `in games tagged "${k}"`);
        const le = learn.teamScen[k];
        // one situation, one line: the team's own record and the league-wide learned effect are
        // shown together; when they point in opposite directions the line favours neither side
        const leSig = le && le.n >= 30 && Math.abs(le.w) >= 0.35 && !k.startsWith("vs "), mixed = !!leSig && (le.w > 0) !== good;
        push({ kind: k.startsWith("vs ") ? "style" : "schedule", t: `${ab(X)} is ${r.w}-${r.l} ${sinceTxt} ${phrase} (${sign(vsProj)} points versus its projected margin on average); that applies to this game.${mixed ? ` League-wide, teams in that spot have scored ${sign(le.w, 2)} points versus projection, which points the other way: mixed evidence.` : ""}`,
          ev: `${ab(X)} overall in projected games: ${baseAll.w}-${baseAll.l}.${le ? ` League-wide learned effect of this situation on a team's score: ${sign(le.w, 2)} points (${le.n} team-games).` : ""}${k.startsWith("vs ") ? ` ${ab(Y)} carries the "${k.slice(3)}" tag today.` : ""}`,
          n: r.n, games: r.ids, fav: mixed ? null : good ? X : Y, mixed, known: true, strength: Math.max(Math.abs(z), Math.abs(vsProj) / (13 / Math.sqrt(r.n))) * (mixed ? 0.7 : 1) });
      }
      // record with and without each absent regular
      for (const o of side.S.teamOut.filter((q) => q.ppg >= 10)) {
        // every team game from his first appearance for X in which he logged no minutes counts as
        // "without", whether or not the box score listed him (inactive players are usually not listed)
        const { w: wi, wo, cd } = withWithoutGames(X, o.id);
        if (wo.length < MIN.player || wi.length < 5) continue;
        const w0 = wo.filter((r) => r.margin > 0).length, w1 = wi.filter((r) => r.margin > 0).length;
        const z = zOf(w0, wo.length, w1 / wi.length);
        push({ kind: "absence", t: `${ab(X)} is ${w0}-${wo.length - w0} in the ${wo.length} games ${o.n} has missed and ${w1}-${wi.length - w1} with him ${sinceTxt}; he is listed out.`, ev: `Counted from his first game for ${ab(X)} (no preseason). Average margin ${sign(mean(wo.map((r) => r.margin)))} without, ${sign(mean(wi.map((r) => r.margin)))} with. He averages ${round(o.ppg)} points.${cd ? ` ${cd} of the missed games ${cd === 1 ? "was a coach's decision" : "were coach's decisions"}.` : ""} Other absences and opponents in those games are not separated out.`,
          n: wo.length, games: wo.slice(-15).map((r) => r.gid), fav: z < 0 ? Y : X, known: true, strength: Math.abs(z) });
      }
    }

    // ---- D. players against this opponent ----
    for (const [X, Y, side] of sides) {
      for (const pl of side.proj.filter((q) => q.proj.pts >= 11).slice(0, 7)) {
        // every game he played since October 2025 (box scores, no preseason), not only the projected ones
        const mine = (P.get(pl.id)?.recs || []).filter((r) => r.min > 0 && r.stype !== 1);
        const vs = mine.filter((r) => r.opp === Y);
        if (vs.length >= MIN.player && mine.length >= 12) {
          const others = mine.filter((r) => r.opp !== Y);
          const avg = mean(vs.map((r) => r.pts)), norm = mean(others.map((r) => r.pts)), d = avg - norm;
          const prj = playerGameRes.filter((r) => r.id === pl.id && r.opp === Y); // the projected ones among them
          const s = Math.max(4, sd(others.map((r) => r.pts)));
          if (Math.abs(d) >= 3 && Math.abs(d) / (s / Math.sqrt(vs.length)) >= 1) {
            push({ kind: "player", t: `${pl.n} averages ${round(avg)} points in ${vs.length} games against ${ab(Y)}, ${sign(d)} versus his ${round(norm)} against everyone else.`, ev: `Game by game: ${vs.map((r) => r.pts).join(", ")}.${prj.length ? ` Versus the projection made before the game, in the ${prj.length} of them that were projected: ${sign(mean(prj.map((r) => r.rp)))} on average.` : ""} Other games: ${others.length}.`,
              n: vs.length, games: vs.map((r) => r.gid), fav: d > 0 ? X : Y, known: true, pid: pl.id, strength: Math.abs(d) / (s / Math.sqrt(vs.length)) * 0.8 });
          }
        }
        // zone results against this opponent
        const zv = ZS.players.get(pl.id)?.vs?.[Y], zw = SC.playerZoneWindow(pl.id);
        if (zv && zv.g >= MIN.player && zw) {
          for (let i = 0; i < 5; i++) {
            if (zv.fa[i] < 15 || zw.a[i] < 60) continue;
            const here = zv.fm[i] / zv.fa[i], usual = zw.m[i] / zw.a[i], d = here - usual, z = d / Math.sqrt(usual * (1 - usual) / zv.fa[i]);
            if (Math.abs(d) < 0.08 || Math.abs(z) < 1.5) continue;
            push({ kind: "player", t: `${pl.n} has shot ${round(here * 100)}% ${ZTXT[Z5[i]]} against ${ab(Y)} (${zv.fm[i]} of ${zv.fa[i]} in ${zv.g} games); his usual is ${round(usual * 100)}%.`, ev: `His usual: ${zw.m[i]} of ${zw.a[i]} ${sinceTxt}. ${ab(Y)} allows ${SC.teamZonePct(Y, i)}% there to everyone (${rw(SC.zRanks.defPct[i].get(Y), "lowest", "highest")} of 30).`,
              n: zv.g, games: zv.gids.slice(-15), fav: d > 0 ? X : Y, known: true, pid: pl.id, strength: Math.abs(z) * 0.6 });
          }
        }
        // his scoring in the games an absent teammate missed: plain counts with the games linked
        for (const w of pl.adj.wwD || []) {
          const d = w.without.ppg - w.with.ppg;
          const regular = side.S.teamOut.find((q) => q.id === w.id); // only for absent regulars (10+ points or 20+ minutes a game)
          if (!regular || !(regular.ppg >= 10 || regular.min >= 20) || Math.abs(d) < 2 || w.without.n < MIN.player) continue;
          push({ kind: "absence", t: `${pl.n} has averaged ${round(w.without.ppg)} points in the ${w.without.n} games ${w.n} missed and ${round(w.with.ppg)} in ${w.with.n} games with him (${round(w.without.mpg)} and ${round(w.with.mpg)} minutes).`,
            ev: `${w.n} is listed out. Same team, this season and last, from ${w.n}'s first game for it; games he sat out by coach's decision are not counted. This is shown as evidence only: it is not added to the projection, because the back-test is more accurate without it (learning.json > withWithout).`,
            n: w.without.n, games: w.without.gids.slice(-15), fav: d > 0 ? X : Y, known: true, pid: pl.id, strength: Math.abs(d) / (7 / Math.sqrt(w.without.n)) * 0.6 });
        }
      }
    }

    // ---- E. recent form against the projection ----
    for (const [X, Y] of [[A, B], [B, A]]) {
      const res = getT(X).res.slice(-10); if (res.length < 8) continue;
      const net = res.map((r) => r.off - r.def), k = net.filter((v) => v > 0).length, m = mean(net);
      if (Math.abs(m) >= 4 && (k >= 7 || k <= 3)) push({ kind: "form", t: `${ab(X)} has ${m > 0 ? "beaten" : "fallen short of"} its projected margin in ${m > 0 ? k : res.length - k} of its last ${res.length} games (${sign(m)} points on average).`, ev: "Actual margin minus the margin projected before each game.", n: res.length, games: res.map((r) => r.gid), fav: m > 0 ? X : Y, known: true, strength: Math.abs(m) / (13 / Math.sqrt(res.length)) });
    }

    // sort: strength first; keep variety by limiting each kind
    out.sort((a, b) => b.strength - a.strength);
    const cap = { h2h: 9, team: 6, teamIf: 4, schedule: 4, style: 4, absence: 4, player: 6, form: 2 }, cnt = {};
    const kept = out.filter((s) => { cnt[s.kind] = (cnt[s.kind] || 0) + 1; return cnt[s.kind] <= cap[s.kind]; }).slice(0, 26);
    return { min: MIN, list: kept, total: out.length,
      note: "Each line is a count over finished games. n = games behind it; games = ids of those that have a result page (a team's first three games on record and games without a box score have none). known = already true for this game (schedule, absence, history); otherwise it is an if-then that applies only if the condition happens. likely = an if-then whose condition the opponent's profile makes more likely than usual (trait says why); it has still not happened. mixed = the team's own record and the league-wide effect disagree, so it favours neither side. Conditional records are judged against the league-wide win rate under the same condition, adjusted for the team's record. sample: small 3-4 games, moderate 5-9, solid 10+. Small samples are patterns to watch, not facts." };
  }

  // ------------------------------------------------------------------ keys: why each side can win or lose
  function keysFor(A, B, pred, u) {
    const E = []; // edges: { fav, kind, t, n, pts }
    const mixedKeys = []; // situations where the league-wide effect and the team's own record disagree: listed, credited to neither side
    const add = (fav, kind, pts, t, n) => { if (fav && t) E.push({ fav, kind, pts: round(Math.abs(pts), 2), t, n }); };
    // What the back-test says about zone edges. The player-level zone factor is the only tested
    // form; a team-level zone edge is not tested at all, so a paper edge is weighted by the learned
    // coefficient (about a fifth of the paper figure) and never above 1 point.
    const zf = FXE.report().rows.find((r) => r.id === "zone" && r.stat === "pts");
    const zCoef = clamp(Math.abs(zf?.coef ?? 0.2), 0.05, 1);
    const zVerdict = !zf || zf.gate === 0 ? "the back-test has found no measurable effect from zone edges so far (the player-level factor is held at zero) and team-level zone edges are not tested, so this is a pattern to watch, not a proven edge"
      : `the back-test supports about ${Math.round(zf.coef * zf.gate * 100)}% of a player-level zone edge; team-level zone edges are not tested`;
    // the team's own record in a schedule spot (same count as the scenario list)
    const ownSpot = (X, k) => {
      const past = (TG.get(X) || []).filter((r) => details[r.id]);
      const rows = past.filter((r) => details[r.id].teams.find((t) => t.tid === X)?.scen.includes(k));
      if (rows.length < MIN.team) return null;
      const r = rec(rows), b = rec(past), z = zOf(r.w, r.n, b.n ? b.w / b.n : 0.5);
      const vsProj = mean(rows.map((q) => { const d = details[q.id]; const pm = d.pred.hs - d.pred.as; return q.margin - (q.home ? pm : -pm); }));
      if (Math.abs(z) < 1 && Math.abs(vsProj) < 3) return null;
      return { r, vsProj, good: Math.abs(vsProj) >= 3 ? vsProj > 0 : z > 0 };
    };
    const mA = tm(A), mB = tm(B);
    const paceDone = new Set();
    const margin = pred.margin, favT = margin >= 0 ? A : B;
    // 1. rating systems
    { const ms = MODEL_KEYS.map((k) => pred.models[k]), nFav = ms.filter((v) => (margin >= 0 ? v > 0 : v < 0)).length;
      const gA = getT(A).recs.filter((r) => r.season === lastSeason && r.stype !== 1).length, gB = getT(B).recs.filter((r) => r.season === lastSeason && r.stype !== 1).length;
      add(favT, "ratings", Math.abs(margin), `${nFav} of ${MODEL_KEYS.length} rating systems favour ${ab(favT)}; the blend has it by ${round(Math.abs(margin))} (${MODEL_KEYS.map((k) => `${MODEL_LABEL[k].split(" (")[0]} ${sign(margin >= 0 ? pred.models[k] : -pred.models[k])}`).join(", ")}).`, `${gA} + ${gB} games this season`);
      const ra = learn.rt[A], rb = learn.rt[B];
      if (ra && rb) { const na = ra.o - ra.d, nb = rb.o - rb.d; if (Math.abs(na - nb) >= 2) add(na > nb ? A : B, "ratings", Math.abs(na - nb) * 0.6, `Opponent-adjusted net rating: ${ab(A)} ${sign(na)} per 100 possessions, ${ab(B)} ${sign(nb)}.`, `${ra.n} and ${rb.n} rated games`); }
      if (pred.homeAdv > 0.3) add(A, "home", pred.homeAdv, `Home court for ${ab(A)}: worth ${round(pred.homeAdv)} points in this model, learned from every game walked.`, `${results.length} games`); }
    // 2. zone battle, both directions
    for (const [X, Y] of [[A, B], [B, A]]) {
      const wx = SC.teamWin.get(X)?.R, wy = SC.teamWin.get(Y)?.R; if (!wx || !wy) continue;
      const xa = SC.five(wx.offA), xm = SC.five(wx.offM), ya = SC.five(wy.defA), ym = SC.five(wy.defM), xt = xa.reduce((s, v) => s + v, 0) || 1, fgaPg = xt / wx.g;
      for (let i = 0; i < 5; i++) {
        if (ya[i] < 150 || xa[i] < 150) continue;
        const lg = SC.lg5.m[i] / SC.lg5.a[i], share = xa[i] / xt, dDef = ym[i] / ya[i] - lg, paper = share * fgaPg * ZVAL[i] * dDef;
        const rkDef = SC.zRanks.defPct[i].get(Y), rkShare = SC.zRanks.offShare[i].get(X);
        if (Math.abs(paper) < 0.7 || !(rkDef <= 8 || rkDef >= 23)) continue;
        add(paper > 0 ? X : Y, "zone", Math.min(1, Math.abs(paper) * zCoef), `${ab(X)} takes ${round(share * 100)}% of its shots ${ZTXT[Z5[i]]} (${rw(rkShare, "most", "fewest")}) and makes ${round(xm[i] / xa[i] * 100)}%; ${ab(Y)} allows ${round(ym[i] / ya[i] * 100)}% there (${rw(rkDef, "lowest", "highest")} of 30, league ${round(lg * 100)}%). On paper ${sign(paper)} points for ${ab(X)}; ${zVerdict}.`, `${xa[i]} shots taken, ${ya[i]} allowed`);
      }
    }
    // 3. four factors + volume
    if (mA && mB) {
      // [name, offence metric, defence metric, text for the offence (m, rank), text for the defence (m, rank), weight]
      // Ranks: 1 is always the best for that side (best shooting / fewest turnovers ... ; lowest allowed / most forced ...).
      const FF = [
        ["Shooting", "efg", "oppEfg", (m, r) => `shoots ${round(m.efg * 100)}% effective FG (${ord(r)} of 30)`, (m, r) => `allows ${round(m.oppEfg * 100)}% (${rw(r, "lowest", "highest")})`, 2.2],
        ["Turnovers", "tovPer100", "oppTovPer100", (m, r) => `commits ${round(m.tovPer100)} turnovers per 100 possessions (${rw(r, "fewest", "most")})`, (m, r) => `forces ${round(m.oppTovPer100)} (${rw(r, "most", "fewest")})`, 1.6],
        ["Rebounding", "orb", "drb", (m, r) => `rebounds ${round(m.orb * 100)}% of its own misses (${ord(r)} of 30)`, (m, r) => `secures ${round(m.drb * 100)}% of opponents' misses (${ord(r)} of 30)`, 1.6],
        ["Free throws", "ftr", "oppFtr", (m, r) => `takes ${round(m.ftr * 100, 0)} free throws per 100 shots (${rw(r, "most", "fewest")})`, (m, r) => `allows ${round(m.oppFtr * 100, 0)} (${rw(r, "fewest", "most")})`, 1.3],
        ["Three-point volume", "tpar", "oppTpar", (m, r) => `takes ${round(m.tpar * 100)}% of its shots from three (${rw(r, "most", "fewest")})`, (m, r) => `allows ${round(m.oppTpar * 100)}% (${rw(r, "fewest", "most")})`, 1.2],
        ["Early offence", "traPg", "traAPg", (m, r) => `scores ${round(m.traPg)} points a game within 6 seconds of a stop (${rw(r, "most", "fewest")})`, (m, r) => `allows ${round(m.traAPg)} (${rw(r, "fewest", "most")})`, 1.2],
      ];
      for (const [X, Y, mx, my] of [[A, B, mA, mB], [B, A, mB, mA]]) for (const [name, ko, kd, to, td, wgt] of FF) {
        const ro = rk(X, ko), rd = rk(Y, kd); if (ro == null || rd == null) continue;
        const txt = `${name}: ${ab(X)} ${to(mx, ro)}; ${ab(Y)} ${td(my, rd)}.`;
        if (ro <= 10 && rd >= 21) add(X, "fourFactors", wgt * (rd - ro) / 20, txt, `${mx.g} games each, ${SC.scopeLabel}`);
        else if (ro >= 21 && rd <= 10) add(Y, "fourFactors", wgt * (ro - rd) / 20, txt, `${mx.g} games each, ${SC.scopeLabel}`);
      }
      // pace
      const pa = rk(A, "pace"), pb = rk(B, "pace");
      if (pa != null && pb != null && Math.abs(pa - pb) >= 12) {
        const fast = pa < pb ? A : B, slow = fast === A ? B : A;
        for (const [X, tag] of [[slow, "Up-tempo"], [fast, "Slow-paced"]]) { const v = getT(X).vsStyle[tag]; if (v && v.n >= 5 && Math.abs((v.off - v.def) / v.n) >= 2.5 && pred[X === A ? "a" : "h"].S.style.tags.includes(tag)) { paceDone.add(`${X}|${tag}`); add((v.off - v.def) > 0 ? X : (X === A ? B : A), "pace", Math.abs((v.off - v.def) / v.n) * 0.5, `Pace clash: ${ab(fast)} plays at ${round(tm(fast).pace)} possessions a game (${rw(rk(fast, "pace"), "fastest", "slowest")}), ${ab(slow)} at ${round(tm(slow).pace)} (${rw(rk(slow, "pace"), "fastest", "slowest")}); projected pace ${round(pred.expPace)}. Against ${tag} teams ${ab(X)} has been ${sign((v.off - v.def) / v.n)} points versus its projected margin.`, `${v.n} games`); } }
      }
    }
    // 4. rest / travel situations with learned effects; style history; absences; form
    for (const [X, Y, side] of [[A, B, pred.h], [B, A, pred.a]]) {
      const oppScen = (X === A ? pred.a : pred.h).teamScen;
      for (const k of side.teamScen) {
        const le = learn.teamScen[k]; if (!le || le.n < 30 || Math.abs(le.w) < 0.35 || k.startsWith("vs ") || k === "preseason" || k === "early season") continue;
        // "X's opponent is on a back-to-back" and "Y is on a back-to-back" are one fact: it is told once, from Y's side
        if (k === "opponent on back-to-back" && oppScen.includes("back-to-back")) continue;
        let net = le.w, txt = `${ab(X)} is playing ${SCEN_PHRASE[k] || `in a "${k}" spot`}: teams in that spot have scored ${sign(le.w, 2)} points versus projection (learned effect)`, nTxt = `${le.n} team-games`;
        if (k === "back-to-back") { const lo = learn.teamScen["opponent on back-to-back"]; if (lo && lo.n >= 30) { net = le.w - lo.w; txt += ` and their opponents ${sign(lo.w, 2)}`; } }
        // the team's own record in the same spot: if it points the other way, the line is mixed evidence and credits neither side
        const own = ownSpot(X, k);
        if (own && own.good !== (net > 0)) { mixedKeys.push({ kind: "situation", t: `${txt}. ${ab(X)} itself is ${own.r.w}-${own.r.l} in that spot (${sign(own.vsProj)} points versus its projected margin), which points the other way: mixed evidence, counted for neither side.`, n: `${nTxt}; ${own.r.n} ${ab(X)} games` }); continue; }
        add(net > 0 ? X : Y, "situation", Math.abs(net), `${txt}.${own ? ` ${ab(X)} itself is ${own.r.w}-${own.r.l} in that spot (${sign(own.vsProj)} points versus its projected margin).` : ""}`, own ? `${nTxt}; ${own.r.n} ${ab(X)} games` : nTxt);
      }
      const tags = side.O.style.tags;
      for (const tg of tags) { const v = getT(X).vsStyle[tg]; if (!v || v.n < 5 || paceDone.has(`${X}|${tg}`)) continue; const net = (v.off - v.def) / v.n; if (Math.abs(net) < 3) continue;
        add(net > 0 ? X : Y, "style", Math.abs(net) * 0.5, `Against "${tg}" teams (as ${ab(Y)} is tagged) ${ab(X)} has been ${sign(net)} points versus its projected margin.`, `${v.n} games`); }
      for (const o of side.S.teamOut.filter((q) => q.ppg >= 10).slice(0, 3)) {
        const a = profById.get(String(o.id))?.absence;
        if (a && a.netSwing != null) add(a.netSwing >= 0 ? Y : X, "absence", (Math.abs(a.netSwing) * 0.5 + 0.5) * (a.netSwing >= 0 ? 1 : 0.5), `${ab(X)} is without ${o.n} (${round(o.ppg)} points a game): net rating ${sign(a.netWith)} per 100 with him, ${sign(a.netWithout)} without (swing ${sign(a.netSwing)} after shrinking for sample size). ${a.netSwing >= 0 ? "The team has been worse without him." : "So far the team's net rating has been better in the games he missed; other absences and opponents in those games are not separated out."}`, `${a.without} games without, ${a.with} with`);
        else add(Y, "absence", 0.5 + o.ppg / 12, `${ab(X)} is without ${o.n} (${round(o.ppg)} points a game). Too few games with and without him on this team to measure the effect yet (it needs 8 with and 3 without; he has ${a?.with ?? 0} with and ${a?.without ?? 0} without).`, `${a?.without ?? 0} games without, ${a?.with ?? 0} with`);
      }
      const res = getT(X).res.slice(-10);
      if (res.length >= 8) { const m = mean(res.map((r) => r.off - r.def)); if (Math.abs(m) >= 4) add(m > 0 ? X : Y, "form", Math.abs(m) * 0.4, `${ab(X)} has run ${sign(m)} points versus its projected margin over its last ${res.length} games.`, `${res.length} games`); }
      const hv = X === A ? getT(X).vsTeam[Y] : null; // once per pair (the away side would repeat it with the sign flipped)
      if (hv && hv.n >= 3 && Math.abs(hv.margin / hv.n) >= 4) add(hv.margin > 0 ? X : Y, "h2h", Math.abs(hv.margin / hv.n) * 0.4, `In ${hv.n} projected meetings ${ab(X)} has finished ${sign(hv.margin / hv.n)} points versus the projected margin against ${ab(Y)}.`, `${hv.n} meetings`);
      // 5. biggest individual zone matchups on paper
      const pl = side.proj.filter((q) => q.fin?.x && q.proj.min >= 20).map((q) => ({ q, paper: (q.fin.x.zone || 0) + (q.fin.x.rim || 0) })).sort((a, b) => Math.abs(b.paper) - Math.abs(a.paper))[0];
      if (pl && Math.abs(pl.paper) >= 1) { const z = [...pl.q.fin.zones].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
        add(pl.paper > 0 ? X : Y, "player", Math.min(1, Math.abs(pl.paper) * zCoef), `${pl.q.n}: ${round(z.att)} attempts ${ZTXT[z.z]} a game, where ${ab(Y)} allows ${sign(z.diff * 100)} points of FG% versus league (recent games weighted). Paper edge ${sign(pl.paper)} points; the learned factors move his published projection by ${sign(pl.q.fxNet ?? 0, 2)}, because ${zVerdict}.`, `his last ${Math.round(pl.q.fin.zp?.att || 0)} weighted attempts`); }
    }
    const side = (X) => {
      const Y = X === A ? B : A, top = (f) => E.filter((e) => e.fav === f).sort((a, b) => b.pts - a.pts).slice(0, 7).map(({ kind, t, n, pts }) => ({ kind, t, n, w: pts }));
      return { tid: X, win: top(X), lose: top(Y) };
    };
    return { teams: [side(A), side(B)], mixed: mixedKeys, note: "win = edges that favour this team; lose = edges that favour its opponent. mixed = situations where the league-wide learned effect and the team's own record point in opposite directions; they are listed but credited to neither side. Each line states its numbers and sample (n). w is a rough size in points used only for ordering; an 'on paper' zone edge is weighted by the share of it the back-test supports (never above 1), because zone percentages do not carry over in full and team-level zone edges are not tested." };
  }

  // Structured numbers behind the zone battle and the four-factor matchups, both directions,
  // so the site can draw them without parsing the sentences in keys.
  function matchupTable(A, B) {
    const zones = [], factors = [];
    for (const [X, Y] of [[A, B], [B, A]]) {
      const wx = SC.teamWin.get(X)?.R, wy = SC.teamWin.get(Y)?.R; if (!wx || !wy) continue;
      const xa = SC.five(wx.offA), xm = SC.five(wx.offM), ya = SC.five(wy.defA), ym = SC.five(wy.defM), xt = xa.reduce((s, v) => s + v, 0) || 1, fgaPg = xt / wx.g;
      zones.push({ off: X, def: Y, rows: Z5.map((z, i) => { const lg = SC.lg5.m[i] / SC.lg5.a[i]; return { z, share: round(xa[i] / xt * 100), shareRank: SC.zRanks.offShare[i].get(X), pct: pc(xm[i], xa[i]), pctRank: SC.zRanks.offPct[i].get(X),
        allowed: pc(ym[i], ya[i]), allowedRank: SC.zRanks.defPct[i].get(Y), lg: round(lg * 100), att: xa[i], attAllowed: ya[i], paper: ya[i] ? round(xa[i] / xt * fgaPg * ZVAL[i] * (ym[i] / ya[i] - lg), 2) : null }; }) });
      const mx = tm(X), my = tm(Y); if (!mx || !my) continue;
      const row = (id, label, ko, kd, f) => ({ id, label, off: X, def: Y, offVal: f(mx[ko]), offRank: rk(X, ko), defVal: f(my[kd]), defRank: rk(Y, kd) });
      const p1 = (v) => round(v * 100), r1 = (v) => round(v);
      factors.push(row("shooting", "Effective FG%", "efg", "oppEfg", p1), row("turnovers", "Turnovers per 100 possessions", "tovPer100", "oppTovPer100", r1), row("rebounding", "Offensive rebound % vs defensive rebound %", "orb", "drb", p1),
        row("freeThrows", "Free throws per 100 shots", "ftr", "oppFtr", p1), row("threeVolume", "Share of shots from three", "tpar", "oppTpar", p1), row("earlyOffence", "Points within 6 seconds of a stop", "traPg", "traAPg", r1));
    }
    return { zones, factors, scope: SC.scopeLabel, window: SC.windowLabel };
  }

  function build(u, pred) {
    const A = u.home, B = u.away;
    const h2h = h2hBlock(A, B);
    const scenarios = scenariosFor(A, B, pred, h2h);
    const keys = keysFor(A, B, pred, u);
    return { keys, matchup: matchupTable(A, B), h2h, scenarios };
  }
  return { build, TG };
}
