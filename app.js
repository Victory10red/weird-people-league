(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const f1 = d3.format('.1f');
  const pct = (v) => (v == null ? '–' : (Number.isInteger(v) ? v : f1(v)) + '%');
  const signed = (v) => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + f1(Math.abs(v)));
  const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (v != null) e.setAttribute(k, v); }
    for (const k of kids) if (k != null && k !== false) e.append(k);
    return e;
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const TABS = ['team', 'scores', 'week', 'league', 'trades', 'draft', 'history'];

  let D = null, LIVE = null, T = {};
  let team = Number(new URLSearchParams(location.search).get('team')) || Number(store.get('team')) || null;
  let tab = (location.hash || '#team').slice(1);
  if (tab === 'live') tab = 'scores';
  if (!TABS.includes(tab)) tab = 'team';
  let wvPos = 'ALL', yrSel = null, bumpFocus = null;

  // ---------- tooltip ----------
  const tipEl = $('#tip');
  const tip = {
    show(ev, head, body) {
      tipEl.replaceChildren(el('b', { text: head }), document.createTextNode(body));
      tipEl.hidden = false;
      const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, ev.clientX + 12);
      const y = Math.max(8, ev.clientY - tipEl.offsetHeight - 10);
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    },
    hide() { tipEl.hidden = true; },
  };
  document.addEventListener('scroll', () => tip.hide(), { passive: true });
  const hover = (sel, head, body) => sel.on('mousemove', (ev, d) => tip.show(ev, head(d), body(d))).on('mouseleave', () => tip.hide())
    .on('touchstart', (ev, d) => { const t = ev.touches[0]; tip.show({ clientX: t.clientX, clientY: t.clientY }, head(d), body(d)); }, { passive: true });

  // ---------- tables ----------
  function table(host, cols, rows, { isMe, sort } = {}) {
    let sortCol = sort ? sort[0] : null, dir = sort ? sort[1] : 1;
    const draw = () => {
      const data = sortCol ? [...rows].sort((a, b) => {
        const c = cols.find((c) => c.k === sortCol); const va = c.v ? c.v(a) : a[c.k], vb = c.v ? c.v(b) : b[c.k];
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''))) * dir;
      }) : rows;
      const thead = el('thead', {}, el('tr', {}, ...cols.map((c) => {
        const th = el('th', { class: c.n ? 'n' : '', text: c.h + (sortCol === c.k ? (dir > 0 ? ' ▲' : ' ▼') : '') });
        th.addEventListener('click', () => { if (sortCol === c.k) dir = -dir; else { sortCol = c.k; dir = c.n ? -1 : 1; } draw(); });
        return th;
      })));
      const tbody = el('tbody');
      if (!data.length) tbody.append(el('tr', {}, el('td', { class: 'empty', colspan: cols.length, text: 'Nothing here yet.' })));
      for (const r of data) {
        const tr = el('tr', { class: isMe && isMe(r) ? 'me' : '' });
        for (const c of cols) {
          const raw = c.v ? c.v(r) : r[c.k];
          const td = el('td', { class: (c.n ? 'n ' : '') + (c.cls ? c.cls(r) || '' : '') });
          if (c.bar) {
            const w = Math.max(2, Math.round(46 * (raw || 0) / 100));
            td.append(el('span', { class: 'cbar' }, el('i', { class: raw >= 50 ? 'hot' : '', style: `width:${w}px` }), el('span', { text: c.f ? c.f(raw, r) : raw })));
          } else td.textContent = c.f ? c.f(raw, r) : raw == null || raw === '' ? '–' : raw;
          tr.append(td);
        }
        tbody.append(tr);
      }
      host.replaceChildren(el('table', {}, thead, tbody));
    };
    draw();
  }

  // ---------- chart helpers ----------
  const W = (host) => Math.max(280, host.clientWidth || 600);
  const svgIn = (host, w, h) => { const s = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`); host.replaceChildren(s.node()); return s; };
  const textW = (svg, strs) => { const t = svg.append('text').attr('opacity', 0); let m = 0; for (const s of strs) { t.text(s); m = Math.max(m, t.node().getComputedTextLength()); } t.remove(); return m; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const empty = (host, msg) => host.replaceChildren(el('p', { class: 'note', text: msg }));

  function hbars(host, rows, { label, value, fmt, color, max, min = 0, tipHead, tipBody, bold }) {
    if (!rows.length) return empty(host, 'No data yet.');
    const w = W(host), rowH = 24, svg = svgIn(host, w, 10);
    const lw = Math.min(textW(svg, rows.map(label)) + 10, w * 0.45);
    const h = rows.length * rowH + 4; svg.attr('viewBox', `0 0 ${w} ${h}`);
    const lo = Math.min(min, d3.min(rows, value)), hi = max ?? (d3.max(rows, value) || 1);
    const x = d3.scaleLinear([lo, Math.max(hi, 0.0001)], [lw, w - 46]);
    const y = d3.scaleBand(rows.map((_, i) => i), [2, h - 2]).padding(0.28);
    if (lo < 0) svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h).attr('stroke', css('--line'));
    const g = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (_, i) => `translate(0,${y(i)})`);
    g.append('rect').attr('x', (d) => Math.min(x(0), x(value(d)))).attr('height', y.bandwidth()).attr('rx', 3).attr('width', (d) => Math.max(1, Math.abs(x(value(d)) - x(0)))).attr('fill', color);
    g.append('text').attr('x', lw - 8).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text(label).style('font-weight', (d) => (bold && bold(d) ? 700 : null));
    g.append('text').attr('class', 'muted').attr('x', (d) => Math.max(x(0), x(value(d))) + 5).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((d) => fmt(value(d)));
    g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, tipHead, tipBody));
  }

  // ---------- helpers ----------
  const tm = (id) => T[id] || { name: '?', owner: '' };
  const meRow = (r) => team != null && [r.id, r.h, r.a, r.a_id, r.b_id].includes(team);
  const myLive = () => LIVE && team ? LIVE.games.find((g) => g.h.id === team || g.a.id === team) : null;
  const myMatch = () => D && team ? D.matchups.find((m) => m.h === team || m.a === team) : null;
  const nflByAbbr = () => { const m = {}; for (const g of (D.nfl || [])) { m[g.home.abbr] = { g, me: g.home, them: g.away, home: true }; m[g.away.abbr] = { g, me: g.away, them: g.home, home: false }; } return m; };
  const kick = (iso) => { const d = new Date(iso); return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }); };
  const wxText = (g) => {
    if (!g) return '–';
    if (g.indoor) return 'Indoors';
    const w = g.weather; if (!w) return 'Forecast soon';
    const bits = [];
    if (w.temp != null) bits.push(`${Math.round(w.temp)}°`);
    if (w.wind != null) bits.push(`${Math.round(w.wind)} mph`);
    if (w.precip != null && w.precip >= 20) bits.push(`${w.precip}% precip`);
    if (!bits.length && w.text) bits.push(w.text);
    return bits.join(' · ');
  };

  function renderHeader() {
    const L = D.league;
    $('#sub').textContent = `${L.name} · ${L.year} · Week ${L.week} · updated ${new Date(D.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const sel = $('#team-pick');
    sel.replaceChildren(el('option', { value: '', text: 'Pick your team…' }), ...[...D.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => el('option', { value: t.id, text: `${t.name} (${t.owner})` })));
    sel.value = team ?? '';
    $$('.tname').forEach((n) => { n.textContent = team ? tm(team).name : 'pick a team'; });
    $$('.towner').forEach((n) => { n.textContent = team ? tm(team).owner : 'pick a team'; });
    $('#po-n').textContent = L.playoff_teams;
  }

  // ---------- live matchup pieces ----------
  function lineupList(s) {
    const by = D ? nflByAbbr() : {}, avg = (D && D.pavg) || {};
    const head = el('div', { class: 'luh' }, el('span'), el('span'), el('span', { text: 'Avg' }), el('span', { text: 'Proj' }), el('span', { text: 'Pts' }));
    return el('div', { class: 'lu' }, el('b', { text: s.name }), head, ...s.rows.map((r) => {
      const x = by[r.nfl];
      const opp = x ? `${x.home ? 'vs' : '@'} ${x.them.abbr}` : '';
      const when = r.state === 'pre' ? (x ? kick(x.g.kickoff) : 'Not started') : r.game;
      const wx = x && !x.g.indoor && x.g.weather && r.state === 'pre' ? wxFlag(x.g.weather, r.pos) : '';
      const a = avg[r.pid];
      const pctOfProj = r.state !== 'pre' && r.proj > 0 ? r.pts - r.proj : null;
      return el('div', { class: 'lur' + (r.state === 'in' ? ' in' : '') + (r.state === 'bye' ? ' bye' : '') },
        el('span', { class: 'muted', text: r.slot }),
        el('span', { class: 'who' }, el('span', { class: 'nm', text: r.name }), el('span', { class: 'st' }, `${r.nfl} ${opp} · ${when}`, wx ? el('em', { text: ' · ' + wx }) : null)),
        el('span', { class: 'num muted', text: a != null ? f1(a) : '–' }),
        el('span', { class: 'num muted', text: f1(r.proj) }),
        el('span', { class: 'num pts' + (r.state === 'post' && pctOfProj != null ? (pctOfProj >= 0 ? ' up' : ' down') : ''), text: r.state === 'pre' || r.state === 'bye' ? '–' : f1(r.pts) }));
    }));
  }
  const wxFlag = (w, pos) => {
    if (!['QB', 'WR', 'TE', 'K'].includes(pos)) return '';
    const b = [];
    if ((w.wind || 0) >= 15) b.push(`${Math.round(w.wind)} mph wind`);
    if ((w.precip || 0) >= 60) b.push(`${w.precip}% ${w.temp <= 33 ? 'snow' : 'rain'}`);
    if (w.temp != null && w.temp <= 25) b.push(`${Math.round(w.temp)}°`);
    return b.join(', ');
  };
  function sideBlock(s, lead, extra) {
    return el('div', { class: 'side' + (lead ? ' lead' : '') },
      el('span', { class: 'nm', text: s.name }), el('span', { class: 'sc', text: f1(s.pts) }),
      el('span', { class: 'meta', text: `${tm(s.id).owner} · proj ${f1(s.exp)}${extra ? ' · ' + extra : ''} · ${s.playing ? s.playing + ' playing · ' : ''}${s.yetToPlay} to play` }));
  }
  function wpBar(hw, done) {
    return [el('div', { class: 'wp' }, el('i', { style: `width:${hw}%` }), el('i', { style: `width:${100 - hw}%` })),
      el('div', { class: 'wpl' }, el('span', { text: `${hw}% win` }), el('span', { text: done ? 'Final' : 'win odds' }), el('span', { text: `${100 - hw}% win` }))];
  }

  function renderScores() {
    const host = $('#games');
    if (!LIVE) { host.replaceChildren(el('div', { class: 'skel' }), el('div', { class: 'skel' })); return; }
    $('#live-week').textContent = LIVE.week;
    const st = $('#live-status');
    const allDone = LIVE.games.every((g) => g.done);
    st.textContent = LIVE.anyLive ? 'Live' : allDone ? 'Final' : 'Projected';
    st.className = 'pill' + (LIVE.anyLive ? ' live' : '');
    const games = [...LIVE.games].sort((a, b) => (meRow({ h: b.h.id, a: b.a.id }) ? 1 : 0) - (meRow({ h: a.h.id, a: a.a.id }) ? 1 : 0));
    const open = new Set($$('.game.open').map((g) => g.dataset.k));
    host.replaceChildren(...games.map((g) => {
      const k = g.h.id + '-' + g.a.id;
      const hw = Math.round(g.hwin * 100);
      const card = el('div', { class: 'game' + (meRow({ h: g.h.id, a: g.a.id }) ? ' mine' : '') + (open.has(k) ? ' open' : ''), 'data-k': k, role: 'button', tabindex: '0' },
        sideBlock(g.h, g.h.pts > g.a.pts), sideBlock(g.a, g.a.pts > g.h.pts), ...wpBar(hw, g.done), el('div', { class: 'lineups' }, lineupList(g.h), lineupList(g.a)));
      const toggle = () => card.classList.toggle('open');
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      return card;
    }));
  }

  // ---------- MY TEAM ----------
  function renderPickFirst() {
    $('#pick-grid').replaceChildren(...[...D.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
      const b = el('button', { class: 'pickbtn' }, el('b', { text: t.name }), el('span', { text: `${t.owner} · ${t.w}-${t.l}` }));
      b.addEventListener('click', () => setTeam(t.id));
      return b;
    }));
  }

  function renderTeam() {
    const t = D.teams.find((x) => x.id === team);
    $('#pick-first').hidden = !!t;
    $('#team-body').hidden = !t;
    if (!t) { renderPickFirst(); return; }
    $('#team-name').textContent = `${t.name} · ${t.owner}`;
    const live = myLive();
    const st = $('#team-status');
    st.textContent = LIVE && LIVE.anyLive ? 'Live' : live && live.done ? 'Final' : `Week ${D.league.week}`;
    st.className = 'pill' + (LIVE && LIVE.anyLive ? ' live' : '');
    $('#team-lede').replaceChildren('Record ', el('b', { text: `${t.w}-${t.l}` }), ' with the ', el('b', { text: ord(t.pf_rank) }), ' most points. Luck: ',
      el('b', { text: signed(t.luck) }), ' wins. Playoff odds: ', el('b', { text: pct(t.playoffs) }), '.');

    // hero matchup
    const hero = $('#hero');
    const m = myMatch();
    const vm = (D.vegas_matchups || []).find((x) => x.h === team || x.a === team);
    if (live) {
      const meIsH = live.h.id === team;
      const me = meIsH ? live.h : live.a, them = meIsH ? live.a : live.h;
      const hw = Math.round(100 * (meIsH ? live.hwin : 1 - live.hwin));
      const vegasMe = vm ? (vm.h === team ? vm.hv : vm.av) : null, vegasThem = vm ? (vm.h === team ? vm.av : vm.hv) : null;
      const stakes = t.whatif && t.whatif.if_win != null ? el('div', { class: 'stakes' },
        el('div', {}, el('span', { text: 'Win' }), el('b', { text: `${t.whatif.if_win}%` }), el('small', { text: 'playoff odds' })),
        el('div', {}, el('span', { text: 'Lose' }), el('b', { text: `${t.whatif.if_lose}%` }), el('small', { text: 'playoff odds' })),
        el('div', {}, el('span', { text: 'Swing' }), el('b', { text: `${t.whatif.if_win - t.whatif.if_lose} pts` }), el('small', { text: 'playoff odds at stake' }))) : null;
      hero.replaceChildren(el('div', { class: 'game hero-card mine open' },
        el('div', { class: 'hero-h', text: `Week ${LIVE.week} matchup` }),
        sideBlock(me, me.pts > them.pts, vegasMe ? `Vegas ${f1(vegasMe)}` : ''), sideBlock(them, them.pts > me.pts, vegasThem ? `Vegas ${f1(vegasThem)}` : ''),
        ...wpBar(hw, live.done), stakes,
        el('div', { class: 'lineups' }, lineupList(me), lineupList(them))));
    } else if (m) {
      hero.replaceChildren(el('div', { class: 'game hero-card mine' }, el('div', { class: 'hero-h', text: `Week ${D.league.week}: vs ${tm(m.h === team ? m.a : m.h).name}` }), el('p', { class: 'note', text: 'Loading live lineups…' })));
    } else hero.replaceChildren();

    // moves
    const kinds = { Lineup: 'k-lineup', Pickup: 'k-urgent', Stream: 'k-stream', Waiver: 'k-waiver', Trade: 'k-trade', Injury: 'k-warn', Weather: 'k-warn', Vegas: 'k-warn' };
    $('#moves').replaceChildren(...(t.moves && t.moves.length ? t.moves : [{ kind: 'All set', title: 'No moves needed', detail: 'Your lineup is already optimal and nothing on waivers clearly beats what you have.' }]).map((mv) =>
      el('div', { class: 'move' + (mv.urgent ? ' urgent' : '') }, el('span', { class: 'kind ' + (kinds[mv.kind] || ''), text: mv.kind }), el('div', {}, el('b', { text: mv.title }), el('p', { text: mv.detail })))));

    // tiles
    const tile = (l, v, s, cls) => el('div', { class: 'tile' }, el('div', { class: 'l', text: l }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: s }));
    const wi = t.whatif || {};
    $('#tiles').replaceChildren(
      tile('Record', `${t.w}-${t.l}`, `seed ${t.seed ?? '–'} · power #${t.power}`),
      tile('Points for', f1(t.pf), `${ord(t.pf_rank)} in league`),
      tile('All-play', `${t.allplay_w}-${t.allplay_l}`, 'vs every team, every week'),
      tile('Luck', signed(t.luck), 'wins vs expected', t.luck > 0 ? 'ok' : t.luck < 0 ? 'badt' : ''),
      tile('Playoff odds', pct(t.playoffs), `bye ${pct(t.bye)}`),
      tile('Likely finish', wi.seed_median ? ord(wi.seed_median) : '–', wi.seed_best ? `range ${ord(wi.seed_best)}–${ord(wi.seed_worst)}` : ''));

    // what-if facts
    const paRank = [...D.teams].sort((a, b) => (b.whatif?.pa_avg ?? 0) - (a.whatif?.pa_avg ?? 0)).findIndex((x) => x.id === team) + 1;
    const fact = (h, b) => el('div', {}, el('strong', { text: h }), el('span', { text: b }));
    const facts = [];
    if (wi.swap_best) facts.push(fact(`With ${tm(wi.swap_best.id).owner}'s schedule: ${wi.swap_best.wins}-${D.league.done.length - wi.swap_best.wins}`, `Your exact weekly scores against the opponents ${tm(wi.swap_best.id).owner} faced. Worst schedule for you: ${tm(wi.swap_worst.id).owner}'s (${wi.swap_worst.wins}-${D.league.done.length - wi.swap_worst.wins}).`));
    facts.push(fact(`Perfect lineups every week: ${wi.opt_wins}-${D.league.done.length - wi.opt_wins}`, `vs your actual ${t.w}-${t.l}. ${f1(t.bench_lost)} points left on the bench (${pct(t.eff)} efficient).`));
    facts.push(fact(`Close games: ${wi.close_w}-${wi.close_l}`, 'Decided by under 10 points.'));
    facts.push(fact(`Schedule so far: ${ord(paRank)} toughest`, `Opponents have averaged ${f1(wi.pa_avg)} against you (league average ${f1(D.league.avg)}).`));
    facts.push(fact(`Boom/bust: ${wi.boom} boom, ${wi.bust} bust weeks`, `Weekly swing ±${f1(wi.sd)} pts. ${wi.vs_proj >= 0 ? 'Beating' : 'Missing'} ESPN projections by ${f1(Math.abs(wi.vs_proj))} a week.`));
    if (wi.if_win != null) facts.push(fact(`This week: win → ${wi.if_win}%, lose → ${wi.if_lose}%`, 'Playoff odds depending on this week\'s result.'));
    facts.push(fact(`Worst case: ${ord(wi.seed_worst)} place`, `Miss playoffs ${pct(Math.round((100 - t.playoffs) * 10) / 10)} of the time · last place ${pct(t.last)} · ~${f1(t.exp_wins)} projected wins.`));
    $('#whatif').replaceChildren(...facts);

    drawSeeds($('#c-whatif'), t);
    $('#seed-range').textContent = wi.seed_best ? `Realistic finish: ${ord(wi.seed_best)} to ${ord(wi.seed_worst)}; most likely ${ord(wi.seed_median)}.` : '';

    // schedule swap bars
    { const rows = Object.entries(D.swap[team] || {}).map(([o, w]) => ({ id: Number(o), w })).sort((a, b) => b.w - a.w);
      const host = $('#c-swap');
      hbars(host, rows, { label: (r) => (r.id === team ? 'Yours (actual)' : `${tm(r.id).owner}'s`), value: (r) => r.w, fmt: (v) => `${v}-${D.league.done.length - v}`, max: D.league.done.length,
        color: (r) => (r.id === team ? css('--accent') : r.w > t.w ? css('--accent-2') : css('--bar')), bold: (r) => r.id === team,
        tipHead: (r) => (r.id === team ? 'Your actual schedule' : `${tm(r.id).owner}'s schedule (${tm(r.id).name})`), tipBody: (r) => `You'd be ${r.w}-${D.league.done.length - r.w}` }); }

    drawSeason($('#c-season'), t);
    table($('#t-sched'), [{ h: 'Wk', k: 'wk' }, { h: 'Opponent', k: 'opp', v: (r) => tm(r.opp).name }, { h: 'Owner', k: 'own', v: (r) => tm(r.opp).owner }, { h: 'Win', k: 'win', n: 1, bar: 1, f: (v) => v + '%' }], D.sched.filter((s) => s.id === team));
    drawPos($('#c-pos'), t);
    hbars($('#c-top'), t.top_players || [], { label: (r) => `${r.name} (${r.pos})`, value: (r) => r.share, fmt: (v) => v + '%', color: () => css('--accent-2'), tipHead: (r) => r.name, tipBody: (r) => `${f1(r.pts)} started points · ${r.share}% of team scoring` });

    // my starters: Vegas & weather
    const by = nflByAbbr();
    const starters = (D.rosters[team] || []).filter((r) => r.starter);
    $('#vegas-note').textContent = D.odds_provider ? `${D.odds_provider} implied team totals (league avg ${f1(D.avg_implied)}); weather at kickoff.` : 'Lines appear once sportsbooks post them.';
    table($('#t-myvegas'), [
      { h: 'Player', k: 'name' },
      { h: 'Team total', k: 'imp', n: 1, v: (r) => { const x = by[r.nfl]; return x ? x.me.implied ?? null : null; }, f: (v) => (v == null ? '–' : f1(v)), cls: (r) => { const x = by[r.nfl]; const v = x && x.me.implied; return v == null ? '' : v >= 26 ? 'good' : v <= 18 ? 'bad' : ''; } },
      { h: 'Weather', k: 'wx', v: (r) => wxText(by[r.nfl] && by[r.nfl].g) },
      { h: 'Game', k: 'g', v: (r) => { const x = by[r.nfl]; return x ? `${x.home ? 'vs' : '@'} ${x.them.abbr} · ${kick(x.g.kickoff)}` : 'Bye'; } },
      { h: 'Line', k: 'line', n: 1, v: (r) => { const x = by[r.nfl]; return x && x.me.line != null ? x.me.line : null; }, f: (v) => (v == null ? '–' : v > 0 ? '+' + v : v === 0 ? 'PK' : String(v)) }], starters);

    table($('#t-roster'), [
      { h: 'Slot', k: 'slot' }, { h: 'Player', k: 'name', f: (v, r) => v + (r.inj ? ` (${r.inj})` : '') },
      { h: '', k: 'note', f: (v) => v || '', cls: (r) => (r.note === 'Start' ? 'good' : r.note === 'Sit' ? 'bad' : '') },
      { h: 'This wk', k: 'proj', n: 1, f: f1 }, { h: 'Avg', k: 'avg', n: 1, f: (v) => (v == null ? '–' : f1(v)) }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'Season', k: 'season', n: 1, f: f1 }, { h: 'Pos', k: 'pos' }, { h: 'NFL', k: 'nfl' }], D.rosters[team] || []);
    $('#weak-pos').textContent = t.need.weak;
    table($('#t-targets'), [{ h: 'Player', k: 'name' }, { h: 'Team', k: 'from', v: (r) => tm(r.from).name }, { h: 'Owner', k: 'own', v: (r) => tm(r.from).owner }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'Season', k: 'season', n: 1, f: f1 }], t.targets);
    renderWaivers();
  }

  function drawSeeds(host, t) {
    const rows = (t.seeds || []).map((p, i) => ({ seed: i + 1, p }));
    if (!rows.length) return empty(host, 'No simulation yet.');
    const w = W(host), h = 170, mg = { t: 18, b: 22 }, po = D.league.playoff_teams;
    const svg = svgIn(host, w, h);
    const x = d3.scaleBand(rows.map((r) => r.seed), [4, w - 4]).padding(0.22);
    const y = d3.scaleLinear([0, Math.max(10, d3.max(rows, (r) => r.p))], [h - mg.b, mg.t]);
    const g = svg.selectAll('g').data(rows).join('g');
    g.append('rect').attr('x', (r) => x(r.seed)).attr('width', x.bandwidth()).attr('y', (r) => y(r.p)).attr('height', (r) => Math.max(1, y(0) - y(r.p))).attr('rx', 3)
      .attr('fill', (r) => (r.seed <= po ? css('--accent') : css('--bar')));
    g.append('text').attr('class', 'muted').attr('x', (r) => x(r.seed) + x.bandwidth() / 2).attr('y', (r) => y(r.p) - 4).attr('text-anchor', 'middle').style('font-size', '10.5px').text((r) => (r.p >= 1 ? Math.round(r.p) + '%' : r.p > 0 ? '<1%' : ''));
    g.append('text').attr('class', 'muted').attr('x', (r) => x(r.seed) + x.bandwidth() / 2).attr('y', h - 6).attr('text-anchor', 'middle').text((r) => ord(r.seed));
    g.append('rect').attr('x', (r) => x(r.seed)).attr('width', x.bandwidth()).attr('height', h).attr('fill', 'transparent')
      .call((s) => hover(s, (r) => `Finish ${ord(r.seed)}`, (r) => `${pct(r.p)} of simulations${r.seed <= 2 ? ' · first-round bye' : r.seed <= po ? ' · playoffs' : ''}`));
  }

  function drawSeason(host, t) {
    const rows = t.weeks; if (!rows.length) return empty(host, 'No games played yet.');
    const w = W(host), h = 210, mg = { l: 32, r: 6, t: 8, b: 22 };
    const svg = svgIn(host, w, h);
    const x = d3.scaleBand(rows.map((r) => r.wk), [mg.l, w - mg.r]).padding(0.3);
    const y = d3.scaleLinear([0, (d3.max(rows, (r) => Math.max(r.pts, r.opp_pts, r.opt)) || 100) * 1.08], [h - mg.b, mg.t]).nice();
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(w - mg.l - mg.r))).call((a) => { a.select('.domain').remove(); a.selectAll('text').attr('class', 'muted'); });
    const bw = Math.min(32, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
    const g = svg.append('g').selectAll('g').data(rows).join('g');
    g.append('rect').attr('x', (r) => x(r.wk) + off).attr('width', bw).attr('y', (r) => y(r.pts)).attr('height', (r) => y(0) - y(r.pts)).attr('rx', 3).attr('fill', (r) => (r.pts > r.opp_pts ? css('--accent') : css('--bar')));
    g.append('line').attr('x1', (r) => x(r.wk) + off - 4).attr('x2', (r) => x(r.wk) + off + bw + 4).attr('y1', (r) => y(r.opp_pts)).attr('y2', (r) => y(r.opp_pts)).attr('stroke', css('--fg')).attr('stroke-width', 2).attr('stroke-linecap', 'round');
    g.append('circle').attr('cx', (r) => x(r.wk) + x.bandwidth() / 2).attr('cy', (r) => y(r.opt)).attr('r', 3.5).attr('fill', css('--accent-2'));
    g.append('text').attr('class', 'muted').attr('x', (r) => x(r.wk) + x.bandwidth() / 2).attr('y', h - 6).attr('text-anchor', 'middle').text((r) => 'W' + r.wk);
    svg.append('line').attr('x1', mg.l).attr('x2', w - mg.r).attr('y1', y(D.league.avg)).attr('y2', y(D.league.avg)).attr('stroke', css('--muted')).attr('stroke-dasharray', '4 4');
    g.append('rect').attr('x', (r) => x(r.wk)).attr('width', x.bandwidth()).attr('height', h).attr('fill', 'transparent').call((s) => hover(s, (r) => `Week ${r.wk} vs ${tm(r.opp).name}`, (r) => `${r.pts > r.opp_pts ? 'W' : 'L'} ${f1(r.pts)}–${f1(r.opp_pts)} · best lineup ${f1(r.opt)} · ${ord(r.rank)} of ${D.teams.length}`));
  }

  function drawPos(host, t) {
    const rows = Object.entries(t.pos).map(([p, v]) => ({ p, v, avg: D.pos_avg[p], d: v - D.pos_avg[p] }));
    const w = W(host), rowH = 24, h = rows.length * rowH + 4;
    const svg = svgIn(host, w, h), ext = d3.max(rows, (r) => Math.abs(r.d)) || 1;
    const x = d3.scaleLinear([-ext, ext], [44, w - 46]), y = d3.scaleBand(rows.map((r) => r.p), [2, h - 2]).padding(0.28);
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h).attr('stroke', css('--line'));
    const g = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (r) => `translate(0,${y(r.p)})`);
    g.append('rect').attr('x', (r) => Math.min(x(0), x(r.d))).attr('width', (r) => Math.max(1, Math.abs(x(r.d) - x(0)))).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', (r) => (r.d >= 0 ? css('--accent-2') : css('--bad')));
    g.append('text').attr('x', 36).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.p);
    g.append('text').attr('class', 'muted').attr('x', (r) => (r.d >= 0 ? x(r.d) + 4 : x(0) + 4)).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((r) => signed(r.d));
    g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, (r) => r.p, (r) => `${f1(r.v)} pts/wk · league ${f1(r.avg)}`));
  }

  function renderWaivers() {
    const seg = $('#wv-seg');
    const opts = ['ALL', 'QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];
    seg.replaceChildren(...opts.map((p) => { const b = el('button', { 'aria-pressed': String(p === wvPos), text: p }); b.addEventListener('click', () => { wvPos = p; renderWaivers(); }); return b; }));
    const rows = wvPos === 'ALL' ? Object.values(D.waivers).flatMap((l) => l.slice(0, 3)).sort((a, b) => b.ros - a.ros) : D.waivers[wvPos] || [];
    table($('#t-waivers'), [{ h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'NFL', k: 'team' }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'This wk', k: 'proj', n: 1, f: f1 }, { h: 'Rostered', k: 'owned', n: 1, f: (v) => v + '%' }, { h: '', k: 'status', f: (v) => (v === 'WAIVERS' ? 'Waivers' : 'FA') }], rows);
  }

  // ---------- THIS WEEK ----------
  function renderWeek() {
    $('#aw-week').textContent = D.awards_week ?? '–';
    $('#awards').replaceChildren(...(D.awards || []).map((a) => el('div', { class: 'award' + (a.id === team ? ' mine' : '') }, el('span', { class: 'aw', text: a.award }), el('b', { text: tm(a.id).name }), el('span', { class: 'note', text: a.detail }))));
    const vm = D.vegas_matchups || [];
    const byM = Object.fromEntries(D.matchups.map((m) => [m.h + '-' + m.a, m]));
    table($('#t-vm'), [
      { h: 'Matchup', k: 'm', v: (r) => `${tm(r.h).owner} vs ${tm(r.a).owner}` },
      { h: 'ESPN proj', k: 'e', v: (r) => { const m = byM[r.h + '-' + r.a]; return m ? `${f1(m.hp)}–${f1(m.ap)}` : '–'; } },
      { h: 'Vegas-adj', k: 'v', v: (r) => `${f1(r.hv)}–${f1(r.av)}` },
      { h: 'Our odds', k: 'oe', n: 1, v: (r) => { const m = byM[r.h + '-' + r.a]; return m ? Math.round(m.hwin * 100) : null; }, f: (v) => (v == null ? '–' : `${v}–${100 - v}`) },
      { h: 'Odds (Vegas)', k: 'ov', n: 1, v: (r) => Math.round(r.hwin), f: (v) => `${v}–${100 - v}` }], vm, { isMe: meRow });
    if (!vm.length) $('#t-vm').replaceChildren(el('p', { class: 'note', text: 'Vegas lines for this week aren\'t posted yet.' }));
    $('#prov').textContent = D.odds_provider ? `Lines: ${D.odds_provider}` : 'Lines pending';
    const open = new Set($$('.nflg.open').map((g) => g.dataset.k));
    $('#nfl').replaceChildren(...(D.nfl || []).map((g) => {
      const mine = g.involved.filter((p) => p.id === team);
      const line = g.odds ? (g.odds.details || '–') : 'No line yet';
      const score = g.state !== 'pre' && g.home.score != null ? ` · ${g.away.score}–${g.home.score} ${g.status}` : '';
      const card = el('div', { class: 'nflg' + (mine.length ? ' mine' : '') + (open.has(g.id) ? ' open' : ''), 'data-k': g.id, role: 'button', tabindex: '0' },
        el('div', { class: 'nflh' }, el('b', { text: `${g.away.abbr} @ ${g.home.abbr}` }), el('span', { class: 'muted', text: kick(g.kickoff) + score })),
        el('div', { class: 'nflodds' },
          el('span', {}, el('small', { text: 'Line' }), el('b', { text: line })),
          el('span', {}, el('small', { text: 'Total' }), el('b', { text: g.odds && g.odds.total != null ? f1(g.odds.total) : '–' })),
          el('span', {}, el('small', { text: 'Implied' }), el('b', { text: g.home.implied != null ? `${g.away.abbr} ${f1(g.away.implied)} · ${g.home.abbr} ${f1(g.home.implied)}` : '–' })),
          el('span', {}, el('small', { text: 'Weather' }), el('b', { class: g.weather && !g.indoor && ((g.weather.wind || 0) >= 18 || (g.weather.precip || 0) >= 70) ? 'badt' : '', text: wxText(g) }))),
        el('div', { class: 'note', text: `${g.involved.length} league starter${g.involved.length === 1 ? '' : 's'} in this game${mine.length ? ` · ${mine.length} of yours` : ''}` }),
        el('div', { class: 'nflp' }, ...g.involved.map((p) => el('div', { class: p.id === team ? 'me' : '' }, el('span', { text: `${p.name} (${p.pos})` }), el('span', { class: 'muted', text: tm(p.id).name }), el('span', { class: 'pts', text: f1(p.proj) })))));
      const toggle = () => card.classList.toggle('open');
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      return card;
    }));
    if (!(D.nfl || []).length) $('#nfl').replaceChildren(el('p', { class: 'note', text: 'NFL schedule not available right now.' }));
  }

  // ---------- LEAGUE ----------
  function renderLeague() {
    table($('#t-power'), [
      { h: '#', k: 'power', n: 1 }, { h: 'Team', k: 'name' }, { h: 'Owner', k: 'owner' }, { h: 'Rec', k: 'w', f: (_, r) => `${r.w}-${r.l}` },
      { h: 'PF', k: 'pf', n: 1, f: f1 }, { h: 'All-play', k: 'allplay_w', f: (_, r) => `${r.allplay_w}-${r.allplay_l}` },
      { h: 'Luck', k: 'luck', n: 1, f: signed, cls: (r) => (r.luck > 0 ? 'good' : r.luck < 0 ? 'bad' : '') },
      { h: 'Roster/wk', k: 'ros', n: 1, f: f1 }, { h: 'Playoffs', k: 'playoffs', n: 1, bar: 1, f: pct }, { h: 'Bye', k: 'bye', n: 1, f: pct }], D.teams, { isMe: meRow });
    const ordered = [...D.teams].sort((a, b) => b.playoffs - a.playoffs);
    { const host = $('#c-odds'), w = W(host), rowH = 24, svg = svgIn(host, w, 10);
      const lw = Math.min(textW(svg, ordered.map((r) => r.name)) + 10, w * 0.45), h = ordered.length * rowH + 4; svg.attr('viewBox', `0 0 ${w} ${h}`);
      const x = d3.scaleLinear([0, 100], [lw, w - 40]), y = d3.scaleBand(ordered.map((r) => r.id), [2, h - 2]).padding(0.28);
      const g = svg.selectAll('g').data(ordered).join('g').attr('transform', (r) => `translate(0,${y(r.id)})`);
      const col = (r) => (r.id === team ? css('--accent') : css('--accent-2'));
      g.append('rect').attr('x', lw).attr('width', x(100) - lw).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', css('--panel-2'));
      g.append('rect').attr('x', lw).attr('width', (r) => x(r.playoffs) - lw).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', col).attr('fill-opacity', 0.55);
      g.append('rect').attr('x', lw).attr('width', (r) => x(r.bye) - lw).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', col);
      g.append('text').attr('x', lw - 8).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.name).style('font-weight', (r) => (r.id === team ? 700 : null));
      g.append('text').attr('class', 'muted').attr('x', (r) => x(r.playoffs) + 4).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((r) => pct(r.playoffs));
      g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, (r) => r.name, (r) => `Playoffs ${pct(r.playoffs)} · bye ${pct(r.bye)} · last ${pct(r.last)} · win → ${r.whatif?.if_win ?? '–'}%, lose → ${r.whatif?.if_lose ?? '–'}%`)); }
    { const rows = [...D.teams].sort((a, b) => a.luck - b.luck), host = $('#c-luck'), w = W(host), rowH = 24, svg = svgIn(host, w, 10);
      const lw = Math.min(textW(svg, rows.map((r) => r.name)) + 10, w * 0.45), h = rows.length * rowH + 22; svg.attr('viewBox', `0 0 ${w} ${h}`);
      const max = Math.ceil(d3.max(rows, (r) => Math.max(r.w, r.exp_w)) || 1);
      const x = d3.scaleLinear([0, max], [lw, w - 12]), y = d3.scaleBand(rows.map((r) => r.id), [2, h - 20]).padding(0.4);
      svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${h - 20})`).call(d3.axisBottom(x).ticks(max).tickFormat(d3.format('d')).tickSize(-(h - 22))).call((a) => { a.select('.domain').remove(); a.selectAll('text').attr('class', 'muted'); });
      const g = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (r) => `translate(0,${y(r.id) + y.bandwidth() / 2})`);
      g.append('text').attr('x', lw - 8).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.name).style('font-weight', (r) => (r.id === team ? 700 : null));
      g.append('line').attr('x1', (r) => x(r.w)).attr('x2', (r) => x(r.exp_w)).attr('stroke', (r) => (r.luck < 0 ? css('--bad') : css('--good'))).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
      g.append('circle').attr('cx', (r) => x(r.exp_w)).attr('r', 5).attr('fill', css('--panel')).attr('stroke', css('--muted')).attr('stroke-width', 1.5);
      g.append('circle').attr('cx', (r) => x(r.w)).attr('r', 5).attr('fill', (r) => (r.id === team ? css('--accent') : css('--fg')));
      g.append('rect').attr('x', 0).attr('y', -12).attr('width', w).attr('height', 24).attr('fill', 'transparent').call((s) => hover(s, (r) => r.name, (r) => `${r.w}-${r.l} actual · ${f1(r.exp_w)} wins earned · luck ${signed(r.luck)}`)); }
    drawBump($('#c-bump'));
    drawSwapGrid($('#c-swapgrid'));
    drawScatter($('#c-scatter'));
    hbars($('#c-bench'), [...D.teams].sort((a, b) => a.bench_lost - b.bench_lost), { label: (r) => r.name, value: (r) => r.bench_lost, fmt: (v) => f1(v), color: (r) => (r.id === team ? css('--accent') : css('--bar')), bold: (r) => r.id === team, tipHead: (r) => r.name, tipBody: (r) => `${f1(r.bench_lost)} pts left on the bench · ${pct(r.eff)} of best possible · best-lineup record ${r.whatif.opt_wins}-${D.league.done.length - r.whatif.opt_wins}` });
    hbars($('#c-proj'), [...D.teams].sort((a, b) => b.whatif.vs_proj - a.whatif.vs_proj), { label: (r) => r.name, value: (r) => r.whatif.vs_proj, fmt: (v) => signed(v), color: (r) => (r.whatif.vs_proj >= 0 ? css('--accent-2') : css('--bad')), bold: (r) => r.id === team, tipHead: (r) => r.name, tipBody: (r) => `${signed(r.whatif.vs_proj)} pts/week vs ESPN's projection` });
    drawHeat($('#c-heat'));
    table($('#t-clutch'), [
      { h: 'Team', k: 'name' }, { h: 'Close games', k: 'cw', v: (r) => r.whatif.close_w - r.whatif.close_l, f: (_, r) => `${r.whatif.close_w}-${r.whatif.close_l}` },
      { h: 'Opp avg', k: 'pa', n: 1, v: (r) => r.whatif.pa_avg, f: f1 }, { h: 'Best-lineup rec', k: 'opt', v: (r) => r.whatif.opt_wins, f: (_, r) => `${r.whatif.opt_wins}-${D.league.done.length - r.whatif.opt_wins}` },
      { h: 'Swing ±', k: 'sd', n: 1, v: (r) => r.whatif.sd, f: f1 }, { h: 'Boom', k: 'boom', n: 1, v: (r) => r.whatif.boom }, { h: 'Bust', k: 'bust', n: 1, v: (r) => r.whatif.bust }], D.teams, { isMe: meRow });
  }

  function drawBump(host) {
    const pts = D.power_by_week || []; if (!pts.length) return empty(host, 'No games yet.');
    const weeks = [...new Set(pts.map((p) => p.wk))], n = D.teams.length;
    const w = W(host), h = Math.max(220, n * 24 + 30), svg = svgIn(host, w, h);
    const names = D.teams.map((t) => t.name);
    const lw = Math.min(textW(svg, names) + 14, w * 0.38);
    const x = d3.scalePoint(weeks, [24, w - lw]), y = d3.scaleLinear([1, n], [16, h - 20]);
    svg.selectAll('text.w').data(weeks).join('text').attr('class', 'muted w').attr('x', (d) => x(d)).attr('y', h - 4).attr('text-anchor', 'middle').text((d) => 'W' + d);
    for (let r = 1; r <= n; r++) svg.append('text').attr('class', 'muted').attr('x', 8).attr('y', y(r)).attr('dy', '.35em').attr('text-anchor', 'middle').text(r);
    const focus = bumpFocus ?? team;
    const series = d3.groups(pts, (p) => p.id);
    const line = d3.line().x((p) => x(p.wk)).y((p) => y(p.rank));
    const col = (id) => (id === focus ? css('--accent') : css('--muted'));
    const g = svg.selectAll('g.s').data(series).join('g').attr('class', 's').style('opacity', ([id]) => (focus && id !== focus ? 0.28 : 1));
    g.append('path').attr('d', ([, v]) => line(v)).attr('fill', 'none').attr('stroke', ([id]) => col(id)).attr('stroke-width', ([id]) => (id === focus ? 3 : 1.6)).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    g.selectAll('circle').data(([, v]) => v).join('circle').attr('cx', (p) => x(p.wk)).attr('cy', (p) => y(p.rank)).attr('r', 3).attr('fill', (p) => col(p.id)).call((s) => hover(s, (p) => `${tm(p.id).name} · week ${p.wk}`, (p) => `${ord(p.rank)} by all-play · ${f1(p.pf)} total pts`));
    g.append('text').attr('x', ([, v]) => x(v[v.length - 1].wk) + 8).attr('y', ([, v]) => y(v[v.length - 1].rank)).attr('dy', '.35em').text(([id]) => tm(id).name).style('font-weight', ([id]) => (id === focus ? 700 : null)).style('cursor', 'pointer')
      .on('click', (ev, [id]) => { bumpFocus = bumpFocus === id ? null : id; drawBump(host); });
  }

  function drawSwapGrid(host) {
    const ids = D.teams.map((t) => t.id), n = ids.length, wk = D.league.done.length;
    if (!wk) return empty(host, 'No games yet.');
    const w = W(host), svg = svgIn(host, w, 10);
    const lw = Math.min(textW(svg, ids.map((i) => tm(i).name)) + 10, w * 0.36);
    const cell = Math.max(18, Math.min(40, (w - lw - 4) / n)), h = n * cell + 46;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    const x = d3.scaleBand(ids, [lw, lw + n * cell]).padding(0.06), y = d3.scaleBand(ids, [44, 44 + n * cell]).padding(0.06);
    const data = ids.flatMap((r) => ids.map((c) => ({ r, c, w: D.swap[r][c], actual: T[r].w })));
    const cg = d3.scaleLinear([-3, 0, 3], [css('--bad'), css('--panel-2'), css('--good')]).clamp(true);
    svg.selectAll('text.c').data(ids).join('text').attr('class', 'muted c').attr('transform', (c) => `translate(${x(c) + x.bandwidth() / 2},38) rotate(-45)`).style('font-size', '10px').text((c) => tm(c).owner);
    svg.selectAll('text.r').data(ids).join('text').attr('class', 'r').attr('x', lw - 6).attr('y', (r) => y(r) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => tm(r).name).style('font-weight', (r) => (r === team ? 700 : null));
    const cells = svg.selectAll('rect.cell').data(data).join('rect').attr('class', 'cell').attr('x', (d) => x(d.c)).attr('y', (d) => y(d.r)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('rx', 3)
      .attr('fill', (d) => (d.r === d.c ? css('--bar') : cg(d.w - d.actual))).attr('stroke', (d) => (d.r === team ? css('--accent') : 'none'));
    hover(cells, (d) => (d.r === d.c ? `${tm(d.r).name}: actual` : `${tm(d.r).name} with ${tm(d.c).name}'s schedule`), (d) => `${d.w}-${wk - d.w}${d.r !== d.c ? ` (actual ${d.actual}-${wk - d.actual})` : ''}`);
    if (x.bandwidth() >= 20) svg.selectAll('text.v').data(data).join('text').attr('class', 'v').attr('x', (d) => x(d.c) + x.bandwidth() / 2).attr('y', (d) => y(d.r) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'middle').style('font-size', '11px').style('pointer-events', 'none').text((d) => d.w);
  }

  function drawScatter(host) {
    const rows = D.teams; const w = W(host), h = 260, mg = { l: 36, r: 12, t: 12, b: 30 };
    const svg = svgIn(host, w, h);
    const x = d3.scaleLinear(d3.extent(rows, (r) => r.whatif.sd).map((v, i) => v + (i ? 2 : -2)), [mg.l, w - mg.r]);
    const y = d3.scaleLinear(d3.extent(rows, (r) => r.avg).map((v, i) => v + (i ? 4 : -4)), [h - mg.b, mg.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${h - mg.b})`).call(d3.axisBottom(x).ticks(5).tickSize(-(h - mg.t - mg.b))).call((a) => { a.select('.domain').remove(); a.selectAll('text').attr('class', 'muted'); });
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - mg.l - mg.r))).call((a) => { a.select('.domain').remove(); a.selectAll('text').attr('class', 'muted'); });
    svg.append('text').attr('class', 'muted').attr('x', w - mg.r).attr('y', h - 4).attr('text-anchor', 'end').text('weekly swing (±pts) →');
    svg.append('text').attr('class', 'muted').attr('x', mg.l + 4).attr('y', mg.t + 10).text('↑ avg points');
    const g = svg.selectAll('g.p').data(rows).join('g').attr('class', 'p').attr('transform', (r) => `translate(${x(r.whatif.sd)},${y(r.avg)})`);
    g.append('circle').attr('r', (r) => (r.id === team ? 7 : 5)).attr('fill', (r) => (r.id === team ? css('--accent') : css('--accent-2'))).attr('fill-opacity', 0.85);
    g.append('text').attr('x', 8).attr('dy', '.35em').style('font-size', '10.5px').text((r) => r.owner);
    hover(g, (r) => r.name, (r) => `${f1(r.avg)} avg · ±${f1(r.whatif.sd)} swing · ${r.whatif.boom} boom / ${r.whatif.bust} bust weeks`);
  }

  function drawHeat(host) {
    const rows = [...D.teams].sort((a, b) => d3.mean(a.weeks, (x) => x.rank) - d3.mean(b.weeks, (x) => x.rank)), weeks = D.league.done;
    if (!weeks.length) return empty(host, 'No games yet.');
    const w = W(host), cell = 24, svg = svgIn(host, w, 10);
    const lw = Math.min(textW(svg, rows.map((r) => r.name)) + 10, w * 0.4), h = rows.length * cell + 20; svg.attr('viewBox', `0 0 ${w} ${h}`);
    const x = d3.scaleBand(weeks, [lw, w - 2]).padding(0.08), y = d3.scaleBand(rows.map((r) => r.id), [18, h - 2]).padding(0.08);
    const op = d3.scaleLinear([D.teams.length, 1], [0.08, 1]);
    svg.selectAll('text.w').data(weeks).join('text').attr('class', 'muted w').attr('x', (wk) => x(wk) + x.bandwidth() / 2).attr('y', 11).attr('text-anchor', 'middle').text((wk) => (x.bandwidth() > 30 ? 'Wk ' + wk : wk));
    const g = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r');
    g.append('text').attr('x', lw - 8).attr('y', (r) => y(r.id) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.name).style('font-weight', (r) => (r.id === team ? 700 : null));
    const cells = g.selectAll('rect').data((r) => r.weeks.map((wk) => ({ ...wk, id: r.id, name: r.name }))).join('rect')
      .attr('x', (d) => x(d.wk)).attr('y', (d) => y(d.id)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('rx', 3)
      .attr('fill', (d) => (d.id === team ? css('--accent') : css('--accent-2'))).attr('fill-opacity', (d) => op(d.rank));
    hover(cells, (d) => `${d.name} · week ${d.wk}`, (d) => `${f1(d.pts)} pts · ${ord(d.rank)} · ${d.pts > d.opp_pts ? 'W' : 'L'} vs ${tm(d.opp).name}`);
    if (x.bandwidth() >= 22) g.selectAll('text.c').data((r) => r.weeks.map((wk) => ({ ...wk, id: r.id }))).join('text').attr('class', 'c').attr('x', (d) => x(d.wk) + x.bandwidth() / 2).attr('y', (d) => y(d.id) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'middle').style('pointer-events', 'none').style('font-size', '11px').style('fill', (d) => (d.rank <= 3 ? '#fff' : null)).text((d) => d.rank);
  }

  // ---------- TRADES / DRAFT ----------
  function renderTrades() {
    const host = $('#tradelist');
    if (!D.trades.length) host.replaceChildren(el('p', { class: 'note', text: 'No trades yet this season.' }));
    else host.replaceChildren(...D.trades.map((t) => {
      const side = (s) => el('div', {}, el('div', { class: 'tm', text: tm(s.id).name }), el('div', { text: 'Got ' + (s.gets.map((g) => g.name).join(', ') || 'nothing') }),
        el('div', { class: 'note', text: `${f1(s.pts)} started pts since · ${s.ros} ROS proj` }), t.winner === s.id ? el('div', { class: 'win', text: 'Winning so far' }) : null);
      return el('div', { class: 'trade' + (team && (t.a.id === team || t.b.id === team) ? ' me' : '') }, el('div', { class: 'h', text: `Week ${t.wk}${t.winner == null ? ' · even so far' : ''}` }), side(t.a), side(t.b));
    }));
    table($('#t-pickups'), [{ h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'Added by', k: 'id', v: (r) => tm(r.id).name }, { h: 'Wk', k: 'wk', n: 1 }, { h: 'Started pts', k: 'pts', n: 1, f: f1 }, { h: 'ROS', k: 'ros', n: 1 }], D.pickups.slice(0, 15), { isMe: meRow });
    table($('#t-mypickups'), [{ h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'Wk', k: 'wk', n: 1 }, { h: 'Started pts', k: 'pts', n: 1, f: f1 }, { h: 'ROS', k: 'ros', n: 1 }], team ? D.pickups.filter((p) => p.id === team) : []);
  }
  function renderDraft() {
    const haul = D.teams.map((t) => ({ id: t.id, name: t.name, pts: d3.sum(D.draft.filter((d) => d.id === t.id), (d) => d.season) })).sort((a, b) => b.pts - a.pts);
    hbars($('#c-haul'), haul, { label: (r) => r.name, value: (r) => r.pts, fmt: (v) => d3.format(',.0f')(v), color: (r) => (r.id === team ? css('--accent') : css('--bar')), bold: (r) => r.id === team, tipHead: (r) => r.name, tipBody: (r) => `${f1(r.pts)} season pts from drafted players` });
    const dcols = [{ h: 'Pick', k: 'pick', n: 1 }, { h: 'Player', k: 'name' }, { h: 'Team', k: 'id', v: (r) => tm(r.id).name }, { h: 'Drafted', k: 'pos_pick', f: (_, r) => r.pos + r.pos_pick }, { h: 'Now', k: 'pos_finish', f: (_, r) => (r.pos_finish ? r.pos + r.pos_finish : '–') }, { h: 'Pts', k: 'season', n: 1, f: f1 }];
    const graded = D.draft.filter((d) => d.swing != null);
    table($('#t-steals'), dcols, [...graded].sort((a, b) => b.swing - a.swing).slice(0, 10), { isMe: meRow });
    table($('#t-busts'), dcols, graded.filter((d) => d.rd <= 6).sort((a, b) => a.swing - b.swing).slice(0, 10), { isMe: meRow });
    table($('#t-mydraft'), [dcols[0], dcols[1], dcols[3], dcols[4], dcols[5]], team ? D.draft.filter((d) => d.id === team) : []);
  }

  // ---------- HISTORY ----------
  function renderHistory() {
    const H = D.history;
    $('#champs').replaceChildren(...[...D.champs].reverse().map((c) => el('div', { class: 'champ' }, el('div', { class: 'yr', text: c.year }), el('div', { class: 'who', text: `${c.owner} · ${c.team}` }), el('div', { class: 'how', text: `${c.record}, ${c.seed ? ord(c.seed) + ' seed' : ''} · beat ${c.runner_up} ${c.final}` }))));
    const myOwner = team ? tm(team).owner : null;
    table($('#t-career'), [{ h: '#', k: 'rank', n: 1 }, { h: 'Owner', k: 'owner' }, { h: 'Legacy', k: 'legacy', n: 1, f: f1 }, { h: 'Titles', k: 'titles', n: 1 }, { h: 'Finals', k: 'finals', n: 1 }, { h: 'Playoffs', k: 'playoffs', n: 1 }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'All-play', k: 'allplay', n: 1, f: pct }, { h: 'Avg finish', k: 'avg_finish', n: 1, f: (v) => (v ? f1(v) : '–') }], H.career, { isMe: (r) => r.owner === myOwner });
    // rivalry
    const owners = H.career.map((c) => c.owner).sort();
    const a = $('#rv-a'), b = $('#rv-b');
    const fill = (s, v) => { s.replaceChildren(...owners.map((o) => el('option', { value: o, text: o }))); s.value = v; };
    if (!a.options.length) {
      fill(a, myOwner || owners[0]);
      const top = D.h2h.filter((x) => x.id === team).sort((x, y) => (y.w + y.l) - (x.w + x.l))[0];
      fill(b, top ? top.opp : owners.find((o) => o !== a.value));
      a.addEventListener('change', drawRivalry); b.addEventListener('change', drawRivalry);
    }
    drawRivalry();
    // seasons
    const years = [...new Set(H.seasons.map((s) => s.year))].sort((x, y) => y - x);
    if (!yrSel || !years.includes(yrSel)) yrSel = years[0];
    $('#yr-seg').replaceChildren(...years.map((y) => { const bt = el('button', { 'aria-pressed': String(y === yrSel), text: y }); bt.addEventListener('click', () => { yrSel = y; renderHistory(); }); return bt; }));
    const sRows = H.seasons.filter((s) => s.year === yrSel).sort((x, y) => (x.final ?? 99) - (y.final ?? 99) || (y.w - x.w) || (y.pf - x.pf));
    table($('#t-seasons'), [{ h: 'Finish', k: 'final', n: 1, f: (v, r) => (v ? ord(v) : r.complete ? '–' : 'TBD') }, { h: 'Owner', k: 'owner' }, { h: 'Team', k: 'team' }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'PF/g', k: 'ppg', n: 1, f: f1 }, { h: 'All-play', k: 'allplay', n: 1, f: pct }, { h: 'Seed', k: 'seed', n: 1 }], sRows, { isMe: (r) => r.owner === myOwner });
    table($('#t-bestseasons'), [{ h: 'Season', k: 'year' }, { h: 'Owner', k: 'owner' }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'All-play', k: 'allplay', n: 1, f: pct }, { h: 'PF/g', k: 'ppg', n: 1, f: f1 }, { h: 'Finish', k: 'final', n: 1, f: (v, r) => (v ? ord(v) : r.complete ? '–' : 'in progress') }], H.best_seasons, { isMe: (r) => r.owner === myOwner });
    // h2h
    const host = $('#c-h2h');
    const rows = team ? D.h2h.filter((x) => x.id === team).sort((x, y) => (y.w - y.l) - (x.w - x.l) || y.w - x.w) : [];
    if (!rows.length) host.replaceChildren(el('p', { class: 'note', text: 'Pick a team to see its head-to-head record.' }));
    else {
      const w = W(host), rowH = 22, h = rows.length * rowH + 4, svg = svgIn(host, w, h);
      const maxG = d3.max(rows, (r) => Math.max(r.w, r.l)) || 1, mid = 70 + (w - 110) / 2;
      const x = d3.scaleLinear([0, maxG], [0, (w - 110) / 2 - 4]), y = d3.scaleBand(rows.map((r) => r.opp), [2, h - 2]).padding(0.25);
      const g = svg.selectAll('g').data(rows).join('g').attr('transform', (r) => `translate(0,${y(r.opp)})`);
      g.append('rect').attr('x', (r) => mid - x(r.l)).attr('width', (r) => x(r.l)).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', css('--bar'));
      g.append('rect').attr('x', mid).attr('width', (r) => x(r.w)).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', css('--accent'));
      g.append('text').attr('x', 62).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.opp);
      g.append('text').attr('class', 'muted').attr('x', w - 34).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((r) => `${r.w}-${r.l}`);
      svg.append('line').attr('x1', mid).attr('x2', mid).attr('y1', 0).attr('y2', h).attr('stroke', css('--line'));
      g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, (r) => `${tm(team).owner} vs ${r.opp}`, (r) => `${r.w} wins, ${r.l} losses`));
    }
    table($('#t-records'), [{ h: 'Record', k: 'kind' }, { h: 'Owner', k: 'owner' }, { h: 'Season', k: 'season' }, { h: 'Wk', k: 'wk', n: 1 }, { h: 'Pts', k: 'pts', n: 1, f: f1 }, { h: 'Opp', k: 'opp' }, { h: 'Margin', k: 'margin', n: 1, f: signed }], D.records);
    table($('#t-alltime'), [{ h: 'Owner', k: 'owner' }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'Win %', k: 'pct', n: 1, f: pct }, { h: 'Titles', k: 't', n: 1, v: (r) => r.titles.length }, { h: 'Pts/g', k: 'ppg', n: 1, f: f1 }, { h: 'Best game', k: 'high', n: 1, f: f1 }, { h: 'Best finish', k: 'best', n: 1, f: (v) => (v ? ord(v) : '–') }], D.alltime, { isMe: meRow });
  }

  function drawRivalry() {
    const A = $('#rv-a').value, B = $('#rv-b').value, host = $('#rivalry');
    if (!A || !B || A === B) { host.replaceChildren(el('p', { class: 'note', text: 'Pick two different owners.' })); return; }
    const games = D.history.rivalry.filter((g) => (g.a === A && g.b === B) || (g.a === B && g.b === A))
      .map((g) => (g.a === A ? { ...g, pa: g.ap, pb: g.bp } : { ...g, pa: g.bp, pb: g.ap })).sort((x, y) => y.year - x.year || y.wk - x.wk);
    if (!games.length) { host.replaceChildren(el('p', { class: 'note', text: `${A} and ${B} haven't played each other on ESPN yet.` })); return; }
    const wa = games.filter((g) => g.pa > g.pb).length, wb = games.filter((g) => g.pb > g.pa).length;
    const big = games.reduce((m, g) => (Math.abs(g.pa - g.pb) > Math.abs(m.pa - m.pb) ? g : m));
    let streak = 0; const lead = games[0].pa > games[0].pb ? A : B;
    for (const g of games) { if ((g.pa > g.pb ? A : B) === lead) streak++; else break; }
    host.replaceChildren(
      el('div', { class: 'rv-sum' },
        el('div', {}, el('b', { text: `${wa}` }), el('span', { text: A })), el('div', { class: 'vs', text: '–' }), el('div', {}, el('b', { text: `${wb}` }), el('span', { text: B }))),
      el('p', { class: 'note', text: `Average score ${f1(d3.mean(games, (g) => g.pa))}–${f1(d3.mean(games, (g) => g.pb))}. Biggest margin: ${f1(Math.abs(big.pa - big.pb))} (${big.year} wk ${big.wk}). ${lead} has won ${streak} straight.` }),
      el('div', { class: 'rv-games' }, ...games.map((g) => el('div', { class: g.pa > g.pb ? 'w' : 'l' }, el('span', { text: `${g.year} · Wk ${g.wk}${g.playoff ? ' · playoffs' : ''}` }), el('b', { text: `${f1(g.pa)} – ${f1(g.pb)}` })))));
  }

  // ---------- render orchestration ----------
  function renderAll() {
    if (!D) return;
    renderHeader();
    const fns = { team: renderTeam, scores: renderScores, week: renderWeek, league: renderLeague, trades: renderTrades, draft: renderDraft, history: renderHistory };
    try { fns[tab](); } catch (e) { console.error(e); }
  }
  function show(t, keepScroll) {
    tab = t;
    $$('.tab').forEach((s) => { s.hidden = s.id !== t; });
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    history.replaceState(null, '', location.pathname + location.search + '#' + t);
    renderAll();
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function setTeam(id) {
    team = Number(id) || null;
    if (team) store.set('team', String(team));
    const u = new URL(location.href); if (team) u.searchParams.set('team', team); else u.searchParams.delete('team');
    history.replaceState(null, '', u);
    const a = $('#rv-a'); if (a && team && a.options.length) { a.replaceChildren(); }
    renderAll();
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#team-pick').addEventListener('change', (e) => setTeam(e.target.value));
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 200); });

  // ---------- data ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  let loadedOnce = false;
  async function loadLeague() {
    try {
      D = await getJSON('/api/league');
      T = Object.fromEntries(D.teams.map((t) => [t.id, t]));
      if (team && !T[team]) team = null;
      $('#error').hidden = true;
      show(tab, loadedOnce); loadedOnce = true;
    } catch (e) { $('#error').textContent = e.message; $('#error').hidden = false; $('#sub').textContent = 'Couldn’t load the league'; }
  }
  let liveTimer;
  async function loadLive() {
    clearTimeout(liveTimer);
    try {
      LIVE = await getJSON('/api/live');
      if (D && (tab === 'scores' || tab === 'team')) (tab === 'scores' ? renderScores : renderTeam)();
    } catch (e) { if (!D) { $('#error').textContent = e.message; $('#error').hidden = false; } }
    liveTimer = setTimeout(loadLive, LIVE && LIVE.anyLive ? 60000 : 300000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLive(); });
  setInterval(loadLeague, 600000);
  loadLeague();
  loadLive();
})();
