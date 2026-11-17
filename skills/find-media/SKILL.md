---
name: find-media
description: Find and download photos, video clips and facts from the internet for a kadr project, legally: free stock libraries (Wikimedia Commons, Pexels, Pixabay, Openverse), the user's own website, or generated images as a fallback. Use when a video needs B-roll, backgrounds, product photos, or information the user did not provide.
---

# Find media and facts online

## Photos and video clips
1. Search with concrete words (subject + setting + mood), in English (the
   libraries index English best):
   `kadr stock search "coffee beans close up" --orientation landscape`
   `kadr stock search "city traffic night" --video`
   Libraries: `--from wikimedia` (free, no key, photos and some video), `pexels` and
   `pixabay` (free key in AI settings → API keys, best for video), `openverse`.
   Without `--from`, kadr picks the best one that is set up.
2. Read the results (size, length, license), download only what you will use:
   `kadr stock get 2 5`. Files land in `media/stock/`, credits in `media/stock/CREDITS.md`.
3. Look at what you got before using it: `kadr sheet media/stock/<file>`.
4. Match the format: landscape for 16:9, portrait for 9:16; at least the project's
   size (or use it smaller, with `fit: "cover"` and motion).
5. If nothing fits after two or three searches, generate it:
   `kadr gen image "<scene>, photo, natural light"` (if an image service is set up).

## Licenses (say this to the user when it matters)
- Pexels and Pixabay: free to use, no credit required.
- Wikimedia Commons and Openverse: various free licenses; many (CC BY, CC BY-SA)
  require crediting the author. CREDITS.md lists each file with its license:
  tell the user to paste the needed credits into the video description.
- Never download from search engines, social networks or random sites: that
  footage is usually copyrighted. Never download music; ask the user for it.

## The user's website
`kadr site https://example.com` reads the page: title, description, product
name and price (when the page lists them), brand color, main text and the
biggest images (into `media/site/<host>/`). The notes go to
`brief/site-<host>.md`. Use them as facts, but confirm prices and claims with
the user before they go on screen.

## Networks that block some sites
If a library cannot be reached (blocked network), try another one
(`--from wikimedia` often works where others don't), or ask the user to run kadr
with a VPN / proxy.
