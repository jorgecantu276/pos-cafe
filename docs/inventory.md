# Inventario simple

La sección **Administración → Inventario** usa el catálogo de productos existente. No requiere recetas ni insumos. Los paquetes y la conversión de pasteles a rebanadas quedan pendientes de la respuesta del negocio; por ahora cada producto tiene su propia existencia.

## Operación

- Todos los productos existentes y nuevos empiezan disponibles, sin importar el campo de stock del sistema anterior. No se inventan cantidades.
- En **Configurar producto**, el administrador elige disponibilidad o conteo, unidad y mínimo opcional. Cambiar modo o unidad exige un conteo nuevo.
- **Contar stock** registra el total físico, incluso cero. Un conteo desconocido se muestra como **Sin contar** y no bloquea ventas. Después del primer conteo, cero impide vender y cada venta descuenta sus piezas.
- **Agregar stock** suma una entrada. **Registrar merma** resta piezas con un motivo. Ambas necesitan un conteo inicial.
- Solo administradores cambian inventario; caja y baristas consultan disponibilidad. Este permiso podrá ampliarse cuando el negocio confirme quién llevará los conteos.
- La caja carga disponibilidad al abrir, al volver a la ventana, cada 30 segundos y después de confirmar o rechazar una venta. El servidor siempre verifica el estado actual. Los borradores no reservan existencias.
- Un fallo o rechazo de venta revierte también sus descuentos. Recuperar la misma venta o reimprimir no vuelve a descontar.
- Cancelar no repone automáticamente. En **Ventas**, abrir la venta cancelada y elegir cantidades en **Devolver a inventario** únicamente para piezas que puedan venderse otra vez. El servidor limita las devoluciones acumuladas a lo realmente descontado. Una venta antigua o sin conteo no recibe devoluciones inventadas. Esta acción no devuelve dinero.
- Cada movimiento conserva producto, código, unidad, responsable, fecha, motivo y cantidad anterior/nueva; la configuración conserva también sus valores anteriores y nuevos.

## CSV

Descargar la plantilla desde el inventario real para obtener los códigos estables `CM-…`. No usar los identificadores `MENU-…` del menú de referencia como códigos de producción.

Columnas: `codigo,producto,modo,unidad,cantidad,minimo,disponible`.

- `modo`: `conteo` o `disponibilidad`.
- `unidad`: `pieza`, `rebanada`, `pastel`, `botella`, `lata` o `paquete`.
- `cantidad`: entero entre 0 y 1000000; vacío conserva el conteo existente. Al activar conteo por primera vez o cambiar unidad, vacío deja **Sin contar**. Disponibilidad exige cantidad vacía.
- `minimo`: entero opcional en el mismo rango; vacío lo elimina.
- `disponible`: `si` o `no`; se usa en modo disponibilidad. En conteo, la existencia determina si puede venderse.
- El código identifica el producto. Si se incluye nombre, debe coincidir. Se admiten comillas, comas dentro de nombres y UTF-8 con BOM. La exportación protege nombres que puedan interpretarse como fórmulas.

La vista previa muestra el resultado antes de guardar. Hay un máximo de 500 productos/300 KB por archivo. Cualquier error rechaza el lote completo. Si una venta cambia una existencia después de preparar la vista previa, el lote se rechaza completo: actualizar, descargar o revisar el archivo y volver a importarlo. No se permite que una importación sobrescriba ventas ocurridas mientras se revisaba.

## Recuperación y despliegue

Aplicar `202610300006_simple_inventory.sql` después de las migraciones retenidas 001, 002 y 004, con esta versión del app. Los números ausentes corresponden al inventario retirado: no restaurar aquellas migraciones. El control nuevo usa tablas `pos_inventory_*`; los campos y recetas antiguos permanecen inertes.

Una operación se guarda localmente antes de enviarse, con una identidad que el servidor reconoce. Un timeout conserva esa misma operación. **Recuperar operación** consulta/reintenta su identidad original, incluso después de recargar. No crear otra entrada para compensar una respuesta desconocida. Las revisiones por producto impiden sobrescribir una venta o ajuste concurrente. Los códigos y movimientos no se pueden editar directamente desde el navegador.

Preparar respaldo y aplicar primero a un proyecto de pruebas. La migración no copia ni modifica existencias antiguas, ni activa conteos por categoría. Para volver a la versión anterior durante pruebas, deshabilitar explícitamente el trigger `consume_product_inventory` y restaurar ese app en conjunto; conservar las tablas y movimientos. Después de operar con conteos reales, conciliar ventas posteriores antes de reactivar el control y volver a contar. No borrar el registro ni restaurar un respaldo antiguo sobre ventas recientes.

Pendiente del negocio: productos por encargo, piezas compartidas entre paquetes y sueltos, cortes de pastel y responsables de conteo. Estas decisiones no impiden probar las operaciones independientes.
