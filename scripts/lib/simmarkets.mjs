// Markets read off the simulated games, and how a finished game settles them.
// The same grid and the same "strictest line at 85%+" rule are used for the
// high-confidence board and for the walk-forward calibration, so the hit rate shown
// next to a board pick is measured on picks chosen exactly the same way.
import { ST } from "./simcore.mjs";
import { S } from "./simhist.mjs";

export const GRID = {
  spread: [1.5, 3.5, 5.5, 7.5, 9.5, 12.5, 15.5, 19.5],
  total: Array.from({ length: 19 }, (_, i) => 180.5 + 5 * i),
  team: Array.from({ length: 15 }, (_, i) => 80.5 + 5 * i),
  pts: [5, 10, 15, 20, 25, 30, 35, 40],
  reb: [2, 4, 6, 8, 10, 12, 14],
  ast: [2, 4, 6, 8, 10, 12],
  tpm: [1, 2, 3, 4, 5, 6],
};
export const PLAYER_STATS = ["pts", "reb", "ast", "tpm"];
export const PLAYER_MIN_FOR_MARKETS = 12;
export const BOARD_MIN = 0.85;
export const BOARD_PLAYER_MIN = 20; // board: player overs only, 20+ projected minutes
export const BANDS = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 0.95], [0.95, 1.0001]];
export const BOARD_BANDS = [[0.85, 0.9], [0.9, 0.95], [0.95, 1.0001]];
export const bandLabel = (b) => `${Math.round(b[0] * 100)}-${Math.min(100, Math.round(b[1] * 100))}%`;
export const bandOf = (p, bands = BANDS) => bands.findIndex((b) => p >= b[0] && p < b[1]);
export const FAMILIES = ["winner", "spread", "total", "teamTotal", "pts", "reb", "ast", "tpm"];

// every market on the grid with its simulated probability
// subject: "H" / "A" team, or player index; side: "win", "by" (wins by more than L), "plus" (+L), "over", "under"
export function markets(out, G, abbr = ["H", "A"]) {
  const N = out.N, P = G.P;
  const res = [];
  const margin = new Int16Array(N), total = new Int16Array(N);
  for (let s = 0; s < N; s++) { margin[s] = out.hs[s] - out.as[s]; total[s] = out.hs[s] + out.as[s]; }
  const frac = (fn) => { let k = 0; for (let s = 0; s < N; s++) if (fn(s)) k++; return k / N; };
  for (const side of [0, 1]) {
    const sg = side === 0 ? 1 : -1, who = abbr[side];
    res.push({ fam: "winner", subj: side, side: "win", line: 0, p: frac((s) => sg * margin[s] > 0), label: `${who} to win` });
    for (const L of GRID.spread) {
      res.push({ fam: "spread", subj: side, side: "by", line: L, p: frac((s) => sg * margin[s] > L), label: `${who} wins by ${Math.ceil(L)}+` });
      res.push({ fam: "spread", subj: side, side: "plus", line: L, p: frac((s) => sg * margin[s] > -L), label: `${who} +${L} (wins, or loses by ${Math.floor(L)} or fewer)` });
    }
    const pts = side === 0 ? out.hs : out.as;
    for (const L of GRID.team) {
      res.push({ fam: "teamTotal", subj: side, side: "over", line: L, p: frac((s) => pts[s] > L), label: `${who} over ${L} points` });
      res.push({ fam: "teamTotal", subj: side, side: "under", line: L, p: frac((s) => pts[s] < L), label: `${who} under ${L} points` });
    }
  }
  for (const L of GRID.total) {
    res.push({ fam: "total", subj: -1, side: "over", line: L, p: frac((s) => total[s] > L), label: `Total over ${L}` });
    res.push({ fam: "total", subj: -1, side: "under", line: L, p: frac((s) => total[s] < L), label: `Total under ${L}` });
  }
  for (let i = 0; i < P; i++) {
    if (G.projMin[i] < PLAYER_MIN_FOR_MARKETS) continue;
    for (const st of PLAYER_STATS) {
      const k = ST[st];
      const hist = new Float64Array(81);
      for (let s = 0; s < N; s++) hist[Math.min(80, out.pl[(s * P + i) * S + k])]++;
      const ge = new Float64Array(82); // ge[x] = P(stat >= x)
      for (let x = 80; x >= 0; x--) ge[x] = ge[x + 1] + hist[x] / N;
      for (const t of GRID[st]) {
        res.push({ fam: st, subj: i, side: "over", line: t, p: ge[t], label: `${G.names[i]} ${t}+ ${st === "tpm" ? "threes" : st === "pts" ? "points" : st === "reb" ? "rebounds" : "assists"}` });
        res.push({ fam: st, subj: i, side: "under", line: t, p: 1 - ge[t], label: `${G.names[i]} under ${t} ${st === "tpm" ? "threes" : st === "pts" ? "points" : st === "reb" ? "rebounds" : "assists"}` });
      }
    }
  }
  return res;
}

