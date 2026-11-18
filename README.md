# kadr

**English** · [فارسی](README.fa.md)

A local video editor that coding agents can drive. No API keys: Claude Code,
Codex, Aider, Gemini CLI and others work on the same plain files the editor
shows, and the preview updates as they save.

- **Built-in chat**: a Chat tab runs Claude Code headless in the project folder
  with your own login (no API key). You see every step, the frames it renders to
  check its work, and each turn can be undone with one click (checkpoints of
  project.json + comps/). It knows your playhead and selection.
- **Use it from your own agents**: `kadr connect claude` (or the Connect page in
  AI settings) registers kadr as an MCP server in Claude Code, Codex, Gemini CLI,
  Qwen Code, Cursor, OpenCode or Claude Desktop. Then ask that agent for a video
  in its own chat: it creates and edits kadr projects, looks at frames and
  exports, without the editor open (`kadr mcp` is the server they start).
- **Video from a brief**: describe the video, add photos, music, lyrics or your
  website, and the agent researches, asks what is missing, plans and builds it.
  Free stock photos and clips (`kadr stock`), website reading (`kadr site`).
- **Pick your agent**: Claude Code, Codex, Gemini CLI or OpenCode with their
  own logins, or kadr's built-in agent with your API key (Anthropic, OpenAI,
  OpenRouter, Gemini, Ollama, any OpenAI-compatible server). Chat → settings.
- **Generated media**: with your keys, agents can make images (`kadr gen image`),
  voice-overs (`kadr gen speech`, also free local Piper / eSpeak) and word-timed
  transcripts for captions (`kadr gen transcribe`). Keys are stored in
  `~/.config/kadr/settings.json`, never in a project.
- **Editing skills**: every project gets guides for YouTube, Shorts/Reels/TikTok,
  Instagram, captions, long-to-short clips, thumbnails and voice-over explainers
  (`.claude/skills/`, `kadr skills --update` to refresh).
- **Manual editing**: timeline with tracks, move / trim / split / ripple delete,
  snapping, razor, markers, in/out, fades, opacity, position/scale (drag right
  on the preview), speed (0.1–16×, pitch kept), color (brightness / contrast /
  saturation, identical in preview and export), volume, detach audio, undo/redo.
  Keyframes (position, scale, rotation, opacity, volume with 5 easings), rotation
  handle on the preview, flip, crop, cross dissolve / dip to black, freeze frame,
  reverse, copy/cut/paste, nudge, ripple trim (Q/W), close gap, track lock and
  rename, right-click menus, safe-area / thirds guides.
- **Templates**: kinetic type, word-highlight captions, wipe transition, end card,
  title, lower third, counter, text. Their props become controls in the inspector.
- **Delivery-grade export**: presets (Web, Social, Master, Small, Draft), H.264 High /
  H.265 / ProRes 422 HQ 10-bit / AV1 / VP9, BT.709 tagged, two-pass EBU R128
  loudness (-14 / -16 / -23 LUFS), motion blur for motion graphics (sub-frames over
  a 180° shutter), output scaling up to 4K.
- **Motion graphics as HTML/CSS/JS**: a composition is a web page. The kadr
  runtime owns the clock, so CSS animations, JS (`kadr.onFrame`), canvas or
  GSAP are deterministic: the preview and the export match frame for frame.
- **Built for agents**: `project.json` (one clip per line), `AGENTS.md` in every
  project, and a CLI that lets an agent *look* at its work
  (`kadr frame`, `kadr sheet`, `kadr comp`), check compositions for code that
  would make the export differ from the preview (`kadr lint`), and analyse footage
  (`kadr scenes`, `kadr silence`, `kadr probe`).
- **Light**: Node with zero npm dependencies, about 60 MB RAM idle. Headless
  Chromium starts only while rendering compositions, and ffmpeg does the rest.
  Background jobs (thumbnails, waveforms, proxies) run one at a time at low CPU priority.

## Requirements

Node 22+, ffmpeg/ffprobe, Chromium or Chrome (`KADR_CHROME=/path` to override).

## Install

