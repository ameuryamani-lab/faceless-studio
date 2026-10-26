@echo off
rem Publishes one promo film once, on your own order only (workshop/promo/publish-promo.mjs, through Upload-Post).
rem Usage: publish-promo.cmd <video.mp4> <networks> "<caption>"
rem   e.g. publish-promo.cmd media\promo\promo-202610220610.mp4 tiktok "This channel runs itself. 22 AI agents ... #AI #automation"
cd /d "%~dp0..\.."
if "%~3"=="" ( echo Usage: publish-promo.cmd ^<video.mp4^> ^<networks^> "^<caption^>" & exit /b 2 )
if not defined STUDIO_NODE set "STUDIO_NODE=node"
if not exist "data\daily" mkdir "data\daily"
"%STUDIO_NODE%" --no-warnings workshop\promo\publish-promo.mjs "%~f1" %2 %3 >> "data\daily\task-promo-publish.log" 2>&1
