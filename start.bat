@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if "%NO_OPEN%"=="" set NO_OPEN=0
node server.mjs
echo.
echo Server stopped. Press any key to close.
pause >nul
