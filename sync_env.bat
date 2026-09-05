@echo off
title Verifi - Sync .env to Extension
echo ==================================================
echo   Verifi - Syncing .env to Extension Configuration
echo ==================================================
python "%~dp0util\sync_env.py"
echo.
echo Press any key to exit...
pause >nul
