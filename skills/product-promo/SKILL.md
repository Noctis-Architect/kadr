---
name: product-promo
description: Make a short product promo, ad or launch video (6 to 60 s) in kadr: hook, problem, product, benefits, call to action, in brand colors. Use for ads, launch videos, app or product teasers, shop and service promos.
---

# Product promo / ad

## 1. Ask (or decide) the basics
Product and audience, the one thing viewers must remember, the call to action
(buy, visit, download, follow), length (6, 15, 30 or 60 s), format (16:9 web,
9:16 Stories/Reels, 1:1 or 4:5 feed), brand colors and logo file.

## 2. Structure
| part | share | what |
|---|---|---|
| Hook | first 1 to 2 s | the result, a bold claim or a question; motion right away |
| Problem | ~15% | the pain, in one line |
| Product | ~35% | the product in use, close-ups, the key feature |
| Proof | ~20% | a number (`@kadr/counter.html`), a quote (`@kadr/quote.html`), logos |
| Call to action | last 3 to 5 s | one clear action + logo (`@kadr/end-card.html` or `@kadr/logo-reveal.html`) |

## 3. Look
- One accent color everywhere (`accent` prop), one font, short words.
- Kinetic text for the claims (`@kadr/kinetic.html`; `*word*` gets the accent).
- Cuts on the music's beats; fast transitions (`flash`, `push`, `stripes`).
- No footage? Generate product shots or scenes with `kadr gen image` (same style
  words in every prompt) and move them (scale keyframes).

## 4. Sound
Upbeat music at full volume when nobody speaks, 0.15 under a voice-over
(`kadr gen speech`). Export `kadr render --loudness -14 --motion-blur 8`.

## 5. Variants
Offer the other formats from the same project: change `width`/`height`, set
`fit: "cover"`, re-check text positions with `kadr sheet`, render each.
