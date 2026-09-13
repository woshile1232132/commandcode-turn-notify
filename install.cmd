@echo off
setlocal
set "SRC=%~dp0commandcode-turn-notify"
set "DST=%USERPROFILE%\.commandcode\mods"
set "CLI="
where commandcode >nul 2>&1 && set "CLI=1"

if not exist "%SRC%\index.mjs" (
  echo [ERROR] commandcode-turn-notify folder not found next to this script.
  pause
  exit /b 1
)

if defined CLI (
  echo [OK] Command Code CLI detected:
  call commandcode --version 2>nul
) else (
  echo [WARN] Command Code CLI not found on PATH.
  echo         The mod will be installed anyway and take effect
  echo         once the CLI is installed.
)

if not exist "%DST%" mkdir "%DST%"
xcopy "%SRC%" "%DST%\commandcode-turn-notify\" /e /i /y >nul
echo [OK] Copied to %DST%\commandcode-turn-notify

if defined CLI (
  call commandcode mods list 2>nul | findstr /c:"commandcode-turn-notify" >nul
  if errorlevel 1 (
    echo [WARN] Copied, but the CLI does not list commandcode-turn-notify yet.
    echo        Restart Command Code, then check: commandcode mods list
  ) else (
    echo [OK] Verified: the CLI reports commandcode-turn-notify as a loaded mod.
  )
)
echo.
echo Done. Restart Command Code to load the mod.
pause
