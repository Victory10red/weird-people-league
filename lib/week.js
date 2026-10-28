// This week's NFL slate: betting lines (from ESPN's public scoreboard, which carries its sportsbook
// partner's odds) and stadium weather (Open-Meteo, free, no key). Everything here is best-effort:
// if a source is down, the rest of the app keeps working without it.

const geoCache = new Map();

async function getJSON(url, ms = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (league-hq)' } });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function parseOdds(c) {
  const o = (c.odds || [])[0];
  if (!o) return null;
  const home = c.competitors.find((x) => x.homeAway === 'home'), away = c.competitors.find((x) => x.homeAway === 'away');
  const total = Number(o.overUnder) || null;
  let favId = null, line = null;
  const m = String(o.details || '').match(/^([A-Z]{2,4})\s+(-?\d+(?:\.\d+)?)/);
  if (m) {
    line = Math.abs(Number(m[2]));
    favId = [home, away].find((x) => x.team.abbreviation === m[1])?.team.id ?? null;
  } else if (/even|pk|pick/i.test(String(o.details || ''))) line = 0;
  else if (o.spread != null) { line = Math.abs(Number(o.spread)); favId = Number(o.spread) < 0 ? home.team.id : away.team.id; }
  if (favId == null && o.homeTeamOdds?.favorite) favId = home.team.id;
  if (favId == null && o.awayTeamOdds?.favorite) favId = away.team.id;
  return { provider: o.provider?.name || null, details: o.details || null, total, line, favId: favId != null ? Number(favId) : null,
    homeML: o.homeTeamOdds?.moneyLine ?? null, awayML: o.awayTeamOdds?.moneyLine ?? null };
}

async function geocode(city, state) {
  const key = `${city}|${state}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&countryCode=US`);
  const res = (j.results || []);
  const hit = res.find((r) => !state || (r.admin1 || '').toLowerCase().startsWith(String(state).toLowerCase()) || r.admin1_code === state) || res[0];
  const out = hit ? { lat: hit.latitude, lon: hit.longitude } : null;
  geoCache.set(key, out);
  return out;
}

const STATES = { AL: 'Alabama', AZ: 'Arizona', CA: 'California', CO: 'Colorado', FL: 'Florida', GA: 'Georgia', IL: 'Illinois', IN: 'Indiana', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', NC: 'North Carolina', NJ: 'New Jersey', NV: 'Nevada', NY: 'New York', OH: 'Ohio', PA: 'Pennsylvania', TN: 'Tennessee', TX: 'Texas', WA: 'Washington', WI: 'Wisconsin' };

async function forecast(lat, lon, kickoff) {
  const day = kickoff.slice(0, 10);
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&start_date=${day}&end_date=${day}`);
  const times = j.hourly?.time || [];
  if (!times.length) return null;
  const target = new Date(kickoff).getTime() + 90 * 60000; // mid-game
  let best = 0, bestD = Infinity;
  times.forEach((t, i) => { const d = Math.abs(new Date(t + 'Z').getTime() - target); if (d < bestD) { bestD = d; best = i; } });
  return { temp: j.hourly.temperature_2m[best], wind: j.hourly.wind_speed_10m[best], gust: j.hourly.wind_gusts_10m?.[best] ?? null, precip: j.hourly.precipitation_probability?.[best] ?? 0 };
}

export async function fetchWeek(year, week) {
  let sb;
  try { sb = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${year}`); }
  catch { return { games: [], byPro: {}, provider: null }; }
  const now = Date.now();
  const games = [];
  for (const ev of sb.events || []) {
    const c = ev.competitions?.[0]; if (!c) continue;
    const home = c.competitors.find((x) => x.homeAway === 'home'), away = c.competitors.find((x) => x.homeAway === 'away');
    if (!home || !away) continue;
    const odds = parseOdds(c);
    const v = c.venue || {};
    const state = (c.status || ev.status)?.type?.state || 'pre';
    const g = {
      id: ev.id, kickoff: ev.date, state, status: (c.status || ev.status)?.type?.shortDetail || '',
      homeId: Number(home.team.id), awayId: Number(away.team.id),
      home: { abbr: home.team.abbreviation, name: home.team.shortDisplayName || home.team.displayName, score: home.score != null ? Number(home.score) : null },
      away: { abbr: away.team.abbreviation, name: away.team.shortDisplayName || away.team.displayName, score: away.score != null ? Number(away.score) : null },
      venue: v.fullName || '', city: v.address?.city || '', st: v.address?.state || '', indoor: !!v.indoor,
      odds, weather: null,
    };
    if (odds && odds.total != null && odds.line != null) {
      const favH = odds.favId === g.homeId;
      const favImp = odds.total / 2 + odds.line / 2, dogImp = odds.total / 2 - odds.line / 2;
      g.home.implied = Math.round((favH ? favImp : dogImp) * 10) / 10;
      g.away.implied = Math.round((favH ? dogImp : favImp) * 10) / 10;
      g.home.line = odds.favId == null ? 0 : favH ? -odds.line : odds.line;
      g.away.line = -g.home.line;
    }
    if (ev.weather && ev.weather.temperature != null) g.weather = { temp: Number(ev.weather.temperature), wind: null, precip: null, text: ev.weather.displayValue || '' };
    games.push(g);
  }
  // stadium forecasts for outdoor games kicking off in the next 7 days
  await Promise.all(games.map(async (g) => {
    if (g.indoor || g.state !== 'pre' || !g.city) return;
    const t = new Date(g.kickoff).getTime();
    if (t - now > 7 * 86400000 || t < now - 6 * 3600000) return;
    try {
      const geo = await geocode(g.city, STATES[g.st] || g.st);
      if (!geo) return;
      const wx = await forecast(geo.lat, geo.lon, g.kickoff);
      if (wx) g.weather = { ...wx, text: g.weather?.text || '' };
    } catch { /* forecast unavailable */ }
  }));
  const byPro = {};
  for (const g of games) {
    for (const [me, them, side, other] of [[g.homeId, g.awayId, g.home, g.away], [g.awayId, g.homeId, g.away, g.home]]) {
      byPro[me] = { opp: them, implied: side.implied ?? null, opp_implied: other.implied ?? null, line: side.line ?? null, total: g.odds?.total ?? null, indoor: g.indoor, weather: g.weather, kickoff: g.kickoff, state: g.state };
    }
  }
  const provider = games.find((g) => g.odds?.provider)?.odds.provider || null;
  return { games, byPro, provider };
}
