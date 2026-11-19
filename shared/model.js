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
  rotation: 0, flipH: false, flipV: false, cropT: 0, cropR: 0, cropB: 0, cropL: 0, xfade: 0, xfadeType: 'dissolve',
  gamma: 1, temperature: 0, tint: 0, hue: 0, sepia: 0, vignette: 0, blur: 0, blend: 'normal', pan: 0,
};

// How a clip with xfade > 0 takes over from the previous clip: a dissolve, or
// both pictures pushed out of frame together (the new one comes from that side).
export const XFADE_TYPES = ['dissolve', 'pushLeft', 'pushRight', 'pushUp', 'pushDown'];

// Properties that can carry keyframes: clip.keys = { x: [[t, value, ease?], ...] }
// t is seconds from the clip start; ease shapes the move from this key to the next.
export const ANIMATABLE = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume', 'blur'];
export const EASES = ['ease', 'linear', 'in', 'out', 'smooth', 'back', 'elastic', 'bounce', 'hold'];

// How a picture mixes with what is under it (same math as CSS mix-blend-mode).
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'darken', 'lighten', 'colorDodge', 'colorBurn', 'add', 'difference', 'exclusion'];
export const BLEND_CSS = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', softLight: 'soft-light', hardLight: 'hard-light',
  darken: 'darken', lighten: 'lighten', colorDodge: 'color-dodge', colorBurn: 'color-burn', add: 'plus-lighter', difference: 'difference', exclusion: 'exclusion',
};
// Label colors for clips on the timeline, and marker colors (names; the UI picks the shades).
export const LABEL_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'brown', 'gray'];
export const MASK_SHAPES = ['ellipse', 'rect'];
export const MASK_DEFAULTS = { shape: 'ellipse', x: 50, y: 50, w: 60, h: 60, feather: 8, invert: false };
export const KEY_DEFAULTS = { color: '#00ff00', similarity: 0.3, smooth: 0.08, spill: 0.6 };

