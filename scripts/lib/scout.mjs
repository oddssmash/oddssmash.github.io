// Scouting blocks for the website: shot zones (hot / cold spots), shot styles, defender
// profile, playstyle, culture indicators, quarter scoring, strengths / weaknesses and the
// "what if he faces team X" table for players; zone profiles, play types, playstyle and
// culture indicators for teams.
//
// Everything here is descriptive output built AFTER the walk-forward loop has finished, from
// plain counts (zone state "raw" layer) and NBA.com tables. Nothing in this file feeds a
// back-test projection. Every statement carries its number and its sample size.
import { clamp, round, mean, sd, posGroup, normName } from "./stats.mjs";
import { FINE_IDS, FINE_LABEL, ZONE_LABEL, STYLES } from "./zones.mjs";
import { Z5, ZVAL, NF, NS, F2Z, FINE_VAL } from "./zonestate.mjs";
import { opponentInputs, playerInputs, OPP_FACTORS, FACTOR_BY_ID } from "./factors.mjs";

export const TAG_RULE = { minAtt: { five: 30, fine: 20, style: 30 }, minDiff: 3, minZ: 1.5 };   // hot / cold needs all three
export const DEF_RULE = { minFga: 40, minDiff: 2.5, minZ: 1.5 };
// Culture indicators that compare a player with the league (motor, unselfishness, discipline,
// consistency) are only given a level and a percentile from this sample on; below it the raw
// numbers and the sample are shown with "Not enough games yet".
export const CULTURE_MIN = { games: 20, minutes: 400 };
export const PLAYTYPE_MIN_POSS = 40; // a play-type percentile is quoted only from this many possessions
const PLAY_LABEL = { Isolation: "Isolation", Transition: "Transition", PRBallHandler: "Pick-and-roll ball handler", PRRollman: "Pick-and-roll roll man", Postup: "Post-up", Spotup: "Spot-up",
  Handoff: "Hand-off", Cut: "Cut", OffScreen: "Off screens", OffRebound: "Putbacks", Misc: "Miscellaneous" };
const LEVELS = [[85, "Well above league average"], [65, "Above league average"], [35, "Around league average"], [15, "Below league average"], [-1, "Well below league average"]];
const levelOf = (pctile, enough = true) => (!enough ? "Not enough games yet" : pctile == null ? "Not enough data" : LEVELS.find(([lo]) => pctile >= lo)[1]);
const pc = (m, a, d = 1) => (a > 0 ? round(m / a * 100, d) : null);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const arr = (n) => new Array(n).fill(0);
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const sign = (x, d = 1) => (x > 0 ? "+" : "") + round(x, d);
// Rank in words, read from the nearer end of the table: rw(27, "lowest", "highest") -> "4th highest".
const rw = (r, lo, hi) => (r == null ? "n/a" : r <= 15 ? (r === 1 ? `the ${lo}` : `${ord(r)} ${lo}`) : (r === 30 ? `the ${hi}` : `${ord(31 - r)} ${hi}`));

const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;

function addInto(a, b) {
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (Array.isArray(v)) { if (!a[k]) a[k] = arr(v.length); if (typeof v[0] === "number" || v.length === 0) for (let i = 0; i < v.length; i++) a[k][i] = (a[k][i] || 0) + v[i]; }
    else if (v && typeof v === "object") { a[k] ||= {}; addInto(a[k], v); }
    else if (typeof v === "number") a[k] = (a[k] || 0) + v;
  }
  return a;
}
const combine = (raw, seasons) => { let o = null; for (const s of seasons) if (raw?.[s]) o = addInto(o || {}, raw[s]); return o; };
const five = (a) => { const o = arr(5); for (let i = 0; i < NF; i++) if (F2Z[i] >= 0) o[F2Z[i]] += a[i]; return o; };

export function tagOf(att, made, lgPct, minAtt) {
  if (att < minAtt || lgPct == null) return "neutral";
  const diff = made / att - lgPct, z = diff / Math.sqrt(lgPct * (1 - lgPct) / att);
  if (diff * 100 >= TAG_RULE.minDiff && z >= TAG_RULE.minZ) return "hot";
  if (diff * 100 <= -TAG_RULE.minDiff && z <= -TAG_RULE.minZ) return "cold";
  return "neutral";
}
// rows for a zone table. ids/labels/vals describe the zones; a/m/as = attempts, makes, assisted makes.
function zoneRows(ids, labels, vals, a, m, as, la, lm, ca, cm, minAtt) {
  const tot = sum(a) || 1, ltot = sum(la) || 1;
  return ids.map((id, i) => {
    const lg = la[i] > 0 ? lm[i] / la[i] : null;
    const row = { id, label: labels[i], att: a[i], made: m[i], pct: pc(m[i], a[i]), share: round(a[i] / tot * 100), lgPct: lg == null ? null : round(lg * 100), lgShare: round(la[i] / ltot * 100),
      diff: a[i] > 0 && lg != null ? round((m[i] / a[i] - lg) * 100) : null, pps: a[i] > 0 ? round(m[i] * vals[i] / a[i], 2) : null, lgPps: lg == null ? null : round(lg * vals[i], 2),
      astPct: as && m[i] > 0 ? round(as[i] / m[i] * 100, 0) : null, tag: tagOf(a[i], m[i], lg, minAtt) };
    if (a[i] < minAtt) row.low = 1;
    if (ca) row.cur = [ca[i], cm[i]];
    return row;
  });
}
const FIVE_LABELS = Z5.map((z) => ZONE_LABEL[z]);
const FINE10 = FINE_IDS.filter((f) => f !== "heave");
const pick10 = (a) => FINE10.map((f) => a[FINE_IDS.indexOf(f)]);

