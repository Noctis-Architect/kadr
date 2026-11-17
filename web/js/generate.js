// "Generate an image / a voice-over" dialog (AI menu). Calls the service set up
// in AI settings directly; the new file lands in media/gen/ and shows up in Media.
import { SERVICES } from '/shared/providers.js';
import { toast } from './state.js';
import { $, h, api } from './util.js';
import { openAiSettings } from './chat.js';

const back = $('#modal');
const close = () => { back.hidden = true; back.replaceChildren(); };

const SIZES = [['1536x1024', 'Wide 3:2'], ['1024x1024', 'Square'], ['1024x1536', 'Tall 2:3']];

export async function openGenerate(kind) {
  let st;
  try { st = await api('/api/settings'); } catch (e) { toast(e.message, true); return; }
  const svcKind = kind === 'image' ? 'image' : 'speech';
  const cfg = st[svcKind] || {};
  const p = SERVICES[svcKind][cfg.provider];
  const hasKey = !p?.key || st.keys?.[cfg.provider]?.saved || st.keys?.[cfg.provider]?.env || cfg.keySaved;
  const title = kind === 'image' ? 'Generate an image' : 'Generate a voice-over';
  const stop = (e) => e.stopPropagation();

  if (!p || !hasKey) {
    back.replaceChildren(h('div.modal.gen', { on: { pointerdown: stop } },
      h('header', {}, title),
      h('div.body', {}, h('p.hint', {}, !p
        ? `No ${kind === 'image' ? 'image' : 'voice'} service is set up yet. Pick one in AI settings${kind === 'speech' ? ' (eSpeak works offline for free)' : ''}.`
        : `${p.name} needs an API key. Add it in AI settings.`)),
      h('footer', {}, h('button.btn', { on: { click: close } }, 'Cancel'),
        h('button.btn.primary', { on: { click: () => { close(); openAiSettings(null, svcKind); } } }, 'Open AI settings'))));
    back.hidden = false;
    back.onpointerdown = close;
    return;
  }

  let size = SIZES[0][0];
  const input = h('textarea.in', { rows: 4, dir: 'auto', placeholder: kind === 'image' ? 'Describe the picture: subject, place, light, style…' : 'The words to say…', on: { keydown: stop } });
  const voice = h('input.in', { value: cfg.voice || p.voice || '', placeholder: 'default', spellcheck: false, on: { keydown: stop } });
  const seg = h('div.seg-pick', {}, ...SIZES.map(([v, t]) => h(`button${v === size ? '.on' : ''}`, { on: { click: (e) => { size = v; for (const b of seg.children) b.classList.toggle('on', b === e.currentTarget); } } }, t)));
  const status = h('div.hint');
  const go = h('button.btn.primary', { on: { click: run } }, 'Generate');

  async function run() {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    go.disabled = true;
    status.textContent = kind === 'image' ? 'Making the image… this can take up to a minute.' : 'Making the voice-over…';
    try {
      const r = await api('/api/gen', kind === 'image' ? { kind, prompt: text, size } : { kind, text, voice: voice.value.trim() || undefined });
      toast(`Added ${r.path.split('/').pop()} to Media`);
      close();
    } catch (e) {
      status.textContent = '';
      toast(e.message, true);
      go.disabled = false;
    }
  }

  back.replaceChildren(h('div.modal.gen', { on: { pointerdown: stop } },
    h('header', {}, title, h('span.hint', {}, `${p.name}${cfg.model ? ` · ${cfg.model}` : ''}`)),
    h('div.body', {},
      input,
      kind === 'image' ? h('div.f', {}, h('label.static', {}, 'Shape'), seg) : null,
      kind === 'speech' && p.kind !== 'piper' ? h('div.f', {}, h('label.static', {}, 'Voice'), voice) : null,
      h('p.hint', {}, 'The file is saved in media/gen/ and appears in Media, ready to drag onto the timeline. This uses your API credits.'),
      status),
    h('footer', {}, h('button.btn', { on: { click: close } }, 'Cancel'), go)));
  back.hidden = false;
  back.onpointerdown = () => { if (!go.disabled) close(); };
  setTimeout(() => input.focus(), 50);
}
