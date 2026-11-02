# Cariñito Mío POS

[![Windows verification](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml/badge.svg?branch=main)](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml)

Punto de venta para una cafetería con una sola caja física. Next.js 16.4.3, React 19, TypeScript, Supabase y Zustand. La interfaz touch mantiene el menú a la izquierda, la orden a la derecha y el cobro visible, con textos en español.

## Estado de integración — 2 de noviembre de 2026

| Área | Estado |
| --- | --- |
| Ventas, Caja, Catálogo y Clientes | Conectados al backend; pruebas con datos sintéticos y Auth/PostgREST local. |
| Backend del cliente | Las 19 migraciones retenidas, incluidas **017–020**, están aplicadas. Respaldo previo/posterior y huellas de las 31 tablas existentes conservadas. |
| Receptor CLIP | `clip-webhook` v1 desplegado y verificado. Recibir un aviso no crea ni aprueba un cobro. |
| Cobro automático CLIP | **Apagado. Token como placeholder.** Pendiente de habilitación de PinPad, token real y aceptación con la terminal. |
| Controles de entrega 1–30 | Obligatorios en mostrador. **Pedido por teléfono** permite guardar sin control y cobrar al recoger. |
| Pedidos por teléfono | Pendientes compartidos entre turnos, precio acordado, preparación sin pagar y cobro único al recoger. Ver [flujo completo](docs/phone-orders.md). |
| App en la PC del café | Instalación/configuración de esta versión y aceptación operativa pendientes. Publicar código en GitHub no instala la app. |
| Inventario | Integrado en Catálogo; migración 017 desplegada y **apagado al inicio**. No se inventan existencias. |
| Tipo de cambio del negocio | **1 USD = 16 MXN** guardado para la próxima apertura. El turno abierto anterior conserva 18; sus ventas no se recalculan. |

La [revisión de integración y preparación](docs/integration-readiness.md) documenta conexiones UI/backend, evidencias, pendientes y condiciones para instalar o activar cada función. Pasar pruebas locales no equivale a aceptar toda la operación del café.

La [revisión de calidad](docs/quality-review.md) compara las comprobaciones funcionales, accesibilidad, pantalla touch y tickets con criterios verificables. No presenta una puntuación inventada ni confunde un navegador de desarrollo con la PC del café.

La revisión sigue un [flujo coordinado](docs/quality-workflow.md) con responsables de interfaz, textos, integración y calidad independiente. Los ajustes comparten grupos/filas y las opciones de recuperación se muestran solo cuando hay algo pendiente.

## Qué incluye

- **Caja:** apertura, gastos, tipo de cambio guardado, arqueo, corte y entrega a otro cajero. El entrante inicia sesión y confirma el efectivo recibido. Solo puede existir un turno abierto.
- **Ventas:** cantidades, extras y notas; efectivo MXN, MXN + USD y tarjeta; historial, cancelación administrativa y reimpresión. Cancelar una venta **no devuelve dinero** en CLIP ni en otra terminal.
- **Catálogo:** productos, extras y favoritos; búsqueda/filtros; guardados recuperables, desactivación y reactivación con el mismo ID e historial. Caja detecta cambios de menú y exige revisar precios antes de un nuevo cobro.
- **Inventario dentro de Catálogo:** disponibilidad, conteos, entradas, mermas, CSV con vista previa, movimientos y devoluciones parciales de ventas canceladas. Activación explícita por administrador, apagada al inicio. Ver [operación y CLIP](docs/inventory.md).
- **Clientes:** alta por nombre/teléfono, corrección, compras y puntos según la regla existente. El canje sigue pendiente de la política del negocio.
- **Configuración:** equipo con reactivación recuperable, respaldos cifrados, impresión y revisión de pagos CLIP pendientes.

El borrador conserva cantidades, extras, notas, cliente, tipo de pedido y control. Editar un artículo aplica sus cambios al guardar. Una identidad por venta permite recuperar la misma solicitud después de una interrupción. La administración tiene cuatro áreas principales; los antiguos accesos duplicados/cupones redirigen a las acciones vigentes. Ver [interfaz y navegación](docs/workspace.md).

## CLIP y controles de entrega

La terminal identificada es una **Clip Total 3, modelo K1352**. Tarjeta funciona inicialmente de forma manual: cobrar en la terminal y confirmar su aprobación en el POS.

La integración automática guarda una cotización validada por el servidor antes de enviar un único intento a CLIP. Verifica el resultado mediante consulta autenticada y completa una sola venta. Un timeout conserva el pago original y bloquea otro cobro/cierre hasta resolverlo. Los avisos recibidos son pistas que deben verificarse; un webhook por sí solo nunca aprueba la venta.

