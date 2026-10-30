// League leaderboards for the Play tab games. Stored in Upstash Redis (free tier, added through
// Vercel's Storage tab), which exposes a REST endpoint and token as environment variables.
// GET  /api/scores            -> { ready, boards: { 'bk:hard': [{ id, score, at }], ... } }
// POST /api/scores {game, level, team, score} -> same shape, after saving a personal best

import { redis } from '../lib/kv.js';
import { verify, ADMIN_TEAM } from '../lib/auth.js';

const BOARDS = { bk: ['rookie', 'pro', 'hard', 'extreme'], hol: ['week', 'any', 'season'] };
const MAX = { bk: 20000, hol: 500 }; // sanity caps so a typo or a tampered request can't top the board forever

async function readBoards(run) {
  const keys = Object.entries(BOARDS).flatMap(([g, ls]) => ls.map((l) => `${g}:${l}`));
  const res = await run(keys.map((k) => ['HGETALL', `lb:${k}`]));
  const boards = {};
  keys.forEach((k, i) => {
    const flat = res[i] || [];
    const rows = [];
    for (let j = 0; j < flat.length; j += 2) {
      try { const v = JSON.parse(flat[j + 1]); rows.push({ id: Number(flat[j]), score: v.s, at: v.at }); } catch { /* skip bad row */ }
    }
    boards[k] = rows.sort((a, b) => b.score - a.score || a.at - b.at);
  });
  return boards;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false, boards: {} });
  try {
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const game = String(b.game || ''), level = String(b.level || ''), team = Number(b.team), score = Math.floor(Number(b.score));
      if (b.action === 'remove') {
        if (!BOARDS[game] || !BOARDS[game].includes(level) || !Number.isInteger(team)) return res.status(400).json({ error: 'Bad request' });
        // only the commissioner (unlocked with his PIN) can take scores off the board
        if (!(await verify(run, ADMIN_TEAM, b.token))) return res.status(403).json({ error: 'Commissioner only' });
        await run([['HDEL', `lb:${game}:${level}`, String(team)]]);
        return res.status(200).json({ ready: true, removed: true, boards: await readBoards(run) });
      }
      if (!BOARDS[game] || !BOARDS[game].includes(level) || !Number.isInteger(team) || team < 1 || team > 99 || !Number.isFinite(score) || score < 0 || score > MAX[game]) {
        return res.status(400).json({ error: 'Bad score' });
      }
      const key = `lb:${game}:${level}`;
      const [cur] = await run([['HGET', key, String(team)]]);
      let prev = -1; try { prev = cur ? JSON.parse(cur).s : -1; } catch { prev = -1; }
      if (score > prev) await run([['HSET', key, String(team), JSON.stringify({ s: score, at: Date.now() })]]);
      return res.status(200).json({ ready: true, saved: score > prev, boards: await readBoards(run) });
    }
    return res.status(200).json({ ready: true, boards: await readBoards(run) });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Leaderboard unavailable (${e.message})`, boards: {} });
  }
}
