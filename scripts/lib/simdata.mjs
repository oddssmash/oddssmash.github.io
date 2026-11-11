// File access for the simulator: finished box scores, walk-forward projection pages,
// period scores, upcoming projections. Read-only. Odds are NOT loaded here
// (scripts/lib/simodds.mjs is the only file that opens data/odds.json).
import fs from "node:fs";
import path from "node:path";
import { DATA, PUBLIC_DATA, readJSON } from "./util.mjs";

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export function loadBoxes() {
  const dir = path.join(DATA, "games");
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const g = readJSON(path.join(dir, f), null);
    if (!g || !g.completed || !g.date) continue;
    out.push(g);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id))));
  return out;
}

// period scores and the score after each scoring play (data/pbp)
export function loadFlow(id) {
  const p = readJSON(path.join(DATA, "pbp", `${id}.json`), null);
  return p && Array.isArray(p.q) ? { q: p.q, sc: Array.isArray(p.sc) ? p.sc : null } : null;
}

export function loadPage(id) {
  return readJSON(path.join(PUBLIC_DATA, "games", `${id}.json`), null);
}

// a walk-forward projection page -> simulator input
export function pastInput(page) {
  const home = String(page.home), away = String(page.away);
  const players = [];
  for (const p of page.players || []) {
    if (!p.pred || !(num(p.pred.min) > 0)) continue;
    const t = String(p.t);
    if (t !== home && t !== away) continue;
    players.push({ id: String(p.id), n: p.n, pos: p.pos, role: p.role, side: t === home ? 0 : 1,
      min: p.pred.min, pts: p.pred.pts, reb: p.pred.reb, ast: p.pred.ast, tpm: p.pred.tpm, tpa: p.pred.tpa });
  }
  return { id: String(page.id), date: page.date, home, away, pace: page.pace, hs: page.pred.hs, as: page.pred.as, players };
}

// an upcoming projection (public/data/upcoming/<id>.json) -> simulator input
// inactive: Set of player ids NBA.com lists as inactive for this game (data/pregame.json)
export function upcomingInput(d, inactive = new Set()) {
  const players = [], lateOut = [];
  (d.teams || []).forEach((t, side) => {
    for (const p of t.players || []) {
      if (!(num(p.min) > 0)) continue;
      if (inactive.has(String(p.id))) { lateOut.push({ id: String(p.id), n: p.n, t: String(t.tid), min: p.min, pts: p.pts }); continue; }
      // blowout minutes are role-based (simhist blowRole), the same source the walk-forward calibration
      // uses; the model's per-player blowout evidence (p.ix.blowout) is not calibrated, so it is not read here
      players.push({ id: String(p.id), n: p.n, pos: p.pos, role: p.role, side, q: !!p.q,
        min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, tpm: p.tpm, tpa: p.tpa, stl: p.stl, blk: p.blk });
    }
  });
  // the model's quarter split (display-only there): used to spread each team's scoring over the four quarters
  const qf = (d.teams || []).map((t) => { const q = t.quarters && t.quarters.proj; const s = Array.isArray(q) && q.length === 4 ? q.reduce((a, b) => a + num(b), 0) : 0; return s > 0 ? q.map((x) => 4 * num(x) / s) : [1, 1, 1, 1]; });
  return { id: String(d.id), date: d.date, home: String(d.home), away: String(d.away), pace: d.pred && d.pred.pace, hs: d.pred.hs, as: d.pred.as, players, lateOut, qf: qf.length === 2 ? qf : null };
}

// NBA.com inactive lists for open games (only once NBA.com has published the list)
export function inactiveFor(pregame, id) {
  const g = pregame && pregame[id];
  const set = new Set();
  if (!g || !g.lineups) return set;
  for (const k of ["home", "away"]) {
    const L = g.lineups[k];
    if (!L || !(L.activeListed > 0)) continue;
    for (const p of L.inactive || []) if (p && p.id) set.add(String(p.id));
  }
  return set;
}
