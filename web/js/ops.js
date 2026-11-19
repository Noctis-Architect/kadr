// Editing operations on the project (pure-ish: they take the project object).
import { uid, clipEnd, trackKindFor, mediaKind, CLIP_DEFAULTS, valueAt, isAnimated, shiftKeys, r3, projectDuration } from '/shared/model.js';
import { S, commit, select, snapFrame, toast, seek, setInOut } from './state.js';
import { api } from './util.js';

const EPS = 1e-4;
export const clipById = (id) => S.project.clips.find((c) => c.id === id);
export const trackById = (id) => S.project.tracks.find((t) => t.id === id);
export const isLocked = (c) => !!trackById(c.track)?.locked;
const ids = (p) => new Set(p.clips.map((c) => c.id));

/** Change speed but keep the same piece of source: the clip gets longer/shorter (and stops at the next clip). */
export function setSpeed(c, speed) {
  speed = Math.min(16, Math.max(0.1, speed));
  const span = c.duration * (c.speed || 1);
  let d = span / speed;
  const next = Math.min(Infinity, ...S.project.clips.filter((x) => x.track === c.track && x.id !== c.id && x.start >= clipEnd(c) - 1e-4).map((x) => x.start));
  if (c.start + d > next) d = next - c.start;
  shiftKeys(c, 0, (c.speed || 1) / speed);
  c.speed = Math.round(speed * 1000) / 1000;
  c.duration = Math.max(1 / S.project.fps, d);
}

// ---------- keyframes ----------
const HALF_FRAME = () => 0.5 / S.project.fps;
/** Clip-local time of the playhead, clamped into the clip. */
export const localT = (c, t = S.t) => r3(Math.min(c.duration, Math.max(0, snapFrame(t) - c.start)));
export const getProp = (c, k) => valueAt(c, k, S.t);
export function keyAt(c, k, t = S.t) {
  const u = localT(c, t);
  return (c.keys?.[k] || []).findIndex((x) => Math.abs(x[0] - u) < HALF_FRAME());
}
/** Set a property: on an animated property this adds / updates the keyframe at the playhead. */
export function setProp(c, k, v) {
  if (!isAnimated(c, k)) { c[k] = v; return; }
  const i = keyAt(c, k);
  const list = [...c.keys[k]];
  if (i >= 0) list[i] = [list[i][0], v, ...list[i].slice(2)];
  else list.push([localT(c), v]);
  list.sort((a, b) => a[0] - b[0]);
  c.keys = { ...c.keys, [k]: list };
}
/** The diamond button: start animating, add a key here, or remove the key here. */
export function toggleKey(c, k) {
  const v = getProp(c, k);
  if (!isAnimated(c, k)) { c.keys = { ...(c.keys || {}), [k]: [[localT(c), v]] }; return; }
  const i = keyAt(c, k);
  if (i < 0) return setProp(c, k, v);
  const list = c.keys[k].filter((_, j) => j !== i);
  const keys = { ...c.keys };
  if (list.length) keys[k] = list;
  else { delete keys[k]; c[k] = v; }
  if (Object.keys(keys).length) c.keys = keys; else delete c.keys;
}
/** Stop animating k: keep the value it has at the playhead. */
export function clearKeys(c, k) {
  const v = getProp(c, k);
  const keys = { ...c.keys };
  delete keys[k];
  c[k] = v;
  if (Object.keys(keys).length) c.keys = keys; else delete c.keys;
}
/** Ease of the key at (or just before) the playhead, for all animated props of the clip. */
export function setEaseHere(c, e) {
  const u = localT(c);
  for (const k of Object.keys(c.keys || {})) {
    const list = c.keys[k].map((x) => [...x]);
    let i = -1;
    for (let j = 0; j < list.length; j++) if (list[j][0] <= u + HALF_FRAME()) i = j;
    if (i < 0) continue;
    if (e === 'ease') list[i].length = 2; else list[i][2] = e;
    c.keys = { ...c.keys, [k]: list };
  }
}
/** Sorted unique keyframe times of a clip (clip-local seconds). */
export function keyTimes(c) {
  const set = new Set();
  for (const list of Object.values(c.keys || {})) for (const x of list) set.add(r3(x[0]));
  return [...set].sort((a, b) => a - b);
}
export function jumpKey(dir) {
  const c = S.sel.size === 1 ? clipById([...S.sel][0]) : null;
  if (!c?.keys) return toast('Select a clip with keyframes');
  const u = S.t - c.start;
  const ts = keyTimes(c);
  const t = dir < 0 ? [...ts].reverse().find((x) => x < u - HALF_FRAME()) : ts.find((x) => x > u + HALF_FRAME());
  if (t != null) seek(c.start + t);
}

