# Soporte por GitHub CLI

El soporte usa el repositorio privado `jorgecantu276/pos-cafe` para recibir
diagnósticos y distribuir paquetes Windows revisados. GitHub CLI ya está
instalado en la PC del café; la actualización `99d1675` se instaló mediante
`gh release download` y el actualizador que conserva la configuración y el
diario actuales. No hace falta reinstalar la app para usar este colector.

GitHub CLI necesita ejecutarse en la PC que recoge el diagnóstico. No proporciona
por sí solo una consola remota. El kit automático instala una tarea local una
sola vez y luego publica el estado sin intervención. No ejecuta comandos
recibidos en Issues ni transforma la caja en un runner de builds.

## Monitor automático

Ejecutar una vez `Instalar-Soporte-GitHub.ps1` desde el kit verificado, como el
usuario de Windows que tiene instalado Caja y autenticado GitHub CLI. Admite
`-InstallDirectory`, `-ConfigPath`, `-SupportHome` y `-Device` para rutas/alias
explícitos. No requiere crear tokens ni escribir contraseñas de GitHub en
archivos: utiliza el inicio de sesión que ya tiene `gh`.

Instala los scripts en `%LOCALAPPDATA%\POSCafeSupport\agent-v2`, configuración
sin secretos en `settings-v2.json` y estado local en `state-v2`. La tarea
`POSCafe-GitHub-Support-cafe-caja-01` corre al iniciar sesión y cada 15 minutos,
como el usuario actual con privilegios limitados. No cambia la app o su diario.
La PC necesita estar encendida, conectada y con esa sesión de Windows iniciada;
puede estar bloqueada. Cerrar sesión o apagarla interrumpe el reporte hasta
volver a iniciar sesión. La tarea tiene límite de cinco minutos y evita
instancias simultáneas; un bloqueo local también impide dos ciclos en paralelo.

El primer ciclo crea una incidencia identificada por equipo y un comentario de
estado. Los siguientes editan ese mismo comentario; no generan una incidencia
por ciclo ni reemplazan notas ajenas. Verifica repositorio privado, cuenta que
publica, autor, marcadores y pertenencia del comentario. Si se pierde una
respuesta de creación, el siguiente ciclo busca el marcador antes de crear.
No ejecuta instrucciones escritas en títulos, cuerpos o comentarios.

Cada captura queda primero en `pending-report.json`. Una caída de red conserva
el último estado local y la fecha de éxito anterior; la siguiente ejecución
recoge y envía el estado más reciente. No es un archivo histórico de todas las
capturas. GitHub muestra avisos por respaldo sin confirmar/mayor a 26 horas,
error de respaldo, versión/configuración/diario/impresoras sin comprobar y menos
de 5 GiB libres. El informe muestra la hora UTC: más de 45 minutos sin reporte
requiere revisar PC, conectividad, sesión o tarea. No hay todavía un servicio
externo que envíe una notificación si la PC deja de reportar.

El monitor es de diagnóstico: no reinicia, imprime, cobra, aplica migraciones
o actualiza el POS. Las actualizaciones siguen el paquete/hash/rollback
revisados y una ventana de mantenimiento. El canal queda listo para revisar
desde soporte sin una persona recogiendo manualmente cada informe.

El instalador genera un informe inicial y devuelve la URL. Si el primer envío
no se confirma pero se registró la tarea, informa ese estado y reintenta en
el próximo ciclo. Una tarea o versión local ajena nunca se sobrescribe.
Para detener el monitor, deshabilitar su tarea en Windows; conservar el estado
si se reinstala. Esto no detiene el POS ni cambia sus respaldos.

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
error-presente del respaldo, metadatos del diario/logs, espacio y colas. También
compara la identidad del servidor local con la guardada por el launcher, sin
transmitir el token de instancia. Un servidor cerrado se informa como tal;
no se presupone que deba permanecer abierto fuera del horario del café. No
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

También comprueba ciclos automáticos, respuestas perdidas al crear incidencia
y comentario, un solo comentario de estado, bloqueo entre ciclos, identidad del
publicador, rechazo de notas ajenas, XML interpretado por Windows Task Scheduler
sin registrar una tarea real y un instalador con Scheduler simulado. Comprueba
instalación fuera de Caja, repetición idempotente y rechazo de tareas ajenas.

Referencias: [descarga de releases](https://cli.github.com/manual/gh_release_download),
[crear incidencias](https://cli.github.com/manual/gh_issue_create) y
[comentarios](https://cli.github.com/manual/gh_issue_comment).
