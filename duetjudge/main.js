/* DuetJudge project page — behaviors (no dependencies; KaTeX is optional). */
(function () {
  'use strict';

  /* ---------- Release links ----------
     Fill ARXIV_ID (e.g. '2611.01234') once the preprint is posted: the arXiv and PDF pills derive from it.
     Other release edits: the BibTeX block in index.html (eprint field) and the og:image/og:url URLs in <head>.
     Empty entries stay as "soon" pills (hero) and are hidden in the footer. Hash links stay in-page. */
  var ARXIV_ID = '';
  var PAGE_LINKS = {
    arxiv: ARXIV_ID ? 'https://arxiv.org/abs/' + ARXIV_ID : '',
    pdf: ARXIV_ID ? 'https://arxiv.org/pdf/' + ARXIV_ID : '',
    code: '',
    listen: '#listen',
    bibtex: '#bibtex'
  };

  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---------- Theme ---------- */
  function initTheme() {
    var btn = $('#theme-toggle');
    var metas = $$('meta[name="theme-color"]');
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function stored() { try { return localStorage.getItem('dj-theme'); } catch (e) { return null; } }
    function apply(theme, persist) {
      root.setAttribute('data-theme', theme);
      metas.forEach(function (m) { m.setAttribute('content', theme === 'dark' ? '#0d0d0d' : '#fbfbf8'); });
      if (btn) btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      if (persist) { try { localStorage.setItem('dj-theme', theme); } catch (e) { /* storage unavailable */ } }
    }
    apply(root.getAttribute('data-theme') || 'light', false);
    if (btn) btn.addEventListener('click', function () { apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true); });
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', function (e) { var s = stored(); if (s !== 'light' && s !== 'dark') apply(e.matches ? 'dark' : 'light', false); });
    }
  }

  /* ---------- Header: glass on scroll, mobile menu, scroll spy ---------- */
  function initHeader() {
    var header = $('#site-header');
    if (!header) return;
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    var btn = $('#menu-toggle');
    var menu = $('#mobile-menu');
    function setOpen(open) {
      if (!btn || !menu) return;
      var hadFocus = !open && menu.contains(document.activeElement);
      header.classList.toggle('is-open', open);
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (hadFocus) btn.focus();
    }
    if (btn && menu) {
      btn.addEventListener('click', function () { setOpen(menu.hidden); });
      menu.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });
      document.addEventListener('click', function (e) { if (!menu.hidden && !header.contains(e.target)) setOpen(false); });
      var wide = window.matchMedia('(min-width: 901px)');
      if (wide.addEventListener) wide.addEventListener('change', function (e) { if (e.matches) setOpen(false); });
    }

    // The section under a line 45% down the viewport is current; sections without a nav entry map to a neighbour.
    var ALIAS = { references: 'references' };
    var links = {};
    $$('.primary-nav a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var sections = $$('main > section[id]');
    var held = null, holdUntil = 0, queued = false;
    function mark(id) {
      Object.keys(links).forEach(function (k) {
        var on = k === id;
        links[k].classList.toggle('is-active', on);
        if (on) links[k].setAttribute('aria-current', 'true'); else links[k].removeAttribute('aria-current');
      });
    }
    function spy() {
      queued = false;
      var line = window.innerHeight * 0.45, current = null;
      sections.forEach(function (s) { var r = s.getBoundingClientRect(); if (r.top <= line && r.bottom > line) current = s.id; });
      if (current && ALIAS[current] && !links[current]) current = ALIAS[current];
      if (held) { if (current !== held && performance.now() < holdUntil) return; held = null; }
      mark(current);
    }
    function queue() { if (queued) return; queued = true; requestAnimationFrame(spy); }
    Object.keys(links).forEach(function (id) {
      links[id].addEventListener('click', function () { held = id; holdUntil = performance.now() + 2000; mark(id); });
    });
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    spy();
  }

  /* ---------- Release links: pending markup is shipped in the HTML; a URL enables the link ---------- */
  function initLinks() {
    $$('[data-link]').forEach(function (a) {
      var url = PAGE_LINKS[a.getAttribute('data-link')];
      var tag = a.querySelector('.tag');
      if (url) {
        a.href = url;
        if (!/^#/.test(url)) { a.target = '_blank'; a.rel = 'noopener'; }
        a.classList.remove('is-pending');
        a.removeAttribute('aria-disabled');
        a.removeAttribute('title');
        a.hidden = false;
        if (tag) tag.remove();
        return;
      }
      a.removeAttribute('href');
      a.classList.add('is-pending');
      a.setAttribute('aria-disabled', 'true');
      if (!a.classList.contains('pill')) a.hidden = true; // footer: hide until a URL exists
    });
  }

  /* ---------- Ticker: pausable marquee ---------- */
  function initTicker() {
    var ticker = $('.ticker');
    var btn = $('.ticker-toggle');
    if (!ticker || !btn) return;
    var paused = false;
    function set(p) {
      paused = p;
      ticker.classList.toggle('is-paused', p);
      btn.setAttribute('aria-pressed', String(p));
      btn.setAttribute('aria-label', p ? 'Resume headline ticker' : 'Pause headline ticker');
    }
    btn.addEventListener('click', function () { set(!paused); });
    set(false);
  }

  /* ---------- Count-up for [data-count] numbers (from data-from, default 0, to data-count; optional data-delay / data-dur in ms) ---------- */
  function countUp(el) {
    var text = el.getAttribute('data-final');
    if (!text) { text = el.textContent.trim(); el.setAttribute('data-final', text); }
    var to = parseFloat(el.getAttribute('data-count'));
    var from = parseFloat(el.getAttribute('data-from') || '0');
    if (!isFinite(to) || !isFinite(from) || reduceMotion || el.getAttribute('data-counted')) return;
    el.setAttribute('data-counted', '1');
    var run = (el._run || 0) + 1; el._run = run;
    var decimals = (text.replace(/,/g, '').split('.')[1] || '').length;
    var comma = text.indexOf(',') >= 0;
    var dur = parseInt(el.getAttribute('data-dur') || '1400', 10), delay = parseInt(el.getAttribute('data-delay') || '0', 10);
    var fmt = function (v) { var str = v.toFixed(decimals); return comma ? str.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : str; };
    el.textContent = fmt(from);
    setTimeout(function () {
      if (el._run !== run) return;
      var t0 = null, done = false;
      function finish() { done = true; el.textContent = text; }
      function step(now) {
        if (el._run !== run || done) return;
        if (t0 === null) t0 = now;
        var t = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = fmt(from + (to - from) * e);
        if (t < 1) requestAnimationFrame(step); else finish();
      }
      requestAnimationFrame(step);
      setTimeout(function () { if (el._run === run && !done) finish(); }, dur + 250); // the printed value always wins, even if frames are throttled
    }, delay);
  }
  function playDiagram(dg) {
    dg.classList.add('play');
    $$('[data-count]', dg).forEach(function (el) { el.removeAttribute('data-counted'); countUp(el); });
  }

  /* ---------- Reveal on scroll ---------- */
  function initReveal() {
    var items = $$('.reveal, .col, .tl-spot, .diagram, .jcard, .anim');
    if (!items.length) return;
    root.classList.add('js'); // gates the hidden state; added only once the reveal machinery is in place
    function show(el) {
      if (el.classList.contains('reveal')) el.classList.add('is-in');
      if (el.classList.contains('diagram')) { playDiagram(el); return; }
      if (!el.classList.contains('reveal') || el.classList.contains('jcard') || el.classList.contains('anim')) el.classList.add('play');
      $$('[data-count]', el).forEach(countUp);
    }
    if (!hasIO || reduceMotion) { items.forEach(show); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
    // Safety net: nothing stays hidden if the observer never fires (embedded previews, odd scroll containers).
    setTimeout(function () { items.forEach(function (el) { if (!el.classList.contains('is-in') && !el.classList.contains('play')) show(el); }); }, 6000);
  }

  /* ---------- Copy BibTeX ---------- */
  function initCopy() {
    $$('[data-copy]').forEach(function (btn) {
      var label = btn.querySelector('span:not(.visually-hidden)');
      var original = label ? label.textContent : '';
      var status = $('#copy-status');
      var timer = null;
      btn.addEventListener('click', function () {
        var src = $(btn.getAttribute('data-copy'));
        if (!src) return;
        var text = src.textContent;
        var done = function () {
          if (label) label.textContent = 'Copied';
          if (status) status.textContent = 'BibTeX copied to clipboard';
          clearTimeout(timer);
          timer = setTimeout(function () { if (label) label.textContent = original; if (status) status.textContent = ''; }, 1800);
        };
        function fallback() {
          var range = document.createRange(); range.selectNodeContents(src);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          try { if (document.execCommand('copy')) done(); } catch (e) { /* ignore */ }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
      });
    });
  }

  /* ---------- Lightbox for figures ---------- */
  function initLightbox() {
    var dlg = $('#lightbox');
    if (!dlg || typeof dlg.showModal !== 'function') return;
    var img = $('img', dlg);
    function open(pic, href) {
      img.src = href || pic.currentSrc || pic.src;
      img.alt = pic.alt || '';
      dlg.showModal();
    }
    $$('.fig-media a').forEach(function (a) {
      a.addEventListener('click', function (e) { var pic = a.querySelector('img'); if (!pic) return; e.preventDefault(); open(pic, a.getAttribute('href')); });
    });
    $$('.fig-zoom').forEach(function (b) {
      b.addEventListener('click', function () { var pic = b.querySelector('img'); if (pic) open(pic, pic.getAttribute('src')); });
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); // backdrop only
    $('.lightbox-close', dlg).addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { img.removeAttribute('src'); });
  }

  /* ---------- Audio: shared player wiring ---------- */
  var waveforms = window.DUET_WAVEFORMS || {};
  var allPlayers = [];
  var waveIndex = 0;
  var formatTime = function (v) { var s = Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  var ICON_PLAY = '<svg class="play-glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg><svg class="pause-glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>';

  function playerMarkup(label) {
    return '<div class="audio-slot"><audio preload="metadata" aria-label="' + esc(label) + '"></audio>' +
      '<div class="compact-player" hidden><button type="button" class="play-button" aria-label="Play ' + esc(label) + '" disabled>' + ICON_PLAY + '</button>' +
      '<div class="seek-control"><div class="waveform" aria-hidden="true"></div><input class="seek-input" type="range" min="0" max="1" step="0.01" value="0" aria-label="Seek ' + esc(label) + '" disabled><span class="seek-cursor" aria-hidden="true"></span></div>' +
      '<div class="play-time"><span data-current>0:00</span><span class="time-divider">/</span><span data-duration>--:--</span></div></div>' +
      '<div class="audio-placeholder"><span data-audio-status role="status">Audio loads when this sample is shown</span></div></div>';
  }

  // Wires one row (which contains playerMarkup) to a source file. The source is fetched only when load() is called.
  function wireRow(row, source, label) {
    var audio = $('audio', row), controls = $('.compact-player', row), button = $('.play-button', row), seek = $('.seek-input', row);
    var timeline = $('.seek-control', row), placeholder = $('.audio-placeholder', row), status = $('[data-audio-status]', row);
    var clipId = 'wave-progress-' + (waveIndex++);
    var peaks = waveforms[source];
    var bars = Array.isArray(peaks) && peaks.length
      ? peaks.map(function (peak, i) {
        var h = 2 + 24 * Math.max(0, Math.min(1, Number(peak) || 0));
        return '<rect x="' + (i * 192 / peaks.length + 1) + '" y="' + ((28 - h) / 2) + '" width="' + Math.max(1, 192 / peaks.length - 2) + '" height="' + h + '" rx="1"/>';
      }).join('')
      : '<rect x="0" y="12" width="192" height="4" rx="2"/>';
    $('.waveform', row).innerHTML = '<svg viewBox="0 0 192 28" preserveAspectRatio="none"><defs><clipPath id="' + clipId + '"><rect class="progress-clip" width="0" height="28"/></clipPath></defs><g class="wave-background">' + bars + '</g><g class="wave-played" clip-path="url(#' + clipId + ')">' + bars + '</g></svg>';
    var clip = $('.progress-clip', row), current = $('[data-current]', row), duration = $('[data-duration]', row);
    var ready = false;

    var updateProgress = function () {
      if (!ready) return;
      var hasDur = Number.isFinite(audio.duration) && audio.duration > 0;
      var pos = hasDur ? Math.min(audio.duration, Math.max(0, audio.currentTime)) : Math.max(0, audio.currentTime);
      var frac = hasDur ? pos / audio.duration : 0;
      seek.value = hasDur ? String(pos) : '0';
      current.textContent = formatTime(pos);
      seek.setAttribute('aria-valuetext', hasDur ? formatTime(pos) + ' of ' + formatTime(audio.duration) : formatTime(pos) + ' elapsed');
      clip.setAttribute('width', String(frac * 192));
      timeline.style.setProperty('--progress', (frac * 100) + '%');
    };
    var updateDuration = function () {
      var hasDur = Number.isFinite(audio.duration) && audio.duration > 0;
      seek.max = hasDur ? String(audio.duration) : '1';
      seek.disabled = !ready || !hasDur;
      duration.textContent = hasDur ? formatTime(audio.duration) : '--:--';
      updateProgress();
    };
    var updatePlayback = function () {
      var playing = !audio.paused && !audio.ended;
      row.classList.toggle('is-playing', playing);
      button.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + label);
      button.title = playing ? 'Pause' : 'Play';
    };
    var showError = function () {
      ready = false; controls.hidden = true; placeholder.hidden = false; button.disabled = true; seek.disabled = true;
      row.classList.remove('is-ready', 'is-playing'); status.textContent = 'Audio unavailable';
    };
    var toggle = function () {
      if (!ready) return;
      if (!audio.paused) { audio.pause(); return; }
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(function (err) { if (err.name !== 'AbortError') showError(); });
    };
    button.addEventListener('click', toggle);
    row.addEventListener('click', function (e) {
      if (e.target.closest('button, input, a, label') || String(window.getSelection())) return;
      toggle();
    });
    seek.addEventListener('input', function () { if (!ready || seek.disabled) return; audio.currentTime = Number(seek.value); updateProgress(); });
    ['timeupdate', 'seeked', 'ended'].forEach(function (ev) { audio.addEventListener(ev, updateProgress); });
    ['play', 'pause', 'ended'].forEach(function (ev) { audio.addEventListener(ev, updatePlayback); });
    audio.addEventListener('loadedmetadata', function () {
      ready = true; button.disabled = false; controls.hidden = false; placeholder.hidden = true;
      row.classList.add('is-ready'); updateDuration(); updatePlayback();
    });
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('error', showError);
    allPlayers.push(audio);
    var loaded = false;
    return {
      audio: audio,
      load: function () { if (loaded) return; loaded = true; status.textContent = 'Loading audio…'; audio.preload = 'metadata'; audio.src = source; audio.load(); },
      reset: function () { audio.pause(); try { audio.currentTime = 0; } catch (e) { /* not loaded */ } }
    };
  }

  /* ---------- Listening board ---------- */
  var MODELS = [
    {
      id: 'audex-2b', name: 'Audex-2B', sub: 'In-domain · autoregressive generator · Base + six training rewards',
      rows: [
        { key: 'base', name: 'Base (no RL)', sub: 'Audex-2B initialization', cls: 'base primary', badge: 'base' },
        { key: 'ours', name: 'DuetJudge (ours)', sub: 'GSPO with pairwise rewards from the frozen judge', cls: 'ours primary', badge: 'ours' },
        { divider: 'Other training rewards (pointwise scores)' },
        { key: 'aes_pq', name: 'Audiobox-PQ', sub: 'production-quality score, audio only' },
        { key: 'cmi_musicality', name: 'CMI-RM Musicality', sub: 'musicality score' },
        { key: 'cmi_alignment', name: 'CMI-RM Alignment', sub: 'caption-alignment score' },
        { key: 'muq', name: 'MuQ-MuLan', sub: 'music–text similarity' },
        { key: 'tunejury', name: 'TuneJury', sub: 'overall preference score' }
      ]
    },
    {
      id: 'audex-30b', name: 'Audex-30B-A3B', sub: 'In-domain · larger autoregressive generator · Base vs. DuetJudge',
      rows: [
        { key: 'base', name: 'Base (no RL)', sub: 'Audex-30B-A3B initialization', cls: 'base primary', badge: 'base' },
        { key: 'ours', name: 'DuetJudge (ours)', sub: 'GSPO with pairwise rewards from the frozen judge', cls: 'ours primary', badge: 'ours' }
      ]
    }
  ];

  function samplesFor(model) {
    var samples = Array.isArray(window.DUET_SAMPLES) ? window.DUET_SAMPLES : [];
    return samples.filter(function (s) { return s && (s.id === model.id || String(s.id).indexOf(model.id + '-') === 0); });
  }

  function buildBoard(rootEl) {
    var models = MODELS.map(function (m) { return { m: m, samples: samplesFor(m) }; }).filter(function (g) { return g.samples.length; });
    if (!models.length) { rootEl.innerHTML = '<p class="toolbar-note" style="padding:22px">Audio samples are not available.</p>'; return false; }

    var html = '<div class="board-toolbar"><div class="seg seg-lg model-tabs" role="tablist" aria-label="Generator" data-model-tabs>';
    models.forEach(function (g, i) {
      html += '<button type="button" role="tab" id="tab-model-' + g.m.id + '" data-model="' + g.m.id + '" aria-controls="model-' + g.m.id + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + esc(g.m.name) + '</button>';
    });
    html += '</div><span class="toolbar-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><path d="M4 13H3v7h4v-7H4zm16 0h1v7h-4v-7h3z"/></svg>Headphones recommended · same caption, different training reward · 10-second clips</span></div>';

    models.forEach(function (g, mi) {
      html += '<div class="model-panel" id="model-' + g.m.id + '" role="tabpanel" aria-labelledby="tab-model-' + g.m.id + '"' + (mi ? ' hidden' : '') + '>';
      html += '<div class="sample-toolbar"><h3>' + esc(g.m.name) + ' outputs<small>' + esc(g.m.sub) + '</small></h3>';
      html += '<div class="sample-switch"><span aria-hidden="true">Sample</span><div class="sample-tabs" role="tablist" aria-label="' + esc(g.m.name) + ' sample" data-sample-tabs>';
      g.samples.forEach(function (s, si) {
        html += '<button type="button" role="tab" id="tab-sample-' + s.id + '" aria-controls="sample-' + s.id + '" aria-selected="' + (si === 0) + '" tabindex="' + (si === 0 ? 0 : -1) + '" aria-label="Sample ' + (si + 1) + '">' + (si + 1) + '</button>';
      });
      html += '</div></div></div>';
      g.samples.forEach(function (s, si) {
        html += '<article id="sample-' + s.id + '" role="tabpanel" aria-labelledby="tab-sample-' + s.id + '" data-sample="' + s.id + '"' + (si ? ' hidden' : '') + '>';
        html += '<div class="caption-box"><span class="caption-label">Caption</span><p class="caption-text">' + esc(s.caption || '') + '</p></div>';
        html += '<div class="track-heading"><span>System</span><span>Generated audio</span></div><ul class="audio-list" role="list">';
        g.m.rows.forEach(function (r) {
          if (r.divider) { html += '<li class="audio-divider">' + esc(r.divider) + '</li>'; return; }
          var src = typeof s[r.key] === 'string' ? s[r.key].trim() : '';
          if (!src) return;
          var label = r.name + ', sample ' + (si + 1) + ', ' + g.m.name;
          html += '<li class="audio-row ' + (r.cls || '') + '" data-audio-slot="' + r.key + '" data-src="' + esc(src) + '" data-label="' + esc(label) + '">';
          html += '<div class="method-info"><div class="method-name"><strong>' + esc(r.name) + '</strong>' + (r.badge ? '<span class="method-badge">' + esc(r.badge) + '</span>' : '') + '</div>' + (r.sub ? '<div class="method-subtitle">' + esc(r.sub) + '</div>' : '') + '</div>';
          html += playerMarkup(label) + '</li>';
        });
        html += '</ul></article>';
      });
      html += '</div>';
    });
    html += '<div class="board-footnote"><span class="comparison-key"><i class="base-key" aria-hidden="true"></i>Base <span aria-hidden="true">↔</span><i class="ours-key" aria-hidden="true"></i>DuetJudge</span><span class="player-help">Click a row to play · drag the waveform to seek · one shared volume for fair comparison</span>';
    html += '<div class="volume-control"><button type="button" class="volume-button" aria-label="Mute audio" title="Mute audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><g class="sound-waves"><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></g><g class="mute-cross"><path d="m16 9 5 6M21 9l-5 6"/></g></svg></button><input class="volume-slider" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"></div></div>';
    rootEl.innerHTML = html;
    return true;
  }

  var currentVolume = 1;
  function applyVolume(audio) {
    try { audio.volume = currentVolume; audio.muted = currentVolume === 0; } catch (e) { /* read-only on some platforms */ }
  }

  function initBoard() {
    var rootEl = $('[data-board]');
    if (!rootEl) return;
    if (!buildBoard(rootEl)) return;

    var pending = new Map();
    $$('[data-audio-slot]', rootEl).forEach(function (row) {
      var w = wireRow(row, row.getAttribute('data-src'), row.getAttribute('data-label'));
      pending.set(w.audio, w.load);
    });

    // One shared volume keeps comparisons at the same level (applies to the game players too).
    var volume = $('.volume-slider', rootEl), mute = $('.volume-button', rootEl), lastAudible = 1;
    var setVolume = function (v) {
      currentVolume = v;
      if (v > 0) lastAudible = v;
      allPlayers.forEach(applyVolume);
      if (volume) { volume.value = String(v); volume.setAttribute('aria-valuetext', Math.round(v * 100) + ' percent'); }
      if (mute) {
        mute.classList.toggle('is-muted', v === 0);
        mute.setAttribute('aria-label', v === 0 ? 'Unmute audio' : 'Mute audio');
        mute.title = v === 0 ? 'Unmute audio' : 'Mute audio';
      }
    };
    if (volume && mute) {
      volume.addEventListener('input', function () { setVolume(Number(volume.value)); });
      mute.addEventListener('click', function () { setVolume(Number(volume.value) > 0 ? 0 : lastAudible); });
      setVolume(1);
      // iOS exposes volume as read-only; keep the mute button but hide a slider that cannot work.
      var probe = allPlayers[0];
      if (probe) { try { probe.volume = 0.5; if (probe.volume !== 0.5) volume.hidden = true; probe.volume = 1; } catch (e) { volume.hidden = true; } }
    }

    // Tabs (generator and sample) with roving focus; clips load when their sample is shown and the board is near the viewport.
    var armed = !hasIO;
    var loadVisible = function () {
      if (!armed) return;
      $$('audio', rootEl).forEach(function (a) {
        if (a.closest('[hidden]')) a.pause();
        else if (pending.has(a)) { pending.get(a)(); pending.delete(a); }
      });
    };
    $$('[data-model-tabs], [data-sample-tabs]', rootEl).forEach(function (list) {
      var tabs = $$('[role="tab"]', list);
      var activate = function (sel) {
        tabs.forEach(function (t) {
          var on = t === sel;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        $$('audio', rootEl).forEach(function (a) { if (a.closest('[hidden]')) a.pause(); });
        loadVisible();
      };
      tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { activate(tab); });
        tab.addEventListener('keydown', function (e) {
          var next;
          if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
          else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = tabs.length - 1;
          else return;
          e.preventDefault(); activate(tabs[next]); tabs[next].focus();
        });
      });
      activate(tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0]);
    });
    if (hasIO) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { armed = true; loadVisible(); io.disconnect(); }
      }, { rootMargin: '600px 0px' });
      io.observe(rootEl);
    }
  }

  /* ---------- "Be the judge": blind A/B between Base and DuetJudge, any pair selectable ---------- */
  function initJudgeGame() {
    var host = $('[data-judge-game]');
    if (!host) return;
    var pairs = [];
    MODELS.forEach(function (m) {
      samplesFor(m).forEach(function (s, i) {
        if (typeof s.base === 'string' && typeof s.ours === 'string') {
          pairs.push({ model: m.name, caption: s.caption || '', base: s.base, ours: s.ours, index: i + 1, oursSlot: Math.random() < 0.5 ? 'A' : 'B', pick: null });
        }
      });
    });
    if (!pairs.length) { host.hidden = true; return; }

    host.innerHTML =
      '<div class="jg-head"><p class="kicker">Be the judge</p><h3>Which clip fulfills the caption better?</h3>' +
      '<p>One clip is the Base model, the other is the same model after RL with DuetJudge rewards, in random order. Listen to both, then decide — caption alignment first, sound quality second, the rule the human annotators followed. Pick any pair.</p></div>' +
      '<div class="jg-pager" role="group" aria-label="Choose a pair"><span>Pair</span>' +
      pairs.map(function (p, i) { return '<button type="button" data-jg-go="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="Pair ' + (i + 1) + ', ' + esc(p.model) + '">' + (i + 1) + '</button>'; }).join('') +
      '<span class="jg-model" data-jg-model></span></div>' +
      '<div class="caption-box"><span class="caption-label">Caption</span><p class="caption-text" data-jg-caption></p></div>' +
      '<ul class="audio-list jg-pair" role="list">' +
      ['A', 'B'].map(function (k) {
        return '<li class="audio-row primary jg-row" data-jg-slot="' + k + '"><div class="method-info"><div class="method-name"><strong>Clip ' + k + '</strong><span class="method-badge" data-jg-badge hidden></span></div><div class="method-subtitle" data-jg-sub>Blind · identity revealed after you decide</div></div>' + playerMarkup('Clip ' + k) + '</li>';
      }).join('') + '</ul>' +
      '<div class="jg-actions" role="group" aria-label="Your decision">' +
      '<button type="button" class="pill" data-jg-pick="A">A is better</button>' +
      '<button type="button" class="pill" data-jg-pick="Tie">Tie</button>' +
      '<button type="button" class="pill" data-jg-pick="B">B is better</button></div>' +
      '<p class="jg-result" data-jg-result role="status" hidden></p>' +
      '<div class="jg-foot"><span class="jg-tally" data-jg-tally></span><button type="button" class="pill pill-primary" data-jg-next hidden>Next pair →</button></div>';

    var rows = { A: $('[data-jg-slot="A"]', host), B: $('[data-jg-slot="B"]', host) };
    var wired = { A: null, B: null };
    var picks = $$('[data-jg-pick]', host), result = $('[data-jg-result]', host), next = $('[data-jg-next]', host), tally = $('[data-jg-tally]', host);
    var pager = $$('[data-jg-go]', host), modelTag = $('[data-jg-model]', host);
    var cur = 0, armed = !hasIO;

    function decided() { return pairs.filter(function (p) { return p.pick; }); }
    function agreed() { return pairs.filter(function (p) { return p.pick && p.pick === p.oursSlot; }).length; }
    function updateTally(p) {
      var d = decided().length;
      tally.textContent = 'Pair ' + (cur + 1) + ' of ' + pairs.length + ' · ' + p.model + (d ? ' · you agreed with DuetJudge on ' + agreed() + ' of ' + d : '');
    }

    function rebuildRow(k, source, label) {
      var row = rows[k];
      if (wired[k]) { wired[k].reset(); var idx = allPlayers.indexOf(wired[k].audio); if (idx >= 0) allPlayers.splice(idx, 1); }
      $('.audio-slot', row).outerHTML = playerMarkup(label);
      row.classList.remove('is-ready', 'is-playing', 'base', 'ours');
      $('[data-jg-badge]', row).hidden = true;
      $('[data-jg-sub]', row).textContent = 'Blind · identity revealed after you decide';
      wired[k] = wireRow(row, source, label);
      applyVolume(wired[k].audio);
      if (armed) wired[k].load();
    }

    function revealRows(p) {
      ['A', 'B'].forEach(function (k) {
        var row = rows[k], badge = $('[data-jg-badge]', row), sub = $('[data-jg-sub]', row);
        var isOurs = k === p.oursSlot;
        row.classList.add(isOurs ? 'ours' : 'base');
        badge.textContent = isOurs ? 'ours' : 'base'; badge.hidden = false;
        sub.textContent = isOurs ? 'DuetJudge-optimized ' + p.model : p.model + ' Base (no RL)';
      });
      var ours = p.oursSlot, base = ours === 'A' ? 'B' : 'A', pick = p.pick;
      picks.forEach(function (b) { b.disabled = true; b.classList.toggle('is-picked', b.getAttribute('data-jg-pick') === pick); });
      result.textContent = pick === 'Tie'
        ? 'You called it a tie. Clip ' + ours + ' was the DuetJudge-optimized model; clip ' + base + ' was Base.'
        : (pick === ours ? 'You preferred clip ' + pick + ' — the DuetJudge-optimized model.' : 'You preferred clip ' + pick + ' — the Base model. Clip ' + ours + ' was the DuetJudge-optimized one.');
      result.hidden = false;
      next.hidden = pairs.length < 2;
    }

    function showPair(i) {
      cur = (i + pairs.length) % pairs.length;
      var p = pairs[cur];
      pager.forEach(function (b, j) { b.setAttribute('aria-pressed', String(j === cur)); b.classList.toggle('done', !!pairs[j].pick); });
      modelTag.textContent = p.model + ' · sample ' + p.index;
      $('[data-jg-caption]', host).textContent = p.caption;
      var oursFirst = p.oursSlot === 'A';
      rebuildRow('A', oursFirst ? p.ours : p.base, 'Clip A, ' + p.model + ' sample ' + p.index);
      rebuildRow('B', oursFirst ? p.base : p.ours, 'Clip B, ' + p.model + ' sample ' + p.index);
      picks.forEach(function (b) { b.disabled = false; b.classList.remove('is-picked'); });
      result.hidden = true; result.textContent = '';
      next.hidden = true;
      if (p.pick) revealRows(p);
      updateTally(p);
    }

    function reveal(pick) {
      var p = pairs[cur];
      if (p.pick) return;
      p.pick = pick;
      pager[cur].classList.add('done');
      revealRows(p);
      updateTally(p);
    }

    picks.forEach(function (b) { b.addEventListener('click', function () { reveal(b.getAttribute('data-jg-pick')); }); });
    pager.forEach(function (b) { b.addEventListener('click', function () { showPair(parseInt(b.getAttribute('data-jg-go'), 10)); }); });
    next.addEventListener('click', function () { showPair(cur + 1); });
    showPair(0);
    if (hasIO) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { armed = true; ['A', 'B'].forEach(function (k) { if (wired[k]) wired[k].load(); }); io.disconnect(); }
      }, { rootMargin: '600px 0px' });
      io.observe(host);
    }
  }

  /* ---------- Charts (ported from the talk deck; static SVG, animated by the .diagram play state) ---------- */
  function rbar(x, y, w, h) { var r = Math.min(4, w / 2); return 'M' + x + ' ' + y + 'h' + (w - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (h - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 -' + r + ' ' + r + 'h-' + (w - r) + 'z'; }
  function hbar(id, rows, o) {
    var el = document.getElementById(id); if (!el) return;
    var W = o.w, H = o.h, ml = o.ml, mr = o.mr || 90, mt = o.mt || 12, mb = o.mb || 44, pw = W - ml - mr, ph = H - mt - mb, max = o.max, bh = o.bh || 32, step = ph / rows.length;
    var nBase = rows.filter(function (r) { return !r.ours; }).length, k = 0;
    var d0 = o.d0 || 0.15, ds = o.dstep || 0.1, grow = o.grow || 0.6;
    var dRef = d0 + nBase * ds + 0.15;
    var dOurs = o.ref ? dRef + 0.55 : d0 + nBase * ds + 0.2;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(o.label || '') + '">';
    (o.ticks || []).forEach(function (t) { var x = ml + pw * t / max; s += '<line class="grid" x1="' + x + '" y1="' + mt + '" x2="' + x + '" y2="' + (mt + ph) + '"/><text class="tick" x="' + x + '" y="' + (H - 10) + '" text-anchor="middle">' + t + (o.unit || '') + '</text>'; });
    s += '<line class="axis" x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (mt + ph) + '"/>';
    if (o.ref) { var rx = ml + pw * o.ref.v / max; s += '<g class="ent-grow y" style="--d:' + dRef.toFixed(2) + 's;--dur:0.5s"><line class="refline" x1="' + rx + '" y1="' + (mt - 6) + '" x2="' + rx + '" y2="' + (mt + ph) + '"/></g><text class="cap ent fade" style="--d:' + (dRef + 0.3).toFixed(2) + 's" x="' + (rx + 10) + '" y="' + (mt + ph - 8) + '">' + esc(o.ref.label) + '</text>'; }
    rows.forEach(function (r, i) {
      var y = mt + step * i + (step - bh) / 2, w = pw * r.v / max;
      var d = r.ours ? dOurs : d0 + (k++) * ds, dur = r.ours ? 0.85 : grow;
      s += '<path class="bar' + (r.ours ? ' ours one' : '') + ' ent-grow" style="--d:' + d.toFixed(2) + 's;--dur:' + dur + 's;--g:' + (d + dur).toFixed(2) + 's" d="' + rbar(ml, y, w, bh) + '"/>';
      s += '<text class="lab' + (r.ours ? ' b' : '') + '" x="' + (ml - 14) + '" y="' + (y + bh / 2) + '" text-anchor="end" dominant-baseline="central">' + esc(r.label) + '</text>';
      s += '<text class="val' + (r.ours ? ' b' : '') + ' ent fade" style="--d:' + (d + 0.15).toFixed(2) + 's" data-count="' + r.t + '" data-delay="' + Math.round((d + 0.1) * 1000) + '" data-dur="' + Math.round(dur * 1000) + '" x="' + (ml + w + 12) + '" y="' + (y + bh / 2) + '" dominant-baseline="central">' + esc(r.t) + '</text>';
    });
    el.innerHTML = s + '</svg>';
  }
  function scatter(id, pts, o) {
    var el = document.getElementById(id); if (!el) return;
    var W = o.w, H = o.h, ml = 90, mr = o.mr || 30, mt = 36, mb = 70, pw = W - ml - mr, ph = H - mt - mb;
    function X(v) { return ml + pw * v / 100; } function Y(v) { return mt + ph * (1 - v / 100); }
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(o.label || '') + '">';
    s += '<rect class="quad ent fade" x="' + X(50) + '" y="' + Y(100) + '" width="' + (X(100) - X(50)) + '" height="' + (Y(50) - Y(100)) + '"/>';
    [0, 25, 50, 75, 100].forEach(function (t) {
      s += '<line class="grid" x1="' + X(t) + '" y1="' + mt + '" x2="' + X(t) + '" y2="' + (mt + ph) + '"/><line class="grid" x1="' + ml + '" y1="' + Y(t) + '" x2="' + (ml + pw) + '" y2="' + Y(t) + '"/>';
      s += '<text class="tick" x="' + X(t) + '" y="' + (mt + ph + 30) + '" text-anchor="middle">' + t + '</text><text class="tick" x="' + (ml - 12) + '" y="' + Y(t) + '" text-anchor="end" dominant-baseline="central">' + t + '</text>';
    });
    s += '<line class="guide" x1="' + X(50) + '" y1="' + mt + '" x2="' + X(50) + '" y2="' + (mt + ph) + '"/><line class="guide" x1="' + ml + '" y1="' + Y(50) + '" x2="' + (ml + pw) + '" y2="' + Y(50) + '"/>';
    s += '<line class="axis" x1="' + ml + '" y1="' + (mt + ph) + '" x2="' + (ml + pw) + '" y2="' + (mt + ph) + '"/><line class="axis" x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (mt + ph) + '"/>';
    s += '<text class="lab" x="' + (ml + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">Quality accuracy (%)</text>';
    s += '<text class="lab" transform="rotate(-90 22 ' + (mt + ph / 2) + ')" x="22" y="' + (mt + ph / 2) + '" text-anchor="middle">Conflict accuracy (%)</text>';
    (o.ann || []).forEach(function (a) { s += '<text class="ann ent fade" style="--d:' + (a.d || 0.4) + 's" x="' + X(a.x) + '" y="' + Y(a.y) + '" text-anchor="' + (a.anchor || 'start') + '">' + esc(a.t) + '</text>'; });
    pts.forEach(function (p) {
      var d = p.d || 0;
      if (p.lead) s += '<line class="lead ent fade" style="--d:' + (d + 0.2).toFixed(2) + 's" x1="' + X(p.x) + '" y1="' + Y(p.y) + '" x2="' + (X(p.x) + p.dx + 4) + '" y2="' + (Y(p.y) + p.dy - 7) + '"/>';
      if (p.ours) s += '<circle class="ring" cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="16"/>';
      s += '<circle class="pt' + (p.ours ? ' ours' : '') + ' ent-pop" style="--d:' + d.toFixed(2) + 's" cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (p.ours ? 14 : 10) + '"/>';
      s += '<text class="lab' + (p.ours ? ' b' : '') + ' ent fade" style="--d:' + (d + 0.2).toFixed(2) + 's;font-size:22px" x="' + (X(p.x) + p.dx) + '" y="' + (Y(p.y) + p.dy) + '" text-anchor="' + (p.anchor || 'start') + '">' + esc(p.label) + ' (' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ')</text>';
    });
    el.innerHTML = s + '</svg>';
  }
  function renderCharts() {
    hbar('agreebar', [
      { label: 'DuetJudge (ours)', v: 71.0, t: '71.0', ours: true }, { label: 'MuQ-MuLan', v: 54.0, t: '54.0' }, { label: 'TuneJury', v: 53.0, t: '53.0' },
      { label: 'Audiobox-PQ', v: 46.0, t: '46.0' }, { label: 'Audiobox-CE', v: 42.0, t: '42.0' }, { label: 'CMI-RM Musicality', v: 42.0, t: '42.0' }, { label: 'CMI-RM Alignment', v: 41.0, t: '41.0' }],
      { w: 930, h: 500, ml: 250, mr: 60, max: 100, ticks: [0, 25, 50, 75, 100], bh: 40, ref: { v: 54.0, label: 'best pointwise: 54.0' },
        label: 'Overall agreement with human labels, percent: DuetJudge 71.0, MuQ-MuLan 54.0, TuneJury 53.0, Audiobox-PQ 46.0, Audiobox-CE 42.0, CMI-RM Musicality 42.0, CMI-RM Alignment 41.0' });
    scatter('scatter', [
      { label: 'Audiobox-CE', x: 82.5, y: 18.8, dx: -16, dy: 8, anchor: 'end', d: 0.3 },
      { label: 'Audiobox-PQ', x: 95.0, y: 12.5, dx: -16, dy: 8, anchor: 'end', d: 0.42 },
      { label: 'CMI-RM Musicality', x: 68.8, y: 26.3, dx: -56, dy: 0, anchor: 'end', lead: true, d: 0.7 },
      { label: 'CMI-RM Alignment', x: 65.0, y: 28.7, dx: -22, dy: -22, anchor: 'end', lead: true, d: 0.82 },
      { label: 'MuQ-MuLan', x: 42.5, y: 46.3, dx: -16, dy: 8, anchor: 'end', d: 1.1 },
      { label: 'TuneJury', x: 47.5, y: 52.5, dx: -16, dy: 8, anchor: 'end', d: 1.22 },
      { label: 'DuetJudge', x: 86.3, y: 66.3, dx: -22, dy: 10, anchor: 'end', ours: true, d: 1.7 }],
      { w: 960, h: 560, mr: 190, label: 'Conflict accuracy versus quality accuracy, percent: DuetJudge 86.3 quality and 66.3 conflict; Audiobox-CE 82.5 and 18.8; Audiobox-PQ 95.0 and 12.5; CMI-RM Musicality 68.8 and 26.3; CMI-RM Alignment 65.0 and 28.7; MuQ-MuLan 42.5 and 46.3; TuneJury 47.5 and 52.5',
        ann: [{ x: 52, y: 97, t: 'alignment priority AND detects defects', d: 2.1 }, { x: 99, y: 45, t: 'hears defects, alignment-blind', anchor: 'end', d: 0.8 }, { x: 2, y: 62, t: 'near chance on quality', d: 1.5 }] });
    hbar('gbMus', [{ label: 'Base', v: 0.651, t: '0.651' }, { label: 'DPO', v: 0.987, t: '0.987' }, { label: 'GSPO + BTRM', v: 0.998, t: '0.998' }, { label: 'GSPO + pairwise', v: 1.303, t: '1.303', ours: true }],
      { w: 600, h: 230, ml: 210, mr: 80, max: 1.5, ticks: [], bh: 32, mt: 6, mb: 6, dstep: 0.12, label: 'CMI-RM Musicality: Base 0.651, DPO 0.987, GSPO with BTRM 0.998, GSPO with pairwise DuetJudge 1.303' });
    hbar('gbAli', [{ label: 'Base', v: 1.006, t: '1.006' }, { label: 'DPO', v: 1.325, t: '1.325' }, { label: 'GSPO + BTRM', v: 1.229, t: '1.229' }, { label: 'GSPO + pairwise', v: 1.435, t: '1.435', ours: true }],
      { w: 600, h: 230, ml: 210, mr: 80, max: 1.5, ticks: [], bh: 32, mt: 6, mb: 6, d0: 0.4, dstep: 0.12, label: 'CMI-RM Alignment: Base 1.006, DPO 1.325, GSPO with BTRM 1.229, GSPO with pairwise DuetJudge 1.435' });
  }

  /* ---------- Diagrams: stroke lengths for the draw animations, Replay buttons ---------- */
  function initDiagrams() {
    $$('.diagram').forEach(function (dg) {
      $$('.ent-draw, .fragment.draw', dg).forEach(function (el) {
        if (el.getTotalLength) { try { el.style.setProperty('--len', (el.getTotalLength() + 2).toFixed(1)); } catch (e) { /* not rendered yet */ } }
      });
      var btn = $('.replay', dg);
      if (btn) btn.addEventListener('click', function () {
        dg.classList.add('replaying'); dg.classList.remove('play');
        void dg.offsetWidth;
        dg.classList.remove('replaying');
        requestAnimationFrame(function () { playDiagram(dg); });
      });
    });
  }

  /* ---------- Result tabs (Audex-2B / Audex-30B-A3B / ETTA) ---------- */
  function initResultTabs() {
    $$('.rtabs').forEach(function (box) {
      var tabs = $$('[role="tab"]', box);
      var activate = function (sel) {
        tabs.forEach(function (t) {
          var on = t === sel;
          t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
          var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on;
        });
      };
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { activate(t); });
        t.addEventListener('keydown', function (e) {
          var n; if (e.key === 'ArrowRight') n = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length; else return;
          e.preventDefault(); activate(tabs[n]); tabs[n].focus();
        });
      });
    });
  }

  /* ---------- Boot ---------- */
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.error('[DuetJudge page]', e); } }
  function boot() {
    safe(initTheme);
    safe(initHeader);
    safe(initLinks);
    safe(initTicker);
    safe(initCopy);
    safe(renderCharts);
    safe(initDiagrams);
    safe(initResultTabs);
    safe(initBoard);
    safe(initJudgeGame);
    safe(initLightbox);
    safe(initReveal);
    document.addEventListener('play', function (e) {
      if (!(e.target instanceof HTMLAudioElement)) return;
      allPlayers.forEach(function (a) { if (a !== e.target) a.pause(); });
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
