// Effects & presets, browsable like the Effects panel of other editors: color
// looks, color effects, blur, keying, masks, blend modes, motion presets,
// transitions, layout recipes and audio fixes. Click one to apply it to the
// selected clips, or drag it onto a clip on the timeline. Everything here only
// sets clip fields from shared/model.js, so the export matches the preview.
import { BLENDS, CLIP_DEFAULTS, MASK_DEFAULTS, KEY_DEFAULTS, clipEnd, r3, uid, placement } from '/shared/model.js';
import { S, on, emit, commit, toast, select } from './state.js';
import { $, h, svg, ICON, api } from './util.js';
import { clipById, trackById, nextTrackId, clearRange } from './ops.js';
import { gradeFilter, onFxLoad } from './fx.js';
import { TRANSITIONS, applyTransition } from './transitions.js';

export const GRADE_KEYS = ['brightness', 'contrast', 'saturation', 'gamma', 'temperature', 'tint', 'hue', 'sepia', 'vignette'];

// ---------- looks (one-click grades) ----------
export const LOOKS = [
  { id: 'pop', name: 'Natural pop', v: { contrast: 1.08, saturation: 1.18, gamma: 1.04 } },
  { id: 'vivid', name: 'Vivid', v: { contrast: 1.15, saturation: 1.45 } },
  { id: 'cinematic', name: 'Cinematic', v: { contrast: 1.16, saturation: 0.86, temperature: -0.08, gamma: 0.94, vignette: 0.35 } },
  { id: 'blockbuster', name: 'Blockbuster', v: { contrast: 1.22, saturation: 1.12, temperature: 0.14, tint: -0.1, vignette: 0.3 } },
  { id: 'golden', name: 'Golden hour', v: { temperature: 0.45, saturation: 1.12, gamma: 1.05, contrast: 1.04 } },
  { id: 'cool', name: 'Cool morning', v: { temperature: -0.35, saturation: 0.94, brightness: 1.04 } },
  { id: 'vintage', name: 'Vintage', v: { sepia: 0.35, contrast: 0.92, saturation: 0.8, vignette: 0.4 } },
  { id: 'faded', name: 'Faded film', v: { contrast: 0.82, brightness: 1.06, saturation: 0.78, gamma: 1.1 } },
  { id: 'dreamy', name: 'Dreamy', v: { brightness: 1.07, contrast: 0.88, saturation: 1.12, gamma: 1.15, tint: 0.1 } },
  { id: 'bleach', name: 'Bleach bypass', v: { saturation: 0.45, contrast: 1.32, brightness: 1.02 } },
  { id: 'noir', name: 'Noir', v: { saturation: 0, contrast: 1.38, gamma: 0.9, vignette: 0.5 } },
  { id: 'bw', name: 'Black & white', v: { saturation: 0, contrast: 1.1 } },
  { id: 'sepia', name: 'Sepia', v: { sepia: 0.9, contrast: 1.05 } },
  { id: 'night', name: 'Day for night', v: { temperature: -0.6, brightness: 0.72, saturation: 0.7, gamma: 0.85, vignette: 0.3 } },
  { id: 'matrix', name: 'Code green', v: { tint: -0.55, saturation: 0.85, contrast: 1.2 } },
];

export function applyLook(c, look) {
  for (const k of GRADE_KEYS) c[k] = look?.v[k] ?? CLIP_DEFAULTS[k];
}

/** The look a clip's grade matches exactly, or null. */
export function currentLook(c) {
  return LOOKS.find((l) => GRADE_KEYS.every((k) => Math.abs((c[k] ?? CLIP_DEFAULTS[k]) - (l.v[k] ?? CLIP_DEFAULTS[k])) < 1e-6)) || null;
}

