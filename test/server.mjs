// Local preview: serves the app with /api/league from a saved text dump and a simulated in-progress /api/live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fromTextDump } from './from-text-dump.mjs';
import { analyze } from '../lib/analyze.js';
import { sampleWeek } from './week-sample.mjs';
import { liveScores } from '../lib/live.js';
import { makeQuestions } from '../api/club.js';
import { byes } from './byes.mjs';
const dump = fromTextDump(process.argv[2]);
dump.byes ||= byes;
import { oprk } from './oprk.mjs';
dump.oprk ||= oprk;
import { proSched } from './prosched.mjs';
dump.proSched ||= proSched;
const league = { ...analyze(dump, { week: sampleWeek }), updated: new Date().toISOString() };
// simulated live week: current-week rows, with games at different stages
const wk = dump.status.week;
const names = Object.fromEntries(dump.teams.map((t) => [t.id, t.name]));
const games = dump.sched.filter((m) => m.wk === wk && m.a != null).map((m) => {
  const side = (tid) => ({ id: tid, name: names[tid], players: dump.roster.filter((r) => r.tid === tid).map((r) => ({ pid: r.pid, name: dump.players[r.pid]?.name || String(r.pid), pos: dump.players[r.pid]?.pos || 0, pro: dump.players[r.pid]?.pro || 0, slot: r.slot, proj: r.proj || 0, act: 0 })) });
  return { h: side(m.h), a: side(m.a), hp: 0, ap: 0 };
});
const clocks = {};
for (let pro = 1; pro <= 34; pro++) clocks[pro] = pro % 3 === 0 ? { rem: 0, state: 'post', detail: 'Final' } : pro % 3 === 1 ? { rem: 0.45, state: 'in', detail: '3rd 6:12' } : { rem: 1, state: 'pre', detail: 'Sun 12:00 PM' };
for (const g of games) for (const s of [g.h, g.a]) for (const p of s.players) { const c = clocks[p.pro]; if (c) p.act = Math.round(p.proj * (1 - c.rem) * (0.6 + ((p.name.length * 37) % 80) / 100) * 10) / 10; }
const live = liveScores({ year: dump.status.year, week: wk, current: wk, games }, clocks);
const fakeLB = { 'bk:hard': { 3: { s: 412, at: Date.now() - 864e5 }, 10: { s: 260, at: Date.now() - 3e6 } } };
const lbOut = () => Object.fromEntries(Object.entries(fakeLB).map(([k, v]) => [k, Object.entries(v).map(([id, x]) => ({ id: +id, score: x.s, at: x.at })).sort((a, b) => b.score - a.score)]));
const fakePins = { 3: '1111' };
const fakeTalk = [{ id: 'z', t: 0, bot: true, text: '🚨 WEEK 7 BASEMENT REPORT: Wes put up 89.4, dead last in the league. Justin beat him by 61.8. Now 3-4.', gif: null, at: Date.now() - 600000, re: { '😂': [3, 8] } }, { id: 'a', t: 3, text: 'Trevor you are 2-5 and it shows. Absolute clown shit.', gif: null, at: Date.now() - 3600000, re: { '😂': [8, 10], '🔥': [3] } }, { id: 'b', t: 10, text: 'Somebody check on Carlos', gif: null, at: Date.now() - 7200000, re: {} }];
const now0 = Date.now(), mn = 60000;
const fakeAct = [
  { at: now0 - 2 * mn, t: 3, a: 'open', d: 'home-screen app', dev: 'iPhone' },
  { at: now0 - 5 * mn, t: 0, a: 'post-anon', d: 'Somebody in this league peed in a barber chair.', dev: 'iPhone' },
  { at: now0 - 9 * mn, t: 10, a: 'picks', d: 'locked in 9 week 8 picks', dev: 'Android' },
  { at: now0 - 40 * mn, t: 8, a: 'poop', d: '', dev: 'iPhone' },
  { at: now0 - 70 * mn, t: 1, a: 'open', d: 'browser', dev: 'Windows' },
  { at: now0 - 26 * 60 * mn, t: 12, a: 'game', d: 'Breakaway hard: 640 yds (new best)', dev: 'iPhone' },
  { at: now0 - 27 * 60 * mn, t: 7, a: 'react', d: '😂 on post', dev: 'Android' },
];
const fakeSeen = { 3: { last: Date.now() - 5400000, visits: 4 }, 7: { last: Date.now() - 2 * 86400000, visits: 1 } };
const H = 3600000; const fakePoop = [[8, 0.4], [3, 1.2], [10, 2.5], [8, 5], [1, 9], [8, 26], [12, 30], [3, 50], [6, 75]].map(([t, h]) => ({ t, at: Date.now() - h * H }));
// pick'em: this week's slate from the saved NFL list; the first 3 games final, the next 2 in progress
const NAMES = { GB: 'Packers', CAR: 'Panthers', KC: 'Chiefs', BUF: 'Bills', DAL: 'Cowboys', PHI: 'Eagles', SF: '49ers', DET: 'Lions', MIA: 'Dolphins', NYJ: 'Jets' };
const slate = (league.nfl || []).map((g, i) => {
  const st = i < 3 ? 'post' : i < 5 ? 'in' : 'pre';
  const hs = st === 'pre' ? null : 10 + ((i * 7) % 21), as = st === 'pre' ? null : 13 + ((i * 11) % 17);
  const kick = new Date(Date.now() + (st === 'pre' ? (i - 4) * 3 * 3600000 : -3 * 3600000)).toISOString();
  const side = (x, sc, w) => ({ abbr: x.abbr, name: NAMES[x.abbr] || x.abbr, score: sc, winner: w, rec: `${3 + ((i * 5 + x.abbr.length) % 5)}-${2 + (i % 4)}` });
  const done = st === 'post';
  return { id: String(g.id), kickoff: kick, state: st, status: st === 'post' ? 'Final' : st === 'in' ? 'Q3 4:12' : '', done,
    home: side(g.home, hs, done && hs > as), away: side(g.away, as, done && as > hs), fav: g.odds && g.odds.favId === g.homeId ? g.home.abbr : g.away.abbr, line: g.odds ? g.odds.line : null, total: g.odds ? g.odds.total : null, hwin: g.odds ? (g.odds.favId === g.homeId ? 0.5 + g.odds.line / 30 : 0.5 - g.odds.line / 30) : null, venue: 'Somewhere Stadium', ml: g.odds ? (g.odds.favId === g.homeId ? { h: -150 - i * 20, a: 130 + i * 18 } : { h: 125 + i * 15, a: -145 - i * 15 }) : null,
    winner: done ? (hs > as ? g.home.abbr : g.away.abbr) : null };
});
const fakePicks = {};
const fakePred = { qs: null, ans: {} };
slate.slice(0, 5).forEach((g, i) => { for (const t of [3, 8, 10, 6, 1]) (fakePicks[t] ||= {})[g.id] = (t + i) % 2 ? g.home.abbr : g.away.abbr; });
const picksOut = (team) => {
  const locked = new Set(slate.filter((g) => g.state !== 'pre').map((g) => g.id)); const picked = {};
  for (const [t, p] of Object.entries(fakePicks)) for (const [gid, ab] of Object.entries(p)) if (locked.has(gid)) ((picked[gid] ||= {})[ab] ||= []).push(+t);
  const res = Object.fromEntries(slate.filter((g) => g.winner).map((g) => [g.id, g.winner]));
  const rows = Object.entries(fakePicks).map(([t, p]) => { let c = 0, n = 0; for (const [gid, ab] of Object.entries(p)) if (res[gid]) { n++; if (res[gid] === ab) c++; } return { id: +t, c, n, made: Object.keys(p).length, m: Math.round((c * 30 - (n - c) * 31.25) * 100) / 100, open: 31.25 * (Object.keys(p).length - n) }; }).sort((a, b) => b.c - a.c || a.n - b.n);
  return { ready: true, year: 2026, week: wk, games: slate, bank: 500, stake: Math.round(50000 / slate.length) / 100, mine: fakePicks[team] || {}, picked, made: Object.fromEntries(Object.entries(fakePicks).map(([t, p]) => [t, Object.keys(p).length])), board: { week: rows, season: rows.map((r) => ({ ...r, c: r.c + 20, n: r.n + 40, wk: 4, m: r.m + 87.5 })) } };
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const fakeTrophy = { 2025: { caption: 'Hoisting it at the draft party', last: 'Edwin', punishment: '24 hours at a Waffle House' } };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/club' && u.searchParams.get('k') === 'trophy' || (u.pathname === '/api/club' && req.method === 'POST' && req.headers['x-k'] === 'trophy')) {
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ready: true, items: fakeTrophy }));
  }
  if (u.pathname === '/api/club') {
    res.setHeader('content-type', 'application/json');
    fakePred.qs ||= makeQuestions(live);
    const out = (team) => ({ status: Object.fromEntries(Object.entries(fakePred.ans).map(([k, v]) => [k, { n: Object.keys(v).length, at: (fakePred.lk || {})[k] || null }]).concat([['7', { n: 11, at: Date.now() - 3600000 }], ['3', { n: 4, at: null }]])), total: fakePred.qs.length, lockedAt: (fakePred.lk || {})[team] || null, ready: true, week: live.week, locksAt: new Date(Date.now() + 3 * 86400000).toISOString(), locked: false, qs: fakePred.qs, results: null, mine: fakePred.ans[team] || {}, made: Object.keys(fakePred.ans).length, board: { week: [], season: [{ id: 3, c: 9, n: 14, wk: 2 }, { id: 4, c: 7, n: 14, wk: 2 }] } });
    if (req.method === 'POST') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { const b = JSON.parse(body || '{}'); if (b.k === 'trophy') { const it = (fakeTrophy[b.year] ||= {}); for (const f of ['caption', 'last', 'punishment', 'photo']) if (f in b) { if (b[f]) it[f] = b[f]; else delete it[f]; } return res.end(JSON.stringify({ ok: true, items: fakeTrophy })); } if (b.action === 'lock') { (fakePred.lk ||= {})[b.team] = Date.now(); } else (fakePred.ans[b.team] ||= {})[b.q] = b.a; res.end(JSON.stringify(out(b.team))); }); return; }
    return res.end(JSON.stringify(out(Number(u.searchParams.get('team')))));
  }
  if (u.pathname === '/api/push') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ready: true, key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' })); }
  if (u.pathname === '/api/picks') {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const b = JSON.parse(body || '{}'); if (b.action === 'reset') { delete fakePicks[b.target]; return res.end(JSON.stringify(picksOut(b.team))); }
      const m = (fakePicks[b.team] ||= {}); let sk = 0;
      for (const [gid, ab] of Object.entries(b.picks || {})) { const g = slate.find((x) => x.id === gid); if (!g || m[gid]) continue; if (g.state !== 'pre') { sk++; continue; } m[gid] = ab; }
      res.end(JSON.stringify({ ...picksOut(b.team), skipped: sk })); }); return; }
    return res.end(JSON.stringify(picksOut(Number(u.searchParams.get('team')))));
  }
  if (u.pathname === '/api/talk') {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const b = JSON.parse(body || '{}');
      let posted = null; if (b.action === 'post') { posted = String(Date.now()); const par = b.re_to ? fakeTalk.find((x) => x.id === String(b.re_to)) : null; fakeTalk.unshift({ id: posted, t: b.team, text: b.text || '', gif: b.gif || null, at: Date.now(), re: {}, ...(b.anon ? { anon: true } : {}), ...(par ? { p: par.p || par.id } : {}) }); }
      if (b.action === 'react') { const m = fakeTalk.find((x) => x.id === b.id); if (m) { const a = (m.re[b.emoji] ||= []); const i = a.indexOf(b.team); if (i >= 0) a.splice(i, 1); else a.push(b.team); } }
      if (b.action === 'delete') { const i = fakeTalk.findIndex((x) => x.id === b.id); if (i >= 0 && fakeTalk[i].t === b.team) { const id = fakeTalk[i].id; fakeTalk.splice(i, 1); for (let k = fakeTalk.length - 1; k >= 0; k--) if (fakeTalk[k].p === id) fakeTalk.splice(k, 1); } }
      res.end(JSON.stringify({ ready: true, msgs: fakeTalk.map((m) => (m.anon ? { ...m, t: 0 } : m)), posted })); }); return; }
    return res.end(JSON.stringify({ ready: true, msgs: fakeTalk.map((m) => (m.anon ? { ...m, t: 0 } : m)) }));
  }
  if (u.pathname === '/api/seen') {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { const b = JSON.parse(body || '{}'); const r = (fakeSeen[b.team] ||= { visits: 0 }); r.visits++; r.last = Date.now(); fakeAct.unshift({ at: Date.now(), t: b.team, a: 'open', d: b.app ? 'home-screen app' : 'browser', dev: 'Mac' }); res.end('{"ok":true}'); }); return; }
    return res.end(JSON.stringify({ ready: true, rows: Object.entries(fakeSeen).map(([id, r]) => ({ id: +id, ...r, pin: !!fakePins[id] })).concat(Object.keys(fakePins).filter((k) => !fakeSeen[k]).map((k) => ({ id: +k, last: null, visits: 0, pin: true }))), log: fakeAct }));
  }
  if (u.pathname === '/api/pin') {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
        const b = JSON.parse(body || '{}');
        if (b.action === 'reset') { delete fakePins[b.target]; return res.end(JSON.stringify({ ok: true })); }
        if (!fakePins[b.team]) { fakePins[b.team] = b.pin; return res.end(JSON.stringify({ ok: true, created: true, token: 'tok' + b.team })); }
        if (fakePins[b.team] !== b.pin) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'Wrong PIN' })); }
        res.end(JSON.stringify({ ok: true, token: 'tok' + b.team }));
      }); return;
    }
    return res.end(JSON.stringify({ ready: true, has: !!fakePins[u.searchParams.get('team')] }));
  }
  if (u.pathname === '/api/poop') {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
        const b = JSON.parse(body || '{}');
        if (b.action === 'undo') { const i = fakePoop.findIndex((e) => e.t === b.team); if (i >= 0) fakePoop.splice(i, 1); }
        else fakePoop.unshift({ t: b.team, at: Date.now() });
        res.end(JSON.stringify({ ready: true, log: fakePoop }));
      }); return;
    }
    return res.end(JSON.stringify({ ready: true, log: fakePoop }));
  }
  if (u.pathname === '/api/scores') {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
        const b = JSON.parse(body || '{}'); const k = `${b.game}:${b.level}`; const bd = (fakeLB[k] ||= {});
        if (b.action === 'remove') { delete bd[b.team]; return res.end(JSON.stringify({ ready: true, boards: lbOut() })); }
        if (!bd[b.team] || b.score > bd[b.team].s) bd[b.team] = { s: b.score, at: Date.now() };
        res.end(JSON.stringify({ ready: true, boards: lbOut() }));
      }); return;
    }
    return res.end(JSON.stringify({ ready: true, boards: lbOut() }));
  }
  if (u.pathname === '/api/league') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(league)); }
  if (u.pathname === '/api/live' && u.searchParams.get('series')) {
    res.setHeader('content-type', 'application/json');
    const series = {}; const t0 = Date.now() - 5 * 3600000;
    for (const g of live.games) {
      let p = 0.5; const arr = [];
      for (let i = 0; i <= 60; i++) {
        const seed = Math.sin((g.h.id * 31 + g.a.id * 7 + i) * 12.9898) * 43758.5453; const r = seed - Math.floor(seed);
        p = Math.min(0.97, Math.max(0.03, p + (r - 0.5) * 0.09));
        const pt = [t0 + i * 5 * 60000, Math.round(p * 1000) / 1000, Math.round(i * 1.4 * 10) / 10, Math.round(i * 1.2 * 10) / 10];
        if (i === 18) { p = Math.min(0.97, p + 0.16); pt[1] = Math.round(p * 1000) / 1000; pt.push(['H:Joe Burrow +8.6']); }
        if (i === 41) { p = Math.max(0.03, p - 0.2); pt[1] = Math.round(p * 1000) / 1000; pt.push(['A:Kyren Williams +9.4']); }
        arr.push(pt);
      }
      series[g.h.id + '-' + g.a.id] = arr;
    }
    return res.end(JSON.stringify({ series }));
  }
  if (u.pathname === '/api/live') {
    res.setHeader('content-type', 'application/json');
    const w = Number(u.searchParams.get('week'));
    if (!w || w >= wk) return res.end(JSON.stringify(live));
    // finished week from the saved weekly rows
    const pw = dump.sched.filter((m) => m.wk === w && m.a != null).map((m) => {
      const side = (tid) => ({ id: tid, name: names[tid], players: dump.rows.filter((r) => r.wk === w && r.tid === tid).map((r) => ({ pid: r.pid, name: dump.players[r.pid]?.name || String(r.pid), pos: dump.players[r.pid]?.pos || 0, pro: dump.players[r.pid]?.pro || 0, slot: r.slot, proj: r.proj || 0, act: r.act || 0 })) });
      return { h: side(m.h), a: side(m.a), hp: m.hp ?? 0, ap: m.ap ?? 0 };
    });
    const done = {}; for (let pro = 1; pro <= 34; pro++) done[pro] = { rem: 0, state: 'post', detail: 'Final' };
    return res.end(JSON.stringify(liveScores({ year: dump.status.year, week: w, current: wk, games: pw }, done)));
  }
  const f = path.join(process.cwd(), u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(process.cwd()) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(4173, () => console.log('preview on http://localhost:4173'));
