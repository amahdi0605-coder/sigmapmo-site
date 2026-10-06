/* Sigma PMO, version four: the scroll engine, the frame and menu, text that decodes into place, the chapter loops and the page's motion. Plain JavaScript, no dependencies. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smoothstep = (p, e0, e1) => { const t = clamp((p - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const html = document.documentElement;
  let pinned = false;

  /* ---------- The frame: a full-screen menu behind the top-right label ---------- */
  const menuBtn = $('#menu-btn'), menu = $('#menu');
  let menuOpen = false;
  function setMenu(open, restoreFocus) {
    if (open === menuOpen) return;
    menuOpen = open;
    html.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      setTimeout(() => { const first = menu.querySelector('a'); if (first && menuOpen) first.focus(); }, 280);
    } else if (restoreFocus) { menuBtn.focus(); }
  }
  menuBtn.addEventListener('click', () => setMenu(!menuOpen, true));
  $$('#menu a, .frame a').forEach(a => a.addEventListener('click', () => setMenu(false, false)));
  document.addEventListener('keydown', e => {
    if (!menuOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); setMenu(false, true); return; }
    if (e.key === 'Tab') {
      const f = [menuBtn].concat($$('#menu a'));
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- The bottom-right readout: which chapter is on screen ---------- */
  const chapters = $$('[data-chapter]');
  const roNum = $('#ro-num'), roName = $('#ro-name');
  let roKey = '';
  function readoutTick() {
    const line = innerHeight * 0.5;
    let cur = chapters[0];
    for (const c of chapters) { if (c.getBoundingClientRect().top <= line) cur = c; else break; }
    const key = cur.dataset.chapter;
    if (key !== roKey) { roKey = key; roNum.textContent = key; roName.textContent = cur.dataset.name; }
  }

  /* ---------- Pause everything on hidden tabs ---------- */
  document.addEventListener('visibilitychange', () => { document.body.classList.toggle('paused', document.hidden); syncLoops(); });

  /* ---------- Text that decodes: glyph noise resolves into the words, once, when the element comes into view ---------- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+-/<>=';
  const decodes = new Map();
  $$('[data-decode]').forEach((el, i) => {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    el.textContent = '';
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = text;
    const vis = document.createElement('span'); vis.className = 'dx'; vis.setAttribute('aria-hidden', 'true');
    el.appendChild(sr); el.appendChild(vis);
    const r = rng(777 + i * 131);
    const order = Array.from(text, (ch, j) => /[A-Za-z0-9]/.test(ch) ? (j / text.length) * 0.65 + r() * 0.35 : -1);
    const d = { el, vis, text, order, done: false, raf: null, t0: 0, frame: 0, last: '', dur: clamp(520 + text.length * 14, 600, 1500) };
    d.last = scrambled(d, 0); vis.textContent = d.last;
    decodes.set(el, d);
  });
  function scrambled(d, t) {
    let s = '';
    for (let j = 0; j < d.text.length; j++) { const o = d.order[j]; s += (o < 0 || t >= o) ? d.text[j] : GLYPHS[(Math.random() * GLYPHS.length) | 0]; }
    return s;
  }
  function decodeStep(d, now) {
    d.raf = null;
    if (!d.t0) d.t0 = now;
    const t = clamp((now - d.t0) / d.dur, 0, 1);
    if (t >= 1) { finishDecode(d); return; }
    d.frame++;
    if (d.frame % 2 === 0) { const s = scrambled(d, t); if (s !== d.last) { d.last = s; d.vis.textContent = s; } }
    d.raf = requestAnimationFrame(n => decodeStep(d, n));
  }
  function finishDecode(d) {
    if (d.raf !== null) { cancelAnimationFrame(d.raf); d.raf = null; }
    d.done = true;
    if (d.last !== d.text) { d.last = d.text; d.vis.textContent = d.text; }
  }
  function startDecode(d) {
    if (d.done || d.raf !== null) return;
    if (pinned) { finishDecode(d); return; }
    d.t0 = 0; d.raf = requestAnimationFrame(n => decodeStep(d, n));
  }
  const decodeIO = new IntersectionObserver(es => {
    es.forEach(e => { if (!e.isIntersecting) return; decodeIO.unobserve(e.target); const d = decodes.get(e.target); if (d) startDecode(d); });
  }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
  decodes.forEach(d => decodeIO.observe(d.el));

  /* ---------- Chapter loops: fetched only when near, played only while on screen, never under reduced motion or Save-Data ---------- */
  const loops = $$('video.loop');
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  function loopFail(v) {
    const box = v.parentElement;
    if (v.poster) box.style.backgroundImage = "url('" + v.poster + "')";
    v.remove();
  }
  function loadLoop(v) {
    if (v.dataset.loaded || pinned || saveData || !v.isConnected) return;
    v.dataset.loaded = '1';
    v.src = v.dataset.src;
    v.load();
  }
  function playLoop(v) {
    if (!v.dataset.loaded || pinned || document.hidden || !v.isConnected) return;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
  }
  const loopNear = new IntersectionObserver(es => {
    es.forEach(e => { if (!e.isIntersecting) return; loadLoop(e.target); if (e.target.dataset.loaded) loopNear.unobserve(e.target); });
  }, { rootMargin: '75% 0px 75% 0px' });
  const loopVis = new IntersectionObserver(es => {
    es.forEach(e => { const v = e.target; v.dataset.vis = e.isIntersecting ? '1' : ''; if (e.isIntersecting) playLoop(v); else if (!v.paused) v.pause(); });
  }, { threshold: 0.02 });
  loops.forEach(v => {
    v.addEventListener('error', () => loopFail(v), { once: true });
    v.addEventListener('loadeddata', () => { if (v.dataset.vis) playLoop(v); });
    loopNear.observe(v); loopVis.observe(v);
  });
  function syncLoops() {
    loops.forEach(v => {
      if (!v.isConnected) return;
      if (pinned || document.hidden) { if (!v.paused) v.pause(); }
      else if (v.dataset.vis) { if (!v.dataset.loaded) loadLoop(v); playLoop(v); }
    });
  }

  /* ---------- Split hero headlines into word spans, once, with seeded offsets ---------- */
  $$('[data-split="words"]').forEach((el, ei) => {
    const text = el.textContent.trim();
    const words = text.split(/\s+/);
    const spread = el.dataset.spread ? +el.dataset.spread : 0.5;
    const r = rng(1234 + ei * 97);
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = text;
    const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
    words.forEach((w, i) => {
      const s = document.createElement('span'); s.className = 'w';
      s.textContent = w + (i < words.length - 1 ? ' ' : '');
      s.style.setProperty('--th', (i / words.length * spread + r() * 0.05).toFixed(3));
      vis.appendChild(s);
    });
    el.textContent = ''; el.appendChild(sr); el.appendChild(vis);
  });

  /* ---------- The hero ---------- */
  const hero = $('.hero'), stage = $('#stage'), video = $('#hero-video'), poster = $('#poster'), ring = $('#ring');
  const VIDEO_URL = 'assets/hero-scrub.mp4';
  const POSTER_URL = 'assets/hero-poster.jpg';
  const VIDEO_BYTES = 2109322; /* the real byte size of assets/hero-scrub.mp4; fallback when Content-Length is missing */
  const bandEls = $$('.band');
  const bands = bandEls.map((el, i) => ({ el, a: +el.dataset.a, b: +el.dataset.b, ramp: el.dataset.ramp ? +el.dataset.ramp : null, op: -1, k: -1, first: i === 0, last: i === bandEls.length - 1 }));

  function heroProgress() {
    const range = hero.offsetHeight - innerHeight;
    if (range <= 0) return 0;
    return clamp(-hero.getBoundingClientRect().top / range, 0, 1);
  }

  let target = 0, shown = 0, rafId = null, lastTick = 0, heroOnScreen = true, scrubOn = false;
  let loadK = 0, loadStart = 0, stageScrolled = false;
  let seekBusy = false, pendingTime = null;

  function requestSeek(t) {
    if (!video.duration || !isFinite(video.duration)) return;
    if (seekBusy) { pendingTime = t; return; }
    seekBusy = true;
    video.currentTime = t;
  }
  video.addEventListener('seeked', () => {
    seekBusy = false;
    if (pendingTime !== null) { const t = pendingTime; pendingTime = null; requestSeek(t); }
  });
  video.addEventListener('error', () => { seekBusy = false; pendingTime = null; failVideo(); });

  function updateCaptions(p) {
    for (const b of bands) {
      const f = Math.min(0.02, (b.b - b.a) / 3);
      const op = (b.first ? 1 : smoothstep(p, b.a, b.a + f)) * (b.last ? 1 : (1 - smoothstep(p, b.b - f, b.b)));
      let k = clamp((p - b.a) / (b.ramp || Math.min(0.025, (b.b - b.a) * 0.35)), 0, 1);
      if (b.first) k = Math.max(k, loadK);
      if (Math.abs(op - b.op) > 0.008 || ((op === 0 || op === 1) && op !== b.op)) {
        b.op = op; b.el.style.opacity = op.toFixed(3); b.el.classList.toggle('on', op > 0.02);
      }
      if (Math.abs(k - b.k) > 0.008 || ((k === 0 || k === 1) && k !== b.k)) {
        b.k = k; b.el.style.setProperty('--k', k.toFixed(3));
        if (b.last) { const live = k >= 0.76; if (live !== b.live) { b.live = live; b.el.classList.toggle('cta-live', live); } }
      }
    }
    const sc = p > 0.04;
    if (sc !== stageScrolled) { stageScrolled = sc; stage.classList.toggle('scrolled', sc); }
  }

  function tick(now) {
    const dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    const k = 0.22;
    shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));
    if (loadK < 1) { const t = clamp((now - loadStart) / 1400, 0, 1); loadK = t * t * (3 - 2 * t); }
    const converged = Math.abs(target - shown) < 0.0005 && loadK >= 1;
    if (converged) { shown = target; rafId = null; lastTick = 0; }
    else { rafId = requestAnimationFrame(tick); }
    if (video.duration) requestSeek(shown * video.duration);
    updateCaptions(shown);
  }
  function kick() { if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick); }
  function onScroll() { target = heroProgress(); kick(); }
  new IntersectionObserver(es => {
    heroOnScreen = es[0].isIntersecting;
    if (heroOnScreen) kick();
    else if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; lastTick = 0; }
  }, { threshold: 0 }).observe(hero);

  let heroInit = false;
  function initHeroOnce() {
    if (heroInit) return;
    heroInit = true;
    loadStart = performance.now();
    poster.style.backgroundImage = "url('" + POSTER_URL + "')";
    let started = false;
    const start = () => { if (started) return; started = true; loadHeroBlob().catch(failVideo); };
    const img = new Image();
    img.onload = start; img.onerror = start; img.src = POSTER_URL;
    setTimeout(start, 4000);
  }
  async function loadHeroBlob() {
    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error('video ' + res.status);
    const total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, lastRing = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ctrl.abort(), 20000);
      chunks.push(value);
      got += value.length;
      const frac = Math.min(1, got / total);
      const now = performance.now();
      if (now - lastRing > 100 || frac === 1) { lastRing = now; ring.style.setProperty('--ld', Math.round(126 * (1 - frac))); }
    }
    clearTimeout(watchdog);
    ring.style.setProperty('--ld', 0);
    video.preload = 'auto'; /* the markup's preload="none" only stopped an early network fetch; the blob is already local, and Firefox and Safari need this to read its metadata */
    video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    video.load();
    video.addEventListener('canplay', () => {
      requestSeek(heroProgress() * video.duration);
      stage.classList.add('video-ready');
    }, { once: true });
  }
  function failVideo() {
    if (stage.classList.contains('video-failed')) return;
    stage.classList.add('video-failed');
  }

  /* The five gates: character-identical to the CSS media query list. */
  const GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  const MQLS = GATES.map(q => matchMedia(q));
  function enableScrub() {
    if (scrubOn) return; scrubOn = true;
    initHeroOnce();
    addEventListener('scroll', onScroll, { passive: true });
    bands.forEach(b => { b.op = -1; b.k = -1; });
    unpinFinalStates();
    target = heroProgress(); shown = target;
    updateCaptions(shown);
    onScroll();
  }
  function disableScrub() {
    if (!scrubOn) return; scrubOn = false;
    removeEventListener('scroll', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; lastTick = 0; }
  }
  function applyHeroMode() { if (MQLS.some(m => m.matches)) disableScrub(); else enableScrub(); }
  MQLS.forEach(m => m.addEventListener('change', applyHeroMode));
  addEventListener('resize', () => { if (scrubOn) onScroll(); });

  /* ---------- Reveal choreography ---------- */
  const revealIO = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      el.classList.add('in');
      revealIO.unobserve(el);
      setTimeout(() => el.classList.add('done'), 1600);
      if (el.id === 'record') startCounters(el);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach(el => revealIO.observe(el));
  /* Living loops run only while their section is on screen: a second observer toggles .live both ways. */
  const liveIO = new IntersectionObserver(es => {
    es.forEach(e => { const on = e.isIntersecting; if (on !== e.target.classList.contains('live')) e.target.classList.toggle('live', on); });
  }, { threshold: 0 });
  $$('[data-reveal]').forEach(el => liveIO.observe(el));

  /* ---------- Counters (one-shot, 10Hz, write only on change) ---------- */
  function startCounters(root) {
    if (reduceMQ.matches || pinned) { pinCounters(); return; }
    root.querySelectorAll('.num[data-count]').forEach(el => {
      const end = +el.dataset.count, pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
      let t0 = 0, last = '', lastAt = 0;
      const dur = 1400;
      const step = now => {
        if (!t0) t0 = now;
        const t = clamp((now - t0) / dur, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        const s = pre + Math.round(end * e) + suf;
        if (now - lastAt >= 100 || t === 1) { if (s !== last) { last = s; el.textContent = s; } lastAt = now; }
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function pinCounters() {
    $$('.num[data-count]').forEach(el => { el.textContent = (el.dataset.prefix || '') + el.dataset.count + (el.dataset.suffix || ''); });
  }

  /* ---------- Scroll-driven writes: the readout, the convergence signature and the timeline ---------- */
  const drawEls = $$('.conv, .tl').map(el => ({ el, v: -1, steps: el.classList.contains('tl') ? Array.from(el.querySelectorAll('.step')) : null }));
  let drawRaf = null;
  function drawTick() {
    drawRaf = null;
    readoutTick();
    if (pinned) return;
    const H = innerHeight;
    for (const d of drawEls) {
      const r = d.el.getBoundingClientRect();
      let p = d.steps ? clamp((H * 0.85 - r.top) / Math.max(1, r.height), 0, 1) : clamp((H * 0.88 - r.top) / (H * 0.5), 0, 1);
      if (Math.abs(p - d.v) > 0.01 || ((p === 0 || p === 1) && p !== d.v)) {
        d.v = p;
        d.el.style.setProperty('--draw', p.toFixed(3));
        if (d.steps) {
          const h = d.el.offsetHeight || 1;
          d.steps.forEach(s => {
            const lit = p >= (s.offsetTop + 8) / h;
            if (lit !== s.classList.contains('lit')) s.classList.toggle('lit', lit);
          });
        }
      }
    }
  }
  function onScrollDraw() { if (drawRaf === null) drawRaf = requestAnimationFrame(drawTick); }
  addEventListener('scroll', onScrollDraw, { passive: true });
  addEventListener('resize', onScrollDraw);
  drawTick();

  /* ---------- The one interactive moment: hold to converge ---------- */
  const inst = $('#instrument'), hold = $('#hold'), holdLbl = hold.querySelector('.hold-lbl');
  const paths = { cost: $('#ln-cost'), sched: $('#ln-sched'), risk: $('#ln-risk') };
  const startPts = {
    cost: [40, 70, 300, 20, 600, 110, 960, 70],
    sched: [40, 150, 300, 150, 600, 150, 960, 150],
    risk: [40, 230, 300, 280, 600, 190, 960, 230]
  };
  const endPts = {
    cost: [40, 70, 300, 64, 600, 142, 960, 150],
    sched: [40, 150, 300, 150, 600, 150, 960, 150],
    risk: [40, 230, 300, 236, 600, 158, 960, 150]
  };
  let hp = 0, holding = false, holdRaf = null, lastHp = -1, holdDone = false, holdLast = 0;
  function setLines(t) {
    const e = t * t * (3 - 2 * t);
    for (const key in paths) {
      const s = startPts[key], d = endPts[key];
      const v = s.map((x, i) => x + (d[i] - x) * e);
      paths[key].setAttribute('d', 'M' + v[0] + ' ' + v[1] + ' C ' + v[2] + ' ' + v[3] + ', ' + v[4] + ' ' + v[5] + ', ' + v[6] + ' ' + v[7]);
    }
    inst.style.setProperty('--hp', t.toFixed(3));
  }
  function holdTick(now) {
    holdRaf = null;
    const dt = Math.min(100, now - (holdLast || now)); holdLast = now;
    const rate = (holding ? 0.0115 : -0.02) * (dt / 16.667);
    hp = clamp(hp + rate, 0, 1);
    if (Math.abs(hp - lastHp) > 0.004 || hp === 0 || hp === 1) { lastHp = hp; setLines(hp); }
    if (hp >= 1 && !holdDone) { completeHold(); return; }
    if ((holding && hp < 1) || (!holding && hp > 0)) holdRaf = requestAnimationFrame(holdTick); else holdLast = 0;
  }
  function holdStart(e) {
    if (holdDone) return;
    if (e.type === 'pointerdown') { e.preventDefault(); if (hold.setPointerCapture) { try { hold.setPointerCapture(e.pointerId); } catch (_) {} } }
    holding = true;
    if (holdRaf === null) holdRaf = requestAnimationFrame(holdTick);
  }
  function holdEnd() {
    if (holdDone) return;
    holding = false;
    if (holdRaf === null) holdRaf = requestAnimationFrame(holdTick);
  }
  function completeHold() {
    hp = 1; holding = false; holdDone = true; setLines(1);
    inst.classList.add('done');
    holdLbl.textContent = 'Converged';
    hold.setAttribute('aria-pressed', 'true');
  }
  function resetHold() {
    hp = 0; holding = false; holdDone = false; lastHp = -1; setLines(0);
    inst.classList.remove('done');
    holdLbl.textContent = 'Hold to converge';
    hold.setAttribute('aria-pressed', 'false');
  }
  hold.addEventListener('pointerdown', holdStart);
  hold.addEventListener('pointerup', holdEnd);
  hold.addEventListener('pointercancel', holdEnd);
  hold.addEventListener('pointerleave', holdEnd);
  hold.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); holdStart(e); } });
  hold.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); holdEnd(); } });
  hold.addEventListener('blur', holdEnd);
  setLines(0);

  /* ---------- FAQ accordion, one open at a time ---------- */
  $$('.q button').forEach(btn => btn.addEventListener('click', () => {
    const q = btn.closest('.q');
    const open = !q.classList.contains('open');
    $$('.q.open').forEach(o => { o.classList.remove('open'); o.querySelector('button').setAttribute('aria-expanded', 'false'); });
    q.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  }));

  /* ---------- The form: opens the visitor's email app, says so honestly ---------- */
  const form = $('#form'), note = $('#form-note');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = new FormData(form);
    const name = String(d.get('name') || '').trim(), co = String(d.get('company') || '').trim();
    const em = String(d.get('email') || '').trim(), pr = String(d.get('program') || '').trim();
    if (!name || !co || !em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      note.textContent = 'Please add your name, your company and a work email.';
      return;
    }
    const subject = encodeURIComponent('Free evaluation session: ' + co);
    const body = encodeURIComponent('Name: ' + name + '\nCompany: ' + co + '\nEmail: ' + em + '\n\nProgram:\n' + (pr || '(not provided)') + '\n');
    location.href = 'mailto:info@sigmapmo.com?subject=' + subject + '&body=' + body;
    form.classList.add('sent');
    note.textContent = 'Your email app should have opened with the details filled in. If it did not, write to info@sigmapmo.com and we will reply within one business day.';
  });

  /* ---------- Reduced motion, live, both directions ---------- */
  function pinToFinalStates() {
    pinned = true;
    document.body.classList.add('pinned');
    drawEls.forEach(d => { d.v = 1; d.el.style.setProperty('--draw', '1'); if (d.steps) d.steps.forEach(s => s.classList.add('lit')); });
    pinCounters();
    completeHold();
    decodes.forEach(finishDecode);
    $$('[data-reveal]').forEach(el => el.classList.add('in', 'done'));
    syncLoops();
  }
  function unpinFinalStates() {
    if (!pinned) return;
    pinned = false;
    document.body.classList.remove('pinned');
    drawEls.forEach(d => { d.v = -1; });
    resetHold();
    drawTick();
    syncLoops();
  }
  reduceMQ.addEventListener('change', e => { if (e.matches) pinToFinalStates(); else { unpinFinalStates(); applyHeroMode(); } });

  /* ---------- Go ---------- */
  if (reduceMQ.matches) pinToFinalStates();
  applyHeroMode();
})();
