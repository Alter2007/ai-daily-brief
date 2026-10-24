# scripts/push.ps1 -- push this repo to GitHub.
# ASCII-only messages on purpose: a UTF-8 script without BOM gets read as ANSI by
# Windows PowerShell 5.1 and Chinese literals turn into noise (see git history).
param(
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [string]$Url = "https://github.com/Alter2007/ai-daily-brief.git"
)

$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

Step "Checking working tree"
$dirty = git status --porcelain
if ($dirty) {
  Write-Host "Uncommitted changes:" -ForegroundColor Yellow
  $dirty | ForEach-Object { Write-Host "  $_" }
  Write-Host "Commit first: git add -A; git commit -m '...'" -ForegroundColor Yellow
  exit 1
}
git -c core.pager=cat log --oneline | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }

Step "Checking remote"
$existing = git remote get-url $Remote 2>$null
if (-not $existing) {
  Write-Host "Adding remote $Remote -> $Url"
  git remote add $Remote $Url
} else {
  Write-Host "Remote: $Remote -> $existing"
}

Step "Pushing (default TLS backend)"
$out = git push -u $Remote $Branch 2>&1 | Out-String
Write-Host $out
if ($LASTEXITCODE -eq 0) {
  Write-Host "Push succeeded." -ForegroundColor Green
  exit 0
}

if ($out -match "SEC_E_NO_CREDENTIALS|schannel") {
  Step "schannel failed, retrying with OpenSSL backend"
  $out2 = git -c http.sslBackend=openssl push -u $Remote $Branch 2>&1 | Out-String
  Write-Host $out2
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Push succeeded with OpenSSL backend." -ForegroundColor Green
    Write-Host "To make it permanent: git config --global http.sslBackend openssl" -ForegroundColor DarkGray
    exit 0
  }
}

if ($out -match "could not read Username|Authentication failed") {
  Step "GitHub login required"
  Write-Host "Run one of these, then retry:" -ForegroundColor Yellow
  Write-Host "  1) git credential-manager github login"
  Write-Host "  2) use a Personal Access Token as the password (Settings -> Developer settings -> Tokens)"
  exit 2
}

Write-Host "Push failed. Copy the full output above." -ForegroundColor Red
exit 3
