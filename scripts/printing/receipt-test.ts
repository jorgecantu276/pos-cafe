import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import machine from '../../config/cafe-printers.json';
import { PrintJournal } from '../../lib/print-journal-server';
import { printerAdapter, type PrintConfig } from '../../lib/windows-print-server';
import { readReceiptIssuer } from '../../lib/receipt-issuer-server';
import { saleDocuments } from '../../lib/sale-printing';
import type { SavedOrder } from '../../lib/checkout';

// Customer-receipt test using an existing print journal.
const bundleRoot = path.dirname(fileURLToPath(import.meta.url));
process.chdir(bundleRoot);
const args = process.argv.slice(2);
assert(args.every(arg => ['--preview', '--print', '--simulate'].includes(arg) || arg.startsWith('--existing-root=')), 'Argumento de prueba desconocido.');
assert(args.filter(arg => ['--preview', '--print', '--simulate'].includes(arg)).length <= 1, 'Elige un solo modo.');
assert.equal(args.filter(arg => arg.startsWith('--existing-root=')).length, 1, 'Indica una sola carpeta del paquete original.');
const rootArg = args.find(arg => arg.startsWith('--existing-root='))!.slice('--existing-root='.length);
assert(path.isAbsolute(rootArg) && !/^(?:\\\\|\/\/)/.test(rootArg), 'Usa la ruta local completa del paquete original.');
const existingRoot = realpathSync(rootArg);
const simulate = args.includes('--simulate'); // Verification only; requires a preexisting mock journal.
const print = args.includes('--print');
const mode = simulate ? 'mock' : 'windows';
const directory = path.join(existingRoot, 'runtime', mode);
const filename = path.join(directory, `${mode}-jobs.sqlite`);
assert(existsSync(filename), 'Falta el registro original. Busca su carpeta antes de continuar; no crees otro.');
assert.equal(realpathSync(directory).toLowerCase(), directory.toLowerCase(), 'La carpeta del registro no puede redirigir a otra ubicación.');
assert.equal(realpathSync(filename).toLowerCase(), filename.toLowerCase(), 'El registro no puede redirigir a otro archivo.');

function snapshot() {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    return {
      jobs: db.prepare('SELECT * FROM jobs ORDER BY order_id,audience').all() as Record<string, unknown>[],
      sources: db.prepare('SELECT * FROM sale_sources ORDER BY order_id').all() as Record<string, unknown>[],
      reviews: db.prepare('SELECT * FROM recovery_audit ORDER BY request_id').all() as Record<string, unknown>[],
    };
  } finally { db.close(); }
}
const before = snapshot();
assert(before.jobs.length > 0, 'El registro está vacío. Busca el registro original antes de continuar.');
const beforeHash = createHash('sha256').update(JSON.stringify(before)).digest('hex');
const sampleFile = path.join(directory, 'sample-receipt-branding-v8.json');
const issuer = readReceiptIssuer({ POS_RECEIPT_ISSUER_FILE: path.join(existingRoot, 'receipt-issuer.json') });
assert(issuer, 'Falta receipt-issuer.json del paquete original. Recupera ese archivo; no inventes los datos fiscales.');
const order: SavedOrder = existsSync(sampleFile) ? JSON.parse(readFileSync(sampleFile, 'utf8').replace(/^\uFEFF/, '')) : {
  id: randomUUID(), ticket_number: 'PRUEBA-R8', status: 'completed', total: 110,
  customer_name: 'ANA (PRUEBA)', order_type: 'Llevar', order_note: '', created_at: new Date().toISOString(),
  payment_method: 'efectivo', tender_mxn: 150, tender_usd: 0, exchange_rate: 20, change_mxn: 40,
  items: [{ id: 'receipt-only', quantity: 1, product: { id: 'sample-caramelo', name: 'Iced coffee caramelo', price: 110,
    category: 'Bebidas', displayExtras: [{ name: 'Leche de avena', price: 15 }], note: 'SIN HIELO. NO PREPARAR.' } }],
};
assert.equal(order.ticket_number, 'PRUEBA-R8', 'La muestra guardada no coincide. Consérvala y revisa antes de continuar.');
assert.equal(order.total, 110); assert.equal(order.tender_mxn, 150); assert.equal(order.change_mxn, 40);
assert.equal(order.items.length, 1); assert.equal(order.items[0].quantity, 1);
assert.match(order.items[0].product.note ?? '', /NO PREPARAR/);
const owner = 'physical-test-only';

