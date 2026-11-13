// HIT RATES against the sportsbook MAIN LINE for today's and tomorrow's games, written to public/data/hitrates.json.
//
//   node scripts/hitrates.mjs        (after model.mjs; reads the published player logs, odds.json and results.json)
//
// For every player prop the sportsbook has posted (points, rebounds, assists, threes made) it counts how often the player
// went over that exact line in his last 5, 10 and 20 games, against tonight's opponent, at home or away (tonight's side),
// as a starter, and in games a teammate who is out tonight also missed. It adds the opponent's rank for what it allows
// to the player's position (1 = allows the most). Teams get the same for their team total and spread.
// Counts only: they are shown next to our projections, never used by the model. Pushes (exactly on the line) don't count.
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DATA, readJSON, writeJSON } from "./lib/util.mjs";

const FAMS = ["pts", "reb", "ast", "tpm"];
const up = readJSON(path.join(PUBLIC_DATA, "upcoming.json"), []);
const odds = readJSON(path.join(PUBLIC_DATA, "odds.json"), {});
const results = readJSON(path.join(PUBLIC_DATA, "results.json"), []);
const index = readJSON(path.join(PUBLIC_DATA, "players.json"), []);
const pdir = path.join(PUBLIC_DATA, "players");
const prof = new Map();
for (const f of fs.readdirSync(pdir)) { const p = readJSON(path.join(pdir, f)); if (p?.id) prof.set(String(p.id), p); }
const byName = new Map(index.map((p) => [p.n, String(p.id)]));
const posG = (pos) => (/C/.test(pos || "") ? "C" : /G/.test(pos || "") ? "G" : "F");
const played = (p) => (p?.log || []).filter((r) => !r.dnp && r.min > 0);

// count over/under a line in a list of games: [overs, decided games] (pushes left out)
const tally = (games, fam, line) => { let o = 0, n = 0; for (const r of games) { const v = r[fam]; if (v == null || v === line) continue; n++; if (v > line) o++; } return [o, n]; };

// OPPONENT RANK BY POSITION: from every published game log (players with 20+ minutes), what each team allowed per game to
// guards, forwards and centres in each stat, ranked 1 (allows the most) to 30
const allowed = {};
for (const p of prof.values()) { const g = posG(p.pos); for (const r of played(p)) { if (r.min < 20) continue; const k = `${r.opp}|${g}`, a = (allowed[k] ||= { n: 0, pts: 0, reb: 0, ast: 0, tpm: 0 }); a.n++; for (const f of FAMS) a[f] += r[f] || 0; } }
const rankOf = {};
for (const g of ["G", "F", "C"]) for (const f of FAMS) {
  const rows = Object.entries(allowed).filter(([k, a]) => k.endsWith("|" + g) && a.n >= 8).map(([k, a]) => [k.split("|")[0], a[f] / a.n]).sort((a, b) => b[1] - a[1]);
  rows.forEach(([t], i) => { rankOf[`${t}|${g}|${f}`] = { rank: i + 1, of: rows.length }; });
}

// team results, newest first, for team total and spread trends
const teamGames = (tid) => results.filter((r) => r.act && (r.home === tid || r.away === tid)).sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => { const h = r.home === tid; return { opp: h ? r.away : r.home, h: h ? 1 : 0, pts: h ? r.act.hs : r.act.as, mg: h ? r.act.hs - r.act.as : r.act.as - r.act.hs }; });

