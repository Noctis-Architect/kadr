import { tc } from '/shared/model.js';
import { S, on, duration } from './state.js';
import { $, h, api } from './util.js';

const back = $('#modal');
let job = null;
let view = null;

const PRESETS = {
  web: { title: 'Web', note: 'H.264 High · -14 LUFS', codec: 'h264', ext: 'mp4', crf: 17, preset: 'slow', loudness: -14, motionBlur: 0 },
  social: { title: 'Social', note: 'H.264 · motion blur · -14 LUFS', codec: 'h264', ext: 'mp4', crf: 16, preset: 'slow', loudness: -14, motionBlur: 8 },
  master: { title: 'Master', note: 'ProRes 422 HQ · 10-bit .mov', codec: 'prores', ext: 'mov', crf: 17, preset: 'medium', loudness: null, motionBlur: 8 },
  small: { title: 'Small', note: 'H.265 · half the size', codec: 'h265', ext: 'mp4', crf: 20, preset: 'medium', loudness: -14, motionBlur: 0 },
  draft: { title: 'Draft', note: 'fast, for review', codec: 'h264', ext: 'mp4', crf: 26, preset: 'veryfast', loudness: null, motionBlur: 0 },
};
const SIZES = [['project', 'Project'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']];

function sizeFor(target) {
  const { width: W, height: H } = S.project;
  if (target === 'project') return null;
  const f = target / Math.min(W, H);
  const ev = (n) => Math.max(2, Math.round((n * f) / 2) * 2);
  return { width: ev(W), height: ev(H) };
}

export function openExport() {
  const p = S.project;
  const hasRange = S.inPt != null || S.outPt != null;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('kadr.export') || '{}'); } catch { /* private mode */ }
  const st = { name: (p.name || 'export').replace(/[^\w.-]+/g, '_'), preset: PRESETS[saved.preset] ? saved.preset : 'web', size: saved.size ?? 'project', range: hasRange ? 'range' : 'all', loudness: undefined, motionBlur: undefined };
  const cfg = () => ({ ...PRESETS[st.preset], ...(st.loudness !== undefined ? { loudness: st.loudness } : {}), ...(st.motionBlur !== undefined ? { motionBlur: st.motionBlur } : {}) });

  const presetBtns = Object.entries(PRESETS).map(([k, v]) => h('button.preset', { on: { click: () => { st.preset = k; st.loudness = undefined; st.motionBlur = undefined; paintForm(); } } }, h('b', {}, v.title), h('span', {}, v.note)));
  const seg = (opts, get, set) => {
    const btns = opts.map(([v, t, dis]) => h('button', { disabled: !!dis, on: { click: () => { set(v); paintForm(); } } }, t));
    return { el: h('div.seg-pick', {}, ...btns), paint: () => btns.forEach((b, i) => b.classList.toggle('on', String(get()) === String(opts[i][0]))) };
  };
  const sizeSeg = seg(SIZES, () => st.size, (v) => { st.size = v; });
  const loudSeg = seg([[null, 'Off'], [-14, '-14 web'], [-16, '-16 podcast'], [-23, '-23 TV']], () => cfg().loudness, (v) => { st.loudness = v; });
  const mbSeg = seg([[0, 'Off'], [4, '4×'], [8, '8×'], [16, '16×']], () => cfg().motionBlur, (v) => { st.motionBlur = v; });
  const rangeSeg = seg([['all', 'Whole timeline'], ['range', 'In → Out', !hasRange]], () => st.range, (v) => { st.range = v; });
  const nameIn = h('input.in', { value: st.name, spellcheck: false, on: { input: () => { st.name = nameIn.value; paintForm(); }, keydown: (e) => e.stopPropagation() } });
  const sum = h('div.hint', { style: { marginTop: '12px' } });
  const progress = h('div', { hidden: true }, h('div.progress', {}, h('i')), h('div.pmeta', {}, h('span.ph1'), h('span.ph2')), h('div.err-text'));
  const startBtn = h('button.btn.primary', { on: { click: start } }, 'Export');
  const cancelBtn = h('button.btn', { on: { click: () => (job?.state === 'running' ? api('/api/export/cancel', {}) : close()) } }, 'Close');
  const openBtn = h('button.btn', { hidden: true }, 'Play');
  const folderBtn = h('button.btn', { hidden: true }, 'Show in folder');

  function paintForm() {
    presetBtns.forEach((b, i) => b.classList.toggle('on', Object.keys(PRESETS)[i] === st.preset));
    for (const s of [sizeSeg, loudSeg, mbSeg, rangeSeg]) s.paint();
    const c = cfg();
    const a = st.range === 'range' ? S.inPt ?? 0 : 0;
    const b = st.range === 'range' ? S.outPt ?? duration() : duration();
    const sz = sizeFor(st.size) || { width: p.width, height: p.height };
    sum.textContent = `${sz.width}×${sz.height} · ${p.fps} fps · ${tc(Math.max(0, b - a), p.fps)} → renders/${st.name || 'export'}.${c.ext}`;
  }

  const modal = h('div.modal', { on: { pointerdown: (e) => e.stopPropagation() } },
    h('header', {}, 'Export'),
    h('div.body', {},
      h('div.presets', {}, ...presetBtns),
      h('div.f', {}, h('label.static', {}, 'File name'), nameIn),
      h('div.f', {}, h('label.static', {}, 'Resolution'), sizeSeg.el),
      h('div.f', {}, h('label.static', {}, 'Loudness'), loudSeg.el),
      h('div.f', { title: 'Motion blur for compositions: renders sub-frames over a 180° shutter (slower export)' }, h('label.static', {}, 'Motion blur'), mbSeg.el),
      h('div.f', {}, h('label.static', {}, 'Range'), rangeSeg.el),
      sum, progress),
    h('footer', {}, folderBtn, openBtn, h('div.grow'), cancelBtn, startBtn));
  paintForm();
  back.replaceChildren(modal);
  back.hidden = false;
  back.onpointerdown = () => { if (job?.state !== 'running') close(); };
  view = { modal, progress, startBtn, cancelBtn, openBtn, folderBtn };

  async function start() {
    const c = cfg();
    try { localStorage.setItem('kadr.export', JSON.stringify({ preset: st.preset, size: st.size })); } catch { /* ignore */ }
    const body = { out: `${st.name || 'export'}.${c.ext}`, codec: c.codec, crf: c.crf, preset: c.preset, loudness: c.loudness, motionBlur: c.motionBlur, ...(sizeFor(st.size) || {}) };
    if (st.range === 'range') { body.from = S.inPt ?? 0; body.to = S.outPt ?? duration(); }
    try {
      job = { state: 'running', progress: 0, phase: 'starting' };
      paint();
      await api('/api/export', body);
    } catch (e) {
      job = { state: 'error', error: e.message };
      paint();
    }
  }
}