// A small painted scene for the look thumbnails (sky, sun, hills, a face tone).
let sceneUrl = '';
function scene() {
  if (sceneUrl) return sceneUrl;
  const cv = document.createElement('canvas');
  cv.width = 160;
  cv.height = 90;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 60);
  sky.addColorStop(0, '#3d7bd9');
  sky.addColorStop(1, '#f2b880');
  g.fillStyle = sky;
  g.fillRect(0, 0, 160, 90);
  g.fillStyle = '#ffe2a0';
  g.beginPath(); g.arc(112, 44, 13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3f7a45';
  g.beginPath(); g.moveTo(0, 62); g.quadraticCurveTo(50, 40, 96, 60); g.quadraticCurveTo(130, 72, 160, 58); g.lineTo(160, 90); g.lineTo(0, 90); g.fill();
  g.fillStyle = '#25502c';
  g.beginPath(); g.moveTo(0, 78); g.quadraticCurveTo(70, 60, 160, 80); g.lineTo(160, 90); g.lineTo(0, 90); g.fill();
  g.fillStyle = '#d9a17e';
  g.beginPath(); g.ellipse(38, 58, 9, 11, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c0392b';
  g.fillRect(28, 68, 20, 22);
  sceneUrl = cv.toDataURL('image/png');
  return sceneUrl;
}

/** CSS that previews a look on an element (the same filters the preview uses). */
export function lookStyle(look) {
  const c = { id: `look-${look.id}`, ...CLIP_DEFAULTS, ...look.v };
  const f = [];
  if (c.brightness !== 1) f.push(`brightness(${c.brightness})`);
  if (c.contrast !== 1) f.push(`contrast(${c.contrast})`);
  if (c.saturation !== 1) f.push(`saturate(${c.saturation})`);
  const id = gradeFilter(c);
  if (id) f.push(`url(#${id})`);
  return f.join(' ') || 'none';
}

// ---------- motion presets ----------
const W = () => S.project.width;
const H = () => S.project.height;
function anim(fn) {
  return (c) => {
    const d = c.duration;
    const T = (x) => r3(Math.min(x, d * 0.9));
    const b = { x: c.x || 0, y: c.y || 0, scale: c.scale ?? 1, rotation: c.rotation || 0, opacity: c.opacity ?? 1 };
    const keys = fn({ c, d, T, b, W: W(), H: H() });
    if (keys) c.keys = { ...(c.keys || {}), ...keys };
  };
}
// deterministic jitter for "shake"
const jitter = (i, s) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };

