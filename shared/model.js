// Project model shared by the server, the CLI and the browser UI.
// Keep this file dependency-free: it is served as-is to the browser.

export const VISUAL_TYPES = ['video', 'image', 'html'];
export const CLIP_TYPES = ['video', 'image', 'html', 'audio'];
export const FITS = ['contain', 'cover', 'fill'];

// Values a clip has when the field is missing. compactProject() strips them
// again so project.json stays short and readable for agents.
export const CLIP_DEFAULTS = {
  in: 0, speed: 1, x: 0, y: 0, scale: 1, opacity: 1, volume: 1, fadeIn: 0, fadeOut: 0, fit: 'contain',
  brightness: 1, contrast: 1, saturation: 1,
  rotation: 0, flipH: false, flipV: false, cropT: 0, cropR: 0, cropB: 0, cropL: 0, xfade: 0,
};

// Properties that can carry keyframes: clip.keys = { x: [[t, value, ease?], ...] }
// t is seconds from the clip start; ease shapes the move from this key to the next.
export const ANIMATABLE = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
export const EASES = ['ease', 'linear', 'in', 'out', 'hold'];

const CLIP_KEY_ORDER = [
  'id', 'track', 'type', 'src', 'start', 'duration', 'in', 'speed',
  'fit', 'x', 'y', 'scale', 'rotation', 'flipH', 'flipV', 'opacity', 'volume', 'fadeIn', 'fadeOut', 'xfade',
  'cropT', 'cropR', 'cropB', 'cropL', 'brightness', 'contrast', 'saturation', 'keys', 'props', 'label', 'disabled',
];
const TIME_KEYS = ['start', 'duration', 'in', 'fadeIn', 'fadeOut', 'xfade'];

const EXT = {
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'],
  html: ['html', 'htm'],
};

export function mediaKind(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind;
  return null;
}

export const isVisual = (c) => VISUAL_TYPES.includes(c.type);
export const trackKindFor = (type) => (type === 'audio' ? 'audio' : 'video');
export const clipEnd = (c) => c.start + c.duration;
export const r3 = (n) => Math.round(n * 1000) / 1000;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function uid(prefix, taken) {
  let id;
  do id = prefix + Math.random().toString(36).slice(2, 7);
  while (taken && taken.has(id));
  return id;
}

export function projectDuration(p) {
  let d = 0;
  for (const c of p.clips || []) if (!c.disabled) d = Math.max(d, c.start + c.duration);
  return d;
}

export function normalizeProject(raw) {
  const p = structuredClone(raw && typeof raw === 'object' ? raw : {});
  p.version ??= 1;
  p.name ??= 'untitled';
  p.width ??= 1920;
  p.height ??= 1080;
  p.fps ??= 30;
  p.background ??= '#000000';
  if (!Array.isArray(p.tracks) || !p.tracks.length) {
    p.tracks = [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }];
  }
  p.clips = Array.isArray(p.clips) ? p.clips.filter((c) => c && typeof c === 'object') : [];
  p.markers = Array.isArray(p.markers) ? p.markers.filter((m) => m && typeof m === 'object') : [];
  const ids = new Set();
  for (const c of p.clips) {
    if (!c.id || ids.has(c.id)) c.id = uid('c', ids);
    ids.add(c.id);
    for (const [k, v] of Object.entries(CLIP_DEFAULTS)) if (c[k] == null) c[k] = v;
    c.start = +c.start || 0;
    c.duration = +c.duration || 0;
    if (c.keys && typeof c.keys === 'object' && !Array.isArray(c.keys)) {
      const keys = {};
      for (const [k, list] of Object.entries(c.keys)) {
        if (!Array.isArray(list)) continue;
        const ok = list.filter((x) => Array.isArray(x) && Number.isFinite(+x[0]) && Number.isFinite(+x[1]))
          .map((x) => (x[2] && x[2] !== 'ease' ? [+x[0], +x[1], x[2]] : [+x[0], +x[1]]))
          .sort((a, b) => a[0] - b[0]);
        if (ok.length) keys[k] = ok;
      }
      if (Object.keys(keys).length) c.keys = keys;
      else delete c.keys;
    } else delete c.keys;
  }
  const mids = new Set();
  for (const m of p.markers) {
    if (!m.id || mids.has(m.id)) m.id = uid('m', mids);
    mids.add(m.id);
    m.t = +m.t || 0;
    m.note ??= '';
  }
  return p;
}

