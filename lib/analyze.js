// League analytics: standings, all-play luck, lineup efficiency, rest-of-season strength,
// playoff simulation, trades, pickups, draft grades and league history.
// Input is the normalized "dump" produced by lib/espn.js; output is plain JSON for the page.

import { extras } from './extras.js';

export const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
export const PRO = { 0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
export const STARTER_SLOTS = new Set([0, 2, 4, 6, 16, 17, 23]);
export const SLOT_NAME = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'Bench', 21: 'IR' };
const SLOTPOS = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K' };

export const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const pstdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const firstName = (s) => { const f = (s || '').trim().split(/\s+/)[0] || ''; return f === f.toUpperCase() || f === f.toLowerCase() ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : f; };

function rng(seed) { // mulberry32 + Box-Muller
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let spare = null;
  return (m, sd) => {
    if (spare !== null) { const v = spare; spare = null; return m + sd * v; }
    let x, y, s;
    do { x = 2 * u() - 1; y = 2 * u() - 1; s = x * x + y * y; } while (s >= 1 || s === 0);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    spare = y * f;
    return m + sd * x * f;
  };
}

export function optimal(entries, posOf) {
  // entries: [pid, value]; lineup QB, RB×2, WR×2, TE, FLEX (RB/WR/TE), D/ST, K
  const by = {};
  for (const [pid, v] of entries) (by[posOf(pid)] ||= []).push([v, pid]);
  for (const k in by) by[k].sort((a, b) => b[0] - a[0]);
  let total = 0; const chosen = [];
  const take = (p, n) => { const got = (by[p] || []).splice(0, n); for (const [v, pid] of got) { total += v; chosen.push(pid); } };
  take('QB', 1); take('RB', 2); take('WR', 2); take('TE', 1);
  const flex = [...(by.RB || []).slice(0, 1), ...(by.WR || []).slice(0, 1), ...(by.TE || []).slice(0, 1)].sort((a, b) => b[0] - a[0]).slice(0, 1);
  for (const [v, pid] of flex) { total += v; chosen.push(pid); }
  take('D/ST', 1); take('K', 1);
  return { total, chosen };
}

