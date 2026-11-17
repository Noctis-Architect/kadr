import { validateProject } from '/shared/model.js';
import {
  S, on, emit, loadProject, undo, redo, canUndo, canRedo, toggle, seek, snapFrame, fps, duration,
  select, selectMarker, publishState, setStatus, pause, commit, flushSave,
} from './state.js';
import { $, h, api, basename } from './util.js';
import { resetLayers, reloadAsset } from './viewer.js';
import { render as renderTimeline, setZoom, zoomFit, setTool, toggleSnap } from './timeline.js';
import './inspector.js';
import { render as renderBin, importFiles, addText } from './bin.js';
import { openExport } from './exporter.js';
import { loadChat, focusChat } from './chat.js';
import { openProjects } from './projects.js';
import { openGallery } from './gallery.js';
import { ART } from './art.js';
import './compedit.js';
import { splitAtPlayhead, deleteSelected, duplicateSelected, addMarker, addTrack, copySelected, paste, nudge, rippleTrim, jumpKey, clipById, isLocked } from './ops.js';
import { toggleGuides } from './viewer.js';

// ---------- loading ----------
async function loadMedia() {
  const list = await api('/api/media');
  S.media = new Map(list.map((m) => [m.path, m]));
  emit('media');
}
on('media-refresh', async (cb) => { await loadMedia(); cb?.(); });

function showFatal(msg) {
  let el = $('#fatal');
  if (!el) { el = h('div.fatal#fatal'); document.body.append(el); }
  el.replaceChildren(h('div', {}, h('h2', {}, 'project.json can\'t be read'), h('div.err-text', {}, msg),
    h('p.hint', {}, 'Fix the file (or ask the agent that edited it to). The editor reloads it as soon as it is valid.')));
}
const hideFatal = () => $('#fatal')?.remove();

let lastSize = '';
function applyProject(raw, opts) {
  hideFatal();
  const v = validateProject(raw);
  S.errors = v.errors;
  S.warnings = v.warnings;
  loadProject(raw, opts);
  const size = `${S.project.width}x${S.project.height}`;
  if (size !== lastSize) { lastSize = size; resetLayers(); }
  $('#projName').textContent = S.project.name;
  document.title = `${S.project.name} · kadr`;
  drawPills();
}

async function loadTemplates() {
  try {
    const list = await api('/api/templates');
    S.templates = new Map(list.map((t) => [t.path, t]));
    emit('media');
  } catch { /* older server */ }
}

async function boot() {
  const [proj] = await Promise.all([api('/api/project'), loadMedia(), loadTemplates()]);
  loadChat();
  S.root = proj.root;
  if (proj.error) { showFatal(proj.error); return; }
  applyProject(proj.project);
  requestAnimationFrame(() => zoomFit());
  setStatus('saved', 'saved');
  connect();
}

// ---------- live updates from disk (agents) ----------
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'project') {
      if (m.origin === S.clientId) return;
      applyProject(m.project, { external: true });
      if (m.origin === 'disk') flashExternal('project.json changed on disk');
    } else if (m.type === 'project-error') {
      showFatal(m.error);
    } else if (m.type === 'reopen') {
      if (m.root !== S.root) { flushSave(); location.reload(); }
    } else if (m.type === 'asset') {
      reloadAsset(m.path);
      emit('asset', m.path);
      if (/\.html?$/.test(m.path)) { S.compErrors.delete(m.path); flashExternal(`${basename(m.path)} updated`); }
    } else if (m.type === 'media') {
      loadMedia();
    } else if (m.type === 'agent') {
      emit('agent', m);
    } else if (m.type === 'settings') {
      emit('settings', m);
    } else if (m.type === 'export') {
      emit('export', m);
    } else if (m.type === 'log') {
      const src = decodeURIComponent(m.src.replace(/^\/p\//, ''));
      S.compErrors.set(src, m.msg);
      drawPills();
      renderTimeline();
    } else if (m.type === 'activity') {
      activity.unshift(m);
      activity.length = Math.min(activity.length, 30);
    } else if (m.type === 'job') {
      jobs.set(m.label, m);
      if (m.state !== 'running') setTimeout(() => { jobs.delete(m.label); drawPills(); }, 2500);
      drawPills();
    }
  };
  es.onerror = () => setStatus('error', 'server offline');
  es.onopen = () => { setStatus('saved', 'saved'); loadChat(); };
}

