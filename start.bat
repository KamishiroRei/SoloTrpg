@echo off
setlocal EnableExtensions
chcp 936 >nul
title SoloTrpg - 游戏服务运行中（关闭本窗口=停止服务）
cd /d "%~dp0"

if not exist "Logs" mkdir "Logs"
set "LATEST_LOG=%~dp0Logs\latest.log"
set "LAUNCH_LOG=%~dp0Logs\launcher.log"
set "CHECK_LOG=%TEMP%\SoloTrpg-node-check-%RANDOM%.log"
set "INSTALL_LOG=%TEMP%\SoloTrpg-npm-install-%RANDOM%.log"
set "LAUNCHER_PID=0"
set "SERVER_DIR=%~dp0server"
set "SERVER_JS=%~dp0server\server.js"

break > "%LATEST_LOG%"
call :log "============================================================"
call :log "SoloTrpg launcher (web edition)"
call :log "Project directory: %~dp0"
call :log "Latest log: %LATEST_LOG%"
call :log "Launcher log: %LAUNCH_LOG%"

where node >nul 2>&1
if errorlevel 1 goto NODE_MISSING

for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $PID }).ParentProcessId"') do set "LAUNCHER_PID=%%P"
call :log "Launcher PID: %LAUNCHER_PID%"
if not "%LAUNCHER_PID%"=="0" node "%~dp0server\startup-manager.js" --prepare-launcher %LAUNCHER_PID% >> "%LATEST_LOG%" 2>&1

call :log "Node.js version:"
node --version
node --version >> "%LATEST_LOG%" 2>&1
node --version >> "%LAUNCH_LOG%" 2>&1

cd /d "%SERVER_DIR%"
if errorlevel 1 goto SERVER_DIR_FAIL

if exist "node_modules\express" goto DEPS_READY
call :log "Installing backend dependencies with npm install ..."
call npm install > "%INSTALL_LOG%" 2>&1
set "INSTALL_EXIT=%ERRORLEVEL%"
type "%INSTALL_LOG%"
type "%INSTALL_LOG%" >> "%LATEST_LOG%"
type "%INSTALL_LOG%" >> "%LAUNCH_LOG%"
del /q "%INSTALL_LOG%" >nul 2>&1
if not "%INSTALL_EXIT%"=="0" goto INSTALL_FAIL
call :log "Backend dependencies are ready."

:DEPS_READY
call :log "Checking server.js syntax ..."
node --check "%SERVER_JS%" > "%CHECK_LOG%" 2>&1
set "CHECK_EXIT=%ERRORLEVEL%"
type "%CHECK_LOG%"
type "%CHECK_LOG%" >> "%LATEST_LOG%"
type "%CHECK_LOG%" >> "%LAUNCH_LOG%"
del /q "%CHECK_LOG%" >nul 2>&1
if not "%CHECK_EXIT%"=="0" goto CHECK_FAIL
call :log "Syntax check passed."

set "NODE_ENV=development"
set "SOLOTRPG_DEBUG=1"
set "SOLOTRPG_LOG_DIR=%~dp0Logs"
set "SOLOTRPG_KEEP_LAUNCH_LOG=1"

call :log "Starting Node server in foreground."
call :log "The browser opens after the server starts."
call :log "Runtime logs are written to Logs\latest.log and Logs\debug-*.log."
echo.
echo [SoloTrpg] 正在启动，浏览器将自动打开 http://127.0.0.1:3000 ...
echo [SoloTrpg] 本窗口实时显示服务日志；关闭本窗口 = 停止服务并关闭游戏。
echo.

node "%SERVER_JS%" --debug
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
call :log "Node debug server stopped. Exit code: %SERVER_EXIT%"
echo [SoloTrpg] 服务已停止。窗口保持显示，按任意键关闭。
pause
goto END

:NODE_MISSING
call :log "ERROR: Node.js was not found. start.bat requires a local Node.js installation."
echo [SoloTrpg] 错误：未找到 Node.js，无法启动。请先安装 Node.js 22 或更高版本。
echo [SoloTrpg] 也可以使用 https://nodejs.org 下载安装后重试。
pause
goto END

:SERVER_DIR_FAIL
call :log "ERROR: Cannot enter server directory: %~dp0server"
echo [SoloTrpg] 错误：找不到 server 目录。
pause
goto END

:INSTALL_FAIL
call :log "ERROR: npm install failed. Exit code: %INSTALL_EXIT%"
echo [SoloTrpg] 错误：依赖安装失败（npm install），请查看上方日志。
pause
goto END

:CHECK_FAIL
call :log "ERROR: server.js syntax check failed. Exit code: %CHECK_EXIT%"
echo [SoloTrpg] 错误：server.js 语法检查失败，请检查代码。
pause
goto END

:END
if not "%LAUNCHER_PID%"=="0" node "%~dp0server\startup-manager.js" --cleanup-launcher %LAUNCHER_PID% >nul 2>&1
echo.
echo SoloTrpg 服务已停止。
pause
exit /b %SERVER_EXIT%

:log
set "LOG_TEXT=%~1"
echo [%date% %time%] %LOG_TEXT%
>> "%LATEST_LOG%" echo [%date% %time%] %LOG_TEXT%
>> "%LAUNCH_LOG%" echo [%date% %time%] %LOG_TEXT%
exit /b 0
