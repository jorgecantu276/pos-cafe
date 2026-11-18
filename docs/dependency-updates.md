# Actualizaciones de dependencias

Dependabot propone cambios; no instala paquetes en la computadora del café. Revisa npm y GitHub Actions cada semana. Los cambios menores y de parche se agrupan por dependencias de ejecución, herramientas y Actions; una actualización mayor permanece separada. `npm ci` instala exactamente el lockfile en CI y durante la compilación, no la última versión que exista ese día.

Las propuestas ejecutan el mismo flujo de verificación que los demás PR: interfaz y lógica, TypeScript/lint, PostgreSQL, autenticación, pedidos telefónicos, restauración, impresión simulada, auditorías de dependencias y paquetes portátiles. La comprobación estable **Required verification** solo pasa si todos los trabajos terminan con `success`. Un fallo, cancelación, omisión o resultado ausente la hace fallar. Este trabajo no publica ni dispone de permisos de escritura.

## Límite entre propuesta y producción

1. Dependabot abre un PR con versiones y lockfile revisables.
2. CI prueba ese cambio con datos sintéticos; no hay acceso al café, impresoras físicas ni claves de cobro en ese flujo.
3. El responsable revisa el cambio, los avisos del proveedor y las pruebas. Una versión mayor o cambio de contrato requiere revisión específica.
4. Se prepara un paquete desde el commit limpio aprobado, con identidad y hashes. Se comprueba el instalador sobre una copia y se conserva la aplicación anterior junto con la configuración y el diario actuales.
5. El responsable publica y programa la instalación. Actualizar dependencias, fusionar un PR y publicar/instalar una versión son pasos distintos.

No hay un trabajo de despliegue en `.github/workflows`; el repositorio tiene el auto-merge desactivado. Las herramientas de publicación manual bajo `scripts/releases` requieren una invocación explícita y los materiales correspondientes. El actualizador firmado de Smoothies es un mecanismo de distribución de versiones publicadas; no ejecuta `npm update` ni transforma propuestas de Dependabot en versiones. No confundirlo con el actualizador separado de Café/Etapa 2.

## Protección pendiente en GitHub

Comprobación de solo lectura del 18 de noviembre de 2026: `main` no tiene protección clásica ni reglas activas (`branches/main/protection` devuelve 404, `rules/branches/main` y `rulesets` devuelven listas vacías). Los tests existen, pero esa configuración permite que una persona con permisos los omita mediante un push o una fusión manual. **Este cambio de código no activa protección remota.**

Después de que el nuevo check se ejecute al menos una vez, configurar una regla de `main` para exigir PR y **Required verification**, exigir que la rama esté actualizada y evitar omisiones de estas reglas, incluidos administradores. Mantener desactivados force-push y borrado de la rama. Usar revisión por otra persona cuando exista un segundo mantenedor; exigir una aprobación externa en un repositorio de una sola persona bloquearía también las correcciones legítimas. La autorización y aplicación de esta configuración remota se coordinan por separado.

Las pruebas reducen el riesgo; no garantizan ausencia de defectos. Para el café, la aceptación en su PC/red y una vuelta atrás que conserve el diario de impresión actual siguen siendo necesarias.

Referencias: [sintaxis de dependencias y estados de trabajos](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds), [ramas protegidas y reglas exigibles](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
