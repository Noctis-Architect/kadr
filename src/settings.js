// User settings shared by every project: which agent the chat runs and which
// API services (with keys) kadr may call. Stored in the user's config folder
// with owner-only permissions, never inside a project, so keys don't end up in
// a project folder that gets shared or committed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENTS, SERVICES, KEYS, LLM, CLAUDE_VIA } from '../shared/providers.js';

export function settingsFile() {
  if (process.env.KADR_CONFIG) return path.resolve(process.env.KADR_CONFIG);
  const base = process.env.XDG_CONFIG_HOME || (process.platform === 'win32' ? process.env.APPDATA : null) || path.join(os.homedir(), '.config');
  return path.join(base, 'kadr', 'settings.json');
}

const DEFAULTS = { agent: 'claude', keys: {}, custom: {}, claudeVia: {}, llm: { provider: 'anthropic' }, image: {}, speech: {}, transcribe: {} };

// Environment keys used when a service has no key saved.
const ENV_KEYS = {
  anthropic: ['ANTHROPIC_API_KEY'], openai: ['OPENAI_API_KEY'], openrouter: ['OPENROUTER_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], elevenlabs: ['ELEVENLABS_API_KEY'], groq: ['GROQ_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'], zai: ['ZAI_API_KEY', 'ZHIPU_API_KEY'], moonshot: ['MOONSHOT_API_KEY'], qwen: ['DASHSCOPE_API_KEY'],
  mistral: ['MISTRAL_API_KEY'], xai: ['XAI_API_KEY'], pexels: ['PEXELS_API_KEY'], pixabay: ['PIXABAY_API_KEY'],
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { /* first run */ }
  const out = { ...DEFAULTS, ...s };
  for (const k of Object.keys(SERVICES)) out[k] = { ...(DEFAULTS[k] || {}), ...(s[k] || {}) };
  out.keys = { ...(s.keys || {}) };
  out.custom = { ...(s.custom || {}) };
  out.claudeVia = { ...(s.claudeVia || {}) };
  // Older settings kept a key per service: share it per provider instead.
  for (const k of Object.keys(SERVICES)) {
    const c = out[k];
    if (c.key && KEYS[c.provider]) { if (!out.keys[c.provider]) out.keys[c.provider] = c.key; delete c.key; }
  }
  if (!AGENTS[out.agent]) out.agent = 'claude';
  return out;
}

export async function saveSettings(s) {
  const f = settingsFile();
  await fsp.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(tmp, f);
}

/** Fully resolved config for one service, or null if it is not set up. */
export function service(s, kind) {
  const cfg = s[kind] || {};
  const cat = SERVICES[kind];
  const p = cat?.[cfg.provider];
  if (!p) return null;
  const key = keyFor(s, cfg.provider) || cfg.key || '';
  return {
    provider: cfg.provider, kind: p.kind, name: p.name, bin: p.bin,
    baseUrl: String(cfg.baseUrl || p.baseUrl || '').replace(/\/+$/, ''),
    model: cfg.model || p.model || '', voice: cfg.voice ?? p.voice ?? '', key, needsKey: !!p.key,
  };
}

/** The key for a provider: saved, else from the environment. */
export function keyFor(s, provider) {
  return (KEYS[provider] && s.keys?.[provider]) || (ENV_KEYS[provider] || []).map((e) => process.env[e]).find(Boolean) || '';
}

const mask = (k) => (k ? `••••${String(k).slice(-4)}` : '');

/** What the browser may see: everything except the keys themselves. */
export function publicSettings(s) {
  const { key: viaKey, ...via } = s.claudeVia || {};
  const out = { agent: s.agent, file: settingsFile(), keys: {}, custom: s.custom || {}, claudeVia: { ...via, keySaved: mask(viaKey) } };
  for (const p of Object.keys(KEYS)) out.keys[p] = { saved: mask(s.keys?.[p]), env: !s.keys?.[p] && !!keyFor(s, p) };
  for (const k of Object.keys(SERVICES)) {
    const { key, ...rest } = s[k] || {};
    const r = service(s, k);
    out[k] = { ...rest, keySaved: mask(key), keyFromEnv: !key && !!r?.key };
  }
  return out;
}

/** Merge a settings update from the UI. A key left empty keeps the saved one; `clearKey` removes it. */
export function mergeSettings(cur, patch) {
  const next = { ...cur };
  if (patch.agent && AGENTS[patch.agent]) next.agent = patch.agent;
  next.keys = { ...(cur.keys || {}) };
  if (patch.custom && typeof patch.custom === 'object') {
    next.custom = { ...(cur.custom || {}) };
    for (const f of ['name', 'command']) if (typeof patch.custom[f] === 'string') next.custom[f] = patch.custom[f].trim() || undefined;
  }
  if (patch.claudeVia && typeof patch.claudeVia === 'object') {
    const v = { ...(cur.claudeVia || {}) };
    const pv = patch.claudeVia;
    if (pv.provider !== undefined) {
      if (pv.provider && !CLAUDE_VIA[pv.provider]) throw new Error(`unknown provider: ${pv.provider}`);
      if (pv.provider !== v.provider) { delete v.model; delete v.baseUrl; delete v.key; }
      v.provider = pv.provider || undefined;
    }
    for (const f of ['model', 'baseUrl']) if (typeof pv[f] === 'string') v[f] = pv[f].trim() || undefined;
    if (typeof pv.key === 'string' && pv.key.trim()) { if (KEYS[v.provider]) next.keys[v.provider] = pv.key.trim(); else v.key = pv.key.trim(); }
    if (pv.clearKey) delete v.key;
    next.claudeVia = JSON.parse(JSON.stringify(v));
  }
  for (const [p, v] of Object.entries(patch.keys || {})) {
    if (!KEYS[p]) throw new Error(`unknown provider: ${p}`);
    if (v === null || v === '') delete next.keys[p];
    else if (typeof v === 'string') next.keys[p] = v.trim();
  }
  for (const k of Object.keys(SERVICES)) {
    const p = patch[k];
    if (!p || typeof p !== 'object') continue;
    const c = { ...(cur[k] || {}) };
    if (p.provider !== undefined) {
      if (p.provider && !SERVICES[k][p.provider]) throw new Error(`unknown ${k} provider: ${p.provider}`);
      if (p.provider !== c.provider) { delete c.key; delete c.model; delete c.baseUrl; delete c.voice; }
      c.provider = p.provider || undefined;
    }
    for (const f of ['model', 'baseUrl', 'voice']) if (typeof p[f] === 'string') c[f] = p[f].trim() || undefined;
    if (typeof p.key === 'string' && p.key.trim()) {
      if (KEYS[c.provider]) next.keys[c.provider] = p.key.trim(); else c.key = p.key.trim();
    }
    if (p.clearKey) { delete c.key; if (KEYS[c.provider]) delete next.keys[c.provider]; }
    next[k] = JSON.parse(JSON.stringify(c));
  }
  return next;
}

/** Check a key with a cheap, free request. Returns { ok, message }. */
export async function testKey(provider, key, baseUrl) {
  if (!key) return { ok: false, message: 'no key saved' };
  const get = async (url, headers) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(url, { headers, signal: ac.signal });
      const body = await r.text();
      return { status: r.status, body };
    } catch (e) {
      return { status: 0, body: e.name === 'AbortError' ? 'timed out' : (e.cause?.code || e.message) };
    } finally { clearTimeout(timer); }
  };
  const bearer = { authorization: `Bearer ${key}` };
  const url = {
    anthropic: ['https://api.anthropic.com/v1/models', { 'x-api-key': key, 'anthropic-version': '2026-10-21' }],
    openai: ['https://api.openai.com/v1/models', bearer],
    gemini: ['https://generativelanguage.googleapis.com/v1beta/openai/models', bearer],
    openrouter: ['https://openrouter.ai/api/v1/key', bearer],
    groq: ['https://api.groq.com/openai/v1/models', bearer],
    ...Object.fromEntries(['deepseek', 'zai', 'moonshot', 'qwen', 'mistral', 'xai'].map((k) => [k, [`${LLM[k].baseUrl}/models`, bearer]])),
    elevenlabs: ['https://api.elevenlabs.io/v1/user', { 'xi-api-key': key }],
    pexels: ['https://api.pexels.com/v1/curated?per_page=1', { authorization: key }],
    pixabay: [`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=test&per_page=3`, {}],
    custom: [`${String(baseUrl || '').replace(/\/+$/, '')}/models`, bearer],
  }[provider];
  if (!url || !url[0].startsWith('http')) return { ok: false, message: 'cannot test this one' };
  const r = await get(...url);
  if (r.status >= 200 && r.status < 300) return { ok: true, message: 'the key works' };
  // A key limited to some features can't read the account but is still valid.
  if (provider === 'elevenlabs' && r.status === 401 && /permission/i.test(r.body)) return { ok: true, message: 'the key works (limited permissions)' };
  if (r.status === 0) return { ok: false, message: `cannot reach the service (${r.body})` };
  if (r.status === 401 || r.status === 403) return { ok: false, message: 'the key was rejected' };
  return { ok: false, message: `the service answered ${r.status}` };
}

/** Env for running Claude Code on another Anthropic-compatible service, or null. */
export function claudeEnv(s) {
  const v = s.claudeVia || {};
  const p = CLAUDE_VIA[v.provider];
  if (!p) return null;
  const baseUrl = String(v.baseUrl || p.baseUrl || '').replace(/\/+$/, '');
  const key = keyFor(s, v.provider) || v.key || '';
  if (!baseUrl) throw new Error('Claude Code via another service: set its base URL in AI settings');
  if (!key) throw new Error(`Claude Code via ${p.name}: add the API key in AI settings`);
  const model = v.model || p.model || '';
  return {
    name: p.name,
    env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: key, ...(model ? { ANTHROPIC_MODEL: model, ANTHROPIC_SMALL_FAST_MODEL: model } : {}) },
  };
}