function close() {
  back.hidden = true;
  back.replaceChildren();
  view = null;
}

function paint() {
  if (!view || !job) return;
  const { progress, startBtn, cancelBtn, openBtn, folderBtn } = view;
  progress.hidden = false;
  const pr = Math.round((job.progress || 0) * 100);
  progress.querySelector('.progress i').style.width = `${pr}%`;
  progress.querySelector('.progress i').style.animationPlayState = job.state === 'running' ? 'running' : 'paused';
  progress.querySelector('.ph1').textContent = job.state === 'done' ? `Done in ${(job.elapsed / 1000).toFixed(1)}s` : job.state === 'running' ? `${job.phase}${job.detail ? ` · ${job.detail}` : ''}` : job.state;
  progress.querySelector('.ph2').textContent = `${pr}%`;
  progress.querySelector('.err-text').textContent = job.error || (job.logs?.length ? `Composition console:\n${job.logs.join('\n')}` : '');
  startBtn.disabled = job.state === 'running';
  startBtn.textContent = job.state === 'done' ? 'Export again' : 'Export';
  cancelBtn.textContent = job.state === 'running' ? 'Cancel' : 'Close';
  const done = job.state === 'done' && job.out;
  openBtn.hidden = folderBtn.hidden = !done;
  if (done) {
    openBtn.onclick = () => window.open(`/p/${job.out.split('/').map(encodeURIComponent).join('/')}`, '_blank');
    folderBtn.onclick = () => api('/api/reveal', { path: job.out, select: true });
  }
}

on('export', (e) => {
  job = e;
  paint();
  const btn = $('#exportBtn');
  const running = e.state === 'running';
  btn.classList.toggle('busy', running);
  btn.querySelector('span').textContent = running ? `${Math.round(e.progress * 100)}%` : 'Export';
  let bar = btn.querySelector('.bar');
  if (running && !bar) { bar = h('i.bar'); btn.append(bar); }
  if (bar) bar.style.width = running ? `${e.progress * 100}%` : '0';
  if (!running) setTimeout(() => btn.querySelector('.bar')?.remove(), 400);
});
