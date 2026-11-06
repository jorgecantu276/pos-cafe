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
assert.ok(destination && path.isAbsolute(destination), 'Indica una carpeta de salida nueva con ruta completa y carpeta superior existente.');
if (issuerSource) assert.ok(path.isAbsolute(issuerSource), 'Usa una ruta local completa para el perfil fiscal.');
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.22.2');
const probe = new DatabaseSync(':memory:');
const sqlite = probe.prepare('SELECT sqlite_version() AS version,sqlite_source_id() AS sourceId').get();
probe.close();
assert.equal(sqlite.version, '3.53.4', 'Se requiere SQLite 3.53.4.');
await mkdir(destination); // Never overwrite a previously delivered kit/journal.
await mkdir(path.join(destination, 'scripts/printing'), { recursive: true });
const bundle = await build({ entryPoints: [path.join(root, 'scripts/printing/physical-test.ts')],
  outfile: path.join(destination, 'physical-test.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true });
const allowed = ['physical-test.ts', 'cafe-printers.json', 'receipt-branding.json', 'print-journal-server.ts', 'windows-print-server.ts', 'sale-printing.ts', 'receipt-issuer-server.ts'];
assert.ok(Object.keys(bundle.metafile.inputs).every(file => allowed.includes(path.basename(file))), 'El paquete incluye una dependencia inesperada.');
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
  assert.ok(value && typeof value === 'object' && fields.every(field => typeof value[field] === 'string' && value[field].trim()), 'El perfil fiscal está incompleto.');
  await writeFile(path.join(destination, 'receipt-issuer.json'), JSON.stringify(Object.fromEntries(fields.map(field => [field, value[field]])), null, 2));
}
await copyFile(process.execPath, path.join(destination, 'node.exe'));
const licenseUrl = 'https://raw.githubusercontent.com/nodejs/node/v24.22.2/LICENSE';
const response = await fetch(licenseUrl); assert.ok(response.ok, 'No se pudo obtener la licencia de Node 24.22.2.');
await writeFile(path.join(destination, 'Node-LICENSE.txt'), await response.text());
const instructions = String.raw`CARIÑITO MÍO — PRUEBA DE IMPRESORAS V9
31 de octubre de 2026

Prueba local con muestras: usa el generador y el registro de impresión del POS,
con Node 24.22.2 x64 incluido. Funciona sin internet, npm ni Supabase.
No instala el POS ni modifica ventas, controladores, ajustes o emparejamientos.

Extrae el ZIP en una carpeta local permanente. Si ya hiciste pruebas, conserva
la carpeta runtime completa, sus muestras y el registro SQLite con sus archivos
WAL/SHM. Usa siempre ese registro; uno vacío permitiría repetir impresiones.
Detén las pruebas antes de actualizar el paquete o respaldar el registro.
No ejecutes dos pruebas a la vez ni uses una carpeta de red o sincronizada.

IMPRESORAS
Ticket: POS80 Printer / POS80 / CP001 USB, 203 dpi; formato 72 x 210 mm.
Etiqueta: Y813BT Sticker / Y813BT Label / COM3: Bluetooth SPP, 203 dpi.
Dispositivo: Y813BT-E08D. Rollo Hybsk de 57.15 x 31.75 mm (2.25 x 1.25 pulgadas).
La etiqueta se dibuja a 32 x 57 mm y gira dentro del formato físico 57 x 32 mm.
El diseño imprime texto y líneas negros sobre el rollo de color.

Ajustes observados el 31 de octubre; el paquete los conserva:
POS80: densidad 16, velocidad 75 mm/s.
Y813BT: Rotate Portrait, Windows Vertical, densidad 8, velocidad 4,
Label With Gaps, separación 3 mm, offset 0; Study Label realizado.
Controladores observados: POS80 5.1.1.43; Y813BT 1.1.3.1 en la revisión inicial.

PASOS
Abre PowerShell en la carpeta extraída. Cada comando aplica ExecutionPolicy
Bypass solo a ese proceso; no debería requerir permisos de administrador.

1. Consultar las impresoras sin imprimir:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-CafePrinters.ps1

   Revisa nombres, controladores, puertos y formatos. Confirma las impresoras
   encendidas, el papel cargado y la conexión Bluetooth. Una cola vacía no
   confirma la conexión ni el rollo cargado.

2. Simular sin impresoras, si necesitas comprobar el flujo:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-CafePrinters.ps1 -Simulate

3. Con ambos equipos listos y las colas vacías, imprimir la muestra:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-CafePrinters.ps1 -PrintTest

   PRUEBA-001: dos Iced coffee caramelo con leche de avena y sin hielo.
   Total $220 MXN, recibido $250, cambio $30. Las etiquetas dicen NO PREPARAR.
   Si el rollo tiene otras medidas, compruébalas antes de indicarlas mediante
   -LabelWidthMm y -LabelHeightMm; deben coincidir con un formato instalado.

   El ticket incluye logo, teléfono, cantidades, precios, total, QR de Instagram
   y frase de cierre. Omite el nombre fiscal y las leyendas de CFDI.
   ${issuerSource ? 'RFC, régimen y domicilio proceden de receipt-issuer.json.' : 'RFC, régimen y domicilio aparecen como campos de muestra.'}
   Cada vaso lleva su folio y número; las notas largas pueden ocupar etiquetas
   de continuación. Ambos trabajos se envían a Windows al mismo tiempo.

4. Revisar el papel: texto completo, acentos, importes, opciones, folio,
   alineación y avance. Escanea el QR: debe abrir
   https://www.instagram.com/_carinitomio/.
   El estado submitted indica envío a Windows; la salida se confirma en papel.

5. Tras confirmar el papel completo y las colas vacías, repite el mismo comando
   en la misma carpeta para comprobar que no salen copias extra. Las copias
   aceptadas o inciertas no se reenvían. Si falta una copia, revisa primero
   el papel y la cola de Windows; no cambies de muestra ni borres el registro
   para forzar un reenvío. Windows puede terminar el trabajo al recuperar
   papel o conexión. Las reimpresiones manuales de Windows no tienen esta
   protección contra duplicados.

OTROS CASOS
Usa -TestCase con baseline, repeat-02 a repeat-20, bluetooth-offline,
usb-offline, paper-out o long-notes. Cada caso nuevo crea otra muestra;
repetirlo conserva su identidad. Espera a que terminen los trabajos de cada caso.

Ejemplo de segunda muestra:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-CafePrinters.ps1 -PrintTest -TestCase repeat-02

Bluetooth: apaga la impresora de etiquetas y ejecuta bluetooth-offline. Revisa
las colas, enciéndela y repite ese caso. Una muestra nueva usa ANA (PRUEBA),
un vaso, total $110, recibido $150 y cambio $40; las muestras guardadas se conservan.
Comprueba si Windows terminó el trabajo pendiente antes de pedir una reposición.

USB: usa usb-offline solo si hay un cable externo accesible. El ticket sale
de la impresora integrada: no abras el equipo ni desconectes piezas internas.
Para esa impresora puedes usar paper-out y reiniciar la PC completa.
long-notes comprueba dos bebidas con notas largas y etiquetas de continuación.
baseline y repeat-02 a repeat-20 producen 20 trabajos de cliente y 20 de barra,
con dos vasos por orden; las notas largas pueden añadir etiquetas.

ARCHIVOS QUE DEBES CONSERVAR
- runtime/hardware-report.json: consulta del equipo.
- runtime/windows/last-result.json y result-<case>.json: estado de cada prueba.
- runtime/windows/sample-*.json: identidades de las muestras.
- runtime/windows/windows-jobs.sqlite y sus archivos asociados: registro de envíos.
No restaures un registro anterior después de enviar trabajos nuevos.

El recibo V8 y la etiqueta fluida anterior se confirmaron en papel el 31 de
octubre. Este paquete usa la etiqueta reference-v2 solicitada después, revisada
localmente; esa revisión no confirma su salida física ni instala el POS.
${issuerSource ? 'El paquete incluye solo los campos de receipt-issuer.json necesarios para\nel ticket. Conserva ese archivo local; no incluye el documento fiscal original.\n' : ''}`;
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
console.log('Paquete de prueba creado: ' + destination);
