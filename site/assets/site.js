// kadr site: everything every page shares. The page itself is the editor:
// the cursor frames what it points at, scrolling is a timeline you can play
// (Space, J/K/L), G shows safe-area guides, and right-click has a real menu.

const root = document.documentElement;
const BASE = root.dataset.root || '.';
const REPO = 'https://github.com/Noctis-Architect/kadr';
const fine = matchMedia('(pointer: fine)').matches;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const T = (en, fa) => (root.dataset.lang === 'fa' ? fa : en);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export const DOCS = [
  { slug: 'start', en: 'Install & first project', fa: 'نصب و اولین پروژه', den: 'From download to your first export.', dfa: 'از دانلود تا اولین خروجی.' },
  { slug: 'chat', en: 'Edit by talking', fa: 'ادیت با حرف زدن', den: 'The Chat tab, checkpoints, attachments.', dfa: 'تب چت، برگشت به عقب، پیوست فایل.' },
  { slug: 'agents', en: 'Use your own agents', fa: 'ایجنت‌های خودت', den: 'Claude Code, Codex, Gemini… via MCP.', dfa: 'Claude Code، Codex، Gemini… با MCP.' },
  { slug: 'brief', en: 'Video from a brief', fa: 'ویدیو از روی بریف', den: 'Photos, music, a website → a video.', dfa: 'عکس، موزیک، سایت ← ویدیو.' },
  { slug: 'editing', en: 'Timeline & shortcuts', fa: 'تایم‌لاین و میانبرها', den: 'Cut, trim, keyframes, every key.', dfa: 'برش، تریم، کی‌فریم و همه‌ی کلیدها.' },
  { slug: 'compositions', en: 'Motion graphics in HTML', fa: 'موشن‌گرافیک با HTML', den: 'A composition is a web page.', dfa: 'هر کامپوزیشن یه صفحه‌ی وبه.' },
  { slug: 'export', en: 'Export', fa: 'خروجی گرفتن', den: 'Codecs, loudness, motion blur.', dfa: 'کدک، بلندی صدا، موشن‌بلور.' },
  { slug: 'cli', en: 'Command line', fa: 'خط فرمان', den: 'Every kadr command, with examples.', dfa: 'همه‌ی دستورهای kadr با مثال.' },
];

