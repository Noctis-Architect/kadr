// Stock photos and videos from free libraries, for `kadr stock` and the
// editor's "Find photos & videos" dialog. Wikimedia Commons and Openverse need
// no key (free licenses, some need credit); Pexels and Pixabay need a free key.
// Every download is credited in media/stock/CREDITS.md with its license.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadSettings, keyFor } from './settings.js';

// Wikimedia asks for a descriptive agent name; generic ones get rate-limited.
const UA = { 'user-agent': 'kadr/0.1 (open-source local video editor; stock search for the user\'s own project) node-fetch' };

/** GET JSON, with one retry when the connection drops (common on flaky networks). */
async function getJson(url, headers = {}) {
  try { return await getJsonOnce(url, headers); } catch (e) {
    if (!/cannot reach|took too long/.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, 800));
    return getJsonOnce(url, headers);
  }
}

async function getJsonOnce(url, headers = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: ac.signal });
    const keyed = /pexels|pixabay/.test(url);
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}${keyed && (r.status === 401 || r.status === 403) ? ' (check the API key)' : ''}`);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${new URL(url).host} took too long`);
    throw e.cause?.code ? new Error(`cannot reach ${new URL(url).host} (${e.cause.code})`) : e;
  } finally { clearTimeout(t); }
}

export const STOCK_PROVIDERS = ['wikimedia', 'pexels', 'pixabay', 'openverse'];

/** Which library to use: the one asked for, else the first with a key, else Wikimedia Commons. */
export function pickProvider(s, type, wanted) {
  const have = { pexels: !!keyFor(s, 'pexels'), pixabay: !!keyFor(s, 'pixabay'), openverse: true, wikimedia: true };
  if (wanted && !(wanted in have)) throw new Error(`unknown library: ${wanted} (${STOCK_PROVIDERS.join(', ')})`);
  if (wanted) {
    if (!have[wanted]) throw new Error(`${wanted} needs a free API key: add it in AI settings → API keys`);
    if (wanted === 'openverse' && type === 'video') throw new Error('Openverse has photos only; use Pexels or Pixabay for video');
    return wanted;
  }
  if (have.pexels) return 'pexels';
  if (have.pixabay) return 'pixabay';
  return 'wikimedia';
}

/**
 * Search. type: 'photo' | 'video'; orientation: 'landscape' | 'portrait' | 'square' | ''.
 * Returns { provider, results: [{ id, provider, type, title, thumb, url, width, height, duration, author, license, page }] }.
 */
export async function searchStock(query, opts = {}) {
  try {
    return await searchOne(query, opts);
  } catch (e) {
    // No library asked for and the default one can't be reached (blocked or
    // rate-limited network): try the next free one for photos.
    if (opts.provider || (opts.type || 'photo') !== 'photo' || !/cannot reach|took too long|answered 429|answered 5/.test(e.message)) throw e;
    const r = await searchOne(query, { ...opts, provider: 'openverse' });
    return { ...r, note: `the first library failed (${e.message}); these are from Openverse` };
  }
}

