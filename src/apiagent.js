// Built-in agent for chat over a model API (agent = "api" in settings).
// kadr runs the tool loop itself: the model gets a few file tools and a
// command tool, all confined to the project folder. Speaks two wire formats:
// the Anthropic Messages API and the OpenAI-compatible chat completions API
// (OpenAI, OpenRouter, Gemini, Ollama, ...). Plain fetch: kadr has no npm
// dependencies.
//
// History is kept in Anthropic's message shape (provider-neutral enough) and is
// only ever appended to, never edited.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_DIR, safeJoin } from './project.js';

const ANTHROPIC_VERSION = '2026-10-21';
const MAX_STEPS = 80;
const OUT_CAP = 24000;

const TOOLS = [
  { name: 'list_files', description: 'List files under a folder of the project (recursive, skips .kadr, .git, node_modules).', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Folder relative to the project root, default "."' } }, additionalProperties: false } },
  { name: 'read_file', description: 'Read a text file of the project.', input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'First line (1-based)' }, limit: { type: 'integer', description: 'Number of lines' } }, required: ['path'], additionalProperties: false } },
  { name: 'write_file', description: 'Create or overwrite a text file of the project.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'edit_file', description: 'Replace an exact piece of text in a file. old_string must match exactly once unless replace_all is true. Read the file first.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false } },
  { name: 'run', description: 'Run a command in the project folder and get its output, e.g. "kadr validate", "kadr frame 3.5", "kadr gen image \\"...\\"", "ffprobe media/a.mp4". No pipes or redirects.', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } },
  { name: 'view_image', description: 'Look at a PNG/JPEG of the project, e.g. a frame written by kadr frame or kadr sheet.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
];

const LIMITED_CMDS = new Set(['kadr', 'ffmpeg', 'ffprobe', 'ls', 'cat', 'head', 'tail', 'wc', 'file', 'mkdir', 'cp', 'mv', 'find', 'grep']);

/** Split a command line into argv (quotes and backslashes; no shell features). */
export function splitArgs(s) {
  const out = [];
  let cur = '';
  let q = null;
  let any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { q = c; any = true; } else if (c === '\\' && i + 1 < s.length) { cur += s[++i]; any = true; } else if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; } else { cur += c; any = true; }
  }
  if (q) throw new Error('unclosed quote');
  if (cur || any) out.push(cur);
  return out;
}

const cap = (s) => (s.length > OUT_CAP ? `${s.slice(0, OUT_CAP / 2)}\n… [${s.length - OUT_CAP} characters cut] …\n${s.slice(-OUT_CAP / 2)}` : s);

export class ApiAgent {
  constructor(root, svc, { full = false, signal } = {}) {
    this.root = root;
    this.svc = svc;
    this.full = full;
    this.signal = signal;
    this.children = new Set();
  }

  abs(p) {
    const a = safeJoin(this.root, String(p || '.'));
    if (!a) throw new Error(`path outside the project: ${p}`);
    if (/(^|\/)\.git(\/|$)/.test(path.relative(this.root, a))) throw new Error('.git is off limits');
    return a;
  }

