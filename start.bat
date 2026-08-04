@echo off
title SoloTrpg
cd /d "%~dp0server"
if not exist "node_modules" (
    echo 首次运行，安装依赖...
    call npm install
)
echo 启动中...
start "" /B node server.js
timeout /t 2 /nobreak >nul
start http://localhost:3000
echo 游戏已启动！浏览器打开 http://localhost:3000
pause
