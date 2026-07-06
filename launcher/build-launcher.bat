@echo off
REM Rebuilds "VOTC Voice.exe" in the repo root from launcher.cs,
REM using the C# compiler that ships with Windows (.NET Framework 4).
cd /d "%~dp0"
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe ^
  /out:"..\VOTC Voice.exe" /win32icon:"..\build\icon.ico" ^
  /reference:System.Windows.Forms.dll launcher.cs
if errorlevel 1 (
    echo Build failed.
) else (
    echo Built "VOTC Voice.exe" in the repo root.
)
pause
