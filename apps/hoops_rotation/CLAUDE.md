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
Settings: periods (4 → "Q", 2 → "H", else "P"), minutes per period, subs per
period. The game is `periods × (subs + 1)` equal **shifts**; lineups change only
between shifts. Shift labels use the counting-down game clock ("Q2 4:00").
Minutes therefore come in whole shifts. More subs per period = finer steps.

## Rules (hard constraints)
- Every shift has exactly one player at each position 1–5, only at a position
  that player has selected
- Shift 1 is exactly the 5 starters, the last shift exactly the 5 closers
- Only players marked Here are used

## Engine (`RotationEngine.plan({ players, shifts, seed })`)
1. **Targets**: percents scaled by one common factor so the total is 500%,
   capped at 100% each (water-filling). Target shifts = share × shifts.
2. **Counts**: min-cost flow (source → player → player×shift → shift×position →
   sink) with convex per-unit costs, minimising Σ (count − target)² while
   staying feasible. Ties break by roster order, so counts are deterministic.
3. **Spread**: simulated annealing swaps shifts between pairs of players
   (counts unchanged, shifts 1 and last fixed) to keep each player's running
   total close to an even pace, with an extra cost for sitting 3+ shifts in a row.
4. **Positions**: DP over shifts minimising position changes between
   consecutive shifts, then sweeps that also count changes across a bench stint.

`seed` only changes steps 3–4 ("Try another arrangement" keeps the minutes).
Returns `{ ok, lineups: [[id at 1..5] per shift], counts, targets, shares, warnings }`
or `{ ok: false, errors }`. When positions/starters/closers make a target
unreachable the plan still comes out; the page shows Plan vs Target per player
and marks gaps of a full shift or more in amber.

## Data Model
- Roster + settings: `users/{uid}/hoopsRotation/roster` =
  `{ players: [{ id, name, pct, positions, starter, closer, present }], settings }`,
  autosaved (debounced) on every edit
- Saved games: `users/{uid}/hoopsGames/{gameId}` =
  `{ label, date, settings, players (snapshot), lineups: [{ slots: [5 ids] }], targets, warnings, seed }`.
  Lineups are wrapped in `{ slots }` because Firestore can't store nested arrays

## Page
- Lineups-by-shift table: tap a name to put in an eligible bench player or swap
  positions with someone on the floor who can trade spots. A green left edge
  marks a player just subbed in; an In/Out line follows each shift
- Minutes-by-player table: position number per shift, Plan and Target as
  m:ss and percent
- A plan made from the roster is flagged stale when the roster/clock changes
- Print hides the setup and controls and prints both tables