export const MOTION = [
  { id: 'kenburns', name: 'Ken Burns (slow zoom in)', fn: anim(({ d, b, c }) => { if (c.type !== 'html') c.fit = 'cover'; return { scale: [[0, b.scale], [r3(d), r3(b.scale * 1.12), 'linear']] }; }) },
  { id: 'zoomout', name: 'Slow zoom out', fn: anim(({ d, b, c }) => { if (c.type !== 'html') c.fit = 'cover'; return { scale: [[0, r3(b.scale * 1.14)], [r3(d), b.scale, 'linear']] }; }) },
  { id: 'punch', name: 'Punch in', fn: anim(({ T, b }) => ({ scale: [[0, b.scale, 'out'], [T(0.35), r3(b.scale * 1.25)]] })) },
  { id: 'pop', name: 'Pop in', fn: anim(({ T, b }) => ({ scale: [[0, r3(b.scale * 0.5), 'back'], [T(0.5), b.scale]], opacity: [[0, 0], [T(0.2), b.opacity]] })) },
  { id: 'bounce', name: 'Bounce in', fn: anim(({ T, b, H: h }) => ({ y: [[0, Math.round(b.y - h * 0.7), 'bounce'], [T(0.9), b.y]] })) },
  { id: 'elastic', name: 'Elastic scale', fn: anim(({ T, b }) => ({ scale: [[0, r3(b.scale * 0.3), 'elastic'], [T(1), b.scale]] })) },
  { id: 'inL', name: 'Slide in from left', fn: anim(({ T, b, W: w }) => ({ x: [[0, Math.round(b.x - w), 'out'], [T(0.6), b.x]] })) },
  { id: 'inR', name: 'Slide in from right', fn: anim(({ T, b, W: w }) => ({ x: [[0, Math.round(b.x + w), 'out'], [T(0.6), b.x]] })) },
  { id: 'inT', name: 'Slide in from top', fn: anim(({ T, b, H: h }) => ({ y: [[0, Math.round(b.y - h), 'out'], [T(0.6), b.y]] })) },
  { id: 'inB', name: 'Slide in from bottom', fn: anim(({ T, b, H: h }) => ({ y: [[0, Math.round(b.y + h), 'out'], [T(0.6), b.y]] })) },
  { id: 'outL', name: 'Slide out to left', fn: anim(({ d, T, b, W: w }) => ({ x: [[r3(d - T(0.6)), b.x, 'in'], [r3(d), Math.round(b.x - w)]] })) },
  { id: 'outR', name: 'Slide out to right', fn: anim(({ d, T, b, W: w }) => ({ x: [[r3(d - T(0.6)), b.x, 'in'], [r3(d), Math.round(b.x + w)]] })) },
  { id: 'spin', name: 'Spin in', fn: anim(({ T, b }) => ({ rotation: [[0, b.rotation - 180, 'out'], [T(0.7), b.rotation]], scale: [[0, r3(b.scale * 0.2), 'out'], [T(0.7), b.scale]] })) },
  { id: 'blurIn', name: 'Blur in', fn: anim(({ T, b }) => ({ blur: [[0, 30, 'out'], [T(0.6), 0]], opacity: [[0, 0], [T(0.35), b.opacity]] })) },
  { id: 'blurOut', name: 'Blur out', fn: anim(({ d, T, b }) => ({ blur: [[r3(d - T(0.6)), 0, 'in'], [r3(d), 30]], opacity: [[r3(d - T(0.35)), b.opacity], [r3(d), 0]] })) },
  {
    id: 'shake', name: 'Camera shake (1 s)', fn: anim(({ d, b }) => {
      const n = Math.max(2, Math.round(Math.min(1, d) * 20));
      const x = [];
      const y = [];
      for (let i = 0; i <= n; i++) {
        const t = r3((i / n) * Math.min(1, d));
        const k = i === n ? 0 : 1 - i / n;
        x.push([t, Math.round(b.x + jitter(i, 1) * 22 * k), 'linear']);
        y.push([t, Math.round(b.y + jitter(i, 2) * 14 * k), 'linear']);
      }
      return { x, y };
    }),
  },
  {
    id: 'pulse', name: 'Pulse', fn: anim(({ d, b }) => {
      const out = [];
      for (let t = 0, i = 0; t <= d + 1e-6 && i < 80; t += 0.5, i++) out.push([r3(t), r3(i % 2 ? b.scale * 1.06 : b.scale), 'smooth']);
      return { scale: out };
    }),
  },
  {
    id: 'float', name: 'Float', fn: anim(({ d, b }) => {
      const out = [];
      for (let t = 0, i = 0; t <= d + 1e-6 && i < 60; t += 1.5, i++) out.push([r3(t), i % 2 ? b.y - 16 : b.y, 'smooth']);
      return { y: out };
    }),
  },
  { id: 'clear', name: 'Remove all animation', fn: (c) => { delete c.keys; } },
];

// ---------- the catalog ----------
const V = ['video', 'image', 'html'];
const MEDIA = ['video', 'image'];
const SOUND = ['video', 'audio'];
const set = (o) => (c) => Object.assign(c, o);
const pipAt = (sx, sy) => (c) => {
  const info = S.media.get(c.src);
  const base = placement({ ...c, x: 0, y: 0, scale: 1 }, c.type === 'html' ? W() : info?.width || W(), c.type === 'html' ? H() : info?.height || H(), W(), H());
  const s = 0.32;
  const m = Math.round(Math.min(W(), H()) * 0.045);
  c.scale = s;
  c.x = Math.round(sx * ((W() - base.w * s) / 2 - m));
  c.y = Math.round(sy * ((H() - base.h * s) / 2 - m));
  if (c.keys) { delete c.keys.x; delete c.keys.y; delete c.keys.scale; if (!Object.keys(c.keys).length) delete c.keys; }
};

const BLEND_NAMES = {
  multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', softLight: 'Soft light', hardLight: 'Hard light', darken: 'Darken', lighten: 'Lighten',
  colorDodge: 'Color dodge', colorBurn: 'Color burn', add: 'Add (linear dodge)', difference: 'Difference', exclusion: 'Exclusion', normal: 'Normal',
};
export const blendName = (b) => BLEND_NAMES[b] || b;

