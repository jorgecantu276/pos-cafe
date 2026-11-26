# Revisión de integración y preparación

> Scope: inherited shared-source reference. Café-specific examples and dated
> acceptance results below are historical; they are not Smoothies menu, printer,
> provider, rate or deployment defaults. Use [Smoothies progress](products/smoothies.md)
> and [local operation](smoothies-local.md) for this product. No old deployment
> authorization is renewed by this document.


Fecha: **2 de noviembre de 2026**, America/Matamoros. Alcance: UI actual, CLIP, controles 1–30, inventario y pedidos por teléfono con pago al recoger; migraciones 017–021 y preparación de entrega.

## Dictamen

**Apto para integrar en `main` con CLIP apagado, sujeto a CI del PR.** Las pruebas locales y el despliegue del backend no equivalen a instalar o aceptar la nueva app en la PC del café.

**No activar el cobro automático CLIP todavía.** Faltan la habilitación efectiva de PinPad, el token privado, la configuración de la app instalada y una transacción real de aceptación autorizada. El receptor desplegado no inicia cargos.

El inventario de la rama anterior está integrado en Catálogo, con activación inicial apagada, reservas CLIP y devoluciones explícitas. **017–021 ya están desplegadas al cliente, con respaldo previo/posterior y huellas conservadas de las 31 tablas existentes.** El control 1–30 se exige en mostrador; el pedido por teléfono persistido permite preparar sin pagar y cobrar al recoger sin control. Ver [pedidos por teléfono](phone-orders.md), [inventario](inventory.md) y [calidad frente a benchmarks](quality-review.md).

## Conexiones revisadas

| Flujo | UI → backend → resultado | Evidencia / límite |
| --- | --- | --- |
| Pedido y edición | Cantidad, extras y notas se aplican juntos al guardar. Borrador por cajero/turno. | Componentes reales y restauración tras recarga; no es una cola de ventas offline. |
| Venta manual | `pos_checkout` valida actor, turno, precios, extras, cliente y recibido; venta/comprobante/puntos en una transacción. | PostgreSQL, UI y Auth/PostgREST sintéticos. La misma identidad recupera el mismo comprobante. |
| Caja y corte | Resumen autoritativo, gastos con diario y corte recuperable; administración consulta al cajero realmente activo. | Concurrencia y revisión de diferencias probadas; aceptación de la app completa en la PC pendiente. |
| Entrega de caja | El saliente cuenta/elige al receptor; el entrante se autentica y confirma recibido. | Una caja física, permisos y pruebas touch del cierre. |
| Catálogo y favoritos | Guardado recuperable, desactivación/reactivación con el mismo ID; caja detecta el cambio de menú. | Migraciones 013/020; revisión, replay, respuestas perdidas y actualización explícita de precios. |
| Clientes | Alta, corrección, compras paginadas y artículos/modificadores guardados. | Migración 014; venta, historial y reversión de puntos al cancelar. Canje sin regla nueva. |
| Control 1–30 | Selección obligatoria en mostrador → payload → `orders.pager_number`/snapshot → cliente y cada taza/continuación. | Migraciones 015/018/019; la excepción requiere un pedido telefónico persistido. La siguiente orden vuelve a mostrador y las recuperaciones históricas se conservan. Base física manual. |
| Teléfono / pago al recoger | Guardado separado de venta, reserva y preparación sin pagar → cola compartida → cobro único con precio acordado y turno actual. | Migraciones 019/020 desplegadas; recuperación de preparación desde Pagados y cobro directo sin comanda previa, conservando identidades y bloqueos de impresión. |
| CLIP | Cotización congelada → claim persistido → un POST → GET autenticado → liquidación atómica → diario de impresión. | Migración 016; proveedor simulado con PostgreSQL real. Apagado, sin token real ni aceptación bancaria. |
| Receptor CLIP | Nonce por solicitud; guarda una pista del identificador; no aprueba ventas. | Función v1 ACTIVE en el cliente. HTTP/permisos comprobados sin crear pagos. |
| Inventario | Configuración apagada → activación explícita → conteo/CSV → descuento atómico → devolución parcial auditada. CLIP reserva antes de cobrar. | Migración 017 desplegada, apagada; permisos, concurrencia, respuestas perdidas, Auth/PostgREST y conteo cero ensayados con datos sintéticos. Sin cantidades heredadas. |
| Impresión | Snapshot confirmado → USB/Bluetooth independientes, con estado persistente por copia. | Render y pruebas HTTP; aceptación física anterior documentada. El control nuevo está probado en render, no en papel del café. |
| Equipo / respaldos | API/perfil con permisos de administrador; snapshot cifrado y clave fuera del respaldo. | Pruebas de autorización, fallos parciales y recuperación. La configuración privada y el resguardo real aún requieren instalación. |

Código: [checkout](../lib/checkout.ts), [CLIP](../lib/clip-server.ts), [RPC financieras](../supabase/migrations/202611020016_clip_payments.sql), [receptor](../supabase/functions/clip-webhook/index.ts), [documentos](../lib/sale-printing.ts) y [catálogo](../lib/catalog-management.ts).

## Evidencias

