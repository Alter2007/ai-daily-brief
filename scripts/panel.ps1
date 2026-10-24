# scripts/panel.ps1 -- start the local panel and open the browser once the port answers.
# Called by start-panel.cmd. ASCII-only on purpose: cmd/PowerShell codepage issues
# would otherwise break Chinese literals (see git history).
param(
  [int]$Port = 4177,
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

# --- 1. node present? ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say "[x] Node.js not found. Install Node 18+ first: https://nodejs.org" 'Red'
  Read-Host "Press Enter to exit"
  exit 1
}
Say ("    node  : " + $node.Source)
Say ("    root  : " + $root)

# --- 2. files present? ---
if (-not (Test-Path "src\serve.mjs")) {
  Say "[x] src\serve.mjs missing -- run this from the repo root." 'Red'
  Read-Host "Press Enter to exit"
  exit 1
}

# --- 3. start server ---
$nodeArgs = @("src/serve.mjs", "--port", "$Port")
if ($DryRun) { $nodeArgs += "--dry-run" }

Say ""
Say ("    starting panel on http://127.0.0.1:$Port ...") 'Cyan'

$proc = Start-Process -FilePath $node.Source -ArgumentList $nodeArgs -NoNewWindow -PassThru
if (-not $proc) {
  Say "[x] failed to launch node." 'Red'
  Read-Host "Press Enter to exit"
  exit 1
}

# --- 4. wait until the port answers, then open the browser ---
$url = "http://127.0.0.1:$Port"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    $client = New-Object Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', $Port)
    $client.Close()
    $ready = $true
    break
  } catch { }
  if ($proc.HasExited) { break }
}

if ($ready) {
  Say "    ready, opening panel window ..." 'Green'
  $browsers = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  ) | Where-Object { Test-Path $_ }

  $opened = $false
  foreach ($b in $browsers) {
    try {
      # --app opens a chromeless window: no address bar, no tabs, looks like a desktop app
      Start-Process -FilePath $b -ArgumentList "--app=$url", "--window-size=1440,900"
      $opened = $true
      break
    } catch { }
  }
  if (-not $opened) {
    Say "    no Chrome/Edge found, using the default browser" 'DarkGray'
    Start-Process $url
  }
} else {
  Say "[x] server did not come up. Last output above shows why." 'Red'
}

# --- 5. keep running until node exits ---
Say ""
Say "    Close this window or press Ctrl+C to stop the panel." 'DarkGray'
Wait-Process -Id $proc.Id -ErrorAction SilentlyContinue
Say "    panel stopped." 'DarkGray'
Read-Host "Press Enter to exit"
