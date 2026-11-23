$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ElectronDir = Join-Path $env:LOCALAPPDATA "N-B助手Dev\electron"
$ElectronExe = Join-Path $ElectronDir "electron.exe"

if (-not (Test-Path $ElectronExe)) {
  $zip = Join-Path $env:USERPROFILE ".cache\electron\electron-v31.0.0-win32-x64.zip"
  if (-not (Test-Path $zip)) {
    $zip = Join-Path $env:LOCALAPPDATA "electron\Cache\electron-v31.0.0-win32-x64.zip"
  }
  if (-not (Test-Path $zip)) {
    throw "找不到 Electron 31 运行时。请确认 $zip 存在，或先安装/解压 Electron 31。"
  }
  New-Item -ItemType Directory -Force -Path $ElectronDir | Out-Null
  Write-Host "首次运行，解压 Electron 运行时..."
  Expand-Archive -LiteralPath $zip -DestinationPath $ElectronDir -Force
}

$DevData = Join-Path $env:APPDATA "N-B助手-开发版"
$FormalData = Join-Path $env:APPDATA "N-B助手"
if (-not (Test-Path $DevData)) {
  New-Item -ItemType Directory -Force -Path $DevData | Out-Null
  if (Test-Path $FormalData) {
    foreach ($name in @("config.js", "creds.json", "chain_registry.json", "invoice_source_map.json", "onboarding_done.flag", "nb_backup_picked.flag")) {
      $from = Join-Path $FormalData $name
      $to = Join-Path $DevData $name
      if ((Test-Path $from) -and -not (Test-Path $to)) {
        Copy-Item -LiteralPath $from -Destination $to -Force
      }
    }
    Write-Host "已复制正式版配置到开发版数据目录。"
  }
}

$env:NB_DEV = "1"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Write-Host "N-B助手 开发版启动中..."
Write-Host "源码：$Root\source"
Write-Host "数据：$DevData"
Push-Location (Join-Path $Root "source")
try {
  & $ElectronExe (Join-Path $Root "source\src\main.electron.js") --dev
} finally {
  Pop-Location
}
