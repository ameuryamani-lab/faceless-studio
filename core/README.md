<!-- FR : Le cœur du studio : base de données, serveur d'outils MCP (29 outils), concept, lancement d'un agent, publication, Lester,
     garde-fous, contrôle qualité, tests. -->
# core — data, MCP tools, concept, agents, publication, guardrails, QC

Node 22.23 or later (built-in `node:sqlite`, `.ts` via type stripping), on the PATH or set in `config.local.json`. Tool paths (ComfyUI, Kokoro, ffmpeg, Node, Blender) come from
`core/local-config.mjs` (environment, then `config.local.json`, then defaults). Add `--no-warnings` to hide the SQLite
"experimental" notice. The shared contract (schema, roster, API, tasks) is `CONTRAT.md`; the company rules are `brand/studio.md`.

## Database (`db.mjs`)
- `data/studio.db`, WAL mode, schema exactly as in `CONTRAT.md` (`SCHEMA` + additive migrations `videos.planned_publish_date`,
  `posts.status`, the lazy `trends` table with `usable` / `flag_reason`). Created and seeded (22 agents, state `idle`, label Lester for
  `chief_of_staff`) on first open.
- Write only through the helpers: `setAgent` (always appends an event: working → `run_start`, idle → `run_end`, error → `error`, waiting →
  `note`), `addEvent`, `upsertVideo`, `upsertPost`, `addMetric`, `insertTrends`, `insertTikTokTrends`, `setTrendFlag`, `markPublished`,
  `listRecentVideos`, `listMetricCheckpoints`, `createApproval` / `decideApproval` (legacy ap-N path). `checkVideoId` accepts
  `^[a-z0-9][a-z0-9-]{1,63}$`; `isRehearsal(id)` = `/^r-/`. Constants: `VIDEO_STATUSES` (with `rejected`, `superseded`), `APPROVAL_STATUSES`
  (with `withdrawn`), `TREND_SOURCES` `query | channel | tiktok`, `CHECKPOINTS` `1h | 24h | 72h | 7d`, `PLATFORMS`.
- `STUDIO_DB=<path>` points everything at another DB (tests use `media/_test/*.db`); the quiet-hours sidecars follow it.

## Concept (`concept.mjs`, 2026-10-24: the concept is a parameter)
- `activeConceptId()` (`STUDIO_CONCEPT` else `concept/active.json` `id`), `legacyConceptId()`, `loadConcept(id)` (concept.json + cast.json
  merged over `DEFAULTS` = today's values, validated, frozen, cached; one French error listing every faulty field; looks in `concept/<id>/`,
  `concept/_archive/<id>/`, `concept/_exemples/<id>/`), `conceptIdOf(videoId)` / `conceptOf(videoId)` (the video's `story.json` "concept",
  else legacy; null without story.json), `titlePattern(c)` / `pickPattern(c)` (hook_regex, else `^<hook_prefix>\b`, else `/./`),
  `castViews`, `castSheet(c, member, shot)` (declared view → `<pose>-<framing>.png` → `<framing>-<view>.png` → `<framing>-front.png` → null =
  text-to-image), `castLock`, `checkCast(parsed, c)` (English, for `write_cast_file`),
  `missingHeroViews`, `chainsInProgress`, `activateConcept(id, by)` (check, refused while a `media/s-*` chain runs, archives
  `data/story-subjects.json` and `data/strategy.json`, writes `active.json`, a `decisions.jsonl` line, a note event, `brand/mission.md`),
  `stampStories()`.
- CLI: `node --no-warnings core/concept.mjs check [id] | activate <id> | stamp [--dry-run] | show [id]` (French output).
- Env: `STUDIO_CONCEPT` (active id), `STUDIO_CONCEPT_DIR` (concept root, default `concept/`), `STUDIO_MEDIA`, `STUDIO_DECISIONS`.
- Readers: `run-agent.mjs` (system prompt), `workshop/story/chain.mjs`, `make-short.mjs`, `publish-direct.mjs`, `guardrails/story.mjs`,
  `mcp-server.mjs`, `lester.mjs`, `mission.mjs`, `office/server.mjs`, `seasonal.mjs`, `strategy.mjs`.

