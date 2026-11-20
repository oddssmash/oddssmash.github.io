// ODDSSMASH Dota 2: the MLBB section's tabs and workflow for Dota 2. Matches, Draft, Meta, Teams, Stats, More.
// Reads the files scripts/dota2/model.mjs and news.mjs write to ./data. Our projections come from match data only; no
// sportsbook data is read or shown.
const app = document.getElementById("app");
const S = { cache: new Map() };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (p) => (p == null || isNaN(p) ? "-" : `${Math.round(p * 100)}%`);
const f1 = (x) => (x == null || isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
const dec = (p) => (p > 0 ? (1 / p).toFixed(2) : "-");
const lg = (x) => 1 / (1 + Math.exp(-x)), logit = (p) => Math.log(p / (1 - p));
async function load(name) { if (!S.cache.has(name)) S.cache.set(name, fetch(`data/${name}`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); })); return S.cache.get(name); }
const TZ = "Asia/Manila";
const when = (d) => (d ? new Date(d).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "date TBA");
const dshort = (d) => (d ? new Date(d).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "-");
const ago = (d) => { const h = (Date.now() - Date.parse(d)) / 3600000; return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
// series math (same as the model): best-of-n from a single-game chance; best-of-2 can end 1-1
function series(p, bo) { if (bo === 2) return { win: p * p, draw: 2 * p * (1 - p), scores: { "2-0": p * p, "1-1": 2 * p * (1 - p), "0-2": (1 - p) ** 2 } };
  const need = Math.ceil(bo / 2), out = {}; let win = 0; const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (let l = 0; l < need; l++) { const pr = C(need - 1 + l, l) * p ** need * (1 - p) ** l; out[`${need}-${l}`] = pr; win += pr; } for (let w = 0; w < need; w++) out[`${w}-${need}`] = C(need - 1 + w, w) * (1 - p) ** need * p ** w; return { win, draw: 0, scores: out }; }
const head = (s) => s.win + s.draw / 2;
// PICTURES: hero art and icons from Valve's CDN, team logos from OpenDota (Valve's team images)
const H = () => S.H || {};
const CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/";
const hn = (id) => H()[id]?.name || `Hero ${id}`;
const himg = (id, px = 22) => { const h = H()[id]; return h ? `<img class="himg" src="${CDN}${esc(h.key)}.png" alt="" width="${px}" height="${px}" loading="lazy">` : ""; };
const hpic = (id, px = 44) => { const h = H()[id]; return h ? `<img class="hpic" src="${CDN}${esc(h.key)}.png" alt="" style="width:${Math.round(px * 1.6)}px;height:${px}px" loading="lazy">` : `<span class="tb" style="width:${px}px;height:${px}px">?</span>`; };
const heroChip = (id) => `<a class="hchip" href="#/hero/${id}">${himg(id, 18)}${esc(hn(id))}</a>`;
const initialsOf = (name) => { const s = String(name || ""), w = s.replace(/[^A-Za-z0-9 ]/g, "").split(/ +/).filter(Boolean).slice(0, 3).map((x) => x[0]).join("").toUpperCase(); return w || Array.from(s.trim()).slice(0, 2).join("").toUpperCase() || "?"; };
const LOGO = () => S.logos || {};
const tb = (name, px = 40) => { const u = LOGO()[name]; const fb = `<span class="tb" style="width:${px}px;height:${px}px;font-size:${Math.round(px / 3.4)}px" aria-hidden="true">${esc(initialsOf(name))}</span>`;
  return u ? `<span class="tlogo" style="width:${px}px;height:${px}px"><img src="${esc(u)}" alt="" loading="lazy" data-fb="${esc(initialsOf(name))}" onerror="this.parentNode.outerHTML='<span class=&quot;tb&quot; style=&quot;width:${px}px;height:${px}px&quot;>'+this.dataset.fb+'</span>'"></span>` : fb; };
const tlink = (name, id) => (id != null ? `<a href="#/team/${id}">${esc(name)}</a>` : esc(name));
const icon = (d, s = 22) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const I = { vs: "M5 19L19 5M14 5h5v5M5 5l14 14M5 10V5h5", cup: "M7 4h10v5a5 5 0 01-10 0zM12 14v4M8 20h8M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3", chart: "M4 20V10M10 20V4M16 20v-7M22 20H2", star: "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z", grid: "M5 5h6v6H5zM13 13h6v6h-6zM13 5h6v6h-6zM5 13h6v6H5z", book: "M6 4h11a2 2 0 012 2v14H8a2 2 0 01-2-2zM10 9h5M10 13h5", lib: "M4 5h4v14H4zM10 5h4v14h-4zM16 6l3.5-1 3 13.5-3.5 1z", swap: "M7 7h13l-4-4M17 17H4l4 4", map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z", patch: "M4 14l10-10 6 6-10 10H4zM9 9l6 6", user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0", gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.5-2 3.4-2.3-.9a7 7 0 01-2 1.2L14 21h-4l-.4-2.6a7 7 0 01-2-1.2l-2.3.9-2-3.4 2-1.5A7 7 0 015 12", link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1", ball: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18", news: "M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M8 9h5M8 13h5" };

// ---------------------------------------------------------------- chrome
const NAV = [["matches", "Matches", I.vs], ["sim", "Draft", I.grid], ["heroes", "Meta", I.star], ["teams", "Teams", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"], ["stats", "Stats", "M4 20V11M10 20V4M16 20v-6M21 20H3"], ["more", "More", "M4 7h16M4 12h16M4 17h16"]];
const TAB = { matches: "matches", match: "matches", versus: "matches", picks: "matches", events: "matches", m8: "matches", draft: "sim", sim: "sim", library: "sim", heroes: "heroes", hero: "heroes", matrix: "heroes", leagues: "heroes", playbook: "heroes", patch: "heroes", teams: "teams", team: "teams", players: "teams", player: "teams", stats: "stats", pstat: "stats", pcompare: "stats", more: "more", results: "more", learning: "more", history: "more", series: "more", how: "more", sources: "more", news: "more" };
function drawNav(active) { const nav = document.getElementById("nav"); if (!nav.childElementCount) nav.innerHTML = NAV.map(([k, l, d]) => `<a href="#/${k}" data-tab="${k}"><span class="nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span><span class="nav-l">${l}</span></a>`).join("");
  for (const a of nav.children) a.dataset.tab === active ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); }
document.getElementById("theme").addEventListener("click", () => { const l = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = l ? "light" : "dark"; document.getElementById("theme-color").setAttribute("content", l ? "#f4f5f6" : "#0A1512"); try { localStorage.setItem("theme", l ? "light" : "dark"); } catch {} });
document.getElementById("skip").addEventListener("click", () => app.focus());
const subHead = (back, label, title) => `<header class="ph"><a class="ph-back back" href="${back}" aria-label="Back">${icon("M15 6l-6 6 6 6", 20)}</a><span class="ph-t"><span class="ph-l">${esc(label)}</span><h1>${esc(title)}</h1></span><a class="ph-logo" href="../" aria-label="ODDSSMASH home"><img class="on-dark" src="../brand/stack-silver.png" alt="" height="34"><img class="on-light" src="../brand/stack-black.png" alt="" height="34"></a></header>`;
const jumpTabs = (items) => `<nav class="mp-tabs" aria-label="Sections">${items.map(([id, l], i) => `<button type="button" data-jump="${id}"${i === 0 ? ' aria-current="true"' : ""}>${l}</button>`).join("")}</nav>`;
document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-jump]"); if (!b) return; document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); b.parentNode.querySelectorAll("button").forEach((x) => x.removeAttribute("aria-current")); b.setAttribute("aria-current", "true"); });
function bindPick(input, items, label, onPick) { const box = document.getElementById(input.id + "-l");
  input.addEventListener("input", () => { const q = input.value.trim().toLowerCase(); const hits = q ? items.filter((x) => label(x).toLowerCase().includes(q)).slice(0, 8) : [];
    box.innerHTML = hits.map((x) => `<button type="button" class="vs-hit" data-i="${items.indexOf(x)}">${esc(label(x))}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const x = items[+b.dataset.i]; input.value = label(x); box.innerHTML = ""; onPick(x); })); }); }
const pickBox = (id, ph, val = "") => `<div class="vs-pick"><input class="field" id="${id}" type="search" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off" value="${esc(val)}"><div class="vs-list" id="${id}-l"></div></div>`;
const formDots = (f) => `<span class="fdots">${[...(f || "")].map((c) => `<i class="${c === "W" ? "w" : c === "L" ? "l" : "d"}" title="${c === "W" ? "Won" : c === "L" ? "Lost" : "Draw"}">${c}</i>`).join("")}</span>`;
const DISCLAIM = `<p class="small muted" style="margin-top:14px">Statistical projections for analysis and entertainment. Not betting advice. No sportsbook data is used for Dota 2.</p>`;

// ---------------------------------------------------------------- matches
function betsOf(m) { if (!m || !m.bo || !m.scores) return null; const line = m.bo === 3 ? 2.5 : m.bo === 5 ? 4.5 : null, games = (k) => k.split("-").reduce((x, y) => +x + +y, 0);
  const over = line ? Object.entries(m.scores).reduce((a, [k, v]) => a + (games(k) > line ? v : 0), 0) : null, top = Object.entries(m.scores).sort((a, b) => b[1] - a[1])[0];
  return { mlA: dec(m.pSeries), mlB: dec(1 - m.pSeries), fav: m.pSeries >= 0.5 ? "a" : "b", top: top[0], topP: top[1], line, overP: over, side: over != null ? (over >= 0.5 ? "Over" : "Under") : null }; }
function betsStrip(m, done = null) { const b = betsOf(m); if (!b) return ""; const mark = (ok) => (done ? `<b class="${ok ? "up" : "dn"}">${ok ? "✓" : "✗"}</b> ` : ""), A = m.a.short || m.a.name, B = m.b.short || m.b.name;
  const actual = done ? done[0] + done[1] : null, favWon = done ? (done[0] > done[1]) === (b.fav === "a") : null;
  return `<div class="bt-s">${m.bo === 2 ? "" : `<span>${mark(favWon)}<em>Moneyline</em><b>${esc(A)} ${b.mlA}</b> · <b>${esc(B)} ${b.mlB}</b></span>`}<span>${mark(done && b.top === `${done[0]}-${done[1]}`)}<em>Correct score</em><b>${esc(b.top)}</b> ${pct(b.topP)}</span>${b.line ? `<span>${mark(done && (b.side === "Over" ? actual > b.line : actual < b.line))}<em>Total maps</em><b>${b.side} ${b.line}</b> ${pct(Math.max(b.overP, 1 - b.overP))}</span>` : ""}</div>`; }
function matchCard(m) {
  const pa = m.pSeries, need = m.bo === 2 ? 2 : Math.ceil(m.bo / 2), started = m.date && Date.parse(m.date) < Date.now(), warn = [];
  if (!m.known) warn.push("A team has too few games in our data: treat this as a rough guide.");
  return `<a class="mc" href="#/match/${esc(m.id)}"><div class="mc-h"><span>${esc(m.tournament || "")}${m.stage ? ` · ${esc(m.stage)}` : ""}</span>${started ? `<span class="pk-live">STARTED · WAITING FOR RESULT</span>` : ""}<span class="mc-bo">BO${m.bo}</span></div>
    ${betsStrip(m)}${warn.length ? `<div class="mc-warn">${warn.map((w) => `<span>⚠ ${esc(w)}</span>`).join("")}</div>` : ""}
    <div class="mc-t"><div class="mc-s a">${tb(m.a.name, 56)}<span class="nm">${esc(m.a.short || m.a.name)}</span><span class="num">${pct(pa)}</span></div><div class="mc-vs">VS</div><div class="mc-s b">${tb(m.b.name, 56)}<span class="nm">${esc(m.b.short || m.b.name)}</span><span class="num">${pct(1 - pa)}</span></div></div>
    <div class="mc-bar"><span style="width:${(pa * 100).toFixed(1)}%"></span><span style="width:${((1 - pa) * 100).toFixed(1)}%"></span></div>
    <div class="mc-b"><div class="mc-row"><span>${esc(when(m.date))}</span><span>${m.bo === 2 ? "Two games" : `First to ${need}`} <span class="pips" aria-hidden="true">${Array.from({ length: m.bo }, () => "<i></i>").join("")}</span></span></div>
      <div class="mc-chips"><span>Single game ${pct(Math.max(m.pGame, 1 - m.pGame))} ${esc(m.pGame >= 0.5 ? m.a.short || m.a.name : m.b.short || m.b.name)}</span><span>About ${f1(m.expMaps)} maps</span>${m.bo === 2 ? `<span>Draw 1-1 ${pct(m.pDraw)}</span>` : ""}${m.a.rank && m.b.rank ? `<span>Ranked #${m.a.rank} vs #${m.b.rank}</span>` : ""}</div>
      <span class="mc-cta">SCORES · SCENARIOS · DRAFTS</span></div></a>`;
}
function resultRow(r) { const aw = r.score[0] > r.score[1], scored = r.graded && !r.close, cls = r.draw ? "" : scored ? (r.right ? "ok" : "no") : "", tag = r.page !== false && r.id ? "a" : "div";
  const label = r.draw ? "DRAW" : !r.graded ? "NOT GRADED" : r.close ? "TOO CLOSE" : r.right ? "CALLED" : "MISSED";
  return `<${tag} class="rcard ${cls}"${tag === "a" ? ` href="#/series/${esc(r.id)}"` : ""}><div class="top-r"><span>${esc(dshort(r.date))} · ${esc(r.league)} · BO${r.bo}</span><span class="tag" title="${!r.graded ? "Not graded: too few games for these teams in our data" : r.close ? "Under 60%: too close to call, not counted as a pick" : ""}">${label}</span></div>
    <div class="sc"><span class="${aw ? "w" : "l"}">${esc(r.a)}</span><span class="num">${r.score[0]} – ${r.score[1]}</span><span class="${aw ? "l" : "w"}">${esc(r.b)}</span></div>
    <div class="bot-r"><span>We said <b>${esc(r.p >= 0.5 ? r.a : r.b)} ${pct(Math.max(r.p, 1 - r.p))}</b></span></div>${tag === "a" ? `<span class="go small">Game-by-game analysis ›</span>` : ""}</${tag}>`; }
async function vMatches() {
  const [up, meta, res, ev] = await Promise.all([load("upcoming.json"), load("meta.json"), load("results.json"), load("events.json").catch(() => [])]);
  const tours = [...new Set(up.map((m) => m.tournament).filter(Boolean))];
  S.mf ||= "All"; if (S.mf !== "All" && !tours.includes(S.mf)) S.mf = "All"; const shown = up.filter((m) => S.mf === "All" || m.tournament === S.mf);
  const tools = [["#/versus", "Versus", I.vs], ["#/events", "Events", I.cup], ["#/results", "Our record", I.chart], ["#/picks", "Picks", I.star]], big = ev[0];
  app.innerHTML = `<h1>DOTA 2 MATCHES</h1><p class="lead">Series win chance, likely scores, map count and the draft scenarios for every scheduled pro match. Times are PH time.</p>
    <div class="tools">${tools.map(([h, t, d]) => `<a class="tool" href="${h}"><span class="tool-ic">${icon(d)}</span>${t}</a>`).join("")}</div>
    ${big ? `<a class="m8b" href="#/events"><span class="m8b-ic">${icon(I.cup)}</span><span style="flex:1"><b>${esc(String(big.name).toUpperCase())}</b><span class="small">Strongest field on the schedule · ${big.matches.length} ${big.matches.length === 1 ? "match" : "matches"} · top teams: ${esc(big.teams.slice(0, 3).map((t) => t.name).join(", "))}</span></span><span aria-hidden="true">›</span></a>` : ""}
    <nav class="seg mt-seg" aria-label="Show"><a href="#/matches" data-mv="up"${S.mv !== "prev" ? ' aria-current="page"' : ""}>Upcoming · ${up.length}</a><a href="#/matches" data-mv="prev"${S.mv === "prev" ? ' aria-current="page"' : ""}>Previous matches</a></nav>
    ${S.mv === "prev" ? `<p class="small muted">Each card shows what we projected before the series (from the walk-forward replay: only games played before it) and whether it hit. Tap a card for game-by-game analysis.</p>${res.slice(0, 40).map(resultRow).join("")}<p><a class="go" href="#/history">Every previous match ›</a></p>` : `
    ${up.length ? `<div class="filters" role="group" aria-label="Tournament" style="margin-top:16px">${["All", ...tours].map((x) => `<button class="fbtn" type="button" data-mf="${esc(x)}" aria-pressed="${S.mf === x}">${esc(x)}</button>`).join("")}</div>` : ""}
    <h2 class="sec-h">Upcoming and in progress · ${shown.length} ${shown.length === 1 ? "match" : "matches"}</h2>${shown.some((m) => Date.parse(m.date) < Date.now()) ? `<p class="small muted">A started match keeps its pre-match chance until the result is in; results are checked every 30 minutes.</p>` : ""}
    ${shown.length ? shown.map(matchCard).join("") : `<div class="card"><h2>No match with both teams set yet</h2><p class="small">Matches appear here with projections as soon as both teams are known. Meanwhile, try <a href="#/versus">Versus</a> or the <a href="#/sim">Draft lab</a>.</p></div>`}
    <h2 class="sec-h">Latest results</h2>${res.slice(0, 5).map(resultRow).join("")}<p><a class="go" href="#/matches" data-mv="prev">All previous matches ›</a></p>`}${DISCLAIM}`;
  app.querySelectorAll("[data-mf]").forEach((b) => b.addEventListener("click", () => { S.mf = b.dataset.mf; vMatches(); }));
  app.querySelectorAll("[data-mv]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); S.mv = a.dataset.mv; vMatches(); window.scrollTo(0, 0); }));
}
async function vMatch(id) {
  const [m, news] = await Promise.all([load(`matches/${id}.json`), load("news.json").catch(() => ({ items: [] }))]);
  const s = { scores: m.scores }, top = Object.entries(m.scores).sort((a, b) => b[1] - a[1]), maxS = Math.max(...top.map((x) => x[1]));
  const sides = [m.a, m.b], items = news.items.filter((x) => x.teams.includes(m.a.name) || x.teams.includes(m.b.name)).slice(0, 8);
  const comfort = (t, k) => t.profile ? `<div class="mp-picks">${t.profile.comfort.slice(0, 6).map((c) => `<a class="mp-pick" href="#/hero/${c.h}">${hpic(c.h, 40)}<b>${esc(hn(c.h))}</b><span>${c.n} games · <em class="${c.wr >= 0.5 ? "up" : "down"}">${pct(c.wr)}</em></span></a>`).join("")}</div>` : `<p class="small muted">No recent drafts on record.</p>`;
  const bansRow = (t, key, label) => t.profile?.[key]?.length ? `<p class="small"><b>${label}:</b> ${t.profile[key].slice(0, 5).map((x) => `${heroChip(x.h)} <span class="muted">${x.n}</span>`).join(" ")}</p>` : "";
  app.innerHTML = `${subHead("#/matches", `${m.tournament || ""} · ${m.stage || ""} · BO${m.bo}`, when(m.date) + " PH")}
    ${jumpTabs([["mp-odds", "Chances"], ["mp-scn", "Scenarios"], ["mp-draft", "Drafts"], ["mp-five", "Lineups"], ["mp-h2h", "Head-to-head"], ...(items.length ? [["mp-news", "News"]] : [])])}
    <section class="mp-hero" id="mp-odds"><div class="mc-t"><div class="mc-s a">${tb(m.a.name, 60)}<span class="nm">${tlink(m.a.short || m.a.name, m.a.id)}</span><span class="num">${pct(m.pSeries)}</span><span class="small muted">${m.a.elo ? `rating ${m.a.elo} · #${m.a.rank ?? "-"}` : "new to our data"}</span></div><div class="mc-vs">VS</div><div class="mc-s b">${tb(m.b.name, 60)}<span class="nm">${tlink(m.b.short || m.b.name, m.b.id)}</span><span class="num">${pct(1 - m.pSeries)}</span><span class="small muted">${m.b.elo ? `rating ${m.b.elo} · #${m.b.rank ?? "-"}` : "new to our data"}</span></div></div>
      <div class="mc-bar"><span style="width:${(m.pSeries * 100).toFixed(1)}%"></span><span style="width:${((1 - m.pSeries) * 100).toFixed(1)}%"></span></div>
      ${!m.known ? `<div class="mc-warn"><span>⚠ A team has fewer than 8 games in our data. Its rating is a starting guess, so this is not counted as a pick.</span></div>` : ""}
      ${betsStrip(m)}
      <div class="card"><h2 class="sec-h" style="margin-top:0">Exact score</h2>${top.map(([k, v]) => { const [x, y] = k.split("-").map(Number); return `<div class="sc-row"><span>${x > y ? esc(m.a.short || m.a.name) : x < y ? esc(m.b.short || m.b.name) : "Draw"} ${Math.max(x, y)}-${Math.min(x, y)}</span><span class="rbar"><span class="${v === maxS ? "hi" : ""}" style="width:${Math.round((v / maxS) * 100)}%"></span></span><b class="num">${pct(v)}</b></div>`; }).join("")}
        <p class="small muted">Single game ${pct(m.pGame)} for ${esc(m.a.name)} on a neutral side · about ${f1(m.expMaps)} maps. Fair odds are 1 ÷ our chance: our own line, not a sportsbook's.</p></div></section>
    <section class="mp-sec" id="mp-scn"><h2 class="sec-h">Scenarios</h2>${m.scenarios.map((x, i) => `<div class="mp-scn ${i % 2 ? "b" : "a"} card"><b>${esc(x.t)}</b><p class="small">${esc(x.d)}</p>${x.pA != null ? `<p class="small">Series then: <b>${esc(m.a.name)} ${pct(x.pA)}</b> (now ${pct(m.pSeries)}).</p>` : ""}</div>`).join("") || `<p class="small muted">No scenario with enough games behind it.</p>`}</section>
    <section class="mp-sec" id="mp-draft">${sides.map((t) => `<h2 class="sec-h">${esc(t.name)} <span class="muted">most played heroes (last 120 days)</span></h2>${comfort(t)}${bansRow(t, "bansBy", "They ban")}${bansRow(t, "bansVs", "Banned against them")}${t.profile?.signature ? `<p class="small">Signature: ${heroChip(t.profile.signature.hero)} · ${t.profile.signature.with[0]}-${t.profile.signature.with[1] - t.profile.signature.with[0]} with it, ${t.profile.signature.without[0]}-${t.profile.signature.without[1] - t.profile.signature.without[0]} without.</p>` : ""}`).join("")}
      ${m.likelyA && m.likelyB ? `<h2 class="sec-h">If both draft their favourite heroes</h2><p class="small muted">Each team&#39;s five most-played heroes (last 120 days) as a stand-in draft. A guide to their style, not a forecast of the real draft, and not used in the chances above.</p><div class="dr-two">${draftReadHtml(m.likelyA, m.a.name, "a")}${draftReadHtml(m.likelyB, m.b.name, "b")}</div>` : ""}
      <a class="mc-cta" href="#/sim?a=${encodeURIComponent(m.a.name)}&b=${encodeURIComponent(m.b.name)}">TRY THIS DRAFT IN THE DRAFT LAB</a></section>
    <section class="mp-sec" id="mp-five">${sides.map((t) => `<h2 class="sec-h">${esc(t.name)} lineup <span class="muted">(last game)</span></h2><div class="card"><ul class="plain">${t.roster.map((p) => `<li class="spread"><a class="tn" href="#/player/${p.id}">${esc(p.name)}</a><span class="muted small">${esc(p.role || "")}</span></li>`).join("") || `<li class="muted small">No lineup on record.</li>`}</ul></div>`).join("")}<p class="small muted">Roles are read from farm (last hits) in their recent games: position 1 farms most, position 5 least.</p></section>
    <section class="mp-sec" id="mp-h2h"><h2 class="sec-h">Head-to-head</h2>${m.h2h.length ? `<div class="mo-list">${m.h2h.map((x) => `<a class="mo-i" href="#/series/${esc(x.id)}"><span class="mo-ic">⚔️</span><span><b>${esc(m.a.name)} ${x.score[0]}-${x.score[1]} ${esc(m.b.name)}</b><span class="small muted">${esc(dshort(x.date))} · ${esc(x.league)}</span></span><span aria-hidden="true">›</span></a>`).join("")}</div>` : `<p class="small muted">No meeting in the last 400 days.</p>`}</section>
    ${items.length ? `<section class="mp-sec" id="mp-news"><h2 class="sec-h">News and talk</h2>${newsList(items)}</section>` : ""}${DISCLAIM}`;
}
const newsList = (items) => `<div class="mo-list">${items.map((x) => `<a class="mo-i" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="mo-ic">${x.kind === "video" ? "▶" : x.kind === "community" ? "💬" : x.kind === "official" ? "★" : "📰"}</span><span><b>${esc(x.title)}</b><span class="small muted">${esc(x.outlet)} · ${esc(ago(x.date))}${x.roster ? ` · <b style="color:var(--gold)">ROSTER</b>` : ""}</span></span><span aria-hidden="true">↗</span></a>`).join("")}</div>`;
async function vVersus() {
  const teams = await load("teams.json"), qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const st = (S.vs ||= { a: teams[0], b: teams[1], bo: 3 });
  if (qs.get("a")) st.a = teams.find((t) => t.name === qs.get("a")) || st.a; if (qs.get("b")) st.b = teams.find((t) => t.name === qs.get("b")) || st.b; if (qs.get("bo")) st.bo = +qs.get("bo");
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Versus")}<p class="small muted">Any team against any team. Pick two and a series length.</p>
    <div class="vs-pick2"><div class="vs-t a">${tb(st.a.name, 40)}${pickBox("va", "Change team", st.a.name)}</div><button class="ds-ib" type="button" id="vs-swap" aria-label="Swap sides">⇄</button><div class="vs-t b">${tb(st.b.name, 40)}${pickBox("vb", "Change team", st.b.name)}</div></div>
    <div class="filters" role="group" aria-label="Series length">${[1, 2, 3, 5].map((n) => `<button class="fbtn" type="button" data-bo="${n}" aria-pressed="${st.bo === n}">Best of ${n}</button>`).join("")}</div><div id="vs-out"></div>`;
  const draw = async () => { const out = document.getElementById("vs-out"); if (!st.a || !st.b || st.a === st.b) { out.innerHTML = `<p class="empty">Pick two different teams.</p>`; return; }
    const [A, B] = await Promise.all([load(`teams/${st.a.id}.json`), load(`teams/${st.b.id}.json`)]);
    const pg = lg((A.elo - B.elo) / 173.7), s0 = series(pg, st.bo), win = Math.min(0.9, Math.max(0.1, head(s0))), exp = Object.entries(s0.scores).reduce((t, [k, v]) => t + k.split("-").reduce((x, y) => +x + +y, 0) * v, 0);
    const row = (label, a, b, f, hi = true) => { const better = a == null || b == null || a === b ? 0 : (a > b) === hi ? 1 : 2; return `<div class="tape"><b class="${better === 1 ? "hi" : ""}">${a == null ? "-" : f(a)}</b><span>${label}</span><b class="${better === 2 ? "hi" : ""}">${b == null ? "-" : f(b)}</b></div>`; };
    const r = (x) => (x && x[1] ? x[0] / x[1] : null), shared = A.profile.comfort.filter((c) => B.profile.comfort.some((d) => d.h === c.h)).slice(0, 4);
    out.innerHTML = `<section class="vs-card"><div class="spread"><b class="num b">${pct(win)}</b><span class="lbl">SERIES WIN CHANCE</span><b class="num r">${pct(1 - win)}</b></div><div class="mc-bar"><span style="width:${(win * 100).toFixed(1)}%"></span><span style="width:${((1 - win) * 100).toFixed(1)}%"></span></div>
      <p class="small muted">Single game ${pct(pg)} · about ${f1(exp)} maps${st.bo === 2 ? ` · draw 1-1 ${pct(s0.draw)}` : ""}.</p>
      ${row("Rating", A.elo, B.elo, (x) => x)}${row("Rank", A.rank, B.rank, (x) => `#${x}`, false)}${row("Games (120 days)", A.games, B.games, (x) => x)}${row("Game win rate", A.wr, B.wr, pct)}${row("On Radiant", r(A.profile.radiant), r(B.profile.radiant), pct)}${row("On Dire", r(A.profile.dire), r(B.profile.dire), pct)}${row("Under 30 min", r(A.profile.short), r(B.profile.short), pct)}${row("40+ min", r(A.profile.long), r(B.profile.long), pct)}${row("Average game", A.profile.avgMin, B.profile.avgMin, (x) => `${x} min`, false)}
      ${shared.length ? `<p class="small">Both like: ${shared.map((c) => heroChip(c.h)).join(" ")}</p>` : ""}
      <a class="mc-cta" href="#/sim?a=${encodeURIComponent(A.name)}&b=${encodeURIComponent(B.name)}">DRAFT THIS MATCHUP</a></section>`; };
  bindPick(document.getElementById("va"), teams, (t) => t.name, (t) => { st.a = t; vVersus(); }); bindPick(document.getElementById("vb"), teams, (t) => t.name, (t) => { st.b = t; vVersus(); });
  document.getElementById("vs-swap").addEventListener("click", () => { [st.a, st.b] = [st.b, st.a]; vVersus(); });
  app.querySelectorAll("[data-bo]").forEach((b) => b.addEventListener("click", () => { st.bo = +b.dataset.bo; vVersus(); }));
  draw();
}
async function vEvents() {
  const ev = await load("events.json");
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Events")}<p class="small muted">Tournaments on the schedule. Field strength is each team's average chance to beat every other team here in a best-of-3, from our ratings.</p>
    ${ev.map((e) => `<section class="mp-sec"><h2 class="sec-h">${esc(e.name)}</h2><div class="card">${e.teams.map((t) => `<div class="ev-row">${tb(t.name, 32)}<span><b>${tlink(t.name, t.id)}</b><span class="hr-bar"><i style="width:${Math.round((t.vsField || 0) * 100)}%"></i></span></span><b class="num">${t.vsField != null ? pct(t.vsField) : "—"}</b></div>`).join("")}</div>
      <div class="mo-list">${e.matches.map((m) => `<a class="mo-i" href="#/match/${esc(m.id)}"><span class="mo-ic">⚔️</span><span><b>${esc(m.a)} vs ${esc(m.b)}</b><span class="small muted">${esc(m.stage || "")} · BO${m.bo} · ${esc(when(m.date))}</span></span><b class="num">${pct(Math.max(m.p, 1 - m.p))}</b></a>`).join("")}</div>${e.page ? `<p class="small"><a href="https://liquipedia.net/dota2/${esc(e.page)}" target="_blank" rel="noopener">Brackets and groups on Liquipedia ↗</a></p>` : ""}</section>`).join("") || `<p class="empty">No tournament on the schedule right now.</p>`}`;
}
async function vPicks() {
  const [{ picks, note }, up] = await Promise.all([load("picks.json"), load("upcoming.json")]);
  const byM = new Map(); for (const p of picks) (byM.get(p.id) || byM.set(p.id, []).get(p.id)).push(p);
  S.pkf ||= "all"; const groups = [...byM.entries()].map(([id, ps]) => ({ id, ps, m: up.find((u) => u.id === id) }));
  const nPick = groups.filter((g) => g.ps.some((p) => !p.noPick)).length, nClose = groups.length - nPick;
  const shown = groups.filter((g) => S.pkf === "all" || (S.pkf === "pick" ? g.ps.some((p) => !p.noPick) : g.ps.every((p) => p.noPick)));
  const meter = (p) => { const n = p >= 0.8 ? 5 : p >= 0.7 ? 4 : p >= 0.65 ? 3 : p >= 0.6 ? 2 : 1; return `<span class="pk-meter" role="img" aria-label="Strength ${n} of 5">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? (p >= 0.7 ? "g" : p >= 0.6 ? "b" : "s") : ""}"></i>`).join("")}</span>`; };
  const card = (g) => { const m = g.m, best = g.ps.filter((p) => !p.noPick).sort((a, b) => b.p - a.p)[0], lean = [...g.ps].sort((a, b) => b.p - a.p)[0];
    return `<section class="pk-card"><div class="pk-h"><span>${esc(lean.league || "")}${m ? ` · BO${m.bo}` : ""}</span><span>${Date.parse(lean.date) < Date.now() ? `<b class="pk-live">Started · waiting for result</b>` : esc(when(lean.date))}</span></div>
      ${m ? `<div class="pk-t"><span>${tb(m.a.name, 40)}<b>${esc(m.a.short || m.a.name)}</b></span><span class="muted">VS</span><span><b>${esc(m.b.short || m.b.name)}</b>${tb(m.b.name, 40)}</span></div>` : `<div class="pk-t"><b>${esc(lean.game)}</b></div>`}
      <div class="pk-box">${best ? `<div class="spread"><span class="pk-tag ${best.p >= 0.7 ? "g" : "b"}">${best.p >= 0.7 ? "STRONG" : "LEAN"} · PICK</span>${meter(best.p)}</div><span>${esc(best.pick)} <b style="color:var(--accent-ink)">${pct(best.p)}</b>.</span>` : `<div class="spread"><span class="pk-tag s">TOO CLOSE · NO PICK</span>${meter(lean.p)}</div><span>We lean <b style="color:var(--accent-ink)">${esc(lean.pick.replace(/ to win the series$/, ""))} ${pct(lean.p)}</b>. ${esc(lean.why || "")}</span>`}</div>
      <div class="pk-lines"><span class="lbl">OUR LINES (FAIR ODDS)</span>${g.ps.map((p) => `<div><span>${esc(p.pick)}</span><b>${pct(p.p)}</b><b class="o">${dec(p.p)}</b></div>`).join("")}</div>
      <div class="pk-f"><span>Locks when the match starts.</span><a href="#/match/${esc(g.id)}">Open match</a></div></section>`; };
  app.innerHTML = `${subHead("#/matches", "MATCHES", "Picks")}<div class="pk-info"><span class="mo-ic">${icon(I.star, 20)}</span><span class="small">Our own lines, saved before the match starts and never changed after. No sportsbook data is used.</span></div>
    <div class="filters" role="group" aria-label="Show">${[["all", `All · ${groups.length}`], ["pick", `Picks 60%+ · ${nPick}`], ["close", `Too close · ${nClose}`]].map(([k, l]) => `<button class="fbtn" type="button" data-pkf="${k}" aria-pressed="${S.pkf === k}">${l}</button>`).join("")}</div>
    ${shown.map(card).join("") || `<p class="empty">No scheduled match in this group.</p>`}
    <h2 class="sec-h">How strong is a pick</h2><div class="mo-list">${[["50–59%", "var(--muted)", "Too close", "Shown for reference. Not counted as a pick."], ["60–69%", "var(--accent-ink)", "Lean", "A real edge, but upsets are common."], ["70%+", "var(--gold)", "Strong", "Clear favourite on the five players' ratings."]].map(([r, c, t, d]) => `<div class="mo-i"><b class="num" style="width:74px;color:${c}">${r}</b><span><b>${t}</b><span class="small muted">${d}</span></span><span></span></div>`).join("")}</div>
    <a class="btn wide" href="#/results">See how past picks did</a><p class="small muted">${esc(note)}</p>`;
  app.querySelectorAll("[data-pkf]").forEach((b) => b.addEventListener("click", () => { S.pkf = b.dataset.pkf; vPicks(); }));
}

// ---------------------------------------------------------------- draft lab
// ---------------------------------------------------------------- draft lab (Captains Mode)
// Captains Mode order (patch 7.33 onward, checked against every pro draft in our data): F = first-pick team, S = second.
const CM = [["b", "F"], ["b", "F"], ["b", "S"], ["b", "S"], ["b", "F"], ["b", "S"], ["b", "S"], ["p", "F"], ["p", "S"], ["b", "F"], ["b", "F"], ["b", "S"], ["p", "S"], ["p", "F"], ["p", "F"], ["p", "S"], ["p", "S"], ["p", "F"], ["b", "F"], ["b", "S"], ["b", "F"], ["b", "S"], ["p", "F"], ["p", "S"]];
const PHASE = (i) => (i < 7 ? "Ban phase 1" : i < 9 ? "Pick phase 1" : i < 12 ? "Ban phase 2" : i < 18 ? "Pick phase 2" : i < 22 ? "Ban phase 3" : "Pick phase 3");
// a draft's factor profile and plain-English read (same math as the model's readDraft)
function readDraftC(D, heroes) { const NF = D.factors.length, v = new Array(NF).fill(0); for (const h of heroes) { const x = D.hvec[h]; if (x) for (let i = 0; i < NF - 1; i++) v[i] += x[i]; v[NF - 1] += D.tempo[h] || 0; }
  const zz = v.map((x, j) => (x - D.favg[j][0]) / (D.favg[j][1] || 1)), Z = Object.fromEntries(D.factors.map(([k], j) => [k, zz[j]])), order = zz.map((x, j) => [x, j]).sort((a, b) => b[0] - a[0]);
  const strengths = order.filter(([x]) => x >= 0.6).slice(0, 3).map(([, j]) => D.factors[j][1]), weak = order.filter(([x]) => x <= -0.6).slice(-3).reverse().map(([, j]) => D.factors[j][1]);
  const plans = [["Teamfight", Z.teamfight + Z.control + 0.5 * Z.initiation], ["Push", Z.push + 0.5 * Z.objectives], ["Pick-off", Z.control + Z.mobility + 0.5 * Z.damage - 0.5 * Z.teamfight], ["Scale to late game", Z.scaling - Z.tempo], ["Early pressure", Z.tempo + 0.5 * Z.laning]].sort((a, b) => b[1] - a[1]);
  const plan = plans[0][1] > 0.8 ? plans[0][0] : "Balanced", winCon = plan === "Scale to late game" && Z.scaling < 0.3 ? "Wants a long game but has little carry power." : plan === "Push" && Z.push < 0.5 ? "Wants to push but has low tower damage." : plan === "Teamfight" && Z.initiation < -0.5 ? "Wants fights but has no clear initiator." : null;
  return { v, z: Z, strengths, weak, plan, winCon }; }
const draftReadHtml = (r, name, cls) => `<div class="dr-card ${cls}"><b>${esc(name)}</b><span class="dr-plan">Gameplan: ${esc(r.plan)}</span>${r.strengths.length ? `<span class="small"><b class="up">Strong:</b> ${esc(r.strengths.join(", "))}</span>` : ""}${r.weak.length ? `<span class="small"><b class="down">Weak:</b> ${esc(r.weak.join(", "))}</span>` : ""}${r.winCon ? `<span class="small" style="color:var(--gold)">⚠ ${esc(r.winCon)}</span>` : ""}</div>`;
const factorBars = (D, za, zb, A, B) => `<div class="card fx-bars"><div class="spread small muted"><span>${esc(A)}</span><span>Compared with the average pro draft</span><span>${esc(B)}</span></div>${D.factors.map(([k, l]) => { const a = Math.max(-2.5, Math.min(2.5, za[k] || 0)), b = Math.max(-2.5, Math.min(2.5, zb[k] || 0)); return `<div class="fx-r"><span class="fx-a"><i style="width:${Math.round(Math.max(0, a) * 20)}%"></i></span><span class="fx-l">${esc(l)}</span><span class="fx-b"><i style="width:${Math.round(Math.max(0, b) * 20)}%"></i></span></div>`; }).join("")}<p class="small muted">Bars show how far above an average pro draft each side is (only above-average parts are drawn).</p></div>`;
async function vSim() {
  const [D, teams, heroes] = await Promise.all([load("draft.json"), load("teams.json"), load("heroes.json")]), qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const st = (S.sim ||= { a: null, b: null, first: "a", rad: "a", acts: [], q: "" });
  if (qs.get("a")) st.a = teams.find((t) => t.name === qs.get("a")) || st.a; if (qs.get("b")) st.b = teams.find((t) => t.name === qs.get("b")) || st.b;
  const [TA, TB] = await Promise.all([st.a ? load(`teams/${st.a.id}.json`).catch(() => null) : null, st.b ? load(`teams/${st.b.id}.json`).catch(() => null) : null]);
  const who = (fs) => (fs === "F" ? st.first : st.first === "a" ? "b" : "a"), step = st.acts.length, cur = CM[step], curSide = cur ? who(cur[1]) : null;
  const picks = (s) => st.acts.filter((x, i) => CM[i][0] === "p" && who(CM[i][1]) === s).map((x) => x.h), bans = (s) => st.acts.filter((x, i) => CM[i][0] === "b" && who(CM[i][1]) === s).map((x) => x.h);
  const PA = picks("a"), PB = picks("b"), taken = new Set(st.acts.map((x) => x.h)), pk = (x, y) => (x < y ? `${x}-${y}` : `${y}-${x}`);
  const heroEdge = (R, Dd) => { let h = 0, c = 0; for (const x of R) h += D.heroes[x] || 0; for (const x of Dd) h -= D.heroes[x] || 0; for (const [side, sg] of [[R, 1], [Dd, -1]]) for (let i = 0; i < side.length; i++) for (let j = i + 1; j < side.length; j++) c += sg * (D.pairs[pk(side[i], side[j])] || 0); for (const x of R) for (const y of Dd) c += D.vs[`${x}>${y}`] || 0; return h + 0.5 * c; };
  const NF = D.factors.length, draftPart = (R, Dd) => { const ra = readDraftC(D, R).v, rd = readDraftC(D, Dd).v; let l = 0; for (let j = 0; j < NF; j++) l += D.weights[j] * (ra[j] - rd[j]); return l + D.weights[NF] * heroEdge(R, Dd); };
  const ra = st.a ? (st.a.elo - 1500) / 173.7 : 0, rb = st.b ? (st.b.elo - 1500) / 173.7 : 0, aRad = st.rad === "a", sideL = aRad ? D.side : -D.side;
  const chance = (A, B) => { const dp = aRad ? draftPart(A, B) : -draftPart(B, A); return { full: lg(ra - rb + sideL + dp), draft: lg(dp) }; };
  const now0 = chance(PA, PB), base = lg(ra - rb + sideL);
  // comfort bonus: a selected team's most-played heroes get a small push in suggestions (not in the win chance)
  const comfortOf = (T) => Object.fromEntries((T?.profile?.comfort || []).map((c) => [c.h, Math.min(0.15, c.n / 60)]));
  const CA = comfortOf(TA), CB = comfortOf(TB);
  const suggest = () => { if (!cur) return []; const me = curSide, mine = me === "a" ? PA : PB, opp = me === "a" ? PB : PA, sgn = me === "a" ? 1 : -1;
    return heroes.filter((h) => !taken.has(h.id)).map((h) => { let v;
      if (cur[0] === "p") { const c = me === "a" ? chance([...PA, h.id], PB) : chance(PA, [...PB, h.id]); v = sgn * (c.full - now0.full) + ((me === "a" ? CA : CB)[h.id] || 0) * 0.2; }
      else { const c = me === "a" ? chance(PA, [...PB, h.id]) : chance([...PA, h.id], PB); v = -sgn * (c.full - now0.full) + ((me === "a" ? CB : CA)[h.id] || 0) * 0.2; } // ban what helps the other side most
      return { h: h.id, v }; }).sort((a, b) => b.v - a.v).slice(0, 6); };
  const q = st.q.trim().toLowerCase(), list = heroes.filter((h) => !q || h.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const nameA = st.a?.name || "Blue", nameB = st.b?.name || "Red";
  const slots = (s) => { const out = []; CM.forEach(([t, fs], i) => { if (who(fs) !== s) return; const x = st.acts[i]; out.push({ t, i, h: x?.h }); }); return out; };
  const col = (s, cls, name) => `<div class="ds-col ${cls}"><div class="ds-team ${cls}"><span class="lbl">${esc(name.toUpperCase())} · ${st.rad === s ? "RADIANT" : "DIRE"} · ${st.first === s ? "FIRST PICK" : "SECOND PICK"}</span>${pickBox(`sim-${s}`, "Team (optional)", (s === "a" ? st.a : st.b)?.name || "")}</div>
    <div class="ds-bans ${cls}">${slots(s).filter((x) => x.t === "b").map((x) => `<span class="ds-ban${x.i === step ? " cur" : ""}" title="Ban ${x.i + 1}">${x.h ? himg(x.h, 24) : x.i === step ? "•" : ""}</span>`).join("")}</div>
    ${slots(s).filter((x) => x.t === "p").map((x, k) => `<div class="ds-pick${x.i === step ? " cur" : ""}">${x.h ? himg(x.h, 30) : ""}<span class="ds-pl"><b>PICK ${k + 1}</b><span>${x.h ? esc(hn(x.h)) : x.i === step ? "Choosing now" : `<span class="muted">Turn ${x.i + 1}</span>`}</span></span></div>`).join("")}</div>`;
  const done = step >= CM.length, rA = readDraftC(D, PA), rB = readDraftC(D, PB), ev = D.eval;
  app.innerHTML = `<h1>Draft lab</h1><p class="lead">Captains Mode, in pro order: 7 bans, 2 picks, 3 bans, 6 picks, 4 bans, 2 picks. Pick the teams (optional), who picks first and who is Radiant, then draft. The chance updates on every pick.</p>
    <nav class="subtabs" aria-label="Draft"><a href="#/sim" aria-current="page">Draft lab</a><a href="#/library">Draft library</a></nav>
    <section class="ds-win card"><div class="spread"><b class="num b">${pct(now0.full)}</b><span class="lbl">GAME WIN CHANCE</span><b class="num r">${pct(1 - now0.full)}</b></div><div class="ds-wbar"><span style="width:${(now0.full * 100).toFixed(1)}%"></span><span style="width:${((1 - now0.full) * 100).toFixed(1)}%"></span></div>
      <p class="small">Draft winner so far: <b>${now0.draft >= 0.5 ? esc(nameA) : esc(nameB)} ${pct(Math.max(now0.draft, 1 - now0.draft))}</b> on the draft alone. Before the draft: ${pct(base)} (ratings and side).</p>
      <div class="ds-track">${CM.map(([t, fs], i) => `<span class="${i < step ? (who(fs) === "a" ? "blue" : "red") : i === step ? "cur" : ""}" title="${t === "p" ? "Pick" : "Ban"} ${i + 1}"></span>`).join("")}</div>
      <p class="small muted">${done ? "Draft complete." : `${PHASE(step)} · turn ${step + 1} of 24 · <b>${esc(curSide === "a" ? nameA : nameB)} ${cur[0] === "p" ? "picks" : "bans"}</b>`}</p>
      <div class="filters" role="group" aria-label="Setup"><button class="fbtn" type="button" data-first="${st.first === "a" ? "b" : "a"}">First pick: ${esc(st.first === "a" ? nameA : nameB)} ⇄</button><button class="fbtn" type="button" data-rad="${st.rad === "a" ? "b" : "a"}">Radiant: ${esc(st.rad === "a" ? nameA : nameB)} ⇄</button><button class="fbtn" type="button" id="sim-undo"${step ? "" : " disabled"}>Undo</button><button class="fbtn" type="button" id="sim-clear">Clear</button></div></section>
    <div class="ds-cols">${col("a", "blue", nameA)}${col("b", "red", nameB)}</div>
    ${cur ? `<h2 class="sec-h">Suggested ${cur[0] === "p" ? "picks" : "bans"} for ${esc(curSide === "a" ? nameA : nameB)}</h2><div class="hchips">${suggest().map((x) => `<button type="button" class="hchip" data-add="${x.h}">${himg(x.h, 18)}${esc(hn(x.h))}</button>`).join("")}</div><p class="small muted">${cur[0] === "p" ? "Picks that raise this side's chance most with what is already drafted" : "Heroes that would help the other side most"}${TA || TB ? ", nudged toward each team's most-played heroes" : ""}.</p>` : ""}
    ${PA.length || PB.length ? `<h2 class="sec-h">Draft read</h2><div class="dr-two">${draftReadHtml(rA, nameA, "a")}${draftReadHtml(rB, nameB, "b")}</div>${factorBars(D, rA.z, rB.z, nameA, nameB)}` : ""}
    ${cur ? `<h2 class="sec-h">All heroes</h2><input class="field" id="sim-q" type="search" placeholder="Search a hero" aria-label="Search a hero" value="${esc(st.q)}">
    <div class="dg">${list.map((h) => `<button type="button" class="dg-h${taken.has(h.id) ? " used" : ""}" data-add="${h.id}"${taken.has(h.id) ? " disabled" : ""}>${himg(h.id, 36)}<span class="dg-n">${esc(h.name)}</span></button>`).join("")}</div>` : ""}
    <details class="card"><summary><b>How the draft is judged, and what is tested</b></summary>
      <p class="small">The win chance uses each hero's pro strength, the combos on each side and the counters across (learned from earlier games, older games counting less), on top of the teams' ratings and Radiant's edge. Tested on ${ev.test.toLocaleString("en-US")} newer games it never saw: single-game Brier ${ev.brier.ratings} with ratings only, ${ev.brier.plainDraft} with the draft. The side our draft read favoured won ${ev.winnerPlain.n ? pct(ev.winnerPlain.hit / ev.winnerPlain.n) : "-"} of those games.</p>
      <p class="small">The 13 draft factors (control, teamfight, damage, push, Roshan, laning, map control, sustain, carry power, initiation, durability, mobility, power curve) are measured from what each hero does in pro games. Weighted by a fit on older games, they scored ${ev.brier.factors} on the newer games, ${ev.adopted ? "better than the plain draft, so they are in the chance" : "no better than the plain draft, so they explain the draft but do not move the chance"}. Factors with real weight in the fit: ${ev.weights.filter((w) => Math.abs(w.z) >= 2).map((w) => `${esc(w.label)} (${w.w > 0 ? "helps" : "hurts"})`).join(", ") || "none"}.</p>
      <p class="small muted">Not measured: skill-by-skill combo mechanics (only real results for hero pairs), the coach's habits apart from the team's, and exact win conditions. Gameplan labels are summaries of the factors, not certainties. Item timings, high-ground defence, Tormentor and gank timing come in the next update.</p></details>`;
  const re = () => vSim();
  app.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { const h = +b.dataset.add; if (!taken.has(h) && st.acts.length < CM.length) st.acts.push({ h }); re(); }));
  app.querySelectorAll("[data-first]").forEach((b) => b.addEventListener("click", () => { st.first = b.dataset.first; st.acts = []; re(); }));
  app.querySelectorAll("[data-rad]").forEach((b) => b.addEventListener("click", () => { st.rad = b.dataset.rad; re(); }));
  document.getElementById("sim-undo").addEventListener("click", () => { st.acts.pop(); re(); });
  document.getElementById("sim-clear").addEventListener("click", () => { st.acts = []; re(); });
  const qi = document.getElementById("sim-q"); qi?.addEventListener("input", () => { st.q = qi.value; clearTimeout(S.simT); S.simT = setTimeout(() => { re(); const n = document.getElementById("sim-q"); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 250); });
  bindPick(document.getElementById("sim-a"), teams, (t) => t.name, (t) => { st.a = t; re(); }); bindPick(document.getElementById("sim-b"), teams, (t) => t.name, (t) => { st.b = t; re(); });
}
async function vLibrary() {
  const idx = await load("library.json"); S.lib ||= { league: idx[0]?.id, q: "" }; if (!idx.some((x) => x.id === S.lib.league)) S.lib.league = idx[0]?.id;
  if (!idx.length) { app.innerHTML = `${subHead("#/sim", "DRAFT", "Draft library")}<p class="empty">No drafts yet.</p>`; return; }
  const rows = await load(`library/${S.lib.league}.json`), q = S.lib.q.trim().toLowerCase();
  const shown = rows.filter((g) => !q || g.r.toLowerCase().includes(q) || g.d.toLowerCase().includes(q) || [...g.pr, ...g.pd].some((h) => hn(h).toLowerCase().includes(q))).slice(0, 60);
  app.innerHTML = `${subHead("#/sim", "DRAFT", "Draft library")}<nav class="subtabs" aria-label="Draft"><a href="#/sim">Draft lab</a><a href="#/library" aria-current="page">Draft library</a></nav>
    <select class="field" id="lib-l" aria-label="League" style="margin-top:12px">${idx.map((x) => `<option value="${x.id}"${x.id === S.lib.league ? " selected" : ""}>${esc(x.league)} · ${x.games} games</option>`).join("")}</select>
    <input class="field" id="lib-q" type="search" placeholder="Team or hero" aria-label="Search a team or hero" value="${esc(S.lib.q)}" style="margin-top:8px">
    ${shown.map((g) => `<${g.s ? "a" : "div"} class="card lib-g"${g.s ? ` href="#/series/${g.s}"` : ""}><div class="spread small muted"><span>${esc(g.date)} · ${g.min} min</span><span>${g.rw ? "Radiant won" : "Dire won"}</span></div>
      <div class="lib-side ${g.rw ? "won" : ""}"><b>${esc(g.r)}</b> <span class="small muted">Radiant</span><div>${g.pr.map((h) => himg(h, 28)).join("")}<span class="lib-b">${g.br.map((h) => himg(h, 18)).join("")}</span></div></div>
      <div class="lib-side ${g.rw ? "" : "won"}"><b>${esc(g.d)}</b> <span class="small muted">Dire</span><div>${g.pd.map((h) => himg(h, 28)).join("")}<span class="lib-b">${g.bd.map((h) => himg(h, 18)).join("")}</span></div></div></${g.s ? "a" : "div"}>`).join("") || `<p class="empty">No game matches.</p>`}
    <p class="small muted">Large icons are picks, small grey icons are bans. The latest 150 games per league.</p>`;
  document.getElementById("lib-l").addEventListener("change", (e) => { S.lib.league = +e.target.value; vLibrary(); });
  const qi = document.getElementById("lib-q"); qi.addEventListener("change", () => { S.lib.q = qi.value; vLibrary(); });
}

// ---------------------------------------------------------------- meta
const metaTabs = (on) => `<nav class="subtabs" aria-label="Meta">${[["#/heroes", "Tier list", "heroes"], ["#/leagues", "By league", "leagues"], ["#/matrix", "Counters", "matrix"], ["#/playbook", "Playbook", "playbook"], ["#/patch", "Patch", "patch"]].map(([h, t, k]) => `<a href="${h}"${k === on ? ' aria-current="page"' : k === "patch" ? ' class="hot"' : ""}>${t}</a>`).join("")}</nav>`;
async function vHeroes() {
  const [heroes, meta] = await Promise.all([load("heroes.json"), load("meta.json")]); S.hpos ||= "All";
  const POS = ["All", "Core", "Offlane", "Support"], list = heroes.filter((h) => S.hpos === "All" || String(h.pos || "").startsWith(S.hpos));
  const tile = (h) => `<a class="htile" href="#/hero/${h.id}"><span class="r1">${hpic(h.id, 34)}<span><span class="num">${pct(h.rec.pres)}</span><br><span class="lbl">PRESENCE</span></span></span><span class="nm">${esc(h.name)}</span><span class="ln">${esc(h.pos || h.roles.slice(0, 2).join(", "))}</span>
    <span class="pb-bar"><span style="width:${Math.round((h.rec.pick / Math.max(1, h.rec.pick + h.rec.ban)) * 100)}%"></span><span></span></span><span class="pb-n"><span>${h.rec.pick} picks · ${pct(h.rec.wr)} won</span><span>${h.rec.ban} bans</span></span>${h.patch.notes ? `<span class="small" style="color:var(--gold)">Changed in ${esc(meta.patch?.patch || "the new patch")}</span>` : ""}</a>`;
  app.innerHTML = `<h1>Meta</h1><p class="lead">The pro meta from the last 60 days (${(meta.recentGames || 0).toLocaleString("en-US")} games). Presence is how often a hero is picked or banned.</p>${metaTabs("heroes")}
    <div class="filters" role="group" aria-label="Role" style="margin-top:12px">${POS.map((p) => `<button class="fbtn" type="button" data-pos="${p}" aria-pressed="${S.hpos === p}">${p}</button>`).join("")}</div>
    ${["S", "A", "B", "C"].map((t) => { const hs = list.filter((h) => h.tier === t); return hs.length ? `<section class="tblk ${t.toLowerCase()}"><h2 class="sec-h"><span class="tier t${t}">${t}</span> ${t === "S" ? "40%+ presence" : t === "A" ? "20–40%" : t === "B" ? "8–20%" : "under 8%"}</h2><div class="htiles card">${hs.map(tile).join("")}</div></section>` : ""; }).join("")}
    <p class="small muted">Roles come from farm in pro games (last hits): Core farms most, Support least. Ranked numbers on hero pages are public games at Divine and Immortal, from OpenDota.</p>`;
  app.querySelectorAll("[data-pos]").forEach((b) => b.addEventListener("click", () => { S.hpos = b.dataset.pos; vHeroes(); }));
}
async function vHero(id) {
  const [heroes, players, meta] = await Promise.all([load("heroes.json"), load("players.json"), load("meta.json")]), h = heroes.find((x) => x.id === +id); if (!h) return vMissing();
  const known = players.map((p) => ({ p, x: p.top.find((t) => t.h === h.id) })).filter((z) => z.x && z.x.n >= 4).sort((a, b) => b.x.n - a.x.n).slice(0, 8);
  const rows = (arr, good) => arr.map((x) => `<a class="hr-row" href="#/hero/${x.h}">${himg(x.h, 30)}<span><b>${esc(hn(x.h))}</b><span class="small muted">${x.n} games</span></span><b class="num ${good ? "up" : "down"}">${pct(x.wr)}</b></a>`).join("") || `<p class="small muted" style="padding:10px">Not enough games.</p>`;
  app.innerHTML = `${subHead("#/heroes", "META · HERO", h.name)}
    <section class="mp-hero"><div class="hero-top">${hpic(h.id, 72)}<span><b>${esc(h.name)}</b><span class="small muted">${esc(h.attr === "all" ? "Universal" : { str: "Strength", agi: "Agility", int: "Intelligence" }[h.attr] || "")} · ${esc(h.attack)} · ${esc(h.roles.join(", "))}</span><span class="tier t${h.tier}">${h.tier}</span></span></div>
      <div class="rc-tiles"><div><b class="num">${pct(h.rec.pres)}</b><span>presence (60 days)</span></div><div><b class="num">${pct(h.rec.wr)}</b><span>won (${h.rec.pick} picks)</span></div><div><b class="num">${h.rec.ban}</b><span>bans</span></div></div>
      <div class="rc-tiles"><div><b class="num">${h.patch.pick}</b><span>picks on ${esc(meta.patch?.patch || "new patch")}</span></div><div><b class="num">${h.pub ? pct(h.pub.wr) : "-"}</b><span>ranked Divine+</span></div><div><b class="num">${h.tempo == null ? "-" : `${h.tempo > 0 ? "+" : ""}${Math.round(h.tempo * 100)}`}</b><span>${h.tempo == null ? "tempo" : h.tempo > 0 ? "early-game lean" : "late-game lean"}</span></div></div>
      ${h.patch.notes ? `<p class="callout small">${h.patch.notes} change ${h.patch.notes === 1 ? "line" : "lines"} for ${esc(h.name)} in patch ${esc(meta.patch?.patch || "")}. Older records may not hold. <a href="https://www.dota2.com/patches/${esc(meta.patch?.patch || "")}" target="_blank" rel="noopener">Patch notes ↗</a></p>` : ""}</section>
    <section class="mp-sec"><h2 class="sec-h">Best with</h2><div class="card hr-list">${rows(h.combos, true)}</div></section>
    <section class="mp-sec"><h2 class="sec-h">Does well against</h2><div class="card hr-list">${rows(h.beats, true)}</div></section>
    <section class="mp-sec"><h2 class="sec-h">Struggles against</h2><div class="card hr-list">${rows(h.losesTo, false)}</div></section>
    <section class="mp-sec"><h2 class="sec-h">Players known for it</h2>${known.length ? `<div class="mo-list">${known.map(({ p, x }) => `<a class="mo-i" href="#/player/${p.id}"><span class="mo-ic">${esc(initialsOf(p.name))}</span><span><b>${esc(p.name)}</b><span class="small muted">${esc(p.team)} · ${x.n} games · ${pct(x.wr)} won</span></span><span aria-hidden="true">›</span></a>`).join("")}</div>` : `<p class="small muted">None in our data.</p>`}</section>
    <p class="small muted">All-time in our data: ${h.all.pick} picks, ${pct(h.all.wr)} won, ${h.all.ban} bans. Combos and counters: pro games, older games counting less (half weight after about 3 months), pulled toward 50% on small samples. Go deeper: <a href="https://www.dotabuff.com/heroes/${esc(h.key.replace(/_/g, "-"))}" target="_blank" rel="noopener">Dotabuff ↗</a> · <a href="https://dota2protracker.com/hero/${encodeURIComponent(h.name)}" target="_blank" rel="noopener">D2PT ↗</a> · <a href="https://stratz.com/heroes/${h.id}" target="_blank" rel="noopener">STRATZ ↗</a></p>`;
}
async function vLeagues() {
  const L = await load("leagues.json"), H0 = await load("heroes.json"); S.lgm ||= L.leagues[0]?.id; const x = L.leagues.find((y) => y.id === S.lgm) || L.leagues[0];
  if (!x) { app.innerHTML = `${subHead("#/heroes", "META", "By league")}${metaTabs("leagues")}<p class="empty">No league data yet.</p>`; return; }
  const world = Object.fromEntries(H0.map((h) => [h.id, h.rec.pres]));
  app.innerHTML = `${subHead("#/heroes", "META", "By league")}${metaTabs("leagues")}
    <select class="field" id="lg-s" aria-label="League" style="margin-top:12px">${L.leagues.map((y) => `<option value="${y.id}"${y.id === x.id ? " selected" : ""}>${esc(y.league)} · ${y.games} games</option>`).join("")}</select>
    <div class="rc-tiles"><div><b class="num">${x.games}</b><span>games (120 days)</span></div><div><b class="num">${pct(x.radiant)}</b><span>Radiant won</span></div><div><b class="num">${x.avgMin}</b><span>minutes a game</span></div></div>
    <h2 class="sec-h">Most contested here</h2><div class="card hr-list">${x.top.map((h, i) => { const d = h.pres - (world[h.h] || 0); return `<a class="hr-row" href="#/hero/${h.h}"><b class="num" style="width:22px">${i + 1}</b>${himg(h.h, 32)}<span><b>${esc(hn(h.h))} <span class="small ${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${Math.round(d * 100)}</span></b><span class="pb-bar"><span style="width:${Math.round((h.p / (h.p + h.b || 1)) * 100)}%"></span><span></span></span></span><b class="num">${pct(h.pres)}</b></a>`; }).join("")}<p class="small muted" style="padding:0 12px 10px">Silver is picks, red is bans. The small number is the gap to the worldwide presence.</p></div>
    <h2 class="sec-h">First picks</h2><div class="hchips">${x.openers.map((o) => `${heroChip(o.h)} <span class="small muted">${o.n}</span>`).join(" ")}</div>`;
  document.getElementById("lg-s").addEventListener("change", (e) => { S.lgm = +e.target.value; vLeagues(); });
}
async function vMatrix() {
  const heroes = await load("heroes.json"); S.mx ||= { tab: "counters", h: heroes[0]?.id }; const h = heroes.find((x) => x.id === S.mx.h) || heroes[0];
  const rows = (arr, good) => arr.map((x) => `<a class="hr-row" href="#/hero/${x.h}">${himg(x.h, 30)}<span><b>${esc(hn(x.h))}</b><span class="small muted">${x.n} games</span></span><b class="num ${good ? "up" : "down"}">${pct(x.wr)}</b></a>`).join("") || `<p class="small muted" style="padding:10px">Not enough games.</p>`;
  app.innerHTML = `${subHead("#/heroes", "META", "Counters and combos")}${metaTabs("matrix")}
    <nav class="seg" aria-label="View" style="margin-top:12px"><a href="#/matrix" ${S.mx.tab === "counters" ? 'aria-current="page"' : ""} data-tab="counters">Counters</a><a href="#/matrix" ${S.mx.tab === "combos" ? 'aria-current="page"' : ""} data-tab="combos">Combos</a></nav>
    <p class="small muted">Pick a hero (the 40 most contested are shown).</p><div class="mx-grid">${heroes.slice(0, 40).map((x) => `<button type="button" class="mx-h${x.id === h.id ? " on" : ""}" data-h="${x.id}">${himg(x.id, 32)}<span class="small">${esc(x.name)}</span></button>`).join("")}</div>
    <h2 class="sec-h">${esc(h.name)}: ${S.mx.tab === "counters" ? "beats" : "best with"}</h2><div class="card hr-list">${rows(S.mx.tab === "counters" ? h.beats : h.combos, true)}</div>
    ${S.mx.tab === "counters" ? `<h2 class="sec-h">${esc(h.name)}: loses to</h2><div class="card hr-list">${rows(h.losesTo, false)}</div>` : ""}`;
  app.querySelectorAll("[data-tab]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); S.mx.tab = a.dataset.tab; vMatrix(); }));
  app.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => { S.mx.h = +b.dataset.h; vMatrix(); }));
}
async function vPlaybook() {
  const P = await load("playbook.json"), groups = ["All rules", ...new Set(P.rules.map((r) => r.group))]; S.pb = groups.includes(S.pb) ? S.pb : "All rules";
  const list = P.rules.filter((r) => S.pb === "All rules" || r.group === S.pb);
  app.innerHTML = `${subHead("#/heroes", "META", "Playbook")}${metaTabs("playbook")}<p class="small muted" style="margin-top:12px">Plain rules from the last year of pro games, each with how sure we are. ${esc(P.note)}</p>
    <div class="filters" role="group" aria-label="Group">${groups.map((g) => `<button class="fbtn" type="button" data-pb="${esc(g)}" aria-pressed="${S.pb === g}">${esc(g)}</button>`).join("")}</div>
    ${list.map((r) => `<div class="card pb-r"><div class="spread"><span class="small muted">${esc(r.group)}</span><span class="pk-tag ${r.tag === "solid" ? "g" : "s"}">${r.tag === "solid" ? "SOLID" : "LEAN"}</span></div><p>${r.h ? himg(r.h, 22) : ""}${r.h2 ? himg(r.h2, 22) : ""}${esc(r.text)}</p><p class="small muted">${r.n.toLocaleString("en-US")} games · ${r.z >= 0 ? "+" : ""}${r.z} standard errors from 50%</p></div>`).join("")}`;
  app.querySelectorAll("[data-pb]").forEach((b) => b.addEventListener("click", () => { S.pb = b.dataset.pb; vPlaybook(); }));
}
async function vPatch() {
  const T = await load("patch.json"); S.pt ||= 0; const p = T.patches[S.pt] || T.patches[0];
  if (!p) { app.innerHTML = `${subHead("#/heroes", "META", "Patch tracker")}${metaTabs("patch")}<p class="empty">No patch data yet.</p>`; return; }
  const tag = (x) => { const d = x.after.pres - x.before.pres; return x.after.n < 5 ? ["TOO EARLY", ""] : Math.abs(d) < 0.04 ? ["HELD UP", ""] : d > 0 ? ["ROSE", "up"] : ["FELL", "down"]; };
  const changed = p.heroes.filter((x) => x.notes), rest = p.heroes.filter((x) => !x.notes);
  const row = (x) => { const [t, c] = tag(x); return `<a class="hr-row" href="#/hero/${x.h}">${himg(x.h, 30)}<span><b>${esc(hn(x.h))}</b><span class="small muted">presence ${pct(x.before.pres)} → ${pct(x.after.pres)} · won ${pct(x.before.rate)} → ${pct(x.after.rate)}${x.notes ? ` · ${x.notes} changes` : ""}</span></span><b class="small ${c}">${t}</b></a>`; };
  app.innerHTML = `${subHead("#/heroes", "META", "Patch tracker")}${metaTabs("patch")}
    <div class="filters" role="group" aria-label="Patch" style="margin-top:10px">${T.patches.map((x, i) => `<button class="fbtn" type="button" data-pt="${i}" aria-pressed="${i === S.pt}"><b>${esc(x.patch)}</b> <span class="small">${esc(dshort(x.release))}</span></button>`).join("")}</div>
    <p class="small muted">${p.gamesAfter.toLocaleString("en-US")} pro games on ${esc(p.patch)} so far, against ${p.gamesBefore.toLocaleString("en-US")} in the 45 days before it. ${p.gamesAfter < 200 ? "Early days: changes under a few hundred games are noise." : ""} <a href="https://www.dota2.com/patches/${esc(p.patch)}" target="_blank" rel="noopener">Official notes ↗</a></p>
    ${changed.length ? `<h2 class="sec-h">Changed in ${esc(p.patch)}</h2><div class="card hr-list">${changed.slice(0, 40).map(row).join("")}</div>` : ""}
    <h2 class="sec-h">Biggest movers</h2><div class="card hr-list">${[...rest.slice(0, 8), ...rest.slice(-8).reverse()].map(row).join("")}</div>`;
  app.querySelectorAll("[data-pt]").forEach((b) => b.addEventListener("click", () => { S.pt = +b.dataset.pt; vPatch(); }));
}

// ---------------------------------------------------------------- teams and players
async function vTeams() {
  const teams = await load("teams.json"); S.tq ??= "";
  const q = S.tq.trim().toLowerCase(), list = teams.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.tag || "").toLowerCase().includes(q));
  app.innerHTML = `<h1>Teams</h1><p class="lead">Every pro team active in the last 120 days, ranked by the rating of the five players it fielded last.</p>
    <nav class="subtabs" aria-label="Teams"><a href="#/teams" aria-current="page">Teams</a><a href="#/players">Players</a></nav>
    <input class="field" id="tq" type="search" placeholder="Search a team" aria-label="Search a team" value="${esc(S.tq)}" style="margin-top:12px">
    <div class="mo-list" style="margin-top:10px">${list.map((t) => `<a class="mo-i" href="#/team/${t.id}"><b class="num" style="width:30px">${t.rank}</b>${tb(t.name, 36)}<span><b>${esc(t.name)}</b><span class="small muted">${esc(t.lastLeague || "")} · ${t.games} games · ${pct(t.wr)} won</span>${formDots(t.form.slice(-5))}</span><b class="num">${t.elo}</b></a>`).join("") || `<p class="empty">No team matches.</p>`}</div>
    <p class="small muted">Rating: 1500 is a typical pro team. Teams need 8+ games in our data to be listed.</p>`;
  const qi = document.getElementById("tq"); qi.addEventListener("input", () => { S.tq = qi.value; clearTimeout(S.tqT); S.tqT = setTimeout(() => { vTeams(); const n = document.getElementById("tq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); });
}
async function vTeam(id) {
  const t = await load(`teams/${id}.json`), pr = t.profile, rec = (x) => (x[1] ? `${x[0]}-${x[1] - x[0]}` : "-");
  const H0 = t.hist, W = 320, Hh = 90, lo = Math.min(...H0.map((x) => x[1]), 1400), hi = Math.max(...H0.map((x) => x[1]), 1700), X = (i) => 6 + (i * (W - 12)) / Math.max(1, H0.length - 1), Y = (v) => Hh - 6 - ((v - lo) / (hi - lo)) * (Hh - 12);
  app.innerHTML = `${subHead("#/teams", `TEAMS · #${t.rank}`, t.name)}
    ${jumpTabs([["tm-sum", "Summary"], ["tm-roster", "Lineup"], ["tm-drafts", "Drafts"], ["tm-series", "Series"]])}
    <section class="mp-hero" id="tm-sum"><div class="hero-top">${tb(t.name, 64)}<span><b>${esc(t.name)}</b><span class="small muted">${esc(t.tag || "")} · ${esc(t.lastLeague || "")}</span>${formDots(t.form)}</span></div>
      ${t.next ? `<a class="tm-next" href="#/match/${esc(t.next.id)}"><span class="nx">NEXT</span><span style="flex:1">vs ${esc(t.next.opp)} · BO${t.next.bo} · ${esc(when(t.next.date))}</span><b class="num ${t.next.p >= 0.5 ? "b" : "r"}">${pct(t.next.p)}</b></a>` : ""}
      <div class="rc-tiles"><div><b class="num">${t.elo}</b><span>rating · #${t.rank}</span></div><div><b class="num">${pct(t.wr)}</b><span>games won (120 days)</span></div><div><b class="num">${pr.avgMin ?? "-"}</b><span>minutes a game</span></div></div>
      <div class="rc-tiles"><div><b class="num">${rec(pr.radiant)}</b><span>on Radiant</span></div><div><b class="num">${rec(pr.dire)}</b><span>on Dire</span></div><div><b class="num">${rec(pr.short)} / ${rec(pr.long)}</b><span>under 30 / 40+ min</span></div></div>
      ${H0.length > 2 ? `<div class="card"><svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Rating over time"><path d="${H0.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(x[1]).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg><p class="small muted">Team rating after each of its last ${H0.length} games (${esc(H0[0][0])} to ${esc(H0.at(-1)[0])}).</p></div>` : ""}</section>
    <section class="mp-sec" id="tm-roster"><h2 class="sec-h">Lineup (last game)</h2><div class="tm-five">${t.roster.map((p) => `<a class="tm-p" href="#/player/${p.id}"><span class="tb" style="width:40px;height:40px">${esc(initialsOf(p.name))}</span><b>${esc(p.name)}</b><span>${esc((p.role || "").toUpperCase())}</span></a>`).join("") || `<p class="small muted">No lineup on record.</p>`}</div></section>
    <section class="mp-sec" id="tm-drafts"><h2 class="sec-h">Most played heroes</h2><div class="mp-picks">${pr.comfort.slice(0, 6).map((c) => `<a class="mp-pick" href="#/hero/${c.h}">${hpic(c.h, 40)}<b>${esc(hn(c.h))}</b><span>${c.n} games · <em style="color:var(--gold)">${pct(c.wr)}</em></span></a>`).join("")}</div>
      <div class="card">${pr.bansBy.length ? `<p class="small"><b>They ban:</b> ${pr.bansBy.map((x) => heroChip(x.h)).join(" ")}</p>` : ""}${pr.bansVs.length ? `<p class="small"><b>Banned against them:</b> ${pr.bansVs.map((x) => heroChip(x.h)).join(" ")}</p>` : ""}${pr.signature ? `<p class="small">Signature hero: ${heroChip(pr.signature.hero)} · ${rec(pr.signature.with)} with it, ${rec(pr.signature.without)} without.</p>` : ""}<p class="small"><a href="#/library">Every pro draft in the Draft library ›</a></p></div></section>
    <section class="mp-sec" id="tm-series"><h2 class="sec-h">Recent series</h2><div class="mo-list">${t.series.map((s) => `<${s.page ? "a" : "div"} class="mo-i"${s.page ? ` href="#/series/${esc(s.id)}"` : ""}><b class="num ${s.score[0] > s.score[1] ? "up" : s.score[0] < s.score[1] ? "down" : ""}" style="width:42px">${s.score[0]}-${s.score[1]}</b><span><b>vs ${esc(s.opp)}</b><span class="small muted">${esc(dshort(s.date))} · ${esc(s.league)} · BO${s.bo}</span></span><span aria-hidden="true">${s.page ? "›" : ""}</span></${s.page ? "a" : "div"}>`).join("")}</div></section>
    <div class="tm-cta"><a class="btn" href="#/versus?a=${encodeURIComponent(t.name)}">Compare in Versus</a><a class="btn gold" href="#/sim?a=${encodeURIComponent(t.name)}">Draft against them</a></div>
    <p class="small muted">More on this team: <a href="https://www.opendota.com/teams/${t.id}" target="_blank" rel="noopener">OpenDota ↗</a> · <a href="https://www.dotabuff.com/esports/teams/${t.id}" target="_blank" rel="noopener">Dotabuff ↗</a> · <a href="https://liquipedia.net/dota2/index.php?search=${encodeURIComponent(t.name)}" target="_blank" rel="noopener">Liquipedia ↗</a></p>`;
}
async function vPlayers() {
  const P = await load("players.json"); S.q ??= "";
  const q = S.q.trim().toLowerCase(), list = P.filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)).slice(0, 80);
  app.innerHTML = `${subHead("#/teams", "TEAMS", "Players")}<nav class="subtabs" aria-label="Teams"><a href="#/teams">Teams</a><a href="#/players" aria-current="page">Players</a></nav>
    <input class="field" id="pq" type="search" placeholder="Player or team" aria-label="Search a player or team" value="${esc(S.q)}" style="margin-top:12px">
    <div class="mo-list" style="margin-top:10px">${list.map((p) => `<a class="mo-i" href="#/player/${p.id}"><span class="tb" style="width:38px;height:38px">${esc(initialsOf(p.name))}</span><span><b>${esc(p.name)}</b><span class="small muted">${esc(p.role || "")} · ${esc(p.team)}</span></span><span class="pl-tops">${p.top.slice(0, 3).map((t) => himg(t.h, 24)).join("")}</span></a>`).join("") || `<p class="empty">No player matches.</p>`}</div>
    <p class="small muted">Pro players with 10+ games in the last 180 days. Names from OpenDota's pro player list.</p>`;
  const qi = document.getElementById("pq"); qi.addEventListener("input", () => { S.q = qi.value; clearTimeout(S.pqT); S.pqT = setTimeout(() => { vPlayers(); const n = document.getElementById("pq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); });
}
async function vPlayer(id) {
  const P = await load("players.json"), p = P.find((x) => x.id === +id); if (!p) return vMissing();
  app.innerHTML = `${subHead("#/players", "PLAYER", p.name)}
    <section class="mp-hero"><div class="hero-top"><span class="tb" style="width:60px;height:60px;font-size:18px">${esc(initialsOf(p.name))}</span><span><b>${esc(p.name)}</b><span class="small muted">${esc(p.role || "")} · ${p.teamId ? `<a href="#/team/${p.teamId}">${esc(p.team)}</a>` : esc(p.team)}${p.country ? ` · ${esc(p.country.toUpperCase())}` : ""}</span></span></div>
      <div class="rc-tiles"><div><b class="num">${p.games}</b><span>pro games</span></div><div><b class="num">${pct(p.wr)}</b><span>won</span></div><div><b class="num">${p.kda}</b><span>KDA</span></div></div>
      <div class="rc-tiles"><div><b class="num">${p.k} / ${p.d} / ${p.a}</b><span>kills / deaths / assists a game</span></div><div><b class="num">${p.gpm}</b><span>gold a minute</span></div><div><b class="num">${Math.round(1500 + p.rating * 173.7)}</b><span>player rating</span></div></div></section>
    <section class="mp-sec"><h2 class="sec-h">Hero pool</h2><div class="card hr-list">${p.top.map((t) => `<a class="hr-row" href="#/hero/${t.h}">${himg(t.h, 30)}<span><b>${esc(hn(t.h))}</b><span class="small muted">${t.n} games</span></span><b class="num ${t.wr >= 0.5 ? "up" : "down"}">${pct(t.wr)}</b></a>`).join("")}</div></section>
    <a class="btn wide" href="#/pcompare/${p.id}~">Compare with another player</a>
    <p class="small muted">From every pro game in our data (last 400 days). More: <a href="https://www.opendota.com/players/${p.id}" target="_blank" rel="noopener">OpenDota ↗</a> · <a href="https://www.dotabuff.com/players/${p.id}" target="_blank" rel="noopener">Dotabuff ↗</a> · <a href="https://stratz.com/players/${p.id}" target="_blank" rel="noopener">STRATZ ↗</a></p>`;
}

// ---------------------------------------------------------------- stats tab
const statTabs = (on) => `<nav class="subtabs" aria-label="Stats">${[["#/stats", "Leaders", "players"], ["#/stats/teams", "Teams", "teams"], ["#/stats/heroes", "Heroes", "heroes"], ["#/pcompare", "Compare", "compare"]].map(([h, t, k]) => `<a href="${h}"${k === on ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>`;
async function vStats(sub = "players") {
  if (sub === "teams") { const T = await load("teams.json"); S.tsort ||= "elo"; const K = { elo: ["Rating", (t) => t.elo], wr: ["Win rate", (t) => t.wr], games: ["Games", (t) => t.games] };
    const list = [...T].sort((a, b) => (K[S.tsort][1](b) ?? 0) - (K[S.tsort][1](a) ?? 0)).slice(0, 50);
    app.innerHTML = `<h1>Stats</h1>${statTabs("teams")}<div class="filters" role="group" aria-label="Sort" style="margin-top:12px">${Object.entries(K).map(([k, [l]]) => `<button class="fbtn" type="button" data-ts="${k}" aria-pressed="${S.tsort === k}">${l}</button>`).join("")}</div>
      <div class="card"><table class="tbl"><thead><tr><th>#</th><th>Team</th><th class="n">Rating</th><th class="n">Won</th><th class="n">Games</th></tr></thead><tbody>${list.map((t, i) => `<tr><td>${i + 1}</td><td><a href="#/team/${t.id}">${esc(t.name)}</a></td><td class="n">${t.elo}</td><td class="n">${pct(t.wr)}</td><td class="n">${t.games}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Games and win rate: last 120 days.</p>`;
    app.querySelectorAll("[data-ts]").forEach((b) => b.addEventListener("click", () => { S.tsort = b.dataset.ts; vStats("teams"); })); return; }
  if (sub === "heroes") { const Hs = await load("heroes.json"); S.hsort ||= "pres"; const K = { pres: ["Presence", (h) => h.rec.pres], wr: ["Win rate (20+ picks)", (h) => (h.rec.pick >= 20 ? h.rec.wr : -1)], ban: ["Bans", (h) => h.rec.ban], pub: ["Ranked Divine+", (h) => h.pub?.wr ?? -1] };
    const list = [...Hs].sort((a, b) => K[S.hsort][1](b) - K[S.hsort][1](a)).slice(0, 60);
    app.innerHTML = `<h1>Stats</h1>${statTabs("heroes")}<div class="filters" role="group" aria-label="Sort" style="margin-top:12px">${Object.entries(K).map(([k, [l]]) => `<button class="fbtn" type="button" data-hs="${k}" aria-pressed="${S.hsort === k}">${l}</button>`).join("")}</div>
      <div class="card"><table class="tbl"><thead><tr><th>Hero</th><th class="n">Pres.</th><th class="n">Picks</th><th class="n">Won</th><th class="n">Bans</th><th class="n">Ranked</th></tr></thead><tbody>${list.map((h) => `<tr><td><a href="#/hero/${h.id}">${himg(h.id, 20)}${esc(h.name)}</a></td><td class="n">${pct(h.rec.pres)}</td><td class="n">${h.rec.pick}</td><td class="n">${pct(h.rec.wr)}</td><td class="n">${h.rec.ban}</td><td class="n">${h.pub ? pct(h.pub.wr) : "-"}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Pro games, last 60 days. Ranked: public games at Divine and Immortal (OpenDota).</p>`;
    app.querySelectorAll("[data-hs]").forEach((b) => b.addEventListener("click", () => { S.hsort = b.dataset.hs; vStats("heroes"); })); return; }
  const P = await load("players.json"); S.psort ||= "kda"; S.prole ||= "All";
  const K = { kda: ["KDA", (p) => p.kda], gpm: ["Gold/min", (p) => p.gpm], wr: ["Win rate", (p) => p.wr], k: ["Kills", (p) => p.k], a: ["Assists", (p) => p.a], rating: ["Rating", (p) => p.rating] };
  const ROLES = ["All", "Core", "Offlane", "Support"], list = P.filter((p) => p.games >= 25 && p.named && (S.prole === "All" || String(p.role || "").startsWith(S.prole))).sort((a, b) => K[S.psort][1](b) - K[S.psort][1](a)).slice(0, 50);
  app.innerHTML = `<h1>Stats</h1><p class="lead">Pro player leaders (25+ games in the last 400 days).</p>${statTabs("players")}
    <div class="filters" role="group" aria-label="Role" style="margin-top:12px">${ROLES.map((r) => `<button class="fbtn" type="button" data-pr="${r}" aria-pressed="${S.prole === r}">${r}</button>`).join("")}</div>
    <div class="filters" role="group" aria-label="Sort">${Object.entries(K).map(([k, [l]]) => `<button class="fbtn" type="button" data-ps="${k}" aria-pressed="${S.psort === k}">${l}</button>`).join("")}</div>
    <div class="card"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th class="n">${esc(K[S.psort][0])}</th><th class="n">Games</th></tr></thead><tbody>${list.map((p, i) => `<tr><td>${i + 1}</td><td><a href="#/player/${p.id}">${esc(p.name)}</a><br><span class="small muted">${esc(p.team)} · ${esc(p.role || "")}</span></td><td class="n"><b>${S.psort === "wr" ? pct(p.wr) : S.psort === "rating" ? Math.round(1500 + p.rating * 173.7) : p[S.psort]}</b></td><td class="n">${p.games}</td></tr>`).join("")}</tbody></table></div>`;
  app.querySelectorAll("[data-ps]").forEach((b) => b.addEventListener("click", () => { S.psort = b.dataset.ps; vStats(); }));
  app.querySelectorAll("[data-pr]").forEach((b) => b.addEventListener("click", () => { S.prole = b.dataset.pr; vStats(); }));
}
async function vPstat(id) { return vPlayer(id); }
async function vPcompare(arg) {
  const P = (await load("players.json")).filter((p) => p.named), [ia = "", ib = ""] = String(arg || "").split("~"), A = P.find((p) => String(p.id) === ia), B = P.find((p) => String(p.id) === ib);
  const opts = (cur) => `<option value="">Choose a player</option>${[...P].sort((a, b) => a.name.localeCompare(b.name)).map((p) => `<option value="${p.id}"${String(p.id) === cur ? " selected" : ""}>${esc(p.name)} · ${esc(p.team)}</option>`).join("")}`;
  const row = (label, a, b, f, hi = true) => { const better = a == null || b == null || a === b ? 0 : (a > b) === hi ? 1 : 2; return `<div class="tape"><b class="${better === 1 ? "hi" : ""}">${a == null ? "-" : f(a)}</b><span>${label}</span><b class="${better === 2 ? "hi" : ""}">${b == null ? "-" : f(b)}</b></div>`; };
  app.innerHTML = `<h1>Stats</h1>${statTabs("compare")}<div class="vs-pick2" style="margin-top:12px"><select class="field" id="pc-a" aria-label="First player">${opts(ia)}</select><select class="field" id="pc-b" aria-label="Second player">${opts(ib)}</select></div>
    ${A && B ? `<section class="vs-card">${row("Games", A.games, B.games, (x) => x)}${row("Win rate", A.wr, B.wr, pct)}${row("KDA", A.kda, B.kda, (x) => x)}${row("Kills", A.k, B.k, (x) => x)}${row("Deaths", A.d, B.d, (x) => x, false)}${row("Assists", A.a, B.a, (x) => x)}${row("Gold/min", A.gpm, B.gpm, (x) => x)}${row("Rating", A.rating, B.rating, (x) => Math.round(1500 + x * 173.7))}
      <p class="small">Shared heroes: ${A.top.filter((x) => B.top.some((y) => y.h === x.h)).map((x) => heroChip(x.h)).join(" ") || "none in their top eight"}</p></section>` : `<p class="empty">Pick two players.</p>`}`;
  const go = () => { location.hash = `#/pcompare/${document.getElementById("pc-a").value}~${document.getElementById("pc-b").value}`; };
  document.getElementById("pc-a").addEventListener("change", go); document.getElementById("pc-b").addEventListener("change", go);
}

// ---------------------------------------------------------------- more
async function vMore() {
  const acc = await load("accuracy.json").catch(() => null), ic = (d) => icon(d, 20);
  const groups = [
    ["Predictions", [["#/picks", "Picks", "Our own lines for scheduled matches.", I.star], ["#/events", "Events", "Tournaments on the schedule and each field's strength.", I.cup], ["#/versus", "Versus", "Any team against any team, best of 1 to 5.", I.vs], ["#/history", "History", "Every past series, game by game.", I.lib], ["#/news", "News and talk", "Headlines, Reddit, YouTube and Steam, tagged to teams.", I.news]]],
    ["Draft room", [["#/sim", "Draft lab", "Two sides, five heroes each, live win chance and suggestions.", I.grid], ["#/playbook", "Playbook", "Plain rules from pro games, with how sure we are.", I.book], ["#/library", "Draft library", "Pro games with both drafts, by league.", I.lib], ["#/matrix", "Counter matrix", "Who each hero beats and loses to.", I.swap], ["#/leagues", "Meta by league", "Contested heroes and first picks per league.", I.map], ["#/patch", "Patch tracker", "Changed heroes, risers and fallers.", I.patch], ["#/players", "Players", "Every pro player, pools and stats.", I.user]]],
    ["About", [["#/learning", "What we learned", "Accuracy over time, settings and lessons.", I.chart], ["#/how", "How it works", "The model, the learning and the limits.", I.gear], ["#/sources", "Data sources", "Where every number comes from.", I.link]]],
    ["Switch sport", [["../nba/", "NBA", "Games, picks and players.", I.ball], ["../fiba/", "FIBA", "National teams and club competitions.", I.ball], ["../mlbb/", "MLBB", "MPL and international MLBB esports.", I.ball]]]];
  app.innerHTML = `<h1>More</h1>
    <a class="mo-rec" href="#/results"><span><b class="lbl">OUR RECORD</b><span>Results and accuracy</span></span>${acc ? `<span class="mo-stats"><span><b class="num">${pct(acc.overall.rate)}</b><span>winners called (back-test)</span></span><span><b class="num">${acc.overall.n.toLocaleString("en-US")}</b><span>series graded</span></span><span><b class="num">${acc.overall.brier}</b><span>Brier (lower is better)</span></span></span>` : ""}<span class="small muted">Every graded series, the saved-before-start record and calibration.</span></a>
    ${groups.map(([t, items]) => `<h2 class="sec-h">${esc(t)}</h2><div class="mo-list">${items.map(([h, n, d, i]) => `<a class="mo-i" href="${h}"><span class="mo-ic">${ic(i)}</span><span><b>${esc(n)}</b><span class="small muted">${esc(d)}</span></span><span aria-hidden="true">›</span></a>`).join("")}</div>`).join("")}
    <p class="small muted" style="margin-top:14px">Statistical projections for analysis and entertainment. Not betting advice. No sportsbook data is used for Dota 2. All dates and times are Philippine time (Asia/Manila). Not affiliated with or endorsed by Valve.</p>`;
}
async function vResults() {
  const [res, acc] = await Promise.all([load("results.json"), load("accuracy.json")]), o = acc.overall, C = 2 * Math.PI * 40, pm = acc.prematch;
  app.innerHTML = `${subHead("#/more", "OUR RECORD", "Results and accuracy")}
    ${jumpTabs([["rc-score", "Scorecard"], ["rc-saved", "Saved before start"], ["rc-all", "All series"]])}
    <section class="mp-sec" id="rc-score"><div class="rc-hero"><svg role="img" aria-label="${pct(o.rate)} of series winners called" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--surface-2)" stroke-width="10"/><circle cx="48" cy="48" r="40" fill="none" stroke="var(--ok)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(o.rate * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 48 48)"/><text x="48" y="54" text-anchor="middle" font-family="Space Grotesk, sans-serif" font-size="20" font-weight="700" fill="currentColor">${pct(o.rate)}</text></svg><span><b>Series winners called (back-test)</b><span class="small">Across ${o.n.toLocaleString("en-US")} graded series in the walk-forward replay: each projected only from games played before it.</span></span></div>
      <div class="rc-tiles"><div><b class="num">${pct(acc.last90.rate)}</b><span>last 90 days (${acc.last90.n})</span></div><div><b class="num">${pct(o.pickRate)}</b><span>60%+ picks right (${o.picks})</span></div><div><b class="num">${o.brier}</b><span>series Brier</span></div></div>
      <p class="small muted">Brier score: 0 is perfect, 0.25 is a coin flip. Lower is better.</p>
      <h2 class="sec-h">When we say 70%, does it happen 70%?</h2><div class="card rc-cal">${acc.buckets.filter((b) => b.n).map((b) => `<div><b>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</b><span class="bars"><span><i class="s" style="width:${Math.round(b.said * 100)}%"></i></span><span><i class="h" style="width:${Math.round(b.real * 100)}%"></i></span></span><b class="h">${pct(b.real)}</b></div>`).join("")}<div class="leg small"><span><i class="s"></i>We said</span><span><i class="h"></i>It happened</span></div></div>
      <h2 class="sec-h">By format and tier</h2><div class="card rc-weak">${[["Best-of-1", acc.byBo[1]], ["Best-of-3", acc.byBo[3]], ["Best-of-5", acc.byBo[5]], ["Premium events", acc.byTier.premium], ["Professional events", acc.byTier.professional]].filter(([, x]) => x && x.n).map(([l, x]) => `<div><b>${l}</b><span class="small muted">${x.n} series · ${pct(x.rate)} called</span><b class="num ${x.brier >= 0.25 ? "dn" : ""}">${x.brier?.toFixed(3)}</b></div>`).join("")}<p class="small">Best-of-2 series are left out of the winner count when they end 1-1.</p></div>
      <h2 class="sec-h">Does the draft help?</h2><div class="card"><div class="rc-tiles two"><div><b class="num">${acc.games.brier}</b><span>Ratings only</span></div><div><b class="num">${acc.games.brierDraft}</b><span>Ratings + draft</span></div></div><p class="small">Held-out test (${acc.draft.test.toLocaleString("en-US")} newer games): draft winner called ${acc.draft.winnerPlain.n ? pct(acc.draft.winnerPlain.hit / acc.draft.winnerPlain.n) : "-"} of the time; the 13-factor model scored ${acc.draft.brier.factors} against ${acc.draft.brier.plainDraft} for the plain draft (${acc.draft.adopted ? "adopted" : "not adopted"}).</p><table class="tbl small"><thead><tr><th>Factor</th><th class="n">Weight</th><th class="n">Sure?</th></tr></thead><tbody>${acc.draft.weights.map((w) => `<tr><td>${esc(w.label)}</td><td class="n">${w.w > 0 ? "+" : ""}${w.w}</td><td class="n">${Math.abs(w.z) >= 2 ? "yes" : "no"}</td></tr>`).join("")}</tbody></table><p class="small">Single-game Brier over ${acc.games.n.toLocaleString("en-US")} games once both drafts were known. The draft adds a little on top of the players' strength (winners ${pct(acc.games.hit)} → ${pct(acc.games.hitDraft)}).</p></div></section>
    <section class="mp-sec" id="rc-saved"><h2 class="sec-h">Saved before the match</h2><div class="card">${pm.n ? `<p><b class="num" style="font-size:24px">${pm.hit} of ${pm.n}</b> series winners right${pm.brier != null ? ` · Brier ${pm.brier}` : ""}.</p>` : `<p class="small">No saved match has finished yet. Tracking started with the Dota 2 launch on 21 Nov 2026.</p>`}<p class="small muted">The honest test: the last projection before each match, frozen and graded after.</p>
      ${pm.list.length ? `<div class="mo-list">${pm.list.slice(0, 20).map((e) => `<div class="mo-i"><b class="num ${e.result.right ? "up" : e.result.right === false ? "down" : ""}" style="width:42px">${e.result.score[0]}-${e.result.score[1]}</b><span><b>${esc(e.a)} vs ${esc(e.b)}</b><span class="small muted">${esc(dshort(e.date))} · we said ${esc(e.p >= 0.5 ? e.a : e.b)} ${pct(Math.max(e.p, 1 - e.p))}</span></span><span>${e.result.right ? "✓" : e.result.right === false ? "✗" : "–"}</span></div>`).join("")}</div>` : ""}</div></section>
    <section class="mp-sec" id="rc-all"><h2 class="sec-h">All series</h2>${res.slice(0, 80).map(resultRow).join("")}<p><a class="go" href="#/history">Every previous series ›</a></p></section>`;
}
async function vLearning() {
  const L = await load("learning.json"), tl = L.timeline, W = 340, Hh = 110, P = 8, X = (i) => P + (i * (W - 2 * P)) / Math.max(1, tl.length - 1), Y = (v) => Hh - P - ((v - 0.5) / 0.3) * (Hh - 2 * P);
  app.innerHTML = `${subHead("#/more", "MORE", "What we learned")}
    <div class="card"><h2 class="sec-h" style="margin-top:0">Winners called, month by month</h2>${tl.length > 1 ? `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="Accuracy by month"><line x1="${P}" x2="${W - P}" y1="${Y(0.5)}" y2="${Y(0.5)}" stroke="var(--line-2)" stroke-dasharray="3 3"/><path d="${tl.map((w, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(Math.min(0.8, Math.max(0.5, w.acc))).toFixed(1)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="${tl.map((w, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(w.cumAcc).toFixed(1)}`).join("")}" fill="none" stroke="var(--gold)" stroke-width="2"/></svg><p class="small muted"><span style="color:var(--accent-ink)">Blue</span>: each month. <span style="color:var(--gold)">Gold</span>: all months so far. Dashed: 50%.</p>` : ""}
      <table class="tbl"><thead><tr><th>Month</th><th class="n">Series</th><th class="n">Called</th><th class="n">Brier</th></tr></thead><tbody>${[...tl].reverse().slice(0, 12).map((w) => `<tr><td>${esc(w.month)}</td><td class="n">${w.n}</td><td class="n">${pct(w.acc)}</td><td class="n">${w.brier}</td></tr>`).join("")}</tbody></table></div>
    <h2 class="sec-h">Lessons</h2><div class="card"><ul class="dots">${L.lessons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
    <h2 class="sec-h">Current settings</h2><div class="card"><ul class="plain small"><li class="spread"><span>Rating speed</span><b>${L.params.K}</b></li><li class="spread"><span>Idle fade</span><b>${L.params.H} days</b></li><li class="spread"><span>Player blend</span><b>${L.params.w}</b></li><li class="spread"><span>New team start</span><b>${L.params.r0}</b></li><li class="spread"><span>Draft weight</span><b>${L.params.dw}</b></li></ul><p class="small muted">Chosen by replaying every series and keeping the best Brier score, then frozen for a week (last set ${esc(dshort(L.frozen))}), so games after it are graded on settings that never saw them.</p></div>`;
}
async function vHistory() {
  const Hh = await load("history.json"), f = (S.hf ||= { q: "", n: 60 }), q = f.q.trim().toLowerCase();
  const list = Hh.filter((r) => !q || `${r[1]} ${r[2]} ${r[3]}`.toLowerCase().includes(q));
  app.innerHTML = `${subHead("#/more", "MORE", "History")}<input class="field" id="hq" type="search" placeholder="Team or league" aria-label="Search a team or league" value="${esc(f.q)}">
    <p class="small muted">${list.length.toLocaleString("en-US")} series. Our chance is what the walk-forward replay said before each series.</p>
    <div class="mo-list">${list.slice(0, f.n).map((r) => { const aw = r[4] > r[5], right = r[7] && Math.abs(r[6] - 0.5) >= 0.1 ? (r[6] >= 0.5) === aw : null; return `<${r[8] ? "a" : "div"} class="mo-i"${r[8] ? ` href="#/series/${esc(r[8])}"` : ""}><b class="num" style="width:42px">${r[4]}-${r[5]}</b><span><b>${esc(r[2])} vs ${esc(r[3])}</b><span class="small muted">${esc(r[0])} · ${esc(r[1])} · we said ${esc(r[6] >= 0.5 ? r[2] : r[3])} ${pct(Math.max(r[6], 1 - r[6]))}</span></span><span>${right == null ? "" : right ? "✓" : "✗"}</span></${r[8] ? "a" : "div"}>`; }).join("")}</div>
    ${list.length > f.n ? `<button class="btn wide" type="button" id="hmore">Show more</button>` : ""}`;
  const qi = document.getElementById("hq"); qi.addEventListener("change", () => { f.q = qi.value; f.n = 60; vHistory(); });
  document.getElementById("hmore")?.addEventListener("click", () => { f.n += 60; vHistory(); });
}
async function vSeries(id) {
  const s = await load(`series/${id}.json`), aw = s.score[0] > s.score[1];
  const side = (picks, bans, label, cls) => `<div class="sg-t ${cls}"><span class="lbl">${esc(label)}</span><div class="sg-p">${picks.map((h) => `<a href="#/hero/${h}">${himg(h, 34)}<b>${esc(hn(h))}</b></a>`).join("") || `<span class="small muted">Draft not recorded.</span>`}</div>${bans.length ? `<div class="sg-b"><span class="lbl">BANS</span>${bans.map((h) => `<span title="${esc(hn(h))} banned">${himg(h, 20)}</span>`).join("")}</div>` : ""}</div>`;
  const lines = (pl) => `<table class="tbl small"><tbody>${pl.map((p) => `<tr><td>${himg(p.h, 18)}${p.n ? `<a href="#/player/${p.id}">${esc(p.n)}</a>` : `<span class="muted">${esc(hn(p.h))}</span>`}</td><td class="n">${p.k}/${p.d}/${p.a}</td><td class="n">${p.gpm} gpm</td></tr>`).join("")}</tbody></table>`;
  app.innerHTML = `${subHead("#/history", `${s.league} · BO${s.bo}`, `${s.a} vs ${s.b}`)}
    <section class="mp-hero"><div class="sc big"><span class="${aw ? "w" : "l"}">${tlink(s.a, s.aId)}</span><span class="num">${s.score[0]} – ${s.score[1]}</span><span class="${aw ? "l" : "w"}">${tlink(s.b, s.bId)}</span></div>
      <p class="small">${esc(dshort(s.date))} · Before the series we said <b>${esc(s.p >= 0.5 ? s.a : s.b)} ${pct(Math.max(s.p, 1 - s.p))}</b> (ratings ${s.elo[0]} vs ${s.elo[1]}). ${s.draw ? "Drawn 1-1." : !s.graded ? "Not graded: a team had too few games." : s.close ? "Too close to call." : s.right ? "<b class='up'>Called.</b>" : "<b class='down'>Missed.</b>"}</p></section>
    ${s.games.map((g, i) => `<section class="mp-sec"><h2 class="sec-h">Game ${i + 1} · ${g.winA ? esc(s.a) : esc(s.b)} won · ${g.min} min</h2><div class="card">
      <p class="small muted">${esc(s.a)} on ${g.aSide}. Before the game: ${esc(s.a)} ${pct(g.pA)}${g.pDraftA != null ? ` · after both drafts: ${pct(g.pDraftA)}` : ""}.</p>
      ${side(g.pickA, g.banA, s.a, "a")}${side(g.pickB, g.banB, s.b, "b")}
      ${g.draft ? `<p class="small"><b>Draft winner (our read):</b> ${esc(g.draft.pA >= 0.5 ? s.a : s.b)} ${pct(Math.max(g.draft.pA, 1 - g.draft.pA))} · ${(g.draft.pA >= 0.5) === g.winA ? "<b class=up>held up</b>" : "<b class=down>did not hold</b>"}</p><div class="dr-two">${draftReadHtml(g.draft.readA, s.a, "a")}${draftReadHtml(g.draft.readB, s.b, "b")}</div>` : ""}
      <details><summary class="small">Player lines</summary><h3 class="small">${esc(s.a)}</h3>${lines(g.playersA)}<h3 class="small">${esc(s.b)}</h3>${lines(g.playersB)}</details>
      <p class="small"><a href="https://www.opendota.com/matches/${g.id}" target="_blank" rel="noopener">Full match on OpenDota ↗</a></p></div></section>`).join("")}`;
}
async function vNews() {
  const N = await load("news.json"); S.nf ||= "all"; const K = { all: "All", roster: "Roster news", news: "News", community: "Reddit", video: "Video", official: "Valve" };
  const list = N.items.filter((x) => S.nf === "all" || (S.nf === "roster" ? x.roster : x.kind === S.nf)).slice(0, 80);
  app.innerHTML = `${subHead("#/more", "MORE", "News and talk")}<p class="small muted">${esc(N.note)}</p>
    <div class="filters" role="group" aria-label="Show">${Object.entries(K).map(([k, l]) => `<button class="fbtn" type="button" data-nf="${k}" aria-pressed="${S.nf === k}">${l}</button>`).join("")}</div>
    ${list.length ? newsList(list) : `<p class="empty">Nothing in this group in the last 21 days.</p>`}<p class="small muted">Updated ${esc(ago(N.fetched))}.</p>`;
  app.querySelectorAll("[data-nf]").forEach((b) => b.addEventListener("click", () => { S.nf = b.dataset.nf; vNews(); }));
}
function vHow() { app.innerHTML = `${subHead("#/more", "MORE", "How it works")}
  <div class="card doc-c"><h2>The idea</h2><p>The same workflow as our MLBB section. Every pro series of the last 400 days is replayed in date order. Before each series we project it from what was known then, grade it once it is played, and learn from every game. Nothing from the future leaks into a past projection.</p></div>
  <div class="card doc-c"><h2>Ratings</h2><ul class="dots"><li>Every player and every team has a rating that moves after each game: up after a win, down after a loss, more when the result was a surprise.</li><li>A team's strength is read from the five players it fielded last (the best setting in our tests), so stand-ins and roster changes count at once.</li><li>Ratings fade slowly toward average when a player is idle. New teams and players start a little below average.</li><li>Radiant's small edge is learned as we go and used in single games once the side is known.</li></ul></div>
  <div class="card doc-c"><h2>Series</h2><p>A single-game chance becomes a series chance with the best-of math (best-of-1, 2, 3 or 5). Best-of-2 can end 1-1. Picks are capped at 90% for a series and 85% for map totals.</p></div>
  <div class="card doc-c"><h2>Drafts</h2><p>Each hero's pro win rate, hero pairs on the same side (combos) and hero-against-hero results (counters) are learned from earlier games only, older games counting less. The Draft lab adds them on top of the ratings. Tested on every game once both drafts were known, they help a little, so treat them as a guide.</p></div>
  <div class="card doc-c"><h2>Learning and honesty</h2><ul class="dots"><li>The settings are chosen by replaying all history and keeping the best Brier score, then frozen for a week.</li><li>A pull toward 50% is tested on series the fit never saw and only used if it helps.</li><li>The last projection before each scheduled match is saved and graded after: the saved-before-start record.</li><li>Not graded: series where a team had fewer than 8 games in our data, and best-of-2 draws.</li></ul></div>
  <div class="card doc-c"><h2>Limits</h2><ul class="dots"><li>No sportsbook odds are used or shown. Fair odds are 1 ÷ our chance.</li><li>Headlines are shown for context and never move a number.</li><li>Big patches (like 7.42) can shake the meta; hero numbers after a patch need a few hundred games to settle.</li></ul></div>`; }
async function vSources() { const meta = await load("meta.json");
  app.innerHTML = `${subHead("#/more", "MORE", "Data sources")}
  <div class="card doc-c"><h2>Read</h2><ul class="dots">
    <li><b>OpenDota</b> (opendota.com, open data from Valve's match replays): every professional and premium-tier match since ${esc(dshort(meta.firstGame))} with full drafts (picks and bans in order), sides, length and each player's hero, kills, deaths, assists, gold a minute and last hits; team names and logos, league names and tiers, pro player names, the hero list and hero stats (pro picks, bans and wins; public ranked games at Divine and Immortal). Read through its public API and SQL explorer, about 30 calls a run.</li>
    <li><b>Liquipedia Dota 2</b> (CC-BY-SA 3.0): the schedule of upcoming matches (teams, start time, best-of, tournament and stage), from Liquipedia:Matches, one page render per run.</li>
    <li><b>Valve</b> (dota2.com): the official patch list and the newest patch's notes (how many changes each hero got). Hero art and icons from Valve's image server.</li>
    <li><b>Steam news</b> (Valve's API for app 570): Valve announcements and press coverage listed on Steam.</li>
    <li><b>Google News</b> search feeds: pro-scene headlines and one search per team playing in the next 7 days.</li>
    <li><b>Reddit</b> (r/DotA2, r/CompetitiveDota2 feeds): community talk, roster and match threads.</li>
    <li><b>YouTube</b> channel feeds: Dota 2 (official), PGL, BLAST, ESL Dota 2 and other tournament and team channels.</li></ul></div>
  <div class="card doc-c"><h2>Linked, not read</h2><ul class="dots"><li><b>Dotabuff</b>, <b>Dota2ProTracker (D2PT)</b> and <b>Spectral.gg</b>: their site rules do not allow AI tools to collect their pages, so we link to them from hero, team and player pages instead.</li><li><b>STRATZ</b>: its API needs a personal account token. The fetcher is ready to use one if the site owner adds it; until then STRATZ is linked, not read.</li><li><b>GosuGamers</b>, <b>hawk.live</b>, <b>DLTV</b>: score and live sites; their match pages are not offered as a data feed, and several carry betting content.</li><li>Facebook, Instagram, X, TikTok and Discord: need a login.</li></ul></div>
  <div class="card doc-c"><h2>Not used</h2><ul class="dots"><li>No sportsbook or betting data is read or shown. Headlines from betting and prediction-market outlets are filtered out.</li></ul></div>`; }
function vMissing() { app.innerHTML = `<div class="card"><h2>Page not found</h2><p><a class="go" href="#/matches">Back to matches</a></p></div>`; }
function stamp(meta) { const el = document.getElementById("updated"); if (el && meta) el.textContent = `Data refreshed ${new Date(meta.updated).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} PH time · ${meta.series.toLocaleString()} series and ${meta.games.toLocaleString()} games in our data · ${meta.players} players · ${meta.heroes} heroes.`; }

async function route() {
  const seq = (S.seq = (S.seq || 0) + 1), h = location.hash || "#/matches", st = (S.stack ||= []);
  if (st.length > 1 && st[st.length - 2] === h) st.pop(); else if (st[st.length - 1] !== h) st.push(h);
  const [, viewRaw = "matches", arg] = h.split("?")[0].split("/"), view = viewRaw || "matches";
  drawNav(TAB[view] || "matches"); document.body.classList.toggle("mlbb-sub", !["matches", "sim", "draft", "heroes", "teams", "stats", "more"].includes(view));
  if (!S.H) { const hs = await load("heroes.json").catch(() => []); S.H = Object.fromEntries(hs.map((x) => [x.id, x])); }
  if (!S.logos) { const [ts, up] = await Promise.all([load("teams.json").catch(() => []), load("upcoming.json").catch(() => [])]); S.logos = {}; for (const t of ts) if (t.logo) S.logos[t.name] = t.logo; for (const m of up) for (const t of [m.a, m.b]) if (t.logo) S.logos[t.name] = t.logo; }
  try { await ({ matches: vMatches, match: vMatch, versus: vVersus, events: vEvents, m8: vEvents, picks: vPicks, draft: vSim, sim: vSim, library: vLibrary, heroes: vHeroes, hero: vHero, leagues: vLeagues, matrix: vMatrix, playbook: vPlaybook, patch: vPatch, teams: vTeams, team: vTeam, players: vPlayers, player: vPlayer, stats: vStats, pstat: vPstat, pcompare: vPcompare, more: vMore, results: vResults, learning: vLearning, history: vHistory, series: vSeries, news: vNews, how: vHow, sources: vSources }[view] || vMissing)(decodeURIComponent(arg || "")); }
  catch (e) { if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">${esc(e.message)}</p><p><a class="go" href="#/matches">Back to matches</a></p></div>`; }
  if (S.last !== h) window.scrollTo(0, 0); S.last = h;
  if (!document.getElementById("updated").textContent) load("meta.json").then(stamp).catch(() => {});
}
document.addEventListener("click", (e) => { const a = e.target.closest?.("a.back"); if (a && (S.stack?.length || 0) > 1) { e.preventDefault(); history.back(); } });
addEventListener("hashchange", route);
route();
