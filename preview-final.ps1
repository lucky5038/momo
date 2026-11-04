$ErrorActionPreference = 'Stop'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = (Get-ChildItem (Join-Path $root 'dist-electron\win-unpacked') -Filter 'Momo*.exe' | Select-Object -First 1).FullName

$running = Get-Process | Where-Object { $_.ProcessName -like 'Momo*' }
if ($running) {
    Write-Host 'Please close the running Momo app before starting preview.' -ForegroundColor Yellow
    Write-Host 'Preview uses a separate temporary config and does not touch your real database config.'
    Read-Host 'Press Enter to exit'
    exit 1
}

Start-Process -FilePath $exe -ArgumentList '--preview'
