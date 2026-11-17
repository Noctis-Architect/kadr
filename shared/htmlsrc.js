// Source-level reader for composition HTML. It finds the parts a GUI can edit
// (element text, image sources, CSS animation timings, kadr.progressIn /
// kadr.interp timings, :root variables, kadr:* meta) together with their exact
// character ranges in the file. Edits then replace only those characters, so the
// rest of the file (formatting, comments, scripts) stays exactly as written:
// the agent that wrote it still recognises it.
//
// Used by the server (to tag elements with data-kat="<offset>" when a page is
// opened in the visual editor) and by the editor UI.

const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const NO_TAG = new Set(['html', 'head', 'meta', 'link', 'script', 'style', 'title', 'base', 'noscript', 'template']);

const START = /<([a-zA-Z][\w:.-]*)/y;
const END = /<\/([a-zA-Z][\w:.-]*)[^>]*>/y;
const WS = /\s*/y;
const ANAME = /[^\s"'>/=]+/y;
const UNQ = /[^\s>]+/y;

function match(re, s, i) { re.lastIndex = i; return re.exec(s); }

/**
 * Tokenize HTML into elements with ranges:
 * { at, tag, nameEnd, tagEnd, attrs: {name: {v, vr:[a,b], q}}, content: [a,b] | null, kids, text, parent }
 * `at` (the offset of "<") identifies an element; it is what data-kat carries.
 */
export function scanHtml(src) {
  const els = [];
  const stack = [];
  const n = src.length;
  const lower = src.toLowerCase();
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && stack.length && /\S/.test(src.slice(i, lt))) top().text = true;
    i = lt;
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); i = e < 0 ? n : e + 3; continue; }
    if (src[i + 1] === '!' || src[i + 1] === '?') { const e = src.indexOf('>', i); i = e < 0 ? n : e + 1; continue; }
    if (src[i + 1] === '/') {
      const m = match(END, src, i);
      if (!m) { i++; continue; }
      const tag = m[1].toLowerCase();
      let k = stack.length - 1;
      while (k >= 0 && stack[k].tag !== tag) k--;
      if (k >= 0) {
        while (stack.length > k) { const el = stack.pop(); el.content[1] = i; }
      }
      i = END.lastIndex;
      continue;
    }
    const m = match(START, src, i);
    if (!m) { i++; continue; }
    const tag = m[1].toLowerCase();
    const el = { at: lt, tag, nameEnd: START.lastIndex, tagEnd: 0, attrs: {}, content: null, kids: 0, text: false, parent: top() ? els.indexOf(top()) : -1 };
    let j = START.lastIndex;
    let selfClose = false;
    for (;;) {
      j = match(WS, src, j) ? WS.lastIndex : j;
      if (j >= n) break;
      if (src[j] === '>') { j++; break; }
      if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
      if (src[j] === '/') { j++; continue; }
      const an = match(ANAME, src, j);
      if (!an) { j++; continue; }
      const name = an[0].toLowerCase();
      j = ANAME.lastIndex;
      let k = match(WS, src, j) ? WS.lastIndex : j;
      if (src[k] === '=') {
        k = match(WS, src, k + 1) ? WS.lastIndex : k + 1;
        const q = src[k];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, k + 1);
          const end = e < 0 ? n : e;
          el.attrs[name] = { v: src.slice(k + 1, end), vr: [k + 1, end], q };
          j = end + 1;
        } else {
          const u = match(UNQ, src, k);
          const v = u ? u[0] : '';
          el.attrs[name] = { v, vr: [k, k + v.length], q: '' };
          j = k + v.length;
        }
      } else {
        el.attrs[name] = { v: '', vr: null, q: '', nameEnd: j };
      }
    }
    el.tagEnd = j;
    if (top()) top().kids++;
    els.push(el);
    i = j;
    if (VOID.has(tag) || selfClose) continue;
    if (RAW.has(tag)) {
      const e = lower.indexOf(`</${tag}`, j);
      const end = e < 0 ? n : e;
      el.content = [j, end];
      el.text = /\S/.test(src.slice(j, end));
      if (e < 0) { i = n; continue; }
      const close = src.indexOf('>', e);
      i = close < 0 ? n : close + 1;
      continue;
    }
    el.content = [j, n];
    stack.push(el);
  }
  return els;
}

