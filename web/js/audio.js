// Preview sound through Web Audio: every video/audio clip plays through its own
// gain (volume up to 400%, fades, mute/solo) and stereo panner (the same equal-power
// pan as the export), into a master bus with level meters.
let ctx = null;
let master = null;
let an = null; // { l, r, bl, br }
let failed = false;

function ensure() {
  if (ctx || failed) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  } catch {
    failed = true;
    return null;
  }
  master = ctx.createGain();
  master.connect(ctx.destination);
  const split = ctx.createChannelSplitter(2);
  master.connect(split);
  const mk = () => { const a = ctx.createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0; return a; };
  an = { l: mk(), r: mk() };
  split.connect(an.l, 0);
  split.connect(an.r, 1);
  an.bl = new Float32Array(an.l.fftSize);
  an.br = new Float32Array(an.r.fftSize);
  return ctx;
}

// Browsers start audio only after a user gesture.
const wake = () => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
window.addEventListener('pointerdown', wake, true);
window.addEventListener('keydown', wake, true);

/** Route a media element through Web Audio. Returns a handle, or null (then use el.volume). */
export function attachAudio(el) {
  const c = ensure();
  if (!c) return null;
  try {
    const src = c.createMediaElementSource(el);
    const gain = c.createGain();
    // mono sources are spread to both sides before panning, like the export
    gain.channelCount = 2;
    gain.channelCountMode = 'explicit';
    gain.channelInterpretation = 'speakers';
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
    el.volume = 1;
    return { src, gain, pan, v: -1, p: 0 };
  } catch {
    return null;
  }
}

export function setAudio(a, volume, pan) {
  if (Math.abs(a.v - volume) > 1e-4) {
    a.v = volume;
    a.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.012);
  }
  if (a.pan && a.p !== pan) { a.p = pan; a.pan.pan.value = pan; }
}

export function detachAudio(a) {
  if (!a) return;
  for (const n of [a.src, a.gain, a.pan]) { try { n?.disconnect(); } catch { /* gone */ } }
}

const db = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
function peak(a, buf) {
  a.getFloatTimeDomainData(buf);
  let m = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
  return m;
}

/** Current peak levels in dBFS: { l, r }, or null without Web Audio. */
export function levels() {
  if (!an || !ctx || ctx.state !== 'running') return null;
  return { l: db(peak(an.l, an.bl)), r: db(peak(an.r, an.br)) };
}

// ---------- meters (the strip next to the timeline) ----------
const FLOOR = -60;
const hold = { l: FLOOR, r: FLOOR, tl: 0, tr: 0 };
const fall = { l: FLOOR, r: FLOOR };
let raf = 0;
let canvas = null;

export function initMeters(cv) {
  canvas = cv;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    draw();
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

function draw() {
  if (!canvas || !canvas.isConnected || canvas.offsetParent === null) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const lv = levels() || { l: -120, r: -120 };
  const now = performance.now();
  const top = 6;
  const bot = h - 16;
  const yOf = (d) => top + (bot - top) * (1 - (Math.max(FLOOR, Math.min(0, d)) - FLOOR) / -FLOOR);
  const css = getComputedStyle(canvas);
  const faint = css.getPropertyValue('--faint').trim() || '#666';
  const lineC = css.getPropertyValue('--line-2').trim() || '#333';
  // scale
  g.font = '9px ui-monospace, monospace';
  g.textAlign = 'right';
  g.fillStyle = faint;
  for (const d of [0, -6, -12, -18, -24, -36, -48]) {
    const y = Math.round(yOf(d)) + 0.5;
    g.fillText(String(d), w - 2, y + 3);
  }
  const bw = Math.max(4, Math.floor((w - 22) / 2) - 1);
  ['l', 'r'].forEach((ch, i) => {
    const x = 3 + i * (bw + 2);
    // fall back smoothly (meters decay ~ 20 dB/s)
    fall[ch] = Math.max(lv[ch], fall[ch] - 0.35);
    if (lv[ch] >= hold[ch] || now - hold[`t${ch}`] > 1200) { hold[ch] = lv[ch]; hold[`t${ch}`] = now; }
    g.fillStyle = lineC;
    g.fillRect(x, top, bw, bot - top);
    const y = yOf(fall[ch]);
    const grad = g.createLinearGradient(0, bot, 0, top);
    grad.addColorStop(0, '#3ecf8e');
    grad.addColorStop(0.7, '#3ecf8e');
    grad.addColorStop(0.85, '#f0c040');
    grad.addColorStop(1, '#ff5a4a');
    g.fillStyle = grad;
    if (fall[ch] > FLOOR) g.fillRect(x, y, bw, bot - y);
    if (hold[ch] > FLOOR) {
      g.fillStyle = hold[ch] > -1 ? '#ff5a4a' : '#e8e8ec';
      g.fillRect(x, Math.round(yOf(hold[ch])), bw, 1.5);
    }
  });
  g.textAlign = 'center';
  g.fillStyle = faint;
  g.fillText('L', 3 + bw / 2, h - 4);
  g.fillText('R', 3 + bw + 2 + bw / 2, h - 4);
}
