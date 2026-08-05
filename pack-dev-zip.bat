@echo off
rem ================================================================
rem  TrpgRecode 开发关联文件快速打包（供网页端 GPT 处理）
rem  打包: 前端/后端代码、配置、文档、知识库、开发脚本、
rem        DND 框架部分(plugins/ui/compressed/_index.json/_tools)
rem  排除: DND模组内容(source/assets/original)、exe build 代码、
rem        node_modules、data/uploads 用户数据、日志、AI任务、git
rem ================================================================
chcp 936 >nul
setlocal
set "SRC=C:\Users\ASUS\Desktop\跑团\TrpgRecode"
set "STAGE=%TEMP%\trpg_pack_stage"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "OUT=%SRC%\TrpgRecode-pack-%TS%.zip"

echo.
echo 源目录: %SRC%
echo 输出包: %OUT%
echo 正在打包，请稍候...
echo.

if exist "%STAGE%" rmdir /s /q "%STAGE%"

rem ---------- 前端 ----------
robocopy "%SRC%\app" "%STAGE%\app" /E /NFL /NDL /NJH /NJS /R:1 /W:1
if errorlevel 8 goto :fail

rem ---------- 后端代码(排除 node_modules) ----------
robocopy "%SRC%\server" "%STAGE%\server" /E /XD node_modules /NFL /NDL /NJH /NJS /R:1 /W:1
if errorlevel 8 goto :fail

rem ---------- 根配置文件 ----------
robocopy "%SRC%" "%STAGE%" README.md start.bat .gitignore /NFL /NDL /NJH /NJS /R:1 /W:1
if errorlevel 8 goto :fail

rem ---------- 文档 / 脚本 / 知识库 / 开发工具 ----------
robocopy "%SRC%\docs" "%STAGE%\docs" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\scripts" "%STAGE%\scripts" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\知识库" "%STAGE%\知识库" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\_tools" "%STAGE%\_tools" /E /NFL /NDL /NJH /NJS /R:1 /W:1
if errorlevel 8 goto :fail

rem ---------- data 下开发辅助脚本(不含 uploads 用户数据) ----------
robocopy "%SRC%\data" "%STAGE%\data" gen_rule_data.py test_plugin.js verify_levelup.js todo.json /NFL /NDL /NJH /NJS /R:1 /W:1
if errorlevel 8 goto :fail

rem ---------- DND 框架部分(模组内容 source/assets/original 不打包) ----------
robocopy "%SRC%\Ruler\DND五版不全书\plugins" "%STAGE%\Ruler\DND五版不全书\plugins" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\Ruler\DND五版不全书\ui" "%STAGE%\Ruler\DND五版不全书\ui" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\Ruler\DND五版不全书\compressed" "%STAGE%\Ruler\DND五版不全书\compressed" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\Ruler\DND五版不全书\_tools" "%STAGE%\Ruler\DND五版不全书\_tools" /E /NFL /NDL /NJH /NJS /R:1 /W:1
robocopy "%SRC%\Ruler\DND五版不全书" "%STAGE%\Ruler\DND五版不全书" _index.json /NFL /NDL /NJH /NJS /R:1 /W:1
if errorlevel 8 goto :fail

rem ---------- 压缩为 zip ----------
powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; if(Test-Path '%OUT%'){Remove-Item '%OUT%' -Force}; [System.IO.Compression.ZipFile]::CreateFromDirectory('%STAGE%','%OUT%',[System.IO.Compression.CompressionLevel]::Optimal,$false)"
if errorlevel 1 goto :fail

rmdir /s /q "%STAGE%"

for %%A in ("%OUT%") do set "SIZE=%%~zA"
echo.
echo ======== 打包完成 ========
echo 输出: %OUT%
echo 大小: %SIZE% 字节
echo 可按需直接上传网页端 GPT 处理。
echo ==========================
goto :end

:fail
echo.
echo ======== 打包失败(robocopy 或压缩出错) ========
if exist "%STAGE%" echo 暂存目录未清理: %STAGE%
exit /b 1

:end
endlocal
pause