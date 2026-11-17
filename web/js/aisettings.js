// AI settings: which agent the chat runs, and which services (with whose
// keys) make images, voice-overs and transcripts. Built for people who are not
// AI experts: an overview with plain status, one-key quick setup, cards
// instead of dropdowns, advanced fields folded away, and every change saved
// immediately. Keys go to the local server once and only "••••1234" comes back.
import { AGENTS, SERVICES, KEYS, NOTES, CLAUDE_VIA } from '/shared/providers.js';
import { toast } from './state.js';
import { $, h, api } from './util.js';

const back = $('#modal');

const PAGES = [
  ['overview', 'Overview'],
  ['agent', 'Chat agent'],
  ['image', 'Images'],
  ['speech', 'Voice'],
  ['transcribe', 'Transcripts'],
  ['keys', 'API keys'],
  ['connect', 'Use from your agents'],
];
const ABOUT = {
  agent: ['Chat agent', 'Edits your video when you write in the chat.'],
  image: ['Images', 'Makes pictures for backgrounds, B-roll and thumbnails.'],
  speech: ['Voice', 'Turns text into a voice-over.'],
  transcribe: ['Transcripts', 'Writes down what is said, word by word, for captions and cutting.'],
};

export async function openAiSettings(onSaved, startPage = 'overview') {
  let cur;
  try { cur = await api('/api/settings'); } catch (e) { toast(e.message, true); return; }
  let page = PAGES.some(([k]) => k === startPage) ? startPage : 'overview';
  const tests = {}; // provider -> { ok, message } | 'busy'
  const stop = (e) => e.stopPropagation();

  // ---------- status ----------
  const keyInfo = (provider, kind) => {
    if (provider === 'custom') return cur[kind]?.keySaved ? { saved: cur[kind].keySaved } : null;
    const k = cur.keys?.[provider];
    return k?.saved ? { saved: k.saved } : k?.env ? { env: true } : null;
  };
  function svcStatus(kind) {
    const c = cur[kind] || {};
    const p = SERVICES[kind][c.provider];
    if (!p) return { level: 'off', text: 'Off' };
    if (p.key && !keyInfo(c.provider, kind)) return { level: 'warn', text: 'Needs a key' };
    if (kind === 'llm' && !(c.model || p.model)) return { level: 'warn', text: 'Needs a model name' };
    if (c.provider === 'custom' && !c.baseUrl) return { level: 'warn', text: 'Needs a base URL' };
    if (p.kind === 'piper' && !c.model) return { level: 'warn', text: 'Needs a voice file' };
    if (p.kind === 'elevenlabs' && !c.voice) return { level: 'warn', text: 'Needs a voice id' };
    return { level: 'ok', text: p.name };
  }
  function agentStatus() {
    if (cur.agent === 'api') {
      const s = svcStatus('llm');
      return s.level === 'ok' ? { level: 'ok', text: `${SERVICES.llm[cur.llm.provider].name}` } : s;
    }
    if (cur.agent === 'custom') return cur.agents?.custom ? { level: 'ok', text: cur.custom?.name || 'Your command' } : { level: 'warn', text: 'Needs a command' };
    if (cur.agents?.[cur.agent] === false) return { level: 'warn', text: `${AGENTS[cur.agent].name} not installed` };
    if (cur.agent === 'claude' && cur.claudeVia?.provider) {
      const v = CLAUDE_VIA[cur.claudeVia.provider];
      const hasKey = keyInfo(cur.claudeVia.provider, 'claudeVia');
      return hasKey ? { level: 'ok', text: `Claude Code · ${v.name}` } : { level: 'warn', text: `${v.name} needs a key` };
    }
    return { level: 'ok', text: AGENTS[cur.agent].name };
  }
  const statusOf = (k) => (k === 'agent' ? agentStatus() : k === 'connect' ? (conn?.targets?.some((t) => t.connected) ? { level: 'ok', text: '' } : null) : k === 'keys' ? null : k === 'overview' ? null : svcStatus(k));

  // ---------- saving ----------
  async function save(patch, msg) {
    try {
      cur = { ...cur, ...(await api('/api/settings', patch)) };
      if (msg) toast(msg);
      onSaved?.();
    } catch (e) { toast(e.message, true); }
    render();
  }
  async function test(provider, kind) {
    tests[provider] = 'busy';
    render();
    try { tests[provider] = await api('/api/settings/test', { provider, kind }); } catch (e) { tests[provider] = { ok: false, message: e.message }; }
    render();
  }

  // ---------- small pieces ----------
  const pill = (st) => (st ? h(`span.ai-pill.${st.level}`, {}, st.text) : null);
  const testResult = (provider) => {
    const t = tests[provider];
    if (!t) return null;
    if (t === 'busy') return h('span.ai-test', {}, 'Testing…');
    return h(`span.ai-test.${t.ok ? 'ok' : 'bad'}`, {}, `${t.ok ? '✓' : '✕'} ${t.message}`);
  };
  const field = (label, value, { placeholder = '', onSave, hint, wide } = {}) => {
    const i = h('input.in', { value: value || '', placeholder, spellcheck: false, on: { keydown: (e) => { stop(e); if (e.key === 'Enter') i.blur(); }, change: () => onSave(i.value.trim()) } });
    return h(`div.f${wide ? '.wide' : ''}`, {}, h('label.static', {}, label), h('div', {}, i, hint ? h('div.hint.ai-under', {}, hint) : null));
  };

  const fill = (el, ...kids) => el.replaceChildren(...kids.filter((k) => k != null && k !== false));

  /** Key row for a provider: saved state with Test / Replace / Remove, or an input. */
  function keyBox(provider, kind, { compact = false } = {}) {
    const info = keyInfo(provider, kind);
    const meta = KEYS[provider];
    const url = meta?.url || SERVICES[kind]?.[provider]?.keyUrl;
    let editing = !info;
    const box = h('div.ai-keybox');
    const paint = () => {
      if (!editing) {
        fill(box, 
          h('span.ai-keyok', {}, info.env ? `Using ${meta?.name || ''} key from your environment` : `${meta ? `${meta.name} key` : 'Key'} saved ${info.saved}`),
          h('div.grow'),
          testResult(provider),
          h('button.btn.sm', { on: { click: () => test(provider, kind) } }, 'Test'),
          h('button.btn.ghost.sm', { on: { click: () => { editing = true; paint(); } } }, 'Replace'),
          info.saved ? h('button.btn.ghost.sm', { on: { click: () => save(provider === 'custom' ? { [kind]: { clearKey: true } } : { keys: { [provider]: null } }, 'Key removed') } }, 'Remove') : null);
        return;
      }
      const inp = h('input.in', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: `Paste your ${meta?.name || ''} API key`, on: { keydown: (e) => { stop(e); if (e.key === 'Enter') commitKey(); } } });
      const commitKey = async () => {
        const v = inp.value.trim();
        if (!v) { inp.focus(); return; }
        await save(provider === 'custom' ? { [kind]: { key: v } } : { keys: { [provider]: v } }, 'Key saved');
        test(provider, kind);
      };
      fill(box, inp, h('button.btn.primary.sm', { on: { click: commitKey } }, 'Save key'),
        info ? h('button.btn.ghost.sm', { on: { click: () => { editing = false; paint(); } } }, 'Cancel') : null);
      if (!compact) setTimeout(() => inp.focus(), 30);
    };
    paint();
    return h('div', {}, box, url && (editing || !info) ? h('div.hint.ai-under', {}, 'No key yet? Get one at ', h('a', { href: url, target: '_blank', rel: 'noopener' }, new URL(url).host), '. Keys stay on this computer.') : null);
  }

  /** Provider cards + details for one service kind. */
  function servicePicker(kind, { allowOff = true } = {}) {
    const cat = SERVICES[kind];
    const c = cur[kind] || {};
    const cards = [];
    if (allowOff) cards.push(h(`button.ai-card${!c.provider ? '.on' : ''}`, { on: { click: () => c.provider && save({ [kind]: { provider: '' } }) } }, h('b', {}, 'Off'), h('span', {}, 'Don\'t use this.')));
    for (const [id, p] of Object.entries(cat)) {
      const missing = p.bin && cur.local && cur.local[id] === false;
      const tag = missing ? h('i.tag', {}, 'not installed') : !p.key ? h('i.tag.free', {}, 'free') : keyInfo(id, kind) ? h('i.tag.ok', {}, 'key ✓') : h('i.tag', {}, 'needs key');
      cards.push(h(`button.ai-card${c.provider === id ? '.on' : ''}`, { disabled: missing, on: { click: () => c.provider !== id && save({ [kind]: { provider: id } }) } },
        h('b', {}, p.name.replace(/ \(.*\)$/, ''), tag), h('span', {}, NOTES[kind]?.[id] || '')));
    }
    const p = cat[c.provider];
    const details = [];
    if (p) {
      if (p.key) details.push(h('div.ai-sec', {}, h('h6', {}, 'API key'), keyBox(c.provider, kind)));
      const need = [];
      const adv = [];
      const modelField = field(p.kind === 'piper' ? 'Voice file' : 'Model', c.model, {
        placeholder: p.model || p.modelHint || 'model name', onSave: (v) => save({ [kind]: { model: v } }),
        hint: p.kind === 'piper' ? 'Full path to a Piper .onnx voice (download voices from the Piper project).' : kind === 'llm' && !p.model ? 'Type the model name exactly as the provider lists it.' : `Leave empty for the default${p.model ? ` (${p.model})` : ''}.`,
      });
      ((kind === 'llm' && !p.model) || p.kind === 'piper' ? need : adv).push(modelField);
      if (kind === 'speech' && p.kind !== 'piper') {
        (p.kind === 'elevenlabs' ? need : adv).push(field('Voice', c.voice, { placeholder: p.voice || (p.voiceHint ? 'voice id' : ''), onSave: (v) => save({ [kind]: { voice: v } }), hint: p.voiceHint ? `The ${p.voiceHint}.` : 'Leave empty for the default voice.' }));
      }
      if (p.baseUrl !== undefined) (c.provider === 'custom' ? need : adv).push(field('Base URL', c.baseUrl, { placeholder: p.baseUrl || 'https://…/v1', onSave: (v) => save({ [kind]: { baseUrl: v } }) }));
      if (need.length) details.push(h('div.ai-sec', {}, h('h6', {}, 'Details'), ...need));
      if (adv.length) details.push(h('details.ai-adv', {}, h('summary', {}, 'Advanced'), ...adv));
    }
    return [h('div.ai-cards', {}, ...cards), ...details];
  }

  // ---------- pages ----------
  function overview() {
    const rows = ['agent', 'image', 'speech', 'transcribe'].map((k) => {
      const st = statusOf(k);
      return h('div.ai-row', {},
        h('div.ai-row-t', {}, h('b', {}, ABOUT[k][0]), h('span', {}, ABOUT[k][1])),
        pill(st),
        h('button.btn.sm', { on: { click: () => go(k) } }, st.level === 'off' ? 'Set up' : 'Change'));
    });
    const quick = h('input.in', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'sk-…', on: { keydown: (e) => { stop(e); if (e.key === 'Enter') useOpenAi(); } } });
    async function useOpenAi() {
      const v = quick.value.trim();
      if (!v) { quick.focus(); return; }
      const patch = { keys: { openai: v } };
      for (const k of ['image', 'speech', 'transcribe']) if (!cur[k]?.provider) patch[k] = { provider: 'openai' };
      await save(patch, 'OpenAI key saved');
      test('openai', 'image');
    }
    const kids = [h('h3', {}, 'What AI does in kadr'), h('div.ai-rows', {}, ...rows)];
    const off = ['image', 'speech', 'transcribe'].filter((k) => !cur[k]?.provider);
    const haveOpenAi = cur.keys?.openai?.saved || cur.keys?.openai?.env;
    if (off.length && haveOpenAi) {
      kids.push(h('div.ai-quick', {},
        h('b', {}, 'Your OpenAI key can do more'),
        h('span', {}, `It can also handle ${off.map((k) => ABOUT[k][0].toLowerCase()).join(' and ')}. One click turns ${off.length > 1 ? 'them' : 'it'} on.`),
        h('div', {}, h('button.btn.primary.sm', { on: { click: () => save(Object.fromEntries(off.map((k) => [k, { provider: 'openai' }])), 'Turned on') } }, 'Turn on'))));
    } else if (off.length) {
      kids.push(h('div.ai-quick', {},
        h('b', {}, 'Quick setup with one key'),
        h('span', {}, 'An OpenAI key can do images, voice and transcripts. Paste it once and every one that is off turns on.'),
        h('div.ai-keybox', {}, quick, h('button.btn.primary.sm', { on: { click: useOpenAi } }, 'Turn on')),
        testResult('openai'),
        h('div.hint', {}, 'No key? Get one at ', h('a', { href: KEYS.openai.url, target: '_blank', rel: 'noopener' }, 'platform.openai.com'), '. It is paid per use.')));
    }
    if (!cur.speech?.provider && cur.local?.espeak) {
      kids.push(h('div.ai-quick.free', {},
        h('b', {}, 'Free voice, no key'),
        h('span', {}, 'eSpeak runs on this computer. It sounds robotic, but it is fine for drafts and timing.'),
        h('div', {}, h('button.btn.sm', { on: { click: () => save({ speech: { provider: 'espeak' } }, 'Voice: eSpeak') } }, 'Use eSpeak'))));
    }
    return kids;
  }

  function agentPage() {
    const card = (k, a) => {
      const installed = cur.agents?.[k] !== false || k === 'custom';
      const tag = k === 'claude' ? h('i.tag.ok', {}, 'recommended') : k === 'api' ? h('i.tag', {}, 'your key') : k === 'custom' ? h('i.tag', {}, 'any CLI') : !installed ? h('i.tag', {}, 'not installed') : h('i.tag.ok', {}, 'installed');
      return h(`button.ai-card${cur.agent === k ? '.on' : ''}`, { disabled: !installed, on: { click: () => cur.agent !== k && save({ agent: k }) } },
        h('b', {}, a.name, tag), h('span', {}, installed ? a.note : `Install ${a.bin} and sign in once in a terminal, then reopen this window.`));
    };
    const entries = Object.entries(AGENTS);
    const ready = entries.filter(([k, a]) => a.bin && cur.agents?.[k] !== false);
    const missing = entries.filter(([k, a]) => a.bin && cur.agents?.[k] === false);
    const kids = [h('h3', {}, ABOUT.agent[0]),
      h('p.hint', {}, 'Who does the editing when you write in the chat. Agents already installed on this computer use their own login; no key needed here.'),
      h('div.ai-cards', {}, ...ready.map(([k, a]) => card(k, a)), card('api', AGENTS.api), card('custom', AGENTS.custom))];
    if (missing.length) {
      kids.push(h('details.ai-adv', {}, h('summary', {}, `Other agents kadr knows (${missing.length}, not installed here)`),
        h('div.ai-cards', {}, ...missing.map(([k, a]) => card(k, a)))));
    }
    const a = AGENTS[cur.agent];
    if (a?.run) {
      kids.push(h('div.ai-sec', {}, h('h6', {}, 'How kadr runs it'),
        h('code.ai-cmd', {}, [a.bin, ...a.run.limited.map((x) => (x === '{prompt}' ? '"<your message>"' : x))].join(' ')),
        h('div.hint.ai-under', {}, 'Once per message, in the project folder. Set the model inside that tool (its own settings or login).')));
    }
    if (cur.agent === 'claude') kids.push(claudeViaSection());
    if (cur.agent === 'api') kids.push(h('div.ai-sec', {}, h('h6', {}, 'Which model service'), ...servicePicker('llm', { allowOff: false })));
    if (cur.agent === 'custom') {
      const ok = cur.agents?.custom;
      kids.push(h('div.ai-sec', {}, h('h6', {}, 'Your agent'),
        field('Name', cur.custom?.name, { placeholder: 'e.g. My agent', onSave: (v) => save({ custom: { name: v } }) }),
        field('Command', cur.custom?.command, {
          placeholder: 'mycli -p {prompt}', onSave: (v) => save({ custom: { command: v } }),
          hint: 'kadr runs this in the project folder for every message and puts the message where {prompt} is (or at the end). Its printed output becomes the reply.',
        }),
        cur.custom?.command ? h(`div.ai-test.${ok ? 'ok' : 'bad'}`, {}, ok ? '✓ found the program' : '✕ the program was not found on this computer') : null));
    }
    return kids;
  }

  /** Claude Code on another Anthropic-compatible service (GLM, DeepSeek, Kimi…). */
  function claudeViaSection() {
    const v = cur.claudeVia || {};
    const cards = [h(`button.ai-card${!v.provider ? '.on' : ''}`, { on: { click: () => v.provider && save({ claudeVia: { provider: '' } }) } }, h('b', {}, 'Your Claude account'), h('span', {}, 'Claude Code as usual, with your Claude login.'))];
    for (const [id, p] of Object.entries(CLAUDE_VIA)) {
      cards.push(h(`button.ai-card${v.provider === id ? '.on' : ''}`, { on: { click: () => v.provider !== id && save({ claudeVia: { provider: id } }) } },
        h('b', {}, p.name, keyInfo(id, 'claudeVia') ? h('i.tag.ok', {}, 'key ✓') : h('i.tag', {}, 'needs key')),
        h('span', {}, id === 'custom' ? 'Any service with an Anthropic-compatible API.' : `Claude Code's tools, ${p.name}'s model. Usually much cheaper.`)));
    }
    const kids = [h('h6', {}, 'Model behind Claude Code'), h('div.ai-cards', {}, ...cards)];
    const p = CLAUDE_VIA[v.provider];
    if (p) {
      if (v.provider === 'custom') kids.push(field('Base URL', v.baseUrl, { placeholder: 'https://…/anthropic', onSave: (x) => save({ claudeVia: { baseUrl: x } }) }));
      kids.push(h('div.ai-sec', {}, h('h6', {}, 'API key'), keyBox(v.provider, 'claudeVia')));
      kids.push(h('details.ai-adv', {}, h('summary', {}, 'Advanced'),
        field('Model', v.model, { placeholder: p.model || 'service default', onSave: (x) => save({ claudeVia: { model: x } }), hint: 'Leave empty to let the service pick its default model.' })));
    }
    return h('div.ai-sec', {}, ...kids);
  }

  function servicePage(kind) {
    return [h('h3', {}, ABOUT[kind][0]), h('p.hint', {}, ABOUT[kind][1]), ...servicePicker(kind)];
  }

  /** Connect kadr (as an MCP server) to the user's own agents. */
  let conn = null;
  async function loadConn() { try { conn = await api('/api/connect'); } catch (e) { toast(e.message, true); } render(); }
  function connectPage() {
    const kids = [h('h3', {}, 'Use kadr from your own agents'),
      h('p.hint', {}, 'Connect once, then ask Claude Code, Codex, Gemini, Cursor… for a video right in their own chat or terminal. They create and edit kadr projects, look at frames and export, without this editor open. Nothing is sent anywhere: kadr just adds itself to that app\'s settings on this computer (with a backup).')];
    if (!conn) { kids.push(h('div.hint', {}, 'Checking your apps…')); if (conn === null) { conn = false; loadConn(); } return kids; }
    const busy = new Set();
    const row = (t) => {
      const btn = h(`button.btn.sm${t.connected ? '' : '.primary'}`, { disabled: !t.detected && !t.connected, on: { click: async () => {
        if (busy.has(t.id)) return;
        busy.add(t.id);
        btn.disabled = true;
        btn.textContent = t.connected ? 'Disconnecting…' : 'Connecting…';
        try { conn = await api('/api/connect', { id: t.id, on: !t.connected }); toast(t.connected ? `${t.name} disconnected` : `${t.name} connected: ask it for a video`); } catch (e) { toast(e.message, true); }
        render();
      } } }, t.connected ? 'Disconnect' : 'Connect');
      return h('div.ai-row', {},
        h('div.ai-row-t', {}, h('b', {}, t.name), h('span', {}, t.error || (t.detected ? t.how : 'Not found on this computer.'))),
        t.connected ? h('span.ai-pill.ok', {}, 'connected') : null, btn);
    };
    kids.push(h('div.ai-rows', {}, ...conn.targets.map(row)));
    kids.push(h('div.ai-sec', {}, h('h6', {}, 'Then, in that app'),
      h('div.ai-try', { dir: 'auto' }, 'یه ویدیوی ۳۰ ثانیه‌ای عمودی برای معرفی قهوه‌ی کادر بساز، توی ~/Videos/coffee', h('br'), 'Make a 30-second vertical promo for my café in ~/Videos/coffee'),
      h('div.hint.ai-under', {}, 'Restart the app (or start a new chat in it) after connecting so it loads kadr.')));
    kids.push(h('details.ai-adv', {}, h('summary', {}, 'Other apps (Windsurf, Qoder, Zed, LM Studio…)'),
      h('p.hint', {}, 'Any app that supports MCP servers can use kadr. Add this to its MCP settings:'),
      h('pre.ai-snippet', {}, conn.snippet),
      h('button.btn.sm', { on: { click: () => { navigator.clipboard?.writeText(conn.snippet); toast('Copied'); } } }, 'Copy')));
    return kids;
  }

  function keysPage() {
    const rows = Object.entries(KEYS).map(([id, meta]) => h('div.ai-keyrow', {},
      h('div.ai-row-t', {}, h('b', {}, meta.name), h('span', {}, `Used for: ${meta.uses}`)),
      keyBox(id, null, { compact: true })));
    return [h('h3', {}, 'API keys'), h('p.hint', {}, 'Each key is saved once and used by every service of that company. They are stored only on this computer, in a file only your user can read.'), ...rows,
      h('p.hint.ai-file', {}, cur.file)];
  }

  // ---------- layout ----------
  const nav = h('nav.ai-nav');
  const content = h('div.ai-page');
  function go(p) { page = p; render(); content.scrollTop = 0; }
  function render() {
    fill(nav, ...PAGES.map(([k, label]) => {
      const st = statusOf(k);
      return h(`button.ai-nav-item${page === k ? '.on' : ''}`, { on: { click: () => go(k) } }, h('span', {}, label), st ? h(`i.dot.${st.level}`) : null);
    }));
    fill(content, ...(page === 'overview' ? overview() : page === 'agent' ? agentPage() : page === 'keys' ? keysPage() : page === 'connect' ? connectPage() : servicePage(page)));
  }

  const modal = h('div.modal.ai', { on: { pointerdown: stop } },
    h('header', {}, 'AI settings', h('button.btn.ghost.icon.sm', { title: 'Close', on: { click: close } }, '✕')),
    h('div.ai-main', {}, nav, content),
    h('footer', {}, h('span.hint', {}, 'Changes are saved right away.'), h('div.grow'), h('button.btn.primary', { on: { click: close } }, 'Done')));
  render();
  back.replaceChildren(modal);
  back.hidden = false;
  back.onpointerdown = close;
  function close() { back.hidden = true; back.replaceChildren(); onSaved?.(); }
}
