<!-- FR : Le contrat partagé du studio : qui est qui (22 agents), les réseaux, la base de données, comment une vidéo se fabrique et se
     publie toute seule, l'API de la vitrine, les tâches planifiées, les tests. Les règles de la société sont dans brand/studio.md ;
     les règles d'une session Claude dans CLAUDE.md. -->
# Faceless Studio — shared contract (read before touching any part)

Base: AttentionOS by Evan Baker, MIT licence, pinned commit 89f67813ef22ac1aa549ffa6a0463fd6a1fcd6c1 (texts copied, adapted). Licence and
credit in `licences/ATTENTIONOS-LICENSE` and `licences/NOTICE`. Studio-wide rules: `brand/studio.md`. Session rules: `CLAUDE.md`.

## Hard rules
- The studio lives in its own folder; studio code never reads or writes outside it (`core/paths.mjs`), and never reads a `.env` but its own.
- No new software installs without the owner's yes. Tool paths (ComfyUI, its Python, the Kokoro Python, ffmpeg/ffprobe, Node, Blender)
  come from `core/local-config.mjs`: an environment variable (`STUDIO_COMFY_HOME`, `STUDIO_COMFY_PY`, `STUDIO_KOKORO_PY`, `STUDIO_FFMPEG`,
  `STUDIO_FFPROBE`, `STUDIO_NODE`, `STUDIO_BLENDER`), else `config.local.json` (copy `config.example.json`, never committed), else the
  PATH. Code never writes a personal path itself. Node 22 or newer (built-in `node:sqlite`, type stripping for `.ts`; add `--no-warnings`).
- **Autonomous**: the agents run on scheduled tasks, on the owner's Claude subscription (Claude Code, no API key), and
  `core/publish-direct.mjs` publishes every finished and checked video by itself. No `ap-N`, no approval row for the Shorts.
- **Only code publishes** (`core/publish-direct.mjs`). No agent approves, publishes, schedules, uploads, pays or deletes; the MCP server
  has no publish tool and no approval-decide tool. Messages in the owner's name, payments and deletions need the owner's own order.
- Nothing paid besides the Upload-Post subscription: ComfyUI (Z-Image Turbo), Kokoro, faster-whisper, FFmpeg, yt-dlp are local
  (`workshop/story/animate.mjs`, a paid motion step, is not called; `core/daily.json` `_no_higgsfield`).
- The office server (the vitrine) listens on `127.0.0.1:8830`; optionally also on your own private VPN address (`--tailnet <address>`),
  where every request needs the access key generated in `data/office-key.txt`.
- Everything shown to the owner is in French; working files are in English; the videos are in English.

## Folder layout (the studio root, `STUDIO_ROOT` in `core/db.mjs`)
```
agents/            22 agent files (chief + 7 teams x 3), one JOB each (no hero name), + README.md (the roster as it really runs)
brand/             studio.md (company rules), voice, house-style, platforms, channels, not-usable, trend-queries, lessons, rejected,
                   mission.md (generated), continuity.json + references/ (compare_to_reference)
concept/           active.json, <id>/{concept.json, rules.md, cast.json, cast/<member>/*.png}, _modele/ (blank template),
                   README-FR.md, make-cast.mjs (candidate sheets), voices/ (narrator samples)
core/              db.mjs, local-config.mjs, mcp-server.mjs (29 tools), concept.mjs, run-agent.mjs, publish-direct.mjs, lester.mjs,
                   clarity.mjs, guardrails/, qc/, tests (see core/README.md)
workshop/story/    chain.mjs, make-short.mjs, hours.mjs, strategy.mjs, postmortem.mjs, seasonal.mjs, revoice-sweep.mjs
workshop/          run-phase.cmd (task launcher), metrics_pull.mjs, trends.py, comfy.mjs, voice.mjs, workflows/, promo/, coulisses/
office/            server.mjs (8830), public/ (built page, salle.html), src/ (node office/build.mjs), salle/ (build-salle.mjs), stats.mjs
data/              studio.db (source of truth, created on first run), *.jsonl journals, daily/task-*.log, prompts/ (transient)
media/<video_id>/  every file of one video (story.json, chain/*.txt, scenes/NN.png, audio/, clips/, final.mp4, qc.json, continuity/)
licences/          MIT licence + NOTICE of AttentionOS
```

