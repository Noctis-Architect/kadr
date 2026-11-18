// Interactive pieces. Each one starts only if its element is on the page.
import { $, $$, h, T, toast, fine, still } from './site.js';

const lang = () => document.documentElement.dataset.lang;
const sleep = (ms) => new Promise((r) => setTimeout(r, still ? 0 : ms));
const tc = (s, fps = 30) => {
  const f = Math.max(0, Math.round(s * fps));
  const p = (n) => String(n).padStart(2, '0');
  return `00:${p(Math.floor(f / (fps * 60)) % 60)}:${p(Math.floor(f / fps) % 60)}:${p(f % fps)}`;
};

/* =====================================================================
   1. Chat → timeline (home)
   ===================================================================== */
function chatDemo(box) {
  const log = $('.demo-log', box), input = $('.fake-in span', box), screen = $('.screen', box);
  const lanes = { t: $('[data-lane="t"]', box), c: $('[data-lane="c"]', box), v: $('[data-lane="v"]', box), a: $('[data-lane="a"]', box) };
  const ruler = $('.tl-ruler', box), head = $('.tl-head', box), now = $('.now', box), dur = $('.dur', box), playBtn = $('.play', box);
  const cap = $('.cap', screen), title = $('.title', screen);
  let S, busy = false, playing = false, t = 0, rafId = 0;
  const fresh = () => ({ dur: 12, v: [{ s: 0, e: 12, label: 'talk.mp4' }], a: [{ s: 0, e: 12, label: 'talk.mp4' }], c: [], t: [], gaps: [], vertical: false, captions: false, title: '' });
  const history = [];

  const WORDS = 'so here is the thing every word you say becomes a caption and it lands exactly on time'.split(' ');
  function paint() {
    const D = S.dur;
    ruler.innerHTML = Array.from({ length: Math.floor(D / 2) + 1 }, (_, i) => `<span style="left:${(i * 2 / D) * 100}%">${i * 2}s</span>`).join('');
    for (const k of ['t', 'c', 'v', 'a']) {
      const keep = new Map($$('.clip', lanes[k]).map((el) => [el.dataset.key, el]));
      const list = [...S[k], ...(k === 'v' || k === 'a' ? S.gaps.map((g) => ({ ...g, gap: true })) : [])];
      const seen = new Set();
      list.forEach((c, i) => {
        const key = c.key || `${k}${i}`;
        seen.add(key);
        let el = keep.get(key);
        if (!el) { el = h(`<div class="clip ${c.gap ? 'gap' : k} new"></div>`); el.dataset.key = key; lanes[k].append(el); }
        el.textContent = c.gap ? '' : c.label;
        el.style.left = `${(c.s / D) * 100}%`;
        el.style.width = `calc(${((c.e - c.s) / D) * 100}% - 3px)`;
      });
      for (const [key, el] of keep) if (!seen.has(key)) { el.style.opacity = 0; setTimeout(() => el.remove(), 400); }
    }
    screen.classList.toggle('vertical', S.vertical);
    cap.classList.toggle('on', S.captions);
    dur.textContent = tc(S.dur);
    setT(Math.min(t, S.dur));
  }
  function setT(x) {
    t = x;
    head.style.left = `calc((100% - 34px - 32px) * ${t / S.dur} + 16px)`;
    now.textContent = tc(t);
    if (S.captions) {
      const i = Math.floor((t / S.dur) * WORDS.length * 1.0) % WORDS.length;
      const w = WORDS.slice(Math.max(0, i - 2), i + 2);
      cap.innerHTML = w.map((x, k) => (k === Math.min(2, i) ? `<b>${x}</b>` : x)).join(' ');
    }
  }
  function play(on = !playing) {
    playing = on;
    playBtn.classList.toggle('on', on);
    screen.classList.toggle('paused', !on);
    cancelAnimationFrame(rafId);
    if (!on) return;
    let last = performance.now();
    const step = (n) => {
      if (!playing) return;
      let x = t + (n - last) / 1000; last = n;
      if (x >= S.dur) x = 0;
      setT(x);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }
  playBtn.onclick = () => play();
  $('.tl', box).addEventListener('pointerdown', (e) => {
    const r = $('.tl-lane', box).getBoundingClientRect();
    setT(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * S.dur);
  });

  const say = (cls, html, dir) => { const el = h(`<div class="${cls}"${dir ? ` dir="${dir}"` : ''}>${html}</div>`); log.append(el); log.scrollTop = 1e9; return el; };
  async function step(en, fa, ms = 650) {
    const el = say('step run', `<span class="ic"></span><span>${lang() === 'fa' ? fa : en}</span>`);
    await sleep(ms);
    el.classList.replace('run', 'done');
    return el;
  }
  async function typeIn(text) {
    input.classList.add('typing');
    input.textContent = '';
    input.dir = lang() === 'fa' ? 'rtl' : 'ltr';
    for (const ch of text) { input.textContent += ch; await sleep(18 + Math.random() * 26); }
    await sleep(250);
    input.classList.remove('typing');
    input.textContent = '';
    say('msg-u', text, lang() === 'fa' ? 'rtl' : 'ltr');
  }

  const RECIPES = {
    silences: async () => {
      await step('Read project.json and the playhead', 'project.json و جای پلی‌هد رو خوندم');
      await step('<b>kadr silence</b> media/talk.mp4 → 3 silent ranges', '<b>kadr silence</b> media/talk.mp4 ← ۳ جای ساکت');
      S.gaps = [{ s: 2.4, e: 3.4, key: 'g1' }, { s: 5.6, e: 6.7, key: 'g2' }, { s: 8.6, e: 9.8, key: 'g3' }];
      paint();
      await sleep(700);
      await step('Split at 6 points, ripple-deleted the gaps', 'توی ۶ نقطه برش زدم و فاصله‌ها رو بستم');
      const cuts = [[0, 2.4], [3.4, 5.6], [6.7, 8.6], [9.8, 12]];
      let pos = 0;
      S.v = cuts.map(([s, e], i) => { const c = { s: pos, e: pos + (e - s), label: 'talk.mp4', key: `v${i}` }; pos = c.e; return c; });
      S.a = S.v.map((c, i) => ({ ...c, key: `a${i}` }));
      S.gaps = []; S.dur = Math.ceil(pos);
      paint();
      await step('Looked at frames 00:02 and 00:05: cuts are clean', 'فریم‌های ۰۰:۰۲ و ۰۰:۰۵ رو نگاه کردم؛ برش‌ها تمیزن');
      return ['Done: 3.3 s of silence removed, 12 s → 8.7 s.', 'تموم شد: ۳٫۳ ثانیه سکوت حذف شد، از ۱۲ به ۸٫۷ ثانیه.'];
    },
    captions: async () => {
      await step('<b>kadr gen transcribe</b> media/talk.mp4 → 18 words, timed', '<b>kadr gen transcribe</b> ← ۱۸ کلمه با زمان دقیق');
      await step('Added @kadr/captions.html on V3, word highlight', 'کامپوزیشن زیرنویس رو روی V3 گذاشتم، با هایلایت کلمه');
      S.c = [{ s: 0, e: S.dur, label: '✦ Captions · word by word', key: 'cap' }];
      S.captions = true;
      paint(); play(true);
      await step('Checked frame 00:00:03:12: inside title-safe', 'فریم ۰۰:۰۰:۰۳:۱۲ رو چک کردم؛ توی محدوده‌ی امنه');
      return ['Captions are on, timed to every word.', 'زیرنویس اضافه شد، هم‌زمان با تک‌تک کلمه‌ها.'];
    },
    reels: async () => {
      await step('Sequence → 1080×1920 (9:16)', 'سکانس ← ۱۰۸۰×۱۹۲۰ (۹:۱۶)');
      S.vertical = true; paint();
      await sleep(500);
      await step('Reframed the speaker: fit cover, x −12%', 'سوژه رو دوباره کادر کردم: cover، x −۱۲٪');
      await step('Moved captions into the safe area', 'زیرنویس رو بردم توی محدوده‌ی امن');
      return ['Vertical cut ready for Reels, Shorts and TikTok.', 'نسخه‌ی عمودی برای ریلز، شورتس و تیک‌تاک آماده‌ست.'];
    },
    title: async () => {
      await step('Wrote comps/title.html (typewriter, 2.5 s)', 'comps/title.html رو نوشتم (تایپ‌رایتر، ۲٫۵ ثانیه)');
      await step('<b>kadr lint</b> comps/title.html → no problems', '<b>kadr lint</b> ← مشکلی نداره');
      S.t = [{ s: 0, e: 2.5, label: '✦ Title · typewriter', key: 'ttl' }];
      paint();
      const text = 'Launch day';
      title.style.setProperty('--rule', 1);
      for (let i = 1; i <= text.length; i++) { title.innerHTML = `${text.slice(0, i)}<span class="caret"></span>`; await sleep(70); }
      S.title = text;
      await step('Placed it at 00:00 on V2', 'گذاشتمش روی V2 از ثانیه‌ی صفر');
      return ['Title added. Want a different font or color?', 'تایتل اضافه شد. فونت یا رنگ دیگه‌ای می‌خوای؟'];
    },
  };
  const PROMPTS = {
    silences: ['Cut the silences out of talk.mp4', 'سکوت‌های talk.mp4 رو حذف کن'],
    captions: ['Add word-by-word captions', 'زیرنویس کلمه‌به‌کلمه بذار'],
    reels: ['Make a vertical cut for Reels', 'یه نسخه‌ی عمودی برای ریلز بساز'],
    title: ['Add a title that types in', 'یه تایتل تایپ‌شونده بذار'],
  };
  async function run(key, chip) {
    if (busy) return;
    busy = true;
    $$('.chip', box).forEach((c) => { c.disabled = true; });
    history.push(structuredClone(S));
    const [en, fa] = PROMPTS[key];
    await typeIn(lang() === 'fa' ? fa : en);
    const [den, dfa] = await RECIPES[key]();
    const m = say('msg-a', `<span>${lang() === 'fa' ? dfa : den}</span><button>${lang() === 'fa' ? 'برگردون' : 'Undo'}</button>`, lang() === 'fa' ? 'rtl' : 'ltr');
    chip.dataset.used = 1;
    $('button', m).onclick = () => {
      const prev = history.pop();
      if (!prev) return;
      S = prev;
      if (!S.title) { title.innerHTML = ''; title.style.setProperty('--rule', 0); }
      paint();
      m.remove();
      delete chip.dataset.used;
      chip.disabled = false;
      say('step done', `<span class="ic"></span><span>${lang() === 'fa' ? 'به نقطه‌ی قبل برگشت' : 'Restored the checkpoint'}</span>`);
    };
    busy = false;
    $$('.chip', box).forEach((c) => { c.disabled = !!c.dataset.used; });
  }
  $$('.chip', box).forEach((c) => c.addEventListener('click', () => run(c.dataset.r, c)));
  $('.reset', box)?.addEventListener('click', () => { S = fresh(); history.length = 0; log.innerHTML = ''; title.innerHTML = ''; title.style.setProperty('--rule', 0); $$('.chip', box).forEach((c) => { c.disabled = false; delete c.dataset.used; }); paint(); });
  S = fresh();
  paint();
  // start a recipe by itself when the demo first comes into view
  const auto = () => {
    const r = box.getBoundingClientRect();
    if (r.top > innerHeight * .7 || r.bottom < 0) return;
    removeEventListener('scroll', auto);
    setTimeout(() => { if (!log.children.length && !busy) run('silences', $('.chip[data-r="silences"]', box)); }, 600);
  };
  addEventListener('scroll', auto, { passive: true });
  auto();
}

/* =====================================================================
   2. A composition, scrubbed like kadr does it (home + docs)
   ===================================================================== */
function compoDemo(box) {
  const card = $('.tc-card', box);
  const rule = $('.rule', card), ttl = $('.ttl', card), sub = $('.sub', card);
  const E = 'cubic-bezier(.16, 1, .3, 1)';
  const anims = [
    rule.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 700, delay: 100, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'both' }),
    ttl.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: 900, delay: 250, easing: E, fill: 'both' }),
    sub.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: 900, delay: 450, easing: E, fill: 'both' }),
    card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4cqw)' }], { duration: 500, delay: 3400, easing: 'cubic-bezier(.7, 0, .84, 0)', fill: 'both' }),
  ];
  anims.forEach((a) => a.pause());
  const range = $('input[type="range"]', box), out = $('.t-now', box), btn = $('.t-play', box);
  const lines = $$('.ln[data-from]', box);
  const D = 4;
  let t = 0, playing = false, raf = 0;
  const seek = (x) => {
    t = Math.max(0, Math.min(D, x));
    anims.forEach((a) => { a.currentTime = t * 1000; });
    range.value = t;
    range.style.setProperty('--fill', `${(t / D) * 100}%`);
    out.textContent = tc(t);
    for (const l of lines) l.classList.toggle('hl', t >= +l.dataset.from && t <= +l.dataset.to);
  };
  range.addEventListener('input', () => { stop(); seek(+range.value); });
  const stop = () => { playing = false; btn.textContent = '▶'; cancelAnimationFrame(raf); };
  btn.onclick = () => {
    if (playing) return stop();
    playing = true; btn.textContent = '❚❚';
    let last = performance.now();
    if (t >= D) t = 0;
    const step = (n) => { if (!playing) return; let x = t + (n - last) / 1000; last = n; if (x > D) x = 0; seek(x); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  };
  // props → page, like ?props= in kadr
  const pt = $('[data-p="title"]', box), ps = $('[data-p="subtitle"]', box), pa = $('[data-p="accent"]', box);
  const codeT = $$('.pv-title', box), codeS = $$('.pv-sub', box), codeA = $$('.pv-acc', box);
  pt?.addEventListener('input', () => { ttl.textContent = pt.value; codeT.forEach((e) => { e.textContent = pt.value; }); });
  ps?.addEventListener('input', () => { sub.textContent = ps.value; codeS.forEach((e) => { e.textContent = ps.value; }); });
  pa?.addEventListener('input', () => { card.style.setProperty('--acc', pa.value); codeA.forEach((e) => { e.textContent = pa.value; }); });
  seek(1.6);
  new IntersectionObserver(([en]) => { if (en.isIntersecting && !playing && t === 1.6) btn.click(); }, { threshold: .5 }).observe(box);
}

