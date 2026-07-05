@echo off
title VOTC voice-mode data folder repair
echo ============================================================
echo   VOTC voice-mode: (re)create the fork's data folder
echo ============================================================
echo.
echo This copies your settings and prompts from the installed app
echo into the fork's own data folder (%%APPDATA%%\VOTC-Voice) and
echo installs the starter voice library. Your installed app's data
echo is only READ, never changed.
echo.

set "SRC=%APPDATA%\VOTC"
set "DST=%APPDATA%\VOTC-Voice"

if not exist "%SRC%\votc-llm-config.json" (
    echo PROBLEM: could not find the installed app's data at %SRC%
    echo Nothing was changed.
    pause
    exit /b 1
)

echo Copying settings and votc_data (existing newer files are kept)...
robocopy "%SRC%" "%DST%" votc-llm-config.json /XO /NFL /NDL /NJH /NJS >nul
robocopy "%SRC%\votc_data" "%DST%\votc_data" /E /XO /NFL /NDL /NJH /NJS >nul

echo Installing the starter voice library...
if not exist "%DST%\votc_data\voices" mkdir "%DST%\votc_data\voices"
copy /Y "%~dp0seed\f_adult_neutral_test.wav" "%DST%\votc_data\voices\" >nul
copy /Y "%~dp0seed\f_adult_neutral_test.txt" "%DST%\votc_data\voices\" >nul
copy /Y "%~dp0seed\catalog.json" "%DST%\votc_data\voices\" >nul

echo.
echo Contents of the voice library now:
echo ------------------------------------------------------------
dir /b "%DST%\votc_data\voices"
echo ------------------------------------------------------------
echo.
echo If you see catalog.json and the two f_adult_neutral_test files
echo above, the repair worked. Next: start-tts-server.bat, then
echo test-speak.bat.
echo.
pause
