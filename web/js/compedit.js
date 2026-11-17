// Visual composition editor. The composition plays full size in the background;
// click anything in it to change its text, image, color or size, drag the bars
// at the bottom to retime CSS animations and kadr.progressIn / kadr.interp calls,
// and edit props and :root variables on the right. Every change rewrites only
// the characters it touches in the .html file (see shared/htmlsrc.js), so agents
// keep working on the same file and the main preview updates as usual.
import {
  scanComp, applyEdits, escText, escAttr, attrEdit, styleEdit, styleUrls, fmtTime, decodeEnt, relPath, resolvePath, IMG_RE,
} from '/shared/htmlsrc.js';
import { S, on, commit, toast } from './state.js';
import { $, h, svg, ICON, api, basename, drag } from './util.js';
import { pickImage } from './picker.js';

const E = {
  open: false, src: '', clipId: null, source: '', hash: '', model: null, readonly: false,
  t: 0, playing: false, sel: null, hover: null, frame: null, loadId: 0, view: { s: 1, ox: 0, oy: 0 },
  undo: [], redo: [], code: false, propsKey: '', lastPick: null,
};
let ui = null;

const CSS_EASES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(.16, 1, .3, 1)', 'cubic-bezier(.34, 1.56, .64, 1)', 'cubic-bezier(.7, 0, .84, 0)'];
const EASE_NAMES = { 'cubic-bezier(.16, 1, .3, 1)': 'expo out', 'cubic-bezier(.34, 1.56, .64, 1)': 'back out', 'cubic-bezier(.7, 0, .84, 0)': 'expo in' };
const JS_EASES = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outQuart', 'outExpo', 'inOutExpo', 'outBack', 'outElastic'];
const SNAP = 0.05;
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const num = (v) => String(Math.round(v * 1000) / 1000);
const isBuiltin = () => E.src.startsWith('@kadr/');
const compDir = () => (isBuiltin() ? '' : E.src.split('/').slice(0, -1).join('/'));
const clip = () => (E.clipId ? S.project?.clips.find((c) => c.id === E.clipId) : null);
const props = () => ({ ...(E.model?.props || {}), ...(clip()?.props || {}) });
const fdoc = () => E.frame?.contentDocument || null;
const liveEl = (at) => (at == null ? null : fdoc()?.querySelector(`[data-kat="${at}"]`));
const isColor = (v) => /^#[0-9a-f]{3,8}$/i.test(String(v).trim()) || /^(rgb|hsl)a?\(/i.test(String(v).trim());
const isImg = (v) => typeof v === 'string' && IMG_RE.test(v.trim());
/** Path to write into the comp for a project file. */
const pathForComp = (p) => (isBuiltin() ? `/p/${enc(p)}` : relPath(compDir(), p));
/** Project path (for thumbnails) of a path written in the comp. */
const fromComp = (p) => resolvePath(compDir(), String(p || '').trim());
const thumbUrl = (p) => { const r = fromComp(p); return r ? `/p/${enc(r)}` : p; };

// ---------- open / close ----------

export async function openCompEditor(src, clipId = null) {
  if (E.open) close();
  let r;
  try { r = await api(`/api/comp?src=${encodeURIComponent(src)}`); } catch (e) { return toast(e.message, true); }
  Object.assign(E, { open: true, src, clipId, readonly: r.readonly, t: 0, playing: false, sel: null, hover: null, frame: null, undo: [], redo: [], code: false, lastPick: null });
  const c = clip();
  const inClip = c && S.t >= c.start && S.t < c.start + c.duration;
  if (inClip) E.t = Math.max(0, S.t - c.start + (c.in || 0));
  build();
  setSource(r.source, r.hash);
  // not parked on the clip: show it mid-way, where things are usually on screen
  if (!inClip) E.t = Math.round(dur() * 0.6 * 100) / 100;
  E.propsKey = JSON.stringify(c?.props || {});
  loadFrame();
}

function close() {
  if (!E.open) return;
  E.open = false;
  E.playing = false;
  ui?.root.remove();
  ui = null;
  E.frame = null;
}

// ---------- source ----------

function setSource(source, hash) {
  const old = E.model;
  const idx = (at) => (old && at != null ? old.els.findIndex((e) => e.at === at) : -1);
  const si = idx(E.sel);
  E.source = source;
  E.hash = hash;
  E.model = scanComp(source);
  E.sel = si >= 0 ? E.model.els[si]?.at ?? null : null;
  if (ui) {
    if (document.activeElement !== ui.code) ui.code.value = source;
    paintTop();
    renderSide();
    renderGantt();
  }
}

async function writeSource(next, { undo = true } = {}) {
  if (next === E.source) return;
  if (E.readonly) { toast('Built-in templates are read-only: make an editable copy first', true); return; }
  const prev = E.source;
  try {
    const r = await api('/api/comp', { src: E.src, hash: E.hash, source: next }, 'PUT');
    if (undo) { E.undo.push(prev); if (E.undo.length > 100) E.undo.shift(); E.redo.length = 0; }
    setSource(next, r.hash);
    loadFrame();
  } catch (e) {
    toast(e.message, true);
    await refetch();
  }
}

