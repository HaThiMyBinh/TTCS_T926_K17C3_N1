@echo off
title Backend Server
cd /d "%~dp0backend"
echo Dang khoi dong Server Backend...
start cmd /k "node server.js"
timeout /t 2 >nul
echo Dang mo trang web...
start "" "%~dp0frontend\index.html"
