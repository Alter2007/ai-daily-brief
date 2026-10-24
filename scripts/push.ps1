# scripts/push.ps1 —— 一键推送到 GitHub，自动处理 Windows 的 TLS 后端问题
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\push.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\push.ps1 -Remote origin -Branch main

param(
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [string]$Url = "https://github.com/Alter2007/ai-daily-brief.git"
)

$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

Step "检查仓库状态"
$dirty = git status --porcelain
if ($dirty) {
  Write-Host "工作区有未提交改动：" -ForegroundColor Yellow
  $dirty | ForEach-Object { Write-Host "  $_" }
  Write-Host "先提交再推：git add -A; git commit -m '...'" -ForegroundColor Yellow
  exit 1
}
git -c core.pager=cat log --oneline | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }

Step "检查 remote"
$existing = git remote get-url $Remote 2>$null
if (-not $existing) {
  Write-Host "添加 remote $Remote → $Url"
  git remote add $Remote $Url
} else {
  Write-Host "已存在：$Remote → $existing"
}

Step "尝试推送（默认 TLS 后端）"
$out = git push -u $Remote $Branch 2>&1 | Out-String
Write-Host $out
if ($LASTEXITCODE -eq 0) {
  Write-Host "推送成功 ✓" -ForegroundColor Green
  exit 0
}

if ($out -match "SEC_E_NO_CREDENTIALS|schannel") {
  Step "schannel 报错，改用 OpenSSL 后端重试"
  $out2 = git -c http.sslBackend=openssl push -u $Remote $Branch 2>&1 | Out-String
  Write-Host $out2
  if ($LASTEXITCODE -eq 0) {
    Write-Host "推送成功 ✓（建议永久启用：git config --global http.sslBackend openssl）" -ForegroundColor Green
    exit 0
  }
}

if ($out -match "could not read Username|Authentication failed") {
  Step "需要登录 GitHub"
  Write-Host "请任选一种：" -ForegroundColor Yellow
  Write-Host "  1) git credential-manager github login   （登录一次后重跑本脚本）"
  Write-Host "  2) 用 Personal Access Token 作为密码：设置 → Developer settings → Tokens (classic) → 勾 repo"
  exit 2
}

Write-Host "推送失败，请把上面的完整输出发给我。" -ForegroundColor Red
exit 3
