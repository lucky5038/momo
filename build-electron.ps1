# 用 electron-builder 生成 portable 单文件 exe（NSIS 自解压，行为与 release 基线一致）
param(
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$Dev     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source  = Join-Path $Dev "source"
$Node    = Join-Path $Dev "tools\node\bin\node.exe"
if (-not (Test-Path $Node)) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
  else { throw "找不到本地 Node，请确认 tools\node\node.exe 存在。" }
}

# 构建前先同步内联界面，避免打包时使用旧的 public_inline.js
$Regen = Join-Path $Dev "tools\regen-inline.js"
if (Test-Path $Regen) {
  & $Node $Regen
  if ($LASTEXITCODE -ne 0) { throw "生成 public_inline.js 失败，exit=$LASTEXITCODE" }
}

# 构建前先编前端：electron-builder 会把 renderer/dist 打进 asar，忘编就会发旧界面
$ViteBin = Join-Path $Source "renderer\node_modules\vite\bin\vite.js"
if (Test-Path $ViteBin) {
  Push-Location (Join-Path $Source "renderer")
  try {
    & $Node $ViteBin build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败，exit=$LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} else {
  Write-Warning "未找到 $ViteBin，跳过前端构建（打包进去的可能是旧 dist）"
}
# electron-builder 工具链（随开发目录自带，位于 tools\eb）
$EbCli = Join-Path $Dev "tools\eb\node_modules\electron-builder\cli.js"
if (-not $EbCli) {
  throw "找不到 electron-builder，请确认 tools\eb\node_modules 完整。"
}
if (-not (Test-Path $EbCli)) { throw "找不到 electron-builder: $EbCli" }

if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path $Dev "dist-electron" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Push-Location $Source
try {
  # 按 electron-builder.yml 里的 targets 构建：便携版 + NSIS 安装包
  & $Node $EbCli --win --x64 --config.directories.output=$OutDir
  if ($LASTEXITCODE -ne 0) { throw "electron-builder 构建失败，exit=$LASTEXITCODE" }
} finally {
  Pop-Location
}

# 只保留当前版本的便携版/安装包，避免 win-unpacked、旧版本和调试文件堆积
$stale = @(
  (Join-Path $OutDir "win-unpacked"),
  (Join-Path $OutDir "builder-debug.yml")
)
foreach ($p in $stale) {
  if (Test-Path -LiteralPath $p) {
    try { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop }
    catch { Write-Warning "暂时无法清理 $p（请关闭正在运行的旧版后重试）: $($_.Exception.Message)" }
  }
}

$pkg = Get-Content (Join-Path $Source "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$versionText = [string]$pkg.version
Get-ChildItem $OutDir -File -ErrorAction SilentlyContinue |
  Where-Object { ($_.Extension -eq '.exe' -or $_.Extension -eq '.blockmap') -and ($_.Name -notlike "*$versionText*") } |
  ForEach-Object {
    try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
    catch { Write-Warning "暂时无法清理旧版本 $($_.Name): $($_.Exception.Message)" }
  }

# 桌面快捷方式必须始终指向固定路径，不能跟着版本号变。
# 新版构建完成后覆盖 releases\current\N-B助手.exe；配置仍在同一目录，升级不丢。
$StableDir = Join-Path $Dev "releases\current"
New-Item -ItemType Directory -Force -Path $StableDir | Out-Null
$portable = Join-Path $OutDir "N-B助手 $versionText.exe"
if (Test-Path -LiteralPath $portable) {
  Copy-Item -LiteralPath $portable -Destination (Join-Path $StableDir "N-B助手.exe") -Force
  Write-Host "稳定启动器已更新: $(Join-Path $StableDir 'N-B助手.exe')"
}

# 桌面快捷方式指向固定启动器；缺失时自动重建，避免清理/移动后快捷方式消失。
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop "N-B助手.lnk"
$exePath = Join-Path $StableDir "N-B助手.exe"
if ((Test-Path -LiteralPath $exePath) -and -not (Test-Path -LiteralPath $lnkPath)) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $exePath
  $shortcut.WorkingDirectory = $StableDir
  $shortcut.IconLocation = "$exePath,0"
  $shortcut.Description = "N-B助手"
  $shortcut.Save()
  Write-Host "桌面快捷方式已重建: $lnkPath"
}

Write-Host "==== 输出 ===="
Get-ChildItem $OutDir | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
