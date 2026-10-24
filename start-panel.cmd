@echo off
chcp 65001 >nul
title 每日简报助手 - 本地面板
cd /d "%~dp0"

if not exist "src\serve.mjs" (
  echo [x] 请在仓库根目录运行本脚本
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 未找到 Node.js，需要 18 或更高版本：https://nodejs.org
  pause
  exit /b 1
)

echo.
echo   每日简报助手 - 本地面板
echo   ----------------------------------------
echo   启动后浏览器打开：  http://127.0.0.1:4177
echo   关闭本窗口即停止服务，不留后台进程。
echo.
echo   参数示例：
echo     start-panel.cmd --dry-run     离线演示，不联网
echo     start-panel.cmd --port 8080   换端口
echo.

start "" cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:4177"
node src\serve.mjs %*

echo.
echo 服务已停止。
pause
