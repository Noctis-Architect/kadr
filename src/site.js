// Read a website for a video brief: title, description, main text, product
// details (JSON-LD), brand color, logo and the biggest images. Images are saved
// to media/site/<host>/ and a summary to brief/site-<host>.md, so the agent and
// the user can see what was taken from the page.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) kadr-video-editor/0.1', accept: 'text/html,application/xhtml+xml' };

async function fetchWithRetry(url, opts, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: ac.signal, redirect: 'follow' });
    } catch (e) {
      if (attempt >= 1) throw new Error(`cannot reach ${new URL(url).host} (${e.name === 'AbortError' ? 'timed out' : e.cause?.code || e.message})`);
      await new Promise((r) => setTimeout(r, 800));
    } finally { clearTimeout(t); }
  }
}

const decode = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || '') : '';
}

/** Product / organization facts from JSON-LD blocks. */
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const list = Array.isArray(j) ? j : j['@graph'] || [j];
      for (const x of list) if (x && typeof x === 'object') out.push(x);
    } catch { /* broken JSON-LD */ }
  }
  const product = out.find((x) => String(x['@type']).includes('Product'));
  const org = out.find((x) => /Organization|LocalBusiness|Store/.test(String(x['@type'])));
  const offer = product && (Array.isArray(product.offers) ? product.offers[0] : product.offers);
  return {
    product: product ? {
      name: product.name, description: clean(product.description || ''), brand: product.brand?.name || product.brand,
      price: offer?.price ? `${offer.price} ${offer.priceCurrency || ''}`.trim() : undefined,
      images: [].concat(product.image || []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean),
    } : null,
    org: org ? { name: org.name, logo: typeof org.logo === 'string' ? org.logo : org.logo?.url, slogan: org.slogan } : null,
  };
}

/**
 * Read `url`. Returns a summary object and writes brief/site-<host>.md plus
 * up to `images` pictures into media/site/<host>/.
 */
export async function readSite(root, url, { images = 8 } = {}) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { throw new Error('that is not a web address'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) addresses');
  const res = await fetchWithRetry(u.href, { headers: UA }, 20000);
  if (!res.ok) throw new Error(`${u.host} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 6e6) throw new Error('the page is too large');
  const html = buf.toString('utf8');
  const base = new URL(res.url || u.href);
  const abs = (x) => { try { return new URL(decode(x), base).href; } catch { return null; } };

  const ld = jsonLd(html);
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ');
  const headings = [...body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(m[2])).filter((x) => x && x.length < 160).slice(0, 20);
  const main = body.match(/<main[\s\S]*?<\/main>/i)?.[0] || body.match(/<article[\s\S]*?<\/article>/i)?.[0] || body;
  const paragraphs = [...main.matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2])).filter((x) => x.length > 25);
  const text = [...new Set(paragraphs)].join('\n').slice(0, 6000);

  const site = {
    url: base.href,
    title: meta(html, 'og:title') || clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
    siteName: meta(html, 'og:site_name') || ld.org?.name || base.hostname.replace(/^www\./, ''),
    description: meta(html, 'og:description') || meta(html, 'description'),
    themeColor: meta(html, 'theme-color') || null,
    language: html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || null,
    product: ld.product,
    slogan: ld.org?.slogan || null,
    headings,
    text,
  };

  // candidate images: og:image, product images, logo / icons, big <img>s
  const cands = [];
  const add = (src, kind, w = 0) => { const a = src && abs(src); if (a && /^https?:/.test(a) && !/\.svg(\?|$)/i.test(a) && !cands.some((c) => c.url === a)) cands.push({ url: a, kind, w }); };
  add(meta(html, 'og:image'), 'share image', 9999);
  for (const i of ld.product?.images || []) add(i, 'product', 9000);
  add(ld.org?.logo, 'logo', 8000);
  const icon = html.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  for (const m of body.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const src = tag.match(/\s(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    const set = tag.match(/\ssrcset=["']([^"']+)["']/i)?.[1];
    const best = set ? set.split(',').map((x) => x.trim().split(/\s+/)).sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0))[0]?.[0] : null;
    const w = parseInt(tag.match(/\swidth=["']?(\d+)/i)?.[1] || '0', 10);
    if (w && w < 200) continue; // icons, avatars, tracking pixels
    if (/logo/i.test(tag)) add(best || src, 'logo', 7000);
    else add(best || src, 'image', w || 500);
  }
  add(icon, 'icon', 100);

  const host = base.hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '');
  const dir = path.join(root, 'media', 'site', host);
  const saved = [];
  for (const c of cands.sort((a, b) => b.w - a.w)) {
    if (saved.length >= images) break;
    try {
      const r = await fetchWithRetry(c.url, { headers: { 'user-agent': UA['user-agent'] } }, 20000);
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\/(jpe?g|png|webp|gif)/.test(type)) continue;
      const data = Buffer.from(await r.arrayBuffer());
      if (data.length < 6000 || data.length > 25e6) continue; // skip pixels and giants
      await fsp.mkdir(dir, { recursive: true });
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg';
      const file = path.join(dir, `${c.kind.replace(/\s+/g, '-')}-${saved.length + 1}.${ext}`);
      await fsp.writeFile(file, data);
      saved.push({ path: path.relative(root, file), kind: c.kind, from: c.url });
    } catch { /* skip images that fail */ }
  }
  site.images = saved;

  const md = [
    `# ${site.title || site.siteName}`,
    '',
    `Read from ${site.url} by kadr. Use it as facts for the video; check prices and claims with the user.`,
    '',
    `- Site: ${site.siteName}`,
    site.description ? `- Description: ${site.description}` : null,
    site.slogan ? `- Slogan: ${site.slogan}` : null,
    site.themeColor ? `- Brand color (theme-color): ${site.themeColor}` : null,
    site.language ? `- Language: ${site.language}` : null,
    site.product ? `- Product: ${site.product.name || ''}${site.product.brand ? ` by ${site.product.brand}` : ''}${site.product.price ? `, price ${site.product.price}` : ''}` : null,
    site.product?.description ? `- Product description: ${site.product.description}` : null,
    '',
    '## Headings',
    ...headings.map((x) => `- ${x}`),
    '',
    '## Images saved',
    ...(saved.length ? saved.map((x) => `- ${x.path} (${x.kind})`) : ['- none could be downloaded']),
    '',
    '## Page text',
    text || '(no readable text)',
  ].filter((x) => x !== null).join('\n');
  const briefDir = path.join(root, 'brief');
  await fsp.mkdir(briefDir, { recursive: true });
  const mdFile = path.join(briefDir, `site-${host}.md`);
  await fsp.writeFile(mdFile, `${md}\n`);
  site.summaryFile = path.relative(root, mdFile);
  if (!fs.existsSync(path.join(briefDir, 'README.md'))) {
    await fsp.writeFile(path.join(briefDir, 'README.md'), '# Brief\n\nWhat the video is about: the brief, notes taken from websites, the user\'s texts.\n');
  }
  return site;
}
