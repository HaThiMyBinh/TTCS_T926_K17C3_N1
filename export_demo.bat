@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
if not exist "node_modules" call npm install
call npm run demo:export
pause
