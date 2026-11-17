// Workspaces: how the editor's panels are laid out. Ready-made layouts for
// common jobs, show / hide / swap the side panels, drag their edges to resize,
// and save your own layouts by name. Stored per browser (localStorage).
import { $, h } from './util.js';
import { openMenu } from './menu.js';
import { toast } from './state.js';

const PRESETS = {
  editing: { name: 'Editing', media: true, side: true, swap: false, mediaW: 236, sideW: 330, tlH: 300, tab: 'props' },
  ai: { name: 'AI', media: true, side: true, swap: false, mediaW: 210, sideW: 460, tlH: 260, tab: 'chat' },
  preview: { name: 'Big preview', media: false, side: true, swap: false, mediaW: 236, sideW: 300, tlH: 210, tab: 'props' },
  timeline: { name: 'Big timeline', media: true, side: true, swap: false, mediaW: 210, sideW: 300, tlH: 440, tab: 'props' },
};

let L = null; // current layout (+ id of the workspace it came from)
let custom = {};
let setTab = () => {};
let selfResize = false; // our own resize event, not the window's

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const all = () => ({ ...PRESETS, ...custom });

function apply() {
  const work = $('#work');
  const bin = $('#bin');
  const side = $('#side');
  const root = document.documentElement.style;
  const W = window.innerWidth;
  // keep the viewer usable however wide the panels were saved
  const mw = L.media ? Math.max(160, Math.min(L.mediaW, W * 0.35)) : 0;
  const sw = L.side ? Math.max(240, Math.min(L.sideW, W * 0.5)) : 0;
  root.setProperty('--side-w', `${sw || 330}px`);
  root.setProperty('--tl-h', `${Math.max(140, Math.min(L.tlH, window.innerHeight - 220))}px`);
  bin.hidden = !L.media;
  side.hidden = !L.side;
  const left = L.swap ? side : bin;
  const right = L.swap ? bin : side;
  const lw = L.swap ? sw : mw;
  const rw = L.swap ? mw : sw;
  left.style.order = '0';
  $('.viewer').style.order = '1';
  right.style.order = '2';
  work.style.gridTemplateColumns = [left.hidden ? null : `${lw}px`, 'minmax(0, 1fr)', right.hidden ? null : `${rw}px`].filter(Boolean).join(' ');
  bin.dataset.edge = L.swap ? 'left' : 'right';
  side.dataset.edge = L.swap ? 'right' : 'left';
  document.body.classList.toggle('swapped', !!L.swap);
  store('kadr.layout', L);
  placeEdges();
  // let the viewer and timeline re-measure
  selfResize = true;
  window.dispatchEvent(new Event('resize'));
  selfResize = false;
}

export function useWorkspace(id) {
  const w = all()[id];
  if (!w) return;
  L = { ...w, id };
  apply();
  setTab(w.tab || 'props');
  paintButton();
}

/** Change part of the layout (the workspace becomes "modified"). */
function change(patch) {
  L = { ...L, ...patch, modified: true };
  apply();
  paintButton();
}

function paintButton() {
  const b = $('#wsBtn span');
  if (b) b.textContent = `${all()[L.id]?.name || 'Custom'}${L.modified ? ' *' : ''}`;
}

function saveAs() {
  const name = prompt('Name this layout:', L.modified ? '' : all()[L.id]?.name || '');
  if (!name || !name.trim()) return;
  const id = `u-${name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}`;
  const { modified, ...rest } = L;
  custom[id] = { ...rest, id: undefined, name: name.trim(), tab: document.querySelector('.tab.on')?.dataset.tab || 'props' };
  store('kadr.workspaces', custom);
  L = { ...custom[id], id };
  store('kadr.layout', L);
  paintButton();
  toast(`Saved the layout "${name.trim()}"`);
}

/** Items for the Window menu (also used by the switcher button). */
export function workspaceItems() {
  if (!L) return [];
  const items = Object.entries(all()).map(([id, w]) => ({ label: w.name, checked: L.id === id && !L.modified, on: () => useWorkspace(id) }));
  return [
    { label: 'Workspaces', disabled: true },
    ...items.map((x) => ({ ...x, sub: true })),
    '-',
    { label: 'Media panel', checked: !!L.media, on: () => change({ media: !L.media }) },
    { label: 'Properties & chat panel', checked: !!L.side, on: () => change({ side: !L.side }) },
    { label: 'Panels on the other side', checked: !!L.swap, on: () => change({ swap: !L.swap }) },
    '-',
    { label: 'Save layout as…', on: saveAs },
    L.id?.startsWith('u-') ? { label: `Delete "${custom[L.id]?.name}"`, danger: true, on: () => { delete custom[L.id]; store('kadr.workspaces', custom); useWorkspace('editing'); } } : null,
    L.modified ? { label: `Reset to "${all()[L.id]?.name || 'Editing'}"`, on: () => useWorkspace(all()[L.id] ? L.id : 'editing') } : null,
  ].filter(Boolean);
}

/** Drag handles on the inner edge of the side panels (they live on the grid, not in the panels). */
const edges = [];
function placeEdges() {
  const wr = $('#work').getBoundingClientRect();
  for (const { el, handle } of edges) {
    handle.hidden = el.hidden;
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    const x = el.dataset.edge === 'right' ? r.right : r.left;
    handle.style.left = `${x - wr.left - 4}px`;
  }
}
function addEdges() {
  const work = $('#work');
  work.style.position = 'relative';
  for (const [el, key] of [[$('#bin'), 'mediaW'], [$('#side'), 'sideW']]) {
    const handle = h('div.panel-edge', { title: 'Drag to resize' });
    work.append(handle);
    edges.push({ el, handle });
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const x0 = e.clientX;
      const w0 = el.getBoundingClientRect().width;
      const onLeft = el.dataset.edge === 'right'; // panel sits on the left, its handle on its right edge
      handle.classList.add('drag');
      const mm = (ev) => {
        const d = ev.clientX - x0;
        L = { ...L, [key]: Math.round(w0 + (onLeft ? d : -d)), modified: true };
        apply();
      };
      const mu = () => {
        handle.classList.remove('drag');
        window.removeEventListener('pointermove', mm);
        window.removeEventListener('pointerup', mu);
        paintButton();
      };
      window.addEventListener('pointermove', mm);
      window.addEventListener('pointerup', mu);
    });
  }
}

/** The timeline splitter reports its height here so it is part of the layout. */
export function setTimelineHeight(px) {
  if (!L) return;
  L = { ...L, tlH: Math.round(px), modified: true };
  store('kadr.layout', L);
  paintButton();
}

export function initWorkspace(opts) {
  setTab = opts.setTab;
  custom = load('kadr.workspaces', {});
  const saved = load('kadr.layout', null);
  L = saved && typeof saved === 'object' ? { ...PRESETS.editing, ...saved } : { ...PRESETS.editing, id: 'editing' };
  if (!saved) {
    // carry over the timeline height people set before workspaces existed
    const old = parseFloat(load('kadr.tlh', null) ?? '');
    if (old > 0) L.tlH = old;
  }
  addEdges();
  apply();
  paintButton();
  $('#wsBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, workspaceItems(), { cls: 'mb-menu' });
  });
  let t = 0;
  window.addEventListener('resize', () => {
    if (selfResize) return;
    clearTimeout(t);
    t = setTimeout(() => { if (L) apply(); }, 120);
  }, { passive: true });
}