export const CATALOG = [
  {
    group: 'Color', icon: 'color', items: [
      { id: 'bw', name: 'Black & white', types: V, apply: set({ saturation: 0 }) },
      { id: 'sepia', name: 'Sepia', types: V, apply: set({ sepia: 0.8 }) },
      { id: 'warm', name: 'Warm up', types: V, apply: (c) => { c.temperature = Math.min(1, (c.temperature || 0) + 0.3); } },
      { id: 'cool', name: 'Cool down', types: V, apply: (c) => { c.temperature = Math.max(-1, (c.temperature || 0) - 0.3); } },
      { id: 'hue', name: 'Hue shift', types: V, apply: (c) => { c.hue = ((c.hue || 0) + 60 + 180) % 360 - 180; } },
      { id: 'vignette', name: 'Vignette', types: V, apply: set({ vignette: 0.45 }) },
      { id: 'midtones', name: 'Lift midtones', types: V, apply: set({ gamma: 1.3 }) },
      { id: 'punchy', name: 'More contrast', types: V, apply: (c) => { c.contrast = r3(Math.min(4, (c.contrast ?? 1) * 1.15)); } },
      { id: 'resetColor', name: 'Reset color', types: V, apply: (c) => applyLook(c, null) },
    ],
  },
  {
    group: 'Blur & sharpness', icon: 'blur', items: [
      { id: 'blur', name: 'Gaussian blur', types: V, apply: set({ blur: 12 }) },
      { id: 'blurStrong', name: 'Strong blur', types: V, apply: set({ blur: 40 }) },
      { id: 'blurIn', name: 'Blur in', types: V, apply: (c) => MOTION.find((m) => m.id === 'blurIn').fn(c) },
      { id: 'blurOut', name: 'Blur out', types: V, apply: (c) => MOTION.find((m) => m.id === 'blurOut').fn(c) },
      { id: 'noBlur', name: 'Remove blur', types: V, apply: (c) => { c.blur = 0; if (c.keys?.blur) { delete c.keys.blur; if (!Object.keys(c.keys).length) delete c.keys; } } },
    ],
  },
  {
    group: 'Keying', icon: 'key', items: [
      { id: 'keyGreen', name: 'Chroma key (green screen)', types: MEDIA, apply: set({ key: { ...KEY_DEFAULTS } }) },
      { id: 'keyBlue', name: 'Chroma key (blue screen)', types: MEDIA, apply: set({ key: { ...KEY_DEFAULTS, color: '#0047ff' } }) },
      { id: 'keyOff', name: 'Remove key', types: MEDIA, apply: (c) => { delete c.key; } },
    ],
  },
  {
    group: 'Masks', icon: 'mask', items: [
      { id: 'maskEllipse', name: 'Ellipse mask', types: V, apply: set({ mask: { ...MASK_DEFAULTS } }) },
      { id: 'maskRect', name: 'Rectangle mask', types: V, apply: set({ mask: { ...MASK_DEFAULTS, shape: 'rect', w: 70, h: 70, feather: 0 } }) },
      { id: 'spotlight', name: 'Soft spotlight', types: V, apply: set({ mask: { ...MASK_DEFAULTS, w: 75, h: 85, feather: 35 } }) },
      { id: 'letterbox', name: 'Cinema bars (2.39:1)', types: V, apply: (c) => { c.mask = { ...MASK_DEFAULTS, shape: 'rect', w: 100, h: r3(Math.min(100, (W() / 2.39 / H()) * 100)), feather: 0 }; } },
      { id: 'maskOff', name: 'Remove mask', types: V, apply: (c) => { delete c.mask; } },
    ],
  },
  { group: 'Blend modes', icon: 'blend', items: BLENDS.map((b) => ({ id: `blend-${b}`, name: BLEND_NAMES[b], types: V, apply: set({ blend: b }) })) },
  { group: 'Motion presets', icon: 'motion', items: MOTION.map((m) => ({ id: `motion-${m.id}`, name: m.name, types: V, apply: m.fn })) },
  {
    group: 'Layout', icon: 'layout', items: [
      { id: 'pipBR', name: 'Picture in picture ↘', types: V, apply: pipAt(1, 1) },
      { id: 'pipBL', name: 'Picture in picture ↙', types: V, apply: pipAt(-1, 1) },
      { id: 'pipTR', name: 'Picture in picture ↗', types: V, apply: pipAt(1, -1) },
      { id: 'pipTL', name: 'Picture in picture ↖', types: V, apply: pipAt(-1, -1) },
      { id: 'fill', name: 'Fill the frame', types: MEDIA, apply: set({ fit: 'cover', scale: 1, x: 0, y: 0 }) },
      { id: 'fit', name: 'Fit in the frame', types: MEDIA, apply: set({ fit: 'contain', scale: 1, x: 0, y: 0 }) },
      { id: 'splitL', name: 'Split screen: left half', types: MEDIA, apply: (c) => { Object.assign(c, { fit: 'cover', scale: 1, cropL: 25, cropR: 25, x: -Math.round(W() / 4), y: 0 }); } },
      { id: 'splitR', name: 'Split screen: right half', types: MEDIA, apply: (c) => { Object.assign(c, { fit: 'cover', scale: 1, cropL: 25, cropR: 25, x: Math.round(W() / 4), y: 0 }); } },
      { id: 'blurBg', name: 'Blurred background fill', types: MEDIA, apply: null, special: 'blurBg' },
      { id: 'flipH', name: 'Flip horizontal', types: V, apply: (c) => { c.flipH = !c.flipH; } },
    ],
  },
  { group: 'Transitions', icon: 'transition', items: TRANSITIONS.map((t) => ({ id: `tr-${t.id}`, name: t.name, types: V, special: 'transition', tr: t.id })) },
  {
    group: 'Audio', icon: 'audio', items: [
      { id: 'afadeIn', name: 'Fade in (0.5 s)', types: SOUND, apply: (c) => { c.fadeIn = Math.min(0.5, c.duration / 2); } },
      { id: 'afadeOut', name: 'Fade out (1 s)', types: SOUND, apply: (c) => { c.fadeOut = Math.min(1, c.duration / 2); } },
      { id: 'panL', name: 'Pan left', types: SOUND, apply: set({ pan: -0.7 }) },
      { id: 'panC', name: 'Pan center', types: SOUND, apply: set({ pan: 0 }) },
      { id: 'panR', name: 'Pan right', types: SOUND, apply: set({ pan: 0.7 }) },
      { id: 'normalize', name: 'Normalize loudness peak', types: SOUND, special: 'normalize' },
      { id: 'denoise', name: 'Reduce background noise', types: SOUND, special: 'denoise' },
      { id: 'mute', name: 'Mute clip', types: SOUND, apply: set({ volume: 0 }) },
    ],
  },
];

