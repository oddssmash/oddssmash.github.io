# Raw data files: play-by-play, shot zones, defenders

Written by `scripts/fetch.mjs`. Everything here is raw input for `scripts/model.mjs`; nothing in this folder is shown to the user directly. The one exception to "no betting data" is `data/odds.json` (section 8): sportsbook lines kept for display-only comparison in the Simulation and High-confidence tabs, never read by the model, and checked by `scripts/checks.mjs` so that no odds field appears in any other file.

| File | Source | Written by | Refreshed |
|---|---|---|---|
| `data/pbp/<gameId>.json` | ESPN game summary (plays) | `fetch.mjs games` and the default run | once per completed game |
| `data/nbazones.json` | NBA.com stats | `fetch.mjs extra`, `fetch.mjs zones`, default run | finished seasons once, current season every run |
| `data/defsnapshots.json` | NBA.com stats (dated) | same | one snapshot per Monday, newest re-fetched for a week |
| `data/matchups/<gameId>.json` | NBA.com matchup tracking (`boxscorematchupsv3`) | default run, `fetch.mjs matchups`, `fetch.mjs pregame` | once per completed game, `MATCHUP_MAX` (200) per run, newest first |
| `data/nbagameids.json` | NBA.com team game logs, NBA.com scoreboard | with the matchups | new finished games |
| `data/nbaids.json` | matched names | matchups and line-ups | grows as players are matched |
| `data/pregame.json` | ESPN summary, NBA.com daily line-ups | default run, `fetch.mjs games`, `fetch.mjs pregame` | every run, games in the next 30 hours |
| `data/odds.json` | ESPN scoreboard / summary / core API | same | every run. **For comparison only** |
| `data/checks.json` | local files | `scripts/checks.mjs` | before each model step |

## Refresh modes and the scheduled refresh

| Command | What it fetches | Requests |
|---|---|---|
| `node scripts/fetch.mjs` | everything (games, game day, odds, matchups, rosters, injuries, NBA.com tables, news, 2K, logs, snapshots, zones) | hundreds; minutes |
| `node scripts/fetch.mjs games` | schedule, new box scores and play-by-play, game day, odds | tens |
| `node scripts/fetch.mjs pregame` | scores of yesterday and today (with box score and play-by-play of games that just ended), rosters, injuries, referee crews, starters and inactive lists for games in the next 30 hours, odds, matchup tracking of games that just ended | about 50-70 (ESPN) + 2-4 (NBA.com); about 15 seconds |
| `node scripts/fetch.mjs matchups` | only the matchup backlog (`MATCHUP_MAX=5000` for a full backfill, about 40 minutes) | one NBA.com call per game, 700 ms apart |
| `node scripts/checks.mjs` | nothing (local files only); writes `data/checks.json` | none; about 1 second |

How the owner's scheduled refreshes should call it:

- **Full refresh** (every few hours, and once each morning Philippine time): `node scripts/fetch.mjs && node scripts/checks.mjs && node scripts/model.mjs && node scripts/simulate.mjs && node scripts/lib/simoptional.mjs scripts/insights.mjs && node scripts/bundle.mjs`
- **Game-day refresh** (every 30-60 minutes from about 3 hours before the first tip-off of the US evening, i.e. roughly 05:00-11:00 Philippine time on game days, plus one run about 30 minutes before each tip-off when possible): `node scripts/fetch.mjs pregame && node scripts/checks.mjs && node scripts/model.mjs && node scripts/simulate.mjs && node scripts/lib/simoptional.mjs scripts/insights.mjs && node scripts/bundle.mjs`. NBA.com confirms starters about 30 minutes before tip-off and posts the inactive list about an hour before; a run in that window picks both up, and the model step that follows re-projects with the fresh injury list (the starters and inactive lists in `pregame.json` are new fields; see section 7 for what `model.mjs` reads from that file).
- `checks.mjs` exits with code 1 only for a problem that would make projections wrong (see section 9). With `&&` the model step is then skipped and the site keeps the previous projections; read `data/checks.json` (or the printed report) and fix the cause. To publish anyway, run `node scripts/model.mjs` on its own.
- Order matters: `simulate.mjs` reads the model's fresh projections and is the only writer of the display copy `public/data/odds.json` (and of `sim/`, `board.json`, `simcal.json`, `season.json`), so without it a pregame refresh updates `data/odds.json` while the "for comparison only" boxes keep the previous run's lines next to new projections. `insights.mjs` reads the simulation files, so it runs after `simulate.mjs`. `bundle.mjs` packs the private preview (`dist/`) and runs last so it is built from the final `public/data`. `SIM_CAL=off` skips the walk-forward calibration (keeps the previous `simcal.json`) when time is short; the calibration cache `data/sim-cache.json` makes a normal run about 2 minutes.
- The `.github/workflows/update.yml` cloud refresh runs only `fetch.mjs` and `model.mjs` at present (it should also run `node scripts/simulate.mjs` and `node scripts/lib/simoptional.mjs scripts/insights.mjs` after the model step, and keep `data/sim-cache.json` in its cache; until then the Lab tabs and the odds copy are missing on the cloud-published site); NBA.com often refuses cloud servers, and then the matchup backlog simply waits for a run from a home computer.

