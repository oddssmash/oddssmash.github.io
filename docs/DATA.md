# Site data: every file in `public/data`

Written by `node scripts/model.mjs`. The website reads only these files. Raw inputs (`data/`) are described in `docs/DATA-RAW.md`.

No betting odds, sportsbook lines or prop markets are read, stored or shown anywhere, with one exception: `odds.json` (copied from `data/odds.json` by `scripts/simulate.mjs`) and the `comparison` blocks in `sim/<id>.json` and `board.json`, shown only in the Simulation and High-confidence tabs and labelled "for comparison only". They never feed a projection, the learning or the simulation (see "Simulation lab" below).

Blocks marked **NEW** were added with the shot-zone work (November 2026). Nothing that existed before was renamed or removed.

## Conventions

- **Ids.** Team ids and player ids are ESPN ids stored as strings (`"18"` = New York, `"3112335"` = Nikola Jokic). Game ids are ESPN event ids. Player headshot: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/<playerId>.png&w=<w>&h=<h>`.
- **Dates** are ISO strings in UTC (`"2026-11-12T00:00Z"`). **Game days are US Eastern calendar days**: rest days, back-to-backs and "3 games in 4 nights" (`sched.rest`, `sched.b2b`, `sched.threeIn4`) are counted from the Eastern date of each tip-off, never from the UTC date (a 7pm ET game is 23:00Z or 00:00Z depending on the month). `sched.rest` is never negative. To show a game's day, convert the timestamp to `America/New_York`.
- **Phase key `pk`** is `<season>-<stype>`: season `2026` = 2025-26, `2027` = 2026-27; stype 1 preseason, 2 regular season, 3 playoffs, 5 play-in.
- **Percentages** are already multiplied by 100 unless a field says "0-1" (`pct: 72.5` means 72.5%).
- **Every string comes from data or is built from data. Escape all of them** (`esc()`, `safeUrl()` in `app.js`).
- A block is `null` (or an empty array) when there is not enough data. Always guard.
- **Sample sizes.** Any number meant to be read as evidence carries its sample (`n`, `att`, `fga`, `games`). Show it. Rows flagged `low: 1` are below the minimum for a hot / cold tag.

### Shared vocabulary

| Thing | Values |
|---|---|
| Five zones (`id` / `z`) | `rim` At the rim (restricted area), `paint` Paint (non-restricted), `mid` Mid-range, `c3` Corner three, `atb` Above-the-break three |
| Fine zones | `rim`, `paint`, `midL`, `midC`, `midR`, `c3L`, `c3R`, `atbL`, `atbC`, `atbR`. Left / right follow NBA.com's shot chart. Heaves are kept apart (`zones.heaves`) |
| Shot styles | `drive` Drive / layup, `dunk`, `pull` Pull-up jumper, `step` Step-back, `float` Floater, `post` Hook / post / turnaround / fade, `cut`, `oop` Alley-oop, `tip` Tip / putback, `run` Running / transition, `jump` Catch / plain jumper |
| Zone tag, own shooting | `hot`, `cold`, `neutral` |
| Zone tag, defence (team zones, defender profile) | `soft` / `weak` (opponents shoot clearly above normal), `strong` (clearly below), `neutral` |
| Culture level (percentile based) | `Well above league average` (85+), `Above league average` (65-84), `Around league average` (35-64), `Below league average` (15-34), `Well below league average`, `Not enough data` |
| Scenario sample label | `small` 3-4 games, `moderate` 5-9, `solid` 10+ |

The same lists with labels are in `meta.json > scout` (`zones`, `fineZones`, `styles`, `factors`).

### How the zone numbers are made

- Every field-goal attempt comes from ESPN play-by-play and is placed in a zone by `scripts/lib/zones.mjs`. Checked against NBA.com's own zone table: average gap 0.2 points of shot share and 0.6 points of FG% for the 40 highest-volume players (see `docs/DATA-RAW.md`).
- **Displayed counts** are plain counts over `meta.scout.window` = last season plus this season, regular season, play-in and playoffs, no preseason. They are never weighted, so `made / att` can be recomputed by hand.
- **Hot / cold rule** (`meta.scout.zoneTagRule`): at least 30 attempts in a five-zone row (20 in a fine row, 30 for a shot style), FG% at least 3 points away from league in that zone, and at least 1.5 standard errors away. Anything else is `neutral`. Team zones need 150 attempts (100 fine).
- **"On paper" versus "applied".** A paper edge assumes the opponent's zone percentages carry over in full to this player or team. The back-test supports only part of that (often none). `applied` and the `pts / reb / tpa` columns are what the model really adds. Never show a paper edge without saying it is on paper; `learning.json > factors` holds the evidence.
- For projections the model uses recency-weighted versions of the same counts (`meta.scout.zoneDecay`: half-life 40 games for players and 30 for teams, last season carried at 0.6 / 0.5, preseason at 0.3). Those weighted numbers appear only inside `zm` on upcoming games ("recent games weighted").

---

## `meta.json`

| Field | Meaning |
|---|---|
| `updated` | ISO time of the model run |
| `games`, `predicted`, `upcoming`, `players` | counts: box scores loaded, games walked forward, upcoming games projected, player files written |
| `sources` | `espn`, `zones` (**NEW**), `nbaCom`, `crossCheck`, `ratings2k`, `news`, `excluded`. Each has a `note`; `crossCheck` has `checked`, `matched`, `agreement`, `sample[]`; `ratings2k.sources[]` has `name`, `url`, `players`; `zones` has `seasons[]`, `defenderSnapshots` |
| `note` | one-line statement of the walk-forward rule |
| `scout` **NEW** | shared labels and rules, below |

`scout`:

```json
{ "window": "2025-26 and 2026-27 (regular season, play-in and playoffs)",
  "teamScope": "2025-26 and 2026-27",
  "zoneTagRule": { "minAtt": { "five": 30, "fine": 20, "style": 30 }, "minDiff": 3, "minZ": 1.5 },
  "defenderTagRule": { "minFga": 40, "minDiff": 2.5, "minZ": 1.5 },
  "scenarioMinGames": { "h2h": 3, "team": 5, "player": 3 },
  "zoneDecay": { "playerHalfLife": 40, "teamHalfLife": 30, "leagueHalfLife": 1200, "playerCarry": 0.6, "teamCarry": 0.5, "preseasonWeight": 0.3 },
  "zones": [{ "id": "rim", "label": "At the rim" }],
  "fineZones": [{ "id": "midL", "zone": "mid", "label": "Mid-range, left" }],
  "styles": [{ "id": "drive", "label": "Drive / layup" }],
  "factors": [{ "id": "zone", "label": "Zone edge", "stats": ["pts"], "unit": "points on paper", "what": "Where he takes his shots x ..." }],
  "note": "..." }
```

`teamScope` is the span behind every team rank on the site: this season alone once all 30 teams have played 15 games in it, otherwise this season and last together.

**NEW in `meta.json`:** `data: { scoreOnlyGames[], blankBoxRowsRebuilt, cupFinals[], note }` (finished games known by final score only, box rows rebuilt at load time, NBA Cup finals left out of regular-season records); `scout.cultureMin: { games, minutes }` (sample needed before a culture level is given); `scout.zoneBias` (known corner-three bias of the zone classifier, one sentence); `sources.news.bettingDropped` and `sources.news.filter` (betting items are dropped before anything is stored or shown; a line saying so belongs on the Takes page).

## `results.json`

Array, one row per walked game, oldest first.

`{ id, date, phase, pk, home, away, pred: { hs, as, pHome }, act: { hs, as, ot }, correct, upset, dogProb, upsetFlag, err, totErr }`

- `pred.pHome` 0-1; `act.ot` number of overtimes; `correct` = favourite won; `dogProb` = stated chance of the underdog; `upsetFlag` = flagged before the game.
- `err` = absolute miss on the margin; `totErr` = actual minus projected combined score.

## `games/<id>.json`

Everything in the `results.json` row, plus:

| Field | Meaning |
|---|---|
| `models` | margin (home minus away) from each rating system: `efficiency`, `players`, `elo`, `adjusted`, `luckAdjusted` |
| `weights` | ensemble weight of each at that time |
| `ref` | `{ tot, home }` referee-crew adjustment applied |
| `headline` | one paragraph: projection, result, biggest swing factors |
| `upsetReasons` | strings |
| `pace`, `homeAdv`, `sigma` | projected possessions, home-court points, current margin error scale |
| `officials`, `venue` | from ESPN |
| `teams[]` | `{ tid, isHome, pred, act, err, why: { pace, shooting, overtime, turnovers, lineup, other }, tags[], players: { minutes, usage, efficiency }, scen[], style[], sched: {...}, out: [{ id, n, ppg }] }`. `why` splits the team's scoring miss into causes (points); `scen` = team situations known before the game; `sched` = `{ rest, b2b, threeIn4, roadStreak, lastHome, seasonGames, travel, tz, altitude, lastMargin, lastOT, streak }` |
| `players[]` | below |

Player row: `{ id, n, t, pos, role, st, r2k, pred, act, why, tags[], scen[], adj }`

- `role`: `star`, `starter`, `bench`, or `unprojected` (then `pred` and `why` are `null`).
- `pred`: `{ min, pts, reb, ast, tpm, tpa, lo, hi }` (`lo`-`hi` = 80% range for points).
- `act`: `{ min, pts, reb, ast, tpm, tpa, fg: "4-11", tp: "1-5", pf, dnp }` (`dnp` = reason or `null`).
- `why`: `{ minutes, usage, efficiency }` points of the miss.
- `adj`: `{ pace, defense, split, absence, ww[], matchups[], fx, fxRaw, fxParts }`.
  - `fx` **CHANGED**: what the learned matchup factors are worth in the PUBLISHED points (`pred.pts`), i.e. after the team-total blend. `pred.pts - adj.fx` is the projection with the factors taken out. `fxRaw` **NEW**: the same effect on the unscaled projection (the number the coefficient is validated on; usually 3 to 4 times larger, because rescaling players to the team total cancels most of an opponent-wide effect). `fxParts`: `[factorId, stat, value]` for every part of 0.05 or more, on the unscaled projection, e.g. `[["vol3","tpa",0.16]]`.
  - `ww[]` is now always empty: pairwise with/without evidence is no longer added to projections (see `learning.json > withWithout`).
- `pred.lo` / `pred.hi`: the 80% range now uses two learned widths (`learning.json > rangeCoverage`), so it is no longer symmetric around `pred.pts`.

## `upcoming.json`

Array for the list view, soonest first.

`{ id, date, phase, home, away, venue, pred: { hs, as, pHome, pace, close, blowout }, upset: { flag, n, dogP }, out: [[names], [names]], top: [[{ n, pts, reb, ast } x3], [...]], keys, h2h, scenarios }`

**NEW** fields:

```json
"keys": [ { "tid": "18", "win": ["4 of 5 rating systems favour NY; the blend has it by 7.8 (...).", "Opponent-adjusted net rating: NY +7.3 per 100 possessions, CLE +1.9."] },
          { "tid": "5",  "win": ["NY takes 29.1% of its shots at the rim (11th most) and makes 65.6%; CLE allows 63.7% there (4th lowest of 30, league 66.9%). On paper -1.7 points for NY.", "..."] } ],
"h2h": { "n": 7, "record": { "5": 1, "18": 6 } },
"scenarios": 23
```

- `keys[i].win`: the top two reasons that team can win (home first). A team's reasons to lose are the other team's `win` list. `null` if not built.
- `h2h.n`: meetings on record without preseason; `record` maps team id to wins.
- `scenarios`: how many provable scenarios the detail file holds.

## `upcoming/<id>.json`

Top level: `{ id, date, phase, home, away, venue, pred, models[], ref, conf, upset, teams[2], news[], keys, matchup, h2h, scenarios }`

- `pred` as in the list. `models[]`: `{ k, label, margin, weight }`. `ref`: `{ tot, home, crew[] }` or `null`. `conf`: `{ grade: "High" | "Medium" | "Low", why[] }`. `upset`: `{ flag, reasons[], dogP }`.
- `news[]`: `{ outlet, kind, title, url, date, summary, flags[], tone }`.
- `teams[]` (home first): `{ tid, isHome, pts, model, sumPlayers, sumTeamPts, teamEff, vsStyle, scen: [{ k, w, n }], sched, style, out: [{ id, n, g, min, star, handler, big, stopper, ppg }], injuries: [{ n, status, detail }], players[] }`.
- `teams[].sumTeamPts` **NEW (11 November)**: the sum of the team's player points without personal splits, the number the `players` (Player build-up) margin in `models[]` is built from (home `sumTeamPts` minus away `sumTeamPts`). `sumPlayers` keeps its meaning (the sum including splits), so it can differ from that margin.
  - `style`: `{ pace, off, def, net, tags[], tpar, paint, fb, depth, starterShare, benchPts, efg, oppEfg }`.
  - `scen[].w` = learned points effect of that team situation, `n` = team-games behind it.

Player row: `{ id, n, pos, role, r2k, min, pts, reb, ast, tpm, stl, blk, tpa, lo, hi, scen: [{ s, pts, n }], adj: { pace, defense, split, splitTpa, absence, bias, ww[], matchups[] }, wwD[], q, fx, fxNet, zm }`

**Who gets a row (CHANGED).** Upcoming games use one roster rule, the same as the live-like back-test track (`learning.json > liveTrack`): players with minutes in one of the team's last 10 games who are still on its roster, recent arrivals from another team, and players on the injury list who have played before. A rostered player with no recent minutes gets no row and no default minutes. A bench player who did not play in the team's previous game and is not on the injury list is left out of the rotation for the projection (his recent minutes are shared out); he is NOT listed in `teams[].out`, which holds the injury list only. A regular starter who sat the previous game is expected back.

- `adj.ww[]` is now always empty and `adj.absence` comes from the usage formula alone. `wwD[]` **NEW** is the counted with/without evidence, shown but not applied: `{ id, n, pts, without: { n, ppg, mpg }, with: { n, ppg, mpg } }` = his points and minutes a game in the games absent teammate `n` missed versus the games they shared (same team, this season and last, from the teammate's first game for the team; the teammate's coach's-decision games are not counted). `pts` is the estimate the model would have added (scaled to tonight's minutes, shrunk for sample size, weighted by how recent the absence is); it is NOT in `pts`.
- `lo` / `hi`: no longer symmetric around `pts` (two learned widths, see `learning.json > rangeCoverage`).
- `fxNet` **NEW**: what all factor effects on points together are worth in the published `pts` (after the team-total blend). `fx[].v` stays the effect on the unscaled projection.
- `teams[].sched.streak` is 0 (and no streak, "after a blowout" or "after overtime" tag is attached) unless the team's previous scheduled game has been played.

### `players[].fx` NEW

The learned factor adjustments in this projection (parts of 0.02 or more). Empty array when none applies.

```json
"fx": [ { "f": "rim", "label": "Rim-protector edge", "stat": "pts", "v": -0.16 } ]
```

`stat` is `pts`, `reb`, `ast`, `tpa` or `min`; `v` is in that stat's units, measured on the unscaled projection. For rebounds, assists and three-point attempts that is what is published. For points the published effect is smaller (`fxNet`), because players are rescaled to the team total afterwards.

### `players[].zm` NEW

The zone / defender matchup that applies tonight. `null` under 10 projected minutes or without shot history.

```json
"zm": { "zone": "rim", "tag": "cold spot meets strong spot", "att": 6.4, "own": -2.4, "opp": -2.5,
        "paper": -0.82, "applied": -0.16,
        "zones": [["rim", 6.4, -2.5, -0.33], ["paint", 1.7, -2.4, -0.08], ["mid", 0.8, -0.1, 0], ["c3", 0.2, -0.1, 0], ["atb", 3.6, 1.4, 0.15]],
        "rimDefenders": [ { "n": "Evan Mobley", "diff": -8.4, "fga": 500, "src": "snapshot 20261109" } ],
        "perimeter": { "diff": -1.1, "fga": 795 },
        "txt": "6.4 attempts a game at the rim, where he shoots -2.4 points of FG% versus league; CLE allows -2.5 versus league there (recent games weighted). Likely rim defenders: Evan Mobley -8.4 versus league on 500 shots, Jarrett Allen -7.7 versus league on 332 shots." }
