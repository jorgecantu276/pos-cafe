import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),destination=process.argv[2];
assert(destination&&path.isAbsolute(destination),'Indica una carpeta NUEVA absoluta');
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
await writeFile(path.join(destination,'LEEME.txt'),`CARIÑITO MÍO — PRUEBA REMOTA DE AMBAS IMPRESORAS — V9

Transfiere este ZIP por AnyDesk. Extrae TODO en D:\\Cafe-Prueba-Actual-V9,
separado del paquete original D:\\Cafe-Printer-Test-2026-10-31.
Pega CAFE-PC-PROMPT.txt en Codex de la PC remota.

Este paquete usa el código actual del POS: recibo SIN leyendas de CFDI y
etiqueta con diseño reference-v2, solo negro sobre el rollo físico de color.
No accede a la nube, cobra, instala el POS, cambia drivers/preferencias ni
contiene un registro vacío. Exige el registro ORIGINAL no vacío y el perfil
del emisor en la carpeta anterior. Ese registro se usa EN SU LUGAR.

Primero: inspección/vista previa, SIN papel:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CurrentTickets.ps1 -ExistingKitRoot 'D:\\Cafe-Printer-Test-2026-10-31'

Con colas vacías, ambos equipos listos y papel/rollo confirmado por la persona:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CurrentTickets.ps1 -ExistingKitRoot 'D:\\Cafe-Printer-Test-2026-10-31' -PrintTest

Nueva muestra compacta PRUEBA-D2: un Iced Matcha Latte; leche de avena, vainilla,
1 Shot Espresso. NO PREPARAR. Total110,recibido150,cambio40.
Ambas copias se entregan concurrentemente; cada dispositivo decide cuándo sale
el papel. Esperamos1página de recibo y1etiqueta. La vista previa debe comprobarlo.

Conserva la nueva muestra y resultado en runtime/windows ORIGINAL:
sample-dual-layout-v9.json y result-dual-layout-v9.json.
Repetir el MISMO comando mantiene las identidades y no reinicia copias
aceptadas/inciertas. No se permite modificar registros/estados o ejecutar
reposiciones. Los trabajos anteriores y la auditoría se verifican sin cambios.

AnyDesk muestra la PC, NO el papel. La persona del local debe confirmar ambas
salidas y mandar fotos; un estado submitted significa aceptación por Windows.
Si falta papel, está incompleto o hay incertidumbre, detente y conserva todo.
Nunca borres/resetées/restaures/copíes el registro para forzar otro intento.

Resultados de consola/colas: results de esta carpeta. PNGs: preview/customer,
preview/barista (orientación de impresión), preview/barista-upright (lectura).
El QR debe abrir https://www.instagram.com/_carinitomio/.
Pide fotos completas y legibles y devuelve RESULTADOS-D2.zip por AnyDesk.
No metas SQLite ni el perfil fiscal original en ese ZIP de resultados.
`);
const files=['dual-test.mjs','Test-CurrentTickets.ps1','CAFE-PC-PROMPT.txt','LEEME.txt','node.exe','Node-LICENSE.txt','scripts/printing/DesktopPrinter.cs','scripts/printing/windows-print.ps1','public/receipt-branding/carinito-logo-v1.jpg'];
const hashes=[];for(const file of files){const bytes=await readFile(path.join(destination,file));hashes.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({kind:'current-dual-layout-v9',builtOn:'2026-10-31',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
  node:process.version,sqlite,requiresExistingJournal:true,journalIncluded:false,testTicket:'PRUEBA-D2',customerCfdiWording:false,labelLayout:'reference-v2',files:hashes},null,2));
console.log('Paquete de prueba de ambas impresoras preparado: '+destination);
