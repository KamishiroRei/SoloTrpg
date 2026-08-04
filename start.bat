@echo off
chcp 65001 >nul
title SoloTrpg
cd /d "%~dp0server"
if not exist "node_modules" (
    echo 首次运行，安装依赖...
    call npm install
)
echo 启动中...
start "" /B node server.js
:wait
timeout /t 1 /nobreak >nul
powershell -Command "try { Invoke-WebRequest -Uri http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait
start http://localhost:3000
echo 游戏已启动！
pause
