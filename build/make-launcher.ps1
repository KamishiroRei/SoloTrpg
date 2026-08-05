# SoloTrpg single-file build script
# Output: SoloTrpg.exe - ONE self-contained exe:
#   - embeds node.exe (Node runtime) + WebView2 SDK dlls as resources
#   - extracts them to %LOCALAPPDATA%\SoloTrpg\bin on first run (target machine
#     needs nothing: no Node install, no external node.exe, no console window)
#   - shows a native WebView2 window (game-like) hosting the web UI
# Source code (server/ app/ Ruler/ etc.) stays on disk so the AI can iterate
# on it without opencode.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File build/make-launcher.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outExe = Join-Path $root 'SoloTrpg.exe'
$hostCs = Join-Path $PSScriptRoot 'host.cs'
$cache = Join-Path $PSScriptRoot '_cache'
$wvVersion = '1.0.2739.15'

# ---- 1. locate local node.exe (embedded into the exe) ----
Write-Host '[build] Locating local node.exe ...' -ForegroundColor Cyan
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeSrc = $null
if ($nodeCmd) { $nodeSrc = $nodeCmd.Source }
if (-not $nodeSrc -or -not (Test-Path -LiteralPath $nodeSrc) -or [System.IO.Path]::GetExtension($nodeSrc) -ne '.exe') {
    throw 'node.exe not found (need real node.exe on PATH, not a .cmd shim)'
}
$nodeSizeMB = [math]::Round((Get-Item -LiteralPath $nodeSrc).Length / 1MB, 1)
Write-Host "[build] node.exe found: $nodeSrc ($nodeSizeMB MB)" -ForegroundColor Green

# ---- 2. WebView2 SDK (cached) ----
Write-Host '[build] Preparing WebView2 SDK ...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$nupkg = Join-Path $cache "webview2-$wvVersion.nupkg"
if (-not (Test-Path -LiteralPath $nupkg)) {
    Write-Host '[build] Downloading Microsoft.Web.WebView2 SDK ...'
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$wvVersion" -OutFile $nupkg -UseBasicParsing -TimeoutSec 120
}
$extract = Join-Path $cache "extract-$wvVersion"
if (-not (Test-Path -LiteralPath (Join-Path $extract 'lib'))) {
    if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    $zip = Join-Path $cache "webview2-$wvVersion.zip"
    Copy-Item -LiteralPath $nupkg -Destination $zip -Force
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
}
$coreDll = Join-Path $extract 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$winFormsDll = Join-Path $extract 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$loaderDll = Join-Path $extract 'runtimes\win-x64\native\WebView2Loader.dll'
if (-not (Test-Path -LiteralPath $coreDll) -or -not (Test-Path -LiteralPath $winFormsDll) -or -not (Test-Path -LiteralPath $loaderDll)) {
    throw 'WebView2 SDK files missing after extraction'
}

# ---- 3. compile single-file host (embed node.exe + WebView2 dlls + icon) ----
Write-Host '[build] Compiling SoloTrpg.exe (single file, embedded runtime) ...' -ForegroundColor Cyan
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $csc)) { throw 'csc.exe not found, cannot compile host' }
$iconArg = @()
$iconFile = Join-Path $PSScriptRoot 'icon.ico'
if (Test-Path -LiteralPath $iconFile) { $iconArg = @("/win32icon:$iconFile") } else { Write-Host '[build] WARN: icon.ico missing, building without icon' -ForegroundColor Yellow }
& $csc /nologo /target:winexe /optimize+ "/out:$outExe" `
    "/resource:$nodeSrc,node.exe" `
    "/resource:$coreDll,Microsoft.Web.WebView2.Core.dll" `
    "/resource:$winFormsDll,Microsoft.Web.WebView2.WinForms.dll" `
    "/resource:$loaderDll,WebView2Loader.dll" `
    "/r:$coreDll" "/r:$winFormsDll" `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Net.dll `
    $iconArg $hostCs
if ($LASTEXITCODE -ne 0) { throw "csc compile failed, exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $outExe)) { throw "output missing: $outExe" }

$exeSizeMB = [math]::Round((Get-Item -LiteralPath $outExe).Length / 1MB, 1)
Write-Host "[build] SoloTrpg.exe generated ($exeSizeMB MB, single self-contained file)" -ForegroundColor Green

# ---- 4. cleanup old multi-file artifacts (previous build layout) ----
foreach ($old in @('SoloTrpgUI.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
    $p = Join-Path $root $old
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Host "[build] removed old artifact: $old" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '[build] Done. Distribution: ship the whole TrpgRecode directory (SoloTrpg.exe + server/ + app/ + Ruler/). Double-click SoloTrpg.exe -> native game-like window; closing the window stops the service.' -ForegroundColor Cyan
