// Chat bridge: runs the coding agent the user picked in settings inside the
// project folder: Claude Code (headless, streamed), another agent CLI (Codex,
// Gemini CLI, OpenCode), or kadr's own agent over a model API with the user's
// key. Streams its work to the editor over SSE and keeps a checkpoint of
// project.json + comps/ before every turn so the user can roll a turn back.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AGENTS } from '../shared/providers.js';
import { loadSettings, service } from './settings.js';
import { ApiAgent, skillIndex } from './apiagent.js';
import { installSkills } from './init.js';

export function which(bin) {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  const home = process.env.HOME || '';
  for (const p of [`${home}/.local/bin/${bin}`, `${home}/.claude/local/${bin}`, `${home}/.npm-global/bin/${bin}`, `/usr/local/bin/${bin}`]) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

const SYSTEM = `You are the assistant built into kadr, a local video editor. The user is chatting with you from the editor's chat panel and watches the preview update live while you work.
- The project is the current folder. Read AGENTS.md before your first edit in a conversation (once is enough).
- Edit project.json and comps/*.html directly. Keep clip ids stable.
- Each message starts with an [editor] line: playhead time, selected clip ids and the in/out range. "this clip", "here", "selected" refer to it.
- After edits run \`kadr validate\`. For anything visual, check your work with \`kadr frame <t>\` or \`kadr sheet\` and look at the PNG before saying you're done. Never pass -o to them: the default .kadr/frames/ path is shown to the user in the chat.
- Write everything (progress notes too) in the language of the user's message, often Persian. Be brief: say what you changed in one to three short sentences. No markdown headings.
- Do not run \`kadr render\` unless the user asks for a final export.
- For a platform-specific edit (YouTube, Shorts/Reels/TikTok, Instagram, podcasts, captions, thumbnails, voice-over), read the matching skill in .claude/skills/<name>/SKILL.md first and follow it.
- To make new media use \`kadr gen image "<prompt>"\`, \`kadr gen speech "<text>"\` and \`kadr gen transcribe <file>\` (they print the new file's path). If one says a service is not set up, tell the user to set it up in Chat → settings; don't look for keys yourself.`;

const SAFE_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite',
  'Bash(kadr:*)', 'Bash(ffprobe:*)', 'Bash(ffmpeg:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)',
  'Bash(mkdir:*)', 'Bash(cp:*)', 'Bash(mv:*)', 'Bash(wc:*)', 'Bash(file:*)', 'Bash(find:*)', 'Bash(grep:*)',
];

function summarizeTool(name, input = {}) {
  const rel = (p) => String(p || '').split('/').slice(-2).join('/');
  switch (name) {
    case 'Bash': return { label: 'run', detail: String(input.command || '').split('\n')[0].slice(0, 140) };
    case 'Edit': case 'MultiEdit': return { label: 'edit', detail: rel(input.file_path) };
    case 'Write': return { label: 'write', detail: rel(input.file_path) };
    case 'Read': return { label: 'read', detail: rel(input.file_path) };
    case 'Glob': case 'Grep': return { label: 'search', detail: String(input.pattern || '') };
    case 'TodoWrite': return { label: 'plan', detail: (input.todos || []).map((t) => t.content).slice(0, 3).join(' · ') };
    default: return { label: name.toLowerCase(), detail: '' };
  }
}

