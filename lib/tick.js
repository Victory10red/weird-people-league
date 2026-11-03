// Game-day checker: runs every few minutes during NFL games (GitHub Actions, see .github/workflows/gameday.yml).
// Compares live scores with what it saw last time and sends push alerts for what changed:
//   lineup  - a starter is OUT/IR/suspended (or on bye) and his game kicks off within ~100 minutes
//   scores  - lead changes, big plays (+6 or more for one player), final results
//   pickem  - Pick'em games locking within the hour that you haven't picked
import { fetchLive, nflRemaining } from './espn.js';
import { liveScores } from './live.js';
import { fetchSlate } from './week.js';
import { allSubs, notify } from './push.js';

const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const ct = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
const DEAD = /^(OUT|INJURY_RESERVE|SUSPENSION)$/;

// Pure: given live scores, the NFL slate, last check's state, Pick'em picks and who has alerts on,
// work out which alerts to send. Returns { alerts: [{ teams, kind, title, body, tag }], st }.
export function planAlerts({ live, slate, st, picks = {}, subTeams = [], names = {}, now = Date.now() }) {
  st = st ? JSON.parse(JSON.stringify(st)) : null;
  const first = !st; if (!st) st = { lead: {}, pts: {}, sent: {} };
  const alerts = [], plays = [];
  const send = (teams, kind, title, body, tag) => alerts.push({ teams: [].concat(teams), kind, title, body, tag });
  const once = (k) => { if (st.sent[k]) return false; st.sent[k] = 1; return true; };
  const kick = {}; for (const g of slate) { kick[g.home.abbr] = g; kick[g.away.abbr] = g; }
  const firstKick = slate.length ? Math.min(...slate.map((x) => new Date(x.kickoff).getTime())) : Infinity;
  const nm = (id) => names[id] || 'your opponent';
  for (const g of live.games) {
    const key = `${g.h.id}-${g.a.id}`;
    // 1. dead spots in the lineup, shortly before kickoff (no schedule = can't tell byes from outages, so skip)
    if (slate.length) for (const me of [g.h, g.a]) for (const r of me.rows) {
      const game = kick[r.nfl], ko = game ? new Date(game.kickoff).getTime() : null;
      const out = DEAD.test(r.inj || '') && ko && ko > now && ko - now < 100 * 60000;
      const bye = !game && r.proj === 0 && now > firstKick - 100 * 60000;
      if ((out || bye) && once(`out:${me.id}:${r.pid}`)) {
        send(me.id, 'lineup', `⚠️ ${r.name} is ${bye ? 'on bye' : String(r.inj).replace('INJURY_RESERVE', 'on IR').toLowerCase()}`,
          bye ? 'He’s in your lineup and won’t play this week. Swap him in ESPN.' : `He’s in your lineup and his game kicks off at ${ct(game.kickoff)} CT. Swap him in ESPN before then.`, `out-${r.pid}`);
      }
    }
    if (!first) {
      // 2. big plays: a starter up 6+ since the last check
      if (!g.done) for (const [me, them] of [[g.h, g.a], [g.a, g.h]]) {
        const pop = me.rows.map((r) => ({ r, d: r.pts - (st.pts[r.pid] ?? r.pts) })).filter((x) => x.d >= 6).sort((a, b) => b.d - a.d)[0];
        if (pop && once(`pop:${pop.r.pid}:${Math.round(pop.r.pts)}`)) {
          const { r, d } = pop, score = `${f1(me.pts)}–${f1(them.pts)}`, up = me.pts >= them.pts;
          plays.push({ key, team: me.id, text: `${r.name} +${f1(d)}` });
          send(me.id, 'scores', `🔥 ${r.name} +${f1(d)}`, `Now ${f1(r.pts)} for you. You ${up ? 'lead' : 'trail'} ${nm(them.id)} ${score}.`, `pop-${me.id}`);
          send(them.id, 'scores', `😬 ${r.name} just hit you for +${f1(d)}`, `${nm(me.id)} ${up ? 'leads' : 'trails'} ${score}.`, `pop-${them.id}`);
        }
      }
      // 3. lead changes, once there's real scoring on the board
      const leader = g.h.pts > g.a.pts ? g.h.id : g.a.pts > g.h.pts ? g.a.id : null;
      if (leader && st.lead[key] && st.lead[key] !== leader && g.h.pts + g.a.pts >= 20 && !g.done) {
        const W = leader === g.h.id ? g.h : g.a, L = leader === g.h.id ? g.a : g.h;
        const lwp = Math.round(100 * (leader === g.h.id ? 1 - g.hwin : g.hwin));
        send(W.id, 'scores', '📈 You took the lead', `${nm(W.id)} ${f1(W.pts)} – ${f1(L.pts)} ${nm(L.id)}`, `lead-${key}`);
        send(L.id, 'scores', `📉 ${nm(W.id)} just passed you`, `${f1(L.pts)} – ${f1(W.pts)}. ${lwp}% to win from here.`, `lead-${key}`);
      }
      // 4. final
      if (g.done && once(`final:${key}`)) for (const [me, them] of [[g.h, g.a], [g.a, g.h]]) {
        send(me.id, 'scores', me.pts > them.pts ? `✅ Final: you beat ${nm(them.id)}` : `❌ Final: ${nm(them.id)} beat you`, `${f1(me.pts)} – ${f1(them.pts)}`, `final-${key}`);
      }
    }
    const leader = g.h.pts > g.a.pts ? g.h.id : g.a.pts > g.h.pts ? g.a.id : null;
    if (leader) st.lead[key] = leader;
    for (const s of [g.h, g.a]) for (const r of s.rows) st.pts[r.pid] = r.pts;
  }
  // 5. Pick'em: games locking within the hour that you haven't picked
  const soon = slate.filter((x) => x.state === 'pre' && new Date(x.kickoff).getTime() > now && new Date(x.kickoff).getTime() - now < 60 * 60000);
  if (soon.length) {
    const win = soon[0].kickoff;
    for (const team of subTeams) {
      const missing = soon.filter((x) => !(picks[team] || {})[x.id]).length;
      if (missing && once(`pk:${team}:${win}`)) send(team, 'pickem', `🏆 Pick'em locks at ${ct(win)} CT`, `${missing} game${missing === 1 ? '' : 's'} kicking off soon ${missing === 1 ? 'doesn’t' : 'don’t'} have your pick yet.`, `pk-${win}`);
    }
  }
  return { alerts, st, plays };
}