const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7v18M25 7v18M7 7h5M7 25h5M25 7h-5M25 25h-5" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M13.5 11.5v9l7-4.5z"/></svg>';
const ICON = {
  play: '<path d="M6 4v16l13-8z"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>', lang: '<path d="M4 5h9M8.5 3v2M11 5c-1 4-3.5 7-7 8.5M6.5 9c1 2 2.6 3.4 4.5 4.3M13 21l4.5-10L22 21M14.5 18h6"/>',
  guides: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6.5" y="7.5" width="11" height="9" rx="1" stroke-dasharray="2 2"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', docs: '<path d="M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h6"/>', gh: '<path d="M9 19c-4 1.3-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 3.7 5.8 4 5.8 4a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 10.4c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22"/>',
  back: '<path d="M15 6l-6 6 6 6"/>', fwd: '<path d="M9 6l6 6-6 6"/>', home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;

/* ---------------- theme & language ---------------- */
function themeNow() {
  const set = root.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function syncTheme() {
  root.dataset.themeNow = themeNow();
  dispatchEvent(new CustomEvent('kadr:theme', { detail: root.dataset.themeNow }));
}
export function toggleTheme(e) {
  const next = themeNow() === 'dark' ? 'light' : 'dark';
  const go = () => { root.dataset.theme = next; store.set('kadr-theme', next); syncTheme(); };
  if (!document.startViewTransition || still) return go();
  let x = innerWidth / 2, y = innerHeight / 2;
  const src = e?.currentTarget?.getBoundingClientRect ? e.currentTarget : e?.target?.closest?.('button');
  if (e?.clientX) { x = e.clientX; y = e.clientY; } else if (src?.getBoundingClientRect) { const r = src.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add('vt-theme', 'no-anim');
  const vt = document.startViewTransition(go);
  vt.ready.then(() => {
    root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 750, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
  vt.finished.finally(() => root.classList.remove('vt-theme', 'no-anim'));
}
/** Forget the saved choices and follow the system / browser again. */
export function followSystem() {
  store.set('kadr-theme', null); store.set('kadr-lang', null);
  delete root.dataset.theme; syncTheme();
  setLang(sysLang(), false);
}
const sysLang = () => ((navigator.languages || [navigator.language]).some((l) => /^fa\b/i.test(l || '')) ? 'fa' : 'en');
addEventListener('languagechange', () => { if (!store.get('kadr-lang')) setLang(sysLang(), false); });
matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncTheme);
syncTheme();

export function setLang(l, save = true) {
  if (l === root.dataset.lang) return;
  const go = () => {
    root.dataset.lang = l; root.lang = l; root.dir = l === 'fa' ? 'rtl' : 'ltr';
    if (save) store.set('kadr-lang', l);
    dispatchEvent(new CustomEvent('kadr:lang', { detail: l }));
    $$('.split-words').forEach((el) => { splitWords(el); el.classList.add('in'); });
    buildMarkers();
  };
  if (!document.startViewTransition || still) return go();
  root.classList.add('vt-lang');
  const vt = document.startViewTransition(go);
  vt.finished.finally(() => root.classList.remove('vt-lang'));
}
const toggleLang = () => setLang(root.dataset.lang === 'fa' ? 'en' : 'fa');

/* ---------------- toast ---------------- */
let toastT = 0;
export function toast(msg) {
  $('.toast')?.remove();
  const el = h(`<div class="toast" role="status"></div>`);
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastT);
  toastT = setTimeout(() => el.remove(), 2000);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg || T('Copied', 'کپی شد')); } catch { toast(T('Copy is blocked here', 'کپی اینجا مجاز نیست')); }
}

/* ---------------- header / footer / chrome ---------------- */
const page = root.dataset.page || '';
function header() {
  const link = (href, en, fa, key) => `<a href="${BASE}/${href}" class="${page === key || (key === 'docs' && page.startsWith('doc')) ? 'on' : ''}" data-cursor="${en}"><span lang="en">${en}</span><span lang="fa">${fa}</span></a>`;
  const el = h(`<header class="hdr">
    <a class="brand" href="${BASE}/index.html" data-cursor="Home" aria-label="kadr">${LOGO}<span>kadr</span></a>
    <nav class="nav" id="nav">
      ${link('index.html', 'Home', 'خانه', 'home')}
      ${link('docs/index.html', 'Docs', 'آموزش‌ها', 'docs')}
      ${link('download.html', 'Download', 'دانلود', 'download')}
      <a href="${REPO}" target="_blank" rel="noopener" data-cursor="GitHub ↗">GitHub ↗</a>
    </nav>
    <div class="grow"></div>
    <button class="tgl lang-tgl" id="langBtn" data-cursor="F" aria-label="Language"><b lang="en">EN</b><i lang="en">FA</i><i lang="fa">EN</i><b lang="fa">FA</b></button>
    <button class="tgl" id="themeBtn" data-cursor="T" aria-label="Theme"><svg class="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg><svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>
    <a class="btn primary dl-btn" href="${BASE}/download.html" data-cursor="Download">${svg('dl')}<span lang="en">Download</span><span lang="fa">دانلود</span></a>
    <button class="tgl menu-btn" id="menuBtn" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </header>`);
  document.body.prepend(el);
  $('#langBtn').onclick = toggleLang;
  $('#themeBtn').onclick = (e) => toggleTheme(e);
  $('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
  // hide on scroll down, show on scroll up
  let last = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    el.classList.toggle('away', y > last + 4 && y > 300);
    if (y < last - 4) el.classList.remove('away');
    last = y;
  }, { passive: true });
}

