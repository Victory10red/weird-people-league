// Player research
// GET /api/players?k=wire      -> free agents / waivers by position with their last 4 weeks of usage stats
// GET /api/players?k=injuries  -> NFL injury report for fantasy positions (status, body part, estimated return, note)
// GET /api/players?k=depth     -> depth charts (QB/RB/WR/TE/K) for every NFL team, with names
import { redis } from '../lib/kv.js';
import { fetchWire, fetchInjuries, fetchDepth } from '../lib/players.js';

const TTL = { wire: 900, injuries: 1800, depth: 6 * 3600 }; // seconds
const LOAD = { wire: fetchWire, injuries: fetchInjuries, depth: fetchDepth };

export default async function handler(req, res) {
  const k = String((req.query || {}).k || '');
  if (!LOAD[k]) return res.status(400).json({ error: 'Unknown' });
  const run = redis(), key = `players:${k}`;
  try {
    let data = null;
    if (run) { try { const [hit] = await run([['GET', key]]); if (hit) data = JSON.parse(hit); } catch { /* cache optional */ } }
    if (!data) {
      data = await LOAD[k]();
      if (run) { try { await run([['SET', key, JSON.stringify(data), 'EX', TTL[k]]]); } catch { /* cache optional */ } }
    }
    res.setHeader('Cache-Control', `public, s-maxage=${Math.min(600, TTL[k])}, stale-while-revalidate=${TTL[k]}`);
    return res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: `Couldn't load from ESPN (${e.message}).` });
  }
}