## Running one agent (`run-agent.mjs`)
`node --no-warnings core/run-agent.mjs <agent_id> "<task>" [--video <id>] [--concept <id>] [--dry-run]` runs Claude Code once on your own
Claude subscription (`ANTHROPIC_API_KEY` removed from the child env). `loadAgent` reads the `tools:` line of `agents/<id>.md` (only
`mcp__studio__*`, plus `WebSearch` for `trend_scout`) → `--allowedTools`; every native tool is disallowed. The system prompt is composed:
`agents/<id>.md` + `brand/studio.md` + `concept/<id>/rules.md` → `data/prompts/<agent>-<pid>.md`, `--append-system-prompt-file`, deleted
after the run (stale ones swept after 2 h); on a composition failure the agent file alone is sent and a French `error` event is logged.
Model and effort from `agents-models.json` (`--fallback-model haiku`, `--max-turns 12`), `--permission-mode dontAsk`, `--setting-sources ""`,
`--strict-mcp-config --mcp-config core/mcp.json`, `--output-format stream-json --verbose`. Guards: `data/paused.json` (1 h after a rate
limit), the plan brake (`claude-usage.mjs`, 90 % of 5 h or 95 % of the week), `max_runs_per_day` (null today). Each run → `data/runs.jsonl`
(agent, model, effort, video, concept, code, duration, tokens, turns; no text) and `setAgent` working → idle/error with the task's first
sentence as the vitrine bubble. `--dry-run` prints the command as JSON (`system_prompt_composed`) and writes nothing.

## MCP server (`mcp-server.mjs`, config in `mcp.json`)
stdio JSON-RPC 2.0, protocol `2025-06-18`, no SDK. **29 tools**: `get_state, list_recent_videos, list_metrics, set_agent_status, log_event,
read_brand_file, append_lesson, add_rejected_concept, create_video, update_video, save_script, run_script_guard, request_approval,
list_pending_approvals, save_post_draft, record_metrics, write_storyboard, queue_render_job, scan_trends, list_trends, add_tiktok_trends,
flag_trend, read_media_file, write_media_file, compare_to_reference, list_media_files, view_scene_image, view_contact_sheet, write_cast_file`.
An agent may call only the tools of its `tools:` line (prefixed `mcp__studio__`); the server also enforces its own grants:
- `write_cast_file` — **character_keeper only**: writes the ACTIVE concept's `cast.json` (whole file as text; `prepareContent` + `checkCast`:
  ids `^[a-z][a-z0-9-]{2,30}$`, lock 20-300 characters without text / letters / logo, the hero entry unchanged, 4 to 8 members, one first name
  each, `max_per_scene` 0-2; atomic write; a `note` event; the concept cache is cleared). The first agent write outside `media/<id>/`.
- `view_scene_image` (one still, `media/<id>/scenes/NN.png` reduced to 540 px, with the scene's text and image description) and
  `view_contact_sheet` (all stills in one picture) — **qc_inspector, continuity_checker, character_keeper only** (`VIEWERS`); previews made by
  ffmpeg under `media/<id>/scenes/.apercu/`, returned as image content.
- `list_metrics({days})` (read-only, default 14, max 90): per video and network ALL snapshots by checkpoint (`snapshots: {"1h", "24h", "72h",
  "7d"}` with views, likes, comments, shares, measured_at) plus `latest`, the title, `first_published_at` and `first_published_at_network`
  (from `data/publish-direct.jsonl`), and the latest followers per network (`data/followers.jsonl`).
- `read_brand_file`: `brand/` files (`.md .txt .yaml .json`), or with the prefix `concept/` the ACTIVE concept's folder (`concept/rules.md`,
  `concept/cast.json`, `concept/concept.json`; `.md .txt .json` only). `""` lists `brand/`, `"concept"` lists the concept folder.
- `append_lesson` (rule, `rule_fr`, evidence, scope, source): a dated line in `brand/lessons.md` tagged `[concept:<active> <scope>]` (or
  `studio`), duplicates skipped, a `note` event, a `lesson` line in `data/decisions.jsonl` (applied at once since 2026-10-23).
