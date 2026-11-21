# Hoops Rotation — App Guide

## What This Is

A basketball rotation planner. For each player you enter a share of the game
(percent), the positions they can play (1–5), and whether they start and/or
close. The app plans who plays each shift and at which position. Requires
sign-in; the roster and saved games are per user.

## Files

```
__init__.py                            — Blueprint: route /hoops-rotation
templates/hoops_rotation/index.html    — the page: roster UI, plan view, swaps, Firestore
static/rotation_engine.js              — the planning algorithm (no DOM; Node can require it)
static/hoops_rotation.css              — this app's styles, incl. print styles
```

## The Game Clock
Settings: periods (4 → "Q", 2 → "H", else "P"), minutes per period, and a sub
grid of 1:00 or 0:30. The game is a grid of **ticks** of that length and the
planner picks a lineup per tick, i.e. it chooses the sub times. Labels use the
counting-down game clock ("Q2 5:00"). Sub times are targets; the coach subs at
the next dead ball.

## Rules
Hard (never broken by the planner):
- Every tick has exactly one player at each position 1–5, only at a position
  that player has selected (a player can have any number of positions)
- Tick 0 is exactly the 5 starters; the last `closeMinutes` are exactly the 5 closers
- Only players marked Here are used

Settings, enforced as penalties that tighten during the search, so they hold
whenever they can (tests: always met so far):
- **Max in per sub** (default 2): players coming in at one stoppage. Any
  number may change at a period break
- **Min stint** (default 3:00): once in, a player stays at least this long
- **No long sits** (fixed, not a setting): nobody sits half the game or more
  in a row, and with 3+ periods nobody misses more than one whole period.
  Players at 0% are exempt

## What a percent means
A player's % is the share of the **game clock** they should be on the floor
(75% of 32:00 ≈ 24:00). The floor holds 5 × game length player-minutes, so the
team should total 500%. Otherwise everyone below 100% is scaled by one common
factor to fill the floor minutes (`RotationEngine.scaleShares`). The roster shows
"≈ m:ss" per player after scaling and a summary line: "Asking for 140:48 of
160:00 floor minutes … scaled up 25%" (`scalingInfo` in the page).

## Engine (`RotationEngine.plan({ players, ticks, tickMinutes, periodTicks, maxSubs, minStint, closeTicks, seed })`)
1. **Targets**: percents scaled by one common factor so the total is 500%,
   capped at 100% each (water-filling).
2. **Search** (`search`): simulated annealing over per-tick bitmasks, from
   "starters until the closing stretch". A move swaps player y in for x over
   a stretch where x is on and y is off (all of it, or part sharing one end);
   moves that leave a tick unable to cover 1–5 are skipped. 3 restarts, best kept.
   Cost (`WEIGHTS`, hand-tuned on two sample rosters of 10 and 13 players):
   squared minutes off target + `spread` (running total vs even pace) +
   `bench` (squared length of each sit) + `event` per stoppage + `gap` when
   two stoppages (or a period start and a stoppage) are closer than min stint.
3. **Positions**: ticks collapse into segments; DP over segments minimising
   position changes, then sweeps that also count changes across a bench stint.

`RotationEngine.check(players, rules, segments)` lists rule breaks (too many
in, short stint, wrong starters/closers, ineligible position). The page runs
it after every hand edit and shows the results in red.

Tradeoffs worth knowing: more weight on `event`/`gap` = fewer stoppages but
longer sits and looser minutes; `bench` does the reverse. The family prefers
more subs over long sits, so `bench` is high (4) and `event` low (1): on the
sample rosters that's ~11–14 stoppages per 32-min game, worst sit 10–11 min.
Raising `bench` past 4 barely shortens sits but bunches subs together. Low-minute players
can't appear in every quarter when min stint × quarters exceeds their minutes.

## Data Model
- Roster + settings: `users/{uid}/hoopsRotation/roster` =
  `{ players: [{ id, name, pct, positions, starter, closer, present }], settings }`,
  autosaved (debounced) on every edit
- Saved games: `users/{uid}/hoopsGames/{gameId}` =
  `{ label, date, settings, players (snapshot), segments: [{ start, end, slots: [5 ids] }], targets, warnings, seed }`.
  start/end are ticks of `settings.grid` minutes; targets are in ticks.
  Segments are objects because Firestore can't store nested arrays

## Page
- Lineups table: one row per lineup with its start time and length, preceded by
  an In/Out line. Tap a name to put in an eligible bench player or swap
  positions (changes only that segment; equal neighbours merge). A green left
  edge marks a player just subbed in
- Minutes by player: a timeline bar per player (blocks labelled with position,
  period lines), Plan and Target as m:ss and percent. Amber = 2:00+ off target
- "Reset positions & %" clears every player's positions and sets everyone to an
  equal split (500% ÷ players Here, max 100%); names, Start/Close, Here/Out stay
- A plan made from the roster is flagged stale when the roster/settings change
- Planning runs after a 30 ms repaint so the button can show "Planning…"
  (about 0.2–0.5 s)
- Print hides the setup and controls and prints both tables
