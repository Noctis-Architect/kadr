// Connect kadr to the user's own agents: registers `kadr mcp` as an MCP server
// in each agent's user settings, so the user can ask that agent for videos in
// its own chat without the kadr editor open. Each file is backed up once
// (<file>.kadr-backup) before kadr first changes it; disconnecting removes only
// kadr's entry. Claude Code also gets a small user skill that points it at kadr.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_DIR } from './project.js';

const home = () => process.env.KADR_HOME_OVERRIDE || os.homedir();
const KADR = path.join(APP_DIR, 'bin', 'kadr.js');
/** The command an agent runs to start kadr's MCP server. */
export const serverCommand = () => ({ command: process.execPath, args: [KADR, 'mcp'] });

function onPath(bin) {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  for (const d of ['.local/bin', '.npm-global/bin', '.opencode/bin', '.claude/local']) {
    try { fs.accessSync(path.join(home(), d, bin), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

async function backup(file) {
  const b = `${file}.kadr-backup`;
  if (fs.existsSync(file) && !fs.existsSync(b)) await fsp.copyFile(file, b);
}

// ---------- JSON settings files with an "mcpServers" object ----------
function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const txt = fs.readFileSync(file, 'utf8');
  if (!txt.trim()) return {};
  try { return JSON.parse(txt); } catch { throw new Error(`${file} is not plain JSON (it may have comments): add kadr by hand, see "Other apps"`); }
}
async function writeJson(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await backup(file);
  const tmp = `${file}.kadr-tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  await fsp.rename(tmp, file);
}
const jsonTarget = (file, key = 'mcpServers', entry = () => serverCommand()) => ({
  file,
  status: () => !!readJson(file())?.[key]?.kadr,
  connect: async () => { const j = readJson(file()); j[key] = { ...(j[key] || {}), kadr: entry() }; await writeJson(file(), j); },
  disconnect: async () => { const j = readJson(file()); if (j[key]?.kadr) { delete j[key].kadr; await writeJson(file(), j); } },
});

// ---------- Codex: TOML ----------
const codexFile = () => path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'config.toml');
const tomlStr = (s) => JSON.stringify(s); // TOML basic strings use the same escapes as JSON for these paths
const codexBlock = () => {
  const { command, args } = serverCommand();
  return `[mcp_servers.kadr]\ncommand = ${tomlStr(command)}\nargs = [${args.map(tomlStr).join(', ')}]\n`;
};
/** Remove the [mcp_servers.kadr] table (and its sub-tables) line by line, up to the next table. */
function stripCodex(txt) {
  const out = [];
  let skip = false;
  for (const line of txt.split('\n')) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (header) skip = header[1] === 'mcp_servers.kadr' || header[1].startsWith('mcp_servers.kadr.');
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------- Claude Code: its own CLI + a user skill ----------
const claudeSkill = () => path.join(home(), '.claude', 'skills', 'kadr-video', 'SKILL.md');
const CLAUDE_SKILL = `---
name: kadr-video
description: Make or edit videos with kadr (local video editor) from this chat: product promos, Reels/Shorts, YouTube edits, lyric videos, slideshows, captions, thumbnails. Use when the user asks for a video, a clip, an edit of their footage, or motion graphics.
---

# Videos with kadr

kadr is connected to you as the MCP server "kadr" (tools named kadr_*).

1. Call kadr_guide once: it explains projects and lists playbooks (skills) for
   each kind of video; read the matching one with kadr_guide({skill}).
2. New video: kadr_new_project in a new folder (ask where if unclear, e.g.
   ~/Videos/<name>), copy the user's files into its media/ folder.
   Existing project: kadr_project({dir}).
3. Edit project.json and comps/*.html (with your file tools, or
   kadr_write_project / kadr_write_file), find media with kadr_stock_search,
   generate with kadr_gen_image / kadr_gen_speech.
4. Always look at the result (kadr_frame / kadr_sheet) and run kadr_validate.
5. kadr_render when the user wants the file; kadr_open_editor if they want to
   watch or adjust it in the visual editor.
`;
function claudeConfigHas() {
  for (const f of [path.join(home(), '.claude.json'), path.join(home(), '.claude', 'settings.json')]) {
    try { if (readJson(f)?.mcpServers?.kadr) return true; } catch { /* unreadable */ }
  }
  return false;
}
function runClaude(args) {
  const r = spawnSync('claude', args, { encoding: 'utf8', env: { ...process.env, HOME: home() }, timeout: 30000 });
  if (r.error) throw new Error(`could not run claude: ${r.error.message}`);
  // removing something that is not there is fine
  if (r.status !== 0 && !(args[1] === 'remove' && /no mcp server|not found|does not exist/i.test(`${r.stdout}${r.stderr}`))) {
    throw new Error(`claude mcp: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
  }
}

export const TARGETS = {
  claude: {
    name: 'Claude Code', bin: 'claude', how: 'Adds the kadr MCP server (claude mcp add, user scope) and a small "kadr-video" skill.',
    detect: () => onPath('claude') || fs.existsSync(path.join(home(), '.claude')),
    status: () => claudeConfigHas(),
    connect: async () => {
      const { command, args } = serverCommand();
      runClaude(['mcp', 'remove', '--scope', 'user', 'kadr']);
      runClaude(['mcp', 'add', '--scope', 'user', 'kadr', '--', command, ...args]);
      await fsp.mkdir(path.dirname(claudeSkill()), { recursive: true });
      await fsp.writeFile(claudeSkill(), CLAUDE_SKILL);
    },
    disconnect: async () => {
      runClaude(['mcp', 'remove', '--scope', 'user', 'kadr']);
      await fsp.rm(path.dirname(claudeSkill()), { recursive: true, force: true });
    },
  },
  codex: {
    name: 'Codex', bin: 'codex', how: 'Adds [mcp_servers.kadr] to ~/.codex/config.toml.',
    detect: () => onPath('codex') || fs.existsSync(path.dirname(codexFile())),
    status: () => fs.existsSync(codexFile()) && /\[mcp_servers\.kadr\]/.test(fs.readFileSync(codexFile(), 'utf8')),
    connect: async () => {
      const f = codexFile();
      const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      await fsp.mkdir(path.dirname(f), { recursive: true });
      await backup(f);
      await fsp.writeFile(f, `${stripCodex(cur).trimEnd()}${cur.trim() ? '\n\n' : ''}${codexBlock()}`);
    },
    disconnect: async () => {
      const f = codexFile();
      if (!fs.existsSync(f)) return;
      await backup(f);
      await fsp.writeFile(f, `${stripCodex(fs.readFileSync(f, 'utf8')).trim()}\n`);
    },
  },
  gemini: { name: 'Gemini CLI', bin: 'gemini', how: 'Adds kadr to mcpServers in ~/.gemini/settings.json.', detect: () => onPath('gemini') || fs.existsSync(path.join(home(), '.gemini')), ...jsonTarget(() => path.join(home(), '.gemini', 'settings.json')) },
  qwen: { name: 'Qwen Code', bin: 'qwen', how: 'Adds kadr to mcpServers in ~/.qwen/settings.json.', detect: () => onPath('qwen') || fs.existsSync(path.join(home(), '.qwen')), ...jsonTarget(() => path.join(home(), '.qwen', 'settings.json')) },
  cursor: { name: 'Cursor', bin: 'cursor-agent', how: 'Adds kadr to ~/.cursor/mcp.json (Cursor editor and cursor-agent).', detect: () => onPath('cursor-agent') || onPath('cursor') || fs.existsSync(path.join(home(), '.cursor')), ...jsonTarget(() => path.join(home(), '.cursor', 'mcp.json')) },
  opencode: {
    name: 'OpenCode', bin: 'opencode', how: 'Adds kadr to "mcp" in ~/.config/opencode/opencode.json.',
    detect: () => onPath('opencode') || fs.existsSync(path.join(home(), '.config', 'opencode')),
    ...jsonTarget(() => path.join(home(), '.config', 'opencode', 'opencode.json'), 'mcp', () => { const { command, args } = serverCommand(); return { type: 'local', command: [command, ...args], enabled: true }; }),
  },
  claudeDesktop: {
    name: 'Claude Desktop', bin: null, how: 'Adds kadr to mcpServers in claude_desktop_config.json (restart Claude Desktop after).',
    detect: () => fs.existsSync(desktopDir()),
    ...jsonTarget(() => path.join(desktopDir(), 'claude_desktop_config.json')),
  },
};
function desktopDir() {
  if (process.platform === 'darwin') return path.join(home(), 'Library', 'Application Support', 'Claude');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || home(), 'Claude');
  return path.join(home(), '.config', 'Claude');
}

/** Every target with detected / connected state (errors reported, not thrown). */
export function connectStatus() {
  return Object.entries(TARGETS).map(([id, t]) => {
    let connected = false;
    let error = null;
    try { connected = !!t.status(); } catch (e) { error = e.message; }
    return { id, name: t.name, how: t.how, detected: !!t.detect(), connected, error };
  });
}

export async function setConnected(id, on) {
  const t = TARGETS[id];
  if (!t) throw new Error(`unknown app: ${id}`);
  await (on ? t.connect() : t.disconnect());
  return connectStatus().find((x) => x.id === id);
}

/** Copy-paste setup for apps kadr does not know. */
export function manualSnippet() {
  const { command, args } = serverCommand();
  return JSON.stringify({ mcpServers: { kadr: { command, args } } }, null, 2);
}
