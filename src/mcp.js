// kadr as an MCP server (`kadr mcp`, stdio). Once connected, any agent that
// speaks MCP (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen Code,
// Claude Desktop…) can make and edit videos with kadr from its own chat,
// without the editor open. Every tool runs the kadr CLI, so it behaves exactly
// like the editor and the CLI; frames come back as images the agent can see.
//
// Protocol: JSON-RPC 2.0, one message per line on stdin/stdout. Logs go to stderr.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { APP_DIR, safeJoin, findRoot } from './project.js';
import { validateProject, serializeProject } from '../shared/model.js';

const KADR = path.join(APP_DIR, 'bin', 'kadr.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;

const INSTRUCTIONS = `kadr is a local video editor driven through plain files: project.json (the timeline) and comps/*.html (motion graphics).
To make or edit a video: call kadr_guide first (once per conversation), then kadr_new_project or kadr_project, edit with kadr_write_project / kadr_add_clip / kadr_write_file, and LOOK at the result with kadr_frame or kadr_sheet before saying it is done. kadr_validate must report ok. For known kinds of jobs (YouTube, Reels, lyric videos, product promos, slideshows…) read the matching skill with kadr_guide({skill}). Render with kadr_render only when the user wants the file. kadr_open_editor shows the project in the visual editor if the user wants to see or tweak it by hand.`;

/** Run the kadr CLI. Resolves { code, out } (stdout + stderr). */
function cli(args, { cwd, timeout = 15 * 60e3 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [KADR, ...args], { cwd: cwd || os.homedir(), env: { ...process.env, KADR_MCP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += String(d).replace(/\r[^\n]*/g, ''); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.trim() }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 1, out: e.message }); });
  });
}

const expand = (p) => path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));

/** The project folder for a tool call: `dir` (or any folder inside it). */
function projectDir(dir) {
  if (!dir) throw new Error('give "dir": the project folder (create one with kadr_new_project)');
  const root = findRoot(expand(dir));
  if (!root) throw new Error(`no kadr project in ${dir} (no project.json there or above). Create one with kadr_new_project.`);
  return root;
}

const text = (t) => ({ type: 'text', text: String(t || '(no output)') });

