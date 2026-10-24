@echo off
chcp 65001 >nul
title Push to GitHub - ai-daily-brief
cd /d "%~dp0"

echo.
echo   Push local repo to GitHub: Alter2007/ai-daily-brief
echo   Handles the schannel TLS error on Windows automatically.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\push.ps1" %*
set CODE=%ERRORLEVEL%

echo.
if "%CODE%"=="0" (
  echo Done. https://github.com/Alter2007/ai-daily-brief
) else (
  echo Push did not finish, exit code %CODE%. Copy the output above and send it over.
)
pause
