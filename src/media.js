import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { mediaKind, stripSpec } from '../shared/model.js';
import { resolveSrc } from './project.js';
import { readFields } from '../shared/lint.js';

/**
 * Run a process. Resolves with stdout (string, or Buffer with binary:true).
 * nice: lower the child's CPU priority so background work never starves the UI.
 */
export function run(cmd, args, { nice = 0, onStdout, signal, binary = false, stderr: wantStderr = false, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    if (nice) {
      try { os.setPriority(p.pid, nice); } catch { /* not allowed: fine */ }
    }
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => (onStdout ? onStdout(d) : out.push(d)));
    p.stderr.on('data', (d) => {
      err += d;
      if (!wantStderr && err.length > 40000) err = err.slice(-20000);
    });
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} is not installed or not on PATH`) : e));
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('cancelled'));
      if (code !== 0) {
        return reject(new Error(`${cmd} exited with ${code}: ${err.trim().split('\n').slice(-8).join('\n')}`));
      }
      const buf = Buffer.concat(out);
      const stdout = binary ? buf : buf.toString();
      resolve(wantStderr ? { stdout, stderr: err } : stdout);
    });
  });
}

export function limiter(n) {
  let active = 0;
  const q = [];
  const next = () => {
    if (active >= n || !q.length) return;
    active++;
    const { fn, res, rej } = q.shift();
    Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

let filterList = null;
/** Whether this ffmpeg build has a filter (vidstab is optional in some builds). */
export async function hasFilter(name) {
  filterList ??= run('ffmpeg', ['-hide_banner', '-filters']).catch(() => '');
  return new RegExp(`\\s${name}\\s`).test(await filterList);
}

/** Shot changes in a video: [{ t, score }] (seconds in the file). */
export async function sceneCuts(abs, threshold = 0.3) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', abs, '-an', '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`, '-f', 'null', '-'], { stderr: true, nice: 5 });
  const cuts = [];
  const re = /pts_time:([\d.]+)[\s\S]*?lavfi\.scene_score=([\d.]+)/g;
  let m;
  while ((m = re.exec(stdout))) cuts.push({ t: Math.round(Number(m[1]) * 1000) / 1000, score: Math.round(Number(m[2]) * 1000) / 1000 });
  return cuts;
}

/** Quiet ranges in a file's sound: [{ start, end }] (seconds in the file). */
export async function silences(abs, noise = -35, min = 0.4, duration = null) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', abs, '-vn', '-af', `silencedetect=n=${noise}dB:d=${min}`, '-f', 'null', '-'], { stderr: true, nice: 5 });
  const out = [];
  let cur = null;
  for (const l of stderr.split('\n')) {
    const s = l.match(/silence_start: (-?[\d.]+)/);
    const e = l.match(/silence_end: ([\d.]+)/);
    if (s) cur = { start: Math.max(0, Number(s[1])) };
    if (e && cur) { cur.end = Number(e[1]); out.push(cur); cur = null; }
  }
  if (cur && duration) { cur.end = duration; out.push(cur); }
  const r = (n) => Math.round(n * 1000) / 1000;
  return out.map((x) => ({ start: r(x.start), end: r(x.end) }));
}

const PREVIEW_VCODECS = ['h264', 'vp8', 'vp9', 'av1'];
const PREVIEW_ACODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8'];

function rate(s) {
  if (!s || s === '0/0') return null;
  const [a, b] = s.split('/').map(Number);
  return b ? a / b : a;
}

