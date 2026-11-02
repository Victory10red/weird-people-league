// Every Tuesday (Vercel cron, see vercel.json) the League Bot roasts the lowest scorer of the week
// that just finished in Trash Talk. Posts at most once per week, so extra calls do nothing.
import { fetchDump } from '../lib/espn.js';
import { analyze } from '../lib/analyze.js';
import { redis } from '../lib/kv.js';
import { weeklyRoast } from '../lib/autoroast.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Cron only' });
  const run = redis();
  if (!run) return res.status(200).json({ posted: false, why: 'no database' });
  try {
    const dump = await fetchDump();
    const out = analyze(dump, { week: null });
    const r = weeklyRoast(out);
    if (!r) return res.status(200).json({ posted: false, why: 'no finished week yet' });
    // only roast the week that just ended: if ESPN hasn't closed it out yet, the newest finished week is
    // the one before, and the next week already has points on the board. Wait for the next run instead.
    const nextPts = dump.sched.filter((m) => m.wk === r.week + 1).reduce((s, m) => s + (m.hp || 0) + (m.ap || 0), 0);
    if (nextPts > 0) return res.status(200).json({ posted: false, why: `week ${r.week + 1} is still being closed out` });
    const [fresh] = await run([['SET', `autoroast:${r.year}:${r.week}`, '1', 'NX', 'EX', 60 * 86400]]);
    if (!fresh) return res.status(200).json({ posted: false, why: `week ${r.week} already roasted` });
    const at = Date.now(), id = at.toString(36) + 'bot';
    await run([['HSET', 'talk:m', id, JSON.stringify({ id, t: 0, bot: true, text: r.text, gif: null, at, re: {} })], ['ZADD', 'talk:z', at, id]]);
    return res.status(200).json({ posted: true, week: r.week, text: r.text });
  } catch (e) {
    return res.status(502).json({ posted: false, error: e.message });
  }
}