/* =====================================================================
   3. Marquee that speeds up with scrolling
   ===================================================================== */
function marquee(el) {
  const track = $('.marquee-track', el);
  track.innerHTML += track.innerHTML;
  let x = 0, v = 0, lastY = scrollY;
  const loop = () => {
    const dy = scrollY - lastY; lastY = scrollY;
    v += (Math.abs(dy) * .08 - v) * .1;
    x -= (0.6 + v) * (still ? 0 : 1);
    const w = track.scrollWidth / 2;
    if (-x > w) x += w;
    track.style.transform = `translateX(${x}px)`;
    requestAnimationFrame(loop);
  };
  loop();
}

/* =====================================================================
   4. App screenshot that straightens as it scrolls in
   ===================================================================== */
function showcase(el) {
  const win = $('.show-win', el);
  const upd = () => {
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, 1 - (r.top - innerHeight * .15) / (innerHeight * .75)));
    win.style.setProperty('--rx', `${(1 - p) * 26}deg`);
    win.style.setProperty('--sc', `${.88 + p * .12}`);
    win.style.setProperty('--shine', `${-80 + p * 200}%`);
  };
  addEventListener('scroll', upd, { passive: true });
  upd();
}

/* =====================================================================
   5. Keyboard map (docs: editing)
   ===================================================================== */
