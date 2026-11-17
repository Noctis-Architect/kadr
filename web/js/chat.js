// Chat panel: talks to Claude Code running headless in the project folder
// (server side: src/agent.js). The agent edits the same files the editor shows,
// so the preview updates while it works.
import { tc, clipEnd } from '/shared/model.js';
import { ART } from './art.js';
import { S, on, emit, duration, toast } from './state.js';
import { $, h, svg, api } from './util.js';
import { clipById } from './ops.js';

const root = $('#chat');
let info = { agents: {}, busy: false, messages: [] };
let msgs = [];
let useCtx = true;
let model = '';
let full = false;
try {
  model = localStorage.getItem('kadr.model') || '';
  full = localStorage.getItem('kadr.full') === '1';
} catch { /* private mode */ }

const SUGGEST = [
  'یه تایتل حرفه‌ای برای اول ویدیو بساز',
  'سکوت‌های ویدیو رو پیدا کن و کات بزن',
  'روی کلیپ انتخاب‌شده زیرنویس متحرک بذار',
  'بین کات‌ها ترنزیشن بذار',
  'رنگ کلیپ‌ها رو گرم‌تر و سینمایی‌تر کن',
];

const I = {
  send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.8-1"/>',
};

// ---------- context the agent gets with every message ----------
function contextLine() {
  const p = S.project;
  if (!p) return '';
  const parts = [`playhead ${S.t.toFixed(3)}s (${tc(S.t, p.fps)})`];
  const sel = [...S.sel].map(clipById).filter(Boolean);
  parts.push(sel.length ? `selected: ${sel.map((c) => `${c.id} (${c.type} ${c.src}, ${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)}s on ${c.track})`).join(', ')}` : 'selected: none');
  if (S.inPt != null || S.outPt != null) parts.push(`in/out ${(S.inPt ?? 0).toFixed(2)}–${(S.outPt ?? duration()).toFixed(2)}s`);
  if (S.marker) { const m = p.markers.find((x) => x.id === S.marker); if (m) parts.push(`selected marker ${m.id} at ${m.t}s "${m.note || ''}"`); }
  parts.push(`project ${p.width}x${p.height} @ ${p.fps}fps, ${duration().toFixed(2)}s`);
  return parts.join('; ');
}
function contextChip() {
  if (!S.project) return '';
  const n = S.sel.size;
  return `${tc(S.t, S.project.fps)}${n ? ` · ${n === 1 ? [...S.sel][0] : `${n} clips`}` : ''}`;
}

// ---------- tiny markdown ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function md(text) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul dir="auto">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p dir="auto">${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

