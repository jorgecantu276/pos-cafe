# Inventario de productos terminados

> Scope: inherited shared-source reference. Café-specific examples and dated
> acceptance results below are historical; they are not Smoothies menu, printer,
> provider, rate or deployment defaults. Use [Smoothies progress](products/smoothies.md)
> and [local operation](smoothies-local.md) for this product. No old deployment
> authorization is renewed by this document.


Integrado en **Catálogo → Inventario**, conservando las cuatro áreas principales de administración. Requiere `202611020017_inventory.sql`, después de las migraciones 001–016 retenidas. La migración 006 de la rama anterior no se publica: ese número ya corresponde a lealtad.

**Estado inicial: apagado.** La integración y las pruebas se realizaron localmente. La observación inicial anterior no acredita el estado de ningún backend actual; consultar el historial del destino antes de aplicar migraciones. Instalar esta app requiere aplicar primero su contrato de base de datos; publicar en GitHub no lo despliega.

## Activación y operación

- Apagado: vender no consulta ni descuenta existencias. Se pueden preparar productos, unidades y mínimos. No se reutilizan las cantidades del POS anterior.
- Activar o pausar requiere administrador y confirmación explícita. La operación queda registrada con identidad y revisión para recuperar respuestas inciertas. No se cambia automáticamente al importar datos.
- Al activar, los conteos previos quedan **Sin contar**: importar o registrar un conteo físico actualizado después de activar. Así no se reutilizan cantidades anteriores a ventas realizadas mientras estaba apagado.
- Disponibilidad: marcar **Disponible / Agotado** sin inventar cantidades.
- Conteo: total físico, entradas y mermas con motivo; unidades pieza, rebanada, pastel, botella, lata o paquete. Cantidades enteras, incluyendo cero. Entradas y mermas requieren un conteo inicial.
- **Sin contar** permite vender sin asumir una cantidad. Después del primer conteo, cero bloquea la venta y cada venta descuenta sus unidades dentro de la misma transacción.
- Caja actualiza disponibilidad al cargar, al volver a la ventana y cada 30 segundos. El servidor valida siempre el estado actual; los borradores no reservan existencias.

Los permisos de escritura son de administrador. Precios, extras, caja única, puntos, control 1–30 y comprobantes siguen sus contratos actuales. Recetas, ingredientes, costos, paquetes compartidos y conversión de pastel a rebanadas quedan fuera de este inventario.

## Venta, CLIP y devolución

Una venta fallida revierte existencias y movimientos. Recuperar la misma venta o reimprimir no descuenta otra vez. Los comprobantes históricos no se modifican.

Con inventario activo, preparar CLIP reserva las unidades antes del único POST al proveedor. Un resultado incierto conserva la reserva. Solo la liquidación verificada descuenta físicamente o un fallo verificado la libera; un aviso aislado no basta. Mientras un producto tenga reservas, sus ajustes se bloquean. No se puede activar o pausar el inventario con pagos CLIP pendientes. CLIP permanece apagado en esta versión hasta su habilitación y token privado.

Cancelar una venta no repone automáticamente ni reembolsa dinero. En Ventas, abrir el ticket cancelado y seleccionar **Devolver a inventario** solo para piezas aptas para venderse. Las devoluciones parciales acumuladas no pueden superar lo realmente descontado. No se inventan devoluciones para ventas anteriores o sin conteo.

## CSV e historial

Descargar la plantilla desde Inventario para obtener códigos estables `CM-…`. Columnas:

`codigo,producto,modo,unidad,cantidad,minimo,disponible`

Modo `conteo` o `disponibilidad`; disponible `si` o `no`. Cantidad y mínimo admiten enteros de 0 a 1000000. Una cantidad vacía conserva el conteo; cambiar modo/unidad lo deja desconocido. El mínimo vacío lo elimina. El código identifica el producto; un nombre presente debe coincidir.

La vista previa no guarda. Cualquier error rechaza todo el lote, con máximo de 500 filas/300 KB. Cada revisión protege contra ventas o ajustes posteriores a la vista previa: un lote obsoleto debe revisarse e importarse nuevamente. La exportación protege celdas que podrían interpretarse como fórmulas.

Los movimientos conservan producto, código, unidad, responsable, fecha Matamoros, motivo y cantidades anterior/nueva. Los respaldos incluyen configuración, movimientos, solicitudes y reservas. Una operación incierta se recupera con la misma identidad y usuario; no se compensa creando otra entrada. Las ventanas comparten un bloqueo antes de guardar.

## Verificación y límites

Ver [revisión de calidad](quality-review.md), [preparación general](integration-readiness.md) y [contrato de tickets](receipt-data-contract.md). Las pruebas usan el menú de referencia y datos sintéticos, sin cobrar tarjetas ni enviar papel.

El cambio no instala la app en el café. Para una pausa operativa, desactivar el módulo y conservar tablas, movimientos y diarios; al reactivarlo, volver a contar. No revertir migraciones ni restaurar cantidades antiguas sobre ventas recientes.
