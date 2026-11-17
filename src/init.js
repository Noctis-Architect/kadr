import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { APP_DIR, writeProject } from './project.js';
import { run } from './media.js';

const TEMPLATE = path.join(APP_DIR, 'template');
const SKILLS = path.join(APP_DIR, 'skills');

/**
 * Copy kadr's editing skills into <project>/.claude/skills/ (Claude Code finds
 * them there; AGENTS.md points other agents at the same files). Existing skills
 * are left alone unless update is set, so a user's own edits survive.
 */
export async function installSkills(root, { update = false } = {}) {
  const added = [];
  const updated = [];
  let names = [];
  try { names = (await fsp.readdir(SKILLS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return { added, updated }; }
  const same = async (a, b) => {
    try {
      for (const e of await fsp.readdir(a, { withFileTypes: true })) {
        const x = path.join(a, e.name);
        const y = path.join(b, e.name);
        if (e.isDirectory()) { if (!(await same(x, y))) return false; } else if (!(await fsp.readFile(x)).equals(await fsp.readFile(y))) return false;
      }
      return true;
    } catch { return false; }
  };
  for (const n of names) {
    const src = path.join(SKILLS, n);
    const dest = path.join(root, '.claude', 'skills', n);
    if (!fs.existsSync(dest)) { await fsp.cp(src, dest, { recursive: true }); added.push(n); }
    else if (update && !(await same(src, dest))) { await fsp.cp(src, dest, { recursive: true, force: true }); updated.push(n); }
  }
  return { added, updated };
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (!fs.existsSync(d)) await fsp.copyFile(s, d);
  }
}

export async function initProject(dir, { name, width = 1920, height = 1080, fps = 30, demo = false } = {}) {
  if (fs.existsSync(path.join(dir, 'project.json'))) throw new Error(`${dir} already has a project.json`);
  if (!(width > 0 && height > 0) || width % 2 || height % 2) throw new Error('--size must be two even numbers, e.g. 1920x1080');
  await copyDir(TEMPLATE, dir);
  // dotfiles are stored without the dot so npm/git never hide them
  for (const f of ['gitignore', 'aider.conf.yml']) {
    const s = path.join(dir, f);
    if (fs.existsSync(s)) await fsp.rename(s, path.join(dir, `.${f}`));
  }
  await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'renders'), { recursive: true });
  await installSkills(dir);

  const project = {
    version: 1,
    name: name || path.basename(path.resolve(dir)),
    width, height, fps,
    background: '#000000',
    tracks: [{ id: 'V1', kind: 'video' }, { id: 'V2', kind: 'video' }, { id: 'A1', kind: 'audio' }],
    markers: [],
    clips: [],
  };

  if (demo) {
    const vid = path.join(dir, 'media', 'demo-gradient.mp4');
    const music = path.join(dir, 'media', 'demo-tone.m4a');
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i',
      `gradients=s=${width}x${height}:r=${fps}:d=10:speed=0.012:n=3:c0=0x0c0f14:c1=0x1d2a45:c2=0x3a2c4d:type=radial`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', vid]);
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i',
      'aevalsrc=0.12*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.06*sin(2*PI*220*t):s=48000:d=10',
      '-c:a', 'aac', '-b:a', '128k', music]);
    project.clips = [
      { id: 'c1', track: 'V1', type: 'video', src: 'media/demo-gradient.mp4', start: 0, duration: 10, fadeIn: 0.5, fadeOut: 0.8 },
      { id: 'c2', track: 'V2', type: 'html', src: 'comps/title.html', start: 0.4, duration: 4, props: { title: 'Made with kadr', subtitle: 'HTML, CSS and a timeline' } },
      { id: 'c3', track: 'V2', type: 'html', src: 'comps/counter.html', start: 5, duration: 3, props: { to: 87, suffix: '%', label: 'less busywork' } },
      { id: 'c4', track: 'A1', type: 'audio', src: 'media/demo-tone.m4a', start: 0, duration: 10, volume: 0.6, fadeOut: 1.5 },
    ];
    project.markers = [{ id: 'm1', t: 5, note: 'counter comes in' }];
  }
  await writeProject(dir, project);
  return project;
}
