import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const destination = process.argv[2];
assert(destination && path.isAbsolute(destination), 'Pass a NEW absolute package directory');
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
assert(Object.keys(bundle.metafile.inputs).every(file=>allowed.includes(path.basename(file))), 'Unexpected package dependency');
for (const file of ['DesktopPrinter.cs','windows-print.ps1']) await copyFile(path.join(root,'scripts/printing',file),path.join(destination,'scripts/printing',file));
await copyFile(path.join(root,'scripts/printing/Test-NewReceipt.ps1'),path.join(destination,'Test-NewReceipt.ps1'));
await copyFile(path.join(root,'scripts/printing/Receipt-Test-Prompt.txt'),path.join(destination,'CAFE-PC-PROMPT.txt'));
await copyFile(path.join(root,'public/receipt-branding/carinito-logo-v1.jpg'),path.join(destination,'public/receipt-branding/carinito-logo-v1.jpg'));
await copyFile(process.execPath,path.join(destination,'node.exe'));
await copyFile(path.join(path.dirname(process.execPath),'LICENSE'),path.join(destination,'Node-LICENSE.txt'));
const instructions = `CARIÑITO MÍO — NEW RECEIPT ONLY — V8 — OCTOBER 31, 2026

Extract this ZIP into a NEW separate local folder, for example:
D:\\Cafe-Receipt-Only-V8-2026-10-31
Do not extract over, move, replace, delete or restore the old test folder.

The existing kit remains at D:\\Cafe-Printer-Test-2026-10-31.
Its runtime\\windows\\windows-jobs.sqlite and associated files stay IN PLACE.
This package contains NO journal, issuer profile, cloud credentials or sales DB.
It requires the existing nonempty journal and existing receipt-issuer.json.
It prints no barista label and never authorizes a recovery replacement.

From the NEW extracted folder, preview/inspect WITHOUT PRINTING:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-NewReceipt.ps1 -ExistingKitRoot 'D:\\Cafe-Printer-Test-2026-10-31'

Read the output and preview/page-1.png. The existing journal is opened read-only
for this step. It must report journalUnchanged=true and physicalPrints=0.
Verify POS80 Printer / POS80 / CP001 and the approximately 72 x 210 mm form.
No Bluetooth power action or label inspection is needed for this receipt test.

After checking receipt paper and an empty Windows receipt queue, print ONCE:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-NewReceipt.ps1 -ExistingKitRoot 'D:\\Cafe-Printer-Test-2026-10-31' -PrintTest

Expected: PRUEBA-R8, ANA (PRUEBA), one Iced coffee caramelo with oat milk,
SIN HIELO / NO PREPARAR; MXN110 total, MXN150 received, MXN40 change.
Check the supplied logo, phone, title, columns, total, issuer block, QR,
MENÚ E INSTAGRAM, closing phrase and Instagram handle. Scan the physical QR:
https://www.instagram.com/_carinitomio/

The new sample is saved in the ORIGINAL runtime/windows as
sample-receipt-branding-v8.json, with one new CUSTOMER journal row only.
The original jobs, source records and recovery audit are checked for changes.
Keep that sample identity. The result is result-receipt-branding-v8.json.
Old case results and original sample files are not overwritten.

Submitted means Windows accepted the job, not proof of complete paper output.
If paper is missing or state is uncertain, inspect paper/Windows and STOP.
Do not delete files, select a new identity, edit SQLite, cancel jobs or use old
one-off recovery scripts. The SAME command preserves the submission guard.
After personally confirmed complete output and an empty queue, repeating it
once may verify duplicate suppression; it should not send new paper.

No npm install, POS installation, migration, driver/preference change, pairing,
Bluetooth recovery run or physical print of the old cases is part of this test.
Keep the entire original kit and journal, including WAL/SHM companion files.
Do not run concurrent acceptance scripts while checking record preservation.
`;
await writeFile(path.join(destination,'START-HERE.txt'),instructions);
const files = ['receipt-test.mjs','Test-NewReceipt.ps1','CAFE-PC-PROMPT.txt','node.exe','Node-LICENSE.txt','scripts/printing/DesktopPrinter.cs','scripts/printing/windows-print.ps1','public/receipt-branding/carinito-logo-v1.jpg','START-HERE.txt'];
const hashes=[];
for (const file of files) { const bytes=await readFile(path.join(destination,file));hashes.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}); }
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({kind:'customer-receipt-only-v8',builtOn:'2026-10-31',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,sqlite,
  requiresExistingJournal:true,journalIncluded:false,baristaPrinting:false,files:hashes},null,2));
console.log('Prepared existing-journal, customer-only package: '+destination);
