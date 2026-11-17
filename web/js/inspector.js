import { tc, clipEnd, FITS, sourceSpan, isAnimated, EASES } from '/shared/model.js';
import { S, on, live, commit, seek, select, duration, snapFrame } from './state.js';
import { $, h, svg, ICON, fmtNum, clipName, api, drag } from './util.js';
import {
  clipById, deleteSelected, duplicateSelected, splitAtPlayhead, detachAudio, mediaDuration, setSpeed,
  getProp, setProp, toggleKey, keyAt, clearKeys, setEaseHere, keyTimes, jumpKey, localT, prevAdjacent, addDissolve, dipToColor,
  freezeFrame, reverseClip, isLocked,
} from './ops.js';

const root = $('#inspector');
let built = '';
let builtObj = null;
let fields = [];

// Props whose values are a fixed set: shown as dropdowns.
const ENUMS = {
  align: ['left', 'center', 'right'], valign: ['top', 'middle', 'bottom'], anim: ['none', 'fade', 'rise', 'type'],
  direction: ['left', 'right', 'up', 'down'], weight: ['300', '400', '500', '600', '700', '800', '900'], fit: FITS,
};
const LONG_TEXT = ['text', 'title', 'subtitle', 'caption'];
const STEPS = { size: 1, pad: 1, y: 1, x: 1, perLine: 1, from: 1, to: 1, decimals: 1, skew: 1, animDur: 0.05, stagger: 0.01, letter: 0.005 };

// ---------- field builders ----------
function numField(label, get, set, { step = 0.01, unit = '', min = -Infinity, max = Infinity, digits = 3, kf = null } = {}) {
  const input = h('input.in', { type: 'text', inputmode: 'decimal', spellcheck: false });
  const lab = h('label', { title: 'Drag to scrub · Shift ×10' }, label);
  const el = h(kf ? 'div.f.kf' : 'div.f', {}, lab, unit ? h('div.unit', { 'data-u': unit }, input) : input);
  if (kf) {
    const btn = h('button.kfb', { on: { click: () => commit(() => toggleKey(kf.c, kf.k)) } });
    const paint = () => {
      const anim = isAnimated(kf.c, kf.k);
      const here = anim && keyAt(kf.c, kf.k) >= 0;
      btn.className = `kfb${anim ? ' anim' : ''}${here ? ' on' : ''}`;
      btn.title = !anim ? 'Animate: add a keyframe at the playhead' : here ? 'Remove the keyframe here' : 'Add a keyframe at the playhead';
      input.classList.toggle('animated', anim);
    };
    fields.push(paint);
    paint();
    el.append(btn);
  }
  const clampV = (v) => Math.min(max, Math.max(min, v));
  const apply = (v, isLive) => {
    if (!Number.isFinite(v)) return refresh();
    (isLive ? live : commit)(() => set(clampV(v)));
  };
  function refresh() { if (document.activeElement !== input) input.value = fmtNum(get(), digits); }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { input.value = fmtNum(get(), digits); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = (parseFloat(input.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      input.value = fmtNum(clampV(v), digits);
      apply(v);
    }
    e.stopPropagation();
  });
  input.addEventListener('change', () => apply(parseFloat(input.value)));
  input.addEventListener('blur', refresh);
  lab.addEventListener('pointerdown', (e) => {
    const v0 = Number(get()) || 0;
    document.body.style.cursor = 'ew-resize';
    drag(e, (dx, _dy, ev) => { apply(Math.round((v0 + dx * step * (ev.shiftKey ? 10 : 1)) / step) * step, true); refresh(); },
      (_ev, moved) => { document.body.style.cursor = ''; if (moved) commit(); });
  });
  fields.push(refresh);
  refresh();
  return el;
}

function timeField(label, get, set, opts = {}) {
  return numField(label, get, set, { step: 1 / (S.project?.fps || 30), unit: 's', min: 0, ...opts });
}

function selectField(label, options, get, set) {
  const sel = h('select.in', { on: { change: () => commit(() => set(sel.value)) } }, ...options.map((o) => h('option', { value: o }, o)));
  fields.push(() => { if (document.activeElement !== sel) sel.value = String(get()); });
  sel.value = String(get());
  return h('div.f', {}, h('label.static', {}, label), sel);
}

function segField(label, options, get, set) {
  const btns = options.map(([v, t]) => h('button', { on: { click: () => commit(() => set(v)) } }, t));
  const refresh = () => btns.forEach((b, i) => b.classList.toggle('on', String(get()) === String(options[i][0])));
  fields.push(refresh);
  refresh();
  return h('div.f', {}, h('label.static', {}, label), h('div.seg-pick', {}, ...btns));
}