```bash
cd ~/projects/kadr && npm link      # puts `kadr` on your PATH
```

## Desktop app

Website and tutorials: https://noctis-architect.github.io/kadr/

Installers for Windows, macOS and Linux are on the
[Releases](https://github.com/Noctis-Architect/kadr/releases) page. The app
bundles its own Node; you still need ffmpeg and Chrome/Chromium/Edge. It opens
the last project you used (or makes `~/Documents/kadr/My first video`).

Build it yourself (needs Rust and, on Linux, `libwebkit2gtk-4.1-dev`):

```bash
npm install
npm run desktop:dev      # run from source
npm run desktop:build    # installers in src-tauri/target/release/bundle/
```

Releases: set `version` in package.json, then `git tag v<version> && git push origin v<version>`.
GitHub Actions builds every platform and publishes the release.

## Use

```bash
kadr init ~/videos/launch --demo    # --demo adds sample footage + titles
cd ~/videos/launch
kadr serve --open                   # http://127.0.0.1:4310
```

Open the **Chat** tab and type what you want, or start an agent in a terminal in the same folder (`claude`, `codex`, `aider`, …) and
ask for edits: *"cut the silences out of media/talk.mp4"*, *"add a lower
third for the selected clip"*, *"make the title animate in like a typewriter"*.
The agent reads `AGENTS.md`. "Selected" and "here" come from
`.kadr/state.json`, which the editor keeps up to date.

## How it fits together

```
project folder                       kadr serve (Node, 127.0.0.1 only)
├─ project.json   ◄── agent / UI ──►  file watcher → SSE → browser UI (live reload)
├─ comps/*.html   ◄── agent          /p/*  serves files (+ injects runtime/kadr.js)
├─ media/         ◄── you            /api  save, upload, thumbnails, waveforms, export
├─ renders/                          render.js: Chromium (CDP) → FFV1+alpha → ffmpeg graph
└─ .kadr/  state.json · logs · cache
```

| path | |
|---|---|
| `shared/model.js` | project schema, validation, placement math, used by server, CLI and UI |
| `shared/lint.js` | composition checks behind `kadr lint` (stable codes, one fix each) |
| `runtime/kadr.js` | the composition runtime (clock, props, easing helpers) |
| `src/server.js` | HTTP + SSE + watcher (per-directory, survives atomic saves) |
| `src/agent.js` | chat bridge: Claude Code (stream-json), other agent CLIs, checkpoints |
| `src/apiagent.js` | built-in agent loop over the Anthropic or an OpenAI-compatible API |
| `src/settings.js` | user settings and keys (outside projects) |
| `src/mcp.js` | `kadr mcp`: kadr's tools for any MCP agent |
| `src/connect.js` | `kadr connect`: adds kadr to each agent's MCP settings (with a backup) |
| `src/stock.js`, `src/site.js` | free stock search and download, website reader |
| `src/gen.js` | `kadr gen`: images, speech, transcripts |
| `skills/` | editing skills copied into each project's `.claude/skills/` |
| `builtin/` | templates served as `@kadr/...` to every project |
| `src/render.js` | export pipeline |
| `src/chrome.js` | ~150-line Chrome DevTools Protocol client |
| `src/media.js` | ffprobe cache, filmstrips, waveform peaks, preview proxies |
| `web/` | the editor UI (vanilla JS modules, no build step) |
| `template/` | what `kadr init` copies: AGENTS.md, CLAUDE.md, sample comps |

## Keys

Space play · ←/→ frame (Shift 1 s) · ↑/↓ previous/next edit · S split · C razor · V select ·
Del delete (Shift ripple) · Q/W ripple trim to playhead · Ctrl+C/X/V copy/cut/paste ·
Ctrl+D duplicate · Alt+←/→ nudge · Alt+drag copy · Shift+E enable/disable · [ ] keyframes ·
I/O in/out · X clear · M marker · T text · N snapping · G guides · +/−/\ zoom ·
Ctrl+Z / Ctrl+Shift+Z · Ctrl+E export · right-click for clip, gap and track menus
