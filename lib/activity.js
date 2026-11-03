// Admin-only activity log: who did what, when, and on what kind of device. No IP addresses.
// Each entry: { at, t (team id, 0 = anonymous), a (action), d (detail), dev (device type) }
const KEY = 'act:log', KEEP = 3000;

export function deviceOf(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

// fire-and-forget: logging must never break the action it describes
export async function logAct(run, req, t, a, d = '') {
  try {
    const e = { at: Date.now(), t: Number(t) || 0, a, d: String(d || '').slice(0, 140), dev: deviceOf(req) };
    await run([['LPUSH', KEY, JSON.stringify(e)], ['LTRIM', KEY, 0, KEEP - 1]]);
  } catch { /* ignore */ }
}

export async function readAct(run, n = 500) {
  const [raw] = await run([['LRANGE', KEY, 0, n - 1]]);
  return (raw || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
}
