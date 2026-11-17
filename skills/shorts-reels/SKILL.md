---
name: shorts-reels
description: Make a vertical short (YouTube Shorts, Instagram Reels, TikTok) in kadr at 9:16, 1080x1920. Use for any vertical, short-form or "reel" request, or when turning 16:9 footage into vertical.
---

# Vertical short: Shorts, Reels, TikTok

## Format
- Canvas `1080x1920`, 30 fps (or the footage's own 25 or 60). Aim for 15 to 45 s.
  The apps allow longer (Shorts and Reels about 3 minutes, TikTok more), but
  short wins. Limits change: if the user asks about one, tell them to check the app.
- 16:9 footage: `fit: "cover"` fills the frame by cropping the sides. Set `x` so
  the speaker's face stays in frame (check with `kadr frame`). For screen
  recordings or wide shots use `fit: "contain"` over a colored or blurred
  background layer, or a split layout (two clips at `y: -480` and `y: 480`).

## Safe zones
The app's buttons and caption text cover parts of the frame:
- Keep text and faces out of the top ~14% (about 270 px) and the bottom ~35%
  (about 670 px), and about 140 px away from the right edge.
- For `@kadr/captions.html` that means `y` around 55 to 62 (percent from the top), not 78.

## Structure
1. **Hook in the first 1 to 2 s**: the most surprising line, the result, or a bold
   on-screen question. No logo intro and no greeting.
2. **Fast pace**: a cut every 1 to 3 s, every silence removed
   (`kadr silence --min 0.25`), jump-cut zooms (`scale` 1 and 1.15 alternating).
3. **Captions on everything spoken** (most people watch muted): follow the
   `captions` skill. Two to four words at a time, big (size 84 to 100), high contrast.
4. **Payoff and loop**: end right after the payoff. If you can, make the last
   moment lead back into the first so a replay feels seamless. No long end card.

## Sound
- Speech clear and loud, music at `volume` 0.1 to 0.2 under it.
- Export with `kadr render --loudness -14 --motion-blur 8` (motion blur makes
  moving text look smooth on phones).

## Check
`kadr validate`, then `kadr sheet --count 12`. Look for text inside the safe
zone, the face in frame on every clip, and no black bars unless intended.
