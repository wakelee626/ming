@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
echo Open http://127.0.0.1:3210 in your browser after startup.
node --env-file=.env server.mjs
pause
