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

// questions come from the pregame projections and win odds for that week.
// v2: every option carries the app's own odds (p, %) and a short note (sub); each question has an info line.
export const QV = 2;
const SD_TEAM = 22;
const r1 = (x) => Math.round(x * 10) / 10;
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - q : q; };
const psd = (proj) => Math.max(4, 0.5 * proj); // one player's weekly spread
export function makeQuestions(live) {
  const games = live.games, teams = games.flatMap((g) => [g.h, g.a]);
  const name = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const rnd = rng(live.year * 100 + live.week); const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  // simulate the week a few thousand times for the odds on each answer
  const N = 4000, top = {}, low = {}, close = { n: 0 };
  const stars = teams.flatMap((t) => t.rows.filter((r) => r.state !== 'bye' && r.proj > 0).map((r) => ({ ...r, t: t.id, key: String(r.pid ?? r.name) }))).sort((a, b) => b.proj - a.proj).slice(0, 6);
  const starWin = Object.fromEntries(stars.map((r) => [r.key, 0]));
  const benchOf = (t) => (t.bench || []).filter((r) => r.slot !== 'IR');
  const benchProj = teams.map((t) => ({ id: t.id, proj: benchOf(t).reduce((s, r) => s + r.proj, 0), sd: Math.sqrt(benchOf(t).reduce((s, r) => s + psd(r.proj) ** 2 * (r.proj > 0 ? 1 : 0), 0)) }));
  const benchMax = [];
  for (let i = 0; i < N; i++) {
    const sc = Object.fromEntries(teams.map((t) => [t.id, t.exp + SD_TEAM * gauss()]));
    let hi = teams[0].id, lo = teams[0].id; for (const t of teams) { if (sc[t.id] > sc[hi]) hi = t.id; if (sc[t.id] < sc[lo]) lo = t.id; }
    top[hi] = (top[hi] || 0) + 1; low[lo] = (low[lo] || 0) + 1;
    if (games.some((g) => Math.abs(sc[g.h.id] - sc[g.a.id]) < 5)) close.n++;
    if (stars.length) { let best = null, bv = -1; for (const r of stars) { const v = r.proj + psd(r.proj) * gauss(); if (v > bv) { bv = v; best = r.key; } } starWin[best]++; }
    benchMax.push(Math.max(...benchProj.map((b) => b.proj + b.sd * gauss())));
  }
  const pct = (n) => Math.round(100 * n / N);
  const rank = [...teams].sort((a, b) => b.exp - a.exp);
  const teamOpts = (odds) => rank.map((t) => ({ v: String(t.id), label: t.name, sub: `proj ${r1(t.exp)}`, p: pct(odds[t.id] || 0) }));
  const qs = [
    { id: 'top', kind: 'top', text: 'Who scores the most points this week?', info: `Projected top three: ${rank.slice(0, 3).map((t) => `${t.name} ${r1(t.exp)}`).join(', ')}.`, opts: teamOpts(top) },
    { id: 'low', kind: 'low', text: 'Who scores the fewest points this week?', info: `Projected bottom three: ${rank.slice(-3).reverse().map((t) => `${t.name} ${r1(t.exp)}`).join(', ')}.`, opts: teamOpts(low).reverse() },
  ];
  games.forEach((g, i) => {
    const hp = Math.round(100 * g.hwin), ap = 100 - hp;
    const fav = g.hwin >= 0.5 ? g.h : g.a;
    qs.push({ id: `m${i + 1}`, kind: 'match', h: g.h.id, a: g.a.id, text: `${name[g.a.id]} vs ${name[g.h.id]}: who wins?`,
      info: `Projected ${r1(g.a.exp)} – ${r1(g.h.exp)}. ${name[fav.id]} is the favorite by ${r1(Math.abs(g.h.exp - g.a.exp))}.`,
      opts: [{ v: String(g.a.id), label: g.a.name, sub: `proj ${r1(g.a.exp)}`, p: ap }, { v: String(g.h.id), label: g.h.name, sub: `proj ${r1(g.h.exp)}`, p: hp }] });
  });
  if (stars.length >= 3) {
    qs.push({ id: 'star', kind: 'star', text: 'Which of these players scores the most fantasy points?', info: 'The six highest-projected starters in the league this week.',
      opts: stars.map((r) => ({ v: r.key, label: r.name, sub: `${r.pos} · ${r.nfl} · proj ${r1(r.proj)}`, who: r.t, p: pct(starWin[r.key]) })) });
    // over/under on the top non-QB, non-kicker starter
    const pr = teams.flatMap((t) => t.rows.map((r) => ({ ...r, t: t.id }))).filter((r) => !['QB', 'K', 'D/ST'].includes(r.pos) && r.proj > 0).sort((a, b) => b.proj - a.proj)[0];
    if (pr) {
      const line = Math.floor(pr.proj) + 0.5, po = Math.round(100 * (1 - phi((line - pr.proj) / psd(pr.proj))));
      qs.push({ id: 'pou', kind: 'pou', pid: pr.pid, line, who: pr.t, text: `${pr.name} (${pr.pos}, ${name[pr.t]}): over or under ${line} points?`, info: `ESPN projects ${r1(pr.proj)}. ${pr.nfl} plays this week.`,
        opts: [{ v: 'over', label: `Over ${line}`, p: po }, { v: 'under', label: `Under ${line}`, p: 100 - po }] });
    }
  }
  const closest = [...games].sort((a, b) => Math.abs(a.h.exp - a.a.exp) - Math.abs(b.h.exp - b.a.exp))[0];
  const cp = pct(close.n);
  qs.push({ id: 'close', kind: 'close', text: 'Is any matchup decided by fewer than 5 points?', info: `Closest on paper: ${name[closest.a.id]} vs ${name[closest.h.id]} (projected ${r1(Math.abs(closest.h.exp - closest.a.exp))} apart).`,
    opts: [{ v: 'yes', label: 'Yes, a nail-biter', p: cp }, { v: 'no', label: 'No', p: 100 - cp }] });
  benchMax.sort((a, b) => a - b);
  if (benchProj.some((b) => b.proj > 0)) {
  const bl = Math.floor(benchMax[Math.floor(N / 2)]) + 0.5, bp = pct(benchMax.filter((v) => v > bl).length);
  const deepest = [...benchProj].sort((a, b) => b.proj - a.proj)[0];
  qs.push({ id: 'bench', kind: 'bench', line: bl, text: `Does anyone leave more than ${bl} points on their bench?`, info: `Deepest bench on paper: ${name[deepest.id]} (${r1(deepest.proj)} projected sitting). IR doesn’t count.`,
    opts: [{ v: 'yes', label: `Yes, over ${bl}`, p: bp }, { v: 'no', label: 'No', p: 100 - bp }] });
  }
  for (const q of qs) q.v = QV;
  return qs;
}
export function grade(qs, live) {
  const teams = live.games.flatMap((g) => [g.h, g.a]), pts = Object.fromEntries(teams.map((t) => [t.id, t.pts]));
  const won = new Set(live.games.map((g) => (g.h.pts > g.a.pts ? g.h.id : g.a.id)));
  const ppts = {}; for (const t of teams) for (const r of [...t.rows, ...(t.bench || [])]) ppts[String(r.pid ?? r.name)] = r.pts;
  const res = {};
  for (const q of qs) {
    if (q.kind === 'top') res[q.id] = String(teams.reduce((m, t) => (t.pts > m.pts ? t : m)).id);
    if (q.kind === 'low') res[q.id] = String(teams.reduce((m, t) => (t.pts < m.pts ? t : m)).id);
    if (q.kind === 'match') res[q.id] = String(pts[q.h] >= pts[q.a] ? q.h : q.a);
    if (q.kind === 'star') res[q.id] = q.opts.reduce((m, o) => ((ppts[o.v] || 0) > (ppts[m.v] || 0) ? o : m)).v;
    if (q.kind === 'pou') res[q.id] = (ppts[String(q.pid)] || 0) > q.line ? 'over' : 'under';
    if (q.kind === 'bench') res[q.id] = teams.some((t) => (t.bench || []).filter((r) => r.slot !== 'IR').reduce((s, r) => s + r.pts, 0) > q.line) ? 'yes' : 'no';
    // older question types
    if (q.kind === 'ou') res[q.id] = pts[q.team] > q.line ? 'over' : 'under';
    if (q.kind === 'blow') res[q.id] = pts[q.fav] - pts[q.dog] >= 20 ? 'yes' : 'no';
    if (q.kind === 'upset') res[q.id] = q.dogs.some((d) => won.has(d)) ? 'yes' : 'no';
    if (q.kind === 'close') res[q.id] = live.games.some((g) => Math.abs(g.h.pts - g.a.pts) < 5) ? 'yes' : 'no';
    if (q.kind === 'total') res[q.id] = teams.reduce((s, t) => s + t.pts, 0) > q.line ? 'over' : 'under';
  }
  return res;
}
const score = (ans, res) => { let c = 0, n = 0; for (const [q, a] of Object.entries(ans || {})) { if (res[q] == null) continue; n++; if (res[q] === a) c++; } return { c, n }; };

async function getWeek(run, year, week, locked) {
  const [qRaw, resRaw] = await run([['GET', `pred:${year}:${week}`], ['GET', `predres:${year}:${week}`]]);
  let qs = qRaw ? JSON.parse(qRaw) : null, results = resRaw ? JSON.parse(resRaw) : null;
  const stale = !!qs && !results && !locked && (qs[0] || {}).v !== QV; // older question set, week not locked yet: rebuild it
  if (!qs || !results || stale) {
    const raw = await fetchLive({ year, week });
    if (raw.week !== week) return { qs: qs || [], results }; // a future week: nothing yet
    const live = liveScores(raw, await nflRemaining(raw.year, raw.week));
    if (!qs || stale) {
      qs = makeQuestions(live);
      const [ok] = await run([stale ? ['SET', `pred:${year}:${week}`, JSON.stringify(qs), 'EX', 400 * 86400] : ['SET', `pred:${year}:${week}`, JSON.stringify(qs), 'NX', 'EX', 400 * 86400]]);
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
    const { qs, results } = await getWeek(run, year, week, locked);
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
