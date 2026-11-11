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
  ["players", "Players", "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.9-4.9M10.5 7.5v6M7.5 10.5h6"], ["teams", "Teams", "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"], ["results", "Results", "M5 12l4 4L19 6"]];
const TAB = { games: "games", game: "games", picks: "picks", players: "players", player: "players", teams: "teams", team: "teams", results: "results", accuracy: "results" };
function drawNav(active) {
  const nav = document.getElementById("nav");
  if (!nav.childElementCount) nav.innerHTML = NAV.map(([k, l, d]) => `<a href="#/${k}" data-tab="${k}"><span class="nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span><span class="nav-l">${l}</span></a>`).join("");
  for (const a of nav.children) a.dataset.tab === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
}
document.getElementById("theme").addEventListener("click", () => { const l = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = l ? "light" : "dark"; document.getElementById("theme-color").setAttribute("content", l ? "#f4f5f6" : "#0b0c0d"); try { localStorage.setItem("theme", l ? "light" : "dark"); } catch {} });
document.getElementById("skip").addEventListener("click", () => app.focus());

// ---------------------------------------------------------------- games
async function vGames() {
  const [up, meta] = await Promise.all([load("upcoming.json"), load("meta.json")]);
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
}
function gameCard(g) {
  const pa = g.proj.pA, fa = pa >= 0.5;
  return `<a class="card gc fgc" href="#/game/${esc(g.id)}">
    <div class="spread small muted"><span>${esc(g.comp)}${g.round ? " · " + esc(g.round) : ""}${g.group ? " · Group " + esc(g.group) : ""}</span><span>${esc(timeOf(g.date, g.timed))}</span></div>
    <div class="gc-h">${badge(g.a, g.kind, 48)}<div class="gc-m"><b>${esc(g.a.code || g.a.name)} ${g.home === 1 ? "@" : "vs"} ${esc(g.b.code || g.b.name)}</b><span>${g.home === -1 ? "Neutral court" : `${esc(g.home === 0 ? g.a.name : g.b.name)} at home`}</span></div>${badge(g.b, g.kind, 48)}</div>
    <div class="gc-p"><div class="${fa ? "fav" : ""}"><small>${esc(g.a.name)}</small><strong>${pct(pa)}</strong></div><div class="${!fa ? "fav" : ""}"><small>${esc(g.b.name)}</small><strong>${pct(1 - pa)}</strong></div></div>
    <div class="gc-bar"><span style="flex:${pa};background:${fa ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - pa};background:${!fa ? "var(--accent)" : "var(--line-2)"}"></span></div>
    <div class="fg-row"><span><small>Proj</small><b>${f0(g.proj.a)}-${f0(g.proj.b)}</b></span><span><small>Our spread</small><b>${esc(g.proj.spread > 0 ? `${g.a.code} −${f1(g.proj.spread)}` : g.proj.spread < 0 ? `${g.b.code} −${f1(-g.proj.spread)}` : "Pick")}</b></span><span><small>Our total</small><b>${f1(g.proj.total)}</b></span></div>
    <div class="small"><span class="chip">Confidence: ${esc(g.confidence)}</span> <span class="muted">Records: ${g.a.w}-${g.a.l} / ${g.b.w}-${g.b.l} in our data</span></div></a>`;
}

