// Sample week data shaped like lib/week.js output (lines/weather as ESPN + Open-Meteo returned them on 2026-10-28), for local preview only.
export const sampleWeek = (() => {
  const g = (id, kick, h, a, line, fav, total, city, st, indoor, wx) => {
    const favH = fav === 'h';
    const fi = total / 2 + line / 2, di = total / 2 - line / 2;
    return { id, kickoff: kick, state: 'pre', status: '', homeId: h[0], awayId: a[0], home: { abbr: h[1], name: h[1], implied: favH ? fi : di, line: favH ? -line : line }, away: { abbr: a[1], name: a[1], implied: favH ? di : fi, line: favH ? line : -line }, venue: city + ' stadium', city, st, indoor, odds: { provider: 'DraftKings', details: `${favH ? h[1] : a[1]} -${line}`, total, line, favId: favH ? h[0] : a[0] }, weather: wx };
  };
  const games = [
    g('1', '2026-10-30T00:15Z', [9, 'GB'], [29, 'CAR'], 3.5, 'h', 47.5, 'Green Bay', 'WI', false, { temp: 41, wind: 19, precip: 20, text: 'Mostly cloudy' }),
    g('2', '2026-11-01T18:00Z', [2, 'BUF'], [33, 'BAL'], 3, 'h', 54.5, 'Orchard Park', 'NY', false, { temp: 52, wind: 11, precip: 65, text: 'Showers' }),
    g('3', '2026-11-01T18:00Z', [4, 'CIN'], [10, 'TEN'], 10, 'h', 46.5, 'Cincinnati', 'OH', false, { temp: 60, wind: 7, precip: 10, text: 'Cloudy' }),
    g('4', '2026-11-01T18:00Z', [8, 'DET'], [16, 'MIN'], 2.5, 'h', 48.5, 'Detroit', 'MI', true, null),
    g('5', '2026-11-01T18:00Z', [20, 'NYJ'], [13, 'LV'], 1.5, 'a', 41.5, 'East Rutherford', 'NJ', false, { temp: 55, wind: 9, precip: 15, text: 'Clear' }),
    g('6', '2026-11-01T18:00Z', [27, 'TB'], [1, 'ATL'], 2.5, 'h', 49.5, 'Tampa', 'FL', false, { temp: 80, wind: 6, precip: 30, text: 'Partly cloudy' }),
    g('7', '2026-11-01T18:00Z', [23, 'PIT'], [5, 'CLE'], 4, 'h', 40.5, 'Pittsburgh', 'PA', false, { temp: 50, wind: 14, precip: 40, text: 'Cloudy' }),
    g('8', '2026-11-01T18:00Z', [30, 'JAX'], [11, 'IND'], 3, 'h', 45.5, 'Jacksonville', 'FL', false, { temp: 78, wind: 8, precip: 20, text: 'Sunny' }),
    g('9', '2026-11-01T18:00Z', [6, 'DAL'], [22, 'ARI'], 6.5, 'h', 50.5, 'Arlington', 'TX', true, null),
    g('10', '2026-11-01T20:05Z', [14, 'LAR'], [24, 'LAC'], 3, 'h', 46.5, 'Inglewood', 'CA', true, null),
    g('11', '2026-11-01T20:25Z', [15, 'MIA'], [17, 'NE'], 2.5, 'a', 44.5, 'Miami Gardens', 'FL', false, { temp: 84, wind: 10, precip: 35, text: 'Humid' }),
    g('12', '2026-11-01T20:25Z', [7, 'DEN'], [12, 'KC'], 1, 'a', 43.5, 'Denver', 'CO', false, { temp: 38, wind: 21, precip: 5, text: 'Windy' }),
    g('13', '2026-11-02T00:20Z', [28, 'WSH'], [21, 'PHI'], 4.5, 'h', 44.5, 'Landover', 'MD', false, { temp: 49, wind: 8, precip: 10, text: 'Clear' }),
    g('14', '2026-11-03T00:15Z', [26, 'SEA'], [3, 'CHI'], 4, 'h', 45.5, 'Seattle', 'WA', false, { temp: 47, wind: 12, precip: 70, text: 'Rain' }),
  ];
  const byPro = {};
  for (const x of games) for (const [me, them, s, o] of [[x.homeId, x.awayId, x.home, x.away], [x.awayId, x.homeId, x.away, x.home]]) byPro[me] = { opp: them, implied: s.implied, opp_implied: o.implied, line: s.line, total: x.odds.total, indoor: x.indoor, weather: x.weather, kickoff: x.kickoff, state: 'pre' };
  return { games, byPro, provider: 'DraftKings' };
})();
