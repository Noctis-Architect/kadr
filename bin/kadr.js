#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  normalizeProject, validateProject, projectDuration, tc, parseTime, uid, mediaKind, trackKindFor, clipEnd,
} from '../shared/model.js';
import { findRoot, readProject, writeProject, validateFull, APP_DIR, resolveSrc, compUrl } from '../src/project.js';
import { Media, run, probe, sceneCuts, silences } from '../src/media.js';
import { startServer } from '../src/server.js';
import { renderProject } from '../src/render.js';
import { Browser } from '../src/chrome.js';
import { initProject } from '../src/init.js';
import { lintFile, defaultTargets, builtinTargets } from '../src/lint.js';
import { genImage, genSpeech, transcribe } from '../src/gen.js';
import { searchStock, downloadStock } from '../src/stock.js';
import { readSite } from '../src/site.js';
import { runMcp } from '../src/mcp.js';
import { connectStatus, setConnected, manualSnippet } from '../src/connect.js';
import { loadSettings, publicSettings, service } from '../src/settings.js';
import { installSkills } from '../src/init.js';
import { AGENTS } from '../shared/providers.js';

const HELP = `kadr — local video editor that coding agents can drive

usage: kadr <command> [options]          (run inside a project, or pass -C <dir>)

project
  init [dir] [--name n] [--size 1920x1080] [--fps 30] [--demo]
                                  create a project (AGENTS.md, comps/, media/)
  serve [dir] [--port 4310] [--open]
                                  open the editor at http://127.0.0.1:4310
  info                            summary: settings, tracks, every clip
  validate                        check project.json + files; exit 1 on errors
  lint [file.html...] [--json] [--strict] [--builtin]
                                  check compositions for things that break renders
                                  (default: every .html in comps/); exit 1 on errors
  state                           what the user has selected / where the playhead is
  add <src> [--track V1] [--at 0] [--in 0] [--duration d] [--props '{}']
                                  append a clip (duration probed from the file)

look at things (all write PNGs and print their paths)
  frame <t...> [-o out.png|dir]   composite timeline frames at times t
  templates                       list built-in compositions (@kadr/...) and their props
  sheet [file] [--count 12] [--cols 4] [-o out.png]
                                  contact sheet with timestamps: of the timeline,
                                  a video file, or an .html composition
  comp <file.html> [t...] [--props '{}'] [--bg #000] [-o dir]
                                  render a composition alone (prints console errors)

media analysis (JSON)
  probe <file>                    duration, size, fps, codecs
  scenes <video> [--threshold 0.3]
                                  scene-cut timestamps
  silence <file> [--noise -35] [--min 0.4]
                                  silent ranges (dB threshold, min seconds)

generate media with the services set up in the editor (Chat → settings);
writes into media/gen/ and prints the path
  gen image "<prompt>" [--size 1024x1536] [-o file.png]
  gen speech "<text>" [--voice v] [--style "calm, warm"] [-o file.mp3]
  gen transcribe <file> [--language fa] [--from t] [--span s] [-o file.json]
                                  words with timing, ready for @kadr/captions.html
  settings                        which agent and services are set up (no keys shown)

use kadr from your own agents (no editor needed)
  connect [app] [--remove]        add kadr to Claude Code, Codex, Gemini CLI, Qwen Code,
                                  Cursor, OpenCode or Claude Desktop; no app: show status
  mcp                             run the MCP server those apps start (stdio)

find media on the internet (free libraries; credits go to media/stock/CREDITS.md)
  stock search "<words>" [--video] [--orientation landscape|portrait|square]
               [--count 12] [--from wikimedia|pexels|pixabay|openverse]
                                  numbered results with size and license
  stock get <n...>                download results of the last search -> media/stock/
  site <url> [--images 8]         read a website: text, product facts, brand color,
                                  images -> brief/site-<host>.md + media/site/<host>/
  skills [--update]               add the editing skills (YouTube, Shorts/Reels, …) to
                                  this project, or refresh them

media helpers (write new files into media/, print the path)
  freeze <video> <sourceTime>     still PNG of one frame -> media/freeze/
  reverse <file> [--in 0] [--span s]
                                  reversed copy -> media/reversed/
  stabilize <video> [--in 0] [--span s]
                                  steadied copy (no camera shake) -> media/stable/
  denoise <file>                  copy with less background noise -> media/clean/

export
  render [-o renders/out.mp4] [--from t] [--to t] [--crf 18] [--preset medium]
         [--codec h264|h265|prores|av1|vp9] [--size 3840x2160] [--loudness -14]
         [--motion-blur 8] [--shutter 180] [--workers n] [--no-cache]
         (-o x.gif: animated GIF · -o x.wav / .mp3 / .m4a / .flac: the sound only)
  clean                           delete cached renders in .kadr/cache

times accept 12.5, 1:02.5, 00:01:02:15 (frames).`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') out.o = argv[++i];
    else if (a === '-C') out.C = argv[++i];
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !['open', 'demo', 'no-cache', 'json', 'debug', 'strict', 'builtin', 'verbose', 'update', 'video', 'remove'].includes(k)) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const die = (msg, code = 1) => { console.error(`kadr: ${msg}`); process.exit(code); };