// strictest qualifying line per (family, subject, side)
export function boardPicks(list, G, min = BOARD_MIN) {
  const best = new Map();
  // spreads read the usual way: the favourite "wins by more than L", the underdog "+L"
  const win = [0, 1].map((s) => (list.find((m) => m.fam === "winner" && m.subj === s) || { p: 0.5 }).p);
  for (const m of list) {
    if (!(m.p >= min)) continue;
    if (m.fam === "spread" && (m.side === "by") !== (win[m.subj] >= 0.5)) continue;
    if (m.subj >= 0 && PLAYER_STATS.includes(m.fam) && (m.side !== "over" || G.projMin[m.subj] < BOARD_PLAYER_MIN)) continue;
    const key = `${m.fam}|${m.subj}|${m.side}`;
    const cur = best.get(key);
    const stricter = !cur || (m.side === "by" || m.side === "over" ? m.line > cur.line : m.side === "win" ? false : m.line < cur.line);
    if (stricter) best.set(key, m);
  }
  return [...best.values()];
}

// actual: { hs, as, players: Map(index -> { pts, reb, ast, tpm }) }
export function settle(m, act) {
  const margin = act.hs - act.as, total = act.hs + act.as;
  const sg = m.subj === 0 ? 1 : -1;
  switch (m.fam) {
    case "winner": return sg * margin > 0 ? 1 : 0;
    case "spread": return m.side === "by" ? (sg * margin > m.line ? 1 : 0) : (sg * margin > -m.line ? 1 : 0);
    case "teamTotal": { const v = m.subj === 0 ? act.hs : act.as; return m.side === "over" ? (v > m.line ? 1 : 0) : (v < m.line ? 1 : 0); }
    case "total": return m.side === "over" ? (total > m.line ? 1 : 0) : (total < m.line ? 1 : 0);
    default: {
      const p = act.players.get(m.subj);
      const v = p ? p[m.fam] || 0 : 0; // did not play = 0, as in the simulations (they include coach's-decision DNPs)
      return m.side === "over" ? (v >= m.line ? 1 : 0) : (v < m.line ? 1 : 0);
    }
  }
}

// one side of each pair (p >= 0.5), for the reliability table
export function folded(list) {
  const out = [];
  for (const m of list) {
    if (m.side === "under" || m.side === "plus") continue; // their complements are the over / "by" of the other side
    if (m.fam === "winner" && m.subj === 1) continue;
    out.push(m);
  }
  return out;
}

export function emptyTable(bands = BANDS) { return bands.map((b) => ({ band: bandLabel(b), n: 0, said: 0, hit: 0 })); }
export function addTo(table, p, hit, bands = BANDS) {
  const k = bandOf(p, bands);
  if (k < 0) return;
  table[k].n++; table[k].said += p; table[k].hit += hit;
}
export function finishTable(table) {
  return table.map((r) => ({ band: r.band, n: r.n, said: r.n ? Math.round(1000 * r.said / r.n) / 10 : null, happened: r.n ? Math.round(1000 * r.hit / r.n) / 10 : null }));
}
