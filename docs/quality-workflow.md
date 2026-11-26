# Revisión coordinada del POS

Cada cambio tiene un implementador y una revisión independiente. Las responsabilidades siguientes se combinan según el alcance; no requieren cuatro agentes ni repetir una revisión completa por cada tarea. Se delegan áreas separables con archivos y criterios de aceptación concretos:

| Responsable | Trabajo | Límite |
| --- | --- | --- |
| Integración | Contratos, migraciones, configuración, pruebas de regresión, build y publicación | Conserva ventas, turnos, datos privados y diarios. No confunde pruebas locales con despliegue. |
| Interfaz | Navegación, grupos de ajustes, controles touch y coherencia visual | Usa los componentes y estilos compartidos; no inventa módulos ni cambia reglas de cobro. |
| Textos | Nombres, acciones, estados y ayuda contextual en español | No describe la implementación al cajero. Conserva las instrucciones necesarias para evitar cobros o impresiones duplicadas. |
| Calidad independiente | Revisión de código, recorridos, capturas y evidencia contra criterios verificables | Solo revisión y comprobaciones. No implementa lo que después evalúa ni realiza una revisión de ciberseguridad. |

Cada implementador tiene archivos asignados. El responsable de integración resuelve los cambios que cruzan áreas y mantiene un único árbol revisado. Calidad informa el problema, su evidencia y el resultado que debería observarse; los implementadores lo corrigen.

## Criterios de interfaz y texto

- Un ajuste tiene nombre, valor y acción. La edición aparece al elegir **Editar**, con el valor actual.
- Los ajustes relacionados usan grupos y filas comunes. La ayuda larga y los datos de soporte quedan en **Detalles**.
- Las acciones de recuperación aparecen cuando existe un cambio pendiente. Guardar un dato nuevo nunca recupera silenciosamente un dato anterior de otra ventana.
- La venta incierta dice **No vuelvas a cobrar**. Un envío a Windows no se llama **Impreso** hasta comprobar el papel.
- El tipo guardado para una próxima apertura se diferencia del tipo aplicado al turno abierto.
- Los controles principales tienen al menos 44×44 CSS px; las áreas de uso frecuente apuntan a 48–56 px.

## Evidencia antes de integrar

1. Pruebas funcionales y de recuperación pertinentes al cambio; TypeScript, lint y comprobaciones obligatorias sobre el árbol final.
2. Para cambios de contratos UI/backend, comprobarlos sobre una base local nueva y datos sintéticos. Ningún ensayo cobra tarjetas o envía papel.
3. Para cambios visibles, comprobar las pantallas afectadas en build de producción: accesibilidad, tamaños touch y desbordamiento. Incluir sus estados pendientes y de edición cuando correspondan.
4. Calidad revisa las capturas del mismo build y contrasta los resultados con los cambios. Un estado no probado se declara pendiente; no se inventa una puntuación global.
5. GitHub repite las comprobaciones sobre el commit del PR. Integrar o publicar requiere el alcance autorizado de la tarea y las protecciones del repositorio; pasar pruebas por sí solo no autoriza un despliegue.

## Hallazgos de esta revisión

La revisión independiente encontró y motivó pruebas específicas para guardados nuevos sustituidos por pendientes de otra ventana, devoluciones que perdían sus cantidades y POST de respaldo rechazados por la URL interna de Next. También señaló la zona horaria de tickets recientes, el estado desconocido de CLIP y mensajes de impresión que prometían más de lo que confirmaba el diario.

El [informe de calidad](quality-review.md) conserva alcance, benchmarks y límites del equipo físico. Este procedimiento no modifica las reglas de protección de ventas, pagos o impresión para conseguir un aprobado.
