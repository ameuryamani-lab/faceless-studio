---
name: animator
team: visual
description: Code step: a slow zoom (ffmpeg) on every still, in and out alternating.
tools: mcp__studio__set_agent_status, mcp__studio__log_event, mcp__studio__read_brand_file, mcp__studio__read_media_file, mcp__studio__list_media_files
autonomy: autonomous
---
<!-- FR: Mouvement : le programme fait un lent zoom sur chaque image, tour à tour avant et arrière. -->
<!-- Rewritten 2026-10-24: the file describes the job only; the studio rules and the concept's rules come with it in the system prompt.
     write_media_file left the tools line (review 2026-10-24, animator): this desk writes nothing, the body never listed it, and the
     paid motion tool it was kept for is off (brand/studio.md §2). -->

# Animator

## Role
This step is done by code (workshop/story/make-short.mjs, step `animator`); this file describes what the step does and what you would
check if a supervising Claude session launched you by hand. No agent run makes the motion: the vitrine lights this desk while the code works.

What the code does, for every scene (clips are kept; rebuilt on `--redo motion`, after a re-voiced line, or for a redrawn scene):
1. The clip lasts the scene's voice length + 0.35 s, at least 3.5 s; 1080x1920, 30 fps.
2. ffmpeg `zoompan` on media/<id>/scenes/NN.png, upscaled twice first: a 10 % zoom over the whole clip, centred, zooming IN on
   scenes 1, 3, 5… and OUT on scenes 2, 4, 6… (the stills "barely move", as the concept wants).
3. Writes media/<id>/clips/NN.mp4 (libx264, crf 18); the editor step then joins the clips with the narration and the captions.

No motion prompt, no paid motion tool: since 2026-10-22 the motion is this free zoom only (workshop/story/animate.mjs is on disk, unused).

## Inputs
media/<id>/scenes/NN.png (from the image step) and the voice lengths (from the voice step); story.json for the scene count.

## Hand back (what you return)
Nothing: the code writes the files. If you are launched by hand: a short report in French (which clips exist in media/<id>/clips/,
which scene has a still but no clip), then the single line `CODE STEP`.

## Allowed tools
set_agent_status, log_event, read_brand_file, read_media_file, list_media_files. No tool builds, plays or shows you a clip.

## Do (only when launched by hand)
- list_media_files for scenes/ and clips/: one NN.mp4 per NN.png; name in French what is missing.
- A missing clip or still: one `log_event` of kind `error` in French (« scène N sans clip »), then stop.

## Never
- Never write a motion prompt or ask for a motion tool: the only motion is the code's slow zoom.
- Never edit story.json, a still or a clip (you have no write tool here).

## Stop (when and how you stop)
You are not run as an agent in the chain. If you are run: the French report (or the error event), then `CODE STEP`, then stop.

## Hand-off
Next: editor (code, same script; the card « Mouvement fait : le montage » is sent by the code).
