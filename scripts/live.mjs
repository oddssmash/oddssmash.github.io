// In-game predictions for games in progress (and today's finals), written to public/data/live.json.
// Uses the pre-game projection (public/data/upcoming/<id>.json) plus the current score, time left and
// each player's current box-score line. No betting odds are used.
//
//   node scripts/live.mjs
//
// Method (simple and transparent):
//   time left      rem = share of regulation (or of the current overtime) still to play
//   final margin   current lead + pre-game projected margin x rem
//   uncertainty    sd = 1.5 + 13.5 x sqrt(rem) points (the model's game-level spread, shrinking as time runs out)
//   win chance     normal probability that the final margin is above zero
//   final scores   current score + pre-game projected points x rem, per team
//   players        current stat + projected stat x his remaining share of minutes (0 if he has fouled out
//                  or not played in the first half of a game he was expected to play)
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DATA, readJSON, writeJSON, getJSON, addDays, easternToday } from "./lib/util.mjs";
import { phi } from "./lib/stats.mjs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const today = easternToday();
const num = (v) => (v === undefined || v === null || v === "" || v === "--" ? 0 : Number(String(v).replace("+", "")) || 0);
const clockSec = (c) => { const m = String(c || "0:00").split(":"); return m.length === 2 ? num(m[0]) * 60 + num(m[1]) : num(m[0]); };

function remainingShare(period, clock) {
  const sec = clockSec(clock);
  if (period <= 4) return Math.max(0, ((4 - period) * 720 + sec) / 2880);
  return Math.max(0, sec / 2880); // overtime: only what is left of this overtime period
}

function playerLines(summary) {
  const out = new Map();
  for (const side of summary?.boxscore?.players || []) {
    const st = side.statistics?.[0]; if (!st) continue;
    const k = st.keys || [];
    for (const a of st.athletes || []) {
      const v = a.stats || [], g = (key) => v[k.indexOf(key)];
      out.set(String(a.athlete.id), { t: side.team.id, min: num(g("minutes")), pts: num(g("points")), reb: num(g("rebounds")), ast: num(g("assists")), tpm: num(String(g("threePointFieldGoalsMade-threePointFieldGoalsAttempted") || "0-0").split("-")[0]), pf: num(g("fouls")), dnp: a.didNotPlay ? 1 : 0, active: a.active !== false });
    }
  }
  return out;
}

const games = [];
for (const d of [addDays(today, -1), today]) {
  const sb = await getJSON(`${ESPN}/scoreboard?dates=${d}&limit=100`).catch(() => null);
  for (const ev of sb?.events || []) {
    const state = ev.status?.type?.state; // pre | in | post
    if (state === "pre") continue;
    const c = ev.competitions[0], h = c.competitors.find((x) => x.homeAway === "home"), a = c.competitors.find((x) => x.homeAway === "away");
    const pre = readJSON(path.join(PUBLIC_DATA, "upcoming", `${ev.id}.json`));
    const results = readJSON(path.join(PUBLIC_DATA, "results.json"), []);
    const done = results.find((r) => r.id === ev.id);
    const hs = num(h.score), as = num(a.score), period = ev.status?.period || 0, clock = ev.status?.displayClock || "0:00";
    const row = { id: ev.id, date: ev.date, home: h.team.id, away: a.team.id, state, detail: ev.status?.type?.shortDetail || "", period, clock, hs, as };
    const preH = pre?.pred?.hs ?? done?.pred?.hs, preA = pre?.pred?.as ?? done?.pred?.as;
    if (preH != null) { row.preH = preH; row.preA = preA; row.prePHome = pre?.pred?.pHome ?? done?.pred?.pHome; }
    if (state === "post") {
      if (preH != null) row.called = (hs > as) === (preH > preA);
      // final box score (points, rebounds, assists, threes made per player id) so game cards can grade our prop calls
      const fin = playerLines(await getJSON(`${ESPN}/summary?event=${ev.id}`).catch(() => null));
      if (fin.size) { row.box = {}; for (const [pid, v] of fin) if (!v.dnp && v.min > 0) row.box[pid] = [v.pts, v.reb, v.ast, v.tpm]; }
      games.push(row); continue;
    }
    // in progress
    const rem = remainingShare(period, clock);
    row.rem = Math.round(rem * 1000) / 1000;
    if (preH != null) {
      const margin = hs - as + (preH - preA) * rem, sd = 1.5 + 13.5 * Math.sqrt(rem); // the extra 1.5 keeps late-game chances from being over-confident
      row.pHome = Math.round(phi(margin / sd) * 1000) / 1000;
      row.projH = Math.round((hs + preH * rem) * 10) / 10;
      row.projA = Math.round((as + preA * rem) * 10) / 10;
      row.projTotal = Math.round((row.projH + row.projA) * 10) / 10;
    }
    if (pre?.teams) {
      const summary = await getJSON(`${ESPN}/summary?event=${ev.id}`).catch(() => null);
      const box = playerLines(summary);
      const players = [];
      for (const t of pre.teams) for (const p of (t.players || []).filter((x) => x.min >= 12).slice(0, 8)) {
        const cur = box.get(String(p.id)) || { min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, pf: 0, dnp: 1 };
        const out = cur.pf >= 6 || cur.dnp || (cur.min === 0 && rem < 0.5);
        const share = out ? 0 : Math.min(1, Math.max(0, (p.min - cur.min) / Math.max(1, p.min)) || rem);
        const live = (k) => Math.round((cur[k] + (p[k] || 0) * share) * 10) / 10;
        const line = Math.round((p.pts || 0) - 0.5) + 0.5;
        const sd = Math.max(0.5, ((p.hi ?? p.pts + 7) - (p.lo ?? p.pts - 7)) / 2.56 * Math.sqrt(Math.max(share, 0.01)));
        const pOver = cur.pts > line ? 1 : out ? 0 : 1 - phi((line - live("pts")) / sd);
        players.push({ id: p.id, n: p.n, t: t.tid, cur: { min: cur.min, pts: cur.pts, reb: cur.reb, ast: cur.ast, pf: cur.pf }, pre: { pts: p.pts, reb: p.reb, ast: p.ast }, live: { pts: live("pts"), reb: live("reb"), ast: live("ast") }, line, pOver: Math.round(pOver * 1000) / 1000, out: !!out });
      }
      row.players = players;
    }
    games.push(row);
  }
}
writeJSON(path.join(PUBLIC_DATA, "live.json"), { fetched: new Date().toISOString(), note: "In-game predictions from the pre-game projection, the current score and time left. Only as fresh as the last data refresh. No betting odds are used.", games });
console.log(`live: ${games.filter((g) => g.state === "in").length} in progress, ${games.filter((g) => g.state === "post").length} final`);