export function mediaDuration(c) {
  if (c.type !== 'video' && c.type !== 'audio') return Infinity;
  return S.media.get(c.src)?.duration || Infinity;
}

/** A fresh link id for each old one (copies of linked clips stay linked among themselves). */
export function linkMapper(p) {
  const taken = new Set(p.clips.map((c) => c.link).filter(Boolean));
  const m = new Map();
  return (old) => {
    if (!old) return undefined;
    if (!m.has(old)) { const n = uid('L', taken); taken.add(n); m.set(old, n); }
    return m.get(old);
  };
}

/**
 * Split clip c at time t. Returns the new right-hand clip, or null.
 * relink: a linkMapper(), so the right halves of linked clips form their own group.
 */
export function splitClip(p, c, t, relink = null) {
  const f = 1 / p.fps;
  if (t <= c.start + f / 2 || t >= clipEnd(c) - f / 2) return null;
  const right = structuredClone(c);
  right.id = uid('c', ids(p));
  if (relink && c.link) right.link = relink(c.link);
  right.start = t;
  right.in = c.in + (t - c.start) * (c.speed || 1);
  right.duration = clipEnd(c) - t;
  right.fadeIn = 0;
  right.xfade = 0;
  shiftKeys(right, -(t - c.start));
  c.duration = t - c.start;
  c.fadeOut = 0;
  p.clips.push(right);
  return right;
}

/** Overwrite edit: make room for [s, e) on a track by trimming / splitting / removing other clips. */
export function clearRange(p, trackId, s, e, keep = new Set()) {
  for (const o of [...p.clips]) {
    if (o.track !== trackId || keep.has(o.id)) continue;
    const os = o.start;
    const oe = clipEnd(o);
    if (oe <= s + EPS || os >= e - EPS) continue;
    if (os >= s - EPS && oe <= e + EPS) {
      p.clips.splice(p.clips.indexOf(o), 1);
    } else if (os < s && oe > e) {
      const r = splitClip(p, o, e);
      o.duration = s - os;
      if (r) keep.add(r.id);
    } else if (os < s) {
      o.duration = s - os;
      o.fadeOut = Math.min(o.fadeOut, o.duration);
    } else {
      o.in += (e - os) * (o.speed || 1);
      shiftKeys(o, -(e - os));
      o.duration = oe - e;
      o.start = e;
      o.fadeIn = Math.min(o.fadeIn, o.duration);
    }
  }
}

export function splitAtPlayhead() {
  splitClipsAt(snapFrame(S.t), S.sel.size ? [...S.sel] : null);
}

/** Split the clips under time t (only `only` ids if given, plus their linked partners). */
export function splitClipsAt(t, only = null) {
  const want = only ? new Set(only) : null;
  if (want) for (const c of S.project.clips) if (c.link && S.project.clips.some((x) => want.has(x.id) && x.link === c.link)) want.add(c.id);
  const targets = S.project.clips.filter((c) => t > c.start && t < clipEnd(c) && !isLocked(c) && (!want || want.has(c.id)));
  if (!targets.length) return toast('Nothing under the playhead to split');
  const newIds = [];
  commit((p) => {
    const relink = linkMapper(p);
    for (const c of targets) {
      const r = splitClip(p, p.clips.find((x) => x.id === c.id), t, relink);
      if (r) newIds.push(r.id);
    }
  });
  if (only && newIds.length) select(newIds);
}

