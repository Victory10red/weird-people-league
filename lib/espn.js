// Fetch the league from ESPN's fantasy API and normalize it into the "dump" lib/analyze.js reads.
// Works for leagues set to "viewable to public". For a private league, set ESPN_S2 and SWID
// (the two ESPN login cookies) as environment variables in Vercel; they are only used server-side.

export const LEAGUE_ID = Number(process.env.LEAGUE_ID || 961003394);
const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/';

function headers(extra = {}) {
  const h = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (league-hq)', ...extra };
  if (process.env.ESPN_S2 && process.env.SWID) h.Cookie = `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.SWID}`;
  return h;
}

export async function getJSON(url, extra) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: headers(extra) });
    if (r.ok) return r.json();
    last = new Error(`ESPN ${r.status} for ${url.replace(API, '')}`);
    last.status = r.status;
    if (r.status === 401 || r.status === 403 || r.status === 404) break;
    await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }
  throw last;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const stat = (p, yr, sp, src, split) => {
  const s = (p.stats || []).find((s) => s.seasonId === yr && s.scoringPeriodId === sp && s.statSourceId === src && s.statSplitTypeId === split);
  return s ? Math.round(s.appliedTotal * 100) / 100 : null;
};
const ownerName = (members, ids) => {
  const m = (members || []).find((x) => (ids || []).includes(x.id));
  return m ? `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.displayName || '' : '';
};

export async function currentSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; // season runs Sep–Jan
}

export async function fetchDump({ year } = {}) {
  const YR = year || await currentSeason();
  const L = `${API}${YR}/segments/0/leagues/${LEAGUE_ID}`;
  const base = await getJSON(`${L}?view=mTeam&view=mSettings&view=mStatus&view=mMatchupScore`);
  const WEEK = Math.max(1, base.status.currentMatchupPeriod || base.scoringPeriodId || 1);
  const regWeeks = base.settings.scheduleSettings.matchupPeriodCount;
  const prev = base.status.previousSeasons || [];

  const filt = { players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [0, 2, 4, 6, 16, 17] }, sortPercOwned: { sortPriority: 1, sortAsc: false }, limit: 120, filterRanksForScoringPeriodIds: { value: [WEEK] } } };
  const weeks = Array.from({ length: WEEK }, (_, i) => i + 1);
  const jobs = [
    ...weeks.map((wk) => ['box', wk, `${L}?view=mMatchupScore&view=mBoxscore&scoringPeriodId=${wk}`]),
    ...weeks.map((wk) => ['tx', wk, `${L}?view=mTransactions2&scoringPeriodId=${wk}`]),
    ['draft', 0, `${L}?view=mDraftDetail`],
    ['roster', 0, `${L}?view=mRoster&scoringPeriodId=${WEEK}`],
    ['fa', 0, `${L}?view=kona_player_info&scoringPeriodId=${WEEK}`, { 'x-fantasy-filter': JSON.stringify(filt) }],
    ...prev.map((y) => ['hist', y, `${API}${y}/segments/0/leagues/${LEAGUE_ID}?view=mTeam&view=mMatchupScore&view=mSettings`]),
  ];
  const res = await pool(jobs, 6, async ([kind, k, url, h]) => {
    try { return [kind, k, await getJSON(url, h)]; } catch (e) { if (kind === 'hist') return [kind, k, null]; throw e; }
  });

  const players = {};
  const addP = (p) => { players[p.id] = { name: p.fullName, pos: p.defaultPositionId, pro: p.proTeamId }; };
  const dump = {
    leagueName: base.settings.name,
    status: { year: YR, week: WEEK, prev },
    settings: { playoffTeams: base.settings.scheduleSettings.playoffTeamCount, regWeeks },
    sched: base.schedule.map((m) => ({ wk: m.matchupPeriodId, h: m.home?.teamId, a: m.away?.teamId ?? null, hp: m.home?.totalPoints ?? 0, ap: m.away?.totalPoints ?? 0, win: m.winner, tier: m.playoffTierType || 'NONE' })),
    teams: base.teams.map((t) => { const o = t.record.overall; return { id: t.id, name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim(), abbrev: t.abbrev, owner: ownerName(base.members, t.owners), w: o.wins, l: o.losses, t: o.ties, pf: o.pointsFor, pa: o.pointsAgainst, seed: t.playoffSeed }; }),
    rows: [], tx: [], draft: [], roster: [], fa: [], players, hist: {},
  };
  for (const [kind, k, j] of res) {
    if (kind === 'box') {
      for (const m of j.schedule.filter((s) => s.matchupPeriodId === k)) for (const side of ['home', 'away']) {
        const t = m[side]; if (!t) continue;
        for (const e of t.rosterForCurrentScoringPeriod?.entries || []) {
          const p = e.playerPoolEntry.player; addP(p);
          dump.rows.push({ wk: k, tid: t.teamId, pid: p.id, slot: e.lineupSlotId, act: stat(p, YR, k, 0, 1), proj: stat(p, YR, k, 1, 1) });
        }
      }
    } else if (kind === 'tx') {
      for (const t of j.transactions || []) if (t.status === 'EXECUTED' && t.type !== 'ROSTER') dump.tx.push({ wk: k, type: t.type, tid: t.teamId, items: (t.items || []).map((i) => ({ type: i.type, pid: i.playerId, from: i.fromTeamId, to: i.toTeamId })) });
    } else if (kind === 'draft') {
      dump.draft = (j.draftDetail?.picks || []).map((p) => ({ pick: p.overallPickNumber, rd: p.roundId, tid: p.teamId, pid: p.playerId }));
    } else if (kind === 'roster') {
      for (const t of j.teams) for (const e of t.roster.entries) {
        const p = e.playerPoolEntry.player; addP(p);
        dump.roster.push({ tid: t.id, pid: p.id, slot: e.lineupSlotId, inj: p.injuryStatus || e.injuryStatus || '', acq: e.acquisitionType || '', pct: p.ownership?.percentOwned || 0, proj: stat(p, YR, WEEK, 1, 1), ros: stat(p, YR, 0, 1, 0), season: stat(p, YR, 0, 0, 0) });
      }
    } else if (kind === 'fa') {
      for (const pp of j.players || []) { const p = pp.player; dump.fa.push({ id: p.id, name: p.fullName, pos: p.defaultPositionId, pro: p.proTeamId, status: pp.status, inj: p.injuryStatus || '', pct: p.ownership?.percentOwned || 0, proj: stat(p, YR, WEEK, 1, 1), ros: stat(p, YR, 0, 1, 0), season: stat(p, YR, 0, 0, 0) }); }
    } else if (kind === 'hist' && j) {
      dump.hist[k] = {
        teams: Object.fromEntries(j.teams.map((t) => { const o = t.record.overall; return [t.id, { name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim(), owner: ownerName(j.members, t.owners), w: o.wins, l: o.losses, pf: o.pointsFor, seed: t.playoffSeed, final: t.rankCalculatedFinal || null }]; })),
        games: j.schedule.filter((m) => m.away && m.winner !== 'UNDECIDED').map((m) => ({ wk: m.matchupPeriodId, h: m.home.teamId, a: m.away.teamId, hp: m.home.totalPoints, ap: m.away.totalPoints, win: m.winner, tier: m.playoffTierType || 'NONE' })),
      };
    }
  }
  // names for drafted/traded players nobody rosters now
  const missing = [...new Set([...dump.draft.map((d) => d.pid), ...dump.tx.flatMap((t) => t.items.map((i) => i.pid))])].filter((id) => !players[id] && !dump.fa.some((f) => f.id === id));
  if (missing.length) {
    try {
      const j = await getJSON(`${L}?view=kona_player_info&scoringPeriodId=${WEEK}`, { 'x-fantasy-filter': JSON.stringify({ players: { filterIds: { value: missing } } }) });
      for (const pp of j.players || []) addP(pp.player);
    } catch { /* names fall back to ids */ }
  }
  // NFL bye weeks: proTeamId -> week
  try {
    const j = await getJSON(`${API}${YR}?view=proTeamSchedules_wl`);
    dump.byes = Object.fromEntries((j.settings?.proTeams || []).filter((t) => t.id && t.byeWeek).map((t) => [t.id, t.byeWeek]));
  } catch { dump.byes = {}; }
  return dump;
}

// Current week only, for live scoring: matchups with every starter's points and projection.
export async function fetchLive({ year } = {}) {
  const YR = year || await currentSeason();
  const L = `${API}${YR}/segments/0/leagues/${LEAGUE_ID}`;
  const base = await getJSON(`${L}?view=mStatus&view=mTeam`);
  const WEEK = Math.max(1, base.status.currentMatchupPeriod || 1);
  const box = await getJSON(`${L}?view=mMatchupScore&view=mBoxscore&scoringPeriodId=${WEEK}`);
  const names = Object.fromEntries(base.teams.map((t) => [t.id, (t.name || `${t.location || ''} ${t.nickname || ''}`).trim()]));
  const games = [];
  for (const m of box.schedule.filter((s) => s.matchupPeriodId === WEEK && s.away)) {
    const side = (t) => ({
      id: t.teamId, name: names[t.teamId],
      players: (t.rosterForCurrentScoringPeriod?.entries || []).map((e) => {
        const p = e.playerPoolEntry.player;
        return { pid: p.id, name: p.fullName, pos: p.defaultPositionId, pro: p.proTeamId, slot: e.lineupSlotId, act: stat(p, YR, WEEK, 0, 1) || 0, proj: stat(p, YR, WEEK, 1, 1) || 0, locked: !!e.playerPoolEntry.lineupLocked };
      }),
    });
    games.push({ h: side(m.home), a: side(m.away), hp: m.home.totalPointsLive ?? m.home.totalPoints ?? 0, ap: m.away.totalPointsLive ?? m.away.totalPoints ?? 0 });
  }
  return { year: YR, week: WEEK, games };
}

// NFL game clocks from ESPN's public scoreboard: proTeamId -> share of the game still to play (0–1).
export async function nflRemaining(year, week) {
  const out = {};
  try {
    const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${year}`);
    for (const ev of j.events || []) {
      const c = ev.competitions?.[0]; if (!c) continue;
      const st = c.status || ev.status; const state = st?.type?.state; // pre | in | post
      let rem = 1;
      if (state === 'post') rem = 0;
      else if (state === 'in') {
        const period = st.period || 1, clock = st.clock ?? 900;
        const elapsed = Math.min(60, (period - 1) * 15 + (15 - clock / 60));
        rem = period > 4 ? 0.02 : Math.max(0.02, 1 - elapsed / 60);
      }
      const detail = st?.type?.shortDetail || '';
      for (const team of c.competitors || []) out[Number(team.team?.id)] = { rem, state, detail, kickoff: ev.date };
    }
  } catch { /* scoreboard unavailable: treat every game as not started */ }
  return out;
}