export function createScout(env) {
  const { ZS, ctx, FXE, P, teams, teamById, lastSeason, nowISO, baseOf, rosters, injuries, tRecs } = env;
  const WIN = [lastSeason - 1, lastSeason];
  const windowLabel = `${seasonLabel(lastSeason - 1)} and ${seasonLabel(lastSeason)} (regular season, play-in and playoffs)`;
  const LG = combine(ZS.league.raw, WIN) || { fa: arr(NF), fm: arr(NF), fas: arr(NF), sa: arr(NS), sm: arr(NS), q: arr(5), clFga: 0, clFgm: 0 };
  const lg5a = five(LG.fa), lg5m = five(LG.fm);
  const curS = ctx.curSeasonStr, prevS = ctx.prevSeasonStr;
  const ab = (tid) => teamById[tid]?.abbr || tid;

  // ---------------------------------------------------------------- league distributions (for percentiles)
  const dist = {};
  const pushD = (k, v) => { if (v != null && Number.isFinite(v)) (dist[k] ||= []).push(v); };
  const pctile = (k, v) => { const a = dist[k]; if (!a || a.length < 20 || v == null || !Number.isFinite(v)) return null; let lo = 0; for (const x of a) if (x < v) lo++; return Math.round(lo / a.length * 100); };
  const metricsOf = new Map();
  // NBA.com hustle rows are per game; both seasons are merged, weighted by minutes played.
  const HUSTLE_KEYS = ["DEFLECTIONS", "CONTESTED_SHOTS", "LOOSE_BALLS_RECOVERED", "CHARGES_DRAWN", "BOX_OUTS", "SCREEN_ASSISTS"];
  const hustleRow = (name) => {
    const k = normName(name), rows = [prevS, curS].map((s) => ctx.nbaTable(s, "playerHustle")?.get(k)).filter((r) => r && r.G > 0 && r.MIN > 0);
    if (!rows.length) return null;
    const o = { G: 0, _min: 0, _s: rows.length === 2 ? `${prevS} and ${curS}` : (ctx.nbaTable(curS, "playerHustle")?.get(k) === rows[0] ? curS : prevS) };
    for (const kk of HUSTLE_KEYS) o[kk] = 0;
    for (const r of rows) { o.G += r.G; o._min += r.G * r.MIN; for (const kk of HUSTLE_KEYS) o[kk] += (r[kk] || 0) * r.G; }
    if (o.G < 8 || o._min < 100) return null;
    for (const kk of HUSTLE_KEYS) o[kk] /= o.G;
    o.MIN = o._min / o.G;
    return o;
  };
  for (const p of P.values()) {
    const zp = ZS.players.get(p.id), R = combine(zp?.raw, WIN);
    if (!R || R.g < 5 || R.min < 100) continue;
    const m = { g: R.g, min: R.min };
    const h = hustleRow(p.n);
    if (h) { m.defl36 = h.DEFLECTIONS / h.MIN * 36; m.cont36 = h.CONTESTED_SHOTS / h.MIN * 36; m.loose36 = h.LOOSE_BALLS_RECOVERED / h.MIN * 36; m.hG = h.G; m.hS = h._s; m.charges = h.CHARGES_DRAWN * h.G; m.boxOuts36 = h.BOX_OUTS / h.MIN * 36; m.screenAst36 = h.SCREEN_ASSISTS / h.MIN * 36; }
    m.oreb36 = R.oreb / R.min * 36;
    m.astShare = R.ast / Math.max(1, R.ast + R.fga + 0.44 * R.fta);
    m.pf36 = R.pf / R.min * 36; m.techPg = (R.tech + 2 * R.flag + 2 * R.ejec) / R.g; m.to36 = R.to / R.min * 36;
    const res = p.res.slice(-30).map((x) => x.pts); m.ppg = R.pts / R.g;
    if (res.length >= 12) { m.resSd = sd(res); m.resN = res.length; m.cons = m.resSd / Math.sqrt(m.ppg + 2); }
    m.enough = R.g >= CULTURE_MIN.games && R.min >= CULTURE_MIN.minutes;
    metricsOf.set(p.id, m);
    if (!m.enough) continue; // the league distributions hold qualified players only, so a percentile compares like with like
    for (const k of ["defl36", "cont36", "loose36", "oreb36", "boxOuts36"]) pushD(`${k}|${p.g}`, m[k]);
    pushD(`astShare|${p.g}`, m.astShare); pushD(`pf36|${p.g}`, m.pf36); pushD("techPg", m.techPg); pushD(`to36|${p.g}`, m.to36); pushD("cons", m.cons);
  }
  // composite percentiles need a second pass
  for (const [pid, m] of metricsOf) {
    if (!m.enough) continue;
    const g = P.get(pid).g;
    const parts = [pctile(`defl36|${g}`, m.defl36), pctile(`cont36|${g}`, m.cont36), pctile(`loose36|${g}`, m.loose36), pctile(`oreb36|${g}`, m.oreb36)].filter((x) => x != null);
    if (parts.length >= 3) { m.motorRaw = mean(parts); pushD("motorRaw", m.motorRaw); }
    const f = pctile(`pf36|${g}`, m.pf36), t = pctile("techPg", m.techPg);
    if (f != null && t != null) { m.discRaw = 100 - (0.6 * f + 0.4 * t); pushD("discRaw", m.discRaw); }
  }

  // ---------------------------------------------------------------- opponents as of today (for "what if he faces team X")
  const frozen = { get: env.centres.get, push: () => {} };
  const zlg = ZS.leagueNow();
  const outNow = new Set(injuries.filter((i) => /out|doubtful/i.test(i.status)).map((i) => String(i.id)));
  const oppNow = new Map();
  for (const t of teams) {
    const ros = (rosters[t.id]?.players || []).filter((x) => !outNow.has(String(x.id)));
    const defenders = ros.map((x) => ({ n: x.n, g: posGroup(x.pos), min: baseOf(x.id)?.minutes || 0 })).filter((d) => d.min > 0);
    oppNow.set(t.id, opponentInputs({ zs: ZS, ctx, centres: frozen, oid: t.id, defenders, date: nowISO, lg: zlg, live: true }));
  }

  // ---------------------------------------------------------------- team zone tables + ranks
  const teamWin = new Map();
  for (const t of teams) {
    const zt = ZS.teams.get(t.id); const R = combine(zt?.raw, WIN); const C = zt?.raw?.[lastSeason] || null, Pv = zt?.raw?.[lastSeason - 1] || null;
    teamWin.set(t.id, { R, C, Pv });
  }
  const rankOf = (fn, desc = true) => { const vals = teams.map((t) => ({ id: t.id, v: fn(t.id) })).filter((x) => x.v != null && Number.isFinite(x.v)).sort((a, b) => (desc ? b.v - a.v : a.v - b.v)); const m = new Map(); vals.forEach((x, i) => m.set(x.id, i + 1)); return m; };
  const tz = (tid, key) => { const R = teamWin.get(tid)?.R; return R ? five(R[key]) : null; };
  const zRanks = { offPct: [], offShare: [], defPct: [], defShare: [] };
  for (let i = 0; i < 5; i++) {
    zRanks.offPct.push(rankOf((id) => { const a = tz(id, "offA"), m = tz(id, "offM"); return a && a[i] ? m[i] / a[i] : null; }));
    zRanks.offShare.push(rankOf((id) => { const a = tz(id, "offA"); return a ? a[i] / (sum(a) || 1) : null; }));
    zRanks.defPct.push(rankOf((id) => { const a = tz(id, "defA"), m = tz(id, "defM"); return a && a[i] ? m[i] / a[i] : null; }, false)); // 1 = lowest % allowed
    zRanks.defShare.push(rankOf((id) => { const a = tz(id, "defA"); return a ? a[i] / (sum(a) || 1) : null; }, false));                 // 1 = fewest attempts allowed there
  }

  // ---------------------------------------------------------------- player blocks
  function playerZones(R, C) {
    if (!R || sum(R.fa) < 1) return null;
    const a5 = five(R.fa), m5 = five(R.fm), as5 = five(R.fas);
    const c5a = C ? five(C.fa) : arr(5), c5m = C ? five(C.fm) : arr(5);
    const hv = FINE_IDS.indexOf("heave");
    return {
      window: windowLabel, games: R.g, fga: sum(a5), rule: TAG_RULE,
      five: zoneRows(Z5, FIVE_LABELS, ZVAL, a5, m5, as5, lg5a, lg5m, c5a, c5m, TAG_RULE.minAtt.five),
      fine: zoneRows(FINE10, FINE10.map((f) => FINE_LABEL[f]), pick10(FINE_VAL), pick10(R.fa), pick10(R.fm), pick10(R.fas), pick10(LG.fa), pick10(LG.fm), C ? pick10(C.fa) : null, C ? pick10(C.fm) : null, TAG_RULE.minAtt.fine),
      heaves: [R.fa[hv], R.fm[hv]],
    };
  }
  function styleRows(sa, sm, lsa, lsm) {
    const tot = sum(sa) || 1;
    return STYLES.map((s, i) => ({ id: s.id, label: s.label, att: sa[i], made: sm[i], pct: pc(sm[i], sa[i]), share: round(sa[i] / tot * 100), lgPct: pc(lsm[i], lsa[i]),
      diff: sa[i] > 0 && lsa[i] > 0 ? round((sm[i] / sa[i] - lsm[i] / lsa[i]) * 100) : null, tag: s.id === "heave" ? "neutral" : tagOf(sa[i], sm[i], lsa[i] ? lsm[i] / lsa[i] : null, TAG_RULE.minAtt.style) }))
      .filter((r) => r.att > 0 && r.id !== "heave").sort((x, y) => y.att - x.att);
  }
  const DEF_ROWS = [["rim", "lt6", "Inside 6 ft"], ["short", "lt10", "Inside 10 ft"], ["two", "fg2", "Two-pointers"], ["long", "gt15", "Beyond 15 ft"], ["three", "fg3", "Threes"], ["overall", "overall", "All shots"]];
  function playerDefense(name, R) {
    const rows = [];
    let gp = 0;
    for (const [id, cat, label] of DEF_ROWS) {
      let fgm = 0, fga = 0, exp = 0;
      for (const s of [prevS, curS]) { const d = ctx.zd.defender(name, s, cat); if (d && d.fga > 0) { fgm += d.fgm; fga += d.fga; exp += d.fga * d.nsPct; if (cat === "overall") gp += d.gp; } }
      if (!fga) continue;
      const pct = fgm / fga, e = exp / fga, diff = pct - e, z = diff / Math.sqrt(Math.max(1e-6, e * (1 - e) / fga));
      let tag = "neutral";
      if (fga >= DEF_RULE.minFga) { if (diff * 100 <= -DEF_RULE.minDiff && z <= -DEF_RULE.minZ) tag = "strong"; else if (diff * 100 >= DEF_RULE.minDiff && z >= DEF_RULE.minZ) tag = "weak"; }
      const row = { id, label, fga, pct: round(pct * 100), exp: round(e * 100), diff: round(diff * 100), tag }; if (fga < DEF_RULE.minFga) row.low = 1;
      rows.push(row);
    }
    // long twos = beyond 15 ft minus threes (both come from the same tracking table)
    { let fgm = 0, fga = 0, exp = 0;
      for (const s of [prevS, curS]) { const a = ctx.zd.defender(name, s, "gt15"), t = ctx.zd.defender(name, s, "fg3"); if (a && t && a.fga - t.fga > 0) { fgm += a.fgm - t.fgm; fga += a.fga - t.fga; exp += a.fga * a.nsPct - t.fga * t.nsPct; } }
      if (fga >= 10) { const pct = fgm / fga, e = clamp(exp / fga, 0.2, 0.7), diff = pct - e, z = diff / Math.sqrt(e * (1 - e) / fga);
        let tag = "neutral"; if (fga >= DEF_RULE.minFga) { if (diff * 100 <= -DEF_RULE.minDiff && z <= -DEF_RULE.minZ) tag = "strong"; else if (diff * 100 >= DEF_RULE.minDiff && z >= DEF_RULE.minZ) tag = "weak"; }
        const row = { id: "mid", label: "Long twos (15 ft to the arc)", fga, pct: round(pct * 100), exp: round(e * 100), diff: round(diff * 100), tag }; if (fga < DEF_RULE.minFga) row.low = 1;
        rows.splice(Math.max(0, rows.findIndex((r) => r.id === "long")), 0, row); } }
    if (!rows.length) return null;
    const b = R?.blkZ;
    return { src: "NBA.com defender tracking (closest defender)", window: `${prevS} and ${curS} regular season`, games: gp, rule: DEF_RULE, rows,
      blocks: b ? { rim: b[0], paint: b[1], mid: b[2], three: b[3] + b[4], total: sum(b), src: "play-by-play" } : null };
  }
  function synSeasonFor(getGp) { return getGp(curS) >= 15 ? curS : prevS; }
  function playTypes(name) {
    const s = synSeasonFor((x) => ctx.synPlayer(name, x)?.gp || 0), sp = ctx.synPlayer(name, s);
    if (!sp) return null;
    const rows = Object.entries(sp.rows).filter(([pt]) => pt !== "Misc").map(([pt, r]) => {
      const row = { id: pt, label: PLAY_LABEL[pt] || pt, freq: round(r[1] * 100), ppp: round(r[2], 2), pctile: r[3] >= PLAYTYPE_MIN_POSS ? Math.round(r[11] * 100) : null, poss: r[3], gp: r[0] };
      if (r[3] < PLAYTYPE_MIN_POSS) row.low = 1;
      if (r[12]) row.team = r[12]; // team(s) the row covers, stored by fetch.mjs from format 2 on
      return row;
    }).sort((a, b) => b.freq - a.freq);
    // A traded player: NBA.com returns some play types for one team stint only and others for the
    // whole season, so the rows cover different games and their frequencies do not add up to 100%.
    const gps = [...new Set(rows.map((r) => r.gp))].sort((a, b) => b - a);
    const out = { season: s, src: "NBA.com Synergy play types", minPoss: PLAYTYPE_MIN_POSS, rows };
    if (gps.length > 1) { out.partial = true; out.note = `He changed teams in ${s}: NBA.com lists some play types for one stint only (rows cover ${gps.join(" or ")} games), so each row's share is of the possessions in its own games and the shares do not add up to 100%.`; }
    return out;
  }

  function playerPlaystyle(p, R, zones, styles, pt, prof) {
    if (!R || !zones) return null;
    const tags = [], lines = [];
    const z = Object.fromEntries(zones.five.map((r) => [r.id, r]));
    const fgm = sum(R.fm), fga = zones.fga, astd = sum(R.fas);
    const rimPaint = round(z.rim.share + z.paint.share), mid = z.mid.share, three = round(z.c3.share + z.atb.share);
    const assisted = fgm ? round(astd / fgm * 100) : null, lgAssisted = pc(sum(LG.fas), sum(LG.fm));
    const fta = R.fta, ftr = R.fga ? fta / R.fga : 0;
    const per36 = (v) => round(v / Math.max(1, R.min) * 36);
    const transShare = R.fga ? round(R.tra / R.fga * 100) : null;
    const cs = ctx.zd.ptShot(p.n, curS, "catch"), pu = ctx.zd.ptShot(p.n, curS, "pullup");
    const useCur = cs && cs.gp >= 15, sS = useCur ? curS : prevS;
    const catchR = ctx.zd.ptShot(p.n, sS, "catch"), pullR = ctx.zd.ptShot(p.n, sS, "pullup");
    const st = Object.fromEntries((styles || []).map((r) => [r.id, r]));
    lines.push(`${rimPaint}% of his shots come at the rim or in the paint, ${mid}% from mid-range and ${three}% from three (${fga} attempts).`);
    if (assisted != null && fgm >= 40) lines.push(`${assisted}% of his made baskets are assisted (league ${lgAssisted}%), so he ${assisted <= lgAssisted - 15 ? "creates most of his own offence" : assisted >= lgAssisted + 12 ? "mostly finishes plays others create" : "mixes creating and finishing"} (${fgm} makes).`);
    if (catchR && pullR && catchR.fga + pullR.fga >= 40) lines.push(`Jump shots (NBA.com, ${sS}): catch-and-shoot ${round(catchR.freq * 100)}% of his attempts at ${round(catchR.efgPct * 100)}% eFG; pull-ups ${round(pullR.freq * 100)}% at ${round(pullR.efgPct * 100)}% eFG.`);
    const topStyles = (styles || []).filter((r) => r.id !== "heave").slice(0, 3).map((r) => `${r.label.toLowerCase()} ${r.share}%`);
    if (topStyles.length) lines.push(`Most common shot types: ${topStyles.join(", ")}.`);
    if (transShare != null && R.fga >= 80) lines.push(`${transShare}% of his shots come within 6 seconds of a steal or defensive rebound (${R.tra} of ${R.fga}); ${round(ftr * 100, 0)} free throws per 100 shots.`);
    if (pt?.rows?.length) {
      // every item carries its possessions; a percentile is quoted only from PLAYTYPE_MIN_POSS possessions on
      const top = pt.rows.slice(0, 3).map((r) => `${r.label} ${r.freq}% (${r.ppp} pts/poss on ${r.poss} possessions${r.pctile != null ? `, ${ord(r.pctile)} percentile` : ""}${pt.partial ? `, ${r.gp} games` : ""})`);
      lines.push(`Main play types (${pt.season}): ${top.join("; ")}.${pt.rows.slice(0, 3).some((r) => r.pctile == null) ? ` No percentile under ${PLAYTYPE_MIN_POSS} possessions.` : ""}${pt.partial ? " He changed teams, so the rows cover different games." : ""}`);
    }
    if (prof?.nba?.pace) lines.push(`His team plays at ${round(prof.nba.pace)} possessions per 48 minutes when he is on the floor (${prof.nba.season}, NBA.com).`);
    // tags (each is a threshold on a number shown above)
    if (z.rim.share >= 40 && fga >= 80) tags.push("Rim attacker");
    if (three >= 60 && fga >= 80) tags.push("Three-point-heavy shot diet"); // volume only: says nothing about how well he shoots them else if (three >= 45 && fga >= 80) tags.push("Perimeter-oriented");
    if (mid >= 22 && fga >= 80) tags.push("Mid-range game");
    if (assisted != null && fgm >= 40 && assisted <= 40) tags.push("Self-creator");
    if (assisted != null && fgm >= 40 && assisted >= 80) tags.push("Play finisher");
    if ((st.pull?.share || 0) + (st.step?.share || 0) >= 25 && fga >= 80) tags.push("Pull-up shooter");
    if ((st.post?.share || 0) >= 12 && fga >= 80) tags.push("Post / hook game");
    if ((st.drive?.share || 0) + (st.float?.share || 0) >= 38 && fga >= 80) tags.push("Driver");
    if ((st.cut?.share || 0) + (st.oop?.share || 0) + (st.tip?.share || 0) + (st.dunk?.share || 0) >= 30 && fga >= 60) tags.push("Lob and putback finisher");
    if (transShare != null && transShare >= 16 && R.fga >= 80) tags.push("Transition scorer");
    if (ftr >= 0.4 && R.fga >= 100) tags.push("Foul drawer");
    if (R.ast / Math.max(1, R.min) * 36 >= 7) tags.push("Playmaker");
    if (R.oreb / Math.max(1, R.min) * 36 >= 3.5) tags.push("Offensive rebounder");
    if (z.c3.share >= 18 && fga >= 80) tags.push("Corner shooter");
    return {
      tags, lines, shotMix: { rimPaint, mid, three },
      creation: { assisted, lgAssisted, transShare, ftPer100Fga: round(ftr * 100, 0),
        catchShoot: catchR ? { freq: round(catchR.freq * 100), efg: round(catchR.efgPct * 100), fga: catchR.fga, season: sS } : null,
        pullUp: pullR ? { freq: round(pullR.freq * 100), efg: round(pullR.efgPct * 100), fga: pullR.fga, season: sS } : null },
      per36: { pts: per36(R.pts), ast: per36(R.ast), oreb: per36(R.oreb), dreb: per36(R.dreb), to: per36(R.to), fta: per36(R.fta) },
      playTypes: pt,
    };
  }

  function playerCulture(p, R, zp) {
    const m = metricsOf.get(p.id); if (!m || !R) return null;
    const out = [];
    const span = `${R.g} games`;
    const ok = m.enough, gate = (pt) => (ok ? pt : null); // under CULTURE_MIN: numbers and sample only, no level and no percentile
    const few = ok ? "" : ` Fewer than ${CULTURE_MIN.games} games or ${CULTURE_MIN.minutes} minutes: too few to compare with the league.`;
    // motor / effort
    { const pt = gate(m.hG >= CULTURE_MIN.games || m.defl36 == null ? pctile("motorRaw", m.motorRaw) : null);
      out.push({ id: "motor", label: "Motor (hustle numbers)", level: levelOf(pt, ok && (m.defl36 == null || m.hG >= CULTURE_MIN.games)), pctile: pt,
        value: m.defl36 != null ? `${round(m.defl36)} deflections, ${round(m.cont36)} contested shots, ${round(m.loose36)} loose balls recovered and ${round(m.oreb36)} offensive rebounds per 36 min` : `${round(m.oreb36)} offensive rebounds per 36 min`,
        ev: (m.defl36 != null ? (pt != null ? `Percentile at his position: deflections ${pctile(`defl36|${p.g}`, m.defl36)}, contests ${pctile(`cont36|${p.g}`, m.cont36)}, loose balls ${pctile(`loose36|${p.g}`, m.loose36)}, offensive rebounds ${pctile(`oreb36|${p.g}`, m.oreb36)}.` : "NBA.com hustle numbers, per 36 minutes.") : "NBA.com hustle numbers not available for him.") + few,
        n: m.hG ? `${m.hG} games (${m.hS}, NBA.com hustle); ${span} of box scores` : span }); }
    // unselfishness
    { const pt = gate(pctile(`astShare|${p.g}`, m.astShare));
      out.push({ id: "unselfish", label: "Unselfishness (passing share)", level: levelOf(pt, ok), pctile: pt, value: `${round(m.astShare * 100, 0)}% of his plays end in an assist rather than his own shot`,
        ev: `${round(R.ast / R.g)} assists against ${round(R.fga / R.g)} shots and ${round(R.fta / R.g)} free throws per game; compared with other ${p.g === "G" ? "guards" : p.g === "C" ? "centres" : "forwards"}.${few}`, n: span }); }
    // discipline
    { const pt = gate(pctile("discRaw", m.discRaw));
      const tk = [R.tech ? `${R.tech} technical foul${R.tech === 1 ? "" : "s"}` : "no technical fouls", R.flag ? `${R.flag} flagrant${R.flag === 1 ? "" : "s"}` : null, R.ejec ? `${R.ejec} ejection${R.ejec === 1 ? "" : "s"}` : null].filter(Boolean).join(", ");
      // the level is scored on fouls (60%) and technicals / flagrants / ejections (40%); turnovers are listed for context only
      out.push({ id: "discipline", label: "Discipline (fouls and technicals)", level: levelOf(pt, ok), pctile: pt, value: `${round(m.pf36)} fouls per 36 min; ${tk}`,
        ev: `${R.sf} shooting fouls and ${R.of} offensive fouls committed. Not part of the level: ${round(m.to36)} turnovers per 36 min (${R.tovBad} bad passes, ${R.tovLost} lost balls, ${R.tovViol} violations or offensive fouls).${few}`, n: span }); }
    // availability
    { const parts = []; let played = 0, possible = 0;
      for (const s of WIN) {
        const mine = p.recs.filter((r) => r.season === s && r.stype === 2 && r.min > 0);
        if (!mine.length && s !== lastSeason) continue;
        const tid = mine.at(-1)?.team || p.team; const tg = tRecs(tid).filter((r) => r.season === s && r.stype === 2).length;
        if (!tg) continue;
        const pl = Math.min(mine.length, tg); played += pl; possible += tg; parts.push(`${pl} of ${tg} team games in ${seasonLabel(s)}`);
      }
      const share = possible ? played / possible * 100 : null;
      const lvl = share == null ? "Not enough data" : share >= 92 ? "90%+ of games" : share >= 80 ? "80-91% of games" : share >= 65 ? "65-79% of games" : share >= 50 ? "50-64% of games" : "Under 50% of games";
      out.push({ id: "availability", label: "Availability", level: lvl, pctile: null, value: share == null ? "No regular-season games on record" : `Played ${round(share, 0)}% of his team's regular-season games`, ev: parts.join("; ") + ". Counts the team he last played for in each season.", n: `${possible} team games` }); }
    // composure in the clutch
    { const c = R.cl, fg = c.fga ? c.fgm / c.fga : null, all = R.fga ? R.fgm / R.fga : null;
      let lvl = "Not enough data", pt = null;
      const lgAll = sum(LG.fa) ? sum(LG.fm) / sum(LG.fa) : 0.47, lgCl = LG.clFga ? LG.clFgm / LG.clFga : lgAll;
      const expd = all != null ? all * lgCl / lgAll : null; // what his own FG% becomes after the drop everyone sees late in close games
      if (c.fga >= 25 && expd != null) { const d = fg - expd, z = d / Math.sqrt(expd * (1 - expd) / c.fga); lvl = d >= 0.04 && z >= 1 ? "Above his norm late" : d <= -0.04 && z <= -1 ? "Below his norm late" : "In line with his norm late"; }
      out.push({ id: "clutch", label: "Composure in the clutch", level: lvl, pctile: pt,
        value: c.fga ? `${pc(c.fgm, c.fga)}% FG (${c.fgm} of ${c.fga}) and ${c.fta ? pc(c.ftm, c.fta, 0) + "% FT (" + c.ftm + " of " + c.fta + ")" : "no free throws"} in the clutch; ${pc(R.fgm, R.fga)}% FG overall` : "No clutch attempts on record",
        ev: `Clutch = last 5 minutes of the 4th quarter or overtime with the score within 5. ${c.pts} points in ${c.g} games that reached clutch time. League-wide FG% falls from ${round(lgAll * 100)}% to ${pc(LG.clFgm, LG.clFga)}% in the clutch, so his norm there is ${expd != null ? round(expd * 100) : "n/a"}%. Labels need 25 or more clutch attempts and a gap of 4 points of FG%.`, n: `${c.fga} clutch shots` }); }
    // consistency
    { const pc0 = m.cons != null ? pctile("cons", m.cons) : null, pt = gate(pc0 != null ? 100 - pc0 : null);
      out.push({ id: "consistency", label: "Consistency", level: levelOf(pt, ok), pctile: pt, value: m.resSd != null ? `Points land within about ${round(m.resSd)} of the projection in two games out of three` : "Fewer than 12 projected games",
        ev: m.resSd != null ? `Standard deviation of (actual minus projected points) over his last ${m.resN} projected games, scaled by scoring level (${round(m.ppg)} points a game) before comparing with the league.` : "", n: m.resN ? `${m.resN} games` : "0 games" }); }
    return out;
  }

  function playerQuarters(R) {
    if (!R || R.g < 3) return null;
    const tot = sum(R.q) || 1, ltot = sum(LG.q) || 1;
    return { window: windowLabel, games: R.g, rows: ["Q1", "Q2", "Q3", "Q4", "OT"].map((q, i) => ({ q, pts: round(R.q[i] / R.g, 1), share: round(R.q[i] / tot * 100), lgShare: round(LG.q[i] / ltot * 100) })),
      clutch: { games: R.cl.g, pts: R.cl.pts, fgm: R.cl.fgm, fga: R.cl.fga, tpm: R.cl.tpm, tpa: R.cl.tpa, ftm: R.cl.ftm, fta: R.cl.fta } };
  }

  // "What if he faces team X": learned adjustment (what the back-test supports) next to the paper edge.
  function playerVsTeams(p) {
    const b = baseOf(p.id); if (!b || !(b.minutes >= 8)) return null;
    const rows = [];
    for (const t of teams) {
      if (t.id === p.team) continue;
      const opp = oppNow.get(t.id);
      const fin = playerInputs({ zs: ZS, ctx, centres: frozen, name: p.n, pid: p.id, grp: p.g, min: b.minutes, rates: b.rates, opp, date: nowISO, closeProb: null, b2b: false, in4: false });
      const xs = Object.fromEntries(OPP_FACTORS.filter((f) => fin.x[f] != null).map((f) => [f, fin.x[f]]));
      const fx = FXE.apply(xs);
      const zs2 = [...fin.zones].sort((a, c) => Math.abs(c.pts) - Math.abs(a.pts)).slice(0, 2).filter((z) => Math.abs(z.pts) >= 0.05).map((z) => [z.z, round(z.diff * 100, 1)]);
      const h = p.splits[`opp:${t.id}`], zv = ZS.players.get(p.id)?.vs?.[t.id];
      rows.push([t.id, round(fx.pts, 2), round(fx.reb, 2), round(fx.tpa, 2), round((xs.zone || 0) + (xs.rim || 0), 1), round(xs.glass || 0, 1), round(xs.vol3 || 0, 1), zs2, h ? h.n : 0, h && h.n ? round(h.pts / h.n) : null,
        zv && zv.g >= 2 ? [zv.g, ...[0, 1, 2, 3, 4].map((i) => [zv.fm[i], zv.fa[i]])] : null]);
    }
    if (!rows.some((r) => r[4] || r[5] || r[6])) return null;
    return { cols: ["team", "pts", "reb", "tpa", "paperPts", "paperReb", "paperTpa", "zones", "games", "histPts", "zoneHist"], minutes: round(b.minutes), rows };
  }

  function playerScout(p, blocks, prof) {
    const S = [], W = [];
    const add = (list, score, t, n, k) => list.push({ score, t, n, k });
    const { zones, styles, defense, playstyle, culture, quarters, vsTeams } = blocks;
    if (zones) {
      for (const r of zones.five) if (r.tag !== "neutral") add(r.tag === "hot" ? S : W, Math.abs(r.diff) * Math.sqrt(r.att) / 10, `${r.tag === "hot" ? "Hot" : "Cold"} ${Z5_TEXT[r.id]}: ${r.pct}% on ${r.att} attempts (league ${r.lgPct}%), ${r.share}% of his shots.`, r.att, "zone");
      const fiveTagged = new Set(zones.five.filter((r) => r.tag !== "neutral").map((r) => r.id));
      for (const r of zones.fine) { const parent = r.id.startsWith("mid") ? "mid" : r.id.startsWith("c3") ? "c3" : r.id.startsWith("atb") ? "atb" : r.id; if (r.tag !== "neutral" && parent !== r.id && !fiveTagged.has(parent)) add(r.tag === "hot" ? S : W, Math.abs(r.diff) * Math.sqrt(r.att) / 12, `${r.tag === "hot" ? "Hot spot" : "Cold spot"}: ${r.label.toLowerCase()}, ${r.pct}% on ${r.att} attempts (league ${r.lgPct}%).`, r.att, "zone"); }
    }
    for (const r of styles || []) if (r.tag !== "neutral" && r.share >= 8) add(r.tag === "hot" ? S : W, Math.abs(r.diff) * Math.sqrt(r.att) / 14, `${r.label}: ${r.pct}% on ${r.att} attempts (league ${r.lgPct}% on that shot type).`, r.att, "style");
    for (const r of playstyle?.playTypes?.rows || []) {
      if (r.poss < 40 || r.freq < 8) continue;
      if (r.pctile >= 80) add(S, (r.pctile - 50) / 12, `${r.label}: ${r.ppp} points per possession, ${ord(r.pctile)} percentile (${r.poss} possessions, ${playstyle.playTypes.season}).`, r.poss, "playtype");
      if (r.pctile <= 20) add(W, (50 - r.pctile) / 12, `${r.label}: ${r.ppp} points per possession, ${ord(r.pctile)} percentile (${r.poss} possessions, ${playstyle.playTypes.season}).`, r.poss, "playtype");
    }
    for (const r of (defense?.rows || []).filter((q) => q.id !== "overall" && q.id !== "short" && q.id !== "long")) {
      if (r.tag === "strong") add(S, Math.abs(r.diff) * Math.sqrt(r.fga) / 12, `Defence, ${r.label.toLowerCase()}: shooters make ${r.pct}% against him versus ${r.exp}% normally (${r.fga} shots).`, r.fga, "defense");
      if (r.tag === "weak") add(W, Math.abs(r.diff) * Math.sqrt(r.fga) / 12, `Defence, ${r.label.toLowerCase()}: shooters make ${r.pct}% against him versus ${r.exp}% normally (${r.fga} shots).`, r.fga, "defense");
    }
    // A split is a strength or weakness only if it differs from his OWN average gap to the
    // projection (a rookie the model under-projects is "+5" in every split), and only if it does
    // not cover most of his projected games (then it is just his overall gap again).
    { const resAll = p.res.map((r) => r.pts), nAll = resAll.length, overall = nAll ? mean(resAll) : 0, seen = new Set();
      for (const s of [...(prof.splits?.best || []), ...(prof.splits?.worst || [])]) {
        if (seen.has(s.key)) continue; seen.add(s.key);
        // split rows carry the relative gap in pts and the plain gap in raw.pts (model.mjs); older rows only the plain gap
        const rawPts = s.raw ? s.raw.pts : s.pts, rel = s.raw ? s.pts : s.pts - overall, ov = s.raw ? round(s.raw.pts - s.pts) : overall;
        if (s.n < 5 || nAll < 8 || s.n > 0.7 * nAll || Math.abs(rel) < 2.5) continue;
        add(rel > 0 ? S : W, Math.abs(rel) * Math.sqrt(s.n) / 6, `${s.label.charAt(0).toUpperCase() + s.label.slice(1)}: ${sign(rel)} points versus his usual gap to the projection (${s.n} of his ${nAll} projected games; raw ${sign(rawPts)}, overall ${sign(ov)}).`, s.n, "split");
      } }
    for (const c of culture || []) {
      if (c.id === "clutch" && c.level === "Above his norm late") add(S, 2.2, `Clutch: ${c.value}.`, parseInt(c.n, 10), "clutch");
      if (c.id === "clutch" && c.level === "Below his norm late") add(W, 2.2, `Clutch: ${c.value}.`, parseInt(c.n, 10), "clutch");
      if (c.id === "motor" && c.pctile != null && c.pctile >= 85) add(S, 2, `Effort numbers: ${c.value} (${ord(c.pctile)} percentile composite).`, parseInt(c.n, 10), "culture");
      if (c.id === "discipline" && c.pctile != null && c.pctile <= 12) add(W, 1.8, `Foul and technical load: ${c.value}.`, parseInt(c.n, 10), "culture");
    }
    if (quarters && quarters.games >= 15) {
      const rows = quarters.rows.slice(0, 4); const best = [...rows].sort((a, b) => (b.share - b.lgShare) - (a.share - a.lgShare))[0];
      if (best.share - best.lgShare >= 4) add(S, (best.share - best.lgShare) / 2.5, `Scores most in ${best.q}: ${best.share}% of his points (${best.pts} a game; league ${best.lgShare}%).`, quarters.games, "quarter");
    }
    if (vsTeams) {
      const rs = vsTeams.rows.filter((r) => r[4] != null).sort((a, b) => b[4] - a[4]);
      const zl = (r) => (r[7].length ? ` (${r[7].map((z) => `${ZONE_SHORT[z[0]]} ${sign(z[1])}`).join(", ")} vs league)` : "");
      if (rs.length && rs[0][4] >= 0.8) add(S, rs[0][4], `Best zone matchup on paper: ${ab(rs[0][0])}, ${sign(rs[0][4])} points${zl(rs[0])}. The learned factors add ${sign(rs[0][1], 2)} before the team-total scaling.`, null, "matchup");
      const w = rs.at(-1); if (w && w[4] <= -0.8) add(W, -w[4], `Toughest zone matchup on paper: ${ab(w[0])}, ${sign(w[4])} points${zl(w)}. The learned factors add ${sign(w[1], 2)} before the team-total scaling.`, null, "matchup");
    }
    const CAP = { zone: 3, style: 2, playtype: 2, defense: 2, split: 2, clutch: 1, culture: 1, quarter: 1, matchup: 1 };
    const fin = (l) => { const c = {}; return l.sort((a, b) => b.score - a.score).filter((x) => { c[x.k] = (c[x.k] || 0) + 1; return c[x.k] <= CAP[x.k]; }).slice(0, 8).map(({ t, n, k }) => ({ t, n, k })); };
    if (!S.length && !W.length) return null;
    return { strengths: fin(S), weaknesses: fin(W) };
  }
  const Z5_TEXT = { rim: "at the rim", paint: "in the paint (outside the restricted area)", mid: "from mid-range", c3: "on corner threes", atb: "on above-the-break threes" };
  const ZONE_SHORT = { rim: "rim", paint: "paint", mid: "mid-range", c3: "corner 3", atb: "above-break 3" };

  function player(p, prof) {
    const zp = ZS.players.get(p.id);
    const R = combine(zp?.raw, WIN), C = zp?.raw?.[lastSeason] || null;
    const zones = playerZones(R, C);
    const styles = R ? styleRows(R.sa, R.sm, LG.sa, LG.sm) : null;
    const defense = playerDefense(p.n, R);
    const pt = playTypes(p.n);
    const playstyle = playerPlaystyle(p, R, zones, styles, pt, prof);
    const culture = playerCulture(p, R, zp);
    const quarters = playerQuarters(R);
    const vsTeams = playerVsTeams(p);
    const scout = playerScout(p, { zones, styles, defense, playstyle, culture, quarters, vsTeams }, prof);
    return { zones, styles, defense, playstyle, culture, quarters, scout, vsTeams };
  }

  // ---------------------------------------------------------------- team blocks
  const teamMetric = new Map(); // tid -> numbers used for ranks
  const hustleT = (tid, s) => { const t = teamById[tid]; const rows = [...(ctx.nbaTable(s, "teamHustle")?.values() || [])]; return rows.find((r) => r.TEAM_NAME === t?.name) || null; };
  const wlTxt = (b) => `${b[0]}-${b[1]}`;
  // One scope for every team, so ranks compare like with like: this season alone once every
  // team has played 15 games in it, otherwise this season and last together.
  const curOnly = teams.every((t) => (teamWin.get(t.id)?.C?.g || 0) >= 15);
  const scopeLabel = curOnly ? seasonLabel(lastSeason) : `${seasonLabel(lastSeason - 1)} and ${seasonLabel(lastSeason)}`;
  for (const t of teams) {
    const { R, C, Pv } = teamWin.get(t.id);
    const X = curOnly ? C : R;
    const scope = scopeLabel;
    if (!X) { teamMetric.set(t.id, null); continue; }
    // NBA.com hustle rows are per game. With the two-season scope both seasons are merged, weighted
    // by games, so the numbers match the stated window; with this season alone only its own table is used.
    const hRows = (curOnly ? [curS] : [prevS, curS]).map((s) => { const r = hustleT(t.id, s); const gp = r ? (ctx.nbaTable(s, "teamAdvanced")?.get(r.TEAM_ID)?.GP || 0) : 0; return r && gp > 0 ? { r, gp, s } : null; }).filter(Boolean);
    const hG = hRows.reduce((a, x) => a + x.gp, 0);
    const hAvg = (k) => (hG ? hRows.reduce((a, x) => a + (x.r[k] || 0) * x.gp, 0) / hG : null);
    const hs = hG ? { DEFLECTIONS: hAvg("DEFLECTIONS"), CONTESTED_SHOTS: hAvg("CONTESTED_SHOTS"), LOOSE_BALLS_RECOVERED: hAvg("LOOSE_BALLS_RECOVERED"), CHARGES_DRAWN: hAvg("CHARGES_DRAWN") } : null;
    const m = { g: X.g, scope, pfPg: X.pf / X.g, techPg: (X.tech + X.coachTech) / X.g, tovPer100: X.tov / X.poss * 100, astRate: X.ast / Math.max(1, X.fgm), traPg: X.tra / X.g, traAPg: X.traA / X.g, secPg: X.sec / X.g, secAPg: X.secA / X.g,
      orb: X.oreb / Math.max(1, X.oreb + X.oppDreb), drb: X.dreb / Math.max(1, X.dreb + X.oppOreb), ftr: X.fta / Math.max(1, X.fga), oppFtr: X.oppFta / Math.max(1, X.oppFga), tpar: X.tpa / Math.max(1, X.fga), oppTpar: X.oppTpa / Math.max(1, X.oppFga),
      efg: (X.fgm + 0.5 * X.tpm) / Math.max(1, X.fga), oppEfg: (X.oppFgm + 0.5 * X.oppTpm) / Math.max(1, X.oppFga), oppTovPer100: X.oppTov / X.poss * 100, pace: X.poss / X.g, potovPg: X.potov / X.g, potovAPg: X.potovA / X.g,
      defl: hs?.DEFLECTIONS ?? null, contests: hs?.CONTESTED_SHOTS ?? null, loose: hs?.LOOSE_BALLS_RECOVERED ?? null, charges: hs?.CHARGES_DRAWN ?? null,
      hG, hScope: hRows.map((x) => `${x.gp} in ${x.s}`).join(", "),
      qNet: [0, 1, 2, 3].map((i) => (X.qf[i] - X.qa[i]) / X.g), leadAvg: X.lead / X.g, ledShare: X.led / X.g };
    teamMetric.set(t.id, m);
  }
  const tRank = {};
  const mk = (k, desc = true, fn = (m) => m[k]) => { tRank[k] = rankOf((id) => { const m = teamMetric.get(id); return m ? fn(m) : null; }, desc); };
  for (const k of ["astRate", "traPg", "secPg", "orb", "drb", "ftr", "tpar", "efg", "oppTovPer100", "pace", "defl", "contests", "loose", "potovPg"]) mk(k, true);
  for (const k of ["pfPg", "techPg", "tovPer100", "traAPg", "secAPg", "oppFtr", "oppTpar", "oppEfg", "potovAPg"]) mk(k, false);
  for (let i = 0; i < 4; i++) tRank[`q${i}`] = rankOf((id) => teamMetric.get(id)?.qNet[i] ?? null, true);

  function teamZones(tid) {
    const { R } = teamWin.get(tid); if (!R) return null;
    const mkSide = (aK, mK, asK, isDef) => {
      const a5 = five(R[aK]), m5 = five(R[mK]);
      const rows5 = zoneRows(Z5, FIVE_LABELS, ZVAL, a5, m5, asK ? five(R[asK]) : null, lg5a, lg5m, null, null, 150);
      rows5.forEach((r, i) => { r.rank = (isDef ? zRanks.defPct : zRanks.offPct)[i].get(tid) ?? null; r.shareRank = (isDef ? zRanks.defShare : zRanks.offShare)[i].get(tid) ?? null; if (isDef) r.tag = r.tag === "hot" ? "soft" : r.tag === "cold" ? "strong" : "neutral"; });
      const fine = zoneRows(FINE10, FINE10.map((f) => FINE_LABEL[f]), pick10(FINE_VAL), pick10(R[aK]), pick10(R[mK]), asK ? pick10(R[asK]) : null, pick10(LG.fa), pick10(LG.fm), null, null, 100);
      if (isDef) fine.forEach((r) => { r.tag = r.tag === "hot" ? "soft" : r.tag === "cold" ? "strong" : "neutral"; });
      return { fga: sum(a5), five: rows5, fine };
    };
    const slim = (side) => { for (const r of [...side.five, ...side.fine]) { delete r.pps; delete r.lgPps; delete r.lgShare; if (r.astPct == null) delete r.astPct; } for (const r of side.fine) delete r.label; return side; };
    return { window: windowLabel, games: R.g, rule: { minAtt: { five: 150, fine: 100 }, minDiff: TAG_RULE.minDiff, minZ: TAG_RULE.minZ },
      off: slim(mkSide("offA", "offM", "offAst", false)), def: slim(mkSide("defA", "defM", null, true)) };
  }
  function teamPlayTypes(tid) {
    const s = (ctx.synTeamDef(tid, curS)?.gp || 0) >= 15 ? curS : prevS;
    const off = ctx.zd.synergyTeam(tid, s, "off"), def = ctx.zd.synergyTeam(tid, s, "def");
    if (!off && !def) return null;
    const rows = (o) => Object.entries(o || {}).filter(([pt]) => pt !== "Misc").map(([pt, r]) => ({ id: pt, label: PLAY_LABEL[pt] || pt, freq: round(r.possPct * 100), ppp: round(r.ppp, 2), pctile: Math.round(r.pctile * 100), poss: r.poss })).sort((a, b) => b.freq - a.freq);
    const o = rows(off), d = rows(def);
    const top = (rows, hi) => rows.filter((r) => (hi ? r.pctile >= 75 : r.pctile <= 25) && r.freq >= 4).sort((a, b) => (hi ? b.pctile - a.pctile : a.pctile - b.pctile)).slice(0, 3).map((r) => r.id);
    return { season: s, gp: off ? Object.values(off)[0].gp : null, src: "NBA.com Synergy play types",
      off: o, def: d, offBest: top(o, true), offWorst: top(o, false), defBest: top(d, true), defWorst: top(d, false) };
  }
  function teamPlaystyle(tid, zones, pt) {
    const m = teamMetric.get(tid); if (!m) return null;
    const lines = [];
    const r = (k) => tRank[k].get(tid);
    lines.push(`Pace ${round(m.pace)} possessions a game (${rw(r("pace"), "fastest", "slowest")}); ${round(m.tpar * 100)}% of shots are threes (${rw(r("tpar"), "most", "fewest")}); ${round(m.ftr * 100, 0)} free throws per 100 shots (${rw(r("ftr"), "most", "fewest")}). ${m.g} games, ${m.scope}.`);
    if (zones) { const o = zones.off.five, d = zones.def.five; const by = Object.fromEntries(o.map((x) => [x.id, x])), dby = Object.fromEntries(d.map((x) => [x.id, x]));
      lines.push(`Shot diet: ${by.rim.share}% at the rim (${rw(by.rim.shareRank, "most", "fewest")}), ${by.mid.share}% mid-range, ${round(by.c3.share + by.atb.share)}% threes. Makes ${by.rim.pct}% at the rim (${ord(by.rim.rank)} of 30) and ${by.atb.pct}% above the break (${ord(by.atb.rank)}).`);
      lines.push(`Defence allows ${dby.rim.pct}% at the rim (${rw(dby.rim.rank, "lowest", "highest")}), ${dby.c3.pct}% on corner threes (${rw(dby.c3.rank, "lowest", "highest")}) and ${dby.atb.pct}% above the break (${rw(dby.atb.rank, "lowest", "highest")}); ${round(dby.c3.share + dby.atb.share)}% of opponent shots are threes.`); }
    lines.push(`${round(m.astRate * 100, 0)}% of baskets are assisted (${ord(r("astRate"))} of 30); ${round(m.tovPer100)} turnovers per 100 possessions (${rw(r("tovPer100"), "fewest", "most")}); forces ${round(m.oppTovPer100)} (${rw(r("oppTovPer100"), "most", "fewest")}).`);
    lines.push(`Rebounds ${round(m.orb * 100)}% of its own misses (${ord(r("orb"))} of 30) and ${round(m.drb * 100)}% of opponents' misses (${ord(r("drb"))}). Scores ${round(m.traPg)} points a game within 6 seconds of a steal or defensive rebound (${rw(r("traPg"), "most", "fewest")}) and allows ${round(m.traAPg)} (${rw(r("traAPg"), "fewest", "most")}).`);
    if (pt) { const lab = (ids, rows) => ids.map((id) => rows.find((x) => x.id === id)).filter(Boolean).map((x) => `${x.label} (${x.ppp} pts/poss)`).join(", ");
      if (pt.offBest.length) lines.push(`Best play types on offence (${pt.season}): ${lab(pt.offBest, pt.off)}.`);
      if (pt.defWorst.length) lines.push(`Gives up the most on defence (${pt.season}): ${lab(pt.defWorst, pt.def)}.`); }
    return { lines, scope: m.scope, games: m.g };
  }
  function teamCulture(tid) {
    const m = teamMetric.get(tid), { C, Pv } = teamWin.get(tid); if (!m) return null;
    const X = curOnly ? C : (teamWin.get(tid).R);
    const r = (k) => tRank[k].get(tid) ?? null;
    const both = (key) => [C ? `${wlTxt(C[key])} in ${seasonLabel(lastSeason)}` : null, Pv ? `${wlTxt(Pv[key])} in ${seasonLabel(lastSeason - 1)}` : null].filter(Boolean).join(", ");
    const rec = (key) => ({ cur: C ? C[key] : null, prev: Pv ? Pv[key] : null });
    const out = [];
    out.push({ id: "effort", label: "Effort (hustle numbers)", rank: r("defl"), value: m.defl != null ? `${round(m.defl)} deflections, ${round(m.contests)} contested shots and ${round(m.loose)} loose balls recovered a game` : "NBA.com hustle numbers not available",
      ev: `Deflections rank ${ord(r("defl") || 0)}, contests ${ord(r("contests") || 0)}, loose balls ${ord(r("loose") || 0)} of 30 (NBA.com hustle). Offensive rebound rate ${round(m.orb * 100)}% (${ord(r("orb"))}); ${round(m.secPg)} second-chance points a game (${ord(r("secPg"))}).`, n: m.hG ? `${m.hG} regular-season games of NBA.com hustle tracking (${m.hScope})${m.hG < 20 ? ", a small sample" : ""}; rebounding and second-chance points from ${m.g} games, ${m.scope}` : `${m.g} games, ${m.scope}` });
    // the rank shown is fouls per game only; turnovers and technicals are listed with their own ranks
    out.push({ id: "discipline", label: "Discipline (rank: fouls per game)", rank: r("pfPg"), value: `${round(m.pfPg)} fouls a game (${rw(r("pfPg"), "fewest", "most")}), ${round(m.tovPer100)} turnovers per 100 possessions (${rw(r("tovPer100"), "fewest", "most")})`,
      ev: `${X.tech} player technicals, ${X.coachTech} coach or bench technicals, ${X.flag} flagrant fouls and ${X.ejec} ejections in ${X.g} games (technicals per game: ${rw(r("techPg"), "fewest", "most")}). Opponents take ${round(m.oppFtr * 100, 0)} free throws per 100 shots (${rw(r("oppFtr"), "fewest", "most")}).`, n: `${m.g} games, ${m.scope}` });
    out.push({ id: "unselfish", label: "Unselfishness (assist rate)", rank: r("astRate"), value: `${round(m.astRate * 100, 0)}% of made baskets are assisted (${ord(r("astRate"))} of 30)`, ev: `${round(X.ast / X.g)} assists on ${round(X.fgm / X.g)} made baskets a game.`, n: `${m.g} games, ${m.scope}` });
    out.push({ id: "resilience", label: "Resilience", rank: null, value: `After a loss: ${both("afterLoss")}. Games decided by 5 or fewer or in overtime: ${both("close")}.`,
      ev: `Trailed by 10 or more at some point: ${both("down10")} (comebacks are the wins). Led by 10 or more: ${both("up10")}. Entered the 4th quarter down 10 or more: ${both("down10q4")}. Games that reached clutch time (within 5 in the last 5 minutes): ${both("clutch")}.`,
      n: `${(C?.g || 0)} games this season, ${(Pv?.g || 0)} last season`, rec: { afterLoss: rec("afterLoss"), close: rec("close"), down10: rec("down10"), up10: rec("up10"), clutch: rec("clutch") } });
    { const q = m.qNet, order = [0, 1, 2, 3].sort((a, b) => q[b] - q[a]), best = order[0], worst = order[3];
      out.push({ id: "quarters", label: "Quarter identity", rank: null, value: `Best quarter: Q${best + 1} (${sign(q[best])} a game, ${ord(tRank[`q${best}`].get(tid))} in the league). Worst: Q${worst + 1} (${sign(q[worst])}, ${ord(tRank[`q${worst}`].get(tid))}).`,
        ev: `Average margin by quarter: ${q.map((v, i) => `Q${i + 1} ${sign(v)}`).join(", ")}. Leading at half: ${both("ledHalf")}; trailing at half: ${both("trailHalf")}.`, n: `${m.g} games, ${m.scope}`, q: q.map((v) => round(v)), qRank: [0, 1, 2, 3].map((i) => tRank[`q${i}`].get(tid)) }); }
    // continuity + experience from this season's minutes
    { const recs = tRecs(tid).filter((x) => x.season === lastSeason && x.stype === 2);
      let tot = 0, kept = 0, ageMin = 0, ageW = 0;
      const prevIds = new Set(); for (const x of tRecs(tid)) if (x.season === lastSeason - 1 && x.stype !== 1) for (const [pid, b] of x.box) if (b.min > 0) prevIds.add(pid);
      for (const x of recs) for (const [pid, b] of x.box) { tot += b.min; if (prevIds.has(pid)) kept += b.min; const a = ctx.age(P.get(pid)?.n || "", nowISO); if (a) { ageMin += a * b.min; ageW += b.min; } }
      if (tot > 0) {
        out.push({ id: "continuity", label: "Continuity", rank: null, value: `${round(kept / tot * 100, 0)}% of this season's minutes come from players who were on the team last season`, ev: `${recs.length} games this season; "on the team" = played at least one game for it in ${seasonLabel(lastSeason - 1)}.`, n: `${recs.length} games`, share: round(kept / tot * 100, 0) });
        if (ageW > 0) out.push({ id: "experience", label: "Experience", rank: null, value: `Minutes-weighted age ${round(ageMin / ageW)} years`, ev: `Each player's age weighted by the minutes he has played this season (ages from NBA.com / ESPN rosters).`, n: `${recs.length} games`, age: round(ageMin / ageW) });
      } }
    { const c = C, p = Pv; const t1 = (R0) => (R0 ? `${wlTxt(R0.home)} at home (${sign(R0.homeNet / Math.max(1, R0.home[0] + R0.home[1]))} a game), ${wlTxt(R0.road)} on the road (${sign(R0.roadNet / Math.max(1, R0.road[0] + R0.road[1]))})` : null);
      out.push({ id: "homeRoad", label: "Home versus road", rank: null, value: [c ? `${seasonLabel(lastSeason)}: ${t1(c)}` : null].filter(Boolean).join("") || "No games this season", ev: p ? `${seasonLabel(lastSeason - 1)}: ${t1(p)}.` : "", n: `${(c?.g || 0)} games this season, ${(p?.g || 0)} last season`,
        rec: { home: rec("home"), road: rec("road") } }); }
    return out;
  }
  function team(tid) {
    const zones = teamZones(tid), pt = teamPlayTypes(tid);
    return { zones, playTypes: pt, playstyle: teamPlaystyle(tid, zones, pt), culture: teamCulture(tid) };
  }

  const playerZoneWindow = (pid) => { const R = combine(ZS.players.get(pid)?.raw, WIN); return R ? { a: five(R.fa), m: five(R.fm), g: R.g } : null; };
  const teamZonePct = (tid, i) => { const R = teamWin.get(tid)?.R; if (!R) return null; const a = five(R.defA), m = five(R.defM); return pc(m[i], a[i]); };
  // One zone of a team's defence with the Scout page's own tag (soft / strong needs 150 attempts allowed, 3 points and 1.5 standard errors).
  const teamDefZone = (tid, i) => { const R = teamWin.get(tid)?.R; if (!R) return null; const a = five(R.defA), m = five(R.defM), t = tagOf(a[i], m[i], lg5a[i] ? lg5m[i] / lg5a[i] : null, 150);
    return { att: a[i], made: m[i], pct: pc(m[i], a[i]), tag: t === "hot" ? "soft" : t === "cold" ? "strong" : "neutral" }; };
  return { player, team, teamMetric, tRank, zRanks, teamWin, oppNow, windowLabel, scopeLabel, WIN, LG, lg5: { a: lg5a, m: lg5m }, ord, metricsOf, five, playerZoneWindow, teamZonePct, teamDefZone };
}
