import { clipEnd, clamp, stripSpec, tc, transitions, shiftKeys, r3, hasGrade, CLIP_DEFAULTS, LABEL_COLORS } from '/shared/model.js';
import { S, on, emit, live, commit, select, selectMarker, seek, snapFrame, fps, duration, toast } from './state.js';
import { $, h, svg, ICON, clipName, drag, upload, api } from './util.js';
import {
  clipById, trackById, splitClip, clearRange, mediaDuration, addClip, removeTrack, renameTrack, isLocked, keyTimes,
  copySelected, paste, duplicateSelected, splitAtPlayhead, deleteSelected, detachAudio, setSpeed, freezeFrame, reverseClip,
  prevAdjacent, addDissolve, gapAt, closeGap, splitClipsAt, linkClips, unlinkClips, closeAllGaps, detectScenes, removeSilences,
  stabilizeClip,
} from './ops.js';
import { openMenu } from './menu.js';
import { openTransitionPopup } from './transitions.js';
import { dropEffect } from './effects.js';
import { LABEL_HEX, markerHex } from './colors.js';

const HEAD = 150;
const RULER = 26;
const BASE_H = { video: 56, audio: 46 };
const SIZES = { s: 0.72, m: 1, l: 1.5 };
let size = (() => { try { return localStorage.getItem('kadr.trackSize') || 'm'; } catch { return 'm'; } })();
const trackH = (kind) => Math.round(BASE_H[kind] * (SIZES[size] || 1));
const scroll = $('#tlScroll');
const inner = $('#tlInner');
const rowsEl = $('#tlRows');
const ruler = $('#tlRuler');
const playhead = $('#tlPlayhead');
const snapLine = $('#tlSnap');
const marksEl = $('#tlMarks');
const rangeEl = $('#tlRange');
const EPS = 1e-4;

// ---------- zoom ----------
const ZMIN = 2;
const ZMAX = 600;
const zoomEl = $('#zoom');
const toSlider = (pps) => Math.round((Math.log(pps / ZMIN) / Math.log(ZMAX / ZMIN)) * 1000);
const fromSlider = (v) => ZMIN * (ZMAX / ZMIN) ** (v / 1000);

export function setZoom(pps, anchorClientX) {
  pps = clamp(pps, ZMIN, ZMAX);
  const r = scroll.getBoundingClientRect();
  const ax = anchorClientX ?? r.left + HEAD + (S.t * S.pps - scroll.scrollLeft);
  const tAt = (ax - r.left - HEAD + scroll.scrollLeft) / S.pps;
  S.pps = pps;
  zoomEl.value = toSlider(pps);
  render();
  scroll.scrollLeft = Math.max(0, tAt * pps - (ax - r.left - HEAD));
  drawViewport();
}
export function zoomFit() {
  const w = scroll.clientWidth - HEAD - 40;
  setZoom(w / Math.max(duration(), 5));
  scroll.scrollLeft = 0;
}
zoomEl.oninput = () => setZoom(fromSlider(+zoomEl.value));
$('#zoomFit').onclick = zoomFit;
scroll.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    setZoom(S.pps * Math.exp(-e.deltaY * 0.0025), e.clientX);
  } else if (e.altKey) {
    e.preventDefault();
    scroll.scrollLeft += e.deltaY;
  }
}, { passive: false });

/** Track heights: small / medium / large. */
export function setTrackSize(s) {
  size = SIZES[s] ? s : 'm';
  try { localStorage.setItem('kadr.trackSize', size); } catch { /* private */ }
  rowsEl.dataset.sig = '';
  render();
}
export const trackSize = () => size;

// ---------- geometry ----------
export const timeAt = (clientX) => (clientX - scroll.getBoundingClientRect().left - HEAD + scroll.scrollLeft) / S.pps;
const xOf = (t) => HEAD + t * S.pps;

function displayTracks() {
  const p = S.project;
  return [...p.tracks.filter((t) => t.kind === 'video').reverse(), ...p.tracks.filter((t) => t.kind === 'audio')];
}

// ---------- media caches for thumbnails / waveforms ----------
const strips = new Map();
const peaks = new Map();
function getStrip(src) {
  if (strips.has(src)) return strips.get(src);
  const info = S.media.get(src);
  const e = { img: null, ok: false, count: stripSpec(info?.duration || 1).count };
  strips.set(src, e);
  const img = new Image();
  img.onload = () => { e.ok = true; drawViewport(); };
  img.src = `/api/strip?src=${encodeURIComponent(src)}`;
  e.img = img;
  return e;
}
function getImage(src) {
  if (strips.has(src)) return strips.get(src);
  const e = { img: new Image(), ok: false, count: 1 };
  strips.set(src, e);
  e.img.onload = () => { e.ok = true; drawViewport(); };
  e.img.src = `/p/${src.split('/').map(encodeURIComponent).join('/')}`;
  return e;
}
function getPeaks(src) {
  if (peaks.has(src)) return peaks.get(src);
  const e = { data: null };
  peaks.set(src, e);
  fetch(`/api/peaks?src=${encodeURIComponent(src)}`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => {
    if (b) { e.data = new Uint8Array(b); drawViewport(); }
  }).catch(() => {});
  return e;
}
on('media', () => {
  for (const [k, v] of strips) if (!v.ok) strips.delete(k);
  for (const [k, v] of peaks) if (!v.data) peaks.delete(k);
});

/** Effects on a clip, for the little "fx" badge. */
function fxCount(c) {
  return [c.mask, c.key, c.blur > 0 || c.keys?.blur, c.blend && c.blend !== 'normal', hasGrade(c) || ['brightness', 'contrast', 'saturation'].some((k) => (c[k] ?? 1) !== 1)].filter(Boolean).length;
}

// ---------- render ----------
const clipEls = new Map();
let booted = false;
setTimeout(() => { booted = true; }, 1500);
let rowEls = [];

const LINK_SVG = '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>';
const SOLO_SVG = '<text x="8" y="11.6" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none" font-family="Inter, system-ui, sans-serif">S</text>';