export function deleteSelected({ ripple = false } = {}) {
  if (S.marker) {
    const id = S.marker;
    commit((p) => { p.markers = p.markers.filter((m) => m.id !== id); });
    S.marker = null;
    select([]);
    return;
  }
  if (!S.sel.size) return;
  const gone = new Set(S.sel);
  commit((p) => {
    const removed = p.clips.filter((c) => gone.has(c.id));
    p.clips = p.clips.filter((c) => !gone.has(c.id));
    if (ripple) {
      for (const r of removed.sort((a, b) => b.start - a.start)) {
        for (const c of p.clips) if (c.track === r.track && c.start >= clipEnd(r) - EPS) c.start = Math.max(0, c.start - r.duration);
      }
    }
  });
  select([]);
}

export function duplicateSelected() {
  if (!S.sel.size) return;
  const newIds = [];
  commit((p) => {
    const src = p.clips.filter((c) => S.sel.has(c.id));
    const end = Math.max(...src.map(clipEnd));
    const start = Math.min(...src.map((c) => c.start));
    const relink = linkMapper(p);
    for (const c of src) {
      const d = structuredClone(c);
      d.id = uid('c', ids(p));
      if (d.link) d.link = relink(c.link);
      d.start = c.start + (end - start);
      clearRange(p, d.track, d.start, clipEnd(d));
      p.clips.push(d);
      newIds.push(d.id);
    }
  });
  select(newIds);
}

export function detachAudio(c) {
  const p = S.project;
  let a = p.tracks.find((t) => t.kind === 'audio');
  commit((pp) => {
    if (!a) { a = { id: nextTrackId(pp, 'audio'), kind: 'audio' }; pp.tracks.push(a); }
    const v = pp.clips.find((x) => x.id === c.id);
    const clip = { ...CLIP_DEFAULTS, id: uid('c', ids(pp)), track: a.id, type: 'audio', src: v.src, start: v.start, duration: v.duration, in: v.in, speed: v.speed || 1, volume: v.volume || 1, pan: v.pan || 0, fadeIn: v.fadeIn, fadeOut: v.fadeOut };
    // the two stay linked (move and trim together) until you unlink them
    v.link ||= uid('L', new Set(pp.clips.map((x) => x.link).filter(Boolean)));
    clip.link = v.link;
    clearRange(pp, a.id, clip.start, clipEnd(clip));
    pp.clips.push(clip);
    v.volume = 0;
  });
  toast('Audio moved to its own linked clip; the video clip is muted');
}

export function nextTrackId(p, kind) {
  const pre = kind === 'audio' ? 'A' : 'V';
  let n = 1;
  while (p.tracks.some((t) => t.id === `${pre}${n}`)) n++;
  return `${pre}${n}`;
}

export function addTrack(kind) {
  commit((p) => {
    const t = { id: nextTrackId(p, kind), kind };
    if (kind === 'video') {
      const lastV = p.tracks.map((x) => x.kind).lastIndexOf('video');
      p.tracks.splice(lastV + 1, 0, t);
    } else p.tracks.push(t);
  });
}

export function removeTrack(id) {
  const n = S.project.clips.filter((c) => c.track === id).length;
  if (S.project.tracks.filter((t) => t.kind === trackById(id).kind).length < 2) return toast('Keep at least one track of each kind');
  if (n && !confirm(`Track ${id} has ${n} clip(s). Delete the track and its clips?`)) return;
  commit((p) => {
    p.tracks = p.tracks.filter((t) => t.id !== id);
    p.clips = p.clips.filter((c) => c.track !== id);
  });
}

function defaultTrack(kind, type, preferred) {
  const p = S.project;
  const pt = preferred && trackById(preferred);
  if (pt && pt.kind === kind) return pt.id;
  const list = p.tracks.filter((t) => t.kind === kind);
  if (!list.length) return null;
  if (kind === 'audio' || type === 'video') return list[0].id;
  return list[list.length - 1].id; // overlays go on the top video track
}