function textField(label, get, set, { area = false } = {}) {
  const input = area ? h('textarea.in', { spellcheck: false, rows: 2, dir: 'auto' }) : h('input.in', { type: 'text', spellcheck: false, dir: 'auto', style: { fontFamily: 'var(--sans)' } });
  input.value = get() ?? '';
  input.addEventListener('input', () => live(() => set(input.value)));
  input.addEventListener('change', () => commit(() => set(input.value)));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !area) input.blur(); e.stopPropagation(); });
  fields.push(() => { if (document.activeElement !== input) input.value = get() ?? ''; });
  return h('div.f', {}, h('label.static', {}, label), input);
}

function colorField(label, get, set) {
  const text = h('input.in', { type: 'text', spellcheck: false });
  const pick = h('input', { type: 'color' });
  const norm = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : '#000000');
  const refresh = () => { const v = get() ?? ''; if (document.activeElement !== text) text.value = v; pick.value = norm(v); };
  pick.addEventListener('input', () => { text.value = pick.value; live(() => set(pick.value)); });
  pick.addEventListener('change', () => commit(() => set(pick.value)));
  text.addEventListener('change', () => commit(() => set(text.value.trim())));
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') text.blur(); e.stopPropagation(); });
  fields.push(refresh);
  refresh();
  return h('div.f', {}, h('label.static', {}, label), h('div.colorf', {}, pick, text));
}

const sec = (title, ...kids) => h('div.sec', {}, h('h4', {}, ...[].concat(title)), ...kids);
const pct = (label, get, set, o = {}) => numField(label, () => get() * 100, (v) => set(v / 100), { step: 1, unit: '%', min: 0, digits: 0, ...o });
const nice = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