const activity = [];
const jobs = new Map();
let extTimer = 0;
function flashExternal(text) {
  const el = $('#status');
  el.className = 'status external';
  el.replaceChildren(h('span.dot'), h('span.st-text', {}, text));
  clearTimeout(extTimer);
  extTimer = setTimeout(() => setStatus('saved', 'saved'), 2600);
}

on('status', ({ kind, text }) => {
  const el = $('#status');
  el.className = `status ${kind}`;
  el.replaceChildren(h('span.dot'), h('span.st-text', {}, kind === 'saved' ? '' : text));
  el.title = text;
});

// ---------- header ----------
function drawPills() {
  const pills = [];
  if (S.errors.length) pills.push(h('button.pill.err', { on: { click: (e) => showList(e, 'Errors in project.json', S.errors) } }, `${S.errors.length} error${S.errors.length > 1 ? 's' : ''}`));
  if (S.warnings.length) pills.push(h('button.pill.warn', { on: { click: (e) => showList(e, 'Warnings', S.warnings) } }, `${S.warnings.length} warning${S.warnings.length > 1 ? 's' : ''}`));
  if (S.compErrors.size) {
    pills.push(h('button.pill.err', { on: { click: (e) => showList(e, 'Composition errors (also in .kadr/logs/console.log)', [...S.compErrors].map(([k, v]) => `${k}: ${v}`), () => { S.compErrors.clear(); drawPills(); renderTimeline(); }) } }, `${S.compErrors.size} comp error${S.compErrors.size > 1 ? 's' : ''}`));
  }
  for (const j of jobs.values()) pills.push(h('span.pill.job', {}, `${j.label}${j.state === 'running' ? '…' : j.state === 'done' ? ' ✓' : ' failed'}`));
  $('#pills').replaceChildren(...pills);
}
on('project', drawPills);

