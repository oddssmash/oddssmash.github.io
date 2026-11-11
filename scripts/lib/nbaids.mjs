// NBA.com person id -> ESPN athlete id.
// NBA.com feeds (matchups, daily line-ups) name players by NBA person id; the rest of the
// project uses ESPN ids. data/nbaids.json keeps every pairing found so far, so a player is
// matched once and stays matched. Layout: docs/DATA-RAW.md, section "nbaids.json".
import path from "node:path";
import { DATA, readJSON, writeJSON } from "./util.mjs";
import { normName } from "./stats.mjs";

const FILE = path.join(DATA, "nbaids.json");

export function loadIdMap() {
  const j = readJSON(FILE, {});
  return { format: 1, map: j.map || {}, names: j.names || {}, how: j.how || {} };
}
export function saveIdMap(m) {
  writeJSON(FILE, {
    format: 1,
    note: "NBA.com person id -> ESPN athlete id, matched by normalised name inside the same team (game box score or current roster). 'how': box = same game's box score, roster = team roster, last = unique last name in the team, seed = NBA.com season table name matched to a roster name.",
    updated: new Date().toISOString(), count: Object.keys(m.map).length, map: m.map, names: m.names, how: m.how,
  });
}

const lastOf = (s) => normName(String(s || "").trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)).pop() || "");

// candidates: [{ id: espnId, n: name }] players of the same team (box score of the game, or roster).
// Returns the ESPN id or null. Records a new pairing in m with the given source tag.
export function matchPerson(m, nbaId, name, candidates, tag = "box") {
  const key = String(nbaId);
  const cand = candidates.filter((c) => c && c.id);
  const known = m.map[key];
  if (known && (!cand.length || cand.some((c) => String(c.id) === known))) return known;
  const nn = normName(name);
  let hit = cand.filter((c) => normName(c.n) === nn);
  let how = tag;
  if (hit.length !== 1) {
    // same last name and first initial, then unique last name within the team
    const ln = lastOf(name), fi = nn[0];
    const sameLast = cand.filter((c) => lastOf(c.n) === ln);
    hit = sameLast.filter((c) => normName(c.n)[0] === fi);
    if (hit.length !== 1) hit = sameLast;
    how = "last";
  }
  if (hit.length !== 1) return known || null; // keep an older pairing when the team list cannot confirm it
  const id = String(hit[0].id);
  m.map[key] = id; m.names[key] = name; m.how[key] = how;
  return id;
}

// One-off seed: NBA.com season tables (data/nbazones.json players) matched to roster names.
export function seedFromTables(m, rosters, zones) {
  const byName = new Map();
  for (const t of Object.values(rosters || {})) for (const p of t.players || []) byName.set(normName(p.n), String(p.id));
  let added = 0;
  for (const S of Object.values(zones?.seasons || {})) {
    for (const [k, row] of Object.entries(S.players || {})) {
      const id = String(row[0]);
      if (m.map[id] || !byName.has(k)) continue;
      m.map[id] = byName.get(k); m.names[id] = row[1]; m.how[id] = "seed"; added++;
    }
  }
  return added;
}
