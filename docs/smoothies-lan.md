# Acceso de POS Smoothies desde Safari en el iPad

La PC conserva el POS, Supabase local, las ventas, las fotos, el recetario y los
respaldos. Safari del iPad opera la misma instalación por HTTPS en la Wi‑Fi del
local. La PC permanece encendida y sin suspensión durante el turno.

## Preparación de una sola instalación

Soporte necesita la **IP privada reservada de la PC** y acceso a esa PC y al iPad.
La IP del iPad no se configura en el servidor. Confirma que comparte la LAN y
registra las versiones de Windows/iPadOS para la aceptación del equipo.
No se pide a la clienta escribir claves de Supabase, editar archivos ni generar
certificados. En los ejemplos, reemplaza `192.168.1.50` por la IP real de esa PC.
El puerto HTTPS es `3443`; solo se cambia con `-LanPort` si existe una necesidad.

1. Reserva esa dirección en el router y confirma que PC e iPad están en la misma
   red privada. Comprueba que no sea una red de invitados con aislamiento entre
   dispositivos. Elige un paquete aceptado, cierra el turno y detén la instalación
   existente mediante su herramienta de soporte antes de actualizarla.
2. Desde la carpeta del paquete, ejecuta un solo instalador:

   ```powershell
   .\Instalar POS Smoothies.cmd -LanAddress 192.168.1.50
   ```

   El instalador valida que la IP pertenece a la PC, genera la autoridad local y
   un certificado HTTPS para esa IP, y conserva la configuración privada en
   `%LOCALAPPDATA%\POS Smoothies`. También muestra el enlace y la huella de la
   autoridad. Una reparación conserva la autoridad y los archivos privados.