// win-odds over the day for every matchup: hash wp:{year}:{week}  "h-a" -> [[time, homeWin, homePts, awayPts, notes?], ...]
async function recordOdds(run, live, plays) {
  const key = `wp:${live.year}:${live.week}`;
  const [flat] = await run([['HGETALL', key]]);
  const cur = {}; for (let i = 0; i < (flat || []).length; i += 2) { try { cur[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* skip */ } }
  const now = Date.now(), writes = [];
  for (const g of live.games) {
    const k = `${g.h.id}-${g.a.id}`, arr = cur[k] || [], last = arr[arr.length - 1];
    const notes = plays.filter((p) => p.key === k).map((p) => `${p.team === g.h.id ? 'H' : 'A'}:${p.text}`);
    const changed = !last || Math.abs(last[1] - g.hwin) >= 0.005 || last[2] !== g.h.pts || last[3] !== g.a.pts || notes.length;
    if (!changed && now - last[0] < 30 * 60000) continue;
    if (last && last[4] === undefined && g.done && last[1] === g.hwin) continue;
    arr.push(notes.length ? [now, g.hwin, g.h.pts, g.a.pts, notes] : [now, g.hwin, g.h.pts, g.a.pts]);
    writes.push(k, JSON.stringify(arr.slice(-400)));
  }
  if (writes.length) await run([['HSET', key, ...writes], ['EXPIRE', key, 120 * 86400]]);
}
export async function tick(run, { force = false } = {}) {
  if (!force) { const [go] = await run([['SET', 'push:tick', '1', 'NX', 'PX', 110000]]); if (!go) return { skipped: 'ran recently' }; }
  const subs = await allSubs(run);
  const raw = await fetchLive();
  const live = liveScores(raw, await nflRemaining(raw.year, raw.week));
  const slate = await fetchSlate(live.year, live.week, 60000).catch(() => []);
  const stKey = `push:st:${live.year}:${live.week}`;
  const [stRaw, pickFlat] = await run([['GET', stKey], ['HGETALL', `pick:${live.year}:${live.week}`]]);
  const picks = {}; for (let i = 0; i < (pickFlat || []).length; i += 2) { try { picks[pickFlat[i]] = JSON.parse(pickFlat[i + 1]); } catch { /* skip */ } }
  const names = {}; for (const g of raw.games) for (const s of [g.h, g.a]) names[s.id] = s.name;
  const { alerts, st, plays } = planAlerts({ live, slate, st: stRaw ? JSON.parse(stRaw) : null, picks, subTeams: [...new Set(subs.map((s) => Number(s.team)))], names });
  await recordOdds(run, live, plays);
  const sent = [];
  if (subs.length) for (const a of alerts) sent.push({ ...a, n: await notify(run, a.teams, a.kind, { title: a.title, body: a.body, tag: a.tag, url: a.kind === 'pickem' ? '/#play' : '/#team' }, subs) });
  await run([['SET', stKey, JSON.stringify(st), 'EX', 10 * 86400]]);
  return { week: live.week, sent };
}
