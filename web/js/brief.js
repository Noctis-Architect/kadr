// "New video from a brief": a short guided form (what kind of video, what it
// is about, files, website, format and style). It saves brief/brief.json and
// hands the job to the chat agent, which follows the video-from-brief skill:
// reads everything, researches the website, asks only what is missing, builds.
import { S, toast } from './state.js';
import { $, h, api, upload } from './util.js';
import { sendChat } from './chat.js';

const back = $('#modal');
const close = () => { back.hidden = true; back.replaceChildren(); };

const KINDS = [
  ['promo', 'Product or business promo', 'Introduce a product, shop, app or service. Give photos, a description or just the website.'],
  ['lyrics', 'Music / lyric video', 'A song with its words animated in time. Give the song and the lyrics.'],
  ['slideshow', 'Photo slideshow', 'Photos (and clips) to music: trips, events, portfolios, memories.'],
  ['explainer', 'Explainer with voice-over', 'From a text or idea: voice, pictures and captions, no filming.'],
  ['short', 'Social short', 'Reels, Shorts, TikTok: fast, vertical, captioned.'],
  ['youtube', 'YouTube video', 'Edit your footage into a full YouTube video.'],
  ['other', 'Something else', 'Describe it and the agent figures out the rest.'],
];
const FORMATS = [['16:9', 'YouTube / web', 1920, 1080], ['9:16', 'Reels / Shorts / TikTok', 1080, 1920], ['4:5', 'Instagram feed', 1080, 1350], ['1:1', 'Square', 1080, 1080]];
const TONES = ['Energetic', 'Calm', 'Luxury', 'Fun', 'Professional', 'Emotional', 'Minimal'];
const LENGTHS = [['15', '15 s'], ['30', '30 s'], ['60', '1 min'], ['auto', 'Fits the content']];

