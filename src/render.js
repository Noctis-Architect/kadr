// Export pipeline.
//  1. Every html clip is rendered frame-by-frame in headless Chromium
//     (transparent PNGs -> lossless FFV1/BGRA), cached by content hash.
//     Optional motion blur: N sub-frames per frame over a 180° shutter,
//     blended in premultiplied alpha.
//  2. One ffmpeg filter graph composites every clip over the background
//     (speed, color, scale/position/opacity, fades), in BT.709, and mixes audio.
//  3. Optional two-pass EBU R128 loudness normalization.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  normalizeProject, validateProject, projectDuration, placement, fadeAt, transitions, clipWindow, valueAt, isAnimated, maxScale, resolveAt,
  transitionOffset, transitionOffsetExpr, colorMatrix, vignetteMap, maskMap, maskOf, keyOf, spillType, panGains, maxBlur, audibleTrack, BLENDS,
} from '../shared/model.js';
import { Browser } from './chrome.js';
import { resolveSrc, compUrl, BUILTIN_DIR } from './project.js';
import { run } from './media.js';

const f4 = (n) => Number(n).toFixed(4);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
/** A PAM image (RGBA), which ffmpeg reads as a still: vignette and mask maps. */
const pam = (w, h, rgba) => Buffer.concat([Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), rgba]);

// Blend modes as ffmpeg filters, checked against the CSS formulas:
// [clip is the first input, filter]; otherwise the frame under the clip is first.
// Soft light has no built-in match, so it is the W3C formula as a 2-input lookup
// table (x = frame under, y = clip), computed once instead of per pixel.
const SL = "'if(lte(y,127.5),x-(255-2*y)*x*(255-x)/65025,x+(2*y-255)*(if(lte(x,63.75),((16*x/255-12)*x/255+4)*x,sqrt(x/255)*255)-x)/255)'";
const BLEND_FF = {
  multiply: [false, 'blend=all_mode=multiply'], screen: [false, 'blend=all_mode=screen'], overlay: [false, 'blend=all_mode=overlay'],
  softLight: [false, `lut2=c0=${SL}:c1=${SL}:c2=${SL}`], hardLight: [false, 'blend=all_mode=hardlight'], darken: [false, 'blend=all_mode=darken'],
  lighten: [false, 'blend=all_mode=lighten'], colorDodge: [true, 'blend=all_mode=dodge'], colorBurn: [true, 'blend=all_mode=burn'],
  difference: [false, 'blend=all_mode=difference'], exclusion: [false, 'blend=all_mode=exclusion'],
};

async function dirSignature(dir) {
  const parts = [];
  const walk = async (d, depth) => {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) await walk(p, depth + 1); continue; }
      try { const st = await fsp.stat(p); parts.push(`${p}:${st.size}:${st.mtimeMs}`); } catch { /* raced */ }
    }
  };
  await walk(dir, 0);
  return parts.sort().join('|');
}

