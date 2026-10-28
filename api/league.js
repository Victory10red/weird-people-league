import { fetchDump } from '../lib/espn.js';
import { fetchWeek } from '../lib/week.js';
import { analyze } from '../lib/analyze.js';

export default async function handler(req, res) {
  try {
    const dump = await fetchDump();
    const week = await fetchWeek(dump.status.year, dump.status.week).catch(() => null);
    const out = analyze(dump, { week });
    out.updated = new Date().toISOString();
    // recomputed at most every 5 minutes; visitors get the cached copy instantly
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).json(out);
  } catch (e) {
    const privateLeague = e.status === 401 || e.status === 403;
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: privateLeague
        ? 'ESPN says this league is private. The League Manager can turn on "Make League Viewable to Public", or the app owner can add ESPN login cookies in Vercel.'
        : `Couldn't load the league from ESPN (${e.message}).`,
    });
  }
}
