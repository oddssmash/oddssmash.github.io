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
const heroChip = (h) => `<a class="hchip" href="#/hero/${encodeURIComponent(h)}">${heroImg(h, 18)}${esc(cap(h))}</a>`;
const lg = (x) => 1 / (1 + Math.exp(-x)), logit = (p) => Math.log(p / (1 - p));
function series(p, bo) { const need = Math.ceil(bo / 2), out = {}; let win = 0; const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (let l = 0; l < need; l++) { const pr = C(need - 1 + l, l) * p ** need * (1 - p) ** l; out[`${need}-${l}`] = pr; win += pr; } for (let w = 0; w < need; w++) out[`${w}-${need}`] = C(need - 1 + w, w) * (1 - p) ** need * p ** w; return { win, scores: out }; }

// ---------------------------------------------------------------- chrome
const NAV = [["matches", "Matches", "M5 19L19 5M14 5h5v5M5 5l14 14M5 10V5h5"], ["sim", "Draft", "M5 5h6v6H5zM13 13h6v6h-6zM13 5h6v6h-6zM5 13h6v6H5z"], ["heroes", "Meta", "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"], ["teams", "Teams", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"], ["more", "More", "M4 7h16M4 12h16M4 17h16"]];
const TAB = { matches: "matches", match: "matches", versus: "matches", draft: "sim", sim: "sim", picks: "matches", heroes: "heroes", hero: "heroes", teams: "teams", team: "teams", players: "teams", player: "teams", more: "more", m8: "matches", library: "more", matrix: "heroes", leagues: "heroes", playbook: "heroes", patch: "heroes", results: "more", how: "more", sources: "more" };
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
  const bans = (n, side) => { const b = ban(n); return b.length ? `<div class="${side}"><b>${esc(n)} usually ban</b><span class="hs">${b.map((x) => `<span><span class="hi">${heroImg(x.h, 40) || `<span class="hph" style="width:40px;height:40px;display:grid;place-items:center;background:var(--surface-2)">${esc(cap(x.h).slice(0, 2))}</span>`}</span>${esc(cap(x.h))}</span>`).join("")}</span></div>` : `<div class="${side}"></div>`; };
  return `<a class="mc" href="#/match/${esc(m.id)}"><div class="mc-h"><span>${esc(m.league)} · ${esc(m.stage)}</span><span class="mc-bo">BO${m.bo}</span></div>
    <div class="mc-t"><div class="mc-s a">${tb(m.a, 60)}<span class="nm">${esc(m.a)}</span><span class="num">${pct(pa)}</span></div><div class="mc-vs">VS</div><div class="mc-s b">${tb(m.b, 60)}<span class="nm">${esc(m.b)}</span><span class="num">${pct(1 - pa)}</span></div></div>
    <div class="mc-bar"><span style="width:${(pa * 100).toFixed(1)}%"></span><span style="width:${((1 - pa) * 100).toFixed(1)}%"></span></div>
    <div class="mc-b"><div class="mc-row"><span>${esc(when(m.date))}</span><span>First to ${need} <span class="pips" aria-hidden="true">${Array.from({ length: m.bo }, () => "<i></i>").join("")}</span></span></div>
      <div class="mc-chips"><span>Single game ${pct(Math.max(m.pGame, 1 - m.pGame))} ${esc(m.pGame >= 0.5 ? m.a : m.b)}</span><span>About ${f1(m.expMaps)} maps</span><span>Confidence: ${esc(m.confidence)}</span></div>
      ${ban(m.a).length || ban(m.b).length ? `<div class="mc-bans">${bans(m.a, "a")}${bans(m.b, "b")}</div>` : ""}
      <span class="mc-cta">SCORES · SCENARIOS · BANS</span></div></a>`;
}
function resultRow(r) { const aw = r.score[0] > r.score[1], cls = r.graded ? (r.right ? "ok" : "no") : "";
  return `<div class="rcard ${cls}"><div class="top-r"><span>${esc(dshort(r.date))} · ${esc(r.league)} ${esc(r.stage)}</span><span class="tag">${r.graded ? (r.right ? "CALLED" : "MISSED") : ""}</span></div>
    <div class="sc"><span class="${aw ? "w" : "l"}">${esc(r.a)}</span><span class="num">${r.score[0]} – ${r.score[1]}</span><span class="${aw ? "l" : "w"}">${esc(r.b)}</span></div>
    <div class="bot-r"><span>We said <b>${esc(r.pSeries >= 0.5 ? r.a : r.b)} ${pct(Math.max(r.pSeries, 1 - r.pSeries))}</b></span>${r.mvp ? `<span class="mvp">★ MVP ${esc(r.mvp)}</span>` : ""}</div></div>`; }

async function vMatch(id) { const m = await load(`matches/${id}.json`); app.innerHTML = `<a class="back" href="#/matches">‹ Matches</a><p class="small muted" style="margin:0">${esc(m.league)} · ${esc(m.stage)} · Bo${m.bo} · ${esc(when(m.date))} PH</p>${await matchup(m.a, m.b, m.bo, m)}`; }

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
  return `<section class="mp-hero"><div class="mc-t"><div class="mc-s a">${tb(ta.name, 60)}<a class="nm" href="#/team/${esc(ta.id)}">${esc(ta.name)}</a><span class="num">${pct(s.win)}</span><span class="small muted">rating ${ta.elo}</span></div><div class="mc-vs">VS</div><div class="mc-s b">${tb(tb2.name, 60)}<a class="nm" href="#/team/${esc(tb2.id)}">${esc(tb2.name)}</a><span class="num">${pct(1 - s.win)}</span><span class="small muted">rating ${tb2.elo}</span></div></div>
      <div class="mc-bar"><span style="width:${(s.win * 100).toFixed(1)}%"></span><span style="width:${((1 - s.win) * 100).toFixed(1)}%"></span></div>
      <div class="mp-h1"><h1>${esc(fav.name)} ${pct(Math.max(s.win, 1 - s.win))} to win the series</h1><div class="mc-chips"><span>Single game: ${esc(pg >= 0.5 ? ta.name : tb2.name)} ${pct(Math.max(pg, 1 - pg))}</span>${pre ? `<span>Confidence: ${esc(pre.confidence)}</span>` : ""}<span>Best of ${bo}</span></div></div></section>
    <nav class="mp-tabs" aria-label="Sections">${[["series", "Series"], ["draft", "Draft"], ["teams", "Teams"], ["lineups", "Lineups"]].map(([k, l], i) => `<button type="button" data-jump="mp-${k}"${i === 0 ? ' aria-current="true"' : ""}>${l}</button>`).join("")}</nav>
    <section class="mp-sec" id="mp-series"><h2 class="sec-h">Exact score</h2><div class="card mp-sc"><div class="mp-sc-h"><span>${esc(ta.name)} wins</span><span>Score</span><span>${esc(tb2.name)} wins</span></div>
      ${rows.map((r) => `<div class="mp-sc-r"><div class="l"><span class="muted small">${dec(r.pa)}</span><b>${pct(r.pa)}</b><span class="bar"><i style="width:${(r.pa / maxP) * 100}%"></i></span></div><span class="sc">${esc(r.score)}</span><div class="r"><span class="bar"><i style="width:${(r.pb / maxP) * 100}%"></i></span><b>${pct(r.pb)}</b><span class="muted small">${dec(r.pb)}</span></div></div>`).join("")}
      <p class="small muted">Chance, with fair odds on the outside.</p>
      ${over != null ? `<div class="mp-ou"><div class="spread small"><span>Over ${line} maps <b>${pct(over)}</b></span><span>Under <b>${pct(1 - over)}</b></span></div><div class="mc-bar"><span style="width:${(over * 100).toFixed(1)}%"></span><span style="width:${((1 - over) * 100).toFixed(1)}%"></span></div></div>` : ""}</div>
      ${bo >= 3 ? (() => { const memo = {}, P = (x, y) => (x >= need ? 1 : y >= need ? 0 : (memo[x + "," + y] ??= pg * P(x + 1, y) + (1 - pg) * P(x, y + 1)));
        return `<div class="card"><h2>Series in progress</h2><p class="small">${esc(ta.name)}'s chance to win the series at each score (${esc(ta.name)} first):</p><div class="tw"><table class="ft sip"><thead><tr><th></th>${[...Array(need).keys()].map((y) => `<th class="n">${esc(tb2.name.split(" ")[0])} ${y}</th>`).join("")}</tr></thead><tbody>${[...Array(need).keys()].map((x) => `<tr><th>${esc(ta.name.split(" ")[0])} ${x}</th>${[...Array(need).keys()].map((y) => { const v = P(x, y); return `<td class="n ${v >= 0.6 ? "up" : v <= 0.4 ? "down" : ""}">${pct(v)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div><p class="small muted">Same single-game chance (${pct(pg)}) for every game. The last game's winner wins the next one about 61% of the time in our data, but almost all of that is the better team winning again, so no extra momentum is added.</p></div>`; })() : ""}</section>
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

async function vVersus() {
  const teams = await load("teams.json"), qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const st = { a: teams.find((t) => t.name === qs.get("a")) || teams[0], b: teams.find((t) => t.name === qs.get("b")) || teams[1], bo: +(qs.get("bo") || 5) };
  const draw = async () => { document.getElementById("vs-out").innerHTML = st.a && st.b && st.a !== st.b ? await matchup(st.a.name, st.b.name, st.bo) : `<p class="empty">Pick two different teams.</p>`; };
  app.innerHTML = `<a class="back" href="#/matches">‹ Matches</a><h1>Versus</h1><p class="lead">Any team against any team, even if they have never met: series chance from both teams' ratings (learned game by game, with international events linking the regions), plus the draft scenarios.</p>
    <div class="grid two">${pickBox("va", "First team", st.a?.name)}${pickBox("vb", "Second team", st.b?.name)}</div>
    <div class="filters" role="group" aria-label="Best of">${[1, 3, 5, 7].map((n) => `<button class="fbtn" type="button" data-bo="${n}" aria-pressed="${st.bo === n}">Best of ${n}</button>`).join("")}</div><div id="vs-out"></div>`;
  bindPick(document.getElementById("va"), teams, (t) => `${t.name} (${t.region})`, (t) => { st.a = t; draw(); });
  bindPick(document.getElementById("vb"), teams, (t) => `${t.name} (${t.region})`, (t) => { st.b = t; draw(); });
  app.querySelectorAll("[data-bo]").forEach((b) => b.addEventListener("click", () => { st.bo = +b.dataset.bo; app.querySelectorAll("[data-bo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
}

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
  app.innerHTML = `<a class="back" href="#/matches">‹ Matches</a><h1>Draft lab</h1><p class="lead">Pick two teams (optional) and five heroes a side, in role order. The win chance combines the teams' ratings with each hero's pro-play strength, the combos on each side and the counters across.</p>
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
  const det = (s) => (s === 1 ? dA : dB), team = (s) => (s === 1 ? st.a : st.b), tname = (s) => team(s)?.name || (s === st.fp ? "Blue side" : "Red side");
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
  const picks = (s) => { const n = now(); return `<div class="ds-col ${col(s)}">${ROLES.map((r, i) => { const h = st[`h${s}`][i], tg = st.target?.s === s && st.target.i === i; return `<button type="button" class="ds-pick${h ? " on" : ""}${tg ? " tgt" : ""}${n.k === "p" && n.s === s && !h ? " open" : ""}" data-slot="${s},${i}" aria-label="${esc(tname(s))} ${r}: ${h ? esc(cap(h)) : "empty, tap to pick for this lane"}"><span class="ds-pic">${h ? heroImg(h, 40) || esc(cap(h).slice(0, 2)) : icon(ROLE_IC[r])}</span><span class="ds-pl"><b>${r.toUpperCase()}</b><span>${h ? esc(cap(h)) : "Pick a hero"}</span></span></button>`; }).join("")}</div>`; };
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
      const tbox = (s) => `<div class="ds-team ${col(s)}"><span class="lbl">${s === blue ? "BLUE · FIRST PICK" : "RED · SECOND PICK"}</span>${pickBox(`st${s}`, "Choose a team", team(s)?.name || "")}</div>`;
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
async function vLibrary() {
  const idx = await load("library.json"); S.lib ||= { league: idx[0]?.id, q: "", team: "", hero: "" };
  const rows = await load(`library/${S.lib.league}.json`);
  const draw = () => { const q = S.lib.q.trim().toLowerCase();
    const f = rows.filter((r) => !q || r[2].toLowerCase().includes(q) || r[3].toLowerCase().includes(q) || [...r[10], ...r[11]].some((h) => h.includes(q)) || (r[1] || "").toLowerCase().includes(q)).slice(0, 60);
    document.getElementById("lib").innerHTML = f.map((r) => { const [date, stage, a, b, bo, n, w, side1, map, len, h1, h2, b1, b2] = r, A = w === 1, ROLES = ["EXP", "JGL", "MID", "GLD", "ROM"];
      const side = (t, hs, bs, won, sd) => `<div class="ld-side ${won ? "won" : ""}"><div class="spread"><b>${tb(t, 22)} ${esc(t)}</b><span class="small ${won ? "up" : "muted"}">${won ? "WIN" : ""} ${sd ? esc(sd) : ""}</span></div><div class="ld-picks">${hs.map((h, i) => `<span class="ld-p"><span class="muted small">${ROLES[i]}</span>${heroImg(h, 30)}<span class="small">${esc(cap(h))}</span></span>`).join("")}</div><div class="small muted">Bans: ${bs.map((h) => `${heroImg(h, 16)}${esc(cap(h))}`).join(" · ") || "-"}</div></div>`;
      return `<div class="card ld"><div class="small muted spread"><span>${esc(date || "")} · ${esc(stage || "")} · Game ${n} of Bo${bo}</span><span>${map ? esc(map.trim()) + " · " : ""}${esc(len || "")}</span></div>${side(a, h1, b1, A, side1)}${side(b, h2, b2, !A, side1 === "blue" ? "red" : side1 === "red" ? "blue" : "")}</div>`; }).join("") || `<p class="empty">No game matches.</p>`;
    document.getElementById("lib-n").textContent = `${f.length < rows.length ? `Showing ${f.length} of ` : ""}${rows.length} games in this league`; };
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Draft library</h1><p class="lead">Every pro game in our data with both drafts (picks in role order and bans), side, battlefield map, length and result. Search a team, a hero or a stage.</p>
    <select class="field" id="lib-l">${idx.map((x) => `<option value="${esc(x.id)}"${x.id === S.lib.league ? " selected" : ""}>${esc(x.league)} (${x.games})</option>`).join("")}</select>
    <input class="field" id="lib-q" type="search" placeholder="Team, hero or stage, e.g. Falcons or Hirara or Playoffs" value="${esc(S.lib.q)}" style="margin-top:8px">
    <p class="small muted" id="lib-n" style="margin:8px 0"></p><div id="lib"></div><p class="small muted">Source: Liquipedia. Blue side picks first in pro MLBB; Liquipedia lists picks by role, not in draft order.</p>`;
  document.getElementById("lib-l").addEventListener("change", (e) => { S.lib.league = e.target.value; vLibrary(); });
  document.getElementById("lib-q").addEventListener("input", (e) => { S.lib.q = e.target.value; draw(); });
  draw();
}
// ---------------------------------------------------------------- Meta by league
async function vLeagues() {
  const L = await load("leagues.json"); S.lgm ||= L.leagues[0]?.league; const x = L.leagues.find((y) => y.league === S.lgm) || L.leagues[0]; if (!x) { app.innerHTML = `<p class="empty">No league data yet.</p>`; return; }
  const bw = x.blue[1] ? x.blue[0] / x.blue[1] : null, all = L.blueAll[1] ? L.blueAll[0] / L.blueAll[1] : null;
  app.innerHTML = `<a class="back" href="#/heroes">‹ Heroes</a><h1>Meta by league</h1>${metaTabs("leagues")}<p class="lead">Each region plays its own meta, so a hero that is a must-ban in one league can be ignored in another. ${esc(L.note)}</p>
    <div class="filters" role="group" aria-label="League">${L.leagues.map((y) => `<button class="fbtn" data-lgm="${esc(y.league)}" aria-pressed="${y.league === x.league}">${esc(y.league)}</button>`).join("")}</div>
    <div class="statgrid sg4"><div class="stat"><b>${x.games}</b><span>Games</span></div><div class="stat"><b>${bw == null ? "-" : pct(bw)}</b><span>First-pick (blue) side wins</span></div><div class="stat"><b>${all == null ? "-" : pct(all)}</b><span>All leagues</span></div><div class="stat"><b>${x.medianMin ?? "-"}</b><span>Median game (min)</span></div></div>
    <div class="card"><h2>Most contested heroes</h2><table class="ft"><thead><tr><th>Hero</th><th class="n">Picked or banned</th><th class="n">Picks</th><th class="n">Bans</th><th class="n">Won when picked</th></tr></thead><tbody>${x.top.map((h) => `<tr><td>${heroChip(h.h)}</td><td class="n"><b>${pct(h.pres)}</b></td><td class="n">${h.p}</td><td class="n">${h.b}</td><td class="n">${h.wr == null ? "-" : pct(h.wr)}</td></tr>`).join("")}</tbody></table></div>
    <div class="grid two"><div class="card"><h2>First ban of the draft (B1, blue)</h2><p>${x.b1.map((h) => `${heroChip(h.h)} <span class="muted small">${h.n}×</span>`).join(" ")}</p></div><div class="card"><h2>Red side's first ban (B2)</h2><p>${x.b2.map((h) => `${heroChip(h.h)} <span class="muted small">${h.n}×</span>`).join(" ")}</p></div></div>
    <p class="small muted">Source: Liquipedia match pages. Blue side bans and picks first. A first-pick edge under about 55% on a hundred-odd games is within normal variation.</p>`;
  app.querySelectorAll("[data-lgm]").forEach((b) => b.addEventListener("click", () => { S.lgm = b.dataset.lgm; vLeagues(); }));
}
// ---------------------------------------------------------------- Playbook: plain rules from our own pro games
async function vPlaybook() {
  const P = await load("playbook.json"), groups = ["All", ...new Set(P.rules.map((r) => r.group))]; S.pb ||= "All";
  const tagC = (t) => `<span class="chip ${t === "solid" ? "ok" : ""}">${t === "solid" ? "SOLID" : "LEAD"}</span>`;
  const stat = (x) => `<div class="stat"><b>${x.text || pct(x.v)}</b><span>${esc(x.l)}</span>${x.lo != null ? `<span class="muted small">range ${pct(x.lo)}–${pct(x.hi)}</span>` : ""}</div>`;
  const list = P.rules.filter((r) => S.pb === "All" || r.group === S.pb);
  app.innerHTML = `<h1>Playbook</h1>${metaTabs("playbook")}<p class="lead">What pro games actually show, as plain rules. Every number is from our own Liquipedia data (${P.games} games in the last 365 days). <b>SOLID</b>: the 95% range clears the comparison. <b>LEAD</b>: it points that way but the sample cannot rule out chance.</p>
    <div class="filters" role="group" aria-label="Rule group">${groups.map((g) => `<button class="fbtn" data-pb="${esc(g)}" aria-pressed="${S.pb === g}">${esc(g)}</button>`).join("")}</div>
    ${list.map((r, i) => `<div class="card"><div class="spread"><span class="small muted">RULE ${i + 1} · ${esc(r.group.toUpperCase())}</span>${tagC(r.tag)}</div><h2>${esc(r.title)}</h2><div class="statgrid sg3">${r.stats.map(stat).join("")}</div><p class="small"><b>Use it:</b> ${esc(r.use)}</p>
      ${r.id === "popular" && r.detail ? `<p class="small muted">Weakest common picks: ${r.detail.weak.map((x) => `${heroChip(x.h)} ${pct(x.rate)} (${x.n})`).join(", ")}. Strongest: ${r.detail.strong.map((x) => `${heroChip(x.h)} ${pct(x.rate)} (${x.n})`).join(", ")}.</p>` : ""}
      ${r.id === "sides" && r.detail ? `<details class="small"><summary>By map event and league</summary><ul class="plain">${[...r.detail.maps, ...r.detail.leagues].map((x) => `<li class="spread"><span>${esc(x.name)}</span><span>${pct(x.rate)} <span class="muted">(${x.n}, range ${pct(x.lo)}–${pct(x.hi)})</span> ${x.tag === "solid" ? "SOLID" : ""}</span></li>`).join("")}</ul></details>` : ""}</div>`).join("")}
    ${S.pb === "All" ? `<div class="card"><h2>Game length</h2><p class="small">Median pro game: ${P.timing.median} min. Win rate in games under 13 minutes vs 18+ minutes, last 365 days.</p><div class="grid two"><div><h3>Win early</h3><ul class="plain small">${P.timing.early.map((x) => `<li class="spread">${heroChip(x.h)}<span>${pct(x.short)} → ${pct(x.long)}</span></li>`).join("")}</ul></div><div><h3>Win late</h3><ul class="plain small">${P.timing.late.map((x) => `<li class="spread">${heroChip(x.h)}<span>${pct(x.short)} → ${pct(x.long)}</span></li>`).join("")}</ul></div></div></div>` : ""}
    <p class="small muted">${esc(P.cannot)} ${esc(P.note)}</p><p><a class="go" href="#/sim">Try these rules in a draft ›</a></p>`;
  app.querySelectorAll("[data-pb]").forEach((b) => b.addEventListener("click", () => { S.pb = b.dataset.pb; vPlaybook(); }));
}
// ---------------------------------------------------------------- Patch tracker
async function vPatch() {
  const T = await load("patch.json"), row = (x) => `<li class="spread">${heroChip(x.h)}<span class="small">${pct(x.before.rate)} <span class="muted">(${x.before.n})</span> → <b>${pct(x.after.rate)}</b> <span class="muted">(${x.after.n})</span> ${x.tag === "solid" ? '<span class="chip ok">SOLID</span>' : ""}</span></li>`;
  app.innerHTML = `<a class="back" href="#/heroes">‹ Heroes</a><h1>Patch tracker</h1>${metaTabs("patch")}<p class="lead">Current patch: ${esc(T.current?.patch || "-")} (${esc(dshort(T.current?.release || ""))})${T.current?.manual ? ", from the in-game patch notes; not on Liquipedia yet" : ""}.</p>
    ${T.watch.length ? `<div class="card"><h2>Watch list: changed this patch</h2><ul class="plain">${T.watch.map((x) => `<li class="spread">${heroChip(x.h)}<span class="small">${esc(x.type)} · ${x.picks} pro games since · ${x.picks >= 20 ? "enough to judge" : `${20 - x.picks} more games before the old record is replaced`}</span></li>`).join("")}</ul><p class="small muted">Until then, draft numbers for these heroes come from the old version.</p></div>` : ""}
    ${T.cut ? `<div class="card"><h2>Did patch ${esc(T.cut.patch)} (${esc(dshort(T.cut.release))}) change results?</h2><ul class="plain">${T.changed.map((x) => `<li class="spread"><span>${heroChip(x.h)} <span class="muted small">${esc(x.type)}</span></span><span class="small">${pct(x.before.rate)} <span class="muted">(${x.before.n})</span> → <b>${pct(x.after.rate)}</b> <span class="muted">(${x.after.n})</span></span></li>`).join("") || `<li class="muted small">No changed hero has pro games on both sides yet.</li>`}</ul><p class="small muted">The model follows measured results with a 120-day fade, not the patch notes.</p></div>` : ""}
    <div class="grid two"><div class="card"><h2>Rising since ${esc(T.cut?.patch || "")}</h2><ul class="plain">${T.risers.map(row).join("")}</ul></div><div class="card"><h2>Falling</h2><ul class="plain">${T.fallers.map(row).join("")}</ul></div></div>
    <div class="card"><h2>Patch timeline</h2><ul class="plain small">${T.patches.map((p) => `<li><b>${esc(p.patch)}</b> <span class="muted">${esc(dshort(p.release))}${p.manual ? " · in-game notes" : ""}</span><br>${esc(p.changes.map((c) => `${cap(c.hero)} ${c.type}`).join(" · ") || "-")}</li>`).join("")}</ul></div>
    <p class="small muted">${esc(T.note)} SOLID = the before and after 95% ranges do not overlap.</p>`;
}
// ---------------------------------------------------------------- Counter matrix
async function vMatrix() {
  const M = await load("matrix.json"); S.mx ||= { lane: "", hero: "" };
  const G = { 2: ["▲▲", "Hard counter", "mx2"], 1: ["▲", "Favoured", "mx1"], "-1": ["▼", "Losing", "mxm1"], "-2": ["▼▼", "Hard loss", "mxm2"] };
  const heroes = Object.keys(M.m).filter((h) => !S.mx.lane || M.lanes[h] === S.mx.lane).sort();
  const one = S.mx.hero && M.m[S.mx.hero] ? Object.entries(M.m[S.mx.hero]).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]) : null;
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Counter matrix</h1>${metaTabs("matrix")}<p class="lead">How each hero has done against others in pro games. ${esc(M.note)}</p>
    <div class="filters" role="group" aria-label="Lane"><button class="fbtn" data-ml="" aria-pressed="${!S.mx.lane}">All</button>${["EXP", "Jungle", "Mid", "Gold", "Roam"].map((r) => `<button class="fbtn" data-ml="${r}" aria-pressed="${S.mx.lane === r}">${r}</button>`).join("")}</div>
    <div class="mx-grid">${heroes.map((h) => `<button class="mx-h ${S.mx.hero === h ? "on" : ""}" type="button" data-mh="${esc(h)}">${heroImg(h, 36)}<span class="small">${esc(cap(h))}</span></button>`).join("")}</div>
    ${one ? `<div class="card"><h2>${heroImg(S.mx.hero, 32)} ${esc(cap(S.mx.hero))} against</h2>${[2, 1, -1, -2].map((g) => { const xs = one.filter(([, v]) => v[0] === g); return xs.length ? `<h3><span class="${G[g][2]}">${G[g][0]}</span> ${G[g][1]}</h3><p>${xs.map(([o, v]) => `${heroChip(o)} <span class="muted small">${v[2]}% · ${v[1]} games</span>`).join(" ")}</p>` : ""; }).join("")}</div>` : `<p class="small muted">Pick a hero to see who it counters and who counters it.</p>`}`;
  app.querySelectorAll("[data-ml]").forEach((b) => b.addEventListener("click", () => { S.mx.lane = b.dataset.ml; vMatrix(); }));
  app.querySelectorAll("[data-mh]").forEach((b) => b.addEventListener("click", () => { S.mx.hero = b.dataset.mh; vMatrix(); }));
}
// ---------------------------------------------------------------- heroes
const ROLE_IC = { EXP: "M6 18L18 6M13 6h5v5M6 13l5 5", Jungle: "M12 20c-5-2-7-7-6-13 6 0 10 3 11 8M12 20c0-5 2-8 5-10", Mid: "M12 4l8 8-8 8-8-8z", Gold: "M12 5a7 7 0 100 14 7 7 0 000-14zM12 9v6M10 12h4", Roam: "M12 4l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" };
const metaTabs = (on) => `<nav class="subtabs" aria-label="Meta">${[["#/heroes", "Tier list", "heroes"], ["#/leagues", "By league", "leagues"], ["#/matrix", "Counters", "matrix"], ["#/playbook", "Playbook", "playbook"], ["#/patch", "Patch", "patch"]].map(([h, t, k]) => `<a href="${h}"${k === on ? ' aria-current="page"' : k === "patch" ? ' class="hot"' : ""}>${t}</a>`).join("")}</nav>`;
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

async function vHero(id) {
  const heroes = await load("heroes.json"), h = heroes.find((x) => x.id === id); if (!h) return vMissing();
  const list = (arr, k, label) => arr.length ? `<ul class="plain">${arr.map((x) => `<li class="spread"><span>${heroChip(x[k])}</span><span class="small">${pct(x.wr)}${x.lift != null ? ` <span class="${x.lift > 0 ? "up" : "down"}">${x.lift > 0 ? "+" : ""}${Math.round(x.lift * 100)} vs expected</span>` : ""} <span class="muted">over ${Math.round(x.n)} games</span></span></li>`).join("")}</ul>` : `<p class="small muted">Not enough games ${label}.</p>`;
  const players = (await load("players.json")).filter((p) => p.top?.some((t) => t.h === id)).slice(0, 8);
  app.innerHTML = `<a class="back" href="#/heroes">‹ Heroes</a><div class="ehead">${heroImg(h.id, 72)}<h1 style="margin:0">${esc(cap(h.id))} <span class="tier t${h.tier}">${h.tier}</span></h1></div>
    <div class="statgrid sg4"><div class="stat"><b>${pct(h.recent.presence)}</b><span>Recent presence</span></div><div class="stat"><b>${h.games}</b><span>Pro picks</span></div><div class="stat"><b>${pct(h.wr)}</b><span>Pro win rate</span></div><div class="stat"><b>${h.bans}</b><span>Pro bans</span></div></div>
    <p class="small">Lanes in pro play: ${(h.laneSplit || []).filter((r) => r.share >= 0.02).map((r) => `${esc(r.r)} ${pct(r.share)}`).join(" · ")}${h.flex ? ' <span class="chip">Flex pick</span>' : ""}${h.ranked ? ` · Ranked games (mlbb.io, all players): ${f1(h.ranked.wr)}% win${h.rankedTrend != null ? ` <span class="${h.rankedTrend > 0 ? "up" : h.rankedTrend < 0 ? "down" : "muted"}">${h.rankedTrend > 0 ? "▲" : h.rankedTrend < 0 ? "▼" : "•"} ${h.rankedTrend > 0 ? "+" : ""}${f1(h.rankedTrend)}</span>` : ""}, ${f1(h.ranked.ban)}% ban, tier ${esc(h.ranked.tier)}` : ""}</p>
    ${h.untested ? `<p class="chip warn">Changed in patch ${esc(h.thisPatch?.patch || "")}: no pro games on it yet, so the record below is from before the change.</p>` : ""}
    ${h.timing || h.bestLane ? `<div class="card"><h2>Timing and best lane</h2>${h.timing ? `<p><span class="chip">${esc(h.timing.label)}</span> Wins ${pct(h.timing.short)} of pro games under 13 minutes (${h.timing.ns}) and ${pct(h.timing.long)} of games 18+ minutes (${h.timing.nl}), last 365 days.</p>` : ""}${h.bestLane ? `<table class="ft"><thead><tr><th>Lane</th><th class="n">Record</th><th class="n">Rate</th></tr></thead><tbody>${h.bestLane.map((x, i) => `<tr><td>${esc(x.r)}${i === 0 ? ' <span class="chip">best</span>' : ""}</td><td class="n">${x.w}-${x.n - x.w}</td><td class="n">${pct(x.wr)}</td></tr>`).join("")}</tbody></table>` : ""}<p class="small muted">All pro games in our data, pulled toward 50% on small samples. Lanes with 15+ games.</p></div>` : ""}
    ${h.ratings ? `<div class="card"><h2>Hero profile (0-10)</h2><div class="tgrid2">${Object.entries(h.ratings).map(([k, v]) => `<div class="spread small"><span>${esc(k)} <b>${f1(v)}</b></span><span class="mbar"><span style="width:${v * 10}%"></span></span></div>`).join("")}</div><p class="small muted">Our own ratings: where the hero ranks among all heroes (10 = top), built from the hero's role, specialties, crowd control in its skills and its pro record in short and long games. A flex pick is played in a second lane in 25%+ of pro games, which hides the plan during the draft.</p></div>` : ""}
    <div class="card"><h2>What it brings</h2>${h.lp ? `<p class="small">${esc(h.lp.role || "")}${h.lp.role2 ? " / " + esc(h.lp.role2) : ""} · ${esc(h.lp.lane || "")}${h.lp.spec?.length ? " · " + esc(h.lp.spec.join(", ")) : ""}${Object.entries(h.lp.cc || {}).filter(([, v]) => v).length ? " · CC in skills: " + esc(Object.entries(h.lp.cc).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")) : ""}</p>` : ""}
      <div class="tgrid2">${Object.entries(h.traits || {}).map(([k, v]) => `<div class="spread small"><span>${TRAIT_LBL[k]}</span><span class="mbar"><span style="width:${Math.min(100, v / 1.5 * 100)}%"></span></span></div>`).join("")}</div>
      ${h.shortLong ? `<p class="small">Pro record in games under 14 min: ${h.shortLong.short[0]}-${h.shortLong.short[1] - h.shortLong.short[0]} · 18+ min: ${h.shortLong.long[0]}-${h.shortLong.long[1] - h.shortLong.long[0]}.</p>` : ""}
      ${h.thisPatch ? `<p class="small">Since patch ${esc(h.thisPatch.patch)}: ${h.thisPatch.picks} picks (${h.thisPatch.picks ? pct(h.thisPatch.wins / h.thisPatch.picks) : "-"} won), ${h.thisPatch.bans} bans.</p>` : ""}
      ${h.patches?.length ? `<p class="small">Recent patch changes: ${h.patches.map((p) => `${esc(p.patch)} ${esc(p.type)}`).join(" · ")}</p>` : ""}</div>
    ${h.byLeague?.length ? `<div class="card"><h2>By league</h2><table class="ft"><thead><tr><th>League</th><th class="n">Picked or banned</th><th class="n">Picks</th><th class="n">Bans</th><th class="n">Won</th></tr></thead><tbody>${h.byLeague.map((x) => `<tr><td>${esc(x.league)}</td><td class="n"><b>${pct(x.pres)}</b></td><td class="n">${x.p}</td><td class="n">${x.b}</td><td class="n">${x.wr == null ? "-" : pct(x.wr)}</td></tr>`).join("")}</tbody></table><p class="small muted">Last 150 days of league games. <a href="#/leagues">Meta by league ›</a></p></div>` : ""}
    ${h.laneVs?.length ? `<div class="card"><h2>Lane matchups</h2><table class="ft"><thead><tr><th>Against (same lane)</th><th class="n">Record</th><th class="n">Rate</th></tr></thead><tbody>${h.laneVs.map((x) => `<tr><td>${heroChip(x.vs)} <span class="muted small">${esc(x.role)}</span></td><td class="n">${x.w}-${x.n - x.w}</td><td class="n ${x.wr >= 0.55 ? "up" : x.wr <= 0.45 ? "down" : ""}">${pct(x.wr)}</td></tr>`).join("")}</tbody></table><p class="small muted">The hero against the opposing hero in the same role, last 365 days, pulled toward even on small samples.</p></div>` : ""}
    ${h.rankedCounters ? `<div class="card"><h2>Counters in ranked (all players)</h2><p class="small"><b>Countered by:</b> ${h.rankedCounters.by.map((x) => `${heroChip(x.h)} <span class="muted">${x.adv > 0 ? "+" : ""}${f1(x.adv)}%</span>`).join(" ")}</p>${h.rankedCounters.into.length ? `<p class="small"><b>Does well into:</b> ${h.rankedCounters.into.map((x) => heroChip(x)).join(" ")}</p>` : ""}<p class="small muted">Ranked games, all players, past 7 days (mlbb.io, ${esc(h.rankedCounters.at || "")}). A large sample but not pro play: use it as background behind the pro counters below.</p></div>` : ""}
    <div class="grid two"><div class="card"><h2>Best combos</h2>${list(h.combos, "with", "together")}<h3>Weak pairings</h3>${list(h.combosBad, "with", "together")}</div><div class="card"><h2>Counters (wins against)</h2>${list(h.counters, "vs", "against others")}<h3>Countered by</h3>${list(h.counteredBy, "vs", "against others")}</div></div>
    ${players.length ? `<div class="card"><h2>Players known for it</h2><ul class="plain">${players.map((p) => `<li class="spread"><a href="#/player/${esc(p.id)}">${esc(p.name)}</a><span class="muted small">${esc(p.team)} · ${esc(p.role)}</span></li>`).join("")}</ul></div>` : ""}
    <p class="small muted">Pictures: Liquipedia. Combos are ranked by lift: how much more the pair wins than the two heroes do on their own. Combos and counters: win rate when on the same side / against each other, pulled toward 50% on small samples and fading by half every 120 days. 3+ games needed.</p>`;
}

// ---------------------------------------------------------------- teams and players
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

async function vTeam(id) {
  const t = await load(`teams/${id}.json`), o = t.official, D = await load("draft.json");
  setTimeout(() => { const el = document.getElementById("t-prof"); if (el) el.innerHTML = traitBars(t.profile.draft, null, D.avgLineup, "Their drafts"); }, 0);
  app.innerHTML = `<a class="back" href="#/teams">‹ Teams</a><div class="ehead">${tb(t.name, 64)}<div><h1 style="margin:0">${esc(t.name)}</h1><p class="small muted" style="margin:0">${esc(t.league || "")} · series ${t.series[0]}-${t.series[1]} · games ${t.games[0]}-${t.games[1]} · rating ${t.elo}</p></div></div>
    <p><a class="go" href="#/versus?a=${encodeURIComponent(t.name)}">Versus another team ›</a> <a class="go" href="#/sim?a=${encodeURIComponent(t.name)}">Match simulator ›</a></p>
    <div class="card"><h2>Team archetype</h2><p>${t.profile.archetype.map((a) => `<span class="chip">${esc(a)}</span>`).join(" ")}</p><p class="small muted">Average game ${t.profile.tempo.avgMin ?? "-"} min · ${pct(t.profile.tempo.short)} of games under 14 min · ${pct(t.profile.tempo.long)} of 18+ min. Labels are the traits where they stand out from other teams.</p><div id="t-prof"></div></div>
    <div class="card"><h2>Lineup and hero pools</h2><ul class="plain">${t.roster.map((p) => `<li><div class="spread"><a class="tn" href="#/player/${esc(p.id)}">${face(p.id, p.player, 32)} ${esc(p.player)}</a><span class="muted small">${esc(p.role)}</span></div>${p.pool?.length ? `<div class="pchips">${p.pool.map((x) => `<a class="hchip" href="#/hero/${encodeURIComponent(x.h)}" title="${x.n} games, ${pct(x.wr)} won">${heroImg(x.h, 16)}${esc(cap(x.h))} <span class="muted">${x.n} · ${pct(x.wr)}</span></a>`).join("")}</div>` : ""}</li>`).join("") || `<li class="muted small">No roster on record.</li>`}</ul><p class="small muted">Each player's most-played heroes in their role, all games in our data. Scout what to ban: a deep pool is hard to ban out.</p></div>
    ${t.staff?.list?.length ? `<div class="card"><h2>Coaching staff</h2><ul class="plain">${t.staff.list.map((x) => `<li class="spread"><span>${esc(x.name)}</span><span class="muted small">${esc(x.role)}</span></li>`).join("")}</ul><p class="small muted">From the ${esc(t.staff.page.replace(/\//g, " "))} page on Liquipedia.</p></div>` : ""}
    <div class="grid two"><div class="card"><h2>Battlefield maps</h2>${mapTable(t)}</div><div class="card"><h2>Splits</h2><table class="ft"><tbody>${t.profile.side.blue ? `<tr><td>First pick (blue side)</td><td class="n">${t.profile.side.blue.w}-${t.profile.side.blue.n - t.profile.side.blue.w}</td></tr>` : ""}${t.profile.side.red ? `<tr><td>Second pick (red side)</td><td class="n">${t.profile.side.red.w}-${t.profile.side.red.n - t.profile.side.red.w}</td></tr>` : ""}${Object.entries(t.profile.stages || {}).map(([k, r]) => `<tr><td>${esc(k)}</td><td class="n">${wl(r)}</td></tr>`).join("")}${t.profile.halves ? `<tr><td>Latest season, 1st half</td><td class="n">${wl(t.profile.halves.first)}</td></tr><tr><td>Latest season, 2nd half</td><td class="n">${wl(t.profile.halves.second)}</td></tr>` : ""}</tbody></table><p class="small muted">Games in their last 150 days. Blue side picks first in pro MLBB.</p></div></div>
    ${o ? `<div class="card"><h2>Official ${esc(o.league)} stats</h2><div class="statgrid sg4"><div class="stat"><b>${o.kills}</b><span>Kills</span></div><div class="stat"><b>${o.deaths}</b><span>Deaths</span></div><div class="stat"><b>${o.lord}</b><span>Lords</span></div><div class="stat"><b>${o.turtle}</b><span>Turtles</span></div></div><p class="small muted">Season totals from the league site: ${o.assists} assists, ${o.towers} towers, ${(o.gold / 1e6).toFixed(2)}M gold, ${(o.damage / 1e6).toFixed(2)}M damage.</p></div>` : ""}
    <div class="card"><h2>Comfort picks by role</h2><table class="ft"><thead><tr><th>Role</th><th>Hero</th><th class="n">Games</th><th class="n">Won</th></tr></thead><tbody>${t.profile.comfort.map((c) => `<tr><td>${esc(c.role)}</td><td>${heroChip(c.h)}</td><td class="n">${c.n}</td><td class="n">${pct(c.wr)}</td></tr>`).join("")}</tbody></table><p class="small muted">From their last 150 days of games (${t.profile.games} games).</p></div>
    ${t.profile.firstBan?.length ? `<div class="card"><h2>Ban habits</h2><p class="small"><b>First ban:</b> ${t.profile.firstBan.map((x) => `${heroChip(x.h)} <span class="muted">${x.n}×</span>`).join(" ")}</p><p class="small"><b>First three bans:</b> ${t.profile.phase1Bans.map((x) => `${heroChip(x.h)} <span class="muted">${x.n}×</span>`).join(" ")}</p><p class="small muted">Liquipedia lists bans in the order they were made.</p></div>` : ""}
    <div class="grid two"><div class="card"><h2>They ban most</h2><p>${t.profile.bansTheyMake.map((x) => `${heroChip(x.h)} <span class="muted small">${pct(x.share)}</span>`).join(" ")}</p></div><div class="card"><h2>Banned against them</h2><p>${t.profile.bansAgainstThem.map((x) => `${heroChip(x.h)} <span class="muted small">${pct(x.share)}</span>`).join(" ")}</p></div></div>
    ${t.signature ? `<div class="card"><h2>Signature hero</h2><p>${heroChip(t.signature.hero)} (${esc(t.signature.role)}): ${t.signature.with[0]}-${t.signature.with[1] - t.signature.with[0]} with it, ${t.signature.without[0]}-${t.signature.without[1] - t.signature.without[0]} without.</p></div>` : ""}
    <div class="card"><h2>Recent matches</h2><ul class="plain small">${t.matches.map((m) => `<li class="spread"><span>${esc(dshort(m.date))} · vs ${esc(m.opp)} <span class="muted">${esc(m.league)} ${esc(m.stage)}</span></span><span>${m.score[0] > m.score[1] ? '<b class="up">W</b>' : '<b class="down">L</b>'} ${m.score[0]}-${m.score[1]}</span></li>`).join("")}</ul></div>`;
}
async function vPlayers() {
  const players = await load("players.json"), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"];
  app.innerHTML = `<a class="back" href="#/teams">‹ Teams</a><h1>Players</h1><p class="lead">Heroes credited by role (each game lists picks in role order, matched to that season's lineup), win rates, MVPs and the official league stats where the league site publishes them.</p>
    <input class="field" id="pq" type="search" placeholder="Search a player or team" value="${esc(S.q)}"><div class="filters" role="group" aria-label="Role" style="margin-top:8px"><button class="fbtn" data-pr="" aria-pressed="${!S.role}">All roles</button>${ROLES.map((r) => `<button class="fbtn" data-pr="${r}" aria-pressed="${S.role === r}">${r}</button>`).join("")}</div><div class="tgrid" id="pl"></div>`;
  const draw = () => { const q = S.q.toLowerCase(), f = players.filter((p) => (!S.role || p.role === S.role) && (!q || p.name.toLowerCase().includes(q) || (p.team || "").toLowerCase().includes(q))).slice(0, 80);
    document.getElementById("pl").innerHTML = f.map((p) => `<a class="titem" href="#/player/${esc(p.id)}">${face(p.id, p.name, 44)}<span><span class="t1">${esc(p.name)}</span><span class="t2">${esc(p.team || "")} · ${esc(p.role)} · ${p.games} games · ${esc(p.top.map((t) => cap(t.h)).join(", "))}</span></span><span class="t3">${p.official ? `<b>${f1(p.official.kda)}</b> KDA` : `<b>${pct(p.wr)}</b> won`}<br><span class="muted small">${p.mvp ? `${p.mvp} MVP` : ""}</span></span></a>`).join("") || `<p class="empty">No player matches.</p>`; };
  document.getElementById("pq").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
  app.querySelectorAll("[data-pr]").forEach((b) => b.addEventListener("click", () => { S.role = b.dataset.pr; app.querySelectorAll("[data-pr]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
}
async function vPlayer(id) {
  const p = await load(`players/${id}.json`), o = p.official;
  app.innerHTML = `<a class="back" href="#/players">‹ Players</a><div class="ehead">${face(p.id, p.name, 72)}<div><h1 style="margin:0">${esc(p.name)}</h1><p class="small muted" style="margin:0">${esc(p.role)} · ${esc(p.team || "")} · ${p.games} games, ${pct(p.wr)} won${p.mvp ? ` · ${p.mvp} series MVP` : ""}</p></div></div>
    ${p.arch ? `<p>${p.arch.labels.map((a) => `<span class="chip">${esc(a)}</span>`).join(" ")}</p>` : ""}
    ${o ? `<div class="card"><h2>Official ${esc(o.league)} stats</h2><div class="statgrid sg4"><div class="stat"><b>${f1(o.kda)}</b><span>KDA</span></div><div class="stat"><b>${f1(o.kills)}</b><span>Kills / game</span></div><div class="stat"><b>${f1(o.deaths)}</b><span>Deaths / game</span></div><div class="stat"><b>${f1(o.assists)}</b><span>Assists / game</span></div></div>${o.kp ? `<p class="small muted">Kill participation ${f1(o.kp)}%. Season stats from the league site.</p>` : ""}</div>` : ""}
    ${p.s18 ? `<div class="card"><h2>Season 18 scoreboards: ${esc(p.s18.league)}</h2><div class="statgrid sg4"><div class="stat"><b>${p.s18.wins}-${p.s18.games - p.s18.wins}</b><span>Games</span></div><div class="stat"><b>${pct(p.s18.kp)}</b><span>Kill participation</span></div>${p.s18.gpm ? `<div class="stat"><b>${p.s18.gpm}</b><span>Gold / min</span></div><div class="stat"><b>${pct(p.s18.dmgShare)}</b><span>Team damage</span></div>` : `<div class="stat"><b>${f1(p.s18.kills)}/${f1(p.s18.deaths)}/${f1(p.s18.assists)}</b><span>K / D / A</span></div>`}</div>${p.s18.gpm ? `<p class="small">${f1(p.s18.kills)} / ${f1(p.s18.deaths)} / ${f1(p.s18.assists)} per game · ${pct(p.s18.goldShare)} of team gold · ${p.s18.dpm} damage per minute.</p>` : ""}<h3>Hero records (games this player actually played)</h3><p>${p.s18.heroes.map((x) => `${heroChip(x.h)} <span class="muted small">${x.w}-${x.n - x.w}</span>`).join(" ")}</p><p class="small muted">From the MLBBHub scoreboards (official stats feed), checked against Liquipedia and the MPL PH official site; wins from Liquipedia. ${p.s18.gpm ? "" : "MPL MY scoreboards have no gold or damage."}</p></div>` : ""}
    ${!p.s18 && p.shares ? `<div class="card"><h2>Share of team: MPL PH S18</h2><div class="statgrid sg4"><div class="stat"><b>${pct(p.shares.dmgShare)}</b><span>Hero damage</span></div><div class="stat"><b>${pct(p.shares.goldShare)}</b><span>Gold</span></div><div class="stat"><b>${pct(p.shares.kp)}</b><span>Kill participation</span></div><div class="stat"><b>${pct(p.shares.takenShare)}</b><span>Damage taken</span></div></div><p class="small muted">Average per game over ${p.shares.games} games: ${f1(p.shares.kills)} kills, ${f1(p.shares.deaths)} deaths, ${f1(p.shares.assists)} assists, ${pct(p.shares.towerShare)} of the team's tower damage. An even split is 20%. From the MPL PH official match pages.</p></div>` : ""}
    ${o?.pool?.length ? `<div class="card"><h2>Official hero pool: ${esc(o.league)} S${esc(o.season || "")}</h2><table class="ft"><thead><tr><th>Hero</th><th class="n">Games</th><th class="n">Won</th></tr></thead><tbody>${o.pool.map((x) => `<tr><td>${heroChip(x.h)}</td><td class="n">${x.n}</td><td class="n">${pct(x.wr)}</td></tr>`).join("")}</tbody></table><p class="small muted">From the league site's hero pools for this season, counting the games this player actually played (substitutes separated).</p></div>` : ""}
    ${p.signature.length ? `<div class="card"><h2>Signature heroes</h2><p>${p.signature.map((s) => `${heroChip(s.h)} <span class="muted small">${s.n} games, ${pct(s.wr)}</span>`).join(" · ")}</p></div>` : ""}
    <div class="card"><h2>Hero pool</h2><table class="ft"><thead><tr><th>Hero</th><th class="n">Games</th><th class="n">Won</th></tr></thead><tbody>${p.pool.map((x) => `<tr><td>${heroChip(x.h)}</td><td class="n">${x.n}</td><td class="n">${pct(x.wr)}</td></tr>`).join("")}</tbody></table><p class="small muted">Credited from the player's role pick in each game, using the lineup listed for that season; a game played by a substitute can be credited to the starter.</p></div>
    <p class="small muted">Teams: ${p.teams.map((t) => `${esc(t.t)} (${t.n})`).join(", ")}</p>`;
}

// ---------------------------------------------------------------- M8 World Championship: field and Wildcard
async function vM8() {
  const M = await load("m8.json").catch(() => null); if (!M) { app.innerHTML = `<p class="empty">The M8 field is not available yet.</p>`; return; }
  const row = (t, wild) => `<tr><td>${t.team ? (t.id ? `<a class="tn" href="#/team/${esc(t.id)}">${tb(t.team, 24)} ${esc(t.team)}</a>` : `${tb(t.team, 24)} ${esc(t.team)} <span class="chip warn">no games in our data</span>`) : `<span class="muted">To be decided</span>`}<span class="small muted" style="display:block">via ${esc(t.via)}</span></td><td class="n">${t.elo ?? "-"}</td><td class="n">${t.series ? t.series.join("-") : "-"}</td>${wild ? `<td class="n"><b>${pct(t.pAdvance)}</b></td>` : ""}</tr>`;
  const wild = [...M.wildcard].sort((a, b) => (b.pAdvance || 0) - (a.pAdvance || 0)), main = [...M.main].sort((a, b) => (b.elo || 0) - (a.elo || 0));
  app.innerHTML = `<a class="back" href="#/matches">‹ Matches</a><h1>M8 World Championship</h1><p class="lead">The teams going to M8: Wildcard in Bangkok from December 17, 2026, main stage in Türkiye in January 2027. Slots still to be decided fill in automatically as qualifiers finish.</p>
    <div class="card"><h2>Wildcard: chance to reach the main stage</h2><div class="tw"><table class="ft"><thead><tr><th>Team</th><th class="n">Rating in its league</th><th class="n">Series</th><th class="n">Advance</th></tr></thead><tbody>${wild.map((t) => row(t, true)).join("")}</tbody></table></div>
      <p class="small muted">${esc(M.format)} 20,000 simulated Wildcards. ${esc(M.note)}</p></div>
    <div class="card"><h2>Seeded into the main stage</h2><div class="tw"><table class="ft"><thead><tr><th>Team</th><th class="n">Rating in its league</th><th class="n">Series</th></tr></thead><tbody>${main.map((t) => row(t, false)).join("")}</tbody></table></div>
      <p class="small muted">Ratings are earned inside each league (1500 = that league's average), so a 1900 in one region is not better than a 1700 in another. Compare any two in <a href="#/versus">Versus</a>.</p></div>${M.alsoListed?.length ? `<div class="card"><h2>Also listed on the M8 page</h2><p class="small">${M.alsoListed.map((t) => esc(t.team)).join(", ")}: qualifying slot not confirmed yet.</p></div>` : ""}`;
}
// ---------------------------------------------------------------- picks, more, results
async function vPicks() {
  const { picks, note } = await load("picks.json"), all = picks.filter((p) => Date.parse(p.date) > Date.now() - 3600000), up = all.filter((p) => !p.noPick), close = all.filter((p) => p.noPick);
  app.innerHTML = `<h1>Picks</h1><p class="lead">Our own lines for scheduled MLBB matches: series winner and map count, from the series math. Only teams with 6+ series in our data.</p><div class="callout small">${esc(note)}</div>
    ${up.length ? `<div class="tgrid">${up.map((p) => `<a class="titem" href="#/match/${esc(p.id)}"><span class="pk-p ${p.p >= 0.75 ? "hi" : ""}">${pct(p.p)}</span><span><span class="t1">${esc(p.pick)}</span><span class="t2">${esc(p.game)} · ${esc(p.league)} · ${esc(when(p.date))}</span></span><span class="t3">fair ${dec(p.p)}</span></a>`).join("")}</div>${close.length ? `<h2>Too close to call</h2><ul class="plain small">${close.map((p) => `<li class="spread"><a href="#/match/${esc(p.id)}">${esc(p.game)}</a><span class="muted">${esc(p.pick)} ${pct(p.p)}</span></li>`).join("")}</ul><p class="small muted">Under 60%: we show the chance but make no pick.</p>` : ""}` : `<p class="empty">No scheduled match with both teams set yet. Picks appear as soon as MCT SEA or M8 matchups are known. For now, try <a href="#/versus">Versus</a>.</p>`}`;
}
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

async function vResults() {
  const [res, acc, pt] = await Promise.all([load("results.json"), load("accuracy.json"), load("pretip.json").catch(() => null)]);
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Results and accuracy</h1><p class="lead">Each series projected only from games before it, then graded. The settings are re-chosen from all history each run, which flatters the replay a little; the saved-before-start record is the clean test.</p>
    <div class="card"><h2>The honest test: saved before the match</h2>${pt?.graded ? `<p>${pct(pt.winner)} of ${pt.graded} winners right.</p>` : `<p class="small">No saved match has finished yet (${pt?.waiting || 0} waiting). It fills in from the next scheduled matches.</p>`}</div>
    <div class="statgrid sg4"><div class="stat"><b>${pct(acc.winner)}</b><span>Series winners</span></div><div class="stat"><b>${acc.brier}</b><span>Series Brier</span></div><div class="stat"><b>${acc.games.brierTeam}</b><span>Game Brier (teams)</span></div><div class="stat"><b>${acc.games.brierDraft}</b><span>Game Brier (with draft)</span></div></div>
    <p class="small muted">${acc.graded} graded series. ${esc(acc.rule)}</p>
    <div class="card"><h2>Calibration</h2><table class="ft"><thead><tr><th>We said</th><th class="n">Series</th><th class="n">Favourite won</th></tr></thead><tbody>${acc.calibration.map((b) => `<tr><td>${b.lo}-${b.hi}%</td><td class="n">${b.n}</td><td class="n">${pct(b.rate)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h2>By league</h2><table class="ft"><thead><tr><th>League</th><th class="n">Series</th><th class="n">Winners</th></tr></thead><tbody>${acc.byLeague.map((c) => `<tr><td>${esc(c.league)}${c.low ? ` <span class="chip warn">low confidence: ${c.n}</span>` : ""}</td><td class="n">${c.n}</td><td class="n">${pct(c.winner)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h2>What the model learned</h2><p class="small">Rating speed ${acc.learned.k}, season carry-over ${acc.learned.carry}, region link speed ${acc.learned.kr}, draft weight ${acc.learned.wd}.</p><p class="small muted">${esc(acc.learned.note)} ${acc.grid} combinations tried.</p></div>
    <h2>Latest results</h2><div class="tgrid">${res.slice(0, 80).map(resultRow).join("")}</div>`;
}
function vHow() { app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>How it works</h1>
  <div class="card"><h2>Team ratings and series math</h2><p>Every finished series is replayed in date order, game by game. Each team has a rating that moves after every game; a new season keeps part of it. Region offsets let international results (MSC, M-series) carry over to domestic ratings. A single-game chance turns into a series chance, exact scores and map counts with the best-of math.</p></div>
  <div class="card"><h2>Draft layer: meta, combos, counters</h2><p>From every pro game before the one being predicted: each hero's win record (meta strength), pairs on the same side (combos) and heroes against each other (counters), all pulled toward 50% on small samples and fading by half every 120 days so the current patch counts most. Tested walk-forward once both drafts are known; it is the engine of the Draft lab.</p></div>
  <div class="card"><h2>Scenarios</h2><p>Signature heroes (a team's most-played hero and its record with and without it), likely bans, side records and early-versus-late games, all from each team's last 150 days.</p></div>
  <div class="card"><h2>Players</h2><p>Liquipedia lists each game's picks in role order (EXP, Jungle, Mid, Gold, Roam); each pick is credited to that role in the season's lineup. Official KDA and team objectives come from the league sites where they publish them.</p></div>
  <div class="card"><h2>Learning and honesty</h2><p>Rating speed, season carry-over, region links and the draft weight are chosen by replaying all history (best Brier score). The last projection before each match is frozen and graded after, so it cannot be flattered later. Picks are capped (90% series, 85% maps) and need 6+ series per team.</p></div>`; }
async function vSources() { const meta = await load("meta.json"); app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Data sources</h1>
  <div class="card"><h2>Read</h2><ul class="dots"><li><b>Liquipedia</b> (CC-BY-SA 3.0): matches, full drafts (picks, bans, sides, length, battlefield), MVPs and season lineups for ${esc(meta.leagues.join(", "))}. Read through its API at one request every 2 seconds, only pages that changed.</li><li><b>MPL PH</b> (ph-mpl.com, Data tab) and <b>MPL ID</b> (id-mpl.com, Statistics tab): official player KDA, kills, deaths, assists, kill participation and team kills, gold, damage, Lords, Turtles and towers.</li><li><b>MLBBHub</b> (mlbbhub.com): Season 18 scoreboards for MPL ID, PH and MY, one snapshot of 12 Nov 2026. Used for per-player season numbers and hero records on player pages and in the Draft tab suggestions. Checked first: 498 of 499 games match Liquipedia, and MPL PH matches the official site exactly. Raw scoreboards are not published.</li><li><b>mlbb.io</b>: ranked (all players) counters, past 7 days, current patch: each hero's strongest counters with their win-rate edge, shown on hero pages and as a small background signal in the simulator, never mixed into the pro numbers.</li></ul></div>
  <div class="card"><h2>Checked but not used</h2><ul class="dots"><li>MPL Malaysia site: schedule, teams and MVP pages but no statistics tab, and it does not answer automated requests.</li><li>MLBBHub: not read by the scheduled updates. A one-time snapshot (12 Nov 2026) of its MPL ID, PH and MY Season 18 scoreboards is used for per-player numbers only.</li><li>MLDB: blocked by bot protection. mlbb.rone.dev / arena.rone.dev: its API is closed to automated access (robots.txt). Official mobilelegends.com ranking: its data service is not open to other sites.</li><li>Facebook, Instagram, X, TikTok and Discord: need a login.</li><li>Coaching and draft tools (R7, NYRE, MLBBHub planners, Mobadraft): interactive tools, no data feed.</li><li>No sportsbook data is used for MLBB.</li></ul></div>`; }
function vMissing() { app.innerHTML = `<div class="card"><h2>This page does not exist in the MLBB section</h2><p><a class="go" href="#/matches">MLBB matches ›</a> <a class="go" href="#/more">More ›</a></p></div>`; }

// ---------------------------------------------------------------- router
function stamp(meta) { const el = document.getElementById("updated"); if (el && meta) el.textContent = `Data refreshed ${new Date(meta.built).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} PH time · ${meta.series} series and ${meta.games.toLocaleString()} games graded · ${meta.players} players · ${meta.heroes} heroes.`; }
async function route() {
  document.body.classList.remove("sim-wide-on");
  const seq = (S.seq = (S.seq || 0) + 1), h = location.hash || "#/matches", st = (S.stack ||= []);
  if (st.length > 1 && st[st.length - 2] === h) st.pop(); else if (st[st.length - 1] !== h) st.push(h);
  const [, viewRaw = "matches", arg] = h.split("?")[0].split("/"), view = viewRaw || "matches";
  drawNav(TAB[view] || "matches");
  S.img ||= await load("images.json").catch(() => ({ heroes: {}, teams: {}, players: {} }));
  try { await ({ matches: vMatches, match: vMatch, versus: vVersus, draft: vSim, sim: vSim, picks: vPicks, heroes: vHeroes, hero: vHero, teams: vTeams, team: vTeam, players: vPlayers, player: vPlayer, more: vMore, m8: vM8, library: vLibrary, matrix: vMatrix, leagues: vLeagues, playbook: vPlaybook, patch: vPatch, results: vResults, how: vHow, sources: vSources }[view] || vMissing)(decodeURIComponent(arg || "")); }
  catch (e) { if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">${esc(e.message)}</p><p><a class="go" href="#/matches">Back to matches</a></p></div>`; }
  if (st.length > 1) app.querySelectorAll("a.back").forEach((a) => (a.textContent = "‹ Back"));
  if (S.last !== h) window.scrollTo(0, 0); S.last = h;
  if (!document.getElementById("updated").textContent) load("meta.json").then(stamp).catch(() => {});
}
document.addEventListener("click", (e) => { const a = e.target.closest?.("a.back"); if (a && (S.stack?.length || 0) > 1) { e.preventDefault(); history.back(); } });
addEventListener("hashchange", route);
route();
