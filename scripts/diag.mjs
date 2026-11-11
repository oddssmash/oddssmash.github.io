// Accuracy diagnostics for the walk-forward back-test.
//   node scripts/diag.mjs            reads public/data
//   CL_OUT=<folder> node scripts/diag.mjs   reads a scratch copy written by CL_OUT=<folder> node scripts/model.mjs
// The first block (one line per phase, calibration, upset flags) keeps the format of the
// saved baseline so two runs can be compared line by line.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.CL_OUT ? path.resolve(process.env.CL_OUT) : "public/data";
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const dir = path.join(ROOT, "games");
const R = rd("results.json");
const by = {};
for (const r of R) {
  const d = JSON.parse(fs.readFileSync(`${dir}/${r.id}.json`));
  const o = (by[r.pk] ||= { n: 0, pts: 0, noSplit: 0, noFx: 0, reb: 0, ast: 0, min: 0, tpa: 0, bias: 0, brier: 0, g: 0, naive: 0, cov: 0, covN: 0, win: 0, mErr: 0 });
  o.g++; o.brier += ((r.act.hs > r.act.as ? 1 : 0) - r.pred.pHome) ** 2; o.naive += (r.act.hs > r.act.as ? 1 : 0);
  o.win += r.correct ? 1 : 0; o.mErr += r.err;
  for (const p of d.players) {
    if (!p.pred || p.act.dnp || p.pred.min < 15) continue;
    o.n++; o.pts += Math.abs(p.act.pts - p.pred.pts); o.noSplit += Math.abs(p.act.pts - (p.pred.pts - (p.adj.split || 0)));
    o.noFx += Math.abs(p.act.pts - (p.pred.pts - (p.adj.fx || 0)));
    o.reb += Math.abs(p.act.reb - p.pred.reb); o.ast += Math.abs(p.act.ast - p.pred.ast); o.min += Math.abs(p.act.min - p.pred.min); o.tpa += Math.abs(p.act.tpa - p.pred.tpa); o.bias += p.act.pts - p.pred.pts;
    o.covN++; if (p.act.pts >= p.pred.lo && p.act.pts <= p.pred.hi) o.cov++;
  }
}
for (const [k, o] of Object.entries(by)) console.log(k, "n", o.n, "ptsMAE", (o.pts / o.n).toFixed(2), "noSplit", (o.noSplit / o.n).toFixed(2), "reb", (o.reb / o.n).toFixed(2), "ast", (o.ast / o.n).toFixed(2), "min", (o.min / o.n).toFixed(2), "tpa", (o.tpa / o.n).toFixed(2), "bias", (o.bias / o.n).toFixed(2), "brier", (o.brier / o.g).toFixed(3), "homeWin", (o.naive / o.g).toFixed(2));
// calibration
const b = {};
for (const r of R.filter((r) => r.pk.endsWith("-2"))) { const p = Math.max(r.pred.pHome, 1 - r.pred.pHome); const k = Math.min(9, Math.floor(p * 10)); (b[k] ||= [0, 0]); b[k][0]++; b[k][1] += r.correct ? 1 : 0; }
console.log("calibration", Object.entries(b).map(([k, [n, c]]) => `${k * 10}%+: ${n} games ${(c / n * 100).toFixed(0)}%`).join(" | "));
const fl = R.filter((r) => r.upsetFlag && r.pk.endsWith("-2")), nf = R.filter((r) => !r.upsetFlag && r.pk.endsWith("-2"));
console.log("upset flagged", fl.length, "upset rate", (fl.filter((r) => r.upset).length / fl.length).toFixed(2), "| not flagged", nf.length, (nf.filter((r) => r.upset).length / nf.length).toFixed(2));

// ---- one table: winner, margin, player lines, range coverage, with the pre-factor points error next to it ----
console.log("\nphase      games  winner%  marginMAE | players  ptsMAE  (no factors)  rebMAE  astMAE  3paMAE  minMAE  range80%");
for (const [k, o] of Object.entries(by)) console.log(k.padEnd(10), String(o.g).padStart(5), (o.win / o.g * 100).toFixed(1).padStart(8), (o.mErr / o.g).toFixed(2).padStart(10), "|", String(o.n).padStart(7), (o.pts / o.n).toFixed(3).padStart(7), (o.noFx / o.n).toFixed(3).padStart(13), (o.reb / o.n).toFixed(3).padStart(7), (o.ast / o.n).toFixed(3).padStart(7), (o.tpa / o.n).toFixed(3).padStart(7), (o.min / o.n).toFixed(2).padStart(7), (o.cov / o.covN * 100).toFixed(1).padStart(9));

