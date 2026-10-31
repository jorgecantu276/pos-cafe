import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = process.argv[2];
const issuerSource = process.argv[3];
assert.ok(destination && path.isAbsolute(destination), 'Pass a new absolute output directory whose parent exists');
if (issuerSource) assert.ok(path.isAbsolute(issuerSource), 'The optional issuer profile must use an absolute local path');
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.22.2');
const probe = new DatabaseSync(':memory:');
const sqlite = probe.prepare('SELECT sqlite_version() AS version,sqlite_source_id() AS sourceId').get();
probe.close();
assert.equal(sqlite.version, '3.53.4', 'Package only the verified patched SQLite runtime');
await mkdir(destination); // Never overwrite a previously delivered kit/journal.
await mkdir(path.join(destination, 'scripts/printing'), { recursive: true });
const bundle = await build({ entryPoints: [path.join(root, 'scripts/printing/physical-test.ts')],
  outfile: path.join(destination, 'physical-test.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true });
const allowed = ['physical-test.ts', 'cafe-printers.json', 'receipt-branding.json', 'print-journal-server.ts', 'windows-print-server.ts', 'sale-printing.ts', 'receipt-issuer-server.ts'];
assert.ok(Object.keys(bundle.metafile.inputs).every(file => allowed.includes(path.basename(file))), 'Unexpected dependency in hardware kit');
for (const file of ['windows-print.ps1', 'DesktopPrinter.cs']) await copyFile(path.join(root, 'scripts/printing', file), path.join(destination, 'scripts/printing', file));
for (const file of ['Test-CafePrinters.ps1', 'Inspect-CafePrinters.ps1']) await copyFile(path.join(root, 'scripts/printing', file), path.join(destination, file));
await copyFile(path.join(root, 'config/cafe-printers.json'), path.join(destination, 'machine-profile.json'));
await mkdir(path.join(destination, 'public/receipt-branding'), { recursive: true });
await copyFile(path.join(root, 'public/receipt-branding/carinito-logo-v1.jpg'), path.join(destination, 'public/receipt-branding/carinito-logo-v1.jpg'));
if (issuerSource) {
  // Whitelist receipt fields; never package the entire fiscal document, CURP,
  // QR, idCIF, signature or unrelated personal information.
  const value = JSON.parse((await readFile(issuerSource, 'utf8')).replace(/^\uFEFF/, ''));
  const fields = ['legalName', 'rfc', 'taxRegime', 'establishmentAddress', 'postalCode', 'city'];
  assert.ok(value && typeof value === 'object' && fields.every(field => typeof value[field] === 'string' && value[field].trim()), 'Incomplete issuer profile');
  await writeFile(path.join(destination, 'receipt-issuer.json'), JSON.stringify(Object.fromEntries(fields.map(field => [field, value[field]])), null, 2));
}
await copyFile(process.execPath, path.join(destination, 'node.exe'));
const licenseUrl = 'https://raw.githubusercontent.com/nodejs/node/v24.22.2/LICENSE';
const response = await fetch(licenseUrl); assert.ok(response.ok, 'Exact Node runtime license is required');
await writeFile(path.join(destination, 'Node-LICENSE.txt'), await response.text());
const instructions = `CARIÑITO MÍO: PRUEBA DE IMPRESORAS V8
31 DE OCTUBRE DE 2026

Este paquete usa el mismo servicio de impresión de la caja e incluye
Node 24.22.2 x64. Funciona sin ejecutar npm install, sin internet y sin Supabase.
No instala ni reemplaza el punto de venta. Guarda las pruebas en esta PC.
No cobra, cambia inventario, instala controladores, empareja dispositivos,
cambia ajustes predeterminados ni envía comandos de corte, cajón o RAW.

V8 integra el logotipo suministrado, QR local hacia Instagram, frase de cierre
y el diseño de ticket solicitado el 31 de octubre. Conserva los datos del
emisor debajo del pago y las protecciones del registro de impresión.
Incluye tipografía Arial Bold uniforme, columnas explícitas en el ticket y
etiquetas verticales con el diseño local de encabezado/pie. El formato físico
sigue en 57 x 32 mm; el dibujo se gira 90 grados dentro de cada etiqueta.
La prueba física del 31 de octubre aprobó el renderizador de prueba anterior
tras esas correcciones; el diseño combinado de V8 requiere nueva revisión en papel.
Si ya usaste otro paquete, detén las pruebas antes de actualizarlo. Conserva
completa su carpeta runtime, con las muestras guardadas, el registro de
impresión y sus archivos asociados. Para reintentar una orden anterior,
conserva ese registro; uno nuevo vacío permitiría duplicar la impresión.

Impresoras configuradas:
CLIENTE: POS80 Printer / controlador POS80 5.1.1.43 observado / USB CP001
         VID4B43 PID3830, 203 dpi; formato anunciado de 72 x 210 mm.
BARRA: Nulltonex Y813BT Sticker / controlador Y813BT Label 1.1.3.1 observado
       originalmente; COM3: Bluetooth SPP, Y813BT-E08D, 203 dpi.
       VEVOR es el nombre observado en el paquete del controlador.
       Etiquetas Hybsk de 2.25 x 1.25 pulgadas = 57.15 x 31.75 mm.
       La impresión selecciona el formato anunciado de 57 x 32 mm.

Ajustes observados/aprobados el 31 de octubre (este kit NO los cambia):
POS80: densidad 16, velocidad 75 mm/s.
Y813BT: Rotate Portrait, orientación Windows Vertical, densidad 8, velocidad 4,
Label With Gaps, separación 3 mm, offset 0. Se aplicó Study Label y el usuario
confirmó movimiento seguido de reposo. Revisa el papel antes de recalibrar.

Extrae todo el ZIP a una carpeta local permanente. Usa la misma carpeta y
conserva runtime entre reintentos. Evita carpetas de red o sincronizadas.
Abre PowerShell en esa carpeta. No debería requerir permisos de administrador.

1. Revisar impresoras sin imprimir:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1

   Revisa los nombres de ambas colas, sus controladores, puertos y formatos de
   papel instalados. Confirma que esté cargado el rollo Hybsk de las fotos.
   Enciende las impresoras y revisa la conexión Bluetooth. Una cola en reposo
   no confirma esa conexión. Los ajustes y el emparejamiento se corrigen a mano;
   este paquete no los cambia.

2. Simular sin imprimir (opcional):
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1 -Simulate

3. Imprimir muestras en las dos impresoras:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1 -PrintTest

   El tamaño seleccionado es 57.15 x 31.75 mm. Si el rollo cargado tiene otras
   medidas, detente y compruébalo antes de usar -LabelWidthMm/-LabelHeightMm.
   El ancho y el alto deben coincidir con un formato del controlador.

   El ticket de cliente muestra PRUEBA-001: venta de muestra de MXN220,
   pago de MXN250 y cambio de MXN30. ${issuerSource ? 'El nombre o razón social, RFC, régimen y domicilio\n   provienen del archivo local receipt-issuer.json suministrado.' : 'El nombre o razón social, RFC, régimen y domicilio\n   quedan como campos de muestra hasta agregar los datos locales del emisor.'}
   La muestra está marcada como prueba; no es un CFDI ni una venta real.
   Incluye cantidades, precios unitarios, importes y una nota para solicitar CFDI.
   La impresión Bluetooth muestra nombre, bebida y opciones, con dos secciones
   de vaso, indicaciones de leche y sin hielo, el mismo folio y cliente, y avisos
   de NO PREPARAR. Si falta espacio, saldrán etiquetas de continuación identificadas.
   Ambos trabajos se envían a la vez; cada impresora determina cuándo sale el papel.

4. Revisar el papel:
   Comprueba folio, acentos, cantidades, opciones legibles, nota final de
   preparación, alineación y avance. Revisa que no avance papel de más.
   No cambies la escala ni borres el registro para ocultar un problema de alineación.

5. Reintentar con el mismo comando -PrintTest y en la misma carpeta:
   Las copias aceptadas por Windows no se vuelven a enviar. Cada copia que falló
   antes de entregarse a Windows puede reintentarse por separado. Si el resultado
   es incierto, revisa la cola de Windows y el papel; el paquete bloquea el reenvío.
   Una vez aceptado el trabajo, Windows gestiona su salida cuando se restablece
   la conexión o el papel. No vuelvas a cobrar ni borres runtime para reimprimir.

6. Probar otros casos locales (sin cobros ni acceso a la base de datos):
   Agrega -TestCase con uno de estos valores: baseline, repeat-02 a repeat-20,
   bluetooth-offline, usb-offline, paper-out, long-notes.
   Cada caso conserva su identificador de venta y usa el mismo registro de
   impresión. Repetir un caso no reenvía las copias aceptadas. Cambiar de caso
   crea otra orden de prueba identificada.

   Segunda orden independiente:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1 -PrintTest -TestCase repeat-02

   Para probar la recuperación Bluetooth: apaga la impresora de etiquetas,
   ejecuta -TestCase bluetooth-offline y revisa ambas colas de Windows.
   Un caso Bluetooth nuevo usa un vaso compacto marcado ANA (PRUEBA), total
   MXN110, recibido MXN150, cambio MXN40; conserva cualquier muestra ya guardada.
   Enciende la impresora y repite el mismo caso. Windows puede haber aceptado
   el trabajo mientras estaba desconectada; espera a que termine ese trabajo
   antes de crear una reposición.
   La impresora de tickets está integrada en la computadora. Usa usb-offline
   solo si tiene un cable externo normal que pueda desconectarse con seguridad.
   Si no, omite ese caso físico. No abras el equipo ni desconectes piezas internas.
   Prueba la recuperación de la impresora integrada con paper-out y reiniciando
   la PC completa. Usa long-notes para dos bebidas distintas con continuación.
   Cada etiqueta de barra conserva el folio de la orden y el número de vaso.
   Revisa el papel después de cada falla; un resultado incierto queda bloqueado.

   Para probar órdenes repetidas, ejecuta baseline y luego repeat-02 a repeat-20
   en orden. Deben ser 20 trabajos de cliente y 20 de barra, con dos secciones
   de vaso por orden. Los avisos largos pueden agregar etiquetas de continuación.
   Espera a que terminen los trabajos antes de provocar una falla.

Conserva estos archivos después de las pruebas:
- runtime/hardware-report.json (revisión del equipo)
- runtime/windows/last-result.json (estado de las copias)
- runtime/windows/result-<case>.json (resultado de cada caso)
- runtime/windows/windows-jobs.sqlite y sus archivos asociados (evitan duplicados)

No restaures un registro anterior después de enviar nuevos trabajos. Detén el
programa antes de copiar o respaldar los archivos SQLite. Las reimpresiones
manuales o históricas desde Windows no tienen la protección contra duplicados
de este servicio.

El usuario confirmó la salida corregida y recuperación Bluetooth del paquete
anterior el 31 de octubre. Esta versión combina esas correcciones con el nuevo
diseño local y necesita nueva revisión de papel/alineación. La marca y modelo
exactos del equipo USB siguen pendientes. Una simulación local no comprueba
la salida en papel. ExecutionPolicy Bypass se aplica únicamente
al proceso de PowerShell que ejecuta cada comando.

${issuerSource ? 'Este paquete incluye los datos del emisor transcritos de la constancia\nsuministrada. No incluye el PDF original, CURP, idCIF, QR ni sello electrónico.\nNo consulta al contribuyente ni envía facturas. Después puede copiarse el mismo\narchivo fuera de la carpeta de versión y configurarse en el servidor mediante\nPOS_RECEIPT_ISSUER_FILE. Este paquete no cambia la configuración de la aplicación\nen uso.\n' : ''}
`;
await writeFile(path.join(destination, 'START-HERE.txt'), instructions);
const files = ['physical-test.mjs', 'node.exe', 'Node-LICENSE.txt', 'machine-profile.json', 'Test-CafePrinters.ps1', 'Inspect-CafePrinters.ps1', 'scripts/printing/windows-print.ps1', 'scripts/printing/DesktopPrinter.cs', 'public/receipt-branding/carinito-logo-v1.jpg', 'START-HERE.txt'];
if (issuerSource) files.push('receipt-issuer.json');
const hashes = [];
for (const file of files) {
  const bytes = await readFile(path.join(destination, file));
  hashes.push({ file, bytes: (await stat(path.join(destination, file))).size, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ builtOn: new Date().toISOString().slice(0, 10), targetTestDate: '2026-10-31',
  platform: 'Windows x64', node: process.version, sqlite, sourceModules: Object.keys(bundle.metafile.inputs),
  runtimeLicenseSource: licenseUrl, labelSource: 'User-supplied Hybsk packaging images', issuerProfile: issuerSource ? 'receipt-issuer.json' : null, files: hashes }, null, 2));
console.log('Prepared exact-machine physical test kit: ' + destination);
