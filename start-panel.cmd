@echo off
chcp 65001 >nul
title AI Daily Brief - Panel
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\panel.ps1" %*
