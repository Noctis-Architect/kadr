// Picture effects for the preview, built from the same math as the export
// (shared/model.js): one SVG filter per clip for the grade (white balance, hue,
// sepia matrix → gamma → vignette), and mask images for CSS mask-image.
// The vignette and mask are rasterized by the same functions the export uses.
import { colorMatrix, vignetteMap, maskMap } from '/shared/model.js';

const NS = 'http://www.w3.org/2000/svg';
const host = document.createElementNS(NS, 'svg');
host.setAttribute('width', '0');
host.setAttribute('height', '0');
host.setAttribute('aria-hidden', 'true');
host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
document.body.append(host);

const filters = new Map(); // id -> { el, sig }
const n5 = (v) => Number(v).toFixed(5);

// Chrome doesn't redraw a CSS-referenced SVG filter when its feImage finishes
// loading. The viewer adds a no-op to the filter list whenever this epoch is odd,
// so a bump makes every filter be resolved again.
let epoch = 0;
const listeners = new Set();
export const fxEpoch = () => epoch;
export function onFxLoad(fn) { listeners.add(fn); }
function bump() { epoch++; for (const fn of listeners) fn(); }

/** Gray map (0..255) as a PNG data URL: rgb = map (alpha 255), or white with alpha = map. */
function mapUrl(w, h, data, asAlpha) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const o = i * 4;
    if (asAlpha) { d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = v; } else { d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255; }
  }
  g.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

const vigCache = new Map();
function vignetteUrl(amount) {
  const k = amount.toFixed(3);
  if (!vigCache.has(k)) {
    if (vigCache.size > 24) vigCache.clear();
    // the map depends only on the position in the frame: a small one scales up smoothly
    vigCache.set(k, mapUrl(480, 270, vignetteMap(480, 270, amount), false));
  }
  return vigCache.get(k);
}

/**
 * id of an SVG filter for the clip's grade (to use as `url(#id)`), or '' when it
 * has none. The filter is kept in sync with the clip and reused between frames.
 */
export function gradeFilter(c) {
  const id = `kfx-${c.id}`;
  const M = colorMatrix(c);
  const gamma = c.gamma ?? 1;
  const vig = c.vignette || 0;
  if (!M && gamma === 1 && !(vig > 0)) { dropFilter(id); return ''; }
  const sig = JSON.stringify([M, gamma, vig]);
  let f = filters.get(id);
  if (f?.sig === sig) return id;
  if (!f) {
    const el = document.createElementNS(NS, 'filter');
    el.setAttribute('id', id);
    host.append(el);
    f = { el, sig: '' };
    filters.set(id, f);
  }
  f.sig = sig;
  const el = f.el;
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: 1, height: 1, filterUnits: 'objectBoundingBox', primitiveUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB' })) el.setAttribute(k, v);
  const parts = [];
  let last = 'SourceGraphic';
  if (M) {
    const v = [...M.flatMap((row) => [...row.map(n5), 0, 0]), 0, 0, 0, 1, 0].join(' ');
    parts.push(`<feColorMatrix in="${last}" type="matrix" values="${v}" result="m"/>`);
    last = 'm';
  }
  if (gamma !== 1) {
    const e = n5(1 / gamma);
    parts.push(`<feComponentTransfer in="${last}" result="g"><feFuncR type="gamma" amplitude="1" exponent="${e}" offset="0"/><feFuncG type="gamma" amplitude="1" exponent="${e}" offset="0"/><feFuncB type="gamma" amplitude="1" exponent="${e}" offset="0"/></feComponentTransfer>`);
    last = 'g';
  }
  if (vig > 0) {
    parts.push(`<feImage href="${vignetteUrl(vig)}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="v"/>`);
    // premultiplied multiply: colors by the map, alpha by 1 (the map is opaque)
    parts.push(`<feComposite in="${last}" in2="v" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"/>`);
  }
  el.innerHTML = parts.join('');
  const img = el.querySelector('feImage');
  if (img) {
    img.addEventListener('load', bump, { once: true });
    setTimeout(bump, 120);
  }
  return id;
}

export function dropFilter(id) {
  const f = filters.get(id);
  if (!f) return;
  f.el.remove();
  filters.delete(id);
}

// ---------- masks ----------
const maskCache = new Map(); // key -> data URL
const pending = new Set();

/**
 * Data URL for the clip's mask at a box of w x h (its unscaled size on the canvas),
 * or null until it is ready (`onReady` runs then). Big masks are drawn a bit smaller.
 */
export function maskUrl(mask, w, h, onReady) {
  const f = Math.min(1, 1600 / Math.max(w, h));
  const mw = Math.max(2, Math.round(w * f));
  const mh = Math.max(2, Math.round(h * f));
  const key = `${mw}x${mh}|${JSON.stringify(mask)}`;
  if (maskCache.has(key)) return maskCache.get(key);
  if (!pending.has(key)) {
    pending.add(key);
    setTimeout(() => {
      if (maskCache.size > 40) maskCache.clear();
      maskCache.set(key, mapUrl(mw, mh, maskMap(mw, mh, mask, 0), true));
      pending.delete(key);
      onReady?.();
    }, 0);
  }
  return null;
}
