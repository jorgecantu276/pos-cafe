# Soporte por GitHub CLI

El soporte usa el repositorio privado `jorgecantu276/pos-cafe` para recibir
diagnósticos y distribuir paquetes Windows revisados. GitHub CLI ya está
instalado en la PC del café; la actualización `99d1675` se instaló mediante
`gh release download` y el actualizador que conserva la configuración y el
diario actuales. No hace falta reinstalar la app para usar este colector.

GitHub CLI necesita ejecutarse en la PC que recoge el diagnóstico. No proporciona
por sí solo una consola remota. Este primer kit se inicia localmente: no instala
un runner, servicio o tarea programada ni ejecuta comandos recibidos en Issues.
El soporte sin intervención necesita instalar un ejecutor local por separado.

## Diagnóstico y envío

Guardar `Diagnostico-POS-Cafe.ps1` y `Soporte-POS-GitHub.ps1` juntos, fuera de la
carpeta de versión. Ejecutar como el usuario de Windows que tiene instalado el
POS y autenticado `gh`.

```powershell
# Primero generar un informe local revisable.
powershell.exe -NoProfile -File .\Soporte-POS-GitHub.ps1

# Enviar a una incidencia nueva del repositorio privado.
powershell.exe -NoProfile -File .\Soporte-POS-GitHub.ps1 -Enviar

# Seguimiento: sustituir el número por una incidencia abierta real.
powershell.exe -NoProfile -File .\Soporte-POS-GitHub.ps1 -Enviar -IssueNumber 123
```

Las rutas predeterminadas corresponden a la instalación existente:

- App: `$env:LOCALAPPDATA\Programs\CarinitoMioPOS`.
- Configuración: `C:\POS-Cafe\private\pos-cafe-config.json`.
- Informes: `$env:LOCALAPPDATA\POSCafeSupport\reports`.

Se pueden pasar `-InstallDirectory`, `-ConfigPath` y `-OutputDirectory` con
rutas explícitas. No cambiar el usuario de Windows para ejecutar el diagnóstico
sin indicar la instalación correcta.

El informe contiene commit/runtime, indicadores de configuración, fechas y
error-presente del respaldo, metadatos del diario/logs, espacio y colas. No
incluye claves, contenido de logs, ventas, nombres/teléfonos de clientes ni
datos fiscales. No abre SQLite, detiene Caja, cambia el sistema o envía papel.
La presencia del archivo de respaldo no certifica su restauración.

Antes de enviar, el script verifica con `gh api` que el destino siga siendo el
repositorio privado esperado. Un seguimiento debe apuntar a una incidencia
abierta, no a un PR. Usa `--body-file` y conserva JSON/texto local. Si se pierde
la respuesta, consultar la incidencia antes de reenviar; no hay reintento ciego.

Desde la PC de soporte:

```powershell
gh issue list --repo jorgecantu276/pos-cafe --state open
gh issue view 123 --repo jorgecantu276/pos-cafe --comments
```

## Actualizaciones y continuidad

Los fixes se preparan y prueban en desarrollo/CI. La caja recibe una release
exacta con hash y actualizador revisado en una ventana acordada; conserva la
versión anterior compatible, configuración privada, respaldos y diario actual
con WAL/SHM. No necesita `git pull`, `npm install`, builds o migraciones
automáticas para soporte ordinario.

La primera revisión confirmó la instalación `99d1675` mediante la salida pegada
por el usuario el 6 de noviembre. `main` solo agrega documentación/CI respecto
a ese runtime. Las diferencias de efectivo se concilian con el negocio; no se
reescriben ventas o cortes para hacerlas desaparecer.

## Verificación

`tests/support-github.test.ts` ejecuta Windows PowerShell con archivos sintéticos,
colas/discos simulados y un `gh` falso. Comprueba que el modo local no transmite,
que los secretos y contenido de logs quedan fuera, que se rechazan repositorios
públicos/PR, que se usa el archivo de cuerpo y que una respuesta perdida conserva
la evidencia y el diario sin reintentar. No conecta a GitHub ni al backend ni
envía papel.

Referencias: [descarga de releases](https://cli.github.com/manual/gh_release_download),
[crear incidencias](https://cli.github.com/manual/gh_issue_create) y
[comentarios](https://cli.github.com/manual/gh_issue_comment).
