import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import machine from '../../config/cafe-printers.json';
import { PrintJournal } from '../../lib/print-journal-server';
import { printerAdapter, type PrintConfig } from '../../lib/windows-print-server';
import { readReceiptIssuer } from '../../lib/receipt-issuer-server';
import type { SavedOrder } from '../../lib/checkout';

// Bundled into the portable hardware kit. It contains no Supabase client or API
// credentials and cannot charge a customer or change the cafe database.
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
// Optional local issuer profile is separate from versioned source and contains
// only the receipt fields. Missing profiles retain the marked placeholder test.
const issuerFile = path.join(root, 'receipt-issuer.json');
const issuer = existsSync(issuerFile) ? readReceiptIssuer({ POS_RECEIPT_ISSUER_FILE: issuerFile }) : undefined;
const physical = process.argv.includes('--print');
const testCase = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length) || 'baseline';
if (!/^(baseline|repeat-(0[2-9]|1\d|20)|bluetooth-offline|usb-offline|paper-out|long-notes)$/.test(testCase)) {
  throw new Error('Caso de prueba inválido. No se envió ninguna copia.');
}
const widthMm = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1]);
const heightMm = Number(process.argv.find(arg => arg.startsWith('--height='))?.split('=')[1]);
if (physical && !(widthMm >= 25 && widthMm <= 150 && heightMm >= 20 && heightMm <= 300)) {
  throw new Error('Primero mide la etiqueta cargada. Especifica ancho y alto en mm; no se envió ninguna copia.');
}
const mode = physical ? 'windows' : 'mock';
const directory = path.join(root, 'runtime', mode);
mkdirSync(directory, { recursive: true });
const filename = path.join(directory, testCase === 'baseline' ? 'sample-sale.json' : `sample-sale-${testCase}.json`);
let order: SavedOrder;
if (existsSync(filename)) order = JSON.parse(readFileSync(filename, 'utf8'));
else {
  const faultTickets: Record<string,string> = { 'bluetooth-offline':'PRUEBA-BT', 'usb-offline':'PRUEBA-USB', 'paper-out':'PRUEBA-PAPEL', 'long-notes':'PRUEBA-NOTAS' };
  const ticket = testCase === 'baseline' ? 'PRUEBA-001' : testCase.startsWith('repeat-') ? `PRUEBA-0${testCase.slice(-2)}` : faultTickets[testCase];
  order = { id: randomUUID(), ticket_number: ticket, status: 'completed', total: 220,
    items: [{ id: 'iced-test', quantity: 2, product: { id: 'synthetic-iced', name: 'Iced coffee caramelo', price: 110, category: 'Bebidas',
      displayExtras: [{ name: 'Leche de avena', price: 15 }], note: 'NO PREPARAR. PRUEBA FÍSICA; SIN HIELO.' } }],
    customer_name: 'PRUEBA LOCAL — NO CLIENTE', order_type: 'Para Llevar', order_note: 'PRUEBA DE IMPRESORAS — NO ES UNA VENTA NI UN COBRO',
    created_at: new Date().toISOString(), payment_method: 'efectivo', tender_mxn: 250, tender_usd: 0, exchange_rate: 20, change_mxn: 30 };
  if (testCase === 'long-notes') order.items = ['Iced coffee caramelo', 'Iced coffee vainilla'].map((name,index) => ({
    id: `long-${index}`,quantity:1,product:{id:`synthetic-${index}`,name,price:110,category:'Bebidas',
      displayExtras:[{name:'Leche de avena',price:15}],
      note:`PRUEBA; NO PREPARAR. ${index ? 'SEGUNDA BEBIDA' : 'PRIMERA BEBIDA'}. ` + 'Sin hielo y sin azúcar. '.repeat(12) + `FIN-NOTA-${index+1}` }
  }));
  writeFileSync(filename, JSON.stringify(order, null, 2), { flag: 'wx' });
}
const config: PrintConfig = { mode, directory,
  queues: { customer: machine.customer.queue, barista: machine.barista.queue },
  baristaStock: physical ? { widthMm, heightMm } : null };
const journal = new PrintJournal(path.join(directory, `${mode}-jobs.sqlite`), printerAdapter(config));
try {
  journal.ensure('physical-test-only', order, config.queues, { testOnly: true, issuer });
  const jobs = await journal.dispatch('physical-test-only', order.id);
  const result = JSON.stringify({ mode, testCase, saleId: order.id, labelMm: physical ? [widthMm, heightMm] : null, jobs }, null, 2);
  writeFileSync(path.join(directory, 'last-result.json'), result);
  writeFileSync(path.join(directory, `result-${testCase}.json`), result);
  console.log(physical ? 'PRUEBA FÍSICA — SIN BASE DE DATOS NI COBROS' : 'SIMULACIÓN — NO SE USÓ NINGUNA IMPRESORA');
  console.log(`Caso guardado: ${testCase} | Folio: ${order.ticket_number}`);
  for (const job of jobs) console.log(`${job.audience === 'customer' ? 'CLIENTE USB' : 'BARRA BLUETOOTH'} | ${job.queue} | ${job.state} | ${job.message}`);
  console.log('Repetir el comando conserva el mismo folio y NO reenvía copias aceptadas por Windows.');
  console.log('Si Windows aceptó el trabajo pero no salió papel, revisa esa cola; no borres el registro para forzar un reenvío.');
  if (jobs.some(job => job.state !== 'submitted')) process.exitCode = 2;
} finally { journal.close(); }