function footer() {
  const el = h(`<footer class="end" data-mark="The end" data-mark-fa="پایان">
    <div class="wrap end-grid">
      <div class="stage3d" id="clapStage" data-cursor-3d><canvas tabindex="0" aria-label="A clapperboard. Click to clap."></canvas><div class="end-cut">CUT!</div>
        <div class="stage-hint"><span lang="en">click to clap · drag to turn it</span><span lang="fa">کلیک کن تا کات بزنه · بکش تا بچرخه</span></div></div>
      <div>
        <div class="eyebrow"><span lang="en">The end · scene 01</span><span lang="fa">پایان · صحنه‌ی ۰۱</span></div>
        <h2 class="end-title"><span lang="en">That's a <em>wrap.</em></span><span lang="fa">کات! <em>تموم شد.</em></span></h2>
        <dl class="roll">
          <div><dt><span lang="en">Directed by</span><span lang="fa">کارگردان</span></dt><dd><span lang="en">You</span><span lang="fa">خودت</span></dd></div>
          <div><dt><span lang="en">Edited by</span><span lang="fa">تدوین</span></dt><dd><span lang="en">Your agent, and you</span><span lang="fa">ایجنتت، و خودت</span></dd></div>
          <div><dt><span lang="en">Engine</span><span lang="fa">موتور</span></dt><dd>ffmpeg · Chromium · Node</dd></div>
          <div><dt><span lang="en">License</span><span lang="fa">مجوز</span></dt><dd><span lang="en">MIT, free forever</span><span lang="fa">MIT، همیشه رایگان</span></dd></div>
        </dl>
        <nav class="end-links">
          <a href="${BASE}/docs/index.html"><span lang="en">Tutorials</span><span lang="fa">آموزش‌ها</span></a>
          <a href="${BASE}/download.html"><span lang="en">Download</span><span lang="fa">دانلود</span></a>
          <a href="${REPO}" target="_blank" rel="noopener">GitHub ↗</a>
          <a href="${REPO}/releases" target="_blank" rel="noopener"><span lang="en">Releases ↗</span><span lang="fa">نسخه‌ها ↗</span></a>
          <a href="${REPO}/issues" target="_blank" rel="noopener"><span lang="en">Report a bug ↗</span><span lang="fa">گزارش باگ ↗</span></a>
        </nav>
        <div class="end-bottom"><span><b>kadr</b> · <span lang="en">made by its contributors</span><span lang="fa">ساخته‌ی مشارکت‌کننده‌هاش</span></span><span>TAKE <span class="end-take">1</span> · <span class="end-tc">00:00:00:00</span></span></div>
      </div>
    </div>
  </footer>`);
  document.body.append(el);
  const stageEl = $('#clapStage', el), cut = $('.end-cut', el);
  let started = false;
  const io = new IntersectionObserver(async ([en]) => {
    if (!en.isIntersecting || started) return;
    started = true; io.disconnect();
    try {
      const { clapper } = await import('./kit3d.js');
      clapper($('canvas', stageEl), { onClap: (take) => {
        cut.classList.remove('on'); void cut.offsetWidth; cut.classList.add('on');
        $('.end-take', el).textContent = take;
      } });
    } catch (e) { console.warn('3D off:', e); stageEl.style.display = 'none'; }
  }, { rootMargin: '300px' });
  io.observe(stageEl);
  addEventListener('scroll', () => { const t = $('.end-tc', el); if (t) t.textContent = hud.tc; }, { passive: true });
}

