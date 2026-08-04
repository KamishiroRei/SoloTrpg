@echo off
title SoloTrpg
cd /d "%~dp0server"
if not exist "node_modules" ( echo 正在准备游戏环境... && npm install --silent )
echo 游戏启动中...
node server.js
