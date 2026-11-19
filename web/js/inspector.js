import { tc, clipEnd, FITS, sourceSpan, isAnimated, EASES, BLENDS, LABEL_COLORS, MASK_DEFAULTS, KEY_DEFAULTS, MASK_SHAPES, CLIP_DEFAULTS } from '/shared/model.js';
import { S, on, live, commit, seek, select, duration, snapFrame, toast } from './state.js';
import { $, h, svg, ICON, fmtNum, clipName, api, drag } from './util.js';
import { openCompEditor } from './compedit.js';
import { partView, currentPart } from './parts.js';
import { pickImage } from './picker.js';
import { transitionPicker } from './transitions.js';
import { IMG_RE, relPath } from '/shared/htmlsrc.js';
import {
  clipById, deleteSelected, duplicateSelected, splitAtPlayhead, detachAudio, mediaDuration, setSpeed,
  getProp, setProp, toggleKey, keyAt, clearKeys, setEaseHere, keyTimes, jumpKey, localT, prevAdjacent, addDissolve, dipToColor,
  freezeFrame, reverseClip, isLocked, linkClips, unlinkClips, stabilizeClip,
} from './ops.js';
import { LOOKS, GRADE_KEYS, applyLook, currentLook, MOTION, blendName, applyEffect } from './effects.js';
import { openMenu } from './menu.js';
import { pickColorFromClip } from './viewer.js';
import { LABEL_HEX } from './colors.js';

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

/**
 * Slider + number field (Lumetri-style). Values are shown as get() * mul. `zero` is the
 * neutral value the fill grows from (also what a double-click on the label resets to);
 * the slider spans lo..hi while typing allows min..max.
 */
