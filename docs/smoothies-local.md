# POS Smoothies en Windows

El POS, las ventas, el recetario y las fotos del catálogo quedan en la PC de caja. El iPad muestra esa misma pantalla por la red Wi‑Fi.

## Preparar la caja local

1. En una PC Windows x64 instala [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) con el motor Linux de WSL 2. Abre Docker Desktop una vez con la cuenta de Windows de caja y completa su inicio. Ten internet para este paso y para la primera descarga de las imágenes.
2. Descomprime el paquete y abre **Instalar POS Smoothies.cmd**. Cuando te lo pida, crea una contraseña para el usuario `admin` de al menos 12 caracteres. Conserva esa contraseña.
3. Abre **POS Smoothies** desde el escritorio. El acceso directo inicia Docker, reanuda la base local y abre el navegador. La versión instalada incluye su propio Node y la aplicación compilada. El instalador genera la configuración de Supabase, las claves y las rutas de respaldo.

## Abrir la caja a diario

Haz clic en **POS Smoothies** y entra con tu usuario. El servidor arranca en segundo plano al iniciar sesión en Windows y el acceso directo reutiliza el servidor si ya está listo. En la primera instalación, la impresión funciona en modo simulado. Prueba el papel y las colas de la impresora del negocio antes de habilitar la impresión física.

En **Configuración → Respaldos** puedes comprobar el último respaldo automático y descargarlo. La copia cifrada incluye ventas, cortes, recetario, catálogo, conteos, fotos subidas al catálogo y registro local de impresión. Usa **Subir foto** para que se vea y se respalde sin internet. Guarda una copia fuera de la PC y su clave por separado. La clave está en `%LOCALAPPDATA%\POS Smoothies\clave\recuperacion.key`. Antes de apagar la PC al terminar el turno, comprueba que el último respaldo corresponde a ese cierre.

### Actualizaciones automaticas

El instalador deja las actualizaciones activadas para el canal piloto de POS Smoothies. La caja consulta versiones firmadas cada 15 minutos cuando hay internet. Si la conexion falla, conserva la version instalada y permite trabajar con la base local.

La version nueva se descarga aparte mientras la caja funciona. Solo se activa despues de cerrar el turno, confirmar las entregas y resolver pagos o impresiones pendientes. La caja comprueba ese estado cada 10 segundos cuando ya hay un paquete preparado. El servidor cambia de version y la pantalla vuelve a cargar. No se necesita descargar otro instalador para una actualizacion compatible.

La firma del publicador, el producto, el canal, la version y los archivos deben coincidir. La caja no acepta versiones anteriores ni paquetes que cambian el contrato de la base. La configuracion privada, las fotos, los respaldos y los diarios de impresion conservan sus rutas. Si el servidor nuevo no abre correctamente, se recupera la version anterior y esa version fallida no se vuelve a intentar automaticamente. No se restauran copias antiguas de la base ni del diario.

Los registros de soporte estan en `%LOCALAPPDATA%\POS Smoothies\diagnostico\actualizaciones.log`. La clave publica y la politica inicial se guardan en la carpeta privada `actualizaciones`; instalar o descargar otra version no reemplaza esa confianza. Soporte puede pausar nuevas descargas cambiando `enabled` a `false` en `actualizaciones\policy.json` y reiniciando la caja con el turno cerrado. Las actualizaciones que cambian el esquema siguen el procedimiento de mantenimiento con respaldo previo.

### Mantenimiento y recuperacion

