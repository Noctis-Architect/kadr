// Hand-drawn SVG artwork for the editor: empty-state illustrations and a small
// picture for every built-in template. Colors follow the clip palette in
// style.css (purple = compositions, blue = video, green = audio, tan = images).

const A = '#e8ff59';
const P = { bg: '#141417', raise: '#1d1d22', line: '#2a2a31', faint: '#5e5e66', text: '#ececef' };
const C = { html: '#4c406d', htmlI: '#c7b8ef', vid: '#34496a', vidI: '#a9c4ea', aud: '#2c4d40', audI: '#9fe0c1', img: '#5c503a', imgI: '#e4cf9f' };

const svg = (vb, body, cls = '') => `<svg class="art ${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">${body}</svg>`;
const spark = (x, y, r, c = A) => `<path d="M${x} ${y - r}L${x + r * 0.28} ${y - r * 0.28}L${x + r} ${y}L${x + r * 0.28} ${y + r * 0.28}L${x} ${y + r}L${x - r * 0.28} ${y + r * 0.28}L${x - r} ${y}L${x - r * 0.28} ${y - r * 0.28}Z" fill="${c}"/>`;

export const ART = {
  // big empty stage: a screen above a little timeline
  stage: () => svg('0 0 240 150', `
    <defs><linearGradient id="ag1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2340"/><stop offset="1" stop-color="#16202e"/></linearGradient></defs>
    <rect x="40" y="10" width="160" height="90" rx="10" fill="url(#ag1)" stroke="${P.line}"/>
    <circle cx="120" cy="55" r="17" fill="${A}" opacity=".12"/>
    <path d="M114 46v18l15-9z" fill="${A}"/>
    <path d="M56 26h22M56 32h14" stroke="${C.htmlI}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
    <rect x="40" y="110" width="160" height="10" rx="3" fill="${C.vid}"/><rect x="40" y="110" width="58" height="10" rx="3" fill="${C.vidI}" opacity=".35"/>
    <rect x="70" y="124" width="70" height="10" rx="3" fill="${C.html}"/>
    <rect x="40" y="138" width="160" height="8" rx="3" fill="${C.aud}"/>
    <path d="M46 142h4M53 140v4M57 139v6M61 141v2M66 140v4M71 139v6M76 141v2M82 140v4M88 139v6M95 141v2M101 140v4" stroke="${C.audI}" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>
    <rect x="118" y="105" width="2" height="44" rx="1" fill="${A}"/>
    ${spark(206, 18, 7)}${spark(30, 64, 4, C.htmlI)}${spark(214, 84, 3, C.vidI)}`, 'art-stage'),

  // chat: a message bubble that turns into a frame
  chat: () => svg('0 0 200 120', `
    <rect x="22" y="14" width="112" height="44" rx="14" fill="${P.raise}" stroke="${P.line}"/>
    <path d="M40 66l10-9h-14z" fill="${P.raise}"/>
    <path d="M38 30h62M38 42h40" stroke="${P.faint}" stroke-width="4" stroke-linecap="round"/>
    <rect x="86" y="58" width="92" height="52" rx="9" fill="#221d33" stroke="${C.html}"/>
    <path d="M100 76h40" stroke="${C.htmlI}" stroke-width="5" stroke-linecap="round"/><path d="M100 88h26" stroke="${C.htmlI}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
    ${spark(166, 22, 8)}${spark(150, 44, 4, C.htmlI)}`, 'art-chat'),

  // media bin: a photo, a clip and a sound card
  media: () => svg('0 0 200 110', `
    <g transform="rotate(-8 60 60)"><rect x="24" y="22" width="70" height="54" rx="8" fill="#2b2618" stroke="${C.img}"/><path d="M30 68l18-18 12 12 8-8 20 14" stroke="${C.imgI}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="74" cy="36" r="6" fill="${C.imgI}" opacity=".8"/></g>
    <rect x="70" y="30" width="72" height="54" rx="8" fill="#17202d" stroke="${C.vid}"/><path d="M100 48v18l14-9z" fill="${C.vidI}"/>
    <g transform="rotate(7 150 60)"><rect x="124" y="40" width="58" height="44" rx="8" fill="#152620" stroke="${C.aud}"/><path d="M134 62h4M142 54v16M148 50v24M154 57v10M160 52v20M166 59v6" stroke="${C.audI}" stroke-width="3" stroke-linecap="round"/></g>
    ${spark(176, 22, 6)}`, 'art-media'),
};

/** A deterministic gradient poster for something without a picture (project cards). */
export function poster(name = '', ratio = '16 / 9') {
  let hsh = 0;
  for (const ch of String(name)) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  const hue = hsh % 360;
  const hue2 = (hue + 50) % 360;
  const letter = (String(name).trim()[0] || '?').toUpperCase();
  return svg('0 0 160 90', `
    <defs><linearGradient id="pg${hsh}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 35% 20%)"/><stop offset="1" stop-color="hsl(${hue2} 40% 11%)"/></linearGradient></defs>
    <rect width="160" height="90" fill="url(#pg${hsh})"/>
    <circle cx="130" cy="16" r="40" fill="hsl(${hue} 60% 60%)" opacity=".08"/>
    <path d="M14 14h10M14 14v10M146 76h-10M146 76v-10" stroke="hsl(${hue} 60% 75%)" stroke-width="2" stroke-linecap="round" opacity=".5"/>
    <text x="80" y="57" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="34" fill="hsl(${hue} 70% 85%)" opacity=".9">${letter.replace(/[<&>]/g, '')}</text>`, 'art-poster').replace('<svg ', `<svg style="aspect-ratio:${ratio}" preserveAspectRatio="xMidYMid slice" `);
}