const edit = (...edits) => writeSource(applyEdits(E.source, edits.filter(Boolean)));

async function refetch() {
  try {
    const r = await api(`/api/comp?src=${encodeURIComponent(E.src)}`);
    if (r.hash !== E.hash) { setSource(r.source, r.hash); loadFrame(); }
  } catch { /* gone */ }
}

async function undo() { if (E.undo.length) { const s = E.undo.pop(); E.redo.push(E.source); await writeSource(s, { undo: false }); } }
async function redo() { if (E.redo.length) { const s = E.redo.pop(); E.undo.push(E.source); await writeSource(s, { undo: false }); } }

/** Set a prop: on the clip when we came from one, else the default in kadr:props. */
function setProp(k, v, { reload = true } = {}) {
  const c = clip();
  if (c) {
    commit(() => { c.props = { ...(c.props || {}), [k]: v }; });
    E.propsKey = JSON.stringify(c.props);
    if (reload) loadFrame();
    renderSide();
    return;
  }
  const m = E.model.meta.props;
  const next = JSON.stringify({ ...E.model.props, [k]: v });
  if (m) edit({ a: m.vr[0], b: m.vr[1], text: escAttr(next, m.q) });
  else toast('This composition has no kadr:props meta to store defaults in', true);
}

// ---------- frame ----------

function frameUrl() {
  const base = isBuiltin() ? `/kadr/builtin/${enc(E.src.slice(6))}` : `/p/${enc(E.src)}`;
  const q = new URLSearchParams({ 'kadr-edit': '1', t: String(E.t) });
  const p = clip()?.props;
  if (p && Object.keys(p).length) q.set('props', JSON.stringify(p));
  return `${base}?${q}`;
}

function loadFrame() {
  if (!ui) return;
  const id = ++E.loadId;
  const W = S.project.width;
  const H = S.project.height;
  const f = h('iframe.ce-frame', { scrolling: 'no', tabindex: '-1', width: W, height: H, style: { width: `${W}px`, height: `${H}px`, visibility: 'hidden' } });
  f.src = frameUrl();
  f.addEventListener('load', () => {
    const k = f.contentWindow?.kadr;
    const done = () => {
      if (id !== E.loadId || !ui) { f.remove(); return; }
      for (const o of ui.canvas.querySelectorAll('iframe')) if (o !== f) o.remove();
      E.frame = f;
      f.style.visibility = '';
      hookFrame(f);
      seekFrame();
      renderSide();
    };
    if (k) k.ready.then(done, done); else done();
  }, { once: true });
  ui.canvas.append(f);
}

function seekFrame() {
  const k = E.frame?.contentWindow?.kadr;
  if (!k) return;
  k.seek(E.t);
  drawBoxes();
  paintTime();
}

function hookFrame(f) {
  const doc = f.contentDocument;
  if (!doc) return;
  const st = doc.createElement('style');
  st.textContent = '*{cursor:default!important}';
  doc.head?.append(st);
  const stackAt = (e) => {
    const out = [];
    for (const el of doc.elementsFromPoint(e.clientX, e.clientY)) {
      const k = el.closest?.('[data-kat]');
      if (k && !out.includes(k)) out.push(k);
    }
    return out;
  };
  doc.addEventListener('pointermove', (e) => {
    const k = stackAt(e)[0];
    E.hover = k ? Number(k.dataset.kat) : null;
    drawBoxes();
  });
  doc.addEventListener('pointerleave', () => { E.hover = null; drawBoxes(); });
  doc.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const stack = stackAt(e);
    if (!stack.length) return select(null);
    // clicking the same spot again walks down to the element underneath
    const same = E.lastPick && Math.abs(E.lastPick.x - e.clientX) < 4 && Math.abs(E.lastPick.y - e.clientY) < 4;
    let i = 0;
    if (same) { const cur = stack.findIndex((x) => Number(x.dataset.kat) === E.sel); i = cur >= 0 ? (cur + 1) % stack.length : 0; }
    E.lastPick = { x: e.clientX, y: e.clientY };
    select(Number(stack[i].dataset.kat));
  }, true);
  doc.addEventListener('keydown', onKey, true);
}

function select(at) {
  E.sel = at;
  if (E.playing) pause();
  drawBoxes();
  renderSide();
  paintGanttHits();
}

// ---------- layout ----------

function fit() {
  if (!ui || !S.project) return;
  const { width: W, height: H } = S.project;
  const r = ui.stage.getBoundingClientRect();
  const pad = 24;
  const s = Math.max(0.03, Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H));
  E.view = { s, ox: Math.round((r.width - W * s) / 2), oy: Math.round((r.height - H * s) / 2) };
  Object.assign(ui.canvas.style, { width: `${W}px`, height: `${H}px`, transform: `translate(${E.view.ox}px, ${E.view.oy}px) scale(${s})`, background: S.project.background || '#000' });
  drawBoxes();
}

