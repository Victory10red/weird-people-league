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
  const TABS = ['team', 'scores', 'week', 'league', 'trades', 'draft', 'history', 'play'];

  let D = null, LIVE = null, T = {};
  let team = Number(new URLSearchParams(location.search).get('team')) || Number(store.get('team')) || null;
  let tab = (location.hash || '#team').slice(1);
  if (tab === 'live') tab = 'scores';
  if (!TABS.includes(tab)) tab = 'team';
  let wvPos = 'ALL', yrSel = null, bumpFocus = null;
  let heroOpen = null, heroWeek = null; const weekCache = {};
  let teamView = ['week', 'roster', 'outlook', 'season'].includes(store.get('teamview')) ? store.get('teamview') : 'week';

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
    sel.replaceChildren(el('option', { value: '', text: 'Pick your team…' }), ...[...D.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => el('option', { value: t.id, text: `${t.name} (${t.owner})` })));
    sel.value = team ?? '';
    $$('.tname').forEach((n) => { n.textContent = team ? tm(team).name : 'pick a team'; });
    $$('.towner').forEach((n) => { n.textContent = team ? tm(team).owner : 'pick a team'; });
    $('#po-n').textContent = L.playoff_teams;
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
        sideBlock(g.h, g.h.pts > g.a.pts), sideBlock(g.a, g.a.pts > g.h.pts), ...wpBar(hw, g.done), needLine(g.h, g.a, g.h.id === team), el('div', { class: 'lineups' }, lineupList(g.h), lineupList(g.a)));
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
    // summary tiles (always visible)
    const tile = (l, v, s2, cls) => el('div', { class: 'tile' }, el('div', { class: 'l', text: l }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: s2 }));
    $('#tiles').replaceChildren(
      tile('Record', `${t.w}-${t.l}`, `seed ${t.seed ?? '–'} · power #${t.power}`),
      tile('Points for', f1(t.pf), `${ord(t.pf_rank)} · luck ${signed(t.luck)} wins`, ''),
      tile('Playoff odds', pct(t.playoffs), t.whatif && t.whatif.seed_median ? `likely ${ord(t.whatif.seed_median)} · bye ${pct(t.bye)}` : `bye ${pct(t.bye)}`),
      tile('Report card', t.card ? t.card.gpa.toFixed(2) : '–', t.card ? `GPA · ${ord(t.card.rank)} of ${D.teams.length}` : ''));
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
        el('div', {}, el('span', { text: 'Win' }), el('b', { text: `${t.whatif.if_win}%` }), el('small', { text: 'playoff odds' })),
        el('div', {}, el('span', { text: 'Lose' }), el('b', { text: `${t.whatif.if_lose}%` }), el('small', { text: 'playoff odds' })),
        el('div', {}, el('span', { text: 'Swing' }), el('b', { text: `${t.whatif.if_win - t.whatif.if_lose} pts` }), el('small', { text: 'playoff odds at stake' }))) : null;
      if (heroOpen == null) heroOpen = window.innerWidth > 700;
      const tog = el('button', { class: 'lu-toggle', type: 'button', text: heroOpen ? 'Hide lineups ▴' : 'Show both lineups ▾' });
      tog.addEventListener('click', () => { heroOpen = !heroOpen; viewWeek(t, myLive()); });
      hero.replaceChildren(el('div', { class: 'game hero-card mine' + (heroOpen ? ' open' : '') },
        heroHead,
        sideBlock(me, me.pts > them.pts, vegasMe ? `Vegas ${f1(vegasMe)}` : ''), sideBlock(them, them.pts > me.pts, vegasThem ? `Vegas ${f1(vegasThem)}` : ''),
        ...wpBar(hw, live.done), needLine(me, them, true), stakes, tog,
        el('div', { class: 'lineups' }, lineupList(me), lineupList(them)),
        el('p', { class: 'note legend lineups-only', text: 'Q / D / O = questionable / doubtful / out. Avg = points per game this season. ESPN = ESPN projection. Vegas = his average × how much more or less Vegas expects his team to score than usual (green = Vegas likes him more than ESPN, red = less). vs Opp = points per game the opponent gives up to that position (all of its RBs or WRs combined), ranked 1st (stingiest) to 32nd. Green = soft matchup, red = tough.' })));
    } else if (m) {
      hero.replaceChildren(el('div', { class: 'game hero-card mine' }, heroHead, el('p', { class: 'note', text: `vs ${tm(m.h === team ? m.a : m.h).name}. Loading live lineups…` })));
    } else hero.replaceChildren();

    // moves
    const kinds = { 'Close call': 'k-close', Lineup: 'k-lineup', Pickup: 'k-urgent', Stream: 'k-stream', Waiver: 'k-waiver', Trade: 'k-trade', Injury: 'k-warn', Weather: 'k-warn', Vegas: 'k-warn' };
    $('#moves').replaceChildren(...(t.moves && t.moves.length ? t.moves : [{ kind: 'All set', title: 'No moves needed', detail: 'Your lineup is already optimal and nothing on waivers clearly beats what you have.' }]).map((mv) =>
      el('div', { class: 'move' + (mv.urgent ? ' urgent' : '') }, el('span', { class: 'kind ' + (kinds[mv.kind] || ''), text: mv.kind }), el('div', {}, el('b', { text: mv.title }), el('p', { text: mv.detail })))));

    renderCompare();
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
  function renderWeek() {
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
    renderAnalyzer();
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
    table($('#t-cards'), [{ h: '#', k: 'rank', n: 1 }, { h: 'Team', k: 'id', v: (r) => tm(r.id).name }, { h: 'Owner', k: 'o', v: (r) => tm(r.id).owner },
      { h: 'GPA', k: 'gpa', n: 1, f: (v) => v.toFixed(2) }, { ...g('draft'), h: 'Draft' }, { ...g('wire'), h: 'Waivers' }, { ...g('lineup'), h: 'Lineups' }, { ...g('trades'), h: 'Trades' }], D.cards || [], { isMe: meRow });
    $$('#t-cards .gl').forEach((n) => n.addEventListener('click', (e) => { const r = n.getBoundingClientRect(); tip.show({ clientX: r.left, clientY: r.top }, n.textContent, n.title); e.stopPropagation(); }));
  }

  // ---------- playoff race ----------
  function renderRace() {
    table($('#t-race'), [{ h: 'Team', k: 'id', v: (r) => tm(r.id).name }, { h: 'Rec', k: 'w', f: (_, r) => `${r.w}-${r.l}` }, { h: 'Odds', k: 'playoffs', n: 1, bar: 1, f: pct },
      { h: 'Status', k: 'status', cls: (r) => (r.status === 'Clinched' ? 'good' : r.status === 'Eliminated' || r.status === 'Long shot' ? 'bad' : '') },
      { h: 'Magic #', k: 'magic', n: 1, f: (v, r) => (r.status === 'Clinched' ? '✓' : v == null ? '–' : `${v} of ${r.left}`) },
      { h: '50/50 at', k: 'need50', f: (v) => v || '–' }, { h: 'Safe (90%) at', k: 'need90', f: (v) => v || '–' },
      { h: '', k: 'note', cls: () => 'muted' }], D.race || [], { isMe: meRow });
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
  function seasonSim(rosterOf, N = 6000) {
    const S = D.sim, ids = D.teams.map((t) => t.id);
    const ros = {}, wk = {};
    for (const t of ids) { const r = rosterOf(t).filter((x) => x.slot !== 'IR');
      ros[t] = optimalJS(r.map((x) => ({ pos: x.pos, v: (x.ros || 0) / S.games_left })));
      wk[t] = optimalJS(r.map((x) => ({ pos: x.pos, v: x.bye ? 0 : x.proj || 0 }))); }
    const str = {}; for (const t of ids) str[t] = 0.6 * ros[t] + 0.4 * S.recent[t];
    const adj = S.avg - ids.reduce((s, t) => s + str[t], 0) / ids.length; for (const t of ids) str[t] += adj;
    let seed = 961003394; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const po = Object.fromEntries(ids.map((t) => [t, 0])), byes = { ...po };
    for (let i = 0; i < N; i++) {
      const w = {}, pf = {}; for (const t of ids) { w[t] = S.base[t][0]; pf[t] = S.base[t][1]; }
      for (const [k, h, a] of S.remaining) { const sh = (k === S.cur ? wk[h] : str[h]) + S.sd * gauss(), sa = (k === S.cur ? wk[a] : str[a]) + S.sd * gauss(); pf[h] += sh; pf[a] += sa; if (sh > sa) w[h]++; else w[a]++; }
      const order = [...ids].sort((x, y) => w[y] - w[x] || pf[y] - pf[x]);
      for (let k = 0; k < S.po; k++) po[order[k]]++; byes[order[0]]++; byes[order[1]]++;
    }
    const out = {}; for (const t of ids) out[t] = { po: 100 * po[t] / N, bye: 100 * byes[t] / N, ros: ros[t], wk: wk[t] }; return out;
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


  // ---------- PLAY: Higher or Lower ----------
  const HOL_MODES = { week: 'Same week', any: 'Any week', season: 'Season totals' };
  let hol = { mode: ['week', 'any', 'season'].includes(store.get('hol-mode')) ? store.get('hol-mode') : 'week', a: null, b: null, streak: 0, wk: null, busy: false, over: false, used: new Set() };
  const holBest = (m) => Number(store.get('hol-best-' + m)) || 0;
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function holPool() {
    const G = D.game || { players: [], weeks: [] };
    const owner = (tid) => (tid != null && T[tid] ? T[tid] : null);
    if (hol.mode === 'season') {
      const curOwner = {}; for (const t of D.teams) for (const r of D.rosters[t.id] || []) curOwner[r.name] = t.id;
      return G.players.filter((p) => p.s > 0).map((p) => ({ n: p.n, p: p.p, t: p.t, v: p.s, label: `${D.league.year} season so far`, who: owner(curOwner[p.n]), started: null }));
    }
    const out = [];
    for (const p of G.players) for (const [wk, [v, tid, st]] of Object.entries(p.w)) {
      if (hol.mode === 'week' && Number(wk) !== hol.wk) continue;
      out.push({ n: p.n, p: p.p, t: p.t, v, wk: Number(wk), label: `Week ${wk}`, who: owner(tid), started: !!st });
    }
    return out;
  }
  function holPick(pool, a) {
    const ok = pool.filter((x) => x !== a && x.n !== (a && a.n) && !hol.used.has(x.n + x.label) && (!a || Math.abs(x.v - a.v) >= 0.5));
    if (!ok.length) return null;
    if (a && Math.random() < 0.7) { // keep most rounds close enough to be interesting
      const span = Math.max(8, a.v * 0.45);
      const close = ok.filter((x) => Math.abs(x.v - a.v) <= span);
      if (close.length) return rand(close);
    }
    return rand(ok);
  }
  function holNew() {
    const G = D.game || { weeks: [] };
    hol.wk = G.weeks.length ? rand(G.weeks) : null;
    hol.streak = 0; hol.over = false; hol.busy = false; hol.used = new Set();
    const pool = holPool();
    hol.a = holPick(pool, null); if (hol.a) hol.used.add(hol.a.n + hol.a.label);
    hol.b = holPick(pool, hol.a); if (hol.b) hol.used.add(hol.b.n + hol.b.label);
  }
  const POSCLR = { QB: 'pq', RB: 'pr', WR: 'pw', TE: 'pt', K: 'pk', 'D/ST': 'pd' };
  function holCard(x, hidden, side) {
    const ctx = x.who ? (hol.mode === 'season' ? `On ${x.who.owner}'s team (${x.who.name})` : `${x.started ? 'Started' : 'Benched'} by ${x.who.owner} (${x.who.name})`) : 'Free agent';
    return el('div', { class: 'hcard ' + side },
      el('div', { class: 'hpos ' + (POSCLR[x.p] || '') , text: x.p }),
      el('div', { class: 'hname', text: x.n }),
      el('div', { class: 'hteam', text: `${x.t} · ${x.label}` }),
      el('div', { class: 'hctx', text: ctx }),
      el('div', { class: 'hval', id: side === 'b' ? 'hol-bval' : null, text: hidden ? '?' : f1(x.v) }),
      el('div', { class: 'hunit', text: 'fantasy points' }));
  }
  let playGame = ['bk', 'hol'].includes(store.get('play-game')) ? store.get('play-game') : 'bk', bkInst = null;
  let LB = null, lbAt = 0, bkLevel = 'hard';
  const LB_GAME = () => (playGame === 'bk' ? `bk:${bkLevel}` : `hol:${hol.mode}`);
  async function loadLB(force) {
    if (!force && LB && Date.now() - lbAt < 60000) return;
    try { LB = await getJSON('/api/scores'); lbAt = Date.now(); } catch { LB = { ready: false, boards: {} }; }
    if (tab === 'play') renderLB();
  }
  async function postScore(game, level, score) {
    if (!team || !(score > 0)) return;
    if (score > (Number(store.get(`lb-synced-${game}:${level}`)) || 0)) store.set(`lb-synced-${game}:${level}`, String(score));
    try {
      const r = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game, level, team, score }) });
      const j = await r.json(); if (j && j.boards) { LB = j; lbAt = Date.now(); }
    } catch { /* offline: personal best is still saved on the device */ }
    if (tab === 'play') renderLB();
  }
  function renderLB() {
    const key = LB_GAME(), host = $('#lb');
    const unit = playGame === 'bk' ? 'yds' : 'in a row';
    $('#lb-title').textContent = playGame === 'bk' ? 'Breakaway leaderboard' : 'Higher or Lower leaderboard';
    $('#lb-sub').textContent = playGame === 'bk' ? ({ rookie: 'Rookie', pro: 'Pro', hard: 'All-Pro' }[bkLevel]) : HOL_MODES[hol.mode];
    if (!LB) { host.replaceChildren(el('p', { class: 'note', text: 'Loading…' })); loadLB(); return; }
    if (!LB.ready) { host.replaceChildren(el('p', { class: 'note', text: 'The league leaderboard isn\'t switched on yet (it needs a free database in Vercel). Your best score is still saved on this device.' })); return; }
    // scores set on this device before the board existed (or while offline): offer to add them once
    const pending = [];
    if (team && T[team]) {
      for (const [g, lvls, lab] of [['bk', ['rookie', 'pro', 'hard'], { rookie: 'Breakaway Rookie', pro: 'Breakaway Pro', hard: 'Breakaway All-Pro' }], ['hol', ['week', 'any', 'season'], { week: 'Higher or Lower (same week)', any: 'Higher or Lower (any week)', season: 'Higher or Lower (season)' }]]) {
        for (const l of lvls) {
          const local = Number(store.get(`${g}-best-${l}`)) || 0, done = Number(store.get(`lb-synced-${g}:${l}`)) || 0;
          const mine = (LB.boards[`${g}:${l}`] || []).find((r) => r.id === team);
          if (local > 0 && local > done && (!mine || mine.score < local)) pending.push({ g, l, v: local, lab: lab[l], unit: g === 'bk' ? 'yds' : 'in a row' });
        }
      }
    }
    const offer = pending.length ? (() => {
      const add = el('button', { class: 'btn', type: 'button', text: `Add as ${T[team].owner}` });
      const no = el('button', { class: 'linkbtn', type: 'button', text: 'Not mine' });
      add.addEventListener('click', async () => { add.disabled = true; for (const p of pending) { store.set(`lb-synced-${p.g}:${p.l}`, String(p.v)); await postScore(p.g, p.l, p.v); } renderLB(); });
      no.addEventListener('click', () => { for (const p of pending) store.set(`lb-synced-${p.g}:${p.l}`, String(p.v)); renderLB(); });
      return el('div', { class: 'lb-offer' }, el('p', {}, 'Earlier scores on this device: ', el('b', { text: pending.map((p) => `${p.lab} ${p.v} ${p.unit}`).join(', ') }), `. Put them on the board under ${T[team].owner}?`), el('div', { class: 'lb-offer-b' }, add, no));
    })() : null;
    const rows = (LB.boards[key] || []).filter((r) => T[r.id]);
    if (!rows.length) { host.replaceChildren(...[offer, el('p', { class: 'note', text: 'No scores yet. Be the first on the board.' })].filter(Boolean)); return; }
    const medal = ['🥇', '🥈', '🥉'];
    host.replaceChildren(...[offer].filter(Boolean), el('ol', { class: 'lb' }, ...rows.map((r, i) => el('li', { class: r.id === team ? 'me' : '' },
      el('span', { class: 'lb-r', text: medal[i] || String(i + 1) }),
      el('span', { class: 'lb-n' }, el('b', { text: T[r.id].owner }), el('small', { text: T[r.id].name })),
      el('span', { class: 'lb-s' }, el('b', { text: String(r.score) }), el('small', { text: unit })),
      el('span', { class: 'lb-d', text: new Date(r.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) })))));
  }
  function renderWho() {
    const host = $('#play-who');
    if (team && T[team]) {
      const chg = el('button', { class: 'linkbtn', type: 'button', text: 'Not you?' });
      chg.addEventListener('click', () => { whoOpen = true; renderPlay(); });
      if (!whoOpen) { host.replaceChildren(el('div', { class: 'who-bar' }, el('span', {}, 'Playing as ', el('b', { text: T[team].owner }), ` · ${T[team].name}`), chg)); return true; }
    }
    host.replaceChildren(el('div', { class: 'who-pick' }, el('h2', { text: 'Who are you?' }), el('p', { class: 'note', text: 'Your scores go on the league leaderboard under this name.' }),
      el('div', { class: 'pickgrid' }, ...[...D.teams].sort((a, b) => a.owner.localeCompare(b.owner)).map((t) => {
        const b = el('button', { class: 'pickbtn' }, el('b', { text: t.owner }), el('span', { text: t.name }));
        b.addEventListener('click', () => { whoOpen = false; if (bkInst) { bkInst.destroy(); bkInst = null; } setTeam(t.id); });
        return b;
      }))));
    return false;
  }
  let whoOpen = false;
  function renderPlay() {
    const ok = renderWho();
    $('#play-pick').hidden = !ok; $$('.play-game').forEach((g) => { if (!ok) g.hidden = true; }); $('.play-lb').hidden = !ok;
    if (!ok) return;
    loadLB();
    $$('#play-pick button').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.game === playGame)); b.onclick = () => { playGame = b.dataset.game; store.set('play-game', playGame); renderPlay(); }; });
    $('#play-bk').hidden = playGame !== 'bk'; $('#play-hol').hidden = playGame !== 'hol';
    if (playGame === 'bk') {
      if (!bkInst && window.Breakaway) {
        const mine = team && T[team];
        bkInst = window.Breakaway.mount($('#play-bk'), { names: D.teams.filter((x) => x.id !== team).map((x) => x.owner), me: mine ? mine.owner : 'Rookie', big: !!(mine && /^justin/i.test(mine.owner)), hair: mine && /^brandon/i.test(mine.owner) ? '#e2531f' : null, accent: css('--accent') || '#c2410c',
          onLevel: (lv) => { bkLevel = lv; renderLB(); }, onEnd: (lv, yds) => postScore('bk', lv, yds) });
      }
      renderLB();
      return;
    }
    renderHol();
    renderLB();
  }
  function renderHol() {
    if (!D.game || !D.game.players.length) { $('#hol-board').replaceChildren(el('p', { class: 'note', text: 'No games played yet this season.' })); return; }
    $('#hol-mode').replaceChildren(...Object.entries(HOL_MODES).map(([k, lab]) => { const b = el('button', { 'aria-pressed': String(k === hol.mode), text: lab }); b.addEventListener('click', () => { hol.mode = k; store.set('hol-mode', k); hol.a = null; renderHol(); renderLB(); }); return b; }));
    if (!hol.a || !hol.b) holNew();
    $('#hol-streak').textContent = hol.streak;
    $('#hol-best').textContent = holBest(hol.mode);
    const board = $('#hol-board');
    if (hol.over) {
      const s = hol.streak, best = holBest(hol.mode);
      const rank = s >= 15 ? 'Hall of Famer' : s >= 10 ? 'League winner' : s >= 6 ? 'Playoff team' : s >= 3 ? 'Waiver-wire hero' : 'Bench warmer';
      const again = el('button', { class: 'btn big', type: 'button', text: 'Play again' });
      again.addEventListener('click', () => { holNew(); renderHol(); });
      board.replaceChildren(el('div', { class: 'hover' },
        el('div', { class: 'hover-k', text: 'Game over' }),
        el('div', { class: 'hover-s', text: String(s) }),
        el('div', { class: 'hover-r', text: rank }),
        el('p', { class: 'note', text: s >= best && s > 0 ? 'New personal best on this device!' : `Your best: ${best}` }),
        el('p', { class: 'note', text: `${hol.b.n} had ${f1(hol.b.v)} vs ${hol.a.n}'s ${f1(hol.a.v)}.` }),
        again));
      again.focus();
      return;
    }
    const hi = el('button', { class: 'hbtn up', type: 'button' }, el('span', { text: '▲' }), ' Higher');
    const lo = el('button', { class: 'hbtn down', type: 'button' }, el('span', { text: '▼' }), ' Lower');
    hi.addEventListener('click', () => holGuess(true)); lo.addEventListener('click', () => holGuess(false));
    const bCard = holCard(hol.b, true, 'b');
    bCard.append(el('div', { class: 'hbtns' }, hi, lo));
    board.replaceChildren(el('p', { class: 'hq', text: `Did ${hol.b.n} score more or less than ${f1(hol.a.v)}?` }),
      holCard(hol.a, false, 'a'), el('div', { class: 'hvs', text: 'VS' }), bCard);
  }
  function holGuess(higher) {
    if (hol.busy || hol.over) return;
    hol.busy = true;
    const right = higher ? hol.b.v > hol.a.v : hol.b.v < hol.a.v;
    const valEl = $('#hol-bval'), card = valEl.closest('.hcard');
    $$('.hbtn').forEach((b) => { b.disabled = true; });
    const target = hol.b.v, t0 = performance.now(), dur = 650;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur); valEl.textContent = f1(target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); else done(); };
    const done = () => {
      card.classList.add(right ? 'right' : 'wrong');
      setTimeout(() => {
        if (right) {
          hol.streak++;
          if (hol.streak > holBest(hol.mode)) store.set('hol-best-' + hol.mode, String(hol.streak));
          const pool = holPool();
          hol.a = hol.b; hol.b = holPick(pool, hol.a);
          if (!hol.b) { hol.used = new Set([hol.a.n + hol.a.label]); hol.b = holPick(pool, hol.a); }
          if (hol.b) hol.used.add(hol.b.n + hol.b.label);
        } else { hol.over = true; postScore('hol', hol.mode, hol.streak); }
        hol.busy = false; renderHol();
      }, right ? 700 : 1100);
    };
    requestAnimationFrame(step);
  }
  document.addEventListener('keydown', (e) => {
    if (tab !== 'play' || playGame !== 'hol' || e.target.closest('select, input')) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); holGuess(true); }
    if (e.key === 'ArrowDown') { e.preventDefault(); holGuess(false); }
  });

  // ---------- render orchestration ----------
  function renderAll() {
    if (!D) return;
    renderHeader();
    const fns = { team: renderTeam, scores: renderScores, week: renderWeek, league: renderLeague, trades: renderTrades, draft: renderDraft, history: renderHistory, play: renderPlay };
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
    if (bkInst && Number(id) !== team) { bkInst.destroy(); bkInst = null; }
    team = Number(id) || null;
    if (team) store.set('team', String(team));
    const u = new URL(location.href); if (team) u.searchParams.set('team', team); else u.searchParams.delete('team');
    history.replaceState(null, '', u);
    const a = $('#rv-a'); if (a && team && a.options.length) { a.replaceChildren(); }
    renderAll();
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $$('#subnav button').forEach((b) => b.addEventListener('click', () => { teamView = b.dataset.view; store.set('teamview', teamView); renderTeam(); const nav = $('#subnav'); if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' }); }));
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
