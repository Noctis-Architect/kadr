// Template gallery: every built-in composition as a card with a live preview
// (it plays while you hover it). Click a card to drop it at the playhead.
import { S, on, toast } from './state.js';
import { h, svg, ICON, compUrl, fmtDur } from './util.js';
import { addClip } from './ops.js';
import { templateArt } from './art.js';

const ORDER = ['All', 'Titles', 'Text', 'Social', 'Data', 'Brand', 'Transitions'];
let back = null;

export function closeGallery() {
  back?.remove();
  back = null;
  window.removeEventListener('keydown', onKey, true);
}
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeGallery(); } }

export function addTemplate(path) {
  if (path === '@kadr/text.html') addClip(path, S.t, { props: { text: 'Title', size: 110, anim: 'rise' } });
  else addClip(path, S.t);
  const t = S.templates.get(path);
  toast(`${t?.title || 'Template'} added at the playhead`);
}

/** A card with a picture that turns into a live preview once visible. */
export function templateCard(t, { onPick, live = true } = {}) {
  const W = S.project?.width || 1920;
  const H = S.project?.height || 1080;
  const thumb = h('div.tg-th', { style: { aspectRatio: `${W} / ${H}` } });
  thumb.innerHTML = templateArt(t.path);
  const card = h('button.tg-card', { title: t.description || t.title, on: { click: () => onPick(t) } },
    thumb,
    h('div.tg-meta', {}, h('b', {}, t.title || t.path.slice(6)), h('span', {}, [t.category, t.duration ? fmtDur(t.duration) : ''].filter(Boolean).join(' · '))),
    h('span.tg-add', {}, svg(ICON.plus), 'Add'));
  if (!live) return card;
  let frame = null;
  let raf = 0;
  const dur = t.duration || 4;
  const load = () => {
    if (frame) return;
    frame = h('iframe', { tabindex: '-1', scrolling: 'no', width: W, height: H });
    frame.src = `${compUrl(t.path, null)}?t=${(dur * 0.55).toFixed(2)}`;
    const fit = () => {
      // fit inside the card (vertical projects are taller than the card allows)
      const s = Math.min(thumb.clientWidth / W, thumb.clientHeight / H);
      frame.style.transform = `translate(${(thumb.clientWidth - W * s) / 2}px, ${(thumb.clientHeight - H * s) / 2}px) scale(${s})`;
    };
    frame.addEventListener('load', () => { fit(); frame.contentWindow?.kadr?.ready.then(() => { frame.contentWindow.kadr.seek(dur * 0.55); thumb.classList.add('live'); }); });
    new ResizeObserver(fit).observe(thumb);
    thumb.append(frame);
  };
  new IntersectionObserver((es, io) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '120px' }).observe(card);
  card.addEventListener('pointerenter', () => {
    const k = frame?.contentWindow?.kadr;
    if (!k) return;
    const t0 = performance.now();
    const tick = () => { k.seek(((performance.now() - t0) / 1000) % dur); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  });
  card.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); frame?.contentWindow?.kadr?.seek(dur * 0.55); });
  return card;
}

export function openGallery() {
  closeGallery();
  const list = [...S.templates.values()];
  let cat = 'All';
  const grid = h('div.tg-grid');
  const search = h('input.in.tg-search', { placeholder: 'Search templates', spellcheck: false, on: { input: () => paint(), keydown: (e) => e.stopPropagation() } });
  const cats = ORDER.filter((c) => c === 'All' || list.some((t) => t.category === c));
  const chips = cats.map((c) => h('button.tg-chip', { on: { click: () => { cat = c; paint(); } } }, c));
  const pick = (t) => { closeGallery(); addTemplate(t.path); };
  function paint() {
    chips.forEach((b, i) => b.classList.toggle('on', cats[i] === cat));
    const q = search.value.trim().toLowerCase();
    const items = list.filter((t) => (cat === 'All' || t.category === cat) && (!q || `${t.title} ${t.description} ${t.category}`.toLowerCase().includes(q)));
    grid.replaceChildren(...items.map((t) => templateCard(t, { onPick: pick })));
    if (!items.length) grid.append(h('div.empty', {}, 'No template matches.'));
  }
  back = h('div.picker-back', { on: { pointerdown: (e) => { if (e.target === back) closeGallery(); } } },
    h('div.modal.tg', { on: { pointerdown: (e) => e.stopPropagation() } },
      h('header', {}, h('div.tg-title', {}, h('span', {}, 'Templates'), h('small', {}, 'Hover to play · click to add at the playhead')),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, search, h('button.btn.ghost.icon', { title: 'Close  Esc', on: { click: closeGallery } }, svg(ICON.x)))),
      h('div.tg-chips', {}, ...chips),
      h('div.body', {}, grid)));
  document.body.append(back);
  window.addEventListener('keydown', onKey, true);
  paint();
  requestAnimationFrame(() => search.focus());
}

on('open-gallery', openGallery);
