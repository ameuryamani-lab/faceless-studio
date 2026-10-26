# House style — the technical shape every video inherits (studio file, any concept)

Studio file: what every video shares whatever the show. The drawing style, palette, hero, framing sentences and narrator are the
CONCEPT's (`concept/<id>/concept.json` style, palette, hero_lock, prompt, voice; `concept/<id>/rules.md`). `brand/lessons.md` overrides this file.
Checked by code: `core/qc` (format, loudness, black or frozen segments) and `core/guardrails/story.mjs` (counts, no text in an image).

<!-- Plan-then-render editing, code QC targets and the caption safe zone adapted from AttentionOS (MIT, Evan Baker, commit 89f6781). -->

## Format
- Vertical 1080×1920, 30 fps, H.264, AAC 48 kHz. Length 60 s at most; the concept sets its target (concept.json `format.seconds`).
- One still per narrated line (concept.json `format.scenes` sets the count). A still stays at least 3.5 s (workshop/story/make-short.mjs) and should not run past about 6 s: shorten the line instead.
- Shot 1 is the hook frame: the hero visible and large, with the scene's main object, a frame that works as a thumbnail.
- The first spoken word starts within 0.3 s. No logo sting, no intro card.

## Picture
- The hero appears in at least 70 % of the stills, always on model (the concept's hero_lock and cast.json; the hero_lock is added to every image by the code, never repeated by hand).
- One idea per still. A visual change at least every 4 s (new still, slow zoom in or out alternating, new action).
- Backgrounds use the concept's palette (concept.json `palette`), never the hero's own colours.
- No text, letters, signs, logos, watermarks or real brand marks inside a generated image: captions are burned in by the code from the script.
- No real people, no real brand mascots, no copyrighted characters.

## Captions
- The script's exact words, timed by faster-whisper, 1–3 words at a time, large, lower third; no other text on screen.
- No hook text drawn in the image: the first caption carries the hook.
- Font and colours are set in code (workshop/story/make-short.mjs caption step), OFL-licensed only, with an outline or shadow for contrast.
- Safe zone (all three apps): keep captions out of the top 12 %, the bottom 20 % and the right-side 14 % button column.
- Any number spoken or shown comes from a tool result or a verified source (brand/studio.md §7).

## Sound
- The concept's narrator (one voice, concept.json `voice`), finished to −14 LUFS integrated, −1 dBTP true peak.
- Sound effects: synthesised or CC0 only, sparse (on scene changes and reveals), never the same effect twice in a row, at most one every 1.2 s.
- Music: none baked in by default. Only a licensed or self-made bed, ducked under the voice, if the owner asks for one.
- No silence over 0.6 s except a deliberate beat before a reveal.

## Ending
- The last still calls back to the hook frame (same pose, place or object) so the loop invites a rewatch.
- No end card, no "follow" graphic, no dead tail after the last word (≤0.5 s).

## Avoid
- Faces or outfit drifting between stills (the continuity check and the clarity check refuse it).
- Warping hands, melting props, a main object missing from its still: simplify the image description and redraw (the clarity check sets the video aside after one redraw).
- Jump zooms on every cut; camera moves only the slow zoom the code makes.
