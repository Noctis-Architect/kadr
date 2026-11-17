---
name: instagram-post
description: Make Instagram feed videos (4:5, 3:4 or 1:1) and Stories (9:16) in kadr. Use when the user asks for an Instagram post, feed video or story. For Reels use the shorts-reels skill.
---

# Instagram feed and Stories

## Pick the format
| where | canvas | notes |
|---|---|---|
| Feed (most common) | `1080x1350` (4:5) | takes the most room in the feed |
| Feed, grid shape | `1080x1440` (3:4) | matches the profile grid's tall tiles |
| Feed, square | `1080x1080` | safest for carousels and older layouts |
| Story | `1080x1920` (9:16) | each story part is up to 60 s |
| Reel | see the `shorts-reels` skill | |

The profile grid crops posts toward the center, so keep the subject and any
text in the middle of the frame.

## Feed video
- Movement in the first second. Posts autoplay muted: add captions (the
  `captions` skill) and/or on-screen text (`@kadr/kinetic.html`).
- 15 to 60 s works best, one idea per post.
- Keep one look: the same accent color on every title (`accent` prop) and one font.
- End with one clear line (follow, link in bio, comment a word) for 2 to 3 s,
  not a long end card.

## Story
- Keep text out of the top ~250 px and the bottom ~340 px (profile bar and reply box).
- Big, short text; one message per 5 to 7 s part. Stickers such as polls are
  added in the app, so leave empty space where the user says they will go.

## Deliver
`kadr validate`, a `kadr sheet` for the user, then `kadr render --loudness -14`.
The default H.264 MP4 uploads fine.
