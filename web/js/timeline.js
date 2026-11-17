import { clipEnd, clamp, stripSpec, tc, transitions, shiftKeys } from '/shared/model.js';
import { S, on, emit, live, commit, select, selectMarker, seek, snapFrame, fps, duration, toast } from './state.js';
import { $, h, svg, ICON, clipName, drag, upload, api } from './util.js';
import {
  clipById, trackById, splitClip, clearRange, mediaDuration, addClip, removeTrack, renameTrack, isLocked, keyTimes,
  copySelected, paste, duplicateSelected, splitAtPlayhead, deleteSelected, detachAudio, setSpeed, freezeFrame, reverseClip,
  prevAdjacent, addDissolve, gapAt, closeGap,
} from './ops.js';
import { openMenu } from './menu.js';

const HEAD = 132;
const RULER = 26;
const TRACK_H = { video: 56, audio: 46 };
const scroll = $('#tlScroll');
const inner = $('#tlInner');
const rowsEl = $('#tlRows');
const ruler = $('#tlRuler');
const playhead = $('#tlPlayhead');
const snapLine = $('#tlSnap');
const marksEl = $('#tlMarks');
const rangeEl = $('#tlRange');

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

// ---------- render ----------
const clipEls = new Map();
let booted = false;
setTimeout(() => { booted = true; }, 1500);
let rowEls = [];

