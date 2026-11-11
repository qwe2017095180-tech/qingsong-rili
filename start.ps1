# Start the Qingsong Rili local server on Windows.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[ERROR] Node.js not found. Install Node.js 18+ from https://nodejs.org' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

if (-not $env:NO_OPEN) { $env:NO_OPEN = '0' }
node server.mjs
Read-Host 'Server stopped. Press Enter to close'
