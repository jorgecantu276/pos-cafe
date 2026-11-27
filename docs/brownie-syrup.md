# Jarabe para brownies con nieve

Regla confirmada por el cliente el 27 de noviembre de 2026: elegir **una** opción
entre Caramelo, Caramelo salado, Chocolate y Sin jarabe, incluida en el precio.
El ajuste conserva IDs, precios, existencias, otras preparaciones y documentos
guardados. El grupo exclusivo `Jarabe Brownie` solo se asigna a los productos
activos de Postres cuyo nombre empieza por Brownie y contiene la palabra nieve.
El plan muestra los productos exactos antes de escribir; cualquier cambio
posterior en sus filas impide aplicar o revertir ese plan.

## Entrega

La Caja rc.6 `b776550` no reconoce este grupo como selección obligatoria única.
Agregar extras solamente al catálogo no cumple la regla. Primero se requiere un
paquete aceptado con esta interfaz y su contrato de base de datos; se conserva el
proceso de revisión, familia y cliente de `AGENTS.md`. Compilar o abrir un PR no
equivale a publicar ni instalar ese paquete.

La migración nueva `202611270026_brownie_syrup_choice.sql` incorpora la validación
de exactamente una opción en venta manual, cotización CLIP y pedido telefónico.
No modifica los productos ni los extras. Se aplica como mantenimiento deliberado
del backend verificado, con el respaldo y ensayo que exige el proceso existente;
el actualizador de Caja no aplica migraciones. Las migraciones anteriores no se
editan. Los reintentos de ventas ya guardadas conservan su resultado original.

## Operación del catálogo después de aceptar el paquete y backend

`scripts/catalog/Actualizar-Jarabes-Brownie.ps1` usa Windows PowerShell 5.1 y el
Node/driver PostgreSQL incluidos en la instalación. Por defecto **Inspect** solo
comprueba manifiesto, configuración y todos los archivos indexados. Plan/Apply
requieren además la capacidad `brownie-syrup-v1` del nuevo paquete. Este script
no descarga ni instala Caja, publica versiones, activa actualizaciones, aplica
migraciones, cobra o imprime.

1. Ejecutar `-Mode Inspect` en la PC para obtener evidencia reciente. No pedir al
   operador copiar claves ni ejecutar el JSON de salida como comandos.
2. Con el paquete y mantenimiento de backend aceptados, ejecutar `-Mode Plan`.
   La conexión PostgreSQL se pide oculta, se verifica contra el proyecto instalado
   y se elimina del entorno al terminar. Nunca se guarda en el plan. TLS siempre
   verifica el certificado; la URL no puede sobrescribir host/usuario por query.
3. Revisar los productos del plan privado devuelto y ejecutar `-Mode Apply
   -PlanFile <ruta-devuelta>`. El plan queda en `%LOCALAPPDATA%/PosFamilyOps/cafe-menu`,
   fuera de Git y de los programas. Conserva las filas anteriores y posteriores
   antes del COMMIT; un reintento reconcilia el resultado incierto sin duplicar IDs.
4. Recargar Caja. Comprobar las cuatro opciones, sustitución de una por otra,
   rechazo de agregar sin elegir y precio sin recargo, sin generar cobros o papel
   de prueba en producción. La aceptación física sigue el procedimiento del cliente.

`-Mode Rollback -PlanFile <misma-ruta>` revierte solo la asignación si las filas
siguen exactamente como las dejó Apply. Desactiva los nuevos extras y conserva sus
IDs y todos los tickets anteriores. No revierte programas ni base de datos; el
código de la regla queda inactivo al quitar su grupo. Un cambio posterior exige
reconciliar el catálogo; nunca se sobreescribe con una copia vieja.

## Verificación

`npm test`, `npm run typecheck`, `npm run lint`, `npm run test:db` y
`npm run build:verify`. El ensayo SQL cubre 0/1/varios jarabes, duplicados,
extras ajenos, las tres rutas de cotización, precio incluido, histórico intacto,
conflictos de catálogo, grupos desactivados y reintentos/rollback inciertos.
La prueba CLI usa un driver sintético sin red para comprobar el destino y TLS.
La verificación de paquetes, CI obligatoria e instalación real son gates separados.
