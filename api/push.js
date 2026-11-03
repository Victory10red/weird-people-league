// Push notifications.
// GET  /api/push                                   -> { ready, key }  (public key for subscribing)
// POST /api/push { action:'on', team, sub, prefs } -> save this phone's subscription
// POST /api/push { action:'off', endpoint }        -> remove it
// POST /api/push { action:'prefs', endpoint, prefs }
// POST /api/push { action:'test', endpoint }       -> send a test to this phone
// GET  /api/push?tick=1                            -> game-day checker (called every few minutes during games)
import { redis } from '../lib/kv.js';
import { vapid, subId, notify, DEFAULT_PREFS } from '../lib/push.js';
import { tick } from '../lib/tick.js';
import { logAct } from '../lib/activity.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false });
  try {
    if (req.query && req.query.tick) return res.status(200).json(await tick(run));
    if (req.method !== 'POST') return res.status(200).json({ ready: true, key: (await vapid(run)).publicKey });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prefs = (p) => Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, p && p[k] === false ? false : true]));
    if (b.action === 'on') {
      const team = Number(b.team);
      if (!Number.isInteger(team) || team < 1 || team > 99 || !b.sub || !b.sub.endpoint) return res.status(400).json({ error: 'Bad subscription' });
      await run([['HSET', 'push:subs', subId(b.sub.endpoint), JSON.stringify({ team, sub: b.sub, prefs: prefs(b.prefs), at: Date.now() })]]);
      await logAct(run, req, team, 'push-on');
      return res.status(200).json({ ok: true });
    }
    const id = subId(b.endpoint || '');
    const [cur] = await run([['HGET', 'push:subs', id]]);
    if (!cur) return res.status(404).json({ error: 'This phone isn’t subscribed.' });
    const s = JSON.parse(cur);
    if (b.action === 'off') { await run([['HDEL', 'push:subs', id]]); await logAct(run, req, s.team, 'push-off'); return res.status(200).json({ ok: true }); }
    if (b.action === 'prefs') { s.prefs = prefs(b.prefs); await run([['HSET', 'push:subs', id, JSON.stringify(s)]]); return res.status(200).json({ ok: true }); }
    if (b.action === 'test') {
      const [ok] = await run([['SET', `push:test:${id}`, '1', 'NX', 'EX', 30]]);
      if (!ok) return res.status(429).json({ error: 'One test every 30 seconds.' });
      const n = await notify(run, s.team, 'test', { title: '🏈 League HQ notifications are on', body: 'This is what an alert looks like. Lead changes, big plays and lineup warnings will show up like this.', url: '/#team', tag: 'test' }, [{ id, ...s, prefs: { test: true } }]);
      return res.status(200).json({ ok: n > 0, sent: n });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Notifications unavailable (${e.message})` });
  }
}