- Para reparar el acceso directo de la misma versión, vuelve a ejecutar **Instalar POS Smoothies.cmd**. Las ventas y fotos residen en los volúmenes locales de Supabase. Conserva la carpeta privada `%LOCALAPPDATA%\POS Smoothies`, incluidas las versiones y los respaldos.
- Las versiones compatibles llegan mediante el actualizador. Para una reparacion manual, cierra el turno, comprueba el respaldo y cierra las pestañas de caja. Desde PowerShell ejecuta `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\POS Smoothies\Launch-Smoothies.ps1" -Stop` y abre el instalador revisado. Si esa misma version sigue abierta, el instalador conserva la caja sin modificar sus archivos. Las versiones que cambian el esquema requieren respaldo y migracion por soporte. En el menu **Inicio**, **Diagnostico POS Smoothies** muestra la version, el espacio libre y el estado del respaldo. Los registros estan en `%LOCALAPPDATA%\POS Smoothies\diagnostico`.
- Para recuperar, mantén cerrada la caja y prepara una instancia vacía con el mismo contrato del respaldo. Los comandos de recuperación se ejecutan con el `node.exe` incluido en el paquete y los scripts de su carpeta `app`. Primero ejecuta `prepare-local.mjs --restore-empty` con el archivo `instalacion.env` del destino. Luego ejecuta `restore-local.mjs ARCHIVO.posbackup CLAVE DESTINO.json`. El JSON privado contiene `database` (conexión a `supabase_admin` en el PostgreSQL local), `api` (`http://127.0.0.1:58000`), `serviceKey` (del destino), `printDirectory` (ruta absoluta nueva) y `confirmEmptyTarget` (`RESTORE EMPTY LOCAL POS`). Configura la misma carpeta de impresión al reabrir la caja. Para una copia antigua que contiene solo la base, usa `restore-business.mjs` y conserva por separado los archivos originales.

## Importar el formulario

En **Catálogo → Importar formulario de smoothies**, abre `menu-smoothies.json`, el archivo que se obtiene en **Revisar → Compartir mis datos**. Revisa los productos, sus extras y el tipo de cada extra. Confirma con el formulario completo. Las presentaciones y los extras importados conservan sus identificadores al corregir el formulario. Si dejas de incluir un producto o extra que habías importado, queda inactivo. Reenviar el mismo contenido ya aplicado no lo vuelve a cargar ni restaura una versión anterior.

En **Catálogo → Conteo de apertura**, pulsa **Contar** en cada insumo y registra la cantidad física antes de abrir. Usa `0` cuando hayas confirmado que no hay existencias. La cifra prevista sigue visible como referencia. Si corriges la unidad en el formulario, vuelve a contar ese insumo en la nueva unidad.

En **Catálogo → Extras**, usa **Nuevo extra** o **Editar**, marca los productos en los que lo ofrecerás y guarda. Puedes asignar un extra a un producto inactivo antes de publicarlo. Cuando importas un formulario corregido, las asignaciones de los extras que trae se actualizan con esa versión.

En **Catálogo → Especial de la semana**, elige un smoothie activo y guarda. La tarjeta aparece arriba del menú de caja y abre la preparación. Para rotar el especial, elige otro producto o selecciona **Sin especial**. El vaso toma un color según el nombre del smoothie y la preparación muestra los extras asignados a ese producto.

Abre **Recetario** desde caja y guarda la primera prueba. **Nueva prueba** copia los ingredientes y la preparación anterior para que puedas ajustar cantidades. **Preparar para venta** lleva el nombre y el precio a **Catálogo → Inactivos**. Desde allí puedes revisar la ficha, editarla y activarla. Las pruebas y notas quedan en el recetario.

## Duplicar la pantalla en el iPad

1. En la PC configura un servidor VNC que comparta la sesión de Windows y permita una contraseña de solo lectura, por ejemplo [TightVNC](https://www.tightvnc.com/winst.php). Usa esa contraseña para el iPad. Desactiva el portapapeles y la transferencia de archivos si el servidor ofrece esos controles.
2. Reserva una IP privada para la PC en el router. Limita el acceso entrante al iPad en el perfil privado del firewall de Windows. Si el servidor VNC no cifra la sesión, usa un túnel SSH local y limita VNC al loopback. El router no necesita redirigir puertos.
3. En el iPad, permite el acceso a la red local y crea una [conexión manual en Screens](https://support.edovia.com/en/screens-5/getting-started/connecting) con la IP de la PC y la contraseña de solo lectura. Si usas SSH, la IP de la PC va en los ajustes del túnel y `127.0.0.1` como destino VNC. Abre la caja en el monitor de Windows. El iPad verá esa misma pantalla.

Con los dos equipos en la red del local, desconecta la salida del router a internet sin apagar su Wi‑Fi. Vuelve a conectar el iPad a la pantalla, inicia sesión en la caja y prueba un cobro en efectivo. Comprueba el folio del pedido, el cambio, la persistencia al reabrir y que tocar el iPad no controle Windows. Pausa el espejo antes de abrir el recetario si hay alguien mirando el iPad, porque el espejo muestra toda la sesión. El pago con tarjeta se registra después de aprobarlo en la terminal.
