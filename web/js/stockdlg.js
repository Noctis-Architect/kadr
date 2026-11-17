// "Find photos & videos" window: search free stock libraries and add results
// to media/stock/ with one click (credits are written to CREDITS.md).
import { S, toast } from './state.js';
import { $, h, api } from './util.js';
import { openAiSettings } from './chat.js';

const back = $('#modal');
const close = () => { back.hidden = true; back.replaceChildren(); };

export function openStock(initial = '') {
  const p = S.project;
  const st = {
    q: initial, type: 'photo', provider: '',
    orientation: p ? (p.width > p.height * 1.1 ? 'landscape' : p.height > p.width * 1.1 ? 'portrait' : '') : '',
    busy: false, results: [], from: '', got: new Map(),
  };
  const stop = (e) => e.stopPropagation();
  const input = h('input.in', { value: st.q, placeholder: 'What should it show? e.g. "coffee beans close up" (English works best)', spellcheck: false, on: { keydown: (e) => { stop(e); if (e.key === 'Enter') search(); } } });
  const seg = (opts, key) => {
    const el = h('div.seg-pick');
    const paint = () => el.replaceChildren(...opts.map(([v, t]) => h(`button${st[key] === v ? '.on' : ''}`, { on: { click: () => { st[key] = v; paint(); if (st.q) search(); } } }, t)));
    paint();
    return el;
  };
  const lib = h('select.in', { on: { change: () => { st.provider = lib.value; if (st.q) search(); } } },
    ...[['', 'Best available'], ['wikimedia', 'Wikimedia Commons'], ['pexels', 'Pexels (key)'], ['pixabay', 'Pixabay (key)'], ['openverse', 'Openverse']].map(([v, t]) => h('option', { value: v }, t)));
  const grid = h('div.sk-grid');
  const status = h('div.hint.sk-status');

  function paint() {
    if (st.busy) { grid.replaceChildren(); status.textContent = 'Searching…'; return; }
    status.textContent = st.results.length ? `${st.results.length} results from ${st.from}. Click one to add it to Media.` : st.q ? 'Nothing found. Try other words, or another library.' : '';
    grid.replaceChildren(...st.results.map((r) => {
      const got = st.got.get(r.id);
      const tile = h(`button.sk-item${got ? '.got' : ''}`, {
        title: `${r.title}\n${r.license}${r.author ? `\nby ${r.author}` : ''}`,
        on: { click: () => take(r, tile) },
      },
      h('div.sk-th', { style: { backgroundImage: `url("${r.thumb}")` } },
        r.type === 'video' ? h('span.sk-badge', {}, r.duration ? `▶ ${Math.round(r.duration)}s` : '▶') : null,
        got === 'busy' ? h('span.sk-state', {}, 'Adding…') : got ? h('span.sk-state.ok', {}, '✓ In Media') : null),
      h('div.sk-meta', {}, h('span', {}, r.title), h('i', {}, `${r.width || '?'}×${r.height || '?'} · ${r.license.split(' (')[0]}`)));
      return tile;
    }));
  }

  async function search() {
    st.q = input.value.trim();
    if (!st.q) { input.focus(); return; }
    st.busy = true;
    paint();
    try {
      const r = await api('/api/stock/search', { query: st.q, type: st.type, orientation: st.orientation, count: 24, provider: st.provider });
      st.results = r.results;
      st.from = r.note ? `${r.provider} (${r.note.split(';')[0]})` : r.provider;
    } catch (e) {
      st.results = [];
      toast(e.message, true);
    }
    st.busy = false;
    paint();
  }

  async function take(r) {
    if (st.got.get(r.id)) return;
    st.got.set(r.id, 'busy');
    paint();
    try {
      const out = await api('/api/stock/get', { item: r });
      st.got.set(r.id, out.path);
      toast(`Added ${out.path.split('/').pop()}`);
    } catch (e) {
      st.got.delete(r.id);
      toast(e.message, true);
    }
    paint();
  }

  back.replaceChildren(h('div.modal.sk', { on: { pointerdown: stop } },
    h('header', {}, 'Find photos & videos', h('button.btn.ghost.icon.sm', { title: 'Close', on: { click: close } }, '✕')),
    h('div.body', {},
      h('div.sk-bar', {}, input, h('button.btn.primary', { on: { click: search } }, 'Search')),
      h('div.sk-opts', {}, seg([['photo', 'Photos'], ['video', 'Videos']], 'type'), seg([['', 'Any shape'], ['landscape', 'Wide'], ['portrait', 'Tall'], ['square', 'Square']], 'orientation'), lib),
      status, grid),
    h('footer', {},
      h('span.hint', {}, 'Free libraries only. Files go to media/stock/, with credits in CREDITS.md (some licenses ask you to credit the author). Pexels and Pixabay need a free key: ',
        h('a', { href: '#', on: { click: (e) => { e.preventDefault(); close(); openAiSettings(null, 'keys'); } } }, 'add keys')),
      h('div.grow'), h('button.btn', { on: { click: close } }, 'Done'))));
  back.hidden = false;
  back.onpointerdown = close;
  setTimeout(() => input.focus(), 50);
  if (st.q) search();
}