/** Text output plus every PNG path it mentions as an image (up to 6). */
async function withImages(root, out) {
  const content = [text(out)];
  const paths = [...new Set([...out.matchAll(/(?:^|\s)(\S+\.png)\b/gm)].map((m) => m[1]))].slice(0, 6);
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
    try {
      const buf = await fsp.readFile(abs);
      if (buf.length < 4.5e6) content.push({ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' });
    } catch { /* not a file we can read */ }
  }
  return content;
}

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const DIR = { type: 'string', description: 'Project folder (absolute, or ~/…)' };

const renders = new Map(); // job id -> { proc, out, done, code, file, started }

const TOOLS = [
  {
    name: 'kadr_guide',
    description: 'How kadr projects work (project.json format, compositions, commands) and the list of editing skills. Call once before editing. With "skill", returns that playbook (e.g. "lyric-video", "product-promo", "shorts-reels").',
    inputSchema: S({ skill: { type: 'string', description: 'Skill name; omit for the general guide and the list' } }),
    run: async ({ skill }) => {
      const skillsDir = path.join(APP_DIR, 'skills');
      if (skill) {
        const f = path.join(skillsDir, String(skill).replace(/[^\w-]/g, ''), 'SKILL.md');
        if (!fs.existsSync(f)) throw new Error(`no skill "${skill}". Call kadr_guide without arguments for the list.`);
        return [text(await fsp.readFile(f, 'utf8'))];
      }
      const guide = await fsp.readFile(path.join(APP_DIR, 'template', 'AGENTS.md'), 'utf8');
      const list = [];
      for (const n of (await fsp.readdir(skillsDir)).sort()) {
        const head = await fsp.readFile(path.join(skillsDir, n, 'SKILL.md'), 'utf8').catch(() => '');
        const d = head.match(/^description:\s*(.+)$/m)?.[1] || '';
        list.push(`- ${n}: ${d.slice(0, 220)}`);
      }
      return [text(`${guide}\n\n# Skills (read one with kadr_guide({skill: "<name>"}))\n${list.join('\n')}\n\n# Through MCP\nCommands in the guide map to tools: kadr info → kadr_project, kadr frame → kadr_frame, kadr sheet → kadr_sheet, kadr gen … → kadr_gen_*, kadr stock … → kadr_stock_*, kadr site → kadr_read_site, kadr render → kadr_render. If you have your own file tools you may edit project.json and comps/ directly; otherwise use kadr_write_project and kadr_write_file.`)];
    },
  },
  {
    name: 'kadr_new_project',
    description: 'Create a new video project folder (project.json, comps/, media/, guides and skills). Use a new folder per video, e.g. ~/Videos/launch-video.',
    inputSchema: S({ dir: DIR, name: { type: 'string' }, size: { type: 'string', description: 'WIDTHxHEIGHT, e.g. 1920x1080 (YouTube), 1080x1920 (Reels/Shorts), 1080x1350 (Instagram feed)' }, fps: { type: 'number' } }, ['dir']),
    run: async ({ dir, name, size, fps }) => {
      const abs = expand(dir);
      const r = await cli(['init', abs, ...(name ? ['--name', name] : []), ...(size ? ['--size', size] : []), ...(fps ? ['--fps', String(fps)] : [])]);
      if (r.code) throw new Error(r.out);
      return [text(`${r.out}\nProject folder: ${abs}\nPut the user's files in ${path.join(abs, 'media')} (copy them there) and refer to them as media/<name>.`)];
    },
  },
  {
    name: 'kadr_project',
    description: 'Summary of a project (every track and clip with times) and the full project.json.',
    inputSchema: S({ dir: DIR }, ['dir']),
    run: async ({ dir }) => {
      const root = projectDir(dir);
      const r = await cli(['info', '-C', root]);
      const pj = await fsp.readFile(path.join(root, 'project.json'), 'utf8');
      return [text(`${r.out}\n\nproject.json:\n${pj}`)];
    },
  },
  {
    name: 'kadr_write_project',
    description: 'Replace project.json with a new version (the whole object). It is validated first; nothing is written if it has errors. Keep existing clip ids.',
    inputSchema: S({ dir: DIR, project: { type: 'object', description: 'The full project.json object' } }, ['dir', 'project']),
    run: async ({ dir, project }) => {
      const root = projectDir(dir);
      // the validator fills in defaults, so make sure this really is a whole project
      const missing = ['width', 'height', 'fps'].filter((k) => !(project?.[k] > 0));
      if (!Array.isArray(project?.tracks) || !project.tracks.length) missing.push('tracks');
      if (!Array.isArray(project?.clips)) missing.push('clips');
      if (missing.length) throw new Error(`not written: send the whole project.json (missing ${missing.join(', ')}). Read it first with kadr_project.`);
      const v = validateProject(project);
      if (v.errors.length) throw new Error(`not written, fix these first:\n${v.errors.join('\n')}`);
      const file = path.join(root, 'project.json');
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, serializeProject(project));
      await fsp.rename(tmp, file);
      return [text(`saved project.json${v.warnings.length ? `\nwarnings:\n${v.warnings.join('\n')}` : ''}`)];
    },
  },
  {
    name: 'kadr_add_clip',
    description: 'Append a clip for a file (media/…, comps/….html or a built-in @kadr/….html). Duration is probed from media files.',
    inputSchema: S({ dir: DIR, src: { type: 'string' }, track: { type: 'string', description: 'e.g. V1, V2, A1' }, at: { type: 'number', description: 'start on the timeline, seconds' }, in: { type: 'number' }, duration: { type: 'number' }, props: { type: 'object', description: 'for html clips' } }, ['dir', 'src']),
    run: async ({ dir, src, track, at, in: inn, duration, props }) => {
      const root = projectDir(dir);
      const a = ['add', src, '-C', root];
      if (track) a.push('--track', track);
      if (at != null) a.push('--at', String(at));
      if (inn != null) a.push('--in', String(inn));
      if (duration != null) a.push('--duration', String(duration));
      if (props) a.push('--props', JSON.stringify(props));
      const r = await cli(a, { cwd: root });
      if (r.code) throw new Error(r.out);
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_read_file',
    description: 'Read a text file of the project (comps/*.html, brief notes, AGENTS.md…).',
    inputSchema: S({ dir: DIR, path: { type: 'string', description: 'relative to the project folder' } }, ['dir', 'path']),
    run: async ({ dir, path: p }) => {
      const root = projectDir(dir);
      const abs = safeJoin(root, p);
      if (!abs) throw new Error('path outside the project');
      return [text(await fsp.readFile(abs, 'utf8'))];
    },
  },
  {
    name: 'kadr_write_file',
    description: 'Create or overwrite a text file inside the project, e.g. a composition comps/title.html. Run kadr_lint on compositions afterwards.',
    inputSchema: S({ dir: DIR, path: { type: 'string' }, content: { type: 'string' } }, ['dir', 'path', 'content']),
    run: async ({ dir, path: p, content }) => {
      const root = projectDir(dir);
      const abs = safeJoin(root, p);
      if (!abs || /(^|\/)\.git(\/|$)/.test(p)) throw new Error('path outside the project');
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content);
      return [text(`wrote ${p}`)];
    },
  },
  {
    name: 'kadr_validate',
    description: 'Check project.json and every file it uses. Must say ok before you are done.',
    inputSchema: S({ dir: DIR }, ['dir']),
    run: async ({ dir }) => { const root = projectDir(dir); return [text((await cli(['validate', '-C', root], { cwd: root })).out)]; },
  },
  {
    name: 'kadr_lint',
    description: 'Check compositions for code that breaks renders (stable codes, one fix each). Without files: all of comps/.',
    inputSchema: S({ dir: DIR, files: { type: 'array', items: { type: 'string' } } }, ['dir']),
    run: async ({ dir, files }) => {
      const root = projectDir(dir);
      const r = await cli(['lint', ...(files || []).map((f) => path.resolve(root, f)), ...(files?.length ? [] : ['-C', root])], { cwd: root });
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_frame',
    description: 'Render frames of the timeline at the given times (seconds) and return them as images, exactly as they will be exported. Use it to check your work.',
    inputSchema: S({ dir: DIR, times: { type: 'array', items: { type: 'number' } } }, ['dir', 'times']),
    run: async ({ dir, times }) => {
      const root = projectDir(dir);
      const r = await cli(['frame', ...(times || [0]).slice(0, 6).map(String), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return withImages(root, r.out);
    },
  },
  {
    name: 'kadr_sheet',
    description: 'One image with many frames and timestamps: of the whole timeline, or of a media file / composition to see what it contains.',
    inputSchema: S({ dir: DIR, file: { type: 'string', description: 'optional: media/… or comps/….html' }, count: { type: 'number' } }, ['dir']),
    run: async ({ dir, file, count }) => {
      const root = projectDir(dir);
      const r = await cli(['sheet', ...(file ? [file] : []), ...(count ? ['--count', String(count)] : []), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return withImages(root, r.out);
    },
  },
  {
    name: 'kadr_comp',
    description: 'Render a composition alone at a few times and report its JavaScript console errors.',
    inputSchema: S({ dir: DIR, file: { type: 'string', description: 'comps/x.html or @kadr/x.html' }, times: { type: 'array', items: { type: 'number' } }, props: { type: 'object' } }, ['dir', 'file']),
    run: async ({ dir, file, times, props }) => {
      const root = projectDir(dir);
      const r = await cli(['comp', file, ...(times || []).map(String), ...(props ? ['--props', JSON.stringify(props)] : []), '-C', root], { cwd: root });
      return withImages(root, r.out);
    },
  },
  {
    name: 'kadr_templates',
    description: 'Built-in compositions (@kadr/…): titles, lower thirds, captions, lyrics, counters, charts, transitions… with their props.',
    inputSchema: S({}),
    run: async () => [text((await cli(['templates'])).out)],
  },
  {
    name: 'kadr_media_info',
    description: 'Analyse a media file: "probe" (length, size, codecs), "silence" (quiet ranges, for jump cuts) or "scenes" (shot changes).',
    inputSchema: S({ dir: DIR, file: { type: 'string' }, kind: { type: 'string', enum: ['probe', 'silence', 'scenes'] } }, ['dir', 'file', 'kind']),
    run: async ({ dir, file, kind }) => { const root = projectDir(dir); return [text((await cli([kind, file, '-C', root], { cwd: root })).out)]; },
  },
  {
    name: 'kadr_gen_image',
    description: 'Generate an image with the service set up in kadr (AI settings). Saved to media/gen/.',
    inputSchema: S({ dir: DIR, prompt: { type: 'string' }, size: { type: 'string', description: '1536x1024 wide, 1024x1536 tall, 1024x1024' } }, ['dir', 'prompt']),
    run: async ({ dir, prompt, size }) => {
      const root = projectDir(dir);
      const r = await cli(['gen', 'image', prompt, ...(size ? ['--size', size] : []), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return withImages(root, r.out);
    },
  },
  {
    name: 'kadr_gen_speech',
    description: 'Generate a voice-over from text with the voice service set up in kadr. Saved to media/gen/.',
    inputSchema: S({ dir: DIR, text: { type: 'string' }, voice: { type: 'string' } }, ['dir', 'text']),
    run: async ({ dir, text: t, voice }) => {
      const root = projectDir(dir);
      const r = await cli(['gen', 'speech', t, ...(voice ? ['--voice', voice] : []), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_transcribe',
    description: 'Speech to text with word timing (for captions, lyric timing, cutting by words). Saves JSON to media/gen/.',
    inputSchema: S({ dir: DIR, file: { type: 'string' }, language: { type: 'string', description: 'e.g. fa, en' } }, ['dir', 'file']),
    run: async ({ dir, file, language }) => {
      const root = projectDir(dir);
      const r = await cli(['gen', 'transcribe', file, ...(language ? ['--language', language] : []), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_stock_search',
    description: 'Search free stock libraries (Wikimedia Commons, Openverse, Pexels, Pixabay) for photos or video clips. Returns numbered results with license; then download with kadr_stock_get. English words work best.',
    inputSchema: S({ dir: DIR, query: { type: 'string' }, video: { type: 'boolean' }, orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'] }, count: { type: 'number' }, library: { type: 'string', enum: ['wikimedia', 'pexels', 'pixabay', 'openverse'] } }, ['dir', 'query']),
    run: async ({ dir, query, video, orientation, count, library }) => {
      const root = projectDir(dir);
      const r = await cli(['stock', 'search', query, ...(video ? ['--video'] : []), ...(orientation ? ['--orientation', orientation] : []), ...(count ? ['--count', String(count)] : []), ...(library ? ['--from', library] : []), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_stock_get',
    description: 'Download results of the last kadr_stock_search by number into media/stock/ (credits are kept in media/stock/CREDITS.md).',
    inputSchema: S({ dir: DIR, numbers: { type: 'array', items: { type: 'number' } } }, ['dir', 'numbers']),
    run: async ({ dir, numbers }) => {
      const root = projectDir(dir);
      const r = await cli(['stock', 'get', ...(numbers || []).map(String), '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_read_site',
    description: 'Read a website for facts, brand color and images (saved to media/site/<host>/, notes to brief/site-<host>.md).',
    inputSchema: S({ dir: DIR, url: { type: 'string' } }, ['dir', 'url']),
    run: async ({ dir, url }) => {
      const root = projectDir(dir);
      const r = await cli(['site', url, '-C', root], { cwd: root });
      if (r.code) throw new Error(r.out);
      return [text(r.out)];
    },
  },
  {
    name: 'kadr_render',
    description: 'Export the video file (renders/…mp4). Long videos take minutes: if it is not done within ~50 s you get a job id; check it with kadr_render_status.',
    inputSchema: S({ dir: DIR, out: { type: 'string', description: 'e.g. renders/final.mp4' }, loudness: { type: 'number', description: '-14 for web/social' }, codec: { type: 'string', enum: ['h264', 'h265', 'prores', 'av1', 'vp9'] }, from: { type: 'number' }, to: { type: 'number' } }, ['dir']),
    run: async ({ dir, out, loudness, codec, from, to }) => {
      const root = projectDir(dir);
      const args = [KADR, 'render', '-C', root, ...(out ? ['-o', out] : []), ...(loudness != null ? ['--loudness', String(loudness)] : []), ...(codec ? ['--codec', codec] : []), ...(from != null ? ['--from', String(from)] : []), ...(to != null ? ['--to', String(to)] : [])];
      const id = `r${Date.now().toString(36)}`;
      const job = { out: '', done: false, code: null, started: Date.now() };
      job.proc = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      job.proc.stdout.on('data', (d) => { job.out += d; });
      job.proc.stderr.on('data', (d) => { job.out = (job.out + String(d).replace(/\r[^\n]*/g, '')).slice(-4000); });
      job.proc.on('close', (code) => { job.done = true; job.code = code; });
      renders.set(id, job);
      for (let i = 0; i < 100 && !job.done; i++) await new Promise((r) => setTimeout(r, 500));
      if (!job.done) return [text(`still rendering (job ${id}). Call kadr_render_status({job: "${id}"}) in a little while.`)];
      if (job.code) throw new Error(job.out.trim() || 'render failed');
      return [text(job.out.trim())];
    },
  },
  {
    name: 'kadr_render_status',
    description: 'Progress of a render started with kadr_render.',
    inputSchema: S({ job: { type: 'string' } }, ['job']),
    run: async ({ job }) => {
      const j = renders.get(job);
      if (!j) throw new Error('unknown job (renders are tracked while this connection is open)');
      if (!j.done) return [text(`still rendering, ${Math.round((Date.now() - j.started) / 1000)} s so far`)];
      if (j.code) throw new Error(j.out.trim() || 'render failed');
      return [text(j.out.trim())];
    },
  },
  {
    name: 'kadr_open_editor',
    description: 'Open the project in kadr\'s visual editor in the browser (for the user to watch or adjust by hand). Not needed for editing.',
    inputSchema: S({ dir: DIR }, ['dir']),
    run: async ({ dir }) => {
      const root = projectDir(dir);
      const p = spawn(process.execPath, [KADR, 'serve', root, '--open'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const line = await new Promise((resolve) => {
        let buf = '';
        const t = setTimeout(() => resolve(''), 8000);
        p.stdout.on('data', (d) => { buf += d; const m = buf.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } });
      });
      p.stdout.destroy();
      p.unref();
      return [text(line ? `editor open at ${line}` : 'starting the editor (it opens in the browser)')];
    },
  },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kadr', title: 'kadr video editor', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `unknown tool ${params?.name}`);
      try {
        return reply({ content: await tool.run(params.arguments || {}) });
      } catch (e) {
        return reply({ content: [text(e.message || String(e))], isError: true });
      }
    }
    if (method?.startsWith('notifications/')) return undefined;
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    return fail(-32601, `method not found: ${method}`);
  } catch (e) {
    return fail(-32603, e.message);
  }
}

export function runMcp() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
      if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write(`kadr MCP server ${VERSION} ready (stdio)\n`);
}