```

| Field | Meaning |
|---|---|
| `zone` | the zone that moves his paper edge most |
| `tag` | **CHANGED rule.** `hot spot meets soft spot`, `cold spot meets strong spot`, `soft spot`, `strong spot`, `neutral`. It now follows the published sample rule from the same plain counts as the Scout tables: the player half needs `ownTag` = hot / cold (30 attempts in the zone, 3 points of FG% versus league, 1.5 standard errors), the opponent half needs `oppTag` = soft / strong (150 attempts allowed, same gaps). A "meets" tag needs both |
| `n`, `pct`, `lgPct`, `ownTag` | **NEW.** his `[made, attempts]` in that zone over the Scout window, his FG%, the league FG%, and `hot` / `cold` / `neutral` exactly as on his Scout page. Show `n` next to the tag |
| `oppN`, `oppPct`, `oppTag` | **NEW.** the opponent's `[made, attempts]` allowed there, its allowed FG%, and `soft` / `strong` / `neutral` exactly as on its team page |
| `att` | his projected attempts there tonight |
| `own` | his FG% there minus league, points (recency weighted, pulled toward league by 25 attempts) |
| `opp` | opponent's allowed FG% there minus league, points (recency weighted, pulled toward league by 150 attempts) |
| `paper` | zone edge + rim-protector edge in points if those percentages carried over in full |
| `applied` | **CHANGED.** what the learned factors are worth in his published points (= `fxNet`). `appliedRaw` **NEW**: the sum of `fx` for `pts` on the unscaled projection |
| `zones` | all five: `[zone, attempts, opponent diff, paper points]` |
| `rimDefenders` | the opponent's two heaviest rim defenders expected to play: allowed FG% inside 6 ft minus league (`diff`, negative = good defender), shots behind it, and the table used |
| `perimeter` | same for threes, the opponent's likely defenders at his position, measured against what teams usually field |
| `txt` | ready-made sentence; now states the plain counts (made of attempts, league %) for both halves instead of the weighted gaps |

### `keys` NEW: why each team can win or lose

**CHANGED.** `keys.mixed[]` (new, `{ kind, t, n }`): schedule situations where the league-wide learned effect and the team's own record in that spot point in opposite directions; they are listed there and credited to neither side. A back-to-back is told once (from the side of the team playing it, with the effect on both teams' scores) instead of once per team. A `zone` or `player` paper edge is now weighted by the share of it the back-test supports and never above 1 point (`w`), and its sentence ends with the back-test verdict on zone edges; team-level zone edges are not tested at all. The `situation` line also gives the team's own record in the spot when it has 5+ games there.

```json
"keys": { "teams": [ { "tid": "18", "win": [ { "kind": "ratings", "t": "4 of 5 rating systems favour NY; the blend has it by 7.8 (Recent efficiency +6, ...).", "n": "9 + 11 games this season", "w": 7.76 } ], "lose": [ ... ] },
                     { "tid": "5", "win": [ ... ], "lose": [ ... ] } ],
          "note": "..." }
```

- `win` = edges that favour that team, `lose` = edges that favour its opponent (so one team's `lose` equals the other's `win`). Up to 7 each, strongest first.
- `t` sentence with its numbers; `n` the sample as text; `w` rough size in points, for ordering only (do not display as a prediction).
- `kind`: `ratings`, `home`, `zone` (zone battle), `fourFactors` (shooting, turnovers, rebounding, free throws, three-point volume, early offence), `pace`, `situation` (rest / travel / streak with its learned effect), `style` (record versus projection against the opponent's style tags), `absence` (measured net-rating swing without the player), `form`, `h2h`, `player` (largest individual zone matchup).
- A four-factor line is only produced when one side ranks in the top 10 and the other in the bottom 10 of the matching number. A zone line needs a paper edge of 0.7 points and a top-8 or bottom-8 zone defence.

### `matchup` NEW: numbers behind the zone battle and the four factors

```json
"matchup": { "scope": "2025-26 and 2026-27", "window": "2025-26 and 2026-27 (regular season, play-in and playoffs)",
  "zones": [ { "off": "18", "def": "5", "rows": [ { "z": "rim", "share": 29.1, "shareRank": 11, "pct": 65.6, "pctRank": 24, "allowed": 63.7, "allowedRank": 4, "lg": 66.9, "att": 2822, "attAllowed": 2744, "paper": -1.65 } ] }, { "off": "5", "def": "18", "rows": [ ... ] } ],
  "factors": [ { "id": "shooting", "label": "Effective FG%", "off": "18", "def": "5", "offVal": 55.4, "offRank": 7, "defVal": 54.1, "defRank": 11 } ] }
```

- `zones[]`: one entry per direction (`off` attacking `def`). `share` = share of `off`'s shots in the zone, `pct` its FG%, `allowed` = `def`'s FG% allowed, `lg` league FG%, `paper` = points per game on paper for `off`. Ranks are 1-30: `shareRank` 1 = takes the most there, `pctRank` 1 = best FG%, `allowedRank` 1 = lowest FG% allowed.
- `factors[]`: 6 rows per direction, ids `shooting`, `turnovers`, `rebounding`, `freeThrows`, `threeVolume`, `earlyOffence`. `offRank` 1 = best for the offence, `defRank` 1 = best for the defence.

### `h2h` NEW: every previous meeting

**CHANGED.** Finished meetings ESPN has no box score for are included by final score: `games[]` rows with `noBox: true` (`pred`, `q`, `tp`, `ft`, `reb`, `tov`, `paint`, `lead`, `lc`, `clutch` are `null`; `decided` says why), counted in `n`, `record` and the first two `patterns`; `h2h.noBox` is how many there are. Stat patterns and scenario conditions use the meetings with a box score only and say so.

```json
"h2h": { "n": 7, "preseason": 0, "record": { "5": 1, "18": 6 },
  "patterns": [ "NY 6-1 CLE in 7 meetings since October 2025; average margin NY by 10.1.", "The home team won 5 of 7.", "The projection picked the winner in 7 of 7; average margin miss 9.2 points.", "3 of 7 were within 5 points in the last 5 minutes." ],
  "games": [ { "id": "401909940", "date": "2026-11-08T01:00Z", "phase": "2026-27 Regular Season", "pre": false, "home": "5", "away": "18", "hs": 97, "as": 109, "ot": 0, "winner": "18",
               "pred": { "hs": 109.9, "as": 112.4, "pHome": 0.419 }, "called": true, "marginErr": 9.5,
               "decided": "Versus the projection: NY game pace -7, CLE game pace -6.8, NY who actually played -6.1 points.",
               "edges": "NY won offensive rebounds 16-10.", "swing": { "q": 2, "t": "18", "by": 11 },
               "q": [[27,26,17,27],[26,37,25,21]], "lead": [6, 19], "lc": 11, "clutch": false,
               "tp": [[16,50],[14,44]], "reb": [40,49], "tov": [11,10], "paint": [32,34], "ft": [[11,19],[13,14]] } ],
  "note": "..." }