export async function probe(abs) {
  const kind = mediaKind(abs);
  if (kind === 'html') {
    const txt = await fsp.readFile(abs, 'utf8');
    const m = txt.match(/<meta\s+name=["']kadr:duration["']\s+content=["']([\d.]+)["']/i);
    const t = txt.match(/<title>([^<]*)<\/title>/i);
    const pm = txt.match(/<meta\s+name=["']kadr:props["']\s+content='([^']*)'/i) || txt.match(/<meta\s+name=["']kadr:props["']\s+content="([^"]*)"/i);
    let props = null;
    if (pm) { try { props = JSON.parse(pm[1].replace(/&quot;/g, '"')); } catch { props = null; } }
    const d = txt.match(/<meta\s+name=["']kadr:description["']\s+content=["']([^"']*)["']/i);
    const cat = txt.match(/<meta\s+name=["']kadr:category["']\s+content=["']([^"']*)["']/i);
    return { kind, duration: m ? parseFloat(m[1]) : null, title: t ? t[1].trim() : null, props, fields: readFields(txt), description: d ? d[1] : null, category: cat ? cat[1] : null };
  }
  const json = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs]);
  const j = JSON.parse(json);
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  let width = v?.width || 0;
  let height = v?.height || 0;
  const rot = Number(v?.side_data_list?.find((d) => d.rotation != null)?.rotation ?? v?.tags?.rotate ?? 0);
  if (Math.abs(rot) % 180 === 90) [width, height] = [height, width];
  const duration = parseFloat(j.format?.duration) || parseFloat(v?.duration) || parseFloat(a?.duration) || 0;
  const info = {
    kind,
    duration: kind === 'image' ? null : duration,
    width,
    height,
    fps: v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : null,
    hasVideo: !!v,
    hasAudio: !!a,
    vcodec: v?.codec_name || null,
    acodec: a?.codec_name || null,
    format: j.format?.format_name || null,
    size: Number(j.format?.size) || null,
  };
  if (kind === 'video') {
    const container = /mp4|mov|webm|matroska/.test(info.format || '');
    const vOk = PREVIEW_VCODECS.includes(info.vcodec) && container && !(info.format?.startsWith('matroska') && info.vcodec === 'h264');
    const aOk = !a || PREVIEW_ACODECS.includes(info.acodec);
    info.previewable = !!(vOk && aOk);
  }
  return info;
}

/** Media index for one project: probes, filmstrips, waveforms, preview proxies (all cached in .kadr/cache). */
export class Media {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, '.kadr', 'cache');
    this.probes = new Map();
    this.inflight = new Map();
    this.fast = limiter(Math.max(2, Math.min(4, os.cpus().length >> 1)));
    this.bg = limiter(1);
    this.listeners = new Set();
    this.persistTimer = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  async load() {
    await fsp.mkdir(this.dir, { recursive: true });
    try {
      const j = JSON.parse(await fsp.readFile(path.join(this.dir, 'probe.json'), 'utf8'));
      for (const [k, v] of Object.entries(j)) this.probes.set(k, v);
    } catch { /* first run */ }
  }

  persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      const obj = Object.fromEntries([...this.probes].filter(([, v]) => v.kind !== 'html'));
      fsp.writeFile(path.join(this.dir, 'probe.json'), JSON.stringify(obj)).catch(() => {});
    }, 500);
  }

  once(key, fn) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  abs(rel) {
    const a = resolveSrc(this.root, rel);
    if (!a) throw new Error(`path outside project: ${rel}`);
    return a;
  }

  async info(rel) {
    const abs = this.abs(rel);
    const st = await fsp.stat(abs);
    const key = crypto.createHash('sha1').update(`${rel}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
    const hit = this.probes.get(key);
    if (hit) return hit;
    return this.once(`probe:${key}`, () => this.fast(async () => {
      const info = { ...(await probe(abs)), key, mtime: st.mtimeMs };
      this.probes.set(key, info);
      this.persist();
      return info;
    }));
  }

  async list() {
    const files = [];
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'renders') continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < 4) await walk(path.join(dir, e.name), r, depth + 1); }
        else if (mediaKind(e.name) && !(depth === 0 && e.name.endsWith('.md'))) files.push(r);
      }
    };
    await walk(this.root, '', 0);
    const out = await Promise.all(files.map(async (rel) => {
      try {
        const info = await this.info(rel);
        const item = { path: rel, ...info };
        if (info.kind === 'video' && info.previewable === false) {
          const proxy = this.proxyRel(info);
          if (fs.existsSync(path.join(this.root, proxy))) item.proxy = proxy;
          else { item.proxyPending = true; this.makeProxy(rel, info); }
        }
        return item;
      } catch (e) {
        return { path: rel, kind: mediaKind(rel), error: e.message };
      }
    }));
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Still PNG of one source frame, saved into media/freeze/ (a normal project file). */
  async freeze(rel, t) {
    const info = await this.info(rel);
    if (info.kind !== 'video') throw new Error('freeze frame needs a video');
    const fr = info.fps || 30;
    t = Math.max(0, Math.min(Number(t) || 0, (info.duration || 0) - 1 / fr));
    const base = path.basename(rel, path.extname(rel)).replace(/[^\w.-]+/g, '-');
    const outRel = `media/freeze/${base}-${Math.round(t * 1000)}.png`;
    const out = path.join(this.root, outRel);
    if (fs.existsSync(out)) return outRel;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.part.png`;
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', t.toFixed(4), '-i', this.abs(rel), '-frames:v', '1', '-update', '1', tmp]);
    await fsp.rename(tmp, out);
    return outRel;
  }

  /**
   * Reversed copy of [in, in + span) in media/reversed/. Done in 2 s chunks so memory
   * stays flat (ffmpeg's reverse filter buffers every frame it reverses).
   */
  async reverse(rel, inT, span) {
    const info = await this.info(rel);
    if (info.kind !== 'video' && info.kind !== 'audio') throw new Error('reverse needs video or audio');
    inT = Math.max(0, Number(inT) || 0);
    span = Math.min(Number(span) || 0, (info.duration || Infinity) - inT);
    if (!(span > 0.01)) throw new Error('nothing to reverse');
    if (span > 600) throw new Error('reverse is limited to 10 minutes of source');
    const video = info.kind === 'video';
    const base = path.basename(rel, path.extname(rel)).replace(/[^\w.-]+/g, '-');
    const outRel = `media/reversed/${base}-${inT.toFixed(2)}-${span.toFixed(2)}.${video ? 'mp4' : 'm4a'}`;
    const out = path.join(this.root, outRel);
    if (fs.existsSync(out)) return outRel;
    return this.once(out, async () => {
      const label = `reverse ${path.basename(rel)}`;
      this.emit({ type: 'job', label, state: 'running' });
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kadr-rev-'));
      try {
        const CH = 2;
        const n = Math.ceil(span / CH - 1e-6);
        const parts = [];
        for (let i = 0; i < n; i++) {
          const s = inT + i * CH;
          const d = Math.min(CH, inT + span - s);
          const part = path.join(tmpDir, `p${i}.mkv`);
          const a = info.hasAudio || !video;
          await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', s.toFixed(4), '-t', d.toFixed(4), '-i', this.abs(rel),
            ...(video ? ['-vf', 'reverse', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p'] : ['-vn']),
            ...(a ? ['-af', 'areverse', '-c:a', 'pcm_s16le', '-ar', '48000'] : ['-an']), part], { nice: 8 });
          parts.unshift(part);
        }
        const list = path.join(tmpDir, 'list.txt');
        await fsp.writeFile(list, parts.map((p) => `file '${p}'`).join('\n'));
        await fsp.mkdir(path.dirname(out), { recursive: true });
        const tmp = `${out}.part${path.extname(out)}`;
        await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
          ...(video ? ['-c:v', 'copy'] : []), ...(info.hasAudio || !video ? ['-c:a', 'aac', '-b:a', '256k'] : []), '-movflags', '+faststart', tmp], { nice: 8 });
        await fsp.rename(tmp, out);
        this.emit({ type: 'job', label, state: 'done' });
        this.emit({ type: 'media' });
        return outRel;
      } catch (e) {
        this.emit({ type: 'job', label, state: 'error', error: e.message });
        throw e;
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      }
    });
  }

  /** Run a background media job with progress pills; `make(tmpDir)` writes the file. */
  async job(label, out, make) {
    if (fs.existsSync(out)) return;
    await this.once(out, async () => {
      this.emit({ type: 'job', label, state: 'running' });
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kadr-job-'));
      try {
        await fsp.mkdir(path.dirname(out), { recursive: true });
        await make(tmpDir);
        this.emit({ type: 'job', label, state: 'done' });
        this.emit({ type: 'media' });
      } catch (e) {
        this.emit({ type: 'job', label, state: 'error', error: e.message });
        throw e;
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      }
    });
  }

  /**
   * Steadied copy of [in, in + span) in media/stable/: libvidstab in two passes
   * (motion analysis, then smoothing with a slight zoom to hide the edges), or
   * ffmpeg's single-pass deshake where vidstab isn't built in.
   */
  async stabilize(rel, inT, span) {
    const info = await this.info(rel);
    if (info.kind !== 'video') throw new Error('stabilize needs a video');
    inT = Math.max(0, Number(inT) || 0);
    span = Math.min(Number(span) || 0, (info.duration || Infinity) - inT);
    if (!(span > 0.05)) throw new Error('nothing to stabilize');
    if (span > 1200) throw new Error('stabilize is limited to 20 minutes of source');
    const base = path.basename(rel, path.extname(rel)).replace(/[^\w.-]+/g, '-');
    const outRel = `media/stable/${base}-${inT.toFixed(2)}-${span.toFixed(2)}.mp4`;
    const out = path.join(this.root, outRel);
    await this.job(`stabilize ${path.basename(rel)}`, out, async (tmpDir) => {
      const cut = ['-ss', inT.toFixed(4), '-t', span.toFixed(4), '-i', this.abs(rel)];
      const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '256k'] : ['-an']), '-movflags', '+faststart'];
      const tmp = `${out}.part.mp4`;
      if (await hasFilter('vidstabdetect')) {
        // cwd = tmpDir keeps the motion file path free of ':' and '\' (filter syntax)
        await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...cut, '-an', '-vf', 'vidstabdetect=shakiness=6:accuracy=12:result=motion.trf', '-f', 'null', '-'], { nice: 8, cwd: tmpDir });
        await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...cut, '-vf', 'vidstabtransform=input=motion.trf:smoothing=24:optzoom=1:interpol=bicubic,unsharp=5:5:0.5:3:3:0.25', ...enc, tmp], { nice: 8, cwd: tmpDir });
      } else {
        await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...cut, '-vf', 'deshake=rx=48:ry=48:edge=mirror', ...enc, tmp], { nice: 8 });
      }
      await fsp.rename(tmp, out);
    });
    return outRel;
  }

  /** A copy with less background noise (low cut + adaptive FFT denoiser) in media/clean/. The picture is kept as it is. */
  async denoise(rel) {
    const info = await this.info(rel);
    if (!info.hasAudio) throw new Error('this file has no sound');
    const video = info.kind === 'video';
    const base = path.basename(rel, path.extname(rel)).replace(/[^\w.-]+/g, '-');
    const outRel = `media/clean/${base}.${video ? 'mp4' : 'm4a'}`;
    const out = path.join(this.root, outRel);
    await this.job(`reduce noise ${path.basename(rel)}`, out, async () => {
      const tmp = `${out}.part${path.extname(out)}`;
      const vcopy = video && ['h264', 'hevc', 'av1'].includes(info.vcodec);
      const v = !video ? ['-vn'] : vcopy ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p'];
      await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', this.abs(rel), ...v,
        '-af', 'highpass=f=70,afftdn=nr=14:nf=-35:tn=1', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', tmp], { nice: 8 });
      await fsp.rename(tmp, out);
    });
    return outRel;
  }

  proxyRel(info) { return `.kadr/proxies/${info.key}.mp4`; }

  makeProxy(rel, info) {
    const out = path.join(this.root, this.proxyRel(info));
    return this.once(out, () => this.bg(async () => {
      if (fs.existsSync(out)) return out;
      await fsp.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.part.mp4`;
      this.emit({ type: 'job', label: `proxy ${path.basename(rel)}`, state: 'running' });
      await run('ffmpeg', [
        '-hide_banner', '-v', 'error', '-y', '-i', this.abs(rel),
        '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '12',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp,
      ], { nice: 10 });
      await fsp.rename(tmp, out);
      this.emit({ type: 'job', label: `proxy ${path.basename(rel)}`, state: 'done' });
      this.emit({ type: 'media' });
      return out;
    })).catch((e) => this.emit({ type: 'job', label: `proxy ${path.basename(rel)}`, state: 'error', error: e.message }));
  }

  /** Horizontal filmstrip JPEG: stripSpec(duration).count thumbnails, 54px tall. */
  async strip(rel) {
    const info = await this.info(rel);
    if (info.kind !== 'video') throw new Error('not a video');
    const out = path.join(this.dir, `strip2-${info.key}.jpg`);
    if (fs.existsSync(out)) return out;
    return this.once(out, () => this.bg(async () => {
      const { count } = stripSpec(info.duration);
      const th = 54;
      const tw = Math.max(2, Math.round((th * (info.width || 16)) / (info.height || 9) / 2) * 2);
      const tmp = `${out}.part.jpg`;
      // Short clips: decode every frame (exact thumbnails). Long ones: keyframes
      // only, which is many times faster and close enough for a timeline.
      const fast = info.duration > 300 ? ['-skip_frame', 'nokey'] : [];
      await run('ffmpeg', [
        '-hide_banner', '-v', 'error', '-y', ...fast, '-i', this.abs(rel), '-an',
        '-vf', `fps=${count / (info.duration || 1)}:round=down,scale=${tw}:${th}:flags=fast_bilinear,tile=${count}x1`,
        '-frames:v', '1', '-q:v', '6', tmp,
      ], { nice: 10 });
      await fsp.rename(tmp, out);
      return out;
    }));
  }

  /** Waveform peaks: one byte (0..255) per 10 ms of audio. */
  async peaks(rel) {
    const info = await this.info(rel);
    if (!info.hasAudio) throw new Error('no audio');
    const out = path.join(this.dir, `peaks-${info.key}.bin`);
    if (fs.existsSync(out)) return out;
    return this.once(out, () => this.bg(async () => {
      const RATE = 8000;
      const BUCKET = RATE / 100;
      const peaks = [];
      let max = 0;
      let n = 0;
      let carry = null;
      await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', this.abs(rel), '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], {
        nice: 10,
        onStdout: (chunk) => {
          let buf = chunk;
          if (carry) { buf = Buffer.concat([carry, chunk]); carry = null; }
          const len = buf.length - (buf.length % 2);
          if (len < buf.length) carry = buf.subarray(len);
          for (let i = 0; i < len; i += 2) {
            const s = Math.abs(buf.readInt16LE(i));
            if (s > max) max = s;
            if (++n === BUCKET) { peaks.push(Math.min(255, Math.round((max / 32768) * 255))); max = 0; n = 0; }
          }
        },
      });
      if (n) peaks.push(Math.min(255, Math.round((max / 32768) * 255)));
      const tmp = `${out}.part`;
      await fsp.writeFile(tmp, Buffer.from(peaks));
      await fsp.rename(tmp, out);
      return out;
    }));
  }
}
