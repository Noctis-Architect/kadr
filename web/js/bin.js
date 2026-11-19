import { stripSpec } from '/shared/model.js';
import { S, on, emit, toast } from './state.js';
import { $, h, svg, ICON, basename, fmtDur, upload, api } from './util.js';
import { addClip, insertMedia } from './ops.js';
import { openCompEditor } from './compedit.js';
import { ART, templateArt } from './art.js';
import { openGallery, addTemplate } from './gallery.js';
import { openMenu } from './menu.js';

const root = $('#binMedia');
const uploads = new Map();
let filter = '';

/** Media picked in the panel (for , insert and . overwrite). */
export function pickMedia(path) {
  S.binSel = path;
  for (const el of root.querySelectorAll('.item')) el.classList.toggle('on', el.dataset.path === path);
}

function itemMenu(e, m) {
  e.preventDefault();
  pickMedia(m.path);
  openMenu(e.clientX, e.clientY, [
    { label: 'Insert at playhead', kbd: ',', on: () => insertMedia(m.path) },
    { label: 'Overwrite at playhead', kbd: '.', on: () => insertMedia(m.path, { overwrite: true }) },
    { label: 'Add on a free track', on: () => addClip(m.path, S.t) },
    '-',
    m.kind === 'html' ? { label: 'Edit visually…', on: () => openCompEditor(m.path) } : null,
    { label: 'Show file', on: () => api('/api/reveal', { path: m.path, select: true }).catch(() => {}) },
  ]);
}

const GROUPS = [
  ['video', 'Footage'], ['audio', 'Audio'], ['image', 'Images'], ['html', 'Compositions'],
];
const KIND_ICON = { video: ICON.film, audio: ICON.wave, image: ICON.image, html: ICON.code };

function item(m) {
  const th = h(`div.th.k-${m.kind}`);
  if (m.kind === 'image') th.style.backgroundImage = `url("/p/${m.path.split('/').map(encodeURIComponent).join('/')}")`;
  else if (m.kind === 'video' && !m.error) {
    th.style.backgroundImage = `url("/api/strip?src=${encodeURIComponent(m.path)}")`;
    th.style.backgroundSize = 'auto 100%';
    th.style.backgroundPosition = '0 0';
  } else th.append(svg(KIND_ICON[m.kind] || ICON.film));
  let meta = '';
  if (m.error) meta = 'unreadable';
  else if (m.kind === 'video') meta = `${fmtDur(m.duration)} · ${m.width}×${m.height}${m.proxyPending ? ' · proxy…' : m.proxy ? ' · proxy' : ''}`;
  else if (m.kind === 'audio') meta = fmtDur(m.duration);
  else if (m.kind === 'image') meta = `${m.width}×${m.height}`;
  else if (m.kind === 'html') meta = `${m.duration ? fmtDur(m.duration) : 'no duration'}${m.title ? ` · ${m.title}` : ''}`;
  const dir = m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/') + 1) : '';
  // hover scrub: skim through a video's filmstrip with the mouse
  if (m.kind === 'video' && !m.error && m.duration) {
    const n = stripSpec(m.duration).count;
    th.style.backgroundSize = `${n * 100}% 100%`;
    th.addEventListener('pointermove', (e) => {
      const r = th.getBoundingClientRect();
      const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
      th.style.backgroundPosition = `${n > 1 ? (i / (n - 1)) * 100 : 0}% 0`;
      th.dataset.t = fmtDur((i / n) * m.duration);
    });
    th.addEventListener('pointerleave', () => { th.style.backgroundPosition = '0 0'; delete th.dataset.t; });
    th.classList.add('scrub');
  }
  return h('div.item', {
    draggable: true,
    'data-path': m.path,
    class: `item${S.binSel === m.path ? ' on' : ''}`,
    title: `${m.path}\nClick: pick (then , inserts · . overwrites at the playhead)\nDouble-click: add at playhead · drag: drop on a track · right-click: more`,
    on: {
      click: () => pickMedia(m.path),
      dragstart: (e) => { e.dataTransfer.setData('text/kadr-src', m.path); e.dataTransfer.effectAllowed = 'copy'; },
      dblclick: () => addClip(m.path, S.t),
      contextmenu: (e) => itemMenu(e, m),
    },
  }, th, h('div.nm', {}, h('b', {}, basename(m.path)), h('span', { class: m.error ? 'bad' : '' }, dir && dir !== `${m.kind === 'html' ? 'comps' : 'media'}/` ? `${dir} · ${meta}` : meta)),
  m.kind === 'html' ? h('button.btn.ghost.sm.bin-edit', { title: 'Edit visually: text, images, timings', on: { click: (e) => { e.stopPropagation(); openCompEditor(m.path); }, dblclick: (e) => e.stopPropagation() } }, 'Edit') : null);
}

