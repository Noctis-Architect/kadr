---
name: social-formats
description: Pick the right size, length and safe area for a platform and adapt one edit to several platforms in kadr. Use for X (Twitter), LinkedIn, Facebook, Telegram, WhatsApp status, Aparat, Snapchat, Pinterest, or "make versions for all my socials". For YouTube, Shorts/Reels/TikTok and Instagram there are dedicated skills.
---

# Social formats and multi-platform versions

Limits change often: give these as safe defaults and tell the user to check the
app if a limit matters.

| platform | canvas | good length | notes |
|---|---|---|---|
| X (Twitter) | 1920x1080 or 1080x1350 | 15 to 45 s | autoplays muted: captions |
| LinkedIn | 1920x1080, 1080x1080 or 1080x1350 | 30 to 90 s | captions, calm pace, clear title at the start |
| Facebook feed | 1080x1350 (4:5) or 1080x1080 | 15 to 60 s | same as Instagram feed |
| Facebook / Messenger stories | 1080x1920 | up to 15 s per part | `shorts-reels` safe zones |
| Telegram channel | 1920x1080 or 1080x1920 | any | keep files small: `kadr render --codec h265`, or a higher `--crf` (23 to 26; higher = smaller file) |
| WhatsApp status | 1080x1920 | up to about 60 s per part | small files, big text |
| Aparat | 1920x1080 | any | like YouTube; Persian captions help reach |
| Snapchat | 1080x1920 | 5 to 30 s | keep text in the middle |
| Pinterest | 1080x1920 or 1000x1500 | 6 to 30 s | title in the first second |

## Making versions from one edit
1. Finish and approve the main version first.
2. For each other format, copy the project folder (`kadr init` a sibling and
   copy `project.json`, `comps/`, and point at the same media) or ask the user
   which they prefer; then change `width`/`height`.
3. Footage: `fit: "cover"` and re-aim `x`/`y` per clip so faces stay in frame.
4. Text and graphics: re-check every comp with `kadr sheet`; move titles into the
   safe area; vertical needs bigger text (about 1.3x).
5. Render each with a name per platform: `-o renders/<name>-x.mp4`, `-linkedin`, …
