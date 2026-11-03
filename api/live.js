import { redis } from '../lib/kv.js';
import { fetchLive, nflRemaining } from '../lib/espn.js';
import { liveScores } from '../lib/live.js';

export default async function handler(req, res) {
  // win-odds history for the chart: GET /api/live?series=1&year=2026&week=8
  if (req.query && req.query.series) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    const run = redis(); if (!run) return res.status(200).json({ series: {} });
    try {
      const [flat] = await run([['HGETALL', `wp:${Number(req.query.year)}:${Number(req.query.week)}`]]);
      const series = {}; for (let i = 0; i < (flat || []).length; i += 2) { try { series[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* skip */ } }
      return res.status(200).json({ series });
    } catch (e) { return res.status(200).json({ series: {}, error: e.message }); }
  }
  try {
    const want = Number(req.query?.week) || null;
    const live = await fetchLive({ week: want });
    const clocks = await nflRemaining(live.year, live.week);
    const out = liveScores(live, clocks);
    // finished weeks never change; the current week refreshes fast while games are on
    const past = out.week < out.current;
    res.setHeader('Cache-Control', past ? 'public, s-maxage=21600, stale-while-revalidate=86400' : out.anyLive ? 'public, s-maxage=30, stale-while-revalidate=60' : 'public, s-maxage=300, stale-while-revalidate=900');
    res.status(200).json(out);
  } catch (e) {
    const privateLeague = e.status === 401 || e.status === 403;
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: privateLeague ? 'ESPN says this league is private.' : `Couldn't load live scores (${e.message}).` });
  }
}
