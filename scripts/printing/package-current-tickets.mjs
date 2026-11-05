import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),destination=process.argv[2];
assert(destination&&path.isAbsolute(destination),'Indica una carpeta de salida nueva con ruta completa.');
assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(process.version,'v24.22.2');
const db=new DatabaseSync(':memory:');const sqlite=db.prepare('SELECT sqlite_version() AS version').get().version;db.close();assert.equal(sqlite,'3.53.4');
await mkdir(destination);
await mkdir(path.join(destination,'scripts/printing'),{recursive:true});await mkdir(path.join(destination,'public/receipt-branding'),{recursive:true});
const bundle=await build({entryPoints:[path.join(root,'scripts/printing/dual-test.ts')],outfile:path.join(destination,'dual-test.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',metafile:true});
const allowed=['dual-test.ts','cafe-printers.json','receipt-branding.json','print-journal-server.ts','windows-print-server.ts','sale-printing.ts','receipt-issuer-server.ts'];
assert(Object.keys(bundle.metafile.inputs).every(file=>allowed.includes(path.basename(file))),'Dependencia inesperada');
for(const file of ['DesktopPrinter.cs','windows-print.ps1'])await copyFile(path.join(root,'scripts/printing',file),path.join(destination,'scripts/printing',file));
await copyFile(path.join(root,'scripts/printing/Test-CurrentTickets.ps1'),path.join(destination,'Test-CurrentTickets.ps1'));
await copyFile(path.join(root,'scripts/printing/Current-Tickets-Remote-Prompt.txt'),path.join(destination,'CAFE-PC-PROMPT.txt'));
await copyFile(path.join(root,'public/receipt-branding/carinito-logo-v1.jpg'),path.join(destination,'public/receipt-branding/carinito-logo-v1.jpg'));
await copyFile(process.execPath,path.join(destination,'node.exe'));
await copyFile(path.join(path.dirname(process.execPath),'LICENSE'),path.join(destination,'Node-LICENSE.txt'));
await writeFile(path.join(destination,'LEEME.txt'),String.raw`CARIÑITO MÍO — PRUEBA DE TICKET Y ETIQUETA V9

Transfiere el ZIP por AnyDesk y extráelo en D:\Cafe-Prueba-Actual-V9.
Pega CAFE-PC-PROMPT.txt en Codex de la PC remota.

Usa el registro y receipt-issuer.json de D:\Cafe-Printer-Test-2026-10-31
sin moverlos. Conserva runtime completo, incluidas las muestras, SQLite y
sus archivos WAL/SHM. Si el registro falta o está vacío, busca el original;
no crees uno nuevo. Ejecuta una sola prueba a la vez con el Node incluido.
El paquete no cambia el POS, las ventas, los controladores ni sus ajustes.

1. Verifica manifest.json y consulta la vista previa sin imprimir:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-CurrentTickets.ps1 -ExistingKitRoot 'D:\Cafe-Printer-Test-2026-10-31'

   Debe indicar journalUnchanged=true, physicalPrints=0, una página de ticket
   y una etiqueta. Revisa preview/customer, preview/barista y la vista de
   lectura preview/barista-upright.

2. Con ambas colas vacías y la persona del local confirmando los equipos listos,
   papel cargado y rollo Hybsk de 57.15 x 31.75 mm, imprime una vez:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-CurrentTickets.ps1 -ExistingKitRoot 'D:\Cafe-Printer-Test-2026-10-31' -PrintTest

   PRUEBA-D2: María López, un Iced Matcha Latte con leche de avena, vainilla
   y 1 Shot Espresso. NO PREPARAR. Total $110 MXN, recibido $150, cambio $40.
   El ticket omite las leyendas de CFDI. La etiqueta reference-v2 imprime
   texto y líneas negros sobre el rollo de color.

3. Pide fotos completas de ambas copias y confirma texto, folio e importes.
   El QR debe abrir https://www.instagram.com/_carinitomio/.
   El estado submitted indica envío a Windows. Confirma la salida en papel
   con la persona del local; AnyDesk solo muestra la pantalla.

4. Con el papel completo y ambas colas vacías, repite el mismo comando una vez
   para comprobar que no salen copias extra ni cambian los intentos o fechas.

Si una copia falta, está incompleta o tiene estado incierto, detente y revisa
papel y colas. No cambies de muestra, modifiques estados, canceles trabajos
ni borres, copies o restaures el registro para forzar otro envío.

La muestra y el resultado quedan en runtime/windows del paquete original:
sample-dual-layout-v9.json y result-dual-layout-v9.json.
Verifica unrelatedJournalRowsUnchanged=true y recoveryAuditUnchanged=true.
Guarda RESULTADOS-D2.zip en la carpeta nueva con results, preview, un resumen
y una copia del JSON de resultado. Excluye SQLite/WAL/SHM y el perfil fiscal.
Devuelve la ruta del ZIP para transferirlo por AnyDesk.
`);
const files=['dual-test.mjs','Test-CurrentTickets.ps1','CAFE-PC-PROMPT.txt','LEEME.txt','node.exe','Node-LICENSE.txt','scripts/printing/DesktopPrinter.cs','scripts/printing/windows-print.ps1','public/receipt-branding/carinito-logo-v1.jpg'];
const hashes=[];for(const file of files){const bytes=await readFile(path.join(destination,file));hashes.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({kind:'current-dual-layout-v9',builtOn:'2026-10-31',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
  node:process.version,sqlite,requiresExistingJournal:true,journalIncluded:false,testTicket:'PRUEBA-D2',customerCfdiWording:false,labelLayout:'reference-v2',files:hashes},null,2));
console.log('Paquete de prueba de ambas impresoras creado: '+destination);