export function render() {
  const p = S.project;
  if (!p) return;
  const D = duration();
  const contentW = Math.max((D + 30) * S.pps, scroll.clientWidth - HEAD);
  inner.style.width = `${HEAD + contentW}px`;

  const tracks = displayTracks();
  const sig = tracks.map((t) => `${t.id}:${t.kind}:${t.hidden ? 1 : 0}:${t.muted ? 1 : 0}:${t.locked ? 1 : 0}:${t.name || ''}`).join('|');
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
      btns.push(h('button.btn.ghost.icon', { title: t.locked ? 'Unlock track' : 'Lock track (no edits)', class: `btn ghost icon${t.locked ? ' locked' : ''}`, on: { click: () => {
        commit(() => { trackById(t.id).locked = !t.locked; });
        if (!t.locked) select([...S.sel].filter((id) => clipById(id)?.track !== t.id));
      } } }, svg(t.locked ? ICON.lock : ICON.unlock)));
      const nm = h('div.nm', { title: `${t.id}${t.name ? ` · ${t.name}` : ''}\nDouble-click to rename` }, t.name ? [h('small', {}, t.id), t.name] : t.id);
      nm.addEventListener('dblclick', () => {
        const input = h('input.nm-edit', { value: t.name || '', placeholder: t.id, spellcheck: false, dir: 'auto' });
        const done = (ok) => { if (ok) renameTrack(t.id, input.value.trim()); else render(); };
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.onblur = null; done(false); } });
        input.onblur = () => done(true);
        nm.replaceChildren(input);
        input.focus();
        input.select();
      });
      const stuck = t.hidden || t.muted || t.locked;
      const head = h('div.tl-head', { on: { contextmenu: (e) => { e.preventDefault(); trackMenu(e, t); } } }, nm, h(`div.tl-hb${stuck ? '.stuck' : ''}`, {}, ...btns));
      const row = h(`div.tl-row.k-${t.kind}${t.locked ? '.locked' : ''}`, { 'data-track': t.id, style: { height: `${TRACK_H[t.kind]}px` } }, head, lane);
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
      el = h(`div.clip`, { 'data-id': c.id },
        h('canvas'), h('div.fd.in'), h('div.fd.out'), h('div.lb'), h('div.kfs'), h('div.h.l'), h('div.h.r'));
      lane.append(el);
      if (booted) { el.dataset.fresh = '1'; setTimeout(() => { delete el.dataset.fresh; el.classList.remove('new'); }, 400); }
      clipEls.set(c.id, el);
    }
    el.className = `clip k-${c.type}${el.dataset.fresh ? ' new' : ''}${S.sel.has(c.id) ? ' sel' : ''}${c.disabled ? ' off' : ''}${S.compErrors.has(c.src) ? ' err' : ''}`;
    el.style.left = `${c.start * S.pps}px`;
    el.style.width = `${Math.max(2, c.duration * S.pps)}px`;
    const lb = el.querySelector('.lb');
    const name = clipName(c);
    const sp = (c.speed || 1) !== 1 ? `${Math.round(c.speed * 100)}%` : '';
    if (lb.dataset.v !== name + sp) {
      lb.dataset.v = name + sp;
      lb.replaceChildren(name, ...(sp ? [h('em', {}, sp)] : []));
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
  marksEl.replaceChildren(...p.markers.map((m) => h('div.tl-mark', { style: { left: `${xOf(m.t)}px` } })));
  if (S.inPt != null || S.outPt != null) {
    const a = S.inPt ?? 0;
    const b = S.outPt ?? D;
    rangeEl.style.display = 'block';
    rangeEl.style.left = `${xOf(a)}px`;
    rangeEl.style.width = `${Math.max(0, (b - a) * S.pps)}px`;
    $('#rangeInfo').textContent = `in ${tc(a, p.fps)}  out ${tc(b, p.fps)}`;
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
    if (x > scroll.scrollLeft + vw - 40 || x < scroll.scrollLeft) scroll.scrollLeft = x - 40;
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
  // in/out band
  if (S.inPt != null || S.outPt != null) {
    const a = (S.inPt ?? 0) * S.pps - sl;
    const b = (S.outPt ?? duration()) * S.pps - sl;
    g.fillStyle = 'rgba(232,255,89,0.14)';
    g.fillRect(a, 0, b - a, RULER);
  }
  g.strokeStyle = '#3a3a40';
  g.fillStyle = '#7d7d86';
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
    g.fillStyle = S.marker === m.id ? '#ffd29a' : '#ffa64d';
    g.beginPath();
    g.moveTo(x - 5, 14); g.lineTo(x + 5, 14); g.lineTo(x + 5, 20); g.lineTo(x, 25); g.lineTo(x - 5, 20);
    g.fill();
  }
  const px = Math.round(S.t * S.pps - sl) + 0.5;
  if (px > -8 && px < w + 8) {
    g.fillStyle = '#e8ff59';
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
    if (c.type === 'video' || c.type === 'image') {
      const st = c.type === 'video' ? getStrip(c.src) : getImage(c.src);
      if (st.ok) {
        const img = st.img;
        const tw = img.naturalWidth / st.count;
        const th = img.naturalHeight;
        const hh = H - (c.type === 'video' && info?.hasAudio ? 14 : 0);
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
        const top = c.type === 'audio' ? 16 : H - 14;
        const hh = H - top - 2;
        const mid = top + hh / 2;
        g.fillStyle = c.type === 'audio' ? 'rgba(159,224,193,.75)' : 'rgba(255,255,255,.45)';
        if (c.type === 'video') { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, top - 1, W, hh + 3); g.fillStyle = 'rgba(159,224,193,.7)'; }
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

function trackAtY(clientY) {
  for (const r of rowEls) {
    const b = r.row.getBoundingClientRect();
    if (clientY >= b.top && clientY < b.bottom) return r.t;
  }
  return null;
}

rowsEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.target.dataset?.t && e.target.closest('.kfs')) { e.preventDefault(); seek(Number(e.target.dataset.t)); return; }
  if (e.target.classList.contains('xf')) { e.preventDefault(); select([e.target.dataset.id]); return; }
  const clipEl = e.target.closest('.clip');
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
    commit((p) => splitClip(p, p.clips.find((x) => x.id === c.id), S.snap && Math.abs(t - S.t) < 8 / S.pps ? S.t : t));
    return;
  }
  const edge = e.target.classList.contains('h') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (additive && !edge) {
    if (S.sel.has(c.id)) { S.sel.delete(c.id); select([...S.sel]); return; }
    select([c.id], { add: true });
  } else if (!S.sel.has(c.id) || edge) select([c.id]);
  if (e.altKey && !edge) return dragDuplicate(e, c);
  if (edge) trimDrag(e, c, edge);
  else moveDrag(e, c);
});

function moveDrag(e, lead) {
  const moving = [...S.sel].map(clipById).filter(Boolean);
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
  }, (ev, moved) => {
    showSnap(null);
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
    p.clips.push(copy);
  });
  select([copy.id]);
  moveDrag(e, clipById(copy.id));
}

