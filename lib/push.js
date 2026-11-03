// Push notifications. Keys are generated once and kept in the league database, so there's nothing to set
// up in Vercel. Subscriptions: hash push:subs  endpointHash -> { team, sub, prefs, at }.
import webpush from 'web-push';
import crypto from 'node:crypto';

const SITE = 'https://weird-people-league.vercel.app';
export const DEFAULT_PREFS = { lineup: true, scores: true, talk: true, pickem: true };

export async function vapid(run) {
  const [raw] = await run([['GET', 'push:vapid']]);
  if (raw) return JSON.parse(raw);
  const keys = webpush.generateVAPIDKeys();
  const [ok] = await run([['SET', 'push:vapid', JSON.stringify(keys), 'NX']]);
  if (ok) return keys;
  const [again] = await run([['GET', 'push:vapid']]); // someone else made them first
  return JSON.parse(again);
}

export const subId = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

export async function allSubs(run) {
  const [flat] = await run([['HGETALL', 'push:subs']]);
  const out = [];
  for (let i = 0; i < (flat || []).length; i += 2) { try { out.push({ id: flat[i], ...JSON.parse(flat[i + 1]) }); } catch { /* skip */ } }
  return out;
}

// send one message to every subscribed device of the given teams (that want this kind of alert)
export async function notify(run, teams, kind, msg, subs) {
  const want = new Set((Array.isArray(teams) ? teams : [teams]).map(Number));
  if (!want.size) return 0;
  subs = subs || await allSubs(run);
  const keys = await vapid(run);
  webpush.setVapidDetails(SITE, keys.publicKey, keys.privateKey);
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url || '/', tag: msg.tag || kind });
  let sent = 0; const dead = [];
  await Promise.all(subs.filter((s) => want.has(Number(s.team)) && (s.prefs || DEFAULT_PREFS)[kind] !== false).map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 3600, urgency: kind === 'talk' ? 'normal' : 'high' }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.id); } // phone unsubscribed or app removed
  }));
  if (dead.length) await run([['HDEL', 'push:subs', ...dead]]);
  return sent;
}
