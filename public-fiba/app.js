// ODDSSMASH FIBA: games, picks, players (Scout), teams and results for FIBA competitions.
// Reads the files scripts/fiba/model.mjs writes to ./data. Same rules as the NBA side: projections come
// from game data only; no sportsbook data is read or shown.
const app = document.getElementById("app");
const S = { cache: new Map(), comp: "", kind: "", q: "", zf: "", pf: "all", tk: "nt" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const f1 = (x) => (x == null || isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
const f0 = (x) => (x == null || isNaN(x) ? "-" : String(Math.round(x)));
const pct = (p) => (p == null ? "-" : `${Math.round(p * 100)}%`);
const dec = (p) => (p > 0 ? (1 / p).toFixed(2) : "-");
const sg = (x) => `${x > 0 ? "+" : ""}${f1(x)}`;
async function load(name) { if (!S.cache.has(name)) S.cache.set(name, fetch(`data/${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); })); return S.cache.get(name); }
const TZ = "Asia/Manila";
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const dayLabel = (d) => new Date(d).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
const dayShort = (d) => new Date(d).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const timeOf = (d, timed = true) => (timed ? new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "time TBA");
const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const ZW = { rim: "rim", paint: "paint", mid: "mid-range", c3: "corner three", atb: "above the break" };

// Flags for national teams (FIBA's image server); clubs get an initials badge.
function badge(t, kind, px = 40) {
  if (kind === "nt" && t?.code) return `<img class="fl" src="https://map-resources.fiba.basketball/flags/${esc(t.code)}.png" alt="" width="${px}" height="${px}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tb',textContent:'${esc(t.code)}'}))" style="width:${px}px;height:${px}px">`;
  return `<span class="tb" style="width:${px}px;height:${px}px;font-size:${Math.round(px / 3.6)}px">${esc(t?.code || initials(t?.name))}</span>`;
}
const face = (n, px = 40) => `<span class="pf" style="width:${px}px;height:${px}px;font-size:${Math.round(px / 3)}px" aria-hidden="true">${esc(initials(n))}</span>`;

// ---------------------------------------------------------------- chrome
const NAV = [["games", "Games", "M4 5h16v14H4zM4 10h16M9 5v14"], ["picks", "Picks", "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"],
  ["players", "Players", "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.9-4.9M10.5 7.5v6M7.5 10.5h6"], ["teams", "Teams", "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"], ["more", "More", "M4 7h16M4 12h16M4 17h16"]];
const TAB = { games: "games", game: "games", picks: "picks", players: "players", player: "players", teams: "teams", team: "teams", results: "more", record: "picks", accuracy: "more", result: "more", why: "more", lab: "more", board: "picks", scout: "players", insights: "games", today: "more", more: "more", how: "more", sources: "more", news: "more" };
function drawNav(active) {
  const nav = document.getElementById("nav");
  if (!nav.childElementCount) nav.innerHTML = NAV.map(([k, l, d]) => `<a href="#/${k}" data-tab="${k}"><span class="nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span><span class="nav-l">${l}</span></a>`).join("");
  for (const a of nav.children) a.dataset.tab === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
}
document.getElementById("theme").addEventListener("click", () => { const l = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = l ? "light" : "dark"; document.getElementById("theme-color").setAttribute("content", l ? "#f4f5f6" : "#0b0c0d"); try { localStorage.setItem("theme", l ? "light" : "dark"); } catch {} });
document.getElementById("skip").addEventListener("click", () => app.focus());

// ---------------------------------------------------------------- live scores
// Published every 10 minutes by a scheduled job (FIBA's pages cannot be read from another site in the browser).
const LIVE_URL = "https://raw.githubusercontent.com/oddssmash/oddssmash.github.io/live-data/fiba-live.json";
async function liveData() { try { const r = await fetch(`${LIVE_URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" }); if (!r.ok) return null; const j = await r.json(); S.live = j; return j; } catch { return null; } }
const liveOf = (id) => S.live?.games?.find((g) => g.id === String(id)) || null;
const PhiL = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
// live win chance: current lead plus the projected margin for the time left, spread shrinking with the time left
function liveWin(pm, sd, L) { const q = /OT/.test(L.period || "") ? 4 : +(String(L.period || "Q1").replace(/\D/g, "") || 1), [mm, ss] = String(L.clock || "10:00").split(":").map(Number), left = Math.max(0, (4 - q) * 10 + (mm || 0) + (ss || 0) / 60) + (/OT/.test(L.period || "") ? 0 : 0), r = Math.max(0.005, left / 40), lead = L.a - L.b;
  return { p: PhiL((lead + pm * r) / (sd * Math.sqrt(r))), left }; }
const liveBadge = (g) => { const L = liveOf(g.id); if (!L || (!L.live && !L.final)) return ""; return `<div class="small"><span class="chip ${L.live ? "live" : ""}">${L.live ? "LIVE" : "Final"} ${esc(L.period || "")} ${L.live ? esc(L.clock || "") : ""} · ${L.a}-${L.b}</span></div>`; };
let liveTimer = null;
function startLive(redraw) { clearInterval(liveTimer); liveTimer = setInterval(async () => { if (!/^#\/(games|game)/.test(location.hash || "#/games")) return clearInterval(liveTimer); await liveData(); redraw(); }, 60000); }

// ---------------------------------------------------------------- games
async function vGames() {
  const [up, meta] = await Promise.all([load("upcoming.json"), load("meta.json"), liveData()]);
  const comps = [...new Set(up.map((g) => g.comp))];
  const list = up.filter((g) => (!S.comp || g.comp === S.comp) && (!S.kind || g.kind === S.kind));
  const days = [...new Set(list.map((g) => dayKey(g.date)))];
  app.innerHTML = `<h1>Upcoming FIBA games</h1><p class="lead">Projected score and win chance for World Cup qualifiers, continental cups and FIBA club competitions, with the main reasons on each card. Times are PH time (Manila).</p>
    <p class="small" style="color:var(--accent-ink);font-weight:600;margin-top:-8px">Built only from FIBA game data: team ratings learned from every game, player roles and shooting. No bookmaker data.</p>
    <div class="filters" role="group" aria-label="Competition type"><button class="fbtn" data-k="" aria-pressed="${!S.kind}">All</button><button class="fbtn" data-k="nt" aria-pressed="${S.kind === "nt"}">National teams</button><button class="fbtn" data-k="club" aria-pressed="${S.kind === "club"}">Clubs</button></div>
    <div class="filters" role="group" aria-label="Competition"><button class="fbtn" data-c="" aria-pressed="${!S.comp}">All competitions</button>${comps.map((c) => `<button class="fbtn" data-c="${esc(c)}" aria-pressed="${S.comp === c}">${esc(c)}</button>`).join("")}</div>
    ${days.length ? days.map((d) => { const gs = list.filter((g) => dayKey(g.date) === d); return `<h3 class="dayh">${esc(dayLabel(gs[0].date))} <span class="muted">· ${gs.length} game${gs.length > 1 ? "s" : ""}</span></h3><div class="gc-grid">${gs.map(gameCard).join("")}</div>`; }).join("") : `<p class="empty">No upcoming games for this filter in the next 45 days.</p>`}`;
  app.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { S.kind = b.dataset.k; S.comp = ""; vGames(); }));
  app.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { S.comp = b.dataset.c; vGames(); }));
  stamp(meta);
  if (up.some((g) => Math.abs(Date.parse(g.date) - Date.now()) < 3.5 * 3600000)) startLive(vGames);
}
function gameCard(g) {
  const pa = g.proj.pA, fa = pa >= 0.5;
  return `<a class="card gc fgc" href="#/game/${esc(g.id)}">
    <div class="spread small muted"><span>${esc(g.comp)}${g.round ? " · " + esc(g.round) : ""}${g.group ? " · Group " + esc(g.group) : ""}</span><span>${esc(timeOf(g.date, g.timed))}</span></div>
    <div class="gc-h">${badge(g.a, g.kind, 48)}<div class="gc-m"><b>${esc(g.a.code || g.a.name)} ${g.home === 1 ? "@" : "vs"} ${esc(g.b.code || g.b.name)}</b><span>${g.home === -1 ? "Neutral court" : `${esc(g.home === 0 ? g.a.name : g.b.name)} at home`}</span></div>${badge(g.b, g.kind, 48)}</div>
    <div class="gc-p"><div class="${fa ? "fav" : ""}"><small>${esc(g.a.name)}</small><strong>${pct(pa)}</strong></div><div class="${!fa ? "fav" : ""}"><small>${esc(g.b.name)}</small><strong>${pct(1 - pa)}</strong></div></div>
    <div class="gc-bar"><span style="flex:${pa};background:${fa ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - pa};background:${!fa ? "var(--accent)" : "var(--line-2)"}"></span></div>
    <div class="fg-row"><span><small>Proj</small><b>${f0(g.proj.a)}-${f0(g.proj.b)}</b></span><span><small>Our spread</small><b>${esc(g.proj.spread > 0 ? `${g.a.code} −${f1(g.proj.spread)}` : g.proj.spread < 0 ? `${g.b.code} −${f1(-g.proj.spread)}` : "Pick")}</b></span><span><small>Our total</small><b>${f1(g.proj.total)}</b></span></div>
    ${liveBadge(g)}<div class="small"><span class="chip">Confidence: ${esc(g.confidence)}</span> <span class="muted">Records: ${g.a.w}-${g.a.l} / ${g.b.w}-${g.b.l} in our data</span></div></a>`;
}

// Live Monte Carlo for FIBA (10-minute quarters): 10,000 finishes from the live score and clock. Rates for the rest of the
// game: our pre-game projection blended with the pace so far. FIBA's live feed has no quarter scores, so the quarter block
// shows points in the rest of the current quarter.
function fibaMC(g, L) {
  if (!L || !L.live) return "";
  const ot = /OT/.test(L.period || ""), q = ot ? 5 : +(String(L.period || "Q1").replace(/\D/g, "") || 1), [mm, ss] = String(L.clock || "10:00").split(":").map(Number), clk = (mm || 0) + (ss || 0) / 60;
  const rem = Math.max(0.01, (q <= 4 ? (4 - q) * 10 : 0) + clk), el = Math.max(0.05, 40 - rem), A = g.a, B = g.b, pre = g.proj;
  const w = Math.min(0.4, (el / 40) * 0.5), rA = (1 - w) * pre.a / 40 + w * L.a / el, rB = (1 - w) * pre.b / 40 + w * L.b / el;
  let seed = (Number(g.id) || 11) ^ (L.a * 97 + L.b * 13 + Math.round(clk * 60) + q * 7907); const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const nrm = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const N = 10000, R = { qa: [], qb: [], ha: [], hb: [], tot: [], mar: [], aw: 0, ot: 0 };
  for (let i = 0; i < N; i++) { const pace = 1 + nrm() * 0.06 * Math.sqrt(rem / 40), seg = (m) => [Math.max(0, Math.round(rA * m * pace + nrm() * 1.6 * Math.sqrt(m))), Math.max(0, Math.round(rB * m * pace + nrm() * 1.6 * Math.sqrt(m)))];
    let a = L.a, b = L.b, [da, db] = seg(clk); a += da; b += db; R.qa.push(da); R.qb.push(db); let ha = a, hb = b;
    for (let p = q + 1; p <= 4; p++) { [da, db] = seg(10); a += da; b += db; if (p === 2) { ha = a; hb = b; } }
    let gd = 0; while (a === b && gd++ < 4) { R.ot++; [da, db] = seg(5); a += da; b += db; if (a === b) { if (rnd() < 0.5) a++; else b++; } }
    R.ha.push(ha); R.hb.push(hb); R.tot.push(a + b); R.mar.push(a - b); if (a > b) R.aw++; }
  const srt = (x) => [...x].sort((p, r) => p - r), med = (x) => srt(x)[Math.floor(x.length / 2)], qn = (x, f) => srt(x)[Math.floor(x.length * f)], over = (x, l) => x.filter((v) => v > l).length / x.length, wins = (X, Y) => X.filter((v, i) => v > Y[i]).length / X.length;
  const pa = R.aw / N, tm = med(R.tot), mm2 = med(R.mar), fav = mm2 >= 0 ? A : B, sg = mm2 >= 0 ? 1 : -1, hl = [-4, -2, 0, 2, 4].map((d) => Math.round(Math.abs(mm2) + d) - 0.5).filter((x) => x > 0);
  const blk = (t, X, Y) => `<div class="mc-blk"><span class="lbl">${t}</span><div class="mc-sc"><span>${esc(A.code)} <b>${f0(med(X))}</b></span><span class="muted">–</span><span><b>${f0(med(Y))}</b> ${esc(B.code)}</span></div><div class="small">${esc(A.code)} wins it <b>${pct(wins(X, Y))}</b> · ${esc(B.code)} <b>${pct(wins(Y, X))}</b></div></div>`;
  return `<section class="mc-neon" aria-label="Live Monte Carlo simulation"><div class="mc-head"><b>LIVE SIMULATION</b><span class="small">10,000 finishes from ${esc(A.code)} ${L.a} – ${L.b} ${esc(B.code)}, ${esc(L.period || "")} ${esc(L.clock || "")}</span></div>
    <div class="mc-win"><span class="lbl">WINNER</span><div class="spread"><b class="num">${esc(A.code)} ${pct(pa)}</b><b class="num">${pct(1 - pa)} ${esc(B.code)}</b></div><div class="mc-bar"><span style="width:${(pa * 100).toFixed(1)}%;background:#1fb6ff"></span><span style="width:${((1 - pa) * 100).toFixed(1)}%;background:#ff6b5e"></span></div>${R.ot ? `<span class="small muted">Overtime in ${pct(R.ot / N)} of runs</span>` : ""}</div>
    <div class="mc-grid">${blk(ot ? "Rest of overtime" : `Rest of Q${q}`, R.qa, R.qb)}${q <= 2 ? blk("Half-time score", R.ha, R.hb) : ""}
      <div class="mc-blk"><span class="lbl">TOTAL POINTS</span><div class="mc-sc"><b class="num">${f0(tm)}</b><span class="small muted">80% of runs: ${f0(qn(R.tot, 0.1))}–${f0(qn(R.tot, 0.9))}</span></div><table class="ft mc-t"><tbody>${[-6, -3, 0, 3, 6].map((d) => Math.round(tm + d) + 0.5).map((x) => `<tr><td>Over ${x}</td><td class="n"><b>${pct(over(R.tot, x))}</b></td><td>Under</td><td class="n">${pct(1 - over(R.tot, x))}</td></tr>`).join("")}</tbody></table></div>
      <div class="mc-blk"><span class="lbl">HANDICAP</span><div class="mc-sc"><b class="num">${esc(fav.code)} by ${f0(Math.abs(mm2))}</b><span class="small muted">median final margin</span></div><table class="ft mc-t"><tbody>${hl.map((x) => { const p = over(R.mar.map((m) => sg * m), x); return `<tr><td>${esc(fav.code)} -${x}</td><td class="n"><b>${pct(p)}</b></td><td>${esc((fav === A ? B : A).code)} +${x}</td><td class="n">${pct(1 - p)}</td></tr>`; }).join("")}</tbody></table></div></div>
    <p class="small muted">From the live score (updates about every 10 minutes) and our projection. Statistical simulation, not betting advice; no sportsbook data is used.</p></section>`;
}
// ---------------------------------------------------------------- one game
async function vGame(id) {
  const [g] = await Promise.all([load(`games/${id}.json`), liveData()]);
  const L = liveOf(id), LW = L && L.live ? liveWin(g.proj.a - g.proj.b, g.proj.sd, L) : null;
  if (Math.abs(Date.parse(g.date) - Date.now()) < 3.5 * 3600000) startLive(() => vGame(id));
  const A = g.a, B = g.b, p = g.proj, fa = p.pA >= 0.5, fav = fa ? A : B;
  const side = (s) => g.players.filter((x) => x.side === s);
  const ptable = (s, t) => `<div class="card"><h2>${badge(t, g.kind, 24)} ${esc(t.name)}</h2><div class="tw"><table class="ft"><thead><tr><th>Player</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Range</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">3PM</th><th class="n">Line (his avg)</th></tr></thead><tbody>
    ${side(s).map((x) => `<tr><td>${x.isNew ? `${esc(x.n)} <span class="ztag cold" title="${esc(x.src)}">NEW</span>` : `<a href="#/player/${esc(x.pid)}">${esc(x.n)}</a>`} <span class="muted small">${esc(x.pos)}</span>${x.src && !x.isNew ? `<span class="small muted" style="display:block">${esc(x.src)}</span>` : ""}</td><td class="n">${f0(x.min)}</td><td class="n"><b>${f1(x.pts)}</b></td><td class="n muted">${f0(x.lo)}-${f0(x.hi)}</td><td class="n">${f1(x.reb)}</td><td class="n">${f1(x.ast)}</td><td class="n">${f1(x.f3m)}</td><td class="n">${x.line == null ? `<span class="muted small">${x.min < 10 ? "under 10 min" : "-"}</span>` : `${f1(x.line)} <span class="${x.pOver >= 0.5 ? "up" : "down"}">${x.pOver >= 0.5 ? "O" : "U"} ${pct(Math.max(x.pOver, 1 - x.pOver))}</span>${x.flagged ? ` <span class="ztag cold" title="Projection is over 30% from his average with no minutes change: kept out of picks">CHECK</span>` : ""}`}</td></tr>${x.lineWhy && x.line != null ? `<tr class="sub"><td colspan="8" class="small muted">Why ${f1(x.pts)} vs his ${f1(x.avgPts)} average: ${esc(x.lineWhy)}</td></tr>` : ""}`).join("")}</tbody></table></div>
    <p class="small muted">${g.announced?.[s] ? `Roster: ${esc(g.rosterSource?.[s] || "official roster posted by FIBA")}. Players marked NEW have no FIBA games in our data yet, so they start from what players at their position usually produce, in a bench role, until they play.` : `Roster and roles from ${esc(t.name)}'s last game in our data${g.rosterFrom[s] ? ` (${esc(dayShort(g.rosterFrom[s]))})` : ""}; this switches to the official 12 as soon as FIBA posts them (usually a day or two before tip-off).`} The line is set at his average (shown for 10+ projected minutes); O/U is the side our projection favours and how often it happened in 10,000 simulated games. When the projection differs from his average, the reason is under his row; CHECK marks a big gap with no minutes change, kept out of the picks.</p></div>`;
  app.innerHTML = `<a class="back" href="#/games">‹ Games</a>
    <p class="small muted" style="margin:0">${esc(g.compName)}${g.round ? " · " + esc(g.round) : ""}${g.group ? " · Group " + esc(g.group) : ""} · ${esc(dayLabel(g.date))}, ${esc(timeOf(g.date, g.timed))} PH${g.venue ? " · " + esc(g.venue) : ""}${g.city ? ", " + esc(g.city) : ""}</p>
    ${fibaMC(g, L)}${L && (L.live || L.final) ? `<div class="card livec"><h2>${L.live ? "LIVE" : "Final"} · ${esc(L.period || "")} ${L.live ? esc(L.clock || "") : ""}</h2><div class="gp-h"><span>${badge(A, g.kind, 40)}<b>${L.a}</b></span><span class="muted small">${L.live ? "Score now" : "Final score"}</span><span><b>${L.b}</b>${badge(B, g.kind, 40)}</span></div>${LW ? `<p>Live win chance: <b>${esc(A.name)} ${pct(LW.p)}</b> · ${esc(B.name)} ${pct(1 - LW.p)} <span class="small muted">(about ${Math.round(LW.left)} minutes left; from the score, the time left and our pre-game margin of ${f1(p.a - p.b)})</span></p>` : ""}<p class="small muted">Scores update about every 10 minutes (FIBA's pages can only be read by a scheduled job, not live from your phone). Live sportsbook odds are not available for FIBA competitions from any source we can read, so none are shown.</p></div>` : ""}
    <h1>${esc(fav.name)} by ${f1(Math.abs(p.a - p.b))}</h1>
    <div class="card"><div class="gp-h"><span>${badge(A, g.kind, 56)}<b>${f0(p.a)}</b></span><span class="muted small">Projected score</span><span><b>${f0(p.b)}</b>${badge(B, g.kind, 56)}</span></div>
      <div class="spread"><span class="${fa ? "" : "muted"}">${esc(A.name)} ${pct(p.pA)}</span><span class="${!fa ? "" : "muted"}">${esc(B.name)} ${pct(1 - p.pA)}</span></div>
      <div class="gc-bar"><span style="flex:${p.pA};background:${fa ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - p.pA};background:${!fa ? "var(--accent)" : "var(--line-2)"}"></span></div>
      <div class="small"><span class="chip">Close game (5 or less) ${pct(p.close)}</span> <span class="chip">Blowout (20+) ${pct(p.blowout)}</span> <span class="chip">Overtime ${pct(p.ot)}</span> <span class="chip">Confidence: ${esc(g.confidence)}</span></div>
      <p class="small muted" style="margin-top:8px">Likely range (8 in 10 simulated games): ${esc(A.code)} ${f0(p.lo[0])}-${f0(p.hi[0])}, ${esc(B.code)} ${f0(p.lo[1])}-${f0(p.hi[1])}. Pace ${f1(p.pace)} possessions.</p></div>
    <div class="card"><h2>Why</h2><ul class="dots">${g.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      <p class="small muted">Ratings (points per 100 possessions vs average, adjusted for opponents): ${esc(A.code)} offence ${sg(A.off)}, defence ${sg(A.def)} · ${esc(B.code)} offence ${sg(B.off)}, defence ${sg(B.def)}.</p></div>
    <div class="card"><h2>Our lines</h2><table class="ft"><tbody>
      <tr><td>Winner</td><td><b>${esc(fav.name)} ${pct(Math.max(p.pA, 1 - p.pA))}</b></td><td class="muted">fair odds ${dec(Math.max(p.pA, 1 - p.pA))}</td></tr>
      <tr><td>Spread</td><td><b>${esc(p.spread >= 0 ? A.code : B.code)} −${f1(Math.abs(p.spread))}</b></td><td class="muted">${esc(A.code)} covers ${pct(p.coverA)}</td></tr>
      <tr><td>Total</td><td><b>${f1(p.total)}</b></td><td class="muted">over ${pct(p.over)}</td></tr></tbody></table>
      <p class="small muted">From 10,000 simulated games. No sportsbook line is used or shown for FIBA.</p></div>
    <div class="card"><h2>By quarter</h2><table class="ft"><thead><tr><th></th><th class="n">Q1</th><th class="n">Q2</th><th class="n">Q3</th><th class="n">Q4</th></tr></thead><tbody>
      <tr><td>${esc(A.code)}</td>${g.quarters.map((x) => `<td class="n">${f1(x[0])}</td>`).join("")}</tr><tr><td>${esc(B.code)}</td>${g.quarters.map((x) => `<td class="n">${f1(x[1])}</td>`).join("")}</tr></tbody></table></div>
    ${haCard(g.ha, [A, B], g.home)}
    <h2 style="margin-top:18px">Player projections</h2>${ptable(0, A)}${ptable(1, B)}
    <div id="g-news"></div>`;
  newsCard(document.getElementById("g-news"), (x) => x.teams.includes(A.tid) || x.teams.includes(B.tid), `News and talk: ${A.name} and ${B.name}`);
}

// Home / away / neutral records, so home court can be checked against each team's own results.
function haCard(ha, teams, home) {
  if (!ha) return "";
  const rec = (r) => `${r[0]}-${r[1]}`;
  return `<div class="card"><h2>Home and away</h2><table class="ft"><thead><tr><th></th><th class="n">Home</th><th class="n">Away</th><th class="n">Neutral</th></tr></thead><tbody>${teams.map((t, i) => `<tr><td>${esc(t.name)}${home === i ? ` <span class="chip">home tonight</span>` : ""}</td><td class="n">${rec(ha[i].home)}</td><td class="n">${rec(ha[i].away)}</td><td class="n">${rec(ha[i].neutral)}</td></tr>`).join("")}</tbody></table>
    <p class="small muted">${home === -1 ? "Neutral court: no home edge is applied." : "Home edge learned from every FIBA game, separately for national teams and clubs (see Results)."} Home-and-away rounds give the first-named team home court; at tournaments only a host nation is at home.</p></div>`;
}
// Headlines about these teams and players (Google News, Reddit, FIBA YouTube). Never used in the projections.
async function newsCard(el, keep, title) {
  if (!el) return; const N = await load("news.json").catch(() => null); if (!N) return;
  const rows = N.items.filter(keep).slice(0, 12); if (!rows.length) return;
  const ago = (d) => { const h = (Date.now() - Date.parse(d)) / 3600000; return h < 24 ? `${Math.max(1, Math.round(h))}h ago` : `${Math.round(h / 24)}d ago`; };
  el.innerHTML = `<div class="card"><h2>${esc(title)}</h2><ul class="plain news">${rows.map((x) => `<li>${x.roster ? `<span class="ztag hot">ROSTER</span> ` : ""}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> <span class="small muted">${esc(x.outlet)} · ${esc(ago(x.date))}</span></li>`).join("")}</ul>
    <p class="small muted">${esc(N.note)} ROSTER marks headlines about call-ups, injuries, withdrawals or line-ups: check them against the roster above.</p></div>`;
}

// ---------------------------------------------------------------- picks
// ---- Picks track record: frozen before tip-off, graded after the final, every miss with a reason; live score while in play
async function vRecord() {
  const log = await load("picks-log.json").catch(() => null); await liveData().catch(() => null);
  if (!log?.picks?.length) { app.innerHTML = `<a class="back" href="#/picks">‹ Picks</a><h1>Track record</h1><div class="card"><p class="small">The track record starts with the next update: every pick is saved at the last run before its game starts, then graded after the final.</p></div>`; return; }
  const now = Date.now(), K = { winner: "Winners", total: "Totals", prop: "Player points" };
  const row = (p, tag, txt) => `<li class="pl-r ${tag === "hit" ? "ok" : tag === "miss" ? "no" : tag === "live" ? "pace" : ""}"><span class="pl-t">${tag && tag !== "pending" ? `<b>${tag.toUpperCase()}</b>` : ""}</span><span class="pl-m"><span class="t1">${esc(p.pick)}</span><span class="t2">${esc(p.game)} · ${esc(p.comp)} · we said ${pct(p.p)}${txt ? ` · ${txt}` : ""}</span></span></li>`;
  const live = log.picks.filter((p) => p.status === "pending" && Date.parse(p.date) <= now && Date.parse(p.date) > now - 6 * 3600000);
  const upcoming = log.picks.filter((p) => p.status === "pending" && Date.parse(p.date) > now).slice(0, 80);
  const done = log.picks.filter((p) => ["hit", "miss", "void"].includes(p.status)), byDay = {}; for (const p of done) (byDay[dayKey(p.date)] ||= []).push(p);
  const rec = (arr) => { const g = arr.filter((p) => p.status !== "void"), h = g.filter((p) => p.status === "hit").length; return g.length ? `${h}/${g.length} hit (${pct(h / g.length)})` : "-"; };
  app.innerHTML = `<a class="back" href="#/picks">‹ Picks</a><h1>Track record</h1>
    <div class="card"><h2>Last 30 days</h2><p style="font-size:26px;font-weight:700;margin:4px 0 10px">${log.record.n ? `${log.record.hit}/${log.record.n} <span class="small muted">hit (${pct(log.record.hit / log.record.n)})</span>` : `<span class="small">First grades come in after the next finished games.</span>`}</p>
      ${Object.keys(log.byKind || {}).length ? `<div class="statgrid">${Object.entries(log.byKind).map(([k, v]) => `<div class="stat"><b>${pct(v.hit / v.n)}</b><span>${esc(K[k] || k)} · ${v.hit}/${v.n}</span></div>`).join("")}</div>` : ""}<p class="small muted">${esc(log.note)}</p></div>
    ${live.length ? `<div class="card"><h2>In play</h2><ul class="plain pl-list">${live.map((p) => { const L = liveOf(p.gid); return row(p, L?.live ? "live" : "", L ? `${L.live ? "LIVE" : L.final ? "final" : ""} ${esc(L.period || "")} · ${L.a}-${L.b}` : "waiting for the score"); }).join("")}</ul><p class="small muted">Live scores update about every 10 minutes. Player numbers are graded after the final.</p></div>` : ""}
    ${upcoming.length ? `<details class="card"><summary><b>Not started yet</b> <span class="small muted">· ${upcoming.length} picks; each is frozen at the last update before its tip-off</span></summary><ul class="plain pl-list">${upcoming.map((p) => row(p, "pending", esc(dayShort(p.date)))).join("")}</ul></details>` : ""}
    ${Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).map(([d, arr], i) => `<details class="card"${i === 0 ? " open" : ""}><summary><b>${esc(dayLabel(arr[0].date))}</b> <span class="small muted">· ${rec(arr)}</span></summary><ul class="plain pl-list">${arr.sort((a, b) => (a.status === "miss") - (b.status === "miss") || b.p - a.p).map((p) => row(p, p.status, `${p.actual != null ? `final ${esc(p.actual)}` : esc(p.why || "")}${p.status === "miss" && p.why ? ` · <b>Why we missed:</b> ${esc(p.why)}` : ""}`)).join("")}</ul></details>`).join("")}`;
}
async function vPicks() {
  const { picks, note } = await load("picks.json");
  const now = Date.now(), kinds = { all: "All", winner: "Winners", total: "Totals", prop: "Player points" };
  const list = picks.filter((p) => Date.parse(p.date) > now - 3600000 && (S.pf === "all" || p.kind === S.pf) && p.p >= 0.6);
  const days = [...new Set(list.map((p) => dayKey(p.date)))].sort();
  app.innerHTML = `<h1>Picks</h1><p class="lead">Our own lines for every upcoming FIBA game, sorted by how often they came true in 10,000 simulated games. Only picks at 60% or better are listed.</p>
    <p><a class="go" href="#/record">Track record: every pick, hit or missed, and why ›</a></p><div class="callout small"><b>Nothing here is 100%.</b> ${esc(note)} The chance is ours; "fair odds" is what that chance is worth in decimal odds.</div>
    <div class="filters" role="group" aria-label="Pick type">${Object.entries(kinds).map(([k, l]) => `<button class="fbtn" data-pf="${k}" aria-pressed="${S.pf === k}">${l}</button>`).join("")}</div>
    ${days.map((d) => { const ps = list.filter((p) => dayKey(p.date) === d).slice(0, 40); return `<h3 class="dayh">${esc(dayLabel(ps[0].date))}</h3><div class="tgrid">${ps.map((p) => `<a class="titem" href="#/game/${esc(p.gid)}"><span class="pk-p ${p.p >= 0.75 ? "hi" : ""}">${pct(p.p)}</span><span><span class="t1">${esc(p.pick)}</span><span class="t2">${esc(p.game)} · ${esc(p.comp)}${p.why ? " · " + esc(p.why) : ""}</span></span><span class="t3">fair ${dec(p.p)}</span></a>`).join("")}</div>`; }).join("") || `<p class="empty">No picks at 60% or better right now.</p>`}`;
  app.querySelectorAll("[data-pf]").forEach((b) => b.addEventListener("click", () => { S.pf = b.dataset.pf; vPicks(); }));
}

// ---------------------------------------------------------------- players (Scout)
async function vPlayers() {
  const [all, meta] = await Promise.all([load("players.json"), load("meta.json")]);
  app.innerHTML = `<h1>Players</h1><p class="lead">Every player in our FIBA data: averages, hot and cold zones from his shot locations, and his projection for the next game on his team page or game page.</p>
    <input class="field" id="q" type="search" placeholder="Search by player or team" aria-label="Search players" autocomplete="off" value="${esc(S.q)}">
    <div class="filters" role="group" aria-label="Team type" style="margin-top:8px"><button class="fbtn" data-k="" aria-pressed="${!S.kind}">All</button><button class="fbtn" data-k="nt" aria-pressed="${S.kind === "nt"}">National teams</button><button class="fbtn" data-k="club" aria-pressed="${S.kind === "club"}">Clubs</button></div>
    <select class="field" id="af" aria-label="Filter by archetype" style="margin-bottom:8px"><option value="">Any archetype</option>${[...new Set(all.flatMap((p) => p.arch || []))].filter((a) => a !== "Not enough games yet").sort().map((a) => `<option${S.af === a ? " selected" : ""}>${esc(a)}</option>`).join("")}</select>
    <select class="field" id="zf" aria-label="Filter by hot or cold zone"><option value="">Any zone profile</option><optgroup label="Hot zone">${meta.zones.map((z) => `<option value="hot:${z.id}"${S.zf === "hot:" + z.id ? " selected" : ""}>Hot: ${esc(z.label)}</option>`).join("")}</optgroup><optgroup label="Cold zone">${meta.zones.map((z) => `<option value="cold:${z.id}"${S.zf === "cold:" + z.id ? " selected" : ""}>Cold: ${esc(z.label)}</option>`).join("")}</optgroup></select>
    <p class="small muted" id="pcount" style="margin:10px 0 8px"></p><div class="tgrid" id="plist"></div>
    <p class="small muted" style="margin-top:12px">HOT and COLD: at least 15 shots in the zone, 4+ points of FG% away from the FIBA average there, and far enough from it to be more than chance.</p>`;
  const draw = () => {
    const q = S.q.trim().toLowerCase(), [zk, zid] = S.zf ? S.zf.split(":") : [];
    let f = all.filter((p) => (!S.kind || p.kind === S.kind) && (!q || p.n.toLowerCase().includes(q) || (p.teamName || "").toLowerCase().includes(q)) && (!zk || (p[zk] || []).includes(zid)) && (!S.af || (p.arch || []).includes(S.af)));
    const rows = f.slice(0, 60);
    document.getElementById("pcount").textContent = f.length > rows.length ? `Showing the top ${rows.length} of ${f.length.toLocaleString()} players by points per game. Search to narrow it down.` : `${f.length} players`;
    document.getElementById("plist").innerHTML = rows.map((p) => `<a class="titem" href="#/player/${esc(p.pid)}">${face(p.n, 44)}<span><span class="t1">${esc(p.n)}</span><span class="t2">${esc(p.teamName || "")} · ${esc(p.pos || "")} · ${p.gp} games${p.arch?.length ? " · " + esc(p.arch.join(", ")) : ""}</span>
      <span class="t2 spots">${p.hot.length ? `<span class="ztag hot">HOT</span> ${esc(p.hot.map((z) => ZW[z]).join(", "))} ` : ""}${p.cold.length ? `<span class="ztag cold">COLD</span> ${esc(p.cold.map((z) => ZW[z]).join(", "))}` : ""}${!p.hot.length && !p.cold.length ? "No hot or cold zone on record" : ""}</span></span>
      <span class="t3"><b>${f1(p.pts)}</b> pts<br><span class="muted small">${f1(p.reb)} reb · ${f1(p.ast)} ast</span></span></a>`).join("") || `<p class="empty">No player matches.</p>`;
  };
  document.getElementById("q").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
  document.getElementById("zf").addEventListener("change", (e) => { S.zf = e.target.value; draw(); });
  document.getElementById("af").addEventListener("change", (e) => { S.af = e.target.value; draw(); });
  app.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { S.kind = b.dataset.k; app.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
}
// Half court drawn in FIBA's shot coordinates (x 0-280 across 15 m, y 0-262 from the baseline); basket at the bottom.
function court(shots, zones) {
  const H = 262, Y = (y) => H - y, line = "var(--axis)";
  const dots = shots.map(([x, y, m]) => `<circle cx="${x}" cy="${Y(y)}" r="3.2" fill="${m ? "var(--accent)" : "none"}" stroke="${m ? "var(--accent)" : "var(--muted)"}" stroke-width="1.2" opacity="${m ? 0.85 : 0.55}"/>`).join("");
  return `<svg class="court" viewBox="-6 -6 292 274" role="img" aria-label="Shot chart: ${shots.length} shots, filled dots are makes">
    <rect x="0" y="0" width="280" height="${H}" fill="none" stroke="${line}"/>
    <rect x="94.3" y="${Y(108.3)}" width="91.4" height="108.3" fill="none" stroke="${line}"/>
    <circle cx="140" cy="${Y(108.3)}" r="33.6" fill="none" stroke="${line}"/>
    <path d="M16.8 ${H} V${Y(55.8)} A126 126 0 0 1 263.2 ${Y(55.8)} V${H}" fill="none" stroke="${line}"/>
    <path d="M116.7 ${Y(29.4)} A23.3 23.3 0 0 1 163.3 ${Y(29.4)}" fill="none" stroke="${line}"/>
    <circle cx="140" cy="${Y(29.4)}" r="4.3" fill="none" stroke="var(--ink-2)"/><line x1="122.6" y1="${Y(22.4)}" x2="157.4" y2="${Y(22.4)}" stroke="var(--ink-2)" stroke-width="2"/>
    ${dots}</svg>`;
}
function zoneTable(z) {
  return `<table class="ft"><thead><tr><th>Zone</th><th class="n">Shots</th><th class="n">FG%</th><th class="n">FIBA avg</th><th class="n">Share</th><th></th></tr></thead><tbody>${z.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${x.att}</td><td class="n">${x.pct == null ? "-" : f1(x.pct) + "%"}</td><td class="n muted">${f1(x.lgPct)}%</td><td class="n muted">${f1(x.share)}%</td><td>${x.tag !== "neutral" ? `<span class="ztag ${x.tag}">${x.tag.toUpperCase()}</span>` : ""}</td></tr>`).join("")}</tbody></table>`;
}
async function vPlayer(pid) {
  const p = await load(`players/${pid}.json`);
  const hot = p.zones.filter((z) => z.tag === "hot"), cold = p.zones.filter((z) => z.tag === "cold");
  app.innerHTML = `<a class="back" href="#/players">‹ Players</a>
    <div class="ehead">${face(p.n, 64)}<div><h1 style="margin:0">${esc(p.n)}</h1>${p.arch?.length ? `<p class="small" style="margin:2px 0">${p.arch.map((a) => `<span class="chip">${esc(a)}</span>`).join(" ")}</p>` : ""}<p class="small muted" style="margin:0">${esc(p.pos || "")}${p.no ? " · #" + esc(p.no) : ""} · ${p.teams.map((t) => `<a href="#/team/${esc(t.tid)}">${esc(t.name)}</a> (${t.gp})`).join(", ")}</p></div></div>
    <div class="statgrid sg4" style="margin:12px 0"><div class="stat"><b>${f1(p.pts)}</b><span>Points</span></div><div class="stat"><b>${f1(p.reb)}</b><span>Rebounds</span></div><div class="stat"><b>${f1(p.ast)}</b><span>Assists</span></div><div class="stat"><b>${f1(p.min)}</b><span>Minutes</span></div></div>
    <div class="card" id="vs"></div>
    <div class="card"><h2>Shooting</h2><p>FG ${p.shooting.fg ?? "-"}% on ${f1(p.shooting.fga)} a game · three ${p.shooting.three ?? "-"}% on ${f1(p.shooting.f3a)} · free throws ${p.shooting.ft ?? "-"}% on ${f1(p.shooting.fta)}.</p>
      <p class="small">${hot.length ? `<b class="up">Strengths:</b> ${hot.map((z) => `${esc(z.label.toLowerCase())} ${f1(z.pct)}% (FIBA ${f1(z.lgPct)}%)`).join("; ")}. ` : ""}${cold.length ? `<b class="down">Weaknesses:</b> ${cold.map((z) => `${esc(z.label.toLowerCase())} ${f1(z.pct)}% (FIBA ${f1(z.lgPct)}%)`).join("; ")}.` : ""}${!hot.length && !cold.length ? "No zone stands out from the FIBA average yet." : ""}</p></div>
    <div class="card"><h2>Hot and cold zones</h2><div class="court-wrap">${court(p.shots, p.zones)}</div><p class="small muted">His last ${p.shots.length} shots with a location. Filled = made.</p>${zoneTable(p.zones)}</div>
    <div class="card"><h2>Game log</h2><div class="tw"><table class="ft"><thead><tr><th>Date</th><th>Opp</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">FG</th><th class="n">3PT</th><th class="n">FT</th><th class="n">+/-</th></tr></thead><tbody>
      ${p.log.map((l) => `<tr><td>${esc(dayShort(l.date))}</td><td><a href="#/team/${esc(l.opp)}">${esc(l.opp)}</a></td><td class="n">${f0(l.min)}</td><td class="n"><b>${l.pts}</b></td><td class="n">${l.reb}</td><td class="n">${l.ast}</td><td class="n">${esc(l.fg)}</td><td class="n">${esc(l.three)}</td><td class="n">${esc(l.ft)}</td><td class="n">${sg(l.pm).replace(".0", "")}</td></tr>`).join("")}</tbody></table></div></div>`;
  // opponent ids → names
  const teams = await load("teams.json"), nm = Object.fromEntries(teams.map((t) => [t.tid, t.code || t.name]));
  app.querySelectorAll('a[href^="#/team/"]').forEach((a) => { const id = a.getAttribute("href").split("/")[2]; if (a.textContent === id && nm[id]) a.textContent = nm[id]; });
  playerVersus(p);
}

// ---------------------------------------------------------------- Versus (player and team pages)
// Projections for any matchup from our FIBA data, even with no head-to-head games: per-minute rates, pace,
// the opponent's defence per 100 possessions and by zone, and the learned home edge. Head-to-head games are listed
// beside the projection when they exist.
const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
function bindPick(input, items, label, onPick) {
  const box = document.getElementById(input.id + "-l");
  const draw = () => { const q = input.value.trim().toLowerCase(); const hits = q ? items.filter((x) => label(x).toLowerCase().includes(q)).slice(0, 8) : [];
    box.innerHTML = hits.map((x) => `<button type="button" class="vs-hit" data-i="${items.indexOf(x)}">${esc(label(x))}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const x = items[+b.dataset.i]; input.value = label(x); box.innerHTML = ""; onPick(x); })); };
  input.addEventListener("input", draw);
}
const pickBox = (id, ph) => `<div class="vs-pick"><input class="field" id="${id}" type="search" placeholder="${esc(ph)}" autocomplete="off" aria-label="${esc(ph)}"><div class="vs-list" id="${id}-l"></div></div>`;
const venueBtns = (v) => `<div class="filters" role="group" aria-label="Venue">${[["neutral", "Neutral court"], ["home", "At home"], ["away", "Away"]].map(([k, l]) => `<button class="fbtn" type="button" data-venue="${k}" aria-pressed="${v === k}">${l}</button>`).join("")}</div>`;
// his line against a team: rates x minutes, adjusted for the game's pace, their defence and the venue
function projPlayerVs(p, myT, opp, venue, meta) {
  const L = meta.lg[opp.kind] || meta.lg.nt, pace = ((myT?.pace ?? L.pace) + (opp.pace ?? L.pace)) / 2, fP = pace / L.pace, fD = (L.ppp - (opp.def || 0)) / L.ppp;
  const hca = meta.hca?.[opp.kind] ?? 0, teamPts = (L.ppp * pace) / 100, fV = venue === "home" ? 1 + hca / 2 / teamPts : venue === "away" ? 1 - hca / 2 / teamPts : 1;
  const min = p.projMin || p.min || 0, r = (k) => ((p.rates?.[k] || 0) / 36) * min;
  return { min, pts: r("pts") * fP * fD * fV, reb: r("reb") * fP, ast: r("ast") * fP, f3m: r("f3m") * fP * fD, pace, fD, fV, hca };
}
// his zones against their zone defence (both pulled toward the FIBA average on small samples)
function zonesVs(myZ, oppZdef) {
  return myZ.map((z) => { const d = oppZdef.find((x) => x.id === z.id), lg = (z.lgPct || 0) / 100, mine = ((z.made || 0) + 15 * lg) / ((z.att || 0) + 15), def = d && d.att ? (d.made + 60 * lg) / (d.att + 60) - lg : 0, proj = Math.min(0.95, Math.max(0.05, mine + def));
    return { ...z, defPct: d?.pct, proj: proj * 100, delta: (proj - lg) * 100 }; });
}
function zvTable(rows, who, them) {
  return `<table class="ft"><thead><tr><th>Zone</th><th class="n">${esc(who)}</th><th class="n">${esc(them)} allow</th><th class="n">Projected</th><th class="n">vs FIBA avg</th></tr></thead><tbody>${rows.map((z) => `<tr><td>${esc(z.label)} <span class="muted small">${f1(z.share)}% of shots</span></td><td class="n">${z.pct == null ? "-" : f1(z.pct) + "%"}</td><td class="n">${z.defPct == null ? "-" : f1(z.defPct) + "%"}</td><td class="n"><b>${f1(z.proj)}%</b></td><td class="n ${z.delta >= 3 ? "up" : z.delta <= -3 ? "down" : ""}">${sg(z.delta)}</td></tr>`).join("")}</tbody></table>`;
}
async function playerVersus(p) {
  const el = document.getElementById("vs"); if (!el) return;
  const [teams, players, meta] = await Promise.all([load("teams.json"), load("players.json"), load("meta.json")]);
  const myT = teams.find((t) => t.tid === p.team), kind = myT?.kind || p.kind, pool = teams.filter((t) => t.kind === kind && t.tid !== p.team);
  const others = players.filter((x) => x.pid !== p.pid);
  const st = { mode: "team", venue: "neutral" };
  const ctl = () => `<div class="filters" role="group" aria-label="Versus"><button class="fbtn" type="button" data-vm="team" aria-pressed="${st.mode === "team"}">vs team</button><button class="fbtn" type="button" data-vm="player" aria-pressed="${st.mode === "player"}">vs player</button></div>
    ${st.mode === "team" ? pickBox("vs-q", `Pick a ${kind === "nt" ? "national team" : "club"}, e.g. ${pool[0]?.name || ""}`) : pickBox("vs-q", "Pick a player, e.g. a rival guard or the centre he will face")}${venueBtns(st.venue)}<div id="vs-out"></div>`;
  const draw = async () => {
    const out = document.getElementById("vs-out"); if (!out) return;
    if (st.mode === "team" && st.team) {
      const o = st.team, of = await load(`teams/${o.tid}.json`), pr = projPlayerVs(p, myT, o, st.venue, meta), h2h = p.log.filter((l) => l.opp === o.tid);
      const avg = (k) => h2h.reduce((a, l) => a + l[k], 0) / h2h.length;
      out.innerHTML = `<div class="statgrid sg4" style="margin:10px 0"><div class="stat"><b>${f1(pr.pts)}</b><span>Points</span></div><div class="stat"><b>${f1(pr.reb)}</b><span>Rebounds</span></div><div class="stat"><b>${f1(pr.ast)}</b><span>Assists</span></div><div class="stat"><b>${f1(pr.f3m)}</b><span>Threes</span></div></div>
        <p class="small">${esc(p.n)} vs ${esc(o.name)} (${st.venue === "neutral" ? "neutral court" : st.venue === "home" ? "at home" : "away"}): ${f0(pr.min)} minutes, pace ${f1(pr.pace)}, ${esc(o.name)} defence ${sg(o.def)} per 100 (${pr.fD < 1 ? "tougher" : "softer"} than average)${pr.fV !== 1 ? `, home edge ${pr.fV > 1 ? "+" : "−"}${f1(pr.hca / 2)} team points` : ""}.</p>
        <h3>His zones against their defence</h3>${zvTable(zonesVs(p.zones, of.zonesDef || []), p.n.split(" ").slice(-1)[0], o.code || o.name)}
        <h3>Head-to-head</h3>${h2h.length ? `<p class="small">${h2h.length} game${h2h.length > 1 ? "s" : ""}: ${f1(avg("pts"))} pts, ${f1(avg("reb"))} reb, ${f1(avg("ast"))} ast on average.</p><ul class="plain small">${h2h.map((l) => `<li class="spread"><span>${esc(dayShort(l.date))}</span><span>${l.pts} pts · ${l.reb} reb · ${l.ast} ast · FG ${esc(l.fg)}</span></li>`).join("")}</ul>` : `<p class="small muted">No games against ${esc(o.name)} in our data: the projection above comes from his rates, the pace and their defence.</p>`}
        <p class="small muted">A quick what-if from our data only. Game pages use the full model and the posted roster.</p>`;
    } else if (st.mode === "player" && st.pl) {
      const q = await load(`players/${st.pl.pid}.json`), qT = teams.find((t) => t.tid === q.team);
      const mine = new Map(p.log.map((l) => [l.id, l])), shared = q.log.filter((l) => mine.has(l.id) && mine.get(l.id).tid !== l.tid);
      const pr = qT && qT.tid !== p.team ? projPlayerVs(p, myT, qT, st.venue, meta) : null;
      out.innerHTML = `${pr ? `<div class="statgrid sg4" style="margin:10px 0"><div class="stat"><b>${f1(pr.pts)}</b><span>Points</span></div><div class="stat"><b>${f1(pr.reb)}</b><span>Rebounds</span></div><div class="stat"><b>${f1(pr.ast)}</b><span>Assists</span></div><div class="stat"><b>${f1(pr.f3m)}</b><span>Threes</span></div></div>
        <p class="small">${esc(p.n)} projected against ${esc(q.n)}'s team, ${esc(qT.name)} (${st.venue === "neutral" ? "neutral court" : st.venue}).</p>` : `<p class="small muted">${qT?.tid === p.team ? `${esc(q.n)} is his teammate.` : "No current team on record for that player."}</p>`}
        <h3>Games against each other</h3>${shared.length ? `<table class="ft"><thead><tr><th>Date</th><th class="n">${esc(p.n.split(" ").slice(-1)[0])}</th><th class="n">${esc(q.n.split(" ").slice(-1)[0])}</th></tr></thead><tbody>${shared.map((l) => { const m = mine.get(l.id); return `<tr><td>${esc(dayShort(l.date))}</td><td class="n">${m.pts} pts · ${m.reb} reb · ${m.ast} ast</td><td class="n">${l.pts} pts · ${l.reb} reb · ${l.ast} ast</td></tr>`; }).join("")}</tbody></table>` : `<p class="small muted">They have not met in our FIBA data.</p>`}
        ${q.zones && p.zones ? `<h3>Shooting by zone side by side</h3><table class="ft"><thead><tr><th>Zone</th><th class="n">${esc(p.n.split(" ").slice(-1)[0])}</th><th class="n">${esc(q.n.split(" ").slice(-1)[0])}</th></tr></thead><tbody>${p.zones.map((z, i) => `<tr><td>${esc(z.label)}</td><td class="n">${z.pct == null ? "-" : f1(z.pct) + "%"} <span class="muted small">(${z.att})</span></td><td class="n">${q.zones[i]?.pct == null ? "-" : f1(q.zones[i].pct) + "%"} <span class="muted small">(${q.zones[i]?.att ?? 0})</span></td></tr>`).join("")}</tbody></table>` : ""}`;
    } else out.innerHTML = `<p class="small muted">${st.mode === "team" ? "Pick a team to see his projected line, his zones against their defence and any head-to-head games." : "Pick a player to see their games against each other and his projected line against that player's team."}</p>`;
  };
  const render = () => {
    el.innerHTML = `<h2>Versus</h2>${ctl()}`;
    el.querySelectorAll("[data-vm]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.vm; render(); }));
    el.querySelectorAll("[data-venue]").forEach((b) => b.addEventListener("click", () => { st.venue = b.dataset.venue; el.querySelectorAll("[data-venue]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
    const inp = document.getElementById("vs-q");
    if (st.mode === "team") { bindPick(inp, pool, (t) => t.name, (t) => { st.team = t; draw(); }); if (st.team) inp.value = st.team.name; }
    else { bindPick(inp, others, (x) => `${x.n} (${x.teamName || ""})`, (x) => { st.pl = x; draw(); }); if (st.pl) inp.value = `${st.pl.n} (${st.pl.teamName || ""})`; }
    draw();
  };
  // start against his next opponent when there is one
  const up = await load("upcoming.json").catch(() => []), nx = up.find((g) => g.a.tid === p.team || g.b.tid === p.team);
  if (nx) { const oid = nx.a.tid === p.team ? nx.b.tid : nx.a.tid; st.team = pool.find((t) => t.tid === oid) || null; st.venue = nx.home === -1 ? "neutral" : (nx.home === 0) === (nx.a.tid === p.team) ? "home" : "away"; }
  render();
}
async function teamVersus(t) {
  const el = document.getElementById("vs"); if (!el) return;
  const [teams, meta] = await Promise.all([load("teams.json"), load("meta.json")]);
  const me = teams.find((x) => x.tid === t.tid) || t, pool = teams.filter((x) => x.kind === t.kind && x.tid !== t.tid), st = { venue: "neutral", opp: null };
  const draw = async () => {
    const out = document.getElementById("vs-out"); if (!st.opp) { out.innerHTML = `<p class="small muted">Pick a team for a projected score, win chance, zone matchup and head-to-head record.</p>`; return; }
    const o = st.opp, of = await load(`teams/${o.tid}.json`), L = meta.lg[t.kind], pace = L.pace + ((me.pace - L.pace) + (o.pace - L.pace)) / 2, hca = st.venue === "home" ? meta.hca[t.kind] : st.venue === "away" ? -meta.hca[t.kind] : 0;
    const pa = (pace * (L.ppp + me.off - o.def)) / 100 + hca / 2, pb = (pace * (L.ppp + o.off - me.def)) / 100 - hca / 2, pW = Phi((pa - pb) / (meta.sd || 10)), h2h = t.games.filter((g) => g.oppTid === o.tid);
    out.innerHTML = `<div class="gp-h" style="margin-top:10px"><span>${badge(t, t.kind, 40)}<b>${f0(pa)}</b></span><span class="muted small">Projected</span><span><b>${f0(pb)}</b>${badge(o, o.kind, 40)}</span></div>
      <div class="spread"><span>${esc(t.name)} ${pct(pW)}</span><span>${esc(o.name)} ${pct(1 - pW)}</span></div>
      <div class="gc-bar"><span style="flex:${pW};background:${pW >= 0.5 ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - pW};background:${pW < 0.5 ? "var(--accent)" : "var(--line-2)"}"></span></div>
      <p class="small muted">${st.venue === "neutral" ? "Neutral court." : `${esc(st.venue === "home" ? t.name : o.name)} at home: ${meta.hca[t.kind] >= 0.25 ? `+${f1(meta.hca[t.kind])} pts` : "no measurable edge so far"}, learned from ${t.kind === "nt" ? "national-team" : "club"} results.`} From both teams' offence, defence and pace per 100 possessions (adjusted for opponents). A simpler estimate than a game page, which also uses rosters.</p>
      <div class="grid two"><div><h3>${esc(t.code || t.name)} offence vs ${esc(o.code || o.name)} defence</h3>${zvTable(zonesVs(t.zonesOff || [], of.zonesDef || []), t.code || "Off", o.code || "Def")}</div><div><h3>${esc(o.code || o.name)} offence vs ${esc(t.code || t.name)} defence</h3>${zvTable(zonesVs(of.zonesOff || [], t.zonesDef || []), o.code || "Off", t.code || "Def")}</div></div>
      <h3>Head-to-head</h3>${h2h.length ? `<p class="small">${h2h.filter((g) => g.us > g.them).length}-${h2h.filter((g) => g.us < g.them).length} in our data.</p><ul class="plain small">${h2h.map((g) => `<li class="spread"><span>${esc(dayShort(g.date))} · ${esc(g.comp)}</span><span>${g.us > g.them ? '<b class="up">W</b>' : '<b class="down">L</b>'} ${g.us}-${g.them}</span></li>`).join("")}</ul>` : `<p class="small muted">They have not met in our data.</p>`}`;
  };
  el.innerHTML = `<h2>Versus</h2>${pickBox("vs-q", `Pick a ${t.kind === "nt" ? "national team" : "club"}`)}${venueBtns(st.venue)}<div id="vs-out"></div>`;
  el.querySelectorAll("[data-venue]").forEach((b) => b.addEventListener("click", () => { st.venue = b.dataset.venue; el.querySelectorAll("[data-venue]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  const up = await load("upcoming.json").catch(() => []), nx = up.find((g) => g.a.tid === t.tid || g.b.tid === t.tid);
  if (nx) { const oid = nx.a.tid === t.tid ? nx.b.tid : nx.a.tid; st.opp = pool.find((x) => x.tid === oid) || null; st.venue = nx.home === -1 ? "neutral" : (nx.home === 0) === (nx.a.tid === t.tid) ? "home" : "away"; el.querySelectorAll("[data-venue]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.venue === st.venue))); }
  const inp = document.getElementById("vs-q"); bindPick(inp, pool, (x) => x.name, (x) => { st.opp = x; draw(); }); if (st.opp) inp.value = st.opp.name;
  draw();
}

// ---------------------------------------------------------------- teams
async function vTeams() {
  const teams = await load("teams.json");
  // Ratings only connect teams that play each other: national teams are ranked within their region (qualifiers are
  // regional), clubs within their competition. One combined list would compare teams that never meet.
  const groups = [...new Set(teams.filter((t) => t.kind === S.tk).map((t) => t.region))].sort();
  if (!groups.includes(S.rg)) S.rg = groups.includes("Asia") ? "Asia" : groups[0];
  const list = teams.filter((t) => t.kind === S.tk && t.region === S.rg);
  app.innerHTML = `<h1>Teams</h1><p class="lead">Ranked by net rating: points scored minus points allowed per 100 possessions, adjusted for who they played, fading between windows and pulled toward average on thin records (the ratings the projections use). Teams are ranked within a region or competition: qualifiers are played inside each region, so ratings from different regions are not comparable.</p>
    <div class="gtabs" role="tablist"><button class="gtab" role="tab" data-tk="nt" aria-selected="${S.tk === "nt"}">National teams</button><button class="gtab" role="tab" data-tk="club" aria-selected="${S.tk === "club"}">Clubs</button></div>
    <div class="filters" role="group" aria-label="${S.tk === "nt" ? "Region" : "Competition"}">${groups.map((r) => `<button class="fbtn" type="button" data-rg="${esc(r)}" aria-pressed="${S.rg === r}">${esc(r)}</button>`).join("")}</div>
    <div class="card"><div class="tw"><table class="ft"><thead><tr><th>#</th><th>Team</th><th class="n">W-L</th><th class="n">Off</th><th class="n">Def</th><th class="n">Net</th></tr></thead><tbody>
      ${list.map((t, i) => `<tr><td class="muted">${i + 1}</td><td><a class="tn" href="#/team/${esc(t.tid)}">${badge(t, t.kind, 24)} ${esc(t.name)}</a> <span class="muted small">${esc(t.comp)}</span></td><td class="n">${t.w}-${t.l}</td><td class="n">${sg(t.off)}</td><td class="n">${sg(t.def)}</td><td class="n"><b class="${t.net >= 0 ? "up" : "down"}">${sg(t.net)}</b></td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Off and Def are points per 100 possessions better than average (Def: fewer points allowed is positive). Teams with few games move a lot.</p></div>`;
  app.querySelectorAll("[data-tk]").forEach((b) => b.addEventListener("click", () => { S.tk = b.dataset.tk; S.rg = null; vTeams(); }));
  app.querySelectorAll("[data-rg]").forEach((b) => b.addEventListener("click", () => { S.rg = b.dataset.rg; vTeams(); }));
}
async function vTeam(tid) {
  const [t, up] = await Promise.all([load(`teams/${tid}.json`), load("upcoming.json")]);
  const nx = up.filter((g) => t.next.includes(g.id));
  app.innerHTML = `<a class="back" href="#/teams">‹ Teams</a>
    <div class="ehead">${badge(t, t.kind, 64)}<div><h1 style="margin:0">${esc(t.name)}</h1><p class="small muted" style="margin:0">${esc(t.comp)} · ${t.w}-${t.l} in our data · ${f1(t.ppg)} scored, ${f1(t.oppg)} allowed a game</p></div></div>
    <div class="statgrid sg4" style="margin:12px 0"><div class="stat"><b>${sg(t.net)}</b><span>Net rating</span></div><div class="stat"><b>${sg(t.off)}</b><span>Offence</span></div><div class="stat"><b>${sg(t.def)}</b><span>Defence</span></div><div class="stat"><b>${f1(t.pace)}</b><span>Pace</span></div></div>
    ${nx.length ? `<h2>Next games</h2><div class="gc-grid">${nx.map(gameCard).join("")}</div>` : ""}
    ${t.ha ? `<p class="small">Home ${t.ha.home[0]}-${t.ha.home[1]} · away ${t.ha.away[0]}-${t.ha.away[1]} · neutral ${t.ha.neutral[0]}-${t.ha.neutral[1]}</p>` : ""}
    <div id="t-news"></div>
    <div class="card" id="vs"></div>
    <div class="card"><h2>Roster (last game, ${esc(t.rosterFrom ? dayShort(t.rosterFrom) : "-")})</h2><div class="tw"><table class="ft"><thead><tr><th>Player</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">GP</th></tr></thead><tbody>
      ${t.roster.map((p) => `<tr><td><a href="#/player/${esc(p.pid)}">${esc(p.n)}</a> <span class="muted small">${esc(p.pos)}</span></td><td class="n">${f0(p.min)}</td><td class="n">${f1(p.pts)}</td><td class="n">${f1(p.reb)}</td><td class="n">${f1(p.ast)}</td><td class="n">${p.gp}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Per-game numbers are his projected role: recent minutes times his per-minute rates.</p></div>
    <div class="card"><h2>Shooting zones</h2><div class="grid two"><div><h3>Offence</h3>${zoneTable(t.zonesOff)}</div><div><h3>Defence (what opponents shoot)</h3>${zoneTable(t.zonesDef.map((z) => ({ ...z, tag: z.tag === "hot" ? "cold" : z.tag === "cold" ? "hot" : z.tag })))}</div></div><p class="small muted">On defence, HOT means opponents shoot worse than average there (a strong spot), COLD means they shoot better (a soft spot).</p></div>
    <div class="card"><h2>Results</h2><ul class="plain">${t.games.slice(0, 30).map((g) => `<li class="spread"><span>${esc(dayShort(g.date))} · ${g.us > g.them ? '<b class="up">W</b>' : '<b class="down">L</b>'} vs <a href="#/team/${esc(g.oppTid)}">${esc(g.opp)}</a> <span class="muted small">${esc(g.comp)}</span></span><span class="num">${g.us}-${g.them}</span></li>`).join("")}</ul></div>`;
  teamVersus(t);
  newsCard(document.getElementById("t-news"), (x) => x.teams.includes(t.tid), `News and talk: ${t.name}`);
}

// ---------------------------------------------------------------- results + accuracy
async function vResults() {
  const [res, acc] = await Promise.all([load("results.json"), load("accuracy.json")]);
  const ptc = await pretipCard();
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Results and accuracy</h1><p class="lead">Every FIBA game in our data, projected only from games before it and then graded. The settings behind that replay are re-chosen from all history each run, which flatters it a little; the saved-before-tip-off record below is the clean test.</p>${ptc}<h2>The replay</h2>
    <div class="statgrid sg4"><div class="stat"><b>${pct(acc.winner)}</b><span>Winners right</span></div><div class="stat"><b>${acc.brier}</b><span>Brier (lower is better)</span></div><div class="stat"><b>${f1(acc.marginMAE)}</b><span>Margin miss (pts)</span></div><div class="stat"><b>${f1(acc.playerPtsMAE)}</b><span>Player pts miss</span></div></div>
    <p class="small muted">${acc.graded} graded games. ${esc(acc.rule)} Player points: ${acc.playerGraded.toLocaleString()} graded player-games.</p>
    <div class="card"><h2>Calibration</h2><table class="ft"><thead><tr><th>We said</th><th class="n">Games</th><th class="n">Favourite won</th></tr></thead><tbody>${acc.calibration.map((b) => `<tr><td>${b.lo}-${b.hi}%</td><td class="n">${b.n}</td><td class="n">${b.rate == null ? "-" : pct(b.rate)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h2>By competition</h2><table class="ft"><thead><tr><th>Competition</th><th class="n">Games</th><th class="n">Winners</th><th class="n">Margin miss</th></tr></thead><tbody>${acc.byComp.map((c) => `<tr><td>${esc(c.comp)}${c.low ? ` <span class="chip warn">low confidence: only ${c.n} graded</span>` : ""}</td><td class="n">${c.n}</td><td class="n">${pct(c.winner)}</td><td class="n">${f1(c.marginMAE)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h2>What the model learned</h2><p class="small">Update speed ${acc.learned.k}, home court ${acc.learned.hca?.nt ?? acc.learned.hca} pts for national teams and ${acc.learned.hca?.club ?? acc.learned.hca} for clubs, ratings fade halfway in ${acc.learned.hl} days, result spread ${acc.learned.sd} pts.</p><p class="small muted">${esc(acc.learned.note)} ${acc.grid} combinations tried.</p></div>
    <h2>Latest results</h2><div class="tgrid">${res.slice(0, 80).map((r) => { const won = r.a.score > r.b.score; return `<div class="titem rs"><span class="rs-c ${r.graded ? (r.right ? "ok" : "no") : ""}" aria-label="${r.graded ? (r.right ? "Called it" : "Missed") : "Not graded (thin record)"}">${r.graded ? (r.right ? "✓" : "✗") : "·"}</span>
      <span><span class="t1">${won ? "<b>" : ""}${esc(r.a.name)} ${r.a.score}${won ? "</b>" : ""} - ${!won ? "<b>" : ""}${r.b.score} ${esc(r.b.name)}${!won ? "</b>" : ""}</span><span class="t2">${esc(dayShort(r.date))} · ${esc(r.comp)} · we said ${f0(r.proj.a)}-${f0(r.proj.b)}, ${esc(r.proj.pA >= 0.5 ? r.a.code : r.b.code)} ${pct(Math.max(r.proj.pA, 1 - r.proj.pA))}</span>${r.why ? `<span class="t2 why">${r.right === false ? "<b>Why we missed:</b> " : ""}${esc(r.why)}</span>` : ""}</span><span></span></div>`; }).join("")}</div>`;
}

// ---------------------------------------------------------------- More, how it works, sources, news
async function vMore() {
  const meta = await load("meta.json");
  const item = (href, ic, t, d) => `<a class="card menu-i" href="${href}"><span class="menu-ic" aria-hidden="true">${ic}</span><span><b>${t}</b><span class="small muted" style="display:block">${d}</span></span><span class="menu-c" aria-hidden="true">›</span></a>`;
  app.innerHTML = `<h1>More</h1>
    <h3>Track record</h3>${item("#/results", "📋", "Results and accuracy", `Every graded game, the saved-before-tip-off record, calibration and accuracy by competition (${meta.games.toLocaleString()} games).`)}
    <h3>News</h3>${item("#/news", "📰", "News and talk", "Headlines about the teams and players in upcoming games, with roster news marked.")}
    <h3>About</h3>${item("#/how", "⚙️", "How it works", "How projections, simulations, lines and the learning work for FIBA.")}${item("#/sources", "🔗", "Data sources", "Where every number comes from, and what is not read.")}
    ${item("../nba/", "🏀", "Switch to NBA", "The NBA section of ODDSSMASH.")}`;
}
function vMissing() { app.innerHTML = `<div class="card"><h2>This page does not exist in the FIBA section</h2><p class="muted">The link may be from the NBA side or out of date.</p><p><a class="go" href="#/games">FIBA games ›</a> <a class="go" href="#/more">More ›</a></p></div>`; }
async function vHow() {
  const [acc, meta] = await Promise.all([load("accuracy.json"), load("meta.json")]);
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>How it works</h1>
    <div class="card"><h2>Team ratings</h2><p>Every FIBA game in our data is replayed in date order. Each team has an offence, defence and pace rating (points per 100 possessions against average, adjusted for who they played). Before each game the model projects it from what was known then; after the final the ratings move toward what happened. Ratings fade back toward average between windows. National teams and clubs are rated separately.</p>
      <p>Thin records are pulled toward average: a team's rating is blended with ${acc.learned.k0} games' worth of an average team, so a side with 5 games is only partly trusted. Confidence is capped at medium until both teams have 10 games, and at low in a competition with fewer than 20 graded games.</p></div>
    <div class="card"><h2>After-game learning</h2><p>The update speed, home edge (separately for national teams and clubs), fade between windows, the pull toward average and the spread of results are chosen by replaying all history and keeping the settings with the best Brier score (${acc.grid} combinations). Because that replay can be flattered by re-learning, the last projection before each tip-off is also saved and never recomputed: see the saved-before-tip-off record on the Results page.</p></div>
    <div class="card"><h2>Players and rosters</h2><p>Each player has per-minute rates learned game by game, one record across national team and club games, so a player's club form carries to his national team. Minutes come from his recent role and are scaled so a team adds up to 200. Rosters: the 12 FIBA posts for the game first, then an announced lineup (for example a federation's 12-man list), then the team's last game. A player new to our data starts from what players at his position produce, in a bench role, until he plays.</p></div>
    <div class="card"><h2>Simulations and lines</h2><p>Each game is simulated 10,000 times. Our spread and total sit at the projection; player lines sit at his average and are shown for 10+ projected minutes. Picks list the sides our simulations favour at 60% or better. No sportsbook data is used or shown.</p></div>
    <div class="card"><h2>Zones and archetypes</h2><p>Shot locations from FIBA's play-by-play are sorted into rim, paint, mid-range, corner three and above-the-break three. HOT/COLD needs 15+ shots and a gap from the FIBA average that is bigger than chance. Archetypes (Primary scorer, Floor general, Sharpshooter, Stretch big, Slasher, Rim runner, Glass cleaner, Rim protector, Ball hawk and more) come from his per-36 rates ranked against FIBA players with 5+ games, and where he shoots.</p></div>`;
}
async function vSources() {
  const N = await load("news.json").catch(() => null);
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Data sources</h1>
    <div class="card"><h2>Game data</h2><ul class="dots"><li><b>fiba.basketball</b> event and game pages: schedules, box scores (minutes and all counting stats), play-by-play with shot locations, and the rosters FIBA posts before games (checked every refresh for the next 21 days).</li><li><b>Announced lineups</b> not yet on FIBA's pages (for example a federation's 12-man list), entered by the site owner with the source named on the game page.</li><li><b>Flags</b> from FIBA's image server.</li></ul></div>
    <div class="card"><h2>News and talk</h2><ul class="dots"><li>Google News searches for every team playing in the next 10 days, plus competition-wide searches.</li><li>Reddit searches (r/basketball, r/PBA and site-wide FIBA searches).</li><li>FIBA's YouTube channel.</li></ul><p class="small muted">Headlines never change a projection; roster headlines are marked so they can be checked against the posted roster.${N ? ` Last checked ${esc(new Date(N.fetched).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} PH.` : ""}</p></div>
    <div class="card"><h2>Not read</h2><p>Facebook pages, Instagram and X need a login, so they cannot be read automatically. Score sites such as AiScore do not allow automated reading. Sportsbook odds are not used for FIBA.</p></div>
    <div class="card"><h2>Competitions</h2><ul class="dots">${(await load("meta.json")).comps.map((c) => `<li>${esc(c.name)} <span class="muted small">(${c.kind === "nt" ? "national teams" : "clubs"}, ${c.games} games in our data)</span></li>`).join("")}</ul><p class="small muted">The European Basketball Champions League runs on its own site and is not covered yet.</p></div>`;
}
async function vNews() {
  const N = await load("news.json"), teams = await load("teams.json"), nm = Object.fromEntries(teams.map((t) => [t.tid, t.name]));
  const f = S.newsRoster ? N.items.filter((x) => x.roster) : N.items;
  const ago = (d) => { const h = (Date.now() - Date.parse(d)) / 3600000; return h < 24 ? `${Math.max(1, Math.round(h))}h ago` : `${Math.round(h / 24)}d ago`; };
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>News and talk</h1><p class="lead">${esc(N.note)}</p>
    <div class="filters" role="group" aria-label="Filter"><button class="fbtn" data-nr="" aria-pressed="${!S.newsRoster}">All</button><button class="fbtn" data-nr="1" aria-pressed="${!!S.newsRoster}">Roster news</button></div>
    <div class="card"><ul class="plain news">${f.slice(0, 120).map((x) => `<li>${x.roster ? `<span class="ztag hot">ROSTER</span> ` : ""}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a> <span class="small muted">${esc(x.outlet)} · ${esc(ago(x.date))}${x.teams.length ? " · " + x.teams.map((t) => esc(nm[t] || t)).join(", ") : ""}</span></li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ul></div>`;
  app.querySelectorAll("[data-nr]").forEach((b) => b.addEventListener("click", () => { S.newsRoster = !!b.dataset.nr; vNews(); }));
}
// the frozen record: projections saved before tip-off, graded after
async function pretipCard() {
  const PT = await load("pretip.json").catch(() => null); if (!PT) return "";
  const n = PT.graded;
  return `<div class="card"><h2>The honest test: projections saved before tip-off</h2><p class="small muted">Each game's last projection before tip-off is frozen with the settings used and graded after the final. Nothing here is recomputed later, so it cannot be flattered by re-learning. The record started on ${esc(dayShort(PT.started))}.</p>
    ${n ? `<div class="statgrid sg4"><div class="stat"><b>${pct(PT.winner)}</b><span>Winners${n < 30 ? " (early sample)" : ""}</span></div><div class="stat"><b>${PT.brier}</b><span>Brier</span></div><div class="stat"><b>${f1(PT.marginMAE)}</b><span>Margin miss</span></div><div class="stat"><b>${n}</b><span>graded · ${PT.waiting} waiting</span></div></div>${n < 30 ? `<p class="small muted">Only ${n} games so far: an early record moves a lot.</p>` : ""}` : `<p class="small">No saved game has finished yet: ${PT.waiting} projections are saved and waiting for their finals.</p>`}</div>`;
}

// ---------------------------------------------------------------- router + back links
function stamp(meta) { const el = document.getElementById("updated"); if (el && meta) el.textContent = `Data refreshed ${new Date(meta.built).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} PH time · ${meta.games.toLocaleString()} games graded · ${meta.players.toLocaleString()} players tracked.`; }
async function route() {
  const seq = (S.seq = (S.seq || 0) + 1), h = location.hash || "#/games", st = (S.stack ||= []);
  if (st.length > 1 && st[st.length - 2] === h) st.pop(); else if (st[st.length - 1] !== h) st.push(h);
  const [, view = "games", arg] = h.split("/");
  drawNav(TAB[view] || "games");
  try { await ({ games: vGames, game: vGame, picks: vPicks, record: vRecord, players: vPlayers, player: vPlayer, teams: vTeams, team: vTeam, results: vResults, accuracy: vResults, result: vResults, why: vResults, lab: vMore, board: vPicks, scout: vPlayers, insights: vGames, today: vNews, more: vMore, how: vHow, sources: vSources, news: vNews }[view] || vMissing)(decodeURIComponent(arg || "")); }
  catch (e) { if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">${esc(e.message)}</p><p><a class="go" href="#/games">Back to games</a></p></div>`; }
  if (st.length > 1) app.querySelectorAll("a.back").forEach((a) => (a.textContent = "‹ Back"));
  if (S.last !== h) window.scrollTo(0, 0);
  S.last = h;
  if (!document.getElementById("updated").textContent) load("meta.json").then(stamp).catch(() => {});
}
document.addEventListener("click", (e) => { const a = e.target.closest?.("a.back"); if (a && (S.stack?.length || 0) > 1) { e.preventDefault(); history.back(); } });
addEventListener("hashchange", route);
route();