function trimDrag(e, c, edge) {
  const o = { start: c.start, duration: c.duration, in: c.in };
  const sp = c.speed || 1;
  const end = o.start + o.duration;
  const f = 1 / fps();
  const others = S.project.clips.filter((x) => x.track === c.track && x.id !== c.id);
  const prevEnd = Math.max(0, ...others.filter((x) => clipEnd(x) <= o.start + 1e-4).map(clipEnd));
  const nextStart = Math.min(Infinity, ...others.filter((x) => x.start >= end - 1e-4).map((x) => x.start));
  const pts = snapPoints(new Set([c.id]));
  const mdur = mediaDuration(c);
  const usesIn = c.type !== 'image';
  drag(e, (dx) => {
    const dt = dx / S.pps;
    if (edge === 'l') {
      let ns = o.start + dt;
      const sn = snapTo([ns], pts);
      ns = snapFrame(ns + sn.d);
      const lo = Math.max(prevEnd, usesIn ? o.start - o.in / sp : 0, 0);
      ns = clamp(ns, lo, end - f);
      live(() => {
        shiftKeys(c, -(ns - c.start));
        c.start = ns;
        if (usesIn) c.in = Math.max(0, o.in + (ns - o.start) * sp);
        c.duration = end - ns;
      });
      showSnap(sn.at);
    } else {
      let ne = end + dt;
      const sn = snapTo([ne], pts);
      ne = snapFrame(ne + sn.d);
      const hi = Math.min(nextStart, Number.isFinite(mdur) ? o.start + (mdur - o.in) / sp : Infinity);
      ne = clamp(ne, o.start + f, hi);
      live(() => { c.duration = ne - o.start; });
      showSnap(sn.at);
    }
  }, (_ev, moved) => {
    showSnap(null);
    if (moved) commit((p) => {
      const x = p.clips.find((k) => k.id === c.id);
      x.fadeIn = Math.min(x.fadeIn, x.duration);
      x.fadeOut = Math.min(x.fadeOut, x.duration);
    });
  });
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

// ---------- drop from bin / desktop ----------
rowsEl.addEventListener('dragover', (e) => {
  const types = [...e.dataTransfer.types];
  if (!types.includes('text/kadr-src') && !types.includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'copy';
  for (const r of rowEls) r.row.classList.toggle('drop', r.row.contains(e.target));
});
rowsEl.addEventListener('dragleave', (e) => {
  if (!rowsEl.contains(e.relatedTarget)) for (const r of rowEls) r.row.classList.remove('drop');
});
rowsEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  for (const r of rowEls) r.row.classList.remove('drop');
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

// ---------- tool buttons ----------
export function setTool(tool) {
  S.tool = tool;
  document.body.classList.toggle('razor', tool === 'razor');
  $('#toolSelect').classList.toggle('on', tool === 'select');
  $('#toolRazor').classList.toggle('on', tool === 'razor');
}
$('#toolSelect').onclick = () => setTool('select');
$('#toolRazor').onclick = () => setTool('razor');
export function toggleSnap() {
  S.snap = !S.snap;
  $('#snapBtn').classList.toggle('on', S.snap);
}
$('#snapBtn').onclick = toggleSnap;

on('project', render);
on('select', render);
on('time', drawPlayhead);
on('media', () => { for (const el of clipEls.values()) el.firstChild.dataset.key = ''; drawViewport(); });

// ---------- context menus ----------
function trackMenu(e, t) {
  openMenu(e.clientX, e.clientY, [
    { label: t.locked ? 'Unlock track' : 'Lock track', on: () => commit(() => { trackById(t.id).locked = !t.locked; }) },
    t.kind === 'video' ? { label: t.hidden ? 'Show track' : 'Hide track', on: () => commit(() => { trackById(t.id).hidden = !t.hidden; }) } : null,
    { label: t.muted ? 'Unmute track' : 'Mute track', on: () => commit(() => { trackById(t.id).muted = !t.muted; }) },
    { label: 'Select all clips on track', on: () => select(S.project.clips.filter((c) => c.track === t.id).map((c) => c.id)) },
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
    !multi && prevAdjacent(c) ? { label: c.xfade > 0 ? 'Remove cross dissolve' : 'Cross dissolve from previous', on: () => (c.xfade > 0 ? commit(() => { c.xfade = 0; }) : addDissolve(c)) } : null,
    '-',
    { label: c.disabled ? 'Enable' : 'Disable', kbd: 'Shift E', on: () => commit(() => { const v = !c.disabled; for (const id of S.sel) clipById(id).disabled = v; }) },
    !c.src.startsWith('@kadr/') && !multi ? { label: 'Show file', on: () => api('/api/reveal', { path: c.src, select: true }) } : null,
    '-',
    { label: 'Ripple delete', kbd: 'Shift Del', danger: true, on: () => deleteSelected({ ripple: true }) },
    { label: 'Delete', kbd: 'Del', danger: true, on: () => deleteSelected() },
  ]);
});
