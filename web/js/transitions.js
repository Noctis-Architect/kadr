// Transitions you pick instead of typing: a catalog, how to apply each one to
// a cut, and the picker (tiles with a small moving preview). Three kinds:
//  - xfade: built into the clip (`xfade` seconds + `xfadeType`), drawn by the
//    editor and by ffmpeg: dissolve and pushes.
//  - dip: the previous clip fades out and this one fades in (dip to black).
//  - overlay: a built-in composition that covers the cut on a track above
//    (flash, color wipe, iris, stripes).
import { clipEnd, uid } from '/shared/model.js';
import { S, commit, snapFrame, toast } from './state.js';
import { h } from './util.js';
import { prevAdjacent } from './ops.js';

export const TRANSITIONS = [
  { id: 'cut', name: 'Cut', kind: 'cut' },
  { id: 'dissolve', name: 'Dissolve', kind: 'xfade', type: 'dissolve', d: 0.5 },
  { id: 'dip', name: 'Dip to black', kind: 'dip', d: 0.6 },
  { id: 'flash', name: 'Flash', kind: 'overlay', src: '@kadr/flash.html', d: 0.6 },
  { id: 'pushLeft', name: 'Push left', kind: 'xfade', type: 'pushLeft', d: 0.6 },
  { id: 'pushRight', name: 'Push right', kind: 'xfade', type: 'pushRight', d: 0.6 },
  { id: 'pushUp', name: 'Push up', kind: 'xfade', type: 'pushUp', d: 0.6 },
  { id: 'pushDown', name: 'Push down', kind: 'xfade', type: 'pushDown', d: 0.6 },
  { id: 'wipe', name: 'Color wipe', kind: 'overlay', src: '@kadr/wipe.html', d: 1.2 },
  { id: 'iris', name: 'Iris', kind: 'overlay', src: '@kadr/iris.html', d: 1 },
  { id: 'stripes', name: 'Stripes', kind: 'overlay', src: '@kadr/stripes.html', d: 1 },
];
const OVERLAY_SRC = new Set(TRANSITIONS.filter((t) => t.kind === 'overlay').map((t) => t.src));
const byId = (id) => TRANSITIONS.find((t) => t.id === id);

const near = (a, b) => Math.abs(a - b) < 1.5 / (S.project.fps || 30);
const trackIndex = (id) => S.project.tracks.findIndex((t) => t.id === id);

/** An overlay transition clip sitting on the cut at time `cut`, above track `tid`. */
function overlayAt(cut, tid) {
  const i = trackIndex(tid);
  return S.project.clips.find((x) => OVERLAY_SRC.has(x.src) && trackIndex(x.track) > i && near(x.start + x.duration / 2, cut)) || null;
}

/** What transition the cut into clip c has now: { t, d, overlay? } (t = catalog entry). */
export function currentTransition(c) {
  const prev = prevAdjacent(c);
  const ov = overlayAt(c.start, c.track);
  if (ov) return { t: TRANSITIONS.find((x) => x.src === ov.src), d: ov.duration, overlay: ov };
  if (c.xfade > 0) return { t: byId(c.xfadeType && c.xfadeType !== 'dissolve' ? c.xfadeType : 'dissolve'), d: c.xfade };
  if (prev && c.fadeIn > 0 && prev.fadeOut > 0 && near(c.fadeIn, prev.fadeOut)) return { t: byId('dip'), d: c.fadeIn * 2 };
  return { t: byId('cut'), d: 0 };
}

/** Put transition `id` (with duration d) on the cut into clip c. Replaces what was there. */
export function applyTransition(c, id, d) {
  const prev = prevAdjacent(c);
  const t = byId(id);
  if (!t) return;
  if (!prev && t.kind !== 'cut') { toast('Put this clip right after another one on the same track first'); return; }
  const cur = currentTransition(c);
  const dur = Math.max(1 / S.project.fps, Math.min(d ?? (cur.t.id === id ? cur.d : t.d) ?? 0.5, c.duration, prev ? prev.duration : Infinity));
  // An overlay needs a free video track above for its time span (or a new one).
  let ovTrack = null;
  if (t.kind === 'overlay') {
    const s = snapFrame(c.start - dur / 2);
    const e = s + dur;
    const above = S.project.tracks.slice(trackIndex(c.track) + 1).filter((x) => x.kind === 'video' && !x.locked);
    ovTrack = above.find((x) => !S.project.clips.some((y) => y.track === x.id && y !== cur.overlay && y.start < e - 1e-4 && clipEnd(y) > s + 1e-4))?.id || null;
  }
  const newId = uid('c', new Set(S.project.clips.map((x) => x.id)));
  commit((p) => {
    const me = p.clips.find((x) => x.id === c.id);
    const pv = prev && p.clips.find((x) => x.id === prev.id);
    // undo what is there now
    if (cur.overlay) p.clips = p.clips.filter((x) => x.id !== cur.overlay.id);
    me.xfade = 0;
    delete me.xfadeType;
    if (cur.t.id === 'dip') { me.fadeIn = 0; if (pv) pv.fadeOut = 0; }
    // apply the new one
    if (t.kind === 'xfade') { me.xfade = dur; if (t.type !== 'dissolve') me.xfadeType = t.type; } else if (t.kind === 'dip') {
      me.fadeIn = dur / 2;
      if (pv) pv.fadeOut = dur / 2;
    } else if (t.kind === 'overlay') {
      let tid = ovTrack;
      if (!tid) {
        const n = p.tracks.filter((x) => x.kind === 'video').length + 1;
        let k = n;
        while (p.tracks.some((x) => x.id === `V${k}`)) k++;
        tid = `V${k}`;
        const lastV = p.tracks.map((x) => x.kind).lastIndexOf('video');
        p.tracks.splice(lastV + 1, 0, { id: tid, kind: 'video' });
      }
      p.clips.push({ id: newId, track: tid, type: 'html', src: t.src, start: snapFrame(Math.max(0, me.start - dur / 2)), duration: dur, label: t.name });
    }
  });
}

