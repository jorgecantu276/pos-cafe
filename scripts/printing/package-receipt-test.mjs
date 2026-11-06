import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const destination = process.argv[2];
assert(destination && path.isAbsolute(destination), 'Indica una carpeta de salida nueva con ruta completa.');
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.22.2');
const probe = new DatabaseSync(':memory:');
const sqlite = probe.prepare('SELECT sqlite_version() AS version').get().version; probe.close();
assert.equal(sqlite, '3.53.4');
await mkdir(destination); // Never replace an existing extraction or journal.
await mkdir(path.join(destination, 'scripts/printing'), { recursive: true });
await mkdir(path.join(destination, 'public/receipt-branding'), { recursive: true });
const bundle = await build({ entryPoints: [path.join(root, 'scripts/printing/receipt-test.ts')],
  outfile: path.join(destination, 'receipt-test.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true });
const allowed = ['receipt-test.ts','cafe-printers.json','receipt-branding.json','print-journal-server.ts','windows-print-server.ts','sale-printing.ts','receipt-issuer-server.ts'];
assert(Object.keys(bundle.metafile.inputs).every(file=>allowed.includes(path.basename(file))), 'El paquete incluye una dependencia inesperada.');
for (const file of ['DesktopPrinter.cs','windows-print.ps1']) await copyFile(path.join(root,'scripts/printing',file),path.join(destination,'scripts/printing',file));
await copyFile(path.join(root,'scripts/printing/Test-NewReceipt.ps1'),path.join(destination,'Test-NewReceipt.ps1'));
await copyFile(path.join(root,'scripts/printing/Receipt-Test-Prompt.txt'),path.join(destination,'CAFE-PC-PROMPT.txt'));
await copyFile(path.join(root,'public/receipt-branding/carinito-logo-v1.jpg'),path.join(destination,'public/receipt-branding/carinito-logo-v1.jpg'));
await copyFile(process.execPath,path.join(destination,'node.exe'));
await copyFile(path.join(path.dirname(process.execPath),'LICENSE'),path.join(destination,'Node-LICENSE.txt'));
const instructions = String.raw`CARIÑITO MÍO — PRUEBA DEL TICKET V8
31 de octubre de 2026

Extrae el ZIP en una carpeta separada, por ejemplo:
D:\Cafe-Receipt-Only-V8-2026-10-31

Usa el registro existente en D:\Cafe-Printer-Test-2026-10-31 sin moverlo.
Se necesitan runtime\windows\windows-jobs.sqlite, sus archivos WAL/SHM,
las muestras guardadas y receipt-issuer.json. Si faltan o el registro está
vacío, busca la carpeta original antes de continuar. No crees otro registro.
Este paquete no incluye esos datos y prueba solo el ticket del cliente.
No cambia el POS, los controladores, sus ajustes ni los datos del negocio.
Ejecuta una prueba a la vez con el Node 24.22.2 / SQLite 3.53.4 incluido.

1. Verifica los hashes de manifest.json y consulta la vista previa:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-NewReceipt.ps1 -ExistingKitRoot 'D:\Cafe-Printer-Test-2026-10-31'

   Debe indicar journalUnchanged=true y physicalPrints=0.
   Revisa preview/page-1.png, POS80 Printer / POS80 / CP001 y el formato
   de 72 x 210 mm. No se consulta ni imprime la etiqueta Bluetooth.

2. Con papel cargado, tapa cerrada, impresora lista y cola vacía, imprime una vez:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-NewReceipt.ps1 -ExistingKitRoot 'D:\Cafe-Printer-Test-2026-10-31' -PrintTest

   Muestra PRUEBA-R8: ANA (PRUEBA), un Iced coffee caramelo con leche de avena,
   SIN HIELO / NO PREPARAR. Total $110 MXN, recibido $150, cambio $40.
   El registro original recibe solo la nueva copia del cliente y conserva
   sample-receipt-branding-v8.json y result-receipt-branding-v8.json.

3. Comprueba el papel completo: logo, teléfono, columnas, importes, datos
   fiscales debajo del pago, frase final y usuario de Instagram. Escanea
   el QR; debe abrir https://www.instagram.com/_carinitomio/.
   El estado submitted indica envío a Windows; confirma la salida en papel.

4. Tras confirmar el papel completo y la cola vacía, repite exactamente el
   mismo comando una vez. No deben cambiar los intentos ni salir papel extra.
   Conserva la muestra y el registro, incluidos sus archivos asociados.

Si falta papel, está incompleto o el envío es incierto, detente y revisa
el papel y la cola de Windows. No borres, copies, restaures o edites el registro,
cambies de muestra, canceles trabajos ni ejecutes scripts de reposición.
El mismo comando conserva la protección contra duplicados.

Guarda el resultado como aprobado, falló o pendiente, con la comprobación
del papel, QR y duplicados. Verifica unrelatedJournalRowsUnchanged=true
y baristaJobsCreated=0. Conserva los resultados anteriores.
`;
await writeFile(path.join(destination,'START-HERE.txt'),instructions);
const files = ['receipt-test.mjs','Test-NewReceipt.ps1','CAFE-PC-PROMPT.txt','node.exe','Node-LICENSE.txt','scripts/printing/DesktopPrinter.cs','scripts/printing/windows-print.ps1','public/receipt-branding/carinito-logo-v1.jpg','START-HERE.txt'];
const hashes=[];
for (const file of files) { const bytes=await readFile(path.join(destination,file));hashes.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}); }
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({kind:'customer-receipt-only-v8',builtOn:'2026-10-31',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,sqlite,
  requiresExistingJournal:true,journalIncluded:false,baristaPrinting:false,files:hashes},null,2));
console.log('Paquete de prueba del ticket creado: '+destination);
