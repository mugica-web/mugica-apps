# mugica-apps — Project Guide

## What This Is

The family's personal app site. One sign-in page and a dashboard of tiles,
with each app living in its own folder under `apps/`. Sign-in is Google only,
and only allowlisted accounts get past the sign-in page.

Current apps:

| App | Route | Folder | Guide |
|---|---|---|---|
| Cook Timer | `/cook-timer` | `apps/cook_timer/` | `apps/cook_timer/CLAUDE.md` |
| Taboo Jr. | `/taboo-jr` | `apps/taboo_jr/` | `apps/taboo_jr/CLAUDE.md` |
| Hoops Rotation | `/hoops-rotation` | `apps/hoops_rotation/` | `apps/hoops_rotation/CLAUDE.md` |
| Laura's Pies | `/lauras-pies` | `apps/lauras_pies/` | `apps/lauras_pies/CLAUDE.md` |

## Stack

- **Backend**: Python Flask. `app.py` serves the site pages; each app is a
  Flask Blueprint registered from `app.py`
- **Frontend**: Vanilla JS, no bundler
- **Auth + DB**: Firebase (Google sign-in, Firestore). Compat SDK v10.14.1 via CDN
- **CSS**: `static/site.css` for the shared look: an editorial, sports-site
  style in dark mode. Design tokens are CSS variables on `:root` (colours,
  `--serif` Source Serif 4 for headlines, `--sans` Libre Franklin for text,
  `--numeric` Barlow Condensed for clocks). Buttons: `.btn` plus
  `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-text`. Red means
  alarm/stop only. Each app adds its own stylesheet; Taboo Jr. has its own
  look and doesn't load `site.css`
- **Deployment**: Vercel (`vercel.json` routes everything to `app.py`)

## Running Locally (Windows, PowerShell)

```powershell
.venv\Scripts\python.exe app.py
# → http://localhost:5000
```

First time only: `py -m venv .venv; .venv\Scripts\python.exe -m pip install -r requirements.txt`

Requires a `.env` file with `FIREBASE_API_KEY=...`. In production this is set
in the Vercel dashboard.

## File Structure

```
app.py                      — site routes (/, /dashboard) + registers each app
requirements.txt            — Python deps
vercel.json                 — Vercel deployment config
static/site.css             — shared styles: fonts, layout, sign-in, dashboard, .btn
templates/
  login.html                — Google sign-in + Firestore allowlist check
  dashboard.html            — app launcher grid (auth-gated)
  partials/firebase_init.js — Firebase config, included by every page that signs in
apps/
  cook_timer/               — Cook Timer (Blueprint, template, stylesheet)
  taboo_jr/                 — Taboo Jr. (Blueprint, generated game page, deck source)
  hoops_rotation/           — Hoops Rotation (Blueprint, template, engine JS, stylesheet)
  lauras_pies/              — Laura's Pies (Blueprint, single-file game page)
```

## Git Workflow

The owner has standing approval for this: when a change is finished and
tested, commit it on a branch, open a pull request into `main`, and merge it
yourself (merge commit, PR title as the commit title plus `(#N)`). Don't stop
to ask before opening or merging. Merging to `main` deploys to the live site
via Vercel. Say in your reply what was merged. Still ask first for anything
risky or hard to undo (deleting data, Firestore rules, secrets, force-pushes).

## Site Flow

1. `/` — Google sign-in. On success, checks the `allowedEmails` collection in
   Firestore and redirects to `/dashboard`. People without access can request
   it; the request is saved to `accessRequests` and emailed via EmailJS.
2. `/dashboard` — grid of app tiles.
3. Each app at its own route.

## Adding an App

1. Create `apps/<name>/` with an `__init__.py` that defines a Blueprint and
   its route(s). Give it `templates/<name>/` and `static/` folders as needed.
2. Register it in `app.py`.
3. Add a tile to `templates/dashboard.html`.
4. Add a row to the table above and a `CLAUDE.md` in the app's folder.

An app that needs the signed-in user should load `/static/site.css` and
`{% include "partials/firebase_init.js" %}`, and redirect to `/` when
`auth.onAuthStateChanged` reports no user (see Cook Timer). A standalone game
can skip all of that (see Taboo Jr.).

## Firebase Project

Project ID: `cook-timer-69256`. The ID predates the site's name and Firebase
IDs can't be changed; it is the whole site's project.

Firestore collections: `allowedEmails`, `accessRequests`, and per-app data
under `users/{userId}/...` (Cook Timer uses `users/{userId}/dishes/{dishId}`; Hoops Rotation uses
`users/{userId}/hoopsRotation/roster` and `users/{userId}/hoopsGames/{gameId}`).
