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

## Stack

- **Backend**: Python Flask. `app.py` serves the site pages; each app is a
  Flask Blueprint registered from `app.py`
- **Frontend**: Vanilla JS, no bundler
- **Auth + DB**: Firebase (Google sign-in, Firestore). Compat SDK v10.14.1 via CDN
- **CSS**: `static/site.css` for the shared look (dark theme, `#0f0f0f` bg,
  Inter + Playfair Display); each app adds its own stylesheet
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
```

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
under `users/{userId}/...` (Cook Timer uses `users/{userId}/dishes/{dishId}`).
