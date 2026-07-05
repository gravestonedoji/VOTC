@echo off
title VOTC Voice
cd /d "%~dp0"

REM Refuse to launch while the installed (non-fork) VOTC app is running:
REM both hook the same CK3 game folder and would fight over it.
tasklist /FI "IMAGENAME eq VOTC.exe" 2>nul | find /I "VOTC.exe" >nul
if not errorlevel 1 (
    echo.
    echo   The regular VOTC app is currently running.
    echo   Only one VOTC may run at a time - they share the CK3 hookup.
    echo.
    echo   Please close the regular VOTC app ^(check the system tray too^),
    echo   then double-click this launcher again.
    echo.
    pause
    exit /b 1
)

echo Starting VOTC Voice... the app window appears in a few seconds.
echo The voice service starts automatically inside the app.
echo Keep this window open; closing it stops the app.
echo.
call npm run dev
echo.
echo VOTC Voice has stopped. Press any key to close...
pause >nul