/** Tag every visible element with data-kat="<offset of its < in the source>". */
export function annotate(src) {
  const els = scanHtml(src).filter((e) => !NO_TAG.has(e.tag));
  let out = src;
  for (let k = els.length - 1; k >= 0; k--) {
    const e = els[k];
    out = `${out.slice(0, e.nameEnd)} data-kat="${e.at}"${out.slice(e.nameEnd)}`;
  }
  return out;
}

// ---------- CSS ----------

function skipComment(s, i) {
  if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); return e < 0 ? s.length : e + 2; }
  return i;
}
function skipString(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "'") return i;
  let j = i + 1;
  while (j < s.length && s[j] !== q) j += s[j] === '\\' ? 2 : 1;
  return j + 1;
}
/** Index of the "}" that closes the "{" at i (or b). */
function closeBrace(s, i, b) {
  let d = 0;
  for (let j = i; j < b; j++) {
    const k = skipComment(s, j);
    if (k !== j) { j = k - 1; continue; }
    const q = skipString(s, j);
    if (q !== j) { j = q - 1; continue; }
    if (s[j] === '{') d++;
    else if (s[j] === '}' && --d === 0) return j;
  }
  return b;
}

/** Split [a,b) of s on sep at paren depth 0. Returns trimmed [x,y) ranges (empty ones dropped). */
function splitTop(s, a, b, sep) {
  const out = [];
  let d = 0;
  let st = a;
  const push = (x, y) => {
    while (x < y && /\s/.test(s[x])) x++;
    while (y > x && /\s/.test(s[y - 1])) y--;
    if (y > x) out.push([x, y]);
  };
  for (let j = a; j < b; j++) {
    const q = skipString(s, j);
    if (q !== j) { j = q - 1; continue; }
    const c = s[j];
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (d === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) { push(st, j); st = j + 1; }
  }
  push(st, b);
  return out;
}

function scanDecls(s, a, b) {
  const decls = [];
  let st = a;
  let d = 0;
  const flush = (end) => {
    let x = st;
    for (;;) { while (x < end && /\s/.test(s[x])) x++; const k = skipComment(s, x); if (k === x) break; x = k; }
    const colon = s.indexOf(':', x);
    if (colon < 0 || colon >= end) return;
    const prop = s.slice(x, colon).trim().toLowerCase();
    let v0 = colon + 1;
    let v1 = end;
    while (v0 < v1 && /\s/.test(s[v0])) v0++;
    while (v1 > v0 && /\s/.test(s[v1 - 1])) v1--;
    if (prop && !/[{}\s]/.test(prop)) decls.push({ prop, value: s.slice(v0, v1), vr: [v0, v1] });
  };
  for (let j = a; j < b; j++) {
    const k = skipComment(s, j);
    if (k !== j) { j = k - 1; continue; }
    const q = skipString(s, j);
    if (q !== j) { j = q - 1; continue; }
    if (s[j] === '(') d++;
    else if (s[j] === ')') d--;
    else if (s[j] === '{') { const e = closeBrace(s, j, b); st = e + 1; j = e; } // nested rule: skip
    else if (s[j] === ';' && d === 0) { flush(j); st = j + 1; }
  }
  flush(b);
  return decls;
}

