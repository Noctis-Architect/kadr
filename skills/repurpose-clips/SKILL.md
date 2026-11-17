---
name: repurpose-clips
description: Cut a long video, podcast, stream or interview into several short clips for Shorts, Reels and TikTok in kadr. Use when the user wants highlights, "clips from this podcast", a best-of, or several shorts from one long recording.
---

# Long video to short clips

## 1. Find the moments
- Best source of truth is the words: `kadr gen transcribe media/long.mp4`
  (in parts with `--from`/`--span` for very long files). Read the segments and
  pick 3 to 6 moments that make sense alone: a strong claim, a story with a
  punchline, a surprising number, a clear how-to, a funny exchange.
- Each moment: 15 to 60 s, starts on the first word of a complete thought, ends
  right after the payoff. Avoid moments that need earlier context.
- Without transcripts: use `kadr silence` (speech blocks) and `kadr scenes`, plus
  `kadr sheet media/long.mp4 --count 24` to look, and ask the user which parts matter.
- Show the user the list (start–end, one-line summary, a suggested title)
  before building, unless they asked you to just go.

## 2. Build each short
- One project per short is cleanest: `kadr init ../short-1` in a sibling folder,
  copy or link the media path, or ask the user where they want them. If they
  prefer one project, place the shorts one after another with a marker at each
  start and render each range with `kadr render --from a --to b -o renders/short-1.mp4`.
- Then follow the `shorts-reels` skill: 1080x1920, crop to the speaker, remove
  silences, captions (`captions` skill), a hook line as on-screen text in the
  first 2 s if the clip's first words are not already a hook.
- Two speakers: cut to whoever is talking (by transcript segments), or stack
  both (top/bottom) if they talk over each other.

## 3. Deliver
For each short: `kadr validate`, a `kadr sheet`, render with
`--loudness -14 --motion-blur 8`, and give the user a title and a one-line
description per clip.