const CLIP_KEY_ORDER = [
  'id', 'track', 'type', 'src', 'start', 'duration', 'in', 'speed',
  'fit', 'x', 'y', 'scale', 'rotation', 'flipH', 'flipV', 'opacity', 'blend', 'volume', 'pan', 'fadeIn', 'fadeOut', 'xfade', 'xfadeType',
  'cropT', 'cropR', 'cropB', 'cropL', 'mask', 'brightness', 'contrast', 'saturation', 'gamma', 'temperature', 'tint', 'hue', 'sepia', 'vignette',
  'blur', 'key', 'keys', 'props', 'label', 'labelColor', 'link', 'disabled',
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
    if (!o.solo) delete o.solo;
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
      for (const k of ['scale', 'opacity', 'volume', 'speed', 'brightness', 'contrast', 'saturation', 'gamma', 'temperature', 'tint', 'sepia', 'vignette', 'pan']) if (typeof o[k] === 'number') o[k] = r3(o[k]);
      for (const k of ['rotation', 'cropT', 'cropR', 'cropB', 'cropL', 'hue', 'blur']) if (typeof o[k] === 'number') o[k] = Math.round(o[k] * 100) / 100;
      if (o.mask && typeof o.mask === 'object') {
        const m = {};
        for (const [k, v] of Object.entries(o.mask)) if (v !== MASK_DEFAULTS[k] || k === 'shape') m[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
        o.mask = m;
      }
      if (o.key && typeof o.key === 'object') {
        const m = {};
        for (const [k, v] of Object.entries(o.key)) if (v !== KEY_DEFAULTS[k] || k === 'color') m[k] = typeof v === 'number' ? r3(v) : v;
        o.key = m;
      }
      if (!o.mask) delete o.mask;
      if (!o.key) delete o.key;
      if (!o.labelColor) delete o.labelColor;
      if (!o.link) delete o.link;
      if (o.keys) {
        const keys = {};
        for (const [k, list] of Object.entries(o.keys)) {
          if (!Array.isArray(list) || !list.length) continue;
          const dig = k === 'x' || k === 'y' || k === 'rotation' || k === 'blur' ? 10 : 1000;
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
    for (const k of ['hidden', 'muted', 'solo', 'locked']) if (t[k] != null && typeof t[k] !== 'boolean') errors.push(`track ${t.id}: "${k}" must be true or false`);
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
    if (c.xfadeType != null && !XFADE_TYPES.includes(c.xfadeType)) errors.push(`${at}: "xfadeType" must be one of ${XFADE_TYPES.join(', ')}`);
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
    if (c.gamma != null && !(num(c.gamma) && c.gamma >= 0.1 && c.gamma <= 10)) errors.push(`${at}: "gamma" must be 0.1..10 (1 = unchanged, above 1 brightens the midtones)`);
    for (const k of ['temperature', 'tint', 'pan']) if (c[k] != null && !(num(c[k]) && c[k] >= -1 && c[k] <= 1)) errors.push(`${at}: "${k}" must be -1..1 (0 = unchanged)`);
    if (c.hue != null && !(num(c.hue) && c.hue >= -360 && c.hue <= 360)) errors.push(`${at}: "hue" must be -360..360 (degrees)`);
    for (const k of ['sepia', 'vignette']) if (c[k] != null && !(num(c[k]) && c[k] >= 0 && c[k] <= 1)) errors.push(`${at}: "${k}" must be 0..1`);
    if (c.blur != null && !(num(c.blur) && c.blur >= 0 && c.blur <= 200)) errors.push(`${at}: "blur" must be 0..200 (pixels)`);
    if (c.blend != null && !BLENDS.includes(c.blend)) errors.push(`${at}: "blend" must be one of ${BLENDS.join(', ')}`);
    if (c.labelColor != null && !LABEL_COLORS.includes(c.labelColor)) errors.push(`${at}: "labelColor" must be one of ${LABEL_COLORS.join(', ')}`);
    if (c.link != null && typeof c.link !== 'string') errors.push(`${at}: "link" must be a string (clips with the same link move together)`);
    if (c.mask != null) {
      const m = c.mask;
      if (typeof m !== 'object' || Array.isArray(m)) errors.push(`${at}: "mask" must be an object like {"shape":"ellipse","x":50,"y":50,"w":60,"h":60,"feather":8}`);
      else {
        if (m.shape != null && !MASK_SHAPES.includes(m.shape)) errors.push(`${at}: mask.shape must be ${MASK_SHAPES.join(' or ')}`);
        for (const k of ['x', 'y']) if (m[k] != null && !num(m[k])) errors.push(`${at}: mask.${k} must be a number (percent of the clip, 50 = centre)`);
        for (const k of ['w', 'h']) if (m[k] != null && !(num(m[k]) && m[k] > 0)) errors.push(`${at}: mask.${k} must be > 0 (percent of the clip)`);
        if (m.feather != null && !(num(m.feather) && m.feather >= 0 && m.feather <= 100)) errors.push(`${at}: mask.feather must be 0..100 (percent of the clip's shorter side)`);
        if (m.invert != null && typeof m.invert !== 'boolean') errors.push(`${at}: mask.invert must be true or false`);
      }
    }
    if (c.key != null) {
      const k = c.key;
      if (typeof k !== 'object' || Array.isArray(k)) errors.push(`${at}: "key" must be an object like {"color":"#00ff00","similarity":0.3,"smooth":0.08,"spill":0.6}`);
      else {
        if (k.color != null && !/^#[0-9a-f]{6}$/i.test(k.color)) errors.push(`${at}: key.color must be a #rrggbb color`);
        if (k.similarity != null && !(num(k.similarity) && k.similarity > 0 && k.similarity <= 1)) errors.push(`${at}: key.similarity must be 0..1`);
        for (const x of ['smooth', 'spill']) if (k[x] != null && !(num(k[x]) && k[x] >= 0 && k[x] <= 1)) errors.push(`${at}: key.${x} must be 0..1`);
      }
      if (c.type === 'audio' || c.type === 'html') warnings.push(`${at}: chroma key works on video and image clips`);
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
    if (m?.color != null && !LABEL_COLORS.includes(m.color)) errors.push(`markers[${i}]: "color" must be one of ${LABEL_COLORS.join(', ')}`);
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
  if (tr?.xin > 0 && (audio || !isPush(tr.tin))) a *= clamp((u + tr.xin / 2) / tr.xin, 0, 1);
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
      const type = XFADE_TYPES.includes(b.xfadeType) ? b.xfadeType : 'dissolve';
      out.set(b.id, { ...(out.get(b.id) || { xout: 0 }), xin: d, tin: type });
      out.set(a.id, { ...(out.get(a.id) || { xin: 0 }), xout: d, tout: type });
    }
  }
  return out;
}

export const isPush = (type) => typeof type === 'string' && type.startsWith('push');
const PUSH_DIR = { pushLeft: [1, 0], pushRight: [-1, 0], pushUp: [0, 1], pushDown: [0, -1] };
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * Extra offset in px of a clip that takes part in a push transition at time t.
 * The incoming clip slides in from the side; the outgoing one slides out the other way.
 */
export function transitionOffset(c, t, tr, W, H) {
  let dx = 0;
  let dy = 0;
  if (tr?.xin > 0 && isPush(tr.tin)) {
    const p = easeInOut(clamp((t - c.start + tr.xin / 2) / tr.xin, 0, 1));
    const [ux, uy] = PUSH_DIR[tr.tin];
    dx += ux * W * (1 - p);
    dy += uy * H * (1 - p);
  }
  if (tr?.xout > 0 && isPush(tr.tout)) {
    const p = easeInOut(clamp((t - (c.start + c.duration) + tr.xout / 2) / tr.xout, 0, 1));
    const [ux, uy] = PUSH_DIR[tr.tout];
    dx -= ux * W * p;
    dy -= uy * H * p;
  }
  return { dx, dy };
}

/**
 * The same offset as an ffmpeg expression of the output clock `t`; T0 is the
 * output time of the clip's start. Returns { x, y } strings ('0' when unused).
 */
export function transitionOffsetExpr(c, tr, W, H, T0) {
  const f = (n) => Number(n).toFixed(4);
  const eio = (p) => `if(lt(${p},0.5),4*pow(${p},3),1-pow(2-2*${p},3)/2)`;
  const xs = [];
  const ys = [];
  if (tr?.xin > 0 && isPush(tr.tin)) {
    const p = `clip((t-${f(T0)}+${f(tr.xin / 2)})/${f(tr.xin)},0,1)`;
    const [ux, uy] = PUSH_DIR[tr.tin];
    if (ux) xs.push(`${ux * W}*(1-${eio(p)})`);
    if (uy) ys.push(`${uy * H}*(1-${eio(p)})`);
  }
  if (tr?.xout > 0 && isPush(tr.tout)) {
    const p = `clip((t-${f(T0 + c.duration)}+${f(tr.xout / 2)})/${f(tr.xout)},0,1)`;
    const [ux, uy] = PUSH_DIR[tr.tout];
    if (ux) xs.push(`${-ux * W}*${eio(p)}`);
    if (uy) ys.push(`${-uy * H}*${eio(p)}`);
  }
  return { x: xs.length ? xs.join('+') : '0', y: ys.length ? ys.join('+') : '0' };
}

/** Timeline span where a clip is on screen, including dissolve handles. */
export function clipWindow(c, tr) {
  return { s: c.start - (tr?.xin || 0) / 2, e: c.start + c.duration + (tr?.xout || 0) / 2 };
}

// ---------- keyframes ----------
// Easing curves. render.js has the same curves as ffmpeg expressions (EASE_EXPR): keep them in step.
export function ease(name, p) {
  switch (name) {
    case 'linear': return p;
    case 'in': return p * p * p;
    case 'out': return 1 - (1 - p) ** 3;
    case 'hold': return 0;
    case 'smooth': return (1 - Math.cos(Math.PI * p)) / 2;
    case 'back': return 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
    case 'elastic': return p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((10 * p - 0.75) * 2.0943951) + 1;
    case 'bounce': {
      const n = 7.5625;
      if (p < 1 / 2.75) return n * p * p;
      if (p < 2 / 2.75) { const q = p - 1.5 / 2.75; return n * q * q + 0.75; }
      if (p < 2.5 / 2.75) { const q = p - 2.25 / 2.75; return n * q * q + 0.9375; }
      const q = p - 2.625 / 2.75;
      return n * q * q + 0.984375;
    }
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

// ---------- color grading, vignette, masks, keying, pan ----------
// Order of the picture effects, the same in the preview (CSS + one SVG filter)
// and the export (ffmpeg): chroma key → brightness/contrast → saturation →
// colorMatrix (white balance, hue, sepia) → gamma → vignette → blur → crop →
// mask → opacity → blend mode.
const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

/**
 * 3x3 matrix (rows r, g, b; 0..1 values in, 0..1 out) for temperature, tint, hue
 * and sepia, or null when they are all neutral. Hue and sepia are the CSS
 * hue-rotate() / sepia() matrices.
 */
export function colorMatrix(c) {
  const T = c.temperature || 0;
  const G = c.tint || 0;
  const hue = c.hue || 0;
  const sp = c.sepia || 0;
  if (!T && !G && !hue && !sp) return null;
  // white balance as channel gains, normalised so a mid grey keeps its brightness
  let r = 1 + 0.3 * T;
  let g = 1 - 0.25 * G;
  let b = 1 - 0.3 * T;
  const k = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
  r *= k; g *= k; b *= k;
  let m = [[r, 0, 0], [0, g, 0], [0, 0, b]];
  if (hue) {
    const a = (hue * Math.PI) / 180;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    m = mul3([
      [0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928],
      [0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283],
      [0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072],
    ], m);
  }
  if (sp) {
    const q = 1 - sp;
    m = mul3([
      [0.393 + 0.607 * q, 0.769 - 0.769 * q, 0.189 - 0.189 * q],
      [0.349 - 0.349 * q, 0.686 + 0.314 * q, 0.168 - 0.168 * q],
      [0.272 - 0.272 * q, 0.534 - 0.534 * q, 0.131 + 0.869 * q],
    ], m);
  }
  return m;
}

/** True when the clip needs the extra color stage (matrix, gamma or vignette). */
export const hasGrade = (c) => !!colorMatrix(c) || (c.gamma ?? 1) !== 1 || (c.vignette || 0) > 0;

const smooth01 = (t) => t * t * (3 - 2 * t);

/**
 * Vignette as a multiplier map, 0..255 per pixel (255 = untouched), w x h.
 * Depends only on the position in the frame, so any resolution gives the same look.
 */
export function vignetteMap(w, h, amount) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = ((y + 0.5) / h) * 2 - 1;
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const t = clamp((Math.sqrt(nx * nx + ny * ny) / Math.SQRT2 - 0.45) / 0.55, 0, 1);
      out[y * w + x] = Math.round(255 * (1 - amount * smooth01(t)));
    }
  }
  return out;
}

export const maskOf = (c) => (c.mask && typeof c.mask === 'object' ? { ...MASK_DEFAULTS, ...c.mask } : null);

/**
 * Alpha of a clip mask (0..255) for a clip box of w x h px, inside a frame padded
 * by `pad` px on every side (the padding is 0: a mask also clips blur overflow).
 * Position and size are percent of the box; feather is percent of its shorter side.
 */
export function maskMap(w, h, mask, pad = 0) {
  const m = { ...MASK_DEFAULTS, ...mask };
  const FW = w + 2 * pad;
  const out = new Uint8Array(FW * (h + 2 * pad));
  const cx = (m.x / 100) * w;
  const cy = (m.y / 100) * h;
  const rx = Math.max(0.5, (m.w / 200) * w);
  const ry = Math.max(0.5, (m.h / 200) * h);
  const f = (m.feather / 100) * Math.min(w, h);
  const soft = Math.max(1, f);
  const rmin = Math.min(rx, ry);
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - cx;
      let d;
      if (m.shape === 'rect') {
        const dx = Math.abs(px) - rx;
        const dy = Math.abs(py) - ry;
        d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
      } else d = (Math.hypot(px / rx, py / ry) - 1) * rmin;
      let t = clamp(0.5 - d / soft, 0, 1);
      if (f > 1) t = smooth01(t);
      if (m.invert) t = 1 - t;
      out[(y + pad) * FW + x + pad] = Math.round(t * 255);
    }
  }
  return out;
}

