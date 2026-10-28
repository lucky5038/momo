# 启动开发版并检查本地服务是否正常响应
$ErrorActionPreference = "Continue"
$Dev = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Exe = Join-Path $Dev "dist-electron\win-unpacked\Momo传值助手.exe"

if (-not (Test-Path $Exe)) { throw "未找到 $Exe，请先运行 build-electron.ps1" }

Get-Process -Name "Momo传值助手" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

$proc = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 12
Write-Host ("进程 pid={0} 运行中={1}" -f $proc.Id, (-not $proc.HasExited))

foreach ($ep in @("/api/config", "/api/meta", "/api/databases", "/api/triggers")) {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:8787" + $ep) -UseBasicParsing -TimeoutSec 30
    $body = $r.Content
    if ($body.Length -gt 160) { $body = $body.Substring(0, 160) + "..." }
    Write-Host ("{0} -> {1} {2}" -f $ep, $r.StatusCode, $body)
  } catch {
    Write-Host ("{0} -> 失败 {1}" -f $ep, $_.Exception.Message)
  }
}
