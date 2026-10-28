import fs from 'node:fs';
import { fromTextDump } from './from-text-dump.mjs';
import { analyze } from '../lib/analyze.js';
const dump = fromTextDump(process.argv[2]);
const t0 = Date.now();
const out = analyze(dump);
const ms = Date.now() - t0;
const py = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const P = Object.fromEntries(py.teams.map((t) => [t.id, t]));
let bad = 0;
for (const t of out.teams) {
  const p = P[t.id];
  const chk = [['pf', t.pf, p.pf, 0.1], ['avg', t.avg, p.avg, 0.1], ['allplay', t.allplay_w, p.allplay_w, 0], ['luck', t.luck, p.luck, 0.06], ['bench', t.bench_lost, p.bench_lost, 0.1], ['ros', t.ros, p.ros_strength, 0.1], ['power', t.power, p.power, 0], ['playoffs', t.playoffs, 100 * p.sim.playoffs, 2.0]];
  for (const [k, a, b, tol] of chk) if (Math.abs(a - b) > tol) { bad++; console.log('MISMATCH', t.name, k, a, b); }
}
console.log('teams checked:', out.teams.length, 'mismatches:', bad, `| analyze ran in ${ms} ms`);
console.log('matchups:', out.matchups.map((m) => `${m.h}v${m.a} ${Math.round(m.hwin * 100)}%`).join(' '));
console.log('trades:', out.trades.map((t) => `wk${t.wk} ${t.a.gets.map((g) => g.name)} <-> ${t.b.gets.map((g) => g.name)}`).join(' | '));
console.log('champs:', out.champs.map((c) => `${c.year} ${c.owner} ${c.final} over ${c.runner_up}`).join(' | '));
console.log('top pickup:', out.pickups[0].name, out.pickups[0].pts, '| draft rows', out.draft.length, '| h2h', out.h2h.length, '| sched', out.sched.length);
console.log('Zynbabwe need:', JSON.stringify(out.teams.find((t) => t.id === 4).need), out.teams.find((t) => t.id === 4).targets.map((x) => x.name).join(', '));
console.log('payload KB:', Math.round(JSON.stringify(out).length / 1024));
