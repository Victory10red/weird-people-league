// The League Bot's Tuesday roast: whoever scored the fewest points in the week that just finished.
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

export function weeklyRoast(out, rand = Math.random) {
  const done = (out.league && out.league.done) || [];
  const W = done[done.length - 1];
  if (!W) return null;
  const teams = out.teams || [];
  const own = (id) => (teams.find((t) => t.id === id) || {}).owner || 'somebody';
  const rows = teams.map((t) => ({ t, w: (t.weeks || []).find((x) => x.wk === W) })).filter((r) => r.w && r.w.pts != null);
  if (!rows.length) return null;
  rows.sort((a, b) => a.w.pts - b.w.pts);
  const lo = rows[0], hi = rows[rows.length - 1], t = lo.t, w = lo.w;
  const o = t.owner, she = /^(darla|jacky)\b/i.test(o), his = she ? 'her' : 'his', he = she ? 'she' : 'he', him = she ? 'her' : 'him';
  const lost = w.pts < w.opp_pts, margin = Math.abs(w.opp_pts - w.pts), bench = (w.opt || w.pts) - w.pts;
  const seasonLow = teams.every((x) => (x.weeks || []).every((y) => y.pts == null || y.pts >= w.pts));
  const lines = [
    `🚨 WEEK ${W} BASEMENT REPORT: ${o} put up ${f1(w.pts)}, dead last in the league. ${lost ? `${own(w.opp)} beat ${him} by ${f1(margin)}.` : `Somehow still beat ${own(w.opp)}, which is the saddest part.`} Now ${t.w}-${t.l}.`,
    `Week ${W} is in the books and ${o} scored ${f1(w.pts)}. That's 10th of 10. ${hi.t.owner} scored ${f1(hi.w.pts)}. Same league, different sport.`,
    bench >= 15 ? `${o} scored ${f1(w.pts)} in week ${W} with ${f1(bench)} points sitting on ${his} bench. Lowest score in the league and it was self-inflicted.` : null,
    `Congratulations to ${o}, week ${W}'s official Bum of the Week with ${f1(w.pts)} points. Your prize is this post. Everyone point and laugh.`,
    seasonLow ? `📉 New season low: ${o} with ${f1(w.pts)} in week ${W}. Nobody has scored less all year. Frame it.` : null,
    `${o} brought ${f1(w.pts)} to a ${f1(hi.w.pts)} fight in week ${W}. ${t.playoffs != null ? `Playoff odds now ${Math.round(t.playoffs)}%.` : ''} Thoughts and prayers.`,
    lost ? `Week ${W}: ${own(w.opp)} ${f1(w.opp_pts)}, ${o} ${f1(w.pts)}. ${he[0].toUpperCase() + he.slice(1)} had all week to set a lineup and this is what ${he} came up with.` : null,
  ].filter(Boolean).map((s) => s.replace(/\s+/g, ' ').trim());
  return { week: W, year: out.league.year, target: t.id, text: lines[Math.floor(rand() * lines.length)] };
}

// The League Bot's weekly power rankings, roast-style: one line per team, best to worst.
export function powerPost(out, rand = Math.random) {
  const done = (out.league && out.league.done) || [];
  const W = done[done.length - 1];
  if (!W) return null;
  const teams = [...(out.teams || [])].sort((a, b) => (a.power || 99) - (b.power || 99));
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const lines = teams.map((t, i) => {
    const wk = (t.weeks || []).find((x) => x.wk === W) || {};
    const won = wk.pts != null && wk.opp_pts != null ? wk.pts > wk.opp_pts : null;
    const last = wk.pts != null ? `${won ? 'Won' : 'Lost'} with ${f1(wk.pts)}` : '';
    const q = i === 0 ? pick([`Top dog. ${last}. Enjoy it, it won't last.`, `Best team in the league and still somehow annoying about it. ${last}.`, `The team everyone's rooting against. ${last}.`])
      : i < 3 ? pick([`Legit. ${last}. Don't get comfortable.`, `Playoff-bound unless they find a way to blow it. ${last}.`, `Good, not great. ${last}.`])
      : i < 6 ? pick([`Mushy middle. ${last}. Could go either way, mostly the wrong way.`, `${t.playoffs != null ? Math.round(t.playoffs) + '% playoff odds' : 'Coin-flip odds'} and a prayer. ${last}.`, `Not good enough to fear, not bad enough to pity. ${last}.`])
      : i < 9 ? pick([`Start planning for next year. ${last}.`, `Bench full of points, standings full of L's. ${last}.`, `The bus is leaving without them. ${last}.`])
      : pick([`Rock bottom. ${last}. Somebody check on them.`, `Dead last in the power rankings. ${last}. Thoughts and prayers.`, `The league's designated punching bag. ${last}.`]);
    return `${i + 1}. ${t.owner} (${t.w}-${t.l}): ${q.replace(/\s+\./g, '.').replace(/\.\./g, '.')}`;
  });
  return { week: W, year: out.league.year, text: `📊 WEEK ${W} POWER RANKINGS\n${lines.join('\n')}` };
}
