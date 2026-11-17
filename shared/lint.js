// Static checks for composition HTML. Each finding has a stable code, a
// severity and a one-line fix, so an agent can act on it without guessing.
// Pure text analysis: no browser, no file system (the caller passes `exists`
// to check local file references).
//
// Severity: 'error' = the comp is broken; 'warning' = the preview and the
// export may differ, or a render may fail on another machine; 'info' = advice.

export const RULES = {
  props_meta_json: ['error', 'kadr:props is not a valid JSON object', "Write it as content='{\"title\":\"Hello\"}' (single quotes outside, double quotes inside)."],
  fields_meta_json: ['error', 'kadr:fields is not a valid JSON object', "Write it as content='{\"size\":{\"min\":10,\"max\":300}}'."],
  duration_meta: ['error', 'kadr:duration is not a positive number of seconds', 'Use <meta name="kadr:duration" content="4">.'],
  missing_file: ['error', 'points to a local file that does not exist', 'Fix the path (relative to this .html file) or add the file.'],
  missing_duration: ['warning', 'no kadr:duration: the editor cannot pick a default length and --p stays 0', 'Add <meta name="kadr:duration" content="4">.'],
  wall_clock: ['warning', 'reads the real clock, so each render can differ from the preview', 'Derive the value from t in kadr.onFrame((t) => ...).'],
  timer: ['warning', 'timers and animation-frame loops run on real time, not on the composition clock', 'Move the work into kadr.onFrame((t) => ...).'],
  unseeded_random: ['warning', 'Math.random() gives different values on every frame and every render', 'Use const r = kadr.random(42); r().'],
  async_load: ['warning', 'loads data without holding the frame, so early frames may render before it arrives', 'const done = kadr.delayRender(); fetch(...).then(...).finally(done);'],
  media_element: ['warning', '<video>/<audio> inside a comp is not synced to the composition clock', 'Put footage and sound on the timeline as clips.'],
  remote_url: ['warning', 'loads from the internet: renders fail offline and the file can change', 'Download it into comps/ or media/ and use a relative path.'],
  gsap_not_paused: ['warning', 'a GSAP timeline that plays by itself ignores the composition clock', 'gsap.timeline({ paused: true }) and kadr.onFrame((t) => tl.seek(t)).'],
  prop_undeclared: ['warning', 'uses a prop that kadr:props does not declare, so the editor shows no control for it', 'Add it with a default to <meta name="kadr:props">.'],
  field_bad_default: ['warning', 'the default in kadr:props is not one of the options in kadr:fields', 'Make the default one of the options.'],
  css_transition: ['info', 'CSS transitions run when a class or style changes, which can land between frames', 'Prefer @keyframes animations or kadr.onFrame for anything that must match the export.'],
};

const META = (name) => new RegExp(`<meta\\s+name=["']kadr:${name}["']\\s+content=(?:'([^']*)'|"([^"]*)")`, 'i');

/** Replace comments with spaces (keeps offsets, so line numbers stay right). */
function blank(s, re) { return s.replace(re, (m) => m.replace(/[^\n]/g, ' ')); }

function blocks(src, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(src))) out.push({ attrs: m[1], body: m[2], at: m.index + m[0].indexOf('>') + 1 });
  return out;
}

function parseJsonMeta(src, name) {
  const m = src.match(META(name));
  if (!m) return { present: false };
  const raw = (m[1] ?? m[2]).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? { present: true, value: v, at: m.index } : { present: true, bad: true, at: m.index };
  } catch { return { present: true, bad: true, at: m.index }; }
}

/** kadr:fields of a comp: { prop: {type, label, options, min, max, step, description} }. */
export function readFields(src) {
  const f = parseJsonMeta(src, 'fields');
  return f.value || null;
}

/**
 * Lint one composition.
 * @param {string} src  file contents
 * @param {object} [opt]
 * @param {(ref: string) => boolean|null} [opt.exists]  true/false for a local reference, null to skip it
 * @returns {{code, severity, message, fix, line}[]}
 */
