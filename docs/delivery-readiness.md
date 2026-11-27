# Entrega del POS

> Scope: inherited shared-source reference. Café-specific examples and dated
> acceptance results below are historical; they are not Smoothies menu, printer,
> provider, rate or deployment defaults. Use [Smoothies progress](products/smoothies.md)
> and [local operation](smoothies-local.md) for this product. No old deployment
> authorization is renewed by this document.


La entrega conserva **CLIP e inventario apagados**. La tarjeta se cobra en la terminal y se confirma manualmente en el POS. No se importan existencias hasta tener los conteos del negocio. El POS anterior se conserva hasta aceptar el reemplazo.

## Correcciones después de la revisión adversarial

- **Comanda telefónica:** cobrar directamente asegura la preparación original aunque el primer cajero haya perdido la respuesta y salido del navegador. **Pedidos por teléfono → Pagados → Comprobar comanda** conserva una recuperación visible. Cada copia usa su identidad original: no se repiten copias aceptadas o inciertas. Una venta cancelada no habilita nuevos envíos.
- **Recuperación de ventas:** una cancelación ya aplicada se reconoce después del corte; una venta manual ya guardada puede recuperar su recibo aunque exista otro CLIP pendiente. Las identidades de CLIP siguen separadas y no se reutilizan para ventas nuevas.
- **Resultados inciertos:** errores de conexión o resolución desconocida conservan la solicitud original en cobro, teléfono, inventario, gastos, corte, apertura y equipo. Un código SQL de cinco caracteres no basta para declarar que una operación fue rechazada.
- **Reactivar:** Catálogo y Equipo permiten ver inactivos y reactivar el mismo ID. La revisión evita que una pestaña vieja sobrescriba cambios; editar un perfil no reactiva a un empleado que otro responsable desactivó.
- **Diario anterior:** la configuración de entrega requiere que exista el diario de impresión indicado. Una ruta equivocada impide arrancar en lugar de crear silenciosamente un diario vacío.

Las pruebas incluyen el contraejemplo telefónico que antes faltaba: guardar con respuesta perdida, salir A, cobrar B sin comprobar antes la comanda, impresora bloqueada, pago confirmado, recuperación desde Pagados y acuse incierto. Los reintentos no agregan una segunda venta ni repiten una copia aceptada.

## Backend y respaldos

El cliente tiene aplicadas las 20 migraciones retenidas hasta **021**. El despliegue de 017–021 tuvo respaldo cifrado previo y posterior; las huellas conservaron las **31 tablas existentes**. Después hay 39 tablas. El inventario permanece apagado; no hubo cargos ni cambio del receptor CLIP.

La migración 021 completa la lectura de la revisión de Equipo mediante la misma política de administrador/propio perfil; no amplía la lectura a columnas privadas. Las 26 comprobaciones nuevas reproducen el error anterior y verifican las proyecciones reales de la UI. La auditoría del navegador ahora rechaza una pantalla con fallo de carga, aunque no tenga infracciones de axe.

El tipo guardado es **16 MXN/USD**. El turno histórico abierto a 18 requiere resolución por el responsable antes de la primera apertura nueva. No se altera retroactivamente ni se inventa un arqueo físico.

El usuario eligió USB/disco externo. Las copias cifradas se verifican por SHA-256 en ese medio; su clave queda separada. No incluir claves, configuración privada ni datos del emisor en GitHub o dentro del ZIP público de versión. Una copia en USB no sustituye acordar quién conserva la clave y dónde se guarda físicamente el medio.

La restauración del respaldo automático se ensaya con `npm run test:restore-business`: esquema compatible, filas y secuencias, relaciones reales, reversión ante fallos, credenciales originales, recuperación de venta, pago al recoger, existencias y corte. La herramienta rechaza un destino con datos y nunca mezcla el respaldo con una caja operando. Auth/sesiones y configuración del proveedor tienen límites explícitos en [respaldos](business-backups.md); las sesiones anteriores no se restauran.

## Paquetes y configuración

Los paquetes del cliente se construyen desde commits revisados y limpios, con su URL/clave pública compiladas y Node portable 24.22.2. El manifiesto y `SHA256.json` identifican cada versión. Un paquete `fixtureOnly: true` es de pruebas y no se entrega para imprimir físicamente.

