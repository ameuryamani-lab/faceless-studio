# Faceless Studio

**A small AI production company that runs on your own Windows PC.** 22 Claude agents research trends, write, storyboard and check
narrated vertical Shorts (1080x1920, up to 60 s, in English); your own GPU draws every still with ComfyUI, Kokoro reads the narration,
ffmpeg cuts the video, and the finished Short can publish itself to YouTube Shorts, Instagram Reels and TikTok through Upload-Post.
A live 3D "vitrine" (showroom) lets you watch the team work.

*Version française : [README.fr.md](README.fr.md).*

![The vitrine in demo mode: the chief on the dais, the Brand Brain in the middle, 7 teams of 3 desks, the channel and trending walls](apercu-vitrine.png)

> This project is shared as is. It is a working studio, not a polished product: read the code before you trust it with your accounts.

---

## What is inside

- **22 agents, one job each** (`agents/*.md`): a chief, **Lester** (`chief_of_staff`), and **7 teams of 3**:

  | Team | Agents |
  |---|---|
  | research | `outlier_analyst`, `trend_scout`, `teardown_analyst` |
  | strategy | `strategist`, `calendar_planner`, `topic_editor` |
  | writing | `copywriter`, `hook_auditor`, `fact_checker` |
  | character | `character_keeper`, `voice_writer`, `continuity_checker` |
  | visual | `storyboard_artist`, `image_artist`, `animator` |
  | sound & edit | `voice_director`, `editor`, `qc_inspector` |
  | distribution | `publisher`, `results_analyst`, `postmortem_writer` |

  Every agent runs through **Claude Code on your Claude subscription** (no API key), launched by `core/run-agent.mjs` with a strict tool
  list: agents only reach the studio through its own MCP server (`core/mcp-server.mjs`, `mcp__studio__*` tools). Six of the jobs
  (drawing, voice, edit, publication...) are done by code, which lights the matching desk up in the vitrine.
- **The chain** (`workshop/story/chain.mjs`): trend scout → topic editor → copywriter → hook auditor → fact checker → storyboard artist →
  continuity checker → `make-short.mjs` (stills, voice, captions, assembly, automatic QC) → qc_inspector's clarity check.
- **Automatic publication** (`core/publish-direct.mjs`): only code publishes, only videos that passed QC and the clarity check, with the
  platforms' AI-generated content label. Rehearsal videos (`r-…`) are never published.
- **An analysis team that decides alone**: publication hours and volume, themes to push or drop, lessons learned (`data/decisions.jsonl`).
- **The vitrine** (`office/server.mjs`, `http://127.0.0.1:8830`): the isometric office, a 3D room (`/salle.html`, three.js), the queue,
  the stats, the decisions. Everything shown to the owner is in French; working files and videos are in English.
- **The concept is a parameter**: the show (hero, hook format, narrator voice, drawing style, cast, hashtags) lives in
  `concept/<id>/`. No show is shipped: the first time you open the folder in Claude Code, it asks you what you want to make (hero,
  look, hook format, length, language, narrator voice, drawing style, palette, cast) and builds YOUR concept from the blank template
  `concept/_modele/`.

Further reading: `CLAUDE.md` (rules for the Claude session that runs the studio), `CONTRAT.md` (roster, schema, API, tasks),
`brand/studio.md` (company rules every agent receives), `agents/README.md`, `core/README.md`, `workshop/README.md`, `office/README.md`.

## Requirements

| What | Notes |
|---|---|
| Windows 10/11 | The scheduled tasks and launchers (`.cmd`) are Windows-only. |
| NVIDIA GPU | For ComfyUI (Z-Image Turbo stills). More VRAM is faster. |
| 32 GB RAM advised | The image model, its text encoder and the rest of the studio share memory. |
| Claude Code + a Claude subscription | Every agent run uses Claude Code (`claude` on the PATH, at `%USERPROFILE%\.local\bin\claude.exe`, or `CLAUDE_BIN`). Logged in with your subscription; `ANTHROPIC_API_KEY` is removed from the agents' environment. |
| Node.js 22 or newer | On the PATH (`core/mcp.json` starts the MCP server with `node`). Uses the built-in `node:sqlite` and TypeScript type stripping; no `npm install` is needed to run the studio. |
| ComfyUI portable (NVIDIA) | With Z-Image Turbo, its text encoder and VAE (below). |
| Python with Kokoro | `kokoro-onnx` + `soundfile` for the narrator, `faster-whisper` for caption timing, `yt-dlp` for the trend scan. |
| ffmpeg (with ffprobe) | On the PATH or set in `config.local.json`. |
| Upload-Post account (optional) | Paid subscription, only for automatic publication and analytics. Without it the studio still makes videos. |