const ALL = CATALOG.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
export const fxById = (id) => ALL.find((x) => x.id === id) || null;

// ---------- applying ----------
/** Apply effect `id` to the clips (default: the selection). */
export async function applyEffect(id, ids = [...S.sel]) {
  const fx = fxById(id);
  if (!fx) return;
  const clips = ids.map(clipById).filter(Boolean).filter((c) => !trackById(c.track)?.locked);
  if (!clips.length) return toast('Select a clip first, or drag the effect onto a clip');
  const ok = clips.filter((c) => fx.types.includes(c.type));
  if (!ok.length) return toast(`${fx.name} works on ${fx.types.join(' / ')} clips`);
  if (fx.special === 'transition') { for (const c of ok) applyTransition(c, fx.tr); return; }
  if (fx.special === 'normalize') return normalize(ok);
  if (fx.special === 'denoise') return denoise(ok);
  if (fx.special === 'blurBg') return blurredBackground(ok);
  commit(() => { for (const c of ok) fx.apply(c); });
  toast(`${fx.name}: ${ok.length === 1 ? 'applied' : `applied to ${ok.length} clips`}`);
}

async function normalize(clips) {
  let n = 0;
  for (const c of clips) {
    const info = S.media.get(c.src);
    if (!info?.hasAudio && c.type !== 'audio') continue;
    try {
      const r = await fetch(`/api/peaks?src=${encodeURIComponent(c.src)}`);
      if (!r.ok) continue;
      const pk = new Uint8Array(await r.arrayBuffer());
      const a = Math.floor((c.in || 0) * 100);
      const b = Math.ceil(((c.in || 0) + c.duration * (c.speed || 1)) * 100);
      let m = 0;
      for (let i = a; i < b && i < pk.length; i++) if (pk[i] > m) m = pk[i];
      if (m < 3) continue;
      // peaks at -1 dBFS
      const vol = Math.min(4, 0.891 / (m / 255));
      commit(() => { const x = clipById(c.id); if (x) { x.volume = r3(vol); if (x.keys?.volume) { delete x.keys.volume; if (!Object.keys(x.keys).length) delete x.keys; } } });
      n++;
    } catch { /* skip */ }
  }
  toast(n ? `Normalized ${n} clip${n > 1 ? 's' : ''} to peak at -1 dB` : 'No audio to normalize');
}

