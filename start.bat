@echo off
title SoloTrpg
cd /d "%~dp0server"
if not exist "node_modules" (
    echo 首次运行，安装依赖...
    call npm install
)
echo 启动中...
start http://localhost:3000
node server.js
