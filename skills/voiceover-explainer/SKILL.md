---
name: voiceover-explainer
description: Build a video from a topic or script without filming, in kadr: write the script, generate the voice-over and images, then cut them to the voice with captions and motion. Use for "faceless" videos, explainers, narrated slideshows, or when the user gives text and wants a video.
---

# Voice-over explainer (no camera)

Needs the voice service (`kadr gen speech`) and usually images
(`kadr gen image`) set up in Chat → settings. If one is missing, say which and
offer what works without it (e.g. kinetic text instead of images).

## 1. Script
- Ask for, or write, a script of short spoken sentences (about 150 words per
  minute). Hook in the first sentence. Write in the language the video is for.
- Split it into beats: one beat = one sentence or idea = one visual. Show the
  beats to the user before generating anything (generation costs their credits).

## 2. Voice
- One file per beat makes cutting easy:
  `kadr gen speech "<beat text>" -o media/vo/01.mp3` (`--voice` to pick a voice,
  `--style "calm, warm"` for services that take instructions).
- `kadr probe` each file for its length. Place them back to back on `A1` with
  0.15 to 0.3 s gaps.

## 3. Visuals
- For each beat, one image or clip on `V1` exactly as long as its voice line (plus the gap):
  `kadr gen image "<concrete scene for this beat>, <one consistent style>" --size 1536x1024`
  (use `1024x1536` for vertical). Repeat the same style words in every prompt so
  the images match.
- Movement on every still: alternate slow push-ins and pull-outs
  (`"keys": {"scale": [[0, 1], [d, 1.12, "linear"]]}` then `[[0, 1.12], [d, 1, "linear"]]`),
  `fit: "cover"`, and a short `xfade` (0.3 to 0.5) between images.
- Numbers and lists as graphics instead of images: `@kadr/counter.html`, `@kadr/bars.html`, `@kadr/kinetic.html`.

## 4. Captions and music
- Captions from the voice: `kadr gen transcribe` on each voice file, or on a
  render of the voice track, then the `captions` skill.
- Music on `A2`, `volume` 0.1 to 0.15, `fadeOut` 2.

## 5. Check and deliver
`kadr validate`, `kadr sheet --count 16`, then `kadr render --loudness -14`.
For vertical platforms also follow the `shorts-reels` safe zones.
