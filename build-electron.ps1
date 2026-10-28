# 用 electron-builder 生成 portable 单文件 exe（NSIS 自解压，行为与 release 基线一致）
param(
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

$Dev     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source  = Join-Path $Dev "source"
$Node    = "C:\Users\DX03\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

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

Write-Host "==== 输出 ===="
Get-ChildItem $OutDir | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
