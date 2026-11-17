// Projects: recently opened projects, open a folder, start a new one.
// Opening switches the server to the other project, then every editor tab reloads.
import { S, flushSave, toast } from './state.js';
import { $, h, svg, ICON, api, fmtDur } from './util.js';

const back = $('#modal');
let open = false;

const FORMATS = [
  ['1920x1080', '16:9', 'Landscape'], ['1080x1920', '9:16', 'Vertical'], ['1080x1080', '1:1', 'Square'], ['1080x1350', '4:5', 'Portrait'],
];

function ago(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}

const tilde = (p, home) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

export function close() {
  open = false;
  back.hidden = true;
  back.replaceChildren();
}

async function go(path, body = null) {
  flushSave();
  try {
    await api(body ? '/api/new' : '/api/open', body || { path });
    // the server broadcasts "reopen"; reload here too in case the event is slow
    setTimeout(() => location.reload(), 150);
  } catch (e) {
    toast(e.message, true);
  }
}

export async function openProjects() {
  if (open) return close();
  open = true;
  let data;
  try { data = await api('/api/recent'); } catch (e) { open = false; return toast(e.message, true); }
  const { current, home } = data;
  let list = data.list;

  const grid = h('div.pj-grid');
  const paintList = () => {
    const filter = search.value.trim().toLowerCase();
    const items = list.filter((x) => !filter || `${x.name} ${x.path}`.toLowerCase().includes(filter));
    grid.replaceChildren(...items.map((x) => {
      const isCur = x.path === current;
      const [w, hh] = [x.width || 16, x.height || 9];
      const th = h('div.pj-th', { style: { aspectRatio: `${w} / ${hh}` } });
      if (x.thumb) th.style.backgroundImage = `url("/api/recent/thumb?path=${encodeURIComponent(x.path)}&v=${x.modified || 0}")`;
      else th.append(h('span', {}, (x.name || '?').slice(0, 1).toUpperCase()));
      const forget = h('button.pj-x', { title: 'Remove from this list (the files stay)', on: { click: async (e) => {
        e.stopPropagation();
        await api('/api/recent/forget', { path: x.path }).catch(() => {});
        list = list.filter((y) => y.path !== x.path);
        paintList();
      } } }, svg(ICON.x));
      return h(`div.pj-card${isCur ? '.cur' : ''}${x.exists ? '' : '.gone'}`, {
        title: x.path,
        tabindex: 0,
        on: {
          click: () => { if (!x.exists) return toast('That folder no longer has a project.json', true); if (isCur) return close(); go(x.path); },
          keydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
        },
      },
      h('div.pj-thw', {}, th),
      h('div.pj-meta', {},
        h('b', { dir: 'auto' }, x.name || '?', isCur ? h('span.pj-badge', {}, 'open') : null),
        h('span.pj-path', {}, `‎${tilde(x.path, home)}‎`),
        h('span.pj-info', {}, !x.exists ? 'missing' : x.error ? 'project.json has errors'
          : `${x.width}×${x.height} · ${x.fps} fps · ${x.clips} clip${x.clips === 1 ? '' : 's'}${x.duration ? ` · ${fmtDur(x.duration)}` : ''} · ${ago(x.modified)}`)),
      forget);
    }));
    if (!items.length) grid.append(h('div.empty', {}, filter ? 'No project matches.' : 'Projects you open show up here.'));
  };
  const search = h('input.in.pj-search', { placeholder: 'Search projects', spellcheck: false, on: { input: () => paintList(), keydown: (e) => e.stopPropagation() } });

  // open a folder
  const pathIn = h('input.in', { placeholder: '~/videos/launch', spellcheck: false, on: { keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') openBtn.click(); } } });
  const openBtn = h('button.btn', { on: { click: () => pathIn.value.trim() && go(pathIn.value.trim()) } }, 'Open');

  // new project
  const parent = current.slice(0, current.lastIndexOf('/')) || home;
  let fmt = '1920x1080';
  let pathTouched = false;
  const nameIn = h('input.in', { placeholder: 'my-video', spellcheck: false, dir: 'auto', on: { input: () => { if (!pathTouched) newPath.value = tilde(`${parent}/${slug(nameIn.value) || 'untitled'}`, home); }, keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') createBtn.click(); } } });
  const newPath = h('input.in', { value: tilde(`${parent}/untitled`, home), spellcheck: false, on: { input: () => { pathTouched = true; }, keydown: (e) => e.stopPropagation() } });
  const fmtBtns = FORMATS.map(([k, r, t]) => h('button', { on: { click: () => { fmt = k; paintFmt(); } } }, h('i.pj-ar', { style: { aspectRatio: k.replace('x', ' / ') } }), `${r} ${t}`));
  const paintFmt = () => fmtBtns.forEach((b, i) => b.classList.toggle('on', FORMATS[i][0] === fmt));
  paintFmt();
  const createBtn = h('button.btn.primary', { on: { click: () => {
    const [width, height] = fmt.split('x').map(Number);
    const p = newPath.value.trim();
    if (!p) return;
    go(null, { path: p, name: nameIn.value.trim() || p.split('/').pop(), width, height, fps: 30 });
  } } }, 'Create');

  const modal = h('div.modal.pj', { on: { pointerdown: (e) => e.stopPropagation() } },
    h('header', {}, 'Projects', h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, search,
      h('button.btn.ghost.icon', { title: 'Close  Esc', on: { click: close } }, svg(ICON.x)))),
    h('div.body', {},
      h('div.pj-label', {}, 'Recent'),
      grid,
      h('div.pj-split', {},
        h('div', {},
          h('div.pj-label', {}, 'Open a folder'),
          h('div.pj-row', {}, pathIn, openBtn),
          h('div.hint', { style: { marginTop: '6px' } }, 'Any folder with a project.json (or a folder inside one).')),
        h('div', {},
          h('div.pj-label', {}, 'New project'),
          h('div.f', {}, h('label.static', {}, 'Name'), nameIn),
          h('div.f', {}, h('label.static', {}, 'Folder'), newPath),
          h('div.seg-pick.pj-fmt', {}, ...fmtBtns),
          h('div.actions', { style: { marginTop: '10px', justifyContent: 'flex-end', display: 'flex' } }, createBtn)))));
  back.replaceChildren(modal);
  back.hidden = false;
  back.onpointerdown = (e) => { if (e.target === back) close(); };
  paintList();
  requestAnimationFrame(() => search.focus());
}

const slug = (s) => s.trim().toLowerCase().replace(/[^\w؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '');

window.addEventListener('keydown', (e) => {
  if (open && e.key === 'Escape') { e.stopPropagation(); close(); }
}, true);

export const currentRoot = () => S.root;
