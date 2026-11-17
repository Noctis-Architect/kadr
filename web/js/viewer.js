// Preview: stacks real <video>/<img>/<iframe> elements on a canvas-sized stage
// and keeps them in sync with the playhead. Compositions are seeked through
// their kadr runtime, so the preview shows exactly what the export renders.
import { placement, fadeAt, clamp, tc, sourceTime, cssFilter, cssCrop, transitions, clipWindow, resolveAt, transitionOffset } from '/shared/model.js';
import { S, on, emit, live, commit, select, toggle, seek, fps, duration, snapFrame, toast } from './state.js';
import { $, h, mediaUrl, compUrl, drag, api } from './util.js';
import { clipById, trackById, getProp, setProp } from './ops.js';

const wrap = $('#stageWrap');
const stage = $('#stage');
const overlay = $('#stageOverlay');
const layers = new Map();
let view = { s: 1, ox: 0, oy: 0 };

function fit() {
  if (!S.project) return;
  const { width: W, height: H } = S.project;
  const r = wrap.getBoundingClientRect();
  const pad = 20;
  const s = Math.max(0.05, Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H));
  view = { s, ox: Math.round((r.width - W * s) / 2), oy: Math.round((r.height - H * s) / 2) };
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  stage.style.transform = `translate(${view.ox}px, ${view.oy}px) scale(${s})`;
  stage.style.setProperty('--inv', (1 / s).toFixed(3));
  drawSelection();
}
new ResizeObserver(fit).observe(wrap);

function layerKey(c) {
  return `${c.type}|${c.type === 'html' ? compUrl(c.src, c.props) : mediaUrl(c.src)}`;
}

class Layer {
  constructor(c) {
    this.id = c.id;
    this.type = c.type;
    this.key = layerKey(c);
    this.lastT = null;
    this.pending = null;
    this.mw = 0;
    this.mh = 0;
    const info = S.media.get(c.src);
    if (info?.width) { this.mw = info.width; this.mh = info.height; }
    if (c.type === 'video' || c.type === 'audio') {
      const el = document.createElement(c.type);
      el.className = 'layer';
      el.preload = 'auto';
      el.playsInline = true;
      el.src = mediaUrl(c.src);
      el.addEventListener('seeked', () => {
        if (this.pending != null && Math.abs(el.currentTime - this.pending) > 0.02) el.currentTime = this.pending;
        else this.pending = null;
      });
      el.addEventListener('loadedmetadata', () => {
        if (!this.mw && el.videoWidth) { this.mw = el.videoWidth; this.mh = el.videoHeight; }
        sync();
      });
      this.el = el;
    } else if (c.type === 'image') {
      const el = new Image();
      el.className = 'layer';
      el.decoding = 'async';
      el.onload = () => { if (!this.mw) { this.mw = el.naturalWidth; this.mh = el.naturalHeight; } sync(); };
      el.src = mediaUrl(c.src);
      this.el = el;
    } else {
      this.el = this.makeFrame(c);
    }
    this.el.style.visibility = 'hidden';
    stage.append(this.el);
  }

  makeFrame(c) {
    const el = document.createElement('iframe');
    el.className = 'layer';
    el.setAttribute('scrolling', 'no');
    el.setAttribute('tabindex', '-1');
    el.width = S.project.width;
    el.height = S.project.height;
    el.style.width = `${S.project.width}px`;
    el.style.height = `${S.project.height}px`;
    el.src = compUrl(c.src, c.props);
    el.addEventListener('load', () => {
      const k = el.contentWindow?.kadr;
      if (!k) {
        S.compErrors.set(c.src, 'kadr runtime did not load');
        return;
      }
      k.ready.then(() => { this.lastT = null; sync(); });
    });
    return el;
  }

  /** Reload a composition without a blank frame: swap when the new one is ready. */
  reload() {
    if (this.type !== 'html') {
      if (this.el.tagName === 'IMG') { this.el.src = `${mediaUrl(clipById(this.id)?.src || '')}?v=${Date.now()}`; }
      return;
    }
    const c = clipById(this.id);
    if (!c) return;
    const old = this.el;
    const fresh = this.makeFrame(c);
    fresh.style.cssText = old.style.cssText;
    fresh.style.visibility = 'hidden';
    fresh.addEventListener('load', () => {
      fresh.contentWindow?.kadr?.ready.then(() => {
        old.remove();
        this.el = fresh;
        this.lastT = null;
        sync();
      });
    }, { once: true });
    stage.append(fresh);
  }