/** Cut nearest to time t on any unlocked video track: the clip that starts there. */
export function cutNear(t) {
  let best = null;
  for (const c of S.project.clips) {
    if (c.type === 'audio' || c.disabled || OVERLAY_SRC.has(c.src) || !prevAdjacent(c)) continue;
    const dist = Math.abs(c.start - t);
    if (!best || dist < best.dist) best = { c, dist };
  }
  return best?.c || null;
}

// ---------- the picker ----------
const ICONS = {
  cut: '<rect x="4" y="8" width="14" height="20" class="a"/><rect x="18" y="8" width="14" height="20" class="b"/>',
  dissolve: '<rect x="4" y="8" width="28" height="20" class="a"/><rect x="4" y="8" width="28" height="20" class="b anim-fade"/>',
  dip: '<rect x="4" y="8" width="28" height="20" class="a"/><rect x="4" y="8" width="28" height="20" class="k anim-dip"/>',
  flash: '<rect x="4" y="8" width="28" height="20" class="a"/><rect x="4" y="8" width="28" height="20" class="w anim-dip"/>',
  pushLeft: '<g class="anim-pl"><rect x="4" y="8" width="28" height="20" class="a"/><rect x="32" y="8" width="28" height="20" class="b"/></g>',
  pushRight: '<g class="anim-pr"><rect x="4" y="8" width="28" height="20" class="a"/><rect x="-24" y="8" width="28" height="20" class="b"/></g>',
  pushUp: '<g class="anim-pu"><rect x="4" y="8" width="28" height="20" class="a"/><rect x="4" y="28" width="28" height="20" class="b"/></g>',
  pushDown: '<g class="anim-pd"><rect x="4" y="8" width="28" height="20" class="a"/><rect x="4" y="-12" width="28" height="20" class="b"/></g>',
  wipe: '<rect x="4" y="8" width="28" height="20" class="a"/><polygon points="4,8 12,8 6,28 -2,28" class="y anim-wipe"/>',
  iris: '<rect x="4" y="8" width="28" height="20" class="a"/><circle cx="18" cy="18" r="16" class="ring anim-iris"/>',
  stripes: '<rect x="4" y="8" width="28" height="20" class="a"/><g class="anim-st"><rect x="4" y="8" width="7" height="20" class="y"/><rect x="11" y="8" width="7" height="20" class="k"/><rect x="18" y="8" width="7" height="20" class="y"/><rect x="25" y="8" width="7" height="20" class="k"/></g>',
};

/** Tile grid + duration for the cut into clip c. Re-renders itself after each change. */
export function transitionPicker(c, { onChange } = {}) {
  const el = h('div.tp');
  const paint = () => {
    const live = S.project.clips.find((x) => x.id === c.id) || c;
    const cur = currentTransition(live);
    const prev = prevAdjacent(live);
    const tiles = TRANSITIONS.map((t) => h(`button.tp-tile${cur.t.id === t.id ? '.on' : ''}`, {
      title: t.name, disabled: !prev && t.id !== 'cut',
      on: { click: () => { applyTransition(live, t.id); paint(); onChange?.(); } },
    }, h('span.tp-ico', { html: `<svg viewBox="0 0 36 36"><defs><clipPath id="tpc-${t.id}"><rect x="4" y="8" width="28" height="20" rx="3"/></clipPath></defs><g clip-path="url(#tpc-${t.id})">${ICONS[t.id]}</g><rect x="4" y="8" width="28" height="20" rx="3" class="frame"/></svg>` }), h('span', {}, t.name)));
    const kids = [h('div.tp-grid', {}, ...tiles)];
    if (cur.t.id !== 'cut') {
      const sl = h('input', { type: 'range', min: 0.2, max: 2.5, step: 0.05, value: cur.d });
      const val = h('span.tp-val', {}, `${cur.d.toFixed(2)} s`);
      sl.addEventListener('input', () => { val.textContent = `${Number(sl.value).toFixed(2)} s`; });
      sl.addEventListener('change', () => { applyTransition(S.project.clips.find((x) => x.id === c.id) || c, cur.t.id, Number(sl.value)); paint(); onChange?.(); });
      sl.addEventListener('keydown', (e) => e.stopPropagation());
      kids.push(h('div.tp-dur', {}, h('label', {}, 'Length'), sl, val));
    }
    if (!prev) kids.push(h('div.hint', {}, 'A transition joins two clips. Put this clip right after another one on the same track.'));
    el.replaceChildren(...kids);
  };
  paint();
  return el;
}

let pop = null;
/** Picker in a small floating window near (x, y). */
export function openTransitionPopup(c, x, y) {
  closeTransitionPopup();
  pop = h('div.tp-pop', { on: { pointerdown: (e) => e.stopPropagation(), keydown: (e) => { if (e.key === 'Escape') closeTransitionPopup(); } } },
    h('div.tp-head', {}, h('b', {}, 'Transition'), h('span.hint', {}, `into ${c.label || c.src.split('/').pop()}`), h('button.btn.ghost.icon.sm', { title: 'Close', on: { click: closeTransitionPopup } }, '✕')),
    transitionPicker(c));
  document.body.append(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
  setTimeout(() => window.addEventListener('pointerdown', closeTransitionPopup, { once: true }), 0);
}
export function closeTransitionPopup() { pop?.remove(); pop = null; }