/** Add a clip for a media path (or @kadr/ built-in) at time t. */
export function addClip(src, t, { track, props } = {}) {
  const info = S.media.get(src) || S.templates.get(src);
  const type = src.startsWith('@kadr/') ? 'html' : info?.kind || mediaKind(src);
  if (!type) return toast(`Can't use ${src} as a clip`, true);
  const kind = trackKindFor(type);
  let tid = defaultTrack(kind, type, track);
  let duration = 5;
  if (type === 'video' || type === 'audio') duration = info?.duration || 5;
  if (type === 'html') duration = info?.duration || (src === '@kadr/text.html' ? 4 : 5);
  if (!track) {
    // No explicit target (double-click, + Text): never overwrite, find a free track.
    const s = snapFrame(Math.max(0, t));
    const free = (id) => !S.project.clips.some((c) => c.track === id && c.start < s + duration - 1e-4 && clipEnd(c) > s + 1e-4);
    const cands = S.project.tracks.filter((x) => x.kind === kind);
    const order = kind === 'video' && type !== 'video' ? [...cands].reverse() : cands;
    tid = order.find((x) => free(x.id))?.id ?? null; // null: a new track is created on top
  }
  const id = uid('c', ids(S.project));
  commit((p) => {
    if (!tid) {
      tid = nextTrackId(p, kind);
      const lastV = p.tracks.map((x) => x.kind).lastIndexOf('video');
      if (kind === 'video') p.tracks.splice(lastV + 1, 0, { id: tid, kind });
      else p.tracks.push({ id: tid, kind });
    }
    const c = { ...CLIP_DEFAULTS, id, track: tid, type, src, start: snapFrame(Math.max(0, t)), duration };
    if (props) c.props = props;
    clearRange(p, tid, c.start, clipEnd(c));
    p.clips.push(c);
  });
  select([id]);
  return id;
}

export function addMarker(t) {
  const id = uid('m', new Set(S.project.markers.map((m) => m.id)));
  commit((p) => p.markers.push({ id, t: snapFrame(t), note: '' }));
  return id;
}

// ---------- clipboard, nudge, ripple trims ----------
let clipboard = null;
export function copySelected(cut = false) {
  const src = S.project.clips.filter((c) => S.sel.has(c.id));
  if (!src.length) return;
  const t0 = Math.min(...src.map((c) => c.start));
  clipboard = src.map((c) => ({ ...structuredClone(c), start: c.start - t0 }));
  try { navigator.clipboard?.writeText(JSON.stringify(src)).catch(() => {}); } catch { /* not allowed */ }
  if (cut) deleteSelected();
  toast(`${cut ? 'Cut' : 'Copied'} ${src.length} clip${src.length > 1 ? 's' : ''}`);
}
export function paste(t = S.t) {
  if (!clipboard?.length) return toast('Nothing to paste');
  const at = snapFrame(t);
  const newIds = [];
  commit((p) => {
    const relink = linkMapper(p);
    for (const c of clipboard) {
      const d = structuredClone(c);
      d.id = uid('c', ids(p));
      if (d.link) d.link = relink(c.link);
      d.start = at + c.start;
      if (!p.tracks.some((x) => x.id === d.track && !x.locked)) d.track = p.tracks.find((x) => x.kind === trackKindFor(d.type) && !x.locked)?.id;
      if (!d.track) continue;
      clearRange(p, d.track, d.start, clipEnd(d));
      p.clips.push(d);
      newIds.push(d.id);
    }
  });
  select(newIds);
  if (newIds.length) seek(Math.max(...newIds.map((i) => clipEnd(clipById(i)))));
}

export function nudge(frames) {
  if (!S.sel.size) return;
  const dt = frames / S.project.fps;
  commit((p) => {
    const moving = p.clips.filter((c) => S.sel.has(c.id));
    const min = Math.min(...moving.map((c) => c.start));
    const d = Math.max(-min, dt);
    for (const c of moving) c.start = r3(c.start + d);
    for (const c of moving) clearRange(p, c.track, c.start, clipEnd(c), new Set(moving.map((m) => m.id)));
  });
}