// ---------------------------------------------------------------- one game
async function vGame(id) {
  const g = await load(`games/${id}.json`);
  const A = g.a, B = g.b, p = g.proj, fa = p.pA >= 0.5, fav = fa ? A : B;
  const side = (s) => g.players.filter((x) => x.side === s);
  const ptable = (s, t) => `<div class="card"><h2>${badge(t, g.kind, 24)} ${esc(t.name)}</h2><div class="tw"><table class="ft"><thead><tr><th>Player</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Range</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">3PM</th><th class="n">Our line</th></tr></thead><tbody>
    ${side(s).map((x) => `<tr><td><a href="#/player/${esc(x.pid)}">${esc(x.n)}</a> <span class="muted small">${esc(x.pos)}</span></td><td class="n">${f0(x.min)}</td><td class="n"><b>${f1(x.pts)}</b></td><td class="n muted">${f0(x.lo)}-${f0(x.hi)}</td><td class="n">${f1(x.reb)}</td><td class="n">${f1(x.ast)}</td><td class="n">${f1(x.f3m)}</td><td class="n">${f1(x.line)} <span class="${x.pOver >= 0.5 ? "up" : "down"}">${x.pOver >= 0.5 ? "O" : "U"} ${pct(Math.max(x.pOver, 1 - x.pOver))}</span></td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">Roster and roles from ${esc(t.name)}'s last game in our data${g.rosterFrom[s] ? ` (${esc(dayShort(g.rosterFrom[s]))})` : ""}. "Our line" is set at his average; O/U is the side our projection favours and how often it happened in 10,000 simulated games.</p></div>`;
  app.innerHTML = `<a class="back" href="#/games">‹ Games</a>
    <p class="small muted" style="margin:0">${esc(g.compName)}${g.round ? " · " + esc(g.round) : ""}${g.group ? " · Group " + esc(g.group) : ""} · ${esc(dayLabel(g.date))}, ${esc(timeOf(g.date, g.timed))} PH${g.venue ? " · " + esc(g.venue) : ""}${g.city ? ", " + esc(g.city) : ""}</p>
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
    <h2 style="margin-top:18px">Player projections</h2>${ptable(0, A)}${ptable(1, B)}`;
}

