// Shot zones, shot styles and the decoder for the compact play-by-play cache.
// Pure helpers (no file or network access) shared by the fetcher, the model and,
// logic-wise, the website. Full notes on every raw file: docs/DATA-RAW.md.
//
// ===================== data/pbp/<gameId>.json (format v1) =====================
// Written by scripts/fetch.mjs (scripts/lib/pbp.mjs builds it) from ESPN's game
// summary play-by-play. One file per completed game. Betting fields are never read.
//
// {
//   "v": 1,                      format version (PBP_VERSION in scripts/lib/pbp.mjs)
//   "id": "401810653",           ESPN event id (same id as data/games/<id>.json)
//   "date": "2026-02-20T01:30Z", "season": 2026, "stype": 2,   copied from the schedule
//   "h": "24", "a": "21",        ESPN team ids, home and away
//   "q": [[30,31,37,23],[25,24,22,23]],   points per period: [home[], away[]]; index 4+ = overtime
//   "shots": [ row, ... ],       every field-goal attempt, in ESPN's play order
//   "ft":    [ row, ... ],       every free throw
//   "sc":    [ row, ... ],       running score after every scoring play, in game-time order
//   "tech":  [ row, ... ],       technical / flagrant / ejection events
//   "pf":    [ row, ... ],       per-player foul and turnover counts for the game
//   "tto":   [home, away],       team turnovers with no player attached (shot clock, 5 and 8 seconds)
//   "subs":  [ row, ... ],       substitutions
//   "gap": [0, 6],               only present when the plays do not add up to the final score:
//                                points per side [home, away] that no play accounts for (7 of 1,599 games)
//   "np": 1                      only present when ESPN had no plays for the game (all lists empty)
// }
//
// shots row (index constants: SHOT)
//   0 pid     shooter, ESPN athlete id as a number (0 = unknown)
//   1 side    0 = home team, 1 = away team (the shooter's team)
//   2 per     period, 1-4 regulation, 5+ overtime
//   3 sec     seconds left in the period (one decimal inside the final minute)
//   4 x       ESPN court x, feet, 0..50 across the court, hoop at 25 (null if ESPN had none)
//   5 y       ESPN court y, whole feet toward midcourt; hoop centre at 0.25, baseline at -5, midcourt at 42
//   6 dist    shot distance in feet: the number in ESPN's text ("26-foot") when present,
//             else from x,y, rounded down like the text (flag FL.XY_DIST is then set).
//             ESPN leaves the number out mostly for shots right at the hoop.
//   7 pts     points attempted, 2 or 3
//   8 made    1 made, 0 missed
//   9 fl      shot-style bit flags (FL below); styleOf(fl) gives the single style id
//  10 ast     assister athlete id, 0 = unassisted or missed
//  11 blk     blocker athlete id, 0 = not blocked
//  12 margin  shooting team's score minus opponent's, just before the shot (from the same
//             running score as "sc")
//  13 ps      how the shooting team got the ball (POSS below); +10 when a whistle
//             (foul, timeout, violation, jump ball, substitution) came between that and the shot
//  14 pt      whole seconds between that event and the shot (0-99); 0 when ps is 0 or 10
//
// ft row (FT):    [pid, side, per, sec, made, seq, kind]
//   seq = n*10+m for "free throw n of m" (11 = one shot, 12 = first of two ...)
//   kind: 0 regular, 1 technical, 2 flagrant, 3 clear path
// sc row (SC):    [per, sec, homeScore, awayScore]  (score AFTER the scoring play). Added up from the
//   made shots and free throws in game-time order, so the last row equals the final score unless
//   "gap" is present. ESPN's own per-play score fields are not used (they drift in about 2% of games).
// tech row (TECH): [pid, side, per, sec, kind]       kind ids: TECH_KIND below; pid 0 = coach, bench or team
// pf row (PF):    [pid, side, shootingFouls, offensiveFouls, otherFouls,
//                  tovBadPass, tovLostBall, tovViolation, tovOffensiveFoul, tovStolen]
//   Fouls are fouls COMMITTED (flagrants count under otherFouls, technicals are not counted here).
//   tovViolation = travelling, 3 seconds, back court, stepping out and every other kind.
//   The four tov* kinds add up to the player's turnovers; tovStolen counts how many of them
//   were live-ball (ended in a steal).
// subs row (SUB): [per, sec, side, inPid, outPid]
//   ESPN does not list who starts each period, so on-court fives need inference.
//
// Heaves: from 2025-26 the NBA charges a MISSED end-of-period heave to the team, not the
// player. ESPN types those "Heave Jump Shot" (flag FL.HEAVE, always a miss) and leaves them
// out of the player's box-score attempts; a made one is logged as an ordinary jump shot.
// Count player attempts as: shots rows minus rows with FL.HEAVE.
//
// Known limits (measured, see docs/DATA-RAW.md): x and y are whole feet, so a shot
// within a foot of a zone line can land on either side of it; ESPN's play order has
// rare out-of-order entries; about 0.4% of player-games differ from the box score by a shot.
// =============================================================================