3. Acepta deliberadamente la autoridad pública en **ambos equipos**. El archivo
   es `%LOCALAPPDATA%\POS Smoothies\https\authority\Smoothies-iPad-CA.cer`.
   En la PC, abre ese archivo y usa el asistente de certificados del usuario
   actual para colocarla en **Entidades de certificación raíz de confianza**.
   En el iPad, transfiere únicamente ese `.cer`, instala el perfil desde Ajustes
   y activa su confianza completa en **General → Información → Ajustes de
   confianza de certificados**. Comprueba la huella mostrada por el instalador.
   Consulta la [guía oficial de confianza manual de Apple](https://support.apple.com/en-ie/102390).
   No compartas `authority.dpapi`, `server-key.pem` ni el directorio privado.
4. Si el firewall bloquea HTTPS, soporte ejecuta **una regla** desde PowerShell
   elevado en la PC, con la IP/puerto realmente configurados:

   ```powershell
   New-NetFirewallRule -Name 'POS-Smoothies-HTTPS' -DisplayName 'POS Smoothies HTTPS local' -Direction Inbound -Action Allow -Protocol TCP -Profile Private -RemoteAddress LocalSubnet -LocalAddress 192.168.1.50 -LocalPort 3443
   ```

   No repitas la regla si ya existe: consulta `Get-NetFirewallRule -Name
   POS-Smoothies-HTTPS` y revisa sus filtros. No habilites el perfil público, los
   puertos internos de Next/Supabase/PostgreSQL ni reenvío de puertos del router.
   El instalador no cambia el firewall ni la confianza de los equipos.
5. Abre **POS Smoothies** en la PC. En Safari del iPad abre
   `https://192.168.1.50:3443` e inicia sesión con su cuenta. No ignores avisos de
   certificado: revisa la IP reservada, fecha/hora y confianza del certificado.

Las instalaciones anteriores sin configuración de LAN conservan su acceso local.
Para habilitar su iPad se usa el mismo instalador con `-LanAddress`; no se crea
otra base ni se reemplazan sus datos. Las actualizaciones compatibles conservan
la configuración y la confianza privada. La entrega usa una cookie propia de
Smoothies: inicia sesión una vez después de actualizar. No importa datos de otro
navegador.

## Aceptación en los equipos del negocio

Desde el iPad, prueba inicio de sesión, fotos, productos/extras, recetario y una
venta de efectivo. Revisa folio, cambio e inventario guardados en la PC. Cierra y
reabre Safari, reconecta la Wi‑Fi y confirma que no se repitió la venta. Reinicia
la PC y comprueba el acceso desde ambos equipos. Después desconecta internet del
router **sin apagar la Wi‑Fi** y repite el recorrido local. Las impresoras y los
pagos con terminal conservan su aceptación específica; una conexión web no los
califica. Registra el resultado y la identidad del paquete antes de entregar.

## Ficha privada: completar valores sin cambiar código

El paquete incluye `smoothies-site.example.json`. Soporte guarda una copia fuera
del paquete, con nombre `site.json`, y completa los valores reales. `null` significa
pendiente; no se sustituye por una IP, cantidad o resultado inventado. La ficha no
admite contraseñas ni claves de Supabase. La contraseña inicial sigue el flujo
existente del instalador.

Con la IP privada real completada, el mismo instalador acepta la ficha:

```powershell
.\Instalar POS Smoothies.cmd -SiteFile 'C:\ruta-privada\site.json'
```

La ficha contiene versión de Windows, IP de la PC, modelo/iPadOS, puerto HTTPS,
confirmación de red, destino externo de respaldo, datos de impresora y aprobación
del menú/conteos. Solo la IP es necesaria para preparar HTTPS; los demás datos
pendientes siguen visibles y no acreditan una instalación aceptada. No mezcles
`-SiteFile` con parámetros de IP, puerto o destino de respaldo.

El instalador prepara automáticamente una lista privada `aceptacion-*.json`
para esa ficha y ese paquete. La lista deja cada resultado, fecha, responsable
y evidencia pendientes. No sobrescribe una lista existente. Cambiar los datos
de la ficha requiere revisar la aceptación correspondiente.

## Copia externa y diagnóstico

`backup.externalDirectory` identifica una carpeta existente elegida en otro
dispositivo. El instalador conserva esa ruta en la configuración privada. También
puede configurarse mediante `-BackupExportDirectory` al usar parámetros directos.
No se crea una carpeta sustituta si el dispositivo falta.

Después del respaldo local, el POS copia solo el archivo cifrado, comprueba sus
bytes y publica la copia sin reemplazar archivos existentes. La clave de
recuperación permanece separada. En **Configuración → Respaldos** se muestra el
resultado externo por separado: si falla o se desconecta el destino, el respaldo
local continúa disponible. El siguiente ciclo vuelve a intentar la copia actual.
Confirmar que el destino está fuera de esta PC y restaurar una copia siguen
siendo pruebas reales; una ruta y un hash no las sustituyen.

**Diagnóstico POS Smoothies** genera `diagnostico\support-report.json` en la carpeta
privada. Informa identidad del paquete/servidor, vigencia de HTTPS, respaldo local
y copia externa, espacio y estado de actualización/firma. Omite claves,
contraseñas, datos de clientes y rutas privadas. Un informe legible no equivale
a aceptar Safari, impresoras o restauración. El envío remoto requiere su propia
configuración y permanece desactivado mientras falten sus valores.

## Renovación y soporte

El certificado de servidor dura como máximo 365 días. La autoridad privada dura
cinco años y se conserva cifrada con DPAPI para el mismo usuario de Windows.
Antes de vencer el certificado, con el turno cerrado y el POS detenido, ejecuta
desde el paquete aceptado:

```powershell
.\Instalar POS Smoothies.cmd -LanAddress 192.168.1.50 -RenewLanCertificate
```

La renovación prepara un nuevo par de certificado/clave en su propio directorio
y conserva la autoridad y los pares anteriores. No exige instalar otra autoridad
en el iPad. Un cambio deliberado de IP usa el mismo comando con la nueva IP y
requiere revisar la reserva y la regla de firewall. Reabre el POS y comprueba
Safari después del cambio.

Si falta o está dañada la autoridad, cambió el usuario de Windows o la autoridad
está por vencer, conserva los archivos y pide una reinscripción supervisada de
confianza. No borres la carpeta HTTPS para generar otra confianza silenciosamente.
El instalador rechaza configuraciones incompletas o claves que no correspondan.

Para soporte reúne la IP/puerto elegidos, el mensaje exacto, la fecha/hora de ambos
equipos y el diagnóstico del acceso directo **Diagnóstico POS Smoothies**. Los
ajustes `SMOOTHIES_LAN_ORIGIN`, `SMOOTHIES_LAN_CERT_FILE` y
`SMOOTHIES_LAN_KEY_FILE` viven en el archivo privado `caja.env`; Next, la API y
PostgreSQL siguen escuchando solo en loopback. No publiques ese archivo ni claves.

Para ensayar el paquete instalado por HTTPS con datos sintéticos, el mismo
`acceptance-ui.mjs` acepta `POS_TEST_LAN_ORIGIN`. Antes de arrancar Node, configura
`NODE_EXTRA_CA_CERTS` con el archivo público
`https\authority\Smoothies-iPad-CA.pem` del entorno de prueba y acepta esa
autoridad en su navegador. El ensayo no desactiva la validación TLS ni instala
confianza automáticamente. La identidad privada del proceso se verifica por
loopback, aunque el recorrido del navegador use la dirección de la LAN.

## Soporte remoto preparado, con inscripción explícita

El paquete incluye `smoothies-reporting.example.json` desactivado. Los campos de
repositorio, cuenta publicadora, identificador del equipo y huellas de máquina y
backend quedan en `null` hasta obtener evidencia del destino real. Soporte obtiene
las huellas con el dispatcher incluido en modo `-BindingOnly`; la operadora no
elige un hash ni comparte credenciales. El equipo de desarrollo queda excluido.

Después de revisar esa identidad y la autorización de GitHub en la PC del negocio,
soporte completa la copia privada y ejecuta explícitamente
`Install-SmoothiesSupport.ps1`. Ese paso valida cuenta/repositorio privado y crea
la tarea diaria del usuario a las 08:00. Instalar el POS con una ficha de sitio no
ejecuta esa inscripción. La plantilla desactivada tampoco crea una tarea ni envía
un informe. No se guardan tokens en las fichas.

El transporte compartido conserva una sola incidencia y comentario por equipo y
comprueba sus identidades antes de escribir. Un acuse perdido se reconcilia por
su marcador antes de repetir. El primer informe real aún requiere revisión; un
envío exitoso no acredita impresoras, efectivo, restauración ni Safari.

## Ensayo completo del ZIP antes de entregar

La verificación estándar guarda el ZIP de Windows como artefacto candidato con
el commit de origen. Ese ZIP contiene Node, el POS compilado y las herramientas;
conservar el artefacto no publica el canal de actualizaciones.

El trabajo opcional `smoothies-installed-lan` verifica el hash de ese mismo ZIP,
instala en estado sintético vacío y recorre importación, recetas, fotos, venta,
respaldo/restauración, actualización firmada, reinicio y reparación por HTTPS.
Se activa expresamente con `run_installed_acceptance` y necesita un runner
Windows x64 desechable con motor Docker Linux, Edge y GitHub CLI. El runner lleva
la etiqueta `pos-smoothies-acceptance`; nunca se usa la PC del negocio.

Valores pendientes del entorno de ensayo:

| Variable del repositorio | Valor hasta preparar el runner |
| --- | --- |
| `SMOOTHIES_ACCEPTANCE_DISPOSABLE` | Sin configurar; se establece en `1` solo para el equipo desechable revisado |
| `SMOOTHIES_ACCEPTANCE_LAN_ORIGIN` | IP privada y puerto HTTPS reales del runner |
| `SMOOTHIES_ACCEPTANCE_CERT_FILE` | Ruta privada al certificado de esa IP |
| `SMOOTHIES_ACCEPTANCE_KEY_FILE` | Ruta privada a su clave correspondiente |
| `SMOOTHIES_ACCEPTANCE_CA_FILE` | Ruta al CA público aceptado por Node y el navegador del runner |

El ensayo rechaza puertos, contenedores o volúmenes Smoothies existentes y no
borra instalaciones para liberar el entorno. Un trabajo omitido por falta del
runner conserva esa comprobación pendiente. Sus resultados sintéticos tampoco
rellenan la lista de aceptación de los dispositivos del negocio.
