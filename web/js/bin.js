import { S, on, emit, toast } from './state.js';
import { $, h, svg, ICON, basename, fmtDur, upload, api } from './util.js';
import { addClip } from './ops.js';
import { openCompEditor } from './compedit.js';

const root = $('#bin');
const uploads = new Map();

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
  return h('div.item', {
    draggable: true,
    title: `${m.path}\nDouble-click: add at playhead · drag: drop on a track`,
    on: {
      dragstart: (e) => { e.dataTransfer.setData('text/kadr-src', m.path); e.dataTransfer.effectAllowed = 'copy'; },
      dblclick: () => addClip(m.path, S.t),
      contextmenu: (e) => { e.preventDefault(); api('/api/reveal', { path: m.path, select: true }).catch(() => {}); },
    },
  }, th, h('div.nm', {}, h('b', {}, basename(m.path)), h('span', { class: m.error ? 'bad' : '' }, dir && dir !== `${m.kind === 'html' ? 'comps' : 'media'}/` ? `${dir} · ${meta}` : meta)),
  m.kind === 'html' ? h('button.btn.ghost.sm.bin-edit', { title: 'Edit visually: text, images, timings', on: { click: (e) => { e.stopPropagation(); openCompEditor(m.path); }, dblclick: (e) => e.stopPropagation() } }, 'Edit') : null);
}

export function render() {
  const list = [...S.media.values()];
  const kids = [h('div.ph', {}, h('h3', {}, 'Media'), h('div.grow'),
    h('button.btn.ghost.sm', { title: 'Import files into media/', on: { click: pick } }, '+ Import'))];
  for (const [name, u] of uploads) {
    kids.push(h('div.upload-row', {}, `Importing ${name}`, h('div.bar', {}, h('i', { style: { width: `${Math.round(u * 100)}%` } }))));
  }
  for (const [kind, title] of GROUPS) {
    const items = list.filter((m) => m.kind === kind && !(kind === 'html' && m.path.startsWith('renders/')));
    if (!items.length) continue;
    kids.push(h('div.bin-group', {}, h('div.gh', {}, title), ...items.map(item)));
  }
  const tpls = [...S.templates.values()];
  if (tpls.length) {
    kids.push(h('div.bin-group', {}, h('div.gh', {}, 'Templates'), ...tpls.map((t) => h('div.item', {
      draggable: true,
      title: `${t.description || t.title}\nDouble-click: add at playhead · drag: drop on a track`,
      on: {
        dragstart: (e) => { e.dataTransfer.setData('text/kadr-src', t.path); e.dataTransfer.effectAllowed = 'copy'; },
        dblclick: () => (t.path === '@kadr/text.html' ? addText() : addClip(t.path, S.t)),
      },
    }, h('div.th.k-tpl', {}, svg(t.path === '@kadr/text.html' ? ICON.text : ICON.code)),
    h('div.nm', {}, h('b', {}, t.title || basename(t.path)), h('span', {}, `${t.duration ? fmtDur(t.duration) : ''} · ${(t.description || '').split(/[.:]/)[0].toLowerCase()}`))))));
  }
  if (!list.length) {
    kids.splice(1, 0, h('div.empty', { html: 'Drop video, audio or images anywhere in the window, or put them in <code>media/</code>.' }));
  }
  root.replaceChildren(...kids);
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
