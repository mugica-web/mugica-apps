# Laura's Pies — Project Guide

## What This Is

A pie shop game designed by Alicia (age 8). Laura is a made-up baker. Customers
walk in the door, ask for a pie with a topping, and you make it: pick the pie,
bake it in the oven, pick the topping, serve. Right pies earn coins; every 20
coins opens a new pie shop. You have 40 seconds — the score is how many new
shops you opened.

One of the apps on mugica-apps, the family site (see `../../CLAUDE.md`). Served
at `/lauras-pies` with a tile on the dashboard. Like Taboo Jr., it has no
sign-in and no link back to the dashboard.

**Alicia is the designer.** Game rules, pies, toppings and look are her
decisions; ask her before changing them.

## Stack

Single self-contained `index.html` — inline CSS and JS, no build step, no
framework, no network calls except the Baloo 2 webfont. All pictures are emoji
or inline SVG drawn in JS (`pieSvg`, `toppingSvg`, `shopSvg`, `tableSvg`).
Sounds are Web Audio beeps; the AudioContext is created on the start tap.

## Rules As Implemented

- Menu: Apple, Pumpkin, Peach pies; Whipped cream or Ice cream topping.
  Customers order a random pie + topping, never the same order twice in a row.
- Making a pie: pick pie → tap oven to bake → tap again to take it out →
  pick topping → Serve. Toppings are locked until the pie is out of the oven;
  picking a pie again starts a fresh raw pie (the way to redo a burnt one).
- The bake bar runs `BAKE_MS` (2 s). Out before `GREEN_FROM` = raw, between
  `GREEN_FROM` and `GREEN_TO` = perfect, after = burnt; at 100% it comes out
  burnt by itself. The bar's colours are set from those constants at load.
- Serve: right pie + right topping + perfect bake = +5 coins, customer sits at
  a table (4 chairs, oldest diner leaves). Anything else = customer grumpy,
  walks out, no coins.
- 20 coins → new shop, coins drop by 20. Timer 40 s.

Tuning knobs are the constants at the top of the script (`GAME_SECONDS`,
`COINS_PER_PIE`, `COINS_PER_SHOP`, `BAKE_MS`, `GREEN_FROM`, `GREEN_TO`).

## Saved State (localStorage)

| Key | What |
|---|---|
| `laurasPies.best.v1` | best score (new shops in one game) |

Reads and writes are wrapped in try/catch; the game plays fine without storage.

## Testing

No test file. Drive it with Playwright against `index.html` as a `file://`
URL: read `state.order` to make the right pie, click `#oven` twice with a wait
(~1.4 s lands in the green), and check `state.served` / `state.mistakes`.
Check layout at phone widths (340 and 400 px) — the shop room uses pixel
positions for the door, chairs and counter spot.
