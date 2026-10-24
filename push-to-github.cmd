@echo off
chcp 65001 >nul
title 推送到 GitHub - ai-daily-brief
cd /d "%~dp0"

echo.
echo   把本地仓库推送到 GitHub：Alter2007/ai-daily-brief
echo   本脚本会自动处理 Windows 上 schannel 的 TLS 报错。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\push.ps1" %*
set CODE=%ERRORLEVEL%

echo.
if "%CODE%"=="0" (
  echo 完成。仓库地址：https://github.com/Alter2007/ai-daily-brief
) else (
  echo 未能完成推送，退出码 %CODE%，请把上面的输出发给我。
)
pause
