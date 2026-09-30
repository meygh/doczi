# solo-keel dashboard launcher (Windows PowerShell 5.1+ and PowerShell 7). Picks Node.js, PHP or Python 3.
# Usage: .\serve.cmd                                   interactive menu
#        .\serve.cmd -Runtime php -Port 4800 -NoOpen
param(
  [ValidateSet("", "node", "php", "python")] [string] $Runtime = "",
  [int] $Port = 0,
  [switch] $NoOpen,
  [switch] $Open,
  [switch] $Yes
)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Get-Version([string] $cmd, [string[]] $argv, [string] $pattern) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { return $null }
  try {
    $out = (& $cmd @argv 2>&1 | Out-String).Trim()
    if ($out -match $pattern) { return $Matches[1] }
  } catch { }
  return $null
}

function Test-PortBusy([int] $p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect("127.0.0.1", $p); return $true } catch { return $false } finally { $client.Dispose() }
}

$pythonCmd = $null; $pythonVersion = $null
foreach ($c in @("python3", "python", "py")) {
  $v = Get-Version $c @("--version") "^Python (3\.\S+)"
  if ($v) { $pythonCmd = $c; $pythonVersion = $v; break }
}
$runtimes = @(
  [pscustomobject]@{ Key = "node";   Label = "Node.js";  Version = (Get-Version "node" @("--version") "^v?(\S+)") },
  [pscustomobject]@{ Key = "php";    Label = "PHP";      Version = (Get-Version "php" @("-r", "echo PHP_VERSION;") "^(\S+)") },
  [pscustomobject]@{ Key = "python"; Label = "Python 3"; Version = $pythonVersion }
)
$installed = @($runtimes | Where-Object { $_.Version })
if (-not $installed) {
  Write-Host "  None of Node.js, PHP or Python 3 is installed. Install one of them and run this again." -ForegroundColor Yellow
  exit 1
}

$keelHome = if ($env:SOLO_KEEL_HOME) { $env:SOLO_KEEL_HOME } else { Join-Path $HOME ".solo-keel" }
$count = 0
$registry = Join-Path $keelHome "projects.json"
if (Test-Path $registry) { try { $count = @((Get-Content $registry -Raw | ConvertFrom-Json).projects).Count } catch { } }

if (-not $Runtime) {
  $defaultIndex = [array]::IndexOf($runtimes, $installed[0]) + 1
  if ($Yes) { $Runtime = $installed[0].Key }
  else {
    Write-Host ""
    Write-Host "  solo-keel" -NoNewline -ForegroundColor White; Write-Host " · project dashboard"
    Write-Host "  ──────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  Projects registered: $count  ($keelHome)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Serve it with:"
    for ($i = 0; $i -lt $runtimes.Count; $i++) {
      $r = $runtimes[$i]
      if ($r.Version) {
        Write-Host ("    {0}) {1,-9} " -f ($i + 1), $r.Label) -NoNewline
        Write-Host $r.Version -ForegroundColor Green
      } else {
        Write-Host ("    {0}) {1,-9} not installed" -f ($i + 1), $r.Label) -ForegroundColor DarkGray
      }
    }
    Write-Host "    q) Quit"
    Write-Host ""
    while ($true) {
      $choice = Read-Host "  Choose [$defaultIndex]"
      if (-not $choice) { $choice = "$defaultIndex" }
      if ($choice -match "^[qQ]$") { Write-Host "  Bye."; exit 0 }
      if ($choice -match "^[1-3]$") {
        $picked = $runtimes[[int]$choice - 1]
        if ($picked.Version) { $Runtime = $picked.Key; break }
        Write-Host "  $($picked.Label) is not installed; pick another." -ForegroundColor Yellow
      } else {
        Write-Host "  Type 1, 2, 3 or q." -ForegroundColor Yellow
      }
    }
  }
}
$chosen = $runtimes | Where-Object { $_.Key -eq $Runtime }
if (-not $chosen.Version) { Write-Host "$($chosen.Label) is not installed." -ForegroundColor Yellow; exit 1 }

$suggest = 4800
while (Test-PortBusy $suggest) { $suggest++ }
if ($Port -eq 0) {
  if ($Yes) { $Port = $suggest }
  else {
    while ($true) {
      $answer = Read-Host "  Port [$suggest]"
      if (-not $answer) { $answer = "$suggest" }
      if ($answer -notmatch "^\d+$" -or [int]$answer -lt 1024 -or [int]$answer -gt 65535) { Write-Host "  Use a number from 1024 to 65535." -ForegroundColor Yellow }
      elseif (Test-PortBusy ([int]$answer)) { Write-Host "  Port $answer is in use; try $suggest." -ForegroundColor Yellow }
      else { $Port = [int]$answer; break }
    }
  }
} elseif ($Port -lt 1024 -or $Port -gt 65535) {
  Write-Host "Use a port from 1024 to 65535." -ForegroundColor Yellow; exit 2
} elseif (Test-PortBusy $Port) {
  Write-Host "Port $Port is in use; try $suggest." -ForegroundColor Yellow; exit 1
}

$openBrowser = -not $NoOpen
if (-not $NoOpen -and -not $Open -and -not $Yes) {
  $answer = Read-Host "  Open it in your browser? [Y/n]"
  $openBrowser = $answer -notmatch "^(n|no)$"
}

$url = "http://localhost:$Port/"
$env:SOLO_KEEL_PORT = "$Port"
if ($openBrowser) {
  Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 1; Start-Process $u } -ArgumentList $url | Out-Null
}
Write-Host ""
switch ($Runtime) {
  "node"   { & node "server/node/server.mjs" --port $Port }
  "php"    { Write-Host "solo-keel dashboard (PHP $($chosen.Version)) → $url   Stop with Ctrl+C."; & php -S "127.0.0.1:$Port" "server/php/router.php" }
  "python" { & $pythonCmd "server/python/server.py" --port $Port }
}
