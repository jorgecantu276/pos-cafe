# Calidad del POS, inventario, pantalla y tickets

Revisión del 2 de noviembre de 2026. El inventario pasa las mismas comprobaciones de código, UI, permisos y transacciones que el resto de la app, más casos de activación y reservas CLIP. Eso no certifica automáticamente usabilidad, WCAG completo ni rendimiento en la PC del café.

## Criterios externos y evidencia

| Referencia | Criterio verificable | Evaluación de esta versión |
| --- | --- | --- |
| [WCAG 2.2: contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Texto normal 4.5:1; texto grande 3:1. | axe detectó textos insuficientes en menús, Equipo, Caja, Clientes, cobro y denominaciones del cierre. Se oscurecieron conservando la jerarquía visual. La prueba de navegador bloquea hallazgos serios/críticos en los estados revisados. |
| [WCAG 2.2: objetivos mínimos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) y [mejorados](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced) | AA: 24×24 CSS px, con excepciones; AAA: 44×44. | Caja e inventario apuntan a 44–56 px o más. Se ampliaron los enlaces superiores de Administración. Se mide el área de la etiqueta asociada de checkbox/archivo, además del control visual. No se declara conformidad AAA global. |
| WCAG: teclado y foco | Contenido desplazable accesible, foco visible y nombres de controles. | Pestañas de inventario con flechas/Home/End; formularios etiquetados; región de pedido desplazable con foco. Catálogo, Ventas y Equipo comparten el diálogo nativo, con cierre protegido al guardar. |
| [Google: Core Web Vitals](https://web.dev/articles/vitals) | LCP ≤2.5 s, INP ≤200 ms y CLS ≤0.1, evaluados al percentil 75 de visitas. | No hay medición de campo en la PC del café. La prueba registra LCP, suma de desplazamientos sin entrada reciente y duración máxima de eventos como laboratorio. Estos dos últimos datos no son una implementación/certificación de CLS/INP ni su percentil 75. |
| [Nielsen Norman Group: heurísticas](https://www.nngroup.com/articles/ten-usability-heuristics/) | Estado visible, prevención de errores, recuperación y reconocimiento. | Cuatro áreas, inventario dentro de Catálogo, activación explícita, cantidades desconocidas separadas de cero, CSV con vista previa y recuperación de la misma operación. Falta validación observada con cajeros reales; no se inventa una puntuación de usabilidad. |

axe es una comprobación automatizada parcial. Cero hallazgos en una pantalla no prueba todos los criterios WCAG, todos los estados, lectores de pantalla ni legibilidad física.

Resultado local registrado: **34 estados, cero infracciones de axe, cero objetivos medidos menores de 44 px y cero desbordamientos horizontales**, en Edge 156.0.4314.58. Quedan comprobaciones manuales de axe (`color-contrast` y `aria-prohibited-attr`) que se conservan en el reporte; no se contabilizan falsamente como criterios certificados.

En ese recorrido, el LCP observado estuvo entre **84 y 308 ms**, la suma local de desplazamientos llegó a **0.049** y el evento observado más largo fue **112 ms**. Son datos de un navegador en el PC de desarrollo con backend local, no percentiles de usuarios ni prueba de rendimiento del café. La inspección visual también corrigió el panel fijo del inventario para que el encabezado de Administración no tape el producto al desplazarse.

## Pruebas de esta revisión

- **236 pruebas** de aplicación: UI real, recuperación, permisos, borradores, inventario, CLIP simulado, controles e impresión Windows. Incluyen bloqueo entre ventanas, teléfono sin control con pago al recoger, preservación del carrito de mostrador y recuperación de la comanda desde otro cajero.
- **2,700 comprobaciones PostgreSQL**: transacciones, revisiones obsoletas, lotes CSV atómicos, última pieza concurrente, venta/replay, devoluciones parciales, inventario apagado y reservas/liquidación CLIP. Incluyen 121 de teléfono: precio acordado, turno/tasa del pago, concurrencia, cancelación/merma y respaldo tipado de pedidos y reservas. No equivalen a certificar una restauración operativa completa de Auth, Windows y sus dispositivos.
- **Auth/PostgREST y producción local**: roles reales, activación protegida, conteo, venta con control 30, no doble descuento, cancelación sin reposición automática, devolución/replay y pausa. Backend nuevo, sin acceder al cliente alojado.
- **Navegador real** con los **82 productos** del menú de referencia: login, administración, Catálogo, inventario, Ventas, Caja, Clientes, Configuración, Equipo, respaldos, impresión y CLIP; detalle/conteo cero de inventario y diálogos de cobro/cierre. axe WCAG 2.2 AA y comprobación de desbordamiento. Las pantallas de configuración sin rutas privadas se revisan en su estado de configuración faltante, no como un respaldo físico ya instalado.
- **Tickets**: seis comprobantes SQL creados después de todas las migraciones, con inventario activo y control 30. Verificación de cantidades descontadas, extras, importes unitarios/renglones, MXN/USD, cambio, cliente, preparación y puntos. Los mismos snapshots pasan por el API de impresión, render Windows y diario simulado. Repetir/reiniciar/reimprimir no crea otra venta, descuento o copia aceptada.
- TypeScript, lint, auditorías de dependencias, build y paquete portable se comprueban también en GitHub Actions. Consultar el resultado del commit revisado.

La inspección encontró problemas que las pruebas funcionales anteriores no detectaban: contraste, enlaces superiores pequeños, foco de una región desplazable a menor altura y el contrato de tickets que se probaba antes de algunas migraciones. La suite ahora incluye esas condiciones.

El primer recorrido de CI en Linux también detectó un desbordamiento a 320 px que no aparecía en Edge/Windows. La cabecera móvil permite envolver sus enlaces y omite la ruta padre redundante, que sigue disponible en la navegación de Catálogo. El check de 320 px se conserva: no se oculta el desbordamiento para forzar un aprobado.

## PC y display del café

La revisión posterior aplica grupos y filas comunes a los ajustes, separa información de soporte en detalles y elimina acciones de recuperación sin pendientes. Los textos usan acciones como **Guardar**, **Comprobar venta** o **Revisar cambio pendiente**, conservando **No vuelvas a cobrar** cuando hace falta. La revisión independiente también cubre los guardados concurrentes entre ventanas y el POST de respaldo con la URL interna normalizada de Next.

El tipo de cambio del negocio quedó guardado en **16 MXN/USD** para una próxima apertura, con registro de la petición del dueño. El turno abierto conserva **18**, al igual que sus comprobantes. Las huellas de ventas y turnos no cambiaron.

| Dato conocido | Qué permite concluir / qué falta |
| --- | --- |
| i5-8250U, 4 núcleos/8 hilos; 7.92 GB RAM, 3.3 GB libres en la captura | La versión se compila en desarrollo y entrega Node/servidor ya preparados. No se ejecuta Docker ni el build en caja. No se ha medido todavía latencia, memoria total ni estabilidad de esta app bajo carga en esa PC. |
| Windows 11 Pro 24H2; Chrome/Edge; Intel UHD 620 | Interfaz sin blur pesado ni movimiento decorativo; no depende de una GPU dedicada. El dato de GPU no mide calidad del panel ni precisión del touch. |
| 1366×768, 60 Hz | Se revisa el viewport completo y 1093×614 como referencia del espacio efectivo al 125%; también 1093×560 para menor altura útil. Inventario se revisa además en 1024×768, 390 y 320 px. No se equipara emulación de viewport con medir el equipo físico. |
| SSD 119.2 GB; C: 11 GB libres, D: 48.2 GB en la captura | Configuración, respaldos y diario fuera de la carpeta de versión. Falta medir crecimiento real y comprobar resguardo fuera del mismo disco. |
| Wi-Fi reportó enlace de 780 Mbps | Es velocidad de enlace, no internet ni latencia del backend. Las ventas requieren conexión; la app no tiene ventas offline. |
| Panel/modelo/diagonal/brillo/contraste físico no identificados | No se puede calificar la calidad del display. Faltan escala/zoom reales, reflejos/ángulo de visión, calibración touch, teclado Windows y prueba con el cajero en su posición habitual. |

La aceptación pendiente debe comprobar desde arranque de Windows hasta venta mixta, modificación de bebidas, control, dos impresoras, pérdida de red y recuperación de Bluetooth. Registrar tiempos de carga e interacción, legibilidad y errores touch en ese equipo; no sustituirlo por cifras del PC de desarrollo.

## Impresión física y despliegue

La aceptación física anterior distingue el ticket V8 y las versiones de etiqueta efectivamente impresas. Ver [registro físico](printer-acceptance-2026-10-31.md). El diseño `reference-v2` y el control nuevo tienen render verificado; necesitan su propia confirmación en papel para afirmar aceptación completa. Se mantienen los ajustes de controladores y el diario histórico; no se cambia ni reenvía un documento viejo para aplicar un diseño nuevo.

Inventario inicia **apagado**, CLIP continúa **apagado** y el token es un placeholder. La migración 017 está validada localmente, pendiente de despliegue alojado autorizado. El código publicado no instala ni certifica la nueva app en la PC del café.

## Repetir la revisión

`npm test`, `npm run test:db`, `npm run lint` y `npm run typecheck` son independientes de datos del café. Para el recorrido de navegador, usar `POS_BROWSER_QUALITY=1` con `npm run test:admin-http`; requiere Docker Linux y Chromium/Edge instalado. GitHub ejecuta este modo en el job de integración.

Los reportes JSON y capturas quedan en `.staging-local/quality/<identidad>/`, ignorados por Git. El reporte conserva hallazgos y comprobaciones pendientes de axe, tamaños, viewport y métricas de laboratorio; no incluye contraseñas ni claves. `POS_RECEIPT_CONTRACT_EVIDENCE` enlaza los seis comprobantes de `test:db` con `test:printing`. Ninguna prueba cobra tarjetas o envía papel.
