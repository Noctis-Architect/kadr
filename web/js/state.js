import { normalizeProject, compactProject, projectDuration, clamp, withLinked } from '/shared/model.js';

export const TOKEN = document.querySelector('meta[name="kadr-token"]')?.content || '';
export const authHeaders = (extra = {}) => ({ 'x-kadr-token': TOKEN, ...extra });

export const S = {
  project: null,
  errors: [],
  warnings: [],
  root: '',
  media: new Map(), // path -> probe info
  templates: new Map(), // @kadr/x.html -> info (built-in compositions)
  t: 0,
  playing: false,
  sel: new Set(), // clip ids
  marker: null, // selected marker id
  part: null, // { clip, key }: a part of a composition clip (parts.js)
  tool: 'select',
  snap: true,
  linked: true, // selecting a clip selects the clips linked to it
  rate: 1, // playback rate (J / L shuttle: -8..8)
  binSel: null, // media path picked in the Media panel (insert / overwrite with , and .)
  pps: 80, // timeline pixels per second
  inPt: null,
  outPt: null,
  loop: false,
  compErrors: new Map(), // comp path -> last error
  clientId: Math.random().toString(36).slice(2, 10),
};

const subs = new Map();
export function on(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
}
export function emit(evt, arg) {
  for (const fn of subs.get(evt) || []) fn(arg);
}

// ---------- history + persistence ----------
const H = { stack: [], i: -1 };
let saveTimer = 0;

function snapshot() {
  const s = JSON.stringify(compactProject(S.project));
  if (H.stack[H.i] === s) return false;
  H.stack.length = H.i + 1;
  H.stack.push(s);
  if (H.stack.length > 300) H.stack.shift();
  H.i = H.stack.length - 1;
  emit('history');
  return true;
}

export const canUndo = () => H.i > 0;
export const canRedo = () => H.i < H.stack.length - 1;

/** Mutate the project, record an undo step and save. */
export function commit(fn) {
  if (fn) fn(S.project);
  if (snapshot()) scheduleSave();
  emit('project');
}

/** Mutate without an undo step (during drags). Call commit() at the end. */
export function live(fn) {
  fn(S.project);
  emit('project', { live: true });
}

function restore(i) {
  H.i = i;
  S.project = normalizeProject(JSON.parse(H.stack[i]));
  pruneSelection();
  scheduleSave();
  emit('history');
  emit('project');
  emit('select');
  publishState();
}
export function undo() { if (canUndo()) restore(H.i - 1); }
export function redo() { if (canRedo()) restore(H.i + 1); }

export function loadProject(raw, { external = false } = {}) {
  if (external) clearTimeout(saveTimer); // the file on disk wins over a pending UI save
  S.project = normalizeProject(raw);
  pruneSelection();
  snapshot();
  emit('project');
  emit('select');
  publishState();
}

function pruneSelection() {
  const ids = new Set(S.project.clips.map((c) => c.id));
  for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
  if (S.marker && !S.project.markers.some((m) => m.id === S.marker)) S.marker = null;
}

export function setStatus(kind, text) { emit('status', { kind, text }); }

function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus('pending', 'saving…');
  saveTimer = setTimeout(save, 220);
}

/** Send a pending save right now (page is closing / reloading). */
export function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  fetch('/api/project', {
    method: 'PUT',
    keepalive: true,
    headers: authHeaders({ 'content-type': 'application/json', 'x-kadr-client': S.clientId }),
    body: JSON.stringify(compactProject(S.project)),
  }).catch(() => {});
}

async function save() {
  saveTimer = 0;
  try {
    const r = await fetch('/api/project', {
      method: 'PUT',
      headers: authHeaders({ 'content-type': 'application/json', 'x-kadr-client': S.clientId }),
      body: JSON.stringify(compactProject(S.project)),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.errors ? j.errors.join('\n') : j.error);
    setStatus('saved', 'saved');
  } catch (e) {
    setStatus('error', 'not saved');
    emit('toast', { text: `Could not save: ${e.message}`, err: true });
  }
}

// ---------- editor state file for agents (.kadr/state.json) ----------
let stateTimer = 0;
export function publishState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    if (!S.project) return;
    const p = S.project;
    const body = {
      updated: new Date().toISOString(),
      playhead: Math.round(S.t * 1000) / 1000,
      selection: [...S.sel],
      selectedClips: p.clips.filter((c) => S.sel.has(c.id)).map((c) => ({ id: c.id, track: c.track, type: c.type, src: c.src, start: Math.round(c.start * 1000) / 1000, end: Math.round((c.start + c.duration) * 1000) / 1000 })),
      marker: S.marker ? p.markers.find((m) => m.id === S.marker) || null : null,
      // a part of a composition clip picked on the timeline (an element in its .html)
      part: S.part ? { clip: S.part.clip, src: p.clips.find((c) => c.id === S.part.clip)?.src, key: S.part.key } : null,
      in: S.inPt,
      out: S.outPt,
      clipsUnderPlayhead: p.clips.filter((c) => S.t >= c.start && S.t < c.start + c.duration).map((c) => c.id),
    };
    fetch('/api/state', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }).catch(() => {});
  }, 400);
}