// ---------- half-court geometry (ESPN play-by-play frame, feet) ----------
// x: 0..50 across the court. y: whole feet toward midcourt, with ESPN's origin 5 feet
// inside the baseline. Constants marked "tuned" were fitted against NBA.com's
// shot-location table (2025-26 regular season); the rest are the painted lines.
export const GEOM = {
  courtWidth: 50,
  hoopX: 25,
  hoopY: 0.25,         // fitted on 208,445 shots: ESPN's y origin sits 5 ft inside the baseline
  baselineY: -5,       // hoop centre is 5.25 ft from the baseline
  backboardY: -1,      // backboard face is 4 ft from the baseline
  midcourtY: 42,       // 47 ft from the baseline
  rimRadiusFt: 4,      // restricted-area arc
  rimMaxFt: 3,         // tuned: a two-pointer listed at 0-3 ft (inside the 4 ft arc) counts as "rim"
  rimXYMaxFt: 4.2,     // tuned: same test for shots whose distance had to come from whole-foot x,y
  paintHalfWidth: 8,   // the lane is 16 ft wide
  paintTopY: 13,       // tuned (the free-throw line itself is at y = 14)
  threeRadiusFt: 23.75,
  cornerSideFt: 22,    // corner three line is 22 ft from the hoop, 3 ft inside each sideline
  cornerMaxY: 9,       // tuned: a three at or below this y is a corner three (the line ends 14 ft from the baseline)
  heaveMinFt: 36,      // anything from here out is a heave ("beyond about 35 feet")
  lateHeaveMinFt: 30,  // ... or a three from this far with almost no time left
  lateHeaveSecs: 3,
  atbCentreDeg: 25,    // above-the-break centre slice: within this angle of straight-on
  midCentreDeg: 35,    // mid-range centre slice
  lowXIsLeft: true,    // tuned: ESPN x < 25 matches NBA.com's "Left Corner 3"
};

// ---------- row layouts ----------
export const SHOT = { PID: 0, SIDE: 1, PER: 2, SEC: 3, X: 4, Y: 5, DIST: 6, PTS: 7, MADE: 8, FL: 9, AST: 10, BLK: 11, MARGIN: 12, PS: 13, PT: 14 };
export const FT = { PID: 0, SIDE: 1, PER: 2, SEC: 3, MADE: 4, SEQ: 5, KIND: 6 };
export const SC = { PER: 0, SEC: 1, HOME: 2, AWAY: 3 };
export const TECH = { PID: 0, SIDE: 1, PER: 2, SEC: 3, KIND: 4 };
export const PF = { PID: 0, SIDE: 1, SHOOTING: 2, OFFENSIVE: 3, OTHER: 4, TOV_BAD_PASS: 5, TOV_LOST_BALL: 6, TOV_VIOLATION: 7, TOV_OFF_FOUL: 8, TOV_STOLEN: 9 };
export const SUB = { PER: 0, SEC: 1, SIDE: 2, IN: 3, OUT: 4 };