const KEYS = {
  ' ': ['Play / pause', 'پخش / توقف'], ArrowLeft: ['One frame back (Shift: 1 second)', 'یک فریم عقب (با Shift: یک ثانیه)'], ArrowRight: ['One frame forward (Shift: 1 second)', 'یک فریم جلو (با Shift: یک ثانیه)'],
  ArrowUp: ['Previous edit point', 'نقطه‌ی برش قبلی'], ArrowDown: ['Next edit point', 'نقطه‌ی برش بعدی'],
  s: ['Split at the playhead', 'برش در جای پلی‌هد'], c: ['Razor tool', 'ابزار تیغ (Razor)'], v: ['Select tool', 'ابزار انتخاب'],
  Delete: ['Delete (Shift: ripple delete)', 'حذف (با Shift: حذف و بستن فاصله)'], q: ['Ripple trim the start to the playhead', 'تریم ابتدای کلیپ تا پلی‌هد'], w: ['Ripple trim the end to the playhead', 'تریم انتهای کلیپ تا پلی‌هد'],
  i: ['Set the in point', 'نقطه‌ی شروع (In)'], o: ['Set the out point', 'نقطه‌ی پایان (Out)'], x: ['Clear in / out', 'پاک کردن In و Out'],
  m: ['Add a marker', 'گذاشتن مارکر'], t: ['Add a text clip', 'اضافه کردن متن'], n: ['Snapping on / off', 'چسبیدن خودکار روشن / خاموش'], g: ['Safe-area and thirds guides', 'خطوط محدوده‌ی امن و یک‌سوم'],
  '[': ['Previous keyframe', 'کی‌فریم قبلی'], ']': ['Next keyframe', 'کی‌فریم بعدی'], '+': ['Zoom in', 'بزرگ‌نمایی'], '-': ['Zoom out', 'کوچک‌نمایی'], '\\': ['Fit the timeline', 'جا دادن کل تایم‌لاین'],
  e: ['Ctrl+E: export · Shift+E: enable / disable clip', 'Ctrl+E: خروجی · Shift+E: فعال/غیرفعال کردن کلیپ'], z: ['Ctrl+Z undo · Ctrl+Shift+Z redo', 'Ctrl+Z برگشت · Ctrl+Shift+Z جلو'],
  d: ['Ctrl+D: duplicate', 'Ctrl+D: کپی کلیپ'], k: ['Ctrl+K: split', 'Ctrl+K: برش'], a: ['Ctrl+A: select all', 'Ctrl+A: انتخاب همه'], l: ['Shift+L: loop in → out', 'Shift+L: تکرار بین In و Out'],
  Alt: ['Alt+←/→ nudge · Alt+drag copies', 'Alt+←/→ جابه‌جایی ریز · Alt+کشیدن = کپی'], Shift: ['Hold for bigger steps and ripple', 'نگه دار برای قدم بزرگ‌تر و ripple'], Control: ['With C / X / V: copy, cut, paste', 'با C / X / V: کپی، برش، چسباندن'],
};
function kbMap(el) {
  const rows = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
    ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '+', 'ArrowUp'],
    ['Control', 'Alt', ' ', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Delete'],
  ];
  const label = { ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del', Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };
  const wide = { ' ': 'w6', Shift: 'w2', Control: 'w15', Alt: 'w15', Delete: 'w15' };
  el.tabIndex = 0;
  el.innerHTML = rows.map((r) => `<div class="kb-row">${r.map((k) => `<button class="key ${wide[k] || ''} ${KEYS[k] ? 'has' : ''}" data-k="${k.replace(/"/g, '&quot;')}">${label[k] || k.toUpperCase()}</button>`).join('')}</div>`).join('')
    + `<div class="kb-out"><kbd>?</kbd><span lang="en">Press a key (click here first) or click one.</span><span lang="fa">یه کلید رو بزن (اول اینجا کلیک کن) یا روش کلیک کن.</span></div>`;
  const out = $('.kb-out', el);
  const show = (k) => {
    const d = KEYS[k];
    const b = $$('.key', el).find((x) => x.dataset.k === k);
    if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220); }
    out.innerHTML = `<kbd>${label[k] || k.toUpperCase()}</kbd><span${lang() === 'fa' ? ' dir="rtl"' : ''}>${d ? d[lang() === 'fa' ? 1 : 0] : (lang() === 'fa' ? 'این کلید کاری نداره' : 'Nothing on this key')}</span>`;
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('.key'); if (b) show(b.dataset.k); });
  el.addEventListener('keydown', (e) => {
    let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Backspace') k = 'Delete';
    if (k === '=') k = '+';
    if (KEYS[k] || $$('.key', el).some((x) => x.dataset.k === k)) { e.preventDefault(); show(k); }
  });
}