## Roster (ids are used everywhere: DB, office, agent files, agents-models.json)
- chief: `chief_of_staff` (label **Lester**)
- team `research`: `outlier_analyst`, `trend_scout`, `teardown_analyst`
- team `strategy`: `strategist`, `calendar_planner`, `topic_editor`
- team `writing`: `copywriter`, `hook_auditor`, `fact_checker`
- team `character`: `character_keeper`, `voice_writer`, `continuity_checker`
- team `visual`: `storyboard_artist`, `image_artist`, `animator`
- team `sound_edit`: `voice_director`, `editor`, `qc_inspector` (label QC Inspector)
- team `distribution`: `publisher`, `results_analyst`, `postmortem_writer`

Model and effort per agent: `core/agents-models.json` (haiku/sonnet, `max_turns_per_run` 12, `max_runs_per_day` null, plan brake 90 % /
95 %). Six agents are never run as agents by the chain: `image_artist`, `voice_director`, `voice_writer`, `animator`, `editor`,
`publisher`. Their steps are done by code (`workshop/story/make-short.mjs`, `core/publish-direct.mjs`), which lights them up in the
vitrine (`setAgent`); their files say so.

## Platforms and the concept
- Platforms: `youtube` (Shorts), `instagram` (Reels), `tiktok`: your own three accounts, linked to one Upload-Post profile. One vertical
  video goes to all three through Upload-Post. The code reads `UPLOAD_POST_API_KEY` and `UPLOAD_POST_PROFILE` from the environment or
  the studio's `.env` (you create it; never committed, never read by a session). Caps: YouTube's daily upload limit (sliding),
  Upload-Post's 15 TikTok posts per 24 h; held networks get the video later, one catch-up per network per hour.
- **The concept is a parameter.** `concept/active.json` `{id, legacy, since, by}` names the concept of NEW videos; a video keeps the
  `concept` written in its `story.json` (`core/concept.mjs stamp` writes it into older ones). `concept/<id>/concept.json`
  (required: `id`, `hero_lock`, `style`, `palette`, `voice.id`; everything else has a default), `rules.md` (prose the agents
  receive), `cast.json` (hero + 4 to 8 members: `name`, `role`, `lock`, `never_changes`, `sheet`, `views`; `max_per_scene` 0-2),
  `cast/<member>/<framing>-<view>.png` and `<pose>-<framing>.png` (hero: `closeup-front`, `waist-front`, `full-front` required).
