#!/usr/bin/env node
// Entry point the desktop app (src-tauri) starts with its bundled Node.
// It runs the same editor server as `kadr serve`, then prints one line the
// shell waits for:  KADR_URL http://127.0.0.1:<port>
// It exits as soon as the app goes away (stdin closes), so no server is left
// running in the background.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const win = process.platform === 'win32';

// A GUI app has no console: on Windows every ffmpeg/chrome/agent child would
// flash a console window. Hide them by default (before the server imports
// child_process, so its named imports see the patched functions).
if (win) {
  for (const name of ['spawn', 'execFile', 'exec', 'spawnSync', 'execFileSync', 'execSync']) {
    const orig = cp[name];
    cp[name] = function patched(...args) {
      const i = args.findIndex((a, k) => k > 0 && a && typeof a === 'object' && !Array.isArray(a));
      if (i === -1) {
        const at = Array.isArray(args[1]) ? 2 : 1;
        args.splice(at, 0, { windowsHide: true });
      } else if (args[i].windowsHide === undefined) args[i] = { ...args[i], windowsHide: true };
      return orig.apply(this, args);
    };
  }
  syncBuiltinESMExports();
}

// Apps started from the dock/launcher get a short PATH (no Homebrew, no
// ~/.local/bin), so ffmpeg, chromium and the agent CLIs would not be found.
function addPath(dirs) {
  const cur = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const add = dirs.filter((d) => d && !cur.includes(d) && fs.existsSync(d));
  if (add.length) process.env.PATH = [...cur, ...add].join(path.delimiter);
}
const home = os.homedir();
if (!win) {
  addPath(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin',
    path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.cargo/bin'),
    path.join(home, '.bun/bin'), path.join(home, '.volta/bin')]);
}
// The login shell knows the full PATH (nvm, asdf, custom dirs). Ask it once in
// the background so startup never waits on a slow shell profile.
function loginPath() {
  if (win || !process.env.SHELL) return;
  const sh = cp.spawn(process.env.SHELL, ['-ilc', 'printf "__KP__%s__KP__" "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'], detached: false });
  let out = '';
  const kill = setTimeout(() => sh.kill(), 4000);
  sh.stdout.on('data', (d) => { out += d; });
  sh.on('error', () => clearTimeout(kill));
  sh.on('close', () => {
    clearTimeout(kill);
    const m = out.match(/__KP__(.*)__KP__/s);
    if (m) addPath(m[1].split(':'));
  });
}

const { startServer } = await import('../src/server.js');
const { recentPaths } = await import('../src/recent.js');
const { initProject } = await import('../src/init.js');

/** The project to open: --project, else the last one used, else a fresh one. */
async function pickRoot() {
  const i = process.argv.indexOf('--project');
  if (i > 0 && process.argv[i + 1]) {
    const dir = path.resolve(process.argv[i + 1]);
    if (fs.existsSync(path.join(dir, 'project.json'))) return dir;
  }
  for (const dir of await recentPaths().catch(() => [])) {
    if (fs.existsSync(path.join(dir, 'project.json'))) return dir;
  }
  const docs = [path.join(home, 'Documents'), home].find((d) => fs.existsSync(d)) || home;
  const base = path.join(docs, 'kadr');
  let dir = path.join(base, 'My first video');
  for (let n = 2; fs.existsSync(path.join(dir, 'project.json')) || (fs.existsSync(dir) && fs.readdirSync(dir).length); n++) {
    dir = path.join(base, `My first video ${n}`);
  }
  await initProject(dir, { name: path.basename(dir) });
  return dir;
}

const root = await pickRoot();
// A fixed port keeps the page origin the same between launches, so the
// editor's saved layout and settings in localStorage survive a restart.
const base = Number(process.env.KADR_DESKTOP_PORT) || 47310;
let srv;
for (let k = 0; k < 30 && !srv; k++) {
  try { srv = await startServer({ root, port: base + k, quiet: true }); } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
  }
}
if (!srv) srv = await startServer({ root, port: 0, quiet: true });
process.stdout.write(`KADR_URL ${srv.url}\n`);
loginPath();

let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(0), 1500).unref();
  try { await srv.close(); } catch { /* exiting anyway */ }
  process.exit(0);
};
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.on('error', stop);
process.stdin.resume();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