/* =====================================================================
   6. Mini timeline you can actually edit (docs: editing)
   ===================================================================== */
function miniTimeline(el) {
  const D = 20;
  let clips = [{ s: 0, e: 6, n: 'intro.mp4' }, { s: 6, e: 13, n: 'talk.mp4' }, { s: 13, e: 20, n: 'b-roll.mp4' }];
  let ph = 8.5, sel = 1;
  const undo = [];
  el.tabIndex = 0;
  el.innerHTML = `<div class="mtl-top"><span class="tc"></span>
    <button data-a="split">S · <span lang="en">split</span><span lang="fa">برش</span></button>
    <button data-a="del">Del</button>
    <button data-a="ripple">⇧Del · ripple</button>
    <button data-a="undo">Ctrl Z</button></div>
    <div class="mtl-body"><div class="mtl-ruler">${Array.from({ length: 11 }, (_, i) => `<span style="left:${i * 10}%">${i * 2}s</span>`).join('')}</div>
    <div class="mtl-track"></div><div class="mtl-ph"></div></div>
    <div class="mtl-help"><span lang="en">Drag clips · drag the ruler to move the playhead · click here, then S / Del / Shift+Del / Ctrl+Z</span><span lang="fa">کلیپ‌ها رو بکش · روی خط‌کش بکش تا پلی‌هد جابه‌جا شه · اینجا کلیک کن و S / Del / Shift+Del / Ctrl+Z رو بزن</span></div>`;
  const track = $('.mtl-track', el), phEl = $('.mtl-ph', el), tcEl = $('.tc', el), ruler = $('.mtl-ruler', el);
  const save = () => undo.push(JSON.stringify({ clips, sel }));
  const paint = () => {
    track.innerHTML = clips.map((c, i) => `<div class="mtl-clip ${i === sel ? 'sel' : ''}" data-i="${i}" style="left:${(c.s / D) * 100}%;width:calc(${((c.e - c.s) / D) * 100}% - 2px)">${c.n}</div>`).join('');
    phEl.style.left = `${(ph / D) * 100}%`;
    tcEl.textContent = tc(ph);
  };
  const act = (a) => {
    if (a === 'split') {
      const i = clips.findIndex((c) => ph > c.s + .05 && ph < c.e - .05);
      if (i < 0) return toast(T('Put the playhead over a clip', 'پلی‌هد رو روی یه کلیپ ببر'));
      save();
      const c = clips[i];
      clips.splice(i, 1, { ...c, e: ph }, { ...c, s: ph, n: c.n.replace(/(\.\w+)$/, '·2$1') });
      sel = i + 1;
    } else if (a === 'del' || a === 'ripple') {
      if (sel < 0 || !clips[sel]) return;
      save();
      const c = clips[sel];
      clips.splice(sel, 1);
      if (a === 'ripple') { const len = c.e - c.s; clips = clips.map((x) => (x.s >= c.e - .001 ? { ...x, s: x.s - len, e: x.e - len } : x)); }
      sel = -1;
    } else if (a === 'undo') {
      const p = undo.pop();
      if (!p) return;
      ({ clips, sel } = JSON.parse(p));
    }
    paint();
  };
  $$('.mtl-top button', el).forEach((b) => b.addEventListener('click', () => act(b.dataset.a)));
  el.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 's' && !e.ctrlKey) act('split');
    else if (k === 'delete' || k === 'backspace') act(e.shiftKey ? 'ripple' : 'del');
    else if (k === 'z' && (e.ctrlKey || e.metaKey)) act('undo');
    else if (k === 'arrowleft' || k === 'arrowright') { ph = Math.max(0, Math.min(D, ph + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30))); paint(); }
    else return;
    e.preventDefault();
  });
  const at = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(D, ((x - r.left) / r.width) * D)); };
  ruler.addEventListener('pointerdown', (e) => {
    ruler.setPointerCapture(e.pointerId);
    ph = at(e.clientX); paint();
    const mv = (ev) => { ph = at(ev.clientX); const near = clips.flatMap((c) => [c.s, c.e]).find((x) => Math.abs(x - ph) < .25); if (near != null) ph = near; paint(); };
    ruler.addEventListener('pointermove', mv);
    ruler.addEventListener('pointerup', () => ruler.removeEventListener('pointermove', mv), { once: true });
  });
  track.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.mtl-clip');
    if (!c) { sel = -1; paint(); return; }
    const i = +c.dataset.i;
    sel = i; save();
    const start = at(e.clientX), orig = { ...clips[i] };
    c.setPointerCapture(e.pointerId);
    paint();
    const elc = $(`.mtl-clip[data-i="${i}"]`, track);
    elc.classList.add('drag');
    elc.setPointerCapture(e.pointerId);
    const len = orig.e - orig.s;
    const mv = (ev) => {
      let s = orig.s + at(ev.clientX) - start;
      s = Math.max(0, Math.min(D - len, s));
      for (const [j, o] of clips.entries()) { if (j === i) continue; for (const edge of [o.s, o.e]) { if (Math.abs(edge - s) < .4) s = edge; if (Math.abs(edge - (s + len)) < .4) s = edge - len; } }
      clips[i] = { ...orig, s, e: s + len };
      elc.style.left = `${(s / D) * 100}%`;
    };
    elc.addEventListener('pointermove', mv);
    elc.addEventListener('pointerup', () => { elc.removeEventListener('pointermove', mv); clips.sort((a, b) => a.s - b.s); sel = clips.findIndex((x) => x.n === orig.n && Math.abs(x.e - x.s - len) < .001); paint(); }, { once: true });
  });
  paint();
}

