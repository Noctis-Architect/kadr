---
name: captions
description: Add captions or subtitles that follow the speech, word by word, using kadr's transcription and the @kadr/captions.html template. Use when the user asks for subtitles, captions, "زیرنویس", animated words, or text that matches what is said.
---

# Captions that follow the speech

## 1. Get word timing
- `kadr gen transcribe media/talk.mp4 --language fa` (use the spoken language's
  code: fa, en, ar, de ...). It prints a JSON path in `media/gen/` with
  `words: [{w, s, e}]` in seconds **of the source file**.
- If it says transcription is not set up, tell the user to add a transcription
  service in Chat → settings (OpenAI or Groq Whisper). Without it, captions can
  only spread the text evenly (`text` prop), which looks wrong for real speech.
- For a long file, transcribe only the used range: `--from 120 --span 45`.

## 2. Map source time to timeline time
Each video clip shows source time `in + (t - start) * speed`. For a clip `c`,
a word with source times `s, e` appears at clip-relative times
`(s - c.in) / c.speed` and `(e - c.in) / c.speed`. Keep only words that fall
inside `0 .. c.duration`.

## 3. Place caption clips
- One `@kadr/captions.html` clip per video clip, on a track above the footage,
  with the same `start` and `duration` as that clip, and
  `"props": {"words": [{"w": "...", "s": 0.12, "e": 0.40}, ...]}` using the
  clip-relative times from step 2.
- Look: `size` 84 to 100 for vertical, 64 to 76 for 16:9; `perLine` 2 to 4;
  `accent` = the highlighted word's color; `upper: false` for Persian/Arabic
  (no capitals). `y` about 78 for 16:9, about 58 for vertical (safe zone).
- Persian and Arabic: keep words in spoken order; the template lays them out right to left.
- If the cut list changes later, rebuild the caption clips from the same JSON.

## 4. Check
`kadr frame` at three or four times in the middle of sentences: the highlighted
word must be the one being said, and no caption may cover a face or sit in an
app's button area (see `shorts-reels` for vertical safe zones).
