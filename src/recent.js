// Recently opened projects, shared by every `kadr serve` on this machine.
// Stored in $XDG_CONFIG_HOME/kadr/recent.json (or $KADR_RECENT).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeProject, projectDuration } from '../shared/model.js';

const FILE = process.env.KADR_RECENT
  || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kadr', 'recent.json');
const MAX = 30;

async function read() {
  try {
    const j = JSON.parse(await fsp.readFile(FILE, 'utf8'));
    return Array.isArray(j) ? j.filter((x) => x && typeof x.path === 'string') : [];
  } catch { return []; }
}
async function write(list) {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(list.slice(0, MAX), null, 2)}\n`);
  await fsp.rename(tmp, FILE);
}

export async function recentPaths() { return (await read()).map((x) => x.path); }

export async function touchRecent(dir) {
  const list = (await read()).filter((x) => x.path !== dir);
  list.unshift({ path: dir, opened: Date.now() });
  await write(list).catch(() => {});
}

export async function forgetRecent(dir) {
  await write((await read()).filter((x) => x.path !== dir));
}

const IMG = /\.(jpe?g|png|webp|gif|avif)$/i;

/** A picture for the project card: a still in renders/, an image in media/, or a cached filmstrip. */
export function thumbFor(dir) {
  const pick = (sub, re) => {
    try {
      return fs.readdirSync(path.join(dir, sub), { withFileTypes: true })
        .filter((e) => e.isFile() && re.test(e.name))
        .map((e) => path.join(dir, sub, e.name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    } catch { return null; }
  };
  return pick('renders', /^frame-.*\.png$/i) || pick('media', IMG) || pick(path.join('.kadr', 'cache'), /^strip.*\.jpg$/i) || null;
}

export async function listRecent() {
  const out = [];
  for (const r of await read()) {
    const item = { path: r.path, opened: r.opened, exists: false };
    try {
      const file = path.join(r.path, 'project.json');
      const st = await fsp.stat(file);
      const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
      const p = normalizeProject(raw);
      Object.assign(item, {
        exists: true,
        name: p.name || path.basename(r.path),
        width: p.width, height: p.height, fps: p.fps,
        clips: p.clips.length,
        duration: projectDuration(p),
        modified: st.mtimeMs,
        thumb: !!thumbFor(r.path),
      });
    } catch (e) {
      item.name = path.basename(r.path);
      item.exists = fs.existsSync(path.join(r.path, 'project.json'));
      if (item.exists) item.error = e.message;
    }
    out.push(item);
  }
  return out;
}