export function render() {
  const all = [...S.media.values()];
  const q = filter.trim().toLowerCase();
  const list = q ? all.filter((m) => m.path.toLowerCase().includes(q)) : all;
  const search = h('input.bin-search', { type: 'search', placeholder: 'Search media', value: filter, spellcheck: false });
  search.addEventListener('input', () => {
    filter = search.value;
    render();
    const s = root.querySelector('.bin-search');
    s.focus();
    s.setSelectionRange(s.value.length, s.value.length);
  });
  search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { filter = ''; render(); } });
  const kids = [h('div.ph', {}, h('h3', {}, 'Media'), h('span.gh-n', {}, all.length), h('div.grow'),
    h('button.btn.ghost.sm', { title: 'Import files into media/  Ctrl+I', on: { click: pick } }, svg(ICON.upload), 'Import')),
  all.length > 4 ? h('div.bin-filter', {}, search) : null];
  for (const [name, u] of uploads) {
    kids.push(h('div.upload-row', {}, `Importing ${name}`, h('div.bar', {}, h('i', { style: { width: `${Math.round(u * 100)}%` } }))));
  }
  for (const [kind, title] of GROUPS) {
    const items = list.filter((m) => m.kind === kind && !(kind === 'html' && m.path.startsWith('renders/')));
    if (!items.length) continue;
    kids.push(h('div.bin-group', {}, h('div.gh', {}, svg(KIND_ICON[kind]), title, h('span.gh-n', {}, items.length)), ...items.map(item)));
  }
  const tpls = [...S.templates.values()];
  if (tpls.length) {
    kids.push(h('div.bin-group', {},
      h('div.gh', {}, 'Templates', h('button.btn.link.gh-more', { on: { click: openGallery } }, `See all ${tpls.length}`)),
      h('div.tpl-grid', {}, ...tpls.slice(0, 8).map((t) => {
        const th = h('div.tpl-th', { html: templateArt(t.path) });
        return h('div.tpl', {
          draggable: true,
          title: `${t.title}\n${t.description || ''}\nDouble-click: add at playhead · drag: drop on a track`,
          on: {
            dragstart: (e) => { e.dataTransfer.setData('text/kadr-src', t.path); e.dataTransfer.effectAllowed = 'copy'; },
            dblclick: () => addTemplate(t.path),
          },
        }, th, h('span', {}, t.title || basename(t.path)));
      }))));
  }
  if (!all.length) {
    kids.splice(1, 0, h('div.empty.bin-empty', {}, h('div.empty-art', { html: ART.media() }),
      h('b', {}, 'No media yet'),
      h('span', { html: 'Drop video, audio or images anywhere in the window, or put them in <code>media/</code>.' }),
      h('button.btn.sm', { on: { click: pick } }, svg(ICON.upload), 'Import files')));
  }
  if (all.length && !list.length) kids.push(h('div.empty', {}, `Nothing matches "${filter}".`));
  root.replaceChildren(...kids.filter(Boolean));
}

export function addText() {
  addClip('@kadr/text.html', S.t, { props: { text: 'Title', size: 110, anim: 'rise' } });
}

function pick() {
  const inp = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*,.html' });
  inp.onchange = () => importFiles([...inp.files]);
  inp.click();
}

export async function importFiles(files) {
  for (const f of files) {
    uploads.set(f.name, 0);
    render();
    try {
      await upload(f, (p) => { uploads.set(f.name, p); render(); });
    } catch (e) {
      toast(`Import failed: ${f.name}`, true);
    }
    uploads.delete(f.name);
  }
  emit('media-refresh', () => {});
  render();
}

on('upload', (u) => {
  if (u.done) uploads.delete(u.name);
  else uploads.set(u.name, u.progress);
  render();
});
on('media', render);
