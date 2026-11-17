import { S, authHeaders } from './state.js';

export const $ = (sel, root = document) => root.querySelector(sel);

/** h('div.cls#id', {attrs, on: {click}}, ...children) */
export function h(spec, attrs = {}, ...kids) {
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [e, fn] of Object.entries(v)) el.addEventListener(e, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

export const svg = (path, vb = '0 0 16 16') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', vb);
  s.innerHTML = path;
  return s;
};

export const ICON = {
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M2 2l12 12M6.5 3.8A6.6 6.6 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a11 11 0 0 1-1.9 2.4M4.2 5.3C2.5 6.5 1.5 8 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.6-.6"/>',
  sound: '<path d="M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8"/>',
  mute: '<path d="M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 6l4 4M15 6l-4 4"/>',
  film: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3"/>',
  wave: '<path d="M2 8h1M4.5 5v6M7 3v10M9.5 6v4M12 4.5v7M14 8h0"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 4-4 3 3 2-2 2.5 2.5"/>',
  code: '<path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5"/>',
  text: '<path d="M3 4V3h10v1M8 3v10M6 13h4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  spark: '<path d="M8 1.8 9.3 6.7 14.2 8 9.3 9.3 8 14.2 6.7 9.3 1.8 8 6.7 6.7z"/>',
  layout: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6.5h12M6.5 6.5v7"/>',
  upload: '<path d="M8 10.5V2.5M5 5.5l3-3 3 3M3 10v2a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12v-2"/>',
  chat: '<path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11.5H8l-3 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>',
};

const builtinPath = (src) => `/kadr/builtin/${src.slice(6)}`;

/** URL used by the preview for a clip source (uses the proxy when the original can't play in a browser). */
export function mediaUrl(src) {
  if (src.startsWith('@kadr/')) return builtinPath(src);
  const info = S.media.get(src);
  const p = info?.proxy || src;
  return `/p/${p.split('/').map(encodeURIComponent).join('/')}`;
}

export function compUrl(src, props) {
  const base = src.startsWith('@kadr/') ? builtinPath(src) : `/p/${src.split('/').map(encodeURIComponent).join('/')}`;
  return props && Object.keys(props).length ? `${base}?props=${encodeURIComponent(JSON.stringify(props))}` : base;
}

export const basename = (p) => String(p).split('/').pop();

export function clipName(c) {
  if (c.label) return c.label;
  if (c.src === '@kadr/text.html') return c.props?.text ? String(c.props.text).split('\n')[0] : 'Text';
  if (c.src.startsWith('@kadr/')) {
    const t = S.templates.get(c.src);
    const main = c.props?.text || c.props?.title || c.props?.name;
    return `${t?.title || basename(c.src)}${main ? ` · ${String(main).split('\n')[0].replace(/\*/g, '')}` : ''}`;
  }
  // a composition: its <title> reads better than the file name
  if (c.type === 'html') { const t = S.media.get(c.src)?.title; if (t) return t; }
  return basename(c.src);
}

export function fmtDur(s) {
  if (s == null || !Number.isFinite(s)) return '';
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function fmtNum(v, d = 3) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return String(Math.round(v * 10 ** d) / 10 ** d);
}

/** Drag helper: calls move(dx, dy, e) and up(e, moved). */
export function drag(e, move, up) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const mm = (ev) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    moved = true;
    move(dx, dy, ev);
  };
  const mu = (ev) => {
    window.removeEventListener('pointermove', mm);
    window.removeEventListener('pointerup', mu);
    window.removeEventListener('pointercancel', mu);
    up?.(ev, moved);
  };
  window.addEventListener('pointermove', mm);
  window.addEventListener('pointerup', mu);
  window.addEventListener('pointercancel', mu);
}

export async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(path, { method, headers: authHeaders(body !== undefined ? { 'content-type': 'application/json' } : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (j.errors || []).join('\n') || r.statusText);
  return j;
}

export function upload(file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/upload?name=${encodeURIComponent(file.name)}`);
    for (const [k, v] of Object.entries(authHeaders())) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error(x.responseText)));
    x.onerror = () => reject(new Error('upload failed'));
    x.send(file);
  });
}