// Discipline events. Only 1, 2, 3 and 9 are unsportsmanlike-type technicals; 4 and 5
// are rule technicals (no conduct involved); 6-8 are not technical fouls at all.
export const TECH_KIND = {
  1: "Technical foul", 2: "Double technical foul", 3: "Flopping technical",
  4: "Defensive three seconds", 5: "Delay of game technical",
  6: "Flagrant foul 1", 7: "Flagrant foul 2", 8: "Ejection",
  9: "Coach / bench technical", 10: "Other technical",
};

// How the shooting team got the ball (shots column ps, after removing the +10 whistle mark).
export const POSS = { UNKNOWN: 0, AFTER_SCORE: 1, DEF_REBOUND: 2, STEAL: 3, DEAD_TURNOVER: 4, OFF_REBOUND: 5 };
export const POSS_LABEL = ["Period start / unknown", "After opponent scored", "After defensive rebound", "After steal", "After dead-ball turnover", "After own offensive rebound"];

// ---------- shot style ----------
// Every word ESPN puts in the shot type is kept as a bit, so nothing is lost;
// styleOf() folds the bits into one of twelve styles.
export const FL = {
  XY_DIST: 1,      // distance came from x,y because the text had no "N-foot"
  PULLUP: 2, DRIVING: 4, LAYUP: 8, RUNNING: 16, FLOATING: 32, STEPBACK: 64, DUNK: 128,
  CUTTING: 256, TIP: 512, TURNAROUND: 1024, FADE: 2048, HOOK: 4096, OOP: 8192,
  BANK: 16384, REVERSE: 32768, HEAVE: 65536,
};

const FLAG_WORDS = [
  [/pull-?up/, FL.PULLUP], [/driving/, FL.DRIVING], [/layup|finger roll/, FL.LAYUP], [/running/, FL.RUNNING],
  [/floating|floater/, FL.FLOATING], [/step ?back/, FL.STEPBACK], [/dunk/, FL.DUNK], [/cutting/, FL.CUTTING],
  [/putback|tip/, FL.TIP], [/turnaround/, FL.TURNAROUND], [/fade ?away/, FL.FADE], [/hook/, FL.HOOK],
  [/alley ?oop/, FL.OOP], [/bank/, FL.BANK], [/reverse/, FL.REVERSE], [/heave/, FL.HEAVE],
];
// ESPN shot type text ("Driving Floating Bank Jump Shot") -> bit flags (without XY_DIST).
export function styleFlags(typeText = "") {
  const t = String(typeText).toLowerCase();
  let fl = 0;
  for (const [re, bit] of FLAG_WORDS) if (re.test(t)) fl |= bit;
  return fl;
}

export const STYLES = [
  { id: "drive", label: "Drive / layup" },
  { id: "dunk", label: "Dunk" },
  { id: "pull", label: "Pull-up jumper" },
  { id: "step", label: "Step-back" },
  { id: "float", label: "Floater" },
  { id: "post", label: "Hook / post / turnaround / fade" },
  { id: "cut", label: "Cut" },
  { id: "oop", label: "Alley-oop" },
  { id: "tip", label: "Tip / putback" },
  { id: "run", label: "Running / transition" },
  { id: "jump", label: "Catch / plain jumper" },
  { id: "heave", label: "Heave" },
];
export const STYLE_LABEL = Object.fromEntries(STYLES.map((s) => [s.id, s.label]));

// One style per shot. Order matters: how the shot was created wins over how it was finished.
export function styleOf(fl) {
  if (fl & FL.HEAVE) return "heave";
  if (fl & FL.TIP) return "tip";
  if (fl & FL.OOP) return "oop";
  if (fl & FL.CUTTING) return "cut";
  if (fl & FL.RUNNING) return "run";
  if (fl & FL.FLOATING) return "float";
  if (fl & (FL.HOOK | FL.TURNAROUND | FL.FADE)) return "post";
  if (fl & FL.STEPBACK) return "step";
  if (fl & FL.PULLUP) return "pull";
  if (fl & FL.DRIVING) return "drive";
  if (fl & FL.DUNK) return "dunk";
  if (fl & FL.LAYUP) return "drive";
  return "jump";
}

