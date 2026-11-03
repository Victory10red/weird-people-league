// League extras that need shared storage: weekly Predictions and the Trophy case.
// GET  /api/club?k=trophy                    -> { ready, items: { year: { caption, last, punishment, photo } } }
// POST /api/club { k:'trophy', year, token, caption?, last?, punishment?, photo? (data URL, or '' to remove) }  app admin only
// GET  /api/club?k=pred&year=2026&week=8&team=4 -> { ready, week, locksAt, locked, qs, mine, results?, board: { week, season } }
// POST /api/club { k:'pred', year, week, team, q, a }  -> answer one question (changeable until the week's first kickoff)
import { redis } from '../lib/kv.js';
import { fetchLive, nflRemaining } from '../lib/espn.js';
import { liveScores } from '../lib/live.js';
import { fetchSlate } from '../lib/week.js';
import { logAct } from '../lib/activity.js';
import { verify, ADMIN_TEAM } from '../lib/auth.js';

const half = (x) => Math.floor(x) + 0.5;
const readHash = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) { try { o[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* skip */ } } return o; };

// questions come from the pregame projections and win odds for that week
export function makeQuestions(live) {
  const games = live.games, teams = games.flatMap((g) => [g.h, g.a]);
  const name = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const fav = [...games].map((g) => ({ g, p: Math.max(g.hwin, 1 - g.hwin) })).sort((a, b) => b.p - a.p)[0];
  const favT = fav.g.hwin >= 0.5 ? fav.g.h : fav.g.a, dogT = fav.g.hwin >= 0.5 ? fav.g.a : fav.g.h;
  const dogs = games.map((g) => (g.hwin < 0.35 ? g.h.id : g.hwin > 0.65 ? g.a.id : null)).filter(Boolean);
  const ouT = [...teams].sort((a, b) => Math.abs(a.exp - 125) - Math.abs(b.exp - 125))[live.week % 3];
  const total = half(teams.reduce((s, t) => s + t.exp, 0));
  const pickOne = teams.map((t) => ({ v: String(t.id), label: t.name }));
  const qs = [
    { id: 'top', kind: 'top', text: 'Who scores the most points this week?', opts: pickOne },
    { id: 'low', kind: 'low', text: 'Who scores the fewest points this week?', opts: pickOne },
    { id: 'ou', kind: 'ou', team: ouT.id, line: half(ouT.exp), text: `${name[ouT.id]}: over or under ${half(ouT.exp)} points?`, opts: [{ v: 'over', label: `Over ${half(ouT.exp)}` }, { v: 'under', label: `Under ${half(ouT.exp)}` }] },
    { id: 'blow', kind: 'blow', fav: favT.id, dog: dogT.id, text: `Biggest favorite ${name[favT.id]} (${Math.round(100 * fav.p)}%) beats ${name[dogT.id]} by 20 or more?`, opts: [{ v: 'yes', label: 'Yes, blowout' }, { v: 'no', label: 'No' }] },
    { id: 'upset', kind: 'upset', dogs, text: dogs.length ? `Does any big underdog (under 35% to win) pull off the upset?` : 'Does any underdog win this week?', opts: [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }] },
    { id: 'close', kind: 'close', text: 'Is any matchup decided by fewer than 5 points?', opts: [{ v: 'yes', label: 'Yes, a nail-biter' }, { v: 'no', label: 'No' }] },
    { id: 'total', kind: 'total', line: total, text: `All ten teams combined: over or under ${total} points?`, opts: [{ v: 'over', label: `Over ${total}` }, { v: 'under', label: `Under ${total}` }] },
  ];
  // underdogs when nothing is under 35%: the lower side of every game
  if (!dogs.length) qs[4].dogs = games.map((g) => (g.hwin < 0.5 ? g.h.id : g.a.id));
  return qs;
}
export function grade(qs, live) {
  const teams = live.games.flatMap((g) => [g.h, g.a]), pts = Object.fromEntries(teams.map((t) => [t.id, t.pts]));
  const won = new Set(live.games.map((g) => (g.h.pts > g.a.pts ? g.h.id : g.a.id)));
  const res = {};
  for (const q of qs) {
    if (q.kind === 'top') res[q.id] = String(teams.reduce((m, t) => (t.pts > m.pts ? t : m)).id);
    if (q.kind === 'low') res[q.id] = String(teams.reduce((m, t) => (t.pts < m.pts ? t : m)).id);
    if (q.kind === 'ou') res[q.id] = pts[q.team] > q.line ? 'over' : 'under';
    if (q.kind === 'blow') res[q.id] = pts[q.fav] - pts[q.dog] >= 20 ? 'yes' : 'no';
    if (q.kind === 'upset') res[q.id] = q.dogs.some((d) => won.has(d)) ? 'yes' : 'no';
    if (q.kind === 'close') res[q.id] = live.games.some((g) => Math.abs(g.h.pts - g.a.pts) < 5) ? 'yes' : 'no';
    if (q.kind === 'total') res[q.id] = teams.reduce((s, t) => s + t.pts, 0) > q.line ? 'over' : 'under';
  }
  return res;
}
const score = (ans, res) => { let c = 0, n = 0; for (const [q, a] of Object.entries(ans || {})) { if (res[q] == null) continue; n++; if (res[q] === a) c++; } return { c, n }; };

