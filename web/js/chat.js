// Chat panel: talks to the agent picked in AI settings (Claude Code, another
// agent CLI, or kadr's own agent over a model API), running in the project
// folder (server side: src/agent.js). The agent edits the same files the
// editor shows, so the preview updates while it works.
import { tc, clipEnd } from '/shared/model.js';
import { ART } from './art.js';
import { S, on, emit, duration, toast } from './state.js';
import { $, h, svg, api, upload, clipName } from './util.js';
import { clipById } from './ops.js';
import { openAiSettings } from './aisettings.js';
import { openMenu } from './menu.js';
import { AGENTS } from '/shared/providers.js';

const root = $('#chat');
let info = { agents: {}, busy: false, messages: [] };
let msgs = [];
let useCtx = true;
let model = '';
let full = false;
let attachments = []; // project paths of files attached to the next message
const expanded = new Set(); // bot messages whose steps are shown in full
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
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.8-1"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
  clip: '<path d="M10.5 4.5 5.4 9.6a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a3 3 0 0 0-4.2-4.2L3.5 7.7a4.3 4.3 0 0 0 6.1 6.1l4-4"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"/>',
  retry: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
  edit: '<path d="M10.5 3.5 12.5 5.5 6 12H4v-2z"/>',
  down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  newchat: '<path d="M8 3.5v9M3.5 8h9"/>',
  chev: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  plug: '<path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2"/>',
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
  const sel = [...S.sel].map(clipById).filter(Boolean);
  const what = sel.length === 1 ? clipName(sel[0]) : sel.length ? `${sel.length} clips` : '';
  return `${tc(S.t, S.project.fps)}${what ? ` · ${what}` : ''}`;
}

// ---------- markdown (small, safe: everything is escaped first) ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function inline(s) {
  const codes = [];
  let out = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}