/* =====================================================================
   7. Terminal with clickable commands (docs: cli, start)
   ===================================================================== */
const RUNS = {
  init: ['kadr init ~/videos/launch --demo', 'created project in /home/you/videos/launch\nnext: cd videos/launch && kadr serve'],
  serve: ['kadr serve --open', 'kadr  http://127.0.0.1:4310\nproject  /home/you/videos/launch\nctrl+c to stop'],
  info: ['kadr info', 'launch  1920x1080 @ 30fps  duration 10.000s (00:00:10:00)  bg #000000\n\ntracks (bottom → top for video):\n  V1   video   1 clips\n  V2   video   3 clips\n  A1   audio   1 clips'],
  silence: ['kadr silence media/talk.mp4', '[\n  { "start": 2.41, "end": 3.38 },\n  { "start": 5.62, "end": 6.71 },\n  { "start": 8.60, "end": 9.82 }\n]'],
  frame: ['kadr frame 2.5 00:00:04:12', '.kadr/frames/frame-2.500.png\n.kadr/frames/frame-4.400.png'],
  lint: ['kadr lint', '<span class="ok">✓</span> comps/counter.html\n<span class="ok">✓</span> comps/lower-third.html\n<span class="ok">✓</span> comps/title.html'],
  stock: ['kadr stock search "city night" --video', ' 1  1920x1080  12.0s  pexels     CC0      neon street, rain\n 2  3840x2160   8.4s  pixabay    Pixabay  skyline timelapse\n 3  1920x1080  15.2s  wikimedia  CC BY 4.0  night traffic'],
  render: ['kadr render --codec h265 --loudness -14', 'rendering  ████████████████████ 100%  300/300 frames\nrenders/launch.mp4  hevc 1920x1080 -14.0 LUFS  (10.00s of video in 7.4s)'],
  connect: ['kadr connect claude', 'claude code: connected (backup: ~/.claude.json.kadr-backup)\nnow ask Claude Code for a video, for example:\n  "make a 30 second vertical video about my cafe in ~/Videos/cafe"'],
};
function terminal(el) {
  const keys = (el.dataset.term || Object.keys(RUNS).join(',')).split(',');
  el.innerHTML = `<div class="term-h"><i></i><i></i><i></i><span>~/videos/launch — kadr</span></div>
    <div class="term-cmds">${keys.map((k) => `<button data-k="${k}">${RUNS[k][0].split(' ').slice(0, 2).join(' ')}</button>`).join('')}</div>
    <pre><span class="pr">$</span> <span class="cur"></span></pre>`;
  const pre = $('pre', el);
  let token = 0;
  const run = async (k, b) => {
    const my = ++token;
    $$('.term-cmds button', el).forEach((x) => x.classList.toggle('on', x === b));
    const [cmd, out] = RUNS[k];
    pre.innerHTML = '<span class="pr">$</span> <span class="typed"></span><span class="cur"></span>';
    const typed = $('.typed', pre);
    for (const ch of cmd) { if (my !== token) return; typed.textContent += ch; await sleep(22); }
    await sleep(280);
    if (my !== token) return;
    $('.cur', pre).remove();
    pre.insertAdjacentHTML('beforeend', `\n${out}\n<span class="pr">$</span> <span class="cur"></span>`);
  };
  $$('.term-cmds button', el).forEach((b) => b.addEventListener('click', () => run(b.dataset.k, b)));
  new IntersectionObserver(([en], io) => { if (en.isIntersecting) { io.disconnect(); const b = $('.term-cmds button', el); run(b.dataset.k, b); } }, { threshold: .4 }).observe(el);
}

/* ---------------- boot ---------------- */
$$('.demo').forEach(chatDemo);
$$('.compo').forEach(compoDemo);
$$('.marquee').forEach(marquee);
$$('.showcase').forEach(showcase);
$$('.kbmap').forEach(kbMap);
$$('.mtl').forEach(miniTimeline);
$$('.term').forEach(terminal);
export { tc };