if (!print && !simulate) {
  const document = saleDocuments(order, { testOnly: true, issuer }).customer;
  const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundleRoot, 'scripts/printing/windows-print.ps1'), '-LayoutOnly'],
    { input: JSON.stringify({ ...document, fontPoints: 9, widthMm: 71.88, heightMm: 210.06, previewDirectory: path.join(bundleRoot, 'preview') }) + '\n', encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(snapshot(), before, 'La vista previa modificó el registro.');
  console.log(JSON.stringify({ mode: 'preview', journal: filename, priorJobs: before.jobs.length, priorAuditRows: before.reviews.length,
    journalRecordsSha256: beforeHash, journalUnchanged: true, pages: JSON.parse(result.stdout).length, preview: path.join(bundleRoot, 'preview'), physicalPrints: 0 }, null, 2));
} else {
  if (!existsSync(sampleFile)) {
    assert(!before.jobs.some(row => row.ticket === order.ticket_number), 'El ticket ya existe, pero falta su muestra. Recupérala antes de continuar; no crees otra.');
    writeFileSync(sampleFile, JSON.stringify(order, null, 2), { flag: 'wx' });
  }
  const config: PrintConfig = { mode, directory, queues: { customer: machine.customer.queue, barista: machine.barista.queue }, baristaStock: null };
  const adapter = printerAdapter(config);
  const journal = new PrintJournal(filename, { async prepare(job, document) {
    assert.equal(job.audience, 'customer', 'Esta prueba solo admite el ticket del cliente.');
    return adapter.prepare(job, document);
  } });
  let jobs;
  try {
    journal.ensure(owner, order, config.queues, { testOnly: true, issuer }, 'customer');
    jobs = await journal.dispatch(owner, order.id, 'customer');
    assert.equal(jobs.length, 1); assert.equal(jobs[0].audience, 'customer');
  } finally { journal.close(); }
  const after = snapshot();
  const unchanged = <T extends Record<string, unknown>>(oldRows: T[], newRows: T[], key: (row: T) => string) => {
    const current = new Map(newRows.map(row => [key(row), row]));
    for (const row of oldRows) {
      // A repeat may advance only THIS new customer copy if it was blocked.
      if (row.order_id === order.id && row.audience === 'customer') continue;
      assert.deepEqual(current.get(key(row)), row, 'Cambió un registro de otra impresión. Revisa antes de reenviar.');
    }
  };
  unchanged(before.jobs, after.jobs, row => `${row.order_id}:${row.audience}`);
  unchanged(before.sources, after.sources, row => String(row.order_id));
  assert.deepEqual(after.reviews, before.reviews, 'La prueba modificó el historial de revisiones.');
  assert(!after.jobs.some(row => row.order_id === order.id && row.audience === 'barista'), 'La prueba creó una copia de barra.');
  const result = { mode, testCase: 'receipt-branding-v8', saleId: order.id, ticket: order.ticket_number, journal: filename,
    priorJobs: before.jobs.length, priorJournalRecordsSha256: beforeHash, unrelatedJournalRowsUnchanged: true, baristaJobsCreated: 0, jobs };
  writeFileSync(path.join(directory, 'result-receipt-branding-v8.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log('Conserva la muestra y el registro. El mismo comando no reenvía copias aceptadas o inciertas.');
  if (jobs[0].state !== 'submitted') process.exitCode = 2;
}