`scripts/windows/verify-client-release.mjs PAQUETE COMMIT_COMPLETO` comprueba un paquete del cliente reubicado: hashes, arranque, assets, APIs anónimas protegidas y reutilización de instancia. Usa impresión simulada y configuración privada temporal sin clave de servicio; no inicia sesión ni escribe registros en el negocio. El paquete final incluye el restaurador y sus dependencias bajo `backup-tools`, sin instalar npm en caja.

La configuración privada va fuera de las carpetas de versión. Debe tener el destino correcto, emisor aprobado, rutas persistentes de respaldos y la clave separada. **PrintDataDirectory apunta al diario existente del café**, no a una copia vieja ni a los diarios simulados del desarrollador. Con `RequireExistingPrintJournal: true` el arranque rechaza una ruta donde falte `windows-jobs.sqlite`.

## Cambio de versión y vuelta atrás

Conservar una versión corregida, compatible con 021, además del candidato de entrega. El respaldo de versión conserva la corrección telefónica, los bloqueos de pagos inciertos y el editor de equipo protegido. No usar como rollback una versión anterior que omita el control obligatorio o conserve el defecto de comanda.

Para cambiar: resolver ventas/papel inciertos, detener la app, seleccionar la carpeta de versión validada y abrirla con la misma configuración privada y **el diario actual**. No retroceder migraciones, restaurar un diario viejo ni reenviar papel automáticamente. Las variantes `POS_REGISTER_UI=owner` y `prototype` conservan los handlers actuales; un cambio visual no restaura datos.

## Aceptación pendiente en la computadora del café

El desarrollo y las simulaciones no sustituyen esta aceptación. Registrar responsable, versión, resultado y cualquier incidencia:

1. Conservar el POS anterior y verificar el diario existente; revisar copia cifrada y clave separada. Comprobar que el turno anterior quedó conciliado y la apertura usa 16.
2. Abrir/cerrar/reabrir la app sin instalar herramientas. Confirmar cajero, escala/zoom y texto legible en la pantalla 1366×768. Probar con el dedo los controles frecuentes y ventanas de menor altura útil.
3. Comprobar bebida con leche alternativa, nota y cantidad. Probar efectivo, MXN + USD y tarjeta manual, con sus importes/cambio. Las operaciones de aceptación sobre el backend del negocio requieren acuerdo del responsable y anotación de prueba; no lanzar cargos reales automáticamente.
4. Verificar control 30 en cliente y cada taza/continuación de barra. Guardar teléfono sin control, cambiar cajero, cobrar directamente y comprobar recuperación desde Pagados.
5. Revisar ambos papeles y la ausencia de duplicados al reiniciar. Desconectar/reconectar Bluetooth durante una prueba autorizada: inspeccionar la cola antes de reemplazar una copia incierta. Mantener los ajustes aceptados del controlador.
6. Probar pérdida de internet y recuperación de la misma solicitud. La app **no vende offline**; dejar el procedimiento de contingencia y contacto del responsable.
7. Completar corte/entrega, comprobar respaldo y copiarlo al medio externo. Acordar el tiempo máximo de recuperación y la pérdida de datos tolerable.

Ya existe confirmación del usuario para V8 y el seguimiento V9/reference-v2. Lo nuevo pendiente en papel son los controles y los documentos telefónicos desde la app completa. No repetir la afirmación de que nunca se aceptaron las impresoras; ver [registro físico](printer-acceptance-2026-10-31.md).

La aprobación de calidad para publicar exige las pruebas de aplicación, SQL, HTTP/navegador, restauración y paquetes del árbol final. La aprobación para sustituir el POS incluye además los resultados en esta PC, su red y sus dos impresoras.

## Fotos del catálogo

En **Administración → Catálogo → Productos**, abre un producto, elige **Subir foto** y guarda los cambios. Se aceptan archivos JPG, PNG y WebP de hasta 5 MB. La opción **Usar enlace** conserva el flujo anterior y **Quitar foto** recupera la imagen ilustrativa en Caja.

Antes de habilitar la carga en un entorno, aplica la migración 022 en su proyecto de Supabase con Storage activo. Las fotos son públicas por enlace para que Caja pueda mostrarlas, y solo una cuenta de administración puede subir archivos. El respaldo de la base conserva los enlaces. Conserva también una copia de los archivos del bucket catalog-photos para recuperar las fotos si se pierde o cambia el proyecto. Mantén los archivos anteriores mientras algún respaldo pueda referenciarlos.
