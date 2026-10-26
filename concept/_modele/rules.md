<!-- FR : Règles de VOTRE émission, reçues par chaque agent (composées par core/run-agent.mjs après brand/studio.md). Modèle vierge :
     Claude Code le copie en concept/<id>/rules.md pendant le premier lancement (CLAUDE.md, « First run ») et remplace chaque <…>
     par vos réponses. Tant qu'un <…> reste ici, l'activation est refusée. Les règles de la société (brand/studio.md) passent avant. -->
# <name your show> — concept rules

These rules are the show's. The studio rules (`brand/studio.md`) come first and are never repeated or lifted here. Precedence:
studio > concept > agent file > task. Working language of this file: English.

## 1. The show in one paragraph
<describe the show: what kind of stories, for which adult audience, the feeling a viewer should leave with, and what makes it different>

## 2. The hero
- Who: <describe your hero in plain words: first name, adult age, personality in three words>
- Look: the `hero_lock` of `concept.json` is added to every image by the code; never describe the hero's clothes differently.
- The hero's look never changes from video to video: no costume, uniform, change of clothes or body transformation.
- What the hero never does: <list what your hero never does or says>

## 3. Hook and title
- Every title: <describe the hook format, e.g. a question that starts with the hook words of concept.json, or a free opening>
- The title is the first spoken line (scene 1), at most `format.title_max_chars` characters.
- Good examples (invented, never a real video): <write two or three example titles in your format>

## 4. Story shape
- <describe the shape of one story: the situation in scene 1, how it escalates, where the twist comes, how it ends>
- Counts: `format.scenes`, `format.words`, `format.max_words_per_line`, `format.seconds` in `concept.json` (checked by code).
- Narration: `format.person`; one narrator voice (`concept.json` "voice"), never another one.
- The last still calls back to the hook frame so the loop invites a rewatch.

## 5. Drawing
- Style and palette: `concept.json` "style" and "palette" (added by the code; never repeated in a scene's image text).
- Shot of each scene: `shot = { framing, view, pose }` with framing closeup | waist | full, view front | three-quarter | profile |
  back, pose standing | sitting | walking | hands-out. Scene 1 framing `prompt.scene1_framing`; at most `prompt.max_full_body` full shots.
- One action, one place, ONE common object drawn large next to the hero per scene; never a crowd, a vehicle in motion or many small things.
- `place` (the still WITHOUT the hero): what fills the frame behind the hero up to the top, never the hero's name, never "empty".
- Never in an image description: text, letters, logo, caption, subtitle, "words on", "key prop" (name the object itself).
- Hands: `prompt.hands`. <write any extra drawing rule of your show, or delete this line>

## 6. Casting
- The cast is `cast.json` (only `character_keeper` writes it). At most `max_per_scene` secondary character(s) per scene; extras only
  as a blurred background group.
- Secondary characters wanted: <describe the kind of secondary characters your show needs, e.g. a neighbour, a colleague, or none>

## 7. Safety (on top of brand/studio.md §8)
- Adult characters only, drawn as adults.
- <list the topics your show never touches beyond the studio rules, or write: nothing more than the studio rules>

## 8. Subjects and trends
- A trend becomes a story about its idea, never its footage, sound, people or brand (studio rule §8b).
- Subjects that suit the show: <list the kinds of everyday situations your show is about>
- Subjects to avoid: <list the subjects that do not fit your show>

## 9. Publishing
- Platforms: <list the platforms you publish on: youtube, instagram, tiktok>
- Posting times: the slots of `core/daily.json` (studio time zone of `config.local.json` "timezone"); hashtags of `concept.json`.
