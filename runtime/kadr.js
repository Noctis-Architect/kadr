/* kadr composition runtime.
 *
 * Injected into every composition page before its own scripts. It takes
 * the clock away from the browser: time only moves when the host (the
 * editor preview or the renderer) calls kadr.seek(t). That makes every
 * frame reproducible, so the export matches the preview exactly.
 *
 *  - CSS animations / transitions / Web Animations: paused and set to t.
 *  - JS: kadr.onFrame((t) => { ... }) runs on every seek.
 *  - CSS: :root gets --t (seconds) and --p (0..1 progress, if a duration is declared).
 *  - Props: ?props=<json>; [data-prop="name"] gets its text, every prop is
 *    also set as a CSS variable --name on :root.
 */
(function () {
  'use strict';
  if (window.kadr) return;

  var q = new URLSearchParams(location.search);
  var props = {};
  try { props = JSON.parse(q.get('props') || '{}') || {}; } catch (e) { props = {}; }
  var rendering = q.has('kadr-render');
  var frameFns = [];
  var holds = 0;
  var holdWaiters = [];
  var time = parseFloat(q.get('t')) || 0;
  var started = false;

  function meta(name) {
    var m = document.querySelector('meta[name="kadr:' + name + '"]');
    return m ? m.getAttribute('content') : null;
  }

  function report(kind, msg) {
    if (rendering || window.parent === window) return;
    try {
      navigator.sendBeacon('/api/log', JSON.stringify({ src: location.pathname, kind: kind, msg: String(msg).slice(0, 2000) }));
    } catch (e) { /* ignore */ }
  }
  window.addEventListener('error', function (e) {
    report('error', (e.message || 'error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) { report('error', 'unhandled rejection: ' + (e.reason && e.reason.message || e.reason)); });
  var origError = console.error;
  console.error = function () {
    report('console', Array.prototype.map.call(arguments, String).join(' '));
    return origError.apply(console, arguments);
  };

  // Defaults declared in <meta name="kadr:props">: a clip without props (or
  // with only some) still gets every value. The meta is parsed after this
  // script runs, so they are merged in on first use.
  var defaultsMerged = false;
  function mergeDefaults() {
    if (defaultsMerged) return;
    var m = document.querySelector('meta[name="kadr:props"]');
    if (!m) { if (document.readyState !== 'loading') defaultsMerged = true; return; }
    defaultsMerged = true;
    var d = {};
    try { d = JSON.parse(m.getAttribute('content') || '{}') || {}; } catch (e) { d = {}; }
    Object.keys(d).forEach(function (k) { if (props[k] == null) props[k] = d[k]; });
  }

  function applyProps() {
    mergeDefaults();
    var root = document.documentElement;
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || typeof v === 'object') return;
      root.style.setProperty('--' + k, String(v));
    });
    var els = document.querySelectorAll('[data-prop]');
    for (var i = 0; i < els.length; i++) {
      var name = els[i].getAttribute('data-prop');
      if (props[name] != null) els[i].textContent = String(props[name]);
    }
    var srcs = document.querySelectorAll('[data-prop-src]');
    for (var j = 0; j < srcs.length; j++) {
      var n = srcs[j].getAttribute('data-prop-src');
      if (props[n] != null) srcs[j].setAttribute('src', String(props[n]));
    }
  }

  function syncAnimations() {
    var list = document.getAnimations ? document.getAnimations() : [];
    for (var i = 0; i < list.length; i++) {
      try {
        if (list[i].playState !== 'paused') list[i].pause();
        list[i].currentTime = time * 1000;
      } catch (e) { /* ignore broken animation */ }
    }
  }

  function imagesReady() {
    var imgs = document.images;
    var waits = [];
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) {
        waits.push(new Promise(function (r) { imgs[i].addEventListener('load', r, { once: true }); imgs[i].addEventListener('error', r, { once: true }); }));
      }
    }
    return Promise.all(waits);
  }

  var ease = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return t * (2 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
    inCubic: function (t) { return t * t * t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outQuart: function (t) { return 1 - Math.pow(1 - t, 4); },
    outExpo: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    inOutExpo: function (t) { return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2; },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: function (t) { var c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; },
  };

  var kadr = {
    version: 1,
    get props() { mergeDefaults(); return props; },
    rendering: rendering,
    get time() { return time; },
    get duration() { var d = parseFloat(meta('duration')); return isFinite(d) && d > 0 ? d : null; },
    get progress() { var d = this.duration; return d ? Math.min(1, Math.max(0, time / d)) : 0; },
    get width() { return window.innerWidth; },
    get height() { return window.innerHeight; },

    /** Read a prop with a fallback: kadr.prop('title', 'Hello'). */
    prop: function (name, fallback) { mergeDefaults(); return props[name] != null ? props[name] : fallback; },

    /** Run fn(t, kadr) on every frame. Returns an unsubscribe function. */
    onFrame: function (fn) {
      frameFns.push(fn);
      if (started) { try { fn(time, kadr); } catch (e) { report('error', e && e.stack || e); } }
      return function () { var i = frameFns.indexOf(fn); if (i >= 0) frameFns.splice(i, 1); };
    },

    /** Move the composition to time t (seconds). Resolves when the frame is ready to capture. */
    seek: function (t) {
      time = Math.max(0, +t || 0);
      started = true;
      var root = document.documentElement;
      root.style.setProperty('--t', time.toFixed(4));
      var d = kadr.duration;
      if (d) root.style.setProperty('--p', Math.min(1, time / d).toFixed(5));
      for (var i = 0; i < frameFns.length; i++) {
        try { frameFns[i](time, kadr); } catch (e) { report('error', e && e.stack || e); }
      }
      syncAnimations();
      return kadr.whenReady();
    },

    /** Hold the frame until continueRender(handle) — for async loads (fonts, data, images). */
    delayRender: function () { holds++; var done = false; return function () { if (done) return; done = true; kadr.continueRender(); }; },
    continueRender: function () {
      holds = Math.max(0, holds - 1);
      if (!holds) { var w = holdWaiters; holdWaiters = []; w.forEach(function (r) { r(); }); }
    },

    whenReady: function () {
      var waits = [document.fonts ? document.fonts.ready : null, imagesReady()];
      if (holds) waits.push(new Promise(function (r) { holdWaiters.push(r); }));
      return Promise.all(waits).then(function () { return true; });
    },

    // Math helpers for JS-driven animation.
    clamp: function (v, a, b) { return Math.min(b, Math.max(a, v)); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    ease: ease,
    /** interp(t, [t0, t1], [v0, v1], 'outCubic') — clamped, eased. */
    interp: function (t, range, values, easing) {
      var p = (t - range[0]) / ((range[1] - range[0]) || 1e-9);
      p = Math.min(1, Math.max(0, p));
      var fn = typeof easing === 'function' ? easing : ease[easing || 'linear'] || ease.linear;
      return values[0] + (values[1] - values[0]) * fn(p);
    },
    /** 0..1 progress of t inside [t0, t1], eased. */
    progressIn: function (t, t0, t1, easing) { return kadr.interp(t, [t0, t1], [0, 1], easing); },
    /** Seeded random: var r = kadr.random(42); r() -> 0..1, same sequence every frame. */
    random: function (seed) {
      var a = (seed == null ? 1 : seed) >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };

  kadr.ready = new Promise(function (resolve) {
    function boot() {
      applyProps();
      kadr.seek(time).then(resolve);
    }
    if (document.readyState === 'complete') boot();
    else window.addEventListener('load', boot, { once: true });
  });

  // Freeze CSS animations as soon as the DOM exists, before first paint.
  document.addEventListener('DOMContentLoaded', function () { applyProps(); syncAnimations(); });

  window.kadr = kadr;
})();