Helpers that read them:

- `scripts/lib/zones.mjs`: zone ids, shot styles, `classifyShot`, row decoders, court geometry. Pure, no file access.
- `scripts/lib/gameflow.mjs`: `summarizeGame(pbp)` turns one game into counted facts (period scores, largest lead, lead changes, best run, clutch points, points by zone and style, transition, second chance, after turnovers).
- `scripts/lib/zonedata.mjs`: `loadPbp(id)` and `loadZoneData()` with lookups by player or team, including the leak-free `defenderAsOf(name, gameDate, cat)`.
- `scripts/lib/zonecheck.mjs`: `node scripts/lib/zonecheck.mjs [topN]` prints every check quoted below.

## Back-test rules for these files

1. `data/pbp` is per game. A projection for game G may use any pbp file of a game that tipped off before G.
2. `data/nbazones.json` holds season totals. For a past game of season S those totals include later games, so use season S-1 (`tableSeason(date)` in `zonedata.mjs` picks it), or build the numbers game by game from `data/pbp`. The current season's table is only for live projections.
3. `data/defsnapshots.json`: use the newest snapshot dated strictly before the game's US Eastern date, and only `gp`, `fgm`, `fga` from it. The `nsPct` column is not point-in-time (see below).

## 1. `data/pbp/<gameId>.json` (format v1)

The row layouts are also at the top of `scripts/lib/zones.mjs`, next to the index constants.

```
{
  "v": 1,
  "id": "401810653", "date": "2026-02-20T01:30Z", "season": 2026, "stype": 2,
  "h": "24", "a": "21",                      ESPN team ids, home and away
  "q": [[30,31,37,23],[25,24,22,23]],        points per period [home[], away[]], index 4+ = overtime
  "shots": [...], "ft": [...], "sc": [...], "tech": [...], "pf": [...],
  "tto": [1, 0],                             team turnovers with no player (shot clock, 5 and 8 seconds)
  "subs": [...],
  "gap": [0, 6],                             only when plays do not add up to the final score
  "np": 1                                    only when ESPN had no plays at all
}
```

`side` is always 0 for the home team and 1 for the away team. Player ids are ESPN athlete ids stored as numbers (the decoders return strings, like the rest of the project). 0 means none or unknown.

### shots: one row per field-goal attempt

`[pid, side, per, sec, x, y, dist, pts, made, fl, ast, blk, margin, ps, pt]`

| # | Name | Meaning |
|---|---|---|
| 0 | pid | shooter |
| 1 | side | shooter's team, 0 home / 1 away |
| 2 | per | period, 1-4, 5+ overtime |
| 3 | sec | seconds left in the period (one decimal in the final minute) |
| 4 | x | feet across the court, 0-50, hoop at 25 |
| 5 | y | whole feet toward midcourt; hoop centre 0.25, baseline -5, midcourt 42 |
| 6 | dist | feet. The number in ESPN's text when there is one, else from x,y rounded down (then flag 1 is set) |
| 7 | pts | 2 or 3 points attempted |
| 8 | made | 1 or 0 |
| 9 | fl | shot-style bit flags, see below |
| 10 | ast | assister id, 0 if none |
| 11 | blk | blocker id, 0 if none |
| 12 | margin | shooting team's lead (negative = behind) just before the shot |
| 13 | ps | how the shooting team got the ball, see below |
| 14 | pt | whole seconds from that event to the shot, 0-99 |

Style flags (`FL` in `zones.mjs`): 1 distance came from x,y; 2 pull-up; 4 driving; 8 layup; 16 running; 32 floating; 64 step back; 128 dunk; 256 cutting; 512 tip or putback; 1024 turnaround; 2048 fade away; 4096 hook; 8192 alley-oop; 16384 bank; 32768 reverse; 65536 heave. A plain "Jump Shot" is 0.

`styleOf(fl)` folds the flags into one style: `drive` (drive / layup), `dunk`, `pull`, `step`, `float`, `post` (hook, turnaround, fade), `cut`, `oop`, `tip`, `run` (running / transition), `jump` (catch / plain jumper), `heave`. Priority when several apply: heave, tip, alley-oop, cut, running, floater, post, step-back, pull-up, driving, dunk, layup, jumper.

