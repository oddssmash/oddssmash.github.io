// FIBA competitions the FIBA section follows. Each is an event page on fiba.basketball.
// kind: "nt" = national teams, "club" = club competition. Ratings are kept separately per pool.
// Add a new season or window here; the fetcher picks up its games on the next run.
export const EVENTS = [
  // national teams: 2027 World Cup qualifiers (all four regions) and the 2025 continental cups
  { slug: "fiba-basketball-world-cup-2027-asian-qualifiers", name: "World Cup 2027 Qualifiers: Asia", short: "WCQ Asia", kind: "nt" },
  { slug: "fiba-basketball-world-cup-2027-european-qualifiers", name: "World Cup 2027 Qualifiers: Europe", short: "WCQ Europe", kind: "nt" },
  { slug: "fiba-basketball-world-cup-2027-americas-qualifiers", name: "World Cup 2027 Qualifiers: Americas", short: "WCQ Americas", kind: "nt" },
  { slug: "fiba-basketball-world-cup-2027-african-qualifiers", name: "World Cup 2027 Qualifiers: Africa", short: "WCQ Africa", kind: "nt" },
  { slug: "fiba-eurobasket-2025", name: "EuroBasket 2025", short: "EuroBasket", kind: "nt" },
  { slug: "fiba-americup-2025", name: "AmeriCup 2025", short: "AmeriCup", kind: "nt" },
  { slug: "fiba-asia-cup-2025", name: "Asia Cup 2025", short: "Asia Cup", kind: "nt" },
  { slug: "fiba-afrobasket-2025", name: "AfroBasket 2025", short: "AfroBasket", kind: "nt" },
  { slug: "fiba-basketball-world-cup-2027", name: "World Cup 2027", short: "World Cup", kind: "nt" },
  // clubs
  { slug: "fiba-europe-cup-25-26", name: "FIBA Europe Cup 2025-26", short: "Europe Cup", kind: "club" },
  { slug: "fiba-europe-cup-26-27", name: "FIBA Europe Cup 2026-27", short: "Europe Cup", kind: "club" },
  { slug: "basketball-champions-league-americas-25-26", name: "BCL Americas 2025-26", short: "BCL Americas", kind: "club" },
  { slug: "basketball-champions-league-americas-26-27", name: "BCL Americas 2026-27", short: "BCL Americas", kind: "club" },
  { slug: "liga-sudamericana-de-baloncesto-fiba-2026", name: "Liga Sudamericana 2026", short: "Liga Sudamericana", kind: "club" },
  { slug: "fiba-intercontinental-cup-2026", name: "Intercontinental Cup 2026", short: "Intercontinental Cup", kind: "club" },
];
