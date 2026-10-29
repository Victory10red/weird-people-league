import { fetchLive, nflRemaining } from '../lib/espn.js';
import { liveScores } from '../lib/live.js';

export default async function handler(req, res) {
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
