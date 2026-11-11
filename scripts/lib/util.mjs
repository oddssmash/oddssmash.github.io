// Shared helpers: paths, JSON io, polite fetching with retry.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA = path.join(ROOT, "data");
export const PUBLIC_DATA = path.join(ROOT, "public", "data");

export function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
export function writeJSON(file, obj, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "nba-analyzer/1.0 (personal stats project)" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await sleep(1000 * 2 ** i);
    }
  }
  throw new Error(`Failed ${url}: ${last?.message}`);
}

// Run async tasks with a concurrency cap.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// YYYYMMDD helpers (ESPN uses US Eastern calendar dates).
export function ymd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
export function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
export function easternToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts.replace(/-/g, "");
}

// Owner rule: no betting content anywhere. True for a news item whose title, summary or link is
// about odds, bets, props, sportsbooks or their promotions. Used when news is saved (fetch.mjs)
// and again when it is read (context.mjs), so an old archive cannot leak an item onto the site.
const BETTING_RE = /\b(odds|betting|bets?|bettors?|sportsbooks?|parlays?|props?|prop bets?|money ?lines?|point spreads?|against the spread|over\/under|promo codes?|promos?|wager(s|ing|ed)?|gambl(e|ing)|draftkings|fanduel|betmgm|bet365|caesars sportsbook|sportsline|picks against)\b/i;
export function isBetting(item) {
  if (!item) return false;
  if (/\/betting\//i.test(String(item.url || ""))) return true;
  return BETTING_RE.test(`${item.title || ""} ${item.summary || ""}`);
}