**Mantener `POS_CLIP_ENABLED=0` / `ClipEnabled: false`.** El token real pertenece a un archivo privado fuera de la versión instalada; no va en Git ni en variables `NEXT_PUBLIC_`. Los ejemplos solo contienen un placeholder. Ver [configuración, despliegue y recuperación](docs/clip-payments.md) y [ejemplo de entorno](config/clip.env.example).

En mostrador, el cajero elige un control **1–30 antes de cobrar**. Su número se conserva al recargar, se guarda en el comprobante y aparece en el ticket del cliente y cada etiqueta/página del barista. Debajo de los números aparece **Pedido por teléfono**: se guarda sin control, no suma ingresos hasta pagarse y se recupera desde **Pedidos por cobrar**. La excepción se verifica con el pedido persistido en el backend. Una nueva orden vuelve a mostrador. El barista activa el localizador desde su base física; el POS no se comunica por radio con esa base.

## Impresión y recuperación

Las ventas de mostrador generan dos trabajos independientes: cliente a **POS80 Printer** por USB y etiquetas a **Y813BT Sticker** por Bluetooth. El pedido por teléfono guarda sus copias **pendientes de pago** con identidad propia. Al cobrar agrega el recibo pagado y asegura la preparación original si faltaba, sin repetir copias ya aceptadas o inciertas. **Pagados → Comprobar comanda** conserva la recuperación. El servidor usa documentos guardados y un diario SQLite por copia. Reimpresiones históricas y cortes usan el diálogo de Windows.

Los recibos nuevos conservan logo, importes, QR de Instagram y datos del emisor; omiten el nombre individual y las líneas de CFDI retiradas. Las etiquetas nuevas usan el diseño negro `reference-v2`. Los documentos y diarios anteriores no se reescriben. La aceptación física anterior y las comprobaciones pendientes se distinguen en el [registro de impresoras](docs/printer-acceptance-2026-10-31.md).

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

La integración incluye **2,766 comprobaciones de PostgreSQL**, pruebas de aplicación/recuperación y restauración operativa de un respaldo cifrado. GitHub Actions repite los checks Windows y los ensayos Auth/PostgREST, teléfono y restauración en los PR y en `main`; consultar el resultado del commit. El [plan de entrega](docs/delivery-readiness.md) conserva los límites de hardware y puesta en marcha.

Con `POS_BROWSER_QUALITY=1`, el ensayo HTTP también abre Chromium/Edge aislado y ejecuta axe WCAG 2.2 AA, navegación real, conteo cero por UI y revisión de desbordamiento sobre 82 productos de referencia. CI ejecuta este modo. Necesita un navegador Chromium instalado; no usa un perfil personal ni envía papel. Las mediciones locales de carga/eventos se registran como laboratorio, sin atribuirles cumplimiento de Core Web Vitals en campo.

Para enlazar los seis comprobantes SQL con la prueba HTTP de impresión, usar la misma ruta temporal en `POS_RECEIPT_CONTRACT_EVIDENCE` para `test:db` y `test:printing`. CI ya lo hace. Las pruebas no deben tocar ventas del negocio, cobrar tarjetas ni enviar papel.

Más procedimientos: [staging](supabase/staging/README.md), [restauración/rollback](supabase/staging/RECOVERY.md) y [reinicio/PWA](supabase/staging/LIFECYCLE.md).

## Publicación e instalación

La PC de desarrollo prepara el paquete; la del café recibe una versión revisada desde GitHub. El paquete incluye Node, servidor, assets, migraciones y recuperación. El launcher valida el backend, mantiene una única instancia y lee la configuración privada fuera de la carpeta de versión.

Las migraciones 013–016 y el receptor CLIP ya están desplegados. Un respaldo cifrado previo y las huellas de las 28 tablas existentes confirmaron datos conservados. **No reinstalar estas migraciones ni activar CLIP para probar el despliegue.**

La instalación conserva el POS anterior, configuración privada, respaldos y diario de impresión. **017–020 ya están desplegadas**; sus huellas conservaron las 31 tablas existentes y se verificaron respaldos cifrados antes/después. Inventario sigue apagado y no limita ni descuenta ventas; al activarlo se deberán registrar conteos físicos reales. La instalación y aceptación de la app completa en el café siguen siendo pasos separados.

Ver [contrato de base de datos](supabase/README.md), [instalación Windows](docs/windows-deployment.md), [respaldos](docs/business-backups.md) y [revisión de preparación](docs/integration-readiness.md).
