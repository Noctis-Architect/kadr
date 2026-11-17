---
name: photo-slideshow
description: Turn photos (and a few clips) into a slideshow video with music in kadr: order, gentle motion, transitions on the beat, titles. Use for birthdays, weddings, trips, memorials, portfolios, real estate and "make a video from these pictures".
---

# Photo slideshow

## 1. Gather and order
- List the images in `media/` (`kadr sheet` on a folder is not possible: look
  at a few with `kadr frame` after placing them, or read file names and dates).
- Order by time or by story (start strong, end on the best one). Drop
  duplicates and blurry shots; ask the user if unsure.

## 2. Timing
- 3 to 5 s per photo for calm music, 1.5 to 2.5 s for fast music. If the user
  marked beats (`markers`) or the music has a clear pulse, put every cut on a
  marker. Total length = the music's length, or trim the music with `fadeOut` 3.

## 3. Motion and transitions
- `fit: "cover"` for photos that should fill the frame; `contain` on a blurred or
  dark background for portraits in a landscape video.
- Slow movement on every photo, alternating: push-in
  `"keys": {"scale": [[0, 1], [d, 1.1, "linear"]]}`, pull-out, and small `x` drifts.
- Transitions: `xfade` 0.6 to 1 s dissolves for calm pieces; pushes for upbeat ones.
  Don't mix many styles.

## 4. Text
Opening title (`@kadr/title.html`), optional captions for places or dates
(`@kadr/lower-third.html`), closing line (`@kadr/end-card.html`).

## 5. Deliver
`kadr validate`, `kadr sheet --count 16`, then `kadr render --loudness -14`.
For phones: 1080x1920 and the `shorts-reels` safe zones.
