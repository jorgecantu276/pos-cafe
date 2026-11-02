# Pedidos por teléfono

Un pedido recibido por teléfono se paga **al recoger**. Se guarda separado de una venta pagada: no suma efectivo, ingresos, compras ni puntos antes del cobro. El contacto del pedido no inscribe automáticamente al cliente en lealtad.

## Operación

1. En **Control de entrega**, debajo del 1–30, elegir **Pedido por teléfono**. No requiere localizador.
2. Añadir productos, leches, notas, nombre y teléfono. **Guardar pedido** conserva el precio MXN aceptado por el servidor.
3. El pedido aparece desde **Pedidos por cobrar** para los cajeros, aunque cambie el turno. El diálogo **Pedidos por teléfono** tiene **Por cobrar** y **Pagados**, con búsqueda y pedidos anteriores. **Comprobar comanda** recupera su preparación aunque el cajero original haya perdido la respuesta o cerrado el navegador; conserva la misma identidad de impresión y sigue disponible después del pago mientras la venta no esté cancelada.
4. Al recoger, abrir el pedido y elegir **Cobrar**. Se usan el turno abierto, su cajero y su tipo de cambio. No se recalcula el precio con el catálogo del día ni se reemplaza otro carrito que tenga abierto el cajero.
5. El cobro enlaza una sola venta con el pedido. Los reintentos recuperan esa identidad; un pago incierto debe comprobarse antes de volver a cobrar o cancelar.

Los pedidos pendientes no bloquean el corte. Un cobro CLIP ya enviado conserva sus bloqueos habituales hasta resolverse. La integración automática CLIP permanece apagada; la tarjeta externa conserva la confirmación manual existente.

## Preparación e impresión

Al guardar se generan el comprobante de pedido y las etiquetas de barra con folio propio **T…**, contacto y **PENDIENTE DE PAGO / SIN PAGAR**. No son un recibo pagado. Cada taza y continuación conserva la identidad del pedido.

La preparación usa la identidad `phone:UUID` en el mismo diario durable, separada de la venta posterior. Los documentos guardados no se actualizan para aparentar un pago. El cobro agrega un recibo pagado del cliente y asegura que exista la preparación original: si ya se envió no la repite; si nunca se creó, la conserva y despacha bajo su identidad original. Esto cubre respuesta perdida, salida del primer cajero y cobro directo por otro sin pulsar antes **Comprobar comanda**. Un fallo de impresión no revierte el pago ni invita a cobrar otra vez. Las entregas inciertas a Windows requieren la revisión habitual, sin reenvío automático.

Cancelar impide nuevos envíos de preparación; una copia ya enviada a Windows no puede retirarse del papel. El cajero debe avisar a barra. Las revisiones de salida en papel siguen disponibles al responsable en **Impresión**.

## Inventario y cancelación

Con inventario activo se reserva al aceptar el pedido. Estas reservas cuentan junto con las de CLIP en disponibilidad, ventas, ajustes y conteos. Al cobrar se consumen una sola vez; un intento CLIP fallido conserva la reserva del pedido.

La cancelación pide un motivo y, cuando hubo reservas, las unidades de cada línea que siguen siendo vendibles. Se liberan esas unidades; el resto se registra como merma. La pantalla exige confirmar la revisión: no presupone que todo lo preparado pueda volver a venderse.

Con inventario apagado no se inventan cantidades ni movimientos. La activación o pausa se bloquea mientras haya pedidos telefónicos pendientes, para evitar cambiar las reglas de existencias de un pedido ya aceptado. No hay vencimiento o cancelación automáticos.

## Datos, recuperación y despliegue

La migración `202611020019_phone_orders.sql` agrega pedidos, solicitudes recuperables, vínculo único a la venta y reservas. Guardar y cancelar conservan una identidad por operación; cobrar usa además el bloqueo global del pedido. Los respaldos nuevos incluyen pedidos, reservas, revisiones y secuencia de folios. Los archivos anteriores a esta migración siguen siendo legibles.

Esta versión requiere las migraciones 017–021, ya desplegadas al cliente después de respaldo y comparación de huellas. Esto no instala el POS en el café ni certifica los nuevos documentos en papel; ver [entrega](delivery-readiness.md).

Verificación: `npm test`, `npm run test:db`, `npm run test:printing` y `POS_BROWSER_QUALITY=1 npm run test:phone-http`. El último ensayo usa una base nueva en loopback 55501/55502, producción aislada en 3112, cuentas ficticias y cola simulada; conserva la vista de prueba existente en 3111.