export function openBrief(startKind = '') {
  const isPersianUi = /^fa/i.test(navigator.language || '');
  const b = {
    kind: startKind || '', name: '', description: '', audience: '', message: '', cta: '', website: '',
    artist: '', song: '', lyrics: '', format: '16:9', length: 'auto', tone: [], colors: ['', ''], language: isPersianUi ? 'Persian' : 'English',
    voiceover: 'none', files: [], music: '', notes: '',
  };
  let step = b.kind ? 1 : 0;
  let site = null;
  let siteBusy = false;
  const ups = new Map(); // name -> progress
  const stop = (e) => e.stopPropagation();
  const body = h('div.body.bf-body');
  const foot = h('footer');
  const dots = h('div.bf-steps');
  const STEPS = ['Kind', 'About it', 'Format & style', 'Review'];

  const field = (label, el, hint) => h('div.bf-f', {}, h('label', {}, label), el, hint ? h('div.hint', {}, hint) : null);
  const text = (key, ph, { area = false, rows = 3 } = {}) => {
    const el = h(area ? 'textarea.in' : 'input.in', { value: b[key], placeholder: ph, dir: 'auto', rows: area ? rows : null, spellcheck: false, on: { input: () => { b[key] = el.value; }, keydown: stop } });
    if (area) el.value = b[key];
    return el;
  };
  const chips = (opts, get, set, multi = false) => h('div.bf-chips', {}, ...opts.map(([v, t]) => {
    const on = multi ? get().includes(v) : get() === v;
    return h(`button.chip${on ? '.on' : ''}`, { on: { click: () => { set(v); render(); } } }, t);
  }));

  async function addFiles(list, kind) {
    for (const f of list) {
      ups.set(f.name, 0);
      render();
      try {
        const r = await upload(f, (p) => { ups.set(f.name, p); }, 'brief');
        if (kind === 'music') b.music = r.path; else b.files.push(r.path);
      } catch { toast(`Could not add ${f.name}`, true); }
      ups.delete(f.name);
      render();
    }
  }
  const picker = (accept, kind, label) => {
    const inp = h('input', { type: 'file', multiple: kind !== 'music', accept, hidden: true, on: { change: () => addFiles([...inp.files], kind) } });
    return h('span', {}, inp, h('button.btn.sm', { on: { click: () => inp.click() } }, label));
  };

  async function readSite() {
    if (!b.website.trim()) return;
    siteBusy = true;
    render();
    try { site = await api('/api/site', { url: b.website.trim(), images: 8 }); } catch (e) { site = null; toast(e.message, true); }
    siteBusy = false;
    if (site) {
      if (!b.name) b.name = site.product?.name || site.siteName || '';
      if (!b.description) b.description = site.product?.description || site.description || '';
      if (!b.colors[0] && /^#[0-9a-f]{6}$/i.test(site.themeColor || '')) b.colors[0] = site.themeColor;
    }
    render();
  }

  // ---------- steps ----------
  function kindStep() {
    return [h('h3', {}, 'What do you want to make?'), h('p.hint', {}, 'Pick the closest one. The agent uses the matching playbook.'),
      h('div.bf-kinds', {}, ...KINDS.map(([v, t, d]) => h(`button.bf-kind${b.kind === v ? '.on' : ''}`, { on: { click: () => { b.kind = v; step = 1; render(); } } }, h('b', {}, t), h('span', {}, d))))];
  }

  function aboutStep() {
    const kids = [h('h3', {}, 'Tell us about it'), h('p.hint', {}, 'Write as much or as little as you like, in any language. Missing details? The agent asks.')];
    if (b.kind === 'lyrics') {
      kids.push(h('div.bf-row', {}, field('Song title', text('song', 'Song name')), field('Artist', text('artist', 'Singer / band'))));
      kids.push(field('The song', h('div.bf-files', {}, b.music ? h('span.bf-file', {}, `♪ ${b.music.split('/').pop()}`) : h('span.hint', {}, 'An audio file (mp3, wav…). kadr never downloads music.'), picker('audio/*,video/*', 'music', b.music ? 'Change' : 'Add song'))));
      kids.push(field('Lyrics', text('lyrics', 'One line per sung line. Mark key words *like this*.', { area: true, rows: 7 }), 'Leave empty to transcribe the song (then check the words).'));
    } else {
      kids.push(field(b.kind === 'promo' ? 'Product / business name' : 'Title', text('name', b.kind === 'promo' ? 'e.g. Kadr Coffee' : 'What is it called?')));
      kids.push(field('What is it about?', text('description', b.kind === 'promo' ? 'What it is, what makes it special, prices or offers, who it is for…' : 'The story, the idea, the text for the voice-over…', { area: true, rows: 4 })));
    }
    if (b.kind === 'promo' || b.kind === 'other' || b.kind === 'explainer' || b.kind === 'short') {
      const url = text('website', 'https://…');
      kids.push(field('Website (optional)', h('div.bf-site', {}, url, h('button.btn.sm', { disabled: siteBusy, on: { click: readSite } }, siteBusy ? 'Reading…' : 'Read it')),
        'kadr reads the page: text, product facts, brand color and photos.'));
      if (site) {
        kids.push(h('div.bf-sitecard', {},
          h('b', {}, site.title || site.siteName), site.description ? h('span', {}, site.description) : null,
          site.product?.price ? h('span', {}, `Price on the page: ${site.product.price}`) : null,
          h('div.bf-thumbs', {}, ...site.images.slice(0, 8).map((i) => h('div.bf-th', { title: i.path, style: { backgroundImage: `url("/p/${i.path.split('/').map(encodeURIComponent).join('/')}")` } }))),
          h('span.hint', {}, `${site.images.length} image(s) saved to media/site/. Notes: ${site.summaryFile}`)));
      }
    }
    kids.push(field(b.kind === 'lyrics' ? 'Pictures or footage (optional)' : 'Photos, videos, logo', h('div.bf-files', {},
      ...b.files.map((f, i) => h('span.bf-file', {}, f.split('/').pop(), h('button', { title: 'Remove', on: { click: () => { b.files.splice(i, 1); render(); } } }, '×'))),
      ...[...ups.keys()].map((n) => h('span.bf-file.up', {}, `${n}…`)),
      picker('image/*,video/*', 'files', 'Add files')),
    b.kind === 'lyrics' ? 'None? The agent finds matching free footage or generates pictures.' : 'None? The agent uses the website\'s photos, free stock footage, or generated pictures.'));
    if (b.kind !== 'lyrics') {
      kids.push(h('div.bf-row', {}, field('Main message', text('message', 'The one thing people should remember')), field('Call to action', text('cta', 'e.g. Order at kadr.shop'))));
      kids.push(field('Music', h('div.bf-files', {}, b.music ? h('span.bf-file', {}, `♪ ${b.music.split('/').pop()}`, h('button', { on: { click: () => { b.music = ''; render(); } } }, '×')) : h('span.hint', {}, 'Optional. Without it, the video has no music or only a voice-over.'), picker('audio/*', 'music', b.music ? 'Change' : 'Add music'))));
    }
    return kids;
  }

  function styleStep() {
    return [h('h3', {}, 'Format & style'),
      field('Where will it be shown?', h('div.bf-chips', {}, ...FORMATS.map(([v, t]) => h(`button.chip${b.format === v ? '.on' : ''}`, { on: { click: () => { b.format = v; render(); } } }, `${v} · ${t}`)))),
      field('Length', chips(LENGTHS, () => b.length, (v) => { b.length = v; })),
      field('Mood (pick any)', chips(TONES.map((t) => [t, t]), () => b.tone, (v) => { b.tone = b.tone.includes(v) ? b.tone.filter((x) => x !== v) : [...b.tone, v]; }, true)),
      field('Brand colors (optional)', h('div.bf-colors', {}, ...[0, 1].map((i) => {
        const c = h('input', { type: 'color', value: b.colors[i] || (i ? '#111111' : '#e8ff59'), on: { input: () => { b.colors[i] = c.value; render(); } } });
        return h('label.bf-color', {}, c, h('span', {}, b.colors[i] || (i ? 'second (none)' : 'main (none)')));
      }), b.colors.some(Boolean) ? h('button.btn.ghost.sm', { on: { click: () => { b.colors = ['', '']; render(); } } }, 'Clear') : null)),
      h('div.bf-row', {},
        field('Language of the text', chips([['Persian', 'فارسی'], ['English', 'English'], ['Other', 'Other']], () => b.language, (v) => { b.language = v; })),
        b.kind === 'lyrics' ? null : field('Voice-over', chips([['none', 'None'], ['generate', 'Generate one'], ['mine', 'I\'ll record it']], () => b.voiceover, (v) => { b.voiceover = v; }))),
      field('Anything else?', text('notes', 'Things to include or avoid, examples you like, deadline…', { area: true, rows: 2 }))];
  }

  function reviewStep() {
    const k = KINDS.find((x) => x[0] === b.kind);
    const rows = [
      ['Kind', k?.[1]], ['Name', b.name || b.song], ['Artist', b.artist], ['About', b.description], ['Lyrics', b.lyrics && `${b.lyrics.split('\n').filter(Boolean).length} lines`],
      ['Website', b.website], ['Files', b.files.length ? `${b.files.length} file(s)` : ''], ['Music', b.music.split('/').pop()],
      ['Message', b.message], ['Call to action', b.cta], ['Format', `${b.format}, ${LENGTHS.find((x) => x[0] === b.length)?.[1]}`],
      ['Mood', b.tone.join(', ')], ['Colors', b.colors.filter(Boolean).join(' ')], ['Text language', b.language], ['Voice-over', b.kind === 'lyrics' ? '' : b.voiceover], ['Notes', b.notes],
    ].filter(([, v]) => v);
    return [h('h3', {}, 'Ready?'), h('p.hint', {}, 'The agent reads all of this, looks at your files, asks only what is missing, shows a short plan and builds the video in this project. You can undo every step from the chat.'),
      h('div.bf-review', {}, ...rows.flatMap(([kk, v]) => [h('b', {}, kk), h('span', { dir: 'auto' }, v)])),
      S.project?.clips?.length ? h('p.hint.bf-warn', {}, 'This project already has clips. The agent builds next to them; start a new project (File → New project) for a clean start.') : null];
  }

  async function create() {
    const fmt = FORMATS.find((f) => f[0] === b.format);
    const brief = {
      kind: b.kind, name: b.name || undefined, song: b.song || undefined, artist: b.artist || undefined, description: b.description || undefined,
      lyrics: b.lyrics || undefined, website: b.website || undefined, files: b.files, music: b.music || undefined,
      message: b.message || undefined, callToAction: b.cta || undefined,
      format: { aspect: b.format, width: fmt[2], height: fmt[3], platform: fmt[1] }, length: b.length === 'auto' ? 'fits the content' : `${b.length} s`,
      mood: b.tone, brandColors: b.colors.filter(Boolean), textLanguage: b.language,
      voiceover: b.kind === 'lyrics' ? undefined : b.voiceover, notes: b.notes || undefined,
      websiteNotes: site?.summaryFile, websiteImages: site?.images?.map((i) => i.path),
    };
    try {
      await api('/api/brief', { brief });
    } catch (e) { toast(e.message, true); return; }
    close();
    const fa = b.language === 'Persian' || isPersianUi;
    const msg = fa
      ? 'یه ویدیو از روی بریف بساز. همه‌ی اطلاعات توی brief/brief.json هست. اول skill «video-from-brief» رو بخون و دنبال کن: همه‌ی فایل‌ها و سایت رو ببین، فقط اگه چیزی واقعاً لازمه بپرس، یه برنامه‌ی کوتاه بگو و بعد بساز.'
      : 'Make a video from the brief in brief/brief.json. Read the "video-from-brief" skill first and follow it: look at every file and the website, ask only what is really missing, show a short plan, then build.';
    document.querySelector('.tab[data-tab="chat"]')?.click();
    await sendChat(msg);
  }

  // ---------- frame ----------
  function render() {
    dots.replaceChildren(...STEPS.map((t, i) => h(`button.bf-dot${i === step ? '.on' : i < step ? '.done' : ''}`, { disabled: i > step || (i > 0 && !b.kind), on: { click: () => { step = i; render(); } } }, `${i + 1}. ${t}`)));
    body.replaceChildren(...[kindStep, aboutStep, styleStep, reviewStep][step]().filter(Boolean));
    const busy = ups.size > 0 || siteBusy;
    foot.replaceChildren(...[
      step > 0 ? h('button.btn', { on: { click: () => { step--; render(); } } }, 'Back') : h('span'),
      h('div.grow'),
      busy ? h('span.hint', {}, 'Uploading…') : null,
      step === 0 ? null : step < 3 ? h('button.btn.primary', { disabled: busy, on: { click: () => { step++; render(); } } }, 'Next') : h('button.btn.primary', { disabled: busy, on: { click: create } }, 'Create the video'),
    ].filter(Boolean));
  }

  back.replaceChildren(h('div.modal.bf', { on: { pointerdown: stop } },
    h('header', {}, h('span', {}, 'New video from a brief'), h('button.btn.ghost.icon.sm', { title: 'Close', on: { click: close } }, '✕')),
    dots, body, foot));
  back.hidden = false;
  back.onpointerdown = () => { if (!ups.size) close(); };
  render();
}
