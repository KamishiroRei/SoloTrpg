@echo off
title SoloTrpg
cd /d "%~dp0server"
if not exist "node_modules" (
    echo 首次运行，安装依赖...
    call npm install
)
echo 启动中...
start "" /B node server.js
echo 等待服务就绪...
:wait
timeout /t 1 /nobreak >nul
curl -s http://localhost:3000/api/health >nul 2>&1
if errorlevel 1 goto wait
start http://localhost:3000
echo 游戏已启动！
pause
