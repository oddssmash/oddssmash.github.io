# Courtside Ledger - roadmap

Work through the steps in order. Mark a step `[x]` only when it is finished AND verified. A session that resumes this project starts at the first unchecked step.

> If the file `.workflow-running` exists in this folder, a multi-agent build is in progress: an automatic run must stop without changing anything.

## Standing rules (from the owner)
- Never use betting odds, sportsbook lines, prop markets or betting news: 0% influence, not as inputs, not displayed.
- Scenario-based: learn game by game from what really happened, from the 2025-26 preseason to now. The back-test must stay leak-free (a past game may only use data dated before it).
- Mobile-first (375px, no horizontal scroll). Dark by default. Show dates and times in Philippine time (Asia/Manila).
- Honest reporting: sample sizes shown, unofficial data labelled, no character judgments of real players.
- Stay inside this folder. Never touch the CBD site repo. No git push, no new public repository, no new artifact: only republish the existing private preview (see below).
- Zero npm dependencies. Create and edit code with the Write/Edit tools (shell heredocs drop backslashes here).

## Batch 1 - zones, Scout, keys to the game
- [x] Play-by-play shot data and NBA.com zone, defender and play-type tables (scripts/fetch.mjs, scripts/lib/pbp.mjs, zones.mjs)
- [x] Dark default, player faces, team logos
- [x] Zone engine, 13 learned matchup factors, player/team scout data, why-win/lose keys, previous meetings, provable scenarios (scripts/model.mjs, scripts/lib/*)
- [x] Scout section, court map, playstyle and culture pages
- [x] Independent review (4 reviewers)
- [x] Apply review fixes (scripts, then website); re-run `node scripts/model.mjs` and `node scripts/diag.mjs`; accuracy must be no worse than: 2025-26 regular season winner 68%, margin MAE 11.4; 2026-27 regular season winner 68%, MAE 11.8; player points MAE about 5.0
  Done 2026-11-11: 34 script fixes (US Eastern rest days, player stints, betting-news filter, leak fixes, Cup final excluded...) and 10 website fixes (navigation race, questionable tag, court label size, zone numbers on the map, tap sizes, empty states, light contrast, 2K labelled unofficial). Accuracy: 2025-26 reg 67.9% / 11.41 / pts 4.980; 2026-27 reg 68.2% / 11.73 / pts 4.993; range coverage 80.2%.
- [x] Player matchup splits (owner feedback from a phone screenshot, 2026-11-10): (1) measure each split relative to the player's own overall gap vs projection across all his games, so a player who was generally under-projected (rookie, breakout) does not show the same +8 to +12 in every situation; (2) raise minimums for the best/toughest lists and the projection: about 8 games for situations, styles, sizes and archetypes, 5 for specific opponents, opposing players and arenas (head-to-head is capped by the schedule at 3-4 meetings a season, so explain that); (3) show a "small sample" label below about 10 games; (4) state on the page that the counts already include last season, the playoffs and this season.
- [x] Ease-of-use pass: top 1-2 reasons visible on each player row without a tap, plain-language labels, search from anywhere, day switcher, favourites, clear loading/empty states, Philippine time everywhere. Use the installed design skills (impeccable, emil-design-eng, design-taste-frontend, make-interfaces-feel-better, a11y) - do not install anything new
- [x] Phone-size test of every route (dark and light), then `node scripts/bundle.mjs` and republish the private preview
- [x] Delete the file `.build-in-progress` so the scheduled refreshes start running

## Batch 2 - owner asked for all of these
  Done 2026-11-11 (multi-agent build + 4 reviewers + fixes). Only the split fix changes projections; the other in-loop features are shown as evidence because they did not reduce error. Accuracy: 2025-26 reg 68.0% / 11.37 / pts 4.949; 2026-27 reg 68.8% / 11.55 / pts 4.957; playoffs 61.0% / 13.22.
- [x] Who guarded whom: NBA.com matchup tracking (defender possessions on each scorer), replacing "likely defender at his position"
- [x] On-court lineup effects from play-by-play substitutions: per-minute on/off impact, pairs and five-man groups, rim defence with and without each big
- [x] Confirmed starters and late scratches: refresh more often on game days, re-project when a starter is ruled out
- [x] Game-flow scenarios: each player's output when far ahead, far behind, and in tight fourth quarters
- [x] Blowout minutes learned per player and per coach, from BOTH sides, applied in proportion to blowout probability:
  - favourite: a star who usually sits the 4th against weak teams (fewer minutes and stats)
  - underdog being blown out: its starters may be pulled early too, while its bench and young players get extra garbage-time minutes and stats (and some stars pile up stats when trailing); learn which players and coaches do which
- [x] Return-from-injury curves: minutes and scoring ramp over the first games back, by injury type
- [x] Coach rotation habits: sub timing, who closes games, bench length in close games
- [x] Rest-of-season simulation: projected standings, seeding, playoff odds from playing out the schedule (statistical simulation only, no betting odds)
- [x] Trust meter: which players/teams the model reads well or keeps missing
- [x] Compare tool: two players or two teams side by side
- [x] "What changed today": new injuries, role changes, biggest projection moves since the last refresh
- [x] Re-run the back-test, independent review, fix, phone test, republish

## Owner decision 2026-11-11 - matchup layer in the main analysis
The owner wants the matchup layer applied in the overall analysis even where the back-test gate held it at zero: zone hot/cold vs opponent soft/strong zones (points and rebounds), rim-protector and perimeter-defender edges, and player matchup splits in the team totals and win chance. Do it after the current multi-agent build finishes (it is editing model.mjs now).
- [ ] Apply these at their learned size with a floor (at least half of the on-paper effect, capped as today), so they always move the numbers, and say so on the page.
- [ ] Owner priority: the defender-type (2K archetype + NBA.com tracking) and team-size splits shown on the Scout page under "Against defender types and team size" must feed the main projection (points, rebounds, assists, 3PA) and the team totals, with their game counts shown on the player's projection row. Once who-guarded-whom data exists, weight the archetype of the defenders he actually faces by their share of his possessions.
- [ ] 2K-style hot zone map (owner request): show each player's court as the familiar 14-zone grid (restricted area, paint, left/right baseline mid, left/right elbow, top of key mid, left/right corner three, left/right wing three, top three, deep) coloured red = hot, blue = cold versus league, built from real shots (data/pbp x,y, cross-checked with NBA.com shot locations, the same data as nba.com/stats/players/shots). Real NBA 2K27 in-game hot zones are not in any accessible dataset (2kratings blocks bots; the GitHub sets have no zone data), so label it "real-shot hot zones", not 2K's. Use these zones in the matchup layer above.
- [x] Picks tab upgrade (owner request 2026-11-11), on top of the high-confidence board being built now:
  Done 2026-11-11: Lab > Picks (#/picks): player/team props, 95%+ near-certain band, main + alt lines, scenario robustness, strengths/weaknesses, zones, coach habits, suggested cross-game parlays (independent legs) and same-game combos from the sims. Still open: skills-vs-skills reasons once that item is built.
  - Separate sections for player props and team props (winner, spread at our line, team totals, game total, quarters/halves).
  - Bands: 85-94% and "near-certain" 95%+ (never call anything 100%; show the real past hit rate and sample for each band, and how many 95%+ picks actually missed).
  - Alternative lines: for each player and team, the line at which the chance reaches 85% and 95% (e.g. Booker 16.5+ points at 86%), alongside our main line.
  - Each pick shows WHY, drawing on every layer: overall projection, scenario library, the multi-scenario Monte Carlo (how often it hits in each scenario: normal, close, blowout, OT, injury, foul trouble), his strengths and weaknesses vs defender types, team size, specific opponents and arenas, the coach's rotation and blowout habits, and hot/cold zones on offence vs the opponent's soft/strong zones on defence.
  - Flag picks that fail in a likely scenario (e.g. hits 92% overall but only 60% if it becomes a blowout).
- [x] Skills vs skills (owner request 2026-11-11), like NBA 2K27 specialities:
  Done 2026-11-11 (display): play types + drives + 2K27 badges vs opponent play-type defence rank, zone defence and actual defenders, on game page rows, prop reasons and Picks why. Not yet fed into the projection (part of the matchup-layer item).
  - Each player's offensive skills: 2K27 archetype and badges from the GitHub dataset (it includes badges with tiers, e.g. "Layup Mixmaster: HOF"; labelled unofficial) plus real NBA.com evidence (Synergy play types with points per possession and percentile, drives, catch-and-shoot, pull-ups, post-ups, transition). Labels like Slasher, Sharpshooter, Post scorer, Playmaker, Rim runner, Pick-and-roll handler, Off-ball cutter.
  - Each opponent's matching defensive skills and weaknesses: team Synergy defence per play type, defender tracking (rim, 3s, isolation), and defenders' 2K defensive badges/attributes.
  - Show for every game and on Scout: his skill vs their defence on that skill (e.g. "Slasher vs a team allowing the 4th-most drive points"), and his real record against strong and weak defences of that type, with samples. Feed it into the matchup layer and the Picks "why".
- [ ] Keep the gated "pure data" projection too: show it beside the main one on game pages and track both on the Why page (winner %, margin, player points), so the owner can see what the matchup layer costs or gains over time.

## QA findings 2026-11-11 (quality pass)
Fixed now: Picks shows chances adjusted for past accuracy (player props were 3-5 points over-confident), hides near-automatic low lines by default, keeps questionable players and low lines out of parlays; Why page shows ahead-of-time accuracy (66-67% winners vs 68-69% at tip-off).
- [ ] Use confirmed starting line-ups and late scratches (data/pregame.json, already fetched) in model.mjs for upcoming games; ahead-of-time projections under-project regular starters by about 1 minute on average (worst 4-6 minutes).
- [ ] Questionable players: project "if he plays" and show a separate chance he plays, instead of trimming minutes by 20% (stars like Scottie Barnes show 14 pts vs a 23.5 average, which makes their props and team totals misleading).
- [ ] Game-day refreshes: add scheduled "node scripts/fetch.mjs pregame" + model + simulate + bundle + republish runs around tip-offs (about 7:30, 9:30 and 11:30 AM Philippine time) so confirmed line-ups and late scratches reach the page.
- [ ] Simulation player variance: widen player stat distributions in simulate.mjs so player-prop calibration matches (currently 85-90% band comes true 82-85%), then the Picks adjustment becomes small.
- [ ] Two lines for the same game can differ (game page "Our lines" from the model vs the Simulation lab): label both clearly or show the simulation's numbers on the game page too.

## Batch 3 - added by the owner 2026-11-11 (new tabs; version 1 stays as it is)
Rule change for this batch only: odds and sportsbook lines MAY be shown, but only in the new separate tabs and only for comparison. They must never feed the projections, the learning, the scenario library or any version 1 page.
- [x] Two-way interaction effects made explicit and shown: player -> team, team -> player, player <-> teammates, player <-> opposing player, player <-> opposing team (with sample sizes)
- [x] Multi-scenario Monte Carlo simulation lab (new tab per game): thousands of simulated versions of one game, each internally consistent (minutes, possessions, player box scores, quarters, final score). Scenario groups and their probabilities estimated from the back-test history, not assumed: normal, close, blowout either way (starters rested, bench minutes), overtime, in-game injury to a key player on either side, foul trouble, hot/cold shooting, pace extremes, rotation changes, and combinations. Show the probability-weighted view and a conditional "what if" view per scenario; for team totals, margin, win chance and each player's stats show mean, median, 10th-90th percentile and distribution; explain why each scenario differs and who gains or loses. Calibrate against finished games (simulated probabilities vs results) and report it honestly.
- [x] High-confidence board (new tab): every market where the simulation gives 85%+ (player points/rebounds/assists/threes thresholds, team totals, margin, winner), with the back-tested hit rate for that confidence band shown next to it; optional column comparing with sportsbook lines where available (display only)
- [x] Game scripts and quarter-by-quarter projections, consistent across quarters
- [x] Historical game similarity finder: past games with similar lineups, injuries, pace and matchups, and how they ended
- [x] Prediction disagreement view: the five rating systems and the simulation side by side, with why they differ
- [x] Breakout watch: players whose minutes or usage should jump (teammate out, new starter, matchup)
- [x] Data anomaly checks before each refresh (missing stats, name mismatches, stale injuries, conflicting sources)

## Publishing the private preview
`node scripts/bundle.mjs` builds `dist/`. Republish `dist/index.html` with root `dist/` and every other file under `dist/` to the existing artifact https://claude.ai/artifact/Cpg52UXRtZVttshHrnsFSJ (read it and list its files first). Never create a new artifact.