  seekMedia(x) {
    this.pending = x;
    if (!this.el.seeking) this.el.currentTime = x;
  }

  update(c, track, t, z, tr) {
    const el = this.el;
    const w = clipWindow(c, tr);
    const active = t >= w.s && t < w.e;
    let rc = resolveAt(c, t);
    const mdur = S.media.get(c.src)?.duration || Infinity;
    const raw = sourceTime(c, t);
    const local = clamp(raw, 0, Number.isFinite(mdur) ? mdur - 0.02 : Infinity);
    const visible = active && c.type !== 'audio' && !track.hidden;
    el.style.visibility = visible ? 'visible' : 'hidden';

    if (visible) {
      const { width: W, height: H } = S.project;
      const a = rc.opacity * fadeAt(c, t, tr);
      const off = transitionOffset(c, t, tr, W, H);
      if (off.dx || off.dy) rc = { ...rc, x: (rc.x || 0) + off.dx, y: (rc.y || 0) + off.dy };
      el.style.opacity = a.toFixed(3);
      el.style.zIndex = z;
      const f = cssFilter(c);
      if (el.style.filter !== f) el.style.filter = f;
      const crop = cssCrop(c);
      if (el.style.clipPath !== crop) el.style.clipPath = crop;
      const fx = c.flipH ? -1 : 1;
      const fy = c.flipV ? -1 : 1;
      const r = rc.rotation || 0;
      if (c.type === 'html') {
        const pl = placement(rc, W, H, W, H);
        el.style.transform = `translate(${pl.x + pl.w / 2}px, ${pl.y + pl.h / 2}px) rotate(${r}deg) scale(${(fx * pl.w) / W}, ${(fy * pl.h) / H}) translate(${-W / 2}px, ${-H / 2}px)`;
      } else {
        const pl = placement(rc, this.mw || W, this.mh || H, W, H);
        el.style.transform = r || fx < 0 || fy < 0
          ? `translate(${pl.x + pl.w / 2}px, ${pl.y + pl.h / 2}px) rotate(${r}deg) scale(${fx}, ${fy}) translate(${-pl.w / 2}px, ${-pl.h / 2}px)`
          : `translate(${pl.x}px, ${pl.y}px)`;
        el.style.width = `${pl.w}px`;
        el.style.height = `${pl.h}px`;
      }
    }

    if (c.type === 'video' || c.type === 'audio') {
      el.muted = !!track.muted;
      const rate = c.speed || 1;
      if (el.playbackRate !== rate) el.playbackRate = rate;
      el.volume = clamp(rc.volume * fadeAt(c, t, tr, true), 0, 1);
      const inMedia = raw >= 0 && raw < mdur - 0.03;
      if (active && S.playing && inMedia) {
        if (el.paused) {
          this.seekMedia(local);
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - local) > 0.3 * rate) {
          this.seekMedia(local + 0.05);
        }
      } else {
        if (!el.paused) el.pause();
        const want = active ? local : t < w.s ? Math.max(0, c.in) : local;
        if (Math.abs((this.pending ?? el.currentTime) - want) > 0.45 / fps()) this.seekMedia(want);
      }
    } else if (c.type === 'html') {
      const k = el.contentWindow?.kadr;
      const want = Math.max(0, active ? raw : t < w.s ? c.in : raw);
      if (k && this.lastT !== want) {
        this.lastT = want;
        try { k.seek(want); } catch (e) { S.compErrors.set(c.src, e.message); }
      }
    }
  }

  destroy() {
    if (this.el.tagName === 'VIDEO' || this.el.tagName === 'AUDIO') {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    }
    this.el.remove();
  }
}

