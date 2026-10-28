import { fetchLive, nflRemaining } from '../lib/espn.js';
import { liveScores } from '../lib/live.js';

export default async function handler(req, res) {
  try {
    const live = await fetchLive();
    const clocks = await nflRemaining(live.year, live.week);
    const out = liveScores(live, clocks);
    // short cache while games are on, longer otherwise
    res.setHeader('Cache-Control', out.anyLive ? 'public, s-maxage=30, stale-while-revalidate=60' : 'public, s-maxage=300, stale-while-revalidate=900');
    res.status(200).json(out);
  } catch (e) {
    const privateLeague = e.status === 401 || e.status === 403;
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: privateLeague ? 'ESPN says this league is private.' : `Couldn't load live scores (${e.message}).` });
  }
}
