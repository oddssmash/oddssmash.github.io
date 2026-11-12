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
const NAV = [["matches", "Matches", "M4 5h16v14H4zM4 10h16M9 5v14"], ["sim", "Simulator", "M5 4h14v16H5zM9 8h6M9 12h6M9 16h3"], ["heroes", "Heroes", "M12 3l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 10l6-1z"], ["teams", "Teams", "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"], ["more", "More", "M4 7h16M4 12h16M4 17h16"]];
const TAB = { matches: "matches", match: "matches", versus: "matches", draft: "sim", sim: "sim", picks: "matches", heroes: "heroes", hero: "heroes", teams: "teams", team: "teams", players: "teams", player: "teams", more: "more", m8: "matches", library: "more", matrix: "heroes", leagues: "heroes", results: "more", how: "more", sources: "more" };
function drawNav(active) { const nav = document.getElementById("nav"); if (!nav.childElementCount) nav.innerHTML = NAV.map(([k, l, d]) => `<a href="#/${k}" data-tab="${k}"><span class="nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span><span class="nav-l">${l}</span></a>`).join("");
  for (const a of nav.children) a.dataset.tab === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); }
document.getElementById("theme").addEventListener("click", () => { const l = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = l ? "light" : "dark"; document.getElementById("theme-color").setAttribute("content", l ? "#f4f5f6" : "#0b0c0d"); try { localStorage.setItem("theme", l ? "light" : "dark"); } catch {} });
document.getElementById("skip").addEventListener("click", () => app.focus());
function bindPick(input, items, label, onPick) { const box = document.getElementById(input.id + "-l");
  input.addEventListener("input", () => { const q = input.value.trim().toLowerCase(); const hits = q ? items.filter((x) => label(x).toLowerCase().includes(q)).slice(0, 8) : [];
    box.innerHTML = hits.map((x) => `<button type="button" class="vs-hit" data-i="${items.indexOf(x)}">${esc(label(x))}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const x = items[+b.dataset.i]; input.value = label(x); box.innerHTML = ""; onPick(x); })); }); }
const pickBox = (id, ph, val = "") => `<div class="vs-pick"><input class="field" id="${id}" type="search" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off" value="${esc(val)}"><div class="vs-list" id="${id}-l"></div></div>`;

// ---------------------------------------------------------------- matches
async function vMatches() {
  const [up, meta, res] = await Promise.all([load("upcoming.json"), load("meta.json"), load("results.json")]);
  app.innerHTML = `<h1>MLBB matches</h1><p class="lead">Series win chance, likely scores, map count and the draft scenarios for every scheduled match in MPL PH, ID, MY and the international events. Times are PH time.</p>
    <div class="grid two"><a class="card menu-i" href="#/versus"><span class="menu-ic" aria-hidden="true">⚔️</span><span><b>Versus</b><span class="small muted" style="display:block">Any team against any team, best of 1, 3, 5 or 7: chance, scores and scenarios.</span></span><span class="menu-c">›</span></a>
      <a class="card menu-i" href="#/m8"><span class="menu-ic" aria-hidden="true">🏆</span><span><b>M8 World Championship</b><span class="small muted" style="display:block">The field, the Wildcard teams and each one's chance to reach the main stage.</span></span><span class="menu-c">›</span></a>
      <a class="card menu-i" href="#/sim"><span class="menu-ic" aria-hidden="true">🧩</span><span><b>Match simulator</b><span class="small muted" style="display:block">Live draft with bans, counter-pick suggestions, draft profile and win chance by game time.</span></span><span class="menu-c">›</span></a>
      <a class="card menu-i" href="#/picks"><span class="menu-ic" aria-hidden="true">⭐</span><span><b>Picks</b><span class="small muted" style="display:block">Our own lines for scheduled matches.</span></span><span class="menu-c">›</span></a></div>
    ${up.length ? up.map((m) => matchCard(m)).join("") : `<div class="card"><h2>No match with both teams set yet</h2><p class="small">MPL PH, ID and MY Season 18 are finished. Next on the calendar: MCT 2026 Southeast Asia (group stage from December 9, teams still to be decided) and the M8 World Championship in Türkiye (January 2027). Matches appear here with projections as soon as both teams are known, and refresh every few hours.</p><p class="small muted">Meanwhile, Versus and the Draft lab work for any pairing.</p></div>`}
    <h2 style="margin-top:18px">Latest results</h2><div class="tgrid">${res.slice(0, 20).map(resultRow).join("")}</div>`;
  stamp(meta);
}
function matchCard(m) {
  const fa = m.pSeries >= 0.5;
  return `<a class="card fgc" href="#/match/${esc(m.id)}"><div class="spread small muted"><span>${esc(m.league)} · ${esc(m.stage)} · Bo${m.bo}</span><span>${esc(when(m.date))}</span></div>
    <div class="gc-h">${tb(m.a, 44)}<div class="gc-m"><b>${esc(m.a)} vs ${esc(m.b)}</b></div>${tb(m.b, 44)}</div>
    <div class="gc-p"><div class="${fa ? "fav" : ""}"><small>${esc(m.a)}</small><strong>${pct(m.pSeries)}</strong></div><div class="${!fa ? "fav" : ""}"><small>${esc(m.b)}</small><strong>${pct(1 - m.pSeries)}</strong></div></div>
    <div class="gc-bar"><span style="flex:${m.pSeries};background:${fa ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - m.pSeries};background:${!fa ? "var(--accent)" : "var(--line-2)"}"></span></div>
    <div class="small"><span class="chip">Single game ${pct(Math.max(m.pGame, 1 - m.pGame))} ${esc(m.pGame >= 0.5 ? m.a : m.b)}</span> <span class="chip">About ${f1(m.expMaps)} maps</span> <span class="chip">Confidence: ${esc(m.confidence)}</span></div></a>`;
}
function resultRow(r) { const aw = r.score[0] > r.score[1];
  return `<div class="titem rs"><span class="rs-c ${r.graded ? (r.right ? "ok" : "no") : ""}">${r.graded ? (r.right ? "✓" : "✗") : "·"}</span><span><span class="t1">${aw ? "<b>" : ""}${esc(r.a)}${aw ? "</b>" : ""} ${r.score[0]}-${r.score[1]} ${!aw ? "<b>" : ""}${esc(r.b)}${!aw ? "</b>" : ""}</span><span class="t2">${esc(dshort(r.date))} · ${esc(r.league)} ${esc(r.stage)} · we said ${esc(r.pSeries >= 0.5 ? r.a : r.b)} ${pct(Math.max(r.pSeries, 1 - r.pSeries))}${r.mvp ? ` · MVP ${esc(r.mvp)}` : ""}</span></span><span></span></div>`; }
async function vMatch(id) { const m = await load(`matches/${id}.json`); app.innerHTML = `<a class="back" href="#/matches">‹ Matches</a><p class="small muted" style="margin:0">${esc(m.league)} · ${esc(m.stage)} · Bo${m.bo} · ${esc(when(m.date))} PH</p>${await matchup(m.a, m.b, m.bo, m)}`; }

// ---------------------------------------------------------------- the matchup view (used by match pages and Versus)
async function matchup(a, b, bo, pre = null) {
  const [ta, tb2] = await Promise.all([load(`teams/${sid(a)}.json`).catch(() => null), load(`teams/${sid(b)}.json`).catch(() => null)]);
  if (!ta || !tb2) return `<p class="empty">One of these teams has too few games in our data.</p>`;
  const pg = pre?.pGame ?? lg(ta.rating - tb2.rating), s = series(pg, bo), fav = s.win >= 0.5 ? ta : tb2;
  const sc = Object.entries(s.scores).sort((x, y) => y[1] - x[1]);
  const over = bo >= 3 ? Object.entries(s.scores).filter(([k]) => k.split("-").reduce((x, y) => +x + +y, 0) > (bo === 3 ? 2.5 : bo === 5 ? 4.5 : 5.5)).reduce((x, [, v]) => x + v, 0) : null;
  const scen = [];
  for (const [t, o, sgn] of [[ta, tb2, 1], [tb2, ta, -1]]) { const sg = t.signature; if (sg && sg.with[1] >= 3) { const adj = Math.max(-0.15, Math.min(0.15, -sg.delta * 0.5)), p2 = Math.min(0.97, Math.max(0.03, pg + sgn * adj)), oBan = o.profile.bansTheyMake.find((x) => x.h === sg.hero);
    scen.push(`<li><b>If ${esc(o.name)} bans ${esc(t.name)}'s ${esc(sg.role)} ${heroChip(sg.hero)}</b>: ${esc(t.name)} are ${sg.with[0]}-${sg.with[1] - sg.with[0]} in games with it and ${sg.without[0]}-${sg.without[1] - sg.without[0]} without. ${esc(ta.name)} would win a game ${pct(p2)} (from ${pct(pg)}) and the series ${pct(series(p2, bo).win)}.${oBan ? ` ${esc(o.name)} ban it in ${pct(oBan.share)} of their games.` : ""}</li>`); } }
  const comfort = (t) => t.profile.comfort.slice(0, 6).map((c) => `${heroChip(c.h)} <span class="muted small">${esc(c.role)} · ${c.n} games, ${pct(c.wr)}</span>`).join("<br>");
  const bans = (arr) => arr.slice(0, 5).map((x) => `${heroChip(x.h)} <span class="muted small">${pct(x.share)}</span>`).join(" ");
  const side = (t) => t.profile.side.blue && t.profile.side.red ? `First pick (blue) ${t.profile.side.blue.w}-${t.profile.side.blue.n - t.profile.side.blue.w} · Second pick (red) ${t.profile.side.red.w}-${t.profile.side.red.n - t.profile.side.red.w}` : "-";
  const mapsBoth = Object.keys(ta.profile.maps || {}).filter((m) => tb2.profile.maps?.[m]).map((m) => { const a1 = ta.profile.maps[m], b1 = tb2.profile.maps[m]; return { m, a1, b1, d: shrunk(a1) - shrunk(b1) }; }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const tempo = (t) => `Under 14 min ${t.profile.early.w}-${t.profile.early.n - t.profile.early.w} · 18+ min ${t.profile.late.w}-${t.profile.late.n - t.profile.late.w}`;
  const h2h = ta.matches.filter((m) => m.opp === tb2.name);
  return `<h1>${esc(fav.name)} ${pct(Math.max(s.win, 1 - s.win))} to win the series</h1>
    <div class="card"><div class="gp-h"><span>${tb(ta.name, 52)}<b>${pct(s.win)}</b></span><span class="muted small">Series (Bo${bo})</span><span><b>${pct(1 - s.win)}</b>${tb(tb2.name, 52)}</span></div>
      <div class="spread"><a href="#/team/${esc(ta.id)}">${esc(ta.name)}</a><a href="#/team/${esc(tb2.id)}">${esc(tb2.name)}</a></div>
      <div class="gc-bar"><span style="flex:${s.win};background:${s.win >= 0.5 ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - s.win};background:${s.win < 0.5 ? "var(--accent)" : "var(--line-2)"}"></span></div>
      <p class="small">Single game: ${esc(pg >= 0.5 ? ta.name : tb2.name)} ${pct(Math.max(pg, 1 - pg))} · ratings ${ta.elo} vs ${tb2.elo}${pre ? ` · confidence ${esc(pre.confidence)}` : ""}</p>
      <table class="ft"><thead><tr><th>Exact score</th><th class="n">Chance</th><th class="n">Fair odds</th></tr></thead><tbody>${sc.map(([k, v]) => { const [x, y] = k.split("-"); return `<tr><td>${esc(+x > +y ? ta.name : tb2.name)} ${Math.max(x, y)}-${Math.min(x, y)}</td><td class="n">${pct(v)}</td><td class="n muted">${dec(v)}</td></tr>`; }).join("")}</tbody></table>
      ${over != null ? `<p class="small">Over ${bo === 3 ? 2.5 : bo === 5 ? 4.5 : 5.5} maps: ${pct(over)} · under ${pct(1 - over)}.</p>` : ""}</div>
    ${scen.length ? `<div class="card"><h2>Scenarios: signature heroes banned</h2><ul class="dots">${scen.join("")}</ul><p class="small muted">From each team's record with and without its most-played hero over its recent games, pulled toward even on small samples, and capped so one ban moves a game by 15 points at most.</p></div>` : ""}
    <div class="grid two"><div class="card"><h2>${esc(ta.name)}: comfort picks</h2><p class="small">${comfort(ta)}</p><h3>They ban most</h3><p>${bans(ta.profile.bansTheyMake)}</p><h3>Banned against them</h3><p>${bans(ta.profile.bansAgainstThem)}</p><p class="small muted">${side(ta)} · ${tempo(ta)}</p></div>
      <div class="card"><h2>${esc(tb2.name)}: comfort picks</h2><p class="small">${comfort(tb2)}</p><h3>They ban most</h3><p>${bans(tb2.profile.bansTheyMake)}</p><h3>Banned against them</h3><p>${bans(tb2.profile.bansAgainstThem)}</p><p class="small muted">${side(tb2)} · ${tempo(tb2)}</p></div></div>
    ${mapsBoth.length ? `<div class="card"><h2>Battlefield maps</h2><table class="ft"><thead><tr><th>Map</th><th class="n">${esc(ta.name)}</th><th class="n">${esc(tb2.name)}</th><th>Edge</th></tr></thead><tbody>${mapsBoth.map((x) => `<tr><td>${esc(x.m)}</td><td class="n">${wl(x.a1)}</td><td class="n">${wl(x.b1)}</td><td class="small">${Math.abs(x.d) < 0.08 ? '<span class="muted">even</span>' : esc(x.d > 0 ? ta.name : tb2.name)}</td></tr>`).join("")}</tbody></table><p class="small muted">Recent games on each annual map event, pulled toward even on small samples. A map shows only when both teams have played on it.</p></div>` : ""}
    <div class="card"><h2>Likely bans</h2>${[ta, tb2].map((t) => t.profile.firstBan?.length ? `<p class="small"><b>${esc(t.name)} usually open with</b> ${t.profile.firstBan.slice(0, 3).map((x) => `${heroChip(x.h)} <span class="muted">${x.n}×</span>`).join(" ")}</p>` : "").join("")}<p class="small">${esc(tb2.name)} will want to take away ${ta.profile.comfort.slice(0, 3).map((c) => heroChip(c.h)).join(", ")}; ${esc(ta.name)} will look at ${tb2.profile.comfort.slice(0, 3).map((c) => heroChip(c.h)).join(", ")}. Try any draft in the <a href="#/sim?a=${encodeURIComponent(ta.name)}&b=${encodeURIComponent(tb2.name)}">Draft lab</a>.</p></div>
    <div class="card"><h2>Head-to-head</h2>${h2h.length ? `<ul class="plain small">${h2h.map((m) => `<li class="spread"><span>${esc(dshort(m.date))} · ${esc(m.league)} ${esc(m.stage)}</span><span>${m.score[0] > m.score[1] ? '<b class="up">W</b>' : '<b class="down">L</b>'} ${m.score[0]}-${m.score[1]}</span></li>`).join("")}</ul>` : `<p class="small muted">No meetings in our data (last 30 matches of ${esc(ta.name)}).</p>`}</div>
    <div class="grid two">${[ta, tb2].map((t) => `<div class="card"><h2>${esc(t.name)} lineup</h2><ul class="plain">${t.roster.map((p) => `<li class="spread"><a class="tn" href="#/player/${esc(p.id)}">${face(p.id, p.player, 32)} ${esc(p.player)}</a><span class="muted small">${esc(p.role)}</span></li>`).join("") || `<li class="muted small">No roster on record.</li>`}</ul></div>`).join("")}</div>`;
}
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
  const qs = new URLSearchParams(location.hash.split("?")[1] || ""), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"], names = heroes.map((h) => h.id).sort();
  const st = (S.sim ||= { a: teams.find((t) => t.name === qs.get("a")) || null, b: teams.find((t) => t.name === qs.get("b")) || null, h1: ["", "", "", "", ""], h2: ["", "", "", "", ""], b1: ["", "", "", "", ""], b2: ["", "", "", "", ""], used1: [], used2: [], series: false });
  if (qs.get("a")) st.a = teams.find((t) => t.name === qs.get("a")) || st.a; if (qs.get("b")) st.b = teams.find((t) => t.name === qs.get("b")) || st.b;
  const sh = (rec, k) => (rec ? logit((rec[1] + k) / (rec[0] + 2 * k)) : 0), pk = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const lgShort = (h) => { const v = D.shortLong[h]; return v ? logit((v.short[0] + 4) / (v.short[1] + 8)) : 0; }, lgLong = (h) => { const v = D.shortLong[h]; return v ? logit((v.long[0] + 4) / (v.long[1] + 8)) : 0; };
  const prof = (hs) => { const p = {}; for (const k of Object.keys(TRAIT_LBL)) p[k] = hs.reduce((a, h) => a + (D.traits[h]?.[k] || 0), 0); return p; };
  const detail = async (t) => { if (!t) return null; const d = await load(`teams/${sid(t.name)}.json`).catch(() => null); if (!d) return null; const pl = await Promise.all(d.roster.map((r) => load(`players/${r.id}.json`).catch(() => null))); return { d, pl }; };
  const [dA, dB] = await Promise.all([detail(st.a), detail(st.b)]);
  const MAPS = Object.fromEntries(Object.entries(await load("maps.json").catch(() => ({}))).map(([k, v]) => [k.trim(), v]).filter(([, v]) => v.games >= 10));
  // draft plan (coaching-board style): what each side should ban first, and the fallback per role if a comfort pick is banned
  const plan = (me, them) => { if (!me || !them) return "";
    const targets = them.d.profile.comfort.filter((c) => c.n >= 3).map((c) => ({ ...c, score: c.n * (c.wr - 0.35) })).sort((a, b) => b.score - a.score).slice(0, 6);
    const alt = ["EXP", "Jungle", "Mid", "Gold", "Roam"].map((r) => { const c = me.d.profile.comfort.filter((x) => x.role === r).slice(0, 3); return c.length ? `<li><b>${r}:</b> ${c.map((x, i) => `${i ? "if banned → " : ""}${heroChip(x.h)} <span class="muted small">${x.n}g ${pct(x.wr)}</span>`).join(" ")}</li>` : ""; }).join("");
    return `<div class="card"><h2>Draft plan: ${esc(me.d.name)}</h2><h3>Ban priority against ${esc(them.d.name)}</h3><ol class="small">${targets.map((t) => `<li>${heroChip(t.h)} <span class="muted">their ${esc(t.role)} · ${t.n} games, ${pct(t.wr)} won</span></li>`).join("")}</ol><h3>Picks by role, with fallbacks</h3><ul class="plain small">${alt}</ul><p class="small muted">From both teams' last 150 days of games. Win condition: ${esc(me.d.profile.archetype.join(", "))}.</p></div>`; };
  const taken = () => new Set([...st.h1, ...st.h2, ...st.b1, ...st.b2].filter(Boolean));
  // suggestion score for side s (1 or 2), role i
  const suggest = (s, i) => {
    const mine = (s === 1 ? st.h1 : st.h2).filter(Boolean), opp = (s === 1 ? st.h2 : st.h1).filter(Boolean), used = new Set(st.series ? (s === 1 ? st.used1 : st.used2) : []), tk = taken(), det = s === 1 ? dA : dB;
    const comfort = new Map((det?.d.profile.comfort || []).filter((c) => c.role === ROLES[i]).map((c) => [c.h, c]));
    const player = det?.pl.find((p) => p && p.role === ROLES[i]), ppool = new Map((player?.pool || []).map((x) => [x.h, x]));
    return heroes.filter((h) => !tk.has(h.id) && !used.has(h.id) && (h.roles[0]?.r === ROLES[i] || h.roles[1]?.r === ROLES[i] || ppool.has(h.id))).map((h) => {
      const meta = sh(D.heroes[h.id], 4) * D.scale.hero * 2, cnt = opp.reduce((a, o) => a + sh(D.vs[`${h.id}>${o}`], 3), 0) * D.scale.cnt * 2, syn = mine.reduce((a, o) => a + sh(D.pairs[pk(h.id, o)], 3), 0) * D.scale.syn * 2;
      const c = comfort.get(h.id), pp = ppool.get(h.id), team = c ? Math.min(0.3, c.n * 0.03) : 0, own = pp ? Math.min(0.35, pp.n * 0.02) + (pp.wr - 0.5) * 0.3 : -0.1;
      const oppDet = s === 1 ? dB : dA, deny = (oppDet?.d.profile.comfort || []).find((x) => x.h === h.id && x.n >= 3), flex = h.flex && h.laneSplit?.length > 1, cur = prof(mine), need = mine.length >= 2 ? [["tank", "adds frontline"], ["cc", "adds crowd control"], ["dmg", "adds damage"]].find(([k]) => cur[k] < (D.avgLineup[k] || 0) * (mine.length / 5) * 0.7 && (D.traits[h.id]?.[k] || 0) > (D.avgLineup[k] || 0) / 5 * 1.2) : null;
      const rkHits = opp.map((o) => ({ o, x: byId[o]?.rankedCounters?.by.find((y) => y.h === h.id) })).filter((y) => y.x), rk = rkHits.reduce((a, y) => a + y.x.adv, 0);
      const why = [rkHits.length ? `ranked (all players): counters ${rkHits.map((y) => `${cap(y.o)} +${f1(y.x.adv)}%`).join(", ")}` : null, deny ? `denial: ${oppDet.d.name}'s ${deny.role} comfort (${deny.n} games)` : null, flex ? `flex: hides your lane (${h.laneSplit.slice(0, 2).map((x) => x.r).join("/")})` : null, need ? `comp completeness: ${need[1]}` : null, cnt > 0.05 ? "counters their picks" : null, syn > 0.05 ? "combos with your picks" : null, meta > 0.08 ? "strong in the meta" : null, c ? `${det.d.name} comfort (${c.n} games)` : null, pp ? `${player.name}: ${pp.n} games, ${pct(pp.wr)}` : null].filter(Boolean);
      return { h: h.id, score: meta + cnt + syn + team + own + rk * 0.01 + (deny ? 0.08 : 0) + (flex ? 0.03 : 0) + (need ? 0.06 : 0), why };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
  };
  // first-pick side edge: the league's blue-side record, pulled hard toward even (100 games of 50%)
  const sideRate = () => { const lgName = (st.a || st.b)?.league, L = LGS?.leagues.find((x) => x.league === lgName), r = L?.blue || LGS?.blueAll || [0, 0]; return { rate: (r[0] + 50) / (r[1] + 100), n: r[1], league: L ? L.league : "all leagues" }; };
  const sideShift = () => (st.fp === 1 ? 1 : st.fp === 2 ? -1 : 0) * logit(sideRate().rate);
  const byId = Object.fromEntries(heroes.map((h) => [h.id, h]));
  const compute = () => {
    const h1 = st.h1.filter(Boolean), h2 = st.h2.filter(Boolean);
    const hero = h1.reduce((x, h) => x + sh(D.heroes[h], 4), 0) - h2.reduce((x, h) => x + sh(D.heroes[h], 4), 0);
    let syn = 0, cnt = 0; for (const [hs, sg] of [[h1, 1], [h2, -1]]) for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) syn += sg * sh(D.pairs[pk(hs[i], hs[j])], 3);
    for (const a of h1) for (const b of h2) cnt += sh(D.vs[`${a}>${b}`], 3);
    const base = st.a && st.b ? st.a.rating - st.b.rating : 0, edge = D.wd * (hero * D.scale.hero + syn * D.scale.syn + cnt * D.scale.cnt), pSide = sideShift(), p = lg(base + edge + pSide);
    const es = (h1.reduce((a, h) => a + lgShort(h), 0) - h2.reduce((a, h) => a + lgShort(h), 0)) * 0.25, el = (h1.reduce((a, h) => a + lgLong(h), 0) - h2.reduce((a, h) => a + lgLong(h), 0)) * 0.25;
    const at = (min) => { const w = Math.max(0, Math.min(1, (min - 12) / 8)); return lg(logit(p) + es * (1 - w) + el * w); };
    // 10,000 games: length from a pro-like spread (mean about 16 minutes), winner from the chance at that length
    let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); let wins = 0, long = 0, sumLen = 0; const N = 10000;
    for (let i = 0; i < N; i++) { const len = Math.max(8, 16 + (rnd() + rnd() + rnd() - 1.5) * 6 + (el - es) * 2); sumLen += len; if (len >= 20) long++; if (rnd() < at(len)) wins++; }
    return { p, base, edge, pSide, at, sim: { win: wins / N, avgLen: sumLen / N, long: long / N }, pA: prof(h1), pB: prof(h2), h1, h2 };
  };
  // TEAM DRAFT PICKER: a team's likely draft (comfort hero per role), any of its recent pro drafts, and each
  // role's player pool as quick picks under the slot.
  const pastGames = async (t) => { if (!t?.league) return []; const rows = await load(`library/${sid(t.league)}.json`).catch(() => []); return rows.filter((r) => r[2] === t.name || r[3] === t.name).slice(0, 25); };
  const [pgA, pgB] = await Promise.all([pastGames(st.a), pastGames(st.b)]);
  const teamCtl = (side) => { const t = side === 1 ? st.a : st.b, pg = side === 1 ? pgA : pgB; if (!t) return "";
    return `<div class="tdp"><button class="btn sm" type="button" data-fill="${side}">Fill likely draft</button>
      <select class="field" data-past="${side}" aria-label="Load one of ${esc(t.name)}'s past drafts"><option value="">Load a past draft of ${esc(t.name)}…</option>${pg.map((r, i) => `<option value="${i}">${esc(r[0] || "")} · vs ${esc(r[2] === t.name ? r[3] : r[2])} · ${esc(r[1] || "")} G${r[5]} · ${(r[2] === t.name ? r[6] === 1 : r[6] === 2) ? "won" : "lost"}</option>`).join("")}</select></div>`; };
  const poolChips = (side, i) => { const det = side === 1 ? dA : dB; if (!det) return ""; const pl = det.pl.find((p) => p && p.role === ["EXP", "Jungle", "Mid", "Gold", "Roam"][i]); if (!pl) return "";
    return `<div class="pchips"><span class="muted small">${esc(pl.name)}:</span>${pl.pool.slice(0, 6).map((x) => `<button class="hchip" type="button" data-pool="${side},${i},${esc(x.h)}" title="${x.n} games, ${pct(x.wr)} won">${heroImg(x.h, 16)}${esc(cap(x.h))} <span class="muted">${x.n}</span></button>`).join("")}</div>`; };
  const slot = (side, i, kind) => { const v = st[`${kind}${side}`][i]; return `<div class="dl-slot"><span class="muted small">${kind === "h" ? ROLES[i] : `Ban ${i + 1}`}</span>${pickBox(`s${kind}${side}${i}`, kind === "h" ? "Hero" : "Ban", cap(v))}</div>${kind === "h" ? poolChips(side, i) : ""}`; };
  const sugBox = (side) => { const arr = (side === 1 ? st.h1 : st.h2), i = arr.findIndex((x) => !x); if (i < 0) return ""; const sg = suggest(side, i);
    return `<div class="sug"><b class="small">Suggested ${ROLES[i]} for ${esc((side === 1 ? st.a : st.b)?.name || `side ${side === 1 ? "A" : "B"}`)}</b>${sg.map((x) => `<button class="hchip" type="button" data-sug="${side},${i},${esc(x.h)}" title="${esc(x.why.join("; "))}">${esc(cap(x.h))}</button>`).join("")}<span class="small muted" style="display:block">${esc(sg[0]?.why.join(" · ") || "")}</span></div>`; };
  const compCard = (r, A, B) => { if (r.h1.length < 3 || r.h2.length < 3) return "";
    const ca = compScore(r.pA, D.avgLineup), cb = compScore(r.pB, D.avgLineup), e = r.at(10), l = r.at(25), notes = [];
    const early = e > l ? A : B, late = e > l ? B : A, swing = Math.abs(l - e);
    if (swing >= 0.04) { notes.push(`<b>${esc(late)} outscale:</b> their chance grows from ${pct(e > l ? 1 - e : e)} at 10 minutes to ${pct(e > l ? 1 - l : l)} at 25+. They should trade objectives instead of fighting early, protect the Gold lane until its core items, and defend towers.`);
      notes.push(`<b>${esc(early)} must end it:</b> group after the first tower, invade the enemy jungle, contest every Turtle and look for Lord before 16 minutes.`); }
    else notes.push("Neither side gains much with time: the game is decided by who wins the fights, not by a power spike.");
    const ccA = ca["Crowd control"], ccB = cb["Crowd control"]; if (Math.abs(ccA - ccB) >= 1.5) notes.push(`<b>${esc(ccA > ccB ? A : B)} have more crowd control:</b> fight in choke points and around Lord and Turtle, where enemies cannot spread out.`);
    const pmA = ca.Playmaking, pmB = cb.Playmaking; if (Math.abs(pmA - pmB) >= 1.5) notes.push(`<b>${esc(pmA > pmB ? A : B)} have the better pick-off tools:</b> look for catches in the side lanes and river; the other side should move in groups and keep vision.`);
    const dfA = ca.Defensive, dfB = cb.Defensive; if (Math.abs(dfA - dfB) >= 1.5) notes.push(`<b>${esc(dfA > dfB ? B : A)} lack frontline:</b> poke before engaging and avoid head-on fights.`);
    const mcA = ca["Map control"], mcB = cb["Map control"]; if (Math.abs(mcA - mcB) >= 1.5) notes.push(`<b>${esc(mcA > mcB ? A : B)} control the map better:</b> split push to draw rotations, then take objectives on the far side.`);
    return `<h3>Comp identity</h3><table class="ft"><thead><tr><th></th><th class="n">${esc(A)}</th><th class="n">${esc(B)}</th></tr></thead><tbody>${Object.keys(COMP).map((k) => `<tr><td>${k}</td><td class="n${ca[k] > cb[k] + 0.9 ? " up" : ""}">${f1(ca[k])}</td><td class="n${cb[k] > ca[k] + 0.9 ? " up" : ""}">${f1(cb[k])}</td></tr>`).join("")}</tbody></table><p class="small muted">0-10, where 5 is the average pro lineup.</p>
${(() => { const mages = (hs) => hs.filter((h) => byId[h]?.lp?.role === "Mage").length, extra = [];
        for (const [hs, me, them] of [[r.h1, A, B], [r.h2, B, A]]) if (mages(hs) >= 3) extra.push(`<b>${esc(me)} lean on magic damage</b> (${mages(hs)} mages): ${esc(them)} can dive the backline with assassins and push side lanes, or build magic defence early.`);
        extra.push("Objective order for both sides: towers first, then Turtle, then Lord; kills only when they lead to one of these.");
        extra.push(`If ${esc(l > e ? A : B)} fall behind early: keep trades even, answer an enemy Lord by taking towers or buffs elsewhere, and wait for the power spike around minute 16.`);
        notes.push(...extra); return ""; })()}
      <h3>Coaching notes: win conditions</h3><ul class="dots small">${notes.map((x) => `<li>${x}</li>`).join("")}</ul><p class="small muted">General MLBB macro applied to this draft's timing and traits; not from any team's playbook.</p>`; };
  const draw = () => { const r = compute(), A = st.a?.name || "Side A", B = st.b?.name || "Side B", wa = draftWarnings(r.pA, D.avgLineup, r.h1.length), wb = draftWarnings(r.pB, D.avgLineup, r.h2.length);
    document.getElementById("sim-sug").innerHTML = sugBox(1) + sugBox(2);
    document.getElementById("sim-plan").innerHTML = dA && dB ? `<div class="grid two">${plan(dA, dB)}${plan(dB, dA)}</div>` : "";
    const MI = st.map && MAPS[st.map]; document.getElementById("sim-mapinfo").innerHTML = MI ? `Blue side has won ${pct(MI.blueWin)} of ${MI.games} pro games on ${esc(st.map)}.${[st.a, st.b].filter(Boolean).map((t) => { const r = MI.teams[t.name]; return r ? ` ${esc(t.name)} ${r[0]}-${r[1] - r[0]} here.` : ""; }).join("")}${[...st.h1, ...st.h2].filter(Boolean).map((h) => { const r = MI.heroes[h]; return r ? ` ${cap(h)} ${r[0]}-${r[1] - r[0]}.` : ""; }).join("")}` : st.map ? "Few pro games on record for this map." : "Map events are recorded for recent seasons only.";
    document.getElementById("sim-out").innerHTML = `<div class="card"><div class="gp-h"><span><b>${pct(r.p)}</b></span><span class="muted small">Win chance this game</span><span><b>${pct(1 - r.p)}</b></span></div><div class="spread"><span>${esc(A)}</span><span>${esc(B)}</span></div>
      <div class="gc-bar"><span style="flex:${r.p};background:${r.p >= 0.5 ? "var(--accent)" : "var(--line-2)"}"></span><span style="flex:${1 - r.p};background:${r.p < 0.5 ? "var(--accent)" : "var(--line-2)"}"></span></div>
      <p class="small">${st.fp ? `${esc(st.fp === 1 ? A : B)} pick first: blue side wins ${pct(sideRate().rate)} in ${esc(sideRate().league)} after pulling toward even (${sideRate().n} games). ` : ""}Teams alone: ${pct(lg(r.base))} for ${esc(A)}; the draft moves it ${lg(r.base + r.edge) - lg(r.base) >= 0 ? "+" : ""}${Math.round((lg(r.base + r.edge) - lg(r.base)) * 100)} points${st.fp ? `, the first pick ${r.pSide >= 0 ? "+" : ""}${Math.round((r.p - lg(r.base + r.edge)) * 100)}` : ""}.</p>
      <table class="ft"><thead><tr><th>If the game ends at</th>${[10, 15, 20, 25].map((m) => `<th class="n">${m}${m === 25 ? "+" : ""} min</th>`).join("")}</tr></thead><tbody><tr><td>${esc(A)} wins</td>${[10, 15, 20, 25].map((m) => `<td class="n">${pct(r.at(m))}</td>`).join("")}</tr></tbody></table>
      <p class="small">10,000 simulated games: ${esc(A)} wins ${pct(r.sim.win)} · average length ${f1(r.sim.avgLen)} min · ${pct(r.sim.long)} go 20+ minutes.</p></div>
      <div class="card"><h2>Draft profile</h2><p class="small"><b>${esc(A)}:</b> ${esc(draftIdentity(r.pA, D.avgLineup))} · <b>${esc(B)}:</b> ${esc(draftIdentity(r.pB, D.avgLineup))}</p>${traitBars(r.pA, r.pB, D.avgLineup, A, B)}
        ${wa.length || wb.length ? `<ul class="dots small">${wa.map((x) => `<li><b>${esc(A)}:</b> ${esc(x)}</li>`).join("")}${wb.map((x) => `<li><b>${esc(B)}:</b> ${esc(x)}</li>`).join("")}</ul>` : ""}
        ${compCard(r, A, B)}
        <p class="small muted">Traits per hero come from its role, specialties and the crowd control in its skills (Liquipedia), and early/late from its pro record in games under 14 minutes vs 18+ minutes. Current patch: ${esc(D.patch?.patch || "-")}.</p></div>`; };
  app.innerHTML = `<h1>Match simulator</h1><p class="lead">Set up a live draft: teams, bans and picks by role. Get counter-pick suggestions for the next open slot (counters to their picks, combos with yours, the meta, the team's comfort picks and the player's own record on the hero), then see the draft profile and the win chance by game time.</p>
    <div class="filters" role="group" aria-label="First pick"><span class="small muted" style="align-self:center">First pick (blue side):</span>${[[0, "Not set"], [1, st.a?.name || "Side A"], [2, st.b?.name || "Side B"]].map(([v, l]) => `<button class="fbtn" type="button" data-fp="${v}" aria-pressed="${(st.fp || 0) === v}">${esc(l)}</button>`).join("")}</div>
    <label class="small"><input type="checkbox" id="sim-series" ${st.series ? "checked" : ""}> Series mode: heroes a team already used in this series are locked for that team (global ban)</label>
    <div class="grid two"><div class="card"><h2>Side A</h2>${pickBox("sta", "Team (optional)", st.a?.name || "")}${teamCtl(1)}<h3>Bans</h3>${[0, 1, 2, 3, 4].map((i) => slot(1, i, "b")).join("")}<h3>Picks</h3>${[0, 1, 2, 3, 4].map((i) => slot(1, i, "h")).join("")}</div>
      <div class="card"><h2>Side B</h2>${pickBox("stb", "Team (optional)", st.b?.name || "")}${teamCtl(2)}<h3>Bans</h3>${[0, 1, 2, 3, 4].map((i) => slot(2, i, "b")).join("")}<h3>Picks</h3>${[0, 1, 2, 3, 4].map((i) => slot(2, i, "h")).join("")}</div></div>
    <div class="card"><label class="small" for="sim-map">Battlefield (annual map event)</label><select class="field" id="sim-map"><option value="">Not set</option>${Object.keys(MAPS).map((k) => `<option${st.map === k ? " selected" : ""}>${esc(k)}</option>`).join("")}</select><div id="sim-mapinfo" class="small" style="margin-top:6px"></div></div>
    <div id="sim-plan"></div><div id="sim-sug" class="card"></div><div id="sim-out"></div>
    <p><button class="btn" type="button" id="sim-next">Next game in the series (lock these picks, clear the board)</button> <button class="btn" type="button" id="sim-reset">Reset</button></p>`;
  document.getElementById("sim-map").addEventListener("change", (e) => { st.map = e.target.value; draw(); });
  const setSide = (side, picks, bans) => { if (picks) st[`h${side}`] = picks.map((h) => h || ""); if (bans) st[`b${side}`] = [0, 1, 2, 3, 4].map((i) => bans[i] || ""); vSim(); };
  app.querySelectorAll("[data-fill]").forEach((b) => b.addEventListener("click", () => { const side = +b.dataset.fill, det = side === 1 ? dA : dB, used = new Set([...st.h1, ...st.h2].filter(Boolean));
    const picks = ["EXP", "Jungle", "Mid", "Gold", "Roam"].map((r) => { const c = (det?.d.profile.comfort || []).filter((x) => x.role === r && !used.has(x.h))[0] || null; if (c) used.add(c.h); return c?.h || ""; }); setSide(side, picks, null); }));
  app.querySelectorAll("[data-past]").forEach((sel) => sel.addEventListener("change", () => { if (sel.value === "") return; const side = +sel.dataset.past, t = side === 1 ? st.a : st.b, r = (side === 1 ? pgA : pgB)[+sel.value]; if (!r) return;
    const mine = r[2] === t.name; setSide(side, mine ? r[10] : r[11], mine ? r[12] : r[13]); }));
  app.querySelectorAll("[data-pool]").forEach((b) => b.addEventListener("click", () => { const [side, i, h] = b.dataset.pool.split(","); st[`h${side}`][+i] = h; vSim(); }));
  bindPick(document.getElementById("sta"), teams, (t) => `${t.name} (${t.region})`, (t) => { st.a = t; vSim(); });
  bindPick(document.getElementById("stb"), teams, (t) => `${t.name} (${t.region})`, (t) => { st.b = t; vSim(); });
  for (const side of [1, 2]) for (const kind of ["h", "b"]) for (let i = 0; i < 5; i++) { const inp = document.getElementById(`s${kind}${side}${i}`); bindPick(inp, names, (h) => cap(h), (h) => { st[`${kind}${side}`][i] = h; draw(); }); inp.addEventListener("change", () => { if (!inp.value) { st[`${kind}${side}`][i] = ""; draw(); } }); }
  document.getElementById("sim-sug").addEventListener("click", (e) => { const b = e.target.closest("[data-sug]"); if (!b) return; const [side, i, h] = b.dataset.sug.split(","); st[`h${side}`][+i] = h; document.getElementById(`sh${side}${i}`).value = cap(h); draw(); });
  app.querySelectorAll("[data-fp]").forEach((b) => b.addEventListener("click", () => { st.fp = +b.dataset.fp; app.querySelectorAll("[data-fp]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  document.getElementById("sim-series").addEventListener("change", (e) => { st.series = e.target.checked; draw(); });
  document.getElementById("sim-next").addEventListener("click", () => { st.used1.push(...st.h1.filter(Boolean)); st.used2.push(...st.h2.filter(Boolean)); st.series = true; for (const k of ["h1", "h2", "b1", "b2"]) st[k] = ["", "", "", "", ""]; vSim(); });
  document.getElementById("sim-reset").addEventListener("click", () => { S.sim = null; vSim(); });
  draw();
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
  app.innerHTML = `<a class="back" href="#/heroes">‹ Heroes</a><h1>Meta by league</h1><p class="lead">Each region plays its own meta, so a hero that is a must-ban in one league can be ignored in another. ${esc(L.note)}</p>
    <div class="filters" role="group" aria-label="League">${L.leagues.map((y) => `<button class="fbtn" data-lgm="${esc(y.league)}" aria-pressed="${y.league === x.league}">${esc(y.league)}</button>`).join("")}</div>
    <div class="statgrid sg4"><div class="stat"><b>${x.games}</b><span>Games</span></div><div class="stat"><b>${bw == null ? "-" : pct(bw)}</b><span>First-pick (blue) side wins</span></div><div class="stat"><b>${all == null ? "-" : pct(all)}</b><span>All leagues</span></div><div class="stat"><b>${x.medianMin ?? "-"}</b><span>Median game (min)</span></div></div>
    <div class="card"><h2>Most contested heroes</h2><table class="ft"><thead><tr><th>Hero</th><th class="n">Picked or banned</th><th class="n">Picks</th><th class="n">Bans</th><th class="n">Won when picked</th></tr></thead><tbody>${x.top.map((h) => `<tr><td>${heroChip(h.h)}</td><td class="n"><b>${pct(h.pres)}</b></td><td class="n">${h.p}</td><td class="n">${h.b}</td><td class="n">${h.wr == null ? "-" : pct(h.wr)}</td></tr>`).join("")}</tbody></table></div>
    <div class="grid two"><div class="card"><h2>First ban of the draft (B1, blue)</h2><p>${x.b1.map((h) => `${heroChip(h.h)} <span class="muted small">${h.n}×</span>`).join(" ")}</p></div><div class="card"><h2>Red side's first ban (B2)</h2><p>${x.b2.map((h) => `${heroChip(h.h)} <span class="muted small">${h.n}×</span>`).join(" ")}</p></div></div>
    <p class="small muted">Source: Liquipedia match pages. Blue side bans and picks first. A first-pick edge under about 55% on a hundred-odd games is within normal variation.</p>`;
  app.querySelectorAll("[data-lgm]").forEach((b) => b.addEventListener("click", () => { S.lgm = b.dataset.lgm; vLeagues(); }));
}
// ---------------------------------------------------------------- Counter matrix
async function vMatrix() {
  const M = await load("matrix.json"); S.mx ||= { lane: "", hero: "" };
  const G = { 2: ["▲▲", "Hard counter", "mx2"], 1: ["▲", "Favoured", "mx1"], "-1": ["▼", "Losing", "mxm1"], "-2": ["▼▼", "Hard loss", "mxm2"] };
  const heroes = Object.keys(M.m).filter((h) => !S.mx.lane || M.lanes[h] === S.mx.lane).sort();
  const one = S.mx.hero && M.m[S.mx.hero] ? Object.entries(M.m[S.mx.hero]).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]) : null;
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Counter matrix</h1><p class="lead">How each hero has done against others in pro games. ${esc(M.note)}</p>
    <div class="filters" role="group" aria-label="Lane"><button class="fbtn" data-ml="" aria-pressed="${!S.mx.lane}">All</button>${["EXP", "Jungle", "Mid", "Gold", "Roam"].map((r) => `<button class="fbtn" data-ml="${r}" aria-pressed="${S.mx.lane === r}">${r}</button>`).join("")}</div>
    <div class="mx-grid">${heroes.map((h) => `<button class="mx-h ${S.mx.hero === h ? "on" : ""}" type="button" data-mh="${esc(h)}">${heroImg(h, 36)}<span class="small">${esc(cap(h))}</span></button>`).join("")}</div>
    ${one ? `<div class="card"><h2>${heroImg(S.mx.hero, 32)} ${esc(cap(S.mx.hero))} against</h2>${[2, 1, -1, -2].map((g) => { const xs = one.filter(([, v]) => v[0] === g); return xs.length ? `<h3><span class="${G[g][2]}">${G[g][0]}</span> ${G[g][1]}</h3><p>${xs.map(([o, v]) => `${heroChip(o)} <span class="muted small">${v[2]}% · ${v[1]} games</span>`).join(" ")}</p>` : ""; }).join("")}</div>` : `<p class="small muted">Pick a hero to see who it counters and who counters it.</p>`}`;
  app.querySelectorAll("[data-ml]").forEach((b) => b.addEventListener("click", () => { S.mx.lane = b.dataset.ml; vMatrix(); }));
  app.querySelectorAll("[data-mh]").forEach((b) => b.addEventListener("click", () => { S.mx.hero = b.dataset.mh; vMatrix(); }));
}
// ---------------------------------------------------------------- heroes
async function vHeroes() {
  const heroes = await load("heroes.json"), ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"];
  const meta = await load("meta.json");
  app.innerHTML = `<h1>Meta heroes</h1>${meta.patch ? `<p class="small"><span class="chip">Current patch ${esc(meta.patch.patch)} (${esc(dshort(meta.patch.release))})</span> ${meta.patch.changes.length ? esc(meta.patch.changes.map((c) => `${cap(c.hero)} ${c.type}`).join(" · ")) : ""}</p>` : ""}<p class="lead">Every hero in pro play in our data. Tier by recent presence (picked or banned) in the last 150 days: S 40%+, A 20%+, B 8%+. Open a hero for its best combos and counters.</p>
    <p class="small"><a href="#/leagues">Meta by league ›</a> · <a href="#/matrix">Counter matrix ›</a> · <a href="#/library">Draft library ›</a></p><input class="field" id="hq" type="search" placeholder="Search a hero" value="${esc(S.hq)}"><div class="filters" role="group" aria-label="Role" style="margin-top:8px"><button class="fbtn" data-hr="" aria-pressed="${!S.hrole}">All roles</button>${ROLES.map((r) => `<button class="fbtn" data-hr="${r}" aria-pressed="${S.hrole === r}">${r}</button>`).join("")}</div><div id="hl"></div>`;
  const draw = () => { const q = S.hq.toLowerCase(), f = heroes.filter((h) => (!q || h.id.includes(q)) && (!S.hrole || h.roles[0]?.r === S.hrole));
    document.getElementById("hl").innerHTML = ["S", "A", "B", "C"].map((t) => { const hs = f.filter((h) => h.tier === t); return hs.length ? `<h3>${t} tier <span class="muted">· ${hs.length}</span></h3><div class="tgrid">${hs.slice(0, t === "C" ? 30 : 60).map((h) => `<a class="titem" href="#/hero/${encodeURIComponent(h.id)}"><span class="hpic">${heroImg(h.id, 44)}<span class="tier t${t}">${t}</span></span><span><span class="t1">${esc(cap(h.id))}</span><span class="t2">${esc(h.roles.slice(0, 2).map((r) => r.r).join(" / "))} · recent: ${h.recent.picks} picks, ${h.recent.bans} bans${h.firstPhaseBan != null && h.firstPhaseBan >= 0.6 ? " · priority ban" : ""}${h.flex ? " · flex" : ""}${h.untested ? " · changed this patch, untested" : ""}${h.recent.wr != null ? `, ${pct(h.recent.wr)} won` : ""}</span></span><span class="t3"><b>${pct(h.recent.presence)}</b><br><span class="muted small">presence</span></span></a>`).join("")}</div>` : ""; }).join("") || `<p class="empty">No hero matches.</p>`; };
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
    <p class="small">Lanes in pro play: ${(h.laneSplit || []).filter((r) => r.share >= 0.02).map((r) => `${esc(r.r)} ${pct(r.share)}`).join(" · ")}${h.flex ? ' <span class="chip">Flex pick</span>' : ""}${h.ranked ? ` · Ranked games (MLBBHub): ${f1(h.ranked.wr)}% win${h.rankedTrend != null ? ` <span class="${h.rankedTrend > 0 ? "up" : h.rankedTrend < 0 ? "down" : "muted"}">${h.rankedTrend > 0 ? "▲" : h.rankedTrend < 0 ? "▼" : "•"} ${h.rankedTrend > 0 ? "+" : ""}${f1(h.rankedTrend)}</span>` : ""}, ${f1(h.ranked.ban)}% ban, tier ${esc(h.ranked.tier)}` : ""}</p>
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
  if (!regions.includes(S.rg)) S.rg = regions[0];
  const list = teams.filter((t) => t.region === S.rg);
  app.innerHTML = `<h1>Teams</h1><p class="lead">Ranked by rating (1500 = average; 100 points is about a 64% single-game edge), learned game by game. International events link the regions; teams seen only at international events are listed under INTL.</p>
    <div class="filters" role="group" aria-label="Region">${regions.map((r) => `<button class="fbtn" data-rg="${esc(r)}" aria-pressed="${S.rg === r}">${esc(r)}</button>`).join("")}<a class="fbtn" href="#/players">Players ›</a></div>
    <div class="card"><div class="tw"><table class="ft"><thead><tr><th>#</th><th>Team</th><th class="n">Series</th><th class="n">Games</th><th class="n">Rating</th></tr></thead><tbody>${list.map((t, i) => `<tr><td class="muted">${i + 1}</td><td><a class="tn" href="#/team/${esc(t.id)}">${tb(t.name, 24)} ${esc(t.name)}</a> <span class="muted small">${esc(t.comfort.map((c) => cap(c.h)).join(", "))}</span></td><td class="n">${t.series[0]}-${t.series[1]}</td><td class="n">${t.games[0]}-${t.games[1]}</td><td class="n"><b>${t.elo}</b></td></tr>`).join("")}</tbody></table></div></div>`;
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
  const { picks, note } = await load("picks.json"), up = picks.filter((p) => Date.parse(p.date) > Date.now() - 3600000);
  app.innerHTML = `<h1>Picks</h1><p class="lead">Our own lines for scheduled MLBB matches: series winner and map count, from the series math. Only teams with 6+ series in our data.</p><div class="callout small">${esc(note)}</div>
    ${up.length ? `<div class="tgrid">${up.map((p) => `<a class="titem" href="#/match/${esc(p.id)}"><span class="pk-p ${p.p >= 0.75 ? "hi" : ""}">${pct(p.p)}</span><span><span class="t1">${esc(p.pick)}</span><span class="t2">${esc(p.game)} · ${esc(p.league)} · ${esc(when(p.date))}</span></span><span class="t3">fair ${dec(p.p)}</span></a>`).join("")}</div>` : `<p class="empty">No scheduled match with both teams set yet. Picks appear as soon as MCT SEA or M8 matchups are known. For now, try <a href="#/versus">Versus</a>.</p>`}`;
}
async function vMore() {
  const item = (href, ic, t, d) => `<a class="card menu-i" href="${href}"><span class="menu-ic" aria-hidden="true">${ic}</span><span><b>${t}</b><span class="small muted" style="display:block">${d}</span></span><span class="menu-c">›</span></a>`;
  app.innerHTML = `<h1>More</h1>${item("#/results", "📋", "Results and accuracy", "Every graded series, the saved-before-start record and calibration.")}${item("#/leagues", "🗺️", "Meta by league", "Each league's own meta: most contested heroes, opening bans and how often the first-pick side wins.")}${item("#/library", "📚", "Draft library", "Every pro game with both drafts, side, map, length and result.")}${item("#/matrix", "🔀", "Counter matrix", "Who each hero beats and loses to in pro play.")}${item("#/m8", "🏆", "M8 World Championship", "The field, the Wildcard and each team's chance to advance.")}${item("#/versus", "⚔️", "Versus", "Any team against any team.")}${item("#/sim", "🧩", "Match simulator", "Live draft with suggestions, draft profile and win chance by game time.")}${item("#/picks", "⭐", "Picks", "Our own lines for scheduled matches.")}${item("#/players", "👤", "Players", "Hero pools, signature heroes and official stats.")}${item("#/how", "⚙️", "How it works", "Ratings, series math, the draft layer and the learning.")}${item("#/sources", "🔗", "Data sources", "Where the numbers come from, and what is not read.")}${item("../nba/", "🏀", "NBA", "Switch to the NBA section.")}${item("../fiba/", "🌍", "FIBA", "Switch to the FIBA section.")}`;
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
  <div class="card"><h2>Read</h2><ul class="dots"><li><b>Liquipedia</b> (CC-BY-SA 3.0): matches, full drafts (picks, bans, sides, length, battlefield), MVPs and season lineups for ${esc(meta.leagues.join(", "))}. Read through its API at one request every 2 seconds, only pages that changed.</li><li><b>MPL PH</b> (ph-mpl.com, Data tab) and <b>MPL ID</b> (id-mpl.com, Statistics tab): official player KDA, kills, deaths, assists, kill participation and team kills, gold, damage, Lords, Turtles and towers.</li><li><b>mlbb.io</b>: ranked (all players) counters, past 7 days, current patch: each hero's strongest counters with their win-rate edge, shown on hero pages and as a small background signal in the simulator, never mixed into the pro numbers.</li><li><b>MLBBHub</b>: ranked-game hero win, pick and ban rates (shown on hero pages; pro-play numbers drive the model).</li></ul></div>
  <div class="card"><h2>Checked but not used</h2><ul class="dots"><li>MPL Malaysia site: schedule, teams and MVP pages but no statistics tab, and it does not answer automated requests.</li><li>MLDB: blocked by bot protection. mlbb.rone.dev / arena.rone.dev: its API is closed to automated access (robots.txt). Official mobilelegends.com ranking: its data service is not open to other sites.</li><li>Facebook, Instagram, X, TikTok and Discord: need a login.</li><li>Coaching and draft tools (R7, NYRE, MLBBHub planners, Mobadraft): interactive tools, no data feed.</li><li>No sportsbook data is used for MLBB.</li></ul></div>`; }
function vMissing() { app.innerHTML = `<div class="card"><h2>This page does not exist in the MLBB section</h2><p><a class="go" href="#/matches">MLBB matches ›</a> <a class="go" href="#/more">More ›</a></p></div>`; }

// ---------------------------------------------------------------- router
function stamp(meta) { const el = document.getElementById("updated"); if (el && meta) el.textContent = `Data refreshed ${new Date(meta.built).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} PH time · ${meta.series} series and ${meta.games.toLocaleString()} games graded · ${meta.players} players · ${meta.heroes} heroes.`; }
async function route() {
  const seq = (S.seq = (S.seq || 0) + 1), h = location.hash || "#/matches", st = (S.stack ||= []);
  if (st.length > 1 && st[st.length - 2] === h) st.pop(); else if (st[st.length - 1] !== h) st.push(h);
  const [, viewRaw = "matches", arg] = h.split("?")[0].split("/"), view = viewRaw || "matches";
  drawNav(TAB[view] || "matches");
  S.img ||= await load("images.json").catch(() => ({ heroes: {}, teams: {}, players: {} }));
  try { await ({ matches: vMatches, match: vMatch, versus: vVersus, draft: vSim, sim: vSim, picks: vPicks, heroes: vHeroes, hero: vHero, teams: vTeams, team: vTeam, players: vPlayers, player: vPlayer, more: vMore, m8: vM8, library: vLibrary, matrix: vMatrix, leagues: vLeagues, results: vResults, how: vHow, sources: vSources }[view] || vMissing)(decodeURIComponent(arg || "")); }
  catch (e) { if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">${esc(e.message)}</p><p><a class="go" href="#/matches">Back to matches</a></p></div>`; }
  if (st.length > 1) app.querySelectorAll("a.back").forEach((a) => (a.textContent = "‹ Back"));
  if (S.last !== h) window.scrollTo(0, 0); S.last = h;
  if (!document.getElementById("updated").textContent) load("meta.json").then(stamp).catch(() => {});
}
document.addEventListener("click", (e) => { const a = e.target.closest?.("a.back"); if (a && (S.stack?.length || 0) > 1) { e.preventDefault(); history.back(); } });
addEventListener("hashchange", route);
route();
