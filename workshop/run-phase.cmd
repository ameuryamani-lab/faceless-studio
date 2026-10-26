@echo off
rem Faceless Studio launcher for the Windows scheduled tasks.
rem Usage: run-phase.cmd trends | publish | analyse | revoix | saisons | strategie | story
rem Output: data\daily\task-<phase>.log. Node is "node" on the PATH unless STUDIO_NODE names another node.exe.
rem Nothing runs while data\production-paused.json exists (the owner's pause).
cd /d "%~dp0.."
if not defined STUDIO_NODE set "STUDIO_NODE=node"
if not exist "data\daily" mkdir "data\daily"
if exist "data\production-paused.json" exit /b 0
if "%1"=="trends" (
  rem Once a day before production: the YouTube Shorts scan (Trending wall), then TikTok trends by web search (trend_scout).
  "%STUDIO_NODE%" --no-warnings core\trends.mjs 40 >> "data\daily\task-trends.log" 2>&1
  "%STUDIO_NODE%" --no-warnings core\run-agent.mjs trend_scout "TikTok sweep: find this week's rising TikTok trends by web search and store them with add_tiktok_trends." >> "data\daily\task-trends.log" 2>&1
  "%STUDIO_NODE%" --no-warnings core\mission.mjs >> "data\daily\task-trends.log" 2>&1
  exit /b
)
if "%1"=="publish" (
  "%STUDIO_NODE%" --no-warnings core\publish-direct.mjs >> "data\daily\task-publish.log" 2>&1
  exit /b
)
if "%1"=="analyse" (
  rem Every analysis is applied at once (slots, themes, lessons) and logged in data\decisions.jsonl.
  "%STUDIO_NODE%" --no-warnings workshop\story\hours.mjs >> "data\daily\task-analyse.log" 2>&1
  "%STUDIO_NODE%" --no-warnings workshop\story\strategy.mjs >> "data\daily\task-analyse.log" 2>&1
  "%STUDIO_NODE%" --no-warnings workshop\story\postmortem.mjs >> "data\daily\task-analyse.log" 2>&1
  exit /b
)
if "%1"=="revoix" (
  "%STUDIO_NODE%" --no-warnings workshop\story\revoice-sweep.mjs >> "data\daily\task-revoice.log" 2>&1
  exit /b
)
if "%1"=="saisons" (
  "%STUDIO_NODE%" --no-warnings workshop\story\seasonal.mjs >> "data\daily\task-saisons.log" 2>&1
  exit /b
)
if "%1"=="strategie" (
  "%STUDIO_NODE%" --no-warnings workshop\story\strategy.mjs >> "data\daily\task-strategie.log" 2>&1
  exit /b
)
if "%1"=="story" (
  "%STUDIO_NODE%" --no-warnings workshop\story\chain.mjs --loop >> "data\daily\task-story.log" 2>&1
  exit /b
)
echo Unknown phase "%1". Usage: run-phase.cmd trends ^| publish ^| analyse ^| revoix ^| saisons ^| strategie ^| story
exit /b 2
