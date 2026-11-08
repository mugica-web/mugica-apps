# Cook Timer — App Guide

## What This Is

A multi-dish cooking timer. You define dishes with sequential steps (e.g.
"Chicken — after 15 min: Flip, then after 25 min: Take out"), pick a timing
mode, and the app rings an alarm at each step. Requires sign-in; saved dishes
are per user. The main user cooks with Chrome on iPhone (WebKit), so sound and
the screen are the only alerts that matter there.

## Files

```
__init__.py                   — Blueprint: route /cook-timer
templates/cook_timer/index.html — the page; all logic lives here
static/cook_timer.css         — this app's styles (loaded after /static/site.css)
```

## What a step means
A step is `{ action, minutes }`: **do `action` when `minutes` have passed since
the previous step** (the first step counts from when the dish starts). The
setup row reads "After [n] min: [action]"; the running card shows "Next: action"
with a countdown, and "Then: …" for the step after.

## Timing Modes
The UI shows two choices; internally `timingMode` has three values:
- **Start together** (`start`): every dish starts now
- **Finish together → as soon as possible** (`finish`): shorter dishes are delayed so all finish with the longest
- **Finish together → ready by [time]** (`done-by`): dishes are delayed to finish at a clock time (a past time means tomorrow, after a confirm)

The setup shows a live "If you start now" preview of each dish's start and
ready time, plus validation problems (a step with no minutes blocks Start).

## Data Model
- **Setup state**: `{ name, steps: [{ action, minutes }] }`
- **Active state**: `{ name, currentStep, done, finishedAt, paused, pauseStartTime, steps: [{ action, fireTime, fired, firedAt, warned, isWait }] }`
- For delayed dishes, a "wait" step (`Start <dish>`) is auto-inserted at the start; it rings like any other step
- Saved dishes: Firestore `users/{userId}/dishes/{dishId}`, synced live via `onSnapshot()`
- An in-progress cook survives a reload via `localStorage` key `cookTimerState`
  (includes per-dish pause and the setup cards, so Stop returns to the same setup)

## Timer Loop
- `setInterval(updateTimers, 500)` drives everything
- Cards keep a fixed order (no re-sorting, so buttons don't move under a finger);
  a sticky strip at the top lists ringing alarms and scrolls to the card on tap
- `renderDishCard()` builds a card's structure/buttons on state changes;
  `updateDishCard()` refreshes only the text each tick
- Color states: waiting (purple) → upcoming → imminent (last 30 s) → fired (red pulse) → done (green)

## Alerts
- 30-second heads-up: the "30-sec warning" sound (skipped for steps under ~35 s)
- Step alarm: the "Step alarm" sound, **repeated every 4 s until Done is tapped**
  (Pause All silences it). Sounds are chosen in setup, saved in localStorage
- Sound needs a user tap: `unlockAudio()` runs on every click/touchend. While the
  AudioContext isn't running during a cook (e.g. after a reload), a "Sound is off"
  banner asks for a tap
- iPhone's silent switch mutes Web Audio; the app tells the user, it can't override it
- Desktop notifications where supported (wrapped in try — Android Chrome throws)
- Wake Lock keeps the screen on; if refused, the page tells the user to set auto-lock to Never

## Step actions
- **Done** (on a ringing step): re-anchors the remaining steps to now, so the next step gets its full time
- **Done early** / **Start now** (before the alarm): confirms, then same as Done
- **Pause** per dish, and **Pause All**. Pause All skips individually paused dishes
  when shifting times (their own Resume covers the overlap)
