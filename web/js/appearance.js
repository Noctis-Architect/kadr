// Appearance: accent color, interface brightness and text size. Kept per
// browser (localStorage); applied as data attributes the stylesheet reads.
import { $, h } from './util.js';

export const ACCENTS = {
  lime: { name: 'Lime', c: '#e8ff59', ink: '#141600' },
  blue: { name: 'Blue', c: '#5b9dff', ink: '#03122b' },
  violet: { name: 'Violet', c: '#a68bff', ink: '#120830' },
  pink: { name: 'Pink', c: '#ff6fb5', ink: '#2b0717' },
  orange: { name: 'Orange', c: '#ff9f43', ink: '#2b1400' },
  mint: { name: 'Mint', c: '#45e0b0', ink: '#032119' },
  red: { name: 'Red', c: '#ff6262', ink: '#2c0505' },
};
const TONES = [['darkest', 'Darkest'], ['dark', 'Dark'], ['gray', 'Graphite']];
const SIZES = [['s', 'Compact'], ['m', 'Normal'], ['l', 'Large']];
const DEF = { accent: 'lime', tone: 'dark', size: 'm', motion: true };

function load() {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem('kadr.appearance') || '{}') }; } catch { return { ...DEF }; }
}
let cur = load();

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function apply(o) {
  const root = document.documentElement;
  const ac = ACCENTS[o.accent] || ACCENTS.lime;
  root.style.setProperty('--accent', ac.c);
  root.style.setProperty('--accent-ink', ac.ink);
  for (const a of [4, 12, 20, 30, 45, 70]) root.style.setProperty(`--a${String(a).padStart(2, '0')}`, hexA(ac.c, a / 100));
  root.dataset.tone = o.tone;
  root.dataset.size = o.size;
  root.dataset.motion = o.motion ? 'on' : 'off';
  // the brand mark follows the accent
  for (const p of document.querySelectorAll('.brand .logo path')) {
    if (p.getAttribute('stroke')) p.setAttribute('stroke', ac.c);
    if (p.getAttribute('fill') && p.getAttribute('fill') !== 'none') p.setAttribute('fill', ac.c);
  }
  window.dispatchEvent(new Event('kadr-theme'));
}

export function initAppearance() { apply(cur); }

function save() {
  try { localStorage.setItem('kadr.appearance', JSON.stringify(cur)); } catch { /* private mode */ }
  apply(cur);
}

export function openAppearance() {
  const back = $('#modal');
  const body = h('div.body.ap');
  const paint = () => {
    const swatch = Object.entries(ACCENTS).map(([k, a]) => h('button.ap-sw', {
      class: `ap-sw${cur.accent === k ? ' on' : ''}`, title: a.name, style: { '--c': a.c },
      on: { click: () => { cur.accent = k; save(); paint(); } },
    }, h('i'), h('span', {}, a.name)));
    const seg = (opts, key) => h('div.seg-pick', {}, ...opts.map(([v, t]) => h('button', {
      class: cur[key] === v ? 'on' : '', on: { click: () => { cur[key] = v; save(); paint(); } },
    }, t)));
    body.replaceChildren(
      h('div.ap-sec', {}, h('label', {}, 'Accent color'), h('div.ap-sws', {}, ...swatch)),
      h('div.ap-sec', {}, h('label', {}, 'Interface'), seg(TONES, 'tone')),
      h('div.ap-sec', {}, h('label', {}, 'Text size'), seg(SIZES, 'size')),
      h('div.ap-sec', {}, h('label', {}, 'Animations'), seg([[true, 'On'], [false, 'Reduced']], 'motion')),
      h('div.hint', {}, 'Saved in this browser. The video itself never changes with these.'),
    );
  };
  paint();
  const close = () => { back.hidden = true; back.replaceChildren(); };
  const modal = h('div.modal.ap-modal', { on: { pointerdown: (e) => e.stopPropagation() } },
    h('header', {}, 'Appearance', h('button.btn.ghost.icon.sm', { title: 'Close', on: { click: close } }, '✕')),
    body,
    h('footer', {}, h('button.btn.ghost', { on: { click: () => { cur = { ...DEF }; save(); paint(); } } }, 'Reset'), h('div.grow'), h('button.btn.primary', { on: { click: close } }, 'Done')));
  back.replaceChildren(modal);
  back.hidden = false;
  back.onpointerdown = close;
}