// ---------------------------------------------------------------- picks
async function vPicks() {
  const { picks, note } = await load("picks.json");
  const now = Date.now(), kinds = { all: "All", winner: "Winners", total: "Totals", prop: "Player points" };
  const list = picks.filter((p) => Date.parse(p.date) > now - 3600000 && (S.pf === "all" || p.kind === S.pf) && p.p >= 0.6);
  const days = [...new Set(list.map((p) => dayKey(p.date)))].sort();
  app.innerHTML = `<h1>Picks</h1><p class="lead">Our own lines for every upcoming FIBA game, sorted by how often they came true in 10,000 simulated games. Only picks at 60% or better are listed.</p>
    <div class="callout small"><b>Nothing here is 100%.</b> ${esc(note)} The chance is ours; "fair odds" is what that chance is worth in decimal odds.</div>
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
    <select class="field" id="zf" aria-label="Filter by hot or cold zone"><option value="">Any zone profile</option><optgroup label="Hot zone">${meta.zones.map((z) => `<option value="hot:${z.id}"${S.zf === "hot:" + z.id ? " selected" : ""}>Hot: ${esc(z.label)}</option>`).join("")}</optgroup><optgroup label="Cold zone">${meta.zones.map((z) => `<option value="cold:${z.id}"${S.zf === "cold:" + z.id ? " selected" : ""}>Cold: ${esc(z.label)}</option>`).join("")}</optgroup></select>
    <p class="small muted" id="pcount" style="margin:10px 0 8px"></p><div class="tgrid" id="plist"></div>
    <p class="small muted" style="margin-top:12px">HOT and COLD: at least 15 shots in the zone, 4+ points of FG% away from the FIBA average there, and far enough from it to be more than chance.</p>`;
  const draw = () => {
    const q = S.q.trim().toLowerCase(), [zk, zid] = S.zf ? S.zf.split(":") : [];
    let f = all.filter((p) => (!S.kind || p.kind === S.kind) && (!q || p.n.toLowerCase().includes(q) || (p.teamName || "").toLowerCase().includes(q)) && (!zk || (p[zk] || []).includes(zid)));
    const rows = f.slice(0, 60);
    document.getElementById("pcount").textContent = f.length > rows.length ? `Showing the top ${rows.length} of ${f.length.toLocaleString()} players by points per game. Search to narrow it down.` : `${f.length} players`;
    document.getElementById("plist").innerHTML = rows.map((p) => `<a class="titem" href="#/player/${esc(p.pid)}">${face(p.n, 44)}<span><span class="t1">${esc(p.n)}</span><span class="t2">${esc(p.teamName || "")} · ${esc(p.pos || "")} · ${p.gp} games</span>
      <span class="t2 spots">${p.hot.length ? `<span class="ztag hot">HOT</span> ${esc(p.hot.map((z) => ZW[z]).join(", "))} ` : ""}${p.cold.length ? `<span class="ztag cold">COLD</span> ${esc(p.cold.map((z) => ZW[z]).join(", "))}` : ""}${!p.hot.length && !p.cold.length ? "No hot or cold zone on record" : ""}</span></span>
      <span class="t3"><b>${f1(p.pts)}</b> pts<br><span class="muted small">${f1(p.reb)} reb · ${f1(p.ast)} ast</span></span></a>`).join("") || `<p class="empty">No player matches.</p>`;
  };
  document.getElementById("q").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
  document.getElementById("zf").addEventListener("change", (e) => { S.zf = e.target.value; draw(); });
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
    <div class="ehead">${face(p.n, 64)}<div><h1 style="margin:0">${esc(p.n)}</h1><p class="small muted" style="margin:0">${esc(p.pos || "")}${p.no ? " · #" + esc(p.no) : ""} · ${p.teams.map((t) => `<a href="#/team/${esc(t.tid)}">${esc(t.name)}</a> (${t.gp})`).join(", ")}</p></div></div>
    <div class="statgrid sg4" style="margin:12px 0"><div class="stat"><b>${f1(p.pts)}</b><span>Points</span></div><div class="stat"><b>${f1(p.reb)}</b><span>Rebounds</span></div><div class="stat"><b>${f1(p.ast)}</b><span>Assists</span></div><div class="stat"><b>${f1(p.min)}</b><span>Minutes</span></div></div>
    <div class="card"><h2>Shooting</h2><p>FG ${p.shooting.fg ?? "-"}% on ${f1(p.shooting.fga)} a game · three ${p.shooting.three ?? "-"}% on ${f1(p.shooting.f3a)} · free throws ${p.shooting.ft ?? "-"}% on ${f1(p.shooting.fta)}.</p>
      <p class="small">${hot.length ? `<b class="up">Strengths:</b> ${hot.map((z) => `${esc(z.label.toLowerCase())} ${f1(z.pct)}% (FIBA ${f1(z.lgPct)}%)`).join("; ")}. ` : ""}${cold.length ? `<b class="down">Weaknesses:</b> ${cold.map((z) => `${esc(z.label.toLowerCase())} ${f1(z.pct)}% (FIBA ${f1(z.lgPct)}%)`).join("; ")}.` : ""}${!hot.length && !cold.length ? "No zone stands out from the FIBA average yet." : ""}</p></div>
    <div class="card"><h2>Hot and cold zones</h2><div class="court-wrap">${court(p.shots, p.zones)}</div><p class="small muted">His last ${p.shots.length} shots with a location. Filled = made.</p>${zoneTable(p.zones)}</div>
    <div class="card"><h2>Game log</h2><div class="tw"><table class="ft"><thead><tr><th>Date</th><th>Opp</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">FG</th><th class="n">3PT</th><th class="n">FT</th><th class="n">+/-</th></tr></thead><tbody>
      ${p.log.map((l) => `<tr><td>${esc(dayShort(l.date))}</td><td><a href="#/team/${esc(l.opp)}">${esc(l.opp)}</a></td><td class="n">${f0(l.min)}</td><td class="n"><b>${l.pts}</b></td><td class="n">${l.reb}</td><td class="n">${l.ast}</td><td class="n">${esc(l.fg)}</td><td class="n">${esc(l.three)}</td><td class="n">${esc(l.ft)}</td><td class="n">${sg(l.pm).replace(".0", "")}</td></tr>`).join("")}</tbody></table></div></div>`;
  // opponent ids → names
  const teams = await load("teams.json"), nm = Object.fromEntries(teams.map((t) => [t.tid, t.code || t.name]));
  app.querySelectorAll('a[href^="#/team/"]').forEach((a) => { const id = a.getAttribute("href").split("/")[2]; if (a.textContent === id && nm[id]) a.textContent = nm[id]; });
}

// ---------------------------------------------------------------- teams
async function vTeams() {
  const teams = await load("teams.json");
  const list = teams.filter((t) => t.kind === S.tk);
  app.innerHTML = `<h1>Teams</h1><p class="lead">Ranked by net rating: points scored minus points allowed per 100 possessions, adjusted for who they played and fading between windows. National teams and clubs are rated separately.</p>
    <div class="gtabs" role="tablist"><button class="gtab" role="tab" data-tk="nt" aria-selected="${S.tk === "nt"}">National teams</button><button class="gtab" role="tab" data-tk="club" aria-selected="${S.tk === "club"}">Clubs</button></div>
    <div class="card"><div class="tw"><table class="ft"><thead><tr><th>#</th><th>Team</th><th class="n">W-L</th><th class="n">Off</th><th class="n">Def</th><th class="n">Net</th></tr></thead><tbody>
      ${list.map((t, i) => `<tr><td class="muted">${i + 1}</td><td><a class="tn" href="#/team/${esc(t.tid)}">${badge(t, t.kind, 24)} ${esc(t.name)}</a> <span class="muted small">${esc(t.comp)}</span></td><td class="n">${t.w}-${t.l}</td><td class="n">${sg(t.off)}</td><td class="n">${sg(t.def)}</td><td class="n"><b class="${t.net >= 0 ? "up" : "down"}">${sg(t.net)}</b></td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Off and Def are points per 100 possessions better than average (Def: fewer points allowed is positive). Teams with few games move a lot.</p></div>`;
  app.querySelectorAll("[data-tk]").forEach((b) => b.addEventListener("click", () => { S.tk = b.dataset.tk; vTeams(); }));
}
async function vTeam(tid) {
  const [t, up] = await Promise.all([load(`teams/${tid}.json`), load("upcoming.json")]);
  const nx = up.filter((g) => t.next.includes(g.id));
  app.innerHTML = `<a class="back" href="#/teams">‹ Teams</a>
    <div class="ehead">${badge(t, t.kind, 64)}<div><h1 style="margin:0">${esc(t.name)}</h1><p class="small muted" style="margin:0">${esc(t.comp)} · ${t.w}-${t.l} in our data · ${f1(t.ppg)} scored, ${f1(t.oppg)} allowed a game</p></div></div>
    <div class="statgrid sg4" style="margin:12px 0"><div class="stat"><b>${sg(t.net)}</b><span>Net rating</span></div><div class="stat"><b>${sg(t.off)}</b><span>Offence</span></div><div class="stat"><b>${sg(t.def)}</b><span>Defence</span></div><div class="stat"><b>${f1(t.pace)}</b><span>Pace</span></div></div>
    ${nx.length ? `<h2>Next games</h2><div class="gc-grid">${nx.map(gameCard).join("")}</div>` : ""}
    <div class="card"><h2>Roster (last game, ${esc(t.rosterFrom ? dayShort(t.rosterFrom) : "-")})</h2><div class="tw"><table class="ft"><thead><tr><th>Player</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">GP</th></tr></thead><tbody>
      ${t.roster.map((p) => `<tr><td><a href="#/player/${esc(p.pid)}">${esc(p.n)}</a> <span class="muted small">${esc(p.pos)}</span></td><td class="n">${f0(p.min)}</td><td class="n">${f1(p.pts)}</td><td class="n">${f1(p.reb)}</td><td class="n">${f1(p.ast)}</td><td class="n">${p.gp}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Per-game numbers are his projected role: recent minutes times his per-minute rates.</p></div>
    <div class="card"><h2>Shooting zones</h2><div class="grid two"><div><h3>Offence</h3>${zoneTable(t.zonesOff)}</div><div><h3>Defence (what opponents shoot)</h3>${zoneTable(t.zonesDef.map((z) => ({ ...z, tag: z.tag === "hot" ? "cold" : z.tag === "cold" ? "hot" : z.tag })))}</div></div><p class="small muted">On defence, HOT means opponents shoot worse than average there (a strong spot), COLD means they shoot better (a soft spot).</p></div>
    <div class="card"><h2>Results</h2><ul class="plain">${t.games.slice(0, 30).map((g) => `<li class="spread"><span>${esc(dayShort(g.date))} · ${g.us > g.them ? '<b class="up">W</b>' : '<b class="down">L</b>'} vs <a href="#/team/${esc(g.oppTid)}">${esc(g.opp)}</a> <span class="muted small">${esc(g.comp)}</span></span><span class="num">${g.us}-${g.them}</span></li>`).join("")}</ul></div>`;
}

// ---------------------------------------------------------------- results + accuracy
async function vResults() {
  const [res, acc] = await Promise.all([load("results.json"), load("accuracy.json")]);
  app.innerHTML = `<h1>Results and accuracy</h1><p class="lead">Every FIBA game in our data, projected only from games before it and then graded. This is how the model learns: after each game the ratings and player rates update, and the learning settings are re-chosen by replaying all history.</p>
    <div class="statgrid sg4"><div class="stat"><b>${pct(acc.winner)}</b><span>Winners right</span></div><div class="stat"><b>${acc.brier}</b><span>Brier (lower is better)</span></div><div class="stat"><b>${f1(acc.marginMAE)}</b><span>Margin miss (pts)</span></div><div class="stat"><b>${f1(acc.playerPtsMAE)}</b><span>Player pts miss</span></div></div>
    <p class="small muted">${acc.graded} graded games. ${esc(acc.rule)} Player points: ${acc.playerGraded.toLocaleString()} graded player-games.</p>
    <div class="card"><h2>Calibration</h2><table class="ft"><thead><tr><th>We said</th><th class="n">Games</th><th class="n">Favourite won</th></tr></thead><tbody>${acc.calibration.map((b) => `<tr><td>${b.lo}-${b.hi}%</td><td class="n">${b.n}</td><td class="n">${b.rate == null ? "-" : pct(b.rate)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h2>By competition</h2><table class="ft"><thead><tr><th>Competition</th><th class="n">Games</th><th class="n">Winners</th><th class="n">Margin miss</th></tr></thead><tbody>${acc.byComp.map((c) => `<tr><td>${esc(c.comp)}</td><td class="n">${c.n}</td><td class="n">${pct(c.winner)}</td><td class="n">${f1(c.marginMAE)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h2>What the model learned</h2><p class="small">Update speed ${acc.learned.k}, home court ${acc.learned.hca} pts, ratings fade halfway in ${acc.learned.hl} days, result spread ${acc.learned.sd} pts.</p><p class="small muted">${esc(acc.learned.note)} ${acc.grid} combinations tried.</p></div>
    <h2>Latest results</h2><div class="tgrid">${res.slice(0, 80).map((r) => { const won = r.a.score > r.b.score; return `<div class="titem rs"><span class="rs-c ${r.graded ? (r.right ? "ok" : "no") : ""}" aria-label="${r.graded ? (r.right ? "Called it" : "Missed") : "Not graded (thin record)"}">${r.graded ? (r.right ? "✓" : "✗") : "·"}</span>
      <span><span class="t1">${won ? "<b>" : ""}${esc(r.a.name)} ${r.a.score}${won ? "</b>" : ""} - ${!won ? "<b>" : ""}${r.b.score} ${esc(r.b.name)}${!won ? "</b>" : ""}</span><span class="t2">${esc(dayShort(r.date))} · ${esc(r.comp)} · we said ${f0(r.proj.a)}-${f0(r.proj.b)}, ${esc(r.proj.pA >= 0.5 ? r.a.code : r.b.code)} ${pct(Math.max(r.proj.pA, 1 - r.proj.pA))}</span>${r.why ? `<span class="t2 why">${esc(r.why)}</span>` : ""}</span><span></span></div>`; }).join("")}</div>`;
}

// ---------------------------------------------------------------- router + back links
function stamp(meta) { const el = document.getElementById("updated"); if (el && meta) el.textContent = `Data refreshed ${new Date(meta.built).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} PH time · ${meta.games.toLocaleString()} games graded · ${meta.players.toLocaleString()} players tracked.`; }
async function route() {
  const seq = (S.seq = (S.seq || 0) + 1), h = location.hash || "#/games", st = (S.stack ||= []);
  if (st.length > 1 && st[st.length - 2] === h) st.pop(); else if (st[st.length - 1] !== h) st.push(h);
  const [, view = "games", arg] = h.split("/");
  drawNav(TAB[view] || "games");
  try { await ({ games: vGames, game: vGame, picks: vPicks, players: vPlayers, player: vPlayer, teams: vTeams, team: vTeam, results: vResults }[view] || vGames)(decodeURIComponent(arg || "")); }
  catch (e) { if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">${esc(e.message)}</p><p><a class="go" href="#/games">Back to games</a></p></div>`; }
  if (st.length > 1) app.querySelectorAll("a.back").forEach((a) => (a.textContent = "‹ Back"));
  if (S.last !== h) window.scrollTo(0, 0);
  S.last = h;
  if (!document.getElementById("updated").textContent) load("meta.json").then(stamp).catch(() => {});
}
document.addEventListener("click", (e) => { const a = e.target.closest?.("a.back"); if (a && (S.stack?.length || 0) > 1) { e.preventDefault(); history.back(); } });
addEventListener("hashchange", route);
route();