  // ---------- tools ----------
  async tool(name, input) {
    switch (name) {
      case 'list_files': {
        const base = this.abs(input.path || '.');
        const out = [];
        const walk = async (d, depth) => {
          if (out.length >= 400 || depth > 6) return;
          for (const e of (await fsp.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            if (['.kadr', '.git', 'node_modules'].includes(e.name)) continue;
            const p = path.join(d, e.name);
            out.push(path.relative(this.root, p) + (e.isDirectory() ? '/' : ''));
            if (e.isDirectory()) await walk(p, depth + 1);
          }
        };
        await walk(base, 0);
        return out.join('\n') || '(empty)';
      }
      case 'read_file': {
        const a = this.abs(input.path);
        const st = await fsp.stat(a);
        if (st.size > 2e6) throw new Error('file too large to read as text');
        let lines = (await fsp.readFile(a, 'utf8')).split('\n');
        const from = Math.max(1, input.offset || 1);
        lines = lines.slice(from - 1, input.limit ? from - 1 + input.limit : undefined);
        return cap(lines.join('\n'));
      }
      case 'write_file': {
        const a = this.abs(input.path);
        await fsp.mkdir(path.dirname(a), { recursive: true });
        await this.atomicWrite(a, String(input.content ?? ''));
        return `wrote ${input.path}`;
      }
      case 'edit_file': {
        const a = this.abs(input.path);
        const src = await fsp.readFile(a, 'utf8');
        const n = src.split(input.old_string).length - 1;
        if (!input.old_string || n === 0) throw new Error('old_string not found: read the file again, it may have changed');
        if (n > 1 && !input.replace_all) throw new Error(`old_string matches ${n} times: add more context or set replace_all`);
        await this.atomicWrite(a, input.replace_all ? src.split(input.old_string).join(input.new_string) : src.replace(input.old_string, () => input.new_string));
        return `edited ${input.path}`;
      }
      case 'run': return this.run(String(input.command || ''));
      case 'view_image': {
        const a = this.abs(input.path);
        const ext = path.extname(a).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : null;
        if (!type) throw new Error('only PNG, JPEG or WebP');
        const buf = await fsp.readFile(a);
        if (buf.length > 4.5e6) throw new Error('image larger than 4.5 MB: look at a smaller one (kadr frame writes small PNGs)');
        return { image: { type, data: buf.toString('base64') }, text: `image ${input.path}` };
      }
      default: throw new Error(`unknown tool ${name}`);
    }
  }

  async atomicWrite(a, text) {
    const tmp = `${a}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, a);
  }

  run(command) {
    let bin;
    let args;
    if (this.full) { bin = process.platform === 'win32' ? 'cmd' : 'bash'; args = process.platform === 'win32' ? ['/c', command] : ['-lc', command]; } else {
      if (/[|;&><`]|\$\(/.test(command.replace(/"[^"]*"|'[^']*'/g, ''))) throw new Error('pipes, redirects and chaining need full access; run one command at a time');
      const argv = splitArgs(command.trim());
      if (!argv.length) throw new Error('empty command');
      if (!LIMITED_CMDS.has(argv[0])) throw new Error(`"${argv[0]}" is not allowed in limited mode (allowed: ${[...LIMITED_CMDS].join(', ')})`);
      [bin, ...args] = argv;
      if (bin === 'kadr') { args = [path.join(APP_DIR, 'bin', 'kadr.js'), ...args]; bin = process.execPath; }
    }
    return new Promise((resolve, reject) => {
      const p = spawn(bin, args, { cwd: this.root, env: { ...process.env, KADR_EDITOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(p);
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      const timer = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
      p.on('error', (e) => { clearTimeout(timer); this.children.delete(p); reject(e); });
      p.on('close', (code) => {
        clearTimeout(timer);
        this.children.delete(p);
        const text = cap(out.trim()) || '(no output)';
        if (code === 0) resolve(text); else reject(new Error(`exit code ${code}\n${text}`));
      });
    });
  }

  kill() { for (const p of this.children) p.kill('SIGKILL'); }

  // ---------- model calls ----------
  async http(url, headers, body) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: this.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`cannot reach ${new URL(url).host} (${e.cause?.code || e.message})`);
    }
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) throw new Error(`${this.svc.name}: HTTP ${res.status} ${j?.error?.message || j?.message || text.slice(0, 300)}`);
    return j;
  }

