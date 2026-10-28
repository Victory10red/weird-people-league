// Playoff race (clinch / elimination / magic numbers), manager report cards, the weekly recap,
// fantasy-playoff schedules, and the inputs the browser needs to run the trade analyzer.

const r1 = (v) => Math.round(v * 10) / 10;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1; };
const lc1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const POSID = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, 'D/ST': 16 };

export function more(c) {
  const { dump, TIDS, table, trades, pickups, draft, PO, REG, CUR, DONE, weekly, scores, tname, owner, awards, matchups, PRO, oprk, rosters, waivers, players, posOf, recentAvg, GAMES_LEFT, SD, leagueAvg } = c;
  const T = Object.fromEntries(table.map((r) => [r.id, r]));
  const per = Object.fromEntries(TIDS.map((t) => [t, {}]));

  // ---------- playoff race ----------
  const remaining = dump.sched.filter((m) => m.wk >= CUR && m.wk <= REG && m.a != null && m.win === 'UNDECIDED');
  const left = Object.fromEntries(TIDS.map((t) => [t, remaining.filter((m) => m.h === t || m.a === t).length]));
  const W = Object.fromEntries(TIDS.map((t) => [t, T[t].w]));
  const maxW = Object.fromEntries(TIDS.map((t) => [t, W[t] + left[t]]));
  const race = [];
  for (const t of TIDS) {
    const others = TIDS.filter((o) => o !== t);
    const threats = (wins) => others.filter((o) => maxW[o] >= wins).length; // could finish level or ahead
    const clinched = threats(W[t]) < PO;
    const eliminated = others.filter((o) => W[o] > maxW[t]).length >= PO;
    let magic = null;
    if (!clinched && !eliminated) for (let k = 1; k <= left[t]; k++) if (threats(W[t] + k) < PO) { magic = k; break; }
    const dist = T[t].wins_dist || [];
    const winOut = dist.find((d) => d.wins === maxW[t]);
    const need50 = dist.find((d) => d.playoffs >= 50 && d.chance >= 0.2), need90 = dist.find((d) => d.playoffs >= 90 && d.chance >= 0.2);
    let status, note;
    if (clinched) { status = 'Clinched'; note = 'In the playoffs no matter what.'; }
    else if (eliminated) { status = 'Eliminated'; note = 'Out of the playoff race.'; }
    else if (magic != null) { status = 'Alive'; note = `Win ${magic} of ${left[t]} and you're in, no help needed.`; }
    else { status = 'Alive'; note = `Can't clinch alone; needs help.`; }
    if (!clinched && !eliminated && T[t].playoffs < 3) status = 'Long shot';
    race.push({ id: t, w: W[t], l: T[t].l, left: left[t], status, magic, note,
      win_out: winOut ? winOut.playoffs : null, win_out_rec: `${maxW[t]}-${REG - maxW[t]}`,
      need50: need50 ? `${need50.wins}-${REG - need50.wins}` : null, need90: need90 ? `${need90.wins}-${REG - need90.wins}` : null, playoffs: T[t].playoffs });
  }
  race.sort((a, b) => b.playoffs - a.playoffs);
  for (const r of race) per[r.id].race = r;

  // ---------- report cards ----------
  const draftHaul = Object.fromEntries(TIDS.map((t) => [t, draft.filter((d) => d.id === t).reduce((s, d) => s + d.season, 0)]));
  const tradeNet = {}, tradeCt = {};
  for (const tr of trades) for (const [me, them] of [[tr.a, tr.b], [tr.b, tr.a]]) {
    tradeNet[me.id] = (tradeNet[me.id] || 0) + (me.pts + me.ros) - (them.pts + them.ros);
    tradeCt[me.id] = (tradeCt[me.id] || 0) + 1;
  }
  const wire = Object.fromEntries(TIDS.map((t) => [t, pickups.filter((p) => p.id === t).reduce((s, p) => s + p.pts, 0)]));
  const lineup = Object.fromEntries(TIDS.map((t) => [t, T[t].eff || 0]));
  const LETTERS = [[1.25, 'A+', 4.3], [0.75, 'A', 4], [0.35, 'B+', 3.3], [0, 'B', 3], [-0.35, 'C+', 2.3], [-0.75, 'C', 2], [-1.25, 'D', 1], [-Infinity, 'F', 0]];
  const grade = (vals, t) => { const arr = TIDS.map((x) => vals[x]); const z = (vals[t] - mean(arr)) / sd(arr); const g = LETTERS.find(([cut]) => z >= cut); return { g: g[1], gp: g[2], z: r1(z) }; };
  const ranked = (vals) => [...TIDS].sort((a, b) => vals[b] - vals[a]);
  const cards = [];
  for (const t of TIDS) {
    const d = grade(draftHaul, t), wv = grade(wire, t), ln = grade(lineup, t);
    const tr = tradeCt[t] ? grade(Object.fromEntries(TIDS.map((x) => [x, tradeNet[x] || 0])), t) : null;
    const parts = [d, wv, ln, ...(tr ? [tr] : [])];
    const gpa = r1(parts.reduce((s, p) => s + p.gp, 0) / parts.length * 10) / 10;
    const best = draft.filter((x) => x.id === t).sort((a, b) => b.season - a.season)[0];
    const topAdd = pickups.filter((p) => p.id === t)[0];
    cards.push({ id: t, gpa: Math.round(gpa * 100) / 100,
      draft: { ...d, detail: `${Math.round(draftHaul[t])} pts from drafted players (${ord(ranked(draftHaul).indexOf(t) + 1)})${best ? `; best pick ${best.name}` : ''}` },
      wire: { ...wv, detail: `${Math.round(wire[t])} started pts from pickups (${ord(ranked(wire).indexOf(t) + 1)})${topAdd ? `; best add ${topAdd.name}` : ''}` },
      lineup: { ...ln, detail: `${lineup[t]}% of max possible points started (${ord(ranked(lineup).indexOf(t) + 1)})` },
      trades: tr ? { ...tr, detail: `${tradeCt[t]} trade${tradeCt[t] > 1 ? 's' : ''}, net ${tradeNet[t] >= 0 ? '+' : ''}${Math.round(tradeNet[t])} pts (scored since + rest of season)` } : { g: '–', detail: 'No trades yet' } });
  }
  cards.sort((a, b) => b.gpa - a.gpa);
  cards.forEach((cd, i) => { cd.rank = i + 1; per[cd.id].card = cd; });

  // ---------- weekly recap ----------
  const LAST = DONE.length ? DONE[DONE.length - 1] : null;
  let recap = null;
  if (LAST) {
    const who = (t) => `${owner(t)} (${tname(t)})`;
    const games = [], seen = new Set();
    for (const t of TIDS) {
      const o = weekly[t][LAST].opp; const k = Math.min(t, o) + '-' + Math.max(t, o);
      if (seen.has(k)) continue; seen.add(k);
      const a = weekly[t][LAST].pts, b = weekly[o][LAST].pts;
      const [w, l, ws, ls] = a >= b ? [t, o, a, b] : [o, t, b, a];
      games.push({ w, l, ws, ls, m: ws - ls });
    }
    games.sort((x, y) => y.m - x.m);
    const verb = (m) => (m >= 40 ? 'demolished' : m >= 25 ? 'rolled' : m >= 12 ? 'beat' : m >= 5 ? 'got past' : 'squeaked by');
    const aw = Object.fromEntries((awards || []).map((a) => [a.award, a]));
    const lines = [];
    lines.push(`🏈 WEEK ${LAST} RECAP — ${dump.leagueName || 'League'}`);
    lines.push('');
    if (aw['Top score']) lines.push(`🔥 ${owner(aw['Top score'].id)} put up the week's best score: ${aw['Top score'].value}.${aw['Player of the week'] ? ` Player of the week: ${aw['Player of the week'].detail}.` : ''}`);
    if (aw['Basement']) lines.push(`🪦 ${owner(aw['Basement'].id)} brought up the rear with ${aw['Basement'].value}.`);
    lines.push('');
    lines.push('RESULTS');
    for (const g of games) lines.push(`• ${owner(g.w)} ${verb(g.m)} ${owner(g.l)}, ${r1(g.ws)}–${r1(g.ls)}`);
    lines.push('');
    const extra = [];
    if (aw['Upset of the week']) extra.push(`😱 Upset: ${owner(aw['Upset of the week'].id)} — ${lc1(aw['Upset of the week'].detail)}.`);
    if (aw['Robbed']) extra.push(`🥲 Robbed: ${owner(aw['Robbed'].id)} ${lc1(aw['Robbed'].detail)}.`);
    if (aw['Bench blunder']) extra.push(`🤦 Bench blunder: ${owner(aw['Bench blunder'].id)} ${lc1(aw['Bench blunder'].detail)}.`);
    if (aw['Luckiest win']) extra.push(`🍀 Luckiest win: ${owner(aw['Luckiest win'].id)}, ${lc1(aw['Luckiest win'].detail)}.`);
    if (extra.length) { lines.push(...extra); lines.push(''); }
    const st = [...table].sort((a, b) => b.w - a.w || b.pf - a.pf);
    lines.push('STANDINGS & PLAYOFF ODDS');
    st.forEach((r, i) => lines.push(`${i + 1}. ${r.owner} ${r.w}-${r.l} — ${Math.round(r.playoffs)}%`));
    lines.push('');
    const next = [...matchups].sort((a, b) => Math.abs(a.hwin - 0.5) - Math.abs(b.hwin - 0.5));
    if (next[0]) {
      const g = next[0];
      lines.push(`👀 Game of the week ${CUR}: ${who(g.h)} vs ${who(g.a)}, ${Math.round(g.hwin * 100)}–${Math.round(100 - g.hwin * 100)}.`);
    }
    const biggest = [...matchups].sort((a, b) => Math.abs(b.hwin - 0.5) - Math.abs(a.hwin - 0.5))[0];
    if (biggest && biggest !== next[0]) { const fav = biggest.hwin >= 0.5 ? biggest.h : biggest.a, dog = fav === biggest.h ? biggest.a : biggest.h; lines.push(`🎯 Biggest favorite: ${owner(fav)} (${Math.round(Math.max(biggest.hwin, 1 - biggest.hwin) * 100)}%) over ${owner(dog)}.`); }
    lines.push('');
    lines.push('Full breakdown: https://weird-people-league.vercel.app');
    recap = { week: LAST, text: lines.join('\n') };
  }

  // ---------- fantasy playoff schedules (the weeks titles are decided) ----------
  const PS = dump.proSched || {};
  const poWeeks = [REG + 1, REG + 2, REG + 3];
  const poSched = (proId, pos) => {
    const sched = PS[proId]; if (!sched) return null;
    const tbl = oprk[POSID[pos]] || {};
    const out = poWeeks.map((wk) => {
      const o = sched[wk];
      if (o == null) return { wk, opp: 'BYE', rank: null };
      const id = Math.abs(o);
      const r = tbl[id];
      return { wk, opp: `${o > 0 ? 'vs' : '@'} ${PRO[id] || '?'}`, rank: r ? r[1] : null };
    });
    const rk = out.map((x) => x.rank).filter((x) => x != null);
    return { weeks: out, avg: rk.length ? r1(mean(rk)) : null };
  };
  for (const t of TIDS) for (const r of rosters[t]) { const ps = poSched(players[r.pid]?.proId, r.pos); r.po = ps ? ps.weeks : null; r.po_avg = ps ? ps.avg : null; }
  for (const lst of Object.values(waivers)) for (const f of lst) { const ps = poSched(players[f.id]?.proId, f.pos); f.po = ps ? ps.weeks : null; f.po_avg = ps ? ps.avg : null; }

  // ---------- trade analyzer inputs (the browser reruns the season sim) ----------
  const sim = { sd: SD, games_left: GAMES_LEFT, cur: CUR, reg: REG, po: PO, avg: r1(leagueAvg),
    recent: Object.fromEntries(TIDS.map((t) => [t, r1(recentAvg[t])])),
    base: Object.fromEntries(TIDS.map((t) => [t, [T[t].w, r1(T[t].pf)]])),
    remaining: remaining.map((m) => [m.wk, m.h, m.a]) };

  return { per, top: { race, cards, recap, po_weeks: poWeeks, sim } };
}
