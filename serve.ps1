# doczi dashboard launcher (Windows PowerShell 5.1+ and PowerShell 7). Serves with Node.js, PHP or Python 3.
# Usage: .\serve.cmd                    start with the saved settings, or the defaults the first time
#        .\serve.cmd -Setup             choose runtime, port and browser, and save them
#        .\serve.cmd -Reset             forget the saved settings
#        .\serve.cmd -Runtime php -Port 4800 -NoOpen   for this run only
param(
  [ValidateSet("", "node", "php", "python")] [string] $Runtime = "",
  [int] $Port = 0,
  [switch] $NoOpen,
  [switch] $Open,
  [switch] $Setup,
  [switch] $Reset,
  [switch] $DryRun,
  [switch] $Yes  # kept for older scripts: the start no longer asks anything
)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$docziHome = if ($env:DOCZI_HOME) { $env:DOCZI_HOME } elseif ($env:SOLO_KEEL_HOME) { $env:SOLO_KEEL_HOME } else { Join-Path $HOME ".doczi" } # SOLO_KEEL_HOME: legacy
$confFile = Join-Path $docziHome "serve.conf"
$labels = @{ node = "Node.js"; php = "PHP"; python = "Python 3" }

# Only the runtime that is needed is looked up; each lookup starts a process. The child gets
# empty input, so it cannot use up answers piped to this script.
$script:pythonCmd = $null
function Get-RuntimeVersion([string] $key) {
  switch ($key) {
    "node" { if (Get-Command node -ErrorAction SilentlyContinue) { $v = ($null | & node --version 2>$null) -replace "^v", ""; if ($v) { return "$v".Trim() } } }
    "php" { if (Get-Command php -ErrorAction SilentlyContinue) { $v = $null | & php -r "echo PHP_VERSION;" 2>$null; if ($v) { return "$v".Trim() } } }
    "python" {
      foreach ($c in @("python", "py", "python3")) {
        if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { continue }
        try { $out = ($null | & $c --version 2>&1 | Out-String).Trim() } catch { continue }
        if ($out -match "^Python (3\.\S+)") { $script:pythonCmd = $c; return $Matches[1] }
      }
    }
  }
  return $null
}

# A port is free when we can listen on it: instant, unlike a refused connection, which takes
# about two seconds on Windows.
function Test-PortFree([int] $p) {
  $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $p)
  try { $listener.Start(); return $true } catch { return $false } finally { try { $listener.Stop() } catch { } }
}
function Get-FreePort([int] $from) {
  $p = $from
  while (-not (Test-PortFree $p)) { $p++; if ($p -gt 65535) { return 0 } }
  return $p
}

# Read-Host ignores piped input; read it directly when there is no console to ask on.
function Read-Answer([string] $prompt) {
  if ([Console]::IsInputRedirected) { Write-Host "$prompt" -NoNewline; Write-Host ": "; return [Console]::In.ReadLine() }
  return Read-Host $prompt
}

if ($Reset) {
  if (Test-Path -LiteralPath $confFile) { Remove-Item -LiteralPath $confFile -Force }
  Write-Host "Forgot the saved settings; using the defaults."
}

# Saved settings: key=value lines, shared with the Bash launcher.
$saved = @{}
if (-not $Setup -and (Test-Path -LiteralPath $confFile)) {
  foreach ($line in Get-Content -LiteralPath $confFile) {
    if ($line -match "^\s*(runtime|port|open)\s*=\s*(.*?)\s*$") { $saved[$Matches[1]] = $Matches[2] }
  }
}
$version = $null

