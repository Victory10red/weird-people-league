// Player research: the waiver wire by position (with real usage stats), the NFL injury report, and depth charts.
// Waiver data comes from the league's ESPN fantasy API (same login cookies as everything else);
// injuries and depth charts come from ESPN's public NFL APIs.
import { LEAGUE_ID, getJSON, currentSeason } from './espn.js';
import { PRO, POS } from './analyze.js';

const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/';
const r1 = (x) => Math.round(x * 10) / 10;
const SLOTS = { QB: 0, RB: 2, WR: 4, TE: 6, 'D/ST': 16, K: 17 };
// ESPN stat ids -> short names (checked against real box scores)
const STAT = {
  0: 'patt', 1: 'cmp', 3: 'pyd', 4: 'ptd', 20: 'int', 64: 'sk',
  23: 'car', 24: 'ruyd', 25: 'rutd',
  53: 'rec', 58: 'tgt', 42: 'reyd', 43: 'retd',
  83: 'fgm', 84: 'fga', 86: 'xpm', 87: 'xpa',
  99: 'dsk', 95: 'dint', 96: 'dfr', 94: 'dtd', 120: 'pa', 127: 'ya',
};
export function pickStats(st) {
  const o = {}; for (const [id, k] of Object.entries(STAT)) if (st && st[id] != null) o[k] = r1(st[id]); return o;
}

// one player from kona_player_info -> what the page needs
export function normPlayer(pp, yr, week) {
  const p = pp.player || pp, stats = p.stats || [];
  const weeks = stats.filter((s) => s.seasonId === yr && s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId > 0)
    .sort((a, b) => a.scoringPeriodId - b.scoringPeriodId)
    .map((s) => ({ wk: s.scoringPeriodId, pts: r1(s.appliedTotal || 0), ...pickStats(s.stats) }));
  const find = (src, split, sp) => stats.find((s) => s.seasonId === yr && s.statSourceId === src && s.statSplitTypeId === split && s.scoringPeriodId === sp);
  const season = find(0, 0, 0), ros = find(1, 0, 0), proj = find(1, 1, week);
  const own = p.ownership || {};
  return {
    id: p.id, name: p.fullName, pos: POS[p.defaultPositionId] || '?', team: PRO[p.proTeamId] || 'FA',
    status: pp.status || '', inj: p.injuryStatus || '', own: r1(own.percentOwned || 0), ownChg: r1(own.percentChange || 0), started: r1(own.percentStarted || 0),
    weeks, season: season ? { pts: r1(season.appliedTotal || 0), gp: (season.stats || {})[210] || null, ...pickStats(season.stats) } : null,
    proj: proj ? r1(proj.appliedTotal || 0) : null, ros: ros ? Math.round(ros.appliedTotal || 0) : null,
  };
}

// free agents and waiver players at each position, most-owned first, with their last 4 weeks
export async function fetchWire({ year } = {}) {
  const YR = year || await currentSeason();
  const L = `${API}${YR}/segments/0/leagues/${LEAGUE_ID}`;
  const base = await getJSON(`${L}?view=mStatus`);
  const WEEK = Math.max(1, base.status?.currentMatchupPeriod || base.scoringPeriodId || 1);
  const out = { year: YR, week: WEEK, at: new Date().toISOString(), players: [] };
  await Promise.all(Object.entries(SLOTS).map(async ([pos, slot]) => {
    const filt = { players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [slot] }, sortPercOwned: { sortPriority: 1, sortAsc: false },
      limit: pos === 'K' || pos === 'D/ST' ? 20 : 40, filterStatsForTopScoringPeriodIds: { value: 4, additionalValue: [`00${YR}`, `10${YR}`, `11${YR}${WEEK}`] } } };
    try {
      const j = await getJSON(`${L}?view=kona_player_info&scoringPeriodId=${WEEK}`, { 'x-fantasy-filter': JSON.stringify(filt) });
      for (const pp of j.players || []) out.players.push(normPlayer(pp, YR, WEEK));
    } catch { /* that position stays empty */ }
  }));
  return out;
}

// every NFL injury, minus healthy players: status, body part, ESPN's estimated return and the latest note
export function normInjuries(j) {
  const out = [];
  for (const t of j.injuries || []) {
    for (const i of t.injuries || []) {
      if (!i.status || i.status === 'Active') continue;
      const a = i.athlete || {}, d = i.details || {};
      const href = (a.links || []).map((l) => l.href || '').find((h) => /\/id\/\d+/.test(h)) || '';
      const id = Number((href.match(/\/id\/(\d+)/) || [])[1]) || null;
      const pos = a.position?.abbreviation || '';
      if (!['QB', 'RB', 'WR', 'TE', 'PK', 'K', 'FB'].includes(pos)) continue; // fantasy positions only
      out.push({ id, name: a.displayName || '', pos: pos === 'PK' ? 'K' : pos, team: PRO[Number(t.id)] || '', status: i.status, date: i.date || null,
        ret: d.returnDate || null, part: [d.side && d.side !== 'Not Specified' ? d.side : '', d.type || ''].filter(Boolean).join(' '), detail: d.detail && d.detail !== 'Not Specified' ? d.detail : '',
        fstat: d.fantasyStatus?.abbreviation || '', note: String(i.shortComment || '').slice(0, 400) });
    }
  }
  return out;
}
export async function fetchInjuries() {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ESPN injuries ${r.status}`);
  return { at: new Date().toISOString(), list: normInjuries(await r.json()) };
}

// depth charts: offense (QB/RB/WR/TE) and the kicker, in order, for all 32 teams
const DEPTH_POS = { qb: 'QB', rb: 'RB', wr: 'WR', te: 'TE', pk: 'K', k: 'K' };
export function normDepth(j) {
  const out = {};
  for (const f of j.items || []) for (const [k, v] of Object.entries(f.positions || {})) {
    const pos = DEPTH_POS[k]; if (!pos) continue;
    const ids = (v.athletes || []).map((a) => ({ rank: a.rank, id: Number(String(a.athlete?.$ref || '').match(/athletes\/(\d+)/)?.[1]) })).filter((a) => a.id).sort((a, b) => a.rank - b.rank).map((a) => a.id);
    if (!out[pos] || ids.length > out[pos].length) out[pos] = ids;
  }
  return out;
}
export async function fetchDepth({ year } = {}) {
  const YR = year || await currentSeason();
  const ids = Object.keys(PRO).map(Number).filter((x) => x > 0);
  const teams = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${YR}/teams/${id}/depthcharts`, { headers: { Accept: 'application/json' } });
      if (r.ok) teams[PRO[id]] = normDepth(await r.json());
    } catch { /* skip team */ }
  }));
  // names for every id on a depth chart
  const want = [...new Set(Object.values(teams).flatMap((t) => Object.values(t).flat()))];
  const names = {};
  if (want.length) {
    try {
      const j = await getJSON(`${API}${YR}/players?scoringPeriodId=0&view=players_wl`, { 'x-fantasy-filter': JSON.stringify({ filterIds: { value: want } }) });
      for (const p of Array.isArray(j) ? j : []) names[p.id] = p.fullName;
    } catch { /* names missing */ }
  }
  return { at: new Date().toISOString(), teams, names };
}
