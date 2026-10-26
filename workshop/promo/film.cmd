@echo off
rem Promo film, step 2: films the vitrine while one real video is made (workshop/promo/film.mjs), then turns the stories task back on.
cd /d "%~dp0..\.."
if not defined STUDIO_NODE set "STUDIO_NODE=node"
if not exist "data\daily" mkdir "data\daily"
"%STUDIO_NODE%" --no-warnings workshop\promo\film.mjs >> "data\daily\task-film-promo.log" 2>&1
schtasks /Change /TN "Faceless Studio - histoires" /ENABLE >> "data\daily\task-film-promo.log" 2>&1
