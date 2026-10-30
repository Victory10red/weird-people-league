// GET  /api/pin?team=4                     -> { ready, has }
// POST /api/pin { team, pin }               -> { ok, token, created } (first time sets the PIN)
// POST /api/pin { action:'reset', target, team, token } -> commissioner clears someone's PIN
import { redis } from '../lib/kv.js';
import { hashPin, tokenFor, verify, ADMIN_TEAM } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false });
  try {
    if (req.method !== 'POST') {
      const team = Number(req.query?.team);
      if (!Number.isInteger(team)) return res.status(400).json({ error: 'team?' });
      const [h] = await run([['HGET', 'pins', String(team)]]);
      return res.status(200).json({ ready: true, has: !!h });
    }
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const team = Number(b.team);
    if (!Number.isInteger(team) || team < 1 || team > 99) return res.status(400).json({ error: 'Pick who you are first' });
    if (b.action === 'reset') {
      if (team !== ADMIN_TEAM || !(await verify(run, team, b.token))) return res.status(403).json({ error: 'App admin only' });
      const target = Number(b.target);
      if (!Number.isInteger(target)) return res.status(400).json({ error: 'Who?' });
      await run([['HDEL', 'pins', String(target)], ['DEL', `pinfail:${target}`]]);
      return res.status(200).json({ ok: true });
    }
    if (team !== ADMIN_TEAM) return res.status(403).json({ error: 'Only the app admin uses a PIN' });
    const pin = String(b.pin || '');
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
    const [h, fails] = await run([['HGET', 'pins', String(team)], ['GET', `pinfail:${team}`]]);
    if (Number(fails) >= 8) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes or ask Trevor to reset it.' });
    if (!h) { // first time: this PIN becomes theirs
      const nh = hashPin(team, pin);
      await run([['HSET', 'pins', String(team), nh]]);
      return res.status(200).json({ ok: true, created: true, token: tokenFor(team, nh) });
    }
    if (hashPin(team, pin) !== h) {
      await run([['INCR', `pinfail:${team}`], ['EXPIRE', `pinfail:${team}`, 900]]);
      return res.status(401).json({ error: 'Wrong PIN' });
    }
    await run([['DEL', `pinfail:${team}`]]);
    return res.status(200).json({ ok: true, token: tokenFor(team, h) });
  } catch (e) {
    return res.status(502).json({ error: `PIN check unavailable (${e.message})` });
  }
}
