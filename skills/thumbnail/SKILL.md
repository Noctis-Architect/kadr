---
name: thumbnail
description: Design a YouTube thumbnail (1280x720) or a cover image in kadr, from a frame of the video or a generated image plus bold text. Use when the user asks for a thumbnail, cover, poster frame or "kaver".
---

# Thumbnail / cover

## Rules that make thumbnails work
- 1280x720 (16:9) for YouTube, under 2 MB (PNG or JPG). For a Reel or Short
  cover use 1080x1920 and keep the important part in the middle 1080x1350.
- One subject, big and close (a face with clear emotion works best), one idea.
- Three to five words maximum, huge (it is seen at phone size), high contrast,
  thick outline or shadow. The text adds to the title; it does not repeat it.
- Nothing important in the bottom-right corner (YouTube puts the length there).

## Make it
1. Make a separate project so the video's timeline stays untouched:
   `kadr init thumb --size 1280x720` next to the video project (ask where, if unsure).
2. Background, one of:
   - the best frame of the video: find it with `kadr sheet media/x.mp4 --count 24`,
     then `kadr freeze media/x.mp4 <time>` and use the PNG as an image clip;
   - a generated image: `kadr gen image "<scene>, dramatic light, high contrast" --size 1536x1024`.
3. Make the subject pop: `contrast` 1.15, `saturation` 1.2 on the image clip;
   a cut-out or a slight `scale` 1.1 toward the subject.
4. Text: a composition in `comps/thumb-text.html` (or `@kadr/text.html` with
   `size` 140 to 180, `weight` 900, a bright `color`). Add `-webkit-text-stroke`
   or a heavy `text-shadow` for readability. Run `kadr lint` on your comp.
5. Export the still: `kadr frame 0 -o renders/thumbnail.png`.

## Check
Look at the PNG at full size and imagine it at 1/8 size: can you still read the
words and see the face? Make two variants (different text or crop) and let the
user choose.
