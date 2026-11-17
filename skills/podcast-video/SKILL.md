---
name: podcast-video
description: Edit a video podcast or interview in kadr (one, two or more cameras, or audio only). Use for podcasts, interviews, talk shows, round tables and "make my podcast into a video".
---

# Video podcast / interview

## 1. Line up the sources
- Several cameras and a separate audio recorder are usually out of sync. Find a
  shared sound (clap, first word) with `kadr sheet` and `kadr silence` on each
  file, and shift each clip's `in` so they line up. Check with `kadr frame` at
  three points that lips match the sound.
- Put the best audio on `A1` and set `volume: 0` on the camera clips.
- Audio only: use a still (cover art, a photo of the hosts) or generate one
  (`kadr gen image`), slow push-in, plus captions (`captions` skill).

## 2. Cut to who is talking
- With a transcript (`kadr gen transcribe`), the segments tell you who speaks
  when; otherwise `kadr silence` on each person's mic. Show the speaker, and
  cut to the listener for reactions every 20 to 40 s so it is not static.
- Don't cut faster than every 2 to 3 s; wide shot when people talk over each other.
- Remove long silences, false starts and off-topic tangents only if the user wants it tighter.

## 3. Graphics
- Lower third for each guest the first time they speak (`@kadr/lower-third.html`).
- Topic title at each chapter (`@kadr/title.html`), markers for chapters.
- Pull-quote of a strong sentence: `@kadr/quote.html`.

## 4. Sound
- Speech even across people: adjust each speaker's `volume` so they sound equally loud.
- Intro and outro music only, `fadeOut` 2 to 3 s under the first words.
- Export `kadr render --loudness -16` (podcast standard) or `-14` for YouTube.

## 5. Extra deliverables
Offer short clips of the best moments (`repurpose-clips` skill) and a thumbnail (`thumbnail` skill).
