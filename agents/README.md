# Faceless Studio — the agents, as they really run

<!-- FR : carte réelle de l'équipe : qui tourne vraiment, lancé par quoi, avec quels outils, quelles lignes de réponse le code lit.
     Écrit pour la session Claude qui fait tourner le studio ; les agents ne reçoivent pas ce fichier. -->

22 agent files (`agents/<id>.md`, ids of `CONTRAT.md` and the `agents` table): Lester (chief_of_staff) and 7 teams of 3. A file
describes a JOB, never a hero: the show (hero, hook format, narrator voice, drawing style, framing, cast, hashtags) is the **concept**,
`concept/<id>/` (active one: `concept/active.json`; none is shipped: the owner's first run builds it from `concept/_modele/`). The studio is autonomous: no approval
(`ap-N`), nothing waits for the owner, only code publishes (`brand/studio.md` §3, §6).

## 1. What an agent receives (core/run-agent.mjs)
`node --no-warnings core/run-agent.mjs <id> "<task>" [--video <id>] [--concept <id>] [--dry-run]` runs ONE agent once through Claude Code
on the owner's Claude subscription (model and effort: `core/agents-models.json`; `ANTHROPIC_API_KEY` removed from the child env).
- **Composed system prompt** = `agents/<id>.md` + `brand/studio.md` (company rules, never change) + `concept/<id>/rules.md` (the show's
  rules), joined by `---`, written to `data/prompts/<id>-<pid>.md` for the run and deleted after. Precedence: studio > concept > agent
  file > task. The concept is `--concept`, else the video's (`story.json` "concept", legacy for an old one), else the active one. If the
  composition fails (file missing, concept invalid) the agent file goes alone and a French `error` event is logged: a prompt problem never
  stops a chain.
- **The task** (`-p "Concept: <id>\nVideo: <id>\nTask: …"`) carries one video's data and the exact answer line the code parses (§4).
- **Tools**: the `tools:` line of the file, read by `loadAgent`; only `mcp__studio__*` names are accepted (`WebSearch` too, for
  trend_scout alone). Every native tool (Bash, Read, Write, Edit, Glob, Grep, WebFetch, Task, Agent…) is disallowed;
  `--strict-mcp-config core/mcp.json`; `--max-turns 12`; `--permission-mode dontAsk`; `--setting-sources ""`.
- **Brakes**: `data/production-paused.json` (the owner's pause), the plan brake (5-hour window at 90 %, week at 95 %), a rate limit pauses
  the agents 1 h (`data/paused.json`). Usage goes to `data/runs.jsonl` (no prompt or reply text).
- `--dry-run` prints the composed prompt file, its size and `system_prompt_composed: true`, and runs nothing. Check every file with it.

## 2. Shape of an agent file
Frontmatter `name / team / description / tools: (the exact list) / autonomy: autonomous`, a `<!-- FR: … -->` one-line French summary
(the vitrine shows it), then **Role, Inputs, Hand back** (the exact output lines the code parses), **Allowed tools, Do, Never** (the
job's own, nothing common), **Stop** (when and how, including the French `error` event when blocked), **Hand-off**. No "The show" block
and no common Never list: both live in `brand/studio.md` and the concept's `rules.md`. Everything written for the owner (`log_event` notes,
`set_agent_status` texts, qc-notes.md, `rule_fr`, `FR:` labels) is French; the answer lines stay in the English form the code expects.

## 3. The real chain of one Short (workshop/story/chain.mjs → make-short.mjs)
Launched by the scheduled task "histoires" (`workshop/run-phase.cmd story` → `chain.mjs --loop`, every 20 min, chain after chain
while the stock is not full), or by Lester (`ACTION | histoire`). Each answer is kept in `media/<id>/chain/<agent>.txt` (resumable);
"soft" = a failure never stops the chain. A rehearsal (`--repetition`, id `r-…`, optional `--concept`) runs everything and is never published.
```
[queue data/story-subjects.json empty?]  outlier_analyst (soft) → teardown_analyst (soft) → trend_scout → topic_editor
→ copywriter (story.json) → hook_auditor → fact_checker (FACTS BLOCK stops the video)
→ storyboard_artist [→ character_keeper, soft, on CAST NEEDED] → continuity_checker (soft)
→ checkStory (core/guardrails/story.mjs) → make-short.mjs = CODE: image_artist, voice_director, voice_writer, animator, editor, core/qc
→ qc_inspector views every still [FAIL → storyboard_artist redo + redraw once → qc_inspector second check]
→ status qc_passed (or rejected, French error event) → core/publish-direct.mjs (task "publication", every 10 min) at the slots.
```
Grep the real tasks: `grep -n "step(id, '<id>'\|softStep(id, '<id>'" workshop/story/chain.mjs`.

## 4. Who is launched by what, and the answer line the code reads
| id | team | job today | launched by | answer the code parses |
|---|---|---|---|---|
| `chief_of_staff` (Lester) | chief | answers the owner in French when they talk to him, launches work on their word | `core/lester.mjs` only, when the owner's message reaches it (`--source <source>`); never automatic | last line `ACTION \| aucune` / `ACTION \| histoire \| <hook question>` / `ACTION \| pause` / `ACTION \| reprise` / `ACTION \| concept \| <id>` |
| `outlier_analyst` | research | which trending Shorts beat their channel, what a story could borrow | chain.mjs softStep, only when the subject queue is empty | `OUTLIER \| title \| why it works \| what we borrow` ×5 (data for trend_scout) |
| `teardown_analyst` | research | structure of the 3 most-viewed trends | chain.mjs softStep, same condition | `STRUCTURE \| hook \| escalation \| payoff` ×3, `BEST \| …` |
| `trend_scout` | research | 3 story ideas from trends + our Instagram results; evening TikTok sweep | chain.mjs step (queue empty); `run-phase.cmd trends` (task "tendances", 23:30, WebSearch → `add_tiktok_trends`) | `IDEA \| <hook question> \| why it can travel` ×3 (`concept.json format.idea_line`) |
| `topic_editor` | strategy | ranks the ideas, drops the undrawable or too-close ones | chain.mjs step | `PICK \| <hook question> \| escalation` per kept idea (`format.pick_line`, `pickPattern`) |
| `copywriter` | writing | the narration and one still per line (story.json) | chain.mjs step | `story.json` saved with `write_media_file` (refused by `checkStory` otherwise) |
| `hook_auditor` | writing | scene 1 impossible to scroll past | chain.mjs step | `HOOK OK` / `HOOK CHANGED \| new line` |
| `fact_checker` | writing | studio and concept safety, no false fact | chain.mjs step | `FACTS OK` / `FACTS FIXED \| what` / `FACTS BLOCK \| reason` (video set aside) |
| `storyboard_artist` | visual | each image drawable as ONE still, shot and cast set | chain.mjs step; redo after a CLARITY FAIL | `STORYBOARD OK` / `CAST NEEDED \| <role>`; redo: `STORYBOARD REDONE` |
| `character_keeper` | character | keeper of the hero and the cast, sole author of `cast.json` | chain.mjs softStep on `CAST NEEDED`; by hand | `CAST OK \| <id>` / `CAST UNCHANGED \| why` (`write_cast_file`) |
| `continuity_checker` | character | hero, cast ids, places and light consistent across scenes | chain.mjs softStep, every video since 2026-10-22 | `CONTINUITY OK` / `CONTINUITY FIXED \| what` + `continuity/notes.md` |
| `qc_inspector` | sound_edit | clarity check on the REAL drawings (`view_scene_image`) | chain.mjs step, then a second check on redrawn scenes | first line `CLARITY PASS` / `CLARITY FAIL \| scenes: N, M \| reason` + `qc-notes.md` (French) |
| `results_analyst` | distribution | views by release hour; decides the number of videos a day and their hours | `workshop/story/hours.mjs` (task "analyse", daily 09:00) | `HEURES:` note (French, `log_event`); last line `SLOTS: HH:MM, …` / `SLOTS: keep` → `core/daily.json` |
| `strategist` | strategy | themes to push and drop from real results | `workshop/story/strategy.mjs` (task "analyse" daily, "strategie" Sunday 08:00) | `PUSH \| theme \| why (numbers) \| FR: label` ×1-3, `DROP \| …` ×0-3 → `data/strategy.json` |
| `calendar_planner` | strategy | subjects ahead of secular dates (next 14 days) | `workshop/story/seasonal.mjs` (task "saisons", Monday 08:00) | `PICK \| <hook question> \| escalation` ×3 per date → front of `data/story-subjects.json` |
| `postmortem_writer` | distribution | why a video worked, 72 h to 7 days after | `workshop/story/postmortem.mjs` (task "analyse"), per published video without `postmortem.md` | `POSTMORTEM DONE \| the change` + `postmortem.md` + at most one `append_lesson` (with `rule_fr`) |
| `image_artist` | visual | CODE step: the stills (Z-Image, ComfyUI, img2img from the cast sheet) | `make-short.mjs` lights it in the vitrine | none |
| `voice_director` | sound_edit | CODE step: the narrator (Kokoro, the video's concept voice) | `make-short.mjs` | none |
| `voice_writer` | character | CODE step: captions (script words timed by faster-whisper) | `make-short.mjs` | none |
| `animator` | visual | CODE step: slow zoom in / out on every still | `make-short.mjs` | none |
| `editor` | sound_edit | CODE step: concat, loudness −14 LUFS, burned captions, then `core/qc` | `make-short.mjs` | none |
| `publisher` | distribution | CODE: `core/publish-direct.mjs` (drafts, AI label, Upload-Post) | task "publication" | none |

**Six agents are code steps** (image_artist, voice_director, voice_writer, animator, editor in `workshop/story/make-short.mjs`;
publisher in `core/publish-direct.mjs`): no code launches them as agents. Their files say so honestly ("This step is done by code
(<file>); this file describes what the step does and what you would check if a supervising Claude session launched you by hand") and stay short.
They stay in the vitrine as desks. Model and effort per agent: `core/agents-models.json` (sonnet: Lester,
strategist, copywriter, hook_auditor, fact_checker, storyboard_artist, qc_inspector; haiku elsewhere).

## 5. Tools (29, core/mcp-server.mjs, all `mcp__studio__` in a `tools:` line)
| Area | Tools | Notes |
|---|---|---|
| State and events | `get_state`, `list_recent_videos`, `list_metrics`, `set_agent_status`, `log_event` | `log_event` kinds `note`, `error`, `handoff`; texts for the owner in French |
| Brand and concept | `read_brand_file`, `append_lesson`, `add_rejected_concept`, `write_cast_file` | `read_brand_file` reads `brand/*.md .txt .json` and, with the prefix `concept/`, the ACTIVE concept's folder (`concept/rules.md`, `concept/cast.json`, `concept/concept.json`); `append_lesson` tags `[concept:<active> <scope>]` (scope `studio` = any concept) and logs to `data/decisions.jsonl`; `write_cast_file` is character_keeper's alone |
| Media files | `read_media_file`, `write_media_file`, `list_media_files` | text files under `media/<video_id>/`, 256 KB at most; writes follow the allowlist (§6); `story.json` passes `checkStory` of the video's concept |
| Images | `view_scene_image`, `view_contact_sheet`, `compare_to_reference` | the real drawings (`media/<id>/scenes/NN.png`), for qc_inspector, continuity_checker, character_keeper; `compare_to_reference` uses `brand/continuity.json` + `brand/references/` |
| Trends | `scan_trends`, `list_trends`, `add_tiktok_trends`, `flag_trend` | `scan_trends` runs yt-dlp on `brand/trend-queries.md` + `brand/channels.md` and flags rows with `brand/not-usable.md`; `list_trends` returns the YouTube rows and a `tiktok` list; `flag_trend` for trend_scout and outlier_analyst |
| Videos | `create_video`, `update_video` | listed by no agent file today: the chain creates and updates the rows itself |
| Legacy of the first chain | `save_script`, `run_script_guard`, `write_storyboard`, `queue_render_job`, `request_approval`, `list_pending_approvals`, `save_post_draft`, `record_metrics` | kept by the server; only `save_post_draft` is still in a file (publisher); none is called by the story chain; the studio is autonomous, so nobody asks for an approval |

Per file today (beyond `set_agent_status`, `log_event`, `read_brand_file`, which every file has): writers (copywriter, hook_auditor,
fact_checker, storyboard_artist, continuity_checker) `read_media_file`, `list_media_files`, `write_media_file` (+ `view_scene_image`,
`view_contact_sheet` for continuity_checker, qc_inspector, character_keeper; + `write_cast_file` for character_keeper; + `get_state`
for copywriter); research: outlier_analyst `list_trends`, `flag_trend`, `scan_trends`; teardown_analyst `list_trends`; trend_scout
`list_trends`, `flag_trend`, `scan_trends`, `add_tiktok_trends`, `list_metrics`, `WebSearch`; strategy: topic_editor
`list_recent_videos`, `list_trends`, `list_metrics`; calendar_planner the same three; strategist `get_state`, `list_recent_videos`,
`list_metrics`; results_analyst the same; postmortem_writer `get_state`, media read/write, `append_lesson`, `list_metrics`; Lester
`get_state`, `append_lesson`, `add_rejected_concept`, media read, `list_metrics`, `list_recent_videos`, `list_trends`. The `tools:`
line of each file is the truth; this is a summary.

## 6. Write allowlist (core/media-files.mjs WRITE_ALLOWLIST, paths under media/<video_id>/)
topic_editor `brief.json`; copywriter, hook_auditor, voice_writer, fact_checker `script.json`, `story.json`; voice_director
`sound/cues.json`; storyboard_artist, character_keeper `storyboard.json`, `story.json`; editor `edit/`; qc_inspector `qc-notes.md`;
postmortem_writer `postmortem.md`; continuity_checker `continuity/`, `story.json`; animator `story.json` (kept for a future motion
field). Everyone else reads only. Render outputs (`keyframes/`, `clips/`, `render/`, `voice/`, `audio/`, `build/`, `final.*`, images,
video, audio) are never overwritten through MCP. `story.json` is checked by `core/guardrails/story.mjs` against the video's concept
(`format` counts, hook pattern, title 52 characters ending with "?", no text/letters/logo in an image, `shot` and `cast` values).

## 7. Casting (concept/<id>/cast.json)
The hero is in every scene. Secondary characters come only from `cast.json` (ids), at most `max_per_scene` per scene, named by id in
`scene.cast` and by first name in the image; never invented. Only character_keeper writes `cast.json` (`write_cast_file`, the whole file
again, checked by `checkCast`); the hero's entry never changes. storyboard_artist answers `CAST NEEDED | <role>` when a story needs a
missing role; the chain then runs character_keeper once (soft). `make-short.mjs` starts each still from the member's sheet that matches
the scene's shot (`cast/<member>/<framing>-<view>.png`, `castSheet`); continuity_checker and qc_inspector check the locks and
`never_changes`.

## 8. Brand and concept files
- `brand/` (the company, any concept): `studio.md` (rules every agent receives), `voice.md` (words; `Banned openers` and `Never say` are
  read by `parseBannedFromVoiceMd`), `house-style.md` (technical shape), `platforms.md`, `channels.md` and `trend-queries.md`
  (read by `core/trends.mjs`), `not-usable.md` (trend flags; section titles are read by code, never change), `lessons.md`
  (`append_lesson`, tagged per concept), `rejected.md` (`add_rejected_concept`), `mission.md` (generated by `core/mission.mjs`),
  `continuity.json` + `references/` (`compare_to_reference`).
- `concept/<id>/`: `concept.json` (read by code), `rules.md` (read by agents, in the composed prompt), `cast.json`, `cast/<member>/*.png`.
  `concept/README-FR.md` explains to the owner how to change concept; `concept/_modele/` is the blank template that documents the format.

## 9. Known gaps (for the session running the studio, not for the agents)
- `core/mcp-server.mjs` `INSTRUCTIONS` still tells every agent "Nothing goes public: request_approval and wait" (contradicts
  `brand/studio.md` §6).
- `continuity_checker.md` does not list `compare_to_reference` although the server grants it (`COMPARE_AGENTS`).
- `brand/rejected.md` is written by Lester, but no chain task sends the subject pickers to it yet.
- The old episode chain (`workshop/daily.mjs`, `daily-lib.mjs`, `pipeline.mjs`, `steps/`, `heros.mjs`) is not scheduled and still
  points at files of the first show that are not shipped; the story chain never uses it.

## Credit
Method and part of the structure are adapted from **AttentionOS** by Evan Baker, MIT licence, pinned commit
89f67813ef22ac1aa549ffa6a0463fd6a1fcd6c1 (texts paraphrased and adapted for an AI-drawn narrated channel). Full licence and notice:
`licences/ATTENTIONOS-LICENSE` and `licences/NOTICE`. Roles added for this studio (character_keeper, voice_writer, continuity_checker,
storyboard_artist, image_artist, animator, voice_director, qc_inspector, results_analyst) are Faceless Studio's own.
