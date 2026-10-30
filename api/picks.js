// NFL Pick'em: everyone picks the winner of every NFL game each week. Picks lock at kickoff.
// GET  /api/picks?year=2026&week=8&team=4  -> { ready, games, mine, picked, board: { week, season } }
//      (other people's picks for a game are only revealed once that game kicks off)
// POST /api/picks { year, week, team, picks: { gameId: abbr } }  locks those picks in for good (games not yet started only)
// POST /api/picks { action:'reset', year, week, target, token }      app admin wipes one person's picks for that week
import { redis } from '../lib/kv.js';
import { fetchSlate } from '../lib/week.js';
import { verify, ADMIN_TEAM } from '../lib/auth.js';

const locked = (g) => g.state !== 'pre' || Date.now() >= new Date(g.kickoff).getTime();
const readAll = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) { try { o[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* skip */ } } return o; };

// winners for a past week; saved for good once every game is final
async function results(run, year, week) {
  const key = `nflres:${year}:${week}`;
  const [have] = await run([['GET', key]]);
  if (have) return JSON.parse(have);
  const games = await fetchSlate(year, week, 10 * 60000);
  const res = Object.fromEntries(games.filter((g) => g.winner).map((g) => [g.id, g.winner]));
  if (games.length && games.every((g) => g.done)) await run([['SET', key, JSON.stringify(res), 'EX', 400 * 86400]]);
  return res;
}
function tally(picks, res) { // picks: { team: { gameId: abbr } } -> { team: { c, n } }
  const out = {};
  for (const [t, p] of Object.entries(picks)) {
    let c = 0, n = 0;
    for (const [gid, abbr] of Object.entries(p)) { const w = res[gid]; if (!w || w === 'TIE') continue; n++; if (w === abbr) c++; }
    out[t] = { c, n };
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false });
  try {
    const q = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : (req.query || {});
    const year = Number(q.year), week = Number(q.week), team = Number(q.team);
    if (!Number.isInteger(year) || year < 2020 || !Number.isInteger(week) || week < 1 || week > 18) return res.status(400).json({ error: 'Bad week' });
    const key = `pick:${year}:${week}`;
    let games = await fetchSlate(year, week), skippedN = 0;
    if (req.method === 'POST' && q.action === 'reset') {
      if (!(await verify(run, ADMIN_TEAM, q.token))) return res.status(403).json({ error: 'App admin only', pin: true });
      await run([['HDEL', key, String(Number(q.target))]]);
    } else if (req.method === 'POST') {
      if (!Number.isInteger(team) || team < 1 || team > 99) return res.status(400).json({ error: 'Pick who you are first' });
      games = await fetchSlate(year, week, 15000); // fresh enough to enforce kickoff
      const want = q.picks && typeof q.picks === 'object' ? q.picks : {};
      if (!Object.keys(want).length) return res.status(400).json({ error: 'Pick at least one game first' });
      const [cur] = await run([['HGET', key, String(team)]]);
      const mine = cur ? JSON.parse(cur) : {};
      const skipped = [];
      for (const [gid, abbr] of Object.entries(want)) {
        const g = games.find((x) => x.id === String(gid));
        if (!g || (abbr !== g.home.abbr && abbr !== g.away.abbr)) continue;
        if (mine[g.id]) continue; // already locked in: locked picks never change
        if (locked(g)) { skipped.push(`${g.away.abbr} @ ${g.home.abbr}`); continue; }
        mine[g.id] = abbr;
      }
      skippedN = skipped.length;
      await run([['HSET', key, String(team), JSON.stringify(mine)], ['EXPIRE', key, 400 * 86400]]);
    }
    // this week's picks, other people's hidden until each game locks
    const [flat] = await run([['HGETALL', key]]);
    const all = readAll(flat);
    const lockedIds = new Set(games.filter(locked).map((g) => g.id));
    const picked = {}; // gameId -> { abbr: [teamIds] }  (locked games only)
    for (const [t, p] of Object.entries(all)) for (const [gid, abbr] of Object.entries(p)) {
      if (!lockedIds.has(gid)) continue;
      ((picked[gid] ||= {})[abbr] ||= []).push(Number(t));
    }
    const count = Object.fromEntries(Object.entries(all).map(([t, p]) => [t, Object.keys(p).length]));
    const resNow = Object.fromEntries(games.filter((g) => g.winner).map((g) => [g.id, g.winner]));
    const weekBoard = tally(all, resNow);
    // season: every week up to this one that has picks
    const weeks = Array.from({ length: week }, (_, i) => i + 1);
    const flats = await run(weeks.map((w) => ['HGETALL', `pick:${year}:${w}`]));
    const season = {};
    for (let i = 0; i < weeks.length; i++) {
      const p = readAll(flats[i]); if (!Object.keys(p).length) continue;
      const r = weeks[i] === week ? resNow : await results(run, year, weeks[i]);
      for (const [t, v] of Object.entries(tally(p, r))) { const s = (season[t] ||= { c: 0, n: 0, wk: 0 }); s.c += v.c; s.n += v.n; s.wk++; }
    }
    const rows = (o) => Object.entries(o).map(([t, v]) => ({ id: Number(t), ...v, made: count[t] || 0 })).sort((a, b) => b.c - a.c || a.n - b.n);
    return res.status(200).json({ ready: true, year, week, games, skipped: skippedN, mine: Number.isInteger(team) ? (all[team] || {}) : {}, picked, made: count,
      board: { week: rows(weekBoard), season: rows(season) } });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Pick'em unavailable (${e.message})` });
  }
}
