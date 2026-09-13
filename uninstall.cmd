@echo off
setlocal
set "DIR=%USERPROFILE%\.commandcode\mods\commandcode-turn-notify"
if exist "%DIR%" rmdir /s /q "%DIR%"
reg delete "HKCU\Software\Classes\AppUserModelId\CommandCode" /f >nul 2>&1
echo [OK] Removed mod folder and notification identity.
echo Restart Command Code if it is running.
pause