export function sync() {
  const p = S.project;
  if (!p) return;
  const t = S.t;
  $('#stageEmpty').hidden = p.clips.length > 0;
  stage.style.background = p.background;
  const tracks = new Map(p.tracks.map((tr, i) => [tr.id, { tr, i }]));
  const order = [...p.clips].sort((a, b) => a.start - b.start);
  const trs = transitions(p);
  const keep = new Set();
  order.forEach((c, n) => {
    const T = tracks.get(c.track);
    if (!T || c.disabled) return;
    const tr = trs.get(c.id);
    const w = clipWindow(c, tr);
    const dist = t < w.s ? w.s - t : t >= w.e ? t - w.e : 0;
    let L = layers.get(c.id);
    const wantNew = dist === 0 || (t < w.s && dist < 2.5);
    if (!L && !wantNew) return;
    if (L && dist > 8) return;
    if (L && L.key !== layerKey(c)) { L.destroy(); L = null; }
    if (!L) { L = new Layer(c); layers.set(c.id, L); }
    keep.add(c.id);
    L.update(c, T.tr, t, T.i * 1000 + n + 1, tr);
  });
  for (const [id, L] of layers) if (!keep.has(id)) { L.destroy(); layers.delete(id); }
  if (!S.playing) drawSelection();
}

export function reloadAsset(path) {
  const p = S.project;
  if (!p) return;
  const sharedAsset = /\.(css|js|mjs|json|svg|woff2?|ttf|otf)$/i.test(path) || (path.startsWith('comps/') && !path.endsWith('.html'));
  for (const [id, L] of layers) {
    const c = clipById(id);
    if (!c) continue;
    if (c.src === path || (c.type === 'html' && sharedAsset)) L.reload();
  }
}

export function resetLayers() {
  for (const L of layers.values()) L.destroy();
  layers.clear();
  fit();
  sync();
}

// ---------- direct manipulation on the stage ----------
function activeVisualAt(cx, cy) {
  const p = S.project;
  const tracks = new Map(p.tracks.map((tr, i) => [tr.id, { tr, i }]));
  const hits = p.clips
    .filter((c) => c.type !== 'audio' && !c.disabled && S.t >= c.start && S.t < c.start + c.duration && tracks.get(c.track) && !tracks.get(c.track).tr.hidden && !tracks.get(c.track).tr.locked)
    .map((c) => ({ c, z: tracks.get(c.track).i * 1000 + c.start, pl: rectOf(c) }))
    .filter((x) => x.pl && cx >= x.pl.x && cx <= x.pl.x + x.pl.w && cy >= x.pl.y && cy <= x.pl.y + x.pl.h)
    .sort((a, b) => b.z - a.z);
  return hits[0]?.c || null;
}

function rectOf(c) {
  const { width: W, height: H } = S.project;
  const rc = resolveAt(c, S.t);
  if (c.type === 'html') return placement(rc, W, H, W, H);
  const L = layers.get(c.id);
  const info = S.media.get(c.src);
  const mw = L?.mw || info?.width || W;
  const mh = L?.mh || info?.height || H;
  return placement(rc, mw, mh, W, H);
}

function drawSelection(guides = []) {
  overlay.replaceChildren();
  if (!S.project || S.sel.size !== 1) return;
  const c = clipById([...S.sel][0]);
  if (!c || c.type === 'audio' || S.t < c.start || S.t >= c.start + c.duration) return;
  const r = rectOf(c);
  const { s, ox, oy } = view;
  const rot = getProp(c, 'rotation') || 0;
  const box = h('div.selbox', { style: { left: `${ox + r.x * s}px`, top: `${oy + r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px`, transform: rot ? `rotate(${rot}deg)` : '' } },
    ...['tl', 'tr', 'bl', 'br'].map((k) => h(`div.hd.${k}`, { 'data-h': k })),
    h('div.hd.rot', { 'data-h': 'rot', title: 'Drag to rotate · Shift snaps to 15°' }));
  overlay.append(box);
  for (const g of guides) {
    overlay.append(h('div.guide', { style: g === 'v'
      ? { left: `${ox + (S.project.width / 2) * s}px`, top: `${oy}px`, width: '1px', height: `${S.project.height * s}px` }
      : { left: `${ox}px`, top: `${oy + (S.project.height / 2) * s}px`, height: '1px', width: `${S.project.width * s}px` } }));
  }
}