function boxFor(at, box) {
  const els = at == null ? [] : [...(fdoc()?.querySelectorAll(`[data-kat="${at}"]`) || [])];
  let r = null;
  for (const el of els) {
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }
  if (!r) { box.hidden = true; return; }
  const { s, ox, oy } = E.view;
  box.hidden = false;
  Object.assign(box.style, { left: `${ox + r.left * s}px`, top: `${oy + r.top * s}px`, width: `${(r.right - r.left) * s}px`, height: `${(r.bottom - r.top) * s}px` });
  const e = E.model.byAt.get(at);
  box.dataset.tag = e ? label(e) : '';
}

function drawBoxes() {
  if (!ui) return;
  boxFor(E.sel, ui.selBox);
  boxFor(E.hover !== E.sel ? E.hover : null, ui.hoverBox);
}

function label(e) {
  const id = e.attrs.id?.v;
  const cls = e.attrs.class?.v.trim().split(/\s+/).slice(0, 2).join('.');
  return `${e.tag}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`;
}

// ---------- transport ----------

const dur = () => E.model?.duration || clip()?.duration || Math.max(1, ...E.model.anims.map((a) => a.delay + a.duration), ...E.model.js.map((j) => j.b.v)) || 5;

let raf = 0;
function play() {
  if (E.playing) return;
  if (E.t >= dur() - 1e-3) E.t = 0;
  E.playing = true;
  ui.play.classList.add('on');
  const t0 = E.t;
  const p0 = performance.now();
  const tick = () => {
    if (!E.playing || !ui) return;
    E.t = t0 + (performance.now() - p0) / 1000;
    if (E.t >= dur()) { E.t = dur(); pause(); seekFrame(); return; }
    seekFrame();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function pause() {
  E.playing = false;
  cancelAnimationFrame(raf);
  ui?.play.classList.remove('on');
}
function seek(t) {
  E.t = Math.max(0, Math.min(dur(), t));
  seekFrame();
}
function paintTime() {
  if (!ui || !E.model) return;
  ui.time.textContent = `${E.t.toFixed(2)}s / ${dur().toFixed(2)}s`;
  const g = ui.gantt.getBoundingClientRect();
  const r = ui.ruler.getBoundingClientRect();
  ui.ph.style.left = `${r.left - g.left + r.width * (E.t / viewDur())}px`;
}

// ---------- side panel ----------

const sec = (title, ...kids) => h('div.sec', {}, h('h4', {}, ...[].concat(title)), ...kids);
const row = (lab, ...kids) => h('div.f', {}, h('label.static', { title: lab }, lab), ...kids);
const stopKeys = (el) => { el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') el.blur(); }); return el; };

function textInput(value, { area = false, onLive, onCommit }) {
  const el = stopKeys(area ? h('textarea.in', { rows: 2, dir: 'auto', spellcheck: false }) : h('input.in', { dir: 'auto', spellcheck: false }));
  el.value = value ?? '';
  if (onLive) el.addEventListener('input', () => onLive(el.value));
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

function numInput(value, { step = 0.05, unit = '', onCommit, onLive }) {
  const el = stopKeys(h('input.in', { type: 'number', step, value: num(value) }));
  if (onLive) el.addEventListener('input', () => { const v = parseFloat(el.value); if (Number.isFinite(v)) onLive(v); });
  el.addEventListener('change', () => { const v = parseFloat(el.value); if (Number.isFinite(v)) onCommit(v); });
  return unit ? h('div.unit', { 'data-u': unit }, el) : el;
}

function colorInput(value, { onLive, onCommit }) {
  const norm = (v) => {
    v = String(v).trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
    const m = v.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    return m ? `#${m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : '#000000';
  };
  const pick = h('input', { type: 'color', value: norm(value) });
  const text = textInput(value, { onCommit: (v) => onCommit(v.trim()) });
  pick.addEventListener('input', () => { text.value = pick.value; onLive?.(pick.value); });
  pick.addEventListener('change', () => onCommit(pick.value));
  return h('div.colorf', {}, pick, text);
}

function imageRow(lab, value, onPick, note) {
  const th = h('div.ce-img', { title: value || 'none', style: value ? { backgroundImage: `url("${thumbUrl(value)}")` } : {} });
  return h('div.ce-imgrow', {},
    th,
    h('div.ce-imgmeta', {}, h('b', {}, lab), h('span', { title: value }, value ? basename(value) : 'none'), note ? h('span.hint', {}, note) : null),
    h('button.btn.sm', { on: { click: async () => {
      const p = await pickImage({ current: fromComp(value || ''), title: `Replace ${lab.toLowerCase()}` });
      if (p) onPick(pathForComp(p));
    } } }, 'Replace'));
}

function animFields(a) {
  return h('div.ce-anim', {},
    h('div.ce-anim-h', {}, h('code', {}, a.name), h('span', {}, a.selector)),
    h('div.row2', {},
      row('Delay', numInput(a.delay, { unit: 's', onCommit: (v) => saveAnim(a, Math.max(0, v), a.duration) })),
      row('Length', numInput(a.duration, { unit: 's', onCommit: (v) => saveAnim(a, a.delay, Math.max(0.01, v)) }))),
    row('Easing', easeSelect(a.easing, CSS_EASES, (v) => saveCssEase(a, v))));
}

function easeSelect(cur, list, onPick) {
  const opts = list.includes(cur) ? list : [cur, ...list];
  const sel = h('select.in', { on: { change: () => onPick(sel.value) } }, ...opts.map((o) => h('option', { value: o }, EASE_NAMES[o] ? `${EASE_NAMES[o]}` : o)));
  sel.value = cur;
  return sel;
}

/** Image sources that live in the element's own source. */
function imageSources(e) {
  const out = [];
  for (const name of ['src', 'href', 'xlink:href', 'poster']) {
    const a = e.attrs[name];
    if (a?.vr && (isImg(decodeEnt(a.v)) || e.tag === 'img' || e.tag === 'image')) out.push({ lab: name === 'poster' ? 'Poster' : 'Image', v: decodeEnt(a.v), set: (p) => edit(attrEdit(e, name, p)) });
  }
  for (const u of styleUrls(E.source, e)) out.push({ lab: 'Background', v: u.v, set: (p) => edit({ a: u.r[0], b: u.r[1], text: escAttr(p, e.attrs.style.q || '"') }) });
  return out;
}

/** Props whose image is what this element shows (set by the comp's script). */
function propImagesShownBy(el) {
  if (!el) return [];
  const win = E.frame.contentWindow;
  const shown = new Set();
  const bg = win.getComputedStyle(el).backgroundImage || '';
  for (const m of bg.matchAll(/url\("?(.*?)"?\)/g)) shown.add(m[1]);
  if (el.currentSrc || el.src) shown.add(el.currentSrc || el.src);
  const href = el.getAttribute?.('href');
  if (href) shown.add(new URL(href, win.location.href).href);
  const out = [];
  for (const [k, v] of Object.entries(props())) {
    if (!isImg(v)) continue;
    let abs;
    try { abs = new URL(v, win.location.href).href; } catch { continue; }
    if (shown.has(abs)) out.push(k);
  }
  return out;
}

function elementSection() {
  const e = E.model.byAt.get(E.sel);
  if (!e) return null;
  const el = liveEl(E.sel);
  const kids = [];
  const dataProp = e.attrs['data-prop']?.v;
  const srcProp = e.attrs['data-prop-src']?.v;
  const p = props();

  // text: a data-prop element shows the prop (the clip's, or the file's default);
  // without either, its own text in the file is the default, so edit that.
  if (dataProp && (clip() || dataProp in E.model.props)) {
    kids.push(row('Text', textInput(p[dataProp] ?? (el?.textContent || ''), {
      area: true,
      onLive: (v) => { for (const x of fdoc().querySelectorAll(`[data-prop="${dataProp}"]`)) x.textContent = v; drawBoxes(); },
      onCommit: (v) => setProp(dataProp, v),
    })), h('div.hint.ce-note', {}, `prop "${dataProp}"${clip() ? ' of this clip' : ' (default in the file)'}`));
  } else if (e.content && !e.kids && !['script', 'style', 'textarea'].includes(e.tag) && (e.text || ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'b', 'i', 'em', 'strong', 'small', 'a', 'li', 'td', 'button', 'label', 'text', 'tspan'].includes(e.tag))) {
    const raw = E.source.slice(e.content[0], e.content[1]);
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.slice(lead.length).match(/\s*$/)[0];
    const cur = decodeEnt(raw.trim());
    if (el && el.textContent.trim() !== cur && cur === '') {
      kids.push(h('div.hint.ce-note', {}, 'The text here is written by the comp\'s script: change it in Props, or in the code.'));
    } else {
      kids.push(row('Text', textInput(cur, {
        area: cur.length > 28 || cur.includes('\n'),
        onLive: (v) => { if (el) el.textContent = v; drawBoxes(); },
        onCommit: (v) => edit({ a: e.content[0], b: e.content[1], text: lead + escText(v) + trail }),
      })));
    }
  } else if (e.kids && e.text) {
    kids.push(h('div.hint.ce-note', {}, 'Mixed text and elements: click a child to edit it, or use Code.'));
  }

  // images
  for (const im of imageSources(e)) kids.push(imageRow(im.lab, im.v, im.set));
  if (srcProp) kids.push(imageRow('Image', p[srcProp], (v) => setProp(srcProp, v), `prop "${srcProp}"`));
  for (const k of propImagesShownBy(el)) if (k !== srcProp) kids.push(imageRow('Image', p[k], (v) => setProp(k, v), `prop "${k}"`));

  // look (HTML elements only: SVG uses fill/stroke)
  if (el && el.namespaceURI === 'http://www.w3.org/1999/xhtml' && e.tag !== 'body') {
    const cs = E.frame.contentWindow.getComputedStyle(el);
    const look = [];
    if (el.textContent.trim()) {
      look.push(row('Color', colorInput(cs.color, {
        onLive: (v) => { el.style.color = v; },
        onCommit: (v) => edit(styleEdit(E.source, e, 'color', v)),
      })));
      look.push(row('Font size', numInput(parseFloat(cs.fontSize), { step: 1, unit: 'px', onLive: (v) => { el.style.fontSize = `${v}px`; drawBoxes(); }, onCommit: (v) => edit(styleEdit(E.source, e, 'font-size', `${Math.round(v * 10) / 10}px`)) })));
    }
    if (look.length) kids.push(h('div.ce-look', {}, ...look));
  }

  // animations that apply to it
  const anims = el ? E.model.anims.filter((a) => { try { return el.matches(a.selector); } catch { return false; } }) : [];
  for (const a of anims) kids.push(animFields(a));

  if (!kids.length) kids.push(h('div.hint', {}, 'Nothing to edit directly here. Click again on the same spot to pick what is underneath, or use Parent.'));
  const parent = e.parent >= 0 ? E.model.els[e.parent] : null;
  return sec([h('span.ce-tag', {}, label(e)), h('span', { style: { display: 'flex', gap: '2px' } },
    parent && parent.tag !== 'html' ? h('button.btn.ghost.sm', { title: 'Select the element around this one', on: { click: () => select(parent.at) } }, 'Parent') : null,
    h('button.btn.ghost.sm', { title: 'Show it in the code', on: { click: () => showCode(e.at, e.tagEnd) } }, 'Code'),
    h('button.btn.ghost.icon.sm', { title: 'Deselect  Esc', on: { click: () => select(null) } }, svg(ICON.x)))], ...kids);
}

function propsSection() {
  const p = props();
  const keys = Object.keys(p);
  if (!keys.length) return null;
  const c = clip();
  const fields = keys.map((k) => {
    const v = p[k];
    const lab = k.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());
    if (isImg(v)) return imageRow(lab, v, (nv) => setProp(k, nv));
    if (typeof v === 'boolean') {
      const b = h('div.seg-pick', {}, ...[[true, 'on'], [false, 'off']].map(([x, t]) => h(`button${v === x ? '.on' : ''}`, { on: { click: () => setProp(k, x) } }, t)));
      return row(lab, b);
    }
    if (typeof v === 'number') return row(lab, numInput(v, { step: Math.abs(v) >= 10 ? 1 : 0.05, onCommit: (nv) => setProp(k, nv) }));
    if (typeof v === 'string' && (isColor(v) || /color|accent|ink|bg$/i.test(k))) return row(lab, colorInput(v, { onCommit: (nv) => setProp(k, nv) }));
    if (v && typeof v === 'object') return row(lab, textInput(JSON.stringify(v), { onCommit: (nv) => { try { setProp(k, JSON.parse(nv)); } catch { toast('Not valid JSON', true); } } }));
    return row(lab, textInput(String(v ?? ''), {
      area: String(v ?? '').length > 28,
      onLive: (nv) => { for (const x of fdoc()?.querySelectorAll(`[data-prop="${k}"]`) || []) x.textContent = nv; },
      onCommit: (nv) => setProp(k, nv),
    }));
  });
  return sec(['Props', h('span.hint', {}, c ? 'this clip' : 'defaults in the file')], ...fields);
}

function varsSection() {
  if (!E.model.vars.length) return null;
  return sec('Variables', ...E.model.vars.map((d) => row(d.name.slice(2), isColor(d.value)
    ? colorInput(d.value, { onLive: (v) => fdoc()?.documentElement.style.setProperty(d.name, v), onCommit: (v) => edit({ a: d.vr[0], b: d.vr[1], text: v }) })
    : textInput(d.value, { onLive: (v) => fdoc()?.documentElement.style.setProperty(d.name, v), onCommit: (v) => edit({ a: d.vr[0], b: d.vr[1], text: v.trim() }) }))));
}

function compSection() {
  const m = E.model.meta;
  return sec('Composition',
    m.duration ? row('Duration', numInput(Number(m.duration.v) || 0, { unit: 's', onCommit: (v) => edit({ a: m.duration.vr[0], b: m.duration.vr[1], text: num(Math.max(0.1, v)) }) })) : null,
    h('div.hint', {}, `${E.model.anims.length} CSS animation${E.model.anims.length === 1 ? '' : 's'} · ${E.model.js.length} script timing${E.model.js.length === 1 ? '' : 's'}`),
    m.description ? h('div.hint', { style: { marginTop: '6px' }, dir: 'auto' }, m.description.v) : null,
    !isBuiltin() ? h('div.actions', { style: { marginTop: '10px', display: 'flex', gap: '6px' } },
      h('button.btn.sm', { on: { click: () => api('/api/reveal', { path: E.src, select: true }).catch(() => {}) } }, 'Show file')) : null);
}

function renderSide() {
  if (!ui || !E.model) return;
  const top = ui.side.scrollTop;
  const kids = [];
  if (E.readonly) {
    kids.push(h('div.ce-ro', {}, h('b', {}, 'Built-in template'), h('span', {}, 'Its props are editable here. To change its text, timing or look, make a copy in comps/.'),
      h('button.btn.sm.primary', { on: { click: makeCopy } }, 'Make an editable copy')));
  }
  kids.push(elementSection() || h('div.sec.ce-tip', {}, h('b', {}, 'Click anything in the frame'), h('span', {}, 'to change its text, image, color or timing. Click the same spot again to reach what is underneath. Drag the bars below to retime animations.')));
  kids.push(propsSection(), varsSection(), compSection());
  ui.side.replaceChildren(...kids.filter(Boolean));
  ui.side.scrollTop = top;
}

async function makeCopy() {
  try {
    const r = await api('/api/comp/copy', { src: E.src });
    const c = clip();
    if (c) commit(() => { c.src = r.path; });
    toast(`Copied to ${r.path}`);
    openCompEditor(r.path, c?.id || null);
  } catch (e) { toast(e.message, true); }
}

// ---------- timing (gantt) ----------

function rows() {
  return [
    ...E.model.anims.map((a, i) => ({ kind: 'css', i, a, label: a.selector, sub: a.name, s: a.delay, e: a.delay + a.duration })),
    ...E.model.js.map((j, i) => ({ kind: 'js', i, j, label: j.label, sub: `line ${j.line}`, s: j.a.v, e: j.b.v })),
  ];
}
const viewDur = () => Math.max(dur(), ...rows().map((r) => r.e)) * 1.02 || 1;

function renderGantt() {
  if (!ui) return;
  const list = rows();
  ui.ganttCount.textContent = list.length ? `${list.length}` : '';
  const vd = viewDur();
  // ruler
  const ticks = [];
  const step = vd > 30 ? 5 : vd > 12 ? 2 : vd > 5 ? 1 : 0.5;
  for (let t = 0; t <= vd + 1e-6; t += step) ticks.push(h('span', { style: { left: `${(t / vd) * 100}%` } }, `${Math.round(t * 10) / 10}s`));
  ui.ruler.replaceChildren(...ticks, h('i.ce-dur', { style: { left: `${(dur() / vd) * 100}%` }, title: 'composition end' }));
  ui.rows.replaceChildren(...list.map((r) => {
    const bar = h(`div.cg-bar.k-${r.kind}`, {}, h('i.l'), h('span'), h('i.r'));
    const track = h('div.cg-track', {}, bar);
    const lab = h('div.cg-lab', {
      title: r.kind === 'css' ? `${r.a.selector} { animation: ${r.a.name} }` : `${r.j.kind}() on line ${r.j.line}: ${r.j.label}`,
      on: {
        click: () => {
          if (r.kind === 'css') {
            const el = [...(fdoc()?.querySelectorAll('[data-kat]') || [])].find((x) => { try { return x.matches(r.a.selector); } catch { return false; } });
            if (el) select(Number(el.dataset.kat));
          } else showCode(r.j.a.r[0], r.j.b.r[1]);
        },
        pointerenter: () => { if (r.kind === 'css') { const el = [...(fdoc()?.querySelectorAll('[data-kat]') || [])].find((x) => { try { return x.matches(r.a.selector); } catch { return false; } }); E.hover = el ? Number(el.dataset.kat) : null; drawBoxes(); } },
        pointerleave: () => { E.hover = null; drawBoxes(); },
      },
    }, h(`span.cg-k.k-${r.kind}`, {}, r.kind === 'css' ? 'CSS' : 'JS'), h('b', { dir: 'auto' }, r.label), h('span', {}, r.sub));
    const el = h('div.cg-row', { 'data-k': `${r.kind}${r.i}` }, lab, track);
    paintBar(bar, r.s, r.e, vd);
    bar.addEventListener('pointerdown', (ev) => dragBar(ev, r, bar, track));
    return el;
  }));
  if (!list.length) ui.rows.append(h('div.empty', {}, 'No editable timings found. CSS animations (animation: name 1s ease .2s) and kadr.progressIn(t, a, b) / kadr.interp(t, [a, b], …) calls show up here.'));
  paintGanttHits();
  paintTime();
}

function paintBar(bar, s, e, vd = viewDur()) {
  bar.style.left = `${(s / vd) * 100}%`;
  bar.style.width = `${Math.max(0.3, ((e - s) / vd) * 100)}%`;
  bar.querySelector('span').textContent = `${num(s)} → ${num(e)}s`;
}

function paintGanttHits() {
  if (!ui) return;
  const el = liveEl(E.sel);
  for (const r of rows()) {
    const rowEl = ui.rows.querySelector(`[data-k="${r.kind}${r.i}"]`);
    if (!rowEl) continue;
    let hit = false;
    if (el && r.kind === 'css') { try { hit = el.matches(r.a.selector); } catch { /* bad selector */ } }
    rowEl.classList.toggle('hit', hit);
  }
}

function liveCss(a, delay, duration) {
  const doc = fdoc();
  if (!doc) return;
  for (const an of doc.getAnimations()) {
    if (an.animationName !== a.name) continue;
    const tg = an.effect?.target;
    try { if (!tg?.matches(a.selector)) continue; } catch { continue; }
    an.effect.updateTiming({ delay: delay * 1000, duration: duration * 1000 });
  }
  E.frame.contentWindow.kadr?.seek(E.t);
  drawBoxes();
}

function dragBar(ev, r, bar, track) {
  ev.preventDefault();
  ev.stopPropagation();
  if (E.readonly) return toast('Built-in templates are read-only: make an editable copy first', true);
  const mode = ev.target.classList.contains('l') ? 'l' : ev.target.classList.contains('r') ? 'r' : 'm';
  const w = track.getBoundingClientRect().width;
  const vd = viewDur();
  const s0 = r.s;
  const e0 = r.e;
  let s = s0;
  let e = e0;
  const min = r.kind === 'css' ? 0.01 : 0.01;
  document.body.style.cursor = mode === 'm' ? 'grabbing' : 'ew-resize';
  bar.classList.add('drag');
  drag(ev, (dx, _dy, mv) => {
    let dt = (dx / w) * vd;
    const snap = (v) => (mv.shiftKey ? v : Math.round(v / SNAP) * SNAP);
    if (mode === 'm') { dt = snap(s0 + dt) - s0; dt = Math.max(-s0, dt); s = s0 + dt; e = e0 + dt; }
    else if (mode === 'l') { s = Math.max(0, Math.min(e0 - min, snap(s0 + dt))); e = e0; }
    else { s = s0; e = Math.max(s0 + min, snap(e0 + dt)); }
    paintBar(bar, s, e, vd);
    if (r.kind === 'css') liveCss(r.a, s, e - s);
  }, (_u, moved) => {
    document.body.style.cursor = '';
    bar.classList.remove('drag');
    if (!moved) return;
    if (r.kind === 'css') saveAnim(r.a, s, e - s);
    else saveJs(r.j, s, e);
  });
}

function saveAnim(a, delay, duration) {
  const D = fmtTime(duration, a.unit);
  const L = fmtTime(delay, a.unit);
  const edits = [];
  if (a.longhand) {
    if (a.dr) edits.push({ a: a.dr[0], b: a.dr[1], text: D });
    else edits.push({ a: a.bodyEnd, b: a.bodyEnd, text: ` animation-duration: ${D};` });
    if (a.lr) edits.push({ a: a.lr[0], b: a.lr[1], text: L });
    else if (delay) edits.push({ a: a.bodyEnd, b: a.bodyEnd, text: ` animation-delay: ${L};` });
    if (!a.dr && !a.lr) edits.splice(0, edits.length, { a: a.bodyEnd, b: a.bodyEnd, text: ` animation-duration: ${D};${delay ? ` animation-delay: ${L};` : ''}` });
  } else if (!a.dr) {
    edits.push({ a: a.ins, b: a.ins, text: `${D} ${delay || a.lr ? `${L} ` : ''}` });
  } else {
    edits.push({ a: a.dr[0], b: a.dr[1], text: D });
    if (a.lr) edits.push({ a: a.lr[0], b: a.lr[1], text: L });
    else if (delay) edits.push({ a: a.ins, b: a.ins, text: ` ${L}` });
  }
  edit(...edits);
}

function saveCssEase(a, v) {
  if (a.er) return edit({ a: a.er[0], b: a.er[1], text: v });
  if (a.longhand) return edit({ a: a.bodyEnd, b: a.bodyEnd, text: ` animation-timing-function: ${v};` });
  return edit({ a: a.ins, b: a.ins, text: a.dr ? ` ${v}` : `${v} ` });
}

function saveJs(j, s, e) {
  edit({ a: j.a.r[0], b: j.a.r[1], text: num(s) }, { a: j.b.r[0], b: j.b.r[1], text: num(e) });
}

// ---------- code ----------

function showCode(a, b) {
  if (!E.code) toggleCode();
  requestAnimationFrame(() => {
    ui.code.focus();
    ui.code.setSelectionRange(a, b);
    const line = E.source.slice(0, a).split('\n').length;
    ui.code.scrollTop = Math.max(0, (line - 4) * 17);
  });
}

function toggleCode() {
  E.code = !E.code;
  ui.root.classList.toggle('code', E.code);
  ui.codeBtn.classList.toggle('on', E.code);
  if (E.code) ui.code.value = E.source;
  requestAnimationFrame(fit);
}

let codeTimer = 0;
function codeInput() {
  clearTimeout(codeTimer);
  ui.codeState.textContent = 'editing…';
  codeTimer = setTimeout(async () => {
    await writeSource(ui.code.value);
    if (ui) ui.codeState.textContent = 'saved';
  }, 700);
}

// ---------- shell ----------

function paintTop() {
  if (!ui) return;
  ui.name.textContent = basename(E.src);
  ui.sub.textContent = `${E.model.title ? `${E.model.title} · ` : ''}${E.src}${clip() ? ` · clip ${clip().id}` : ''}`;
  ui.undo.disabled = !E.undo.length;
  ui.redo.disabled = !E.redo.length;
}

function build() {
  ui?.root.remove();
  const canvas = h('div.ce-canvas');
  const hoverBox = h('div.ce-box.hover', { hidden: true });
  const selBox = h('div.ce-box.sel', { hidden: true });
  const stage = h('div.ce-stage', {}, canvas, hoverBox, selBox);
  const code = h('textarea.ce-code', { spellcheck: false, wrap: 'off' });
  code.addEventListener('input', codeInput);
  code.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(codeTimer); writeSource(code.value); }
  });
  const codeState = h('span.hint');
  const codePane = h('div.ce-codepane', {}, h('div.ce-codebar', {}, h('b', {}, 'Code'), codeState, h('div.grow'), h('span.hint', {}, 'saves as you type · Ctrl+S')), code);
  const side = h('aside.ce-side');
  const playBtn = h('button.btn.icon.ce-play', { title: 'Play / pause  Space', on: { click: () => (E.playing ? pause() : play()) } },
    svg('<path class="i-play" d="M5.5 3.5v9l7-4.5z"/>'), svg('<path d="M5.5 3.5v9M10.5 3.5v9"/>'));
  const time = h('span.ce-time');
  const ruler = h('div.cg-ruler');
  const rowsEl = h('div.cg-rows');
  const ganttCount = h('span.cg-count');
  const ph = h('div.cg-ph');
  const gantt = h('div.ce-gantt', {},
    h('div.cg-head', {}, h('div.cg-lab.cg-hl', {}, playBtn, time, h('span.grow'), h('b', {}, 'Timing'), ganttCount), h('div.cg-track.cg-rt', {}, ruler)),
    rowsEl,
    ph);
  ruler.parentElement.addEventListener('pointerdown', (ev) => {
    const r = ruler.getBoundingClientRect();
    const at = (x) => seek(((x - r.left) / r.width) * viewDur());
    pause();
    at(ev.clientX);
    drag(ev, (_dx, _dy, mv) => at(mv.clientX), () => {});
  });
  const name = h('b');
  const sub = h('span');
  const undoBtn = h('button.btn.ghost.icon', { title: 'Undo  Ctrl+Z', on: { click: undo } }, svg('<path d="M6 4 3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8"/>'));
  const redoBtn = h('button.btn.ghost.icon', { title: 'Redo  Ctrl+Shift+Z', on: { click: redo } }, svg('<path d="m10 4 3 3-3 3m2.5-3H6a3 3 0 0 0 0 6h2"/>'));
  const codeBtn = h('button.btn.ghost.toggle', { title: 'Show the HTML next to the frame', on: { click: toggleCode } }, svg(ICON.code), 'Code');
  const top = h('header.ce-top', {},
    h('span.badge.k-html', {}, 'comp'),
    h('div.ce-title', {}, name, sub),
    h('div.grow'),
    codeBtn, undoBtn, redoBtn,
    h('button.btn', { title: 'Back to the timeline  Esc', on: { click: close } }, 'Done'));
  const root = h('div.ce', {}, top, h('div.ce-main', {}, codePane, stage), side, gantt);
  document.body.append(root);
  ui = { ph, root, canvas, stage, hoverBox, selBox, side, play: playBtn, time, ruler, rows: rowsEl, gantt, ganttCount, code, codeState, name, sub, undo: undoBtn, redo: redoBtn, codeBtn };
  new ResizeObserver(fit).observe(stage);
  new ResizeObserver(() => paintTime()).observe(gantt);
  stage.addEventListener('pointerdown', (e) => { if (e.target === stage) select(null); });
  fit();
}

// ---------- keys ----------

function onKey(e) {
  if (!E.open) return;
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  e.stopPropagation();
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
  if (mod) return;
  if (k === 'Escape') { e.preventDefault(); return E.sel != null ? select(null) : close(); }
  if (k === ' ') { e.preventDefault(); return E.playing ? pause() : play(); }
  if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); pause(); return seek(E.t + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / (S.project?.fps || 30))); }
  if (k === 'Home') return seek(0);
  if (k === 'End') return seek(dur());
}
window.addEventListener('keydown', onKey, true);

// ---------- hooks into the editor ----------

on('asset', (path) => { if (E.open && path === E.src) refetch(); });
on('project', () => {
  if (!E.open) return;
  const c = clip();
  if (E.clipId && !c) return close();
  const key = JSON.stringify(c?.props || {});
  if (key !== E.propsKey) { E.propsKey = key; loadFrame(); renderSide(); }
});

// double-click a composition clip on the timeline
$('#tlRows').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.clip');
  const c = el && S.project?.clips.find((x) => x.id === el.dataset.id);
  if (c?.type === 'html') { e.stopPropagation(); openCompEditor(c.src, c.id); }
});

window.kadrCompEditor = openCompEditor;
