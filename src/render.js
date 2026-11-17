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
import { normalizeProject, validateProject, projectDuration, placement, fadeAt, transitions, clipWindow, valueAt, isAnimated, maxScale, resolveAt, transitionOffset, transitionOffsetExpr } from '../shared/model.js';
import { Browser } from './chrome.js';
import { resolveSrc, compUrl, BUILTIN_DIR } from './project.js';
import { run } from './media.js';

const f4 = (n) => Number(n).toFixed(4);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

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
  const codec = still ? null : pickCodec(out, o.codec);
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
  const comps = items.filter((x) => x.c.type === 'html' && !x.tracks.hidden);
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
    const wantV = c.type !== 'audio' && !tr0.hidden;
    let wantA = !still && !tr0.muted && (c.volume > 0 || isAnimated(c, 'volume')) && (c.type === 'audio' || c.type === 'video');
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
      const mw = c.type === 'html' ? W : info.width;
      const mh = c.type === 'html' ? H : info.height;
      const rc = still ? resolveAt(c, from) : c;
      const base = placement({ ...c, x: 0, y: 0, scale: 1 }, mw, mh, W, H);
      const animS = !still && isAnimated(c, 'scale');
      const animR = !still && isAnimated(c, 'rotation');
      const rot = animR || Math.abs(rc.rotation || 0) > 1e-6;
      const U = sub('t', T0);
      const ch = [];
      if (c.type === 'video') {
        if (holdLast) ch.push('reverse', 'trim=end_frame=1');
        ch.push(sp !== 1 ? `setpts=(PTS-STARTPTS)/${sp.toFixed(6)}` : 'setpts=PTS-STARTPTS', `fps=${fps}`);
        if (headPad > 1e-4 || tailPad > 1e-4) ch.push(`tpad=start_mode=clone:start_duration=${f4(headPad)}:stop_mode=clone:stop_duration=${f4(tailPad + 2 / fps)}`);
      } else ch.push('setpts=PTS-STARTPTS');
      ch.push(`setpts=PTS+${f4(off)}/TB`, 'format=rgba');
      // crop keeps the frame size: cut-away parts become transparent (like the CSS inset)
      if (c.cropT || c.cropR || c.cropB || c.cropL) {
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
      const cm = 'out_color_matrix=bt709:out_range=tv';
      if (!animS && !rot) {
        ch.push(`scale=${even(base.w * rc.scale)}:${even(base.h * rc.scale)}:flags=lanczos:${cm}`);
      } else {
        const smax = animS ? maxScale(c) : rc.scale;
        const BW = even(base.w * smax);
        const BH = even(base.h * smax);
        ch.push(`scale=${BW}:${BH}:flags=lanczos`);
        if (rot) {
          let ow;
          let oh;
          if (animR) { ow = even(Math.hypot(BW, BH)); oh = ow; } else {
            const r = (rc.rotation * Math.PI) / 180;
            ow = even(Math.abs(BW * Math.cos(r)) + Math.abs(BH * Math.sin(r)));
            oh = even(Math.abs(BW * Math.sin(r)) + Math.abs(BH * Math.cos(r)));
          }
          const a = animR ? keyExpr(c, 'rotation', U, (v) => (v * Math.PI) / 180) : f4((rc.rotation * Math.PI) / 180);
          ch.push(`rotate=a='${a}':ow=${ow}:oh=${oh}:c=black@0`);
        }
        if (animS) {
          const f = `(${keyExpr(c, 'scale', U)})/${f4(smax)}`;
          ch.push(`scale=w='max(2,2*trunc(iw*${f}/2))':h='max(2,2*trunc(ih*${f}/2))':eval=frame:flags=lanczos:${cm}`);
        } else ch.push(`scale=${cm}`);
      }
      ch.push('format=yuva420p');
      vf.push(`[${k}:v]${ch.join(',')}[v${k}]`);
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
      vf.push(`[${vlast}][v${k}]overlay=x='(main_w-overlay_w)/2+${px}':y='(main_h-overlay_h)/2+${py}':eof_action=pass:enable='between(t,${f4(off)},${f4(off + len)})'[o${k}]`);
      vlast = `o${k}`;
    }
    if (wantA) {
      const cutA = cut + headPad; // clip-local second where the audio starts
      const Ua = cutA >= 0 ? `(t+${f4(cutA)})` : `(t-${f4(-cutA)})`;
      const ch = ['asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...atempo(sp), 'asetpts=PTS-STARTPTS'];
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
  finalV.push(`format=${still ? 'rgb24' : CODECS[codec].pix}`);
  if (!still) finalV.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv');
  const filters = [...vf, `[${vlast}]${finalV.join(',')}[vout]`];
  if (!still) filters.push(...af, ...mix, `[amix]${loud || 'anull'}[aout]`);

  await fsp.mkdir(path.dirname(out), { recursive: true });
  const ext = path.extname(out);
  const tmp = `${out.slice(0, -ext.length)}.partial${ext}`;
  const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...inputArgs, '-filter_complex', filters.join(';'), '-map', '[vout]'];
  if (still) args.push('-frames:v', '1', '-update', '1', tmp);
  else args.push('-map', '[aout]', ...codecArgs(codec, { crf, preset, fps, audioBitrate: o.audioBitrate }), '-r', String(fps), '-t', f4(D), '-progress', 'pipe:1', '-nostats', tmp);

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
