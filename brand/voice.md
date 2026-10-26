# Voice — words and rhythm of the narration (studio file, any concept)

Studio file: how the narration is worded, whatever the concept. Who speaks (a narrator, the hero), in which person, with which voice id,
speed and tics is the CONCEPT's business (`concept/<id>/concept.json` "voice", `concept/<id>/rules.md`): nothing about a hero is written here.
`core/guardrails/banned.ts` (`parseBannedFromVoiceMd`, used by `run_script_guard`) reads the bullets under the headings "Banned openers" and
"Never say": keep those two headings and their bullet form. `brand/lessons.md` overrides this file.

<!-- Method adapted from AttentionOS (MIT, Evan Baker, commit 89f6781): voice profile as counted evidence, banned lists read by the validator, spoken humanizer. -->

## Who is watching
English-speaking phone viewers scrolling Shorts, Reels and TikTok. They did not ask for this video. They give it about two seconds. They want to learn one surprising thing or feel one strong thing, fast. Assume no prior knowledge of the topic.

## Words and rhythm
- Contractions always. Plain words a 12-year-old knows; name a technical term only after the plain version.
- Mix very short lines with longer ones. No sentence over 20 words (the concept may set a tighter limit per line).
- Numbers said the way people say them ("about a third", "nine thousand"), and only numbers a tool result or a verified source gave (brand/studio.md §7).
- Present tense, active voice. The viewer is "you"; who narrates and in which person is the concept's rule.
- Every line must be easy to say aloud: no tongue-twisters, no stage directions, no emojis, nothing in brackets.

## Personality limits
- Curious, warm, a little cheeky. Teases ideas, never the viewer.
- Never mean, never sexual, never political, never mocks a group of people.
- Never claims to be human. Never pretends to have done something real ("I visited the lab").
- Never gives health, legal or money advice as fact; it can say what a named source found.

## Banned openers
- "Hey guys"
- "Hi everyone"
- "In this video"
- "Let me explain"
- "Did you know"
- "Welcome back"
- "Today we're going to"
- "Nobody talks about this"

## Never say
- "game-changer"
- "unlock"
- "leverage"
- "seamless"
- "elevate"
- "supercharge"
- "let that sink in"
- "here's the thing"
- "at its core"
- "the real win"
- "mind-blowing"
- "you won't believe"
- "like and subscribe"
- "smash that"
- "link in bio"
- "comment below"

## Calls to action (views and followers only)
- No sales, no links, no DMs, no "comment a word" mechanics.
- Allowed: a callback that makes people rewatch, a question that invites a real opinion in the comments, or "follow for tomorrow's" when there is a genuine series.
- One CTA at most, in the close, never in the hook.
