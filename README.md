# Cariñito Mío POS

[![Verificación Windows](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml/badge.svg?branch=main)](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml)

Punto de venta para una cafetería con una sola caja física. Next.js 16.4.3, React 19, TypeScript, Supabase y Zustand. La interfaz táctil mantiene el menú a la izquierda, la orden a la derecha y el cobro visible, con textos en español.

## Última versión — 15 de noviembre de 2026

[**pos-91f282d — Etapa 1: menú y etiquetas**](https://github.com/jorgecantu276/pos-cafe/releases/tag/pos-91f282d) incluye el paquete de Windows, el actualizador de Caja, las instrucciones y el ajuste de catálogo para Supabase. El código se integró en `main` mediante el [PR #15](https://github.com/jorgecantu276/pos-cafe/pull/15).

Matcha ofrece **Cold foam extra por $15 MXN** y **Lala 100 sin recargo** después del ajuste de catálogo. Cada brownie con nieve recibe una etiqueta de barra por pieza. Los demás postres se agrupan en una sola etiqueta por orden. La actualización del catálogo y la comprobación de las impresoras se realizan durante la pausa de instalación en el café.

| Área | Estado |
| --- | --- |
| Ventas, Caja, Catálogo y Clientes | Conectados al backend; pruebas con datos sintéticos y Auth/PostgREST local. |
| Menú y tamaños | Una tarjeta por familia de bebida. Iced Coffee y Matcha permiten elegir **16 oz / 20 oz**, preparación y leche. El ajuste de noviembre actualiza los extras de las siete presentaciones de Matcha. Ver [tamaños y leches](docs/menu-sizes.md). |
| Backend y migraciones | El repositorio conserva **22 migraciones: 001, 002 y 004–023**. El registro del 2 de noviembre confirma 017–021 desplegadas con respaldos y huellas conservadas; el PR #12 registra la aplicación de 023 y del catálogo de tamaños. La etapa 1 incluye un ajuste de datos separado que requiere el esquema de la 023. |
| Receptor CLIP | `clip-webhook` v1 desplegado y verificado. Recibir un aviso no crea ni aprueba un cobro. |
| Cobro automático CLIP | **Apagado. Token de ejemplo.** Pendiente de habilitación de PinPad, token real y aceptación con la terminal. |
| Controles de entrega 1–30 | Obligatorios en mostrador. **Pedido por teléfono** permite guardar sin control y cobrar al recoger. |
| Pedidos por teléfono | Pendientes compartidos entre turnos, precio acordado, preparación sin pagar y cobro único al recoger. Ver [flujo completo](docs/phone-orders.md). |
| Distribución Windows | El actualizador de la etapa 1 requiere una Caja instalada en `99d1675`. Confirmar la versión en la PC del café antes de instalar. |
| Preparación de postres | Una etiqueta por brownie con nieve y una etiqueta compacta para los demás postres de la orden, ambas en la Y813BT. La aceptación física de la etapa 1 sigue pendiente en la PC del café. |
| Inventario | Integrado en Catálogo; migración 017 desplegada y **apagado al inicio**. No se inventan existencias. |
| Tipo de cambio del negocio | Último cambio documentado, el 2 de noviembre: **1 USD = 16 MXN** para nuevas aperturas. El turno que entonces estaba abierto conservó 18; cada turno mantiene su tasa y sus ventas no se recalculan. |

La [revisión de integración y preparación](docs/integration-readiness.md) conserva las evidencias y condiciones del 2 de noviembre. Los [PR #12](https://github.com/jorgecantu276/pos-cafe/pull/12) y [#15](https://github.com/jorgecantu276/pos-cafe/pull/15) documentan los cambios posteriores. Pasar pruebas locales no equivale a aceptar toda la operación del café.

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

- **Iced Coffee** conserva el grupo **Tipo de Leche**. Entera, deslactosada y deslactosada light se ofrecen sin recargo. Almendra, avena, coco y Lala 100 suman $15 MXN.
- **Matcha** usa el grupo **Leche alternativa**. Con el ajuste de noviembre, las seis leches existentes y Lala 100 quedan sin recargo. **Cold foam extra** sustituye a **Fruta extra** por $15 MXN en las siete presentaciones, con una sola sección de ese extra en Ceremonial. Cada presentación conserva su ID y precio base.
- **Chai Latte** se ofrece en 16 oz, frío o caliente, por $95 MXN. Avena, almendra y coco suman $15 MXN.

La migración **023** exige una sola leche alternativa en venta manual, cotización CLIP y pedido telefónico. Ver [detalle del menú y compatibilidad](docs/menu-sizes.md).

## CLIP y controles de entrega

La terminal identificada es una **Clip Total 3, modelo K1352**. Tarjeta funciona inicialmente de forma manual: cobrar en la terminal y confirmar su aprobación en el POS.

La integración automática guarda una cotización validada por el servidor antes de enviar un único intento a CLIP. Verifica el resultado mediante consulta autenticada y completa una sola venta. Un timeout conserva el pago original y bloquea otro cobro/cierre hasta resolverlo. Los avisos recibidos son pistas que deben verificarse; un webhook por sí solo nunca aprueba la venta.

**Mantener `POS_CLIP_ENABLED=0` / `ClipEnabled: false`.** El token real pertenece a un archivo privado fuera de la versión instalada; no va en Git ni en variables `NEXT_PUBLIC_`. Los ejemplos solo contienen un placeholder. Ver [configuración, despliegue y recuperación](docs/clip-payments.md) y [ejemplo de entorno](config/clip.env.example).

En mostrador, el cajero elige un control **1–30 antes de cobrar**. Su número se conserva al recargar, se guarda en el comprobante y aparece en el ticket del cliente y cada etiqueta/página del barista. Debajo de los números aparece **Pedido por teléfono**: se guarda sin control, no suma ingresos hasta pagarse y se recupera desde **Pedidos por cobrar**. La excepción se verifica con el pedido persistido en el backend. Una nueva orden vuelve a mostrador. El barista activa el localizador desde su base física; el POS no se comunica por radio con esa base.

## Impresión y recuperación

Las ventas de mostrador generan trabajos independientes según su contenido: ticket del cliente a **POS80 Printer** por USB y preparación de bebidas/postres a **Y813BT Sticker** por Bluetooth. El pedido por teléfono guarda sus copias **pendientes de pago** con identidad propia. Al cobrar agrega el recibo pagado y asegura la preparación original si faltaba, sin repetir copias ya aceptadas o inciertas. **Pagados → Comprobar comanda** conserva la recuperación. El servidor usa documentos guardados y un diario SQLite por copia. Reimpresiones históricas y cortes usan el diálogo de Windows.

Los recibos nuevos conservan logo, importes, QR de Instagram y datos del emisor; omiten el nombre individual y las líneas de CFDI retiradas. Las etiquetas de bebidas usan el diseño negro `reference-v2`. Los documentos y diarios anteriores no se reescriben. La aceptación física anterior y las comprobaciones pendientes se distinguen en el [registro de impresoras](docs/printer-acceptance-2026-10-31.md).

Desde `pos-91f282d`, cada **brownie con nieve** lleva una etiqueta por pieza en el mismo trabajo de barra que las bebidas, con numeración propia **POSTRE**. Las bebidas conservan una etiqueta por vaso y su propio conteo. Los demás **Postres** se agrupan en **una sola etiqueta de 57 × 32 mm** con el diseño `desserts-compact-v1`, cantidades, modificadores y notas, sin precios. Ambos trabajos de preparación van a **Y813BT Sticker**. El ticket del cliente se procesa por separado.

El diseño compacto ajusta Arial Bold entre 8.5 y 6.5 pt para conservar todo el texto en una etiqueta. Si la preparación supera el espacio de su formato, el trabajo afectado queda pendiente de revisión antes de enviarse a la impresora. El ticket del cliente sigue disponible. **La comprobación en papel de la etapa 1 sigue pendiente en el café.** Los documentos históricos conservan su formato, impresora e identidad. Ver [impresión y recuperación](docs/printing.md).

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

La validación local de `pos-91f282d` registró **287 pruebas de aplicación**, **2,924 comprobaciones de PostgreSQL**, pruebas de la API de impresión de producción con impresoras simuladas e instalación y arranque del ZIP exacto en Windows. Ver [PR #15](https://github.com/jorgecantu276/pos-cafe/pull/15).

GitHub Actions repite lint, TypeScript, pruebas, auditorías, compilación, impresión simulada y empaquetado Windows. Los ensayos de administración, teléfono y restauración usan **tres máquinas independientes**, con puertos reservados para evitar conflictos. La [verificación de Windows y backend del PR #15](https://github.com/jorgecantu276/pos-cafe/actions/runs/43760554771) terminó correctamente. El [plan de entrega](docs/delivery-readiness.md) conserva los límites de hardware y puesta en marcha.

Con `POS_BROWSER_QUALITY=1`, el ensayo HTTP también abre Chromium/Edge aislado y ejecuta axe WCAG 2.2 AA, navegación real, conteo cero por UI y revisión de desbordamiento sobre 82 productos de referencia. CI ejecuta este modo. Necesita un navegador Chromium instalado; no usa un perfil personal ni envía papel. Las mediciones locales de carga/eventos se registran como laboratorio, sin atribuirles cumplimiento de Core Web Vitals en campo.

Para enlazar los seis comprobantes SQL con la prueba HTTP de impresión, usar la misma ruta temporal en `POS_RECEIPT_CONTRACT_EVIDENCE` para `test:db` y `test:printing`. CI ya lo hace. Las pruebas no deben tocar ventas del negocio, cobrar tarjetas ni enviar papel.

Más procedimientos: [staging](supabase/staging/README.md), [restauración/rollback](supabase/staging/RECOVERY.md) y [reinicio/PWA](supabase/staging/LIFECYCLE.md).

## Publicación e instalación

La PC de desarrollo prepara el paquete; la del café recibe una versión revisada desde GitHub. El paquete incluye Node, servidor, recursos, migraciones y recuperación. El iniciador valida el backend, mantiene una única instancia y lee la configuración privada fuera de la carpeta de versión. El instalador crea el acceso **Cariñito Mío POS** y abre Caja en una ventana propia de Edge.

### Actualizar una Caja instalada

1. Confirmar que la PC del café tiene la versión `99d1675` y que hay un respaldo válido. Terminar el turno y cerrar Caja.
2. Descargar [`POS-Cafe-91f282d.zip`](https://github.com/jorgecantu276/pos-cafe/releases/download/pos-91f282d/POS-Cafe-91f282d.zip) y [`Actualizar-Caja-91f282d.ps1`](https://github.com/jorgecantu276/pos-cafe/releases/download/pos-91f282d/Actualizar-Caja-91f282d.ps1). Seguir [`Etapa-1-Caja.txt`](https://github.com/jorgecantu276/pos-cafe/releases/download/pos-91f282d/Etapa-1-Caja.txt). El actualizador verifica el paquete y conserva la instalación anterior, la configuración privada y el diario de impresión.
3. Durante la misma pausa, guardar las filas de catálogo afectadas y aplicar por separado [`Menu-Matcha-Etapa-1.sql`](https://github.com/jorgecantu276/pos-cafe/releases/download/pos-91f282d/Menu-Matcha-Etapa-1.sql) en Supabase. El actualizador de Windows solo instala el paquete. Ver [SQL versionado](scripts/catalog/november-matcha-extras.sql).
4. Abrir Caja, confirmar el acceso al backend, comprobar los extras de Matcha y revisar la primera impresión aplicable en el café antes de continuar con otra etapa.

SHA-256 del ZIP publicado:

```text
78fcc85c804980feafdaa4c742c0ce9e44849c3fab2fa90c276c40be9cf2bf9b
```

Para una instalación nueva, preparar el paquete vigente con su contrato de backend y la configuración privada en `C:\POS-Cafe\private\pos-cafe-config.json`. El [instalador inicial `pos-8fe948b`](https://github.com/jorgecantu276/pos-cafe/releases/tag/pos-8fe948b) queda disponible como versión histórica.

### Datos y recuperación

Conservar el POS anterior durante la aceptación, la configuración privada, los respaldos y **el diario actual con sus archivos WAL/SHM**. No restaurar un diario viejo para volver de versión. Para recuperar trabajos pendientes tras volver de versión, usar una compilación compatible con los documentos guardados, incluido el formato `desserts-compact-v1` y los trabajos `desserts`.

Las migraciones 013–021 y el receptor CLIP tienen despliegue documentado; el PR #12 registra además la migración 023 y el catálogo actualizado. La **022** agrega almacenamiento para fotos del catálogo. Para un destino nuevo, revisar la compatibilidad del esquema y las **22 migraciones retenidas (001, 002 y 004–023)**; para uno existente, comprobar su historial y aplicar solo las pendientes mediante un procedimiento con respaldo. El actualizador de Windows no sustituye ese proceso.

Mantener **CLIP e inventario apagados** hasta su habilitación explícita. Al activar inventario se deben registrar conteos físicos reales. Conservar los respaldos cifrados y su clave por separado fuera de la PC. Los registros de despliegue del 2 de noviembre documentan las copias y huellas verificadas en esa fecha.

Ver [contrato de base de datos](supabase/README.md), [instalación Windows](docs/windows-deployment.md), [respaldos](docs/business-backups.md) y [revisión de preparación](docs/integration-readiness.md).
