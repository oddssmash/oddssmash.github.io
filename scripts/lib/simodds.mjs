// FOR COMPARISON ONLY. The one place the simulator opens data/odds.json.
//
// Owner rule: sportsbook lines may be shown next to the simulation and on the
// high-confidence board as a comparison, and nothing else. This module is called
// only after a game's simulation is finished and summarized; it reads the finished
// simulated games and the book's numbers and returns a separate block. Nothing it
// returns is fed back into the simulation, the projections, the learning or any
// version 1 page. Key names avoid the raw odds field names on purpose (scripts/checks.mjs
// fails the refresh if those appear in any published file other than odds.json).
import fs from "node:fs";
import path from "node:path";
import { DATA, PUBLIC_DATA, readJSON, writeJSON } from "./util.mjs";
import { S } from "./simhist.mjs";
import { ST } from "./simcore.mjs";

export const COMPARISON_LABEL = "For comparison only. Sportsbook lines are not used by the simulation, the projections or the learning.";
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

export function loadOdds() { return readJSON(path.join(DATA, "odds.json"), null); }

// keep the display copy for the two tabs next to the other site data
export function publishOddsCopy(odds) {
  const dst = path.join(PUBLIC_DATA, "odds.json");
  if (!odds) { try { fs.rmSync(dst, { force: true }); } catch { /* */ } return false; }
  writeJSON(dst, odds);
  return true;
}

const implied = (o) => { const x = Number(o); if (!Number.isFinite(x) || x === 0) return null; return x < 0 ? -x / (-x + 100) : 100 / (x + 100); };
function noVig(a, b) { const pa = implied(a), pb = implied(b); if (pa == null || pb == null) return null; return pa / (pa + pb); }

// out: simulate() result, G: built game, abbr: [home, away]
export function comparison(entry, out, G, abbr) {
  if (!entry) return null;
  const N = out.N, P = G.P;
  const frac = (fn) => { let k = 0; for (let s = 0; s < N; s++) if (fn(s)) k++; return k / N; };
  const cmp = { label: COMPARISON_LABEL, provider: entry.provider || null, fetched: entry.fetched || null };
  const ourHome = frac((s) => out.hs[s] > out.as[s]);
  const bookHome = Number.isFinite(entry.impliedHome) ? entry.impliedHome : null;
  cmp.winner = { team: abbr[0], bookProb: r3(bookHome), ourProb: r3(ourHome), diff: bookHome == null ? null : r3(ourHome - bookHome), note: "home win chance; the book's figure has its margin removed" };
  if (Number.isFinite(entry.spreadHome)) {
    const L = entry.spreadHome; // home line, negative = home favoured; home covers when margin > -L
    const ours = frac((s) => out.hs[s] - out.as[s] > -L);
    const push = Number.isInteger(L) ? frac((s) => out.hs[s] - out.as[s] === -L) : 0;
    const book = noVig(entry.spreadOddsHome, entry.spreadOddsAway);
    cmp.spread = { team: abbr[0], bookLine: L, bookProb: r3(book), ourProb: r3(ours), ourPush: push ? r3(push) : undefined, diff: book == null ? null : r3(ours - book), note: `chance ${abbr[0]} covers ${L > 0 ? "+" : ""}${L}` };
  }
  if (Number.isFinite(entry.total)) {
    const L = entry.total;
    const ours = frac((s) => out.hs[s] + out.as[s] > L);
    const book = noVig(entry.overOdds, entry.underOdds);
    cmp.total = { bookLine: L, bookProb: r3(book), ourProb: r3(ours), diff: book == null ? null : r3(ours - book), note: `chance the total goes over ${L}` };
  }
  const props = [];
  if (entry.props) {
    const idx = new Map(G.ids.map((id, i) => [id, i]));
    for (const [pid, lines] of Object.entries(entry.props)) {
      const i = idx.get(String(pid)); if (i == null) continue;
      for (const [st, L] of Object.entries(lines)) {
        if (!Number.isFinite(L)) continue;
        const get = st === "pra" ? (s) => out.pl[(s * P + i) * S + ST.pts] + out.pl[(s * P + i) * S + ST.reb] + out.pl[(s * P + i) * S + ST.ast]
          : ST[st] != null ? (s) => out.pl[(s * P + i) * S + ST[st]] : null;
        if (!get) continue;
        const vals = new Float64Array(N); for (let s = 0; s < N; s++) vals[s] = get(s);
        const sorted = Float64Array.from(vals).sort();
        const med = sorted[Math.floor(N / 2)];
        let over = 0; for (const v of vals) if (v > L) over++;
        props.push({ id: String(pid), n: G.names[i], stat: st, bookLine: L, ourProbOver: r3(over / N), ourMedian: r1(med), diff: r1(med - L) });
      }
    }
  }
  cmp.props = props;
  cmp.propsNote = "Player lines: ESPN does not say which of its two prices is the over, so only the line is compared (our chance of going over it and our median).";
  return cmp;
}

// board entries: the book's number for the same market where one exists
export function boardComparison(entry, pick, out, G) {
  if (!entry) return null;
  const N = out.N, P = G.P;
  const frac = (fn) => { let k = 0; for (let s = 0; s < N; s++) if (fn(s)) k++; return k / N; };
  const sg = pick.subj === 0 ? 1 : -1;
  if (pick.fam === "winner" && Number.isFinite(entry.impliedHome)) {
    const b = pick.subj === 0 ? entry.impliedHome : 1 - entry.impliedHome;
    return { bookProb: r3(b), diff: r3(pick.p - b) };
  }
  if (pick.fam === "spread" && Number.isFinite(entry.spreadHome)) {
    const Lh = entry.spreadHome, L = pick.subj === 0 ? Lh : -Lh; // this team's line
    const ours = frac((s) => sg * (out.hs[s] - out.as[s]) > -L);
    const bh = noVig(entry.spreadOddsHome, entry.spreadOddsAway);
    const b = bh == null ? null : pick.subj === 0 ? bh : 1 - bh;
    return { bookLine: L, bookProb: r3(b), ourProbAtBookLine: r3(ours) };
  }
  if (pick.fam === "total" && Number.isFinite(entry.total)) {
    const L = entry.total;
    const ours = frac((s) => (pick.side === "over" ? out.hs[s] + out.as[s] > L : out.hs[s] + out.as[s] < L));
    const bo = noVig(entry.overOdds, entry.underOdds);
    const b = bo == null ? null : pick.side === "over" ? bo : 1 - bo;
    return { bookLine: L, bookProb: r3(b), ourProbAtBookLine: r3(ours) };
  }
  if (["pts", "reb", "ast", "tpm"].includes(pick.fam) && entry.props) {
    const L = entry.props[G.ids[pick.subj]] && entry.props[G.ids[pick.subj]][pick.fam];
    if (!Number.isFinite(L)) return null;
    const k = ST[pick.fam];
    const ours = frac((s) => (pick.side === "over" ? out.pl[(s * P + pick.subj) * S + k] > L : out.pl[(s * P + pick.subj) * S + k] < L));
    return { bookLine: L, ourProbAtBookLine: r3(ours) };
  }
  return null;
}