const now = Date.now(), games = {}, cheats = [];
for (const g of up) {
  const t0 = Date.parse(g.date); if (!t0 || t0 < now - 4 * 3600e3 || t0 > now + 40 * 3600e3) continue;
  const o = odds.games?.[g.id]; if (!o) continue;
  const out = { home: (g.out?.[0] || []).map((n) => byName.get(n)).filter(Boolean), away: (g.out?.[1] || []).map((n) => byName.get(n)).filter(Boolean) };
  const props = [];
  for (const [pid, lines] of Object.entries(o.props || {})) {
    const p = prof.get(String(pid)); if (!p) continue;
    const side = String(p.team) === String(g.home) ? "home" : String(p.team) === String(g.away) ? "away" : null; if (!side) continue;
    const opp = side === "home" ? g.away : g.home, log = played(p), isHome = side === "home" ? 1 : 0, gp = posG(p.pos);
    for (const fam of FAMS) {
      const line = lines[fam]; if (!Number.isFinite(line)) continue;
      const l20 = tally(log.slice(0, 20), fam, line), l10 = tally(log.slice(0, 10), fam, line), l5 = tally(log.slice(0, 5), fam, line);
      if (l10[1] < 3) continue;
      const vs = tally(log.filter((r) => String(r.opp) === String(opp)), fam, line), ha = tally(log.filter((r) => r.h === isHome), fam, line), st = tally(log.filter((r) => r.st), fam, line);
      // games a teammate who is OUT tonight also missed (his log has no minutes in that game)
      const wo = [];
      for (const mid of out[side]) { const m = prof.get(mid); if (!m || mid === String(pid)) continue; const mp = new Set(played(m).map((r) => r.g)); const miss = log.filter((r) => r.g && !mp.has(r.g)); const tl = tally(miss, fam, line); if (tl[1] >= 2) wo.push({ n: m.n, o: tl[0], c: tl[1] }); }
      const over = l10[0] / l10[1] >= 0.5, flip = ([a, n]) => (over ? [a, n] : [n - a, n]);
      const avg10 = log.slice(0, 10).reduce((a, r) => a + (r[fam] || 0), 0) / Math.max(1, Math.min(10, log.length));
      const rk = rankOf[`${opp}|${gp}|${fam}`];
      const row = { pid: String(pid), n: p.n, t: String(p.team), pos: gp, fam, line, side: over ? "Over" : "Under", l5: flip(l5), l10: flip(l10), l20: flip(l20), vs: flip(vs), ha: flip(ha), home: isHome, st: flip(st), wo: wo.map((w) => ({ n: w.n, h: over ? w.o : w.c - w.o, c: w.c })), avg10: Math.round(avg10 * 10) / 10, opp: String(opp), oppRank: rk ? (over ? rk.rank : rk.of + 1 - rk.rank) : null, oppOf: rk?.of || null };
      props.push(row);
      const rate = row.l10[0] / row.l10[1];
      cheats.push({ game: g.id, date: g.date, ...row, rate });
    }
  }
  // TEAM TRENDS: tonight's team total (from the book's total and spread) and spread, applied to past games
  const team = [];
  if (Number.isFinite(o.total) && Number.isFinite(o.spreadHome)) for (const [tid, sideH] of [[g.home, 1], [g.away, 0]]) {
    const spr = sideH ? o.spreadHome : -o.spreadHome, tt = Math.round(((o.total - spr) / 2) * 2) / 2, tg = teamGames(tid), opp = sideH ? g.away : g.home;
    const cnt = (list, f) => { let a = 0, n = 0; for (const x of list) { const d = f(x); if (d === 0) continue; n++; if (d > 0) a++; } return [a, n]; };
    const ttF = (x) => x.pts - tt, spF = (x) => x.mg + spr;
    const mk = (kind, line, f) => { const l10 = cnt(tg.slice(0, 10), f), over = l10[1] ? l10[0] / l10[1] >= 0.5 : true, fl = ([a, n]) => (over ? [a, n] : [n - a, n]);
      return { t: String(tid), kind, line, side: kind === "tt" ? (over ? "Over" : "Under") : over ? "Cover" : "Fail", l5: fl(cnt(tg.slice(0, 5), f)), l10: fl(l10), l20: fl(cnt(tg.slice(0, 20), f)), vs: fl(cnt(tg.filter((x) => x.opp === opp).slice(0, 10), f)), ha: fl(cnt(tg.filter((x) => x.h === sideH).slice(0, 10), f)), home: sideH }; };
    team.push(mk("tt", tt, ttF), mk("spread", spr, spF));
  }
  if (props.length || team.length) games[g.id] = { date: g.date, home: g.home, away: g.away, props: props.sort((a, b) => b.l10[0] / b.l10[1] - a.l10[0] / a.l10[1] || b.l10[1] - a.l10[1]), team };
}

writeJSON(path.join(PUBLIC_DATA, "hitrates.json"), {
  generated: new Date().toISOString(),
  note: "How often each player (and team) beat tonight's sportsbook main line in past games. Counts only: shown next to our projections, never used by the model. Pushes are left out. Opponent rank: 1 = allows the most to that position in that stat (for an Under, 1 = allows the least).",
  games,
});
console.log(`hitrates: ${Object.keys(games).length} games, ${cheats.length} props`);
