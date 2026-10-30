// "Last seen" for the commissioner, by the name each person picked in the app (honor system).
// POST /api/seen { team }                    -> records a visit (at most one per 10 minutes)
// GET  /api/seen?team=4&token=...           -> commissioner only: { rows: [{ id, last, first, visits, pin }] }
import { redis } from '../lib/kv.js';
import { verify, ADMIN_TEAM } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false });
  try {
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const team = Number(b.team);
      if (!Number.isInteger(team) || team < 1 || team > 99) return res.status(400).json({ error: 'team?' });
      const now = Date.now(), k = String(team);
      const [last] = await run([['HGET', 'seen:last', k]]);
      if (!last || now - Number(last) > 10 * 60000) await run([['HINCRBY', 'seen:visits', k, 1]]);
      await run([['HSET', 'seen:last', k, String(now)], ['HSETNX', 'seen:first', k, String(now)]]);
      return res.status(200).json({ ok: true });
    }
    const team = Number(req.query?.team);
    if (team !== ADMIN_TEAM || !(await verify(run, team, req.query?.token))) return res.status(403).json({ error: 'App admin only' });
    const [last, first, visits, pins] = await run([['HGETALL', 'seen:last'], ['HGETALL', 'seen:first'], ['HGETALL', 'seen:visits'], ['HKEYS', 'pins']]);
    const obj = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = Number(flat[i + 1]); return o; };
    const L = obj(last), F = obj(first), V = obj(visits), P = new Set((pins || []).map(String));
    const ids = new Set([...Object.keys(L), ...P]);
    return res.status(200).json({ ready: true, rows: [...ids].map((id) => ({ id: Number(id), last: L[id] || null, first: F[id] || null, visits: V[id] || 0, pin: P.has(id) })) });
  } catch (e) {
    return res.status(502).json({ error: `Unavailable (${e.message})` });
  }
}
