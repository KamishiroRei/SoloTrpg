@echo off
setlocal EnableExtensions
chcp 65001 >nul
title SoloTrpg - Source Debug Server
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
call :log "SoloTrpg source debug launcher"
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

call :log "Starting Node debug server in foreground."
call :log "The browser opens after the server starts."
call :log "Runtime logs are written to Logs\latest.log and Logs\debug-*.log."
echo.

node "%SERVER_JS%" --debug
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
call :log "Node debug server stopped. Exit code: %SERVER_EXIT%"
goto END

:NODE_MISSING
call :log "ERROR: Node.js was not found. start.bat requires a local Node.js installation."
set "SERVER_EXIT=1"
goto END

:SERVER_DIR_FAIL
call :log "ERROR: Cannot enter server directory: %~dp0server"
set "SERVER_EXIT=1"
goto END

:INSTALL_FAIL
call :log "ERROR: npm install failed. Exit code: %INSTALL_EXIT%"
set "SERVER_EXIT=%INSTALL_EXIT%"
goto END

:CHECK_FAIL
call :log "ERROR: server.js syntax check failed. Exit code: %CHECK_EXIT%"
set "SERVER_EXIT=%CHECK_EXIT%"
goto END

:END
if not "%LAUNCHER_PID%"=="0" node "%~dp0server\startup-manager.js" --cleanup-launcher %LAUNCHER_PID% >nul 2>&1
echo.
echo Debug server exited. Check Logs\latest.log for details.
exit /b %SERVER_EXIT%

:log
set "LOG_TEXT=%~1"
echo [%date% %time%] %LOG_TEXT%
>> "%LATEST_LOG%" echo [%date% %time%] %LOG_TEXT%
>> "%LAUNCH_LOG%" echo [%date% %time%] %LOG_TEXT%
exit /b 0
