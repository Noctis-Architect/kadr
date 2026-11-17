// Image picker: the project's images (and video stills via their filmstrip) plus
// "upload from computer". Resolves to a project-relative path, or null.
import { S, emit } from './state.js';
import { h, svg, ICON, upload, basename } from './util.js';
import { IMG_RE } from '/shared/htmlsrc.js';

const url = (p) => `/p/${p.split('/').map(encodeURIComponent).join('/')}`;

export function pickImage({ current = '', title = 'Choose an image' } = {}) {
  return new Promise((resolve) => {
    const back = h('div.picker-back');
    const done = (v) => { back.remove(); window.removeEventListener('keydown', esc, true); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); } };
    window.addEventListener('keydown', esc, true);
    const grid = h('div.pk-grid');
    const search = h('input.in', { placeholder: 'Filter', spellcheck: false, on: { input: () => paint(), keydown: (e) => e.stopPropagation() } });
    const status = h('span.hint');

    function paint() {
      const f = search.value.trim().toLowerCase();
      const imgs = [...S.media.values()].filter((m) => (m.kind === 'image' || IMG_RE.test(m.path)) && !m.path.startsWith('renders/') && (!f || m.path.toLowerCase().includes(f)));
      grid.replaceChildren(...imgs.map((m) => h(`button.pk-item${m.path === current ? '.on' : ''}`, {
        title: `${m.path}${m.width ? `\n${m.width}×${m.height}` : ''}`,
        on: { click: () => done(m.path) },
      }, h('div.pk-th', { style: { backgroundImage: `url("${url(m.path)}")` } }), h('span', {}, basename(m.path)))));
      if (!imgs.length) grid.append(h('div.empty', {}, f ? 'Nothing matches.' : 'No images in this project yet. Upload one, or drop files on the editor window.'));
    }

    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, on: { change: async () => {
      const f = file.files[0];
      if (!f) return;
      status.textContent = `Uploading ${f.name}…`;
      try {
        const r = await upload(f, (p) => { status.textContent = `Uploading ${f.name} ${Math.round(p * 100)}%`; });
        await new Promise((ok) => emit('media-refresh', ok));
        done(r.path);
      } catch (e) {
        status.textContent = `Upload failed: ${e.message}`;
      }
    } } });

    back.append(h('div.modal.pk', { on: { pointerdown: (e) => e.stopPropagation() } },
      h('header', {}, title, h('button.btn.ghost.icon', { on: { click: () => done(null) } }, svg(ICON.x))),
      h('div.body', {},
        h('div.pk-bar', {}, search, h('button.btn', { on: { click: () => file.click() } }, svg(ICON.plus), 'Upload image'), file),
        status, grid)));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
    document.body.append(back);
    paint();
    requestAnimationFrame(() => search.focus());
  });
}