// ---------- rendering ----------
const log = h('div.chat-log');
const ta = h('textarea', { rows: 1, dir: 'auto', placeholder: 'Ask for an edit…  (Enter to send)' });
const ctxBtn = h('button.ctx', { title: 'Editor context sent with your message (playhead, selection, in/out). Click to toggle.' });
const modelSel = h('select', { title: 'Model' }, ...[['', 'Default model'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([v, t]) => h('option', { value: v }, t)));
const accessBtn = h('button.btn.ghost.icon', { style: { width: '24px', height: '24px' } });
const sendBtn = h('button.send', { title: 'Send' });
const who = h('div.who', {}, h('i'), 'Claude Code');
const nodes = new Map();

function paintControls() {
  const busy = info.busy;
  sendBtn.replaceChildren(svg(busy ? I.stop : I.send));
  sendBtn.classList.toggle('stop', busy);
  sendBtn.title = busy ? 'Stop' : 'Send';
  sendBtn.disabled = !busy && !ta.value.trim();
  who.firstChild.classList.toggle('busy', busy);
  $('#chatDot').classList.toggle('on', busy);
  ctxBtn.textContent = `@ ${contextChip()}`;
  ctxBtn.classList.toggle('off', !useCtx);
  accessBtn.replaceChildren(svg(full ? I.unlock : I.lock));
  accessBtn.classList.toggle('toggle', true);
  accessBtn.classList.toggle('on', full);
  accessBtn.title = full
    ? 'Full access: the agent may run any command without asking. Click to limit it to project files + kadr/ffmpeg.'
    : 'Limited: the agent can edit project files and run kadr / ffmpeg only. Click for full access.';
  modelSel.value = model;
}

function msgNode(m) {
  if (m.role === 'user') return h('div.msg.user', { dir: 'auto' }, m.text);
  const el = h('div.msg.bot');
  fillBot(el, m);
  return el;
}

function fillBot(el, m) {
  const kids = [];
  if (m.steps?.length) {
    kids.push(h('div.steps', {}, ...m.steps.slice(-14).map((s) => h(`div.step${s.kind === 'error' ? '.error' : ''}`, {}, h('b', {}, s.label), h('span', { title: s.detail }, s.detail)))));
  }
  const text = (m.text || '') + (m.live ? `${m.text ? '\n\n' : ''}${m.live}` : '');
  if (text) {
    const body = h('div.body', { html: md(text) });
    if (!m.done) body.lastElementChild?.classList.add('caret');
    kids.push(body);
  } else if (!m.done) {
    kids.push(h('div.typing', {}, h('i'), h('i'), h('i')));
  }
  if (m.images?.length) {
    kids.push(h('div.shots', {}, ...m.images.slice(-6).map((p) => h('img', {
      src: `/p/${p.split('/').map(encodeURIComponent).join('/')}?v=${m.id}`, title: p, loading: 'lazy',
      on: { click: (e) => lightbox(e.target.src) },
    }))));
  }
  if (m.done) {
    const meta = [];
    if (m.error) meta.push(h('span.err', {}, m.error));
    else if (m.stopped) meta.push(h('span', {}, 'stopped'));
    if (m.ms) meta.push(h('span', {}, `${(m.ms / 1000).toFixed(0)}s`));
    if (m.reverted) meta.push(h('span', {}, 'changes undone'));
    else if (m.steps?.some((s) => s.label === 'edit' || s.label === 'write')) {
      meta.push(h('button.btn.link', { on: { click: () => revert(m) } }, 'Undo these changes'));
    }
    if (meta.length) kids.push(h('div.meta', {}, ...meta));
  } else if (m.status) {
    kids.push(h('div.meta', {}, m.status));
  }
  el.replaceChildren(...kids);
}

function lightbox(src) {
  const lb = h('div.lightbox', { on: { click: () => lb.remove() } }, h('img', { src }));
  document.body.append(lb);
}

function renderAll() {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  nodes.clear();
  if (!info.agents?.claude) {
    log.replaceChildren(h('div.chat-empty', {}, h('h5', {}, 'Claude Code is not installed'),
      h('p', { html: 'The chat runs the <code>claude</code> CLI with your own login, no API key needed. Install Claude Code, sign in once in a terminal, then reload this page.' })));
    return;
  }
  if (!msgs.length) {
    log.replaceChildren(h('div.chat-empty', {},
      h('div.empty-art', { html: ART.chat() }),
      h('h5', {}, 'Edit by describing it'),
      h('p', {}, 'Claude Code works on this project\'s files with your own account. You see every change live, and each turn can be undone.'),
      h('div.chips', {}, ...SUGGEST.map((s) => h('button.chip', { dir: 'rtl', on: { click: () => { ta.value = s; autosize(); ta.focus(); paintControls(); } } }, s)))));
    return;
  }
  log.replaceChildren(...msgs.map((m) => { const n = msgNode(m); nodes.set(m.id, n); return n; }));
  if (atBottom || info.busy) log.scrollTop = log.scrollHeight;
}

function update(id) {
  const m = msgs.find((x) => x.id === id);
  const n = nodes.get(id);
  if (!m || !n) return renderAll();
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  fillBot(n, m);
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function autosize() {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(180, ta.scrollHeight)}px`;
}

// ---------- actions ----------
async function send() {
  const text = ta.value.trim();
  if (!text || info.busy) return;
  ta.value = '';
  autosize();
  info.busy = true;
  paintControls();
  try {
    await api('/api/agent', { text, context: useCtx ? contextLine() : '', model, full });
  } catch (e) {
    info.busy = false;
    ta.value = text;
    paintControls();
    toast(e.message, true);
  }
}

async function revert(m) {
  const later = msgs.filter((x) => x.role === 'assistant' && x.at > m.at && !x.reverted && x.steps?.some((s) => s.label === 'edit' || s.label === 'write'));
  if (later.length && !confirm(`This also undoes ${later.length} later turn(s). Continue?`)) return;
  try { await api('/api/agent/revert', { id: m.turn }); toast('Changes from that turn were undone'); } catch (e) { toast(e.message, true); }
}

ta.addEventListener('input', () => { autosize(); paintControls(); });
ta.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
sendBtn.onclick = () => (info.busy ? api('/api/agent/stop', {}).catch(() => {}) : send());
ctxBtn.onclick = () => { useCtx = !useCtx; paintControls(); };
modelSel.onchange = () => { model = modelSel.value; try { localStorage.setItem('kadr.model', model); } catch { /* ignore */ } };
accessBtn.onclick = () => {
  if (!full && !confirm('Full access lets the agent run any command on your computer without asking. Turn it on?')) return;
  full = !full;
  try { localStorage.setItem('kadr.full', full ? '1' : '0'); } catch { /* ignore */ }
  paintControls();
};

root.replaceChildren(
  h('div.chat-head', {}, who, h('div.grow'),
    h('button.btn.ghost.sm', { title: 'Start a new conversation (the project keeps all changes)', on: { click: () => { if (info.busy) return; if (!msgs.length || confirm('Start a new conversation?')) api('/api/agent/reset', {}).catch((e) => toast(e.message, true)); } } }, 'New chat')),
  log,
  h('div.composer', {}, h('div.box', {}, ta, h('div.row', {}, ctxBtn, h('div.grow'), modelSel, accessBtn, sendBtn))),
);

export async function loadChat() {
  try { info = await api('/api/agent'); } catch { info = { agents: {}, busy: false, messages: [] }; }
  msgs = info.messages || [];
  renderAll();
  paintControls();
}

export function focusChat() { setTimeout(() => ta.focus(), 50); }

// ---------- live events from the server ----------
on('agent', (e) => {
  const find = (id) => msgs.find((m) => m.id === id);
  switch (e.ev) {
    case 'user': msgs.push(e.message); renderAll(); break;
    case 'start': info.busy = true; msgs.push({ ...e.message, live: '' }); renderAll(); paintControls(); break;
    case 'delta': { const m = find(e.id); if (m) { m.live = (m.live || '') + e.text; update(e.id); } break; }
    case 'text': { const m = find(e.id); if (m) { m.text = e.text; m.live = ''; update(e.id); } break; }
    case 'step': { const m = find(e.id); if (m) { m.steps = [...(m.steps || []), e.step]; m.live = ''; update(e.id); } break; }
    case 'image': { const m = find(e.id); if (m) { m.images = [...(m.images || []), e.path]; update(e.id); } break; }
    case 'status': { const m = find(e.id); if (m) { m.status = e.text; update(e.id); } break; }
    case 'done': {
      info.busy = false;
      const i = msgs.findIndex((m) => m.id === e.message.id);
      if (i >= 0) msgs[i] = e.message; else msgs.push(e.message);
      renderAll();
      paintControls();
      if (document.hidden || !root.classList.contains('on')) emit('toast', { text: e.message.error ? 'The agent stopped with an error' : 'The agent finished' });
      break;
    }
    case 'reverted': { const m = msgs.find((x) => x.turn === e.id); if (m) m.reverted = true; renderAll(); break; }
    case 'reset': msgs = []; renderAll(); break;
    default:
  }
});
on('time', () => { if (!S.playing) paintControls(); });
on('select', paintControls);
