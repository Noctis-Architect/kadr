# kadr

A local video editor that coding agents can drive. No API keys: Claude Code,
Codex, Aider, Gemini CLI and others work on the same plain files the editor
shows, and the preview updates as they save.

- **Built-in chat**: a Chat tab runs Claude Code headless in the project folder
  with your own login (no API key). You see every step, the frames it renders to
  check its work, and each turn can be undone with one click (checkpoints of
  project.json + comps/). It knows your playhead and selection.
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
  (`kadr frame`, `kadr sheet`, `kadr comp`) and analyse footage
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
| `runtime/kadr.js` | the composition runtime (clock, props, easing helpers) |
| `src/server.js` | HTTP + SSE + watcher (per-directory, survives atomic saves) |
| `src/agent.js` | chat bridge: `claude -p --output-format stream-json`, checkpoints |
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
