---
name: lyric-video
description: Make a lyric video or a music video with animated text synced to a song in kadr: timed lines, the right animation style for the song, readable placement, matching visuals from the internet or generated. Use for "متن آهنگ", lyric videos, music clips with text, poems or spoken word over music, and quote videos set to music.
---

# Lyric video

The text is the star: every line must appear exactly when it is sung, stay
readable, and move with the music's mood.

## 1. Collect
- The song file (`media/…`). Ask for it if missing; never download copyrighted music.
- The lyrics as text from the user (best). If they have none, transcribe:
  `kadr gen transcribe media/song.mp3 --language fa` (music under the voice
  makes transcripts rough: always show the user the text and let them correct it).
- Format: 16:9 for YouTube, 9:16 for Reels/Shorts/TikTok/Stories (then follow the
  `shorts-reels` safe zones: text between ~15% and ~65% of the height).

## 2. Time every line
- Best: transcribe with word timing, then match the user's lyric lines to the
  transcript words (same words in order) and take each line's first word start
  as `s` and last word end as `e`. Keep the user's spelling, not the transcript's.
- Without a transcript: `kadr silence media/song.mp3 --noise -30 --min 0.25`
  gives vocal gaps in sparse songs; otherwise ask the user to tap `M` at the
  start of each line while the song plays and use the markers.
- Lines: 2 to 7 words each, split at the singer's breaths. A line stays at least
  1.2 s; if lines come faster, merge them. Leave 0.1 to 0.3 s between lines.
- Check timing with `kadr frame` at 3 to 4 line starts (`s + 0.1`): the right
  line must be on screen. The user should also listen to a short render.

## 3. Choose the style for the song
`@kadr/lyrics.html`, one clip across the whole song on a track above the
visuals, `"props": {"lines": [{"t": "…", "s": 12.4, "e": 15.1}, …], "style": "…"}`
(times from the clip start; give `words` with times for exact word sync).

| song | style | notes |
|---|---|---|
| pop, dance, rap, energetic | `pop` or `kinetic` | kinetic = one big word at a time; mark key words `*like this*` |
| ballad, slow, emotional | `fade` | calm, add a slow push-in on the background |
| karaoke / sing-along | `karaoke` | the sung word lights up in the accent color |
| spoken word, poem | `type` or `stack` | stack keeps the previous lines faintly visible |

- Mark 1 to 2 key words per chorus line with `*stars*` (accent color, bigger in kinetic).
- Size: 64 to 90 for 16:9, 80 to 110 for 9:16. `position`: `bottom` over busy
  footage, `center` over calm or blurred backgrounds.
- Persian/Arabic lines are laid out right to left automatically; use a font that
  has the script (`font: "Vazirmatn, system-ui, sans-serif"`) and keep `upper: false`.
- Long songs: split into one lyrics clip per section (verse, chorus) if you want
  different styles per section.

## 4. Visuals behind the text
- Pick a look for the mood: dark and calm for ballads, bright and fast for dance.
- Footage or photos: search free libraries (see the `find-media` skill):
  `kadr stock search "night city rain" --video --orientation landscape`, then
  `kadr stock get 1 2 3`. Or generate stills: `kadr gen image "…, cinematic"`.
- Cut the visuals on the beat or on line changes (never mid-word); slow motion
  (`speed` 0.5) and gentle zooms suit most songs.
- Readability first: darken busy backgrounds with `brightness` 0.6 to 0.75, or put
  `@kadr/color.html` (black, `opacity` 0.35) between visuals and text.

## 5. Finish
- Title card with the song name and artist at the start (`@kadr/title.html`),
  credits for stock media from `media/stock/CREDITS.md` in the description.
- `kadr validate`, `kadr lint`, `kadr sheet --count 16`, then
  `kadr render --loudness -14 --motion-blur 8` (motion blur smooths moving text).
