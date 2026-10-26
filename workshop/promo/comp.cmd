@echo off
rem Promo film, step 3b only: Blender composites the filmed vitrine (workshop/promo/promo_comp.py) into <film_dir>\comp.
rem Usage: comp.cmd <film_dir> <cover.jpg>   e.g. comp.cmd media\promo-film\STAMP media\VIDEO_ID\cover.jpg
rem Blender is "blender" on the PATH unless STUDIO_BLENDER names blender.exe. Log: data\daily\task-promo-final.log.
cd /d "%~dp0..\.."
if "%~2"=="" ( echo Usage: comp.cmd ^<film_dir^> ^<cover.jpg^> & exit /b 2 )
if not defined STUDIO_BLENDER set "STUDIO_BLENDER=blender"
if not exist "data\daily" mkdir "data\daily"
set "LOG=data\daily\task-promo-final.log"
echo %date% %time% start > "%LOG%"
"%STUDIO_BLENDER%" -b -P workshop\promo\promo_comp.py -- "%~f1\comp" "%~f1\edit\foot" "%~f1\edit\timeline.json" "%~f2" 10 >> "%LOG%" 2>&1
echo %date% %time% comp done >> "%LOG%"
