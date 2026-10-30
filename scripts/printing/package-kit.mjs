import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = process.argv[2];
const issuerSource = process.argv[3];
assert.ok(destination && path.isAbsolute(destination), 'Pass a new absolute output directory whose parent exists');
if (issuerSource) assert.ok(path.isAbsolute(issuerSource), 'The optional issuer profile must use an absolute local path');
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.14.1');
await mkdir(destination); // Never overwrite a previously delivered kit/journal.
await mkdir(path.join(destination, 'scripts/printing'), { recursive: true });
const bundle = await build({ entryPoints: [path.join(root, 'scripts/printing/physical-test.ts')],
  outfile: path.join(destination, 'physical-test.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true });
const allowed = ['physical-test.ts', 'cafe-printers.json', 'print-journal-server.ts', 'windows-print-server.ts', 'sale-printing.ts', 'receipt-issuer-server.ts'];
assert.ok(Object.keys(bundle.metafile.inputs).every(file => allowed.includes(path.basename(file))), 'Unexpected dependency in hardware kit');
for (const file of ['windows-print.ps1', 'DesktopPrinter.cs']) await copyFile(path.join(root, 'scripts/printing', file), path.join(destination, 'scripts/printing', file));
for (const file of ['Test-CafePrinters.ps1', 'Inspect-CafePrinters.ps1']) await copyFile(path.join(root, 'scripts/printing', file), path.join(destination, file));
await copyFile(path.join(root, 'config/cafe-printers.json'), path.join(destination, 'machine-profile.json'));
if (issuerSource) {
  // Whitelist receipt fields; never package the entire fiscal document, CURP,
  // QR, idCIF, signature or unrelated personal information.
  const value = JSON.parse((await readFile(issuerSource, 'utf8')).replace(/^\uFEFF/, ''));
  const fields = ['legalName', 'rfc', 'taxRegime', 'establishmentAddress', 'postalCode', 'city'];
  assert.ok(value && typeof value === 'object' && fields.every(field => typeof value[field] === 'string' && value[field].trim()), 'Incomplete issuer profile');
  await writeFile(path.join(destination, 'receipt-issuer.json'), JSON.stringify(Object.fromEntries(fields.map(field => [field, value[field]])), null, 2));
}
await copyFile(process.execPath, path.join(destination, 'node.exe'));
const licenseUrl = 'https://raw.githubusercontent.com/nodejs/node/v24.14.1/LICENSE';
const response = await fetch(licenseUrl); assert.ok(response.ok, 'Exact Node runtime license is required');
await writeFile(path.join(destination, 'Node-LICENSE.txt'), await response.text());
const instructions = `CARIÑITO MÍO — PHYSICAL PRINTER TEST KIT V4 — 31 OCTOBER 2026

This is the actual shared print dispatcher and Windows driver adapter bundled
with Node 24.14.1 x64. No npm install, internet or Supabase access is needed.
It does not install/replace the cafe POS. All sample records remain local.
It never charges a customer, changes inventory, installs drivers, pairs devices,
changes printer defaults, or sends cutter/drawer/RAW commands.

Configured for these exact machines:
CUSTOMER: POS80 Printer / POS80 5.1.1.43 observed / USB CP001
          VID4B43 PID3830, 203dpi, explicit 72 x 210mm advertised form.
BARISTA: Y813BT Sticker / Y813BT Label 1.1.3.1 observed / COM3: Bluetooth SPP
         Y813BT-E08D, 203dpi, VEVOR driver.
         Hybsk 2.25 x 1.25 inch labels = 57.15 x 31.75mm.
         The job selects the advertised 57 x 32mm form.

Extract the WHOLE ZIP to a stable local folder. Keep the same folder and its
runtime directory between retries. Do not use a synced/network directory.
Open PowerShell in that folder. No administrator access should be required.

1. READ-ONLY CHECK — no printing:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1

   Check both exact queue names, driver/port matches and installed paper forms.
   Confirm the pictured Hybsk roll is loaded. Power on both printers and inspect
   Bluetooth connection. Idle queue status alone does not prove connection.
   Any settings/pairing fixes are manual; this kit never changes them.

2. OPTIONAL SIMULATION — no printing:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1 -Simulate

3. EXPLICIT PAPER TEST — sends sample jobs to the TWO PHYSICAL PRINTERS:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1 -PrintTest

   The preselected label size is 57.15 x 31.75mm. If the actual roll differs,
   stop and verify it before using the optional -LabelWidthMm/-LabelHeightMm
   overrides. Both dimensions must match an advertised driver form.

   The customer receipt shows PRUEBA-001 and a synthetic MXN220 sale, MXN250
   tender/MXN30 change. ${issuerSource ? 'Registered name, RFC, tax regime and official address\n   come from the supplied local receipt-issuer.json profile.' : 'Registered name, RFC, tax regime and official address\n   remain visible PLACEHOLDERS until a local issuer profile is supplied.'} This marked hardware
   test is not a CFDI or a production sale. The customer layout includes item
   quantities/unit prices/amounts and a CFDI request note.
   The Bluetooth job uses Starbucks-inspired name/drink/modifier hierarchy,
   TWO cup sections, no-ice/milk
   instructions, matching folio/customer and NO PREPARAR warnings.
   Expect additional identified continuation labels if text needs more room.
   Two jobs are submitted concurrently; device speed determines paper timing.

4. VERIFY PAPER: matching folio, accents, quantities, readable modifiers,
   final preparation note, correct feed/alignment and no unwanted long feed.
   Do not change scaling or delete journals to hide an alignment problem.

5. RETRY by running the SAME -PrintTest command in the SAME folder.
   Already accepted copies are not submitted again. Before-handoff failures
   may retry independently. If status is uncertain, inspect Windows queue and
   paper; the kit blocks blind resends. Windows owns reconnect/paper recovery
   after accepting a job. Do not charge again or delete runtime to reprint.

6. DISTINCT LOCAL TEST CASES (all synthetic, no charge/database):
   Add -TestCase with one of: baseline, repeat-02 through repeat-20,
   bluetooth-offline, usb-offline, paper-out, long-notes.
   Each case saves its own immutable sale UUID and uses the SAME durable
   journal. Running the SAME case again never resends accepted copies.
   Changing case intentionally creates a DIFFERENT marked test order.

   Second independent order:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Test-CafePrinters.ps1 -PrintTest -TestCase repeat-02

   For Bluetooth recovery: turn off the label printer, run -TestCase
   bluetooth-offline, inspect both Windows queues, turn it back on and rerun
   that SAME case. Windows may have accepted the offline job already; wait
   for that existing job to recover instead of creating a replacement.
   Use usb-offline for an unplugged receipt printer, paper-out for an empty
   roll, and long-notes for two different drinks with continuation labels.
   Every barista label now retains the order folio AND its cup number.
   Inspect paper after every fault; an uncertain result remains blocked.

   For a repeated-order run, execute baseline then repeat-02 through
   repeat-20 in sequence. Expect 20 customer jobs and 20 barista jobs total,
   with two cup sections per order (long warnings may add continuation labels).
   Do not introduce a deliberate fault until existing jobs have drained.

Files to retain after the test:
- runtime/hardware-report.json (read-only discovery)
- runtime/windows/last-result.json (copy statuses)
- runtime/windows/result-<case>.json (individual acceptance cases)
- runtime/windows/windows-jobs.sqlite and companion files (duplicate guard)

Do not restore an earlier journal after new jobs. Stop the program before
copying/backing up SQLite files. Historical/manual Windows reprints are outside
this dispatcher's at-most-once submission guarantee.

No physical print has been validated yet. Exact USB hardware brand/model,
actual Bluetooth transport/output, stock alignment and installed café runtime
remain physical acceptance work. Passing local simulations is not paper proof.
ExecutionPolicy Bypass above applies only to that PowerShell process.

${issuerSource ? 'This kit includes the receipt issuer profile transcribed from the supplied\nconstancia. The original PDF, CURP, idCIF, QR and electronic seal are excluded.\nNo lookup of this taxpayer or invoice submission is made. The same profile\ncan later be copied outside the POS release and referenced by server-only\nPOS_RECEIPT_ISSUER_FILE. No live app environment is changed by this kit.\n' : ''}
`;
await writeFile(path.join(destination, 'START-HERE.txt'), instructions);
const files = ['physical-test.mjs', 'node.exe', 'Node-LICENSE.txt', 'machine-profile.json', 'Test-CafePrinters.ps1', 'Inspect-CafePrinters.ps1', 'scripts/printing/windows-print.ps1', 'scripts/printing/DesktopPrinter.cs', 'START-HERE.txt'];
if (issuerSource) files.push('receipt-issuer.json');
const hashes = [];
for (const file of files) {
  const bytes = await readFile(path.join(destination, file));
  hashes.push({ file, bytes: (await stat(path.join(destination, file))).size, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ builtOn: '2026-10-30', targetTestDate: '2026-10-31',
  platform: 'Windows x64', node: process.version, sourceModules: Object.keys(bundle.metafile.inputs),
  runtimeLicenseSource: licenseUrl, labelSource: 'User-supplied Hybsk packaging images', issuerProfile: issuerSource ? 'receipt-issuer.json' : null, files: hashes }, null, 2));
console.log('Prepared exact-machine physical test kit: ' + destination);
