# Image prompts

Everything that can be drawn as SVG is already in the app (`web/js/art.js`): the
logo, empty-state illustrations, template thumbnails, project posters. These are
the images that SVG can't do well. Generate them, save them under the file name
given, and they get wired in.

Shared style for all of them: dark UI (background `#09090a` to `#141417`),
one accent color, electric lime `#e8ff59`, with soft violet `#c7b8ef` and steel
blue `#a9c4ea` as secondary colors. Calm, precise, premium; no text in the image
unless the prompt says so.

---

## 1. App icon (for the Electron/Tauri build)
**File:** `design/app-icon-1024.png` · **Size:** 1024×1024, PNG

> A macOS-style app icon, rounded square (squircle) with a deep charcoal
> background (#111113) and a very subtle top-left glossy highlight. In the center,
> a minimal camera viewfinder: four thick rounded corner brackets in electric lime
> (#e8ff59), framing a solid lime play triangle. Soft lime glow behind the
> triangle, faint film-grain texture, crisp vector-like edges, gentle drop shadow
> under the squircle. Flat, modern, no text, no extra objects.

## 2. Start screen hero
**File:** `web/img/hero.webp` · **Size:** 1600×1000, transparent or #09090a background

> Isometric 3D illustration on a near-black background (#09090a): a floating
> glass video frame showing an abstract gradient scene, below it a thin timeline
> made of rounded clip blocks in violet (#4c406d), steel blue (#34496a) and dark
> green (#2c4d40), and a vertical electric-lime (#e8ff59) playhead line cutting
> through them. Small four-point lime sparkles around it. Soft studio lighting,
> subtle reflections, clean minimal composition, lots of empty space around the
> object, centered. No text, no UI words.

## 3. Sample footage stills (so templates have something to sit on)
**Files:** `template/media/sample-city.jpg`, `template/media/sample-studio.jpg`,
`template/media/sample-nature.jpg` · **Size:** 1920×1080 (also make 1080×1920 versions with `-vertical` in the name)

> **city:** Cinematic night city street in light rain, shallow depth of field,
> large bokeh lights in teal and amber, a lone figure with an umbrella slightly
> off-center, room for a title on the left third, 35mm film look, natural colors.

> **studio:** A clean creator's desk from a high angle: laptop, a coffee cup, a
> small plant, a notebook, soft morning window light, warm neutral tones, lots of
> negative space at the top for text, realistic product photography.

> **nature:** Wide aerial view of misty green mountains at sunrise, soft golden
> light on the ridges, calm and spacious, low contrast, empty sky in the upper
> half for titles, realistic photography.

## 4. Dark texture for quote / logo backgrounds
**File:** `builtin/assets/grain-dark.jpg` · **Size:** 1920×1080

> Seamless dark abstract background: deep charcoal (#0b0b0e) with a very soft
> radial glow of violet (#2a2340) in the lower left and steel blue (#16202e) in the
> upper right, fine film grain, extremely subtle, no shapes, no text.

## 5. Placeholder avatar for the Subscribe template
**File:** `builtin/assets/avatar.png` · **Size:** 512×512, PNG

> A friendly flat-illustration avatar of a young video creator wearing headphones,
> simple shapes, warm skin tones, coral and lime accents, solid soft coral
> background, centered head and shoulders, circular-crop friendly, no text.
