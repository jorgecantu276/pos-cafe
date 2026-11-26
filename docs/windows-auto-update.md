# Actualizaciones automáticas de Caja en Windows

El acceso directo de Caja abre un lanzador fijo. Con la opción activada, el lanzador consulta cada 15 minutos la última versión estable de GitHub Releases y prepara el ZIP mientras Caja funciona. Al cerrar la ventana de Caja, consulta el estado del turno en Supabase. Si hay un turno abierto, una entrega pendiente, un pago CLIP sin resolver, un trabajo de impresión pendiente o incierto, o no se puede confirmar el estado, conserva la versión actual.

Cuando el servidor de Caja se detiene y Supabase confirma el cierre, el lanzador selecciona la versión preparada para la próxima apertura. Vuelve a consultar el estado antes de abrirla. Si el nuevo servidor no arranca y verifica su identidad, el lanzador abre la versión anterior y registra el intento fallido. El registro está junto a la configuración privada, en `pos-cafe-config.json.update.log`.

Los paquetes se guardan en carpetas separadas. La configuración, el diario de impresión, los respaldos y los archivos privados permanecen en sus rutas externas. El actualizador compara el contrato de base de datos con la versión activa. Si la lista de migraciones o sus hashes difieren, esa versión requiere el procedimiento habitual de mantenimiento.

Durante una actualización manual, apunta el acceso directo al lanzador nuevo. Si la versión del lanzador cambió, la primera apertura confirmada usa ese paquete y desvincula la selección automática anterior. Conserva la carpeta anterior; no reemplaces el diario para volver de versión.

## Preparación inicial

- El equipo necesita un paquete de Windows que incluya el lanzador de esta rama y el acceso directo gestionado por `Open-Caja.ps1`. Ese primer paquete y acceso se habilitan una vez con el procedimiento de mantenimiento. Conserva esa carpeta como punto de entrada de Caja. `Open-POS.cmd` sirve para abrir un paquete directamente durante mantenimiento.
- En el backend correspondiente, la migración `202611250025_windows_update_idle.sql` habilita la consulta de cierre. Usa las credenciales de servicio ya disponibles en la configuración privada del lanzador. El instalador automático nunca ejecuta migraciones.
- La cuenta de Windows que abre Caja necesita `gh.exe` en su PATH con acceso de lectura al repositorio privado. El equipo de publicación guarda la clave privada Ed25519 por separado. Solo la clave pública PEM se copia al equipo del café, fuera de las versiones.
- Configura `PrintDataDirectory` con la ruta absoluta del diario de impresión existente y conserva `RequireExistingPrintJournal: true`. Usa rutas externas al lanzador y a la carpeta de actualizaciones para todos los archivos privados.
- La configuración inicial trae `AutoUpdate: false`. Para habilitarlo se usa `AutoUpdate: true` con `AutoUpdatePublicKeyFile` apuntando a la ruta absoluta de la clave pública. Una vez habilitado, abre Caja con el acceso directo habitual. Para deshabilitar la descarga, deja el acceso fijo y configura `AutoUpdate: false`.

## Publicar una versión apta para actualización

Verifica el paquete de Windows para este negocio con el proceso normal. El responsable de publicación prepara `pos-update.json` indicando los commits completos de las versiones anteriores desde las que se autoriza el salto.

```powershell
node scripts/windows/sign-update.mjs <clave-privada-pem> <carpeta-del-paquete> <POS-Cafe-commit.zip> <pos-update.json> <commit-anterior> [otro-commit-anterior]
```

Adjunta el ZIP original y el manifiesto firmado a la versión estable `pos-<commit-corto>` del repositorio. El actualizador comprueba la firma, el hash del ZIP, la lista firmada de hashes, el negocio de destino y el commit que está en uso. Los paquetes de soporte y las versiones previas quedan fuera de este flujo. Cada versión conservada contiene su propio runtime y dependencias.

Revisa el espacio libre al dar mantenimiento. Las carpetas de versiones se conservan para diagnóstico y recuperación. Conserva la carpeta de inicio y las versiones que el archivo `pos-cafe-config.json.updates/state.json` indique como activas o de recuperación.

## Prueba local

`node --test scripts/windows/auto-update.test.mjs` usa archivos desechables, ZIPs reales de Windows, una clave de prueba y un servidor HTTP en loopback. `npm run test:db` verifica la consulta de cierre en PostgreSQL aislado.

## Recuperación de trabajo anterior y límites

El actualizador se recuperó de la fuente local revisada `13cb0615ae4ee0c0984657944627c38155fc1908` (15 de noviembre), cuyo descendiente `7ea438cd6979f7f3401a944e2efa167804255148` no cambia estos archivos. La integración conserva las versiones actuales de la aplicación y añade únicamente los archivos del actualizador, sus señales de inicio y el empaquetado. No restaura interfaces ni reglas de negocio antiguas.

La migración de consulta se añade como `202611250025_windows_update_idle.sql` para no reescribir la migración 024 ya utilizada por inventario. `CREATE OR REPLACE` admite el antecedente histórico de la función. Debe revisarse y aplicarse deliberadamente al backend correcto con respaldo; el actualizador no aplica SQL. El snapshot actual no acredita que la función esté instalada. Si falta, la activación se detiene.

La activación consulta de nuevo el cierre y lee el diario SQLite en modo de solo lectura. Solo `submitted` y `cancelled` son estados resueltos para este control: una base ausente, ilegible o con trabajos pendientes conserva la versión anterior. `submitted` sigue significando aceptación de envío, no papel físicamente confirmado. El control SQL es una observación de estado, no un bloqueo transaccional contra otras sesiones; la instalación inicial debe establecer el alcance de un solo POS y la ventana de mantenimiento.

La opción `AutoUpdate` permanece desactivada de forma predeterminada. Las credenciales, opciones de Clip, diarios y configuración existentes no se cambian. No activar en el café hasta verificar el dispositivo, la versión instalada real, su backend, el nuevo acceso fijo, la clave pública y el primer reporte. El historial prueba rc.5 instalada; rc.6 publicada no prueba instalación. La afirmación actual del propietario sobre Clip prevalece sobre notas históricas: conservar la configuración observada, no forzar Clip a OFF.

Este lector conserva el contrato histórico de versión estable `pos-<commit-corto>` y ZIP `POS-Cafe-<commit-corto>.zip`, con manifiesto Ed25519 `pos-update.json` y lista explícita de predecesores. El responsable de publicación debe cumplir además el gate común de familia y la aceptación independiente; el firmador no autentica por sí solo una revisión. No se ha publicado ni habilitado ningún canal mediante esta integración.