if ($Setup) {
  Write-Host ""
  Write-Host "  doczi - project dashboard setup"
  Write-Host "  -------------------------------"
  $keys = @("node", "php", "python")
  $versions = @{}
  foreach ($k in $keys) { $versions[$k] = Get-RuntimeVersion $k }
  $installed = @($keys | Where-Object { $versions[$_] })
  if (-not $installed) { Write-Host "  None of Node.js, PHP or Python 3 is installed. Install one of them and run this again." -ForegroundColor Yellow; exit 1 }
  Write-Host "  Serve it with:"
  for ($i = 0; $i -lt $keys.Count; $i++) {
    $k = $keys[$i]
    if ($versions[$k]) { Write-Host ("    {0}) {1,-9} {2}" -f ($i + 1), $labels[$k], $versions[$k]) }
    else { Write-Host ("    {0}) {1,-9} not installed" -f ($i + 1), $labels[$k]) -ForegroundColor DarkGray }
  }
  $default = [array]::IndexOf($keys, $installed[0]) + 1
  while ($true) {
    $choice = Read-Answer "  Choose [$default]"
    if (-not $choice) { $choice = "$default" }
    if ($choice -match "^[1-3]$" -and $versions[$keys[[int]$choice - 1]]) { $Runtime = $keys[[int]$choice - 1]; break }
    Write-Host "  Type the number of an installed runtime." -ForegroundColor Yellow
  }
  $version = $versions[$Runtime]
  $suggest = Get-FreePort 4800
  while ($true) {
    $answer = Read-Answer "  Port [$suggest]"
    if (-not $answer) { $answer = "$suggest" }
    if ($answer -notmatch "^\d+$" -or [int]$answer -lt 1024 -or [int]$answer -gt 65535) { Write-Host "  Use a number from 1024 to 65535." -ForegroundColor Yellow }
    elseif (-not (Test-PortFree ([int]$answer))) { Write-Host "  Port $answer is in use; try $suggest." -ForegroundColor Yellow }
    else { $Port = [int]$answer; break }
  }
  $answer = Read-Answer "  Open it in your browser when it starts? [Y/n]"
  $openSetting = if ($answer -match "^(n|no)$") { "no" } else { "yes" }
  New-Item -ItemType Directory -Force -Path $docziHome | Out-Null
  Set-Content -LiteralPath $confFile -Encoding ASCII -Value @(
    "# doczi dashboard settings. Change them with: doczi serve --setup; forget them with: doczi serve --reset",
    "runtime=$Runtime", "port=$Port", "open=$openSetting")
  Write-Host "  Saved to $confFile. Next time it starts with these, without questions."
  if (-not $NoOpen -and -not $Open) { if ($openSetting -eq "yes") { $Open = $true } else { $NoOpen = $true } }
}

# Runtime: this run's flag, else the saved one, else the first installed of Node.js, PHP, Python.
if (-not $Runtime -and $saved.runtime) {
  if ($labels.ContainsKey($saved.runtime)) { $Runtime = $saved.runtime }
  else { Write-Host "The saved runtime `"$($saved.runtime)`" is unknown; using the default." -ForegroundColor Yellow }
}
if ($Runtime -and -not $version) {
  $version = Get-RuntimeVersion $Runtime
  if (-not $version) {
    if ($PSBoundParameters.ContainsKey("Runtime")) { Write-Host "$($labels[$Runtime]) is not installed." -ForegroundColor Yellow; exit 1 }
    Write-Host "$($labels[$Runtime]) is no longer installed; using the default." -ForegroundColor Yellow
    $Runtime = ""
  }
}
if (-not $Runtime) {
  foreach ($k in @("node", "php", "python")) { $version = Get-RuntimeVersion $k; if ($version) { $Runtime = $k; break } }
  if (-not $Runtime) { Write-Host "None of Node.js, PHP or Python 3 is installed. Install one of them and run this again." -ForegroundColor Yellow; exit 1 }
}

# Port: this run's flag (must be free), else the saved one or 4800, moving on when it is busy.
if ($Port -ne 0) {
  if ($Port -lt 1024 -or $Port -gt 65535) { Write-Host "Use a port from 1024 to 65535." -ForegroundColor Yellow; exit 2 }
  if (-not (Test-PortFree $Port)) { Write-Host "Port $Port is in use; try $(Get-FreePort ($Port + 1))." -ForegroundColor Yellow; exit 1 }
} else {
  $wanted = 4800
  if ($saved.port -match "^\d+$" -and [int]$saved.port -ge 1024 -and [int]$saved.port -le 65535) { $wanted = [int]$saved.port }
  $Port = Get-FreePort $wanted
  if ($Port -ne $wanted) { Write-Host "Port $wanted is in use; using $Port." -ForegroundColor Yellow }
}

$openBrowser = if ($NoOpen) { $false } elseif ($Open) { $true } else { $saved.open -ne "no" }
$url = "http://localhost:$Port/"

if (-not $Setup -and -not $saved.Count -and -not $Reset) {
  Write-Host "Using the default settings. To choose the runtime, port and browser: doczi serve --setup"
}
if ($DryRun) {
  Write-Host ("Would serve with {0} on port {1}, {2}." -f $Runtime, $Port, $(if ($openBrowser) { "opening the browser" } else { "without opening the browser" }))
  exit 0
}

$env:DOCZI_PORT = "$Port"
if ($openBrowser) {
  # Opens the page a moment after the server starts, without waiting here.
  Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c", "timeout /t 1 /nobreak >nul & start `"`" `"$url`""
}
switch ($Runtime) {
  "node"   { & node "server/node/server.mjs" --port $Port }
  "php"    { Write-Host "doczi dashboard (PHP $version) at $url - stop with Ctrl+C."; & php -S "127.0.0.1:$Port" "server/php/router.php" }
  "python" { & $script:pythonCmd "server/python/server.py" --port $Port }
}
