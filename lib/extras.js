// Analytics ESPN doesn't show: moves for every team, what-ifs, scenarios, awards,
// league-history rankings, and Vegas/weather-adjusted projections.
import { phi, optimal, STARTER_SLOTS } from './analyze.js';

const r1 = (v) => Math.round(v * 10) / 10;
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const pstdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const NEED = { QB: 1, RB: 2, WR: 2, TE: 1, 'D/ST': 1, K: 1 };
const FLEXABLE = new Set(['RB', 'WR', 'TE']);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const last = (n) => { const p = n.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').split(' '); return p[p.length - 1]; };

export function extras(c) {
  const { dump, TIDS, teams, tname, scores, opp, DONE, weekly, byTW, roster, posOf, pname, players, rosLineup, curLineup,
    waivers, needs, posTable, posAvg, hist, SD, leagueAvg, CUR, REG, PO, table, seeds, stakes, week, firstName, rosOf } = c;
  const T = Object.fromEntries(table.map((r) => [r.id, r]));
  const per = Object.fromEntries(TIDS.map((t) => [t, {}]));
  const LAST = DONE.length ? DONE[DONE.length - 1] : null;

  // ---------- schedule swap: your scores against every other team's schedule ----------
  const swap = {};
  for (const t of TIDS) {
    swap[t] = {};
    for (const o of TIDS) {
      let w = 0;
      for (const wk of DONE) {
        const x = opp[wk][o] === t ? o : opp[wk][o];
        if (x === t) continue;
        if (scores[wk][t] > scores[wk][x]) w++;
      }
      swap[t][o] = w;
    }
  }

  // ---------- per-team what-ifs ----------
  const boomLine = leagueAvg + pstdev(TIDS.flatMap((t) => DONE.map((w) => scores[w][t])));
  const bustLine = 2 * leagueAvg - boomLine;
  for (const t of TIDS) {
    const wks = DONE.map((w) => ({ w, ...weekly[t][w] }));
    const pts = wks.map((x) => x.pts);
    let optW = 0, closeW = 0, closeL = 0;
    for (const x of wks) {
      if (x.opt > x.opp_pts) optW++;
      if (Math.abs(x.pts - x.opp_pts) < 10) { if (x.pts > x.opp_pts) closeW++; else closeL++; }
    }
    const others = TIDS.filter((o) => o !== t).map((o) => ({ o, w: swap[t][o] }));
    const best = others.reduce((a, b) => (b.w > a.w ? b : a), others[0]);
    const worst = others.reduce((a, b) => (b.w < a.w ? b : a), others[0]);
    // seed distribution → best / worst realistic finish
    const dist = seeds[t].map((n) => n / c.sims);
    let acc = 0, bestSeed = 1, worstSeed = TIDS.length;
    for (let k = 0; k < dist.length; k++) { acc += dist[k]; if (acc >= 0.05) { bestSeed = k + 1; break; } }
    acc = 0;
    for (let k = dist.length - 1; k >= 0; k--) { acc += dist[k]; if (acc >= 0.05) { worstSeed = k + 1; break; } }
    let mAcc = 0, median = 1;
    for (let k = 0; k < dist.length; k++) { mAcc += dist[k]; if (mAcc >= 0.5) { median = k + 1; break; } }
    const st = stakes[t];
    per[t].whatif = {
      swap_best: best ? { id: best.o, wins: best.w } : null, swap_worst: worst ? { id: worst.o, wins: worst.w } : null,
      opt_wins: optW, close_w: closeW, close_l: closeL,
      sd: r1(pstdev(pts)), boom: pts.filter((p) => p >= boomLine).length, bust: pts.filter((p) => p <= bustLine).length,
      vs_proj: r1(mean(wks.map((x) => x.pts - x.proj))),
      pa_avg: r1(mean(wks.map((x) => x.opp_pts))),
      if_win: st.w ? Math.round(100 * st.wPO / st.w) : null, if_lose: st.l ? Math.round(100 * st.lPO / st.l) : null,
      seed_best: bestSeed, seed_worst: worstSeed, seed_median: median,
    };
    // top contributors (points scored while started)
    const by = {};
    for (const w of DONE) for (const e of byTW[t + '-' + w] || []) if (STARTER_SLOTS.has(e.slot)) by[e.pid] = (by[e.pid] || 0) + (e.act || 0);
    const total = Object.values(by).reduce((s, v) => s + v, 0) || 1;
    per[t].top_players = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pid, v]) => ({ name: pname(+pid), pos: posOf(+pid), pts: r1(v), share: r1(100 * v / total) }));
  }

  // ---------- power rank and points race by week ----------
  const powerByWeek = [];
  const cumPF = Object.fromEntries(TIDS.map((t) => [t, 0]));
  const cumAP = Object.fromEntries(TIDS.map((t) => [t, [0, 0]]));
  for (const w of DONE) {
    for (const t of TIDS) {
      cumPF[t] += scores[w][t];
      for (const o of TIDS) if (o !== t) { if (scores[w][t] > scores[w][o]) cumAP[t][0]++; else if (scores[w][t] < scores[w][o]) cumAP[t][1]++; }
    }
    const order = [...TIDS].sort((a, b) => (cumAP[b][0] / (cumAP[b][0] + cumAP[b][1] || 1)) - (cumAP[a][0] / (cumAP[a][0] + cumAP[a][1] || 1)) || cumPF[b] - cumPF[a]);
    order.forEach((t, i) => powerByWeek.push({ wk: w, id: t, rank: i + 1, pf: r1(cumPF[t]) }));
  }

  // ---------- Vegas + weather ----------
  const byPro = (week && week.byPro) || {};
  const implieds = Object.values(byPro).map((g) => g.implied).filter((v) => v > 0);
  const avgImplied = implieds.length ? mean(implieds) : null;
  const vegasFactor = (pid) => {
    if (!avgImplied) return 1;
    const g = byPro[players[pid] ? players[pid].proId : -1];
    if (!g || !(g.implied > 0)) return 1;
    return posOf(pid) === 'D/ST' ? clamp(Math.sqrt(avgImplied / (g.opp_implied || avgImplied)), 0.85, 1.15) : clamp(Math.sqrt(g.implied / avgImplied), 0.85, 1.15);
  };
  const vegasProj = {};
  for (const t of TIDS) {
    const ents = (roster[t] || []).filter((e) => e.slot !== 21);
    vegasProj[t] = avgImplied ? r1(optimal(ents.map((e) => [e.pid, (e.proj || 0) * vegasFactor(e.pid)]), posOf).total) : null;
  }
  const weatherFlag = (pid) => {
    const g = byPro[players[pid] ? players[pid].proId : -1];
    if (!g || g.indoor || !g.weather) return null;
    const wx = g.weather, pos = posOf(pid), out = [];
    if (!['QB', 'WR', 'TE', 'K'].includes(pos)) return null; // weather mostly hurts the passing and kicking game
    if (wx.wind >= 18) out.push(`${Math.round(wx.wind)} mph wind`);
    if (wx.precip >= 70) out.push(`${wx.precip}% chance of ${wx.temp <= 33 ? 'snow' : 'rain'}`);
    if (wx.temp <= 20) out.push(`${Math.round(wx.temp)}°F`);
    return out.length ? out.join(', ') : null;
  };

  // ---------- moves for every team ----------
  const healthyFA = (p) => (waivers[p] || []).filter((f) => f.inj !== 'INJURY_RESERVE' && f.inj !== 'OUT');
  for (const t of TIDS) {
    const ents = (roster[t] || []).map((e) => ({ ...e, name: pname(e.pid), pos: posOf(e.pid), proj: e.proj || 0, ros: e.ros || 0 }));
    const starters = ents.filter((e) => STARTER_SLOTS.has(e.slot));
    const bench = ents.filter((e) => e.slot === 20);
    const moves = [];
    // 1. lineup fixes this week
    const ins = bench.filter((e) => curLineup[t].has(e.pid)).sort((a, b) => b.proj - a.proj);
    const outs = starters.filter((e) => !curLineup[t].has(e.pid));
    const usedOut = new Set();
    for (const p of ins) {
      const fits = outs.filter((q) => !usedOut.has(q.pid) && (q.pos === p.pos || (FLEXABLE.has(q.pos) && FLEXABLE.has(p.pos))));
      const q = fits.sort((a, b) => a.proj - b.proj)[0];
      if (!q) continue;
      usedOut.add(q.pid);
      const why = q.proj === 0 ? (q.inj && q.inj !== 'ACTIVE' ? 'is out' : 'has no game this week') : `projects ${r1(q.proj)}`;
      moves.push({ kind: 'Lineup', title: `Start ${p.name} over ${q.name}`, detail: `${q.name} ${why}; ${p.name} projects ${r1(p.proj)} (+${r1(p.proj - q.proj)}).`, gain: p.proj - q.proj, urgent: q.proj === 0 });
    }
    // 2. starters with nothing to replace them
    for (const q of starters) {
      if (q.proj > 0 || usedOut.has(q.pid)) continue;
      const fa = healthyFA(q.pos).filter((f) => f.proj > 0).sort((a, b) => b.proj - a.proj)[0];
      if (fa) moves.push({ kind: 'Pickup', title: `Replace ${q.name} with ${fa.name}`, detail: `${q.name} won't score this week. ${fa.name} (${fa.team}) is a ${fa.status === 'WAIVERS' ? 'waiver claim' : 'free agent'} projected ${r1(fa.proj)}.`, gain: fa.proj, urgent: true });
    }
    // 3. stream K / D/ST for this week
    for (const p of ['D/ST', 'K']) {
      const cur = starters.find((e) => e.pos === p);
      const fa = healthyFA(p).filter((f) => f.proj > 0).sort((a, b) => b.proj - a.proj)[0];
      if (cur && fa && fa.proj - cur.proj >= 2) moves.push({ kind: 'Stream', title: `Stream ${fa.name} at ${p}`, detail: `Projects ${r1(fa.proj)} this week vs ${r1(cur.proj)} for ${cur.name}. ${fa.owned}% rostered on ESPN.`, gain: fa.proj - cur.proj, faName: fa.name, wk: `${r1(fa.proj)} vs ${r1(cur.proj)} this week` });
    }
    // 4. rest-of-season waiver upgrades
    const dropPool = bench.filter((e) => !rosLineup[t].has(e.pid)).sort((a, b) => a.ros - b.ros);
    const upgrades = [];
    for (const p of Object.keys(NEED)) {
      const mine = ents.filter((e) => e.pos === p && e.slot !== 21).sort((a, b) => b.ros - a.ros);
      const depth = NEED[p] + (FLEXABLE.has(p) && p !== 'TE' ? 1 : 0);
      const bar = mine[depth - 1] ? mine[depth - 1].ros : 0;
      const fa = healthyFA(p)[0];
      if (!fa) continue;
      const gain = fa.ros - bar;
      if (gain >= Math.max(8, 0.1 * bar)) {
        const drop = (p === 'K' || p === 'D/ST')
          ? ents.filter((e) => e.pos === p && e.slot !== 21).sort((a, b) => a.ros - b.ros)[0]
          : dropPool.find((d) => d.pos === p && d.ros < fa.ros) || dropPool.find((d) => d.ros < fa.ros);
        if (drop) upgrades.push({ kind: 'Waiver', title: `Add ${fa.name}, drop ${drop.name}`, detail: `${fa.name} (${p}, ${fa.team}) projects ${fa.ros} rest-of-season pts vs ${Math.round(drop.ros)} for ${drop.name}. ${fa.status === 'WAIVERS' ? 'On waivers' : 'Free agent'}, ${fa.owned}% rostered on ESPN.`, gain: fa.ros - drop.ros, faName: fa.name });
      }
    }
    for (const u of upgrades.sort((a, b) => b.gain - a.gain).slice(0, 2)) {
      const dup = moves.findIndex((m) => m.kind === 'Stream' && m.faName === u.faName);
      if (dup >= 0) moves[dup] = { ...u, detail: `${u.detail} Better this week too (${moves[dup].wk}).` }; else moves.push(u);
    }
    // 5. complementary trade
    const n = needs[t];
    let bestTrade = null;
    for (const o of TIDS) {
      if (o === t) continue;
      if (!(posTable[o][n.strong] < posAvg[n.strong] || needs[o].weak === n.strong)) continue;
      const theirs = (roster[o] || []).filter((e) => posOf(e.pid) === n.weak && e.slot !== 21 && !rosLineup[o].has(e.pid) && (e.ros || 0) > 0);
      const mineQ = (roster[t] || []).filter((e) => posOf(e.pid) === n.strong && e.slot !== 21 && !rosLineup[t].has(e.pid) && (e.ros || 0) > 0);
      for (const a of mineQ) for (const b of theirs) {
        const hi = Math.max(a.ros, b.ros), lo = Math.min(a.ros, b.ros);
        if (lo / hi < 0.7) continue;
        const score = lo;
        if (!bestTrade || score > bestTrade.score) bestTrade = { score, o, give: a, get: b };
      }
    }
    if (bestTrade) {
      const { o, give, get } = bestTrade;
      moves.push({ kind: 'Trade', title: `Offer ${pname(give.pid)} to ${tname(o)} for ${pname(get.pid)}`, detail: `You need a ${n.weak} and have ${n.strong} depth; ${tname(o)} (${firstName(teams[o].owner)}) is the reverse. Rest-of-season: ${Math.round(give.ros)} vs ${Math.round(get.ros)}. Neither player starts for his current team.`, gain: get.ros - give.ros });
    } else if (T[t].targets && T[t].targets[0]) {
      const x = T[t].targets[0];
      moves.push({ kind: 'Trade', title: `Shop for a ${n.weak}: ${x.name}`, detail: `${x.name} sits on ${tname(x.from)}'s bench (${x.ros} rest-of-season pts). Your strongest slot is ${n.strong}, so deal from there.`, gain: 0 });
    }
    // 6. heads-ups: questionable starters, weather, Vegas
    for (const q of starters) {
      if (q.inj === 'QUESTIONABLE' || q.inj === 'DOUBTFUL') {
        const backup = bench.filter((b) => b.pos === q.pos || (FLEXABLE.has(q.pos) && FLEXABLE.has(b.pos))).sort((a, b) => b.proj - a.proj)[0];
        moves.push({ kind: 'Injury', title: `Watch ${q.name} (${q.inj === 'DOUBTFUL' ? 'doubtful' : 'questionable'})`, detail: backup ? `If he's ruled out, ${backup.name} (${r1(backup.proj)} proj) is the fill-in. Check before kickoff.` : `No natural backup on the bench; line up a free agent.`, gain: 0 });
      }
    }
    const wxList = starters.map((q) => ({ q, wx: weatherFlag(q.pid) })).filter((x) => x.wx);
    if (wxList.length) moves.push({ kind: 'Weather', title: `Weather watch: ${wxList.map((x) => last(x.q.name)).join(', ')}`, detail: wxList.map((x) => `${x.q.name}: ${x.wx}`).join('; ') + '. Passing and kicking take the hit; trim expectations or pivot if a bench option is close.', gain: 0 });
    const lowVegas = starters.filter((q) => { const g = byPro[players[q.pid] ? players[q.pid].proId : -1]; return g && g.implied && posOf(q.pid) !== 'D/ST' && g.implied <= 17; });
    if (lowVegas.length) moves.push({ kind: 'Vegas', title: `Tough spot: ${lowVegas.map((q) => last(q.name)).join(', ')}`, detail: lowVegas.map((q) => `${q.name}'s team is projected for ${byPro[players[q.pid].proId].implied} pts`).join('; ') + ` by ${(week && week.provider) || 'the sportsbooks'} (league average ${r1(avgImplied)}).`, gain: 0 });
    per[t].moves = moves.slice(0, 7);
  }

  // ---------- weekly awards (last completed week) ----------
  const awards = [];
  if (LAST) {
    const games = dump.sched.filter((m) => m.wk === LAST && m.a != null);
    const rows = TIDS.map((t) => ({ id: t, ...weekly[t][LAST] }));
    const top = rows.reduce((a, b) => (b.pts > a.pts ? b : a)), low = rows.reduce((a, b) => (b.pts < a.pts ? b : a));
    awards.push({ award: 'Top score', id: top.id, value: r1(top.pts), detail: `${r1(top.pts)} points` });
    awards.push({ award: 'Basement', id: low.id, value: r1(low.pts), detail: `${r1(low.pts)} points` });
    const res = games.map((m) => { const hw = scores[LAST][m.h] > scores[LAST][m.a]; const w = hw ? m.h : m.a, l = hw ? m.a : m.h; return { w, l, ws: scores[LAST][w], ls: scores[LAST][l], wp: weekly[w][LAST].proj, lp: weekly[l][LAST].proj }; });
    const blow = res.reduce((a, b) => (b.ws - b.ls > a.ws - a.ls ? b : a));
    awards.push({ award: 'Biggest beatdown', id: blow.w, value: r1(blow.ws - blow.ls), detail: `Beat ${tname(blow.l)} by ${r1(blow.ws - blow.ls)}` });
    const close = res.reduce((a, b) => (b.ws - b.ls < a.ws - a.ls ? b : a));
    awards.push({ award: 'Nail-biter', id: close.w, value: r1(close.ws - close.ls), detail: `Edged ${tname(close.l)} by ${r1(close.ws - close.ls)}` });
    const upsets = res.filter((x) => x.lp > x.wp).sort((a, b) => (b.lp - b.wp) - (a.lp - a.wp));
    if (upsets[0]) awards.push({ award: 'Upset of the week', id: upsets[0].w, value: r1(upsets[0].lp - upsets[0].wp), detail: `Projected to lose by ${r1(upsets[0].lp - upsets[0].wp)}, beat ${tname(upsets[0].l)}` });
    const lucky = res.reduce((a, b) => (b.ws < a.ws ? b : a));
    awards.push({ award: 'Luckiest win', id: lucky.w, value: r1(lucky.ws), detail: `Won with just ${r1(lucky.ws)}` });
    const unlucky = res.reduce((a, b) => (b.ls > a.ls ? b : a));
    awards.push({ award: 'Robbed', id: unlucky.l, value: r1(unlucky.ls), detail: `Lost with ${r1(unlucky.ls)}, ${ordinal(TIDS.filter((t) => scores[LAST][t] > unlucky.ls).length + 1)}-best score` });
    const blunders = res.filter((x) => weekly[x.l][LAST].opt > x.ws).map((x) => ({ ...x, left: weekly[x.l][LAST].opt - x.ls })).sort((a, b) => b.left - a.left);
    if (blunders[0]) awards.push({ award: 'Bench blunder', id: blunders[0].l, value: r1(blunders[0].left), detail: `Left ${r1(blunders[0].left)} on the bench and lost by ${r1(blunders[0].ws - blunders[0].ls)}` });
    let mvp = null;
    for (const t of TIDS) for (const e of byTW[t + '-' + LAST] || []) if (STARTER_SLOTS.has(e.slot) && (!mvp || (e.act || 0) > mvp.act)) mvp = { id: t, pid: e.pid, act: e.act || 0 };
    if (mvp) awards.push({ award: 'Player of the week', id: mvp.id, value: r1(mvp.act), detail: `${pname(mvp.pid)}, ${r1(mvp.act)} points` });
  }

  // ---------- league history rankings ----------
  const seasons = [], career = {}, rivalry = [], bestSeasons = [];
  const cur = String(dump.status.year);
  for (const [yr, d] of Object.entries(hist)) {
    const reg = d.games.filter((g) => g.tier === 'NONE' || !g.tier);
    const byWk = {};
    for (const g of reg) { (byWk[g.wk] ||= {})[g.h] = g.hp; byWk[g.wk][g.a] = g.ap; }
    const ap = {};
    for (const wkScores of Object.values(byWk)) {
      const ids = Object.keys(wkScores);
      for (const a of ids) for (const b of ids) if (a !== b) { (ap[a] ||= [0, 0]); if (wkScores[a] > wkScores[b]) ap[a][0]++; else if (wkScores[a] < wkScores[b]) ap[a][1]++; }
    }
    const nWk = Object.keys(byWk).length || 1;
    for (const [tid, tm] of Object.entries(d.teams)) {
      const apw = ap[tid] || [0, 0];
      const row = { year: Number(yr), owner: firstName(tm.owner), team: tm.name, w: tm.w, l: tm.l, pf: r1(tm.pf), ppg: r1(tm.pf / Math.max(1, tm.w + tm.l)), seed: tm.seed, final: yr === cur ? null : tm.final, allplay: r1(100 * apw[0] / Math.max(1, apw[0] + apw[1])), complete: yr !== cur };
      seasons.push(row);
      const k = row.owner;
      const cr = (career[k] ||= { owner: k, seasons: 0, titles: 0, finals: 0, playoffs: 0, finishes: [], apw: 0, apl: 0, w: 0, l: 0 });
      cr.seasons++; cr.w += tm.w; cr.l += tm.l; cr.apw += apw[0]; cr.apl += apw[1];
      if (row.complete) {
        if (tm.final === 1) cr.titles++;
        if (tm.final && tm.final <= 2) cr.finals++;
        if (tm.seed && tm.seed <= PO) cr.playoffs++;
        if (tm.final) cr.finishes.push(tm.final);
      }
    }
    for (const g of d.games) {
      if (!d.teams[g.h] || !d.teams[g.a]) continue;
      if (g.tier !== 'NONE' && g.tier !== 'WINNERS_BRACKET' && g.tier) continue;
      rivalry.push({ year: Number(yr), wk: g.wk, a: firstName(d.teams[g.h].owner), b: firstName(d.teams[g.a].owner), ap: r1(g.hp), bp: r1(g.ap), playoff: g.tier === 'WINNERS_BRACKET' });
    }
    void nWk;
  }
  const careerOut = Object.values(career).map((cr) => {
    const apPct = 100 * cr.apw / Math.max(1, cr.apw + cr.apl);
    const legacy = cr.titles * 10 + (cr.finals - cr.titles) * 5 + cr.playoffs * 2 + (apPct - 50) / 5;
    return { owner: cr.owner, seasons: cr.seasons, titles: cr.titles, finals: cr.finals, playoffs: cr.playoffs, w: cr.w, l: cr.l, allplay: r1(apPct), avg_finish: cr.finishes.length ? r1(mean(cr.finishes)) : null, legacy: r1(legacy), id: TIDS.find((t) => firstName(teams[t].owner) === cr.owner) ?? null };
  }).sort((a, b) => b.legacy - a.legacy);
  careerOut.forEach((r, i) => { r.rank = i + 1; });
  bestSeasons.push(...[...seasons].sort((a, b) => b.allplay - a.allplay).slice(0, 8));

  // ---------- this week's matchups with Vegas adjustment ----------
  const vegasMatchups = (c.table && avgImplied) ? dump.sched.filter((m) => m.wk === CUR && m.a != null).map((m) => ({ h: m.h, a: m.a, hv: vegasProj[m.h], av: vegasProj[m.a], hwin: r1(100 * phi((vegasProj[m.h] - vegasProj[m.a]) / (SD * Math.SQRT2))) })) : [];

  // NFL games this week with league starters involved
  const nflGames = ((week && week.games) || []).map((g) => {
    const involved = [];
    for (const t of TIDS) for (const e of roster[t] || []) {
      const pro = players[e.pid] ? players[e.pid].proId : null;
      if (STARTER_SLOTS.has(e.slot) && (pro === g.homeId || pro === g.awayId)) involved.push({ id: t, name: pname(e.pid), pos: posOf(e.pid), proj: r1(e.proj || 0), flag: weatherFlag(e.pid) });
    }
    return { ...g, involved: involved.sort((a, b) => b.proj - a.proj) };
  });

  for (const t of TIDS) { per[t].vegas_proj = vegasProj[t]; }
  return {
    per,
    top: { swap, power_by_week: powerByWeek, awards, awards_week: LAST, history: { seasons, career: careerOut, best_seasons: bestSeasons, rivalry }, vegas_matchups: vegasMatchups, nfl: nflGames, avg_implied: avgImplied ? r1(avgImplied) : null, odds_provider: (week && week.provider) || null },
  };
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