// ---------- views ----------
function viewProject() {
  const p = S.project;
  const presets = { '1920x1080': '16:9 · 1080p', '3840x2160': '16:9 · 4K', '2560x1440': '16:9 · 1440p', '1280x720': '16:9 · 720p', '1080x1920': '9:16 · vertical', '1080x1080': '1:1 · square', '1080x1350': '4:5 · portrait' };
  const cur = `${p.width}x${p.height}`;
  const sizeSel = h('select.in', { on: { change: () => { if (sizeSel.value === 'custom') return; const [w, hh] = sizeSel.value.split('x').map(Number); commit((pp) => { pp.width = w; pp.height = hh; }); } } },
    ...Object.entries(presets).map(([k, v]) => h('option', { value: k }, `${k.replace('x', '×')}   ${v}`)),
    h('option', { value: 'custom' }, 'Custom'));
  sizeSel.value = presets[cur] ? cur : 'custom';
  return [
    h('div.ihead', {}, h('div.t', {}, h('b', {}, p.name || 'Project'), h('span', {}, `${p.width}×${p.height} · ${p.fps} fps · ${tc(duration(), p.fps)}`))),
    sec('Sequence',
      textField('Name', () => S.project.name, (v) => { S.project.name = v; }),
      h('div.f', {}, h('label.static', {}, 'Format'), sizeSel),
      h('div.row2', {},
        numField('W', () => S.project.width, (v) => { S.project.width = Math.max(2, Math.round(v / 2) * 2); }, { step: 2, digits: 0, min: 2 }),
        numField('H', () => S.project.height, (v) => { S.project.height = Math.max(2, Math.round(v / 2) * 2); }, { step: 2, digits: 0, min: 2 })),
      selectField('Frame rate', ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'], () => S.project.fps, (v) => { S.project.fps = Number(v); }),
      colorField('Background', () => S.project.background, (v) => { S.project.background = v; })),
    sec('Project', h('div.hint', {},
      `${p.clips.length} clips · ${p.tracks.length} tracks · ${S.media.size} files`, h('br'),
      'Select a clip to edit it, or open Chat and describe what you want.')),
  ];
}

function viewMarker(m) {
  return [
    h('div.ihead', {}, h('span.badge', { style: { background: '#3d2c1b', color: '#ffc58a' } }, 'Marker'), h('div.t', {}, h('b', { dir: 'auto' }, m.note ? m.note.split('\n')[0] : 'Marker'), h('span', {}, m.id))),
    sec('Marker',
      timeField('Time', () => m.t, (v) => { m.t = snapFrame(v); }),
      textField('Note', () => m.note, (v) => { m.note = v; }, { area: true }),
      h('div.hint', {}, 'The chat and other agents read markers, so a note like "cut here" or "add a title" works as an instruction.')),
    sec('', h('div.actions', {},
      h('button.btn.sm', { on: { click: () => seek(m.t) } }, 'Go to'),
      h('button.btn.sm.danger', { on: { click: () => deleteSelected() } }, 'Delete'))),
  ];
}

function flipBtn(c, k, label) {
  const b = h('button', { on: { click: () => commit(() => { c[k] = !c[k]; }) } }, label);
  fields.push(() => b.classList.toggle('on', !!c[k]));
  b.classList.toggle('on', !!c[k]);
  return b;
}

function keysSection(c) {
  const times = h('div.kf-times');
  const easeSel = h('select.in', { on: { change: () => commit(() => setEaseHere(c, easeSel.value)) } }, ...EASES.map((e) => h('option', { value: e }, e)));
  const refresh = () => {
    const ts = keyTimes(c);
    const u = localT(c);
    times.replaceChildren(...ts.map((t) => h('button', { class: Math.abs(t - u) < 0.5 / S.project.fps ? 'on' : '', title: `${t.toFixed(2)}s into the clip`, on: { click: () => seek(c.start + t) } }, `${t.toFixed(2)}`)));
    let e = 'ease';
    for (const list of Object.values(c.keys || {})) for (const x of list) if (x[0] <= u + 0.5 / S.project.fps) e = x[2] || 'ease';
    if (document.activeElement !== easeSel) easeSel.value = e;
  };
  fields.push(refresh);
  refresh();
  const animated = Object.keys(c.keys || {});
  return sec(['Keyframes', h('span', { style: { display: 'flex', gap: '2px' } },
    h('button.btn.ghost.sm', { title: 'Previous keyframe  [', on: { click: () => jumpKey(-1) } }, '‹'),
    h('button.btn.ghost.sm', { title: 'Next keyframe  ]', on: { click: () => jumpKey(1) } }, '›'))],
    times,
    h('div.f', {}, h('label.static', { title: 'How the value moves from the keyframe at (or before) the playhead to the next one' }, 'Easing'), easeSel),
    h('div.hint', {}, `Animated: ${animated.join(', ')}. Edit a value with the playhead anywhere to add a keyframe there.`),
    h('div.actions', { style: { marginTop: '8px' } }, h('button.btn.ghost.sm', { on: { click: () => commit(() => { for (const k of animated) clearKeys(c, k); }) } }, 'Remove all keyframes')));
}

function viewClip(c) {
  const out = [];
  const info = S.media.get(c.src) || S.templates.get(c.src);
  const sub = c.src + (info?.duration ? ` · ${info.duration.toFixed(2)}s` : '') + (info?.width ? ` · ${info.width}×${info.height}` : '');
  out.push(h('div.ihead', {}, h(`span.badge.k-${c.type}`, {}, c.type === 'html' ? (c.src.startsWith('@kadr/') ? 'template' : 'comp') : c.type),
    h('div.t', {}, h('b', { dir: 'auto' }, clipName(c)), h('span', { title: sub }, sub))));
  const mdur = mediaDuration(c);
  const sp = () => c.speed || 1;
  out.push(sec('Timing',
    timeField('Start', () => c.start, (v) => { c.start = snapFrame(v); }),
    timeField('Duration', () => c.duration, (v) => { c.duration = Math.max(1 / S.project.fps, Math.min(snapFrame(v), Number.isFinite(mdur) ? (mdur - c.in) / sp() : Infinity)); }, { min: 0.001 }),
    c.type !== 'image' ? timeField(c.type === 'html' ? 'Comp in' : 'Source in', () => c.in, (v) => { c.in = Math.max(0, Number.isFinite(mdur) ? Math.min(v, mdur - 0.05) : v); }) : null,
    c.type !== 'image' ? numField('Speed', () => sp() * 100, (v) => setSpeed(c, v / 100), { step: 5, unit: '%', min: 10, max: 1600, digits: 0 }) : null,
    h('div.hint', {}, `ends ${tc(clipEnd(c), S.project.fps)}${sp() !== 1 ? ` · uses ${sourceSpan(c).toFixed(2)}s of source` : ''}`)));
  if (c.type !== 'audio') {
    const kfx = (k) => ({ c, k });
    out.push(sec(['Transform', h('button.btn.ghost.sm', { on: { click: () => commit(() => {
      Object.assign(c, { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0, flipH: false, flipV: false, fit: 'contain' });
      if (c.keys) { for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) delete c.keys[k]; if (!Object.keys(c.keys).length) delete c.keys; }
    }) } }, 'Reset')],
      c.type !== 'html' ? segField('Fit', FITS.map((f) => [f, f]), () => c.fit, (v) => { c.fit = v; }) : null,
      h('div.row2', {},
        numField('X', () => getProp(c, 'x'), (v) => setProp(c, 'x', Math.round(v)), { step: 1, digits: 0, kf: kfx('x') }),
        numField('Y', () => getProp(c, 'y'), (v) => setProp(c, 'y', Math.round(v)), { step: 1, digits: 0, kf: kfx('y') })),
      numField('Scale', () => getProp(c, 'scale') * 100, (v) => setProp(c, 'scale', v / 100), { step: 0.5, unit: '%', min: 1, digits: 1, kf: kfx('scale') }),
      numField('Rotation', () => getProp(c, 'rotation') || 0, (v) => setProp(c, 'rotation', Math.round(v * 10) / 10), { step: 0.5, unit: '°', digits: 1, kf: kfx('rotation') }),
      numField('Opacity', () => getProp(c, 'opacity') * 100, (v) => setProp(c, 'opacity', v / 100), { step: 1, unit: '%', min: 0, max: 100, digits: 0, kf: kfx('opacity') }),
      h('div.f', {}, h('label.static', {}, 'Flip'), h('div.seg-pick', {},
        flipBtn(c, 'flipH', 'Horizontal'), flipBtn(c, 'flipV', 'Vertical')))));
    if (c.keys) out.push(keysSection(c));
    out.push(sec(['Crop', h('button.btn.ghost.sm', { on: { click: () => commit(() => Object.assign(c, { cropT: 0, cropR: 0, cropB: 0, cropL: 0 })) } }, 'Reset')],
      h('div.row2', {},
        numField('L', () => c.cropL || 0, (v) => { c.cropL = Math.min(v, 99 - (c.cropR || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 }),
        numField('R', () => c.cropR || 0, (v) => { c.cropR = Math.min(v, 99 - (c.cropL || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 })),
      h('div.row2', {},
        numField('T', () => c.cropT || 0, (v) => { c.cropT = Math.min(v, 99 - (c.cropB || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 }),
        numField('B', () => c.cropB || 0, (v) => { c.cropB = Math.min(v, 99 - (c.cropT || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 }))));
    out.push(sec(['Color', h('button.btn.ghost.sm', { on: { click: () => commit(() => Object.assign(c, { brightness: 1, contrast: 1, saturation: 1 })) } }, 'Reset')],
      pct('Brightness', () => c.brightness ?? 1, (v) => { c.brightness = v; }, { max: 400 }),
      pct('Contrast', () => c.contrast ?? 1, (v) => { c.contrast = v; }, { max: 400 }),
      pct('Saturation', () => c.saturation ?? 1, (v) => { c.saturation = v; }, { max: 400 })));
  }
  const prev = prevAdjacent(c);
  if (prev || c.xfade > 0) {
    out.push(sec('Transition in',
      numField('Dissolve', () => c.xfade || 0, (v) => { c.xfade = Math.min(v, c.duration, prev ? prev.duration : v); }, { step: 1 / S.project.fps, unit: 's', min: 0, digits: 2 }),
      h('div.actions', {},
        h('button.btn.sm', { title: 'Cross dissolve from the previous clip, centred on the cut', on: { click: () => addDissolve(c, c.xfade || 0.5) } }, 'Cross dissolve'),
        h('button.btn.sm', { title: 'Fade the previous clip out and this one in', on: { click: () => dipToColor(c, 0.6) } }, 'Dip to black'),
        c.xfade > 0 ? h('button.btn.ghost.sm', { on: { click: () => commit(() => { c.xfade = 0; }) } }, 'Remove') : null),
      h('div.hint', {}, prev ? `From ${clipName(prev)}. Both clips play ${((c.xfade || 0.5) / 2).toFixed(2)}s past the cut (holding a frame if the media runs out).` : 'No clip ends exactly where this one starts, so the dissolve is inactive.')));
  }
  out.push(sec('Fades',
    h('div.row2', {},
      numField('In', () => c.fadeIn, (v) => { c.fadeIn = Math.min(v, c.duration); }, { step: 0.05, min: 0, digits: 2 }),
      numField('Out', () => c.fadeOut, (v) => { c.fadeOut = Math.min(v, c.duration); }, { step: 0.05, min: 0, digits: 2 }))));
  if (c.type === 'video' || c.type === 'audio') {
    out.push(sec('Audio',
      numField('Volume', () => getProp(c, 'volume') * 100, (v) => setProp(c, 'volume', v / 100), { step: 1, unit: '%', min: 0, max: 400, digits: 0, kf: { c, k: 'volume' } }),
      c.type === 'video' && info?.hasAudio ? h('div.actions', {}, h('button.btn.sm', { on: { click: () => detachAudio(c) } }, 'Detach audio')) : null,
      c.volume > 1 ? h('div.hint', {}, 'Above 100% applies on export; the preview plays at 100%.') : null));
    if (c.type === 'audio' && c.keys) out.push(keysSection(c));
  }
  if (c.type === 'html') out.push(propsSection(c, info));
  out.push(sec('Clip',
    textField('Label', () => c.label || '', (v) => { c.label = v; }),
    segField('Enabled', [[false, 'on'], [true, 'off']], () => !!c.disabled, (v) => { c.disabled = v; }),
    h('div.actions', { style: { marginTop: '10px' } },
      h('button.btn.sm', { on: { click: splitAtPlayhead } }, 'Split'),
      h('button.btn.sm', { on: { click: duplicateSelected } }, 'Duplicate'),
      c.type === 'video' ? h('button.btn.sm', { title: 'Hold the frame under the playhead for 2 s', on: { click: () => freezeFrame(c) } }, 'Freeze frame') : null,
      c.type === 'video' || c.type === 'audio' ? h('button.btn.sm', { title: 'Play this clip backwards (makes a reversed copy in media/reversed)', on: { click: () => reverseClip(c) } }, 'Reverse') : null,
      !c.src.startsWith('@kadr/') ? h('button.btn.sm', { title: 'Open the folder that holds this file', on: { click: () => api('/api/reveal', { path: c.src, select: true }) } }, 'Show file') : null,
      h('button.btn.sm.danger', { on: { click: () => deleteSelected() } }, 'Delete')),
    h('div.copyable', { style: { marginTop: '10px' }, title: 'The chat and agents find this clip by its id' }, `id  ${c.id}`)));
  return out;
}

function parseVal(s) {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[[{]/.test(t)) { try { return JSON.parse(t); } catch { /* keep string */ } }
  return s;
}
const showVal = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

function propField(c, k, def) {
  const get = () => c.props?.[k] ?? def;
  const set = (v) => { c.props = { ...(c.props || {}), [k]: v }; };
  const label = nice(k);
  const sample = c.props?.[k] ?? def;
  if (ENUMS[k]) return selectField(label, ENUMS[k], get, set);
  if (typeof sample === 'boolean') return segField(label, [[true, 'on'], [false, 'off']], get, set);
  if (typeof sample === 'number') return numField(label, get, set, { step: STEPS[k] ?? (Math.abs(sample) >= 10 ? 1 : 0.05), digits: 3 });
  if (typeof sample === 'string' && (/^#[0-9a-f]{3,8}$/i.test(sample) || /color|accent|bg|ink/i.test(k))) return colorField(label, get, set);
  if (typeof sample === 'object' && sample) return textField(label, () => JSON.stringify(get()), (v) => { try { set(JSON.parse(v)); } catch { /* typing */ } });
  return textField(label, get, set, { area: LONG_TEXT.includes(k) });
}

function propsSection(c, info) {
  const schema = info?.props || {};
  const keys = [...new Set([...Object.keys(schema), ...Object.keys(c.props || {})])];
  const known = keys.filter((k) => k in schema);
  const extra = keys.filter((k) => !(k in schema));
  const rows = extra.map((k) => {
    const key = h('input.k', { value: k, spellcheck: false });
    const val = h('input', { value: showVal(c.props[k]), spellcheck: false, dir: 'auto' });
    key.addEventListener('change', () => {
      const nk = key.value.trim();
      if (!nk || nk === k) { key.value = k; return; }
      commit(() => { const o = {}; for (const [a, b] of Object.entries(c.props)) o[a === k ? nk : a] = b; c.props = o; });
    });
    val.addEventListener('input', () => live(() => { c.props = { ...c.props, [k]: parseVal(val.value) }; }));
    val.addEventListener('change', () => commit(() => { c.props = { ...c.props, [k]: parseVal(val.value) }; }));
    for (const i of [key, val]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation(); });
    return h('div.kv', {}, key, val, h('button', { title: 'Remove', on: { click: () => commit(() => { const o = { ...c.props }; delete o[k]; c.props = o; }) } }, svg(ICON.x)));
  });
  const add = h('button.btn.ghost.sm', { on: { click: () => {
    let n = 'prop';
    for (let i = 2; (c.props && n in c.props) || n in schema; i++) n = `prop${i}`;
    commit(() => { c.props = { ...(c.props || {}), [n]: '' }; });
  } } }, '+ Add');
  const customized = Object.keys(c.props || {}).some((k) => k in schema);
  return sec([info?.title || 'Props', h('span', { style: { display: 'flex', gap: '2px' } },
    customized ? h('button.btn.ghost.sm', { title: 'Back to the template defaults', on: { click: () => commit(() => { const o = {}; for (const [a, b] of Object.entries(c.props || {})) if (!(a in schema)) o[a] = b; c.props = o; }) } }, 'Defaults') : null, add)],
    ...known.map((k) => propField(c, k, schema[k])), ...rows,
    !keys.length ? h('div.hint', {}, 'This composition declares no props. Add some, or ask the chat to make it configurable.') : null,
    info?.description ? h('div.hint', { style: { marginTop: '8px' } }, info.description) : null,
    !c.src.startsWith('@kadr/') ? h('div.hint', { style: { marginTop: '8px' } }, 'Edit ', h('code', {}, c.src), ' (or ask the chat). The preview reloads when it is saved.') : null);
}

function viewMulti() {
  const n = S.sel.size;
  const each = (fn) => { for (const id of S.sel) { const c = clipById(id); if (c) fn(c); } };
  const first = () => clipById([...S.sel][0]);
  return [
    h('div.ihead', {}, h('div.t', {}, h('b', {}, `${n} clips selected`), h('span', {}, 'changes apply to each one'))),
    sec('Fades', h('div.row2', {},
      numField('In', () => first()?.fadeIn ?? 0, (v) => each((c) => { c.fadeIn = Math.min(v, c.duration); }), { step: 0.05, min: 0, digits: 2 }),
      numField('Out', () => first()?.fadeOut ?? 0, (v) => each((c) => { c.fadeOut = Math.min(v, c.duration); }), { step: 0.05, min: 0, digits: 2 }))),
    sec('Look',
      pct('Opacity', () => first()?.opacity ?? 1, (v) => each((c) => { c.opacity = v; }), { max: 100 }),
      pct('Saturation', () => first()?.saturation ?? 1, (v) => each((c) => { c.saturation = v; }), { max: 400 }),
      pct('Volume', () => first()?.volume ?? 1, (v) => each((c) => { c.volume = v; }), { max: 400 })),
    sec('', h('div.actions', {},
      h('button.btn.sm', { on: { click: duplicateSelected } }, 'Duplicate'),
      h('button.btn.sm', { on: { click: () => select([]) } }, 'Deselect'),
      h('button.btn.sm.danger', { on: { click: () => deleteSelected() } }, 'Delete'))),
  ];
}

function render(o) {
  if (!S.project) return;
  const sel = [...S.sel];
  const c = sel.length === 1 ? clipById(sel[0]) : null;
  const m = S.marker ? S.project.markers.find((x) => x.id === S.marker) : null;
  const key = c ? `clip:${c.id}:${c.type}:${c.src}:${c.volume > 1}:${Object.keys(c.props || {}).join(',')}:${Object.keys(c.keys || {}).join(',')}:${!!prevAdjacent(c)}:${c.xfade > 0}:${S.media.has(c.src) || S.templates.has(c.src)}`
    : m ? `marker:${m.id}` : sel.length > 1 ? `multi:${sel.join(',')}` : `project:${S.project.width}x${S.project.height}:${S.project.clips.length}`;
  const obj = c || m || S.project;
  if (key === built && obj === builtObj && o !== 'force') {
    for (const f of fields) f();
    return;
  }
  const kind = key.split(':')[0] + (c ? c.id : '');
  const animate = built.split(':')[0] + (builtObj?.id || '') !== kind;
  built = key;
  builtObj = obj;
  fields = [];
  const view = c ? viewClip(c) : m ? viewMarker(m) : sel.length > 1 ? viewMulti() : viewProject();
  const top = root.scrollTop;
  root.classList.toggle('anim-in', animate);
  root.replaceChildren(...view.filter(Boolean));
  if (!animate) root.scrollTop = top;
}

on('project', () => render());
on('time', () => { if (S.sel.size === 1) for (const f of fields) f(); });
on('select', () => render());
on('media', () => render('force'));
