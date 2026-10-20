@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" start_team_demo.py %*
  goto finished
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 start_team_demo.py %*
  goto finished
)
where python >nul 2>nul
if not errorlevel 1 (
  python start_team_demo.py %*
  goto finished
)
echo Python 3.10 or newer was not found. Install Python from python.org (Add Python to PATH), then retry.
pause
exit /b 1
:finished
if errorlevel 1 (
  echo Launch failed. Copy the last error lines for your technical teammate.
  pause
exit /b 1
)
exit /b 0