/** Q / W: cut the clip under the playhead from its head (or to its tail) and close the gap. */
export function rippleTrim(side) {
  const t = snapFrame(S.t);
  const hits = S.project.clips.filter((c) => !c.disabled && !isLocked(c) && t > c.start + 1e-4 && t < clipEnd(c) - 1e-4 && (!S.sel.size || S.sel.has(c.id)));
  if (!hits.length) return toast('Put the playhead over a clip');
  commit((p) => {
    for (const h0 of hits) {
      const c = p.clips.find((x) => x.id === h0.id);
      const end = clipEnd(c);
      const d = side === 'head' ? t - c.start : end - t;
      if (side === 'head') {
        c.in += d * (c.speed || 1);
        shiftKeys(c, -d);
        c.duration -= d;
      } else c.duration -= d;
      c.fadeIn = Math.min(c.fadeIn, c.duration);
      c.fadeOut = Math.min(c.fadeOut, c.duration);
      for (const o of p.clips) if (o.track === c.track && o.id !== c.id && o.start >= end - 1e-4) o.start = r3(o.start - d);
    }
  });
  if (side === 'head') seek(Math.min(...hits.map((c) => c.start)));
}

/** Gap under time t on a track: { s, e } or null. */
export function gapAt(trackId, t) {
  const list = S.project.clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start);
  let s = 0;
  for (const c of list) {
    if (t < c.start) return c.start - s > 1e-4 ? { s, e: c.start } : null;
    s = Math.max(s, clipEnd(c));
  }
  return null;
}
export function closeGap(trackId, t) {
  const g = gapAt(trackId, t);
  if (!g) return;
  commit((p) => { for (const c of p.clips) if (c.track === trackId && c.start >= g.e - 1e-4) c.start = r3(c.start - (g.e - g.s)); });
}

/** The clip that ends where c starts on the same track (a dissolve partner), or null. */
export function prevAdjacent(c) {
  const f = 0.5 / S.project.fps;
  return S.project.clips.find((x) => x.track === c.track && x.id !== c.id && !x.disabled && Math.abs(clipEnd(x) - c.start) < f) || null;
}
export function addDissolve(c, d = 0.5) {
  if (!prevAdjacent(c)) return toast('A dissolve needs a clip that ends exactly where this one starts');
  commit(() => { c.xfade = d; });
}
export function dipToColor(c, d = 0.5) {
  const prev = prevAdjacent(c);
  commit(() => {
    c.xfade = 0;
    c.fadeIn = Math.min(c.duration, d / 2);
    if (prev) prev.fadeOut = Math.min(prev.duration, d / 2);
  });
}

