import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validateProject, serializeProject, mediaKind, tc } from '../shared/model.js';
import { APP_DIR, BUILTIN_DIR, safeJoin, readProjectText, resolveSrc } from './project.js';
import { Media } from './media.js';
import { renderProject } from './render.js';
import { findChrome } from './chrome.js';
import { AgentBridge, which } from './agent.js';
import { genImage, genSpeech } from './gen.js';
import { searchStock, downloadStock } from './stock.js';
import { readSite } from './site.js';
import { connectStatus, setConnected, manualSnippet } from './connect.js';
import { loadSettings, saveSettings, publicSettings, mergeSettings, keyFor, testKey } from './settings.js';
import { probe, sceneCuts, silences } from './media.js';
import { findRoot } from './project.js';
import { initProject } from './init.js';
import { listRecent, touchRecent, forgetRecent, recentPaths, thumbFor } from './recent.js';
import { annotate } from '../shared/htmlsrc.js';
import os from 'node:os';
import crypto from 'node:crypto';

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', bin: 'application/octet-stream',
};
const mime = (f) => MIME[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream';

const RUNTIME_TAG = '<script src="/kadr/runtime.js"></script>';
function injectRuntime(html, edit = false) {
  // In the visual editor every element carries data-kat="<offset in the file>"
  // so a click on the page can be mapped back to the exact source.
  if (edit) { try { html = annotate(html); } catch { /* serve unannotated */ } }
  if (html.includes('/kadr/runtime.js')) return html;
  const m = html.match(/<head[^>]*>/i);
  if (m) return html.replace(m[0], `${m[0]}\n${RUNTIME_TAG}`);
  return RUNTIME_TAG + html;
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': MIME.json, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

async function readBody(req, limit = 20e6) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString();
}

async function sendFile(req, res, file, { inject = false, noStore = false, edit = false } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return json(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return json(res, 404, { error: 'not found' });
  const type = mime(file);
  if (inject && type.startsWith('text/html')) {
    const s = injectRuntime(await fsp.readFile(file, 'utf8'), edit);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    return res.end(s);
  }
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const base = { 'content-type': type, 'accept-ranges': 'bytes', etag, 'cache-control': noStore ? 'no-store' : 'no-cache' };
  if (!noStore && req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let a = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let b = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    a = Math.max(0, a);
    b = Math.min(st.size - 1, b);
    if (a > b) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...base, 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': b - a + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { ...base, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function openPath(p) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(cmd, [p], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

/**
 * Watch a folder tree. One non-recursive watcher per directory, so events are
 * keyed by file *name*: atomic saves (write tmp + rename) never detach us, which
 * Node's recursive watcher on Linux does (it follows inodes).
 */
function watchTree(root, ignore, cb) {
  const watchers = new Map();
  const add = (dir) => {
    if (watchers.has(dir)) return;
    let w;
    try {
      w = fs.watch(dir, (ev, name) => {
        if (!name) return;
        const abs = path.join(dir, name.toString());
        const rel = path.relative(root, abs).split(path.sep).join('/');
        if (ignore(rel)) return;
        cb(rel);
        if (ev === 'rename') fs.stat(abs, (e, st) => { if (!e && st.isDirectory()) scan(abs, 0); });
      });
    } catch { return; }
    w.on('error', () => { w.close(); watchers.delete(dir); });
    watchers.set(dir, w);
  };
  const scan = (dir, depth) => {
    add(dir);
    if (depth > 5) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = path.join(dir, e.name);
      if (!ignore(path.relative(root, abs).split(path.sep).join('/'))) scan(abs, depth + 1);
    }
  };
  scan(root, 0);
  return { close() { for (const w of watchers.values()) w.close(); watchers.clear(); } };
}

const safeName = (n) => path.basename(String(n)).replace(/[^\w.\- ()؀-ۿ]+/g, '_').replace(/^\.+/, '') || 'file';

/**
 * Start the local server.
 * ui:false + watch:false is the "render only" mode the CLI uses.
 */
export async function startServer({ root: startRoot, port = 4310, host = '127.0.0.1', ui = true, watch = true, quiet = false } = {}) {
  const clients = new Set();
  const broadcast = (msg) => {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(data);
  };
  // Per-project state. The editor can switch projects (Projects menu), so all of
  // this is replaced by openRoot() instead of living for the whole process.
  let root = '';
  let media = null;
  let projectFile = '';
  let lastText = null;
  let agent = null;
  let watcher = null;
  let job = null;
  // Every state-changing request must carry this token. Only our own page gets
  // it (injected into index.html), so other sites can't drive the editor or the
  // agent through localhost.
  const token = crypto.randomBytes(18).toString('hex');
  let baseUrl = '';
  const recent = [];
  const activity = (entry) => {
    recent.unshift({ at: Date.now(), ...entry });
    recent.length = Math.min(recent.length, 40);
    broadcast({ type: 'activity', ...recent[0] });
  };

  async function onProjectChanged() {
    let text;
    try { text = await readProjectText(root); } catch { return; }
    if (text === lastText) return;
    lastText = text;
    let raw;
    try { raw = JSON.parse(text); } catch (e) {
      broadcast({ type: 'project-error', error: `project.json is not valid JSON: ${e.message}` });
      return;
    }
    const { errors, warnings } = validateProject(raw);
    broadcast({ type: 'project', project: raw, errors, warnings, origin: 'disk' });
    activity({ kind: 'project', path: 'project.json' });
  }

  function startWatch() {
    const timers = new Map();
    let mediaTimer = null;
    const ignore = (name) => /^(\.kadr|\.git|node_modules|renders)(\/|$)/.test(name)
      || /\.tmp$|\.part(\.\w+)?$|\.partial\.\w+$|~$|\.swp$|\.swx$|(^|\/)\.project\.json|(^|\/)\.#|\/4913$|^4913$/.test(name);
    return watchTree(root, ignore, (name) => {
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => {
        timers.delete(name);
        if (name === 'project.json') return onProjectChanged();
        broadcast({ type: 'asset', path: name });
        if (mediaKind(name)) {
          activity({ kind: 'file', path: name });
          clearTimeout(mediaTimer);
          mediaTimer = setTimeout(() => broadcast({ type: 'media' }), 250);
        }
      }, 70));
    });
  }

  /** Make dir the open project: new media index, chat, watcher. */
  async function openRoot(dir) {
    if (job?.state === 'running') throw Object.assign(new Error('an export is running: wait for it or cancel it first'), { status: 409 });
    if (agent?.proc) throw Object.assign(new Error('the chat agent is still working: stop it first'), { status: 409 });
    const m = new Media(dir);
    await m.load();
    watcher?.close();
    watcher = null;
    agent?.stop();
    media?.listeners.clear();
    root = dir;
    media = m;
    media.on(broadcast);
    projectFile = path.join(root, 'project.json');
    lastText = await readProjectText(root).catch(() => null);
    agent = new AgentBridge(root, broadcast);
    job = null;
    recent.length = 0;
    if (watch) watcher = startWatch();
    if (ui) await touchRecent(root);
  }
  await openRoot(startRoot);

  const expand = (p) => path.resolve(String(p || '').trim().replace(/^~(?=$|\/)/, os.homedir()));
  const compFile = (src) => {
    src = String(src || '');
    if (src.startsWith('@kadr/')) return { abs: resolveSrc(root, src), readonly: true };
    const abs = safeJoin(root, src);
    if (!abs || !/\.html?$/i.test(abs) || /(^|\/)\.(git|kadr)(\/|$)/.test(src)) throw Object.assign(new Error('not a composition in this project'), { status: 400 });
    return { abs, readonly: false };
  };
  const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

  async function startExport(body) {
    if (job?.state === 'running') throw Object.assign(new Error('an export is already running'), { status: 409 });
    const raw = JSON.parse(await readProjectText(root));
    const name = safeName(body.out || `${raw.name || 'export'}.mp4`);
    const out = path.join(root, 'renders', /\.(mp4|webm|mov|mkv|gif|wav|mp3|m4a|flac)$/i.test(name) ? name : `${name}.mp4`);
    const ac = new AbortController();
    job = { id: Date.now().toString(36), state: 'running', progress: 0, phase: 'starting', out: path.relative(root, out), ac, started: Date.now() };
    const pub = () => broadcast({ type: 'export', id: job.id, state: job.state, progress: job.progress, phase: job.phase, detail: job.detail, out: job.out, error: job.error, logs: job.logs, elapsed: Date.now() - job.started });
    pub();
    let lastPub = 0;
    renderProject({
      root, baseUrl, media, project: raw, out, from: body.from, to: body.to, crf: body.crf, preset: body.preset, signal: ac.signal,
      codec: body.codec, width: body.width, height: body.height, loudness: body.loudness, motionBlur: body.motionBlur, audioBitrate: body.audioBitrate,
      onProgress: (pr) => {
        Object.assign(job, pr);
        const now = Date.now();
        if (now - lastPub > 150) { lastPub = now; pub(); }
      },
    }).then((r) => {
      Object.assign(job, { state: 'done', progress: 1, phase: 'done', logs: r.logs });
      activity({ kind: 'export', path: job.out });
      pub();
    }).catch((e) => {
      Object.assign(job, { state: ac.signal.aborted ? 'cancelled' : 'error', error: e.message });
      pub();
    });
    return { id: job.id, out: job.out };
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const m = req.method;
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return json(res, 403, { error: 'bad host' });
    if (p.startsWith('/api/') && m !== 'GET' && m !== 'HEAD') {
      const origin = req.headers.origin;
      const okOrigin = !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
      if (p === '/api/log') { if (!okOrigin) return json(res, 403, { error: 'forbidden' }); }
      else if (req.headers['x-kadr-token'] !== token || !okOrigin) return json(res, 403, { error: 'missing editor token: reload the page' });
    }

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': kadr\n\n');
      clients.add(res);
      const ka = setInterval(() => res.write(': ka\n\n'), 25000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }
    if (p === '/api/project' && m === 'GET') {
      let text;
      try { text = await readProjectText(root); } catch { return json(res, 404, { error: 'project.json not found' }); }
      try {
        const raw = JSON.parse(text);
        return json(res, 200, { project: raw, ...validateProject(raw), root });
      } catch (e) {
        return json(res, 200, { error: `project.json is not valid JSON: ${e.message}`, root });
      }
    }
    if (p === '/api/project' && m === 'PUT') {
      const raw = JSON.parse(await readBody(req));
      const { errors } = validateProject(raw);
      if (errors.length) return json(res, 400, { errors });
      const text = serializeProject(raw);
      if (text !== lastText) {
        const tmp = path.join(root, `.project.json.${process.pid}.tmp`);
        await fsp.writeFile(tmp, text);
        await fsp.rename(tmp, projectFile);
        lastText = text;
        broadcast({ type: 'project', project: JSON.parse(text), errors: [], warnings: validateProject(raw).warnings, origin: req.headers['x-kadr-client'] || 'ui' });
      }
      return json(res, 200, { ok: true });
    }
    if (p === '/api/info') {
      return json(res, 200, { root, app: APP_DIR, chrome: findChrome(), activity: recent, job: job && { ...job, ac: undefined } });
    }
    if (p === '/api/media') return json(res, 200, await media.list());
    if (p === '/api/strip' || p === '/api/peaks') {
      try {
        const file = p === '/api/strip' ? await media.strip(url.searchParams.get('src')) : await media.peaks(url.searchParams.get('src'));
        return sendFile(req, res, file);
      } catch (e) { return json(res, 404, { error: e.message }); }
    }
    if (p === '/api/upload' && m === 'POST') {
      // optional sub-folder of media/ (e.g. "brief"), letters, digits, - and _ only
      const sub = String(url.searchParams.get('dir') || '').replace(/[^\w-]/g, '').slice(0, 40);
      const dir = path.join(root, 'media', sub);
      await fsp.mkdir(dir, { recursive: true });
      const name = safeName(url.searchParams.get('name'));
      const ext = path.extname(name);
      let dest = path.join(dir, name);
      for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${name.slice(0, name.length - ext.length)}-${i}${ext}`);
      const tmp = `${dest}.part`;
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(tmp);
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });
      await fsp.rename(tmp, dest);
      const rel = path.relative(root, dest).split(path.sep).join('/');
      broadcast({ type: 'media' });
      return json(res, 200, { path: rel });
    }
    if (p === '/api/state' && m === 'PUT') {
      const body = await readBody(req, 1e6);
      await fsp.mkdir(path.join(root, '.kadr'), { recursive: true });
      await fsp.writeFile(path.join(root, '.kadr', 'state.json'), `${JSON.stringify(JSON.parse(body), null, 2)}\n`);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/log' && m === 'POST') {
      const body = JSON.parse(await readBody(req, 1e5));
      const line = `${new Date().toISOString()} ${body.src} ${body.kind}: ${body.msg}\n`;
      const dir = path.join(root, '.kadr', 'logs');
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'console.log');
      try { if ((await fsp.stat(file)).size > 512e3) await fsp.rename(file, `${file}.1`); } catch { /* new */ }
      await fsp.appendFile(file, line);
      broadcast({ type: 'log', src: body.src, kind: body.kind, msg: body.msg });
      res.writeHead(204);
      return res.end();
    }
    if (p === '/api/settings' && m === 'GET') return json(res, 200, { ...publicSettings(loadSettings()), agents: agent.info().agents, local: { piper: !!which('piper'), espeak: !!which('espeak-ng') } });
    if (p === '/api/connect' && m === 'GET') return json(res, 200, { targets: connectStatus(), snippet: manualSnippet() });
    if (p === '/api/connect' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 2e3));
      await setConnected(String(b.id || ''), !!b.on);
      return json(res, 200, { targets: connectStatus(), snippet: manualSnippet() });
    }
    if (p === '/api/brief' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 2e5));
      const brief = b.brief && typeof b.brief === 'object' ? b.brief : {};
      const dir = path.join(root, 'brief');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
      // the same, readable for people
      const lines = ['# Video brief', ''];
      for (const [k, v] of Object.entries(brief)) {
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
        lines.push(Array.isArray(v) ? `- **${k}**:\n${v.map((x) => `  - ${typeof x === 'object' ? JSON.stringify(x) : x}`).join('\n')}` : `- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/\n/g, '\n  ')}`);
      }
      await fsp.writeFile(path.join(dir, 'brief.md'), `${lines.join('\n')}\n`);
      return json(res, 200, { path: 'brief/brief.json' });
    }
    if (p === '/api/stock/search' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 4e3));
      return json(res, 200, await searchStock(String(b.query || '').trim() || 'nature', { type: b.type, orientation: b.orientation, count: b.count, provider: b.provider || undefined }));
    }
    if (p === '/api/stock/get' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 2e4));
      const rel = await downloadStock(root, b.item);
      broadcast({ type: 'media' });
      return json(res, 200, { path: rel });
    }
    if (p === '/api/site' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 4e3));
      const r = await readSite(root, String(b.url || ''), { images: b.images ?? 8 });
      broadcast({ type: 'media' });
      return json(res, 200, r);
    }
    if (p === '/api/gen' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 2e4));
      let file;
      if (b.kind === 'image') file = await genImage(root, String(b.prompt || '').trim() || 'abstract background', { size: b.size || '1536x1024' });
      else if (b.kind === 'speech') file = await genSpeech(root, String(b.text || '').trim(), { voice: b.voice || undefined });
      else throw Object.assign(new Error('unknown kind'), { status: 400 });
      broadcast({ type: 'media' });
      return json(res, 200, { path: path.relative(root, file) });
    }
    if (p === '/api/settings/test' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 4e3));
      const st = loadSettings();
      const key = b.provider === 'custom' ? st[b.kind]?.key : keyFor(st, b.provider);
      return json(res, 200, await testKey(b.provider, key, b.provider === 'custom' ? st[b.kind]?.baseUrl : undefined));
    }
    if (p === '/api/settings' && m === 'POST') {
      if (agent.proc) throw Object.assign(new Error('wait for the chat agent to finish first'), { status: 409 });
      const next = mergeSettings(loadSettings(), JSON.parse(await readBody(req, 2e4)));
      await saveSettings(next);
      broadcast({ type: 'settings' });
      return json(res, 200, { ...publicSettings(next), agents: agent.info().agents });
    }
    if (p === '/api/agent' && m === 'GET') return json(res, 200, agent.info());
    if (p === '/api/agent' && m === 'POST') {
      const b = JSON.parse(await readBody(req, 2e5));
      return json(res, 200, await agent.send(b));
    }
    if (p === '/api/agent/stop' && m === 'POST') { agent.stop(); return json(res, 200, { ok: true }); }
    if (p === '/api/agent/reset' && m === 'POST') { agent.reset(); return json(res, 200, { ok: true }); }
    if (p === '/api/agent/revert' && m === 'POST') { await agent.restore(JSON.parse(await readBody(req)).id); return json(res, 200, { ok: true }); }
    if (p === '/api/templates') {
      const list = [];
      for (const f of (await fsp.readdir(BUILTIN_DIR)).filter((x) => x.endsWith('.html')).sort()) {
        list.push({ path: `@kadr/${f}`, ...(await probe(path.join(BUILTIN_DIR, f))) });
      }
      return json(res, 200, list);
    }
    if (p === '/api/export' && m === 'POST') return json(res, 200, await startExport(JSON.parse((await readBody(req)) || '{}')));
    if (p === '/api/export/cancel' && m === 'POST') { job?.ac.abort(); return json(res, 200, { ok: true }); }
    if (p === '/api/frame' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      const raw = JSON.parse(await readProjectText(root));
      const out = path.join(root, 'renders', `frame-${tc(body.t, raw.fps || 30).replace(/:/g, '-')}.png`);
      await renderProject({ root, baseUrl, media, project: raw, out, from: body.t, still: true });
      return json(res, 200, { path: path.relative(root, out) });
    }
    if (p === '/api/freeze' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(res, 200, { path: await media.freeze(String(body.src), body.t) });
    }
    if (p === '/api/reverse' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(res, 200, { path: await media.reverse(String(body.src), body.in, body.span) });
    }
    if (p === '/api/stabilize' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(res, 200, { path: await media.stabilize(String(body.src), body.in, body.span) });
    }
    if (p === '/api/denoise' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(res, 200, { path: await media.denoise(String(body.src)) });
    }
    if (p === '/api/scenes' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      const th = Math.min(0.9, Math.max(0.05, Number(body.threshold) || 0.3));
      return json(res, 200, { cuts: await sceneCuts(media.abs(String(body.src)), th) });
    }
    if (p === '/api/silence' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      const info = await media.info(String(body.src));
      const noise = Math.min(-10, Math.max(-90, Number(body.noise ?? -35)));
      const min = Math.min(10, Math.max(0.1, Number(body.min ?? 0.5)));
      return json(res, 200, { silences: await silences(media.abs(String(body.src)), noise, min, info.duration) });
    }
    if (p === '/api/reveal' && m === 'POST') {
      const body = JSON.parse(await readBody(req));
      const abs = safeJoin(root, body.path || '.');
      if (!abs) return json(res, 400, { error: 'bad path' });
      openPath(body.select ? path.dirname(abs) : abs);
      return json(res, 200, { ok: true });
    }
    // ---------- projects (recent list, open, new) ----------
    if (p === '/api/recent' && m === 'GET') {
      return json(res, 200, { current: root, home: os.homedir(), list: await listRecent() });
    }
    if (p === '/api/recent/thumb') {
      const dir = String(url.searchParams.get('path') || '');
      if (!(await recentPaths()).includes(dir)) return json(res, 404, { error: 'not a recent project' });
      const f = thumbFor(dir);
      return f ? sendFile(req, res, f) : json(res, 404, { error: 'no picture' });
    }
    if (p === '/api/recent/forget' && m === 'POST') {
      await forgetRecent(String(JSON.parse(await readBody(req)).path || ''));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/open' && m === 'POST') {
      const want = expand(JSON.parse(await readBody(req)).path);
      const dir = fs.existsSync(path.join(want, 'project.json')) ? want : findRoot(want);
      if (!dir) return json(res, 404, { error: `no project.json in ${want}` });
      if (dir !== root) {
        await openRoot(dir);
        broadcast({ type: 'reopen', root });
      }
      return json(res, 200, { root });
    }
    if (p === '/api/new' && m === 'POST') {
      const b = JSON.parse(await readBody(req));
      const dir = expand(b.path);
      if (fs.existsSync(path.join(dir, 'project.json'))) return json(res, 409, { error: `${dir} already has a project` });
      await initProject(dir, { name: String(b.name || '').trim() || undefined, width: Number(b.width) || 1920, height: Number(b.height) || 1080, fps: Number(b.fps) || 30 });
      await openRoot(dir);
      broadcast({ type: 'reopen', root });
      return json(res, 200, { root });
    }

    // ---------- visual composition editor ----------
    if (p === '/api/comp' && m === 'GET') {
      const src = url.searchParams.get('src');
      const { abs, readonly } = compFile(src);
      let source;
      try { source = await fsp.readFile(abs, 'utf8'); } catch { return json(res, 404, { error: `not found: ${src}` }); }
      return json(res, 200, { src, source, hash: hash(source), readonly });
    }
    if (p === '/api/comp' && m === 'PUT') {
      const b = JSON.parse(await readBody(req, 5e6));
      const { abs, readonly } = compFile(b.src);
      if (readonly) return json(res, 403, { error: 'built-in templates are read-only: make an editable copy first' });
      if (typeof b.source !== 'string') return json(res, 400, { error: 'source missing' });
      const cur = await fsp.readFile(abs, 'utf8').catch(() => '');
      if (b.hash && hash(cur) !== b.hash) return json(res, 409, { error: `${b.src} changed on disk (an agent edited it?). It has been reloaded: try again.`, source: cur, hash: hash(cur) });
      const tmp = `${abs}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, b.source);
      await fsp.rename(tmp, abs);
      activity({ kind: 'file', path: b.src });
      return json(res, 200, { hash: hash(b.source) });
    }
    if (p === '/api/comp/copy' && m === 'POST') {
      const b = JSON.parse(await readBody(req));
      const { abs } = compFile(b.src);
      const dir = path.join(root, 'comps');
      await fsp.mkdir(dir, { recursive: true });
      const base = safeName(path.basename(abs, '.html'));
      let dest = path.join(dir, `${base}.html`);
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base}-${i}.html`);
      await fsp.copyFile(abs, dest);
      broadcast({ type: 'media' });
      return json(res, 200, { path: path.relative(root, dest).split(path.sep).join('/') });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    if (p === '/favicon.ico') {
      if (ui) return sendFile(req, res, path.join(APP_DIR, 'web', 'favicon.svg'));
      res.writeHead(204);
      return res.end();
    }

    if (p === '/kadr/runtime.js') return sendFile(req, res, path.join(APP_DIR, 'runtime', 'kadr.js'), { noStore: true });
    if (p.startsWith('/kadr/builtin/')) {
      const f = safeJoin(BUILTIN_DIR, p.slice('/kadr/builtin/'.length));
      return f ? sendFile(req, res, f, { inject: true, edit: url.searchParams.has('kadr-edit') }) : json(res, 400, { error: 'bad path' });
    }
    if (p.startsWith('/shared/')) {
      const f = safeJoin(path.join(APP_DIR, 'shared'), p.slice(8));
      return f ? sendFile(req, res, f, { noStore: true }) : json(res, 400, { error: 'bad path' });
    }
    if (p.startsWith('/p/')) {
      const rel = p.slice(3);
      if (/(^|\/)\.git(\/|$)/.test(rel)) return json(res, 403, { error: 'forbidden' });
      const f = safeJoin(root, rel);
      return f ? sendFile(req, res, f, { inject: true, edit: url.searchParams.has('kadr-edit') }) : json(res, 400, { error: 'bad path' });
    }
    if (ui) {
      if (p === '/' || p === '/index.html') {
        const html = (await fsp.readFile(path.join(APP_DIR, 'web', 'index.html'), 'utf8'))
          .replace('<head>', `<head>\n<meta name="kadr-token" content="${token}">`);
        res.writeHead(200, { 'content-type': MIME.html, 'cache-control': 'no-store' });
        return res.end(html);
      }
      const f = safeJoin(path.join(APP_DIR, 'web'), p.slice(1));
      return f ? sendFile(req, res, f, { noStore: true }) : json(res, 400, { error: 'bad path' });
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (!quiet) console.error(`[kadr] ${req.method} ${req.url}: ${e.message}`);
      if (!res.headersSent) json(res, e.status || 500, { error: e.message });
      else res.end();
    });
  });
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  baseUrl = `http://${host}:${server.address().port}`;

  return {
    url: baseUrl,
    get media() { return media; },
    get root() { return root; },
    broadcast,
    async close() {
      agent.stop();
      watcher?.close();
      job?.ac?.abort();
      for (const c of clients) c.end();
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
    },
  };
}
