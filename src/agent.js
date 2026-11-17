// Chat bridge: runs a coding agent CLI (Claude Code, headless) inside the
// project folder with the user's own login — no API key. Streams its work to
// the editor over SSE and keeps a checkpoint of project.json + comps/ before
// every turn so the user can roll a turn back.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function which(bin) {
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
- Do not run \`kadr render\` unless the user asks for a final export.`;

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
    return {
      agents: { claude: !!which('claude') },
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
    p.kill('SIGINT');
    setTimeout(() => { if (!p.killed || p.exitCode === null) p.kill('SIGKILL'); }, 2500);
  }

  async send({ text, context, model, full }) {
    if (this.proc) throw Object.assign(new Error('the agent is still working'), { status: 409 });
    const bin = which('claude');
    if (!bin) throw new Error('Claude Code (claude) is not installed or not on PATH');
    text = String(text || '').trim();
    if (!text) throw new Error('empty message');

    const id = Date.now().toString(36);
    await this.checkpoint(id);
    const user = { id, role: 'user', text, at: Date.now() };
    const reply = { id: `${id}r`, turn: id, role: 'assistant', text: '', steps: [], images: [], at: Date.now() };
    this.state.messages.push(user, reply);
    this.emit({ ev: 'user', message: user });
    this.emit({ ev: 'start', message: reply });

    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--append-system-prompt', SYSTEM];
    if (this.state.sessionId) args.push('--resume', this.state.sessionId);
    if (model) args.push('--model', model);
    if (full) args.push('--permission-mode', 'bypassPermissions');
    else args.push('--permission-mode', 'acceptEdits', '--allowedTools', ...SAFE_TOOLS);

    const proc = spawn(bin, args, { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, KADR_EDITOR: '1' } });
    this.proc = proc;
    proc.stdin.end(`${context ? `[editor] ${context}\n\n` : ''}${text}`);

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
          for (const m of body.matchAll(/(?:^|\s)((?:\.kadr\/frames|renders)\/[^\s'"]+\.png)/g)) {
            if (!reply.images.includes(m[1])) { reply.images.push(m[1]); this.emit({ ev: 'image', id: reply.id, path: m[1] }); }
          }
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