// Strip defaults, round times to the millisecond and order keys, so the file
// reads the same way every time no matter who wrote it.
export function compactProject(p) {
  const trackOrder = new Map((p.tracks || []).map((t, i) => [t.id, i]));
  const out = {
    version: p.version ?? 1,
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    background: p.background,
  };
  for (const k of Object.keys(p)) {
    if (!(k in out) && !['tracks', 'clips', 'markers'].includes(k)) out[k] = p[k];
  }
  out.tracks = (p.tracks || []).map((t) => {
    const o = { id: t.id, kind: t.kind };
    for (const k of Object.keys(t)) if (!(k in o)) o[k] = t[k];
    if (!o.hidden) delete o.hidden;
    if (!o.muted) delete o.muted;
    if (!o.locked) delete o.locked;
    if (!o.name) delete o.name;
    return o;
  });
  out.markers = (p.markers || [])
    .map((m) => {
      const o = { id: m.id, t: r3(m.t) };
      if (m.note) o.note = m.note;
      for (const k of Object.keys(m)) if (!(k in o) && k !== 'note') o[k] = m[k];
      return o;
    })
    .sort((a, b) => a.t - b.t);
  out.clips = (p.clips || [])
    .map((c) => {
      const o = {};
      for (const k of CLIP_KEY_ORDER) if (c[k] !== undefined) o[k] = c[k];
      for (const k of Object.keys(c)) if (!(k in o)) o[k] = c[k];
      for (const [k, v] of Object.entries(CLIP_DEFAULTS)) if (o[k] === v) delete o[k];
      for (const k of TIME_KEYS) if (typeof o[k] === 'number') o[k] = r3(o[k]);
      for (const k of ['x', 'y']) if (typeof o[k] === 'number') o[k] = Math.round(o[k] * 10) / 10;
      for (const k of ['scale', 'opacity', 'volume', 'speed', 'brightness', 'contrast', 'saturation']) if (typeof o[k] === 'number') o[k] = r3(o[k]);
      for (const k of ['rotation', 'cropT', 'cropR', 'cropB', 'cropL']) if (typeof o[k] === 'number') o[k] = Math.round(o[k] * 100) / 100;
      if (o.keys) {
        const keys = {};
        for (const [k, list] of Object.entries(o.keys)) {
          if (!Array.isArray(list) || !list.length) continue;
          const dig = k === 'x' || k === 'y' || k === 'rotation' ? 10 : 1000;
          keys[k] = list.map((x) => { const v = [r3(x[0]), Math.round(x[1] * dig) / dig]; if (x[2] && x[2] !== 'ease') v.push(x[2]); return v; });
        }
        if (Object.keys(keys).length) o.keys = keys;
        else delete o.keys;
      }
      if (o.props && typeof o.props === 'object' && !Object.keys(o.props).length) delete o.props;
      if (!o.disabled) delete o.disabled;
      if (!o.label) delete o.label;
      return o;
    })
    .sort((a, b) => (trackOrder.get(a.track) ?? 99) - (trackOrder.get(b.track) ?? 99) || a.start - b.start);
  return out;
}

