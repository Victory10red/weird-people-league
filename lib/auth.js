// Commissioner PIN (only Trevor has one now). The PIN itself is never stored, only a salted hash; the browser keeps a token
// derived from that hash, so it never has to remember the PIN either.
import crypto from 'node:crypto';
import { creds } from './kv.js';

export const ADMIN_TEAM = 4; // the commissioner (Trevor) can reset a forgotten PIN and remove any score
const secret = () => process.env.PIN_SECRET || creds().token || 'weird-people';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hashPin = (team, pin) => sha(`pin|${team}|${pin}|${secret()}`);
export const tokenFor = (team, pinHash) => sha(`tok|${team}|${pinHash}|${secret()}`);

export async function verify(run, team, token) {
  if (!team || !token) return false;
  const [h] = await run([['HGET', 'pins', String(team)]]);
  if (!h) return false;
  const want = tokenFor(team, h);
  return want.length === String(token).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(token)));
}
