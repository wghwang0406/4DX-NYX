@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 이상이 필요합니다 - https://nodejs.org & pause & exit /b 1)
node start.mjs
pause