function md(text) {
  const out = [];
  const parts = text.trim().split(/```[\w-]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2) { out.push(`<pre dir="ltr"><code>${esc(part.replace(/\n$/, ''))}</code></pre>`); return; }
    for (const block of part.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.length === 1 && /^#{1,4}\s/.test(lines[0])) { out.push(`<h6 dir="auto">${inline(lines[0].replace(/^#+\s*/, ''))}</h6>`); continue; }
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) { out.push(`<ul dir="auto">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`); continue; }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) { out.push(`<ol dir="auto">${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`); continue; }
      out.push(`<p dir="auto">${lines.map((l) => (/^#{1,4}\s/.test(l) ? `<b>${inline(l.replace(/^#+\s*/, ''))}</b>` : inline(l))).join('<br>')}</p>`);
    }
  });
  return out.join('');
}

// attachments travel inside the message text, on its last line
const ATT_RE = /\n\nAttached files: (.+)$/;
const splitAtt = (t) => { const m = String(t || '').match(ATT_RE); return m ? { text: t.slice(0, m.index), files: m[1].split(', ') } : { text: t, files: [] }; };
const fileUrl = (p) => `/p/${p.split('/').map(encodeURIComponent).join('/')}`;
const isImg = (p) => /\.(png|jpe?g|webp|gif)$/i.test(p);

// ---------- elements ----------
const log = h('div.chat-log');
const toBottom = h('button.chat-bottom', { title: 'Scroll to the latest', hidden: true, on: { click: () => { log.scrollTop = log.scrollHeight; } } }, svg(I.down));
const ta = h('textarea', { rows: 1, dir: 'auto', placeholder: 'Ask for an edit…  Enter to send, Shift+Enter for a new line' });
const ctxBtn = h('button.ctx', { title: 'Editor context sent with your message (playhead, selection, in/out). Click to toggle.' });
const modelSel = h('select', { title: 'Claude model' }, ...[['', 'Default model'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([v, t]) => h('option', { value: v }, t)));
const accessBtn = h('button.btn.ghost.icon', { style: { width: '26px', height: '26px' } });
const sendBtn = h('button.send', { title: 'Send' });
const fileInput = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,video/*,audio/*,.txt,.md,.json,.srt,.html' });
const attachBtn = h('button.btn.ghost.icon', { title: 'Attach files (or drop / paste them here). They are copied into media/chat/.', style: { width: '26px', height: '26px' }, on: { click: () => fileInput.click() } }, svg(I.clip));
const attRow = h('div.att-row', { hidden: true });
const whoName = h('span');
const who = h('button.who', { title: 'Switch agent' }, h('i'), whoName, svg(I.chev));
const gearBtn = h('button.btn.ghost.icon', { title: 'AI settings', style: { width: '26px', height: '26px' }, on: { click: () => openAiSettings(loadChat) } }, svg(I.gear));
const newBtn = h('button.btn.ghost.icon', { title: 'New conversation (the project keeps all changes)', style: { width: '26px', height: '26px' }, on: { click: newChat } }, svg(I.newchat));
const nodes = new Map();
let tick = 0;

function paintControls() {
  const busy = info.busy;
  sendBtn.replaceChildren(svg(busy ? I.stop : I.send));
  sendBtn.classList.toggle('stop', busy);
  sendBtn.title = busy ? 'Stop  Esc' : 'Send  Enter';
  sendBtn.disabled = !busy && !ta.value.trim() && !attachments.length;
  who.querySelector('i').classList.toggle('busy', busy);
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
  modelSel.hidden = (info.agent && info.agent !== 'claude') || !!info.claudeVia;
  whoName.textContent = info.agentName ? `${info.agentName}${info.apiModel ? ` · ${info.apiModel}` : ''}` : 'Chat';
  attRow.hidden = !attachments.length;
  attRow.replaceChildren(...attachments.map((p, i) => h('span.att', { title: p },
    isImg(p) ? h('img', { src: fileUrl(p) }) : null, h('span', {}, p.split('/').pop()),
    h('button', { title: 'Remove', on: { click: () => { attachments.splice(i, 1); paintControls(); } } }, '×'))));
}

// ---------- messages ----------
function actions(...btns) { return h('div.msg-actions', {}, ...btns.filter(Boolean)); }
const iconBtn = (icon, title, fn) => h('button', { title, on: { click: fn } }, svg(icon));
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy is blocked by the browser', true); }
}

function userNode(m) {
  const { text, files } = splitAtt(m.text);
  const isLast = msgs.filter((x) => x.role === 'user').at(-1) === m;
  return h('div.msg.user', {},
    text ? h('div.bubble', { dir: 'auto' }, text) : null,
    files.length ? h('div.att-sent', {}, ...files.map((p) => (isImg(p)
      ? h('img', { src: fileUrl(p), title: p, on: { click: () => lightbox(fileUrl(p)) } })
      : h('span.att', { title: p }, p.split('/').pop())))) : null,
    actions(iconBtn(I.copy, 'Copy', () => copy(text)), isLast && !info.busy ? iconBtn(I.edit, 'Edit and send again', () => editLast(m)) : null));
}

function fmtTime(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }

function fillBot(el, m) {
  const kids = [];
  if (m.agent) kids.push(h('div.bot-who', {}, m.agent));
  const steps = m.steps || [];
  if (steps.length) {
    const open = !m.done || expanded.has(m.id);
    const shown = !m.done ? steps.slice(-6) : steps;
    const errors = steps.filter((s) => s.kind === 'error').length;
    if (m.done) {
      kids.push(h('button.steps-toggle', { on: { click: () => { if (expanded.has(m.id)) expanded.delete(m.id); else expanded.add(m.id); fillBot(el, m); } } },
        svg(I.chev), `${steps.length} step${steps.length === 1 ? '' : 's'}${m.ms ? ` · ${fmtTime(m.ms)}` : ''}${errors ? ` · ${errors} error${errors > 1 ? 's' : ''} along the way` : ''}`));
    }
    if (open) kids.push(h(`div.steps${m.done ? '' : '.live'}`, {}, ...shown.map((s) => h(`div.step${s.kind === 'error' ? '.error' : ''}`, {}, h('b', {}, s.label), h('span', { title: s.detail }, s.detail)))));
  }
  const text = (m.text || '') + (m.live ? `${m.text ? '\n\n' : ''}${m.live}` : '');
  if (text) {
    const body = h('div.body', { html: md(text) });
    if (!m.done) body.lastElementChild?.classList.add('caret');
    kids.push(body);
  }
  if (!m.done) {
    const last = steps.at(-1);
    kids.push(h('div.working', {}, h('span.dots', {}, h('i'), h('i'), h('i')),
      h('span', {}, `${m.status || (last ? `${last.label} ${last.detail || ''}`.trim() : 'Thinking')}`), h('span.elapsed', {}, fmtTime(Date.now() - (m.at || Date.now())))));
  }
  if (m.images?.length) {
    kids.push(h('div.shots', {}, ...m.images.slice(-6).map((p) => h('img', {
      src: `${fileUrl(p)}?v=${m.id}`, title: p, loading: 'lazy', on: { click: (e) => lightbox(e.target.src) },
    }))));
  }
  if (m.done) {
    if (m.error) kids.push(h('div.bot-error', {}, h('b', {}, 'The agent stopped with an error'), h('span', { dir: 'auto' }, m.error)));
    const isLast = msgs.at(-1) === m;
    const edited = steps.some((s) => s.label === 'edit' || s.label === 'write');
    kids.push(actions(
      text ? iconBtn(I.copy, 'Copy the answer', () => copy(m.text || text)) : null,
      isLast ? iconBtn(I.retry, 'Ask again', retryLast) : null,
      m.stopped ? h('span.tag-note', {}, 'stopped') : null,
      m.reverted ? h('span.tag-note', {}, 'changes undone') : edited ? h('button.undo', { on: { click: () => revert(m) } }, 'Undo these changes') : null,
    ));
  }
  el.replaceChildren(...kids);
}

function lightbox(src) {
  const lb = h('div.lightbox', { on: { click: () => lb.remove() } }, h('img', { src }));
  document.body.append(lb);
}

function emptyState() {
  if (!info.ready) {
    const isApi = info.agent === 'api';
    return h('div.chat-empty', {},
      h('h5', {}, isApi ? 'Set up the model API' : info.agent === 'custom' ? 'Set your agent command' : `${info.agentName || 'The agent'} is not installed`),
      h('p', { html: isApi
        ? 'The chat is set to use a model API. Choose the service, the model and paste your API key in AI settings.'
        : info.agent === 'claude'
          ? 'The chat runs the <code>claude</code> CLI with your own login, no API key needed. Install Claude Code and sign in once in a terminal, or pick another agent or an API key.'
          : 'Install it and sign in once in a terminal, or pick another agent.' }),
      h('button.btn.primary', { on: { click: () => openAiSettings(loadChat, 'agent') } }, 'Choose the agent'));
  }
  return h('div.chat-empty', {},
    h('div.empty-art', { html: ART.chat() }),
    h('h5', {}, 'Edit by describing it'),
    h('p', {}, `${info.agentName || 'The agent'} works on this project's files. You see every change live, and each turn can be undone. Attach photos, music or notes with the clip button.`),
    h('button.btn.primary.sm', { style: { margin: '4px auto 10px' }, on: { click: () => import('./brief.js').then((x) => x.openBrief()) } }, 'Start from a brief (product, song, photos, website)'),
    h('div.chips', {}, ...SUGGEST.map((s) => h('button.chip', { dir: 'rtl', on: { click: () => { ta.value = s; autosize(); ta.focus(); paintControls(); } } }, s))),
    h('button.btn.link.sm.connect-tip', { on: { click: () => openAiSettings(loadChat, 'connect') } }, svg(I.plug), 'Use kadr from Claude Code, Codex, Cursor… without opening this app'));
}

function renderAll() {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  nodes.clear();
  if (!info.ready || !msgs.length) { log.replaceChildren(emptyState()); return; }
  log.replaceChildren(...msgs.map((m) => {
    const n = m.role === 'user' ? userNode(m) : h('div.msg.bot');
    if (m.role !== 'user') fillBot(n, m);
    nodes.set(m.id, n);
    return n;
  }));
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
  ta.style.height = `${Math.min(200, ta.scrollHeight)}px`;
}

// ---------- actions ----------
async function send() {
  const typed = ta.value.trim();
  if ((!typed && !attachments.length) || info.busy) return;
  const text = `${typed || 'Look at the attached files.'}${attachments.length ? `\n\nAttached files: ${attachments.join(', ')}` : ''}`;
  const sentAtt = attachments;
  ta.value = '';
  attachments = [];
  autosize();
  info.busy = true;
  paintControls();
  try {
    await api('/api/agent', { text, context: useCtx ? contextLine() : '', model, full });
  } catch (e) {
    info.busy = false;
    ta.value = typed;
    attachments = sentAtt;
    paintControls();
    toast(e.message, true);
  }
}

function lastUser() { return msgs.filter((x) => x.role === 'user' && !x.reverted).at(-1); }
function retryLast() {
  const u = lastUser();
  if (!u || info.busy) return;
  const { text, files } = splitAtt(u.text);
  ta.value = text;
  attachments = files;
  autosize();
  send();
}
function editLast(m) {
  const { text, files } = splitAtt((m || lastUser())?.text || '');
  ta.value = text;
  attachments = files;
  autosize();
  paintControls();
  ta.focus();
}

async function revert(m) {
  const later = msgs.filter((x) => x.role === 'assistant' && x.at > m.at && !x.reverted && x.steps?.some((s) => s.label === 'edit' || s.label === 'write'));
  if (later.length && !confirm(`This also undoes ${later.length} later turn(s). Continue?`)) return;
  try { await api('/api/agent/revert', { id: m.turn }); toast('Changes from that turn were undone'); } catch (e) { toast(e.message, true); }
}

function newChat() {
  if (info.busy) return;
  if (!msgs.length || confirm('Start a new conversation? The project keeps every change.')) api('/api/agent/reset', {}).catch((e) => toast(e.message, true));
}

async function attach(files) {
  for (const f of files) {
    try {
      const r = await upload(f, null, 'chat');
      attachments.push(r.path);
    } catch { toast(`Could not attach ${f.name}`, true); }
    paintControls();
  }
}

function agentMenu() {
  const r = who.getBoundingClientRect();
  const items = Object.entries(AGENTS)
    .filter(([k, a]) => info.agents?.[k] || k === 'api' || k === 'custom' || !a.bin)
    .map(([k, a]) => ({ label: k === 'custom' && info.agent === 'custom' ? info.agentName : a.name, checked: info.agent === k, on: () => switchAgent(k) }));
  openMenu(r.left, r.bottom + 4, [
    { label: 'Chat with', disabled: true }, ...items.map((x) => ({ ...x, sub: true })), '-',
    { label: 'AI settings…', on: () => openAiSettings(loadChat, 'agent') },
    { label: 'Use kadr from your agents…', on: () => openAiSettings(loadChat, 'connect') },
  ]);
}
async function switchAgent(k) {
  if (info.busy) return toast('Wait for the agent to finish first', true);
  try { await api('/api/settings', { agent: k }); await loadChat(); toast(`Chatting with ${info.agentName}`); } catch (e) { toast(e.message, true); }
}

// ---------- wiring ----------
ta.addEventListener('input', () => { autosize(); paintControls(); });
ta.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  if (e.key === 'Escape' && info.busy) { e.preventDefault(); api('/api/agent/stop', {}).catch(() => {}); }
  if (e.key === 'ArrowUp' && !ta.value && lastUser() && !info.busy) { e.preventDefault(); editLast(); }
});
ta.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); attach(files); }
});
fileInput.addEventListener('change', () => { attach([...fileInput.files]); fileInput.value = ''; });
sendBtn.onclick = () => (info.busy ? api('/api/agent/stop', {}).catch(() => {}) : send());
ctxBtn.onclick = () => { useCtx = !useCtx; paintControls(); };
who.onclick = agentMenu;
modelSel.onchange = () => { model = modelSel.value; try { localStorage.setItem('kadr.model', model); } catch { /* ignore */ } };
accessBtn.onclick = () => {
  if (!full && !confirm('Full access lets the agent run any command on your computer without asking. Turn it on?')) return;
  full = !full;
  try { localStorage.setItem('kadr.full', full ? '1' : '0'); } catch { /* ignore */ }
  paintControls();
};
log.addEventListener('scroll', () => { toBottom.hidden = log.scrollHeight - log.scrollTop - log.clientHeight < 120; }, { passive: true });

// files dropped on the chat are attachments, not media imports
const composer = h('div.composer', {}, h('div.box', {}, attRow, ta, h('div.row', {}, attachBtn, ctxBtn, h('div.grow'), modelSel, accessBtn, sendBtn)), fileInput);
root.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  root.classList.add('drop');
  const veil = $('#dropVeil'); // the "import into media" overlay is for the rest of the window
  if (veil) veil.hidden = true;
});
root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
root.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  e.stopPropagation();
  root.classList.remove('drop');
  attach([...e.dataTransfer.files]);
}, true);