// ---------- template pictures (16:9, drawn at 160×90) ----------
const frame = (body, bg = '#15151a') => svg('0 0 160 90', `<rect width="160" height="90" rx="0" fill="${bg}"/>${body}`, 'art-tpl');
const bar = (x, y, w, hgt, c, o = 1, r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${r}" fill="${c}" opacity="${o}"/>`;

const TPL = {
  'title.html': () => frame(`${bar(18, 46, 22, 3, A)}${bar(18, 53, 92, 10, P.text)}${bar(18, 68, 58, 5, P.text, 0.45)}`),
  'text.html': () => frame(`<text x="80" y="56" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="30" fill="${P.text}">Aa</text>${bar(56, 64, 48, 2, A)}`),
  'lower-third.html': () => frame(`<rect width="160" height="90" fill="#1d2633"/>${bar(14, 56, 3, 22, A, 1, 1)}${bar(17, 56, 70, 22, '#0c0c0e', 0.85, 1)}${bar(24, 61, 46, 6, P.text)}${bar(24, 71, 30, 3, P.text, 0.5)}`),
  'kinetic.html': () => frame(['M', 'O', 'V', 'E'].map((ch, i) => `<text x="${40 + i * 22}" y="${54 + (i % 2 ? -6 : 6)}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="26" fill="${i === 2 ? A : P.text}" opacity="${1 - i * 0.12}" transform="rotate(${i % 2 ? -6 : 6} ${40 + i * 22} 48)">${ch}</text>`).join('')),
  'captions.html': () => frame(`<rect width="160" height="90" fill="#202733"/>${bar(28, 62, 26, 9, P.text)}${bar(58, 60, 34, 13, A)}${bar(96, 62, 36, 9, P.text, 0.55)}`),
  'counter.html': () => frame(`<circle cx="80" cy="44" r="26" stroke="${P.line}" stroke-width="5"/><circle cx="80" cy="44" r="26" stroke="${A}" stroke-width="5" stroke-dasharray="140 200" stroke-linecap="round" transform="rotate(-90 80 44)"/><text x="80" y="51" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="19" fill="${P.text}">87%</text>`),
  'end-card.html': () => frame(`${bar(40, 26, 80, 9, P.text)}${bar(54, 40, 52, 4, P.text, 0.5)}<rect x="58" y="54" width="44" height="14" rx="7" fill="${A}"/>${bar(70, 60, 20, 2, '#121400')}`, '#0d0d10'),
  'wipe.html': () => frame(`<path d="M0 0h96L64 90H0z" fill="${C.vid}"/><path d="M96 0h64v90H64z" fill="${C.html}"/><path d="M96 0L64 90" stroke="${A}" stroke-width="3"/>`),
  'quote.html': () => frame(`<text x="22" y="46" font-family="Georgia,serif" font-size="46" fill="${A}">“</text>${bar(46, 30, 92, 7, P.text)}${bar(46, 42, 76, 7, P.text)}${bar(46, 56, 34, 3, P.text, 0.5)}`, '#16131c'),
  'logo-reveal.html': () => frame(`<circle cx="80" cy="45" r="30" stroke="${A}" stroke-width="1.5" opacity=".25"/><circle cx="80" cy="45" r="20" stroke="${A}" stroke-width="1.5" opacity=".5"/><rect x="68" y="33" width="24" height="24" rx="7" fill="${A}"/><path d="M76 40v10l8-5z" fill="#121400"/><path d="M40 20L120 70" stroke="#fff" stroke-width="10" opacity=".06"/>`, '#0b0b0e'),
  'subscribe.html': () => frame(`<rect x="34" y="34" width="70" height="22" rx="11" fill="#ff3b30"/>${bar(46, 43, 46, 4, '#fff')}<circle cx="120" cy="45" r="11" fill="${P.raise}"/><path d="M115 48h10l-1.5-2v-4a3.5 3.5 0 0 0-7 0v4z" fill="${P.text}"/><path d="M98 62l6 6 3-3" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`),
  'bars.html': () => frame(`${bar(26, 66, 108, 1.5, P.line)}${[38, 26, 48, 18].map((v, i) => bar(32 + i * 26, 66 - v, 16, v, i === 2 ? A : C.vidI, i === 2 ? 1 : 0.7, 2)).join('')}`),
  'countdown.html': () => frame(`<circle cx="80" cy="45" r="28" stroke="${P.line}" stroke-width="3"/><path d="M80 17a28 28 0 0 1 24 42" stroke="${A}" stroke-width="3" stroke-linecap="round"/><text x="80" y="57" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="34" fill="${P.text}">3</text>`),
  'callout.html': () => frame(`<rect width="160" height="90" fill="#1f2a26"/><circle cx="52" cy="50" r="17" stroke="${A}" stroke-width="2.5"/><path d="M70 40C88 26 100 24 112 26" stroke="${A}" stroke-width="2.5" stroke-linecap="round"/><path d="M106 21l7 5-6 6" stroke="${A}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="112" y="18" width="38" height="16" rx="4" fill="${A}"/>`),
};

export function templateArt(path) {
  const f = TPL[String(path).replace(/^@kadr\//, '')];
  return f ? f() : frame(`${spark(80, 45, 14, C.htmlI)}`);
}

export const sparkSvg = (r = 7, c = A) => svg(`0 0 ${r * 2} ${r * 2}`, spark(r, r, r, c), 'art-spark');
