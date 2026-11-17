// Media generation through the services set up in kadr's settings:
// images (text-to-image), speech (text-to-speech) and transcripts with word
// timing (speech-to-text). Used by `kadr gen ...`, so every agent can call it.
// Files land in media/gen/ and the path is returned.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadSettings, service } from './settings.js';
import { run } from './media.js';

const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'gen';

function need(kind, label) {
  const s = service(loadSettings(), kind);
  if (!s) throw new Error(`no ${label} service is set up: open the editor's Chat tab → settings, or edit ${'~/.config/kadr/settings.json'}`);
  if (s.needsKey && !s.key) throw new Error(`${s.name} needs an API key: add it in the editor's Chat tab → settings`);
  if (s.kind !== 'piper' && s.kind !== 'espeak' && !s.baseUrl) throw new Error(`${s.name}: set a base URL in settings`);
  return s;
}

async function outPath(root, out, base, ext) {
  let file = out ? path.resolve(root, out) : null;
  if (!file) {
    const dir = path.join(root, 'media', 'gen');
    await fsp.mkdir(dir, { recursive: true });
    for (let i = 1; ; i++) {
      file = path.join(dir, `${slug(base)}${i > 1 ? `-${i}` : ''}.${ext}`);
      if (!fs.existsSync(file)) break;
    }
  } else await fsp.mkdir(path.dirname(file), { recursive: true });
  return file;
}

async function call(url, init, what) {
  let res;
  try { res = await fetch(url, init); } catch (e) { throw new Error(`${what}: cannot reach ${new URL(url).host} (${e.cause?.code || e.message})`); }
  if (!res.ok) {
    let msg = await res.text().catch(() => '');
    try { const j = JSON.parse(msg); msg = j.error?.message || j.detail?.message || j.detail || j.message || msg; } catch { /* plain text */ }
    throw new Error(`${what}: HTTP ${res.status} ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300)}`);
  }
  return res;
}

const bearer = (s) => ({ 'content-type': 'application/json', ...(s.key ? { authorization: `Bearer ${s.key}` } : {}) });

/** Text to image. size like "1024x1536" (portrait) or "1536x1024" (landscape). */
export async function genImage(root, prompt, { size = '1024x1024', out } = {}) {
  const s = need('image', 'image');
  let buf;
  if (s.kind === 'gemini') {
    const [w, h] = size.split('x').map(Number);
    const ratio = w && h ? (w > h * 1.2 ? '16:9' : h > w * 1.2 ? '9:16' : '1:1') : '1:1';
    const res = await call(`${s.baseUrl}/models/${encodeURIComponent(s.model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': s.key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } } }),
    }, s.name);
    const j = await res.json();
    const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
    if (!part) throw new Error(`${s.name} returned no image${j.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ''}`);
    buf = Buffer.from(part.inlineData.data, 'base64');
  } else {
    const res = await call(`${s.baseUrl}/images/generations`, {
      method: 'POST', headers: bearer(s), body: JSON.stringify({ model: s.model || undefined, prompt, size, n: 1 }),
    }, s.name);
    const d = (await res.json()).data?.[0];
    if (d?.b64_json) buf = Buffer.from(d.b64_json, 'base64');
    else if (d?.url) buf = Buffer.from(await (await call(d.url, {}, s.name)).arrayBuffer());
    else throw new Error(`${s.name} returned no image`);
  }
  const file = await outPath(root, out, prompt, 'png');
  // Normalise to PNG whatever came back (some services send JPEG/WebP).
  const tmp = path.join(os.tmpdir(), `kadr-img-${process.pid}-${Date.now()}`);
  await fsp.writeFile(tmp, buf);
  try { await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', tmp, '-frames:v', '1', '-update', '1', file]); } finally { await fsp.rm(tmp, { force: true }); }
  return file;
}

function pipeTo(bin, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => reject(new Error(`${bin}: ${e.message}`)));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${bin} failed: ${err.trim().split('\n').pop() || c}`))));
    p.stdin.end(input);
  });
}

/** Text to speech. Returns the audio file (mp3, or wav for the local engines). */
export async function genSpeech(root, text, { voice, out, instructions } = {}) {
  const s = need('speech', 'voice');
  const v = voice || s.voice;
  if (s.kind === 'espeak' || s.kind === 'piper') {
    const file = await outPath(root, out, text, 'wav');
    if (s.kind === 'espeak') await pipeTo(s.bin, ['-v', v || 'en', '-w', file, '--stdin'], text);
    else {
      if (!s.model) throw new Error('Piper needs a voice model: set the path to a .onnx file in settings');
      await pipeTo(s.bin, ['--model', s.model, '--output_file', file], text);
    }
    return file;
  }
  let res;
  if (s.kind === 'elevenlabs') {
    if (!v) throw new Error('ElevenLabs needs a voice id: set it in settings or pass --voice');
    res = await call(`${s.baseUrl}/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': s.key },
      body: JSON.stringify({ text, model_id: s.model || undefined }),
    }, s.name);
  } else {
    res = await call(`${s.baseUrl}/audio/speech`, {
      method: 'POST', headers: bearer(s),
      body: JSON.stringify({ model: s.model || undefined, voice: v || 'alloy', input: text, response_format: 'mp3', ...(instructions ? { instructions } : {}) }),
    }, s.name);
  }
  const file = await outPath(root, out, text, 'mp3');
  await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/**
 * Speech to text with word timing. Writes JSON next to the media:
 * { text, language, words: [{w, s, e}], segments: [{text, s, e}] } (seconds in the file).
 */
export async function transcribe(root, src, { language, out, from = 0, span } = {}) {
  const s = need('transcribe', 'transcription');
  const abs = path.resolve(root, src);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${src}`);
  // Small mono mp3 keeps uploads far under the usual 25 MB limit (~1 h of speech).
  const tmp = path.join(os.tmpdir(), `kadr-stt-${process.pid}-${Date.now()}.mp3`);
  const cut = [...(from ? ['-ss', String(from)] : []), ...(span ? ['-t', String(span)] : [])];
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...cut, '-i', abs, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', tmp]);
  try {
    const form = new FormData();
    form.append('file', new Blob([await fsp.readFile(tmp)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', s.model || 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    const res = await call(`${s.baseUrl}/audio/transcriptions`, { method: 'POST', headers: s.key ? { authorization: `Bearer ${s.key}` } : {}, body: form }, s.name);
    const j = await res.json();
    const r3 = (n) => Math.round((Number(n) + from) * 1000) / 1000;
    const result = {
      source: path.relative(root, abs), text: (j.text || '').trim(), language: j.language || language || null,
      words: (j.words || []).map((w) => ({ w: String(w.word).trim(), s: r3(w.start), e: r3(w.end) })).filter((w) => w.w),
      segments: (j.segments || []).map((g) => ({ text: String(g.text).trim(), s: r3(g.start), e: r3(g.end) })),
    };
    const file = await outPath(root, out, `${path.parse(abs).name}-transcript`, 'json');
    await fsp.writeFile(file, `${JSON.stringify(result, null, 1)}\n`);
    return { file, result };
  } finally { await fsp.rm(tmp, { force: true }); }
}