export function render() {
  const p = S.project;
  if (!p) return;
  const D = duration();
  const contentW = Math.max((D + 30) * S.pps, scroll.clientWidth - HEAD);
  inner.style.width = `${HEAD + contentW}px`;

  const tracks = displayTracks();
  const anySolo = p.tracks.some((t) => t.solo);
  const sig = `${size}|${anySolo}|${tracks.map((t) => `${t.id}:${t.kind}:${t.hidden ? 1 : 0}:${t.muted ? 1 : 0}:${t.solo ? 1 : 0}:${t.locked ? 1 : 0}:${t.name || ''}`).join('|')}`;
  if (rowsEl.dataset.sig !== sig) {
    rowsEl.dataset.sig = sig;
    rowsEl.dataset.xsig = '';
    rowsEl.replaceChildren();
    rowEls = tracks.map((t) => {
      const lane = h('div.tl-lane', { 'data-track': t.id });
      const btns = [];
      if (t.kind === 'video') {
        btns.push(h('button.btn.ghost.icon', { title: t.hidden ? 'Show track' : 'Hide track', class: `btn ghost icon${t.hidden ? ' off' : ''}`, on: { click: () => commit(() => { trackById(t.id).hidden = !t.hidden; }) } }, svg(t.hidden ? ICON.eyeOff : ICON.eye)));
      }
      btns.push(h('button.btn.ghost.icon', { title: t.muted ? 'Unmute track' : 'Mute track', class: `btn ghost icon${t.muted ? ' off' : ''}`, on: { click: () => commit(() => { trackById(t.id).muted = !t.muted; }) } }, svg(t.muted ? ICON.mute : ICON.sound)));
      btns.push(h('button.btn.ghost.icon', { title: t.solo ? 'Stop soloing' : 'Solo: hear only this track (and other soloed ones)', class: `btn ghost icon solo${t.solo ? ' on' : ''}`, on: { click: () => commit(() => { trackById(t.id).solo = !t.solo; }) } }, svg(SOLO_SVG)));
      btns.push(h('button.btn.ghost.icon', { title: t.locked ? 'Unlock track' : 'Lock track (no edits)', class: `btn ghost icon${t.locked ? ' locked' : ''}`, on: { click: () => {
        commit(() => { trackById(t.id).locked = !t.locked; });
        if (!t.locked) select([...S.sel].filter((id) => clipById(id)?.track !== t.id), { alone: true });
      } } }, svg(t.locked ? ICON.lock : ICON.unlock)));
      const nm = h('div.nm', { title: `${t.id}${t.name ? ` · ${t.name}` : ''}\nDouble-click to rename` }, h('span.tid', {}, t.id), t.name ? h('span.tname', {}, t.name) : null);
      nm.addEventListener('dblclick', () => {
        const input = h('input.nm-edit', { value: t.name || '', placeholder: t.id, spellcheck: false, dir: 'auto' });
        const done = (ok) => { if (ok) renameTrack(t.id, input.value.trim()); else render(); };
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.onblur = null; done(false); } });
        input.onblur = () => done(true);
        nm.replaceChildren(input);
        input.focus();
        input.select();
      });
      const stuck = t.hidden || t.muted || t.locked || t.solo;
      const dim = anySolo && !t.solo;
      const head = h(`div.tl-head.k-${t.kind}`, { on: { contextmenu: (e) => { e.preventDefault(); trackMenu(e, t); } } }, h('i.tl-kind'), nm, h(`div.tl-hb${stuck ? '.stuck' : ''}`, {}, ...btns));
      const row = h(`div.tl-row.k-${t.kind}${t.locked ? '.locked' : ''}${dim ? '.dim' : ''}`, { 'data-track': t.id, style: { height: `${trackH(t.kind)}px` } }, head, lane);
      rowsEl.append(row);
      return { t, row, lane };
    });
    clipEls.clear();
  }

  const lanes = new Map(rowEls.map((r) => [r.t.id, r.lane]));
  const seen = new Set();
  for (const c of p.clips) {
    const lane = lanes.get(c.track);
    if (!lane) continue;
    seen.add(c.id);
    let el = clipEls.get(c.id);
    if (!el || el.parentNode !== lane) {
      el?.remove();
      el = h('div.clip', { 'data-id': c.id },
        h('canvas'), h('div.fd.in'), h('div.fd.out'), h('div.lb'), h('div.kfs'), h('div.h.l'), h('div.h.r'));
      lane.append(el);
      if (booted) { el.dataset.fresh = '1'; setTimeout(() => { delete el.dataset.fresh; el.classList.remove('new'); }, 400); }
      clipEls.set(c.id, el);
    }
    el.className = `clip k-${c.type}${el.dataset.fresh ? ' new' : ''}${S.sel.has(c.id) ? ' sel' : ''}${c.disabled ? ' off' : ''}${S.compErrors.has(c.src) ? ' err' : ''}${c.labelColor ? ' lc' : ''}`;
    if (c.labelColor) el.style.setProperty('--lc', LABEL_HEX[c.labelColor] || '#888');
    else el.style.removeProperty('--lc');
    el.style.left = `${c.start * S.pps}px`;
    el.style.width = `${Math.max(2, c.duration * S.pps)}px`;
    const lb = el.querySelector('.lb');
    const name = clipName(c);
    const sp = (c.speed || 1) !== 1 ? `${Math.round(c.speed * 100)}%` : '';
    const nfx = c.type === 'audio' ? (c.pan ? 1 : 0) : fxCount(c);
    const lsig = `${name}|${sp}|${nfx}|${c.link || ''}`;
    if (lb.dataset.v !== lsig) {
      lb.dataset.v = lsig;
      lb.replaceChildren(...[
        c.link ? h('i.lk-ico', { title: 'Linked: moves and trims with its partner clips' }, svg(LINK_SVG)) : null,
        h('span.lbt', {}, name),
        sp ? h('em', {}, sp) : null,
        nfx ? h('b.fxb', { title: `${nfx} effect${nfx > 1 ? 's' : ''}` }, 'fx') : null,
      ].filter(Boolean));
    }
    el.title = `${name}\n${c.start.toFixed(2)}s → ${clipEnd(c).toFixed(2)}s  (${c.duration.toFixed(2)}s)${S.compErrors.has(c.src) ? `\n⚠ ${S.compErrors.get(c.src)}` : ''}`;
    el.querySelector('.fd.in').style.width = `${c.fadeIn * S.pps}px`;
    el.querySelector('.fd.out').style.width = `${c.fadeOut * S.pps}px`;
    const kfs = el.querySelector('.kfs');
    const kts = S.sel.has(c.id) && c.keys ? keyTimes(c) : [];
    const ksig = kts.join(',') + S.pps;
    if (kfs.dataset.sig !== ksig) {
      kfs.dataset.sig = ksig;
      kfs.replaceChildren(...kts.map((t) => h('i', { style: { left: `${t * S.pps}px` }, title: `keyframe ${t.toFixed(2)}s`, 'data-t': c.start + t })));
    }
  }
  for (const [id, el] of clipEls) if (!seen.has(id)) { el.remove(); clipEls.delete(id); }

  // cross dissolves: a band centred on the cut
  const trs = transitions(p);
  const xsig = [...trs].filter(([, v]) => v.xin).map(([id, v]) => `${id}:${clipById(id)?.start}:${v.xin}`).join('|') + S.pps;
  if (rowsEl.dataset.xsig !== xsig) {
    rowsEl.dataset.xsig = xsig;
    for (const x of rowsEl.querySelectorAll('.xf')) x.remove();
    for (const [id, v] of trs) {
      if (!v.xin) continue;
      const c = clipById(id);
      const lane = lanes.get(c.track);
      if (!lane) continue;
      lane.append(h('div.xf', { 'data-id': id, title: `Cross dissolve ${v.xin.toFixed(2)}s · click to select`, style: { left: `${(c.start - v.xin / 2) * S.pps}px`, width: `${Math.max(6, v.xin * S.pps)}px` } }));
    }
  }

  // markers + in/out
  marksEl.replaceChildren(...p.markers.map((m) => h('div.tl-mark', { style: { left: `${xOf(m.t)}px`, '--mc': markerHex(m) } })));
  if (S.inPt != null || S.outPt != null) {
    const a = S.inPt ?? 0;
    const b = S.outPt ?? D;
    rangeEl.style.display = 'block';
    rangeEl.style.left = `${xOf(a)}px`;
    rangeEl.style.width = `${Math.max(0, (b - a) * S.pps)}px`;
    $('#rangeInfo').textContent = `in ${tc(a, p.fps)}  out ${tc(b, p.fps)}  (${tc(b - a, p.fps)})`;
  } else {
    rangeEl.style.display = 'none';
    $('#rangeInfo').textContent = '';
  }
  drawPlayhead();
  drawViewport();
  emit('tl-render');
}

