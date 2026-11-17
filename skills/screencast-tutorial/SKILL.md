---
name: screencast-tutorial
description: Edit a screen recording into a clear tutorial, demo or course lesson in kadr: cut waiting time, zoom into what matters, add callouts, steps and voice. Use for software demos, how-tos, courses, bug reports and product walkthroughs.
---

# Screen recording tutorial

## 1. Cut the dead time
- Remove waiting (loading, typing long text, mouse searching). `kadr silence`
  on the narration finds pauses; `kadr scenes --threshold 0.05` finds where the
  screen changes. Look at `kadr sheet media/rec.mp4 --count 24` before cutting.
- Long waits you must keep (an install, a render): speed them up with
  `speed` 4 to 8 and a small "4×" text in a corner.

## 2. Zoom to what matters
- Screen text is tiny on phones. When the action is in one area, zoom there
  with keyframes on `scale` (1 → 1.8) and `x`/`y` (move the area to the
  centre), ease `ease`, about 0.5 s in, hold, 0.5 s out.
  Formula: to centre point (px, py) of a full-frame clip at scale s,
  `x = (W/2 - px) * s` and `y = (H/2 - py) * s` (W, H = project size).
- Keep zooms calm: no more than one every few seconds.

## 3. Explain on screen
- Point at the thing: `@kadr/callout.html` with `x`, `y` in percent of the frame.
- Number the steps: a small title in a corner (`@kadr/text.html`, `size` 48, `bg` dark) "Step 2 – Export".
- Keyboard shortcuts as text when the user presses them.

## 4. Voice
- If there is no narration, write a short script per step and generate it
  (`kadr gen speech`), placing each line where its step starts.
- Add captions (`captions` skill); many people watch tutorials muted.

## 5. Deliver
16:9 for YouTube and courses (`kadr render --loudness -14`). For vertical,
crop to the important area (`fit: "cover"` and `x`) per step. Check with `kadr sheet`.
