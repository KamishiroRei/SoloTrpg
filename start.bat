@echo off
title SoloTrpg
cd /d "%~dp0server"
if not exist "node_modules" npm install
start "" /B node server.js
:wait
timeout /t 1 /nobreak >nul
powershell -Command "try { (Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 2).StatusCode; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait
start http://localhost:3000