// ---------- clock ----------
let raf = 0;
let t0 = 0;
let p0 = 0;

export const duration = () => (S.project ? projectDuration(S.project) : 0);
export const fps = () => S.project?.fps || 30;
export const snapFrame = (t) => Math.round(t * fps()) / fps();
const playEnd = () => (S.outPt != null && S.t < S.outPt ? S.outPt : duration());
const playStart = () => (S.inPt != null ? S.inPt : 0);

export function play(rate = 1) {
  if (!S.project) return;
  if (S.playing) {
    // change speed / direction without stopping (J K L shuttle)
    if (rate === S.rate) return;
    t0 = S.t;
    p0 = performance.now();
    S.rate = rate;
    emit('play');
    return;
  }
  S.rate = rate;
  if (rate > 0) {
    const end = playEnd();
    if (S.t >= end - 1e-3) S.t = playStart();
    if (!(end > S.t)) return;
  } else if (S.t <= 1e-3) return;
  S.playing = true;
  t0 = S.t;
  p0 = performance.now();
  document.body.classList.add('playing');
  emit('play');
  raf = requestAnimationFrame(tick);
}

/** J / L: play backwards / forwards; pressing again doubles the speed (up to 8x). */
export function shuttle(dir) {
  if (!S.playing || Math.sign(S.rate) !== dir) return play(dir);
  play(dir * Math.min(8, Math.abs(S.rate) * 2));
}

function tick() {
  if (!S.playing) return;
  let t = t0 + (S.rate * (performance.now() - p0)) / 1000;
  if (S.rate < 0) {
    const st = S.inPt != null && t0 > S.inPt ? S.inPt : 0;
    if (t <= st) { S.t = st; pause(); return; }
    S.t = t;
    emit('time');
    raf = requestAnimationFrame(tick);
    return;
  }
  const end = playEnd();
  if (t >= end) {
    if (S.loop && end > playStart()) {
      t0 = playStart();
      p0 = performance.now();
      t = t0;
    } else {
      S.t = end;
      pause();
      return;
    }
  }
  S.t = t;
  emit('time');
  raf = requestAnimationFrame(tick);
}

export function pause() {
  if (!S.playing) return;
  S.playing = false;
  S.rate = 1;
  cancelAnimationFrame(raf);
  S.t = snapFrame(S.t);
  document.body.classList.remove('playing');
  emit('play');
  emit('time');
  publishState();
}

export const toggle = () => (S.playing ? pause() : play());

export function seek(t) {
  S.t = clamp(t, 0, Math.max(duration(), 0) + 600);
  if (S.playing) { t0 = S.t; p0 = performance.now(); }
  emit('time');
  if (!S.playing) publishState();
}

export function select(ids, { add = false, alone = false } = {}) {
  if (!add) S.sel.clear();
  const all = S.linked && !alone && S.project ? withLinked(S.project, ids) : ids;
  for (const id of all) S.sel.add(id);
  if (ids.length) S.marker = null;
  emit('select');
  publishState();
}

export function selectMarker(id) {
  S.sel.clear();
  S.marker = id;
  emit('select');
  publishState();
}

export function toast(text, err = false) { emit('toast', { text, err }); }

/** Mark in / out (undefined leaves one as it is, null clears it). */
export function setInOut(inPt, outPt) {
  if (inPt !== undefined) S.inPt = inPt;
  if (outPt !== undefined) S.outPt = outPt;
  if (S.inPt != null && S.outPt != null && S.outPt <= S.inPt) {
    if (inPt !== undefined) S.outPt = null; else S.inPt = null;
  }
  emit('inout');
  publishState();
}
