// Breakaway: a top-down run-and-dodge game. Steer the ball carrier with the mouse or a finger,
// juke with a click / Space / the Juke button, and score touchdowns every 100 yards.
(() => {
  'use strict';
  const LEVELS = {
    rookie: { name: 'Rookie', scroll: 145, spawn: 1.15, chase: 80, turn: 1.8, lead: 0, wave: 1, grow: 0.06 },
    pro: { name: 'Pro', scroll: 185, spawn: 0.8, chase: 125, turn: 2.6, lead: 0.15, wave: 2, grow: 0.08 },
    hard: { name: 'All-Pro (hard)', scroll: 235, spawn: 0.55, chase: 175, turn: 3.6, lead: 0.35, wave: 3, grow: 0.1 },
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mount(host, { names = [], me = 'You', accent = '#c2410c', onEnd = null, onLevel = null, big = false } = {}) {
    host.replaceChildren();
    const wrap = document.createElement('div'); wrap.className = 'bk';
    const canvas = document.createElement('canvas'); canvas.className = 'bk-cv'; canvas.setAttribute('aria-label', 'Breakaway game field');
    const juke = document.createElement('button'); juke.className = 'bk-juke'; juke.type = 'button'; juke.textContent = 'JUKE';
    const overlay = document.createElement('div'); overlay.className = 'bk-ov';
    wrap.append(canvas, juke, overlay); host.append(wrap);
    const ctx = canvas.getContext('2d');

    let W = 360, H = 560, dpr = 1;
    const size = () => {
      W = Math.min(560, host.clientWidth || 360);
      H = Math.round(clamp(window.innerHeight * 0.72, 440, 640));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    let level = ['rookie', 'pro', 'hard'].includes(store.get('bk-level')) ? store.get('bk-level') : 'hard';
    const SKINS = ['#3d2516', '#5c3a21', '#8d5524', '#c68642', '#f1c27d'];
    let skin = SKINS.includes(store.get('bk-skin')) ? store.get('bk-skin') : '#5c3a21';
    let S = null, raf = 0, last = 0, running = false;
    const best = (lv) => Number(store.get('bk-best-' + lv)) || 0;

    const reset = () => {
      const L = LEVELS[level];
      S = { L, t: 0, dist: 0, td: 0, speedMul: 1, px: W / 2, py: H * 0.78, tx: W / 2, ty: H * 0.78,
        defs: [], spawnT: 0.6, jukeT: 0, jukeCD: 0, flash: 0, over: false, tackler: '', trail: [], driveStart: 0 };
    };
    const yardPx = () => H / 38; // ~38 yards visible
    const YREF = () => H * 0.78; // screen line that marks the ball's field position
    const fieldYard = () => 25 + (S.dist - S.driveStart) / yardPx();

    // ---------- input ----------
    const setTarget = (cx, cy) => { const r = canvas.getBoundingClientRect(); if (!S) return; S.tx = clamp(cx - r.left, 14, W - 14); S.ty = clamp(cy - r.top, H * 0.35, H - 18); };
    canvas.addEventListener('pointermove', (e) => setTarget(e.clientX, e.clientY));
    canvas.addEventListener('pointerdown', (e) => { setTarget(e.clientX, e.clientY); if (e.pointerType === 'mouse') doJuke(); });
    juke.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); doJuke(); });
    const onKey = (e) => { if (!running || !host.isConnected) return; if (e.code === 'Space') { e.preventDefault(); doJuke(); } };
    document.addEventListener('keydown', onKey);
    function doJuke() { if (!running || !S || S.over || S.jukeCD > 0) return; S.jukeT = 0.38; S.jukeCD = 2.2; }

    // ---------- loop ----------
    function spawn() {
      const L = S.L, n = 1 + Math.floor(Math.random() * L.wave * Math.min(1, 0.35 + S.td * 0.25 + S.t / 60));
      for (let i = 0; i < n; i++) {
        const kind = Math.random() < L.lead ? 'safety' : 'lb';
        S.defs.push({ x: 20 + Math.random() * (W - 40), y: -20 - i * 26, vx: 0, vy: 0, r: kind === 'safety' ? 12 : 13, kind,
          name: names.length ? names[Math.floor(Math.random() * names.length)] : 'D', spd: L.chase * (0.85 + Math.random() * 0.3) * (kind === 'safety' ? 1.08 : 1) });
      }
    }
    function step(dt) {
      const L = S.L;
      S.t += dt;
      const scroll = L.scroll * S.speedMul;
      // player follows the pointer, faster during a juke
      const vmax = (S.jukeT > 0 ? 760 : 430);
      const dx = S.tx - S.px, dy = S.ty - S.py, d = Math.hypot(dx, dy);
      if (d > 0.5) { const m = Math.min(d, vmax * dt); S.px += dx / d * m; S.py += dy / d * m; }
      S.jukeT = Math.max(0, S.jukeT - dt); S.jukeCD = Math.max(0, S.jukeCD - dt);
      S.trail.push([S.px, S.py]); if (S.trail.length > 8) S.trail.shift();
      // field moves down = you gain yards
      S.dist += scroll * dt;
      // each drive starts at your own 25; reaching their goal line is a touchdown
      if (fieldYard() >= 100) { S.td++; S.flash = 1.4; S.speedMul *= 1 + L.grow; S.defs = []; S.driveStart = S.dist; S.spawnT = 0.9; }
      S.flash = Math.max(0, S.flash - dt);
      // defenders pursue (in field coordinates they also drift down with the scroll)
      S.spawnT -= dt;
      if (S.spawnT <= 0) { spawn(); S.spawnT = L.spawn / Math.sqrt(S.speedMul) * (0.75 + Math.random() * 0.5); }
      for (const e of S.defs) {
        const lead = e.kind === 'safety' ? 0.45 : 0.12;
        const gx = S.px + (S.tx - S.px) * lead, gy = S.py - scroll * lead * 0.2;
        const ax = gx - e.x, ay = gy - e.y, ad = Math.hypot(ax, ay) || 1;
        const want = Math.atan2(ay, ax), cur = Math.atan2(e.vy, e.vx || 0.0001);
        let diff = want - cur; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        const ang = (e.vx === 0 && e.vy === 0) ? want : cur + clamp(diff, -L.turn * dt, L.turn * dt);
        const sp = e.spd * Math.sqrt(S.speedMul) * (S.jukeT > 0 ? 0.55 : 1); // a juke freezes them for a beat
        e.vx = Math.cos(ang) * sp; e.vy = Math.sin(ang) * sp;
        e.x += e.vx * dt; e.y += (e.vy + scroll) * dt;
        if (Math.hypot(e.x - S.px, e.y - (S.py - 3)) < e.r + 11 && S.jukeT <= 0.12) { S.over = true; S.tackler = e.name; }
      }
      S.defs = S.defs.filter((e) => e.y < H + 40 && e.x > -40 && e.x < W + 40);
    }

    // ---------- drawing ----------
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    // the ball carrier, seen from behind as he runs up the field
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
    function drawCarrier(x, y, t, juking) {
      const ph = t * 16, leg = Math.sin(ph) * 4.5, arm = Math.cos(ph) * 3.5;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y + 17, big ? 19 : 13, 5, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
      // big build: widen the body and add a little waddle (cosmetic only; the tackle area is the same)
      if (big) { ctx.translate(x, y); ctx.rotate(Math.sin(ph / 2) * 0.06); ctx.scale(1.5, 1); ctx.translate(-x, -y); }
      // legs: skin calves, white socks, black cleats
      for (const [dx, off] of [[-5, leg], [5, -leg]]) {
        rr(x + dx - 2.6, y + 6 + off, 5.2, 8, 2); ctx.fillStyle = skin; ctx.fill();
        rr(x + dx - 2.8, y + 12 + off, 5.6, 3, 1); ctx.fillStyle = '#f3f4f6'; ctx.fill();
        rr(x + dx - 3, y + 14.5 + off, 6, 3, 1.5); ctx.fillStyle = '#111'; ctx.fill();
      }
      // pants
      rr(x - 9, y + 2, 18, 7, 3); ctx.fillStyle = '#e5e7eb'; ctx.fill();
      // swinging arm (left) and ball arm (right)
      rr(x - 15, y - 7 + arm, 5.5, 12, 2.8); ctx.fillStyle = skin; ctx.fill();
      rr(x + 9.5, y - 7, 5.5, 10, 2.8); ctx.fillStyle = skin; ctx.fill();
      ctx.save(); ctx.translate(x + 13, y - 1); ctx.rotate(-0.5); ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 3.4, 0, 0, Math.PI * 2); ctx.fillStyle = '#7c3f12'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(2, 0); ctx.stroke(); ctx.restore();
      // jersey with shoulder pads and number on the back
      rr(x - 10, y - 9, 20, 13, 4); ctx.fillStyle = accent; ctx.fill();
      rr(x - 12.5, y - 12, 25, 7, 3.5); ctx.fill();
      if (big) { ctx.beginPath(); ctx.ellipse(x, y + 3, 11, 5.5, 0, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y + 6.5, 8, 2, 0, 0, Math.PI); ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fill(); }
      if (juking) { ctx.lineWidth = 2; ctx.strokeStyle = '#fde047'; rr(x - 12.5, y - 12, 25, 16, 4); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.font = '700 9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(big ? '99' : '22', x, y - 3);
      // neck and helmet (from behind)
      rr(x - 3, y - 15, 6, 4, 1.5); ctx.fillStyle = skin; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 18, 7, 0, Math.PI * 2); ctx.fillStyle = '#1f2937'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 25, 2, 13);
      ctx.restore();
    }
    function draw() {
      const yp = yardPx(), fy = fieldYard(), Y = (k) => YREF() - (k - fy) * yp;
      ctx.fillStyle = '#2f7d32'; ctx.fillRect(0, 0, W, H);
      const kTop = Math.ceil(fy + YREF() / yp) + 5, kBot = Math.floor(fy - (H - YREF()) / yp) - 5;
      // 5-yard stripes and lines
      for (let k = Math.floor(kBot / 5) * 5; k <= kTop; k += 5) {
        ctx.fillStyle = ((k / 5) % 2 === 0) ? '#33873a' : '#2c7630'; ctx.fillRect(0, Y(k + 5), W, yp * 5);
        if (k >= 0 && k <= 100) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(0, Y(k) - 1, W, 2); }
      }
      // hash marks every yard
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      for (let k = Math.max(0, kBot); k <= Math.min(100, kTop); k++) { const y = Y(k); ctx.fillRect(W * 0.33 - 6, y, 12, 1.5); ctx.fillRect(W * 0.67 - 6, y, 12, 1.5); ctx.fillRect(4, y, 10, 1.5); ctx.fillRect(W - 14, y, 10, 1.5); }
      // end zones
      ctx.globalAlpha = 0.9; ctx.fillStyle = accent; ctx.fillRect(0, Y(110), W, yp * 10); ctx.fillStyle = '#1e3a8a'; ctx.fillRect(0, Y(0), W, yp * 10); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = '600 26px Oswald, Inter, sans-serif';
      ctx.fillText('WEIRD PEOPLE', W / 2, Y(105)); ctx.fillText('HQ', W / 2, Y(-5));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, Y(100) - 2, W, 4); ctx.fillRect(0, Y(0) - 2, W, 4);
      // yard numbers
      ctx.font = '600 20px Oswald, Inter, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let k = 10; k <= 90; k += 10) { const y = Y(k); if (y < -20 || y > H + 20) continue; const lab = k <= 50 ? k : 100 - k; ctx.fillText(String(lab), 30, y); ctx.fillText(String(lab), W - 30, y); }
      // defenders
      for (const e of S.defs) {
        ctx.beginPath(); ctx.arc(e.x, e.y + 3, e.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fillStyle = e.kind === 'safety' ? '#111827' : '#1e3a8a'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '700 9px Inter, sans-serif'; ctx.fillText(e.name.slice(0, 5).toUpperCase(), e.x, e.y + 0.5);
      }
      // ball carrier
      S.trail.forEach(([x, y], i) => { ctx.beginPath(); ctx.arc(x, y, 3 + i, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${S.jukeT > 0 ? 0.08 * i : 0.03 * i})`; ctx.fill(); });
      drawCarrier(S.px, S.py, S.t, S.jukeT > 0);
      // HUD
      const yards = Math.floor(S.dist / yp);
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, 34);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '600 16px Oswald, Inter, sans-serif';
      ctx.fillText(`${yards} YDS`, 12, 17);
      ctx.textAlign = 'center'; ctx.fillText(`TD ${S.td}`, W / 2, 17);
      ctx.textAlign = 'right'; ctx.font = '600 12px Inter, sans-serif'; ctx.fillText(`BEST ${best(level)}`, W - 12, 17);
      // juke meter
      const ready = S.jukeCD <= 0;
      juke.classList.toggle('ready', ready);
      juke.style.setProperty('--cd', String(1 - S.jukeCD / 2.2));
      if (S.flash > 0) {
        ctx.globalAlpha = Math.min(1, S.flash); ctx.fillStyle = '#fde047'; ctx.font = '600 42px Oswald, Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('TOUCHDOWN!', W / 2, H * 0.32); ctx.font = '600 14px Inter, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('Defense is getting faster…', W / 2, H * 0.32 + 34); ctx.globalAlpha = 1;
      }
    }

    function frame(now) {
      if (!running) return;
      if (!host.isConnected) { stop(); return; }
      if (host.offsetParent === null) { stop(); showMenu('Paused', `${Math.floor(S.dist / yardPx())} yards so far`, 'You left the field. Kick off to start a new run.'); return; }
      const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now;
      step(dt); draw();
      if (S.over) { endGame(); return; }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      size(); reset(); overlay.hidden = true; running = true; last = performance.now();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function endGame() {
      stop();
      const yards = Math.floor(S.dist / yardPx());
      const prev = best(level), newBest = yards > prev;
      if (newBest) store.set('bk-best-' + level, String(yards));
      if (onEnd) { try { onEnd(level, yards); } catch { /* leaderboard is optional */ } }
      const spot = Math.round(fieldYard()), where = spot === 50 ? 'midfield' : spot < 50 ? `your own ${spot}` : `their ${100 - spot}`;
      showMenu(`Tackled by ${S.tackler}!`, `${yards} yards · ${S.td} TD${S.td === 1 ? '' : 's'}${newBest ? ' · new best!' : ` · best ${prev}`}`, `Brought down at ${where}.`);
    }
    function showMenu(title, line, sub) {
      overlay.replaceChildren();
      const h = document.createElement('div'); h.className = 'bk-t'; h.textContent = title;
      const p = document.createElement('div'); p.className = 'bk-l'; p.textContent = line;
      const seg = document.createElement('div'); seg.className = 'seg bk-seg';
      for (const [k, v] of Object.entries(LEVELS)) {
        const b = document.createElement('button'); b.textContent = v.name; b.setAttribute('aria-pressed', String(k === level));
        b.addEventListener('click', () => { level = k; store.set('bk-level', k); if (onLevel) onLevel(level); showMenu(title, line, sub); });
        seg.append(b);
      }
      const sk = document.createElement('div'); sk.className = 'bk-skins'; sk.setAttribute('aria-label', 'Player skin tone');
      for (const c of SKINS) {
        const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-pressed', String(c === skin)); b.setAttribute('aria-label', 'Skin tone');
        b.addEventListener('click', () => { skin = c; store.set('bk-skin', c); showMenu(title, line, sub); });
        sk.append(b);
      }
      const go = document.createElement('button'); go.className = 'btn big'; go.type = 'button'; go.textContent = S && S.over ? 'Run it back' : 'Kick off';
      go.addEventListener('click', start);
      const how = document.createElement('p'); how.className = 'bk-how';
      how.textContent = 'Steer with your mouse or finger. Click, press Space, or tap JUKE to burst past defenders (they freeze for a beat). Score every 100 yards; the defense gets faster after each touchdown.';
      const els = [h, p]; if (sub) { const s2 = document.createElement('div'); s2.className = 'bk-s'; s2.textContent = sub; els.push(s2); }
      els.push(seg, sk, go, how);
      const bb = document.createElement('div'); bb.className = 'bk-best';
      bb.textContent = `Best on this device: Rookie ${best('rookie')} · Pro ${best('pro')} · All-Pro ${best('hard')} yds`;
      els.push(bb);
      overlay.append(...els); overlay.hidden = false; go.focus();
    }

    reset(); draw();
    if (onLevel) onLevel(level);
    showMenu('Breakaway', `${me}, take it to the house.`, 'Defenders are your league-mates.');
    const onVis = () => { if (document.hidden && running) { stop(); showMenu('Paused', `${Math.floor(S.dist / yardPx())} yards so far`, 'Your run restarts when you kick off.'); } };
    document.addEventListener('visibilitychange', onVis);
    return { setName(n) { me = n; }, level: () => level, destroy() { stop(); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); } };
  }
  window.Breakaway = { mount };
})();