export function lintComp(src, { exists } = {}) {
  const out = [];
  const lineAt = (i) => (i < 0 ? 0 : src.slice(0, i).split('\n').length);
  const seen = new Set();
  const add = (code, at, detail) => {
    const key = `${code}:${detail || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const [severity, message, fix] = RULES[code];
    out.push({ code, severity, message: detail ? `${detail}: ${message}` : message, fix, line: lineAt(at) });
  };

  const html = blank(src, /<!--[\s\S]*?-->/g);

  // ---- meta ----
  const props = parseJsonMeta(html, 'props');
  if (props.bad) add('props_meta_json', props.at);
  const fields = parseJsonMeta(html, 'fields');
  if (fields.bad) add('fields_meta_json', fields.at);
  // A prop described only in kadr:fields is an optional prop without a default.
  const declared = new Set([...Object.keys(props.value || {}), ...Object.keys(fields.value || {})]);
  for (const [k, f] of Object.entries(fields.value || {})) {
    if (Array.isArray(f?.options) && props.value && k in props.value && !f.options.map(String).includes(String(props.value[k]))) add('field_bad_default', fields.at, k);
  }
  const dm = html.match(META('duration'));
  if (!dm) add('missing_duration', -1);
  else if (!(parseFloat(dm[1] ?? dm[2]) > 0)) add('duration_meta', dm.index);

  // ---- scripts ----
  for (const s of blocks(html, 'script')) {
    if (/\bsrc\s*=/.test(s.attrs)) continue;
    // Strip comments; `//` only counts at a line start or after whitespace/;{}( so URLs survive.
    const js = blank(blank(s.body, /\/\*[\s\S]*?\*\//g), /(^|[\s;{}(,])\/\/[^\n]*/gm);
    const find = (re, code, detail) => { re.lastIndex = 0; const m = re.exec(js); if (m) add(code, s.at + m.index, detail ?? m[0].replace(/\s+/g, '').replace(/\($/, '()')); };
    find(/\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/, 'wall_clock');
    find(/\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/, 'timer');
    find(/\bMath\.random\s*\(/, 'unseeded_random');
    if (/\b(?:fetch\s*\(|new\s+XMLHttpRequest|import\s*\()/.test(js) && !/kadr\.delayRender\s*\(/.test(js)) find(/\bfetch\s*\(|new\s+XMLHttpRequest|import\s*\(/, 'async_load');
    const g = /\bgsap\.(?:timeline|to|from|fromTo)\s*\(([^)]*)/g;
    let m;
    while ((m = g.exec(js))) {
      if (m[0].includes('timeline') ? !/paused\s*:\s*true/.test(m[1]) : true) { add('gsap_not_paused', s.at + m.index, m[0].split('(')[0]); break; }
    }
    if (props.present) {
      const pr = /kadr\.prop\s*\(\s*['"]([\w$]+)['"]|kadr\.props\.([A-Za-z_$][\w$]*)|kadr\.props\[\s*['"]([\w$]+)['"]/g;
      while ((m = pr.exec(js))) { const k = m[1] || m[2] || m[3]; if (!declared.has(k)) add('prop_undeclared', s.at + m.index, k); }
    }
  }

  // ---- markup ----
  const body = blank(blank(html, /<script\b[^>]*>[\s\S]*?<\/script>/gi), /<style\b[^>]*>[\s\S]*?<\/style>/gi);
  let m;
  const media = /<(video|audio)\b/gi;
  if ((m = media.exec(body))) add('media_element', m.index, `<${m[1].toLowerCase()}>`);
  if (props.present) {
    const dp = /\bdata-prop(?:-src)?\s*=\s*["']([^"']+)["']/g;
    while ((m = dp.exec(body))) if (!declared.has(m[1])) add('prop_undeclared', m.index, m[1]);
  }

  // ---- css ----
  for (const s of blocks(html, 'style')) {
    const css = blank(s.body, /\/\*[\s\S]*?\*\//g);
    const t = /(?:^|[;{\s])transition(?:-property)?\s*:\s*(?!none\b)[^;}]+/m.exec(css);
    if (t) add('css_transition', s.at + t.index);
  }
  const inlineT = /style\s*=\s*["'][^"']*\btransition\s*:\s*(?!none)/i.exec(body);
  if (inlineT) add('css_transition', inlineT.index);

  // ---- references ----
  const refs = [];
  const attr = /<(?:img|script|link|source|image|use)\b[^>]*?\s(?:src|href|xlink:href)\s*=\s*["']([^"']+)["']/gi;
  while ((m = attr.exec(html))) refs.push([m[1], m.index]);
  const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/g;
  while ((m = url.exec(html))) refs.push([m[1] || m[2], m.index]);
  for (const [ref, at] of refs) {
    const r = ref.trim();
    if (/^(?:https?:)?\/\//i.test(r)) { add('remote_url', at, r.length > 70 ? `${r.slice(0, 67)}...` : r); continue; }
    if (!r || /^(?:data:|blob:|#|about:|javascript:)/i.test(r) || r.includes('${') || r.includes('var(')) continue;
    if (exists && exists(r.split(/[?#]/)[0]) === false) add('missing_file', at, r);
  }

  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
}