// ---------- zones ----------
// Five zones plus a separate heave bucket.
export const ZONES = [
  { id: "rim", label: "At the rim" },
  { id: "paint", label: "Paint (non-restricted)" },
  { id: "mid", label: "Mid-range" },
  { id: "c3", label: "Corner three" },
  { id: "atb", label: "Above-the-break three" },
  { id: "heave", label: "Heave" },
];
// Finer map: mid-range and above-the-break split left / centre / right, corners left / right.
// "Left" and "right" follow NBA.com's shot-chart naming.
export const FINE_ZONES = [
  { id: "rim", zone: "rim", label: "At the rim" },
  { id: "paint", zone: "paint", label: "Paint (non-restricted)" },
  { id: "midL", zone: "mid", label: "Mid-range, left" },
  { id: "midC", zone: "mid", label: "Mid-range, centre" },
  { id: "midR", zone: "mid", label: "Mid-range, right" },
  { id: "c3L", zone: "c3", label: "Left corner three" },
  { id: "c3R", zone: "c3", label: "Right corner three" },
  { id: "atbL", zone: "atb", label: "Above the break, left wing" },
  { id: "atbC", zone: "atb", label: "Above the break, top" },
  { id: "atbR", zone: "atb", label: "Above the break, right wing" },
  { id: "heave", zone: "heave", label: "Heave" },
];
export const ZONE_IDS = ZONES.map((z) => z.id);
export const FINE_IDS = FINE_ZONES.map((z) => z.id);
export const ZONE_LABEL = Object.fromEntries(ZONES.map((z) => [z.id, z.label]));
export const FINE_LABEL = Object.fromEntries(FINE_ZONES.map((z) => [z.id, z.label]));
export const FINE_TO_ZONE = Object.fromEntries(FINE_ZONES.map((z) => [z.id, z.zone]));
// The NBA.com zone name each of our zones is compared with (data/nbazones.json shotLoc.zones).
export const NBA_ZONE_OF = { rim: "RA", paint: "PAINT", mid: "MID", c3L: "LC3", c3R: "RC3", atb: "ATB3" };

const hasXY = (s) => Number.isFinite(s.x) && Number.isFinite(s.y);
// Distance to the hoop in feet from court coordinates.
export function coordDist(x, y, g = GEOM) { return Math.hypot(x - g.hoopX, y - g.hoopY); }
// Signed angle off straight-on, degrees: negative toward low x, positive toward high x.
export function shotAngle(x, y, g = GEOM) { return Math.atan2(x - g.hoopX, y - g.hoopY) * 180 / Math.PI; }

export function isHeave(s, g = GEOM) {
  if (s.fl & FL.HEAVE) return true;
  if (s.dist >= g.heaveMinFt) return true;
  if (hasXY(s) && s.y >= g.midcourtY) return true;
  return s.pts === 3 && s.dist >= g.lateHeaveMinFt && s.sec <= g.lateHeaveSecs;
}

// shot: { x, y, dist, pts, fl, sec } (a decoded row). Returns { zone, fine }.
export function classifyShot(s, g = GEOM) {
  if (isHeave(s, g)) return { zone: "heave", fine: "heave" };
  const xy = hasXY(s);
  const ang = xy ? shotAngle(s.x, s.y, g) : 0;
  const lr = (a) => ((a < 0) === g.lowXIsLeft ? "L" : "R");
  if (s.pts === 3) {
    if (xy && s.y <= g.cornerMaxY && s.x !== g.hoopX) return { zone: "c3", fine: `c3${lr(ang)}` };
    return { zone: "atb", fine: Math.abs(ang) <= g.atbCentreDeg ? "atbC" : `atb${lr(ang)}` };
  }
  if (s.dist <= g.rimMaxFt || ((s.fl & FL.XY_DIST) && xy && coordDist(s.x, s.y, g) < g.rimXYMaxFt)) return { zone: "rim", fine: "rim" };
  const inLane = xy ? Math.abs(s.x - g.hoopX) <= g.paintHalfWidth && s.y <= g.paintTopY : s.dist <= g.paintHalfWidth;
  if (inLane) return { zone: "paint", fine: "paint" };
  return { zone: "mid", fine: Math.abs(ang) <= g.midCentreDeg ? "midC" : `mid${lr(ang)}` };
}

