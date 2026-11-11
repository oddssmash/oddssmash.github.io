// "What changed": diff of the newest projection snapshot in data/history with an earlier one.
import path from "node:path";
import { readJSON } from "./util.mjs";
import { r1, r3, listJson, manilaDateTime } from "./insightutil.mjs";

const MIN_ROLE = 4;   // projected minutes change that counts as a role change
const MIN_PTS = 2;    // projected points change worth listing

export function listSnapshots(dir) {
  return listJson(dir).filter((f) => /^projections-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f)).sort();
}

function index(snap) {
  const games = new Map();
  for (const g of snap.games || []) {
    const pl = new Map();
    (g.players || []).forEach((side, i) => (side || []).forEach(([id, n, min, pts, reb, ast]) => pl.set(id, { id, n, side: i, min: r1(min), pts: r1(pts), reb: r1(reb), ast: r1(ast) })));
    games.set(g.id, { ...g, pl, outSet: [new Set((g.out || [])[0] || []), new Set((g.out || [])[1] || [])] });
  }
  return games;
}

export function diffSnapshots(prev, cur, ctx) {
  const { nameOf, abbr, injuryDetail } = ctx;
  const A = index(prev), B = index(cur);
  const added = [], removed = [], injuries = [], returns = [], roles = [], moves = [], playerMoves = [];
  for (const [id, g] of A) if (!B.has(id)) removed.push({ id, home: g.home, away: g.away, date: g.date });
  for (const [id, g] of B) {
    const o = A.get(id);
    if (!o) { added.push({ id, home: g.home, away: g.away, date: g.date }); continue; }
    const tids = [g.home, g.away];
    for (let s = 0; s < 2; s++) {
      for (const pid of g.outSet[s]) if (!o.outSet[s].has(pid)) injuries.push({ gid: id, team: tids[s], id: pid, n: nameOf(pid), detail: injuryDetail(id, pid) });
      for (const pid of o.outSet[s]) if (!g.outSet[s].has(pid)) returns.push({ gid: id, team: tids[s], id: pid, n: nameOf(pid) });
    }
    const dm = (g.hs - g.as) - (o.hs - o.as), dt = (g.hs + g.as) - (o.hs + o.as), dp = g.pHome - o.pHome;
    moves.push({ gid: id, home: g.home, away: g.away, date: g.date, pHome: [r3(o.pHome), r3(g.pHome)], margin: [r1(o.hs - o.as), r1(g.hs - g.as)], total: [r1(o.hs + o.as), r1(g.hs + g.as)], dMargin: r1(dm), dTotal: r1(dt), dP: r3(dp) });
    for (const [pid, p] of g.pl) {
      const q = o.pl.get(pid);
      const team = tids[p.side];
      if (!q) { if (p.min >= 15) roles.push({ gid: id, team, id: pid, n: p.n, min: [null, p.min], t: `${p.n} enters the projected rotation at ${p.min} minutes.` }); continue; }
      if (Math.abs(p.min - q.min) >= MIN_ROLE) roles.push({ gid: id, team, id: pid, n: p.n, min: [q.min, p.min], t: `${p.n}: ${q.min} to ${p.min} projected minutes.` });
      if (Math.abs(p.pts - q.pts) >= MIN_PTS) playerMoves.push({ gid: id, team, id: pid, n: p.n, pts: [q.pts, p.pts], d: r1(p.pts - q.pts), min: [q.min, p.min] });
    }
    for (const [pid, q] of o.pl) if (!g.pl.has(pid) && q.min >= 15) roles.push({ gid: id, team: tids[q.side], id: pid, n: q.n, min: [q.min, null], t: `${q.n} (${q.min} minutes before) is no longer in the projected rotation${g.outSet[q.side].has(pid) ? " (now listed out)" : ""}.` });
  }
  moves.sort((x, y) => Math.abs(y.dMargin) - Math.abs(x.dMargin));
  playerMoves.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  roles.sort((x, y) => Math.abs((y.min[1] ?? 0) - (y.min[0] ?? 0)) - Math.abs((x.min[1] ?? 0) - (x.min[0] ?? 0)));
  const bigMoves = moves.filter((m) => Math.abs(m.dMargin) >= 1 || Math.abs(m.dP) >= 0.03);
  const lines = [];
  if (injuries.length) lines.push(`${injuries.length} new player${injuries.length > 1 ? "s" : ""} listed out: ${injuries.slice(0, 4).map((x) => `${x.n} (${abbr(x.team)})`).join(", ")}${injuries.length > 4 ? " ..." : ""}.`);
  if (returns.length) lines.push(`${returns.length} off the out list: ${returns.slice(0, 4).map((x) => `${x.n} (${abbr(x.team)})`).join(", ")}${returns.length > 4 ? " ..." : ""}.`);
  if (bigMoves.length) { const m = bigMoves[0]; lines.push(`Biggest move: ${abbr(m.away)} at ${abbr(m.home)}, margin ${m.margin[0]} to ${m.margin[1]} (home minus road), home win chance ${(m.pHome[0] * 100).toFixed(0)}% to ${(m.pHome[1] * 100).toFixed(0)}%.`); }
  if (added.length) lines.push(`${added.length} game${added.length > 1 ? "s" : ""} newly on the board.`);
  if (removed.length) lines.push(`${removed.length} game${removed.length > 1 ? "s" : ""} left the board (played or postponed).`);
  if (!lines.length) lines.push("No injury, role or projection change above the thresholds.");
  return {
    from: { run: prev.run, manila: prev.runManila || manilaDateTime(prev.run) }, to: { run: cur.run, manila: cur.runManila || manilaDateTime(cur.run) },
    lines, injuries, returns, roles: roles.slice(0, 40), gameMoves: bigMoves.slice(0, 20), playerMoves: playerMoves.slice(0, 30), added, removed,
    thresholds: { roleMinutes: MIN_ROLE, playerPoints: MIN_PTS, gameMargin: 1, winChance: 0.03 },
  };
}

export function buildChanges(histDir, ctx) {
  const files = listSnapshots(histDir);
  const base = { snapshots: files.length, note: "Compares the newest saved projection run (data/history) with the run before it and with the last run of the previous Philippine day. Snapshots hold up to 10 players a team with 8+ projected minutes, so a player leaving the list may simply have dropped under 8 minutes. Times are Philippine time." };
  if (!files.length) return { ...base, latest: null, sinceLast: null, sinceYesterday: null, message: "No projection snapshot has been saved yet. Run node scripts/model.mjs (snapshots are written by the normal run, not by CL_OUT scratch runs)." };
  const latestFile = files[files.length - 1];
  const latest = readJSON(path.join(histDir, latestFile));
  const out = { ...base, latest: { file: latestFile, run: latest.run, manila: latest.runManila, games: (latest.games || []).length } };
  if (files.length < 2) return { ...out, sinceLast: null, sinceYesterday: null, message: "Only one projection run has been saved so far, so there is nothing to compare yet. The next model run will create the comparison." };
  const prev = readJSON(path.join(histDir, files[files.length - 2]));
  out.sinceLast = diffSnapshots(prev, latest, ctx);
  const day = (latest.runManila || "").slice(0, 10);
  const yFile = [...files].reverse().find((f) => f.slice(12, 22) < day);
  out.sinceYesterday = yFile && yFile !== files[files.length - 2] ? diffSnapshots(readJSON(path.join(histDir, yFile)), latest, ctx) : null;
  if (!out.sinceYesterday) out.sinceYesterdayNote = yFile ? "The previous run was also the last run of the previous day; see sinceLast." : "No run from an earlier Philippine day is saved yet.";
  return out;
}
