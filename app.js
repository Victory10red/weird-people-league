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
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  let D = null, LIVE = null, T = {};
  let team = Number(new URLSearchParams(location.search).get('team')) || Number(store.get('team')) || null;
  let tab = (location.hash || '#live').slice(1);
  if (!['live', 'team', 'league', 'moves', 'draft', 'history'].includes(tab)) tab = 'live';
  let wvPos = 'ALL';

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
  function table(host, cols, rows, { key, isMe, sort } = {}) {
    let sortCol = sort ? sort[0] : null, dir = sort ? sort[1] : 1;
    const draw = () => {
      const data = sortCol ? [...rows].sort((a, b) => {
        const c = cols.find((c) => c.k === sortCol); const va = c.v ? c.v(a) : a[c.k], vb = c.v ? c.v(b) : b[c.k];
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir;
      }) : rows;
      const thead = el('thead', {}, el('tr', {}, ...cols.map((c) => {
        const th = el('th', { class: c.n ? 'n' : '', text: c.h + (sortCol === c.k ? (dir > 0 ? ' ▲' : ' ▼') : '') });
        th.addEventListener('click', () => { if (sortCol === c.k) dir = -dir; else { sortCol = c.k; dir = c.n ? -1 : 1; } draw(); });
        return th;
      })));
      const tbody = el('tbody');
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

  function hbars(host, rows, { label, value, fmt, color, max, tipHead, tipBody }) {
    const w = W(host), rowH = 24, svg = svgIn(host, w, 10);
    const lw = Math.min(textW(svg, rows.map(label)) + 10, w * 0.45);
    const h = rows.length * rowH + 4; svg.attr('viewBox', `0 0 ${w} ${h}`);
    const x = d3.scaleLinear([0, max ?? (d3.max(rows, value) || 1)], [lw, w - 44]);
    const y = d3.scaleBand(rows.map((_, i) => i), [2, h - 2]).padding(0.28);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (_, i) => `translate(0,${y(i)})`);
    g.append('rect').attr('x', lw).attr('height', y.bandwidth()).attr('rx', 3).attr('width', (d) => Math.max(1, x(Math.max(0, value(d))) - lw)).attr('fill', color);
    g.append('text').attr('x', lw - 8).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text(label).style('font-weight', (d) => (d.id === team ? 700 : null));
    g.append('text').attr('class', 'muted').attr('x', (d) => x(Math.max(0, value(d))) + 5).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((d) => fmt(value(d)));
    g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, tipHead, tipBody));
  }

  // ---------- rendering ----------
  const tm = (id) => T[id] || { name: '?', owner: '' };
  const meRow = (r) => team != null && [r.id, r.h, r.a].includes(team);

  function renderHeader() {
    const L = D.league;
    $('#sub').textContent = `${L.name} · ${L.year} · Week ${L.week} · updated ${new Date(D.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const sel = $('#team');
    sel.replaceChildren(el('option', { value: '', text: 'Pick your team…' }), ...[...D.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => el('option', { value: t.id, text: `${t.name} (${t.owner})` })));
    sel.value = team ?? '';
    $$('.tname').forEach((n) => { n.textContent = team ? tm(team).name : 'pick a team'; });
    $$('.towner').forEach((n) => { n.textContent = team ? tm(team).owner : 'pick a team'; });
    $('#po-n').textContent = L.playoff_teams;
  }

  function renderLive() {
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
      const side = (s, lead) => el('div', { class: 'side' + (lead ? ' lead' : '') },
        el('span', { class: 'nm', text: s.name }), el('span', { class: 'sc', text: f1(s.pts) }),
        el('span', { class: 'meta', text: `${tm(s.id).owner} · proj ${f1(s.exp)} · ${s.playing ? s.playing + ' playing · ' : ''}${s.yetToPlay} yet to play` }));
      const hw = Math.round(g.hwin * 100);
      const lu = (s) => el('div', { class: 'lu' }, el('b', { text: s.name }), ...s.rows.map((r) => el('div', { class: r.state === 'in' ? 'in' : '' },
        el('span', { class: 'muted', text: r.slot }), el('span', { text: r.name }), el('span', { class: 'pts', text: f1(r.pts) }),
        el('span', { class: 'st', text: `${r.nfl} · ${r.game}${r.state === 'pre' ? ' · proj ' + f1(r.proj) : ''}` }))));
      const card = el('div', { class: 'game' + (meRow({ h: g.h.id, a: g.a.id }) ? ' mine' : '') + (open.has(k) ? ' open' : ''), 'data-k': k, role: 'button', tabindex: '0' },
        side(g.h, g.h.pts > g.a.pts), side(g.a, g.a.pts > g.h.pts),
        el('div', { class: 'wp' }, el('i', { style: `width:${hw}%` }), el('i', { style: `width:${100 - hw}%` })),
        el('div', { class: 'wpl' }, el('span', { text: `${hw}% win` }), el('span', { text: g.done ? 'Final' : 'win odds' }), el('span', { text: `${100 - hw}% win` })),
        el('div', { class: 'lineups' }, lu(g.h), lu(g.a)));
      const toggle = () => card.classList.toggle('open');
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      return card;
    }));
  }

  function renderTeam() {
    const t = D.teams.find((x) => x.id === team);
    $('#pick-first').hidden = !!t;
    if (!t) { $('#team-name').textContent = 'Team'; $('#team-lede').textContent = ''; return; }
    $('#team-name').textContent = `${t.name} · ${t.owner}`;
    const lede = $('#team-lede');
    lede.replaceChildren('Record ', el('b', { text: `${t.w}-${t.l}` }), ' with the ', el('b', { text: ord(t.pf_rank) }), ' most points. Schedule luck: ',
      el('b', { text: signed(t.luck) }), ' wins. Playoff odds: ', el('b', { text: pct(t.playoffs) }), '.');
    const m = (LIVE && LIVE.games.find((g) => g.h.id === team || g.a.id === team));
    const wk = m ? Math.round(100 * (m.h.id === team ? m.hwin : 1 - m.hwin)) : null;
    const oppName = m ? (m.h.id === team ? m.a.name : m.h.name) : '';
    const tile = (l, v, s, cls) => el('div', { class: 'tile' }, el('div', { class: 'l', text: l }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: s }));
    $('#tiles').replaceChildren(
      tile('Record', `${t.w}-${t.l}`, `seed ${t.seed ?? '–'} · power #${t.power}`),
      tile('Points for', f1(t.pf), `${ord(t.pf_rank)} in league`),
      tile('All-play', `${t.allplay_w}-${t.allplay_l}`, 'vs every team, every week'),
      tile('Luck', signed(t.luck), 'wins vs expected', t.luck > 0 ? 'ok' : t.luck < 0 ? 'badt' : ''),
      tile('Playoff odds', pct(t.playoffs), `bye ${pct(t.bye)}`),
      tile('This week', wk == null ? '–' : wk + '%', oppName ? 'vs ' + oppName : 'win chance'));
    const n = t.need;
    $('#insights').replaceChildren(
      el('div', { class: 'key' }, el('strong', { text: `Weakest slot: ${n.weak}` }), `${f1(n.weak_mine)} pts a week vs ${f1(n.weak_league)} league-wide. Best free agent there: ${n.fa || 'none'}${n.fa_ros ? ` (${n.fa_ros} rest-of-season pts)` : ''}. Trade targets below.`),
      el('div', {}, el('strong', { text: `Strongest slot: ${n.strong}` }), `${signed(n.strong_diff)} pts a week above average, the place to trade from.`),
      el('div', {}, el('strong', { text: 'Lineup decisions' }), `${f1(t.bench_lost)} pts left on the bench this season (${pct(t.eff)} of the best possible).`),
      el('div', {}, el('strong', { text: 'Rest of the way' }), `Projected ${f1(t.exp_wins)} wins; opponents average ${t.sos == null ? '–' : f1(t.sos)} pts/week (league ${f1(D.league.avg)}).`));
    $('#weak-pos').textContent = n.weak;

    // what-if
    { const host = $('#c-whatif'), rows = t.whatif, w = W(host), h = 170, mg = { t: 18, b: 24 };
      const svg = svgIn(host, w, h);
      const x = d3.scaleBand(rows.map((r) => r.wins), [4, w - 4]).padding(0.25), y = d3.scaleLinear([0, 100], [h - mg.b, mg.t]);
      const op = d3.scaleLinear([0, d3.max(rows, (r) => r.chance) || 1], [0.25, 1]);
      const bw = Math.min(34, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      const g = svg.selectAll('g').data(rows).join('g');
      g.append('rect').attr('x', (r) => x(r.wins) + off).attr('width', bw).attr('y', (r) => y(Math.max(r.playoffs, 1))).attr('height', (r) => y(0) - y(Math.max(r.playoffs, 1))).attr('rx', 3).attr('fill', css('--accent')).attr('fill-opacity', (r) => op(r.chance));
      g.append('text').attr('x', (r) => x(r.wins) + x.bandwidth() / 2).attr('y', (r) => y(Math.max(r.playoffs, 1)) - 4).attr('text-anchor', 'middle').text((r) => r.playoffs + '%');
      g.append('text').attr('class', 'muted').attr('x', (r) => x(r.wins) + x.bandwidth() / 2).attr('y', h - 6).attr('text-anchor', 'middle').text((r) => `${r.wins}-${D.league.reg_weeks - r.wins}`);
      g.append('rect').attr('x', (r) => x(r.wins)).attr('width', x.bandwidth()).attr('height', h).attr('fill', 'transparent').call((s) => hover(s, (r) => `Finish ${r.wins}-${D.league.reg_weeks - r.wins}`, (r) => `${pct(r.chance)} likely · makes playoffs ${r.playoffs}% of the time`)); }

    // season
    { const host = $('#c-season'), rows = t.weeks, w = W(host), h = 210, mg = { l: 32, r: 6, t: 8, b: 22 };
      const svg = svgIn(host, w, h);
      const x = d3.scaleBand(rows.map((r) => r.wk), [mg.l, w - mg.r]).padding(0.3);
      const y = d3.scaleLinear([0, (d3.max(rows, (r) => Math.max(r.pts, r.opp_pts)) || 100) * 1.08], [h - mg.b, mg.t]).nice();
      svg.append('g').attr('class', 'grid').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(w - mg.l - mg.r))).call((a) => { a.select('.domain').remove(); a.selectAll('text').attr('class', 'muted'); });
      const bw = Math.min(32, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      const g = svg.append('g').selectAll('g').data(rows).join('g');
      g.append('rect').attr('x', (r) => x(r.wk) + off).attr('width', bw).attr('y', (r) => y(r.pts)).attr('height', (r) => y(0) - y(r.pts)).attr('rx', 3).attr('fill', (r) => (r.pts > r.opp_pts ? css('--accent') : css('--bar')));
      g.append('line').attr('x1', (r) => x(r.wk) + off - 4).attr('x2', (r) => x(r.wk) + off + bw + 4).attr('y1', (r) => y(r.opp_pts)).attr('y2', (r) => y(r.opp_pts)).attr('stroke', css('--fg')).attr('stroke-width', 2).attr('stroke-linecap', 'round');
      g.append('text').attr('class', 'muted').attr('x', (r) => x(r.wk) + x.bandwidth() / 2).attr('y', h - 6).attr('text-anchor', 'middle').text((r) => 'W' + r.wk);
      svg.append('line').attr('x1', mg.l).attr('x2', w - mg.r).attr('y1', y(D.league.avg)).attr('y2', y(D.league.avg)).attr('stroke', css('--muted')).attr('stroke-dasharray', '4 4');
      g.append('rect').attr('x', (r) => x(r.wk)).attr('width', x.bandwidth()).attr('height', h).attr('fill', 'transparent').call((s) => hover(s, (r) => `Week ${r.wk} vs ${tm(r.opp).name}`, (r) => `${r.pts > r.opp_pts ? 'W' : 'L'} ${f1(r.pts)}–${f1(r.opp_pts)} · ${ord(r.rank)} of ${D.teams.length} · proj was ${f1(r.proj)}`)); }

    table($('#t-sched'), [{ h: 'Wk', k: 'wk' }, { h: 'Opponent', k: 'opp', v: (r) => tm(r.opp).name }, { h: 'Owner', k: 'own', v: (r) => tm(r.opp).owner }, { h: 'Win', k: 'win', n: 1, bar: 1, f: (v) => v + '%' }], D.sched.filter((s) => s.id === team));

    // positions
    { const host = $('#c-pos'), rows = Object.entries(t.pos).map(([p, v]) => ({ p, v, avg: D.pos_avg[p], d: v - D.pos_avg[p] })), w = W(host), rowH = 24, h = rows.length * rowH + 4;
      const svg = svgIn(host, w, h), ext = d3.max(rows, (r) => Math.abs(r.d)) || 1;
      const x = d3.scaleLinear([-ext, ext], [44, w - 46]), y = d3.scaleBand(rows.map((r) => r.p), [2, h - 2]).padding(0.28);
      svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h).attr('stroke', css('--line'));
      const g = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (r) => `translate(0,${y(r.p)})`);
      g.append('rect').attr('x', (r) => Math.min(x(0), x(r.d))).attr('width', (r) => Math.max(1, Math.abs(x(r.d) - x(0)))).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', (r) => (r.d >= 0 ? css('--accent-2') : css('--bad')));
      g.append('text').attr('x', 36).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.p);
      g.append('text').attr('class', 'muted').attr('x', (r) => (r.d >= 0 ? x(r.d) + 4 : x(0) + 4)).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((r) => signed(r.d));
      g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, (r) => r.p, (r) => `${f1(r.v)} pts/wk · league ${f1(r.avg)}`)); }

    table($('#t-roster'), [
      { h: 'Slot', k: 'slot' }, { h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'NFL', k: 'nfl' }, { h: 'Inj', k: 'inj', f: (v) => v || '' },
      { h: 'This wk', k: 'proj', n: 1, f: f1 }, { h: 'Rest of season', k: 'ros', n: 1 }, { h: 'Season', k: 'season', n: 1, f: f1 },
      { h: '', k: 'note', f: (v) => v || '', cls: (r) => (r.note === 'Start' ? 'good' : r.note === 'Sit' ? 'bad' : '') }], D.rosters[team] || []);
    table($('#t-targets'), [{ h: 'Player', k: 'name' }, { h: 'Team', k: 'from', v: (r) => tm(r.from).name }, { h: 'Owner', k: 'own', v: (r) => tm(r.from).owner }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'Season', k: 'season', n: 1, f: f1 }], t.targets);
    renderWaivers();
  }

  function renderWaivers() {
    const seg = $('#wv-seg');
    const opts = ['ALL', 'QB', 'RB', 'WR', 'TE', 'D/ST', 'K'];
    seg.replaceChildren(...opts.map((p) => { const b = el('button', { 'aria-pressed': String(p === wvPos), text: p }); b.addEventListener('click', () => { wvPos = p; renderWaivers(); }); return b; }));
    const rows = wvPos === 'ALL' ? Object.values(D.waivers).flatMap((l) => l.slice(0, 3)).sort((a, b) => b.ros - a.ros) : D.waivers[wvPos] || [];
    table($('#t-waivers'), [{ h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'NFL', k: 'team' }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'This wk', k: 'proj', n: 1, f: f1 }, { h: 'Rostered', k: 'owned', n: 1, f: (v) => v + '%' }, { h: '', k: 'status', f: (v) => (v === 'WAIVERS' ? 'Waivers' : 'FA') }], rows);
  }

  function renderLeague() {
    table($('#t-power'), [
      { h: '#', k: 'power', n: 1 }, { h: 'Team', k: 'name' }, { h: 'Owner', k: 'owner' }, { h: 'Rec', k: 'w', v: (r) => r.w, f: (_, r) => `${r.w}-${r.l}` },
      { h: 'PF', k: 'pf', n: 1, f: f1 }, { h: 'All-play', k: 'allplay_w', f: (_, r) => `${r.allplay_w}-${r.allplay_l}` },
      { h: 'Luck', k: 'luck', n: 1, f: signed, cls: (r) => (r.luck > 0 ? 'good' : r.luck < 0 ? 'bad' : '') },
      { h: 'Roster/wk', k: 'ros', n: 1, f: f1 }, { h: 'Playoffs', k: 'playoffs', n: 1, bar: 1, f: pct }, { h: 'Bye', k: 'bye', n: 1, f: pct }], D.teams, { isMe: meRow });
    const ordered = [...D.teams].sort((a, b) => b.playoffs - a.playoffs);
    // odds: stacked bye + playoffs
    { const host = $('#c-odds'), w = W(host), rowH = 24, svg = svgIn(host, w, 10);
      const lw = Math.min(textW(svg, ordered.map((r) => r.name)) + 10, w * 0.45), h = ordered.length * rowH + 4; svg.attr('viewBox', `0 0 ${w} ${h}`);
      const x = d3.scaleLinear([0, 100], [lw, w - 40]), y = d3.scaleBand(ordered.map((r) => r.id), [2, h - 2]).padding(0.28);
      const g = svg.selectAll('g').data(ordered).join('g').attr('transform', (r) => `translate(0,${y(r.id)})`);
      g.append('rect').attr('x', lw).attr('width', x(100) - lw).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', css('--panel-2'));
      g.append('rect').attr('x', lw).attr('width', (r) => x(r.playoffs) - lw).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', (r) => (r.id === team ? css('--accent') : css('--accent-2'))).attr('fill-opacity', 0.55);
      g.append('rect').attr('x', lw).attr('width', (r) => x(r.bye) - lw).attr('height', y.bandwidth()).attr('rx', 3).attr('fill', (r) => (r.id === team ? css('--accent') : css('--accent-2')));
      g.append('text').attr('x', lw - 8).attr('y', y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((r) => r.name).style('font-weight', (r) => (r.id === team ? 700 : null));
      g.append('text').attr('class', 'muted').attr('x', (r) => x(r.playoffs) + 4).attr('y', y.bandwidth() / 2).attr('dy', '.35em').text((r) => pct(r.playoffs));
      g.append('rect').attr('width', w).attr('height', y.bandwidth()).attr('fill', 'transparent').call((s) => hover(s, (r) => r.name, (r) => `Playoffs ${pct(r.playoffs)} · bye ${pct(r.bye)} · last place ${pct(r.last)} · ~${f1(r.exp_wins)} wins`)); }
    // luck dumbbell
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
    hbars($('#c-bench'), [...D.teams].sort((a, b) => a.bench_lost - b.bench_lost), { label: (r) => r.name, value: (r) => r.bench_lost, fmt: (v) => f1(v), color: (r) => (r.id === team ? css('--accent') : css('--bar')), tipHead: (r) => r.name, tipBody: (r) => `${f1(r.bench_lost)} pts left on the bench · ${pct(r.eff)} of best possible` });
    // heatmap
    { const rows = [...D.teams].sort((a, b) => d3.mean(a.weeks, (x) => x.rank) - d3.mean(b.weeks, (x) => x.rank)), weeks = D.league.done, host = $('#c-heat'), w = W(host), cell = 24, svg = svgIn(host, w, 10);
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
      if (x.bandwidth() >= 22) g.selectAll('text.c').data((r) => r.weeks.map((wk) => ({ ...wk, id: r.id }))).join('text').attr('class', 'c').attr('x', (d) => x(d.wk) + x.bandwidth() / 2).attr('y', (d) => y(d.id) + y.bandwidth() / 2).attr('dy', '.35em').attr('text-anchor', 'middle').style('pointer-events', 'none').style('font-size', '11px').style('fill', (d) => (d.rank <= 3 ? '#fff' : null)).text((d) => d.rank); }
  }

  function renderMoves() {
    const host = $('#trades');
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
    hbars($('#c-haul'), haul, { label: (r) => r.name, value: (r) => r.pts, fmt: (v) => d3.format(',.0f')(v), color: (r) => (r.id === team ? css('--accent') : css('--bar')), tipHead: (r) => r.name, tipBody: (r) => `${f1(r.pts)} season pts from drafted players` });
    const dcols = [{ h: 'Pick', k: 'pick', n: 1 }, { h: 'Player', k: 'name' }, { h: 'Team', k: 'id', v: (r) => tm(r.id).name }, { h: 'Drafted', k: 'pos_pick', f: (_, r) => r.pos + r.pos_pick }, { h: 'Now', k: 'pos_finish', f: (_, r) => (r.pos_finish ? r.pos + r.pos_finish : '–') }, { h: 'Pts', k: 'season', n: 1, f: f1 }];
    const graded = D.draft.filter((d) => d.swing != null);
    table($('#t-steals'), dcols, [...graded].sort((a, b) => b.swing - a.swing).slice(0, 10), { isMe: meRow });
    table($('#t-busts'), dcols, graded.filter((d) => d.rd <= 6).sort((a, b) => a.swing - b.swing).slice(0, 10), { isMe: meRow });
    table($('#t-mydraft'), [dcols[0], dcols[1], dcols[3], dcols[4], dcols[5]], team ? D.draft.filter((d) => d.id === team) : []);
  }

  function renderHistory() {
    $('#champs').replaceChildren(...[...D.champs].reverse().map((c) => el('div', { class: 'champ' }, el('div', { class: 'yr', text: c.year }), el('div', { class: 'who', text: `${c.owner} · ${c.team}` }), el('div', { class: 'how', text: `${c.record}, ${c.seed ? ord(c.seed) + ' seed' : ''} · beat ${c.runner_up} ${c.final}` }))));
    table($('#t-alltime'), [{ h: 'Owner', k: 'owner' }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'Win %', k: 'pct', n: 1, f: pct }, { h: 'Titles', k: 't', n: 1, v: (r) => r.titles.length }, { h: 'Years', k: 'y', v: (r) => r.titles.join(', ') || '–' }, { h: 'Pts/g', k: 'ppg', n: 1, f: f1 }, { h: 'Best game', k: 'high', n: 1, f: f1 }, { h: 'Best finish', k: 'best', n: 1, f: (v) => (v ? ord(v) : '–') }], D.alltime, { isMe: meRow });
    table($('#t-records'), [{ h: 'Record', k: 'kind' }, { h: 'Owner', k: 'owner' }, { h: 'Season', k: 'season' }, { h: 'Wk', k: 'wk', n: 1 }, { h: 'Pts', k: 'pts', n: 1, f: f1 }, { h: 'Opp', k: 'opp' }, { h: 'Opp pts', k: 'opp_pts', n: 1, f: f1 }, { h: 'Margin', k: 'margin', n: 1, f: signed }], D.records);
    const host = $('#c-h2h');
    const rows = team ? D.h2h.filter((x) => x.id === team).sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w) : [];
    if (!rows.length) { host.replaceChildren(el('p', { class: 'note', text: 'Pick a team to see its head-to-head record.' })); return; }
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

  function renderAll() {
    if (!D) return;
    renderHeader();
    const fns = { live: renderLive, team: renderTeam, league: renderLeague, moves: renderMoves, draft: renderDraft, history: renderHistory };
    try { fns[tab](); } catch (e) { console.error(e); }
  }

  // ---------- tabs + picker ----------
  function show(t) {
    tab = t;
    $$('.tab').forEach((s) => { s.hidden = s.id !== t; });
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    history.replaceState(null, '', location.pathname + location.search + '#' + t);
    renderAll();
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#team').addEventListener('change', (e) => {
    team = Number(e.target.value) || null;
    if (team) store.set('team', String(team));
    const u = new URL(location.href); if (team) u.searchParams.set('team', team); else u.searchParams.delete('team');
    history.replaceState(null, '', u);
    renderAll();
    if (tab === 'live') renderLive();
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 200); });

  // ---------- data ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  async function loadLeague() {
    try {
      D = await getJSON('/api/league');
      T = Object.fromEntries(D.teams.map((t) => [t.id, t]));
      if (team && !T[team]) team = null;
      $('#error').hidden = true;
      show(tab);
    } catch (e) { $('#error').textContent = e.message; $('#error').hidden = false; $('#sub').textContent = 'Couldn’t load the league'; }
  }
  let liveTimer;
  async function loadLive() {
    clearTimeout(liveTimer);
    try {
      LIVE = await getJSON('/api/live');
      if (tab === 'live' || tab === 'team') (tab === 'live' ? renderLive : renderTeam)();
    } catch (e) { if (!D) { $('#error').textContent = e.message; $('#error').hidden = false; } }
    liveTimer = setTimeout(loadLive, LIVE && LIVE.anyLive ? 60000 : 300000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadLive(); } });
  setInterval(loadLeague, 600000);
  renderLive();
  loadLeague();
  loadLive();
})();
