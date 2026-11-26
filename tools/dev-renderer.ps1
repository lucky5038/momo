# 前端工程开发模式：启动 Vite 开发服务器 + Electron（开发数据目录，不影响正式配置）
# 用法: powershell -ExecutionPolicy Bypass -File tools\dev-renderer.ps1
$ErrorActionPreference = "Stop"

$Dev      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root     = Split-Path -Parent $Dev
$Node     = Join-Path $Root "tools\node\bin\node.exe"
$Vite     = Join-Path $Root "source\renderer\node_modules\vite\bin\vite.js"
$Electron = Join-Path $Root "tools\electron31\electron.exe"
$App      = Join-Path $Root "source"
$OutLog   = Join-Path $env:TEMP "nb-dev-renderer.out.log"
$ErrLog   = Join-Path $env:TEMP "nb-dev-renderer.err.log"
$ViteLog  = Join-Path $env:TEMP "nb-dev-vite.out.log"
$ViteErr  = Join-Path $env:TEMP "nb-dev-vite.err.log"

if (-not (Test-Path $Node)) { throw "找不到 Node：$Node" }
if (-not (Test-Path $Vite)) { throw "找不到 Vite，请先在 source\renderer 执行 pnpm install" }
if (-not (Test-Path $Electron)) { throw "找不到 Electron 运行时，请把 electron-v31.0.0-win32-x64.zip 解压到 tools\electron31" }

# 本机环境若设置了 ELECTRON_RUN_AS_NODE，Electron 会以纯 Node 模式启动，require('electron') 会失败
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:NB_DEV = "1"
$env:NB_RENDERER_URL = "http://127.0.0.1:5173/"

# 1. 起 Vite（127.0.0.1:5173；输出重定向到日志，避免隐藏控制台导致的 stdout 写入异常）
$viteProc = Start-Process -FilePath $Node -ArgumentList "`"$Vite`"", "--port", "5173", "--strictPort", "--host", "127.0.0.1" `
  -WorkingDirectory (Join-Path $Root "source\renderer") -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $ViteLog -RedirectStandardError $ViteErr
Write-Host "Vite 已启动 (pid $($viteProc.Id))，等待 5173 就绪..."

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $ready) { Write-Warning "Vite 未在 15 秒内就绪，仍尝试启动 Electron。" }

# 2. 起 Electron（日志写入临时文件；源码变更导致的自重启会继续等待新进程）
# --remote-debugging-port 供自动化验证用（CDP 读取页面 DOM / 截图），仅开发模式开启
Write-Host "Electron 日志: $OutLog"
$el = Start-Process -FilePath $Electron -ArgumentList "--remote-debugging-port=9222", "`"$App`"" -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -PassThru

function Find-DevElectron {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like "*$App*" -and $_.CommandLine -notmatch "--type=" } |
    Select-Object -First 1
}

try {
  while ($el -and -not $el.HasExited) {
    if ($viteProc -and $viteProc.HasExited) { Write-Warning "Vite 已退出，日志：$ViteErr"; $viteProc = $null }
    Start-Sleep -Milliseconds 700
  }
  Start-Sleep -Milliseconds 1500
  $next = Find-DevElectron
  while ($next) {
    Write-Host "Electron 自重启 (pid $($next.ProcessId))，继续等待..."
    $el = Get-Process -Id $next.ProcessId -ErrorAction SilentlyContinue
    if ($el) { $el.WaitForExit() }
    Start-Sleep -Milliseconds 1500
    $next = Find-DevElectron
  }
} finally {
  if ($viteProc -and -not $viteProc.HasExited) { Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue }
  Write-Host "Electron 已退出，Vite 已停止。"
}