/* ---------------- custom cursor ---------------- */
function cursor() {
  if (!fine) return;
  root.classList.add('cursor-on');
  const dot = h('<div class="cur-dot"></div>');
  const frame = h('<div class="cur-frame"><i></i><i></i><i></i><i></i></div>');
  const tag = h('<div class="cur-tag"></div>');
  document.body.append(frame, dot, tag);
  let mx = innerWidth / 2, my = innerHeight / 2, px = mx, py = my, vx = 0, vy = 0;
  let fx = mx, fy = my, fw = 34, fh = 34, tw = 34, th = 34, tx = mx, ty = my;
  let target = null, extLabel = '', squeeze = 1, seen = false;
  const SNAP = 'a, button, input, select, textarea, label, summary, [data-cursor], .chip, .key, .mtl-clip, .hud .bar';
  const setTag = (t) => { tag.textContent = t || ''; tag.classList.toggle('on', !!t); };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    mx = e.clientX; my = e.clientY; seen = true;
    root.classList.remove('cur-hide');
    const in3d = e.target.closest?.('[data-cursor-3d], .hero canvas');
    root.classList.toggle('cur-3d', !!in3d);
    const el = in3d ? null : e.target.closest?.(SNAP);
    const text = !el && !in3d && e.target.closest?.('p, li, h1, h2, h3, h4, pre, code, td, .lead, dd');
    root.classList.toggle('cur-text', !!text && !e.target.closest('.card, .dl, .hub a'));
    target = el;
    setTag(el?.dataset.cursor || (in3d ? extLabel : ''));
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    squeeze = .72; root.classList.add('cur-down');
    const r = h('<div class="cur-ripple"></div>');
    r.style.setProperty('--at', `translate(${e.clientX}px, ${e.clientY}px)`);
    document.body.append(r);
    setTimeout(() => r.remove(), 600);
  });
  addEventListener('pointerup', () => root.classList.remove('cur-down'));
  document.documentElement.addEventListener('mouseleave', () => root.classList.add('cur-hide'));
  addEventListener('kadr:cursor', (e) => { extLabel = e.detail || ''; if (root.classList.contains('cur-3d') || !target) setTag(extLabel); });
  const loop = () => {
    // velocity: the dot stretches along the direction it moves
    vx += ((mx - px) - vx) * .35; vy += ((my - py) - vy) * .35; px = mx; py = my;
    const sp = Math.min(Math.hypot(vx, vy), 60);
    const st = still ? 1 : 1 + sp / 45, ang = Math.atan2(vy, vx);
    dot.style.transform = `translate(${mx}px, ${my}px) rotate(${ang}rad) scale(${st}, ${1 / Math.sqrt(st)})`;
    tag.style.transform = `translate(${mx + 16}px, ${my + 16}px)`;
    const r = target?.isConnected ? target.getBoundingClientRect() : null;
    if (r && r.width < 520 && r.height < 200 && r.width > 0) {
      const pad = 6;
      tx = r.left - pad; ty = r.top - pad; tw = r.width + pad * 2; th = r.height + pad * 2;
      frame.classList.add('snap');
    } else {
      const s = root.classList.contains('cur-3d') ? 64 : 34;
      tw = s; th = s; tx = mx - s / 2; ty = my - s / 2;
      frame.classList.remove('snap');
    }
    squeeze += (1 - squeeze) * .18;
    const k = still ? 1 : .2;
    fx += (tx - fx) * k; fy += (ty - fy) * k; fw += (tw * squeeze - fw) * k; fh += (th * squeeze - fh) * k;
    frame.style.transform = `translate(${fx + (tw - tw * squeeze) / 2}px, ${fy + (th - th * squeeze) / 2}px)`;
    frame.style.width = `${fw}px`; frame.style.height = `${fh}px`;
    frame.style.opacity = seen ? '' : 0; dot.style.opacity = seen ? '' : 0;
    requestAnimationFrame(loop);
  };
  loop();
}

/* ---------------- magnetic buttons ---------------- */
function magnetic() {
  if (!fine || still) return;
  const SEL = '.btn, .tgl, .chip, .hud .pl, .end-links a, .mtl-top button, .term-cmds button';
  let cur = null;
  addEventListener('pointermove', (e) => {
    const el = e.target.closest?.(SEL);
    if (cur && cur !== el) { cur.style.removeProperty('--mgx'); cur.style.removeProperty('--mgy'); }
    cur = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    el.style.setProperty('--mgx', `${Math.max(-8, Math.min(8, dx * .22))}px`);
    el.style.setProperty('--mgy', `${Math.max(-6, Math.min(6, dy * .3))}px`);
  }, { passive: true });
}