wrap.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !S.project) return;
  const rect = wrap.getBoundingClientRect();
  const cx = (e.clientX - rect.left - view.ox) / view.s;
  const cy = (e.clientY - rect.top - view.oy) / view.s;
  const handle = e.target.dataset?.h;
  let c = handle ? clipById([...S.sel][0]) : activeVisualAt(cx, cy);
  if (c && trackById(c.track)?.locked) c = null;
  if (!c) { if (S.sel.size) select([]); drawSelection(); return; }
  if (!S.sel.has(c.id) || S.sel.size !== 1) select([c.id]);
  e.preventDefault();
  const o = { x: getProp(c, 'x'), y: getProp(c, 'y'), scale: getProp(c, 'scale'), rotation: getProp(c, 'rotation') || 0 };
  const r0 = rectOf(c);
  const ctr = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
  const d0 = Math.hypot(cx - ctr.x, cy - ctr.y) || 1;
  const a0 = Math.atan2(cy - ctr.y, cx - ctr.x);
  drag(e, (dx, dy, ev) => {
    const guides = [];
    const px = (ev.clientX - rect.left - view.ox) / view.s;
    const py = (ev.clientY - rect.top - view.oy) / view.s;
    live(() => {
      if (handle === 'rot') {
        let deg = o.rotation + ((Math.atan2(py - ctr.y, px - ctr.x) - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        setProp(c, 'rotation', Math.round(deg * 10) / 10);
      } else if (handle) {
        setProp(c, 'scale', Math.max(0.01, Math.round(o.scale * (Math.hypot(px - ctr.x, py - ctr.y) / d0) * 1000) / 1000));
      } else {
        let nx = o.x + dx / view.s;
        let ny = o.y + dy / view.s;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) ny = o.y; else nx = o.x; }
        const tol = 8 / view.s;
        if (Math.abs(nx) < tol) { nx = 0; guides.push('v'); }
        if (Math.abs(ny) < tol) { ny = 0; guides.push('h'); }
        setProp(c, 'x', Math.round(nx));
        setProp(c, 'y', Math.round(ny));
      }
    });
    drawSelection(guides);
  }, (_ev, moved) => {
    if (moved) commit();
    drawSelection();
  });
});

// ---------- safe-area / thirds guides ----------
const guidesEl = h('div.safe', { hidden: true }, h('div.act'), h('div.ttl'), h('div.thirds'), h('div.cross'));
stage.append(guidesEl);
let showGuides = false;
try { showGuides = localStorage.getItem('kadr.guides') === '1'; } catch { /* private */ }
function applyGuides() {
  guidesEl.hidden = !showGuides;
  $('#tGuides')?.classList.toggle('on', showGuides);
}
export function toggleGuides() {
  showGuides = !showGuides;
  try { localStorage.setItem('kadr.guides', showGuides ? '1' : '0'); } catch { /* private */ }
  applyGuides();
}
applyGuides();
if ($('#tGuides')) $('#tGuides').onclick = toggleGuides;

wrap.addEventListener('dblclick', () => toggle());

// ---------- transport ----------
const tcNow = $('#tcNow');
const tcDur = $('#tcDur');
function drawTc() {
  if (!S.project) return;
  tcNow.textContent = tc(S.t, S.project.fps);
  tcDur.textContent = tc(duration(), S.project.fps);
}
$('#tPlay').onclick = () => toggle();
$('#tPrev').onclick = () => seek(snapFrame(S.t) - 1 / fps());
$('#tNext').onclick = () => seek(snapFrame(S.t) + 1 / fps());
$('#tStart').onclick = () => seek(0);
$('#tEnd').onclick = () => seek(duration());
$('#tLoop').onclick = () => { S.loop = !S.loop; $('#tLoop').classList.toggle('on', S.loop); };
$('#tSnapshot').onclick = async () => {
  toast('Rendering frame…');
  try {
    const r = await api('/api/frame', { t: snapFrame(S.t) });
    toast(`Saved ${r.path}`);
  } catch (e) { toast(e.message, true); }
};

on('time', () => { sync(); drawTc(); });
on('project', (o) => { if (!o?.live) fit(); sync(); drawTc(); });
on('select', () => drawSelection());
on('media', () => sync());
on('play', () => sync());
emit('viewer-ready');
