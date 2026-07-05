@echo off
title VOTC TTS smoke test
cd /d "%~dp0"
python test_speak.py
echo.
pause
