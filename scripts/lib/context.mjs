// Context layer: NBA.com stats (point-in-time for the back-test), 2K ratings,
// archetypes, heights, news, rosters and an ESPN vs NBA.com box-score cross-check.
import path from "node:path";
import { DATA, readJSON, isBetting } from "./util.mjs";
import { normName, mean, sd, round, clamp } from "./stats.mjs";
import { loadZoneData } from "./zonedata.mjs";

const etDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const seasonStr = (y) => `${y - 1}-${String(y).slice(2)}`; // 2027 -> "2026-27"
const seasonOfDate = (iso) => { const d = new Date(iso); const y = d.getUTCFullYear(); return d.getUTCMonth() >= 8 ? y + 1 : y; };

export function buildContext(games) {
  const nba = readJSON(path.join(DATA, "nbastats.json"), {});
  const snaps = readJSON(path.join(DATA, "nbasnapshots.json"), {});
  const r2k = readJSON(path.join(DATA, "ratings2k.json"), { sources: [] });
  const newsAll = readJSON(path.join(DATA, "news.json"), []);
  const news = newsAll.filter((n) => !isBetting(n)); // second guard: betting content never reaches the site, even from an old archive
  const bettingDropped = newsAll.length - news.length;
  const rosters = readJSON(path.join(DATA, "rosters.json"), {});
  const logs = readJSON(path.join(DATA, "nbagamelogs.json"), {});
  const teams = readJSON(path.join(DATA, "teams.json"), []);
  const now = Date.now();
  const curSeason = seasonOfDate(new Date().toISOString());
  const zd = loadZoneData();                                              // NBA.com zone, defender and play-type tables
  const defSnaps = readJSON(path.join(DATA, "defsnapshots.json"), {}).snaps || {};
  const nzSeasons = readJSON(path.join(DATA, "nbazones.json"), {}).seasons || {};

  // ---- 2K: primary source first, cross-check second ----
  const k2 = new Map();
  for (const src of r2k.sources || []) for (const p of src.players) {
    const k = normName(p.n);
    if (!k2.has(k)) k2.set(k, { ...p, src: src.name });
    else { const e = k2.get(k); if (!e.ovr2 && src.name !== e.src) e.ovr2 = p.ovr; }
  }

  // ---- heights: current rosters, then 2K ----
  const height = new Map();
  for (const t of Object.values(rosters)) for (const p of t.players || []) if (p.h) height.set(normName(p.n), p.h);
  for (const [k, p] of k2) if (p.h && !height.has(k)) height.set(k, p.h);

  // ---- NBA.com season tables indexed by name ----
  const tbl = {};
  for (const [season, sets] of Object.entries(nba)) {
    if (season === "fetched") continue;
    tbl[season] = {};
    for (const [key, rows] of Object.entries(sets)) {
      if (!Array.isArray(rows)) continue;
      const m = new Map();
      for (const r of rows) { const nm = r.PLAYER_NAME ? normName(r.PLAYER_NAME) : r.TEAM_ID; m.set(nm, r); if (r.TEAM_ABBREVIATION && !r.PLAYER_NAME) m.set(r.TEAM_ABBREVIATION, r); }
      tbl[season][key] = m;
    }
  }
  // Season table that is safe to use for a game: the current season only for a game that has not
  // been played (live = true, decided by the caller from the game itself, never from the clock:
  // a finished game replayed a few hours later must not see a table that already contains it).
  const safeSeason = (iso, live = false) => {
    const y = seasonOfDate(iso);
    return live ? seasonStr(y) : seasonStr(y - 1);
  };

  // ---- point-in-time defensive score (z) from weekly snapshots ----
  const snapKeys = Object.keys(snaps).sort();
  const zCache = new Map();
  function snapshotZ(key) {
    if (zCache.has(key)) return zCache.get(key);
    const s = snaps[key]; const m = new Map();
    if (s?.adv && s?.hustle) {
      const adv = new Map(s.adv.map((r) => [normName(r[0]), r]));
      const rows = s.hustle.filter((h) => h[1] >= 12).map((h) => {
        const a = adv.get(normName(h[0]));
        return { k: normName(h[0]), con: h[2] / h[1] * 36, defl: h[3] / h[1] * 36, drtg: a ? a[6] : null };
      });
      const z = (arr, f) => { const v = arr.map(f).filter((x) => x != null); const mu = mean(v), s2 = sd(v) || 1; return (x) => (x == null ? 0 : (x - mu) / s2); };
      const zc = z(rows, (r) => r.con), zd = z(rows, (r) => r.defl), zr = z(rows, (r) => r.drtg);
      for (const r of rows) m.set(r.k, 0.35 * zc(r.con) + 0.35 * zd(r.defl) - 0.3 * zr(r.drtg));
    }
    zCache.set(key, m); return m;
  }
  function seasonZ(season) {
    const key = `season|${season}`;
    if (zCache.has(key)) return zCache.get(key);
    const h = nba[season]?.playerHustle, d = nba[season]?.playerDefense;
    const m = new Map();
    if (h && d) {
      const dm = new Map(d.map((r) => [normName(r.PLAYER_NAME), r]));
      const rows = h.filter((r) => r.MIN >= 12).map((r) => ({ k: normName(r.PLAYER_NAME), con: r.CONTESTED_SHOTS / r.MIN * 36, defl: r.DEFLECTIONS / r.MIN * 36, drtg: dm.get(normName(r.PLAYER_NAME))?.DEF_RATING ?? null }));
      const z = (f) => { const v = rows.map(f).filter((x) => x != null); const mu = mean(v), s2 = sd(v) || 1; return (x) => (x == null ? 0 : (x - mu) / s2); };
      const zc = z((r) => r.con), zd = z((r) => r.defl), zr = z((r) => r.drtg);
      for (const r of rows) m.set(r.k, 0.35 * zc(r.con) + 0.35 * zd(r.defl) - 0.3 * zr(r.drtg));
    }
    zCache.set(key, m); return m;
  }
  function defScore(name, iso) {
    const k = normName(name);
    const season = seasonStr(seasonOfDate(iso));
    const d = etDate(iso).replace(/-/g, "");
    // latest snapshot of this season strictly before the game date with enough games
    let best = null;
    for (const sk of snapKeys) { const [s, sd8] = sk.split("|"); if (s === season && sd8 < d) best = sk; }
    const weeksIn = best ? snapKeys.filter((x) => x.startsWith(season) && x <= best).length : 0;
    const cur = best && weeksIn >= 3 ? snapshotZ(best).get(k) : undefined;
    if (cur !== undefined) return cur;
    const prev = seasonZ(seasonStr(seasonOfDate(iso) - 1)).get(k);
    return prev ?? 0;
  }

  // ---- point-in-time defender tracking (NBA.com "closest defender" tables) ----
  // Same rule as defScore: for a game of season S use the newest Monday snapshot of S dated strictly
  // before the game, once 3 or more weekly snapshots exist; before that, and as the prior the
  // snapshot is shrunk toward, use the finished table of season S-1. Only gp / fgm / fga are read
  // from a snapshot (its nsPct column looks ahead), so quality is "allowed % minus the league-wide
  // allowed % in the same table".
  const defKeys = Object.keys(defSnaps).sort();
  const DEF_CAT = { rim: "lt6", three: "fg3", long: "gt15" };
  const lgDefCache = new Map();
  const lgDef = (rows, ck, m, a) => {
    if (!lgDefCache.has(ck)) { let sm = 0, sa = 0; for (const r of Object.values(rows || {})) { sm += r[m]; sa += r[a]; } lgDefCache.set(ck, sa ? sm / sa : null); }
    return lgDefCache.get(ck);
  };
  const defSrcCache = new Map();
  function defSource(iso) {
    const ck = iso.slice(0, 13);
    if (defSrcCache.has(ck)) return defSrcCache.get(ck);
    const y = seasonOfDate(iso), season = seasonStr(y), d = etDate(iso).replace(/-/g, "");
    let best = null;
    for (const sk of defKeys) { const [s, d8] = sk.split("|"); if (s === season && d8 < d) best = sk; }
    const weeksIn = best ? defKeys.filter((x) => x.startsWith(season) && x <= best).length : 0;
    const out = { snap: best && weeksIn >= 3 ? best : null, prev: seasonStr(y - 1), weeksIn };
    defSrcCache.set(ck, out); return out;
  }
  // kind: "rim" (inside 6 ft) | "three" | "long" (beyond 15 ft).
  // Returns { diff, fga, perGame, src } or null. diff < 0 means shooters make fewer than the league does.
  function defenderAt(name, iso, kind = "rim") {
    const k = normName(name), cat = DEF_CAT[kind], src = defSource(iso);
    const KP = 60, KS = 80;
    let prior = 0, perGame = null, fga = 0, label = null;
    const pr = nzSeasons[src.prev]?.defend?.[cat]?.[k];
    if (pr && pr[3] > 0) {
      const lg = lgDef(nzSeasons[src.prev].defend[cat], `s|${src.prev}|${cat}`, 2, 3);
      prior = (pr[2] + KP * lg) / (pr[3] + KP) - lg; perGame = pr[3] / Math.max(1, pr[0]); fga = pr[3]; label = src.prev;
    }
    if (src.snap) {
      const r = defSnaps[src.snap]?.[cat]?.[k];
      if (r && r[2] > 0) {
        const lg = lgDef(defSnaps[src.snap][cat], `d|${src.snap}|${cat}`, 1, 2);
        const diff = (r[1] - lg * r[2] + KS * prior) / (r[2] + KS);
        return { diff, fga: r[2] + (pr ? pr[3] : 0), cur: r[2], perGame: r[2] / Math.max(1, r[0]), src: `snapshot ${src.snap.split("|")[1]}` };
      }
    }
    return label ? { diff: prior, fga, cur: 0, perGame, src: `${label} season` } : null;
  }
  // ---- age on the day of a game (NBA.com season tables, then the current roster) ----
  const rosterAge = new Map();
  for (const t of Object.values(rosters)) for (const p of t.players || []) if (p.age) rosterAge.set(normName(p.n), p.age);
  for (const [k, p] of k2) if (p.age && !rosterAge.has(k)) rosterAge.set(k, p.age);
  function age(name, iso) {
    const k = normName(name), y = seasonOfDate(iso);
    const a = tbl[seasonStr(y)]?.playerBase?.get(k)?.AGE;
    if (a) return a;
    for (const dy of [-1, 1]) { const b = tbl[seasonStr(y + dy)]?.playerBase?.get(k)?.AGE; if (b) return b - dy; }
    const r = rosterAge.get(k);
    return r ? r - (curSeason - y) : null;
  }
  // Season whose play-type (Synergy) tables may be used for a game: the previous season for the
  // back-test (the tables have no date filter); the current one for live projections, and only
  // once the row has 15+ games behind it.
  function playTypeSeason(iso, gpOf, live = false) {
    const y = seasonOfDate(iso);
    if (live && gpOf(seasonStr(y)) >= 15) return seasonStr(y);
    return seasonStr(y - 1);
  }
  const lgSynCache = new Map();
  function leagueSynDef(season) {
    if (!lgSynCache.has(season)) {
      const o = {};
      for (const [pt, rows] of Object.entries(nzSeasons[season]?.synD || {})) { let poss = 0, pts = 0; for (const r of Object.values(rows)) { poss += r[3]; pts += r[4]; } o[pt] = poss ? pts / poss : null; }
      lgSynCache.set(season, o);
    }
    return lgSynCache.get(season);
  }
  const synPlayer = (name, season) => { const k = normName(name), o = {}; let gp = 0; for (const [pt, rows] of Object.entries(nzSeasons[season]?.synP || {})) if (rows[k]) { o[pt] = rows[k]; gp = Math.max(gp, rows[k][0]); } return gp ? { gp, rows: o } : null; };
  const synTeamDef = (tid, season) => { const o = {}; let gp = 0; for (const [pt, rows] of Object.entries(nzSeasons[season]?.synD || {})) if (rows[tid]) { o[pt] = rows[tid]; gp = Math.max(gp, rows[tid][0]); } return gp ? { gp, rows: o } : null; };

  // ---- archetypes (2K archetype text first, NBA.com tracking second) ----
  function archetype(name, iso, live = iso === undefined) {
    if (iso === undefined) iso = new Date().toISOString();
    const k = normName(name);
    const a = k2.get(k)?.arch || "";
    const s = a.toLowerCase();
    if (s) {
      if (/lockdown|defensive|2-way|two-way|perimeter lock|glass-cleaning lock/.test(s) && /defen|lock|2-way/.test(s)) {
        if (/playmak|3-level|scor|shot/.test(s)) return "Two-way creator";
        return "Lockdown defender";
      }
      if (/rim|anchor|paint protect/.test(s)) return "Rim protector";
      if (/stretch|spot|sharpshoot|3pt|shooter|marksman/.test(s)) return /big|5|stretch/.test(s) ? "Stretch big" : "Sharpshooter";
      if (/post/.test(s)) return "Post scorer";
      if (/glass|rebound|board/.test(s)) return "Glass cleaner";
      if (/slash|athlet|finish|inside-out|interior/.test(s)) return "Slasher";
      if (/playmak|floor general|point/.test(s)) return /scor|3-level|shot/.test(s) ? "Scoring playmaker" : "Floor general";
      if (/scor|shot creat|3-level|bucket/.test(s)) return "Shot creator";
    }
    const S = tbl[safeSeason(iso, live)] || {};
    const sc = S.playerScoring?.get(k), us = S.playerUsage?.get(k), dr = S.playerDrives?.get(k), ad = S.playerAdvanced?.get(k);
    if (sc && ad) {
      if (ad.USG_PCT > 0.27) return "Shot creator";
      if (ad.AST_PCT > 0.28) return "Floor general";
      if (sc.PCT_FGA_3PT > 0.6) return "Sharpshooter";
      if (dr && dr.DRIVES > 9) return "Slasher";
      if (sc.PCT_PTS_PAINT > 0.6 && ad.REB_PCT > 0.14) return "Rim runner";
    }
    return null;
  }

  // ---- cross-check ESPN box scores vs official NBA.com game logs ----
  const logIdx = new Map();
  for (const rows of Object.values(logs)) for (const r of rows) logIdx.set(`${r[0]}|${normName(r[1])}`, r);
  let checked = 0, matched = 0;
  const mismatches = [];
  for (const g of games) {
    const d = etDate(g.date);
    for (const p of g.players || []) {
      if (!p.min) continue;
      const r = logIdx.get(`${d}|${normName(p.n)}`);
      if (!r) continue;
      checked++;
      if (r[4] === p.pts && r[5] === p.reb && r[6] === p.ast) matched++;
      else if (mismatches.length < 50) mismatches.push({ date: d, n: p.n, espn: [p.pts, p.reb, p.ast], nba: [r[4], r[5], r[6]] });
    }
  }

  // ---- news ----
  const teamWords = teams.map((t) => ({ id: t.id, words: [t.name, t.short].filter(Boolean).map((w) => w.toLowerCase()) }));
  const rosterNames = [];
  for (const [tid, t] of Object.entries(rosters)) for (const p of t.players || []) rosterNames.push({ tid, id: p.id, n: p.n, low: p.n.toLowerCase() });
  const enriched = news.map((n) => {
    const text = `${n.title} ${n.summary}`.toLowerCase();
    const tms = new Set(n.teams || []);
    for (const t of teamWords) if (t.words.some((w) => text.includes(w))) tms.add(t.id);
    const pls = new Set(n.athletes || []);
    for (const p of rosterNames) if (text.includes(p.low)) { pls.add(p.id); tms.add(p.tid); }
    const flags = [];
    if (/minutes (restriction|limit)|limited minutes|minute restriction/.test(text)) flags.push("minutes limit");
    if (/questionable|game-time decision|day-to-day/.test(text)) flags.push("questionable");
    if (/\bout\b|ruled out|will miss|sidelined/.test(text)) flags.push("out");
    if (/return|back in the lineup|cleared/.test(text)) flags.push("returning");
    if (/trade|traded|acquire/.test(text)) flags.push("trade");
    if (/start(ing|s)? (in place|tonight|for)|move(s|d)? into the starting/.test(text)) flags.push("lineup change");
    // tone of the take, so it can be checked against the numbers before anyone relies on it
    let tone = 0;
    if (/breakout|on fire|dominat|surging|red-hot|career[- ]high|mvp|unstoppable|taking over|leap|best stretch|heating up|elite|carrying/.test(text)) tone += 1;
    if (/struggl|slump|ice[- ]cold|worst|concern|declin|washed|benched|disappoint|overrated|regress|shooting woes|rough stretch/.test(text)) tone -= 1;
    return { ...n, kind: n.kind || "news", teams: [...tms], athletes: [...pls], flags, tone };
  }).filter((n) => !n.general || n.teams.length || n.athletes.length || /\bnba\b/i.test(n.title));
  const newsFor = (teamIds, playerIds) => enriched.filter((n) => n.teams.some((t) => teamIds.includes(t)) || n.athletes.some((a) => playerIds.includes(a)))
    .map(({ outlet, kind, title, url, date, summary, flags, tone, athletes, teams }) => ({ outlet, kind, title, url, date, summary, flags, tone, athletes, teams }));
  const newsMinutesLimit = (tid) => new Set(enriched.filter((n) => Date.parse(n.date) > now - 3 * 864e5 && n.flags.includes("minutes limit") && n.teams.includes(tid))
    .flatMap((n) => n.athletes));

  // ---- player / team extras for profiles (current season, else last) ----
  const pick = (k, key) => { for (const s of [seasonStr(curSeason), seasonStr(curSeason - 1)]) { const r = tbl[s]?.[key]?.get(k); if (r) return { ...r, _season: s }; } return null; };
  function playerExtras(name) {
    const k = normName(name);
    const adv = pick(k, "playerAdvanced"), hus = pick(k, "playerHustle"), def = pick(k, "playerDefense"), spd = pick(k, "playerSpeed"),
      drv = pick(k, "playerDrives"), pas = pick(k, "playerPassing"), tch = pick(k, "playerTouches"), clu = pick(k, "playerClutch"), sco = pick(k, "playerScoring"), mis = pick(k, "playerMisc");
    const two = k2.get(k);
    const per36 = (v, m) => (m ? round(v / m * 36) : null);
    const out = {
      height: height.get(k) ?? null, archetype: archetype(name),
      nba: adv ? {
        season: adv._season, usg: round(adv.USG_PCT * 100), ts: round(adv.TS_PCT * 100), net: adv.NET_RATING, off: adv.OFF_RATING, def: adv.DEF_RATING, pie: round(adv.PIE * 100), astPct: round(adv.AST_PCT * 100), rebPct: round(adv.REB_PCT * 100), pace: adv.PACE,
        paintShare: sco ? round(sco.PCT_PTS_PAINT * 100) : null, threeShare: sco ? round(sco.PCT_FGA_3PT * 100) : null, assisted: sco ? round(sco.PCT_AST_FGM * 100) : null,
        drives: drv?.DRIVES ?? null, drivePts: drv?.DRIVE_PTS ?? null, potAst: pas?.POTENTIAL_AST ?? null, touches: tch?.TOUCHES ?? null, timePoss: tch?.TIME_OF_POSS ?? null,
        miles: spd?.DIST_MILES ?? null, speed: spd?.AVG_SPEED ?? null,
        contests36: hus ? per36(hus.CONTESTED_SHOTS, hus.MIN) : null, deflections36: hus ? per36(hus.DEFLECTIONS, hus.MIN) : null, looseBalls: hus?.LOOSE_BALLS_RECOVERED ?? null, charges: hus?.CHARGES_DRAWN ?? null, boxOuts: hus?.BOX_OUTS ?? null, screenAst: hus?.SCREEN_ASSISTS ?? null,
        defWs: def?.DEF_WS ?? null, stl: def?.STL ?? null, blk: def?.BLK ?? null,
        clutch: clu ? { gp: clu.GP, pts: clu.PTS, fg: round(clu.FG_PCT * 100), pm: clu.PLUS_MINUS } : null,
        ptsOffTov: mis?.PTS_OFF_TOV ?? null, ptsFb: mis?.PTS_FB ?? null, ptsPaint: mis?.PTS_PAINT ?? null,
      } : null,
      k2: two ? { ovr: two.ovr, ovr2: two.ovr2 ?? null, arch: two.arch || null, dur: two.dur ?? null, attrs: two.attrs || null, badges: two.badges || null, src: two.src } : null,
    };
    // attitude / motor proxies from data
    if (out.nba) {
      const hustle = [out.nba.deflections36, out.nba.contests36].filter((x) => x != null);
      out.motor = hustle.length ? round(defScore(name, new Date().toISOString()), 2) : null;
    }
    return out;
  }
  function teamExtras(tid, abbr) {
    const s = [seasonStr(curSeason), seasonStr(curSeason - 1)].find((x) => tbl[x]?.teamAdvanced?.get(Number(tid)) || [...(tbl[x]?.teamAdvanced?.values() || [])].length);
    const find = (key) => { const rows = nba[s]?.[key] || []; const t = teams.find((x) => x.id === tid); return rows.find((r) => t && (r.TEAM_ABBREVIATION === abbr || r.TEAM_NAME === t.name || (t.name || "").endsWith(r.TEAM_NAME?.split(" ").pop() || "??"))) || null; };
    const adv = find("teamAdvanced"), ff = find("teamFourFactors"), hus = find("teamHustle"), spd = find("teamSpeed"), mis = find("teamMisc"), sco = find("teamScoring");
    if (!adv) return null;
    return {
      season: s, off: adv.OFF_RATING, def: adv.DEF_RATING, net: adv.NET_RATING, pace: adv.PACE, ts: round(adv.TS_PCT * 100), astPct: round(adv.AST_PCT * 100),
      fourFactors: ff ? { efg: round(ff.EFG_PCT * 100), ftr: round(ff.FTA_RATE * 100), tov: round(ff.TM_TOV_PCT * 100), orb: round(ff.OREB_PCT * 100), oppEfg: round(ff.OPP_EFG_PCT * 100), oppFtr: round(ff.OPP_FTA_RATE * 100), oppTov: round(ff.OPP_TOV_PCT * 100), oppOrb: round(ff.OPP_OREB_PCT * 100) } : null,
      hustle: hus ? { deflections: hus.DEFLECTIONS, contests: hus.CONTESTED_SHOTS, looseBalls: hus.LOOSE_BALLS_RECOVERED, charges: hus.CHARGES_DRAWN, screenAst: hus.SCREEN_ASSISTS } : null,
      miles: spd?.DIST_MILES ?? null, misc: mis ? { ptsOffTov: mis.PTS_OFF_TOV, secondChance: mis.PTS_2ND_CHANCE, fastBreak: mis.PTS_FB, paint: mis.PTS_PAINT, oppPaint: mis.OPP_PTS_PAINT, oppFastBreak: mis.OPP_PTS_FB } : null,
      shotDiet: sco ? { threeShare: round(sco.PCT_FGA_3PT * 100), midShare: round(sco.PCT_PTS_2PT_MR * 100), paintShare: round(sco.PCT_PTS_PAINT * 100), assisted: round(sco.PCT_AST_FGM * 100) } : null,
    };
  }
  function lineups(abbr) {
    for (const s of [seasonStr(curSeason), seasonStr(curSeason - 1)]) {
      const rows = (nba[s]?.lineups || []).filter((r) => r.TEAM_ABBREVIATION === abbr);
      if (rows.length) return rows.sort((a, b) => b.MIN * b.GP - a.MIN * a.GP).slice(0, 5).map((r) => ({ season: s, group: r.GROUP_NAME, gp: r.GP, min: round(r.MIN * r.GP, 0), net: r.NET_RATING, off: r.OFF_RATING, def: r.DEF_RATING }));
    }
    return [];
  }
  function playerStyle(name, iso, live = false) {
    const sc = tbl[safeSeason(iso, live)]?.playerScoring?.get(normName(name));
    return sc ? { paintShare: sc.PCT_PTS_PAINT, threeShare: sc.PCT_FGA_3PT } : null;
  }

  return {
    rating2k: (n) => k2.get(normName(n)) || null,
    height: (n) => height.get(normName(n)) ?? null,
    allNews: () => enriched, archetype, defScore, playerStyle, playerExtras, teamExtras, lineups, newsFor, newsMinutesLimit,
    zd, defenderAt, age, playTypeSeason, leagueSynDef, synPlayer, synTeamDef, nbaTable: (season, key) => tbl[season]?.[key] || null,
    curSeasonStr: seasonStr(curSeason), prevSeasonStr: seasonStr(curSeason - 1),
    sourceSummary: () => ({
      espn: { games: games.length, note: "Schedules, box scores, play-by-play (every shot with court position, shot type, assister, blocker, score and clock), pre-game injury lists, rosters, coaches, injuries, news (ESPN public feeds)" },
      zones: { seasons: Object.keys(nzSeasons), defenderSnapshots: defKeys.length, note: "NBA.com shot locations, closest-defender tracking, Synergy play types and catch-and-shoot / pull-up splits. Shot zones shown on the site are counted from ESPN play-by-play and checked against NBA.com's zone table. In the back-test, defender numbers come from the weekly snapshot dated before each game (previous season until 3 snapshots exist) and play types from the previous season." },
      nbaCom: { seasons: Object.keys(nba).filter((k) => k !== "fetched"), snapshots: snapKeys.length, note: "Official NBA.com stats: advanced, usage, scoring, misc, clutch, defense, hustle, tracking (drives, passing, touches, rebounding, speed/distance), four factors, opponent, 5-man lineups. Weekly point-in-time snapshots keep the back-test leak-free." },
      crossCheck: { checked, matched, agreement: checked ? round(matched / checked * 100, 2) : null, sample: mismatches.slice(0, 10), note: "ESPN box scores compared line-by-line with official NBA.com game logs (points, rebounds, assists)." },
      ratings2k: { players: k2.size, sources: (r2k.sources || []).map((s) => ({ name: s.name, url: s.url, players: s.players.length })), note: r2k.note },
      news: { items: enriched.length, bettingDropped, filter: "Items about betting odds, picks, props or sportsbook promotions are dropped before anything is stored or shown.", outlets: [...new Set(enriched.map((n) => n.outlet))], note: "News sites, blogs, YouTube analyst channels and r/nba. Headline, short summary and link only. Every take that names a player is checked against that player's numbers and labelled. Takes never change a projection by themselves; only reported minutes limits do. TikTok and Facebook have no public feed that can be read without logging in, so they are not included." },
      excluded: "No betting odds, sportsbook lines or prop markets are used.",
    }),
  };
}
