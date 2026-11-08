# Cook Timer — App Guide

## What This Is

A multi-dish cooking timer. You define dishes with sequential steps (e.g.
"Chicken — flip at 15 min, done at 40 min"), pick a timing mode, and the app
fires alerts at each step. Requires sign-in; saved dishes are per user.

## Files

```
__init__.py                   — Blueprint: route /cook-timer
templates/cook_timer/index.html — the page; all logic lives here
static/cook_timer.css         — this app's styles (loaded after /static/site.css)
```

## Timing Modes
- **Start Together**: All dishes start now; step alerts fire at `now + cumulative duration`
- **Finish Together**: App delays shorter dishes so all finish simultaneously
- **Done By**: User picks a target clock time; app back-calculates start times for each dish

## Data Model
- **Setup state**: `{ name, steps: [{ action, minutes }] }`
- **Active state**: `{ name, currentStep, done, steps: [{ action, fireTime, fired, warned, isWait }] }`
- For delayed dishes (Finish Together / Done By), a "wait" step is auto-inserted at the start
- Saved dishes: Firestore `users/{userId}/dishes/{dishId}`, synced live via `onSnapshot()`
- An in-progress cook survives a reload via `localStorage` key `cookTimerState`

## Timer Loop
- `setInterval(updateTimers, 1000)` drives everything
- Cards sorted by urgency each tick
- Color states: waiting (purple) → upcoming (amber) → imminent (yellow) → fired (red pulse) → done (green)

## Alerts
- 30-second warning: 440 Hz beep via Web Audio API
- Step fire: 880 Hz double-beep
- Browser notifications also sent
- AudioContext created on the `startCooking()` tap (required for mobile)

## Key Features
- Pause All: shifts all future `fireTime`s forward by pause duration; per-dish pause too
- Manual "Done" button: advances current step early, recalculates remaining fire times
- Skip step
- Wake Lock API: keeps screen on during cooking