```

- `games` newest first; link each to its past-game page (route `#/result/<id>` in the current site; the data file `games/<id>.json` exists whenever `pred` is not null). The same applies to the ids in `scenarios.list[].games`. `pre: true` marks a preseason game; those are listed but not counted in `n`, `record`, `patterns` or scenarios.
- `pred`, `called`, `marginErr`: the walk-forward projection made before that game, whether it named the winner, and its margin miss. `null` when the game was not projected (a team's first three games on record).
- `decided`: the stored error breakdown of that game (causes that moved a team's score by 4+ points versus the projection). `edges`: counted box-score gaps of the winner worth about 4+ points. `swing`: the quarter with the largest margin and who won it.
- Paired arrays are `[home, away]`: `q` points per period, `lead` largest lead, `tp` and `ft` `[made, attempted]`, `reb`, `tov`, `paint`. `lc` lead changes; `clutch` = within 5 points at some moment in the last 5 minutes.

### `scenarios` NEW: provable if-then statements

**CHANGED rules.** (1) Conditional records (`team` / `teamIf`) are judged against the league-wide win rate under the same condition, adjusted for the team's own record, and the sentence and `ev` quote those rates; `fav` is the team itself when it does better than a team of its record usually does in that spot. (2) They are never `known`; see `likely`. (3) "The team that won battle X won k of n": `fav` is the team that won that battle in most of those meetings; the season rank decides only when the meetings are split, and `ev` says so. (4) A meeting threshold ("when X shot under 34% ...") is kept only when the result differs from the other meetings by 30 points of win rate. (5) With/without records count every game the player missed since his first game for the team, not only games where the box score listed him. (6) Player absence lines state plain counts (`wwD`) and link their games; every line now has games behind it. (7) "Averages N points in K games against X" counts every game from the box scores. (8) Back-to-backs are counted on the US calendar, and streak spots are attached only when the previous game has been played.

```json
"scenarios": { "min": { "h2h": 3, "team": 5, "player": 3 }, "total": 33, "note": "...",
  "list": [ { "kind": "style", "t": "CLE is 6-15 since October 2025 against teams tagged \"Elite defense\" (-3.7 points versus its projected margin on average); that applies to this game.",
              "ev": "CLE overall in projected games: 64-43. League-wide learned effect of this situation on a team's score: +0.27 points (447 team-games). NY carries the \"Elite defense\" tag today.",
              "n": 21, "games": ["401810776", "..."], "fav": "18", "known": true, "strength": 2.92, "sample": "solid" } ] }
```

| Field | Meaning |
|---|---|
| `t` | the statement. Always a count or an average over finished games |
| `ev` | supporting evidence and context (baseline record, game-by-game values) |
| `n` | games behind the statement |
| `games` | ids of those games, at most the 15 most recent, and only ids that have a `games/<id>.json` file (so it can be shorter than `n`). Link them |
| `fav` | team id it favours, or `null` when neither side has the edge |
| `known` | **CHANGED.** `true`: already true for this game (schedule spot, opponent's style tag, an absence, the history of the meetings, a player's history against this opponent). `false`: an if-then that matters only if the condition happens during the game. A conditional record (`kind` `team` / `teamIf`) is never `known` |
| `likely`, `trait` | **NEW**, on `team` lines: `likely: true` = the condition has not happened, but the opponent's profile makes it more likely than usual; `trait` is the sentence saying why. Suggested chip: "More likely than usual". Never show these as already true |
| `mixed` | **NEW**, on `schedule` lines: `true` when the team's own record in the spot and the league-wide learned effect point in opposite directions. `fav` is then `null` |
| `strength` | sort key: a z-score of the record against the team's own baseline (or the gap divided by its standard error), scaled down for if-then lines. The list is already sorted |
| `sample` | `small` / `moderate` / `solid` from `n`. Show it; small samples are patterns to watch, not facts |
| `kind` | `h2h` (previous meetings: record, margin versus projection, "the team that won battle X won k of n", thresholds, quarters, zone shooting, clutch), `team` (conditional record tied to an opponent trait), `teamIf` (conditional record with no tie to tonight), `schedule`, `style`, `absence`, `player` (points or zone shooting against this opponent), `form` |
| `pid` | player id, on `player` lines |
| `cond` | condition id, on `team` / `teamIf` lines |

`min` is the minimum number of games per family; `total` is how many passed before the per-kind caps (the list holds at most 26).

## `players.json`

Index for search and lists: `{ id, n, pos, team, arch, k2, cur, prev, hot, cold, tags }`

- `cur` / `prev`: `[games, minutes, points, rebounds, assists]` this / last regular season, or `null`.
- **NEW** `hot`, `cold`: five-zone ids tagged hot / cold (`["rim","paint","mid"]`). `tags`: playstyle tags (`["Post / hook game","Playmaker"]`).

## `players/<id>.json`

Existing fields:

| Field | Meaning |
|---|---|
| `id, n, pos, team` | |
| `cur`, `prev`, `last5` | `{ gp, min, pts, reb, ast, tpm, stl, blk, to, ts }` (`ts` 0-1) |
| `consistency` | standard deviation of actual minus projected points, last 30 |
| `bias` | average actual minus projected points, last 15 |
| `tradeoff` | `{ games, astPer10Pts, r }` or `null` |
| `ripple[]` | `{ id, n, games, ptsPer10, ptsR, astPer10, astR }` teammates |
| `splits` | `{ best[], worst[], moreThrees[], fewerThrees[], players[], arenas[], archetypes[] }`, rows `{ key, type, label, n, small, pts, tpa, reb, ast, min, raw, score }`, plus `overall`, `rule`, `note`. **CHANGED (in-loop round):** `pts / tpa / reb / ast / min` are RELATIVE (gap in that situation minus his overall gap), `raw` = the plain gap; rows need 5 games (opponent, opposing player, arena) or 8 (everything else). See "In-loop features" |
| `log[]` | last 12: `{ d, opp, min, pts, reb, ast, dnp }` |
| `absence` | team with / without him: `{ with, without, coachDecisions, netWith, netWithout, netSwing, offSwing, defSwing, winPctWith, winPctWithout, teammates[], oppPosWith, oppPosWithout }`, or `{ with, without, coachDecisions }` when there are fewer than 8 games with or 3 without, or `null`. **CHANGED count:** "on the team" is now a date span (every team game from his first appearance for the team, this season and last, while he is still on its roster), so `without` includes the games where the box score did not list him at all. `coachDecisions` = how many of the `without` games the box score lists as a coach's decision |
| `height`, `archetype` | inches; label |
| `nba` | NBA.com season numbers (`season, usg, ts, net, off, def, pie, astPct, rebPct, pace, paintShare, threeShare, assisted, drives, drivePts, potAst, touches, timePoss, miles, speed, contests36, deflections36, looseBalls, charges, boxOuts, screenAst, defWs, stl, blk, clutch, ptsOffTov, ptsFb, ptsPaint`) or `null` |
| `k2` | unofficial 2K rating block `{ ovr, ovr2, arch, dur, attrs, src }` or `null`. Label it unofficial |
| `motor` | older single hustle score (z). Prefer `culture` |

### `zones` NEW: court map, hot and cold spots

```json
"zones": { "window": "2025-26 and 2026-27 (regular season, play-in and playoffs)", "games": 79, "fga": 1400,
  "rule": { "minAtt": { "five": 30, "fine": 20, "style": 30 }, "minDiff": 3, "minZ": 1.5 },
  "five": [ { "id": "rim", "label": "At the rim", "att": 389, "made": 282, "pct": 72.5, "share": 27.8, "lgPct": 66.9, "lgShare": 28.4, "diff": 5.6, "pps": 1.45, "lgPps": 1.34, "astPct": 49, "tag": "hot", "cur": [38, 28] } ],
  "fine": [ { "id": "midC", "label": "Mid-range, centre", "att": 61, "made": 36, "pct": 59, "share": 4.4, "lgPct": 41.5, "lgShare": 4, "diff": 17.5, "pps": 1.18, "lgPps": 0.83, "astPct": 69, "tag": "hot", "cur": [8, 3] } ],
  "heaves": [18, 2] }
```

- `five` has 5 rows, `fine` 10 rows (ids in the vocabulary table). Use `fine` for the court map and `five` for the summary.
- `att`, `made`, `pct`; `share` = share of his attempts; `lgPct`, `lgShare` league values over the same window; `diff` = `pct - lgPct`; `pps` points per shot, `lgPps` league; `astPct` share of his makes there that were assisted; `cur` = `[attempts, made]` this season only.
- `tag`: `hot` / `cold` / `neutral` by `rule`. `low: 1` when under the minimum attempts (then the tag is always `neutral`; draw it muted).
- `heaves` = `[attempts, made]` end-of-period heaves, not in any zone.
- `fga` here counts play-by-play attempts without heaves; it can differ from the box score by a shot or two.

### `styles` NEW: shot-style mix

```json
"styles": [ { "id": "jump", "label": "Catch / plain jumper", "att": 402, "made": 170, "pct": 42.3, "share": 28.3, "lgPct": 36.9, "diff": 5.4, "tag": "hot" } ]
```

Sorted by attempts; styles he never used are left out. `lgPct` = league FG% on that shot type. Tag rule as for zones (30 attempts).

### `defense` NEW: what shooters do against him

```json
"defense": { "src": "NBA.com defender tracking (closest defender)", "window": "2025-26 and 2026-27 regular season", "games": 73,
  "rule": { "minFga": 40, "minDiff": 2.5, "minZ": 1.5 },
  "rows": [ { "id": "rim", "label": "Inside 6 ft", "fga": 529, "pct": 64.5, "exp": 64, "diff": 0.5, "tag": "neutral" } ],
  "blocks": { "rim": 36, "paint": 30, "mid": 2, "three": 0, "total": 68, "src": "play-by-play" } }
```

- Row ids: `rim` Inside 6 ft, `short` Inside 10 ft, `two` Two-pointers, `mid` Long twos (15 ft to the arc), `long` Beyond 15 ft, `three` Threes, `overall`.
- `fga` shots he was the closest defender on; `pct` what shooters made; `exp` what those same shooters normally make; `diff` = `pct - exp` (negative is good defence).
- `tag`: `strong` (his defensive hot spot), `weak` (cold spot), `neutral`, by `rule`. `low: 1` under 40 shots.
- `blocks`: his blocked shots by zone of the shot.
- This is NBA.com's "closest defender" tracking. It says who was nearest, not who was assigned.

### `playstyle` NEW

```json
"playstyle": { "tags": ["Post / hook game", "Playmaker"],
  "lines": [ "63.5% of his shots come at the rim or in the paint, 10.5% from mid-range and 26% from three (1400 attempts).", "..." ],
  "shotMix": { "rimPaint": 63.5, "mid": 10.5, "three": 26 },
  "creation": { "assisted": 60.9, "lgAssisted": 63.7, "transShare": 4, "ftPer100Fga": 40,
                "catchShoot": { "freq": 21, "efg": 61.6, "fga": 237, "season": "2025-26" }, "pullUp": { "freq": 11.7, "efg": 49.6, "fga": 132, "season": "2025-26" } },
  "per36": { "pts": 27.6, "ast": 10.7, "oreb": 2.9, "dreb": 10.1, "to": 3.8, "fta": 7.2 },
  "playTypes": { "season": "2025-26", "src": "NBA.com Synergy play types", "rows": [ { "id": "Postup", "label": "Post-up", "freq": 22.5, "ppp": 1.13, "pctile": 75, "poss": 348, "gp": 63 } ] } }
```

- `tags`: each is a threshold on a number in this block. Possible values: `Rim attacker` (40%+ of shots at the rim), `Three-point-heavy shot diet` (60%+ of his shots are threes; **RENAMED** from `Three-point specialist`, because it is a volume tag and says nothing about accuracy), `Perimeter-oriented` (45%+), `Mid-range game` (22%+), `Self-creator` (40% or less of makes assisted), `Play finisher` (80%+ assisted), `Pull-up shooter`, `Post / hook game`, `Driver`, `Lob and putback finisher`, `Transition scorer`, `Foul drawer` (40+ free throws per 100 shots), `Playmaker` (7+ assists per 36), `Offensive rebounder` (3.5+ per 36), `Corner shooter`.
- `lines`: plain sentences built from the numbers (shot diet, creating versus finishing, catch-and-shoot versus pull-up, common shot types, early offence, main play types, pace).
- `creation.assisted` share of his makes that were assisted, `lgAssisted` league; `transShare` share of his shots taken within 6 seconds of a steal or defensive rebound; `catchShoot` / `pullUp` from NBA.com tracking (`freq` share of his attempts, `efg`).
- `playTypes.rows`: sorted by `freq` (share of his possessions); `ppp` points per possession; `pctile` NBA.com percentile 0-100, **now `null` under `playTypes.minPoss` (40) possessions**, where the row also carries `low: 1`; `poss` possessions; `gp` games; `team` (only after the next `fetch.mjs zones` run) the team or teams the row covers. `playTypes.partial: true` with `playTypes.note` **NEW** marks a player who changed teams: NBA.com returns some of his play types for one stint only, so rows cover different games (`gp` differs) and `freq` does not add up to 100%. Show the note. The "Main play types" sentence in `lines` now gives the possessions behind each item and no percentile under 40. The season is this season once he has 15 games in the table, otherwise last season. NBA.com lists a player only above its own minimum, so rows can be missing.

### `culture` NEW: data indicators

Array of six, always in this order: `motor`, `unselfish`, `discipline`, `availability`, `clutch`, `consistency`.

```json
{ "id": "unselfish", "label": "Unselfishness (passing share)", "level": "Well above league average", "pctile": 96,
  "value": "33% of his plays end in an assist rather than his own shot",
  "ev": "10.5 assists against 17.7 shots and 7 free throws per game; compared with other centres.", "n": "79 games" }
```

| id | What is measured | `level` |
|---|---|---|
| `motor` | deflections, contested shots, loose balls (NBA.com hustle) and offensive rebounds per 36, each as a percentile at his position, then averaged | percentile scale |
| `unselfish` | assists / (assists + shots + 0.44 x free throws), percentile at his position | percentile scale |
| `discipline` | fouls per 36 (60%) and technicals + flagrants + ejections per game (40%), reversed so that high = fewer | percentile scale |
| `availability` | games played / his team's regular-season games | `90%+ of games`, `80-91% of games`, `65-79% of games`, `50-64% of games`, `Under 50% of games` |
| `clutch` | FG% in the last 5 minutes within 5 points versus his own FG% after the league-wide late drop | `Above his norm late`, `In line with his norm late`, `Below his norm late`, `Not enough data` (under 25 clutch shots) |
| `consistency` | spread of actual minus projected points, scaled by scoring level | percentile scale, high = steadier |

`pctile` is 0-100 or `null`. `value` is the headline number, `ev` the evidence, `n` the sample. These are measurements, not judgments of a person: show the label with the number next to it, never alone.

**CHANGED.** `motor`, `unselfish`, `discipline` and `consistency` compare a player with the league, so under `meta.scout.cultureMin` (20 games and 400 minutes; motor also needs 20 games of hustle tracking) they now carry `level: "Not enough games yet"` and `pctile: null`, with the raw numbers and the sample still shown. The league distributions hold qualified players only. The `discipline` label is now `"Discipline (fouls and technicals)"`: the level is scored on fouls and technicals only; turnovers are listed in `ev` as context.

### `quarters` NEW

```json
"quarters": { "window": "...", "games": 79,
  "rows": [ { "q": "Q1", "pts": 7.9, "share": 29.1, "lgShare": 25.3 }, { "q": "Q2", "pts": 4.8, "share": 17.9, "lgShare": 25 }, { "q": "Q3", "pts": 8.9, "share": 32.8, "lgShare": 25.3 }, { "q": "Q4", "pts": 4.9, "share": 18, "lgShare": 23.9 }, { "q": "OT", "pts": 0.6, "share": 2.2, "lgShare": 0.5 } ],
  "clutch": { "games": 37, "pts": 164, "fgm": 48, "fga": 101, "tpm": 6, "tpa": 30, "ftm": 62, "fta": 75 } }
```

`pts` = points per game played in that quarter (overtime averaged over all games); `share` of his points; `lgShare` league. `clutch` = totals in the last 5 minutes of the 4th or overtime with the score within 5; `games` = his games that reached clutch time.

### `scout` NEW: strengths and weaknesses

```json
"scout": { "strengths": [ { "t": "Hot in the paint (outside the restricted area): 57.2% on 500 attempts (league 44.2%), 35.7% of his shots.", "n": 500, "k": "zone" } ],
           "weaknesses": [ { "t": "Defence, threes: shooters make 39.9% against him versus 34.5% normally (358 shots).", "n": 358, "k": "defense" } ] }
```

Up to 8 each, strongest evidence first. `k`: `zone`, `style`, `playtype`, `defense`, `split` (a row from `splits`, 5+ games and 2.5+ points), `clutch`, `culture`, `quarter`, `matchup` (best / toughest zone matchup on paper, with what the model applies). `n` is the sample (`null` for `matchup`). Caps per kind keep the list varied (3 zone, 2 style, 2 play type, 2 defence, 2 split).

### `vsTeams` NEW: what if he faces team X

```json
"vsTeams": { "cols": ["team","pts","reb","tpa","paperPts","paperReb","paperTpa","zones","games","histPts","zoneHist"], "minutes": 35.7,
  "rows": [ ["4", -0.02, 0, -0.04, 0, 0.3, -0.1, [["atb", 2.2], ["rim", -1.4]], 4, 3.2, [2, [8,10], [5,13], [4,7], [0,0], [3,8]]] ] }
```

One row per other team (29), columns as named in `cols`:

| Column | Meaning |
|---|---|
| `team` | team id |
| `pts`, `reb`, `tpa` | change the model applies against that team today (learned factors, only as far as the back-test supports them) |
| `paperPts` | zone edge + rim-protector edge on paper, points |
| `paperReb`, `paperTpa` | glass edge and three-point-volume edge on paper |
| `zones` | the one or two zones that drive `paperPts`: `[zone, opponent's allowed FG% minus league in points]` |
| `games`, `histPts` | his games against that team in the back-test and his average points versus expectation in them (`null` if none) |
| `zoneHist` | `[games, [made, att] x5]` his real shooting against that team by five zone (rim, paint, mid, c3, atb), or `null` under 2 games |

`minutes` = the minutes assumed. The opponent side uses that team's roster and injury list as of the run. `null` for players with under 8 projected minutes.

## `teams.json`

**NEW: `teams/<id>.json`** holds `{ id, zones, playTypes, playstyle, culture }` for one team (about 10 KB each), written on every run. The same four blocks are still inside `teams.json` so nothing breaks; once the team page and the Scout matchup lab load `teams/<id>.json` instead, run the model with `CL_TEAMS_SLIM=1` (or flip `TEAMS_JSON_SLIM` in `model.mjs`) and `teams.json` drops from about 490 KB to about 200 KB.

`record` is the official regular-season record: the NBA Cup final (`meta.data.cupFinals`) is left out, as are player season lines (`cur` / `prev`). In `culture`, the `effort` numbers are now the games-weighted average of the NBA.com hustle tables of the seasons in the stated scope and `n` gives the hustle sample itself; the `discipline` label is `"Discipline (rank: fouls per game)"`.

Array of 30. Existing fields: `id, abbr, name, short, color, alt, logo, coach, coachExp, coachTags[], style, record: { w, l }, last10[], ratings: { elo, adjOff, adjDef, adjNet, luckNet, threeLuck }, vsModel, vsStyle[], vsTeam[], allowed: { G, F, C }, nba, lineups[], news[]`.

### `zones` NEW

```json
"zones": { "window": "...", "games": 96, "rule": { "minAtt": { "five": 150, "fine": 100 }, "minDiff": 3, "minZ": 1.5 },
  "off": { "fga": 8363, "five": [ { "id": "rim", "label": "At the rim", "att": 2248, "made": 1531, "pct": 68.1, "share": 26.9, "lgPct": 66.9, "diff": 1.2, "astPct": 63, "tag": "neutral", "rank": 8, "shareRank": 22 } ], "fine": [ ... ] },
  "def": { "fga": 8728, "five": [ { "id": "rim", "label": "At the rim", "att": 2370, "made": 1650, "pct": 69.6, "share": 27.2, "lgPct": 66.9, "diff": 2.7, "tag": "neutral", "rank": 27, "shareRank": 11 } ],
           "fine": [ { "id": "midC", "att": 333, "made": 120, "pct": 36, "share": 3.8, "lgPct": 41.5, "diff": -5.5, "tag": "strong" } ] } }
```

- `off` = the team's own shots: tags `hot` / `cold` / `neutral`; `rank` 1 = best FG% of 30; `shareRank` 1 = takes the most there.
- `def` = shots it allowed: tags `soft` (opponents clearly above league: a soft spot) / `strong` / `neutral`; `rank` 1 = lowest FG% allowed; `shareRank` 1 = allows the fewest attempts there.
- `fine` rows have no `label`, `rank` or `shareRank` (use `meta.scout.fineZones` for labels).

### `playTypes` NEW

```json
"playTypes": { "season": "2025-26", "gp": 80, "src": "NBA.com Synergy play types",
  "off": [ { "id": "Spotup", "label": "Spot-up", "freq": 19.5, "ppp": 1.14, "pctile": 100, "poss": 1744 } ],
  "def": [ { "id": "Spotup", "label": "Spot-up", "freq": 27.5, "ppp": 1.02, "pctile": 90, "poss": 2479 } ],
  "offBest": ["Spotup", "OffScreen", "PRRollman"], "offWorst": [], "defBest": ["Spotup", "OffRebound"], "defWorst": ["Transition", "Handoff", "Isolation"] }
```

Ten play types per side (`Isolation, Transition, PRBallHandler, PRRollman, Postup, Spotup, Handoff, Cut, OffScreen, OffRebound`). Offence: a high `pctile` means more points per possession. Defence: a high `pctile` means FEWER points allowed. `*Best` / `*Worst` hold up to three ids at or above the 75th / at or below the 25th percentile with at least 4% frequency. The season is this season once the team has 15 games in the table, otherwise last season.

### `playstyle` NEW

`{ lines: [...], scope: "2025-26 and 2026-27", games: 96 }`. Sentences with ranks: pace, three-point and free-throw rates, shot diet by zone, zone defence, assists and turnovers, rebounding and early offence, best play types, weakest defended play types. Example: `"Shot diet: 26.9% at the rim (9th fewest), 12% mid-range, 40.3% threes. Makes 68.1% at the rim (8th of 30) and 37.2% above the break (1st)."` Ranks in sentences are read from the nearer end of the table ("9th fewest" instead of "22nd most").

### `culture` NEW

Array, ids in order: `effort`, `discipline`, `unselfish`, `resilience`, `quarters`, `continuity`, `experience`, `homeRoad` (the last three can be missing early in a season). Each: `{ id, label, rank, value, ev, n }` plus extras.

```json
{ "id": "resilience", "label": "Resilience", "rank": null,
  "value": "After a loss: 3-0 in 2026-27, 22-9 in 2025-26. Games decided by 5 or fewer or in overtime: 1-0 in 2026-27, 15-17 in 2025-26.",
  "ev": "Trailed by 10 or more at some point: 2-3 in 2026-27, 13-21 in 2025-26 (comebacks are the wins). Led by 10 or more: 4-1 in 2026-27, 48-14 in 2025-26. Entered the 4th quarter down 10 or more: 1-1 in 2026-27, 2-10 in 2025-26. Games that reached clutch time (within 5 in the last 5 minutes): 2-1 in 2026-27, 24-20 in 2025-26.",
  "n": "9 games this season, 87 last season",
  "rec": { "afterLoss": { "cur": [3, 0], "prev": [22, 9] }, "close": { "cur": [1, 0], "prev": [15, 17] }, "down10": { "cur": [2, 3], "prev": [13, 21] }, "up10": { "cur": [4, 1], "prev": [48, 14] }, "clutch": { "cur": [2, 1], "prev": [24, 20] } } }
```

| id | Content | Extras |
|---|---|---|
| `effort` | deflections, contests, loose balls a game (NBA.com hustle) with ranks; offensive rebound rate; second-chance points | `rank` = deflections rank |
| `discipline` | fouls a game, turnovers per 100 possessions, player and coach technicals, flagrants, ejections, opponent free-throw rate | `rank` = fouls rank (1 = fewest) |
| `unselfish` | share of made baskets that were assisted | `rank` (1 = highest) |
| `resilience` | records after a loss, in close games, when trailing or leading by 10+, entering the 4th down 10+, in clutch games | `rec` with `[wins, losses]` for `cur` and `prev` season |
| `quarters` | average margin per quarter, best and worst quarter, record when leading / trailing at half | `q` = four margins, `qRank` = four ranks |
| `continuity` | share of this season's minutes from players who played for the team last season | `share` |
| `experience` | minutes-weighted age | `age` |
| `homeRoad` | home and road record and average margin, both seasons | `rec.home`, `rec.road` |

"Trailed / led by 10+" come from the play-by-play score flow (largest deficit and lead), which matches the box score in 3,183 of 3,184 team-games.

## `learning.json`

Existing: `phaseSummary[]` (`pk, label, games, winnerAcc, marginMAE, teamPtsMAE, upsets, upsetFlags, upsetFlagHits, teamErrorSources, playerErrorSources`), `timeline[]` (weekly: `week, phase, games, acc, cumAcc, marginMAE, sources, playerSources, tags`), `scenarios[]` (`s`, `roles.<role>.<stat> = { effect, n, rawAvg }`), `teamScenarios[]` (`k, effect, n, rawAvg`), `calibration[]` (`bucket, games, said, happened`), `models[]` (`k, label, weight, phases[]`), `rangeCoverage` (`target, actual, n, above, below, zHi, zLo, note`: `lo` = points minus `zLo` standard deviations, `hi` = points plus `zHi`; both widths start at 1.28 and are adjusted after every player-game so that about 10% of results fall above the range and 10% below; `above` / `below` are the walk-forward shares), `referees` (`games, applied, totalErrWith, totalErrWithout, crews[]`), `tagFreq[]`, `params[]`.

### `liveTrack` NEW: the same model without line-ups and inactive lists

`phaseSummary` and every `games/<id>.json` page are the **tip-off track**: the projection knows the confirmed inactive list and the starting five. Upcoming games are projected earlier, without either. `liveTrack` scores the same walk-forward model a second time under those conditions (never learned from):

```json
"liveTrack": { "note": "...", "rosterRule": "...",
  "phases": [ { "pk": "2026-2", "label": "2025-26 Regular Season", "games": 1230, "winnerAcc": 0.662, "marginMAE": 11.47, "players": 18556, "ptsMAE": 5.07, "minMAE": 4.88, "absentShare": 0.09,
                "top5Min": 152.4, "rotation": 10.8, "top5MinBias": -0.93, "top5PtsBias": -0.08 } ] }
```

`ptsMAE` / `minMAE`: players projected 15+ minutes who played. `absentShare`: players projected 15+ minutes who did not play. `top5Min`: projected minutes of a team's five highest-minute players; `rotation`: players given 1+ minute; `top5MinBias` / `top5PtsBias`: actual minus projected for those five when they played. The stored injury list of a past game is not point-in-time (it is ESPN's list on the day the game was downloaded: 43% of players it lists as out played in that game), so this track assumes a player is out only when he missed the previous game. Upcoming games also have the current injury report, so their accuracy should sit between the two tracks. Show both when quoting accuracy.

### `withWithout` NEW

`{ applied: false, note }`. Pairwise with/without evidence is counted and shown (`upcoming/<id>.json > players[].wwD`, absence scenarios) but no longer added to projections; the note gives the back-test comparison behind that decision.

### `factors` NEW: the learned matchup factors and what the back-test says

```json
"factors": {
  "summary": "19 factor effects tested walk-forward: 1 helps, 1 is small, 17 show no measurable effect yet and are held at zero. Change in mean absolute error of the unscaled projection from all applied effects together: points 0.0000, rebounds 0.0000, assists 0.0000, three-point attempts -0.0024 (negative = better).",
  "note": "...", "rules": { "partCap": {...}, "totalCap": {...}, "winsor": {...}, "noise": {...}, "priorDefault": 0.5, "prior": {...}, "warmupGames": 500, "gateMinGames": 1000, "gate": "..." },
  "zoneStateGames": { "recorded": 1599, "missing": 0 },
  "rows": [ { "id": "vol3", "label": "Three-point volume allowed", "stat": "tpa", "unit": "three-point attempts on paper", "what": "His three-point attempts x how many more or fewer threes than league average this opponent allows.",
              "games": 29974, "coef": 0.633, "gate": 1, "applied": 0.633, "avgAbsX": 0.128, "avgAbsEffect": 0.056, "errWithout": 1.558, "errWith": 1.555, "reduction": 0.0026, "t": 4.1, "verdict": "helps" } ],
  "total": { "tpa": { "games": 31864, "errWithout": 1.503, "errWith": 1.5, "reduction": 0.0024, "phases": { "2026-2": { "games": 26537, "errWithout": 1.509, "errWith": 1.506 } } } } }
```

One row per factor and stat (19 rows for 13 factors):

| Field | Meaning |
|---|---|
| `id`, `label`, `what`, `unit` | the factor, in plain words |
| `stat` | `pts`, `reb`, `ast`, `tpa` or `min` |
| `games` | player-games in which the factor had a value |
| `coef` | learned coefficient (ridge regression of the leftover error on the factor's x) |
| `gate` | 0-1, how much of the coefficient is used; `applied` = `gate x coef` |
| `avgAbsX`, `avgAbsEffect` | typical size of x and of the applied effect, in the stat's units |
| `errWithout`, `errWith` | walk-forward mean absolute error of the unscaled projection, without and with the applied effect, over those games |
| `reduction` | `errWithout - errWith`. Positive = the factor made projections better |
| `t` | t-statistic of the squared-error benefit of the full coefficient on games it had not seen. **CHANGED thresholds:** 19 effects are tested at once, so the gate opens at t = 2 and is fully open at 3.5; once open it closes again only below 1.5 (`rules.gateT0`, `gateT1`, `gateClose`) |
| `verdict` | `helps` (gate fully open), `small` (open, t between the closing limit and 3.5), `no measurable effect yet` (held at zero), `made projections worse when tried; kept at zero`, `not enough games yet`, `switched off for this run` |

`total.<stat>` is the same comparison for all factors together, overall and per phase. `zoneStateGames.missing` counts games without play-by-play.

Show `verdict` and `reduction` as they are. Most factors currently read "no measurable effect yet": that is the honest result, not a bug.

## `takes.json`

Array of headlines from the last 14 days: `{ outlet, kind, title, url, date, summary, flags[], tone, teams[], athletes[], checks[] }`, `checks[]` = `{ id, n, verdict, last5, season, vsModel }`.

---

## The 13 factors

| id | Label | Stats | x (known before tip-off) |
|---|---|---|---|
| `zone` | Zone edge | pts | his attempts by zone x opponent's allowed FG% minus league in each zone x 2 or 3 |
| `hot` | Hot spot vs soft spot | pts, reb | his own gap to league in a zone x the opponent's gap, summed over his attempts |
| `rim` | Rim-protector edge | pts, reb | his rim attempts x 2 x (FG% allowed inside 6 ft by the opponent's likely frontcourt defenders, minus what teams usually field) |
| `perim` | Perimeter-defender edge | pts, tpa | his three-point attempts x 3 x the same for threes, defenders at his position |
| `vol3` | Three-point volume allowed | tpa | his three-point attempts x (opponent's share of shots allowed from three / league - 1) |
| `glass` | Glass edge | reb | his defensive rebounds x (opponent misses and weak offensive rebounding) + his offensive rebounds x (offensive boards the opponent allows) |
| `ft` | Free-throw edge | pts | his free-throw attempts x his FT% x (opponent free throws allowed per shot / league - 1) |
| `press` | Ball-pressure edge | ast, pts | his turnovers x (opponent turnovers forced per possession / league - 1) |
| `size` | Size edge | reb, pts | his height minus the opponent's likely defenders at his position, inches, capped at 6 |
| `trans` | Transition edge | pts | his early-offence points x (opponent early-offence points allowed / league - 1) |
| `ptype` | Play-type edge | pts | his possessions per game by Synergy play type x opponent points allowed per possession on it minus league |
| `closer` | Closer edge | pts | how much closer than usual the game projects x his fourth-quarter scoring share versus league x projected points |
| `age` | Age-fatigue | min, pts | 1 at age 31 (+0.25 per year) on a back-to-back or third game in four nights, else 0 |

Leak rules used for x in the back-test: zone, team and player tendencies come from games played before the projected one; defender tracking from the NBA.com snapshot dated before the game (previous season's table until three weekly snapshots exist, and as the prior the snapshot is pulled toward); Synergy play types from the previous season (the current season is used for live projections only, once a row has 15 games).

## In-loop features (NEW, November 2026 round)

Built inside the walk-forward loop by `scripts/lib/flow.mjs` (on-court reconstruction from play-by-play substitutions) and `scripts/lib/inloop.mjs` (gated learner, return curves, quarter shares, trust meter). Every number comes from games played before the one being projected; preseason games are not counted. A feature moves a projection only when its gate opens on games it had not yet learned from (`learning.json > inloop`); otherwise it is evidence only. Examples are real values from the 11 November 2026 run. Notes that would repeat on every team are in `meta.json > flow.notes`.

### `upcoming.json`: `q`

```json
"q": [[30.1, 31, 30.9, 29.1], [24.3, 24.1, 24.9, 22.9]]
```

Projected points by regulation quarter, home first; each team's four quarters add up to its projected points (`pred.hs` / `pred.as`).

### `upcoming/<id>.json` > `teams[]`: `quarters`, `trust`, `onOffOut`

```json
"quarters": { "proj": [30.1, 31, 30.9, 29.1], "total": 121.1, "games": 109, "oppGames": 92, "shares": [25.2, 25.6, 24.9, 24.2], "allowedShares": [26, 25, 25.4, 23.6], "league": [25.5, 25.1, 25.4, 24.1],
  "identity": { "games": 9, "scope": "this season", "margin": [1.9, 2.8, 0.3, 0.7], "scored": [28.4, 28, 26.4, 27] } },
"trust": { "games": 15, "mae": 9.78, "typical": 9.46, "ratio": 1.03, "bias": -1.72, "label": "typical", "lean": "no clear lean", "allGames": 109, "allMae": 10.49 },
"onOffOut": { "x": -0.07, "applied": 0 }
```

- `quarters.proj`: projected total x the average of the team's own scoring shares (`shares`, %) and the opponent's allowed shares (`allowedShares`), recency weighted and shrunk to the league's shares (`league`). `games` / `oppGames`: team-games behind the shares. `identity`: average margin and points per quarter (this season; all games when it has fewer than 5).
- `trust` (same shape for players and teams): `mae` = mean absolute error of the published projection over the last `games` (up to 15); `typical` = typical error for similar projections at the time; `ratio` = `mae / typical`; `label` "reads well" (0.85 or less), "keeps missing" (1.2 or more), "typical", or "too few games" (`small: true`, under 8 games). `bias` = actual minus projection (positive = projected too low); `lean` names a bias of 2.5+ points (5+ for teams). `allGames` / `allMae`: every game counted.
- `onOffOut`: team points implied by the on/off records of tonight's absent players (own offence, opponent's defence); `applied` = what moved the projection (0 while the feature's gate is closed).

### `upcoming/<id>.json` > `players[]`: `ix`, `trust`

```json
"ix": {
  "effects": [ { "f": "blowMin", "label": "Blowout minutes", "stat": "min", "x": -0.96, "v": 0 }, { "f": "blowPts", "label": "Blowout scoring", "stat": "pts", "x": -0.67, "v": 0 } ],
  "blowout": { "winBy15": 0.509, "loseBy15": 0.008, "ifWinBig": { "min": -2.6, "pts": -1.3, "games": 30, "teamGames": 5 }, "ifLoseBig": { "min": 0.7, "pts": -2.3, "games": 7, "teamGames": 0 }, "small": false },
  "flow": { "usual36": 27, "games": 101, "ahead": { "min": 450.9, "games": 43, "mpg": 10.5, "ppm36": 25, "vsUsual36": -2, "small": false }, "behind": {}, "tight4th": {} },
  "returning": null,
  "absentMates": [ { "id": "3062679", "n": "Josh Hart", "per36": 6.3, "minWith": 2230, "minWithout": 766, "games": 85, "weight": 0.75, "pts": 5.1 } ],
  "absentOpps": []
}
```

- `effects[]`: each in-loop feature's pre-game value `x` (minutes or points) and `v`, the effect actually added to the unscaled projection (0 while evidence only). Parts with `|x|` under 0.05 and no effect are left out.
- `blowout`: tonight's chances of a 15+ win / loss (`winBy15`, `loseBy15`, 0-1) and his estimated minutes and points against projection in such games: his own record over `games`, shrunk to his team's same-role players that season (`teamGames`), then to the league.
- `flow`: points per 36 on the floor when far ahead / far behind (15+) / in a tight 4th quarter (within 5) against his usual rate; `mpg` = his usual minutes in that script when it happens.
- `returning` (game 1-5 back after missing 3+ games in a row, else `null`), e.g. `{ "gameBack": 2, "missed": 5, "bucket": "3-5", "curveMin": 2.2, "curvePts": 0, "curveGames": 393, "injury": null, "beforeMin": 11, "beforePts": 3.5 }`: `curveMin` / `curvePts` = league-wide return curve for that absence length and game (`curveGames` behind it); `injury` = the current injury report's detail when it has one; `beforeMin` / `beforePts` = his averages in the 10 games before the absence.
- `absentMates[]` / `absentOpps[]`: for each absent teammate / opponent, his points per 36 with that player on the floor versus off it (`per36` = off minus on; games both played, 30+ minutes each way); `weight` = share of that team's last 8 games the absent player played; `pts` = the implied points tonight.

### `players/<id>.json`: on-court, game flow, blowouts, returns, trust, interactions

```json
"onOff": { "games": 101, "min": 3564, "netOn": 8.6, "netOff": 7.7, "swing": 0.8, "ortgOn": 118.8, "ortgOff": 109.7, "drtgOn": 110.2, "drtgOff": 102, "small": false },
"pairs": { "best": [ { "id": "4277869", "n": "Jose Alvarado", "games": 45, "min": 133, "net48": 18, "current": true } ], "worst": [], "count": 21, "note": "..." },
"scoringWithMates": [ { "id": "3136195", "n": "Karl-Anthony Towns", "games": 95, "with36": 23.9, "without36": 32.5, "minWith": 2068, "minWithout": 1292, "diff": 8.6 } ],
"scoringVsOpponents": [ { "id": "4845367", "n": "Stephon Castle", "team": "24", "games": 8, "with36": 24, "without36": 36.1, "minWith": 193, "minWithout": 112, "diff": -12.1 } ],
"rimDefense": { "attOn": 1550, "madeOn": 1009, "fgOn": 65.1, "attOff": 909, "madeOff": 578, "fgOff": 63.6, "att36On": 17.7, "att36Off": 18.5, "note": "..." },
"gameFlow": { "usual36": 27, "games": 101, "ahead": { "min": 451, "games": 43, "mpg": 10.5, "per36": 25, "small": false }, "behind": {}, "tight4th": {}, "normal": {}, "note": "..." },
"blowout": { "win": { "games": 30, "minVsProj": -2.5, "ptsVsProj": -1.4 }, "loss": { "games": 7, "minVsProj": 2, "ptsVsProj": -2.3 }, "fourthQuarter": { "lopsided": { "games": 24, "q4min": 1.7, "min": 31.1 }, "other": { "games": 77, "q4min": 7.3, "min": 36.6 } }, "note": "..." },
"closing": { "closeGames": 33, "onFloor": 33, "share": 100, "note": "..." },
"returns": { "games": 5, "recent": [ { "d": "2025-11-23", "k": 5, "missed": 9, "min": 20, "pts": 9, "preMin": 25, "prePts": 7.5 } ], "note": "..." },
"trust": { "games": 15, "mae": 6.76, "typical": 6.49, "ratio": 1.04, "bias": 2.18, "label": "typical", "lean": "no clear lean", "allGames": 101, "allMae": 6.6 }
```

(`rimDefense` example is Karl-Anthony Towns, `returns` Dominick Barlow, the rest Jalen Brunson.) Each block is `null` or missing when there is not enough data.

- `onOff` (60+ minutes; `small` under 300): team offensive / defensive points per 100 possessions with him on the floor and off it (off = the rest of the games he played); `swing` = `netOn - netOff`.
- `pairs`: team points minus opponent points per 48 minutes with both on the floor (100+ minutes together, this season and last); `current` = still his teammate.
- `scoringWithMates[]`: his points per 36 with a teammate on the floor versus off it (games both played, 100+ minutes each way); `diff` = without minus with.
- `scoringVsOpponents[]`: his points per 36 with an opposing player on the floor versus off it (60+ minutes each way); `diff` = with minus without. Show `games` and minutes: these are small samples.
- `rimDefense` (forwards and centres with 150+ opponent rim attempts while on): opponent restricted-area FG% and attempts per 36 with him on versus off.
- `gameFlow`: points per 36 on the floor by score: `ahead` / `behind` = his team leading / trailing by 15+, `tight4th` = 4th quarter or overtime within 5, `normal` = the rest; `small` under 60 minutes.
- `blowout`: his minutes and points against projection in games won / lost by 15+ (coach's-decision DNPs count as 0 minutes), and 4th-quarter / total minutes in games decided by 18+ versus the rest.
- `closing`: games his team played within 5 with 2:00 left in the 4th, and how often he was on the floor then.
- `returns`: games 1-5 after missing 3+ in a row (`k` = game back), against his 10 games before the absence.
- `splits.overall` `{ n, pts, tpa }` = his overall gap against projection (the reference for every relative split); `splits.rule` = the minimums; `splits.note` says the counts include last season (with its play-in and playoffs), this season and preseason. Row: `{ "key": "vs:4592479", "label": "when Julian Champagnie plays", "n": 7, "small": true, "pts": 5, "tpa": 0.8, "raw": { "pts": 6.5, "tpa": 1 } }`; `small` = under 10 games. `upcoming > players[].adj.matchups[]` rows carry the same relative `pts` / `tpa` and `small`.

```json
"interactions": {
  "playerToTeam": { "onOff": { "swing": 0.8, "min": 3564, "small": false }, "absence": { "netSwing": 5.3, "with": 101, "without": 8, "small": true }, "note": "..." },
  "teamToPlayer": { "games": 101, "ptsPer10TeamPts": 0.9, "r": 0.15, "small": false, "note": "..." },
  "teammates": { "onCourtPairs": { "best": [], "worst": [] }, "scoring": [], "ripple": [], "absence": [], "note": "..." },
  "opposingPlayers": { "onCourt": [], "splits": [], "note": "..." },
  "opposingTeams": [ { "key": "opp:2", "label": "vs BOS", "n": 6, "small": true, "pts": -3.1 } ]
}
```

Two-way effects, each with its sample: player -> team (on/off swing; team net rating with / without him from `absence`), team -> player (how his points against projection move per 10 team points above the team's own projection; 12+ games, `small` under 30), player <-> teammates (on-court pairs, his scoring with each teammate on / off, `ripple`, `absence.teammates`), player <-> opposing player (on-court with / without, `splits.players`), player <-> opposing team (relative `opp` split rows). Rows reuse the shapes above.

### `teams.json`: `rotation`, `quarterIdentity`, `trust`, `onOff`, `interactions`

```json
"rotation": { "current": { "season": 2027, "games": 9, "firstSubMin": 5, "subsPerGame": 35.3, "starterFirstStint": 7.3,
    "playersUsed": { "all": 11.3, "close": 10.3, "lopsided": 14, "closeGames": 4, "lopsidedGames": 1 }, "starterQ4Min": { "lopsided": 0, "other": 37.3 },
    "closers": [ { "id": "3136195", "n": "Karl-Anthony Towns", "games": 4, "share": 100 } ], "closeGames": 4,
    "blowout": { "starters": { "win": { "games": 5, "minVsProj": -7.4, "ptsVsProj": -2.3 }, "loss": null }, "bench": { "win": { "games": 9, "minVsProj": 3.9, "ptsVsProj": 2 }, "loss": null } } },
  "previous": {} },
"quarterIdentity": { "games": 9, "scope": "this season", "margin": [1.9, 2.8, 0.3, 0.7], "scored": [28.4, 28, 26.4, 27] },
"trust": { "games": 15, "mae": 9.78, "typical": 9.46, "ratio": 1.03, "bias": -1.72, "label": "typical", "lean": "no clear lean", "allGames": 109, "allMae": 10.49 },
"onOff": { "top": [ { "id": "4431823", "n": "Miles McBride", "min": 1533, "netOn": 11.4, "netOff": 4.6, "swing": 6.8 } ], "bottom": [] },
"interactions": { "playersToTeam": [ { "id": "5211983", "n": "Pacome Dadiet", "netSwing": 7.1, "with": 37, "without": 72, "small": false } ],
  "teamToPlayers": [ { "id": "5289900", "n": "Mohamed Diawara", "games": 77, "ptsPer10TeamPts": 1.1, "r": 0.38 } ],
  "vsTeams": [ { "t": "8", "n": 4, "margin": -15.4, "small": true } ] }
```

`rotation` is the coach's habit by team-season (`current` = 2026-27, `previous` = 2025-26; coach changes inside a season are not known): first substitution and a starter's first stint in minutes, players used in close (final margin 8 or less) and lopsided (18+) games, the starters' combined 4th-quarter minutes, closers (on the floor at 2:00 of a 4th quarter within 5; `share` of `closeGames`), and starters' / bench minutes and points against projection in 15+ wins and losses. `onOff`: current roster, 300+ minutes. `interactions.playersToTeam` ranks the team's players by `absence.netSwing` (team net rating with versus without; `small` under 10 games without); `teamToPlayers` 20+ games; `vsTeams` 3+ meetings (`small` under 5). Field notes: `meta.json > flow.notes`.

### `learning.json`: `inloop`

```json
"inloop": {
  "note": "...", "rule": { "warmup": 400, "minN": 800, "t0": 2, "t1": 3.5, "hyst": 0.5 },
  "players": { "rows": [ { "id": "blowPts", "label": "Blowout scoring", "stat": "pts", "games": 31810, "withValue": 31810, "coef": -0.161, "gate": 0, "applied": 0, "avgAbsX": 0.34, "avgAbsEffect": 0,
      "errWithout": 4.485, "errWith": 4.485, "reduction": 0, "oosGainIfFull": -0.0004, "t": -0.1, "verdict": "evidence only: no measurable out-of-sample gain", "phases": {} } ],
    "total": { "pts": { "games": 31810, "errWithout": 4.485, "errWith": 4.485, "reduction": 0 } } },
  "team": { "rows": [ { "id": "teamOnOff", "stat": "tpts" } ], "total": {} },
  "returnCurves": { "note": "...", "rows": [ { "bucket": "3-5", "label": "missed 3-5 games", "games": [ { "k": 1, "n": 677, "minVsProj": 2.64, "ptsVsProj": 0.63, "minPctOfBefore": 88.8, "ptsPctOfBefore": 91.6, "small": false } ] } ] },
  "quarters": { "games": 1400, "teamQuarters": 11200, "maeModel": 4.767, "maeEvenSplit": 4.798, "maeLeagueShares": 4.772, "byQuarter": [ { "q": 1, "model": 4.676, "even": 4.663, "league": 4.668 } ], "note": "..." },
  "splits": { "rule": {}, "note": "...", "projection": "full gap in the situation, new minimums", "ablation": "..." },
  "flow": { "recorded": 1468, "missing": 0, "partial": 21, "rule": { "far": 15, "tight": 5 }, "note": "..." }
}
```

- `players.rows[]` / `team.rows[]`: one row per feature: average `|x|`, the learned `coef` and `gate` (0-1), `errWithout` / `errWith` (mean absolute error of the unscaled projection with the applied effect removed / included), `oosGainIfFull` (average squared-error reduction had the full coefficient been applied on games it had not yet seen; positive = helps), `t`, a plain `verdict`, and the same by phase (`errIfFull`). `stat: "min"` rows are measured on the published (240-scaled) minutes; `tpts` = team points. Coach's-decision DNPs count as 0 minutes in the minutes features.
- Features: `blowMin`, `blowPts` (blowout minutes / scoring), `flowPts` (game-flow scoring), `retMin`, `retPts` (return from absence), `mateOut`, `oppOut` (on-court effect of an absent teammate / opponent), `teamOnOff` (team points from the on/off records of absent players), `defReal`, `defPair` (real defenders from matchup tracking, see "Who guarded whom"). On 11 November 2026 none moves a projection: `blowMin` and `retMin` pass their own gate but are held because the end-to-end walk-forward was slightly worse with them (the verdict gives the numbers); the others show no out-of-sample gain.
- `returnCurves`: league-wide curve by absence length and game back (`minPctOfBefore` / `ptsPctOfBefore` = actual as a share of the 10 games before). Injury type is not point-in-time for past games, so the curves are by length only.
- `quarters`: back-test of the quarter split (regulation games). The split is display only and changes no total.
- `splits.ablation`: the walk-forward comparison behind the split rule.

### Who guarded whom (NEW): `dm`, `guardedBy`, `guards`, `inloop.defMatch`

Built by `scripts/lib/defmatch.mjs` from NBA.com matchup tracking (`data/matchups/<espnId>.json`, docs/DATA-RAW.md section 4). A finished game is queued after its own projection and folded into the state only when the model is about to project a game that tipped off strictly later (`flush(g.date)`), so a past projection never sees its own game or one at the same tip-off time. Preseason games are left out. "poss" = NBA.com partial possessions (a scorer's possession is split between the defenders who guarded him); "per100" = points per 100 partial possessions. Unmatched NBA.com players (`nba:<id>`, 2 players) are skipped. Expected points on a possession = the scorer's own points per partial possession before that game (shrunk with 25 possessions of league rate, about 24 per 100). "Similar scorers" = same position group and the same scoring tier (tracked points a game: 18+ high-volume, 9-18 mid-volume, under 9 low-volume).

**Projection status: evidence only.** Two gated in-loop features (`learning.json > inloop.players.rows`, ids `defReal`, `defPair`) test it game by game. Neither gate opened on 11 November 2026 (`defReal` t 1.5, needs 2; `defPair` t -0.2), so the published projections are identical to the run without them and the position-based defender adjustment ("likely defender at his position", `adj.defense`) is still the method the projection uses. The tables below are shown as information.

`upcoming/<id>.json` > `players[].dm` (players projected 8+ minutes, else `null`):

```json
"dm": { "src": "previous meetings + matchup records", "scorerType": "G|high-volume", "coverage": 100, "meetings": 19, "realPct": 10.4, "pairPct": 9.8, "positionPct": 1.1, "basePts": 29.2,
  "defenders": [ { "id": "4591725", "n": "Ryan Rollins", "pos": "G", "share": 25.4, "fromMeetings": true, "meetingShare": 35.6, "vsExpPct": -17.3, "defPoss": 5120, "vsTypePoss": 970,
      "h2h": { "games": 3, "met": 3, "poss": 74, "pts": 28, "per100": 37.9, "exp100": 38.3, "fgm": 10, "fga": 14, "fgPct": 71.4, "small": false }, "excessPct": 4.5 } ],
  "effect": { "defReal": { "x": -3.25, "v": 0 }, "defPair": { "x": 2.85, "v": 0 } } }
```

- `defenders[]` (up to 4 with a 5%+ expected share): `share` = expected % of his partial possessions guarded by that defender tonight: the defender's usual split of possessions by scorer position (shrunk to the league's split for his position, `inloop.defMatch.groupMatrix`) times his usual minutes, blended with `meetingShare` (the share seen in earlier games where both played on opposite sides) with 2 games of weight, then renormalised over tonight's available defenders. `fromMeetings` = they have met.
- `vsExpPct`: that defender's points allowed against what the same scorers usually score, versus similar scorers (shrunk: 80 possessions toward his overall record, 120 toward 0); negative = held them below their usual rate. `null` under 30 possessions. `defPoss` / `vsTypePoss`: possessions behind his overall and similar-scorer records.
- `h2h`: this scorer against this defender in earlier games: `games` with at least one tracked possession, `met` = games on opposite sides, `poss`, `pts`, `per100`, `exp100` (his own rate on those possessions), FG. `small` = under 50 possessions or under 3 games. `excessPct`: his gap against that defender beyond the defender's general record (shrunk with 40 possessions).
- `coverage` = % of his expected possessions guarded by defenders with a record; `meetings` = sum of earlier games with tonight's defenders; `src` = "previous meetings + matchup records", "matchup records" or "position only". `realPct` = share-weighted `vsExpPct`; `pairPct` = share-weighted `excessPct`; `positionPct` = the old position-based adjustment (% of his points); `basePts` = his points before matchup effects (rate x minutes x pace).
- `effect.defReal.x` = `basePts` x (`realPct` minus the same for a minutes-weighted average possession against that team), in points; `effect.defPair.x` = `basePts` x `pairPct`. `v` = what moved the projection (0 while evidence only).

`players/<id>.json` > `guardedBy` (him on offence) and `guards` (him on defence), this season and last, preseason left out:

```json
"guardedBy": { "poss": 7177, "games": 103, "per100": 37.6, "fgm": 965, "fga": 2069, "fgPct": 46.6,
  "rows": [ { "id": "5124612", "n": "VJ Edgecombe", "team": "20", "games": 10, "met": 10, "share": 40.2, "poss": 271, "pts": 79, "per100": 29.1, "exp100": 37.9, "vsExp100": -8.8,
              "fgm": 27, "fga": 61, "fgPct": 44.3, "tpm": 7, "tpa": 14, "min": 60.1, "last": "2026-10-30", "small": false } ] },
"guards": { "games": 103, "poss": 6920, "pts": 1535, "per100": 22.2, "exp100": 22.6, "vsExp100": -0.4, "fgm": 544, "fga": 1147, "fgPct": 47.4, "tpm": 227, "tpa": 625, "min": 1309.9,
  "shrunkVsExpPct": -1.9, "small": false, "groupShare": { "G": 63, "F": 32.1, "C": 4.9 },
  "byType": [ { "type": "G|mid-volume", "label": "mid-volume guards", "poss": 2328, "pts": 478, "per100": 20.5, "exp100": 22.7, "vsExp100": -2.1, "fgm": 174, "fga": 368, "fgPct": 47.3, "small": false } ],
  "rows": [ { "id": "4592479", "n": "Julian Champagnie", "team": "24", "games": 8, "poss": 183, "pts": 26, "per100": 14.2, "exp100": 19.7, "vsExp100": -5.4, "fgm": 8, "fga": 23, "fgPct": 34.8, "small": false } ] }
```

(Jalen Brunson.) `guardedBy.rows[]`: the 8 defenders who guarded him most (by possessions); `share` = % of his tracked possessions in the games they met; `team` = the defender's latest team; `min` = matchup minutes; `last` = last meeting (US date). `guards`: his totals as a defender, `exp100` = what the scorers he guarded usually score per 100 on those possessions, `vsExp100` = allowed minus expected per 100 (negative = below their usual), `shrunkVsExpPct` = the shrunk overall record the model reads, `small` under 300 possessions; `groupShare` = % of his possessions on guards / forwards / centres; `byType[]` = his record against each kind of scorer (20+ possessions, `small` under 150); `rows[]` = the 8 scorers he guarded most. All rows: `small` = under 50 possessions or under 3 games. The numbers are tracking data from NBA.com, a measure of results on the floor, not a judgment of any player.

`learning.json > inloop.defMatch`: `{ games, rows, missing, skippedPre, leagueRate100, scorers, defenders, pairs, groupMatrix, pending, rule, features, mode, ablation, note }`. On 11 November 2026: 1,474 games and 285,788 rows folded in (131 preseason games skipped, 2 empty files); `groupMatrix` e.g. guards spend 62.4% of their defensive possessions on guards, 31% on forwards, 6.6% on centres. `ablation`: `defReal` t by version: centred (published) 1.5, minus the position adjustment ("replace") 0.6, no centring 0.6, share deviations only -0.4, 3x / 8x shrinkage 1.2 / 0.8; `defPair` -0.2, -0.8, -1.5. Switches: `CL_DM_MODE=centred|replace|pure|shares`, `CL_DM_K=defK,typeK,pairK`, `CL_IX_SKIP=defReal,defPair`.

### `meta.json`: `flow`

`{ rule, trustRule, notes: { rotation, onOff, teamInteractions, quarterIdentity, trust, onOffOut } }`: thresholds and the field notes for the blocks above.

### `data/history/projections-<YYYY-MM-DD-HHmm>.json` (outside `public/`)

One small file (about 55 KB) per model run, named by the run's Philippine date and time; the newest 120 are kept. For a later "what changed today" view that diffs two runs.

```json
{ "format": 1, "run": "2026-11-11T00:34:27.002Z", "runManila": "2026-11-11 08:34",
  "games": [ { "id": "401909960", "date": "2026-11-11T00:30Z", "home": "18", "away": "15", "hs": 121.1, "as": 96.2, "pHome": 0.968,
               "out": [["3062679"], ["4395725"]], "q": [[], []],
               "players": [[["3934672", "Jalen Brunson", 38.4, 31, 4.1, 7.5]], [["5082206", "Brayden Burries", 28.5, 14.1, 7.2, 3.4]]] } ] }
```

`out` = injury-list absentees (player ids, home first); `q` = questionable players in the projection; `players` = up to 10 per team with 8+ projected minutes: `[id, name, min, pts, reb, ast]`.

## Analysis views (NEW): `insights.json` and `compare/`

Written by `node scripts/insights.mjs`, which runs AFTER `model.mjs` (about 2 seconds) and reads only the model's output in `public/data`, the snapshots in `data/history` and `data/pregame.json` (NBA.com starters). **Display only:** nothing here feeds a projection, the learning or the scenario library, and no betting odds are read. Code: `scripts/insights.mjs` and `scripts/lib/insight*.mjs`. `CL_OUT=<folder>` reads and writes that folder; `CL_HISTORY_DIR=<folder>` reads snapshots from another folder (used to test the diff). Times in text are Philippine time; raw `date` fields stay ISO UTC.

Sample labels used throughout: `small` under 10, `moderate` 10-29, `solid` 30+.

### `insights.json`

Top level: `{ format: 1, updated, updatedManila, modelRun, note, games[], similar, disagreement, breakout, changes, trust, compare }` (about 350 KB).

`games[]` (index for the list view, soonest first): `{ id, date, when (Philippine time text), home, away, margin, pHome, spread, splitWinner, similarFavWon: [won, n], breakout: [playerIds] }`.

#### `similar`: historical game similarity finder

```json
"similar": { "note": "...", "k": 10, "shown": 6, "candidates": 1467, "weights": { "margin": 2, "total": 0.6, "pace": 0.6, "rest": 0.25, "b2b": 0.5, "missing": 0.8, "style": 0.8, "phase": 0.6, "sameHome": 0.35, "sameAway": 0.2 },
  "selfTest": { "games": 1166, "k": 10, "warmup": 300, "corrResidual": 0.083, "marginMAE": { "projection": 11.73, "plusNeighbourGap": 12.12, "plusHalfGap": 11.79 },
                "favouritesWhenNeighboursAgree": { "games": 396, "won": 0.76, "said": 0.751 }, "favouritesWhenNeighboursSplit": { "games": 269, "won": 0.558, "said": 0.585 }, "verdict": "...", "note": "..." },
  "games": { "401909960": {
    "tonight": { "margin": 24.9, "total": 217.3, "pace": 99.2, "rest": [2, 1], "b2b": [0, 0], "missingPpg": [10.7, 19.6], "missingStars": [[], ["Tyler Herro"]] },
    "summary": { "n": 10, "sample": "moderate", "favWon": 9, "favSaid": 0.95, "favRes": 0.8, "homeRes": 0.8, "marginMAE": 11.7, "totalVsProj": 5.6, "close": 2, "blowouts": 7, "overtime": 0, "t": "In the 10 most similar past games the projected favourite won 9 ..." },
    "games": [ { "id": "401810763", "date": "2026-03-07T00:00Z", "day": "Mar 7, 2026", "phase": "2025-26 Regular Season", "home": "2", "away": "6", "sim": 44,
                 "proj": { "hs": 121.1, "as": 100.9, "pHome": 0.938 }, "act": { "hs": 120, "as": 100, "ot": 0 }, "called": true, "marginErr": 0.2,
                 "missing": [[], []], "why": ["projected margin BOS by 20.2 (tonight NY by 24.9)", "similar projected pace (99.1)", "road side missing 25 points a game (tonight 20)", "shared style tags: Slow-paced, Crashes offensive glass, Elite defense"] } ] } } }
```

- Candidates: every finished regular-season, play-in and playoff game since October 2025 (no preseason). Each past game is described by what was known before its tip-off: the walk-forward projection (margin = strength gap including home court, total), projected pace, rest (capped at 3) and back-to-backs, team style tags, arena. **Missing players** of a past game = players on its stored out list whose box score confirms they did not play (the stored list is not point-in-time); tonight's come from the current injury report (`teams[].out`). `missingStars` = missing players at 15+ points a game.
- Distance: weighted squared gaps (margin, total, pace, missing points scaled by their spread across past games), plus rest, back-to-back and style-tag (Jaccard) gaps, a penalty when one game is playoffs and the other is not, and a small bonus for the same home / road team. `sim` = 0-100 display score (`100 x e^(-distance/4)`); compare within a game only.
- `games[]` = the 6 closest (link each to `#/result/<id>`); `summary` = the 10 closest. `favRes` = how much better (+) or worse (-) the projected favourites did than projected, in points; `homeRes` the same for the home side; `totalVsProj` = actual minus projected combined score; `close` within 5, `blowouts` 15+.
- `selfTest`: leak-free check of the finder (each past game matched only against earlier games). On 11 November 2026 the neighbours' average miss correlated 0.08 with the real miss and adding it would have made the margin error worse (11.73 to 12.12), so it is **not** used in any projection. Show `verdict` with the similar games.

#### `disagreement`: the five rating systems, the blend and the simulation

```json
"disagreement": { "note": "...", "sim": { "files": 0, "unrecognised": 0, "note": "No simulation output yet (public/data/sim is missing)." },
  "history": { "rule": "...",
    "systems": [ { "k": "players", "label": "Player build-up", "games": 1467, "marginMAE": 11.92, "outlierGames": 792, "sideRight": 472, "sideRightPct": 0.596, "avgGap": 8 } ],
    "bands": [ { "label": "all five within 4 points", "games": 255, "sample": "solid", "winnerAcc": 0.686, "marginMAE": 12 },
               { "label": "spread 4+ points, same winner", "games": 699, "winnerAcc": 0.764, "marginMAE": 11.1 },
               { "label": "systems pick different winners", "games": 513, "winnerAcc": 0.548, "marginMAE": 11.8 } ] },
  "games": { "401909960": {
    "blend": { "margin": 24.9, "pHome": 0.968, "partsSum": 25, "otherAdj": -0.1 },
    "systems": [ { "k": "players", "label": "Player build-up", "margin": 17.5, "weight": 0.41, "part": 7.2, "thisSeason": { "winnerAcc": 0.688, "marginMAE": 12 }, "outlierRecord": { "games": 792, "sideRight": 472 } } ],
    "sim": null, "spread": 4.9, "splitWinner": false, "outlier": { "k": "luckAdjusted", "label": "Luck-adjusted", "gap": -2.9 },
    "biggest": { "hi": "players", "lo": "luckAdjusted", "reason": { "kind": "availability", "t": "The player build-up counts who is actually available tonight (NY without Josh Hart (10.7 a game); MIL without Tyler Herro (19.6 a game)), ..." } },
    "t": "All systems pick NY. Spread 4.9 points: Player build-up +17.5 vs Luck-adjusted +12.6 (home NY minus road MIL)." } } }
```

- Margins are home minus road. The published margin is NOT an average: the back-test stacks the five with weights that add up to about 1.6 (each alone is too cautious). `part` = margin x weight; `partsSum` = their sum; `otherAdj` = published margin minus `partsSum` (home court, referees, situations).
- `spread` = highest minus lowest system; `splitWinner` = systems pick different winners. `outlier` = the system furthest from the median of all five (`gap` in points).
- `biggest.reason.kind`: `availability` (the player build-up sees tonight's absences; the others rate team results), `memory` (Elo carries last season and moves slowly), `threeLuck` (three-point luck removed; `teams.json > ratings.threeLuck`), `recentForm` (recent efficiency vs opponent-adjusted), `other`. `t` is the sentence with its numbers. **CHANGED (11 November):** the `availability` sentence without major absences quotes `sumTeamPts` and the Player build-up margin (it used to quote `sumPlayers`, which includes personal splits and could point the other way).
- `history` (finished games, preseason excluded): per system its margin error, how often it was an outlier (4+ points from the median of the other four) and in how many of those games the real margin fell on its side of that median (`sideRight`). `bands`: winner accuracy and margin error of the published projection when the systems agree, spread out, or pick different winners. `thisSeason` per system = `learning.json > models` for 2026-27.
- `sim`: `null` while `public/data/sim/` does not exist. When the simulation writes `sim/<id>.json`, this view reads `margin.mean` (or `summary.margin.mean`, `weighted.margin.mean`, ...) and `pHome` (or `win.home`, ...) into `{ present, recognised, margin, pHome, sims }`; an unknown format gives `{ present: true, recognised: false }` (shown as present, no numbers). No odds are read here.

#### `breakout`: players whose minutes or role should jump

```json
"breakout": { "note": "...",
  "evidence": {
    "minutes": { "rule": "...", "buckets": [ { "k": "control", "label": "projected within 2 minutes of his recent average", "games": 13787, "hitRate": 0.401, "avgProjJump": -0.1, "avgActualJump": -0.3 },
                                              { "k": "6-10", "label": "projected 6-10 minutes above", "games": 1136, "sample": "solid", "hitRate": 0.669, "avgProjJump": 7.5, "avgActualJump": 5.8 } ] },
    "hotStreak": { "rule": "...", "games": 530, "nextVsStreak": -5, "nextVsLonger": 1.5, "nextVsProjection": -0.9, "matchedStreak": 0.24, "projectionMAE": 5.93, "t": "..." } },
  "opportunity": [ { "gid": "401909963", "date": "2026-11-11T02:00Z", "team": "26", "opp": "14", "id": "4683766", "n": "Isaiah Collier", "pos": "G",
      "proj": { "min": 22.3, "pts": 11.2, "reb": 3.7, "ast": 5.7 }, "recent": { "games": 5, "min": 12.8, "pts": 5, "starts": 0 }, "minJump": 9.5, "ptsJump": 6.2,
      "reasons": [ { "k": "teammateOut", "id": "4066336", "t": "Lauri Markkanen is out: in 27 games without him he played 25.7 minutes and scored 13.5 (with him: 23.3 and 9.2 in 42).", "n": 27, "small": false },
                   { "k": "newStarter", "t": "NBA.com lists him as an expected starter; he started 0 of his last 5 games.", "n": 5 } ],
      "hot": { "hot": false, "lastPts": 5, "longPts": 12.7, "longGames": 20 }, "backtest": { "bucket": "6-10", "games": 1136, "hitRate": 0.669 }, "kind": "opportunity", "score": 12.6 } ],
  "matchup": [ ], "hotStreaks": [ ] }
```

- Each player appears once, at his next game; only players projected 12+ minutes with 3+ games played. `recent` = his last 5 games played (from the box scores); `starts` = how many of them he started. `minJump` / `ptsJump` = projection minus recent average.
- `opportunity`: `minJump` 4+, or 2+ with a role reason. `reasons[].k`: `teammateOut` (an absent teammate with 18+ minutes a game; with his counted with/without minutes and points when 3+ games each way, else "same position group"), `newStarter` (NBA.com confirmed / expected starter who started at most 1 of his last 5), `minutesReturning` (back from an absence with pre-absence minutes 3+ above his recent level; league return curve quoted), `rotation` (more minutes, no single absence explains it), `matchup` (also listed when present).
- `matchup` **CHANGED (11 November)**: no minutes jump, but a matchup part of the projection of 1+ points: a "hot spot meets soft spot" zone matchup counts only when the model applies 0.5+ points of it (`zm.applied`; a zone edge shown only "on paper" is not listed), plus relative personal splits of 2+ points (`adj.split`, rows not `small`). Also needs `ptsJump` 0+ and a projection at or above his longer average (`hot.longPts`, the 20 games before the last 5) when known. **NEW** `matchupPts` = that matchup part (zone applied + splits), and `score` (the ranking) is now `matchupPts`, not `ptsJump` (which can be just a bounce-back from a cold last 5). `matchupPts` is `null` on rows without a matchup edge.
- `hotStreaks`: last 5 games' points 5+ above his previous 20 with the same minutes (within 3) and no role reason. Shown apart because `evidence.hotStreak` says such runs mostly fade (next game 5 points below the streak, 1.5 above the longer average).
- `backtest` on each row = the hit rate of his jump bucket in the walk-forward (`evidence.minutes`): share of player-games where a projected jump of that size really came with 3+ extra minutes. Back-test projections are the tip-off track (they knew the inactive list and starters); tonight's are made earlier.

#### `changes`: what changed

```json
"changes": { "snapshots": 3, "note": "...", "latest": { "file": "projections-2026-11-11-0834.json", "run": "2026-11-11T00:34:27.002Z", "manila": "2026-11-11 08:34", "games": 52 },
  "sinceLast": { "from": { "run": "...", "manila": "2026-11-11 08:00" }, "to": { "run": "...", "manila": "2026-11-11 08:34" },
    "lines": ["1 new player listed out: Josh Hart (NY).", "Biggest move: MIL at NY, margin 21.9 to 24.9 (home minus road), home win chance 93% to 97%."],
    "injuries": [ { "gid": "401909960", "team": "18", "id": "3062679", "n": "Josh Hart", "detail": "Out: Hart (illness) won't play Tuesday ..." } ],
    "returns": [ { "gid": "401909960", "team": "15", "id": "4591725", "n": "Ryan Rollins" } ],
    "roles": [ { "gid": "401909960", "team": "18", "id": "3147657", "n": "Mikal Bridges", "min": [23.3, 29.3], "t": "Mikal Bridges: 23.3 to 29.3 projected minutes." } ],
    "gameMoves": [ { "gid": "401909960", "home": "18", "away": "15", "pHome": [0.93, 0.968], "margin": [21.9, 24.9], "total": [214.3, 217.3], "dMargin": 3, "dTotal": 3, "dP": 0.038 } ],
    "playerMoves": [ { "gid": "401909960", "team": "18", "id": "3147657", "n": "Mikal Bridges", "pts": [6.3, 9.3], "d": 3, "min": [23.3, 29.3] } ],
    "added": [ { "id": "...", "home": "22", "away": "25", "date": "..." } ], "removed": [ ], "thresholds": { "roleMinutes": 4, "playerPoints": 2, "gameMargin": 1, "winChance": 0.03 } },
  "sinceYesterday": null, "sinceYesterdayNote": "..." }
```

(The `sinceLast` example comes from a test diff; on 11 November 2026 only one snapshot existed.)

- `sinceLast` = newest snapshot against the one before it; `sinceYesterday` = newest against the last run of the previous Philippine day (`null` with `sinceYesterdayNote` when that is the same run or none exists).
- **No previous snapshot:** `sinceLast` and `sinceYesterday` are `null` and `message` says why (no snapshot at all, or only one). Show `message`.
- `injuries` / `returns`: players added to / removed from a game's out list (with the injury report text when the current report has it). `roles`: projected minutes changed by 4+, or a 15+ minute player entering or leaving the projected rotation (snapshots keep up to 10 players a team with 8+ minutes, so leaving can mean dropping under 8). `gameMoves`: margin moved 1+ point or win chance 3+ points (largest first). `removed` = games no longer on the board (played or postponed).

#### `trust`: trust meter summary

```json
"trust": { "note": "...",
  "players": { "labelled": 461, "counts": { "reads well": 138, "typical": 241, "keeps missing": 82 },
               "keepsMissing": [ { "id": "4277843", "n": "Gary Trent Jr.", "team": "15", "games": 15, "mae": 7.36, "typical": 4.36, "ratio": 1.69, "bias": 0.61, "lean": "no clear lean" } ],
               "readsWell": [ ], "projectedTooLow": [ ], "projectedTooHigh": [ ] },
  "teams": { "counts": { "typical": 13, "keeps missing": 10, "reads well": 7 }, "rows": [ { "id": "16", "abbr": "MIN", "label": "reads well", "games": 15, "mae": 6.14, "typical": 9.47, "ratio": 0.65, "bias": 1.23, "lean": "no clear lean" } ] },
  "tonight": { "401909960": { "teams": [ { "tid": "18", "label": "typical", "mae": 9.78, "bias": -1.72, "games": 15 }, { } ],
                              "players": [ { "id": "3914044", "n": "Landry Shamet", "team": "18", "label": "keeps missing", "ratio": 1.36, "bias": 1.22, "games": 15 } ] } },
  "persistence": { "players": [ { "label": "reads well", "games": 6339, "nextGameRatio": 0.94 }, { "label": "typical", "games": 12305, "nextGameRatio": 1.01 }, { "label": "keeps missing", "games": 3504, "nextGameRatio": 1.03 } ],
                   "teams": [ ], "rule": "...", "t": "Does the label last? ..." } }
```

- Built from the model's own `trust` blocks (players need 8+ games; `small` ones are not counted). Lists hold up to 12 (10 for the bias lists, `bias` 2.5+ points either way). `tonight` = teams and players projected 15+ minutes in each upcoming game labelled "keeps missing" or "reads well".
- `persistence`: does the label predict the next game? Walk-forward, label from the previous 15 games, next game's error divided by typical. On 11 November 2026: "keeps missing" 1.03, "reads well" 0.94 for players; teams 1.04 / 0.99. The labels describe the past far more than they forecast; say so next to the meter.

### `compare/players.json`

`{ note, cols[], rows[][], pct{} }` (about 125 KB), one row per player page, columns in `cols` order:

`id, n, team, pos, height (inches), arch, gp, min, pts, reb, ast, tpm, stl, blk, to, ts (%), usg, net (NBA.com), onOffSwing, onOffMin, prevGp, prevPts, prevReb, prevAst, last5Pts, last5Min, rimShare, threeShare (% of his shots, last season and this), trust, trustRatio, trustBias, trustGames, k2 (unofficial 2K overall; label it), q`.

Season numbers are this regular season (`cur`), `prev*` last regular season. `q` = 1 when he qualifies for percentiles (5+ games and 10+ minutes a game this season). `pct.<col>` = array of percentiles 0-100 in row order (`null` when not qualified) for `min, pts, reb, ast, tpm, stl, blk, ts, usg, onOffSwing, to` (`to` reversed: high = fewer turnovers). For deeper blocks (zones, splits, culture) load `players/<id>.json` for the two players.

### `compare/teams.json`

`{ note, cols[], rows[][], ranks{} }` (about 9 KB), 30 rows: `id, abbr, name, w, l, last10W, last10Margin, elo, adjNet, adjOff, adjDef, luckNet, threeLuck, pace, off, def, net, tpar (%), efg, oppEfg, ftr, tov, orb, oppTov (NBA.com four factors), depth, benchPts, q1-q4 (average margin by quarter, this season), trust, trustMae, trustBias, playersUsedClose, firstSubMin, tags[]`. `ranks.<col>` = 1-30 in row order, 1 = best (lowest for `def`, `oppEfg`, `tov`, `adjDef`; highest for pace and three-point rate). Records exclude the NBA Cup final.

## Simulation lab (NEW): `sim/<id>.json`, `sim/index.json`, `board.json`, `simcal.json`, `season.json`, `odds.json`

Written by `node scripts/simulate.mjs` (`npm run simulate`), which runs after `model.mjs`. Code: `scripts/lib/simhist.mjs` (walk-forward rates), `simcore.mjs` (game engine), `simsum.mjs` (summaries), `simmarkets.mjs` (market grid and board rule), `simodds.mjs` (comparison only), `simseason.mjs` (rest of season), `simrng.mjs`, `simdata.mjs`. About 4.5 minutes from scratch, about 2 minutes with the calibration cache (`data/sim-cache.json`). **CHANGED (11 November):** the cache is keyed on the engine source (`engine` = `courtside-sim 1.0 #<hash of simcore, simhist, simmarkets, simdata, simrng>`), on every engine parameter (the whole `params()` object except the descriptive `hist`) and on the shooting rates of the game's players as known before it, so a change to any of them re-simulates the affected games instead of reusing stale records. Settings: `SIM_N` (10000), `SIM_CAL_N` (600), `SIM_PILOT` (300), `SIM_SEED` (20261111), `SIM_CAL=on|off|fresh`, `SIM_SEASON_N` (20000), `SIM_GAMES=id,id`.

**Inputs.** The model's projection of each game (team points, pace, each player's minutes, points, rebounds, assists, threes, steals, blocks, the quarter split), each player's shooting, free-throw rate, turnovers and fouls from his box scores before the game, NBA.com inactive lists (`data/pregame.json`), and scenario rates counted from finished games in date order (`simhist.mjs`). Never betting lines. **CHANGED (11 November):** (1) preseason games no longer count in the scenario rates (DNP, minutes surprises, in-game exits, fouls, regulation error, pace, score effects, blowout minutes, rotation and the `hist` tallies); they still feed the players' shooting rates at weight 0.3. (2) Blowout minutes are by role (`params.blowoutRole`, counted walk-forward) for upcoming games as well as for the calibration; the model's per-player `ix.blowout` evidence is no longer read (it was not calibrated and the model itself holds it out of the projection), so `players[].blowSrc` is always `role`.

**How one simulated game is played.** Quarter by quarter, in 6-minute halves. Game-level draws: pace, each team's shooting temperature, each player's usage and form, a minutes surprise drawn from the counted surprises of his projected-minutes group, coach's-decision DNPs, in-game exits (rate and time counted from real exits: a player who left early and missed the next game), fouls (5 = foul trouble, 6 = fouled out). Each quarter shares 60 player-minutes per team (12 max per player); minutes lost to events go first to the same position (share counted from real exits). If a lead of `blowoutLead` points stands after three quarters, the learned blowout minutes apply in the 4th (starters down, bench up, both sides). Possessions end in a turnover, a free-throw trip or a shot; shots go to the players on the floor by usage x minutes x form, makes from each player's own percentages x the team's temperature, misses can be rebounded for another shot; assists, rebounds, steals and blocks follow from what happened. At each 6-minute mark the team ahead of its projection scores a little less for the next six minutes (`scoreEffects`, counted from the score flow of finished games: without it the simulated margins spread about 15% wider than real ones). A game within 3 points at the end of regulation gets a tying play at the counted rate, then 5-minute overtimes with the players still available. Every box score adds up: 240 minutes per team (+25 per overtime), player points = team points = quarter points.

**Calibrating the spread.** Per game, pilot runs measure the engine's own spread; the team shooting temperature then adds only what is missing for regulation scores to spread like the walk-forward errors (`targetSd`), pace noise is scaled down when both scores already move together more than in real games, and a small `meanCorrection` keeps each team's average on its projection.

### `sim/<id>.json` (one per upcoming game)

Top level: `format, id, date, phase, home, away, venue, generated, dataUpdated, label, config, inputs, distCols, sims, pHome, margin, total, forecast, lines, players, scenarios, combos, joint, comparison?`. `sims / pHome / margin / total` repeat headline values from `forecast` for other views.

| Field | Meaning |
|---|---|
| `config` | `engine`, `sims`, `seed`, `pilotSims`, `reproduce` (command), `calibrated` { `targetSd`, `engineSd`, `shootingSd`, `meanCorrection`, `minutesNoiseScale`, `paceNoiseScale`, `tyingPlay`, `blowoutStart` [P(home leads big after 3), P(away)] }, `params` (every counted rate used, with samples: `regulationErrorSd`, `scoreEffects` (7 values), `dnpRate` / `minutesSd` by projected minutes <8, 8-15, 15-25, 25+, `foulCut`, `foulTroubleScale`, `exitPer100Min`, `exitEvents`, `samePosition`, `otShareOfClose`, `blowoutLead`, `blowoutRole`, `games`) |
| `inputs` | `proj` (the model's `hs, as, pHome, pace`), `lateOut[]` (players on NBA.com's inactive list, left out), `notes[]` |
| `distCols` | `["mean","median","sd","p10","p25","p75","p90"]`, the column order of every player distribution array |
| `forecast` | probability-weighted over all simulations (the scenarios mixed by how often they happen): `pHome, pAway, pOT`; `margin` (home minus away, overtime included) and `total` as `{mean, median, sd, p10, p25, p75, p90, hist: {from, step, share[]}}`; `home`, `away` team points; `quarters` { `home[4]`, `away[4]`, `halves`, `overtime`, `firstHalfMargin`, `secondHalfMargin`, `pHomeWinsQ1`, `pHomeLeadsHalf` } |
| `lines` | the simulation's own fair lines (not a sportsbook's): `spread` { `homeLine`, `pHomeCovers`, `pAwayCovers`, `note` }, `winOdds` { home, away fair American odds }, `total` { line, pOver, pUnder }, `teamTotals` { home, away } |
| `players[]` | `id, n, side (0 home), pos, role, q, proj {min, pts}, dist {min, pts, reb, ast, tpm, stl, blk, tov, pra}` (arrays in `distCols` order), `thr` { pts: [[10, p], ...], reb, ast, tpm, stl, blk } = chance of at least that many, `props` { pts, reb, ast, tpm, stl, blk, pra: {line, pOver, pUnder} } fair x.5 lines, `shooting` {fgm, fga, tpa, ftm, fta, fgPct}, `fouls` {mean, p5, p6}, `pDnp`, `blowSrc` (always `role` since 11 November; kept for older readers) |
| `scenarios[]` | 17 groups: `normal` (decided by 6-14, no overtime, no early exit), `close` (5 or less), `blowH`, `blowA` (15+), `ot`, `injH`, `injA` (one of the 3 highest-minute players leaves early), `foulH`, `foulA` (a top-5 player gets 5+ fouls), `hotH`, `coldH`, `hotA`, `coldA` (5+ eFG points from the players' own percentages), `fast`, `slow` (6%+ from the projected pace), `rotH`, `rotA` (a 10+ minute player sits or moves 10+ minutes). Each: `label`, `freq` (share of simulations), `sims`, `hist` {rate, n, what} = how often the same thing happened in finished games, `pHome`, `margin`, `total`, `home`, `away` within the scenario, `gains[]` / `losses[]` (biggest points changes versus all simulations: `pts`, `min`, `reb`, `ast`, `ptsIn`), `players[]` = `[id, pts, min, reb, ast]` within the scenario, `who[]` (injury scenarios: which player leaves, `share`, `pHome`, `margin`), `text` (plain-language explanation built from these numbers) |
| `combos[]` | up to 8 pairs of scenarios from different families seen in 2%+ of simulations: `ids`, `label`, `freq`, `lift` (times as often as if unrelated), `pHome`, `margin`, `total`, `text` |
| `joint[]` | same-game pairs counted in the same simulated games: `label`, `p` (joint), `a` {label, p}, `b` {label, p}, `ifUnrelated` (a.p x b.p, shown only to show the correlation; never used as the joint) |
| `comparison` | only when `data/odds.json` has the game. **For comparison only** (`label` says so): `provider`, `fetched`, `winner` {team, bookProb (margin removed), ourProb, diff}, `spread` {bookLine (home), bookProb, ourProb, diff}, `total` {bookLine, bookProb, ourProb, diff}, `props[]` {id, n, stat, bookLine, ourProbOver, ourMedian, diff}. Nothing in this block changes any other number |

Example (PHI v BOS, 401909961, 11 November): `pHome 0.36`, margin median `-5`, total mean `216.4`; fair lines PHI +5.5 (49.8%), total 216.5; scenario `blowA` 27.8% of simulations, back-test: favourites won by 15+ in 28% of 407 finished games projected 4-8 apart.

`sim/index.json`: `{ format, generated, dataUpdated, sims, games: [{ id, date, home, away, pHome, margin, total, pOT, spread, totalLine, comparison }] }`.

### `board.json`

`{ format, generated, dataUpdated, min: 0.85, note, rules, comparisonLabel, calibration { games, all, byFamily }, picks[] }`. A pick: `game, date, home, away, fam` (`winner`, `spread`, `total`, `teamTotal`, `pts`, `reb`, `ast`, `tpm`), `label`, `side` (`win`, `by` = favourite wins by more than `line`, `plus` = underdog +`line`, `over`, `under`), `line`, `p`, `team` or `player` {id, n, t, projMin}, `hit` {rate, n, band, scope} = how often picks chosen by the same rule came true in the walk-forward calibration (`scope` says whether it is this market type or all types, used under 30 picks), optional `comparison` {bookLine, bookProb, ourProbAtBookLine} (for comparison only). Rule: for each game, team or player and side, only the strictest grid line still at 85%+; player markets are overs for players projected 20+ minutes. Show `hit` next to every pick: player picks come true 2 to 5 points less often than stated (85-90% band: 83-85%).

### `simcal.json`

`{ format, generated, dataUpdated, engine, note, method, winner { table[], brierSim, brierModel, marginMaeSimMean, marginMaeModel, byPhase }, markets { all[], byFamily }, board { min, rule, all[], byFamily }, ranges { margin, total, pts, reb, ast: {n, inside, above, below} }, scenarios { rows[] } }`. Table rows: `{ band, n, said, happened }` (percent). Built walk-forward on 1,367 non-preseason games (the first 100 are skipped while the history fills), each simulated 600 times from its own pre-game projection page and rates counted before it. 11 November run (after the preseason and blowout changes, `SIM_CAL=fresh`): all markets 55/54.5, 65/64.7, 75.1/75.0, 82.5/82.0, 87.5/86.9, 92.6/92.2, 97.4/97.0 (said / happened); winner Brier 0.206 (model 0.205); 80% ranges: margin 80.5%, total 81.4%, points 77.9%, rebounds 79.0%, assists 81.0%; overtime simulated 4.5% vs 4.5% real. Counted rates at the end of the walk (non-preseason games only): coach's-decision DNP 47.6% / 16.0% / 2.7% / 0.2% (projected under 8 / 8-15 / 15-25 / 25+ minutes), 225 in-game exits (0.036 per 100 player-minutes), regulation error sd 11.7 / 11.6, pace sd 0.041; previously, with preseason pages counted: 45.7 / 16.5 / 3.6 / 0.2%, 258 exits, 11.85 / 11.65, 0.043.

### `season.json`

`{ format, generated, dataUpdated, seed, note, season, sims, method {ratings, games, uncertainty, tiebreak, playoffs}, schedule {played, scheduledWithDates, filledWithoutDates, cupFinalsExcluded, note}, teams[], conferences {East: [ids by average seed], West} }`. Team: `id, abbr, conf, div, w, l, rating, ratingPrior, wins {mean, p10, median, p90}, losses {mean}, seed {avg, dist[15]}, pTop6, pPlayIn, pPlayoffs, pSecondRound, pConfFinals, pFinals, pTitle, pFirstSeed`. ESPN's schedule feed covers about a week, so the other remaining meetings follow the NBA formula without dates (`schedule.note`). Statistical only.

### `odds.json`

A display copy of `data/odds.json` (format in `docs/DATA-RAW.md` section 8), for the two tabs only. Removed when `data/odds.json` is missing.

## Running and checking

```bash
node scripts/model.mjs      # writes public/data (about 40 seconds with warm file cache)
node scripts/insights.mjs   # analysis views (insights.json, compare/), after the model; about 2 seconds
node scripts/diag.mjs       # accuracy by phase, calibration, range coverage, factor report
```

- `CL_OUT=<folder> node scripts/model.mjs` writes a scratch copy instead of `public/data`; `CL_OUT=<folder> node scripts/diag.mjs` reads it.
- `CL_FACTORS=off` runs the same walk-forward with every factor effect held at zero (the ablation behind the before / after table). `CL_FACTORS_SKIP=zone,rim` switches single factors off.
- In-loop features: `CL_IX=off` holds all of them at zero, `CL_IX_SKIP=blowMin,mateOut` single ones, `CL_IX_MIN=apply` applies the two held minutes features, `CL_IX_DNP=off` leaves coach's-decision DNPs out of the minutes evidence. Splits: `CL_SPLITS=old` (previous rule), `CL_SPLITS=relproj` (relative gap in the projection), `CL_SPLIT_TEAM=on` (splits in the team-level sum). Who guarded whom: `CL_DM_MODE=replace|pure|shares` (default `centred`), `CL_DM_K=defK,typeK,pairK`, `CL_IX_SKIP=defReal,defPair`. A `CL_OUT` run writes no `data/history` snapshot unless `CL_HISTORY=1`.

## Known limits

- Shot coordinates are whole feet, so a shot within a foot of a zone line can land on either side (about 0.2 points of share per zone).
- ESPN does not list who starts each period; on-court fives are inferred from substitutions and first events (`lib/flow.mjs`; checked against box scores: minutes within 0.25 a player-game, plus-minus within 0.03; `learning.json > inloop.flow.partial` counts games with a stretch that could not be fully inferred). "Likely defenders" still means the opponent's expected rotation, not a tracked assignment.
- NBA.com defender tracking credits the closest defender. A guard can appear with many shots defended near the rim.
- Synergy play types have no dated version, so the back-test can only use last season's table for them.
- 8 playoff games of 2025-26 have no box score or play-by-play at ESPN (`meta.data.scoreOnlyGames`). They count by final score in previous meetings (`h2h.games[].noBox`, `h2h.noBox`), scenario records, rest days, streaks and Elo; they have no result page, no player lines and are not in the zone or four-factor numbers.
- Chicago's 2025-26 box scores have one row without a player in 48 games; the line is rebuilt when the model loads (`meta.data.blankBoxRowsRebuilt`) and team totals always come from ESPN's team row.
- Corner threes are counted about 1.5% high and above-the-break threes a little under 1% low versus NBA.com (`meta.scout.zoneBias`).
- The tip-off track of the back-test knows who is inactive and who starts; `learning.json > liveTrack` shows the same model without that.
- A paper edge is arithmetic, not a forecast. Only `applied`, `fx` and the `pts / reb / tpa` columns reflect what the back-test supports.