// One object per line for tracks, markers and clips: short diffs, easy to grep.
export function formatProject(o) {
  const keys = Object.keys(o);
  const lines = ['{'];
  keys.forEach((k, i) => {
    const v = o[k];
    const comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v) && ['tracks', 'clips', 'markers'].includes(k)) {
      if (!v.length) {
        lines.push(`  ${JSON.stringify(k)}: []${comma}`);
        return;
      }
      lines.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((x, j) => lines.push(`    ${JSON.stringify(x)}${j < v.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

export const serializeProject = (p) => formatProject(compactProject(normalizeProject(p)));

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateProject(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['project.json must contain a JSON object'], warnings };
  }
  for (const k of ['width', 'height', 'fps']) {
    if (raw[k] != null && !(num(raw[k]) && raw[k] > 0)) errors.push(`${k} must be a positive number`);
  }
  if (num(raw.width) && num(raw.height) && (raw.width % 2 || raw.height % 2)) {
    errors.push('width and height must be even numbers (H.264 needs it)');
  }
  if (raw.fps > 120) warnings.push('fps above 120 is unusual');
  if (raw.tracks != null && !Array.isArray(raw.tracks)) errors.push('tracks must be an array');
  if (raw.clips != null && !Array.isArray(raw.clips)) errors.push('clips must be an array');
  if (raw.markers != null && !Array.isArray(raw.markers)) errors.push('markers must be an array');
  if (errors.length) return { errors, warnings };

  const tracks = new Map();
  (raw.tracks || []).forEach((t, i) => {
    if (!t || !t.id) return errors.push(`tracks[${i}] needs an "id"`);
    if (tracks.has(t.id)) errors.push(`duplicate track id "${t.id}"`);
    if (!['video', 'audio'].includes(t.kind)) errors.push(`track ${t.id}: "kind" must be "video" or "audio"`);
    tracks.set(t.id, t);
  });

  const ids = new Set();
  (raw.clips || []).forEach((c, i) => {
    if (!c || typeof c !== 'object') return errors.push(`clips[${i}] must be an object`);
    const at = `clip ${c.id ?? `#${i}`}`;
    if (!c.id) warnings.push(`clips[${i}] has no "id"; one will be assigned`);
    else if (ids.has(c.id)) errors.push(`duplicate clip id "${c.id}"`);
    if (c.id) ids.add(c.id);
    if (!CLIP_TYPES.includes(c.type)) errors.push(`${at}: "type" must be one of ${CLIP_TYPES.join(', ')}`);
    if (typeof c.src !== 'string' || !c.src) errors.push(`${at}: "src" is required`);
    else if (c.type) {
      const k = c.src.startsWith('@kadr/') ? 'html' : mediaKind(c.src);
      if (k && k !== c.type) errors.push(`${at}: src "${c.src}" looks like ${k}, but type is "${c.type}"`);
    }
    const t = tracks.get(c.track);
    if (!t) errors.push(`${at}: unknown track "${c.track}"`);
    else if (c.type && CLIP_TYPES.includes(c.type) && t.kind !== trackKindFor(c.type)) {
      errors.push(`${at}: a ${c.type} clip cannot sit on ${t.kind} track ${t.id}`);
    }
    if (!(num(c.start) && c.start >= 0)) errors.push(`${at}: "start" must be a number >= 0 (seconds)`);
    if (!(num(c.duration) && c.duration > 0)) errors.push(`${at}: "duration" must be a number > 0 (seconds)`);
    if (c.in != null && !(num(c.in) && c.in >= 0)) errors.push(`${at}: "in" must be a number >= 0`);
    for (const k of ['x', 'y']) if (c[k] != null && !num(c[k])) errors.push(`${at}: "${k}" must be a number (pixels)`);
    if (c.scale != null && !(num(c.scale) && c.scale > 0)) errors.push(`${at}: "scale" must be > 0`);
    if (c.opacity != null && !(num(c.opacity) && c.opacity >= 0 && c.opacity <= 1)) errors.push(`${at}: "opacity" must be 0..1`);
    if (c.volume != null && !(num(c.volume) && c.volume >= 0 && c.volume <= 4)) errors.push(`${at}: "volume" must be 0..4`);
    for (const k of ['fadeIn', 'fadeOut']) if (c[k] != null && !(num(c[k]) && c[k] >= 0)) errors.push(`${at}: "${k}" must be >= 0`);
    if (c.speed != null && !(num(c.speed) && c.speed >= 0.1 && c.speed <= 16)) errors.push(`${at}: "speed" must be 0.1..16`);
    for (const k of ['brightness', 'contrast', 'saturation']) {
      if (c[k] != null && !(num(c[k]) && c[k] >= 0 && c[k] <= 4)) errors.push(`${at}: "${k}" must be 0..4 (1 = unchanged)`);
    }
    if (c.rotation != null && !num(c.rotation)) errors.push(`${at}: "rotation" must be a number (degrees, clockwise)`);
    for (const k of ['flipH', 'flipV']) if (c[k] != null && typeof c[k] !== 'boolean') errors.push(`${at}: "${k}" must be true or false`);
    for (const k of ['cropT', 'cropR', 'cropB', 'cropL']) if (c[k] != null && !(num(c[k]) && c[k] >= 0 && c[k] < 100)) errors.push(`${at}: "${k}" must be 0..100 (percent of the source)`);
    if (num(c.cropL) && num(c.cropR) && c.cropL + c.cropR >= 100) errors.push(`${at}: cropL + cropR must stay below 100`);
    if (num(c.cropT) && num(c.cropB) && c.cropT + c.cropB >= 100) errors.push(`${at}: cropT + cropB must stay below 100`);
    if (c.xfade != null && !(num(c.xfade) && c.xfade >= 0)) errors.push(`${at}: "xfade" must be >= 0 (seconds of cross dissolve from the previous clip)`);
    if (c.keys != null) {
      if (typeof c.keys !== 'object' || Array.isArray(c.keys)) errors.push(`${at}: "keys" must be an object like {"x": [[0, 0], [1, 200]]}`);
      else {
        for (const [k, list] of Object.entries(c.keys)) {
          if (!ANIMATABLE.includes(k)) { errors.push(`${at}: keys.${k}: only ${ANIMATABLE.join(', ')} can be keyframed`); continue; }
          if (!Array.isArray(list) || !list.length) { errors.push(`${at}: keys.${k} must be a non-empty array of [time, value, ease?]`); continue; }
          list.forEach((x, j) => {
            if (!Array.isArray(x) || !num(x[0]) || !num(x[1])) errors.push(`${at}: keys.${k}[${j}] must be [time, value] (time in seconds from the clip start)`);
            else if (x[2] != null && !EASES.includes(x[2])) errors.push(`${at}: keys.${k}[${j}] ease must be one of ${EASES.join(', ')}`);
          });
          if (num(c.duration) && list.length && list.every((x) => Array.isArray(x) && num(x[0]) && (x[0] < -1e-6 || x[0] > c.duration + 1e-6))) {
            warnings.push(`${at}: every keys.${k} time is outside the clip (0..${c.duration}s); key times are seconds from the clip start, not the timeline`);
          }
        }
      }
    }
    if (c.type === 'audio' && ['brightness', 'contrast', 'saturation'].some((k) => c[k] != null && c[k] !== 1)) warnings.push(`${at}: audio clips ignore color settings`);
    if (c.fit != null && !FITS.includes(c.fit)) errors.push(`${at}: "fit" must be one of ${FITS.join(', ')}`);
    if (c.props != null && (typeof c.props !== 'object' || Array.isArray(c.props))) errors.push(`${at}: "props" must be an object`);
    if (num(c.duration) && (c.fadeIn || 0) + (c.fadeOut || 0) > c.duration + 1e-6) {
      warnings.push(`${at}: fadeIn + fadeOut is longer than the clip`);
    }
    if (c.type === 'audio' && (c.x || c.y || (c.scale ?? 1) !== 1 || (c.opacity ?? 1) !== 1 || c.rotation)) {
      warnings.push(`${at}: audio clips ignore x/y/scale/opacity`);
    }
  });

  const byTrack = new Map();
  for (const c of raw.clips || []) {
    if (!c || c.disabled || !num(c.start) || !num(c.duration)) continue;
    if (!byTrack.has(c.track)) byTrack.set(c.track, []);
    byTrack.get(c.track).push(c);
  }
  for (const [tid, list] of byTrack) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a.start + a.duration > b.start + 1e-4 && !b.disabled) {
        warnings.push(`clips ${a.id} and ${b.id} overlap on ${tid} (the later one draws on top; use another track for layering)`);
      }
    }
  }
  (raw.markers || []).forEach((m, i) => {
    if (!num(m?.t) || m.t < 0) errors.push(`markers[${i}]: "t" must be a number >= 0`);
  });
  return { errors, warnings };
}

// Where a visual clip lands on the canvas. Same math in preview and export.
export function placement(clip, mw, mh, W, H) {
  mw = mw || W;
  mh = mh || H;
  let w;
  let h;
  if (clip.fit === 'fill') {
    w = W;
    h = H;
  } else {
    const f = clip.fit === 'cover' ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh);
    w = mw * f;
    h = mh * f;
  }
  w *= clip.scale ?? 1;
  h *= clip.scale ?? 1;
  return { w, h, x: (W - w) / 2 + (clip.x || 0), y: (H - h) / 2 + (clip.y || 0) };
}

/** Source time shown at timeline time t (video/audio media time, html composition time). */
export const sourceTime = (c, t) => (c.in || 0) + (t - c.start) * (c.speed || 1);
/** Seconds of source a clip consumes. */
export const sourceSpan = (c) => c.duration * (c.speed || 1);

/** CSS filter string for a clip's color settings ('' when neutral). Export uses the same math. */
export function cssFilter(c) {
  const f = [];
  if ((c.brightness ?? 1) !== 1) f.push(`brightness(${c.brightness})`);
  if ((c.contrast ?? 1) !== 1) f.push(`contrast(${c.contrast})`);
  if ((c.saturation ?? 1) !== 1) f.push(`saturate(${c.saturation})`);
  return f.join(' ');
}

// 0..1 multiplier from fadeIn / fadeOut (and cross dissolves) at timeline time t.
// tr = { xin, xout } from transitions(). Visual clips only fade in over a dissolve
// (the outgoing clip holds underneath); audio fades both ways.
export function fadeAt(c, t, tr, audio = false) {
  const u = t - c.start;
  let a = 1;
  if (c.fadeIn > 0 && u < c.fadeIn) a = Math.max(0, u / c.fadeIn);
  const rem = c.duration - u;
  if (c.fadeOut > 0 && rem < c.fadeOut) a = Math.min(a, Math.max(0, rem / c.fadeOut));
  if (tr?.xin > 0) a *= clamp((u + tr.xin / 2) / tr.xin, 0, 1);
  if (audio && tr?.xout > 0) a *= clamp((rem + tr.xout / 2) / tr.xout, 0, 1);
  return a;
}

/**
 * Cross dissolves. A clip with xfade > 0 dissolves from the clip that ends where it
 * starts on the same track; the dissolve is centred on the cut, so both clips play
 * xfade/2 past the cut (holding their first / last frame if the media runs out).
 * Returns Map id -> { xin, xout } for clips that take part.
 */
export function transitions(p) {
  const out = new Map();
  const f = 0.5 / (p.fps || 30);
  const byTrack = new Map();
  for (const c of p.clips) {
    if (c.disabled) continue;
    if (!byTrack.has(c.track)) byTrack.set(c.track, []);
    byTrack.get(c.track).push(c);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (!(b.xfade > 0) || Math.abs(a.start + a.duration - b.start) > f) continue;
      const d = Math.min(b.xfade, a.duration, b.duration);
      out.set(b.id, { ...(out.get(b.id) || { xout: 0 }), xin: d });
      out.set(a.id, { ...(out.get(a.id) || { xin: 0 }), xout: d });
    }
  }
  return out;
}

/** Timeline span where a clip is on screen, including dissolve handles. */
export function clipWindow(c, tr) {
  return { s: c.start - (tr?.xin || 0) / 2, e: c.start + c.duration + (tr?.xout || 0) / 2 };
}

// ---------- keyframes ----------
export function ease(name, p) {
  switch (name) {
    case 'linear': return p;
    case 'in': return p * p * p;
    case 'out': return 1 - (1 - p) ** 3;
    case 'hold': return 0;
    default: return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
  }
}

export const isAnimated = (c, k) => !!c.keys?.[k]?.length;

/** Value of property k at timeline time t (keyframes win over the static value). */
export function valueAt(c, k, t) {
  const ks = c.keys?.[k];
  if (!ks?.length) return c[k] ?? CLIP_DEFAULTS[k];
  const u = t - c.start;
  if (u <= ks[0][0]) return ks[0][1];
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (u < b[0]) {
      const span = b[0] - a[0];
      const p = span > 0 ? (u - a[0]) / span : 1;
      return a[1] + (b[1] - a[1]) * ease(a[2] || 'ease', p);
    }
  }
  return ks[ks.length - 1][1];
}

/** A copy of the clip with every animated property resolved at time t. */
export function resolveAt(c, t) {
  if (!c.keys) return c;
  const o = { ...c };
  for (const k of Object.keys(c.keys)) o[k] = valueAt(c, k, t);
  return o;
}

/** Move every keyframe by dt seconds (used when the clip's head is trimmed or split). */
export function shiftKeys(c, dt, scale = 1) {
  if (!c.keys) return;
  for (const k of Object.keys(c.keys)) c.keys[k] = c.keys[k].map((x) => [r3(x[0] * scale + dt), ...x.slice(1)]);
}

/** Largest scale the clip reaches (export pre-scales to it once). */
export function maxScale(c) {
  return Math.max(c.scale ?? 1, ...(c.keys?.scale || []).map((x) => x[1]));
}

/** CSS clip-path for the crop ('' when none). */
export function cssCrop(c) {
  if (!(c.cropT || c.cropR || c.cropB || c.cropL)) return '';
  return `inset(${c.cropT || 0}% ${c.cropR || 0}% ${c.cropB || 0}% ${c.cropL || 0}%)`;
}

const pad = (n) => String(n).padStart(2, '0');

// HH:MM:SS:FF
export function tc(t, fps = 30) {
  const base = Math.round(fps);
  const f = Math.max(0, Math.round(t * fps));
  const s = Math.floor(f / base);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % base)}`;
}

// Accepts 12.5 / "12.5" / "1:02.5" / "00:01:02.5" / "00:01:02:15" (frames).
export function parseTime(v, fps = 30) {
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/s$/, '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return NaN;
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

// Filmstrip: one thumbnail per `interval` seconds, at most 240.
export function stripSpec(duration) {
  const count = Math.max(1, Math.min(240, Math.ceil(duration || 1)));
  return { count, interval: (duration || 1) / count };
}
