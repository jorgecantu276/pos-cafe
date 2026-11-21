# Cheesecakes y total en dólares — 21 de noviembre de 2026

POS Café rc.5 aplica el mismo comportamiento de brownie con nieve a las seis
rebanadas de cheesecake: natural, frutos rojos, lotus, plátano, resses y tortuga.
Cada pieza recibe una etiqueta individual de preparación con nombre, notas,
folio y control de entrega. Comparten la numeración POSTRE; los vasos mantienen
su propio conteo. Los demás postres conservan la comanda agrupada.

Cobrar muestra Total MXN, Total USD y el tipo de cambio del turno abierto en
efectivo, MXN + USD y tarjeta. El importe USD se redondea hacia arriba al dólar
entero: $130 MXN a 16 MXN/USD pide $9 USD y cotiza $14 MXN de cambio.
**Recibir $9 USD** registra esos dólares y calcula el cambio real en pesos; no
aumenta el precio de la venta. Se reciben dólares enteros, sin monedas de USD.
Los pagos mixtos y billetes mayores calculan el cambio con todo el efectivo
realmente recibido. La venta y los envíos a CLIP siguen en MXN. El pedido
telefónico usa el tipo del turno al cobrar.
POS Smoothies conserva su pantalla de cobro en pesos.

La apertura, el arqueo/cierre, la recepción entre cajeros y el cierre por
responsable comparten la misma conversión decimal. Esto evita diferencias de un
centavo al contar USD con una tasa de hasta cuatro decimales. Cada operación
conserva su tasa de turno o entrega, sin usar la de una apertura futura.

Las etiquetas telefónicas nuevas usan la cabecera `T0042 · SIN PAGAR`, dejando
espacio para cantidades de dos dígitos y continuaciones con notas. El texto
guardado de la comanda sigue identificando el pedido por teléfono. Los documentos
ya registrados conservan sus textos, colas, audiencias y estados originales.

## Contexto del despliegue

- [PR 15](https://github.com/jorgecantu276/pos-cafe/pull/15): etiquetas individuales
  de brownie con nieve, origen de esta regla.
- [pos-410ead4](https://github.com/jorgecantu276/pos-cafe/releases/tag/pos-410ead4):
  corrección de opciones de Matcha y último despliegue de menú confirmado en ese
  historial.
- [PR 22](https://github.com/jorgecantu276/pos-cafe/pull/22) y
  [Café rc.4](https://github.com/jorgecantu276/pos-cafe/releases/tag/cafe-v1.0.0-rc.4):
  base actual de main, Next 16.4.6 y tablero de preparación automático.

Esta corrección parte de main e incluye esa base. No incorpora las ramas abiertas
del actualizador automático, monitor diario, rediseño anterior de TV ni propuestas
de dependencias. La versión del código compartido avanza a rc.5; el paquete de esta
entrega corresponde únicamente a Café.

No necesita migraciones ni cambios de catálogo. La instalación conserva la
configuración privada, el diario de impresión actual, respaldos y versión anterior.
Se termina el cobro en curso y se cierra la aplicación durante la sustitución;
el turno puede permanecer abierto. No se modifica la configuración de CLIP ni se
ejecutan pruebas de pago contra el negocio. La validación local usa datos aislados
y no acredita una impresión física o instalación en el café.