const L = rd("learning.json");
// "(no factors)" = published points minus adj.fx, the factor effect after the team-total blend.
if (L.liveTrack) {
  console.log("\nlive-like track (no line-ups, no inactive list; never learned from) next to the tip-off track above");
  console.log("phase      games  winner%  marginMAE | players  ptsMAE  minMAE  absent%  top5min  rotation");
  for (const p of L.liveTrack.phases) console.log(p.pk.padEnd(10), String(p.games).padStart(5), (p.winnerAcc * 100).toFixed(1).padStart(8), p.marginMAE.toFixed(2).padStart(10), "|", String(p.players).padStart(7), String(p.ptsMAE).padStart(7), String(p.minMAE).padStart(7), (p.absentShare * 100).toFixed(1).padStart(8), String(p.top5Min).padStart(8), String(p.rotation).padStart(9));
}
if (L.withWithout) console.log("with/without evidence applied to projections:", L.withWithout.applied);
console.log("\nrange coverage (model, 12+ projected minutes, no preseason):", JSON.stringify(L.rangeCoverage));
console.log("calibration table:", L.calibration.map((c) => `${c.bucket} n${c.games} said ${c.said} got ${c.happened}`).join(" | "));
if (L.factors) {
  console.log(`\nlearned matchup factors (${L.factors.note || ""})`);
  console.log("factor".padEnd(34), "stat  games   coef    gate  avg|x|  avgEffect  errWithout  errWith  reduction  t     verdict");
  for (const f of L.factors.rows) console.log(f.label.slice(0, 33).padEnd(34), f.stat.padEnd(5), String(f.games).padStart(6), String(f.coef).padStart(7), String(f.gate).padStart(6), String(f.avgAbsX).padStart(7), String(f.avgAbsEffect).padStart(9), String(f.errWithout).padStart(11), String(f.errWith).padStart(8), String(f.reduction).padStart(10), String(f.t).padStart(5), " ", f.verdict);
  if (L.factors.total) console.log("all factors together:", JSON.stringify(L.factors.total));
}

if (L.inloop) {
  const I = L.inloop;
  console.log("\nin-loop features (stat min = published minutes; tpts = team points)");
  console.log("feature".padEnd(10), "stat  games   coef    gate  avg|x|  errWithout  errWith  oosGainIfFull  t      verdict");
  for (const f of [...I.players.rows, ...I.team.rows]) console.log(f.id.padEnd(10), f.stat.padEnd(5), String(f.games).padStart(6), String(f.coef).padStart(7), String(f.gate).padStart(6), String(f.avgAbsX).padStart(7), String(f.errWithout).padStart(11), String(f.errWith).padStart(8), String(f.oosGainIfFull).padStart(14), String(f.t).padStart(5), " ", f.verdict.slice(0, 70));
  if (I.quarters) console.log(`quarter split (regulation games ${I.quarters.games}): MAE per team-quarter model ${I.quarters.maeModel}, even split ${I.quarters.maeEvenSplit}, league shares ${I.quarters.maeLeagueShares}`);
  if (I.flow) console.log(`on-court reconstruction: ${I.flow.recorded} games, ${I.flow.missing} without substitutions, ${I.flow.partial} with a stretch not fully inferred`);
  if (I.returnCurves) for (const b of I.returnCurves.rows) console.log(`return ${b.bucket.padEnd(5)}`, b.games.map((x) => `g${x.k} n${x.n} min ${x.minVsProj} (${x.minPctOfBefore}% of before)`).join(" | "));
}
const m = rd("meta.json"); console.log("\n" + JSON.stringify(m.sources.crossCheck).slice(0, 400));
console.log(L.params.slice(-2), L.scenarios.length);
for (const s of L.scenarios.slice(0, 40)) { const st = s.roles.star?.pts, sm = s.roles.star?.min; if (st) console.log(s.s.padEnd(48), "star pts", st.effect, "raw", st.rawAvg, "n", st.n, "| min", sm?.effect); }
console.log(L.teamScenarios.slice(0, 14).map((t) => `${t.k}: ${t.effect} (raw ${t.rawAvg}, n${t.n})`).join("\n"));
const U = rd("upcoming.json"); const u0 = U[0];
if (u0) { const u = rd(`upcoming/${u0.id}.json`); console.log(u.date, JSON.stringify(u.pred), JSON.stringify(u.upset).slice(0, 200), "\n" + u.teams.map((t) => t.tid + " " + t.pts + " out:" + t.out.map((o) => o.n).join(",") + " | " + t.players.slice(0, 4).map((p) => `${p.n} ${p.min}m ${p.pts}p ${p.reb}r ${p.ast}a ${p.tpa}3pa`).join("; ")).join("\n")); }
const sizes = (d) => { const fs2 = fs.readdirSync(path.join(ROOT, d)).map((f) => fs.statSync(path.join(ROOT, d, f)).size); return `${d}: ${fs2.length} files, avg ${(fs2.reduce((a, x) => a + x, 0) / fs2.length / 1024).toFixed(1)}k, max ${(Math.max(...fs2) / 1024).toFixed(1)}k`; };
console.log(fs.readdirSync(ROOT).filter((f) => f.endsWith(".json")).map((f) => f + " " + (fs.statSync(path.join(ROOT, f)).size / 1024 | 0) + "k").join(", "));
console.log(["players", "upcoming", "games"].map(sizes).join(" | "));
{
  const rs = R.filter((r) => r.pk.endsWith("-2"));
  console.log("total bias", (rs.reduce((s, r) => s + r.totErr, 0) / rs.length).toFixed(2));
}
