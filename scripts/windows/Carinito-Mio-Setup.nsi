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
  IfFileExists "$INSTDIR\node.exe" 0 unpack
    ; Check exclusive write access without creating, truncating or writing the file.
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\node.exe", i 0x40000000, i 0, p 0, i 3, i 0x80, p 0) p .r0'
    StrCmp $0 "-1" blocked
    System::Call 'kernel32::CloseHandle(p r0)'
    Goto unpack

  blocked:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Windows no permite actualizar Caja. Cierra la ventana de Cariñito Mío POS y vuelve a ejecutar el instalador." /SD IDOK
    SetErrorLevel 1
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