export function drawPlayhead() {
  playhead.style.transform = `translateX(${xOf(S.t)}px)`;
  drawRuler();
  if (S.playing) {
    const x = S.t * S.pps;
    const vw = scroll.clientWidth - HEAD;
    if (x > scroll.scrollLeft + vw - 40 || x < scroll.scrollLeft) scroll.scrollLeft = S.rate < 0 ? x - vw + 40 : x - 40;
  }
}

// ---------- canvas drawing (ruler + clip thumbnails/waveforms) ----------
let vpQueued = false;
function drawViewport() {
  if (vpQueued) return;
  vpQueued = true;
  requestAnimationFrame(() => { vpQueued = false; drawRuler(); drawClips(); });
}
scroll.addEventListener('scroll', drawViewport, { passive: true });
new ResizeObserver(() => { render(); }).observe(scroll);

function niceStep(pps) {
  const steps = [1 / 30, 2 / 30, 5 / 30, 10 / 30, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  return steps.find((s) => s * pps >= 70) || 3600;
}

const cssVar = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;

function drawRuler() {
  if (!S.project) return;
  const dpr = window.devicePixelRatio || 1;
  const w = scroll.clientWidth - HEAD;
  if (ruler.width !== Math.round(w * dpr)) { ruler.width = Math.round(w * dpr); ruler.style.width = `${w}px`; ruler.height = RULER * dpr; }
  const g = ruler.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, RULER);
  const sl = scroll.scrollLeft;
  const step = niceStep(S.pps);
  const sub = step / 5;
  const t0 = sl / S.pps;
  const t1 = (sl + w) / S.pps;
  const accent = cssVar('--accent', '#e8ff59');
  // in/out band
  if (S.inPt != null || S.outPt != null) {
    const a = (S.inPt ?? 0) * S.pps - sl;
    const b = (S.outPt ?? duration()) * S.pps - sl;
    g.globalAlpha = 0.16;
    g.fillStyle = accent;
    g.fillRect(a, 0, b - a, RULER);
    g.globalAlpha = 1;
  }
  g.strokeStyle = cssVar('--tick', '#3a3a40');
  g.fillStyle = cssVar('--faint', '#7d7d86');
  g.font = '10px ui-monospace, monospace';
  g.beginPath();
  for (let t = Math.floor(t0 / sub) * sub; t <= t1; t += sub) {
    const x = Math.round(t * S.pps - sl) + 0.5;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    g.moveTo(x, major ? 12 : 19);
    g.lineTo(x, RULER);
    if (major) g.fillText(label(Math.round(t / step) * step, step), x + 4, 11);
  }
  g.stroke();
  for (const m of S.project.markers) {
    const x = m.t * S.pps - sl;
    if (x < -10 || x > w + 10) continue;
    g.fillStyle = markerHex(m);
    g.globalAlpha = S.marker === m.id ? 1 : 0.85;
    g.beginPath();
    g.moveTo(x - 5, 14); g.lineTo(x + 5, 14); g.lineTo(x + 5, 20); g.lineTo(x, 25); g.lineTo(x - 5, 20);
    g.fill();
    if (S.marker === m.id) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); g.lineWidth = 1; }
    g.globalAlpha = 1;
  }
  const px = Math.round(S.t * S.pps - sl) + 0.5;
  if (px > -8 && px < w + 8) {
    g.fillStyle = accent;
    g.beginPath();
    g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px + 6, 8); g.lineTo(px, 14); g.lineTo(px - 6, 8);
    g.fill();
    g.fillRect(px - 0.5, 0, 1, RULER);
  }
}

