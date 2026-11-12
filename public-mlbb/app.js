// ODDSSMASH MLBB: matches, picks, heroes (meta, combos, counters), teams and players, Versus and the Draft lab.
// Reads the files scripts/mlbb/model.mjs writes to ./data. Same rules as the NBA and FIBA sides: our projections
// come from match data only; no sportsbook data is read or shown.
const app = document.getElementById("app");
const S = { cache: new Map(), rg: "PH", role: "", q: "", hq: "", hrole: "" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (p) => (p == null || isNaN(p) ? "-" : `${Math.round(p * 100)}%`);
const f1 = (x) => (x == null || isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
const dec = (p) => (p > 0 ? (1 / p).toFixed(2) : "-");
const cap = (h) => String(h || "").replace(/\b\w/g, (c) => c.toUpperCase());
const sid = (t) => String(t).replace(/[^A-Za-z0-9]+/g, "_");
async function load(name) { if (!S.cache.has(name)) S.cache.set(name, fetch(`data/${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); })); return S.cache.get(name); }
const TZ = "Asia/Manila";
const when = (d) => (d ? new Date(d).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "date TBA");
const dshort = (d) => (d ? new Date(d).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "-");
// PICTURES (Liquipedia, hosted on our site): team logos with light and dark versions, hero portraits, player photos
const IMG = () => S.img || { heroes: {}, teams: {}, players: {} };
const teamLogo = (name, px) => { const t = IMG().teams[name]; return t ? `<span class="tlogo" style="width:${px}px;height:${px}px"><img class="on-dark-i" src="img/${esc(t.dark)}" alt="" loading="lazy"><img class="on-light-i" src="img/${esc(t.light)}" alt="" loading="lazy"></span>` : null; };
const heroImg = (h, px = 22) => { const u = IMG().heroes[String(h).toLowerCase()]; return u ? `<img class="himg" src="img/${esc(u)}" alt="" width="${px}" height="${px}" loading="lazy">` : ""; };
const face = (id, name, px = 40) => { const u = IMG().players[id]; return u ? `<img class="pface" src="img/${esc(u)}" alt="" style="width:${px}px;height:${px}px" loading="lazy">` : tb(name, px, true); };
const tb = (name, px = 40, plain = false) => (!plain && teamLogo(name, px)) || `<span class="tb" style="width:${px}px;height:${px}px;font-size:${Math.round(px / 3.4)}px" aria-hidden="true">${esc(String(name).replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join("").toUpperCase())}</span>`;
// a team's official short name (TLPH, RORA) where a full name would be cut off
const sn = (n) => (S.short || {})[n] || n;
const heroChip = (h) => `<a class="hchip" href="#/hero/${encodeURIComponent(h)}">${heroImg(h, 18)}${esc(cap(h))}</a>`;
const lg = (x) => 1 / (1 + Math.exp(-x)), logit = (p) => Math.log(p / (1 - p));
function series(p, bo) { const need = Math.ceil(bo / 2), out = {}; let win = 0; const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (let l = 0; l < need; l++) { const pr = C(need - 1 + l, l) * p ** need * (1 - p) ** l; out[`${need}-${l}`] = pr; win += pr; } for (let w = 0; w < need; w++) out[`${w}-${need}`] = C(need - 1 + w, w) * (1 - p) ** need * p ** w; return { win, scores: out }; }

// ---------------------------------------------------------------- chrome
const NAV = [["matches", "Matches", "M5 19L19 5M14 5h5v5M5 5l14 14M5 10V5h5"], ["sim", "Draft", "M5 5h6v6H5zM13 13h6v6h-6zM13 5h6v6h-6zM5 13h6v6H5z"], ["heroes", "Meta", "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"], ["teams", "Teams", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"], ["stats", "Stats", "M4 20V11M10 20V4M16 20v-6M21 20H3"], ["more", "More", "M4 7h16M4 12h16M4 17h16"]];
const TAB = { matches: "matches", match: "matches", versus: "matches", draft: "sim", sim: "sim", picks: "matches", heroes: "heroes", hero: "heroes", teams: "teams", team: "teams", players: "teams", player: "teams", stats: "stats", pstat: "stats", pcompare: "stats", more: "more", m8: "matches", library: "more", matrix: "heroes", leagues: "heroes", playbook: "heroes", patch: "heroes", results: "more", how: "more", sources: "more" };
function drawNav(active) { const nav = document.getElementById("nav"); if (!nav.childElementCount) nav.innerHTML = NAV.map(([k, l, d]) => `<a href="#/${k}" data-tab="${k}"><span class="nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span><span class="nav-l">${l}</span></a>`).join("");
  for (const a of nav.children) a.dataset.tab === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); }
document.getElementById("theme").addEventListener("click", () => { const l = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = l ? "light" : "dark"; document.getElementById("theme-color").setAttribute("content", l ? "#f4f5f6" : "#0A1512"); try { localStorage.setItem("theme", l ? "light" : "dark"); } catch {} });
document.getElementById("skip").addEventListener("click", () => app.focus());
function bindPick(input, items, label, onPick) { const box = document.getElementById(input.id + "-l");
  input.addEventListener("input", () => { const q = input.value.trim().toLowerCase(); const hits = q ? items.filter((x) => label(x).toLowerCase().includes(q)).slice(0, 8) : [];
    box.innerHTML = hits.map((x) => `<button type="button" class="vs-hit" data-i="${items.indexOf(x)}">${esc(label(x))}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const x = items[+b.dataset.i]; input.value = label(x); box.innerHTML = ""; onPick(x); })); }); }
const pickBox = (id, ph, val = "") => `<div class="vs-pick"><input class="field" id="${id}" type="search" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off" value="${esc(val)}"><div class="vs-list" id="${id}-l"></div></div>`;

// ---------------------------------------------------------------- matches
async function vMatches() {
  const [up, meta, res, teams] = await Promise.all([load("upcoming.json"), load("meta.json"), load("results.json"), load("teams.json")]);
  const intl = (m) => /MSC|M7|M8|MCT/.test(m.league), lgs = [...new Set(up.filter((m) => !intl(m)).map((m) => m.league))];
  S.mf ||= "All"; const shown = up.filter((m) => S.mf === "All" || (S.mf === "International" ? intl(m) : m.league === S.mf));
  const det = Object.fromEntries(await Promise.all([...new Set(shown.flatMap((m) => [m.a, m.b]))].map(async (n) => [n, await load(`teams/${sid(n)}.json`).catch(() => null)])));
  const icon = (d) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const tools = [["#/versus", "Versus", "M5 19L19 5M14 5h5v5M5 5l14 14M5 10V5h5"], ["#/m8", "M8 Worlds", "M7 4h10v5a5 5 0 01-10 0zM12 14v4M8 20h8M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3"], ["#/results", "Our record", "M4 20V10M10 20V4M16 20v-7M22 20H2"], ["#/picks", "Picks", "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"]];
  app.innerHTML = `<h1>MLBB MATCHES</h1><p class="lead">Series win chance, likely scores, map count and the draft scenarios for every scheduled match. Times are PH time.</p>
    <div class="tools">${tools.map(([h, t, d]) => `<a class="tool" href="${h}"><span class="tool-ic">${icon(d)}</span>${t}</a>`).join("")}</div>
    <a class="m8b" href="#/m8"><span class="m8b-ic">${icon(tools[1][2])}</span><span style="flex:1"><b>ROAD TO M8</b><span class="small">Wildcard in Bangkok from Dec 17, 2026. Main stage in Türkiye, January 2027.</span></span><span aria-hidden="true">›</span></a>
    ${up.length ? `<div class="filters" role="group" aria-label="League" style="margin-top:16px">${["All", ...lgs, ...(up.some(intl) ? ["International"] : [])].map((x) => `<button class="fbtn" type="button" data-mf="${esc(x)}" aria-pressed="${S.mf === x}">${esc(x)}</button>`).join("")}</div>` : ""}
    <h2 class="sec-h">Upcoming · ${shown.length} ${shown.length === 1 ? "match" : "matches"}</h2>
    ${shown.length ? shown.map((m) => matchCard(m, det)).join("") : `<div class="card"><h2>No match with both teams set yet</h2><p class="small">Matches appear here with projections as soon as both teams are known, and refresh every few hours. Meanwhile, try <a href="#/versus">Versus</a> or the <a href="#/sim">Draft lab</a>.</p></div>`}
    <h2 class="sec-h">Latest results</h2>${res.slice(0, 20).map(resultRow).join("")}
    <p class="small muted" style="margin-top:14px">Statistical projections for analysis and entertainment. Not betting advice. No sportsbook data is used for MLBB.</p>`;
  app.querySelectorAll("[data-mf]").forEach((b) => b.addEventListener("click", () => { S.mf = b.dataset.mf; vMatches(); }));
  stamp(meta);
}
function matchCard(m, det = {}) {
  const pa = m.pSeries, need = Math.ceil(m.bo / 2), ban = (n) => (det[n]?.profile?.firstBan || []).slice(0, 3);
  const bans = (n, side) => { const b = ban(n); return b.length ? `<div class="${side}"><b>${esc(sn(n))} usually ban</b><span class="hs">${b.map((x) => `<span><span class="hi">${heroImg(x.h, 40) || `<span class="hph" style="width:40px;height:40px;display:grid;place-items:center;background:var(--surface-2)">${esc(cap(x.h).slice(0, 2))}</span>`}</span>${esc(cap(x.h))}</span>`).join("")}</span></div>` : `<div class="${side}"></div>`; };
  return `<a class="mc" href="#/match/${esc(m.id)}"><div class="mc-h"><span>${esc(m.league)} · ${esc(m.stage)}</span><span class="mc-bo">BO${m.bo}</span></div>
    <div class="mc-t"><div class="mc-s a">${tb(m.a, 60)}<span class="nm">${esc(sn(m.a))}</span><span class="num">${pct(pa)}</span></div><div class="mc-vs">VS</div><div class="mc-s b">${tb(m.b, 60)}<span class="nm">${esc(sn(m.b))}</span><span class="num">${pct(1 - pa)}</span></div></div>
    <div class="mc-bar"><span style="width:${(pa * 100).toFixed(1)}%"></span><span style="width:${((1 - pa) * 100).toFixed(1)}%"></span></div>
    <div class="mc-b"><div class="mc-row"><span>${esc(when(m.date))}</span><span>First to ${need} <span class="pips" aria-hidden="true">${Array.from({ length: m.bo }, () => "<i></i>").join("")}</span></span></div>
      <div class="mc-chips"><span>Single game ${pct(Math.max(m.pGame, 1 - m.pGame))} ${esc(sn(m.pGame >= 0.5 ? m.a : m.b))}</span><span>About ${f1(m.expMaps)} maps</span><span>Confidence: ${esc(m.confidence)}</span></div>
      ${ban(m.a).length || ban(m.b).length ? `<div class="mc-bans">${bans(m.a, "a")}${bans(m.b, "b")}</div>` : ""}
      <span class="mc-cta">SCORES · SCENARIOS · BANS</span></div></a>`;
}
function resultRow(r) { const aw = r.score[0] > r.score[1], cls = r.graded ? (r.right ? "ok" : "no") : "";
  return `<div class="rcard ${cls}"><div class="top-r"><span>${esc(dshort(r.date))} · ${esc(r.league)} ${esc(r.stage)}</span><span class="tag">${r.graded ? (r.right ? "CALLED" : "MISSED") : ""}</span></div>
    <div class="sc"><span class="${aw ? "w" : "l"}">${esc(sn(r.a))}</span><span class="num">${r.score[0]} – ${r.score[1]}</span><span class="${aw ? "l" : "w"}">${esc(sn(r.b))}</span></div>
    <div class="bot-r"><span>We said <b>${esc(sn(r.pSeries >= 0.5 ? r.a : r.b))} ${pct(Math.max(r.pSeries, 1 - r.pSeries))}</b></span>${r.mvp ? `<span class="mvp">★ MVP ${esc(r.mvp)}</span>` : ""}</div>${r.graded && !r.right && r.why ? `<div class="why small"><b>Why we missed:</b> ${esc(r.why)}</div>` : ""}</div>`; }

async function vMatch(id) { const m = await load(`matches/${id}.json`); app.innerHTML = `${subHead("#/matches", `${m.league} · ${m.stage} · BO${m.bo}`, when(m.date) + " PH")}${await matchup(m.a, m.b, m.bo, m)}${ctxHtml(m)}`; }
// context for a match: experience, career win rate, archetype mix (clearly marked when it does not move the prediction)
function ctxHtml(m) {
  const c = m.context; if (!c) return "";
  const A = c.a, B = c.b, mx = Math.max(1, ...A.players.map((p) => p.g), ...B.players.map((p) => p.g));
  const bar = (v, col) => `<span class="bar"><i style="width:${(v / mx) * 100}%;background:${col}"></i></span>`;
  const rows = A.players.map((p, i) => { const q = B.players[i]; return `<div class="cx-r"><span class="cx-n"><b>${esc(p.n)}</b><em>${p.g}g · ${p.big} big</em></span>${bar(p.g, "#2FC3FF")}<span class="lbl">${esc(p.role)}</span>${bar(q.g, "#FF6B5E")}<span class="cx-n r"><b>${esc(q.n)}</b><em>${q.g}g · ${q.big} big</em></span></div>`; }).join("");
  const wrPts = c.careerApplied ? Math.round((1 / (1 + Math.exp(-c.careerEdge)) - 0.5) * 1000) / 10 : 0;
  const chips = (mix) => Object.entries(mix).sort((p, q) => q[1] - p[1]).map(([a, n]) => `<span class="ps-badge" style="--c:${acol(a)}">${n > 1 ? n + "× " : ""}${esc(a)}</span>`).join(" ") || `<span class="small muted">no archetypes on file</span>`;
  return `<h2 class="sec-h">Context</h2>
    <div class="card"><span class="lbl">EXPERIENCE · GAMES IN OUR DATA</span><div class="cx-h"><b>${esc(sn(m.a))} ${A.g}</b><span class="small muted">big-stage games ${A.big} – ${B.big}</span><b>${B.g} ${esc(sn(m.b))}</b></div>${rows}
      <p class="small muted">Big stage: playoffs, finals and international events. Experience is shown for context only; it did not improve our predictions when tested, so it does not move the numbers above.</p></div>
    <div class="card"><span class="lbl">CAREER WIN RATE</span><div class="cx-h"><b class="num">${esc(sn(m.a))} ${Math.round(A.wr * 100)}%</b><b class="num">${Math.round(B.wr * 100)}% ${esc(sn(m.b))}</b></div>
      <p class="small">${c.careerApplied ? `<b>In the prediction:</b> ${wrPts >= 0 ? esc(sn(m.a)) : esc(sn(m.b))} +${Math.abs(wrPts)} points, because one team's rating is still settling (new team or early season).` : "Not in the prediction for this match: both teams' ratings are settled, and then career win rate adds nothing."}</p>
      <p class="small muted">Each lineup's career game win rate, pulled toward 50% for players with few games.</p></div>
    ${Object.keys(A.mix).length || Object.keys(B.mix).length ? `<div class="card"><span class="lbl">ARCHETYPE MIX</span><p>${esc(sn(m.a))}: ${chips(A.mix)}</p><p>${esc(sn(m.b))}: ${chips(B.mix)}</p>${c.cells.length ? `<ul class="dots small">${c.cells.map((x) => `<li>${esc(x.a)} against ${esc(x.b)} lane opponents won ${Math.round(x.wp)}% (${x.n} games)</li>`).join("")}</ul>` : ""}<p class="small muted">Archetypes describe how players have played (Season 18). Matchups are shown for context only; they did not hold up when tested on later games.</p></div>` : ""}`;
}

// ---------------------------------------------------------------- the matchup view (used by match pages and Versus)
async function matchup(a, b, bo, pre = null) {
  const [ta, tb2] = await Promise.all([load(`teams/${sid(a)}.json`).catch(() => null), load(`teams/${sid(b)}.json`).catch(() => null)]);
  if (!ta || !tb2) return `<p class="empty">One of these teams has too few games in our data.</p>`;
  const pg = pre?.pGame ?? lg(ta.rating - tb2.rating), s = series(pg, bo), fav = s.win >= 0.5 ? ta : tb2, need = Math.ceil(bo / 2);
  const line = bo === 3 ? 2.5 : bo === 5 ? 4.5 : 5.5, over = bo >= 3 ? Object.entries(s.scores).filter(([k]) => k.split("-").reduce((x, y) => +x + +y, 0) > line).reduce((x, [, v]) => x + v, 0) : null;
  const scen = [];
  for (const [t, o, sgn] of [[ta, tb2, 1], [tb2, ta, -1]]) { const sg = t.signature; if (sg && sg.with[1] >= 3) { const adj = Math.max(-0.15, Math.min(0.15, -sg.delta * 0.5)), p2 = Math.min(0.97, Math.max(0.03, pg + sgn * adj)), oBan = o.profile.bansTheyMake.find((x) => x.h === sg.hero);
    scen.push({ t, o, sg, p2, oBan, side: t === ta ? "a" : "b" }); } }
  const mapsBoth = Object.keys(ta.profile.maps || {}).filter((m) => tb2.profile.maps?.[m]).map((m) => { const a1 = ta.profile.maps[m], b1 = tb2.profile.maps[m]; return { m, a1, b1, d: shrunk(a1) - shrunk(b1) }; }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const h2h = ta.matches.filter((m) => m.opp === tb2.name);
  const hp = (h, px) => heroImg(h, px) || `<span class="hph" style="width:${px}px;height:${px}px;display:grid;place-items:center;background:var(--surface-2);font-weight:700">${esc(cap(h).slice(0, 2))}</span>`;
  const rec = (r) => (r && r.n ? `${r.w}-${r.n - r.w}` : "-");
  // exact scores, mirrored: A's wins on the left, B's on the right, by number of games
  const rows = []; for (let l = 0; l < need; l++) { const ka = `${need}-${l}`, kb = `${l}-${need}`; rows.push({ score: `${need}-${l}`, pa: s.scores[ka] || 0, pb: s.scores[kb] || 0 }); }
  const maxP = Math.max(...rows.flatMap((r) => [r.pa, r.pb]), 0.01);
  const teamSec = (t, sd) => `<section class="mp-sec"><h2 class="sec-h">${esc(t.name)} <span class="muted">comfort picks</span></h2><div class="mp-picks">${t.profile.comfort.slice(0, 6).map((c) => `<a class="mp-pick" href="#/hero/${encodeURIComponent(c.h)}">${hp(c.h, 44)}<b>${esc(cap(c.h))}</b><span>${esc(c.role)}</span><span>${c.n} games · <em class="${c.wr >= 0.5 ? "up" : "down"}">${pct(c.wr)}</em></span></a>`).join("")}</div>
      <div class="mp-bans"><span class="lbl">THEY BAN MOST</span><span>${t.profile.bansTheyMake.slice(0, 5).map((x) => heroChip(x.h)).join(" ")}</span><span class="lbl">BANNED AGAINST THEM</span><span>${t.profile.bansAgainstThem.slice(0, 5).map((x) => heroChip(x.h)).join(" ")}</span></div>
      <div class="mp-splits"><div><span>First pick (blue)</span><b>${rec(t.profile.side.blue)}</b></div><div><span>Second pick (red)</span><b>${rec(t.profile.side.red)}</b></div><div><span>Under 14 min</span><b>${rec(t.profile.early)}</b></div><div><span>18+ min</span><b>${rec(t.profile.late)}</b></div></div></section>`;
  return `<section class="mp-hero"><div class="mc-t"><div class="mc-s a">${tb(ta.name, 60)}<a class="nm" href="#/team/${esc(ta.id)}">${esc(sn(ta.name))}</a><span class="num">${pct(s.win)}</span><span class="small muted">rating ${ta.elo}</span></div><div class="mc-vs">VS</div><div class="mc-s b">${tb(tb2.name, 60)}<a class="nm" href="#/team/${esc(tb2.id)}">${esc(sn(tb2.name))}</a><span class="num">${pct(1 - s.win)}</span><span class="small muted">rating ${tb2.elo}</span></div></div>
      <div class="mc-bar"><span style="width:${(s.win * 100).toFixed(1)}%"></span><span style="width:${((1 - s.win) * 100).toFixed(1)}%"></span></div>
      <div class="mp-h1"><h1>${esc(fav.name)} ${pct(Math.max(s.win, 1 - s.win))} to win the series</h1><div class="mc-chips"><span>Single game: ${esc(pg >= 0.5 ? ta.name : tb2.name)} ${pct(Math.max(pg, 1 - pg))}</span>${pre ? `<span>Confidence: ${esc(pre.confidence)}</span>` : ""}<span>Best of ${bo}</span></div></div></section>
    <nav class="mp-tabs" aria-label="Sections">${[["series", "Series"], ["draft", "Draft"], ["teams", "Teams"], ["lineups", "Lineups"]].map(([k, l], i) => `<button type="button" data-jump="mp-${k}"${i === 0 ? ' aria-current="true"' : ""}>${l}</button>`).join("")}</nav>
    <section class="mp-sec" id="mp-series"><h2 class="sec-h">Exact score</h2><div class="card mp-sc"><div class="mp-sc-h"><span>${esc(sn(ta.name))} wins</span><span>Score</span><span>${esc(sn(tb2.name))} wins</span></div>
      ${rows.map((r) => `<div class="mp-sc-r"><div class="l"><span class="muted small">${dec(r.pa)}</span><b>${pct(r.pa)}</b><span class="bar"><i style="width:${(r.pa / maxP) * 100}%"></i></span></div><span class="sc">${esc(r.score)}</span><div class="r"><span class="bar"><i style="width:${(r.pb / maxP) * 100}%"></i></span><b>${pct(r.pb)}</b><span class="muted small">${dec(r.pb)}</span></div></div>`).join("")}
      <p class="small muted">Chance, with fair odds on the outside.</p>
      ${over != null ? `<div class="mp-ou"><div class="spread small"><span>Over ${line} maps <b>${pct(over)}</b></span><span>Under <b>${pct(1 - over)}</b></span></div><div class="mc-bar"><span style="width:${(over * 100).toFixed(1)}%"></span><span style="width:${((1 - over) * 100).toFixed(1)}%"></span></div></div>` : ""}</div>
      ${bo >= 3 ? (() => { const memo = {}, P = (x, y) => (x >= need ? 1 : y >= need ? 0 : (memo[x + "," + y] ??= pg * P(x + 1, y) + (1 - pg) * P(x, y + 1)));
        return `<div class="card"><h2>Series in progress</h2><p class="small">${esc(ta.name)}'s chance to win the series at each score (${esc(ta.name)} first):</p><div class="tw"><table class="ft sip"><thead><tr><th></th>${[...Array(need).keys()].map((y) => `<th class="n">${esc(sn(tb2.name))} ${y}</th>`).join("")}</tr></thead><tbody>${[...Array(need).keys()].map((x) => `<tr><th>${esc(sn(ta.name))} ${x}</th>${[...Array(need).keys()].map((y) => { const v = P(x, y); return `<td class="n ${v >= 0.6 ? "up" : v <= 0.4 ? "down" : ""}">${pct(v)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div><p class="small muted">Same single-game chance (${pct(pg)}) for every game. The last game's winner wins the next one about 61% of the time in our data, but almost all of that is the better team winning again, so no extra momentum is added.</p></div>`; })() : ""}</section>
    <section class="mp-sec" id="mp-draft">${scen.length ? `<h2 class="sec-h">Scenarios: signature heroes banned</h2>${scen.map((c) => `<div class="mp-scn ${c.side}"><span class="mp-ban">${hp(c.sg.hero, 52)}<svg aria-hidden="true" viewBox="0 0 52 52"><path d="M10 42L42 10"/></svg></span><span><b>If ${esc(c.o.name)} bans ${esc(cap(c.sg.hero))}</b><span class="small">${esc(c.t.name)}'s ${esc(c.sg.role)}: ${c.sg.with[0]}-${c.sg.with[1] - c.sg.with[0]} with it, ${c.sg.without[0]}-${c.sg.without[1] - c.sg.without[0]} without.${c.oBan ? ` ${esc(c.o.name)} ban it in ${pct(c.oBan.share)} of their games.` : ""}</span><span class="mc-chips"><span>Game: ${esc(ta.name)} ${pct(c.p2)}</span><span>Series: ${pct(series(c.p2, bo).win)}</span></span></span></div>`).join("")}<p class="small muted">From each team's record with and without its most-played hero, pulled toward even on small samples, and capped so one ban moves a game by 15 points at most.</p>` : ""}
      <h2 class="sec-h">Likely bans</h2><div class="card">${[ta, tb2].map((t, i) => t.profile.firstBan?.length ? `<div class="mp-lb ${i ? "b" : "a"}"><span class="lbl">${esc(t.name)} usually open with</span><span class="hs">${t.profile.firstBan.slice(0, 3).map((x) => `<span>${hp(x.h, 40)}<span class="small">${esc(cap(x.h))} ${x.n}×</span></span>`).join("")}</span></div>` : "").join("")}
        <p class="small">${esc(tb2.name)} will want to take away ${ta.profile.comfort.slice(0, 3).map((c) => esc(cap(c.h))).join(", ")}; ${esc(ta.name)} will look at ${tb2.profile.comfort.slice(0, 3).map((c) => esc(cap(c.h))).join(", ")}.</p>
        <a class="mc-cta" href="#/sim?a=${encodeURIComponent(ta.name)}&b=${encodeURIComponent(tb2.name)}">TRY THIS DRAFT IN THE DRAFT LAB</a></div>
      ${mapsBoth.length ? `<h2 class="sec-h">Battlefield maps</h2><div class="card"><table class="ft"><thead><tr><th>Map</th><th class="n">${esc(ta.name)}</th><th class="n">${esc(tb2.name)}</th><th>Edge</th></tr></thead><tbody>${mapsBoth.map((x) => `<tr><td>${esc(x.m)}</td><td class="n">${wl(x.a1)}</td><td class="n">${wl(x.b1)}</td><td class="small">${Math.abs(x.d) < 0.08 ? '<span class="muted">even</span>' : esc(x.d > 0 ? ta.name : tb2.name)}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>
    <div id="mp-teams">${teamSec(ta, "a")}${teamSec(tb2, "b")}
      <h2 class="sec-h">Head-to-head</h2><div class="card">${h2h.length ? `<ul class="plain small">${h2h.map((m) => `<li class="spread"><span>${esc(dshort(m.date))} · ${esc(m.league)} ${esc(m.stage)}</span><span>${m.score[0] > m.score[1] ? '<b class="up">W</b>' : '<b class="down">L</b>'} ${m.score[0]}-${m.score[1]}</span></li>`).join("")}</ul>` : `<p class="small muted">No meetings in our data (last 30 matches of ${esc(ta.name)}).</p>`}</div></div>
    <section class="mp-sec" id="mp-lineups">${[ta, tb2].map((t) => `<h2 class="sec-h">${esc(t.name)} lineup</h2><div class="card"><ul class="plain">${t.roster.map((p) => `<li class="spread"><a class="tn" href="#/player/${esc(p.id)}">${face(p.id, p.player, 32)} ${esc(p.player)}</a><span class="muted small">${esc(p.role)}</span></li>`).join("") || `<li class="muted small">No roster on record.</li>`}</ul></div>`).join("")}</section>`;
}
// section tabs on match pages scroll to their section (hash routing is left alone)
document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-jump]"); if (!b) return; document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); b.parentElement.querySelectorAll("[data-jump]").forEach((x) => x.removeAttribute("aria-current")); b.setAttribute("aria-current", "true"); });

// ---------------------------------------------------------------- Draft lab
async function vDraft() {
  const [D, heroes, teams] = await Promise.all([load("draft.json"), load("heroes.json"), load("teams.json")]);
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"];
  const st = (S.draft ||= { a: teams.find((t) => t.name === qs.get("a")) || null, b: teams.find((t) => t.name === qs.get("b")) || null, h1: ["", "", "", "", ""], h2: ["", "", "", "", ""] });
  const names = heroes.map((h) => h.id).sort();
  const sh = (rec, k, m) => (rec ? logit((rec[1] + k) / (rec[0] + 2 * k)) : 0) * m;
  const pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const compute = () => {
    const h1 = st.h1.filter(Boolean), h2 = st.h2.filter(Boolean), parts = [];
    const hero = h1.reduce((x, h) => x + sh(D.heroes[h], 4, 1), 0) - h2.reduce((x, h) => x + sh(D.heroes[h], 4, 1), 0);
    let syn = 0, cnt = 0; for (const [hs, sg] of [[h1, 1], [h2, -1]]) for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const v = sh(D.pairs[pk(hs[i], hs[j])], 3, 1); syn += sg * v; if (Math.abs(v) > 0.3) parts.push([sg * v * D.scale.syn * D.wd, `${sg > 0 ? "A" : "B"} combo ${cap(hs[i])} + ${cap(hs[j])} (${v > 0 ? "works" : "struggles"} together, ${Math.round(D.pairs[pk(hs[i], hs[j])][0])} games)`]); }
    for (const a of h1) for (const b of h2) { const v = sh(D.vs[`${a}>${b}`], 3, 1); cnt += v; if (Math.abs(v) > 0.4) parts.push([v * D.scale.cnt * D.wd, `${cap(a)} vs ${cap(b)}: ${v > 0 ? "A's" : "B's"} hero has won this matchup more (${Math.round(D.vs[`${a}>${b}`][0])} games)`]); }
    const base = st.a && st.b ? st.a.rating - st.b.rating : 0, edge = D.wd * (hero * D.scale.hero + syn * D.scale.syn + cnt * D.scale.cnt), p = lg(base + edge);
    for (const h of h1) { const v = sh(D.heroes[h], 4, 1) * D.scale.hero * D.wd; if (Math.abs(v) > 0.03) parts.push([v, `A's ${cap(h)} is ${v > 0 ? "strong" : "weak"} in pro play (${Math.round(D.heroes[h]?.[0] || 0)} recent games)`]); }
    for (const h of h2) { const v = -sh(D.heroes[h], 4, 1) * D.scale.hero * D.wd; if (Math.abs(v) > 0.03) parts.push([v, `B's ${cap(h)} is ${v < 0 ? "strong" : "weak"} in pro play (${Math.round(D.heroes[h]?.[0] || 0)} recent games)`]); }
    return { p, base, edge, parts: parts.sort((x, y) => Math.abs(y[0]) - Math.abs(x[0])).slice(0, 8) };
  };
  const slot = (side, i) => `<div class="dl-slot"><span class="muted small">${ROLES[i]}</span>${pickBox(`d${side}${i}`, "Hero", cap(st[`h${side}`][i]))}</div>`;
  const draw = () => { const r = compute(), A = st.a?.name || "Side A", B = st.b?.name || "Side B";
    document.getElementById("dl-out").innerHTML = `<div class="card"><div class="gp-h"><span><b>${pct(r.p)}</b></span><span class="muted small">Game win chance</span><span><b>${pct(1 - r.p)}</b></span></div><div class="spread"><span>${esc(A)}</span><span>${esc(B)}</span></div>
      <div class="gc-bar"><span style="flex:${r.p};background:${r.p >= 0.5 ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - r.p};background:${r.p < 0.5 ? "var(--accent)" : "var(--line-2)"}"></span></div>
      <p class="small">Teams alone: ${pct(lg(r.base))} for ${esc(A)}. The draft moves it ${r.edge >= 0 ? "+" : ""}${Math.round((r.p - lg(r.base)) * 100)} points.</p>
      ${r.parts.length ? `<ul class="dots small">${r.parts.map(([v, t]) => `<li>${esc(t)} <span class="${v > 0 ? "up" : "down"}">${v > 0 ? "▲ A" : "▼ B"}</span></li>`).join("")}</ul>` : `<p class="small muted">Add heroes to see what drives the number.</p>`}
      <p class="small muted">Hero strength, combos and counters are learned from pro games, fading by half every 120 days so the current patch counts most, and pulled toward even when there are few games. In the back-test, the draft layer improved single-game predictions only slightly, so treat a big swing with care.</p></div>`; };
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Draft lab")}<p class="lead">Pick two teams (optional) and five heroes a side, in role order. The win chance combines the teams' ratings with each hero's pro-play strength, the combos on each side and the counters across.</p>
    <div class="grid two"><div class="card"><h2>Side A</h2>${pickBox("dta", "Team (optional)", st.a?.name || "")}${[0, 1, 2, 3, 4].map((i) => slot(1, i)).join("")}</div><div class="card"><h2>Side B</h2>${pickBox("dtb", "Team (optional)", st.b?.name || "")}${[0, 1, 2, 3, 4].map((i) => slot(2, i)).join("")}</div></div><div id="dl-out"></div>`;
  bindPick(document.getElementById("dta"), teams, (t) => t.name, (t) => { st.a = t; draw(); });
  bindPick(document.getElementById("dtb"), teams, (t) => t.name, (t) => { st.b = t; draw(); });
  for (const side of [1, 2]) for (let i = 0; i < 5; i++) { const inp = document.getElementById(`d${side}${i}`); bindPick(inp, names, (h) => cap(h), (h) => { st[`h${side}`][i] = h; draw(); }); inp.addEventListener("change", () => { if (!inp.value) { st[`h${side}`][i] = ""; draw(); } }); }
  draw();
}

// ---------------------------------------------------------------- Simulator: live match / draft simulation
// Teams, bans and picks by role; counter-pick suggestions for open slots; draft profile (CC, burst, tankiness,
// damage, push, engage, sustain, early, late); win chance by game time; 10,000 simulated games.
// COMP IDENTITY: six composites (0-10, 5 = the average pro lineup) built from the trait totals.
const COMP = { Damage: (p) => p.dmg + p.burst * 0.5, Playmaking: (p) => p.engage + p.burst * 0.5, Defensive: (p) => p.tank + p.sustain * 0.6, "Crowd control": (p) => p.cc, "Map control": (p) => p.push + p.early * 0.5, Utility: (p) => p.sustain + p.cc * 0.3 };
const compScore = (p, avg) => Object.fromEntries(Object.entries(COMP).map(([k, fn]) => { const ref = fn(avg) || 1; return [k, Math.round(Math.max(0, Math.min(10, (fn(p) / ref) * 5)) * 10) / 10]; }));
const wl = (r) => (r ? `${r[0]}-${r[1] - r[0]}` : "-");
const shrunk = (r, k = 2) => (r[0] + k) / (r[1] + 2 * k);
function mapTable(t) { const rows = Object.entries(t.profile.maps || {}).sort((a, b) => b[1][1] - a[1][1]); if (!rows.length) return `<p class="small muted">No battlefield maps on record for their recent games.</p>`;
  return `<table class="ft"><thead><tr><th>Battlefield</th><th class="n">Record</th><th class="n">Rate</th></tr></thead><tbody>${rows.map(([m, r]) => `<tr><td>${esc(m)}</td><td class="n">${wl(r)}</td><td class="n">${pct(shrunk(r))}</td></tr>`).join("")}</tbody></table>`; }
const TRAIT_LBL = { cc: "Crowd control", burst: "Burst", tank: "Tankiness", dmg: "Damage", push: "Push", engage: "Engage / gank", sustain: "Sustain", early: "Early game", late: "Late game" };
function traitBars(pA, pB, avg, la = "A", lb = "B") {
  return `<table class="ft tb2"><thead><tr><th>Trait</th><th class="n">${esc(la)}</th><th></th><th class="n">${esc(lb)}</th></tr></thead><tbody>${Object.keys(TRAIT_LBL).map((k) => { const a = pA[k] || 0, b = pB ? pB[k] || 0 : null, ref = Math.max(avg[k] || 0.01, 0.01), wa = Math.min(100, (a / (ref * 2)) * 100), wb = b == null ? 0 : Math.min(100, (b / (ref * 2)) * 100);
    return `<tr><td>${TRAIT_LBL[k]}</td><td class="n">${f1(a)}</td><td><div class="tbar"><span class="ta" style="width:${wa / 2}%"></span><span class="tmid"></span><span class="tbb" style="width:${wb / 2}%"></span></div></td><td class="n">${b == null ? "" : f1(b)}</td></tr>`; }).join("")}</tbody></table><p class="small muted">The middle line is the average pro lineup; bars grow out from it.</p>`;
}
function draftWarnings(p, avg, n) {
  if (n < 5) return []; const w = [], r = (k) => p[k] / (avg[k] || 1);
  if (r("tank") < 0.6) w.push("Little frontline: who absorbs the first engage?"); if (r("cc") < 0.6) w.push("Low crowd control: hard to lock down a diving carry."); if (r("dmg") < 0.75) w.push("Low damage: fights may drag on."); if (r("engage") < 0.6) w.push("Hard to start fights or catch players out.");
  if (r("early") > 1.4 && r("late") < 0.6) w.push("Built to win early: falls off if the game passes 18 minutes."); if (r("late") > 1.4 && r("early") < 0.6) w.push("Needs time: must survive the first 12 minutes.");
  return w;
}
function draftIdentity(p, avg) { const r = (k) => p[k] / (avg[k] || 1), out = [];
  if (r("early") > 1.3) out.push("early dive"); if (r("late") > 1.3) out.push("late scaling"); if (r("cc") > 1.2 && r("tank") > 1.1) out.push("teamfight"); if (r("burst") > 1.2 && r("engage") > 1.1) out.push("pick-off"); if (r("push") > 1.4) out.push("split push"); if (r("sustain") > 1.4) out.push("sustain");
  return out.length ? out.join(" + ") : "balanced"; }
async function vSim() {
  const [D, heroes, teams, meta, LGS] = await Promise.all([load("draft.json"), load("heroes.json"), load("teams.json"), load("meta.json"), load("leagues.json").catch(() => null)]);
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"];
  const st = (S.sim ||= { a: teams.find((t) => t.name === qs.get("a")) || null, b: teams.find((t) => t.name === qs.get("b")) || null, h1: ["", "", "", "", ""], h2: ["", "", "", "", ""], b1: ["", "", "", "", ""], b2: ["", "", "", "", ""], used1: [], used2: [], series: false });
  if (qs.get("a")) st.a = teams.find((t) => t.name === qs.get("a")) || st.a; if (qs.get("b")) st.b = teams.find((t) => t.name === qs.get("b")) || st.b;
  st.fp = st.fp === 2 ? 2 : 1; st.hist ||= []; st.sel ||= ""; st.q ||= ""; st.role ||= ""; st.open ||= {}; st.target ||= null;
  const byId = Object.fromEntries(heroes.map((h) => [h.id, h]));
  const sh = (rec, k) => (rec ? logit((rec[1] + k) / (rec[0] + 2 * k)) : 0), pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const lgShort = (h) => { const v = D.shortLong[h]; return v ? logit((v.short[0] + 4) / (v.short[1] + 8)) : 0; }, lgLong = (h) => { const v = D.shortLong[h]; return v ? logit((v.long[0] + 4) / (v.long[1] + 8)) : 0; };
  const prof = (hs) => { const p = {}; for (const k of Object.keys(TRAIT_LBL)) p[k] = hs.reduce((a, h) => a + (D.traits[h]?.[k] || 0), 0); return p; };
  const detail = async (t) => { if (!t) return null; const d = await load(`teams/${sid(t.name)}.json`).catch(() => null); if (!d) return null; const pl = await Promise.all(d.roster.map((r) => load(`players/${r.id}.json`).catch(() => null))); return { d, pl }; };
  const [dA, dB] = await Promise.all([detail(st.a), detail(st.b)]);
  const MAPS = Object.fromEntries(Object.entries(await load("maps.json").catch(() => ({}))).map(([k, v]) => [k.trim(), v]).filter(([, v]) => v.games >= 10));
  const pastGames = async (t) => { if (!t?.league) return []; const rows = await load(`library/${sid(t.league)}.json`).catch(() => []); return rows.filter((r) => r[2] === t.name || r[3] === t.name).slice(0, 25); };
  const [pgA, pgB] = await Promise.all([pastGames(st.a), pastGames(st.b)]);
  const det = (s) => (s === 1 ? dA : dB), team = (s) => (s === 1 ? st.a : st.b), tname = (s) => (team(s) ? sn(team(s).name) : s === st.fp ? "Blue side" : "Red side");
  // ---- analysis (same model as before)
  const plan = (me, them) => { if (!me || !them) return "";
    const targets = them.d.profile.comfort.filter((c) => c.n >= 3).map((c) => ({ ...c, score: c.n * (c.wr - 0.35) })).sort((a, b) => b.score - a.score).slice(0, 6);
    const alt = ROLES.map((r) => { const c = me.d.profile.comfort.filter((x) => x.role === r).slice(0, 3); return c.length ? `<li><b>${r}:</b> ${c.map((x, i) => `${i ? "if banned → " : ""}${heroChip(x.h)} <span class="muted small">${x.n}g ${pct(x.wr)}</span>`).join(" ")}</li>` : ""; }).join("");
    return `<div><h3>${esc(me.d.name)}: ban first</h3><ol class="small">${targets.map((t) => `<li>${heroChip(t.h)} <span class="muted">their ${esc(t.role)} · ${t.n} games, ${pct(t.wr)} won</span></li>`).join("")}</ol><h3>Picks by role, with fallbacks</h3><ul class="plain small">${alt}</ul></div>`; };
  const taken = () => new Set([...st.h1, ...st.h2, ...st.b1, ...st.b2].filter(Boolean));
  const suggest = (s, i) => {
    const mine = st[`h${s}`].filter(Boolean), opp = st[`h${3 - s}`].filter(Boolean), used = new Set(st.series ? st[`used${s}`] : []), tk = taken(), dt = det(s);
    const comfort = new Map((dt?.d.profile.comfort || []).filter((c) => c.role === ROLES[i]).map((c) => [c.h, c]));
    const player = dt?.pl.find((p) => p && p.role === ROLES[i]), ppool = new Map([...(player?.pool || []).map((x) => [x.h, x]), ...(player?.s18?.heroes || []).filter((x) => x.n >= 2).map((x) => [x.h, { h: x.h, n: x.n, wr: x.wr, s18: true }])]);
    return heroes.filter((h) => !tk.has(h.id) && !used.has(h.id) && (h.roles[0]?.r === ROLES[i] || h.roles[1]?.r === ROLES[i] || ppool.has(h.id))).map((h) => {
      const mt = sh(D.heroes[h.id], 4) * D.scale.hero * 2, cnt = opp.reduce((a, o) => a + sh(D.vs[`${h.id}>${o}`], 3), 0) * D.scale.cnt * 2, syn = mine.reduce((a, o) => a + sh(D.pairs[pk(h.id, o)], 3), 0) * D.scale.syn * 2;
      const c = comfort.get(h.id), pp = ppool.get(h.id), tm = c ? Math.min(0.3, c.n * 0.03) : 0, own = pp ? Math.min(0.35, pp.n * 0.02) + (pp.wr - 0.5) * 0.3 : -0.1;
      const od = det(3 - s), deny = (od?.d.profile.comfort || []).find((x) => x.h === h.id && x.n >= 3), flex = h.flex && h.laneSplit?.length > 1, cur = prof(mine), need = mine.length >= 2 ? [["tank", "adds frontline"], ["cc", "adds crowd control"], ["dmg", "adds damage"]].find(([k]) => cur[k] < (D.avgLineup[k] || 0) * (mine.length / 5) * 0.7 && (D.traits[h.id]?.[k] || 0) > (D.avgLineup[k] || 0) / 5 * 1.2) : null;
      const rkHits = opp.map((o) => ({ o, x: byId[o]?.rankedCounters?.by.find((y) => y.h === h.id) })).filter((y) => y.x), rk = rkHits.reduce((a, y) => a + y.x.adv, 0);
      const why = [cnt > 0.05 ? "counters their picks" : null, syn > 0.05 ? "combos with your picks" : null, mt > 0.08 ? "strong in the meta" : null, c ? `${dt.d.name} comfort (${c.n} games)` : null, pp ? `${player.name}: ${pp.n} games, ${pct(pp.wr)}` : null, deny ? `denies ${od.d.name}'s ${deny.role} comfort` : null, flex ? `flex: hides your lane` : null, need ? need[1] : null, rkHits.length ? `ranked (all players): counters ${rkHits.map((y) => cap(y.o)).join(", ")}` : null].filter(Boolean);
      return { h: h.id, score: mt + cnt + syn + tm + own + rk * 0.01 + (deny ? 0.08 : 0) + (flex ? 0.03 : 0) + (need ? 0.06 : 0), why };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
  };
  const sideRate = () => { const lgName = (st.a || st.b)?.league, L = LGS?.leagues.find((x) => x.league === lgName), r = L?.blue || LGS?.blueAll || [0, 0]; return { rate: (r[0] + 50) / (r[1] + 100), n: r[1], league: L ? L.league : "all leagues" }; };
  const compute = () => {
    const h1 = st.h1.filter(Boolean), h2 = st.h2.filter(Boolean);
    const hero = h1.reduce((x, h) => x + sh(D.heroes[h], 4), 0) - h2.reduce((x, h) => x + sh(D.heroes[h], 4), 0);
    let syn = 0, cnt = 0; for (const [hs, sg] of [[h1, 1], [h2, -1]]) for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) syn += sg * sh(D.pairs[pk(hs[i], hs[j])], 3);
    for (const a of h1) for (const b of h2) cnt += sh(D.vs[`${a}>${b}`], 3);
    const base = st.a && st.b ? st.a.rating - st.b.rating : 0, edge = D.wd * (hero * D.scale.hero + syn * D.scale.syn + cnt * D.scale.cnt), pSide = (st.fp === 1 ? 1 : -1) * logit(sideRate().rate), p = lg(base + edge + pSide);
    const es = (h1.reduce((a, h) => a + lgShort(h), 0) - h2.reduce((a, h) => a + lgShort(h), 0)) * 0.25, el = (h1.reduce((a, h) => a + lgLong(h), 0) - h2.reduce((a, h) => a + lgLong(h), 0)) * 0.25;
    const at = (min) => { const w = Math.max(0, Math.min(1, (min - 12) / 8)); return lg(logit(p) + es * (1 - w) + el * w); };
    let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); let wins = 0, long = 0, sumLen = 0; const N = 10000;
    for (let i = 0; i < N; i++) { const len = Math.max(8, 16 + (rnd() + rnd() + rnd() - 1.5) * 6 + (el - es) * 2); sumLen += len; if (len >= 20) long++; if (rnd() < at(len)) wins++; }
    return { p, base, edge, pSide, at, sim: { win: wins / N, avgLen: sumLen / N, long: long / N }, pA: prof(h1), pB: prof(h2), h1, h2 };
  };
  const compCard = (r, A, B) => { if (r.h1.length < 3 || r.h2.length < 3) return `<p class="small muted">Comp identity and coaching notes appear once each side has three picks.</p>`;
    const ca = compScore(r.pA, D.avgLineup), cb = compScore(r.pB, D.avgLineup), e = r.at(10), l = r.at(25), notes = [];
    const early = e > l ? A : B, late = e > l ? B : A, swing = Math.abs(l - e);
    if (swing >= 0.04) { notes.push(`<b>${esc(late)} outscale:</b> their chance grows from ${pct(e > l ? 1 - e : e)} at 10 minutes to ${pct(e > l ? 1 - l : l)} at 25+. Trade objectives instead of fighting early, protect the Gold lane until its core items, and defend towers.`); notes.push(`<b>${esc(early)} must end it:</b> group after the first tower, invade the enemy jungle, contest every Turtle and look for Lord before 16 minutes.`); }
    else notes.push("Neither side gains much with time: the game is decided by who wins the fights, not by a power spike.");
    for (const [k, txt] of [["Crowd control", "have more crowd control: fight in choke points and around Lord and Turtle."], ["Playmaking", "have the better pick-off tools: look for catches in the side lanes and river."], ["Map control", "control the map better: split push to draw rotations, then take objectives on the far side."]]) if (Math.abs(ca[k] - cb[k]) >= 1.5) notes.push(`<b>${esc(ca[k] > cb[k] ? A : B)}</b> ${txt}`);
    if (Math.abs(ca.Defensive - cb.Defensive) >= 1.5) notes.push(`<b>${esc(ca.Defensive > cb.Defensive ? B : A)} lack frontline:</b> poke before engaging and avoid head-on fights.`);
    const mages = (hs) => hs.filter((h) => byId[h]?.lp?.role === "Mage").length; for (const [hs, me, them] of [[r.h1, A, B], [r.h2, B, A]]) if (mages(hs) >= 3) notes.push(`<b>${esc(me)} lean on magic damage</b> (${mages(hs)} mages): ${esc(them)} can dive the backline and push side lanes, or build magic defence early.`);
    notes.push("Objective order for both sides: towers first, then Turtle, then Lord; kills only when they lead to one of these.");
    return `<h3>Comp identity</h3><table class="ft"><thead><tr><th></th><th class="n">${esc(A)}</th><th class="n">${esc(B)}</th></tr></thead><tbody>${Object.keys(COMP).map((k) => `<tr><td>${k}</td><td class="n${ca[k] > cb[k] + 0.9 ? " up" : ""}">${f1(ca[k])}</td><td class="n${cb[k] > ca[k] + 0.9 ? " up" : ""}">${f1(cb[k])}</td></tr>`).join("")}</tbody></table><p class="small muted">0-10, where 5 is the average pro lineup.</p><h3>Coaching notes: win conditions</h3><ul class="dots small">${notes.map((x) => `<li>${x}</li>`).join("")}</ul><p class="small muted">General MLBB macro applied to this draft's timing and traits.</p>`; };
  // ---- the draft order (pro format): F = first-pick (blue) team, S = second-pick (red) team; b = ban, p = pick
  const ORDER = [..."FSFSFS"].map((c) => [c, "b"]).concat([..."FSSFFS"].map((c) => [c, "p"]), [..."SFSF"].map((c) => [c, "b"]), [..."SFFS"].map((c) => [c, "p"]));
  const sideOf = (c) => (c === "F" ? st.fp : 3 - st.fp);
  const step = () => { const need = {}; for (let i = 0; i < ORDER.length; i++) { const [c, k] = ORDER[i], s = sideOf(c), key = k + s; need[key] = (need[key] || 0) + 1; if (st[(k === "b" ? "b" : "h") + s].filter(Boolean).length < need[key]) return i; } return ORDER.length; };
  const phase = (i) => (i >= 20 ? "DRAFT DONE" : i < 6 ? "BAN PHASE 1" : i < 12 ? "PICK PHASE 1" : i < 16 ? "BAN PHASE 2" : "PICK PHASE 2");
  const now = () => { const i = step(); if (i >= 20) return { i, s: 0, k: "" }; const [c, k] = ORDER[i]; return { i, s: sideOf(c), k }; };
  const roleSlot = (s, h) => { const arr = st[`h${s}`]; if (st.target?.s === s && !arr[st.target.i]) return st.target.i; for (const r of (byId[h]?.roles || []).slice(0, 2)) { const i = ROLES.indexOf(r.r); if (i >= 0 && !arr[i]) return i; } return arr.findIndex((x) => !x); };
  const sugNow = () => { const { i, s, k } = now(); if (!s) return []; const tk = taken();
    if (k === "p") { const out = new Map(); st[`h${s}`].forEach((x, ri) => { if (x) return; for (const g of suggest(s, ri)) if (!out.has(g.h) || out.get(g.h).score < g.score) out.set(g.h, { ...g, role: ROLES[ri] }); }); return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 3); }
    const od = det(3 - s), cand = new Map(), add = (h, sc, why) => { if (tk.has(h)) return; const v = cand.get(h) || { h, score: 0, why: [] }; v.score += sc; v.why.push(why); cand.set(h, v); };
    for (const c of od?.d.profile.comfort || []) if (c.n >= 2) add(c.h, c.n * (c.wr - 0.35) * 0.3, `${od.d.name}'s ${c.role} comfort: ${c.n} games, ${pct(c.wr)} won`);
    if (i < 6) for (const h of heroes) if (h.firstPhaseBan >= 0.6) add(h.id, 1 + h.recent.presence, "priority ban in pro play");
    const mine = st[`h${s}`].filter(Boolean); if (mine.length) for (const h of heroes) { const v = mine.reduce((a, o) => a + sh(D.vs[`${h.id}>${o}`], 3), 0); if (v > 0.3) add(h.id, v, `counters your ${mine.filter((o) => sh(D.vs[`${h.id}>${o}`], 3) > 0.1).map(cap).join(", ") || "picks"}`); }
    return [...cand.values()].sort((a, b) => b.score - a.score).slice(0, 3); };
  const lockIn = () => { const { s, k } = now(); if (!s || !st.sel) return; const used = new Set(st.series ? st[`used${s}`] : []); if (taken().has(st.sel) || used.has(st.sel)) return;
    if (k === "b") { const j = st[`b${s}`].findIndex((x) => !x); st[`b${s}`][j] = st.sel; st.hist.push({ k: "b", s, j }); } else { const j = roleSlot(s, st.sel); if (j < 0) return; st[`h${s}`][j] = st.sel; st.hist.push({ k: "h", s, j }); }
    st.sel = ""; st.target = null; render(); };
  const undo = () => { const last = st.hist.pop(); if (last) st[last.k + last.s][last.j] = ""; else { const i = step(); if (i > 0) { const [c, k] = ORDER[i - 1], arr = st[(k === "b" ? "b" : "h") + sideOf(c)], j = arr.map((x, ix) => (x ? ix : -1)).filter((x) => x >= 0).pop(); if (j != null) arr[j] = ""; } } st.sel = ""; render(); };
  // ---- pieces
  const icon = (d, z = 20) => `<svg aria-hidden="true" width="${z}" height="${z}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const SLASH = "M6.5 17.5l11-11", col = (s) => (s === st.fp ? "blue" : "red");
  const bans = (s) => { const n = now(), nx = n.k === "b" && n.s === s ? st[`b${s}`].findIndex((x) => !x) : -1; return `<span class="ds-bans ${col(s)}">${st[`b${s}`].map((h, j) => `<span class="ds-ban${j === nx ? " now" : ""}${h ? " on" : ""}" role="img" aria-label="${h ? `${esc(cap(h))} banned` : `${col(s)} ban ${j + 1}, empty`}">${h ? heroImg(h, 30) || esc(cap(h).slice(0, 2)) : icon(SLASH, 14)}</span>`).join("")}</span>`; };
  const picks = (s) => { const n = now(); return `<div class="ds-col ${col(s)}">${ROLES.map((r, i) => { const h = st[`h${s}`][i], tg = st.target?.s === s && st.target.i === i; return `<button type="button" class="ds-pick${h ? " on" : ""}${tg ? " tgt" : ""}${n.k === "p" && n.s === s && !h ? " open" : ""}" data-slot="${s},${i}" aria-label="${esc(tname(s))} ${r}: ${h ? esc(cap(h)) : "empty, tap to pick for this lane"}"><span class="ds-pic">${h ? heroImg(h, 40) || esc(cap(h).slice(0, 2)) : icon(ROLE_IC[r])}</span><span class="ds-pl"><b>${r.toUpperCase()}</b><span>${h ? esc(cap(h)) : "Pick a hero"}</span>${h ? comfortBadge(s, i, h) : ""}</span></button>`; }).join("")}</div>`; };
  // comfort badge: the lane player's record on this hero is clearly above their own average (5+ games); context only
  const comfortBadge = (s, i, h) => { const dt = det(s), pl = dt?.pl.find((p) => p && p.role === ROLES[i]); if (!pl) return ""; const pp = [...(pl.pool || []), ...(pl.s18?.heroes || []).map((x) => ({ h: x.h, n: x.n, wr: x.wr }))].filter((x) => x.h === h).sort((p, q) => q.n - p.n)[0]; if (!pp || pp.n < 5 || pp.wr < 0.6 || pp.wr - (pl.wr || 0.5) < 0.08) return ""; const w = Math.round(pp.wr * pp.n); return `<em class="ds-cf" title="Context only: hero comfort did not improve predictions when tested">Comfort · ${esc(pl.name)} ${w}-${pp.n - w}</em>`; };
  const track = () => { const i = step(); return `<div class="ds-track" aria-hidden="true">${ORDER.map(([c, k], j) => `<span class="${j === i ? "cur" : col(sideOf(c))} ${k}${j < i ? " done" : ""}"></span>`).join("")}</div>`; };
  const phaseLine = () => { const { i, s, k } = now(); return `<span class="ds-tag">${phase(i)}</span><b>${s ? `${esc(tname(s))} to ${k === "b" ? "ban" : "pick"}` : "Draft complete"}</b><span class="muted">${Math.min(i + 1, 20)} of 20</span>`; };
  const winBar = (r) => { const pb = st.fp === 1 ? r.p : 1 - r.p, base = st.fp === 1 ? lg(r.base) : 1 - lg(r.base), mv = Math.round(((st.fp === 1 ? lg(r.base + r.edge) - lg(r.base) : lg(r.base) - lg(r.base + r.edge))) * 100); return { pb, html: `<div class="ds-win"><div class="spread"><span class="num b">${pct(pb)}</span><span class="lbl">WIN CHANCE THIS GAME</span><span class="num r">${pct(1 - pb)}</span></div><div class="ds-wbar"><span style="width:${(pb * 100).toFixed(1)}%"></span><span style="width:${((1 - pb) * 100).toFixed(1)}%"></span></div><p class="small muted">Teams alone: ${pct(base)} blue. The draft moves it ${mv >= 0 ? "+" : ""}${mv} points so far.</p></div>` }; };
  const grid = () => { const { s } = now(), tk = taken(), used = s ? new Set(st.series ? st[`used${s}`] : []) : new Set(), sg = new Set(sugNow().map((x) => x.h)), q = st.q.trim().toLowerCase();
    return heroes.filter((h) => (!st.role || h.roles[0]?.r === st.role || h.roles[1]?.r === st.role) && (!q || h.id.includes(q))).sort((a, b) => (sg.has(b.id) - sg.has(a.id)) || b.recent.presence - a.recent.presence)
      .map((h) => { const off = tk.has(h.id) || used.has(h.id); return `<button type="button" class="dg-h${sg.has(h.id) ? " sug" : ""}${st.sel === h.id ? " sel" : ""}" data-h="${esc(h.id)}"${off ? " disabled" : ""} aria-pressed="${st.sel === h.id}"><span class="dg-p">${(heroImg(h.id, 72) || esc(cap(h.id).slice(0, 2))).replace(" loading=\"lazy\"", "")}</span><span class="dg-n">${esc(cap(h.id))}</span></button>`; }).join("") || `<p class="small muted">No hero matches.</p>`; };
  const selInfo = () => { const { s, k } = now(), sg = sugNow(), mine = sg.find((x) => x.h === st.sel);
    if (st.sel) return `<b>${esc(cap(st.sel))}</b>${mine ? `: ${esc(mine.why.slice(0, 3).join(" · "))}` : ""}${k === "p" ? ` <span class="muted">· goes to ${ROLES[roleSlot(s, st.sel)] || "-"}</span>` : ""}`;
    return s ? `<span class="sw-g"></span> Gold outline = suggested ${k === "b" ? "ban" : "pick"} for ${esc(tname(s))}${sg[0] ? `: ${esc(cap(sg[0].h))} (${esc(sg[0].why[0] || "")})` : ""}` : "Draft complete. Undo to change it, or Reset."; };
  const roleBtns = (wide) => `<div class="ds-roles" role="group" aria-label="Lane"><button type="button" data-role="" aria-pressed="${!st.role}">All</button>${ROLES.map((r) => `<button type="button" data-role="${r}" aria-pressed="${st.role === r}" aria-label="${r}">${icon(ROLE_IC[r], wide ? 18 : 16)}${wide ? "" : `<span>${r}</span>`}</button>`).join("")}</div>`;
  const search = (ph) => `<label class="ds-search">${icon("M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5", 18)}<input id="dsq" type="search" placeholder="${ph}" aria-label="Search heroes" value="${esc(st.q)}" autocomplete="off"></label>`;
  const lockLbl = () => { const { s, k } = now(); return s ? (k === "b" ? "LOCK IN BAN" : "LOCK IN PICK") : "DRAFT DONE"; };
  const settings = (MI) => `<div class="ds-set"><label class="ds-sw"><span><b>Series mode</b><span class="small muted">Heroes a team already used are locked for that team.</span></span><input type="checkbox" id="ds-series" ${st.series ? "checked" : ""}><span class="sw" aria-hidden="true"></span></label>
    ${st.series ? `<button class="btn sm" type="button" data-act="next">Next game: lock these picks, clear the board</button><p class="small muted">Used so far: ${esc(tname(1))} ${st.used1.length}, ${esc(tname(2))} ${st.used2.length}.</p>` : ""}
    <div class="filters" role="group" aria-label="First pick"><span class="small muted" style="align-self:center">Blue (first pick):</span>${[1, 2].map((v) => `<button class="fbtn" type="button" data-fp="${v}" aria-pressed="${st.fp === v}">${esc(team(v)?.name || (v === 1 ? "Side A" : "Side B"))}</button>`).join("")}</div>
    <label class="small" for="ds-map">Battlefield (map event)</label><select class="field" id="ds-map"><option value="">Not set</option>${Object.keys(MAPS).map((k) => `<option${st.map === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select><p class="small muted">${MI}</p></div>`;
  const mapInfo = () => { const MI = st.map && MAPS[st.map]; return MI ? `Blue side has won ${pct(MI.blueWin)} of ${MI.games} pro games on ${esc(st.map)}.${[st.a, st.b].filter(Boolean).map((t) => { const r = MI.teams[t.name]; return r ? ` ${esc(t.name)} ${r[0]}-${r[1] - r[0]} here.` : ""; }).join("")}` : st.map ? "Few pro games on record for this map." : "Map events are recorded for recent seasons only."; };
  const quick = () => [1, 2].map((s) => { const t = team(s), pg = s === 1 ? pgA : pgB, dt = det(s); if (!t) return ""; return `<div class="ds-q"><h3>${esc(t.name)}</h3><button class="btn sm" type="button" data-fill="${s}">Fill likely draft</button>
      <select class="field" data-past="${s}" aria-label="Load one of ${esc(t.name)}'s past drafts"><option value="">Load a past draft…</option>${pg.map((r, i) => `<option value="${i}">${esc(r[0] || "")} · vs ${esc(r[2] === t.name ? r[3] : r[2])} · G${r[5]} · ${(r[2] === t.name ? r[6] === 1 : r[6] === 2) ? "won" : "lost"}</option>`).join("")}</select>
      ${dt ? ROLES.map((r, i) => { const pl = dt.pl.find((p) => p && p.role === r); return pl ? `<div class="pchips"><span class="muted small">${esc(pl.name)} (${r}):</span>${pl.pool.slice(0, 5).map((x) => `<button class="hchip" type="button" data-pool="${s},${i},${esc(x.h)}" title="${x.n} games, ${pct(x.wr)} won">${heroImg(x.h, 16)}${esc(cap(x.h))}</button>`).join("")}</div>` : ""; }).join("") : ""}</div>`; }).join("");
  const isWide = () => st.wide || (matchMedia("(orientation: landscape) and (max-height: 520px)").matches && st.wide !== false);
  const det2 = (key, title, sub, body) => `<details class="ds-more" data-k="${key}"${st.open[key] ? " open" : ""}><summary><span><b>${title}</b><span class="small muted">${sub}</span></span>${icon("M6 9l6 6 6-6", 18)}</summary><div class="ds-body">${body}</div></details>`;
  // ---- render
  const render = () => {
    const r = compute(), A = st.a?.name || "Side A", B = st.b?.name || "Side B", W = winBar(r), blue = st.fp, red = 3 - st.fp, n = now();
    const wa = draftWarnings(r.pA, D.avgLineup, r.h1.length), wb = draftWarnings(r.pB, D.avgLineup, r.h2.length);
    if (isWide()) {
      document.body.classList.add("sim-wide-on");
      app.innerHTML = `<div class="simw" id="sim"><div class="sw-top"><div class="sw-side"><button class="icon-btn" type="button" data-act="narrow" aria-label="Back to upright view">${icon("M15 6l-6 6 6 6")}</button><b class="b">${esc(tname(blue))}</b>${bans(blue)}</div>
        <div class="sw-mid"><div class="ds-ph">${phaseLine()}</div>${track()}</div>
        <div class="sw-side end">${bans(red)}<b class="r">${esc(tname(red))}</b><button class="icon-btn" type="button" data-act="settings" aria-label="Draft settings: series mode, first pick, battlefield" aria-expanded="${!!st.showSet}">${icon("M4 7h10M18 7h2M4 17h2M10 17h10M16 5a2 2 0 110 4 2 2 0 010-4zM8 15a2 2 0 110 4 2 2 0 010-4z")}</button></div></div>
        <div class="sw-main">${picks(blue)}<div class="sw-grid"><div class="sw-tools">${roleBtns(true)}${search("Search")}</div><div class="dg dg9" id="dg">${grid()}</div><p class="small ds-info" id="dsi">${selInfo()}</p></div>${picks(red)}</div>
        <div class="sw-bot"><button class="btn" type="button" data-act="undo">Undo</button><div class="sw-win"><span class="num b">${pct(W.pb)}</span><span class="ds-wbar"><span style="width:${(W.pb * 100).toFixed(1)}%"></span><span style="width:${((1 - W.pb) * 100).toFixed(1)}%"></span></span><span class="num r">${pct(1 - W.pb)}</span><button class="ds-lock" type="button" data-act="lock"${!st.sel || !n.s ? " disabled" : ""}>${lockLbl()}</button></div><button class="btn" type="button" data-act="reset">Reset</button></div>
        ${st.showSet ? `<div class="sw-panel" role="dialog" aria-label="Draft settings"><div class="spread"><b>Draft settings</b><button class="icon-btn" type="button" data-act="settings" aria-label="Close settings">✕</button></div>${settings(mapInfo())}</div>` : ""}</div>`;
    } else {
      document.body.classList.remove("sim-wide-on");
      const tbox = (s) => `<div class="ds-team ${col(s)}"><span class="lbl">${s === blue ? "BLUE · FIRST PICK" : "RED · SECOND PICK"}</span>${pickBox(`st${s}`, "Choose a team", team(s) ? sn(team(s).name) : "")}</div>`;
      app.innerHTML = `<div class="sim" id="sim"><div class="ds-head"><h1>Draft simulator</h1><button class="ds-widebtn" type="button" data-act="wide">${icon("M3 9h18v10H3zM7 3l-2 2 2 2M5 5h9a4 4 0 014 4")}Wide view</button></div>
        <div class="ds-teams">${tbox(blue)}${tbox(red)}</div>
        <section class="ds-stage" aria-label="Draft stage"><div class="ds-ph">${phaseLine()}</div>${track()}<div class="ds-banrow">${bans(blue)}<span class="lbl">BANS</span>${bans(red)}</div><div class="ds-cols">${picks(blue)}${picks(red)}</div>${W.html}</section>
        <section class="ds-picker" aria-label="Hero picker">${roleBtns(false)}${search("Search heroes")}<p class="small ds-info" id="dsi">${selInfo()}</p><div class="dg" id="dg">${grid()}</div></section>
        <div class="ds-bar"><button class="ds-ib" type="button" data-act="undo" aria-label="Undo">${icon("M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2")}</button><button class="ds-lock" type="button" data-act="lock"${!st.sel || !n.s ? " disabled" : ""}>${lockLbl()}</button><button class="ds-ib" type="button" data-act="reset" aria-label="Reset draft">${icon("M4 12a8 8 0 108-8H7M10 1L7 4l3 3")}</button></div>
        <div class="ds-rows">${settings(mapInfo())}
        ${det2("time", "If the game ends at", "Win chance at 10, 15, 20 and 25+ minutes.", `<table class="ft"><thead><tr><th>${esc(A)} wins</th>${[10, 15, 20, 25].map((m) => `<th class="n">${m}${m === 25 ? "+" : ""} min</th>`).join("")}</tr></thead><tbody><tr><td></td>${[10, 15, 20, 25].map((m) => `<td class="n">${pct(r.at(m))}</td>`).join("")}</tr></tbody></table><p class="small">10,000 simulated games: ${esc(A)} wins ${pct(r.sim.win)} · average length ${f1(r.sim.avgLen)} min · ${pct(r.sim.long)} go 20+ minutes.</p>`)}
        ${det2("profile", "Draft profile", "Crowd control, burst, tankiness and six more, side by side.", `<p class="small"><b>${esc(A)}:</b> ${esc(draftIdentity(r.pA, D.avgLineup))} · <b>${esc(B)}:</b> ${esc(draftIdentity(r.pB, D.avgLineup))}</p>${traitBars(r.pA, r.pB, D.avgLineup, A, B)}${wa.length || wb.length ? `<ul class="dots small">${wa.map((x) => `<li><b>${esc(A)}:</b> ${esc(x)}</li>`).join("")}${wb.map((x) => `<li><b>${esc(B)}:</b> ${esc(x)}</li>`).join("")}</ul>` : ""}${compCard(r, A, B)}`)}
        ${dA && dB ? det2("plan", "Draft plan", "What each team should ban first, and fallbacks by lane.", `<div class="grid two">${plan(dA, dB)}${plan(dB, dA)}</div>`) : ""}
        ${st.a || st.b ? det2("quick", "Load a team's draft", "Likely draft, any past pro draft, or a player's hero pool.", quick()) : ""}</div>
        <p class="small muted" style="margin-top:12px">An original OddsSmash layout, not affiliated with or endorsed by Moonton. Current patch: ${esc(D.patch?.patch || "-")}.</p></div>`;
      for (const s of [1, 2]) { const inp = document.getElementById(`st${s}`); if (inp) bindPick(inp, teams, (t) => `${t.name} (${t.region})`, (t) => { st[s === 1 ? "a" : "b"] = t; vSim(); }); }
    }
    bind();
  };
  const setSide = (s, pks, bns) => { if (pks) st[`h${s}`] = pks.map((h) => h || ""); if (bns) st[`b${s}`] = [0, 1, 2, 3, 4].map((i) => bns[i] || ""); st.hist = []; render(); };
  const bind = () => {
    const root = document.getElementById("sim");
    root.addEventListener("click", (e) => {
      const h = e.target.closest("[data-h]"), sl = e.target.closest("[data-slot]"), ac = e.target.closest("[data-act]"), ro = e.target.closest("[data-role]"), fp = e.target.closest("[data-fp]"), fill = e.target.closest("[data-fill]"), pool = e.target.closest("[data-pool]");
      if (h && !h.disabled) { st.sel = st.sel === h.dataset.h ? "" : h.dataset.h; render(); return; }
      if (sl) { const [s, i] = sl.dataset.slot.split(",").map(Number); st.target = st.target?.s === s && st.target.i === i ? null : { s, i }; render(); return; }
      if (ro) { st.role = ro.dataset.role; render(); return; }
      if (fp) { st.fp = +fp.dataset.fp; render(); return; }
      if (fill) { const s = +fill.dataset.fill, dt = det(s), used = taken(); setSide(s, ROLES.map((r) => { const c = (dt?.d.profile.comfort || []).find((x) => x.role === r && !used.has(x.h)); if (c) used.add(c.h); return c?.h || ""; }), null); return; }
      if (pool) { const [s, i, hh] = pool.dataset.pool.split(","); if (!taken().has(hh)) { st[`h${s}`][+i] = hh; st.hist.push({ k: "h", s: +s, j: +i }); } render(); return; }
      if (!ac) return; const a = ac.dataset.act;
      if (a === "lock") lockIn(); else if (a === "undo") undo(); else if (a === "reset") { const keep = { a: st.a, b: st.b, fp: st.fp, series: st.series, used1: st.used1, used2: st.used2, map: st.map, wide: st.wide }; S.sim = null; Object.assign(S.sim = { h1: ["", "", "", "", ""], h2: ["", "", "", "", ""], b1: ["", "", "", "", ""], b2: ["", "", "", "", ""] }, keep); vSim(); }
      else if (a === "wide") { st.wide = true; render(); } else if (a === "narrow") { st.wide = false; st.showSet = false; render(); } else if (a === "settings") { st.showSet = !st.showSet; render(); }
      else if (a === "next") { st.used1.push(...st.h1.filter(Boolean)); st.used2.push(...st.h2.filter(Boolean)); for (const k of ["h1", "h2", "b1", "b2"]) st[k] = ["", "", "", "", ""]; st.hist = []; render(); }
    });
    root.addEventListener("dblclick", (e) => { const h = e.target.closest("[data-h]"); if (h && !h.disabled) { st.sel = h.dataset.h; lockIn(); } });
    root.addEventListener("toggle", (e) => { const d = e.target.closest?.("details[data-k]"); if (d) st.open[d.dataset.k] = d.open; }, true);
    const q = document.getElementById("dsq"); q?.addEventListener("input", () => { st.q = q.value; document.getElementById("dg").innerHTML = grid(); });
    document.getElementById("ds-series")?.addEventListener("change", (e) => { st.series = e.target.checked; render(); });
    document.getElementById("ds-map")?.addEventListener("change", (e) => { st.map = e.target.value; render(); });
    root.querySelectorAll("[data-past]").forEach((sel) => sel.addEventListener("change", () => { if (sel.value === "") return; const s = +sel.dataset.past, t = team(s), row = (s === 1 ? pgA : pgB)[+sel.value]; if (!row) return; const mine = row[2] === t.name; setSide(s, mine ? row[10] : row[11], mine ? row[12] : row[13]); }));
  };
  // follow the phone's rotation while the Draft tab is open
  const mq = matchMedia("(orientation: landscape) and (max-height: 520px)");
  if (!S.simMq) { S.simMq = true; mq.addEventListener("change", () => { if (document.getElementById("sim")) { if (S.sim) S.sim.wide = undefined; vSim(); } }); }
  render();
}

// ---------------------------------------------------------------- Draft library (every pro game with its draft)
// ---------------------------------------------------------------- Meta by league
// ---------------------------------------------------------------- Playbook: plain rules from our own pro games
// ---------------------------------------------------------------- Patch tracker
// ---- canvas sub-page header (back, section label, title, logo) used by every screen below the five tabs
const subHead = (back, label, title) => `<header class="ph"><a class="ph-back" href="${back}" aria-label="Back">${'<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>'}</a><span class="ph-t"><span class="ph-l">${esc(label)}</span><h1>${esc(title)}</h1></span><a class="ph-logo" href="../" aria-label="ODDSSMASH home"><img class="on-dark" src="../brand/stack-silver.png" alt="" height="34"><img class="on-light" src="../brand/stack-black.png" alt="" height="34"></a></header>`;
const jumpTabs = (items) => `<nav class="mp-tabs" aria-label="Sections">${items.map(([id, l], i) => `<button type="button" data-jump="${id}"${i === 0 ? ' aria-current="true"' : ""}>${l}</button>`).join("")}</nav>`;
const hpic = (h, px) => heroImg(h, px) || `<span class="hph" style="width:${px}px;height:${px}px;display:grid;place-items:center;background:var(--surface-2);font-weight:700">${esc(cap(h).slice(0, 2))}</span>`;
const RICON = (r, z = 18) => `<svg aria-hidden="true" width="${z}" height="${z}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ROLE_IC[r] || ""}"/></svg>`;

async function vTeam(id) {
  const [t, up] = await Promise.all([load(`teams/${id}.json`), load("upcoming.json").catch(() => [])]), pr = t.profile, nxt = up.find((m) => m.a === t.name || m.b === t.name);
  const rec = (r) => (r && r.n ? [r.w, r.n - r.w] : null), sp = (l, r, col) => { const x = rec(r); if (!x) return ""; const p = x[0] / (x[0] + x[1]); return `<div class="tm-sp" style="border-left-color:${col}"><span class="small muted">${l}</span><span><b class="num">${x[0]}-${x[1]}</b> <em class="${p >= 0.6 ? "up" : p <= 0.5 ? "down" : ""}">${pct(p)}</em></span></div>`; };
  const rate = (r) => (r && r.n ? r.w / r.n : null), b = rate(pr.side.blue), rd = rate(pr.side.red), e = rate(pr.early), l = rate(pr.late), read = [];
  if (b != null && rd != null && Math.abs(b - rd) >= 0.12) read.push(`much better on the ${b > rd ? "first-pick (blue)" : "second-pick (red)"} side`);
  if (e != null && l != null && Math.abs(e - l) >= 0.12) read.push(`stronger in ${e > l ? "short games (under 14 min)" : "long games (18+ min)"}`);
  const form = t.matches.slice(0, 15).reverse(); let acc = 0; const pts = form.map((m, i) => { acc += m.score[0] > m.score[1] ? 1 : -1; return [i, acc]; });
  const mn = Math.min(0, ...pts.map((p) => p[1])), mx = Math.max(1, ...pts.map((p) => p[1])), W = 96, H = 48, path = pts.map(([i, v], k) => `${k ? "L" : "M"}${(2 + (i / Math.max(1, pts.length - 1)) * (W - 4)).toFixed(1)} ${(H - 4 - ((v - mn) / (mx - mn || 1)) * (H - 8)).toFixed(1)}`).join(" ");
  const pnext = nxt ? (nxt.a === t.name ? nxt.pSeries : 1 - nxt.pSeries) : null;
  app.innerHTML = `${subHead("#/teams", `TEAMS · ${t.league || ""}`, t.name)}
    <section class="tm-hero"><div class="tm-top">${tb(t.name, 72)}<span class="tm-r"><span class="lbl">RATING</span><b class="num">${t.elo}</b><span class="small muted">${t.elo >= 1500 ? `${t.elo - 1500} above` : `${1500 - t.elo} below`} the average team</span></span>${pts.length > 2 ? `<svg role="img" aria-label="Form over their last ${pts.length} series" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ""}</div>
      ${nxt ? `<a class="tm-next" href="#/match/${esc(nxt.id)}"><span class="nx">NEXT</span><span style="flex:1">vs ${esc(nxt.a === t.name ? nxt.b : nxt.a)} · BO${nxt.bo} · ${esc(when(nxt.date))}</span><b class="num ${pnext >= 0.5 ? "b" : "r"}">${pct(pnext)}</b></a>` : ""}</section>
    ${jumpTabs([["tm-scout", "Scouting"], ["tm-roster", "Roster"], ["tm-results", "Results"], ["tm-drafts", "Drafts"]])}
    <section class="mp-sec" id="tm-scout"><h2 class="sec-h">How they win</h2><div class="tm-sps">${sp("First pick (blue side)", pr.side.blue, "var(--accent)")}${sp("Second pick (red side)", pr.side.red, "var(--red)")}${sp("Games under 14 min", pr.early, "var(--line-2)")}${sp("Games 18+ min", pr.late, "var(--line-2)")}</div>
      ${read.length ? `<div class="tm-read"><b>Read:</b> ${esc(read.join(" and "))}. ${b != null && rd != null && Math.abs(b - rd) >= 0.12 ? `Beat them on the ${b > rd ? "second-pick" : "first-pick"} side.` : ""}</div>` : ""}
      <p class="small muted">Archetype: ${esc(pr.archetype.join(", "))} · average game ${pr.tempo.avgMin ?? "-"} min.</p>
      <h2 class="sec-h">Comfort picks</h2><div class="mp-picks">${pr.comfort.slice(0, 6).map((c) => `<a class="mp-pick" href="#/hero/${encodeURIComponent(c.h)}">${hpic(c.h, 48)}<b>${esc(cap(c.h))}</b><span>${esc(c.role.toUpperCase())}</span><span>${c.n} games · <em style="color:var(--gold)">${pct(c.wr)}</em></span></a>`).join("")}</div>
      <h2 class="sec-h">Ban habits</h2><div class="card tm-bans"><span class="lbl">THEY BAN MOST</span><span>${pr.bansTheyMake.slice(0, 5).map((x) => `<span class="bchip">${esc(cap(x.h))} ${pct(x.share)}</span>`).join("")}</span><span class="lbl">BANNED AGAINST THEM</span><span>${pr.bansAgainstThem.slice(0, 5).map((x) => `<span class="bchip">${esc(cap(x.h))} ${pct(x.share)}</span>`).join("")}</span>${pr.firstBan?.length ? `<span class="lbl">FIRST BAN</span><span>${pr.firstBan.slice(0, 5).map((x) => `<span class="bchip">${esc(cap(x.h))} ${x.n}×</span>`).join("")}</span>` : ""}</div>
      ${Object.keys(pr.maps || {}).length ? `<h2 class="sec-h">Battlefield maps</h2><div class="card">${mapTable(t)}</div>` : ""}</section>
    <section class="mp-sec" id="tm-roster"><h2 class="sec-h">Starting five</h2><div class="tm-five">${t.roster.map((p) => `<a class="tm-p" href="#/player/${esc(p.id)}"><span class="ri">${RICON(p.role)}</span>${face(p.id, p.player, 40)}<b>${esc(p.player)}</b><span>${esc((p.role || "").toUpperCase())}</span></a>`).join("") || `<p class="small muted">No roster on record.</p>`}</div>
      ${t.roster.some((p) => p.pool?.length) ? `<div class="card" style="margin-top:10px"><h3>Hero pools</h3>${t.roster.map((p) => p.pool?.length ? `<p class="small"><b>${esc(p.player)}</b> ${p.pool.map((x) => `${heroChip(x.h)} <span class="muted">${x.n}</span>`).join(" ")}</p>` : "").join("")}</div>` : ""}
      ${t.staff?.list?.length ? `<h2 class="sec-h">Coaching staff</h2><div class="mo-list">${t.staff.list.map((x) => `<div class="mo-i"><span class="mo-ic">${RICON("Roam")}</span><span><b>${esc(x.name)}</b><span class="small muted">${esc(x.role)}</span></span><span></span></div>`).join("")}</div>` : ""}
      ${t.official ? `<h2 class="sec-h">Official ${esc(t.official.league)} stats</h2><div class="statgrid sg4"><div class="stat"><b>${t.official.kills}</b><span>Kills</span></div><div class="stat"><b>${t.official.deaths}</b><span>Deaths</span></div><div class="stat"><b>${t.official.lord}</b><span>Lords</span></div><div class="stat"><b>${t.official.turtle}</b><span>Turtles</span></div></div>` : ""}</section>
    <section class="mp-sec" id="tm-results"><h2 class="sec-h">Recent matches</h2><div class="mo-list">${t.matches.slice(0, 20).map((m) => `<div class="mo-i"><span class="tm-wl ${m.score[0] > m.score[1] ? "w" : "l"}">${m.score[0] > m.score[1] ? "W" : "L"}</span><span><b>vs ${esc(m.opp)} ${m.score[0]}-${m.score[1]}</b><span class="small muted">${esc(dshort(m.date))} · ${esc(m.league)} ${esc(m.stage)}</span></span><span></span></div>`).join("")}</div></section>
    <section class="mp-sec" id="tm-drafts"><h2 class="sec-h">Drafts</h2><div class="card"><div id="t-prof"></div>${t.signature ? `<p class="small">Signature hero: ${heroChip(t.signature.hero)} (${esc(t.signature.role)}) · ${t.signature.with[0]}-${t.signature.with[1] - t.signature.with[0]} with it, ${t.signature.without[0]}-${t.signature.without[1] - t.signature.without[0]} without.</p>` : ""}<p class="small"><a href="#/library">Every pro draft in the Draft library ›</a></p></div></section>
    <div class="tm-cta"><a class="btn" href="#/versus?a=${encodeURIComponent(t.name)}">Compare in Versus</a><a class="btn gold" href="#/sim?a=${encodeURIComponent(t.name)}">Draft against them</a></div>`;
  const D = await load("draft.json"); const el = document.getElementById("t-prof"); if (el) el.innerHTML = traitBars(pr.draft, null, D.avgLineup, "Their drafts");
}

async function vHero(id) {
  const [heroes, meta] = await Promise.all([load("heroes.json"), load("meta.json")]), h = heroes.find((x) => x.id === id); if (!h) return vMissing();
  const players = (await load("players.json")).filter((p) => p.top?.some((t) => t.h === id)).slice(0, 8);
  const rows = (arr, k) => arr.map((x) => `<div class="hr-row${x.n < 15 ? " thin" : ""}">${hpic(x[k], 40)}<span><b>${esc(cap(x[k]))}</b><span class="small muted">${Math.round(x.n)} games${x.lift != null ? ` · ${x.lift > 0 ? "+" : ""}${Math.round(x.lift * 100)} vs expected` : ""}</span></span><span class="hr-bar"><i style="width:${Math.round(x.wr * 100)}%"></i></span><b class="num">${pct(x.wr)}</b></div>`).join("") || `<p class="small muted" style="padding:10px 12px;margin:0">Not enough games.</p>`;
  const seg = (v) => Array.from({ length: 10 }, (_, i) => `<i class="${i < Math.round(v) ? "on" : ""}"></i>`).join("");
  const lanes = (h.bestLane || h.roles.slice(0, 2).map((r) => ({ r: r.r, n: r.n, w: r.w, wr: r.n ? r.w / r.n : null }))).slice(0, 2), tot = h.roles.reduce((a, r) => a + r.n, 0) || 1;
  app.innerHTML = `${subHead("#/heroes", "META · HERO", cap(h.id))}
    <section class="hr-hero"><div class="hr-top">${hpic(h.id, 84)}<span class="hr-tags"><span>${h.tier ? `<b class="t-tier">${h.tier} TIER</b>` : ""}${h.firstPhaseBan >= 0.6 ? `<b class="t-pb">priority ban</b>` : ""}${h.flex ? `<b class="t-fx">flex</b>` : ""}${h.untested ? `<b class="t-nw">changed, untested</b>` : ""}</span><span class="small">${esc(h.roles.slice(0, 2).map((r) => `${r.r} lane`).join(" / "))}</span><span class="small muted">Patch ${esc(meta.patch?.patch || "-")} · last 150 days</span></span></div>
      <div class="hr-stats"><div><b class="num" style="color:var(--gold)">${pct(h.recent.presence)}</b><span>presence</span></div><div><b class="num">${h.recent.picks}</b><span>picks</span></div><div><b class="num" style="color:var(--red-ink)">${h.recent.bans.toLocaleString("en-US")}</b><span>bans</span></div><div><b class="num" style="color:var(--ok)">${h.recent.wr != null ? pct(h.recent.wr) : "-"}</b><span>won</span></div></div></section>
    ${jumpTabs([["hr-over", "Overview"], ["hr-match", "Matchups"], ["hr-lg", "Leagues"], ["hr-pl", "Players"]])}
    <section class="mp-sec" id="hr-over">${h.ratings ? `<h2 class="sec-h">Profile · 0 to 10</h2><div class="card hr-prof">${Object.entries(h.ratings).map(([k, v]) => `<div><span>${esc(k)}</span><span class="seg">${seg(v)}</span><b>${f1(v)}</b></div>`).join("")}</div>` : ""}
      <h2 class="sec-h">Where pros play it</h2><div class="tm-sps">${lanes.map((x) => `<div class="tm-sp hr-lane"><span class="lbl">${RICON(x.r, 16)} ${esc(x.r.toUpperCase())} LANE</span><b class="num">${pct(x.n / tot)}</b><span class="small muted">of picks${x.wr != null ? ` · ${pct(x.wr)} won` : ""}</span></div>`).join("")}</div>
      ${h.timing ? `<div class="tm-read"><b>${esc(h.timing.label)}:</b> wins ${pct(h.timing.short)} of games under 13 minutes and ${pct(h.timing.long)} of games 18+ minutes (last 365 days).</div>` : ""}</section>
    <section class="mp-sec" id="hr-match"><h2 class="sec-h" style="color:var(--ok)">Strong against</h2><div class="card hr-list">${rows(h.counters.slice(0, 5), "vs")}</div>
      <h2 class="sec-h" style="color:var(--red-ink)">Weak against</h2><div class="card hr-list">${rows(h.counteredBy.slice(0, 5), "vs")}</div>
      <h2 class="sec-h" style="color:var(--gold)">Best with</h2><div class="card hr-list">${rows(h.combos.slice(0, 5), "with")}</div>
      ${h.laneVs?.length ? `<h2 class="sec-h">Lane matchups</h2><div class="card hr-list">${rows(h.laneVs.slice(0, 6).map((x) => ({ ...x, vs: x.vs })), "vs")}</div>` : ""}
      ${h.rankedCounters ? `<h2 class="sec-h">Counters in ranked (all players)</h2><div class="card"><p class="small"><b>Countered by:</b> ${h.rankedCounters.by.map((x) => `${heroChip(x.h)} <span class="muted">+${f1(x.adv)}%</span>`).join(" ")}</p>${h.rankedCounters.into.length ? `<p class="small"><b>Does well into:</b> ${h.rankedCounters.into.map((x) => heroChip(x)).join(" ")}</p>` : ""}<p class="small muted">Ranked games, past 7 days (mlbb.io). Background only, not pro play.</p></div>` : ""}</section>
    <section class="mp-sec" id="hr-lg">${h.byLeague?.length ? `<h2 class="sec-h">By league</h2><div class="card"><table class="ft"><thead><tr><th>League</th><th class="n">Pick/ban</th><th class="n">Won</th></tr></thead><tbody>${h.byLeague.map((x) => `<tr><td>${esc(x.league)}</td><td class="n"><b>${pct(x.pres)}</b></td><td class="n">${x.wr == null ? "-" : pct(x.wr)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No league breakdown yet.</p>`}</section>
    <section class="mp-sec" id="hr-pl"><h2 class="sec-h">Players known for it</h2>${players.length ? `<div class="mo-list">${players.map((p) => `<a class="mo-i" href="#/player/${esc(p.id)}">${face(p.id, p.name, 38)}<span><b>${esc(p.name)}</b><span class="small muted">${esc(p.team || "")} · ${esc(p.role)}</span></span><span aria-hidden="true">›</span></a>`).join("")}</div>` : `<p class="small muted">None in our data.</p>`}</section>
    <p class="small muted">Rows with fewer than 15 games are greyed out. Combos and counters: pro games, fading by half every 120 days, pulled toward 50% on small samples.</p>`;
}

async function vResults() {
  const [res, acc, pt] = await Promise.all([load("results.json"), load("accuracy.json"), load("pretip.json").catch(() => null)]);
  const C = 2 * Math.PI * 40, w = acc.winner, weak = [...acc.byLeague].filter((x) => x.n >= 10).sort((a, b) => a.winner - b.winner).slice(0, 3), misses = res.filter((r) => r.graded && !r.right && r.why).slice(0, 12);
  app.innerHTML = `${subHead("#/more", "OUR RECORD", "Results and accuracy")}
    ${jumpTabs([["rc-score", "Scorecard"], ["rc-saved", "Saved before start"], ["rc-all", "All series"]])}
    <section class="mp-sec" id="rc-score"><div class="rc-hero"><svg role="img" aria-label="${pct(w)} of series winners called" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--surface-2)" stroke-width="10"/><circle cx="48" cy="48" r="40" fill="none" stroke="var(--ok)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(w * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 48 48)"/><text x="48" y="54" text-anchor="middle" font-family="Space Grotesk, sans-serif" font-size="20" font-weight="700" fill="currentColor">${pct(w)}</text></svg><span><b>Series winners called</b><span class="small">Across ${acc.graded.toLocaleString("en-US")} graded series in the walk-forward replay.</span></span></div>
      <div class="rc-tiles"><div><b class="num">${acc.graded.toLocaleString("en-US")}</b><span>series graded</span></div><div><b class="num">${acc.brier}</b><span>series Brier</span></div><div><b class="num">${acc.games.brierDraft ?? acc.games.brierTeam}</b><span>single-game Brier</span></div></div>
      <p class="small muted">Brier score: 0 is perfect, 0.25 is a coin flip. Lower is better.</p>
      <h2 class="sec-h">When we say 70%, does it happen 70%?</h2><div class="card rc-cal">${acc.calibration.map((b) => `<div><b>${b.lo}–${b.hi - 1}%</b><span class="bars"><span><i class="s" style="width:${(b.lo + b.hi) / 2}%"></i></span><span><i class="h" style="width:${Math.round(b.rate * 100)}%"></i></span></span><b class="h">${pct(b.rate)}</b></div>`).join("")}<div class="leg small"><span><i class="s"></i>We said</span><span><i class="h"></i>It happened</span></div></div>
      <h2 class="sec-h">Where we are weak</h2><div class="card rc-weak">${weak.map((x) => `<div><b>${esc(x.league)}</b><span class="bar"><i style="width:${Math.round(x.winner * 100)}%"></i></span><b class="num">${pct(x.winner)}</b></div>`).join("")}<p class="small">Winners called, by league (10+ series). Picks in these leagues carry a warning.</p></div>
      <h2 class="sec-h">Does the draft help?</h2><div class="card"><div class="rc-tiles two"><div><b class="num">${acc.games.brierTeam}</b><span>Teams only</span></div><div><b class="num">${acc.games.brierDraft}</b><span>Teams + draft</span></div></div><p class="small">Single-game Brier. The draft adds little on top of team strength, so draft numbers are a guide, not a prediction.</p></div>
      ${misses.length ? `<h2 class="sec-h">Recent misses, and why</h2>${misses.map(resultRow).join("")}` : ""}</section>
    <section class="mp-sec" id="rc-saved"><h2 class="sec-h">Saved before the match</h2><div class="card">${pt?.graded ? `<p><b class="num" style="font-size:24px">${pct(pt.winner)}</b> of ${pt.graded} winners right.</p>` : `<p class="small">No saved match has finished yet (${pt?.waiting || 0} waiting).</p>`}<p class="small muted">The honest test: the last projection before each match, frozen and graded after.</p></div></section>
    <section class="mp-sec" id="rc-all"><h2 class="sec-h">All series</h2>${res.slice(0, 80).map(resultRow).join("")}</section>`;
}

async function vPicks() {
  const [{ picks, note }, up] = await Promise.all([load("picks.json"), load("upcoming.json").catch(() => [])]);
  const now = Date.now(), byM = new Map(); for (const p of picks.filter((x) => Date.parse(x.date) > now - 3600000)) { (byM.get(p.id) || byM.set(p.id, []).get(p.id)).push(p); }
  S.pkf ||= "all"; const groups = [...byM.entries()].map(([id, ps]) => ({ id, ps, m: up.find((u) => u.id === id), top: Math.max(...ps.map((p) => p.p)) }));
  const nPick = groups.filter((g) => g.ps.some((p) => !p.noPick)).length, nClose = groups.filter((g) => g.ps.every((p) => p.noPick)).length;
  const shown = groups.filter((g) => S.pkf === "all" || (S.pkf === "pick" ? g.ps.some((p) => !p.noPick) : g.ps.every((p) => p.noPick)));
  const meter = (p) => { const n = p >= 0.8 ? 5 : p >= 0.7 ? 4 : p >= 0.65 ? 3 : p >= 0.6 ? 2 : 1; return `<span class="pk-meter" role="img" aria-label="Strength ${n} of 5">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? (p >= 0.7 ? "g" : p >= 0.6 ? "b" : "s") : ""}"></i>`).join("")}</span>`; };
  const card = (g) => { const m = g.m, best = g.ps.filter((p) => !p.noPick).sort((a, b) => b.p - a.p)[0], lean = g.ps.sort((a, b) => b.p - a.p)[0];
    return `<section class="pk-card"><div class="pk-h"><span>${esc(lean.league)}${m ? ` · ${esc(m.stage)} · BO${m.bo}` : ""}</span><span>${esc(when(lean.date))}</span></div>
      ${m ? `<div class="pk-t"><span>${tb(m.a, 40)}<b>${esc(sn(m.a))}</b></span><span class="muted">VS</span><span><b>${esc(sn(m.b))}</b>${tb(m.b, 40)}</span></div>` : `<div class="pk-t"><b>${esc(lean.game)}</b></div>`}
      <div class="pk-box">${best ? `<div class="spread"><span class="pk-tag ${best.p >= 0.7 ? "g" : "b"}">${best.p >= 0.7 ? "STRONG" : "LEAN"} · PICK</span>${meter(best.p)}</div><span>${esc(best.pick)} <b style="color:var(--accent-ink)">${pct(best.p)}</b>.</span>` : `<div class="spread"><span class="pk-tag s">TOO CLOSE · NO PICK</span>${meter(lean.p)}</div><span>We lean <b style="color:var(--accent-ink)">${esc(lean.pick.replace(/ to win the series$/, ""))} ${pct(lean.p)}</b>, which is close to a coin flip. We only call a pick at 60% or more.</span>`}</div>
      <div class="pk-lines"><span class="lbl">OUR LINES (FAIR ODDS)</span>${g.ps.map((p) => `<div><span>${esc(p.pick)}</span><b>${pct(p.p)}</b><b class="o">${dec(p.p)}</b></div>`).join("")}</div>
      <div class="pk-f"><span>Locks when the match starts.</span><a href="#/match/${esc(g.id)}">Open match</a></div></section>`; };
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Picks")}
    <div class="pk-info"><span class="mo-ic">${RICON("Roam", 20)}</span><span class="small">Our own lines, saved before the match starts and never changed after. No sportsbook data is used.</span></div>
    <div class="filters" role="group" aria-label="Show">${[["all", `All · ${groups.length}`], ["pick", `Picks 60%+ · ${nPick}`], ["close", `Too close · ${nClose}`]].map(([k, l]) => `<button class="fbtn" type="button" data-pkf="${k}" aria-pressed="${S.pkf === k}">${l}</button>`).join("")}</div>
    ${shown.map(card).join("") || `<p class="empty">No scheduled match in this group.</p>`}
    <h2 class="sec-h">How strong is a pick</h2><div class="mo-list">${[["50–59%", "var(--muted)", "Too close", "Shown for reference. Not counted as a pick."], ["60–69%", "var(--accent-ink)", "Lean", "A real edge, but upsets are common."], ["70%+", "var(--gold)", "Strong", "Clear favourite on rating and form."]].map(([r, c, t, d]) => `<div class="mo-i"><b class="num" style="width:74px;color:${c}">${r}</b><span><b>${t}</b><span class="small muted">${d}</span></span><span></span></div>`).join("")}</div>
    <a class="btn wide" href="#/results">See how past picks did</a><p class="small muted">${esc(note)}</p>`;
  app.querySelectorAll("[data-pkf]").forEach((b) => b.addEventListener("click", () => { S.pkf = b.dataset.pkf; vPicks(); }));
}

// ---------------------------------------------------------------- Counter matrix
// ---------------------------------------------------------------- heroes
const ROLE_IC = { EXP: "M6 18L18 6M13 6h5v5M6 13l5 5", Jungle: "M12 20c-5-2-7-7-6-13 6 0 10 3 11 8M12 20c0-5 2-8 5-10", Mid: "M12 4l8 8-8 8-8-8z", Gold: "M12 5a7 7 0 100 14 7 7 0 000-14zM12 9v6M10 12h4", Roam: "M12 4l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" };
const metaTabs = (on) => `<nav class="subtabs" aria-label="Meta">${[["#/heroes", "Tier list", "heroes"], ["#/leagues", "By league", "leagues"], ["#/matrix", "Counters", "matrix"], ["#/playbook", "Playbook", "playbook"], ["#/patch", "Patch", "patch"]].map(([h, t, k]) => `<a href="${h}"${k === on ? ' aria-current="page"' : k === "patch" ? ' class="hot"' : ""}>${t}</a>`).join("")}</nav>`;
// ---- remaining screens, laid out as the canvas boards (Versus, Events, Library, By league, Counters, Players, Playbook, Patch)
async function vVersus() {
  const teams = await load("teams.json"), qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const st = (S.vs ||= { a: teams.find((t) => t.name === qs.get("a")) || teams[0], b: teams.find((t) => t.name === qs.get("b")) || teams[1], bo: +(qs.get("bo") || 5) });
  if (qs.get("a")) st.a = teams.find((t) => t.name === qs.get("a")) || st.a; if (qs.get("b")) st.b = teams.find((t) => t.name === qs.get("b")) || st.b; if (qs.get("bo")) st.bo = +qs.get("bo");
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Versus")}<p class="small muted">Any team against any team. Pick two and a series length.</p>
    <div class="vs-pick2"><div class="vs-t a">${tb(st.a.name, 40)}${pickBox("va", "Change team", sn(st.a.name))}</div><button class="ds-ib" type="button" id="vs-swap" aria-label="Swap sides">⇄</button><div class="vs-t b">${tb(st.b.name, 40)}${pickBox("vb", "Change team", sn(st.b.name))}</div></div>
    <div class="filters" role="group" aria-label="Series length">${[1, 3, 5, 7].map((n) => `<button class="fbtn" type="button" data-bo="${n}" aria-pressed="${st.bo === n}">Best of ${n}</button>`).join("")}</div><div id="vs-out"></div>`;
  const draw = async () => { const out = document.getElementById("vs-out"); if (!st.a || !st.b || st.a === st.b) { out.innerHTML = `<p class="empty">Pick two different teams.</p>`; return; }
    const [A, B] = await Promise.all([load(`teams/${sid(st.a.name)}.json`).catch(() => null), load(`teams/${sid(st.b.name)}.json`).catch(() => null)]); if (!A || !B) { out.innerHTML = `<p class="empty">One of these teams has too few games.</p>`; return; }
    const pg = lg(A.rating - B.rating), s = series(pg, st.bo), sc = Object.entries(s.scores).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => { const [x, y] = k.split("-"); return `${Math.max(x, y)}-${Math.min(x, y)}`; });
    const exp = Object.entries(s.scores).reduce((t, [k, v]) => t + k.split("-").reduce((x, y) => +x + +y, 0) * v, 0);
    const r = (o) => (o && o.n ? o.w / o.n : null), row = (label, a, b, f, hiBetter = true) => { const better = a == null || b == null ? 0 : (a > b) === hiBetter ? 1 : a === b ? 0 : 2; return `<div class="tape"><b class="${better === 1 ? "hi" : ""}">${a == null ? "-" : f(a)}</b><span>${label}</span><b class="${better === 2 ? "hi" : ""}">${b == null ? "-" : f(b)}</b></div>`; };
    const shared = A.profile.comfort.filter((c) => B.profile.comfort.some((d) => d.h === c.h)).slice(0, 4);
    out.innerHTML = `<section class="vs-card"><div class="spread"><b class="num b">${pct(s.win)}</b><span class="lbl">SERIES WIN CHANCE</span><b class="num r">${pct(1 - s.win)}</b></div><div class="mc-bar"><span style="width:${(s.win * 100).toFixed(1)}%"></span><span style="width:${((1 - s.win) * 100).toFixed(1)}%"></span></div>
        <div class="mc-chips"><span>Single game: ${esc(pg >= 0.5 ? A.name : B.name)} ${pct(Math.max(pg, 1 - pg))}</span>${st.bo > 1 ? `<span>About ${f1(exp)} maps</span><span>Most likely ${sc.join(" or ")}</span>` : ""}</div></section>
      <h2 class="sec-h">Tale of the tape</h2><div class="card">${row("Rating", A.elo, B.elo, (x) => x)}${row("Series record", r({ w: A.series[0], n: A.series[0] + A.series[1] }), r({ w: B.series[0], n: B.series[0] + B.series[1] }), (x) => pct(x))}${row("First pick (blue)", r(A.profile.side.blue), r(B.profile.side.blue), (x) => pct(x))}${row("Second pick (red)", r(A.profile.side.red), r(B.profile.side.red), (x) => pct(x))}${row("Games under 14 min", r(A.profile.early), r(B.profile.early), (x) => pct(x))}${row("Games 18+ min", r(A.profile.late), r(B.profile.late), (x) => pct(x))}
        <p class="small muted">The brighter number is the better one.${A.matches.some((m) => m.opp === B.name) ? "" : " No head-to-head meetings in our data."}</p></div>
      ${shared.length ? `<h2 class="sec-h">Shared heroes to fight over</h2><div class="card hr-list">${shared.map((c) => { const d = B.profile.comfort.find((x) => x.h === c.h); return `<div class="hr-row">${hpic(c.h, 40)}<span><b>${esc(cap(c.h))}</b><span class="small muted">${esc(A.name)} ${c.n} games (${pct(c.wr)}) · ${esc(B.name)} ${d.n} games (${pct(d.wr)})</span></span></div>`; }).join("")}</div>` : ""}
      <a class="mc-cta" href="#/sim?a=${encodeURIComponent(A.name)}&b=${encodeURIComponent(B.name)}">DRAFT THIS MATCHUP</a>
      <details class="ds-more" style="margin-top:12px"><summary><span><b>Full breakdown</b><span class="small muted">Exact scores, scenarios, bans, splits and lineups.</span></span></summary><div class="ds-body">${await matchup(A.name, B.name, st.bo)}</div></details>`; };
  bindPick(document.getElementById("va"), teams, (t) => `${t.name} (${t.region})`, (t) => { st.a = t; vVersus(); });
  bindPick(document.getElementById("vb"), teams, (t) => `${t.name} (${t.region})`, (t) => { st.b = t; vVersus(); });
  document.getElementById("vs-swap").addEventListener("click", () => { [st.a, st.b] = [st.b, st.a]; vVersus(); });
  app.querySelectorAll("[data-bo]").forEach((b) => b.addEventListener("click", () => { st.bo = +b.dataset.bo; vVersus(); }));
  draw();
}

async function vM8() {
  const [M, up] = await Promise.all([load("m8.json").catch(() => null), load("upcoming.json").catch(() => [])]);
  if (!M) { app.innerHTML = `${subHead("#/matches", "MATCHES", "Events")}<p class="empty">The M8 field is not available yet.</p>`; return; }
  const days = Math.max(0, Math.ceil((Date.parse("2026-12-17T00:00:00+07:00") - Date.now()) / 86400000)), wild = [...M.wildcard].sort((a, b) => (b.pAdvance || 0) - (a.pAdvance || 0)), main = [...M.main].sort((a, b) => (b.elo || 0) - (a.elo || 0));
  const flat = wild.length && Math.max(...wild.map((t) => t.pAdvance || 0)) - Math.min(...wild.filter((t) => t.team).map((t) => t.pAdvance || 0)) < 0.12;
  const trow = (t, w) => `<div class="ev-row">${t.team ? tb(t.team, 36) : `<span class="tb" style="width:36px;height:36px">?</span>`}<span><b>${t.team ? (t.id ? `<a href="#/team/${esc(t.id)}">${esc(t.team)}</a>` : esc(t.team)) : `<span class="muted">To be decided</span>`}</b>${w ? `<span class="hr-bar"><i style="width:${Math.round((t.pAdvance || 0) * 100)}%"></i></span>` : `<span class="small muted">via ${esc(t.via)}</span>`}</span><b class="num">${w ? pct(t.pAdvance || 0) : t.elo ?? "-"}</b></div>`;
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Events")}
    <div class="filters" role="group" aria-label="Event"><button class="fbtn" type="button" aria-pressed="true">M8 World Championship</button></div>
    <section class="ev-hero"><div><span class="m8b-ic">🏆</span><span><b>M8 World Championship</b><span class="small">Wildcard: Bangkok, from Dec 17, 2026</span><span class="small">Main stage: Türkiye, January 2027</span></span></div><div class="ev-cd"><span class="small muted">Wildcard starts in</span><b class="num">${days} days</b></div></section>
    ${jumpTabs([["ev-ch", "Chances"], ["ev-field", "Field"], ["ev-also", "Schedule"]])}
    <section class="mp-sec" id="ev-ch"><h2 class="sec-h">Wildcard · chance to advance</h2><div class="card">${wild.map((t) => trow(t, true)).join("")}${flat ? `<p class="small"><b style="color:var(--gold)">Low confidence:</b> these teams come from regions that rarely play each other, so the chances are nearly flat. Shown with a warning instead of as a pick.</p>` : ""}<p class="small muted">${esc(M.format || "")} 20,000 simulated Wildcards.</p></div></section>
    <section class="mp-sec" id="ev-field"><h2 class="sec-h">Seeded into the main stage</h2><div class="card">${main.map((t) => trow(t, false)).join("")}<p class="small muted">Ratings are earned inside each league (1500 = that league's average), so they do not compare across regions. Compare any two in <a href="#/versus">Versus</a>.</p></div></section>
    <section class="mp-sec" id="ev-also"><h2 class="sec-h">Also running</h2><div class="mo-list">${up.map((m) => `<a class="mo-i" href="#/match/${esc(m.id)}"><span class="mo-ic">⚔️</span><span><b>${esc(m.league)} · ${esc(m.stage)}</b><span class="small muted">${esc(m.a)} vs ${esc(m.b)} · ${esc(when(m.date))}</span></span><span aria-hidden="true">›</span></a>`).join("") || `<p class="small muted" style="padding:12px">No other scheduled matches.</p>`}</div></section>`;
}

async function vLibrary() {
  const [idx, D, teams] = await Promise.all([load("library.json"), load("draft.json"), load("teams.json")]); S.lib ||= { league: idx[0]?.id, q: "" };
  const h0 = location.hash, rows = await load(`library/${S.lib.league}.json`), RT = Object.fromEntries(teams.map((t) => [t.name, t.rating])); if (location.hash !== h0) return;
  const sh = (rec, k) => (rec ? logit((rec[1] + k) / (rec[0] + 2 * k)) : 0), pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`), R5 = ["EXP", "JGL", "MID", "GLD", "ROM"];
  const review = (h1, h2, a, b) => { const hero = h1.reduce((x, h) => x + sh(D.heroes[h], 4), 0) - h2.reduce((x, h) => x + sh(D.heroes[h], 4), 0); let syn = 0, cnt = 0, top = [];
    for (const [hs, sg] of [[h1, 1], [h2, -1]]) for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const v = sh(D.pairs[pk(hs[i], hs[j])], 3); syn += sg * v; if (Math.abs(v) > 0.3) top.push([sg * v * D.scale.syn, `${cap(hs[i])} + ${cap(hs[j])} ${v > 0 ? "work together" : "clash"}`]); }
    for (const x of h1) for (const y of h2) { const v = sh(D.vs[`${x}>${y}`], 3); cnt += v; if (Math.abs(v) > 0.4) top.push([v * D.scale.cnt, `${cap(v > 0 ? x : y)} has the edge on ${cap(v > 0 ? y : x)}`]); }
    const base = (RT[a] ?? 0) - (RT[b] ?? 0), edge = D.wd * (hero * D.scale.hero + syn * D.scale.syn + cnt * D.scale.cnt); return { before: lg(base), after: lg(base + edge), notes: top.sort((p, q) => Math.abs(q[0]) - Math.abs(p[0])).slice(0, 3) }; };
  const draw = () => { const q = S.lib.q.trim().toLowerCase(), f = rows.filter((r) => !q || r[2].toLowerCase().includes(q) || r[3].toLowerCase().includes(q) || [...r[10], ...r[11]].some((h) => h.includes(q))).slice(0, 30);
    document.getElementById("lib").innerHTML = f.map((r) => { const [date, stage, a, b, bo, n, w, side1, map, len, h1, h2, b1, b2] = r, aBlue = side1 !== "red", blueWon = (w === 1) === aBlue, rv = h1?.length === 5 && h2?.length === 5 ? review(h1, h2, a, b) : null;
      const side = (t, hs, bs, sd, won) => `<div class="lb-side ${sd}"><div class="spread"><b>${tb(t, 20)} ${esc(t)} <span class="small muted">${sd === "blue" ? "first pick" : sd === "red" ? "second pick" : ""}</span></b>${won ? `<span class="small up">WON</span>` : ""}</div><div class="ld-picks">${hs.map((h, i) => `<span class="ld-p">${hpic(h, 34)}<span class="small">${esc(cap(h))}</span><span class="muted small">${R5[i]}</span></span>`).join("")}</div><div class="lb-bans"><span class="lbl">BANS</span>${bs.map((h) => `<span class="lb-b">${hpic(h, 22)}</span>`).join("")}</div></div>`;
      return `<section class="pk-card"><div class="pk-h"><span>${esc(stage || "")} · GAME ${n}${len ? ` · ${esc(len)}` : ""}</span><span>${side1 ? (blueWon ? "BLUE WON" : "RED WON") : esc(date || "")}</span></div>
        ${side(a, h1, b1, aBlue ? "blue" : "red", w === 1)}${side(b, h2, b2, aBlue ? "red" : "blue", w === 2)}
        ${rv ? `<div class="lb-rev"><span class="lbl">DRAFT REVIEW</span><div class="spread small"><span>Before the draft: <b>${pct(rv.before)}</b> ${esc(a)}</span><span>After: <b>${pct(rv.after)}</b></span></div><div class="mc-bar"><span style="width:${(rv.after * 100).toFixed(1)}%"></span><span style="width:${((1 - rv.after) * 100).toFixed(1)}%"></span></div>${rv.notes.map(([v, t]) => `<div class="small"><b class="${v > 0 ? "up" : "down"}">${v > 0 ? "▲" : "▼"}</b> ${esc(t)}</div>`).join("")}</div>` : ""}</section>`; }).join("") || `<p class="empty">No game matches.</p>`; };
  app.innerHTML = `${subHead("#/sim", "DRAFT", "Draft library")}<input class="field" id="lib-q" type="search" placeholder="Team or hero" aria-label="Search a team or hero" value="${esc(S.lib.q)}">
    <div class="filters" role="group" aria-label="League" style="margin-top:8px">${idx.map((x) => `<button class="fbtn" type="button" data-lg="${esc(x.id)}" aria-pressed="${x.id === S.lib.league}">${esc(x.league)}</button>`).join("")}</div><div id="lib"></div>
    <p class="small muted">Source: Liquipedia. Draft review uses our draft model and today's team ratings, as a guide. Liquipedia lists picks by lane, not in draft order.</p>`;
  document.getElementById("lib-q").addEventListener("input", (e) => { S.lib.q = e.target.value; draw(); });
  app.querySelectorAll("[data-lg]").forEach((b) => b.addEventListener("click", () => { S.lib.league = b.dataset.lg; vLibrary(); }));
  draw();
}

async function vLeagues() {
  const [L, H] = await Promise.all([load("leagues.json"), load("heroes.json")]); S.lgm ||= L.leagues[0]?.league; const x = L.leagues.find((y) => y.league === S.lgm) || L.leagues[0];
  if (!x) { app.innerHTML = `${subHead("#/heroes", "META", "By league")}<p class="empty">No league data yet.</p>`; return; }
  const world = Object.fromEntries(H.map((h) => [h.id, h.recent.presence])), bw = x.blue[1] ? x.blue[0] / x.blue[1] : 0.5;
  const local = H.map((h) => ({ h, lp: (h.byLeague || []).find((b) => b.league === x.league) })).filter((r) => r.lp && r.lp.pres - r.h.recent.presence >= 0.15).sort((a, b) => (b.lp.pres - b.h.recent.presence) - (a.lp.pres - a.h.recent.presence)).slice(0, 4);
  app.innerHTML = `${subHead("#/heroes", "META", "By league")}${metaTabs("leagues")}
    <div class="filters" role="group" aria-label="League" style="margin-top:10px">${L.leagues.map((y) => `<button class="fbtn" type="button" data-lgm="${esc(y.league)}" aria-pressed="${y.league === x.league}">${esc(y.league)}</button>`).join("")}</div>
    <section class="vs-card"><span class="lbl">WHICH SIDE WINS IN ${esc(x.league.toUpperCase())}</span><div class="spread small"><span>First pick (blue) <b class="num b">${pct(bw)}</b></span><span><b class="num r">${pct(1 - bw)}</b> Second pick (red)</span></div><div class="mc-bar"><span style="width:${(bw * 100).toFixed(1)}%"></span><span style="width:${((1 - bw) * 100).toFixed(1)}%"></span></div>
      <div class="rc-tiles"><div><b class="num">${x.games}</b><span>games</span></div><div><b class="num">${x.medianMin ?? "-"}</b><span>median minutes</span></div><div><b class="num">${esc(cap(x.b1[0]?.h || "-"))}</b><span>usual first ban</span></div></div></section>
    <h2 class="sec-h">Most contested here</h2><div class="card hr-list">${x.top.slice(0, 8).map((h, i) => { const d = h.pres - (world[h.h] || 0); return `<a class="hr-row" href="#/hero/${encodeURIComponent(h.h)}"><b class="num" style="width:22px">${i + 1}</b>${hpic(h.h, 40)}<span><b>${esc(cap(h.h))} <span class="small ${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${Math.round(d * 100)}</span></b><span class="pb-bar"><span style="width:${Math.round((h.p / (h.p + h.b || 1)) * 100)}%"></span><span></span></span></span><b class="num">${pct(h.pres)}</b></a>`; }).join("")}<p class="small muted" style="padding:0 12px 10px">Silver is picks, red is bans. The small number is the gap to the worldwide presence.</p></div>
    <h2 class="sec-h">Usual opening bans</h2><div class="card lg-bans">${x.b1.map((b) => `<span>${hpic(b.h, 44)}<b class="small">${esc(cap(b.h))}</b><span class="small muted">${pct(b.n / (x.blue[1] || x.games))}</span></span>`).join("")}</div>
    ${local.length ? `<h2 class="sec-h">Only big here</h2><div class="card hr-list">${local.map((r) => `<div class="hr-row">${hpic(r.h.id, 40)}<span><b>${esc(cap(r.h.id))}</b><span class="small muted">${pct(r.lp.pres)} here vs ${pct(r.h.recent.presence)} worldwide</span></span></div>`).join("")}</div>` : ""}
    <p class="small muted">${esc(L.note)}</p>`;
  app.querySelectorAll("[data-lgm]").forEach((b) => b.addEventListener("click", () => { S.lgm = b.dataset.lgm; vLeagues(); }));
}

async function vMatrix() {
  const H = await load("heroes.json"), ids = H.map((h) => h.id).sort(); S.mx ||= { hero: [...H].sort((a, b) => (b.recent.wr ?? 0) * (b.recent.picks >= 40) - (a.recent.wr ?? 0) * (a.recent.picks >= 40))[0]?.id, tab: "counters" };
  const h = H.find((x) => x.id === S.mx.hero) || H[0], usual = Object.fromEntries(H.map((x) => [x.id, x.wr]));
  const beats = h.counters.slice(0, 6).map((c) => ({ id: c.vs, their: 1 - c.wr, n: c.n, usual: usual[c.vs] ?? 0.5 }));
  app.innerHTML = `${subHead("#/heroes", "META", "Counters and combos")}${metaTabs("matrix")}
    <nav class="seg" aria-label="View"><a href="#/matrix" ${S.mx.tab === "counters" ? 'aria-current="page"' : ""} data-tab="counters">Counters</a><a href="#/matrix" ${S.mx.tab === "combos" ? 'aria-current="page"' : ""} data-tab="combos">Combos</a></nav>
    <div class="cx-pick">${hpic(h.id, 52)}<span><b>${esc(cap(h.id))}</b><span class="small muted">${h.recent.wr != null ? `${pct(h.recent.wr)} won` : ""} · ${h.recent.picks} recent picks</span></span>${pickBox("mxq", "Change hero", "")}</div>
    ${S.mx.tab === "counters" ? `<h2 class="sec-h">${esc(cap(h.id).toUpperCase())} SHUTS DOWN</h2><div class="card hr-list">${beats.map((r) => `<div class="hr-row">${hpic(r.id, 40)}<span><b>${esc(cap(r.id))}</b><span class="cx-bar"><i style="width:${Math.round(r.their * 100)}%"></i><em style="left:${Math.round(r.usual * 100)}%"></em></span></span><span class="cx-r"><b class="num">${pct(r.their)}</b><span class="small muted">${Math.round(r.n)} games</span></span></div>`).join("") || `<p class="small muted" style="padding:12px">Not enough games.</p>`}<p class="small muted" style="padding:0 12px 10px">Their win rate when ${esc(cap(h.id))} is on the other team. The white mark is their usual win rate.</p></div>
      <h2 class="sec-h">Countered by</h2><div class="card hr-list">${h.counteredBy.slice(0, 5).map((c) => `<div class="hr-row">${hpic(c.vs, 40)}<span><b>${esc(cap(c.vs))}</b><span class="small muted">${Math.round(c.n)} games</span></span><b class="num down">${pct(c.wr)}</b></div>`).join("")}</div>`
    : `<h2 class="sec-h">Combos that win together</h2>${h.combos.slice(0, 5).map((c) => `<div class="cx-combo"><span class="cx-duo">${hpic(h.id, 40)}${hpic(c.with, 40)}</span><span><b>${esc(cap(h.id))} + ${esc(cap(c.with))}</b><span class="small muted">${Math.round(c.n)} games together</span>${c.lift != null ? `<span class="small up">+${Math.round(c.lift * 100)} vs expected</span>` : ""}</span><b class="num" style="color:var(--gold)">${pct(c.wr)}</b></div>`).join("")}
      <h2 class="sec-h">Pairs that hurt each other</h2>${h.combosBad.slice(0, 3).map((c) => `<div class="cx-combo bad"><span class="cx-duo">${hpic(h.id, 40)}${hpic(c.with, 40)}</span><span><b>${esc(cap(h.id))} + ${esc(cap(c.with))}</b><span class="small muted">${Math.round(c.n)} games together</span></span><b class="num down">${pct(c.wr)}</b></div>`).join("")}`}
    <p class="small muted">Pro games, fading by half every 120 days, pulled toward 50% on small samples.</p>`;
  bindPick(document.getElementById("mxq"), ids, (x) => cap(x), (x) => { S.mx.hero = x; vMatrix(); });
  app.querySelectorAll("[data-tab]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); S.mx.tab = a.dataset.tab; vMatrix(); }));
}

async function vPlayers() {
  const P = await load("players.json"), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"]; S.q ||= ""; S.role ||= "";
  const list = P.filter((p) => (!S.role || p.role === S.role) && (!S.q || p.name.toLowerCase().includes(S.q.toLowerCase()) || (p.team || "").toLowerCase().includes(S.q.toLowerCase()))).slice(0, 40);
  const lead = list[0] ? await load(`players/${list[0].id}.json`).catch(() => null) : null;
  const pool = lead ? (lead.s18?.heroes?.length ? lead.s18.heroes.map((x) => ({ h: x.h, n: x.n, wr: x.w / x.n })) : lead.pool).slice(0, 5) : [];
  app.innerHTML = `${subHead("#/teams", "TEAMS", "Players")}<input class="field" id="pq" type="search" placeholder="Player or team" aria-label="Search a player or team" value="${esc(S.q)}">
    <div class="filters" role="group" aria-label="Lane" style="margin-top:8px"><button class="fbtn" type="button" data-pr="" aria-pressed="${!S.role}">All</button>${ROLES.map((r) => `<button class="fbtn" type="button" data-pr="${r}" aria-pressed="${S.role === r}">${r}</button>`).join("")}</div>
    ${lead ? `<section class="pl-card"><a class="pl-top" href="#/player/${esc(lead.id)}">${face(lead.id, lead.name, 52)}<span><b>${esc(lead.name)}</b><span class="small muted">${esc(lead.role)} lane · ${esc(lead.team || "")}</span></span><span class="cx-r"><b class="num" style="color:var(--ok)">${pct(lead.wr)}</b><span class="small muted">won · ${lead.games} games</span></span></a>
      <span class="lbl">HERO POOL</span>${pool.map((x) => `<div class="hr-row">${hpic(x.h, 36)}<span><b>${esc(cap(x.h))}</b><span class="hr-bar"><i style="width:${Math.round(x.wr * 100)}%"></i></span></span><span class="small">${Math.round(x.wr * x.n)}-${x.n - Math.round(x.wr * x.n)}</span>${x.n >= 5 && x.wr >= lead.wr + 0.15 ? `<b class="t-pb" style="font-size:11px;padding:3px 6px;border-radius:6px">Ban it</b>` : ""}</div>`).join("")}
      <span class="small muted">"Ban it" marks a comfort hero with a clearly better record than the player's others.</span></section>` : ""}
    <div class="mo-list" style="margin-top:12px">${list.slice(1).map((p) => `<a class="mo-i" href="#/player/${esc(p.id)}">${face(p.id, p.name, 40)}<span><b>${esc(p.name)}</b><span class="small muted">${esc(p.role)} · ${esc(p.team || "")}</span></span><span class="pl-tops">${p.top.slice(0, 3).map((t) => hpic(t.h, 26)).join("")}</span></a>`).join("") || (lead ? "" : `<p class="empty">No player matches.</p>`)}</div>`;
  document.getElementById("pq").addEventListener("change", (e) => { S.q = e.target.value; vPlayers(); });
  app.querySelectorAll("[data-pr]").forEach((b) => b.addEventListener("click", () => { S.role = b.dataset.pr; vPlayers(); }));
}

async function vPlaybook() {
  const [P, D] = await Promise.all([load("playbook.json"), load("meta.json")]), groups = ["All rules", ...new Set(P.rules.map((r) => r.group))]; S.pb = groups.includes(S.pb) ? S.pb : "All rules";
  const list = P.rules.filter((r) => S.pb === "All rules" || r.group === S.pb), col = (x) => (x.tag === "solid" ? (x.v ?? 0.5) >= 0.5 ? "var(--ok)" : "var(--red-ink)" : "var(--ink)");
  app.innerHTML = `${subHead("#/heroes", "META", "Playbook")}${metaTabs("playbook")}
    <p class="small muted" style="margin-top:10px">What pro drafts actually show, in plain rules you can use. ${P.games.toLocaleString("en-US")} games, patch ${esc(D.patch?.patch || "-")}. <b>SOLID</b>: the 95% range clears the comparison. <b>LEAD</b>: it points that way.</p>
    <div class="filters" role="group" aria-label="Rule group">${groups.map((g) => `<button class="fbtn" type="button" data-pb="${esc(g)}" aria-pressed="${S.pb === g}">${esc(g)}</button>`).join("")}</div>
    ${list.map((r, i) => `<section class="pb-rule${i === 0 ? " lead" : ""}"><div class="spread"><span class="lbl">RULE ${i + 1} · ${esc(r.group.toUpperCase())}</span><b class="pb-tag ${r.tag}">${r.tag === "solid" ? "SOLID" : "LEAD"}</b></div><h2>${esc(r.title)}</h2>
      <div class="pb-stats">${r.stats.map((x) => `<div><b class="num" style="color:${col(x)}">${x.text || pct(x.v)}</b><span>${esc(x.l)}</span></div>`).join("")}</div><p class="small"><b style="color:var(--accent-ink)">Use it:</b> ${esc(r.use)}</p></section>`).join("")}
    ${S.pb === "All rules" ? `<h2 class="sec-h">Game length · median ${P.timing.median} min</h2><div class="tm-sps">${[["Win early", "Games under 13 minutes", "var(--gold)", P.timing.early], ["Win late", "Games of 18+ minutes", "var(--accent)", P.timing.late]].map(([t, d, c, hs]) => `<div class="tm-sp" style="border-left:0;border-top:4px solid ${c}"><b>${t}</b><span class="small muted">${d}</span><span class="pb-heroes">${hs.slice(0, 4).map((x) => `<span>${hpic(x.h, 34)}<span>${esc(cap(x.h))}</span></span>`).join("")}</span></div>`).join("")}</div>` : ""}
    <a class="mc-cta" href="#/sim" style="background:var(--gold);color:#1A1400">TRY THESE RULES IN A DRAFT</a><p class="small muted">${esc(P.cannot)} ${esc(P.note)}</p>`;
  app.querySelectorAll("[data-pb]").forEach((b) => b.addEventListener("click", () => { S.pb = b.dataset.pb; vPlaybook(); }));
}

async function vPatch() {
  const T = await load("patch.json"), tag = (x) => { const d = x.after.rate - x.before.rate; return Math.abs(d) < 0.04 || x.after.n < 20 ? ["HELD UP", ""] : d > 0 ? ["ROSE", "up"] : ["FELL", "down"]; };
  app.innerHTML = `${subHead("#/heroes", "META", "Patch tracker")}${metaTabs("patch")}
    <div class="filters" role="group" aria-label="Patch" style="margin-top:10px">${T.patches.slice(0, 4).map((p, i) => `<button class="fbtn" type="button" aria-pressed="${i === 0}"><b>${esc(p.patch)}</b> <span class="small">${esc(dshort(p.release))}</span></button>`).join("")}</div>
    ${T.watch.length ? `<section class="pt-watch"><span class="lbl">WATCH LIST · ${T.watch.every((x) => !x.picks) ? "NO PRO GAMES YET" : "FEW PRO GAMES"}</span>${T.watch.map((x) => `<div class="pt-w">${hpic(x.h, 48)}<span><b>${esc(cap(x.h))} ${esc(String(x.type).toLowerCase())}</b><span class="small">Our numbers for it are from the old version until 20 pro games are in.</span></span></div><div class="pt-prog"><span><i style="width:${Math.min(100, (x.picks / 20) * 100)}%"></i></span><b class="small">${x.picks} / 20 games</b></div>`).join("")}</section>` : ""}
    ${T.cut ? `<h2 class="sec-h">Did the ${esc(dshort(T.cut.release))} changes work?</h2><div class="card hr-list">${T.changed.map((x) => { const [t, c] = tag(x); return `<a class="hr-row" href="#/hero/${encodeURIComponent(x.h)}">${hpic(x.h, 40)}<span><b>${esc(cap(x.h))}</b><span class="small muted">${pct(x.before.rate)} before → ${pct(x.after.rate)} after (${x.after.n} games)</span></span><b class="pt-tag ${c}">${t}</b></a>`; }).join("") || `<p class="small muted" style="padding:12px">No changed hero has games on both sides yet.</p>`}<p class="small" style="padding:0 12px 10px"><b style="color:var(--accent-ink)">Read:</b> the model follows measured results with a 120-day fade, not the patch notes.</p></div>` : ""}
    <div class="tm-sps" style="margin-top:20px">${[["RISING", "var(--ok)", T.risers], ["FALLING", "var(--red)", T.fallers]].map(([t, c, hs]) => `<div class="tm-sp" style="border-left:0;border-top:4px solid ${c}"><b style="color:${c};letter-spacing:.1em">${t}</b>${hs.slice(0, 4).map((x) => `<a class="pt-m" href="#/hero/${encodeURIComponent(x.h)}">${hpic(x.h, 36)}<span><b>${esc(cap(x.h))}</b><span class="small muted">${pct(x.before.rate)} → ${pct(x.after.rate)}</span></span></a>`).join("")}</div>`).join("")}</div>
    <h2 class="sec-h">Patch timeline</h2><div class="card">${T.patches.map((p) => `<div class="pt-tl"><span><b>${esc(p.patch)}</b><span class="small muted">${esc(dshort(p.release))}</span></span><span class="small">${esc(p.changes.map((c) => `${cap(c.hero)} ${c.type}`).join(", ") || "-")}</span></div>`).join("")}</div>
    <p class="small muted">${esc(T.note)}</p>`;
}

async function vHeroes() {
  const heroes = await load("heroes.json"), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"], meta = await load("meta.json");
  const tile = (h) => { const n = h.recent.picks + h.recent.bans || 1;
    return `<a class="htile" href="#/hero/${encodeURIComponent(h.id)}"><span class="r1">${heroImg(h.id, 52) || `<span class="hph" style="width:52px;height:52px;display:grid;place-items:center;background:var(--page);font-weight:700">${esc(cap(h.id).slice(0, 2))}</span>`}<span><span class="num">${pct(h.recent.presence)}</span><br><span class="lbl">PRESENCE</span></span></span>
      <span><span class="nm">${esc(cap(h.id))}</span><br><span class="ln">${esc(h.roles.slice(0, 2).map((r) => r.r).join(" / "))}</span></span>
      <span class="pb-bar"><span style="width:${Math.round((h.recent.picks / n) * 100)}%"></span><span></span></span><span class="pb-n"><span>${h.recent.picks} picks</span><span>${h.recent.bans} bans</span></span>
      <span class="tags">${h.recent.wr != null ? `<span class="${h.recent.wr >= 0.5 ? "w" : "l"}">${pct(h.recent.wr)} won</span>` : ""}${h.firstPhaseBan != null && h.firstPhaseBan >= 0.6 ? `<span class="pb">priority ban</span>` : ""}${h.flex ? `<span class="fx">flex</span>` : ""}${h.untested ? `<span class="nw">changed, untested</span>` : ""}</span></a>`; };
  const RULE = { S: "Picked or banned in 40% or more of pro games, last 150 days.", A: "20% or more presence.", B: "8% or more presence.", C: "Under 8% presence." };
  app.innerHTML = `<h1>Pro meta</h1>${meta.patch ? `<div class="patchb"><span class="pv">Patch ${esc(meta.patch.patch)} · ${esc(dshort(meta.patch.release))}</span>${meta.patch.changes.map((c) => `<span class="ch ${/buff/i.test(c.type) ? "up" : ""}">${/buff/i.test(c.type) ? "▲" : /nerf/i.test(c.type) ? "▼" : "•"} ${esc(cap(c.hero))} ${esc(c.type.toLowerCase())}</span>`).join("")}</div>` : ""}
    ${metaTabs("heroes")}
    <div class="roles" role="group" aria-label="Lane"><button type="button" data-hr="" aria-pressed="${!S.hrole}">All</button>${ROLES.map((r) => `<button type="button" data-hr="${r}" aria-pressed="${S.hrole === r}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ROLE_IC[r]}"/></svg>${r}</button>`).join("")}</div>
    <input class="field" id="hq" type="search" placeholder="Search a hero" aria-label="Search a hero" value="${esc(S.hq)}" style="margin-top:10px"><div id="hl"></div>
    ${(() => { const sp = heroes.filter((h) => h.ranked && h.ranked.wr >= 53 && h.recent.presence < 0.05).sort((x, y) => y.ranked.wr - x.ranked.wr).slice(0, 8); return sp.length ? `<div class="card" style="margin-top:16px"><h2>Possible surprise picks</h2><p>${sp.map((h) => `${heroChip(h.id)} <span class="muted small">ranked ${f1(h.ranked.wr)}% · pro presence ${pct(h.recent.presence)}</span>`).join(" · ")}</p><p class="small muted">Strong in ranked (all players) but barely picked or banned by pros in the last 150 days. Ranked win rate only loosely follows pro results (correlation about 0.4), so treat these as heroes to watch, not predictions.</p></div>` : ""; })()}
    <p class="small muted" style="margin-top:14px">Pro-play numbers drive the model. Ranked rates on hero pages come from mlbb.io, labelled as ranked. <a href="#/playbook">Playbook ›</a></p>`;
  const draw = () => { const q = S.hq.toLowerCase(), f = heroes.filter((h) => (!q || h.id.includes(q)) && (!S.hrole || h.roles[0]?.r === S.hrole));
    document.getElementById("hl").innerHTML = ["S", "A", "B", "C"].map((t) => { const hs = f.filter((h) => h.tier === t); return hs.length ? `<details class="tblk ${t.toLowerCase()}"${t === "S" || q ? " open" : ""}><summary><span class="tier-k">${t}</span><span class="tier-t"><b>${t} TIER · ${hs.length} ${hs.length === 1 ? "HERO" : "HEROES"}</b><span>${RULE[t]}</span></span></summary><div class="htiles">${hs.slice(0, t === "C" ? 40 : 80).map(tile).join("")}</div></details>` : ""; }).join("") || `<p class="empty">No hero matches.</p>`; };
  document.getElementById("hq").addEventListener("input", (e) => { S.hq = e.target.value; draw(); });
  app.querySelectorAll("[data-hr]").forEach((b) => b.addEventListener("click", () => { S.hrole = b.dataset.hr; app.querySelectorAll("[data-hr]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
}

async function vTeams() {
  const teams = await load("teams.json"), regions = [...new Set(teams.map((t) => t.region))].sort();
  if (!regions.includes(S.rg)) S.rg = regions.includes("PH") ? "PH" : regions[0];
  const list = teams.filter((t) => t.region === S.rg);
  app.innerHTML = `<h1>Power rankings</h1><nav class="seg" aria-label="Show"><a href="#/teams" aria-current="page">Teams</a><a href="#/players">Players</a></nav>
    <div class="regions" role="group" aria-label="Region">${regions.map((r) => `<button type="button" data-rg="${esc(r)}" aria-pressed="${S.rg === r}">${esc(r)}</button>`).join("")}</div>
    ${list.map((t, i) => { const hi = t.elo >= 1500, w = Math.max(4, Math.min(100, Math.round((t.elo - 1300) / 4)));
      return `<a class="prc ${i === 0 ? "top1" : i < 3 ? "top3" : ""}" href="#/team/${esc(t.id)}"><span class="r1"><span class="rk">${i + 1}</span>${tb(t.name, 40)}<span class="who"><b>${esc(t.name)}</b><span>Series ${t.series[0]}-${t.series[1]} · Games ${t.games[0]}-${t.games[1]}</span></span><span class="num${hi ? " hi" : ""}">${t.elo}</span></span>
        <span class="r2"><span class="rbar"><span class="${hi ? "hi" : ""}" style="width:${w}%"></span><i aria-hidden="true"></i></span><span class="sig">${t.comfort.slice(0, 3).map((c) => heroImg(c.h, 30)).join("")}</span></span>
        <span class="sg">Signature: ${esc(t.comfort.slice(0, 3).map((c) => cap(c.h)).join(", ") || "-")}</span></a>`; }).join("")}
    <p class="small muted" style="margin-top:12px">The white mark is 1500, the average team. 100 points is about a 64% single-game edge. Ratings are learned game by game; international events link the regions, and teams seen only there are listed under INTL.</p>`;
  app.querySelectorAll("[data-rg]").forEach((b) => b.addEventListener("click", () => { S.rg = b.dataset.rg; vTeams(); }));
}

// MPL PH career context (Season 16, all-time, M-series, top heroes), from the MPL PH staff stat posts
function careerHtml(c) {
  if (!c) return "";
  const t = (v, l) => `<div><b class="num">${v}</b><span>${l}</span></div>`, a = c.allTime, m = c.mseries, s = c.s16;
  const tiles = [a?.games ? t(a.games, "MPL PH games") : "", a?.wr != null ? t(`${Math.round(a.wr)}%`, a.w != null ? `won · ${a.w}-${a.l}` : "won") : "", a?.kda ? t(f1(a.kda), "career KDA") : "", m?.games ? t(m.games, "M-series games") : "", m?.mvps ? t(m.mvps, "M-series MVPs") : "", m?.wr != null ? t(`${Math.round(m.wr)}%`, "M-series won") : ""].filter(Boolean);
  const s16 = !s ? "" : s.g ? `<p><b>Season 16${s.lane ? ` · ${esc(s.lane)}` : ""}${s.part ? ` (${esc(s.part)})` : ""}:</b> ${s.g} games, ${s.w}-${s.l}, KDA ${f1(s.kda)} (${s.k}/${s.d}/${s.a})${s.gpm ? `, ${Math.round(s.gpm)} gold/min` : ""}${s.dpm ? `, ${Math.round(s.dpm).toLocaleString("en-US")} damage/min` : ""}${s.mvps != null ? `, ${s.mvps} game MVPs` : ""}${s.turtles != null ? `, ${s.turtles} turtles and ${s.lords} Lords` : ""}.</p>`
    : s.kda ? `<p><b>Season 16:</b> KDA ${f1(s.kda)} (${s.k}/${s.d}/${s.a}), among the league's top 20${s.mvps != null ? `; ${s.mvps} game MVPs` : ""}.</p>` : s.mvps != null ? `<p><b>Season 16:</b> ${s.mvps} game MVPs.</p>` : "";
  const heroes = c.heroes?.length ? `<div class="tags" style="margin-top:6px">${c.heroes.map((h) => `<span class="hchip">${esc(h.h)} ${h.w}-${h.l}</span>`).join("")}</div><p class="small muted">Top heroes in MPL PH, all-time.</p>` : "";
  return `<h2 class="sec-h">MPL PH career</h2><div class="card">${tiles.length ? `<div class="ps-kpi" style="margin-top:0">${tiles.join("")}</div>` : ""}${s16}${a?.debut ? `<p class="small">Debut ${esc(a.debut)}${a.teams ? ` · ${esc(a.teams)}` : ""}${a.results ? ` · ${esc(a.results)}` : ""}</p>` : ""}${heroes}<p class="small muted">From the stat posts of an MPL PH staff member in the MLBB PH News Events and Tournaments group. All-time covers Seasons 1 to 16; M-series covers M1 to M6.</p></div>`;
}
async function vPlayer(id) {
  const p = await load(`players/${id}.json`), o = p.official, s = p.s18, sh = p.shares;
  const recs = s?.heroes?.length ? s.heroes.map((x) => ({ h: x.h, n: x.n, w: x.w, wr: x.w / x.n })) : (p.pool || []).map((x) => ({ h: x.h, n: x.n, w: Math.round(x.wr * x.n), wr: x.wr }));
  const tile = (v, l, c = "") => `<div><b class="num"${c ? ` style="color:${c}"` : ""}>${v}</b><span>${l}</span></div>`;
  const row = (x) => `<a class="hr-row${x.n < 3 ? " thin" : ""}" href="#/hero/${encodeURIComponent(x.h)}">${hpic(x.h, 40)}<span><b>${esc(cap(x.h))}</b><span class="small muted">${x.n} games</span></span><span class="hr-bar"><i style="width:${Math.round(x.wr * 100)}%"></i></span><b class="num" style="width:56px">${x.w}-${x.n - x.w}</b></a>`;
  app.innerHTML = `${subHead("#/players", `PLAYERS · ${sn(p.team || "")}`, p.name)}
    <section class="tm-hero"><div class="tm-top">${face(p.id, p.name, 72)}<span class="tm-r"><span class="lbl">${esc((p.role || "").toUpperCase())} · ${esc(p.team || "")}</span><b class="num" style="font-size:28px">${esc(p.name)}</b>${p.arch ? `<span class="tags" style="margin-top:4px">${p.arch.labels.map((a) => `<span class="fx">${esc(a)}</span>`).join("")}</span>` : ""}</span></div>
      <div class="hr-stats">${tile(p.games, "career games")}${tile(pct(p.wr), "won", "var(--ok)")}${tile(p.mvp || 0, "series MVP", "var(--gold)")}${tile(o ? f1(o.kda) : s ? pct(s.kp) : "-", o ? "official KDA" : "kill part.")}</div></section>
    ${s ? `<h2 class="sec-h">Season ${esc((s.season || "S18").replace("S", ""))} · ${esc(s.league)}</h2><div class="hr-stats">${tile(`${s.wins}-${s.games - s.wins}`, "games")}${tile(pct(s.kp), "kill part.")}${tile(s.gpm || "-", "gold / min", "var(--gold)")}${tile(s.dmgShare != null ? pct(s.dmgShare) : pct(s.goldShare), s.dmgShare != null ? "team damage" : "team gold")}</div>
      <p class="small muted" style="margin-top:6px">${f1(s.kills)} / ${f1(s.deaths)} / ${f1(s.assists)} per game${s.goldShare != null ? ` · ${pct(s.goldShare)} of team gold` : ""}${s.dpm ? ` · ${s.dpm} damage per minute` : ""}. ${s.league === "MPL MENA" ? "From the MLBB Esports MENA official scoreboard graphics; heroes and wins from Liquipedia." : "From the MLBBHub scoreboards (official stats feed), checked against Liquipedia and the MPL PH site; wins from Liquipedia."}</p>` : ""}
    ${recs.length ? `<h2 class="sec-h">Hero records${s ? " (games this player actually played)" : ""}</h2><div class="card hr-list">${recs.slice(0, 12).map(row).join("")}</div>` : ""}
    ${o ? `<h2 class="sec-h">Official ${esc(o.league)} stats</h2><div class="hr-stats">${tile(f1(o.kda), "KDA")}${tile(f1(o.kills), "kills / game")}${tile(f1(o.deaths), "deaths / game")}${tile(f1(o.assists), "assists / game")}</div>${o.kp ? `<p class="small muted" style="margin-top:6px">Kill participation ${f1(o.kp)}%. Season stats from the league site.</p>` : ""}${o.pool?.length ? `<div class="card hr-list" style="margin-top:8px">${o.pool.slice(0, 8).map((x) => row({ h: x.h, n: x.n, w: Math.round(x.wr * x.n), wr: x.wr })).join("")}</div><p class="small muted">Official hero pool, ${esc(o.league)} S${esc(o.season || "")}.</p>` : ""}` : ""}
    ${!s && sh ? `<h2 class="sec-h">Share of team · MPL PH S18</h2><div class="hr-stats">${tile(pct(sh.dmgShare), "hero damage")}${tile(pct(sh.goldShare), "gold")}${tile(pct(sh.kp), "kill part.")}${tile(pct(sh.takenShare), "damage taken")}</div>` : ""}
    ${p.leaders?.length ? `<h2 class="sec-h">MPL KH S11 leaderboards</h2><div class="hr-stats">${p.leaders.sort((a, b) => a.rank - b.rank).slice(0, 4).map((x) => tile(`#${x.rank}`, `${esc(x.stat)} · ${x.value.toLocaleString("en-US")}`, "var(--gold)")).join("")}</div><p class="small muted" style="margin-top:6px">Regular-season top-10 lists from the official MPL Cambodia page.</p>` : ""}
    ${careerHtml(p.career)}
    ${p.signature?.length ? `<h2 class="sec-h">Signature heroes</h2><div class="mp-picks">${p.signature.slice(0, 3).map((x) => `<a class="mp-pick" href="#/hero/${encodeURIComponent(x.h)}">${hpic(x.h, 48)}<b>${esc(cap(x.h))}</b><span>${x.n} games · <em style="color:var(--gold)">${pct(x.wr)}</em></span></a>`).join("")}</div>` : ""}
    ${p.teams?.length ? `<h2 class="sec-h">Teams</h2><div class="mo-list">${p.teams.map((t) => `<div class="mo-i">${tb(t.t, 32)}<span><b>${esc(t.t)}</b><span class="small muted">${t.n} games</span></span><span></span></div>`).join("")}</div>` : ""}
    <p class="small muted">Career heroes are credited from the player's lane pick in each game, using the lineup listed for that season.</p>`;
}
// ---------------------------------------------------------------- M8 World Championship: field and Wildcard
// ---------------------------------------------------------------- picks, more, results
async function vMore() {
  const acc = await load("accuracy.json").catch(() => null), ic = (d) => `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const I = { chart: "M4 20V10M10 20V4M16 20v-7M22 20H2", star: "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z", cup: "M7 4h10v5a5 5 0 01-10 0zM12 14v4M8 20h8M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3", vs: "M5 19L19 5M14 5h5v5M5 5l14 14M5 10V5h5", grid: "M5 5h6v6H5zM13 13h6v6h-6zM13 5h6v6h-6zM5 13h6v6H5z", book: "M6 4h11a2 2 0 012 2v14H8a2 2 0 01-2-2zM10 9h5M10 13h5", lib: "M4 5h4v14H4zM10 5h4v14h-4zM16 6l3.5-1 3 13.5-3.5 1z", swap: "M7 7h13l-4-4M17 17H4l4 4", map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z", patch: "M4 14l10-10 6 6-10 10H4zM9 9l6 6", user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0", gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.5-2 3.4-2.3-.9a7 7 0 01-2 1.2L14 21h-4l-.4-2.6a7 7 0 01-2-1.2l-2.3.9-2-3.4 2-1.5A7 7 0 015 12", link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1", ball: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" };
  const groups = [
    ["Predictions", [["#/picks", "Picks", "Our own lines for scheduled matches.", I.star], ["#/m8", "M8 World Championship", "The field and each Wildcard team's chance.", I.cup], ["#/versus", "Versus", "Any team against any team, best of 1 to 7.", I.vs]]],
    ["Draft room", [["#/sim", "Draft simulator", "Live draft with suggestions and win chance.", I.grid], ["#/playbook", "Playbook", "Plain rules from pro games, with how sure we are.", I.book], ["#/library", "Draft library", "Every pro game with both drafts.", I.lib], ["#/matrix", "Counter matrix", "Who each hero beats and loses to.", I.swap], ["#/leagues", "Meta by league", "Contested heroes and openers per league.", I.map], ["#/patch", "Patch tracker", "Changed heroes, risers and fallers.", I.patch], ["#/players", "Players", "Every pro player, pools and stats.", I.user]]],
    ["About", [["#/how", "How it works", "The model, the learning and the limits.", I.gear], ["#/sources", "Data sources", "Where every number comes from.", I.link]]],
    ["Switch sport", [["../nba/", "NBA", "Games, picks and players.", I.ball], ["../fiba/", "FIBA", "National teams and club competitions.", I.ball]]]];
  app.innerHTML = `<h1>More</h1>
    <a class="mo-rec" href="#/results"><span><b class="lbl">OUR RECORD</b><span>Results and accuracy</span></span>${acc ? `<span class="mo-stats"><span><b class="num">${pct(acc.winner)}</b><span>winners called</span></span><span><b class="num">${acc.graded.toLocaleString("en-US")}</b><span>series graded</span></span><span><b class="num">${acc.brier}</b><span>Brier (lower is better)</span></span></span>` : ""}<span class="small muted">Every graded series, the saved-before-start record and calibration.</span></a>
    ${groups.map(([t, items]) => `<h2 class="sec-h">${esc(t)}</h2><div class="mo-list">${items.map(([h, n, d, i]) => `<a class="mo-i" href="${h}"><span class="mo-ic">${ic(i)}</span><span><b>${esc(n)}</b><span class="small muted">${esc(d)}</span></span><span aria-hidden="true">›</span></a>`).join("")}</div>`).join("")}
    <p class="small muted" style="margin-top:14px">Statistical projections for analysis and entertainment. Not betting advice. No sportsbook data is used for MLBB. All dates and times are Philippine time (Asia/Manila). Not affiliated with or endorsed by Moonton.</p>`;
}

function vHow() { app.innerHTML = `${subHead("#/more", "MORE", "How it works")}
  <div class="card doc-c"><h2>Team ratings and series math</h2><p>Every finished series is replayed in date order, game by game. Each team has a rating that moves after every game; a new season keeps part of it. Region offsets let international results (MSC, M-series) carry over to domestic ratings. A single-game chance turns into a series chance, exact scores and map counts with the best-of math.</p></div>
  <div class="card doc-c"><h2>Draft layer: meta, combos, counters</h2><p>From every pro game before the one being predicted: each hero's win record (meta strength), pairs on the same side (combos) and heroes against each other (counters), all pulled toward 50% on small samples and fading by half every 120 days so the current patch counts most. Tested walk-forward once both drafts are known; it is the engine of the Draft lab.</p></div>
  <div class="card doc-c"><h2>Scenarios</h2><p>Signature heroes (a team's most-played hero and its record with and without it), likely bans, side records and early-versus-late games, all from each team's last 150 days.</p></div>
  <div class="card doc-c"><h2>Players</h2><p>Liquipedia lists each game's picks in role order (EXP, Jungle, Mid, Gold, Roam); each pick is credited to that role in the season's lineup. Official KDA and team objectives come from the league sites where they publish them.</p></div>
  <div class="card doc-c"><h2>Learning and honesty</h2><p>Rating speed, season carry-over, region links and the draft weight are chosen by replaying all history (best Brier score). The last projection before each match is frozen and graded after, so it cannot be flattered later. Picks are capped (90% series, 85% maps) and need 6+ series per team.</p></div>
  <div class="card doc-c"><h2>Ideas we tested</h2><p>Each idea was rebuilt from games played before the one being predicted, added on top of the ratings and draft, fitted on the first 70% of games by date and judged on the last 30%, then re-checked inside the whole model.</p><p><b>Added:</b> the lineup's career win rate, but only while a team's rating is still settling (fewer than 10 series, or fewer than 5 games this season). It made series and single-game predictions slightly better and picked 70.0% of winners instead of 69.7%.</p><p><b>Shown as context only:</b> hero comfort (the player's record on a hero against their own average, across every league), experience (including playoffs, finals and international events), and archetype matchups (whole-team mix, 453 Season 18 games). None improved predictions on later games, alone or combined, so they appear on match pages and in the draft board without changing the numbers.</p><p><b>Not added:</b> recent form (better single games but worse series), team deaths in MENA and Season 16 form from the staff stat posts (too few games). Within-series momentum and the physical/magic damage mix were rejected earlier.</p></div>`; }
async function vSources() { const meta = await load("meta.json"); app.innerHTML = `${subHead("#/more", "MORE", "Data sources")}
  <div class="card doc-c"><h2>Read</h2><ul class="dots"><li><b>Liquipedia</b> (CC-BY-SA 3.0): matches, full drafts (picks, bans, sides, length, battlefield), MVPs and season lineups for ${esc(meta.leagues.join(", "))}. Read through its API at one request every 2 seconds, only pages that changed.</li><li><b>MPL PH</b> (ph-mpl.com, Data tab) and <b>MPL ID</b> (id-mpl.com, Statistics tab): official player KDA, kills, deaths, assists, kill participation and team kills, gold, damage, Lords, Turtles and towers.</li><li><b>MLBBHub</b> (mlbbhub.com): Season 18 scoreboards for MPL ID, PH and MY, one snapshot of 12 Nov 2026. Used for per-player season numbers and hero records on player pages and in the Draft tab suggestions. Checked first: 498 of 499 games match Liquipedia, and MPL PH matches the official site exactly. Raw scoreboards are not published.</li><li><b>mlbb.io</b>: ranked (all players) counters, past 7 days, current patch: each hero's strongest counters with their win-rate edge, shown on hero pages and as a small background signal in the simulator, never mixed into the pro numbers.</li></ul></div>
  <div class="card doc-c"><h2>Checked but not used</h2><ul class="dots"><li>MPL Malaysia site: schedule, teams and MVP pages but no statistics tab, and it does not answer automated requests.</li><li>MLBBHub: not read by the scheduled updates. A one-time snapshot (12 Nov 2026) of its MPL ID, PH and MY Season 18 scoreboards is used for per-player numbers only.</li><li>MLDB: blocked by bot protection. mlbb.rone.dev / arena.rone.dev: its API is closed to automated access (robots.txt). Official mobilelegends.com ranking: its data service is not open to other sites.</li><li>Facebook, Instagram, X, TikTok and Discord: need a login.</li><li>Coaching and draft tools (R7, NYRE, MLBBHub planners, Mobadraft): interactive tools, no data feed.</li><li>No sportsbook data is used for MLBB.</li></ul></div>`; }
// ---------------------------------------------------------------- player stats tab
// Every pro player we hold numbers for: list with filters, leaders and archetype charts, a player page, and a compare view.
// Data: data/pstats (scripts/mlbb/derive-pstats.mjs). Archetypes describe how a player has played, they do not predict.
const AC = { "Hyper-carry": "#F2C94C", Finisher: "#FF6B5E", Playmaker: "#2FC3FF", "Frontline anchor": "#3DDC97", "Split-pusher": "#FF9F43", "Safe efficiency": "#B18CFF", "High-risk aggressor": "#FF7AC6", "Low-resource enabler": "#2EE6D6", Balanced: "#8FA39A" };
const abase = (n) => String(n || "Balanced").replace(/\s*\(.*\)$/, "");
const acol = (n) => AC[abase(n)] || "#8FA39A";
const LGN = { ID: "MPL ID S18", PH: "MPL PH S18", MY: "MPL MY S18", MENA: "MPL MENA S10" };
const abadge = (n) => `<span class="ps-badge" style="--c:${acol(n)}">${esc(abase(n))}</span>`;
const mixBar = (blend, h = 6) => `<span class="ps-mix" style="height:${h}px">${(blend || []).map((b) => `<i style="width:${b.pct}%;background:${acol(b.n)}" title="${esc(b.n)} ${b.pct}%"></i>`).join("")}</span>`;
const fullTeam = (t) => { const inv = (S.shortInv ||= Object.fromEntries(Object.entries(S.short || {}).map(([k, v]) => [v, k]))); return inv[t] || t; };
const dsign = (x) => (x == null ? "-" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(Math.round(x * 10) / 10));
const n0 = (x) => (x == null || isNaN(x) ? "-" : Math.round(x).toLocaleString("en-US"));
const thin = (n) => (n < 5 ? " ps-thin" : "");
const PS_TABS = [["players", "Players"], ["leaders", "Leaders"], ["archetypes", "Archetypes"], ["compare", "Compare"]];
const psTabs = (on) => `<nav class="seg ps-seg" aria-label="Player stats">${PS_TABS.map(([k, l]) => `<a href="#/stats/${k}"${k === on ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
const psNote = () => `<p class="small muted ps-src">Season 18 (ID, PH, MY): MLBBHub scoreboards from the official stats feed, with winners and heroes from Liquipedia (CC-BY-SA). MENA Season 10: season averages from the MLBB Esports MENA scoreboard graphics. KH Season 11: the official MPL Cambodia leaderboards. Lanes are estimated per game from the five heroes and their usual pro lanes. Archetypes describe how a player has played so far; they are not predictions. Under 5 games is shown faded.</p>`;

function radarSvg(sets) { // sets: [{ radar: [{k, v}], color }], values are percentiles 0-100
  const keys = sets[0].radar.map((r) => r.k).filter((k) => sets.every((s) => s.radar.some((r) => r.k === k))), n = keys.length; if (n < 3) return "";
  const S0 = 300, c = S0 / 2, R = 92, pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [c + Math.cos(a) * R * v / 100, c + Math.sin(a) * R * v / 100]; };
  let g = [25, 50, 75, 100].map((v) => `<polygon points="${keys.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--line)" stroke-width="1"/>`).join("");
  g += keys.map((k, i) => { const [x, y] = pt(i, 100), [lx, ly] = pt(i, 118); return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${Math.abs(lx - c) < 10 ? "middle" : lx > c ? "start" : "end"}" dominant-baseline="middle" class="ps-ax">${esc(k.replace("survival (low deaths)", "survival").replace("kill participation", "kill part."))}</text>`; }).join("");
  g += sets.map((s) => { const m = new Map(s.radar.map((r) => [r.k, r.v])); return `<polygon points="${keys.map((k, i) => pt(i, m.get(k) ?? 0).map((x) => x.toFixed(1)).join(",")).join(" ")}" fill="${s.color}" fill-opacity=".2" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`; }).join("");
  return `<svg class="ps-radar" viewBox="-30 0 360 300" role="img" aria-label="Percentile radar against all pros">${g}</svg>`;
}
function trendSvg(series, key, color, label) {
  const pts = series.map((s, i) => ({ i, v: s[key] == null ? null : Math.min(s[key], key === "kda" ? 20 : 1e9), w: s.w, h: s.h })).filter((p) => p.v != null); if (pts.length < 3) return "";
  const W = 340, H = 96, P = 6, mx = Math.max(...pts.map((p) => p.v)) * 1.08 || 1, X = (i) => P + (i * (W - 2 * P)) / (series.length - 1), Y = (v) => H - P - (v / mx) * (H - 2 * P);
  const ma = pts.map((p, j) => { const w = pts.slice(Math.max(0, j - 4), j + 1); return w.reduce((a, b) => a + b.v, 0) / w.length; });
  const avg = pts.reduce((a, b) => a + b.v, 0) / pts.length;
  return `<div class="ps-tr"><div class="ps-tr-h"><span class="lbl">${label}</span><span class="small muted">game avg ${key === "kda" ? f1(avg) : n0(avg)} · last 5 <b>${key === "kda" ? f1(ma[ma.length - 1]) : n0(ma[ma.length - 1])}</b></span></div>
    <svg viewBox="0 0 ${W} ${H}" class="ps-trend" role="img" aria-label="${label} game by game"><line x1="${P}" x2="${W - P}" y1="${Y(avg).toFixed(1)}" y2="${Y(avg).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 3"/>
    <polyline points="${pts.map((p) => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-opacity=".3" stroke-width="1.2"/>
    <polyline points="${pts.map((p, j) => `${X(p.i).toFixed(1)},${Y(ma[j]).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>
    ${pts.map((p) => `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6" fill="${p.w ? "#3DDC97" : "#FF6B5E"}"><title>Game ${p.i + 1}: ${esc(p.h)} · ${key === "kda" ? f1(p.v) : n0(p.v)} · ${p.w ? "won" : "lost"}</title></circle>`).join("")}</svg></div>`;
}
function divRows(rows, strip = /^vs /) {
  if (!rows?.length) return `<p class="small muted">Not enough games.</p>`;
  const mx = Math.max(15, ...rows.map((r) => Math.abs(r.dwp || 0)));
  return `<div class="ps-div">${rows.map((r) => `<div class="ps-dr${r.small ? " ps-thin" : ""}"><span class="l"><b>${esc(r.label.replace(strip, "").replace(/^a team with /, "").replace(/ lane opponents$/, "").replace(/carrys/, "carries").replace(/(efficiency|Balanced|anchor|aggressor|enabler|pusher|Finisher|Playmaker)s/, "$1 players"))}</b><em>${r.n} games · ${Math.round(r.wp)}% won · KDA ${r.kda == null ? "-" : r.kda >= 20 ? "20+" : f1(r.kda)}</em></span><span class="bar"><i class="${r.dwp >= 0 ? "p" : "n"}" style="width:${(Math.abs(r.dwp || 0) / mx) * 50}%"></i></span><b class="num ${r.dwp >= 0 ? "up" : "dn"}">${dsign(r.dwp)}</b></div>`).join("")}</div>`;
}
const hbars = (rows, val, fmt, color) => { const mx = Math.max(...rows.map(val)) || 1; return `<div class="ps-hb">${rows.map((r) => `<a class="ps-hbr${thin(r.g)}" href="#/pstat/${esc(r.id)}"><span class="l">${tb(fullTeam(r.t), 22)}<b>${esc(r.p)}</b><em>${esc(r.t)} · ${esc(r.lg)}</em></span><span class="bar"><i style="width:${(val(r) / mx) * 100}%;background:${color || acol(r.arch)}"></i></span><b class="num">${fmt(val(r))}</b></a>`).join("")}</div>`; };
const chipBars = (rows, title) => { if (!rows?.length) return ""; const mx = Math.max(...rows.map((r) => r.c)); return `<div class="ps-cb"><span class="lbl">${title}</span>${rows.slice(0, 6).map((r) => `<div><span>${esc(r.n)}</span><span class="bar"><i style="width:${(r.c / mx) * 100}%"></i></span><b class="num">${r.c}</b></div>`).join("")}</div>`; };

async function vStats(sub = "players") {
  const D = await load("pstats/index.json"), P = D.players;
  if (sub === "leaders") return psLeaders(D);
  if (sub === "archetypes") return psArch(D);
  if (sub === "compare") return vPcompare("");
  const f = (S.psf ||= { q: "", lg: "", t: "", lane: "", arch: "" });
  const teams = [...new Set(P.filter((p) => !f.lg || p.lg === f.lg).map((p) => p.t))].sort();
  const sel = (id, label, opts, v) => `<label class="ps-f"><span>${label}</span><select id="${id}"><option value="">All</option>${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  app.innerHTML = `<h1>Player stats</h1>${psTabs("players")}
    <div class="ps-filters"><input id="ps-q" type="search" placeholder="Search a player or team" value="${esc(f.q)}" aria-label="Search a player or team">
      ${sel("ps-lg", "League", Object.entries(LGN), f.lg)}${sel("ps-t", "Team", teams.map((t) => [t, t]), f.t)}${sel("ps-lane", "Lane", ["EXP", "Jungle", "Mid", "Gold", "Roam"].map((x) => [x, x]), f.lane)}${sel("ps-arch", "Archetype", Object.keys(AC).map((x) => [x, x]), f.arch)}</div>
    <p class="small muted" id="ps-n"></p><div class="ps-grid" id="ps-list"></div>${psNote()}`;
  const draw = () => {
    const q = f.q.toLowerCase(), rows = P.filter((p) => (!f.lg || p.lg === f.lg) && (!f.t || p.t === f.t) && (!f.lane || p.lane === f.lane) && (!f.arch || abase(p.arch) === f.arch) && (!q || p.p.toLowerCase().includes(q) || p.t.toLowerCase().includes(q))).sort((a, b) => b.g - a.g);
    document.getElementById("ps-n").textContent = `${rows.length} players${f.lane ? " · lanes are not recorded for MENA" : ""}`;
    document.getElementById("ps-list").innerHTML = rows.map((p) => `<a class="ps-card${thin(p.g)}" href="#/pstat/${esc(p.id)}" style="--c:${acol(p.arch)}"><div class="ps-c-top">${tb(fullTeam(p.t), 34)}<span><b>${esc(p.p)}</b><em>${esc(p.t)} · ${esc(p.lane || p.lg)}${p.lane ? ` · ${esc(p.lg)}` : ""}</em></span></div>${abadge(p.arch)}${mixBar(p.blend)}<div class="ps-c-st"><span><b class="num">${p.g}</b>games</span><span><b class="num">${Math.round(p.wp)}%</b>won</span><span><b class="num">${f1(p.kda)}</b>KDA</span><span><b class="num">${p.gpm || "-"}</b>GPM</span></div></a>`).join("") || `<p class="muted">No player matches these filters.</p>`;
  };
  draw();
  document.getElementById("ps-q").addEventListener("input", (e) => { f.q = e.target.value; draw(); });
  for (const [id, k] of [["ps-lg", "lg"], ["ps-t", "t"], ["ps-lane", "lane"], ["ps-arch", "arch"]]) document.getElementById(id).addEventListener("change", (e) => { f[k] = e.target.value; if (k === "lg") { f.t = ""; vStats("players"); } else draw(); });
}

function psLeaders(D) {
  const L = (S.psl ||= { m: "kda", lane: "", lg: "" });
  const M = { kda: ["KDA", (p) => p.kda, f1], kp: ["Kill participation", (p) => p.kp, (x) => `${Math.round(x)}%`], gpm: ["Gold per minute", (p) => p.gpm, n0], dpm: ["Damage per minute", (p) => p.dpm, n0], ds: ["Team damage share", (p) => p.ds, (x) => `${f1(x)}%`], gs: ["Team gold share", (p) => p.gs, (x) => `${f1(x)}%`] };
  const [ml, val, fmt] = M[L.m], rows = D.players.filter((p) => p.g >= 8 && val(p) != null && val(p) > 0 && (!L.lane || p.lane === L.lane) && (!L.lg || p.lg === L.lg)).sort((a, b) => val(b) - val(a)).slice(0, 12);
  const chips = (k, list, cur) => list.map(([v, l]) => `<button type="button" class="ps-chip" data-k="${k}" data-v="${v}"${v === cur ? ' aria-pressed="true"' : ""}>${l}</button>`).join("");
  const S18 = D.players.filter((p) => p.lg !== "MENA" && p.g >= 5 && p.gs && p.ds), gx = (v) => 30 + ((v - 8) / 22) * 300, gy = (v) => 230 - ((v - 4) / 30) * 210;
  app.innerHTML = `<h1>Player stats</h1>${psTabs("leaders")}
    <h2 class="sec-h">Leaders · ${esc(ml)}</h2><div class="ps-chips">${chips("m", Object.entries(M).map(([k, v]) => [k, v[0].replace(/^Team (w)(w+) share$/, (m, a, b) => a.toUpperCase() + b + " %").replace(" per minute", "/min")]), L.m)}</div>
    <div class="ps-chips">${chips("lg", [["", "All leagues"], ...Object.entries(LGN).map(([k]) => [k, k])], L.lg)}</div><div class="ps-chips">${chips("lane", [["", "All lanes"], ...["EXP", "Jungle", "Mid", "Gold", "Roam"].map((x) => [x, x])], L.lane)}</div>
    <div class="card">${rows.length ? hbars(rows, val, fmt) : `<p class="muted">No player with 8+ games here.</p>`}<p class="small muted">Players with 8 or more games; bar colour is the player's archetype.${["dpm", "ds"].includes(L.m) ? " Damage is not recorded for MENA." : ""}</p></div>
    <h2 class="sec-h">Gold share vs damage share · Season 18</h2><div class="card"><svg viewBox="0 0 340 260" class="ps-scat" role="img" aria-label="Gold share against damage share, coloured by archetype">
      ${[10, 15, 20, 25, 30].map((v) => `<line x1="${gx(v)}" x2="${gx(v)}" y1="20" y2="230" stroke="var(--line)"/><text x="${gx(v)}" y="246" class="ps-ax" text-anchor="middle">${v}%</text>`).join("")}${[10, 20, 30].map((v) => `<line x1="30" x2="330" y1="${gy(v)}" y2="${gy(v)}" stroke="var(--line)"/><text x="26" y="${gy(v)}" class="ps-ax" text-anchor="end" dominant-baseline="middle">${v}%</text>`).join("")}
      <text x="180" y="258" class="ps-ax" text-anchor="middle">gold share →</text>
      ${S18.map((p) => `<a href="#/pstat/${esc(p.id)}"><circle cx="${gx(Math.min(30, Math.max(8, p.gs))).toFixed(1)}" cy="${gy(Math.min(34, Math.max(4, p.ds))).toFixed(1)}" r="4.5" fill="${acol(p.arch)}" fill-opacity=".85" stroke="var(--bg, #0A1512)"><title>${esc(p.p)} (${esc(p.t)}): gold ${f1(p.gs)}%, damage ${f1(p.ds)}%, ${esc(abase(p.arch))}</title></circle></a>`).join("")}</svg>
      <div class="ps-legend">${Object.keys(AC).filter((a) => a !== "Low-resource enabler").map((a) => `<span><i style="background:${AC[a]}"></i>${a}</span>`).join("")}</div><p class="small muted">Up and to the right: players who take the resources and turn them into damage. Tap a dot to open the player.</p></div>${psNote()}`;
  app.querySelectorAll(".ps-chip").forEach((b) => b.addEventListener("click", () => { L[b.dataset.k] = b.dataset.v; psLeaders(D); }));
}

function psArch(D) {
  const lgs = Object.keys(LGN), defs = [...(D.archDefs.season || []), ...(D.archDefs.mena || []).filter((x) => !(D.archDefs.season || []).some((y) => y.n === x.n))];
  const dist = lgs.map((lg) => { const ps = D.players.filter((p) => p.lg === lg), c = {}; for (const p of ps) c[abase(p.arch)] = (c[abase(p.arch)] || 0) + 1; return { lg, n: ps.length, c }; });
  const A = [...new Set(D.archMatrix.map((x) => x.a))], cell = (a, b) => D.archMatrix.find((x) => x.a === a && x.b === b);
  const heat = (wp) => { const t = Math.max(-1, Math.min(1, (wp - 50) / 25)); return t >= 0 ? `rgba(47,195,255,${(0.12 + t * 0.7).toFixed(2)})` : `rgba(255,107,94,${(0.12 - t * 0.7).toFixed(2)})`; };
  const ab = (a) => ({ "Frontline anchor": "Anchor", "Split-pusher": "Split", "Safe efficiency": "Safe", "High-risk aggressor": "Risk", "Hyper-carry": "Carry" })[a] || a;
  app.innerHTML = `<h1>Player stats</h1>${psTabs("archetypes")}
    <h2 class="sec-h">Archetype mix per league</h2><div class="card">${dist.map((d) => `<div class="ps-ad"><span class="lbl">${esc(LGN[d.lg])} · ${d.n}</span><span class="ps-mix" style="height:14px">${Object.entries(d.c).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<i style="width:${(n / d.n) * 100}%;background:${acol(a)}" title="${esc(a)}: ${n}"></i>`).join("")}</span></div>`).join("")}
      <div class="ps-legend">${Object.keys(AC).map((a) => `<span><i style="background:${AC[a]}"></i>${a}</span>`).join("")}</div></div>
    <h2 class="sec-h">Lane matchups · win % of the row archetype</h2><div class="card ps-hm-w"><table class="ps-hm"><thead><tr><th>vs →</th>${A.map((a) => `<th>${esc(ab(a))}</th>`).join("")}</tr></thead><tbody>${A.map((a) => `<tr><th>${esc(ab(a))}</th>${A.map((b) => { const x = cell(a, b); return x ? `<td class="${x.n < 15 ? "ps-thin" : ""}" style="background:${heat(x.wp)}" title="${esc(a)} vs ${esc(b)}: ${x.w}-${x.n - x.w}"><b>${Math.round(x.wp)}</b><em>${x.n}</em></td>` : "<td>-</td>"; }).join("")}</tr>`).join("")}</tbody></table>
      <p class="small muted">Season 18 lane opponents (ID, PH, MY). Big number: how often the row archetype's team won; small: games. Under 15 games is faded. Partly circular, because the stats behind an archetype (few deaths, high KDA) come easier on winning teams.</p></div>
    <h2 class="sec-h">What each archetype means</h2><div class="mo-list">${defs.map((x) => `<div class="mo-i"><span class="ps-dot" style="background:${acol(x.n)}"></span><span><b>${esc(x.n)}</b><span class="small muted">${esc(x.d)} · ${esc(x.m.join(", "))}</span></span><span></span></div>`).join("")}<div class="mo-i"><span class="ps-dot" style="background:${AC.Balanced}"></span><span><b>Balanced</b><span class="small muted">No stat clearly above the average pro</span></span><span></span></div></div>
    <h2 class="sec-h">MPL KH S11 · leaderboard archetypes</h2><div class="mo-list">${D.kh.players.slice(0, 12).map((p) => `<div class="mo-i">${tb(fullTeam(p.t), 30)}<span><b>${esc(p.p)}</b> ${abadge(p.arch)}<span class="small muted">${esc(p.t)} · on ${p.boards} top-10 boards: ${esc(p.ranks)}</span></span><span></span></div>`).join("")}</div>${psNote()}`;
}

async function vPstat(id) {
  const D = await load("pstats/index.json"), p = D.players.find((x) => x.id === id); if (!p) return vMissing();
  const X = await load(`pstats/p/${id}.json`), mena = p.lg === "MENA", CAR = p.lg === "PH" ? (await load("career-ph.json").catch(() => ({ players: {} }))).players : {}, car = CAR[String(p.p).toLowerCase().replace(/[^a-z0-9]/g, "")];
  const tile = (v, l) => `<div><b class="num">${v}</b><span>${l}</span></div>`;
  const sec = (t, body) => body ? `<h2 class="sec-h">${t}</h2>${body}` : "";
  const side = (X.splits || []).filter((r) => /side/i.test(r.label)), len = (X.splits || []).filter((r) => /min|short|long|length/i.test(r.label)), form = (X.splits || []).filter((r) => !side.includes(r) && !len.includes(r));
  const hmx = Math.max(1, ...(X.heroes || []).map((h) => h.n));
  app.innerHTML = `${subHead("#/stats/players", `PLAYER STATS · ${esc(LGN[p.lg])}`, p.p)}
    <section class="tm-hero ps-hero" style="--c:${acol(p.arch)}"><div class="tm-top">${tb(fullTeam(p.t), 64)}<span class="tm-r"><span class="lbl">${esc(p.t)}${p.lane ? ` · ${esc(p.lane)} (${p.laneShare}% of games)` : ""}</span><b class="num" style="font-size:28px">${esc(p.p)}</b><span>${abadge(p.arch)}${p.arch2 ? ` <span class="small muted">then ${esc(abase(p.arch2))}</span>` : ""}</span></span></div>
      ${mixBar(p.blend, 10)}<div class="ps-blend">${(p.blend || []).map((b) => `<span><i style="background:${acol(b.n)}"></i>${esc(b.n)} <b>${b.pct}%</b></span>`).join("")}</div>
      <p class="small">${esc(p.archWhy || "")}${p.tags ? ` · <b>${esc(p.tags)}</b>` : ""}</p>${p.g < 5 ? `<p class="small" style="color:var(--gold, #F2C94C)">Only ${p.g} games: treat these numbers as a rough guide.</p>` : ""}</section>
    <div class="ps-kpi">${tile(p.g, "games")}${tile(`${Math.round(p.wp)}%`, "won")}${tile(f1(p.kda), "KDA")}${tile(`${f1(p.k)}/${f1(p.d)}/${f1(p.a)}`, "K / D / A")}${tile(`${Math.round(p.kp)}%`, "kill part.")}${tile(p.gpm || "-", "gold / min")}${mena ? "" : tile(n0(p.dpm), "damage / min")}${tile(p.gs ? `${f1(p.gs)}%` : "-", "team gold")}${mena ? "" : tile(p.ds ? `${f1(p.ds)}%` : "-", "team damage")}</div>${p.lg === "MY" ? `<p class="small muted">Gold and damage are not recorded for MPL MY in our scoreboard data.</p>` : ""}
    ${sec("Percentile against all pros", `<div class="card ps-rc">${radarSvg([{ radar: p.radar, color: acol(p.arch) }])}<p class="small muted">0 = lowest, 100 = highest among ${mena ? "MENA S10" : "Season 18 ID, PH and MY"} players.</p></div>`)}
    ${X.series?.length ? sec("Game by game", `<div class="card">${trendSvg(X.series, "kda", "#2FC3FF", "KDA")}${trendSvg(X.series, "gpm", "#F2C94C", "GOLD / MIN")}${trendSvg(X.series, "dpm", "#FF9F43", "DAMAGE / MIN")}<p class="small muted">Dots: green won, red lost. Thick line: 5-game average. Dashed: average of all games.</p></div>`) : ""}
    ${X.heroes?.length ? sec("Hero pool", `<div class="card ps-hp">${X.heroes.slice(0, 12).map((h) => `<a class="ps-hpr${thin(h.n)}" href="#/hero/${encodeURIComponent(h.h.toLowerCase())}">${hpic(h.h.toLowerCase(), 34)}<span class="l"><b>${esc(h.h)}</b><em>KDA ${f1(h.kda)}</em></span><span class="bar"><i style="width:${(h.n / hmx) * 100}%"></i></span><b class="num">${h.n}g</b><b class="num ${h.wp >= 50 ? "up" : "dn"}">${Math.round(h.wp)}%</b></a>`).join("")}</div>`) : ""}
    ${careerHtml(car)}
    ${X.vsLaneArch?.length ? sec("Against lane-opponent archetypes", `<div class="card">${divRows(X.vsLaneArch)}<p class="small muted">Win % against the player's own average (${Math.round(p.wp)}%), by the archetype of the opponent in the same lane.</p></div>`) : ""}
    ${sec("Against teams with…", `<div class="card">${divRows(X.vsTeamArch)}</div>`)}
    ${X.vsLanePlayer?.length ? sec("Head to head · lane opponents", `<div class="card">${divRows(X.vsLanePlayer.slice(0, 8))}</div>`) : ""}
    ${sec("Opponents", `<div class="card">${divRows((X.vsTeam || []).slice(0, 8))}</div>`)}
    ${sec("Situations", `<div class="card">${[["Side", side], ["Game length", len], ["Form and season", form]].filter(([, r]) => r.length).map(([t, r]) => `<span class="lbl">${t}</span>${divRows(r, /^$/)}`).join("")}</div>`)}
    ${X.items?.length ? sec("Most-used builds", `<div class="card ps-builds">${chipBars(X.emblems, "EMBLEMS")}${chipBars(X.items, "ITEMS")}${chipBars(X.talents, "TALENTS")}</div><p class="small muted">Times picked across the player's games.</p>`) : ""}
    ${X.series?.length ? `<details class="card ps-log"><summary>Full game log · ${X.series.length} games</summary><table class="ft"><thead><tr><th>#</th><th>Hero</th><th class="n">KDA</th><th class="n">GPM</th><th class="n">DPM</th><th class="n">KP</th><th></th></tr></thead><tbody>${X.series.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.h)}</td><td class="n">${f1(g.kda)}</td><td class="n">${n0(g.gpm)}</td><td class="n">${n0(g.dpm)}</td><td class="n">${g.kp ?? "-"}%</td><td class="${g.w ? "up" : "dn"}">${g.w ? "W" : "L"}</td></tr>`).join("")}</tbody></table></details>` : mena ? `<p class="small muted">Game-by-game rows are not shown for MENA; season averages and splits only.</p>` : ""}
    <p><a class="go" href="#/pcompare/${esc(p.id)}~">Compare ${esc(p.p)} with another player ›</a></p>${psNote()}`;
}

async function vPcompare(arg) {
  const D = await load("pstats/index.json"), [ia = "", ib = ""] = String(arg || "").split("~"), P = D.players;
  const A = P.find((p) => p.id === ia), B = P.find((p) => p.id === ib);
  const opts = (cur) => Object.entries(LGN).map(([lg, l]) => `<optgroup label="${esc(l)}">${P.filter((p) => p.lg === lg).sort((a, b) => a.p.localeCompare(b.p)).map((p) => `<option value="${esc(p.id)}"${p.id === cur ? " selected" : ""}>${esc(p.p)} · ${esc(p.t)}</option>`).join("")}</optgroup>`).join("");
  let body = `<p class="muted">Choose two players.</p>`;
  if (A && B) {
    const [XA, XB] = await Promise.all([load(`pstats/p/${A.id}.json`), load(`pstats/p/${B.id}.json`)]);
    const h2h = (X, o) => (X.vsLanePlayer || []).find((r) => r.label.replace(/^vs /, "").replace(/\s*\(.*$/, "").toLowerCase() === o.p.toLowerCase());
    const ha = h2h(XA, B), tA = (XA.vsTeam || []).find((r) => r.label === `vs ${B.t}`), tB = (XB.vsTeam || []).find((r) => r.label === `vs ${A.t}`);
    const rows = [["Games", (p) => p.g, n0], ["Won", (p) => p.wp, (x) => `${Math.round(x)}%`], ["KDA", (p) => p.kda, f1], ["Kill part.", (p) => p.kp, (x) => `${Math.round(x)}%`], ["Gold / min", (p) => p.gpm, n0], ["Damage / min", (p) => p.dpm, n0], ["Team gold", (p) => p.gs, (x) => `${f1(x)}%`], ["Team damage", (p) => p.ds, (x) => `${f1(x)}%`], ["Deaths / game", (p) => p.d, f1, true]];
    const cA = "#2FC3FF", cB = "#FF6B5E";
    body = `<div class="ps-vs"><a href="#/pstat/${esc(A.id)}" style="--c:${cA}">${tb(fullTeam(A.t), 40)}<b>${esc(A.p)}</b>${abadge(A.arch)}</a><span class="muted">VS</span><a href="#/pstat/${esc(B.id)}" style="--c:${cB}">${tb(fullTeam(B.t), 40)}<b>${esc(B.p)}</b>${abadge(B.arch)}</a></div>
      <div class="card ps-rc">${radarSvg([{ radar: A.radar, color: cA }, { radar: B.radar, color: cB }]) || `<p class="small muted">These two leagues record different stats, so there is no shared radar.</p>`}<div class="ps-legend"><span><i style="background:${cA}"></i>${esc(A.p)}</span><span><i style="background:${cB}"></i>${esc(B.p)}</span></div><p class="small muted">Percentiles within each player's own league.</p></div>
      <div class="card ps-cmp">${rows.map(([l, f, fmt, low]) => { const a = f(A), b = f(B); if (a == null && b == null) return ""; const wa = a != null && b != null && (low ? a < b : a > b), wb = a != null && b != null && (low ? b < a : b > a); return `<div><b class="num${wa ? " win" : ""}">${a == null ? "-" : fmt(a)}</b><span>${l}</span><b class="num${wb ? " win" : ""}">${b == null ? "-" : fmt(b)}</b></div>`; }).join("")}</div>
      <h2 class="sec-h">Head to head</h2><div class="card">${ha ? `<p><b>${esc(A.p)}</b> against <b>${esc(B.p)}</b> in the same lane: <b>${Math.round(ha.wp * ha.n / 100)}-${ha.n - Math.round(ha.wp * ha.n / 100)}</b> in ${ha.n} games, KDA ${f1(ha.kda)} (${dsign(ha.dkda)} on ${esc(A.p)}'s average).</p>` : `<p class="small muted">They have not met as lane opponents in our games.</p>`}
        ${tA ? `<p class="small">${esc(A.p)} against ${esc(B.t)}: ${tA.n} games, ${Math.round(tA.wp)}% won.</p>` : ""}${tB ? `<p class="small">${esc(B.p)} against ${esc(A.t)}: ${tB.n} games, ${Math.round(tB.wp)}% won.</p>` : ""}</div>`;
  }
  app.innerHTML = `<h1>Player stats</h1>${psTabs("compare")}<div class="ps-filters"><label class="ps-f"><span>Player A</span><select id="pc-a"><option value="">Choose</option>${opts(ia)}</select></label><label class="ps-f"><span>Player B</span><select id="pc-b"><option value="">Choose</option>${opts(ib)}</select></label></div>${body}${psNote()}`;
  const go = () => { location.hash = `#/pcompare/${document.getElementById("pc-a").value}~${document.getElementById("pc-b").value}`; };
  document.getElementById("pc-a").addEventListener("change", go); document.getElementById("pc-b").addEventListener("change", go);
}

function vMissing() { app.innerHTML = `<div class="card doc-c"><h2>This page does not exist in the MLBB section</h2><p><a class="go" href="#/matches">MLBB matches ›</a> <a class="go" href="#/more">More ›</a></p></div>`; }

// ---------------------------------------------------------------- router
function stamp(meta) { const el = document.getElementById("updated"); if (el && meta) el.textContent = `Data refreshed ${new Date(meta.built).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} PH time · ${meta.series} series and ${meta.games.toLocaleString()} games graded · ${meta.players} players · ${meta.heroes} heroes.`; }
async function route() {
  document.body.classList.remove("sim-wide-on");
  const seq = (S.seq = (S.seq || 0) + 1), h = location.hash || "#/matches", st = (S.stack ||= []);
  if (st.length > 1 && st[st.length - 2] === h) st.pop(); else if (st[st.length - 1] !== h) st.push(h);
  const [, viewRaw = "matches", arg] = h.split("?")[0].split("/"), view = viewRaw || "matches";
  drawNav(TAB[view] || "matches"); document.body.classList.toggle("mlbb-sub", !["matches", "sim", "draft", "heroes", "teams", "stats", "more"].includes(view));
  S.img ||= await load("images.json").catch(() => ({ heroes: {}, teams: {}, players: {} })); S.short ||= await load("short.json").catch(() => ({}));
  try { await ({ matches: vMatches, match: vMatch, versus: vVersus, draft: vSim, sim: vSim, picks: vPicks, heroes: vHeroes, hero: vHero, teams: vTeams, team: vTeam, players: vPlayers, player: vPlayer, stats: vStats, pstat: vPstat, pcompare: vPcompare, more: vMore, m8: vM8, library: vLibrary, matrix: vMatrix, leagues: vLeagues, playbook: vPlaybook, patch: vPatch, results: vResults, how: vHow, sources: vSources }[view] || vMissing)(decodeURIComponent(arg || "")); }
  catch (e) { if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">${esc(e.message)}</p><p><a class="go" href="#/matches">Back to matches</a></p></div>`; }
  if (st.length > 1) app.querySelectorAll("a.back").forEach((a) => (a.textContent = "‹ Back"));
  if (S.last !== h) window.scrollTo(0, 0); S.last = h;
  if (!document.getElementById("updated").textContent) load("meta.json").then(stamp).catch(() => {});
}
document.addEventListener("click", (e) => { const a = e.target.closest?.("a.back"); if (a && (S.stack?.length || 0) > 1) { e.preventDefault(); history.back(); } });
addEventListener("hashchange", route);
route();
