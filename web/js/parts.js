// A composition clip, split into parts on the timeline. When one HTML clip is
// selected, the rows under the tracks show each element that animates (its
// title, subtitle, image, …) at the time it plays. Drag a part to move it,
// drag its right edge to make it faster or slower, click it to edit its text,
// color, size and easing in the inspector. Every change is a small edit to the
// same .html file, so the agent that wrote it reads exactly what you changed.
import { decodeEnt, escText, escAttr, styleEdit, styleUrls, attrEdit, ruleDecl, partTimeEdits, animEdits, jsEdits, animEaseEdit, jsEaseEdit, relPath, resolvePath, IMG_RE } from '/shared/htmlsrc.js';
import { S, on, emit, commit, seek, toast, publishState } from './state.js';
import { $, h, svg, ICON, drag, clipName, basename } from './util.js';
import { getComp, editClipComp, undoComp } from './comp.js';
import { openCompEditor, textInput, numInput, colorInput } from './compedit.js';
import { pickImage } from './picker.js';

const box = $('#tlParts');
const SNAP = 0.05;
const CSS_EASES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.16, 1, .3, 1)', 'cubic-bezier(.34, 1.56, .64, 1)', 'cubic-bezier(.7, 0, .84, 0)'];
const JS_EASES = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outQuart', 'outExpo', 'inOutExpo', 'outBack', 'outElastic'];
const EASE_NAMES = { 'cubic-bezier(.16, 1, .3, 1)': 'expo out', 'cubic-bezier(.34, 1.56, .64, 1)': 'back out', 'cubic-bezier(.7, 0, .84, 0)': 'expo in' };
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The selected HTML clip, if exactly one is selected. */
function theClip() {
  if (S.sel.size !== 1 || !S.project) return null;
  const c = S.project.clips.find((x) => x.id === [...S.sel][0]);
  return c?.type === 'html' ? c : null;
}
/** Comp time u → timeline time. */
const toT = (c, u) => c.start + (u - (c.in || 0)) / (c.speed || 1);

export function currentPart() {
  const c = theClip();
  if (!c || !S.part || S.part.clip !== c.id) return null;
  const e = getComp(c.src);
  const p = e?.parts.find((x) => x.key === S.part.key);
  return p ? { c, e, p } : null;
}

function selectPart(c, key) {
  S.part = key ? { clip: c.id, key } : null;
  emit('select');
  publishState();
}

// ---------- timeline rows ----------

export function renderParts() {
  const c = theClip();
  if (!c) { box.replaceChildren(); box.hidden = true; return; }
  const e = getComp(c.src);
  box.hidden = false;
  const head = (...kids) => h('div.tl-head.pt-head', {}, ...kids);
  const pps = S.pps;
  const band = () => h('div.pt-band', { style: { left: `${c.start * pps}px`, width: `${c.duration * pps}px` } });
  const title = h('div.tl-row.pt-title', {},
    head(h('span.pt-k', {}, 'parts'), h('div.nm', { title: c.src }, clipName(c))),
    h('div.tl-lane', {}, band(), h('div.pt-hint', { style: { left: `${c.start * pps + 8}px` } },
      !e ? 'reading…' : e.parts.length ? `${e.parts.length} part${e.parts.length === 1 ? '' : 's'} · drag to move · drag the right edge to speed up or slow down · click to edit` : 'No animated parts found in this composition',
      e?.readonly ? ' · built-in: your first change makes an editable copy in comps/' : '',
      h('button.btn.ghost.sm', { on: { click: () => openCompEditor(c.src, c.id) } }, 'Open editor'))));
  if (!e) { box.replaceChildren(title); return; }
  const rows = e.parts.map((p) => {
    const on = S.part?.clip === c.id && S.part.key === p.key;
    const x0 = toT(c, p.s) * pps;
    const w = Math.max(6, ((p.e - p.s) / (c.speed || 1)) * pps);
    const ticks = p.timings.length > 1 ? p.timings.map((t) => h('i.pt-tick', { style: { left: `${((t.s - p.s) / Math.max(1e-6, p.e - p.s)) * 100}%`, width: `${((t.e - t.s) / Math.max(1e-6, p.e - p.s)) * 100}%` } })) : [];
    const bar = h(`div.pt-bar${on ? '.on' : ''}${p.el ? '' : '.js'}`, {
      style: { left: `${x0}px`, width: `${w}px` },
      title: `${p.name}\n${r3(p.s)}s → ${r3(p.e)}s in the comp · ${p.timings.length} animation${p.timings.length === 1 ? '' : 's'}`,
    }, ...ticks, h('span', {}, p.name), h('i.r'));
    bar.addEventListener('pointerdown', (ev) => dragPart(ev, c, e, p, bar));
    return h(`div.tl-row.pt-row${on ? '.on' : ''}`, {},
      head(h('div.nm', { dir: 'auto', title: p.name, on: { click: () => selectPart(c, p.key) } }, p.name)),
      h('div.tl-lane', {}, band(), bar));
  });
  box.replaceChildren(title, ...rows);
}

