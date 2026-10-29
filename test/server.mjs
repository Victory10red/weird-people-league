// Local preview: serves the app with /api/league from a saved text dump and a simulated in-progress /api/live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fromTextDump } from './from-text-dump.mjs';
import { analyze } from '../lib/analyze.js';
import { sampleWeek } from './week-sample.mjs';
import { liveScores } from '../lib/live.js';
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
const fakeLB = { 'bk:hard': { 3: { s: 412, at: Date.now() - 864e5 }, 10: { s: 260, at: Date.now() - 3e6 } }, 'hol:week': { 8: { s: 9, at: Date.now() } } };
const lbOut = () => Object.fromEntries(Object.entries(fakeLB).map(([k, v]) => [k, Object.entries(v).map(([id, x]) => ({ id: +id, score: x.s, at: x.at })).sort((a, b) => b.score - a.score)]));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
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
