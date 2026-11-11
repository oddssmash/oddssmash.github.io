// ODDSSMASH - front end. Reads the JSON the pipeline writes into ./data.
const app = document.getElementById("app");
const tipEl = document.getElementById("tip");
// S.P maps player id -> players.json entry and S.PN maps lower-case name -> id (both filled at boot, used for faces).
const S = { ver: Date.now(), meta: null, teams: [], T: {}, P: {}, PN: new Map(), cache: new Map(), courts: new Map(), resFilter: "all", resShown: 40, role: "star" };

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? esc(u) : "#");
// News feeds sometimes leave HTML tags or entities ("&lt;p&gt;", "&#8217;") inside headlines and summaries. plain() turns that into
// readable text: a <textarea> decodes entities without ever building elements, then tags are dropped. Still pass the result through esc().
const plainBox = document.createElement("textarea");
function plain(s) {
  let t = String(s ?? "");
  if (!/[&<]/.test(t)) return t;
  for (let i = 0; i < 2 && /&[#\w]+;/.test(t); i++) { plainBox.innerHTML = t; t = plainBox.value; }
  return t.replace(/<\/?[a-z][^>]*>/gi, " ").replace(/<\/?[a-z][^>]*$/i, "").replace(/\s+/g, " ").trim();
}
const f1 = (x) => (x == null || Number.isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
const f0 = (x) => (x == null || Number.isNaN(x) ? "-" : String(Math.round(x)));
const sg = (x, d = 1) => { if (x == null || x === "" || Number.isNaN(Number(x))) return "-"; x = Number(x); const a = Math.abs(x).toFixed(d); return (Number(a) === 0 ? "" : x > 0 ? "+" : "−") + a; }; // no sign on a value that rounds to zero
// Exact halves round to the even number, so two sides of the same game (77.5% / 22.5%) still add up to 100%.
const pct = (p) => { if (p == null) return "-"; const v = Math.round(p * 1e6) / 1e4, f = Math.floor(v); const r = Math.abs(v - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(v); return r + "%"; };
const cls = (x) => (x > 0 ? "up" : x < 0 ? "down" : "");
// Every date and time on the site is shown in Philippine time (Asia/Manila), whatever the visitor's device is set to.
// A date-only value ("2025-11-23", a US game date) is shown as written, with "US date" noted where it appears.
const TZ = "Asia/Manila", PHT = "PH time";
const dOnly = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ""));
const fmtD = (iso, o) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-US", { ...o, timeZone: dOnly(iso) ? "UTC" : TZ }); };
const day = (iso) => fmtD(iso, { weekday: "short", month: "short", day: "numeric" });
const dayLong = (iso) => fmtD(iso, { weekday: "long", month: "long", day: "numeric" });
const time = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "-" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }); };
const timePH = (iso) => `${time(iso)} ${PHT}`;
const dayKey = (iso) => fmtD(iso, { year: "numeric", month: "2-digit", day: "2-digit" }); // Manila calendar day, for grouping
const stamp = (iso) => `${dayLong(iso)}, ${timePH(iso)}`;
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const T = (id) => S.T[id] || { abbr: "?", name: "Unknown", short: "Unknown", color: "555555" };
const badge = (id) => `<span class="tb" style="--tc:#${esc(T(id).color || "555555")}">${esc(T(id).abbr)}</span>`;

// ---------------------------------------------------------------- identity: player faces and team logos
// Reusable building blocks. Every one returns an HTML string with all data escaped.
//   avatar(id, name, { size, team, alt })   circular headshot; initials on a neutral circle if the photo is missing or fails
//   teamLogo(tid, { size, alt })            team logo; the coloured abbreviation badge() if the logo is missing or fails
//   teamName(tid, { size, text })           logo + team name on one line (text: "name" | "short" | "abbr")
//   playerChip(id, name, { size, href })    small face + name on one line; a link when href is given
//   faceStack(players, { size, max })       overlapping faces for a list of { id, n }
//   pid(name)                               player id for an exact name (for data that only carries names), or null
//   pname(name)                             full name on wide screens, "J. Brunson" on phones
// Images come from ESPN's public image server. Sizes are CSS pixels; each request asks for about twice that.
const AV_PX = { xs: 24, sm: 32, md: 44, lg: 56, xl: 96 };
const TL_PX = { xs: 18, sm: 24, md: 32, lg: 48, xl: 64 };
const HEAD_W = 350, HEAD_H = 254; // size of the source headshots; requests keep this shape so faces are not stretched
const IMG_ATTRS = `loading="lazy" decoding="async" referrerpolicy="no-referrer"`;
const isDark = () => document.documentElement.dataset.theme !== "light";

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
function initials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter((w) => w && !NAME_SUFFIX.test(w));
  if (!parts.length) return "?";
  const first = Array.from(parts[0])[0], last = parts.length > 1 ? Array.from(parts.at(-1))[0] : "";
  return (first + last).toUpperCase();
}
function shortName(name) {
  const parts = String(name ?? "").trim().split(/\s+/);
  return parts.length < 2 ? parts[0] || "" : `${Array.from(parts[0])[0]}. ${parts.slice(1).join(" ")}`;
}
const pname = (name) => `<span class="nm" title="${esc(name)}"><span class="nm-f">${esc(name)}</span><span class="nm-s">${esc(shortName(name))}</span></span>`;
const pid = (name) => S.PN.get(String(name ?? "").trim().toLowerCase()) ?? null;

// Headshot address for a displayed circle of `px` CSS pixels. Three request sizes only, so one player's photo is reused across pages.
function headshotUrl(id, px = 44) {
  if (!/^\d+$/.test(String(id ?? ""))) return "";
  const h = px <= 44 ? 98 : px <= 64 ? 138 : HEAD_H, w = Math.round((h * HEAD_W) / HEAD_H);
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=${w}&h=${h}`;
}
function avatar(id, name, { size = "md", team = null, alt } = {}) {
  const px = AV_PX[size] || AV_PX.md, src = headshotUrl(id, size === "xl" ? 120 : px), label = alt ?? String(name ?? "Player");
  const ih = Math.round(px * 1.22), iw = Math.round((ih * HEAD_W) / HEAD_H); // rendered box of the photo inside the circle
  const corner = team && logoUrl(T(team), TL_PX.xs) ? `<span class="av-t">${teamLogo(team, { size: "xs" })}</span>` : ""; // no logo: no corner (the text line names the team)
  const a11y = src ? "" : label ? ` role="img" aria-label="${esc(label)}"` : ` aria-hidden="true"`;
  return `<span class="av av-${AV_PX[size] ? size : "md"}${src ? "" : " is-fb"}"${a11y}><span class="av-c"><span class="av-i" aria-hidden="true">${esc(initials(name))}</span>${
    src ? `<img class="av-img" src="${esc(src)}" width="${iw}" height="${ih}" alt="${esc(label)}" ${IMG_ATTRS}>` : ""}</span>${corner}</span>`;
}

// ESPN serves a second set of logos drawn for dark backgrounds; pick the set that matches the current theme.
function logoUrl(team, px = 24, dark = isDark()) {
  const raw = team?.logo || "";
  const m = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/([a-z0-9]+)\/500(?:-dark)?\/([\w-]+\.png)$/i.exec(raw);
  if (m) { const s = px <= 32 ? 64 : 128; return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${m[1]}/${dark ? "500-dark" : "500"}/${m[2]}&w=${s}&h=${s}`; }
  return /^https:\/\//i.test(raw) ? raw : "";
}
function teamLogo(tid, { size = "sm", alt = "" } = {}) {
  const px = TL_PX[size] || TL_PX.sm, src = logoUrl(T(tid), px);
  if (!src) return badge(tid);
  return `<span class="tl tl-${TL_PX[size] ? size : "sm"}"><img class="tl-img" src="${esc(src)}" width="${px}" height="${px}" alt="${esc(alt)}" data-tid="${esc(tid)}" data-px="${px}" ${IMG_ATTRS}></span>`;
}
const teamName = (tid, { size = "sm", text = "name" } = {}) => `<span class="tn">${teamLogo(tid, { size })}<span class="tn-t">${esc(T(tid)[text] ?? T(tid).name)}</span></span>`;
function playerChip(id, name, { size = "xs", href = "" } = {}) {
  const inner = `${avatar(id, name, { size })}<span class="pchip-n">${esc(name)}</span>`;
  return href ? `<a class="pchip" href="${esc(href)}">${inner}</a>` : `<span class="pchip">${inner}</span>`;
}
const faceStack = (players, { size = "xs", max = 4 } = {}) => `<span class="avs">${players.slice(0, max).map((p) => avatar(p.id, p.n, { size })).join("")}</span>`;

// Image failures do not bubble, so one capturing listener covers every face and logo, including ones rendered later.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.classList.contains("av-img")) {
    const av = img.closest(".av");
    if (av) { av.classList.add("is-fb"); if (img.alt) { av.setAttribute("role", "img"); av.setAttribute("aria-label", img.alt); } }
    img.remove();
  } else if (img.classList.contains("tl-img")) {
    const corner = img.closest(".av-t"), box = img.closest(".tl");
    if (corner) corner.remove(); else if (box) box.outerHTML = badge(img.dataset.tid);
  }
}, true);

// Theme: dark unless the visitor chose light. Keeps the browser chrome colour, the toggle label and the logo set in step.
const THEME_COLOR = { dark: "#0d0d0d", light: "#f9f9f7" };
function setTheme(theme, persist = false) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  document.getElementById("theme-color")?.setAttribute("content", THEME_COLOR[t]);
  const btn = document.getElementById("theme"), next = `Switch to ${t === "dark" ? "light" : "dark"} theme`;
  if (btn) { btn.setAttribute("aria-label", next); btn.title = next; }
  document.querySelectorAll("img.tl-img[data-tid]").forEach((img) => { const src = logoUrl(T(img.dataset.tid), Number(img.dataset.px) || 24); if (src && img.getAttribute("src") !== src) img.src = src; });
  if (persist) { try { localStorage.setItem("theme", t); } catch { /* private mode */ } }
}

async function load(p) {
  if (!S.cache.has(p)) {
    S.cache.set(p, fetch(`data/${p}?v=${encodeURIComponent(S.ver)}`).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }));
  }
  return S.cache.get(p);
}

const WHY = { pace: "Game pace", shooting: "Shot-making", overtime: "Overtime", turnovers: "Turnovers", lineup: "Who played", other: "Everything else" };
const WHY_KEYS = Object.keys(WHY);
const PWHY = { minutes: "Minutes", usage: "Shot volume", efficiency: "Shot-making" };
const ROLE = { star: "Stars", starter: "Starters", bench: "Bench" };

// ---------------------------------------------------------------- navigation
const NAV = [
  ["games", "Games", "M4 5h16v14H4zM4 10h16M9 5v14"],
  ["picks", "Picks", "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"],
  ["scout", "Scout", "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.9-4.9M10.5 7.5v6M7.5 10.5h6"],
  ["teams", "Teams", "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"],
  ["more", "More", "M4 7h16M4 12h16M4 17h16"],
];
// Built once, then only aria-current moves, so keyboard focus survives a route change.
function drawNav(active) {
  const nav = document.getElementById("nav");
  if (!nav.childElementCount) {
    nav.innerHTML = NAV.map(([k, label, d]) =>
      `<a href="#/${k}" data-tab="${k}"><span class="nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></span><span class="nav-l">${label}</span></a>`).join("");
  }
  for (const a of nav.children) { if (a.dataset.tab === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
}
const ROUTE_TAB = { games: "games", game: "games", sim: "games", insights: "games", picks: "picks", board: "picks", results: "more", result: "more", why: "more", accuracy: "more", teams: "teams", team: "teams", scout: "scout", players: "scout", player: "scout", more: "more", lab: "more", season: "more", breakout: "more", today: "more", compare: "more" };

async function route() {
  // Each navigation gets a number. A slow page that finishes after the visitor has moved on may
  // already have drawn itself over the newer page, so once it settles the current page is drawn again.
  const seq = S.seq = (S.seq || 0) + 1;
  const [, view = "games", arg, arg2] = location.hash.split("/");
  drawNav(ROUTE_TAB[view] || "games");
  hideTip();
  S.courts.clear();
  // A clear loading state when a page takes more than a moment (first visit to a game or player file).
  // Only while the previous page is still showing: once the view has drawn anything (its first node changes), leave it alone.
  const before = app.firstElementChild;
  const slow = setTimeout(() => { if (seq === S.seq && app.firstElementChild === before) app.innerHTML = `<p class="loading" role="status"><span class="spin" aria-hidden="true"></span>Loading...</p>`; }, 180);
  try {
    const fn = { accuracy: vAccuracy, games: vGames, game: vGame, results: vResults, result: vResult, why: vWhy, teams: vTeams, team: vTeam, scout: vScout, players: vPlayers, player: vPlayer, more: vMore, lab: vMoreMenu, sim: vSim, board: vBoard, picks: vPicks, season: vSeason, insights: vInsights, breakout: vBreakout, today: vToday, compare: vCompare }[view] || vGames;
    await fn(arg, arg2, location.hash.split("/").slice(2));
    if (view === "game" && seq === S.seq) { gameTabs(); const g0 = S.curGame; const t0 = Date.parse(g0?.date || ""); if (g0 && Date.now() > t0 - 10 * 60000 && Date.now() < t0 + 6 * 3600000) startLive(g0); else clearInterval(S.liveTimer); }
    if (view !== "game") clearInterval(S.liveTimer);
    if (view === "sim" && arg && seq === S.seq) { try { const sm = await load(`sim/${arg}.json`); const h = app.querySelector("h1"); const anchor = h?.nextElementSibling?.matches?.("p") ? h.nextElementSibling.nextElementSibling || h.nextElementSibling : h; if (anchor && !app.querySelector(".donut-wrap")) anchor.insertAdjacentHTML("afterend", donutCard(sm) + `<a class="card menu-i" href="#/game/${esc(arg)}" data-open-si="1"><span class="menu-ic" aria-hidden="true" style="background:#5a1d3a">🩹</span><span><b>Mark injured or resting players</b><span class="small muted">Open the game's Simulation tab, tap who is out, and the simulation recalculates.</span></span><span class="menu-c" aria-hidden="true">›</span></a>`); } catch { /* no sim */ } }
    if (view === "scout" && arg && seq === S.seq && !app.querySelector(".trust-card")) { try { const pp = await load(`players/${arg}.json`); app.querySelector(".ehead")?.insertAdjacentHTML("afterend", scoutTop(pp)); } catch { /* no profile */ } }
    if (view === "teams" && seq === S.seq && !app.querySelector(".rk")) { const lead = app.querySelector(".lead") || app.querySelector("h1"); lead?.insertAdjacentHTML("afterend", rankingsCard()); teamsTabs(); }
  } catch (e) {
    if (seq === S.seq) app.innerHTML = `<div class="card"><h2>Could not load this page</h2><p class="muted">This item may not be in the latest data refresh, or the connection dropped. (${esc(e.message)})</p><p><a class="go" href="#/games">Back to games</a> <button class="btn" type="button" onclick="location.reload()">Try again</button></p></div>`;
  }
  clearTimeout(slow);
  if (seq !== S.seq) { if (S.doneSeq === S.seq) { S.doneSeq = 0; route(); } return; }
  S.doneSeq = seq;
  if (S.lastHash !== location.hash) {
    window.scrollTo(0, 0);
    if (S.lastHash !== undefined) app.focus({ preventScroll: true }); // hand keyboard and screen-reader focus to the new page (not on first load)
    S.afterRoute?.(); // a view can ask to start at one of its sections (Scout opened on the matchup lab)
  }
  S.afterRoute = null;
  S.lastHash = location.hash;
}

// ---------------------------------------------------------------- tooltip + charts
function showTip(html, x, y) {
  tipEl.innerHTML = html; tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  tipEl.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 12)) + "px";
  tipEl.style.top = Math.max(8, y - r.height - 12) + "px";
}
function hideTip() { tipEl.hidden = true; }

function chartFrame(el, H) {
  const W = Math.max(280, Math.round(el.clientWidth));
  return { W, H, l: 34, r: 12, t: 10, b: 22 };
}
function attachHover(el, n, xOf, onIdx) {
  const svg = el.querySelector("svg");
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(xOf(i) - x); if (d < bd) { bd = d; best = i; } }
    onIdx(best, ev.clientX, ev.clientY);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { hideTip(); const c = svg.querySelector(".cross"); if (c) c.setAttribute("opacity", 0); });
}

// Line chart: one series, so no legend - the heading names it.
function lineChart(el, pts, { min, max, unit = "%", fmt = (v) => v + unit }) {
  const f = chartFrame(el, 190), iw = f.W - f.l - f.r, ih = f.H - f.t - f.b;
  const x = (i) => f.l + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * iw);
  const y = (v) => f.t + ih - ((v - min) / (max - min)) * ih;
  const ticks = []; for (let v = min; v <= max + 1e-9; v += (max - min) / 3) ticks.push(Math.round(v));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  let lastX = -99;
  const xl = pts.map((p, i) => [p, i]).filter(([p, i]) => { if (!p.tick || x(i) - lastX < 34 || x(i) > f.W - f.r - 14) return false; lastX = x(i); return true; });
  const last = pts.at(-1);
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(el.dataset.label || "Line chart")}">
    ${ticks.map((t) => `<line class="grid" x1="${f.l}" x2="${f.W - f.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${f.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}${unit}</text>`).join("")}
    ${xl.map(([p, i]) => `<text x="${x(i)}" y="${f.H - 6}" text-anchor="middle">${esc(p.tick)}</text>`).join("")}
    <line class="cross" x1="0" x2="0" y1="${f.t}" y2="${f.t + ih}" opacity="0"/>
    <path d="${path}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle class="dot" cx="${x(pts.length - 1)}" cy="${y(last.y)}" r="4.5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${x(pts.length - 1) - 8}" y="${y(last.y) - 10}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmt(last.y)}</text>
  </svg>`;
  const cross = el.querySelector(".cross"), dot = el.querySelector(".dot");
  attachHover(el, pts.length, x, (i, cx, cy) => {
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", 1);
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(pts[i].y));
    showTip(pts[i].tip, cx, cy);
  });
}

// Stacked columns: fixed colour order, legend + table view alongside.
function stackChart(el, rows, keys, labels) {
  const f = chartFrame(el, 210), iw = f.W - f.l - f.r, ih = f.H - f.t - f.b;
  const tot = rows.map((r) => keys.reduce((s, k) => s + (r.parts[k] || 0), 0));
  const max = Math.ceil(Math.max(...tot, 1) / 10) * 10;
  const slot = iw / rows.length, bw = Math.min(24, Math.max(3, slot - 2));
  const x = (i) => f.l + slot * i + slot / 2;
  const y = (v) => f.t + ih - (v / max) * ih;
  let bars = "";
  rows.forEach((r, i) => {
    let acc = 0;
    keys.forEach((k, j) => {
      const v = r.parts[k] || 0; if (v <= 0) return;
      const y1 = y(acc + v), hgt = Math.max(1, y(acc) - y1 - 2);
      bars += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="var(--s${j + 1})" rx="${j === keys.length - 1 ? 2 : 0}"/>`;
      acc += v;
    });
  });
  const ticks = [0, max / 2, max];
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(el.dataset.label || "Stacked column chart")}">
    ${ticks.map((t) => `<line class="${t ? "grid" : "axis"}" x1="${f.l}" x2="${f.W - f.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${f.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
    ${(() => { let lastX = -99; return rows.map((r, i) => { if (!r.tick || x(i) - lastX < 34) return ""; lastX = x(i); return `<text x="${x(i)}" y="${f.H - 6}" text-anchor="middle">${esc(r.tick)}</text>`; }).join(""); })()}
    <line class="cross" x1="0" x2="0" y1="${f.t}" y2="${f.t + ih}" opacity="0"/>${bars}</svg>`;
  const cross = el.querySelector(".cross");
  attachHover(el, rows.length, x, (i, cx, cy) => {
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", 1);
    showTip(`<b>${esc(rows[i].label)}</b><br>${keys.map((k, j) => `<i style="background:var(--s${j + 1})"></i>${esc(labels[k])}: ${f1(rows[i].parts[k])}`).join("<br>")}`, cx, cy);
  });
}

const divBars = (obj, labels, scale = 12) => `<div class="bars">${Object.keys(labels).map((k) => {
  const v = obj?.[k] ?? 0, w = Math.min(50, (Math.abs(v) / scale) * 50);
  return `<div class="bar"><span>${labels[k]}</span><span class="track"><span class="fill ${v >= 0 ? "pos" : "neg"}" style="width:${w}%"></span></span><span class="val">${sg(v)}</span></div>`;
}).join("")}</div>`;

const monthTicks = (rows, key) => { let prev = ""; return rows.map((r) => { const m = fmtD(r[key], { month: "short" }); const t = m !== prev ? m : ""; prev = m; return t; }); };

// ---------------------------------------------------------------- scouting building blocks
// Shared by the Scout pages, team pages and upcoming-game pages. Every helper returns escaped HTML.
//   courtFigure(id, cells, label)     half-court SVG with one tappable shape per fine zone, plus the detail panel under it
//   zoneCells(rows, mode, whose)      court cells from zone rows (mode "off" = own shooting, "def" = shooting allowed)
//   matchCells(his, theirs)           court cells for a player's zones laid over an opponent's defensive zones
//   courtLegend(mode)                 the colour key (colour is never the only signal: HOT / COLD / SOFT / STRONG are written out)
//   zoneTable(rows, mode)             the same numbers as a table
//   ztag(tag)                         written-out tag badge
//   meterRow({ ... })                 one labelled row with a thin bar, a value and a line of evidence
const ord = (n) => { const v = Math.abs(n) % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][v % 10] || "th"); };
const dayY = (iso) => fmtD(iso, { month: "short", day: "numeric", year: "numeric" });
const p1 = (x) => (x == null || Number.isNaN(Number(x)) ? "-" : (Math.round(x * 10) / 10).toFixed(1) + "%");
const num = (x) => (x == null || Number.isNaN(Number(x)) ? "-" : Number(x).toLocaleString());
const sampleWord = (n) => (n >= 10 ? "solid" : n >= 5 ? "moderate" : "small");
const ZONE_FALLBACK = { rim: "At the rim", paint: "Paint (non-restricted)", mid: "Mid-range", c3: "Corner three", atb: "Above-the-break three", midL: "Mid-range, left", midC: "Mid-range, centre", midR: "Mid-range, right", c3L: "Left corner three", c3R: "Right corner three", atbL: "Above the break, left wing", atbC: "Above the break, top", atbR: "Above the break, right wing" };
const ZONE_SHORT = { rim: "Rim", paint: "Paint", mid: "Mid-range", c3: "Corner three", atb: "Above the break" };
const ZONE_WORD = { rim: "rim", paint: "paint", mid: "mid-range", c3: "corner three", atb: "above the break" };
const FIVE = ["rim", "paint", "mid", "c3", "atb"];
function zoneLabel(id) {
  const sc = S.meta?.scout || {};
  return (sc.fineZones || []).find((z) => z.id === id)?.label || (sc.zones || []).find((z) => z.id === id)?.label || ZONE_FALLBACK[id] || String(id ?? "");
}
// Orange end = the ball goes in more than normal there (a shooter's HOT spot, a defence's SOFT spot, a defender's WEAK spot).
// Blue end = it goes in less (COLD, STRONG). The word is always printed, so the colour is only a second cue.
const TAG_TXT = { hot: "HOT", cold: "COLD", soft: "SOFT", strong: "STRONG", weak: "WEAK", low: "FEW SHOTS" };
const ztag = (tag) => (TAG_TXT[tag] ? `<span class="ztag ${esc(tag)}">${TAG_TXT[tag]}</span>` : "");

// Colour step of a zone: 2 / -2 only when the data's own tag rule passed, 1 / -1 for a gap of 3+ points of FG% that did not pass it,
// 0 near league, null when there are too few shots to say anything.
function zoneBin(r, mode) {
  if (!r || r.low || !r.att) return null;
  const up = mode === "def" ? "soft" : "hot", down = mode === "def" ? "strong" : "cold";
  if (r.tag === up) return 2;
  if (r.tag === down) return -2;
  return r.diff >= 3 ? 1 : r.diff <= -3 ? -1 : 0;
}
const BIN_CLASS = { 2: "zb-h2", 1: "zb-h1", 0: "zb-n", [-1]: "zb-c1", [-2]: "zb-c2" };

function zoneCells(rows, mode = "off", whose = "his") {
  const def = mode === "def";
  return (rows || []).map((r) => {
    const name = r.label || zoneLabel(r.id), few = !!r.low || !r.att, tagged = !few && r.tag && r.tag !== "neutral" && TAG_TXT[r.tag];
    const info = `<div class="zi-h"><b>${esc(name)}</b>${few ? ztag("low") : ztag(r.tag)}</div>
      <dl class="kv">
        <dt>${def ? "Opponents made / attempted" : "Made / attempted"}</dt><dd>${esc(num(r.made))} / ${esc(num(r.att))} (${p1(r.pct)})</dd>
        <dt>League FG% from here</dt><dd>${p1(r.lgPct)} (${def ? "allows" : "he is"} ${sg(r.diff)})</dd>
        <dt>${def ? "Share of opponents' shots" : `Share of ${esc(whose)} shots`}</dt><dd>${p1(r.share)}${r.lgShare != null ? ` (league ${p1(r.lgShare)})` : ""}</dd>
        ${r.rank ? `<dt>${def ? "FG% allowed, rank" : "FG%, rank"}</dt><dd>${esc(ord(r.rank))} of 30</dd>` : ""}
        ${r.pps != null ? `<dt>Points per shot</dt><dd>${Number(r.pps).toFixed(2)}${r.lgPps != null ? ` (league ${Number(r.lgPps).toFixed(2)})` : ""}</dd>` : ""}
        ${!def && r.astPct != null ? `<dt>Makes that were assisted</dt><dd>${f0(r.astPct)}%</dd>` : ""}
        ${r.cur ? `<dt>This season only</dt><dd>${esc(r.cur[1])} of ${esc(r.cur[0])}</dd>` : ""}
      </dl>${few ? `<p class="small muted">Too few attempts here for a ${def ? "soft or strong" : "hot or cold"} call.</p>` : ""}`;
    return {
      id: r.id, name, bin: zoneBin(r, mode), low: few, l1: r.att ? p1(r.pct) : "-", l2: `${num(r.att)} att`,
      // Lighter tints (a 3+ point gap that did not pass the tag rule) carry their number, so colour is never the only cue.
      tag: few ? "few shots" : tagged || (Math.abs(r.diff) >= 3 ? `${sg(r.diff)} vs lg` : ""),
      aria: `${name}: ${r.att ? `${p1(r.pct)} on ${num(r.att)} attempts, league ${p1(r.lgPct)}` : "no attempts"}${few ? ", too few shots to judge" : tagged ? `, tagged ${tagged}` : ""}. Show details.`,
      tip: `<b>${esc(name)}</b>${tagged ? ` · ${tagged}` : ""}<br>${p1(r.pct)} on ${esc(num(r.att))} attempts<br>League ${p1(r.lgPct)} (${sg(r.diff)})`, info,
    };
  });
}

// What it means when a shooter's zone tag meets a defence's zone tag. k: 2 clear edge for him ... -2 clear edge for the defence.
function meetText(h, o) {
  if (!h || h.low || !h.att) return { tags: "few shots", t: "Too few of his shots from here to judge", k: null };
  const ht = h.tag, ot = o?.tag;
  if (ht === "hot" && ot === "soft") return { tags: "HOT v SOFT", t: "His hot spot meets their soft spot", k: 2 };
  if (ht === "cold" && ot === "strong") return { tags: "COLD v STRONG", t: "His cold spot meets a zone they defend well", k: -2 };
  if (ht === "hot" && ot === "strong") return { tags: "HOT v STRONG", t: "His hot spot meets a zone they defend well: strength against strength", k: 0 };
  if (ht === "cold" && ot === "soft") return { tags: "COLD v SOFT", t: "Their soft spot, but it is one of his cold spots", k: 0 };
  if (ht === "hot") return { tags: "his HOT", t: "His hot spot; they defend it about as well as the league", k: 1 };
  if (ht === "cold") return { tags: "his COLD", t: "His cold spot; they defend it about as well as the league", k: -1 };
  if (ot === "soft") return { tags: "their SOFT", t: "Their soft spot; he shoots about league average from here", k: 1 };
  if (ot === "strong") return { tags: "their STRONG", t: "A zone they defend well; he shoots about league average from here", k: -1 };
  return { tags: "", t: "No clear edge either way", k: 0 };
}
function matchCells(his, theirs, oppAbbr) {
  const by = Object.fromEntries((theirs || []).map((r) => [r.id, r]));
  return (his || []).map((h) => {
    const o = by[h.id], name = h.label || zoneLabel(h.id), m = meetText(h, o);
    const sum = (zoneBin(h, "off") ?? 0) + (zoneBin(o, "def") ?? 0);
    const bin = m.k == null ? null : sum >= 3 ? 2 : sum >= 1 ? 1 : sum <= -3 ? -2 : sum <= -1 ? -1 : 0;
    const info = `<div class="zi-h"><b>${esc(name)}</b>${m.k == null ? ztag("low") : `${ztag(h.tag)}${o ? ztag(o.tag) : ""}`}</div>
      <p class="small" style="margin:0 0 6px">${esc(m.t)}.</p>
      <dl class="kv">
        <dt>He shoots</dt><dd>${p1(h.pct)} (${esc(num(h.made))} of ${esc(num(h.att))})</dd>
        ${o ? `<dt>${esc(oppAbbr)} allows</dt><dd>${p1(o.pct)} (${esc(num(o.made))} of ${esc(num(o.att))})</dd>` : ""}
        <dt>League</dt><dd>${p1(h.lgPct)}</dd>
        <dt>Share of his shots</dt><dd>${p1(h.share)}</dd>
      </dl>`;
    return {
      id: h.id, name, bin, low: m.k == null, l1: h.att ? p1(h.pct) : "-", l2: o ? `they ${p1(o.pct)}` : "", tag: m.tags,
      aria: `${name}: he shoots ${h.att ? p1(h.pct) : "no shots"} on ${num(h.att)} attempts${o ? `, ${oppAbbr} allows ${p1(o.pct)}` : ""}. ${m.t}. Show details.`,
      tip: `<b>${esc(name)}</b>${m.tags && m.k != null ? ` · ${esc(m.tags)}` : ""}<br>He: ${p1(h.pct)} on ${esc(num(h.att))}${o ? `<br>${esc(oppAbbr)} allows: ${p1(o.pct)}` : ""}<br>League ${p1(h.lgPct)}`, info,
    };
  });
}

// Half-court drawn to scale, in feet x 10: 50 ft wide, hoop 5.25 ft from the baseline, restricted-area radius 4 ft, lane 16 x 19 ft,
// three-point line 22 ft in the corners (straight until it meets the arc about 14 ft out) and 23.75 ft above the break.
// The baseline is at the top and the viewer faces the basket, so "left" zones are on the left (the same way NBA.com draws its shot charts).
// The drawing stops 40 ft from the baseline (half court is 47 ft). The centre slices use the same angles as the zone rules
// (35 degrees for mid-range, 25 degrees above the break). The strip above the baseline holds the labels of the three zones
// that are too small to write in: both corners and the rim.
const COURT = (() => {
  const K = 10, W = 50, H = 40, hx = 25, hy = 5.25, r3 = 23.75, c3 = 22, lane = 8, laneH = 19, ra = 4;
  const rad = Math.PI / 180, yb = hy + Math.sqrt(r3 * r3 - c3 * c3);
  const P = (x, y) => `${(x * K).toFixed(1)} ${(y * K).toFixed(1)}`;
  const arc = (x, y, sweep) => `A${r3 * K} ${r3 * K} 0 0 ${sweep} ${P(x, y)}`;
  const a35 = [hx + r3 * Math.sin(35 * rad), hy + r3 * Math.cos(35 * rad)], a25 = [hx + r3 * Math.sin(25 * rad), hy + r3 * Math.cos(25 * rad)];
  const y35 = hy + lane / Math.tan(35 * rad), x25 = (H - hy) * Math.tan(25 * rad), m = (x) => W - x;
  const path = (d, extra = "") => `<path class="zs" d="${d}"${extra}/>`;
  const zones = [
    { id: "atbL", at: [7.4, 32], shape: path(`M${P(0, yb)} L${P(3, yb)} ${arc(m(a25[0]), a25[1], 0)} L${P(hx - x25, H)} L${P(0, H)}Z`) },
    { id: "atbC", at: [25, 34.4], shape: path(`M${P(m(a25[0]), a25[1])} ${arc(a25[0], a25[1], 0)} L${P(hx + x25, H)} L${P(hx - x25, H)}Z`) },
    { id: "atbR", at: [42.6, 32], shape: path(`M${P(a25[0], a25[1])} ${arc(47, yb, 0)} L${P(50, yb)} L${P(50, H)} L${P(hx + x25, H)}Z`) },
    { id: "midL", at: [10, 9.6], shape: path(`M${P(3, 0)} L${P(hx - lane, 0)} L${P(hx - lane, y35)} L${P(m(a35[0]), a35[1])} ${arc(3, yb, 1)}Z`) },
    { id: "midC", at: [25, 25.5], shape: path(`M${P(hx - lane, y35)} L${P(hx - lane, laneH)} L${P(hx + lane, laneH)} L${P(hx + lane, y35)} L${P(a35[0], a35[1])} ${arc(m(a35[0]), a35[1], 1)}Z`) },
    { id: "midR", at: [40, 9.6], shape: path(`M${P(47, 0)} L${P(hx + lane, 0)} L${P(hx + lane, y35)} L${P(a35[0], a35[1])} ${arc(47, yb, 0)}Z`) },
    { id: "paint", at: [25, 12.6], shape: path(`M${P(hx - lane, 0)} L${P(hx + lane, 0)} L${P(hx + lane, laneH)} L${P(hx - lane, laneH)}Z M${P(hx - ra, hy)} a${ra * K} ${ra * K} 0 1 0 ${2 * ra * K} 0 a${ra * K} ${ra * K} 0 1 0 ${-2 * ra * K} 0Z`, ` fill-rule="evenodd"`) },
    { id: "rim", call: "c", shape: `<circle class="zs" cx="${hx * K}" cy="${hy * K}" r="${ra * K}"/>` },
    { id: "c3L", call: "l", shape: `<rect class="zs" x="0" y="0" width="${3 * K}" height="${(yb * K).toFixed(1)}"/>` },
    { id: "c3R", call: "r", shape: `<rect class="zs" x="${47 * K}" y="0" width="${3 * K}" height="${(yb * K).toFixed(1)}"/>` },
  ];
  const ybK = (yb * K).toFixed(1);
  const lines = `<g class="court-lines" aria-hidden="true">
    <path d="M0 ${H * K} V0 H${W * K} V${H * K}"/>
    <path d="M30 0 V${ybK} A${r3 * K} ${r3 * K} 0 0 0 470 ${ybK} V0"/>
    <rect x="${(hx - lane) * K}" y="0" width="${2 * lane * K}" height="${laneH * K}"/>
    <path d="M190 ${laneH * K} A60 60 0 0 0 310 ${laneH * K}"/><path class="dash" d="M190 ${laneH * K} A60 60 0 0 1 310 ${laneH * K}"/>
    <path d="M220 40 H280"/><circle cx="${hx * K}" cy="${hy * K}" r="7.5"/>
    <path d="M210 40 V${hy * K} A40 40 0 0 0 290 ${hy * K} V40"/>
    <path class="dash" d="M${P(hx - lane, y35)} L${P(m(a35[0]), a35[1])} M${P(hx + lane, y35)} L${P(a35[0], a35[1])} M${P(m(a25[0]), a25[1])} L${P(hx - x25, H)} M${P(a25[0], a25[1])} L${P(hx + x25, H)}"/>
  </g>`;
  return { K, W: W * K, H: H * K, top: 68, zones, lines };
})();
const CALLOUT = { l: { x: 2, anchor: "start", lead: 15, hit: [0, 166] }, c: { x: 250, anchor: "middle", lead: 250, hit: [170, 160] }, r: { x: 498, anchor: "end", lead: 485, hit: [334, 166] } };

function courtFigure(id, cells, label, hint = "Tap or hover a zone for the full numbers.") {
  const by = Object.fromEntries(cells.map((c) => [c.id, c]));
  S.courts.set(id, by);
  const K = COURT.K;
  // Three layers: the tappable zone shapes, the painted court lines, then the labels on top (so no line cuts through a number).
  const bin = (c) => (c.bin == null ? "zb-low" : BIN_CLASS[c.bin]);
  const zone = (z) => {
    const c = by[z.id]; if (!c) return "";
    const o = z.call && CALLOUT[z.call];
    const extra = o ? `<rect class="zhit" x="${o.hit[0]}" y="${-COURT.top}" width="${o.hit[1]}" height="${COURT.top - 2}"/>
      <line class="z-lead" x1="${o.lead}" x2="${o.lead}" y1="-7" y2="${z.call === "c" ? 26 : 22}"/><circle class="z-dot" cx="${o.lead}" cy="${z.call === "c" ? 28 : 24}" r="2.6"/>` : "";
    return `<g class="zone ${bin(c)}" data-z="${esc(z.id)}" tabindex="0" role="button" aria-pressed="false" aria-label="${esc(c.aria)}">${z.shape}${extra}</g>`;
  };
  const text = (z) => {
    const c = by[z.id]; if (!c) return "";
    if (z.call) {
      const o = CALLOUT[z.call];
      return `<g class="zl is-call"><text class="z-n" x="${o.x}" y="-51" style="text-anchor:${o.anchor}">${esc(c.name.replace(/ \(.*\)$/, ""))}</text>
        <text class="z-a" x="${o.x}" y="-32" style="text-anchor:${o.anchor}"><tspan class="z-p">${esc(c.l1)}</tspan>${c.l2 ? ` · ${esc(c.l2)}` : ""}</text>
        ${c.tag ? `<text class="z-t" x="${o.x}" y="-14" style="text-anchor:${o.anchor}">${esc(c.tag)}</text>` : ""}</g>`;
    }
    const [x, y] = [z.at[0] * K, z.at[1] * K];
    return `<g class="zl ${bin(c)}"><text class="z-p" x="${x}" y="${y - 8}">${esc(c.l1)}</text>${c.l2 ? `<text class="z-a" x="${x}" y="${y + 13}">${esc(c.l2)}</text>` : ""}${c.tag ? `<text class="z-t" x="${x}" y="${y + 32}">${esc(c.tag)}</text>` : ""}</g>`;
  };
  return `<figure class="court" data-court="${esc(id)}">
    <svg viewBox="0 ${-COURT.top} ${COURT.W} ${COURT.H + COURT.top}" role="group" aria-label="${esc(label)}">${COURT.zones.map(zone).join("")}${COURT.lines}<g aria-hidden="true">${COURT.zones.map(text).join("")}</g></svg>
    <figcaption class="court-info" aria-live="polite"><span class="muted">${esc(hint)}</span></figcaption>
  </figure>`;
}
// ---------------------------------------------------------------- 2K-style 14-zone hot zone map
// Red = hot (or, for a defence, a soft spot opponents shoot well in), blue = cold (or a strong spot). Arrows: the last 10 games
// against his/their two-season level (heating up / cooling down; for a defence leaking / tightening).
const Z14_NAMES = { rim: "At the rim", shL: "Short range, left", shC: "Short range, middle", shR: "Short range, right", mBL: "Mid-range, left baseline", mWL: "Mid-range, left wing", mT: "Mid-range, top", mWR: "Mid-range, right wing", mBR: "Mid-range, right baseline", tCL: "Three, left corner", tWL: "Three, left wing", tT: "Three, top", tWR: "Three, right wing", tCR: "Three, right corner" };
const HZ = (() => {
  const K = 10, hx = 25, hy = 5.25, r3 = 23.75, yb = hy + Math.sqrt(r3 * r3 - 22 * 22), H = 33, rad = Math.PI / 180;
  const P = (x, y) => `${(x * K).toFixed(1)} ${(y * K).toFixed(1)}`;
  const pt = (r, a) => [hx - r * Math.sin(a * rad), hy + r * Math.cos(a * rad)]; // a > 0 = left as you face the basket
  const sector = (r1, r2, a1, a2) => { const [p1, p2, p3, p4] = [pt(r1, a1), pt(r2, a1), pt(r2, a2), pt(r1, a2)]; return `M${P(...p1)} L${P(...p2)} A${r2 * K} ${r2 * K} 0 0 ${a2 > a1 ? 1 : 0} ${P(...p3)} L${P(...p4)} A${r1 * K} ${r1 * K} 0 0 ${a2 > a1 ? 0 : 1} ${P(...p1)}Z`; };
  const t = Math.tan(22.5 * rad), xr = (y) => (y - hy) * t; // x offset of the 22.5 degree rays at height y
  const poly = (pts) => `M${pts.map((p) => P(...p)).join(" L")}Z`;
  const wingL = poly([[hx - xr(yb), yb], [-1, yb], [-1, H + 1], [hx - xr(H + 1), H + 1]]);
  const wingR = poly([[hx + xr(yb), yb], [51, yb], [51, H + 1], [hx + xr(H + 1), H + 1]]);
  const top = poly([[hx, hy], [hx - xr(H + 1), H + 1], [hx + xr(H + 1), H + 1]]);
  const baseL = poly([[-1, -1], [hx, -1], [hx, yb], [-1, yb]]), baseR = poly([[hx, -1], [51, -1], [51, yb], [hx, yb]]);
  const three = `M${P(3, -1)} V${(yb * K).toFixed(1)} A${r3 * K} ${r3 * K} 0 0 0 ${P(47, yb)} V${-K}Z`;
  const zones = [
    { id: "tCL", d: poly([[0, 0], [3, 0], [3, yb], [0, yb]]), m: "out", at: [1.5, 7] }, { id: "tCR", d: poly([[47, 0], [50, 0], [50, yb], [47, yb]]), m: "out", at: [48.5, 7] },
    { id: "tWL", d: wingL, m: "out", at: [5.5, 27] }, { id: "tT", d: top, m: "out", at: [25, 31] }, { id: "tWR", d: wingR, m: "out", at: [44.5, 27] },
    { id: "mBL", d: baseL, m: "mid", at: [7.5, 8] }, { id: "mBR", d: baseR, m: "mid", at: [42.5, 8] },
    { id: "mWL", d: wingL, m: "mid", at: [12.5, 20.5] }, { id: "mT", d: top, m: "mid", at: [25, 24.5] }, { id: "mWR", d: wingR, m: "mid", at: [37.5, 20.5] },
    { id: "shL", d: sector(4, 14, 30, 118), m: "in", at: [15.8, 8.5] }, { id: "shC", d: sector(4, 14, -30, 30), m: "in", at: [25, 14] }, { id: "shR", d: sector(4, 14, -118, -30), m: "in", at: [34.2, 8.5] },
    { id: "rim", d: `M${P(hx - 4, hy)} a40 40 0 1 0 80 0 a40 40 0 1 0 -80 0Z`, m: null, at: [25, 5.6] },
  ];
  return { K, W: 50 * K, H: H * K, hx, hy, yb, r3, three, zones };
})();
function hz14Figure(rows, mode = "off", label = "") {
  if (!rows?.length) return "";
  const by = Object.fromEntries(rows.map((x) => [x.id, x]));
  const uid = "hz" + Math.random().toString(36).slice(2, 8), K = HZ.K;
  const cls = (x) => { if (!x || x.low) return "hz-low"; const d = x.diff ?? 0; if (x.tag === "hot" || x.tag === "soft") return "hz-h2"; if (x.tag === "cold" || x.tag === "strong") return "hz-c2"; return d >= 3 ? "hz-h1" : d <= -3 ? "hz-c1" : "hz-n"; };
  const arrow = (x) => (x?.trend === "heating" || x?.trend === "leaking" ? "▲" : x?.trend === "cooling" || x?.trend === "tightening" ? "▼" : "");
  const tip = (x) => `${Z14_NAMES[x.id]}: ${x.att ? x.pct + "%" : "no shots"} on ${x.att} (league ${x.lgPct}%)${x.rec ? `, last 10 games ${x.rec[1]}/${x.rec[0]}` : ""}${x.trend ? ` (${x.trend})` : ""}`;
  const shapes = HZ.zones.map((z) => { const x = by[z.id]; if (!x) return ""; return `<path class="hz-z ${cls(x)}" d="${z.d}"${z.m ? ` mask="url(#${uid}-${z.m})"` : ""}><title>${esc(tip(x))}</title></path>`; }).join("");
  const labels = HZ.zones.map((z) => { const x = by[z.id]; if (!x || !x.att) return ""; const [lx, ly] = z.at; const small = ["tCL", "tCR"].includes(z.id); const a = arrow(x);
    return `<text class="hz-t${small ? " sm" : ""}" x="${lx * K}" y="${ly * K}">${esc(Math.round(x.pct))}${small ? "" : "%"}${a ? `<tspan class="hz-ar ${a === "▲" ? "up" : "dn"}" dx="2">${a}</tspan>` : ""}</text>`; }).join("");
  return `<figure class="hz"><svg viewBox="0 0 ${HZ.W} ${HZ.H}" role="img" aria-label="${esc(label + ". " + rows.filter((x) => x.att).map(tip).join("; "))}">
    <defs>
      <mask id="${uid}-out"><rect width="${HZ.W}" height="${HZ.H}" fill="#fff"/><path d="${HZ.three}" fill="#000"/></mask>
      <mask id="${uid}-mid"><path d="${HZ.three}" fill="#fff"/><circle cx="${HZ.hx * K}" cy="${HZ.hy * K}" r="${14 * K}" fill="#000"/></mask>
    </defs>
    <rect class="hz-bg" width="${HZ.W}" height="${HZ.H}"/>${shapes}
    <g class="hz-lines"><path d="${HZ.three}" fill="none"/><circle cx="${HZ.hx * K}" cy="${HZ.hy * K}" r="${14 * K}" fill="none"/><circle cx="${HZ.hx * K}" cy="${HZ.hy * K}" r="${4 * K}" fill="none"/><rect x="0" y="0" width="${HZ.W}" height="${HZ.H}" fill="none"/></g>
    ${labels}</svg></figure>`;
}
function hz14Card(z, mode, who, title) {
  if (!z) return "";
  const rows = mode === "def" ? z.def : mode === "toff" ? z.off : z.rows; if (!rows?.length) return "";
  const def = mode === "def", hotW = def ? "Soft spots" : "Hot zones", coldW = def ? "Strong spots" : "Cold zones";
  const hot = rows.filter((x) => (def ? x.tag === "soft" : x.tag === "hot")), cold = rows.filter((x) => (def ? x.tag === "strong" : x.tag === "cold"));
  const up = rows.filter((x) => x.trend === (def ? "leaking" : "heating")), dn = rows.filter((x) => x.trend === (def ? "tightening" : "cooling"));
  const nm = (x) => `${esc(Z14_NAMES[x.id])} (${esc(x.pct)}% on ${esc(num(x.att))}, league ${esc(x.lgPct)}%)`;
  const nmR = (x) => `${esc(Z14_NAMES[x.id])} (${esc(x.rec[1])}/${esc(x.rec[0])} in the last ${esc(z.recentGames)} games vs ${esc(x.pct)}% usual)`;
  return `<div class="hz-card"><h3>${esc(title || "2K-style hot zones (14 zones)")}</h3>
    ${hz14Figure(rows, def ? "def" : "off", title || who)}
    <div class="legend zlegend"><span><i class="hz-c2"></i>${def ? "STRONG: opponents clearly below league" : "COLD: clearly below league"}</span><span><i class="hz-c1"></i>Below</span><span><i class="hz-n"></i>Near league</span><span><i class="hz-h1"></i>Above</span><span><i class="hz-h2"></i>${def ? "SOFT: opponents clearly above league" : "HOT: clearly above league"}</span><span><i class="hz-low"></i>Too few shots</span></div>
    <ul class="dots small">
      ${hot.length ? `<li><b>${hotW}:</b> ${hot.map(nm).join(", ")}</li>` : ""}${cold.length ? `<li><b>${coldW}:</b> ${cold.map(nm).join(", ")}</li>` : ""}
      ${up.length ? `<li><b>▲ ${def ? "Leaking lately" : "Heating up"}:</b> ${up.map(nmR).join(", ")}</li>` : ""}${dn.length ? `<li><b>▼ ${def ? "Tightening lately" : "Cooling down"}:</b> ${dn.map(nmR).join(", ")}</li>` : ""}
      ${!hot.length && !cold.length && !up.length && !dn.length ? "<li>No zone clears the hot, cold or trend rule yet.</li>" : ""}
    </ul>
    <p class="small muted">Numbers are FG% by zone, ${esc(z.window)} (${esc(z.games)} games), as you face the basket. Hot/cold needs ${esc(z.rule?.minAtt)}+ attempts, 3+ points vs league and 1.5 standard errors. ▲/▼ = the last ${esc(z.recentGames)} games differ from the usual level by ${esc(z.rule?.trend?.minDiff)}+ points (${esc(z.rule?.trend?.minAtt)}+ attempts, 1.2 standard errors): recent form, which usually drifts back.</p></div>`;
}
const LEGEND = {
  off: ["COLD: clearly below league", "Below league", "Near league", "Above league", "HOT: clearly above league"],
  def: ["STRONG: opponents clearly below league", "Below league", "Near league", "Above league", "SOFT: opponents clearly above league"],
  match: ["Clear edge for the defence", "Leans to the defence", "Even", "Leans to him", "Clear edge for him"],
};
const courtLegend = (mode = "off") => `<div class="legend zlegend">${["zb-c2", "zb-c1", "zb-n", "zb-h1", "zb-h2"].map((c, i) => `<span><i class="${c}"></i>${LEGEND[mode][i]}</span>`).join("")}<span><i class="zb-low"></i>Too few shots to judge</span></div>`;

function zoneTable(rows, mode = "off", { rank = false } = {}) {
  const def = mode === "def";
  return `<div class="tw"><table class="ztable"><thead><tr><th>Zone</th><th class="n">${def ? "Allowed" : "Made"}</th><th class="n">FG%<i>league</i></th><th class="n">Gap</th><th class="n">Share</th>${rank ? `<th class="n">Rank</th>` : ""}</tr></thead>
    <tbody>${(rows || []).map((r) => `<tr><td>${esc(r.label || zoneLabel(r.id))}${r.low || !r.att ? `<br>${ztag("low")}` : ztag(r.tag) ? `<br>${ztag(r.tag)}` : ""}</td><td class="n">${esc(num(r.made))}/${esc(num(r.att))}</td><td class="n"><b>${p1(r.pct)}</b><i>${p1(r.lgPct)}</i></td><td class="n">${sg(r.diff)}</td><td class="n">${p1(r.share)}</td>${rank ? `<td class="n">${r.rank ? esc(ord(r.rank)) : "-"}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

// One labelled row with a thin bar. kind "div": value is a signed gap drawn from the centre (orange right, blue left), scale = full half-width.
// kind "lvl": value is 0-100 drawn from the left with a tick at 50.
function meterRow({ label, badge = "", value = "", sub = "", x = null, kind = "div", scale = 10 }) {
  let bar = "";
  if (x != null && !Number.isNaN(Number(x))) {
    if (kind === "div") { const w = Math.min(50, (Math.abs(x) / scale) * 50); bar = `<div class="mtrack div" aria-hidden="true"><span class="mfill ${x >= 0 ? "up" : "dn"}" style="width:${w.toFixed(1)}%"></span></div>`; }
    else bar = `<div class="mtrack lvl" aria-hidden="true"><span class="mfill" style="width:${Math.max(0, Math.min(100, x)).toFixed(1)}%"></span></div>`;
  }
  return `<li class="mrow"><div class="mrow-h"><span class="mrow-l">${label}${badge ? ` ${badge}` : ""}</span><span class="num mrow-v">${value}</span></div>${bar}${sub ? `<div class="small muted">${sub}</div>` : ""}</li>`;
}

// Delegated handlers for every court on the page (courts are re-rendered by the matchup lab, so nothing is bound per element).
function selectZone(el) {
  const fig = el.closest(".court"), cell = S.courts.get(fig?.dataset.court)?.[el.dataset.z];
  if (!cell) return;
  fig.querySelectorAll('.zone[aria-pressed="true"]').forEach((z) => z.setAttribute("aria-pressed", "false"));
  el.setAttribute("aria-pressed", "true");
  fig.querySelector(".court-info").innerHTML = cell.info;
}
function wireScouting() {
  app.addEventListener("click", (e) => {
    const z = e.target.closest?.(".zone"); if (z) { selectZone(z); return; }
    const j = e.target.closest?.("[data-jump]");
    if (j) { const el = document.getElementById(j.dataset.jump); if (el) { el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); el.focus({ preventScroll: true }); } }
  });
  app.addEventListener("keydown", (e) => { const z = e.target.closest?.(".zone"); if (z && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectZone(z); } });
  app.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const z = e.target.closest?.(".zone"), cell = z && S.courts.get(z.closest(".court")?.dataset.court)?.[z.dataset.z];
    if (cell) showTip(cell.tip, e.clientX, e.clientY); else if (S.zoneTip) hideTip();
    S.zoneTip = !!cell;
  });
  app.addEventListener("pointerleave", () => { if (S.zoneTip) { hideTip(); S.zoneTip = false; } });
  // "The games behind this" lists are filled in the first time they are opened (toggle does not bubble, so listen in the capture phase).
  app.addEventListener("toggle", (e) => { const box = e.target.open && e.target.querySelector?.(":scope > .glinks[data-games]"); if (box) fillGameLinks(box); }, true);
}
async function fillGameLinks(box) {
  if (box.dataset.done) return;
  box.dataset.done = "1";
  let by = {};
  try { by = S.resById ||= Object.fromEntries((await load("results.json")).map((r) => [r.id, r])); } catch { /* links still work without labels */ }
  const ids = box.dataset.games.split(",").filter(Boolean).sort((a, b) => Date.parse(by[b]?.date || 0) - Date.parse(by[a]?.date || 0));
  box.innerHTML = ids.map((id) => { const r = by[id]; return `<a href="#/result/${esc(id)}">${r ? `<span class="muted">${esc(dayY(r.date))}</span> ${esc(T(r.away).abbr)} ${esc(r.act.as)} at ${esc(T(r.home).abbr)} ${esc(r.act.hs)}` : `Game ${esc(id)}`}</a>`; }).join("") || `<span class="muted small">No linked games.</span>`;
}
const gameLinks = (ids, n, what = "games") => (ids?.length ? `<details class="more"><summary>${ids.length < n ? `The most recent ${ids.length} of the ${esc(num(n))} ${what} behind this` : `The ${ids.length === 1 ? "game" : `${ids.length} ${what}`} behind this`}</summary><div class="glinks" data-games="${esc(ids.join(","))}"><span class="muted small">Loading...</span></div></details>` : "");

// ---------------------------------------------------------------- ease of use: favourites, search, glossary, sample labels
// favs() / isFav(kind, id) / toggleFav(kind, id)   kind "t" (team) or "p" (player); stored on this device only (localStorage "favs")
// favBtn(kind, id, name)                          star toggle; one delegated listener (wireFavs) handles every button on the page
// favFirst(list, kind, idOf)                      same list with favourites moved to the front (order otherwise kept)
// smallTag(on, text)                              written-out "small sample" badge
// glossary(keys, title)                           "What the terms mean" disclosure built from GLOSS
const FAV_KEY = "favs";
function favs() {
  if (S.fav) return S.fav;
  let v = null;
  try { v = JSON.parse(localStorage.getItem(FAV_KEY) || "null"); } catch { /* storage blocked or bad JSON */ }
  S.fav = { t: Array.isArray(v?.t) ? v.t.map(String) : [], p: Array.isArray(v?.p) ? v.p.map(String) : [] };
  return S.fav;
}
const isFav = (kind, id) => favs()[kind]?.includes(String(id)) || false;
function toggleFav(kind, id) {
  const f = favs(), k = String(id), i = f[kind].indexOf(k);
  if (i >= 0) f[kind].splice(i, 1); else f[kind].push(k);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch { /* private mode: kept for this visit only */ }
  return i < 0;
}
const STAR = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="var(--star-f, none)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const favText = (on, name) => [on ? `Remove ${name} from favourites` : `Add ${name} to favourites`, on ? "Favourite" : "Add to favourites"];
function favBtn(kind, id, name) {
  const on = isFav(kind, id), [aria, txt] = favText(on, name);
  return `<button class="fav-btn" type="button" data-fav="${esc(kind)}" data-id="${esc(id)}" data-name="${esc(name)}" aria-pressed="${on}" aria-label="${esc(aria)}">${STAR}<span class="fav-l">${esc(txt)}</span></button>`;
}
function wireFavs() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-fav]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const on = toggleFav(b.dataset.fav, b.dataset.id), [aria, txt] = favText(on, b.dataset.name || "this");
    document.querySelectorAll(`[data-fav="${CSS.escape(b.dataset.fav)}"][data-id="${CSS.escape(b.dataset.id)}"]`).forEach((x) => { x.setAttribute("aria-pressed", String(on)); x.setAttribute("aria-label", aria); const l = x.querySelector(".fav-l"); if (l) l.textContent = txt; });
    showToast(on ? `${b.dataset.name || "Saved"} added to favourites (this device only)` : `${b.dataset.name || "Removed"} removed from favourites`);
  });
}
const favFirst = (list, kind, idOf = (x) => x.id) => [...list.filter((x) => isFav(kind, idOf(x))), ...list.filter((x) => !isFav(kind, idOf(x)))];
let toastT;
function showToast(msg) { const el = document.getElementById("toast"); if (!el) return; el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }

// Shown on the sources page in place of an older meta.json "excluded" text that said no odds are used anywhere.
const ODDS_NOTE = "Sportsbook lines never feed the projections, learning, scenarios or simulation. They are fetched into data/odds.json only to be shown, labelled for comparison only, in the Simulation lab and High-confidence board.";
const smallTag = (on, text = "small sample") => (on ? ` <span class="ztag low">${esc(text)}</span>` : "");
const GLOSS = {
  min: ["Min", "Minutes he is expected to play (48 in a full game)."],
  pts: ["Pts", "Points."], reb: ["Reb", "Rebounds."], ast: ["Ast", "Assists: passes that led straight to a basket."],
  tpa: ["3PA", "Three-point shots he tries."], tpm: ["3PM", "Three-point shots he makes."],
  range: ["Range", "Where his points should land 8 times in 10 (for example 18-31)."],
  q: ["Q", "Listed questionable on the injury report, so his minutes are trimmed."],
  k2: ["2K", "NBA 2K27 rating from a community dataset. Unofficial, context only."],
  net: ["Net rating", "Points scored minus points allowed per 100 possessions. +5 is a good team, -5 a poor one."],
  per100: ["Per 100", "Per 100 possessions, so fast and slow teams can be compared fairly."],
  pace: ["Pace", "Possessions a team has in a game. More possessions means more points for both sides."],
  elo: ["Elo", "A rating that goes up with wins and down with losses, more for big wins over good teams. 1500 is average."],
  onoff: ["On / off", "How the team does with him on the floor versus when he sits, in the games he played."],
  per36: ["Per 36", "Per 36 minutes on the floor, so players with different minutes can be compared."],
  poss: ["Possessions (tracking)", "NBA.com splits a scorer's possession between the defenders who guarded him, so these are partial possessions."],
  vsexp: ["Vs his usual", "Points allowed per 100 possessions minus what those same scorers usually score. Negative = held them below their usual."],
  trust: ["Trust meter", "How far the model's recent projections were off, against the typical miss for similar projections. It describes recent games; it is not a forecast."],
  small: ["Small sample", "Fewer than about 10 games (or few possessions). A pattern to watch, not a fact."],
  split: ["Vs his usual (splits)", "His gap against the projection in that situation minus his overall gap across all his games."],
  ts: ["True shooting", "Points per shot, counting threes and free throws properly."],
  usage: ["Usage", "Share of his team's plays he finishes (a shot, free throws or a turnover) while on the floor."],
  margin: ["Margin", "Winning team's points minus the losing team's. A home margin of -4 means the away team wins by 4."],
  evidence: ["Evidence only", "Measured and shown, but kept out of the projection because it did not make past projections more accurate."],
};
const glossary = (keys, title = "What the terms mean") => `<details class="more gloss"><summary>${esc(title)}</summary><dl class="gl">${keys.filter((k) => GLOSS[k]).map((k) => `<dt>${esc(GLOSS[k][0])}</dt><dd>${esc(GLOSS[k][1])}</dd>`).join("")}</dl></details>`;

// ---- global search (header button, or "/" on a keyboard): any player or team, favourites first
function wireSearch() {
  const dlg = document.getElementById("srch"), input = document.getElementById("srch-q"), out = document.getElementById("srch-out"), btn = document.getElementById("search-btn");
  if (!dlg || !input || !out || !btn) return;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      const ft = favs().t.map((id) => S.T[id]).filter(Boolean), fp = favs().p.map((id) => S.P[id]).filter(Boolean);
      out.innerHTML = ft.length || fp.length
        ? `<p class="srch-h">Your favourites</p>${ft.map(teamHit).join("")}${fp.map(playerHit).join("")}`
        : `<p class="small muted srch-tip">Type a player or team name. Tip: tap the star on any player or team page to keep them at the top of lists.</p>`;
      return;
    }
    const score = (name) => { const n = name.toLowerCase(); return n.startsWith(q) ? 0 : n.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : 9; };
    const teams = S.teams.map((t) => ({ t, s: Math.min(score(t.name), score(t.abbr || ""), score(t.short || "")) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).slice(0, 6);
    const players = Object.values(S.P).map((p) => ({ p, s: score(p.n) - (isFav("p", p.id) ? 0.5 : 0) })).filter((x) => x.s < 9)
      .sort((a, b) => a.s - b.s || (b.p.cur?.[2] ?? b.p.prev?.[2] ?? -1) - (a.p.cur?.[2] ?? a.p.prev?.[2] ?? -1)).slice(0, 20);
    out.innerHTML = teams.length || players.length
      ? `${teams.length ? `<p class="srch-h">Teams</p>${teams.map((x) => teamHit(x.t)).join("")}` : ""}${players.length ? `<p class="srch-h">Players</p>${players.map((x) => playerHit(x.p)).join("")}` : ""}`
      : `<p class="empty">No player or team matches "${esc(input.value.trim())}".</p>`;
  };
  const teamHit = (t) => `<a class="srch-r" href="#/team/${esc(t.id)}">${teamLogo(t.id, { size: "sm" })}<span><b>${esc(t.name)}</b><i>${esc(t.record ? `${t.record.w}-${t.record.l}` : "")}${isFav("t", t.id) ? " · favourite" : ""}</i></span></a>`;
  const playerHit = (p) => `<a class="srch-r" href="#/player/${esc(p.id)}">${avatar(p.id, p.n, { size: "sm" })}<span><b>${esc(p.n)}</b><i>${esc([T(p.team).abbr, p.pos, p.cur ? `${f1(p.cur[2])} pts` : ""].filter(Boolean).join(" · "))}${isFav("p", p.id) ? " · favourite" : ""}</i></span></a>`;
  const open = () => { draw(); if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); } input.focus(); input.select(); };
  const close = () => { if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); } };
  btn.addEventListener("click", open);
  document.getElementById("srch-x")?.addEventListener("click", close);
  input.addEventListener("input", draw);
  out.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // tap on the dimmed backdrop
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const a = out.querySelector("a"); if (a) { a.click(); close(); } } }); // a real click, so the bundled build's link handler sees it too (assigning location.hash there would not survive the bundle rewrite)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault(); open();
  });
}

// ---------------------------------------------------------------- model trust meter
// trustChip(t)            short chip for a list row, only when the label is not "typical"
// trustBlock(t, opts)     full meter: recent miss against the typical miss, the lean, and the honest reading
// Trust labels describe how well WE have projected him, never the player himself.
const trustWord = (l) => ({ "keeps missing": "our projections off lately", "reads well": "we read him well lately", typical: "typical accuracy" })[l] || l || "";
const TRUST = {
  "reads well": ["good", "We have read him well lately"],
  "keeps missing": ["bad", "Our projections have been off for him lately"],
  typical: ["info", "Typical accuracy lately"],
  "too few games": ["", "Too few games to judge"],
};
function trustChip(t) {
  if (!t || !(t.label === "reads well" || t.label === "keeps missing")) return "";
  return `<span class="chip ${TRUST[t.label][0]} tchip">${t.label === "reads well" ? "Model reads well" : "Model often misses"}</span>`;
}
function trustBlock(t, { unit = "points", who = "him" } = {}) {
  if (!t) return `<p class="small muted">Not enough projected games to rate the model on ${esc(who)} yet.</p>`;
  const [c, txt] = TRUST[t.label] || ["", String(t.label ?? "")];
  const x = t.ratio != null ? (t.ratio - 1) * 100 : null;
  const lean = t.bias != null && t.lean && t.lean !== "no clear lean" ? `Projections have run ${t.bias > 0 ? "low" : "high"}: actual minus projected ${sg(t.bias)} ${esc(unit)} a game.` : t.bias != null ? `No clear lean (actual minus projected ${sg(t.bias)} ${esc(unit)} a game).` : "";
  return `<div class="trust"><span class="chip ${c}">${esc(txt)}</span>${t.small ? smallTag(true, `only ${t.games} games`) : ""}</div>
    <ul class="mrows">${meterRow({ label: `Average miss, last ${esc(t.games)} games`, value: `${f1(t.mae)} vs ${f1(t.typical)} typical`, x, scale: 40,
      sub: `Bar to the right = misses more than usual for projections like these; to the left = closer than usual. ${lean} All ${esc(num(t.allGames))} projected games: average miss ${f1(t.allMae)} ${esc(unit)}.` })}</ul>
    <p class="small muted">A label of "reads well" needs a recent miss 15% below typical, "keeps missing" 20% above. It describes recent games; in the back-test it barely predicted the next game's miss, so it is context, not a forecast.</p>`;
}

// ---------------------------------------------------------------- player: on-court, game scripts, returns, interactions, who guarded whom
const per100 = (x) => (x == null ? "-" : f1(x));
const posTxt = (x) => (x == null ? "-" : `${f0(x)}%`);
function onCourtCard(p) {
  const o = p.onOff, pr = p.pairs, sm = p.scoringWithMates || [], so = p.scoringVsOpponents || [], rd = p.rimDefense;
  if (!o && !pr?.best?.length && !sm.length && !rd) return "";
  const pairRow = (r) => `<li class="spread"><span>${playerChip(r.id, r.n, { href: `#/player/${r.id}` })}${r.current === false ? ` <span class="muted small">former teammate</span>` : ""}</span><span class="num"><b class="${cls(r.net48)}">${sg(r.net48)}</b> <span class="muted small">per 48 · ${esc(num(r.min))} min</span></span></li>`;
  return `<section class="card" id="p-onoff" aria-labelledby="p-onoff-h"><h2 id="p-onoff-h">On the court: with and without him</h2>
    ${o ? `<p class="lead-s">With him on the floor his team is <b class="${cls(o.swing)}">${sg(o.swing)}</b> points per 100 possessions ${o.swing >= 0 ? "better" : "worse"} than when he sits${o.small ? " (small sample)" : ""}.</p>
      <div class="statgrid sg3"><div class="stat"><b>${sg(o.netOn)}</b><span>Net with him on</span></div><div class="stat"><b>${sg(o.netOff)}</b><span>Net with him off</span></div><div class="stat"><b>${esc(num(o.min))}</b><span>Minutes on (${esc(o.games)} games)</span></div></div>
      <p class="small muted" style="margin-top:8px">Offence ${per100(o.ortgOn)} on / ${per100(o.ortgOff)} off, defence ${per100(o.drtgOn)} on / ${per100(o.drtgOff)} off (points per 100; lower defence is better). Rebuilt from play-by-play substitutions, this season and last. On/off also reflects who he shares the floor with.</p>` : ""}
    <details class="more"><summary>Show more: pairs, his scoring with teammates and opponents${rd ? ", rim defence" : ""}</summary>
      ${pr?.best?.length ? `<h3>Best pairs with teammates</h3><ul class="plain small">${pr.best.map(pairRow).join("")}</ul>` : ""}
      ${pr?.worst?.length ? `<h3>Weakest pairs</h3><ul class="plain small">${pr.worst.map(pairRow).join("")}</ul>` : ""}
      ${pr?.note ? `<p class="small muted">${esc(pr.note)}</p>` : ""}
      ${sm.length ? `<h3>His scoring with each teammate on or off</h3><div class="tw"><table><thead><tr><th>Teammate</th><th class="n">With<i>per 36</i></th><th class="n">Without<i>per 36</i></th><th class="n">Minutes<i>with / without</i></th></tr></thead>
        <tbody>${sm.map((r) => `<tr class="mid"><td>${playerChip(r.id, r.n)}</td><td class="n">${f1(r.with36)}</td><td class="n">${f1(r.without36)}</td><td class="n">${esc(num(r.minWith))} / ${esc(num(r.minWithout))}</td></tr>`).join("")}</tbody></table></div>
        <p class="small muted">Points per 36 minutes, in games both played (100+ minutes each way). A big gap often means the two share the ball, not that one helps or hurts the other.</p>` : ""}
      ${so.length ? `<h3>His scoring with an opposing player on or off</h3><div class="tw"><table><thead><tr><th>Opponent</th><th class="n">On<i>per 36</i></th><th class="n">Off<i>per 36</i></th><th class="n">Minutes<i>on / off</i></th></tr></thead>
        <tbody>${so.map((r) => `<tr class="mid"><td>${playerChip(r.id, r.n)}<span class="small muted def-m">${esc(T(r.team).abbr)} · ${esc(r.games)} games</span></td><td class="n">${f1(r.with36)}</td><td class="n">${f1(r.without36)}</td><td class="n">${esc(num(r.minWith))} / ${esc(num(r.minWithout))}</td></tr>`).join("")}</tbody></table></div>
        <p class="small muted">Only a few games and a hundred or so minutes stand behind each row: small samples, patterns to watch.</p>` : ""}
      ${rd ? `<h3>Rim defence with him on and off</h3><div class="statgrid sg4"><div class="stat"><b>${p1(rd.fgOn)}</b><span>Opponent rim FG%, him on</span></div><div class="stat"><b>${p1(rd.fgOff)}</b><span>Him off</span></div><div class="stat"><b>${f1(rd.att36On)}</b><span>Rim attempts /36, on</span></div><div class="stat"><b>${f1(rd.att36Off)}</b><span>Off</span></div></div>
        <p class="small muted" style="margin-top:8px">${esc(num(rd.attOn))} opponent rim shots with him on, ${esc(num(rd.attOff))} with him off.</p>` : ""}
    </details>
  </section>`;
}
function scriptsCard(p) {
  const gf = p.gameFlow, bo = p.blowout, cl = p.closing, rt = p.returns;
  if (!gf && !bo && !cl && !rt) return "";
  const fRow = (k, l) => { const r = gf?.[k]; return r?.games ? `<tr><td>${l}${smallTag(r.small)}</td><td class="n"><b>${f1(r.per36)}</b></td><td class="n">${f1(r.mpg)}</td><td class="n">${esc(r.games)}</td></tr>` : ""; };
  const lead = [];
  if (bo?.win?.games) lead.push(`In ${esc(bo.win.games)} wins by 15+ he played ${sg(bo.win.minVsProj)} minutes and scored ${sg(bo.win.ptsVsProj)} points against his projection.`);
  if (cl?.closeGames) lead.push(`He was on the floor at crunch time in ${esc(cl.onFloor)} of ${esc(cl.closeGames)} close games (${f0(cl.share)}%).`);
  return `<section class="card" id="p-scripts" aria-labelledby="p-scripts-h"><h2 id="p-scripts-h">Blowouts, close games and comebacks</h2>
    ${lead.length ? `<p class="lead-s">${lead.join(" ")}</p>` : ""}
    <details class="more"><summary>Show more: scoring by game script, blowout minutes${rt?.recent?.length ? ", return from absence" : ""}</summary>
      ${gf ? `<h3>Points per 36 minutes by score</h3><div class="tw"><table><thead><tr><th>Game script</th><th class="n">Pts<i>per 36</i></th><th class="n">Min<i>a game</i></th><th class="n">Games</th></tr></thead>
        <tbody>${fRow("normal", "Normal")}${fRow("ahead", "Far ahead (up 15+)")}${fRow("behind", "Far behind (down 15+)")}${fRow("tight4th", "Tight 4th quarter (within 5)")}</tbody></table></div>
        <p class="small muted">${esc(gf.note || "")}</p>` : ""}
      ${bo ? `<h3>Blowout minutes</h3><dl class="kv">
        ${bo.win?.games ? `<dt>Wins by 15+ (${esc(bo.win.games)} games)</dt><dd>${sg(bo.win.minVsProj)} min · ${sg(bo.win.ptsVsProj)} pts vs projection</dd>` : ""}
        ${bo.loss?.games ? `<dt>Losses by 15+ (${esc(bo.loss.games)} games)</dt><dd>${sg(bo.loss.minVsProj)} min · ${sg(bo.loss.ptsVsProj)} pts vs projection</dd>` : ""}
        ${bo.fourthQuarter?.lopsided ? `<dt>4th-quarter minutes, games decided by 18+</dt><dd>${f1(bo.fourthQuarter.lopsided.q4min)} (${esc(bo.fourthQuarter.lopsided.games)} games)</dd>` : ""}
        ${bo.fourthQuarter?.other ? `<dt>4th-quarter minutes, other games</dt><dd>${f1(bo.fourthQuarter.other.q4min)} (${esc(bo.fourthQuarter.other.games)} games)</dd>` : ""}
      </dl>${(bo.win?.games || 99) < 10 || (bo.loss?.games || 99) < 10 ? `<p class="small muted">Under 10 games on one side is a small sample.</p>` : ""}` : ""}
      ${rt?.recent?.length ? `<h3>Return from absence (${esc(rt.games)} comebacks)</h3><div class="tw"><table><thead><tr><th>Date (US)</th><th class="n">Game back</th><th class="n">Missed</th><th class="n">Min<i>before</i></th><th class="n">Pts<i>before</i></th></tr></thead>
        <tbody>${rt.recent.map((r) => `<tr><td>${esc(day(r.d))}</td><td class="n">${esc(r.k)}</td><td class="n">${esc(r.missed)}</td><td class="n">${f0(r.min)}<i>${f1(r.preMin)}</i></td><td class="n">${f0(r.pts)}<i>${f1(r.prePts)}</i></td></tr>`).join("")}</tbody></table></div>
        <p class="small muted">Games 1-5 after missing 3+ in a row, against his 10 games before the absence. Injury type is not known for past games, so this is by absence length only.</p>` : ""}
      <p class="small muted">These are measured habits, shown as evidence. In the back-test, blowout and game-flow adjustments did not make projections more accurate, so they do not move his projection.</p>
    </details>
  </section>`;
}
function defMatchRows(rows, who) {
  return `<div class="tw"><table class="ztable"><thead><tr><th>${who}</th><th class="n">Poss<i>games</i></th><th class="n">Per 100<i>usual</i></th><th class="n">FG</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="mid"><td>${playerChip(r.id, r.n, { href: /^\d+$/.test(String(r.id)) ? `#/player/${r.id}` : "" })}<span class="small muted def-m">${esc(T(r.team).abbr)}${r.share != null ? ` · ${f0(r.share)}% of his possessions when they met` : ""}${r.small ? " · small sample" : ""}</span></td>
      <td class="n">${esc(num(r.poss))}<i>${esc(r.games)} games</i></td><td class="n"><b>${f1(r.per100)}</b><i>${f1(r.exp100)}</i></td><td class="n">${esc(r.fgm)}/${esc(r.fga)}<i>${p1(r.fgPct)}</i></td></tr>`).join("")}</tbody></table></div>`;
}
function guardCard(p) {
  const gb = p.guardedBy, gd = p.guards;
  if (!gb?.rows?.length && !gd?.poss) return "";
  return `<section class="card" id="p-guard" aria-labelledby="p-guard-h"><h2 id="p-guard-h">Who guarded whom (NBA.com tracking)</h2>
    ${gd?.poss ? `<p class="lead-s">As a defender, the scorers he guarded scored <b class="${cls(-gd.vsExp100)}">${sg(gd.vsExp100)}</b> points per 100 possessions against their usual rate${gd.small ? " (small sample)" : ""}, over ${esc(num(gd.poss))} possessions in ${esc(gd.games)} games.</p>` : ""}
    ${gb?.rows?.length ? `<h3>Defenders who guarded him most</h3>${defMatchRows(gb.rows.slice(0, 5), "Defender")}
      <p class="small muted">Overall he scored ${f1(gb.per100)} points per 100 tracked possessions (${esc(num(gb.poss))} possessions, ${esc(gb.games)} games). Bold = his rate against that defender, small = his usual rate on the same possessions.</p>` : ""}
    <details class="more"><summary>Show more: his defence by type of scorer${gb?.rows?.length > 5 ? ", more defenders" : ""}</summary>
      ${gb?.rows?.length > 5 ? `<h3>More defenders</h3>${defMatchRows(gb.rows.slice(5), "Defender")}` : ""}
      ${gd?.byType?.length ? `<h3>His defence by type of scorer</h3><div class="tw"><table><thead><tr><th>Scorers</th><th class="n">Poss</th><th class="n">Per 100<i>usual</i></th><th class="n">Vs usual</th></tr></thead>
        <tbody>${gd.byType.map((r) => `<tr><td>${esc(r.label)}${smallTag(r.small)}</td><td class="n">${esc(num(r.poss))}</td><td class="n">${f1(r.per100)}<i>${f1(r.exp100)}</i></td><td class="n ${cls(-r.vsExp100)}"><b>${sg(r.vsExp100)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${gd?.groupShare ? `<p class="small">Share of his defensive possessions: guards ${posTxt(gd.groupShare.G)}, forwards ${posTxt(gd.groupShare.F)}, centres ${posTxt(gd.groupShare.C)}.</p>` : ""}
      ${gd?.rows?.length ? `<h3>Scorers he guarded most</h3>${defMatchRows(gd.rows, "Scorer")}` : ""}
    </details>
    <p class="small muted">NBA.com matchup tracking, this season and last, preseason left out. Units are points per 100 partial possessions. A measure of results on the floor, not a judgment of any player. Tested in the back-test and kept out of the projection (evidence only); the projection still uses the opponent's defence at his position.</p>
  </section>`;
}
function interactionsCard(p) {
  const ix = p.interactions; if (!ix) return "";
  const pt = ix.playerToTeam, tp = ix.teamToPlayer, ot = ix.opposingTeams || [];
  const lines = [];
  if (pt?.absence?.with) lines.push(`<li><b>He affects the team:</b> team net rating ${sg(pt.absence.netSwing)} per 100 in the ${esc(pt.absence.with)} games he played versus the ${esc(pt.absence.without)} he missed${pt.absence.small ? " (small sample of games missed)" : ""}.</li>`);
  if (tp?.games) lines.push(`<li><b>The team affects him:</b> when his team scores 10 more than its projection, he scores ${sg(tp.ptsPer10TeamPts)} more than his (${esc(tp.games)} games, link strength ${Math.abs(tp.r) >= 0.3 ? "clear" : Math.abs(tp.r) >= 0.15 ? "weak" : "none found"}).</li>`);
  if (ix.teammates?.onCourtPairs?.best?.[0]) { const b = ix.teammates.onCourtPairs.best[0]; lines.push(`<li><b>With teammates:</b> best pair with ${esc(b.n)} (${sg(b.net48)} per 48 over ${esc(num(b.min))} minutes). More in "On the court" above.</li>`); }
  if (ix.opposingPlayers?.onCourt?.[0]) { const o = ix.opposingPlayers.onCourt[0]; lines.push(`<li><b>Against opposing players:</b> with ${esc(o.n)} on the floor he scores ${f1(o.with36)} per 36, without ${f1(o.without36)} (${esc(o.games)} games, small sample).</li>`); }
  if (!lines.length && !ot.length) return "";
  return `<section class="card" id="p-ix" aria-labelledby="p-ix-h"><h2 id="p-ix-h">Two-way effects</h2>
    <ul class="dots small">${lines.join("")}</ul>
    ${ot.length ? `<details class="more"><summary>Against each opposing team (${ot.length})</summary><ul class="plain small">${ot.map((s) => `<li class="spread"><span>${splitLabel(s)} <span class="muted">(${esc(s.n)} games)</span>${smallTag(s.small)}</span><span class="num ${cls(s.pts)}">${sg(s.pts)} pts vs his usual</span></li>`).join("")}</ul></details>` : ""}
    <p class="small muted">Every line shows its sample. These show what happened together; they do not prove one player causes the other's numbers.</p>
  </section>`;
}

// ---------------------------------------------------------------- upcoming game: quarters, defenders tonight, in-loop evidence
function quarterCard(g, away, home) {
  const qa = away.quarters, qh = home.quarters;
  if (!qa?.proj?.length || !qh?.proj?.length) return "";
  const L = S.learning?.inloop?.quarters;
  const row = (t, q) => `<tr><td>${teamName(t.tid, { text: "abbr" })}</td>${q.proj.map((v) => `<td class="n">${f1(v)}</td>`).join("")}<td class="n"><b>${f1(q.total ?? q.proj.reduce((s, v) => s + v, 0))}</b></td></tr>`;
  const idl = (t, q) => q.identity?.margin ? `<li>${esc(T(t.tid).abbr)} ${esc(q.identity.scope || "")}: quarter margins ${q.identity.margin.map((m, i) => `Q${i + 1} ${sg(m)}`).join(", ")} (${esc(q.identity.games)} games${q.identity.games < 10 ? ", small sample" : ""}).</li>` : "";
  return `<section class="card" id="g-q" aria-labelledby="g-q-h"><h2 id="g-q-h">Quarter by quarter</h2>
    <div class="tw"><table><thead><tr><th>Team</th><th class="n">Q1</th><th class="n">Q2</th><th class="n">Q3</th><th class="n">Q4</th><th class="n">Total</th></tr></thead>
      <tbody>${row(away, qa)}${row(home, qh)}</tbody></table></div>
    <details class="more"><summary>How the quarters are split</summary>
      <ul class="dots small">${idl(away, qa)}${idl(home, qh)}</ul>
      <p class="small muted">Each team's projected points are shared across quarters by how it usually scores by quarter and how the opponent usually allows, shrunk to the league's shares. The quarters always add up to the projected score, so this changes nothing in the projection.${L ? ` In the back-test the average miss per team-quarter was ${esc(L.maeModel)} points, against ${esc(L.maeEvenSplit)} for an even split.` : ""}</p>
    </details>
  </section>`;
}
// Real defenders expected tonight (NBA.com tracking). Evidence only: listed, not applied.
function dmBlock(p, { full = true } = {}) {
  const dm = p.dm; if (!dm?.defenders?.length) return "";
  const rows = dm.defenders.map((d) => `<tr class="mid"><td>${playerChip(d.id, d.n)}<span class="small muted def-m">${esc(d.pos || "")}${d.fromMeetings ? ` · met before` : ""}</span></td>
    <td class="n"><b>${f0(d.share)}%</b></td>
    <td class="n">${d.vsExpPct == null ? `<span class="muted">-</span>` : `<span class="${cls(-d.vsExpPct)}">${sg(d.vsExpPct, 0)}%</span>`}<i>${esc(num(d.defPoss))} poss</i></td>
    <td class="n">${d.h2h ? `${f1(d.h2h.per100)}<i>${esc(d.h2h.poss)} poss · ${esc(d.h2h.games)} g${d.h2h.small ? " · small" : ""}</i>` : `<span class="muted">never</span>`}</td></tr>`).join("");
  return `<h4>Who is likely to guard him tonight (NBA.com tracking)</h4>
    <div class="tw"><table class="ztable"><thead><tr><th>Defender</th><th class="n">Share<i>expected</i></th><th class="n">Allows<i>vs usual</i></th><th class="n">Him vs this defender<i>per 100</i></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${full ? `<p class="small muted">Share = expected part of his possessions each defender takes, from their usual assignments, minutes and earlier meetings. "Allows" = points that defender gives up against similar scorers versus their usual (negative = tougher). ${esc(num(dm.coverage))}% of his possessions are covered by defenders with a record. Evidence only: in the back-test this did not make projections more accurate, so it does not move his line.</p>` : ""}`;
}
function ixBlock(p) {
  const ix = p.ix; if (!ix) return "";
  const out = [];
  const b = ix.blowout;
  if (b && (b.winBy15 >= 0.15 || b.loseBy15 >= 0.15)) {
    if (b.winBy15 >= 0.15 && b.ifWinBig) out.push(`<li><b>If his team wins big (${pct(b.winBy15)} chance):</b> about ${sg(b.ifWinBig.min)} minutes and ${sg(b.ifWinBig.pts)} points against his projection (${esc(b.ifWinBig.games)} of his own games${b.ifWinBig.games < 10 ? ", small sample" : ""}).</li>`);
    if (b.loseBy15 >= 0.15 && b.ifLoseBig) out.push(`<li><b>If his team loses big (${pct(b.loseBy15)} chance):</b> about ${sg(b.ifLoseBig.min)} minutes and ${sg(b.ifLoseBig.pts)} points against his projection (${esc(b.ifLoseBig.games)} of his own games${b.ifLoseBig.games < 10 ? ", small sample" : ""}).</li>`);
  }
  const fl = ix.flow;
  if (fl?.tight4th?.games && Math.abs(fl.tight4th.vsUsual36 ?? 0) >= 2) out.push(`<li><b>In a tight 4th quarter</b> he has scored ${f1(fl.tight4th.ppm36)} per 36 against his usual ${f1(fl.usual36)} (${esc(fl.tight4th.games)} games${fl.tight4th.small ? ", small sample" : ""}).</li>`);
  const r = ix.returning;
  if (r) out.push(`<li><b>Game ${esc(r.gameBack)} back</b> after missing ${esc(r.missed)} games${r.injury ? ` (${esc(r.injury)})` : ""}. Before the absence: ${f1(r.beforeMin)} min, ${f1(r.beforePts)} pts. League-wide, players at this point have played ${sg(r.curveMin)} minutes against projection (${esc(num(r.curveGames))} games).</li>`);
  for (const m of (ix.absentMates || []).filter((m) => Math.abs(m.pts) >= 1 && m.minWith >= 100 && m.minWithout >= 100).slice(0, 2)) out.push(`<li><b>${esc(m.n)} is out:</b> he has scored ${sg(m.per36)} per 36 with ${esc(m.n)} off the floor versus on (${esc(m.games)} games, ${esc(num(m.minWith))} minutes with / ${esc(num(m.minWithout))} without).</li>`);
  for (const m of (ix.absentOpps || []).filter((m) => Math.abs(m.pts) >= 1 && m.games >= 5).slice(0, 1)) out.push(`<li><b>Opponent ${esc(m.n)} is out:</b> his scoring has run ${sg(m.per36)} per 36 with ${esc(m.n)} off versus on (${esc(m.games)} games, small sample).</li>`);
  if (!out.length) return "";
  return `<h4>Game scripts and who is missing (evidence only)</h4><ul class="dots">${out.join("")}</ul>
    <p class="small muted">Measured from past games and shown for context. These effects did not improve accuracy in the back-test, so they are not added to his projection.</p>`;
}
const trustLine = (t) => (t && t.games ? `<p class="small muted">Trust meter: average miss ${f1(t.mae)} points over his last ${esc(t.games)} games against ${f1(t.typical)} typical${t.label && t.label !== "typical" ? ` (${esc(t.label === "reads well" ? "the model reads him well" : t.label === "keeps missing" ? "the model keeps missing him" : t.label)})` : ""}.</p>` : "");

// ---------------------------------------------------------------- team: coach habits, quarters, on/off, interactions, trust
function teamFlowCards(t) {
  const ro = t.rotation, qi = t.quarterIdentity, oo = t.onOff, ix = t.interactions;
  const pu = (v, g) => `${f1(v)}${g != null ? ` <span class="muted small">(${esc(g)} g)</span>${smallTag(g < 5)}` : ""}`;
  // blowout rows: counts are player-games; small under 25 (about 5 games of five starters)
  const bw = (o) => (o ? `${sg(o.minVsProj)} min <span class="muted">(${esc(o.games)} player-games${o.games < 25 ? ", small sample" : ""})</span>` : "-");
  // starters' 4th-quarter minutes in lopsided games: counted over playersUsed.lopsidedGames; hidden under 3 games
  const q4l = (r) => { const n = r.playersUsed?.lopsidedGames; if (n == null) return f1(r.starterQ4Min.lopsided); return n >= 3 ? `${f1(r.starterQ4Min.lopsided)} <span class="muted small">(${esc(n)} g)</span>${smallTag(n < 5)}` : `<span class="muted small">too few lopsided games (${esc(n)})</span>`; };
  const rot = (r, label) => r ? `<h3>${esc(label)} (${esc(r.games)} games${r.games < 10 ? ", small sample" : ""})</h3><dl class="kv">
      <dt>First substitution</dt><dd>${f1(r.firstSubMin)} min in</dd>
      <dt>A starter's first stint</dt><dd>${f1(r.starterFirstStint)} min</dd>
      <dt>Substitutions a game</dt><dd>${f1(r.subsPerGame)}</dd>
      ${r.playersUsed ? `<dt>Players used: close / lopsided games</dt><dd>${pu(r.playersUsed.close, r.playersUsed.closeGames)} / ${pu(r.playersUsed.lopsided, r.playersUsed.lopsidedGames)}</dd>` : ""}
      ${r.starterQ4Min ? `<dt>Starters' 4th-quarter minutes: lopsided / other</dt><dd>${q4l(r)} / ${f1(r.starterQ4Min.other)}</dd>` : ""}
    </dl>${r.playersUsed ? `<p class="small muted">Close = decided by 8 or fewer points; lopsided = decided by 18 or more.</p>` : ""}${r.closers?.length ? `<p class="small" style="margin-top:8px"><b>Closers</b> (on the floor at 2:00 of a 4th quarter within 5, ${esc(r.closeGames)} games): ${r.closers.map((c) => `${esc(c.n)} ${f0(c.share)}%`).join(", ")}.</p>` : ""}
    ${r.blowout ? `<p class="small">In 15+ wins the starters played ${bw(r.blowout.starters?.win)} and the bench ${bw(r.blowout.bench?.win)} against projection${r.blowout.starters?.loss || r.blowout.bench?.loss ? `; in 15+ losses starters ${bw(r.blowout.starters?.loss)}, bench ${bw(r.blowout.bench?.loss)}` : ""}. Counts are player-games (one starter in one game = 1).</p>` : ""}` : "";
  const cur = ro?.current, prev = ro?.previous;
  const lead = cur ? `${t.coach ? esc(t.coach) : "The coach"} makes the first change about ${f1(cur.firstSubMin)} minutes in and uses ${f1(cur.playersUsed?.close)} players in close games${cur.games < 10 ? " (early-season sample)" : ""}.` : "";
  const ooRow = (r) => `<li class="spread"><span>${playerChip(r.id, r.n, { href: `#/player/${r.id}` })}</span><span class="num"><b class="${cls(r.swing)}">${sg(r.swing)}</b> <span class="muted small">${esc(num(r.min))} min</span></span></li>`;
  return `${t.trust ? `<section class="card" aria-labelledby="t-trust-h"><h2 id="t-trust-h">Trust meter: how well the model reads them</h2>${trustBlock(t.trust, { who: "them" })}</section>` : ""}
    ${cur || prev ? `<section class="card" aria-labelledby="t-rot-h"><h2 id="t-rot-h">Coach rotation habits</h2>
      ${lead ? `<p class="lead-s">${lead}</p>` : ""}${rot(cur, "This season")}
      ${prev ? `<details class="more"><summary>Last season</summary>${rot(prev, "Last season")}</details>` : ""}
      <p class="small muted">Rebuilt from play-by-play substitutions, preseason left out. Coach changes inside a season are not known, so the unit is the team-season.</p></section>` : ""}
    ${qi?.margin ? `<section class="card" aria-labelledby="t-q-h"><h2 id="t-q-h">By quarter</h2>
      <div class="tw"><table><thead><tr><th></th><th class="n">Q1</th><th class="n">Q2</th><th class="n">Q3</th><th class="n">Q4</th></tr></thead><tbody>
        <tr><td>Points scored</td>${qi.scored.map((v) => `<td class="n">${f1(v)}</td>`).join("")}</tr>
        <tr><td>Margin</td>${qi.margin.map((v) => `<td class="n ${cls(v)}"><b>${sg(v)}</b></td>`).join("")}</tr></tbody></table></div>
      <p class="small muted">Average per quarter, ${esc(qi.scope)}, ${esc(qi.games)} games${qi.games < 10 ? " (small sample)" : ""}.</p></section>` : ""}
    ${oo?.top?.length || ix?.playersToTeam?.length ? `<section class="card" aria-labelledby="t-oo-h"><h2 id="t-oo-h">On/off and two-way effects</h2>
      ${oo?.top?.length ? `<h3>Team better with him on the floor</h3><ul class="plain small">${oo.top.map(ooRow).join("")}</ul>` : ""}
      <details class="more"><summary>Show more: team worse with him on, games missed, who rises with the team</summary>
        ${oo?.bottom?.length ? `<h3>Team worse with him on the floor</h3><ul class="plain small">${oo.bottom.map(ooRow).join("")}</ul>` : ""}
        ${ix?.playersToTeam?.length ? `<h3>Team net rating with versus without (games missed)</h3><ul class="plain small">${ix.playersToTeam.map((r) => `<li class="spread"><span>${playerChip(r.id, r.n, { href: `#/player/${r.id}` })}${smallTag(r.small)}</span><span class="num"><b class="${cls(r.netSwing)}">${sg(r.netSwing)}</b> <span class="muted small">${esc(r.with)} with / ${esc(r.without)} without</span></span></li>`).join("")}</ul>` : ""}
        ${ix?.teamToPlayers?.length ? `<h3>Players whose scoring rises with the team's</h3><ul class="plain small">${ix.teamToPlayers.map((r) => `<li class="spread"><span>${esc(r.n)}</span><span class="num">${sg(r.ptsPer10TeamPts)} pts per 10 team pts <span class="muted">(${esc(r.games)} games)</span></span></li>`).join("")}</ul>` : ""}
        ${ix?.vsTeams?.length ? `<h3>Against specific opponents (margin vs projection)</h3><div class="chips">${ix.vsTeams.map((v) => `<span class="chip">${esc(T(v.t).abbr)} ${sg(v.margin)} (${esc(v.n)}${v.small ? ", small" : ""})</span>`).join("")}</div>` : ""}
      </details>
      <p class="small muted">Points per 100 possessions with each player on the floor minus off it (300+ minutes, this season and last, current roster). On/off depends on who shares the floor, so read it with the minutes shown.</p></section>` : ""}`;
}

// ---------------------------------------------------------------- Games (upcoming)
async function vGames() {
  if (S.liveData === undefined) S.liveData = await load("live.json").catch(() => null);
  await liveScoreboard();
  startScoreTicker();
  const up = await load("upcoming.json");
  if (!up.length) { app.innerHTML = `<h1>Upcoming games</h1><p class="empty">No games on the schedule in the next week. Check back after the next data refresh.</p>`; return; }
  // Days are Philippine calendar days. The switcher shows one day at a time; favourite teams' games come first within it.
  const groups = new Map();
  for (const g of up) { const k = dayKey(g.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  const keys = [...groups.keys()], today = dayKey(new Date().toISOString()), tmr = dayKey(new Date(Date.now() + 864e5).toISOString());
  if (!groups.has(S.gday) && S.gday !== "all") S.gday = keys[0];
  const label = (k) => (k === today ? "Today" : k === tmr ? "Tomorrow" : day(groups.get(k)[0].date));
  const ft = favs().t.filter((id) => S.T[id]), fp = favs().p.filter((id) => S.P[id]);
  const favGames = (gs) => favFirst(gs, "t", (g) => (isFav("t", g.home) ? g.home : g.away));
  const draw = () => {
    const shown = S.gday === "all" ? keys : [S.gday];
    // Favourites strip: each favourite team's next game, and the next game of each favourite player's team.
    const favRows = [];
    for (const tid of ft) { const g = up.find((x) => x.home === tid || x.away === tid); if (g) favRows.push(`<a class="fav-r" href="#/game/${esc(g.id)}">${teamLogo(tid, { size: "sm" })}<span><b>${esc(T(tid).short || T(tid).name)}</b> ${g.home === tid ? "vs" : "at"} ${esc(T(g.home === tid ? g.away : g.home).abbr)}<i>${esc(label(dayKey(g.date)))} · ${esc(timePH(g.date))} · win chance ${pct(g.home === tid ? g.pred.pHome : 1 - g.pred.pHome)}</i></span></a>`); }
    for (const id of fp) { const p = S.P[id], g = up.find((x) => x.home === p.team || x.away === p.team); if (g) favRows.push(`<a class="fav-r" href="#/game/${esc(g.id)}">${avatar(id, p.n, { size: "sm" })}<span><b>${esc(p.n)}</b> ${g.home === p.team ? "vs" : "at"} ${esc(T(g.home === p.team ? g.away : g.home).abbr)}<i>${esc(label(dayKey(g.date)))} · ${esc(timePH(g.date))}</i></span></a>`); }
    app.innerHTML = `<h1>Upcoming games</h1>
      <p class="lead">Projected score and win chance for every game, with the main reasons on each card. Tap a game for the full reasoning. Times are ${PHT} (Manila).</p>
      <p class="small pitch">Built without bookmaker data, and usually within a few points of the market anyway. When we disagree, we show you why.</p>
      ${favRows.length ? `<section class="card favs" aria-labelledby="fav-h"><h2 id="fav-h">${STAR} Your favourites</h2><div class="fav-l2">${favRows.join("")}</div></section>` : ""}
      <div class="filters dayswitch" role="group" aria-label="Choose a day (${PHT})">${keys.map((k) => `<button class="fbtn" type="button" data-day="${esc(k)}" aria-pressed="${S.gday === k}">${esc(label(k))} <span class="cnt">${groups.get(k).length}</span></button>`).join("")}<button class="fbtn" type="button" data-day="all" aria-pressed="${S.gday === "all"}">All days <span class="cnt">${up.length}</span></button></div>
      ${shown.map((k) => { const gs = favGames(groups.get(k)); return `<h2 class="day"><span>${esc(dayLong(gs[0].date))}</span><span class="cnt">${gs.length} ${gs.length === 1 ? "game" : "games"} · ${PHT}</span></h2>${gs.map((g) => gameCard(g) + labLinks(g)).join("")}`; }).join("")}
      ${!favRows.length ? `<p class="small muted">Tip: tap the star on a team or player page to see their next game here first. Favourites are kept on this device only.</p>` : ""}`;
    app.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { S.gday = b.dataset.day; draw(); app.querySelector(`[data-day="${CSS.escape(S.gday)}"]`)?.focus({ preventScroll: true }); }));
  };
  draw();
}
// A reason sentence shortened for a list card: long bracketed asides are dropped (the game page shows the full sentence).
const briefReason = (t) => String(t ?? "").replace(/\s*\([^()]{40,}\)/g, "").trim();
// One upcoming game: logos, projected score, win chance, the projected top scorer of each side with his face, and the top reason each side can win.
// ---- Model lines: spread, moneyline, total and player props derived from our own projection.
// These are what the model itself would set. They are not sportsbook odds and use none.
const halfLine = (x) => Math.floor(x) + 0.5;                       // 23.6 -> 23.5, 24.2 -> 24.5 rule below
const nearHalf = (x) => Math.round(x - 0.5) + 0.5;                 // nearest x.5
const fairML = (p) => { p = Math.min(0.995, Math.max(0.005, p)); return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p); };
// Odds are shown as decimal odds everywhere (payout per 1 staked, stake included).
const decOdds = (a) => { const v = Number(String(a ?? "").replace("+", "")); if (!v || !Number.isFinite(v)) return "-"; return (v > 0 ? 1 + v / 100 : 1 + 100 / -v).toFixed(2); };
const mlTxt = (p) => (p > 0 && p < 1 ? (1 / p).toFixed(2) : "-");
const spreadTxt = (x) => (x > 0 ? `−${x.toFixed(1)}` : `+${Math.abs(x).toFixed(1)}`);
function pNorm(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2); const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; }
// Chance a stat clears a line, using the player's own (uneven) 80% range when we have it.
function pOver(mean, line, lo, hi) {
  if (mean == null) return null;
  let sd;
  if (lo != null && hi != null && hi > lo) sd = line >= mean ? Math.max(1, (hi - mean) / 1.2816) : Math.max(1, (mean - lo) / 1.2816);
  else sd = Math.max(0.8, Math.sqrt(Math.max(mean, 0.3)) * 1.15);
  return 1 - pNorm((line - mean) / sd);
}
// Scenario-based explanation for one player in one game: the situations that apply tonight, his own
// record in those spots, how the game script could change his night, absences, and his zone matchup.
function scenarioBlock(p, g, oppTid) {
  const L = S.learning, role = p.role || "starter", a = p.adj || {}, rows = [];
  const rl = (name) => L?.scenarios?.find((x) => x.s === name)?.roles?.[role];
  const small = (n, flag) => smallTag(flag ?? n < 10);
  // 1. His own record in tonight's spots (opponent, arena, size, defender type, rest...). The model already applies the
  //    minimums (5 games for an opponent, opposing player or arena; 8 for everything else), so every row it sends is shown.
  const own = a.matchups || [];
  // 2. Situations that apply tonight, learned from every player in his role
  const sit = (p.scen || []).filter((x) => x.n >= 20).sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts));
  // 3. If the game script changes
  const flow = [];
  const bl = rl(p.st || role !== "bench" ? "projected blowout (starter)" : "projected blowout (bench)");
  if (g?.pred?.blowout != null && bl?.min) flow.push(`<li><b>If it becomes a blowout (${pct(g.pred.blowout)} chance):</b> players in his role have played ${sg(bl.min.rawAvg)} minutes and scored ${sg(bl.pts?.rawAvg)} points versus projection in those games (${num(bl.min.n)} games).</li>`);
  const cl = rl("projected close game");
  if (g?.pred?.close != null && cl?.min) flow.push(`<li><b>If it stays close (${pct(g.pred.close)} chance of a finish within 5):</b> ${sg(cl.min.rawAvg)} minutes and ${sg(cl.pts?.rawAvg)} points versus projection for his role (${num(cl.min.n)} games).</li>`);
  if (p.lo != null && p.hi != null) flow.push(`<li><b>Bad night to big night:</b> 8 times in 10 he should land between ${esc(p.lo)} and ${esc(p.hi)} points; the projection is ${f1(p.pts)}.</li>`);
  // 4. Teammates out / back
  const abs = [];
  if (a.absence && Math.abs(a.absence) >= 0.3) abs.push(`<li>Teammates out tonight move about ${sg(a.absence)} points of scoring load ${a.absence > 0 ? "to" : "away from"} him.</li>`);
  for (const w of [...(a.ww || []), ...(p.wwD || []).map((x) => (typeof x === "string" ? x : x?.txt)).filter(Boolean)]) abs.push(`<li>${esc(w)}</li>`);
  if (p.q) abs.push(`<li>He is listed questionable, so his minutes are trimmed.</li>`);
  const other = [];
  if (a.defense && Math.abs(a.defense - 1) >= 0.03) other.push(`<li>The opponent allows ${a.defense > 1 ? "more" : "fewer"} points than average to his position (${sg((a.defense - 1) * 100, 0)}%).</li>`);
  if (a.pace && Math.abs(a.pace - 1) >= 0.015) other.push(`<li>Expected pace is ${a.pace > 1 ? "faster" : "slower"} than his team usually plays (${sg((a.pace - 1) * 100, 0)}%).</li>`);
  if (a.bias && Math.abs(a.bias) >= 0.5) other.push(`<li>He has been ${a.bias > 0 ? "beating" : "falling short of"} his projections lately (${sg(a.bias)} pts), and the model carries part of that forward.</li>`);
  return `<div class="scn-block">
    ${own.length ? `<h4>His own record in tonight's spots (vs his usual)</h4><ul class="plain">${own.map((m) => `<li class="spread"><span>${splitLabel(m)} <span class="muted">(${esc(m.n)} games)</span>${small(m.n, m.small)}</span><span class="num"><span class="${cls(m.pts)}">${sg(m.pts)} pts</span>${Math.abs(m.reb ?? 0) >= 1 ? ` · ${sg(m.reb)} reb` : ""}${Math.abs(m.ast ?? 0) >= 1 ? ` · ${sg(m.ast)} ast` : ""}${Math.abs(m.tpa ?? 0) >= 1 ? ` · ${sg(m.tpa)} 3PA` : ""}</span></li>`).join("")}</ul>` : ""}
    ${sit.length ? `<h4>Situations tonight, learned from every ${esc(role)} since Oct 2025</h4><ul class="plain">${sit.map((x) => `<li class="spread"><span>${esc(x.s)} <span class="muted">(${num(x.n)} games)</span></span><span class="num ${cls(x.pts)}">${sg(x.pts, 2)} pts</span></li>`).join("")}</ul>` : ""}
    ${flow.length ? `<h4>How the game script could change his night</h4><ul class="dots">${flow.join("")}</ul>` : ""}
    ${abs.length ? `<h4>Who is in and out</h4><ul class="dots">${abs.join("")}</ul>` : ""}
    ${other.length ? `<h4>Other adjustments</h4><ul class="dots">${other.join("")}</ul>` : ""}
    ${p.zm?.txt ? `<h4>Zone matchup against ${esc(T(oppTid).abbr)}</h4><p>${esc(p.zm.txt)}</p>` : ""}
    ${!own.length && !sit.length && !flow.length && !abs.length ? `<p>No situation tonight has enough history to move his line; this is close to his normal output for the minutes expected.</p>` : ""}
    ${own.length ? `<p class="small muted">"Vs his usual" = his gap against the projection in that spot minus his overall gap. Counts include last season (with its play-in and playoffs), this season and preseason. Minimum 5 games against a team, player or arena (the schedule allows only 3-4 meetings a season) and 8 for other situations; under 10 is a small sample.</p>` : ""}
  </div>`;
}

// One plain line: projection vs his season average, and the biggest reasons behind the difference.
function propReason(p) { const { lead, top } = reasonParts(p); return esc(`${lead}${top.length ? `: ${top.join("; ")}` : ""}`); }
// The top 1-2 plain reasons his projection differs from his season average, shown on every player row without a tap.
function rowWhy(p) {
  const { top, diff } = reasonParts(p);
  const txt = top.length ? top.join(" · ") : diff != null && Math.abs(diff) < 1 ? "Close to his usual output" : "";
  return txt ? `<span class="why-row"><b>${diff == null || Math.abs(diff) < 1 ? "Why" : diff > 0 ? `${sg(diff)} vs avg` : `${sg(diff)} vs avg`}</b> ${esc(txt)}</span>` : "";
}
function reasonParts(p) {
  const s = S.P[p.id], src = s?.cur?.[0] >= 3 ? s.cur : s?.prev, avg = src?.[2], avgMin = src?.[1], a = p.adj || {}, r = [];
  // [signed points effect, text]; only reasons pointing the same way as the gap are shown.
  if (avgMin != null && p.min != null && Math.abs(p.min - avgMin) >= 1.5) r.push([(p.min - avgMin) * (avg || 0) / Math.max(avgMin, 1), `${f0(p.min)} projected minutes vs his ${f1(avgMin)} average`]);
  if (a.absence && Math.abs(a.absence) >= 0.5) r.push([a.absence, a.absence > 0 ? "teammates out give him more shots" : "returning teammates take shots"]);
  if (a.defense && Math.abs(a.defense - 1) >= 0.03) r.push([(a.defense - 1) * (p.pts || 0), a.defense > 1 ? "soft defence at his position" : "tough defence at his position"]);
  if (a.pace && Math.abs(a.pace - 1) >= 0.015) r.push([(a.pace - 1) * (p.pts || 0), a.pace > 1 ? "faster pace than usual" : "slower pace than usual"]);
  if (a.split && Math.abs(a.split) >= 0.4) r.push([a.split, a.split > 0 ? "has scored above his norm in matchups like this" : "has scored below his norm in matchups like this"]);
  if (a.bias && Math.abs(a.bias) >= 0.5) r.push([a.bias, a.bias > 0 ? "has been beating his projections lately" : "has been falling short of his projections lately"]);
  for (const x of (p.scen || []).filter((x) => x.n >= 20 && Math.abs(x.pts) >= 0.3)) r.push([x.pts, `${x.s} (${sg(x.pts)} pts in past games)`]);
  if (p.q) r.push([-3, "listed questionable, minutes trimmed"]);
  const diff = avg != null && p.pts != null ? p.pts - avg : null;
  const top = r.filter((x) => diff == null || Math.abs(diff) < 1 || Math.sign(x[0]) === Math.sign(diff)).sort((x, y) => Math.abs(y[0]) - Math.abs(x[0])).slice(0, 2).map((x) => x[1]);
  const lead = diff == null ? `Projected ${f1(p.pts)} pts` : Math.abs(diff) < 1 ? `Projected ${f1(p.pts)} pts, close to his ${f1(avg)} average` : `Projected ${f1(p.pts)} pts, ${sg(diff)} vs his ${f1(avg)} average`;
  return { lead, top, diff };
}
function gameLines(g) {
  const margin = g.pred.hs - g.pred.as, fav = margin >= 0 ? g.home : g.away, line = nearHalf(Math.abs(margin));
  return { fav, dog: fav === g.home ? g.away : g.home, spread: line, total: nearHalf(g.pred.hs + g.pred.as), pFav: fav === g.home ? g.pred.pHome : 1 - g.pred.pHome };
}
function linesCard(g, away, home) {
  const L = gameLines(g);
  const props = [away, home].flatMap((t) => t.players.filter((p) => p.min >= 22).slice(0, 4).map((p) => ({ ...p, tid: t.tid })));
  const cell = (mean, lo, hi) => { if (mean == null) return `<td class="n">-</td>`; const ln = nearHalf(mean), po = pOver(mean, ln, lo, hi); return `<td class="n"><b>${ln.toFixed(1)}</b><i>O ${pct(po)}</i></td>`; };
  return `<section class="card" id="g-lines" aria-labelledby="g-lines-h"><h2 id="g-lines-h">Our lines for this game</h2>
    <p class="small muted">What our projection works out to as a spread, moneyline, total and player props. These are the model's own numbers, not sportsbook odds; the moneyline is the fair price for our win chance with no bookmaker margin.</p>
    <div class="statgrid lines-grid">
      <div class="stat"><b>${esc(T(L.fav).abbr)} ${spreadTxt(L.spread)}</b><span>Spread</span></div>
      <div class="stat"><b>${esc(T(L.fav).abbr)} ${mlTxt(L.pFav)}</b><span>Moneyline (${esc(T(L.dog).abbr)} ${mlTxt(1 - L.pFav)})</span></div>
      <div class="stat"><b>${L.total.toFixed(1)}</b><span>Total points</span></div>
      <div class="stat"><b>${esc(T(away.tid).abbr)} ${f1(g.pred.as)}</b><span>Team total</span></div>
      <div class="stat"><b>${esc(T(home.tid).abbr)} ${f1(g.pred.hs)}</b><span>Team total</span></div>
      <div class="stat"><b>${pct(L.pFav)}</b><span>${esc(T(L.fav).abbr)} win chance</span></div>
    </div>
    ${props.length ? `<h3>Player props (our line, then the chance he goes over it)</h3>
    <div class="tw"><table class="props"><thead><tr><th>Player</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">3PM</th></tr></thead><tbody>
      ${props.map((p) => `<tr><td>${teamLogo(p.tid, { size: "xs" })} ${pname(p.n)}${p.q ? ` <span class="qtag">Q</span>` : ""}</td>${cell(p.pts, p.lo, p.hi)}${cell(p.reb)}${cell(p.ast)}${cell(p.tpm)}</tr>`).join("")}
    </tbody></table></div>
    <h3>Why each line is above or below his average</h3>
    <div class="prop-whys">${props.map((p) => `<details class="prop-why"><summary><span class="pw-l">${teamLogo(p.tid, { size: "xs" })}</span><span class="pw-t"><b>${esc(p.n)}</b> ${propReason(p)}</span></summary><div class="pbody">${scenarioBlock(p, g, p.tid === home.tid ? away.tid : home.tid)}${skillSlot(p.id, p.tid === home.tid ? away.tid : home.tid)}</div></details>`).join("")}</div>
    <p class="small muted">Each line is set at our projection, so "over" sits near 50%. The line under each player says why his projection sits above or below his season average; tap it for every reason. For points the chance uses the player's own 80% range; rebounds, assists and threes use a typical spread for that average.</p>` : ""}
  </section>`;
}

function gameCard(g) { return gameCardNew(g); }
function gameCardOld(g) {
  const hFav = g.pred.pHome >= 0.5, ph = g.pred.pHome;
  const Lg = gameLines(g);
  const row = (tid, sc, fav) => `<div class="g-row ${fav ? "" : "lose"}">${teamLogo(tid, { size: "md" })}<span class="name">${esc(T(tid).name)}</span><span class="sc">${f0(sc)}</span></div>`;
  const out = [...(g.out?.[0] || []), ...(g.out?.[1] || [])];
  const top = [g.top?.[1]?.[0], g.top?.[0]?.[0]].filter(Boolean)
    .map((p) => `<span class="pchip">${avatar(p.id ?? pid(p.n), p.n, { size: "sm" })}<span class="pchip-n">${pname(p.n)}</span><span class="pts"><b>${f0(p.pts)}</b> pts</span></span>`).join("");
  // Top reason each side can win (away first, like the rows above), then how much history backs the game page.
  const keys = [g.away, g.home].map((tid) => [tid, (g.keys || []).find((k) => k.tid === tid)?.win?.[0]]).filter(([, t]) => t);
  const why = keys.length ? `<span class="lbl">Top reason each side can win</span><div class="g-why">${keys.map(([tid, t]) => `<div>${teamLogo(tid, { size: "xs" })}<p><b>${esc(T(tid).abbr)}</b> ${esc(briefReason(t))}</p></div>`).join("")}</div>` : "";
  const rec = g.h2h?.n ? Object.entries(g.h2h.record || {}).sort((a, b) => b[1] - a[1]) : null;
  const hist = [rec ? `${g.h2h.n} previous ${g.h2h.n === 1 ? "meeting" : "meetings"} (${rec[0][1] === rec[1]?.[1] ? "split " : esc(T(rec[0][0]).abbr) + " "}${esc(rec[0][1])}-${esc(rec[1]?.[1] ?? 0)})` : "", g.scenarios ? `${esc(g.scenarios)} provable scenarios` : ""].filter(Boolean).join(" · ");
  const foot = `${top ? `<span class="lbl">Projected top scorers</span><div class="g-scorers">${top}</div>` : ""}${out.length ? `<div class="g-out">Key absences: ${esc(out.join(", "))}</div>` : ""}${why}${hist ? `<div class="g-hist">${hist}</div>` : ""}`;
  return `<a class="card" href="#/game/${esc(g.id)}">
    <div class="g-top"><span class="when">${esc(timePH(g.date))}${g.phase.includes("Regular") ? "" : " · " + esc(g.phase.replace(/^\S+ /, ""))}${isFav("t", g.home) || isFav("t", g.away) ? ` <span class="fav-mark" aria-label="favourite team">★</span>` : ""}</span>
      ${outsFor(g.id).size ? `<span class="chip bad">You marked ${outsFor(g.id).size} out: open for adjusted numbers</span>` : g.upset?.flag ? `<span class="chip warn">⚠ Upset watch</span>` : `<span>Projected score</span>`}</div>
    ${row(g.away, g.pred.as, !hFav)}${row(g.home, g.pred.hs, hFav)}
    <div class="wp" aria-hidden="true"><span class="${hFav ? "" : "fav"}" style="flex:${1 - ph}"></span><span class="${hFav ? "fav" : ""}" style="flex:${ph}"></span></div>
    <div class="wp-l"><span>${esc(T(g.away).abbr)} ${pct(1 - ph)}</span><span>${esc(T(g.home).abbr)} ${pct(ph)} (home)</span></div>
    <div class="g-lines"><span><i>Spread</i> ${esc(T(Lg.fav).abbr)} ${spreadTxt(Lg.spread)}</span><span><i>Moneyline</i> ${esc(T(Lg.fav).abbr)} ${mlTxt(Lg.pFav)}</span><span><i>Total</i> ${Lg.total.toFixed(1)}</span></div>
    ${foot ? `<div class="g-foot">${foot}</div>` : ""}
  </a>`;
}

// ---- Who's playing: the visitor can mark players out (late scratches the last data refresh missed).
// The game is then re-projected here in the browser: minutes and shots go to teammates, team totals,
// win chance, spread, moneyline, total and props all follow. Stored on this device only.
const OUT_KEY = "outs";
function outsAll() { try { return JSON.parse(localStorage.getItem(OUT_KEY) || "{}") || {}; } catch { return S.outsMem || {}; } }
function outsFor(gid) { return new Set((outsAll()[gid] || []).map(String)); }
function setOuts(gid, set) { const a = outsAll(); if (set.size) a[gid] = [...set]; else delete a[gid]; S.outsMem = a; try { localStorage.setItem(OUT_KEY, JSON.stringify(a)); } catch { /* private mode: this visit only */ } }
const posG = (pos = "") => (/C/i.test(pos) ? "C" : /G/i.test(pos) ? "G" : "F");
async function adjustGame(raw, outs) {
  if (!outs.size) return raw;
  const g = structuredClone(raw); g.adjusted = [];
  const pace = g.pred.pace || 100, m0 = raw.pred.hs - raw.pred.as, p0 = Math.min(0.995, Math.max(0.005, raw.pred.pHome));
  let slope = Math.abs(m0) > 0.5 ? Math.log(p0 / (1 - p0)) / m0 : (S.learning?.params?.at(-1)?.slope || 0.13);
  slope = Math.min(0.25, Math.max(0.06, slope || 0.13));
  let dH = 0, dA = 0;
  for (const t of g.teams) {
    const gone = t.players.filter((p) => outs.has(String(p.id)));
    if (!gone.length) continue;
    const rest = t.players.filter((p) => !outs.has(String(p.id)));
    for (const x of gone) {
      // 1. his minutes go to teammates, more to players at his position
      const w = rest.map((p) => ({ p, w: Math.max(p.min, 1) * (posG(p.pos) === posG(x.pos) ? 1.6 : 1) })), W = w.reduce((s, q) => s + q.w, 0) || 1;
      let gained = 0;
      for (const { p, w: wi } of w) {
        const newMin = Math.min(42, p.min + (x.min * wi) / W), f = p.min > 0 ? newMin / p.min : 1;
        gained += (p.pts || 0) * (f - 1);
        for (const k of ["pts", "reb", "ast", "tpm", "tpa", "stl", "blk"]) if (p[k] != null) p[k] *= f;
        if (p.lo != null) { p.lo = Math.round(p.lo * f); p.hi = Math.round(p.hi * f); }
        p.min = newMin; if (newMin - x.min * 0 > 0 && f > 1.02) (p.gainFrom ||= []).push(x.n);
      }
      // 2. replacements score less efficiently than the player they replace
      const formula = -(x.pts || 0) + gained * 0.85;
      // 3. blend with what really happened in games he missed, when there are enough of them
      let measured = null;
      try {
        const ab = (await load(`players/${x.id}.json`)).absence;
        if (ab && ab.with >= 8 && ab.without >= 3 && ab.offSwing != null) measured = { own: (-ab.offSwing * pace) / 100, opp: ((ab.defSwing || 0) * pace) / 100, n: ab.without };
      } catch { /* no profile */ }
      const own = measured ? (formula + measured.own) / 2 : formula, opp = measured ? measured.opp * 0.5 : 0;
      if (t.isHome) { dH += own; dA += opp; } else { dA += own; dH += opp; }
      g.adjusted.push({ id: x.id, n: x.n, tid: t.tid, min: x.min, pts: x.pts, own, opp, measured });
    }
    t.players = rest; t.marked = gone;
  }
  const hs = raw.pred.hs + dH, as = raw.pred.as + dA, m = hs - as, sd = 1.7 / slope;
  const within = (k) => pNorm((k - m) / sd) - pNorm((-k - m) / sd);
  g.pred = { ...g.pred, hs, as, pHome: 1 / (1 + Math.exp(-slope * m)), close: within(5), blowout: 1 - within(15) };
  for (const t of g.teams) t.pts = t.isHome ? hs : as;
  return g;
}
function playingCard(raw, g, outs) {
  const team = (t) => {
    const rows = t.players.filter((p) => p.min >= 4);
    return `<div class="who-t"><h3>${teamName(t.tid, { text: "short" })}</h3><div class="chips">${rows.map((p) => {
      const off = outs.has(String(p.id));
      return `<button class="fbtn who-b" type="button" data-out="${esc(p.id)}" aria-pressed="${off}">${off ? "✕ " : ""}${esc(shortName(p.n))}${p.q ? " (Q)" : ""}</button>`;
    }).join("")}</div></div>`;
  };
  const [home, away] = [raw.teams.find((t) => t.isHome), raw.teams.find((t) => !t.isHome)];
  const adj = g.adjusted || [];
  return `<section class="card who" id="g-who" aria-labelledby="g-who-h"><h2 id="g-who-h">Who's playing tonight?</h2>
    <p class="small muted">Tap a player who was ruled out late. The whole game recalculates on this device: minutes, stats, win chance, lines and props.</p>
    ${team(away)}${team(home)}
    ${adj.length ? `<div class="note"><b>Adjusted for: ${adj.map((x) => esc(x.n)).join(", ")} out.</b><ul class="dots small">${adj.map((x) => `<li>${esc(x.n)} (${f0(x.min)} min, ${f1(x.pts)} pts projected): ${esc(T(x.tid).abbr)} ${sg(x.own)} pts${x.opp ? `, opponent ${sg(x.opp)} pts` : ""}${x.measured ? ` (blends the model's redistribution with ${x.measured.n} real games he missed)` : " (from redistributing his minutes; not enough games without him to measure directly)"}.</li>`).join("")}</ul>
      <p class="small" style="margin:6px 0 0">The simulation lab and the high-confidence board still show the original projection, because they need the full engine; the next data refresh includes the change once the injury report lists it.</p>
      <button class="btn" type="button" data-out-reset="1">Reset to the original projection</button></div>` : ""}
  </section>`;
}

async function vGame(id) {
  const raw = await load(`upcoming/${id}.json`);
  const outs = outsFor(id);
  try { S.learning = S.learning || await load("learning.json"); } catch { S.learning = null; }
  const g = await adjustGame(raw, outs);
  S.curGame = g; S.curRaw = raw;
  const simRow = await load("sim/index.json").then((ix) => { const r = ix.games?.find((x) => x.id === g.id); return r ? { ...r, sims: ix.sims } : null; }, () => null);
  const [home, away] = [g.teams.find((t) => t.isHome), g.teams.find((t) => !t.isHome)];
  const ph = g.pred.pHome, fav = ph >= 0.5 ? home : away, favP = Math.max(ph, 1 - ph);
  const shares = g.models.reduce((s, m) => s + m.weight, 0) || 1;
  app.innerHTML = `<div class="gbar"><a class="gbar-b" href="#/games" aria-label="Back to games">‹ Back</a><b>${esc(T(away.tid).abbr)} @ ${esc(T(home.tid).abbr)}</b><span></span></div>
    <h1 class="vh">${esc(T(away.tid).name)} at ${esc(T(home.tid).name)}: projection</h1>
    <div class="card hero hero2">
      <div class="h2-row">
        <a class="h2-side" href="#/team/${esc(away.tid)}">${teamLogo(away.tid, { size: "lg" })}<span><b>${esc(T(away.tid).abbr)}</b><strong>${f1(g.pred.as)}</strong></span></a>
        <div class="h2-mid"><span>🕙 ${esc(time(g.date))}</span><span class="small muted">${esc(fmtD(g.date, { month: "short", day: "numeric" }))} · PH</span></div>
        <a class="h2-side r" href="#/team/${esc(home.tid)}"><span><b>${esc(T(home.tid).abbr)}</b><strong>${f1(g.pred.hs)}</strong></span>${teamLogo(home.tid, { size: "lg" })}</a>
      </div>
      <div class="h2-wc"><div><small>Win chance</small><strong>${pct(1 - ph)}</strong></div><div class="wp" aria-hidden="true"><span style="flex:${1 - ph}"></span><span style="flex:${ph}"></span></div><div class="r"><small>${esc(T(home.tid).short)}</small><strong>${pct(ph)}</strong></div></div>
      <p class="small muted" style="margin:8px 0 0;text-align:center">Projected score · <b>${esc(T(fav.tid).name)}</b> favoured (${pct(favP)})${g.venue ? " · " + esc(g.venue) : ""}</p>
      <div class="chips" style="justify-content:center;margin-top:8px">
        <span class="chip ${g.conf.grade === "High" ? "good" : g.conf.grade === "Low" ? "bad" : "info"}">Confidence: ${esc(g.conf.grade)}</span>
        <span class="chip">Close game (within 5): ${pct(g.pred.close)}</span>
        <span class="chip">Blowout (15+): ${pct(g.pred.blowout)}</span>
        ${g.upset.flag ? `<span class="chip warn">⚠ Upset watch</span>` : ""}
      </div>
      ${g.conf.why.length ? `<p class="small muted" style="margin-top:8px">Why confidence is not higher: ${esc(g.conf.why.join("; "))}.</p>` : ""}
    </div>
    ${playingCard(raw, g, outs)}
    ${gameLabCard(g, simRow)}
    <nav class="filters jumpnav" aria-label="Sections of this game">${[["g-q", "Quarters", away.quarters?.proj], ["g-lines", "Lines", true], ["g-keys", "Why win or lose", g.keys?.teams?.length], ["g-scn", "Scenarios", true], ["g-h2h", "Meetings", true], ["g-players", "Players", true]].filter((x) => x[2]).map(([k, l]) => `<button class="fbtn" type="button" data-jump="${k}">${l}</button>`).join("")}</nav>
    ${quarterCard(g, away, home)}
    ${linesCard(g, away, home)}

    ${g.keys?.teams?.length ? `<section class="card" id="g-keys" tabindex="-1" aria-labelledby="g-keys-h"><h2 id="g-keys-h">Why each team can win or lose</h2>
      <p class="small muted">Edges found in the numbers before tip-off, strongest first, each with its evidence and sample. They explain the matchup; the forecast is the projection above. A team's reasons to lose are the other side's edges.</p>
      <div class="filters" role="group" aria-label="Choose a team">${[away, home].map((t) => `<button class="fbtn" type="button" data-kt="${esc(t.tid)}" aria-pressed="false">${esc(T(t.tid).short)}</button>`).join("")}</div>
      <div id="keys-out"></div>
      <p class="small muted" style="margin-top:10px">"On paper" zone edges assume each team's zone percentages carry over in full. The <a href="#/why">Why page</a> shows how much of that the back-test supports.</p>
      <div class="jump">${g.scenarios?.list?.length ? `<button class="btn" type="button" data-jump="g-scn">${g.scenarios.list.length} provable scenarios</button>` : ""}${g.h2h?.games?.length ? `<button class="btn" type="button" data-jump="g-h2h">${g.h2h.games.length} previous ${g.h2h.games.length === 1 ? "meeting" : "meetings"}</button>` : ""}</div>
    </section>` : ""}

    ${g.upset.reasons.length ? `<div class="card"><h2>${g.upset.flag ? "⚠ Upset watch" : "Things that favour the underdog"}</h2>
      <p class="small muted">The underdog wins this about ${pct(g.upset.dogP)} of the time by the numbers.${S.learning?.upsetShrink?.applied ? ` Flagged games have been close to coin flips (the favourite won about 47% of them), so the win chance shown for this game is already pulled ${Math.round((S.learning.upsetShrink.shrink || 0) * 100)}% of the way toward 50%, a rule learned game by game from past flagged games only.` : ""}</p>
      <ul class="dots">${g.upset.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}

    ${g.scenarios?.list?.length ? `<section class="card" id="g-scn" tabindex="-1" aria-labelledby="g-scn-h"><h2 id="g-scn-h">Provable scenarios</h2>
      <p class="small muted">If-then statements counted from finished games: these teams' previous meetings, each team's record in this kind of spot, and players' history against this opponent. Every line shows how many games stand behind it and links to them. Small samples (3 or 4 games) are patterns to watch, not facts.</p>
      <div id="scn-out"></div>
    </section>` : `<section class="card" id="g-scn"><h2>Provable scenarios</h2><p class="small muted">No if-then statement reached the minimum sample for this matchup yet (3 meetings, 5 team games or 3 player games).</p></section>`}
    ${h2hCard(g)}
    ${zoneBattleCard(g)}

    <div class="card"><h2>How the margin was built</h2>
      <p class="small muted">Five independent rating systems each give a margin for the home team. The back-test decides how much say each one gets.</p>
      <div class="tw"><table><thead><tr><th>Rating system</th><th class="n">Home margin</th><th class="n">Say</th></tr></thead><tbody>
        ${g.models.map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${sg(m.margin)}</td><td class="n">${pct(m.weight / shares)}</td></tr>`).join("")}
      </tbody></table></div>
      ${(() => { const M = Object.fromEntries((g.models || []).map((m) => [m.k, m.margin])); if (M.players == null) return ""; const teamAvg = ["efficiency", "elo", "adjusted", "luckAdjusted"].map((k) => M[k]).filter((v) => v != null); if (!teamAvg.length) return ""; const avg = teamAvg.reduce((a, b) => a + b, 0) / teamAvg.length, gap = M.players - avg;
        return Math.abs(gap) >= 3 ? `<p class="note"><b>Roster check:</b> the player-by-player system (tonight's actual players) has the home margin at ${sg(M.players)}, ${f1(Math.abs(gap))} points ${gap < 0 ? "lower" : "higher"} than the team-level systems (${sg(avg)}). Something about the roster or rotation may differ from recent games, so lean on the player view and check the injury report. (We tested weighting it more automatically: it helped early this season but not over the full 2025-26 season, so it is a warning, not an automatic change.)</p>` : ""; })()}
      ${g.ref ? `<p class="note">Referee crew (${esc(g.ref.crew.join(", "))}): games with this crew have run ${sg(g.ref.tot)} total points versus projection.</p>` : ""}
      <p class="small muted" style="margin-top:8px">Projected pace: ${f1(g.pred.pace)} possessions.</p>
    </div>

    <div class="grid two">${[away, home].map((t) => teamSide(t)).join("")}</div>
    <div id="g-players" tabindex="-1" class="anchor"></div>
    ${playersCard(away, home.tid)}${playersCard(home, away.tid)}

    <div class="card"><h2>What if a player sits?</h2>
      <p class="small muted">Pick a player to see how this team, his teammates and opposing players at his position have actually done in games he missed.</p>
      <select class="field" id="whatif" aria-label="Choose a player">
        <option value="">Choose a player...</option>
        ${[away, home].map((t) => `<optgroup label="${esc(T(t.tid).name)}">${t.players.filter((p) => p.min >= 18).slice(0, 9).map((p) => `<option value="${esc(p.id)}">${esc(p.n)}</option>`).join("")}</optgroup>`).join("")}
      </select>
      <div id="whatif-out" style="margin-top:10px"></div>
    </div>

    ${g.news.length ? `<div class="card"><h2>Latest coverage</h2>${g.news.map(takeRow).join("")}</div>` : ""}`;

  // Why each team can win or lose: one team at a time, so each list is read as that team's reasons.
  const keysOut = document.getElementById("keys-out");
  if (keysOut) {
    const drawKeys = (tid) => {
      const k = g.keys.teams.find((x) => x.tid === tid) || g.keys.teams[0], name = esc(T(k.tid).short);
      keysOut.innerHTML = `<div class="grid two why-g">
        <section><h3><span class="why-s" aria-hidden="true">+</span> Why ${name} can win</h3>${reasonList(k.win, `No clear edge for ${name} was found in the numbers.`)}</section>
        <section><h3><span class="why-s" aria-hidden="true">−</span> Why ${name} can lose</h3>${reasonList(k.lose, `No clear edge against ${name} was found in the numbers.`)}</section></div>`;
      app.querySelectorAll("[data-kt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kt === k.tid)));
    };
    app.querySelectorAll("[data-kt]").forEach((b) => b.addEventListener("click", () => drawKeys(b.dataset.kt)));
    drawKeys(fav.tid);
  }

  // Provable scenarios: filter by what is already known and by which side a line favours.
  const scnOut = document.getElementById("scn-out");
  if (scnOut) {
    if (S.scnGame !== g.id) { S.scnGame = g.id; S.scnF = "all"; S.scnShown = 8; }
    const list = g.scenarios.list, tests = { all: () => true, known: (s) => s.known, cond: (s) => !s.known, [`fav:${away.tid}`]: (s) => s.fav === away.tid, [`fav:${home.tid}`]: (s) => s.fav === home.tid };
    const drawScn = (focus) => {
      const rows = list.filter(tests[S.scnF] || tests.all), opts = [["all", "All"], ["known", "Already true for this game"], ["cond", "Only if it happens"], [`fav:${away.tid}`, `Favours ${T(away.tid).abbr}`], [`fav:${home.tid}`, `Favours ${T(home.tid).abbr}`]];
      scnOut.innerHTML = `<div class="filters" role="group" aria-label="Filter scenarios">${opts.map(([k, l]) => `<button class="fbtn" type="button" data-sf="${esc(k)}" aria-pressed="${S.scnF === k}">${esc(l)} <span class="cnt">${list.filter(tests[k]).length}</span></button>`).join("")}</div>
        <ul class="scns">${rows.slice(0, S.scnShown).map(scenarioItem).join("") || `<li class="empty">No scenario in this filter.</li>`}</ul>
        ${rows.length > S.scnShown ? `<button class="btn block" type="button" id="scn-more">Show ${rows.length - S.scnShown} more</button>` : ""}
        <p class="small muted" style="margin-top:10px">${g.scenarios.total > list.length ? `${esc(g.scenarios.total)} statements passed the minimum sample; the ${list.length} strongest are listed. ` : ""}Minimum sample: ${esc(g.scenarios.min?.h2h ?? 3)} meetings, ${esc(g.scenarios.min?.team ?? 5)} team games, ${esc(g.scenarios.min?.player ?? 3)} player games. Records since October 2025.</p>`;
      scnOut.querySelectorAll("[data-sf]").forEach((b) => b.addEventListener("click", () => { S.scnF = b.dataset.sf; S.scnShown = 8; drawScn(`[data-sf="${CSS.escape(S.scnF)}"]`); }));
      document.getElementById("scn-more")?.addEventListener("click", () => { const from = S.scnShown; S.scnShown = rows.length; drawScn(`.scn:nth-child(${from + 1})`); });
      if (focus) { const el = scnOut.querySelector(focus); if (el) { if (!el.matches("button")) el.tabIndex = -1; el.focus({ preventScroll: true }); } }
    };
    drawScn();
  }

  document.getElementById("whatif").addEventListener("change", async (e) => {
    const out = document.getElementById("whatif-out");
    if (!e.target.value) { out.innerHTML = ""; return; }
    out.innerHTML = `<p class="muted small">Loading...</p>`;
    try { const p = await load(`players/${e.target.value}.json`); out.innerHTML = `<div class="prow-i" style="align-items:center;margin-bottom:10px">${avatar(p.id, p.n, { size: "lg", team: p.team })}<div><b>${esc(p.n)}</b><div class="small muted">${esc(T(p.team).name)}${p.pos ? " · " + esc(p.pos) : ""}</div></div></div>` + absenceBlock(p) + `<p class="small"><a class="go" href="#/player/${esc(p.id)}">Open ${esc(p.n)}'s full profile ›</a></p>`; }
    catch { out.innerHTML = `<p class="muted small">No profile for this player yet.</p>`; }
  });
}
// One side of the big matchup header: logo, team name, big number, small caption. Links to the team page.
function heroSide(tid, big, caption) {
  return `<a class="side" href="#/team/${esc(tid)}">${teamLogo(tid, { size: "lg" })}<span class="side-n">${esc(T(tid).short)}</span><span class="big">${esc(big)}</span><span class="small muted">${esc(caption)}</span></a>`;
}

// ---- upcoming game: reasons, provable scenarios, previous meetings, zone battle
const KEY_KIND = { ratings: "Ratings", home: "Home court", zone: "Zone battle", fourFactors: "Four factors", pace: "Pace", situation: "Schedule spot", style: "Opponent style", absence: "Absence", form: "Recent form", h2h: "Previous meetings", player: "Player matchup" };
const SCN_KIND = { h2h: "Previous meetings", team: "Team pattern", teamIf: "Team pattern", schedule: "Schedule spot", style: "Opponent style", absence: "Absence", player: "Player history", form: "Recent form" };
function reasonList(items, empty) {
  if (!items?.length) return `<p class="small muted">${empty}</p>`;
  const li = (k) => `<li><span class="why-k">${esc(KEY_KIND[k.kind] || k.kind || "Edge")}</span><p>${esc(k.t)}</p>${k.n ? `<span class="small muted">Sample: ${esc(k.n)}</span>` : ""}</li>`;
  const first = items.slice(0, 4), rest = items.slice(4);
  return `<ol class="why-l">${first.map(li).join("")}</ol>${rest.length ? `<details class="more"><summary>${rest.length} more ${rest.length === 1 ? "reason" : "reasons"}</summary><ol class="why-l" start="5">${rest.map(li).join("")}</ol></details>` : ""}`;
}
function scenarioItem(s, _i, _all, scoutLink = true) {
  const sample = s.sample || sampleWord(s.n), n = `${esc(num(s.n))} ${s.n === 1 ? "game" : "games"}`;
  const sChip = sample === "small" ? `<span class="chip warn">Small sample · ${n}</span>` : sample === "moderate" ? `<span class="chip">Moderate sample · ${n}</span>` : `<span class="chip good">Solid sample · ${n}</span>`;
  const who = s.pid ? S.P[s.pid] : null;
  return `<li class="scn">${s.pid ? avatar(s.pid, who?.n || "Player", { size: "sm" }) : ""}<div class="scn-b">
    <span class="why-k">${esc(SCN_KIND[s.kind] || "Scenario")}</span>
    <p class="scn-t">${esc(s.t)}</p>
    ${s.ev ? `<p class="small muted">${esc(s.ev)}</p>` : ""}
    <div class="chips">${sChip}${s.fav && S.T[s.fav] ? `<span class="chip info">Favours ${esc(T(s.fav).abbr)}</span>` : `<span class="chip">Favours neither side</span>`}<span class="chip">${s.known ? "Already true for this game" : "Only if it happens"}</span></div>
    ${gameLinks(s.games, s.n)}${who && scoutLink ? `<a class="go" href="#/scout/${esc(s.pid)}">Scout ${esc(who.n)} ›</a>` : ""}
  </div></li>`;
}
function h2hGame(m) {
  const sc = (tid, pts) => `<span class="h2h-t${m.winner === tid ? " w" : ""}">${teamName(tid, { text: "abbr" })}<span class="num">${esc(pts)}</span></span>`;
  const head = `<span class="h2h-d">${esc(dayY(m.date))} · ${esc(m.phase)}${m.pre ? " · not counted in the record" : ""}</span>
    <span class="h2h-s">${sc(m.away, m.as)}<span class="muted">at</span>${sc(m.home, m.hs)}${m.ot ? `<span class="muted">${m.ot > 1 ? esc(m.ot) : ""}OT</span>` : ""}</span>`;
  const pair = (a, f = (x) => esc(x)) => (Array.isArray(a) ? `<td class="n">${f(a[1])}</td><td class="n">${f(a[0])}</td>` : `<td class="n">-</td><td class="n">-</td>`); // data is [home, away]; the table shows away first
  const ma = (x) => (Array.isArray(x) ? `${esc(x[0])}/${esc(x[1])}` : "-");
  const fav = m.pred ? (m.pred.pHome >= 0.5 ? m.home : m.away) : null;
  return `<li class="h2h-g">
    ${m.pred ? `<a class="h2h-a" href="#/result/${esc(m.id)}" aria-label="${esc(`${T(m.away).abbr} ${m.as} at ${T(m.home).abbr} ${m.hs}, ${dayY(m.date)}: open the full result`)}">${head}<span class="go">Full result ›</span></a>` : `<div class="h2h-a">${head}</div>`}
    <div class="chips">${m.pred ? `<span class="chip ${m.called ? "good" : "bad"}">${m.called ? "✓ Winner called" : "✗ Winner missed"}</span><span class="chip">Projected ${esc(T(fav).abbr)} ${pct(Math.max(m.pred.pHome, 1 - m.pred.pHome))} · margin off by ${f1(m.marginErr)}</span>` : `<span class="chip">Not projected (too early in the data)</span>`}${m.clutch ? `<span class="chip">Within 5 in the last 5 minutes</span>` : ""}</div>
    ${m.edges ? `<p class="small">${esc(m.edges)}</p>` : ""}${m.decided ? `<p class="small muted">${esc(m.decided)}</p>` : ""}
    <details class="more"><summary>Game numbers</summary><div class="tw"><table><thead><tr><th>Stat</th><th class="n">${esc(T(m.away).abbr)}</th><th class="n">${esc(T(m.home).abbr)}</th></tr></thead><tbody>
      <tr><td>Points by period</td>${pair(m.q, (q) => esc((q || []).join(", ")))}</tr>
      <tr><td>Threes made / tried</td>${pair(m.tp, ma)}</tr><tr><td>Free throws made / tried</td>${pair(m.ft, ma)}</tr>
      <tr><td>Rebounds</td>${pair(m.reb)}</tr><tr><td>Turnovers</td>${pair(m.tov)}</tr><tr><td>Points in the paint</td>${pair(m.paint)}</tr><tr><td>Largest lead</td>${pair(m.lead)}</tr>
    </tbody></table></div><p class="small muted">${m.lc != null ? `${esc(m.lc)} lead ${m.lc === 1 ? "change" : "changes"}. ` : ""}${m.swing ? `Biggest quarter: Q${esc(m.swing.q)}, ${esc(T(m.swing.t).abbr)} by ${esc(m.swing.by)}.` : ""}</p></details>
  </li>`;
}
function h2hCard(g) {
  const h = g.h2h;
  if (!h?.games?.length) return `<section class="card" id="g-h2h"><h2>Previous meetings</h2><p class="small muted">These teams have not met since October 2025, so there are no previous meetings to count.</p></section>`;
  const rec = Object.entries(h.record || {}).sort((a, b) => b[1] - a[1]), first = h.games.slice(0, 4), rest = h.games.slice(4);
  return `<section class="card" id="g-h2h" tabindex="-1" aria-labelledby="g-h2h-h"><h2 id="g-h2h-h">Previous meetings</h2>
    ${h.n ? `<div class="statgrid h2h-rec">${rec.map(([tid, w]) => `<div class="stat"><b>${esc(w)}</b><span>${esc(T(tid).abbr)} wins</span></div>`).join("")}<div class="stat"><b>${esc(h.n)}</b><span>${h.n === 1 ? "meeting" : "meetings"} since Oct 2025</span></div></div>` : ""}
    ${h.patterns?.length ? `<ul class="dots small" style="margin-top:10px">${h.patterns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <p class="small muted" style="margin-top:8px">Every meeting in the data, newest first. "Called" is the projection made before that game, using only what was known then.${h.preseason ? ` ${esc(h.preseason)} preseason ${h.preseason === 1 ? "game is" : "games are"} listed but not counted.` : ""}${h.n > 0 && h.n < 5 ? ` ${esc(h.n)} ${h.n === 1 ? "meeting is" : "meetings are"} a small sample.` : ""}</p>
    <ul class="h2h-l">${first.map(h2hGame).join("")}</ul>
    ${rest.length ? `<details class="more"><summary>${rest.length} earlier ${rest.length === 1 ? "meeting" : "meetings"}</summary><ul class="h2h-l">${rest.map(h2hGame).join("")}</ul></details>` : ""}
  </section>`;
}
function zoneBattleCard(g) {
  const m = g.matchup; if (!m?.zones?.length) return "";
  const rk = (v, r, f = p1) => `${f(v)}${r ? ` <span class="muted">${esc(ord(r))}</span>` : ""}`;
  const zt = (z) => `<details class="more"><summary>${esc(T(z.off).abbr)} shooting against the ${esc(T(z.def).abbr)} defence, by zone</summary><div class="tw"><table>
    <thead><tr><th>Zone</th><th class="n">Share of shots</th><th class="n">${esc(T(z.off).abbr)} FG%</th><th class="n">${esc(T(z.def).abbr)} allows</th><th class="n">League</th><th class="n">On paper</th></tr></thead>
    <tbody>${z.rows.map((r) => `<tr><td>${esc(zoneLabel(r.z))}</td><td class="n">${rk(r.share, r.shareRank)}</td><td class="n">${rk(r.pct, r.pctRank)}</td><td class="n">${rk(r.allowed, r.allowedRank)}</td><td class="n">${p1(r.lg)}</td><td class="n">${sg(r.paper)} pts</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">${esc(num(z.rows.reduce((s, r) => s + (r.att || 0), 0)))} shots taken and ${esc(num(z.rows.reduce((s, r) => s + (r.attAllowed || 0), 0)))} allowed. Share rank 1 = takes the most there; FG% rank 1 = best; allowed rank 1 = lowest.</p></details>`;
  const ft = m.factors?.length ? `<details class="more"><summary>Shooting, turnovers, rebounding, free throws, threes and early offence</summary><div class="tw"><table>
    <thead><tr><th>Measure</th><th class="n">Offence</th><th class="n">Defence</th></tr></thead>
    <tbody>${m.factors.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${esc(T(r.off).abbr)} ${rk(r.offVal, r.offRank, f1)}</td><td class="n">${esc(T(r.def).abbr)} ${rk(r.defVal, r.defRank, f1)}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">Rank 1 = best for the offence in its column, best for the defence in the other.</p></details>` : "";
  return `<div class="card"><h2>The numbers behind the zone battle</h2>
    <p class="small muted">Where each team takes and makes its shots against what the other allows (${esc(m.window || m.scope || "both seasons")}). "On paper" is points a game if those percentages carried over in full, which the back-test only partly supports.</p>
    ${m.zones.map(zt).join("")}${ft}</div>`;
}
// The zone matchup of one projected player, as written-out tags plus a short line. zm.tag wording comes from the model.
const ZONE_AT = { rim: "at the rim", paint: "in the paint", mid: "from mid-range", c3: "on corner threes", atb: "on above-the-break threes" };
const STAT_UNIT = { pts: "pts", reb: "reb", ast: "ast", tpa: "3PA", min: "min" };
function zmTags(tag) {
  const t = String(tag ?? "");
  return `${/hot spot/.test(t) ? ztag("hot") : ""}${/cold spot/.test(t) ? ztag("cold") : ""}${/soft spot/.test(t) ? ztag("soft") : ""}${/strong spot/.test(t) ? ztag("strong") : ""}`;
}
function zmLine(zm) {
  if (!zm) return "";
  const where = ZONE_AT[zm.zone] || zoneLabel(zm.zone), tags = zmTags(zm.tag);
  const phrase = { "hot spot meets soft spot": "his hot spot, their soft spot", "cold spot meets strong spot": "his cold spot, their strong spot", "soft spot": "their soft spot", "strong spot": "their strong spot" }[zm.tag] || String(zm.tag ?? "");
  return `<span class="zm-l">${tags ? `${tags} ${esc(phrase)} ${esc(where)}` : "No clear zone edge"} · on paper ${sg(zm.paper, 2)}, applied ${sg(zm.applied, 2)} pts</span>`;
}
function zmBlock(p, oppTid) {
  const zm = p.zm, fx = p.fx || [];
  if (!zm && !fx.length) return "";
  return `<h4>Zone matchup tonight</h4>
    ${zm ? `<p>${zmTags(zm.tag)} ${esc(zm.txt)}</p>
      <div class="tw"><table class="ztable"><thead><tr><th>Zone</th><th class="n">His shots<i>a game</i></th><th class="n">${esc(T(oppTid).abbr)} allows<i>vs league</i></th><th class="n">On paper</th></tr></thead>
      <tbody>${(zm.zones || []).map(([z, att, od, pp]) => `<tr><td>${esc(ZONE_SHORT[z] || zoneLabel(z))}</td><td class="n">${f1(att)}</td><td class="n">${sg(od)}</td><td class="n">${sg(pp, 2)} pts</td></tr>`).join("")}</tbody></table></div>
      ${zm.rimDefenders?.length ? `<p>Likely rim defenders (FG% allowed inside 6 ft versus what those shooters normally make): ${zm.rimDefenders.map((d) => `${esc(d.n)} ${sg(d.diff)} on ${esc(num(d.fga))} shots`).join("; ")}.${zm.perimeter ? ` Likely perimeter defenders on threes: ${sg(zm.perimeter.diff)} on ${esc(num(zm.perimeter.fga))} shots.` : ""}</p>` : ""}
      <p>On paper this is worth ${sg(zm.paper, 2)} points; the model applies <b>${sg(zm.applied, 2)}</b>, because the back-test supports only part of a paper edge.</p>` : ""}
    ${fx.length ? `<p>Learned matchup factors inside this projection: ${fx.map((x) => `${esc(x.label)} ${sg(x.v, 2)} ${esc(STAT_UNIT[x.stat] || x.stat)}`).join("; ")}.</p>` : ""}
    <a class="go" href="#/scout/${esc(p.id)}/${esc(oppTid)}">Open this matchup in Scout ›</a>`;
}

function schedBits(s) {
  const b = [];
  b.push(s.b2b ? "Second night of a back-to-back" : s.rest >= 3 ? `${s.rest} days of rest` : s.rest === 1 ? "1 day of rest" : `${s.rest} days of rest`);
  if (s.threeIn4) b.push("3rd game in 4 nights");
  if (s.travel >= 500) b.push(`${s.travel.toLocaleString()} miles travelled since last game`);
  if (Math.abs(s.tz) >= 2) b.push(`Crossed ${Math.abs(s.tz)} time zones ${s.tz > 0 ? "east" : "west"}`);
  if (s.altitude) b.push("Playing at altitude");
  if (s.roadStreak >= 3) b.push(`${s.roadStreak} straight road games before this`);
  if (s.streak >= 3) b.push(`Won ${s.streak} in a row`); if (s.streak <= -3) b.push(`Lost ${-s.streak} in a row`);
  if (s.lastMargin != null && Math.abs(s.lastMargin) >= 20) b.push(s.lastMargin > 0 ? "Coming off a blowout win" : "Coming off a blowout loss");
  if (s.lastOT) b.push("Played overtime last game");
  return b;
}
function teamSide(t) {
  const scen = t.scen.filter((s) => Math.abs(s.w) >= 0.3 && s.n >= 20).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 6);
  return `<div class="card"><div class="card-h"><h2>${teamName(t.tid, { text: "short" })}</h2><a class="go" href="#/team/${esc(t.tid)}">Team page ›</a></div>
    <div class="chips" style="margin:4px 0 10px">${t.style.tags.map((x) => `<span class="chip">${esc(x)}</span>`).join("") || `<span class="chip">Balanced style</span>`}</div>
    <dl class="kv">
      <dt>Offence / defence (pts per 100)</dt><dd>${f1(t.style.off)} / ${f1(t.style.def)}</dd>
      <dt>Projected points</dt><dd><b>${f1(t.pts)}</b></dd>
    </dl>
    ${t.trust ? `<p class="small" style="margin-top:8px">${trustChip(t.trust) || `<span class="chip">${esc(TRUST[t.trust.label]?.[1] || "Trust meter")}</span>`} <span class="muted">Model's average miss on their points: ${f1(t.trust.mae)} over the last ${esc(t.trust.games)} games, ${f1(t.trust.typical)} typical.</span></p>` : ""}
    ${t.onOffOut && Math.abs(t.onOffOut.x) >= 0.5 ? `<p class="small muted">Tonight's absences, judged by on/off records, point to ${sg(t.onOffOut.x)} points for them. Evidence only (not applied: it did not improve past projections).</p>` : ""}
    <h3>Schedule spot</h3><ul class="dots small">${schedBits(t.sched).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${scen.length ? `<h3>Situations that apply (learned from past games)</h3><ul class="plain small">${scen.map((s) => `<li class="spread"><span>${esc(s.k)}</span><span class="num ${cls(s.w)}">${sg(s.w)} pts <span class="muted">(${s.n} games)</span></span></li>`).join("")}</ul>` : ""}
    ${t.injuries.length ? `<h3>Injury report</h3><ul class="plain small">${t.injuries.slice(0, 8).map((i) => `<li class="prow-i">${avatar(i.id ?? pid(i.n), i.n, { size: "sm" })}<div><b>${esc(i.n)}</b> · ${esc(i.status)}${i.detail ? `<br><span class="muted">${esc(i.detail)}</span>` : ""}</div></li>`).join("")}</ul>` : `<h3>Injury report</h3><p class="small muted">Nobody listed.</p>`}
  </div>`;
}
// The name cell of an expandable player row (.prow): face, name (short on phones) and one small line underneath (already-escaped HTML).
const playerCell = (p, sub = "", mark = "") => `<span class="pn">${avatar(p.id, p.n, { size: "sm" })}<span class="pn-t"><b>${pname(p.n)}${mark}</b><i>${sub}</i></span></span>`;
function playersCard(t, oppTid) {
  const rows = t.players.filter((p) => p.min >= 4);
  return `<div class="card"><h2>${teamName(t.tid, { text: "short" })} player projections</h2>
    <p class="small muted">Under each name: the main reasons his points differ from his season average, then his zone matchup against ${esc(T(oppTid).abbr)}. The small numbers under points are his likely range (8 times in 10). Tap a player for every reason.</p>
    <div class="ptable" style="--cols:5"><div class="phead"><span>Player</span><span>Min</span><span>Pts</span><span>Reb</span><span>Ast</span><span>3PA</span></div>
    ${favFirst(rows, "p").map((p) => `<details class="prow"><summary>
        ${playerCell(p, `${isFav("p", p.id) ? `<span class="fav-mark" aria-label="favourite">★</span> ` : ""}${p.q ? `<span class="qtag">Q</span> ` : ""}${esc(p.pos || "")}${p.r2k ? `<span class="wide-only"> · 2K ${esc(p.r2k)}</span>` : ""}`)}
        <span>${f0(p.min)}</span><span class="two"><b>${f1(p.pts)}</b><i>${esc(p.lo)}–${esc(p.hi)}</i></span><span>${f1(p.reb)}</span><span>${f1(p.ast)}</span><span>${f1(p.tpa)}</span>${rowWhy(p)}${zmLine(p.zm)}
      </summary><div class="pbody">${scenarioBlock(p, S.curGame, oppTid)}${skillSlot(p.id, oppTid)}${ixBlock(p)}${dmBlock(p)}${zmBlock(p, oppTid)}${trustLine(p.trust)}<a class="go" href="#/player/${esc(p.id)}">Full profile ›</a></div></details>`).join("")}
    </div>${glossary(["min", "pts", "reb", "ast", "tpa", "range", "q", "k2", "split", "small"])}</div>`;
}
function playerWhy(p) {
  const a = p.adj || {}, bits = [];
  if (a.defense && Math.abs(a.defense - 1) >= 0.03) bits.push(`Opponent allows ${a.defense > 1 ? "more" : "fewer"} points than average to his position (${sg((a.defense - 1) * 100, 0)}%).`);
  if (a.pace && Math.abs(a.pace - 1) >= 0.015) bits.push(`Expected pace is ${a.pace > 1 ? "faster" : "slower"} than his team usually plays (${sg((a.pace - 1) * 100, 0)}%).`);
  if (a.absence && Math.abs(a.absence) >= 0.5) bits.push(`Teammates out shift ${sg(a.absence)} points of scoring load to him.`);
  for (const w of a.ww || []) bits.push(esc(w));
  if (a.split && Math.abs(a.split) >= 0.4) bits.push(`His own history in this exact matchup moves the projection ${sg(a.split)} points.`);
  const scen = (p.scen || []).filter((s) => s.n >= 20 && Math.abs(s.pts) >= 0.15);
  return `${bits.length ? `<ul class="dots">${bits.map((b) => `<li>${b}</li>`).join("")}</ul>` : `<p>No unusual adjustments: this is close to his normal production for the minutes expected.</p>`}
    ${(a.matchups || []).length ? `<h4>His record in this kind of matchup (vs his usual)</h4><ul class="plain">${a.matchups.map((m) => `<li class="spread"><span>${splitLabel(m)} <span class="muted">(${m.n} games)</span></span><span class="num"><span class="${cls(m.pts)}">${sg(m.pts)} pts</span>${Math.abs(m.tpa) >= 1 ? ` · ${sg(m.tpa)} 3PA` : ""}</span></li>`).join("")}</ul>` : ""}
    ${scen.length ? `<h4>Situations that apply tonight</h4><ul class="plain">${scen.map((s) => `<li class="spread"><span>${esc(s.s)}</span><span class="num ${cls(s.pts)}">${sg(s.pts, 2)} pts</span></li>`).join("")}</ul>` : ""}`;
}

// ---------------------------------------------------------------- Results (back-test)
async function vResults() {
  const res = await load("results.json");
  const phases = [...new Map(res.map((r) => [r.pk, r.phase])).entries()];
  const draw = () => {
    const rows = (S.resFilter === "all" ? res : S.resFilter === "upsets" ? res.filter((r) => r.upset) : res.filter((r) => r.pk === S.resFilter)).slice().reverse();
    const n = rows.length, hit = rows.filter((r) => r.correct).length;
    const flagged = rows.filter((r) => r.upsetFlag), fh = flagged.filter((r) => r.upset).length;
    app.innerHTML = `<h1>Projected vs what really happened</h1>
      <p class="lead">Every game since October 2025 was projected walk-forward from the games before it, then graded against the final score. The replay can still know a little more than a real forecast (starting line-ups, this season's 2K ratings, settings tuned on these seasons): see the <a href="#/accuracy">Accuracy report</a>, which also grades the predictions saved before tip-off. Preseason is included here, so the headline differs slightly from the Accuracy report's.</p>
      <div class="filters" role="group" aria-label="Filter results">
        ${[["all", "All games"], ...phases, ["upsets", "Misses only"]].map(([k, l]) => `<button class="fbtn" type="button" data-f="${esc(k)}" aria-pressed="${S.resFilter === k}">${esc(l)}</button>`).join("")}
      </div>
      <div class="tiles">
        <div class="tile"><div class="l">Games graded</div><div class="v">${n.toLocaleString()}</div></div>
        <div class="tile"><div class="l">Winner called</div><div class="v">${n ? pct(hit / n) : "-"}</div><div class="s">${hit} of ${n}</div></div>
        <div class="tile"><div class="l">Average miss on the margin</div><div class="v">${n ? f1(rows.reduce((s, r) => s + r.err, 0) / n) : "-"}</div><div class="s">points</div></div>
        <div class="tile"><div class="l">Upset-watch games that became upsets</div><div class="v">${flagged.length ? pct(fh / flagged.length) : "-"}</div><div class="s">${fh} of ${flagged.length} flagged</div></div>
      </div>
      ${rows.slice(0, S.resShown).map(resRow).join("")}
      ${rows.length > S.resShown ? `<button class="btn block" id="more" type="button">Show more (${rows.length - S.resShown} left)</button>` : ""}`;
    // Re-rendering replaces the buttons, so put keyboard focus back where the visitor was.
    app.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { S.resFilter = b.dataset.f; S.resShown = 40; draw(); [...app.querySelectorAll("[data-f]")].find((x) => x.dataset.f === S.resFilter)?.focus({ preventScroll: true }); }));
    document.getElementById("more")?.addEventListener("click", () => { const from = S.resShown; S.resShown += 60; draw(); app.querySelectorAll("a.card")[from]?.focus({ preventScroll: true }); });
  };
  draw();
}
function resRow(r) {
  const ph = r.pred.pHome, fav = ph >= 0.5 ? r.home : r.away;
  return `<a class="card" href="#/result/${esc(r.id)}"><div class="res">
    <span class="m">${teamName(r.away, { text: "abbr" })} <span class="muted">at</span> ${teamName(r.home, { text: "abbr" })} <span class="muted small">${esc(day(r.date))}</span></span>
    <span class="chip ${r.correct ? "good" : "bad"}">${r.correct ? "✓ Called" : "✗ Missed"}</span>
    <span class="l">Projected ${f0(r.pred.as)}–${f0(r.pred.hs)} · ${esc(T(fav).abbr)} ${pct(Math.max(ph, 1 - ph))}</span><span></span>
    <span class="l">Final <b>${r.act.as}–${r.act.hs}</b>${r.act.ot ? " (OT)" : ""} · margin off by ${f1(r.err)}</span>
    <span>${r.upsetFlag ? `<span class="chip warn">⚠ flagged</span>` : ""}</span>
  </div></a>`;
}

async function vResult(id) {
  const g = await load(`games/${id}.json`);
  const [home, away] = [g.teams.find((t) => t.isHome), g.teams.find((t) => !t.isHome)];
  app.innerHTML = `<a class="back" href="#/results">‹ All results</a>
    <h1 class="vh">${esc(T(away.tid).name)} at ${esc(T(home.tid).name)}: projected versus actual</h1>
    <div class="card hero">
      <div class="muted small">${esc(dayLong(g.date))} · ${esc(g.phase)}</div>
      <div class="teams">
        ${heroSide(away.tid, g.act.as, `projected ${f1(g.pred.as)}`)}
        <span class="at">final</span>
        ${heroSide(home.tid, g.act.hs, `projected ${f1(g.pred.hs)}`)}
      </div>
      <div class="chips"><span class="chip ${g.correct ? "good" : "bad"}">${g.correct ? "✓ Winner called" : "✗ Winner missed"}</span>
      ${g.upsetFlag ? `<span class="chip warn">⚠ Was on upset watch</span>` : ""}</div>
      <p class="small" style="margin-top:10px;text-align:left">${esc(g.headline)}</p>
      ${g.upsetReasons?.length ? `<p class="small muted" style="text-align:left">Warning signs noted before the game: ${esc(g.upsetReasons.join("; "))}.</p>` : ""}
    </div>
    <div class="grid two">${[away, home].map((t) => `<div class="card">
      <div class="card-h"><h2>${teamName(t.tid, { text: "short" })}</h2><span class="num">${f1(t.pred)} → <b>${esc(t.act)}</b> <span class="${cls(t.err)}">(${sg(t.err)})</span></span></div>
      <h3>Where the ${Math.abs(t.err) < 3 ? "small" : ""} gap came from (points)</h3>
      ${divBars(t.why, WHY, 14)}
      <h3>Same gap, seen through the players</h3>
      ${divBars(t.players, PWHY, 14)}
      ${t.tags.length ? `<div class="chips" style="margin-top:10px">${t.tags.map((x) => `<span class="chip info">${esc(x)}</span>`).join("")}</div>` : ""}
      ${t.out.length ? `<h3>Known out before tip-off</h3><div class="pchips small">${t.out.map((o) => playerChip(o.id ?? pid(o.n), o.n)).join("")}</div>` : ""}
      <details class="more"><summary>Situations in play before the game</summary><div class="chips">${t.scen.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></details>
    </div>`).join("")}</div>
    ${[away, home].map((t) => {
      const rows = g.players.filter((p) => p.t === t.tid).sort((a, b) => (b.act.pts - a.act.pts));
      return `<div class="card"><h2>${teamName(t.tid, { text: "short" })} players: projected vs actual</h2>
        <div class="ptable" style="--cols:4"><div class="phead"><span>Player</span><span>Pts</span><span>Reb</span><span>Ast</span><span>Min</span></div>
        ${rows.map((p) => {
          const two = (a, b) => `<span class="two"><b>${a}</b><i>${b == null ? "-" : f1(b)}</i></span>`;
          const d = p.pred ? p.act.pts - p.pred.pts : null;
          return `<details class="prow"><summary>
            ${playerCell(p, p.act.dnp ? esc("Did not play: " + String(p.act.dnp).toLowerCase()) : p.tags?.length ? esc(p.tags.join(", ")) : d != null ? `${sg(d)} pts vs projection` : "")}
            ${two(p.act.pts, p.pred?.pts)}${two(p.act.reb, p.pred?.reb)}${two(p.act.ast, p.pred?.ast)}${two(f0(p.act.min), p.pred?.min)}
          </summary><div class="pbody">
            ${p.pred ? `<p>Projected ${f1(p.pred.pts)} points (likely range ${p.pred.lo}–${p.pred.hi}), scored <b>${p.act.pts}</b> on ${esc(p.act.fg)} shooting (${esc(p.act.tp)} from three).</p>
              ${p.why ? `<h4>Why the points differed</h4>${divBars(p.why, PWHY, 10)}` : ""}
              ${(p.adj?.matchups || []).length ? `<h4>Matchup history used</h4><ul class="plain">${p.adj.matchups.map((m) => `<li class="spread"><span>${splitLabel(m)} <span class="muted">(${m.n})</span></span><span class="num ${cls(m.pts)}">${sg(m.pts)} pts</span></li>`).join("")}</ul>` : ""}
              ${p.scen?.length ? `<h4>Situations in play</h4><div class="chips">${p.scen.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}` : `<p>He was not expected to play, so there was no projection.</p>`}
            <a class="go" href="#/player/${esc(p.id)}">Full profile ›</a>
          </div></details>`;
        }).join("")}</div>
        <p class="small muted" style="margin-top:8px">Bold = actual, small = projected.</p></div>`;
    }).join("")}
    <div class="card"><h2>How each rating system saw it</h2>
      <div class="tw"><table><thead><tr><th>Rating system</th><th class="n">Home margin</th></tr></thead><tbody>
      ${Object.entries(g.models || {}).map(([k, v]) => `<tr><td>${esc(MODEL_NAMES[k] || k)}</td><td class="n">${sg(v)}</td></tr>`).join("")}
      <tr><td><b>Actual</b></td><td class="n"><b>${sg(g.act.hs - g.act.as, 0)}</b></td></tr></tbody></table></div>
      ${g.officials?.length ? `<p class="small muted" style="margin-top:8px">Officials: ${esc(g.officials.join(", "))}</p>` : ""}
    </div>`;
}
const MODEL_NAMES = { efficiency: "Recent efficiency", players: "Player-by-player build-up", elo: "Elo with margin of victory", adjusted: "Opponent-adjusted efficiency", luckAdjusted: "Opponent-adjusted, 3-point luck removed" };

// ---------------------------------------------------------------- Why (learning ledger)
function liveTrackCard(L) {
  const rows = (L?.liveTrack?.phases || L?.liveTrack?.rows || []).filter((r) => /Regular|Playoffs/.test(r.label || ""));
  const tip = Object.fromEntries((L?.phaseSummary || []).map((p) => [p.pk, p]));
  if (!rows.length) return "";
  return `<div class="card"><h2>Accuracy made ahead of time</h2>
    <p class="small muted">The main figures use what was known at tip-off, including starting line-ups and the inactive list. Projections you read hours earlier do not have those yet, so this second track replays every game without them. Expect results closer to this line when you check well before tip-off.</p>
    <div class="tw"><table><thead><tr><th>Phase</th><th class="n">Winner, at tip-off</th><th class="n">Winner, ahead of time</th><th class="n">Pts miss, ahead</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${pct(tip[r.pk]?.winnerAcc)}</td><td class="n">${pct(r.winnerAcc)}</td><td class="n">${f1(r.ptsMAE)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
async function vWhy() {
  const L = await load("learning.json");
  const reg = L.phaseSummary.filter((p) => !p.pk.endsWith("-1"));
  const tot = reg.reduce((s, p) => s + p.games, 0), acc = reg.reduce((s, p) => s + p.winnerAcc * p.games, 0) / Math.max(1, tot);
  const tl = L.timeline.filter((w) => !/Preseason/.test(w.phase));
  const mt = monthTicks(tl, "week");
  const totW = L.models.reduce((s, m) => s + m.weight, 0) || 1;
  app.innerHTML = `<h1>Why projections miss, and what gets learned</h1>
    <p class="lead">After every game the gap between projection and reality is split into causes. Those causes pile up week by week into a library of real situations, and the library feeds the next projection.</p>
    <div class="card"><h2>Learning path, in order</h2>
      <div class="chips">${L.phaseSummary.map((p, i) => `<span class="chip ${i === L.phaseSummary.length - 1 ? "info" : ""}">${i + 1}. ${esc(p.label)} · ${p.games.toLocaleString()} games${i === L.phaseSummary.length - 1 ? " so far" : ""}</span>`).join("")}</div>
      <p class="small muted" style="margin-top:8px">Each game is projected, graded and learned from before the next one, so every lesson from last season and the playoffs carries into this season.</p>
    </div>
    <div class="tiles">
      <div class="tile"><div class="l">Winner called (excluding preseason)</div><div class="v">${pct(acc)}</div><div class="s">${tot.toLocaleString()} games</div></div>
      <div class="tile"><div class="l">Situations being tracked</div><div class="v">${L.scenarios.length + L.teamScenarios.length}</div><div class="s">player and team</div></div>
      <div class="tile"><div class="l">Points ranges that held</div><div class="v">${f0(L.rangeCoverage.actual)}%</div><div class="s">target ${L.rangeCoverage.target}%</div></div>
      <div class="tile"><div class="l">Home-court edge learned</div><div class="v">${f1(L.params.at(-1)?.homeAdv)}</div><div class="s">points</div></div>
    </div>

    <div class="card"><h2>Winner accuracy, building up week by week</h2>
      <p class="small muted">Share of all games called correctly from October 2025 to each week (preseason left out).</p>
      <div class="chart" id="c-acc" data-label="Cumulative share of winners called correctly by week"></div>
    </div>

    ${L.efficiency?.applied ? `<div class="card"><h2>New: shooting luck is separated from skill</h2>
      <p>After every game the model now updates a player's scoring in two parts: <b>how many shots he gets</b> (follows recent games, so role changes show up fast) and <b>how well he shoots</b> (a long window, pulled toward his position's league rate, so one hot or cold week barely moves it).</p>
      <p class="small muted">${esc(L.efficiency.note)}</p></div>` : ""}
    <div class="card"><h2>What caused the misses each week</h2>
      <p class="small muted">Average points of error per team per game, split by cause.</p>
      <div class="legend">${WHY_KEYS.map((k, j) => `<span><i style="background:var(--s${j + 1})"></i>${WHY[k]}</span>`).join("")}</div>
      <div class="chart" id="c-src" data-label="Weekly projection error split by cause"></div>
      <details class="more"><summary>Show as a table by season phase</summary><div class="tw"><table>
        <thead><tr><th>Phase</th>${WHY_KEYS.map((k) => `<th class="n">${WHY[k]}</th>`).join("")}</tr></thead>
        <tbody>${L.phaseSummary.map((p) => `<tr><td>${esc(p.label)}</td>${WHY_KEYS.map((k) => `<td class="n">${f1(p.teamErrorSources[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>
    </div>

    ${liveTrackCard(L)}
    <div class="card"><h2>Report card by phase</h2><div class="tw"><table>
      <thead><tr><th>Phase</th><th class="n">Games</th><th class="n">Winner</th><th class="n">Margin miss</th><th class="n">Team pts miss</th><th class="n">Upset watch hit</th></tr></thead>
      <tbody>${L.phaseSummary.map((p) => `<tr><td>${esc(p.label)}</td><td class="n">${p.games}</td><td class="n">${pct(p.winnerAcc)}</td><td class="n">${f1(p.marginMAE)}</td><td class="n">${f1(p.teamPtsMAE)}</td><td class="n">${p.upsetFlags ? `${p.upsetFlagHits}/${p.upsetFlags}` : "-"}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">Preseason is hard to call because teams rest regulars and try out lineups.</p>
    </div>

    <div class="card"><h2>Are the percentages honest?</h2>
      <p class="small muted">When the model says a team wins 70% of the time, it should win about 70% of the time.</p>
      <div class="tw"><table><thead><tr><th>Model said</th><th class="n">Games</th><th class="n">Average stated</th><th class="n">Actually won</th></tr></thead>
      <tbody>${L.calibration.map((c) => `<tr><td>${esc(c.bucket)}</td><td class="n">${c.games}</td><td class="n">${f0(c.said)}%</td><td class="n"><b>${f0(c.happened)}%</b></td></tr>`).join("")}</tbody></table></div>
    </div>

    <div class="card"><h2>The five rating systems, scored separately</h2>
      <p class="small muted">Standard public methods, each run on its own through the same back-test. "Say" is the weight the ensemble currently gives each one.</p>
      <div class="tw"><table><thead><tr><th>System</th><th class="n">Say</th>${reg.map((p) => `<th class="n">${esc(p.label.replace("Regular Season", "Reg").replace("Playoffs", "PO"))}</th>`).join("")}</tr></thead>
      <tbody>${L.models.map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${pct(m.weight / totW)}</td>${reg.map((p) => { const x = m.phases.find((q) => q.pk === p.pk); return `<td class="n">${x ? pct(x.acc) : "-"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    </div>

    ${factorsCard(L.factors)}${inloopCard(L.inloop)}

    <div class="card"><h2>What really happens to players</h2>
      <p class="small muted">How often each real-game event showed up, and the average points swing versus projection when it did.</p>
      <div class="tw"><table><thead><tr><th>Event</th><th class="n">Times</th><th class="n">Avg points vs projection</th></tr></thead>
      <tbody>${L.tagFreq.map((t) => `<tr><td>${esc(t.k)}</td><td class="n">${t.n.toLocaleString()}</td><td class="n ${cls(t.avgPts)}">${sg(t.avgPts)}</td></tr>`).join("")}</tbody></table></div>
    </div>

    <div class="card"><h2>Situation library: players</h2>
      <p class="small muted">Situations that can be spotted before a game. "Adjustment" is what the model now applies; "raw gap" is the plain average difference seen in those games.</p>
      <div class="filters" role="group" aria-label="Player role">${Object.entries(ROLE).map(([k, l]) => `<button class="fbtn" type="button" data-role="${k}" aria-pressed="${S.role === k}">${l}</button>`).join("")}</div>
      <div id="scen"></div>
    </div>

    <div class="card"><h2>Situation library: teams</h2>
      <div class="tw"><table><thead><tr><th>Situation</th><th class="n">Games</th><th class="n">Adjustment (pts)</th><th class="n">Raw gap</th></tr></thead>
      <tbody>${L.teamScenarios.filter((t) => t.n >= 15).map((t) => `<tr><td>${esc(t.k)}</td><td class="n">${t.n}</td><td class="n ${cls(t.effect)}">${sg(t.effect)}</td><td class="n">${sg(t.rawAvg)}</td></tr>`).join("")}</tbody></table></div>
    </div>

    <div class="card"><h2>Referee crews</h2>
      <p class="small muted">Total points versus projection in each official's games. Applied to a projection once the crew is announced. Honest note: across ${L.referees.games.toLocaleString()} games this changed the average total-points miss from ${L.referees.totalErrWithout} to ${L.referees.totalErrWith}, so treat it as a small factor.</p>
      <details class="more"><summary>Show officials (${L.referees.crews.length})</summary><div class="tw"><table><thead><tr><th>Official</th><th class="n">Games</th><th class="n">Total pts</th><th class="n">Home margin</th></tr></thead>
      <tbody>${L.referees.crews.map((c) => `<tr><td>${esc(c.n)}</td><td class="n">${c.games}</td><td class="n">${sg(c.total)}</td><td class="n">${sg(c.home)}</td></tr>`).join("")}</tbody></table></div></details>
    </div>`;

  const drawScen = () => {
    const rows = L.scenarios.map((s) => ({ s: s.s, r: s.roles[S.role] })).filter((x) => x.r?.pts && x.r.pts.n >= 15).sort((a, b) => b.r.pts.n - a.r.pts.n);
    document.getElementById("scen").innerHTML = `<div class="tw"><table><thead><tr><th>Situation</th><th class="n">Games</th><th class="n">Points</th><th class="n">Minutes</th><th class="n">Raw pts gap</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${esc(x.s)}</td><td class="n">${x.r.pts.n.toLocaleString()}</td><td class="n ${cls(x.r.pts.effect)}">${sg(x.r.pts.effect, 2)}</td><td class="n">${sg(x.r.min?.effect, 2)}</td><td class="n">${sg(x.r.pts.rawAvg, 2)}</td></tr>`).join("")}</tbody></table></div>`;
    app.querySelectorAll("[data-role]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === S.role)));
  };
  app.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => { S.role = b.dataset.role; drawScen(); }));
  drawScen();

  const charts = () => {
    let n = 0, c = 0;
    const pts = tl.map((w, i) => { n += w.games; c += w.acc * w.games; return { y: Math.round((c / n) * 1000) / 10, tick: mt[i], tip: `<b>Week of ${esc(day(w.week))}</b><br>${esc(w.phase)}<br>Called so far: ${(c / n * 100).toFixed(1)}%<br>This week: ${pct(w.acc)} of ${w.games} games` }; });
    lineChart(document.getElementById("c-acc"), pts, { min: 40, max: 85 });
    stackChart(document.getElementById("c-src"), tl.map((w, i) => ({ label: `Week of ${day(w.week)} (${w.games} games)`, tick: mt[i], parts: w.sources })), WHY_KEYS, WHY);
  };
  charts();
  S.redraw = charts;
}

// The learned matchup factors (zones, defenders, glass, pace of threes ...) with the back-test verdict on each one, good or bad.
const STAT_NAME = { pts: "points", reb: "rebounds", ast: "assists", tpa: "three-point attempts", min: "minutes" };
// ---------------- Our own archetypes, play-type matchups and the scenario card (display; evidence-labelled)
// Archetypes are our own labels, calculated from Synergy play types, shot locations and NBA.com defender tracking.
const evid = (n, unit = "player-games") => { const lab = n >= 1500 ? "strong" : n >= 500 ? "medium" : n >= 150 ? "weak" : "noise"; return `<span class="evl evl-${lab}">${lab}</span> <span class="muted small">${num(Math.round(n))} ${unit}</span>`; };
function offArchetypes(p) {
  const pt = Object.fromEntries((p.playstyle?.playTypes?.rows || []).map((x) => [x.id, x.freq || 0]));
  const z = Object.fromEntries((p.zones14?.rows || []).map((x) => [x.id, x.share || 0]));
  const rimShare = (z.rim || 0) + (z.shL || 0) + (z.shC || 0) + (z.shR || 0), three = ["tCL", "tWL", "tT", "tWR", "tCR"].reduce((a, k) => a + (z[k] || 0), 0);
  const big = /C/.test(p.pos || "") || defArchetypes(p)[0]?.[0] === "Rim protector";
  const sp = S.P?.[String(p.id)]?.cur, apm = sp && sp[1] ? sp[4] / sp[1] * 36 : 0;
  const raw = {
    "Slasher": Math.max(0, rimShare - 35) * 0.9 + (pt.Transition || 0) * 0.3 + (big ? -15 : 0),
    "Sharpshooter": (pt.Spotup || 0) * 0.8 + (pt.OffScreen || 0) * 1.2 + Math.max(0, three - 30) * 0.7,
    "Shot creator": (pt.Isolation || 0) * 1.4 + (pt.PRBallHandler || 0) * 0.5,
    "Floor general": (pt.PRBallHandler || 0) * 0.6 + Math.max(0, apm - 4) * 6,
    "Post scorer": (pt.Postup || 0) * 1.6,
    "Rim runner": (pt.PRRollman || 0) * 1.1 + (pt.Cut || 0) * 1.0 + (pt.OffRebound || 0) * 1.3,
    "Stretch big": big ? Math.max(0, three - 15) * 1.2 : 0,
  };
  const tot = Object.values(raw).reduce((a, b) => a + Math.max(0, b), 0); if (!tot) return [];
  return Object.entries(raw).map(([k, v]) => [k, Math.max(0, v) / tot]).filter(([, v]) => v >= 0.08).sort((a, b) => b[1] - a[1]).slice(0, 3);
}
function defArchetypes(p) {
  const R = Object.fromEntries((p.defense?.rows || []).map((x) => [x.id, x])), bl = p.defense?.blocks;
  if (!R.overall) return [];
  const raw = {
    "Rim protector": (() => { if (!R.rim) return 0; const share = R.rim.fga / Math.max(1, R.overall.fga), w = Math.max(0, Math.min(1, (share - 0.3) / 0.2)), bpg = (bl?.rim || 0) / Math.max(1, p.defense.games); return w * (Math.max(0, -R.rim.diff) * Math.min(1, R.rim.fga / 150) * 3 + Math.max(0, bpg - 0.6) * 6); })(),
    "Perimeter stopper": R.three ? Math.max(0, -R.three.diff) * Math.min(1, R.three.fga / 200) * 3 : 0,
    "Switchable": R.two && R.three && R.two.diff < 0 && R.three.diff < 0 ? 4 : 0,
    "Defensive target": Math.max(0, R.overall.diff) * Math.min(1, R.overall.fga / 300) * 3,
  };
  const tot = Object.values(raw).reduce((a, b) => a + b, 0); if (!tot) return [["Neutral defender", 1]];
  return Object.entries(raw).map(([k, v]) => [k, v / tot]).filter(([, v]) => v >= 0.15).sort((a, b) => b[1] - a[1]).slice(0, 2);
}
// Play-type matchup: his mix x his points per possession x how tonight's opponent defends each type (shrunk with 300
// possessions toward the league), against his normal points per possession.
function playTypeMatchup(p, oppTid) {
  const mine = (p.playstyle?.playTypes?.rows || []).filter((x) => x.poss >= 25), opp = S.T?.[oppTid]?.playTypes?.def || [];
  if (!mine.length || !opp.length) return null;
  const lg = {}; for (const t of S.teams || []) for (const x of t.playTypes?.def || []) { (lg[x.id] ||= { p: 0, pts: 0 }); lg[x.id].p += x.poss; lg[x.id].pts += x.ppp * x.poss; }
  let base = 0, adj = 0, possPg = 0, n = 0; const rows = [];
  for (const x of mine) {
    const o = opp.find((y) => y.id === x.id), L = lg[x.id]; if (!o || !L?.p) continue;
    const lgp = L.pts / L.p, oppP = (o.ppp * o.poss + lgp * 300) / (o.poss + 300), ratio = oppP / lgp;
    const share = x.freq / 100; base += share * x.ppp; adj += share * x.ppp * ratio; n += x.poss;
    rows.push({ label: x.label, freq: x.freq, ppp: x.ppp, oppPpp: o.ppp, ratio, oppPoss: o.poss });
    possPg = Math.max(possPg, x.poss / Math.max(1, x.gp || 1) / Math.max(0.01, share));
  }
  if (!base) return null;
  return { delta: (adj - base) * possPg, possPg, rows: rows.sort((a, b) => b.freq - a.freq), n };
}
// A 2K-style build name generated from his real stats (our archetype mix), not copied from any name list:
// [defensive tag] + [secondary skill] + [main role], e.g. "2 Way Playmaking Shot Creator".
function styleName(p) {
  const oa = offArchetypes(p), da = defArchetypes(p); if (!oa.length) return null;
  const NOUN = { "Slasher": "Slasher", "Sharpshooter": "Sharpshooter", "Shot creator": "Shot Creator", "Floor general": "Playmaker", "Post scorer": "Post Scorer", "Rim runner": "Rim Runner", "Stretch big": "Stretch Five" };
  const ADJ = { "Slasher": "Slashing", "Sharpshooter": "Sharpshooting", "Shot creator": "Shot Creating", "Floor general": "Playmaking", "Post scorer": "Post Scoring", "Rim runner": "Rim Running", "Stretch big": "Stretch" };
  const [main, second] = oa, d = da[0];
  const tag = d && d[1] >= 0.5 ? (d[0] === "Rim protector" ? "Rim Protecting" : d[0] === "Perimeter stopper" || d[0] === "Switchable" ? "2 Way" : "") : "";
  const adj = second && second[1] >= 0.18 && ADJ[second[0]] && ADJ[second[0]] !== ADJ[main[0]] ? ADJ[second[0]] : "";
  return [tag, adj, NOUN[main[0]]].filter(Boolean).join(" ");
}
function scenarioCard(p, row, oppTid, L) {
  if (!row) return "";
  const items = [];
  for (const sc of row.scen || []) items.push({ k: sc.s, v: sc.pts, unit: "pts", ev: evid(sc.n), used: true, via: /minutes|blowout|rest|back-to-back|nights/i.test(sc.s) ? "minutes" : /out|absence|teammate/i.test(sc.s) ? "usage" : "points" });
  const ptm = playTypeMatchup(p, oppTid), ptGate = (L?.factors?.rows || []).find((x) => x.id === "ptype");
  if (ptm && Math.abs(ptm.delta) >= 0.1) items.push({ k: `Play-type matchup vs ${T(oppTid).abbr} (his top: ${ptm.rows.slice(0, 2).map((x) => x.label.toLowerCase()).join(", ")})`, v: ptm.delta, unit: "pts", ev: evid(ptm.n, "possessions"), used: !!(ptGate && ptGate.gate > 0), via: "efficiency" });
  const dm = row.dm; if (dm?.defenders?.length) { const v = ((dm.realPct || 0) + (dm.pairPct || 0)) / 100 * (dm.basePts || row.pts || 0); /* the model's own shrunk defender effects */ const gate = (L?.inloop?.players?.rows || []).find((x) => x.id === "defReal");
    items.push({ k: `Likely defenders (${dm.defenders.slice(0, 2).map((d) => shortName(d.n)).join(", ")})`, v, unit: "pts", ev: evid((dm.meetings || 0) * 60, "matchup possessions (approx.)"), used: !!(gate && gate.gate > 0), via: "efficiency" }); }
  if (row.zm) items.push({ k: `Zone matchup: ${(ZONE_FALLBACK[row.zm.zone] || row.zm.zone).toLowerCase()} (${row.zm.tag})`, v: row.zm.applied ? row.zm.applied : row.zm.paper, unit: "pts", ev: evid(row.zm.att ? row.zm.att * 20 : 0, "shots"), used: !!row.zm.applied, via: "efficiency" });
  const bo = row.ix?.blowout; if (bo?.ifWinBig && bo?.ifLoseBig && !bo.small) { const v = bo.winBy15 * bo.ifWinBig.min + bo.loseBy15 * bo.ifLoseBig.min; items.push({ k: "Blowout risk (expected minutes)", v, unit: "min", ev: evid((bo.ifWinBig.games + bo.ifLoseBig.games) * 30, "player-games (team)"), used: false, via: "minutes" }); }
  if (!items.length) return "";
  const applied = items.filter((x) => x.used && x.unit === "pts").reduce((a, x) => a + x.v, 0);
  const oa = offArchetypes(p), da = defArchetypes(p);
  return `<div class="sc-card"><h3>Tonight's scenarios vs ${esc(T(oppTid).abbr)}</h3>
    ${styleName(p) ? `<p class="bn"><span class="bn-k">Build</span> <b>${esc(styleName(p))}</b> <span class="muted small">(generated from his stats in the style of 2K build names)</span></p>` : ""}
    ${oa.length || da.length ? `<p class="small">${oa.length ? `<b>Offence:</b> ${oa.map(([k, v]) => `${esc(k)} ${Math.round(v * 100)}%`).join(" · ")}` : ""}${da.length ? ` &nbsp; <b>Defence:</b> ${da.map(([k, v]) => `${esc(k)} ${Math.round(v * 100)}%`).join(" · ")}` : ""} <span class="muted">(our own labels, from play types, shot locations and defender tracking)</span></p>` : ""}
    <div class="tw"><table class="sc-t"><thead><tr><th>Scenario</th><th class="n">Effect</th><th>Evidence</th><th>Through</th><th>In the projection?</th></tr></thead><tbody>
    ${items.map((x) => `<tr><td>${esc(x.k)}</td><td class="n ${x.v > 0 ? "up" : x.v < 0 ? "down" : ""}">${x.v > 0 ? "+" : ""}${f1(x.v)} ${x.unit}</td><td>${x.ev}</td><td class="small">${x.via}</td><td class="small">${x.used ? "✓ applied" : "shown only (not yet proven)"}</td></tr>`).join("")}
    <tr class="sc-net"><td><b>Applied scenario effects</b></td><td class="n"><b>${applied > 0 ? "+" : ""}${f1(applied)} pts</b></td><td colspan="3" class="small">Projection ${f1(row.pts)} pts already includes these.</td></tr></tbody></table></div>
    <p class="small muted">Evidence: strong 1,500+, medium 500+, weak 150+ (player-games or possessions), otherwise noise. Every player-specific effect is shrunk toward the league-wide effect for players like him. A scenario moves the projection only after a walk-forward test shows it lowers the miss on games it had not seen; the rest are shown for context. Pairings like "slasher vs rim protector" are untested hypotheses until that test is run.</p></div>`;
}
function inloopCard(IL) {
  const rows = IL?.players?.rows || []; if (!rows.length) return "";
  return `<div class="card"><h2>Scenarios tested inside the model, and dropped or kept</h2>
    <p class="small muted">Each idea was added to the walk-forward replay using only information from before each game, and kept only if it lowered the miss on games it had not yet learned from.</p>
    <ul class="mrows">${rows.map((x) => `<li class="mrow"><div class="mrow-h"><span class="mrow-l">${esc(x.label)} <span class="muted">on ${esc(STAT_NAME[x.stat] || x.stat)}</span></span><span class="chip ${x.gate > 0 && !/evidence only/.test(x.verdict) ? "good" : ""}">${x.gate > 0 && !/evidence only/.test(x.verdict) ? "kept" : "tested, not used"}</span></div><div class="small muted">${esc(x.what)}</div><div class="small">${esc(num(x.games))} player-games · ${esc(x.verdict)}</div></li>`).join("")}</ul></div>`;
}
function factorsCard(F) {
  if (!F?.rows?.length) return "";
  const vClass = (v) => (v === "helps" ? "good" : v === "small" ? "info" : /worse/.test(v) ? "bad" : "");
  const order = (r) => (r.verdict === "helps" ? 0 : r.verdict === "small" ? 1 : /worse/.test(r.verdict) ? 2 : 3);
  const rows = [...F.rows].sort((a, b) => order(a) - order(b) || b.games - a.games);
  const used = rows.filter((r) => r.gate > 0), held = rows.filter((r) => !(r.gate > 0));
  const item = (r) => `<li class="mrow"><div class="mrow-h"><span class="mrow-l">${esc(r.label)} <span class="muted">on ${esc(STAT_NAME[r.stat] || r.stat)}</span></span><span class="chip ${vClass(r.verdict)}">${esc(r.verdict)}</span></div>
    <div class="small muted">${esc(r.what)}</div>
    <div class="small">${esc(num(r.games))} player-games seen · learned weight ${esc(r.coef)} · ${pct(r.gate)} of it used · average miss ${esc(r.errWithout)} without it, ${esc(r.errWith)} with it (${r.reduction > 0 ? `${esc(r.reduction)} better` : r.reduction < 0 ? `${esc(Math.abs(r.reduction))} worse` : "no change"})</div></li>`;
  const tot = Object.entries(F.total || {});
  return `<div class="card" id="factors"><h2>Matchup factors: what the back-test says</h2>
    <p class="small muted">Shot zones, likely defenders, rebounding, free throws, ball pressure, size, transition, play types, closing and age are each turned into a number known before tip-off. Each one then has to earn its place: its weight is learned game by game, and it is only used as far as it made projections better on games it had not seen.</p>
    <p class="note">${esc(F.summary)}</p>
    ${used.length ? `<h3>Used in projections (${used.length})</h3><ul class="mrows">${used.map(item).join("")}</ul>` : `<p class="small">No factor has earned a place in the projections yet.</p>`}
    ${held.length ? `<details class="more"><summary>${held.length} factor effects tested and held at zero</summary><ul class="mrows">${held.map(item).join("")}</ul></details>` : ""}
    ${tot.length ? `<h3>All applied factors together</h3><div class="tw"><table><thead><tr><th>Stat</th><th class="n">Player-games</th><th class="n">Miss without</th><th class="n">Miss with</th><th class="n">Change</th></tr></thead>
      <tbody>${tot.map(([k, v]) => `<tr><td>${esc(STAT_NAME[k] || k)}</td><td class="n">${esc(num(v.games))}</td><td class="n">${esc(v.errWithout)}</td><td class="n">${esc(v.errWith)}</td><td class="n">${v.reduction ? sg(-v.reduction, 4) : "0"}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">Average miss per player per game, before team-level corrections. A negative change is an improvement. Honest reading: these factors explain matchups well on paper, but so far they move the projections very little.</p>` : ""}
    ${F.rules?.gate ? `<p class="small muted">How much of a weight is used: ${esc(F.rules.gate)} (t-statistic of the benefit on unseen games). Shot zones were recorded for ${esc(num(F.zoneStateGames?.recorded))} games${F.zoneStateGames?.missing ? `; ${esc(num(F.zoneStateGames.missing))} had no play-by-play` : ""}.</p>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- Teams
async function vTeams() {
  const teams = [...S.teams].sort((a, b) => (b.ratings?.adjNet ?? 0) - (a.ratings?.adjNet ?? 0));
  const rank = new Map(teams.map((t, i) => [t.id, i + 1]));
  const item = (t) => `<a class="titem" href="#/team/${esc(t.id)}">${teamLogo(t.id, { size: "md" })}
      <span><span class="t1">${isFav("t", t.id) ? `<span class="fav-mark" aria-label="favourite">★</span> ` : ""}${rank.get(t.id)}. ${esc(t.name)}</span><span class="t2">${esc(t.record.w)}-${esc(t.record.l)} · ${esc(t.style.tags.slice(0, 2).join(", ") || "Balanced")}</span></span>
      <span class="t3"><b>${sg(t.ratings?.adjNet)}</b><br><span class="muted small">net</span></span></a>`;
  const fav = teams.filter((t) => isFav("t", t.id));
  app.innerHTML = `<h1>Teams</h1><p class="lead">Ranked by strength after adjusting for who they have played. The number on the right is net rating: points scored minus points allowed per 100 possessions. Tap a team for playing style, coach habits and what they struggle against.</p>
    ${fav.length ? `<h2 class="day"><span>Your favourites</span><span class="cnt">${fav.length}</span></h2><div class="tgrid">${fav.map(item).join("")}</div><h2 class="day"><span>All teams</span><span class="cnt">30</span></h2>` : ""}
    <div class="tgrid">${teams.map(item).join("")}</div>`;
}
// Team scouting blocks: how they play (sentences with ranks), where they shoot and what they allow (two court maps),
// play-type strengths and weaknesses, and the culture indicators. All of it is counted data with its sample shown.
function playTypeRows(rows, best = [], worst = [], defence = false) {
  return `<ul class="mrows">${(rows || []).map((r) => meterRow({
    label: esc(r.label), badge: best.includes(r.id) ? `<span class="chip good">Strength</span>` : worst.includes(r.id) ? `<span class="chip bad">Weakness</span>` : "",
    value: r.pctile != null ? `${esc(ord(r.pctile))} pct` : "-", x: r.pctile, kind: "lvl",
    sub: `${p1(r.freq)} of ${defence ? "opponents' " : ""}possessions · ${esc(Number(r.ppp).toFixed(2))} points per possession${defence ? " allowed" : ""} · ${esc(num(r.poss))} possessions${r.gp ? ` in ${esc(r.gp)} games` : ""}`,
  })).join("")}</ul>`;
}
function teamScout(t) {
  const z = t.zones, pt = t.playTypes, ps = t.playstyle, cu = t.culture || [], ab = esc(t.abbr);
  const zoneCard = (side, title, mode, lead) => `<div class="card"><h2>${title}</h2>
    <p class="small muted">${lead}</p>
    ${courtFigure(`team-${side}`, zoneCells(z[side].fine, mode, "its"), `${t.name}: ${title}`)}
    ${courtLegend(mode)}
    ${t.zones14 ? hz14Card(t.zones14, side === "off" ? "toff" : "def", t.name, side === "off" ? "2K-style hot zones (14) and recent form" : "Defence by 14 zones: soft and strong spots") : ""}
    <h3>Five-zone summary</h3>${zoneTable(z[side].five, mode, { rank: true })}
    <details class="more"><summary>All ten zones as a table</summary>${zoneTable(z[side].fine, mode)}</details>
    <p class="small muted" style="margin-top:8px">${esc(num(z[side].fga))} shots ${side === "off" ? "taken" : "allowed"} in ${esc(z.games)} games, ${esc(z.window)}. ${mode === "def" ? "Rank 1 = lowest FG% allowed." : "Rank 1 = best FG%."}</p></div>`;
  return `${ps?.lines?.length ? `<div class="card"><h2>How they play</h2>
      <ul class="dots">${ps.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <p class="small muted" style="margin-top:8px">Counted from ${esc(ps.games)} games, ${esc(ps.scope)}. Ranks are out of 30 teams.</p></div>` : ""}
    ${z?.off?.fine?.length && z?.def?.fine?.length ? `<div class="grid two">
      ${zoneCard("off", "Shot map: offence", "off", `Where ${ab} shoots and how well. HOT and COLD need at least ${esc(z.rule?.minAtt?.fine ?? 100)} attempts in a zone, a gap of ${esc(z.rule?.minDiff ?? 3)} points of FG% to the league and ${esc(z.rule?.minZ ?? 1.5)} standard errors.`)}
      ${zoneCard("def", "Shot map: defence", "def", `What opponents shoot against ${ab}. SOFT = opponents clearly above league there, STRONG = clearly below. Same sample rule.`)}
    </div>` : ""}
    ${pt?.off?.length ? `<div class="grid two">
      <div class="card"><h2>Play types: offence</h2><p class="small muted">Share of possessions, points per possession and league percentile (higher = scores more).</p>${playTypeRows(pt.off, pt.offBest, pt.offWorst)}</div>
      <div class="card"><h2>Play types: defence</h2><p class="small muted">What opponents run against ${ab}. Here a higher percentile means fewer points allowed.</p>${playTypeRows(pt.def, pt.defBest, pt.defWorst, true)}
        <p class="small muted" style="margin-top:8px">Source: ${esc(pt.src)}, ${esc(pt.season)}${pt.gp ? `, ${esc(pt.gp)} games` : ""}. "Strength" = 75th percentile or better, "Weakness" = 25th or worse, on at least 4% of possessions.</p></div>
    </div>` : ""}
    ${cu.length ? `<div class="card"><h2>Culture indicators</h2>
      <p class="small muted">Measured habits of the team on the floor: effort, discipline, sharing the ball, resilience, continuity. These are counts and rates with their samples, not judgments of the people.</p>
      <ul class="mrows">${cu.map((c) => meterRow({
        label: esc(c.label), value: c.rank ? `${esc(ord(c.rank))} of 30` : "", x: c.rank ? ((31 - c.rank) / 30) * 100 : null, kind: "lvl",
        sub: `<span class="ink">${esc(c.value)}</span><br>${esc(c.ev)}${c.n ? `<br>Sample: ${esc(c.n)}` : ""}`,
      })).join("")}</ul></div>` : ""}`;
}
// Team "Versus": this team against another team (both offence-vs-defence maps and head-to-head) or against a player
// (his projected zones against this team's defence). Projected FG% = offence zone FG% (shrunk) + defence's gap to league (shrunk).
// ---------------- Versus projections (works with no head-to-head history)
// His per-game production (this season, blended with last while the sample is small) x the pace of the matchup
// x the opponent's current-season defence; chosen defenders adjust his scoring by how shooters do against them
// (NBA.com closest-defender tracking, weighted by his shot distances). Display only: the game-day model is separate.
// Live player search: matches any part of the name (accents ignored) as you type and shows tappable results.
// Replaces <datalist>, which phones show poorly and which needed the exact full name.
const fold = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pickerHTML = (id, ph = "Type a player name") => `<div class="pk-s"><input class="field" id="${id}" type="search" autocomplete="off" placeholder="${esc(ph)}"><div class="pk-res" id="${id}-res" role="listbox"></div></div>`;
function bindPicker(input, list, onPick) {
  if (!input) return; const res = document.getElementById(input.id + "-res");
  const show = () => { const q = fold(input.value).trim(); if (q.length < 2) { res.innerHTML = ""; return; }
    const hits = list.filter((x) => fold(x.n).includes(q)).sort((a, b) => fold(a.n).indexOf(q) - fold(b.n).indexOf(q) || (b.cur?.[2] || 0) - (a.cur?.[2] || 0)).slice(0, 8);
    res.innerHTML = hits.length ? hits.map((x) => `<button type="button" class="pk-hit" data-pid="${esc(x.id)}">${esc(x.n)} <span class="muted">${esc(T(x.team).abbr || "")}${x.cur ? ` · ${f1(x.cur[2])} ppg` : ""}</span></button>`).join("") : `<div class="small muted pk-none">No player matches "${esc(input.value)}"</div>`; };
  input.addEventListener("input", show);
  res.addEventListener("click", (e) => { const b = e.target.closest("[data-pid]"); if (!b) return; const q = list.find((x) => String(x.id) === b.dataset.pid); if (!q) return; input.value = ""; res.innerHTML = ""; onPick(q); });
}
// A pick far below the player's main line (e.g. 5+ points when his line is 16.5) is near-certain but pays almost
// nothing, so it is hidden by default on Picks and on the High-confidence board. Main line = the bookmaker's line when
// posted, else our simulation's main line, else his season average.
const PROP_GAP = { pts: 4, reb: 2, ast: 2, tpm: 1, pra: 5 };
function propMainRef(p, simMain) {
  if (p.comparison?.bookLine != null) return p.comparison.bookLine;
  if (simMain != null) return simMain;
  const b = seasonLine(S.P?.[String(p.player?.id)]), k = { pts: "pts", reb: "reb", ast: "ast" }[p.fam];
  if (b && k) return Math.floor(b[k]) + 0.5;
  if (b && p.fam === "pra") return Math.floor(b.pts + b.reb + b.ast) + 0.5;
  return null;
}
// Guard: a projection more than 30% away from the player's season average needs a named reason (questionable, a
// minutes change, teammates out, return from absence). Without one it is flagged and kept out of the high-confidence
// lists, parlays and gold picks: this is where data errors hide.
function devCheck(gm, pid, fam) {
  const row = gm?.teams?.flatMap((t) => (t.players || []).map((p) => ({ ...p, _t: t }))).find((p) => String(p.id) === String(pid));
  // Compare with THIS season's average once he has 5+ games (at this point in the season that is close to his last
  // 10); the blend with last season is built from much the same numbers as the projection, so it would hide gaps.
  const sp = S.P?.[String(pid)], c = sp?.cur, b0 = seasonLine(sp); if (!row || !b0) return null;
  const b = c && c[0] >= 5 ? { g: c[0], min: c[1], pts: c[2], reb: c[3], ast: c[4] } : b0;
  const proj = fam === "pra" ? row.pts + row.reb + row.ast : row[fam], avg = fam === "pra" ? b.pts + b.reb + b.ast : b[fam];
  if (proj == null || avg == null || avg < 4) return null;
  const dev = (proj - avg) / avg; if (Math.abs(dev) <= 0.3) return null;
  const reasons = [];
  if (row.q) reasons.push("listed questionable");
  if (b.min > 0 && Math.abs(row.min - b.min) / b.min >= 0.15) reasons.push(`minutes ${f0(row.min)} vs his usual ${f0(b.min)}`);
  if ((row.wwD || []).some((w) => Math.abs(w.pts) >= 1) || Math.abs(row.adj?.absence || 0) >= 1) reasons.push("teammates out");
  if ((row._t.out || []).some((o) => o.star)) reasons.push("a star teammate is out");
  if (row.ix?.returning) reasons.push("returning from absence");
  return { dev, proj, avg, basis: c && c[0] >= 5 ? `this season (${c[0]} games)` : "this season blended with last", reasons, unexplained: !reasons.length };
}
function tooFarBelow(p, simMain) {
  if (!p.player) return false; if (isLowLine(p)) return true;
  const ref = propMainRef(p, simMain); if (ref == null) return false;
  return p.line < ref * 0.8 && ref - p.line >= (PROP_GAP[p.fam] || 2);
}
function seasonLine(sp) {
  const c = sp?.cur, pv = sp?.prev; if (!c && !pv) return null;
  const wc = c ? Math.min(1, (c[0] || 0) / 15) : 0, mix = (i) => (c && pv ? wc * c[i] + (1 - wc) * pv[i] : (c || pv)[i]);
  return { g: c?.[0] || 0, min: mix(1), pts: mix(2), reb: mix(3), ast: mix(4) };
}
const lgStyle = (k) => { const ts = (S.teams || []).filter((t) => t.style?.[k]); return ts.reduce((a, t) => a + t.style[k], 0) / Math.max(1, ts.length); };
function projVs(pid, team, oppTids, defenders = [], zoneRows = null) {
  const b = seasonLine(S.P?.[String(pid)]); if (!b) return null;
  const lgPace = lgStyle("pace"), lgDef = lgStyle("def"), my = S.T?.[team]?.style || {};
  const opps = oppTids.map((t) => S.T?.[t]).filter(Boolean); if (!opps.length) return null;
  const oPace = opps.reduce((a, t) => a + (t.style?.pace || lgPace), 0) / opps.length, oDef = opps.reduce((a, t) => a + (t.style?.def || lgDef), 0) / opps.length;
  const fPace = ((my.pace || lgPace) + oPace) / 2 / (my.pace || lgPace), fDef = 1 + ((oDef - lgDef) / lgDef) * 0.85;
  let pts = b.pts * fPace * fDef; const parts = [["Season average", b.pts], ["Game pace", b.pts * (fPace - 1)], [`Defence (${opps.map((t) => t.abbr).join(", ")} allow ${f1(oDef)} per 100 vs league ${f1(lgDef)})`, b.pts * fPace * (fDef - 1)]];
  if (defenders.length && zoneRows?.length) {
    const hr = ringsFromZ14(zoneRows), att = Object.values(hr).reduce((a, x) => a + x.a, 0), fg = att ? Object.values(hr).reduce((a, x) => a + x.m, 0) / att : 0.47;
    let d = 0; for (const df of defenders) { const rd = defRingDiffs(df?.defense); let w = 0, v = 0; for (const [k, x] of Object.entries(hr)) if (rd[k] && x.a) { w += x.a; v += rd[k].diff * x.a; } if (w) d += v / w; }
    const share = Math.min(0.55, 0.35 + 0.1 * (defenders.length - 1)), dPts = pts * ((d / defenders.length) / Math.max(0.3, fg)) * share;
    pts += dPts; parts.push([`Defender${defenders.length > 1 ? "s" : ""} ${defenders.map((x) => shortName(x?.n || "")).join(", ")} (guarding about ${Math.round(share * 100)}% of his shots)`, dPts]);
  }
  const reb = b.reb * fPace, ast = b.ast * fPace * (1 + ((oDef - lgDef) / lgDef) * 0.5);
  const sd = 0.3 * pts + 3;
  return { min: b.min, pts, reb, ast, lo: Math.max(0, pts - 1.28 * sd), hi: pts + 1.28 * sd, base: b, parts, opps, oDef, oPace };
}
function projCard(res, title, note = "") {
  if (!res) return `<p class="small muted">Not enough data to project this matchup.</p>`;
  const ar = (v, base) => { const d = v - base; return Math.abs(d) < 0.15 ? "" : `<span class="${d > 0 ? "up" : "down"}"> ${d > 0 ? "▲" : "▼"}${f1(Math.abs(d))}</span>`; };
  return `<div class="pv"><h3>${esc(title)}</h3>
    <div class="statgrid sg4"><div class="stat"><b>${f1(res.pts)}</b><span>Points (${f0(res.lo)}-${f0(res.hi)})${ar(res.pts, res.base.pts)}</span></div><div class="stat"><b>${f1(res.reb)}</b><span>Rebounds${ar(res.reb, res.base.reb)}</span></div><div class="stat"><b>${f1(res.ast)}</b><span>Assists${ar(res.ast, res.base.ast)}</span></div><div class="stat"><b>${f1(res.min)}</b><span>Minutes</span></div></div>
    <ul class="plain small pv-parts">${res.parts.map(([k, v], i) => `<li class="spread"><span>${esc(k)}</span><span class="num ${i && v > 0 ? "up" : i && v < 0 ? "down" : ""}">${i ? (v > 0 ? "+" : "") : ""}${f1(v)} pts</span></li>`).join("")}</ul>
    <p class="small muted">Projected from our data even with no head-to-head games: his ${res.base.g ? "2026-27" : "2025-26"} per-game rates (blended with last season while this season is short), the matchup pace (${f1(res.oPace)}) and ${esc(res.opps.map((t) => t.abbr).join(", "))}'s current-season (2026-27) defence and roster.${note ? " " + note : ""} Arrows compare with his season average. For comparison only; game-day projections come from the full model.</p></div>`;
}
function projZones(offRows, defTeams, kOff) {
  return (offRows || []).map((x) => {
    const lg = (x.lgPct ?? 0) / 100, hp = ((x.made ?? 0) + kOff * lg) / ((x.att ?? 0) + kOff);
    let da = 0, dm = 0; for (const t of defTeams) { const z = t.zones14?.def?.find((y) => y.id === x.id); if (z) { da += z.att; dm += z.made; } }
    const proj = Math.min(0.95, Math.max(0.05, hp + (dm + 150 * lg) / (da + 150) - lg)), d = (proj - lg) * 100;
    return { id: x.id, att: x.att, made: x.made, pct: Math.round(proj * 1000) / 10, lgPct: x.lgPct, diff: Math.round(d * 10) / 10, tag: d >= 4 ? "hot" : d <= -4 ? "cold" : "neutral", low: (x.att ?? 0) < 10 ? 1 : undefined };
  });
}
async function teamVersus(t) {
  const box = document.getElementById("tv-out"), ctl = document.getElementById("tv-ctl"); if (!box || !ctl) return;
  const st = { vs: "team", opp: (S.upList || []).map((g) => (g.home === t.id ? g.away : g.away === t.id ? g.home : null)).find(Boolean) || (S.teams || []).find((x) => x.id !== t.id)?.id, pl: null };
  const R = await load("results.json").catch(() => []);
  const plist = Object.values(S.P || {}).filter((q) => q.team !== t.id).sort((a, b) => a.n.localeCompare(b.n));
  const others = (S.teams || []).filter((x) => x.id !== t.id).sort((a, b) => a.name.localeCompare(b.name));
  const drawCtl = () => {
    ctl.innerHTML = st.vs === "team" ? `<select class="field" id="tv-team">${others.map((x) => `<option value="${esc(x.id)}"${x.id === st.opp ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`
      : `${pickerHTML("tv-pin")}${st.pl ? `<p class="small">Selected: <b>${esc(st.pl.n)}</b></p>` : ""}`;
    ctl.querySelector("#tv-team")?.addEventListener("change", (e) => { st.opp = e.target.value; draw(); });
    bindPicker(ctl.querySelector("#tv-pin"), plist, (q) => { st.pl = q; drawCtl(); draw(); });
  };
  const draw = async () => {
    if (st.vs === "team") {
      const o = S.T[st.opp]; if (!o) { box.innerHTML = ""; return; }
      const mine = projZones(t.zones14?.off, [o], 80), theirs = projZones(o.zones14?.off, [t], 80);
      const h2h = R.filter((g) => (g.home === t.id && g.away === o.id) || (g.home === o.id && g.away === t.id)).sort((a, b) => b.date.localeCompare(a.date));
      const w = h2h.filter((g) => (g.home === t.id ? g.act.hs > g.act.as : g.act.as > g.act.hs)).length;
      const best = (rows) => [...rows].filter((x) => !x.low).sort((a, b) => b.diff - a.diff);
      const lgOff = lgStyle("off"), pace = ((t.style?.pace || 100) + (o.style?.pace || 100)) / 2;
      const ptsT = (t.style.off * o.style.def / lgOff) * pace / 100, ptsO = (o.style.off * t.style.def / lgOff) * pace / 100, mg = ptsT - ptsO, pW = 1 - pNorm(-mg / 13);
      const scoreCard = `<div class="pv"><h3>Projected on a neutral court</h3><div class="statgrid sg4"><div class="stat"><b>${f1(ptsT)}</b><span>${esc(t.abbr)} points</span></div><div class="stat"><b>${f1(ptsO)}</b><span>${esc(o.abbr)} points</span></div><div class="stat"><b>${pct(pW)}</b><span>${esc(t.abbr)} wins</span></div><div class="stat"><b>${f1(pace)}</b><span>pace</span></div></div><p class="small muted">From both teams' current-season (2026-27) offence and defence per 100 possessions and their pace; works even if they have not met. Home court adds about 2 points. The game page has the full-model projection when they actually play.</p></div>`;
      box.innerHTML = scoreCard + `<div class="tv-cmp"><div><b>${esc(t.abbr)}</b><span>net ${sg(t.ratings?.adjNet)} · pace ${f1(t.style?.pace)}</span><span class="small muted">${esc((t.style?.tags || []).join(", ") || "-")}</span></div><div><b>${esc(o.abbr)}</b><span>net ${sg(o.ratings?.adjNet)} · pace ${f1(o.style?.pace)}</span><span class="small muted">${esc((o.style?.tags || []).join(", ") || "-")}</span></div></div>
        <p class="small vs-rec"><b>Head-to-head since October 2025:</b> ${h2h.length ? `${esc(t.abbr)} ${w}-${h2h.length - w}. ${h2h.slice(0, 4).map((g) => `${esc(new Date(g.date).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "2-digit" }))}: ${esc(T(g.away).abbr)} ${g.act.as}-${g.act.hs} ${esc(T(g.home).abbr)}`).join(" · ")}` : "no meetings yet."}</p>
        <div class="grid two"><div><h3>${esc(t.abbr)} offence vs ${esc(o.abbr)} defence</h3>${hz14Figure(mine, "off", `${t.name} offence projected vs ${o.name}`)}<p class="small">Best: ${best(mine).slice(0, 2).map((x) => `${esc(Z14_NAMES[x.id])} ${x.pct}%`).join(", ")}. Toughest: ${best(mine).slice(-2).reverse().map((x) => `${esc(Z14_NAMES[x.id])} ${x.pct}%`).join(", ")}.</p></div>
        <div><h3>${esc(o.abbr)} offence vs ${esc(t.abbr)} defence</h3>${hz14Figure(theirs, "off", `${o.name} offence projected vs ${t.name}`)}<p class="small">Best for them: ${best(theirs).slice(0, 2).map((x) => `${esc(Z14_NAMES[x.id])} ${x.pct}%`).join(", ")}. Toughest: ${best(theirs).slice(-2).reverse().map((x) => `${esc(Z14_NAMES[x.id])} ${x.pct}%`).join(", ")}.</p></div></div>
        <p class="small muted">Projected FG% by zone = the offence's zone FG% (shrunk with 80 attempts) plus the defence's gap to league in that zone (shrunk with 150). Red = better than league, blue = worse.</p>`;
    } else {
      if (!st.pl) { box.innerHTML = `<p class="small muted">Type a player's name above.</p>`; return; }
      const q = await load(`players/${st.pl.id}.json`).catch(() => null);
      if (!q?.zones14?.rows?.length) { box.innerHTML = `<p class="small muted">No zone shooting on record for ${esc(st.pl.n)}.</p>`; return; }
      const rows = projZones(q.zones14.rows, [t], 25), ptm = playTypeMatchup(q, t.id), sp = (q.splits?.best || []).concat(q.splits?.worst || []).find((x) => x.key === `opp:${t.id}`);
      box.innerHTML = projCard(projVs(q.id, q.team, [t.id], [], q.zones14.rows), `${q.n} projected vs the ${t.name}`) + `<p class="small vs-rec"><b>${esc(q.n)} vs ${esc(t.abbr)}:</b> ${sp ? `${sp.n} games, ${sp.pts > 0 ? "+" : ""}${f1(sp.pts)} pts against his usual gap to our projections${sp.n < 10 ? " (small sample)" : ""}. ` : "No head-to-head split yet (needs 5+ games). "}${ptm ? `Play-type matchup: ${ptm.delta > 0 ? "+" : ""}${f1(ptm.delta)} pts (${num(ptm.n)} possessions, shown only).` : ""}</p>
        <h3>${esc(q.n)} vs the ${esc(t.name)} defence</h3>${hz14Figure(rows, "off", `${q.n} projected vs ${t.name}`)}
        <p class="small muted">His zone FG% (shrunk with 25 attempts) plus this defence's gap to league in each zone. <a href="#/scout/${esc(q.id)}">His full scouting report ›</a></p>`;
    }
  };
  document.querySelectorAll("[data-tv]").forEach((b) => b.addEventListener("click", () => { st.vs = b.dataset.tv; document.querySelectorAll("[data-tv]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); drawCtl(); draw(); }));
  drawCtl(); draw();
}
async function vTeam(id) {
  const t = S.T[id]; if (!t) throw new Error("Unknown team");
  const [plist, upl] = await Promise.all([load("players.json"), load("upcoming.json").catch(() => [])]);
  S.upList = upl;
  const players = plist.filter((p) => p.team === id && p.cur).sort((a, b) => b.cur[2] - a.cur[2]);
  const ff = t.nba?.fourFactors, st = t.style, r = t.ratings || {};
  const vs = t.vsStyle || [];
  app.innerHTML = `<a class="back" href="#/teams">‹ All teams</a>
    <header class="ehead">${teamLogo(id, { size: "xl" })}<div class="ehead-b"><h1>${esc(t.name)}</h1>
      <p class="ehead-m">${esc(t.record.w)}-${esc(t.record.l)} this season${t.coach ? ` · Head coach ${esc(t.coach)}` : ""}</p>${favBtn("t", id, t.name)}</div></header>
    <section class="card" id="t-vs"><h2>Versus: compare against a team or a player</h2>
      <div class="filters" role="group" aria-label="Against"><button class="fbtn" type="button" data-tv="team" aria-pressed="true">vs team</button><button class="fbtn" type="button" data-tv="player" aria-pressed="false">vs player</button></div>
      <div id="tv-ctl"></div><div id="tv-out" aria-live="polite"></div></section>
    ${(() => { const g = (S.upList || []).find((x) => x.home === id || x.away === id); return g ? `<a class="card next-cta" href="#/game/${esc(g.id)}"><span><b>Next game: ${g.home === id ? "vs" : "at"} ${esc(T(g.home === id ? g.away : g.home).name)}</b><span class="small muted">${esc(dayLong(g.date))} · ${esc(timePH(g.date))}</span></span><span class="num"><b>${pct(g.home === id ? g.pred.pHome : 1 - g.pred.pHome)}</b><span class="small muted">win chance</span></span></a>` : ""; })()}
    <div class="card"><h2>Strength</h2>
      <div class="statgrid">
        <div class="stat"><b>${sg(r.adjNet)}</b><span>Net, schedule-adjusted</span></div>
        <div class="stat"><b>${f1(st.off)}</b><span>Offence /100</span></div>
        <div class="stat"><b>${f1(st.def)}</b><span>Defence /100</span></div>
        <div class="stat"><b>${f1(st.pace)}</b><span>Pace</span></div>
        <div class="stat"><b>${f0(r.elo)}</b><span>Elo</span></div>
        <div class="stat"><b>${sg(r.threeLuck)}</b><span>3-pt luck</span></div>
      </div>
      <p class="small muted" style="margin-top:8px">3-pt luck is how many points per 100 possessions of their record came from unusually hot or cold three-point shooting (theirs and their opponents'). Positive tends to fade.</p>
      ${glossary(["net", "per100", "pace", "elo"])}
      ${t.vsModel ? `<p class="note">Model blind spot check: over the last ${t.vsModel.n} games this team has run <b>${sg(t.vsModel.net)}</b> points per game versus projection (${sg(t.vsModel.off)} on offence, ${sg(-t.vsModel.def)} on defence). ${Math.abs(t.vsModel.net) >= 5 ? "That is large, so projections for them are being pulled in that direction." : ""}</p>` : ""}
    </div>
    <div class="grid two">
      <div class="card"><h2>Playing style</h2>
        <div class="chips">${st.tags.map((x) => `<span class="chip">${esc(x)}</span>`).join("") || `<span class="chip">Balanced</span>`}</div>
        <dl class="kv" style="margin-top:10px">
          <dt>Shots that are threes</dt><dd>${pct(st.tpar)}</dd>
          <dt>Points in the paint</dt><dd>${f1(st.paint)}</dd>
          <dt>Fast-break points</dt><dd>${f1(st.fb)}</dd>
          <dt>Bench points</dt><dd>${f1(st.benchPts)}</dd>
          ${ff ? `<dt>Effective FG% (own / allowed)</dt><dd>${f1(ff.efg)} / ${f1(ff.oppEfg)}</dd><dt>Turnover % (own / forced)</dt><dd>${f1(ff.tov)} / ${f1(ff.oppTov)}</dd><dt>Offensive rebound %</dt><dd>${f1(ff.orb)}</dd><dt>Free-throw rate</dt><dd>${f1(ff.ftr)}</dd>` : ""}
          ${t.nba?.hustle ? `<dt>Deflections / contested shots</dt><dd>${f1(t.nba.hustle.deflections)} / ${f1(t.nba.hustle.contests)}</dd>` : ""}
        </dl></div>
      <div class="card"><h2>Coach tendencies${t.coach ? `: ${esc(t.coach)}` : ""}</h2>
        <div class="chips">${(t.coachTags || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("") || `<span class="chip">No strong tendencies yet</span>`}</div>
        <dl class="kv" style="margin-top:10px">
          <dt>Players getting 12+ minutes</dt><dd>${f1(st.depth)}</dd>
          <dt>Share of minutes to starters</dt><dd>${pct(st.starterShare)}</dd>
        </dl>
        <h3>Points allowed by position (vs league)</h3>
        <dl class="kv">${[["G", "Guards"], ["F", "Forwards"], ["C", "Centres"]].map(([k, l]) => `<dt>${l}</dt><dd class="${cls(-(t.allowed[k].pts - 1))}">${sg((t.allowed[k].pts - 1) * 100, 0)}%</dd>`).join("")}</dl>
      </div>
    </div>
    ${teamFlowCards(t)}
    ${teamScout(t)}
    <div class="card"><h2>Strengths and weaknesses by opponent type</h2>
      <p class="small muted">Points per game better or worse than projected when facing each kind of team.</p>
      ${vs.length ? `<div class="tw"><table><thead><tr><th>Against</th><th class="n">Games</th><th class="n">Offence</th><th class="n">Defence</th><th class="n">Net</th></tr></thead>
      <tbody>${[...vs].sort((a, b) => b.net - a.net).map((v) => `<tr><td>${esc(v.k)} teams</td><td class="n">${v.n}</td><td class="n">${sg(v.off)}</td><td class="n">${sg(-v.def)}</td><td class="n ${cls(v.net)}"><b>${sg(v.net)}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">Not enough games yet.</p>`}
      ${t.vsTeam?.length ? `<details class="more"><summary>Versus specific teams</summary><div class="chips">${[...t.vsTeam].sort((a, b) => b.margin - a.margin).map((v) => `<span class="chip">${esc(T(v.t).abbr)} ${sg(v.margin)} (${v.n})</span>`).join("")}</div></details>` : ""}
    </div>
    ${t.lineups?.length ? `<div class="card"><h2>Most-used five-man lineups</h2><div class="tw"><table><thead><tr><th>Lineup</th><th class="n">Min</th><th class="n">Net</th></tr></thead>
      <tbody>${t.lineups.map((l) => `<tr><td>${esc(l.group)}</td><td class="n">${l.min}</td><td class="n ${cls(l.net)}">${sg(l.net)}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Source: NBA.com, ${esc(t.lineups[0].season)}.</p></div>` : ""}
    <div class="card"><h2>Roster</h2><div class="tgrid">${players.map((p) => playerItem(p, false)).join("") || `<p class="small muted">No players with games this season yet.</p>`}</div></div>
    <div class="card"><h2>Last 10 games</h2><div class="chips">${t.last10.slice().reverse().map((g) => `<span class="chip ${g.pts > g.oppPts ? "good" : "bad"}">${g.pts > g.oppPts ? "W" : "L"} ${g.home ? "vs" : "at"} ${esc(T(g.opp).abbr)} ${g.pts}-${g.oppPts}</span>`).join("")}</div></div>
    ${t.news?.length ? `<div class="card"><h2>Latest coverage</h2>${t.news.map(takeRow).join("")}</div>` : ""}`;
  teamVersus(t);
}

// ---------------------------------------------------------------- Players
// One player in a list: face (with his team's logo on the corner unless withTeam is false), name, role line, season line.
// Call it as playerItem(p) or playerItem(p, false) - not as a bare .map(playerItem), which would pass the index as withTeam.
const favMark = (kind, id) => (isFav(kind, id) ? `<span class="fav-mark" aria-label="favourite">★</span> ` : "");
const playerItem = (p, withTeam = true) => `<a class="titem" href="#/player/${esc(p.id)}">${avatar(p.id, p.n, { size: "md", team: withTeam ? p.team : null })}
  <span><span class="t1">${favMark("p", p.id)}${esc(p.n)}</span><span class="t2">${[withTeam ? esc(T(p.team).abbr) : "", esc(p.pos || ""), esc(p.arch || ""), p.k2 ? "2K " + esc(p.k2) + " (unofficial)" : ""].filter(Boolean).join(" · ")}</span></span>
  <span class="t3">${p.cur ? `<b>${f1(p.cur[2])}</b> pts<br><span class="muted small">${f1(p.cur[3])} reb · ${f1(p.cur[4])} ast</span>` : `<span class="muted small">no games yet</span>`}</span></a>`;
// One player in the Scout list: face, name, playstyle tags, and his hot and cold zones written out.
function scoutItem(p) {
  const z = (ids) => ids.map((i) => ZONE_WORD[i] || i).join(", ");
  const spots = [p.hot?.length ? `${ztag("hot")} ${esc(z(p.hot))}` : "", p.cold?.length ? `${ztag("cold")} ${esc(z(p.cold))}` : ""].filter(Boolean).join(" &nbsp; ");
  return `<a class="titem" href="#/scout/${esc(p.id)}">${avatar(p.id, p.n, { size: "md", team: p.team })}
    <span><span class="t1">${favMark("p", p.id)}${esc(p.n)}</span><span class="t2">${[esc(T(p.team).abbr), esc(p.pos || ""), esc((p.tags || []).slice(0, 2).join(", "))].filter(Boolean).join(" · ")}</span>
      <span class="t2 spots">${spots || "No hot or cold zone on record"}</span></span>
    <span class="t3">${p.cur ? `<b>${f1(p.cur[2])}</b> pts` : `<span class="muted small">no games yet</span>`}</span></a>`;
}
// The player search behind both #/scout (scouting reports) and #/players (plain profiles). Same list, different destination.
// Next-game outlook for the Scout list: our projection for his next game against his season average, with the reasons
// behind the gap (minutes, opponent defence, pace, matchups, teammates out, scenarios, blowout risk). From our model only.
async function nextGameOutlook() {
  if (S.outlook) return S.outlook;
  const up = await load("upcoming.json").catch(() => []);
  const future = up.filter((u) => Date.parse(u.date) > Date.now()).sort((a, b) => a.date.localeCompare(b.date));
  if (!future.length) return (S.outlook = { day: null, rows: [] });
  const day = dayKey(future[0].date), games = future.filter((u) => dayKey(u.date) === day);
  const full = (await Promise.all(games.map((u) => load(`upcoming/${u.id}.json`).catch(() => null)))).filter(Boolean);
  const rows = [];
  for (const g of full) for (const t of g.teams) {
    const opp = g.teams.find((x) => x !== t);
    for (const p of (t.players || []).filter((x) => x.min >= 15)) {
      const sp = S.P?.[String(p.id)], c = sp?.cur, b0 = seasonLine(sp); if (!b0) continue;
      const b = c && c[0] >= 5 ? { min: c[1], pts: c[2], reb: c[3], ast: c[4], g: c[0], basis: `this-season average (${c[0]} games)` } : { ...b0, basis: `average (only ${c?.[0] || 0} games this season, so blended with last season)` };
      if (!(b.pts > 3)) continue;
      const delta = p.pts - b.pts, pctd = delta / b.pts, why = [];
      if (b.min > 0 && Math.abs(p.min - b.min) >= 2.5) why.push([Math.abs(p.min - b.min) * (b.pts / b.min), `${p.min > b.min ? "more" : "fewer"} minutes: ${f0(p.min)} projected vs his ${f0(b.min)}`]);
      if (p.adj?.defense && Math.abs(p.adj.defense - 1) >= 0.03) why.push([Math.abs(p.adj.defense - 1) * b.pts, `${esc(T(opp.tid).abbr)} defence ${p.adj.defense < 1 ? "is tough on" : "is soft on"} players like him (${p.adj.defense > 1 ? "+" : ""}${Math.round((p.adj.defense - 1) * 100)}%)`]);
      if (p.adj?.pace && Math.abs(p.adj.pace - 1) >= 0.02) why.push([Math.abs(p.adj.pace - 1) * b.pts, `${p.adj.pace > 1 ? "faster" : "slower"} game pace (${p.adj.pace > 1 ? "+" : ""}${Math.round((p.adj.pace - 1) * 100)}%)`]);
      for (const sc of (p.scen || []).filter((x) => Math.abs(x.pts) >= 0.4).sort((a, b2) => Math.abs(b2.pts) - Math.abs(a.pts)).slice(0, 2)) why.push([Math.abs(sc.pts), `${sc.s} (${sc.pts > 0 ? "+" : ""}${f1(sc.pts)} pts, learned from ${num(sc.n)} player-games)`]);
      if (p.zm?.tag && !/neutral/.test(p.zm.tag)) why.push([Math.abs(p.zm.paper || 0.5), `zone matchup: ${p.zm.tag} (${(ZONE_FALLBACK[p.zm.zone] || p.zm.zone).toLowerCase()})`]);
      const mate = (p.wwD || []).filter((w) => Math.abs(w.pts) >= 0.8).sort((a, b2) => Math.abs(b2.pts) - Math.abs(a.pts))[0];
      if (mate) why.push([Math.abs(mate.pts), `${shortName(mate.n)} out (${mate.pts > 0 ? "+" : ""}${f1(mate.pts)} pts in his record without him)`]);
      const bo = p.ix?.blowout; if (bo && p.min >= 26 && bo.winBy15 + bo.loseBy15 >= 0.35) why.push([1, `blowout risk ${pct(bo.winBy15 + bo.loseBy15)}: starters may sit late`]);
      if (p.q) why.push([2, "listed questionable"]);
      why.sort((a, b2) => b2[0] - a[0]);
      rows.push({ id: String(p.id), n: p.n, team: t.tid, opp: opp.tid, gid: g.id, date: g.date, home: t.isHome, proj: p, base: b, delta, pctd, why: why.map((x) => x[1]).slice(0, 4), unexplained: Math.abs(pctd) > 0.3 && !why.length });
    }
  }
  return (S.outlook = { day, date: future[0].date, rows });
}
async function playerIndex(scout) {
  const all = (await load("players.json")).slice().sort((a, b) => (b.cur?.[2] ?? -1) - (a.cur?.[2] ?? -1));
  const zones = S.meta?.scout?.zones || FIVE.map((id) => ({ id, label: ZONE_FALLBACK[id] }));
  app.innerHTML = scout
    ? `<h1>Scout</h1><p class="lead">Pick a player to see his strengths and weaknesses, his hot and cold zones on a court map, how shooters do against him, his playstyle and culture indicators, and how his zones line up against any opponent.</p>`
    : `<h1>Players</h1><p class="lead">Search any player for his matchup history, what happens to teammates when he scores more, and what changes when he sits. For hot and cold zones, strengths and weaknesses, open <a href="#/scout">Scout</a>.</p>`;
  app.insertAdjacentHTML("beforeend", `<input class="field" id="q" type="search" placeholder="Search by player or team name" aria-label="Search players" autocomplete="off" value="${esc(S.q || "")}">
    ${scout ? `<div class="filters" role="group" aria-label="Next game outlook" style="margin-top:8px"><button class="fbtn" type="button" data-ol="" aria-pressed="${!S.ol}">All players</button><button class="fbtn" type="button" data-ol="hot" aria-pressed="${S.ol === "hot"}">🔥 Likely hot next game</button><button class="fbtn" type="button" data-ol="cold" aria-pressed="${S.ol === "cold"}">🧊 Likely cold next game</button></div>` : ""}
    ${scout ? `<select class="field" id="zf" aria-label="Filter by hot or cold zone" style="margin-top:8px">
      <option value="">Any zone profile</option>
      <optgroup label="Hot zone">${zones.map((z) => `<option value="hot:${esc(z.id)}"${S.zf === `hot:${z.id}` ? " selected" : ""}>Hot: ${esc(z.label)}</option>`).join("")}</optgroup>
      <optgroup label="Cold zone">${zones.map((z) => `<option value="cold:${esc(z.id)}"${S.zf === `cold:${z.id}` ? " selected" : ""}>Cold: ${esc(z.label)}</option>`).join("")}</optgroup>
    </select>` : ""}
    <p class="small muted" id="pcount" role="status" style="margin:10px 0 8px"></p>
    <div class="tgrid" id="plist"></div>
    ${scout ? `<p class="small muted" style="margin-top:12px">HOT and COLD follow one rule for everyone: at least ${esc(S.meta?.scout?.zoneTagRule?.minAtt?.five ?? 30)} attempts in the zone, FG% at least ${esc(S.meta?.scout?.zoneTagRule?.minDiff ?? 3)} points away from the league there, and at least ${esc(S.meta?.scout?.zoneTagRule?.minZ ?? 1.5)} standard errors away. Counted over ${esc(S.meta?.scout?.window || "last season and this season")}.</p>` : ""}`);
  const drawOutlook = async () => {
    const O = await nextGameOutlook(), q = (S.q || "").trim().toLowerCase();
    let rows = O.rows.filter((x) => !q || x.n.toLowerCase().includes(q) || T(x.team).name.toLowerCase().includes(q));
    rows = S.ol === "hot" ? rows.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta) : rows.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta);
    rows = rows.slice(0, 40);
    document.getElementById("pcount").textContent = O.day ? `${S.ol === "hot" ? "Most likely to score above" : "Most likely to score below"} their season average in their next game (${day(O.date)}, PH time): our projection against this season's average, biggest gaps first.` : "No upcoming games right now.";
    document.getElementById("plist").innerHTML = rows.map((x) => { const p = S.P?.[x.id] || { id: x.id, n: x.n, team: x.team };
      return `<div class="ol-item">${scoutItem(p)}<div class="ol-why small"><div><b class="${x.delta > 0 ? "up" : "down"}">${x.delta > 0 ? "▲" : "▼"} ${f1(x.proj.pts)} pts projected vs his ${f1(x.base.pts)} ${esc(x.base.basis)} (${x.delta > 0 ? "+" : ""}${f1(x.delta)}, ${x.pctd > 0 ? "+" : ""}${Math.round(x.pctd * 100)}%)</b> ${x.home ? "vs" : "at"} ${esc(T(x.opp).abbr)} · ${f1(x.proj.reb)} reb · ${f1(x.proj.ast)} ast</div>
        ${x.why.length ? `<ul class="dots">${x.why.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
        ${x.unexplained ? `<div style="color:var(--warn)">⚠ No injury, minutes or matchup reason explains a gap this size: treat with caution.</div>` : !x.why.length ? `<div class="muted">Small gap with no single big reason: mostly his recent form and team context.</div>` : ""}
        <a class="go" href="#/game/${esc(x.gid)}">Game page ›</a></div></div>`; }).join("") || `<p class="empty">No player matches.</p>`;
  };
  const draw = () => {
    if (scout && S.ol) return drawOutlook();
    const q = (S.q || "").trim().toLowerCase(), [zk, zid] = scout && S.zf ? S.zf.split(":") : [];
    let found = q ? all.filter((p) => p.n.toLowerCase().includes(q) || T(p.team).name.toLowerCase().includes(q)) : all;
    if (zk) found = found.filter((p) => (p[zk] || []).includes(zid));
    found = favFirst(found, "p");
    const rows = found.slice(0, 60);
    document.getElementById("pcount").textContent = found.length > rows.length ? `Showing the top ${rows.length} of ${found.length.toLocaleString()} players by points per game. Search to narrow it down.` : `${found.length.toLocaleString()} ${found.length === 1 ? "player" : "players"}`;
    document.getElementById("plist").innerHTML = rows.map((p) => (scout ? scoutItem(p) : playerItem(p))).join("") || `<p class="empty">No player matches that search.</p>`;
  };
  document.getElementById("q").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
  document.getElementById("zf")?.addEventListener("change", (e) => { S.zf = e.target.value; draw(); });
  app.querySelectorAll("[data-ol]").forEach((b) => b.addEventListener("click", () => { S.ol = b.dataset.ol; app.querySelectorAll("[data-ol]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); const zf = document.getElementById("zf"); if (zf) zf.hidden = !!S.ol; draw(); }));
  if (S.ol) { const zf = document.getElementById("zf"); if (zf) zf.hidden = true; }
  draw();
}
const vPlayers = () => playerIndex(false);

// ---------------------------------------------------------------- Scout: one player's scouting report
const EV_KIND = {
  zone: ["Shot zone", "attempts", "FG%"], style: ["Shot type", "attempts", "FG%"], playtype: ["Play type", "possessions", "pts / possession"],
  defense: ["Defence", "shots defended", "FG% allowed"], split: ["Situation", "games", "pts vs expected"], clutch: ["Clutch", "clutch shots", "clutch FG%"],
  culture: ["Indicator", "games", ""], quarter: ["By quarter", "games", "of his points"], matchup: ["Zone matchup", "", "pts on paper"],
};
// One strength or weakness: the headline number pulled out of the sentence, the sentence itself, and the sample behind it.
function evCard(s) {
  const [kind, unit, numLabel] = EV_KIND[s.k] || ["Evidence", "", ""];
  const t = String(s.t ?? ""), i = t.indexOf(": "), title = i > 0 ? t.slice(0, i) : kind, body = i > 0 ? t.slice(i + 2) : t;
  const m = numLabel ? /[+\-−]?\d+(?:\.\d+)?%?/.exec(body) : null;
  const sample = s.n == null ? `<span class="chip">On paper, not a measured result</span>`
    : `<span class="chip${unit === "games" && s.n < 5 ? " warn" : ""}">${esc(num(s.n))} ${esc(unit)}${unit === "games" && s.n < 10 ? ` · ${sampleWord(s.n)} sample` : ""}</span>`;
  return `<li class="ev${m ? "" : " nov"}">${m ? `<div class="ev-v"><b>${esc(m[0].replace("-", "−"))}</b><span>${esc(numLabel)}</span></div>` : ""}
    <div class="ev-b"><span class="why-k">${esc(kind)}</span><p><b>${esc(title)}</b>${i > 0 ? `: ${esc(body)}` : ""}</p>${sample}</div></li>`;
}
function scoutSW(p) {
  const sc = p.scout, col = (list, title, sign, empty) => `<section><h3><span class="why-s" aria-hidden="true">${sign}</span> ${title}</h3>${list?.length ? `<ul class="evs">${list.map(evCard).join("")}</ul>` : `<p class="small muted">${empty}</p>`}</section>`;
  return `<section class="card" id="s-sw" tabindex="-1" aria-labelledby="s-sw-h"><h2 id="s-sw-h">Strengths and weaknesses</h2>
    ${sc ? `<p class="small muted">Each card is one measured fact with the sample behind it, strongest evidence first. Nothing here is an opinion about him.</p>
      <div class="grid two why-g">${col(sc.strengths, "Strengths", "+", "Nothing has cleared the evidence bar as a strength yet.")}${col(sc.weaknesses, "Weaknesses", "−", "Nothing has cleared the evidence bar as a weakness yet.")}</div>`
    : `<p class="small muted">Not enough games on record to list strengths and weaknesses.</p>`}</section>`;
}
function scoutMap(p) {
  const z = p.zones;
  if (!z?.fine?.length) return `<section class="card" id="s-map" tabindex="-1"><h2>Shot map</h2><p class="small muted">No shot locations on record for him yet.</p></section>`;
  const r = z.rule || {}, styles = (p.styles || []).filter((s) => s.att >= 10), fewStyles = (p.styles || []).length - styles.length;
  const hot = z.five.filter((x) => x.tag === "hot"), cold = z.five.filter((x) => x.tag === "cold");
  const spot = (rows) => rows.map((x) => `${esc(ZONE_WORD[x.id] || x.label)} (${p1(x.pct)} on ${esc(num(x.att))})`).join(", ");
  return `<section class="card" id="s-map" tabindex="-1" aria-labelledby="s-map-h"><h2 id="s-map-h">Shot map: hot and cold spots</h2>
    <p class="small">${hot.length ? `${ztag("hot")} ${spot(hot)}. ` : ""}${cold.length ? `${ztag("cold")} ${spot(cold)}. ` : ""}${!hot.length && !cold.length ? "No zone has cleared the hot or cold rule yet. " : ""}</p>
    ${courtFigure("p-off", zoneCells(z.fine, "off", "his"), `${p.n}: field-goal percentage and attempts by court zone`)}
    ${courtLegend("off")}
    ${hz14Card(p.zones14, "off", p.n, "2K-style hot zones (14 zones) and recent form")}
    <p class="small muted">Left and right are as you face the basket. ${esc(num(z.fga))} shots in ${esc(z.games)} games, ${esc(z.window)}. HOT and COLD need at least ${esc(r.minAtt?.fine ?? 20)} attempts in a zone (${esc(r.minAtt?.five ?? 30)} in the summary below), a gap of ${esc(r.minDiff ?? 3)} points of FG% to the league and ${esc(r.minZ ?? 1.5)} standard errors.${z.heaves?.[0] ? ` ${esc(z.heaves[0])} end-of-period heaves (${esc(z.heaves[1])} made) are left out.` : ""}</p>
    <h3>Five-zone summary</h3>${zoneTable(z.five, "off")}
    <details class="more"><summary>All ten zones as a table</summary>${zoneTable(z.fine, "off")}</details>
    ${styles.length ? `<details class="more"><summary>By type of shot (${styles.length})</summary><ul class="mrows">${styles.map((s) => meterRow({ label: esc(s.label), badge: ztag(s.tag), value: `${sg(s.diff)} vs league`, x: s.diff, scale: 15,
      sub: `${p1(s.pct)} on ${esc(num(s.att))} attempts (league ${p1(s.lgPct)} on this shot) · ${p1(s.share)} of his shots` })).join("")}</ul>
      <p class="small muted">Bar to the right (orange) = he makes this shot more often than the league does; to the left (blue) = less often. Full bar = 15 points of FG%.${fewStyles > 0 ? ` ${fewStyles} shot ${fewStyles === 1 ? "type" : "types"} with under 10 attempts ${fewStyles === 1 ? "is" : "are"} not listed.` : ""}</p></details>` : ""}
  </section>`;
}
// Player defence map: NBA.com tracks the closest defender by shot distance, so the map is drawn in distance rings.
// Rings that NBA.com does not give directly are derived: 6-10 ft = inside 10 minus inside 6; 10-15 ft = all twos minus
// inside 10 minus long twos. Colour = how shooters do against him versus what they normally make (blue = he holds them
// below their norm, red = they shoot better than usual).
function defMapFigure(d) {
  const R = Object.fromEntries((d.rows || []).map((x) => [x.id, x]));
  const made = (x) => (x ? (x.pct / 100) * x.fga : 0), expM = (x) => (x ? (x.exp / 100) * x.fga : 0);
  const band = (id, label, fga, m, e) => { if (!(fga > 0)) return null; const pct = (m / fga) * 100, exp = (e / fga) * 100, diff = pct - exp, z = (diff / 100) / Math.sqrt(Math.max(0.01, (exp / 100) * (1 - exp / 100)) / fga); return { id, label, fga: Math.round(fga), pct, exp, diff, tag: fga < 25 ? "low" : diff <= -2.5 && z <= -1.5 ? "strong" : diff >= 2.5 && z >= 1.5 ? "weak" : "n" }; };
  const rim = R.rim, sh = R.short, two = R.two, mid = R.mid, th = R.three;
  const b = [
    band("rim", "Inside 6 ft", rim?.fga, made(rim), expM(rim)),
    sh && rim ? band("s610", "6-10 ft", sh.fga - rim.fga, made(sh) - made(rim), expM(sh) - expM(rim)) : null,
    two && sh && mid ? band("s1015", "10-15 ft", two.fga - sh.fga - mid.fga, made(two) - made(sh) - made(mid), expM(two) - expM(sh) - expM(mid)) : null,
    band("mid", "Long twos (15 ft to the arc)", mid?.fga, made(mid), expM(mid)),
    band("three", "Threes", th?.fga, made(th), expM(th)),
  ];
  const by = Object.fromEntries(b.filter(Boolean).map((x) => [x.id, x]));
  if (!Object.keys(by).length) return "";
  const K = 10, hx = 250, hy = 52.5, r3 = 237.5, yb = hy + Math.sqrt(r3 * r3 - 220 * 220), H = 330;
  const fill = (x) => (!x ? "hz-low" : x.tag === "low" ? "hz-low" : x.tag === "strong" ? "hz-c2" : x.tag === "weak" ? "hz-h2" : x.diff <= -1.5 ? "hz-c1" : x.diff >= 1.5 ? "hz-h1" : "hz-n");
  const three = `M30 -10 V${yb.toFixed(1)} A${r3} ${r3} 0 0 0 470 ${yb.toFixed(1)} V-10Z`;
  const ring = (r) => `<circle cx="${hx}" cy="${hy}" r="${r}"/>`;
  const lab = (x, cx, cy) => (x ? `<text class="hz-t${x.tag === "low" ? " sm" : ""}" x="${cx}" y="${cy}">${Math.round(x.pct)}%<tspan class="hz-ar ${x.diff <= 0 ? "dn" : "up"}" dx="3">${x.diff > 0 ? "+" : ""}${x.diff.toFixed(1)}</tspan></text>` : "");
  const tip = (x) => (x ? `${x.label}: shooters make ${x.pct.toFixed(1)}% against him vs ${x.exp.toFixed(1)}% normally (${x.fga} shots)` : "");
  return `<figure class="hz"><svg viewBox="0 0 500 ${H}" role="img" aria-label="${esc(Object.values(by).map(tip).join("; "))}">
    <defs><clipPath id="dm-in"><path d="${three}"/></clipPath><mask id="dm-out"><rect width="500" height="${H}" fill="#fff"/><path d="${three}" fill="#000"/></mask></defs>
    <rect class="hz-bg" width="500" height="${H}"/>
    <rect class="hz-z ${fill(by.three)}" width="500" height="${H}" mask="url(#dm-out)"><title>${esc(tip(by.three))}</title></rect>
    <g clip-path="url(#dm-in)">
      <rect class="hz-z ${fill(by.mid)}" width="500" height="${H}"><title>${esc(tip(by.mid))}</title></rect>
      <circle class="hz-z ${fill(by.s1015)}" cx="${hx}" cy="${hy}" r="150"><title>${esc(tip(by.s1015))}</title></circle>
      <circle class="hz-z ${fill(by.s610)}" cx="${hx}" cy="${hy}" r="100"><title>${esc(tip(by.s610))}</title></circle>
      <circle class="hz-z ${fill(by.rim)}" cx="${hx}" cy="${hy}" r="60"><title>${esc(tip(by.rim))}</title></circle>
    </g>
    <g class="hz-lines" fill="none"><path d="${three}"/>${ring(60)}${ring(100)}${ring(150)}<rect width="500" height="${H}"/></g>
    ${lab(by.rim, hx, hy + 8)}${lab(by.s610, hx, hy + 82)}${lab(by.s1015, hx, hy + 128)}${lab(by.mid, hx, hy + 196)}${lab(by.three, hx, H - 22)}
  </svg></figure>
  <div class="legend zlegend"><span><i class="hz-c2"></i>STRONG: shooters clearly below their norm</span><span><i class="hz-c1"></i>Below norm</span><span><i class="hz-n"></i>Near norm</span><span><i class="hz-h1"></i>Above norm</span><span><i class="hz-h2"></i>WEAK: shooters clearly above their norm</span><span><i class="hz-low"></i>Too few shots</span></div>
  <p class="small muted">Rings from the basket: inside 6 ft, 6-10 ft, 10-15 ft, long twos and threes. Each shows what shooters make with him as the closest defender, and the gap to what those same shooters normally make (negative = good defence). NBA.com tracks defenders by distance, not by court side, so left and right are not split.</p>`;
}
// ---------------- Matchup maps: projected FG% by zone against a chosen team, player(s) or playstyle
// Offence vs a team / playstyle: his zone FG% (shrunk toward league with 25 attempts) plus that defence's gap to the
// league in the same zone (shrunk with 150 attempts). Against defenders, and for his own defence, the data is by
// distance (NBA.com closest-defender tracking), so those maps are drawn in four rings.
const RING_OF = { rim: "rim", shL: "short", shC: "short", shR: "short", mBL: "mid", mWL: "mid", mT: "mid", mWR: "mid", mBR: "mid", tCL: "three", tWL: "three", tT: "three", tWR: "three", tCR: "three" };
const RINGS = [["rim", "Inside 6 ft"], ["short", "6-15 ft"], ["mid", "Long twos"], ["three", "Threes"]];
function ringsFromZ14(rows) { const o = Object.fromEntries(RINGS.map(([k]) => [k, { a: 0, m: 0 }])); for (const x of rows || []) { const k = RING_OF[x.id]; if (k && x.att) { o[k].a += x.att; o[k].m += x.made ?? (x.pct / 100) * x.att; } } return o; }
function defRingDiffs(d) { // his defence: shooters' FG% vs their norm, by ring (6-15 ft derived)
  const R = Object.fromEntries((d?.rows || []).map((x) => [x.id, x])); const mk = (x) => (x ? { a: x.fga, m: (x.pct / 100) * x.fga, e: (x.exp / 100) * x.fga } : null);
  const rim = mk(R.rim), two = mk(R.two), mid = mk(R.mid), th = mk(R.three);
  const sh = two && rim && mid ? { a: two.a - rim.a - mid.a, m: two.m - rim.m - mid.m, e: two.e - rim.e - mid.e } : null;
  const out = {}; for (const [k, v] of [["rim", rim], ["short", sh], ["mid", mid], ["three", th]]) if (v && v.a > 0) out[k] = { a: v.a, diff: ((v.m - v.e) / v.a) * (v.a / (v.a + 60)) }; return out;
}
const MM_LG = () => { if (S.mmLg) return S.mmLg; const o = Object.fromEntries(RINGS.map(([k]) => [k, { a: 0, m: 0 }])); const z = {}; for (const t of S.teams || []) for (const x of t.zones14?.off || []) { const k = RING_OF[x.id]; if (k) { o[k].a += x.att; o[k].m += x.made; } (z[x.id] ||= { a: 0, m: 0 }); z[x.id].a += x.att; z[x.id].m += x.made; } S.mmLg = { ring: Object.fromEntries(RINGS.map(([k]) => [k, o[k].a ? o[k].m / o[k].a : null])), zone: Object.fromEntries(Object.entries(z).map(([k, v]) => [k, v.a ? v.m / v.a : null])) }; return S.mmLg; };
function ringFigure(cells, legendMode = "off") {
  const hx = 250, hy = 52.5, r3 = 237.5, yb = hy + Math.sqrt(r3 * r3 - 220 * 220), H = 330, uid = "rf" + Math.random().toString(36).slice(2, 7);
  const cl = (c) => (!c || c.pct == null ? "hz-low" : c.low ? "hz-low" : c.d >= 4 ? "hz-h2" : c.d >= 1.5 ? "hz-h1" : c.d <= -4 ? "hz-c2" : c.d <= -1.5 ? "hz-c1" : "hz-n");
  const three = `M30 -10 V${yb.toFixed(1)} A${r3} ${r3} 0 0 0 470 ${yb.toFixed(1)} V-10Z`;
  const lab = (c, y) => (c && c.pct != null ? `<text class="hz-t" x="${hx}" y="${y}">${Math.round(c.pct)}%<tspan class="hz-ar ${c.d >= 0 ? "up" : "dn"}" dx="3">${c.d > 0 ? "+" : ""}${c.d.toFixed(1)}</tspan></text>` : "");
  const tip = (c, n) => (c && c.pct != null ? `${n}: ${c.pct.toFixed(1)}% (${c.d > 0 ? "+" : ""}${c.d.toFixed(1)} vs ${legendMode === "def" ? "norm" : "league"})` : `${n}: not enough data`);
  return `<figure class="hz"><svg viewBox="0 0 500 ${H}" role="img" aria-label="${esc(RINGS.map(([k, n]) => tip(cells[k], n)).join("; "))}">
    <defs><clipPath id="${uid}-in"><path d="${three}"/></clipPath><mask id="${uid}-out"><rect width="500" height="${H}" fill="#fff"/><path d="${three}" fill="#000"/></mask></defs>
    <rect class="hz-bg" width="500" height="${H}"/><rect class="hz-z ${cl(cells.three)}" width="500" height="${H}" mask="url(#${uid}-out)"/>
    <g clip-path="url(#${uid}-in)"><rect class="hz-z ${cl(cells.mid)}" width="500" height="${H}"/><circle class="hz-z ${cl(cells.short)}" cx="${hx}" cy="${hy}" r="150"/><circle class="hz-z ${cl(cells.rim)}" cx="${hx}" cy="${hy}" r="60"/></g>
    <g class="hz-lines" fill="none"><path d="${three}"/><circle cx="${hx}" cy="${hy}" r="60"/><circle cx="${hx}" cy="${hy}" r="150"/><rect width="500" height="${H}"/></g>
    ${lab(cells.rim, hy + 8)}${lab(cells.short, hy + 110)}${lab(cells.mid, hy + 196)}${lab(cells.three, H - 22)}</svg></figure>`;
}
function scoutDefense(p) {
  const d = p.defense;
  if (!d?.rows?.length) return `<section class="card" id="s-def" tabindex="-1"><h2>Defensive profile</h2><p class="small muted">No defender tracking on record for him.</p></section>`;
  const strong = d.rows.filter((r) => r.tag === "strong" && r.id !== "overall"), weak = d.rows.filter((r) => r.tag === "weak" && r.id !== "overall"), b = d.blocks;
  const names = (rows) => rows.map((r) => esc(r.label.toLowerCase())).join(", ");
  return `<section class="card" id="s-def" tabindex="-1" aria-labelledby="s-def-h"><h2 id="s-def-h">Defensive profile</h2>
    <p class="small muted">What shooters make when he is the closest defender, against what those same shooters normally make. A negative gap is good defence.</p>
    <h3>Defence map</h3>${defMapFigure(d)}
    <p class="small">${strong.length ? `${ztag("strong")} His defensive hot spots: ${names(strong)}. ` : ""}${weak.length ? `${ztag("weak")} His defensive cold spots (shooters do better than usual): ${names(weak)}. ` : ""}${!strong.length && !weak.length ? "No distance band has cleared the rule as clearly strong or weak. " : ""}</p>
    <ul class="mrows">${d.rows.map((r) => meterRow({ label: esc(r.label), badge: r.low ? ztag("low") : ztag(r.tag), value: sg(r.diff), x: r.low ? null : r.diff, scale: 10,
      sub: `Shooters made ${p1(r.pct)} against him, ${p1(r.exp)} normally · ${esc(num(r.fga))} shots` })).join("")}</ul>
    <p class="small muted">Bar to the left (blue) = shooters make less than usual against him; to the right (orange) = more. Full bar = 10 points of FG%. STRONG and WEAK need ${esc(d.rule?.minFga ?? 40)} shots, a gap of ${esc(d.rule?.minDiff ?? 2.5)} points and ${esc(d.rule?.minZ ?? 1.5)} standard errors. The bands overlap (inside 6 ft is part of inside 10 ft), so they are listed, not mapped.</p>
    ${b?.total ? `<h3>Shots he blocked, by where the shot was taken</h3><div class="statgrid sg4"><div class="stat"><b>${esc(b.rim)}</b><span>At the rim</span></div><div class="stat"><b>${esc(b.paint)}</b><span>Paint</span></div><div class="stat"><b>${esc(b.mid)}</b><span>Mid-range</span></div><div class="stat"><b>${esc(b.three)}</b><span>Threes</span></div></div>` : ""}
    <p class="small muted" style="margin-top:8px">Source: ${esc(d.src)}, ${esc(d.window)}, ${esc(d.games)} games${b?.src ? `; blocks from ${esc(b.src)}` : ""}. Tracking credits the nearest defender, not the assigned one, so a guard can show many shots near the rim.</p>
  </section>`;
}
function scoutStyle(p) {
  const ps = p.playstyle, q = p.quarters;
  if (!ps) return `<section class="card" id="s-style" tabindex="-1"><h2>Playstyle</h2><p class="small muted">Not enough shots on record to describe how he plays.</p></section>`;
  const mix = ps.shotMix, c = ps.creation || {}, per = ps.per36, pt = ps.playTypes, cl = q?.clutch;
  const seg = [["Rim and paint", mix?.rimPaint, 1], ["Mid-range", mix?.mid, 2], ["Threes", mix?.three, 3]];
  return `<section class="card" id="s-style" tabindex="-1" aria-labelledby="s-style-h"><h2 id="s-style-h">Playstyle</h2>
    <div class="chips">${(ps.tags || []).map((x) => `<span class="chip info">${esc(x)}</span>`).join("") || `<span class="chip">No single style stands out</span>`}</div>
    ${mix ? `<h3>Shot diet</h3><div class="mix" role="img" aria-label="${esc(seg.map(([l, v]) => `${l} ${p1(v)}`).join(", "))}">${seg.map(([, v, j]) => `<span style="flex:${Math.max(0.5, Number(v) || 0)};background:var(--s${j})"></span>`).join("")}</div>
      <div class="legend">${seg.map(([l, v, j]) => `<span><i style="background:var(--s${j})"></i>${l} ${p1(v)}</span>`).join("")}</div>` : ""}
    <ul class="dots small">${(ps.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <dl class="kv" style="margin-top:10px">
      ${c.assisted != null ? `<dt>Made baskets that were assisted</dt><dd>${p1(c.assisted)}${c.lgAssisted != null ? ` (league ${p1(c.lgAssisted)})` : ""}</dd>` : ""}
      ${c.transShare != null ? `<dt>Shots within 6 seconds of a steal or defensive rebound</dt><dd>${p1(c.transShare)}</dd>` : ""}
      ${c.ftPer100Fga != null ? `<dt>Free throws per 100 shots</dt><dd>${f0(c.ftPer100Fga)}</dd>` : ""}
      ${c.catchShoot ? `<dt>Catch-and-shoot (${esc(c.catchShoot.season)})</dt><dd>${p1(c.catchShoot.efg)} eFG on ${esc(num(c.catchShoot.fga))}</dd>` : ""}
      ${c.pullUp ? `<dt>Pull-ups (${esc(c.pullUp.season)})</dt><dd>${p1(c.pullUp.efg)} eFG on ${esc(num(c.pullUp.fga))}</dd>` : ""}
    </dl>
    ${per ? `<h3>Per 36 minutes</h3><div class="statgrid"><div class="stat"><b>${f1(per.pts)}</b><span>Points</span></div><div class="stat"><b>${f1(per.ast)}</b><span>Assists</span></div><div class="stat"><b>${f1(per.oreb)}</b><span>Off. rebounds</span></div><div class="stat"><b>${f1(per.dreb)}</b><span>Def. rebounds</span></div><div class="stat"><b>${f1(per.to)}</b><span>Turnovers</span></div><div class="stat"><b>${f1(per.fta)}</b><span>Free throws</span></div></div>` : ""}
    ${pt?.rows?.length ? `<details class="more"><summary>Play types (${pt.rows.length})</summary>${playTypeRows(pt.rows)}<p class="small muted">Source: ${esc(pt.src)}, ${esc(pt.season)}. Percentile is against all players: higher = more points per possession. NBA.com lists a play type only above its own minimum, so some can be missing.</p></details>` : ""}
    ${q?.rows?.length ? `<details class="more"><summary>When he scores: by quarter and in the clutch</summary><div class="tw"><table><thead><tr><th>Period</th><th class="n">Points a game</th><th class="n">Share of his points</th><th class="n">League share</th></tr></thead>
      <tbody>${q.rows.map((r) => `<tr><td>${esc(r.q)}</td><td class="n">${f1(r.pts)}</td><td class="n"><b>${p1(r.share)}</b></td><td class="n">${p1(r.lgShare)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">${esc(q.games)} games.${cl?.fga ? ` Clutch (last 5 minutes, within 5 points): ${esc(cl.pts)} points on ${esc(cl.fgm)} of ${esc(cl.fga)} shooting, ${esc(cl.tpm)} of ${esc(cl.tpa)} from three and ${esc(cl.ftm)} of ${esc(cl.fta)} at the line, in ${esc(cl.games)} games that reached clutch time.` : ""}</p></details>` : ""}
  </section>`;
}
function scoutCulture(p) {
  const cu = p.culture;
  return `<section class="card" id="s-cul" tabindex="-1" aria-labelledby="s-cul-h"><h2 id="s-cul-h">Culture indicators</h2>
    ${cu?.length ? `<p class="small muted">Six things that can be counted: effort plays, passing share, fouls and technicals, availability, late-game shooting and steadiness. Each shows its number and sample. They describe what happened on the floor, not what kind of person he is.</p>
      <ul class="mrows">${cu.map((c) => meterRow({ label: esc(c.label), value: c.pctile != null ? `${esc(ord(c.pctile))} percentile` : "", x: c.pctile, kind: "lvl",
        sub: `<span class="ink"><b>${esc(c.level)}</b>: ${esc(c.value)}</span><br>${esc(c.ev)}${c.n ? `<br>Sample: ${esc(c.n)}` : ""}` })).join("")}</ul>
      <p class="small muted">Percentiles compare him with players at his position; the bar is full at the 100th percentile and the mark shows the 50th.</p>`
    : `<p class="small muted">Not enough games on record for these indicators.</p>`}</section>`;
}
// Every stored split row of a player, once each (the same row can sit in several of the lists).
function allSplits(p) {
  const seen = new Map();
  for (const list of Object.values(p.splits || {})) if (Array.isArray(list)) for (const r of list) if (r?.key && !seen.has(r.key)) seen.set(r.key, r);
  return [...seen.values()];
}
const SPLIT_GROUP = { rest: "Rest", style: "Opponent style", opp: "Opponents", arena: "Arenas", vs: "Opposing players", vsArch: "Defender types", oppBigs: "Opponent size", oppGuards: "Opponent size" };

async function vScout(id, labTid) {
  if (!id) return playerIndex(true);
  const [p, up] = await Promise.all([load(`players/${id}.json`), load("upcoming.json").catch(() => [])]);
  const next = up.find((g) => g.home === p.team || g.away === p.team) || null, nextOpp = next ? (next.home === p.team ? next.away : next.home) : null;
  const [ng, L] = await Promise.all([next ? load(`upcoming/${next.id}.json`).catch(() => null) : null, load("learning.json").catch(() => null)]);
  const row = ng?.teams?.flatMap((t) => t.players || []).find((x) => String(x.id) === String(p.id)) || null;
  const ht = p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : null;
  const others = S.teams.filter((t) => t.id !== p.team).sort((a, b) => a.name.localeCompare(b.name));
  const vt = p.vsTeams, vsRow = (tid) => { const r = vt?.rows?.find((x) => x[0] === tid); return r ? Object.fromEntries(vt.cols.map((c, i) => [c, r[i]])) : null; };
  const ranked = vt?.rows?.length ? [...vt.rows].map((r) => vsRow(r[0])).sort((a, b) => b.paperPts - a.paperPts) : [];
  const splits = allSplits(p), groups = [...new Set(splits.map((s) => SPLIT_GROUP[s.type] || "Other"))];
  let labTeam = S.T[labTid] && labTid !== p.team ? labTid : nextOpp || ranked[0]?.team || others[0]?.id;
  let role = ROLE[row?.role] ? row.role : "starter", sg0 = "top";
  const sections = [["s-sw", "Strengths and weaknesses"], ["s-map", "Shot map"], ["s-def", "Defence"], ["s-style", "Playstyle"], ["s-cul", "Culture"], ["s-mm", "Versus"], ["s-lab", "Matchup lab"], ["s-sit", "Situations"]];

  app.innerHTML = `<a class="back" href="#/scout">‹ Scout: all players</a>
    <header class="ehead">${avatar(p.id, p.n, { size: "xl" })}<div class="ehead-b"><h1>${esc(p.n)}</h1>
      <a class="ehead-t" href="#/team/${esc(p.team)}">${teamName(p.team)}</a>
      <p class="ehead-m">${[p.pos ? esc(p.pos) : "", ht ? esc(ht) : "", p.archetype ? esc(p.archetype) : "", "Scouting report"].filter(Boolean).join(" · ")}</p>${favBtn("p", p.id, p.n)}</div></header>
    <section class="card" id="s-mm" tabindex="-1" aria-labelledby="s-mm-h"><h2 id="s-mm-h">Versus: compare him against a team or player(s)</h2>
      <p class="small muted">Projected shooting by zone against the opponent you choose. Red = better than league average, blue = worse (for his defence: red = shooters do better than usual against him).</p>
      <div class="filters" role="group" aria-label="Side"><button class="fbtn" type="button" data-mm-side="off" aria-pressed="true">His offence</button><button class="fbtn" type="button" data-mm-side="def" aria-pressed="false">His defence</button></div>
      <div class="filters" role="group" aria-label="Against"><button class="fbtn" type="button" data-mm-vs="team" aria-pressed="true">vs team</button><button class="fbtn" type="button" data-mm-vs="player" aria-pressed="false">vs player(s)</button><button class="fbtn" type="button" data-mm-vs="style" aria-pressed="false">vs playstyle</button></div>
      <div id="mm-ctl"></div><div id="mm-out" aria-live="polite"></div>
    </section>
    <nav class="filters jumpnav" aria-label="Sections of this report">${sections.map(([k, l]) => `<button class="fbtn" type="button" data-jump="${k}">${l}</button>`).join("")}<a class="fbtn" href="#/player/${esc(p.id)}">Full profile ›</a></nav>
    ${next ? `<div class="card"><div class="card-h"><h2>Next game: ${next.home === p.team ? "vs" : "at"} ${esc(T(nextOpp).name)}</h2><a class="go" href="#/game/${esc(next.id)}">Game page ›</a></div>
      <p class="small muted">${esc(dayLong(next.date))} · ${esc(timePH(next.date))}</p>
      ${row ? `<div class="statgrid sg4"><div class="stat"><b>${f1(row.pts)}</b><span>Points (${esc(row.lo)}–${esc(row.hi)})</span></div><div class="stat"><b>${f1(row.reb)}</b><span>Rebounds</span></div><div class="stat"><b>${f1(row.ast)}</b><span>Assists</span></div><div class="stat"><b>${f1(row.tpa)}</b><span>3-pt attempts</span></div></div>
        ${rowWhy(row) ? `<p class="small" style="margin-top:10px">${rowWhy(row)}</p>` : ""}
        ${scenarioCard(p, row, nextOpp, L)}
        ${row.zm ? `<p class="small" style="margin-top:10px">${zmTags(row.zm.tag)} ${esc(row.zm.txt)} On paper ${sg(row.zm.paper, 2)} points; the model applies ${sg(row.zm.applied, 2)}.</p>` : ""}
        ${(() => { const mt = ng?.teams?.find((t) => t.tid === p.team), q = mt?.quarters?.proj; return q?.length ? `<p class="small muted">${esc(T(p.team).abbr)} projected by quarter: ${q.map((v, i) => `Q${i + 1} ${f1(v)}`).join(", ")} (display only; adds up to the team's projected ${f1(mt.quarters.total)}).</p>` : ""; })()}
        ${row.dm?.defenders?.length ? `<details class="more"><summary>Who is likely to guard him (NBA.com tracking)</summary>${dmBlock(row)}</details>` : ""}` : `<p class="small muted">He is not in the projected rotation for this game.</p>`}
      <button class="btn" type="button" data-jump="s-lab">See the zone-by-zone matchup</button></div>` : ""}
    ${scoutSW(p)}${scoutMap(p)}${scoutDefense(p)}${scoutStyle(p)}${scoutCulture(p)}
    <section class="card" id="s-lab" tabindex="-1" aria-labelledby="s-lab-h"><h2 id="s-lab-h">Matchup lab</h2>
      <p class="small muted">Choose an opponent to lay his zones over that team's defence: where a hot spot meets a soft spot, where it meets a strength, who is likely to be guarding, and what the model does with it.</p>
      <label class="small" for="lab-team">Opponent</label>
      <select class="field" id="lab-team">${others.map((t) => `<option value="${esc(t.id)}"${t.id === labTeam ? " selected" : ""}>${esc(t.name)}${t.id === nextOpp ? " (next game)" : ""}</option>`).join("")}</select>
      ${ranked.length ? `<div class="lab-q"><span class="small muted">Best on paper</span><div class="chips">${ranked.slice(0, 3).map((r) => `<button class="fbtn sm" type="button" data-lab="${esc(r.team)}">${esc(T(r.team).abbr)} ${sg(r.paperPts)}</button>`).join("")}</div>
        <span class="small muted">Toughest on paper</span><div class="chips">${ranked.slice(-3).reverse().map((r) => `<button class="fbtn sm" type="button" data-lab="${esc(r.team)}">${esc(T(r.team).abbr)} ${sg(r.paperPts)}</button>`).join("")}</div></div>` : ""}
      <div id="lab-out" aria-live="polite"></div>
    </section>

    <section class="card" id="s-sit" tabindex="-1" aria-labelledby="s-sit-h"><h2 id="s-sit-h">Other situations that apply to him</h2>
      <p class="small muted">Each number is measured against <b>his own usual</b>: his gap against the projection in that spot minus his overall gap across all his games${p.splits?.overall ? ` (${esc(p.splits.overall.n)} games, ${sg(p.splits.overall.pts)} points overall)` : ""}. So a player who was generally under-projected does not look strong everywhere.</p>
      <p class="small muted">${esc(p.splits?.note || "Counts already include last season (with its play-in and playoffs), this season and preseason. Listed from 5 games against a specific team, opposing player or arena (the schedule allows only 3-4 meetings a season) and from 8 games for other situations; under 10 games is a small sample.")}</p>
      ${splits.length ? `<div class="filters" role="group" aria-label="Kind of situation">${["top", ...groups, "all"].map((k) => `<button class="fbtn" type="button" data-sg="${esc(k)}" aria-pressed="false">${k === "top" ? "Best and toughest" : k === "all" ? `All ${splits.length}` : esc(k)}</button>`).join("")}</div><div id="sit-out"></div>` : `<p class="small muted">No situation has reached the minimum number of games yet.</p>`}
      ${L?.scenarios?.length ? `<details class="more"><summary>Rest, travel and teammates out: league-wide effects for his role</summary>
        <p class="small muted">Rest, travel and teammates being out are learned across the whole league, not per player. This is what the model adds for a player in the chosen role${row && ROLE[row.role] ? ` (he projects as one of the ${esc(ROLE[row.role].toLowerCase())} in his next game)` : ""}.</p>
        <div class="filters" role="group" aria-label="Player role">${Object.entries(ROLE).map(([k, l]) => `<button class="fbtn" type="button" data-srole="${k}" aria-pressed="false">${l}</button>`).join("")}</div><div id="role-out"></div></details>` : ""}
      ${row?.scen?.length ? `<h3>In his next game</h3><ul class="plain small">${row.scen.map((s) => `<li class="spread"><span>${esc(s.s)} <span class="muted">(${esc(num(s.n))} games)</span></span><span class="num ${cls(s.pts)}">${sg(s.pts, 2)} pts</span></li>`).join("")}</ul>` : ""}
      <p class="small muted" style="margin:12px 0 0">What changes when he sits, and which teammates gain when he scores more, are on his profile.</p>
      <a class="go" href="#/player/${esc(p.id)}">Full profile ›</a>
    </section>`;

  // ---- matchup maps
  { const mm = { side: "off", vs: "team", team: labTeam, style: null, players: [] };
    const tags = [...new Set((S.teams || []).flatMap((t) => t.style?.tags || []))].sort();
    mm.style = tags.find((t) => /defen/i.test(t)) || tags[0];
    const plist = Object.values(S.P || {}).filter((q) => String(q.id) !== String(p.id) && q.team !== p.team).sort((a, b) => a.n.localeCompare(b.n));
    const pcache = new Map(); const getP = async (pid) => { if (!pcache.has(pid)) pcache.set(pid, await load(`players/${pid}.json`).catch(() => null)); return pcache.get(pid); };
    const ctl = () => {
      const el = document.getElementById("mm-ctl"); if (!el) return;
      if (mm.vs === "team") el.innerHTML = `<select class="field" id="mm-team">${others.map((t) => `<option value="${esc(t.id)}"${t.id === mm.team ? " selected" : ""}>${esc(t.name)}${t.id === nextOpp ? " (next game)" : ""}</option>`).join("")}</select>`;
      else if (mm.vs === "style") el.innerHTML = `<select class="field" id="mm-style">${tags.map((t) => `<option${t === mm.style ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
      else el.innerHTML = `<label class="small" for="mm-pin">${mm.side === "off" ? "Add up to 3 defenders" : "Choose a shooter"}</label>${pickerHTML("mm-pin")}
        <div class="chips" id="mm-chips">${mm.players.map((q) => `<button class="chip" type="button" data-mm-rm="${esc(q.id)}">${esc(q.n)} ✕</button>`).join("")}</div>`;
      el.querySelector("#mm-team")?.addEventListener("change", (e) => { mm.team = e.target.value; draw(); });
      el.querySelector("#mm-style")?.addEventListener("change", (e) => { mm.style = e.target.value; draw(); });
      bindPicker(el.querySelector("#mm-pin"), plist, (q) => { if (mm.side === "def") mm.players = [q]; else if (!mm.players.some((x) => x.id === q.id)) mm.players = [...mm.players, q].slice(-3); ctl(); draw(); });
      el.querySelectorAll("[data-mm-rm]").forEach((b) => b.addEventListener("click", () => { mm.players = mm.players.filter((x) => String(x.id) !== b.dataset.mmRm); ctl(); draw(); }));
    };
    const teamsFor = () => (mm.vs === "team" ? [S.T[mm.team]].filter(Boolean) : (S.teams || []).filter((t) => t.style?.tags?.includes(mm.style)));
    const who = () => (mm.vs === "team" ? T(mm.team).name : mm.vs === "style" ? `teams tagged "${mm.style}" (${teamsFor().map((t) => t.abbr).join(", ")})` : mm.players.map((q) => q.n).join(", "));
    const drawMaps = async () => {
      const out = document.getElementById("mm-out"); if (!out) return;
      const LG = MM_LG(), hz = p.zones14?.rows;
      if (mm.side === "off" && mm.vs !== "player") {
        if (!hz?.length) { out.innerHTML = `<p class="small muted">No zone shooting on record for him yet.</p>`; return; }
        const ts = teamsFor(); if (!ts.length) { out.innerHTML = `<p class="small muted">No team matches this filter.</p>`; return; }
        const rows = hz.map((x) => {
          const lg = (x.lgPct ?? 0) / 100, hp = ((x.made ?? 0) + 25 * lg) / ((x.att ?? 0) + 25);
          let da = 0, dm = 0; for (const t of ts) { const z = t.zones14?.def?.find((y) => y.id === x.id); if (z) { da += z.att; dm += z.made; } }
          const td = (dm + 150 * lg) / (da + 150) - lg, proj = Math.min(0.95, Math.max(0.05, hp + td)), d = (proj - lg) * 100;
          return { id: x.id, att: x.att, made: x.made, pct: Math.round(proj * 1000) / 10, lgPct: x.lgPct, diff: Math.round(d * 10) / 10, tag: x.att < 10 ? "neutral" : d >= 4 ? "hot" : d <= -4 ? "cold" : "neutral", low: x.att < 10 ? 1 : undefined };
        });
        const best = [...rows].filter((x) => !x.low).sort((a, b) => b.diff - a.diff);
        const sp0 = mm.vs === "team" ? splits.find((x) => x.key === `opp:${mm.team}`) : null, vr0 = mm.vs === "team" ? vsRow(mm.team) : null;
        const recLine = mm.vs !== "team" ? "" : `<p class="small vs-rec">${sp0 ? `<b>His record vs ${esc(T(mm.team).abbr)}:</b> ${sp0.n} games, ${sp0.pts > 0 ? "+" : ""}${f1(sp0.pts)} pts against his usual gap to our projections${sp0.small || sp0.n < 10 ? " (small sample)" : ""}. ` : `No head-to-head split yet vs ${esc(T(mm.team).abbr)} (needs 5+ games). `}${vr0 ? `On paper this matchup is worth ${vr0.paperPts > 0 ? "+" : ""}${f1(vr0.paperPts)} pts; the model applies ${vr0.pts > 0 ? "+" : ""}${f1(vr0.pts)}.` : ""}${(() => { const ptm = playTypeMatchup(p, mm.team); return ptm ? ` Play-type matchup: ${ptm.delta > 0 ? "+" : ""}${f1(ptm.delta)} pts (${num(ptm.n)} possessions, shown only).` : ""; })()}</p>`;
        out.innerHTML = `${recLine}<h3>His offence vs ${esc(who())}</h3>${hz14Figure(rows, "off", `${p.n} projected vs ${who()}`)}
          <p class="small">Best spots: ${best.slice(0, 3).map((x) => `${esc(Z14_NAMES[x.id])} ${x.pct}%`).join(", ") || "-"}. Toughest: ${best.slice(-3).reverse().map((x) => `${esc(Z14_NAMES[x.id])} ${x.pct}%`).join(", ") || "-"}.</p>
          <p class="small muted">Projected FG% = his zone FG% (shrunk toward league with 25 attempts) + the defence's gap to league in that zone (shrunk with 150 attempts). Grey = under 10 of his attempts in the zone.</p>`;
        return;
      }
      if (mm.side === "off" && mm.vs === "player") {
        if (!mm.players.length) { out.innerHTML = `<p class="small muted">Add one or more defenders above.</p>`; return; }
        const ds = (await Promise.all(mm.players.map((q) => getP(q.id)))).map((x) => defRingDiffs(x?.defense));
        const hr = ringsFromZ14(hz), cells = {};
        for (const [k] of RINGS) { const lg = LG.ring[k]; if (lg == null || !hr[k].a) { cells[k] = null; continue; } const hp = (hr[k].m + 25 * lg) / (hr[k].a + 25); let w = 0, sd = 0; for (const d of ds) if (d[k]) { w += d[k].a; sd += d[k].diff * d[k].a; } const proj = hp + (w ? sd / w : 0); cells[k] = { pct: proj * 100, d: (proj - lg) * 100, low: hr[k].a < 10 }; }
        out.innerHTML = `<h3>His offence vs ${esc(who())}</h3>${ringFigure(cells, "off")}<p class="small muted">His shooting by distance plus how much the chosen defenders hold shooters below (or let them above) their norm at that distance, NBA.com closest-defender tracking. Numbers show projected FG% and the gap to league.</p>`;
        return;
      }
      // his defence
      const mine = defRingDiffs(p.defense);
      if (!Object.keys(mine).length) { out.innerHTML = `<p class="small muted">No defender tracking on record for him.</p>`; return; }
      let base = null, label = "";
      if (mm.vs === "player") { if (!mm.players.length) { out.innerHTML = `<p class="small muted">Choose a shooter above.</p>`; return; } const q = await getP(mm.players[0].id); base = ringsFromZ14(q?.zones14?.rows); label = mm.players[0].n; }
      else { const ts = teamsFor(); base = Object.fromEntries(RINGS.map(([k]) => [k, { a: 0, m: 0 }])); for (const t of ts) { const rg = ringsFromZ14(t.zones14?.off); for (const [k] of RINGS) { base[k].a += rg[k].a; base[k].m += rg[k].m; } } label = who(); }
      const cells = {};
      for (const [k] of RINGS) { const lg = LG.ring[k]; if (lg == null) { cells[k] = null; continue; } const b = base?.[k]?.a ? (base[k].m + 40 * lg) / (base[k].a + 40) : lg; const proj = b + (mine[k]?.diff || 0); cells[k] = { pct: proj * 100, d: (proj - b) * 100, low: !mine[k] }; }
      out.innerHTML = `<h3>His defence vs ${esc(label)}</h3>${ringFigure(cells, "def")}<p class="small muted">Projected FG% of ${esc(label)} with him as the closest defender: their usual shooting at each distance, plus how much he moves shooters away from their norm. The small number is the change he makes (blue = he holds them down).</p>`;
    };
    const draw = async () => {
      await drawMaps();
      const out = document.getElementById("mm-out"); if (!out) return;
      let html = "";
      if (mm.side === "off") {
        if (mm.vs === "team") html = projCard(projVs(p.id, p.team, [mm.team], [], p.zones14?.rows), `${p.n} projected vs ${T(mm.team).name}`);
        else if (mm.vs === "style") html = projCard(projVs(p.id, p.team, teamsFor().map((t) => t.id), [], p.zones14?.rows), `${p.n} projected vs "${mm.style}" teams`);
        else if (mm.players.length) { const ds = await Promise.all(mm.players.map((q) => getP(q.id))); const ot = [...new Set(mm.players.map((q) => q.team))]; html = projCard(projVs(p.id, p.team, ot, ds, p.zones14?.rows), `${p.n} projected vs ${mm.players.map((q) => q.n).join(", ")}`, `Opponent: ${ot.map((x) => T(x).abbr).join(", ")}.`); }
      } else if (mm.vs === "player" && mm.players.length) {
        const q = await getP(mm.players[0].id); html = projCard(projVs(mm.players[0].id, mm.players[0].team, [p.team], [p], q?.zones14?.rows), `${mm.players[0].n} projected with ${p.n} guarding him`);
      }
      if (html) out.insertAdjacentHTML("afterbegin", html);
    };
    app.querySelectorAll("[data-mm-side]").forEach((b) => b.addEventListener("click", () => { mm.side = b.dataset.mmSide; mm.players = mm.side === "def" ? mm.players.slice(0, 1) : mm.players; app.querySelectorAll("[data-mm-side]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); ctl(); draw(); }));
    app.querySelectorAll("[data-mm-vs]").forEach((b) => b.addEventListener("click", () => { mm.vs = b.dataset.mmVs; app.querySelectorAll("[data-mm-vs]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); ctl(); draw(); }));
    ctl(); draw();
  }
  // ---- other situations
  const drawSit = () => {
    const sorted = [...splits].sort((a, b) => b.pts - a.pts);
    const rows = sg0 === "all" ? sorted : sg0 === "top" ? (sorted.length > 10 ? [...sorted.slice(0, 5), ...sorted.slice(-5)] : sorted) : sorted.filter((s) => (SPLIT_GROUP[s.type] || "Other") === sg0);
    document.getElementById("sit-out").innerHTML = `<div class="tw"><table><thead><tr><th>Situation</th><th class="n">Games</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">3PA</th><th class="n">Min</th></tr></thead>
      <tbody>${rows.map((s) => `<tr class="mid"><td>${splitLabel(s)}${smallTag(s.small ?? s.n < 10)}</td><td class="n">${esc(s.n)}</td><td class="n ${cls(s.pts)}"><b>${sg(s.pts)}</b></td><td class="n">${sg(s.reb)}</td><td class="n">${sg(s.ast)}</td><td class="n">${sg(s.tpa)}</td><td class="n">${sg(s.min)}</td></tr>`).join("")}</tbody></table></div>`;
    app.querySelectorAll("[data-sg]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sg === sg0)));
  };
  if (splits.length) { app.querySelectorAll("[data-sg]").forEach((b) => b.addEventListener("click", () => { sg0 = b.dataset.sg; drawSit(); })); drawSit(); }
  const drawRole = () => {
    const rows = L.scenarios.filter((s) => s.s !== "all games").map((s) => ({ s: s.s, r: s.roles?.[role] })).filter((x) => x.r?.pts && x.r.pts.n >= 15).sort((a, b) => Math.abs(b.r.pts.effect) - Math.abs(a.r.pts.effect));
    document.getElementById("role-out").innerHTML = `<div class="tw"><table><thead><tr><th>Situation</th><th class="n">Games</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th><th class="n">Min</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${esc(x.s)}</td><td class="n">${esc(num(x.r.pts.n))}</td><td class="n ${cls(x.r.pts.effect)}"><b>${sg(x.r.pts.effect, 2)}</b></td><td class="n">${sg(x.r.reb?.effect, 2)}</td><td class="n">${sg(x.r.ast?.effect, 2)}</td><td class="n">${sg(x.r.min?.effect, 2)}</td></tr>`).join("")}</tbody></table></div>`;
    app.querySelectorAll("[data-srole]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.srole === role)));
  };
  if (document.getElementById("role-out")) { app.querySelectorAll("[data-srole]").forEach((b) => b.addEventListener("click", () => { role = b.dataset.srole; drawRole(); })); drawRole(); }

  // ---- matchup lab
  const labOut = document.getElementById("lab-out"), sel = document.getElementById("lab-team");
  const drawLab = async (tid, byUser = false) => {
    labTeam = tid; sel.value = tid;
    const opp = T(tid), ab = esc(opp.abbr), dz = opp.zones?.def, z = p.zones, v = vsRow(tid), isNext = tid === nextOpp;
    const dBy = Object.fromEntries((dz?.five || []).map((r) => [r.id, r]));
    const zh = v?.zoneHist, hist = splits.filter((s) => s.key === `opp:${tid}` || s.key === `arena:${tid}`);
    const mine = isNext ? (ng?.scenarios?.list || []).filter((s) => String(s.pid) === String(p.id)) : [];
    const meets = (z?.five || []).map((h) => ({ h, o: dBy[h.id], m: meetText(h, dBy[h.id]), hist: zh && FIVE.includes(h.id) ? zh[FIVE.indexOf(h.id) + 1] : null })).sort((a, b) => b.h.att - a.h.att);
    const rankTxt = (r) => (r <= 15 ? `${ord(r)} lowest of 30` : `${ord(31 - r)} highest of 30`);
    labOut.innerHTML = `<div class="card-h" style="margin-top:14px"><h3 style="margin:0">${teamName(tid)}</h3><a class="go" href="#/team/${esc(tid)}">Team page ›</a></div>
      ${isNext ? `<p class="small"><span class="chip info">Next game</span> <a href="#/game/${esc(next.id)}">${esc(dayLong(next.date))}</a></p>` : ""}
      <h3>Expected change against ${ab}</h3>
      ${v ? `<div class="statgrid sg3"><div class="stat"><b>${sg(v.pts, 2)}</b><span>Points the model adds</span><span>on paper ${sg(v.paperPts)}</span></div><div class="stat"><b>${sg(v.reb, 2)}</b><span>Rebounds</span><span>on paper ${sg(v.paperReb)}</span></div><div class="stat"><b>${sg(v.tpa, 2)}</b><span>3-pt attempts</span><span>on paper ${sg(v.paperTpa)}</span></div></div>
        <p class="small muted" style="margin-top:8px">For ${f1(vt.minutes)} minutes, against ${ab}'s roster and injury list as of the last data refresh. "On paper" assumes ${ab}'s zone percentages, rim defenders, rebounding and three-point volume carry over in full. The model applies only what the back-test supports${L?.factors?.summary ? `: ${esc(L.factors.summary.split(". ")[0])}.` : "."} <a href="#/why">See the factor report</a>.</p>
        ${v.games ? `<p class="small">His games against ${ab} in the back-test: <b>${esc(v.games)}</b> (${sampleWord(v.games)} sample${v.games < 3 ? ", too few to read" : ""}), ${sg(v.histPts)} points a game versus expectation.</p>` : `<p class="small muted">No game against ${ab} in the back-test yet.</p>`}`
      : `<p class="small muted">No projection-level numbers for this matchup: he is not projected for at least 8 minutes right now. The zone comparison below is still counted from real shots.</p>`}
      ${z?.five?.length && dz?.five?.length ? `<h3>Where his zones meet theirs</h3>
        <ul class="meets">${meets.map(({ h, o, m, hist: zr }) => `<li><div class="mrow-h"><span class="mrow-l">${esc(h.label || zoneLabel(h.id))} ${h.low || !h.att ? ztag("low") : `${ztag(h.tag)}${o ? ztag(o.tag) : ""}`}</span></div>
          <div class="small"><b>${esc(m.t)}.</b></div>
          <div class="small muted">He: ${p1(h.pct)} on ${esc(num(h.att))} attempts (${p1(h.share)} of his shots). ${o ? `${ab} allows ${p1(o.pct)} on ${esc(num(o.att))}${o.rank ? `, ${esc(rankTxt(o.rank))}` : ""}. ` : ""}League ${p1(h.lgPct)}.${zr && zr[1] ? ` Against ${ab}: ${esc(zr[0])} of ${esc(zr[1])} in ${esc(zh[0])} ${zh[0] === 1 ? "game" : "games"}.` : ""}</div></li>`).join("")}</ul>
        ${z.fine?.length && dz.fine?.length ? `${courtFigure("p-lab", matchCells(z.fine, dz.fine, opp.abbr), `${p.n} against the ${opp.name} defence, by court zone`, "Tap or hover a zone to compare both sides.")}${courtLegend("match")}
          <p class="small muted">Top number: his FG% from that zone. Second: what ${ab} allows there. Tags are written only where his own rule (HOT / COLD) or ${ab}'s (SOFT / STRONG) passed. ${ab}: ${esc(num(dz.fga))} shots allowed in ${esc(opp.zones.games)} games.</p>` : ""}`
      : `<p class="small muted">No zone data to compare for this pair.</p>`}
      ${(() => { const gb = (p.guardedBy?.rows || []).filter((r) => r.team === tid); return gb.length ? `<h3>Who from ${ab} has actually guarded him (NBA.com tracking)</h3>${defMatchRows(gb, "Defender")}<p class="small muted">Points per 100 partial possessions: bold = his rate against that defender, small = his usual rate on the same possessions. "Team" is the defender's latest team, so some meetings were with another club.</p>` : ""; })()}
      <h3>Likely defenders</h3><div id="lab-def"><p class="small muted">Loading ${ab}'s rotation...</p></div>
      ${hist.length || mine.length ? `<h3>His record against ${ab}</h3>
        ${hist.length ? `<ul class="plain small">${hist.map((s) => `<li class="spread"><span>${splitLabel(s)} <span class="muted">(${esc(s.n)} games, ${sampleWord(s.n)} sample, vs his usual)</span></span><span class="num"><span class="${cls(s.pts)}">${sg(s.pts)} pts</span> · ${sg(s.reb)} reb · ${sg(s.tpa)} 3PA</span></li>`).join("")}</ul>` : ""}
        ${mine.length ? `<ul class="scns">${mine.map((s) => scenarioItem(s, 0, null, false)).join("")}</ul>` : ""}` : ""}`;
    app.querySelectorAll("[data-lab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lab === tid)));
    // A team picked by hand goes into the address, so the matchup can be shared or reloaded (no new history entry, no re-route).
    if (byUser) { try { history.replaceState(null, "", `#/scout/${encodeURIComponent(p.id)}/${encodeURIComponent(tid)}`); S.lastHash = location.hash; } catch { /* sandboxed frame */ } }

    // Likely defenders: the opponent's eight heaviest-minute players this season, with their own closest-defender numbers.
    const og = up.find((g) => g.home === tid || g.away === tid), outNames = new Set((og?.out?.[og.home === tid ? 0 : 1]) || []); // out lists are [home, away]
    const mins = (x) => (x.cur ? x.cur[1] : x.prev ? x.prev[1] - 100 : -999); // players with games this season first
    const rot = Object.values(S.P).filter((x) => x.team === tid && (x.cur || x.prev)).sort((a, b) => mins(b) - mins(a)).slice(0, 8);
    const files = await Promise.all(rot.map((x) => load(`players/${x.id}.json`).catch(() => null)));
    if (labTeam !== tid || !document.getElementById("lab-def")) return; // another team was chosen (or the page changed) while this loaded
    const cell = (r) => (r ? `${r.low ? `<span class="muted">${sg(r.diff)}</span>` : `<b>${sg(r.diff)}</b>`}${r.low ? "" : ` ${ztag(r.tag)}`}<i>${esc(num(r.fga))} shots</i>` : `<span class="muted">-</span>`);
    const defs = files.map((f, i) => ({ x: rot[i], rim: f?.defense?.rows?.find((r) => r.id === "rim"), three: f?.defense?.rows?.find((r) => r.id === "three") })).filter((d) => d.rim || d.three);
    const hisRim = z?.five?.find((r) => r.id === "rim"), tagged = (k, t) => defs.filter((d) => d[k] && !d[k].low && d[k].tag === t).map((d) => d.x.n);
    const lines = [];
    if (hisRim && !hisRim.low && hisRim.tag !== "neutral") {
      const weak = tagged("rim", "weak"), strong = tagged("rim", "strong");
      if (hisRim.tag === "hot" && weak.length) lines.push(`His hot spot at the rim meets a defensive cold spot: shooters make more than usual inside 6 ft against ${weak.join(" and ")}.`);
      if (hisRim.tag === "hot" && strong.length) lines.push(`His hot spot at the rim runs into ${strong.join(" and ")}, who hold shooters below their usual inside 6 ft.`);
      if (hisRim.tag === "cold" && strong.length) lines.push(`His cold spot at the rim meets ${strong.join(" and ")}, who hold shooters below their usual inside 6 ft.`);
      if (hisRim.tag === "cold" && weak.length) lines.push(`The rim is one of his cold spots, though shooters make more than usual inside 6 ft against ${weak.join(" and ")}.`);
    }
    document.getElementById("lab-def").innerHTML = defs.length ? `<div class="tw"><table class="ztable def-t"><thead><tr><th>Defender</th><th class="n">Inside 6 ft</th><th class="n">Threes</th></tr></thead>
        <tbody>${defs.map((d) => `<tr class="mid"><td>${playerChip(d.x.id, d.x.n, { href: `#/scout/${d.x.id}` })}<span class="small muted def-m">${esc(d.x.pos || "")}${d.x.cur ? ` · ${f0(d.x.cur[1])} min` : ""}${outNames.has(d.x.n) ? " · listed out" : ""}</span></td><td class="n">${cell(d.rim)}</td><td class="n">${cell(d.three)}</td></tr>`).join("")}</tbody></table></div>
        ${lines.length ? `<ul class="dots small">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
        ${isNext && row?.zm?.rimDefenders?.length ? `<p class="small">The model's own pick for the next game, from the tracking snapshot dated before it: ${row.zm.rimDefenders.map((d) => `${esc(d.n)} ${sg(d.diff)} inside 6 ft on ${esc(num(d.fga))} shots`).join("; ")}.</p>` : ""}
        <p class="small muted">Top number = FG% shooters made against him minus what they normally make (negative is good defence), with the shots behind it underneath; a grey number has too few shots for a tag. ${ab}'s eight players with the most minutes a game this season. These shot numbers credit the nearest defender; the tracked assignments are in "Who is likely to guard him" on the game page and "Who guarded whom" on his profile.</p>`
      : `<p class="small muted">No defender tracking on record for ${ab}'s rotation.</p>`;
  };
  sel.addEventListener("change", () => drawLab(sel.value, true));
  app.querySelectorAll("[data-lab]").forEach((b) => b.addEventListener("click", () => drawLab(b.dataset.lab, true)));
  if (labTeam) await drawLab(labTeam);
  // Arriving with a team in the address (from a game page): open at the lab instead of the top of the report.
  if (labTid && S.T[labTid]) S.afterRoute = () => { const el = document.getElementById("s-lab"); if (el) { el.scrollIntoView({ block: "start" }); el.focus({ preventScroll: true }); } };
}

function absenceBlock(p) {
  const a = p.absence;
  if (!a || !a.with) return `<p class="small muted">${esc(p.n)} has not missed enough games (${a?.without || 0}) to measure what changes without him.</p>`;
  return `<div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><b>${sg(a.netSwing)}</b><span>Team net /100 with him</span></div>
      <div class="stat"><b>${pct(a.winPctWith)}</b><span>Win rate with (${a.with})</span></div>
      <div class="stat"><b>${pct(a.winPctWithout)}</b><span>Win rate without (${a.without})</span></div>
    </div>
    <p class="small" style="margin-top:8px">Without him the offence changes by ${sg(-a.offSwing)} and the defence gives up ${sg(a.defSwing)} points per 100 possessions (shrunk for the small number of games missed).</p>
    ${a.teammates?.length ? `<h3>Teammates in games he missed</h3><div class="tw"><table><thead><tr><th>Teammate</th><th class="n">Games</th><th class="n">Pts</th><th class="n">Min</th><th class="n">Ast</th></tr></thead>
      <tbody>${a.teammates.map((m) => `<tr class="mid"><td>${playerChip(m.id ?? pid(m.n), m.n)}</td><td class="n">${m.without}</td><td class="n ${cls(m.ptsDiff)}">${sg(m.ptsDiff)}</td><td class="n">${sg(m.minDiff)}</td><td class="n">${sg(m.astDiff)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${a.oppPosWithout?.n >= 5 ? `<p class="small" style="margin-top:8px">Opposing players at his position score ${sg(a.oppPosWithout.pts)} points versus projection when he is out, and ${sg(a.oppPosWith.pts)} when he plays.</p>` : ""}`;
}
// Label of a matchup / split row. Puts a small face or logo in front when the key names a player ("vs:<id>") or a team ("opp:<id>").
function splitLabel(s) {
  const [kind, ref = ""] = String(s.key ?? "").split(":"), label = String(s.label ?? "");
  const mark = kind === "vs" && /^\d+$/.test(ref) ? avatar(ref, S.P[ref]?.n ?? label.replace(/^when\s+/i, "").replace(/\s+plays$/i, ""), { size: "xs" })
    : kind === "opp" && S.T[ref]?.logo ? teamLogo(ref, { size: "xs" }) : "";
  return mark ? `<span class="pchip">${mark}<span>${esc(label)}</span></span>` : esc(label);
}
const splitTable = (rows, cols = ["pts"]) => rows?.length ? `<div class="tw"><table><thead><tr><th>Situation</th><th class="n">Games</th>${cols.includes("pts") ? `<th class="n">Pts</th>` : ""}${cols.includes("tpa") ? `<th class="n">3PA</th>` : ""}${cols.includes("ast") ? `<th class="n">Ast</th>` : ""}</tr></thead>
  <tbody>${rows.map((s) => `<tr class="mid"><td>${splitLabel(s)}${smallTag(s.small ?? s.n < 10)}</td><td class="n">${esc(s.n)}</td>${cols.includes("pts") ? `<td class="n ${cls(s.pts)}">${sg(s.pts)}</td>` : ""}${cols.includes("tpa") ? `<td class="n ${cls(s.tpa)}">${sg(s.tpa)}</td>` : ""}${cols.includes("ast") ? `<td class="n">${sg(s.ast)}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<p class="small muted">Not enough games yet.</p>`;

async function vPlayer(id) {
  const [p, takes, upl] = await Promise.all([load(`players/${id}.json`), load("takes.json"), load("upcoming.json").catch(() => [])]);
  const ng0 = upl.find((g) => g.home === p.team || g.away === p.team);
  const ngf = ng0 ? await load(`upcoming/${ng0.id}.json`).catch(() => null) : null;
  const next = ng0 ? { g: ng0, row: ngf?.teams?.flatMap((t) => t.players || []).find((x) => String(x.id) === String(p.id)) || null } : null;
  const line = (l) => l ? `<div class="statgrid"><div class="stat"><b>${f1(l.pts)}</b><span>Pts</span></div><div class="stat"><b>${f1(l.reb)}</b><span>Reb</span></div><div class="stat"><b>${f1(l.ast)}</b><span>Ast</span></div><div class="stat"><b>${f1(l.min)}</b><span>Min</span></div><div class="stat"><b>${f1(l.tpm)}</b><span>3PM</span></div><div class="stat"><b>${l.ts ? f0(l.ts * 100) + "%" : "-"}</b><span>True shooting</span></div></div>` : "";
  const n = p.nba, ht = p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : null;
  const mine = takes.filter((t) => t.athletes.includes(String(id))).slice(0, 6);
  const tr = p.tradeoff, rip = p.ripple || [];
  const spots = (ids) => (ids || []).map((i) => ZONE_WORD[i] || i).join(", ");
  app.innerHTML = `<a class="back" href="#/players">‹ All players</a>
    <header class="ehead">${avatar(p.id, p.n, { size: "xl" })}<div class="ehead-b"><h1>${esc(p.n)}</h1>
      <a class="ehead-t" href="#/team/${esc(p.team)}">${teamName(p.team)}</a>
      <p class="ehead-m">${[p.pos ? esc(p.pos) : "", ht ? esc(ht) : "", p.archetype ? esc(p.archetype) : ""].filter(Boolean).join(" · ")}</p>${favBtn("p", p.id, p.n)}</div></header>
    ${next ? `<a class="card next-cta" href="#/game/${esc(next.g.id)}"><span><b>Next game: ${next.g.home === p.team ? "vs" : "at"} ${esc(T(next.g.home === p.team ? next.g.away : next.g.home).name)}</b><span class="small muted">${esc(dayLong(next.g.date))} · ${esc(timePH(next.g.date))}${next.row ? "" : " · not in the projected rotation"}</span>${next.row ? `<span class="small">${rowWhy(next.row)}</span>` : ""}</span>${next.row ? `<span class="num"><b>${f1(next.row.pts)}</b><span class="small muted">pts (${esc(next.row.lo)}–${esc(next.row.hi)})</span></span>` : ""}</a>` : ""}
    <a class="card scout-cta" href="#/scout/${esc(p.id)}"><span><b>Scouting report</b><span class="small muted">${p.zones?.five ? `${[S.P[p.id]?.hot?.length ? `Hot: ${esc(spots(S.P[p.id].hot))}` : "", S.P[p.id]?.cold?.length ? `Cold: ${esc(spots(S.P[p.id].cold))}` : ""].filter(Boolean).join(" · ") || "Shot map, strengths and weaknesses"}` : "Strengths, weaknesses and matchups"}</span></span><span class="go">Shot map and matchup lab ›</span></a>
    <div class="card"><h2>${p.cur ? `This season (${p.cur.gp} games)` : "Last season"}</h2>${line(p.cur || p.prev)}
      ${p.last5 ? `<h3>Last 5 games</h3>${line(p.last5)}` : ""}
      ${p.cur && p.prev ? `<details class="more"><summary>Last season (${p.prev.gp} games)</summary>${line(p.prev)}</details>` : ""}
      <p class="small muted" style="margin-top:8px">Typical game-to-game swing in points versus projection: ±${f1(p.consistency)}. ${p.bias != null && Math.abs(p.bias) >= 1.5 ? `Lately he has been running ${sg(p.bias)} points versus projection.` : ""}</p>
    </div>

    <div class="card"><h2>Where he plays above or below his usual level</h2>
      <p class="small muted">Points versus his own usual, measured game by game against specific teams, arenas, opposing players, defender types and team sizes: his gap against the projection in that spot minus his overall gap${p.splits?.overall ? ` (${sg(p.splits.overall.pts)} points over ${esc(p.splits.overall.n)} games)` : ""}. Counts include last season (with its play-in and playoffs), this season and preseason. At least 5 games against a team, player or arena (the schedule allows only 3-4 meetings a season) and 8 for other situations; under 10 games is labelled a small sample. Small samples are shrunk before they touch a projection.</p>
      <h3>Best situations</h3>${splitTable(p.splits?.best?.filter((s) => s.pts > 0).slice(0, 5), ["pts", "tpa"])}
      <h3>Toughest situations</h3>${splitTable(p.splits?.worst?.filter((s) => s.pts < 0).slice(0, 5), ["pts", "tpa"])}
      ${p.splits?.players?.length ? `<h3>Depending on who is on the other side</h3>${splitTable(p.splits.players, ["pts", "tpa"])}` : ""}
      ${p.splits?.archetypes?.length ? `<h3>Against defender types and team size</h3>${splitTable(p.splits.archetypes, ["pts", "tpa"])}` : ""}
      ${p.splits?.arenas?.length ? `<h3>Road arenas</h3>${splitTable(p.splits.arenas, ["pts"])}` : ""}
      ${(p.splits?.moreThrees?.length || p.splits?.fewerThrees?.length) ? `<h3>When his three-point volume changes</h3>${splitTable([...(p.splits.moreThrees || []), ...(p.splits.fewerThrees || [])], ["tpa", "pts"])}` : ""}
    </div>

    <div class="card"><h2>Carry factor: when he scores more</h2>
      ${tr ? `<p class="small muted">Measured over ${tr.games} games: how his assists and his teammates' points move when he scores above or below projection.</p>
        <label class="small" for="carry">If he scores <b id="carry-v">+10</b> points versus projection</label>
        <input id="carry" type="range" min="-15" max="15" step="1" value="10">
        <div id="carry-out"></div>` : `<p class="small muted">Needs at least 12 graded games.</p>`}
    </div>

    <div class="card"><h2>If he does not play</h2>${absenceBlock(p)}</div>
    ${p.trust ? `<section class="card" aria-labelledby="p-trust-h"><h2 id="p-trust-h">Trust meter: how well the model reads him</h2>${trustBlock(p.trust)}</section>` : ""}
    ${onCourtCard(p)}${scriptsCard(p)}${guardCard(p)}${interactionsCard(p)}

    ${n ? `<div class="card"><h2>Tracking and effort numbers</h2>
      <div class="statgrid">
        <div class="stat"><b>${f1(n.usg)}%</b><span>Usage</span></div><div class="stat"><b>${sg(n.net)}</b><span>Net rating</span></div><div class="stat"><b>${f1(n.def)}</b><span>Def rating</span></div>
        <div class="stat"><b>${f1(n.deflections36)}</b><span>Deflections /36</span></div><div class="stat"><b>${f1(n.contests36)}</b><span>Contests /36</span></div><div class="stat"><b>${f1(n.miles)}</b><span>Miles per game</span></div>
      </div>
      <dl class="kv" style="margin-top:10px">
        ${n.drives != null ? `<dt>Drives per game</dt><dd>${f1(n.drives)}</dd>` : ""}${n.touches != null ? `<dt>Touches per game</dt><dd>${f1(n.touches)}</dd>` : ""}
        ${n.potAst != null ? `<dt>Potential assists</dt><dd>${f1(n.potAst)}</dd>` : ""}${n.paintShare != null ? `<dt>Points from the paint</dt><dd>${f0(n.paintShare)}%</dd>` : ""}
        ${n.threeShare != null ? `<dt>Shots that are threes</dt><dd>${f0(n.threeShare)}%</dd>` : ""}${n.assisted != null ? `<dt>Baskets that were assisted</dt><dd>${f0(n.assisted)}%</dd>` : ""}
        ${n.clutch ? `<dt>Clutch (last 5 min, within 5)</dt><dd>${f1(n.clutch.pts)} pts, ${f0(n.clutch.fg)}% FG in ${n.clutch.gp} games</dd>` : ""}
        ${n.looseBalls != null ? `<dt>Loose balls / charges / box-outs</dt><dd>${f1(n.looseBalls)} / ${f1(n.charges)} / ${f1(n.boxOuts)}</dd>` : ""}
      </dl><p class="small muted" style="margin-top:8px">Source: NBA.com, ${esc(n.season)}.</p></div>` : ""}

    ${p.k2 ? `<div class="card"><h2>NBA 2K27 rating (unofficial)</h2>
      <div class="statgrid"><div class="stat"><b>${p.k2.ovr}</b><span>Overall</span></div>
        ${p.k2.attrs ? `<div class="stat"><b>${f0(p.k2.attrs.three)}</b><span>Three</span></div><div class="stat"><b>${f0(p.k2.attrs.perD)}</b><span>Perimeter D</span></div><div class="stat"><b>${f0(p.k2.attrs.intD)}</b><span>Interior D</span></div><div class="stat"><b>${f0(p.k2.attrs.hustle)}</b><span>Hustle</span></div><div class="stat"><b>${f0(p.k2.attrs.stam)}</b><span>Stamina</span></div>` : ""}</div>
      <p class="small muted" style="margin-top:8px">${p.k2.arch ? `Archetype: ${esc(p.k2.arch)}. ` : ""}From a community dataset, not from 2K. It only nudges projections for players with very few games.</p></div>` : ""}

    <div class="card"><h2>Recent games</h2><div class="tw"><table><thead><tr><th>Date (PH)</th><th>Opp</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th></tr></thead>
      <tbody>${(p.log || []).map((g) => `<tr><td>${esc(day(g.d))}</td><td>${esc(T(g.opp).abbr)}</td>${g.dnp ? `<td class="n muted" colspan="4">Did not play</td>` : `<td class="n">${g.min}</td><td class="n"><b>${g.pts}</b></td><td class="n">${g.reb}</td><td class="n">${g.ast}</td>`}</tr>`).join("")}</tbody></table></div></div>
    ${mine.length ? `<div class="card"><h2>What analysts and fans are saying</h2>${mine.map(takeRow).join("")}</div>` : ""}
    <div class="card">${glossary(["usage", "ts", "net", "per100", "per36", "onoff", "poss", "vsexp", "split", "trust", "small", "evidence", "k2"], "What the terms on this page mean")}</div>`;

  const slider = document.getElementById("carry");
  if (slider) {
    const draw = () => {
      const x = Number(slider.value);
      document.getElementById("carry-v").textContent = sg(x, 0);
      const ast = tr.astPer10Pts * x / 10;
      document.getElementById("carry-out").innerHTML = `<ul class="plain small">
        <li class="spread"><span>His own assists</span><span class="num ${cls(ast)}">${sg(ast)} <span class="muted">(link strength ${Math.abs(tr.r) >= 0.3 ? "clear" : Math.abs(tr.r) >= 0.15 ? "weak" : "none found"})</span></span></li>
        ${rip.map((m) => `<li class="spread"><a class="prow-i link" href="#/player/${esc(m.id)}">${avatar(m.id, m.n, { size: "sm" })}<span><b>${esc(m.n)}</b><span class="muted">${esc(m.games)} games together</span></span></a><span class="num"><span class="${cls(m.ptsPer10 * x)}">${sg(m.ptsPer10 * x / 10)} pts</span> · ${sg(m.astPer10 * x / 10)} ast</span></li>`).join("")}
      </ul>${rip.length ? "" : `<p class="small muted">No teammate shows a consistent link with his scoring yet.</p>`}`;
    };
    slider.addEventListener("input", draw); draw();
  }
}

// ---------------------------------------------------------------- More: takes, sources, method
const VERDICT = { "Numbers agree": "good", "Numbers disagree": "bad", "Not confirmed by the numbers": "warn" };
// One headline. Players the feed tagged (and we track) are shown as faces; a checked take shows the player it was checked against.
// Feed titles sometimes arrive with HTML entities (&#8217; and so on): decode them before display.
const unent = (x) => String(x || "").replace(/&#(d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function takeRow(t0) {
  const t = { ...t0, title: unent(t0.title), summary: unent(t0.summary) };
  const who = (t.athletes || []).map((id) => S.P[id]).filter(Boolean);
  const summary = plain(t.summary);
  return `<div class="take"><a href="${safeUrl(t.url)}" target="_blank" rel="noopener noreferrer">${esc(plain(t.title))}</a>
    <div class="meta">${esc(t.outlet)} · ${esc(ago(t.date))}${(t.flags || []).length ? " · " + esc(t.flags.join(", ")) : ""}</div>
    ${summary ? `<div class="small muted">${esc(summary)}</div>` : ""}
    ${who.length ? `<div class="who">${faceStack(who, { max: 4 })}<span>${esc(who.slice(0, 2).map((p) => p.n).join(", "))}${who.length > 2 ? ` +${who.length - 2} more` : ""}</span></div>` : ""}
    ${(t.checks || []).filter((c) => VERDICT[c.verdict]).map((c) => `<div class="chk"><span class="chip ${VERDICT[c.verdict]}">${esc(c.verdict)}</span><span>${esc(c.n)}: last 5 games ${f1(c.last5)} pts vs ${f1(c.season)} season average</span></div>`).join("")}</div>`;
}
const MORE_MENU = [
  ["results", "Results", "Every past game: projected vs what really happened, and why it missed."],
  ["accuracy", "Accuracy report", "Calibration, Brier score, log loss, accuracy by prediction type and the biggest misses."],
  ["why", "How accurate is it?", "Accuracy week by week, what causes misses, and what the model learned."],
  ["sim", "Simulation lab", "Each upcoming game played 10,000 times, with what-if scenarios."],
  ["board", "High-confidence board", "Every 85%+ market in one long list, with past hit rates."],
  ["season", "Season simulation", "Projected wins, seeds and playoff chances."],
  ["breakout", "Breakout watch", "Players whose minutes or role should jump tonight."],
  ["today", "What changed today", "New injuries, role changes and the biggest projection moves."],
  ["compare", "Compare", "Two players or two teams side by side."],
  ["more/takes", "Analyst and fan takes", "News, blogs, YouTube and Reddit, checked against the numbers."],
  ["more/sources", "Data sources", "Where every number comes from and how it is cross-checked."],
  ["more/method", "How it works", "How projections are made and how the model learns."],
];
// How often our side has won, grouped by how far our number was from the bookmaker's main line. Uses our pre-tip
// predictions (never changed by odds) and the closing line only to place each game in a group and to grade it.
const DISC = [[0, 3, "0-3"], [3, 6, "3-6"], [6, 10, "6-10"], [10, 99, "10+"]];
function discRecord(PT, ODD) {
  const mk = () => DISC.map(([lo, hi, lab]) => ({ lo, hi, lab, n: 0, w: 0 }));
  const out = { spread: mk(), total: mk() };
  for (const x of PT?.games || []) {
    const c = ODD?.closing?.[x.id]; if (!x.graded || !x.act || !c) continue;
    if (Number.isFinite(c.spreadHome)) { const book = -c.spreadHome, ours = x.hs - x.as, act = x.act.hs - x.act.as, gap = Math.abs(ours - book);
      if (gap > 0 && act !== book) { const b = out.spread.find((y) => gap >= y.lo && gap < y.hi); b.n++; if ((ours > book) === (act > book)) b.w++; } }
    if (Number.isFinite(c.total)) { const ours = x.hs + x.as, act = x.act.hs + x.act.as, gap = Math.abs(ours - c.total);
      if (gap > 0 && act !== c.total) { const b = out.total.find((y) => gap >= y.lo && gap < y.hi); b.n++; if ((ours > c.total) === (act > c.total)) b.w++; } }
  }
  return out;
}
const discLabel = (rec, kind, gap) => { const b = rec?.[kind]?.find((y) => gap >= y.lo && gap < y.hi); if (!b) return ""; return b.n >= 20 ? `When we disagree by ${b.lab} points, our side has won ${pct(b.w / b.n)} (${b.n} graded)` : `When we disagree by ${b.lab} points: ${b.n} graded so far (shown from 20)`; };
async function vAccuracy() {
  const [R, L, board, PT, ODD, UP] = await Promise.all([load("results.json"), load("learning.json").catch(() => null), load("board.json").catch(() => null), load("pretip.json").catch(() => null), load("odds.json").catch(() => null), load("upcoming.json").catch(() => [])]);
  const games = R.filter((r) => r.pred && r.act && r.pk && !r.pk.endsWith("-1")); // preseason left out
  const stat = (rows) => { let b = 0, ll = 0, w = 0, m = 0, t = 0, tn = 0; for (const r of rows) { const y = r.act.hs > r.act.as ? 1 : 0, p = Math.min(0.99, Math.max(0.01, r.pred.pHome)); b += (p - y) ** 2; ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); w += r.correct ? 1 : 0; m += Math.abs(r.err ?? (r.act.hs - r.act.as - (r.pred.hs - r.pred.as))); if (r.totErr != null) { t += Math.abs(r.totErr); tn++; } } const n = rows.length || 1; return { n: rows.length, brier: b / n, ll: ll / n, acc: w / n, mae: m / n, tot: tn ? t / tn : null }; };
  const all = stat(games), coin = { brier: 0.25, ll: Math.log(2) };
  const phases = [...new Set(games.map((r) => r.pk))].map((pk) => ({ pk, label: games.find((r) => r.pk === pk).phase, ...stat(games.filter((r) => r.pk === pk)) }));
  const months = [...new Set(games.map((r) => r.date.slice(0, 7)))].map((mo) => ({ mo, ...stat(games.filter((r) => r.date.startsWith(mo))) })).filter((x) => x.n >= 10);
  const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]].map(([lo, hi]) => { const rows = games.filter((r) => { const p = Math.max(r.pred.pHome, 1 - r.pred.pHome); return p >= lo && p < hi; }); const said = rows.reduce((z, r) => z + Math.max(r.pred.pHome, 1 - r.pred.pHome), 0) / (rows.length || 1); return { lab: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: rows.length, said, hap: rows.length ? rows.filter((r) => r.correct).length / rows.length : null }; });
  const miss = games.filter((r) => r.date >= "2026-10").sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 10);
  const heads = await Promise.all(miss.map((r) => load(`games/${r.id}.json`).then((g) => g.headline).catch(() => null)));
  const fam = board?.calibration?.byFamily || {};
  const FAMW = { pts: "Player points", reb: "Player rebounds", ast: "Player assists", tpm: "Player threes", total: "Game total", teamTotal: "Team total", spread: "Spread", winner: "Winner" };
  const famRows = Object.entries(fam).map(([k, rows]) => { const ok = (rows || []).filter((x) => x.n > 0); const n = ok.reduce((z, x) => z + x.n, 0); const said = n ? ok.reduce((z, x) => z + x.said * x.n, 0) / n : null, hap = n ? ok.reduce((z, x) => z + x.happened * x.n, 0) / n : null; return { k, n, said, hap }; }).filter((x) => x.n >= 30);
  const ps = L?.phaseSummary || [];
  const bar = (said, hap) => `<span class="acc-cal" aria-hidden="true"><i class="s" style="left:${said}%"></i><i class="h" style="left:${hap}%"></i></span>`;
  app.innerHTML = `${labBack}<h1>Accuracy report</h1>
    <p class="lead">Every game since October 2025, projected walk-forward from the games before it (see the notes on what the replay may still know). Preseason is left out. Lower Brier score and log loss are better; a coin flip scores 0.250 and 0.693.</p>
    <div class="tiles">
      <div class="tile"><div class="l">Winner called</div><div class="v">${pct(all.acc)}</div><div class="s">${num(all.n)} games</div></div>
      <div class="tile"><div class="l">Brier score</div><div class="v">${all.brier.toFixed(3)}</div><div class="s">coin flip ${coin.brier.toFixed(3)}</div></div>
      <div class="tile"><div class="l">Log loss</div><div class="v">${all.ll.toFixed(3)}</div><div class="s">coin flip ${coin.ll.toFixed(3)}</div></div>
      <div class="tile"><div class="l">Margin miss</div><div class="v">${f1(all.mae)}</div><div class="s">points per game${all.tot != null ? ` · total ${f1(all.tot)}` : ""}</div></div>
    </div>
    ${(() => {
      const gr = (PT?.games || []).filter((x) => x.graded && x.act), pend = (PT?.games || []).filter((x) => !x.graded).length;
      let b = 0, ll = 0, w = 0, m = 0, t = 0, clvN = 0, clvS = 0, clvPos = 0;
      for (const x of gr) { const y = x.act.hs > x.act.as ? 1 : 0, p = Math.min(0.99, Math.max(0.01, x.pHome)); b += (p - y) ** 2; ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); w += x.correct ? 1 : 0; m += Math.abs((x.act.hs - x.act.as) - (x.hs - x.as)); t += Math.abs((x.act.hs + x.act.as) - (x.hs + x.as));
        const c = ODD?.closing?.[x.id]; if (c?.open && c.mlHome && c.open.mlHome) { const home = x.pHome >= 0.5, pc = noVig(c.mlHome, c.mlAway), po = noVig(c.open.mlHome, c.open.mlAway); if (pc != null && po != null) { const v = (home ? pc - po : po - pc) * 100; clvN++; clvS += v; if (v > 0) clvPos++; } } }
      const n = gr.length;
      return `<div class="card"><h2>The honest test: predictions saved before tip-off</h2>
        <p class="small muted">Each game's last prediction made before tip-off is frozen (with the model version) and graded after the final. Nothing here can be recomputed afterwards, so it is the cleanest measure of the model. The record started on November 11, 2026.</p>
        ${n ? `<div class="tiles">
          <div class="tile"><div class="l">Winner called</div><div class="v">${pct(w / n)}</div><div class="s">${num(n)} games graded${pend ? ` · ${pend} waiting` : ""}</div></div>
          <div class="tile"><div class="l">Brier score</div><div class="v">${(b / n).toFixed(3)}</div><div class="s">log loss ${(ll / n).toFixed(3)}</div></div>
          <div class="tile"><div class="l">Margin miss</div><div class="v">${f1(m / n)}</div><div class="s">total miss ${f1(t / n)}</div></div>
          <div class="tile"><div class="l">Closing line value</div><div class="v">${clvN ? (clvS / clvN > 0 ? "+" : "") + (clvS / clvN).toFixed(1) : "-"}</div><div class="s">${clvN ? `pts of win chance · line moved our way in ${pct(clvPos / clvN)} of ${clvN} games` : "needs closing lines (from the next games on)"}</div></div>
        </div>
        <p class="small muted">Closing line value (reference only, never used by the model): for the side we favoured, did the bookmaker's price move toward us between its opening line and its close? Consistently positive means the market later agreed with us, the standard test of a real edge. Small samples swing a lot; judge it after a few hundred games.</p>
        <details class="more"><summary>Every graded game (${n})</summary><div class="tw"><table><thead><tr><th>Game</th><th class="n">Saved (PH)</th><th class="n">We said</th><th class="n">Final</th><th class="n"></th></tr></thead><tbody>${gr.slice().reverse().map((x) => `<tr><td>${esc(T(x.away).abbr)} @ ${esc(T(x.home).abbr)}</td><td class="n">${esc(new Date(x.frozen).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td><td class="n">${esc(T(x.pHome >= 0.5 ? x.home : x.away).abbr)} ${pct(Math.max(x.pHome, 1 - x.pHome))}</td><td class="n">${esc(x.act.as)}-${esc(x.act.hs)}</td><td class="n">${x.correct ? '<b class="up">✓</b>' : '<b class="down">✗</b>'}</td></tr>`).join("")}</tbody></table></div></details>` : `<p>Saved predictions are graded as games finish; ${pend} are waiting for their final.</p>`}
      </div>`;
    })()}
    ${(() => {
      const avgDiff = (pairs) => { const sp = pairs.filter((x) => x.s != null), tt = pairs.filter((x) => x.t != null); return { s: sp.length ? sp.reduce((z, x) => z + Math.abs(x.s), 0) / sp.length : null, t: tt.length ? tt.reduce((z, x) => z + Math.abs(x.t), 0) / tt.length : null, ns: sp.length, nt: tt.length }; };
      const slate = avgDiff((UP || []).map((u) => { const o = ODD?.games?.[u.id]; if (!o) return null; return { s: Number.isFinite(o.spreadHome) ? (u.pred.hs - u.pred.as) - -o.spreadHome : null, t: Number.isFinite(o.total) ? (u.pred.hs + u.pred.as) - o.total : null }; }).filter(Boolean));
      const hist = avgDiff((PT?.games || []).map((x) => { const c = ODD?.closing?.[x.id]; if (!c) return null; return { s: Number.isFinite(c.spreadHome) ? (x.hs - x.as) - -c.spreadHome : null, t: Number.isFinite(c.total) ? (x.hs + x.as) - c.total : null }; }).filter(Boolean));
      return `<div class="card"><h2>How close are we to the market?</h2>
        <p>Built without bookmaker data, and usually within a few points of the market anyway. When we disagree, we show you why.</p>
        <div class="tiles">
          <div class="tile"><div class="l">Spreads, upcoming games</div><div class="v">${slate.s != null ? f1(slate.s) : "-"}</div><div class="s">avg points from the main line · ${slate.ns} games</div></div>
          <div class="tile"><div class="l">Totals, upcoming games</div><div class="v">${slate.t != null ? f1(slate.t) : "-"}</div><div class="s">avg points from the main line · ${slate.nt} games</div></div>
          <div class="tile"><div class="l">Spreads, since tracking</div><div class="v">${hist.s != null ? f1(hist.s) : "-"}</div><div class="s">vs closing line · ${hist.ns} games</div></div>
          <div class="tile"><div class="l">Totals, since tracking</div><div class="v">${hist.t != null ? f1(hist.t) : "-"}</div><div class="s">vs closing line · ${hist.nt} games</div></div>
        </div>
        <p class="small muted">Two checks we watch: if these numbers shrink toward zero over time, something in the pipeline may have started using the line by accident (an automatic check already fails the build if odds reach the model); if they grow, the model may be drifting and is due for recalibration.</p></div>`;
    })()}
    ${(() => { const rec = discRecord(PT, ODD), row = (b) => `<tr><td>${b.lab} points</td><td class="n">${b.n}</td><td class="n">${b.n ? `<b>${pct(b.w / b.n)}</b>` : "-"}</td></tr>`;
      return `<div class="card"><h2>When we disagree with the market, who is right?</h2>
        <p class="small muted">Our saved pre-tip number against the bookmaker's closing line, grouped by the size of the difference. "Won" = the final landed on our side of the line. The line is used only as the scoreboard; it never changes our projections. Under about 100 games per group, the rates are noisy.</p>
        <div class="grid two"><div><h3>Spread / margin</h3><div class="tw"><table><thead><tr><th>Difference</th><th class="n">Graded</th><th class="n">Our side won</th></tr></thead><tbody>${rec.spread.map(row).join("")}</tbody></table></div></div>
        <div><h3>Game total</h3><div class="tw"><table><thead><tr><th>Difference</th><th class="n">Graded</th><th class="n">Our side won</th></tr></thead><tbody>${rec.total.map(row).join("")}</tbody></table></div></div></div>
        <p class="small muted">If our 10+ point disagreements keep winning, that is an edge the market does not have; if they hover near 50%, treat big disagreements as "check the news". Grading started with the games after November 11, 2026.</p></div>`; })()}
    ${L?.liveTrack?.phases?.length ? `<div class="card"><h2>Strict replay: without information known only at tip-off</h2>
      <p class="small muted">The main replay below uses the real starting line-ups and inactive list, which are only known shortly before tip-off. This stricter version removes both (a player counts as out only if he missed his team's previous game), so it is a lower bound for predictions made hours ahead.</p>
      <div class="tw"><table><thead><tr><th>Phase</th><th class="n">Games</th><th class="n">Winner</th><th class="n">Margin miss</th><th class="n">Player pts miss</th></tr></thead><tbody>${L.liveTrack.phases.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${num(x.games)}</td><td class="n">${pct(x.winnerAcc)}</td><td class="n">${f1(x.marginMAE)}</td><td class="n">${x.ptsMAE != null ? f1(x.ptsMAE) : "-"}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    <div class="note small"><b>What the replay may know that a real forecast would not:</b> (1) starting line-ups and inactives (see the strict replay above); (2) the 2K player ratings are this season's snapshot, applied to every past game; (3) the model's settings (shrinkage, weights, the shooting-efficiency rule) were chosen by testing on these same seasons. Every game is still projected only from games before it, but these three can flatter the replay a little. That is why the saved pre-tip record above is the number to trust.</div>
    <div class="card"><h2>Calibration: when we say X%, does it happen X% of the time?</h2>
      <div class="tw"><table><thead><tr><th>We said</th><th class="n">Games</th><th class="n">Average said</th><th class="n">Happened</th><th></th></tr></thead><tbody>
      ${buckets.filter((b) => b.n).map((b) => `<tr><td>${b.lab}</td><td class="n">${num(b.n)}</td><td class="n">${pct(b.said)}</td><td class="n"><b>${pct(b.hap)}</b></td><td>${bar(b.said * 100, b.hap * 100)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Chance given to the favourite. On each bar the ring is what we said and the dot is what happened; close together means honest probabilities.</p></div>
    <div class="card"><h2>By season and phase</h2><div class="tw"><table><thead><tr><th>Phase</th><th class="n">Games</th><th class="n">Winner</th><th class="n">Brier</th><th class="n">Log loss</th><th class="n">Margin miss</th></tr></thead><tbody>
      ${phases.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${num(x.n)}</td><td class="n">${pct(x.acc)}</td><td class="n">${x.brier.toFixed(3)}</td><td class="n">${x.ll.toFixed(3)}</td><td class="n">${f1(x.mae)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="card"><h2>Month by month</h2><div class="tw"><table><thead><tr><th>Month</th><th class="n">Games</th><th class="n">Winner</th><th class="n">Brier</th><th class="n">Margin miss</th></tr></thead><tbody>
      ${months.map((x) => `<tr><td>${esc(new Date(x.mo + "-15").toLocaleString("en-US", { month: "short", year: "numeric" }))}</td><td class="n">${num(x.n)}</td><td class="n">${pct(x.acc)}</td><td class="n">${x.brier.toFixed(3)}</td><td class="n">${f1(x.mae)}</td></tr>`).join("")}</tbody></table></div></div>
    ${famRows.length ? `<div class="card"><h2>By prediction type (85%+ picks)</h2><div class="tw"><table><thead><tr><th>Type</th><th class="n">Picks</th><th class="n">We said</th><th class="n">Came true</th></tr></thead><tbody>
      ${famRows.map((x) => `<tr><td>${esc(FAMW[x.k] || x.k)}</td><td class="n">${num(x.n)}</td><td class="n">${esc(f1(x.said))}%</td><td class="n"><b class="${x.hap >= x.said - 1.5 ? "up" : "down"}">${esc(f1(x.hap))}%</b></td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Every market the simulation put at 85% or more, graded walk-forward. Player props ran a few points over-confident, which is why the Picks page shows a corrected chance next to the raw one.</p></div>` : ""}
    ${ps.length ? `<div class="card"><h2>Player and team misses by cause</h2><div class="tw"><table><thead><tr><th>Phase</th><th class="n">Team pts miss</th><th class="n">Shooting</th><th class="n">Pace</th><th class="n">Who played</th><th class="n">Player: minutes</th><th class="n">usage</th><th class="n">efficiency</th></tr></thead><tbody>
      ${ps.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${f1(x.teamPtsMAE)}</td><td class="n">${f1(x.teamErrorSources?.shooting)}</td><td class="n">${f1(x.teamErrorSources?.pace)}</td><td class="n">${f1(x.teamErrorSources?.lineup)}</td><td class="n">${f1(x.playerErrorSources?.minutes)}</td><td class="n">${f1(x.playerErrorSources?.usage)}</td><td class="n">${f1(x.playerErrorSources?.efficiency)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Average points of miss traced to each cause. Shooting luck is the biggest and least predictable source; it is why the model now separates shot volume from shooting efficiency.</p></div>` : ""}
    <div class="card"><h2>Biggest misses this season, and why</h2><ul class="plain">${miss.map((r, i) => `<li><a href="#/result/${esc(r.id)}"><b>${esc(T(r.away).abbr)} @ ${esc(T(r.home).abbr)}</b> · ${esc(new Date(r.date).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }))} · missed the margin by ${f1(Math.abs(r.err))}</a><div class="small muted">${esc(heads[i] || "")}</div></li>`).join("")}</ul></div>
    <p class="small muted">Live predictions are not graded here yet. The pre-game projection for every game is saved before tip-off in the project's history folder, so it can be checked later. Statistical analysis only, not betting advice.</p>`;
}
async function vMoreMenu() {
  app.innerHTML = `<h1>More</h1>
    <div class="menu-list">${MORE_MENU.map(([k, l, d]) => `<a class="menu-i" href="#/${k}"><span class="menu-ic" aria-hidden="true" style="background:${(MENU_IC[k] || ["", "#223"])[1]}">${(MENU_IC[k] || ["›"])[0]}</span><span><b>${esc(l)}</b><span class="small muted">${esc(d)}</span></span><span class="menu-c" aria-hidden="true">›</span></a>`).join("")}</div>`;
}
async function vMore(tab) {
  if (!tab) return vMoreMenu();
  const m = S.meta, src = m.sources;
  const tabs = [["takes", "Analyst and fan takes"], ["sources", "Data sources"], ["method", "How it works"]];
  let body = "";
  if (tab === "takes") {
    const takes = await load("takes.json");
    const kind = S.kind || "all";
    // Keep only items that name a player or a team; drop promos, "top 10 plays" reels and generic news pages.
    const PROMO = /get your latest|top d+ plays|top plays|subscribe|watch live|best of|mixtape|full episode|podcast episode|daily recap/i;
    const relevant = (t) => ((t.teams || []).length || (t.athletes || []).length) && !PROMO.test(t.title || "");
    const rows = takes.filter(relevant).filter((t) => kind === "all" || (kind === "checked" ? t.checks.some((c) => VERDICT[c.verdict]) : t.kind === kind)).slice(0, 80);
    body = `<p class="lead">Headlines from sports news desks, blogs, YouTube analysts and r/nba. When a take praises or doubts a player, it is checked against his recent numbers first. Takes never move a projection by themselves; only reported minutes limits do.</p>
      <div class="filters" role="group" aria-label="Filter takes">${[["all", "All"], ["checked", "Checked against numbers"], ["news", "News"], ["blog", "Blogs"], ["video", "YouTube"], ["community", "Reddit"]].map(([k, l]) => `<button class="fbtn" type="button" data-kind="${k}" aria-pressed="${kind === k}">${l}</button>`).join("")}</div>
      <div class="card">${rows.map(takeRow).join("") || `<p class="empty">Nothing in this filter right now.</p>`}</div>
      <p class="small muted">The check is automatic and rough: it reads the wording of the headline and compares it with the player's last five games. TikTok and Facebook are not included because they cannot be read without logging in.</p>`;
  } else if (tab === "sources") {
    body = `<div class="card"><h2>Where the data comes from</h2><ul class="plain">
        <li><b>ESPN public feeds</b><br><span class="small muted">${esc(src.espn.note)}. ${src.espn.games.toLocaleString()} games loaded.</span></li>
        <li><b>NBA.com official stats</b><br><span class="small muted">${esc(src.nbaCom.note)} ${src.nbaCom.snapshots} weekly snapshots stored.</span></li>
        <li><b>NBA 2K27 ratings (unofficial)</b><br><span class="small muted">${esc(src.ratings2k.note)}</span>
          <div class="small muted">${src.ratings2k.sources.map((s) => `<div class="row wrap" style="gap:0 8px"><a class="go" style="white-space:normal" href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a><span>${esc(s.players)} players</span></div>`).join("")}</div></li>
        <li><b>News, blogs, video and community</b><br><span class="small muted">${esc(src.news.outlets.join(", "))}. ${esc(src.news.note)}</span></li>
        <li><b>Left out on purpose</b><br><span class="small muted">${esc(/no betting odds/i.test(src.excluded || "") ? ODDS_NOTE : src.excluded)}</span></li>
      </ul></div>
      <div class="card"><h2>Double-checking the box scores</h2>
        <p>Every player line from ESPN is compared with the official NBA.com game log.</p>
        <div class="tiles"><div class="tile"><div class="l">Player lines compared</div><div class="v">${src.crossCheck.checked.toLocaleString()}</div></div><div class="tile"><div class="l">Exact agreement</div><div class="v">${src.crossCheck.agreement}%</div></div></div>
        <details class="more"><summary>Examples where the two sources differ</summary><div class="tw"><table><thead><tr><th>Date</th><th>Player</th><th class="n">ESPN (pts/reb/ast)</th><th class="n">NBA.com</th></tr></thead>
        <tbody>${src.crossCheck.sample.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.n)}</td><td class="n">${x.espn.join("/")}</td><td class="n">${x.nba.join("/")}</td></tr>`).join("")}</tbody></table></div></details>
      </div>`;
  } else {
    body = `<div class="card"><h2>How a projection is made</h2><ol class="dots">
        <li><b>Baseline from data.</b> Each player's recent per-minute production (recent games count more), expected minutes, and five separate team rating systems: recent efficiency, a player-by-player build-up, Elo, opponent-adjusted efficiency, and the same with three-point luck removed.</li>
        <li><b>Who is playing.</b> Players listed out are removed. Their minutes and shots go to teammates, using what actually happened in past games without them where that exists.</li>
        <li><b>Situations.</b> Rest, back-to-backs, travel distance, time zones, altitude, streaks, blowout risk, opponent defence by position, opponent style, missing stars on either side. Each has an effect learned from every past game it appeared in.</li>
        <li><b>Personal matchups.</b> Each player's own record against this team, in this arena, when specific opponents play, against defender types and team sizes. Small samples are shrunk heavily.</li>
        <li><b>Zone and defender matchups.</b> Where each player takes and makes his shots is laid over what the opponent allows in the same zones, and over the numbers of its likely defenders. Each of these matchup factors is only used as far as it improved projections on games it had not seen; most are held at zero so far, and the <a href="#/why">Why page</a> shows the verdict on each one.</li>
        <li><b>Honest percentages.</b> The win chance is tuned so that 70% really means about 70%.</li>
      </ol></div>
      <div class="card"><h2>How it learns</h2><p>The whole history is replayed in order, starting October 2025: 2025-26 preseason, regular season, play-in and playoffs, then 2026-27 preseason and season to date. Each game is projected using only what was known before tip-off, compared with the result, and the gap is split into causes (minutes, shot volume, shot-making, pace, overtime, turnovers, who actually played). Those gaps update the situation library and the personal matchup records before the next game is projected.</p>
        <p>Each game is projected only from the games before it. The replay can still be slightly flattered (it knows starting line-ups and inactives, uses this season's 2K ratings for past games, and its settings were tested on these same seasons), so the cleanest measure is the record of predictions saved before tip-off on the <a href="#/accuracy">Accuracy report</a>.</p></div>
      <div class="card"><h2>Limits worth knowing</h2><ul class="dots">
        <li>Starting lineups and late scratches are only known close to tip-off. Projections update each time the data refreshes.</li>
        <li>About one game in three is called wrong. Basketball has real randomness, mostly shot-making on the night.</li>
        <li>Matchup records based on three or four games are hints, not facts. The number of games is always shown.</li>
        <li>A zone edge "on paper" is arithmetic, not a forecast: it assumes an opponent's zone percentages carry over in full. Only the "applied" figure is in the projection.</li>
        <li>Hot and cold zones, playstyle tags and culture indicators are counts and rates from games, with their samples. They describe what happened on the floor, not a person.</li>
        <li>"Likely defenders" on Scout means the opponent's expected rotation. Tracked assignments (NBA.com "who guarded whom") and on-court lineups rebuilt from substitutions are shown on player, team and game pages as evidence; neither improved past projections, so neither moves a projection yet.</li>
        <li>Every date and time on the site is Philippine time (Asia/Manila). A few past-game lists marked "US date" show the American game date.</li>
        <li>2K ratings and commentary are context. The projections come from game data.</li>
      </ul></div>`;
  }
  app.innerHTML = `<h1>${tab === "takes" ? "Takes, checked" : tab === "sources" ? "Data sources" : "How it works"}</h1>
    <nav class="filters" aria-label="More sections">${tabs.map(([k, l]) => `<a class="fbtn" href="#/more/${k}"${tab === k ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>${body}`;
  app.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", async () => { S.kind = b.dataset.kind; await vMore("takes"); [...app.querySelectorAll("[data-kind]")].find((x) => x.dataset.kind === S.kind)?.focus({ preventScroll: true }); }));
}

// ---------------------------------------------------------------- Lab: simulation, high-confidence board, season, insights, compare
// Batch 3 tabs, all under the "Lab" tab. They read sim/, board.json, simcal.json, season.json, insights.json, compare/ and
// odds.json. Sportsbook numbers appear ONLY on #/sim/<id> and #/board, always under a "for comparison only" label; they come
// from the comparison blocks the simulation writes (odds.json only for the fetch time) and feed nothing on this site.
//   go(href)                      navigate by a real link click (works in the bundled build too)
//   histChart(el, hist, opts)     one-axis column chart of a simulated distribution, hover/tap tooltips; caller adds the table
//   rangeBar(d, max)              10th-90th whisker, middle-half box and median tick on a 0..max scale
//   calChart(el, rows)            said-vs-happened dots against the diagonal
const CMP_TXT = "For comparison only";
const cmpChip = `<span class="chip warn cmp-chip">${CMP_TXT}</span>`;
const pc1 = (p) => (p == null || Number.isNaN(Number(p)) ? "-" : `${(p * 100).toFixed(1)}%`);
const hp = (x) => (x == null || Number.isNaN(Number(x)) ? "-" : `${f1(x)}%`); // a value already in percent
const nf = (x) => (x == null || Number.isNaN(Number(x)) ? "-" : Number.isInteger(Number(x)) ? String(x) : f1(x));
const abbr = (tid) => esc(T(tid).abbr);
const mgTxt = (m, home, away) => (m == null || Number.isNaN(Number(m)) ? "-" : Math.abs(m) < 0.05 ? "even" : `${abbr(m > 0 ? home : away)} by ${nf(Math.abs(m))}`);
const lineTxt = (x) => (x == null ? "-" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`);
function go(href) { const a = document.createElement("a"); a.href = href; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); }
const dObj = (a, cols = ["mean", "median", "sd", "p10", "p25", "p75", "p90"]) => (Array.isArray(a) ? Object.fromEntries(cols.map((c, i) => [c, a[i]])) : a || {});
const sampleTag = (n, small = 10) => smallTag(n != null && n < small);

function rangeBar(d, max) {
  if (!d || d.p10 == null || !(max > 0)) return "";
  const P = (v) => Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1);
  return `<span class="rbar" role="img" aria-label="8 times in 10 between ${nf(d.p10)} and ${nf(d.p90)}, middle half ${nf(d.p25)} to ${nf(d.p75)}, median ${nf(d.median)}">
    <span class="rb-w" style="left:${P(d.p10)}%;width:${(P(d.p90) - P(d.p10)).toFixed(1)}%"></span><span class="rb-b" style="left:${P(d.p25)}%;width:${(P(d.p75) - P(d.p25)).toFixed(1)}%"></span><span class="rb-m" style="left:${P(d.median)}%"></span></span>`;
}

function histChart(el, h, { binLabel, tick, tickEvery, color = () => 1, mark = null }) {
  const share = h.share || [], n = share.length;
  if (!n) { el.innerHTML = `<p class="small muted">No distribution in this file.</p>`; return; }
  const f = chartFrame(el, 180), iw = f.W - f.l - f.r, ih = f.H - f.t - f.b;
  const top = Math.max(2, Math.ceil(Math.max(...share) / 2) * 2);
  const slot = iw / n, bw = Math.max(1.5, slot - (slot > 6 ? 2 : 1));
  const x = (i) => f.l + slot * i + slot / 2;
  const xv = (v) => f.l + ((v - h.from) / (h.step * n)) * iw;
  const y = (v) => f.t + ih - (v / top) * ih;
  const bars = share.map((v, i) => `<rect class="hb" data-i="${i}" x="${(x(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(0) - y(v)).toFixed(1)}" fill="var(--s${color(h.from + i * h.step)})" rx="1"/>`).join("");
  const ticks = [];
  for (let i = 0; i <= n; i++) { const v = h.from + i * h.step; if (v % tickEvery === 0) ticks.push(v); }
  let lastX = -99;
  const xt = ticks.filter((v) => { const px = xv(v); if (px - lastX < 46) return false; lastX = px; return true; })
    .map((v) => `<text x="${xv(v).toFixed(1)}" y="${f.H - 6}" text-anchor="middle">${esc(tick(v))}</text>`).join("");
  const mk = mark && mark.v != null ? `<line x1="${xv(mark.v).toFixed(1)}" x2="${xv(mark.v).toFixed(1)}" y1="${f.t}" y2="${f.t + ih}" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="3 3"/><text x="${Math.min(f.W - f.r - 2, xv(mark.v) + 4).toFixed(1)}" y="${f.t + 10}" text-anchor="${xv(mark.v) > f.W - 90 ? "end" : "start"}" style="fill:var(--ink-2)">${esc(mark.label)}</text>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(el.dataset.label || "Distribution chart")}">
    ${[0, top / 2, top].map((t) => `<line class="${t ? "grid" : "axis"}" x1="${f.l}" x2="${f.W - f.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${f.l - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${nf(t)}%</text>`).join("")}
    ${bars}${mk}${xt}</svg>`;
  const rects = el.querySelectorAll(".hb");
  attachHover(el, n, x, (i, cx, cy) => {
    rects.forEach((r, j) => r.setAttribute("opacity", j === i ? 1 : 0.55));
    showTip(`<b>${esc(binLabel(i))}</b><br>${f1(share[i])}% of simulations`, cx, cy);
  });
  el.querySelector("svg").addEventListener("pointerleave", () => rects.forEach((r) => r.removeAttribute("opacity")));
}
// The same distribution as a table (the chart's accessible alternative): bins with any simulations.
const histTable = (h, binLabel, head) => `<details class="more"><summary>Show as a table</summary><div class="tw"><table><thead><tr><th>${esc(head)}</th><th class="n">Share of simulations</th></tr></thead><tbody>
  ${(h.share || []).map((v, i) => (v > 0 ? `<tr><td>${esc(binLabel(i))}</td><td class="n">${f1(v)}%</td></tr>` : "")).join("")}</tbody></table></div></details>`;

function calChart(el, rows) {
  const pts = rows.filter((r) => r.said != null && r.happened != null);
  const f = chartFrame(el, 200), iw = f.W - f.l - f.r, ih = f.H - f.t - f.b, lo = 50, hi = 100;
  const x = (v) => f.l + ((v - lo) / (hi - lo)) * iw, y = (v) => f.t + ih - ((v - lo) / (hi - lo)) * ih;
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(el.dataset.label || "Calibration chart")}">
    ${[50, 75, 100].map((t) => `<line class="grid" x1="${f.l}" x2="${f.W - f.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${f.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text><text x="${x(t)}" y="${f.H - 6}" text-anchor="middle">${t}%</text>`).join("")}
    <line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" stroke="var(--axis)" stroke-dasharray="4 4"/>
    ${pts.map((r) => `<circle cx="${x(r.said).toFixed(1)}" cy="${y(r.happened).toFixed(1)}" r="4.5" fill="var(--s1)" stroke="var(--surface)" stroke-width="1.5"/>`).join("")}</svg>`;
  attachHover(el, pts.length, (i) => x(pts[i].said), (i, cx, cy) => showTip(`<b>${esc(pts[i].band)}</b><br>Said ${hp(pts[i].said)}, happened ${hp(pts[i].happened)}<br>${num(pts[i].n)} cases`, cx, cy));
}
const calTable = (rows, what = "Cases") => `<div class="tw"><table><thead><tr><th>Band</th><th class="n">${esc(what)}</th><th class="n">Said</th><th class="n">Happened</th><th class="n">Gap</th></tr></thead><tbody>
  ${rows.filter((r) => r.n).map((r) => `<tr><td>${esc(r.band)}${sampleTag(r.n, 30)}</td><td class="n">${num(r.n)}</td><td class="n">${hp(r.said)}</td><td class="n">${hp(r.happened)}</td><td class="n ${cls((r.happened ?? 0) - (r.said ?? 0))}">${sg((r.happened ?? 0) - (r.said ?? 0))}</td></tr>`).join("")}</tbody></table></div>`;

// ---- links into the Lab from version 1 pages (additions only)
const labLinks = (g) => `<div class="card-x" role="group" aria-label="${abbr(g.away)} at ${abbr(g.home)}: more"><a href="#/sim/${esc(g.id)}">Simulation lab ›</a><a href="#/insights/${esc(g.id)}">Similar games &amp; disagreement ›</a></div>`;
function gameLabCard(g, row) {
  const H = g.home, A = g.away;
  return `<div class="card lab-cta">
    <div><b>Simulation lab</b><span class="small muted">${row ? `${num(row.sims || 10000)} simulated games: ${abbr(row.pHome >= 0.5 ? H : A)} wins ${pct(Math.max(row.pHome, 1 - row.pHome))}, median margin ${mgTxt(row.margin, H, A)}, total ${nf(row.total)}.` : "Score ranges, scenarios and player distributions for this game."}</span></div>
    <div class="jump"><a class="btn" href="#/sim/${esc(g.id)}">Open the simulation</a><a class="btn" href="#/insights/${esc(g.id)}">Similar games &amp; disagreement</a></div></div>`;
}

// ---- Lab hub
const LAB = [
  ["picks", "Picks", "Player and team props at 85% and up, near-certain 95%+ picks, alternative lines, why each one, and suggested parlays."],
  ["sim", "Simulation lab", "Each upcoming game played 10,000 times: win chance, score ranges, what-if scenarios and every player's range."],
  ["board", "High-confidence board", "Every market the simulation puts at 85% or more, next to how often picks like it came true before."],
  ["season", "Season simulation", "The rest of the season played out 20,000 times: projected wins, seeds and playoff chances."],
  ["insights", "Insights", "Similar past games and where the five rating systems disagree, game by game, plus the trust meter."],
  ["breakout", "Breakout watch", "Players whose minutes or role should jump, with the back-tested hit rate."],
  ["today", "What changed", "New injuries, role changes and the biggest projection moves since the last refresh."],
  ["compare", "Compare", "Two players or two teams side by side."],
];
async function vLab() {
  app.innerHTML = `<h1>Lab</h1>
    <p class="lead">Extra tools built on top of the projections. Nothing in the Lab changes a projection; the game pages stay exactly as they are.</p>
    <div class="lab-g">${LAB.map(([k, l, d]) => `<a class="card lab-i" href="#/${k}"><b>${esc(l)} ›</b><span class="small muted">${esc(d)}</span></a>`).join("")}</div>
    <p class="small muted">Sportsbook lines appear only in the Simulation lab and the High-confidence board, labelled "for comparison only". They are never used by the projections, the learning, the scenarios or the simulation.</p>`;
}
const labBack = `<a class="back" href="#/more">‹ More</a>`;

// ---- Simulation lab: list of games + calibration
async function vSim(id) {
  if (!id) return vSimList();
  const s = await load(`sim/${id}.json`);
  return simPage(s);
}
async function vSimList() {
  const [ix, cal] = await Promise.all([load("sim/index.json"), load("simcal.json").catch(() => null)]);
  S.simN = ix.sims || S.simN;
  const gs = ix.games || [];
  const groups = new Map();
  for (const g of gs) { const k = dayKey(g.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  const row = (tid, p, win) => `<div class="g-row ${win ? "" : "lose"}">${teamLogo(tid, { size: "md" })}<span class="name">${esc(T(tid).name)}</span><span class="sc">${pct(p)}</span></div>`;
  app.innerHTML = `${labBack}<h1>Simulation lab</h1>
    <p class="lead">Each game is played ${num(ix.sims)} times, possession by possession, from the model's projection and rates counted from finished games. Every simulated game adds up: minutes, player box scores, quarters and the final score. Betting lines are not an input; where a sportsbook line appears it is for comparison only. Tap a game for its distributions and what-if scenarios.</p>
    ${gs.length ? [...groups.entries()].map(([, list]) => `<h2 class="day"><span>${esc(dayLong(list[0].date))}</span><span class="cnt">${list.length} ${list.length === 1 ? "game" : "games"} · ${PHT}</span></h2>
      ${list.map((g) => `<a class="card" href="#/sim/${esc(g.id)}"><div class="g-top"><span class="when">${esc(timePH(g.date))}</span><span>Win chance in the simulations</span></div>
        ${row(g.away, 1 - g.pHome, g.pHome < 0.5)}${row(g.home, g.pHome, g.pHome >= 0.5)}
        <div class="g-lines"><span><i>Median margin</i> ${mgTxt(g.margin, g.home, g.away)}</span><span><i>Total</i> ${nf(g.total)}</span><span><i>Overtime</i> ${pc1(g.pOT)}</span></div></a>`).join("")}`).join("")
      : `<p class="empty">No simulated games yet. They appear after the next data refresh.</p>`}
    ${cal ? calCard(cal) : ""}
    <p class="small muted">Simulations generated ${esc(stamp(ix.generated))} from the data refresh of ${esc(stamp(ix.dataUpdated))}.</p>`;
  app.querySelectorAll(".chart[data-cal]").forEach((el) => calChart(el, S.calRows[el.dataset.cal] || []));
}
function calCard(c) {
  S.calRows = { win: c.winner?.table || [], all: c.markets?.all || [] };
  const r = c.ranges || {};
  return `<section class="card" aria-labelledby="cal-h"><h2 id="cal-h">How honest are the simulated chances?</h2>
    <p class="small muted">${esc(c.note || "")} ${esc(num(c.method?.games))} finished games, ${esc(num(c.method?.simsPerGame))} simulations each. Dots on the dashed line mean "said 80%, happened 80%".</p>
    <h3>Winner</h3><div class="chart" data-cal="win" data-label="Winner calibration: simulated chance against how often the team won"></div>
    <p class="small">Brier score (lower is better): simulation ${esc(nf(c.winner?.brierSim))}, model ${esc(nf(c.winner?.brierModel))}. Average margin miss: ${esc(nf(c.winner?.marginMaeSimMean))} and ${esc(nf(c.winner?.marginMaeModel))} points.</p>
    <details class="more"><summary>Winner calibration as a table</summary>${calTable(c.winner?.table || [], "Games")}</details>
    <h3>Every market (winner, spreads, totals, player thresholds)</h3><div class="chart" data-cal="all" data-label="All markets calibration"></div>
    <details class="more"><summary>All markets as a table</summary>${calTable(c.markets?.all || [], "Markets")}</details>
    <h3>80% ranges (target 80%)</h3>
    <div class="tw"><table><thead><tr><th>What</th><th class="n">Cases</th><th class="n">Inside</th><th class="n">Above</th><th class="n">Below</th></tr></thead><tbody>
      ${[["margin", "Margin"], ["total", "Total points"], ["pts", "Player points"], ["reb", "Player rebounds"], ["ast", "Player assists"]].filter(([k]) => r[k]).map(([k, l]) => `<tr><td>${l}</td><td class="n">${num(r[k].n)}</td><td class="n">${hp(r[k].inside)}</td><td class="n">${hp(r[k].above)}</td><td class="n">${hp(r[k].below)}</td></tr>`).join("")}</tbody></table></div>
    ${c.scenarios?.rows?.length ? `<h3>Scenarios: simulated vs real</h3><div class="tw"><table><thead><tr><th>Scenario</th><th class="n">Simulated</th><th class="n">Happened</th></tr></thead><tbody>${c.scenarios.rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${hp(x.simulated)}</td><td class="n">${hp(x.happened)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${c.method?.tipoffTrack ? `<p class="note">${esc(c.method.tipoffTrack)}</p>` : ""}
  </section>`;
}

// ---- Simulation lab: one game
const SIM_STATS = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["tpm", "Threes"], ["pra", "Pts+Reb+Ast"], ["stl", "Steals"], ["blk", "Blocks"], ["min", "Minutes"]];
const SCN_SHORT = { normal: "Ordinary game", close: "Close finish", blowH: "Home blowout", blowA: "Road blowout", ot: "Overtime", injH: "Home injury", injA: "Road injury", foulH: "Home foul trouble", foulA: "Road foul trouble", hotH: "Home hot", coldH: "Home cold", hotA: "Road hot", coldA: "Road cold", fast: "Fast pace", slow: "Slow pace", rotH: "Home rotation change", rotA: "Road rotation change" };
function simPage(s) {
  const H = s.home, A = s.away, F = s.forecast || {}, cols = s.distCols;
  const D = (a) => dObj(a, cols);
  S.simN = s.sims || S.simN;
  if (S.simGame !== s.id) { S.simGame = s.id; S.simSc = "all"; S.simSide = "all"; }
  S.simStat = S.simStat || "pts";
  const pName = Object.fromEntries((s.players || []).map((p) => [p.id, p]));
  const scName = (sc) => (SCN_SHORT[sc.id] || sc.label || sc.id).replace(/^Home/, T(H).abbr).replace(/^Road/, T(A).abbr);
  const mBin = (i) => { const h = F.margin.hist, lo = h.from + i * h.step, hi = lo + h.step - 1; if (i === 0) return `${T(A).abbr} by ${Math.abs(hi)}+`; if (i === h.share.length - 1) return `${T(H).abbr} by ${lo}+`; if (hi < 0) return `${T(A).abbr} by ${Math.abs(hi)}${hi !== lo ? `-${Math.abs(lo)}` : ""}`; return `${T(H).abbr} by ${Math.max(lo, 1)}${hi > Math.max(lo, 1) ? `-${hi}` : ""}`; };
  const tBin = (i) => { const h = F.total.hist, lo = h.from + i * h.step, hi = lo + h.step - 1; if (i === 0) return `${hi} or fewer`; if (i === h.share.length - 1) return `${lo} or more`; return `${lo}-${hi}`; };
  const L = s.lines || {}, Q = F.quarters || {};
  const favH = (F.pHome ?? s.pHome) >= 0.5;
  const teamRow = (tid, d, side) => `<tr><td>${teamName(tid, { text: "abbr" })}</td><td class="n">${nf(d?.mean)}</td><td class="n">${nf(d?.median)}</td><td class="n">${nf(d?.p10)}-${nf(d?.p90)}</td><td class="wide-cell">${rangeBar(d, Math.max(F.home?.p90 || 0, F.away?.p90 || 0) * 1.05)}</td><td class="n">${L.teamTotals?.[side] ? `${nf(L.teamTotals[side].line)} <i>O ${pct(L.teamTotals[side].pOver)}</i>` : "-"}</td></tr>`;
  const c = s.comparison;
  app.innerHTML = `<a class="back" href="#/game/${esc(s.id)}">‹ Game page</a>
    <h1>Simulation lab: ${abbr(A)} at ${abbr(H)}</h1>
    <p class="muted small">${esc(dayLong(s.date))} · ${esc(timePH(s.date))}${s.venue ? " · " + esc(s.venue) : ""} · ${num(s.sims)} simulated games</p>
    <p class="small muted">${esc(s.label || "")}</p>

    <div class="card hero">
      <div class="teams">${heroSide(A, pct(F.pAway ?? 1 - F.pHome), "win chance")}<span class="at">at</span>${heroSide(H, pct(F.pHome), "win chance")}</div>
      <div class="wp" aria-hidden="true"><span class="${favH ? "" : "fav"}" style="flex:${1 - F.pHome}"></span><span class="${favH ? "fav" : ""}" style="flex:${F.pHome}"></span></div>
      <div class="statgrid sg4" style="margin-top:12px">
        <div class="stat"><b>${mgTxt(F.margin?.median, H, A)}</b><span>Median margin</span><span>8 in 10: ${mgTxt(F.margin?.p10, H, A)} to ${mgTxt(F.margin?.p90, H, A)}</span></div>
        <div class="stat"><b>${nf(F.total?.median)}</b><span>Median total</span><span>8 in 10: ${nf(F.total?.p10)}-${nf(F.total?.p90)}</span></div>
        <div class="stat"><b>${pc1(F.pOT)}</b><span>Overtime</span></div>
        <div class="stat"><b>${abbr(A)} ${nf(s.inputs?.proj?.as)} · ${abbr(H)} ${nf(s.inputs?.proj?.hs)}</b><span>Model projection</span><span>${abbr(H)} ${pct(s.inputs?.proj?.pHome)}</span></div>
      </div>
      <p class="small muted" style="margin-top:10px">Probability-weighted forecast: every scenario below counted as often as it came up in the simulations. The model's own projection is shown for reference; the simulation starts from it.</p>
    </div>

    <nav class="filters jumpnav" aria-label="Sections of this simulation">${[["s-dist", "Distributions"], ["s-scn", "What if"], ["s-pl", "Players"], ["s-lines", "Our lines"], ["s-joint", "Combinations"], ...(c ? [["s-cmp", "Sportsbook (comparison)"]] : []), ["s-how", "How it was made"]].map(([k, l]) => `<button class="fbtn" type="button" data-jump="${k}">${l}</button>`).join("")}</nav>

    <section class="card" id="s-dist" tabindex="-1" aria-labelledby="s-dist-h"><h2 id="s-dist-h">Score distributions</h2>
      <h3>Margin (overtime included)</h3>
      <div class="legend"><span><i style="background:var(--s1)"></i>${abbr(H)} wins</span><span><i style="background:var(--s2)"></i>${abbr(A)} wins</span></div>
      <div class="chart" id="s-mg" data-label="Simulated margin distribution, ${abbr(A)} at ${abbr(H)}"></div>
      <p class="small muted">Mean ${mgTxt(F.margin?.mean, H, A)}, median ${mgTxt(F.margin?.median, H, A)}; half of the simulations fall between ${mgTxt(F.margin?.p25, H, A)} and ${mgTxt(F.margin?.p75, H, A)}. The first and last columns include everything beyond them.</p>
      ${histTable(F.margin.hist, mBin, "Margin")}
      <h3>Total points</h3>
      <div class="chart" id="s-tot" data-label="Simulated total points distribution"></div>
      <p class="small muted">Mean ${nf(F.total?.mean)}, median ${nf(F.total?.median)}; the dashed line is our fair total (${nf(L.total?.line)}).</p>
      ${histTable(F.total.hist, tBin, "Total points")}
      <h3>Team points</h3>
      <div class="tw"><table class="simt"><thead><tr><th>Team</th><th class="n">Mean</th><th class="n">Median</th><th class="n">8 in 10</th><th>Range</th><th class="n">Our line</th></tr></thead><tbody>${teamRow(A, F.away, "away")}${teamRow(H, F.home, "home")}</tbody></table></div>
      ${Q.home ? `<h3>Quarter by quarter (average points)</h3>
      <div class="tw"><table><thead><tr><th>Team</th><th class="n">Q1</th><th class="n">Q2</th><th class="n">Q3</th><th class="n">Q4</th><th class="n">OT</th></tr></thead><tbody>
        ${[[A, Q.away, Q.overtime?.away], [H, Q.home, Q.overtime?.home]].map(([tid, q, ot]) => `<tr><td>${abbr(tid)}</td>${q.map((v) => `<td class="n">${f1(v)}</td>`).join("")}<td class="n">${f1(ot)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">${abbr(H)} wins the first quarter in ${pct(Q.pHomeWinsQ1)} of simulations and leads at half-time in ${pct(Q.pHomeLeadsHalf)}. First-half margin: median ${mgTxt(Q.firstHalfMargin?.median, H, A)} (8 in 10: ${mgTxt(Q.firstHalfMargin?.p10, H, A)} to ${mgTxt(Q.firstHalfMargin?.p90, H, A)}). OT column = average overtime points over all simulations (most have none).</p>` : ""}
    </section>

    <section class="card" id="s-scn" tabindex="-1" aria-labelledby="s-scn-h"><h2 id="s-scn-h">What if: scenarios</h2>
      <p class="small muted">Each scenario is a group of simulated games where something specific happened. Tap one to see the game as it plays out in that group, and who gains or loses. "Back-test" shows how often the same thing really happened in finished games.</p>
      <div class="filters wrap" role="group" aria-label="Choose a scenario"><button class="fbtn" type="button" data-sc="all" aria-pressed="${S.simSc === "all"}">All simulations</button>${(s.scenarios || []).map((sc) => `<button class="fbtn" type="button" data-sc="${esc(sc.id)}" aria-pressed="${S.simSc === sc.id}">${esc(scName(sc))} <span class="cnt">${pct(sc.freq)}</span></button>`).join("")}</div>
      <div id="scn-view" aria-live="polite"></div>
      ${s.combos?.length ? `<h3>Scenario combinations</h3><ul class="plain">${s.combos.map((x) => `<li><div class="spread"><b>${esc(x.label)}</b><span class="num">${pc1(x.freq)}</span></div><div class="small muted">${esc(x.text)}</div></li>`).join("")}</ul>
      <p class="small muted">"Times as often as if unrelated" shows which events travel together in the simulations (for example a cold shooting night and a blowout).</p>` : ""}
    </section>

    <section class="card" id="s-pl" tabindex="-1" aria-labelledby="s-pl-h"><h2 id="s-pl-h">Player distributions</h2>
      <p class="small muted">Each bar: thin line = 8 in 10 simulations, thick part = the middle half, tick = median. Our line is the fair 50/50 line (x.5). Tap a player for his chances of reaching each threshold.</p>
      <div class="filters" role="group" aria-label="Choose a stat">${SIM_STATS.map(([k, l]) => `<button class="fbtn" type="button" data-st="${k}" aria-pressed="${S.simStat === k}">${l}</button>`).join("")}</div>
      <div class="filters" role="group" aria-label="Choose a team">${[["all", "Both teams"], ["1", T(A).abbr], ["0", T(H).abbr]].map(([k, l]) => `<button class="fbtn" type="button" data-sd="${k}" aria-pressed="${S.simSide === k}">${esc(l)}</button>`).join("")}</div>
      <div id="spl-out"></div>
    </section>

    <section class="card" id="s-lines" tabindex="-1" aria-labelledby="s-lines-h"><h2 id="s-lines-h">Our fair lines</h2>
      <p class="small muted">${esc(L.note || "The simulation's own 50/50 lines, not sportsbook lines.")}</p>
      <div class="statgrid lines-grid">
        <div class="stat"><b>${abbr(H)} ${lineTxt(L.spread?.homeLine)}</b><span>Spread (${abbr(H)} covers ${pc1(L.spread?.pHomeCovers)})</span></div>
        <div class="stat"><b>${abbr(H)} ${L.winOdds?.home > 0 ? "+" : "−"}${esc(Math.abs(L.winOdds?.home ?? 0))}</b><span>Moneyline (${abbr(A)} ${L.winOdds?.away > 0 ? "+" : "−"}${esc(Math.abs(L.winOdds?.away ?? 0))})</span></div>
        <div class="stat"><b>${nf(L.total?.line)}</b><span>Total (over ${pc1(L.total?.pOver)})</span></div>
        <div class="stat"><b>${abbr(A)} ${nf(L.teamTotals?.away?.line)}</b><span>Team total</span></div>
        <div class="stat"><b>${abbr(H)} ${nf(L.teamTotals?.home?.line)}</b><span>Team total</span></div>
        <div class="stat"><b>${pc1(F.pHome)}</b><span>${abbr(H)} win chance</span></div>
      </div>
      ${L.spread?.note ? `<p class="small muted" style="margin-top:8px">${esc(L.spread.note)}. Moneylines are fair prices for the win chance with no bookmaker margin. Player lines are in the player list above.</p>` : ""}
    </section>

    <section class="card" id="s-joint" tabindex="-1" aria-labelledby="s-joint-h"><h2 id="s-joint-h">Same-game combinations</h2>
      <p class="small muted">Counted in the same simulated games, so players and the result move together the way they do on the court. "If unrelated" multiplies the two chances, only to show how much they are linked.</p>
      ${s.joint?.length ? `<div class="tw"><table><thead><tr><th>Both happen</th><th class="n">Chance</th><th class="n">If unrelated</th></tr></thead><tbody>
        ${s.joint.map((j) => `<tr><td>${esc(j.label)}<div class="small muted">${esc(j.a?.label)} ${pct(j.a?.p)} · ${esc(j.b?.label)} ${pct(j.b?.p)}</div></td><td class="n"><b>${pc1(j.p)}</b></td><td class="n">${pc1(j.ifUnrelated)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No combinations in this file.</p>`}
    </section>

    ${c ? cmpCard(c, s) : ""}

    <section class="card" id="s-how" tabindex="-1" aria-labelledby="s-how-h"><h2 id="s-how-h">How this was made</h2>
      <ul class="dots small">${(s.inputs?.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      ${s.inputs?.lateOut?.length ? `<p class="small"><b>Left out (NBA.com inactive list):</b> ${esc(s.inputs.lateOut.map((x) => x.n || x).join(", "))}</p>` : ""}
      <details class="more"><summary>Reproducibility and calibrated settings</summary>
        <dl class="kv stack small">
          <dt>Engine</dt><dd>${esc(s.config?.engine)}</dd>
          <dt>Simulations</dt><dd>${num(s.config?.sims)} (plus ${num(s.config?.pilotSims)} pilot runs)</dd>
          <dt>Seed</dt><dd>${esc(s.config?.seed)}</dd>
          <dt>Generated</dt><dd>${esc(stamp(s.generated))}</dd>
          <dt>From data of</dt><dd>${esc(stamp(s.dataUpdated))}</dd>
          <dt>Spread target</dt><dd>${esc((s.config?.calibrated?.targetSd || []).join(" / "))} points (home / road), engine alone ${esc((s.config?.calibrated?.engineSd || []).join(" / "))}</dd>
          <dt>Counted rates</dt><dd>${num(s.config?.params?.games)} finished games; in-game exits ${num(s.config?.params?.exitEvents)} events; overtime share of close games ${pc1(s.config?.params?.otShareOfClose)} (${num(s.config?.params?.otCloseGames)} games)</dd>
        </dl>
        <p class="small">Run again with the same data files:</p><pre class="code">${esc(s.config?.reproduce)}</pre>
        ${s.config?.calibrated?.note ? `<p class="small muted">${esc(s.config.calibrated.note)}</p>` : ""}
      </details>
      <p class="small"><a class="go" href="#/sim">Calibration of all simulations ›</a> <a class="go" href="#/board">High-confidence board ›</a></p>
    </section>`;

  const mgEl = document.getElementById("s-mg"), totEl = document.getElementById("s-tot");
  if (F.margin?.hist) histChart(mgEl, F.margin.hist, { binLabel: mBin, tickEvery: 20, tick: (v) => (v === 0 ? "0" : `${T(v < 0 ? A : H).abbr} ${Math.abs(v)}`), color: (lo) => (lo < 0 ? 2 : 1) });
  if (F.total?.hist) histChart(totEl, F.total.hist, { binLabel: tBin, tickEvery: 20, tick: (v) => String(v), mark: L.total?.line != null ? { v: L.total.line, label: `our line ${nf(L.total.line)}` } : null });

  // What-if view
  const allMean = Object.fromEntries((s.players || []).map((p) => [p.id, { pts: D(p.dist.pts).mean, min: D(p.dist.min).mean, reb: D(p.dist.reb).mean, ast: D(p.dist.ast).mean }]));
  const drawScn = () => {
    const out = document.getElementById("scn-view"), sc = (s.scenarios || []).find((x) => x.id === S.simSc);
    app.querySelectorAll("[data-sc]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sc === S.simSc)));
    if (!sc) {
      out.innerHTML = `<div class="scn-v"><p>All ${num(s.sims)} simulations together: ${abbr(H)} wins ${pc1(F.pHome)}, median margin ${mgTxt(F.margin?.median, H, A)}, total ${nf(F.total?.median)}. The most common groups: ${(s.scenarios || []).slice().sort((a, b) => b.freq - a.freq).slice(0, 4).map((x) => `${esc(scName(x))} ${pct(x.freq)}`).join(", ")}. Groups overlap (a game can be close and go to overtime), so they do not add up to 100%.</p></div>`;
      return;
    }
    const d = (v, all, fmt = f1) => (v == null || all == null ? "" : ` <i class="${cls(v - all)}">${sg(v - all)}</i>`);
    const ratio = sc.hist?.rate ? sc.freq / sc.hist.rate : null;
    const rows = (sc.players || []).map(([pid, pts, min, reb, ast]) => ({ p: pName[pid], pts, min, reb, ast, all: allMean[pid] })).filter((r) => r.p && r.min >= 1);
    const side = (k) => rows.filter((r) => String(r.p.side) === k).sort((a, b) => b.min - a.min);
    const tbl = (k, tid) => `<h4>${abbr(tid)}</h4><div class="tw"><table class="simt"><thead><tr><th>Player</th><th class="n">Min</th><th class="n">Pts</th><th class="n">Reb</th><th class="n">Ast</th></tr></thead><tbody>
      ${side(k).map((r) => `<tr><td>${pname(r.p.n)}</td><td class="n">${f1(r.min)}${d(r.min, r.all?.min)}</td><td class="n">${f1(r.pts)}${d(r.pts, r.all?.pts)}</td><td class="n">${f1(r.reb)}${d(r.reb, r.all?.reb)}</td><td class="n">${f1(r.ast)}${d(r.ast, r.all?.ast)}</td></tr>`).join("")}</tbody></table></div>`;
    const mv = (list, up) => (list?.length ? `<ul class="plain small">${list.map((g) => `<li class="spread"><span>${playerChip(g.id, g.n, { href: `#/player/${g.id}` })} <span class="muted">${abbr(g.side === 0 ? H : A)}</span></span><span class="num"><b class="${up ? "up" : "down"}">${sg(g.pts)} pts</b> <span class="muted">${sg(g.min)} min · ${f1(g.ptsIn)} in this scenario</span></span></li>`).join("")}</ul>` : `<p class="small muted">No change of a point or more.</p>`);
    out.innerHTML = `<div class="scn-v">
      <h3>${esc(sc.label)}</h3>
      <div class="statgrid sg4">
        <div class="stat"><b>${pc1(sc.freq)}</b><span>of simulations</span><span>${num(sc.sims)} games</span></div>
        <div class="stat"><b>${pct(sc.pHome)}</b><span>${abbr(H)} win chance</span><span>all: ${pct(F.pHome)}</span></div>
        <div class="stat"><b>${mgTxt(sc.margin, H, A)}</b><span>Average margin</span><span>all: ${mgTxt(F.margin?.mean, H, A)}</span></div>
        <div class="stat"><b>${abbr(A)} ${nf(sc.away)} · ${abbr(H)} ${nf(sc.home)}</b><span>Average score</span><span>total ${nf(sc.total)} (${sg(sc.total - F.total?.mean)})</span></div>
      </div>
      <p class="small" style="margin-top:10px">${sc.hist ? `<b>Back-test:</b> this happened in ${pc1(sc.hist.rate)} of ${num(sc.hist.n)} ${esc(sc.hist.what)}; the simulation has it in ${pc1(sc.freq)}.${smallTag(sc.hist.n < 30)}` : "<b>Back-test:</b> no separate count for this group (it is what is left when nothing unusual happens)."}</p>
      ${ratio != null && (ratio < 0.67 || ratio > 1.5) ? `<p class="note">The simulation produces this ${ratio < 1 ? "less" : "more"} often than real games did (${pc1(sc.freq)} vs ${pc1(sc.hist.rate)}). Read its chances with that in mind; the reason is listed under "Known limits" in the data notes${sc.id.startsWith("rot") ? " (each player's minutes surprise is drawn on its own, while real ones cluster)" : sc.id === "fast" || sc.id === "slow" ? " (pace noise is scaled down so that scores do not move together more than in real games)" : ""}.</p>` : ""}
      <p>${esc(sc.text)}</p>
      ${sc.who?.length ? `<h4>Who leaves</h4><ul class="plain small">${sc.who.map((w) => `<li class="spread"><span>${playerChip(w.id, w.n, { href: `#/player/${w.id}` })}</span><span class="num">${pct(w.share)} of these games · ${abbr(H)} wins ${pct(w.pHome)}</span></li>`).join("")}</ul>` : ""}
      <div class="grid two"><div><h4>Gains</h4>${mv(sc.gains, true)}</div><div><h4>Drops</h4>${mv(sc.losses, false)}</div></div>
      <details class="more"><summary>Every player in this scenario (change versus all simulations)</summary>${tbl("1", A)}${tbl("0", H)}</details>
    </div>`;
  };
  app.querySelectorAll("[data-sc]").forEach((b) => b.addEventListener("click", () => { S.simSc = b.dataset.sc; drawScn(); }));
  drawScn();

  // Player distributions
  const drawPl = () => {
    const st = S.simStat, out = document.getElementById("spl-out");
    app.querySelectorAll("[data-st]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.st === st)));
    app.querySelectorAll("[data-sd]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sd === S.simSide)));
    const list = (s.players || []).filter((p) => S.simSide === "all" || String(p.side) === S.simSide).map((p) => ({ p, d: D(p.dist[st]) })).filter((r) => r.d.mean != null).sort((a, b) => b.d.mean - a.d.mean);
    const max = Math.max(1, ...list.map((r) => r.d.p90 || 0)) * 1.05;
    const thr = (p) => SIM_STATS.filter(([k]) => p.thr?.[k]?.length).map(([k, l]) => `<tr><td>${l}</td><td>${p.thr[k].map(([v, q]) => `<span class="thr"><b>${esc(v)}+</b> ${pct(q)}</span>`).join("")}</td></tr>`).join("");
    out.innerHTML = list.length ? `<div class="spl">${list.map(({ p, d }) => {
      const pr = p.props?.[st];
      return `<details class="spl-r"><summary>
        <span class="spl-n">${avatar(p.id, p.n, { size: "sm" })}<span><b>${pname(p.n)}</b><i>${abbr(p.side === 0 ? H : A)}${p.pos ? " · " + esc(p.pos) : ""}${p.q ? ` · <span class="qtag">Q</span>` : ""}</i></span></span>
        <span class="spl-b">${rangeBar(d, max)}<i>${nf(d.p10)}-${nf(d.p90)}</i></span>
        <span class="spl-v"><b>${nf(d.median)}</b><i>${pr ? `line ${nf(pr.line)} · O ${pct(pr.pOver)}` : `mean ${f1(d.mean)}`}</i></span></summary>
        <div class="pbody">
          <p class="small">Mean ${f1(d.mean)}, median ${nf(d.median)}, middle half ${nf(d.p25)}-${nf(d.p75)}, 8 in 10 between ${nf(d.p10)} and ${nf(d.p90)}. Model projection: ${f1(p.proj?.min)} minutes, ${f1(p.proj?.pts)} points.</p>
          ${thr(p) ? `<h4>Chance of at least</h4><div class="tw"><table class="thr-t"><tbody>${thr(p)}</tbody></table></div>` : ""}
          ${p.props ? `<h4>Our fair lines</h4><p class="small">${SIM_STATS.filter(([k]) => p.props[k]).map(([k, l]) => `${l} ${nf(p.props[k].line)} (over ${pct(p.props[k].pOver)})`).join(" · ")}</p>` : ""}
          <p class="small muted">${p.shooting ? `Shooting in the simulations: ${f1(p.shooting.fgm)} of ${f1(p.shooting.fga)} (${f1(p.shooting.fgPct)}%), ${f1(p.shooting.tpa)} threes tried, ${f1(p.shooting.ftm)} of ${f1(p.shooting.fta)} free throws. ` : ""}${p.fouls ? `Fouls ${f1(p.fouls.mean)}; 5+ in ${pc1(p.fouls.p5)}, fouled out in ${pc1(p.fouls.p6)}. ` : ""}Does not play: ${pc1(p.pDnp)}. Blowout minutes: ${p.blowSrc === "player" ? "learned for him" : "by role"}.</p>
          <p class="small"><a class="go" href="#/player/${esc(p.id)}">${esc(p.n)}'s profile ›</a></p>
        </div></details>`;
    }).join("")}</div>` : `<p class="small muted">No players in this view.</p>`;
  };
  app.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => { S.simStat = b.dataset.st; drawPl(); }));
  app.querySelectorAll("[data-sd]").forEach((b) => b.addEventListener("click", () => { S.simSide = b.dataset.sd; drawPl(); }));
  drawPl();
}
const STAT_W = { pts: "points", reb: "rebounds", ast: "assists", tpm: "threes", stl: "steals", blk: "blocks", pra: "pts+reb+ast" };
function cmpCard(c, s) {
  const H = s.home, A = s.away;
  const row = (what, book, ours, note) => `<tr><td>${what}${note ? `<div class="small muted">${esc(note)}</div>` : ""}</td><td class="n">${book}</td><td class="n">${ours}</td></tr>`;
  return `<section class="card cmp" id="s-cmp" tabindex="-1" aria-labelledby="s-cmp-h"><h2 id="s-cmp-h">Sportsbook lines ${cmpChip}</h2>
    <p class="small">${esc(c.label || "For comparison only. Sportsbook lines are not used by the simulation, the projections or the learning.")}</p>
    <p class="small muted">${esc(c.provider || "Sportsbook")}${c.fetched ? `, fetched ${esc(stamp(c.fetched))}` : ""}. Book chances have the bookmaker margin removed. Nothing in this box changes any other number on the site.</p>
    <div class="tw"><table><thead><tr><th>Market</th><th class="n">Book</th><th class="n">Simulation</th></tr></thead><tbody>
      ${c.winner ? row(`${esc(c.winner.team)} wins`, pc1(c.winner.bookProb), pc1(c.winner.ourProb), c.winner.note) : ""}
      ${c.spread ? row(`${esc(c.spread.team)} ${lineTxt(c.spread.bookLine)}`, pc1(c.spread.bookProb), pc1(c.spread.ourProb), c.spread.note) : ""}
      ${c.total ? row(`Over ${nf(c.total.bookLine)}`, pc1(c.total.bookProb), pc1(c.total.ourProb), c.total.note) : ""}
    </tbody></table></div>
    ${c.props?.length ? `<details class="more"><summary>Player lines (${c.props.length}) ${CMP_TXT.toLowerCase()}</summary><div class="tw"><table><thead><tr><th>Player</th><th class="n">Book line</th><th class="n">Our median</th><th class="n">Our chance over</th></tr></thead><tbody>
      ${c.props.map((p) => `<tr><td>${esc(p.n)} <span class="muted">${esc(STAT_W[p.stat] || p.stat)}</span></td><td class="n">${nf(p.bookLine)}</td><td class="n">${nf(p.ourMedian)}</td><td class="n">${pc1(p.ourProbOver)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">The book publishes only the line here, so there is no book chance for player lines.</p></details>` : ""}
  </section>`;
}

// ---- High-confidence board
const FAM = { winner: "Winner", spread: "Spread", total: "Game total", teamTotal: "Team total", pts: "Points", reb: "Rebounds", ast: "Assists", tpm: "Threes" };
async function vBoard() {
  const [b, odds] = await Promise.all([load("board.json"), load("odds.json").catch(() => null)]);
  const picks = b.picks || [];
  const B = S.bd = S.bd || { g: "all", fam: "all", cmp: false, shown: 60, sort: "time" };
  const games = [...new Map(picks.map((p) => [p.game, p])).values()].sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
  const cmpCell = (p) => {
    const c = p.comparison; if (!c) return `<span class="muted">-</span>`;
    if (p.fam === "winner") return `Book ${pc1(c.bookProb)}`;
    const ln = p.fam === "spread" ? `${abbr(p.home)} ${lineTxt(c.bookLine)}` : nf(c.bookLine);
    return `Line ${ln}<i>ours there ${pct(c.ourProbAtBookLine)}${c.bookProb != null ? `, book ${pct(c.bookProb)}` : ""}</i>`;
  };
  const draw = (focusSel) => {
    const safeHidden = picks.filter((p) => tooFarBelow(p)).length;
    if (!S.bdGames) { S.bdGames = {}; Promise.all([...new Set(picks.map((p) => p.game))].map((id) => load(`upcoming/${id}.json`).then((g) => { S.bdGames[id] = g; }).catch(() => {}))).then(() => draw()); }
    const unexpB = (p) => p.player && devCheck(S.bdGames?.[p.game], p.player.id, p.fam)?.unexplained;
    const rows = picks.filter((p) => (B.g === "all" || p.game === B.g) && (B.fam === "all" || p.fam === B.fam) && (B.safe || !tooFarBelow(p)) && !unexpB(p))
      .sort(B.sort === "p" ? (x, y) => y.p - x.p : (x, y) => Date.parse(x.date) - Date.parse(y.date) || y.p - x.p);
    const famCount = (k) => picks.filter((p) => (B.g === "all" || p.game === B.g) && (k === "all" || p.fam === k)).length;
    const cal = b.calibration || {};
    app.innerHTML = `${labBack}<h1>High-confidence board</h1>
      <p class="lead">Every market where the simulation gives 85% or more for an upcoming game, with how often picks chosen by exactly this rule came true in the back-test.</p>
      <p class="small muted">Lines far below a player's main line (e.g. 5+ points when his line is 16.5) are hidden by default: they almost always hit but pay almost nothing. Use "Show very safe lines" to see them.</p>
      <div class="card caveat" role="note"><b>Past hit rate, not a guarantee.</b>
        <p class="small">Even at 90%, about 1 pick in 10 misses, and picks from the same game tend to miss together. In the back-test player picks came true 2 to 5 points less often than the simulation said (85-90% band: about 83-85%); team picks were on target. Past picks were made with the confirmed inactive list, upcoming ones earlier, so real hit rates can be a little lower. Statistical analysis only, not betting advice.</p>
        <details class="more"><summary>Back-test of this board rule (${esc(num(cal.games))} games)</summary>${calTable(cal.all || [], "Picks")}
          ${Object.entries(cal.byFamily || {}).map(([k, rs]) => `<h4>${esc(FAM[k] || k)}</h4>${calTable(rs, "Picks")}`).join("")}</details>
      </div>
      <div class="filters" role="group" aria-label="Filter by market">${["all", ...Object.keys(FAM)].filter((k) => k === "all" || famCount(k)).map((k) => `<button class="fbtn" type="button" data-fam="${k}" aria-pressed="${B.fam === k}">${k === "all" ? "All markets" : FAM[k]} <span class="cnt">${famCount(k)}</span></button>`).join("")}</div>
      <div class="bd-ctl">
        <label class="small" for="bd-g">Game</label>
        <select class="field" id="bd-g"><option value="all">All games (${games.length})</option>${games.map((g) => `<option value="${esc(g.game)}"${B.g === g.game ? " selected" : ""}>${abbr(g.away)} at ${abbr(g.home)} · ${esc(day(g.date))} ${esc(time(g.date))}</option>`).join("")}</select>
        <div class="filters" role="group" aria-label="Sort and comparison">
          <button class="fbtn" type="button" data-sort="time" aria-pressed="${B.sort === "time"}">By tip-off</button>
          <button class="fbtn" type="button" data-sort="p" aria-pressed="${B.sort === "p"}">By chance</button>
          <button class="fbtn" type="button" id="bd-cmp" aria-pressed="${B.cmp}">Book column (comparison only)</button>
          <button class="fbtn" type="button" id="bd-safe" aria-pressed="${!!B.safe}">${B.safe ? "Hide" : "Show"} very safe lines (${safeHidden})</button>
        </div>
      </div>
      ${B.cmp ? `<p class="note">${cmpChip} ${esc(String(b.comparisonLabel || "").replace(/^For comparison only.s*/i, ""))}${odds?.fetched ? ` Lines fetched ${esc(stamp(odds.fetched))}.` : ""} "Ours there" is the simulation's chance for the same side at the book's line.</p>` : ""}
      <div class="card"><div class="tw"><table class="bd"><thead><tr><th>Pick</th><th class="n">Sim</th><th class="n">Past hit<i>same band</i></th>${B.cmp ? `<th class="n">Book<i>comparison only</i></th>` : ""}</tr></thead><tbody>
        ${rows.slice(0, B.shown).map((p) => `<tr><td><b>${esc(p.label)}</b><div class="small muted">${p.player ? `${abbr(p.player.t)}, ${f0(p.player.projMin)} min projected · ` : ""}<a href="#/sim/${esc(p.game)}">${abbr(p.away)} at ${abbr(p.home)}</a> · ${esc(day(p.date))} ${esc(timePH(p.date))}</div></td>
          <td class="n"><b>${pc1(p.p)}</b></td>
          <td class="n">${hp(p.hit?.rate)}<i>${esc(p.hit?.band || "")} · ${num(p.hit?.n)}${p.hit?.scope && p.hit.scope !== "this market type" ? " (all types)" : ""}</i>${sampleTag(p.hit?.n, 30)}</td>
          ${B.cmp ? `<td class="n">${cmpCell(p)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="4" class="empty">No pick in this filter.</td></tr>`}
      </tbody></table></div>
      ${rows.length > B.shown ? `<button class="btn block" type="button" id="bd-more">Show ${Math.min(100, rows.length - B.shown)} more of ${rows.length - B.shown}</button>` : ""}
      <p class="small muted" style="margin-top:10px">${rows.length} picks. ${esc(b.rules?.players || "")}. "(all types)" = fewer than 30 back-test picks of this market type, so the rate of all types in that band is shown. Some lines are low on purpose (the strictest line still at 85%, such as 2+ rebounds for a starter).</p></div>
      <p class="small muted">Generated ${esc(stamp(b.generated))}. ${esc(b.note || "")}</p>`;
    app.querySelectorAll("[data-fam]").forEach((x) => x.addEventListener("click", () => { B.fam = x.dataset.fam; B.shown = 60; draw(`[data-fam="${CSS.escape(B.fam)}"]`); }));
    app.querySelectorAll("[data-sort]").forEach((x) => x.addEventListener("click", () => { B.sort = x.dataset.sort; draw(`[data-sort="${CSS.escape(B.sort)}"]`); }));
    document.getElementById("bd-cmp").addEventListener("click", () => { B.cmp = !B.cmp; draw("#bd-cmp"); });
    document.getElementById("bd-safe")?.addEventListener("click", () => { B.safe = !B.safe; draw("#bd-safe"); });
    document.getElementById("bd-g").addEventListener("change", (e) => { B.g = e.target.value; B.shown = 60; draw("#bd-g"); });
    document.getElementById("bd-more")?.addEventListener("click", () => { B.shown += 100; draw("#bd-more"); });
    if (focusSel) app.querySelector(focusSel)?.focus({ preventScroll: true });
  };
  draw();
}

// ---- Season simulation
async function vSeason() {
  const s = await load("season.json");
  const byId = Object.fromEntries((s.teams || []).map((t) => [t.id, t]));
  S.seaConf = S.seaConf || "West"; S.seaCols = S.seaCols || "std";
  const seedBars = (d) => { const mx = Math.max(...d, 0.001), best = d.indexOf(Math.max(...d)); return `<span class="sdist" role="img" aria-label="Most likely seed ${best + 1} (${pct(d[best])})">${d.map((v, i) => `<i class="${i < 6 ? "s-po" : i < 10 ? "s-pi" : "s-out"}" style="height:${Math.max(v > 0 ? 8 : 0, (v / mx) * 100).toFixed(0)}%"></i>`).join("")}</span>`; };
  const draw = (focusSel) => {
    const ids = s.conferences?.[S.seaConf] || [];
    const std = S.seaCols === "std";
    app.innerHTML = `${labBack}<h1>Season simulation</h1>
      <p class="lead">The rest of the ${esc(s.season)} season played ${num(s.sims)} times from current team strength. Teams are ordered by average seed. Statistical only; no betting data.</p>
      <div class="filters" role="group" aria-label="Conference">${["West", "East"].map((k) => `<button class="fbtn" type="button" data-conf="${k}" aria-pressed="${S.seaConf === k}">${k}</button>`).join("")}<span class="fsep" aria-hidden="true"></span>${[["std", "Standings and seeds"], ["po", "Playoff rounds"]].map(([k, l]) => `<button class="fbtn" type="button" data-cols="${k}" aria-pressed="${S.seaCols === k}">${l}</button>`).join("")}</div>
      <div class="card"><div class="tw"><table class="sea"><thead><tr><th>Team</th><th class="n">Now</th>${std ? `<th class="n">Proj. wins<i>8 in 10</i></th><th class="n">Seed<i>average</i></th><th>Seed spread<i>1 to 15</i></th><th class="n">Top 6</th><th class="n">Play-in</th><th class="n">Playoffs</th>` : `<th class="n">Playoffs</th><th class="n">2nd round</th><th class="n">Conf. finals</th><th class="n">Finals</th><th class="n">Title</th>`}</tr></thead><tbody>
        ${ids.map((id, i) => { const t = byId[id]; if (!t) return ""; return `<tr class="mid"><td><a href="#/team/${esc(id)}" class="sea-t"><span class="sea-r">${i + 1}</span>${teamLogo(id, { size: "xs" })}<b>${esc(t.abbr)}</b>${favMark("t", id)}</a></td><td class="n">${esc(t.w)}-${esc(t.l)}</td>
          ${std ? `<td class="n"><b>${f1(t.wins?.mean)}</b><i>${esc(t.wins?.p10)}-${esc(t.wins?.p90)}</i></td><td class="n">${f1(t.seed?.avg)}</td><td>${seedBars(t.seed?.dist || [])}</td><td class="n">${pct(t.pTop6)}</td><td class="n">${pct(t.pPlayIn)}</td><td class="n"><b>${pct(t.pPlayoffs)}</b></td>`
            : `<td class="n"><b>${pct(t.pPlayoffs)}</b></td><td class="n">${pct(t.pSecondRound)}</td><td class="n">${pct(t.pConfFinals)}</td><td class="n">${pct(t.pFinals)}</td><td class="n">${pc1(t.pTitle)}</td>`}</tr>`; }).join("")}
      </tbody></table></div>
      ${std ? `<div class="legend"><span><i class="s-po"></i>Seeds 1-6 (straight in)</span><span><i class="s-pi"></i>7-10 (play-in)</span><span><i class="s-out"></i>11-15</span></div>` : ""}
      <p class="small muted">"Playoffs" includes getting in through the play-in. Chances under 0.5% show as 0%.</p></div>
      <section class="card"><h2>How the season is simulated</h2><dl class="kv stack small">
        ${Object.entries(s.method || {}).map(([k, v]) => `<dt>${esc({ ratings: "Ratings", games: "Each game", uncertainty: "Uncertainty", tiebreak: "Ties", playoffs: "Play-in and playoffs" }[k] || k)}</dt><dd>${esc(v)}</dd>`).join("")}
        <dt>Schedule</dt><dd>${esc(num(s.schedule?.played))} games played, ${esc(num(s.schedule?.scheduledWithDates))} scheduled with dates, ${esc(num(s.schedule?.filledWithoutDates))} filled without dates. ${esc(s.schedule?.note || "")}</dd>
      </dl><p class="small muted">Generated ${esc(stamp(s.generated))}. ${esc(s.note || "")}</p></section>`;
    app.querySelectorAll("[data-conf]").forEach((x) => x.addEventListener("click", () => { S.seaConf = x.dataset.conf; draw(`[data-conf="${S.seaConf}"]`); }));
    app.querySelectorAll("[data-cols]").forEach((x) => x.addEventListener("click", () => { S.seaCols = x.dataset.cols; draw(`[data-cols="${S.seaCols}"]`); }));
    if (focusSel) app.querySelector(focusSel)?.focus({ preventScroll: true });
  };
  draw();
}

// ---- Insights: similar past games, disagreement, trust
const insightNote = (I) => `<p class="small muted">${esc(I.note || "")} Updated ${esc(stamp(I.updated))}.</p>`;
async function vInsights(id) {
  const I = await load("insights.json");
  if (id) return insightGame(I, id);
  const groups = new Map();
  for (const g of I.games || []) { const k = dayKey(g.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  const D = I.disagreement || {}, TR = I.trust || {};
  app.innerHTML = `${labBack}<h1>Insights</h1>
    <p class="lead">For each upcoming game: the most similar past games and how they ended, and where the five rating systems disagree. Context only; nothing here changes a projection.</p>
    <div class="lab-jump"><a class="btn" href="#/breakout">Breakout watch</a><a class="btn" href="#/today">What changed</a><a class="btn" href="#/compare">Compare</a></div>
    ${[...groups.values()].map((list) => `<h2 class="day"><span>${esc(dayLong(list[0].date))}</span><span class="cnt">${list.length} ${list.length === 1 ? "game" : "games"} · ${PHT}</span></h2>
      ${list.map((g) => `<a class="card ins-c" href="#/insights/${esc(g.id)}"><div class="g-top"><span class="when">${esc(timePH(g.date))}</span>${g.splitWinner ? `<span class="chip warn">Systems split on the winner</span>` : `<span>Projected ${mgTxt(g.margin, g.home, g.away)}</span>`}</div>
        <div class="ins-m">${teamLogo(g.away, { size: "sm" })}<b>${abbr(g.away)}</b><span class="muted">at</span>${teamLogo(g.home, { size: "sm" })}<b>${abbr(g.home)}</b></div>
        <div class="g-lines"><span><i>Systems spread</i> ${f1(g.spread)} pts</span>${g.similarFavWon ? `<span><i>Similar games</i> favourite won ${esc(g.similarFavWon[0])} of ${esc(g.similarFavWon[1])}</span>` : ""}${g.breakout?.length ? `<span><i>Breakout watch</i> ${g.breakout.length}</span>` : ""}</div></a>`).join("")}`).join("") || `<p class="empty">No upcoming games in the analysis yet.</p>`}
    ${D.history?.bands?.length ? `<section class="card"><h2>Does disagreement matter?</h2><p class="small muted">The published projection's record in finished games, by how much the five systems agreed beforehand.</p>
      <div class="tw"><table><thead><tr><th>Systems</th><th class="n">Games</th><th class="n">Winner right</th><th class="n">Margin miss</th></tr></thead><tbody>${D.history.bands.map((b) => `<tr><td>${esc(b.label)}</td><td class="n">${num(b.games)}</td><td class="n">${pct(b.winnerAcc)}</td><td class="n">${f1(b.marginMAE)}</td></tr>`).join("")}</tbody></table></div>
      <details class="more"><summary>Each system's record when it stood out</summary><div class="tw"><table><thead><tr><th>System</th><th class="n">Margin miss</th><th class="n">Outlier games</th><th class="n">Result on its side</th></tr></thead><tbody>${(D.history.systems || []).map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${f1(x.marginMAE)}</td><td class="n">${num(x.outlierGames)}</td><td class="n">${pct(x.sideRightPct)}${sampleTag(x.outlierGames, 30)}</td></tr>`).join("")}</tbody></table></div><p class="small muted">${esc(D.history.rule || "")}</p></details></section>` : ""}
    ${trustSummary(TR)}
    ${insightNote(I)}`;
}
function trustSummary(TR) {
  if (!TR?.players) return "";
  const li = (r) => `<li class="spread"><span>${playerChip(r.id, r.n, { href: `#/player/${r.id}` })} <span class="muted">${abbr(r.team)}</span></span><span class="num">miss ${f1(r.mae)} vs ${f1(r.typical)} typical <span class="muted">(${esc(r.games)} g)</span></span></li>`;
  return `<section class="card"><h2>Trust meter: whom the model reads well</h2>
    <p class="small muted">${esc(TR.note || "")}</p>
    <div class="chips">${Object.entries(TR.players.counts || {}).map(([k, v]) => `<span class="chip">${esc(k)}: ${num(v)} players</span>`).join("")}</div>
    ${TR.persistence?.t ? `<p class="note">${esc(TR.persistence.t)}</p>` : ""}
    <div class="grid two"><div><h3>Our projections off lately</h3><ul class="plain small">${(TR.players.keepsMissing || []).slice(0, 8).map(li).join("")}</ul></div><div><h3>Model reads well</h3><ul class="plain small">${(TR.players.readsWell || []).slice(0, 8).map(li).join("")}</ul></div></div>
    <p class="small muted">The labels describe the model's recent record on each player, not the player.</p></section>`;
}
async function insightGame(I, id) {
  const sim = await load(`sim/${id}.json`).catch(() => null);
  const gi = (I.games || []).find((g) => g.id === id);
  const sm = I.similar?.games?.[id], dg = I.disagreement?.games?.[id];
  if (!gi && !sm && !dg) throw new Error("this game is not in the analysis views");
  const H = gi?.home || sim?.home, A = gi?.away || sim?.away;
  const st = I.similar?.selfTest;
  const brk = ["opportunity", "matchup", "hotStreaks"].flatMap((k) => (I.breakout?.[k] || []).filter((r) => r.gid === id));
  const tn = I.trust?.tonight?.[id];
  // margin bars: home minus road, home to the right
  const sys = dg ? [...dg.systems.map((x) => ({ l: x.label, m: x.margin, w: x.weight, part: x.part, ts: x.thisSeason, rec: x.outlierRecord })), ...(sim ? [{ l: "Simulation (not in the blend)", m: sim.forecast?.margin?.mean ?? sim.margin, sim: true }] : [])] : [];
  const scale = Math.max(4, ...sys.map((x) => Math.abs(x.m || 0)), Math.abs(dg?.blend?.margin || 0));
  const bar = (l, v, extra = "") => { const w = Math.min(50, (Math.abs(v) / scale) * 50); return `<div class="bar dbar"><span>${esc(l)}</span><span class="track"><span class="fill ${v >= 0 ? "pos" : "neg"}" style="width:${w.toFixed(1)}%"></span></span><span class="val">${mgTxt(v, H, A)}${extra}</span></div>`; };
  app.innerHTML = `<a class="back" href="#/insights">‹ Insights</a>
    <h1>${abbr(A)} at ${abbr(H)}: similar games and disagreement</h1>
    <p class="muted small">${gi ? `${esc(dayLong(gi.date))} · ${esc(timePH(gi.date))}` : ""}</p>
    <p class="row wrap" style="gap:0 18px"><a class="go" href="#/game/${esc(id)}">Game page ›</a><a class="go" href="#/sim/${esc(id)}">Simulation ›</a></p>

    ${dg ? `<section class="card" aria-labelledby="dg-h"><h2 id="dg-h">Where the systems disagree</h2>
      <p>${esc(dg.t)}</p>
      <div class="legend"><span><i style="background:var(--pos)"></i>${abbr(H)} (home) ahead</span><span><i style="background:var(--neg)"></i>${abbr(A)} ahead</span></div>
      <div class="bars">${sys.map((x) => bar(x.l, x.m)).join("")}${bar("Published projection", dg.blend.margin)}</div>
      ${dg.biggest?.reason?.t ? `<p class="note"><b>Why the biggest gap:</b> ${esc(dg.biggest.reason.t)}</p>` : ""}
      <details class="more"><summary>Weights and records</summary><div class="tw"><table class="lab-t"><thead><tr><th>System</th><th class="n">Margin</th><th class="n">Weight</th><th class="n">Part</th><th class="n">This season<i>winner / miss</i></th></tr></thead><tbody>
        ${dg.systems.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${sg(x.margin)}</td><td class="n">${f1(x.weight * 100)}%</td><td class="n">${sg(x.part)}</td><td class="n">${pct(x.thisSeason?.winnerAcc)} / ${f1(x.thisSeason?.marginMAE)}</td></tr>`).join("")}
        <tr><td>Home court, referees, situations</td><td class="n"></td><td class="n"></td><td class="n">${sg(dg.blend.otherAdj)}</td><td></td></tr>
        <tr><td><b>Published</b></td><td class="n"><b>${sg(dg.blend.margin)}</b></td><td></td><td class="n">${sg(dg.blend.partsSum + dg.blend.otherAdj)}</td><td class="n">${abbr(H)} ${pct(dg.blend.pHome)}</td></tr>
        ${sim ? `<tr><td>Simulation</td><td class="n">${sg(sim.forecast?.margin?.mean ?? sim.margin)}</td><td class="n">-</td><td class="n">-</td><td class="n">${abbr(H)} ${pct(sim.forecast?.pHome ?? sim.pHome)}</td></tr>` : ""}
      </tbody></table></div>
      <p class="small muted">Margins are home minus road. The published margin is not an average: the back-test stacks the five systems with weights that add up to about ${f1(dg.systems.reduce((a, x) => a + x.weight, 0))}, because each alone is too cautious. The simulation starts from the published projection, so it mostly agrees with it; it adds spread, not a separate opinion.</p></details>
    </section>` : ""}

    ${sm ? `<section class="card" aria-labelledby="sm-h"><h2 id="sm-h">Most similar past games</h2>
      <p>${esc(sm.summary?.t)}${sampleTag(sm.summary?.n)}</p>
      ${st?.verdict ? `<p class="note">${esc(st.verdict)} (checked on ${esc(num(st.games))} past games: correlation ${esc(nf(st.corrResidual))}; margin miss ${esc(nf(st.marginMAE?.projection))} as is vs ${esc(nf(st.marginMAE?.plusNeighbourGap))} with the correction.)</p>` : ""}
      <p class="small muted">Tonight: projected ${mgTxt(sm.tonight?.margin, H, A)}, total ${nf(sm.tonight?.total)}, pace ${nf(sm.tonight?.pace)}${(sm.tonight?.missingStars || []).flat().length ? `, missing ${esc((sm.tonight.missingStars || []).flat().join(", "))}` : ""}.</p>
      <ul class="plain">${(sm.games || []).map((p) => `<li class="simg">
        <div class="spread"><a class="simg-a" href="#/result/${esc(p.id)}"><b>${abbr(p.away)} ${esc(p.act?.as)} at ${abbr(p.home)} ${esc(p.act?.hs)}</b>${p.act?.ot ? " (OT)" : ""}</a><span class="chip ${p.called ? "good" : "bad"}">${p.called ? "Winner called" : "Winner missed"}</span></div>
        <div class="small muted">${esc(p.day)} (${PHT}) · ${esc(p.phase)} · projected ${f1(p.proj?.as)}-${f1(p.proj?.hs)} · margin miss ${f1(p.marginErr)} · similarity ${esc(p.sim)}/100</div>
        ${p.why?.length ? `<ul class="dots small">${p.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>
      <p class="small muted">Matched on projected margin and total, pace, rest, missing players, style, playoffs or not and the same teams. A past game is described only by what was known before its tip-off.</p>
    </section>` : ""}

    ${brk.length ? `<section class="card"><h2>Breakout watch in this game</h2>${brk.map(breakoutRow).join("")}<p class="small"><a class="go" href="#/breakout">All breakout candidates ›</a></p></section>` : ""}
    ${tn && (tn.teams?.length || tn.players?.length) ? `<section class="card"><h2>Trust meter tonight</h2><ul class="plain small">
      ${(tn.teams || []).filter((t) => t && t.tid).map((t) => `<li class="spread"><span>${teamName(t.tid)}</span><span>${esc(trustWord(t.label))} · miss ${f1(t.mae)} pts${t.games ? ` <span class="muted">(${esc(t.games)} g)</span>` : ""}</span></li>`).join("")}
      ${(tn.players || []).map((p) => `<li class="spread"><span>${playerChip(p.id, p.n, { href: `#/player/${p.id}` })}</span><span>${esc(p.label === "keeps missing" ? "model keeps missing" : p.label === "reads well" ? "model reads well" : p.label)} <span class="muted">(${esc(p.games)} g)</span></span></li>`).join("")}</ul>
      ${I.trust?.persistence?.t ? `<p class="small muted">${esc(I.trust.persistence.t)}</p>` : ""}</section>` : ""}
    ${insightNote(I)}`;
}

// ---- Breakout watch
function breakoutRow(r) {
  const bt = r.backtest;
  return `<div class="brk">
    <div class="brk-h">${avatar(r.id, r.n, { size: "md", team: r.team })}<div><b><a href="#/player/${esc(r.id)}">${esc(r.n)}</a></b>${favMark("p", r.id)}<div class="small muted">${abbr(r.team)} vs ${abbr(r.opp)} · ${esc(day(r.date))} ${esc(timePH(r.date))}</div></div></div>
    <div class="chips"><span class="chip info">${f1(r.proj?.min)} min projected</span><span class="chip">last ${esc(r.recent?.games)}: ${f1(r.recent?.min)} min, ${f1(r.recent?.pts)} pts</span><span class="chip">${f1(r.proj?.pts)} pts projected (${sg(r.ptsJump)})</span></div>
    <ul class="dots small">${(r.reasons || []).map((x) => `<li>${esc(x.t)}${x.n != null ? smallTag(x.small ?? x.n < 10) : ""}</li>`).join("")}</ul>
    ${bt ? `<p class="small muted">Back-test: projected jumps of ${esc(bt.bucket)} minutes came with 3+ extra minutes ${pct(bt.hitRate)} of the time (${num(bt.games)} player-games).</p>` : ""}
  </div>`;
}
async function vBreakout() {
  const I = await load("insights.json"), B = I.breakout || {};
  S.brk = S.brk || "opportunity";
  const tabs = [["opportunity", "More minutes or role"], ["matchup", "Matchup"], ["hotStreaks", "Hot streaks"]];
  // Keep only real breakouts: more points projected AND either a named cause (absence, return, starting role...) or a
  // minutes jump of 6+ (the group that came true about two thirds of the time; 4-6 minute jumps were near coin flips).
  const named = (r) => (r.reasons || []).some((x) => x.k && x.k !== "rotation");
  const keep = (r) => (r.ptsJump ?? 1) > 0 && (named(r) || (r.minJump ?? 0) >= 6 || S.brk !== "opportunity");
  const draw = (focusSel) => {
    const all = B[S.brk] || [], list = all.filter(keep), ev = B.evidence || {}, dropped = all.length - list.length;
    app.innerHTML = `${labBack}<h1>Breakout watch</h1>
      <p class="lead">Players whose minutes or role should jump in their next game: a teammate out, a new starter, minutes returning, or a matchup that suits them. Each player appears once.</p>
      <div class="filters" role="group" aria-label="Kind">${tabs.map(([k, l]) => `<button class="fbtn" type="button" data-bk="${k}" aria-pressed="${S.brk === k}">${l} <span class="cnt">${(B[k] || []).filter(keep).length}</span></button>`).join("")}</div>
      ${S.brk === "hotStreaks" && ev.hotStreak?.t ? `<p class="note"><b>Hot streaks usually fade.</b> ${esc(ev.hotStreak.t)}</p>` : ""}
      <div class="card">${list.map(breakoutRow).join("") || `<p class="empty">Nobody in this list right now.</p>`}${dropped ? `<p class="small muted">${dropped} more left out: a minutes jump under 6 with no named cause (those came true only about half the time), or no gain in projected points.</p>` : ""}</div>
      ${ev.minutes?.buckets?.length ? `<section class="card"><h2>How often projected minute jumps really happen</h2>
        <div class="tw"><table><thead><tr><th>Projection vs his last 5 games</th><th class="n">Player-games</th><th class="n">Really played 3+ more</th></tr></thead><tbody>${ev.minutes.buckets.map((b) => `<tr><td>${esc(b.label)}</td><td class="n">${num(b.games)}</td><td class="n">${pct(b.hitRate)}</td></tr>`).join("")}</tbody></table></div>
        <p class="small muted">${esc(ev.minutes.rule || "")}</p></section>` : ""}
      ${insightNote(I)}`;
    app.querySelectorAll("[data-bk]").forEach((x) => x.addEventListener("click", () => { S.brk = x.dataset.bk; draw(`[data-bk="${S.brk}"]`); }));
    if (focusSel) app.querySelector(focusSel)?.focus({ preventScroll: true });
  };
  draw();
}

// ---- What changed
async function vToday() {
  const I = await load("insights.json"), C = I.changes || {};
  const diff = (d, title) => {
    if (!d) return "";
    const pl = (r) => `${playerChip(r.id, r.n, { href: `#/player/${r.id}` })} <span class="muted">${abbr(r.team)}</span>`;
    return `<section class="card"><h2>${esc(title)}</h2>
      <p class="small muted">${esc(d.from?.manila || "")} to ${esc(d.to?.manila || "")} ${PHT}</p>
      <ul class="dots">${(d.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      ${d.injuries?.length ? `<h3>Newly listed out</h3><ul class="plain small">${d.injuries.map((r) => `<li>${pl(r)}${r.detail ? `<div class="muted">${esc(r.detail)}</div>` : ""}</li>`).join("")}</ul>` : ""}
      ${d.returns?.length ? `<h3>Back on the projection</h3><ul class="plain small">${d.returns.map((r) => `<li>${pl(r)}</li>`).join("")}</ul>` : ""}
      ${d.roles?.length ? `<h3>Role changes</h3><ul class="plain small">${d.roles.map((r) => `<li class="spread"><span>${pl(r)}</span><span class="num">${f1(r.min?.[0])} → ${f1(r.min?.[1])} min</span></li>`).join("")}</ul>` : ""}
      ${d.gameMoves?.length ? `<h3>Biggest game moves</h3><ul class="plain small">${d.gameMoves.map((m) => `<li class="spread"><a href="#/game/${esc(m.gid)}">${abbr(m.away)} at ${abbr(m.home)}</a><span class="num">margin ${sg(m.margin?.[0])} → ${sg(m.margin?.[1])} · ${abbr(m.home)} ${pct(m.pHome?.[0])} → ${pct(m.pHome?.[1])}</span></li>`).join("")}</ul>` : ""}
      ${d.playerMoves?.length ? `<h3>Player points moves</h3><ul class="plain small">${d.playerMoves.map((r) => `<li class="spread"><span>${pl(r)}</span><span class="num">${f1(r.pts?.[0])} → ${f1(r.pts?.[1])} pts</span></li>`).join("")}</ul>` : ""}
      ${d.added?.length || d.removed?.length ? `<p class="small muted">${d.added?.length ? `${d.added.length} game${d.added.length === 1 ? "" : "s"} added. ` : ""}${d.removed?.length ? `${d.removed.length} game${d.removed.length === 1 ? "" : "s"} removed (played or postponed).` : ""}</p>` : ""}
    </section>`;
  };
  app.innerHTML = `${labBack}<h1>What changed</h1>
    <p class="lead">New injuries, role changes and the biggest projection moves between saved refreshes. Margins are home minus road.</p>
    ${C.latest ? `<p class="small muted">Latest run: ${esc(C.latest.manila)} ${PHT}, ${esc(C.latest.games)} games. ${esc(num(C.snapshots))} runs saved.</p>` : ""}
    ${C.message ? `<div class="card"><p>${esc(C.message)}</p></div>` : ""}
    ${diff(C.sinceLast, "Since the last refresh")}
    ${C.sinceYesterday ? diff(C.sinceYesterday, "Since yesterday") : `<div class="card"><h2>Since yesterday</h2><p class="small muted">${esc(C.sinceYesterdayNote || "No run from an earlier day is saved yet.")}</p></div>`}
    <p class="small muted">${esc(C.note || "")}</p>`;
}

// ---- Compare two players or two teams
const CP_PL = [["gp", "Games", "num"], ["min", "Minutes", 1], ["pts", "Points", 1], ["reb", "Rebounds", 1], ["ast", "Assists", 1], ["tpm", "Threes made", 1], ["stl", "Steals", 1], ["blk", "Blocks", 1], ["to", "Turnovers", 1, "low"], ["ts", "True shooting %", 1], ["usg", "Usage %", 1], ["net", "Net rating (NBA.com)", 1], ["onOffSwing", "On/off swing", "sg"], ["last5Pts", "Points, last 5", 1], ["last5Min", "Minutes, last 5", 1], ["prevPts", "Points, last season", 1], ["prevReb", "Rebounds, last season", 1], ["prevAst", "Assists, last season", 1], ["rimShare", "Shots at the rim %", 1], ["threeShare", "Shots from three %", 1], ["trust", "Trust meter", "txt"], ["k2", "2K rating (unofficial)", "num"]];
const CP_TM = [["w", "Wins", "num"], ["l", "Losses", "num", "low"], ["last10W", "Wins, last 10", "num"], ["elo", "Elo", "num"], ["adjNet", "Adj. net rating", "sg"], ["adjOff", "Adj. offence", "sg"], ["adjDef", "Adj. defence (lower is better)", "sg"], ["pace", "Pace", 1], ["off", "Offensive rating", 1], ["def", "Defensive rating", 1], ["net", "Net rating", "sg"], ["tpar", "Three-point rate %", 1], ["efg", "Effective FG %", 1], ["oppEfg", "Opponent eFG %", 1], ["ftr", "Free-throw rate", 1], ["tov", "Turnover %", 1], ["orb", "Offensive rebound %", 1], ["oppTov", "Forced turnover %", 1], ["benchPts", "Bench points", 1], ["q1", "Q1 margin", "sg"], ["q4", "Q4 margin", "sg"], ["trust", "Trust meter", "txt"]];
async function vCompare(kindArg, _a2, rest = []) {
  const [cp, ct] = await Promise.all([load("compare/players.json"), load("compare/teams.json")]);
  const rowsOf = (c) => c.rows.map((r, i) => ({ ...Object.fromEntries(c.cols.map((k, j) => [k, r[j]])), _i: i }));
  const PL = rowsOf(cp), TM = rowsOf(ct);
  const C = S.cmp = S.cmp || { kind: "p", p: [], t: [] };
  if (kindArg === "p" || kindArg === "t") { C.kind = kindArg; if (rest[1] && rest[2]) C[kindArg] = [rest[1], rest[2]]; }
  const fp = favs().p.filter((id) => PL.some((r) => r.id === id)), ft = favs().t.filter((id) => TM.some((r) => r.id === id));
  if (C.p.length < 2) { const top = PL.filter((r) => r.q).sort((a, b) => (b.pts || 0) - (a.pts || 0)); C.p = [...new Set([...fp, ...top.map((r) => r.id)])].slice(0, 2); }
  if (C.t.length < 2) C.t = [...new Set([...ft, ...TM.map((r) => r.id)])].slice(0, 2);
  const fmt = (v, f) => (v == null ? "-" : f === "txt" ? esc(v) : f === "sg" ? sg(v) : f === "num" ? esc(num(v)) : f1(v));
  const pctTxt = (v) => (v == null ? "" : `<i>${ord(Math.round(v))} pct</i>`);
  const draw = (focusSel) => {
    const isP = C.kind === "p", src = isP ? PL : TM, spec = isP ? CP_PL : CP_TM, ids = C[C.kind];
    const [a, b] = ids.map((id) => src.find((r) => r.id === id));
    const nameOf = (r) => (isP ? `${r.n} (${T(r.team).abbr})` : r.name);
    const opts = src.slice().sort((x, y) => nameOf(x).localeCompare(nameOf(y))).map((r) => `<option value="${esc(nameOf(r))}"></option>`).join("");
    const head = (r, i) => !r ? `<div class="cmp-h"><span class="muted">Choose ${isP ? "a player" : "a team"}</span></div>` : isP
      ? `<a class="cmp-h" href="#/player/${esc(r.id)}">${avatar(r.id, r.n, { size: "lg", team: r.team })}<b>${esc(r.n)}</b><span class="small muted">${abbr(r.team)}${r.pos ? " · " + esc(r.pos) : ""}${r.arch ? " · " + esc(r.arch) : ""}</span></a>`
      : `<a class="cmp-h" href="#/team/${esc(r.id)}">${teamLogo(r.id, { size: "lg" })}<b>${esc(r.name)}</b><span class="small muted">${esc(r.w)}-${esc(r.l)}</span></a>`;
    const pc = (r, k) => (isP ? cp.pct?.[k]?.[r._i] : null);
    const rk = (r, k) => (!isP ? ct.ranks?.[k]?.[r._i] : null);
    const better = (k, va, vb, low) => (va == null || vb == null || va === vb || typeof va !== "number" ? 0 : (low ? va < vb : va > vb) ? 1 : -1);
    const body = a && b ? spec.map(([k, l, f, low]) => {
      const va = a[k], vb = b[k]; if (va == null && vb == null) return "";
      const w = f === "txt" || (k === "adjDef" || k === "def" || k === "oppEfg" || k === "tov") ? 0 : better(k, va, vb, low);
      const extra = (r) => (isP ? pctTxt(pc(r, k)) : rk(r, k) ? `<i>${ord(rk(r, k))} of 30</i>` : "");
      return `<tr><td class="n ${w === 1 ? "cmp-w" : ""}">${fmt(va, f)}${extra(a)}</td><th scope="row">${esc(l)}</th><td class="n ${w === -1 ? "cmp-w" : ""}">${fmt(vb, f)}${extra(b)}</td></tr>`;
    }).join("") : "";
    app.innerHTML = `${labBack}<h1>Compare</h1>
      <div class="filters" role="group" aria-label="What to compare">${[["p", "Two players"], ["t", "Two teams"]].map(([k, l]) => `<button class="fbtn" type="button" data-ck="${k}" aria-pressed="${C.kind === k}">${l}</button>`).join("")}</div>
      <div class="cmp-pick">${[0, 1].map((i) => `<div><label class="small" for="cp-${i}">${isP ? "Player" : "Team"} ${i + 1}</label><input class="field" id="cp-${i}" list="cp-list" autocomplete="off" placeholder="Type a name" value="${esc(ids[i] && src.find((r) => r.id === ids[i]) ? nameOf(src.find((r) => r.id === ids[i])) : "")}"></div>`).join("")}<datalist id="cp-list">${opts}</datalist></div>
      <div class="card"><div class="cmp-top">${head(a, 0)}<span class="muted cmp-vs">vs</span>${head(b, 1)}</div>
        ${body ? `<div class="tw"><table class="cmp-t"><tbody>${body}</tbody></table></div>` : `<p class="small muted">Choose two to compare.</p>`}
        <p class="small muted" style="margin-top:8px">${isP ? `This regular season unless marked. "pct" = percentile among players with 5+ games and 10+ minutes a game this season (turnovers reversed: a high percentile means fewer). The 2K rating is unofficial. The bold side is higher (lower for turnovers); numbers describe production, not the person.` : `Ranks 1-30 (1 = best; pace and three-point rate: 1 = highest). Records exclude the NBA Cup final. Bold marks the higher value where higher is better.`}</p></div>
      <p class="small muted">${esc((isP ? cp : ct).note || "")}</p>`;
    app.querySelectorAll("[data-ck]").forEach((x) => x.addEventListener("click", () => { C.kind = x.dataset.ck; draw(`[data-ck="${C.kind}"]`); }));
    [0, 1].forEach((i) => document.getElementById(`cp-${i}`).addEventListener("change", (e) => {
      const v = e.target.value.trim().toLowerCase();
      const hit = src.find((r) => nameOf(r).toLowerCase() === v) || src.find((r) => (isP ? r.n : r.name).toLowerCase() === v) || src.find((r) => nameOf(r).toLowerCase().includes(v));
      if (hit) { C[C.kind][i] = hit.id; draw(`#cp-${i}`); } else showToast("No match: pick a name from the list");
    }));
    if (focusSel) app.querySelector(focusSel)?.focus({ preventScroll: true });
  };
  draw();
}

// ---------------------------------------------------------------- boot
async function boot() {
  // Dark for everyone by default; only an explicit saved choice of "light" changes that (index.html applies it before first paint).
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch { /* storage blocked */ }
  setTheme(saved === "light" ? "light" : "dark");
  document.getElementById("theme").addEventListener("click", () => setTheme(isDark() ? "light" : "dark", true));
  document.getElementById("skip")?.addEventListener("click", () => app.focus());
  try {
    S.meta = await fetch(`data/meta.json?t=${Date.now()}`).then((r) => r.json());
    S.ver = S.meta.updated;
    // players.json is the name/id index behind the faces. It is optional: without it the pages still work, with initials where an id is unknown.
    const [teams, plist] = await Promise.all([load("teams.json"), load("players.json").catch(() => [])]);
    S.teams = teams;
    S.T = Object.fromEntries(S.teams.map((t) => [t.id, t]));
    S.P = Object.fromEntries(plist.map((p) => [p.id, p]));
    S.PN = new Map(plist.map((p) => [String(p.n).toLowerCase(), p.id]));
    document.getElementById("updated").textContent = `Data refreshed ${stamp(S.meta.updated)} (${ago(S.meta.updated)}) · ${Number(S.meta.predicted || 0).toLocaleString()} games graded · ${S.meta.players} players tracked`;
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Data is not available yet</h2><p class="muted">Run the data refresh, then reload. (${esc(e.message)})</p></div>`;
    return;
  }
  wireScouting();
  wireFavs();
  wireSearch();
  addEventListener("hashchange", route);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (location.hash.startsWith("#/why") && S.redraw) S.redraw(); }, 200); });
  addEventListener("scroll", hideTip, { passive: true });
  route();
}
boot();

// "Who's playing tonight?" toggles on the game page (delegated, so it survives re-renders).
app.addEventListener("click", (e) => { if (e.target.closest?.("[data-open-si]")) S.gTab = "si"; }, true);
app.addEventListener("click", (e) => { const b = e.target.closest?.("[data-gt-go]"); if (!b) return; app.querySelector(`.gtabs [data-gt="${b.dataset.gtGo}"]`)?.click(); });
try { S.pkBlend = localStorage.getItem("pkBlend") === "1"; } catch { S.pkBlend = false; }
app.addEventListener("change", (e) => { if (!e.target.matches?.("[data-blend-live]")) return; S.pkBlend = e.target.checked; try { localStorage.setItem("pkBlend", S.pkBlend ? "1" : ""); } catch { /* */ } });
app.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-out], [data-out-reset]");
  if (!b) return;
  const gid = (location.hash.match(/game[\/-](\d+)/) || [])[1] || S.curGame?.id;
  if (!gid) return;
  const outs = outsFor(gid);
  if (b.dataset.outReset) outs.clear();
  else if (outs.has(b.dataset.out)) outs.delete(b.dataset.out);
  else outs.add(b.dataset.out);
  setOuts(gid, outs);
  const y = window.scrollY;
  S.keepScroll = y;
  route().then(() => { window.scrollTo(0, y); const w = document.getElementById("g-who"); if (w && b.dataset.outReset) w.scrollIntoView({ block: "start" }); });
});


// ================================================================ Picks: 85%+ props, near-certain, alternatives, why, parlays
// Built from the simulation (10,000 games per matchup), the model's player projections, scenario results,
// matchup splits, zones and coach habits. Probabilities are the simulation's; "came true" rates are how
// often picks in the same band came true in the walk-forward back-test.
const PICK_FAM = { pts: "Points", reb: "Rebounds", ast: "Assists", tpm: "Threes made", winner: "Winner", spread: "Spread", teamTotal: "Team total", total: "Game total" };
function calP(p, fam, board) {
  const pts = (board?.calibration?.byFamily?.[fam] || []).filter((b) => b.n >= 50 && b.said != null && b.happened != null).map((b) => [b.said / 100, b.happened / 100]);
  if (!pts.length) return p;
  if (p <= pts[0][0]) return Math.max(0, p + (pts[0][1] - pts[0][0]));
  for (let i = 1; i < pts.length; i++) if (p <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0); }
  const [xl, yl] = pts[pts.length - 1]; return Math.min(0.995, p + (yl - xl));
}
// Lines so low they are near-automatic for any rotation player; hidden unless asked for.
const LOW_LINE = { pts: 10, reb: 4, ast: 3, tpm: 2 };
const isLowLine = (p) => p.player && LOW_LINE[p.fam] != null && p.line < LOW_LINE[p.fam];
function scenarioRobust(pick, sim) {
  // Chance the pick hits inside each likely scenario (normal, close, blowouts, overtime, injury, foul trouble...).
  if (!sim?.scenarios) return [];
  const out = [];
  const pl = pick.player ? sim.players?.find((x) => x.id === pick.player.id) : null;
  const col = { pts: 1, reb: 3, ast: 4 }[pick.fam];
  for (const sc of sim.scenarios.filter((x) => x.freq >= 0.03)) {
    let p = null;
    if (pl && col && sc.players) {
      const row = sc.players.find((r) => r[0] === pick.player.id); if (!row) continue;
      const sd = Math.max(0.8, pl.dist?.[pick.fam]?.[2] || 1);
      p = 1 - pNorm((pick.line - 0.5 - row[col]) / sd);
    } else if (pick.fam === "winner" && sc.pHome != null) p = pick.team === sim.home ? sc.pHome : 1 - sc.pHome;
    else if (pick.fam === "teamTotal" && sc.home != null) { const mean = pick.team === sim.home ? sc.home : sc.away; p = 1 - pNorm((pick.line - mean) / 10); }
    else if (pick.fam === "total" && sc.total != null) p = pick.side === "under" ? pNorm((pick.line - sc.total) / 15) : 1 - pNorm((pick.line - sc.total) / 15);
    if (p != null) out.push({ id: sc.id, label: sc.label, freq: sc.freq, p: Math.min(0.999, Math.max(0.001, p)) });
  }
  return out.sort((a, b) => a.p - b.p);
}
function pickWhy(pick, sim, gameRaw) {
  const parts = [];
  const rob = scenarioRobust(pick, sim);
  if (rob.length) {
    const weak = rob.filter((r) => r.p < 0.75);
    parts.push(`<h4>How it holds up in each simulated scenario</h4><ul class="plain">${rob.slice(0, 8).map((r) => `<li class="spread"><span>${esc(r.label)} <span class="muted">(${pct(r.freq)} of sims)</span></span><span class="num ${r.p < 0.75 ? "down" : ""}">${pct(r.p)}</span></li>`).join("")}</ul>${weak.length ? `<p class="small"><span class="chip bad">Watch</span> Weakest when: ${esc(weak.map((w) => w.label.split(" (")[0].toLowerCase()).join("; "))}.</p>` : ""}`);
  }
  if (pick.player && gameRaw) {
    const t = gameRaw.teams.find((x) => x.tid === pick.player.t), p = t?.players.find((x) => x.id === pick.player.id), opp = gameRaw.teams.find((x) => x.tid !== pick.player.t);
    if (p) {
      parts.push(`<h4>His projection tonight</h4><p>${f0(p.min)} minutes, ${f1(p.pts)} pts, ${f1(p.reb)} reb, ${f1(p.ast)} ast, ${f1(p.tpm)} threes. ${propReason(p)}</p>`);
      const own = (p.adj?.matchups || []).filter((m) => m.n >= 3);
      if (own.length) parts.push(`<h4>Strengths and weaknesses in tonight's spots</h4><ul class="plain">${own.map((m) => `<li class="spread"><span>${splitLabel(m)} <span class="muted">(${m.n} games)</span>${m.n < 10 ? ` <span class="ztag low">small sample</span>` : ""}</span><span class="num ${cls(m.pts)}">${sg(m.pts)} pts${Math.abs(m.reb ?? 0) >= 1 ? ` · ${sg(m.reb)} reb` : ""}${Math.abs(m.ast ?? 0) >= 1 ? ` · ${sg(m.ast)} ast` : ""}</span></li>`).join("")}</ul>`);
      if (p.zm?.txt) parts.push(`<h4>Hot and cold zones (his offence vs ${esc(T(opp?.tid).abbr)}'s defence)</h4><p>${esc(p.zm.txt)}</p>`);
      if (opp) parts.push(skillSlot(p.id, opp.tid));
      const coach = S.T[pick.player.t]?.coachTags;
      if (coach?.length) parts.push(`<h4>Coach habits (${esc(S.T[pick.player.t]?.coach || T(pick.player.t).abbr)})</h4><div class="chips">${coach.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`);
      if (p.q) parts.push(`<p class="small"><span class="qtag">Q</span> Listed questionable: if he sits, this pick fails. "Who's playing tonight?" on the game page shows the numbers without him.</p>`);
    }
  }
  if (!pick.player && gameRaw) {
    const t = gameRaw.teams.find((x) => x.tid === pick.team);
    const k = (gameRaw.keys?.teams || []).find((x) => x.tid === pick.team);
    const wins = k?.win || [];
    if (wins.length) parts.push(`<h4>Why ${esc(T(pick.team).abbr)} has the edge</h4><ul class="dots">${wins.slice(0, 3).map((w) => `<li>${esc(briefReason(typeof w === "string" ? w : w.t || w.txt || ""))}</li>`).join("")}</ul>`);
    if (t?.style?.tags?.length) parts.push(`<h4>Playing style</h4><div class="chips">${t.style.tags.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>`);
    const coach = S.T[pick.team]?.coachTags;
    if (coach?.length) parts.push(`<h4>Coach habits</h4><div class="chips">${coach.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`);
  }
  if (pick.comparison) {
    const c = pick.comparison;
    const txt = c.bookLine != null ? `sportsbook line ${c.bookLine}${c.ourProbAtBookLine != null ? `, our chance at that line ${pct(c.ourProbAtBookLine)}` : ""}` : c.bookProb != null ? `sportsbook ${pct(c.bookProb)} with its margin removed, ours ${pct(pick.p)}` : "";
    if (txt) parts.push(`<p class="small muted">For comparison only: ${esc(txt)}. Sportsbook numbers never feed the model.</p>`);
  }
  return parts.join("") || `<p class="small muted">No extra detail for this pick.</p>`;
}
async function vPicks() {
  const [board] = await Promise.all([load("board.json")]);
  const days = [...new Set(board.picks.map((p) => dayKey(p.date)))].sort();
  S.pkDay = days.includes(S.pkDay) ? S.pkDay : days[0];
  S.pkKind = S.pkKind || "main"; S.pkBand = S.pkBand || "all";
  if (S.pkBlend === undefined) { try { S.pkBlend = localStorage.getItem("pkBlend") === "1"; } catch { S.pkBlend = false; } }
  const band95 = (board.calibration?.all || []).find((b) => b.band === "95-100%");
  S.pkLow = !!S.pkLow;
  const todays = board.picks.filter((p) => dayKey(p.date) === S.pkDay).map((p) => ({ ...p, raw: p.p, p: calP(p.p, p.fam, board) })).filter((p) => p.p >= 0.85);
const up = await load("upcoming.json").catch(() => []);
  const gids = [...new Set([...todays.map((p) => p.game), ...up.filter((u) => dayKey(u.date) === S.pkDay).map((u) => String(u.id))])];
  const [sims, games] = await Promise.all([
    Promise.all(gids.map((id) => load(`sim/${id}.json`).catch(() => null))),
    Promise.all(gids.map((id) => load(`upcoming/${id}.json`).catch(() => null))),
  ]);
  const SIM = Object.fromEntries(gids.map((id, i) => [id, sims[i]])), GAME = Object.fromEntries(gids.map((id, i) => [id, games[i]]));
  const isPlayer = (p) => !!p.player;
  // The main line for a player prop: the sportsbook's line when there is one (used only as the line to test;
  // our chance is our own model), otherwise our simulation's main line.
  // Our chance he goes over a line, from his 10,000 simulated games: the exact threshold count when the line sits on
  // the grid, otherwise a normal fit to his simulated mean and spread (dist = [mean, median, sd, p10, p25, p75, p90]).
  const simOver = (pl, fam, line) => {
    const hit = (pl.thr?.[fam] || []).find(([x]) => x === Math.floor(line) + 1); if (hit) return hit[1];
    const d = pl.dist?.[fam]; if (!d || !(d[2] > 0)) return null;
    return Math.min(0.995, Math.max(0.005, 1 - pNorm((line - d[0]) / d[2])));
  };
  const refLine = (gid, pid, fam) => {
    const sim = SIM[gid]; if (!sim) return null;
    const cp = (sim.comparison?.props || []).find((x) => String(x.id) === String(pid) && x.stat === fam);
    const pl = sim.players?.find((x) => String(x.id) === String(pid)); const m = pl?.props?.[fam];
    // the bookmaker's latest posted line (read when Picks opens) wins over the line saved at the last refresh
    let live = null; try { live = PROPODDS[gid]?.get(`${pid}|${fam}`); } catch { /* prices not loaded yet */ }
    if (live && pl && (!cp || cp.bookLine !== live.line)) { const pO = simOver(pl, fam, live.line); if (pO != null) return { line: live.line, src: "book", pOver: pO, median: pl.dist?.[fam]?.[1] }; }
    if (cp) return { line: cp.bookLine, src: "book", pOver: cp.ourProbOver, median: cp.ourMedian };
    return m ? { line: m.line, src: "ours", pOver: m.pOver, median: pl.dist?.[fam]?.[1] } : null;
  };
  // A pick far below the main line (e.g. 10+ points for a 22.5-point scorer) is near-automatic: hidden by default.
  const teamRef = (p) => {
    const sim = SIM[p.game]; if (!sim) return null;
    if (p.fam === "total") return sim.comparison?.total?.bookLine ?? sim.lines?.total?.line ?? null;
    if (p.fam === "teamTotal") { const side = String(p.team) === String(sim.home ?? GAME[p.game]?.home) ? "home" : "away"; return sim.lines?.teamTotals?.[side]?.line ?? null; }
    if (p.fam === "spread") {
      const isHome = String(p.team) === String(sim.home ?? GAME[p.game]?.home), c = sim.comparison?.spread;
      if (c?.bookLine != null) return c.team === T(p.team).abbr ? c.bookLine : -c.bookLine;
      const hl = sim.lines?.spread?.homeLine; return hl == null ? null : isHome ? hl : -hl;
    }
    return null;
  };
  const tooSafe = (p) => { if (!p.player) { const ref = teamRef(p); if (ref == null) return false; const v = p.fam === "spread" ? (p.side === "by" ? -p.line : p.line) : p.line; return Math.abs(v - ref) > (p.fam === "total" ? 12 : p.fam === "spread" ? 7 : 9); } const ref = refLine(p.game, p.player.id, p.fam); return tooFarBelow(p, ref?.line ?? null); };
  const FAMS_MAIN = [["pts", "points"], ["reb", "rebounds"], ["ast", "assists"], ["tpm", "threes"], ["pra", "pts+reb+ast"]];
  // Expected value at the sportsbook's price, from OUR chance. Display only: odds never feed the model.
  const decOf = (a) => { const v = Number(a); return !v ? null : v > 0 ? 1 + v / 100 : 1 + 100 / -v; };
  const evOf = (p, price) => { const d = decOf(price); return d == null || p == null ? null : p * d - 1; };
  // Edge rules after the analyst review. Everything is computed from OUR chance; the bookmaker is a reference only.
  // A realistic edge is small, so the label needs a moderate difference (3-10 points) and positive EV. A difference of
  // 10+ points is labelled "large disagreement": it usually means news we do not have, so it is never called an edge.
  const QUAL = { gap: 0.03, ev: 0.02, maxGap: 0.1 };
  const edgeOf = (x) => { const d = decOf(x.price); x.ev = x.p != null && d ? x.p * d - 1 : null; x.gap = x.book != null ? x.p - x.book : null; x.wrong = x.gap != null && Math.abs(x.gap) >= QUAL.maxGap; x.qual = !x.wrong && x.gap != null && x.ev != null && x.gap >= QUAL.gap && x.ev >= QUAL.ev; return x; };
  // Gold = worth a look: a qualifying edge, decimal odds 1.60+, our chance 55%+, a gap under 12 points (bigger gaps usually mean
  // late news), the pick holding in 60%+ of the simulated game scripts (weighted by likelihood), and tonight's scenario library not against it.
  const GOLD = { minOdds: 1.6, minP: 0.55, maxGap: 0.1, minHold: 0.6 };
  const robustOf = (x) => {
    const sim = SIM[x.gid], gm = GAME[x.gid]; if (!sim || !gm) return { hold: null, libFor: 0, libAgainst: 0 };
    const H = T(gm.home).abbr, A = T(gm.away).abbr, pickHome = x.pick.startsWith(H + " "), pickTeam = pickHome ? String(gm.home) : x.pick.startsWith(A + " ") ? String(gm.away) : null;
    const lineOf = () => { const m = x.pick.match(/([+-]?\d+(?:\.\d+)?)\s*$/); return m ? Number(m[1]) : null; };
    let w = 0, ok = 0;
    for (const sc of (sim.scenarios || []).filter((y) => y.freq >= 0.03 && y.pHome != null)) {
      let holds = null;
      if (x.kind === "Moneyline" && pickTeam) holds = (pickHome ? sc.pHome : 1 - sc.pHome) >= 0.5;
      else if (x.kind === "Spread" && pickTeam) { const l = lineOf(); if (l != null) holds = (pickHome ? sc.margin : -sc.margin) + l > 0; }
      else if (x.kind === "Total") { const l = lineOf(); if (l != null && sc.total != null) holds = x.pick.startsWith("Over") ? sc.total > l : sc.total < l; }
      if (holds == null) continue; w += sc.freq; ok += holds ? sc.freq : 0;
    }
    let libFor = 0, libAgainst = 0;
    if (pickTeam) for (const sc of gm.scenarios?.list || []) { if (!sc.fav || sc.mixed) continue; if (String(sc.fav) === pickTeam) libFor++; else libAgainst++; }
    return { hold: w ? ok / w : null, libFor, libAgainst };
  };
  const ODDS = await load("odds.json").catch(() => null), PTREC = discRecord(await load("pretip.json").catch(() => null), ODDS);
  const priceFor = (gid, kind, pick, H) => { const o = ODDS?.games?.[gid]; if (!o) return null; if (kind === "Moneyline") return pick.startsWith(H) ? o.mlHome : o.mlAway; if (kind === "Spread") return pick.startsWith(H) ? o.spreadOddsHome : o.spreadOddsAway; if (kind === "Total") return pick.startsWith("Over") ? o.overOdds : o.underOdds; return null; };
  const gameMain = () => {
    const out = [];
    for (const gid of gids) {
      const sim = SIM[gid], c = sim?.comparison, gm = GAME[gid]; if (!sim || !gm) continue;
      if (gm.date && Date.parse(gm.date) < Date.now()) continue;
      const H = T(gm.home).abbr, A = T(gm.away).abbr;
      const base = { gid, home: gm.home, away: gm.away, date: gm.date };
      if (c?.winner?.ourProb != null) { const ph = gm.pred.pHome, home = ph >= 0.5; out.push({ ...base, kind: "Moneyline", pick: `${home ? H : A} to win`, p: Math.max(ph, 1 - ph), book: home ? c.winner.bookProb : 1 - c.winner.bookProb, ours: `our margin ${home ? H : A} by ${f1(Math.abs(gm.pred.hs - gm.pred.as))}` }); }
      if (c?.spread?.ourProb != null) { const q = c.spread.ourProb, l = c.spread.bookLine, team = c.spread.team, other = team === H ? A : H; const takeTeam = q >= 0.5;
        out.push({ ...base, kind: "Spread", pick: takeTeam ? `${team} ${l > 0 ? "+" : ""}${l}` : `${other} ${-l > 0 ? "+" : ""}${-l}`, p: Math.max(q, 1 - q), book: takeTeam ? c.spread.bookProb : 1 - c.spread.bookProb, ours: `our margin ${gm.pred.hs >= gm.pred.as ? H : A} by ${f1(Math.abs(gm.pred.hs - gm.pred.as))}` }); }
      if (c?.total?.ourProb != null) { const q = c.total.ourProb; out.push({ ...base, kind: "Total", pick: `${q >= 0.5 ? "Over" : "Under"} ${c.total.bookLine}`, p: Math.max(q, 1 - q), book: q >= 0.5 ? c.total.bookProb : 1 - c.total.bookProb, ours: `our total ${f1(gm.pred.hs + gm.pred.as)}` }); }
    }
    for (const x of out) { const ob = ODDS?.games?.[x.gid], gm2 = GAME[x.gid]; x.mgap = ob && gm2 && Number.isFinite(ob.spreadHome) ? (gm2.pred.hs - gm2.pred.as) - -ob.spreadHome : null; x.price = priceFor(x.gid, x.kind, x.pick, T(x.home).abbr); edgeOf(x); x.dec = decOf(x.price); Object.assign(x, robustOf(x)); x.gold = x.qual && x.dec != null && x.dec >= GOLD.minOdds && x.p >= GOLD.minP && !x.wrong && x.hold != null && x.hold >= GOLD.minHold && x.libAgainst <= x.libFor; }
    return out.sort((a, b) => b.p - a.p);
  };
  // Sportsbook pre-game player prop prices (display only). ESPN lists two prices per line without saying which is
  // the over, so the order is worked out from the same book's "milestone" prices (always over-type, e.g. 20+ points).
  const PT = { "Total Points": "pts", "Total Rebounds": "reb", "Total Assists": "ast", "Total 3-Point Field Goals": "tpm", "Total Points, Rebounds, and Assists": "pra" };
  const MS = { "Points Milestones": "pts", "Rebounds Milestones": "reb", "Assists Milestones": "ast", "Three Pointers Made Milestones": "tpm" };
  const loadPropOdds = async (gid) => {
    try {
      const bust = `_=${Math.floor(Date.now() / 60000)}`, base = `${ESPN_CORE}/events/${gid}/competitions/${gid}/odds`;
      const j = await fetch(`${base}?lang=en&region=us&${bust}`, { cache: "no-store" }).then((x) => x.json());
      const it = (j.items || []).find((x) => !/live/i.test(x.provider?.name || "")); if (!it?.provider?.id) return null;
      const pb = await fetch(`${base}/${it.provider.id}/propBets?lang=en&region=us&limit=1000&${bust}`, { cache: "no-store" }).then((x) => x.json());
      const pairs = new Map(), miles = new Map();
      for (const x of pb.items || []) {
        const ath = String(x.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1]; if (!ath) continue;
        const price = Number(x.odds?.american?.value), tgt = x.current?.target?.value ?? Number(String(x.odds?.total?.value || "").replace("+", ""));
        if (PT[x.type?.name]) { const k = `${ath}|${PT[x.type.name]}|${tgt}`; if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(price); }
        else if (MS[x.type?.name]) miles.set(`${ath}|${MS[x.type.name]}|${Number(tgt) - 0.5}`, price);
      }
      let vote = 0; // > 0: the first price is the over
      for (const [k, pr] of pairs) { const m = miles.get(k); if (m == null || pr.length < 2) continue; const t = amP(m), a = amP(pr[0]), b = amP(pr[1]); if (t == null || a == null || b == null) continue; vote += Math.abs(a - t) < Math.abs(b - t) ? 1 : -1; }
      const firstOver = vote >= 0, out = new Map();
      for (const [k, pr] of pairs) { if (pr.length < 2) continue; const [ath, fam, line] = k.split("|"); out.set(`${ath}|${fam}`, { line: Number(line), over: firstOver ? pr[0] : pr[1], under: firstOver ? pr[1] : pr[0] }); }
      out.vote = vote; out.book = it.provider.name; return out;
    } catch { return null; }
  };
  const PROPODDS = Object.fromEntries(await Promise.all(gids.filter((id) => !(GAME[id]?.date && Date.parse(GAME[id].date) < Date.now())).map(async (id) => [id, await Promise.race([loadPropOdds(id), new Promise((res) => setTimeout(() => res(null), 7000))])])));
  // Scenario check for a prop: share of the simulated game scripts (weighted by likelihood) where his average in that
  // script lands on our side of the line. Scenario rows hold [id, pts, min, reb, ast].
  const propHold = (gid, pid, fam, line, over) => {
    const sim = SIM[gid]; if (!sim || fam === "tpm") return null;
    let w = 0, ok = 0;
    for (const sc of (sim.scenarios || []).filter((y) => y.freq >= 0.03)) {
      const row = (sc.players || []).find((p) => String(p[0]) === String(pid)); if (!row) continue;
      const v = fam === "pts" ? row[1] : fam === "reb" ? row[3] : fam === "ast" ? row[4] : row[1] + row[3] + row[4];
      w += sc.freq; ok += (over ? v > line : v < line) ? sc.freq : 0;
    }
    return w ? ok / w : null;
  };
  // ---------------- "Why gold?" — every angle behind a main-line pick, from our model and simulations
  const tick = (ok) => (ok ? '<b class="up">✓</b>' : '<b class="down">✗</b>');
  const goldTests = (x) => `<ul class="plain gw-tests">
      <li>${tick(x.gap != null && x.gap >= QUAL.gap)} Difference: our ${pct(x.p)} vs the book's fair ${x.book != null ? pct(x.book) : "-"} (gap ${x.gap != null ? (x.gap > 0 ? "+" : "") + Math.round(x.gap * 100) : "-"} percentage points; needs +3)</li>
      <li>${tick(x.ev != null && x.ev >= QUAL.ev)} Price: offered odds ${x.dec != null ? x.dec.toFixed(2) : "-"} vs our fair odds ${(1 / x.p).toFixed(2)} (offered must beat ours by about 2%)${S.pkBlend && x.ev != null ? ` · EV ${(x.ev * 100).toFixed(1)}%` : ""}</li>
      <li>${tick(x.dec != null && x.dec >= GOLD.minOdds)} Odds ${x.dec != null ? x.dec.toFixed(2) : "-"} (needs 1.60+)</li>
      <li>${tick(x.p >= GOLD.minP)} Our chance ${pct(x.p)} (needs 55%+)</li>
      <li>${tick(x.gap != null && Math.abs(x.gap) < QUAL.maxGap)} Difference under 10 percentage points (bigger ones usually mean news we do not have)</li>
      <li>${tick(x.hold != null && x.hold >= GOLD.minHold)} Robust: our side ahead in ${x.hold != null ? pct(x.hold) : "-"} of the game scripts (needs 60%+; a robustness check, not a probability)</li>
      ${x.libFor != null ? `<li>${tick(x.libAgainst <= x.libFor)} Scenario library: ${x.libFor} for, ${x.libAgainst} against</li>` : ""}
    </ul>`;
  const scenName = (sc) => sc.label.replace(/\s*\(.*\)\s*$/, "");
  function propWhy(x) {
    const gm = GAME[x.gid], sim = SIM[x.gid];
    const pl = gm?.teams?.flatMap((t) => (t.players || []).map((p) => ({ ...p, tid: t.tid }))).find((p) => String(p.id) === String(x.pl.id));
    const opp = gm?.teams?.find((t) => t.tid !== pl?.tid);
    const d = x.pl.dist?.[x.fam] || [], side = x.over ? "Over" : "Under";
    const summary = `${side} ${x.line}: we project ${esc(x.median ?? "-")} (80% range ${esc(d[3] ?? "-")}-${esc(d[6] ?? "-")}) in about ${f0(x.pl.proj?.min || pl?.min || 0)} minutes. We say ${pct(x.p)}${x.src === "est" ? ` at his season-average line (${f1(x.estAvg)}); the bookmaker has not posted this prop yet, so there are no odds to compare` : `, the book ${x.book != null ? pct(x.book) : "-"}`}${x.hold != null ? `; holds in ${pct(x.hold)} of the game scripts` : ""}${S.pkBlend && x.ev != null ? `; EV ${x.ev > 0 ? "+" : ""}${(x.ev * 100).toFixed(1)}% at ${x.dec.toFixed(2)}` : x.dec ? `; odds ${x.dec.toFixed(2)} vs our fair ${(1 / x.p).toFixed(2)}` : ""}.`;
    const parts = [];
    if (x.src !== "est") parts.push(`<h4>Gold tests</h4>${goldTests(x)}`); else parts.push(`<h4>Our pick before the bookmaker posts</h4><p>Tested at ${esc(x.line)}, just above or below his season average of ${f1(x.estAvg)}, which is where books usually set the line. Gold needs real odds, so this pick can turn gold only after the bookmaker posts.</p>`);
    parts.push(`<h4>Our projection</h4><p>${f0(x.pl.proj?.min || pl?.min || 0)} minutes · average ${f1(x.mean)} · median ${esc(x.median ?? "-")} · 80% range ${esc(d[3] ?? "-")} to ${esc(d[6] ?? "-")} ${x.word}.${x.thr.length ? ` Chance of reaching: ${x.thr.map(([t, q]) => `${t}+ ${pct(q)}`).join(", ")}.` : ""}</p>${pl ? `<p class="small muted">${propReason(pl)}</p>` : ""}`);
    // full scenario-by-scenario analysis
    const rows = (sim?.scenarios || []).filter((sc) => sc.freq >= 0.01).map((sc) => {
      const row = (sc.players || []).find((p) => String(p[0]) === String(x.pl.id)); if (!row) return null;
      const v = x.fam === "pts" ? row[1] : x.fam === "reb" ? row[3] : x.fam === "ast" ? row[4] : x.fam === "pra" ? row[1] + row[3] + row[4] : null;
      return { sc, v, min: row[2], ok: v == null ? null : x.over ? v > x.line : v < x.line };
    }).filter(Boolean).sort((a, b) => b.sc.freq - a.sc.freq);
    if (rows.length) parts.push(`<h4>Scenario by scenario (10,000 simulations)</h4><div class="tw"><table class="gw-t"><thead><tr><th>Game script</th><th class="n">Likely</th><th class="n">His ${esc(x.word)}</th><th class="n">Min</th><th class="n">${side} ${esc(x.line)}</th></tr></thead><tbody>
      ${rows.map((y) => `<tr><td>${esc(scenName(y.sc))}</td><td class="n">${pct(y.sc.freq)}</td><td class="n">${y.v != null ? f1(y.v) : "-"}</td><td class="n">${f0(y.min)}</td><td class="n">${y.ok == null ? "-" : tick(y.ok)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">His average in each slice of the simulations. Slices overlap, so likelihoods do not add to 100%. The scenario check weights each slice by how often it happens.</p>`);
    if (pl?.scen?.length) parts.push(`<h4>Learned scenario effects tonight</h4><ul class="plain">${pl.scen.map((sc) => `<li class="spread"><span>${esc(sc.s)} <span class="muted">(${num(sc.n)} player-games)</span></span><span class="num ${sc.pts > 0 ? "up" : sc.pts < 0 ? "down" : ""}">${sc.pts > 0 ? "+" : ""}${f1(sc.pts)} pts</span></li>`).join("")}</ul><p class="small muted">Effects learned after every game from how players in his role did in the same situation.</p>`);
    if (pl?.adj) { const a = pl.adj; parts.push(`<h4>Matchup adjustments</h4><ul class="plain">
      <li class="spread"><span>Pace of tonight's game</span><span class="num">${a.pace != null ? (a.pace >= 1 ? "+" : "") + ((a.pace - 1) * 100).toFixed(1) + "%" : "-"}</span></li>
      <li class="spread"><span>${esc(T(opp?.tid).abbr || "Opponent")} defence</span><span class="num">${a.defense != null ? (a.defense >= 1 ? "+" : "") + ((a.defense - 1) * 100).toFixed(1) + "%" : "-"}</span></li>
      ${a.absence ? `<li class="spread"><span>Absences around him</span><span class="num">${a.absence > 0 ? "+" : ""}${f1(a.absence)}</span></li>` : ""}
      ${a.bias ? `<li class="spread"><span>His recent gap to our projections (learned)</span><span class="num">${a.bias > 0 ? "+" : ""}${f1(a.bias)}</span></li>` : ""}
      </ul>`); }
    if (pl?.dm?.defenders?.length) parts.push(`<h4>Who guards him</h4><ul class="plain">${pl.dm.defenders.slice(0, 4).map((df) => `<li class="spread"><span>${esc(df.n)} <span class="muted">(${esc(df.pos || "")}, ${f0(df.share)}% of his matchups${df.fromMeetings ? ", from past meetings" : ""})</span></span><span class="num ${df.vsExpPct > 0 ? "up" : df.vsExpPct < 0 ? "down" : ""}">${df.vsExpPct != null ? (df.vsExpPct > 0 ? "+" : "") + f1(df.vsExpPct) + "% vs usual" : ""}</span></li>`).join("")}</ul>${pl.dm.meetings ? `<p class="small muted">${esc(pl.dm.meetings)} previous meetings on record; scorer type ${esc(pl.dm.scorerType || "-")}.</p>` : ""}`);
    if (pl?.zm) parts.push(`<h4>Hot and cold zones vs this defence</h4><p>Main zone: ${esc(ZONE_FALLBACK[pl.zm.zone] || pl.zm.zone)} (${esc(pl.zm.tag)}): he shoots ${esc(pl.zm.pct)}% there (league ${esc(pl.zm.lgPct)}%); ${esc(T(opp?.tid).abbr)} allows ${esc(pl.zm.oppPct)}% (${esc(pl.zm.oppTag)}).</p>`);
    if (pl?.fx?.length) parts.push(`<h4>Opponent factors applied</h4><ul class="plain">${pl.fx.map((q) => `<li class="spread"><span>${esc(q.label)}</span><span class="num">${q.v > 0 ? "+" : ""}${f1(q.v)} ${esc(q.stat)}</span></li>`).join("")}</ul>`);
    if (pl?.wwD?.length) parts.push(`<h4>Teammates out tonight</h4><ul class="plain">${pl.wwD.slice(0, 4).map((w) => `<li class="spread"><span>${esc(w.n)} out <span class="muted">(without: ${esc(w.without?.ppg ?? "-")} ppg in ${esc(w.without?.n ?? "-")} games; with: ${esc(w.with?.ppg ?? "-")})</span></span><span class="num">${w.pts > 0 ? "+" : ""}${f1(w.pts)}</span></li>`).join("")}</ul>`);
    const bo = pl?.ix?.blowout, fl = pl?.ix?.flow;
    if (bo) parts.push(`<h4>Blowout and game-flow habits</h4><ul class="plain">
      <li>Chance his team wins by 15+: ${pct(bo.winBy15)}${bo.ifWinBig ? ` → he usually plays ${bo.ifWinBig.min > 0 ? "+" : ""}${f1(bo.ifWinBig.min)} min, ${bo.ifWinBig.pts > 0 ? "+" : ""}${f1(bo.ifWinBig.pts)} pts (${bo.ifWinBig.games} games)` : ""}</li>
      <li>Chance his team loses by 15+: ${pct(bo.loseBy15)}${bo.ifLoseBig ? ` → ${bo.ifLoseBig.min > 0 ? "+" : ""}${f1(bo.ifLoseBig.min)} min, ${bo.ifLoseBig.pts > 0 ? "+" : ""}${f1(bo.ifLoseBig.pts)} pts (${bo.ifLoseBig.games} games)` : ""}</li>
      ${fl?.tight4th && !fl.tight4th.small ? `<li>Tight 4th quarters: ${fl.tight4th.vsUsual36 > 0 ? "+" : ""}${f1(fl.tight4th.vsUsual36)} pts per 36 vs his usual (${fl.tight4th.games} games)</li>` : ""}
      ${fl?.ahead && !fl.ahead.small ? `<li>When far ahead: ${fl.ahead.vsUsual36 > 0 ? "+" : ""}${f1(fl.ahead.vsUsual36)} per 36 · when far behind: ${fl.behind ? (fl.behind.vsUsual36 > 0 ? "+" : "") + f1(fl.behind.vsUsual36) : "-"} per 36</li>` : ""}
      </ul>`);
    if (pl?.trust) parts.push(`<h4>How well we read him</h4><p>${esc(trustWord(pl.trust.label))}: our recent projections missed by ${f1(pl.trust.mae)} points against a typical ${f1(pl.trust.typical)} (${esc(pl.trust.games)} games)${pl.trust.lean ? `, ${esc(pl.trust.lean)}` : ""}.</p>`);
    const lib = (gm?.scenarios?.list || []).filter((sc) => (pl && sc.t.includes(pl.n)) || String(sc.fav) === String(pl?.tid)).slice(0, 5);
    if (lib.length) parts.push(`<h4>Scenario library for this game</h4><ul class="dots small">${lib.map((sc) => `<li>${esc(sc.t)} <span class="muted">(${esc(sc.sample || "")} sample)</span></li>`).join("")}</ul>`);
    const risks = [];
    if (pl?.q) risks.push("Listed questionable: if he sits, the pick fails (unders are void at most books, but check).");
    if (bo && (x.over ? bo.winBy15 + bo.loseBy15 >= 0.35 : false)) risks.push(`Blowout chance ${pct(bo.winBy15 + bo.loseBy15)}: blowouts cut starters' minutes, which hurts an over.`);
    const fo = (sim?.scenarios || []).find((sc) => sc.id === (x.pl.side === 0 ? "foulH" : "foulA")); if (fo) risks.push(`His team has foul trouble in ${pct(fo.freq)} of simulations.`);
    risks.push("Shooting variance: a hot or cold night alone can move points by 6-8.");
    parts.push(`<h4>Risks</h4><ul class="dots small">${risks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`);
    if (x.bk) parts.push(`<h4>Bookmaker</h4><p>${esc(x.bk)} · fair chance for our side ${pct(x.book)} (margin removed). Odds only set the line and price; they never change our numbers.</p>`);
    return `<div class="gw"><p class="gw-sum">${summary}</p><details class="gw-more"><summary>Full analysis: every angle ›</summary>${parts.join("")}</details></div>`;
  }
  function gameWhy(x) {
    const gm = GAME[x.gid], sim = SIM[x.gid]; if (!gm) return "";
    const H = T(gm.home).abbr, A = T(gm.away).abbr, l = (x.pick.match(/([+-]?\d+(?:\.\d+)?)\s*$/) || [])[1], line = l != null ? Number(l) : null;
    const pickHome = x.pick.startsWith(H + " "), pickTeam = pickHome ? String(gm.home) : x.pick.startsWith(A + " ") ? String(gm.away) : null;
    const summary = `${esc(x.pick)}: ${esc(x.ours)}. We say ${pct(x.p)}, the book ${x.book != null ? pct(x.book) : "-"}${x.hold != null ? `; holds in ${pct(x.hold)} of the game scripts` : ""}${S.pkBlend && x.ev != null ? `; EV ${x.ev > 0 ? "+" : ""}${(x.ev * 100).toFixed(1)}% at ${x.dec?.toFixed(2)}` : x.dec ? `; odds ${x.dec.toFixed(2)} vs our fair ${(1 / x.p).toFixed(2)}` : ""}.`;
    const parts = [`<h4>Gold tests</h4>${goldTests(x)}`];
    parts.push(`<h4>Our projection</h4><p>${esc(A)} ${f1(gm.pred.as)} - ${f1(gm.pred.hs)} ${esc(H)} · ${esc(H)} wins ${pct(gm.pred.pHome)} · pace ${f1(gm.pred.pace)} · close game ${pct(gm.pred.close)} · blowout ${pct(gm.pred.blowout)}.</p>`);
    const rows = (sim?.scenarios || []).filter((sc) => sc.freq >= 0.01 && sc.pHome != null).sort((a, b) => b.freq - a.freq).map((sc) => {
      let ok = null;
      if (x.kind === "Moneyline" && pickTeam) ok = (pickHome ? sc.pHome : 1 - sc.pHome) >= 0.5;
      else if (x.kind === "Spread" && pickTeam && line != null) ok = (pickHome ? sc.margin : -sc.margin) + line > 0;
      else if (x.kind === "Total" && line != null) ok = x.pick.startsWith("Over") ? sc.total > line : sc.total < line;
      return { sc, ok };
    });
    if (rows.length) parts.push(`<h4>Scenario by scenario (10,000 simulations)</h4><div class="tw"><table class="gw-t"><thead><tr><th>Game script</th><th class="n">Likely</th><th class="n">${esc(H)} wins</th><th class="n">Margin</th><th class="n">Total</th><th class="n">Pick</th></tr></thead><tbody>
      ${rows.map((y) => `<tr><td>${esc(scenName(y.sc))}</td><td class="n">${pct(y.sc.freq)}</td><td class="n">${pct(y.sc.pHome)}</td><td class="n">${y.sc.margin >= 0 ? esc(H) : esc(A)} ${f1(Math.abs(y.sc.margin))}</td><td class="n">${f0(y.sc.total)}</td><td class="n">${y.ok == null ? "-" : tick(y.ok)}</td></tr>`).join("")}</tbody></table></div>`);
    const keys = (gm.keys?.teams || []).find((k) => String(k.tid) === pickTeam);
    if (keys?.win?.length) parts.push(`<h4>Why ${esc(T(pickTeam).abbr)} has the edge</h4><ul class="dots small">${keys.win.slice(0, 5).map((w) => `<li>${esc(typeof w === "string" ? w : w.t || w.txt || "")}</li>`).join("")}</ul>`);
    const lib = gm.scenarios?.list || [];
    if (lib.length) parts.push(`<h4>Scenario library for this game</h4><ul class="dots small">${lib.slice(0, 8).map((sc) => `<li>${pickTeam && sc.fav ? (String(sc.fav) === pickTeam ? tick(true) : tick(false)) + " " : ""}${esc(sc.t)} <span class="muted">(${esc(sc.sample || "")} sample)</span></li>`).join("")}</ul>`);
    const outs = gm.teams.flatMap((t) => (t.out || []).map((o) => `${o.n || o} (${T(t.tid).abbr})`));
    const qs = gm.teams.flatMap((t) => (t.players || []).filter((p) => p.q).map((p) => `${p.n} (${T(t.tid).abbr})`));
    parts.push(`<h4>Risks</h4><ul class="dots small">${outs.length ? `<li>Out: ${esc(outs.join(", "))} (already in the projection)</li>` : ""}${qs.length ? `<li>Questionable, projected to play: ${esc(qs.join(", "))}</li>` : ""}<li>Shooting variance is the biggest single source of misses (about 9 points per team per game).</li></ul>`);
    return `<div class="gw"><p class="gw-sum">${summary}</p><details class="gw-more"><summary>Full analysis: every angle ›</summary>${parts.join("")}</details></div>`;
  }
  const goldGameSum = (x) => {
    const gm = GAME[x.gid], ob = ODDS?.games?.[x.gid]; if (!gm) return "";
    const H = T(gm.home).abbr, A = T(gm.away).abbr, om = gm.pred.hs - gm.pred.as, ot = gm.pred.hs + gm.pred.as;
    const ours = x.kind === "Total" ? `our total ${f1(ot)}` : `our line ${om >= 0 ? H : A} −${f1(Math.abs(om))}`;
    const main = !ob ? "" : x.kind === "Total" ? `main line ${ob.total}` : `main line ${H} ${ob.spreadHome > 0 ? "+" : ""}${ob.spreadHome}`;
    const team = x.pick.startsWith(H + " ") ? String(gm.home) : x.pick.startsWith(A + " ") ? String(gm.away) : null;
    const why = team ? (gm.keys?.teams || []).find((k) => String(k.tid) === team)?.win?.[0] : null;
    const whyT = why ? briefReason(typeof why === "string" ? why : why.t || "") : x.kind === "Total" ? `projected pace ${f1(gm.pred.pace)} possessions` : "";
    return `${esc(ours)}${main ? ` vs ${esc(main)}` : ""}. We say ${pct(x.p)} (book ${x.book != null ? pct(x.book) : "-"}). Our side is ahead in ${pct(x.hold)} of the game scripts${x.libFor || x.libAgainst ? `; scenario library ${x.libFor} for, ${x.libAgainst} against` : ""}.${whyT ? ` Main reason: ${esc(whyT)}.` : ""}`;
  };
  const goldPropSum = (x) => {
    const gm = GAME[x.gid], pl = gm?.teams?.flatMap((t) => t.players || []).find((p) => String(p.id) === String(x.pl.id)), d = x.pl.dist?.[x.fam] || [];
    const top = (pl?.scen || []).filter((sc) => Math.abs(sc.pts) >= 0.3).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
    const def = pl?.dm?.defenders?.[0];
    return `We project ${esc(x.median ?? "-")} ${esc(x.word)} (80% range ${esc(d[3] ?? "-")}-${esc(d[6] ?? "-")}, about ${f0(x.pl.proj?.min || pl?.min || 0)} minutes) vs the line ${esc(x.line)}. We say ${pct(x.p)} ${x.over ? "over" : "under"} (book ${x.book != null ? pct(x.book) : "-"}). His average is on our side in ${pct(x.hold)} of the game scripts.${top ? ` Biggest learned scenario: ${esc(top.s)} ${top.pts > 0 ? "+" : ""}${f1(top.pts)} pts (${num(top.n)} player-games).` : ""}${def ? ` Likely main defender: ${esc(shortName(def.n))}.` : ""}`;
  };
  const mainLines = () => {
    const out = [];
    for (const gid of gids) {
      const sim = SIM[gid]; if (!sim) continue;
      if (GAME[gid]?.date && Date.parse(GAME[gid].date) < Date.now()) continue; // started: see the game's Live tab
      for (const pl of sim.players || []) {
        if ((pl.proj?.min || 0) < 20 || pl.pDnp > 0.25) continue;
        for (const [fam, word] of FAMS_MAIN) {
          const ref = refLine(gid, pl.id, fam); if (!ref || ref.pOver == null) continue;
          let estAvg = null;
          if (ref.src === "ours") {
            // No bookmaker line yet: test our projection at the line a book would most likely post, his season average
            // (this season, blended with last season while the sample is small). Replaced as soon as the real line appears.
            const sp = S.P?.[String(pl.id)], I = { pts: 2, reb: 3, ast: 4 };
            const avgOf = (row) => (!row ? null : fam === "pra" ? row[2] + row[3] + row[4] : I[fam] != null ? row[I[fam]] : null);
            const c = sp?.cur, pv = sp?.prev, ac = avgOf(c), ap = avgOf(pv);
            if (ac == null && ap == null) continue;
            const wc = c ? Math.min(1, (c[0] || 0) / 15) : 0; estAvg = ac != null && ap != null ? wc * ac + (1 - wc) * ap : ac ?? ap;
            const L = Math.floor(estAvg) + 0.5, pO = simOver(pl, fam, L); if (pO == null) continue;
            Object.assign(ref, { line: L, pOver: pO, src: "est" });
            if (Math.max(pO, 1 - pO) < 0.58) continue; // too close to call at his usual line
          }
          const over = ref.pOver >= 0.5, p = Math.max(ref.pOver, 1 - ref.pOver);
          const thr = (pl.thr?.[fam] || []).filter(([x]) => Math.abs(x - ref.line) <= (fam === "pts" || fam === "pra" ? 10 : 3)).slice(0, 4);
          const x = { gid, pl, fam, word, line: ref.line, over, p, median: ref.median, mean: pl.dist?.[fam]?.[0], thr, src: ref.src, home: sim.home ?? GAME[gid]?.home, away: sim.away ?? GAME[gid]?.away, date: GAME[gid]?.date, estAvg };
          const po = PROPODDS[gid]?.get(`${pl.id}|${fam}`);
          if (po && po.line === ref.line) { x.price = over ? po.over : po.under; const bo = noVig(po.over, po.under); x.book = bo == null ? null : over ? bo : 1 - bo; x.bk = `Over ${po.line} ${decOdds(po.over)} · Under ${po.line} ${decOdds(po.under)}`; }
          x.dec = decOf(x.price); edgeOf(x);
          x.hold = propHold(gid, pl.id, fam, ref.line, over);
          x.dv = devCheck(GAME[gid], pl.id, fam);
          x.gold = x.qual && x.dec != null && x.dec >= GOLD.minOdds && x.p >= GOLD.minP && !x.wrong && x.hold != null && x.hold >= GOLD.minHold && !x.dv?.unexplained;
          out.push(x);
        }
      }
    }
    return out.sort((a, b) => b.p - a.p);
  };
  const draw = () => {
    const unexp = (p) => p.player && devCheck(GAME[p.game], p.player.id, p.fam)?.unexplained;
    let list = todays.filter((p) => (S.pkKind === "top" ? true : S.pkKind === "player" ? isPlayer(p) : !isPlayer(p))).filter((p) => S.pkLow || !tooSafe(p)).filter((p) => !unexp(p));
    if (S.pkBand === "95") list = list.filter((p) => p.p >= 0.95); else if (S.pkBand === "85") list = list.filter((p) => p.p < 0.95);
    // Group by player and stat (or team and market): the highest line is the headline, the rest are alternatives.
    const groups = new Map();
    for (const p of list) { const k = isPlayer(p) ? `${p.player.id}|${p.fam}` : `${p.game}|${p.fam}|${p.team || ""}|${p.side}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    const cards = [...groups.values()].map((g) => g.sort((a, b) => (b.line - a.line) || (a.p - b.p)));
    cards.sort((a, b) => b[0].p - a[0].p);
    if (S.pkKind === "top") cards.splice(20);
    const card = (g) => {
      const top = g[0], sim = SIM[top.game], raw = GAME[top.game];
      const pl = top.player ? sim?.players?.find((x) => x.id === top.player.id) : null;
      const main = pl?.props?.[top.fam];
      const who = top.player
        ? `${avatar(top.player.id, top.player.n, { size: "sm" })}<span><b>${esc(top.player.n)}</b><span class="small muted"> ${esc(T(top.player.t).abbr)} · ${esc(PICK_FAM[top.fam] || top.fam)}</span></span>`
        : `${teamLogo(top.team || top.home, { size: "sm" })}<span><b>${esc(PICK_FAM[top.fam] || top.fam)}</b></span>`;
      const altTxt = (x) => (top.player ? x.label.replace(top.player.n, "").trim() : x.label);
      return `<details class="card pick"><summary>
        <div class="pick-h">${who}<span class="pick-p ${top.p >= 0.95 ? "nc" : ""}">${pct(top.p)}<i class="pick-raw">sim ${pct(top.raw)}</i></span></div>
        <span class="conf ${top.p >= 0.95 ? "nc" : ""}">${top.p >= 0.95 ? "95%+ near-certain" : "85%+ confidence"}</span>${meter(top.p)}<div class="pick-l"><b>${esc(top.label)}</b></div>
        ${g.length > 1 || main ? `<div class="pick-alt">${main ? `<span>Main line ${esc(main.line)}: over ${pct(main.pOver)}</span>` : ""}${g.slice(1, 4).map((x) => `<span>Alt ${esc(altTxt(x))}: ${pct(x.p)}</span>`).join("")}</div>` : ""}
        <div class="pick-why small">${esc(pickLine(top, raw))} <span class="why-l">Why? ›</span></div>
        <div class="pick-m small muted">${esc(T(top.away).abbr)} at ${esc(T(top.home).abbr)} · ${esc(timePH(top.date))} · picks like this came true ${top.hit?.rate != null ? `${esc(top.hit.rate)}%` : "-"} of the time (${num(top.hit?.n || 0)} past picks, ${esc(top.hit?.band || "")})</div>
      </summary><div class="pbody">${pickWhy(top, sim, raw)}<a class="go" href="#/game/${esc(top.game)}">Game page ›</a><a class="go" href="#/sim/${esc(top.game)}">Simulation ›</a></div></details>`;
    };
    // Suggested parlays: legs from DIFFERENT games only, so they are independent and the combined chance is honest.
    const qOf = (p) => { const g = GAME[p.game]; const t = g?.teams.find((x) => x.tid === p.player?.t); return !!t?.players.find((x) => x.id === p.player?.id)?.q; };
    const legs = todays.filter((p) => p.p >= 0.88 && !tooSafe(p) && !(p.player && qOf(p)) && !(p.player && devCheck(GAME[p.game], p.player.id, p.fam)?.unexplained)).sort((a, b) => (b.hit?.rate ?? 0) - (a.hit?.rate ?? 0) || b.p - a.p);
    const pickLegs = (n, minP) => { for (const mix of [true, false]) { const used = new Set(), fams = new Set(), out = []; for (const l of legs) { if (l.p < minP || used.has(l.game) || (mix && fams.has(l.fam))) continue; out.push(l); used.add(l.game); fams.add(l.fam); if (out.length === n) return out; } } return null; };
    const parlays = [["Safest 2 legs", pickLegs(2, 0.92)], ["Balanced 3 legs", pickLegs(3, 0.9)], ["Bigger 4 legs", pickLegs(4, 0.88)]].filter(([, l]) => l);
    const pr = (l) => l.reduce((s2, x) => s2 * x.p, 1), hr = (l) => l.reduce((s2, x) => s2 * ((x.hit?.rate ?? x.p * 100) / 100), 1);
    const sameGame = gids.flatMap((id) => (SIM[id]?.joint || []).slice(0, 2).map((j) => ({ ...j, game: id })));
    const dayName = (d) => fmtD(board.picks.find((p) => dayKey(p.date) === d).date, { weekday: "short", month: "short", day: "numeric" });
    app.innerHTML = `${labBack}<h1>Picks</h1>
      <p class="lead">Every player and team prop the simulation puts at 85% or more, with alternative lines and the reasons behind each: the projection, how it holds up in each simulated scenario, his strengths and weaknesses in tonight's spots, coach habits, and hot and cold zones. Times are PH time.</p>
      <div class="note"><b>Nothing here is 100%.</b> Questionable players and near-automatic low lines are left out of the suggested parlays. In the back-test, picks the simulation called 95%+ came true ${band95 ? `${esc(band95.happened)}%` : "about 94%"} of the time${band95 ? ` (${num(band95.n)} picks), so about 1 in ${Math.max(2, Math.round(100 / Math.max(0.5, 100 - band95.happened)))} still missed` : ""}. Player props came true a little less often than stated; team picks were close to stated. Statistical analysis only, not betting advice.</div>
      <div class="filters" role="group" aria-label="Day">${days.map((d) => `<button class="fbtn" type="button" data-pk-day="${esc(d)}" aria-pressed="${d === S.pkDay}">${esc(dayName(d))}</button>`).join("")}</div>
      <label class="small low-tog blend-tog"><input type="checkbox" data-blend-tog ${S.pkBlend ? "checked" : ""}> Show EV figures (expected value from our chance, and a market-blended version). Off by default: we compare lines and our record, not profit.</label>
      <div class="filters" role="group" aria-label="Prop type">${[["main", "Main lines"], ["top", "85%+ picks"], ["player", "Player props"], ["team", "Team props"], ["parlay", "Parlays"]].map(([k, l]) => `<button class="fbtn" type="button" data-pk-kind="${k}" aria-pressed="${S.pkKind === k}">${l}</button>`).join("")}</div>
      ${S.pkKind === "main" ? (() => {
        const ml = mainLines(), flaggedML = ml.filter((x) => x.dv?.unexplained && x.p >= 0.55), shown = ml.filter((x) => x.p >= 0.55 && !x.dv?.unexplained).sort((a, b) => (b.gold - a.gold) || (b.qual - a.qual) || (b.p - a.p)).slice(0, 60);
        const gml = gameMain();
        const gcard = (x) => `<div class="card pick ml${x.gold ? " gold" : ""}" data-gs="g|${esc(x.gid)}|${esc(x.kind)}">${x.gold ? `<div class="gold-tag">★ Worth a look: edge + odds ${esc(x.dec.toFixed(2))} + ${pct(x.p)} to hit</div>` : ""}<div class="pick-h">${teamLogo(x.home, { size: "sm" })}<span><b>${esc(x.kind)}</b><span class="small muted"> ${esc(T(x.away).abbr)} at ${esc(T(x.home).abbr)}</span></span><span class="pick-p">${pct(x.p)}</span></div>
          <span class="conf ${x.p >= 0.65 ? "nc" : ""}">${x.p >= 0.7 ? "strong lean" : x.p >= 0.6 ? "lean" : x.p >= 0.53 ? "slight lean" : "coin-flip"}</span>${meter(x.p)}
          <div class="pick-l"><b>${esc(x.pick)}</b> <span class="small muted">at the sportsbook main line</span></div>
          ${(() => { const gm3 = GAME[x.gid], ob = ODDS?.games?.[x.gid]; if (!gm3) return ""; const H3 = T(gm3.home).abbr, A3 = T(gm3.away).abbr, om = gm3.pred.hs - gm3.pred.as, ot = gm3.pred.hs + gm3.pred.as;
            const ours = x.kind === "Total" ? `total ${f1(ot)}` : `${om >= 0 ? H3 : A3} −${f1(Math.abs(om))}`;
            const oursP = x.kind === "Moneyline" ? ` · ${esc(x.pick.replace(" to win", ""))} ${pct(x.p)} · fair odds ${(1 / x.p).toFixed(2)}` : ` · our side ${pct(x.p)} · fair odds ${(1 / x.p).toFixed(2)}`;
            const main = !ob ? "not posted yet" : x.kind === "Total" ? `total ${ob.total} · over ${decOdds(ob.overOdds)} / under ${decOdds(ob.underOdds)}` : x.kind === "Spread" ? `${H3} ${ob.spreadHome > 0 ? "+" : ""}${ob.spreadHome} · ${decOdds(ob.spreadOddsHome)} / ${A3} ${decOdds(ob.spreadOddsAway)}` : `${H3} ${decOdds(ob.mlHome)} / ${A3} ${decOdds(ob.mlAway)} (line ${H3} ${ob.spreadHome > 0 ? "+" : ""}${ob.spreadHome})`;
            const gap = !ob ? null : x.kind === "Total" ? Math.abs(ot - ob.total) : Math.abs(om - -ob.spreadHome);
            return `<div class="ol-box"><div><span class="ol-k">Our line</span> <b>${esc(ours)}${oursP}</b></div><div class="ref"><span class="ol-k mkt">Main line</span> ${esc(main)}${ob?.fetched ? ` <span class="muted">(as of ${esc(new Date(ob.fetched).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }))} PH)</span>` : ""}</div>${gap != null ? `<div class="small muted">Difference: ${f1(gap)} points. ${esc(discLabel(PTREC, x.kind === "Total" ? "total" : "spread", gap))}</div>` : ""}</div>`; })()}
          <div class="pick-alt"><span>${esc(x.ours)}</span>${x.book != null ? `<span>book's fair chance ${pct(x.book)}</span>` : ""}<span class="${x.book != null && x.p - x.book >= 0.05 ? "up" : ""}">gap ${x.book != null ? (x.p - x.book > 0 ? "+" : "") + Math.round((x.p - x.book) * 100) : "-"}</span>${x.price != null ? `<span>odds ${esc(decOdds(x.price))}</span>` : ""}${S.pkBlend && x.ev != null ? `<span class="${x.ev > 0 ? "up" : "down"}">EV ${x.ev > 0 ? "+" : ""}${(x.ev * 100).toFixed(1)}%</span>` : ""}${S.pkBlend && x.book != null && decOdds(x.price) !== "-" ? `<span class="blend-ev">market-blended EV ${(() => { const v = (0.3 * x.p + 0.7 * x.book) * Number(decOdds(x.price)) - 1; return (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%"; })()}</span>` : ""}</div>
          ${x.hold != null ? `<div class="small">Scenario check: our side is ahead in <b>${pct(x.hold)}</b> of the game scripts (likelihood-weighted; the scripts overlap, so this is a robustness check, not a probability)${x.libFor || x.libAgainst ? ` · scenario library: ${x.libFor} for, ${x.libAgainst} against` : ""}</div>` : ""}
          <div class="small ${x.qual ? "qual" : "muted"}">${x.wrong ? `⚠ Big difference: our chance is ${Math.round(Math.abs(x.gap) * 100)} percentage points from the bookmaker's${x.mgap != null ? ` (${f1(Math.abs(x.mgap))} points apart on the line)` : ""}. Check the latest injury news first.` : x.qual ? "✓ Meaningful difference: our chance is 3-10 percentage points above the bookmaker's, at a price worth it by our numbers." : "Small difference at this price."}</div>
          ${x.mgap != null && Math.abs(x.mgap) >= 6 ? `<div class="small" style="color:var(--warn)">⚠ Our margin differs from the bookmaker's by ${f1(Math.abs(x.mgap))} points. Check the latest injury report before trusting our number.</div>` : ""}
          ${gameWhy(x)}
          <div class="pick-m small muted">${x.date ? esc(timePH(x.date)) + " · " : ""}<a href="#/game/${esc(x.gid)}">Game page ›</a></div></div>`;
        const card = (x) => `<div class="card pick ml${x.gold ? " gold" : ""}" data-gs="p|${esc(x.gid)}|${esc(x.pl.id)}|${esc(x.fam)}">${x.gold ? `<div class="gold-tag">★ Worth a look: edge + odds ${esc(x.dec.toFixed(2))} + ${pct(x.p)} to hit</div>` : ""}<div class="pick-h">${avatar(x.pl.id, x.pl.n, { size: "sm" })}<span><b>${esc(x.pl.n)}</b><span class="small muted"> ${esc(T(x.pl.side === 0 ? x.home : x.away).abbr || "")} · ${esc(x.word)}</span></span><span class="pick-p">${pct(x.p)}</span></div>
          <span class="conf ${x.p >= 0.65 ? "nc" : ""}">${x.p >= 0.7 ? "strong lean" : x.p >= 0.62 ? "lean" : "slight lean"}</span>${meter(x.p)}
          <div class="pick-l"><b>${x.over ? "Over" : "Under"} ${esc(x.line)} ${esc(x.word)}</b> <span class="small ${x.src === "est" ? "est-tag" : "muted"}">${x.src === "est" ? `our pick at his average (${f1(x.estAvg)}: this season blended with last while this season is short) · bookmaker line not posted yet` : "sportsbook main line"}</span></div>
          <div class="ol-box"><div><span class="ol-k">Our line</span> median ${esc(x.median ?? "-")} · ${x.over ? "over" : "under"} ${esc(x.line)} ${pct(x.p)} · fair odds ${(1 / x.p).toFixed(2)}</div>${x.bk ? `<div><span class="ol-k mkt">Main line</span> ${esc(x.bk)}</div>` : `<div><span class="ol-k mkt">Main line</span> not posted yet</div>`}</div>
          ${x.price != null ? `<div class="pick-alt"><span>odds ${esc(decOdds(x.price))}</span><span>book's fair chance ${pct(x.book)}</span><span class="${(x.gap ?? 0) >= 0.05 ? "up" : ""}">gap ${(x.gap > 0 ? "+" : "") + Math.round(x.gap * 100)}</span>${S.pkBlend && x.ev != null ? `<span class="${x.ev > 0 ? "up" : "down"}">EV ${x.ev > 0 ? "+" : ""}${(x.ev * 100).toFixed(1)}%</span>` : ""}${S.pkBlend && x.book != null && decOdds(x.price) !== "-" ? `<span class="blend-ev">market-blended EV ${(() => { const v = (0.3 * x.p + 0.7 * x.book) * Number(decOdds(x.price)) - 1; return (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%"; })()}</span>` : ""}</div>` : ""}
          ${x.hold != null ? `<div class="small">Scenario check: his average is on our side in <b>${pct(x.hold)}</b> of the game scripts (likelihood-weighted robustness check, not a probability)</div>` : ""}
          ${x.price != null ? `<div class="small ${x.qual ? "qual" : "muted"}">${x.wrong ? `⚠ Big difference: ${Math.round(Math.abs(x.gap) * 100)} percentage points from the bookmaker's chance. Check the latest news first.` : x.qual ? "✓ Meaningful difference (3-10 percentage points above the bookmaker)." : "No qualifying edge at this price."}</div>` : ""}
          <div class="pick-alt"><span>Our median ${esc(x.median ?? "-")}${x.mean != null ? ` · average ${f1(x.mean)}` : ""}</span>${x.thr.map(([t, q]) => `<span>${esc(t)}+: ${pct(q)}</span>`).join("")}</div>
          ${x.dv ? `<div class="small" style="color:${x.dv.unexplained ? "var(--warn)" : "inherit"}">${x.dv.unexplained ? "⚠ Check this one:" : "Note:"} we project ${f1(x.dv.proj)} vs his average ${f1(x.dv.avg)} ${esc(x.dv.basis)} (${x.dv.dev > 0 ? "+" : ""}${Math.round(x.dv.dev * 100)}%). ${x.dv.unexplained ? "No injury, minutes or role reason explains a gap this size, so it is kept out of gold picks, 85%+ lists and parlays." : `Reason: ${esc(x.dv.reasons.join(", "))}.`}</div>` : ""}
          ${propWhy(x)}
          <div class="pick-m small muted">${esc(T(x.away).abbr)} at ${esc(T(x.home).abbr)}${x.date ? ` · ${esc(timePH(x.date))}` : ""} · <a href="#/game/${esc(x.gid)}">Game page ›</a></div></div>`;
        return `${gml.some((x) => x.gold) || ml.some((x) => x.gold) ? `<div class="gold-strip"><b>★ Gold picks</b>${gml.filter((x) => x.gold).map((x) => `<details class="gs-i"><summary><span>${esc(x.pick)}</span> <i>${esc(T(x.away).abbr)}@${esc(T(x.home).abbr)} · odds ${esc(x.dec.toFixed(2))} · ${pct(x.p)} · robust in ${pct(x.hold)} of scripts</i></summary><p class="small">${goldGameSum(x)}</p><a class="go small" href="#/game/${esc(x.gid)}">Game page ›</a> <button class="btn sm" type="button" data-gs-go="g|${esc(x.gid)}|${esc(x.kind)}">Full analysis ›</button></details>`).join("")}${ml.filter((x) => x.gold).slice(0, 12).map((x) => `<details class="gs-i"><summary><span>${esc(shortName(x.pl.n))} ${x.over ? "over" : "under"} ${esc(x.line)} ${esc(x.word)}</span> <i>odds ${esc(x.dec.toFixed(2))} · ${pct(x.p)} · robust in ${pct(x.hold)} of scripts</i></summary><p class="small">${goldPropSum(x)}</p><a class="go small" href="#/game/${esc(x.gid)}">Game page ›</a> <button class="btn sm" type="button" data-gs-go="p|${esc(x.gid)}|${esc(x.pl.id)}|${esc(x.fam)}">Full analysis ›</button></details>`).join("")}<span class="small muted">Gold = our chance 3-10 points above the bookmaker's main line at a price that is worth it by our numbers, decimal odds 1.60+, our chance 55%+, robust in 60%+ of the game scripts and tonight's scenario library not against it. Statistical comparison, not betting advice.</span></div>` : `<div class="note small">No gold picks on this day: nothing combines a meaningful difference (3-10 points), odds of 1.60+, a 55%+ chance and support across our scenarios.</div>`}
          <h2 class="pk-sec">Game lines</h2>
          ${gml.length && !gml.some((x) => x.qual) ? `<div class="note"><b>No qualifying edge today.</b> On every game line our chance is within 5 points of the bookmaker's fair chance or the expected value is under +3%. A high chance alone is not an edge.</div>` : ""}
          ${gml.length ? gml.map(gcard).join("") : `<p class="empty">No sportsbook game lines for this day yet (they usually post a day or two before).</p>`}
          <h2 class="pk-sec">Player props</h2><p class="small muted">Prices are compared as odds: our fair odds (1 ÷ our chance) against the offered odds. The bookmaker is a reference and never changes our numbers. A difference of 10+ percentage points in chance is flagged as a big difference, never as an edge. Expected-value figures appear only with the "Show EV figures" switch. Player prop prices come from the same bookmaker's pre-game prop feed; the over/under order is checked against its milestone prices. Statistical comparison, not betting advice.</p>
          <p class="small muted">Player props at the <b>sportsbook's main line</b> (the line you would actually see, e.g. 22.5 points), with our lean and our chance from 10,000 simulations. The book only sets which line is tested: our chance is our own model, never the odds. These sit between 55% and 75% because main lines are set close to even; that is normal. The chips show our chance at nearby lines.</p>
          ${shown.length ? shown.map(card).join("") : `<p class="empty">No player picks for this day yet: games that have started are left out (open the game's Live tab instead). Our own main line for every player is on each game page (Players tab).</p>`}
          ${flaggedML.length ? `<details class="more"><summary>⚠ ${flaggedML.length} flagged props kept out (projection 30%+ from the season average with no named reason)</summary><ul class="plain small">${flaggedML.map((x) => `<li>${esc(x.pl.n)}: ${x.over ? "over" : "under"} ${esc(x.line)} ${esc(x.word)} · we project ${f1(x.dv.proj)} vs his average ${f1(x.dv.avg)} (${x.dv.dev > 0 ? "+" : ""}${Math.round(x.dv.dev * 100)}%)</li>`).join("")}</ul><p class="small muted">These may be right (a role change we have not named) or a data problem. Check the news before trusting them.</p></details>` : ""}
          ${ml.length > shown.length + flaggedML.length ? `<p class="small muted">${ml.length - shown.length - flaggedML.length} more lines are close to 50/50 and left out.</p>` : ""}`;
      })()
      : S.pkKind !== "parlay" ? `<div class="filters" role="group" aria-label="Confidence">${[["all", "85% and up"], ["95", "Near-certain 95%+"], ["85", "85-94%"]].map(([k, l]) => `<button class="fbtn" type="button" data-pk-band="${k}" aria-pressed="${S.pkBand === k}">${l}</button>`).join("")}</div>
        <label class="small low-tog"><input type="checkbox" id="pk-low" ${S.pkLow ? "checked" : ""}> Include very safe lines (far below the player's main line, e.g. 10+ points when his line is 22.5)</label>
        <p class="small muted">${cards.length} ${cards.length === 1 ? "pick" : "picks"}. The big number is the chance adjusted for how often the simulation's figures really came true for that market in past games (the raw simulation figure is under it; player props run a few points over-confident, so they are pulled down). Tap a pick for why. "Alt" lines are other versions of the same prop.</p>
        ${cards.slice(0, 80).map(card).join("") || `<p class="empty">No picks in this filter.</p>`}${cards.length > 80 ? `<p class="small muted">Showing the 80 strongest of ${cards.length}.</p>` : ""}`
      : `<p class="small muted">Built only from legs in different games, so the legs do not depend on each other and the combined chance is multiplied. "Using past hit rates" multiplies how often picks in each leg's band really came true, which is the more honest number. Same-game combinations are listed separately, counted directly from the simulations.</p>
        ${parlays.map(([name, l]) => `<div class="card"><h2>${esc(name)}</h2><ol class="dots">${l.map((x) => `<li>${esc(x.label)} <span class="muted">(${esc(T(x.away).abbr)} at ${esc(T(x.home).abbr)}, ${pct(x.p)}; past rate ${x.hit?.rate != null ? esc(x.hit.rate) + "%" : "-"})</span></li>`).join("")}</ol>
          <div class="statgrid" style="grid-template-columns:repeat(2,1fr)"><div class="stat"><b>${pct(pr(l))}</b><span>Adjusted chance</span></div><div class="stat"><b>${pct(hr(l))}</b><span>Using past hit rates</span></div></div></div>`).join("") || `<p class="empty">Not enough strong legs (88%+ after adjustment, no questionable players, no low lines) in separate games on this day.</p>`}
        ${sameGame.length ? `<div class="card"><h2>Same-game combinations</h2><p class="small muted">These legs are linked (a team win and its star scoring big tend to go together), so their chance is counted directly from the 10,000 simulated games, never multiplied.</p><ul class="plain">${sameGame.map((j) => `<li class="spread"><span>${esc(j.label)} <span class="muted">(${esc(T(GAME[j.game]?.away).abbr)} at ${esc(T(GAME[j.game]?.home).abbr)})</span></span><span class="num">${pct(j.p)} <span class="muted">vs ${pct(j.ifUnrelated)} if unrelated</span></span></li>`).join("")}</ul></div>` : ""}`}`;
    app.querySelectorAll("[data-pk-day]").forEach((b) => b.addEventListener("click", () => { S.pkDay = b.dataset.pkDay; route(); }));
    app.querySelectorAll("[data-pk-kind]").forEach((b) => b.addEventListener("click", () => { S.pkKind = b.dataset.pkKind; draw(); }));
    app.querySelectorAll("[data-gs-go]").forEach((b) => b.addEventListener("click", () => { const c = app.querySelector(`[data-gs="${b.dataset.gsGo}"]`); if (!c) return; c.querySelector(".gw-more")?.setAttribute("open", ""); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 80, behavior: "auto" }); }));
    app.querySelector("[data-blend-tog]")?.addEventListener("change", (e) => { S.pkBlend = e.target.checked; try { localStorage.setItem("pkBlend", S.pkBlend ? "1" : ""); } catch { /* */ } draw(); });
    app.querySelectorAll("[data-pk-band]").forEach((b) => b.addEventListener("click", () => { S.pkBand = b.dataset.pkBand; draw(); }));
    document.getElementById("pk-low")?.addEventListener("change", (e) => { S.pkLow = e.target.checked; draw(); });
  };
  draw();
}


// ================================================================ Skills vs skills
// A player's scoring skills (NBA.com play types, drives, shot styles, NBA 2K27 archetype and badges)
// against the opponent's defence on those same skills (play-type defence rank, zone defence, and the
// defenders who actually guard him). Filled in when a player's details are opened.
const SKILLS = [
  { id: "slasher", label: "Slasher / rim attacker", pt: ["Cut"], zone: "rim", badge: /layup|posteriz|rise up|aerial|float|physical finisher|paint prodigy|slithery|acrobat|giant slayer/i },
  { id: "pnr", label: "Pick-and-roll creator", pt: ["PRBallHandler"], badge: /handles|ankle|dimer|lightning|strong handle|break starter|unpluckable|bail out/i },
  { id: "iso", label: "Isolation scorer", pt: ["Isolation"], badge: /ankle|shifty|space creator|handles|lightning/i },
  { id: "shooter", label: "Spot-up / off-screen shooter", pt: ["Spotup", "OffScreen"], zone: "atb", badge: /deadeye|limitless|mini marksman|set shot|shifty shooter|catch|corner|arc cadence/i },
  { id: "post", label: "Post scorer", pt: ["Postup"], badge: /post|hook|dropstep|paint prodigy/i },
  { id: "roll", label: "Roll man / rim runner", pt: ["PRRollman"], zone: "rim", badge: /posteriz|rise up|aerial|physical finisher/i },
  { id: "trans", label: "Transition attacker", pt: ["Transition"], badge: /break starter|lightning|posteriz|layup/i },
  { id: "glass", label: "Putbacks / offensive glass", pt: ["OffRebound"], badge: /rebound|boxout/i },
];
const DEF_BADGE = /challenger|glove|interceptor|denier|enforcer|pest|menace|patroller|pick dodger|lockdown|anchor|boxout|rebound chaser|clamps|rim protector/i;
const TIER = { hof: "Hall of Fame", gold: "Gold", silver: "Silver", bronze: "Bronze", legend: "Legend" };
function defRankOf(tid, ptId) {
  const rows = S.teams.map((t) => ({ tid: t.id, r: t.playTypes?.def?.find((x) => x.id === ptId) })).filter((x) => x.r?.ppp != null).sort((a, b) => a.r.ppp - b.r.ppp);
  const i = rows.findIndex((x) => x.tid === tid);
  return i < 0 ? null : { rank: i + 1, of: rows.length, ppp: rows[i].r.ppp, pctile: rows[i].r.pctile, avg: rows.reduce((s, x) => s + x.r.ppp, 0) / rows.length };
}
async function skillBlock(pid, oppTid) {
  let prof; try { prof = await load(`players/${pid}.json`); } catch { return `<p class="small muted">No skill profile for this player yet.</p>`; }
  const opp = S.T[oppTid] || {};
  const pt = prof.playstyle?.playTypes?.rows || [];
  const badges = prof.k2?.badges || [];
  const oz = Object.fromEntries((opp.zones?.def?.five || opp.zones?.def || []).map?.((z) => [z.id, z]) || []);
  const rows = [];
  for (const sk of SKILLS) {
    const mine = pt.filter((r) => sk.pt.includes(r.id) && r.poss >= 40);
    const freq = mine.reduce((s, r) => s + r.freq, 0);
    const bd = badges.filter(([n]) => sk.badge.test(n));
    const drives = sk.id === "slasher" ? prof.nba?.drives : null;
    const uses = freq >= (sk.id === "glass" ? 6 : 10) || (sk.id === "slasher" && drives >= 9);
    if (!uses) continue;
    const best = mine.sort((a, b) => b.poss - a.poss)[0];
    const d = best ? defRankOf(oppTid, best.id) : null;
    const zone = sk.zone ? oz[sk.zone] : null;
    // verdict: his skill level vs their defence of it
    const his = best?.pctile, theirs = d ? Math.round(100 - ((d.rank - 1) / Math.max(1, d.of - 1)) * 100) : null; // 100 = best defence
    let verdict = "Even matchup", k = 0;
    if (theirs != null && theirs <= 30 && (his == null || his >= 50)) { verdict = "Advantage for him"; k = 1; }
    else if (theirs != null && theirs >= 70 && (his == null || his <= 70)) { verdict = "Tough test"; k = -1; }
    else if (his != null && his >= 80 && theirs != null && theirs < 60) { verdict = "Advantage for him"; k = 1; }
    if (!d && zone?.diff != null) { if (zone.diff >= 2) { verdict = "Advantage for him"; k = 1; } else if (zone.diff <= -2) { verdict = "Tough test"; k = -1; } }
    rows.push(`<li class="sk ${k > 0 ? "sk-up" : k < 0 ? "sk-down" : ""}"><div class="spread"><b>${esc(sk.label)}</b><span class="chip ${k > 0 ? "good" : k < 0 ? "bad" : ""}">${verdict}</span></div>
      <div class="small">${best ? `His ${esc(best.label.toLowerCase())}: ${f0(best.freq)}% of his plays, ${Number(best.ppp).toFixed(2)} points per play (${best.pctile != null ? `${esc(ord(best.pctile))} percentile` : "few plays"}, ${num(best.poss)} plays).` : ""}${drives ? ` ${f1(drives)} drives a game.` : ""}</div>
      ${d ? `<div class="small">${esc(opp.abbr || "")} allows ${Number(d.ppp).toFixed(2)} points per play on it (${esc(ord(d.rank))} best of ${d.of}; league average ${d.avg.toFixed(2)}).</div>` : ""}
      ${zone ? `<div class="small">${esc(opp.abbr || "")} ${sk.zone === "rim" ? "at the rim" : "on above-the-break threes"}: ${zone.tag && zone.tag !== "neutral" ? `<b>${esc(String(zone.tag).toUpperCase())}</b> ` : ""}${zone.pct != null ? `${p1(zone.pct)} allowed (league ${p1(zone.lgPct)})` : ""}.</div>` : ""}
      ${bd.length ? `<div class="small muted">2K27 badges: ${bd.slice(0, 4).map(([n, t]) => `${esc(n)} (${esc(TIER[t] || t)})`).join(", ")}</div>` : ""}</li>`);
  }
  // Who guards him on this team, with their defensive skills.
  const defs = (prof.guardedBy?.rows || []).filter((r) => r.team === oppTid).slice(0, 3);
  const defHtml = [];
  for (const r of defs) {
    let dp = null; try { dp = await load(`players/${r.id}.json`); } catch { /* no profile */ }
    const db = (dp?.k2?.badges || []).filter(([n]) => DEF_BADGE.test(n));
    defHtml.push(`<li class="spread"><span>${avatar(r.id, r.n, { size: "xs" })} ${esc(r.n)} <span class="muted">(${f0(r.share)}% of his possessions vs ${esc(opp.abbr || "")}, ${num(r.poss)} poss)</span>${dp?.k2?.attrs ? `<br><span class="small muted">2K perimeter D ${f0(dp.k2.attrs.perD)}, interior D ${f0(dp.k2.attrs.intD)}${db.length ? ` · ${db.slice(0, 3).map(([n, t]) => `${esc(n)} (${esc(TIER[t] || t)})`).join(", ")}` : ""}</span>` : ""}</span><span class="num ${cls(-(r.vsExp100 ?? 0))}">${r.per100 != null ? `${f1(r.per100)} pts/100` : ""}${r.vsExp100 != null ? `<br><span class="small">${sg(r.vsExp100)} vs usual</span>` : ""}</span></li>`);
  }
  return `<h4>Skills vs skills against ${esc(opp.abbr || "")}</h4>
    ${rows.length ? `<ul class="plain sk-list">${rows.join("")}</ul>` : `<p class="small muted">No scoring skill with enough plays to compare.</p>`}
    ${defHtml.length ? `<h4>Who guards him on ${esc(opp.abbr || "")} (NBA.com tracking)</h4><ul class="plain">${defHtml.join("")}</ul>` : ""}
    <p class="small muted">Skills from NBA.com play types (${esc(prof.playstyle?.playTypes?.season || "last season")}), drives and the unofficial NBA 2K27 dataset. Defence ranks are by points per play allowed, best first.</p>`;
}
const skillSlot = (pid, oppTid) => `<div class="skill-slot" data-skill-pid="${esc(pid)}" data-skill-opp="${esc(oppTid)}"><p class="small muted">Loading skills vs skills...</p></div>`;
// Fill a slot the first time its details panel is opened (toggle does not bubble: listen in the capture phase).
app.addEventListener("toggle", async (e) => {
  if (!e.target.open) return;
  for (const slot of e.target.querySelectorAll(".skill-slot:not([data-done])")) {
    slot.dataset.done = "1";
    try { slot.innerHTML = await skillBlock(slot.dataset.skillPid, slot.dataset.skillOpp); } catch { slot.innerHTML = `<p class="small muted">Could not load skills for this player.</p>`; }
  }
}, true);


// ---- Game page tabs: the page is long, so it is split the way sports apps do it.
const GAME_TABS = [["ov", "Overview"], ["lv", "Live"], ["pl", "Players"], ["mu", "Matchup"], ["si", "Simulation"]];
// Live tab state for the current game: "pre" (not started), "in" (in progress) or "post" (finished).
function liveStateOf(g) { const t0 = Date.parse(g?.date || ""); if (!g || !t0) return "pre"; const lv = (S.liveData?.games || []).find((x) => x.id === g.id); if (lv) return lv.state === "in" ? "in" : lv.state === "post" ? "post" : "pre"; return Date.now() < t0 ? "pre" : Date.now() < t0 + 3.5 * 3600000 ? "in" : "post"; }
function livePlaceholder(g) {
  const st = liveStateOf(g);
  const tip = new Date(g.date).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `<div class="card live-ph" id="live-engine" data-tab-of="lv">${st === "pre" ? `<h2>Live predictions start at tip-off</h2><p>Tip-off: <b>${esc(tip)}</b> (${PHT}). Once the game starts this tab updates every 5 seconds with:</p>
    <ul class="dots small"><li>Live win chance, moneyline and handicap (spread)</li><li>Quarter-by-quarter and half predictions, with who wins each quarter</li><li>Live game total and team totals, with over/under chances</li><li>Every player's live stat line and projected finish (points, rebounds, assists, threes, PRA)</li><li>Tonight's scenarios checked against what is happening, plus live situation reads</li><li>Live sportsbook odds next to our numbers, with the pre-game baselines</li></ul>
    <p class="small muted">Everything starts from our pre-game analysis (scenario library, matchups, absences, coach and blowout habits) and then updates from the live score, clock, pace and box score.</p>` : `<h2>Loading live data…</h2><p class="small muted">Getting the latest score and box score from ESPN.</p>`}</div>`;
}
function gameTabOf(el) {
  const id = el.id || "", h = ((el.querySelector && el.querySelector("h2")) || {}).innerText || "";
  if (el.matches?.(".hero")) return "ov";
  if (el.matches?.(".back, .gbar, h1, .jumpnav, .gtabs, .bottom-line")) return "all";
  if (el.dataset?.tabOf) return el.dataset.tabOf;
  if (["g-who", "g-players"].includes(id) || /player projections|What if a player sits/i.test(h)) return "pl";
  if (["g-keys", "g-scn", "g-h2h"].includes(id) || /zone battle|Latest coverage/i.test(h) || el.matches?.(".grid.two")) return "mu";
  return "ov";
}
function bottomLine() {
  const g = S.curGame; if (!g) return "";
  const home = g.teams.find((t) => t.isHome), away = g.teams.find((t) => !t.isHome);
  const fav = g.pred.pHome >= 0.5 ? home : away, favP = Math.max(g.pred.pHome, 1 - g.pred.pHome);
  const L = gameLines(g);
  const reasons = (tid) => ((g.keys?.teams || []).find((x) => x.tid === tid)?.win || []).filter((w) => typeof w !== "string" && w.kind !== "ratings").slice().sort((a, b) => (b.w || 0) - (a.w || 0)).slice(0, 3);
  const reason = (tid) => reasons(tid).map((w) => `${briefReason(w.t || w.txt || "")}${w.w != null ? ` (${f1(w.w)} pts)` : ""}`).join("; ");
  const out = g.teams.flatMap((t) => (t.out || []).filter((o) => o.star).map((o) => o.n));
  const top = g.teams.map((t) => t.players?.[0]).filter(Boolean);
  return `<div class="card bottom-line"><h2>The bottom line</h2><div class="bl-grid"><div class="viz-slot"></div><div class="bl-side">${edgesChart(g)}${quarterChart(g)}</div></div>${takeawayCard(g)}
    <p class="bl-main"><b>${esc(T(fav.tid).name)}</b> win ${pct(favP)} of the time by our numbers. Spread ${esc(T(L.fav).abbr)} ${spreadTxt(L.spread)}, total ${L.total.toFixed(1)}.</p>
    <ul class="dots small">
      ${[fav, fav === home ? away : home].map((t) => reason(t.tid) ? `<li><b>${t === fav ? `Why ${esc(T(t.tid).abbr)} is favoured` : `How ${esc(T(t.tid).abbr)} can win`}:</b> ${esc(reason(t.tid))}</li>` : (t !== fav ? `<li><b>How ${esc(T(t.tid).abbr)} can win:</b> no edge larger than half a point; an upset would come from shooting variance or late news.</li>` : "")).join("")}
      ${top.length ? `<li>Top scorers: ${top.map((p) => `${esc(p.n)} ${f0(p.pts)} pts`).join(", ")}</li>` : ""}
      ${out.length ? `<li>Key absences: ${esc(out.join(", "))}</li>` : ""}
    </ul></div>`;
}
function gameTabs() {
  const kids = [...app.children];
  if (!kids.length || app.querySelector(".gtabs")) return;
  const hero = app.querySelector(".hero");
  const bar = document.createElement("div");
  bar.className = "gtabs"; bar.setAttribute("role", "tablist"); bar.setAttribute("aria-label", "Game sections");
  const gid = S.curGame?.id;
const lst = liveStateOf(S.curGame);
  bar.innerHTML = GAME_TABS.map(([k, l]) => `<button class="gtab${k === "lv" ? " gtab-live " + lst : ""}" type="button" role="tab" data-gt="${k}">${k === "lv" && lst === "in" ? '<span class="lv-dot" aria-hidden="true"></span>' : ""}${l}</button>`).join("") ;
  if (lst === "in" && S.liveTabFor !== gid) { S.gTab = "lv"; S.liveTabFor = gid; }
  (app.querySelector(".gbar") || hero)?.insertAdjacentElement("afterend", bar);
hero?.insertAdjacentHTML("afterend", bottomLine());
  if (S.curGame && !app.querySelector("#live-engine")) hero?.insertAdjacentHTML("afterend", livePlaceholder(S.curGame));
  const jn = app.querySelector(".jumpnav"); if (jn) jn.hidden = true;
  const show = (k) => {
    S.gTab = k;
    for (const el of app.children) { const t = gameTabOf(el); if (t !== "all") el.hidden = t !== k; }
    const bl = app.querySelector(".bottom-line"); if (bl) bl.hidden = k !== "ov";
    bar.querySelectorAll("[data-gt]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.gt === k)));
  };
  bar.addEventListener("click", (e) => { const b = e.target.closest("[data-gt]"); if (!b) return; show(b.dataset.gt); bar.scrollIntoView({ block: "start" }); window.scrollBy(0, -64); });
  show(S.gTab || "ov");
  const g = S.curGame;
  if (g) {
    load(`sim/${g.id}.json`).then((sim) => {
      if (S.curGame !== g) return;
      sim = simAdjust(sim, g, S.curRaw);
      Promise.all([load("board.json").catch(() => null), load("odds.json").catch(() => null), load("pretip.json").catch(() => null)]).then(([board, oddsAll, ptAll]) => { S.oddsAll = oddsAll; S.ptRec = discRecord(ptAll, oddsAll); if (S.curGame !== g || app.querySelector(".preds")) return; const bl = app.querySelector(".bottom-line"); if (!bl) return; bl.insertAdjacentHTML("beforebegin", predictionsCard(g, sim, board)); const pc = bl.previousElementSibling; if (pc) pc.hidden = (S.gTab || "ov") !== "ov"; });
const slot = app.querySelector(".bottom-line .viz-slot"); if (slot) slot.innerHTML = marginChart(g, sim);
      flipCard(g, sim, S.curRaw).then((html) => { if (!html || S.curGame !== g || app.querySelector(".flip")) return; const bl = app.querySelector(".bottom-line"); if (!bl) return; bl.insertAdjacentHTML("afterend", html); const fc = bl.nextElementSibling; if (fc) fc.hidden = (S.gTab || "ov") !== "ov"; });
      const glance = [...app.children].find((el) => el.dataset?.tabOf === "pl");
      if (!app.querySelector("[data-tab-of=si]")) { app.insertAdjacentHTML("beforeend", `<div data-tab-of="si">${sim.adjusted ? `<div class="note"><b>Adjusted for: ${esc(sim.adjusted.join(", "))} out.</b> The 10,000 simulated games are shifted by the change in projected margin (${sg(sim.shift)} for the home team) and players' chances follow their new minutes. The full scenario lab updates at the next data refresh.</div>` : ""}${buildCard(g)}${universeCard(sim, g)}${donutCard(sim)}${simPlayersCard(sim, g)}${playingCard(S.curRaw, g, outsFor(g.id)).replace('id="g-who"', 'id="g-who-sim"')}<a class="btn block explore" href="#/sim/${esc(g.id)}">Explore all scenarios ›</a></div>`); const si = app.lastElementChild; si.hidden = (S.gTab || "ov") !== "si"; buildInit(g, S.curRaw); }
      if (glance) { glance.insertAdjacentHTML("afterend", insightCard(g, sim)); const ins = glance.nextElementSibling; if (ins) ins.hidden = (S.gTab || "ov") !== "pl"; }
    }, () => {});
    const keys = app.querySelector("#g-keys");
    if (keys && !app.querySelector("#mx")) {
      const opts = (t) => (t.players || []).filter((x) => x.min >= 10).map((x) => `<option value="${esc(x.id)}">${esc(x.n)} (${esc(T(t.tid).abbr)})</option>`).join("");
      keys.insertAdjacentHTML("beforebegin", `<section class="card" id="mx" data-tab-of="mu"><h2>Matchup explorer</h2><p class="small muted">Pick a player and the opponent guarding him: his projected line updates for that matchup.</p>
        <label class="small">Player</label><select class="field" id="mx-p">${g.teams.map(opts).join("")}</select>
        <label class="small">Guarded by</label><select class="field" id="mx-d"></select><div id="mx-out"></div></section>`);
      const mx = app.querySelector("#mx"); mx.hidden = (S.gTab || "ov") !== "mu";
      const fill = () => { const pid = app.querySelector("#mx-p").value, own = g.teams.find((t) => (t.players || []).some((x) => String(x.id) === pid)), opp = g.teams.find((t) => t !== own); app.querySelector("#mx-d").innerHTML = `<option value="">Team defence only</option>` + (opp.players || []).filter((x) => x.min >= 10).map((x) => `<option value="${esc(x.id)}">${esc(x.n)}</option>`).join(""); };
      const run = async () => {
        const pid = app.querySelector("#mx-p").value, did = app.querySelector("#mx-d").value, own = g.teams.find((t) => (t.players || []).some((x) => String(x.id) === pid)), opp = g.teams.find((t) => t !== own), me = own.players.find((x) => String(x.id) === pid);
        const [pf, df] = await Promise.all([load(`players/${pid}.json`).catch(() => null), did ? load(`players/${did}.json`).catch(() => null) : null]);
        const res = projVs(pid, own.tid, [opp.tid], df ? [df] : [], pf?.zones14?.rows);
        app.querySelector("#mx-out").innerHTML = projCard(res, `${me.n} vs ${df ? df.n : T(opp.tid).name}`) + `<p class="small"><b>Full-model projection for tonight:</b> ${f1(me.pts)} pts, ${f1(me.reb)} reb, ${f1(me.ast)} ast in ${f0(me.min)} minutes (includes rotation, absences and scenarios). <a href="#/scout/${esc(pid)}">Open his Versus page ›</a></p>`;
      };
      app.querySelector("#mx-p").addEventListener("change", () => { fill(); run(); }); app.querySelector("#mx-d").addEventListener("change", run); fill(); run();
    }
    if (keys) { keys.insertAdjacentHTML("beforebegin", matchupSummary(g)); const ms = keys.previousElementSibling; if (ms) ms.hidden = (S.gTab || "ov") !== "mu"; }
    const firstPlayers = [...app.children].find((el) => /player projections/i.test((el.querySelector?.("h2") || {}).innerText || ""));
    if (firstPlayers) {
      const box = document.createElement("div"); box.className = "card"; box.dataset.tabOf = "pl";
      box.innerHTML = `<h2>Projected points at a glance</h2>${twoColPoints(g)}<p class="small muted">Tap the Players tables below for minutes, rebounds, assists, threes and every reason.</p>`;
      (app.querySelector("#g-who") || firstPlayers).insertAdjacentElement("beforebegin", box);
      box.hidden = (S.gTab || "ov") !== "pl";
    }
  }
}


// ================================================================ At-a-glance charts (game page and picks)
// Away team = series colour 1, home team = series colour 2, always with a text legend, so colour is never the only cue.
function marginChart(g, sim) {
  const h = sim?.forecast?.margin?.hist; if (!h?.share?.length) return "";
  const W = 340, H = 120, padB = 22, padT = 8, n = h.share.length, bw = W / n, max = Math.max(...h.share);
  const away = T(g.away).abbr, home = T(g.home).abbr;
  const x0 = ((0 - h.from) / h.step) * bw;
  const bars = h.share.map((v, i) => {
    const mid = h.from + h.step * (i + 0.5), hh = (v / max) * (H - padB - padT);
    return `<rect x="${(i * bw + 0.6).toFixed(1)}" y="${(H - padB - hh).toFixed(1)}" width="${Math.max(1, bw - 1.2).toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" fill="var(${mid < 0 ? "--s1" : "--s2"})"><title>${esc(mid < 0 ? `${away} by ${Math.abs(Math.round(mid))}` : `${home} by ${Math.round(mid)}`)}: ${v}% of simulations</title></rect>`;
  }).join("");
  const med = sim.forecast.margin.median, xm = ((med - h.from) / h.step) * bw;
  return `<figure class="viz"><figcaption><b>Final margin distribution (10,000 sims)</b><span class="legend"><span><i style="background:var(--s1)"></i>${esc(away)} wins</span><span><i style="background:var(--s2)"></i>${esc(home)} wins</span></span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Final margin distribution: ${home} wins ${pct(sim.pHome)}, ${away} wins ${pct(1 - sim.pHome)}, most likely ${home} by ${med}`)}">
      ${bars}<line x1="${x0}" x2="${x0}" y1="${padT - 4}" y2="${H - padB}" class="axis"/><line x1="${xm}" x2="${xm}" y1="${padT - 4}" y2="${H - padB}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/>
      <text x="4" y="${H - 6}" class="vt">${esc(away)} by ${Math.abs(h.from)}+</text><text x="${x0}" y="${H - 6}" text-anchor="middle" class="vt">0</text><text x="${W - 4}" y="${H - 6}" text-anchor="end" class="vt">${esc(home)} by ${Math.abs(h.from)}+</text>
    </svg><p class="viz-k">Typical: ${esc(med >= 0 ? `${home} by ${med}` : `${away} by ${-med}`)} (dashed) · OT ${pct(sim.forecast.pOT)}</p></figure>`;
}
function quarterChart(g) {
  const a = g.teams.find((t) => !t.isHome), h = g.teams.find((t) => t.isHome);
  const qa = a?.quarters?.proj, qh = h?.quarters?.proj; if (!qa || !qh) return "";
  const W = 340, H = 110, padB = 20, max = Math.max(...qa, ...qh) * 1.12, gw = W / 4, bw = 22;
  const bar = (v, x, c) => { const hh = (v / max) * (H - padB - 14); return `<rect x="${x}" y="${H - padB - hh}" width="${bw}" height="${hh}" rx="3" fill="var(${c})"/><text x="${x + bw / 2}" y="${H - padB - hh - 4}" text-anchor="middle" class="vt vv">${f0(v)}</text>`; };
  return `<figure class="viz"><figcaption><b>Points by quarter</b><span class="legend"><span><i style="background:var(--s1)"></i>${esc(T(a.tid).abbr)}</span><span><i style="background:var(--s2)"></i>${esc(T(h.tid).abbr)}</span></span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Projected quarters: ${T(a.tid).abbr} ${qa.map(f0).join(", ")}; ${T(h.tid).abbr} ${qh.map(f0).join(", ")}`)}">
      ${[0, 1, 2, 3].map((q) => { const cx = gw * q + gw / 2; return bar(qa[q], cx - bw - 2, "--s1") + bar(qh[q], cx + 2, "--s2") + `<text x="${cx}" y="${H - 5}" text-anchor="middle" class="vt">Q${q + 1}</text>`; }).join("")}
      <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="axis"/>
    </svg></figure>`;
}
function edgesChart(g) {
  const ks = g.keys?.teams || []; if (!ks.length) return "";
  const a = ks.find((k) => k.tid === g.away), h = ks.find((k) => k.tid === g.home);
  const sum = (k) => (k?.win || []).reduce((s, x) => s + Math.min(1, x.w || 0), 0);
  const sa = sum(a), sh = sum(h), tot = sa + sh || 1;
  return `<figure class="viz"><figcaption><b>More edges</b></figcaption>
    <div class="tug" role="img" aria-label="${esc(`${T(g.away).abbr} ${a?.win?.length || 0} edges, ${T(g.home).abbr} ${h?.win?.length || 0} edges`)}"><span style="flex:${sa / tot};background:var(--s1)"></span><span style="flex:${sh / tot};background:var(--s2)"></span></div>
    <div class="tug-l"><span>${esc(T(g.away).abbr)}: ${a?.win?.length || 0} edges</span><span>${esc(T(g.home).abbr)}: ${h?.win?.length || 0} edges</span></div>
    <p class="viz-k">Weighted by strength of evidence. The Matchup tab lists every edge with its numbers.</p></figure>`;
}
function pointsChart(t) {
  const rows = (t.players || []).filter((p) => p.min >= 12).slice(0, 9);
  if (!rows.length) return "";
  const max = Math.max(...rows.map((p) => p.hi || p.pts)) * 1.05, W = 340, rh = 26, H = rows.length * rh + 18, lab = 104, w = W - lab - 34;
  const x = (v) => lab + (v / max) * w;
  return `<figure class="viz"><figcaption><b>${esc(T(t.tid).short)}: projected points</b><span class="legend"><span><i class="bar-k"></i>projection</span><span><i class="rng-k"></i>8-in-10 range</span></span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${T(t.tid).short} projected points: ${rows.map((p) => `${p.n} ${f1(p.pts)}`).join(", ")}`)}">
      ${rows.map((p, i) => { const y = i * rh + 6; return `<text x="0" y="${y + 13}" class="vt vn">${esc(shortName(p.n))}${p.q ? " (Q)" : ""}</text>
        <line x1="${x(p.lo ?? p.pts)}" x2="${x(p.hi ?? p.pts)}" y1="${y + 9}" y2="${y + 9}" stroke="var(--axis)" stroke-width="6" stroke-linecap="round"/>
        <rect x="${lab}" y="${y + 5}" width="${Math.max(2, x(p.pts) - lab)}" height="8" rx="4" fill="var(${t.isHome ? "--s2" : "--s1"})"/>
        <text x="${W}" y="${y + 13}" text-anchor="end" class="vt vv">${f1(p.pts)}</text>`; }).join("")}
    </svg></figure>`;
}
const meter = (p) => `<span class="meter" aria-hidden="true"><span style="width:${Math.round(Math.min(1, Math.max(0, p)) * 100)}%"></span></span>`;


// ================================================================ Redesign components (owner mockup)
function gameCardNew(g) {
  const lv = S.liveData?.games?.find((x) => x.id === g.id);
  const ph = g.pred.pHome, hFav = ph >= 0.5, L = gameLines(g);
  const out = [...(g.out?.[0] || []), ...(g.out?.[1] || [])];
  const flag = outsFor(g.id).size ? `<div class="gc-x"><span class="chip bad">You marked ${outsFor(g.id).size} out: open for adjusted numbers</span></div>` : g.upset?.flag ? `<div class="gc-x"><span class="chip warn">⚠ Upset watch</span></div>` : "";
  const top = [g.top?.[1]?.[0], g.top?.[0]?.[0]].filter(Boolean).map((p) => `${esc(shortName(p.n))} ${f0(p.pts)}`).join(" · ");
  return `<a class="card gc" href="#/game/${esc(g.id)}">
    <div class="gc-h">${teamLogo(g.away, { size: "lg" })}<div class="gc-m"><b>${esc(T(g.away).abbr)} @ ${esc(T(g.home).abbr)}</b><span>${esc(timePH(g.date))}</span></div>${teamLogo(g.home, { size: "lg" })}</div>
    <div class="gc-p"><div class="${hFav ? "" : "fav"}"><small>${esc(T(g.away).abbr)}</small><strong>${100 - Math.round(ph * 100)}%</strong></div><div class="${hFav ? "fav" : ""}"><small>${esc(T(g.home).abbr)}</small><strong>${Math.round(ph * 100)}%</strong></div></div>
    <div class="gc-bar" aria-hidden="true"><span style="flex:${1 - ph};background:var(--s1)"></span><span style="flex:${ph};background:var(--s2)"></span></div>
    <div class="gc-f"><span>O/U ${L.total.toFixed(1)}</span><span>${esc(T(L.fav).abbr)} ${spreadTxt(L.spread)}</span><span>Proj ${f0(g.pred.as)}-${f0(g.pred.hs)}</span><span aria-hidden="true">›</span></div>
    ${liveBadge(lv)}
    <div class="gc-x gc-ess"><span class="chip ${Math.max(ph, 1 - ph) >= 0.7 ? "good" : Math.max(ph, 1 - ph) >= 0.58 ? "" : "warn"}">Confidence: ${Math.max(ph, 1 - ph) >= 0.7 ? "high" : Math.max(ph, 1 - ph) >= 0.58 ? "medium" : "low (near coin-flip)"}</span>${out.length ? `<span class="gc-out">🚑 Out: ${esc(out.slice(0, 4).join(", "))}${out.length > 4 ? ` +${out.length - 4}` : ""}</span>` : `<span class="muted">No key absences listed</span>`}</div>
    ${top ? `<div class="gc-x">Top scorers: ${top}</div>` : ""}${flag}
  </a>`;
}
// What could change the prediction: every line comes from the model or the 10,000 simulations.
async function flipCard(g, sim, raw) {
  const H = T(g.home).abbr, A = T(g.away).abbr, fav = g.pred.pHome >= 0.5 ? "h" : "a", favT = fav === "h" ? H : A, dogT = fav === "h" ? A : H;
  const pFav = (ph) => (fav === "h" ? ph : 1 - ph), now = pFav(g.pred.pHome);
  const items = [];
  // late scratches: re-run the projection without each team's two biggest scorers
  for (const t of g.teams) {
    for (const p of (t.players || []).filter((x) => x.min >= 24 && !x.q).sort((a, b) => b.pts - a.pts).slice(0, 2)) {
      try { const g2 = await adjustGame(raw, new Set([String(p.id)])); const p2 = pFav(g2.pred.pHome);
        if (Math.abs(p2 - now) >= 0.03) items.push({ k: "scratch", w: Math.abs(p2 - now), t: `If <b>${esc(p.n)}</b> (${esc(T(t.tid).abbr)}) is a late scratch: ${esc(favT)} ${pct(now)} → <b>${pct(p2)}</b>` }); } catch { /* skip */ }
    }
  }
  // questionable players: projected as if they play
  for (const t of g.teams) for (const p of (t.players || []).filter((x) => x.q && x.min >= 15)) {
    try { const g2 = await adjustGame(raw, new Set([String(p.id)])); const p2 = pFav(g2.pred.pHome);
      items.push({ k: "q", w: 0.5 + Math.abs(p2 - now), t: `<b>${esc(p.n)}</b> (${esc(T(t.tid).abbr)}) is questionable and projected to play; if he sits, ${esc(favT)} ${pct(now)} → <b>${pct(p2)}</b>` }); } catch { /* skip */ }
  }
  // game scripts straight from the simulations
  const sc = Object.fromEntries((sim?.scenarios || []).map((x) => [x.id, x]));
  const dogK = fav === "h" ? "A" : "H", favK = fav === "h" ? "H" : "A";
  const scen = (id, text) => { const x = sc[id]; if (!x || x.freq < 0.02 || x.pHome == null) return; const p2 = pFav(x.pHome); if (Math.abs(p2 - now) < 0.05) return; items.push({ k: "sim", w: Math.abs(p2 - now) * Math.sqrt(x.freq), t: `${text} (happens in ${pct(x.freq)} of simulations): ${esc(favT)} wins <b>${pct(p2)}</b>${x.margin != null ? `, average margin ${x.margin >= 0 ? esc(H) : esc(A)} by ${f1(Math.abs(x.margin))}` : ""}${x.total != null ? `, total ${f0(x.total)}` : ""}` }); };
  scen(`hot${dogK}`, `${esc(dogT)} shoots well above expectation`);
  scen(`cold${favK}`, `${esc(favT)} shoots well below expectation`);
  scen(`inj${favK}`, `A ${esc(favT)} key player leaves injured`);
  scen(`foul${favK}`, `${esc(favT)} foul trouble (a top-5 player reaches 5 fouls)`);
  scen(`rot${favK}`, `${esc(favT)} rotation surprise (a 10+ minute player sits or plays 10+ more)`);
  if (!items.length) return "";
  items.sort((a, b) => b.w - a.w);
  return `<div class="card flip" data-tab-of="ov"><h2>What could change this prediction?</h2>
    <ul class="dots">${items.slice(0, 6).map((x) => `<li>${x.t}</li>`).join("")}</ul>
    <p class="small muted">Scratches re-run our projection without that player (minutes and shots go to his teammates). Game scripts are counted from the 10,000 simulated games. Nothing here uses betting odds.</p></div>`;
}
// Every version of the game the simulations produced, with how likely it is and who gains or loses.
function universeCard(sim, g) {
  const list = (sim?.scenarios || []).filter((x) => x.freq >= 0.01).sort((a, b) => b.freq - a.freq);
  if (!list.length) return "";
  const H = T(g.home).abbr, A = T(g.away).abbr, F = sim.forecast || {};
  const who = (arr, sign) => (arr || []).slice(0, 2).map((p) => `${esc(shortName(p.n))} ${sign}${f1(Math.abs(p.pts))}`).join(", ");
  const row = (x) => `<details class="uv"><summary><span class="uv-n">${esc(x.label.replace(/\s*\(.*\)\s*$/, ""))}</span><span class="uv-f">${pct(x.freq)}</span><span class="uv-bar" aria-hidden="true"><i style="width:${Math.min(100, x.freq * 100 / Math.max(...list.map((y) => y.freq)) )}%"></i></span></summary>
    <div class="uv-b small"><div>${esc(x.label)}</div><div>In these games: <b>${esc(H)} wins ${pct(x.pHome)}</b> · average margin ${x.margin >= 0 ? esc(H) : esc(A)} by ${f1(Math.abs(x.margin))} · total ${f1(x.total)} (${esc(A)} ${f1(x.away)}, ${esc(H)} ${f1(x.home)})</div>
      ${x.gains?.length ? `<div>⬆ Gains: ${who(x.gains, "+")} pts vs his average</div>` : ""}${x.losses?.length ? `<div>⬇ Loses: ${who(x.losses, "−")} pts</div>` : ""}</div></details>`;
  return `<div class="card"><h2>The game universe</h2>
    <div class="uv-main"><span class="chip good">Main forecast</span> All ${num(sim.sims || 10000)} simulations, weighted by how likely each is: ${esc(H)} wins <b>${pct(F.pHome ?? sim.pHome)}</b>, median margin ${(F.margin?.median ?? 0) >= 0 ? esc(H) : esc(A)} by ${f1(Math.abs(F.margin?.median ?? 0))}, total ${f1(F.total?.median ?? sim.total)}.</div>
    <p class="small muted">Each version below is a slice of those same simulations, with its real likelihood. They overlap (a game can be close and go to overtime), so they do not add up to 100%. Tap one for its score and the players who gain or lose.</p>
    ${list.map(row).join("")}
    <div class="uv-main" style="margin-top:10px"><span class="chip warn">What-if</span> Your own choices (marking players out below) shift this forecast; they are not weighted by likelihood.</div></div>`;
}
// ---------------- Build your own prediction and simulation
// Our full-workflow prediction stays as the reference. The custom one averages the rating systems you keep (each with its
// own learned weight), adds the analysis layers you switch on, and can include the sportsbook line as one more input.
const BUILD_SYS = [["efficiency", "Recent efficiency (pace × offence × defence)"], ["players", "Player stats: player-by-player build-up"], ["elo", "Elo rating (results and margins)"], ["adjusted", "Opponent-adjusted efficiency"], ["luckAdjusted", "Luck-adjusted (3-point luck removed)"]];
const BUILD_LAYERS = [["scen", "Scenario library: learned situation effects"], ["absence", "Absences and who is playing"], ["defense", "Defence, zones and four factors"], ["style", "Playstyle matchup"], ["home", "Home court"]];
const buildState = (gid) => { try { return JSON.parse(localStorage.getItem("build:" + gid) || "null"); } catch { return null; } };
const saveBuild = (gid, st) => { try { localStorage.setItem("build:" + gid, JSON.stringify(st)); } catch { /* private mode */ } };
function buildCompute(g, st, odds) {
  // Starts from our full-workflow prediction. Switching a rating system off moves the blend to the average of the ones
  // kept (with their learned weights); switching a layer off removes the points that layer is worth in this game's reasons;
  // the sportsbook line, when switched on, joins the blend as one more input. With the defaults it equals our workflow.
  const H = g.teams.find((t) => t.isHome), A = g.teams.find((t) => !t.isHome), o = odds?.games?.[g.id];
  const ourM = g.pred.hs - g.pred.as, ourT = g.pred.hs + g.pred.as;
  const avg = (keep, withMarket) => { let w = 0, m = 0; for (const x of g.models || []) if (keep(x.k)) { w += x.weight; m += x.weight * x.margin; } if (withMarket && o && Number.isFinite(o.spreadHome)) { const mw = (g.models || []).reduce((z, x) => z + x.weight, 0) / Math.max(1, (g.models || []).length); w += mw; m += mw * -o.spreadHome; } return w ? m / w : null; };
  const all = avg(() => true, false), mine = avg((k) => st.sys[k], st.market);
  let margin = ourM + (mine != null && all != null ? mine - all : 0);
  const parts = [];
  if (mine != null && all != null && Math.abs(mine - all) >= 0.05) parts.push([st.market ? "Rating systems kept + sportsbook line" : "Rating systems kept", mine - all]);
  const keysOf = (kinds) => { const hk = (g.keys?.teams || []).find((k) => String(k.tid) === String(g.home)), ak = (g.keys?.teams || []).find((k) => String(k.tid) === String(g.away)); const sum = (k) => (k?.win || []).filter((x) => kinds.includes(x.kind)).reduce((z, x) => z + (x.w || 0), 0); return sum(hk) - sum(ak); };
  const L = {
    scen: [(H.scen || []).reduce((z, x) => z + x.w, 0) - (A.scen || []).reduce((z, x) => z + x.w, 0) + keysOf(["situation"]), "Scenario library removed"],
    absence: [keysOf(["absence"]), "Absences removed"],
    defense: [keysOf(["zone", "fourFactors"]), "Defence and zones removed"],
    style: [(H.vsStyle || 0) - (A.vsStyle || 0) + keysOf(["style"]), "Playstyle matchup removed"],
    home: [keysOf(["home"]), "Home court removed"],
  };
  for (const [k, [v, label]] of Object.entries(L)) if (!st.layer[k] && Number.isFinite(v) && Math.abs(v) >= 0.05) { margin -= v; parts.push([label, -v]); }
  // total: our total, moved by the share of the total sources switched off (team model, player build-up) or the book added
  const src = { team: (H.model || H.pts) + (A.model || A.pts), players: (H.sumPlayers || H.pts) + (A.sumPlayers || A.pts) };
  const allT = (src.team + src.players) / 2, keepT = [];
  if (BUILD_SYS.some(([k]) => k !== "players" && st.sys[k])) keepT.push(src.team);
  if (st.sys.players) keepT.push(src.players);
  if (st.market && o && Number.isFinite(o.total)) keepT.push(o.total);
  let total = ourT + (keepT.length ? keepT.reduce((x, y) => x + y, 0) / keepT.length - allT : 0);
  const pace = g.pred.pace || 100; total *= (pace + st.pace) / pace;
  const shoot = (st.hShoot - st.aShoot) * 1.75; margin += shoot; total += (st.hShoot + st.aShoot) * 1.75;
  if (st.pace) parts.push([`Pace ${st.pace > 0 ? "+" : ""}${st.pace} possessions (total only)`, 0]);
  if (st.hShoot || st.aShoot) parts.push(["Shooting sliders", shoot]);
  return { margin, total, parts, o, sigma: S.learning?.params?.at(-1)?.sigma || 14.3 };
}
function buildSim(c, N = 10000) {
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const nrm = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const sdT = 17.5, hist = new Array(41).fill(0); let hw = 0, close = 0, bh = 0, ba = 0, ot = 0, cov = 0, over = 0, tSum = 0;
  const sp = c.o && Number.isFinite(c.o.spreadHome) ? c.o.spreadHome : null, bt = c.o && Number.isFinite(c.o.total) ? c.o.total : null;
  for (let i = 0; i < N; i++) {
    let mg = c.margin + c.sigma * nrm(); const tt = c.total + sdT * nrm();
    if (Math.abs(mg) < 0.5) { ot++; mg = rnd() < 0.5 + c.margin / 60 ? 3 : -3; }
    if (mg > 0) hw++; if (Math.abs(mg) <= 5) close++; if (mg >= 15) bh++; if (mg <= -15) ba++;
    if (sp != null && mg + sp > 0) cov++; if (bt != null && tt > bt) over++; tSum += tt;
    hist[Math.max(0, Math.min(40, Math.round(mg / 2) + 20))]++;
  }
  return { N, pHome: hw / N, close: close / N, bh: bh / N, ba: ba / N, ot: ot / N, cover: sp != null ? cov / N : null, over: bt != null ? over / N : null, total: tSum / N, hist, sp, bt };
}
function buildCard(g) {
  return `<div class="card build" id="build-card"><h2>Build your own prediction and simulation</h2>
    <p class="small muted">Our full-workflow prediction stays as the reference. Switch analysis on or off and move the sliders: the custom prediction and its 10,000-game simulation update at once. Your choices are saved on this device for this game.</p>
    <div id="build-out"></div></div>`;
}
function buildInit(g, raw) {
  const box = document.getElementById("build-out"); if (!box) return;
  const def = { sys: Object.fromEntries(BUILD_SYS.map(([k]) => [k, true])), layer: { scen: true, absence: true, defense: true, style: true, home: true }, market: false, pace: 0, hShoot: 0, aShoot: 0 };
  const st = { ...def, ...(buildState(g.id) || {}) };
  load("odds.json").catch(() => null).then((odds) => {
    const H = T(g.home).abbr, A = T(g.away).abbr;
    const draw = () => {
      const c = buildCompute(g, st, odds), sm = buildSim(c), o = c.o;
      const ourM = g.pred.hs - g.pred.as, ourT = g.pred.hs + g.pred.as;
      const fav = (m) => (m >= 0 ? H : A), half = (v) => Math.round(Math.abs(v) - 0.5) + 0.5;
      const mv = o?.open && Number.isFinite(o.open.spreadHome) && Number.isFinite(o.spreadHome) ? o.spreadHome - o.open.spreadHome : null;
      const mvT = o?.open && Number.isFinite(o.open.total) && Number.isFinite(o.total) ? o.total - o.open.total : null;
      const maxH = Math.max(...sm.hist);
      const bars = sm.hist.map((v, i) => { const x = i * 10, h = (v / maxH) * 80, mg = (i - 20) * 2; return `<rect x="${x + 1}" y="${90 - h}" width="8" height="${h}" fill="var(${mg >= 0 ? "--s2" : "--s1"})" opacity="${Math.abs(mg) <= 5 ? 1 : 0.75}"><title>${mg >= 0 ? H : A} by ${Math.abs(mg)}: ${pct(v / sm.N)}</title></rect>`; }).join("");
      const chk = (grp, k, label, on) => `<label class="bld-t"><input type="checkbox" data-b="${grp}:${k}"${on ? " checked" : ""}> <span>${esc(label)}</span></label>`;
      box.innerHTML = `
        <div class="bld-cmp">
          <div><small>Our workflow</small><b>${esc(fav(ourM))} by ${f1(Math.abs(ourM))}</b><span>${esc(H)} ${pct(g.pred.pHome)} · total ${f1(ourT)}</span></div>
          <div class="mine"><small>Your build</small><b>${esc(fav(c.margin))} by ${f1(Math.abs(c.margin))}</b><span>${esc(H)} ${pct(sm.pHome)} · total ${f1(c.total)}</span></div>
        </div>
        <div class="bld-grid">
          <div><h4>Rating systems in our blend</h4>${BUILD_SYS.map(([k, l]) => chk("sys", k, l, st.sys[k])).join("")}
            ${chk("market", "on", "Sportsbook line (as one more input)", st.market)}</div>
          <div><h4>Analysis layers (in our workflow: untick to remove)</h4>${BUILD_LAYERS.map(([k, l]) => chk("layer", k, l, st.layer[k])).join("")}</div>
        </div>
        <div class="bld-sl">
          <label>Pace <b>${st.pace > 0 ? "+" : ""}${st.pace}</b> possessions<input type="range" min="-8" max="8" step="1" value="${st.pace}" data-s="pace"></label>
          <label>${esc(H)} shooting <b>${st.hShoot > 0 ? "+" : ""}${st.hShoot}</b> eFG pts<input type="range" min="-6" max="6" step="1" value="${st.hShoot}" data-s="hShoot"></label>
          <label>${esc(A)} shooting <b>${st.aShoot > 0 ? "+" : ""}${st.aShoot}</b> eFG pts<input type="range" min="-6" max="6" step="1" value="${st.aShoot}" data-s="aShoot"></label>
        </div>
        <h4>Your build: the pieces</h4>
        <ul class="plain small">${(g.models || []).filter((x) => st.sys[x.k]).map((x) => `<li class="spread"><span>${esc(x.label)} <span class="muted">(weight ${x.weight.toFixed(2)})</span></span><span class="num">${fav(x.margin)} by ${f1(Math.abs(x.margin))}</span></li>`).join("")}
          ${st.market && o ? `<li class="spread"><span>Sportsbook line (${esc(o.provider || "book")})</span><span class="num">${fav(-o.spreadHome)} by ${f1(Math.abs(o.spreadHome))}</span></li>` : ""}
          ${c.parts.map(([l, v]) => `<li class="spread"><span>${esc(l)}</span><span class="num ${v > 0 ? "up" : v < 0 ? "down" : ""}">${v ? `${v > 0 ? "+" : "−"}${f1(Math.abs(v))} for ${v > 0 ? esc(H) : esc(A)}` : ""}</span></li>`).join("")}</ul>
        <h4>Your simulation (10,000 games)</h4>
        <figure class="viz"><svg viewBox="0 0 410 104" role="img" aria-label="Simulated final margins"><line x1="205" x2="205" y1="0" y2="92" class="axis"/>${bars}<text x="2" y="102" class="vt">${esc(A)} by 40</text><text x="205" y="102" class="vt" text-anchor="middle">0</text><text x="408" y="102" class="vt" text-anchor="end">${esc(H)} by 40</text></svg></figure>
        <div class="statgrid sg4">
          <div class="stat"><b>${pct(sm.pHome)}</b><span>${esc(H)} wins</span></div>
          <div class="stat"><b>${esc(fav(c.margin))} −${half(c.margin)}</b><span>your spread</span></div>
          <div class="stat"><b>${f1(sm.total)}</b><span>your total</span></div>
          <div class="stat"><b>${pct(sm.close)}</b><span>close (5 or less)</span></div>
          <div class="stat"><b>${pct(sm.bh)}</b><span>${esc(H)} by 15+</span></div>
          <div class="stat"><b>${pct(sm.ba)}</b><span>${esc(A)} by 15+</span></div>
          <div class="stat"><b>${pct(sm.ot)}</b><span>overtime</span></div>
          ${sm.cover != null ? `<div class="stat"><b>${pct(sm.cover)}</b><span>${esc(H)} covers ${sm.sp > 0 ? "+" : ""}${sm.sp}</span></div>` : ""}
          ${sm.over != null ? `<div class="stat"><b>${pct(sm.over)}</b><span>over ${sm.bt}</span></div>` : ""}
        </div>
        ${o ? `<h4>Sportsbook (comparison only)</h4><p class="small">${esc(o.provider || "Book")}: ${esc(H)} ${o.spreadHome > 0 ? "+" : ""}${o.spreadHome} (${decOdds(o.spreadOddsHome)}) · total ${o.total} (over ${decOdds(o.overOdds)}) · moneyline ${esc(H)} ${decOdds(o.mlHome)} / ${esc(A)} ${decOdds(o.mlAway)}.${mv != null && mv !== 0 ? ` <b>Line movement:</b> ${esc(H)} ${o.open.spreadHome > 0 ? "+" : ""}${o.open.spreadHome} → ${o.spreadHome > 0 ? "+" : ""}${o.spreadHome}, so the market moved toward <b>${mv > 0 ? esc(A) : esc(H)}</b>.` : ""}${mvT != null && mvT !== 0 ? ` Total ${o.open.total} → ${o.total} (moved ${mvT > 0 ? "up: money on the over" : "down: money on the under"}).` : ""}</p>
          <p class="small muted">The free feed does not publish betting percentages (share of tickets or money). Line movement since opening is the usual sign of where the money went.</p>` : ""}
        <p class="small muted">Your build is not back-tested: only our full workflow is graded game by game (see More → Accuracy report). With every box at its default your build equals our workflow; unticking a layer removes the points it is worth in this game's reasons, so it is an approximation. Statistical exploration, not betting advice.</p>
        <button class="btn sm" type="button" data-b-reset>Reset to our workflow's inputs</button>`;
      box.querySelectorAll("[data-b]").forEach((el) => el.addEventListener("change", () => { const [grp, k] = el.dataset.b.split(":"); if (grp === "market") st.market = el.checked; else st[grp][k] = el.checked; saveBuild(g.id, st); draw(); }));
      box.querySelectorAll("[data-s]").forEach((el) => el.addEventListener("input", () => { st[el.dataset.s] = Number(el.value); saveBuild(g.id, st); draw(); }));
      box.querySelector("[data-b-reset]")?.addEventListener("click", () => { Object.assign(st, structuredClone(def)); saveBuild(g.id, st); draw(); });
    };
    draw();
  });
}
function takeawayCard(g) {
  const fav = g.pred.pHome >= 0.5 ? g.home : g.away, p = Math.max(g.pred.pHome, 1 - g.pred.pHome), L = gameLines(g);
  const m = Math.abs(g.pred.hs - g.pred.as);
  const tone = p >= 0.75 ? "a clear favourite" : p >= 0.6 ? "favoured" : "a slight favourite in a near coin-flip";
  return `<div class="takeaway"><span class="ic" aria-hidden="true">💡</span><div><b>Key takeaway</b>The ${esc(T(fav).name)} are ${tone}: ${pct(p)} to win, with a projected margin of about ${f0(m)} points (spread ${esc(T(L.fav).abbr)} ${spreadTxt(L.spread)}, total ${L.total.toFixed(1)}).</div></div>`;
}
const KEY_SHORT = { ratings: "Rating systems favour them", home: "Home-court advantage", pace: "Pace suits them", situation: "Better schedule spot", style: "Good record vs this style", absence: "Opponent missing a key player", form: "Beating projections lately", h2h: "Strong in past meetings", zone: "Shot-zone edge", fourFactors: "Four-factor edge" };
const shortWhy = (w) => {
  const t = briefReason(typeof w === "string" ? w : w?.t || w?.txt || "");
  if (w?.kind && KEY_SHORT[w.kind]) return KEY_SHORT[w.kind];
  const c = t.indexOf(":");
  if (c > 0 && c < 28) return `${t.slice(0, c)} edge`;
  const words = t.split(/\s+/);
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
};
function matchupSummary(g) {
  const away = g.teams.find((t) => !t.isHome), home = g.teams.find((t) => t.isHome);
  const k = (tid) => (g.keys?.teams || []).find((x) => x.tid === tid)?.win || [];
  const col = (t) => `<div><h3>${teamLogo(t.tid, { size: "xs" })} ${esc(T(t.tid).short)}</h3>${k(t.tid).length ? `<ul class="check">${k(t.tid).slice(0, 4).map((w) => `<li>${esc(shortWhy(w))}</li>`).join("")}</ul>` : `<p class="small muted">No clear edge found.</p>`}</div>`;
  // Key matchups: each side's top two scorers against the defender who guards them most (NBA.com tracking).
  const kmu = [];
  for (const t of [away, home]) for (const p of (t.players || []).slice(0, 2)) {
    const d = p.dm?.defenders?.[0]; if (!d) continue;
    const vs = d.h2h?.per100 != null && d.h2h?.exp100 != null && !d.h2h.small ? d.h2h.per100 - d.h2h.exp100 : d.vsExpPct != null ? d.vsExpPct / 4 : null;
    const edge = vs == null ? "Even" : vs > 2 ? `Edge: ${T(t.tid).abbr}` : vs < -2 ? `Edge: ${T(t.tid === home.tid ? away.tid : home.tid).abbr}` : "Even";
    kmu.push(`<li><div><b>${esc(shortName(p.n))} vs ${esc(shortName(d.n))}</b><span>${d.h2h?.games ? `${esc(d.h2h.games)} meetings: ${f1(d.h2h.per100)} pts per 100 possessions vs ${f1(d.h2h.exp100)} usual` : `guards him on ${f0(d.share)}% of plays`}</span></div><span class="edge">${esc(edge)}</span></li>`);
  }
  return `<div class="card" data-tab-of="mu"><h2>Why each team can win</h2><div class="why2">${col(away)}${col(home)}</div>
    ${kmu.length ? `<h2 style="margin-top:16px">Key matchups</h2><ul class="kmu">${kmu.join("")}</ul><p class="small muted" style="margin-top:6px">Who guards each top scorer most, from NBA.com tracking in previous meetings and matchup records. Details and every edge with its numbers are below.</p>` : ""}</div>`;
}
function insightCard(g, sim) {
  const best = (sim?.players || []).filter((p) => p.props?.pts).sort((a, b) => (b.proj?.pts || 0) - (a.proj?.pts || 0))[0];
  if (!best) return "";
  const pr = best.props.pts;
  return `<div class="card" data-tab-of="pl"><h2>⭐ Player insight</h2><div class="insight">${avatar(best.id, best.n, { size: "lg" })}<p style="margin:0">${esc(best.n)} is projected for <b>${f1(best.proj.pts)} points</b> (typical range ${esc(best.dist?.pts?.[3])}-${esc(best.dist?.pts?.[6])}), with a <b>${pct(pr.pOver)}</b> chance to go over ${esc(pr.line)} in the simulations.</p></div></div>`;
}
function donutCard(s) {
  const p = s.pHome ?? s.forecast?.pHome; if (p == null) return "";
  const fav = p >= 0.5 ? s.home : s.away, pf = Math.max(p, 1 - p), R = 52, C = 2 * Math.PI * R;
  const away = 1 - p;
  const grp = (ids) => (s.scenarios || []).filter((x) => ids.includes(x.id)).reduce((a, x) => a + x.freq, 0);
  const rows = [["Normal game", grp(["normal"]), "--s1"], ["Close game", grp(["close"]), "--s3"], ["Blowout", grp(["blowH", "blowA"]), "--s2"], ["Overtime", grp(["ot"]), "--s4"], ["Injury impact", grp(["injH", "injA"]), "--s5"]].filter((r) => r[1] > 0);
  return `<div class="card"><p class="small" style="color:#4ee38a;font-weight:700;margin:0 0 8px">✓ ${num(s.sims || 10000)} simulations complete</p>
    <div class="donut-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(`${T(fav).abbr} wins ${pct(pf)} of simulations`)}">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--s2)" stroke-width="16"/>
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--s1)" stroke-width="16" stroke-dasharray="${(away * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 70 70)" stroke-linecap="butt"/>
      <text x="70" y="68" text-anchor="middle" style="font:700 22px var(--sans);fill:var(--ink)">${pct(pf)}</text><text x="70" y="88" text-anchor="middle" style="font:12px var(--sans);fill:var(--ink-2)">${esc(T(fav).abbr)} win</text></svg>
      <div class="donut-l"><span><i style="background:var(--s1)"></i>${esc(T(s.away).abbr)} ${pct(away)}</span><span><i style="background:var(--s2)"></i>${esc(T(s.home).abbr)} ${pct(p)}</span></div></div>
    ${rows.length ? `<h3>Scenario breakdown</h3><div class="scbars">${rows.map(([l, v, c]) => `<div class="scbar"><span>${esc(l)}</span><span class="tr"><span style="width:${Math.min(100, v * 100)}%;background:var(${c})"></span></span><span class="v">${pct(v)}</span></div>`).join("")}</div><p class="small muted" style="margin-top:8px">Scenarios can overlap (a close game can also go to overtime). Explore each one below.</p>` : ""}</div>`;
}
function rankingsCard() {
  const rows = [...S.teams].sort((a, b) => (b.ratings?.adjNet ?? 0) - (a.ratings?.adjNet ?? 0));
  return `<div class="card"><h2>NBA team rankings</h2><div class="tw"><table class="rk"><thead><tr><th>#</th><th>Team</th><th class="n">OffRtg</th><th class="n">DefRtg</th><th class="n">Net</th></tr></thead><tbody>
    ${rows.map((t, i) => `<tr class="${isFav("t", t.id) ? "fav" : ""}"><td>${i + 1}</td><td class="tm"><a href="#/team/${esc(t.id)}" style="display:flex;align-items:center;gap:8px;color:inherit">${teamLogo(t.id, { size: "xs" })}${esc(t.abbr)}</a></td><td class="n">${f1(t.style?.off)}</td><td class="n">${f1(t.style?.def)}</td><td class="n ${(t.ratings?.adjNet ?? 0) >= 0 ? "pos" : "neg"}">${sg(t.ratings?.adjNet)}</td></tr>`).join("")}
  </tbody></table></div><p class="small muted">Net is points per 100 possessions after adjusting for who they have played. Tap a team for its full page.</p></div>`;
}
const MENU_IC = { accuracy: ["✅", "#1d4a2a"], results: ["📊", "#3b2b80"], why: ["🎯", "#123d7a"], sim: ["🧪", "#164a3a"], board: ["⭐", "#5a3a10"], season: ["🏆", "#4a2b10"], breakout: ["🚀", "#5a1d3a"], today: ["🔔", "#1d3d5a"], compare: ["⚖️", "#3a2a5a"], "more/takes": ["🗞️", "#2a3a4a"], "more/sources": ["🗂️", "#2a3a2a"], "more/method": ["⚙️", "#33334a"] };

// Scout: profile numbers and a trust meter right under the player header.
function scoutTop(p) {
  const l = p.cur?.gp >= 3 ? p.cur : p.prev; const tr = p.trust;
  const trust = tr?.mae && tr?.typical ? Math.round(Math.min(1, tr.typical / tr.mae) * 100) : null;
  const strengths = (p.scout?.strengths || p.scout?.str || []).slice(0, 4).map((x) => { const t = typeof x === "string" ? x : x.t || x.txt || x.label || ""; const c = t.indexOf(":"); return c > 0 && c < 34 ? t.slice(0, c) : t; }).filter(Boolean);
  return `<div class="card scout-top"><div class="scout-row">
      ${l ? `<div class="statgrid sg4" style="flex:1"><div class="stat"><b>${f1(l.pts)}</b><span>PPG</span></div><div class="stat"><b>${f1(l.reb)}</b><span>RPG</span></div><div class="stat"><b>${f1(l.ast)}</b><span>APG</span></div><div class="stat"><b>${f1(l.min)}</b><span>MPG</span></div></div>` : ""}
      ${trust != null ? `<div class="trust-card"><span class="small muted">Trust meter</span><b>${trust}%</b>${meter(trust / 100)}<span class="small muted">${esc(trustWord(tr.label))}</span></div>` : ""}
    </div>${strengths.length ? `<h3>Strengths</h3><ul class="check">${strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <p class="small muted" style="margin-top:8px">${l ? `${esc(l.gp)} games ${l === p.cur ? "this season" : "last season"}.` : ""} Trust meter: how closely the model has read him lately (100% = his misses are no bigger than usual for players like him).</p></div>`;
}

function twoColPoints(g) {
  const col = (t) => { const rows = (t.players || []).filter((p) => p.min >= 12).slice(0, 8); const max = Math.max(...rows.map((p) => p.pts), 1);
    return `<div class="tcp"><h3>${teamLogo(t.tid, { size: "xs" })} ${esc(T(t.tid).name)}</h3>${rows.map((p) => `<div class="tcp-r"><span class="tcp-n">${esc(shortName(p.n))}${p.q ? " (Q)" : ""}</span><span class="tcp-v">${f1(p.pts)}</span><span class="tcp-b"><span style="width:${Math.round((p.pts / max) * 100)}%;background:var(${t.isHome ? "--s2" : "--s1"})"></span></span></div>`).join("")}</div>`; };
  return `<div class="tcp-g">${col(g.teams.find((t) => !t.isHome))}${col(g.teams.find((t) => t.isHome))}</div>`;
}

function pickLine(pick, raw) {
  if (pick.player && raw) {
    const t = raw.teams.find((x) => x.tid === pick.player.t), p = t?.players.find((x) => x.id === pick.player.id), opp = raw.teams.find((x) => x.tid !== pick.player.t);
    if (p) { const stat = { pts: ["pts", "points"], reb: ["reb", "rebounds"], ast: ["ast", "assists"], tpm: ["tpm", "threes"] }[pick.fam]; const m = (p.adj?.matchups || []).filter((x) => x.n >= 5).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
      return `Projected for ${f1(p[stat?.[0]] ?? p.pts)} ${stat?.[1] || "points"}${m ? (m.pts > 0 ? `, strong ${m.label.toLowerCase()}` : `, though weaker ${m.label.toLowerCase()}`) : ""} vs ${T(opp?.tid).abbr}.`; }
  }
  if (!pick.player && raw) { const k = (raw.keys?.teams || []).find((x) => x.tid === pick.team)?.win?.[0]; if (k) return shortWhy(k) + "."; }
  return "Tap for the full reasoning.";
}
// Teams page: Rankings / Styles pill tabs over the existing content.
function teamsTabs() {
  const rk = app.querySelector(".rk")?.closest(".card"); if (!rk || app.querySelector(".tm-tabs")) return;
  const bar = document.createElement("div"); bar.className = "filters tm-tabs"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Teams view");
  bar.innerHTML = [["rk", "Rankings"], ["st", "Styles and records"]].map(([k, l]) => `<button class="fbtn" type="button" data-tt="${k}">${l}</button>`).join("");
  rk.insertAdjacentElement("beforebegin", bar);
  const rest = [...app.children].filter((el) => el !== rk && el !== bar && !el.matches("h1, .lead, .back"));
  const show = (k) => { S.tmTab = k; rk.hidden = k !== "rk"; rest.forEach((el) => (el.hidden = k === "rk")); bar.querySelectorAll("[data-tt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tt === k))); };
  bar.addEventListener("click", (e) => { const b = e.target.closest("[data-tt]"); if (b) show(b.dataset.tt); });
  show(S.tmTab || "rk");
}

// ---- Simulation with players marked out: shift the simulated margins by the change in projected
// margin and rescale player distributions by their new minutes (done in the browser).
function simAdjust(sim, g, raw) {
  if (!sim || !g?.adjusted?.length || !raw) return sim;
  const shift = (g.pred.hs - g.pred.as) - (raw.pred.hs - raw.pred.as);
  const out = structuredClone(sim); out.shift = shift; out.adjusted = g.adjusted.map((x) => x.n);
  const h = out.forecast?.margin?.hist;
  if (h?.share) {
    const k = Math.round(shift / h.step), n = h.share.length, sh = new Array(n).fill(0);
    h.share.forEach((v, i) => { const j = Math.min(n - 1, Math.max(0, i + k)); sh[j] += v; });
    h.share = sh.map((v) => Math.round(v * 10) / 10);
    const tot = sh.reduce((a, b) => a + b, 0) || 1;
    const pH = sh.reduce((a, v, i) => a + (h.from + h.step * (i + 0.5) > 0 ? v : 0), 0) / tot;
    out.pHome = pH; out.forecast.pHome = pH; out.forecast.pAway = 1 - pH;
    out.forecast.margin.median = Math.round((out.forecast.margin.median ?? 0) + shift);
  }
  const ids = new Set(g.adjusted.map((x) => String(x.id)));
  const newMin = new Map(g.teams.flatMap((t) => t.players.map((p) => [String(p.id), p.min])));
  const oldMin = new Map(raw.teams.flatMap((t) => t.players.map((p) => [String(p.id), p.min])));
  out.players = (out.players || []).filter((p) => !ids.has(String(p.id))).map((p) => {
    const f = (newMin.get(String(p.id)) || 0) / Math.max(1, oldMin.get(String(p.id)) || 1);
    if (!f || Math.abs(f - 1) < 0.02) return p;
    const q = structuredClone(p); q.minF = f;
    if (q.proj) { q.proj.pts *= f; q.proj.min *= f; }
    for (const st of Object.keys(q.dist || {})) q.dist[st] = q.dist[st].map((v, i) => (i === 2 ? v * Math.sqrt(f) : v * f));
    for (const st of Object.keys(q.props || {})) { const pr = q.props[st], d = q.dist[st]; if (!d || !pr) continue; const z = (pr.line - d[0]) / Math.max(0.5, d[2]); pr.pOver = 1 - pNorm(z); pr.pUnder = 1 - pr.pOver; }
    return q;
  });
  return out;
}
function simPlayersCard(sim, g) {
  const rows = (sim?.players || []).filter((p) => p.props?.pts).sort((a, b) => (b.proj?.pts || 0) - (a.proj?.pts || 0)).slice(0, 10);
  if (!rows.length) return "";
  return `<div class="card"><h2>Player outcomes in the simulations</h2><div class="tw"><table><thead><tr><th>Player</th><th class="n">Pts</th><th class="n">Range</th><th class="n">Over line</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td>${esc(shortName(p.n))}${p.minF ? ` <span class="chip ${p.minF > 1 ? "good" : "bad"}">${p.minF > 1 ? "+" : ""}${Math.round((p.minF - 1) * 100)}% min</span>` : ""}</td><td class="n">${f1(p.proj?.pts)}</td><td class="n">${f0(p.dist?.pts?.[3])}-${f0(p.dist?.pts?.[6])}</td><td class="n">${esc(p.props.pts.line)}: ${pct(p.props.pts.pOver)}</td></tr>`).join("")}
  </tbody></table></div><p class="small muted">Range = 10th to 90th percentile of his points across the simulated games.</p></div>`;
}


// ================================================================ "Our predictions" card at the top of a game page
function preQuarters(g) {
  const h = g.teams.find((t) => t.isHome), a = g.teams.find((t) => !t.isHome);
  const qh = h?.quarters?.proj, qa = a?.quarters?.proj; if (!qh || !qa) return "";
  const H = T(g.home).abbr, A = T(g.away).abbr;
  const win = (m, sd) => { const p = 1 - pNorm(-m / sd); return Math.abs(p - 0.5) < 0.02 ? "even" : `${esc(p >= 0.5 ? H : A)} ${pct(Math.max(p, 1 - p))}`; };
  const row = (lab, x, y, sd) => `<tr><td>${lab}</td><td class="n">${f1(y)}</td><td class="n">${f1(x)}</td><td class="n">${f1(x + y)}<br><span class="muted small">line ${Math.round(x + y - 0.5) + 0.5}</span></td><td class="n">${win(x - y, sd)}</td></tr>`;
  return `<h3>Quarters and halves</h3><div class="tw"><table class="lvq"><thead><tr><th></th><th class="n">${esc(A)}</th><th class="n">${esc(H)}</th><th class="n">Total</th><th class="n">Wins it</th></tr></thead><tbody>
    ${[0, 1, 2, 3].map((q) => row(`Q${q + 1}`, qh[q], qa[q], 7)).join("")}
    ${row("1st half", qh[0] + qh[1], qa[0] + qa[1], 9.5).replace("<tr>", '<tr class="half">')}${row("2nd half", qh[2] + qh[3], qa[2] + qa[3], 9.5).replace("<tr>", '<tr class="half">')}
  </tbody></table></div><p class="small muted">From each team's quarter-by-quarter scoring pattern in our replay (fast starters, strong closers, bench-heavy quarters). Lines sit at our projection.</p>`;
}
// Our line first (bold), the bookmaker's main line beside it as a reference only, the difference in plain points and our
// record at that size of difference. Nothing here changes a projection.
function lineTable(g) {
  const o = S.oddsAll?.games?.[g.id], H = T(g.home).abbr, A = T(g.away).abbr, ph = g.pred.pHome, om = g.pred.hs - g.pred.as, ot = g.pred.hs + g.pred.as;
  const favH = ph >= 0.5, fp = Math.max(ph, 1 - ph), fav = favH ? H : A;
  const sp = (m) => `${m >= 0 ? H : A} −${f1(Math.abs(m))}`;
  const bm = o && Number.isFinite(o.spreadHome) ? -o.spreadHome : null;
  const rows = [
    ["Winner", `${esc(fav)} ${Math.round(fp * 100)}% · fair ${(1 / fp).toFixed(2)}`, o ? `${esc(H)} ${decOdds(o.mlHome)} / ${esc(A)} ${decOdds(o.mlAway)}` : "-"],
    ["Spread", `${esc(sp(om))} <span class="muted small">(as a line: ${esc(om >= 0 ? H : A)} −${(Math.round(Math.abs(om) - 0.5) + 0.5).toFixed(1)})</span>`, bm != null ? esc(bm === 0 ? "pick'em" : sp(bm)) : "-"],
    ["Total", `${f1(ot)} <span class="muted small">(as a line: ${(Math.round(ot - 0.5) + 0.5).toFixed(1)})</span>`, o && Number.isFinite(o.total) ? esc(o.total) : "-"],
  ];
  const dS = bm != null ? om - bm : null, dT = o && Number.isFinite(o.total) ? ot - o.total : null;
  const diff = [dS != null && Math.abs(dS) >= 0.1 ? `we're ${f1(Math.abs(dS))} pts higher on ${esc(dS > 0 ? H : A)}` : dS != null ? "same margin as the market" : "", dT != null && Math.abs(dT) >= 0.1 ? `${f1(Math.abs(dT))} pts ${dT > 0 ? "higher" : "lower"} on the total` : ""].filter(Boolean).join(", ");
  const rec = [dS != null ? discLabel(S.ptRec, "spread", Math.abs(dS)) : "", dT != null ? discLabel(S.ptRec, "total", Math.abs(dT)).replace("When we disagree", "On totals, when we disagree") : ""].filter(Boolean);
  const asOf = o?.fetched ? new Date(o.fetched).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return `<div class="lt"><table class="lt-t"><thead><tr><th></th><th>Our line</th><th class="ref">Main line (reference)</th></tr></thead><tbody>
      ${rows.map(([k, a, b]) => `<tr><td>${k}</td><td><b>${a}</b></td><td class="ref">${b}</td></tr>`).join("")}</tbody></table>
    <p class="small muted">Our numbers are the projected margin and total; "as a line" is the same number rounded to a half point, which is what the "Our predictions" rows and the takeaway use. The win chance here is our model's; the Simulation tab shows the 10,000-game simulation's own figure, which can differ by a point or two.</p>
    ${o ? `${diff ? `<p class="small"><b>Difference:</b> ${diff}.</p>` : ""}${rec.length ? `<p class="small muted"><i>${rec.map(esc).join(" · ")}</i></p>` : ""}
      ${(dS != null && Math.abs(dS) >= 10) || (dT != null && Math.abs(dT) >= 10) ? `<p class="small" style="color:var(--warn)">⚠ When we differ by 10+ points, check the latest injury news first.</p>` : ""}
      <p class="small muted">Main line as of ${esc(asOf || "-")} PH (${esc(o.provider || "sportsbook")}). Reference only: it never changes our projections.</p>` : `<p class="small muted">The sportsbook has not posted a line for this game yet.</p>`}</div>`;
}
function predictionsCard(g, sim, board) {
  const L = gameLines(g), home = g.home, away = g.away;
  const pFav = L.pFav, favT = T(L.fav).abbr, dog = L.fav === home ? away : home;
  const sl = sim?.lines || {};
  const coverFav = sl.spread ? (L.fav === home ? sl.spread.pHomeCovers : sl.spread.pAwayCovers) : null;
  const tot = sl.total, tt = sl.teamTotals || {};
  const lean = (pOver) => (pOver == null ? "" : pOver >= 0.5 ? `Over ${pct(pOver)}` : `Under ${pct(1 - pOver)}`);
  const strength = (p) => (p >= 0.75 ? "strong" : p >= 0.6 ? "lean" : "coin-flip");
  // Best player props: strongest calibrated picks for this game that are not near-automatic lines.
  const mainOf = (pid, fam) => sim?.players?.find((x) => String(x.id) === String(pid))?.props?.[fam]?.line;
  const props = (board?.picks || []).filter((p) => p.game === g.id && p.player).map((p) => ({ ...p, raw: p.p, p: calP(p.p, p.fam, board) }))
    .filter((p) => !isLowLine(p) && p.p >= 0.8 && !tooFarBelow(p, mainOf(p.player.id, p.fam)) && !devCheck(g, p.player.id, p.fam)?.unexplained).sort((a, b) => b.p - a.p);
  const seen = new Set(), best = [];
  // First choice: leans at the sportsbook's main line (our chance, the book only sets the line).
  const WORD = { pts: "points", reb: "rebounds", ast: "assists", tpm: "threes", pra: "pts+reb+ast" };
  for (const c of (sim?.comparison?.props || []).filter((x) => WORD[x.stat] && x.ourProbOver != null && !devCheck(g, x.id, x.stat)?.unexplained).map((x) => ({ ...x, q: Math.max(x.ourProbOver, 1 - x.ourProbOver) })).filter((x) => x.q >= 0.6).sort((a, b) => b.q - a.q)) {
    if (seen.has(String(c.id))) continue; seen.add(String(c.id));
    best.push({ label: `${c.n} ${c.ourProbOver >= 0.5 ? "over" : "under"} ${c.bookLine} ${WORD[c.stat]}`, p: c.q, player: { id: c.id, n: c.n }, mainLine: true, median: c.ourMedian });
    if (best.length === 3) break;
  }
  for (const p of props) { if (best.length >= 3) break; if (seen.has(String(p.player.id))) continue; seen.add(String(p.player.id)); best.push(p); }
  // If the board has none for this game, fall back to the simulation's clearest main-line leans.
  if (!best.length) for (const pl of (sim?.players || []).filter((x) => x.props?.pts && (x.proj?.min || 0) >= 24 && (x.pDnp || 0) < 0.15 && x.props.pts.line >= 8.5 && !devCheck(g, x.id, "pts")?.unexplained).sort((a, b) => Math.abs(b.props.pts.pOver - 0.5) - Math.abs(a.props.pts.pOver - 0.5)).slice(0, 3)) {
    const o = pl.props.pts.pOver; best.push({ label: `${pl.n} ${o >= 0.5 ? "over" : "under"} ${pl.props.pts.line} points`, p: Math.max(o, 1 - o), player: { id: pl.id, n: pl.n }, lean: true });
  }
  const row = (k, main, sub, p) => `<div class="pr-row"><span class="pr-k">${k}</span><span class="pr-v"><b>${main}</b>${sub ? `<i>${sub}</i>` : ""}</span>${p != null ? `<span class="pr-p">${pct(p)}</span>` : ""}</div>`;
  return `<div class="card preds" data-tab-of="ov"><div class="card-h"><h2>Our predictions</h2><button class="btn sm" type="button" data-gt-go="si">Build your own ›</button></div>
    ${lineTable(g)}
    ${row("Moneyline", `${esc(favT)} to win`, `fair odds ${esc(T(L.fav).abbr)} ${mlTxt(pFav)} · ${esc(T(dog).abbr)} ${mlTxt(1 - pFav)} · ${strength(pFav)}`, pFav)}
    ${(() => { const c = sim?.comparison; if (c?.spread?.ourProb == null) return ""; const q = c.spread.ourProb, l = c.spread.bookLine, tm = c.spread.team, oth = tm === T(home).abbr ? T(away).abbr : T(home).abbr, take = q >= 0.5;
      return row("Spread", `${esc(take ? tm : oth)} ${(take ? l : -l) > 0 ? "+" : ""}${take ? l : -l}`, `sportsbook main line · our margin ${esc(T(L.fav).abbr)} by ${f1(Math.abs(g.pred.hs - g.pred.as))} · ${strength(Math.max(q, 1 - q))}`, Math.max(q, 1 - q)); })() || `${coverFav != null && coverFav < 0.5 ? row("Spread", `${esc(T(dog).abbr)} +${L.spread.toFixed(1)}`, `covers in ${pct(1 - coverFav)} of simulations · our line, so close to even`, 1 - coverFav) : row("Spread", `${esc(favT)} ${spreadTxt(L.spread)}`, coverFav != null ? `covers in ${pct(coverFav)} of simulations · our line, so close to even` : "set at our projected margin", coverFav)}`}
    ${(() => { const c = sim?.comparison; if (c?.total?.ourProb == null) return ""; const q = c.total.ourProb;
      return row("Game total", `${q >= 0.5 ? "Over" : "Under"} ${c.total.bookLine}`, `sportsbook main line · our projected total ${f1(g.pred.hs + g.pred.as)}`, Math.max(q, 1 - q)); })() || `${row("Game total", `${L.total.toFixed(1)} · ${tot?.pOver != null ? esc(lean(tot.pOver)) : "even"}`, `projected ${f1(g.pred.hs + g.pred.as)} points`, tot?.pOver != null ? Math.max(tot.pOver, 1 - tot.pOver) : null)}`}
    ${row("Team totals", `${esc(T(away).abbr)} ${tt.away?.line ?? f1(g.pred.as)} · ${esc(T(home).abbr)} ${tt.home?.line ?? f1(g.pred.hs)}`, `${esc(T(away).abbr)} ${esc(lean(tt.away?.pOver))} · ${esc(T(home).abbr)} ${esc(lean(tt.home?.pOver))}`, null)}
    ${preQuarters(g)}
    <h3>Best player props</h3>
    ${best.length ? best.map((p) => `<div class="pr-prop">${p.player ? avatar(p.player.id, p.player.n, { size: "sm" }) : ""}<span><b>${esc(p.label)}</b><i>${p.mainLine ? `sportsbook main line · our median ${esc(p.median ?? "-")}` : p.lean ? "main line, simulation lean" : `adjusted for past accuracy · picks like this came true ${p.hit?.rate != null ? esc(p.hit.rate) + "%" : "-"}`}</i></span><span class="pr-p">${pct(p.p)}</span></div>`).join("") : `<p class="small muted">No strong player prop for this game.</p>`}
    <p class="small muted" style="margin-top:8px">Every chance here comes only from our model and 10,000 simulations. Where the sportsbook has posted a main line, that is the line we test (so you see the number you would actually face); the odds never change our projections, simulations or learning. Without a sportsbook line, our own main line is used, which sits near 50% by design. The Picks tab has main-line leans, 85%+ props and parlays. Not betting advice.</p>
    <a class="go" href="#/picks">All picks ›</a></div>`;
}


// ================================================================ In-game (live) predictions
async function liveOf(id) {
  if (S.liveData === undefined) S.liveData = await load("live.json").catch(() => null);
  return S.liveData?.games?.find((x) => x.id === id) || null;
}
const ago2 = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
function liveBadge(lv) {
  if (!lv) return "";
  if (lv.state === "post") return `<div class="lv-strip post" data-lv="${esc(lv.id)}"><b>Final</b> ${esc(T(lv.away).abbr)} ${esc(lv.as)} - ${esc(lv.hs)} ${esc(T(lv.home).abbr)}${lv.called != null ? ` <span class="chip ${lv.called ? "good" : "bad"}">${lv.called ? "✓ Called" : "✗ Missed"}</span>` : ""}</div>`;
  const fav = lv.pHome >= 0.5 ? lv.home : lv.away;
  return `<div class="lv-strip" data-lv="${esc(lv.id)}"><span class="lv-dot" aria-hidden="true"></span><b>LIVE</b> ${esc(lv.detail)} · ${esc(T(lv.away).abbr)} ${esc(lv.as)} - ${esc(lv.hs)} ${esc(T(lv.home).abbr)}${lv.pHome != null ? ` · <b>${esc(T(fav).abbr)} ${pct(Math.max(lv.pHome, 1 - lv.pHome))}</b> live` : ""}</div>`;
}
function liveCard(lv) {
  if (!lv || lv.state !== "in") return lv?.state === "post" ? `<div class="card live-card" data-tab-of="lv">${liveBadge(lv)}<p class="small muted" style="margin:6px 0 0">Pre-game projection ${esc(T(lv.away).abbr)} ${f1(lv.preA)} - ${f1(lv.preH)} ${esc(T(lv.home).abbr)}. Full breakdown in Results after the next refresh.</p></div>` : "";
  const ph = lv.pHome ?? 0.5;
  const rows = (lv.players || []).filter((p) => !p.out).sort((a, b) => b.live.pts - a.live.pts).slice(0, 8);
  return `<div class="card live-card" data-tab-of="lv"><div class="lv-h"><span class="lv-dot" aria-hidden="true"></span><h2 style="margin:0">In-game prediction</h2><span class="small muted">${esc(lv.detail)} · updated ${esc(ago2(S.liveData.fetched))}</span></div>
    <div class="lv-score"><div><small>${esc(T(lv.away).abbr)}</small><strong>${esc(lv.as)}</strong></div><div class="lv-mid">Now</div><div class="r"><small>${esc(T(lv.home).abbr)}</small><strong>${esc(lv.hs)}</strong></div></div>
    <div class="h2-wc"><div><small>Live win chance</small><strong>${pct(1 - ph)}</strong></div><div class="wp" aria-hidden="true"><span style="flex:${1 - ph}"></span><span style="flex:${ph}"></span></div><div class="r"><small>${esc(T(lv.home).abbr)}</small><strong>${pct(ph)}</strong></div></div>
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px"><div class="stat"><b>${f0(lv.projA)}-${f0(lv.projH)}</b><span>Projected final</span></div><div class="stat"><b>${f1(lv.projTotal)}</b><span>Projected total (pre-game ${f1((lv.preH || 0) + (lv.preA || 0))})</span></div><div class="stat"><b>${pct(lv.prePHome >= 0.5 ? lv.prePHome : 1 - lv.prePHome)}</b><span>Pre-game ${esc(T(lv.prePHome >= 0.5 ? lv.home : lv.away).abbr)}</span></div></div>
    ${rows.length ? `<h3>Players: now and projected final</h3><div class="tw"><table><thead><tr><th>Player</th><th class="n">Now</th><th class="n">Proj</th><th class="n">Line</th><th class="n">Over</th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td>${esc(shortName(p.n))} <span class="muted">${esc(T(p.t).abbr)}</span>${p.cur.pf >= 4 ? ` <span class="chip warn">${esc(p.cur.pf)} fouls</span>` : ""}</td><td class="n">${esc(p.cur.pts)}<span class="muted"> · ${esc(p.cur.min)}m</span></td><td class="n"><b>${f1(p.live.pts)}</b></td><td class="n">${esc(p.line)}</td><td class="n ${p.pOver >= 0.5 ? "up" : "down"}">${pct(p.pOver)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <p class="small muted" style="margin-top:8px">Built from the pre-game projection, the current score and time left; each player's current line plus his projected rate for the minutes he has left. It is only as fresh as the last data refresh, so check the time above. No betting odds are used.</p></div>`;
}


// ================================================================ Live engine (runs in the browser)
// While a game is on, the page asks ESPN for the score and box score every 30 seconds and updates the
// in-game predictions: win chance, live spread, moneyline, game total, team totals and player props.
// It starts from the pre-game projection and applies live scenarios learned from past games:
// foul trouble, a developing blowout (starters sit on both sides), a close finish (starters play more),
// a player who leaves the game, overtime, and shooting luck (remaining minutes use his normal rate,
// not his hot or cold first half). If the host blocks outside requests (the private Claude preview),
// it falls back to the snapshot saved at the last data refresh.
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const LIVE_POLL_MS = 5000;      // score and clock every 5 s (ESPN has no push feed; this is as fast as it updates)
const LIVE_BOX_EVERY = 3;       // full box score every 3rd tick (15 s), to keep phone data use reasonable
const n0 = (v) => (v === undefined || v === null || v === "" || v === "--" ? 0 : Number(String(v).replace("+", "")) || 0);
const clockS = (c) => { const m = String(c || "0:00").split(":"); return m.length === 2 ? n0(m[0]) * 60 + n0(m[1]) : n0(m[0]); };
const remShare = (period, clock) => (period <= 4 ? Math.max(0, ((4 - period) * 720 + clockS(clock)) / 2880) : Math.max(0, clockS(clock) / 2880));
async function espnJSON(path) {
  const r = await fetch(`${ESPN_API}/${path}${path.includes("?") ? "&" : "?"}_=${Math.floor(Date.now() / 4000)}`, { cache: "no-store" }); // cache-buster: ESPN's CDN otherwise serves copies minutes old
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}
async function liveFetch(id) {
  // Live: straight from ESPN. Fallback: the snapshot from the last refresh.
  try {
    const s = await espnJSON(`summary?event=${encodeURIComponent(id)}`);
    const hdr = s.header?.competitions?.[0], st = hdr?.status?.type;
    const comp = (side) => hdr.competitors.find((c) => c.homeAway === side);
    const box = new Map();
    for (const side of s.boxscore?.players || []) {
      const t = side.statistics?.[0]; if (!t) continue;
      const k = t.keys || [];
      for (const a of t.athletes || []) {
        const v = a.stats || [], g = (key) => v[k.indexOf(key)];
        const pair = (key) => String(g(key) || "0-0").split("-").map(n0);
        const [fgm, fga] = pair("fieldGoalsMade-fieldGoalsAttempted"), [tpm, tpa] = pair("threePointFieldGoalsMade-threePointFieldGoalsAttempted"), [ftm, fta] = pair("freeThrowsMade-freeThrowsAttempted");
        box.set(String(a.athlete.id), { t: side.team.id, min: n0(g("minutes")), pts: n0(g("points")), reb: n0(g("rebounds")), ast: n0(g("assists")), tpm, tpa, fgm, fga, ftm, fta, stl: n0(g("steals")), blk: n0(g("blocks")), to: n0(g("turnovers")), pm: n0(g("plusMinus")), pf: n0(g("fouls")), dnp: a.didNotPlay ? 1 : 0, ej: a.ejected ? 1 : 0, starter: !!a.starter });
      }
    }
    const lsOf = (side) => (comp(side)?.linescores || []).map((x) => n0(x.displayValue ?? x.value));
    const tb = {};
    for (const t of s.boxscore?.teams || []) { const m = {}; for (const x of t.statistics || []) m[x.name] = x.displayValue; tb[t.homeAway === "home" ? "h" : "a"] = m; }
    return { src: "live", fetched: new Date().toISOString(), state: st?.state, detail: st?.shortDetail || "", period: hdr?.status?.period || 0, clock: hdr?.status?.displayClock || "0:00", hs: n0(comp("home")?.score), as: n0(comp("away")?.score), box, ls: { h: lsOf("home"), a: lsOf("away") }, tb };
  } catch {
    const lv = await liveOf(id);
    if (!lv) return null;
    const box = new Map((lv.players || []).map((p) => [String(p.id), { t: p.t, ...p.cur, tpm: 0 }]));
    return { src: "snapshot", fetched: S.liveData?.fetched, state: lv.state, detail: lv.detail, period: lv.period, clock: lv.clock, hs: lv.hs, as: lv.as, box };
  }
}
function liveModel(g, L) {
  const home = g.teams.find((t) => t.isHome), away = g.teams.find((t) => !t.isHome);
  const rem = remShare(L.period, L.clock), elapsed = Math.max(0.02, 1 - rem);
  const lead = L.hs - L.as, preM = g.pred.hs - g.pred.as, preTot = g.pred.hs + g.pred.as;
  const q4 = L.period >= 4, ot = L.period > 4;
  const blowout = (q4 && Math.abs(lead) >= 18) || (L.period === 3 && Math.abs(lead) >= 24);
  const closeLate = q4 && Math.abs(lead) <= 6 && rem < 0.15;
  // Team scoring for the rest of the game: mostly the pre-game rate, partly the pace seen so far.
  const live48 = (L.hs + L.as) / elapsed, w = Math.min(0.4, elapsed * 0.5);
  const restTot = rem * ((1 - w) * preTot + w * live48) + (closeLate ? 3 : 0);
  const restH = restTot * (g.pred.hs / preTot), restA = restTot - restH;
  const projH = L.hs + restH, projA = L.as + restA;
  const margin = lead + preM * rem, sd = 1.5 + 13.5 * Math.sqrt(rem);
  const pHome = 1 - pNorm((0 - margin) / sd);
  const whyTeam = [];
  if (blowout) whyTeam.push(`Blowout developing (${Math.abs(lead)}-point lead): starters on both sides are expected to sit, bench minutes rise.`);
  if (closeLate) whyTeam.push("Close finish: starters play more, and late fouling adds free throws (about +3 points to the total).");
  if (ot) whyTeam.push("Overtime: extra minutes for the starters.");
  if (w > 0.05 && Math.abs(live48 - preTot) > 8) whyTeam.push(`Pace so far points to ${f0(live48)} total points over 48 minutes versus ${f0(preTot)} projected; the rest of the game leans ${Math.round(w * 100)}% on the live pace.`);
  // Players
  const players = [];
  const goneLive = new Set([...L.box.entries()].filter(([, b]) => b.pf >= 6 || b.ej).map(([id]) => id));
  const lateQ = L.period >= 4 || (L.period === 3 && rem < 0.3);
  for (const t of [away, home]) {
    const myLead = t.isHome ? lead : -lead;
    for (const p of (t.players || []).filter((x) => x.min >= 8)) {
      const c = L.box.get(String(p.id)) || { min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, pf: 0, dnp: 1 };
      const why = [];
      // Minutes left: his usual share of the game, blended with tonight's actual rotation (counts more as the game goes on).
      const shPre = Math.min(1, p.min / 48), shNow = Math.min(1, c.min / Math.max(1, elapsed * 48));
      const wMin = c.min > 0 ? Math.min(0.65, elapsed * 0.9) : 0;
      let restMin = rem * 48 * ((1 - wMin) * shPre + wMin * shNow);
      if (wMin > 0.2 && shNow > shPre * 1.25) why.push(`playing more than usual tonight (${c.min} min so far)`);
      else if (wMin > 0.2 && shNow < shPre * 0.7 && c.min > 0) why.push(`playing less than usual tonight (${c.min} min so far)`);
      if (c.dnp || c.ej || c.pf >= 6) { restMin = 0; why.push(c.pf >= 6 ? "fouled out" : c.ej ? "ejected" : "has not played"); }
      else if (c.min === 0 && elapsed > 0.45) { restMin = 0; why.push("has not played yet: treated as out"); }
      else {
        if (c.pf >= 5 && rem > 0.1) { restMin *= 0.55; why.push(`${c.pf} fouls: minutes cut`); }
        else if (c.pf >= 4 && L.period <= 3) { restMin *= 0.8; why.push(`${c.pf} fouls before the 4th: minutes trimmed`); }
        // Game script from his own history (our scenario library), falling back to general rules.
        const bo = p.ix?.blowout, fl = p.ix?.flow;
        const bigLead = myLead >= 15 && lateQ, bigDef = myLead <= -15 && lateQ, tight = L.period >= 4 && Math.abs(lead) <= 6;
        const lateShare = Math.min(1, rem / 0.25); // blowout minutes are lost in the last quarter
        if (bigLead || bigDef) {
          const rec = bigLead ? bo?.ifWinBig : bo?.ifLoseBig;
          if (rec && !bo.small && rec.games >= 5) {
            restMin = Math.max(0, restMin + rec.min * lateShare * (blowout ? 1 : 0.6));
            why.push(`${bigLead ? "big lead" : "big deficit"}: in his ${rec.games} games like this he played ${rec.min > 0 ? "+" : ""}${f1(rec.min)} min`);
          } else if (blowout) { if (p.min >= 26) { restMin *= 0.45; why.push(bigLead ? "blowout lead: likely rests" : "blowout deficit: may be pulled"); } else { restMin *= 1.6; why.push("blowout: extra garbage-time minutes"); } }
        } else if (blowout && p.min < 26) { restMin *= 1.6; why.push("blowout: extra garbage-time minutes"); }
        if (tight) {
          const tf = fl?.tight4th;
          if (tf && !tf.small && tf.games >= 8 && p.min >= 26) { restMin *= 1.15; why.push(`tight 4th: closes games for his team (${tf.games} close 4th quarters on record)`); }
          else if (closeLate && p.min >= 26) { restMin *= 1.2; why.push("close finish: plays more"); }
        }
        if (ot && p.min >= 26) { restMin += 4; why.push("overtime minutes"); }
      }
      // Scoring rate: his normal per-minute rate, nudged by his record in tonight's live game script.
      let ptsAdj36 = 0;
      { const fl = p.ix?.flow, st = myLead >= 12 ? fl?.ahead : myLead <= -12 ? fl?.behind : (L.period >= 4 && Math.abs(lead) <= 6) ? fl?.tight4th : null;
        if (st && !st.small && st.games >= 8 && Math.abs(st.vsUsual36) >= 1.5) { ptsAdj36 = st.vsUsual36 * Math.min(1, elapsed * 1.5); why.push(`${myLead >= 12 ? "when ahead" : myLead <= -12 ? "when behind" : "in tight 4th quarters"} he scores ${st.vsUsual36 > 0 ? "+" : ""}${f1(st.vsUsual36)} per 36 min (${st.games} games)`); } }
      // Live absences: a teammate or a key defender who has fouled out or been ejected.
      let absAdj = 0;
      for (const w of p.wwD || []) if (goneLive.has(String(w.id)) && Math.abs(w.pts) >= 0.8) { absAdj += w.pts * rem; why.push(`${shortName(w.n)} out of the game: he averages ${w.without?.ppg ?? "-"} without vs ${w.with?.ppg ?? "-"} with`); }
      for (const d of p.dm?.defenders || []) if (goneLive.has(String(d.id)) && d.share >= 10 && d.vsExpPct < -3) { absAdj += (p.pts || 0) * (-d.vsExpPct / 100) * (d.share / 100) * rem; why.push(`main defender ${shortName(d.n)} is out of the game`); }
      const rate = (k) => (p[k] || 0) / Math.max(1, p.min) + (k === "pts" ? ptsAdj36 / 36 : 0);
      const proj = (k) => Math.max(c[k] || 0, (c[k] || 0) + rate(k) * restMin + (k === "pts" ? absAdj : 0));
      const line = Math.round((p.pts || 0) - 0.5) + 0.5;
      const sdP = Math.max(0.6, (((p.hi ?? p.pts + 7) - (p.lo ?? p.pts - 7)) / 2.56) * Math.sqrt(Math.max(0.01, restMin / Math.max(1, p.min))));
      const pOver = c.pts > line ? 1 : restMin === 0 ? 0 : 1 - pNorm((line - proj("pts")) / sdP);
      if ((c.tpa || 0) >= 5 && p.tpa > 0.5) { const norm = (p.tpm || 0) / p.tpa, now = c.tpm / c.tpa; if (Math.abs(now - norm) >= 0.2) why.push(`${now > norm ? "hot" : "cold"} from three (${c.tpm}/${c.tpa} vs his usual ${pct(norm)}): rest of game assumes normal shooting`); }
      players.push({ id: p.id, n: p.n, t: t.tid, cur: c, restMin, pre: p, scen: p.scen || [], trust: p.trust, live: { pts: proj("pts"), reb: proj("reb"), ast: proj("ast"), tpm: proj("tpm") }, line, pOver, why });
    }
  }
  const ex = liveExtras(g, L, { players, home, away, rem, elapsed, lead, preM, preTot, restH, restA, projH, projA, margin, sd, pHome, live48, blowout, closeLate, ot });
  for (const p of players) { p.props = livePlayerProps(p); p.restOut = p.restMin === 0; }
  return { rem, lead, projH, projA, projTot: projH + projA, margin, sd, pHome, whyTeam, players, blowout, closeLate, ...ex };
}
const half = (v) => Math.round(v - 0.5) + 0.5;
function livePlayerProps(p) {
  const frac = Math.sqrt(Math.max(0.01, p.restMin / Math.max(1, p.pre.min)));
  const out = {};
  for (const [k, base] of [["pts", null], ["reb", 1.15], ["ast", 1.2], ["tpm", 1.1]]) {
    const pre = p.pre[k] || 0; if (k !== "pts" && pre < 1) continue;
    const line = half(pre), proj = p.live[k], cur = p.cur[k] || 0;
    const sdK = k === "pts" ? Math.max(0.6, (((p.pre.hi ?? pre + 7) - (p.pre.lo ?? pre - 7)) / 2.56) * frac) : Math.max(0.35, base * Math.sqrt(Math.max(0.5, pre)) * frac);
    const pOver = cur > line ? 1 : p.restMin === 0 ? 0 : 1 - pNorm((line - proj) / sdK);
    out[k] = { line, proj, cur, pOver, sd: sdK };
  }
  const pra = (p.live.pts || 0) + (p.live.reb || 0) + (p.live.ast || 0), praPre = (p.pre.pts || 0) + (p.pre.reb || 0) + (p.pre.ast || 0), praCur = (p.cur.pts || 0) + (p.cur.reb || 0) + (p.cur.ast || 0);
  const praLine = half(praPre), praSd = Math.max(0.8, 1.25 * Math.sqrt(Math.max(1, praPre)) * frac * 1.1);
  out.pra = { sd: praSd, line: praLine, proj: pra, cur: praCur, pOver: praCur > praLine ? 1 : p.restMin === 0 ? 0 : 1 - pNorm((praLine - pra) / praSd) };
  return out;
}
// Quarter, half, total, team total, spread and situation reads for a game in progress.
function liveExtras(g, L, c) {
  const { home, away, rem, elapsed, lead, preM, preTot, restH, restA, projH, projA, margin, sd, pHome, live48 } = c;
  const clk = String(L.clock || "0:00").split(":"), qSec = clk.length === 2 ? n0(clk[0]) * 60 + n0(clk[1]) : n0(clk[0]);
  const per = L.period || 0, done = L.state === "post";
  const qRem = per >= 1 && per <= 4 && !done ? qSec / 720 : 0;
  const qH = home.quarters?.proj || Array(4).fill(g.pred.hs / 4), qA = away.quarters?.proj || Array(4).fill(g.pred.as / 4);
  const lsH = L.ls?.h || [], lsA = L.ls?.a || [];
  const share = (q) => (per > 4 || done ? 0 : q < per - 1 ? 0 : q === per - 1 ? qRem : 1);
  const rawH = qH.reduce((t, v, q) => t + v * share(q), 0), rawA = qA.reduce((t, v, q) => t + v * share(q), 0);
  const quarters = [0, 1, 2, 3].map((q) => {
    const sh = share(q), status = sh === 0 ? "final" : q === per - 1 ? "live" : "next";
    const aH = lsH[q] ?? 0, aA = lsA[q] ?? 0;
    const pH = status === "final" ? aH : aH + (rawH ? (qH[q] * sh / rawH) * restH : 0);
    const pA = status === "final" ? aA : aA + (rawA ? (qA[q] * sh / rawA) * restA : 0);
    const m = pH - pA, qsd = status === "live" ? 0.8 + 6.5 * Math.sqrt(sh) : 7, tsd = status === "live" ? 0.8 + 7.5 * Math.sqrt(sh) : 8;
    const pH_ = status === "final" ? (aH > aA ? 1 : aH < aA ? 0 : 0.5) : 1 - pNorm(-m / qsd);
    const tLine = half(qH[q] + qA[q]);
    const pOver = status === "final" ? (aH + aA > tLine ? 1 : 0) : 1 - pNorm((tLine - (pH + pA)) / tsd);
    return { q: q + 1, status, aH, aA, pH, pA, pHome: pH_, tLine, pOver, qsd, tsd };
  });
  const halfRow = (a, b) => {
    const st = a.status === "final" && b.status === "final" ? "final" : a.status === "next" && b.status === "next" ? "next" : "live";
    const pH = a.pH + b.pH, pA = a.pA + b.pA, sh = share(a.q - 1) + share(b.q - 1);
    const hsd = st === "final" ? 0 : 0.8 + 9.5 * Math.sqrt(sh / 2) * 1.414 / 1.414;
    return { st, pH, pA, pHome: st === "final" ? (pH > pA ? 1 : pH < pA ? 0 : 0.5) : 1 - pNorm(-(pH - pA) / Math.max(1, hsd)) };
  };
  const halves = per <= 4 ? [halfRow(quarters[0], quarters[1]), halfRow(quarters[2], quarters[3])] : null;
  // Game total
  const projTot = projH + projA, sdTot = 2 + 15 * Math.sqrt(rem), preLine = half(preTot);
  const overAt = (line) => (L.hs + L.as > line ? 1 : 1 - pNorm((line - projTot) / sdTot));
  const liveLine = half(projTot);
  const totAlts = [-10, -5, 0, 5, 10].map((d) => ({ line: liveLine + d, pOver: overAt(liveLine + d) }));
  // Team totals
  const sdT = 1.5 + 10.5 * Math.sqrt(rem);
  const team = (proj, cur, pre) => {
    const line = half(pre), at = (x) => (cur > x ? 1 : 1 - pNorm((x - proj) / sdT));
    const m0 = Math.floor(proj / 10) * 10;
    return { proj, cur, sdT, line, pOver: at(line), miles: [m0 - 10, m0, m0 + 10].filter((x) => x > cur).map((x) => ({ x, p: at(x - 0.5) })) };
  };
  const tH = team(projH, L.hs, g.pred.hs), tA = team(projA, L.as, g.pred.as);
  // Spread: our pre-game line and live alternatives
  const preFav = preM >= 0 ? "h" : "a", preLineS = half(Math.abs(preM));
  const favMargin = preFav === "h" ? margin : -margin;
  const coverPre = 1 - pNorm((preLineS - favMargin) / sd);
  const liveFav = margin >= 0 ? "h" : "a", liveS = half(Math.abs(margin));
  const spreadAlts = [-6, -3, 0, 3, 6].map((d) => liveS + d).filter((x) => x > 0).map((x) => ({ line: x, p: 1 - pNorm((x - Math.abs(margin)) / sd) }));
  // Overtime and winning-margin bands
  const pOT = done ? 0 : pNorm((0.5 - margin) / sd) - pNorm((-0.5 - margin) / sd);
  const band = (lo, hi) => (pNorm((hi + 0.5 - margin) / sd) - pNorm((lo - 0.5 - margin) / sd));
  const bands = [
    { k: "h", lab: "by 11+", p: 1 - pNorm((10.5 - margin) / sd) }, { k: "h", lab: "by 6-10", p: band(6, 10) }, { k: "h", lab: "by 1-5", p: band(1, 5) },
    { k: "a", lab: "by 1-5", p: band(-5, -1) }, { k: "a", lab: "by 6-10", p: band(-10, -6) }, { k: "a", lab: "by 11+", p: pNorm((-10.5 - margin) / sd) },
  ];
  // Situation reads from the live box score, compared with our pre-game view.
  const reads = [];
  const ab = (x) => T(x === "h" ? g.home : g.away).abbr;
  const expLead = preM * elapsed;
  if (elapsed > 0.1 && Math.abs(lead - expLead) >= 6) reads.push({ ic: "📈", t: `${ab(lead - expLead > 0 ? "h" : "a")} is ${f0(Math.abs(lead - expLead))} points better than our projection for this stage. The rest of the game still uses the pre-game strength, so part of the gap is expected to close.` });
  const preDog = preM >= 0 ? "a" : "h", pDog = preDog === "h" ? pHome : 1 - pHome;
  if (pDog >= 0.5) reads.push({ ic: "🚨", t: `Upset watch: our pre-game underdog ${ab(preDog)} now wins ${pct(pDog)} of the time from here.` });
  if (per >= 1 && per <= 4 && quarters[per - 1]) { const cq = quarters[per - 1], d = cq.aH - cq.aA; if (Math.abs(d) >= 8) reads.push({ ic: "🔥", t: `${ab(d > 0 ? "h" : "a")} has won this quarter by ${Math.abs(d)} so far. The model does not chase runs: teams usually drift back toward their normal level.` }); }
  const tb = L.tb || {};
  const st3 = (m) => { const p = String(m?.["threePointFieldGoalsMade-threePointFieldGoalsAttempted"] || "0-0").split("-").map(n0); return { m: p[0], a: p[1], pct: p[1] ? p[0] / p[1] : 0 }; };
  for (const k of ["h", "a"]) {
    const x = st3(tb[k]);
    if (x.a >= 12 && Math.abs(x.pct - 0.36) >= 0.11) reads.push({ ic: x.pct > 0.36 ? "🎯" : "🧊", t: `${ab(k)} is ${x.pct > 0.36 ? "hot" : "cold"} from three: ${x.m} of ${x.a} (${pct(x.pct)}). Shooting streaks rarely last, so the rest of the game assumes normal shooting${x.pct > 0.36 ? ", which is a risk to their lead or total" : ", which favours a comeback in their scoring"}.` });
  }
  if (tb.h && tb.a) {
    const to = n0(tb.h.totalTurnovers ?? tb.h.turnovers) - n0(tb.a.totalTurnovers ?? tb.a.turnovers);
    if (Math.abs(to) >= 5) reads.push({ ic: "🔄", t: `Turnovers: ${ab(to > 0 ? "a" : "h")} has ${Math.abs(to)} fewer, which means extra shots. Turnover gaps tend to shrink as the game goes on.` });
    const orb = n0(tb.h.offensiveRebounds) - n0(tb.a.offensiveRebounds);
    if (Math.abs(orb) >= 6) reads.push({ ic: "🧱", t: `${ab(orb > 0 ? "h" : "a")} leads offensive rebounds by ${Math.abs(orb)}: second chances are driving the score. Size and effort edges like this tend to hold more than shooting does.` });
    const fta = (m) => n0(String(m?.["freeThrowsMade-freeThrowsAttempted"] || "0-0").split("-")[1]);
    const fd = fta(tb.h) - fta(tb.a);
    if (Math.abs(fd) >= 10) reads.push({ ic: "🎟️", t: `${ab(fd > 0 ? "h" : "a")} has ${Math.abs(fd)} more free-throw attempts: they are getting to the line and putting the other side in foul trouble.` });
    const lc = n0(tb.h.leadChanges);
    if (lc >= 10 && Math.abs(lead) <= 6) reads.push({ ic: "⚖️", t: `${lc} lead changes and a ${Math.abs(lead)}-point game: a true toss-up, so late possessions and free throws decide it.` });
  }
  if (false && elapsed > 0.15 && Math.abs(live48 - preTot) >= 12) reads.push({ ic: "⏱️", t: `Pace: scoring is running at ${f0(live48)} points per 48 minutes against our ${f0(preTot)}. The live total leans partly on the pace seen so far.` });
  if (pOT >= 0.06) reads.push({ ic: "➕", t: `Overtime chance ${pct(pOT)}: close enough that a tie at the end of regulation is a real outcome.` });
  const scenTrack = (g.scenarios?.list || []).slice(0, 6).map((sc) => {
    let status = "context";
    const am = String(sc.t || "").match(/^(.+?) has averaged ([\d.]+) points in the \d+ games/);
    const pl = am && (c.players || []).find((x) => x.n === am[1]);
    if (pl && elapsed > 0.12) { const d = pl.live.pts - Number(am[2]); status = d >= 1.5 ? "playing out" : d <= -1.5 ? "not so far" : "too close to tell"; return { t: sc.t + ` Tonight's live projection: ${f1(pl.live.pts)}.`, kind: sc.kind, n: sc.n, sample: sc.sample, status }; }
    if (sc.fav && elapsed > 0.12) { const fh = String(sc.fav) === String(g.home); const vsExp = (lead - expLead) * (fh ? 1 : -1); status = vsExp >= 3 ? "playing out" : vsExp <= -3 ? "not so far" : "too close to tell"; }
    return { t: sc.t, kind: sc.kind, n: sc.n, sample: sc.sample, status };
  });
  return { scenTrack, quarters, halves, totals: { projTot, preLine, pOverPre: overAt(preLine), liveLine, alts: totAlts, sdTot }, teamTot: { h: tH, a: tA }, spread: { preFav, preLineS, coverPre, liveFav, liveS, alts: spreadAlts }, pOT, bands, reads };
}
function liveEngineCard(g, L, M) {
  const home = g.home, away = g.away, ph = M.pHome;
  const spread = Math.round(Math.abs(M.margin) - 0.5) + 0.5, favLive = M.margin >= 0 ? home : away;
  const rows = M.players.filter((p) => p.restMin > 0 || p.cur.min > 0).sort((a, b) => b.live.pts - a.live.pts).slice(0, 10);
  const liveTag = L.src === "live" ? `<span class="lv-dot" aria-hidden="true"></span><b>LIVE</b>` : `<b>Snapshot</b>`;
  return `<div class="card live-card" data-tab-of="lv" id="live-engine">
    <div class="lv-h">${liveTag}<h2 style="margin:0">In-game prediction</h2><span class="small muted">${esc(L.detail)} · ${L.src === "live" ? `live · updates every 5 s · ${esc(new Date(L.fetched).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }))}` : `from the last refresh, ${esc(ago2(L.fetched))} (live updates need the public site)`}</span></div>
    <div class="lv-score"><div><small>${esc(T(away).abbr)}</small><strong>${esc(L.as)}</strong></div><div class="lv-mid">${Math.round((1 - M.rem) * 48)} of 48 min</div><div class="r"><small>${esc(T(home).abbr)}</small><strong>${esc(L.hs)}</strong></div></div>
    ${M.chg ? `<div class="small lv-chg">${M.chg}</div>` : `<div class="small muted lv-chg">Watching for the next score change…</div>`}
    <div class="h2-wc"><div><small>Live win chance</small><strong>${pct(1 - ph)}</strong></div><div class="wp" aria-hidden="true"><span style="flex:${1 - ph}"></span><span style="flex:${ph}"></span></div><div class="r"><small>${esc(T(home).abbr)}</small><strong>${pct(ph)}</strong></div></div>
    <div class="pr-row"><span class="pr-k">Live moneyline</span><span class="pr-v"><b>${esc(T(ph >= 0.5 ? home : away).abbr)} to win</b><i>${Math.max(ph, 1 - ph) >= 0.98 ? "game is nearly decided: no meaningful price" : `fair odds ${esc(T(home).abbr)} ${mlTxt(ph)} · ${esc(T(away).abbr)} ${mlTxt(1 - ph)}`}</i></span><span class="pr-p">${pct(Math.max(ph, 1 - ph))}</span></div>
    <div class="pr-row"><span class="pr-k">Live spread</span><span class="pr-v"><b>${esc(T(favLive).abbr)} ${spreadTxt(spread)}</b><i>projected final margin ${esc(T(favLive).abbr)} by ${f1(Math.abs(M.margin))}</i></span></div>
    <div class="pr-row"><span class="pr-k">Live total</span><span class="pr-v"><b>${f1(M.projTot)}</b><i>pre-game ${f1(g.pred.hs + g.pred.as)} · now ${esc(L.hs + L.as)}</i></span></div>
    <div class="pr-row"><span class="pr-k">Team totals</span><span class="pr-v"><b>${esc(T(away).abbr)} ${f1(M.projA)} · ${esc(T(home).abbr)} ${f1(M.projH)}</b><i>projected finals</i></span></div>
    ${S.mkt && S.mkt.id === g.id ? livePicksCard(g, L, M, S.mkt) : `<p class="small muted">Live odds loading… our live picks appear here once the sportsbook feed arrives.</p>`}
    ${liveMarkets(g, L, M)}
    ${S.mkt && S.mkt.id === g.id ? marketCard(g, L, M, S.mkt) : ""}
    <p class="small muted" style="margin-top:8px">Starts from our pre-game projection and scenario library, then uses the live score, time left, pace and each player's line so far. Remaining minutes use his normal scoring rate, so a hot or cold start is expected to even out. Lines are the pre-game prop lines; no betting odds are used.</p></div>`;
}
function liveMarkets(g, L, M) {
  const A = T(g.away).abbr, H = T(g.home).abbr, ab = (k) => (k === "h" ? H : A);
  const tag = (st) => `<span class="lvq-tag ${st}">${st === "final" ? "Final" : st === "live" ? "Live" : "Proj"}</span>`;
  const winQ = (p) => (Math.abs(p - 0.5) < 0.02 ? "even" : `${esc(p >= 0.5 ? H : A)} ${pct(Math.max(p, 1 - p))}`);
  const ou = (p) => (p >= 0.5 ? `O ${pct(p)}` : `U ${pct(1 - p)}`);
  const qRows = (M.quarters || []).map((q) => `<tr class="${q.status}"><td>Q${q.q} ${tag(q.status)}</td><td class="n">${q.status === "final" ? esc(q.aA) : f1(q.pA)}</td><td class="n">${q.status === "final" ? esc(q.aH) : f1(q.pH)}</td><td class="n">${q.status === "final" ? esc(q.aA + q.aH) : f1(q.pA + q.pH)}<br><span class="muted small">${esc(q.tLine)} · ${q.status === "final" ? (q.aA + q.aH > q.tLine ? "over" : "under") : ou(q.pOver)}</span></td><td class="n">${q.status === "final" ? esc(q.aH > q.aA ? H : q.aH < q.aA ? A : "tie") : winQ(q.pHome)}</td></tr>`).join("");
  const hRows = M.halves ? M.halves.map((h, i) => `<tr class="half"><td>${i ? "2nd half" : "1st half"} ${tag(h.st)}</td><td class="n">${h.st === "final" ? f0(h.pA) : f1(h.pA)}</td><td class="n">${h.st === "final" ? f0(h.pH) : f1(h.pH)}</td><td class="n">${h.st === "final" ? f0(h.pA + h.pH) : f1(h.pA + h.pH)}</td><td class="n">${h.st === "final" ? esc(h.pH > h.pA ? H : h.pH < h.pA ? A : "tie") : winQ(h.pHome)}</td></tr>`).join("") : "";
  const T_ = M.totals, S_ = M.spread, tt = M.teamTot;
  const chip = (lab, p, good) => `<span class="lvc ${p >= 0.7 ? "hi" : p <= 0.3 ? "lo" : ""}"><b>${lab}</b> ${pct(p)}</span>`;
  const propChip = (k, lab, x) => (x ? `<span class="lvc ${x.pOver >= 0.7 ? "hi" : x.pOver <= 0.3 ? "lo" : ""}" title="${esc(lab)}"><b>${lab}</b> ${f1(x.proj)} <i>o${esc(x.line)}</i> ${pct(x.pOver)}</span>` : "");
  const rows = M.players.filter((p) => p.restMin > 0 || p.cur.min > 0).sort((a, b) => b.live.pts - a.live.pts).slice(0, 12);
  return `
    <h3>Quarter by quarter</h3>
    <div class="tw"><table class="lvq"><thead><tr><th></th><th class="n">${esc(A)}</th><th class="n">${esc(H)}</th><th class="n">Total · line</th><th class="n">Wins it</th></tr></thead><tbody>${qRows}${hRows}</tbody></table></div>
    <p class="small muted">Finished quarters are real scores. The live quarter adds what is left of it; later quarters use our pre-game quarter pattern for each team, scaled to the live pace. Quarter lines are our pre-game quarter projections.</p>

    <h3>Game total</h3>
    <div class="pr-row"><span class="pr-k">Projected</span><span class="pr-v"><b>${f1(T_.projTot)}</b><i>now ${esc(L.hs + L.as)} · pre-game ${f1(g.pred.hs + g.pred.as)} · range about ${f0(T_.projTot - 1.28 * T_.sdTot)}-${f0(T_.projTot + 1.28 * T_.sdTot)}</i></span></div>
    <div class="pr-row"><span class="pr-k">Our line ${esc(T_.preLine)}</span><span class="pr-v"><b>${T_.pOverPre >= 0.5 ? "Over" : "Under"}</b><i>against the pre-game total line</i></span><span class="pr-p">${pct(Math.max(T_.pOverPre, 1 - T_.pOverPre))}</span></div>
    <div class="lvchips">${T_.alts.map((x) => chip(`O ${x.line}`, x.pOver)).join("")}</div>

    <h3>Team totals</h3>
    ${["a", "h"].map((k) => { const x = tt[k]; return `<div class="pr-row"><span class="pr-k">${esc(ab(k))} ${f1(x.proj)}</span><span class="pr-v"><b>${x.pOver >= 0.5 ? "Over" : "Under"} ${esc(x.line)}</b><i>${x.miles.map((m) => `reaches ${m.x}: ${pct(m.p)}`).join(" · ") || "milestones passed"}</i></span><span class="pr-p">${pct(Math.max(x.pOver, 1 - x.pOver))}</span></div>`; }).join("")}

    <h3>Spread and margin</h3>
    <div class="pr-row"><span class="pr-k">Our pre-game line</span><span class="pr-v"><b>${esc(ab(S_.preFav))} -${esc(S_.preLineS)}</b><i>${S_.coverPre >= 0.5 ? `${esc(ab(S_.preFav))} covers` : `${esc(ab(S_.preFav === "h" ? "a" : "h"))} +${esc(S_.preLineS)} covers`}</i></span><span class="pr-p">${pct(Math.max(S_.coverPre, 1 - S_.coverPre))}</span></div>
    <div class="lvchips">${S_.alts.map((x) => chip(`${esc(ab(S_.liveFav))} -${x.line}`, x.p)).join("")}</div>
    <div class="lvbands">${M.bands.map((b) => `<div class="${b.k}"><span>${esc(ab(b.k))} ${esc(b.lab)}</span><i style="width:${Math.round(b.p * 100)}%"></i><b>${pct(b.p)}</b></div>`).join("")}</div>
    ${M.pOT >= 0.005 ? `<p class="small">Overtime chance: <b>${pct(M.pOT)}</b></p>` : ""}

    ${M.whyTeam.length || M.reads.length ? `<h3>Live scenarios</h3><ul class="lvreads">${M.whyTeam.map((t) => `<li><span aria-hidden="true">⚡</span><span>${esc(t)}</span></li>`).join("")}${M.reads.map((r) => `<li><span aria-hidden="true">${r.ic}</span><span>${esc(r.t)}</span></li>`).join("")}</ul>` : ""}

    ${(M.scenTrack || []).length ? `<h3>Tonight's scenarios, live check</h3><ul class="lvreads">${M.scenTrack.map((x) => `<li><span aria-hidden="true">${x.status === "playing out" ? "✅" : x.status === "not so far" ? "❌" : x.status === "too close to tell" ? "➖" : "📌"}</span><span>${esc(x.t)} <b class="lvs ${x.status.replace(/ /g, "-")}">${esc(x.status)}</b>${x.sample ? ` <span class="muted small">(${esc(x.sample)} sample)</span>` : ""}</span></li>`).join("")}</ul><p class="small muted">From our pre-game scenario library. "Playing out" means the favoured side is beating our projection for this stage of the game.</p>` : ""}
    ${rows.length ? `<h3>Live player props</h3><div class="lvp">${rows.map((p) => `<div class="lvp-r"><div class="lvp-h"><b>${esc(shortName(p.n))}</b> <span class="muted">${esc(T(p.t).abbr)}</span><span class="small muted"> · ~${f0(p.restMin)} min left</span></div>
      <div class="lvline small"><span><b>${esc(p.cur.pts)}</b> pts</span><span><b>${esc(p.cur.reb)}</b> reb</span><span><b>${esc(p.cur.ast)}</b> ast</span>${p.cur.fga != null ? `<span>FG ${esc(p.cur.fgm)}/${esc(p.cur.fga)}</span><span>3P ${esc(p.cur.tpm)}/${esc(p.cur.tpa)}</span><span>FT ${esc(p.cur.ftm)}/${esc(p.cur.fta)}</span>` : ""}<span>${esc(p.cur.min)} min</span>${p.cur.pf ? `<span>${esc(p.cur.pf)} fouls</span>` : ""}${p.cur.pm != null ? `<span class="${p.cur.pm > 0 ? "up" : p.cur.pm < 0 ? "down" : ""}">${p.cur.pm > 0 ? "+" : ""}${esc(p.cur.pm)}</span>` : ""}</div>
      ${(p.scen || []).filter((x) => Math.abs(x.pts) >= 0.3).length ? `<div class="small muted">Pre-game scenarios: ${p.scen.filter((x) => Math.abs(x.pts) >= 0.3).map((x) => `${esc(x.s)} ${x.pts > 0 ? "+" : ""}${f1(x.pts)} pts`).join(" · ")}</div>` : ""}
      <div class="lvchips">${propChip("pts", "PTS", p.props.pts)}${propChip("reb", "REB", p.props.reb)}${propChip("ast", "AST", p.props.ast)}${propChip("tpm", "3PM", p.props.tpm)}${propChip("pra", "PRA", p.props.pra)}</div>
      ${p.why.length ? `<div class="small" style="color:var(--warn)">${esc(p.why.join("; "))}</div>` : ""}</div>`).join("")}</div>
      <p class="small muted">Each chip: projected final, our pre-game line, and the chance he goes over it. Minutes and scoring for the rest of the game use his own record in the live game script (big lead, big deficit, tight 4th quarter), teammates or defenders leaving the game, foul trouble and tonight's rotation.</p>` : ""}`;
}
// ---------------- Betting market comparison (display only: never used by our projections or learning)
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const amP = (a) => { const v = Number(String(a ?? "").replace("+", "")); return !v ? null : v < 0 ? -v / (-v + 100) : 100 / (v + 100); };
const noVig = (a, b) => { const x = amP(a), y = amP(b); return x == null || y == null ? null : x / (x + y); };
const amTxt = (a) => decOdds(a);
function parseProps(pb, tid) {
  const groups = new Map();
  for (const x of pb?.items || []) {
    const ath = String(x.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1] || "", team = tid(x) || "";
    const tgt = x.current?.target?.value ?? x.odds?.total?.value ?? "";
    const key = [x.type?.name, ath, team, tgt].join("|");
    if (!groups.has(key)) groups.set(key, { type: x.type?.name, ath, team, line: Number(tgt), odds: [] });
    groups.get(key).odds.push(Number(x.odds?.american?.value));
  }
  return [...groups.values()];
}
async function marketFetch(id, keepProps) {
  const bust = `_=${Math.floor(Date.now() / 5000)}`; // ESPN's CDN caches odds for up to 15 minutes without this
  const base = `${ESPN_CORE}/events/${id}/competitions/${id}/odds`;
  const j = await fetch(`${base}?lang=en&region=us&${bust}`, { cache: "no-store" }).then((r) => r.json());
  const items = j.items || [];
  const liveIt = items.find((x) => /live/i.test(x.provider?.name || "")), preIt = items.find((x) => !/live/i.test(x.provider?.name || ""));
  const it = liveIt || preIt;
  if (!it) return null;
  const tid = (o) => String(o?.team?.$ref || "").match(/teams\/(\d+)/)?.[1];
  const side = (o) => ({ ml: Number(o?.current?.moneyLine?.american ?? o?.moneyLine), sp: Number(o?.current?.pointSpread?.american ?? NaN), spo: Number(o?.current?.spread?.american ?? o?.spreadOdds), tid: tid(o) });
  const lines = (x) => (x ? { total: Number(x.overUnder), over: Number(x.current?.over?.american ?? x.overOdds), under: Number(x.current?.under?.american ?? x.underOdds), away: side(x.awayTeamOdds), home: side(x.homeTeamOdds) } : null);
  const m = { id, live: !!liveIt, book: (it.provider?.name || "Sportsbook").replace(/\s*-\s*Live Odds/i, ""), at: new Date().toISOString(), ...lines(it), pre: liveIt ? lines(preIt) : null, props: keepProps?.props || null, preProps: keepProps?.preProps || null };
  const pb = async (pid) => (pid ? fetch(`${base}/${pid}/propBets?lang=en&region=us&limit=1000&${bust}`, { cache: "no-store" }).then((r) => r.json()) : null);
  if (!m.props) { try { m.props = parseProps(await pb(it.provider?.id), tid); } catch { m.props = []; } }
  // Pre-game props barely change once the game starts, so fetch them once per game.
  if (!m.preProps && liveIt && preIt) { try { m.preProps = parseProps(await pb(preIt.provider?.id), tid); } catch { m.preProps = []; } }
  return m;
}
// Our live picks at the sportsbook's live lines: our side, the live price, our chance vs the book's fair chance, EV.
// Our chance comes from our live model only; the odds only set the line and price we compare against.
function livePicks(g, L, M, m) {
  const H = T(g.home).abbr, A = T(g.away).abbr, homeId = String(g.home), awayId = String(g.away);
  const dec = (a) => { const v = Number(a); return !v ? null : v > 0 ? 1 + v / 100 : 1 + 100 / -v; };
  const out = [], amB = (v) => decOdds(v);
  const add = (o) => { if (o.ours == null || !Number.isFinite(o.ours) || o.ours <= 0.5 || o.ours >= 0.995) return; const d = dec(o.price); o.ev = d ? o.ours * d - 1 : null; o.gap = o.book != null ? o.ours - o.book : null; o.wrong = o.gap != null && Math.abs(o.gap) >= 0.1; o.qual = !o.wrong && o.gap != null && o.ev != null && o.gap >= 0.03 && o.ev >= 0.02; out.push(o); };
  const sideP = (pOver, line, price2, label, kind, tag, extra = {}) => { const over = pOver >= 0.5; const pr = over ? price2[0] : price2[1]; const bk = noVig(price2[0], price2[1]); add({ tag, kind, bk: `Over ${line} ${amB(price2[0])} · Under ${line} ${amB(price2[1])}`, pick: `${over ? "Over" : "Under"} ${line}`, label, price: pr, ours: over ? pOver : 1 - pOver, book: bk == null ? null : over ? bk : 1 - bk, ...extra }); };
  // game moneyline
  const mH = noVig(m.home.ml, m.away.ml);
  if (mH != null) { const home = M.pHome >= 0.5; add({ tag: "Game", kind: "Moneyline", bk: `${A} ${amB(m.away.ml)} · ${H} ${amB(m.home.ml)}`, pick: `${home ? H : A} to win`, price: home ? m.home.ml : m.away.ml, ours: home ? M.pHome : 1 - M.pHome, book: home ? mH : 1 - mH }); }
  // game spread (home handicap)
  if (Number.isFinite(m.home.sp)) { const hl = m.home.sp, pH = 1 - pNorm((-hl - M.margin) / M.sd), bk = noVig(m.home.spo, m.away.spo); const home = pH >= 0.5;
    add({ tag: "Game", kind: "Spread", bk: `${A} ${-hl > 0 ? "+" : ""}${-hl} ${amB(m.away.spo)} · ${H} ${hl > 0 ? "+" : ""}${hl} ${amB(m.home.spo)}`, pick: home ? `${H} ${hl > 0 ? "+" : ""}${hl}` : `${A} ${-hl > 0 ? "+" : ""}${-hl}`, price: home ? m.home.spo : m.away.spo, ours: home ? pH : 1 - pH, book: bk == null ? null : home ? bk : 1 - bk, note: `our margin ${M.margin >= 0 ? H : A} by ${f1(Math.abs(M.margin))}` }); }
  // game total
  if (Number.isFinite(m.total)) { const T_ = M.totals, pO = L.hs + L.as > m.total ? 1 : 1 - pNorm((m.total - T_.projTot) / T_.sdTot); sideP(pO, m.total, [m.over, m.under], "", "Total", "Game", { note: `our total ${f1(T_.projTot)}` }); }
  const P = m.props || [], pair2 = (x) => [x.odds[0], x.odds[1]];
  // team totals
  for (const x of P.filter((y) => y.type === "Team Total Points" && y.odds.length >= 2)) {
    const k = x.team === homeId ? "h" : x.team === awayId ? "a" : null; if (!k) continue; const t = M.teamTot[k];
    const pO = t.cur > x.line ? 1 : 1 - pNorm((x.line - t.proj) / t.sdT);
    sideP(pO, x.line, pair2(x), "", `${k === "h" ? H : A} team total`, "Game", { note: `our ${k === "h" ? H : A} ${f1(t.proj)}` });
  }
  // quarters still to finish
  for (const q of (M.quarters || []).filter((q) => q.status !== "final")) {
    const name = ["1st", "2nd", "3rd", "4th"][q.q - 1] + " Quarter", tag = `Q${q.q}${q.status === "live" ? " live" : ""}`;
    const tot = P.find((x) => x.type === `${name} Total` && x.odds.length >= 2);
    if (tot) sideP(1 - pNorm((tot.line - (q.pH + q.pA)) / q.tsd), tot.line, pair2(tot), "", `Q${q.q} total`, tag, { note: `our Q${q.q} ${f1(q.pH + q.pA)}` });
    const mls = P.filter((x) => x.type === `${name} Moneyline`), hm = mls.find((x) => x.team === homeId), am = mls.find((x) => x.team === awayId);
    if (hm && am) { const home = q.pHome >= 0.5, bk = noVig(hm.odds[0], am.odds[0]); add({ tag, kind: `Q${q.q} winner`, bk: `${A} ${amB(am.odds[0])} · ${H} ${amB(hm.odds[0])}`, pick: `${home ? H : A} wins Q${q.q}`, price: home ? hm.odds[0] : am.odds[0], ours: home ? q.pHome : 1 - q.pHome, book: bk == null ? null : home ? bk : 1 - bk }); }
    const sps = P.filter((x) => x.type === `${name} Spread` && x.team);
    const hs = sps.find((x) => x.team === homeId), as = sps.find((x) => x.team === awayId);
    if (hs) { const mH2 = q.pH - q.pA, pH2 = 1 - pNorm((-hs.line - mH2) / q.qsd), home = pH2 >= 0.5, bk = as ? noVig(hs.odds[0], as.odds[0]) : null;
      add({ tag, kind: `Q${q.q} spread`, bk: `${A} ${-hs.line > 0 ? "+" : ""}${-hs.line} ${amB(as?.odds[0])} · ${H} ${hs.line > 0 ? "+" : ""}${hs.line} ${amB(hs.odds[0])}`, pick: home ? `${H} ${hs.line > 0 ? "+" : ""}${hs.line}` : `${A} ${-hs.line > 0 ? "+" : ""}${-hs.line}`, price: home ? hs.odds[0] : as?.odds[0], ours: home ? pH2 : 1 - pH2, book: bk == null ? null : home ? bk : 1 - bk, note: `our Q${q.q} ${A} ${f1(q.pA)} - ${f1(q.pH)} ${H}` }); }
  }
  // overtime
  const ot = P.find((x) => x.type === "Will There Be Overtime?" && x.odds.length >= 2);
  if (ot && M.pOT != null) { const yes = M.pOT >= 0.5, bk = noVig(ot.odds[0], ot.odds[1]); add({ tag: "Game", kind: "Overtime", bk: `Yes ${amB(ot.odds[0])} · No ${amB(ot.odds[1])}`, pick: yes ? "Overtime: yes" : "Overtime: no", price: yes ? ot.odds[0] : ot.odds[1], ours: yes ? M.pOT : 1 - M.pOT, book: bk == null ? null : yes ? bk : 1 - bk }); }
  // player props at the live lines
  const TYPES = { "Total Points": ["pts", "points"], "Total Rebounds": ["reb", "rebounds"], "Total Assists": ["ast", "assists"], "Total 3-Point Field Goals": ["tpm", "threes"], "Total Points, Rebounds, and Assists": ["pra", "pts+reb+ast"] };
  const props = [];
  for (const pl of M.players) for (const x of P.filter((y) => y.ath === String(pl.id) && TYPES[y.type] && y.odds.length >= 2)) {
    const [k, word] = TYPES[x.type], o = pl.props?.[k]; if (!o) continue;
    const pO = o.cur > x.line ? 1 : pl.restOut ? 0 : 1 - pNorm((x.line - o.proj) / o.sd);
    const before = out.length; sideP(pO, x.line, pair2(x), shortName(pl.n), `${shortName(pl.n)} ${word}`, "Player", { note: `now ${f1(o.cur)} · our proj ${f1(o.proj)}` });
    if (out.length > before) props.push(out.pop());
  }
  props.sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0));
  return { game: out, props: props.filter((x) => x.gap != null && x.gap >= 0.03).slice(0, 10) };
}
function livePicksCard(g, L, M, m) {
  if (!m.live) return `<div class="lp-card"><h3>Our live picks</h3><p class="small muted">Waiting for the sportsbook's live odds. Picks appear only against live lines, never against stale pre-game lines.</p></div>`;
  const lp = livePicks(g, L, M, m); if (!lp.game.length && !lp.props.length) return "";
  const amT = (a) => decOdds(a);
  const row = (x) => `<div class="lp-row ${x.wrong ? "lp-w" : x.qual ? "lp-q" : x.gap != null && x.gap >= 0.02 ? "lp-l" : "lp-n"}">
      <div class="lp-top"><span class="lp-tag">${esc(x.tag)}</span><span class="lp-k">${esc(x.kind)}</span>${x.qual ? '<span class="lp-star" title="Qualifying edge">★ edge</span>' : ""}</div>
      <div class="lp-mid"><span class="lp-pick">${esc(x.pick)}</span><span class="lp-price">${esc(amT(x.price))}</span></div>
      ${x.bk ? `<div class="lp-bk small"><span class="lp-bkl">Bookmaker</span> ${esc(x.bk)}</div>` : ""}
      <div class="lp-num small"><span>Ours <b>${pct(x.ours)}</b></span><span>Book fair ${x.book != null ? pct(x.book) : "-"}</span><span class="${(x.gap ?? 0) > 0 ? "up" : "down"}">gap ${x.gap != null ? (x.gap > 0 ? "+" : "") + Math.round(x.gap * 100) : "-"}</span>${S.pkBlend && x.ev != null ? `<span class="${x.ev > 0 ? "up" : "down"}">EV ${x.ev > 0 ? "+" : ""}${(x.ev * 100).toFixed(1)}%</span>` : ""}${S.pkBlend && x.book != null && decOdds(x.price) !== "-" ? `<span class="blend-ev">market-blended EV ${(() => { const v = (0.3 * x.ours + 0.7 * x.book) * Number(decOdds(x.price)) - 1; return (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%"; })()}</span>` : ""}${x.note ? `<span class="muted">${esc(x.note)}</span>` : ""}</div></div>`;
  const order = (a, b) => (b.qual - a.qual) || ((b.gap ?? -1) - (a.gap ?? -1));
  return `<div class="lp-card"><h3>Our live picks <span class="mk-badge">live odds · ${esc(m.book)}</span></h3>
    <label class="small blend-tog"><input type="checkbox" data-blend-live ${S.pkBlend ? "checked" : ""}> Show market-blended EV (reference only)</label>
    <div class="lp-legend small"><span class="lp-key q">★ edge: ours 3-10 pts above the book, EV +2%</span><span class="lp-key w">⚠ 10+ pts apart: large disagreement, not an edge</span><span class="lp-key l">Lean: small edge</span><span class="lp-key n">Our side, no edge</span></div>
    ${lp.game.sort(order).map(row).join("")}
    ${lp.props.length ? `<h4 class="lp-h4">Player props</h4>${lp.props.sort(order).map(row).join("")}` : ""}
    <p class="small muted">The highlighted pill is our pick. Our chance comes only from our live model (pre-game analysis + live score, clock, pace, fouls and rotation); the live odds only set the line and price. Lines move every few seconds, so a price can be gone by the time you see it. Not betting advice.</p></div>`;
}
function marketCard(g, L, M, m) {
  const H = T(g.home).abbr, A = T(g.away).abbr;
  const homeId = String(g.home), awayId = String(g.away);
  const rows = [];
  const diffCls = (d) => (Math.abs(d) >= 0.1 ? "big" : Math.abs(d) >= 0.05 ? "mid" : "");
const pre = m.pre;
  const baseTxt = (b) => (b ? `<tr class="mk-base"><td colspan="5"><span class="mk-pre">Pre-game</span> ${b}</td></tr>` : "");
  const row = (k, book, ours, mkt, note, base) => {
    const d = ours != null && mkt != null ? ours - mkt : null;
    rows.push(`<tr><td>${k}</td><td class="n">${book}</td><td class="n">${mkt != null ? pct(mkt) : "-"}</td><td class="n"><b>${ours != null ? pct(ours) : "-"}</b></td><td class="n mk-d ${d != null ? diffCls(d) : ""}">${d != null ? (d > 0 ? "+" : "") + Math.round(d * 100) : ""}</td></tr>${baseTxt(base)}${note ? `<tr class="mk-note"><td colspan="5">${note}</td></tr>` : ""}`);
  };
  const ourPre = { h: g.pred.hs, a: g.pred.as, pH: g.pred.pHome };
  // Moneyline
  const mH = noVig(m.home.ml, m.away.ml);
  const preH = pre ? noVig(pre.home.ml, pre.away.ml) : null;
  const mlBase = (isH) => (preH != null ? `${amTxt(isH ? pre.home.ml : pre.away.ml)}: book ${pct(isH ? preH : 1 - preH)} · our pre-game ${pct(isH ? ourPre.pH : 1 - ourPre.pH)} → now ${pct(isH ? M.pHome : 1 - M.pHome)}` : "");
  if (mH != null) { row(`${esc(H)} to win`, amTxt(m.home.ml), M.pHome, mH, "", mlBase(true)); row(`${esc(A)} to win`, amTxt(m.away.ml), 1 - M.pHome, 1 - mH, "", mlBase(false)); }
  // Spread (home line)
  const hLine = Number.isFinite(m.home.sp) ? m.home.sp : null;
  if (hLine != null) {
    const pCov = 1 - pNorm((-hLine - M.margin) / M.sd);
    const mk = noVig(m.home.spo, m.away.spo);
    const pl = pre && Number.isFinite(pre.home.sp) ? pre.home.sp : null;
    const sb = pl != null ? `${esc(H)} ${pl > 0 ? "+" : ""}${pl} (moved ${hLine - pl > 0 ? "+" : ""}${f1(hLine - pl)}): book ${pct(noVig(pre.home.spo, pre.away.spo) ?? 0.5)} · our pre-game margin ${esc(ourPre.h >= ourPre.a ? H : A)} by ${f1(Math.abs(ourPre.h - ourPre.a))} · we now cover it ${pct(1 - pNorm((-pl - M.margin) / M.sd))}` : "";
    row(`${esc(H)} ${hLine > 0 ? "+" : ""}${hLine}`, amTxt(m.home.spo), pCov, mk, `Our projected margin now: ${esc(M.margin >= 0 ? H : A)} by ${f1(Math.abs(M.margin))}`, sb);
  }
  // Total
  if (Number.isFinite(m.total)) {
    const T_ = M.totals, pO = L.hs + L.as > m.total ? 1 : 1 - pNorm((m.total - T_.projTot) / T_.sdTot);
    const pt = pre && Number.isFinite(pre.total) ? pre.total : null;
    const tb = pt != null ? `${pt} (moved ${m.total - pt > 0 ? "+" : ""}${f1(m.total - pt)}): book over ${pct(noVig(pre.over, pre.under) ?? 0.5)} · our pre-game total ${f1(ourPre.h + ourPre.a)} · we now say over ${pct(L.hs + L.as > pt ? 1 : 1 - pNorm((pt - T_.projTot) / T_.sdTot))}` : "";
    row(`Over ${m.total}`, amTxt(m.over), pO, noVig(m.over, m.under), `Our projected total now: ${f1(T_.projTot)}`, tb);
  }
  const P = m.props || [];
  const pair = (x) => (x.odds.length >= 2 ? noVig(x.odds[0], x.odds[1]) : null);
  // Team totals
  for (const x of P.filter((x) => x.type === "Team Total Points")) {
    const k = x.team === homeId ? "h" : x.team === awayId ? "a" : null; if (!k) continue;
    const t = M.teamTot[k]; const ours = t.cur > x.line ? 1 : 1 - pNorm((x.line - t.proj) / t.sdT);
    const px = (m.preProps || []).find((y) => y.type === "Team Total Points" && y.team === x.team && y.odds.length >= 2);
    const base = px ? `${px.line}: book over ${pct(pair(px) ?? 0.5)} · our pre-game ${f1(k === "h" ? ourPre.h : ourPre.a)} · we now say over ${pct(t.cur > px.line ? 1 : 1 - pNorm((px.line - t.proj) / t.sdT))}` : "";
    row(`${esc(k === "h" ? H : A)} over ${x.line}`, amTxt(x.odds[0]), ours, pair(x), "", base);
  }
  // Quarters (current and next)
  for (const q of (M.quarters || []).filter((q) => q.status !== "final")) {
    const name = ["1st", "2nd", "3rd", "4th"][q.q - 1] + " Quarter";
    const tot = P.find((x) => x.type === `${name} Total`);
    if (tot) { const ours = 1 - pNorm((tot.line - (q.pH + q.pA)) / q.tsd); row(`Q${q.q} over ${tot.line}`, amTxt(tot.odds[0]), ours, pair(tot)); }
    const mls = P.filter((x) => x.type === `${name} Moneyline`);
    const hm = mls.find((x) => x.team === homeId), am = mls.find((x) => x.team === awayId);
    if (hm && am) row(`Q${q.q} ${esc(H)} wins`, amTxt(hm.odds[0]), q.pHome, noVig(hm.odds[0], am.odds[0]));
    else if (mls.length) { const x = mls.find((y) => y.odds.length >= 2); if (x) row(`Q${q.q} ${esc(H)} wins`, amTxt(x.odds[0]), q.pHome, pair(x)); }
  }
  // Overtime
  const ot = P.find((x) => x.type === "Will There Be Overtime?");
  if (ot && ot.odds.length >= 2) row("Overtime", amTxt(ot.odds[0]), M.pOT, pair(ot));
  // Player props at the bookmaker's live lines
  const TYPES = { "Total Points": "pts", "Total Rebounds": "reb", "Total Assists": "ast", "Total 3-Point Field Goals": "tpm", "Total Points, Rebounds, and Assists": "pra" };
  const LAB = { pts: "PTS", reb: "REB", ast: "AST", tpm: "3PM", pra: "PRA" };
  const prow = [];
  for (const pl of M.players) {
    for (const x of P.filter((y) => y.ath === String(pl.id) && TYPES[y.type] && y.odds.length >= 2)) {
      const k = TYPES[x.type], o = pl.props?.[k]; if (!o) continue;
      const ours = o.cur > x.line ? 1 : pl.restOut ? 0 : 1 - pNorm((x.line - o.proj) / o.sd);
      const mk = pair(x); if (mk == null) continue;
      const px = (m.preProps || []).filter((y) => y.ath === x.ath && y.type === x.type && y.odds.length >= 2).sort((a, b) => Math.abs(pair(a) - 0.5) - Math.abs(pair(b) - 0.5))[0];
      const preOurs = px ? (o.cur > px.line ? 1 : pl.restOut ? 0 : 1 - pNorm((px.line - o.proj) / o.sd)) : null;
      const preVal = k === "pra" ? (pl.pre.pts || 0) + (pl.pre.reb || 0) + (pl.pre.ast || 0) : pl.pre[k] || 0;
      prow.push({ pl, k, line: x.line, odds: x.odds[0], ours, mk, d: ours - mk, proj: o.proj, cur: o.cur, preLine: px?.line, preMk: px ? pair(px) : null, preOurs, preVal });
    }
  }
  prow.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const ptab = prow.slice(0, 15).map((x) => `<tr><td>${esc(shortName(x.pl.n))} <span class="muted">${LAB[x.k]}</span><br><span class="muted small">now ${esc(f1(x.cur))} · proj ${f1(x.proj)}</span></td><td class="n">o${esc(x.line)}<br><span class="muted small">${amTxt(x.odds)}</span></td><td class="n">${pct(x.mk)}</td><td class="n"><b>${pct(x.ours)}</b></td><td class="n mk-d ${diffCls(x.d)}">${x.d > 0 ? "+" : ""}${Math.round(x.d * 100)}</td></tr>
    <tr class="mk-base"><td colspan="5"><span class="mk-pre">Pre-game</span> ${x.preLine != null ? `book o${esc(x.preLine)} (${pct(x.preMk ?? 0.5)}) · ` : ""}our pre-game ${f1(x.preVal)}${x.preLine != null ? ` · we now say over o${esc(x.preLine)} ${pct(x.preOurs)}` : ""}${x.preLine != null ? ` · line moved ${x.line - x.preLine > 0 ? "+" : ""}${f1(x.line - x.preLine)}` : ""}</td></tr>`).join("");
  return `<div class="mk">
    <h3>Market comparison <span class="mk-badge">${m.live ? "live odds" : "pre-game odds"} · ${esc(m.book)}</span></h3>
    <p class="small muted">Live line first: the bookmaker's price turned into a fair chance (their margin removed) next to our chance at the same line. The <b>Pre-game</b> line under each one shows the bookmaker's pre-game line, our own pre-game baseline, and our chance at that line now, so you can see how the game has moved both. <b>Gap</b> = ours minus theirs, in percentage points; 10+ is a real disagreement. Shown for comparison only: odds never feed our projections or learning.</p>
    <div class="tw"><table class="mk-t"><thead><tr><th>Market</th><th class="n">Price</th><th class="n">Book</th><th class="n">Ours</th><th class="n">Gap</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
    ${ptab ? `<h3>Player props vs the book <span class="mk-badge">biggest gaps first</span></h3><div class="tw"><table class="mk-t"><thead><tr><th>Player</th><th class="n">Line</th><th class="n">Book</th><th class="n">Ours</th><th class="n">Gap</th></tr></thead><tbody>${ptab}</tbody></table></div>
    <p class="small muted">Over side at the bookmaker's current live line. Our chance uses our live projection and range for that player.</p>` : ""}
    <p class="small muted">Odds from ESPN's DraftKings feed, updated about every 15-30 seconds. Not betting advice; for adults where betting is legal.</p></div>`;
}
async function liveQuick(id) {
  // Score, clock and period only, from the small scoreboard feed.
  const ymd = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + o * 864e5)).replace(/-/g, "");
  for (const day of [ymd(0), ymd(-1)]) {
    const sb = await espnJSON(`scoreboard?dates=${day}`);
    const ev = (sb.events || []).find((e) => e.id === String(id)); if (!ev) continue;
    const c = ev.competitions[0], h = c.competitors.find((x) => x.homeAway === "home"), a = c.competitors.find((x) => x.homeAway === "away");
    const lsq = (x) => (x.linescores || []).map((y) => n0(y.displayValue ?? y.value));
    return { state: ev.status?.type?.state, detail: ev.status?.type?.shortDetail || "", period: ev.status?.period || 0, clock: ev.status?.displayClock || "0:00", hs: n0(h.score), as: n0(a.score), ls: { h: lsq(h), a: lsq(a) } };
  }
  return null;
}
// What changed since the last score change: time, score, and how the live win chance and total moved.
function liveChange(g, L, M) {
  S.lvPrev ||= {};
  const p = S.lvPrev[g.id], snap = { t: L.fetched, hs: L.hs, as: L.as, ph: M.pHome, tot: M.projTot, chg: p?.chg || "" };
  if (p && (p.hs !== L.hs || p.as !== L.as)) {
    const H = T(g.home).abbr, A = T(g.away).abbr, fav = M.pHome >= 0.5 ? "h" : "a", fp = (x) => (fav === "h" ? x : 1 - x), d = Math.round((fp(M.pHome) - fp(p.ph)) * 100);
    const who = [L.as - p.as > 0 ? `${A} +${L.as - p.as}` : "", L.hs - p.hs > 0 ? `${H} +${L.hs - p.hs}` : ""].filter(Boolean).join(", ");
    snap.chg = `<b>Last change</b> ${esc(new Date(L.fetched).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }))} (${esc(who)}): ${esc(fav === "h" ? H : A)} win chance ${pct(fp(p.ph))} → <b>${pct(fp(M.pHome))}</b> (${d >= 0 ? "+" : ""}${d}), projected total ${f1(p.tot)} → <b>${f1(M.projTot)}</b>`;
  }
  S.lvPrev[g.id] = snap; M.chg = snap.chg; return M;
}
async function startLive(g) {
  clearInterval(S.liveTimer);
  let tick = 0, last = null;
  const draw = async () => {
    if (!S.curGame || S.curGame.id !== g.id || !document.body.contains(app)) { clearInterval(S.liveTimer); return; }
    if (document.hidden) return; // pause while the phone screen or tab is not showing
    let L = null;
    if (!last || tick % LIVE_BOX_EVERY === 0 || last.src !== "live") L = await liveFetch(g.id);
    else { try { const q = await liveQuick(g.id); L = q ? { ...last, ...q, fetched: new Date().toISOString() } : last; } catch { L = last; } }
    tick++; if (L) last = L;
    if (L && L.state === "in" && (tick % LIVE_BOX_EVERY === 1 || !S.mkt || S.mkt.id !== g.id)) { try { S.mkt = await marketFetch(g.id, !S.mkt || S.mkt.id !== g.id ? null : { props: tick % (LIVE_BOX_EVERY * 2) === 1 ? null : S.mkt.props, preProps: S.mkt.preProps }); } catch { /* market feed is optional */ } }
    if (!L || L.state === "pre" || !L.state) return;
    if (L.state === "post") { clearInterval(S.liveTimer); }
    const html = L.state === "post" ? liveCard({ ...(await liveOf(g.id) || {}), state: "post", hs: L.hs, as: L.as, home: g.home, away: g.away, preH: g.pred.hs, preA: g.pred.as, called: (L.hs > L.as) === (g.pred.hs > g.pred.as) }) : liveEngineCard(g, L, liveChange(g, L, liveModel(g, L)));
const old = app.querySelector("#live-engine, .live-card");
    if (old) old.outerHTML = html; else app.querySelector(".hero")?.insertAdjacentHTML("afterend", html);
    const c = app.querySelector("#live-engine, .live-card"); if (c) { c.id = "live-engine"; c.dataset.tabOf = "lv"; c.hidden = (S.gTab || "ov") !== "lv"; }
    // Overview: a one-line live strip that opens the Live tab
    const mini = `<div class="card live-mini" id="live-mini" data-tab-of="ov">${L.state === "post" ? "<b>Final</b>" : '<span class="lv-dot" aria-hidden="true"></span><b>LIVE</b>'} <span>${esc(L.detail)} · ${esc(T(g.away).abbr)} ${esc(L.as)} - ${esc(L.hs)} ${esc(T(g.home).abbr)}</span>${L.state === "in" ? (() => { const ph = liveModel(g, L).pHome; return ` <span class="muted">· ${esc(T(ph >= 0.5 ? g.home : g.away).abbr)} ${pct(Math.max(ph, 1 - ph))}</span>`; })() : ""}<button type="button" class="btn sm" data-gt-go="lv">Open Live tab ›</button></div>`;
    const om = app.querySelector("#live-mini");
    if (om) om.outerHTML = mini; else app.querySelector(".gtabs")?.insertAdjacentHTML("afterend", mini);
    const nm = app.querySelector("#live-mini"); if (nm) nm.hidden = (S.gTab || "ov") !== "ov";
    const lt = app.querySelector(".gtab-live"); if (lt && L.state === "in" && !lt.querySelector(".lv-dot")) lt.insertAdjacentHTML("afterbegin", '<span class="lv-dot" aria-hidden="true"></span>');
  };
  await draw();
  S.liveTimer = setInterval(draw, LIVE_POLL_MS);
}

// Games list: refresh live scores in place every 8 s while any game is in progress (paused when the screen is off).
const SCORE_POLL_MS = 8000;
function startScoreTicker() {
  if (S.sbTimer) return;
  S.sbTimer = setInterval(async () => {
    const strips = app.querySelectorAll(".lv-strip[data-lv]");
    if (!strips.length) { if (!["", "#", "#/", "#/games", "#games"].includes(location.hash)) { clearInterval(S.sbTimer); S.sbTimer = null; } return; }
    if (document.hidden || !(S.liveData?.games || []).some((x) => x.state === "in")) return;
    await liveScoreboard();
    for (const el of app.querySelectorAll(".lv-strip[data-lv]")) {
      const lv = (S.liveData?.games || []).find((x) => x.id === el.dataset.lv);
      if (lv) el.outerHTML = liveBadge(lv);
    }
  }, SCORE_POLL_MS);
}
// Games list: today's live scores straight from ESPN (falls back silently to the saved snapshot).
async function liveScoreboard() {
  try {
    const up = await load("upcoming.json");
    const pre = new Map(up.map((u) => [u.id, u]));
    const day = (o) => { const d = new Date(Date.now() + o * 864e5); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, ""); };
    const games = [];
    for (const d of [day(-1), day(0)]) {
      const sb = await espnJSON(`scoreboard?dates=${d}`);
      for (const ev of sb.events || []) {
        const st = ev.status?.type?.state; if (st === "pre") continue;
        const c = ev.competitions[0], h = c.competitors.find((x) => x.homeAway === "home"), a = c.competitors.find((x) => x.homeAway === "away");
        const row = { id: ev.id, state: st, detail: ev.status?.type?.shortDetail || "", home: h.team.id, away: a.team.id, hs: n0(h.score), as: n0(a.score), period: ev.status?.period, clock: ev.status?.displayClock };
        const p = pre.get(ev.id);
        if (p && st === "in") { const rem = remShare(row.period, row.clock); const m = row.hs - row.as + (p.pred.hs - p.pred.as) * rem; row.pHome = 1 - pNorm(-m / (1.5 + 13.5 * Math.sqrt(rem))); }
        if (p && st === "post") row.called = (row.hs > row.as) === (p.pred.hs > p.pred.as);
        games.push(row);
      }
    }
    S.liveData = { fetched: new Date().toISOString(), games, src: "live" };
  } catch { /* host blocks outside requests: keep the snapshot */ }
}

// Local debugging only (never on the public site): exposes the live engine for testing on localhost.
if (["localhost", "127.0.0.1"].includes(location.hostname)) window.__cl = { S, liveFetch, liveModel, liveChange, marketFetch, livePicks, livePicksCard };
