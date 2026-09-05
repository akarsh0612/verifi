@echo off
title Verifi - Auto-Sync .env Watcher
echo ==================================================
echo   Verifi - Live .env File Watcher
echo ==================================================
echo Any time you save .env, config.js updates automatically!
echo.
python "%~dp0util\watch_env.py"
pause
