// NFL Pick'em: everyone picks the winner of every NFL game each week. Picks lock at kickoff.
// GET  /api/picks?year=2026&week=8&team=4  -> { ready, games, mine, picked, board: { week, season } }
//      (other people's picks for a game are only revealed once that game kicks off)
// POST /api/picks { year, week, team, picks: { gameId: abbr } }  locks those picks in for good (games not yet started only)
// POST /api/picks { action:'reset', year, week, target, token }      app admin wipes one person's picks for that week
import { redis } from '../lib/kv.js';
import { fetchSlate, getJSON, fairML, homeWinProb } from '../lib/week.js';
import { verify, ADMIN_TEAM } from '../lib/auth.js';
import { logAct } from '../lib/activity.js';

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
// Pretend sportsbook: $500 per person per week, split evenly over that week's games, each pick paid
// at the game's closing Vegas moneyline. Lines are saved while a game is upcoming; for games we never
// saw a line for, ESPN's game summary (pick center) still has the closing one.
const BANK = 500;
const profit = (ml, stake) => (!ml ? stake : ml > 0 ? stake * ml / 100 : stake * 100 / -ml);
async function closingLines(run, year, week, games) {
  const key = `ml:${year}:${week}`;
  const [flat] = await run([['HGETALL', key]]);
  const have = readAll(flat), set = [];
  if (have._done && !games) return have;
  games = games || await fetchSlate(year, week, 10 * 60000);
  await Promise.all(games.map(async (g) => {
    if (g.state === 'pre') { const v = g.ml ? { ...g.ml, home: g.home.abbr } : g.hwin != null ? { h: fairML(g.hwin), a: fairML(1 - g.hwin), est: 1, home: g.home.abbr } : null; if (v && JSON.stringify(v) !== JSON.stringify(have[g.id])) { have[g.id] = v; set.push(g.id, JSON.stringify(v)); } return; }
    if (have[g.id]) return;
    try {
      const sm = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${g.id}`, 5000);
      const o = (sm.pickcenter || []).find((x) => x.homeTeamOdds?.moneyLine != null && x.awayTeamOdds?.moneyLine != null);
      const sp = (sm.pickcenter || []).find((x) => x.spread != null);
      const hp = !o && sp ? homeWinProb({ line: Math.abs(Number(sp.spread)), favId: Number(sp.spread) < 0 ? 'H' : Number(sp.spread) > 0 ? 'A' : null }, 'H') : null;
      have[g.id] = o ? { h: Number(o.homeTeamOdds.moneyLine), a: Number(o.awayTeamOdds.moneyLine), home: g.home.abbr }
        : hp != null ? { h: fairML(hp), a: fairML(1 - hp), est: 1, home: g.home.abbr } : { none: true, home: g.home.abbr };
      set.push(g.id, JSON.stringify(have[g.id]));
    } catch { /* try again next time */ }
  }));
  have._n = games.length;
  if (games.length && games.every((g) => g.done) && games.every((g) => have[g.id])) { have._done = 1; set.push('_done', '1'); }
  set.push('_n', String(games.length));
  if (set.length) await run([['HSET', key, ...set], ['EXPIRE', key, 400 * 86400]]);
  return have;
}
// net winnings per person for one week: { team: { m, open } }  (open = money riding on games not decided yet)
export function money(picks, res, lines, games) {
  const n = Number(lines._n) || (games ? games.length : 0) || 16, stake = BANK / n, out = {};
  const sideOf = {}; for (const g of games || []) sideOf[g.id] = g.home.abbr;
  for (const [t, p] of Object.entries(picks)) {
    let m = 0, open = 0;
    for (const [gid, abbr] of Object.entries(p)) {
      const w = res[gid], l = lines[gid] || {};
      if (!w) { open += stake; continue; }
      if (w === 'TIE') continue;
      const home = sideOf[gid] ? abbr === sideOf[gid] : l.home ? abbr === l.home : null;
      const ml = l.none || home == null ? null : home ? l.h : l.a;
      m += w === abbr ? profit(ml, stake) : -stake;
    }
    out[t] = { m: Math.round(m * 100) / 100, open: Math.round(open * 100) / 100 };
  }
  return out;
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
      await logAct(run, req, ADMIN_TEAM, 'admin-reset-picks', `team ${Number(q.target)}, week ${week}`);
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
      const added = Object.keys(mine).length - Object.keys(cur ? JSON.parse(cur) : {}).length;
      if (added > 0) await logAct(run, req, team, 'picks', `locked in ${added} week ${week} pick${added === 1 ? '' : 's'}`);
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
    const linesNow = await closingLines(run, year, week, games);
    const weekMoney = money(all, resNow, linesNow, games);
    for (const t of Object.keys(weekBoard)) Object.assign(weekBoard[t], weekMoney[t] || {});
    // season: every week up to this one that has picks
    const weeks = Array.from({ length: week }, (_, i) => i + 1);
    const flats = await run(weeks.map((w) => ['HGETALL', `pick:${year}:${w}`]));
    const season = {};
    for (let i = 0; i < weeks.length; i++) {
      const p = readAll(flats[i]); if (!Object.keys(p).length) continue;
      const r = weeks[i] === week ? resNow : await results(run, year, weeks[i]);
      const mo = weeks[i] === week ? weekMoney : money(p, r, await closingLines(run, year, weeks[i]), null);
      for (const [t, v] of Object.entries(tally(p, r))) { const s = (season[t] ||= { c: 0, n: 0, wk: 0, m: 0 }); s.c += v.c; s.n += v.n; s.wk++; s.m = Math.round((s.m + ((mo[t] || {}).m || 0)) * 100) / 100; }
    }
    const rows = (o) => Object.entries(o).map(([t, v]) => ({ id: Number(t), ...v, made: count[t] || 0 })).sort((a, b) => b.c - a.c || a.n - b.n);
    const stake = Math.round(100 * BANK / (games.length || 16)) / 100;
    for (const g of games) { const l = linesNow[g.id]; if (!g.ml && l && !l.none) g.ml = { h: l.h, a: l.a, ...(l.est ? { est: 1 } : {}) }; }
    return res.status(200).json({ ready: true, year, week, games, bank: BANK, stake, skipped: skippedN, mine: Number.isInteger(team) ? (all[team] || {}) : {}, picked, made: count,
      board: { week: rows(weekBoard), season: rows(season) } });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Pick'em unavailable (${e.message})` });
  }
}
