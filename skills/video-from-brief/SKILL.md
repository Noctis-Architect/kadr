---
name: video-from-brief
description: Turn a brief (brief/brief.json from the editor's "New video from a brief" form, or a description in chat) into a finished video in kadr, working like a small agency: read everything given, research the website, ask only what is missing, write a short plan, build, check, deliver. Use whenever the user describes a video they want made from their product, business, song, photos or idea.
---

# Video from a brief

## 1. Read everything first
- `brief/brief.json` (when the form was used): kind of video, name, description,
  audience, key message, call to action, platform and size, length, tone,
  colors, language, voice-over wish, files (photos, logo, footage, music, lyrics), website.
- Every file it lists: look at the images and footage (`kadr sheet <file>`), probe
  the music (`kadr probe`), read lyrics and notes.
- The website, if given: `kadr site <url>` and read `brief/site-<host>.md`
  (facts, brand color, product images).
- The skill for the kind of video: `product-promo`, `lyric-video`,
  `photo-slideshow`, `voiceover-explainer`, `shorts-reels`, `youtube-video`,
  `montage-highlights`… and `find-media` when material is missing.

## 2. Ask only what blocks you
After reading, list what is still unknown. Ask at most three short questions in
one message, each with a sensible default ("I'll use 30 s unless you prefer
15 s"). Don't ask what the brief or the website already answers. If nothing
blocks you, don't ask: go.

## 3. Plan (show it, then build)
Write a short plan in the user's language:
- the idea in one sentence;
- scene list with times: what is on screen, which text, which file or stock search;
- music and voice: given file, generated voice-over (`kadr gen speech`), or none;
- look: colors from the brand (site theme color or the brief), fonts, text style.
Unless the user asked to see the plan first, continue building right after it.

## 4. Build
- Set the project size and fps for the platform (`project.json`).
- Missing visuals: `kadr stock search` / `kadr stock get`, or `kadr gen image` in
  one consistent style. Product photos from the user or the site come first.
- Text on screen: short, in the brief's language, on-brand. Templates first
  (`kadr templates`), custom comps only when needed (`kadr lint` them).
- Cut on the music; transitions from the editor's set (`xfadeType`, flash, wipe…).
- Call to action and logo at the end, website or handle as text.

## 5. Check and hand over
- `kadr validate`, `kadr lint`, `kadr sheet --count 16`; fix anything off-brand,
  unreadable or outside the safe area.
- Tell the user, briefly: what you made, where facts came from, what to check
  (prices, claims, spelling of names), and the credits from `media/stock/CREDITS.md`.
- Offer variants: other formats (`social-formats`), a shorter cut, a thumbnail.
- Render only when asked (`kadr render --loudness -14`).