function scanCss(s, a, b, out) {
  let i = a;
  while (i < b) {
    const k = skipComment(s, i);
    if (k !== i) { i = k; continue; }
    if (/\s/.test(s[i])) { i++; continue; }
    const ps = i;
    while (i < b && s[i] !== '{' && s[i] !== ';' && s[i] !== '}') {
      const c = skipComment(s, i);
      if (c !== i) { i = c; continue; }
      const q = skipString(s, i);
      i = q !== i ? q : i + 1;
    }
    if (i >= b) break;
    if (s[i] !== '{') { i++; continue; }
    const prelude = s.slice(ps, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const e = closeBrace(s, i, b);
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer|container|document)\b/i.test(prelude)) scanCss(s, i + 1, e, out);
      else if (/^@(-webkit-)?keyframes\b/i.test(prelude)) out.keyframes.push({ name: prelude.split(/\s+/)[1], r: [ps, e + 1] });
    } else {
      out.rules.push({ selector: prelude, at: ps, body: [i + 1, e], decls: scanDecls(s, i + 1, e) });
    }
    i = e + 1;
  }
}

const TIME = /^(-?(?:\d+\.?\d*|\.\d+))(m?s)$/i;
const EASE_KW = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);
const ANIM_KW = new Set(['infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'none', 'forwards', 'backwards', 'both', 'running', 'paused', 'initial', 'inherit', 'unset']);
const isEase = (t) => EASE_KW.has(t) || /^(cubic-bezier|steps|linear)\(/i.test(t);

export function parseTime(t) {
  const m = TIME.exec(t);
  return m ? Number(m[1]) / (m[2].toLowerCase() === 'ms' ? 1000 : 1) : null;
}
/** Write seconds back in the unit the file used. */
export function fmtTime(sec, like = 's') {
  if (/ms$/i.test(like)) return `${Math.round(sec * 1000)}ms`;
  return `${Math.round(sec * 1000) / 1000}s`;
}

function animationsOf(s, rule) {
  const items = [];
  const field = (r) => ({ v: s.slice(r[0], r[1]), r });
  for (const d of rule.decls) {
    if (d.prop === 'animation') {
      items.length = 0;
      for (const [x, y] of splitTop(s, d.vr[0], d.vr[1], ',')) {
        const it = { decl: 'animation', start: x, end: y, name: null, duration: null, delay: null, easing: null };
        for (const r of splitTop(s, x, y, ' ')) {
          const t = s.slice(r[0], r[1]);
          if (TIME.test(t)) { if (!it.duration) it.duration = field(r); else if (!it.delay) it.delay = field(r); } else if (isEase(t)) it.easing = field(r);
          else if (!ANIM_KW.has(t.toLowerCase()) && !/^\d+(\.\d+)?$/.test(t) && !it.name) it.name = t;
        }
        items.push(it);
      }
    } else if (/^animation-(name|duration|delay|timing-function)$/.test(d.prop)) {
      const key = { 'animation-name': 'name', 'animation-duration': 'duration', 'animation-delay': 'delay', 'animation-timing-function': 'easing' }[d.prop];
      splitTop(s, d.vr[0], d.vr[1], ',').forEach((r, k) => {
        items[k] ||= { decl: 'longhand', start: rule.body[1], end: rule.body[1], name: null, duration: null, delay: null, easing: null };
        items[k][key] = key === 'name' ? s.slice(r[0], r[1]) : field(r);
        items[k].longhand = true;
      });
    }
  }
  return items.filter((it) => it.name && it.name !== 'none').map((it) => ({
    selector: rule.selector,
    name: it.name,
    duration: it.duration ? parseTime(it.duration.v) : 0,
    delay: it.delay ? parseTime(it.delay.v) : 0,
    easing: it.easing ? it.easing.v : 'ease',
    // ranges to replace, or where to insert when the value is missing
    dr: it.duration?.r || null,
    lr: it.delay?.r || null,
    er: it.easing?.r || null,
    unit: it.duration?.v || 's',
    ins: it.duration ? it.duration.r[1] : it.start,
    longhand: !!it.longhand,
    bodyEnd: rule.body[1],
  }));
}

// ---------- JS timings ----------

const NUM = '(-?\\d*\\.?\\d+)';
const JS_RE = new RegExp(`\\b(progressIn|interp)\\(\\s*([^,()]+?)\\s*,\\s*(\\[\\s*)?${NUM}\\s*,\\s*${NUM}\\s*(\\])?`, 'dg');
const EASE_AFTER_P = /\s*,\s*(['"])(\w+)\1/dy;
const EASE_AFTER_I = /\s*,\s*\[[^\]]*\]\s*,\s*(['"])(\w+)\1/dy;

function jsTimings(s, a, b, out) {
  const code = s.slice(a, b);
  JS_RE.lastIndex = 0;
  let m;
  while ((m = JS_RE.exec(code))) {
    const isInterp = m[1] === 'interp';
    if (isInterp !== !!m[3] || isInterp !== !!m[6]) continue;
    const re = isInterp ? EASE_AFTER_I : EASE_AFTER_P;
    re.lastIndex = JS_RE.lastIndex;
    const em = re.exec(code);
    const ls = code.lastIndexOf('\n', m.index) + 1;
    let le = code.indexOf('\n', m.index);
    if (le < 0) le = code.length;
    const line = code.slice(ls, le);
    const before = code.slice(ls, m.index);
    const eq = before.search(/[^=!<>]=[^=]/);
    let label = eq >= 0 ? before.slice(0, eq + 1) : line;
    label = label.replace(/^\s*(const|let|var)\s+/, '').replace(/\s+/g, ' ').trim();
    if (!label || label.length < 2) label = line.trim();
    if (label.length > 60) label = `${label.slice(0, 58)}…`;
    out.push({
      kind: m[1],
      label,
      text: line.trim(),
      comment: (() => {
        // the nearest "// comment" line just above (up to 3 lines up) names the timing
        const lines = code.slice(0, ls).split('\n').slice(-4, -1).reverse();
        for (const l of lines) { const c = l.trim().match(/^\/\/\s*(.+)/); if (c) return c[1]; if (l.trim() && !/^\/\//.test(l.trim())) break; }
        return '';
      })(),
      line: s.slice(0, a + m.index).split('\n').length,
      a: { v: Number(m[4]), r: [a + m.indices[4][0], a + m.indices[4][1]] },
      b: { v: Number(m[5]), r: [a + m.indices[5][0], a + m.indices[5][1]] },
      ease: em ? { v: em[2], r: [a + em.indices[2][0], a + em.indices[2][1]] } : null,
      easeIns: em || isInterp ? null : a + JS_RE.lastIndex,
      interp: isInterp,
    });
  }
}

// ---------- the model ----------

/** Everything the visual editor can change in a composition, with source ranges. */
export function scanComp(src) {
  const els = scanHtml(src);
  const css = { rules: [], keyframes: [] };
  const js = [];
  const meta = {};
  for (const e of els) {
    if (e.tag === 'style' && e.content) scanCss(src, e.content[0], e.content[1], css);
    else if (e.tag === 'script' && e.content && !e.attrs.src) jsTimings(src, e.content[0], e.content[1], js);
    else if (e.tag === 'meta' && e.attrs.name?.v.startsWith('kadr:') && e.attrs.content) meta[e.attrs.name.v.slice(5)] = { v: decodeEnt(e.attrs.content.v), vr: e.attrs.content.vr, q: e.attrs.content.q };
  }
  const anims = css.rules.flatMap((r) => animationsOf(src, r));
  const vars = css.rules.filter((r) => /(^|,)\s*(:root|html)\s*(,|$)/.test(r.selector))
    .flatMap((r) => r.decls.filter((d) => d.prop.startsWith('--')).map((d) => ({ name: d.prop, value: d.value, vr: d.vr })));
  let props = {};
  try { props = meta.props ? JSON.parse(meta.props.v) : {}; } catch { props = {}; }
  const title = els.find((e) => e.tag === 'title');
  return {
    els,
    byAt: new Map(els.map((e) => [e.at, e])),
    rules: css.rules,
    keyframes: css.keyframes,
    anims,
    js,
    vars,
    meta,
    props,
    duration: meta.duration ? Number(meta.duration.v) || null : null,
    title: title?.content ? src.slice(title.content[0], title.content[1]).trim() : '',
  };
}

/** Apply [{a, b, text}] (ranges in the original) and return the new source. */
export function applyEdits(src, edits) {
  const list = [...edits].sort((x, y) => y.a - x.a || y.b - x.b);
  let out = src;
  let floor = Infinity;
  for (const e of list) {
    if (e.b > floor) throw new Error('overlapping edits');
    out = out.slice(0, e.a) + e.text + out.slice(e.b);
    floor = e.a;
  }
  return out;
}

// ---------- helpers for writing values ----------

export function decodeEnt(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, k) => {
    const l = k.toLowerCase();
    if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : Number(l.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[l];
  });
}
export const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s, q = '"') => {
  let v = String(s).replace(/&/g, '&amp;');
  if (q !== "'") v = v.replace(/"/g, '&quot;');
  if (q !== '"') v = v.replace(/'/g, '&#39;');
  return q ? v : `"${v.replace(/"/g, '&quot;')}"`;
};

/** Edit that sets attribute `name` of element e to value (adds it when missing). */
export function attrEdit(e, name, value) {
  const a = e.attrs[name];
  if (a?.vr) return { a: a.vr[0], b: a.vr[1], text: escAttr(value, a.q) };
  if (a) return { a: a.nameEnd, b: a.nameEnd, text: `="${escAttr(value)}"` };
  return { a: e.nameEnd, b: e.nameEnd, text: ` ${name}="${escAttr(value)}"` };
}

/** Edit that sets one property inside element e's style="" attribute. */
export function styleEdit(src, e, prop, value) {
  const a = e.attrs.style;
  if (!a?.vr) return attrEdit(e, 'style', `${prop}: ${value}`);
  for (const d of scanDecls(src, a.vr[0], a.vr[1])) {
    if (d.prop === prop) return { a: d.vr[0], b: d.vr[1], text: escAttr(value, a.q || '"') };
  }
  const body = src.slice(a.vr[0], a.vr[1]).trimEnd();
  const sep = !body ? '' : body.endsWith(';') ? ' ' : '; ';
  const at = a.vr[0] + body.length;
  return { a: at, b: at, text: `${sep}${prop}: ${escAttr(value, a.q || '"')}` };
}

/** url(...) references inside an element's inline style, as ranges. */
export function styleUrls(src, e) {
  const a = e.attrs.style;
  if (!a?.vr) return [];
  const out = [];
  const re = /url\(\s*(['"]?|&quot;)(.*?)\1\s*\)/g;
  const body = src.slice(a.vr[0], a.vr[1]);
  let m;
  while ((m = re.exec(body))) {
    const s = a.vr[0] + m.index + m[0].indexOf(m[2], 4);
    out.push({ v: decodeEnt(m[2]), r: [s, s + m[2].length] });
  }
  return out;
}

export const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg|bmp)(\?.*)?$/i;

/** Path of `to` relative to the folder `fromDir` (both project-relative). */
export function relPath(fromDir, to) {
  const a = fromDir.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  return [...a.slice(k).map(() => '..'), ...b.slice(k)].join('/') || '.';
}
/** Resolve a path written in a file inside fromDir to a project-relative path. */
export function resolvePath(fromDir, p) {
  if (/^[a-z]+:|^\/\//i.test(p)) return null;
  if (p.startsWith('/p/')) return decodeURIComponent(p.slice(3));
  const parts = p.startsWith('/') ? [] : fromDir.split('/').filter(Boolean);
  for (const seg of p.split(/[?#]/)[0].split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

// ---------- parts: what the timeline shows under a composition clip ----------

/** Does scanned element e match a simple selector (".a.b", "#id", "h1.title", "div > .x" → last compound)? */
export function matchSimple(e, selector) {
  return selector.split(',').some((one) => {
    const last = one.trim().split(/[\s>+~]+/).pop().replace(/::?[\w-]+(\([^)]*\))?/g, '');
    if (!last) return false;
    const m = last.match(/^([a-z][\w-]*|\*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
    if (!m) return false;
    if (m[1] && m[1] !== '*' && m[1].toLowerCase() !== e.tag) return false;
    const cls = ` ${(e.attrs.class?.v || '').trim().split(/\s+/).join(' ')} `;
    for (const part of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
      if (part[0] === '.' && !cls.includes(` ${part.slice(1)} `)) return false;
      if (part[0] === '#' && e.attrs.id?.v !== part.slice(1)) return false;
      if (part[0] === '[') { const an = part.slice(1, -1).split('=')[0].trim().toLowerCase(); if (!(an in e.attrs)) return false; }
    }
    return true;
  });
}

const ID_IN_JS = /\$\(\s*['"]#?([\w-]+)['"]\s*\)|getElementById\(\s*['"]([\w-]+)['"]\s*\)|querySelector\(\s*['"]#([\w-]+)['"]\s*\)/;

/**
 * Group a composition's timings into parts: one per element that animates
 * (named by data-part, its text, or its id/class), plus script timings that
 * cannot be tied to an element. Each part: { key, name, el, timings: [{kind, ref, s, e, ease}] }.
 */
export function partsOf(model, src) {
  const parts = new Map();
  const body = model.els.filter((e) => !['html', 'head', 'body', 'meta', 'link', 'script', 'style', 'title'].includes(e.tag));
  const nameOf = (e) => {
    if (e.attrs['data-part']) return decodeEnt(e.attrs['data-part'].v);
    if (e.content && !e.kids && e.text && e.tag !== 'script' && e.tag !== 'style') {
      const t = decodeEnt(src.slice(e.content[0], e.content[1])).replace(/\s+/g, ' ').trim();
      if (t) return t.length > 28 ? `${t.slice(0, 27)}…` : t;
    }
    if (e.attrs.id) return `#${e.attrs.id.v}`;
    if (e.attrs.class) return `.${e.attrs.class.v.trim().split(/\s+/)[0]}`;
    return e.tag;
  };
  const keyOf = (e) => (e.attrs['data-part'] ? `p:${e.attrs['data-part'].v}` : e.attrs.id ? `#${e.attrs.id.v}` : e.attrs.class ? `.${e.attrs.class.v.trim().split(/\s+/).join('.')}:${e.tag}` : `${e.tag}@${body.indexOf(e)}`);
  const part = (e, fallbackKey, fallbackName) => {
    const key = e ? keyOf(e) : fallbackKey;
    if (!parts.has(key)) parts.set(key, { key, name: e ? nameOf(e) : fallbackName, el: e || null, timings: [] });
    return parts.get(key);
  };
  model.anims.forEach((a, i) => {
    const el = body.find((e) => matchSimple(e, a.selector));
    part(el, `css:${a.selector}`, a.selector).timings.push({ kind: 'css', i, ref: a, s: a.delay, e: a.delay + a.duration, ease: a.easing, name: a.name });
  });
  // const w = $('word') / document.getElementById('word') → w means #word
  const alias = new Map();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:\$|document\.getElementById|document\.querySelector)\(\s*['"]#?([\w-]+)['"]\s*\)/g)) alias.set(m[1], m[2]);
  model.js.forEach((j, i) => {
    const m = j.text.match(ID_IN_JS);
    let id = m && (m[1] || m[2] || m[3]);
    if (!id) { const a = j.text.match(/^(\w+)\./); if (a && alias.has(a[1])) id = alias.get(a[1]); }
    const el = id ? body.find((e) => e.attrs.id?.v === id) : null;
    const v = j.text.match(/^(?:const|let|var)\s+(\w+)\s*=/);
    const nm = j.comment ? (j.comment.length > 32 ? `${j.comment.slice(0, 31)}…` : j.comment) : v ? `${v[1]} (line ${j.line})` : j.label;
    part(el, `js:${j.line}:${j.label}`, nm).timings.push({ kind: 'js', i, ref: j, s: j.a.v, e: j.b.v, ease: j.ease?.v || 'linear', name: nm });
  });
  for (const p of parts.values()) {
    p.s = Math.min(...p.timings.map((t) => t.s));
    p.e = Math.max(...p.timings.map((t) => t.e));
  }
  return [...parts.values()].sort((x, y) => x.s - y.s || x.e - y.e);
}

// ---------- edit builders ----------

/** Edits that set a CSS animation's delay and duration. */
export function animEdits(a, delay, duration) {
  const D = fmtTime(duration, a.unit);
  const L = fmtTime(delay, a.unit);
  if (a.longhand) {
    if (!a.dr && !a.lr) return [{ a: a.bodyEnd, b: a.bodyEnd, text: ` animation-duration: ${D};${delay ? ` animation-delay: ${L};` : ''}` }];
    const out = [];
    out.push(a.dr ? { a: a.dr[0], b: a.dr[1], text: D } : { a: a.bodyEnd, b: a.bodyEnd, text: ` animation-duration: ${D};` });
    if (a.lr) out.push({ a: a.lr[0], b: a.lr[1], text: L });
    else if (delay) out.push({ a: a.bodyEnd, b: a.bodyEnd, text: ` animation-delay: ${L};` });
    return out;
  }
  if (!a.dr) return [{ a: a.ins, b: a.ins, text: `${D} ${delay || a.lr ? `${L} ` : ''}` }];
  const out = [{ a: a.dr[0], b: a.dr[1], text: D }];
  if (a.lr) out.push({ a: a.lr[0], b: a.lr[1], text: L });
  else if (delay) out.push({ a: a.ins, b: a.ins, text: ` ${L}` });
  return out;
}
export function animEaseEdit(a, v) {
  if (a.er) return { a: a.er[0], b: a.er[1], text: v };
  if (a.longhand) return { a: a.bodyEnd, b: a.bodyEnd, text: ` animation-timing-function: ${v};` };
  return { a: a.ins, b: a.ins, text: a.dr ? ` ${v}` : `${v} ` };
}
const jnum = (v) => String(Math.round(v * 1000) / 1000);
export function jsEdits(j, s, e) {
  return [{ a: j.a.r[0], b: j.a.r[1], text: jnum(s) }, { a: j.b.r[0], b: j.b.r[1], text: jnum(e) }];
}
export function jsEaseEdit(j, v) {
  if (j.ease) return { a: j.ease.r[0], b: j.ease.r[1], text: v };
  if (j.easeIns != null) return { a: j.easeIns, b: j.easeIns, text: `, '${v}'` };
  return null;
}
/** Edits that move / stretch a whole part: start at s, last for len (timings scale from the part start). */
export function partTimeEdits(p, s, len) {
  const k = len / Math.max(1e-6, p.e - p.s);
  const out = [];
  for (const t of p.timings) {
    const ns = s + (t.s - p.s) * k;
    const ne = s + (t.e - p.s) * k;
    out.push(...(t.kind === 'css' ? animEdits(t.ref, Math.max(0, ns), Math.max(0.01, ne - ns)) : jsEdits(t.ref, Math.max(0, ns), Math.max(ns + 0.01, ne))));
  }
  return out;
}
/** The CSS rule declaration that sets `prop` for element e (last matching rule wins), if any. */
export function ruleDecl(model, e, prop) {
  let found = null;
  for (const r of model.rules) {
    if (!matchSimple(e, r.selector)) continue;
    for (const d of r.decls) if (d.prop === prop) found = d;
  }
  return found;
}
