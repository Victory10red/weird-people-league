import { phi, POS, PRO, STARTER_SLOTS, SLOT_NAME } from './analyze.js';

const SD = 22; // spread of a full week's team score around its projection (measured on this league)
const ORDER = { 0: 0, 2: 1, 4: 2, 6: 3, 23: 4, 16: 5, 17: 6 };

// live: from fetchLive(); clocks: from nflRemaining()
export function liveScores(live, clocks) {
  const games = live.games.map((g) => {
    const side = (s, total) => {
      const starters = s.players.filter((p) => STARTER_SLOTS.has(p.slot)).sort((a, b) => ORDER[a.slot] - ORDER[b.slot]);
      const benchRow = (p) => { const c = clocks[p.pro]; return { pid: p.pid, name: p.name, pos: POS[p.pos] || '?', nfl: PRO[p.pro] || '?', slot: p.slot === 21 ? 'IR' : 'BN', pts: Math.round(p.act * 10) / 10, proj: Math.round(p.proj * 10) / 10, game: c ? (c.state === 'post' ? 'Final' : c.state === 'in' ? c.detail : 'Not started') : 'Bye', state: c ? c.state : 'bye' }; };
      const bench = s.players.filter((p) => !STARTER_SLOTS.has(p.slot)).map(benchRow).sort((a, b) => (a.slot === 'IR') - (b.slot === 'IR') || b.proj - a.proj);
      let exp = 0, projAll = 0, projLeft = 0, actSum = 0;
      const rows = starters.map((p) => {
        const c = clocks[p.pro];
        const rem = c ? c.rem : 0; // no game this week (bye) → nothing left to score
        exp += p.act + p.proj * rem; projAll += p.proj; projLeft += p.proj * rem; actSum += p.act;
        return { pid: p.pid, name: p.name, pos: POS[p.pos] || '?', nfl: PRO[p.pro] || '?', slot: SLOT_NAME[p.slot], pts: Math.round(p.act * 10) / 10, proj: Math.round(p.proj * 10) / 10, game: c ? (c.state === 'post' ? 'Final' : c.state === 'in' ? c.detail : 'Not started') : 'Bye', state: c ? c.state : 'bye' };
      });
      const pts = Math.max(total || 0, actSum);
      const share = projAll > 0 ? projLeft / projAll : 0;
      const yetToPlay = rows.filter((r) => r.state === 'pre').length, playing = rows.filter((r) => r.state === 'in').length;
      return { id: s.id, name: s.name, pts: Math.round(pts * 10) / 10, exp: Math.round((exp + (pts - actSum)) * 10) / 10, share, yetToPlay, playing, rows, bench };
    };
    const h = side(g.h, g.hp), a = side(g.a, g.ap);
    const sdh = SD * Math.sqrt(h.share), sda = SD * Math.sqrt(a.share);
    const spread = Math.sqrt(sdh * sdh + sda * sda);
    const hwin = spread < 0.5 ? (h.pts > a.pts ? 1 : h.pts < a.pts ? 0 : 0.5) : phi((h.exp - a.exp) / spread);
    return { h, a, hwin: Math.round(hwin * 1000) / 1000, done: h.share === 0 && a.share === 0 };
  });
  const anyLive = Object.values(clocks).some((c) => c.state === 'in');
  return { year: live.year, week: live.week, current: live.current ?? live.week, anyLive: live.week === (live.current ?? live.week) && anyLive, games, at: new Date().toISOString() };
}
