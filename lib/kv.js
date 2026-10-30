// Upstash Redis over REST (free tier via Vercel's Storage / Marketplace). Returns null if not set up.
export function creds() {
  // Vercel names these <PREFIX>_REST_API_URL / _TOKEN (prefix KV, STORAGE, or whatever was typed at install)
  const env = process.env, keys = Object.keys(env);
  const find = (re) => { const k = keys.find((x) => re.test(x) && !/READ_ONLY/.test(x)); return k ? env[k] : null; };
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || find(/_REST_API_URL$/) || find(/REDIS_REST_URL$/);
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || find(/_REST_API_TOKEN$/) || find(/REDIS_REST_TOKEN$/);
  return { url, token };
}

export function redis() {
  const { url, token } = creds();
  if (!url || !token) return null;
  return async (cmds) => {
    const r = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
    if (!r.ok) throw new Error(`storage ${r.status}`);
    return (await r.json()).map((x) => x.result);
  };
}