/* ---------------- right-click menu ---------------- */
function ctxMenu() {
  let menu = null;
  const close = () => { menu?.remove(); menu = null; };
  addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // the browser's own menu
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    close();
    const sel = getSelection()?.toString().trim();
    const link = e.target.closest('a[href]');
    const sec = e.target.closest('[id]');
    const playing = hud.playing;
    const item = (key, icon, en, fa, k) => `<button data-a="${key}">${svg(icon)}<span>${T(en, fa)}</span>${k ? `<kbd>${k}</kbd>` : ''}</button>`;
    menu = h(`<div class="ctx" role="menu">
      <div class="ctx-h"><span>kadr</span><span>${hud.tc}</span></div>
      ${sel ? item('copysel', 'link', 'Copy selection', 'کپی متن انتخاب‌شده', 'Ctrl C') : ''}
      ${link ? item('copylink', 'link', 'Copy link address', 'کپی آدرس لینک') : ''}
      ${item('play', 'play', playing ? 'Pause' : 'Play the page', playing ? 'توقف' : 'پخش صفحه', 'Space')}
      ${item('top', 'up', 'Back to the start', 'برگشت به اول', 'Home')}
      ${sec ? item('here', 'link', 'Copy link to this part', 'کپی لینک همین بخش') : ''}
      <hr>
      ${item('theme', 'theme', themeNow() === 'dark' ? 'Light mode' : 'Dark mode', themeNow() === 'dark' ? 'حالت روشن' : 'حالت تاریک', 'T')}
      ${item('lang', 'lang', 'فارسی', 'English', 'F')}
      ${item('guides', 'guides', 'Safe-area guides', 'خطوط راهنما', 'G')}
      ${store.get('kadr-theme') || store.get('kadr-lang') ? item('system', 'theme', 'Follow my system', 'مطابق سیستم خودم') : ''}
      <hr>
      ${item('dl', 'dl', 'Download kadr', 'دانلود کادر')}
      ${item('docs', 'docs', 'Tutorials', 'آموزش‌ها')}
      ${item('gh', 'gh', 'Source on GitHub', 'سورس در گیت‌هاب')}
      <hr>
      ${item('back', 'back', 'Back', 'عقب', 'Alt ←')}
      <div class="ctx-foot">${T('Shift + right-click: the browser menu', 'Shift + راست‌کلیک: منوی خود مرورگر')}</div>
    </div>`);
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    const rtl = root.dir === 'rtl';
    let x = rtl ? e.clientX - r.width : e.clientX;
    let y = e.clientY;
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    if (y + r.height > innerHeight - 8) y = Math.max(8, y - r.height);
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
    menu.onclick = (ev) => {
      const a = ev.target.closest('button')?.dataset.a;
      if (!a) return;
      close();
      ({
        copysel: () => copy(sel),
        copylink: () => copy(link.href),
        play: () => hud.toggle(),
        top: () => scrollTo({ top: 0, behavior: 'smooth' }),
        here: () => copy(`${location.href.split('#')[0]}#${sec.id}`, T('Link copied', 'لینک کپی شد')),
        theme: () => toggleTheme({ clientX: ev.clientX, clientY: ev.clientY }),
        system: () => { followSystem(); toast(T('Following your system again', 'دوباره مطابق سیستم خودت')); },
        lang: toggleLang,
        guides: toggleGuides,
        dl: () => go(`${BASE}/download.html`),
        docs: () => go(`${BASE}/docs/index.html`),
        gh: () => open(REPO, '_blank', 'noopener'),
        back: () => history.back(),
      })[a]?.();
    };
  });
  addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('scroll', close, { passive: true });
  addEventListener('blur', close);
}

/* ---------------- guides (G) ---------------- */
let guides;
function toggleGuides() {
  if (!guides) {
    guides = h(`<div class="guides"><div class="safe"></div><div class="safe t"></div>
      <div class="third v" style="left:33.33%"></div><div class="third v" style="left:66.66%"></div>
      <div class="third h" style="top:33.33%"></div><div class="third h" style="top:66.66%"></div>
      <div class="lbl">ACTION SAFE 90% · TITLE SAFE 80%</div></div>`);
    document.body.append(guides);
    requestAnimationFrame(() => guides.classList.add('on'));
    return;
  }
  guides.classList.toggle('on');
}