async function getWeek(run, year, week) {
  const [qRaw, resRaw] = await run([['GET', `pred:${year}:${week}`], ['GET', `predres:${year}:${week}`]]);
  let qs = qRaw ? JSON.parse(qRaw) : null, results = resRaw ? JSON.parse(resRaw) : null;
  if (!qs || !results) {
    const raw = await fetchLive({ year, week });
    if (raw.week !== week) return { qs: qs || [], results }; // a future week: nothing yet
    const live = liveScores(raw, await nflRemaining(raw.year, raw.week));
    if (!qs) {
      qs = makeQuestions(live);
      const [ok] = await run([['SET', `pred:${year}:${week}`, JSON.stringify(qs), 'NX', 'EX', 400 * 86400]]);
      if (!ok) { const [again] = await run([['GET', `pred:${year}:${week}`]]); qs = JSON.parse(again); }
    }
    if (!results && week < raw.current) { results = grade(qs, live); await run([['SET', `predres:${year}:${week}`, JSON.stringify(results), 'EX', 400 * 86400]]); }
  }
  return { qs, results };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false });
  try {
    const q = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : (req.query || {});
    if (q.k === 'trophy') {
      if (req.method === 'POST') {
        if (!(await verify(run, ADMIN_TEAM, q.token))) return res.status(403).json({ error: 'App admin only', pin: true });
        const year = Number(q.year);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'Bad year' });
        const [cur] = await run([['HGET', 'trophy', String(year)]]);
        const item = cur ? JSON.parse(cur) : {};
        for (const k of ['caption', 'last', 'punishment']) if (q[k] != null) item[k] = String(q[k]).slice(0, 300);
        if (q.photo != null) {
          if (q.photo === '') delete item.photo;
          else if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(q.photo) && q.photo.length < 900000) item.photo = q.photo;
          else return res.status(400).json({ error: 'That photo is too big or not an image.' });
        }
        await run([['HSET', 'trophy', String(year), JSON.stringify(item)]]);
        await logAct(run, req, ADMIN_TEAM, 'trophy', `${year}${q.photo ? ' photo' : ''}`);
      }
      const [flat] = await run([['HGETALL', 'trophy']]);
      res.setHeader('Cache-Control', req.method === 'POST' ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=600');
      return res.status(200).json({ ready: true, items: readHash(flat) });
    }
    if (q.k !== 'pred') return res.status(400).json({ error: 'Unknown' });
    const year = Number(q.year), week = Number(q.week), team = Number(q.team);
    if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 18) return res.status(400).json({ error: 'Bad week' });
    const slate = await fetchSlate(year, week).catch(() => []);
    const locksAt = slate.length ? slate.map((g) => g.kickoff).sort()[0] : null;
    const locked = !!locksAt && Date.now() >= new Date(locksAt).getTime();
    const { qs, results } = await getWeek(run, year, week);
    const key = `predans:${year}:${week}`;
    if (req.method === 'POST') {
      if (!Number.isInteger(team) || team < 1 || team > 99) return res.status(400).json({ error: 'Pick who you are first' });
      if (locked) return res.status(409).json({ error: 'Predictions locked at the first kickoff of the week.' });
      const qq = qs.find((x) => x.id === q.q);
      if (!qq || !qq.opts.some((o) => o.v === q.a)) return res.status(400).json({ error: 'Pick one of the options' });
      const [cur] = await run([['HGET', key, String(team)]]);
      const mine = cur ? JSON.parse(cur) : {}; const was = Object.keys(mine).length;
      mine[q.q] = q.a;
      await run([['HSET', key, String(team), JSON.stringify(mine)], ['EXPIRE', key, 400 * 86400]]);
      if (!was) await logAct(run, req, team, 'predict', `week ${week} predictions`);
    }
    const [flat] = await run([['HGETALL', key]]);
    const all = readHash(flat);
    // everyone's answers stay hidden until the lock
    const weekBoard = results ? Object.entries(all).map(([t, a]) => ({ id: Number(t), ...score(a, results) })).sort((a, b) => b.c - a.c) : [];
    const season = {};
    const weeks = Array.from({ length: week }, (_, i) => i + 1);
    const flats = await run(weeks.flatMap((w) => [['HGETALL', `predans:${year}:${w}`], ['GET', `predres:${year}:${w}`]]));
    for (let i = 0; i < weeks.length; i++) {
      const ans = readHash(flats[2 * i]); const rr = flats[2 * i + 1] ? JSON.parse(flats[2 * i + 1]) : null; if (!rr) continue;
      for (const [t, a] of Object.entries(ans)) { const s = score(a, rr), x = (season[t] ||= { c: 0, n: 0, wk: 0 }); x.c += s.c; x.n += s.n; x.wk++; }
    }
    return res.status(200).json({ ready: true, week, locksAt, locked, qs, results, mine: Number.isInteger(team) ? all[team] || {} : {},
      picks: locked ? all : undefined, made: Object.keys(all).length,
      board: { week: weekBoard, season: Object.entries(season).map(([t, v]) => ({ id: Number(t), ...v })).sort((a, b) => b.c - a.c || a.n - b.n) } });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Predictions unavailable (${e.message})` });
  }
}
