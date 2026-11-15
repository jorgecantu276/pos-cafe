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