function label(t, step) {
  const f = fps();
  if (step < 1) {
    const s = Math.floor(t + 1e-6);
    const fr = Math.round((t - s) * f);
    return fr ? `${fr}f` : `${s}s`;
  }
  if (t < 60) return `${Math.round(t)}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function drawClips() {
  if (!S.project) return;
  const sl = scroll.scrollLeft;
  const vw = scroll.clientWidth - HEAD;
  const dpr = window.devicePixelRatio || 1;
  for (const c of S.project.clips) {
    const el = clipEls.get(c.id);
    if (!el) continue;
    const cv = el.firstChild;
    const cx0 = c.start * S.pps;
    const cw = c.duration * S.pps;
    const a = Math.max(0, sl - cx0);
    const b = Math.min(cw, sl + vw - cx0);
    if (b <= a || c.type === 'html') { cv.style.display = 'none'; continue; }
    const H = el.clientHeight;
    const W = Math.ceil(b - a);
    const sp = c.speed || 1;
    const key = `${a}|${W}|${H}|${S.pps}|${c.in}|${sp}|${c.src}|${c.volume}`;
    cv.style.display = '';
    cv.style.left = `${a}px`;
    cv.style.width = `${W}px`;
    if (cv.dataset.key === key && cv.dataset.done) continue;
    cv.dataset.key = key;
    cv.dataset.done = '';
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let complete = true;
    const info = S.media.get(c.src);
    const wave = c.type === 'video' && info?.hasAudio ? Math.max(10, Math.round(H * 0.26)) : 0;
    if (c.type === 'video' || c.type === 'image') {
      const st = c.type === 'video' ? getStrip(c.src) : getImage(c.src);
      if (st.ok) {
        const img = st.img;
        const tw = img.naturalWidth / st.count;
        const th = img.naturalHeight;
        const hh = H - wave;
        const dw = (tw * hh) / th;
        const interval = stripSpec(info?.duration || 1).interval;
        g.globalAlpha = 0.85;
        for (let x = Math.floor(a / dw) * dw; x < b; x += dw) {
          const idx = c.type === 'video' ? clamp(Math.floor((c.in + ((x + dw / 2) / S.pps) * sp) / interval), 0, st.count - 1) : 0;
          g.drawImage(img, idx * tw, 0, tw, th, x - a, 0, dw, hh);
        }
        g.globalAlpha = 1;
      } else complete = false;
    }
    if ((c.type === 'audio' || (c.type === 'video' && info?.hasAudio))) {
      const pk = getPeaks(c.src);
      if (pk.data) {
        const top = c.type === 'audio' ? 16 : H - wave;
        const hh = H - top - 2;
        const mid = top + hh / 2;
        g.fillStyle = 'rgba(159,224,193,.75)';
        if (c.type === 'video') { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, top - 1, W, hh + 3); g.fillStyle = 'rgba(159,224,193,.7)'; }
        const vol = Math.min(1.5, c.volume);
        for (let x = 0; x < W; x++) {
          const t0 = c.in + ((a + x) / S.pps) * sp;
          const t1 = t0 + sp / S.pps;
          let m = 0;
          for (let i = Math.floor(t0 * 100), e = Math.max(i + 1, Math.ceil(t1 * 100)); i < e && i < pk.data.length; i++) if (pk.data[i] > m) m = pk.data[i];
          const amp = Math.min(1, (m / 255) * vol) * hh / 2;
          if (amp > 0.3) g.fillRect(x, mid - amp, 1, amp * 2);
        }
      } else complete = false;
    }
    if (complete) cv.dataset.done = '1';
  }
}

// ---------- interactions ----------
function snapPoints(exclude) {
  const pts = [0, S.t];
  for (const m of S.project.markers) pts.push(m.t);
  if (S.inPt != null) pts.push(S.inPt);
  if (S.outPt != null) pts.push(S.outPt);
  for (const c of S.project.clips) if (!exclude.has(c.id)) pts.push(c.start, clipEnd(c));
  return pts;
}

function snapTo(cands, pts) {
  if (!S.snap) return { d: 0, at: null };
  const tol = 8 / S.pps;
  let best = { d: 0, at: null, dist: tol };
  for (const v of cands) for (const p of pts) {
    const dist = Math.abs(p - v);
    if (dist < best.dist) best = { d: p - v, at: p, dist };
  }
  return best;
}

function showSnap(at) {
  if (at == null) { snapLine.style.display = 'none'; return; }
  snapLine.style.display = 'block';
  snapLine.style.left = `${xOf(at)}px`;
}

// a small label that follows the pointer during trims, slips and slides
const tipEl = h('div.tl-tip', { hidden: true });
document.body.append(tipEl);
function tip(ev, text) {
  if (text == null) { tipEl.hidden = true; return; }
  tipEl.hidden = false;
  tipEl.textContent = text;
  tipEl.style.left = `${ev.clientX + 14}px`;
  tipEl.style.top = `${ev.clientY - 30}px`;
}
const tcs = (t) => tc(Math.max(0, t), S.project.fps);
const dts = (d) => `${d >= 0 ? '+' : '−'}${tc(Math.abs(d), S.project.fps)}`;

function trackAtY(clientY) {
  for (const r of rowEls) {
    const b = r.row.getBoundingClientRect();
    if (clientY >= b.top && clientY < b.bottom) return r.t;
  }
  return null;
}

/** Linked clips whose edge sits where c's edge is (they trim together). */
function edgePartners(c, edge) {
  if (!c.link || !S.linked) return [];
  const f = 0.5 / S.project.fps;
  return S.project.clips.filter((x) => x.id !== c.id && x.link === c.link && !isLocked(x)
    && (edge === 'l' ? Math.abs(x.start - c.start) < f : Math.abs(clipEnd(x) - clipEnd(c)) < f));
}

rowsEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (S.tool === 'hand') return handDrag(e);
  if (e.target.dataset?.t && e.target.closest('.kfs')) { e.preventDefault(); seek(Number(e.target.dataset.t)); return; }
  if (e.target.classList.contains('xf')) { e.preventDefault(); select([e.target.dataset.id], { alone: true }); return; }
  const clipEl = e.target.closest('.clip');
  if (S.tool === 'track' && e.target.closest('.tl-lane')) return trackSelectForward(e);
  if (clipEl && e.target.closest('.tl-row.locked')) { seekFromPointer(e); return; }
  if (!clipEl) {
    if (e.target.closest('.tl-lane')) {
      select([]);
      seekFromPointer(e);
    }
    return;
  }
  const c = clipById(clipEl.dataset.id);
  if (!c) return;
  e.preventDefault();
  if (S.tool === 'razor') {
    const t = snapFrame(timeAt(e.clientX));
    splitClipsAt(S.snap && Math.abs(t - S.t) < 8 / S.pps ? S.t : t, [c.id]);
    return;
  }
  const edge = e.target.classList.contains('h') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (additive && !edge) {
    if (S.sel.has(c.id)) {
      // drop it and its linked partners
      const drop = new Set(S.linked && c.link ? S.project.clips.filter((x) => x.link === c.link).map((x) => x.id) : [c.id]);
      select([...S.sel].filter((id) => !drop.has(id)), { alone: true });
      return;
    }
    select([c.id], { add: true });
  } else if (!S.sel.has(c.id) || edge) select([c.id]);
  if (e.altKey && !edge) return dragDuplicate(e, c);
  if (edge) {
    if (S.tool === 'ripple') return trimDrag(e, c, edge, 'ripple');
    if (S.tool === 'rate') return rateDrag(e, c, edge);
    if (S.tool === 'roll') return rollDrag(e, c, edge);
    return trimDrag(e, c, edge, 'trim');
  }
  if (S.tool === 'slip') return slipDrag(e, c);
  if (S.tool === 'slide') return slideDrag(e, c);
  moveDrag(e, c);
});

function moveDrag(e, lead) {
  const moving = [...S.sel].map(clipById).filter(Boolean).filter((m) => !isLocked(m));
  if (!moving.length) return;
  const ids = new Set(moving.map((m) => m.id));
  const orig = new Map(moving.map((m) => [m.id, { start: m.start, track: m.track }]));
  const pts = snapPoints(ids);
  const minStart = Math.min(...moving.map((m) => m.start));
  const lo = orig.get(lead.id);
  drag(e, (dx, _dy, ev) => {
    let ns = lo.start + dx / S.pps;
    const sn = snapTo([ns, ns + lead.duration], pts);
    ns += sn.d;
    let dt = snapFrame(ns) - lo.start;
    if (minStart + dt < 0) dt = -minStart;
    let target = null;
    if (moving.length === 1) {
      const tr = trackAtY(ev.clientY);
      if (tr && tr.kind === trackById(lead.track).kind && !tr.locked) target = tr.id;
    }
    live(() => {
      for (const m of moving) {
        m.start = Math.max(0, orig.get(m.id).start + dt);
        if (target) m.track = target;
      }
    });
    showSnap(sn.at);
    tip(ev, `${tcs(lead.start)}  ${dts(dt)}`);
  }, (ev, moved) => {
    showSnap(null);
    tip(ev, null);
    if (!moved) {
      if (!(ev.shiftKey || ev.ctrlKey || ev.metaKey)) select([lead.id]);
      return;
    }
    commit((p) => {
      const keep = new Set(ids);
      for (const m of moving) clearRange(p, m.track, m.start, clipEnd(m), keep);
    });
  });
}

function dragDuplicate(e, c) {
  const copy = structuredClone(c);
  commit((p) => {
    copy.id = `${c.id}x${Math.random().toString(36).slice(2, 5)}`;
    delete copy.link;
    p.clips.push(copy);
  });
  select([copy.id]);
  moveDrag(e, clipById(copy.id));
}

/**
 * Drag a clip edge. mode 'trim' stops at the neighbours; 'ripple' moves every later
 * clip on the same tracks by the same amount (and keeps the clip's start for head trims).
 * Linked partners with the same edge trim along.
 */
function trimDrag(e, c, edge, mode) {
  const group = [c, ...edgePartners(c, edge)];
  const f = 1 / fps();
  const orig = new Map(group.map((x) => [x.id, { start: x.start, duration: x.duration, in: x.in, keys: x.keys ? structuredClone(x.keys) : null }]));
  const o = orig.get(c.id);
  const end = o.start + o.duration;
  const tracks = new Set(group.map((x) => x.track));
  const gids = new Set(group.map((x) => x.id));
  // bounds of the edge time, intersected over the group
  let lo = -Infinity;
  let hi = Infinity;
  const later = mode === 'ripple' ? S.project.clips.filter((x) => tracks.has(x.track) && !gids.has(x.id) && x.start >= end - EPS) : [];
  const laterStart = new Map(later.map((x) => [x.id, x.start]));
  for (const x of group) {
    const ox = orig.get(x.id);
    const xe = ox.start + ox.duration;
    const sp = x.speed || 1;
    const usesIn = x.type !== 'image';
    const mdur = mediaDuration(x);
    const others = S.project.clips.filter((y) => y.track === x.track && !gids.has(y.id));
    if (edge === 'l') {
      const prevEnd = Math.max(0, ...others.filter((y) => clipEnd(y) <= ox.start + EPS).map(clipEnd));
      lo = Math.max(lo, mode === 'ripple' ? 0 : prevEnd, usesIn ? ox.start - ox.in / sp : 0, 0);
      hi = Math.min(hi, xe - f);
    } else {
      const nextStart = Math.min(Infinity, ...others.filter((y) => y.start >= xe - EPS).map((y) => y.start));
      lo = Math.max(lo, ox.start + f);
      hi = Math.min(hi, mode === 'ripple' ? Infinity : nextStart, Number.isFinite(mdur) ? ox.start + (mdur - ox.in) / sp : Infinity);
    }
  }
  const pts = snapPoints(gids);
  drag(e, (dx, _dy, ev) => {
    const dt = dx / S.pps;
    let at = (edge === 'l' ? o.start : end) + dt;
    const sn = snapTo([at], pts);
    at = clamp(snapFrame(at + sn.d), lo, hi);
    const d = at - (edge === 'l' ? o.start : end);
    live(() => {
      for (const x of group) {
        const ox = orig.get(x.id);
        const sp = x.speed || 1;
        x.keys = ox.keys ? structuredClone(ox.keys) : undefined;
        if (!x.keys) delete x.keys;
        if (edge === 'l') {
          if (x.type !== 'image') x.in = Math.max(0, ox.in + d * sp);
          shiftKeys(x, -d);
          x.duration = ox.duration - d;
          // ripple keeps the clip where it is and pulls the rest in
          x.start = mode === 'ripple' ? ox.start : ox.start + d;
        } else x.duration = ox.duration + d;
      }
      if (mode === 'ripple') {
        const shift = edge === 'l' ? -d : d;
        for (const x of later) x.start = Math.max(0, laterStart.get(x.id) + shift);
      }
    });
    showSnap(sn.at);
    tip(ev, `${mode === 'ripple' ? 'Ripple ' : ''}${edge === 'l' ? 'in' : 'out'} ${dts(d)}  ·  ${tc(c.duration, S.project.fps)}`);
  }, (ev, moved) => {
    showSnap(null);
    tip(ev, null);
    if (moved) commit((p) => {
      for (const id of gids) {
        const x = p.clips.find((k) => k.id === id);
        x.fadeIn = Math.min(x.fadeIn, x.duration);
        x.fadeOut = Math.min(x.fadeOut, x.duration);
      }
    });
  });
}

/** Rate stretch: drag an edge to change the clip's length; its speed changes so the same footage fits. */
function rateDrag(e, c, edge) {
  if (c.type === 'image') return trimDrag(e, c, edge, 'trim');
  const o = { start: c.start, duration: c.duration, speed: c.speed || 1, keys: c.keys ? structuredClone(c.keys) : null };
  const span = o.duration * o.speed;
  const end = o.start + o.duration;
  const others = S.project.clips.filter((y) => y.track === c.track && y.id !== c.id);
  const prevEnd = Math.max(0, ...others.filter((y) => clipEnd(y) <= o.start + EPS).map(clipEnd));
  const nextStart = Math.min(Infinity, ...others.filter((y) => y.start >= end - EPS).map((y) => y.start));
  const pts = snapPoints(new Set([c.id]));
  drag(e, (dx, _dy, ev) => {
    let at = (edge === 'l' ? o.start : end) + dx / S.pps;
    const sn = snapTo([at], pts);
    at = snapFrame(at + sn.d);
    let d = edge === 'l' ? end - at : at - o.start;
    d = clamp(d, span / 16, span / 0.1);
    if (edge === 'l') d = Math.min(d, end - prevEnd); else d = Math.min(d, nextStart - o.start);
    const speed = Math.round((span / d) * 1000) / 1000;
    live(() => {
      c.keys = o.keys ? structuredClone(o.keys) : undefined;
      if (!c.keys) delete c.keys;
      shiftKeys(c, 0, o.speed / speed);
      c.speed = speed;
      c.duration = d;
      c.start = edge === 'l' ? end - d : o.start;
    });
    showSnap(sn.at);
    tip(ev, `Speed ${Math.round(speed * 100)}%  ·  ${tc(d, S.project.fps)}`);
  }, (ev, moved) => {
    showSnap(null);
    tip(ev, null);
    if (moved) commit();
  });
}

/** Rolling edit: move the cut between two touching clips; the total length stays the same. */
function rollDrag(e, c, edge) {
  const f = 1 / fps();
  const a = edge === 'r' ? c : prevAdjacent(c);
  const b = edge === 'r' ? S.project.clips.find((x) => x.track === c.track && x.id !== c.id && Math.abs(x.start - clipEnd(c)) < 0.5 * f) : c;
  if (!a || !b) return trimDrag(e, c, edge, 'trim');
  const oa = { duration: a.duration };
  const ob = { start: b.start, duration: b.duration, in: b.in, keys: b.keys ? structuredClone(b.keys) : null };
  const cut = ob.start;
  const spa = a.speed || 1;
  const spb = b.speed || 1;
  const mda = mediaDuration(a);
  const lo = Math.max(a.start + f, b.type !== 'image' ? cut - ob.in / spb : -Infinity);
  const hi = Math.min(ob.start + ob.duration - f, Number.isFinite(mda) && a.type !== 'image' ? a.start + (mda - a.in) / spa : Infinity);
  const pts = snapPoints(new Set([a.id, b.id]));
  drag(e, (dx, _dy, ev) => {
    let at = cut + dx / S.pps;
    const sn = snapTo([at], pts);
    at = clamp(snapFrame(at + sn.d), lo, hi);
    const d = at - cut;
    live(() => {
      a.duration = oa.duration + d;
      b.keys = ob.keys ? structuredClone(ob.keys) : undefined;
      if (!b.keys) delete b.keys;
      shiftKeys(b, -d);
      b.start = ob.start + d;
      b.duration = ob.duration - d;
      if (b.type !== 'image') b.in = Math.max(0, ob.in + d * spb);
    });
    showSnap(sn.at);
    tip(ev, `Roll ${dts(d)}`);
  }, (ev, moved) => {
    showSnap(null);
    tip(ev, null);
    if (moved) commit((p) => {
      for (const x of [p.clips.find((k) => k.id === a.id), p.clips.find((k) => k.id === b.id)]) {
        x.fadeIn = Math.min(x.fadeIn, x.duration);
        x.fadeOut = Math.min(x.fadeOut, x.duration);
      }
    });
  });
}

/** Slip: keep the clip in place and change which part of the footage it shows. */
function slipDrag(e, c) {
  if (c.type === 'image') return moveDrag(e, c);
  const group = [c, ...(S.linked && c.link ? S.project.clips.filter((x) => x.link === c.link && x.id !== c.id && x.src === c.src) : [])];
  const orig = new Map(group.map((x) => [x.id, x.in]));
  let lo = -Infinity;
  let hi = Infinity;
  for (const x of group) {
    const sp = x.speed || 1;
    const mdur = mediaDuration(x);
    lo = Math.max(lo, -orig.get(x.id) / sp);
    if (Number.isFinite(mdur)) hi = Math.min(hi, (mdur - x.duration * sp - orig.get(x.id)) / sp);
  }
  drag(e, (dx, _dy, ev) => {
    // dragging right shows earlier footage (the clip slides over its source)
    const d = clamp(-dx / S.pps, lo, Math.max(lo, hi));
    live(() => { for (const x of group) x.in = Math.max(0, r3(orig.get(x.id) + d * (x.speed || 1))); });
    tip(ev, `Slip  in ${tcs(c.in)}  out ${tcs(c.in + c.duration * (c.speed || 1))}`);
  }, (ev, moved) => {
    tip(ev, null);
    if (moved) commit();
  });
}

/** Slide: move the clip between its neighbours; they get longer / shorter so nothing else moves. */
function slideDrag(e, c) {
  const f = 1 / fps();
  const a = prevAdjacent(c);
  const b = S.project.clips.find((x) => x.track === c.track && x.id !== c.id && !x.disabled && Math.abs(x.start - clipEnd(c)) < 0.5 * f);
  if (!a && !b) return moveDrag(e, c);
  const o = { start: c.start };
  const oa = a && { duration: a.duration };
  const ob = b && { start: b.start, duration: b.duration, in: b.in, keys: b.keys ? structuredClone(b.keys) : null };
  let lo = -Infinity;
  let hi = Infinity;
  if (a) {
    lo = Math.max(lo, -(oa.duration - f));
    const mda = mediaDuration(a);
    if (Number.isFinite(mda) && a.type !== 'image') hi = Math.min(hi, (mda - a.in) / (a.speed || 1) - oa.duration);
  } else lo = Math.max(lo, -o.start);
  if (b) {
    hi = Math.min(hi, ob.duration - f);
    if (b.type !== 'image') lo = Math.max(lo, -ob.in / (b.speed || 1));
  }
  drag(e, (dx, _dy, ev) => {
    const d = clamp(snapFrame(dx / S.pps), lo, hi);
    live(() => {
      c.start = o.start + d;
      if (a) a.duration = oa.duration + d;
      if (b) {
        b.keys = ob.keys ? structuredClone(ob.keys) : undefined;
        if (!b.keys) delete b.keys;
        shiftKeys(b, -d);
        b.start = ob.start + d;
        b.duration = ob.duration - d;
        if (b.type !== 'image') b.in = Math.max(0, ob.in + d * (b.speed || 1));
      }
    });
    tip(ev, `Slide ${dts(d)}`);
  }, (ev, moved) => {
    tip(ev, null);
    if (moved) commit();
  });
}

/** Track select forward: everything from the click onward (Shift: only this track), then drag it. */
function trackSelectForward(e) {
  e.preventDefault();
  const t = timeAt(e.clientX);
  const tid = e.target.closest('.tl-lane')?.dataset.track;
  const list = S.project.clips.filter((c) => !isLocked(c) && clipEnd(c) > t + EPS && (!e.shiftKey || c.track === tid));
  if (!list.length) { select([]); return; }
  select(list.map((c) => c.id), { alone: true });
  const lead = list.reduce((m, c) => (c.start < m.start ? c : m), list[0]);
  moveDrag(e, lead);
}

/** Hand: drag to scroll the timeline. */
function handDrag(e) {
  e.preventDefault();
  const sl = scroll.scrollLeft;
  const st = scroll.scrollTop;
  document.body.classList.add('grabbing');
  drag(e, (dx, dy) => { scroll.scrollLeft = sl - dx; scroll.scrollTop = st - dy; }, () => document.body.classList.remove('grabbing'));
}

function seekFromPointer(e) {
  const go = (ev) => {
    let t = Math.max(0, timeAt(ev.clientX));
    if (S.snap && !ev.shiftKey) {
      const sn = snapTo([t], snapPoints(new Set()).slice(2).concat(S.project.markers.map((m) => m.t)));
      t += sn.d;
    }
    seek(snapFrame(t));
  };
  go(e);
  drag(e, (_dx, _dy, ev) => go(ev));
}

ruler.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const t = timeAt(e.clientX);
  const hit = S.project.markers.find((m) => Math.abs(m.t - t) * S.pps < 6);
  if (hit && e.offsetY > 10) {
    selectMarker(hit.id);
    const t0 = hit.t;
    drag(e, (dx) => {
      live(() => { hit.t = snapFrame(Math.max(0, t0 + dx / S.pps)); });
      drawRuler();
    }, (_ev, moved) => { if (moved) commit(); else seek(hit.t); });
    return;
  }
  seekFromPointer(e);
});
$('#tlCorner').addEventListener('pointerdown', () => select([]));

// razor hover line
let razorLine = null;
rowsEl.addEventListener('pointermove', (e) => {
  if (S.tool !== 'razor') { razorLine?.remove(); razorLine = null; return; }
  const clipEl = e.target.closest('.clip');
  if (!clipEl) { razorLine?.remove(); razorLine = null; return; }
  if (!razorLine) razorLine = h('div.razor-line');
  if (razorLine.parentNode !== clipEl) clipEl.append(razorLine);
  razorLine.style.left = `${e.clientX - clipEl.getBoundingClientRect().left}px`;
});
rowsEl.addEventListener('pointerleave', () => { razorLine?.remove(); razorLine = null; });

// ---------- drop from bin / desktop / effects ----------
rowsEl.addEventListener('dragover', (e) => {
  const types = [...e.dataTransfer.types];
  if (types.includes('text/kadr-fx')) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const el = e.target.closest('.clip');
    for (const x of rowsEl.querySelectorAll('.clip.fxdrop')) if (x !== el) x.classList.remove('fxdrop');
    el?.classList.add('fxdrop');
    return;
  }
  if (!types.includes('text/kadr-src') && !types.includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  for (const r of rowEls) r.row.classList.toggle('drop', r.row.contains(e.target));
});
rowsEl.addEventListener('dragleave', (e) => {
  if (!rowsEl.contains(e.relatedTarget)) {
    for (const r of rowEls) r.row.classList.remove('drop');
    for (const x of rowsEl.querySelectorAll('.clip.fxdrop')) x.classList.remove('fxdrop');
  }
});
rowsEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  for (const r of rowEls) r.row.classList.remove('drop');
  for (const x of rowsEl.querySelectorAll('.clip.fxdrop')) x.classList.remove('fxdrop');
  const fx = e.dataTransfer.getData('text/kadr-fx');
  if (fx) {
    const el = e.target.closest('.clip');
    if (!el) return toast('Drop the effect onto a clip');
    if (e.target.closest('.tl-row.locked')) return toast('That track is locked');
    return dropEffect(fx, el.dataset.id);
  }
  const track = e.target.closest('.tl-row')?.dataset.track;
  let t = Math.max(0, timeAt(e.clientX));
  if (S.snap) t += snapTo([t], snapPoints(new Set())).d;
  const src = e.dataTransfer.getData('text/kadr-src');
  if (src) return addClip(src, t, { track });
  const files = [...e.dataTransfer.files];
  for (const f of files) {
    try {
      emit('upload', { name: f.name, progress: 0 });
      const r = await upload(f, (pr) => emit('upload', { name: f.name, progress: pr }));
      emit('upload', { name: f.name, done: true });
      await new Promise((res) => { const off = () => res(); emit('media-refresh', off); });
      const id = addClip(r.path, t, { track });
      const c = id && clipById(id);
      if (c) t = clipEnd(c);
    } catch (err) {
      emit('upload', { name: f.name, done: true });
      emit('toast', { text: `Import failed: ${err.message}`, err: true });
    }
  }
});

// ---------- tools ----------
export const TOOLS = [
  { id: 'select', key: 'V', name: 'Selection', tip: 'Select, move and trim clips', icon: '<path d="M4 2.5v10l3-2.5 2 4 1.6-.8-2-3.9H12z"/>' },
  { id: 'track', key: 'A', name: 'Track select forward', tip: 'Select everything from the click onward (Shift: one track)', icon: '<path d="M3 3.5v9M6 6h7M10 3.5 13 6l-3 2.5M6 11h5"/>' },
  { id: 'ripple', key: 'B', name: 'Ripple edit', tip: 'Trim an edge and move the rest of the track with it', icon: '<path d="M5 3v10M5 8h8M10 5.5 13 8l-3 2.5"/><path d="M2 5v6" opacity=".6"/>' },
  { id: 'roll', key: 'E', name: 'Rolling edit', tip: 'Move the cut between two clips', icon: '<path d="M8 2.5v11M3 5.5 1.5 8 3 10.5M13 5.5 14.5 8 13 10.5M1.5 8h4M10.5 8h4"/>' },
  { id: 'rate', key: 'R', name: 'Rate stretch', tip: 'Drag an edge to speed the clip up or slow it down', icon: '<path d="M2 8h12M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5"/><path d="M6 3.5v9M10 3.5v9" opacity=".6"/>' },
  { id: 'razor', key: 'C', name: 'Razor', tip: 'Click a clip to cut it', icon: '<circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M5.8 10 12 2.5M10.2 10 4 2.5"/>' },
  { id: 'slip', key: 'Y', name: 'Slip', tip: 'Drag a clip to change which part of its footage shows', icon: '<rect x="4" y="4.5" width="8" height="7" rx="1"/><path d="M1.5 8h2M12.5 8h2M2.5 6.5 1 8l1.5 1.5M13.5 6.5 15 8l-1.5 1.5"/>' },
  { id: 'slide', key: 'U', name: 'Slide', tip: 'Drag a clip between its neighbours', icon: '<rect x="5" y="4.5" width="6" height="7" rx="1"/><path d="M1.5 4.5v7M14.5 4.5v7M2.5 8h1.5M12 8h1.5"/>' },
  { id: 'hand', key: 'H', name: 'Hand', tip: 'Drag to scroll the timeline', icon: '<path d="M5.5 8V3.8a1 1 0 0 1 2 0V7.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7.2V4a1 1 0 0 1 2 0v5.5c0 2.5-1.6 4-4 4-1.6 0-2.6-.8-3.5-2.2L2.3 8.8a1 1 0 0 1 1.6-1.2L5.5 9.5"/>' },
];

export function setTool(tool) {
  if (!TOOLS.some((t) => t.id === tool)) tool = 'select';
  S.tool = tool;
  document.body.classList.remove(...TOOLS.map((t) => `tool-${t.id}`), 'razor');
  document.body.classList.add(`tool-${tool}`);
  if (tool === 'razor') document.body.classList.add('razor');
  for (const b of document.querySelectorAll('#tools [data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
}
$('#tools').replaceChildren(...TOOLS.map((t) => h('button.btn.ghost.icon.toggle', {
  'data-tool': t.id, title: `${t.name}  ${t.key}\n${t.tip}`, on: { click: () => setTool(t.id) },
}, svg(t.icon))));
setTool('select');

export function toggleSnap() {
  S.snap = !S.snap;
  $('#snapBtn').classList.toggle('on', S.snap);
}
$('#snapBtn').onclick = toggleSnap;
export function toggleLinked() {
  S.linked = !S.linked;
  $('#linkBtn').classList.toggle('on', S.linked);
  toast(S.linked ? 'Linked selection on: linked clips are picked together' : 'Linked selection off');
}
$('#linkBtn').onclick = toggleLinked;
$('#sizeBtn').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { label: 'Track height', disabled: true },
    ...[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, n]) => ({ label: n, sub: true, checked: size === k, on: () => setTrackSize(k) })),
  ], { cls: 'mb-menu' });
};

on('project', render);
on('select', render);
on('inout', render);
on('time', drawPlayhead);
on('media', () => { for (const el of clipEls.values()) el.firstChild.dataset.key = ''; drawViewport(); });
window.addEventListener('kadr-theme', () => { drawRuler(); for (const el of clipEls.values()) el.firstChild.dataset.key = ''; drawViewport(); });

// ---------- context menus ----------
function trackMenu(e, t) {
  openMenu(e.clientX, e.clientY, [
    { label: t.locked ? 'Unlock track' : 'Lock track', on: () => commit(() => { trackById(t.id).locked = !t.locked; }) },
    t.kind === 'video' ? { label: t.hidden ? 'Show track' : 'Hide track', on: () => commit(() => { trackById(t.id).hidden = !t.hidden; }) } : null,
    { label: t.muted ? 'Unmute track' : 'Mute track', on: () => commit(() => { trackById(t.id).muted = !t.muted; }) },
    { label: t.solo ? 'Stop soloing' : 'Solo track', on: () => commit(() => { trackById(t.id).solo = !t.solo; }) },
    { label: 'Select all clips on track', on: () => select(S.project.clips.filter((c) => c.track === t.id).map((c) => c.id), { alone: true }) },
    { label: 'Close all gaps', disabled: t.locked, on: () => closeAllGaps(t.id) },
    '-',
    { label: 'Delete track', danger: true, on: () => removeTrack(t.id) },
  ]);
}

rowsEl.addEventListener('contextmenu', (e) => {
  const lane = e.target.closest('.tl-lane');
  if (!lane) return;
  e.preventDefault();
  const track = trackById(lane.dataset.track);
  const t = Math.max(0, timeAt(e.clientX));
  const clipEl = e.target.closest('.clip');
  const c = clipEl && clipById(clipEl.dataset.id);
  if (!c) {
    const gap = gapAt(track.id, t);
    openMenu(e.clientX, e.clientY, [
      { label: 'Paste here', kbd: 'Ctrl V', on: () => paste(snapFrame(t)) },
      gap ? { label: `Close gap (${(gap.e - gap.s).toFixed(2)}s)`, disabled: track.locked, on: () => closeGap(track.id, t) } : null,
      { label: 'Close all gaps on this track', disabled: track.locked, on: () => closeAllGaps(track.id) },
      track.kind === 'video' ? { label: 'Add text here', disabled: track.locked, on: () => addClip('@kadr/text.html', snapFrame(t), { track: track.id, props: { text: 'Title' } }) } : null,
    ]);
    return;
  }
  if (track.locked) return toast(`Track ${track.id} is locked`);
  if (!S.sel.has(c.id)) select([c.id]);
  const multi = S.sel.size > 1;
  const sp = c.speed || 1;
  const under = S.t > c.start && S.t < clipEnd(c);
  const speeds = [[0.25, '25%'], [0.5, '50%'], [1, '100%'], [2, '200%'], [4, '400%']];
  const selIds = [...S.sel];
  const linkedSel = selIds.map(clipById).some((x) => x?.link);
  openMenu(e.clientX, e.clientY, [
    { label: 'Cut', kbd: 'Ctrl X', on: () => copySelected(true) },
    { label: 'Copy', kbd: 'Ctrl C', on: () => copySelected() },
    { label: 'Paste at playhead', kbd: 'Ctrl V', on: () => paste() },
    { label: 'Duplicate', kbd: 'Ctrl D', on: duplicateSelected },
    '-',
    { label: 'Split at playhead', kbd: 'S', disabled: !under, on: splitAtPlayhead },
    !multi && c.type !== 'image' ? { label: `Speed · now ${Math.round(sp * 100)}%`, disabled: true } : null,
    ...(!multi && c.type !== 'image' ? speeds.filter(([v]) => Math.abs(v - sp) > 1e-6).map(([v, l]) => ({ label: `${l}${v < 1 ? '  slow motion' : v > 1 ? '  fast' : '  normal'}`, sub: true, on: () => commit(() => setSpeed(c, v)) })) : []),
    !multi && c.type === 'video' ? { label: 'Freeze frame at playhead', disabled: !under, on: () => freezeFrame(c) } : null,
    !multi && (c.type === 'video' || c.type === 'audio') ? { label: 'Reverse', on: () => reverseClip(c) } : null,
    !multi && c.type === 'video' && S.media.get(c.src)?.hasAudio && c.volume > 0 ? { label: 'Detach audio', on: () => detachAudio(c) } : null,
    !multi && prevAdjacent(c) ? { label: 'Transition…', on: () => openTransitionPopup(c, e.clientX, e.clientY) } : null,
    '-',
    !multi && c.type === 'video' ? { label: 'Scene edit detection (cut at shot changes)', on: () => detectScenes(c) } : null,
    !multi && (c.type === 'video' || c.type === 'audio') ? { label: 'Remove silent parts (jump cuts)', on: () => removeSilences(c) } : null,
    !multi && c.type === 'video' ? { label: 'Stabilize (warp)', on: () => stabilizeClip(c) } : null,
    '-',
    multi ? { label: 'Link clips', kbd: 'Ctrl G', on: () => linkClips(selIds) } : null,
    linkedSel ? { label: 'Unlink', kbd: 'Ctrl Shift G', on: () => unlinkClips(selIds) } : null,
    { label: 'Label color', disabled: true },
    { swatches: LABEL_COLORS.map((col) => ({ color: LABEL_HEX[col], title: col, on: () => commit(() => { for (const id of S.sel) { const x = clipById(id); if (x) x.labelColor = col; } }) })).concat([{ color: null, title: 'none', on: () => commit(() => { for (const id of S.sel) { const x = clipById(id); if (x) delete x.labelColor; } }) }]) },
    { label: c.disabled ? 'Enable' : 'Disable', kbd: 'Shift E', on: () => commit(() => { const v = !c.disabled; for (const id of S.sel) clipById(id).disabled = v; }) },
    !c.src.startsWith('@kadr/') && !multi ? { label: 'Show file', on: () => api('/api/reveal', { path: c.src, select: true }) } : null,
    '-',
    { label: 'Ripple delete', kbd: 'Shift Del', danger: true, on: () => deleteSelected({ ripple: true }) },
    { label: 'Delete', kbd: 'Del', danger: true, on: () => deleteSelected() },
  ]);
});
