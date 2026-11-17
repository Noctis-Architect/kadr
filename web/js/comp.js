// Composition sources the editor has read: scanned model + parts, kept fresh when
// the file changes on disk (an agent edited it) and written back with minimal edits.
import { scanComp, partsOf, applyEdits } from '/shared/htmlsrc.js';
import { on, emit, toast, commit } from './state.js';
import { api } from './util.js';

const cache = new Map(); // src -> { source, hash, model, parts, readonly, undo: [] }
const loading = new Map();

function store(src, source, hash, readonly, undo = cache.get(src)?.undo || []) {
  const model = scanComp(source);
  const e = { src, source, hash, readonly, model, parts: partsOf(model, source), undo };
  cache.set(src, e);
  return e;
}

/** Cached entry, or null while it loads (emits 'comp' when ready). */
export function getComp(src) {
  if (cache.has(src)) return cache.get(src);
  if (!loading.has(src)) loading.set(src, load(src));
  return null;
}

async function load(src) {
  try {
    const r = await api(`/api/comp?src=${encodeURIComponent(src)}`);
    const old = cache.get(src);
    if (!old || old.hash !== r.hash) { store(src, r.source, r.hash, r.readonly); emit('comp', src); }
  } catch { /* missing file: the timeline shows the clip error already */ }
  loading.delete(src);
}

/** Write a new source for src (whole text). Returns true when saved. */
export async function writeComp(src, next, { undo = true } = {}) {
  const e = cache.get(src);
  if (!e || next === e.source) return false;
  if (e.readonly) { toast('Built-in templates are read-only: open the visual editor and make an editable copy', true); return false; }
  try {
    const r = await api('/api/comp', { src, hash: e.hash, source: next }, 'PUT');
    if (undo) { e.undo.push(e.source); if (e.undo.length > 100) e.undo.shift(); }
    store(src, next, r.hash, e.readonly, e.undo);
    emit('comp', src);
    return true;
  } catch (err) {
    toast(err.message, true);
    cache.delete(src);
    getComp(src);
    return false;
  }
}

/** Load (or reload) src now and return its entry. */
export async function fetchComp(src) {
  await load(src);
  return cache.get(src) || null;
}

/**
 * Edit a clip's composition. A built-in template can't change, so the first edit
 * makes an editable copy in comps/, points the clip at it and applies the edit
 * there (the copy is byte-identical, so the same ranges apply).
 */
export async function editClipComp(c, edits) {
  const e = cache.get(c.src);
  if (!e?.readonly) return editComp(c.src, edits);
  try {
    const r = await api('/api/comp/copy', { src: c.src });
    commit(() => { c.src = r.path; });
    toast(`Made an editable copy: ${r.path}`);
    await fetchComp(r.path);
    return editComp(r.path, edits);
  } catch (err) { toast(err.message, true); return false; }
}

export const editComp = (src, edits) => {
  const e = cache.get(src);
  if (!e) return Promise.resolve(false);
  const list = edits.filter(Boolean);
  return list.length ? writeComp(src, applyEdits(e.source, list)) : Promise.resolve(false);
};

export async function undoComp(src) {
  const e = cache.get(src);
  if (!e?.undo.length) return;
  const prev = e.undo.pop();
  await writeComp(src, prev, { undo: false });
}

// an agent (or the visual editor) saved the file: re-read it
on('asset', (path) => { if (cache.has(path)) { loading.set(path, load(path)); } });
