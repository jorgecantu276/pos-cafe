#ifndef PackageDir
  #error PackageDir must point to a verified POS release
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef Revision
  #error Revision is required
#endif

[Setup]
AppId=CarinitoMioPOS
AppName=Cariñito Mío POS
AppVersion=1.0+{#Revision}
AppPublisher=Cariñito Mío
DefaultDirName={localappdata}\Programs\CarinitoMioPOS
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Carinito-Mio-POS-Setup-{#Revision}
SetupIconFile=Carinito-Mio.ico
UninstallDisplayIcon={app}\Carinito-Mio.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear el acceso Cariñito Mío POS en el escritorio"

[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userdesktop}\Cariñito Mío POS"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\Open-Caja.ps1"" -ConfigPath ""C:\POS-Cafe\private\pos-cafe-config.json"""; WorkingDir: "{app}"; IconFilename: "{app}\Carinito-Mio.ico"; Tasks: desktopicon

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -Command "if (Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ''' +
      ExpandConstant('{app}\node.exe') + ''' }) { exit 1 }"',
      '', SW_HIDE, ewWaitUntilTerminated, Code) then
  begin
    if Code <> 0 then Result := 'Cierra Cariñito Mío POS antes de instalar esta versión.';
  end
  else Result := 'No se pudo comprobar si Caja sigue abierta.';
end;
