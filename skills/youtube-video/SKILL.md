---
name: youtube-video
description: Edit a long-form YouTube video (16:9) in kadr. Use when the user wants a YouTube video, vlog, tutorial, review or talking-head edit, or asks to make footage "ready for YouTube" (tight cuts, hook, B-roll, lower thirds, chapters, end screen, loudness).
---

# YouTube long-form edit

Goal: a 16:9 video that keeps people watching. Work in this order and show the
user a `kadr sheet` after each big step.

## 1. Set up
- Canvas `1920x1080` (or `3840x2160` if the footage is 4K). Keep the footage's
  frame rate (`kadr probe`); don't convert 25 to 30 or back.
- Tracks: `V1` footage, `V2` B-roll and images, `V3` titles and lower thirds,
  `A1` dialogue (if detached), `A2` music. Add tracks to `project.json` as needed.

## 2. Rough cut (the biggest win)
- `kadr silence media/talk.mp4 --noise -35 --min 0.4`, then rebuild `V1` from the
  non-silent ranges, back to back. Leave about 0.08 s before and 0.12 s after
  each range so words are not clipped.
- If transcripts are set up (`kadr gen transcribe media/talk.mp4`), also remove
  repeated takes, false starts and long "umm"s by word time.
- Pacing for talking heads: no pause longer than about 0.4 s, and something
  changes on screen every 5 to 10 s (a cut, a zoom, B-roll, a graphic).

## 3. Hook (first 5 to 15 s)
- Open with the strongest line or the result, not a greeting. If the best moment
  is later, copy that clip to the start, then cut to the intro.
- Add a title only if it helps, and keep it short (`@kadr/kinetic.html` or `@kadr/title.html`).

## 4. Make it move
- Jump-cut zooms: alternate `scale` 1 and 1.12 on consecutive talking-head clips
  (adjust `y` so the face stays framed). Every second or third cut, not every one.
- Punch in on emphasis: `"keys": {"scale": [[0, 1], [0.25, 1.08, "out"]]}`.
- B-roll on `V2` over the talking head when the speaker describes something:
  `fit: "cover"`, and a slow push on stills: `"keys": {"scale": [[0, 1], [d, 1.1, "linear"]]}`.
  No footage? `kadr gen image "<what is described>, photo" --size 1536x1024`.
- A lower third the first time a person or place appears: `@kadr/lower-third.html`, 4 to 5 s.
- Numbers, quotes and lists: `@kadr/counter.html`, `@kadr/quote.html`, `@kadr/bars.html`, `@kadr/callout.html`.

## 5. Sound
- Music on `A2` at `volume` 0.12 to 0.2 under speech (louder only when nobody talks),
  `fadeIn` 1, `fadeOut` 2 to 3. Cut music on a beat where you can.
- Give dialogue clips a tiny `fadeIn`/`fadeOut` (0.03) on every cut to avoid clicks.

## 6. Chapters and end screen
- Put a marker at each topic change (`markers[]`, `note` = chapter name). Give the
  user the list as `0:00 Intro`, `1:24 ...`. YouTube needs the first chapter at
  0:00, at least three chapters, each at least 10 s long.
- End screen: the last 5 to 20 s (the video must be at least 25 s). Leave room
  for YouTube's end-screen boxes, e.g. `@kadr/end-card.html` or calm footage.
  `@kadr/subscribe.html` works as a short mid-video subscribe nudge.

## 7. Check and deliver
- `kadr validate`, `kadr lint` if you touched comps, `kadr sheet --count 16`.
- Export: `kadr render --loudness -14` (YouTube plays back around -14 LUFS).
- Offer a thumbnail (the `thumbnail` skill) and Shorts from the best moments
  (the `repurpose-clips` skill).
