---
name: audio-mix
description: Balance and clean up the sound of a kadr project: speech level, music under voice (ducking), fades, clicks at cuts, loudness for each platform. Use when the user says the music is too loud, the voice is quiet, levels jump, or before any final export.
---

# Audio mix

## 1. Know what you have
`kadr info` lists every clip with its `volume`. Video clips play their own
audio unless `volume: 0`. Speech usually lives on the footage or `A1`, music on `A2`.

## 2. Speech first
- Every speaker about equally loud: adjust each clip's `volume` (0.5 to 2;
  above 1 is applied on export).
- Tiny fades on every speech cut avoid clicks: `fadeIn` and `fadeOut` 0.02 to 0.04.
- Remove silences and breaths only when the user wants a tight edit (`kadr silence`).

## 3. Music under speech (ducking)
- Music `volume` about 0.15 while someone talks, back to 0.5 to 0.8 in gaps.
- Do it with keyframes on the music clip's `volume`, 0.3 to 0.5 s before and
  after each speech block (times are seconds from the music clip's start):
  `"keys": {"volume": [[0, 0.7], [3.6, 0.7], [4.0, 0.15], [12.0, 0.15], [12.5, 0.7]]}`.
  Find the speech blocks with `kadr silence` on the speech file.
- Music always fades: `fadeIn` 1 to 2 s, `fadeOut` 2 to 4 s.

## 4. Loudness for the platform
| where | export |
|---|---|
| YouTube, Instagram, TikTok, web | `kadr render --loudness -14` |
| podcasts, Spotify video | `--loudness -16` |
| TV / broadcast | `--loudness -23` |

## 5. Check
Render a short range around a tricky spot (`kadr render --from 30 --to 45 -o renders/check.mp4`)
and ask the user to listen; you can't hear it yourself.
