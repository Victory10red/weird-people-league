// Trash Talk wall. Messages: { id, t: teamId, text, gif, at, re: { '🔥': [teamIds] } }
// GET  /api/talk                                   -> { ready, msgs } newest first (last 300)
// POST /api/talk { action:'post', team, text, gif }
// POST /api/talk { action:'react', team, id, emoji } (toggles)
// POST /api/talk { action:'delete', team, id, token? } (your own, or any with the commissioner token)
import { redis } from '../lib/kv.js';
import { verify, ADMIN_TEAM } from '../lib/auth.js';

const EMOJI = ['🔥', '😂', '💀', '🤡', '💩', '🗑️'];
const KEEP = 300;

// accept GIF/image links from the usual places and turn page links into the actual image
function gifUrl(raw) {
  if (!raw) return null;
  let u; try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (h === 'giphy.com' || h === 'www.giphy.com') { // giphy.com/gifs/some-words-ID
    const id = (u.pathname.split('/').pop() || '').split('-').pop();
    return /^[A-Za-z0-9]+$/.test(id) ? `https://media.giphy.com/media/${id}/giphy.gif` : null;
  }
  if (/^(media\d*|i)\.giphy\.com$/.test(h)) return u.href;
  if (h === 'media.tenor.com' || /^c\.tenor\.com$/.test(h)) return u.href;
  if (h === 'i.imgur.com' && /\.(gif|png|jpe?g|webp)$/i.test(u.pathname)) return u.href;
  return null;
}

async function list(run) {
  const [ids] = await run([['ZREVRANGE', 'talk:z', 0, KEEP - 1]]);
  if (!ids || !ids.length) return [];
  const [vals] = await run([['HMGET', 'talk:m', ...ids]]);
  return (vals || []).map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const run = redis();
  if (!run) return res.status(200).json({ ready: false, msgs: [] });
  try {
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const team = Number(b.team);
      if (!Number.isInteger(team) || team < 1 || team > 99) return res.status(400).json({ error: 'Pick who you are first' });
      if (b.action === 'post') {
        const text = String(b.text || '').trim().slice(0, 600);
        const gif = b.gif ? gifUrl(b.gif) : null;
        if (b.gif && !gif) return res.status(400).json({ error: 'That GIF link didn’t work. Use a GIPHY or Tenor link.' });
        if (!text && !gif) return res.status(400).json({ error: 'Say something.' });
        const [ok] = await run([['SET', `talk:last:${team}`, '1', 'PX', 5000, 'NX']]);
        if (!ok) return res.status(429).json({ error: 'Slow down, killer. 5 seconds between posts.' });
        const at = Date.now(), id = at.toString(36) + Math.random().toString(36).slice(2, 6);
        await run([['HSET', 'talk:m', id, JSON.stringify({ id, t: team, text, gif, at, re: {} })], ['ZADD', 'talk:z', at, id]]);
        // keep the wall to the newest KEEP messages
        const [old] = await run([['ZRANGE', 'talk:z', 0, -(KEEP + 1)]]);
        if (old && old.length) await run([['ZREM', 'talk:z', ...old], ['HDEL', 'talk:m', ...old]]);
      } else if (b.action === 'react') {
        if (!EMOJI.includes(b.emoji)) return res.status(400).json({ error: 'Bad emoji' });
        const [v] = await run([['HGET', 'talk:m', String(b.id)]]);
        if (v) {
          const m = JSON.parse(v); const arr = (m.re[b.emoji] ||= []);
          const i = arr.indexOf(team); if (i >= 0) arr.splice(i, 1); else arr.push(team);
          if (!arr.length) delete m.re[b.emoji];
          await run([['HSET', 'talk:m', m.id, JSON.stringify(m)]]);
        }
      } else if (b.action === 'delete') {
        const [v] = await run([['HGET', 'talk:m', String(b.id)]]);
        if (v) {
          const m = JSON.parse(v);
          const admin = await verify(run, ADMIN_TEAM, b.token);
          if (m.t !== team && !admin) return res.status(403).json({ error: 'You can only delete your own posts' });
          await run([['HDEL', 'talk:m', m.id], ['ZREM', 'talk:z', m.id]]);
        }
      }
    }
    return res.status(200).json({ ready: true, msgs: await list(run) });
  } catch (e) {
    return res.status(502).json({ ready: false, error: `Trash Talk unavailable (${e.message})`, msgs: [] });
  }
}
