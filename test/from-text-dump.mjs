// Test helper: turn the text dump from the Claude refresh kit (pull.js) into the normalized dump analyze() reads.
import fs from 'node:fs';
export function fromTextDump(path) {
  const sec = {}; let cur = null;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    if (line.startsWith('#')) { const [h, ...meta] = line.slice(1).split('|'); cur = h; sec[cur] = []; if (meta.length) sec[cur + '_META'] = meta; continue; }
    sec[cur].push(line);
  }
  const num = (x) => (x === '' || x == null ? null : Number(x));
  const status = JSON.parse(sec.STATUS_META[0]);
  const settings = JSON.parse(sec.SETTINGS_META[0]);
  const owner = (s) => (s.split('~')[1] || s).trim();
  const players = {};
  for (const l of [...sec.PLAYERS, ...sec.XPLAYERS]) { const [id, name, pos, pro] = l.split('|'); players[id] = { name, pos: Number(pos), pro: Number(pro) }; }
  const dump = {
    leagueName: 'Weird people with free time', status, settings, players,
    sched: sec.SCHED.map((l) => { const [wk, h, a, hp, ap, win, tier] = l.split(','); return { wk: +wk, h: +h, a: a === '' ? null : +a, hp: +hp, ap: +ap, win, tier }; }),
    teams: sec.TEAMS.map((l) => { const [id, name, abbrev, ow, w, lo, t, pf, pa, seed] = l.split('|'); return { id: +id, name: name.trim(), abbrev, owner: owner(ow), w: +w, l: +lo, t: +t, pf: +pf, pa: +pa, seed: num(seed) }; }),
    rows: sec.ROWS.map((l) => { const [wk, tid, pid, slot, act, proj] = l.split(','); return { wk: +wk, tid: +tid, pid: +pid, slot: +slot, act: num(act), proj: num(proj) }; }),
    tx: sec.TX.map((l) => { const [wk, , type, tid, , items] = l.split('|'); return { wk: +wk, type, tid: +tid, items: (items || '').split(' ').filter(Boolean).map((it) => { const [t, pid, fr, to] = it.split(':'); return { type: t, pid: +pid, from: +fr, to: +to }; }) }; }),
    draft: sec.DRAFT.map((l) => { const [pick, rd, , tid, pid] = l.split('|'); return { pick: +pick, rd: +rd, tid: +tid, pid: +pid }; }),
    roster: sec.ROSTER.map((l) => { const [tid, pid, slot, inj, acq, pct, proj, ros, season] = l.split('|'); return { tid: +tid, pid: +pid, slot: +slot, inj, acq, pct: +pct, proj: num(proj), ros: num(ros), season: num(season) }; }),
    fa: sec.FA.map((l) => { const [id, name, pos, pro, st, inj, pct, , proj, ros, season] = l.split('|'); return { id: +id, name, pos: +pos, pro: +pro, status: st, inj, pct: +pct, proj: num(proj), ros: num(ros), season: num(season) }; }),
    hist: {},
  };
  for (const y of status.prev) {
    const teams = {};
    for (const l of sec[`H${y}TEAMS`]) { const [id, name, , ow, w, lo, , pf, , seed, rcf] = l.split('|'); teams[id] = { name, owner: owner(ow), w: +w, l: +lo, pf: +pf, seed: num(seed), final: num(rcf) }; }
    const games = sec[`H${y}SCHED`].map((l) => { const [wk, h, a, hp, ap, win, tier] = l.split('|'); return { wk: +wk, h: +h, a: a === '' ? null : +a, hp: +hp, ap: num(ap), win, tier }; }).filter((g) => g.a != null && g.win !== 'UNDECIDED');
    dump.hist[y] = { teams, games };
  }
  return dump;
}
