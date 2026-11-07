# Cariñito Mío POS

[![Verificación Windows](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml/badge.svg?branch=main)](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml)

Punto de venta para una cafetería con una sola caja física. Next.js 16.4.3, React 19, TypeScript, Supabase y Zustand. La interfaz táctil mantiene el menú a la izquierda, la orden a la derecha y el cobro visible, con textos en español.

## Estado actual — 6 de noviembre de 2026

Última versión publicada: [**pos-99d1675 — Tamaños y una etiqueta de postres**](https://github.com/jorgecantu276/pos-cafe/releases/tag/pos-99d1675), del 6 de noviembre. Incluye el ZIP de Windows y su actualizador. El código está integrado en `main` mediante el [PR #12](https://github.com/jorgecantu276/pos-cafe/pull/12).

La [verificación de `main` en el commit `9a6bd80`](https://github.com/jorgecantu276/pos-cafe/actions/runs/42219574778) terminó correctamente: Windows, administración, pedidos por teléfono y restauración de respaldos. El ZIP publicado corresponde a `99d1675`; el cambio posterior de CI separa los ensayos de backend en máquinas independientes y no modifica ese paquete.

| Área | Estado |
| --- | --- |
| Ventas, Caja, Catálogo y Clientes | Conectados al backend; pruebas con datos sintéticos y Auth/PostgREST local. |
| Menú y tamaños | Una tarjeta por familia de bebida; Iced Coffee y Matcha permiten elegir **16 oz / 20 oz**, preparación y leche. Precios y excepciones en [tamaños y leches](docs/menu-sizes.md). |
| Backend y migraciones | El repositorio conserva **22 migraciones: 001, 002 y 004–023**. El registro del 2 de noviembre confirma 017–021 desplegadas con respaldos y huellas conservadas; el PR #12 registra la aplicación de 023 y del catálogo actualizado. Verificar el historial del destino antes de instalar otra versión. |
| Receptor CLIP | `clip-webhook` v1 desplegado y verificado. Recibir un aviso no crea ni aprueba un cobro. |
| Cobro automático CLIP | **Apagado. Token de ejemplo.** Pendiente de habilitación de PinPad, token real y aceptación con la terminal. |
| Controles de entrega 1–30 | Obligatorios en mostrador. **Pedido por teléfono** permite guardar sin control y cobrar al recoger. |
| Pedidos por teléfono | Pendientes compartidos entre turnos, precio acordado, preparación sin pagar y cobro único al recoger. Ver [flujo completo](docs/phone-orders.md). |
| Distribución Windows | Versión actual disponible como ZIP y actualizador para Caja instalada; también existe un instalador inicial anterior. La publicación no acredita que una PC ya esté actualizada. |
| Preparación de postres | Una etiqueta compacta por orden, en la misma Y813BT de bebidas. La comprobación física del formato nuevo sigue pendiente en la PC del café. |
| Inventario | Integrado en Catálogo; migración 017 desplegada y **apagado al inicio**. No se inventan existencias. |
| Tipo de cambio del negocio | Último cambio documentado, el 2 de noviembre: **1 USD = 16 MXN** para nuevas aperturas. El turno que entonces estaba abierto conservó 18; cada turno mantiene su tasa y sus ventas no se recalculan. |

La [revisión de integración y preparación](docs/integration-readiness.md) conserva las evidencias y condiciones del 2 de noviembre. Para los cambios posteriores, consultar el PR #12, la versión publicada y el CI enlazados arriba. Pasar pruebas locales no equivale a aceptar toda la operación del café.

La [revisión de calidad](docs/quality-review.md) compara las comprobaciones funcionales, accesibilidad, pantalla touch y tickets con criterios verificables. No presenta una puntuación inventada ni confunde un navegador de desarrollo con la PC del café.

La revisión sigue un [flujo coordinado](docs/quality-workflow.md) con responsables de interfaz, textos, integración y calidad independiente. Los ajustes comparten grupos/filas y las opciones de recuperación se muestran solo cuando hay algo pendiente.

## Qué incluye

- **Caja:** apertura, gastos, tipo de cambio guardado, arqueo, corte y entrega a otro cajero. Tras un cierre confirmado, el mismo cajero puede elegir **Abrir nuevo turno** o **Cerrar sesión**; la nueva apertura pide un fondo nuevo. Una entrega queda reservada al cajero elegido, que inicia sesión y confirma el efectivo recibido. Solo puede existir un turno abierto. Si se pierde la respuesta del cierre, **Comprobar cierre** recupera la operación sin reimprimir automáticamente el corte.
- **Ventas:** cantidades, extras y notas; efectivo MXN, MXN + USD y tarjeta; historial, cancelación administrativa y reimpresión. Cancelar una venta **no devuelve dinero** en CLIP ni en otra terminal.
- **Catálogo:** productos, fotos, extras y favoritos; búsqueda/filtros; guardados recuperables, desactivación y reactivación con el mismo ID e historial. Caja agrupa las variantes de bebidas en una tarjeta por familia y detecta cambios de menú para revisar precios antes de un nuevo cobro.
- **Inventario dentro de Catálogo:** disponibilidad, conteos, entradas, mermas, CSV con vista previa, movimientos y devoluciones parciales de ventas canceladas. Activación explícita por administrador, apagada al inicio. Ver [operación y CLIP](docs/inventory.md).
- **Clientes:** alta por nombre/teléfono, corrección, compras y puntos según la regla existente. El canje sigue pendiente de la política del negocio.
- **Configuración:** equipo con reactivación recuperable, respaldos cifrados, impresión y revisión de pagos CLIP pendientes.

El borrador conserva cantidades, extras, notas, cliente, tipo de pedido y control. Editar un artículo aplica sus cambios al guardar. Una identidad por venta permite recuperar la misma solicitud después de una interrupción. La administración tiene cuatro áreas principales; los antiguos accesos duplicados/cupones redirigen a las acciones vigentes. Ver [interfaz y navegación](docs/workspace.md).

## Menú: tamaños y leches

**Iced Coffee** y **Matcha** tienen un selector de **16 oz / 20 oz** junto al nombre. Después se eligen sabor o preparación, leche y notas. Cambiar de tamaño conserva las opciones compatibles; si no existe una preparación equivalente, hay que elegir otra antes de agregarla. Cada presentación mantiene su propio ID y precio; los tickets guardados y pedidos telefónicos conservan el precio acordado.

| Bebida | 16 oz | 20 oz |
| --- | --- | --- |
| Iced Coffee, sabores habituales | $95 MXN | $125 MXN |
| Iced Coffee Flan | $130 MXN | No disponible |
| Matcha Cariño | $105 MXN | $140 MXN |
| Matcha Fresa / Mango | $115 MXN | No disponible como esa misma preparación |
| Matcha Cold foam Fresa / Mango | No disponible | $140 MXN |
| Matcha Ceremonial | $140 MXN | No disponible |

Iced Coffee conserva **Tipo de Leche**: entera, deslactosada y deslactosada light sin recargo; almendra, avena, coco y Lala 100 suman $15. Matcha usa **Leche alternativa**: las seis leches existentes sin recargo y Lala 100 a $15. Son grupos independientes. La migración **023** exige una sola leche alternativa en venta manual, cotización CLIP y pedido telefónico. Ver [detalle del menú y compatibilidad](docs/menu-sizes.md).

## CLIP y controles de entrega

La terminal identificada es una **Clip Total 3, modelo K1352**. Tarjeta funciona inicialmente de forma manual: cobrar en la terminal y confirmar su aprobación en el POS.

La integración automática guarda una cotización validada por el servidor antes de enviar un único intento a CLIP. Verifica el resultado mediante consulta autenticada y completa una sola venta. Un timeout conserva el pago original y bloquea otro cobro/cierre hasta resolverlo. Los avisos recibidos son pistas que deben verificarse; un webhook por sí solo nunca aprueba la venta.

**Mantener `POS_CLIP_ENABLED=0` / `ClipEnabled: false`.** El token real pertenece a un archivo privado fuera de la versión instalada; no va en Git ni en variables `NEXT_PUBLIC_`. Los ejemplos solo contienen un placeholder. Ver [configuración, despliegue y recuperación](docs/clip-payments.md) y [ejemplo de entorno](config/clip.env.example).

En mostrador, el cajero elige un control **1–30 antes de cobrar**. Su número se conserva al recargar, se guarda en el comprobante y aparece en el ticket del cliente y cada etiqueta/página del barista. Debajo de los números aparece **Pedido por teléfono**: se guarda sin control, no suma ingresos hasta pagarse y se recupera desde **Pedidos por cobrar**. La excepción se verifica con el pedido persistido en el backend. Una nueva orden vuelve a mostrador. El barista activa el localizador desde su base física; el POS no se comunica por radio con esa base.

## Impresión y recuperación

Las ventas de mostrador generan trabajos independientes según su contenido: ticket del cliente a **POS80 Printer** por USB y preparación de bebidas/postres a **Y813BT Sticker** por Bluetooth. El pedido por teléfono guarda sus copias **pendientes de pago** con identidad propia. Al cobrar agrega el recibo pagado y asegura la preparación original si faltaba, sin repetir copias ya aceptadas o inciertas. **Pagados → Comprobar comanda** conserva la recuperación. El servidor usa documentos guardados y un diario SQLite por copia. Reimpresiones históricas y cortes usan el diálogo de Windows.

Los recibos nuevos conservan logo, importes, QR de Instagram y datos del emisor; omiten el nombre individual y las líneas de CFDI retiradas. Las etiquetas de bebidas usan el diseño negro `reference-v2`. Los documentos y diarios anteriores no se reescriben. La aceptación física anterior y las comprobaciones pendientes se distinguen en el [registro de impresoras](docs/printer-acceptance-2026-10-31.md).

Desde `pos-99d1675`, los productos de **Postres** se agrupan en **una sola etiqueta de preparación de 57 × 32 mm**, con diseño `desserts-compact-v1`, cantidades, modificadores y notas, sin precios. Se envía a **Y813BT Sticker**; las bebidas conservan una etiqueta por vaso y su conteo excluye postres. Una orden mixta tiene trabajos independientes de cliente, bebidas y postres.

El diseño compacto ajusta Arial Bold entre 8.5 y 6.5 pt sin recortar texto ni generar continuaciones. Si el contenido completo no cabe, bloquea ese trabajo antes de enviarlo y remite al ticket de la orden; los otros trabajos conservan su estado. La muestra de seis postres cabe a 7.5 pt en la validación del paquete. **La legibilidad física del formato compacto sigue pendiente en el café.** Los documentos históricos mantienen su diseño, impresora e identidad originales. Ver [impresión y recuperación](docs/printing.md).

Ver [contrato del comprobante](docs/receipt-data-contract.md), [borradores](docs/cart-drafts.md), [caja única](docs/single-drawer.md) y [gastos/cortes](docs/shift-expenses.md).

## Desarrollo

Usar **Node.js 24.22.2 x64** y Windows para preparar el paquete verificado. Instalar con `npm ci` y ejecutar `npm run dev`.

Mantener `.env.local` fuera de Git:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_TEST_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_TEST_PUBLIC_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_TEST_SERVER_KEY
POS_CLIP_ENABLED=0
POS_CLIP_TOKEN=REPLACE_WITH_CLIP_BASIC_TOKEN
```

La clave de servicio es solo del servidor: cuentas, respaldos y CLIP cuando se active. Usar datos sintéticos y un proyecto separado para desarrollo. El `.env.local` histórico corresponde a un backend legado distinto del cliente; **no migrarlo para hacer funcionar una vista previa**. Construir releases con el destino privado del cliente verificado.

El POS requiere conexión al backend. La PWA no habilita ventas offline: el service worker retira cachés antiguos y no intercepta solicitudes ni guarda ventas para enviarlas después.

## Verificación

| Comando | Cobertura |
| --- | --- |
| `npm test` | Carrito, UI real, permisos, recuperación, CLIP simulado, controles y diseño Windows sin papel. |
| `npm run test:db` | PostgreSQL 17.6 aislado: precios, transacciones, concurrencia, puntos, cortes, CLIP/pagers y permisos. Puerto 55439. |
| `npm run test:admin-http` | Auth/PostgREST y app de producción: cuatro áreas, inventario apagado/activo, venta, devolución, roles, control guardado y CLIP apagado. API/DB 55481/55482 y app 3111. Requiere Docker. |
| `npm run test:phone-http` | Auth/PostgREST y producción para teléfono: guardar sin cobrar, preparación simulada, recuperación entre turnos y pago al recoger. API/DB 55501/55502 y app 3112. Con `POS_BROWSER_QUALITY=1`, incluye navegador y capturas. |
| `npm run test:printing` | Endpoints de impresión/reimpresión y diario con backend/impresoras simulados; app 3112. |
| `npm run test:restore-business` | Archivo cifrado automático → segundo backend local vacío → relaciones/filas/secuencias → Auth original → pago al recoger → corte. API/DB de origen 55501/55502 y destino 55521/55522. |
| `npm run typecheck` / `npm run lint` | TypeScript y reglas sin advertencias. |
| `npm run build:verify` | Compilación de producción aislada de la vista previa en ejecución. |
| `npm audit` / `npm audit --omit=dev` | Dependencias completas y de ejecución. |

La validación registrada para `pos-99d1675` incluye **285 pruebas**, **2,925 comprobaciones de PostgreSQL**, **10 comprobaciones HTTP de impresión** y **120 comprobaciones de teléfono en 23 vistas**, además de revisión del ZIP exacto y arranque Windows reubicado. Las cifras corresponden a esa versión; consultar el CI de cada commit para verificaciones posteriores.

GitHub Actions repite lint, TypeScript, pruebas, auditorías, compilación, impresión simulada y empaquetado Windows. Los ensayos de administración, teléfono y restauración usan **tres máquinas independientes**, con puertos reservados para evitar conflictos. Los cuatro trabajos del [CI de `9a6bd80`](https://github.com/jorgecantu276/pos-cafe/actions/runs/42219574778) terminaron correctamente. El [plan de entrega](docs/delivery-readiness.md) conserva los límites de hardware y puesta en marcha.

Con `POS_BROWSER_QUALITY=1`, el ensayo HTTP también abre Chromium/Edge aislado y ejecuta axe WCAG 2.2 AA, navegación real, conteo cero por UI y revisión de desbordamiento sobre 82 productos de referencia. CI ejecuta este modo. Necesita un navegador Chromium instalado; no usa un perfil personal ni envía papel. Las mediciones locales de carga/eventos se registran como laboratorio, sin atribuirles cumplimiento de Core Web Vitals en campo.

Para enlazar los seis comprobantes SQL con la prueba HTTP de impresión, usar la misma ruta temporal en `POS_RECEIPT_CONTRACT_EVIDENCE` para `test:db` y `test:printing`. CI ya lo hace. Las pruebas no deben tocar ventas del negocio, cobrar tarjetas ni enviar papel.

Más procedimientos: [staging](supabase/staging/README.md), [restauración/rollback](supabase/staging/RECOVERY.md) y [reinicio/PWA](supabase/staging/LIFECYCLE.md).

## Publicación e instalación

La PC de desarrollo prepara el paquete; la del café recibe una versión revisada desde GitHub. El paquete incluye Node, servidor, recursos, migraciones y recuperación. El iniciador valida el backend, mantiene una única instancia y lee la configuración privada fuera de la carpeta de versión. El instalador crea el acceso **Cariñito Mío POS** y abre Caja en una ventana propia de Edge.

### Actualizar una Caja instalada

1. Abrir la [versión `pos-99d1675`](https://github.com/jorgecantu276/pos-cafe/releases/tag/pos-99d1675) y descargar **POS-Cafe-99d1675.zip** y **Actualizar-Caja-99d1675.ps1**.
2. Cerrar Caja antes de ejecutar el actualizador y seguir sus indicaciones. El script verifica los archivos, conserva la versión anterior y utiliza la configuración privada y el diario actuales. No ejecuta migraciones, borra datos ni envía impresiones.
3. Verificar inicio, acceso al backend y funcionamiento en la PC del café. La aceptación del nuevo formato compacto requiere comprobar el papel allí.

SHA-256 del ZIP publicado:

```text
a0068efb39b6f6e63b2c94736b1c4495e70b58dc3e0d7591233dcb97fc14f672
```

El [instalador inicial `pos-8fe948b`](https://github.com/jorgecantu276/pos-cafe/releases/tag/pos-8fe948b) es anterior a esta actualización y requiere la configuración privada en `C:\POS-Cafe\private\pos-cafe-config.json`. No contiene los últimos cambios de menú y postres; una instalación nueva debe prepararse con la versión actual y su contrato de backend.

### Datos y recuperación

Conservar el POS anterior durante la aceptación, la configuración privada, los respaldos y **el diario actual con sus archivos WAL/SHM**. No restaurar un diario viejo para volver de versión. Después de crear órdenes nuevas, la versión usada para recuperación debe entender `desserts-compact-v1` y los trabajos `desserts`.

Las migraciones 013–021 y el receptor CLIP tienen despliegue documentado; el PR #12 registra además la migración 023 y el catálogo actualizado. La **022** agrega almacenamiento para fotos del catálogo. Para un destino nuevo, revisar la compatibilidad del esquema y las **22 migraciones retenidas (001, 002 y 004–023)**; para uno existente, comprobar su historial y aplicar solo las pendientes mediante un procedimiento con respaldo. El actualizador de Windows no sustituye ese proceso.

Mantener **CLIP e inventario apagados** hasta su habilitación explícita. Al activar inventario se deben registrar conteos físicos reales. Conservar los respaldos cifrados y su clave por separado fuera de la PC. Los registros de despliegue del 2 de noviembre documentan las copias y huellas verificadas en esa fecha.

Ver [contrato de base de datos](supabase/README.md), [instalación Windows](docs/windows-deployment.md), [respaldos](docs/business-backups.md) y [revisión de preparación](docs/integration-readiness.md).