async function denoise(clips) {
  for (const c of clips) {
    toast('Reducing noise… (runs in the background)');
    try {
      const r = await api('/api/denoise', { src: c.src });
      commit(() => { const x = clipById(c.id); if (x) x.src = r.path; });
      toast('Noise reduced. Undo brings the original back.');
    } catch (e) { toast(e.message, true); }
  }
}

/** Put a blurred, zoomed copy of each clip on a track below it: the classic fill for vertical or odd-sized footage. */
function blurredBackground(clips) {
  const newIds = [];
  commit((p) => {
    for (const c0 of clips) {
      const c = p.clips.find((x) => x.id === c0.id);
      const ti = p.tracks.findIndex((t) => t.id === c.track);
      const free = (t) => t.kind === 'video' && !t.locked && !p.clips.some((x) => x.track === t.id && x.start < clipEnd(c) - 1e-4 && clipEnd(x) > c.start + 1e-4);
      let below = p.tracks.slice(0, ti).reverse().find(free);
      if (!below) {
        below = { id: nextTrackId(p, 'video'), kind: 'video' };
        p.tracks.splice(ti, 0, below);
      }
      const bg = structuredClone(c);
      bg.id = uid('c', new Set(p.clips.map((x) => x.id)));
      Object.assign(bg, { track: below.id, fit: 'cover', scale: 1.08, x: 0, y: 0, rotation: 0, blur: 40, brightness: 0.8, volume: 0, label: 'Blurred background', blend: 'normal' });
      delete bg.mask;
      delete bg.key;
      delete bg.keys;
      delete bg.link;
      c.fit = 'contain';
      clearRange(p, below.id, bg.start, clipEnd(bg));
      p.clips.push(bg);
      newIds.push(bg.id);
    }
  });
  toast('Added a blurred copy underneath');
}

// ---------- the panel ----------
const ICONS = {
  color: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11M8 2.5a5.5 5.5 0 0 1 0 11" fill="currentColor" stroke="none" opacity=".55"/>',
  blur: '<circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r="4.5" stroke-dasharray="1.5 1.6"/><circle cx="8" cy="8" r="6.5" stroke-dasharray="1 2.2" opacity=".6"/>',
  key: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 11l2.5-3 1.5 2 2-3.5" /><circle cx="11" cy="5.5" r=".8" fill="currentColor"/>',
  mask: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><ellipse cx="8" cy="8" rx="3.5" ry="3"/>',
  blend: '<circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4"/>',
  motion: '<path d="M2.5 11.5c2-5 4-6 6-3s4 2 5-3"/><circle cx="13.5" cy="5.5" r="1.2" fill="currentColor"/>',
  layout: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><rect x="8.5" y="8" width="4" height="3.3" rx=".6" fill="currentColor" stroke="none"/>',
  transition: '<rect x="1.5" y="4" width="7" height="8" rx="1"/><rect x="7.5" y="4" width="7" height="8" rx="1" opacity=".55"/>',
  audio: '<path d="M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5"/>',
  look: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2.5 11l3.5-3.5 2.5 2.5 2-2 3 3"/>',
};

const box = () => $('#binFx');
let query = '';
const collapsed = new Set((() => { try { return JSON.parse(localStorage.getItem('kadr.fxCollapsed') || '[]'); } catch { return []; } })());
const saveCollapsed = () => { try { localStorage.setItem('kadr.fxCollapsed', JSON.stringify([...collapsed])); } catch { /* private */ } };

