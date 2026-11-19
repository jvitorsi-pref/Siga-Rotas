@echo off
setlocal
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=ensure"
shift
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0siga-node.ps1" -Action "%ACTION%" %*
exit /b %errorlevel%
