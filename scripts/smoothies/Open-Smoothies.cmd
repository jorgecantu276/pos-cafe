@echo off
setlocal
set "settings=%~1"
if not defined settings set "settings=%LOCALAPPDATA%\POS Smoothies\caja.env"
if not exist "%settings%" (
  echo Falta el archivo de configuracion de POS Smoothies.
  pause
  exit /b 1
)
node --env-file="%settings%" "%~dp0start-local.mjs" open
if errorlevel 1 (
  echo No se pudo abrir POS Smoothies. Muestra este mensaje a quien preparo la caja.
  pause
  exit /b 1
)