| Verificación | Resultado registrado |
| --- | --- |
| `npm test` | Pruebas del commit: UI real, recuperación, teléfono entre turnos, inventario, CLIP, controles y render Windows. |
| `npm run test:db` | 2,792 comprobaciones; incluye 121 de teléfono, control presencial, recuperación histórica, inventario apagado/activo, reservas CLIP y gateway con proveedor simulado. |
| TypeScript y lint | Sin errores ni advertencias. |
| Producción / paquete Windows | Build aislado y paquete reubicado; verificar el manifiesto y las huellas del candidato exacto, sin reutilizar cifras de otro paquete. |
| Dependencias | Auditorías completas y de runtime: 0 vulnerabilidades al revisar este cambio. |
| Auth/PostgREST y app HTTP | `npm run test:admin-http`: cuatro áreas, roles, pager y CLIP apagado, en una instancia nueva con API/DB 55481/55482 y app 3111. No reutiliza la vista previa existente. |
| SQL → impresión HTTP | Seis comprobantes después de las 16 migraciones retenidas, inventario activo y control 30; mismo snapshot en endpoints/impresoras simulados, sin descontar dos veces. |
| GitHub CI | **Windows verification** ejecuta los checks Windows y **Auth and backend integration** repite el ensayo Auth/PostgREST sobre un backend local desechable. Consultar ambos jobs del PR y del commit en `main`. |

Los ensayos usan datos sintéticos y proveedor/impresoras simulados. No se hicieron cargos bancarios ni se envió papel durante estas verificaciones. La [aceptación física anterior](printer-acceptance-2026-10-31.md) no prueba por sí sola cada cambio nuevo.

La revisión encontró y corrigió un rechazo incorrecto en el POST de CLIP cuando Next normaliza la URL interna a `localhost` y el navegador accede por `127.0.0.1`. La validación usa la autoridad de `Host`, como el API de impresión. Las pruebas mantienen el rechazo de origen ausente o ajeno y comprueban que una solicitud válida, con CLIP apagado, devuelve 503 sin escribir un intento ni contactar al proveedor.

## Backend ya desplegado

Se verificaron el enlace CLI y el destino privado del cliente; no se migró el backend histórico de `.env.local`.

- Las 20 migraciones retenidas están sincronizadas; el último despliegue agrega **017–021** con huellas verificadas de las 31 tablas previas. El dry-run posterior no encuentra pendientes.
- `clip-webhook` v1 está activo. La excepción de JWT corresponde solo a ese receptor con nonce; no abre las RPC financieras al navegador.
- GET devuelve 405; sin nonce, 400; una solicitud/nonce desconocidos devuelve 200 sin guardar pagos ni pistas.
- Solo el servicio puede liquidar CLIP; anónimos/autenticados no pueden aprobar pagos ni leer el diario privado.
- El despliegue 013–016 preservó las 28 tablas que existían entonces. El posterior 017–021 tuvo sus propios respaldos cifrados previo/posterior y preservó las **31 tablas existentes**; después hay 39 tablas. Venta, 82 productos, snapshots y configuración se conservan.
- CLIP permanece **apagado**, el token sigue como placeholder y las tablas de pagos/pistas están vacías. No se cambió la app/configuración de la PC del café.

Ver [registro de despliegue](clip-payments.md#authorized-cloud-deployment--november-2-2026).

## Condiciones para operar en el café

1. Preparar la versión Windows con el destino privado correcto del cliente. El paquete de loopback solo sirve para pruebas.
2. Conservar POS anterior, configuración del emisor, ventas, respaldos y diario/auditoría de impresión. No restaurar un diario viejo ni reenviar documentos para aplicar formatos.
3. Preparar rutas persistentes, claves, copia fuera de la PC y recuperación del responsable. Las restauraciones aisladas pasan; el resguardo real debe quedar operativo.
4. Comprobar inicio/reinicio, escala touch, rendimiento, red y ambos destinos de impresión con la app completa en esa PC. No cambiar automáticamente los ajustes aceptados de los controladores.
5. Comprobar en papel el control del cliente/barista y la entrega/activación/devolución de localizadores físicos.
6. Mantener tarjeta manual y CLIP apagado si su habilitación/token no están listos. La activación automática corresponde a una aceptación posterior.

## Pendientes declarados

No se presentan como terminados:

- Catálogo y Equipo ya permiten ver inactivos y reactivar con el mismo ID, revisión y solicitud recuperable.
- Búsquedas de Ventas/Clientes con espera breve al escribir; se conservan la cancelación de solicitudes y la protección contra respuestas obsoletas.
- Registrar los conteos reales al activar inventario; al entregar permanece apagado. Compartir existencias entre paquetes/sueltos, ingredientes y convertir pasteles a rebanadas requieren reglas posteriores del negocio.
- Definir el canje de puntos con el dueño. No se inventó una regla ni se implementó el módulo de cupones retirado.

## Recuperación y rollback

Ante CLIP incierto, conservar intento, referencia y turno. No enviar otro POST para compensar un timeout. Un aviso tardío o la consulta del responsable puede recuperar el mismo pago. Deshabilitar CLIP no elimina solicitudes; su recuperación usa el token privado cuando esté disponible.

Cancelar en el POS no reembolsa CLIP. Un pago parcial, respuesta incoherente o impresión incierta requiere revisión; no se marca éxito para desbloquear la interfaz.

El rollback visual `POS_REGISTER_UI=owner` o `prototype` conserva los handlers actuales. No deshacer migraciones ni volver al checkout antiguo sin restricciones. Conservar los diarios y reconciliar operaciones posteriores antes de recuperar datos. Ver [instalación](windows-deployment.md) y [respaldos](business-backups.md).