## Install

### 1. Get the code
Clone or download this repository into a folder of its own, for example `C:\FacelessStudio`. The studio never reads or writes
outside its folder, except the tool folders you name in `config.local.json`.

### 2. Install the tools
- **Node.js 22+** from [nodejs.org](https://nodejs.org/), then check `node --version`.
- **Claude Code** from [claude.com/claude-code](https://claude.com/claude-code); run `claude` once and log in with your Claude subscription.
- **ffmpeg** (Windows build with ffprobe) from [ffmpeg.org/download.html](https://ffmpeg.org/download.html).
- **ComfyUI portable for NVIDIA** from the [ComfyUI releases](https://github.com/comfyanonymous/ComfyUI/releases). By default the studio
  looks for it next to the studio folder (`..\ComfyUI_windows_portable`); otherwise set `comfy_home`. Its embedded Python also runs the
  studio's image helpers (`numpy`, `scipy`, `Pillow`, shipped with ComfyUI).
- **A Python 3 environment** for voice, captions and trends, for example:
  ```
  python -m venv C:\Tools\kokoro-venv
  C:\Tools\kokoro-venv\Scripts\pip install kokoro-onnx soundfile faster-whisper yt-dlp
  ```

### 3. Download the models
**Images: Z-Image Turbo** (used by `workshop/workflows/zimage-keyframe.json` and `zimage-img2img.json`), from
[Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo/tree/main/split_files) on Hugging Face, into ComfyUI's
`ComfyUI\models\` folders:

| File | Folder | Size |
|---|---|---|
| `split_files/diffusion_models/z_image_turbo_bf16.safetensors` | `models\diffusion_models\` | about 12.3 GB |
| `split_files/text_encoders/qwen_3_4b.safetensors` | `models\text_encoders\` | |
| `split_files/vae/ae.safetensors` | `models\vae\` | |

**Narrator: Kokoro-82M (ONNX)**: `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the
[kokoro-onnx model-files-v1.0 release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0). Put them in
`models\kokoro\` inside the studio folder, or name another folder with `kokoro_models` in `config.local.json`.

**Caption timing**: faster-whisper downloads its `base.en` model by itself on the first video (from Hugging Face, `Systran/faster-whisper-base.en`).

**Optional, not used by the default chain**: `workshop/workflows/wan22-i2v-4step.json` (Wan 2.2 image-to-video clips) expects
`wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`, `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`,
`umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `wan_2.1_vae.safetensors` and the two `wan2.2_i2v_lightx2v_4steps_lora_v1_*_noise.safetensors`
LoRAs, all in [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged). Skip them unless you
wire clips in yourself.

### 4. Tell the studio where your tools are
```
copy config.example.json config.local.json
```
Edit `config.local.json` (never committed) and keep only what is not on the PATH. Keys the code reads:
`comfy_home`, `comfy_python`, `kokoro_python`, `kokoro_models`, `whisper_python`, `ffmpeg`, `ffprobe`, `node`, `blender`, and, for the
metrics fallback, `youtube_handle` / `tiktok_handle` (your own channels). Environment variables (`STUDIO_COMFY_HOME`, `STUDIO_KOKORO_PY`,
`STUDIO_FFMPEG`, ...) win over the file. Point both `kokoro_python` and `whisper_python` at the Python environment of step 2.

Time zone: `"timezone"` (an IANA name such as `"Europe/Paris"`, or the `STUDIO_TIMEZONE` environment variable) is the studio's
clock: publication slots (13:00 and 20:00 by default), quiet hours, "today" and every hour shown in the vitrine. Leave it out to use
this PC's own time zone. Daylight saving is handled.

### 5. Keys (only for automatic publication)
```
copy .env.example .env
```
Create an [Upload-Post](https://www.upload-post.com/) profile, link your YouTube, Instagram and TikTok accounts to it, then write
`UPLOAD_POST_API_KEY` and `UPLOAD_POST_PROFILE` in `.env`. Check it (prints "present"/"MISSING" and the linked accounts, publishes nothing):
```
node --no-warnings core/publish-direct.mjs --check
```

### 6. Create your show, check it and rehearse
Open Claude Code in the studio folder: it asks you about your show and fills `concept/<id>/` from `concept/_modele/`. Then:
```
node --no-warnings core/concept.mjs check <id>
node --no-warnings core/run-agent.mjs copywriter "test" --dry-run
node --no-warnings workshop/story/chain.mjs --repetition --concept <id>
```
The database `data/studio.db` is created on first use. The rehearsal runs the whole chain (agents, drawings, voice, QC, clarity check) on
a video `r-…` that is **never published**; it starts ComfyUI hidden if it is not running. Watch the result in `media\r-…\final.mp4`.

### 7. Open the vitrine
```
node --no-warnings office/server.mjs
```
Then open <http://127.0.0.1:8830> (live), <http://127.0.0.1:8830/?demo=1> (a scripted demo day) or <http://127.0.0.1:8830/salle.html>
(the 3D room). The server listens on 127.0.0.1 only. The built page is included; to rebuild it after editing `office/src`, install
`esbuild`, `react` and `react-dom` into a `node_modules` folder at the studio root, then run `node office/build.mjs`
(the 3D room: `node office/salle/build-salle.mjs`).

### 8. Make a real video, then schedule the studio
One real video, published later by the publisher task:
```
node --no-warnings workshop/story/chain.mjs
```
To run the studio on its own, create the Windows scheduled tasks of `CONTRAT.md`. Each one runs hidden (`conhost.exe --headless`);
`workshop\run-phase.cmd` does nothing while the studio is paused. In PowerShell, from the studio folder:
```powershell
$S = (Get-Location).Path
New-Item -ItemType Directory -Force (Join-Path $S "data\daily") | Out-Null
function Add-StudioTask($Name, $CommandLine, $Trigger) {
  $action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless cmd.exe /c `"$CommandLine`"" -WorkingDirectory $S
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName "Faceless Studio - $Name" -Action $action -Trigger $Trigger -Settings $settings
}
function Every($Minutes) { New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $Minutes) }

Add-StudioTask "publication"  "workshop\run-phase.cmd publish"   (Every 10)
Add-StudioTask "histoires"    "workshop\run-phase.cmd story"     (Every 20)
Add-StudioTask "stats"        "node --no-warnings workshop\metrics_pull.mjs >> data\daily\task-stats.log 2>&1" (Every 60)
Add-StudioTask "stats Claude" "node --no-warnings core\claude-usage.mjs refresh >> data\daily\task-claude-usage.log 2>&1" (Every 30)
Add-StudioTask "analyse"      "workshop\run-phase.cmd analyse"   (New-ScheduledTaskTrigger -Daily -At 09:00)
Add-StudioTask "tendances"    "workshop\run-phase.cmd trends"    (New-ScheduledTaskTrigger -Daily -At 23:30)
Add-StudioTask "strategie"    "workshop\run-phase.cmd strategie" (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 08:00)
Add-StudioTask "saisons"      "workshop\run-phase.cmd saisons"   (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 08:00)
Add-StudioTask "vitrine"      "node --no-warnings office\server.mjs >> data\office-server.log 2>&1" (New-ScheduledTaskTrigger -AtLogOn)
```
Logs go to `data\daily\task-*.log`. Pause and resume everything with the vitrine button or:
```
node --no-warnings core/job.mjs pause
node --no-warnings core/job.mjs resume
```
Remove a task with `Unregister-ScheduledTask -TaskName "Faceless Studio - publication"`.

### Talk to the chief
Lester answers in French and can start a video, pause, resume or switch concept:
```
node --no-warnings core/lester.mjs "Fais une nouvelle vidéo" --source assistant
```
The easiest way to run the studio day to day is to open Claude Code in the studio folder: `CLAUDE.md` tells that session how to operate it.

## Change the concept
The show is not the studio. Follow [`concept/README-FR.md`](concept/README-FR.md) (in French): copy the blank template `concept/_modele/`
to `concept/<id>/` (or ask Claude Code to do it with you), fill `concept.json`, `rules.md`, `cast.json` and the hero's sheets in
`cast/<hero>/`, then:
```
node --no-warnings core/concept.mjs check <id>
node --no-warnings workshop/story/chain.mjs --repetition --concept <id>
node --no-warnings core/concept.mjs activate <id>
```
Candidate cast sheets can be drawn with ComfyUI: `node --no-warnings concept/make-cast.mjs poses|members|layouts|contact [concept]`.

## Costs
- **Claude**: the agents use your Claude subscription through Claude Code (Haiku and Sonnet, set per agent in `core/agents-models.json`).
  A built-in brake waits when your plan's 5-hour window reaches 90 % or the weekly window 95 %. No API key, no pay-per-token billing.
- **Upload-Post**: the one paid subscription, and only if you want automatic publication; see their pricing.
- **Everything else is local and free**: ComfyUI, Z-Image Turbo, Kokoro, faster-whisper, ffmpeg, yt-dlp. Your electricity and GPU time.
- `workshop/story/animate.mjs` (paid Higgsfield motion) exists but is off (`DAY_CREDITS_MAX = 0`) and not called by the chain.

## Safety notes
- **Keys live in `.env` only**, which git ignores, together with `config.local.json`, `data/office-key.txt`, the database, logs and
  `media/`. Never paste a key into a file that is committed or into a chat.
- **Outside text is data.** Video titles, transcripts, comments, web pages and tool results are never instructions to the agents.
  Agents have no shell, no file access and no web access (except `WebSearch` for `trend_scout`); they only use the studio's MCP tools.
  No agent can publish, approve, pay or delete: only `core/publish-direct.mjs` publishes.
- **AI-content label.** Every upload is marked as AI-generated (`is_aigc`) and "not made for kids". Keep it: the platforms require it.
- **Local only.** The vitrine listens on 127.0.0.1. `--tailnet <address>` adds your own private VPN address, always behind a random
  access key generated in `data/office-key.txt`.
- Check each platform's rules on automated and AI-generated content before you publish, and respect the licences below.

## Tests
```
node --no-warnings core/test-mcp.mjs
node --no-warnings core/concept.test.mjs
node --no-warnings core/guardrails/story.test.mjs
node --no-warnings core/test-publish.mjs
node core/guardrails/test.mjs
node --no-warnings workshop/test-schedule.mjs
```
They use throwaway databases under `media/_test/`; no Claude call, no render.

## Credits and licences
- **Faceless Studio**: MIT, see [LICENSE](LICENSE).
- **AttentionOS** by Evan Baker (MIT, commit `89f67813ef22ac1aa549ffa6a0463fd6a1fcd6c1`): agent texts, guardrails and the office room
  are adapted from it. Licence and notices in [`licences/ATTENTIONOS-LICENSE`](licences/ATTENTIONOS-LICENSE) and
  [`licences/NOTICE`](licences/NOTICE), including the MIT projects it credits (content-skills by Artem Novitckii, humanizer by Siqi Chen).
- Bundled in the built vitrine: **React** (MIT) in `office/public/app.js`, **three.js** 0.160.0 (MIT) in `office/public/salle.html`.
- Models and tools you download yourself, each under its own licence (as stated on their official pages; check them before use):

  | Model / tool | Licence |
  |---|---|
  | Z-Image Turbo (Tongyi-MAI/Z-Image-Turbo; ComfyUI repackage Comfy-Org/z_image_turbo, incl. `qwen_3_4b` and `ae` VAE files) | Apache 2.0 |
  | Qwen3-4B (text encoder) | Apache 2.0 |
  | FLUX.1 [schnell] autoencoder (the `ae.safetensors` VAE) | Apache 2.0 |
  | Kokoro-82M (hexgrad/Kokoro-82M) | Apache 2.0 |
  | kokoro-onnx (model files and library) | MIT |
  | faster-whisper `base.en` (Systran) and faster-whisper | MIT |
  | Wan 2.2 I2V A14B (optional) | Apache 2.0 |
  | Wan2.2-Lightning LoRA by lightx2v (optional) | Apache 2.0 |
  | ComfyUI | GPL-3.0 |
  | ffmpeg | LGPL 2.1+ / GPL depending on the build |
  | yt-dlp | Unlicense |

- Claude is a trademark of Anthropic. YouTube, Instagram, TikTok and Upload-Post are trademarks of their owners. This project is not
  affiliated with or endorsed by any of them.

## Shared as is
This project is shared as is, without warranty and without support commitment. It publishes to real accounts when you give it a key:
run rehearsals first, read what it will do, and stay responsible for what goes out under your name.
