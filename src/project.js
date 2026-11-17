import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeProject, validateProject, serializeProject, mediaKind, sourceSpan } from '../shared/model.js';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILTIN_DIR = path.join(APP_DIR, 'builtin');

/** Join a project-relative path to root; null if it escapes root. */
export function safeJoin(root, rel) {
  const abs = path.resolve(root, String(rel).replace(/^\/+/, ''));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** Absolute file for a clip src. "@kadr/x.html" points at the app's built-ins. */
export function resolveSrc(root, src) {
  if (src.startsWith('@kadr/')) {
    const abs = path.resolve(BUILTIN_DIR, src.slice(6));
    return abs.startsWith(BUILTIN_DIR + path.sep) ? abs : null;
  }
  return safeJoin(root, src);
}

/** URL a composition is served at (by our own server). */
export function compUrl(baseUrl, src, props, extra = {}) {
  const u = src.startsWith('@kadr/')
    ? `${baseUrl}/kadr/builtin/${src.slice(6).split('/').map(encodeURIComponent).join('/')}`
    : `${baseUrl}/p/${src.split('/').map(encodeURIComponent).join('/')}`;
  const q = new URLSearchParams();
  if (props && Object.keys(props).length) q.set('props', JSON.stringify(props));
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  const s = q.toString();
  return s ? `${u}?${s}` : u;
}

export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'project.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export async function readProjectText(root) {
  return fsp.readFile(path.join(root, 'project.json'), 'utf8');
}

export async function readProject(root) {
  const text = await readProjectText(root);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`project.json is not valid JSON: ${e.message}`);
  }
}

/** Write atomically (tmp + rename) so watchers never see half a file. Returns the text. */
export async function writeProject(root, project) {
  const text = serializeProject(project);
  const file = path.join(root, 'project.json');
  const tmp = path.join(root, `.project.json.${process.pid}.tmp`);
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
  return text;
}

/** Structural checks plus file / media-length checks. */
export async function validateFull(root, raw, media) {
  const { errors, warnings } = validateProject(raw);
  if (errors.length) return { errors, warnings };
  const p = normalizeProject(raw);
  for (const c of p.clips) {
    const abs = resolveSrc(root, c.src);
    if (!abs || !fs.existsSync(abs)) {
      errors.push(`clip ${c.id}: file not found: ${c.src}`);
      continue;
    }
    if (c.type === 'html' && mediaKind(abs) !== 'html') errors.push(`clip ${c.id}: html clips need an .html src`);
    if (c.type !== 'video' && c.type !== 'audio') continue;
    try {
      const info = await media.info(c.src);
      if (c.type === 'video' && !info.hasVideo) errors.push(`clip ${c.id}: ${c.src} has no video stream`);
      if (c.type === 'audio' && !info.hasAudio) errors.push(`clip ${c.id}: ${c.src} has no audio stream`);
      if (info.duration && c.in >= info.duration) {
        errors.push(`clip ${c.id}: in=${c.in}s is past the end of ${c.src} (${info.duration.toFixed(3)}s)`);
      } else if (info.duration && c.in + sourceSpan(c) > info.duration + 1 / p.fps + 0.02) {
        warnings.push(`clip ${c.id}: in + duration*speed = ${(c.in + sourceSpan(c)).toFixed(3)}s but ${c.src} is ${info.duration.toFixed(3)}s long (the tail shows the track below)`);
      }
    } catch (e) {
      errors.push(`clip ${c.id}: cannot read ${c.src}: ${e.message}`);
    }
  }
  return { errors, warnings };
}