// ---------- decoders ----------
export const periodSeconds = (per) => (per <= 4 ? 720 : 300);
// Seconds played since tip-off for a (period, seconds-left) pair.
export function elapsedSeconds(per, sec) {
  const before = per <= 4 ? (per - 1) * 720 : 2880 + (per - 5) * 300;
  return before + periodSeconds(per) - sec;
}
const sid = (n) => (n ? String(n) : null);

// One shots row -> object. Ids come back as strings, like everywhere else in the project.
export function decodeShot(r, g, geom = GEOM) {
  const side = r[SHOT.SIDE], ps = r[SHOT.PS] || 0;
  const s = {
    pid: sid(r[SHOT.PID]), side, tid: side ? g.a : g.h, opp: side ? g.h : g.a,
    per: r[SHOT.PER], sec: r[SHOT.SEC], x: r[SHOT.X], y: r[SHOT.Y], dist: r[SHOT.DIST],
    pts: r[SHOT.PTS], made: r[SHOT.MADE], fl: r[SHOT.FL], style: styleOf(r[SHOT.FL]),
    ast: sid(r[SHOT.AST]), blk: sid(r[SHOT.BLK]), margin: r[SHOT.MARGIN],
    poss: ps % 10, whistle: ps >= 10, possSecs: r[SHOT.PT] || 0,
  };
  const z = classifyShot(s, geom);
  s.zone = z.zone; s.fine = z.fine;
  return s;
}
export function decodeShots(g, geom = GEOM) { return (g?.shots || []).map((r) => decodeShot(r, g, geom)); }

export function decodeFreeThrows(g) {
  return (g?.ft || []).map((r) => ({
    pid: sid(r[FT.PID]), side: r[FT.SIDE], tid: r[FT.SIDE] ? g.a : g.h, per: r[FT.PER], sec: r[FT.SEC], made: r[FT.MADE],
    n: Math.floor(r[FT.SEQ] / 10), of: r[FT.SEQ] % 10, kind: r[FT.KIND],
  }));
}
export function decodeTech(g) {
  return (g?.tech || []).map((r) => ({ pid: sid(r[TECH.PID]), side: r[TECH.SIDE], tid: r[TECH.SIDE] ? g.a : g.h, per: r[TECH.PER], sec: r[TECH.SEC], kind: r[TECH.KIND], label: TECH_KIND[r[TECH.KIND]] || "Other" }));
}
export function decodePlayerCounts(g) {
  return (g?.pf || []).map((r) => ({
    pid: sid(r[PF.PID]), side: r[PF.SIDE], tid: r[PF.SIDE] ? g.a : g.h,
    shootingFouls: r[PF.SHOOTING], offensiveFouls: r[PF.OFFENSIVE], otherFouls: r[PF.OTHER],
    tovBadPass: r[PF.TOV_BAD_PASS], tovLostBall: r[PF.TOV_LOST_BALL], tovViolation: r[PF.TOV_VIOLATION], tovOffFoul: r[PF.TOV_OFF_FOUL], tovStolen: r[PF.TOV_STOLEN],
  }));
}
export function decodeSubs(g) {
  return (g?.subs || []).map((r) => ({ per: r[SUB.PER], sec: r[SUB.SEC], side: r[SUB.SIDE], tid: r[SUB.SIDE] ? g.a : g.h, in: sid(r[SUB.IN]), out: sid(r[SUB.OUT]) }));
}
// Score after every scoring play, with seconds since tip-off and the home margin.
export function scoreFlow(g) {
  return (g?.sc || []).map((r) => ({ per: r[SC.PER], sec: r[SC.SEC], t: elapsedSeconds(r[SC.PER], r[SC.SEC]), home: r[SC.HOME], away: r[SC.AWAY], margin: r[SC.HOME] - r[SC.AWAY] }));
}
