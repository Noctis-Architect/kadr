import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { lintComp } from '../shared/lint.js';
import { BUILTIN_DIR, resolveSrc, safeJoin } from './project.js';

/** Lint one .html file on disk; local references are checked against the file system. */
export async function lintFile(abs, root = null) {
  const src = await fsp.readFile(abs, 'utf8');
  const dir = path.dirname(abs);
  const exists = (ref) => {
    let target;
    if (ref.startsWith('/p/') && root) target = safeJoin(root, decodeURIComponent(ref.slice(3)));
    else if (ref.startsWith('/')) return null; // served by kadr itself (/kadr/...), not a project file
    else target = path.resolve(dir, decodeURIComponent(ref));
    return target ? fs.existsSync(target) : false;
  };
  return lintComp(src, { exists });
}

async function htmlUnder(dir) {
  const out = [];
  async function walk(d) {
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.html')) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}

/** Files `kadr lint` checks by default: comps/ plus any other html clip in project.json. */
export async function defaultTargets(root, project) {
  const files = new Set(await htmlUnder(path.join(root, 'comps')));
  for (const c of project?.clips || []) {
    if (c?.type !== 'html' || typeof c.src !== 'string' || c.src.startsWith('@kadr/')) continue;
    const abs = resolveSrc(root, c.src);
    if (abs && fs.existsSync(abs)) files.add(abs);
  }
  return [...files].sort();
}

export const builtinTargets = () => htmlUnder(BUILTIN_DIR);
