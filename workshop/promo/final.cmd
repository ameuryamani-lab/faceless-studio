@echo off
rem Promo film, step 3b + 3c: Blender composite (promo_comp.py), then one MP4 per narration voice (mux.mjs) and a cover frame.
rem Usage: final.cmd <film_dir> <cover.jpg> <out_base>
rem   e.g. final.cmd media\promo-film\STAMP media\VIDEO_ID\cover.jpg media\promo\promo-STAMP
rem   writes <out_base>.mp4 (voice media\promo-film\voice\male), <out_base>-voix2.mp4 (voice ...\female) and their .jpg covers.
rem Tools: "node", "blender", "ffmpeg" on the PATH unless STUDIO_NODE, STUDIO_BLENDER, STUDIO_FFMPEG name them.
cd /d "%~dp0..\.."
if "%~3"=="" ( echo Usage: final.cmd ^<film_dir^> ^<cover.jpg^> ^<out_base^> & exit /b 2 )
if not defined STUDIO_NODE set "STUDIO_NODE=node"
if not defined STUDIO_BLENDER set "STUDIO_BLENDER=blender"
if not defined STUDIO_FFMPEG set "STUDIO_FFMPEG=ffmpeg"
if not exist "data\daily" mkdir "data\daily"
set "LOG=data\daily\task-promo-final.log"
set "FILM=%~f1"
set "OUT=%~f3"
set "VOICES=%CD%\media\promo-film\voice"
echo %date% %time% start > "%LOG%"
"%STUDIO_BLENDER%" -b -P workshop\promo\promo_comp.py -- "%FILM%\comp" "%FILM%\edit\foot" "%FILM%\edit\timeline.json" "%~f2" 10 >> "%LOG%" 2>&1
"%STUDIO_NODE%" --no-warnings workshop\promo\mux.mjs "%FILM%\comp" "%FILM%\edit\timeline.json" "%VOICES%\male" "%OUT%.mp4" >> "%LOG%" 2>&1
"%STUDIO_NODE%" --no-warnings workshop\promo\mux.mjs "%FILM%\comp" "%FILM%\edit\timeline.json" "%VOICES%\female" "%OUT%-voix2.mp4" >> "%LOG%" 2>&1
"%STUDIO_FFMPEG%" -hide_banner -loglevel error -y -ss 9 -i "%OUT%.mp4" -frames:v 1 -q:v 3 "%OUT%.jpg" >> "%LOG%" 2>&1
copy /y "%OUT%.jpg" "%OUT%-voix2.jpg" >> "%LOG%" 2>&1
echo %date% %time% end >> "%LOG%"