// ---------- media-producing edits (server does the ffmpeg work) ----------
/** Freeze the frame under the playhead: split, insert a still, push the rest later. */
export async function freezeFrame(c, hold = 2) {
  if (c.type !== 'video') return toast('Freeze frame works on video clips');
  const t = snapFrame(S.t);
  if (t < c.start || t >= clipEnd(c)) return toast('Put the playhead over the clip');
  toast('Grabbing the frame…');
  let r;
  try { r = await api('/api/freeze', { src: c.src, t: Math.max(0, c.in + (t - c.start) * (c.speed || 1)) }); } catch (e) { return toast(e.message, true); }
  await new Promise((res) => setTimeout(res, 50));
  const id = uid('c', ids(S.project));
  commit((p) => {
    const cc = p.clips.find((x) => x.id === c.id);
    for (const o of p.clips) if (o.track === cc.track && o.id !== cc.id && o.start >= t - 1e-4) o.start = r3(o.start + hold);
    if (t > cc.start + 1e-4) {
      const right = splitClip(p, cc, t);
      if (right) right.start = r3(right.start + hold);
    } else cc.start = r3(cc.start + hold);
    const still = { ...CLIP_DEFAULTS, ...pick(cc, ['fit', 'x', 'y', 'scale', 'rotation', 'flipH', 'flipV', 'cropT', 'cropR', 'cropB', 'cropL', 'brightness', 'contrast', 'saturation', 'opacity']) };
    p.clips.push({ ...still, id, track: cc.track, type: 'image', src: r.path, start: t, duration: hold });
  });
  select([id]);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export async function reverseClip(c) {
  if (c.type !== 'video' && c.type !== 'audio') return toast('Reverse works on video and audio clips');
  toast('Reversing… (runs in the background)');
  let r;
  try { r = await api('/api/reverse', { src: c.src, in: c.in, span: c.duration * (c.speed || 1) }); } catch (e) { return toast(e.message, true); }
  commit((p) => {
    const cc = p.clips.find((x) => x.id === c.id);
    if (!cc) return;
    cc.src = r.path;
    cc.in = 0;
    if (cc.keys) {
      for (const k of Object.keys(cc.keys)) cc.keys[k] = cc.keys[k].map((x) => [r3(cc.duration - x[0]), ...x.slice(1)]).sort((a, b) => a[0] - b[0]);
    }
  });
  toast('Reversed. Undo brings the original back.');
}

export function renameTrack(id, name) {
  commit(() => { const t = trackById(id); if (name) t.name = name; else delete t.name; });
}

// ---------- linking (Premiere's linked clips / grouping) ----------
export function linkClips(idList) {
  const list = idList.map(clipById).filter(Boolean);
  if (list.length < 2) return toast('Select two or more clips to link');
  const link = uid('L', new Set(S.project.clips.map((c) => c.link).filter(Boolean)));
  commit((p) => { for (const c of p.clips) if (idList.includes(c.id)) c.link = link; });
  toast(`Linked ${list.length} clips: they move, trim and delete together`);
}
export function unlinkClips(idList) {
  const links = new Set(idList.map(clipById).filter(Boolean).map((c) => c.link).filter(Boolean));
  if (!links.size) return toast('Those clips are not linked');
  commit((p) => { for (const c of p.clips) if (links.has(c.link)) delete c.link; });
  toast('Unlinked');
}

// ---------- three-point editing ----------
/** Lift (leave a gap) or extract (close it) the marked in → out range on every unlocked track. */
export function liftExtract(extract) {
  if (S.inPt == null && S.outPt == null) return toast('Mark an in and an out point first (I and O)');
  const a = S.inPt ?? 0;
  const b = S.outPt ?? projectDuration(S.project);
  if (!(b - a > 1e-4)) return;
  commit((p) => {
    for (const t of p.tracks) {
      if (t.locked) continue;
      clearRange(p, t.id, a, b);
      if (extract) for (const c of p.clips) if (c.track === t.id && c.start >= b - EPS) c.start = r3(c.start - (b - a));
    }
    if (extract) {
      p.markers = p.markers.filter((m) => m.t < a || m.t >= b);
      for (const m of p.markers) if (m.t >= b) m.t = r3(m.t - (b - a));
    }
  });
  setInOut(null, null);
  seek(a);
  toast(extract ? 'Extracted the in → out range and closed the gap' : 'Lifted the in → out range (the gap stays)');
}

/** Insert (push everything later) or overwrite a media file at the playhead. */
export function insertMedia(src, { overwrite = false } = {}) {
  const info = S.media.get(src) || S.templates.get(src);
  const type = src.startsWith('@kadr/') ? 'html' : info?.kind || mediaKind(src);
  if (!type) return toast(`Can't use ${src} as a clip`, true);
  const kind = trackKindFor(type);
  let d = 5;
  if (type === 'video' || type === 'audio') d = info?.duration || 5;
  if (type === 'html') d = info?.duration || 5;
  const t = snapFrame(S.t);
  const selTrack = [...S.sel].map(clipById).find((c) => c && trackKindFor(c.type) === kind && !isLocked(c))?.track;
  const tid = selTrack || S.project.tracks.find((x) => x.kind === kind && !x.locked)?.id;
  if (!tid) return toast(`No unlocked ${kind} track`);
  const id = uid('c', ids(S.project));
  commit((p) => {
    if (!overwrite) {
      const relink = linkMapper(p);
      for (const tr of p.tracks) {
        if (tr.locked) continue;
        for (const c of [...p.clips]) if (c.track === tr.id && t > c.start + EPS && t < clipEnd(c) - EPS) splitClip(p, c, t, relink);
        for (const c of p.clips) if (c.track === tr.id && c.start >= t - EPS) c.start = r3(c.start + d);
      }
      for (const m of p.markers) if (m.t >= t) m.t = r3(m.t + d);
    }
    clearRange(p, tid, t, t + d);
    p.clips.push({ ...CLIP_DEFAULTS, id, track: tid, type, src, start: t, duration: d });
  });
  select([id]);
  seek(t + d);
  toast(overwrite ? 'Overwrote at the playhead' : 'Inserted at the playhead; later clips moved over');
}

/** Pack every clip on a track back to back from 0 (removes all gaps). */
export function closeAllGaps(trackId) {
  commit((p) => {
    let at = 0;
    for (const c of p.clips.filter((x) => x.track === trackId).sort((a, b) => a.start - b.start)) {
      if (c.start > at + EPS) c.start = r3(at);
      at = Math.max(at, clipEnd(c));
    }
  });
}

// ---------- analysis-driven edits ----------
export async function stabilizeClip(c) {
  if (c.type !== 'video') return toast('Stabilize works on video clips');
  toast('Stabilizing… (runs in the background; a minute or two for long clips)');
  let r;
  try { r = await api('/api/stabilize', { src: c.src, in: c.in, span: c.duration * (c.speed || 1) }); } catch (e) { return toast(e.message, true); }
  commit((p) => {
    const x = p.clips.find((k) => k.id === c.id);
    if (!x) return;
    x.src = r.path;
    x.in = 0;
  });
  toast('Stabilized. Undo brings the original back.');
}

/** Split a video clip wherever the shot changes (scene edit detection). */
export async function detectScenes(c, threshold = 0.3) {
  if (c.type !== 'video') return toast('Scene detection works on video clips');
  toast('Looking for shot changes…');
  let r;
  try { r = await api('/api/scenes', { src: c.src, threshold }); } catch (e) { return toast(e.message, true); }
  const sp = c.speed || 1;
  const f = 1 / S.project.fps;
  const times = (r.cuts || []).map((x) => snapFrame(c.start + (x.t - (c.in || 0)) / sp)).filter((t) => t > c.start + f && t < clipEnd(c) - f);
  if (!times.length) return toast('No shot changes found in this clip');
  // the clip and its linked partners (their pieces after each cut are on the same tracks)
  const tracks = new Set(S.project.clips.filter((x) => x.id === c.id || (c.link && x.link === c.link)).map((x) => x.track));
  commit((p) => {
    const relink = linkMapper(p);
    for (const t of times.sort((a, b) => a - b)) {
      for (const x of [...p.clips]) if (tracks.has(x.track) && x.src === c.src && t > x.start + EPS && t < clipEnd(x) - EPS) splitClip(p, x, t, relink);
    }
  });
  toast(`Cut at ${times.length} shot change${times.length > 1 ? 's' : ''}`);
}

/** Remove the silent parts of a clip and close the gaps (jump cuts), with a little padding. */
export async function removeSilences(c, { noise = -35, min = 0.5, pad = 0.08 } = {}) {
  if (c.type !== 'video' && c.type !== 'audio') return toast('Silence removal works on clips with sound');
  toast('Finding the quiet parts…');
  let r;
  try { r = await api('/api/silence', { src: c.src, noise, min }); } catch (e) { return toast(e.message, true); }
  const sp = c.speed || 1;
  const s0 = c.start;
  const e0 = clipEnd(c);
  const ranges = (r.silences || [])
    .map((x) => [s0 + (x.start + pad - (c.in || 0)) / sp, s0 + (x.end - pad - (c.in || 0)) / sp])
    .map(([a, b]) => [snapFrame(Math.max(s0, a)), snapFrame(Math.min(e0, b))])
    .filter(([a, b]) => b - a > 2 / S.project.fps);
  if (!ranges.length) return toast('No silences long enough to cut');
  const group = new Set(S.project.clips.filter((x) => x.id === c.id || (c.link && x.link === c.link)).map((x) => x.id));
  const tracks = new Set([...group].map((id) => clipById(id).track));
  let removed = 0;
  commit((p) => {
    // from the end backwards, so earlier times stay valid
    for (const [a, b] of ranges.sort((x, y) => y[0] - x[0])) {
      for (const tid of tracks) {
        if (p.tracks.find((t) => t.id === tid)?.locked) continue;
        clearRange(p, tid, a, b);
        for (const x of p.clips) if (x.track === tid && x.start >= b - EPS) x.start = r3(x.start - (b - a));
      }
      removed += b - a;
    }
  });
  toast(`Removed ${ranges.length} silent part${ranges.length > 1 ? 's' : ''} (${removed.toFixed(1)} s)`);
}