Possession source `ps` (`POSS`): 0 period start or unknown, 1 after the opponent scored, 2 after a defensive rebound, 3 after a steal, 4 after a dead-ball turnover, 5 after the team's own offensive rebound. Add 10 when a whistle (foul, timeout, violation, jump ball, substitution) came between that event and the shot. Example: `ps` 3 with `pt` 4 is a shot four seconds after a steal with no stoppage.

### Other rows

- `ft`: `[pid, side, per, sec, made, seq, kind]`. `seq` is n*10+m for "free throw n of m". `kind`: 0 regular, 1 technical, 2 flagrant, 3 clear path.
- `sc`: `[per, sec, homeScore, awayScore]`, the score after each scoring play, in game-time order. It is added up from the made shots and free throws, not copied from ESPN's score fields.
- `tech`: `[pid, side, per, sec, kind]`. Kinds: 1 technical foul, 2 double technical (one row per player), 3 flopping technical, 4 defensive three seconds, 5 delay of game technical, 6 flagrant 1, 7 flagrant 2, 8 ejection, 9 coach or bench technical (pid 0), 10 other (hanging on the rim, excess timeout, too many players). Only 1, 2, 3 and 9 are conduct technicals. 4, 5 and 10 are rule technicals and 6-8 are not technical fouls.
- `pf`: `[pid, side, shootingFouls, offensiveFouls, otherFouls, tovBadPass, tovLostBall, tovViolation, tovOffensiveFoul, tovStolen]`, one row per player with any of them. Fouls are fouls committed. The four `tov*` kinds add up to the player's turnovers; `tovStolen` is how many of those ended in a steal.
- `subs`: `[per, sec, side, inPid, outPid]`. ESPN does not say who starts each period, so on-court fives have to be inferred.

### Things to know before using it

- **Heaves.** From 2025-26 the NBA charges a missed end-of-period heave to the team, not the shooter. ESPN types those "Heave Jump Shot" (flag 65536). All 1,395 such rows are misses and they are not in the player's box-score attempts. A made heave is logged as an ordinary jump shot. So long-distance FG% for a player is flattered by the rule: non-heave-type threes from 36+ feet with 3 seconds or less left went 41 of 74. `classifyShot` puts every one of these in the separate `heave` zone (flag, 36+ feet, backcourt, or a three from 30+ feet with 3 seconds or less left): 1,790 attempts, 4.6% made.
- **Distance text.** 27% of attempts have no distance in the text, mostly shots at the hoop (ESPN does not print "0-foot"). The printed distances are whole feet rounded down.
- **Coordinates are whole feet.** A shot within a foot of a zone line can land on either side. This is the limit on zone accuracy below.
- **Left and right** follow NBA.com: x below 25 is NBA.com's "Left Corner 3".
- **Gaps in ESPN's feed.** 7 of 1,599 games have plays that do not add up to the final score (34 points in total); those files carry `gap`. ESPN's own per-play score fields were wrong at the end of 29 games, which is why `sc` and `margin` are rebuilt from the plays.
- **Missing games.** ESPN returns "not found" for the summaries of 8 completed 2025-26 playoff games (401869391, 401869377, 401869373, 401869402, 401871334, 401871154, 401871337, 401873343). They have no box score and no play-by-play. This was already the case before this cache existed.
- **`turnoverPoints` in `data/games/<id>.json`** is listed under the team that committed the turnovers: it tracks that team's own turnovers (r = 0.66) and the opponent's points after turnovers in the play-by-play (r = 0.80). Read it as points given up, not points scored.

### Checks (run `node scripts/lib/zonecheck.mjs`)

Measured on all 1,599 games, 285,103 attempts, 35,894 player-games.