function dragPart(ev, c, e, p, bar) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const edge = ev.target.classList.contains('r');
  const sp = c.speed || 1;
  const s0 = p.s;
  const len0 = p.e - p.s;
  let s = s0;
  let len = len0;
  const x0 = parseFloat(bar.style.left);
  const w0 = parseFloat(bar.style.width);
  drag(ev, (dx, _dy, mv) => {
    const du = (dx / S.pps) * sp;
    const snap = (v) => (mv.shiftKey ? v : Math.round(v / SNAP) * SNAP);
    if (edge) { len = Math.max(0.05, snap(len0 + du)); bar.style.width = `${Math.max(6, (len / sp) * S.pps)}px`; }
    else { s = Math.max(0, snap(s0 + du)); bar.style.left = `${x0 + ((s - s0) / sp) * S.pps}px`; }
    bar.querySelector('span').textContent = edge ? `${p.name} · ${Math.round((len0 / len) * 100)}% speed` : `${p.name} · ${r3(s)}s`;
  }, (_u, moved) => {
    if (!moved) { selectPart(c, p.key); seek(toT(c, p.s)); return; }
    bar.style.width = `${w0}px`;
    S.part = { clip: c.id, key: p.key };
    editClipComp(c, partTimeEdits(p, s, len));
  });
}

// ---------- inspector view for a part ----------

const sec = (title, ...kids) => h('div.sec', {}, h('h4', {}, ...[].concat(title)), ...kids);
const row = (lab, ...kids) => h('div.f', {}, h('label.static', { title: lab }, lab), ...kids);

function easeSelect(cur, list, onPick) {
  const opts = list.includes(cur) ? list : [cur, ...list];
  const sel = h('select.in', { on: { change: () => onPick(sel.value) } }, ...opts.map((o) => h('option', { value: o }, EASE_NAMES[o] || o)));
  sel.value = cur;
  return sel;
}

function imageRow(lab, value, dir, builtin, onPick) {
  const proj = value ? (builtin ? resolvePath('', value) : resolvePath(dir, value)) : '';
  const th = h('div.ce-img', { style: proj ? { backgroundImage: `url("/p/${proj.split('/').map(encodeURIComponent).join('/')}")` } : {} });
  return h('div.ce-imgrow', {}, th,
    h('div.ce-imgmeta', {}, h('b', {}, lab), h('span', { title: value }, value ? basename(value) : 'none')),
    h('button.btn.sm', { on: { click: async () => {
      const p = await pickImage({ current: proj, title: `Replace ${lab.toLowerCase()}` });
      if (p) onPick(builtin ? `/p/${p.split('/').map(encodeURIComponent).join('/')}` : relPath(dir, p));
    } } }, 'Replace'));
}

