# ============================================================
# stop-backend.ps1 — TrpgRecode 唯一受控后端关闭工具
# 2026-08-05 确立（因误杀用户后端事故）
#
# 行为：
#   1. 检测端口 3000 监听进程
#   2. 检查父进程是否为 SoloTrpg.exe（用户后端判定）
#   3. 用户后端 → 不停止，提示手动关闭 SoloTrpg.exe，返回码 3
#   4. 本框架启动的进程（父进程非 SoloTrpg.exe）→ 询问确认后停止，返回码 0
#   5. 端口空闲 → 提示无后端，返回码 1
#   6. 其他异常 → 返回码 2
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/stop-backend.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/stop-backend.ps1 -Force   # 跳过确认（仅限框架进程）
# ============================================================
param([switch]$Force)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $conn) {
    Write-Output '[stop-backend] 端口 3000 空闲：无后端在运行。'
    exit 1
}

$pid3000 = $conn.OwningProcess
$proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pid3000" -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Output "[stop-backend] 无法获取 PID=$pid3000 的进程信息，不执行任何停止操作。"
    exit 2
}

$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)" -ErrorAction SilentlyContinue
$isUserBackend = $false
if ($parent -and $parent.Name -match 'SoloTrpg') {
    $isUserBackend = $true
}
if ($proc.CommandLine -match 'SoloTrpg') {
    $isUserBackend = $true
}

Write-Output "[stop-backend] 端口 3000 监听进程: PID=$pid3000 ($($proc.Name))"
Write-Output "[stop-backend] 父进程: $($parent.Name) ($($proc.ParentProcessId))"
Write-Output "[stop-backend] 命令行: $($proc.CommandLine)"

if ($isUserBackend) {
    Write-Output ''
    Write-Output '[stop-backend] ⚠ 检测到用户后端（由 SoloTrpg.exe 启动器打开）。'
    Write-Output '[stop-backend] 不得自动停止。请用户手动关闭 SoloTrpg.exe（或确认后由用户自行重启）。'
    exit 3
}

if ($Force) {
    Stop-Process -Id $pid3000 -Force
    Write-Output "[stop-backend] 已停止框架后端 PID=$pid3000。"
    exit 0
}

$answer = Read-Host "[stop-backend] 确认停止该后端进程 PID=$pid3000？(y/N)"
if ($answer -match '^(y|yes)$') {
    Stop-Process -Id $pid3000 -Force
    Write-Output "[stop-backend] 已停止框架后端 PID=$pid3000。"
    exit 0
}
Write-Output '[stop-backend] 已取消。'
exit 0
