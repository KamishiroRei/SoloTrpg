@echo off
chcp 65001 >nul
title Build SoloTrpg EXE
cd /d "%~dp0server"

where node >nul 2>&1
if errorlevel 1 (
  echo [SoloTrpg] 未找到 Node.js 22 或更高版本。
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo [SoloTrpg] 依赖安装失败。
  pause
  exit /b 1
)

call npm run build
if errorlevel 1 (
  echo [SoloTrpg] EXE 构建失败。
  pause
  exit /b 1
)

echo.
echo [SoloTrpg] 已生成：%~dp0SoloTrpg.exe
pause
