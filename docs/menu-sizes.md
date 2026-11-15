# Tamaños y leches

Caja muestra una sola tarjeta **Iced Coffee** y una sola tarjeta **Matcha**.
Dentro de cada ficha, el selector de 16 oz / 20 oz aparece junto al nombre.
Después se eligen sabor o preparación, leche y notas. Cambiar el tamaño conserva
una preparación equivalente y sus opciones compatibles. Si esa preparación no
existe en el otro tamaño, hay que elegir una antes de agregarla a la orden.

El tamaño identifica un producto real del catálogo: nombres terminados en
`16 oz` o `20 oz`, con su propio ID y precio. Las opciones de preparación omiten
el tamaño porque ya está visible en el selector. Los productos anteriores
conservan sus IDs; tickets guardados y pedidos telefónicos conservan sus precios.

| Bebida | 16 oz | 20 oz |
| --- | --- | --- |
| Iced Coffee, sabores habituales | $95 | $125 |
| Iced Coffee Flan | $130 | No disponible |
| Matcha Cariño | $105 | $140 |
| Matcha Fresa / Mango | $115 | No disponible como esa misma preparación |
| Matcha Cold foam Fresa / Mango | No disponible | $140 |
| Matcha Ceremonial | $140 | No disponible |

Iced Coffee conserva el grupo **Tipo de Leche**: entera, deslactosada y
deslactosada light sin recargo; almendra, avena, coco y Lala 100 suman $15.
Matcha usa **Leche alternativa**, con las seis leches existentes sin recargo y
Lala 100 sin recargo con el ajuste de noviembre. El ajuste sustituye **Fruta
extra** por **Cold foam extra** a $15 en las siete presentaciones de Matcha.
Ceremonial muestra el extra en una sola sección. Los cambios conservan los
identificadores y precios base de los productos.

**Chai Latte** conserva la tarjeta de 16 oz, con **Frío** y **Caliente** a $95.
Avena, almendra y coco cuestan $15 adicionales en el grupo **Tipo de Leche**.

La migración 023 exige una sola elección de leche alternativa en venta manual,
cotización CLIP y pedidos telefónicos. La actualización del catálogo se aplicó
con guardas de revisión y solicitudes auditadas, conservando las filas anteriores
de inventario. Las nuevas presentaciones empiezan en modo de disponibilidad,
sin cantidades inventadas. Los borradores con un extra que ya no corresponde
deben revisarse; no se modifica una solicitud de cobro pendiente.

El ajuste de noviembre está en
[`scripts/catalog/november-matcha-extras.sql`](../scripts/catalog/november-matcha-extras.sql).
La prueba `npm run test:db` lo aplica a un catálogo de ensayo en PostgreSQL
local y comprueba los importes nuevos y la recuperación de tickets anteriores.