export function analyze(dump, { sims = 20000, week = null } = {}) {
  const { status, settings } = dump;
  const CUR = status.week, REG = settings.regWeeks, PO = settings.playoffTeams;

  // players
  const players = {};
  for (const [id, p] of Object.entries(dump.players)) players[id] = { name: p.name, pos: POS[p.pos] || '?', team: PRO[p.pro] || '?', proId: p.pro };
  for (const f of dump.fa) if (!players[f.id]) players[f.id] = { name: f.name, pos: POS[f.pos] || '?', team: PRO[f.pro] || '?', proId: f.pro };
  const posOf = (pid) => (players[pid] ? players[pid].pos : '?');
  const pname = (pid) => (players[pid] ? players[pid].name : String(pid));

  // teams
  const teams = {};
  for (const t of dump.teams) teams[t.id] = { ...t, owner: (t.owner || '').trim() };
  const TIDS = Object.keys(teams).map(Number).sort((a, b) => a - b);
  const tname = (id) => (teams[id] ? teams[id].name : '?');

  // schedule
  const scores = {}, opp = {};
  for (const m of dump.sched) {
    if (m.a == null) continue;
    (opp[m.wk] ||= {})[m.h] = m.a; opp[m.wk][m.a] = m.h;
    if (m.win !== 'UNDECIDED') { (scores[m.wk] ||= {})[m.h] = m.hp; scores[m.wk][m.a] = m.ap; }
  }
  const DONE = Object.keys(scores).map(Number).filter((w) => w <= REG && TIDS.every((t) => scores[w][t] != null)).sort((a, b) => a - b);

  // weekly rows
  const byTW = {};
  for (const r of dump.rows) (byTW[r.tid + '-' + r.wk] ||= []).push(r);
  const weekly = {};
  for (const t of TIDS) {
    weekly[t] = {};
    for (const w of DONE) {
      const ents = byTW[t + '-' + w] || [];
      const proj = ents.filter((e) => STARTER_SLOTS.has(e.slot)).reduce((s, e) => s + (e.proj || 0), 0);
      const opt = optimal(ents.filter((e) => e.slot !== 21).map((e) => [e.pid, e.act || 0]), posOf).total;
      const pts = scores[w][t];
      weekly[t][w] = { pts, proj: r2(proj), opt: r2(Math.max(opt, pts)), opp: opp[w][t], opp_pts: scores[w][opp[w][t]] };
    }
  }
  const allplay = {}, wkRank = {};
  for (const w of DONE) {
    const order = [...TIDS].sort((a, b) => scores[w][b] - scores[w][a]);
    wkRank[w] = {}; order.forEach((t, i) => { wkRank[w][t] = i + 1; });
  }
  for (const t of TIDS) {
    let w = 0, l = 0;
    for (const wk of DONE) for (const o of TIDS) { if (o === t) continue; if (scores[wk][t] > scores[wk][o]) w++; else if (scores[wk][t] < scores[wk][o]) l++; }
    allplay[t] = [w, l];
  }
  const resid = [];
  for (const t of TIDS) for (const w of DONE) resid.push(weekly[t][w].pts - weekly[t][w].proj);
  // Team scores in this league miss their projection by ~22 pts (1 SD), and projected favorites have won
  // barely half their games, so odds use a wider, more honest spread than the raw miss rate.
  const SD_MEASURED = DONE.length ? pstdev(resid) : 25;
  const SD = Math.max(30, SD_MEASURED);
  const leagueAvg = DONE.length ? mean(TIDS.flatMap((t) => DONE.map((w) => scores[w][t]))) : 120;

  // current rosters
  const roster = {};
  for (const e of dump.roster) (roster[e.tid] ||= []).push(e);
  const seasonPts = {}, rosOf = {};
  for (const t in roster) for (const e of roster[t]) { seasonPts[e.pid] = e.season || 0; rosOf[e.pid] = e.ros || 0; }
  for (const f of dump.fa) { if (seasonPts[f.id] == null) seasonPts[f.id] = f.season || 0; if (rosOf[f.id] == null) rosOf[f.id] = f.ros || 0; }
  const tmp = {}, seen = {};
  for (const r of dump.rows) if (DONE.includes(r.wk)) { const k = r.pid + '-' + r.wk; if (!seen[k]) { seen[k] = 1; tmp[r.pid] = (tmp[r.pid] || 0) + (r.act || 0); } }
  for (const [pid, v] of Object.entries(tmp)) if (seasonPts[pid] == null) seasonPts[pid] = r2(v);

  const GAMES_LEFT = Math.max(1, 18 - CUR);
  const rosStrength = {}, curProj = {}, curLineup = {}, rosLineup = {};
  for (const t of TIDS) {
    const ents = (roster[t] || []).filter((e) => e.slot !== 21);
    const ro = optimal(ents.map((e) => [e.pid, (e.ros || 0) / GAMES_LEFT]), posOf);
    rosStrength[t] = r2(ro.total); rosLineup[t] = new Set(ro.chosen);
    const cp = optimal(ents.map((e) => [e.pid, e.proj || 0]), posOf);
    curLineup[t] = new Set(cp.chosen);
    const asSet = (roster[t] || []).filter((e) => STARTER_SLOTS.has(e.slot)).reduce((s, e) => s + (e.proj || 0), 0);
    curProj[t] = { optimal: r2(cp.total), as_set: r2(asSet) };
  }

  const matchups = [];
  for (const m of dump.sched.filter((m) => m.wk === CUR && m.a != null)) {
    const ph = curProj[m.h].optimal, pa = curProj[m.a].optimal;
    matchups.push({ wk: CUR, h: m.h, a: m.a, hp: ph, ap: pa, h_set: curProj[m.h].as_set, a_set: curProj[m.a].as_set, hwin: r2(phi((ph - pa) / (SD * Math.SQRT2))), tier: m.tier });
  }

  // strength + simulation
  const recentAvg = {};
  for (const t of TIDS) {
    const pts = DONE.map((w) => scores[w][t]);
    const wts = pts.map((_, i) => 1 + 0.15 * i);
    recentAvg[t] = pts.length ? pts.reduce((s, p, i) => s + p * wts[i], 0) / wts.reduce((s, v) => s + v, 0) : rosStrength[t];
  }
  let strength = {};
  for (const t of TIDS) strength[t] = 0.6 * rosStrength[t] + 0.4 * recentAvg[t];
  const adj = leagueAvg - mean(Object.values(strength));
  for (const t of TIDS) strength[t] += adj;

  const remaining = dump.sched.filter((m) => m.wk >= CUR && m.wk <= REG && m.a != null && m.win === 'UNDECIDED');
  const meanFor = (t, wk) => (wk === CUR ? curProj[t].optimal : strength[t]);
  const g = rng(961003394 + CUR);
  const mk = () => Object.fromEntries(TIDS.map((t) => [t, 0]));
  const makePO = mk(), bye = mk(), last = mk(), winTot = mk();
  const whatif = Object.fromEntries(TIDS.map((t) => [t, {}]));
  const seeds = Object.fromEntries(TIDS.map((t) => [t, new Array(TIDS.length).fill(0)]));
  const stakes = Object.fromEntries(TIDS.map((t) => [t, { w: 0, wPO: 0, l: 0, lPO: 0 }]));
  for (let i = 0; i < sims; i++) {
    const w = {}, pf = {}, cur = {};
    for (const t of TIDS) { w[t] = teams[t].w; pf[t] = teams[t].pf; }
    for (const m of remaining) {
      const sh = g(meanFor(m.h, m.wk), SD), sa = g(meanFor(m.a, m.wk), SD);
      pf[m.h] += sh; pf[m.a] += sa;
      if (sh > sa) w[m.h]++; else w[m.a]++;
      if (m.wk === CUR) { cur[m.h] = sh > sa; cur[m.a] = sa > sh; }
    }
    const order = [...TIDS].sort((a, b) => (w[b] - w[a]) || (pf[b] - pf[a]));
    order.forEach((t, k) => { seeds[t][k]++; winTot[t] += w[t]; });
    const top = new Set(order.slice(0, PO));
    for (const t of top) makePO[t]++;
    bye[order[0]]++; bye[order[1]]++;
    last[order[order.length - 1]]++;
    for (const t of TIDS) { const c = (whatif[t][w[t]] ||= [0, 0]); c[0]++; if (top.has(t)) c[1]++; }
    for (const t of TIDS) if (t in cur) { const s2 = stakes[t]; if (cur[t]) { s2.w++; if (top.has(t)) s2.wPO++; } else { s2.l++; if (top.has(t)) s2.lPO++; } }
  }
  const sched = [];
  const sos = {};
  for (const t of TIDS) {
    const opps = remaining.filter((m) => m.h === t || m.a === t).map((m) => (m.h === t ? m.a : m.h));
    sos[t] = opps.length ? r1(mean(opps.map((o) => strength[o]))) : null;
  }
  for (const m of remaining) for (const [t, o] of [[m.h, m.a], [m.a, m.h]]) {
    sched.push({ id: t, wk: m.wk, opp: o, win: Math.round(100 * phi((meanFor(t, m.wk) - meanFor(o, m.wk)) / (SD * Math.SQRT2))) });
  }

  // transactions → trades + pickups
  const tx = dump.tx.filter((t) => t.wk > 0);
  const ownerByWk = {};
  for (const r of dump.rows) (ownerByWk[r.pid] ||= {})[r.wk] = r.tid;
  const faAdds = {};
  for (const t of tx) for (const it of t.items) if (it.type === 'ADD') (faAdds[it.pid] ||= []).push([it.to, t.wk]);
  const moves = {};
  for (const [pid, wks] of Object.entries(ownerByWk)) {
    let prev = null;
    for (const wk of Object.keys(wks).map(Number).sort((a, b) => a - b)) {
      const cur = wks[wk];
      if (prev && cur !== prev[1]) {
        const viaFa = (faAdds[pid] || []).some(([tid, awk]) => tid === cur && awk >= prev[0] && awk <= wk);
        if (!viaFa) (moves[prev[1] + '>' + cur + '>' + wk] ||= []).push(Number(pid));
      }
      prev = [wk, cur];
    }
  }
  const startedPts = (pid, tid, fromWk) => dump.rows.filter((r) => r.pid === pid && r.tid === tid && r.wk >= fromWk && DONE.includes(r.wk) && STARTER_SLOTS.has(r.slot)).reduce((s, r) => s + (r.act || 0), 0);
  const trades = [], used = new Set();
  for (const [key, pids] of Object.entries(moves)) {
    const [fr, to, wk] = key.split('>').map(Number);
    const k2 = Math.min(fr, to) + '-' + Math.max(fr, to) + '-' + wk;
    if (used.has(k2)) continue; used.add(k2);
    const back = moves[to + '>' + fr + '>' + wk] || [];
    const side = (tid, got) => {
      const gets = got.map((p) => ({ name: pname(p), pos: posOf(p), pts: r1(startedPts(p, tid, wk)), ros: Math.round(rosOf[p] || 0) }));
      return { id: tid, gets, pts: r1(gets.reduce((s, x) => s + x.pts, 0)), ros: Math.round(gets.reduce((s, x) => s + x.ros, 0)) };
    };
    const a = side(fr, back), b = side(to, pids);
    const sa = a.pts + a.ros * 0.5, sb = b.pts + b.ros * 0.5;
    trades.push({ wk, a, b, winner: sa > sb * 1.15 ? fr : sb > sa * 1.15 ? to : null });
  }
  trades.sort((x, y) => x.wk - y.wk);
  const pickMap = {};
  for (const t of tx) {
    if (t.type !== 'FREEAGENT' && t.type !== 'WAIVER') continue;
    for (const it of t.items) {
      if (it.type !== 'ADD') continue;
      const p = { id: it.to, pid: it.pid, name: pname(it.pid), pos: posOf(it.pid), wk: t.wk, pts: r1(startedPts(it.pid, it.to, t.wk)), ros: Math.round(rosOf[it.pid] || 0) };
      const k = it.to + '-' + it.pid;
      if (!pickMap[k] || p.pts > pickMap[k].pts) pickMap[k] = p;
    }
  }
  const pickups = Object.values(pickMap).sort((a, b) => b.pts - a.pts);
  const movesCt = {};
  for (const t of tx) if (t.type === 'FREEAGENT' || t.type === 'WAIVER') movesCt[t.tid] = (movesCt[t.tid] || 0) + 1;

  // draft
  const posPick = {};
  const draft = dump.draft.map((d) => {
    const pos = posOf(d.pid); posPick[pos] = (posPick[pos] || 0) + 1;
    return { pick: d.pick, rd: d.rd, id: d.tid, name: pname(d.pid), pos, pos_pick: posPick[pos], season: r1(seasonPts[d.pid] || 0), pid: d.pid };
  });
  const finish = {};
  for (const [pid, pts] of Object.entries(seasonPts)) (finish[posOf(pid)] ||= []).push([pts, pid]);
  const finishRank = {};
  for (const lst of Object.values(finish)) lst.sort((a, b) => b[0] - a[0]).forEach(([, pid], i) => { finishRank[pid] = i + 1; });
  for (const d of draft) { d.pos_finish = finishRank[d.pid] || null; d.swing = d.pos_finish ? d.pos_pick - d.pos_finish : null; delete d.pid; }

  // positional strength
  const posPts = Object.fromEntries(TIDS.map((t) => [t, {}]));
  for (const r of dump.rows) if (DONE.includes(r.wk) && SLOTPOS[r.slot]) { const p = SLOTPOS[r.slot]; posPts[r.tid][p] = (posPts[r.tid][p] || 0) + (r.act || 0); }
  const SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
  const nW = Math.max(1, DONE.length);
  const posAvg = Object.fromEntries(SLOTS.map((p) => [p, r1(mean(TIDS.map((t) => (posPts[t][p] || 0) / nW)))]));
  const posTable = Object.fromEntries(TIDS.map((t) => [t, Object.fromEntries(SLOTS.map((p) => [p, r1((posPts[t][p] || 0) / nW)]))]));

  // needs + trade targets + waivers
  // bye this week: no NFL game on the slate (or, without the slate, a healthy player projected 0)
  const hasSlate = !!(week && week.games && week.games.length);
  const BYES = dump.byes || {};
  const isBye = (proId, proj, inj) => (hasSlate ? !week.byPro[proId] : BYES[proId] ? BYES[proId] === CUR : !proj && (!inj || inj === 'ACTIVE' || inj === 'NORMAL'));
  const freeAgents = dump.fa.map((f) => ({ id: f.id, name: f.name, pos: POS[f.pos] || '?', team: PRO[f.pro] || '?', status: f.status, inj: f.inj, owned: Math.round(f.pct || 0), proj: r1(f.proj || 0), ros: Math.round(f.ros || 0), bye: isBye(f.pro, f.proj, f.inj), bye_wk: BYES[f.pro] || null }));
  const healthy = (f) => f.inj !== 'INJURY_RESERVE' && f.inj !== 'OUT';
  const waivers = {};
  for (const p of ['QB', 'RB', 'WR', 'TE', 'D/ST', 'K']) waivers[p] = freeAgents.filter((f) => f.pos === p && healthy(f)).sort((a, b) => b.ros - a.ros).slice(0, 8);
  const needs = {}, targets = {};
  for (const t of TIDS) {
    const diffs = Object.fromEntries(['QB', 'RB', 'WR', 'TE', 'D/ST', 'K'].map((p) => [p, posTable[t][p] - posAvg[p]]));
    const ks = Object.keys(diffs);
    const weak = ks.reduce((a, b) => (diffs[b] < diffs[a] ? b : a)), strong = ks.reduce((a, b) => (diffs[b] > diffs[a] ? b : a));
    const fa = waivers[weak][0] || null;
    needs[t] = { weak, weak_mine: posTable[t][weak], weak_league: posAvg[weak], weak_diff: r1(diffs[weak]), strong, strong_diff: r1(diffs[strong]), fa: fa ? fa.name : null, fa_ros: fa ? fa.ros : null };
    const cands = [];
    for (const o of TIDS) {
      if (o === t) continue;
      for (const e of roster[o] || []) if (posOf(e.pid) === weak && e.slot !== 21 && !rosLineup[o].has(e.pid) && (e.ros || 0) > 0) cands.push({ name: pname(e.pid), pos: weak, from: o, ros: Math.round(e.ros), season: r1(e.season || 0) });
    }
    targets[t] = cands.sort((a, b) => b.ros - a.ros).slice(0, 5);
  }

  // per-player average of the weeks we've seen them score (any roster, started or benched)
  const pavg = {};
  { const seen = {};
    for (const r of dump.rows) if (r.act != null && DONE.includes(r.wk)) { const k = r.pid + ':' + r.wk; if (!seen[k]) { seen[k] = 1; (pavg[r.pid] ||= []).push(r.act); } }
    for (const k in pavg) pavg[k] = r1(pavg[k].reduce((x, y) => x + y, 0) / pavg[k].length);
    // recent pickups we never saw on a roster: season total over weeks played so far (close enough)
    for (const e of dump.roster) if (pavg[e.pid] == null && e.season && DONE.length) pavg[e.pid] = r1(e.season / DONE.length);
  }
  // rosters for the page
  const INJ = { ACTIVE: '', NORMAL: '', QUESTIONABLE: 'Q', OUT: 'O', INJURY_RESERVE: 'IR', DOUBTFUL: 'D', SUSPENSION: 'SSPD' };
  const rosters = {};
  for (const t of TIDS) {
    rosters[t] = (roster[t] || []).map((e) => ({
      name: pname(e.pid), pos: posOf(e.pid), nfl: players[e.pid] ? players[e.pid].team : '?', slot: SLOT_NAME[e.slot] || '?',
      inj: INJ[e.inj] ?? e.inj, bye: isBye(players[e.pid]?.proId, e.proj, e.inj), bye_wk: BYES[players[e.pid]?.proId] || null, avg: pavg[e.pid] ?? null, proj: r1(e.proj || 0), ros: Math.round(e.ros || 0), season: r1(e.season || 0),
      note: curLineup[t].has(e.pid) && e.slot === 20 ? 'Start' : (!curLineup[t].has(e.pid) && STARTER_SLOTS.has(e.slot) ? 'Sit' : ''),
      starter: STARTER_SLOTS.has(e.slot),
    })).sort((a, b) => (a.starter === b.starter ? b.proj - a.proj : a.starter ? -1 : 1));
  }

  // history
  const hist = {};
  for (const [yr, h] of Object.entries(dump.hist)) hist[yr] = h;
  hist[status.year] = {
    teams: Object.fromEntries(TIDS.map((t) => [t, { name: teams[t].name, owner: teams[t].owner, w: teams[t].w, l: teams[t].l, pf: teams[t].pf, seed: teams[t].seed, final: null }])),
    games: dump.sched.filter((m) => m.win !== 'UNDECIDED' && m.a != null).map((m) => ({ ...m, tier: m.tier || 'NONE' })),
  };
  const alltime = {}, h2h = {};
  const at = (o) => (alltime[o] ||= { owner: o, w: 0, l: 0, pf: 0, games: 0, titles: [], high: 0, best: null, seasons: 0 });
  for (const [yr, d] of Object.entries(hist)) {
    for (const t of Object.values(d.teams)) {
      const a = at(t.owner); a.seasons++;
      if (t.final === 1) a.titles.push(Number(yr));
      if (t.final && (a.best == null || t.final < a.best)) a.best = t.final;
    }
    for (const gm of d.games) {
      if (gm.tier !== 'NONE' && gm.tier !== 'WINNERS_BRACKET') continue;
      if (!d.teams[gm.h] || !d.teams[gm.a]) continue;
      const oh = d.teams[gm.h].owner, oa = d.teams[gm.a].owner;
      for (const [o, p] of [[oh, gm.hp], [oa, gm.ap]]) { const a = at(o); a.pf += p; a.games++; a.high = Math.max(a.high, p); }
      const win = gm.win === 'HOME' ? [oh, oa] : gm.win === 'AWAY' ? [oa, oh] : null;
      if (win) { at(win[0]).w++; at(win[1]).l++; (h2h[win[0] + '|' + win[1]] ||= [0, 0])[0]++; (h2h[win[1] + '|' + win[0]] ||= [0, 0])[1]++; }
    }
  }
  const ownerTid = Object.fromEntries(TIDS.map((t) => [teams[t].owner, t]));
  const alltimeOut = Object.values(alltime).map((a) => ({ owner: firstName(a.owner), id: ownerTid[a.owner] ?? null, w: a.w, l: a.l, pct: r1(100 * a.w / Math.max(1, a.w + a.l)), titles: a.titles, ppg: a.games ? r1(a.pf / a.games) : 0, high: r1(a.high), best: a.best }))
    .sort((a, b) => (b.titles.length - a.titles.length) || (b.pct - a.pct));
  const h2hOut = [];
  for (const [k, [w, l]] of Object.entries(h2h)) { const [o1, o2] = k.split('|'); if (ownerTid[o1] != null) h2hOut.push({ id: ownerTid[o1], opp: firstName(o2), w, l }); }
  const champs = [];
  const records = [];
  for (const [yr, d] of Object.entries(hist)) {
    for (const t of Object.values(d.teams)) if (t.final === 1) {
      const fin = d.games.filter((gm) => gm.tier === 'WINNERS_BRACKET');
      const lastWk = Math.max(...fin.map((gm) => gm.wk));
      const fg = fin.find((gm) => gm.wk === lastWk);
      const other = fg ? d.teams[fg.h].owner === t.owner ? d.teams[fg.a] : d.teams[fg.h] : null;
      champs.push({ year: Number(yr), owner: firstName(t.owner), team: t.name, record: `${t.w}-${t.l}`, seed: t.seed, final: fg ? `${Math.max(fg.hp, fg.ap).toFixed(1)}–${Math.min(fg.hp, fg.ap).toFixed(1)}` : '', runner_up: other ? firstName(other.owner) : '' });
    }
    for (const gm of d.games) {
      if (gm.tier !== 'NONE' && gm.tier !== 'WINNERS_BRACKET') continue;
      if (!d.teams[gm.h] || !d.teams[gm.a]) continue;
      for (const [s, o, p, q] of [[gm.h, gm.a, gm.hp, gm.ap], [gm.a, gm.h, gm.ap, gm.hp]]) records.push({ season: Number(yr), wk: gm.wk, owner: firstName(d.teams[s].owner), team: d.teams[s].name, pts: r1(p), opp: firstName(d.teams[o].owner), opp_pts: r1(q), margin: r1(p - q) });
    }
  }
  champs.sort((a, b) => a.year - b.year);
  const recordBook = [
    ...[...records].sort((a, b) => b.pts - a.pts).slice(0, 3).map((r) => ({ kind: 'Highest score', ...r })),
    ...[...records].sort((a, b) => a.pts - b.pts).slice(0, 3).map((r) => ({ kind: 'Lowest score', ...r })),
    ...[...records].sort((a, b) => b.margin - a.margin).slice(0, 3).map((r) => ({ kind: 'Biggest blowout', ...r })),
    ...records.filter((r) => r.margin < 0).sort((a, b) => b.margin - a.margin).slice(0, 3).map((r) => ({ kind: 'Closest loss', ...r })),
  ];

  // team table + power ranking
  const z = (vals) => { const m = mean(vals), s = pstdev(vals) || 1; return vals.map((v) => (v - m) / s); };
  const table = TIDS.map((t) => {
    const wks = DONE.map((w) => weekly[t][w]);
    const pts = wks.map((x) => x.pts);
    const [apw, apl] = allplay[t];
    const expW = apw + apl ? apw / (apw + apl) * DONE.length : 0;
    const optSum = wks.reduce((s, x) => s + x.opt, 0);
    return {
      id: t, name: teams[t].name, owner: firstName(teams[t].owner), w: teams[t].w, l: teams[t].l, pf: r1(teams[t].pf), pa: r1(teams[t].pa), seed: teams[t].seed,
      avg: r1(mean(pts)), allplay_w: apw, allplay_l: apl, exp_w: r1(expW), luck: r1(teams[t].w - expW),
      bench_lost: r1(wks.reduce((s, x) => s + x.opt - x.pts, 0)), eff: optSum ? r1(100 * pts.reduce((s, v) => s + v, 0) / optSum) : null,
      ros: r1(rosStrength[t]), strength: r1(strength[t]), sos: sos[t], moves: movesCt[t] || 0,
      playoffs: r1(100 * makePO[t] / sims), bye: r1(100 * bye[t] / sims), last: r1(100 * last[t] / sims), exp_wins: r1(winTot[t] / sims),
      seeds: seeds[t].map((c) => r1(100 * c / sims)),
      whatif: Object.entries(whatif[t]).map(([wins, [n, po]]) => ({ wins: Number(wins), chance: r1(100 * n / sims), playoffs: Math.round(100 * po / n) })).filter((x) => x.chance >= 0.4).sort((a, b) => a.wins - b.wins),
      weeks: DONE.map((w) => ({ wk: w, ...weekly[t][w], pts: r1(weekly[t][w].pts), opp_pts: r1(weekly[t][w].opp_pts), proj: r1(weekly[t][w].proj), opt: r1(weekly[t][w].opt), rank: wkRank[w][t] })),
      pos: posTable[t], need: needs[t], targets: targets[t], cur_proj: curProj[t].optimal, cur_set: curProj[t].as_set,
    };
  });
  const za = z(table.map((r) => r.ros)), zb = z(table.map((r) => r.avg)), zc = z(table.map((r) => r.allplay_w));
  table.forEach((r, i) => { r.power_score = r2(0.45 * za[i] + 0.35 * zb[i] + 0.2 * zc[i]); });
  [...table].sort((a, b) => b.power_score - a.power_score).forEach((r, i) => { r.power = i + 1; });
  [...table].sort((a, b) => b.pf - a.pf).forEach((r, i) => { r.pf_rank = i + 1; });
  const ex = extras({ isBye, dump, TIDS, teams, tname, scores, opp, DONE, weekly, byTW, roster, posOf, pname, players, rosLineup, curLineup, curProj,
    waivers, needs, posTable, posAvg, hist, SD, leagueAvg, CUR, REG, PO, strength, wkRank, table, seeds, stakes, sims, week, firstName, rosOf, seasonPts });
  for (const row of table) Object.assign(row, ex.per[row.id]);
  table.sort((a, b) => a.power - b.power);

  return {
    league: { name: dump.leagueName || 'League', year: status.year, week: CUR, reg_weeks: REG, playoff_teams: PO, avg: r1(leagueAvg), sd: r1(SD), sd_measured: r1(SD_MEASURED), done: DONE, sims },
    ...ex.top,
    teams: table,
    matchups,
    sched,
    rosters,
    pavg,
    oprk: dump.oprk || {},
    waivers,
    trades,
    pickups,
    draft,
    pos_avg: posAvg,
    alltime: alltimeOut,
    h2h: h2hOut,
    champs,
    records: recordBook,
  };
}
