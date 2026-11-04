$preview = Join-Path $env:TEMP 'MomoChuanzhiPreviewRun'
$running = Get-Process | Where-Object { $_.ProcessName -like 'Momo*' }
if ($running) {
    Write-Host 'Please close the running Momo app first.' -ForegroundColor Yellow
    Read-Host 'Press Enter to exit'
    exit 1
}
if (Test-Path $preview) { Remove-Item $preview -Recurse -Force }
Write-Host 'Preview data cleared. Next preview starts from onboarding again.'
Read-Host 'Press Enter to exit'