function fxItem(it, ico) {
  return h('div.fx-item', {
    draggable: true,
    title: `${it.name}\nClick: apply to the selected clips · drag onto a clip`,
    on: {
      click: () => applyEffect(it.id),
      dragstart: (e) => { e.dataTransfer.setData('text/kadr-fx', it.id); e.dataTransfer.effectAllowed = 'copy'; },
    },
  }, h('span.fx-ico', {}, svg(ICONS[ico] || ICONS.color)), h('span.fx-nm', {}, it.name));
}

function lookTile(look) {
  const th = h('div.lk-th', { style: { backgroundImage: `url(${scene()})`, filter: lookStyle(look) } });
  return h('div.lk', {
    draggable: true,
    title: `${look.name}\nClick: apply to the selected clips · drag onto a clip`,
    on: {
      click: () => {
        const clips = [...S.sel].map(clipById).filter((c) => c && c.type !== 'audio' && !trackById(c.track)?.locked);
        if (!clips.length) return toast('Select a clip first, or drag the look onto a clip');
        commit(() => { for (const c of clips) applyLook(c, look); });
        toast(`Look: ${look.name}`);
      },
      dragstart: (e) => { e.dataTransfer.setData('text/kadr-fx', `look:${look.id}`); e.dataTransfer.effectAllowed = 'copy'; },
    },
  }, th, h('span', {}, look.name));
}

/** Apply a dropped effect / look id to one clip (timeline drop). */
export function dropEffect(id, clipId) {
  if (id.startsWith('look:')) {
    const look = LOOKS.find((l) => l.id === id.slice(5));
    const c = clipById(clipId);
    if (!look || !c || c.type === 'audio') return;
    commit(() => applyLook(clipById(clipId), look));
    select([clipId]);
    toast(`Look: ${look.name}`);
    return;
  }
  select([clipId]);
  applyEffect(id, [clipId]);
}

export function renderEffects() {
  const el = box();
  if (!el) return;
  const q = query.trim().toLowerCase();
  const match = (s) => !q || s.toLowerCase().includes(q);
  const search = h('input.fx-search', { type: 'search', placeholder: 'Search effects and presets', value: query, spellcheck: false });
  search.addEventListener('input', () => { query = search.value; renderEffects(); requestAnimationFrame(() => { const s = box().querySelector('.fx-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); });
  search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { query = ''; renderEffects(); } });
  const groups = [];
  const looks = LOOKS.filter((l) => match(l.name) || match('look'));
  const sec = (name, ico, count, body) => {
    const open = q || !collapsed.has(name);
    const head = h('button.fx-gh', { on: { click: () => { if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name); saveCollapsed(); renderEffects(); } } },
      h('span.chev', { class: `chev${open ? ' open' : ''}` }, svg('<path d="m6 4 4 4-4 4"/>')), svg(ICONS[ico]), h('span', {}, name), h('span.gh-n', {}, count));
    return h('div.fx-group', {}, head, open ? body : null);
  };
  if (looks.length) groups.push(sec('Looks', 'look', looks.length, h('div.lk-grid', {}, ...looks.map(lookTile))));
  for (const g of CATALOG) {
    const items = g.items.filter((it) => match(it.name) || match(g.group));
    if (!items.length) continue;
    groups.push(sec(g.group, g.icon, items.length, h('div.fx-list', {}, ...items.map((it) => fxItem(it, g.icon)))));
  }
  const hint = h('div.fx-hint', {}, hintText());
  el.replaceChildren(...[h('div.ph.fx-ph', {}, search), hint, ...groups, !groups.length ? h('div.empty', {}, 'Nothing matches.') : null].filter(Boolean));
}

function hintText() {
  const sel = [...S.sel].map(clipById).filter(Boolean);
  if (!sel.length) return 'Select clips, then click an effect. Or drag it onto a clip.';
  return `Applies to ${sel.length === 1 ? (sel[0].label || sel[0].src.split('/').pop()) : `${sel.length} clips`}`;
}

on('select', () => { const hnt = box()?.querySelector('.fx-hint'); if (hnt) hnt.textContent = hintText(); });
onFxLoad(() => {
  // re-resolve the look thumbnails' filters once their vignette images load
  for (const th of document.querySelectorAll('.lk-th')) { const f = th.style.filter; th.style.filter = 'none'; requestAnimationFrame(() => { th.style.filter = f; }); }
});
emit('effects-ready');