export const keyOf = (c) => (c.key && typeof c.key === 'object' ? { ...KEY_DEFAULTS, ...c.key } : null);

/** Which channel a key color spills into: 'green', 'blue' or null (no despill). */
export function spillType(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (g >= r && g >= b && g > 64) return 'green';
  if (b > r && b > g && b > 64) return 'blue';
  return null;
}

/**
 * Stereo pan as a 2x2 mix (equal power, like the Web Audio StereoPannerNode on a
 * stereo input): outL = ll*L + lr*R, outR = rl*L + rr*R.
 */
export function panGains(pan) {
  const p = clamp(pan || 0, -1, 1);
  if (p <= 0) { const x = ((p + 1) * Math.PI) / 2; return { ll: 1, lr: Math.cos(x), rl: 0, rr: Math.sin(x) }; }
  const x = (p * Math.PI) / 2;
  return { ll: Math.cos(x), lr: 0, rl: Math.sin(x), rr: 1 };
}

/** Largest blur the clip reaches (export pads the frame for it once). */
export function maxBlur(c) {
  return Math.max(c.blur || 0, ...(c.keys?.blur || []).map((x) => x[1]));
}

/** ids plus the ids of every clip linked to them (same `link` value). */
export function withLinked(p, ids) {
  const out = new Set(ids);
  const links = new Set(p.clips.filter((c) => out.has(c.id) && c.link).map((c) => c.link));
  if (links.size) for (const c of p.clips) if (c.link && links.has(c.link)) out.add(c.id);
  return out;
}

/** Tracks whose sound plays: when any track is soloed, only soloed tracks. */
export function audibleTrack(p, t) {
  if (!t || t.muted) return false;
  return !(p.tracks || []).some((x) => x.solo) || !!t.solo;
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