const pop = $('#pop');
function openPop(anchor, ...kids) {
  pop.replaceChildren(...kids);
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 390, r.right - 380))}px`;
}
document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#helpBtn,.pill')) pop.hidden = true; });

function showList(e, title, items, clear) {
  openPop(e.currentTarget, h('div.sec', {}, h('h4', {}, title, clear ? h('button.btn.ghost.sm', { on: { click: () => { clear(); pop.hidden = true; } } }, 'Clear') : null), h('ul', {}, ...items.map((t) => h('li', {}, t)))));
}

function copyBtn(text, label = 'Copy') {
  return h('button.btn.sm', { on: { click: async (e) => { await navigator.clipboard.writeText(text).catch(() => {}); e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = label; }, 1200); } } }, label);
}

const KEYS = [
  ['Space', 'play / pause'], ['← →', 'previous / next frame (Shift: 1 s)'], ['↑ ↓', 'previous / next edit'],
  ['S', 'split at playhead'], ['Q · W', 'ripple trim head · tail to playhead'], ['C · V', 'razor · select'],
  ['Del', 'delete (Shift: ripple)'], ['Ctrl C X V', 'copy · cut · paste at playhead'], ['Ctrl D', 'duplicate'],
  ['Alt ← →', 'nudge clips a frame (Shift: 10)'], ['Alt drag', 'copy a clip'], ['Shift E', 'enable / disable'],
  ['[ ]', 'previous / next keyframe'], ['I · O · X', 'in · out · clear'], ['M', 'marker'], ['T', 'text clip'],
  ['N', 'snapping'], ['G', 'safe-area guides'], ['+ − \\', 'zoom · fit'], ['Right-click', 'clip, gap and track menus'],
  ['Ctrl Z', 'undo (agent edits too)'], ['Ctrl E', 'export'], ['Ctrl O', 'projects: recent · open · new'], ['/', 'open chat'],
];
$('#helpBtn').onclick = (e) => openPop(e.currentTarget, h('div.sec', {}, h('h4', {}, 'Keyboard'),
  h('div.keys', {}, ...KEYS.flatMap(([k, v]) => [h('span.kbd', {}, k), h('span', {}, v)]))));

// ---------- right panel tabs ----------
function setTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.dataset.pane === name);
  const on = document.querySelector(`.tab[data-tab="${name}"]`);
  const ink = $('#tabInk');
  ink.style.width = `${on.offsetWidth - 24}px`;
  ink.style.transform = `translateX(${on.offsetLeft + 12}px)`;
  try { localStorage.setItem('kadr.tab', name); } catch { /* ignore */ }
  if (name === 'chat') focusChat();
}
for (const t of document.querySelectorAll('.tab')) t.onclick = () => setTab(t.dataset.tab);
requestAnimationFrame(() => { let t = 'props'; try { t = localStorage.getItem('kadr.tab') || 'props'; } catch { /* ignore */ } setTab(t); });
new ResizeObserver(() => setTab($('.tab.on').dataset.tab)).observe($('#tabs'));

$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
on('history', () => { $('#undoBtn').disabled = !canUndo(); $('#redoBtn').disabled = !canRedo(); });
$('#exportBtn').onclick = openExport;
$('#projBtn').onclick = openProjects;
$('#templatesBtn').onclick = openGallery;
// start screen (empty project)
$('#startArt').innerHTML = ART.stage();
$('#startImport').onclick = () => { const inp = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*,.html' }); inp.onchange = () => importFiles([...inp.files]); inp.click(); };
$('#startTemplates').onclick = openGallery;
$('#startChat').onclick = () => setTab('chat');
$('#splitBtn').onclick = splitAtPlayhead;
$('#addTextBtn').onclick = addText;
$('#addMarkerBtn').onclick = () => selectMarker(addMarker(S.t));
$('#addVTrack').onclick = () => addTrack('video');
$('#addATrack').onclick = () => addTrack('audio');

// ---------- toast ----------
let toastTimer = 0;
on('toast', ({ text, err }) => {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast on${err ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, err ? 5000 : 2400);
});

// ---------- splitter ----------
const splitter = $('#splitter');
splitter.addEventListener('pointerdown', (e) => {
  splitter.classList.add('drag');
  const y0 = e.clientY;
  const h0 = $('#timeline').getBoundingClientRect().height;
  const mm = (ev) => {
    const v = Math.max(140, Math.min(window.innerHeight - 220, h0 - (ev.clientY - y0)));
    document.documentElement.style.setProperty('--tl-h', `${v}px`);
  };
  const mu = () => {
    splitter.classList.remove('drag');
    window.removeEventListener('pointermove', mm);
    window.removeEventListener('pointerup', mu);
    try { localStorage.setItem('kadr.tlh', document.documentElement.style.getPropertyValue('--tl-h')); } catch { /* private mode */ }
  };
  window.addEventListener('pointermove', mm);
  window.addEventListener('pointerup', mu);
});
try { const v = localStorage.getItem('kadr.tlh'); if (v) document.documentElement.style.setProperty('--tl-h', v); } catch { /* ignore */ }

// ---------- file drop anywhere ----------
const veil = $('#dropVeil');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; veil.hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) veil.hidden = true; });
window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  veil.hidden = true;
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  importFiles([...e.dataTransfer.files]);
});
$('#tlRows').addEventListener('drop', () => { dragDepth = 0; veil.hidden = true; }, true);

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (!S.project) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const f = 1 / fps();
  const stop = () => e.preventDefault();
  if (mod && k.toLowerCase() === 'z') { stop(); return e.shiftKey ? redo() : undo(); }
  if (mod && k.toLowerCase() === 'y') { stop(); return redo(); }
  if (mod && k.toLowerCase() === 'd') { stop(); return duplicateSelected(); }
  if (mod && k.toLowerCase() === 'a') { stop(); return select(S.project.clips.filter((c) => !isLocked(c)).map((c) => c.id)); }
  if (mod && k.toLowerCase() === 'c') { stop(); return copySelected(); }
  if (mod && k.toLowerCase() === 'x') { stop(); return copySelected(true); }
  if (mod && k.toLowerCase() === 'v') { stop(); return paste(); }
  if (mod && k.toLowerCase() === 'k') { stop(); return splitAtPlayhead(); }
  if (mod && k.toLowerCase() === 'e') { stop(); return openExport(); }
  if (mod && k.toLowerCase() === 'o') { stop(); return openProjects(); }
  if (mod) return;
  if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { stop(); return nudge((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); }
  switch (k) {
    case ' ': stop(); toggle(); break;
    case 'ArrowLeft': stop(); pause(); seek(snapFrame(S.t) - (e.shiftKey ? 1 : f)); break;
    case 'ArrowRight': stop(); pause(); seek(snapFrame(S.t) + (e.shiftKey ? 1 : f)); break;
    case 'ArrowUp': case 'ArrowDown': {
      stop();
      const pts = [0, duration(), ...S.project.clips.flatMap((c) => [c.start, c.start + c.duration]), ...S.project.markers.map((m) => m.t)].sort((a, b) => a - b);
      const t = k === 'ArrowUp' ? [...pts].reverse().find((x) => x < S.t - 1e-4) : pts.find((x) => x > S.t + 1e-4);
      if (t != null) seek(t);
      break;
    }
    case 'Home': stop(); seek(0); break;
    case 'End': stop(); seek(duration()); break;
    case 'l': case 'L': if (e.shiftKey) { $('#tLoop').click(); } else toggle(); break;
    case 'k': case 'K': pause(); break;
    case 'j': case 'J': pause(); seek(S.t - 1); break;
    case 's': case 'S': splitAtPlayhead(); break;
    case 'q': case 'Q': rippleTrim('head'); break;
    case 'w': case 'W': rippleTrim('tail'); break;
    case '[': jumpKey(-1); break;
    case ']': jumpKey(1); break;
    case 'g': case 'G': toggleGuides(); break;
    case 'e': case 'E': if (!e.shiftKey || !S.sel.size) return; commit(() => { const v = !clipById([...S.sel][0])?.disabled; for (const id of S.sel) { const c = clipById(id); if (c) c.disabled = v; } }); break;
    case 'c': case 'C': setTool('razor'); break;
    case 'v': case 'V': setTool('select'); break;
    case 'n': case 'N': toggleSnap(); break;
    case 't': case 'T': addText(); break;
    case 'm': case 'M': selectMarker(addMarker(S.t)); break;
    case 'i': case 'I': S.inPt = snapFrame(S.t); if (S.outPt != null && S.outPt <= S.inPt) S.outPt = null; renderTimeline(); publishState(); break;
    case 'o': case 'O': S.outPt = snapFrame(S.t); if (S.inPt != null && S.inPt >= S.outPt) S.inPt = null; renderTimeline(); publishState(); break;
    case 'x': case 'X': S.inPt = null; S.outPt = null; renderTimeline(); publishState(); break;
    case 'Delete': case 'Backspace': stop(); deleteSelected({ ripple: e.shiftKey }); break;
    case 'Escape': select([]); setTool('select'); $('#pop').hidden = true; break;
    case '/': stop(); setTab('chat'); break;
    case '+': case '=': setZoom(S.pps * 1.4); break;
    case '-': case '_': setZoom(S.pps / 1.4); break;
    case '\\': zoomFit(); break;
    default: return;
  }
});

window.addEventListener('pagehide', () => { flushSave(); publishState(); });
boot().catch((e) => showFatal(e.message));

export { commit };
