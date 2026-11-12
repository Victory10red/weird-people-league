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
  const TABS = ['team', 'week', 'talk', 'play', 'league'];
  const LVIEWS = ['standings', 'players', 'playoffs', 'moves', 'draft', 'history'];

  let D = null, LIVE = null, T = {};
  let team = Number(new URLSearchParams(location.search).get('team')) || Number(store.get('team')) || null;
  // who is using this device (games, Dump Log, welcome) — separate from which team is being viewed
  let ME = Number(store.get('me')) || null;
  if (!team && ME) team = ME;
  let tab = (location.hash || '#team').slice(1).toLowerCase();
  let leagueView = LVIEWS.includes(store.get('lview')) ? store.get('lview') : 'standings';
  // shareable links straight to a page: /#pickem, /#predictions, /#playoffs, /#trophies …
  const ROUTES = {
    pickem: ['play', 'pick'], picks: ['play', 'pick'], predictions: ['play', 'pred'], predict: ['play', 'pred'], dump: ['play', 'poop'], poop: ['play', 'poop'], breakaway: ['play', 'bk'],
    standings: ['league', 'standings'], players: ['league', 'players'], wire: ['league', 'players'], injuries: ['league', 'players'], depth: ['league', 'players'], playoffs: ['league', 'playoffs'], bracket: ['league', 'playoffs'], toilet: ['league', 'playoffs'], moves: ['league', 'moves'], trophies: ['league', 'history'],
    roster: ['team', 'roster'], waivers: ['team', 'roster'], outlook: ['team', 'outlook'], season: ['team', 'season'],
  };
  const GAME_ROUTE = { pick: 'pickem', pred: 'predictions', poop: 'dump', bk: 'breakaway' }, LV_ROUTE = { standings: 'standings', players: 'players', playoffs: 'playoffs', moves: 'moves', draft: 'draft', history: 'history' };
  let linkGame = null, linkTeamView = null;
  function applyRoute(h) {
    const r = ROUTES[h]; if (!r) return h;
    if (r[0] === 'play') linkGame = r[1]; else if (r[0] === 'league') leagueView = r[1]; else linkTeamView = r[1];
    return r[0];
  }
  tab = applyRoute(tab);
  // old links from before the tabs were merged
  if (tab === 'live' || tab === 'scores') tab = 'week';
  if (tab === 'trades') { tab = 'league'; leagueView = 'moves'; }
  if (tab === 'draft' || tab === 'history') { leagueView = tab; tab = 'league'; }
  if (!TABS.includes(tab)) tab = 'team';
  let wvPos = 'ALL', yrSel = null, bumpFocus = null;
  let heroOpen = null, heroWeek = null; const weekCache = {};
  let teamView = linkTeamView || (['week', 'roster', 'outlook', 'season'].includes(store.get('teamview')) ? store.get('teamview') : 'week');

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
  function table(host, cols, rows, { isMe, sort, stick } = {}) {
    let sortCol = sort ? sort[0] : null, dir = sort ? sort[1] : 1;
    const draw = () => {
      const data = sortCol ? [...rows].sort((a, b) => {
        const c = cols.find((c) => c.k === sortCol); const va = c.v ? c.v(a) : a[c.k], vb = c.v ? c.v(b) : b[c.k];
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''))) * dir;
      }) : rows;
      const thead = el('thead', {}, el('tr', {}, ...cols.map((c) => {
        const th = el('th', { class: (c.n ? 'n' : '') + (c.wide ? ' wide' : ''), text: c.h + (sortCol === c.k ? (dir > 0 ? ' ▲' : ' ▼') : '') });
        th.addEventListener('click', () => { if (sortCol === c.k) dir = -dir; else { sortCol = c.k; dir = c.n ? -1 : 1; } draw(); });
        return th;
      })));
      const tbody = el('tbody');
      if (!data.length) tbody.append(el('tr', {}, el('td', { class: 'empty', colspan: cols.length, text: 'Nothing here yet.' })));
      for (const r of data) {
        const tr = el('tr', { class: isMe && isMe(r) ? 'me' : '' });
        for (const c of cols) {
          const raw = c.v ? c.v(r) : r[c.k];
          const td = el('td', { class: (c.n ? 'n ' : '') + (c.wide ? 'wide ' : '') + (c.cls ? c.cls(r) || '' : '') });
          if (c.bar) {
            const w = Math.max(2, Math.round(46 * (raw || 0) / 100));
            td.append(el('span', { class: 'cbar' }, el('i', { class: raw >= 50 ? 'hot' : '', style: `width:${w}px` }), el('span', { text: c.f ? c.f(raw, r) : raw })));
          } else if (c.node) td.append(c.node(r));
          else td.textContent = c.f ? c.f(raw, r) : raw == null || raw === '' ? '–' : raw;
          tr.append(td);
        }
        tbody.append(tr);
      }
      host.replaceChildren(el('table', { class: stick ? 'stick' : '' }, thead, tbody));
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
  const nflByAbbr = () => { const m = {}; for (const g of (D.nfl || [])) { m[g.home.abbr] = { g, me: g.home, them: g.away, themId: g.awayId, home: true }; m[g.away.abbr] = { g, me: g.away, them: g.home, themId: g.homeId, home: false }; } return m; };
  const kick = (iso) => { const d = new Date(iso); return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }); };
  const wxShort = (g) => {
    if (!g) return '–';
    if (g.indoor) return 'Dome';
    const w = g.weather; if (!w) return 'Soon';
    const bits = [];
    if (w.temp != null) bits.push(`${Math.round(w.temp)}°`);
    if (w.wind != null) bits.push(`${Math.round(w.wind)} mph`);
    if (w.precip != null && w.precip >= 20) bits.push(`${w.precip}% rain`);
    return bits.join(' · ') || w.text || '–';
  };
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
    sel.replaceChildren(el('option', { value: '', text: 'Pick a team…' }), ...[...D.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => el('option', { value: t.id, text: `${t.name} (${t.owner})` })));
    sel.value = team ?? '';
    $$('.tname').forEach((n) => { n.textContent = team ? tm(team).name : 'pick a team'; });
    $$('.towner').forEach((n) => { n.textContent = team ? tm(team).owner : 'pick a team'; });
    $$('#po-n').forEach((n) => { n.textContent = L.playoff_teams; });
  }

  // ---------- live matchup pieces ----------
  function lineupList(s, opts = {}) {
    const by = D ? nflByAbbr() : {}, avg = (D && D.pavg) || {};
    const past = !!opts.past;
    const tt = D && D.teams.find((x) => x.id === s.id), ss = past ? {} : (tt && tt.start_sit) || {};
    const injOf = {}; if (D && !past) for (const r of D.rosters[s.id] || []) if (r.inj) injOf[r.pid] = r.inj;
    const head = past ? el('div', { class: 'luh' }, el('span'), el('span'), el('span', { text: 'Avg' }), el('span', { text: 'Proj' }), el('span', { text: 'Pts' })) : el('div', { class: 'luh' }, el('span'), el('span'), el('span', { text: 'Avg' }), el('span', { text: 'ESPN' }), el('span', { text: 'Vegas', title: 'Season average × how much more or less Vegas expects his team to score this week than usual' }), el('span', { text: 'vs Opp', title: 'Fantasy points per game this opponent allows to the position (this league\'s scoring). Rank 32nd = easiest matchup.' }), el('span', { text: 'Pts' }));
    const row = (r) => {
      const x = past ? null : by[r.nfl];
      const opp = x ? `${x.home ? 'vs' : '@'} ${x.them.abbr}` : '';
      const when = r.state === 'pre' ? (x ? kick(x.g.kickoff) : 'Not started') : r.game;
      const wx = x && !x.g.indoor && x.g.weather && r.state === 'pre' ? wxFlag(x.g.weather, r.pos) : '';
      const a = avg[r.pid];
      const pctOfProj = r.state !== 'pre' && r.proj > 0 ? r.pts - r.proj : null;
      const tag = ss[r.pid];
      return el('div', { class: 'lur' + (r.state === 'in' ? ' in' : '') + (r.state === 'bye' ? ' bye' : '') + (tag ? ' tag-' + tag.toLowerCase() : '') },
        el('span', { class: 'muted', text: r.slot === 'BN' ? (r.pos === 'D/ST' ? 'D/ST' : r.pos) : r.slot }),
        el('span', { class: 'who' }, el('span', { class: 'nm' }, r.name, injOf[r.pid] ? el('b', { class: 'inj', title: { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured reserve', SSPD: 'Suspended' }[injOf[r.pid]] || '', text: injOf[r.pid] }) : null, tag ? el('b', { class: 'ss ' + tag.toLowerCase(), text: tag }) : null), el('span', { class: 'st' }, `${r.nfl}${opp ? ' ' + opp : ''} · ${when}`, wx ? el('em', { text: ' · ' + wx }) : null)),
        el('span', { class: 'num muted', text: a != null ? f1(a) : '–' }),
        el('span', { class: 'num muted', text: r.state === 'bye' ? 'BYE' : f1(r.proj) }),
        past ? null : vegCell(r.pid, r.proj),
        past ? null : oppCell(x, r.pos),
        el('span', { class: 'num pts' + (r.state === 'post' && pctOfProj != null ? (pctOfProj >= 0 ? ' up' : ' down') : ''), text: r.state === 'pre' || r.state === 'bye' ? '–' : f1(r.pts) }));
    };
    const bench = (s.bench || []).filter((r) => r.slot !== 'IR');
    const key = 'bench-' + s.id + (past ? '-' + opts.week : '');
    const showBench = !!benchOpen[key];
    const btn = bench.length ? el('button', { class: 'bench-toggle', type: 'button', text: showBench ? `Hide bench ▴` : `Show bench (${bench.length}) ▾` }) : null;
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); benchOpen[key] = !benchOpen[key]; const host = btn.closest('.lu'); host.replaceWith(lineupList(s, opts)); });
    return el('div', { class: 'lu' + (past ? ' past' : '') }, el('b', { text: s.name }), head, ...s.rows.map(row), btn,
      showBench ? el('div', { class: 'benchrows' }, ...bench.map(row)) : null);
  }
  const benchOpen = {};
  const vegCell = (pid, espn) => {
    const v = D && D.vproj ? D.vproj[pid] : null;
    if (v == null) return el('span', { class: 'num muted', text: '–' });
    const d = v - (espn || 0);
    return el('span', { class: 'num veg' + (d >= 2 ? ' up' : d <= -2 ? ' down' : ''), text: f1(v) });
  };
  const POSID = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, 'D/ST': 16 };
  const oppCell = (x, pos) => {
    const tbl = D && D.oprk && D.oprk[POSID[pos]], v = x && tbl ? tbl[x.themId] : null;
    if (!v) return el('span', { class: 'num muted opp', text: '–' });
    const [avg, rank] = v, cls = rank >= 25 ? ' easy' : rank <= 8 ? ' hard' : '';
    return el('span', { class: 'num opp' + cls, title: `${x.them.abbr} allows ${f1(avg)} pts/game to ${pos}s (league avg ${f1(tbl.avg)}); ${ord(rank)} most` },
      el('span', { text: f1(avg) }), el('small', { text: ord(rank) }));
  };
  const wxFlag = (w, pos) => {
    if (!['QB', 'WR', 'TE', 'K'].includes(pos)) return '';
    const b = [];
    if ((w.wind || 0) >= 15) b.push(`${Math.round(w.wind)} mph wind`);
    if ((w.precip || 0) >= 60) b.push(`${w.precip}% ${w.temp <= 33 ? 'snow' : 'rain'}`);
    if (w.temp != null && w.temp <= 25) b.push(`${Math.round(w.temp)}°`);
    return b.join(', ');
  };
  function sideBlock(s, lead, extra, past) {
    const proj = (s.rows || []).reduce((a, r) => a + (r.proj || 0), 0);
    return el('div', { class: 'side' + (lead ? ' lead' : '') },
      el('span', { class: 'nm', text: s.name }), el('span', { class: 'sc', text: f1(s.pts) }),
      el('span', { class: 'meta', text: past ? `${tm(s.id).owner} · ESPN projected ${f1(proj)} · final` : `${tm(s.id).owner} · proj ${f1(s.exp)}${extra ? ' · ' + extra : ''} · ${s.playing ? s.playing + ' playing · ' : ''}${s.yetToPlay} to play` }));
  }
  function needLine(me, them, mine) {
    if (me.share === 0 && them.share === 0) return null;
    const leftMe = me.exp - me.pts, leftThem = them.exp - them.pts, nMe = me.yetToPlay + me.playing, nThem = them.yetToPlay + them.playing;
    const need = them.exp - me.pts;
    const who = mine ? 'You need' : `${tm(me.id).owner} needs`;
    const bits = [];
    if (nMe) bits.push(`${who} about ${f1(Math.max(0, need))} more from ${nMe} player${nMe > 1 ? 's' : ''} (${f1(Math.max(0, need) / nMe)} each) to match ${tm(them.id).owner}'s pace. They're projected for ${f1(leftMe)}.`);
    else bits.push(`${mine ? 'You\'re' : tm(me.id).owner + ' is'} done at ${f1(me.pts)}.`);
    if (nThem) bits.push(`${tm(them.id).owner} has ${nThem} left, projected for ${f1(leftThem)} more.`);
    else bits.push(`${tm(them.id).owner} is done at ${f1(them.pts)}.`);
    return el('p', { class: 'need' }, ...bits.map((b, i) => (i ? ' ' + b : b)));
  }
  // ---- win odds over the day (recorded every ~5 minutes during games) ----
  let WP = null, wpAt = 0, wpKey = '';
  async function loadWP() {
    if (!LIVE) return;
    const k = `${LIVE.year}:${LIVE.week}`;
    if (WP && wpKey === k && Date.now() - wpAt < 60000) return;
    wpAt = Date.now(); wpKey = k;
    try { WP = (await getJSON(`/api/live?series=1&year=${LIVE.year}&week=${LIVE.week}`)).series || {}; } catch { WP = WP || {}; }
    $$('.wpc[data-k]').forEach((host) => drawWP(host, host.dataset.k, Number(host.dataset.me)));
  }
  // host: container; key "h-a"; me: the team whose odds to show
  function wpChart(key, me) { const host = el('div', { class: 'wpc', 'data-k': key, 'data-me': me }); setTimeout(() => { if (WP) drawWP(host, key, me); else loadWP(); }, 0); return host; }
  function drawWP(host, key, me) {
    const pts = (WP && WP[key]) || [];
    if (!host.isConnected) return;
    const [hId] = key.split('-').map(Number), meHome = me === hId;
    if (pts.length < 2) { host.replaceChildren(el('p', { class: 'note wpc-empty', text: 'The win-odds line fills in during games (a point every few minutes).' })); return; }
    const w = W(host), h = 118, m = { l: 30, r: 40, t: 10, b: 18 };
    const svg = svgIn(host, w, h);
    const t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 3600000);
    const x = d3.scaleTime([t0, t1], [m.l, w - m.r]), y = d3.scaleLinear([0, 100], [h - m.b, m.t]);
    const val = (p) => 100 * (meHome ? p[1] : 1 - p[1]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(w / 110))).tickFormat(d3.timeFormat('%-I%p')).tickSize(0)).call((a) => a.select('.domain').remove());
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues([0, 50, 100]).tickFormat((v) => v + '%').tickSize(-(w - m.l - m.r))).call((a) => a.select('.domain').remove());
    const line = d3.line().x((p) => x(p[0])).y((p) => y(val(p))).curve(d3.curveStepAfter);
    const area = d3.area().x((p) => x(p[0])).y0(y(50)).y1((p) => y(val(p))).curve(d3.curveStepAfter);
    svg.append('path').attr('d', area(pts)).attr('fill', css('--accent')).attr('fill-opacity', 0.1);
    svg.append('path').attr('d', line(pts)).attr('fill', 'none').attr('stroke', css('--accent')).attr('stroke-width', 2.2);
    // big plays: green for yours, red for theirs
    const marks = []; pts.forEach((p, i) => (p[4] || []).forEach((n) => { const mine = (n[0] === 'H') === meHome; marks.push({ p, prev: pts[i - 1] || p, text: n.slice(2), mine }); }));
    svg.selectAll('circle.wpm').data(marks).join('circle').attr('class', 'wpm').attr('cx', (d) => x(d.p[0])).attr('cy', (d) => y(val(d.p))).attr('r', 4.5)
      .attr('fill', (d) => (d.mine ? css('--good') : css('--bad'))).attr('stroke', css('--panel')).attr('stroke-width', 1.5)
      .call((sel) => hover(sel, (d) => d.text, (d) => `${Math.round(val(d.prev))}% → ${Math.round(val(d.p))}% · ${new Date(d.p[0]).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`));
    const last = pts[pts.length - 1];
    svg.append('text').attr('x', x(last[0]) + 6).attr('y', y(val(last))).attr('dy', '.35em').attr('class', 'wpc-end').text(Math.round(val(last)) + '%');
    const big = marks.map((d) => ({ ...d, sw: val(d.p) - val(d.prev) })).sort((a, b) => Math.abs(b.sw) - Math.abs(a.sw))[0];
    if (big && Math.abs(big.sw) >= 3) host.append(el('p', { class: 'note wpc-note', text: `Biggest swing: ${big.text} (${big.sw > 0 ? '+' : ''}${Math.round(big.sw)}%)` }));
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
        sideBlock(g.h, g.h.pts > g.a.pts), sideBlock(g.a, g.a.pts > g.h.pts), ...wpBar(hw, g.done), el('div', { class: 'lineups' }, el('div', { class: 'need-wrap' }, needLine(g.h, g.a, g.h.id === team), wpChart(`${g.h.id}-${g.a.id}`, g.a.id === team ? g.a.id : g.h.id)), lineupList(g.h), lineupList(g.a)));
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
      b.addEventListener('click', () => { if (!ME) setMe(t.id); else setTeam(t.id); });
      return b;
    }));
  }

  const letter = (g) => (g >= 4.15 ? 'A+' : g >= 3.85 ? 'A' : g >= 3.5 ? 'A-' : g >= 3.15 ? 'B+' : g >= 2.85 ? 'B' : g >= 2.5 ? 'B-' : g >= 2.15 ? 'C+' : g >= 1.85 ? 'C' : g >= 1.5 ? 'C-' : g >= 1.15 ? 'D+' : g >= 0.85 ? 'D' : 'F');
  function renderTeam() {
    const t = D.teams.find((x) => x.id === team);
    $('#pick-first').hidden = !!t;
    $('#team-body').hidden = !t;
    if (!t) { renderPickFirst(); return; }
    $('#team-name').textContent = `${t.name} · ${t.owner}`;
    { const host = $('#viewing');
      if (ME && T[ME] && ME !== team) { const back = el('button', { class: 'linkbtn', type: 'button', text: `Back to ${T[ME].name}` }); back.addEventListener('click', () => setTeam(ME)); host.replaceChildren(el('span', {}, `👀 Viewing ${t.owner}'s team · `), back); host.hidden = false; }
      else host.hidden = true; }
    const live = myLive();
    const st = $('#team-status');
    st.textContent = LIVE && LIVE.anyLive ? 'Live' : live && live.done ? 'Final' : `Week ${D.league.week}`;
    st.className = 'pill' + (LIVE && LIVE.anyLive ? ' live' : '');
    // summary tiles (always visible)
    const tile = (l, v, s2, cls) => el('div', { class: 'tile' }, el('div', { class: 'l', text: l }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: s2 }));
    $('#tiles').replaceChildren(
      tile('Record', `${t.w}-${t.l}`, `${t.seed ? ord(t.seed) + ' place' : ''}${t.power ? ` · ${ord(t.power)} in power rankings` : ''}`),
      tile('Points scored', f1(t.pf), `${ord(t.pf_rank)} most · ${Math.abs(t.luck) < 0.5 ? 'record matches the scoring' : t.luck < 0 ? `unlucky: ${f1(-t.luck)} wins short` : `lucky: ${f1(t.luck)} wins extra`}`, ''),
      tile('Playoff odds', pct(t.playoffs), `${t.whatif && t.whatif.seed_median ? `likely finish ${ord(t.whatif.seed_median)} · ` : ''}${pct(t.bye)} chance at a bye`),
      tile('Manager grade', t.card ? letter(t.card.gpa) : '–', t.card ? `${ord(t.card.rank)} of ${D.teams.length} (draft, waivers, lineups, trades)` : ''));
    $$('#subnav button').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.view === teamView)); });
    $$('#team-body .view').forEach((v) => { v.hidden = v.dataset.view !== teamView; });
    ({ week: viewWeek, roster: viewRoster, outlook: viewOutlook, season: viewSeason })[teamView](t, live);
  }

  function viewWeek(t, live) {
    // hero matchup
    const hero = $('#hero');
    const m = myMatch();
    const vm = (D.vegas_matchups || []).find((x) => x.h === team || x.a === team);
    const cur = LIVE ? LIVE.week : D.league.week;
    const wkSel = el('select', { class: 'wk-pick', 'aria-label': 'Week' }, ...d3.range(cur, 0, -1).map((w) => el('option', { value: w, text: w === cur ? `Week ${w} matchup` : `Week ${w}` })));
    wkSel.value = heroWeek || cur;
    wkSel.addEventListener('change', () => { heroWeek = Number(wkSel.value) === cur ? null : Number(wkSel.value); viewWeek(t, myLive()); });
    const heroHead = el('div', { class: 'hero-h' }, wkSel);
    if (heroWeek && heroWeek < cur) {
      const wd = weekCache[heroWeek];
      if (!wd) {
        hero.replaceChildren(el('div', { class: 'game hero-card mine' }, heroHead, el('p', { class: 'note', text: `Loading week ${heroWeek}…` })));
        getJSON(`/api/live?week=${heroWeek}`).then((j) => { weekCache[j.week] = j; if (tab === 'team' && teamView === 'week') viewWeek(t, myLive()); })
          .catch((e) => { hero.replaceChildren(el('div', { class: 'game hero-card mine' }, heroHead, el('p', { class: 'note', text: `Couldn't load week ${heroWeek} (${e.message}).` }))); });
      } else {
        const g = wd.games.find((x) => x.h.id === team || x.a.id === team);
        if (!g) { hero.replaceChildren(el('div', { class: 'game hero-card mine' }, heroHead, el('p', { class: 'note', text: `No matchup for you in week ${heroWeek}.` }))); }
        else {
          const meIsH = g.h.id === team, me = meIsH ? g.h : g.a, them = meIsH ? g.a : g.h;
          const won = me.pts > them.pts, wk = (t.weeks || []).find((x) => x.wk === heroWeek), ow = (tm(them.id).weeks || []).find((x) => x.wk === heroWeek);
          const benchBest = (me.bench || []).filter((r) => r.slot !== 'IR').sort((a, b) => b.pts - a.pts)[0];
          const facts = [];
          facts.push(`${won ? 'Won' : 'Lost'} by ${f1(Math.abs(me.pts - them.pts))}.`);
          if (wk) facts.push(`Your best possible lineup: ${f1(wk.opt)}${wk.opt > them.pts && !won ? ' (would have won)' : ''}. ${ord(wk.rank)}-highest score of the week; ESPN projected you for ${f1(wk.proj)}.`);
          if (ow) facts.push(`${tm(them.id).owner}'s best possible: ${f1(ow.opt)}.`);
          if (benchBest && benchBest.pts > 0) facts.push(`Top bench score: ${benchBest.name}, ${f1(benchBest.pts)}.`);
          if (heroOpen == null) heroOpen = window.innerWidth > 700;
          const tog = el('button', { class: 'lu-toggle', type: 'button', text: heroOpen ? 'Hide lineups ▴' : 'Show both lineups ▾' });
          tog.addEventListener('click', () => { heroOpen = !heroOpen; viewWeek(t, myLive()); });
          hero.replaceChildren(el('div', { class: 'game hero-card mine past' + (heroOpen ? ' open' : '') }, heroHead,
            sideBlock(me, won, '', true), sideBlock(them, !won, '', true),
            el('div', { class: 'result ' + (won ? 'w' : 'l'), text: won ? 'WIN' : 'LOSS' }),
            el('p', { class: 'need' }, facts.join(' ')), tog,
            el('div', { class: 'lineups' }, lineupList(me, { past: true, week: heroWeek }), lineupList(them, { past: true, week: heroWeek })),
            el('p', { class: 'note legend lineups-only', text: 'Avg = points per game this season. Proj = ESPN projection that week. Green points = beat his projection.' })));
        }
      }
    } else if (live) {
      const meIsH = live.h.id === team;
      const me = meIsH ? live.h : live.a, them = meIsH ? live.a : live.h;
      const hw = Math.round(100 * (meIsH ? live.hwin : 1 - live.hwin));
      const vegasMe = vm ? (vm.h === team ? vm.hv : vm.av) : null, vegasThem = vm ? (vm.h === team ? vm.av : vm.hv) : null;
      const stakes = t.whatif && t.whatif.if_win != null ? el('div', { class: 'stakes' },
        el('div', {}, el('span', { text: 'If you win' }), el('b', { text: `${t.whatif.if_win}%` }), el('small', { text: 'to make playoffs' })),
        el('div', {}, el('span', { text: 'If you lose' }), el('b', { text: `${t.whatif.if_lose}%` }), el('small', { text: 'to make playoffs' })),
        el('div', {}, el('span', { text: 'On the line' }), el('b', { text: `${t.whatif.if_win - t.whatif.if_lose} pts` }), el('small', { text: 'of playoff odds' }))) : null;
      if (heroOpen == null) heroOpen = window.innerWidth > 700;
      const tog = el('button', { class: 'lu-toggle', type: 'button', text: heroOpen ? 'Hide lineups ▴' : 'Show both lineups ▾' });
      tog.addEventListener('click', () => { heroOpen = !heroOpen; viewWeek(t, myLive()); });
      hero.replaceChildren(el('div', { class: 'game hero-card mine' + (heroOpen ? ' open' : '') },
        heroHead,
        sideBlock(me, me.pts > them.pts, vegasMe ? `Vegas ${f1(vegasMe)}` : ''), sideBlock(them, them.pts > me.pts, vegasThem ? `Vegas ${f1(vegasThem)}` : ''),
        ...wpBar(hw, live.done), heroWeek == null || heroWeek === (LIVE && LIVE.current) ? wpChart(live.h.id + '-' + live.a.id, team) : null, needLine(me, them, true), stakes, tog,
        el('div', { class: 'lineups' }, lineupList(me), lineupList(them)),
        el('p', { class: 'note legend lineups-only', text: 'Q / D / O = questionable / doubtful / out. Avg = points per game this season. ESPN = ESPN projection. Vegas = his average × how much more or less Vegas expects his team to score than usual (green = Vegas likes him more than ESPN, red = less). vs Opp = points per game the opponent gives up to that position (all of its RBs or WRs combined), ranked 1st (stingiest) to 32nd. Green = soft matchup, red = tough.' })));
    } else if (m) {
      hero.replaceChildren(el('div', { class: 'game hero-card mine' }, heroHead, el('p', { class: 'note', text: `vs ${tm(m.h === team ? m.a : m.h).name}. Loading live lineups…` })));
    } else hero.replaceChildren();

    // moves
    const kinds = { 'Close call': 'k-close', Lineup: 'k-lineup', Pickup: 'k-urgent', Stream: 'k-stream', Waiver: 'k-waiver', Trade: 'k-trade', Injury: 'k-warn', Weather: 'k-warn', Vegas: 'k-warn' };
    $('#moves').replaceChildren(...(t.moves && t.moves.length ? t.moves : [{ kind: 'All set', title: 'No moves needed', detail: 'Your lineup is already optimal and nothing on waivers clearly beats what you have.' }]).map((mv) =>
      el('div', { class: 'move' + (mv.urgent ? ' urgent' : '') }, el('span', { class: 'kind ' + (kinds[mv.kind] || ''), text: mv.kind }), el('div', {}, el('b', { text: mv.title }), el('p', { text: mv.detail }), espnAction(mv, team)))));

    renderCompare();
  }

  // one tap from a suggestion to the right ESPN screen (ESPN has no supported way to make moves for you)
  const ESPN_BASE = 'https://fantasy.espn.com/football';
  const espnQ = (extra = {}) => new URLSearchParams({ leagueId: D.league.id || 961003394, seasonId: D.league.year, ...extra }).toString();
  const espnTeamUrl = (tid) => `${ESPN_BASE}/team?${espnQ({ teamId: tid })}`;
  function espnAction(mv, team) {
    let label = null, url = null, copy = null;
    const mine = team === ME;
    if (mv.addName && mine) { label = `Add ${mv.addName} in ESPN`; url = `${ESPN_BASE}/players/add?${espnQ()}`; copy = mv.addName; }
    else if (mv.partner != null && mine && T[mv.partner]) { label = `Propose trade to ${T[mv.partner].owner} in ESPN`; url = espnTeamUrl(mv.partner); }
    else if (mine && /^(Lineup|Close call|Injury|Weather|Vegas)$/.test(mv.kind)) { label = 'Set lineup in ESPN'; url = espnTeamUrl(team); }
    if (!url) return null;
    const a = el('a', { class: 'espn-btn', href: url, target: '_blank', rel: 'noopener' }, el('span', { text: label }), el('span', { class: 'espn-arrow', text: '↗' }));
    if (copy) {
      a.addEventListener('click', () => { try { navigator.clipboard.writeText(copy); } catch { /* no clipboard */ } });
      return el('div', { class: 'espn-act' }, a, el('small', { text: `Copies “${copy}”: paste it in ESPN’s Player Name search.` }));
    }
    return el('div', { class: 'espn-act' }, a);
  }
  function viewOutlook(t) {
    const wi = t.whatif || {};
    const fact = (h, b) => el('div', {}, el('strong', { text: h }), el('span', { text: b }));
    const path = [];
    if (t.race) path.push(fact(t.race.status === 'Clinched' ? 'Playoff spot: clinched' : t.race.status === 'Eliminated' ? 'Eliminated from the playoffs' : t.race.magic != null ? `Magic number: ${t.race.magic}` : 'Magic number: none yet',
      t.race.note));
    { const reg = D.league.reg_weeks, rows = (t.wins_dist || []).filter((d) => d.chance >= 1);
      const lo = rows.filter((d) => d.playoffs < 100), first100 = rows.find((d) => d.playoffs >= 100);
      const show = [...lo.slice(-3), ...(first100 ? [first100] : [])];
      if (show.length) path.push(fact('Playoff odds by final record', show.map((d) => `${d.wins}-${reg - d.wins} → ${d.playoffs}%`).join(' · '))); }
    if (wi.if_win != null) path.push(fact(`This week: win → ${wi.if_win}%, lose → ${wi.if_lose}%`, 'Playoff odds depending on this week\'s result.'));
    path.push(fact(`Projected: ~${f1(t.exp_wins)} wins`, `${pct(t.playoffs)} to make the playoffs, ${pct(t.bye)} for a first-round bye.`));
    path.push(fact(`Worst case: ${ord(wi.seed_worst)} place`, `Miss the playoffs ${pct(Math.round((100 - t.playoffs) * 10) / 10)} of the time; last place ${pct(t.last)}.`));
    $('#path').replaceChildren(...path);
    drawSeeds($('#c-whatif'), t);
    $('#seed-range').textContent = wi.seed_best ? `Realistic finish: ${ord(wi.seed_best)} to ${ord(wi.seed_worst)}; most likely ${ord(wi.seed_median)}.` : '';
    table($('#t-sched'), [{ h: 'Wk', k: 'wk' }, { h: 'Opponent', k: 'opp', v: (r) => tm(r.opp).name }, { h: 'Owner', k: 'own', v: (r) => tm(r.opp).owner }, { h: 'Win', k: 'win', n: 1, bar: 1, f: (v) => v + '%' }], D.sched.filter((s2) => s2.id === team));
    renderByes(t);
    renderPoSched();
  }

  function viewSeason(t) {
    const wi = t.whatif || {};
    renderMyCard(t);
    // what-if facts
    const paRank = [...D.teams].sort((a, b) => (b.whatif?.pa_avg ?? 0) - (a.whatif?.pa_avg ?? 0)).findIndex((x) => x.id === team) + 1;
    const fact = (h, b) => el('div', {}, el('strong', { text: h }), el('span', { text: b }));
    const facts = [];
    facts.push(fact(`Perfect lineups every week: ${wi.opt_wins}-${D.league.done.length - wi.opt_wins}`, `vs your actual ${t.w}-${t.l}. ${f1(t.bench_lost)} points left on the bench (${pct(t.eff)} efficient).`));
    facts.push(fact(`Close games: ${wi.close_w}-${wi.close_l}`, 'Decided by under 10 points.'));
    facts.push(fact(`Schedule so far: ${ord(paRank)} toughest`, `Opponents have averaged ${f1(wi.pa_avg)} against you (league average ${f1(D.league.avg)}).`));
    facts.push(fact(`Boom/bust: ${wi.boom} boom, ${wi.bust} bust weeks`, `Weekly swing ±${f1(wi.sd)} pts. ${wi.vs_proj >= 0 ? 'Beating' : 'Missing'} ESPN projections by ${f1(Math.abs(wi.vs_proj))} a week.`));
    facts.push(fact(`Lucky or not: ${signed(t.luck)} wins`, `All-play record ${t.allplay_w}-${t.allplay_l} (your score vs every team, every week) says you've earned ${f1(t.exp_w)} wins.`));
    $('#whatif').replaceChildren(...facts);

    // schedule swap bars
    { const rows = Object.entries(D.swap[team] || {}).map(([o, w]) => ({ id: Number(o), w })).sort((a, b) => b.w - a.w);
      const host = $('#c-swap');
      hbars(host, rows, { label: (r) => (r.id === team ? 'Yours (actual)' : `${tm(r.id).owner}'s`), value: (r) => r.w, fmt: (v) => `${v}-${D.league.done.length - v}`, max: D.league.done.length,
        color: (r) => (r.id === team ? css('--accent') : r.w > t.w ? css('--accent-2') : css('--bar')), bold: (r) => r.id === team,
        tipHead: (r) => (r.id === team ? 'Your actual schedule' : `${tm(r.id).owner}'s schedule (${tm(r.id).name})`), tipBody: (r) => `You'd be ${r.w}-${D.league.done.length - r.w}` }); }

    drawSeason($('#c-season'), t);
    drawPos($('#c-pos'), t);
    hbars($('#c-top'), t.top_players || [], { label: (r) => `${r.name} (${r.pos})`, value: (r) => r.share, fmt: (v) => v + '%', color: () => css('--accent-2'), tipHead: (r) => r.name, tipBody: (r) => `${f1(r.pts)} started points · ${r.share}% of team scoring` });

  }

  function viewRoster(t) {
    $('#weak-pos').textContent = t.need.weak;
    table($('#t-targets'), [{ h: 'Player', k: 'name' }, { h: 'Team', k: 'from', v: (r) => tm(r.from).name }, { h: 'Owner', k: 'own', v: (r) => tm(r.from).owner }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'Season', k: 'season', n: 1, f: f1 }], t.targets);
    renderWaivers();
    renderWaiverPlan(t); renderTradeFinder(t);
  }
  // rest-of-season points per week from a team's best lineup
  const rosWk = (r) => optimalJS(r.filter((x) => x.slot !== 'IR' && x.inj !== 'OUT' && x.inj !== 'INJURY_RESERVE').map((x) => ({ pos: x.pos, v: (x.ros || 0) / Math.max(1, D.sim.games_left) })));
  const thisWk = (r) => optimalJS(r.filter((x) => x.slot !== 'IR').map((x) => ({ pos: x.pos, v: x.bye ? 0 : x.proj || 0 })));
  function renderWaiverPlan(t) {
    const host = $('#wplan'), mine = D.rosters[t.id] || [];
    const fas = Object.values(D.waivers || {}).flat().filter((f) => f.inj !== 'OUT' && f.inj !== 'INJURY_RESERVE' && (f.ros || 0) > 0);
    const base = rosWk(mine), baseWk = thisWk(mine);
    // drop candidates: bench players outside the best lineup, cheapest first
    const bench = mine.filter((x) => x.slot !== 'IR' && !x.starter).sort((a, b) => (a.ros || 0) - (b.ros || 0));
    const plans = [];
    for (const f of fas) {
      let best = null;
      const single = f.pos === 'K' || f.pos === 'D/ST'; // you only carry one: swap it for yours
      const cands = single ? mine.filter((x) => x.pos === f.pos && x.slot !== 'IR') : bench.slice(0, 6);
      for (const d of (cands.length ? cands : bench.slice(0, 6))) {
        const after = mine.filter((x) => x.pid !== d.pid).concat({ ...f, slot: 'Bench', starter: false });
        const g = rosWk(after) - base, gw = thisWk(after) - baseWk;
        if (!best || g + gw * 0.3 > best.g + best.gw * 0.3) best = { f, d, g, gw };
      }
      if (best && (best.g > 0.4 || best.gw > 2)) plans.push(best);
    }
    plans.sort((a, b) => b.g + b.gw * 0.3 - (a.g + a.gw * 0.3));
    const top = []; const usedDrop = new Set();
    for (const p of plans) { if (usedDrop.has(p.d.pid)) continue; usedDrop.add(p.d.pid); top.push(p); if (top.length === 5) break; }
    if (!top.length) { host.replaceChildren(el('p', { class: 'note', text: 'No free agent clearly beats anyone on your bench right now.' })); return; }
    host.replaceChildren(el('ol', { class: 'wp-list' }, ...top.map((p, i) => el('li', {},
      el('div', {}, el('b', { text: `Add ${p.f.name}` }), el('span', { class: 'muted', text: ` (${p.f.pos}, ${p.f.team}${p.f.status === 'WAIVERS' ? ', waivers' : ', free agent'}) · drop ${p.d.name}` })),
      el('div', { class: 'wp-g' }, el('span', { class: p.g > 0 ? 'good' : '', text: `${p.g >= 0 ? '+' : ''}${f1(p.g)} pts/week rest of season` }), el('span', { class: p.gw > 0 ? 'good' : p.gw < 0 ? 'bad' : 'muted', text: p.f.bye ? 'on bye this week' : `${p.gw >= 0 ? '+' : ''}${f1(p.gw)} this week` }), el('span', { class: 'muted', text: `${p.f.owned}% rostered` })),
      t.id === ME && i === 0 ? espnAction({ addName: p.f.name }, t.id) : null))));
  }
  let tfCache = { key: '', out: null };
  function renderTradeFinder(t) {
    const host = $('#tfind');
    const key = `${t.id}:${D.updated}`;
    if (tfCache.key === key && tfCache.out) { host.replaceChildren(tfCache.out); return; }
    host.replaceChildren(el('p', { class: 'note', text: 'Searching every trade in the league…' }));
    setTimeout(() => {
      const ros = (id) => (D.rosters[id] || []).filter((x) => x.slot !== 'IR');
      const mine = ros(t.id), myBase = rosWk(mine);
      const deals = [];
      for (const o of D.teams) {
        if (o.id === t.id) continue;
        const theirs = ros(o.id), theirBase = rosWk(theirs);
        for (const a of mine) for (const b of theirs) {
          if (!a.ros || !b.ros || a.ros > b.ros * 1.6 || b.ros > a.ros * 1.6) continue; // keep it believable
          const me2 = mine.filter((x) => x.pid !== a.pid).concat({ ...b, slot: 'Bench' }), them2 = theirs.filter((x) => x.pid !== b.pid).concat({ ...a, slot: 'Bench' });
          const gm = rosWk(me2) - myBase, gt = rosWk(them2) - theirBase;
          if (gm > 0.3 && gt > 0.3) deals.push({ o: o.id, a, b, gm, gt, score: Math.min(gm, gt) + 0.15 * (gm + gt) });
        }
      }
      deals.sort((x, y) => y.score - x.score);
      const top = []; const per = {};
      for (const d of deals) { if ((per[d.o] || 0) >= 2) continue; per[d.o] = (per[d.o] || 0) + 1; top.push(d); if (top.length === 4) break; }
      if (!top.length) { tfCache = { key, out: el('p', { class: 'note', text: 'No trade right now makes both teams better. Check back after this week’s injuries.' }) }; host.replaceChildren(tfCache.out); return; }
      const before = seasonSim((id) => D.rosters[id] || [], 2500);
      const list = el('div', { class: 'tf-list' }, ...top.map((d) => {
        const after = seasonSim((id) => { const r = D.rosters[id] || []; if (id === t.id) return r.filter((x) => x.pid !== d.a.pid).concat({ ...d.b, slot: 'Bench' }); if (id === d.o) return r.filter((x) => x.pid !== d.b.pid).concat({ ...d.a, slot: 'Bench' }); return r; }, 2500);
        const pm = after[t.id].po - before[t.id].po, pt = after[d.o].po - before[d.o].po;
        const open = el('button', { class: 'linkbtn', type: 'button', text: 'Open in trade analyzer' });
        open.addEventListener('click', () => { taA = t.id; taB = d.o; taSel.a = new Set([d.a.pid]); taSel.b = new Set([d.b.pid]); leagueView = 'moves'; store.set('lview', 'moves'); show('league'); setTimeout(() => { const c = $('#ta-out'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300); });
        return el('div', { class: 'tf-deal' },
          el('div', {}, el('b', { text: `Offer ${d.a.name} (${d.a.pos}) to ${tm(d.o).owner} for ${d.b.name} (${d.b.pos})` })),
          el('div', { class: 'wp-g' }, el('span', { class: 'good', text: `You: +${f1(d.gm)} pts/wk, ${pm >= 0 ? '+' : ''}${f1(pm)}% playoffs` }), el('span', { class: 'muted', text: `${tm(d.o).owner}: +${f1(d.gt)} pts/wk, ${pt >= 0 ? '+' : ''}${f1(pt)}% playoffs` })),
          el('div', { class: 'tf-acts' }, open, t.id === ME ? espnAction({ partner: d.o, kind: 'Trade' }, t.id) : null));
      }));
      tfCache = { key, out: list };
      if (team === t.id && teamView === 'roster') host.replaceChildren(list);
    }, 30);
  }

  function renderByes(t) {
    const host = $('#t-byes'), cur = D.league.week, last = D.league.reg_weeks;
    const roster = (D.rosters[team] || []).filter((r) => r.slot !== 'IR');
    const weeks = d3.range(cur, last + 1);
    const out = {};
    for (const w of weeks) out[w] = roster.filter((r) => r.starter && r.bye_wk === w);
    const row = (r) => el('tr', { class: r.starter ? '' : 'bench' },
      el('td', { class: 'pn' }, r.starter ? el('span', { class: 'muted', text: r.slot + ' ' }) : null, r.name),
      el('td', { class: 'n', text: r.bye_wk ? (r.bye_wk < cur ? `${r.bye_wk} ✓` : String(r.bye_wk)) : '–' }),
      ...weeks.map((w) => el('td', { class: 'bw' + (r.bye_wk === w ? ' on' : '') + (w === cur ? ' now' : '') }, r.bye_wk === w ? 'BYE' : '')));
    const starters = roster.filter((r) => r.starter), bench = roster.filter((r) => !r.starter);
    host.replaceChildren(el('table', { class: 'byes' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Player' }), el('th', { class: 'n', text: 'Bye' }), ...weeks.map((w) => el('th', { class: 'bw' + (w === cur ? ' now' : ''), text: String(w) })))),
      el('tbody', {}, ...starters.map(row),
        el('tr', { class: 'sep' }, el('td', { colspan: weeks.length + 2, text: 'Bench' })),
        ...bench.map(row),
        el('tr', { class: 'tot' }, el('td', { text: 'Starters on bye' }), el('td'), ...weeks.map((w) => el('td', { class: 'bw' + (out[w].length >= 2 ? ' hot' : out[w].length ? ' warm' : ''), text: out[w].length || '' }))))));
    const crunch = weeks.filter((w) => out[w].length).sort((a, b) => out[b].length - out[a].length || a - b)[0];
    $('#bye-note').textContent = crunch
      ? `Toughest week: Week ${crunch}, with ${out[crunch].length} starter${out[crunch].length > 1 ? 's' : ''} out (${out[crunch].map((r) => r.name).join(', ')}). ✓ = bye already done.`
      : 'None of your starters have a bye left. ✓ = bye already done.';
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
    table($('#t-waivers'), [{ h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'NFL', k: 'team' }, { h: 'Bye', k: 'bye_wk', n: 1, f: (v) => v || '–' }, { h: 'ROS', k: 'ros', n: 1 }, { h: 'ESPN', k: 'proj', n: 1, f: (v, r) => (r.bye ? 'BYE' : f1(v)), cls: (r) => (r.bye ? 'bad' : '') }, { h: 'Vegas', k: 'vg', n: 1, v: (r) => (r.bye ? -1 : (D.vproj || {})[r.id] ?? null), f: (v, r) => (r.bye ? 'BYE' : v == null ? '–' : f1(v)), cls: (r) => { const v = (D.vproj || {})[r.id]; return r.bye ? 'bad' : v != null && v - r.proj >= 2 ? 'good' : ''; } }, { h: 'Rostered', k: 'owned', n: 1, f: (v) => v + '%' }, { h: '', k: 'status', f: (v) => (v === 'WAIVERS' ? 'Waivers' : 'FA') }], rows, { stick: true });
  }

  // ---------- THIS WEEK ----------
  let tpWeek = null;
  const pcls = (pos) => 'pc pc-' + String(pos).replace('/', '');
  function renderTop() {
    if (!LIVE) { $('#tp-pos').replaceChildren(el('p', { class: 'note', text: 'Loading this week…' })); return; } // re-rendered when live scores arrive
    const cur = LIVE.week;
    const curHasPts = LIVE.games.some((g) => g.h.pts > 0 || g.a.pts > 0);
    if (tpWeek == null) tpWeek = curHasPts ? cur : Math.max(1, cur - 1); // before kickoff, show last week
    const sel = $('#tp-week');
    sel.replaceChildren(...d3.range(cur, 0, -1).map((w) => el('option', { value: w, text: w === cur ? `Week ${w}${LIVE && LIVE.anyLive ? ' (live)' : ''}` : `Week ${w}` })));
    sel.value = tpWeek;
    sel.onchange = () => { tpWeek = Number(sel.value); renderTop(); };
    const data = tpWeek === cur ? LIVE : weekCache[tpWeek];
    if (!data) {
      $('#tp-pos').replaceChildren(el('p', { class: 'note', text: `Loading week ${tpWeek}…` }));
      if (tpWeek !== cur) getJSON(`/api/live?week=${tpWeek}`).then((j) => { weekCache[j.week] = j; if (tab === 'week') renderTop(); }).catch(() => {});
      return;
    }
    // every starter that week, with the manager who started him
    const all = [];
    for (const g of data.games) for (const sd of [g.h, g.a]) for (const r of sd.rows) all.push({ ...r, tid: sd.id });
    const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'];
    const played = (r) => r.state !== 'pre' && r.state !== 'bye';
    $('#tp-pos').replaceChildren(...POS.map((pos) => {
      const top = all.filter((r) => r.pos === pos && played(r)).sort((a, b) => b.pts - a.pts).slice(0, 3);
      return el('div', { class: 'tp-col' }, el('div', { class: pcls(pos) + ' big', text: pos }),
        ...(top.length ? top.map((r, i) => el('div', { class: 'tp-row' + (r.tid === team ? ' me' : '') },
          el('span', { class: 'tp-rk', text: String(i + 1) }),
          el('span', { class: 'tp-nm' }, el('b', { text: r.name }), el('small', { text: `${tm(r.tid).owner} · ${r.nfl}` })),
          el('span', { class: 'tp-pts', text: f1(r.pts) }))) : [el('p', { class: 'note', text: 'No games yet' })]));
    }));
    // (each matchup's standouts now live in the scoreboard above)
  }
  function renderWeek() {
    renderScores();
    renderTop();
    $$('.recap-wk').forEach((n) => { n.textContent = D.recap ? D.recap.week : '–'; });
    $('#recap').textContent = D.recap ? D.recap.text : 'The recap appears after the first week is played.';
    $('#aw-week').textContent = D.awards_week ?? '–';
    $('#awards').replaceChildren(...(D.awards || []).map((a) => el('div', { class: 'award' + (a.id === team ? ' mine' : '') }, el('span', { class: 'aw', text: a.award }), el('b', { text: tm(a.id).name }), el('span', { class: 'note', text: a.detail }))));
    const vm = D.vegas_matchups || [];
    const byM = Object.fromEntries(D.matchups.map((m) => [m.h + '-' + m.a, m]));
    table($('#t-vm'), [
      { h: 'Matchup', k: 'm', v: (r) => `${tm(r.h).owner} vs ${tm(r.a).owner}` },
      { h: 'ESPN proj', k: 'e', v: (r) => { const m = byM[r.h + '-' + r.a]; return m ? `${f1(m.hp)}–${f1(m.ap)}` : '–'; } },
      { h: 'Vegas proj', k: 'v', v: (r) => `${f1(r.hv)}–${f1(r.av)}` },
      { h: 'Odds (ESPN)', k: 'oe', n: 1, v: (r) => { const m = byM[r.h + '-' + r.a]; return m ? Math.round(m.hwin * 100) : null; }, f: (v) => (v == null ? '–' : `${v}–${100 - v}`) },
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
    renderRace();
    renderCards();
    table($('#t-power'), [
      { h: '#', k: 'power', n: 1 }, { h: 'Team', k: 'name' }, { h: 'Owner', k: 'owner', wide: 1 }, { h: 'Rec', k: 'w', f: (_, r) => `${r.w}-${r.l}` },
      { h: 'PF', k: 'pf', n: 1, f: f1, wide: 1 }, { h: 'All-play', k: 'allplay_w', f: (_, r) => `${r.allplay_w}-${r.allplay_l}`, wide: 1 },
      { h: 'Luck', k: 'luck', n: 1, f: signed, cls: (r) => (r.luck > 0 ? 'good' : r.luck < 0 ? 'bad' : ''), wide: 1 },
      { h: 'Roster/wk', k: 'ros', n: 1, f: f1, wide: 1 }, { h: 'Playoffs', k: 'playoffs', n: 1, bar: 1, f: pct }, { h: 'Bye', k: 'bye', n: 1, f: pct, wide: 1 }], D.teams, { isMe: meRow });
    const ordered = [...D.teams].sort((a, b) => b.playoffs - a.playoffs);
    if ($('#c-odds')) { const host = $('#c-odds'), w = W(host), rowH = 24, svg = svgIn(host, w, 10);
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
    renderAnalyzer();
    const host = $('#tradelist');
    if (!D.trades.length) host.replaceChildren(el('p', { class: 'note', text: 'No trades yet this season.' }));
    else host.replaceChildren(...D.trades.map((t) => {
      const side = (s) => el('div', {}, el('div', { class: 'tm', text: tm(s.id).name }), el('div', { text: 'Got ' + (s.gets.map((g) => g.name).join(', ') || 'nothing') }),
        el('div', { class: 'note', text: `${f1(s.pts)} started pts since · ${s.ros} ROS proj` }), t.winner === s.id ? el('div', { class: 'win', text: 'Winning so far' }) : null);
      return el('div', { class: 'trade' + (team && (t.a.id === team || t.b.id === team) ? ' me' : '') }, el('div', { class: 'h', text: `Week ${t.wk}${t.winner == null ? ' · even so far' : ''}` }), side(t.a), side(t.b));
    }));
    table($('#t-pickups'), [{ h: 'Player', k: 'name', cls: () => 'clip' }, { h: 'Pos', k: 'pos', wide: 1 }, { h: 'Added by', k: 'id', v: (r) => tm(r.id).owner }, { h: 'Wk', k: 'wk', n: 1, wide: 1 }, { h: 'Pts', k: 'pts', n: 1, f: f1 }, { h: 'ROS', k: 'ros', n: 1, wide: 1 }], D.pickups.slice(0, 15), { isMe: meRow });
    table($('#t-mypickups'), [{ h: 'Player', k: 'name' }, { h: 'Pos', k: 'pos' }, { h: 'Wk', k: 'wk', n: 1 }, { h: 'Started pts', k: 'pts', n: 1, f: f1 }, { h: 'ROS', k: 'ros', n: 1 }], team ? D.pickups.filter((p) => p.id === team) : []);
  }
  function renderDraft() {
    const haul = D.teams.map((t) => ({ id: t.id, name: t.name, pts: d3.sum(D.draft.filter((d) => d.id === t.id), (d) => d.season) })).sort((a, b) => b.pts - a.pts);
    hbars($('#c-haul'), haul, { label: (r) => r.name, value: (r) => r.pts, fmt: (v) => d3.format(',.0f')(v), color: (r) => (r.id === team ? css('--accent') : css('--bar')), bold: (r) => r.id === team, tipHead: (r) => r.name, tipBody: (r) => `${f1(r.pts)} season pts from drafted players` });
    const dcols = [{ h: 'Pick', k: 'pick', n: 1, wide: 1 }, { h: 'Player', k: 'name', cls: () => 'clip' }, { h: 'Team', k: 'id', v: (r) => tm(r.id).owner }, { h: 'Drafted', k: 'pos_pick', f: (_, r) => r.pos + r.pos_pick }, { h: 'Now', k: 'pos_finish', f: (_, r) => (r.pos_finish ? r.pos + r.pos_finish : '–') }, { h: 'Pts', k: 'season', n: 1, f: f1, wide: 1 }];
    const graded = D.draft.filter((d) => d.swing != null);
    table($('#t-steals'), dcols, [...graded].sort((a, b) => b.swing - a.swing).slice(0, 10), { isMe: meRow });
    table($('#t-busts'), dcols, graded.filter((d) => d.rd <= 6).sort((a, b) => a.swing - b.swing).slice(0, 10), { isMe: meRow });
    table($('#t-mydraft'), [dcols[0], dcols[1], dcols[3], dcols[4], dcols[5]], team ? D.draft.filter((d) => d.id === team) : []);
  }

  // ---------- HISTORY ----------
  // ---------- Trophy case: champions, photos, last place and the punishment ----------
  let TROPHY = null, trophyAt = 0, trophyEdit = null;
  async function loadTrophies(force) {
    if (!force && TROPHY && Date.now() - trophyAt < 60000) return;
    trophyAt = Date.now();
    try { TROPHY = (await getJSON('/api/club?k=trophy')).items || {}; } catch { TROPHY = TROPHY || {}; }
    if (tab === 'league' && leagueView === 'history') renderTrophies();
  }
  function shrinkPhoto(file) { // resize on the phone so uploads stay small
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 1100 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); let q = 0.82, d = c.toDataURL('image/jpeg', q); while (d.length > 850000 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); } resolve(d); };
      img.onerror = () => reject(new Error('Couldn’t read that image')); img.src = url;
    });
  }
  async function saveTrophy(year, body) {
    const r = await fetch('/api/club', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 'trophy', year, token: pinTok(ADMIN), ...body }) });
    const j = await r.json().catch(() => ({})); if (pinFail(j)) return; if (!r.ok) throw new Error(j.error || 'Didn’t save');
    TROPHY = j.items || TROPHY;
  }
  function renderTrophies() {
    const host = $('#champs');
    if (!TROPHY) { host.replaceChildren(el('p', { class: 'note', text: 'Loading the trophy case…' })); loadTrophies(); return; }
    const isAdmin = ME === ADMIN && pinTok();
    const years = [...new Set([D.league.year, ...D.champs.map((c) => c.year)])].sort((a, b) => b - a);
    host.replaceChildren(...years.map((y) => {
      const c = D.champs.find((x) => x.year === y), it = TROPHY[y] || {};
      const leader = !c ? [...D.teams].sort((a, b) => b.playoffs - a.playoffs)[0] : null;
      const card = el('div', { class: 'trophy' + (it.photo ? ' has-photo' : '') },
        it.photo ? el('img', { class: 'tr-photo', src: it.photo, alt: `${y} champion photo`, loading: 'lazy' }) : null,
        el('div', { class: 'tr-body' },
          el('div', { class: 'yr', text: `${y}` }),
          c ? el('div', { class: 'who', text: `🏆 ${c.owner} · ${c.team}` }) : el('div', { class: 'who muted', text: `Season in progress · favorite right now: ${leader ? leader.owner : '–'}` }),
          c ? el('div', { class: 'how', text: `${c.record}${c.seed ? ', ' + ord(c.seed) + ' seed' : ''} · beat ${c.runner_up} ${c.final}` }) : null,
          it.caption ? el('p', { class: 'tr-cap', text: it.caption }) : null,
          it.last ? el('div', { class: 'tr-last' }, el('b', { text: `🚽 Last place: ${it.last}` }), it.punishment ? el('span', { text: ` · Punishment: ${it.punishment}` }) : null) : null));
      if (isAdmin) {
        if (trophyEdit === y) {
          const cap = el('input', { class: 'tk-gif', placeholder: 'Caption (optional)', value: it.caption || '' });
          const last = el('input', { class: 'tk-gif', placeholder: 'Last place (name)', value: it.last || '' });
          const pun = el('input', { class: 'tk-gif', placeholder: 'Punishment', value: it.punishment || '' });
          const file = el('input', { type: 'file', accept: 'image/*', class: 'tr-file' });
          const msg = el('p', { class: 'note' });
          const save = el('button', { class: 'btn', type: 'button', text: 'Save' });
          save.addEventListener('click', async () => {
            save.disabled = true; msg.textContent = 'Saving…';
            try {
              const body = { caption: cap.value, last: last.value, punishment: pun.value };
              if (file.files && file.files[0]) body.photo = await shrinkPhoto(file.files[0]);
              await saveTrophy(y, body); trophyEdit = null; renderTrophies();
            } catch (e) { msg.textContent = e.message; save.disabled = false; }
          });
          const rm = it.photo ? el('button', { class: 'linkbtn', type: 'button', text: 'Remove photo' }) : null;
          if (rm) rm.addEventListener('click', async () => { try { await saveTrophy(y, { photo: '' }); renderTrophies(); } catch (e) { msg.textContent = e.message; } });
          const cancel = el('button', { class: 'linkbtn', type: 'button', text: 'Cancel' }); cancel.addEventListener('click', () => { trophyEdit = null; renderTrophies(); });
          card.append(el('div', { class: 'tr-edit' }, el('label', { class: 'note', text: 'Photo' }), file, cap, last, pun, el('div', { class: 'tk-row' }, save, cancel, rm), msg));
        } else {
          const ed = el('button', { class: 'linkbtn tr-edbtn', type: 'button', text: it.photo || it.last ? 'Edit' : 'Add photo / last place' });
          ed.addEventListener('click', () => { trophyEdit = y; renderTrophies(); });
          card.append(ed);
        }
      }
      return card;
    }));
  }
  function renderHistory() {
    const H = D.history;
    renderTrophies();
    const myOwner = team ? tm(team).owner : null;
    table($('#t-career'), [{ h: '#', k: 'rank', n: 1 }, { h: 'Owner', k: 'owner' }, { h: 'Legacy', k: 'legacy', n: 1, f: f1 }, { h: 'Titles', k: 'titles', n: 1 }, { h: 'Finals', k: 'finals', n: 1, wide: 1 }, { h: 'Playoffs', k: 'playoffs', n: 1, wide: 1 }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'All-play', k: 'allplay', n: 1, f: pct, wide: 1 }, { h: 'Avg finish', k: 'avg_finish', n: 1, f: (v) => (v ? f1(v) : '–'), wide: 1 }], H.career, { isMe: (r) => r.owner === myOwner });
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
    table($('#t-seasons'), [{ h: 'Finish', k: 'final', n: 1, f: (v, r) => (v ? ord(v) : r.complete ? '–' : 'TBD') }, { h: 'Owner', k: 'owner' }, { h: 'Team', k: 'team', wide: 1 }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'PF/g', k: 'ppg', n: 1, f: f1 }, { h: 'All-play', k: 'allplay', n: 1, f: pct, wide: 1 }, { h: 'Seed', k: 'seed', n: 1, wide: 1 }], sRows, { isMe: (r) => r.owner === myOwner });
    table($('#t-bestseasons'), [{ h: 'Season', k: 'year' }, { h: 'Owner', k: 'owner' }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'All-play', k: 'allplay', n: 1, f: pct }, { h: 'PF/g', k: 'ppg', n: 1, f: f1, wide: 1 }, { h: 'Finish', k: 'final', n: 1, f: (v, r) => (v ? ord(v) : r.complete ? '–' : 'in progress') }], H.best_seasons, { isMe: (r) => r.owner === myOwner });
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
    table($('#t-records'), [{ h: 'Record', k: 'kind' }, { h: 'Owner', k: 'owner' }, { h: 'Season', k: 'season' }, { h: 'Wk', k: 'wk', n: 1, wide: 1 }, { h: 'Pts', k: 'pts', n: 1, f: f1 }, { h: 'Opp', k: 'opp', wide: 1 }, { h: 'Margin', k: 'margin', n: 1, f: signed, wide: 1 }], D.records);
    table($('#t-alltime'), [{ h: 'Owner', k: 'owner' }, { h: 'Record', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'Win %', k: 'pct', n: 1, f: pct }, { h: 'Titles', k: 't', n: 1, v: (r) => r.titles.length }, { h: 'Pts/g', k: 'ppg', n: 1, f: f1, wide: 1 }, { h: 'Best game', k: 'high', n: 1, f: f1, wide: 1 }, { h: 'Best finish', k: 'best', n: 1, f: (v) => (v ? ord(v) : '–'), wide: 1 }], D.alltime, { isMe: meRow });
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


  // ---------- start/sit comparer ----------
  let cmpA = null, cmpB = null, cmpTeam = null;
  function playerIndex() {
    const out = new Map();
    for (const t of D.teams) for (const r of D.rosters[t.id] || []) out.set(String(r.pid), { ...r, owner: t.owner, tid: t.id });
    for (const lst of Object.values(D.waivers)) for (const f of lst) if (!out.has(String(f.id))) out.set(String(f.id), { ...f, pid: f.id, nfl: f.team, owner: f.status === 'WAIVERS' ? 'Waivers' : 'Free agent', tid: null, avg: (D.pavg || {})[f.id] ?? null });
    return out;
  }
  function renderCompare() {
    const idx = playerIndex(), mine = (D.rosters[team] || []).filter((r) => r.slot !== 'IR');
    const mv = (myTeam().moves || []).find((m) => m.kind === 'Lineup');
    const byName = (n) => mine.find((r) => r.name === n);
    if (!cmpA || !idx.has(cmpA) || !cmpB || !idx.has(cmpB) || cmpTeam !== team) {
      let a, b;
      if (mv) { const [x, y] = mv.title.replace('Start ', '').split(' over '); a = byName(x); b = byName(y); }
      if (!a || !b) { // closest call between a starter and a bench player at the same position
        let best = null;
        for (const s of mine.filter((r) => r.starter && r.pos !== 'D/ST' && r.pos !== 'K')) for (const bn of mine.filter((r) => !r.starter && r.pos === s.pos && !r.bye)) {
          const d = Math.abs(s.proj - bn.proj); if (!best || d < best.d) best = { d, a: s, b: bn };
        }
        if (best) { a = best.a; b = best.b; } else { a = mine[0]; b = mine[1]; }
      }
      cmpA = String(a.pid); cmpB = String(b.pid); cmpTeam = team;
    }
    const opts = (sel, val) => {
      const groups = [['Your roster', mine.map((r) => idx.get(String(r.pid)))],
        ['Rest of the league', [...idx.values()].filter((p) => p.tid != null && p.tid !== team).sort((x, y) => x.name.localeCompare(y.name))],
        ['Free agents & waivers', [...idx.values()].filter((p) => p.tid == null).sort((x, y) => x.name.localeCompare(y.name))]];
      sel.replaceChildren(...groups.map(([lab, ps]) => el('optgroup', { label: lab }, ...ps.map((p) => el('option', { value: p.pid, text: `${p.name} (${p.pos}, ${p.nfl})${p.tid != null && p.tid !== team ? ' · ' + p.owner : ''}` })))));
      sel.value = val;
    };
    const A = $('#cmp-a'), B = $('#cmp-b');
    opts(A, cmpA); opts(B, cmpB);
    A.onchange = () => { cmpA = A.value; drawCompare(); };
    B.onchange = () => { cmpB = B.value; drawCompare(); };
    drawCompare();
  }
  function drawCompare() {
    const idx = playerIndex(), by = nflByAbbr();
    const P = [idx.get(String(cmpA)), idx.get(String(cmpB))];
    if (!P[0] || !P[1]) return;
    const info = P.map((p) => {
      const x = by[p.nfl], v = (D.vproj || {})[p.pid] ?? null;
      const tbl = D.oprk && D.oprk[POSID[p.pos]], o = x && tbl ? tbl[x.themId] : null;
      const total = x ? (p.pos === 'D/ST' ? x.them.implied : x.me.implied) : null;
      const blend = p.bye || !x ? 0 : v != null && p.proj > 0 ? (p.proj + v) / 2 : p.proj;
      return { p, x, v, o, total, blend };
    });
    const better = (i, fn, hiGood = true) => { const a = fn(info[0]), b = fn(info[1]); if (a == null || b == null || a === b) return ''; return (hiGood ? a > b : a < b) === (i === 0) ? 'win' : ''; };
    const rows = [
      ['Game', (q) => (q.x ? `${q.x.home ? 'vs' : '@'} ${q.x.them.abbr} · ${kick(q.x.g.kickoff)}` : 'BYE'), null],
      ['ESPN projection', (q) => (q.x ? f1(q.p.proj) : '0.0'), (q) => (q.x ? q.p.proj : 0)],
      ['Vegas projection', (q) => (q.v != null ? f1(q.v) : '–'), (q) => q.v],
      ['Season average', (q) => (q.p.avg != null ? f1(q.p.avg) : '–'), (q) => q.p.avg],
      ['Opponent gives up', (q) => (q.o ? `${f1(q.o[0])} to ${q.p.pos}s (${ord(q.o[1])})` : '–'), (q) => (q.o ? q.o[1] : null)],
      [info.some((q) => q.p.pos === 'D/ST') ? 'Team total (D/ST: opp)' : 'Team total', (q) => (q.total != null ? f1(q.total) : '–'), (q) => (q.total == null ? null : q.p.pos === 'D/ST' ? -q.total : q.total)],
      ['Weather', (q) => (q.x ? wxShort(q.x.g) : '–'), null],
      ['Injury', (q) => ({ QUESTIONABLE: 'Questionable', Q: 'Questionable', DOUBTFUL: 'Doubtful', D: 'Doubtful', OUT: 'Out', O: 'Out', IR: 'IR' }[q.p.inj] || 'Healthy'), null],
      ['Playoff schedule (wk 15–17)', (q) => (q.p.po ? q.p.po.map((w) => w.opp.replace(' ', '')).join(', ') + (q.p.po_avg ? ` · avg ${ord(Math.round(q.p.po_avg))}` : '') : '–'), (q) => q.p.po_avg],
      ['Rest of season', (q) => (q.p.ros != null ? `${Math.round(q.p.ros)} pts` : '–'), (q) => q.p.ros],
      ['On', (q) => (q.p.tid === team ? 'Your team' : q.p.owner), null],
    ];
    const [a, b] = info, diff = a.blend - b.blend, pick = Math.abs(diff) < 0.75 ? null : diff > 0 ? a : b;
    const verdict = pick ? `Start ${pick.p.name}: about ${f1(Math.abs(diff))} more points using ESPN and Vegas together.` : 'Coin flip. Go with the better matchup or your gut.';
    $('#cmp').replaceChildren(el('div', { class: 'cmp-verdict' + (pick ? '' : ' flip'), text: verdict }),
      el('table', { class: 'cmp' }, el('thead', {}, el('tr', {}, el('th'), el('th', { text: a.p.name }), el('th', { text: b.p.name }))),
        el('tbody', {}, ...rows.map(([lab, fmt, val]) => el('tr', {}, el('td', { class: 'muted', text: lab }),
          ...[0, 1].map((i) => el('td', { class: val ? better(i, val) : '', text: fmt(info[i]) })))))));
  }
  const myTeam = () => D.teams.find((x) => x.id === team) || {};

  // ---------- report cards ----------
  const gcls = (g) => (g && g[0] === 'A' ? 'ga' : g && g[0] === 'B' ? 'gb' : g && g[0] === 'C' ? 'gc' : g && (g[0] === 'D' || g[0] === 'F') ? 'gf' : '');
  function renderMyCard(t) {
    const c = t.card; if (!c) return;
    $('#card-note').textContent = `GPA ${c.gpa.toFixed(2)}, ${ord(c.rank)} of ${D.teams.length}. Graded on a curve against the rest of the league.`;
    $('#mycard').replaceChildren(...[['Draft', c.draft], ['Waivers', c.wire], ['Lineups', c.lineup], ['Trades', c.trades]].map(([lab, g]) =>
      el('div', { class: 'gr' }, el('span', { class: 'gl ' + gcls(g.g), text: g.g }), el('div', {}, el('b', { text: lab }), el('small', { text: g.detail })))));
  }
  function renderCards() {
    const g = (k) => ({ h: k, k, v: (r) => (r[k].gp ?? -1), node: (r) => el('span', { class: 'gl sm ' + gcls(r[k].g), text: r[k].g, title: r[k].detail }) });
    table($('#t-cards'), [{ h: '#', k: 'rank', n: 1, wide: 1 }, { h: 'Team', k: 'id', v: (r) => tm(r.id).name, cls: () => 'clip' }, { h: 'Owner', k: 'o', v: (r) => tm(r.id).owner, wide: 1 },
      { h: 'GPA', k: 'gpa', n: 1, f: (v) => v.toFixed(2) }, { ...g('draft'), h: 'Draft' }, { ...g('wire'), h: 'Waivers' }, { ...g('lineup'), h: 'Lineups' }, { ...g('trades'), h: 'Trades', wide: 1 }], D.cards || [], { isMe: meRow });
    $$('#t-cards .gl').forEach((n) => n.addEventListener('click', (e) => { const r = n.getBoundingClientRect(); tip.show({ clientX: r.left, clientY: r.top }, n.textContent, n.title); e.stopPropagation(); }));
  }

  // ---------- playoff race ----------
  function renderRace() {
    table($('#t-race'), [{ h: 'Team', k: 'id', v: (r) => tm(r.id).name }, { h: 'Rec', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'Odds', k: 'playoffs', n: 1, bar: 1, f: pct },
      { h: 'Status', k: 'status', cls: (r) => (r.status === 'Clinched' ? 'good' : r.status === 'Eliminated' || r.status === 'Long shot' ? 'bad' : '') },
      { h: 'Magic #', k: 'magic', n: 1, wide: 1, f: (v, r) => (r.status === 'Clinched' ? '✓' : v == null ? '–' : `${v} of ${r.left}`) },
      { h: '50/50 at', k: 'need50', f: (v) => v || '–', wide: 1 }, { h: 'Safe (90%) at', k: 'need90', f: (v) => v || '–', wide: 1 },
      { h: '', k: 'note', cls: () => 'muted', wide: 1 }], D.race || [], { isMe: meRow });
  }

  // ---------- fantasy playoff schedule ----------
  function renderPoSched() {
    $$('.po-wks').forEach((n) => { n.textContent = (D.po_weeks || [15, 16, 17]).join('–').replace(/–\d+–/, '–'); });
    const rows = (D.rosters[team] || []).filter((r) => r.slot !== 'IR');
    const cell = (wk) => ({ h: 'Wk ' + wk, k: 'w' + wk, v: (r) => { const w = (r.po || []).find((x) => x.wk === wk); return w ? w.rank ?? 99 : 99; },
      node: (r) => { const w = (r.po || []).find((x) => x.wk === wk); if (!w) return el('span', { text: '–' }); if (w.opp === 'BYE') return el('span', { class: 'badt', text: 'BYE' });
        return el('span', { class: 'pos ' + (w.rank >= 25 ? 'easy' : w.rank <= 8 ? 'hard' : '') }, el('span', { text: w.opp }), w.rank ? el('small', { text: ' ' + ord(w.rank) }) : null); } });
    const wks = D.po_weeks || [15, 16, 17];
    table($('#t-posched'), [{ h: 'Player', k: 'name', f: (v, r) => (r.starter ? v : v) }, { h: 'Pos', k: 'pos' }, ...wks.map(cell),
      { h: 'Avg rank', k: 'po_avg', n: 1, f: (v) => (v == null ? '–' : ord(Math.round(v))), cls: (r) => (r.po_avg >= 22 ? 'good' : r.po_avg != null && r.po_avg <= 11 ? 'bad' : '') }], rows, { stick: true });
  }

  // ---------- trade analyzer ----------
  let taA = null, taB = null; const taSel = { a: new Set(), b: new Set() };
  function optimalJS(ents) { // ents: [{pos, v}] -> best QB,RB2,WR2,TE,FLEX,DST,K total
    const by = {}; for (const e of ents) (by[e.pos] ||= []).push(e.v);
    for (const k in by) by[k].sort((a, b) => b - a);
    let tot = 0; const take = (p, n) => { const got = (by[p] || []).splice(0, n); tot += got.reduce((s, v) => s + v, 0); };
    take('QB', 1); take('RB', 2); take('WR', 2); take('TE', 1);
    tot += Math.max(0, ...['RB', 'WR', 'TE'].map((p) => (by[p] || [])[0] || 0));
    take('D/ST', 1); take('K', 1); return tot;
  }
  function seasonSim(rosterOf, N = 6000, withTitle = false) {
    const S = D.sim, ids = D.teams.map((t) => t.id);
    const ros = {}, wk = {};
    for (const t of ids) { const r = rosterOf(t).filter((x) => x.slot !== 'IR');
      ros[t] = optimalJS(r.map((x) => ({ pos: x.pos, v: (x.ros || 0) / S.games_left })));
      wk[t] = optimalJS(r.map((x) => ({ pos: x.pos, v: x.bye ? 0 : x.proj || 0 }))); }
    const str = {}; for (const t of ids) str[t] = 0.6 * ros[t] + 0.4 * S.recent[t];
    const adj = S.avg - ids.reduce((s, t) => s + str[t], 0) / ids.length; for (const t of ids) str[t] += adj;
    let seed = 961003394; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const po = Object.fromEntries(ids.map((t) => [t, 0])), byes = { ...po }, fin = { ...po }, ttl = { ...po };
    const play = (a, b) => (str[a] + S.sd * gauss() >= str[b] + S.sd * gauss() ? a : b);
    for (let i = 0; i < N; i++) {
      const w = {}, pf = {}; for (const t of ids) { w[t] = S.base[t][0]; pf[t] = S.base[t][1]; }
      for (const [k, h, a] of S.remaining) { const sh = (k === S.cur ? wk[h] : str[h]) + S.sd * gauss(), sa = (k === S.cur ? wk[a] : str[a]) + S.sd * gauss(); pf[h] += sh; pf[a] += sa; if (sh > sa) w[h]++; else w[a]++; }
      const order = [...ids].sort((x, y) => w[y] - w[x] || pf[y] - pf[x]);
      for (let k = 0; k < S.po; k++) po[order[k]]++; byes[order[0]]++; byes[order[1]]++;
      if (withTitle && S.po >= 6) { const s1 = play(order[0], play(order[3], order[4])), s2 = play(order[1], play(order[2], order[5])); fin[s1]++; fin[s2]++; ttl[play(s1, s2)]++; }
    }
    const out = {}; for (const t of ids) out[t] = { po: 100 * po[t] / N, bye: 100 * byes[t] / N, ros: ros[t], wk: wk[t], final: 100 * fin[t] / N, title: 100 * ttl[t] / N }; return out;
  }
  function renderAnalyzer() {
    if (!D.sim) return;
    const teamsSorted = [...D.teams].sort((a, b) => a.name.localeCompare(b.name));
    if (taA == null) taA = team || teamsSorted[0].id;
    if (taB == null || taB === taA) taB = teamsSorted.find((t) => t.id !== taA).id;
    const fill = (sel, val, other) => { sel.replaceChildren(...teamsSorted.map((t) => el('option', { value: t.id, text: `${t.name} (${t.owner})` }))); sel.value = val; };
    const A = $('#ta-a'), B = $('#ta-b'); fill(A, taA); fill(B, taB);
    A.onchange = () => { taA = Number(A.value); if (taA === taB) taB = teamsSorted.find((t) => t.id !== taA).id; taSel.a.clear(); taSel.b.clear(); renderAnalyzer(); };
    B.onchange = () => { taB = Number(B.value); if (taA === taB) taA = teamsSorted.find((t) => t.id !== taB).id; taSel.a.clear(); taSel.b.clear(); renderAnalyzer(); };
    const list = (host, tid, set, label) => {
      const rows = (D.rosters[tid] || []).filter((r) => r.slot !== 'IR').sort((x, y) => (y.ros || 0) - (x.ros || 0));
      host.replaceChildren(el('div', { class: 'ta-h', text: `${tm(tid).owner} sends` }), ...rows.map((r) => {
        const id = `ta-${label}-${r.pid}`;
        const cb = el('input', { type: 'checkbox', id }); cb.checked = set.has(r.pid);
        cb.addEventListener('change', () => { if (cb.checked) set.add(r.pid); else set.delete(r.pid); drawAnalyzer(); });
        return el('label', { class: 'ta-row', for: id }, cb, el('span', { text: r.name }), el('span', { class: 'muted', text: `${r.pos} · ${Math.round(r.ros || 0)} ROS` }));
      }));
    };
    list($('#ta-la'), taA, taSel.a, 'a'); list($('#ta-lb'), taB, taSel.b, 'b');
    drawAnalyzer();
  }
  let taTimer;
  function drawAnalyzer() {
    const host = $('#ta-out');
    if (!taSel.a.size && !taSel.b.size) { host.replaceChildren(el('p', { class: 'note', text: 'Tick the players each side gives up.' })); return; }
    host.replaceChildren(el('p', { class: 'note', text: 'Running 12,000 seasons…' }));
    clearTimeout(taTimer);
    taTimer = setTimeout(() => {
      const base = (t) => D.rosters[t] || [];
      const moved = (t) => {
        let r = base(t);
        if (t === taA) r = r.filter((x) => !taSel.a.has(x.pid)).concat(base(taB).filter((x) => taSel.b.has(x.pid)).map((x) => ({ ...x, slot: 'Bench' })));
        if (t === taB) r = r.filter((x) => !taSel.b.has(x.pid)).concat(base(taA).filter((x) => taSel.a.has(x.pid)).map((x) => ({ ...x, slot: 'Bench' })));
        return r;
      };
      const before = seasonSim(base), after = seasonSim(moved);
      const side = (tid, gives, gets) => {
        const b = before[tid], a = after[tid], d = a.po - b.po;
        return el('div', { class: 'ta-side' },
          el('b', { text: `${tm(tid).name} (${tm(tid).owner})` }),
          el('div', { class: 'muted', text: `Gives ${gives.map((x) => x.name).join(', ') || 'nothing'} · gets ${gets.map((x) => x.name).join(', ') || 'nothing'}` }),
          el('div', { class: 'ta-big ' + (d >= 1 ? 'up' : d <= -1 ? 'down' : '') }, `${f1(b.po)}% → ${f1(a.po)}%`, el('small', { text: ` playoff odds (${d >= 0 ? '+' : ''}${f1(d)})` })),
          el('div', { text: `Best lineup, rest of season: ${f1(b.ros)} → ${f1(a.ros)} pts/week (${a.ros - b.ros >= 0 ? '+' : ''}${f1(a.ros - b.ros)})` }),
          el('div', { text: `This week: ${f1(b.wk)} → ${f1(a.wk)} projected` }),
          el('div', { class: 'muted', text: `Rest-of-season points moving: ${Math.round(gives.reduce((s, x) => s + (x.ros || 0), 0))} out, ${Math.round(gets.reduce((s, x) => s + (x.ros || 0), 0))} in` }));
      };
      const gA = base(taA).filter((x) => taSel.a.has(x.pid)), gB = base(taB).filter((x) => taSel.b.has(x.pid));
      const dA = after[taA].po - before[taA].po, dB = after[taB].po - before[taB].po;
      const verdict = Math.abs(dA - dB) < 3 ? 'Fair trade: both sides move about the same.' : dA > dB ? `${tm(taA).owner} wins this one.` : `${tm(taB).owner} wins this one.`;
      const ripple = D.teams.filter((t) => t.id !== taA && t.id !== taB).map((t) => ({ t, d: after[t.id].po - before[t.id].po })).filter((x) => Math.abs(x.d) >= 1).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      const sizeNote = gA.length !== gB.length ? el('p', { class: 'note', text: 'Uneven trade: whoever gets more players would have to drop someone. This assumes their worst bench player goes.' }) : null;
      host.replaceChildren(...[el('div', { class: 'cmp-verdict', text: verdict }), el('div', { class: 'ta-sides' }, side(taA, gA, gB), side(taB, gB, gA)), sizeNote,
        ripple.length ? el('p', { class: 'note', text: 'Ripple effect: ' + ripple.map((x) => `${x.t.owner} ${x.d >= 0 ? '+' : ''}${f1(x.d)}%`).join(', ') }) : null].filter(Boolean));
    }, 30);
  }


  let playGame = linkGame || ({ hol: 'pick' })[store.get('play-game')] || (['bk', 'pick', 'pred', 'poop'].includes(store.get('play-game')) ? store.get('play-game') : 'pick'), bkInst = null;
  // the address bar always holds a link someone can share: #pickem, #playoffs, #talk …
  function routeHash() { return tab === 'play' ? GAME_ROUTE[playGame] : tab === 'league' ? LV_ROUTE[leagueView] : tab; }
  function syncHash() { history.replaceState(null, '', location.pathname + location.search + '#' + routeHash()); }
  async function shareLink() {
    const label = tab === 'play' ? ({ pick: 'Pick’em', pred: 'Predictions', poop: 'the Dump Log', bk: 'Breakaway' })[playGame] : tab === 'league' ? ({ playoffs: 'the playoff bracket', history: 'the trophy case' })[leagueView] || 'League HQ' : 'League HQ';
    const url = location.origin + '/#' + routeHash(), wk = LIVE ? ` Week ${LIVE.week}` : '';
    const text = tab === 'play' && (playGame === 'pick' || playGame === 'pred') ? `${wk.trim()} ${label} are open. Get yours in:` : `Check out ${label}:`;
    try { if (navigator.share) { await navigator.share({ text, url }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return ''; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); return 'Link copied — paste it in the group chat'; } catch { return url; }
  }
  let LB = null, lbAt = 0, bkLevel = 'hard';
  const LB_GAME = () => `bk:${bkLevel}`;
  async function loadLB(force) {
    if (!force && LB && Date.now() - lbAt < 60000) return;
    try { LB = await getJSON('/api/scores'); lbAt = Date.now(); } catch { LB = { ready: false, boards: {} }; }
    if (tab === 'play') renderLB();
  }
  async function postScore(game, level, score) {
    if (!ME || !(score > 0)) return;
    if (score > (Number(store.get(`lb-synced-${game}:${level}`)) || 0)) store.set(`lb-synced-${game}:${level}`, String(score));
    try {
      const r = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game, level, team: ME, score, token: pinTok() }) });
      const j = await r.json(); if (pinFail(j)) return; if (j && j.boards) { LB = j; lbAt = Date.now(); }
    } catch { /* offline: personal best is still saved on the device */ }
    if (tab === 'play') renderLB();
  }
  function renderLB() {
    const key = LB_GAME(), host = $('#lb');
    const unit = 'yds';
    $('#lb-title').textContent = 'Breakaway leaderboard';
    $('#lb-sub').textContent = { rookie: 'Rookie', pro: 'Pro', hard: 'All-Pro', extreme: 'Extreme 💀' }[bkLevel];
    if (!LB) { host.replaceChildren(el('p', { class: 'note', text: 'Loading…' })); loadLB(); return; }
    if (!LB.ready) { host.replaceChildren(el('p', { class: 'note', text: 'The league leaderboard isn\'t switched on yet (it needs a free database in Vercel). Your best score is still saved on this device.' })); return; }
    // scores set on this device before the board existed (or while offline): offer to add them once
    const pending = [];
    if (ME && T[ME]) {
      for (const [g, lvls, lab] of [['bk', ['rookie', 'pro', 'hard', 'extreme'], { rookie: 'Breakaway Rookie', pro: 'Breakaway Pro', hard: 'Breakaway All-Pro', extreme: 'Breakaway Extreme' }]]) {
        for (const l of lvls) {
          const local = Number(store.get(`${g}-best-${l}`)) || 0, done = Number(store.get(`lb-synced-${g}:${l}`)) || 0;
          const mine = (LB.boards[`${g}:${l}`] || []).find((r) => r.id === ME);
          if (local > 0 && local > done && (!mine || mine.score < local)) pending.push({ g, l, v: local, lab: lab[l], unit: g === 'bk' ? 'yds' : 'in a row' });
        }
      }
    }
    const offer = pending.length ? (() => {
      const add = el('button', { class: 'btn', type: 'button', text: `Add as ${T[ME].owner}` });
      const no = el('button', { class: 'linkbtn', type: 'button', text: 'Not mine' });
      add.addEventListener('click', async () => { add.disabled = true; for (const p of pending) { store.set(`lb-synced-${p.g}:${p.l}`, String(p.v)); await postScore(p.g, p.l, p.v); } renderLB(); });
      no.addEventListener('click', () => { for (const p of pending) store.set(`lb-synced-${p.g}:${p.l}`, String(p.v)); renderLB(); });
      return el('div', { class: 'lb-offer' }, el('p', {}, 'Earlier scores on this device: ', el('b', { text: pending.map((p) => `${p.lab} ${p.v} ${p.unit}`).join(', ') }), `. Put them on the board under ${T[ME].owner}?`), el('div', { class: 'lb-offer-b' }, add, no));
    })() : null;
    const rows = (LB.boards[key] || []).filter((r) => T[r.id]);
    if (!rows.length) { host.replaceChildren(...[offer, el('p', { class: 'note', text: 'No scores yet. Be the first on the board.' })].filter(Boolean)); return; }
    const medal = ['🥇', '🥈', '🥉'];
    host.replaceChildren(...[offer].filter(Boolean), el('ol', { class: 'lb' }, ...rows.map((r, i) => el('li', { class: r.id === ME ? 'me' : '' },
      el('span', { class: 'lb-r', text: medal[i] || String(i + 1) }),
      el('span', { class: 'lb-n' }, el('b', { text: T[r.id].owner }), el('small', { text: T[r.id].name })),
      el('span', { class: 'lb-s' }, el('b', { text: String(r.score) }), el('small', { text: unit })),
      el('span', { class: 'lb-d' }, new Date(r.at).toLocaleDateString([], { month: 'short', day: 'numeric' }), ME === ADMIN && pinTok() ? removeBtn(r) : null)))));
  }
  function removeBtn(r) {
    const b = el('button', { class: 'lb-x', type: 'button', text: 'Remove' });
    b.addEventListener('click', async () => {
      if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Tap again'; setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = 'Remove'; } }, 3000); return; }
      b.disabled = true;
      const [g, l] = LB_GAME().split(':');
      try {
        const res = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', game: g, level: l, team: r.id, admin: ADMIN, token: pinTok() }) });
        const j = await res.json(); if (pinFail(j)) return; if (j && j.boards) { LB = j; lbAt = Date.now(); }
        store.set(`lb-synced-${g}:${l}`, String(Number(store.get(`${g}-best-${l}`)) || 0)); // don't offer to re-add it
      } catch { /* try again later */ }
      renderLB();
    });
    return b;
  }
  function renderWho() {
    const host = $('#play-who');
    if (ME && T[ME]) {
      const chg = el('button', { class: 'linkbtn', type: 'button', text: 'Not you?' });
      chg.addEventListener('click', () => { whoOpen = true; renderPlay(); });
      if (!whoOpen) { host.replaceChildren(el('div', { class: 'who-bar' }, el('span', {}, 'Playing as ', el('b', { text: T[ME].owner }), ` · ${T[ME].name}`), chg)); return true; }
    }
    host.replaceChildren(el('div', { class: 'who-pick' }, el('h2', { text: 'Who are you?' }), el('p', { class: 'note', text: 'Your scores and Dump Log entries go under this name. The app admin can see when each name last opened the app.' }),
      el('div', { class: 'pickgrid' }, ...[...D.teams].sort((a, b) => a.owner.localeCompare(b.owner)).map((t) => {
        const b = el('button', { class: 'pickbtn' }, el('b', { text: t.owner }), el('span', { text: t.name }));
        b.addEventListener('click', () => { whoOpen = false; setMe(t.id); });
        return b;
      }))));
    return false;
  }
  let whoOpen = false;
  const ADMIN = 4; // commissioner
  const pinTok = (t = ME) => store.get('pin-tok-' + t);
  const pinHas = {};
  function pinFail(j) { if (j && j.pin) { store.set('pin-tok-' + ME, ''); renderPlay(); return true; } return false; }
  function renderPin(host, chg) {
    const t = ME, who = T[t].owner;
    if (pinHas[t] == null) {
      host.replaceChildren(el('p', { class: 'note', text: 'Checking…' }));
      getJSON(`/api/pin?ME=${t}`).then((j) => { pinHas[t] = j.ready ? !!j.has : 'off'; renderAdmin(); }).catch(() => { pinHas[t] = 'off'; renderAdmin(); });
      return;
    }
    if (pinHas[t] === 'off') { host.replaceChildren(el('p', { class: 'note', text: 'Can’t check PINs right now. Try again in a minute.' })); return; }
    const creating = !pinHas[t];
    const inp = (lab) => el('input', { class: 'pin-in', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', pattern: '[0-9]*', placeholder: '••••', 'aria-label': lab });
    const a = inp('PIN'), b2 = creating ? inp('Type it again') : null;
    const err = el('p', { class: 'pin-err' });
    const go = el('button', { class: 'btn big', type: 'submit', text: creating ? 'Set my PIN' : 'Unlock' });
    const form = el('form', { class: 'pin-form' }, a, b2, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      if (!/^\d{4}$/.test(a.value)) { err.textContent = 'Use 4 digits.'; return; }
      if (creating && a.value !== b2.value) { err.textContent = 'Those don’t match.'; return; }
      go.disabled = true;
      try {
        const r = await fetch('/api/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: t, pin: a.value }) });
        const j = await r.json();
        if (j.ok && j.token) { store.set('pin-tok-' + t, j.token); pinHas[t] = true; adminOpen = true; renderPlay(); return; }
        err.textContent = j.error || 'That didn’t work.';
      } catch { err.textContent = 'Couldn’t reach the server.'; }
      go.disabled = false; a.value = ''; if (b2) b2.value = ''; a.focus();
    });
    host.replaceChildren(el('div', { class: 'who-pick pin-box' },
      el('h3', { text: creating ? 'Set your admin PIN' : 'Enter your admin PIN' }),
      el('p', { class: 'note', text: creating ? 'Locks the admin tools so only you can remove scores or see who’s been on. Type it twice. Needed once per device.' : 'Needed once per device.' }),
      form, err));
  }
  let adminOpen = false;
  const ago = (ms) => { if (!ms) return 'never'; const m = Math.round((Date.now() - ms) / 60000); if (m < 2) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`; const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`; };
  // admin: everything people did, newest first (who, what, when, which kind of device)
  let actFilter = 'all', actShow = 120;
  const ACT = { open: 'opened the app', post: 'posted in Trash Talk', 'post-anon': 'posted anonymously', react: 'reacted', delete: 'deleted their post', 'admin-delete': 'deleted a post (admin)',
    picks: 'Pick’em:', poop: 'logged a 💩', 'poop-undo': 'undid a 💩', game: 'played', 'admin-reset-picks': 'reset Pick’em picks (admin)', 'admin-remove-score': 'removed a score (admin)', reply: 'replied', 'reply-anon': 'replied anonymously', predict: 'made predictions:', 'predict-lock': 'Predictions:', 'push-on': 'turned on notifications 🔔', 'push-test': 'sent a test notification via', 'push-error': '⚠️ notification failed:', 'push-off': 'turned off notifications' };
  function activityLog(log) {
    const box = el('div', { class: 'act' });
    const people = [...new Set(log.map((e) => e.t))];
    const sel = el('select', { class: 'wk-pick', 'aria-label': 'Filter activity' }, el('option', { value: 'all', text: 'Everyone' }), el('option', { value: 'open', text: 'App opens only' }),
      ...people.map((t) => el('option', { value: 't' + t, text: t === 0 ? 'Anonymous' : T[t] ? T[t].owner : `Team ${t}` })));
    sel.value = actFilter;
    sel.addEventListener('change', () => { actFilter = sel.value; actShow = 120; box.replaceWith(activityLog(log)); });
    const rows = log.filter((e) => actFilter === 'all' || (actFilter === 'open' ? e.a === 'open' : 't' + e.t === actFilter));
    const items = []; let day = '';
    for (const e of rows.slice(0, actShow)) {
      const d = new Date(e.at), dk = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      if (dk !== day) { day = dk; items.push(el('div', { class: 'act-day', text: dk })); }
      const who = e.t === 0 ? 'Anonymous' : T[e.t] ? T[e.t].owner : `Team ${e.t}`;
      items.push(el('div', { class: 'act-row' + (e.a === 'open' ? ' open' : '') },
        el('span', { class: 'act-t', text: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }),
        el('span', { class: 'act-w' }, el('b', { text: who }), ` ${ACT[e.a] || e.a}`, e.d && e.a !== 'open' ? el('span', { class: 'act-d', text: ` ${/^(post|reply)/.test(e.a) ? '“' + e.d + '”' : e.d}` }) : null),
        el('span', { class: 'act-dev', text: e.dev + (e.a === 'open' && e.d ? ` · ${e.d === 'home-screen app' ? 'app' : 'browser'}` : '') })));
    }
    const more = rows.length > actShow ? el('button', { class: 'linkbtn', type: 'button', text: `Show more (${rows.length - actShow} older)` }) : null;
    if (more) more.addEventListener('click', () => { actShow += 200; box.replaceWith(activityLog(log)); });
    box.append(el('div', { class: 'row-head' }, el('h3', { text: 'Activity log' }), sel),
      el('p', { class: 'note', text: 'Only you can see this. Names are whoever each phone picked in the app; device type helps spot someone posing as someone else. No IP addresses are stored.' }),
      ...(items.length ? items : [el('p', { class: 'note', text: 'Nothing logged yet. Activity starts recording from today.' })]), more || '');
    return box;
  }
  async function loadSeen(host) {
    try {
      const j = await getJSON(`/api/seen?team=${ME}&token=${encodeURIComponent(pinTok())}`);
      const by = Object.fromEntries((j.rows || []).map((r) => [r.id, r]));
      const rows = D.teams.map((x) => ({ x, r: by[x.id] || { last: null, visits: 0, pin: false } })).sort((a, b) => (b.r.last || 0) - (a.r.last || 0));
      const seenTable = (el('table', { class: 'seen-t' }, el('thead', {}, el('tr', {}, el('th', { text: 'Manager' }), el('th', { text: 'Last seen' }), el('th', { class: 'n', text: 'Visits' }), el('th', { text: '' }))),
        el('tbody', {}, ...rows.map(({ x, r }) => el('tr', { class: x.id === ME ? 'me' : '' }, el('td', { text: x.owner }), el('td', { class: r.last && Date.now() - r.last < 3600000 ? 'good' : '', text: ago(r.last) }), el('td', { class: 'n', text: String(r.visits || 0) }), el('td', { text: '' }))))));
      host.replaceChildren(seenTable, activityLog(j.log || []));
    } catch (e) { host.replaceChildren(el('p', { class: 'note', text: `Couldn’t load (${e.message}).` })); }
  }
  // admin: wipe one person's Pick'em picks for the week being viewed (they can re-pick games not yet started)
  let pkResetArm = null;
  function pickAdmin() {
    const box = el('div', { class: 'pk-admin' }, el('h3', { text: 'Pick’em picks' }));
    if (!PK || !PK.ready) { box.append(el('p', { class: 'note', text: 'Open Pick’em once to manage picks.' })); return box; }
    const who = Object.entries(PK.made || {}).filter(([, n]) => n > 0).map(([t, n]) => [Number(t), n]).filter(([t]) => T[t]);
    if (!who.length) { box.append(el('p', { class: 'note', text: `Nobody has locked in picks for week ${PK.wk} yet.` })); return box; }
    box.append(el('p', { class: 'note', text: `Week ${PK.wk}. Reset wipes that person’s picks for the week; they can re-pick any game that hasn’t kicked off.` }));
    for (const [t, n] of who) {
      const b = el('button', { class: 'linkbtn', type: 'button', text: pkResetArm === t ? `Tap again to wipe ${T[t].owner}’s picks` : 'Reset' });
      b.addEventListener('click', async () => {
        if (pkResetArm !== t) { pkResetArm = t; renderAdmin(); return; }
        pkResetArm = null; b.disabled = true; b.textContent = 'Resetting…';
        try {
          const r = await fetch('/api/picks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset', year: D.league.year, week: PK.wk, target: t, team: ME, token: pinTok() }) });
          const j = await r.json(); if (pinFail(j)) return;
          if (!r.ok) throw new Error(j.error || 'Reset failed');
          const wk = PK.wk; PK = null; pkWeek = wk; await loadPickem();
        } catch (e) { pkMsg = e.message; }
        renderAdmin(); if (playGame === 'pick') renderPickem();
      });
      box.append(el('div', { class: 'admin-row' }, el('span', { text: `${T[t].owner}: ${n} pick${n === 1 ? '' : 's'}` }), b));
    }
    return box;
  }
  function renderAdmin() {
    const host = $('#play-admin');
    if (ME !== ADMIN) { host.replaceChildren(); return; }
    if (!pinTok()) {
      const inner = el('div');
      const det = el('details', { class: 'card admin' }, el('summary', { text: 'Admin tools' }), inner);
      if (adminOpen) det.open = true;
      det.addEventListener('toggle', () => { adminOpen = det.open; });
      host.replaceChildren(det); renderPin(inner);
      return;
    }
    const seenHost = el('div', { class: 'seen' }, el('p', { class: 'note', text: 'Loading…' }));
    const det = el('details', { class: 'card admin' }, el('summary', { text: 'Admin tools' }),
      el('h3', { text: 'Who’s been on' }), el('p', { class: 'note', text: 'By the name each person picked in the app (honor system). Visits count once per 10 minutes.' }), seenHost,
      el('p', { class: 'note', text: 'You can remove any leaderboard score below.' }), pickAdmin());
    if (adminOpen) det.open = true;
    det.addEventListener('toggle', () => { adminOpen = det.open; if (det.open) loadSeen(seenHost); });
    if (det.open) loadSeen(seenHost);
    host.replaceChildren(det);
  }
  function renderPlay() {
    const ok = renderWho();
    renderAdmin(); if (!ok) $('#play-admin').replaceChildren();
    $('#play-pick').hidden = !ok; $$('.play-game').forEach((g) => { if (!ok) g.hidden = true; }); $('.play-lb').hidden = !ok;
    if (!ok) return;
    loadLB();
    $$('#play-pick button').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.game === playGame)); b.onclick = () => { playGame = b.dataset.game; store.set('play-game', playGame); syncHash(); renderPlay(); }; });
    const sh = $('#play-share'); if (sh) { sh.hidden = !(playGame === 'pick' || playGame === 'pred'); sh.textContent = `🔗 Send ${playGame === 'pred' ? 'Predictions' : 'Pick’em'} link to the group`; sh.onclick = async () => { const m = await shareLink(); if (m && m !== 'shared') { sh.textContent = m; setTimeout(() => renderPlay(), 3000); } }; }
    $('#play-bk').hidden = playGame !== 'bk'; $('#play-pickem').hidden = playGame !== 'pick'; $('#play-pred').hidden = playGame !== 'pred'; $('#play-poop').hidden = playGame !== 'poop'; $('.play-lb').hidden = playGame !== 'bk';
    if (playGame === 'poop') { renderPoop(); return; }
    if (playGame === 'bk') {
      if (!bkInst && window.Breakaway) {
        const mine = ME && T[ME];
        bkInst = window.Breakaway.mount($('#play-bk'), { names: D.teams.filter((x) => x.id !== ME).map((x) => x.owner), me: mine ? mine.owner : 'Rookie', big: !!(mine && /^justin/i.test(mine.owner)), hair: mine && /^(brandon|wes)/i.test(mine.owner) ? '#e2531f' : null, accent: css('--accent') || '#c2410c',
          onLevel: (lv) => { bkLevel = lv; renderLB(); }, onEnd: (lv, yds) => postScore('bk', lv, yds) });
      }
      renderLB();
      return;
    }
    if (playGame === 'pred') { renderPred(); return; }
    renderPickem();
  }

  // ---------- Predictions: 7 picks on our own league each week, lock at the first NFL kickoff ----------
  let PR = null, prWeek = null, prBoard = 'week', prBusy = false, prMsg = '';
  async function loadPred() {
    const wk = prWeek || D.league.week;
    try { PR = await getJSON(`/api/club?k=pred&year=${D.league.year}&week=${wk}&team=${ME}`); } catch (e) { PR = { ready: false, error: e.message }; }
    PR.wk = wk; PR.me = ME; if (tab === 'play' && playGame === 'pred') renderPred();
  }
  async function predAnswer(qid, a) {
    if (prBusy) return; prBusy = true; PR.mine[qid] = a; prMsg = ''; renderPred();
    try {
      const r = await fetch('/api/club', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 'pred', year: D.league.year, week: PR.wk, team: ME, q: qid, a }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Didn’t save');
      const wk = PR.wk; PR = j; PR.wk = wk; PR.me = ME; prMsg = '✓ Saved';
    } catch (e) { prMsg = e.message; }
    prBusy = false; renderPred();
  }
  let prConfirm = false, prLocking = false;
  async function predLock() {
    if (prBusy) return;
    if (!prConfirm) { prConfirm = true; renderPred(); return; }
    prBusy = true; prLocking = true; prConfirm = false; prMsg = ''; renderPred();
    try {
      const r = await fetch('/api/club', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 'pred', year: D.league.year, week: PR.wk, team: ME, action: 'lock' }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Didn’t lock');
      const wk = PR.wk; PR = j; PR.wk = wk; PR.me = ME; prMsg = '✓ Locked in. Good luck.';
    } catch (e) { prMsg = e.message; }
    prBusy = false; prLocking = false; renderPred();
  }
  function renderPred() {
    const host = $('#play-pred');
    if (!PR || PR.wk !== (prWeek || D.league.week) || PR.me !== ME) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note', text: 'Loading this week’s predictions…' }))); if (!prBusy) { prBusy = true; loadPred().finally(() => { prBusy = false; }); } return; }
    if (!PR.ready) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note', text: PR.error || 'Predictions need the league database.' }))); return; }
    const wk = PR.wk, mine = PR.mine || {}, res = PR.results;
    const answered = PR.qs.filter((q) => mine[q.id]).length;
    const frozen = PR.locked || !!PR.lockedAt; // the week has started, or you locked in
    const hm = (ts) => new Date(Number(ts)).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const right = res ? PR.qs.filter((q) => mine[q.id] && mine[q.id] === res[q.id]).length : 0;
    const nav = (d, lab) => { const b = el('button', { class: 'btn ghost pk-nav', type: 'button', text: lab, disabled: (wk + d < 1 || wk + d > D.league.week) ? 'disabled' : null }); b.addEventListener('click', () => { prWeek = wk + d; PR = null; renderPred(); }); return b; };
    const lockTxt = PR.locksAt ? new Date(PR.locksAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
    const head = el('div', { class: 'card pk-head' },
      el('div', { class: 'pk-title' }, nav(-1, '‹'), el('div', {}, el('h2', { text: `Week ${wk} Predictions` }), el('small', { text: res ? `You went ${right} for ${answered}` : `${answered} of ${PR.qs.length} answered` })), nav(1, '›')),
      el('p', { class: 'note', text: res ? 'Graded from the final scores.' : PR.locked ? 'Locked. Results come in when the week is final.' : PR.lockedAt ? `🔒 You locked in ${hm(PR.lockedAt)}. Everyone’s answers show at the first kickoff${lockTxt ? ` (${lockTxt})` : ''}.` : `Answer all ${PR.qs.length}, then lock in. You can change answers until you lock (deadline: first kickoff${lockTxt ? `, ${lockTxt}` : ''}). The standings show who’s locked in.` }),
      prMsg ? el('p', { class: prMsg.startsWith('✓') ? 'note al-ok' : 'pin-err', text: prMsg }) : null);
    const teamQ = (q) => q.kind === 'top' || q.kind === 'low' || q.kind === 'match';
    const label = (q, o) => (teamQ(q) && T[o.v] ? T[o.v].owner : o.label);
    const subOf = (q, o) => (teamQ(q) && T[o.v] ? o.sub || T[o.v].name : o.who && T[o.who] ? `${o.sub || ''} · ${T[o.who].owner}` : o.sub || '');
    const owners = (txt) => [...D.teams].sort((a, b) => b.name.length - a.name.length).reduce((t, x) => (x.name ? t.split(x.name).join(x.owner) : t), String(txt || ''));
    const qText = (q) => (q.kind === 'match' && T[q.a] && T[q.h] ? `${T[q.a].owner} vs ${T[q.h].owner}: who wins?` : owners(q.text));
    const cards = PR.qs.map((q, i) => {
      const crowd = PR.picks ? Object.values(PR.picks).filter((a) => a[q.id]) : [];
      const best = q.opts.reduce((m, o) => (o.p != null && (m == null || o.p > m.p) ? o : m), null);
      const btns = q.opts.map((o) => {
        const on = mine[q.id] === o.v, isAns = res && res[q.id] === o.v;
        const n = PR.picks ? crowd.filter((a) => a[q.id] === o.v).length : null, sub = subOf(q, o);
        const tipTxt = [label(q, o), sub, o.p != null ? `The app gives this a ${o.p}% chance` : '', n ? `${n} of us picked it` : ''].filter(Boolean).join(' · ');
        const b = el('button', { class: 'pr-opt' + (on ? ' on' : '') + (res ? (isAns ? ' won' : on ? ' lost' : '') : '') + (sub || o.p != null ? ' rich' : ''), type: 'button', disabled: frozen ? 'disabled' : null, title: tipTxt },
          el('span', { class: 'pr-ol' }, el('span', { text: label(q, o) }), sub ? el('small', { class: 'pr-sub', text: sub }) : null),
          el('span', { class: 'pr-or' }, o.p != null ? el('small', { class: 'pr-p' + (best === o ? ' bot' : ''), text: `${best === o ? '🤖 ' : ''}${o.p}%` }) : null,
            n != null && n > 0 ? el('small', { class: 'pr-n2', text: `${n} 👤` }) : null),
          on && res ? el('span', { class: 'pk-mark', text: isAns ? '✅' : '❌' }) : null);
        if (!frozen) b.addEventListener('click', () => { prConfirm = false; predAnswer(q.id, o.v); });
        return b;
      });
      return el('div', { class: 'card pr-q' }, el('div', { class: 'pr-n', text: `${i + 1}` }), el('div', {}, el('b', { text: qText(q) }),
        q.info ? el('p', { class: 'pr-info', text: `ⓘ ${owners(q.info)}` }) : null,
        el('div', { class: 'pr-opts' + (q.opts.length > 2 ? ' many' : '') + (q.opts.some((o) => o.sub || o.p != null) ? ' rich' : '') + (q.kind === 'star' || q.kind === 'bench' || q.kind === 'close' ? ' one' : '') }, ...btns)));
    });
    const rows = (PR.board && PR.board[prBoard]) || [];
    const st = PR.status || {};
    const statusList = !res && prBoard === 'week' ? el('ul', { class: 'lb pr-status' }, ...[...D.teams].map((t) => ({ t, s: st[t.id] || { n: 0, at: null } }))
      .sort((a, b) => (!!b.s.at - !!a.s.at) || (a.s.at && b.s.at ? a.s.at - b.s.at : b.s.n - a.s.n) || a.t.owner.localeCompare(b.t.owner))
      .map(({ t, s }) => el('li', { class: t.id === ME ? 'me' : '' },
        el('span', { class: 'lb-r', text: s.at ? '🔒' : s.n ? '✏️' : '·' }),
        el('span', { class: 'lb-n' }, el('b', { text: t.owner }), el('small', { text: t.name })),
        el('span', { class: 'lb-s' }, el('b', { class: s.at ? 'up' : '', text: s.at ? 'Locked in' : s.n ? `${s.n} of ${PR.total || PR.qs.length}` : 'Not started' })),
        el('span', { class: 'lb-d', text: s.at ? hm(s.at) : '' })))) : null;
    const segb = (k, lab) => { const b = el('button', { 'aria-pressed': String(prBoard === k), text: lab }); b.addEventListener('click', () => { prBoard = k; renderPred(); }); return b; };
    const lb = el('div', { class: 'card pk-lb' }, el('div', { class: 'row-head' }, el('h3', { text: 'Prediction standings' }), el('div', { class: 'seg' }, segb('week', `Week ${wk}`), segb('season', 'Season'))),
      statusList || (rows.length ? el('ul', { class: 'lb' }, ...rows.filter((r) => T[r.id]).map((r, i) => el('li', { class: r.id === ME ? 'me' : '' },
        el('span', { class: 'lb-r', text: i === 0 && r.c ? '👑' : String(i + 1) }), el('span', { class: 'lb-n' }, el('b', { text: T[r.id].owner }), el('small', { text: T[r.id].name })),
        el('span', { class: 'lb-s' }, el('b', { text: `${r.c}/${r.n}` })), el('span', { class: 'lb-d', text: prBoard === 'season' ? `${r.wk} wk${r.wk === 1 ? '' : 's'}` : '' }))))
        : el('p', { class: 'note', text: prBoard === 'week' ? (res ? 'Nobody predicted this week.' : 'Standings show once the week is final.') : 'No graded weeks yet.' })));
    // lock-in bar
    let bar = null;
    if (!frozen && answered) {
      const all = answered === PR.qs.length;
      const go = el('button', { class: 'btn big pk-lockbtn' + (prConfirm ? ' confirm' : ''), type: 'button', disabled: all ? null : 'disabled',
        text: prLocking ? 'Locking in…' : !all ? `Answer all ${PR.qs.length} to lock in (${answered} done)` : prConfirm ? 'Tap again to lock in for good' : `🔒 Lock in my ${PR.qs.length} predictions` });
      go.addEventListener('click', predLock);
      bar = el('div', { class: 'pk-bar' }, el('small', { text: all ? 'Once you lock in, your answers can’t change. Everyone sees you’re in.' : 'Your answers save as you go. Lock in when you’re done.' }), go);
    }
    host.replaceChildren(...[head, ...cards, lb, bar].filter(Boolean));
  }
  // ---------- NFL Pick'em: pick the winner of every game, locks at kickoff ----------
  let PK = null, pkWeek = null, pkBoard = 'week', pkMsg = '', pkBusy = false;
  const pkOpen = new Set(); // games with the details panel open
  const canHover = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  // everything we know about one NFL game: odds, records, projected score, weather, our league's players in it
  function pkInfo(g, wk) {
    const cur = D && wk === D.league.week;
    const n = cur ? (D.nfl || []).find((x) => x.home.abbr === g.home.abbr && x.away.abbr === g.away.abbr) : null;
    const hwin = g.hwin ?? n?.hwin ?? null;
    const side = (s, ns, home) => ({ abbr: s.abbr, name: s.name, rec: s.rec || ns?.rec || null, win: hwin == null ? null : Math.round(100 * (home ? hwin : 1 - hwin)), implied: ns?.implied ?? null, ppg: ns?.ppg ?? null, papg: ns?.papg ?? null });
    const players = [];
    if (cur) for (const t of D.teams) for (const r of D.rosters[t.id] || []) if ((r.nfl === g.home.abbr || r.nfl === g.away.abbr) && r.slot !== 'IR') players.push({ ...r, tid: t.id });
    players.sort((a, b) => (b.starter - a.starter) || b.proj - a.proj);
    return { a: side(g.away, n?.away, false), h: side(g.home, n?.home, true), total: g.total ?? n?.odds?.total ?? null, line: n?.odds?.details || (g.fav && g.line != null ? (g.line ? `${g.fav} -${g.line}` : 'Pick ’em') : null), n, players };
  }
  const usd = (v, sign) => `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`;
  const mlTxt = (ml) => (ml == null ? 'even' : ml > 0 ? `+${ml}` : String(ml));
  const mlWin = (ml, stake) => (!ml ? stake : ml > 0 ? stake * ml / 100 : stake * 100 / -ml);
  function pkTipText(x, s) {
    const bits = [];
    if (s.rec) bits.push(`Record ${s.rec}`);
    if (s.win != null) bits.push(`${s.win}% to win (Vegas)`);
    if (s.implied != null) bits.push(`Projected ${f1(s.implied)} pts`);
    if (s.ppg != null) bits.push(`Scores ${f1(s.ppg)}/game, allows ${f1(s.papg)}`);
    const ours = x.players.filter((p) => p.nfl === s.abbr && p.starter).slice(0, 4);
    if (ours.length) bits.push('League starters: ' + ours.map((p) => `${p.name} (${tm(p.tid).owner}) ${f1(p.proj)}`).join(', '));
    return bits.join('\n');
  }
  const logo = (abbr) => { const i = el('img', { class: 'pk-logo', src: `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr).toLowerCase()}.png`, alt: '', loading: 'lazy' }); i.addEventListener('error', () => { i.style.visibility = 'hidden'; }); return i; };
  async function loadPickem() {
    const wk = pkWeek || D.league.week;
    try { PK = await getJSON(`/api/picks?year=${D.league.year}&week=${wk}&team=${ME}`); } catch (e) { PK = { ready: false, error: e.message }; }
    PK.wk = wk; PK.me = ME; if (tab === 'play' && playGame === 'pick') { renderPickem(); if (ME === ADMIN && pinTok()) renderAdmin(); }
  }
  // picks are a draft on this phone until you lock them in; locked picks never change
  let pkConfirm = false;
  const draftKey = () => `pk-draft-${D.league.year}-${PK.wk}-${ME}`;
  const getDraft = () => { try { return JSON.parse(store.get(draftKey()) || '{}'); } catch { return {}; } };
  const setDraft = (d) => store.set(draftKey(), JSON.stringify(d));
  function pickTeam(g, abbr) {
    const d = getDraft();
    if (d[g.id] === abbr) delete d[g.id]; else d[g.id] = abbr; // tap again to un-pick
    setDraft(d); pkMsg = ''; pkConfirm = false; renderPickem();
  }
  async function lockIn() {
    if (pkBusy) return;
    const d = getDraft(); const n = Object.keys(d).length; if (!n) return;
    if (!pkConfirm) { pkConfirm = true; renderPickem(); return; }
    pkBusy = true; pkConfirm = false; pkMsg = '';
    try {
      const r = await fetch('/api/picks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: D.league.year, week: PK.wk, team: ME, picks: d }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not lock in your picks');
      const wk = PK.wk; PK = j; PK.wk = wk; PK.me = ME;
      const nd = getDraft(); for (const gid of Object.keys(nd)) if (PK.mine[gid] || (PK.games.find((x) => x.id === gid) || {}).state !== 'pre') delete nd[gid]; setDraft(nd);
      const got = n - (j.skipped || 0);
      pkMsg = `🔒 Locked in ${got} pick${got === 1 ? '' : 's'}.` + (j.skipped ? ` ${j.skipped} game${j.skipped === 1 ? '' : 's'} had already kicked off.` : '');
    } catch (e) { pkMsg = e.message; }
    pkBusy = false; renderPickem();
  }
  function renderPickem() {
    const host = $('#play-pickem');
    if (!PK || PK.wk !== (pkWeek || D.league.week) || PK.me !== ME) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note', text: 'Loading this week’s games…' }))); if (!pkBusy) { pkBusy = true; loadPickem().finally(() => { pkBusy = false; }); } return; }
    if (!PK.ready) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note', text: PK.error || 'Pick’em needs the league database (same one as the leaderboards).' }))); return; }
    const wk = PK.wk, games = PK.games || [], mine = PK.mine || {}, draft = getDraft();
    const isLocked = (g) => g.state !== 'pre' || Date.now() >= new Date(g.kickoff).getTime();
    const pkBank = () => {
      if (!PK.stake) return null;
      const r = ((PK.board && PK.board.week) || []).find((x) => x.id === ME) || {}, s = ((PK.board && PK.board.season) || []).find((x) => x.id === ME) || {};
      return el('div', { class: 'pk-bank', title: `Pretend money: $${PK.bank} a week, split evenly over every game (${usd(PK.stake)} each), paid at the closing Vegas moneyline.` },
        el('span', {}, el('small', { text: 'Your Vegas week' }), el('b', { class: (r.m || 0) > 0 ? 'up' : (r.m || 0) < 0 ? 'down' : '', text: usd(r.m || 0, true) })),
        el('span', {}, el('small', { text: 'Still riding' }), el('b', { text: usd(r.open || 0) })),
        el('span', {}, el('small', { text: 'Season' }), el('b', { class: (s.m || 0) > 0 ? 'up' : (s.m || 0) < 0 ? 'down' : '', text: usd(s.m || 0, true) })),
        el('p', { class: 'note', text: `Pretend money: $${PK.bank} a week, ${usd(PK.stake)} on every pick, paid at Vegas odds. Underdogs pay more.` }));
    };
    const graded = games.filter((g) => g.winner && g.winner !== 'TIE' && mine[g.id]);
    const right = graded.filter((g) => mine[g.id] === g.winner).length;
    for (const gid of Object.keys(draft)) { const g = games.find((x) => x.id === gid); if (!g || mine[gid] || isLocked(g)) delete draft[gid]; }
    const open = games.filter((g) => !isLocked(g) && !mine[g.id]), openLeft = open.filter((g) => !draft[g.id]).length, nDraft = Object.keys(draft).length;
    const nav = (d, lab) => { const b = el('button', { class: 'btn ghost pk-nav', type: 'button', text: lab, disabled: (wk + d < 1 || wk + d > 18) ? 'disabled' : null }); b.addEventListener('click', () => { pkWeek = wk + d; PK = null; renderPickem(); }); return b; };
    const head = el('div', { class: 'card pk-head' },
      el('div', { class: 'pk-title' }, nav(-1, '‹'), el('div', {}, el('h2', { text: `Week ${wk} Pick’em` }), el('small', { text: `${Object.keys(mine).length} of ${games.length} locked in${nDraft ? ` · ${nDraft} not locked yet` : ''}${graded.length ? ` · ${right}-${graded.length - right} so far` : ''}` })), nav(1, '›')),
      el('p', { class: 'note', text: open.length ? `Tap the team you think wins, then hit Lock in picks. Locked picks can’t be changed. ${openLeft ? `${openLeft} game${openLeft === 1 ? '' : 's'} still open.` : 'Every open game has a pick.'} Everyone’s picks show once a game kicks off.` : 'Every game this week is locked in or has kicked off.' }),
      pkBank(), pkMsg ? el('p', { class: 'pin-err', text: pkMsg }) : null);
    // games grouped by kickoff day
    const day = (g) => new Date(g.kickoff).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const groups = []; for (const g of games) { const d = day(g); if (!groups.length || groups[groups.length - 1][0] !== d) groups.push([d, []]); groups[groups.length - 1][1].push(g); }
    const card = (g) => {
      const started = isLocked(g), lockedIn = !!mine[g.id], lk = started || lockedIn, my = mine[g.id] || draft[g.id], who = (PK.picked && PK.picked[g.id]) || {};
      const x = pkInfo(g, wk);
      const side = (s) => {
        const chosen = my === s.abbr, won = g.winner === s.abbr;
        const b = el('button', { class: 'pk-team' + (chosen ? (lockedIn ? ' on' : ' draft') : '') + (g.done ? (won ? ' won' : ' lost') : ''), type: 'button', disabled: lk ? 'disabled' : null, 'aria-pressed': String(chosen) },
          logo(s.abbr),
          el('div', { class: 'pk-tn' }, el('b', { text: s.abbr }), el('small', { text: s.name })),
          s.score != null ? el('span', { class: 'pk-sc', text: String(s.score) }) : el('span', { class: 'pk-rec', text: (s.abbr === g.home.abbr ? x.h : x.a).rec || '' }),
          chosen ? el('span', { class: 'pk-mark', text: g.done ? (won ? '✅' : '❌') : lockedIn ? '🔒' : '✓' }) : null);
        if (!lk) b.addEventListener('click', () => pickTeam(g, s.abbr));
        if (canHover) { const sx = s.abbr === g.home.abbr ? x.h : x.a; b.addEventListener('mousemove', (ev) => tip.show(ev, sx.name && sx.name !== sx.abbr ? `${sx.abbr} ${sx.name}` : sx.abbr, pkTipText(x, sx))); b.addEventListener('mouseleave', () => tip.hide()); }
        return b;
      };
      const t = new Date(g.kickoff).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const split = started && Object.keys(who).length ? el('div', { class: 'pk-split' }, ...[g.away.abbr, g.home.abbr].filter((a) => who[a]).map((a) => el('span', {}, el('b', { text: `${a}: ` }), who[a].map((id) => (T[id] ? T[id].owner : '?')).join(', ')))) : null;
      return el('div', { class: 'card pk-game' + (my ? ' picked' : '') + (started ? ' locked' : '') },
        el('div', { class: 'pk-meta' }, el('span', { text: g.state === 'pre' ? t : g.status || (g.done ? 'Final' : 'Live') }), x.line && !g.done ? el('span', { text: `${x.line}${x.total ? ` · O/U ${f1(x.total)}` : ''}` }) : null),
        el('div', { class: 'pk-teams' }, side(g.away), el('span', { class: 'pk-at', text: '@' }), side(g.home)),
        x.a.win != null && !g.done ? el('div', { class: 'pk-odds', title: 'Chance to win from the Vegas moneyline' },
          el('span', { class: 'pk-oa', text: `${x.a.win}%` }),
          el('div', { class: 'pk-obar' }, el('i', { style: `width:${x.a.win}%` })),
          el('span', { class: 'pk-oh', text: `${x.h.win}%` })) : null,
        pkMoney(g, my), split, pkDetails(g, x, my));
    };
    const pkMoney = (g, my) => {
      if (!my || !PK.stake) return null;
      const ml = g.ml ? (my === g.home.abbr ? g.ml.h : g.ml.a) : null, stake = PK.stake, win = mlWin(ml, stake);
      const odds = ml == null ? 'even money' : `${mlTxt(ml)}${g.ml && g.ml.est ? ' (from the spread)' : ''}`;
      const txt = !g.winner ? `💵 ${usd(stake)} on ${my} at ${odds}: ${my} wins → +${usd(win)} · loses → −${usd(stake)}`
        : g.winner === 'TIE' ? '💵 Tie: money back' : g.winner === my ? `💵 ${my} won: +${usd(win)}` : `💵 ${my} lost: −${usd(stake)}`;
      return el('div', { class: 'pk-money' + (g.winner && g.winner !== 'TIE' ? (g.winner === my ? ' up' : ' down') : ''), text: txt });
    };
    const pkDetails = (g, x, my) => {
      const isOpen = pkOpen.has(g.id);
      const btn = el('button', { class: 'linkbtn pk-more', type: 'button', 'aria-expanded': String(isOpen), text: isOpen ? 'Hide details ▴' : `Details ▾${x.players.length ? ` · ${x.players.filter((p) => p.starter).length} league starters` : ''}` });
      btn.addEventListener('click', () => { if (pkOpen.has(g.id)) pkOpen.delete(g.id); else pkOpen.add(g.id); renderPickem(); });
      if (!isOpen) return btn;
      const row = (lab, fa, fh, best) => { const va = fa(x.a), vh = fh ? fh(x.h) : fa(x.h); if (va == null && vh == null) return null; const b = best && va != null && vh != null && va !== vh ? (best(va, vh) ? 'a' : 'h') : ''; return el('tr', {}, el('td', { class: 'pk-dl', text: lab }), el('td', { class: b === 'a' ? 'good' : '', text: va == null ? '–' : String(fmtv(lab, va)) }), el('td', { class: b === 'h' ? 'good' : '', text: vh == null ? '–' : String(fmtv(lab, vh)) })); };
      const fmtv = (lab, v) => (typeof v === 'number' ? (lab.includes('win') ? v + '%' : f1(v)) : v);
      const tbl = el('table', { class: 'pk-dt' }, el('thead', {}, el('tr', {}, el('th', {}), el('th', { text: x.a.abbr }), el('th', { text: x.h.abbr }))),
        el('tbody', {}, row('Record', (s) => s.rec), g.ml ? row('Moneyline', (s) => mlTxt(s.abbr === g.home.abbr ? g.ml.h : g.ml.a)) : null, row('Chance to win', (s) => s.win, null, (a, h) => a > h), row('Vegas projected score', (s) => s.implied, null, (a, h) => a > h),
          row('Points per game', (s) => s.ppg, null, (a, h) => a > h), row('Points allowed per game', (s) => s.papg, null, (a, h) => a < h)));
      const n = x.n, wx = n ? wxText(n) : null;
      const facts = el('p', { class: 'note pk-facts', text: [x.line ? `Spread ${x.line}` : null, x.total ? `over/under ${f1(x.total)}` : null, wx && wx !== '–' ? `weather ${wx}` : null, g.venue || n?.venue || null].filter(Boolean).join(' · ') });
      const pl = x.players.length ? el('div', { class: 'pk-pl' }, el('div', { class: 'pk-plh', text: `Our league’s players in this game (Week ${PK.wk} projections)` }),
        ...x.players.map((p) => el('div', { class: 'pk-pr' + (p.tid === ME ? ' me' : '') + (p.starter ? '' : ' bench') },
          el('span', { class: pcls(p.pos), text: p.pos }), el('span', { class: 'pk-pn' }, el('b', { text: p.name }), el('small', { text: `${p.nfl} · ${tm(p.tid).owner}${p.starter ? '' : ' · bench'}${p.inj ? ' · ' + p.inj : ''}` })),
          el('span', { class: 'pk-pp', text: g.state === 'pre' ? f1(p.proj) : '' }))))
        : (PK.wk === D.league.week ? el('p', { class: 'note', text: 'Nobody in our league has a player in this game.' }) : null);
      return el('div', { class: 'pk-det' }, btn, tbl, facts, pl);
    };
    const body = games.length ? groups.flatMap(([d, gs]) => [el('h3', { class: 'pk-day', text: d }), ...gs.map(card)]) : [el('div', { class: 'card' }, el('p', { class: 'note', text: 'No NFL games found for this week.' }))];
    // leaderboard
    const rows = pkBoard === 'money' ? [...((PK.board && PK.board.season) || [])].sort((a, b) => (b.m || 0) - (a.m || 0)) : (PK.board && PK.board[pkBoard]) || [];
    const segb = (k, lab) => { const b = el('button', { 'aria-pressed': String(pkBoard === k), text: lab }); b.addEventListener('click', () => { pkBoard = k; renderPickem(); }); return b; };
    const lb = el('div', { class: 'card pk-lb' },
      el('div', { class: 'row-head' }, el('h3', { text: 'Pick’em standings' }), el('div', { class: 'seg' }, segb('week', `Week ${wk}`), segb('season', 'Season'), segb('money', '💰 $'))),
      rows.length ? el('ul', { class: 'lb' }, ...rows.filter((r) => T[r.id]).map((r, i) => el('li', { class: r.id === ME ? 'me' : '' },
        el('span', { class: 'lb-r', text: i === 0 && r.c ? '👑' : String(i + 1) }),
        el('span', { class: 'lb-n' }, el('b', { text: T[r.id].owner }), el('small', { text: T[r.id].name })),
        el('span', { class: 'lb-s' }, el('b', { class: pkBoard === 'money' ? ((r.m || 0) >= 0 ? 'up' : 'down') : '', text: pkBoard === 'money' ? usd(r.m || 0, true) : `${r.c}-${r.n - r.c}` })),
        el('span', { class: 'lb-d', title: r.pot ? `If every pick still in play wins: ${usd((r.m || 0) + r.pot, true)}${r.id === ME ? '' : ' (counting only games that have kicked off; picks stay secret until then)'}` : null },
          el('span', { text: pkBoard === 'money' ? `${r.c}-${r.n - r.c}` : pkBoard === 'season' ? `${r.wk} wk${r.wk === 1 ? '' : 's'} · ${usd(r.m || 0, true)}` : `${r.made} picked · ${usd(r.m || 0, true)}` }),
          r.pot ? el('small', { class: 'lb-pot', text: `max ${usd((r.m || 0) + r.pot, true)}` }) : null))))
        : el('p', { class: 'note', text: pkBoard === 'week' ? 'Nobody has picked yet this week. Be first.' : 'No picks yet this season.' }),
      rows.some((r) => r.pot) ? el('p', { class: 'note lb-potnote', text: 'Max = money if every pick still in play wins. For other people it only counts games that have kicked off, since picks stay secret until then.' }) : null);
    let bar = null;
    if (nDraft) {
      const go = el('button', { class: 'btn big pk-lockbtn' + (pkConfirm ? ' confirm' : ''), type: 'button', text: pkBusy ? 'Locking in…' : pkConfirm ? `Tap again to lock ${nDraft} pick${nDraft === 1 ? '' : 's'} for good` : `🔒 Lock in ${nDraft} pick${nDraft === 1 ? '' : 's'}` });
      go.addEventListener('click', lockIn);
      bar = el('div', { class: 'pk-bar' }, el('small', { text: openLeft ? `${openLeft} open game${openLeft === 1 ? '' : 's'} not picked yet. You can lock these now and the rest later.` : 'Locked picks can’t be changed.' }), go);
    }
    host.replaceChildren(...[head, ...body, lb, bar].filter(Boolean));
  }


  // ---------- PLAY: the Dump Log ----------
  let POOP = null, poopAt = 0, poopRange = store.get('poop-range') || 'today', poopMsg = '';
  async function loadPoop(force) {
    if (!force && POOP && Date.now() - poopAt < 30000) return;
    try { POOP = await getJSON('/api/poop'); poopAt = Date.now(); } catch { POOP = { ready: false, log: [] }; }
    if (tab === 'play' && playGame === 'poop') renderPoop();
    if (!$('#welcome').hidden) renderWelcome();
  }
  async function sendPoop(action) {
    try {
      const r = await fetch('/api/poop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: ME, action, token: pinTok() }) });
      const j = await r.json(); if (pinFail(j)) return; if (j && j.log) { POOP = j; poopAt = Date.now(); }
      if (!r.ok && j.error) poopMsg = j.error;
    } catch { poopMsg = 'Couldn’t reach the server. Try again.'; }
    renderPoop();
    if (!$('#welcome').hidden) renderWelcome();
  }
  const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function renderPoop() {
    const host = $('#play-poop');
    if (!POOP) { host.replaceChildren(el('p', { class: 'note', text: 'Loading the log…' })); loadPoop(); return; }
    loadPoop();
    if (!POOP.ready) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note', text: 'The Dump Log needs the league database, which isn’t reachable right now.' }))); return; }
    const log = POOP.log.filter((e) => T[e.t]);
    const now = Date.now(), today = dayKey(now);
    const weekStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })(); // Monday
    const inRange = (e) => (poopRange === 'today' ? dayKey(e.at) === today : poopRange === 'week' ? e.at >= weekStart : true);
    const mineToday = log.filter((e) => e.t === ME && dayKey(e.at) === today);
    const myLast = log.find((e) => e.t === ME);
    // the button
    const btn = el('button', { class: 'poop-btn', type: 'button' }, el('span', { class: 'pe', text: '💩' }), el('span', { text: 'I just pooped' }));
    btn.addEventListener('click', () => {
      btn.disabled = true; poopMsg = '';
      const burst = el('div', { class: 'poop-burst' }, ...Array.from({ length: 14 }, (_, i) => el('span', { style: `--a:${i * 26}deg;--d:${60 + (i % 3) * 22}px`, text: '💩' })));
      btn.append(burst); setTimeout(() => sendPoop('log'), 650);
    });
    const undo = myLast && now - myLast.at < 10 * 60000 ? el('button', { class: 'linkbtn', type: 'button', text: 'Undo my last one' }) : null;
    if (undo) undo.addEventListener('click', () => { poopMsg = 'Undone. We’ll pretend that didn’t happen.'; sendPoop('undo'); });
    const status = myLast ? `${T[ME].owner}, you’re at ${mineToday.length} today. Last one: ${hhmm(myLast.at)}${dayKey(myLast.at) === today ? '' : ' (' + new Date(myLast.at).toLocaleDateString([], { weekday: 'short' }) + ')'}.` : `${T[ME].owner}, you haven’t logged one yet. Get on the board.`;
    // leaderboard for the chosen range
    const counts = {}; for (const e of log) if (inRange(e)) counts[e.t] = (counts[e.t] || 0) + 1;
    const board = Object.entries(counts).map(([t, n]) => ({ t: Number(t), n })).sort((a, b) => b.n - a.n);
    const seg = el('div', { class: 'seg' }, ...[['today', 'Today'], ['week', 'This week'], ['all', 'All time']].map(([k, lab]) => {
      const b = el('button', { 'aria-pressed': String(k === poopRange), text: lab }); b.addEventListener('click', () => { poopRange = k; store.set('poop-range', k); renderPoop(); }); return b;
    }));
    const crowns = ['👑', '🥈', '🥉'];
    const lb = board.length ? el('ol', { class: 'lb poop-lb' }, ...board.map((r, i) => el('li', { class: r.t === ME ? 'me' : '' },
      el('span', { class: 'lb-r', text: crowns[i] || String(i + 1) }),
      el('span', { class: 'lb-n' }, el('b', { text: T[r.t].owner }), el('small', { text: '💩'.repeat(Math.min(r.n, 12)) + (r.n > 12 ? ' …' : '') })),
      el('span', { class: 'lb-s' }, el('b', { text: String(r.n) })), el('span'))))
      : el('p', { class: 'note', text: poopRange === 'today' ? 'Nobody has logged one today. Somebody’s holding out.' : 'Nothing logged yet.' });
    // fun stats (all time)
    const byT = {}; for (const e of log) (byT[e.t] ||= []).push(e.at);
    const facts = [];
    const days = (arr) => new Set(arr.map(dayKey)).size;
    if (log.length) {
      const mins = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
      const early = [...log].sort((a, b) => mins(a.at) - mins(b.at))[0], late = [...log].sort((a, b) => mins(b.at) - mins(a.at))[0];
      facts.push(['🌅 Early bird', `${T[early.t].owner} at ${hhmm(early.at)}`]);
      facts.push(['🦉 Night owl', `${T[late.t].owner} at ${hhmm(late.at)}`]);
      const perDay = {}; for (const e of log) { const k = e.t + '|' + dayKey(e.at); perDay[k] = (perDay[k] || 0) + 1; }
      const [bk, bn] = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];
      facts.push(['🏆 Most in one day', `${T[Number(bk.split('|')[0])].owner}, ${bn}`]);
      const avg = Object.entries(byT).map(([t, a]) => ({ t: Number(t), v: a.length / Math.max(1, days(a)) })).sort((a, b) => b.v - a.v)[0];
      facts.push(['📈 Highest daily average', `${T[avg.t].owner}, ${avg.v.toFixed(1)}/day`]);
      const drought = Object.entries(byT).map(([t, a]) => ({ t: Number(t), since: now - Math.max(...a) })).sort((a, b) => b.since - a.since)[0];
      if (drought && drought.since > 6 * 3600000) facts.push(['🏜️ Longest drought', `${T[drought.t].owner}, ${Math.floor(drought.since / 3600000)} hours and counting`]);
      const silent = D.teams.filter((x) => !byT[x.id]).map((x) => x.owner);
      if (silent.length) facts.push(['🤐 Hasn’t logged one', silent.join(', ')]);
    }
    // rush hour chart
    const hours = new Array(24).fill(0); for (const e of log) hours[new Date(e.at).getHours()]++;
    const maxH = Math.max(1, ...hours);
    const chart = el('div', { class: 'poop-hours' }, ...hours.map((n, h) => el('div', { class: 'ph', title: `${n} at ${h % 12 || 12}${h < 12 ? 'am' : 'pm'}` },
      el('i', { style: `height:${Math.round(100 * n / maxH)}%` }), el('small', { text: h % 6 === 0 ? `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` : '' }))));
    const peak = hours.indexOf(maxH);
    // today's feed
    const feed = log.filter((e) => dayKey(e.at) === today).slice(0, 20);
    host.replaceChildren(
      el('div', { class: 'card poop-main' },
        el('h2', { text: 'The Dump Log' }),
        el('p', { class: 'note', text: 'Tap when you go. The league is watching.' }),
        btn, el('p', { class: 'poop-status', text: poopMsg || status }), undo),
      el('div', { class: 'card' }, el('div', { class: 'row-head' }, el('h3', { text: 'Leaderboard' }), seg), lb),
      el('div', { class: 'grid' },
        el('div', { class: 'card' }, el('h3', { text: 'Today’s feed' }), feed.length ? el('div', { class: 'poop-feed' }, ...feed.map((e) => el('div', { class: e.t === ME ? 'me' : '' }, el('span', { text: '💩' }), el('b', { text: T[e.t].owner }), el('span', { class: 'muted', text: hhmm(e.at) })))) : el('p', { class: 'note', text: 'Quiet so far today.' })),
        el('div', { class: 'card' }, el('h3', { text: 'Rush hour' }), el('p', { class: 'note', text: log.length ? `League-wide, the busiest hour is ${peak % 12 || 12}${peak < 12 ? ' AM' : ' PM'}.` : 'Every log by hour of day.' }), chart)),
      facts.length ? el('div', { class: 'card' }, el('h3', { text: 'Bathroom awards' }), el('div', { class: 'poop-facts' }, ...facts.map(([a, b]) => el('div', {}, el('small', { text: a }), el('b', { text: b }))))) : null);
    poopMsg = '';
  }


  // ---------- welcome sheet: only on the first open of the day, before you start using the app ----------
  // It never interrupts: if you've already tapped, scrolled or switched tabs by the time the data
  // loads, or you opened a link to a specific tab, it stays away (and tries again next fresh open).
  let welcomeData = null, touched = false;
  const forced = location.hash.includes('welcome');
  const deepLinked = !!location.hash && !forced && location.hash !== '#team'; // #team is the home-screen app's normal start
  ['pointerdown', 'keydown', 'wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { touched = true; }, { once: true, passive: true, capture: true }));
  function maybeWelcome() {
    if (!D || !LIVE || welcomeData === 'done') return;
    welcomeData = 'done'; // at most once per open; returning to the app later never brings it back
    const today = dayKey(Date.now());
    if (ME && !forced) { // first-timers still get it, since that's where they pick who they are
      if (store.get('welcome-off') === '1' || store.get('welcome-day') === today || touched || deepLinked) return;
    }
    store.set('welcome-day', today);
    $('#welcome').hidden = false; document.body.classList.add('noscroll');
    loadPoop(); renderWelcome();
  }
  function notYou() {
    const b = el('button', { class: 'linkbtn', type: 'button', text: `Not ${T[ME].owner}?` });
    b.addEventListener('click', () => { ME = null; store.set('me', ''); renderWelcome(); });
    return b;
  }
  function closeWelcome() { $('#welcome').hidden = true; document.body.classList.remove('noscroll'); }
  function renderWelcome() {
    const host = $('#welcome');
    const hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const me = ME && T[ME];
    if (!me) { // first open on this device: ask who this is
      const x0 = el('button', { class: 'install-x wl-x', type: 'button', 'aria-label': 'Close', text: '✕' }); x0.addEventListener('click', closeWelcome);
      host.onclick = (e) => { if (e.target === host) closeWelcome(); };
      host.replaceChildren(el('div', { class: 'wl-card' }, x0, el('div', { class: 'wl-hi' }, el('small', { text: 'Welcome to League HQ' }), el('h2', { text: 'Who are you?' })),
        el('p', { class: 'note', text: deepLinked && tab === 'play' && (playGame === 'pick' || playGame === 'pred') ? `Tap your name and you’ll go straight to ${playGame === 'pred' ? 'Predictions' : 'Pick’em'}. This phone will remember you.` : 'This phone will remember. You can still look at anyone’s team from the menu at the top.' }),
        el('div', { class: 'pickgrid wl-pick' }, ...[...D.teams].sort((a, b) => a.owner.localeCompare(b.owner)).map((t) => {
          const b = el('button', { class: 'pickbtn' }, el('b', { text: t.owner }), el('span', { text: t.name }));
          b.addEventListener('click', () => { setMe(t.id); if (deepLinked) closeWelcome(); }); return b;
        }))));
      return;
    }
    // which week to feature: this one once games have started, otherwise last week
    const cur = LIVE.week, started = LIVE.games.some((g) => g.h.pts > 0 || g.a.pts > 0);
    const wk = started ? cur : Math.max(1, cur - 1), data = wk === cur ? LIVE : weekCache[wk];
    if (!data && wk !== cur) getJSON(`/api/live?week=${wk}`).then((j) => { weekCache[j.week] = j; if (!host.hidden) renderWelcome(); }).catch(() => {});
    // my matchup line
    const g = me && LIVE.games.find((x) => x.h.id === ME || x.a.id === ME);
    let mline = null;
    if (g) {
      const mineH = g.h.id === ME, a = mineH ? g.h : g.a, b = mineH ? g.a : g.h, wp = Math.round(100 * (mineH ? g.hwin : 1 - g.hwin));
      mline = el('div', { class: 'wl-match' }, el('div', {}, el('small', { text: `Week ${cur} vs ${tm(b.id).owner}` }), el('b', { text: `${f1(a.pts)} – ${f1(b.pts)}` })), el('div', { class: 'wl-wp ' + (wp >= 50 ? 'up' : 'down'), text: `${wp}% to win` }));
    }
    // top performer at each position
    const played = (r) => r.state !== 'pre' && r.state !== 'bye';
    const all = []; if (data) for (const gm of data.games) for (const sd of [gm.h, gm.a]) for (const r of sd.rows) all.push({ ...r, tid: sd.id });
    const tops = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map((pos) => all.filter((r) => r.pos === pos && played(r)).sort((x, y) => y.pts - x.pts)[0]).filter(Boolean);
    const topsEl = data ? (tops.length ? el('div', { class: 'wl-tops' }, ...tops.map((r) => el('div', { class: 'wl-top' + (r.tid === ME ? ' me' : '') },
      el('span', { class: pcls(r.pos), text: r.pos }), el('span', { class: 'wl-nm' }, el('b', { text: r.name }), el('small', { text: tm(r.tid).owner })), el('span', { class: 'wl-pts', text: f1(r.pts) }))))
      : el('p', { class: 'note', text: 'No games played yet.' })) : el('p', { class: 'note', text: 'Loading…' });
    // Dump Log
    let poopEl;
    if (!me) poopEl = el('p', { class: 'note', text: 'Pick your ME at the top to join the Dump Log.' });
    else if (!POOP || !POOP.ready) poopEl = el('p', { class: 'note', text: POOP ? 'Dump Log unavailable right now.' : 'Loading…' });
    else {
      const today = dayKey(Date.now()), todays = POOP.log.filter((e) => T[e.t] && dayKey(e.at) === today);
      const counts = {}; for (const e of todays) counts[e.t] = (counts[e.t] || 0) + 1;
      const board = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 3);
      const mine = counts[ME] || 0;
      const btn = el('button', { class: 'wl-poop', type: 'button' }, '💩 I just pooped');
      btn.addEventListener('click', () => { btn.disabled = true; btn.textContent = '💩 Logged!'; sendPoop('log'); });
      poopEl = el('div', { class: 'wl-poopbox' }, btn,
        el('p', { class: 'note', text: mine ? `You're at ${mine} today.` : 'You haven’t logged one today.' }),
        board.length ? el('div', { class: 'wl-pb' }, ...board.map(([t, n], i) => el('span', {}, `${['👑', '🥈', '🥉'][i]} ${T[t].owner} ${n}`))) : el('p', { class: 'note', text: 'Nobody has logged one today. Be first.' }),
        poopMsg ? el('p', { class: 'pin-err', text: poopMsg }) : null);
    }
    const go = el('button', { class: 'btn big', type: 'button', text: 'Let’s go' });
    go.addEventListener('click', closeWelcome);
    const off = el('button', { class: 'linkbtn wl-off', type: 'button', text: 'Don’t show this anymore' });
    off.addEventListener('click', () => { store.set('welcome-off', '1'); closeWelcome(); });
    const x = el('button', { class: 'install-x wl-x', type: 'button', 'aria-label': 'Close', text: '✕' });
    x.addEventListener('click', closeWelcome);
    host.onclick = (e) => { if (e.target === host) closeWelcome(); };
    host.replaceChildren(el('div', { class: 'wl-card' }, x,
      el('div', { class: 'wl-hi' }, el('small', { text: new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) }), el('h2', { text: `${hi}, ${me.owner}` }), notYou()),
      mline,
      el('h3', { text: `Top performers · Week ${wk}${wk === cur && LIVE.anyLive ? ' (live)' : ''}` }), topsEl,
      el('h3', { text: '💩 Dump Log' }), poopEl,
      go, off));
  }
  function openWelcome() { store.set('welcome-off', ''); welcomeData = null; $('#welcome').hidden = false; document.body.classList.add('noscroll'); welcomeData = 'done'; loadPoop(); renderWelcome(); }


  // ---------- TRASH TALK ----------
  let TALK = null, talkAt = 0, talkTimer = null, talkMsg = '', talkDraft = { text: '', gif: '', target: null, anon: false };
  const myAnon = () => { try { return JSON.parse(store.get('talk-anon-mine') || '[]'); } catch { return []; } };
  const TALK_EMOJI = ['🔥', '😂', '💀', '🤡', '💩', '🗑️'];
  async function loadTalk(force) {
    if (!force && TALK && Date.now() - talkAt < 15000) return;
    try { TALK = await getJSON('/api/talk'); talkAt = Date.now(); } catch { TALK = TALK || { ready: false, msgs: [] }; }
    const newest = TALK.msgs && TALK.msgs[0] ? TALK.msgs[0].at : 0, seen = Number(store.get('talk-seen')) || 0;
    $('#talk-dot').hidden = !(newest > seen && tab !== 'talk' && TALK.msgs[0].t !== ME && !myAnon().includes(TALK.msgs[0].id));
    if (tab === 'talk') { store.set('talk-seen', String(newest)); if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.tk-rbox'))) renderTalkFeed(); } // don't yank the keyboard mid-reply
  }
  async function talkPost(body) {
    try {
      if (body.action === 'post') { body.who = T[ME] ? T[ME].owner : ''; body.mentions = mentionIds(body.text || ''); }
      const r = await fetch('/api/talk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: ME, ...body }) });
      const j = await r.json(); if (j.msgs) { TALK = j; talkAt = Date.now(); }
      talkMsg = r.ok ? '' : (j.error || 'That didn’t post.');
      return r.ok;
    } catch { talkMsg = 'Couldn’t reach the server.'; return false; }
  }
  // the roast generator: absurd, stat-powered, R-rated
  // ---- roast generator: every line is built from the target's real numbers ----
  function roastFacts(tid) {
    const t = T[tid]; const teams = D.teams;
    const wk = (t.weeks || []).filter((w) => w.pts != null);
    const by = (k, dir = -1) => [...teams].sort((a, b) => dir * (a[k] - b[k])).findIndex((x) => x.id === tid) + 1;
    const worst = wk.length ? wk.reduce((m, w) => (w.pts < m.pts ? w : m)) : null;
    const best = wk.length ? wk.reduce((m, w) => (w.pts > m.pts ? w : m)) : null;
    const last = wk[wk.length - 1] || null;
    const own = (id) => (T[id] ? T[id].owner : 'some scrub');
    const recs = (D.records || []).filter((r) => r.owner === t.owner);
    const card = t.card || (D.cards || []).find((c) => c.id === tid) || {};
    const at = (D.alltime || []).find((x) => x.id === tid);
    const car = ((D.history && D.history.career) || []).find((x) => x.id === tid);
    const titles = at && at.titles ? at.titles : [];
    const bk = LB && LB.boards ? ['extreme', 'hard', 'pro', 'rookie'].map((l) => ({ l, r: (LB.boards[`bk:${l}`] || []).find((x) => x.id === tid) })).find((x) => x.r) : null;
    const poops = POOP && POOP.log ? POOP.log.filter((e) => e.t === tid).length : 0;
    const g = LIVE && LIVE.games && LIVE.games.find((x) => (x.h.id === tid || x.a.id === tid) && (x.h.id === ME || x.a.id === ME));
    // bench guys going off: live this week, all season, and points left on the bench last week
    const lg = LIVE && LIVE.games && LIVE.games.map((x) => (x.h.id === tid ? x.h : x.a.id === tid ? x.a : null)).find(Boolean);
    let benchLive = null;
    if (lg && lg.bench) {
      for (const bp of lg.bench) {
        if (!(bp.pts >= 12)) continue;
        const st = (lg.rows || []).filter((r) => r.pos === bp.pos && r.state !== 'pre' && r.pts < bp.pts).sort((a, b) => a.pts - b.pts)[0];
        if (st && (!benchLive || bp.pts - st.pts > benchLive.diff)) benchLive = { b: bp, s: st, diff: bp.pts - st.pts, wk: LIVE.week };
      }
    }
    let benchSeason = null;
    const ros = (D.rosters && D.rosters[tid]) || [];
    for (const bp of ros.filter((r) => r.slot === 'BN' && !r.inj && !r.bye && r.avg)) {
      const st = ros.filter((r) => r.starter && r.pos === bp.pos && r.avg && r.avg + 3 <= bp.avg).sort((a, b) => a.avg - b.avg)[0];
      if (st && (!benchSeason || bp.avg - st.avg > benchSeason.diff)) benchSeason = { b: bp, s: st, diff: bp.avg - st.avg };
    }
    const lostLast = last && last.opt ? last.opt - last.pts : 0;
    const margins = wk.map((w) => ({ ...w, m: w.pts - w.opp_pts }));
    const closeWins = margins.filter((w) => w.m > 0 && w.m < 5);
    const skinniest = closeWins.sort((a, b) => a.m - b.m)[0] || null;
    const beatdown = margins.filter((w) => w.m <= -20).sort((a, b) => a.m - b.m)[0] || null;
    const lostFinal = (D.champs || []).filter((c) => c.runner_up === t.owner);
    const benchRank = by('bench_lost');
    const she = /^(darla|jacky)\b/i.test(t.owner);
    // more ammo: pick'em, trades, drops, draft busts, history vs the roaster, injured starters, the app itself
    const pkS = PKR && PKR.board && (PKR.board.season || []).find((r) => r.id === tid);
    const pkRank = pkS ? (PKR.board.season || []).filter((r) => r.n >= 3).findIndex((r) => r.id === tid) + 1 : 0;
    const lostTrade = (D.trades || []).filter((x) => x.winner != null && x.winner !== tid && (x.a.id === tid || x.b.id === tid)).map((x) => { const me = x.a.id === tid ? x.a : x.b, them = x.a.id === tid ? x.b : x.a; return { wk: x.wk, got: me.gets, gave: them.gets, gotPts: me.pts, gavePts: them.pts, with: own(them.id) }; }).sort((a, b) => (b.gavePts - b.gotPts) - (a.gavePts - a.gotPts))[0] || null;
    const dropped = (D.drops || []).filter((x) => x.id === tid && x.pts >= 25)[0] || null;
    const bust = (D.draft || []).filter((x) => x.id === tid && x.rd <= 3 && x.swing <= -10).sort((a, b) => a.swing - b.swing)[0] || null;
    const meO = T[ME] ? T[ME].owner : null;
    const h2hG = meO && tid !== ME ? ((D.history && D.history.rivalry) || []).filter((r) => (r.a === meO && r.b === t.owner) || (r.b === meO && r.a === t.owner)) : [];
    const h2hW = h2hG.filter((r) => (r.a === meO ? r.ap > r.bp : r.bp > r.ap)).length;
    const hurt = ((D.rosters && D.rosters[tid]) || []).filter((r) => r.starter && /^(OUT|INJURY_RESERVE|IR|SUSPENSION)$/i.test(r.inj || '') && !r.bye);
    const mine2 = (TALK && TALK.msgs || []).filter((m) => m.t === tid);
    const clowns = mine2.reduce((n, m) => n + ((m.re && m.re['🤡']) || []).length, 0);
    const poopLog = POOP && POOP.log ? POOP.log.filter((e) => e.t === tid) : [];
    const latePoops = poopLog.filter((e) => { const h = new Date(e.at).getHours(); return h >= 0 && h < 5; }).length;
    // this week's matchup (current week only)
    let wkg = null;
    const cg = LIVE && LIVE.games && LIVE.week === LIVE.current && LIVE.games.find((x) => x.h.id === tid || x.a.id === tid);
    if (cg) {
      const home = cg.h.id === tid, me = home ? cg.h : cg.a, op = home ? cg.a : cg.h;
      const rows = me.rows || [];
      const started = [...rows, ...(op.rows || [])].some((r) => r.state && r.state !== 'pre');
      const dud = rows.filter((r) => r.state === 'post' && r.pos !== 'K' && r.proj >= 8 && r.pts < r.proj * 0.4).sort((a, b) => (a.pts - a.proj) - (b.pts - b.proj))[0] || null;
      const zero = rows.find((r) => r.state === 'pre' && r.slot !== 'BN' && r.slot !== 'IR' && !(r.proj > 0.5)) || null;
      const exps = LIVE.games.flatMap((x) => [x.h.exp, x.a.exp]).sort((a, b) => b - a);
      wkg = { wk: LIVE.week, opp: op.id, oppO: own(op.id), oppPlace: T[op.id] ? ord(T[op.id].seed || 0) : '', pts: me.pts, oppPts: op.pts, exp: me.exp, oppExp: op.exp,
        wp: Math.round(100 * (home ? cg.hwin : 1 - cg.hwin)), lead: me.pts - op.pts, ytp: me.yetToPlay, started, done: cg.done, dud, zero, expRank: exps.indexOf(me.exp) + 1, vsMe: op.id === ME };
    }
    // league context: average, the best other team, current streak
    const lgAvg = teams.reduce((x, y) => x + Number(y.avg || 0), 0) / Math.max(1, teams.length);
    const ldr = [...teams].filter((x) => x.id !== tid).sort((a, b) => (a.seed || 99) - (b.seed || 99))[0];
    const ordered = [...wk].filter((w) => w.opp_pts != null).sort((a, b) => a.wk - b.wk);
    let streak = null;
    for (let i = ordered.length - 1; i >= 0; i--) { const won = ordered[i].pts > ordered[i].opp_pts; if (!streak) streak = { won, n: 1 }; else if (streak.won === won) streak.n++; else break; }
    return {
      weeks: wk, lgAvg, leader: ldr ? ldr.owner : null, leaderGap: ldr ? Number(ldr.avg || 0) - Number(t.avg || 0) : 0, streak,
      he: she ? 'she' : 'he', He: she ? 'She' : 'He', his: she ? 'her' : 'his', him: she ? 'her' : 'him', guy: she ? 'girl' : 'guy',
      ns: t.name + (/s$/i.test(t.name) ? '’' : '’s'),
      pkS, pkRank, lostTrade, dropped, bust, h2hN: h2hG.length, h2hW, hurt, posts: mine2.length, clowns, latePoops, talkReady: !!(TALK && TALK.ready), meO,
      wkg, benchLive, benchSeason, lostLast, closeWins, skinniest, beatdown, lostFinal, benchRank, top3: (t.seed || 9) <= 3 && t.w > t.l,
      o: t.owner, n: t.name, w: t.w, l: t.l, rec: `${t.w}-${t.l}`, winning: t.w > t.l, place: ord(t.seed || by('w')),
      seed: t.seed, pfRank: ord(t.pf_rank || by('pf')), pfRankN: t.pf_rank || by('pf'), pf: f1(t.pf), pa: f1(t.pa), paRank: by('pa'), avg: f1(t.avg),
      po: Math.round(t.playoffs), luck: t.luck, xw: t.exp_w, bench: Math.round(t.bench_lost), eff: f1(t.eff), effRank: by('eff'),
      apw: t.allplay_w, apl: t.allplay_l, worst, best, last, own, recs, card, at, car, titles, bk, poops,
      top: (t.top_players || [])[0], myWp: g ? Math.round(100 * (g.h.id === ME ? g.hwin : 1 - g.hwin)) : null,
      lastLine: last ? `${last.pts > last.opp_pts ? 'beat' : 'lost to'} ${own(last.opp)} ${f1(last.pts)}-${f1(last.opp_pts)} in week ${last.wk}` : '',
    };
  }
  // ammo from the rest of the app: pick'em, trades, drops, draft busts, history vs the roaster, injuries, games, posts
  function extraLines(F) {
    const { o } = F; const L = []; const add = (c, s) => { if (c) L.push(s); };
    const p = F.pkS, nm = (arr) => arr.map((x) => x.name.replace(/\.$/, '')).join(' and ');
    add(p && p.n >= 4 && p.c / p.n < 0.45, p && `${o} is ${p.c}-${p.n - p.c} in Pick'em. A coin flip would be ${Math.round(p.n / 2)}-${p.n - Math.round(p.n / 2)}. The coin is smarter than ${F.him}.`);
    add(p && p.n >= 4 && F.pkRank && F.pkRank >= 7, p && `${o} is ${ord(F.pkRank)} in Pick'em at ${p.c}-${p.n - p.c}. Can't pick ${F.his} own lineup, can't pick NFL games either. Consistent.`);
    add(p && p.n >= 4 && p.c / p.n >= 0.6 && !F.winning, p && `${o} is ${p.c}-${p.n - p.c} picking NFL games and ${F.rec} in fantasy. Knows exactly who's going to win, just never ${F.him}.`);
    add(F.lostTrade, F.lostTrade && `${o} traded ${nm(F.lostTrade.gave)} to ${F.lostTrade.with} for ${nm(F.lostTrade.got)}. Since then: ${f1(F.lostTrade.gavePts)} points for ${F.lostTrade.with}, ${f1(F.lostTrade.gotPts)} for ${o}. Fleeced in broad daylight.`);
    add(F.dropped, F.dropped && `${o} dropped ${F.dropped.name} in week ${F.dropped.wk}. ${F.dropped.name} has put up ${f1(F.dropped.pts)} since, including ${f1(F.dropped.best)} for ${F.own(F.dropped.to)} in week ${F.dropped.best_wk}. Cut him like a genius.`);
    add(F.bust, F.bust && `${o} took ${F.bust.name} in round ${F.bust.rd} as the ${ord(F.bust.pos_pick)} ${F.bust.pos} off the board. He's the ${ord(F.bust.pos_finish)} ${F.bust.pos} in scoring. Draft day hero, Sunday zero.`);
    add(F.h2hN >= 2 && F.h2hW / F.h2hN >= 0.6, `${o}, you're ${F.h2hN - F.h2hW}-${F.h2hW} all-time against me. I own you. Pay rent.`);
    add(F.h2hN >= 2 && F.h2hW / F.h2hN < 0.4, `${o} is ${F.h2hN - F.h2hW}-${F.h2hW} against me all-time and enjoying it. Savor it, ${o}. It's the only winning record you'll ever have.`);
    add(F.hurt.length, F.hurt.length && `${o} is starting ${F.hurt.map((r) => `${r.name} (${r.inj.replace('INJURY_RESERVE', 'IR').toLowerCase()})`).join(' and ')}. That's not a lineup, that's a hospital waiting room.`);
    add(F.bk && F.bk.r.score < 300, F.bk && `${o}'s best Breakaway run is ${F.bk.r.score} yards on ${F.bk.l}. Can't run a fantasy team, can't run a cartoon football either.`);
    add(F.bk && F.bk.r.score >= 300 && !F.winning, F.bk && `${o} has ${F.bk.r.score} yards on Breakaway and ${F.rec} in real fantasy. Putting the hours into the wrong game.`);
    add(F.latePoops >= 2, `${o} has logged ${F.latePoops} 💩 between midnight and 5 a.m. Nobody healthy is doing that. Nobody winning is either.`);
    add(F.talkReady && F.posts === 0, `${o} hasn't said one word in Trash Talk. Lurking like ${F.he} lurks in the standings.`);
    add(F.clowns >= 3, `${o}'s posts have collected ${F.clowns} 🤡 reactions. The league has spoken.`);
    return L.filter(Boolean);
  }
  // this week's matchup: live score, odds, duds and dead spots in the lineup
  function weekLines(F) {
    const g = F.wkg; if (!g) return [];
    const { o } = F; const L = []; const add = (c, s) => { if (c) L.push(s); };
    const sc = `${f1(g.pts)}-${f1(g.oppPts)}`;
    add(g.started && g.lead < 0 && g.ytp > 0 && g.wp < 50, `${o} is down ${f1(-g.lead)} to ${g.oppO} (${sc}) in week ${g.wk}. ${g.wp}% to win. Start writing the excuse now.`);
    add(g.started && g.lead < 0 && g.ytp === 0 && !g.done, `${o} is down ${f1(-g.lead)} to ${g.oppO} with nobody left to play. It's over. Go log a 💩, it's the only thing you'll finish this week.`);
    add(g.done && g.lead < 0, `Final: ${g.oppO} ${f1(g.oppPts)}, ${o} ${f1(g.pts)}. Pack it up, ${F.guy === 'girl' ? 'sweetheart' : 'buddy'}.`);
    add(g.started && g.lead < 0 && g.ytp > 0 && g.wp >= 50, `${o} is trailing ${g.oppO} ${sc} and calling it "part of the plan." ${F.He}'s still ${g.wp}% to win, which says more about ${g.oppO} than ${o}.`);
    add(g.started && g.lead > 0 && g.wp < 55, `${o} is up ${f1(g.lead)} on ${g.oppO} and the odds still only give ${F.him} ${g.wp}%. Even the math knows ${F.he}'ll blow it.`);
    add(!g.vsMe && g.wp < 35, `${o} has a ${g.wp}% chance against ${g.oppO} this week. ESPN looked at that lineup and started laughing.`);
    add(!g.vsMe && g.wp >= 35 && g.wp < 43, `${o} is the underdog against ${g.oppO} this week (${g.wp}%). Fitting. ${F.He}'s been an underdog since birth.`);
    add(!g.vsMe && g.wp > 57 && g.wp <= 65, `${o} is only ${g.wp}% to beat ${g.oppO}. Favored and still sweating through ${F.his} shirt.`);
    add(!g.vsMe && g.wp >= 43 && g.wp <= 57, `${o} vs ${g.oppO} is a coin flip this week (${g.wp}%), and ${o} has never once called heads right.`);
    add(!g.vsMe && g.wp > 65, `${o} is ${g.wp}% to beat ${g.oppO} this week. Beating the ${g.oppPlace} place team isn't a flex, it's a scrimmage.`);
    add(g.vsMe, `${o}, you drew ME this week. ${g.wp}% to win. I'd start praying, but your lineup already is.`);
    add(g.dud, g.dud && `${g.dud.name} gave ${o} ${f1(g.dud.pts)} points this week on a ${f1(g.dud.proj)} projection. ${o} STARTED that. On purpose.`);
    add(g.zero, g.zero && `${o} is starting ${g.zero.name} with a projection of zero. That's not a lineup, that's a cry for help.`);
    add(g.expRank >= 8, `${o}'s lineup projects for ${f1(g.exp)} this week, ${ord(g.expRank)} of 10. Losing before kickoff, impressive.`);
    add(F.benchLive, F.benchLive && `Week ${g.wk} update: ${F.benchLive.b.name} has ${f1(F.benchLive.b.pts)} on ${o}'s BENCH. ${F.benchLive.s.name} has ${f1(F.benchLive.s.pts)} in the lineup. Coach of the year.`);
    return L.filter(Boolean);
  }
  // teams at the top: roast the history, the luck and the choke, not this year's numbers
  function frontrunner(F) {
    const { o, n, rec } = F; const L = [];
    const add = (cond, s) => { if (cond) L.push(s); };
    const c = F.car || {}, at = F.at || {};
    add(!F.titles.length && c.playoffs, `${o} has made the playoffs ${c.playoffs} time${c.playoffs === 1 ? '' : 's'} and won exactly zero titles. ${rec} in October means nothing. Ask ${F.his} empty trophy case.`);
    add(!F.titles.length && !c.playoffs, `${o} is ${rec} and acting brand new. ${F.He}'s never even made the playoffs in this league. Enjoy the view, it's a rental.`);
    add(!F.titles.length, `Nobody gives a shit about ${rec}. ${o}'s ring count: zero. Talk to me in December.`);
    F.lostFinal.slice(0, 1).forEach((cf) => L.push(`${o} lost the ${cf.year} championship ${cf.final.replace('–', '-')} to ${cf.owner}. Regular-season merchant. Choke artist. Same movie, new year.`));
    add(at.w != null && at.l > at.w, `${o} is ${rec} this year and ${at.w}-${at.l} all-time. One hot October doesn't erase a career of absolute dogshit.`);
    add(c.avg_finish >= 5, `${o}'s average finish in this league is ${ord(Math.round(c.avg_finish))}. ${F.He}'s not a contender, ${F.he}'s a regression waiting to happen.`);
    add(F.skinniest, F.skinniest && `${o} beat ${F.own(F.skinniest.opp)} by ${f1(F.skinniest.m)} in week ${F.skinniest.wk}. That's not a win, that's a clerical error.`);
    add(F.closeWins.length >= 2, `${o} has won ${F.closeWins.length} games by less than 5 points. That's not dominance, that's a coin that keeps landing on its edge.`);
    add(F.beatdown, F.beatdown && `Remember week ${F.beatdown.wk}? ${F.own(F.beatdown.opp)} beat ${o} by ${f1(-F.beatdown.m)}. Bring it up every time ${F.he} starts running ${F.his} mouth.`);
    add(F.luck > 0.3, `${o} is ${rec} with ${F.xw} expected wins. Lucky ${F.he === 'she' ? 'bitch' : 'son of a bitch'}, and the luck runs out in December.`);
    add(F.top && F.top.share > 12, F.top && `${o}'s whole season is ${F.top.name} (${f1(F.top.share)}% of ${F.his} points). One tweaked hamstring and ${n} is a ${F.place === '1st' ? 'first-round exit' : 'punchline'}.`);
    add(true, `Every year somebody peaks in October and gets bounced in round one. ${o}, ${rec}, this is your official notice.`);
    add(F.myWp != null, `${o}, I'm ${F.myWp}% to beat your ass this week, and I'm sending you back to earth.`);
    add(F.benchLive, F.benchLive && `${o} is ${rec} and STILL has ${F.benchLive.b.name} (${f1(F.benchLive.b.pts)}) rotting on the bench behind ${F.benchLive.s.name} (${f1(F.benchLive.s.pts)}). Lucky, not good.`);
    return L.filter(Boolean);
  }
  const aNum = (x) => { const t = f1(x); return (/^(8|11\.|18\.)/.test(t) ? 'an ' : 'a ') + t; };
  const an = (g) => (/^[AEF]/.test(g) ? 'an ' : 'a ') + g;
  function roastLines(F) {
    const { o, n, rec } = F; const L = [];
    if (F.top3) return [...frontrunner(F), ...extraLines(F)];
    const add = (cond, s) => { if (cond) L.push(s); };
    const gr = (k) => (F.card[k] && F.card[k].g) || '?';
    const bl = F.benchLive, bs = F.benchSeason;
    add(bl, bl && `${o} has ${bl.b.name} going for ${f1(bl.b.pts)} on ${F.his} BENCH while ${F.he} starts ${bl.s.name} with ${f1(bl.s.pts)}. Genius. Absolute fucking genius.`);
    add(bl, bl && `Breaking: ${bl.b.name} just put up ${f1(bl.b.pts)} for ${o}'s bench. ${bl.s.name} (${f1(bl.s.pts)}) would like to thank ${o} for the start.`);
    add(bs, bs && `${o} is benching ${bs.b.name} (${f1(bs.b.avg)} a game) to start ${bs.s.name} (${f1(bs.s.avg)}). Bold. Stupid, but bold.`);
    add(bs, bs && `${bs.b.name} averages ${f1(bs.b.avg)} and lives on ${F.ns} bench. That's a waste of talent, like ${o} owning a fantasy team.`);
    add(F.lostLast >= 15, F.last && `${o} left ${f1(F.lostLast)} points on ${F.his} bench in week ${F.last.wk}. Coach of the year, if the year is a dumpster fire.`);
    add(!F.winning, `${o} is ${rec}, ${F.place} place and ${F.pfRank} in points. That's not a slump, that's a lifestyle.`);
    add(F.winning, `${o} is ${rec} with ${F.xw} "expected" wins. ${F.He}'s not good, ${F.he}'s a horseshoe-up-the-ass lucky ${F.he === 'she' ? 'witch' : 'son of a bitch'}.`);
    add(F.worst, F.worst && `${o} dropped ${aNum(F.worst.pts)} in week ${F.worst.wk}. ${F.own(F.worst.opp)} didn't beat ${F.him}, ${F.he} got a forfeit with extra steps.`);
    add(F.last && F.last.pts < F.last.opp_pts, F.last && `${o} ${F.lastLine}. Somebody check on ${F.him}, ${F.he}'s been staring at the box score since Monday.`);
    add(F.last && F.last.pts > F.last.opp_pts, F.last && `${o} ${F.lastLine} and won't shut the fuck up about it. Even a broken clock, bitch.`);
    add(F.benchRank <= 5, `${o} has left ${F.bench} points on ${F.his} bench this season. That's not a lineup, that's a fucking hostage situation.`);
    add(F.effRank >= 6, `${o} starts ${F.eff}% of ${F.his} best possible lineup. ${ord(F.effRank)} in the league. A golden retriever picking names out of a hat does better.`);
    add(F.po < 50, `Vegas gives ${o} a ${F.po}% shot at the playoffs. Vegas also takes bets on a seagull winning the Kentucky Derby, and I like the seagull.`);
    add(F.po >= 50, `${o} has ${F.po}% playoff odds and thinks ${F.he}'s safe. Same thing the Titanic said, you overconfident dipshit.`);
    add(F.apl > F.apw, `If ${o} played everyone every week ${F.he}'d be ${F.apw}-${F.apl}. The schedule isn't the problem, ${o}. You are.`);
    add(F.card.gpa != null && F.card.rank >= 5, `${o}'s report card: draft ${gr('draft')}, waivers ${gr('wire')}, lineups ${gr('lineup')}. Mom's not putting that one on the fridge.`);
    add(F.top && F.top.share > 13, F.top && `${F.top.name} is ${f1(F.top.share)}% of ${F.ns} points. Without ${F.top.pos === 'D/ST' ? 'them' : 'him'}, ${o} is just a ${F.guy} paying league dues for the group chat.`);
    add(F.car && !F.titles.length, F.at && `${o}: ${F.at.w}-${F.at.l} all-time, zero rings. A legacy of absolutely fucking nothing.`);
    add(F.titles.length, `${o} won one title in ${F.titles[0]} and has been riding it like a washed-up high school QB ever since. ${rec} now, champ.`);
    F.recs.filter((r) => r.kind === 'Lowest score').slice(0, 1).forEach((r) => L.push(`${o} owns a league record: lowest score ever, ${f1(r.pts)} in ${r.season} week ${r.wk}. Frame it, hang it over the toilet.`));
    F.recs.filter((r) => r.kind === 'Closest loss').slice(0, 1).forEach((r) => L.push(`${o} once lost by ${f1(Math.abs(r.margin))} points (${r.season} week ${r.wk}). ${F.He} still checks the box score at night hoping it changed.`));
    add(F.paRank <= 3 && !F.winning, `${o} wants you to know ${F.he}'s ${ord(F.paRank)} in points against. Nobody asked, you whiny little bitch. ${rec}.`);
    add(F.myWp != null, `${o}, I'm ${F.myWp}% to beat your ass this week, and honestly that's me being humble.`);
    add(true, F.poops ? `${o} has logged ${F.poops} 💩 on the Dump Log. Finally, something ${F.he}'s productive at.` : `${o} hasn't logged a single 💩 on the Dump Log. Full of shit, literally and figuratively.`);
    return [...L.filter(Boolean), ...extraLines(F)];
  }
  // personal material: one deck with the stat lines, no line repeats until the whole deck has been seen
  const rp = (F) => ({
    o: F.o, n: F.n, rec: F.rec, place: F.place, po: F.po, bench: F.bench, avg: F.avg, pfRank: F.pfRank, eff: F.eff, w: F.w, l: F.l, pa: F.pa,
    top: F.top ? F.top.name : null, share: F.top ? f1(F.top.share) : null,
    dg: (F.card.draft || {}).g || 'F', wg: (F.card.wire || {}).g || 'F', lgr: (F.card.lineup || {}).g || 'F',
    W: F.worst ? f1(F.worst.pts) : null, Wwk: F.worst ? F.worst.wk : null, Wopp: F.worst ? F.own(F.worst.opp) : null,
    lead: F.leader, low: F.seed >= 7, bad: !F.winning,
  });
  const PERSONAL = [
    { re: /^carlos/i, lines: (F) => { const p = rp(F); return [
      `${p.o} is a liberal, which explains the ${p.bench} points on his bench. He thinks every player deserves equal playing time.`,
      `${p.o} wants to redistribute the league's points. Makes sense, his team hasn't earned any. ${p.rec}.`,
      `${p.o} doesn't believe in benching players. Everybody gets a participation trophy. Everybody gets an L. ${p.rec}.`,
      `${p.o} averages ${p.avg} a week and blames it on systemic issues in the waiver wire. Sir, you just set a bad lineup.`,
      `${p.o} wants a points ceiling for the rich teams. Bold stance from a guy at ${p.avg} a week.`,
      p.po < 50 ? `${p.o}'s playoff odds are ${p.po}%. He's calling for a recount.` : `${p.o} is ${p.rec} and already writing an op-ed about how the playoff format is unfair.`,
      `${p.o} runs ${p.n} like a government program: way over budget, nothing gets done, and somehow he wants more funding.`,
      `${p.o} would trade his whole roster for one free agent if you called it a "stimulus package."`,
      `${p.o} grew a mustache. Still can't grow a winning record: ${p.rec}.`,
      `${p.o}'s new mustache is doing more work than his starting lineup.`,
      `${p.o} grew a mustache so he'd finally have something on his face besides disappointment. ${p.po}% playoff odds.`,
      `${p.o} sucks at video games, and fantasy football is just a video game with spreadsheets. Do the math: ${p.rec}.`,
      !F.bk && `${p.o} hasn't even posted a Breakaway score. Scared of a mouse game, commissioner?`,
      `${p.o} plays Madden on Rookie and still throws picks. ${p.n} is that, but with ${p.bench} points on the bench.`,
      `Give ${p.o} a controller and he loses to the tutorial. Give him a roster and he goes ${p.rec}. Consistent, at least.`,
      `${p.o} is the commissioner and still can't commission a single winning streak.`,
      `${p.o} runs this league like he runs his lineup: lots of rules, zero results.`,
      `${p.o} wants universal healthcare for his roster. Makes sense, ${p.n} has been on life support since September.`,
      `${p.o}'s mustache has been the best thing on his roster all season. It's not close.`,
      `${p.o} grew the mustache to look tough. ${p.place} place says otherwise.`,
      `${p.o} protests every loss like it's a policy decision. ${p.l} protests and counting.`,
      p.lead && `${p.o} wants a wealth tax on ${p.lead}. Easier than beating him.`,
      `${p.o} believes in a fair distribution of points. His opponents took it literally: ${p.pa} points against.`,
      `${p.o} thinks the standings are rigged. They're not, Carlos. You're ${p.place}.`,
      `${p.o}'s lineup has more safe spaces than starters. ${p.eff}% efficiency.`,
      `${p.o} has a mustache, an opinion on everything and a ${p.rec} record. Only one of those is worth listening to, and it's the mustache.`,
      `${p.o} needs a controller with one button. He'd still press the wrong one, like every Sunday at noon.`,
      p.Wwk && `${p.o} rage-quits video games and fantasy football the same way. See: week ${p.Wwk}, ${p.W} points.`,
      p.low && `${p.o} wants the league to fund a Toilet Bowl relief program. He's going to need it.`,
      p.bad ? `${p.o} is losing and says the system is broken. The system is fine. The lineup is broken.` : `${p.o} is winning and still says the system is broken. Pick a lane, comrade.`,
      `${p.o} sets his lineup by committee. The committee is him, his mustache and a bad idea.`,
      `${p.o} thinks every team deserves a playoff spot. With ${p.po}% odds, he kind of has to.`,
      `${p.o} got ${an(p.dg)} on his draft and wants it graded on a curve.`,
      `${p.o} is the commissioner of a league where he's ${p.place}. That's like being mayor of a town that keeps voting you out.`,
      `${p.o} campaigns on "change" every week. His lineup never does.`,
      p.Wopp && `${p.o} would lose Mario Kart to a toddler. He already lost to ${p.Wopp} with ${p.W} points, so the toddler's not out of the question.`,
      `${p.o}'s mustache is the only thing in his life that grew this year. Definitely not his win total.`,
      `${p.o} calls it "equity" when ${p.n} scores the same as last place. We call it ${p.avg} a week.`,
      `${p.o} would put a bike lane through his own backfield if it meant fewer points for the other team.`,
      `${p.o} wants to cancel debt. Start with the ${p.l} losses he owes this league.`,
      `${p.o} as commissioner: makes the rules, breaks his own lineup.`,
      `${p.o} plays video games like he plays fantasy: button-mashing, no plan, rage at the end.`,
    ]; } },
    { re: /^edwin/i, lines: (F) => { const p = rp(F); return [
      `${p.o} has been 5'5" since 7th grade. His team is ${p.rec} and ${F.winning ? 'peaking early too. Neither one is growing from here.' : "isn't growing either."}`,
      `${p.o} is a Raven in the Air Force. Thanks for your service, bitch. Now go set your lineup.`,
      `${p.o} is 5'5" and ${p.rec}. One of those numbers is going to change this season. It's not the 5'5".`,
      F.beatdown && `${p.o} guards Air Force planes for a living and still couldn't guard against ${F.own(F.beatdown.opp)} in week ${F.beatdown.wk} (lost by ${f1(-F.beatdown.m)}). Thanks for your service, bitch.`,
      F.lostFinal.length && `${p.o} lost the ${F.lostFinal[0].year} championship and decided the fix was not paying the $50 this year. Can't lose money if you never put any in.`,
      `The Air Force calls ${p.o} a Raven. We call him a 5'5" guy who skipped the $50 buy-in.`,
      `${p.o} wouldn't pay the $50 buy-in. Fifty bucks. That's a footlong at Subway, which is more inches than he's grown since 7th grade.`,
      `${p.o} skipped the $50 buy-in and still expects a trophy. The Air Force taught him to guard things, not pay for them.`,
      `${p.o} is 5'5" and acts 6'5". Ego by the foot, height by the inch.`,
      `${p.o} is ${p.rec} and still can't reach the top shelf of the trophy case.`,
      `${p.o} has to sit on a phone book to see the standings. ${p.place} place looks nice from down there.`,
      p.top && `${p.o} wouldn't put up $50 but he'll let ${p.top} put up ${p.share}% of his points. Freeloading runs deep.`,
      `Ravens guard the plane so nobody messes with it. ${p.o} guards his $50 the same way.`,
      `${p.o} salutes the flag, then salutes his wallet when the buy-in comes due. Thanks for your service, bitch.`,
      F.winning ? `${p.o} is in the Air Force and this is the first time he's ever been above anybody. Enjoy ${p.place}, shorty.` : `${p.o} is in the Air Force and still has never been above anybody. ${p.place} place.`,
      `${p.o} is 5'5". His bench is ${p.bench} points tall. Guess which one gets more attention.`,
      F.lostFinal.length && `${p.o} lost the ${F.lostFinal[0].year} final to ${F.lostFinal[0].owner}. Couldn't reach the trophy then, can't reach it now.`,
      `${p.o} wants to win the league. He'd have to be tall enough to ride first.`,
      `Thank ${p.o} for his service. Then remind him he still owes $50.`,
      `${p.o} got his height in 7th grade and his choke in December. Both stuck.`,
      p.lead && p.lead !== p.o && `${p.o} wears lifts on game day. Still can't see over ${p.lead}.`,
      `${p.o} won't spend $50 on the league but he'll spend 50 minutes telling you he's the favorite.`,
      `${p.o}'s security clearance is higher than he is.`,
      `${p.o} is 5'5" in boots. ${p.po}% playoff odds in boots too.`,
      `${p.o} treats the $50 buy-in like it's classified. Need-to-know basis, and nobody gets to know.`,
      `${p.o} guards aircraft worth millions and wouldn't part with $50 for the pot. Priorities, Raven.`,
      F.winning && `${p.o} is one of the best teams in the league and the cheapest man in it. Pick one, Raven.`,
      `${p.o} wakes up at 0500 to guard a jet and still sleeps through waivers. ${an(p.wg)} on the wire.`,
      `${p.o} stands at attention for the anthem and nothing else. Definitely not for his bench: ${p.bench} points left there.`,
      `${p.o} would pay the $50 in a heartbeat if it came with a booster seat.`,
      `${p.o} is ${p.rec} and walking around like he's 6 feet tall. Sit down. Oh, you are.`,
      `${p.o}'s team is built like him: undersized and overconfident.`,
      `In the Air Force they call ${p.o} "Raven." In this league we call him "sir, you didn't pay."`,
      `${p.o} rounds up to 5'6". The rest of us round down his playoff chances.`,
      `${p.o} fights for freedom, except the freedom of this league to collect $50 from him.`,
      `${p.o} is short on height, short on dues and ${F.winning ? 'about to be short on luck' : 'short on wins'}.`,
      `${p.o} hit his growth spurt in 7th grade. His team hit theirs in September. Both done.`,
      `${p.o} got ${an(p.dg)} on the draft. Thanks for your service, bitch.`,
      `${p.o} is the only Raven who can't see over the cockpit.`,
      `${p.o}: 5'5", $0 paid, ${p.rec}. The stat line of a man the league is carrying for free.`,
    ]; } },
    { re: /^justin/i, lines: (F) => { const p = rp(F); return [
      `${p.o} went to college for 13 years and came out selling paint. Same plan he used to build ${p.n}: take forever, end up somewhere weird.`,
      `13 years of college and ${p.o} still can't read a depth chart.`,
      `${p.o} sells paint for a living. Explains the lineup: grabs whatever's on the shelf and slaps it in there.`,
      `${p.o} moved to Colorado to smoke weed, which explains the ${p.bench} points on his bench. He forgot they were there.`,
      `${p.o} sets his lineup high every Sunday. You can tell: ${p.eff}% lineup efficiency.`,
      `${p.o} took 13 years to finish college. At this pace he wins a fantasy title around 2052.`,
      F.winning ? `${p.o} is ${p.rec} and thinks it's skill. It's the Colorado air, buddy. Enjoy it before it wears off.` : `${p.o} is ${p.rec}. The Colorado air isn't helping. Neither is the edible.`,
      `${p.o}'s paint store has 400 colors and his team still only comes in one: ${F.winning ? 'lucky' : 'loser'}.`,
      F.dropped && `13 years of college and ${p.o} still dropped ${F.dropped.name}, who's put up ${f1(F.dropped.pts)} since. Was that before or after the edible?`,
      `${p.o} paints walls by day and watches paint dry by night. Same energy as his lineup decisions.`,
      `${p.o} still wears his high school letterman. It says "Mr. Muscle." The muscle left. The jacket stayed.`,
      `${p.o}'s letterman says "Mr. Muscle." His roster says "Mr. ${F.winning ? 'Luck' : 'Loser'}." ${p.rec}.`,
      `${p.o} says he's ${p.rec} because of skill. He's a pathological liar, so consider the source.`,
      F.last && `${p.o} swears he set his lineup on time last week. Pathological liar. He left ${f1(F.lostLast)} on the bench in week ${F.last.wk}.`,
      `${p.o} told us he'd go undefeated this year. He also told us he set his lineup on time. Pathological liar, ${p.rec}.`,
      `${p.o}'s "Mr. Muscle" letterman doesn't zip anymore, and neither does his lineup: ${p.eff}% efficiency.`,
      `${p.o} says the jacket still fits. Pathological liar. The jacket is a crop top now.`,
      `${p.o} says he ran track at the University of Houston. Pathological liar. The only thing he's ever run is up the bill at Golden Corral.`,
      `${p.o} "ran track at U of H." Sure, buddy. Took you 13 years to finish college and you never finished a lap.`,
      `${p.o} claims he ran track at Houston. The fastest thing about him is how quick he makes up a story.`,
      `Ask ${p.o} about his University of Houston track days and watch him make up a 40 time on the spot.`,
      `${p.o}'s track career at Houston is like the muscle on his "Mr. Muscle" letterman: never actually there.`,
      `${p.o} took his wife's last name. First time in his life he committed to a trade and came out ahead.`,
      `${p.o} gave up his own last name without a fight. Same energy as ${p.n}: zero fight${F.winning ? ', all luck' : ''}.`,
      `${p.o} took his wife's last name. She also sets his lineup now, which explains the ${p.rec}.`,
      `${p.o}'s wife let him keep the letterman but took the last name. Smart woman.`,
      `${p.o}'s lineup is like ${p.o}: big, slow, and ${p.bench} points of it sitting on the bench.`,
      `Somebody call SeaWorld, a whale just set his lineup. ${p.o} is ${p.rec}${F.winning ? ' and it is pure luck' : ''}.`,
      `${p.o} is ${p.rec} and eating it up. Literally, the whole buffet. Save room for the playoff choke, big man.`,
      `${p.n} averages ${p.avg} points a week. ${p.o} averages about that many chicken nuggets a sitting.`,
      `${p.o} squints at his lineup every Sunday and still can't see the ${p.bench} points sitting on his bench.`,
      `${p.o} drafts like he eats: everything in sight, no plan. Draft grade ${p.dg}.`,
      `${p.o} spent 13 years in college and his only degree is in excuses.`,
      `${p.o} sells paint and still can't cover up ${p.bench} points of bench mistakes.`,
      `${p.o}'s Mr. Muscle letterman is the only letter he's earned since high school.`,
      `${p.o} moved to Colorado for the weed and stayed for the munchies. ${p.avg} points a week, ${p.avg} wings a night.`,
      `${p.o} took his wife's last name and his opponents took his lunch money: ${p.pa} points against.`,
      `${p.o} says he "basically" ran a 4.4. Pathological liar. He basically ran a 4.4 to the fridge.`,
      `${p.o} is ${p.rec}. In Justin numbers that's "undefeated, actually."`,
      `${p.o} went to college so long his student ID has a senior discount.`,
      `${p.o} sells paint, smokes weed and lies about track. Somehow the fantasy team is still the worst thing about him.`,
      `${p.o} says he's got a "gut feeling" about his lineup. Everybody can see the gut. Nobody's seen the feeling pay off.`,
      `${p.o}'s wife picked the last name, the house and the paint color. ${p.o} picked ${p.top || 'his starters'}. You can tell who has the taste.`,
      F.worst && `${p.o} put up ${p.W} in week ${p.Wwk} and said it was "a strategy." Pathological liar.`,
      `${p.o} lies about his 40 time, his college years and his lineup. The only honest thing about him is the waistline.`,
    ]; } },
    { re: /^jacky/i, lines: (F) => { const p = rp(F); return [
      `${p.o} is 4'11" and drives a 2014 Civic with 160,000 miles. Both have been running on fumes for years, just like ${p.n}.`,
      `${p.o} walks 2,000 steps a day. Her waiver claims get even less exercise.`,
      `${p.o}'s 2014 Civic has 160,000 miles and more horsepower than her lineup.`,
      `${p.o} gets 2,000 steps a day: one trip to the fridge and back to set a bad lineup.`,
      F.winning ? `${p.o} is 4'11" and somehow ${p.place} place. Her playoff odds (${p.po}%) are taller than she is.` : `${p.o} is 4'11" and ${p.rec}. Nothing about this is measuring up.`,
      `${p.o} can't see over the steering wheel of her 2014 Civic or over the rest of this league.`,
      p.po < 50 ? `${p.o} is 4'11" and her playoff odds (${p.po}%) are somehow even shorter.` : `${p.o} is 4'11" and her trophy case is even emptier. ${p.po}% playoff odds, 0 rings, 0 inches of growth since 8th grade.`,
      `${p.o} has to stand on the bench to see over her lineup. Makes sense, that's where her ${p.bench} points are.`,
      F.seed > 5 ? `${p.o} can't reach the top shelf or the top half of the standings. ${p.place} place, short queen.` : `${p.o} is ${p.place} and still can't reach the top shelf. Short queen, short-lived.`,
      `${p.n} averages ${p.avg} a week. Like its manager, it comes up short.`,
      F.worst && `${p.o} scored ${p.W} in week ${p.Wwk}. Even her lowlights are 4'11".`,
      `${p.o}'s 2014 Civic has had its check engine light on longer than she's had a winning streak.`,
      `${p.o} has 160,000 miles on the Civic and zero miles on the waiver wire. ${an(p.wg)} on waivers.`,
      `${p.o} walks 2,000 steps a day and scores ${p.avg} a week. Both below the recommended amount.`,
      `${p.o} needs a step stool to reach the waiver wire.`,
      `${p.o} is 4'11" and her bench is ${p.bench} points deep. Finally, something about her that's big.`,
      `${p.o} can't reach the gas pedal or the playoffs without help. ${p.po}% odds.`,
      `${p.o} drives a 2014 Civic and drafts like it's 2014 too. Draft grade ${p.dg}.`,
      p.top && `${p.o} walks 2,000 steps a day. ${p.top} gets more yards than that in a quarter.`,
      `${p.o} is 4'11". Her kicker is taller and more consistent.`,
      `${p.n} is like her Civic: still running, nobody knows how, and it's dying on the highway in December.`,
      `${p.o} is 4'11" and ${p.rec}. The record is the only thing about her that rounds up.`,
      p.lead && p.lead !== p.o && `${p.o} can't see over the dashboard, the steering wheel or ${p.lead}.`,
      `${p.o} stands on her tiptoes to see the scoreboard. It doesn't help: ${p.place}.`,
      `${p.o} drives a 2014 Civic, walks 2,000 steps and manages at the same speed: barely moving.`,
      `${p.o} has more miles on her Civic than her team has points this season. ${F.pf}. Not a flex.`,
      `${p.o} would rather drive the Civic to the mailbox than walk. 2,000 steps is a lot to ask.`,
      `${p.o}'s car is a 2014. Her playoff odds are ${p.po}%. Both depreciating fast.`,
      `${p.o} is fun-sized. Her win total is too: ${p.w}.`,
      `${p.o}: 4'11", 160,000 miles, 2,000 steps, ${p.rec}. The stat line of someone running on fumes.`,
      `${p.o} is so short the bench is the only place she can reach. Explains the ${p.bench} points she left there.`,
      `${p.o} gets her 2,000 steps in walking to the TV to yell at ${p.top || 'her starters'}.`,
      `${p.o}'s Civic has a cassette adapter and her lineup has ${p.eff}% efficiency. Both stuck in the past.`,
      `${p.o} plays like she's afraid of heights: ${F.seed <= 2 ? 'scared of first place' : `never gets near the top. ${p.place}`}.`,
      `${p.o} needs a booster seat for the Civic and a babysitter for her lineup.`,
      `${p.o} hits 2,000 steps and calls it cardio. Hits ${p.avg} points and calls it a team.`,
      `${p.o}'s Civic needs a new transmission. ${p.n} needs a new manager.`,
      `${p.o} is short on height, short on steps and short on ${F.winning ? 'time before it all falls apart' : 'wins'}.`,
      `${p.o} would get a lot more done with step number 2,001.`,
      `${p.o} parks the Civic across two spots and her lineup across two bad decisions.`,
    ]; } },
    { re: /^darla/i, lines: (F) => { const p = rp(F); return [
      `${p.o} is a stay-at-home mom with two kids and still has more free time than her bench: ${p.bench} points sitting there doing nothing.`,
      `${p.o} runs two kids full-time and ${p.n} part-time. Guess which one gets the effort. ${p.rec}.`,
      `${p.o} sets her lineup during nap time. You can tell: ${p.eff}% lineup efficiency.`,
      `Two kids, a house and ${p.n}. Only one of them is a complete mess, and it's the one that's ${p.rec}.`,
      `${p.o} puts her starters in timeout and lets the bench play. ${p.bench} points benched this season.`,
      `${p.o} is ${p.rec} with two kids hanging off her. Imagine what she could do with a nap.`,
      `${p.o} has two kids and a fantasy team. The kids are better at following directions.`,
      `${p.o} sets her lineup between diaper changes. You can smell it: ${p.avg} a week.`,
      `${p.o}'s kids get screen time limits. ${p.n} should get one too.`,
      `${p.o} packs two lunches a day and still forgets to pack a lineup.`,
      `${p.o} says "because I said so" to her kids. Her lineup decisions run on the same logic.`,
      `${p.o} runs a household like a general and her team like a PTA bake sale. ${p.rec}.`,
      `${p.o} has two kids crying at home and ${p.l} losses crying on ESPN.`,
      `${p.o} puts the kids to bed at 8 and her playoff hopes to bed at ${p.po}%.`,
      `${p.o} is a stay-at-home mom with a stay-at-home bench: ${p.bench} points that never left the house.`,
      `${p.o} gives her kids participation trophies. She's been collecting her own: ${p.place} place.`,
      `${p.o} would trade both kids for a healthy RB1. Honestly, fair.`,
      `${p.o} is ${p.rec} and still the most functional adult in this league. That says everything about this league.`,
      `${p.o} gets interrupted every 30 seconds by a kid. Her lineup gets interrupted every Sunday by reality.`,
      `${p.o} cuts the crusts off sandwiches and the upside off her lineup.`,
      p.po < 60 && `${p.o} reads bedtime stories. Her favorite: "The Team That Almost Made the Playoffs."`,
      `${p.o} needs a nap. Her team needs a miracle. ${p.po}% playoff odds.`,
      `${p.o} has two kids, zero free time and ${p.rec} to show for it.`,
      `${p.o}'s kids have a better routine than her starting lineup. ${an(p.lgr)} on lineups.`,
      `${p.o}'s house is spotless. Her roster looks like the playroom.`,
      `${p.o} said she'd set her lineup "after the kids go down." The kids went down. So did ${p.n}.`,
      `${p.o} is the chef, the driver, the nurse and the referee. GM is the one job she's bad at.`,
      p.lead && p.lead !== p.o && `${p.o} bribes her kids with snacks. Try bribing ${p.lead} for a win.`,
      `${p.o} gives her kids timeouts. ${p.n} deserves one more than both of them combined.`,
      `${p.o} did more laundry this week than her team did winning all month.`,
      `${p.o} raised two humans but can't raise her scoring above ${p.avg} a week.`,
      `${p.o} picks starters like she picks a kid's outfit: whatever's clean.`,
      `${p.o} has two kids, and both of them could explain the flex spot better.`,
      F.worst && `${p.o} put up ${p.W} in week ${p.Wwk}. The kids were teething. The team was rotting.`,
      `${p.o} drafted with a kid on each hip. Draft grade ${p.dg}. It shows.`,
      `${p.o} can find a lost shoe in four seconds and can't find a starting running back all season.`,
      `${p.o}'s team is like a toddler: loud, unpredictable and ${F.winning ? 'about to have a meltdown' : 'already melting down'}.`,
      `${p.o} survives on coffee and chicken nuggets. ${p.n} survives on ${p.top || 'prayer'}.`,
      `${p.o} has eyes in the back of her head and still can't see the ${p.bench} points on her bench.`,
      `${p.o}'s kids will grow up and leave. ${p.n}'s losses never will.`,
      `${p.o} can negotiate with a screaming 4-year-old but can't negotiate a single trade.`,
    ]; } },
    { re: /^tanner/i, lines: (F) => { const p = rp(F); return [
      `${p.o} has weighed 230 for four straight years. Most consistent thing about him. His lineup sure isn't.`,
      `${p.o} is a conservative who left ${p.bench} points on the bench. Fiscally responsible, my ass.`,
      `${p.o} sets his lineup six beers deep. ${p.eff}% lineup efficiency, which is honestly impressive for six beers.`,
      `${p.o} neglects his wife, his kid and his waiver wire. At least he's consistent.`,
      `${p.o} wants small government and an even smaller playoff field, because that's the only way he sneaks in. ${p.po}% odds.`,
      `${p.o} drinks to forget his lineup. It's working: he forgot the ${p.bench} points on his bench.`,
      `${p.o}'s kid sees him less than his starters do, and his starters barely see the field. ${p.rec}.`,
      `${p.o} has six beers before kickoff and six excuses after. ${p.rec}.`,
      `${p.o} is 230 pounds of light beer and bad decisions.`,
      `${p.o} believes in personal responsibility. Just not for the ${p.bench} points he benched.`,
      `${p.o} has weighed 230 for four years. His scoring wishes it was that steady: ${p.avg} a week.`,
      `${p.o}'s wife thinks he's at work. His boss thinks he's at work. He's at the bar refreshing ESPN.`,
      `${p.o} wants to make ${p.n} great again. It was never great, Tanner.`,
      `${p.o}'s kid made a missing persons poster. It says "last seen yelling at a TV on Sunday."`,
      p.low && `${p.o} is 230 pounds and ${p.place}. Heavy is the head that wears the Toilet Bowl crown.`,
      `${p.o} wants smaller government and already has the smallest trophy case: zero.`,
      `${p.o} was "working late" again. So was ${p.n}: ${p.avg} a week.`,
      `${p.o} blacked out during the draft and it shows.`,
      `${p.o}'s liver and his lineup are both begging for a bye week.`,
      `${p.o} has been 230 for four years: one keg up, one keg down, perfectly balanced.`,
      `${p.o} cracks a beer at 9 a.m. on Sunday and calls it "pregame." His team plays like it's been drinking too.`,
      `${p.o} is conservative with everything except beer and bad starts.`,
      `${p.o}'s kid calls the TV "Dad's other family."`,
      p.top && `${p.o} skips the school play to watch ${p.top}. ${p.top} doesn't know he exists either.`,
      F.avg < F.lgAvg ? `${p.o} shotguns a beer every time his team scores. He's been sober all season.` : `${p.o} shotguns a beer every time his team scores. That's how he stays at 230.`,
      `${p.o} would defund the waiver wire if he could. He doesn't use it anyway: ${an(p.wg)}.`,
      F.worst && `${p.o} drank through his ${p.W}-point week ${p.Wwk} and honestly, fair.`,
      `${p.o}'s bar tab outscores his team most weeks.`,
      `${p.o}: 230 pounds, a cooler full of beer, a neglected family and ${p.rec}. The American dream.`,
      `${p.o}'s wife asked for more quality time. He gave it to his kicker.`,
      `${p.o} only reads two things: the beer menu and ESPN projections. Gets both wrong.`,
      `${p.o} calls it "team building" when he drinks alone watching the late game.`,
      p.top && `${p.o} rides ${p.top} harder than he rides the wagon. Both are carrying him.`,
      `${p.o} drafted with a beer in each hand. Draft grade ${p.dg}. Should've used one hand for the mouse.`,
      `${p.o}'s team is like his liver: overworked, underperforming and one bad week from shutting down.`,
      `${p.o} hasn't changed weight in four years or changed his lineup in four weeks.`,
      `${p.o} wants lower taxes and a lower bar. With ${p.po}% playoff odds, he's getting one of them.`,
      `${p.o} tells his wife he's "watching the game with the guys." The guys are a 30-rack and a ${p.rec} team.`,
      `${p.o} sets his lineup like he parks the truck after six beers: crooked and over the line.`,
      `${p.o} is ${p.rec}. Somewhere a bartender knows more about his team than his kid does.`,
      `${p.o} won't take handouts. Except the job. And the truck. And the ${F.luck > 0 ? 'lucky schedule' : 'sympathy'}.`,
      `${p.o}'s bar tab has more points than ${p.n} this season, and it never sits on the bench.`,
      `${p.o}'s bartender gets a Christmas card. His kicker gets cut. Priorities.`,
      `${p.o} closes out his bar tab faster than he closes out a win.`,
    ]; } },
    { re: /^trevor/i, lines: (F) => { const p = rp(F); return [
      `${p.o} looks like Mike Wazowski and sets his lineup like he only has one eye. ${p.rec}.`,
      `${p.o} is hitting puberty at 33. His team's going through some changes too: ${p.rec}.`,
      `${p.o} is a top-500 Magneto in Marvel Rivals and ${p.place} in this league. Priorities.`,
      `${p.o} works full-time unemployed, remotely, and still can't find time to set a lineup.`,
      `${p.o} orders sour cream with a side of Chipotle. His lineup is the same: all sauce, no meat. ${p.avg} a week.`,
      `${p.o} neglects his dogs and his bench: ${p.bench} points left sitting there waiting for a walk.`,
      `${p.o} has juicy nipples and a dry roster.`,
      `${p.o} built this whole app and still can't build a winning lineup. ${p.rec}.`,
      `${p.o} sets his lineup the way he drinks: way too much, then regrets it Sunday night.`,
      `Mike Wazowski over here going through puberty at 33 and calling himself a GM. ${p.pfRank} in points, buddy.`,
      `${p.o} built a fantasy app instead of a fantasy team. Coding is easier than drafting, apparently. Draft grade ${p.dg}.`,
      `${p.o} is a top-500 Magneto. He can bend metal with his mind and can't bend a single matchup.`,
      `${p.o} has one eye like Mike Wazowski and it's never on his lineup.`,
      `${p.o} hit puberty at 33. His team hasn't hit anything yet.`,
      `${p.o}'s dogs haven't been walked since week 1. Neither has his waiver wire: ${an(p.wg)}.`,
      `${p.o} is unemployed full-time, remotely. Somehow still too busy to check waivers.`,
      `${p.o} orders a bowl of sour cream and asks them to sprinkle some Chipotle on top. That's his whole personality.`,
      `${p.o}'s nipples are juicier than his playoff odds (${p.po}%).`,
      `${p.o} drinks like Magneto bends steel: effortlessly and with a lot of collateral damage.`,
      `${p.o} built live win odds so he could watch himself lose in real time.`,
      `${p.o} is the Mike Wazowski of this league: one eye, no neck, thinks he's the star.`,
      `${p.o} put 400 hours into Marvel Rivals and 4 minutes into his lineup. Top-500 Magneto, ${p.place} here.`,
      `${p.o}'s voice is still cracking at 33. So is his team: ${p.rec}.`,
      `${p.o} wrote a roast generator so he could roast everybody else. Didn't save him.`,
      `${p.o} left his dogs alone so long they started a fantasy team. They're doing better.`,
      `${p.o}'s Chipotle order is 70% sour cream, 30% regret. His roster is the same ratio.`,
      `${p.o} works remotely at being unemployed. Clocks in at noon, clocks out at 12:05.`,
      `${p.o} is unemployed and still forgot to set his lineup. What else were you doing, Trevor?`,
      `${p.o} drinks until he looks like Mike Wazowski. Oh wait.`,
      `${p.o}'s dogs are on a hunger strike. His team is on a scoring strike: ${p.avg}.`,
      `${p.o} has juicy nipples and a ${p.avg} average. Only one of those is impressive.`,
      `${p.o} built an app that tracks everyone's moves. The one move it's never seen: him winning a trade.`,
      `${p.o} is a top-500 Magneto and a bottom-half fantasy manager. ${p.place}.`,
      `${p.o} built a Dump Log feature. It's the only thing in his life that's regular.`,
      `${p.o} codes all night, drinks all day, and his dogs eat whenever.`,
      `${p.o}'s burrito is mostly sour cream. His team is mostly bench: ${p.bench} points sitting there.`,
      `${p.o} built push notifications so the whole league gets an alert every time he loses.`,
      `${p.o} has one eye like Mike Wazowski and still saw ${p.rec} coming from a mile away.`,
      `${p.o} is unemployed, drinking and gaming. The trifecta. ${p.n} is ${p.rec}.`,
      `${p.o} spent more time building trash talk for this app than winning anything worth trash-talking about.`,
      `${p.o} got his first armpit hair the same week he got his ${p.w > 0 ? 'last win' : 'first loss'}.`,
    ]; } },
    { re: /^wes/i, lines: (F) => { const p = rp(F); return [
      `${p.o} is a certified lover boy. Loves everybody except his own lineup: ${p.bench} points left on the bench.`,
      `${p.o} is such a simp he'd trade his RB1 for a girl's Venmo. ${p.rec}.`,
      `${p.o} simps for his players the way he simps for girls: all in, gets nothing back. ${p.avg} a week.`,
      `Certified Lover Boy ${p.o}: shows up shirtless, flexes, tells his kicker "I love you." Still ${p.rec}.`,
      F.wkg ? `${p.o} sent ${F.wkg.oppO} "good luck this week ❤️". ${F.wkg.oppO} left him on read and is ${100 - F.wkg.wp}% to win.` : `${p.o} texts his opponent "good luck ❤️" every week. They never text back.`,
      `${p.o} simps so hard he benches his best players so their feelings don't get hurt. ${p.place} place.`,
      `${p.o} is a simp, a redhead and a bodybuilder. Three things that have never won a fantasy league. ${p.rec}.`,
      `${p.o} would accept any trade if the other guy said "please." That's how you end up ${p.rec}, lover boy.`,
      `${p.o} can bench 315 but can't bench the right fucking player. ${p.bench} points left on the pine.`,
      `${p.o} is the only bodybuilder in history whose team has no legs: ${p.pfRank} in points.`,
      `${p.o} spends two hours a day in the gym and gets ${an(p.wg)} on the waiver wire. Huge biceps, tiny brain, ${p.rec}.`,
      `Protein shakes won't fix ${p.avg} points a week, ${p.o}, you redheaded meathead.`,
      `Two redheads in this league and somehow ${p.o} is the one getting burned: ${p.po}% playoff odds.`,
      `${p.o} has a six-pack and a ${p.rec} record. Only one of them took work.`,
      `${p.o} curls 50s and can't curl his team into the playoffs. ${p.po}%.`,
      `${p.o} sends good-morning texts to girls who leave him on read. His waiver claims get the same treatment.`,
      `${p.o} would hand over his whole roster to a girl who texted "hey."`,
      `${p.o} skipped leg day and draft day. Draft grade ${p.dg}.`,
      `${p.o} takes in more protein a day than his team scores a week: ${p.avg}.`,
      `${p.o} tells every girl "you're different." Tells every lineup "this week's different." Neither is.`,
      `${p.o} hits the gym twice a day and still can't carry this team.`,
      `${p.o} is a redhead, so he burns in the sun and in the standings: ${p.place}.`,
      `${p.o} is the certified lover boy of a league that doesn't love him back.`,
      p.top && `${p.o} simps for ${p.top}. ${p.top} doesn't even follow him back.`,
      `${p.o}'s pre-workout has more kick than his kicker.`,
      `${p.o} Venmo-requests his opponent for emotional damages after every loss.`,
      `${p.o} loves too hard. Ask his bench: ${p.bench} points of unrequited love.`,
      `${p.o} is all muscle, no strategy. ${p.eff}% lineup efficiency.`,
      `${p.o} benches 315 and benches his best players. Only one gets applause.`,
      `${p.o} texts his matchup "good luck 😘." His opponent texts back "lol."`,
      `${p.o} is a bodybuilder with a team built like a toothpick: ${p.pfRank} in points.`,
      `${p.o} gave his heart to a girl, his protein to his biceps and nothing to his lineup.`,
      `${p.o} is in his feelings again. ${p.rec} will do that.`,
      `${p.o} has abs you could wash clothes on and a team you could wipe the floor with.`,
      p.lead && p.lead !== p.o && `${p.o} simps so hard he'd trade with ${p.lead} just to feel included.`,
      `${p.o} flexes in every mirror he passes. His team hasn't flexed since ${F.best ? `week ${F.best.wk}` : 'the draft'}.`,
      `${p.o} writes love letters to his starters. They keep ghosting him.`,
      `${p.o} drinks protein shakes like Tanner drinks beer. Same results: ${p.rec}.`,
      `${p.o} would start a girl's ex if she asked nicely.`,
      `${p.o} is a redhead bodybuilder simp. The rarest Pokémon, the worst GM.`,
    ]; } },
    { re: /^brandon/i, lines: (F) => { const p = rp(F); return [
      `${p.o} hides his insecurities behind tattoos and his best players on the bench: ${p.bench} points benched.`,
      `${p.o} is a swinger. Explains the roster: he'll start anybody's guys.`,
      `${p.o} swings, and he still can't get one trade partner to commit.`,
      `${p.o} got another tattoo to cover up the pain of being ${p.rec}. Same old same old.`,
      `Same old same old: ${p.rec}, ${p.pfRank} in points, ${p.bench} points rotting on the bench. Same old ginger bitch.`,
      `${p.o} doesn't play fantasy football, he fulfills an obligation. ${p.eff}% lineup efficiency says he's half-assing that too.`,
      F.last && `${p.o} sets his lineup out of obligation, ${F.lastLine}, then blames the sun for burning his ginger ass. Same old same old.`,
      F.benchSeason && `Same old same old: ${p.o} benches ${F.benchSeason.b.name} (${f1(F.benchSeason.b.avg)} a game) out of some sense of obligation to ${F.benchSeason.s.name}. Ginger logic.`,
      `${p.o}, your red hair has more fire than ${F.ns} ${p.avg} points a game.`,
      `${p.o} showed up to the draft out of obligation and it shows: draft grade ${p.dg}. Same old same old.`,
      `Ask ${p.o} how his week went and you already know: "same old same old." Translation: ${p.po}% playoff odds, red hair, zero soul.`,
      ...F.recs.filter((r) => r.kind === 'Lowest score').slice(0, 1).map((r) => `${p.o} holds the league record for lowest score (${f1(r.pts)} in ${r.season}). Same old same old since day one, you obligated ginger.`),
      `${p.o} has a tattoo for every bad decision. He's going to need more skin: ${p.l} losses.`,
      `${p.o}'s tattoos cover the same thing his bench does: years of pain. ${p.bench} points benched.`,
      `${p.o} answers everything with "same old same old." Ask him about the playoffs: same old same old, ${p.po}%.`,
      `${p.o} plays fantasy out of obligation. His opponents beat him out of habit.`,
      `${p.o} is a ginger with tattoos. Some guys get ink to look tough. He got it so he'd have some color.`,
      `${p.o} is the only swinger in America who can't find anyone to swap with. ${an(p.wg)} on waivers.`,
      `${p.o}'s tattoos tell a story. It's the same old same old.`,
      `${p.o} has ink on both arms and nothing on his résumé. Zero titles.`,
      p.top && `${p.o} hides behind tattoos and ${p.top}. Only one of them is doing any work.`,
      `${p.o} is so pale his tattoos are the only thing with a pulse.`,
      `${p.o} lets everybody into his house on Saturday night and nobody good into his lineup on Sunday.`,
      `${p.o} is consistent, give him that. Same old same old, ${p.rec}.`,
      `${p.o}'s best quality is showing up. That's it. That's the list.`,
      F.worst && `${p.o} doesn't burn in the sun, he burns in matchups. Week ${p.Wwk}: ${p.W} points.`,
      `${p.o} goes to the tattoo shop more often than the waiver wire.`,
      `${p.o}'s face says "I'm fine." His tattoos say "I'm not." His record says ${p.rec}.`,
      `${p.o} is the human version of auto-draft.`,
      `${p.o} got a skull tattoo. Fitting. ${p.n} has been dead for weeks.`,
      `${p.o} sets his lineup like he's swapping car keys at a party: random and regrettable.`,
      `${p.o} keeps showing up out of obligation. The league keeps beating him out of tradition.`,
      `${p.o} is ginger, tattooed and ${p.place}. Three things you can't wash off.`,
      `${p.o} is open to anything on Saturday and closed-minded about everything on Sunday. ${p.rec}.`,
      `${p.o} covers his insecurities in ink. ${p.n} needs a full sleeve.`,
      `${p.o}'s "same old same old" is the only true thing anyone says in this league.`,
      `${p.o} tattooed "no regrets" on himself and then set that lineup.`,
      `${p.o} sunburns through a T-shirt and loses through a full lineup.`,
      `${p.o} would get a tattoo of the trophy before he'd ever touch the real one.`,
      `${p.o}: tattoos, red hair, obligation and ${p.rec}. Same old same old.`,
    ]; } },
    { re: /^mirza/i, lines: (F) => { const p = rp(F); return [
      `${p.o} dyes his hair and wears pants year-round to hide his calves. Can't hide ${p.rec} though.`,
      `${p.o} wears pants in July because he has no calves. His team has no legs either: ${p.pfRank} in points.`,
      `${p.o} gets manicures. Pretty hands, ${p.avg} a week, ${p.rec}. All polish, no ${F.winning ? 'class' : 'wins'}.`,
      F.top ? `${p.o} has mommy issues, which explains why he needs ${p.top} to carry him (${p.share}% of his points).` : `${p.o} has mommy issues and a ${p.rec} team. Mom's not coming to save this one.`,
      `${p.o} dyes his hair to cover the grays this team gave him. ${p.rec}.`,
      `${p.o} works for an NFL player and still couldn't find a calf muscle in the whole organization.`,
      `${p.o}'s skincare routine has more steps than his win streak.`,
      `${p.o} spends more time at the salon getting his roots done than on the waiver wire. It shows: ${p.place} place.`,
      `${p.o}'s nails are done, his hair is dyed, his calves are missing and his team is ${p.rec}. Something has to give, and it's not the manicure.`,
      `${p.o} books his manicure before he sets his lineup. ${p.po}% playoff odds, perfect cuticles.`,
      `${p.o} works for an NFL player and still has ${an(p.dg)} draft grade. The bag guy, everyone.`,
      `${p.o} thinks he's better than everyone. ${p.rec}, ${p.pfRank} in points. He isn't.`,
      F.titles.length ? `${p.o} won it all in ${F.titles[0]} and has been acting like an NFL owner ever since. You fetch a player's dry cleaning, Mirza.` : `${p.o}, carrying an NFL player's bags doesn't make you a GM.`,
      `${p.o} walks in like he's got locker-room inside info. The only inside info he has is his boss's Starbucks order.`,
      `${p.o} acts like he's above this league. ${p.n} is ${p.place}. Sit down.`,
      `${p.o} has a manicure appointment every Tuesday and ${F.winning ? 'a lucky break' : 'a loss'} every Sunday.`,
      `${p.o} wears pants to the beach. His calves have been in witness protection since birth.`,
      `${p.o}'s hair color comes from a box. So does his lineup advice.`,
      `${p.o} calls his mom after every loss. She's heard from him ${p.l} times this season.`,
      `${p.o} thinks he's better than everybody. His ${p.rec} record begs to differ.`,
      F.titles.length && `${p.o} won in ${F.titles[0]} and wears it like cologne nobody asked for.`,
      `${p.o} would rather get a facial than a free agent. ${an(p.wg)} on waivers.`,
      `${p.o}'s calves are like his playoff odds: thin and hidden. ${p.po}%.`,
      `${p.o} has mommy issues and a ${p.rec} record. Call her, she'll tell you you're still special.`,
      `${p.o} carries an NFL player's bags and still can't carry ${p.n}.`,
      `${p.o} dyes the gray out of his hair every month. ${p.n} put most of it there.`,
      `${p.o} wears pants in 100 degrees. That's commitment. Wish he'd commit to a lineup.`,
      `${p.o} got his eyebrows done before the draft. Draft grade ${p.dg}. Should've done the homework instead.`,
      `${p.o} name-drops his NFL boss more than he drops bad players.`,
      `${p.o} thinks fetching coffee for an NFL player makes him a scout.`,
      `${p.o} hasn't done a calf raise in 30 years and it shows every time he wears shorts. So, never.`,
      `${p.o}'s mom still thinks he's the champ. Somebody tell her it's ${p.rec}.`,
      F.titles.length && `${p.o} acts like the ${F.titles[0]} title made him royalty. It made him lucky, once.`,
      `${p.o}: polished nails, colored hair, ${p.place} place. Glam on the outside, garbage on the inside.`,
      `${p.o} would look at his lineup but he just got his nails done.`,
      p.top && `${p.o} leans on ${p.top} the way he leans on his mother: ${p.share}% of his points.`,
      `${p.o} spends more on skincare than he'll ever win in this league.`,
      `${p.o} works in the NFL like a ball boy works in the NBA.`,
      `${p.o} wears pants to the pool. ${p.n} wears an L to every matchup.`,
      `${p.o} thinks he's the smartest guy in the room. The room is ${p.rec}.`,
    ]; } },
  ];
  // more numbers, for everyone (on top of roastLines / frontrunner)
  function moreLines(F) {
    const { o, n, rec } = F; const L = []; const add = (c, s) => { if (c) L.push(s); };
    const wk = F.weeks || [], lg = F.lgAvg, avgN = Number(F.avg);
    const under100 = wk.filter((w) => w.pts < 100).length;
    const gr = (k) => (F.card[k] && F.card[k].g) || null;
    add(F.best, F.best && `${o}'s best week was ${f1(F.best.pts)} in week ${F.best.wk}. ${F.He}'s been chasing that high ever since like a guy at a slot machine.`);
    add(F.best && F.worst, F.best && F.worst && `${o} has scored ${f1(F.best.pts)} and ${f1(F.worst.pts)} this season. Same lineup energy, different tide. Nobody knows which ${n} is showing up, least of all ${o}.`);
    add(avgN < lg - 3, `${o} averages ${F.avg} a week. League average is ${f1(lg)}. Below average is a compliment ${F.he} hasn't earned.`);
    add(avgN >= lg + 3 && !F.winning, `${o} scores ${F.avg} a week and is still ${rec}. Puts up points like a contender, wins like a doormat.`);
    add(F.pfRankN <= 3 && !F.winning, `${o} is ${F.pfRank} in points and ${rec}. Somehow the most expensive way to lose.`);
    add(F.luck < -0.5, `${o} has ${F.xw} expected wins and ${F.w} real ones. The universe hates ${F.him}, and honestly, the universe has a point.`);
    add(F.benchRank === 1, `${o} has left more points on the bench than anyone in the league: ${F.bench}. Leading the league in something, finally.`);
    add(F.effRank <= 3 && !F.winning, `${o} starts ${F.his} best possible lineup ${F.eff}% of the time and is still ${rec}. The lineup is right. The roster is just garbage.`);
    add(F.apw + F.apl > 0, `If ${o} played all nine teams every week ${F.he}'d win ${Math.round(100 * F.apw / Math.max(1, F.apw + F.apl))}% of the time. ${F.apw / Math.max(1, F.apw + F.apl) < 0.5 ? 'Bad against one team, worse against all of them.' : "Imagine being that good on paper and that bad at actually winning."}`);
    add(F.car && F.car.rank >= 6, F.car && `${o} is ${ord(F.car.rank)} on the all-time legacy list. History will remember ${F.him} as filler.`);
    add(gr('draft') && /[CDF]/.test(gr('draft')), `${o} got ${an(gr('draft'))} on the draft. ${F.He} drafted like ${F.he} was doing it from a porta-potty with one bar of signal.`);
    add(gr('wire') && /[CDF]/.test(gr('wire')), `${o} has ${an(gr('wire'))} on waivers. The wire is free, ${o}. It costs nothing to be less bad.`);
    add(gr('lineup') && /[CDF]/.test(gr('lineup')), `${o}'s lineup grade is ${gr('lineup')}. ${F.He} has one job on Sunday morning and fails it before the coffee's done.`);
    add(F.streak && F.streak.n >= 2 && F.streak.won === false, F.streak && `${o} has lost ${F.streak.n} straight. That's not a skid, that's a lifestyle choice.`);
    add(F.streak && F.streak.n >= 3 && F.streak.won === true, F.streak && `${o} has won ${F.streak.n} straight and the ego has grown with every one. Enjoy it, the fall is coming.`);
    add(F.beatdown, F.beatdown && `Week ${F.beatdown.wk}: ${F.own(F.beatdown.opp)} beat ${o} by ${f1(-F.beatdown.m)}. That wasn't a loss, it was a public execution.`);
    add(F.skinniest, F.skinniest && `${o} beat ${F.own(F.skinniest.opp)} by ${f1(F.skinniest.m)} in week ${F.skinniest.wk} and has been acting like it was a blowout ever since.`);
    add(F.paRank >= 8 && F.winning, `${o} has faced one of the softest schedules in the league (${ord(11 - F.paRank)}-fewest points against). ${rec} with training wheels.`);
    add(under100 >= 2, `${o} has been held under 100 points ${under100} times. That's not a team, that's a bye week with a logo.`);
    add(F.po < 15, `${o}'s playoff odds are ${F.po}%. Start shopping for a Toilet Bowl outfit.`);
    add(F.seed >= 7, `${o} is ${F.place}. Toilet Bowl seeding is basically locked in. Start practicing the punishment.`);
    add(F.posts >= 5 && !F.winning, `${o} has posted ${F.posts} times in Trash Talk and is ${rec}. Talks like a champion, plays like a chump.`);
    add(F.poops >= 5, `${o} has logged ${F.poops} 💩 on the Dump Log. More production than ${F.his} lineup.`);
    add(F.leaderGap > 15, `${o} averages ${f1(F.leaderGap)} fewer points a week than ${F.leader}. That's not a gap, that's a canyon.`);
    add(true, `${o} named ${F.his} team ${n}. Still only the second-worst decision ${F.he}'s made this season.`);
    add(F.last && F.last.pts < F.last.opp_pts && F.last.opp_pts - F.last.pts >= 15, F.last && `Last week ${F.own(F.last.opp)} beat ${o} by ${f1(F.last.opp_pts - F.last.pts)}. ${o} is still looking for the license plate.`);
    add(F.l >= 5, `${o} has ${F.l} losses already. Every one of them came with a "next week, watch."`);
    add(F.lostTrade, F.lostTrade && `${o} still thinks the ${F.lostTrade.with} trade was fair. ${F.lostTrade.with} thinks it was Christmas.`);
    add(F.dropped, F.dropped && `${F.dropped.name} sends ${o} a thank-you card every week for the release.`);
    return L.filter(Boolean);
  }
  let lastRoast = '';
  // Every roast for a person, shuffled like a deck: nothing repeats until you've seen them all.
  function roastPool(tid) {
    const F = roastFacts(tid), mine = PERSONAL.find((p) => p.re.test(F.o));
    const all = [...(mine ? mine.lines(F) : []), ...roastLines(F), ...moreLines(F), ...weekLines(F)].filter((x) => typeof x === 'string' && x.trim());
    return [...new Set(all)];
  }
  function roast(tid) {
    if (!T[tid]) return '';
    const pool = roastPool(tid); if (!pool.length) return '';
    const keyOf = (x) => x.replace(/[\d.,%-]+/g, '#').slice(0, 80); // same joke with new numbers still counts as seen
    const sk = 'roast-seen-' + tid;
    let seen = []; try { seen = JSON.parse(store.get(sk) || '[]'); } catch { seen = []; }
    let fresh = pool.filter((x) => !seen.includes(keyOf(x)) && x !== lastRoast);
    if (!fresh.length) { seen = []; fresh = pool.filter((x) => x !== lastRoast); }
    const out = fresh[Math.floor(Math.random() * fresh.length)] || pool[0];
    seen.push(keyOf(out)); store.set(sk, JSON.stringify(seen.slice(-400)));
    lastRoast = out; return out;
  }
  // ---- sharing to the group chat (Messenger has no API for group chats, so we use the phone's share sheet) ----
  const APP_URL = 'https://weird-people-league.vercel.app/#talk';
  function shareCard(m) { // a 1080x1080 image of the post, for the share sheet
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 1080); gr.addColorStop(0, '#1c1f26'); gr.addColorStop(1, '#0f1115');
    x.fillStyle = gr; x.fillRect(0, 0, 1080, 1080);
    x.fillStyle = '#c2410c'; x.fillRect(0, 0, 1080, 14);
    x.font = '700 34px Inter, system-ui, sans-serif'; x.fillStyle = '#f97316'; x.fillText('💬 TRASH TALK · WEIRD PEOPLE LEAGUE', 70, 110);
    // wrap the message
    const words = (m.text || '').split(/\s+/); let size = 64; let lines;
    const wrap = (sz) => { x.font = `700 ${sz}px Inter, system-ui, sans-serif`; const out = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > 940 && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
    do { lines = wrap(size); size -= 4; } while (lines.length * size * 1.25 > 640 && size > 30);
    size += 4; x.fillStyle = '#ffffff'; x.font = `700 ${size}px Inter, system-ui, sans-serif`;
    const top = 200 + Math.max(0, (640 - lines.length * size * 1.25) / 2);
    lines.forEach((l, i) => x.fillText(l, 70, top + i * size * 1.25 + size));
    x.font = '600 40px Inter, system-ui, sans-serif'; x.fillStyle = '#9aa1ad';
    x.fillText(m.anon ? '— Anonymous' : m.bot ? '— League Bot, Tuesday roast' : `— ${T[m.t] ? T[m.t].owner : ''}, ${T[m.t] ? T[m.t].name : ''}`, 70, 960);
    x.font = '500 30px Inter, system-ui, sans-serif'; x.fillText('weird-people-league.vercel.app', 70, 1015);
    // synchronous so the share menu opens inside the tap (iPhones block it after a delay)
    const bin = atob(c.toDataURL('image/png').split(',')[1]); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'image/png' });
  }
  async function shareToChat(m, btn) {
    const who = m.bot ? 'League Bot' : m.anon ? 'Anonymous' : T[m.t] ? T[m.t].owner : '';
    const text = `${who}: ${m.text || ''}${m.gif ? '\n' + m.gif : ''}\n\n🏈 League HQ: ${APP_URL}`;
    try {
      if (navigator.share) {
        let files = [];
        // a GIF post sends the link (Messenger plays it); a text post sends a picture of the roast
        if (m.text && !m.gif && navigator.canShare) { const blob = shareCard(m); const f = new File([blob], 'trash-talk.png', { type: 'image/png' }); if (navigator.canShare({ files: [f] })) files = [f]; }
        await navigator.share(files.length ? { files, text } : { text, url: APP_URL });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); if (btn) { btn.textContent = 'Copied! Paste it in Messenger'; setTimeout(() => { btn.textContent = '📤 Share'; }, 2500); } } catch { /* nothing else to do */ }
  }
  const avatar = (tid) => { const o = (T[tid] && T[tid].owner) || '?'; const hue = (tid * 67) % 360; return el('span', { class: 'tk-av', style: `background:hsl(${hue} 55% 42%)`, text: o[0] }); };
  let PKR = null; // season Pick'em standings, for roasts
  async function loadRoastData() {
    if (!LB) loadLB();
    if (PKR && Date.now() - PKR.at < 300000) return;
    try { PKR = await getJSON(`/api/picks?year=${D.league.year}&week=${D.league.week}`); PKR.at = Date.now(); } catch { PKR = { at: Date.now(), board: {} }; }
  }
  function renderTalk() {
    loadTalk(); loadPoop(); loadRoastData();
    clearInterval(talkTimer); talkTimer = setInterval(() => { if (tab === 'talk' && !document.hidden) loadTalk(true); }, 20000);
    $('#talk-dot').hidden = true;
    const host = $('#talk-compose');
    if (!ME || !T[ME]) {
      host.replaceChildren(el('h3', { text: 'Who are you?' }), el('p', { class: 'note', text: 'Pick yourself so your trash talk has your name on it.' }),
        el('div', { class: 'pickgrid wl-pick' }, ...[...D.teams].sort((a, b) => a.owner.localeCompare(b.owner)).map((t) => { const b = el('button', { class: 'pickbtn' }, el('b', { text: t.owner }), el('span', { text: t.name })); b.addEventListener('click', () => setMe(t.id)); return b; })));
      renderTalkFeed(); return;
    }
    if (talkDraft.target == null || talkDraft.target === ME) { const g = LIVE && LIVE.games.find((x) => x.h.id === ME || x.a.id === ME); if (g) talkDraft.target = g.h.id === ME ? g.a.id : g.h.id; } // default: this week's opponent
    const tgtVal = talkDraft.target != null && talkDraft.target !== ME ? talkDraft.target : D.teams.find((x) => x.id !== ME).id;
    const ta = el('textarea', { class: 'tk-text', maxlength: '600', rows: '3', placeholder: `Say something disrespectful, ${T[ME].owner}…` }); ta.value = talkDraft.text;
    ta.addEventListener('input', () => { talkDraft.text = ta.value; });
    const gifIn = el('input', { class: 'tk-gif', type: 'url', placeholder: 'Paste a GIPHY or Tenor link (optional)' }); gifIn.value = talkDraft.gif;
    gifIn.addEventListener('input', () => { talkDraft.gif = gifIn.value; });
    const tgt = el('select', { class: 'wk-pick', 'aria-label': 'Roast target' }, ...D.teams.filter((x) => x.id !== ME).map((x) => el('option', { value: x.id, text: x.owner })));
    tgt.value = tgtVal; tgt.addEventListener('change', () => { talkDraft.target = Number(tgt.value); });
    const gen = el('button', { class: 'btn ghost', type: 'button', text: '🔥 Roast' });
    gen.addEventListener('click', () => { ta.value = talkDraft.text = roast(Number(tgt.value)); ta.focus(); });
    const post = el('button', { class: 'btn', type: 'button', text: talkDraft.anon ? 'Post anonymously' : 'Post' });
    const postShare = el('button', { class: 'btn ghost', type: 'button', text: 'Post + send to chat' });
    const anonBtn = el('button', { class: 'tk-anon' + (talkDraft.anon ? ' on' : ''), type: 'button', 'aria-pressed': String(talkDraft.anon), title: 'Nobody sees who posted it' }, '🕵️ Anonymous');
    anonBtn.addEventListener('click', () => { talkDraft.anon = !talkDraft.anon; talkDraft.text = ta.value; talkDraft.gif = gifIn.value; renderTalk(); });
    const doPost = async (share) => {
      post.disabled = postShare.disabled = true;
      const draft = { t: ME, text: ta.value.trim(), gif: gifIn.value.trim(), anon: talkDraft.anon };
      if (share && (draft.text || draft.gif)) shareToChat(draft, postShare); // open the share menu right away, while the tap still counts
      const ok = await talkPost({ action: 'post', text: draft.text, gif: draft.gif || undefined, anon: draft.anon || undefined });
      if (ok && draft.anon && TALK && TALK.posted) store.set('talk-anon-mine', JSON.stringify([TALK.posted, ...myAnon()].slice(0, 200)));
      if (ok) { talkDraft.text = ''; talkDraft.gif = ''; }
      renderTalk();
    };
    post.addEventListener('click', () => doPost(false));
    postShare.addEventListener('click', () => doPost(true));
    host.replaceChildren(...[
      el('div', { class: 'row-head' }, el('h3', { text: '💬 Trash Talk' }), el('span', { class: 'note', text: talkDraft.anon ? 'as 🕵️ Anonymous' : `as ${T[ME].owner}` })),
      ta, gifIn,
      el('div', { class: 'tk-row' }, el('span', { class: 'note', text: 'Roast generator:' }), tgt, gen),
      el('div', { class: 'tk-row tk-post' }, anonBtn, el('span', { class: 'sp' }), postShare, post),
      talkMsg ? el('p', { class: 'pin-err', text: talkMsg }) : null,
      el('p', { class: 'note tk-tip', text: 'GIF tip: find one on giphy.com or in your keyboard’s GIF search, tap Share → Copy link, paste it above. “Send to chat” opens your phone’s share menu: pick Messenger, then the league group.' })].filter(Boolean));
    talkMsg = '';
    renderTalkFeed();
  }
  // @Name mentions: highlighted in posts; a post that mentions you is flagged (push notifications use this too)
  const OWNERS = () => D.teams.map((t) => t.owner).filter(Boolean);
  const mentionRe = () => new RegExp('@(' + OWNERS().map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');
  const mentionIds = (text) => { const ids = []; let m3; const re = mentionRe(); while ((m3 = re.exec(text))) { const t = D.teams.find((x) => x.owner.toLowerCase() === m3[1].toLowerCase()); if (t && !ids.includes(t.id)) ids.push(t.id); } return ids; };
  const mentionsMe = (text) => !!(ME && T[ME] && new RegExp('@' + T[ME].owner + '\\b', 'i').test(text || ''));
  function richText(text) {
    const out = []; let last = 0; const re = mentionRe(); let m2;
    while ((m2 = re.exec(text))) {
      if (m2.index > last) out.push(text.slice(last, m2.index));
      const isMe = ME && T[ME] && m2[1].toLowerCase() === T[ME].owner.toLowerCase();
      out.push(el('span', { class: 'mention' + (isMe ? ' me' : ''), text: m2[0] }));
      last = m2.index + m2[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  const replyOpen = new Set(); const replyDraft = {}; let replyFocus = null;
  function renderTalkFeed() {
    const host = $('#talk-feed');
    if (!TALK) { host.replaceChildren(el('p', { class: 'note', text: 'Loading…' })); return; }
    if (!TALK.ready) { host.replaceChildren(el('p', { class: 'note', text: 'Trash Talk is unavailable right now.' })); return; }
    const all = TALK.msgs.filter((m) => T[m.t] || m.bot || m.anon);
    const kids = {}; for (const m of all) if (m.p) (kids[m.p] ||= []).push(m);
    for (const k of Object.values(kids)) k.sort((a, b) => a.at - b.at);
    const msgs = all.filter((m) => !m.p);
    const mineAnon = new Set(myAnon());
    if (!msgs.length) { host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'note', text: 'Dead quiet in here. Somebody start some shit.' }))); return; }
    const isAdmin = ME === ADMIN && pinTok();
    const whoOf = (m) => (m.bot ? ['League Bot', `Tuesday roast · ${ago(m.at)}`] : m.anon ? ['Anonymous', `${mineAnon.has(m.id) ? 'you posted this · ' : ''}${ago(m.at)}`] : [T[m.t].owner, `${T[m.t].name} · ${ago(m.at)}`]);
    const avOf = (m) => (m.bot ? el('span', { class: 'tk-av bot', text: '🤖' }) : m.anon ? el('span', { class: 'tk-av anon', text: '🕵️' }) : avatar(m.t));
    const delBtn = (m) => {
      if (!(m.t === ME || isAdmin || (m.anon && mineAnon.has(m.id)))) return null;
      const del = el('button', { class: 'linkbtn tk-del', type: 'button', text: 'Delete' });
      del.addEventListener('click', async () => { if (!del.dataset.arm) { del.dataset.arm = 1; del.textContent = 'Sure?'; return; } await talkPost({ action: 'delete', id: m.id, token: pinTok(ADMIN) }); renderTalkFeed(); });
      return del;
    };
    host.replaceChildren(...msgs.map((m) => {
      const re = el('div', { class: 'tk-re' }, ...TALK_EMOJI.map((e) => {
        const who = (m.re && m.re[e]) || [], mine = who.includes(ME);
        const b = el('button', { class: 'tk-rb' + (mine ? ' on' : '') + (who.length ? ' has' : ''), type: 'button', title: who.map((x) => T[x] ? T[x].owner : '').join(', ') }, e, who.length ? el('b', { text: String(who.length) }) : null);
        b.addEventListener('click', async () => { if (!ME) return; await talkPost({ action: 'react', id: m.id, emoji: e }); renderTalkFeed(); });
        return b;
      }));
      const sh = el('button', { class: 'linkbtn tk-share', type: 'button', text: '📤 Share' });
      sh.addEventListener('click', () => shareToChat(m, sh));
      let rb = null;
      if (m.t !== ME && T[m.t]) { // fire back at whoever posted it
        rb = el('button', { class: 'linkbtn tk-share', type: 'button', text: '🔥 Roast back' });
        rb.addEventListener('click', () => { talkDraft.target = m.t; { const r = roast(m.t); talkDraft.text = r.startsWith(T[m.t].owner) ? r : `@${T[m.t].owner} ${r}`; } renderTalk(); window.scrollTo({ top: 0, behavior: 'smooth' }); const ta = $('#talk-compose textarea'); if (ta) ta.focus({ preventScroll: true }); });
      }
      const who = whoOf(m);
      // replies
      const rs = kids[m.id] || [];
      const replyList = rs.length ? el('div', { class: 'tk-replies' }, ...rs.map((r) => {
        const w = whoOf(r);
        return el('div', { class: 'tk-reply' + (r.t === ME ? ' me' : '') + (mentionsMe(r.text) ? ' mentioned' : '') },
          avOf(r), el('div', { class: 'tk-rbody' }, el('div', { class: 'tk-rhead' }, el('b', { text: w[0] }), el('small', { text: ago(r.at) }), delBtn(r)),
            r.text ? el('p', {}, ...richText(r.text)) : null, r.gif ? el('img', { class: 'tk-gif-img', src: r.gif, alt: 'GIF', loading: 'lazy' }) : null));
      })) : null;
      const replyBtn = el('button', { class: 'linkbtn tk-replybtn', type: 'button', text: rs.length ? `💬 Reply (${rs.length})` : '💬 Reply' });
      replyBtn.addEventListener('click', () => { if (replyOpen.has(m.id)) replyOpen.delete(m.id); else { replyOpen.add(m.id); replyFocus = m.id; if (replyDraft[m.id] == null) replyDraft[m.id] = { text: !m.anon && !m.bot && m.t !== ME && T[m.t] ? `@${T[m.t].owner} ` : '', anon: false }; } renderTalkFeed(); });
      let box = null;
      if (replyOpen.has(m.id) && ME) {
        const dr = replyDraft[m.id];
        const rta = el('textarea', { class: 'tk-text tk-rtext', rows: '2', maxlength: '600', placeholder: 'Reply…' }); rta.value = dr.text;
        rta.addEventListener('input', () => { dr.text = rta.value; });
        const anon = el('button', { class: 'tk-anon' + (dr.anon ? ' on' : ''), type: 'button' }, '🕵️ Anonymous');
        anon.addEventListener('click', () => { dr.anon = !dr.anon; renderTalkFeed(); });
        const send = el('button', { class: 'btn', type: 'button', text: 'Reply' });
        send.addEventListener('click', async () => {
          if (!rta.value.trim()) return;
          send.disabled = true;
          const ok = await talkPost({ action: 'post', text: rta.value.trim(), re_to: m.id, anon: dr.anon || undefined });
          if (ok && dr.anon && TALK && TALK.posted) store.set('talk-anon-mine', JSON.stringify([TALK.posted, ...myAnon()].slice(0, 200)));
          if (ok) { delete replyDraft[m.id]; replyOpen.delete(m.id); }
          renderTalkFeed();
        });
        box = el('div', { class: 'tk-rbox' }, rta, el('div', { class: 'tk-row' }, anon, el('span', { class: 'sp' }), send), talkMsg ? el('p', { class: 'pin-err', text: talkMsg }) : null);
        if (replyFocus === m.id) { replyFocus = null; setTimeout(() => { rta.focus(); rta.setSelectionRange(rta.value.length, rta.value.length); }, 0); }
      }
      return el('div', { class: 'card tk-msg' + (m.t === ME ? ' me' : '') + (m.bot ? ' bot' : '') + (m.anon ? ' anon' : '') + (mentionsMe(m.text) ? ' mentioned' : '') },
        el('div', { class: 'tk-head' }, avOf(m), el('div', {}, el('b', { text: who[0] }), el('small', { text: who[1] })), el('div', { class: 'tk-acts' }, rb, sh, delBtn(m))),
        mentionsMe(m.text) ? el('span', { class: 'tk-tag', text: '📣 mentions you' }) : null,
        m.text ? el('p', { class: 'tk-body' }, ...richText(m.text)) : null,
        m.gif ? el('img', { class: 'tk-gif-img', src: m.gif, alt: 'GIF', loading: 'lazy' }) : null,
        el('div', { class: 'tk-foot' }, re, replyBtn), replyList, box);
    }));
  }

  // ---------- render orchestration ----------
  // ---------- Playoffs: winners bracket (seeds 1-6, byes for 1-2) and Toilet Bowl (7-10, losers advance) ----------
  function bracketSim(seeds, N = 20000) { // seeds: [teamId by seed]; returns champion counts
    const S = D.sim, str = {};
    for (const id of seeds) { const r = (D.rosters[id] || []).filter((x) => x.slot !== 'IR'); str[id] = 0.6 * optimalJS(r.map((x) => ({ pos: x.pos, v: (x.ros || 0) / Math.max(1, S.games_left) }))) + 0.4 * (S.recent[id] || S.avg); }
    let seed = 7; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const g = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const play = (a, b) => (str[a] + S.sd * g() >= str[b] + S.sd * g() ? a : b);
    const champ = Object.fromEntries(seeds.map((id) => [id, 0])), final = { ...champ };
    for (let i = 0; i < N; i++) {
      const w36 = play(seeds[2], seeds[5]), w45 = play(seeds[3], seeds[4]);
      const s1 = play(seeds[0], w45), s2 = play(seeds[1], w36); // 1 plays the lowest seed left
      final[s1]++; final[s2]++; champ[play(s1, s2)]++;
    }
    return { champ: Object.fromEntries(seeds.map((id) => [id, 100 * champ[id] / N])), final: Object.fromEntries(seeds.map((id) => [id, 100 * final[id] / N])) };
  }
  let PO_SIM = null;
  function renderPlayoffs() {
    const L = D.league, wks = D.po_weeks || [L.reg_weeks + 1, L.reg_weeks + 2, L.reg_weeks + 3];
    const bySeed = [...D.teams].sort((a, b) => (a.seed || 99) - (b.seed || 99)).map((t) => t.id);
    const winners = bySeed.slice(0, L.playoff_teams), losers = bySeed.slice(L.playoff_teams, L.playoff_teams + 4);
    const games = (D.po_games || []);
    const started = games.length > 0;
    $('#br-title').textContent = started ? `${L.year} playoffs` : 'If the season ended today';
    $('#br-pill').textContent = started ? 'Live bracket' : `After week ${Math.max(0, ...L.done)}`;
    const seedOf = Object.fromEntries(bySeed.map((id, i) => [id, i + 1]));
    const liveScore = (id, wk) => { if (!LIVE || LIVE.week !== wk) return null; const g = LIVE.games.find((x) => x.h.id === id || x.a.id === id); return g ? (g.h.id === id ? g.h.pts : g.a.pts) : null; };
    const actual = (wk, ids) => games.find((m) => m.wk === wk && ids.includes(m.h) && ids.includes(m.a));
    const slot = (id, wk, label) => {
      if (id == null) return el('div', { class: 'br-team tbd', text: label || 'TBD' });
      const pts = (() => { const m = games.find((x) => x.wk === wk && (x.h === id || x.a === id)); if (m) return m.h === id ? m.hp : m.ap; return liveScore(id, wk); })();
      return el('div', { class: 'br-team' + (id === team ? ' me' : '') }, el('span', { class: 'br-seed', text: seedOf[id] || '' }), el('span', { class: 'br-nm' }, el('b', { text: tm(id).owner }), el('small', { text: tm(id).name })), pts ? el('span', { class: 'br-pts', text: f1(pts) }) : null);
    };
    const winner = (wk, a, b) => { const m = a != null && b != null ? actual(wk, [a, b]) : null; return m && m.win && m.win !== 'UNDECIDED' ? (m.win === 'HOME' ? m.h : m.a) : null; };
    const game = (wk, a, b, la, lb) => el('div', { class: 'br-game' }, slot(a, wk, la), slot(b, wk, lb));
    const [W1, W2, W3] = wks;
    const q1 = winner(W1, winners[2], winners[5]), q2 = winner(W1, winners[3], winners[4]);
    const sA = q2, sB = q1; // 1 meets the 4/5 winner, 2 meets the 3/6 winner
    const f1w = winner(W2, winners[0], sA), f2w = winner(W2, winners[1], sB);
    const champ = winner(W3, f1w, f2w);
    const col = (title, ...kids) => el('div', { class: 'br-col' }, el('div', { class: 'br-h', text: title }), ...kids);
    $('#bracket').replaceChildren(el('div', { class: 'br-grid' },
      col(`Week ${W1} · Round 1`, el('div', { class: 'br-bye' }, slot(winners[0], W1), el('small', { text: 'bye' })), game(W1, winners[3], winners[4]), game(W1, winners[2], winners[5]), el('div', { class: 'br-bye' }, slot(winners[1], W1), el('small', { text: 'bye' }))),
      col(`Week ${W2} · Semifinals`, game(W2, winners[0], sA, null, '4/5 winner'), game(W2, winners[1], sB, null, '3/6 winner')),
      col(`Week ${W3} · Championship`, game(W3, f1w, f2w, 'Semifinal winner', 'Semifinal winner'), champ ? el('div', { class: 'br-champ', text: `🏆 ${tm(champ).owner}` }) : null)));
    // title odds
    // before the playoffs: whole rest of the season (anyone can still sneak in); once they start: the actual bracket
    let sim;
    if (started || !D.sim || !D.sim.remaining.length) sim = bracketSim(winners);
    else { if (!PO_SIM || PO_SIM.k !== D.updated) { const r = seasonSim((id) => D.rosters[id] || [], 5000, true); PO_SIM = { k: D.updated, champ: {}, final: {} }; for (const id in r) { PO_SIM.champ[id] = r[id].title; PO_SIM.final[id] = r[id].final; } } sim = PO_SIM; }
    table($('#t-title'), [{ h: 'Team', k: 'id', v: (r) => tm(r.id).owner }, { h: 'Seed', k: 'seed', n: 1, v: (r) => seedOf[r.id] }, { h: 'Playoffs', k: 'po', n: 1, bar: 1, v: (r) => tm(r.id).playoffs, f: pct },
      { h: 'Final', k: 'fi', n: 1, v: (r) => (sim.final[r.id] ?? null), f: (v) => (v == null ? '–' : pct(v)), wide: 1 }, { h: 'Title', k: 'ti', n: 1, v: (r) => (sim.champ[r.id] ?? null), f: (v) => (v == null ? '–' : pct(v)) }],
      [...D.teams].sort((a, b) => (sim.champ[b.id] ?? -1) - (sim.champ[a.id] ?? -1) || b.playoffs - a.playoffs).map((t) => ({ id: t.id })), { isMe: (r) => r.id === team });
    // toilet bowl: 7v10 and 8v9; the two losers meet; that loser is last
    const lose = (wk, a, b) => { const w = winner(wk, a, b); return w == null ? null : w === a ? b : a; };
    const tl1 = lose(W1, losers[0], losers[3]), tl2 = lose(W1, losers[1], losers[2]);
    const last = tl1 != null && tl2 != null ? lose(W2, tl1, tl2) : null;
    $('#toilet').replaceChildren(el('div', { class: 'br-grid two' },
      col(`Week ${W1} · Round 1 (losers advance)`, game(W1, losers[0], losers[3]), game(W1, losers[1], losers[2])),
      col(`Week ${W2} · Toilet Bowl`, game(W2, tl1, tl2, '7/10 loser', '8/9 loser'), last ? el('div', { class: 'br-champ toilet', text: `🚽 ${tm(last).owner} finishes dead last` }) : el('p', { class: 'note', text: started ? '' : `Right now: ${losers.map((id) => tm(id).owner).join(', ')}.` }))));
  }
  // ---------- League › Players: waiver wire by position, injury report, depth charts ----------
  const PL = { wire: null, injuries: null, depth: null, at: {} };
  let plView = ['wire', 'injuries', 'depth'].includes(store.get('pl-view')) ? store.get('pl-view') : 'wire';
  { const h0 = location.hash.slice(1).toLowerCase(); if (h0 === 'injuries' || h0 === 'depth' || h0 === 'wire') plView = h0; }
  let plPos = store.get('pl-pos') || 'WR', plSort = 'l3', plHideHurt = true, plOpen = null, plInjF = 'league', plTeam = store.get('pl-team') || null;
  async function plLoad(k) {
    if (PL[k] && Date.now() - (PL.at[k] || 0) < 10 * 60000) return;
    PL.at[k] = Date.now();
    try { PL[k] = await getJSON(`/api/players?k=${k}`); } catch (e) { PL[k] = { error: e.message }; }
    if (tab === 'league' && leagueView === 'players') renderPlayers();
  }
  const injLetter = (s) => ({ QUESTIONABLE: 'Q', Questionable: 'Q', DOUBTFUL: 'D', Doubtful: 'D', OUT: 'O', Out: 'O', INJURY_RESERVE: 'IR', 'Injured Reserve': 'IR', SUSPENSION: 'SSPD', Suspension: 'SSPD' })[s] || (s ? s.slice(0, 3) : '');
  const ownerOfPid = () => { const m = {}; for (const t of D.teams) for (const r of D.rosters[t.id] || []) m[r.pid] = t.id; return m; };
  const injById = () => { const m = {}; for (const i of (PL.injuries && PL.injuries.list) || []) if (i.id) m[i.id] = i; return m; };
  // where a player sits on his team's depth chart: "WR2"
  const depthOf = (id, team, pos) => {
    const t = PL.depth && PL.depth.teams && PL.depth.teams[team]; if (!t) return null;
    const list = t[pos === 'D/ST' ? '' : pos] || []; const i = list.indexOf(id);
    return i >= 0 ? `${pos}${i + 1}` : null;
  };
  const retTxt = (d) => {
    if (!d) return '–';
    const t = new Date(d + 'T12:00:00'), days = Math.round((t - Date.now()) / 86400000);
    const s = t.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return days <= 0 ? `${s} (any day)` : days <= 7 ? `${s} (this week)` : `${s} (${Math.round(days / 7)} wk${Math.round(days / 7) === 1 ? '' : 's'})`;
  };
  // stat columns per position, averaged over the last 3 games played
  const PLCOLS = {
    QB: [['pyd', 'Pass yds', 'avg'], ['ptd', 'Pass TD', 'sum'], ['int', 'INT', 'sum', 1], ['ruyd', 'Rush yds', 'avg', 1]],
    RB: [['car', 'Carries', 'avg'], ['ruyd', 'Rush yds', 'avg', 1], ['tgt', 'Targets', 'avg'], ['rec', 'Catches', 'avg', 1], ['td', 'TD', 'sum', 1]],
    WR: [['tgt', 'Targets', 'avg'], ['rec', 'Catches', 'avg', 1], ['reyd', 'Yards', 'avg'], ['td', 'TD', 'sum', 1]],
    TE: [['tgt', 'Targets', 'avg'], ['rec', 'Catches', 'avg', 1], ['reyd', 'Yards', 'avg'], ['td', 'TD', 'sum', 1]],
    K: [['fg', 'FG', 'frac'], ['xpm', 'XP', 'sum']],
    'D/ST': [['dsk', 'Sacks', 'avg'], ['to', 'Takeaways', 'sum'], ['pa', 'Pts allowed', 'avg', 1]],
  };
  // main waiver table: what each column shows, per position. g = 'l3' (per game, last 3), 'szn' (season), 'last' (last game)
  const perG = (p, k) => { const w = l3(p); return w.length ? w.reduce((s, x) => s + wv(x, k), 0) / w.length : null; };
  const sumL3 = (p, k) => { const w = l3(p); return w.length ? w.reduce((s, x) => s + wv(x, k), 0) : null; };
  const szn = (p, k) => (p.season && p.season.gp ? (p.season[k] || 0) / p.season.gp : null);
  const ratio = (a, b, mul = 1) => (b ? (a || 0) / b * mul : null);
  const lastG = (p) => (p.weeks || []).slice(-1)[0] || null;
  const pct0 = (v) => (v == null ? '–' : `${Math.round(v)}%`);
  const n1 = (v) => (v == null ? '–' : f1(v));
  const n0 = (v) => (v == null ? '–' : String(Math.round(v)));
  const recv = [
    { h: 'Targets', g: 'l3', t: 'Targets per game, last 3 games (▲▼ = up or down vs his season average)', v: (p) => perG(p, 'tgt'), f: n1, trend: (p) => (perG(p, 'tgt') ?? 0) - (szn(p, 'tgt') ?? 0) },
    { h: 'Catches', g: 'l3', t: 'Catches per game, last 3 games', v: (p) => perG(p, 'rec'), f: n1, m: 1 },
    { h: 'Yards', g: 'l3', t: 'Receiving yards per game, last 3 games', v: (p) => perG(p, 'reyd'), f: n1 },
    { h: 'TD', g: 'l3 total', t: 'Touchdowns, last 3 games combined', v: (p) => sumL3(p, 'td'), f: n0, m: 1 },
    { h: 'Targets', g: 'season', t: 'Targets per game this season', v: (p) => szn(p, 'tgt'), f: n1, m: 1 },
    { h: 'Catch %', g: 'season', t: 'Catches ÷ targets this season', v: (p) => ratio(p.season && p.season.rec, p.season && p.season.tgt, 100), f: pct0, m: 1 },
    { h: 'Yds/tgt', g: 'season', t: 'Receiving yards per target this season', v: (p) => ratio(p.season && p.season.reyd, p.season && p.season.tgt), f: n1, m: 1 },
    { h: 'Last game', g: '', t: 'Catches-yards (targets) in his last game', v: (p) => { const w = lastG(p); return w ? `${w.rec || 0}-${w.reyd || 0} (${w.tgt || 0})` : null; }, f: (v) => v || '–', m: 1, str: 1 },
  ];
  const PLMAIN = {
    WR: recv, TE: recv,
    RB: [
      { h: 'Carries', g: 'l3', t: 'Carries per game, last 3 games', v: (p) => perG(p, 'car'), f: n1 },
      { h: 'Rush yds', g: 'l3', t: 'Rushing yards per game, last 3 games', v: (p) => perG(p, 'ruyd'), f: n1, m: 1 },
      { h: 'Targets', g: 'l3', t: 'Targets per game, last 3 games', v: (p) => perG(p, 'tgt'), f: n1 },
      { h: 'Touches', g: 'l3', t: 'Carries + catches per game, last 3 games (▲▼ = up or down vs his season average)', v: (p) => { const a = perG(p, 'car'), b = perG(p, 'rec'); return a == null ? null : a + (b || 0); }, f: n1, m: 1, trend: (p) => { const a = perG(p, 'car'), b = perG(p, 'rec'), sz = p.season && p.season.gp ? ((p.season.car || 0) + (p.season.rec || 0)) / p.season.gp : 0; return (a || 0) + (b || 0) - sz; } },
      { h: 'TD', g: 'l3 total', t: 'Rushing + receiving TDs, last 3 games combined', v: (p) => sumL3(p, 'td'), f: n0, m: 1 },
      { h: 'Touches', g: 'season', t: 'Carries + catches per game this season', v: (p) => (p.season && p.season.gp ? ((p.season.car || 0) + (p.season.rec || 0)) / p.season.gp : null), f: n1, m: 1 },
      { h: 'Yds/carry', g: 'season', t: 'Rushing yards per carry this season', v: (p) => ratio(p.season && p.season.ruyd, p.season && p.season.car), f: n1, m: 1 },
      { h: 'Last game', g: '', t: 'Carries-rush yds, catches-rec yds in his last game', v: (p) => { const w = lastG(p); return w ? `${w.car || 0}-${w.ruyd || 0}, ${w.rec || 0}-${w.reyd || 0}` : null; }, f: (v) => v || '–', m: 1, str: 1 },
    ],
    QB: [
      { h: 'Pass att', g: 'l3', t: 'Pass attempts per game, last 3 games', v: (p) => perG(p, 'patt'), f: n1, m: 1 },
      { h: 'Pass yds', g: 'l3', t: 'Passing yards per game, last 3 games', v: (p) => perG(p, 'pyd'), f: n1 },
      { h: 'Pass TD', g: 'l3 total', t: 'Passing TDs, last 3 games combined', v: (p) => sumL3(p, 'ptd'), f: n0 },
      { h: 'INT', g: 'l3 total', t: 'Interceptions, last 3 games combined', v: (p) => sumL3(p, 'int'), f: n0, m: 1 },
      { h: 'Rush yds', g: 'l3', t: 'Rushing yards per game, last 3 games', v: (p) => perG(p, 'ruyd'), f: n1, m: 1 },
      { h: 'Comp %', g: 'season', t: 'Completions ÷ attempts this season', v: (p) => ratio(p.season && p.season.cmp, p.season && p.season.patt, 100), f: pct0, m: 1 },
      { h: 'Last game', g: '', t: 'Passing yards / TDs / INTs in his last game', v: (p) => { const w = lastG(p); return w ? `${w.pyd || 0} yds, ${w.ptd || 0} TD, ${w.int || 0} INT` : null; }, f: (v) => v || '–', m: 1, str: 1 },
    ],
    K: [
      { h: 'FG', g: 'l3 total', t: 'Field goals made/attempted, last 3 games', v: (p) => { const w = l3(p); return w.length ? `${w.reduce((s, x) => s + (x.fgm || 0), 0)}/${w.reduce((s, x) => s + (x.fga || 0), 0)}` : null; }, f: (v) => v || '–', str: 1 },
      { h: 'XP', g: 'l3 total', t: 'Extra points made, last 3 games', v: (p) => sumL3(p, 'xpm'), f: n0 },
      { h: 'FG %', g: 'season', t: 'Field goal percentage this season', v: (p) => ratio(p.season && p.season.fgm, p.season && p.season.fga, 100), f: pct0, m: 1 },
      { h: 'FG att', g: 'season', t: 'Field goal attempts per game this season', v: (p) => szn(p, 'fga'), f: n1, m: 1 },
    ],
    'D/ST': [
      { h: 'Sacks', g: 'l3', t: 'Sacks per game, last 3 games', v: (p) => perG(p, 'dsk'), f: n1 },
      { h: 'Takeaways', g: 'l3 total', t: 'Interceptions + fumble recoveries, last 3 games', v: (p) => sumL3(p, 'to'), f: n0 },
      { h: 'Pts allowed', g: 'l3', t: 'Points allowed per game, last 3 games', v: (p) => perG(p, 'pa'), f: n1, m: 1 },
      { h: 'Yds allowed', g: 'l3', t: 'Yards allowed per game, last 3 games', v: (p) => perG(p, 'ya'), f: n0, m: 1 },
    ],
  };
  const OUTISH = /^(Out|Injured Reserve|Doubtful|Suspension)$/;
  // hurt teammates at the skill positions; the ones ahead of him at his position open a door
  function injMates(p) {
    const list = ((PL.injuries && PL.injuries.list) || []).filter((i) => i.team === p.team && i.id !== p.id && ['QB', 'RB', 'WR', 'TE'].includes(i.pos));
    const T0 = (PL.depth && PL.depth.teams && PL.depth.teams[p.team]) || {}, dl = T0[p.pos] || [];
    const me = dl.indexOf(p.id);
    const rows = list.map((i) => { const at = (T0[i.pos] || []).indexOf(i.id); return { ...i, depth: at >= 0 ? `${i.pos}${at + 1}` : i.pos, ahead: i.pos === p.pos && me >= 0 && at >= 0 && at < me, out: OUTISH.test(i.status) }; })
      .sort((a, b) => (b.ahead - a.ahead) || (b.out - a.out));
    const outAhead = rows.filter((r) => r.ahead && r.out).length;
    return { rows, me, outAhead, role: me >= 0 ? `${p.pos}${me + 1}` : null, nowRole: me >= 0 && outAhead ? `${p.pos}${me + 1 - outAhead}` : null };
  }
  function matesTip(ev, p, m) {
    const head = m.nowRole ? `${p.name}: ${m.role} → ${m.nowRole} this week` : `${p.team} injuries`;
    const body = m.rows.map((r) => `${r.ahead ? '⬆ ' : ''}${r.name} (${r.depth}) – ${r.status}${r.part ? ', ' + r.part : ''}${r.ret ? ', back ~' + retTxt(r.ret) : ''}`).join('\n')
      + (m.outAhead ? `\n\n${m.outAhead === 1 ? 'Someone' : m.outAhead + ' players'} ahead of him on the depth chart ${m.outAhead === 1 ? 'is' : 'are'} out or doubtful, so he should see more work.` : '');
    tip.show(ev, head, '\n' + body); tipEl.dataset.k = 'mates';
  }
  document.addEventListener('click', (e) => { if (tipEl.dataset.k === 'mates' && !e.target.closest('.pl-mates')) { tip.hide(); tipEl.dataset.k = ''; } });
  const byeOf = () => { const m = {}; for (const f of Object.values(D.waivers || {}).flat()) if (f.bye_wk) m[f.team] = f.bye_wk; for (const t of D.teams) for (const r of D.rosters[t.id] || []) if (r.bye_wk) m[r.nfl] = r.bye_wk; return m; };
  const wv = (w, k) => (k === 'td' ? (w.rutd || 0) + (w.retd || 0) : k === 'to' ? (w.dint || 0) + (w.dfr || 0) : w[k] || 0);
  const l3 = (p) => (p.weeks || []).slice(-3);
  const agg = (p, k, how) => {
    const w = l3(p); if (!w.length) return null;
    if (how === 'frac') return `${w.reduce((s, x) => s + (x.fgm || 0), 0)}/${w.reduce((s, x) => s + (x.fga || 0), 0)}`;
    const sum = w.reduce((s, x) => s + wv(x, k), 0);
    return how === 'sum' ? sum : sum / w.length;
  };
  const l3pts = (p) => { const w = l3(p); return w.length ? w.reduce((s, x) => s + x.pts, 0) / w.length : null; };
  function renderPlayers() {
    $$('#pl-seg button').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.v === plView)); b.onclick = () => { plView = b.dataset.v; store.set('pl-view', plView); renderPlayers(); }; });
    // every view uses the injury list and depth charts for context
    plLoad('injuries'); plLoad('depth'); if (plView === 'wire') plLoad('wire');
    const host = $('#pl-body');
    ({ wire: plWire, injuries: plInjuries, depth: plDepth })[plView](host);
  }
  function plWire(host) {
    const W = PL.wire;
    if (!W) return host.replaceChildren(el('p', { class: 'note', text: 'Loading the waiver wire from ESPN…' }));
    if (W.error) return host.replaceChildren(el('p', { class: 'note', text: W.error }));
    const INJ = injById(), nfl = nflByAbbr();
    const posSeg = el('div', { class: 'seg pl-pos' }, ...['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map((p) => { const b = el('button', { type: 'button', 'aria-pressed': String(p === plPos), text: p }); b.onclick = () => { plPos = p; store.set('pl-pos', p); plOpen = null; plSort = 'l3'; renderPlayers(); }; return b; }));
    const cols = PLMAIN[plPos], BYE = byeOf();
    const sorts = [['l3', 'Last 3 games'], ['proj', `Week ${W.week} projection`], ['own', 'Most owned'], ['trend', 'Trending up'], ['opp', 'Moving up the depth chart'], ...(plPos === 'WR' || plPos === 'TE' || plPos === 'RB' ? [['use', plPos === 'RB' ? 'Touches' : 'Targets']] : [])];
    const sel = el('select', { class: 'pl-sort', 'aria-label': 'Sort' }, ...sorts.map(([v, t]) => el('option', { value: v, text: `Sort: ${t}` })));
    sel.value = plSort; sel.onchange = () => { plSort = sel.value; renderPlayers(); };
    const hurt = el('label', { class: 'pl-chk' }, el('input', { type: 'checkbox' }), ' Hide Out / IR');
    hurt.firstChild.checked = plHideHurt; hurt.firstChild.onchange = (e) => { plHideHurt = e.target.checked; renderPlayers(); };
    let rows = W.players.filter((p) => p.pos === plPos);
    if (plHideHurt) rows = rows.filter((p) => !/OUT|INJURY_RESERVE|SUSPENSION/.test(p.inj || ''));
    const key = { opp: (p) => { const m = injMates(p); return m.outAhead * 100 + (l3pts(p) || 0); }, l3: l3pts, proj: (p) => p.proj ?? -1, own: (p) => p.own, trend: (p) => p.ownChg, use: (p) => (plPos === 'RB' ? (agg(p, 'car', 'avg') || 0) + (agg(p, 'rec', 'avg') || 0) : agg(p, 'tgt', 'avg') || 0) }[plSort];
    rows = rows.sort((a, b) => (key(b) ?? -1) - (key(a) ?? -1)).slice(0, 30);
    const tbl = el('table', { class: 'pl-tbl' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Player' }), el('th', { class: 'n', title: 'Spot on his team’s depth chart. Green = moving up because someone ahead of him is hurt.' }, 'Role', el('small', { text: 'depth' })),
        ...cols.map((c) => el('th', { class: 'n' + (c.m ? ' wide' : '') + (c.g === 'season' ? ' szn' : ''), title: c.t }, c.h, el('small', { text: c.g === 'l3' ? 'per game' : c.g === 'l3 total' ? 'last 3' : c.g === 'season' ? 'season' : '' }))),
        el('th', { class: 'n', title: 'Fantasy points per game, last 3 games' }, 'Pts', el('small', { text: 'per game' })), el('th', { class: 'n', title: 'ESPN projection this week' }, `Wk ${W.week}`, el('small', { text: 'proj' })),
        el('th', { class: 'n wide', title: 'ESPN rest-of-season projection' }, 'ROS', el('small', { text: 'proj' })), el('th', { class: 'n wide', title: 'Points this week’s opponent allows to the position, and its rank (1st = toughest)' }, 'Matchup', el('small', { text: 'opp allows' })),
        el('th', { class: 'n wide', text: 'Bye' }), el('th', { class: 'n wide' }, 'Owned', el('small', { text: 'ESPN, 1-wk change' })))),
      el('tbody', {}, ...rows.flatMap((p) => {
        const inj = INJ[p.id], x = nfl[p.team], mates = injMates(p);
        let badge = null;
        if (mates.rows.length) {
          badge = el('button', { type: 'button', class: 'pl-mates' + (mates.outAhead ? ' up' : ''), title: 'Injured teammates', 'aria-label': `${mates.rows.length} injured teammates`, text: `🚑 ${mates.rows.length}` });
          badge.addEventListener('click', (e) => { e.stopPropagation(); matesTip(e, p, mates); });
          if (canHover) { badge.addEventListener('mouseenter', (e) => matesTip(e, p, mates)); badge.addEventListener('mouseleave', () => tip.hide()); }
        }
        const roleCell = el('td', { class: 'n pl-role' }, mates.role ? el('span', { class: 'pl-rchip' + (mates.nowRole ? ' up' : ''), title: mates.nowRole ? `${mates.role} on the depth chart, ${mates.nowRole} with the injuries ahead of him` : `${mates.role} on the depth chart` }, mates.nowRole ? `${mates.role}→${mates.nowRole}` : mates.role) : el('span', { class: 'muted', text: '–' }), badge);
        const tr = el('tr', { class: 'pl-row' + (plOpen === p.id ? ' open' : '') },
          el('td', { class: 'pl-nm' }, el('b', { text: p.name }), el('small', {}, `${p.team}${p.status === 'WAIVERS' ? ' · waivers' : ''}`, p.inj && p.inj !== 'ACTIVE' ? el('b', { class: 'pl-injb', text: injLetter(p.inj) }) : null)),
          roleCell,
          ...cols.map((c) => { const v = c.v(p), tr = c.trend ? c.trend(p) : 0; return el('td', { class: 'n' + (c.m ? ' wide' : '') + (c.g === 'season' ? ' szn' : '') + (c.str ? ' str' : ''), title: c.t }, c.f(v), c.trend && v != null && Math.abs(tr) >= 1 ? el('small', { class: tr > 0 ? 'up' : 'down', title: 'Last 3 games vs season', text: tr > 0 ? ' ▲' : ' ▼' }) : null); }),
          el('td', { class: 'n b', text: l3pts(p) == null ? '–' : f1(l3pts(p)) }),
          el('td', { class: 'n', text: p.proj == null || p.proj === 0 ? '–' : f1(p.proj) }),
          el('td', { class: 'n wide', text: p.ros == null ? '–' : String(p.ros) }),
          el('td', { class: 'n wide' }, x ? oppCell(x, p.pos) : el('span', { class: 'muted', text: 'BYE' })),
          el('td', { class: 'n wide', text: BYE[p.team] ? `Wk ${BYE[p.team]}` : '–' }),
          el('td', { class: 'n wide' }, `${Math.round(p.own)}%`, p.ownChg ? el('small', { class: p.ownChg > 0 ? 'up' : 'down', text: ` ${p.ownChg > 0 ? '▲' : '▼'}${Math.abs(p.ownChg).toFixed(1)}` }) : null));
        tr.onclick = () => { plOpen = plOpen === p.id ? null : p.id; renderPlayers(); };
        return plOpen === p.id ? [tr, el('tr', { class: 'pl-det' }, el('td', { colspan: String(cols.length + 8) }, plDetail(p, inj)))] : [tr];
      })));
    host.replaceChildren(el('div', { class: 'pl-tools' }, posSeg, sel, hurt),
      el('p', { class: 'note', text: `Free agents and waiver players. “Per game” columns average his last 3 games (e.g. 4, 4 and 3 targets = 3.7 a game); “season” columns cover every game this year, and ▲▼ shows if his last 3 are up or down from that. Tap a player for week-by-week stats, the depth chart and injury news. From ESPN, updated ${new Date(W.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` }),
      rows.length ? el('div', { class: 'pl-wrap' }, tbl) : el('p', { class: 'note', text: 'Nobody available at this position.' }),
      el('p', { class: 'note' }, 'To pick someone up, use ESPN: ', el('a', { href: `https://fantasy.espn.com/football/players/add?leagueId=${(D.league && D.league.id) || 961003394}`, target: '_blank', rel: 'noopener', text: 'open the waiver wire on ESPN ↗' })));
  }
  function plDetail(p, inj) {
    const cols = PLCOLS[p.pos] || [];
    const wk = el('table', { class: 'pl-wk' }, el('thead', {}, el('tr', {}, el('th', { text: 'Week' }), el('th', { class: 'n', text: 'Pts' }), ...cols.map(([, h]) => el('th', { class: 'n', text: h })))),
      el('tbody', {}, ...[...(p.weeks || [])].reverse().map((w) => el('tr', {}, el('td', { text: `Wk ${w.wk}` }), el('td', { class: 'n b', text: f1(w.pts) }),
        ...cols.map(([k, , how]) => el('td', { class: 'n', text: how === 'frac' ? `${w.fgm || 0}/${w.fga || 0}` : String(Math.round(wv(w, k) * 10) / 10) }))))));
    const s = p.season;
    const seasonLine = s ? `Season: ${f1(s.pts)} pts${s.gp ? ` in ${s.gp} games (${f1(s.pts / s.gp)} a game)` : ''}${p.pos === 'WR' || p.pos === 'TE' ? `, ${s.tgt || 0} targets, ${s.rec || 0} catches, ${s.reyd || 0} yards` : p.pos === 'RB' ? `, ${s.car || 0} carries, ${s.ruyd || 0} yards, ${s.tgt || 0} targets` : p.pos === 'QB' ? `, ${s.pyd || 0} pass yds, ${s.ptd || 0} TD, ${s.int || 0} INT` : ''}.` : '';
    const dl = PL.depth && PL.depth.teams && PL.depth.teams[p.team] && PL.depth.teams[p.team][p.pos];
    const INJ = injById();
    const depth = dl ? el('div', { class: 'pl-depth' }, el('small', { text: `${p.team} ${p.pos} depth chart` }),
      el('ol', {}, ...dl.slice(0, 5).map((id) => { const i = INJ[id]; return el('li', { class: id === p.id ? 'me' : '' }, (PL.depth.names || {})[id] || `#${id}`, i ? el('b', { class: 'inj', text: ' ' + injLetter(i.status) }) : null); }))) : null;
    const mates = injMates(p);
    const matesEl = mates.rows.length ? el('div', { class: 'pl-matelist' }, el('small', { text: mates.nowRole ? `Injured teammates: he moves from ${mates.role} to ${mates.nowRole} with them out` : `Injured ${p.team} teammates` }),
      el('ul', {}, ...mates.rows.map((r) => el('li', { class: r.ahead ? 'ahead' : '' }, el('b', { text: `${r.name} (${r.depth})` }), ` ${r.status}${r.part ? ', ' + r.part : ''}${r.ret ? ' · est. return ' + retTxt(r.ret) : ''}`, r.ahead ? el('span', { class: 'pl-ahead', text: ' ahead of him' }) : null)))) : null;
    return el('div', { class: 'pl-detail' }, matesEl,
      inj ? el('p', { class: 'pl-injnote' }, el('b', { text: `${inj.status}${inj.part ? ` (${inj.part})` : ''}${inj.ret ? ` · est. return ${retTxt(inj.ret)}` : ''}. ` }), inj.note) : null,
      seasonLine ? el('p', { class: 'note', text: seasonLine + (p.ros != null ? ` Rest-of-season projection: ${p.ros} pts.` : '') }) : null,
      el('div', { class: 'pl-detgrid' }, el('div', { class: 'pl-wrap' }, wk), depth));
  }
  function plInjuries(host) {
    const J = PL.injuries;
    if (!J) return host.replaceChildren(el('p', { class: 'note', text: 'Loading the injury report…' }));
    if (J.error) return host.replaceChildren(el('p', { class: 'note', text: J.error }));
    const own = ownerOfPid(), wireIds = new Set(((PL.wire && PL.wire.players) || []).map((p) => p.id));
    const seg = el('div', { class: 'seg' }, ...[['league', 'Our league'], ['mine', 'My team'], ['all', 'All NFL']].map(([v, t]) => { const b = el('button', { type: 'button', 'aria-pressed': String(plInjF === v), text: t }); b.onclick = () => { plInjF = v; renderPlayers(); }; return b; }));
    let list = J.list.map((i) => ({ ...i, tid: own[i.id] || null }));
    if (plInjF === 'league') list = list.filter((i) => i.tid);
    if (plInjF === 'mine') list = list.filter((i) => i.tid === (ME || team));
    const week = Date.now() - 8 * 86400000;
    const fresh = list.filter((i) => i.date && new Date(i.date).getTime() >= week).sort((a, b) => new Date(b.date) - new Date(a.date));
    const order = { Out: 0, 'Injured Reserve': 1, Doubtful: 2, Questionable: 3 };
    const rest = list.filter((i) => !fresh.includes(i)).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.ret || 'z').localeCompare(String(b.ret || 'z')));
    const row = (i) => el('div', { class: 'pl-inj' + (i.tid && i.tid === ME ? ' me' : '') },
      el('span', { class: 'pl-st st-' + injLetter(i.status), text: injLetter(i.status) }),
      el('div', { class: 'pl-im' },
        el('div', {}, el('b', { text: i.name }), el('small', { text: ` ${i.pos} · ${i.team}${depthOf(i.id, i.team, i.pos) ? ' · ' + depthOf(i.id, i.team, i.pos) : ''}` })),
        el('div', { class: 'pl-iw' }, el('span', { text: i.part || 'Undisclosed' }), i.ret ? el('span', { text: `Est. return: ${retTxt(i.ret)}` }) : null, el('span', { class: 'pl-own', text: i.tid ? `${tm(i.tid).owner}’s team` : wireIds.has(i.id) ? 'Free agent' : 'Not rostered' })),
        i.note ? el('small', { class: 'pl-note', text: i.note }) : null));
    host.replaceChildren(el('div', { class: 'pl-tools' }, seg),
      el('p', { class: 'note', text: `NFL injury report for fantasy positions. Estimated return dates come from ESPN and change often. Updated ${new Date(J.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` }),
      el('h4', { class: 'pl-h', text: `New this week (${fresh.length})` }), ...(fresh.length ? fresh.map(row) : [el('p', { class: 'note', text: 'Nothing new in the last 8 days.' })]),
      el('h4', { class: 'pl-h', text: `Still out or banged up (${rest.length})` }), ...(rest.length ? rest.map(row) : [el('p', { class: 'note', text: 'Nobody.' })]));
  }
  function plDepth(host) {
    const DP = PL.depth;
    if (!DP) return host.replaceChildren(el('p', { class: 'note', text: 'Loading depth charts…' }));
    if (DP.error) return host.replaceChildren(el('p', { class: 'note', text: DP.error }));
    const teamsList = Object.keys(DP.teams).sort();
    if (!plTeam || !DP.teams[plTeam]) { const mine = (D.rosters[ME || team] || []).find((r) => r.starter && DP.teams[r.nfl]); plTeam = mine ? mine.nfl : teamsList[0]; }
    const sel = el('select', { class: 'pl-sort', 'aria-label': 'NFL team' }, ...teamsList.map((t) => el('option', { value: t, text: t })));
    sel.value = plTeam; sel.onchange = () => { plTeam = sel.value; store.set('pl-team', plTeam); renderPlayers(); };
    const own = ownerOfPid(), INJ = injById(), wire = new Map(((PL.wire && PL.wire.players) || []).map((p) => [p.id, p]));
    const T0 = DP.teams[plTeam];
    const x = nflByAbbr()[plTeam];
    host.replaceChildren(el('div', { class: 'pl-tools' }, sel, el('span', { class: 'note', text: x ? `Week ${D.league.week}: ${x.home ? 'vs' : '@'} ${x.them.abbr}` : '' })),
      el('div', { class: 'pl-dgrid' }, ...['QB', 'RB', 'WR', 'TE', 'K'].filter((p) => (T0[p] || []).length).map((pos) => el('div', { class: 'pl-dcol' }, el('h4', { text: pos }),
        el('ol', {}, ...(T0[pos] || []).slice(0, pos === 'WR' ? 6 : 4).map((id) => {
          const i = INJ[id], tid = own[id], w = wire.get(id);
          return el('li', { class: tid === ME ? 'me' : '' }, el('span', { text: (DP.names || {})[id] || `#${id}` }), i ? el('b', { class: 'inj', title: `${i.status}${i.part ? ' – ' + i.part : ''}${i.ret ? ', est. return ' + i.ret : ''}`, text: ' ' + injLetter(i.status) }) : null,
            el('small', { class: tid ? 'pl-tag' : w ? 'pl-tag fa' : 'pl-tag none', text: tid ? tm(tid).owner : w ? `FA ${Math.round(w.own)}%` : '' }));
        }))))),
      el('p', { class: 'note', text: 'Names show who has them in our league. Green “FA” means available on the wire. From ESPN’s team depth charts.' }));
  }
  function renderLeagueTab() {
    $$('#lsubnav button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lv === leagueView)));
    $$('#league .lview').forEach((v) => { v.hidden = v.dataset.lv !== leagueView; });
    ({ standings: renderLeague, players: renderPlayers, playoffs: renderPlayoffs, moves: renderTrades, draft: renderDraft, history: renderHistory })[leagueView]();
  }
  function renderAll() {
    if (!D) return;
    renderHeader();
    const fns = { team: renderTeam, week: renderWeek, league: renderLeagueTab, play: renderPlay, talk: renderTalk };
    try { fns[tab](); } catch (e) { console.error(e); }
  }
  function show(t, keepScroll) {
    tab = t;
    $$('.tab').forEach((s) => { s.hidden = s.id !== t; });
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.bnav button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    syncHash();
    renderAll();
    if (!keepScroll) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1).toLowerCase(); if (!h || h === routeHash() || h.includes('welcome')) return;
    const t = applyRoute(h); if (!TABS.includes(t)) return;
    if (linkGame) { playGame = linkGame; linkGame = null; } if (linkTeamView) { teamView = linkTeamView; linkTeamView = null; }
    show(t);
  });
  function setMe(id) {
    const prev = ME;
    ME = Number(id) || null;
    if (ME) store.set('me', String(ME)); else store.set('me', '');
    if (bkInst) { bkInst.destroy(); bkInst = null; }
    seenAt = 0; pingSeen();
    if (ME && (!team || team === prev)) setTeam(ME); else renderAll();
    if (!$('#welcome').hidden) renderWelcome();
  }
  function setTeam(id) {
    seenAt = 0; setTimeout(pingSeen, 0);
    team = Number(id) || null;
    if (team) store.set('team', String(team));
    const u = new URL(location.href); if (team) u.searchParams.set('team', team); else u.searchParams.delete('team');
    history.replaceState(null, '', u);
    const a = $('#rv-a'); if (a && team && a.options.length) { a.replaceChildren(); }
    renderAll();
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  // phone: bottom tab bar + "More" sheet
  $$('.bnav button[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#hdr-rundown').addEventListener('click', openWelcome);
  $('#hdr-bell').addEventListener('click', openAlerts);
  // ---------- TV mode: just the scoreboard, big, full screen, refreshing every 30 seconds ----------
  let tvLock = null, tvTimer = null;
  async function tvOn() {
    document.body.classList.add('tv');
    if (!$('#tv-exit')) { const x = el('button', { id: 'tv-exit', type: 'button', text: '✕ Exit TV mode' }); x.addEventListener('click', tvOff); document.body.append(x); }
    if (!$('#tv-clock')) document.body.append(el('div', { id: 'tv-clock' }));
    const tickClock = () => { const c = $('#tv-clock'); if (c) c.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    tickClock();
    try { await document.documentElement.requestFullscreen(); } catch { /* not allowed: still works windowed */ }
    try { tvLock = await navigator.wakeLock.request('screen'); } catch { /* fine */ }
    clearInterval(tvTimer); tvTimer = setInterval(() => { tickClock(); loadLive(); }, 30000);
    if (tab !== 'week') show('week'); else renderWeek();
    $$('#games .game').forEach((g) => g.classList.remove('open'));
    window.scrollTo(0, 0);
  }
  function tvOff() {
    document.body.classList.remove('tv'); clearInterval(tvTimer);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* fine */ }
    try { if (tvLock) tvLock.release(); } catch { /* fine */ } tvLock = null;
    renderAll();
  }
  $('#tv-btn').addEventListener('click', tvOn);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('tv')) tvOff(); });
  document.addEventListener('visibilitychange', async () => { if (!document.hidden && document.body.classList.contains('tv') && !tvLock) { try { tvLock = await navigator.wakeLock.request('screen'); } catch { /* fine */ } } });
  $$('#lsubnav button').forEach((b) => b.addEventListener('click', () => { leagueView = b.dataset.lv; store.set('lview', leagueView); syncHash(); renderLeagueTab(); }));
  // "add to home screen" nudge on phones, once, unless already installed
  (() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const phone = window.matchMedia('(max-width: 700px)').matches;
    if (standalone || !phone || store.get('install-dismissed')) return;
    const box = $('#install'), ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const close = el('button', { class: 'install-x', type: 'button', 'aria-label': 'Dismiss', text: '✕' });
    close.addEventListener('click', () => { box.hidden = true; store.set('install-dismissed', '1'); });
    const show2 = (body) => { box.replaceChildren(el('img', { src: '/icons/icon-192.png', alt: '' }), el('div', {}, el('b', { text: 'Get League HQ on your home screen' }), body), close); box.hidden = false; };
    if (ios) show2(el('span', { text: 'Tap the Share button (□↑) in Safari, then “Add to Home Screen.”' }));
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      const b = el('button', { class: 'btn', type: 'button', text: 'Install' });
      b.addEventListener('click', async () => { e.prompt(); await e.userChoice.catch(() => {}); box.hidden = true; store.set('install-dismissed', '1'); });
      show2(el('span', {}, 'Opens full screen like a real app. ', b));
    });
  })();
  $$('#subnav button').forEach((b) => b.addEventListener('click', () => { teamView = b.dataset.view; store.set('teamview', teamView); renderTeam(); const nav = $('#subnav'); if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' }); }));
  $('#team-pick').addEventListener('change', (e) => setTeam(e.target.value));
  // ---------- push notifications ----------
  const PUSH_KINDS = [['lineup', '⚠️ Lineup warnings', 'A starter is OUT, on IR or on bye before his game'], ['scores', '📈 Scores', 'Lead changes, big plays for or against you, final result'],
    ['talk', '💬 Trash Talk', 'Someone @mentions you or replies to your post'], ['pickem', '🏆 Pick’em', 'Games locking within the hour that you haven’t picked']];
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let swReg = null;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then((r) => { swReg = r; refreshBell(); }).catch(() => {});
  async function currentSub() { try { const r = swReg || await navigator.serviceWorker.ready; return await r.pushManager.getSubscription(); } catch { return null; } }
  const pushPrefs = () => { try { return { ...Object.fromEntries(PUSH_KINDS.map(([k]) => [k, true])), ...JSON.parse(store.get('push-prefs') || '{}') }; } catch { return {}; } };
  async function refreshBell() { const s = pushSupported() ? await currentSub() : null; $('#hdr-bell').classList.toggle('on', !!s); }
  const b64 = (str) => { const pad = '='.repeat((4 - (str.length % 4)) % 4); const raw = atob((str + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
  async function pushCall(body) { const r = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }
  let alertMsg = '';
  async function openAlerts() {
    let host = $('#alerts');
    if (!host) { host = el('div', { id: 'alerts', class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Notifications' }); document.body.append(host); host.addEventListener('click', (e) => { if (e.target === host) closeAlerts(); }); }
    host.hidden = false; document.body.classList.add('noscroll');
    await renderAlerts();
  }
  function closeAlerts() { const h = $('#alerts'); if (h) h.hidden = true; document.body.classList.remove('noscroll'); }
  async function renderAlerts() {
    const host = $('#alerts'); if (!host) return;
    const x = el('button', { class: 'install-x wl-x', type: 'button', 'aria-label': 'Close', text: '✕' }); x.addEventListener('click', closeAlerts);
    const card = (...kids) => host.replaceChildren(el('div', { class: 'wl-card al-card' }, x, el('h2', { text: '🔔 Notifications' }), ...kids.filter(Boolean)));
    if (!ME) return card(el('p', { class: 'note', text: 'Pick who you are first (Play tab or the welcome screen), then come back here.' }));
    if (isIOS && !standalone()) return card(el('p', { text: 'On iPhone, notifications only work from the home-screen app.' }),
      el('ol', { class: 'al-steps' }, el('li', { text: 'In Safari, tap the Share button (□↑).' }), el('li', { text: 'Tap “Add to Home Screen”.' }), el('li', { text: 'Open League HQ from your home screen and tap 🔔 again.' })));
    if (!pushSupported()) return card(el('p', { class: 'note', text: 'This browser can’t do notifications. Try Chrome or Safari, or add the app to your home screen.' }));
    if (Notification.permission === 'denied') return card(el('p', { text: 'Notifications are blocked for League HQ.' }), el('p', { class: 'note', text: isIOS ? 'Turn them on in iPhone Settings → Notifications → League HQ, then come back.' : 'Allow notifications for this site in your browser’s site settings, then come back.' }));
    const sub = await currentSub();
    const msg = alertMsg ? el('p', { class: alertMsg.startsWith('✅') ? 'note al-ok' : 'pin-err', text: alertMsg }) : null; alertMsg = '';
    if (!sub) {
      const on = el('button', { class: 'btn big', type: 'button', text: 'Turn on notifications' });
      on.addEventListener('click', async () => {
        on.disabled = true; on.textContent = 'Turning on…';
        try {
          if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications weren’t allowed.');
          const { key } = await getJSON('/api/push');
          const reg = swReg || await navigator.serviceWorker.ready;
          const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
          await pushCall({ action: 'on', team: ME, sub: s.toJSON(), prefs: pushPrefs() });
          alertMsg = '✅ Notifications are on for this phone.';
        } catch (e) { alertMsg = e.message; }
        refreshBell(); renderAlerts();
      });
      return card(el('p', { text: `Get alerts on this ${isIOS || /android/i.test(navigator.userAgent) ? 'phone' : 'device'} for ${T[ME].owner}:` }),
        el('ul', { class: 'al-list' }, ...PUSH_KINDS.map(([, lab, d]) => el('li', {}, el('b', { text: lab }), el('small', { text: d })))), msg, on);
    }
    const prefs = pushPrefs();
    const rows = PUSH_KINDS.map(([k, lab, d]) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = prefs[k] !== false;
      cb.addEventListener('change', async () => { const p2 = { ...pushPrefs(), [k]: cb.checked }; store.set('push-prefs', JSON.stringify(p2)); try { await pushCall({ action: 'prefs', endpoint: sub.endpoint, prefs: p2 }); } catch (e) { alertMsg = e.message; renderAlerts(); } });
      return el('label', { class: 'al-row' }, cb, el('span', {}, el('b', { text: lab }), el('small', { text: d })));
    });
    const test = el('button', { class: 'btn ghost', type: 'button', text: 'Send a test' });
    test.addEventListener('click', async () => {
      test.disabled = true; test.textContent = 'Sending in 6 seconds… go to your home screen';
      try {
        const j = await pushCall({ action: 'test', endpoint: sub.endpoint, delay: 6000 });
        alertMsg = j.sent ? `✅ Sent through ${j.service}. If nothing popped up, check Settings → Notifications → League HQ and make sure Allow Notifications and Banners are on.`
          : `The test was rejected${j.errors && j.errors[0] ? ` (${[j.errors[0].status, j.errors[0].body].filter(Boolean).join(': ')})` : ''}. Tap “Turn off on this device”, then turn it back on.`;
      } catch (e) { alertMsg = e.message; }
      renderAlerts();
    });
    const off = el('button', { class: 'linkbtn', type: 'button', text: 'Turn off on this device' });
    off.addEventListener('click', async () => { try { await pushCall({ action: 'off', endpoint: sub.endpoint }); } catch { /* already gone */ } try { await sub.unsubscribe(); } catch { /* fine */ } alertMsg = ''; refreshBell(); renderAlerts(); });
    return card(el('p', { class: 'note', text: `On for ${T[ME].owner} on this device. Pick what you want:` }), ...rows, msg, el('div', { class: 'tk-row' }, test, el('span', { class: 'sp' }), off));
  }
  // ---------- tidy cards: explanations behind ⓘ, deep-dive sections folded until opened ----------
  $$('.card > h3 + p.note, .card > .row-head + p.note, section > .row-head + p.note').forEach((note) => {
    const head = note.previousElementSibling, h = head.matches('h2, h3') ? head : head.querySelector('h2, h3');
    if (!h) return;
    note.classList.add('info-note'); note.hidden = true;
    const b = el('button', { class: 'info-btn', type: 'button', 'aria-label': 'What is this?', title: 'What is this?', text: 'i' });
    b.addEventListener('click', (e) => { e.stopPropagation(); note.hidden = !note.hidden; b.classList.toggle('on', !note.hidden); });
    h.append(b);
  });
  $$('.card.fold').forEach((c) => {
    const k = c.dataset.fold, head = c.querySelector(':scope > h3, :scope > .row-head');
    c.classList.toggle('open', store.get('fold-' + k) === '1');
    head.classList.add('fold-h'); head.setAttribute('role', 'button'); head.tabIndex = 0;
    const flip = () => { const o = !c.classList.contains('open'); c.classList.toggle('open', o); store.set('fold-' + k, o ? '1' : ''); if (o) renderAll(); };
    head.addEventListener('click', (e) => { if (e.target.closest('select, .info-btn')) return; flip(); });
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 200); });

  // ---------- data ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  let loadedOnce = false;
  let seenAt = 0;
  function pingSeen() {
    if (!ME || Date.now() - seenAt < 10 * 60000) return;
    seenAt = Date.now();
    fetch('/api/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: ME, app: !!(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) }) }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingSeen(); });
  async function loadLeague() {
    try {
      D = await getJSON('/api/league');
      T = Object.fromEntries(D.teams.map((t) => [t.id, t]));
      if (team && !T[team]) team = null;
      $('#error').hidden = true;
      show(tab, loadedOnce); loadedOnce = true; pingSeen();
    } catch (e) { $('#error').textContent = e.message; $('#error').hidden = false; $('#sub').textContent = 'Couldn’t load the league'; }
  }
  let liveTimer;
  async function loadLive() {
    clearTimeout(liveTimer);
    try {
      LIVE = await getJSON('/api/live');
      if (D && tab === 'team') renderTeam();
      if (D && tab === 'week') { renderScores(); renderTop(); }
      if (D && (tab === 'week' || tab === 'team')) { wpAt = 0; loadWP(); }
      maybeWelcome();
      loadTalk();
      if (tab === 'talk' && talkDraft.target == null) renderTalk();
    } catch (e) { if (!D) { $('#error').textContent = e.message; $('#error').hidden = false; } }
    liveTimer = setTimeout(loadLive, LIVE && LIVE.anyLive ? 60000 : 300000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLive(); });
  setInterval(loadLeague, 600000);
  loadLeague();
  loadLive();
})();
