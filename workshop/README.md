# workshop — where the Shorts are made

Everything here runs on your own PC: ComfyUI for the drawings, Kokoro for the narrator, faster-whisper for the caption timing,
ffmpeg for the edit, Upload-Post for publication (through `core/publish-direct.mjs`). Tool paths come from `core/local-config.mjs`
(environment variables `STUDIO_*`, else `config.local.json`, else the PATH); no file here holds a personal path.

## The chain (`story/`)
```
node --no-warnings workshop/story/chain.mjs                     # one narrated Short through every agent, in order
node --no-warnings workshop/story/chain.mjs --loop              # chain after chain until the stock is full (task "histoires")
node --no-warnings workshop/story/chain.mjs --repetition        # a rehearsal "r-…": the whole chain, never published
node --no-warnings workshop/story/make-short.mjs <story.json> [--redo images,voice,words,motion] [--scenes 3,10]
```
- `chain.mjs` runs each agent once through `core/run-agent.mjs` (trend_scout → topic_editor → copywriter → hook_auditor →
  fact_checker → storyboard_artist → continuity_checker → make-short → qc_inspector clarity check), so the vitrine shows the work
  passing from desk to desk.
- `make-short.mjs` turns one `story.json` into `media/<id>/final.mp4` (1080x1920): Z-Image Turbo stills from the hero's cast sheet
  (`sheet_scene.py` keeps the hero pixel for pixel and paints the place around it), Kokoro narration (`voice/kokoro_say.py`),
  script-word captions timed by faster-whisper (`words.py`), a slow Ken Burns zoom per still, loudness -14 LUFS, then `core/qc`.
  Each step is skipped when its files exist (resumable). It starts ComfyUI hidden when it is down.
- `hours.mjs` (publication hours and volume), `strategy.mjs` (themes to push or drop), `postmortem.mjs` (72 h review),
  `seasonal.mjs`, `revoice-sweep.mjs` / `revoice.cmd` (re-voice finished stories): the analysis team; every decision applies at
  once and is logged in `data/decisions.jsonl`.
- `animate.mjs`: optional paid motion (Higgsfield CLI, `HIGGSFIELD_BIN`); off by default (`DAY_CREDITS_MAX = 0`).

## Scheduled tasks (`run-phase.cmd`)
`workshop\run-phase.cmd trends | publish | analyse | revoix | saisons | strategie | story` is what the Windows tasks call (see
`CONTRAT.md`). Output: `data\daily\task-<phase>.log`. Nothing runs while `data\production-paused.json` exists. The `.cmd` files use
`node` from the PATH unless `STUDIO_NODE` names another one (`STUDIO_BLENDER`, `STUDIO_FFMPEG` likewise for the promo scripts).

## ComfyUI
- `comfy.mjs` talks to `http://127.0.0.1:8188` only (`COMFY_URL` overrides). ComfyUI portable lives in `STUDIO_COMFY_HOME` /
  `comfy_home`.
- Workflows (API format, nodes found by `_meta.title`): `workflows/zimage-keyframe.json`, `workflows/zimage-img2img.json`
  (stills), `workflows/wan22-i2v-4step.json` (optional Wan 2.2 clips, `clipGraph`).
- Models (Z-Image Turbo, its text encoder and VAE) go in ComfyUI's own `models/` folders, or in a folder named by ComfyUI's
  `extra_model_paths.yaml`.

## Voice and captions
- Narrator: Kokoro-82M through kokoro-onnx (`voice/kokoro_say.py`), run with `KOKORO_PY`. Model files `kokoro-v1.0.onnx` and
  `voices-v1.0.bin` in `STUDIO_KOKORO_MODELS`, else `kokoro_models` in `config.local.json`, else `models/kokoro/`.
- Captions: `node workshop/transcribe.mjs <audio-or-video> [--out words.json]` → word timestamps (faster-whisper, offline once the
  `medium` model is cached, CPU int8). Its Python: `STUDIO_WHISPER_PY`, else `whisper_python` in `config.local.json`, else `python`.

## Research data (read-only on the network, nothing downloaded)
- **Trends**: `node --no-warnings core/trends.mjs [max_results]` (or the MCP tool `scan_trends`). `trends.py` searches the queries
  of `brand/trend-queries.md` with YouTube's "Shorts, this month" filter, reads the `/shorts` tab of each channel in
  `brand/channels.md` and of the candidates' channels (cap 20), then full metadata for at most 30 candidates. `ratio` = views ÷
  median views of that channel's recent Shorts; `views_per_day` = views ÷ max(1, days since upload).
- **Our metrics**: `node --no-warnings workshop/metrics_pull.mjs [--dry-run] [--publications <studio file>]`. Reads the publisher's
  journal, `posts` rows with a url and `data/publications.jsonl`, writes the checkpoint due (1h / 24h / 72h / 7d) with `addMetric`.
  Upload-Post analytics first (same key as publication); yt-dlp as the fallback, only for videos on your own accounts:
  `STUDIO_YOUTUBE_HANDLE` / `STUDIO_TIKTOK_HANDLE` (or `youtube_handle` / `tiktok_handle` in `config.local.json`).
  `STUDIO_METRICS_FIXTURE=<file>` replays fetch results (tests).

## Films about the studio (optional)
- `coulisses/record.mjs` (`coulisses/run.cmd`): films the vitrine in a hidden headless Edge (`STUDIO_EDGE` overrides its path)
  while one chain runs; writes `media/coulisses/<run>/`. Never published.
- `promo/`: the promo film. `film.mjs` films one real video being made, `edit.mjs` cuts it, `promo_comp.py` (Blender) composes it,
  `voice_cb.py` / `pick_takes.py` / `music.py` make the narration and music, `mux.mjs` the final MP4 (`final.cmd <film_dir>
  <cover.jpg> <out_base>`). `publish-promo.mjs` / `publish-promo.cmd <video.mp4> <networks> "<caption>"` publishes it once, only on
  your own order. `render.mjs` + `promo3d.py` are an older, simpler promo.
- `blender/`: the 3D room and robots of the vitrine (`room_v2.py`, `robots.py`; `room.py` is v1). Rebuild only if you change them.

## Tests
`node --no-warnings workshop/test-schedule.mjs`: quiet hours, the approval queue and its waiter, on throwaway databases in
`media/_test` (no Claude call, no render).