function sliderField(label, get, set, { lo = 0, hi = 1, min = lo, max = hi, step = 0.01, unit = '', digits = 2, zero = lo, mul = 1, kf = null, track = '' } = {}) {
  const range = h('input.sl', { type: 'range', min: lo, max: hi, step, tabindex: '-1' });
  if (track) range.style.setProperty('--track', track);
  const input = h('input.in', { type: 'text', inputmode: 'decimal', spellcheck: false });
  const lab = h('label', { title: 'Drag to scrub · Shift ×10 · double-click to reset' }, label);
  const el = h(kf ? 'div.f.sld.kf' : 'div.f.sld', {}, lab, range, unit ? h('div.unit', { 'data-u': unit }, input) : input);
  const val = () => Number(get()) * mul;
  const pos = (x) => ((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * 100;
  const clampV = (v) => Math.min(max, Math.max(min, v));
  const paint = () => {
    const v = val();
    if (document.activeElement !== range) range.value = String(Math.min(hi, Math.max(lo, v)));
    if (document.activeElement !== input) input.value = fmtNum(v, digits);
    range.style.setProperty('--a', `${Math.min(pos(zero), pos(v))}%`);
    range.style.setProperty('--b', `${Math.max(pos(zero), pos(v))}%`);
    el.classList.toggle('changed', Math.abs(v - zero) > 1e-9);
  };
  const apply = (v, isLive) => {
    if (!Number.isFinite(v)) return paint();
    (isLive ? live : commit)(() => set(clampV(v) / mul));
    paint();
  };
  range.addEventListener('input', () => apply(Number(range.value), true));
  range.addEventListener('change', () => commit());
  range.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { input.value = fmtNum(val(), digits); input.blur(); } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      apply((parseFloat(input.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
    }
    e.stopPropagation();
  });
  input.addEventListener('change', () => apply(parseFloat(input.value)));
  input.addEventListener('blur', paint);
  lab.addEventListener('dblclick', () => apply(zero));
  lab.addEventListener('pointerdown', (e) => {
    const v0 = val();
    document.body.style.cursor = 'ew-resize';
    drag(e, (dx, _dy, ev) => apply(Math.round((v0 + dx * step * (ev.shiftKey ? 10 : 1)) / step) * step, true),
      (_ev, moved) => { document.body.style.cursor = ''; if (moved) commit(); });
  });
  if (kf) {
    const btn = h('button.kfb', { on: { click: () => commit(() => toggleKey(kf.c, kf.k)) } });
    const kpaint = () => {
      const anim = isAnimated(kf.c, kf.k);
      const here = anim && keyAt(kf.c, kf.k) >= 0;
      btn.className = `kfb${anim ? ' anim' : ''}${here ? ' on' : ''}`;
      btn.title = !anim ? 'Animate: add a keyframe at the playhead' : here ? 'Remove the keyframe here' : 'Add a keyframe at the playhead';
      input.classList.toggle('animated', anim);
    };
    fields.push(kpaint);
    kpaint();
    el.append(btn);
  }
  fields.push(paint);
  paint();
  return el;
}

// Sections fold away (remembered per title), like effect groups in other editors.
const folded = new Set((() => { try { return JSON.parse(localStorage.getItem('kadr.folded') || '[]'); } catch { return []; } })());
function sec(title, ...kids) {
  const [name, ...extra] = [].concat(title);
  if (!name) return h('div.sec', {}, ...kids);
  const s = h('div.sec', { class: `sec${folded.has(name) ? ' folded' : ''}` });
  const t = h('button.sec-t', {
    type: 'button',
    on: {
      click: () => {
        if (folded.has(name)) folded.delete(name); else folded.add(name);
        s.classList.toggle('folded', folded.has(name));
        try { localStorage.setItem('kadr.folded', JSON.stringify([...folded])); } catch { /* private */ }
      },
    },
  }, svg('<path d="m6 4 4 4-4 4"/>'), name);
  s.append(h('h4', {}, t, ...extra), h('div.sec-b', {}, ...kids));
  return s;
}
const sub = (text) => h('div.sub', {}, text);
const pct = (label, get, set, o = {}) => numField(label, () => get() * 100, (v) => set(v / 100), { step: 1, unit: '%', min: 0, digits: 0, ...o });

function swatches(get, set, { none = true } = {}) {
  const btns = [...(none ? [null] : []), ...LABEL_COLORS].map((col) => h('button.sw', {
    title: col || 'none', style: col ? { background: LABEL_HEX[col] } : {}, class: col ? 'sw' : 'sw none',
    on: { click: () => commit(() => set(col)) },
  }));
  const paint = () => btns.forEach((b) => b.classList.toggle('on', (b.title === 'none' ? null : b.title) === (get() || null)));
  fields.push(paint);
  paint();
  return h('div.swatches', {}, ...btns);
}
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
      h('div.f', {}, h('label.static', {}, 'Color'), swatches(() => m.color, (v) => { if (v) m.color = v; else delete m.color; })),
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

function blendField(get, set) {
  const sel = h('select.in', { on: { change: () => commit(() => set(sel.value)) } }, ...BLENDS.map((b) => h('option', { value: b }, blendName(b))));
  fields.push(() => { if (document.activeElement !== sel) sel.value = get() || 'normal'; });
  sel.value = get() || 'normal';
  return h('div.f', {}, h('label.static', { title: 'How this picture mixes with the tracks under it' }, 'Blend'), sel);
}

function lookField(each, first) {
  const sel = h('select.in', {
    on: {
      change: () => {
        const look = LOOKS.find((l) => l.id === sel.value) || null;
        commit(() => each((c) => applyLook(c, look)));
      },
    },
  }, h('option', { value: '' }, 'None'), ...LOOKS.map((l) => h('option', { value: l.id }, l.name)), h('option', { value: 'custom', disabled: true }, 'Custom'));
  const paint = () => {
    const c = first();
    if (!c || document.activeElement === sel) return;
    const l = currentLook(c);
    const neutral = GRADE_KEYS.every((k) => (c[k] ?? CLIP_DEFAULTS[k]) === CLIP_DEFAULTS[k]);
    sel.value = l ? l.id : neutral ? '' : 'custom';
  };
  fields.push(paint);
  paint();
  return h('div.f', {}, h('label.static', { title: 'Ready-made grades. Adjust any slider afterwards.' }, 'Look'), sel);
}

/** Lumetri-style color: look, basic correction, creative. */
function colorSection(c) {
  const kv = (k) => [() => c[k] ?? CLIP_DEFAULTS[k], (v) => { c[k] = v; }];
  return sec(['Color', h('button.btn.ghost.sm', { title: 'Back to the original colors', on: { click: () => commit(() => applyLook(c, null)) } }, 'Reset')],
    lookField((fn) => fn(c), () => c),
    sub('Basic correction'),
    sliderField('Brightness', ...kv('brightness'), { lo: 0, hi: 200, max: 400, mul: 100, step: 1, unit: '%', digits: 0, zero: 100 }),
    sliderField('Contrast', ...kv('contrast'), { lo: 0, hi: 200, max: 400, mul: 100, step: 1, unit: '%', digits: 0, zero: 100 }),
    sliderField('Midtones', ...kv('gamma'), { lo: 0.2, hi: 3, min: 0.1, max: 10, step: 0.01, digits: 2, zero: 1 }),
    sliderField('Saturation', ...kv('saturation'), { lo: 0, hi: 200, max: 400, mul: 100, step: 1, unit: '%', digits: 0, zero: 100 }),
    sliderField('Temperature', ...kv('temperature'), { lo: -100, hi: 100, mul: 100, step: 1, digits: 0, zero: 0, track: 'linear-gradient(90deg, #4b8df5, #9a9aa3 50%, #f2b23a)' }),
    sliderField('Tint', ...kv('tint'), { lo: -100, hi: 100, mul: 100, step: 1, digits: 0, zero: 0, track: 'linear-gradient(90deg, #4cc46a, #9a9aa3 50%, #d25bd8)' }),
    sub('Creative'),
    sliderField('Hue', ...kv('hue'), { lo: -180, hi: 180, step: 1, unit: '°', digits: 0, zero: 0, track: 'linear-gradient(90deg, #00f0ff, #0040ff, #ff00e0, #ff3030, #ffe000, #30ff60, #00f0ff)' }),
    sliderField('Sepia', ...kv('sepia'), { lo: 0, hi: 100, mul: 100, step: 1, unit: '%', digits: 0, zero: 0 }),
    sliderField('Vignette', ...kv('vignette'), { lo: 0, hi: 100, mul: 100, step: 1, unit: '%', digits: 0, zero: 0 }));
}

function maskSection(c) {
  if (!c.mask) {
    return sec('Mask', h('div.actions', {},
      h('button.btn.sm', { on: { click: () => commit(() => { c.mask = { ...MASK_DEFAULTS }; }) } }, svg('<ellipse cx="8" cy="8" rx="5.5" ry="4.5"/>'), 'Ellipse'),
      h('button.btn.sm', { on: { click: () => commit(() => { c.mask = { ...MASK_DEFAULTS, shape: 'rect', w: 70, h: 70, feather: 0 }; }) } }, svg('<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>'), 'Rectangle')),
    h('div.hint', { style: { marginTop: '8px' } }, 'Shows only part of the clip, with a soft edge if you like.'));
  }
  const mk = (k) => [() => ({ ...MASK_DEFAULTS, ...c.mask })[k], (v) => { c.mask = { ...c.mask, [k]: v }; }];
  return sec(['Mask', h('button.btn.ghost.sm', { on: { click: () => commit(() => { delete c.mask; }) } }, 'Remove')],
    segField('Shape', MASK_SHAPES.map((s) => [s, s === 'rect' ? 'Rectangle' : 'Ellipse']), ...mk('shape')),
    h('div.row2', {},
      numField('X', ...mk('x'), { step: 0.5, unit: '%', digits: 1 }),
      numField('Y', ...mk('y'), { step: 0.5, unit: '%', digits: 1 })),
    h('div.row2', {},
      numField('W', ...mk('w'), { step: 0.5, unit: '%', min: 0.5, digits: 1 }),
      numField('H', ...mk('h'), { step: 0.5, unit: '%', min: 0.5, digits: 1 })),
    sliderField('Feather', ...mk('feather'), { lo: 0, hi: 60, max: 100, step: 0.5, unit: '%', digits: 1, zero: 0 }),
    segField('Invert', [[false, 'off'], [true, 'on']], ...mk('invert')));
}

function keySection(c) {
  if (!c.key) {
    return sec('Chroma key', h('div.actions', {},
      h('button.btn.sm', { on: { click: () => commit(() => { c.key = { ...KEY_DEFAULTS }; }) } }, h('i.dotc', { style: { background: '#00ff00' } }), 'Green screen'),
      h('button.btn.sm', { on: { click: () => commit(() => { c.key = { ...KEY_DEFAULTS, color: '#0047ff' }; }) } }, h('i.dotc', { style: { background: '#0047ff' } }), 'Blue screen')),
    h('div.hint', { style: { marginTop: '8px' } }, 'Makes a color transparent, so the tracks under the clip show through.'));
  }
  const kk = (k) => [() => ({ ...KEY_DEFAULTS, ...c.key })[k], (v) => { c.key = { ...c.key, [k]: v }; }];
  const picker = h('button.btn.sm.ghost', {
    title: 'Pick the key color: then click on the background in the preview',
    on: {
      click: () => {
        toast('Click the screen color in the preview');
        pickColorFromClip(c.id, (hex) => commit(() => { c.key = { ...c.key, color: hex }; }));
      },
    },
  }, svg('<path d="m10.5 2.5 3 3-7 7H3.5v-3z"/><path d="m9 4 3 3"/>'), 'Pick');
  return sec(['Chroma key', h('button.btn.ghost.sm', { on: { click: () => commit(() => { delete c.key; }) } }, 'Remove')],
    h('div.keyrow', {}, colorField('Key color', ...kk('color')), picker),
    sliderField('Similarity', ...kk('similarity'), { lo: 0, hi: 100, mul: 100, min: 0.1, step: 0.5, unit: '%', digits: 1, zero: 0 }),
    sliderField('Smoothness', ...kk('smooth'), { lo: 0, hi: 50, max: 100, mul: 100, step: 0.5, unit: '%', digits: 1, zero: 0 }),
    sliderField('Spill', ...kk('spill'), { lo: 0, hi: 100, mul: 100, step: 1, unit: '%', digits: 0, zero: 0 }),
    h('div.hint', {}, 'Raise similarity until the background is gone; smoothness softens the edge; spill removes the green or blue cast on the subject.'));
}

function animateBtn(c) {
  return h('button.btn.ghost.sm', {
    title: 'Ready-made motion: zooms, slides, pops, shakes…',
    on: {
      click: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(r.left - 150, r.bottom + 4, MOTION.map((m) => (m.id === 'clear' ? ['-', { label: m.name, danger: true, disabled: !c.keys, on: () => commit(() => m.fn(c)) }] : { label: m.name, on: () => commit(() => m.fn(c)) })).flat(), { cls: 'mb-menu' });
      },
    },
  }, svg('<path d="M2.5 11.5c2-5 4-6 6-3s4 2 5-3"/>'), 'Animate');
}

function viewClip(c) {
  const out = [];
  const info = S.media.get(c.src) || S.templates.get(c.src);
  const sub0 = c.src + (info?.duration ? ` · ${info.duration.toFixed(2)}s` : '') + (info?.width ? ` · ${info.width}×${info.height}` : '');
  const visual = c.type !== 'audio';
  const fxCount = [c.mask, c.key, c.blur > 0 || c.keys?.blur, c.blend && c.blend !== 'normal', GRADE_KEYS.some((k) => (c[k] ?? CLIP_DEFAULTS[k]) !== CLIP_DEFAULTS[k])].filter(Boolean).length;
  out.push(h('div.ihead', {}, h(`span.badge.k-${c.type}`, {}, c.type === 'html' ? (c.src.startsWith('@kadr/') ? 'template' : 'comp') : c.type),
    h('div.t', {}, h('b', { dir: 'auto' }, clipName(c)), h('span', { title: sub0 }, sub0)),
    fxCount ? h('span.fx-badge', { title: `${fxCount} effect${fxCount > 1 ? 's' : ''} on this clip` }, 'fx', h('small', {}, fxCount)) : null));
  const mdur = mediaDuration(c);
  const sp = () => c.speed || 1;
  out.push(sec('Timing',
    timeField('Start', () => c.start, (v) => { c.start = snapFrame(v); }),
    timeField('Duration', () => c.duration, (v) => { c.duration = Math.max(1 / S.project.fps, Math.min(snapFrame(v), Number.isFinite(mdur) ? (mdur - c.in) / sp() : Infinity)); }, { min: 0.001 }),
    c.type !== 'image' ? timeField(c.type === 'html' ? 'Comp in' : 'Source in', () => c.in, (v) => { c.in = Math.max(0, Number.isFinite(mdur) ? Math.min(v, mdur - 0.05) : v); }) : null,
    c.type !== 'image' ? numField('Speed', () => sp() * 100, (v) => setSpeed(c, v / 100), { step: 5, unit: '%', min: 10, max: 1600, digits: 0 }) : null,
    h('div.hint', {}, `ends ${tc(clipEnd(c), S.project.fps)}${sp() !== 1 ? ` · uses ${sourceSpan(c).toFixed(2)}s of source` : ''}`)));
  if (visual) {
    const kfx = (k) => ({ c, k });
    out.push(sec(['Motion', h('span.sec-acts', {}, animateBtn(c), h('button.btn.ghost.sm', { on: { click: () => commit(() => {
      Object.assign(c, { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0, flipH: false, flipV: false, fit: 'contain' });
      if (c.keys) { for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) delete c.keys[k]; if (!Object.keys(c.keys).length) delete c.keys; }
    }) } }, 'Reset'))],
      c.type !== 'html' ? segField('Fit', FITS.map((f) => [f, f]), () => c.fit, (v) => { c.fit = v; }) : null,
      h('div.row2', {},
        numField('X', () => getProp(c, 'x'), (v) => setProp(c, 'x', Math.round(v)), { step: 1, digits: 0, kf: kfx('x') }),
        numField('Y', () => getProp(c, 'y'), (v) => setProp(c, 'y', Math.round(v)), { step: 1, digits: 0, kf: kfx('y') })),
      numField('Scale', () => getProp(c, 'scale') * 100, (v) => setProp(c, 'scale', v / 100), { step: 0.5, unit: '%', min: 1, digits: 1, kf: kfx('scale') }),
      numField('Rotation', () => getProp(c, 'rotation') || 0, (v) => setProp(c, 'rotation', Math.round(v * 10) / 10), { step: 0.5, unit: '°', digits: 1, kf: kfx('rotation') }),
      h('div.f', {}, h('label.static', {}, 'Flip'), h('div.seg-pick', {},
        flipBtn(c, 'flipH', 'Horizontal'), flipBtn(c, 'flipV', 'Vertical')))));
    out.push(sec('Opacity & blend',
      numField('Opacity', () => getProp(c, 'opacity') * 100, (v) => setProp(c, 'opacity', v / 100), { step: 1, unit: '%', min: 0, max: 100, digits: 0, kf: kfx('opacity') }),
      blendField(() => c.blend, (v) => { c.blend = v; })));
    if (c.keys) out.push(keysSection(c));
    out.push(colorSection(c));
    out.push(sec(['Blur', h('button.btn.ghost.sm', { on: { click: () => commit(() => { c.blur = 0; if (c.keys?.blur) { delete c.keys.blur; if (!Object.keys(c.keys).length) delete c.keys; } }) } }, 'Reset')],
      sliderField('Gaussian', () => getProp(c, 'blur') || 0, (v) => setProp(c, 'blur', Math.round(v * 10) / 10), { lo: 0, hi: 100, max: 200, step: 0.5, unit: 'px', digits: 1, zero: 0, kf: kfx('blur') })));
    if (c.type === 'video' || c.type === 'image') out.push(keySection(c));
    out.push(maskSection(c));
    out.push(sec(['Crop', h('button.btn.ghost.sm', { on: { click: () => commit(() => Object.assign(c, { cropT: 0, cropR: 0, cropB: 0, cropL: 0 })) } }, 'Reset')],
      h('div.row2', {},
        numField('L', () => c.cropL || 0, (v) => { c.cropL = Math.min(v, 99 - (c.cropR || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 }),
        numField('R', () => c.cropR || 0, (v) => { c.cropR = Math.min(v, 99 - (c.cropL || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 })),
      h('div.row2', {},
        numField('T', () => c.cropT || 0, (v) => { c.cropT = Math.min(v, 99 - (c.cropB || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 }),
        numField('B', () => c.cropB || 0, (v) => { c.cropB = Math.min(v, 99 - (c.cropT || 0)); }, { step: 0.5, unit: '%', min: 0, max: 99, digits: 1 }))));
  }
  const prev = prevAdjacent(c);
  if (prev || c.xfade > 0) {
    out.push(sec('Transition in',
      transitionPicker(c),
      h('div.hint', {}, prev ? `From ${clipName(prev)}. Click a style to try it; the preview shows it right away.` : 'No clip ends exactly where this one starts, so the transition is inactive.')));
  }
  out.push(sec('Fades',
    h('div.row2', {},
      numField('In', () => c.fadeIn, (v) => { c.fadeIn = Math.min(v, c.duration); }, { step: 0.05, min: 0, digits: 2 }),
      numField('Out', () => c.fadeOut, (v) => { c.fadeOut = Math.min(v, c.duration); }, { step: 0.05, min: 0, digits: 2 }))));
  if (c.type === 'video' || c.type === 'audio') {
    out.push(sec('Audio',
      numField('Volume', () => getProp(c, 'volume') * 100, (v) => setProp(c, 'volume', v / 100), { step: 1, unit: '%', min: 0, max: 400, digits: 0, kf: { c, k: 'volume' } }),
      sliderField('Pan', () => c.pan || 0, (v) => { c.pan = Math.round(v * 1000) / 1000; }, { lo: -100, hi: 100, mul: 100, step: 1, digits: 0, zero: 0, track: 'linear-gradient(90deg, var(--line-2), var(--line-2))' }),
      h('div.actions', { style: { marginTop: '8px' } },
        h('button.btn.sm', { title: 'Set the volume so the loudest moment peaks at -1 dB', on: { click: () => applyEffect('normalize', [c.id]) } }, 'Normalize'),
        h('button.btn.sm', { title: 'Make a copy with less hiss and hum (media/clean/)', on: { click: () => applyEffect('denoise', [c.id]) } }, 'Reduce noise'),
        c.type === 'video' && info?.hasAudio ? h('button.btn.sm', { on: { click: () => detachAudio(c) } }, 'Detach audio') : null)));
    if (c.type === 'audio' && c.keys) out.push(keysSection(c));
  }
  if (c.type === 'html') out.push(propsSection(c, info));
  const linked = c.link ? S.project.clips.filter((x) => x.link === c.link && x.id !== c.id) : [];
  out.push(sec('Clip',
    textField('Label', () => c.label || '', (v) => { c.label = v; }),
    h('div.f', {}, h('label.static', {}, 'Color'), swatches(() => c.labelColor, (v) => { if (v) c.labelColor = v; else delete c.labelColor; })),
    segField('Enabled', [[false, 'on'], [true, 'off']], () => !!c.disabled, (v) => { c.disabled = v; }),
    linked.length ? h('div.linkrow', {}, svg('<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>'),
      h('span', {}, `Linked with ${linked.length} clip${linked.length > 1 ? 's' : ''}: they move and trim together`),
      h('button.btn.ghost.sm', { on: { click: () => unlinkClips([c.id]) } }, 'Unlink')) : null,
    h('div.actions', { style: { marginTop: '10px' } },
      h('button.btn.sm', { on: { click: splitAtPlayhead } }, 'Split'),
      h('button.btn.sm', { on: { click: duplicateSelected } }, 'Duplicate'),
      c.type === 'video' ? h('button.btn.sm', { title: 'Hold the frame under the playhead for 2 s', on: { click: () => freezeFrame(c) } }, 'Freeze frame') : null,
      c.type === 'video' || c.type === 'audio' ? h('button.btn.sm', { title: 'Play this clip backwards (makes a reversed copy in media/reversed)', on: { click: () => reverseClip(c) } }, 'Reverse') : null,
      c.type === 'video' ? h('button.btn.sm', { title: 'Smooth out camera shake (makes a steadied copy in media/stable)', on: { click: () => stabilizeClip(c) } }, 'Stabilize') : null,
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

/** Control for one prop. `spec` comes from the comp's kadr:fields meta (optional). */
function propField(c, k, def, spec) {
  const el = typedField(c, k, def, spec || {});
  if (spec?.description) el.title = spec.description;
  return el;
}

function typedField(c, k, def, spec) {
  const get = () => c.props?.[k] ?? def;
  const set = (v) => { c.props = { ...(c.props || {}), [k]: v }; };
  const label = spec.label || nice(k);
  const sample = c.props?.[k] ?? def;
  const type = spec.type || (Array.isArray(spec.options) ? 'select' : null);
  if (type === 'select' && Array.isArray(spec.options)) return selectField(label, spec.options.map(String), get, (v) => set(typeof def === 'number' ? Number(v) : v));
  if (type === 'boolean') return segField(label, [[true, 'on'], [false, 'off']], get, set);
  if (type === 'number') {
    return numField(label, () => Number(get() ?? 0), set, {
      step: spec.step ?? STEPS[k] ?? 0.05, unit: spec.unit || '', digits: 3,
      min: Number.isFinite(spec.min) ? spec.min : -Infinity, max: Number.isFinite(spec.max) ? spec.max : Infinity,
    });
  }
  if (type === 'color') return colorField(label, get, set);
  if (type === 'image') return imageField(c, label, get, set);
  if (type === 'json') return textField(label, () => (get() == null ? '' : JSON.stringify(get())), (v) => { try { set(v.trim() ? JSON.parse(v) : undefined); } catch { /* typing */ } }, { area: true });
  if (type === 'text' || type === 'longtext') return textField(label, () => get() ?? '', set, { area: type === 'longtext' });
  if (ENUMS[k]) return selectField(label, ENUMS[k], get, set);
  if (typeof sample === 'string' && IMG_RE.test(sample.trim())) return imageField(c, label, get, set);
  if (typeof sample === 'boolean') return segField(label, [[true, 'on'], [false, 'off']], get, set);
  if (typeof sample === 'number') return numField(label, get, set, { step: STEPS[k] ?? (Math.abs(sample) >= 10 ? 1 : 0.05), digits: 3 });
  if (typeof sample === 'string' && (/^#[0-9a-f]{3,8}$/i.test(sample) || /color|accent|bg|ink/i.test(k))) return colorField(label, get, set);
  if (typeof sample === 'object' && sample) return textField(label, () => JSON.stringify(get()), (v) => { try { set(JSON.parse(v)); } catch { /* typing */ } });
  return textField(label, get, set, { area: LONG_TEXT.includes(k) });
}

function imageField(c, label, get, set) {
  const dir = c.src.startsWith('@kadr/') ? null : c.src.split('/').slice(0, -1).join('/');
  const toProject = (v) => {
    if (v.startsWith('/p/')) return decodeURIComponent(v.slice(3));
    const parts = dir ? dir.split('/') : [];
    for (const seg of v.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
    return parts.join('/');
  };
  const th = h('div.ce-img');
  const name = h('span');
  const refresh = () => {
    const v = String(get() ?? '');
    th.style.backgroundImage = v ? `url("/p/${toProject(v).split('/').map(encodeURIComponent).join('/')}")` : '';
    name.textContent = v.split('/').pop() || 'none';
    name.title = v;
  };
  fields.push(refresh);
  refresh();
  const btn = h('button.btn.sm', { on: { click: async () => {
    const p = await pickImage({ current: toProject(String(get() ?? '')), title: `Replace ${label.toLowerCase()}` });
    if (p) commit(() => set(dir == null ? `/p/${p.split('/').map(encodeURIComponent).join('/')}` : relPath(dir, p)));
  } } }, 'Replace');
  return h('div.f', {}, h('label.static', {}, label), h('div.ce-imgrow.mini', {}, th, h('div.ce-imgmeta', {}, name), btn));
}

function propsSection(c, info) {
  const specs = info?.fields || {};
  // Props described only in kadr:fields are optional (no default) but still get a control.
  const schema = { ...Object.fromEntries(Object.keys(specs).map((k) => [k, undefined])), ...(info?.props || {}) };
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
  const visual = h('button.btn.sm.ce-open', { title: 'Open this composition full size: click text and images to change them, drag animation timings  (or double-click the clip)', on: { click: () => openCompEditor(c.src, c.id) } }, svg(ICON.code), 'Edit visually');
  return sec([info?.title || 'Props', h('span', { style: { display: 'flex', gap: '2px' } },
    customized ? h('button.btn.ghost.sm', { title: 'Back to the template defaults', on: { click: () => commit(() => { const o = {}; for (const [a, b] of Object.entries(c.props || {})) if (!(a in schema)) o[a] = b; c.props = o; }) } }, 'Defaults') : null, add)],
    visual,
    ...known.map((k) => propField(c, k, schema[k], specs[k])), ...rows,
    !keys.length ? h('div.hint', {}, 'This composition declares no props. Add some, or ask the chat to make it configurable.') : null,
    info?.description ? h('div.hint', { style: { marginTop: '8px' } }, info.description) : null,
    !c.src.startsWith('@kadr/') ? h('div.hint', { style: { marginTop: '8px' } }, 'Edit ', h('code', {}, c.src), ' (or ask the chat). The preview reloads when it is saved.') : null);
}

function viewMulti() {
  const n = S.sel.size;
  const each = (fn) => { for (const id of S.sel) { const c = clipById(id); if (c) fn(c); } };
  const first = () => clipById([...S.sel][0]);
  const eachV = (fn) => each((c) => { if (c.type !== 'audio') fn(c); });
  const firstV = () => [...S.sel].map(clipById).find((c) => c && c.type !== 'audio');
  const clips = [...S.sel].map(clipById).filter(Boolean);
  const linked = clips.length > 1 && clips[0].link && clips.every((c) => c.link === clips[0].link);
  return [
    h('div.ihead', {}, h('div.t', {}, h('b', {}, `${n} clips selected`), h('span', {}, 'changes apply to each one'))),
    sec('Fades', h('div.row2', {},
      numField('In', () => first()?.fadeIn ?? 0, (v) => each((c) => { c.fadeIn = Math.min(v, c.duration); }), { step: 0.05, min: 0, digits: 2 }),
      numField('Out', () => first()?.fadeOut ?? 0, (v) => each((c) => { c.fadeOut = Math.min(v, c.duration); }), { step: 0.05, min: 0, digits: 2 }))),
    firstV() ? sec('Look',
      lookField(eachV, firstV),
      pct('Opacity', () => firstV()?.opacity ?? 1, (v) => eachV((c) => { c.opacity = v; }), { max: 100 }),
      pct('Saturation', () => firstV()?.saturation ?? 1, (v) => eachV((c) => { c.saturation = v; }), { max: 400 }),
      blendField(() => firstV()?.blend, (v) => eachV((c) => { c.blend = v; }))) : null,
    sec('Audio',
      pct('Volume', () => first()?.volume ?? 1, (v) => each((c) => { c.volume = v; }), { max: 400 })),
    sec('', h('div.actions', {},
      h('button.btn.sm', { on: { click: duplicateSelected } }, 'Duplicate'),
      linked ? h('button.btn.sm', { title: 'Let these clips move on their own again  Ctrl+Shift+G', on: { click: () => unlinkClips([...S.sel]) } }, 'Unlink')
        : h('button.btn.sm', { title: 'Keep these clips together: they move, trim and delete as one  Ctrl+G', on: { click: () => linkClips([...S.sel]) } }, 'Link'),
      h('button.btn.sm', { on: { click: () => select([]) } }, 'Deselect'),
      h('button.btn.sm.danger', { on: { click: () => deleteSelected() } }, 'Delete'))),
  ];
}

function render(o) {
  if (!S.project) return;
  const sel = [...S.sel];
  const c = sel.length === 1 ? clipById(sel[0]) : null;
  const m = S.marker ? S.project.markers.find((x) => x.id === S.marker) : null;
  const key = c ? `clip:${c.id}:${c.type}:${c.src}:${c.volume > 1}:${Object.keys(c.props || {}).join(',')}:${Object.keys(c.keys || {}).join(',')}:${!!prevAdjacent(c)}:${c.xfade > 0}:${S.media.has(c.src) || S.templates.has(c.src)}:${!!c.mask}:${!!c.key}:${c.link || ''}:${S.project.clips.filter((x) => c.link && x.link === c.link).length}`
    : m ? `marker:${m.id}` : sel.length > 1 ? `multi:${sel.join(',')}:${sel.map((id) => clipById(id)?.link || '').join(',')}` : `project:${S.project.width}x${S.project.height}:${S.project.clips.length}`;
  const part = c ? currentPart() : null;
  if (part) {
    const pkey = `part:${c.id}:${part.p.key}:${part.e.hash}:${JSON.stringify(c.props || {})}`;
    if (pkey === built && o !== 'force') return;
    const animate = !built.startsWith('part:');
    built = pkey;
    builtObj = part.p;
    fields = [];
    const top = root.scrollTop;
    root.classList.toggle('anim-in', animate);
    root.replaceChildren(...partView().filter(Boolean));
    if (!animate) root.scrollTop = top;
    return;
  }
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
on('part-changed', () => render('force'));
