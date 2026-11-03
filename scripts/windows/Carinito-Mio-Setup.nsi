Unicode true
!include "MUI2.nsh"

Name "Cariñito Mío POS"
OutFile "${OutputDir}\Carinito-Mio-POS-Setup-${Revision}.exe"
InstallDir "$LOCALAPPDATA\Programs\CarinitoMioPOS"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "Carinito-Mio.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Spanish"

Section "Cariñito Mío POS"
  SetShellVarContext current
  IfFileExists "$INSTDIR\release.json" 0 unpack
    nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -Command "if (Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq $\'$INSTDIR\node.exe$\' }) { exit 1 }"'
    Pop $0
    Pop $1
    StrCmp $0 "0" unpack
    MessageBox MB_OK|MB_ICONEXCLAMATION "Cierra Cariñito Mío POS antes de instalar." /SD IDOK
    Abort

  unpack:
    SetOutPath "$INSTDIR"
    File /r "${PackageDir}\*"
    CreateShortCut "$DESKTOP\Cariñito Mío POS.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\Open-Caja.ps1" -ConfigPath "C:\POS-Cafe\private\pos-cafe-config.json"' "$INSTDIR\Carinito-Mio.ico" 0 SW_SHOWMINIMIZED
    IfErrors 0 done
    MessageBox MB_OK|MB_ICONSTOP "No se pudo crear el acceso en el escritorio." /SD IDOK
    SetErrorLevel 1
    Quit
  done:
SectionEnd