@echo off
setlocal
cd /d "%~dp0"
title Obsidian Cut Studio (Windows Desktop)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-ObsidianCut.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Obsidian Cut exited with status %ERRORLEVEL%.
  pause
)