export class AgentBridge {
  constructor(root, broadcast) {
    this.root = root;
    this.broadcast = broadcast;
    this.file = path.join(root, '.kadr', 'chat.json');
    this.proc = null;
    this.state = { sessionId: null, messages: [], checkpoints: [] };
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* new chat */ }
  }

  info() {
    const s = loadSettings();
    const agents = Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [k, a.bin ? !!which(a.bin) : true]));
    const llm = service(s, 'llm');
    return {
      agent: s.agent,
      agentName: AGENTS[s.agent].name,
      ready: s.agent === 'api' ? !!(llm && llm.model && llm.baseUrl && (!llm.needsKey || llm.key)) : agents[s.agent],
      apiModel: s.agent === 'api' ? llm?.model || '' : '',
      agents,
      busy: !!this.proc,
      messages: this.state.messages,
      sessionId: this.state.sessionId,
    };
  }

  persist() {
    fsp.mkdir(path.dirname(this.file), { recursive: true })
      .then(() => fsp.writeFile(this.file, JSON.stringify(this.state)))
      .catch(() => {});
  }

  emit(ev) { this.broadcast({ type: 'agent', ...ev }); }

  async checkpoint(id) {
    const dir = path.join(this.root, '.kadr', 'checkpoints', id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(path.join(this.root, 'project.json'), path.join(dir, 'project.json'));
    const comps = path.join(this.root, 'comps');
    if (fs.existsSync(comps)) await fsp.cp(comps, path.join(dir, 'comps'), { recursive: true });
    this.state.checkpoints = [...(this.state.checkpoints || []), id].slice(-30);
    // keep the newest 30 on disk too
    const all = (await fsp.readdir(path.dirname(dir))).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 30))) await fsp.rm(path.join(path.dirname(dir), old), { recursive: true, force: true });
  }

  /** Put project.json and comps/ back to how they were before turn `id`. */
  async restore(id) {
    if (this.proc) throw new Error('wait for the agent to finish first');
    const dir = path.join(this.root, '.kadr', 'checkpoints', String(id).replace(/[^\w-]/g, ''));
    if (!fs.existsSync(dir)) throw new Error('that checkpoint no longer exists');
    const comps = path.join(this.root, 'comps');
    if (fs.existsSync(path.join(dir, 'comps'))) {
      await fsp.rm(comps, { recursive: true, force: true });
      await fsp.cp(path.join(dir, 'comps'), comps, { recursive: true });
    }
    const tmp = path.join(this.root, `.project.json.${process.pid}.tmp`);
    await fsp.copyFile(path.join(dir, 'project.json'), tmp);
    await fsp.rename(tmp, path.join(this.root, 'project.json'));
    const m = this.state.messages.find((x) => x.id === id);
    if (m) m.reverted = true;
    this.persist();
    this.emit({ ev: 'reverted', id });
  }

  reset() {
    if (this.proc) this.stop();
    this.state = { sessionId: null, messages: [], checkpoints: this.state.checkpoints };
    this.persist();
    this.emit({ ev: 'reset' });
  }

  stop() {
    if (!this.proc) return;
    const p = this.proc;
    if (p.abort) { p.abort(); return; }
    p.kill('SIGINT');
    setTimeout(() => { if (!p.killed || p.exitCode === null) p.kill('SIGKILL'); }, 2500);
  }

  async send({ text, context, model, full }) {
    if (this.proc) throw Object.assign(new Error('the agent is still working'), { status: 409 });
    text = String(text || '').trim();
    if (!text) throw new Error('empty message');
    const settings = loadSettings();
    const kind = settings.agent;
    const meta = AGENTS[kind];
    let bin = null;
    let svc = null;
    if (kind === 'api') {
      svc = service(settings, 'llm');
      if (!svc) throw new Error('choose a model API in Chat → settings first');
      if (!svc.model) throw new Error(`${svc.name}: set the model name in Chat → settings`);
      if (!svc.baseUrl) throw new Error(`${svc.name}: set the base URL in Chat → settings`);
      if (svc.needsKey && !svc.key) throw new Error(`${svc.name} needs an API key: add it in Chat → settings`);
    } else {
      bin = which(meta.bin);
      if (!bin) throw new Error(`${meta.name} (${meta.bin}) is not installed or not on PATH`);
    }
    // Skills the system prompt points at; adds missing ones, never overwrites.
    await installSkills(this.root).catch(() => {});

    const id = Date.now().toString(36);
    await this.checkpoint(id);
    const user = { id, role: 'user', text, at: Date.now() };
    const reply = { id: `${id}r`, turn: id, role: 'assistant', text: '', steps: [], images: [], at: Date.now(), agent: kind === 'api' ? `${svc.name} · ${svc.model}` : meta.name };
    const history = this.state.messages.slice(-8);
    this.state.messages.push(user, reply);
    this.emit({ ev: 'user', message: user });
    this.emit({ ev: 'start', message: reply });
    const prompt = `${context ? `[editor] ${context}\n\n` : ''}${text}`;
    if (kind === 'claude') return this.runClaude(bin, reply, prompt, { model, full });
    if (kind === 'api') return this.runApi(svc, reply, prompt, { full, provider: `${svc.provider}|${svc.model}` });
    return this.runCli(kind, bin, reply, prompt, history, { full, id });
  }

  finish(reply) {
    this.proc = null;
    reply.done = true;
    this.persist();
    this.emit({ ev: 'done', message: reply });
  }

  addImage(reply, p) {
    if (reply.images.includes(p)) return;
    reply.images.push(p);
    this.emit({ ev: 'image', id: reply.id, path: p });
  }

  pushStep(reply, st) { reply.steps.push(st); this.emit({ ev: 'step', id: reply.id, step: st }); }

  /** kadr's own agent over a model API. */
  async runApi(svc, reply, prompt, { full, provider }) {
    if (this.state.apiProvider !== provider) { this.state.apiHistory = []; this.state.apiProvider = provider; }
    const history = this.state.apiHistory || (this.state.apiHistory = []);
    const ac = new AbortController();
    const agent = new ApiAgent(this.root, svc, { full, signal: ac.signal });
    this.proc = { abort: () => { ac.abort(); agent.kill(); } };
    const skills = skillIndex(this.root);
    const system = `${SYSTEM}
- You work through the tools list_files, read_file, write_file, edit_file, run and view_image. Paths are relative to the project folder. Use run for kadr, ffmpeg and ffprobe commands${full ? ' (full access: any shell command)' : ' (one command at a time, no pipes)'}. After kadr frame / kadr sheet, call view_image on the PNG path it printed.
- Start a conversation by reading AGENTS.md.${skills.length ? `

Skills (read the file before doing that kind of edit):
${skills.map((k) => `- ${k.name}: ${k.description} (${k.file})`).join('\n')}` : ''}`;
    this.persist();
    (async () => {
      try {
        await agent.turn(system, history, prompt, {
          text: (t) => { reply.text = reply.text ? `${reply.text}\n\n${t}` : t; this.emit({ ev: 'text', id: reply.id, text: reply.text }); },
          step: (st) => this.pushStep(reply, st),
          image: (p) => this.addImage(reply, p),
        });
      } catch (e) {
        if (e.name === 'AbortError' || ac.signal.aborted) reply.stopped = true;
        else reply.error = String(e.message || e).slice(0, 600);
        // A turn cut short leaves a tool call without a result: start the API history over.
        const last = history[history.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) this.state.apiHistory = [];
      }
      this.finish(reply);
    })();
    return { id: reply.id };
  }

  /** Another agent CLI, run once per message; its plain output is the reply. */
  async runCli(kind, bin, reply, prompt, history, { full, id }) {
    const past = history.filter((m) => m.text && !m.reverted).map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text.slice(0, 1200)}`).join('\n\n');
    const full_prompt = `${SYSTEM}\n${past ? `\nEarlier in this conversation:\n${past}\n` : ''}\n${prompt}`;
    let args;
    if (kind === 'codex') args = ['exec', '--skip-git-repo-check', ...(full ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--full-auto']), full_prompt];
    else if (kind === 'gemini') args = ['-p', full_prompt, ...(full ? ['--yolo'] : ['--approval-mode', 'auto_edit', '--allowed-tools', 'run_shell_command(kadr)', 'run_shell_command(ffmpeg)', 'run_shell_command(ffprobe)'])];
    else args = ['run', ...(full ? ['--auto'] : []), full_prompt];
    const proc = spawn(bin, args, { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, KADR_EDITOR: '1', NO_COLOR: '1' } });
    this.proc = proc;
    let out = '';
    let err = '';
    const strip = (t) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const scan = (t) => { for (const m of t.matchAll(/(?:^|[\s'"(])((?:\.kadr\/frames|renders|media\/gen)\/[^\s'"()]+\.png)/g)) this.addImage(reply, m[1]); };
    proc.stdout.on('data', (d) => {
      const t = strip(String(d));
      out += t;
      scan(t);
      this.emit({ ev: 'delta', id: reply.id, text: t });
    });
    proc.stderr.on('data', (d) => {
      const t = strip(String(d));
      err = (err + t).slice(-6000);
      scan(t);
      const line = t.trim().split('\n').pop();
      if (line) this.emit({ ev: 'status', id: reply.id, text: line.slice(0, 160) });
    });
    proc.on('close', async (code, signal) => {
      reply.text = out.trim();
      if (signal === 'SIGINT' || signal === 'SIGKILL') reply.stopped = true;
      else if (code !== 0) reply.error = err.trim().split('\n').slice(-4).join('\n') || `exited with ${code}`;
      if (await this.changedSince(id)) this.pushStep(reply, { kind: 'tool', label: 'edit', detail: 'project files changed' });
      this.finish(reply);
    });
    proc.on('error', (e) => { reply.error = e.message; this.finish(reply); });
    this.persist();
    return { id: reply.id };
  }

  /** Did project.json or comps/ change since checkpoint `id`? */
  async changedSince(id) {
    const dir = path.join(this.root, '.kadr', 'checkpoints', id);
    const read = (f) => fsp.readFile(f).catch(() => null);
    const a = await read(path.join(dir, 'project.json'));
    const b = await read(path.join(this.root, 'project.json'));
    if (!a || !b || !a.equals(b)) return true;
    const list = async (d, rel = '') => {
      const out = [];
      let ents = [];
      try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return out; }
      for (const e of ents) {
        if (e.isDirectory()) out.push(...await list(path.join(d, e.name), `${rel}${e.name}/`));
        else out.push(`${rel}${e.name}`);
      }
      return out;
    };
    const was = (await list(path.join(dir, 'comps'))).sort();
    const now = (await list(path.join(this.root, 'comps'))).sort();
    if (was.join('|') !== now.join('|')) return true;
    for (const f of now) {
      const x = await read(path.join(dir, 'comps', f));
      const y = await read(path.join(this.root, 'comps', f));
      if (!x || !y || !x.equals(y)) return true;
    }
    return false;
  }

  /** Claude Code, headless, with its stream-json events. */
  runClaude(bin, reply, prompt, { model, full }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--append-system-prompt', SYSTEM];
    if (this.state.sessionId) args.push('--resume', this.state.sessionId);
    if (model) args.push('--model', model);
    if (full) args.push('--permission-mode', 'bypassPermissions');
    else args.push('--permission-mode', 'acceptEdits', '--allowedTools', ...SAFE_TOOLS);

    const proc = spawn(bin, args, { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, KADR_EDITOR: '1' } });
    this.proc = proc;
    proc.stdin.end(prompt);

    let buf = '';
    let err = '';
    let blockText = '';
    const toolNames = new Map();
    const pushStep = (s) => { reply.steps.push(s); this.emit({ ev: 'step', id: reply.id, step: s }); };
    const handle = (j) => {
      if (j.type === 'system' && j.subtype === 'init') {
        this.state.sessionId = j.session_id;
      } else if (j.type === 'system' && j.subtype === 'api_retry') {
        this.emit({ ev: 'status', id: reply.id, text: `retrying (${j.attempt})…` });
      } else if (j.type === 'stream_event') {
        const e = j.event;
        if (e.type === 'content_block_start' && e.content_block?.type === 'text') blockText = '';
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          blockText += e.delta.text;
          this.emit({ ev: 'delta', id: reply.id, text: e.delta.text });
        }
      } else if (j.type === 'assistant') {
        for (const b of j.message?.content || []) {
          if (b.type === 'text' && b.text.trim()) {
            reply.text = reply.text ? `${reply.text}\n\n${b.text.trim()}` : b.text.trim();
            this.emit({ ev: 'text', id: reply.id, text: reply.text });
          } else if (b.type === 'tool_use') {
            toolNames.set(b.id, b.name);
            pushStep({ kind: 'tool', ...summarizeTool(b.name, b.input) });
          }
        }
      } else if (j.type === 'user') {
        for (const b of j.message?.content || []) {
          if (b.type !== 'tool_result') continue;
          const body = Array.isArray(b.content) ? b.content.map((c) => c.text || '').join('\n') : String(b.content || '');
          if (b.is_error) pushStep({ kind: 'error', label: 'error', detail: body.split('\n')[0].slice(0, 160) });
          for (const m of body.matchAll(/(?:^|\s)((?:\.kadr\/frames|renders|media\/gen)\/[^\s'"]+\.png)/g)) this.addImage(reply, m[1]);
        }
      } else if (j.type === 'result') {
        reply.cost = j.total_cost_usd;
        reply.ms = j.duration_ms;
        if (j.is_error || j.subtype !== 'success') reply.error = j.result || j.subtype;
        if (!reply.text && j.result) reply.text = j.result;
      }
    };
    proc.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        try { handle(JSON.parse(l)); } catch { /* non-JSON noise */ }
      }
    });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    proc.on('close', (code, signal) => {
      this.proc = null;
      if (signal === 'SIGINT' || signal === 'SIGKILL') reply.stopped = true;
      else if (code !== 0 && !reply.text) reply.error = reply.error || err.trim().split('\n').slice(-4).join('\n') || `exited with ${code}`;
      reply.done = true;
      this.persist();
      this.emit({ ev: 'done', message: reply });
    });
    proc.on('error', (e) => {
      this.proc = null;
      reply.error = e.message;
      reply.done = true;
      this.persist();
      this.emit({ ev: 'done', message: reply });
    });
    this.persist();
    return { id: reply.id };
  }
}