async function searchOne(query, { type = 'photo', orientation = '', count = 12, provider } = {}) {
  const s = loadSettings();
  const prov = pickProvider(s, type, provider);
  const n = Math.max(1, Math.min(40, count | 0 || 12));
  const q = encodeURIComponent(query);
  let results = [];
  if (prov === 'pexels') {
    const key = keyFor(s, 'pexels');
    const o = orientation ? `&orientation=${orientation}` : '';
    if (type === 'video') {
      const j = await getJson(`https://api.pexels.com/videos/search?query=${q}&per_page=${n}${o}`, { authorization: key });
      results = (j.videos || []).map((v) => {
        const files = (v.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.link);
        // the file closest to 1920 px wide (or tall, for portrait)
        const best = files.sort((a, b) => Math.abs(Math.max(a.width, a.height) - 1920) - Math.abs(Math.max(b.width, b.height) - 1920))[0];
        return best && { id: `pexels-v${v.id}`, provider: 'pexels', type: 'video', title: v.url?.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') || 'video', thumb: v.image, url: best.link, width: best.width, height: best.height, duration: v.duration, author: v.user?.name || '', license: 'Pexels License (free to use, no attribution required)', page: v.url };
      }).filter(Boolean);
    } else {
      const j = await getJson(`https://api.pexels.com/v1/search?query=${q}&per_page=${n}${o}`, { authorization: key });
      results = (j.photos || []).map((p) => ({ id: `pexels-p${p.id}`, provider: 'pexels', type: 'photo', title: p.alt || 'photo', thumb: p.src?.medium, url: p.src?.large2x || p.src?.original, width: p.width, height: p.height, author: p.photographer || '', license: 'Pexels License (free to use, no attribution required)', page: p.url }));
    }
  } else if (prov === 'pixabay') {
    const key = keyFor(s, 'pixabay');
    const o = orientation === 'landscape' ? '&orientation=horizontal' : orientation === 'portrait' ? '&orientation=vertical' : '';
    const per = Math.max(3, n);
    if (type === 'video') {
      const j = await getJson(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${q}&per_page=${per}&safesearch=true`);
      results = (j.hits || []).map((v) => {
        const f = v.videos?.large?.url ? v.videos.large : v.videos?.medium?.url ? v.videos.medium : v.videos?.small;
        return f?.url && { id: `pixabay-v${v.id}`, provider: 'pixabay', type: 'video', title: v.tags || 'video', thumb: f.thumbnail || v.videos?.tiny?.thumbnail, url: f.url, width: f.width, height: f.height, duration: v.duration, author: v.user || '', license: 'Pixabay Content License (free to use, no attribution required)', page: v.pageURL };
      }).filter(Boolean).filter((v) => !orientation || (orientation === 'portrait' ? v.height > v.width : orientation === 'landscape' ? v.width > v.height : true));
    } else {
      const j = await getJson(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}&image_type=photo&per_page=${per}&safesearch=true${o}`);
      results = (j.hits || []).map((p) => ({ id: `pixabay-p${p.id}`, provider: 'pixabay', type: 'photo', title: p.tags || 'photo', thumb: p.webformatURL, url: p.largeImageURL || p.webformatURL, width: p.imageWidth, height: p.imageHeight, author: p.user || '', license: 'Pixabay Content License (free to use, no attribution required)', page: p.pageURL }));
    }
  } else if (prov === 'wikimedia') {
    const filter = type === 'video' ? 'filetype:video' : 'filetype:bitmap';
    const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6'
      + `&gsrsearch=${encodeURIComponent(`${query} ${filter}`)}&gsrlimit=${Math.min(40, n * 2)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=480`;
    const j = await getJson(api);
    const strip = (x) => String(x || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    results = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map((pg) => {
      const ii = pg.imageinfo?.[0];
      if (!ii?.url) return null;
      const md = ii.extmetadata || {};
      const isVideo = String(ii.mime || '').startsWith('video/');
      // big photos: a 1920 px rendition instead of the (often huge) original
      const big = !isVideo && ii.thumburl && ii.width > 2400 ? ii.thumburl.replace(/\/\d+px-/, '/1920px-') : ii.url;
      return {
        id: `wikimedia-${pg.pageid}`, provider: 'wikimedia', type: isVideo ? 'video' : 'photo',
        title: strip(md.ObjectName?.value) || pg.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
        thumb: ii.thumburl || ii.url, url: big, width: ii.width, height: ii.height, duration: ii.duration,
        author: strip(md.Artist?.value).slice(0, 120), license: `${strip(md.LicenseShortName?.value) || 'see page'}${md.AttributionRequired?.value === 'true' ? ' (credit the author)' : ''}`,
        page: ii.descriptionurl,
      };
    }).filter(Boolean).filter((x) => {
      if (!orientation || !x.width) return true;
      const r = x.width / x.height;
      return orientation === 'landscape' ? r > 1.15 : orientation === 'portrait' ? r < 0.87 : r >= 0.87 && r <= 1.15;
    });
  } else {
    const ar = orientation === 'landscape' ? '&aspect_ratio=wide' : orientation === 'portrait' ? '&aspect_ratio=tall' : orientation === 'square' ? '&aspect_ratio=square' : '';
    // only licenses that allow commercial use and changes (crop, text on top): safe for promos
    // anonymous requests may ask for at most 20 results
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${q}&page_size=${Math.min(20, n)}${ar}&mature=false&license_type=commercial,modification`);
    results = (j.results || []).map((p) => ({
      id: `openverse-${p.id}`, provider: 'openverse', type: 'photo', title: p.title || 'photo', thumb: p.thumbnail || p.url, url: p.url, width: p.width, height: p.height,
      author: p.creator || '', license: `${String(p.license || '').toUpperCase()} ${p.license_version || ''}`.trim() + (p.license_url ? ` (${p.license_url})` : ''), page: p.foreign_landing_url,
    }));
  }
  return { provider: prov, results: results.slice(0, n) };
}

const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'stock';

/** Download one search result into media/stock/ and credit it. Returns the project-relative path. */
export async function downloadStock(root, item) {
  if (!item?.url || !/^https:\/\//.test(item.url)) throw new Error('bad stock item');
  const dir = path.join(root, 'media', 'stock');
  await fsp.mkdir(dir, { recursive: true });
  const fromUrl = path.extname(new URL(item.url).pathname).toLowerCase();
  const ext = item.type === 'video' ? (['.webm', '.ogv', '.mov', '.mp4'].includes(fromUrl) ? fromUrl : '.mp4') : ['.jpg', '.jpeg', '.png', '.webp'].includes(fromUrl) ? fromUrl : '.jpg';
  const file = path.join(dir, `${slug(item.title)}-${String(item.id).replace(/[^\w-]/g, '')}${ext}`);
  if (!fs.existsSync(file)) {
    const host = new URL(item.url).host;
    for (let attempt = 1; ; attempt++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 180000);
      try {
        const r = await fetch(item.url, { headers: UA, signal: ac.signal });
        if (!r.ok) throw Object.assign(new Error(`${host} answered ${r.status}`), { final: r.status !== 429 && r.status < 500 });
        const len = Number(r.headers.get('content-length') || 0);
        if (len > 400e6) throw Object.assign(new Error('file too large (over 400 MB)'), { final: true });
        const tmp = `${file}.part`;
        await fsp.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
        await fsp.rename(tmp, file);
        break;
      } catch (e) {
        // connections drop on some networks: try again twice before giving up
        if (e.final || attempt >= 3) throw new Error(e.final ? `download failed: ${e.message}` : `download failed: cannot reach ${host} (${e.name === 'AbortError' ? 'timed out' : e.cause?.code || e.message})`);
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      } finally { clearTimeout(t); }
    }
    const line = `- ${path.basename(file)}: "${item.title}" by ${item.author || 'unknown'} via ${item.provider}, ${item.license}. ${item.page || ''}\n`;
    const credits = path.join(dir, 'CREDITS.md');
    if (!fs.existsSync(credits)) await fsp.writeFile(credits, '# Stock media used in this project\n\nKeep this list: some licenses (Creative Commons BY) require crediting the author in the video description.\n\n');
    await fsp.appendFile(credits, line);
  }
  return path.relative(root, file);
}