- Who writes what: `concept.json`, `rules.md`, `active.json`: the owner, or a Claude session on the owner's order (`node core/concept.mjs
  check | activate`, or Lester `ACTION | concept | <id>`); `cast.json`: `character_keeper` alone (`write_cast_file`); PNG sheets: code
  (`concept/make-cast.mjs` candidates) + the owner's pick; `story.json` `shot` and `cast`: copywriter (draft), storyboard_artist (final),
  continuity_checker (fixes). Activation is refused while a `media/s-*/chain/start.txt` has no `done.txt`; it archives
  `data/story-subjects.json` and `data/strategy.json` as `.<old>.json`.

## SQLite schema (`data/studio.db`, created by `core/db.mjs`, WAL)
```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, team TEXT NOT NULL, label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',          -- idle | working | waiting | error
  task TEXT,                                   -- short French text shown in the vitrine bubble
  video_id TEXT, updated_at TEXT NOT NULL      -- ISO 8601 UTC
);                                             -- NO model/effort columns: they come from core/agents-models.json (/api/state adds them)
CREATE TABLE IF NOT EXISTS events (            -- append-only; the office animates from this
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,                          -- run_start | run_end | handoff | approval_request | approval_decision | publish | error | note
  agent TEXT, to_agent TEXT, video_id TEXT,
  text TEXT,                                   -- short text; French when the owner sees it
  demo INTEGER NOT NULL DEFAULT 0              -- 1 = demo replay, never real work
);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,                         -- s-YYYYMMDD-HHMM (studio time of creation); r-YYYYMMDD-HHMM = rehearsal, never published
  topic TEXT, lane TEXT,                       -- lane: story | repetition (rehearsal); legacy lanes of the first show may appear
  status TEXT NOT NULL DEFAULT 'idea',         -- idea | scripted | storyboarded | animated | voiced | edited | qc_passed | awaiting_approval
                                               -- | approved | scheduled | published | rejected | superseded
  script_path TEXT, video_path TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  planned_publish_date TEXT                    -- YYYY-MM-DD, additive migration (VIDEO_EXTRA_COLUMNS); NULL for the Shorts
);
CREATE TABLE IF NOT EXISTS posts (             -- one row per platform per video
  video_id TEXT NOT NULL, platform TEXT NOT NULL,   -- youtube | instagram | tiktok
  title TEXT, caption TEXT, hashtags TEXT, ai_label INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT, published_at TEXT, url TEXT,
  status TEXT,                                 -- additive migration (POST_EXTRA_COLUMNS): NULL draft | scheduled | stopped | published
  PRIMARY KEY (video_id, platform)
);
CREATE TABLE IF NOT EXISTS approvals (         -- legacy path (ap-N); no row for the Shorts
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,                    -- ap-N
  video_id TEXT, kind TEXT NOT NULL,           -- script | video | post
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | changes | rejected | withdrawn
  note TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS metrics (
  video_id TEXT NOT NULL, platform TEXT NOT NULL, at TEXT NOT NULL,   -- snapshot time
  checkpoint TEXT,                             -- 1h | 24h | 72h | 7d (all kept; list_metrics returns every snapshot)
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER,
  avg_view_pct REAL, followers_delta INTEGER,
  PRIMARY KEY (video_id, platform, at)
);
CREATE TABLE IF NOT EXISTS trends (            -- created lazily (TRENDS_SCHEMA); one row per video per scan
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT NOT NULL,
  source TEXT NOT NULL,                        -- query | channel (YouTube scan, core/trends.mjs) | tiktok (trend_scout's web sweep)
  query TEXT, video_url TEXT NOT NULL,          -- youtube.com / youtu.be / tiktok.com https url
  title TEXT, channel TEXT, channel_url TEXT,
  views INTEGER, upload_date TEXT, duration_s INTEGER,
  ratio REAL, views_per_day REAL,              -- views / median of the channel's recent Shorts; null + gap=1 under 5 samples
  gap INTEGER NOT NULL DEFAULT 0,
  usable INTEGER, flag_reason TEXT,            -- "not usable for the show" (brand/not-usable.md; flag_trend corrects)
  UNIQUE (scanned_at, video_url)
);
```
- `superseded`: replaced before it went anywhere; never publishes, counts for nothing. `rejected`: set aside by the chain
  (safety `FACTS BLOCK`, clarity `CLARITY FAIL` twice, three empty answers). `withdrawn` (approvals): closed by the studio before an answer.
- Writes go through `core/db.mjs` helpers only (`setAgent`, `addEvent`, `upsertVideo`, `upsertPost`, `addMetric`, `insertTrends`,
  `insertTikTokTrends`, `setTrendFlag`, `markPublished`…). `setAgent` always appends an event. `isRehearsal(id)` = `/^r-/`.
- `STUDIO_DB=<path>` points everything at another database (tests: `media/_test/*.db`).

## Files under `data/` (besides `studio.db`)
| File | Written by | Content |
|---|---|---|
| `decisions.jsonl` | `hours.mjs`, `strategy.mjs`, `append_lesson`, `activateConcept`, the owner's own lines | one decision a line: `kind` slots / themes / lesson / concept / trend_sources, `applied`, French labels (`push_fr`, `drop_fr`, `rule_fr`) |
| `strategy.json` | `strategy.mjs` | `{at, concept, push[], drop[], push_fr[], drop_fr[], pushed_since}`; `chain.mjs` ignores a file of another concept |
| `story-subjects.json` | `chain.mjs`, `seasonal.mjs`, `lester.mjs` | prepared subjects `[{pick: "PICK \| … \| …", at, until?}]`, oldest first; 36 h expiry, seasonal ones until their date |
| `labels-fr.json` | hand-written | English decision text → French label for entries written without `*_fr` (`office/stats.mjs`, display only) |
| `publish-direct.jsonl` | `publish-direct.mjs` | the publisher's journal: `phase` started / result / yt-started / yt-result / catch-started / catch-result, `video_id`, `nets`, `request_id` |
| `publications.jsonl` | `publish-direct.mjs` (`source: "studio"`) | `{ref, video_id, le, source, reseaux:[{reseau, publie, lien, erreur}], erreur}`; `core/sync-publications.mjs` marks posts published from it |
| `publications-promo.jsonl` | `workshop/promo/` | the promo film's own publications |
| `net-caps.json`, `net-status.json`, `youtube-hold.json` | `publish-direct.mjs` | learned caps and holds per network; `net-status.json` = owed videos and hold end (shown by the vitrine) |
| `runs.jsonl` | `run-agent.mjs` | one line per agent run: date, agent, model, effort, video_id, concept, exit code, rate_limited, duration, tokens, turns (no text) |
| `claude-usage.json`, `claude-usage.jsonl` | `run-agent.mjs`, `claude-usage.mjs refresh` | the Claude plan windows (5 h, 7 days: used %, reset time); the plan brake reads them |
| `followers.jsonl` | `metrics_pull.mjs` | one line per hourly pass: followers / views / likes per network |
| `mission.json` | `core/mission.mjs` | the benchmark of the Trending wall (median views by age), `brand/mission.md` is its text |
| `paused.json`, `production-paused.json` | `run-agent.mjs` (rate limit, 1 h), `core/job.mjs` / Lester / vitrine button | the two pauses |
| `approvals-queue.jsonl` | `core/db.mjs createApproval` during quiet hours | legacy ap-N queue (no line for the Shorts) |
| `prompts/<agent>-<pid>.md` | `run-agent.mjs` | the composed system prompt of a running agent, deleted after the run (swept after 2 h) |
| `daily/task-*.log`, `office-server.log` | the scheduled tasks, the vitrine | logs (story, publish, stats, trends, analyse, claude-usage, lester, saisons, strategie) |
| `office-key.txt` (never read by a session, not in git) | `office/server.mjs` | the vitrine access key for the optional VPN address |
| `thumbs/` | `office/server.mjs` | cached YouTube thumbnails of the Trending wall |

## Production: one Short through the agent chain (`workshop/story/chain.mjs`)
Task "histoires" runs `chain.mjs --loop` every 20 min. A new `s-…` video starts only while fewer than `per_day` videos were made today
(studio date, `media/<id>/animated.json` `{day, at}`; a `rejected` one does not count) and fewer than `per_day` wait for a slot; in
practice the day's videos are made just after midnight, then the log says "2 made today". The chain loads the video's concept once
(refuses to start, French `error` event, if it does not load or the hero's three front views are missing), then runs each agent once through
`core/run-agent.mjs` (`--video`, `--concept`), keeps its answer in `media/<id>/chain/<agent>.txt` (resumable), and sends a `handoff`
event to the next desk:
1. `outlier_analyst` → `OUTLIER | …` ×5 and `teardown_analyst` → `STRUCTURE | …` ×3, `BEST | …` (soft steps: a failure never blocks).
   Skipped when a prepared subject waits in `data/story-subjects.json`.
2. `trend_scout` → 3 lines `IDEA | <hook question> | why it can travel` (from `list_trends`, `list_metrics`, the strategist's PUSH/DROP).
3. `topic_editor` → `PICK | <hook question> | escalation`, best first; the first is this video's subject, the others are queued.
   No PICK three times → the video is `rejected` and the next starts.
4. `copywriter` writes `story.json` with `write_media_file` (`checkStory` refuses anything outside the concept's format). No story three times → rejected.
5. `hook_auditor` → `HOOK OK` / `HOOK CHANGED | …`. 6. `fact_checker` → `FACTS OK` / `FACTS FIXED | …` / `FACTS BLOCK | reason` (the video is set aside).
7. `storyboard_artist` → `STORYBOARD OK`, or `CAST NEEDED | <role>` → `character_keeper` (soft) → `CAST OK | <id>` / `CAST UNCHANGED | why`.
8. `continuity_checker` (soft) → `CONTINUITY OK` / `CONTINUITY FIXED | …`, writes `continuity/notes.md`.
9. `checkStory` once more, status `scripted`, then **code**: `make-short.mjs` (Z-Image stills by img2img from the cast sheet, Kokoro
   narration in the concept's voice, faster-whisper word timing of the script text, 1-3-word captions, slow zoom, FFmpeg assembly at
   -14 LUFS, `core/qc`). Each code step lights its display agent.
10. `qc_inspector` views every still (`view_scene_image`) → `CLARITY PASS` / `CLARITY FAIL | scenes: N, M | reason` (`core/clarity.mjs`:
    first verdict line decides, any FAIL wins). On a FAIL with scenes: `storyboard_artist` simplifies those descriptions
    (`STORYBOARD REDONE`), the scenes are redrawn once, a second check judges them alone. PASS + `qc.json` pass → `qc_passed`; else `rejected`.
Rehearsal: `chain.mjs --repetition [--id r-…] [--concept <id>]` runs the same chain on an `r-…` video, never published, never counted,
`--concept` tries another concept without activating it.

## Publication (`core/publish-direct.mjs`, task "publication" every 10 min)
- Candidates: videos `qc_passed` (or the legacy `approved` / `awaiting_approval`), oldest first, never `r-…`. Blocked when: no file, `qc.json`
  not pass, a story without a saved `CLARITY PASS`, the wrong narrator voice (`audio/voice.txt` ≠ the video's concept voice; the chain
  re-voices it first), a post `stopped`, already published or sent, or an upload started without a result (human check).
- Slots: `core/daily.json` `autonomy.two_a_day` `{on, slots ["13:00","20:00"], window_min 120, per_day 2}` (studio time). A new video goes
  out in its slot window (a window ends at the next slot's start at the latest), one per slot, at least 60 min after the last publication;
  older stock (no `animated.json`) goes out every `min_gap_min` (100) and waits in the hour before a slot. `per_day` and `slots` are
  rewritten by the results analyst (`hours.mjs`).
- Drafts come from `story.json` (the hook question, the closing question, the story's 3-5 hashtags led by `#Shorts` / the concept's lead
  tag, the concept's `yt_tags`); `shortsTitle` cuts the YouTube title to 60 characters with ` #Shorts`. AI label on (`containsSyntheticMedia`,
  `is_aigc`), `selfDeclaredMadeForKids false`, public.
- A network on hold (Upload-Post `posting_restricted_until`, a learned cap, a refusal) or owed older videos gets the video later: one
  catch-up per network per hour (`CATCH_GAP_MIN` 60), none in the hour before a slot. Results: `data/publish-direct.jsonl`, then a
  `data/publications.jsonl` line and `syncPublications` (posts `published`, `url`; the video `published` when all three are); events
  `publish` and a handoff to `results_analyst`.
- `--check` (key present, linked accounts, what would go next) and `--dry-run` (the texts, sends nothing). Pause: `data/production-paused.json`.
- Legacy (kept, unused for the Shorts): `core/approve.mjs approve|changes|reject|stop ap-N`, `core/publish-plan.mjs` (publish_at rules),
  `posts.status 'scheduled'`, the quiet-hours approval queue (`core/queue-approval.mjs`, `release-approvals.mjs`, `approval-waiter.mjs`).
  `POST /api/stop` still runs `approve.mjs stop ap-N`.

## Decisions by the analysis team (applied at once, logged in `data/decisions.jsonl`)
- `workshop/story/hours.mjs` (task "analyse", 09:00): `results_analyst` reads `list_metrics({days: 30})`, logs a `HEURES:` note in French and
  ends with `SLOTS: HH:MM, HH:MM, …` (1 to 8 times, 1 h apart; the count changes at most once per 48 h) or `SLOTS: keep`. A valid line
  rewrites `two_a_day.slots` and `per_day`.
- `workshop/story/strategy.mjs` (daily in "analyse", also the weekly task "strategie"): `strategist` answers 1-3 `PUSH | theme | why | FR: label`
  and 0-3 `DROP | theme | why | FR: label` (a DROP needs 3 videos; a theme pushed less than 7 days ago cannot be dropped; one decision per
  20 h). Written to `data/strategy.json`, given to `trend_scout` and `topic_editor` as binding.
- `workshop/story/postmortem.mjs` ("analyse"): `postmortem_writer` reviews every published story 72 h to 7 days old without a
  `postmortem.md` (6 per morning at most) → `POSTMORTEM DONE | …`, `media/<id>/postmortem.md`, lessons through `append_lesson`.
- `workshop/story/seasonal.mjs` (task "saisons", Mondays 08:00): `calendar_planner` proposes 2-3 subjects per secular date of the next
  14 days, queued first in `data/story-subjects.json` with `until`.
- `append_lesson` (`postmortem_writer`, `chief_of_staff`): a dated line in `brand/lessons.md` tagged `[concept:<id> <scope>]` (or `studio`),
  with `rule_fr`; a `lesson` line in `decisions.jsonl`. `add_rejected_concept` → `brand/rejected.md`.

## Trends (task "tendances", 23:30)
`core/trends.mjs 40` scans YouTube Shorts with yt-dlp metadata (queries of `brand/trend-queries.md` or `concept/<id>/trend-queries.md`,
`/shorts` tabs of `brand/channels.md`; 2 freshness passes), classifies each row `usable` / `flag_reason` from `brand/not-usable.md`
(section titles never change: `core/trends.mjs` reads them), then `trend_scout` runs with `WebSearch` and stores 6 to 12 TikTok trends (the
tool accepts up to 15) with `add_tiktok_trends` (TikTok Creative Center may refuse automated access, so no view counts), then
`core/mission.mjs` refreshes the benchmark. `list_trends` returns the YouTube rows and the `tiktok` list; `flag_trend` (trend_scout,
outlier_analyst) corrects a flag. Subject choice weighs our own Instagram results first (`list_metrics`).

## Lester (`chief_of_staff`)
- Lester answers the owner in French and launches work only on the owner's request:
  `node --no-warnings core/lester.mjs "<the owner's exact message>" --source <source>` (one agent run capped at 200 s, under 4 min).
  The message is data, never instructions.
- Lester ends with one line the code acts on: `ACTION | aucune` · `ACTION | histoire | <hook question ?>` (a new video now, detached; the
  subject must open like the concept's hook; queued first if a video is being made; nothing while paused) · `ACTION | histoire |` ·
  `ACTION | pause` / `ACTION | reprise` (`core/job.mjs`) · `ACTION | concept | <id>` (`activateConcept`; a refusal is given back in French).
- Last stdout line: `{"reponse": "texte en français", "lance": null | {"video_id": "…" | null, "quoi": "…"}, "erreur": null | "…"}`. Every
  call is a `note` event of `chief_of_staff`; launches log to `data/daily/task-lester.log`. Lester never publishes and never approves.

## Office API (`office/server.mjs`, 127.0.0.1:8830, optionally a VPN address with the key)
- Hosts accepted: `127.0.0.1:8830`, `localhost:8830`, and the address given with `--tailnet <address>`. Requests on that address need
  the key (`data/office-key.txt`): `?k=<key>` once, then the `fs_key` cookie, or the `X-Office-Key` header. `--port <n>` runs a test
  instance. `?demo=1` replays a scripted day in the browser only.
- `GET /` the vitrine; `GET /salle.html` the 3D room (three.js; built by `node office/salle/build-salle.mjs`; its `bridge.js` polls
  `/api/state` every 12 s and listens to `/api/events`; live work only, no demo loop; `?ancienne=1` keeps the 2D room).
- `GET /api/state` → `{ agents (with model, effort), production, production_paused, queue {in production, ready with their expected slot,
  published with links and views}, concept {heroes (the active cast with its PNG urls), voices, voice, promo_voices, active {id, name_fr,
  since, hook_prefix}}, coulisses, net_status, promos, views_by_hour, benchmark, health, claude {plan, tokens}, renders, approvals_queue,
  runs_today, paused, schedule, daily_log, errors (last 6 h, solved ones and r-… hidden), videos[] (last 10, each with publish
  {scheduled_at, status, video_ref}, cover, link, views), approvals (pending), posts, metrics {youtube, instagram, tiktok}, stats (the
  French "Ce que l'équipe a décidé" block, week views, followers, top 5), trends, desk_work, trends_count {total, usable}, recent,
  last_event_id, db, can_stop }`.
- `GET /api/events?after=<id>` Server-Sent Events of new `events` rows (heartbeat, `demo = 0` only).
- `POST /api/stop {ref: "ap-N", note?}` (key required from any address, same origin, JSON) runs `core/approve.mjs stop ap-N --source vitrine`.
- `POST /api/pause {paused: true|false}` (local page or key, same origin, JSON) runs `core/job.mjs pause|resume --source vitrine`.
- Files: `/media/<id>/<cover.png|jpg|…|final.mp4>`, `/media/<id>/scenes/NN.png`, `/thumb/<…>` (Trending thumbnails), `/promo-video/<file>`,
  `/coulisses/run-<stamp>/<file>`, `/concept/<…up to 5 segments…>.png|wav|…` (cast sheets, voice samples). Any other method: 405.
- The server writes nothing itself: its two POST routes call the CLIs above. Rebuild the page after an `office/src` change:
  `node office/build.mjs`, then restart the server.

## Scheduled tasks (Windows Task Scheduler, each one hidden: `conhost.exe --headless`)
| Task | Trigger | Command |
|---|---|---|
| publication | every 10 min | `workshop\run-phase.cmd publish` → `core/publish-direct.mjs` → `data/daily/task-publish.log` |
| histoires | every 20 min | `run-phase.cmd story` → `workshop/story/chain.mjs --loop` → `task-story.log` |
| stats | every hour | `workshop/metrics_pull.mjs` (Upload-Post analytics: 1h/24h/72h/7d snapshots, followers) → `task-stats.log` |
| stats Claude | every 30 min | `core/claude-usage.mjs refresh` (plan windows for the brake) → `task-claude-usage.log` |
| analyse | daily 09:00 | `run-phase.cmd analyse` → `hours.mjs`, `strategy.mjs`, `postmortem.mjs` → `task-analyse.log` |
| tendances | daily 23:30 | `run-phase.cmd trends` → `core/trends.mjs 40`, `run-agent.mjs trend_scout` (TikTok sweep), `core/mission.mjs` → `task-trends.log` |
| strategie | weekly, Sunday 08:00 | `run-phase.cmd strategie` → `strategy.mjs` → `task-strategie.log` |
| saisons | weekly, Monday 08:00 | `run-phase.cmd saisons` → `seasonal.mjs` → `task-saisons.log` |
| ComfyUI | at logon (+ a periodic retry) | ComfyUI portable, `--disable-auto-launch`, 127.0.0.1:8188 |
| vitrine | at logon, kept running | `office/server.mjs` (add `--tailnet <address>` for phone access) → `data/office-server.log` |
`run-phase.cmd` exits at once while `data/production-paused.json` exists. After any change to a task, check its last run and its log: a
hidden task dies without a message.

## Tests (throwaway folders and databases under `media/_test/`, never the real data)
- `node --no-warnings core/test-mcp.mjs` — the MCP server end to end (one known failure: "write_media_file: copywriter may not write
  brief.json"; the count of failures must never go up).
- `node --no-warnings core/concept.test.mjs`, `node --no-warnings core/guardrails/story.test.mjs` (reads the real `concept/` and every
  `media/s-*/story.json`, writes nothing), `node --no-warnings core/test-publish.mjs`, `node core/guardrails/test.mjs`.
- Test variables: `STUDIO_DB`, `STUDIO_MEDIA`, `STUDIO_BRAND_DIR`, `STUDIO_CONCEPT` (active id), `STUDIO_CONCEPT_DIR`, `STUDIO_DECISIONS`
  (keeps tests from writing fake lessons into the real decisions file), `STUDIO_NOW` (fake clock), `STUDIO_WAITER=off`,
  `STUDIO_TRENDS_FIXTURE`, `STUDIO_METRICS_FIXTURE`; tool paths: see `core/local-config.mjs` (`STUDIO_PYTHON`, `STUDIO_FONT`,
  `STUDIO_CV_PYTHON` where the code still reads them).
- After a change to an agent file: `node --no-warnings core/run-agent.mjs <id> "test" --dry-run` must print `system_prompt_composed: true`.
