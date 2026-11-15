# Familia POS en desarrollo local

El código de Café y Smoothies se compila desde este árbol con Node 24.22.2. El valor de compilación de NEXT_PUBLIC_POS_PROFILE es cafe por defecto. El lanzador de Smoothies y su empaquetador seleccionan smoothies explícitamente.

Cada instalación configura su propia base de datos y sus propias cuentas. Café usa sus migraciones de supabase/migrations. La instalación dedicada de Smoothies aplica además las de supabase/smoothies. La existencia de un perfil en este árbol no da acceso a los datos de otro cliente.

| Comprobación local | Comando |
| --- | --- |
| Lint, tipos y pruebas compartidas | npm run lint, npm run typecheck, npm test |
| Café con impresoras simuladas | npm run test:printing |
| Smoothies, inicio de sesión e importación en Edge | node scripts/smoothies/import-drill.mjs --browser |
| Smoothies, venta y reintento en Supabase local | node scripts/smoothies/local-sale-drill.mjs |

Las pruebas con Supabase levantan una instancia desechable con datos sintéticos. Ejecuta los ensayos de Smoothies uno a la vez, ya que comparten los puertos de prueba. Para los requisitos de la instalación real, consulta [la guía de Smoothies](smoothies-local.md).

## Prueba local de Papelería

El ensayo de Papelería ejecuta el carrito y el generador de tickets compartidos con una base SQLite sintética. Cubre lectura de códigos con ceros iniciales, venta en MXN, reintento, cancelación y restauración. La prueba evita archivos del negocio y no es un instalador de Papelería.

    node --import tsx scripts/papeleria/trial.mts

## Versiones de la familia POS

Ejecuta **npm run versions** para ver las versiones registradas de Café, Smoothies y Papelería. El catálogo está en **config/pos-versions.json**. Cada producto lleva su propia secuencia de versión. Papelería registra la versión de su proyecto nativo mientras siga compilándose allí.

Usa **X.Y.Z** para una versión estable y **X.Y.Z-rc.N** para una candidata. Incrementa Z para correcciones, Y para funciones compatibles y X cuando cambie la compatibilidad. Aumenta N para otra candidata de la misma versión. Actualiza la entrada del producto antes de preparar su próxima entrega. Las candidatas del catálogo indican el estado del código local.

Los paquetes de Café y Smoothies escriben el nombre de producto, versión, etiqueta y commit completo en **release.json**. Los identificadores que usan los instaladores se conservan. En Café, **410ead4** es un commit abreviado. En Smoothies, el campo **id** identifica el paquete concreto. Para comprobar qué se copió a una caja, inspecciona su manifiesto y guarda el resultado con el registro de instalación de ese cliente.

    npm run versions -- inspect "C:\ruta\al\paquete\release.json"

Los paquetes anteriores siguen mostrando su identificador original y aparecen como **Legacy package**. El catálogo describe las versiones del proyecto. El manifiesto de la caja confirma la versión instalada.