| Check | Result |
|---|---|
| Player box score vs play-by-play, share of player-games that differ | FGA 0.42%, FGM 0.05%, 3PA 0.23%, 3PM 0.02%, FTA 0.07%, FTM 0.05%, points 0.10%, assists 0.36%, blocks 0.25%, fouls 0.11%, turnovers 0.32% |
| Period scores add up to the final score | 1,599 of 1,599 |
| Largest lead equals the box score | 3,183 of 3,184 team-games |
| Lead changes equal the box score | 1,219 of 1,222 games that list them |
| Rim + paint zone points vs box-score points in the paint | 49.06 vs 49.06 per team-game, average gap 0.55 points |
| Shots 6 seconds or less after a steal or defensive rebound vs box-score fast-break points | r = 0.75 (a proxy: the official count is a scorer's judgment and includes free throws) |

Zone classifier vs NBA.com player shot locations, regular season. Gaps are absolute, in percentage points.

| Sample | Zone | Share gap avg | Share gap max | FG% gap avg | FG% gap max |
|---|---|---|---|---|---|
| 2025-26, top 40 by attempts | Restricted area | 0.19 | 0.62 | 0.55 | 1.56 |
| | Paint (non-RA) | 0.42 | 1.16 | 0.79 | 3.03 |
| | Mid-range | 0.30 | 1.25 | 1.00 | 3.34 |
| | Left corner 3 | 0.05 | 0.21 | 0.43 | 0.96 |
| | Right corner 3 | 0.03 | 0.18 | 0.01 | 0.04 |
| | Above the break 3 | 0.09 | 0.23 | 0.11 | 0.41 |
| | All zones | 0.18 | 1.25 | 0.59 | 3.34 |
| 2025-26, top 150 | All zones | 0.22 | 2.53 | 0.63 | 4.70 |
| 2026-27 to date, top 40 (not used for tuning) | All zones | 0.44 | 2.61 | 0.84 | 4.63 |

FG% gaps count only zones where the player has 50 or more attempts in both sources. The worst share gap in the top 40 is Alperen Sengun's mid-range (11.0% here, 9.8% on NBA.com); the worst FG% gap is Karl-Anthony Towns' mid-range (37.1% on 70 here, 33.8% on 71 there). League-wide 2025-26 attempts, here / NBA.com: restricted area 62,392 / 62,253, paint 43,709 / 43,908, mid-range 22,194 / 22,025, left corner 12,395 / 12,210, right corner 11,559 / 11,360, above the break 67,055 / 67,375.

The geometry was tuned on 2025-26 only. The 2026-27 row is a fair out-of-sample check, but each player has about 170 attempts there, so single-player gaps are wider. What remains is the whole-foot rounding: the paint / mid-range line and the 4-foot arc cannot be resolved more finely.

## 2. `data/nbazones.json` (format 1)

Regular-season totals from NBA.com for 2024-25, 2025-26 and 2026-27. Player rows are keyed by `normName(name)` from `scripts/lib/stats.mjs`; team rows by ESPN team id.

```
{
  "format": 1, "fetched": "...", "note": "...",
  "zones": ["RA","PAINT","MID","LC3","RC3","ATB3","BC"],
  "playTypes": ["Isolation","Transition","PRBallHandler","PRRollman","Postup","Spotup","Handoff","Cut","OffScreen","OffRebound","Misc"],
  "cols": { ...column names for each table... },
  "seasons": {
    "2025-26": {
      "fetched": "...",
      "final": { "shotLoc": 1, "defend.lt6": 1, ... },    tables fetched after the season ended (never fetched again)
      "players": { "shaigilgeousalexander": [1628983, "Shai Gilgeous-Alexander", "OKC", "G"] },
      "teams":   { "25": [1610612760, "Oklahoma City Thunder"] },
      "shotLoc":        { "<player>": [fgm, fga, fgm, fga, ...] },   one fgm, fga pair per entry of "zones"
      "teamShotLoc":    { "<espnTeamId>": [...same 14 numbers...] }, the team's own shots
      "teamOppShotLoc": { "<espnTeamId>": [...] },                   shots the team allowed
      "defend": { "overall": {...}, "fg3": {...}, "fg2": {...}, "lt6": {...}, "lt10": {...}, "gt15": {...} },
      "synP": { "Isolation": { "<player>": [...] }, ... },           player, offensive
      "synT": { "Isolation": { "<espnTeamId>": [...] }, ... },       team, offensive
      "synD": { "Isolation": { "<espnTeamId>": [...] }, ... },       team, defensive
      "ptShot": { "catch": {...}, "pullup": {...}, "lt10": {...} }
    }
  }
}
```

| Table | Row | Notes |
|---|---|---|
| `players` | `[nbaId, name, team, pos]` | team and position as NBA.com lists them (last team) |
| `shotLoc`, `teamShotLoc`, `teamOppShotLoc` | `[fgm, fga]` x 7 zones | RA restricted area, PAINT in the paint non-RA, MID mid-range, LC3 / RC3 corners, ATB3 above the break, BC backcourt |
| `defend.<cat>` | `[gp, freq, fgm, fga, nsPct]` | shots the player was the closest defender on. `freq` share of his defended shots in this category, `nsPct` what those shooters usually make. Allowed % = fgm / fga. Categories: `overall`, `fg3`, `fg2`, `lt6` (inside 6 ft), `lt10`, `gt15` (beyond 15 ft) |
| `synP`, `synT`, `synD` | `[gp, possPct, ppp, poss, pts, fgm, fga, efgPct, tovPct, ftPct, scorePct, pctile]` | `possPct` share of possessions that are this play type, `ppp` points per possession, `poss` / `pts` / `fgm` / `fga` season totals, `pctile` NBA.com's percentile (for `synD` a high percentile is a good defence). NBA.com lists a player only above its own minimum of possessions, so most players are missing from some play types |
| `ptShot.<cat>` | `[gp, freq, fgm, fga, efgPct, fg3m, fg3a]` | `catch` catch and shoot, `pullup` pull-ups, `lt10` shots inside 10 ft. `freq` share of the player's attempts |

A traded player is NOT returned consistently by NBA.com. For some play types there is one row per team; for others there is a single row that covers one stint only (live check for 2025-26: Spot-up 400 rows for 400 players, Roll-man 269 rows for 266). Rows of the same play type are merged (counts added, rates weighted by possessions, percentile taken from the larger stint); a play type that came back for one stint keeps that stint's games. So a traded player's rows can cover different games: 40 players in 2025-26 and 41 in 2024-25 have differing `gp` across play types, and their `possPct` values do not add up to 1. Readers must treat differing `gp` as "partial" (`scout.mjs` marks the block and labels each row with its games; the play-type factor uses possessions per game, which stays valid per row).

From `synFormat` 2 (the next `node scripts/fetch.mjs zones` run; finished seasons are fetched once more for it) every `synP` row has a 13th column: the team abbreviation the row belongs to, joined with "+" when two stints were merged (`"NYK+CHI"`).

Counts on 10 November 2026: 2024-25 569 players, 2025-26 582, 2026-27 462; 30 teams each; 45 tables per season (1 + 2 shot-location, 6 defender, 33 play-type, 3 shot-creation).

Synergy has no date filter on NBA.com, so there is no point-in-time version of the play-type tables. Use the previous season for the back-test.

## 3. `data/defsnapshots.json` (format 1)

```
{
  "format": 1, "note": "...",
  "cats": ["lt6", "fg3", "gt15"],
  "cols": ["gp", "fgm", "fga", "nsPct"],
  "snaps": {
    "2025-26|20251103": { "lt6": { "<player>": [gp, fgm, fga, nsPct] }, "fg3": {...}, "gt15": {...} }
  }
}
```

One snapshot per Monday (the same Mondays as `data/nbasnapshots.json`): 24 for 2025-26 (27 October 2025 to 6 April 2026) and one per Monday so far in 2026-27. Each holds the season to date through that Monday. A defender appears once he has defended at least one shot in the category (359 defenders in the first week, 568 by April).

**`nsPct` looks ahead.** NBA.com fills it with the shooters' full-season percentages even when a date is set. Evidence: defenders with exactly one defended shot by 27 October 2025 show values such as 0.623, 0.635 and 0.651, which need far more attempts than the shooter had taken by then. `gp`, `fgm` and `fga` do respect the date (Rudy Gobert: 260 of 494 on 6 April, 261 of 498 for the full season). `defenderAsOf()` in `zonedata.mjs` therefore returns the allowed percentage against the league-wide allowed percentage of the same snapshot, and leaves `nsPct` out.

### Known bias of the zone classifier

Against NBA.com's own zone table (2025-26 regular season, players matched by name): corner threes 23,931 here versus 23,570 (+1.5%), above-the-break threes 66,999 versus 67,375 (-0.6%; -0.9% over all teams). The corner share is high for essentially every team. ESPN's coordinates are whole feet and 753 threes sit exactly on y = 9, so no whole-foot cut-off removes it (y <= 9 gives +387, y <= 8 gives -366). FG% by zone is within 0.1 points. The same note is published in `meta.scout.zoneBias`. `zonecheck.mjs` leaves the NBA Cup final out of this comparison, because NBA.com's season totals do not include it.

## Load-time repairs (`scripts/lib/boxfix.mjs`)

Nothing in `data/` is rewritten; these are applied when `model.mjs` loads the games.

- **Team totals** (FG, 3P, FT, rebounds, assists, steals, blocks, turnovers, fouls) are read from ESPN's team row in `data/games/<id>.json > teams[]`; the sum of the player rows is only the fallback.
- **Blank box rows.** ESPN returned a row with no athlete id, name or numbers for one Chicago player in 48 games of 2025-26. His line is rebuilt as the team row minus the listed players, his id is the one play-by-play participant of that side who is not in the box score, his name and minutes come from `data/nbagamelogs.json` (the rebuilt points must equal the official log, otherwise the row is left alone). 33 rows are rebuilt; in the other 15 he did not play. `fetch.mjs` logs any new game with such a row.
- **NBA Cup final.** ESPN labels it a regular-season game (season type 2). It is flagged `cup: true` (the last of three or more neutral-site December games in one arena whose two teams won the other two) and left out of regular-season records, player season lines and the NBA.com comparison; the model still learns from it.
- **Score-only games.** Finished schedule events with no `data/games` file (ESPN's summary returns 404; 8 playoff games of 2025-26) are walked by final score only: Elo, rest days, streaks, previous meetings and win-loss records.

## News filter

`fetch.mjs` drops every news item whose title, summary or link is about betting (odds, picks against a line, props, parlays, sportsbooks and their promotions; `isBetting()` in `scripts/lib/util.mjs`) from the merged 21-day archive before `data/news.json` is written, and logs how many were dropped. `context.mjs` and `model.mjs` apply the same test again when reading, so an archive written by an older version cannot put such an item on the site.

## Fetching notes

- `rosters.json` and `pregame.json` start from the stored copy: a failed roster request keeps that team's previous roster, and referee crews already known for games not yet played are kept.

- One ESPN summary request per game now writes both `data/games/<id>.json` and `data/pbp/<id>.json`. The first run downloads history once (about 1,600 requests, six at a time, under two minutes).
- `PBP_VERSION` in `scripts/lib/pbp.mjs` is the format version. Raising it makes the next run rebuild every file. Set the environment variable `PBP_RAW_DIR` to a folder outside the project to keep the trimmed plays of each download, so a rebuild reads from disk instead of asking ESPN again.
- NBA.com calls are spaced 700 ms apart. After three calls in a row that time out, the rest of that run's NBA.com calls are skipped and every table keeps its previous copy.
- `node scripts/fetch.mjs zones` refreshes only `nbazones.json` and `defsnapshots.json`.

## 4. `data/matchups/<gameId>.json` (format v1): who guarded whom

NBA.com's player tracking assigns each offensive possession, in parts, to the defenders who guarded the ball handler or shooter. One file per completed game, named by the **ESPN** event id. Helpers: `scripts/lib/matchups.mjs` (`loadMatchups(id)`, `matchupsBefore(iso)`, column constants `MU_COLS` / `MU`).

```
{
  "v": 1, "id": "401909957", "nba": "0022600208", "date": "2026-11-10T01:30Z",
  "h": "10", "a": "7",                ESPN team ids, home and away
  "rows": [[side, off, def, poss, sec, pts, fgm, fga, tpm, tpa, ftm, fta, ast, tov, blk, sw, sfl, pctOff, pctDef], ...],
  "flip": 1,                          only when NBA.com's home/away is the reverse of ESPN's (sides follow ESPN)
  "un": [[nbaPersonId, "name", espnTeamId]],   only when a player could not be matched to an ESPN id
  "empty": 1                          NBA.com has no tracking for this game (rows absent)
}
```

| # | Name | Meaning |
|---|---|---|
| 0 | side | the offensive player's team, 0 home / 1 away (ESPN's sides) |
| 1 | off | offensive player, ESPN id as a string (`"nba:<personId>"` when unmatched) |
| 2 | def | defender, same id rules |
| 3 | poss | partial possessions the defender guarded him (one decimal) |
| 4 | sec | matchup seconds |
| 5 | pts | points the offensive player scored in those possessions (free throws included) |
| 6-9 | fgm, fga, tpm, tpa | his field goals and threes against this defender |
| 10-11 | ftm, fta | his free throws |
| 12-14 | ast, tov, blk | his assists and turnovers, and blocks by this defender, in the matchup |
| 15 | sw | switches onto him by this defender |
| 16 | sfl | shooting fouls the defender committed |
| 17 | pctOff | share of the offensive player's time on court spent against this defender |
| 18 | pctDef | share of the defender's defensive time spent on this player |

Back-test rule: a projection for game G may use the files of games that tipped off strictly before G (`matchupsBefore(G.date)`). Season totals from NBA.com (`leagueseasonmatchups`, `matchupsrollup`, both tested and working) include later games, so they are **not** stored; adding up the per-game files gives the same numbers as of any date. The tracking is NBA.com's own and unofficial in the sense that it is a camera system's assignment, not a scorer's ruling: points add up to about 97-100% of a team's score in a normal game (transition baskets and scrambles are sometimes left unassigned).

Counts, 11 November 2026: 1,607 files (every finished game since 1 October 2025; the full backfill took 39 minutes with no failed call), 1,527 with tracking: 1,383 of 1,385 regular-season games, 85 of 85 playoff games, 6 of 6 play-in games and 53 of 131 preseason games. 80 games have no tracking on NBA.com (78 preseason; regular season 401909865 on 25 October 2026 and the neutral-site game 401909938 on 7 November 2026). 304,526 rows, 23 MB. The 8 playoff games with no ESPN box score do have tracking. Tracked points cover a median 99.0% of the final score (10th percentile 97.1%); 25 games cover less than 80% for one team, mostly preseason. Two players could not be matched to an ESPN id (Amir Coffey and Jonas Valanciunas in two of those 8 playoff games, where there is no ESPN box score to match against); their rows are kept as `nba:<id>`. 713 NBA.com ids mapped (503 seeded from the season tables, 210 matched in box scores).

## 5. `data/nbagameids.json` and `data/nbaids.json`

- `nbagameids.json`: `{ format, note, map: { espnEventId: nbaGameId }, done: { "2025-26|Regular Season": iso }, dates: { YYYYMMDD: 1 }, missing: [espnEventId] }`. Built from NBA.com's team game logs (one call per season and season type; finished seasons once), then NBA.com's scoreboard of the date for anything left (the NBA Cup final is not in the game logs). Games are matched on US Eastern date and the two teams (NBA.com team id -> ESPN id through `nbazones.json` `teams`).
- `nbaids.json`: `{ format, note, updated, count, map: { nbaPersonId: espnId }, names: { nbaPersonId: name }, how: { nbaPersonId: "box" | "roster" | "last" | "seed" } }`. Matching is always inside one team: the same game's ESPN box score (matchups) or the current ESPN roster (line-ups); exact normalised name first (`normName`), then same last name and first initial, then a unique last name. `seed` pairs come from NBA.com's season tables matched to roster names, and are replaced as soon as a box score disagrees. A player that cannot be matched keeps his NBA.com id (`nba:<id>`) and is listed by `checks.mjs`.

## 6. Game-day refresh

`node scripts/fetch.mjs pregame` (see "Refresh modes" at the top). Sources for starters and late scratches:

- **NBA.com daily line-ups** (`stats.nba.com/js/data/leaders/00_daily_lineups_YYYYMMDD.json`, US Eastern date). Published on game day. During the day each team has five "Expected" starters; about 30 minutes before tip-off they become "Confirmed", and about an hour before tip-off the full active / inactive list appears (`rosterStatus` Active / Inactive). The next day's file returns 404 until it is published.
- **ESPN summary**: referee crews (posted on game day) and starters when ESPN already flags them (`starter` in the box score or rosters; usually only once the game is about to start).

## 7. `data/pregame.json`

One entry per game not yet played (entries are dropped once the game is final, or 6 hours after tip-off). `model.mjs` currently reads `officials` only.

```
{
  "<espnEventId>": {
    "date": "2026-11-11T00:30Z", "home": "18", "away": "15",
    "officials": ["Mark Lindsay", "Brent Barnaky", "Michael Smith"],
    "lineups": {
      "src": "NBA.com daily line-ups", "fetched": "...",
      "home": {
        "status": "confirmed" | "expected" | "none",
        "starters": [{ "id": "3934672", "n": "Jalen Brunson", "pos": "SG", "status": "confirmed" }],
        "inactive": [{ "id": "3062679", "n": "Josh Hart" }],
        "activeListed": 14,                       players on the active list (0 until NBA.com posts it)
        "updated": "2026-11-10T19:06:00"          NBA.com's own timestamp (US Eastern)
      },
      "away": { ... }
    },
    "late": [{ "t": "18", "id": "...", "n": "...", "injury": "Questionable", "recentGames": 5 }],
    "espnStarters": { "home": [{ "id", "n", "pos" }], "away": [...], "updated": "..." }
  }
}
```

- Ids are ESPN ids (`nba:<personId>` if the name could not be matched to the team's ESPN roster).
- `late` = late scratches: on NBA.com's inactive list, played in 2 or more of the team's last 5 games, and not listed out or doubtful on ESPN's injury report at the time of the run. Two-way and G League players, who are routinely inactive, are left out by the "last 5 games" rule.
- Leak-free by construction: entries exist only for games not yet played, so a past game's replay never sees them.

## 8. `data/odds.json` (format 1): FOR COMPARISON ONLY

Owner rule: sportsbook lines may be shown only in the Simulation and High-confidence tabs, as a display-only comparison labelled "for comparison only". They never feed projections, learning, scenarios or the simulation's inputs, and never appear on a version 1 page. They are kept only in this file (the model step copies it to `public/data/odds.json` for those tabs); `checks.mjs` fails the refresh if an odds field appears in any other data file or published file.

```
{
  "format": 1, "note": "...", "source": "...", "fetched": "2026-11-11T00:13:15Z",
  "props": { "checked": 11, "games": 6, "players": 88 },
  "games": {
    "401909960": {
      "date": "2026-11-11T00:30Z", "home": "18", "away": "15",
      "provider": "Draft Kings", "providerId": "100", "details": "NY -16.5",
      "spreadHome": -16.5,                home team's line, negative = home favoured
      "total": 221.5,
      "mlHome": -1180, "mlAway": 740,     American odds
      "spreadOddsHome": -104, "spreadOddsAway": -116, "overOdds": -110, "underOdds": -110,
      "open": { "spreadHome": -15.5, "total": 219.5, "mlHome": -1260, "mlAway": 770 },
      "impliedHome": 0.886,               moneyline win chance with the bookmaker margin removed
      "fetched": "...",
      "props": { "<espnAthleteId>": { "pts": 20.5, "reb": 5.5, "ast": 1.5, "tpm": 1.5, "stl": 0.5, "blk": 1.5, "pra": 27.5 } }
    }
  }
}
```

- Game lines come from ESPN's public scoreboard (`competitions[0].odds[0]`), with the pre-game summary's `pickcenter` as a fallback. Lines are posted a day or so ahead, so later games have no entry yet.
- Only games not yet played are kept. Once a game has tipped off ESPN switches to live lines, so the last pre-game line is kept until the game is final, then the entry is dropped (no archive of closing lines).
- Player lines come from ESPN's public core API (`sports.core.api.espn.com/.../odds/<providerId>/propBets`), no login, for games in the next 30 hours, usually from the morning of game day. Only the threshold is stored: ESPN does not label which of the two prices is over and which under. No other site is used.

## 9. `data/checks.json` and `scripts/checks.mjs`

Run before each model step. Local files only, about a second. Prints a short report and writes:

```
{ "format": 1, "ran": "...", "summary": { "errors": 0, "warnings": 2, "notes": 4, "ok": 9 },
  "checks": [{ "id": "partial-games", "level": "error" | "warn" | "note" | "ok", "title": "...", "count": 0, "detail": "...", "examples": ["... up to 8"] }] }
```

| id | Checks | Error (exit 1) when |
|---|---|---|
| `core-files` | teams (30), rosters (30 teams, 10+ players each), injury list readable | anything missing |
| `schedule` | games in the next 7 days, today's schedule fresh, games that should be over still not final | a game that tipped off 6+ hours ago (within 3 days) is not final |
| `missing-games` | finished games without a box score (8 known ESPN 404s excluded) | a game from the last 7 days (finished 12+ hours ago) has no box score, or a box file is unreadable |
| `partial-games` | team row vs final score, player rows vs final score, fewer than 5 players with minutes, schedule score vs box file score | any of these in a game from the last 7 days |
| `repaired-rows`, `minutes` | ESPN blank box rows (rebuilt at load time), minutes far from 240 | never |
| `pbp-vs-box` | missing play-by-play, plays vs final score, per-player points | never (warning) |
| `name-mapping` | injury entries not on a roster, duplicate names in a roster, two NBA.com ids on one ESPN id, unmatched matchup players, NBA.com game-log names without an ESPN match | never (warning) |
| `injuries-fresh` | age of the ESPN injury list | older than 36 hours while games tip off in the next 30 hours |
| `out-but-played` | current injury entries (out / doubtful) for players who have played since the entry; the box-score injury list vs minutes | a stale "out" entry for a team playing in the next 30 hours (the model would leave him out) |
| `conflicts` | NBA.com starters vs ESPN out list, ESPN vs NBA.com game-log points, matchup points vs final score, late scratches | a **confirmed** NBA.com starter is listed out or doubtful by ESPN |
| `game-day` | crews and starters for games in the next 30 hours, age of `pregame.json` | never (warning) |
| `matchups` | matchup coverage and backlog | never |
| `odds-isolation` | odds fields (`overUnder`, `moneyline`, `spreadHome`, `spreadOddsHome/Away`, `overOdds`, `underOdds`, `impliedHome`, `providerId`, `pickcenter`, ...) in schedule, every box score, play-by-play and matchup file, game-day, injury, roster, news, NBA.com files or any `public/data` file in any folder other than `odds.json`; also a "for comparison only" block (`bookLine`, `bookProb`, `ourProbAtBookLine`, `comparison`) in any published file outside `public/data/sim/` and `board.json`. About 7,500 files, 2-3 seconds | any hit |

First run, 11 November 2026: 0 errors, 2 warnings (3 NBA.com game-log names without an ESPN match: Lachlan Olbrich, the player behind ESPN's blank Chicago rows, Nikola Djurisic and "Zeng Zeng" (ESPN: Fanbo Zeng); 2 unmatched matchup players; starters not yet confirmed for the evening's games), 4 notes, 9 ok.
