@echo off
title Nexus
cd /d "%~dp0"
where python >nul 2>nul || (echo Python is not installed. Get it from python.org and tick "Add to PATH". & pause & exit /b 1)
start "" http://localhost:8080
python server.py
pause
