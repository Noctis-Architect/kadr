# kadr project: guide for coding agents

This folder is a **kadr** video project. kadr is a local video editor whose
whole state lives in plain files. You edit the video by editing those files.
The editor (`kadr serve`, http://127.0.0.1:4310) watches the folder and
updates its preview live, so the user sees your changes as you save them.
No API keys are involved: you are the AI, and the files are the interface.

## Files

| path | what it is | who edits it |
|---|---|---|
| `project.json` | the timeline: settings, tracks, clips, markers | you and the editor UI |
| `comps/*.html` | motion-graphics compositions (HTML/CSS/JS) | you |
| `media/` | footage, music, images (the user drops files here) | the user (and you, for generated assets) |
| `renders/` | exported videos and stills | `kadr render` |
| `.kadr/state.json` | what the user has selected in the editor right now | the editor (read-only for you) |
| `.kadr/logs/console.log` | JS errors from compositions running in the preview | the editor (read it when a comp misbehaves) |
| `.kadr/cache/`, `.kadr/frames/` | caches and your preview images | kadr |

## Workflow

1. `kadr info` gives the project at a glance: every clip with its times.
2. Edit `project.json` and/or `comps/*.html`.
3. `kadr validate` must print `ok` before you finish. Fix every error it prints.
4. **Look at your work.** Don't assume it is right. You can read images:
   - `kadr frame 2.5`: the composited frame at 2.5 s (all tracks, exactly as exported)
   - `kadr sheet`: a 12-frame contact sheet of the whole timeline, in one image
   - `kadr comp comps/title.html`: a composition alone at 0/25/50/75/100%, plus its console errors
   - `kadr sheet media/clip.mp4`: what a piece of footage contains
5. `kadr render` only when asked for a final file (it takes a while). The user
   can also export from the editor.

"This clip", "here" and "the selected one" refer to `.kadr/state.json`
(`selection` holds clip ids, `playhead` is in seconds, `in`/`out` is the marked
range, `part` is a part of a composition the user picked on the timeline:
its `src` file and `key`, an element's `data-part` name (`p:Title`), `#id` or
`.class:tag`). "This part" means that element in that file. Read it with `kadr state`.

## project.json

```json
{
  "version": 1,
  "name": "launch-video",
  "width": 1920, "height": 1080, "fps": 30, "background": "#000000",
  "tracks": [
    {"id":"V1","kind":"video"},
    {"id":"V2","kind":"video","name":"titles"},
    {"id":"A1","kind":"audio"}
  ],
  "markers": [
    {"id":"m1","t":4.0,"note":"beat drop, cut here"}
  ],
  "clips": [
    {"id":"c1","track":"V1","type":"video","src":"media/intro.mp4","start":0,"duration":6.5,"in":12.2},
    {"id":"c2","track":"V2","type":"html","src":"comps/title.html","start":0.5,"duration":4,"props":{"title":"Hello"}},
    {"id":"c3","track":"A1","type":"audio","src":"media/music.mp3","start":0,"duration":30,"volume":0.5,"fadeOut":2}
  ]
}
```

All times are **seconds** (floats, rounded to ms on save). Positions are **pixels** of the project canvas.

### Tracks
- `kind`: `"video"` (holds `video`, `image`, `html` clips) or `"audio"` (holds `audio` clips).
- **Layering**: video tracks later in the array draw **on top**. `V1` is the bottom layer.
- Optional `hidden: true` (no picture), `muted: true` (no sound), `locked: true`
  (the user locked it: **do not change clips on a locked track** unless asked), `name`.
- To layer things over each other, put them on different tracks. Clips on the
  same track should not overlap (validate warns you if they do).

### Clips
| field | default | meaning |
|---|---|---|
| `id` | required | unique string; keep existing ids stable |
| `track` | required | track id |
| `type` | required | `video` \| `image` \| `html` \| `audio` |
| `src` | required | path relative to the project root, or `@kadr/text.html` (built-in text) |
| `start` | required | where the clip begins on the timeline |
| `duration` | required | how long it stays on the timeline |
| `in` | `0` | offset into the source: video/audio = media time; html = composition time |
| `speed` | `1` | playback speed 0.1..16 (0.5 = slow motion, 2 = double). Audio keeps its pitch |
| `fit` | `"contain"` | `contain` \| `cover` \| `fill`: how the source fits the canvas |
| `x`, `y` | `0` | offset in px from centered |
| `scale` | `1` | multiplies the fitted size |
| `rotation` | `0` | degrees, clockwise, around the clip's centre |
| `flipH`, `flipV` | `false` | mirror horizontally / vertically |
| `cropL`, `cropR`, `cropT`, `cropB` | `0` | percent of the source cut away from each side (the clip keeps its place; the cut part turns transparent) |
| `opacity` | `1` | 0..1 |
| `volume` | `1` | 0..4 (video and audio clips; preview caps at 1) |
| `fadeIn`, `fadeOut` | `0` | seconds; fades opacity for visuals and volume for sound |
| `xfade` | `0` | seconds of **cross dissolve** from the clip that ends exactly where this one starts on the same track |
| `keys` | | keyframes, see below |
| `brightness`, `contrast`, `saturation` | `1` | color, 0..4 (1 = unchanged; same math as CSS `brightness()` / `contrast()` / `saturate()`) |
| `props` | `{}` | html clips only: data passed to the composition |
| `label` | | display name in the editor |
| `disabled` | `false` | keep the clip but skip it |

Rules:
- A source frame shows at timeline time `t` as `in + (t - start) * speed`. So a cut
  means `duration` ends one clip and the next clip starts at the same time.
- Trimming the head: `start += d; in += d; duration -= d`.
- Splitting at `T`: the first part keeps `duration = T - start`; the second gets
  a new id, with `start = T`, `in = in + (T - start) * speed` and `duration = end - T`.
- Changing speed while keeping the same source: `duration = duration * oldSpeed / newSpeed`.
- Video clips play their own audio. To get separate control, set `volume: 0`
  on the video and add an `audio` clip with the same `src`/`in`/`start`/`duration`.
- `in + duration * speed` must not run past the media length (`kadr probe media/x.mp4`).
- Images and html clips can have any duration.
- Cross dissolve: put both clips back to back on one track (`a.start + a.duration == b.start`)
  and set `b.xfade` (e.g. `0.5`). It is centred on the cut: both clips play `xfade/2` past
  it (holding their first/last frame if the media runs out). Sound crossfades too.
  A "dip to black" is just `fadeOut` on the first clip and `fadeIn` on the second.

### Keyframes
`x`, `y`, `scale`, `rotation`, `opacity` and `volume` can be animated:

```json
"keys": { "scale": [[0, 1], [4, 1.15]], "x": [[0, -40], [4, 40, "linear"]], "opacity": [[0, 0], [0.4, 1]] }
```

- Each key is `[time, value]` or `[time, value, ease]`; **time is seconds from the clip's
  `start`** (not the timeline). Keys are sorted by time.
- `ease` shapes the move from that key to the next: `ease` (default, smooth in-out),
  `linear`, `in`, `out`, `hold` (jump at the next key).
- Before the first key the value is the first key's value; after the last key, the last one's.
- An animated property ignores its static field. Remove `keys.<prop>` to go back to it.
- Ken Burns: `"keys": {"scale": [[0, 1], [6, 1.12, "linear"]]}` with `"fit": "cover"`.
- When you trim a clip's head by `d`, subtract `d` from its key times (the editor does this).

### Media helpers
- `kadr freeze <src> <sourceTime>` writes a still to `media/freeze/` (use it as an image clip for a freeze frame).
- `kadr reverse <src> --in <s> --span <s>` writes a reversed copy to `media/reversed/`;
  point the clip's `src` at it with `in: 0`.
- Leave out fields that equal their defaults. kadr removes them on save anyway.

## Compositions (`comps/*.html`)

A composition is a normal HTML page, rendered at the project size
(`width` x `height`) with a **transparent background**, and layered like any
clip. The kadr runtime is injected automatically (`window.kadr`). It owns the
clock: time moves only when the editor or the renderer calls `kadr.seek(t)`,
which makes every frame deterministic. **The preview and the export match frame for frame.**

Three ways to animate. Pick whichever fits; mixing them is fine.

**1. CSS animations.** All CSS animations and transitions are paused and set
to composition time `t`. Schedule them with `animation-delay` measured from
composition start, and use `both` or `forwards` fill modes.
```css
.title { animation: rise .8s cubic-bezier(.16,1,.3,1) .3s both; }
@keyframes rise { from { transform: translateY(40px); opacity: 0 } }
```

**2. JS per frame.** `kadr.onFrame(fn)` runs `fn(t)` on every seek.
```js
kadr.onFrame((t) => {
  el.style.opacity = kadr.interp(t, [0, 0.5], [0, 1], 'outCubic');
  el.style.transform = `translateX(${kadr.interp(t, [0, 1], [-80, 0], 'outExpo')}px)`;
});
```
Canvas/WebGL: redraw the whole frame inside `onFrame` from `t` alone.
Libraries: GSAP works if you vendor it into `comps/vendor/` (no CDN in final
renders). Create the timeline paused, then `kadr.onFrame(t => tl.seek(t))`.

**3. CSS variables.** `:root` gets `--t` (seconds) and `--p` (0..1 progress
when a duration is declared), e.g. `transform: rotate(calc(var(--t) * 90deg))`.

Declare the natural length: `<meta name="kadr:duration" content="4">`. The
editor uses it as the default clip duration, and it powers `kadr.duration` and `--p`.

Declare the props and their defaults so the editor builds controls for them
(color pickers for colors, number fields with scrubbing, and so on):
`<meta name="kadr:props" content='{"title":"Hello","accent":"#e8ff59","size":120}'>`,
plus a one-line `<meta name="kadr:description" content="...">`.

### Props
`"props": {"title": "Hi", "accent": "#ff5a1f"}` on the clip. Inside the comp:
- `kadr.prop('title', 'fallback')` or `kadr.props.title`
- `<h1 data-prop="title">fallback</h1>` gets its text filled in automatically
- `<img data-prop-src="logo">` gets its src set
- every primitive prop is also a CSS variable on `:root`: `var(--accent)`
Props missing on a clip fall back to the defaults in `kadr:props` (also for
`kadr.prop()`), so keep those defaults complete and meaningful.
Make comps reusable through props rather than copying files.

### Keep comps editable in the GUI (the user edits them too)
The editor splits every composition into **parts** on the timeline (one row per
animated element) and lets the user change text, images, colors, size, timing,
speed and easing with the mouse. Those edits are written straight into this same
.html file as small, exact changes (a number, a word, one style property), so
**re-read the file before editing it**: the values may have changed since you wrote them.
Write comps so that the GUI can find each part:
- One element per visible part, with a name: `<h1 class="title" data-part="Title">`.
  The name is what the user sees on the timeline row.
- Text in the markup or in a prop (`data-prop`), not built up in a script string.
- Timings as plain numbers: CSS `animation: rise .8s ease-out .3s both;` or
  `kadr.progressIn(t, 0.3, 1.1, 'outCubic')` / `kadr.interp(t, [0.3, 1.1], …)`.
  Computed times (`a + i * 0.08`, `start + 0.2`) work but can't be dragged.
- In scripts, look elements up by id (`$('title')`, `getElementById('title')`,
  or `const title = $('title')`) so each timing is tied to its part. A
  `// comment` on the line above a timing becomes its name in the editor.
- Colors and sizes in CSS rules or `style=""`, as values (`#f5ecdb`, `64px`);
  shared colors as `:root` variables.

### Runtime API
`kadr.time`, `kadr.duration`, `kadr.progress`, `kadr.width`, `kadr.height`,
`kadr.props`, `kadr.prop(name, fallback)`, `kadr.onFrame(fn)`,
`kadr.interp(t, [t0,t1], [v0,v1], easing)`, `kadr.progressIn(t, t0, t1, easing)`,
`kadr.lerp`, `kadr.clamp`, `kadr.random(seed)` (seeded PRNG),
`kadr.delayRender()` returns a `done()` function (holds the frame until an async load finishes),
`kadr.ease.{linear,inQuad,outQuad,inOutQuad,inCubic,outCubic,inOutCubic,outQuart,outExpo,inOutExpo,outBack,outElastic}`.

### Composition rules (these are what break renders)
- Never animate from the real clock: no `Date.now()`, `performance.now()`,
  `requestAnimationFrame` loops, `setTimeout`/`setInterval`, or CSS `transition`
  triggered by events. Derive everything from `t`.
- No `Math.random()` for anything visible. Use `kadr.random(seed)`.
- Keep `html, body { background: transparent }` unless the comp is meant to be a full opaque frame.
- Design for the full canvas: `100vw`/`100vh`, or fixed px at the project size.
- Use local files for fonts and images (`comps/fonts/`, `media/`). Relative URLs
  work. System fonts like `system-ui` are fine.
- Don't use `<video>`/`<audio>` inside comps. Put footage on the timeline as clips.
- A comp shows time `in + (t - start)`. If the clip runs longer than the comp's
  duration, the last state holds.
- After editing a comp, run `kadr comp comps/x.html`. It renders frames and
  prints JS console errors. Fix all errors.

### Built-in templates (`@kadr/...`)
Ready-made, polished compositions you can use as `src` without copying them.
`kadr templates` lists them with every prop and its default:
- `@kadr/text.html`: simple text (text, size, color, weight, align, valign, bg, anim: none|fade|rise|type)
- `@kadr/title.html`, `@kadr/lower-third.html`, `@kadr/counter.html`
- `@kadr/kinetic.html`: kinetic typography; wrap a word in `*stars*` for the accent color
- `@kadr/captions.html`: social captions with the active word highlighted. For speech, pass
  exact timing: `"props": {"words": [{"w":"Hello","s":0.0,"e":0.4}, ...]}` (seconds, relative to the clip)
- `@kadr/wipe.html`: transition. Put it on the top track centered on a cut
  (`start = cut - duration/2`); it covers the frame fully at its midpoint
- `@kadr/end-card.html`: end card / call to action
- `@kadr/quote.html`: quote card (quote, author)
- `@kadr/logo-reveal.html`: logo reveal; `logo` is an image path (`/p/media/logo.png`), empty for a monogram
- `@kadr/subscribe.html`: subscribe button that gets clicked, with a bell
- `@kadr/bars.html`: bar chart; `labels` and `values` are comma-separated lists
- `@kadr/countdown.html`: 3-2-1 countdown (one number per second, `from`)
- `@kadr/callout.html`: circle + arrow + label pointing at `x`,`y` (percent of the frame)
Check one with `kadr comp @kadr/kinetic.html`. To customize beyond its props, copy
the file into `comps/` and edit it there.

## CLI reference

```
kadr info                         project summary (add --json for machine-readable)
kadr validate                     errors + warnings; exit code 1 on errors
kadr state                        editor selection / playhead / in-out
kadr add <src> [--track V2] [--at 3] [--in 0] [--duration 4] [--props '{"title":"x"}']
kadr frame <t...> [-o out.png]    composited still(s) -> .kadr/frames/
kadr sheet [file] [--count 12]    contact sheet (timeline, a video, or a comp)
kadr comp <file.html> [t...] [--props '{}'] [--bg #000]
kadr probe <file>                 media info (JSON)
kadr scenes <video> [--threshold 0.3]       scene cuts (JSON)
kadr silence <file> [--noise -35] [--min 0.4]   silent ranges (JSON), handy for jump cuts
kadr templates                    built-in compositions and their props
kadr render [-o renders/x.mp4] [--from t] [--to t] [--crf 18] [--codec h264|h265|prores|av1|vp9]
            [--size 3840x2160] [--loudness -14] [--motion-blur 8]
```

## Recipes

- **Rough cut from silences**: `kadr silence media/talk.mp4`. Build `V1`
  clips from the non-silent ranges, packed back to back (`start` of each = end
  of the previous; `in` = range start; `duration` = range length).
- **Cut on scene changes / beats**: `kadr scenes`, or markers the user placed
  (`markers[].t`).
- **Title over footage**: `html` clip on `V2`, same `start` as the shot, `fadeIn`/`fadeOut` 0.3.
- **Picture-in-picture**: video on `V2` with `scale: 0.3`, `x: 620`, `y: -320`.
- **Vertical video**: set `width: 1080, height: 1920`, and give footage `fit: "cover"`.
- **Music bed**: `audio` clip on `A1`, `volume: 0.35`, `fadeOut: 2`.
- **Slow motion**: `speed: 0.5` and twice the duration for the same moment.
- **Look**: `contrast: 1.1, saturation: 1.15` on footage for a punchier image; `saturation: 0` for black and white.
- **Transition between two shots**: `@kadr/wipe.html` on the top track centered on the cut, or
  `fadeOut`/`fadeIn` of 0.3 on both clips for a dip.
- **Delivery**: `kadr render --loudness -14` for web/social (EBU R128), `--codec prores` for a master,
  `--motion-blur 8` makes fast motion graphics look filmed rather than computer-made.

Always finish with `kadr validate` and at least one `kadr frame`/`kadr sheet` check.
