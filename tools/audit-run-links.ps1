# Read-only second-stage audit: ask /api/run to resolve every joinable edge.
# Start the app first and run audit-links.ps1 to produce the input CSV.
# A 400 with flowRejected=true is expected for reverse business flow, not a bug.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\audit-run-links.ps1 -InCsv tools\link-audit-2.2.71.csv
param(
  [string]$BaseUrl = 'http://127.0.0.1:8787',
  [Parameter(Mandatory=$true)][string]$InCsv,
  [string]$OutCsv = "$env:TEMP\link-run-audit.csv"
)
$ErrorActionPreference = 'Stop'
$rows = Import-Csv -LiteralPath $InCsv
$out = New-Object System.Collections.Generic.List[object]
$n = 0
foreach ($r in $rows) {
  if ($r.result -ne 'ok' -or $r.custom -eq 'True' -or -not $r.fromNo -or -not $r.toKey) { continue }
  $n++
  $body = @{
    docId = $r.to; tgtCol = $r.toKey; srcId = $r.from; srcValCol = $r.fromNo
    preview = $true; force = $false; trigger = $false; merge = $false
  } | ConvertTo-Json
  $rec = [ordered]@{ i = $r.i; from = $r.from; to = $r.to; target = ($r.to + '.' + $r.toKey); source = ($r.from + '.' + $r.fromNo); http = ''; totalRows = ''; channel = ''; result = ''; error = ''; errorBody = '' }
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/run" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 60
    $rec.http = [int]$resp.StatusCode
    $data = $resp.Content | ConvertFrom-Json
    $rec.result = 'ok'
    $rec.totalRows = $data.totalRows
    $rec.channel = $data.channelNote
    if ($data.error) { $rec.result = 'error'; $rec.error = [string]$data.error }
  } catch {
    $rec.error = $_.Exception.Message
    if ($_.Exception.Response) {
      $rec.http = [int]$_.Exception.Response.StatusCode
      $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      $rec.errorBody = $sr.ReadToEnd()
      try { $d = $rec.errorBody | ConvertFrom-Json } catch { $d = $null }
      if ($d -and $d.flowRejected) { $rec.result = 'flow-rejected'; $rec.error = [string]$d.error }
      else { $rec.result = 'error'; if ($d -and $d.error) { $rec.error = [string]$d.error } }
    } else { $rec.result = 'error' }
  }
  $out.Add([pscustomobject]$rec)
  if (($n % 20) -eq 0) { Write-Output "progress=$n" }
}
$out | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8
$errors = @($out | Where-Object { $_.result -eq 'error' })
$rejected = @($out | Where-Object { $_.result -eq 'flow-rejected' })
Write-Output ("RUNS " + $out.Count + " OK " + @($out | Where-Object { $_.result -eq 'ok' }).Count + " FLOW_REJECTED " + $rejected.Count + " ERRORS " + $errors.Count + " CSV " + $OutCsv)
if ($errors.Count) { $errors | ForEach-Object { Write-Output ("ERROR_ROW " + $_.from + '->' + $_.to + ' ' + $_.error) } }