- `add_tiktok_trends` — trend_scout only (up to 15 rows: kind hashtag|sound|format, name, why, source_site, seen_date, tiktok.com url).
  `flag_trend` — trend_scout and outlier_analyst. `scan_trends` / `list_trends` — `trends.mjs` (yt-dlp metadata through
  `workshop/trends.py`; `STUDIO_TRENDS_FIXTURE` replays a scan in tests); `list_trends` also returns the `tiktok` list and backfills flags.
- `compare_to_reference` — continuity_checker only: `continuity.mjs` runs `workshop/continuity.py` (ComfyUI's python, `-I`, CPU) against
  the hero's front reference (`brand/continuity.json` "reference", default `brand/references/hero-front.png`, not shipped) with
  `brand/continuity.json` thresholds; verdict in `media/<id>/continuity/<file>.json`. Optional; no agent file lists it.
- `read_media_file` / `write_media_file` / `list_media_files` — `media-files.mjs`, scope `media/<video_id>/` only (no `..`, absolute path,
  drive letter, `:`, `.env`, reserved name or link escape); `WRITE_ALLOWLIST` per agent (copywriter, hook_auditor, voice_writer, fact_checker:
  `script.json`, `story.json`; storyboard_artist, character_keeper: `storyboard.json`, `story.json`; continuity_checker: `continuity/`,
  `story.json`; topic_editor `brief.json`; voice_director `sound/cues.json`; editor `edit/`; qc_inspector `qc-notes.md`; postmortem_writer
  `postmortem.md`; animator `story.json`); render outputs never overwritten. `story.json` is checked by `guardrails/story.mjs checkStory`
  against ITS concept (the saved text's `concept`, else the video's, else the active one); `storyboard.json` by `storyboard.mjs`;
  `script.json` by the playbook rules. `STUDIO_MEDIA=<folder>` moves the media root (tests).
- No publish tool, no approval-decide tool: agents cannot set `approved / scheduled / published`. `request_approval` and
  `list_pending_approvals` remain for the legacy ap-N path (unused for the Shorts since 2026-10-21). `queue_render_job` only appends to
  `data/render-queue.jsonl`. Paths resolve inside the studio folder only, anything containing `.env` refused (`paths.mjs`).
- Event texts written by the tools are in French (the vitrine shows them). Use it from Claude Code: `claude --mcp-config core/mcp.json`.

## Clarity verdict (`clarity.mjs`, 2026-10-24)
`parseClarity(text)` reads qc_inspector's answer in one strict way: the first line starting with `CLARITY PASS` or `CLARITY FAIL` decides,
and any `CLARITY FAIL` line wins. `clarityPassed(id)` reads `media/<id>/chain/qc_inspector.txt`. Used by `workshop/story/chain.mjs` (status
`qc_passed` only on a PASS), `make-short.mjs` (a re-render keeps `qc_passed` only on a saved PASS) and `publish-direct.mjs` (a story never
goes out without a saved PASS).

## Publication (`publish-direct.mjs`, since 2026-10-21) and its legacy
`node --no-warnings core/publish-direct.mjs [--check | --dry-run]`: one pass publishes at most one video through Upload-Post (details,
slots, holds and catch-ups in `CONTRAT.md`). Exports `candidates()`, `wrongVoice()`, `storyTags()`, `buildForm()`, `slotNow()`,
`publishNext()`, `readEnv()` (`UPLOAD_POST_API_KEY` and `UPLOAD_POST_PROFILE` from the environment or the studio's `.env`, which you
create; the key is never printed). `sync-publications.mjs` marks posts
published from `data/publications.jsonl`. Legacy, kept and tested but unused for the Shorts: `approve.mjs` (`list | approve | changes |
reject | stop ap-N [--source …]`, the owner's CLI; `stop` is what `POST /api/stop` runs), `publish-plan.mjs` (publish_at rule, neutral drafts),
`queue-approval.mjs`, `release-approvals.mjs`, `approval-waiter.mjs` and the quiet hours of `schedule.mjs` (`STUDIO_NOW` fakes the clock,
`STUDIO_WAITER=off` stops tests from launching a waiter).

## Lester, pause, mission, usage
- `lester.mjs`: `node --no-warnings core/lester.mjs "<message>" --source phone|assistant` runs `chief_of_staff` once (200 s cap), reads
  the last `ACTION | …` line (`aucune`, `histoire | <hook question>`, `pause`, `reprise`, `concept | <id>`) and acts; last stdout line is
  the JSON `{reponse, lance, erreur}`. Never publishes, never approves.
- `job.mjs`: `start | end | note <agent> "<text>"` (lights the vitrine for a job run by hand), `pause | resume [--source thread|vitrine]`
  (`data/production-paused.json`, read by `run-phase.cmd`, `chain.mjs`, `publish-direct.mjs`).
- `mission.mjs`: writes `brand/mission.md` (goal, "Active concept: <id>", benchmark of the Trending wall) and `data/mission.json`.
- `claude-usage.mjs`: `parseStream` (Claude Code stream-json → result + plan windows), `readPlan` / `savePlan` (`data/claude-usage.json`,
  `.jsonl`), `refresh` (task "stats Claude", one tiny Haiku call). Percentages and reset times only, never a credential.

## Guardrails (`guardrails/`)
- `story.mjs` — `checkStory(story, concept)`: the narrated format under its concept (title = the hook question, `title_max_chars` 52 ending
  with `?`, scenes and words within `format.scenes` / `format.words`, `max_words_per_line`, one hero_lock / palette / style copied from
  concept.json, forbidden words in an image (text, letters, logo, caption…), 3-5 clean hashtags, `concept` equal to the video's, `shot`
  {framing, view, pose} from the lists, scene 1 framing, at most `max_full_body` full scenes, `cast` ids from cast.json with at most
  `max_per_scene`, a member's first name in an image only with its id; no bait tag nor one of the concept's own hashtags, which the code
  adds). Tested by `story.test.mjs`.
- The TypeScript guards ported from AttentionOS (MIT, credit in each file): spoken-only, punctuation, banned openers/phrases (parsed from
  `brand/voice.md`), 6-beat structure, claim ledger and fake stats, numbers, CTA, captions per platform, no 4+ copied words, publish payload
  (legacy: needs an approved `ap-N` and the AI label), playbook rules. `schema.ts` replaces zod. Used by `save_script`, `run_script_guard`,
  `save_post_draft`, `write_media_file` (`script.json`). Test: `node core/guardrails/test.mjs`.

## QC (`qc/qc.mjs`)
`node core/qc/qc.mjs <video.mp4> [--json-out report.json]` → JSON, exit 0 pass / 2 fail. Checks 1080x1920, 30 fps, 5-60 s, -14 ±1 LUFS, true
peak ≤ -1 dBTP, black segments ≥ 0.5 s, frozen segments ≥ 2 s, black first frame. Thresholds in `QC_RULES`; exports `FFMPEG`, `FFPROBE`,
`qc`, `run` (used by `make-short.mjs` and the image previews of the MCP server).

## Tests (all in throwaway folders under `media/_test/`)
```
node --no-warnings core/test-mcp.mjs              end-to-end MCP server test (compare_to_reference needs ComfyUI's python and ffmpeg)
node --no-warnings core/concept.test.mjs          (STUDIO_CONCEPT_DIR, STUDIO_MEDIA, STUDIO_DB, STUDIO_DECISIONS of its own)
node --no-warnings core/guardrails/story.test.mjs (an invented in-memory concept; read-only on media/s-*/story.json: the stock regression)
node --no-warnings core/test-publish.mjs          (standing order, drafts, hashtags, yt_tags, wrongVoice; an invented in-memory concept)
node core/guardrails/test.mjs
node --no-warnings core/metrics-list.test.mjs
node --no-warnings core/place-prompt.test.mjs
node --no-warnings core/run-agent.mjs <id> "test" --dry-run   must print system_prompt_composed: true (after any agent-file change)
```
`test-mcp.mjs` uses `STUDIO_DB`, `STUDIO_MEDIA`, `STUDIO_BRAND_DIR`, `STUDIO_CONCEPT_DIR`, `STUDIO_DECISIONS`, `STUDIO_TRENDS_FIXTURE`,
`STUDIO_WAITER=off`: the real `brand/`, `concept/`, `data/decisions.jsonl` and `data/studio.db` are never touched.
