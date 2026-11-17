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

La familia POS tiene una sola versión en **config/pos-versions.json**. Ejecuta **npm run versions** para ver la versión actual y las etiquetas de Café, Smoothies y Papelería. Para una entrega, cambia la versión una vez y prepara los tres paquetes con ese mismo valor, incluso si la corrección es de un solo producto.

La candidata actual es **1.0.0-rc.3**. Incluye Next.js 16.4.6 en Café y Smoothies. `versions verify` rechaza paquetes de familias o commits distintos y paquetes generados con cambios sin guardar en Git. Papelería conserva su aplicación nativa y toma la misma versión del catálogo.

Usa **X.Y.Z** para una versión estable y **X.Y.Z-rc.N** para una candidata. Incrementa Z para correcciones, Y para funciones compatibles y X para cambios de compatibilidad. Incrementa N para otra candidata. La primera candidata sincronizada es **pos-v1.0.0-rc.2**.

Cada paquete tiene su etiqueta de producto, su propio commit y el identificador de la entrega de la familia. Papelería compila desde su proyecto nativo con la versión del catálogo compartido. Usa un checkout de Papelería con soporte de la familia y ejecuta estos comandos desde el checkout compartido.

    npm run release:papeleria -- "C:\ruta\papeleria-family" "C:\ruta\paquetes"
    npm run versions -- inspect "C:\ruta\al\paquete\release.json"
    npm run versions -- verify "C:\ruta\cafe" "C:\ruta\smoothies" "C:\ruta\papeleria"

Agrega **--demos** al comando de Papelería para empaquetar los dos demos con la misma versión. El comando verify comprueba que los tres paquetes pertenecen a la versión y al mismo commit de la familia. Los paquetes anteriores conservan su versión o identificador original. El registro de instalación de cada cliente confirma qué paquete quedó activo.

## Publicación de Smoothies

La descarga automática de Smoothies usa paquetes genéricos firmados. No se incluyen el menú de la clienta, sus cuentas, las claves de Supabase ni datos de operación. Papelería y los paquetes de un destino específico no se adjuntan a la descarga pública de Smoothies.

El responsable conserva la clave Ed25519 fuera del repositorio. `scripts/releases/provision-update-signing.mjs` crea la clave una vez y comprueba que su parte pública coincida en las siguientes ejecuciones. Nunca cambies esa clave para preparar una versión nueva: las instalaciones conservan su confianza inicial.

Después de probar los tres paquetes desde el mismo commit limpio, comprime la carpeta raíz de Smoothies como `POS-Smoothies-<version>.zip`. Publica el commit y su etiqueta ligera `pos-v<version>`. Luego ejecuta:

    node scripts/releases/publish-smoothies-release.mjs <clave-privada> <paquete-cafe> <paquete-smoothies> <paquete-papeleria> <zip-smoothies> <nuevo-pilot.json> <notas-version.txt>

El comando vuelve a comprobar las versiones, firma el hash del ZIP y del índice de archivos, publica una candidata en GitHub Releases y actualiza el canal firmado `pos-family-feed/smoothies/pilot.json`. Solo promueve el canal después de comprobar que el ZIP se descarga. La clave privada no se sube a GitHub. Los registros `.published.json` conservan el commit de publicación del canal.

Las propuestas de Dependabot siguen pasando por revisión y CI antes de preparar una versión firmada. La descarga automática no autoriza migraciones ni convierte una propuesta de dependencias en una entrega al negocio.
