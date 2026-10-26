@echo off
rem One "coulisses" film: records the vitrine while one full agent chain runs (workshop/coulisses/record.mjs),
rem then turns the usual stories task back on. Launched once by the Windows task "Faceless Studio - coulisses".
cd /d "%~dp0..\.."
if not defined STUDIO_NODE set "STUDIO_NODE=node"
if not exist "data\daily" mkdir "data\daily"
"%STUDIO_NODE%" --no-warnings workshop\coulisses\record.mjs >> "data\daily\task-coulisses.log" 2>&1
schtasks /Change /TN "Faceless Studio - histoires" /ENABLE >nul
