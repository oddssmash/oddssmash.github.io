// Sportsbook lines ESPN publishes for upcoming games. FOR COMPARISON ONLY.
// Owner rule: these numbers are shown only in the Simulation and High-confidence tabs, next to the
// model's own numbers. They never feed projections, learning, scenarios or the simulation's
// inputs. They live in data/odds.json only (never in data/games, data/schedule or data/pbp), and
// scripts/checks.mjs fails the refresh if odds fields show up in any file the model reads.
// Layout: docs/DATA-RAW.md, section "odds.json".

const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const x = Number(String(v).replace(/^[ou]/i, "").replace("+", ""));
  return Number.isFinite(x) ? x : null;
};

// One entry from ESPN's scoreboard competitions[0].odds[] (or summary pickcenter[]).
// spread is the HOME team's line (negative = home favoured), as ESPN's pointSpread.home gives it.
export function lineFromEspn(o) {
  if (!o) return null;
  const ps = o.pointSpread || {}, ml = o.moneyline || {}, tot = o.total || {};
  const homeLine = num(ps.home?.close?.line) ?? num(o.homeTeamOdds?.spreadLine) ?? (o.spread !== undefined ? num(o.spread) : null);
  const line = {
    provider: o.provider?.displayName || o.provider?.name || "unknown",
    providerId: o.provider?.id ? String(o.provider.id) : null,
    details: o.details || "",
    spreadHome: homeLine,
    total: num(o.overUnder) ?? num(tot.over?.close?.line),
    mlHome: num(ml.home?.close?.odds) ?? num(o.homeTeamOdds?.moneyLine),
    mlAway: num(ml.away?.close?.odds) ?? num(o.awayTeamOdds?.moneyLine),
    spreadOddsHome: num(ps.home?.close?.odds) ?? num(o.homeTeamOdds?.spreadOdds),
    spreadOddsAway: num(ps.away?.close?.odds) ?? num(o.awayTeamOdds?.spreadOdds),
    overOdds: num(tot.over?.close?.odds) ?? num(o.overOdds),
    underOdds: num(tot.under?.close?.odds) ?? num(o.underOdds),
    open: {
      spreadHome: num(ps.home?.open?.line), total: num(tot.over?.open?.line),
      mlHome: num(ml.home?.open?.odds), mlAway: num(ml.away?.open?.odds),
    },
  };
  if (line.spreadHome === null && line.total === null && line.mlHome === null && line.mlAway === null) return null;
  return line;
}

// Implied win chance from American moneylines, with the bookmaker margin removed (display aid only).
export function impliedHome(mlHome, mlAway) {
  const p = (ml) => (ml === null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));
  const h = p(mlHome), a = p(mlAway);
  if (h === null || a === null) return null;
  return Math.round((h / (h + a)) * 1000) / 1000;
}
