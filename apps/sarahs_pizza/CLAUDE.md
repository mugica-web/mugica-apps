# Sarah's Pizza Shop — Project Guide

## What This Is

A pizza shop game designed by Isabel (age 5). A customer walks in the door
and shows a picture of the pizza they want; you tap toppings onto a pizza,
bake it, and they sit down at a table to eat it. 10 right pizzas wins.

Built for a 5-year-old, so: **no reading needed** (orders are pictures and are
spoken aloud with the browser's speech synthesis, 🔊 repeats it), **no timer**,
and **no penalty** for a wrong pizza — the same customer asks again.

One of the apps on mugica-apps, the family site (see `../../CLAUDE.md`). Served
at `/sarahs-pizza` with a tile on the dashboard. Like Taboo Jr., no sign-in and
no link back to the dashboard.

**Isabel is the designer.** Game rules, toppings and look are her decisions;
ask her before changing them.

## Stack

Single self-contained `index.html` — inline CSS and JS, no build step, no
framework, no network calls except the Baloo 2 webfont. Pictures are emoji and
inline SVG drawn in JS (`pizzaHtml`, `tableSvg`). Sounds are Web Audio beeps;
the AudioContext is created on the Play tap. Speech uses `speechSynthesis` and
silently does nothing where it isn't available.

## Rules As Implemented

- Toppings: tomato 🍅, pineapple 🍍, green pepper 🫑, mushroom 🍄, broccoli 🥦
  (buttons sit 3 + 2).
- Orders get harder with stars: under 3 stars, one topping ×1–2; 3–5 stars,
  one or two toppings ×1–3; 6+ stars, two toppings ×1–3.
- Each pizza starts from scratch: tap 🫓 Dough 3 times (a ball squished flat,
  `state.base` 0→3), then 🥫 Sauce (4), then 🧀 Cheese (5). Only the next step's
  button is enabled and wiggles. After the cheese the step buttons are replaced
  by the topping buttons. A wrong pizza keeps its base; a new customer starts
  from dough again.
- Tap a topping to add a piece (max 9), ↩️ removes the last one, 🔥 Bake!
  bakes for 1.5 s and then checks: counts per topping must match exactly.
- Right: ⭐, customer sits at one of 4 chairs (oldest diner leaves), next
  customer. Wrong: customer looks 😕, says the order again, pizza resets.
- 10 stars (`STARS_TO_WIN`) → win screen with confetti.

## Saved State

None.

## Testing

No test file. Drive it with Playwright (click the wiggling step buttons with
`{ force: true }`, or Playwright waits forever for them to stop moving) against `index.html` as a `file://`
URL: read `state.order` ({toppingId: count}), click `.topping[data-id=...]`
that many times, click `#done-btn`, then wait for `state.busy` to be false
(a right pizza takes ~3.6 s to the next customer, a wrong one ~4.6 s). Check
layout at 340 and 390 px wide — the room uses pixel positions for the door,
chairs and counter spot, and the order bubble shrinks its pizza picture on
narrow screens.
