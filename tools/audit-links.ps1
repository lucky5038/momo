# Read-only registry link audit. Start the app first; requires sqlcmd.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\audit-links.ps1 -Server 192.168.0.142 -User sa -Password *** -Database XBK
# Output: tools\link-audit-<version>.csv; custom edges are checked separately with transactions/temp data.
param(
  [string]$BaseUrl = 'http://127.0.0.1:8787',
  [Parameter(Mandatory=$true)][string]$Server,
  [Parameter(Mandatory=$true)][string]$User,
  [Parameter(Mandatory=$true)][string]$Password,
  [Parameter(Mandatory=$true)][string]$Database,
  [string]$OutCsv = "$env:TEMP\link-audit-current.csv"
)
$ErrorActionPreference = 'Stop'
$sqlcmd = 'C:\Program Files\Microsoft SQL Server\110\Tools\Binn\SQLCMD.EXE'
if (-not (Test-Path $sqlcmd)) { throw "sqlcmd not found: $sqlcmd" }
$chains = Invoke-RestMethod "$BaseUrl/api/chains" -TimeoutSec 30
$meta = Invoke-RestMethod "$BaseUrl/api/meta" -TimeoutSec 60
$docs = @{}
foreach ($d in @($meta.docs)) {
  if ($d.sub) { $docs[$d.sub] = $d }
  if ($d.id) { $docs[$d.id] = $d }
}
function Safe($v) { return ($v -and ($v -match '^[A-Za-z0-9_]+$')) }
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('SET NOCOUNT ON;')
$rows = New-Object System.Collections.Generic.List[object]
$n = 0
foreach ($l in @($chains.links)) {
  $n++
  $d = $docs[$l.to]
  $toKey = $l.toJoinCol
  if (-not $toKey) { $toKey = $l.toNo }
  if (-not $toKey -and $d) { $toKey = $d.colNo }
  $customKeys = @{ SGMQBB = 'QBB001'; TPADEA = 'DEA001' }
  if ($l.joinSql -and $customKeys.ContainsKey([string]$l.to)) { $toKey = $customKeys[[string]$l.to] }
  $fromNo = $l.fromNo
  $fromSeq = $l.fromSeq
  $seqCol = $null
  if ($d) { $seqCol = $d.colSeq; if (-not $seqCol) { $seqCol = $d.seqCol } }
  $row = [ordered]@{
    i = $n; from = $l.from; to = $l.to; status = $l.status
    fromNo = $fromNo; fromSeq = $fromSeq; toKey = $toKey; toSeq = $seqCol
    custom = [bool]$l.joinSql
    result = ''; srcRows = ''; matchedRows = ''; distinctTargets = ''; error = ''
  }
  if ($l.status -eq 'ambiguous') { $row.result = 'ambiguous'; $rows.Add([pscustomobject]$row); continue }
  if (-not (Safe $l.from) -or -not (Safe $l.to) -or -not (Safe $toKey)) {
    $row.result = 'no-key'; $rows.Add([pscustomobject]$row); continue
  }
  $where = '1=1'
  if (Safe $fromNo) {
    $where = "s.[$fromNo] IS NOT NULL AND LTRIM(RTRIM(CONVERT(nvarchar(200),s.[$fromNo]))) <> N''"
  }
  if ($l.joinSql) {
    $on = ([string]$l.joinSql).Replace('{a}', 't').Replace('{b}', 's')
  } else {
    if (-not (Safe $fromNo)) { $row.result = 'no-key'; $rows.Add([pscustomobject]$row); continue }
    $seqCond = ''
    if ($fromSeq -and $seqCol -and (Safe $fromSeq) -and (Safe $seqCol)) {
      $seqCond = " AND t.[$seqCol] = s.[$fromSeq]"
    }
    $on = "t.[$toKey] = s.[$fromNo]$seqCond"
  }
  $q = "SELECT $n AS i, COUNT(*) AS srcRows, COALESCE(SUM(CASE WHEN t.[$toKey] IS NULL THEN 0 ELSE 1 END),0) AS matchedRows, COUNT(DISTINCT t.[$toKey]) AS distinctTargets FROM (SELECT TOP 500 * FROM [dbo].[$($l.from)] s WHERE $where ORDER BY (SELECT NULL)) s LEFT JOIN [dbo].[$($l.to)] t ON $on"
  [void]$sb.AppendLine($q + ';')
  $rows.Add([pscustomobject]$row)
}
$sqlFile = Join-Path $env:TEMP 'link-audit-current.sql'
[IO.File]::WriteAllText($sqlFile, $sb.ToString(), [Text.UTF8Encoding]::new($false))
$raw = & $sqlcmd -S $Server -U $User -P $Password -d $Database -i $sqlFile -s '|' -W -h -1 -r 1 2>&1
$exit = $LASTEXITCODE
if ($exit -ne 0) { throw "sqlcmd failed ($exit): $($raw -join ' ')" }
$byIndex = @{}
foreach ($line in @($raw)) {
  $parts = @($line.Trim() -split '\|')
  if ($parts.Count -ge 4 -and $parts[0] -match '^\d+$') {
    $byIndex[[int]$parts[0]] = @{
      srcRows = [int]$parts[1]; matchedRows = [int]$parts[2]; distinctTargets = [int]$parts[3]
    }
  }
}
foreach ($r in $rows) {
  if ($byIndex.ContainsKey([int]$r.i)) {
    $x = $byIndex[[int]$r.i]
    $r.result = 'ok'; $r.srcRows = $x.srcRows; $r.matchedRows = $x.matchedRows; $r.distinctTargets = $x.distinctTargets
  }
}
$rows | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8
$summary = $rows | Group-Object result | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }
Write-Output ("SUMMARY " + ($summary -join ' '))
Write-Output ("CSV " + $OutCsv)
$zero = @($rows | Where-Object { $_.result -eq 'ok' -and [int]$_.matchedRows -eq 0 })
Write-Output ("ZERO " + $zero.Count)
if ($zero.Count) { $zero | ForEach-Object { Write-Output ("ZERO_ROW " + $_.from + '->' + $_.to + ' ' + $_.fromNo + '->' + $_.toKey) } }
$bad = @($rows | Where-Object { $_.result -in @('error','no-key') })
Write-Output ("BAD " + $bad.Count)
if ($bad.Count) { $bad | ForEach-Object { Write-Output ("BAD_ROW " + $_.from + '->' + $_.to + ' ' + $_.result + ' ' + $_.error) } }
