@echo off
setlocal
set "ORBIT_PS=powershell.exe"
where "%ORBIT_PS%" >nul 2>&1
if errorlevel 1 set "ORBIT_PS=pwsh.exe"
where "%ORBIT_PS%" >nul 2>&1
if errorlevel 1 (
  echo PowerShell was not found. Install Windows PowerShell or PowerShell 7, then run this installer again.
  pause
  exit /b 1
)
"%ORBIT_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
set "ORBIT_EXIT=%ERRORLEVEL%"
if not "%ORBIT_EXIT%"=="0" (
  echo.
  echo Orbit installation did not complete. Review the message above.
  pause
)
exit /b %ORBIT_EXIT%
