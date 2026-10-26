@echo off
rem Re-voices finished stories with the current channel narrator (hero.json), code only: voice, captions, motion, edit, QC.
rem Usage: revoice.cmd <video_id> [<video_id> ...]   Each video goes back to qc_passed (publishable) when its QC passes.
cd /d "%~dp0..\.."
if not defined STUDIO_NODE set "STUDIO_NODE=node"
if not exist "data\daily" mkdir "data\daily"
:next
if "%~1"=="" goto end
echo [%date% %time%] revoice %1 >> "data\daily\task-revoice.log"
"%STUDIO_NODE%" --no-warnings workshop\story\make-short.mjs "media\%~1\story.json" --redo voice >> "data\daily\task-revoice.log" 2>&1
shift
goto next
:end
echo [%date% %time%] revoice done >> "data\daily\task-revoice.log"
