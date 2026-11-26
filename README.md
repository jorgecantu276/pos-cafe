# POS Café y Smoothies

[![Verificación Windows](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml/badge.svg?branch=main)](https://github.com/jorgecantu276/pos-cafe/actions/workflows/windows-verification.yml)

Aplicación de caja en español con perfiles de Café y Smoothies. Comparten código y contratos financieros; cada instalación conserva su propia configuración, cuentas, backend y datos. Papelería tiene una aplicación nativa separada dentro de la familia POS.

## Estado del producto

El propietario identifica **Café como el único producto en operación real**. Smoothies sigue en preparación. Una versión en GitHub, una demo o una prueba local no demuestran qué ejecuta una tienda.

- [Café: necesidades, avances y próximos pasos](docs/products/cafe.md)
- [Smoothies: necesidades, avances y próximos pasos](docs/products/smoothies.md)
- [Código compartido y versiones de familia](docs/shared-pos-local.md)

Las versiones de software se consultan en `package.json`, archivos de bloqueo y `config/pos-versions.json`; las instaladas se comprueban mediante el reporte real del equipo. Los documentos fechados conservan evidencia histórica, no instrucciones actuales de activación.

## Operación

- **Venta:** catálogo y orden juntos, cantidades, opciones, notas y cobro visible. El servidor calcula precios y recupera la misma venta ante respuestas perdidas.
- **Caja:** una caja física, arqueo, gastos, tipo de cambio guardado y entrega contada entre cajeros. El tipo nuevo no modifica ventas ni turnos históricos.
- **Catálogo:** productos, fotos, extras y favoritos. Inventario de productos terminados opcional: activación explícita y conteos reales, sin cantidades inventadas.
- **Teléfono:** pedidos sin pagar, precio acordado, preparación recuperable y cobro único al recoger.
- **Clientes:** búsqueda por teléfono y puntos existentes; no se inventan reglas de canje.
- **Impresión:** documentos guardados y diario por copia. Ticket, preparación, envío aceptado por Windows y papel observado son estados distintos.
- **Smoothies:** perfil local, importación del formulario y recetario según su configuración; no reactiva recetas en Café.

Café requiere conexión a su backend para vender. Instalarlo en Windows o como PWA no proporciona una cola de ventas offline. El modo local de Smoothies tiene su propio backend y requisitos.

## Desarrollo y revisión

```powershell
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run build:verify
```

Usar las versiones y comandos declarados por el proyecto. Los ensayos de base de datos/HTTP requieren sus dependencias y puertos de prueba libres; consultar `package.json` y la [guía de staging](supabase/staging/README.md). Los ensayos usan datos sintéticos, backend aislado y proveedores/impresoras simulados. No reutilizar `.env.local` histórico como destino de cliente.

Cada cambio tiene un implementador y una revisión independiente sobre la revisión final. Separar más trabajos solo cuando tengan responsabilidades propias. Las pruebas se eligen por el comportamiento afectado; los checks requeridos de GitHub siguen siendo obligatorios. Ver [AGENTS.md](AGENTS.md) y [flujo de calidad](docs/quality-workflow.md).

El [mapa de código compartido](docs/shared-pos-local.md#mapa-de-integración) identifica los contratos de venta, caja, impresión, recuperación y actualización. Las apariencias de caja usan los mismos handlers; conservar una apariencia anterior no permite recuperar lógica financiera anterior. Café y Smoothies todavía tienen ramas de entrega distintas: una corrección común se integra y prueba en cada variante antes de promover la familia.

## Instalar, actualizar y recuperar

El paquete de Windows incluye runtime y aplicación compilada. La preparación inicial verifica cliente, backend, versión previa, configuración privada y acceso de Caja. Los datos, diarios, claves y respaldos permanecen fuera del código reemplazable.

La actualización automática de Café está **desactivada por defecto**. Después de una inscripción inicial aceptada, descarga paquetes firmados compatibles y espera el estado seguro para activarlos; no migra la base automáticamente. Un paquete fallido no justifica restaurar datos antiguos. La publicación conserva el gate común Café/Smoothies/Papelería.

Conservar la configuración de CLIP actualmente aceptada en cada equipo. Los ejemplos desactivados y reportes históricos no describen necesariamente su estado real. Las pruebas nunca cobran tarjetas. Un pago incierto se consulta por su identidad original; cancelar una venta no reembolsa la terminal.

- [Paquete e instalación Windows](docs/windows-deployment.md)
- [Actualización automática de Café](docs/windows-auto-update.md)
- [Instalación local de Smoothies](docs/smoothies-local.md)
- [CLIP y recuperación de pagos](docs/clip-payments.md)
- [Respaldos y límites de restauración](docs/business-backups.md)
- [Aceptación de entrega](docs/delivery-readiness.md)

## Guías por responsabilidad

| Tema | Documento |
| --- | --- |
| Borradores y respuestas perdidas | [cart-drafts](docs/cart-drafts.md) |
| Caja única, entrega y lealtad | [single-drawer](docs/single-drawer.md) |
| Gastos y cortes | [shift-expenses](docs/shift-expenses.md) |
| Pedidos por teléfono | [phone-orders](docs/phone-orders.md) |
| Inventario opcional | [inventory](docs/inventory.md) |
| Tamaños y opciones del catálogo | [menu-sizes](docs/menu-sizes.md) |
| Pantallas y navegación | [workspace](docs/workspace.md) |
| Tablero del propietario en TV | [tv-dashboard](docs/tv-dashboard.md) |
| Impresión y documento financiero | [printing](docs/printing.md), [receipt-data-contract](docs/receipt-data-contract.md) |
| Contrato y migraciones | [Supabase](supabase/README.md) |
| Evidencia física histórica | [printer acceptance](docs/printer-acceptance-2026-10-31.md) |
| Hallazgos y aceptación histórica | [quality review](docs/quality-review.md), [integration readiness](docs/integration-readiness.md) |

Los incidentes y avances actuales se registran con versión, síntoma, evidencia y siguiente acción. Claves, datos del cliente, identificadores de máquina y respaldos privados no pertenecen a issues públicos ni a este repositorio.
