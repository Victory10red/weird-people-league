// The Dump Log: league members tally bathroom trips. Every entry is { t: teamId, at: ms }.
// GET  /api/poop                       -> { ready, log: [...] } newest first
// POST /api/poop { team }              -> log one (at most one per 2 minutes per person)
// POST /api/poop { team, action:'undo'} -> remove that person's most recent entry if it's under 10 minutes old
import { redis } from '../lib/kv.js';

const KEY = 'poop:log', KEEP = 20000;
const parse = (arr) => (arr || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false, log: [] });
  try {
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const team = Number(b.team);
      if (!Number.isInteger(team) || team < 1 || team > 99) return res.status(400).json({ error: 'Pick who you are first' });
      const [recent] = await run([['LRANGE', KEY, 0, 199]]);
      const raw = recent || [], mineIdx = parse(raw).findIndex((e) => e.t === team);
      const last = mineIdx >= 0 ? parse([raw[mineIdx]])[0] : null;
      if (b.action === 'undo') {
        if (last && Date.now() - last.at < 10 * 60000) await run([['LREM', KEY, 1, raw[mineIdx]]]);
      } else {
        if (last && Date.now() - last.at < 2 * 60000) {
          const [all] = await run([['LRANGE', KEY, 0, KEEP - 1]]);
          return res.status(429).json({ ready: true, error: 'Easy there. One every 2 minutes.', log: parse(all) });
        }
        await run([['LPUSH', KEY, JSON.stringify({ t: team, at: Date.now() })], ['LTRIM', KEY, 0, KEEP - 1]]);
      }
    }
    const [all] = await run([['LRANGE', KEY, 0, KEEP - 1]]);
    return res.status(200).json({ ready: true, log: parse(all) });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Dump Log unavailable (${e.message})`, log: [] });
  }
}
