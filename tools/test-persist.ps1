# 回归测试：保存配置 -> 关闭 -> 重启 -> 校验服务器/账号/密码是否回填
$ErrorActionPreference = "Continue"
$Dev = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Dir = Join-Path $Dev "dist-electron"
$Exe = Join-Path $Dir "Momo传值助手 1.0.0.exe"
$Cfg = Join-Path $Dir "config.js"

if (-not (Test-Path $Exe)) { throw "未找到 $Exe，请先构建" }

Get-Process -Name "Momo传值助手" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $Cfg) { Remove-Item -LiteralPath $Cfg -Force }

function Wait-Api {
  for ($i = 0; $i -lt 15; $i++) {
    try { return Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/config" -UseBasicParsing -TimeoutSec 5 }
    catch { Start-Sleep -Seconds 2 }
  }
  return $null
}

Start-Process -FilePath $Exe | Out-Null
$r = Wait-Api
if (-not $r) { throw "服务未启动" }
Write-Host ("首次启动配置: " + $r.Content)

$body = '{"server":"192.168.0.142","user":"sa","password":"123","database":"DSB"}'
$s = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/save-config" -Method POST `
  -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 30
Write-Host ("保存配置: {0} {1}" -f $s.StatusCode, $s.Content)
Write-Host ("config.js 写在 exe 同目录: " + (Test-Path -LiteralPath $Cfg))

Get-Process -Name "Momo传值助手" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4

Start-Process -FilePath $Exe | Out-Null
$r2 = Wait-Api
if (-not $r2) { throw "重启后服务未启动" }
Write-Host ("重启后配置: " + $r2.Content)

$ok = ($r2.Content -match '192\.168\.0\.142') -and ($r2.Content -match '"password":"123"')
Write-Host ("回填结果: " + $(if ($ok) { "通过" } else { "失败" }))

foreach ($ep in @("/api/databases", "/api/meta")) {
  try {
    $d = Invoke-WebRequest -Uri ("http://127.0.0.1:8787" + $ep) -UseBasicParsing -TimeoutSec 60
    Write-Host ("{0} -> {1}" -f $ep, $d.StatusCode)
  } catch { Write-Host ("{0} -> 失败" -f $ep) }
}

Get-Process -Name "Momo传值助手" -ErrorAction SilentlyContinue | Stop-Process -Force