  /** One model call. Takes and returns Anthropic-shaped messages. */
  async complete(system, messages) {
    const s = this.svc;
    if (s.kind === 'anthropic') {
      const firstParty = /(^|\.)anthropic\.com$/.test(new URL(s.baseUrl).hostname);
      const body = { model: s.model, max_tokens: 16000, system, tools: TOOLS, messages };
      // Claude 5 models take an effort level; medium suits an editing assistant.
      if (/^claude-(opus|sonnet|haiku|fable)-5/.test(s.model)) body.output_config = { effort: 'medium' };
      const headers = { 'x-api-key': s.key, 'anthropic-version': ANTHROPIC_VERSION };
      if (firstParty) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
      const j = await this.http(`${s.baseUrl}/v1/messages`, headers, body);
      return { content: j.content || [], stop: j.stop_reason, stopDetails: j.stop_details };
    }
    // OpenAI-compatible
    const msgs = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (typeof m.content === 'string') { msgs.push({ role: m.role, content: m.content }); continue; }
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
        msgs.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
        continue;
      }
      const images = [];
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          const parts = Array.isArray(b.content) ? b.content : [{ type: 'text', text: String(b.content ?? '') }];
          msgs.push({ role: 'tool', tool_call_id: b.tool_use_id, content: parts.filter((x) => x.type === 'text').map((x) => x.text).join('\n') || 'ok' });
          for (const x of parts) if (x.type === 'image') images.push(x);
        } else if (b.type === 'text') msgs.push({ role: 'user', content: b.text });
        else if (b.type === 'image') images.push(b);
      }
      if (images.length) {
        msgs.push({ role: 'user', content: [{ type: 'text', text: 'The image(s) you asked to view:' }, ...images.map((x) => ({ type: 'image_url', image_url: { url: `data:${x.source.media_type};base64,${x.source.data}` } }))] });
      }
    }
    const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const j = await this.http(`${s.baseUrl}/chat/completions`, s.key ? { authorization: `Bearer ${s.key}` } : {}, { model: s.model, messages: msgs, tools });
    const c = j.choices?.[0];
    const msg = c?.message || {};
    const content = [];
    if (msg.content) content.push({ type: 'text', text: String(msg.content) });
    for (const t of msg.tool_calls || []) {
      let input = {};
      try { input = JSON.parse(t.function?.arguments || '{}'); } catch { input = { __invalid: t.function?.arguments }; }
      content.push({ type: 'tool_use', id: t.id, name: t.function?.name, input });
    }
    const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : c?.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
    return { content, stop };
  }

  /**
   * Run one user turn. `history` is appended to in place.
   * cb: { text(str), step({label, detail, kind}), image(relPath) }
   */
  async turn(system, history, userText, cb) {
    history.push({ role: 'user', content: userText });
    for (let i = 0; i < MAX_STEPS; i++) {
      const r = await this.complete(system, history);
      history.push({ role: 'assistant', content: r.content });
      for (const b of r.content) if (b.type === 'text' && b.text.trim()) cb.text(b.text.trim());
      if (r.stop === 'refusal') throw new Error(`the model declined this request${r.stopDetails?.explanation ? `: ${r.stopDetails.explanation}` : ''}`);
      if (r.stop === 'pause_turn') continue;
      const uses = r.content.filter((b) => b.type === 'tool_use');
      if (r.stop !== 'tool_use' || !uses.length) {
        if (r.stop === 'max_tokens') cb.step({ kind: 'error', label: 'note', detail: 'the reply hit the length limit' });
        return;
      }
      const results = [];
      for (const u of uses) {
        cb.step(summarize(u.name, u.input));
        try {
          if (u.input?.__invalid !== undefined) throw new Error('the tool arguments were not valid JSON');
          const out = await this.tool(u.name, u.input || {});
          if (out && typeof out === 'object' && out.image) {
            results.push({ type: 'tool_result', tool_use_id: u.id, content: [{ type: 'image', source: { type: 'base64', media_type: out.image.type, data: out.image.data } }, { type: 'text', text: out.text }] });
            if (/\.(png|jpe?g)$/i.test(u.input.path)) cb.image(path.relative(this.root, this.abs(u.input.path)));
          } else {
            const text = String(out);
            results.push({ type: 'tool_result', tool_use_id: u.id, content: text });
            for (const m of text.matchAll(/(?:^|\s)((?:\.kadr\/frames|renders|media\/gen)\/[^\s'"]+\.png)/g)) cb.image(m[1]);
          }
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          const msg = String(e.message || e);
          cb.step({ kind: 'error', label: 'error', detail: msg.split('\n')[0].slice(0, 160) });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: msg.slice(0, OUT_CAP), is_error: true });
        }
      }
      history.push({ role: 'user', content: results });
    }
    throw new Error(`stopped after ${MAX_STEPS} steps`);
  }
}

function summarize(name, input = {}) {
  const rel = (p) => String(p || '').split('/').slice(-2).join('/');
  switch (name) {
    case 'run': return { kind: 'tool', label: 'run', detail: String(input.command || '').slice(0, 140) };
    case 'edit_file': return { kind: 'tool', label: 'edit', detail: rel(input.path) };
    case 'write_file': return { kind: 'tool', label: 'write', detail: rel(input.path) };
    case 'read_file': return { kind: 'tool', label: 'read', detail: rel(input.path) };
    case 'view_image': return { kind: 'tool', label: 'look', detail: rel(input.path) };
    case 'list_files': return { kind: 'tool', label: 'search', detail: input.path || '.' };
    default: return { kind: 'tool', label: String(name), detail: '' };
  }
}

/** Name + description of each skill in <project>/.claude/skills, for the system prompt. */
export function skillIndex(root) {
  const dir = path.join(root, '.claude', 'skills');
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return out; }
  for (const n of names) {
    try {
      const head = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8').slice(0, 2000);
      const d = head.match(/^description:\s*(.+)$/m);
      out.push({ name: n, file: `.claude/skills/${n}/SKILL.md`, description: d ? d[1].trim().replace(/^["']|["']$/g, '') : '' });
    } catch { /* not a skill */ }
  }
  return out;
}
