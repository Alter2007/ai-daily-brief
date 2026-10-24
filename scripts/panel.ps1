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

# Hidden launch has no visible console: surface failures in a dialog and a log file
function Fail($msg) {
  try { Add-Content -Path (Join-Path $root 'panel.log') -Value ((Get-Date).ToString('s') + '  ' + $msg) } catch { }
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'AI Daily Brief') | Out-Null
  } catch { }
  exit 1
}

# --- 1. node present? ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail "Node.js not found.`n`nInstall Node 18+ from https://nodejs.org, then click the shortcut again."
}
Say ("    node  : " + $node.Source)
Say ("    root  : " + $root)

# --- 2. files present? ---
if (-not (Test-Path "src\serve.mjs")) {
  Fail "src\serve.mjs not found.`n`nMake sure the repository folder was not moved or deleted."
}

# --- 3. already running? just open the window ---
$already = $false
try {
  $probe = New-Object Net.Sockets.TcpClient
  $probe.Connect('127.0.0.1', $Port)
  $probe.Close()
  $already = $true
} catch { }

$url = "http://127.0.0.1:$Port"

function Open-Panel($url) {
  $browsers = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  ) | Where-Object { Test-Path $_ }
  foreach ($b in $browsers) {
    try {
      Start-Process -FilePath $b -ArgumentList "--app=$url", "--window-size=1440,900"
      return $true
    } catch { }
  }
  try { Start-Process $url; return $true } catch { return $false }
}

if ($already) {
  Say ("    panel already running on $url - opening window") 'Green'
  Open-Panel $url | Out-Null
  exit 0
}

# --- 4. start server (hidden: this process owns the lifetime) ---
$nodeArgs = @("src/serve.mjs", "--port", "$Port")
if ($DryRun) { $nodeArgs += "--dry-run" }

Say ""
Say ("    starting panel on $url ...") 'Cyan'

$proc = Start-Process -FilePath $node.Source -ArgumentList $nodeArgs -WindowStyle Hidden -PassThru
if (-not $proc) {
  Fail "Failed to start the local server (node did not launch)."
}

# --- 5. wait until the port answers, then open the window ---
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
  Open-Panel $url | Out-Null
} else {
  Say "[x] server did not come up." 'Red'
}

# --- 6. stay alive as the server's parent; exit when node exits ---
Wait-Process -Id $proc.Id -ErrorAction SilentlyContinue
