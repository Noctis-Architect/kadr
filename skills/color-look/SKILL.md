---
name: color-look
description: Fix and match the color of footage in kadr, or give a video a consistent look (warm, cold, cinematic, black and white, punchy for social). Use when the user says the video looks dark, flat, dull, too bright, mismatched between clips, or asks for a "look" or "mood".
---

# Color: fix, match, look

kadr has three color controls per clip: `brightness`, `contrast`, `saturation`
(1 = unchanged, same math in the preview and the export). Use small steps.

## 1. Look before changing
`kadr frame` at a typical moment of each clip, ideally with people in it. Judge
skin tones, the brightest and darkest parts, and whether clips next to each
other look like the same day.

## 2. Fix problems first
| problem | change |
|---|---|
| too dark | `brightness` 1.1 to 1.3 (a little `contrast` 1.05 keeps it from looking washed out) |
| too bright | `brightness` 0.85 to 0.95 |
| flat, grey (log or hazy footage) | `contrast` 1.15 to 1.3, `saturation` 1.1 to 1.25 |
| too colorful | `saturation` 0.8 to 0.9 |

## 3. Match clips
Pick one "hero" clip that looks right, then bring the others toward it, one
control at a time, comparing `kadr frame` images side by side.

## 4. Looks
| look | settings on every clip |
|---|---|
| punchy social | contrast 1.12, saturation 1.2 |
| soft, airy | brightness 1.06, contrast 0.92, saturation 0.9 |
| cinematic / moody | brightness 0.92, contrast 1.15, saturation 0.85 |
| black and white | saturation 0, contrast 1.15 |
| faded, nostalgic | contrast 0.85, saturation 0.75, brightness 1.04 |

Warm or cold tints need a color layer: an `@kadr/color.html` clip on a track
above the footage, as long as the footage, with `"props": {"color": "#ff8a3d"}`
(warm) or `"#3d7bff"` (cold) and the clip's `opacity` 0.06 to 0.12.

## 5. Check
Show the user before/after frames (`kadr frame` before changing, then after).
Skin must still look natural.
