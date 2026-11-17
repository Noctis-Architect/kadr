#!/usr/bin/env node
// Download the official Node.js binary the desktop app bundles (Tauri
// externalBin) to src-tauri/binaries/kadr-node-<rust target triple>[.exe].
// The SHA-256 is checked against nodejs.org's SHASUMS256.txt.
//
//   node scripts/fetch-node.mjs [--target <rust triple>] [--version 24.x.y]
//
// Default target: this machine. Default version: latest Node 24 release.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

function hostTriple() {
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    const m = out.match(/^host: (\S+)/m);
    if (m) return m[1];
  } catch { /* no rustc */ }
  const a = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  return { linux: `${a}-unknown-linux-gnu`, darwin: `${a}-apple-darwin`, win32: `${a}-pc-windows-msvc` }[process.platform];
}

const target = arg('--target') || process.env.TAURI_TARGET || hostTriple();
const MAP = {
  'x86_64-unknown-linux-gnu': ['linux-x64', 'tar.xz'],
  'aarch64-unknown-linux-gnu': ['linux-arm64', 'tar.xz'],
  'x86_64-apple-darwin': ['darwin-x64', 'tar.gz'],
  'aarch64-apple-darwin': ['darwin-arm64', 'tar.gz'],
  'x86_64-pc-windows-msvc': ['win-x64', 'zip'],
  'aarch64-pc-windows-msvc': ['win-arm64', 'zip'],
};
if (!MAP[target]) throw new Error(`unsupported target ${target}`);
const [plat, ext] = MAP[target];
const win = target.includes('windows');
const out = path.join(ROOT, 'src-tauri', 'binaries', `kadr-node-${target}${win ? '.exe' : ''}`);

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
    }
  }
}

let version = arg('--version') || process.env.KADR_NODE_VERSION;
if (!version) {
  const index = JSON.parse((await get('https://nodejs.org/dist/index.json')).toString());
  version = index.find((r) => r.version.startsWith('v24.')).version.slice(1);
}
version = version.replace(/^v/, '');

const stamp = `${out}.version`;
if (fs.existsSync(out) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === version) {
  console.log(`node ${version} for ${target} already at ${path.relative(ROOT, out)}`);
  process.exit(0);
}

const name = `node-v${version}-${plat}`;
const file = `${name}.${ext}`;
const base = `https://nodejs.org/dist/v${version}`;
console.log(`downloading ${base}/${file}`);
const [archive, sums] = await Promise.all([get(`${base}/${file}`), get(`${base}/SHASUMS256.txt`)]);
const want = sums.toString().split('\n').find((l) => l.trim().endsWith(`  ${file}`))?.split(/\s+/)[0];
const have = crypto.createHash('sha256').update(archive).digest('hex');
if (!want || want !== have) throw new Error(`checksum mismatch for ${file}: expected ${want}, got ${have}`);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'kadr-node-'));
try {
  const arc = path.join(tmp, file);
  await fsp.writeFile(arc, archive);
  const inner = win ? `${name}/node.exe` : `${name}/bin/node`;
  if (ext === 'zip') {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${arc}' -DestinationPath '${tmp}' -Force`], { stdio: 'inherit' });
    } else execFileSync('unzip', ['-q', arc, inner, '-d', tmp], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xf', arc, '-C', tmp, inner], { stdio: 'inherit' });
  }
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.copyFile(path.join(tmp, inner), out);
  if (!win) await fsp.chmod(out, 0o755);
  await fsp.writeFile(stamp, `${version}\n`);
  console.log(`node ${version} → ${path.relative(ROOT, out)}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
