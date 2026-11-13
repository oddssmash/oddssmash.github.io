// MLBB tournaments the MLBB section follows (Liquipedia page titles). Each stage page holds the matches with full
// drafts. Stages that do not exist for a season are skipped by the fetcher. Add a new season here; the fetcher
// picks it up on the next run. Each league is its own region; international events link the regions.
const STAGES = ["Regular Season", "Playoffs", "Group Stage", "League Stage", "Knockout Stage", "Play-in"];
const league = (base, label, region, seasons, stages = STAGES) => seasons.flatMap((s) => stages.map((st) => ({ page: `${base}/${s}/${st}`, league: label, season: s.replace("Season ", "S"), stage: st, region, kind: "league" })));
// one event with explicit stage pages ("" = the event page itself)
const ev = (base, label, region, kind, stages) => stages.map((st) => ({ page: st ? `${base}/${st}` : base, league: label, season: base.split("/").slice(1).join(" ") || base, stage: st || "Main", region, kind }));
const S = (...n) => n.map((x) => `Season ${x}`);
export const EVENTS = [
  ...league("MPL/Philippines", "MPL PH", "PH", S(16, 17, 18)),
  ...league("MPL/Indonesia", "MPL ID", "ID", S(16, 17, 18)),
  ...league("MPL/Malaysia", "MPL MY", "MY", S(16, 17, 18)),
  ...league("MPL/Cambodia", "MPL KH", "KH", S(9, 10, 11)),
  ...league("MPL/Singapore", "MPL SG", "SG", S(10, 11, 12)),
  ...league("MPL/MENA", "MPL MENA", "MENA", S(8, 9, 10)),
  ...league("MPL/Myanmar", "MPL MM", "MM", S(3, 4, 5)),
  ...league("MPL/Brazil", "MPL BR", "BR", S(3, 4, 5)),
  ...league("MPL/LATAM", "MPL LATAM", "LATAM", S(2, 3, 4)),
  ...league("MTC Turkiye Championship", "MTC TR", "TR", S(6, 7, 8)),
  ...league("MLBB China Masters", "MLBB China Masters", "CN", S(2, 3)),
  ...[{ page: "MLBB Japan League/2024/Mainstage", league: "MLBB Japan League", season: "2024", stage: "Mainstage", region: "JP", kind: "league" }],
  ...league("MLBB Continental Championships", "MCC", "CIS", S(6, 7, 8)),
  ...league("BetBoom Rise of Legends", "BetBoom RoL", "CIS", S(9, 10, 11)), // the other CIS league; shares MCC's region so their teams' ratings link
  { page: "BetBoom Rise of Legends/Season 10/Regular Season/1st Division", league: "BetBoom RoL", season: "S10", stage: "Regular Season", region: "CIS", kind: "league" },
  ...league("MLBB Super League/Thailand", "MSL TH", "TH", S(1, 2)),
  ...["Group Stage", "Knockout Stage"].map((st) => ({ page: `MCT/2026/East Asia/Split 2/${st}`, league: "MCT EA 2026", season: "2026", stage: st, region: "EA", kind: "intl" })),
  ...["Swiss Stage", "Playoffs"].flatMap((st) => ["Split 1", "Split 2"].map((sp) => ({ page: `MCT/2026/Americas/${sp}/${st}`, league: "MCT AMER 2026", season: sp, stage: st, region: "AMER", kind: "intl" }))),
  // international
  ...["Group Stage", "Knockout Stage", "Playoffs"].map((st) => ({ page: `MCT/2026/Southeast Asia/${st}`, league: "MCT SEA 2026", season: "2026", stage: st, region: "INTL", kind: "intl" })),
  ...["Wildcard", "Group Stage", "Knockout Stage"].map((st) => ({ page: `MSC/2026/${st}`, league: "MSC 2026", season: "2026", stage: st, region: "INTL", kind: "intl" })),
  ...["Wildcard", "Swiss Stage", "Knockout Stage"].map((st) => ({ page: `M7 World Championship/${st}`, league: "M7", season: "M7", stage: st, region: "INTL", kind: "intl" })),
  ...["Wildcard", "Swiss Stage", "Knockout Stage"].map((st) => ({ page: `M8 World Championship/${st}`, league: "M8", season: "M8", stage: st, region: "INTL", kind: "intl" })),
  // other pro events running now (added 2026-11-13). Missing stage pages are skipped; a few events keep matches on the main page.
  ...ev("GG Gaming Festival/2026/Men", "GG Fest 2026", "INTL", "intl", ["", "Group Stage", "Playoffs"]),
  ...ev("GG Gaming Festival/2026/Women", "GG Fest 2026 Women", "WOMEN", "league", ["", "Group Stage", "Playoffs"]),
  ...league("MLBB Super League/Myanmar", "MSL MM", "MM", S(4)),
  ...ev("SURGE/MLBB European Championship/Season 3", "SURGE EU S3", "EU", "league", ["", "Group Stage", "Playoffs"]),
  ...ev("Mahar Invitational Cup/2026/Season 3", "Mahar Cup S3", "MM", "intl", ["", "Group Stage", "Playoffs"]),
  ...ev("M Challenge Cup/Mekong/Season 7", "MCC Mekong S7", "INTL", "intl", ["", "Group Stage", "Playoffs"]),
  ...ev("Esports Nations Cup/2026", "Esports Nations Cup 2026", "INTL", "intl", ["", "Group Stage", "Playoffs"]),
  ...ev("Global Esports Games/2026/Open", "GEG 2026", "INTL", "intl", ["", "Group Stage", "Playoffs"]),
  ...ev("IESF/World Esports Championship/2026", "IESF WEC 2026", "INTL", "intl", ["", "Group Stage", "Playoffs"]),
];
// Liquipedia lists each game's five picks in role order.
export const ROLES = ["EXP", "Jungle", "Mid", "Gold", "Roam"];