/* ---------------- scroll = timeline (HUD) ---------------- */
const FPS = 30;
const PX_PER_SEC = 140; // 1× playback scrolls this many pixels per second
const hud = {
  playing: false, speed: 1, tc: '00:00:00:00', el: null, raf: 0, last: 0, acc: 0,
  toggle() { this.playing ? this.stop() : this.play(1); },
  play(speed) {
    this.speed = speed; this.playing = true; this.last = performance.now(); this.acc = scrollY;
    this.el?.querySelector('.pl').classList.add('on');
    cancelAnimationFrame(this.raf);
    const step = (now) => {
      if (!this.playing) return;
      const dt = Math.min(.05, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt * PX_PER_SEC * this.speed;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (this.acc <= 0 || this.acc >= max) { this.acc = Math.max(0, Math.min(this.acc, max)); scrollTo(0, this.acc); return this.stop(); }
      scrollTo(0, this.acc);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  stop() { this.playing = false; cancelAnimationFrame(this.raf); this.el?.querySelector('.pl').classList.remove('on'); },
};
function tcOf(y) {
  const f = Math.round((y / PX_PER_SEC) * FPS);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / (FPS * 3600)))}:${p(Math.floor(f / (FPS * 60)) % 60)}:${p(Math.floor(f / FPS) % 60)}:${p(f % FPS)}`;
}
function buildMarkers() {
  const bar = hud.el?.querySelector('.bar');
  if (!bar) return;
  $$('.mk', bar).forEach((m) => m.remove());
  const max = document.documentElement.scrollHeight - innerHeight;
  if (max <= 0) return;
  const marks = $$('[data-mark], .prose h2[id]');
  for (const s of marks) {
    const top = s.getBoundingClientRect().top + scrollY - 80;
    const p = Math.max(0, Math.min(1, top / max));
    const lbl = s.dataset.mark ? T(s.dataset.mark, s.dataset.markFa || s.dataset.mark) : (s.querySelector(`[lang="${root.dataset.lang}"]`)?.textContent || s.textContent).trim();
    const m = h(`<i class="mk" style="left:${p * 100}%"></i>`);
    m.dataset.l = lbl.slice(0, 26);
    m.dataset.y = top;
    bar.append(m);
  }
}
function hudInit() {
  const el = h(`<div class="hud" aria-label="Page timeline">
    <button class="pl" aria-label="Play" data-cursor="Space"></button>
    <span class="tc">00:00:00:00</span>
    <div class="bar" data-cursor="Scrub"><div class="ticks"></div><div class="fill"></div><div class="ph"></div></div>
    <span class="keys"><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>G</kbd></span>
  </div>`);
  document.body.append(el);
  hud.el = el;
  const tc = $('.tc', el), ph = $('.ph', el), fill = $('.fill', el), bar = $('.bar', el);
  $('.pl', el).onclick = () => hud.toggle();
  const update = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const p = Math.min(1, scrollY / max);
    ph.style.left = `${p * 100}%`;
    fill.style.width = `${p * 100}%`;
    hud.tc = tcOf(scrollY);
    tc.textContent = hud.tc;
    let on = null;
    for (const m of $$('.mk', bar)) { m.classList.remove('on'); if (scrollY >= +m.dataset.y - 2) on = m; }
    on?.classList.add('on');
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', () => { buildMarkers(); update(); });
  const seek = (e) => {
    const r = bar.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    scrollTo(0, p * (document.documentElement.scrollHeight - innerHeight));
  };
  bar.addEventListener('pointerdown', (e) => {
    hud.stop(); seek(e); bar.setPointerCapture(e.pointerId);
    const mv = (ev) => seek(ev);
    bar.addEventListener('pointermove', mv);
    bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', mv), { once: true });
  });
  // stop playback when the user scrolls by hand
  addEventListener('wheel', () => hud.stop(), { passive: true });
  addEventListener('touchstart', () => hud.stop(), { passive: true });
  setTimeout(() => { buildMarkers(); update(); }, 300);
  addEventListener('load', () => { buildMarkers(); update(); });
}

/* ---------------- keyboard ---------------- */
function keys() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], .kbmap, .mtl')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); if (k === 'k') hud.stop(); else hud.toggle(); }
    else if (k === 'l') { hud.play(hud.playing && hud.speed > 0 ? Math.min(8, hud.speed * 2) : 1); }
    else if (k === 'j') { hud.play(hud.playing && hud.speed < 0 ? Math.max(-8, hud.speed * 2) : -1); }
    else if (k === 't') toggleTheme();
    else if (k === 'f') toggleLang();
    else if (k === 'g') toggleGuides();
    else return;
    if (k === 'l' || k === 'j') toast(`${hud.speed > 0 ? '▶' : '◀'} ${Math.abs(hud.speed)}×`);
  });
}

/* ---------------- reveal on scroll ---------------- */
function splitWords(el) {
  for (const part of el.querySelectorAll('[data-split]')) {
    if (part.dataset.done) continue;
    part.dataset.done = 1;
    const words = part.textContent.trim().split(/\s+/);
    part.innerHTML = words.map((w, i) => `<span class="w"><span style="--i:${i}">${w}</span></span>`).join(' ');
  }
}
function reveals() {
  $$('.split-words').forEach(splitWords);
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }, { rootMargin: '0px 0px -10% 0px', threshold: .08 });
  $$('.reveal, .split-words').forEach((el) => io.observe(el));
}

/* ---------------- spotlight + tilt on cards ---------------- */
export function spotlight(sel) {
  if (!fine) return;
  for (const el of $$(sel)) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }
}

/* ---------------- page transitions (a cut) ---------------- */
function cutEl() {
  const el = h(`<div class="cut">${Array.from({ length: 6 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}<div class="lbl"></div></div>`);
  document.body.append(el);
  return el;
}
export function go(href, label) {
  if (still) { location.href = href; return; }
  const el = cutEl();
  el.querySelector('.lbl').textContent = label || 'CUT';
  el.classList.add('go');
  try { sessionStorage.setItem('kadr-cut', '1'); } catch { /* ignore */ }
  setTimeout(() => { location.href = href; }, 520);
}
function transitions() {
  let came = false;
  try { came = sessionStorage.getItem('kadr-cut') === '1'; sessionStorage.removeItem('kadr-cut'); } catch { /* ignore */ }
  if (came && !still) {
    const el = cutEl();
    el.classList.add('out');
    setTimeout(() => el.remove(), 900);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return; // same page jump
    e.preventDefault();
    go(url.href, (a.dataset.cursor || a.textContent).trim().slice(0, 30));
  });
  addEventListener('pageshow', (e) => { if (e.persisted) $$('.cut').forEach((c) => c.remove()); });
}

/* ---------------- downloads: latest release ---------------- */
const FALLBACK = { tag: 'v0.1.0', assets: [
  ['kadr_0.1.0_x64-setup.exe', 25560000], ['kadr_0.1.0_aarch64.dmg', 41900000], ['kadr_0.1.0_x64.dmg', 43400000],
  ['kadr_0.1.0_amd64.deb', 49400000], ['kadr-0.1.0-1.x86_64.rpm', 49400000], ['kadr_0.1.0_amd64.AppImage', 122800000],
].map(([name, size]) => ({ name, size, url: `${REPO}/releases/download/v0.1.0/${name}` })), date: '2026-11-17' };
export async function release() {
  try {
    const c = sessionStorage.getItem('kadr-rel');
    if (c) return JSON.parse(c);
  } catch { /* ignore */ }
  try {
    const r = await fetch('https://api.github.com/repos/Noctis-Architect/kadr/releases/latest', { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const rel = { tag: j.tag_name, date: (j.published_at || '').slice(0, 10), assets: j.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) };
    try { sessionStorage.setItem('kadr-rel', JSON.stringify(rel)); } catch { /* ignore */ }
    return rel;
  } catch { return FALLBACK; }
}
export const ASSET = {
  win: /x64-setup\.exe$/, macArm: /aarch64\.dmg$/, macIntel: /x64\.dmg$/, deb: /amd64\.deb$/, rpm: /\.rpm$/, appimage: /\.AppImage$/,
};
export function detectOS() {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'win';
  if (/Mac/.test(ua)) return 'macArm';
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return 'deb';
  return null;
}
export const OS_NAME = {
  win: ['Windows', 'ویندوز'], macArm: ['macOS', 'مک'], macIntel: ['macOS Intel', 'مک اینتل'], deb: ['Linux', 'لینوکس'], rpm: ['Linux (rpm)', 'لینوکس (rpm)'], appimage: ['Linux (AppImage)', 'لینوکس (AppImage)'],
};
async function autoButtons() {
  const btns = $$('[data-dl-auto]');
  if (!btns.length) return;
  const os = detectOS();
  if (!os) return;
  const rel = await release();
  const a = rel.assets.find((x) => ASSET[os].test(x.name));
  for (const b of btns) {
    if (a) { b.href = a.url; b.removeAttribute('target'); }
    b.dataset.cursor = `${a ? a.name : 'download'}`;
    b.querySelector('[lang="en"]').textContent = `Download for ${OS_NAME[os][0]}`;
    b.querySelector('[lang="fa"]').textContent = `دانلود برای ${OS_NAME[os][1]}`;
  }
}

/* ---------------- docs chrome: sidebar, TOC, prev/next, copy ---------------- */
function docsChrome() {
  const side = $('.side');
  if (side) {
    side.innerHTML = `<h6><span lang="en">Tutorials</span><span lang="fa">آموزش‌ها</span></h6>` + DOCS.map((d, i) =>
      `<a href="${BASE}/docs/${d.slug}.html" class="${page === `doc-${d.slug}` ? 'on' : ''}"><i>${String(i + 1).padStart(2, '0')}</i><span lang="en">${d.en}</span><span lang="fa">${d.fa}</span></a>`).join('');
  }
  const prose = $('.prose');
  if (prose) {
    // anchors + hash buttons
    for (const h2 of $$('h2', prose)) {
      if (!h2.id) h2.id = (h2.querySelector('[lang="en"]')?.textContent || h2.textContent).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const b = h('<span class="hash" data-cursor="Copy link">#</span>');
      b.onclick = () => copy(`${location.href.split('#')[0]}#${h2.id}`, T('Link copied', 'لینک کپی شد'));
      h2.append(b);
    }
    const toc = $('.toc');
    if (toc) {
      const build = () => {
        toc.innerHTML = `<h6><span lang="en">On this page</span><span lang="fa">در این صفحه</span></h6>` + $$('h2', prose).map((x) => {
          const en = x.querySelector('[lang="en"]')?.textContent || x.firstChild.textContent;
          const fa = x.querySelector('[lang="fa"]')?.textContent || en;
          return `<a href="#${x.id}"><span lang="en">${en}</span><span lang="fa">${fa}</span></a>`;
        }).join('');
      };
      build();
      const io = new IntersectionObserver((ents) => {
        for (const en of ents) if (en.isIntersecting) $$('a', toc).forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
      }, { rootMargin: '-20% 0px -70% 0px' });
      $$('h2', prose).forEach((x) => io.observe(x));
    }
    const idx = DOCS.findIndex((d) => `doc-${d.slug}` === page);
    if (idx >= 0) {
      const pv = DOCS[idx - 1], nx = DOCS[idx + 1];
      const nav = h(`<div class="next">
        ${pv ? `<a class="pv" href="${pv.slug}.html"><small><span lang="en">← Previous</span><span lang="fa">→ قبلی</span></small><b><span lang="en">${pv.en}</span><span lang="fa">${pv.fa}</span></b></a>` : ''}
        ${nx ? `<a class="nx" href="${nx.slug}.html"><small><span lang="en">Next →</span><span lang="fa">بعدی ←</span></small><b><span lang="en">${nx.en}</span><span lang="fa">${nx.fa}</span></b></a>` : ''}
      </div>`);
      prose.append(nav);
    }
  }
  // code blocks: header with a copy button
  for (const cb of $$('.cb')) {
    const pre = $('pre', cb);
    const head = h(`<div class="cb-h"><span>${cb.dataset.title || 'bash'}</span><button class="copy" data-cursor="Copy">copy</button></div>`);
    cb.prepend(head);
    $('.copy', head).onclick = () => copy(pre.innerText.replace(/^\$ /gm, '').trim());
  }
  // tabs
  for (const t of $$('.dtabs')) {
    const btns = $$('.dtabs-bar button', t), panes = $$('.dtabs-pane', t);
    btns.forEach((b, i) => b.addEventListener('click', () => {
      btns.forEach((x) => x.classList.toggle('on', x === b));
      panes.forEach((p, j) => p.classList.toggle('on', j === i));
    }));
  }
}

/* ---------------- boot ---------------- */
header();
if (!root.dataset.nofooter) footer();
hudInit();
cursor();
ctxMenu();
keys();
docsChrome();
reveals();
transitions();
autoButtons();
spotlight('.card, .dl, .hub a');
magnetic();
for (const g of $$('.hub .glyph svg *')) g.setAttribute('pathLength', 1);
addEventListener('kadr:toast', (e) => toast(e.detail));
addEventListener('kadr:lang', () => autoButtons());
export { $, $$, h, T, copy, store, BASE, REPO, fine, still, hud };
export const tilt = spotlight;