function waitExit(proc, name) {
  return new Promise((resolve, reject) => {
    let err = '';
    proc.stderr?.on('data', (d) => { err = (err + d).slice(-4000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}: ${err.trim()}`))));
  });
}

export function defaultWorkers() {
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 3)));
}

/** Render one html composition range. Returns a .mkv (FFV1 BGRA) or, for one frame, a .png. */
export async function renderComp(ctx, { src, props, t0, frames, step, still }) {
  const { root, baseUrl, W, H, fps, cacheDir, getBrowser, signal, noCache, tick, workers, logs, motionBlur, shutter } = ctx;
  const file = resolveSrc(root, src);
  if (!file) throw new Error(`bad composition path: ${src}`);
  const S = still ? 1 : Math.max(1, motionBlur | 0);
  const html = await fsp.readFile(file);
  const sig = await dirSignature(src.startsWith('@kadr/') ? BUILTIN_DIR : path.dirname(file));
  const key = crypto.createHash('sha1')
    .update(['v2', html, JSON.stringify(props || {}), W, H, fps, f4(t0), frames, f4(step), still ? 1 : 0, S, shutter, sig].join('|'))
    .digest('hex').slice(0, 20);
  const out = path.join(cacheDir, `comp-${key}.${still ? 'png' : 'mkv'}`);
  if (!noCache && fs.existsSync(out)) { tick(frames); return out; }

  const browser = await getBrowser();
  const url = compUrl(baseUrl, src, props, { 'kadr-render': 1 });
  const n = still ? 1 : frames;
  const count = still ? 1 : Math.max(1, Math.min(workers, Math.ceil((n * S) / 45)));
  const chunk = Math.ceil(n / count);
  const blur = S > 1
    ? ['-vf', `format=rgba,premultiply=inplace=1,tmix=frames=${S},unpremultiply=inplace=1,select='eq(mod(n,${S}),${S - 1})',setpts=N/(${fps}*TB)`, '-r', String(fps)]
    : [];

  const parts = await Promise.all(Array.from({ length: count }, async (_, w) => {
    const a = w * chunk;
    const b = Math.min(n, a + chunk);
    if (a >= b) return null;
    const page = await browser.newPage(W, H);
    try {
      await page.goto(url);
      if (still) {
        await page.seek(Math.max(0, t0));
        const tmp = `${out}.part.png`;
        await fsp.writeFile(tmp, await page.screenshot());
        tick(1);
        return tmp;
      }
      const part = `${out}.part${w}.mkv`;
      const ff = spawn('ffmpeg', [
        '-hide_banner', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps * S), '-c:v', 'png', '-i', '-',
        ...blur, '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgra', part,
      ], { stdio: ['pipe', 'ignore', 'pipe'] });
      const done = waitExit(ff, 'ffmpeg (composition encode)');
      for (let i = a; i < b; i++) {
        for (let k = 0; k < S; k++) {
          if (signal?.aborted) { ff.kill('SIGKILL'); throw new Error('cancelled'); }
          await page.seek(Math.max(0, t0 + (i + (S > 1 ? (k / S) * shutter : 0)) * step));
          const png = await page.screenshot();
          if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
        }
        tick(1);
      }
      ff.stdin.end();
      await done;
      return part;
    } finally {
      for (const l of page.logs) logs.add(`${src}: ${l}`);
      await page.close();
    }
  }));

  const got = parts.filter(Boolean);
  if (got.length === 1) {
    await fsp.rename(got[0], out);
  } else {
    const list = `${out}.list.txt`;
    await fsp.writeFile(list, got.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
    await Promise.all([list, ...got].map((p) => fsp.rm(p, { force: true })));
  }
  return out;
}

/** Audio-only exports: the mix alone, by file extension. */
const AUDIO_EXT = ['.wav', '.mp3', '.m4a', '.flac'];
const AUDIO_ARGS = {
  '.wav': ['-c:a', 'pcm_s24le'],
  '.mp3': ['-c:a', 'libmp3lame', '-b:a', '320k'],
  '.m4a': ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
  '.flac': ['-c:a', 'flac'],
};

export const CODECS = {
  h264: { ext: ['.mp4', '.mov', '.m4v'], pix: 'yuv420p' },
  h265: { ext: ['.mp4', '.mov'], pix: 'yuv420p' },
  prores: { ext: ['.mov'], pix: 'yuv422p10le' },
  av1: { ext: ['.mp4', '.webm', '.mkv'], pix: 'yuv420p' },
  vp9: { ext: ['.webm'], pix: 'yuv420p' },
};

function pickCodec(out, codec) {
  if (codec && CODECS[codec]) return codec;
  const ext = path.extname(out).toLowerCase();
  if (ext === '.webm') return 'vp9';
  return 'h264';
}

function codecArgs(codec, { crf, preset, fps, audioBitrate }) {
  const gop = String(Math.max(1, Math.round(fps * 2)));
  const ab = `${audioBitrate || 320}k`;
  const tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
  switch (codec) {
    case 'h265':
      return ['-c:v', 'libx265', '-preset', preset, '-crf', String(crf + 4), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', '-g', gop, ...tags, '-c:a', 'aac', '-b:a', ab, '-movflags', '+faststart'];
    case 'prores':
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', ...tags, '-c:a', 'pcm_s24le'];
    case 'av1':
      return ['-c:v', 'libsvtav1', '-preset', preset === 'veryfast' ? '10' : preset === 'slow' ? '4' : '6', '-crf', String(Math.round(crf + 12)), '-pix_fmt', 'yuv420p', '-g', gop, ...tags, '-c:a', 'libopus', '-b:a', '192k'];
    case 'vp9':
      return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(Math.round(crf + 13)), '-row-mt', '1', '-deadline', 'good',
        '-cpu-used', preset === 'veryfast' ? '5' : '2', '-pix_fmt', 'yuv420p', '-g', gop, ...tags, '-c:a', 'libopus', '-b:a', '192k'];
    default:
      return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', gop, '-bf', '2', ...tags,
        '-c:a', 'aac', '-b:a', ab, '-movflags', '+faststart'];
  }
}

/** atempo only takes 0.5..2 per instance: chain them. */
function atempo(speed) {
  const parts = [];
  let s = speed;
  while (s > 2 + 1e-9) { parts.push(2); s /= 2; }
  while (s < 0.5 - 1e-9) { parts.push(0.5); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) parts.push(s);
  return parts.map((x) => `atempo=${x.toFixed(6)}`);
}

/**
 * RGB filters matching the CSS preview: brightness() contrast() saturate() + opacity.
 * Expects rgba input. `name` gives the alpha mixer an instance name so sendcmd can animate it.
 */
function colorFilters(c, alpha, name) {
  const b = c.brightness ?? 1;
  const k = c.contrast ?? 1;
  const s = c.saturation ?? 1;
  const out = [];
  if (b !== 1 || k !== 1) {
    const e = `clip((val*${b.toFixed(4)}-127.5)*${k.toFixed(4)}+127.5,0,255)`;
    out.push(`lutrgb=r='${e}':g='${e}':b='${e}'`);
  }
  if (s !== 1 || alpha < 0.999 || name) {
    const m = s === 1 ? 'rr=1:rg=0:rb=0:gr=0:gg=1:gb=0:br=0:bg=0:bb=1' : [
      `rr=${(0.213 + 0.787 * s).toFixed(5)}`, `rg=${(0.715 - 0.715 * s).toFixed(5)}`, `rb=${(0.072 - 0.072 * s).toFixed(5)}`,
      `gr=${(0.213 - 0.213 * s).toFixed(5)}`, `gg=${(0.715 + 0.285 * s).toFixed(5)}`, `gb=${(0.072 - 0.072 * s).toFixed(5)}`,
      `br=${(0.213 - 0.213 * s).toFixed(5)}`, `bg=${(0.715 - 0.715 * s).toFixed(5)}`, `bb=${(0.072 + 0.928 * s).toFixed(5)}`,
    ].join(':');
    out.push(`colorchannelmixer${name ? `@${name}` : ''}=${m}:aa=${alpha.toFixed(4)}`);
  }
  return out;
}

// ---------- keyframes as ffmpeg expressions (same curves as shared/model.js ease()) ----------
const EASE_EXPR = {
  linear: (p) => p,
  in: (p) => `pow(${p},3)`,
  out: (p) => `(1-pow(1-${p},3))`,
  hold: () => '0',
  ease: (p) => `if(lt(${p},0.5),4*pow(${p},3),1-pow(2-2*${p},3)/2)`,
};
const sub = (expr, v) => (v >= 0 ? `(${expr}-${f4(v)})` : `(${expr}+${f4(-v)})`);
/** Expression for keyframed property k, where U is an expression for clip-local seconds. */
function keyExpr(c, k, U, map = (v) => v) {
  const ks = c.keys[k];
  let e = f4(map(ks[ks.length - 1][1]));
  for (let i = ks.length - 2; i >= 0; i--) {
    const [t0, v0, ez] = ks[i];
    const [t1, v1] = ks[i + 1];
    const a = map(v0);
    const b = map(v1);
    const span = t1 - t0;
    const seg = span > 1e-6 ? `(${f4(a)}+(${f4(b - a)})*${EASE_EXPR[ez || 'ease'](`(${sub(U, t0)}/${f4(span)})`)})` : f4(b);
    e = `if(lt(${U},${f4(t1)}),${seg},${e})`;
  }
  return `if(lt(${U},${f4(ks[0][0])}),${f4(map(ks[0][1]))},${e})`;
}

/**
 * Render the timeline (or a range of it) to a file.
 * still: true renders one frame at `from` to a PNG.
 * Options: crf, preset, codec (h264|h265|prores|av1|vp9), width/height (output size),
 * loudness (target LUFS, e.g. -14), motionBlur (sub-frames: 0, 4, 8, 16), shutter (degrees).
 */
export async function renderProject(o) {
  const { root, baseUrl, media, out, still = false, signal, onProgress = () => {} } = o;
  const crf = o.crf ?? 18;
  const preset = o.preset ?? 'medium';
  const { errors } = validateProject(o.project);
  if (errors.length) throw new Error(`project.json has errors:\n- ${errors.join('\n- ')}`);
  const p = normalizeProject(o.project);
  const W = p.width;
  const H = p.height;
  const fps = p.fps;
  const total = projectDuration(p);
  const from = Math.max(0, Math.round((o.from ?? 0) * fps) / fps);
  const to = still ? from + 1 / fps : Math.min(o.to ?? total, total);
  if (!still && !(to - from > 1e-6)) throw new Error('nothing to render: the timeline is empty');
  const D = to - from;
  const OW = o.width ? even(o.width) : W;
  const OH = o.height ? even(o.height) : H;
  const outExt = path.extname(out).toLowerCase();
  const gif = !still && outExt === '.gif';
  const audioOnly = !still && AUDIO_EXT.includes(outExt);
  const codec = still ? null : gif ? 'gif' : audioOnly ? outExt.slice(1) : pickCodec(out, o.codec);
  const cacheDir = path.join(root, '.kadr', 'cache');
  await fsp.mkdir(cacheDir, { recursive: true });

  const tracks = new Map(p.tracks.map((t, i) => [t.id, { ...t, i }]));
  const trs = transitions(p);
  const items = p.clips
    .filter((c) => !c.disabled && tracks.has(c.track))
    .map((c) => {
      const tr = trs.get(c.id);
      const w = clipWindow(c, tr);
      return { c, tr, tracks: tracks.get(c.track), s: Math.max(w.s, from), e: Math.min(w.e, to) };
    })
    .filter((x) => x.e - x.s > 1e-6 && (!still || from < x.e))
    .sort((a, b) => a.tracks.i - b.tracks.i || a.c.start - b.c.start);
  let tmp0 = null;
  const tmpDir = async () => (tmp0 ??= await fsp.mkdtemp(path.join(os.tmpdir(), 'kadr-r-')));

  // --- progress model ------------------------------------------------------
  const logs = new Set();
  const comps = audioOnly ? [] : items.filter((x) => x.c.type === 'html' && !x.tracks.hidden);
  const compFrames = comps.reduce((n, x) => n + (still ? 1 : Math.max(1, Math.round((x.e - x.s) * fps))), 0);
  const wComp = compFrames ? (o.motionBlur > 1 ? 0.7 : 0.5) : 0;
  const wLoud = o.loudness && !still ? 0.05 : 0;
  const wEnc = 1 - wComp - wLoud;
  let doneFrames = 0;

  // --- 1. compositions ------------------------------------------------------
  let browser = null;
  let browserP = null;
  const ctx = {
    root, baseUrl, W, H, fps, cacheDir, signal, logs,
    noCache: !!o.noCache,
    workers: o.workers ?? defaultWorkers(),
    motionBlur: o.motionBlur || 0,
    shutter: (o.shutter ?? 180) / 360,
    getBrowser: () => (browserP ??= Browser.launch().then((b) => (browser = b))),
    tick: (k) => {
      doneFrames += k;
      onProgress({ phase: 'compositions', progress: wComp * (doneFrames / compFrames), detail: `${doneFrames}/${compFrames} frames` });
    },
  };
  const compOut = new Map();
  try {
    for (const x of comps) {
      const sp = x.c.speed || 1;
      const t0 = x.c.in + (x.s - x.c.start) * sp;
      const frames = Math.max(1, Math.round((x.e - x.s) * fps));
      compOut.set(x, await renderComp(ctx, { src: x.c.src, props: x.c.props, t0, frames, step: sp / fps, still }));
    }
  } finally {
    if (browserP) { await browserP.catch(() => {}); await browser?.close(); }
  }

  // --- 2. graph ---------------------------------------------------------------
  // Every clip chain is moved to output time first, so keyframe expressions,
  // sendcmd (animated opacity) and overlay all read the same clock `t`.
  const inputs = [];
  const vf = [`color=c=${p.background}:s=${W}x${H}:r=${fps}:d=${f4(D)},format=rgba,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[base]`];
  const af = [];
  const audio = [];
  let vlast = 'base';
  for (const x of items) {
    const { c, tr, tracks: tr0, s, e } = x;
    const sp = c.speed || 1;
    const len = e - s;
    const cut = s - c.start; // clip-local second where the window starts (< 0 inside a dissolve head)
    const off = s - from; // where the window lands in the output
    const T0 = c.start - from; // output time of the clip's own start
    const wantV = !audioOnly && c.type !== 'audio' && !tr0.hidden;
    let wantA = !still && !gif && audibleTrack(p, tr0) && (c.volume > 0 || isAnimated(c, 'volume')) && (c.type === 'audio' || c.type === 'video');
    if (!wantV && !wantA) continue;
    let info = null;
    if (c.type === 'video' || c.type === 'audio' || c.type === 'image') info = await media.info(c.src);
    if (c.type === 'video' && !info.hasAudio) wantA = false;
    if (!wantV && !wantA) continue;

    const k = inputs.length;
    const file = c.type === 'html' ? compOut.get(x) : resolveSrc(root, c.src);
    let headPad = 0; // timeline seconds before the media's first frame (dissolve handle)
    let tailPad = 0; // timeline seconds after its last frame
    let holdLast = false; // the window is past the media's end: show its last frame
    if (c.type === 'video' || c.type === 'audio') {
      const srcStart = c.in + cut * sp;
      headPad = srcStart < 0 ? -srcStart / sp : 0;
      let ss = Math.max(0, srcStart);
      let want = Math.max(1 / fps, (len - headPad) * sp);
      if (c.type === 'video' && info.duration && ss > info.duration - 1 / fps) {
        // The whole window is past the media's end (a dissolve or push tail):
        // read the last moments, keep only the final frame and hold it.
        ss = Math.max(0, info.duration - 0.3);
        want = Math.min(0.3, info.duration);
        holdLast = true;
        tailPad = Math.max(0, len - headPad - 1 / fps);
      } else {
        const avail = info.duration ? Math.max(0, info.duration - ss) : want;
        tailPad = want > avail + 1e-3 ? (want - avail) / sp : 0;
      }
      inputs.push(['-ss', f4(ss), '-t', f4(want), '-i', file]);
    } else if (c.type === 'image' || (c.type === 'html' && still)) inputs.push(['-loop', '1', '-framerate', String(fps), '-t', f4(len), '-i', file]);
    else inputs.push(['-i', file]);

    if (wantV) {
      const html = c.type === 'html';
      const mw = html ? W : info.width;
      const mh = html ? H : info.height;
      const rc = still ? resolveAt(c, from) : c;
      const base = placement({ ...c, x: 0, y: 0, scale: 1 }, mw, mh, W, H);
      const animS = !still && isAnimated(c, 'scale');
      const animR = !still && isAnimated(c, 'rotation');
      const animB = !still && isAnimated(c, 'blur');
      const rot = animR || Math.abs(rc.rotation || 0) > 1e-6;
      const U = sub('t', T0);
      // blur spreads past the clip's box (CSS blurs into transparency around it): pad for it
      const blurTop = still ? (rc.blur || 0) : maxBlur(c);
      const P = blurTop > 0.05 ? Math.ceil(blurTop * 3) + 2 : 0;
      const cropOn = !!(c.cropT || c.cropR || c.cropB || c.cropL);
      const mask = maskOf(c);
      const key = keyOf(c);
      const mode = c.blend && c.blend !== 'normal' && BLENDS.includes(c.blend) ? c.blend : null;
      // The chain is built in segments so still images (vignette, mask) can join it.
      let lab = `${k}:v`;
      let ch = [];
      let seg = 0;
      const flush = () => {
        const next = `v${k}s${seg++}`;
        vf.push(`[${lab}]${ch.length ? ch.join(',') : 'null'}[${next}]`);
        lab = next;
        ch = [];
      };
      // multiply the clip by a still map (rgb by its rgb, alpha by its alpha), held over the clip window
      const multiplyMap = async (name, w, h, rgba) => {
        const file = path.join(await tmpDir(), `${name}${k}.pam`);
        await fsp.writeFile(file, pam(w, h, rgba));
        const km = inputs.length;
        inputs.push(['-loop', '1', '-framerate', String(fps), '-t', f4(len + 1), '-i', file]);
        flush();
        const next = `v${k}s${seg++}`;
        vf.push(`[${km}:v]format=gbrap,setpts=PTS-STARTPTS+${f4(off)}/TB[${name}${k}]`);
        vf.push(`[${lab}]format=gbrap[${next}i];[${next}i][${name}${k}]blend=all_mode=multiply:shortest=1[${next}]`);
        lab = next;
      };
      if (c.type === 'video') {
        if (holdLast) ch.push('reverse', 'trim=end_frame=1');
        ch.push(sp !== 1 ? `setpts=(PTS-STARTPTS)/${sp.toFixed(6)}` : 'setpts=PTS-STARTPTS', `fps=${fps}`);
        if (headPad > 1e-4 || tailPad > 1e-4) ch.push(`tpad=start_mode=clone:start_duration=${f4(headPad)}:stop_mode=clone:stop_duration=${f4(tailPad + 2 / fps)}`);
      } else ch.push('setpts=PTS-STARTPTS');
      ch.push(`setpts=PTS+${f4(off)}/TB`, 'format=rgba');
      // chroma key: ffmpeg's colorkey + despill (the preview runs the same math in WebGL)
      if (key && !html) {
        const kf = [`colorkey=color=0x${key.color.slice(1)}:similarity=${Math.max(1e-5, key.similarity).toFixed(4)}:blend=${key.smooth.toFixed(4)}`];
        const st = spillType(key.color);
        if (st && key.spill > 0) kf.push(`despill=type=${st}:mix=0.5:expand=0:red=0:green=${st === 'green' ? -key.spill : 0}:blue=${st === 'blue' ? -key.spill : 0}:brightness=0`);
        if (c.type === 'video') ch.push(...kf);
        else {
          // images may be transparent already: keep that (key alpha x source alpha)
          flush();
          const next = `v${k}s${seg++}`;
          vf.push(`[${lab}]split[${next}a][${next}b];[${next}a]${kf.join(',')},format=gbrap[${next}k];[${next}b]lutrgb=r=255:g=255:b=255,format=gbrap[${next}w];[${next}k][${next}w]blend=all_mode=multiply[${next}]`);
          lab = next;
        }
      }
      // crop keeps the frame size: cut-away parts become transparent (like the CSS inset).
      // With blur it happens after the blur instead (CSS: filter first, then clip-path).
      if (cropOn && !P) {
        const cx = Math.round((mw * (c.cropL || 0)) / 100);
        const cy = Math.round((mh * (c.cropT || 0)) / 100);
        const cw = Math.max(1, Math.round(mw * (1 - ((c.cropL || 0) + (c.cropR || 0)) / 100)));
        const chh = Math.max(1, Math.round(mh * (1 - ((c.cropT || 0) + (c.cropB || 0)) / 100)));
        ch.push(`crop=${cw}:${chh}:${cx}:${cy}`, `pad=${mw}:${mh}:${cx}:${cy}:color=black@0`);
      }
      if (c.flipH) ch.push('hflip');
      if (c.flipV) ch.push('vflip');
      // opacity: static, or sampled per frame (keys, fades, dissolve) and sent with sendcmd
      const varying = !still && (isAnimated(c, 'opacity') || c.fadeIn > 0 || c.fadeOut > 0 || tr?.xin > 0);
      if (varying) {
        const name = `a${k}`;
        const n = Math.max(1, Math.round(len * fps));
        const cmds = [];
        let last = -1;
        for (let i = 0; i <= n; i++) {
          const tt = s + i / fps;
          const a = Math.max(0, Math.min(1, valueAt(c, 'opacity', tt) * fadeAt(c, tt, tr)));
          if (Math.abs(a - last) > 0.0015 || i === 0) { cmds.push(`${f4(off + i / fps - (i === 0 ? 1 : 0.0005))} colorchannelmixer@${name} aa ${a.toFixed(4)};`); last = a; }
        }
        const cmdFile = path.join(await tmpDir(), `alpha${k}.cmd`);
        await fsp.writeFile(cmdFile, cmds.join('\n'));
        ch.push(`sendcmd=f=${cmdFile}`, ...colorFilters(c, valueAt(c, 'opacity', s) * fadeAt(c, s, tr), name));
      } else {
        ch.push(...colorFilters(c, rc.opacity * (still ? fadeAt(c, from, tr) : 1)));
      }
      // grade: white balance / hue / sepia matrix, then gamma, then the vignette
      const M = colorMatrix(c);
      if (M) {
        const n = ['r', 'g', 'b'];
        ch.push(`colorchannelmixer=${M.flatMap((row, i) => row.map((v, j) => `${n[i]}${n[j]}=${v.toFixed(5)}`)).join(':')}`);
      }
      if ((c.gamma ?? 1) !== 1) {
        const e = `clip(255*pow(val/255,${(1 / c.gamma).toFixed(5)})+0.5,0,255)`;
        ch.push(`lutrgb=r='${e}':g='${e}':b='${e}'`);
      }
      if ((c.vignette || 0) > 0) {
        const v = vignetteMap(mw, mh, c.vignette);
        const rgba = Buffer.alloc(mw * mh * 4, 255);
        for (let i = 0; i < v.length; i++) { rgba[i * 4] = v[i]; rgba[i * 4 + 1] = v[i]; rgba[i * 4 + 2] = v[i]; }
        await multiplyMap('vg', mw, mh, rgba);
      }
      // blur (premultiplied, into transparent padding), then crop and mask, on a box of bw x bh.
      // Returns the frame size after it.
      const blurCropMask = async (bw, bh) => {
        if (P) {
          ch.push(`pad=${bw + 2 * P}:${bh + 2 * P}:${P}:${P}:color=black@0`, 'premultiply=inplace=1');
          if (animB) {
            const n = Math.max(1, Math.round(len * fps));
            const cmds = [];
            let last = -1;
            for (let i = 0; i <= n; i++) {
              const v = Math.max(0.01, valueAt(c, 'blur', s + i / fps));
              if (Math.abs(v - last) > 0.02 || i === 0) { cmds.push(`${f4(off + i / fps - (i === 0 ? 1 : 0.0005))} gblur@b${k} sigma ${v.toFixed(3)};`); last = v; }
            }
            const cmdFile = path.join(await tmpDir(), `blur${k}.cmd`);
            await fsp.writeFile(cmdFile, cmds.join('\n'));
            ch.push(`sendcmd=f=${cmdFile}`, `gblur@b${k}=sigma=${Math.max(0.01, valueAt(c, 'blur', s)).toFixed(3)}:steps=3`);
          } else ch.push(`gblur=sigma=${Math.max(0.01, rc.blur || 0).toFixed(3)}:steps=3`);
          ch.push('unpremultiply=inplace=1');
          if (cropOn) {
            const cx = P + Math.round((bw * (c.cropL || 0)) / 100);
            const cy = P + Math.round((bh * (c.cropT || 0)) / 100);
            const cw = Math.max(1, Math.round(bw * (1 - ((c.cropL || 0) + (c.cropR || 0)) / 100)));
            const chh = Math.max(1, Math.round(bh * (1 - ((c.cropT || 0) + (c.cropB || 0)) / 100)));
            ch.push(`crop=${cw}:${chh}:${cx}:${cy}`, `pad=${bw + 2 * P}:${bh + 2 * P}:${cx}:${cy}:color=black@0`);
          }
        }
        if (mask) {
          const m = maskMap(bw, bh, mask, P);
          const rgba = Buffer.alloc(m.length * 4, 255);
          for (let i = 0; i < m.length; i++) rgba[i * 4 + 3] = m[i];
          await multiplyMap('mk', bw + 2 * P, bh + 2 * P, rgba);
        }
        return [bw + 2 * P, bh + 2 * P];
      };
      // A composition is blurred / masked at its own size (the CSS transform scales the
      // result); footage at its size on the canvas (the preview sizes the element itself).
      let fw = mw;
      let fh = mh;
      if (html && (P || mask)) [fw, fh] = await blurCropMask(mw, mh);
      const cm = 'out_color_matrix=bt709:out_range=tv';
      const after = !html && (P || mask);
      const smax = animS ? maxScale(c) : rc.scale;
      const BW = even(fw * (base.w / mw) * smax);
      const BH = even(fh * (base.h / mh) * smax);
      if (!animS && !rot && !after && !mode) {
        ch.push(`scale=${BW}:${BH}:flags=lanczos:${cm}`);
      } else {
        ch.push(`scale=${BW}:${BH}:flags=lanczos`);
        let [rw, rh] = [BW, BH];
        if (after) [rw, rh] = await blurCropMask(BW, BH);
        if (rot) {
          let ow;
          let oh;
          if (animR) { ow = even(Math.hypot(rw, rh)); oh = ow; } else {
            const r = (rc.rotation * Math.PI) / 180;
            ow = even(Math.abs(rw * Math.cos(r)) + Math.abs(rh * Math.sin(r)));
            oh = even(Math.abs(rw * Math.sin(r)) + Math.abs(rh * Math.cos(r)));
          }
          const a = animR ? keyExpr(c, 'rotation', U, (v) => (v * Math.PI) / 180) : f4((rc.rotation * Math.PI) / 180);
          ch.push(`rotate=a='${a}':ow=${ow}:oh=${oh}:c=black@0`);
        }
        if (animS) {
          const f = `(${keyExpr(c, 'scale', U)})/${f4(smax)}`;
          ch.push(`scale=w='max(2,2*trunc(iw*${f}/2))':h='max(2,2*trunc(ih*${f}/2))':eval=frame:flags=lanczos:${cm}`);
        } else if (!mode) ch.push(`scale=${cm}`);
      }
      // blended clips stay RGB: they are mixed with the frame in RGB below
      ch.push(mode ? 'format=rgba' : 'format=yuva420p');
      vf.push(`[${lab}]${ch.join(',')}[v${k}]`);
      let px = isAnimated(c, 'x') && !still ? keyExpr(c, 'x', U) : f4(rc.x || 0);
      let py = isAnimated(c, 'y') && !still ? keyExpr(c, 'y', U) : f4(rc.y || 0);
      // push transitions slide the clip in / out: the same curve as the preview
      if (still) {
        const o = transitionOffset(c, from, tr, W, H);
        if (o.dx || o.dy) { px = `(${px})+${f4(o.dx)}`; py = `(${py})+${f4(o.dy)}`; }
      } else {
        const o = transitionOffsetExpr(c, tr, W, H, T0);
        if (o.x !== '0') px = `(${px})+${o.x}`;
        if (o.y !== '0') py = `(${py})+${o.y}`;
      }
      const pos = `x='(main_w-overlay_w)/2+${px}':y='(main_h-overlay_h)/2+${py}'`;
      const enable = `enable='between(t,${f4(off)},${f4(off + len)})'`;
      if (!mode) {
        vf.push(`[${vlast}][v${k}]overlay=${pos}:eof_action=pass:${enable}[o${k}]`);
      } else {
        // Blend modes (CSS mix-blend-mode math): put the clip on a transparent full
        // frame, mix it with everything under it in RGB, and lay the result over the
        // frame through the clip's own alpha: base*(1-a) + mix(base, clip)*a.
        // Only the clip's own time window goes through the mix.
        const toRgb = 'scale=in_color_matrix=bt709:in_range=tv,format=gbrp';
        vf.push(`color=c=black@0:s=${W}x${H}:r=${fps}:d=${f4(len)},format=rgba,setpts=PTS+${f4(off)}/TB[t${k}]`);
        vf.push(`[t${k}][v${k}]overlay=${pos}:eof_action=pass:format=rgb[l${k}]`);
        vf.push(`[${vlast}]split[b${k}][bb${k}]`);
        vf.push(`[b${k}]trim=start=${f4(off)}:end=${f4(off + len)},${toRgb}[bg${k}]`);
        if (mode === 'add') {
          // plus-lighter: base + premultiplied clip, clamped (opaque over the window)
          vf.push(`[l${k}]premultiply=inplace=1,format=gbrp[lp${k}]`);
          vf.push(`[bg${k}][lp${k}]blend=all_mode=addition,scale=${cm},format=yuva420p[bla${k}]`);
        } else {
          const [layerOnTop, how] = BLEND_FF[mode];
          vf.push(`[l${k}]split[l${k}a][l${k}b]`);
          vf.push(`[l${k}a]format=gbrp[lg${k}]`);
          vf.push(`[l${k}b]alphaextract[la${k}]`);
          vf.push(`${layerOnTop ? `[lg${k}][bg${k}]` : `[bg${k}][lg${k}]`}${how}[bl${k}]`);
          vf.push(`[bl${k}][la${k}]alphamerge,scale=${cm},format=yuva420p[bla${k}]`);
        }
        vf.push(`[bb${k}][bla${k}]overlay=0:0:eof_action=pass:${enable}[o${k}]`);
      }
      vlast = `o${k}`;
    }
    if (wantA) {
      const cutA = cut + headPad; // clip-local second where the audio starts
      const Ua = cutA >= 0 ? `(t+${f4(cutA)})` : `(t-${f4(-cutA)})`;
      const ch = ['asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...atempo(sp), 'asetpts=PTS-STARTPTS'];
      if (c.pan) {
        // equal-power balance, the same as the preview's StereoPannerNode
        const g = panGains(c.pan);
        ch.push(`pan=stereo|c0=${g.ll.toFixed(5)}*c0+${g.lr.toFixed(5)}*c1|c1=${g.rl.toFixed(5)}*c0+${g.rr.toFixed(5)}*c1`);
      }
      const varying = isAnimated(c, 'volume') || c.fadeIn > 0 || c.fadeOut > 0 || tr?.xin > 0 || tr?.xout > 0;
      if (varying) {
        const g = [isAnimated(c, 'volume') ? `(${keyExpr(c, 'volume', Ua)})` : f4(c.volume)];
        if (c.fadeIn > 0) g.push(`clip(${Ua}/${f4(c.fadeIn)},0,1)`);
        if (c.fadeOut > 0) g.push(`clip((${f4(c.duration)}-${Ua})/${f4(c.fadeOut)},0,1)`);
        if (tr?.xin > 0) g.push(`clip((${Ua}+${f4(tr.xin / 2)})/${f4(tr.xin)},0,1)`);
        if (tr?.xout > 0) g.push(`clip((${f4(c.duration + tr.xout / 2)}-${Ua})/${f4(tr.xout)},0,1)`);
        ch.push('asetnsamples=n=256:p=0', `volume='${g.join('*')}':eval=frame`);
      } else if (c.volume !== 1) ch.push(`volume=${c.volume.toFixed(4)}`);
      const ms = Math.round((off + headPad) * 1000);
      if (ms > 0) ch.push(`adelay=${ms}:all=1`);
      af.push(`[${k}:a]${ch.join(',')}[a${k}]`);
      audio.push(`[a${k}]`);
    }
  }
  const mix = [
    `anullsrc=r=48000:cl=stereo,atrim=0:${f4(D)}[abase]`,
    audio.length ? `[abase]${audio.join('')}amix=inputs=${audio.length + 1}:duration=first:dropout_transition=0:normalize=0[amix]` : '[abase]anull[amix]',
  ];
  const inputArgs = inputs.flat();

  // --- 3. loudness (pass 1: measure the mix) ----------------------------------
  let loud = null;
  if (!still && o.loudness && audio.length) {
    onProgress({ phase: 'loudness', progress: wComp, detail: `measuring (${o.loudness} LUFS target)` });
    const target = `I=${o.loudness}:TP=-1:LRA=11`;
    const r = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', ...inputArgs, '-filter_complex',
      [...af, ...mix, `[amix]loudnorm=${target}:print_format=json[aout]`].join(';'), '-map', '[aout]', '-f', 'null', '-'],
    { stderr: true, nice: o.nice ?? 5, signal });
    const m = r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      if (Number.isFinite(Number(j.input_i)) && Number(j.input_i) > -70) {
        loud = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=none,aresample=48000`;
      }
    }
  }

  // --- 4. encode ----------------------------------------------------------------
  const finalV = [];
  if (OW !== W || OH !== H) finalV.push(`scale=${OW}:${OH}:flags=lanczos`);
  const filters = [];
  if (gif) {
    // GIF: at most 25 fps, one palette for the whole clip (stats from the moving parts)
    const gfps = Math.min(25, fps);
    filters.push(...vf, `[${vlast}]${[...finalV, `fps=${gfps}`, 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24'].join(',')},split[g1][g2]`,
      '[g1]palettegen=stats_mode=diff[gp]', '[g2][gp]paletteuse=dither=sierra2_4a[vout]');
  } else if (!audioOnly) {
    finalV.push(`format=${still ? 'rgb24' : CODECS[codec].pix}`);
    if (!still) finalV.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv');
    filters.push(...vf, `[${vlast}]${finalV.join(',')}[vout]`);
  }
  if (!still && !gif) filters.push(...af, ...mix, `[amix]${loud || 'anull'}[aout]`);

  await fsp.mkdir(path.dirname(out), { recursive: true });
  const ext = path.extname(out);
  const tmp = `${out.slice(0, -ext.length)}.partial${ext}`;
  const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...inputArgs, '-filter_complex', filters.join(';')];
  if (still) args.push('-map', '[vout]', '-frames:v', '1', '-update', '1', tmp);
  else if (gif) args.push('-map', '[vout]', '-loop', '0', '-t', f4(D), '-progress', 'pipe:1', '-nostats', tmp);
  else if (audioOnly) args.push('-map', '[aout]', ...AUDIO_ARGS[outExt], '-t', f4(D), '-progress', 'pipe:1', '-nostats', tmp);
  else args.push('-map', '[vout]', '-map', '[aout]', ...codecArgs(codec, { crf, preset, fps, audioBitrate: o.audioBitrate }), '-r', String(fps), '-t', f4(D), '-progress', 'pipe:1', '-nostats', tmp);

  const base = wComp + wLoud;
  onProgress({ phase: 'encoding', progress: base, detail: '' });
  let buf = '';
  try {
    await run('ffmpeg', args, {
      nice: o.nice ?? 5,
      signal,
      onStdout: (d) => {
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) {
          const m = l.match(/^out_time_us=(\d+)/);
          if (m) {
            const sec = Number(m[1]) / 1e6;
            onProgress({ phase: 'encoding', progress: base + wEnc * Math.min(1, sec / D), detail: `${sec.toFixed(1)}s / ${D.toFixed(1)}s` });
          }
        }
      },
    });
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    if (tmp0) await fsp.rm(tmp0, { recursive: true, force: true });
    if (o.debug) e.message += `\n\nffmpeg ${args.map((a) => (/[\s;'[\]]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
    throw e;
  }
  await fsp.rename(tmp, out);
  if (tmp0) await fsp.rm(tmp0, { recursive: true, force: true });
  onProgress({ phase: 'done', progress: 1, detail: '' });
  return { out, duration: D, codec, size: `${OW}x${OH}`, loudness: loud ? o.loudness : null, logs: [...logs] };
}