function projectRoot(args) {
  const root = findRoot(args.C || process.cwd());
  if (!root) die('no project.json here or in any parent folder (run "kadr init" first, or pass -C <dir>)');
  return root;
}

async function withServer(root, fn) {
  const srv = await startServer({ root, port: 0, ui: false, watch: false, quiet: true });
  try { return await fn(srv); } finally { await srv.close(); }
}

function progressBar() {
  if (!process.stderr.isTTY) return () => {};
  let last = '';
  return (pr) => {
    const pct = Math.round(pr.progress * 100);
    const bar = '#'.repeat(Math.round(pct / 4)).padEnd(25, '.');
    const line = `\r${bar} ${String(pct).padStart(3)}%  ${pr.phase}${pr.detail ? `  ${pr.detail}` : ''}`;
    if (line !== last) { process.stderr.write(line.padEnd(80)); last = line; }
    if (pr.phase === 'done') process.stderr.write('\n');
  };
}

const rel = (root, p) => path.relative(process.cwd(), path.isAbsolute(p) ? p : path.join(root, p)) || '.';

async function sheetFromPngs(pngs, labels, cols, out, cellW = 480) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kadr-sheet-'));
  try {
    const rows = Math.ceil(pngs.length / cols);
    const args = ['-hide_banner', '-v', 'error', '-y'];
    for (const p of pngs) args.push('-i', p);
    const parts = [];
    pngs.forEach((_, i) => {
      const text = labels[i].replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
      parts.push(`[${i}:v]scale=${cellW}:-2,format=rgba,pad=iw+8:ih+8:4:4:color=0x1a1a1a,drawtext=text='${text}':x=10:y=10:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4[c${i}]`);
    });
    const n = pngs.length;
    const layout = pngs.map((_, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = c === 0 ? '0' : Array.from({ length: c }, () => 'w0').join('+');
      const y = r === 0 ? '0' : Array.from({ length: r }, () => 'h0').join('+');
      return `${x}_${y}`;
    }).join('|');
    if (n === 1) parts.push('[c0]null[out]');
    else parts.push(`${pngs.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=0x1a1a1a[out]`);
    args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-update', '1', out);
    await run('ffmpeg', args);
    return { out, rows };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const commands = {
  async help() { console.log(HELP); },

  async init(args) {
    const dir = path.resolve(args._[0] || '.');
    const [w, h] = String(args.size || '1920x1080').split('x').map(Number);
    await initProject(dir, { name: args.name, width: w, height: h, fps: Number(args.fps) || 30, demo: !!args.demo });
    console.log(`created project in ${dir}\nnext: cd ${path.relative(process.cwd(), dir) || '.'} && kadr serve`);
  },

  async serve(args) {
    const start = path.resolve(args._[0] || args.C || '.');
    const root = findRoot(start);
    if (!root) die(`no project.json in ${start}. Create one with: kadr init ${args._[0] || '.'}`);
    let port = Number(args.port) || 4310;
    let srv;
    for (let i = 0; i < 20; i++) {
      try { srv = await startServer({ root, port: port + i }); break; } catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
      }
    }
    if (!srv) die(`ports ${port}-${port + 19} are all busy`);
    console.log(`kadr  ${srv.url}\nproject  ${root}\nctrl+c to stop`);
    if (args.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      (await import('node:child_process')).spawn(cmd, [srv.url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    }
    const stop = async () => { await srv.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  },

  async info(args) {
    const root = projectRoot(args);
    const raw = await readProject(root);
    const p = normalizeProject(raw);
    if (args.json) return console.log(JSON.stringify({ ...p, duration: projectDuration(p) }, null, 2));
    const D = projectDuration(p);
    console.log(`${p.name}  ${p.width}x${p.height} @ ${p.fps}fps  duration ${D.toFixed(3)}s (${tc(D, p.fps)})  bg ${p.background}`);
    console.log(`root ${root}\n`);
    console.log('tracks (bottom → top for video):');
    for (const t of p.tracks) {
      const n = p.clips.filter((c) => c.track === t.id).length;
      console.log(`  ${t.id.padEnd(4)} ${t.kind.padEnd(5)} ${String(n).padStart(3)} clips${t.hidden ? '  hidden' : ''}${t.muted ? '  muted' : ''}${t.name ? `  "${t.name}"` : ''}`);
    }
    if (p.markers.length) {
      console.log('\nmarkers:');
      for (const m of p.markers) console.log(`  ${m.id.padEnd(8)} ${m.t.toFixed(3).padStart(8)}s  ${m.note || ''}`);
    }
    console.log('\nclips:');
    console.log(`  ${'id'.padEnd(8)} ${'track'.padEnd(5)} ${'type'.padEnd(5)} ${'start'.padStart(8)} ${'end'.padStart(8)} ${'in'.padStart(7)}  src`);
    const order = new Map(p.tracks.map((t, i) => [t.id, i]));
    for (const c of [...p.clips].sort((a, b) => (order.get(a.track) ?? 0) - (order.get(b.track) ?? 0) || a.start - b.start)) {
      const extra = [];
      if (c.props && Object.keys(c.props).length) extra.push(`props ${JSON.stringify(c.props)}`);
      for (const k of ['x', 'y']) if (c[k]) extra.push(`${k}=${c[k]}`);
      if (c.scale !== 1) extra.push(`scale=${c.scale}`);
      if (c.opacity !== 1) extra.push(`opacity=${c.opacity}`);
      if (c.volume !== 1) extra.push(`vol=${c.volume}`);
      if (c.fadeIn) extra.push(`fadeIn=${c.fadeIn}`);
      if (c.fadeOut) extra.push(`fadeOut=${c.fadeOut}`);
      if (c.fit !== 'contain') extra.push(`fit=${c.fit}`);
      if (c.disabled) extra.push('DISABLED');
      console.log(`  ${c.id.padEnd(8)} ${c.track.padEnd(5)} ${c.type.padEnd(5)} ${c.start.toFixed(3).padStart(8)} ${clipEnd(c).toFixed(3).padStart(8)} ${c.in.toFixed(2).padStart(7)}  ${c.src}${extra.length ? `  · ${extra.join(' ')}` : ''}`);
    }
  },

  async validate(args) {
    const root = projectRoot(args);
    let raw;
    try { raw = await readProject(root); } catch (e) { die(e.message); }
    const media = new Media(root);
    await media.load();
    const { errors, warnings } = await validateFull(root, raw, media);
    for (const e of errors) console.log(`error   ${e}`);
    for (const w of warnings) console.log(`warning ${w}`);
    if (!errors.length) {
      const p = normalizeProject(raw);
      console.log(`ok — ${p.clips.length} clips, ${projectDuration(p).toFixed(3)}s${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
    }
    process.exitCode = errors.length ? 1 : 0;
  },

  async lint(args) {
    let root = null;
    let files;
    if (args.builtin) files = await builtinTargets();
    else if (args._.length) {
      files = args._.map((f) => path.resolve(f));
      root = findRoot(path.dirname(files[0]));
    } else {
      root = projectRoot(args);
      let raw = null;
      try { raw = await readProject(root); } catch { /* lint comps/ anyway */ }
      files = await defaultTargets(root, raw);
    }
    const results = [];
    for (const f of files) {
      if (!fs.existsSync(f)) die(`no such file: ${f}`);
      results.push({ file: path.relative(process.cwd(), f) || f, findings: await lintFile(f, root) });
    }
    const all = results.flatMap((r) => r.findings);
    const errors = all.filter((x) => x.severity === 'error').length;
    const warnings = all.filter((x) => x.severity === 'warning').length;
    if (args.json) console.log(JSON.stringify({ errors, warnings, files: results }, null, 2));
    else {
      for (const r of results) {
        for (const x of r.findings) {
          if (x.severity === 'info' && !args.verbose) continue;
          console.log(`${r.file}:${x.line || 1}  ${x.severity.padEnd(7)} ${x.code}  ${x.message}\n    fix: ${x.fix}`);
        }
      }
      const infos = all.length - errors - warnings;
      console.log(`${files.length} composition${files.length === 1 ? '' : 's'}: ${errors} error(s), ${warnings} warning(s)${infos && !args.verbose ? `, ${infos} note(s) (--verbose)` : ''}`);
    }
    process.exitCode = errors || (args.strict && warnings) ? 1 : 0;
  },

  async gen(args) {
    const [what, ...rest] = args._;
    const root = findRoot(args.C || process.cwd()) || process.cwd();
    const text = rest.join(' ').trim();
    const show = (f) => console.log(path.relative(process.cwd(), f) || f);
    if (what === 'image') {
      if (!text) die('usage: kadr gen image "<prompt>" [--size 1024x1536] [-o out.png]');
      return show(await genImage(root, text, { size: args.size, out: args.o }));
    }
    if (what === 'speech' || what === 'voice' || what === 'tts') {
      const t = text || (args.file ? await fsp.readFile(path.resolve(args.file), 'utf8') : '');
      if (!t.trim()) die('usage: kadr gen speech "<text>" [--voice v] [-o out.mp3]   (or --file script.txt)');
      return show(await genSpeech(root, t.trim(), { voice: args.voice, out: args.o, instructions: args.style }));
    }
    if (what === 'transcribe' || what === 'stt') {
      if (!rest[0]) die('usage: kadr gen transcribe <file> [--language fa] [-o out.json]');
      const { file, result } = await transcribe(root, rest[0], {
        language: args.language, out: args.o, from: args.from != null ? parseTime(args.from) : 0, span: args.span != null ? parseTime(args.span) : undefined,
      });
      show(file);
      console.log(`${result.words.length} words, ${result.segments.length} segments${result.language ? `, language ${result.language}` : ''}`);
      return;
    }
    die('usage: kadr gen image|speech|transcribe ...   (see kadr help)');
  },

  async stock(args) {
    const [sub, ...rest] = args._;
    const root = findRoot(args.C || process.cwd()) || process.cwd();
    const last = path.join(root, '.kadr', 'stock-last.json');
    if (sub === 'search') {
      const q = rest.join(' ').trim();
      if (!q) die('usage: kadr stock search "<words>" [--video] [--orientation portrait]');
      const r = await searchStock(q, { type: args.video ? 'video' : 'photo', orientation: args.orientation || '', count: Number(args.count) || 12, provider: args.from });
      await fsp.mkdir(path.dirname(last), { recursive: true });
      await fsp.writeFile(last, JSON.stringify(r.results));
      if (r.note) console.log(`note: ${r.note}`);
      console.log(`${r.results.length} result(s) from ${r.provider}:`);
      r.results.forEach((x, i) => console.log(`${String(i + 1).padStart(2)}. ${x.type} ${x.width || '?'}x${x.height || '?'}${x.duration ? ` ${Math.round(x.duration)}s` : ''}  ${x.title.slice(0, 70)}
    ${x.license}${x.author ? ` · by ${x.author.slice(0, 60)}` : ''}`));
      if (r.results.length) console.log('download with: kadr stock get <number...>   (look at them first with kadr sheet after downloading)');
      return;
    }
    if (sub === 'get') {
      let list;
      try { list = JSON.parse(await fsp.readFile(last, 'utf8')); } catch { die('search first: kadr stock search "<words>"'); }
      const picks = rest.map(Number).filter((n) => n >= 1 && n <= list.length);
      if (!picks.length) die(`usage: kadr stock get <number...>  (1..${list.length})`);
      for (const n of picks) console.log(await downloadStock(root, list[n - 1]));
      return;
    }
    die('usage: kadr stock search "<words>" | kadr stock get <n...>');
  },

  async site(args) {
    const url = args._[0];
    if (!url) die('usage: kadr site <url> [--images 8]');
    const root = projectRoot(args);
    const r = await readSite(root, url, { images: Number(args.images ?? 8) });
    console.log(`${r.title || r.siteName}
${r.description || ''}`.trim());
    if (r.product) console.log(`product: ${r.product.name || ''}${r.product.price ? ` · ${r.product.price}` : ''}`);
    if (r.themeColor) console.log(`brand color: ${r.themeColor}`);
    for (const i of r.images) console.log(`image: ${i.path} (${i.kind})`);
    console.log(`full notes: ${r.summaryFile}`);
  },

  async mcp() { runMcp(); await new Promise(() => {}); },

  async connect(args) {
    const id = args._[0];
    if (!id) {
      for (const t of connectStatus()) console.log(`${t.id.padEnd(14)} ${t.connected ? 'connected    ' : t.detected ? 'not connected' : 'not found    '}  ${t.name}${t.error ? `  (${t.error})` : ''}`);
      console.log(`\nconnect one: kadr connect <app>   ·   remove: kadr connect <app> --remove\nother apps: add this MCP server by hand:\n${manualSnippet()}`);
      return;
    }
    const r = await setConnected(id, !args.remove);
    console.log(`${r.name}: ${r.connected ? 'connected. Ask it for a video in its own chat.' : 'disconnected'}`);
  },

  async settings() {
    const s = loadSettings();
    const pub = publicSettings(s);
    console.log(`settings file: ${pub.file}`);
    console.log(`chat agent:    ${AGENTS[s.agent].name}`);
    const line = (label, k) => {
      const r = service(s, k);
      if (!r) return console.log(`${label.padEnd(14)} not set up`);
      const ready = !r.needsKey || r.key;
      console.log(`${label.padEnd(14)} ${r.name}${r.model ? ` · ${r.model}` : ''}${r.voice ? ` · voice ${r.voice}` : ''}${ready ? '' : '  (no API key yet)'}`);
    };
    line('agent API:', 'llm');
    line('images:', 'image');
    line('voice:', 'speech');
    line('transcripts:', 'transcribe');
  },

  async skills(args) {
    const root = projectRoot(args);
    const { added, updated } = await installSkills(root, { update: !!args.update });
    for (const n of added) console.log(`added    .claude/skills/${n}`);
    for (const n of updated) console.log(`updated  .claude/skills/${n}`);
    if (!added.length && !updated.length) console.log('skills are up to date (use --update to refresh them from this kadr version)');
  },

  async state(args) {
    const root = projectRoot(args);
    try { process.stdout.write(await fsp.readFile(path.join(root, '.kadr', 'state.json'), 'utf8')); } catch {
      console.log('{}  (the editor has not been opened yet)');
    }
  },

  async add(args) {
    const root = projectRoot(args);
    const src = args._[0];
    if (!src) die('usage: kadr add <src> [--track V1] [--at 0] [--in 0] [--duration d]');
    const raw = await readProject(root);
    const p = normalizeProject(raw);
    const isBuiltin = src.startsWith('@kadr/');
    const abs = resolveSrc(root, src);
    if (!abs || !fs.existsSync(abs)) die(`file not found: ${src}`);
    const kind = isBuiltin ? 'html' : mediaKind(src);
    if (!kind) die(`unsupported file type: ${src}`);
    const media = new Media(root);
    await media.load();
    const info = isBuiltin ? await probe(abs) : await media.info(src);
    const tk = trackKindFor(kind);
    const track = args.track || (tk === 'audio' ? p.tracks.find((t) => t.kind === 'audio') : (kind === 'video' ? p.tracks.find((t) => t.kind === 'video') : [...p.tracks].reverse().find((t) => t.kind === 'video')))?.id;
    if (!track || !p.tracks.find((t) => t.id === track)) die(`no ${tk} track "${track ?? ''}" — add one to "tracks" first`);
    const at = args.at != null ? parseTime(args.at, p.fps) : p.clips.filter((c) => c.track === track).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const inPt = args.in != null ? parseTime(args.in, p.fps) : 0;
    let duration = args.duration != null ? parseTime(args.duration, p.fps) : null;
    if (duration == null) duration = kind === 'image' ? 5 : kind === 'html' ? (info.duration || 5) : Math.max(0.1, (info.duration || 5) - inPt);
    const clip = { id: uid('c', new Set(p.clips.map((c) => c.id))), track, type: kind, src, start: at, duration };
    if (inPt) clip.in = inPt;
    if (args.props) clip.props = JSON.parse(args.props);
    raw.clips = [...(raw.clips || []), clip];
    const v = validateProject(raw);
    if (v.errors.length) die(v.errors.join('\n'));
    await writeProject(root, raw);
    console.log(`added ${clip.id}: ${kind} on ${track}, ${at.toFixed(3)}s → ${(at + duration).toFixed(3)}s`);
    for (const w of v.warnings) console.log(`warning ${w}`);
  },

  async frame(args) {
    const root = projectRoot(args);
    const raw = await readProject(root);
    const p = normalizeProject(raw);
    const times = args._.map((t) => parseTime(t, p.fps));
    if (!times.length || times.some((t) => !Number.isFinite(t))) die('usage: kadr frame <time...> [-o out.png|dir]');
    const outDir = args.o && !args.o.endsWith('.png') ? path.resolve(args.o) : path.join(root, '.kadr', 'frames');
    const media = new Media(root);
    await media.load();
    await withServer(root, async (srv) => {
      for (const t of times) {
        const out = args.o?.endsWith('.png') && times.length === 1 ? path.resolve(args.o) : path.join(outDir, `frame-${t.toFixed(3)}.png`);
        const r = await renderProject({ root, baseUrl: srv.url, media, project: raw, out, from: t, still: true, debug: args.debug });
        console.log(rel(root, out));
        for (const l of r.logs) console.log(`  console ${l}`);
      }
    });
  },

  async sheet(args) {
    const root = projectRoot(args);
    const raw = await readProject(root);
    const p = normalizeProject(raw);
    const count = Math.max(1, Math.min(48, Number(args.count) || 12));
    const cols = Number(args.cols) || Math.min(4, count);
    const target = args._[0];
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'kadr-frames-'));
    const pngs = [];
    const labels = [];
    const media = new Media(root);
    await media.load();
    try {
      if (!target) {
        const D = projectDuration(p);
        if (!D) die('timeline is empty');
        await withServer(root, async (srv) => {
          for (let i = 0; i < count; i++) {
            const t = Math.min(D - 1 / p.fps, (D * (i + 0.5)) / count);
            const out = path.join(tmp, `${i}.png`);
            await renderProject({ root, baseUrl: srv.url, media, project: raw, out, from: t, still: true });
            pngs.push(out);
            labels.push(`${t.toFixed(2)}s  ${tc(t, p.fps)}`);
          }
        });
      } else if (mediaKind(target) === 'html') {
        await withServer(root, async (srv) => {
          const isBuiltin = target.startsWith('@kadr/');
          const absT = isBuiltin ? resolveSrc(root, target) : path.resolve(target);
          const info = await probe(absT);
          const D = info.duration || 5;
          const b = await Browser.launch();
          try {
            const page = await b.newPage(p.width, p.height, { background: args.bg || '#000000' });
            const src = isBuiltin ? target : path.relative(root, absT).split(path.sep).join('/');
            await page.goto(compUrl(srv.url, src, args.props ? JSON.parse(args.props) : null, { 'kadr-render': 1 }));
            for (let i = 0; i < count; i++) {
              const t = (D * i) / Math.max(1, count - 1) - (i === count - 1 ? 1 / p.fps : 0);
              await page.seek(Math.max(0, t));
              const out = path.join(tmp, `${i}.png`);
              await fsp.writeFile(out, await page.screenshot());
              pngs.push(out);
              labels.push(`${Math.max(0, t).toFixed(2)}s`);
            }
            for (const l of page.logs) console.log(`console ${l}`);
          } finally { await b.close(); }
        });
      } else {
        const abs = path.resolve(target);
        const info = await probe(abs);
        if (!info.hasVideo) die(`${target} has no video`);
        for (let i = 0; i < count; i++) {
          const t = (info.duration * (i + 0.5)) / count;
          const out = path.join(tmp, `${i}.png`);
          await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', t.toFixed(3), '-i', abs, '-frames:v', '1', '-update', '1', out]);
          pngs.push(out);
          labels.push(`${t.toFixed(2)}s`);
        }
      }
      const name = target ? path.basename(target).replace(/\.\w+$/, '') : 'timeline';
      if (!target) { /* timeline */ }
      const out = args.o ? path.resolve(args.o) : path.join(root, '.kadr', 'frames', `sheet-${name}.png`);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await sheetFromPngs(pngs, labels, cols, out, Number(args.width) || 480);
      console.log(rel(root, out));
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  },

  async comp(args) {
    const root = projectRoot(args);
    const file = args._[0];
    if (!file || mediaKind(file) !== 'html') die('usage: kadr comp <file.html> [t...] [--props json] [--bg #000]');
    const isBuiltin = file.startsWith('@kadr/');
    const abs = isBuiltin ? resolveSrc(root, file) : path.resolve(file);
    const src = isBuiltin ? file : path.relative(root, abs).split(path.sep).join('/');
    if (!abs || !fs.existsSync(abs)) die(`not found: ${file}`);
    if (src.startsWith('..')) die('the composition must be inside the project folder (or a built-in like @kadr/kinetic.html)');
    const raw = await readProject(root);
    const p = normalizeProject(raw);
    const info = await probe(abs);
    const D = info.duration || 5;
    let times = args._.slice(1).map((t) => parseTime(t, p.fps));
    if (!times.length) times = [0, D * 0.25, D * 0.5, D * 0.75, D - 1 / p.fps].map((t) => Math.max(0, t));
    const outDir = path.resolve(args.o || path.join(root, '.kadr', 'frames'));
    await fsp.mkdir(outDir, { recursive: true });
    await withServer(root, async (srv) => {
      const b = await Browser.launch();
      try {
        const page = await b.newPage(p.width, p.height, { background: args.bg || null });
        await page.goto(compUrl(srv.url, src, args.props ? JSON.parse(args.props) : null, { 'kadr-render': 1 }));
        const name = path.basename(file).replace(/\.\w+$/, '');
        for (const t of times) {
          await page.seek(t);
          const out = path.join(outDir, `${name}-${t.toFixed(3)}.png`);
          await fsp.writeFile(out, await page.screenshot());
          console.log(rel(root, out));
        }
        if (page.logs.length) for (const l of page.logs) console.log(`console ${l}`);
        else console.log('console: no errors');
      } finally { await b.close(); }
    });
  },

  async templates() {
    const dir = path.join(APP_DIR, 'builtin');
    for (const f of (await fsp.readdir(dir)).filter((x) => x.endsWith('.html')).sort()) {
      const info = await probe(path.join(dir, f));
      console.log(`@kadr/${f}  (${info.duration ?? '?'}s)  ${info.description || info.title || ''}`);
      if (info.props) console.log(`    props ${JSON.stringify(info.props)}`);
      if (info.fields) console.log(`    fields ${JSON.stringify(info.fields)}`);
    }
  },

  async probe(args) {
    const f = args._[0];
    if (!f) die('usage: kadr probe <file>');
    console.log(JSON.stringify(await probe(path.resolve(f)), null, 2));
  },

  async freeze(args) {
    const [f, t] = args._;
    if (!f || t == null) die('usage: kadr freeze <video> <sourceTime>');
    const root = projectRoot(args);
    const media = new Media(root);
    await media.load();
    console.log(await media.freeze(path.relative(root, path.resolve(f)), parseTime(t)));
  },

  async reverse(args) {
    const f = args._[0];
    if (!f) die('usage: kadr reverse <file> [--in 0] [--span s]');
    const root = projectRoot(args);
    const media = new Media(root);
    await media.load();
    const rel = path.relative(root, path.resolve(f));
    const info = await media.info(rel);
    const inT = args.in != null ? parseTime(args.in) : 0;
    const span = args.span != null ? parseTime(args.span) : (info.duration || 0) - inT;
    console.log(await media.reverse(rel, inT, span));
  },

  async stabilize(args) {
    const f = args._[0];
    if (!f) die('usage: kadr stabilize <video> [--in 0] [--span s]');
    const root = projectRoot(args);
    const media = new Media(root);
    await media.load();
    const rel = path.relative(root, path.resolve(f));
    const info = await media.info(rel);
    const inT = args.in != null ? parseTime(args.in) : 0;
    const span = args.span != null ? parseTime(args.span) : (info.duration || 0) - inT;
    console.log(await media.stabilize(rel, inT, span));
  },

  async denoise(args) {
    const f = args._[0];
    if (!f) die('usage: kadr denoise <file>');
    const root = projectRoot(args);
    const media = new Media(root);
    await media.load();
    console.log(await media.denoise(path.relative(root, path.resolve(f))));
  },

  async scenes(args) {
    const f = args._[0];
    if (!f) die('usage: kadr scenes <video> [--threshold 0.3]');
    const th = Number(args.threshold) || 0.3;
    console.log(JSON.stringify({ file: f, threshold: th, cuts: await sceneCuts(path.resolve(f), th) }, null, 2));
  },

  async silence(args) {
    const f = args._[0];
    if (!f) die('usage: kadr silence <file> [--noise -35] [--min 0.4]');
    const noise = Number(args.noise ?? -35);
    const min = Number(args.min ?? 0.4);
    const info = await probe(path.resolve(f));
    console.log(JSON.stringify({ file: f, duration: info.duration, noiseDb: noise, minSeconds: min, silences: await silences(path.resolve(f), noise, min, info.duration) }, null, 2));
  },

  async render(args) {
    const root = projectRoot(args);
    const raw = await readProject(root);
    const p = normalizeProject(raw);
    const ext = args.codec === 'prores' ? 'mov' : args.codec === 'vp9' ? 'webm' : 'mp4';
    const out = path.resolve(args.o || path.join(root, 'renders', `${(p.name || 'export').replace(/[^\w.-]+/g, '_')}.${ext}`));
    const media = new Media(root);
    await media.load();
    const { errors, warnings } = await validateFull(root, raw, media);
    for (const w of warnings) console.error(`warning ${w}`);
    if (errors.length) die(`project has errors:\n${errors.map((e) => `  ${e}`).join('\n')}`);
    const t0 = Date.now();
    const r = await withServer(root, (srv) => renderProject({
      root, baseUrl: srv.url, media, project: raw, out,
      from: args.from != null ? parseTime(args.from, p.fps) : undefined,
      to: args.to != null ? parseTime(args.to, p.fps) : undefined,
      crf: args.crf != null ? Number(args.crf) : undefined, preset: args.preset, codec: args.codec,
      width: args.size ? Number(String(args.size).split('x')[0]) : undefined,
      height: args.size ? Number(String(args.size).split('x')[1]) : undefined,
      loudness: args.loudness != null ? Number(args.loudness) : undefined,
      motionBlur: args['motion-blur'] != null ? Number(args['motion-blur']) : undefined,
      shutter: args.shutter != null ? Number(args.shutter) : undefined,
      workers: args.workers ? Number(args.workers) : undefined, noCache: !!args['no-cache'], debug: !!args.debug,
      onProgress: progressBar(),
    }));
    for (const l of r.logs) console.error(`console ${l}`);
    console.log(`${rel(root, out)}  ${r.codec} ${r.size}${r.loudness ? ` ${r.loudness} LUFS` : ''}  (${r.duration.toFixed(2)}s of video in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  },

  async clean(args) {
    const root = projectRoot(args);
    const dir = path.join(root, '.kadr', 'cache');
    let n = 0;
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      if (f.startsWith('comp-')) { await fsp.rm(path.join(dir, f), { force: true }); n++; }
    }
    console.log(`removed ${n} cached composition renders`);
  },
};

process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });
const [cmd = 'help', ...rest] = process.argv.slice(2);
const fn = commands[cmd] || (cmd === '--help' || cmd === '-h' ? commands.help : null);
if (!fn) die(`unknown command "${cmd}" — run "kadr help"`);
fn(parseArgs(rest)).catch((e) => die(e.message));

export { APP_DIR };
