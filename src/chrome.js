// Minimal Chrome DevTools Protocol client. No puppeteer: Node's built-in
// WebSocket talks to a headless Chromium we start only while rendering.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  'chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'chrome',
  'chrome-headless-shell', 'microsoft-edge', 'brave-browser',
];
const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function findChrome() {
  if (process.env.KADR_CHROME) return process.env.KADR_CHROME;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const name of CANDIDATES) {
    for (const d of dirs) {
      const p = path.join(d, name);
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
    }
  }
  return MAC.find((p) => fs.existsSync(p)) || null;
}

const FLAGS = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--disable-features=Translate,MediaRouter',
  '--force-color-profile=srgb', '--font-render-hinting=none', '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=0',
];

export class Browser {
  static async launch() {
    const bin = findChrome();
    if (!bin) throw new Error('Chromium/Chrome not found. Install chromium or set KADR_CHROME=/path/to/chrome');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-chrome-'));
    const proc = spawn(bin, [...FLAGS, `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`Chrome did not start in time:\n${buf.slice(-1500)}`)), 30000);
      proc.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      proc.on('error', (e) => { clearTimeout(timer); reject(e); });
      proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}):\n${buf.slice(-1500)}`)); });
    });
    proc.stderr.resume();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cannot connect to Chrome')); });
    return new Browser(proc, ws, dir);
  }

  constructor(proc, ws, dir) {
    this.proc = proc;
    this.ws = ws;
    this.dir = dir;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`));
        else p.res(m.result);
      } else {
        for (const fn of this.listeners) fn(m);
      }
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.rej(new Error('Chrome connection closed'));
      this.pending.clear();
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej, method });
      this.ws.send(JSON.stringify(msg));
    });
  }

  async newPage(width, height, { background = null } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await page.init(width, height, background);
    return page;
  }

  async close() {
    try { await Promise.race([this.send('Browser.close'), new Promise((r) => setTimeout(r, 1500))]); } catch { /* gone */ }
    try { this.ws.close(); } catch { /* gone */ }
    try { this.proc.kill('SIGKILL'); } catch { /* gone */ }
    fs.rm(this.dir, { recursive: true, force: true }, () => {});
  }
}

function hexToRgba(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const n = parseInt(m[1], 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

export class Page {
  constructor(browser, sessionId, targetId) {
    this.b = browser;
    this.sid = sessionId;
    this.targetId = targetId;
    this.logs = [];
    this.off = null;
  }

  send(method, params) { return this.b.send(method, params, this.sid); }

  async init(width, height, background) {
    const onEvent = (m) => {
      if (m.sessionId !== this.sid) return;
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.logs.push(`error: ${d.exception?.description?.split('\n')[0] || d.text} (line ${d.lineNumber + 1})`);
      } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        this.logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.logs.push(`error: ${m.params.entry.text}${m.params.entry.url ? ` (${m.params.entry.url})` : ''}`);
      }
      for (const w of this.waiters || []) if (w.method === m.method) w.resolve(m.params);
    };
    this.b.listeners.add(onEvent);
    this.off = () => this.b.listeners.delete(onEvent);
    this.waiters = [];
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Log.enable')]);
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setDefaultBackgroundColorOverride', { color: background ? hexToRgba(background) : { r: 0, g: 0, b: 0, a: 0 } });
  }

  waitFor(method, ms = 30000) {
    return new Promise((resolve, reject) => {
      const w = { method, resolve: (p) => { clearTimeout(t); this.waiters.splice(this.waiters.indexOf(w), 1); resolve(p); } };
      const t = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`timeout waiting for ${method}`)); }, ms);
      this.waiters.push(w);
    });
  }

  async goto(url) {
    const loaded = this.waitFor('Page.loadEventFired');
    const r = await this.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`cannot load ${url}: ${r.errorText}`);
    await loaded;
    const ok = await this.eval('window.kadr ? kadr.ready.then(() => true) : false');
    if (!ok) throw new Error(`${url} did not load the kadr runtime`);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  seek(t) { return this.eval(`kadr.seek(${Number(t).toFixed(6)})`); }

  async screenshot(format = 'png') {
    const r = await this.send('Page.captureScreenshot', { format, optimizeForSpeed: true, captureBeyondViewport: false });
    return Buffer.from(r.data, 'base64');
  }

  async close() {
    this.off?.();
    try { await this.b.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* gone */ }
  }
}
