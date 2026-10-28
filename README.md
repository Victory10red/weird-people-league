# Weird People League HQ

Live scores, win odds, playoff chances, luck, trades, draft grades and league history for the
"Weird people with free time" ESPN fantasy football league (league 961003394).

## How it works

- `api/league.js` pulls the whole season from ESPN's fantasy API and runs the analysis in
  `lib/analyze.js`: all-play records and luck, lineup efficiency, rest-of-season roster strength,
  a 20,000-season playoff simulation, inferred trades, pickups, draft steals and busts, and
  all-time history. Cached for 5 minutes.
- `api/live.js` pulls this week's box scores plus NFL game clocks and estimates live win odds:
  points so far + each starter's projection × the share of his game still to play. Cached 30
  seconds while games are on.
- `index.html`, `app.js`, `style.css` are the page (d3 for charts). Anyone can pick their team;
  the choice is remembered on their device and can be shared with `?team=<id>`.

## ESPN access

The league must be **viewable to the public** (League Manager: LM Tools → League Settings →
Basic Settings → Make League Viewable to Public). If it isn't, add two environment variables in
Vercel (Project → Settings → Environment Variables) with values from your browser's ESPN cookies:
`ESPN_S2` and `SWID`. They act as your ESPN login, so keep them private; they are only used
server-side.

## Deploy

Import this repo in Vercel (Framework preset: **Other**, no build command). Hobby plan is free
for personal, non-commercial use.

## Local preview

`node test/server.mjs <path to a text dump from the Claude refresh kit>` serves the page on
http://localhost:4173 with simulated live scores.
