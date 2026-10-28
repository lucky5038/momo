# 运行开发版（使用 dist-electron\win-unpacked，不重新打包）
$ErrorActionPreference = "Stop"

$Dev = Split-Path -Parent $MyInvocation.MyCommand.Path
$Exe = Join-Path $Dev "dist-electron\win-unpacked\Momo传值助手.exe"

if (-not (Test-Path $Exe)) {
  throw "未找到 $Exe`n请先运行 build-electron.ps1"
}

Get-Process -Name "Momo传值助手" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
Start-Process -FilePath $Exe
Write-Host "已启动开发版: $Exe"
