// "AI settings" dialog: which agent the chat runs, and the API services
// (model API, images, voice, transcripts) kadr may call with the user's keys.
// Keys go to the server once and are never sent back (only "••••1234").
import { AGENTS, SERVICES } from '/shared/providers.js';
import { toast } from './state.js';
import { $, h, api } from './util.js';

const back = $('#modal');

const SECTIONS = [
  ['image', 'Images', 'Lets the agent make pictures for backgrounds, B-roll and thumbnails (kadr gen image).'],
  ['speech', 'Voice', 'Text to speech for voice-overs (kadr gen speech).'],
  ['transcribe', 'Transcripts', 'Speech to text with word timing, for captions and cutting by words (kadr gen transcribe).'],
];

export async function openAiSettings(onSaved) {
  let cur;
  try { cur = await api('/api/settings'); } catch (e) { toast(e.message, true); return; }
  const draft = { agent: cur.agent };
  for (const k of Object.keys(SERVICES)) draft[k] = { provider: cur[k]?.provider || '', model: cur[k]?.model || '', baseUrl: cur[k]?.baseUrl || '', voice: cur[k]?.voice || '', key: '', clearKey: false };

  const stop = (e) => e.stopPropagation();

  /** Fields for one service: provider, model, voice, base URL, key. */
  function serviceFields(kind, { allowOff = true } = {}) {
    const cat = SERVICES[kind];
    const d = draft[kind];
    const box = h('div.ai-fields');
    const paint = () => {
      const p = cat[d.provider];
      const kids = [];
      const sel = h('select.in', { on: { change: () => { d.provider = sel.value; d.model = ''; d.baseUrl = ''; d.voice = ''; d.key = ''; d.clearKey = false; paint(); } } },
        ...(allowOff ? [h('option', { value: '' }, 'Off')] : []),
        ...Object.entries(cat).map(([k, v]) => {
          const missing = v.bin && cur.local && cur.local[k] === false;
          return h('option', { value: k, disabled: missing }, `${v.name}${missing ? ' (not installed)' : ''}`);
        }));
      sel.value = d.provider;
      kids.push(h('div.f', {}, h('label.static', {}, 'Service'), sel));
      if (p) {
        const input = (field, label, ph, list) => {
          const i = h('input.in', { value: d[field] || '', placeholder: ph || '', spellcheck: false, list: list || null, on: { input: () => { d[field] = i.value; }, keydown: stop } });
          return h('div.f', {}, h('label.static', {}, label), i);
        };
        const listId = `ai-${kind}-models`;
        kids.push(input('model', p.kind === 'piper' ? 'Voice file' : 'Model', p.model || p.modelHint || (kind === 'llm' ? 'model name, e.g. from the provider\'s docs' : ''), p.models ? listId : null));
        if (p.models) kids.push(h('datalist', { id: listId }, ...p.models.map((m) => h('option', { value: m }))));
        if (kind === 'speech' && p.kind !== 'piper') kids.push(input('voice', 'Voice', p.voice || p.voiceHint || ''));
        if (p.baseUrl !== undefined && (d.provider === 'custom' || d.provider === 'ollama' || d.baseUrl)) kids.push(input('baseUrl', 'Base URL', p.baseUrl || 'https://…/v1'));
        if (p.key) {
          const saved = cur[kind]?.provider === d.provider && !d.clearKey ? cur[kind]?.keySaved : '';
          const env = cur[kind]?.provider === d.provider && cur[kind]?.keyFromEnv;
          const k = h('input.in', { type: 'password', autocomplete: 'off', spellcheck: false, value: d.key, placeholder: saved ? `saved ${saved}  (type to replace)` : env ? 'using the key from your environment' : 'paste your API key', on: { input: () => { d.key = k.value; }, keydown: stop } });
          const row = h('div.ai-key', {}, k,
            saved ? h('button.btn.ghost.sm', { title: 'Forget the saved key', on: { click: () => { d.clearKey = true; d.key = ''; paint(); } } }, 'Remove') : null);
          kids.push(h('div.f', {}, h('label.static', {}, 'API key'), row));
          if (p.keyUrl) kids.push(h('div.hint.ai-link', {}, 'Get a key: ', h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, new URL(p.keyUrl).host)));
        }
      }
      box.replaceChildren(...kids);
    };
    paint();
    return box;
  }

  const llmBox = h('div');
  const agentList = h('div.ai-agents');
  const paintAgents = () => {
    agentList.replaceChildren(...Object.entries(AGENTS).map(([k, a]) => {
      const installed = cur.agents?.[k] !== false;
      return h(`button.ai-agent${draft.agent === k ? '.on' : ''}`, { disabled: !installed, on: { click: () => { draft.agent = k; paintAgents(); } } },
        h('b', {}, a.name), h('span', {}, installed ? a.note : `${a.bin} is not installed`));
    }));
    llmBox.hidden = draft.agent !== 'api';
  };
  llmBox.append(h('div.ai-sub', {}, 'Model API'), serviceFields('llm', { allowOff: false }));
  if (!draft.llm.provider) draft.llm.provider = 'anthropic';
  paintAgents();

  const saveBtn = h('button.btn.primary', { on: { click: save } }, 'Save');
  const modal = h('div.modal.ai', { on: { pointerdown: stop } },
    h('header', {}, 'AI settings'),
    h('div.body', {},
      h('section', {}, h('h6', {}, 'Chat agent'), h('p.hint', {}, 'Who does the editing when you write in the chat.'), agentList, llmBox),
      ...SECTIONS.map(([k, title, note]) => h('section', {}, h('h6', {}, title), h('p.hint', {}, note), serviceFields(k))),
      h('p.hint.ai-file', {}, `Saved for all projects in ${cur.file} (only your user can read it). Keys are never put in a project folder.`)),
    h('footer', {}, h('div.grow'), h('button.btn', { on: { click: close } }, 'Cancel'), saveBtn));

  back.replaceChildren(modal);
  back.hidden = false;
  back.onpointerdown = close;

  function close() { back.hidden = true; back.replaceChildren(); }

  async function save() {
    const body = { agent: draft.agent };
    for (const k of Object.keys(SERVICES)) {
      const d = draft[k];
      body[k] = { provider: d.provider, model: d.model, baseUrl: d.baseUrl, voice: d.voice, ...(d.key ? { key: d.key } : {}), ...(d.clearKey ? { clearKey: true } : {}) };
    }
    saveBtn.disabled = true;
    try {
      await api('/api/settings', body);
      toast('Settings saved');
      close();
      onSaved?.();
    } catch (e) { toast(e.message, true); saveBtn.disabled = false; }
  }
}
