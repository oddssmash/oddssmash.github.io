# Courtside Ledger

A scenario-based NBA game analyzer and predictor. It projects every game from data, then grades itself against what really happened and learns from the gap.

**No betting odds, sportsbook lines or prop markets are used anywhere.**

## What it does

- **Walk-forward learning.** Every game since October 2025 (2025-26 preseason, regular season, play-in, playoffs, then 2026-27 preseason and season to date) is projected using only what was known before tip-off, compared with the real result, and the gap is split into causes. Those causes update a library of real situations before the next game is projected.
- **Five rating systems, combined.** Recent efficiency, a player-by-player build-up, Elo with margin of victory, opponent-adjusted efficiency, and opponent-adjusted efficiency with three-point luck removed. The back-test decides how much say each one gets.
- **Situations.** Rest, back-to-backs, travel distance, time zones, altitude, streaks, blowout risk, opponent defence by position, opponent style, missing stars on either side, referee crews.
- **Personal matchups.** Each player's record against specific teams, arenas, opposing players, defender types and team sizes, for points and three-point attempts.
- **Carry factor.** How a player's assists and his teammates' production move when he scores more or less than projected.
- **Absence impact.** What happened to the team, teammates and opposing players in games a player missed.
- **Upset watch, likely ranges, confidence grades**, and a calibration table showing whether a stated 70% really wins 70% of the time.
- **Takes, checked.** Headlines from news desks, blogs, YouTube analysts and r/nba, each compared with the player's recent numbers.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer. Nothing to install.

```bash
npm run refresh
```

```bash
npm run serve
```

Then open http://localhost:4173. `npm run refresh` downloads new games and rebuilds every projection (the first run takes a few minutes; later runs only fetch what is new). `npm run check` prints accuracy diagnostics.

## Put it online (GitHub Pages)

1. Create a public repository on GitHub and push this folder to its `main` branch.
2. In the repository: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. The workflow in `.github/workflows/update.yml` then refreshes the data and republishes the site every three hours, and on every push.

Note: NBA.com's stats service sometimes refuses requests from cloud servers. When that happens the workflow keeps the last NBA.com tables it has and everything else still refreshes. Running `npm run refresh` on your own computer and pushing updates those tables.

## Where the data comes from

| Source | Used for |
|---|---|
| ESPN public feeds | Schedules, box scores, pre-game injury lists, rosters, coaches, injuries, news |
| NBA.com stats | Advanced, usage, scoring, defence, hustle, tracking, clutch, four factors, lineups, official game logs (cross-check), weekly point-in-time snapshots |
| Community 2K27 datasets on GitHub | Unofficial overall ratings and archetypes; a light prior for players with few games |
| RSS and YouTube feeds in `config/sources.json` | Headlines and short summaries, with links |

Edit `config/sources.json` to add or remove news, blog and YouTube sources.

## Layout

```
scripts/fetch.mjs        download and cache data into data/
scripts/model.mjs        replay history, learn, project upcoming games, write public/data/
scripts/lib/             helpers (stats, NBA.com context, utilities)
scripts/diag.mjs         accuracy diagnostics
public/                  the website (plain HTML, CSS and JavaScript)
config/sources.json      commentary sources
```

## Honest limits

- About one game in three is called wrong. Shot-making on the night is mostly luck.
- Starting lineups and late scratches are only known near tip-off.
- Matchup records built on a handful of games are hints. The number of games is always shown.
- This is for analysis and entertainment. It is not betting advice.