export function partView() {
  const cur = currentPart();
  if (!cur) return null;
  const { c, e, p } = cur;
  const src = e.source;
  const el = p.el;
  const out = [];
  const edit = (...x) => editClipComp(c, x);
  const builtin = c.src.startsWith('@kadr/');
  const dir = builtin ? '' : c.src.split('/').slice(0, -1).join('/');
  const props = { ...e.model.props, ...(c.props || {}) };
  const setProp = (k, v) => commit(() => { c.props = { ...(c.props || {}), [k]: v }; });

  out.push(h('div.ihead', {}, h('span.badge.k-html', {}, 'part'),
    h('div.t', {}, h('b', { dir: 'auto' }, p.name), h('span', { title: c.src }, `${clipName(c)} · ${c.src}`)),
    h('button.btn.ghost.icon.sm', { title: 'Back to the clip', on: { click: () => selectPart(c, null) } }, svg(ICON.x))));

  // content
  const content = [];
  if (el) {
    const dataProp = el.attrs['data-prop']?.v;
    const srcProp = el.attrs['data-prop-src']?.v;
    if (dataProp) {
      content.push(row('Text', textInput(String(props[dataProp] ?? decodeEnt(el.content ? src.slice(el.content[0], el.content[1]).trim() : '')), { area: true, onCommit: (v) => setProp(dataProp, v) })));
    } else if (el.content && !el.kids && el.text && !['script', 'style'].includes(el.tag)) {
      const raw = src.slice(el.content[0], el.content[1]);
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.slice(lead.length).match(/\s*$/)[0];
      const cur0 = decodeEnt(raw.trim());
      content.push(row('Text', textInput(cur0, { area: cur0.length > 24, onCommit: (v) => edit({ a: el.content[0], b: el.content[1], text: lead + escText(v) + trail }) })));
    }
    for (const name of ['src', 'href', 'xlink:href']) {
      const a = el.attrs[name];
      if (a?.vr && (IMG_RE.test(a.v) || el.tag === 'img' || el.tag === 'image')) content.push(imageRow('Image', decodeEnt(a.v), dir, builtin, (v) => edit(attrEdit(el, name, v))));
    }
    for (const u of styleUrls(src, el)) content.push(imageRow('Background', u.v, dir, builtin, (v) => edit({ a: u.r[0], b: u.r[1], text: escAttr(v, el.attrs.style.q || '"') })));
    if (srcProp) content.push(imageRow('Image', props[srcProp], dir, builtin, (v) => setProp(srcProp, v)));
    if (!['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'image'].includes(el.tag)) {
      const isSvgText = el.tag === 'text' || el.tag === 'tspan';
      const cprop = isSvgText ? 'fill' : 'color';
      const inline = el.attrs.style?.vr && new RegExp(`(^|;)\\s*${cprop}\\s*:`).test(el.attrs.style.v);
      const decl = ruleDecl(e.model, el, cprop);
      const curColor = inline ? el.attrs.style.v.match(new RegExp(`(?:^|;)\\s*${cprop}\\s*:\\s*([^;]+)`))[1].trim() : decl?.value || el.attrs[cprop]?.v || '';
      const setColor = (v) => edit(!inline && decl ? { a: decl.vr[0], b: decl.vr[1], text: v } : styleEdit(src, el, cprop, v));
      // gradients / variables (url(#g), var(--x)) aren't a single color: leave those to the code
      if ((el.text || dataProp || isSvgText) && !/^(url|var)\(/i.test(curColor)) content.push(row('Color', colorInput(curColor || '#ffffff', { onCommit: setColor })));
      const fdecl = ruleDecl(e.model, el, 'font-size');
      const fInline = el.attrs.style?.v.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px/);
      const fs = fInline ? Number(fInline[1]) : fdecl && /^[\d.]+px$/.test(fdecl.value) ? parseFloat(fdecl.value) : null;
      if ((el.text || dataProp) && fs != null) {
        content.push(row('Size', numInput(fs, { step: 1, unit: 'px', onCommit: (v) => edit(!fInline && fdecl ? { a: fdecl.vr[0], b: fdecl.vr[1], text: `${Math.round(v * 10) / 10}px` } : styleEdit(src, el, 'font-size', `${Math.round(v * 10) / 10}px`)) })));
      }
    }
  }
  if (content.length) out.push(sec('Content', ...content));

  // timing of the whole part
  const len = p.e - p.s;
  const speeds = [[0.5, '0.5×'], [0.75, '0.75×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']];
  out.push(sec(['Timing', h('span.hint', {}, 'seconds into the comp')],
    h('div.row2.pt-row2', {},
      row('Start', numInput(p.s, { unit: 's', onCommit: (v) => edit(...partTimeEdits(p, Math.max(0, v), len)) })),
      row('Length', numInput(len, { unit: 's', onCommit: (v) => edit(...partTimeEdits(p, p.s, Math.max(0.05, v))) }))),
    row('Speed', h('div.seg-pick', {}, ...speeds.map(([k, t]) => h('button', { title: `Play this part ${k > 1 ? 'faster' : 'slower'} (${k}×)`, on: { click: () => edit(...partTimeEdits(p, p.s, len / k)) } }, t)))),
    h('div.hint', {}, `on the timeline: ${toT(c, p.s).toFixed(2)}s → ${toT(c, p.e).toFixed(2)}s`)));

  // each animation in it
  out.push(sec(`Animation${p.timings.length > 1 ? 's' : ''}`, ...p.timings.map((t) => h('div.ce-anim', {},
    h('div.ce-anim-h', {}, h('code', {}, t.kind === 'css' ? t.name : 'script'), h('span', { title: t.kind === 'css' ? t.ref.selector : t.ref.text }, t.kind === 'css' ? t.ref.selector : `line ${t.ref.line}`)),
    h('div.row2.pt-row2', {},
      row('Start', numInput(t.s, { unit: 's', onCommit: (v) => edit(...(t.kind === 'css' ? animEdits(t.ref, Math.max(0, v), t.e - t.s) : jsEdits(t.ref, Math.max(0, v), Math.max(v + 0.01, v + t.e - t.s)))) })),
      row('Length', numInput(t.e - t.s, { unit: 's', onCommit: (v) => edit(...(t.kind === 'css' ? animEdits(t.ref, t.s, Math.max(0.01, v)) : jsEdits(t.ref, t.s, t.s + Math.max(0.01, v)))) }))),
    row('Easing', t.kind === 'css'
      ? easeSelect(t.ease, CSS_EASES, (v) => edit(animEaseEdit(t.ref, v)))
      : (t.ref.ease || t.ref.easeIns != null) ? easeSelect(t.ease, JS_EASES, (v) => edit(jsEaseEdit(t.ref, v))) : h('span.hint', {}, 'set in the script'))))));

  out.push(sec('', h('div.actions', {},
    h('button.btn.sm', { on: { click: () => openCompEditor(c.src, c.id) } }, 'Open in editor'),
    e.undo.length ? h('button.btn.sm', { title: 'Undo the last change to this composition', on: { click: () => undoComp(c.src) } }, 'Undo') : null,
    h('button.btn.sm', { on: { click: () => seek(toT(c, p.s)) } }, 'Go to')),
  h('div.hint', { style: { marginTop: '8px' } }, 'Changes are written into ', h('code', {}, c.src), '. The chat and other agents see them as soon as they are saved.')));
  return out;
}

// ---------- refresh ----------

on('select', () => {
  if (S.part && !(S.sel.size === 1 && S.sel.has(S.part.clip))) S.part = null;
  renderParts();
});
on('project', (o) => { if (!o?.live) renderParts(); });
on('tl-render', renderParts);
on('comp', (src) => {
  const c = theClip();
  if (c && c.src === src) {
    // keep the selected part across edits that renamed its key (moved timings)
    if (S.part && !getComp(src)?.parts.some((p) => p.key === S.part.key)) S.part = null;
    renderParts();
    emit('part-changed');
  }
});