root.replaceChildren(
  h('div.chat-head', {}, who, h('div.grow'), newBtn, gearBtn),
  h('div.chat-scroll', {}, log, toBottom),
  composer,
);

export async function loadChat() {
  try { info = await api('/api/agent'); } catch { info = { agents: {}, busy: false, messages: [] }; }
  msgs = info.messages || [];
  renderAll();
  paintControls();
}

export function focusChat() { setTimeout(() => ta.focus(), 50); }

/** Put a request in the chat box (not sent) so the user can finish or send it. */
export function askChat(text) {
  ta.value = text;
  autosize();
  paintControls();
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60);
}
/** Send a message to the agent as if the user typed it. */
export async function sendChat(text) {
  ta.value = text;
  autosize();
  await send();
}
export { openAiSettings };

// the running turn's clock
setInterval(() => {
  if (!info.busy) return;
  const m = msgs.at(-1);
  if (m && m.role === 'assistant' && !m.done && ++tick % 1 === 0) {
    const el = nodes.get(m.id)?.querySelector('.elapsed');
    if (el) el.textContent = fmtTime(Date.now() - (m.at || Date.now()));
  }
}, 1000);

// ---------- live events from the server ----------
on('agent', (e) => {
  const find = (id) => msgs.find((m) => m.id === id);
  switch (e.ev) {
    case 'user': msgs.push(e.message); renderAll(); break;
    case 'start': info.busy = true; msgs.push({ ...e.message, live: '' }); renderAll(); paintControls(); break;
    case 'delta': { const m = find(e.id); if (m) { m.live = (m.live || '') + e.text; update(e.id); } break; }
    case 'text': { const m = find(e.id); if (m) { m.text = e.text; m.live = ''; update(e.id); } break; }
    case 'step': { const m = find(e.id); if (m) { m.steps = [...(m.steps || []), e.step]; m.live = ''; m.status = ''; update(e.id); } break; }
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
    case 'reset': msgs = []; expanded.clear(); renderAll(); break;
    default:
  }
});
on('time', () => { if (!S.playing) paintControls(); });
on('select', paintControls);
on('settings', () => { if (!info.busy) loadChat(); });
