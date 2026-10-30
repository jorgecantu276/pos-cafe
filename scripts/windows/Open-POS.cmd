@echo off
setlocal
title Caja - POS Cafe
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-POS.ps1" %*
if errorlevel 1 (
  echo.
  echo La caja no pudo iniciar. Conserva el aviso de arriba y pide ayuda.
  pause
  exit /b 1
)
