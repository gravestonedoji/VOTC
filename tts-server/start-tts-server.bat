@echo off
title VOTC TTS Service
echo ============================================
echo   VOTC voice-mode TTS service
echo   Close this window to stop the service.
echo ============================================
echo.
cd /d "%~dp0"
python server.py
echo.
echo The TTS service has stopped. Press any key to close...
pause >nul
