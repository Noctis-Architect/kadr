---
name: montage-highlights
description: Cut a music-driven montage or highlight reel from lots of footage in kadr: travel videos, vlogs, events, weddings, sports, behind the scenes, "best of" recaps. Use when there is a lot of footage and the result should be short and rhythmic.
---

# Montage / highlight reel

## 1. Look at everything first
- `kadr sheet media/<file> --count 16` for each clip, and `kadr scenes` to find
  shot changes inside long files. Note the best moments: faces and emotion,
  motion, wide establishing shots, details.
- Pick the music first: its length and energy decide the edit.

## 2. Beats
- If the user placed markers on the beats, cut on them. If not, ask them to tap
  `M` on the beats while the music plays (that sets markers), or cut every
  1, 2 or 4 bars at an even pace from the tempo they give you.
- Energy follows the music: longer shots in quiet parts, quick cuts in loud parts.

## 3. Shape
- Open with a wide shot or a strong moment, build up, peak at the music's
  climax, end on a calm or emotional shot with a title or logo.
- Mix shot sizes (wide, medium, close) and avoid two similar shots in a row.
- Speed ramps for action: `speed` 0.5 on the peak moment, normal around it.
- Use the shot's best part: set `in` to just before the action.

## 4. Look and sound
- Same look across clips: match `brightness`/`contrast`/`saturation` (see the `color-look` skill).
- Transitions mostly cuts; `flash` or `push` on big hits only.
- Music at full volume; keep a few natural sounds (laughs, cheers) at 0.4 to 0.6 on top.
- Export `kadr render --loudness -14 --motion-blur 8`.
