import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import machine from '../../config/cafe-printers.json';
import { PrintJournal } from '../../lib/print-journal-server';
import { printerAdapter, type PrintConfig } from '../../lib/windows-print-server';
import { readReceiptIssuer } from '../../lib/receipt-issuer-server';
import { saleDocuments } from '../../lib/sale-printing';
import type { SavedOrder } from '../../lib/checkout';

// The actual POS generator, adapter and journal; synthetic data only, no cloud.
const root = path.dirname(fileURLToPath(import.meta.url)); process.chdir(root);
const args = process.argv.slice(2);
assert(args.every(arg => ['--preview','--print','--simulate'].includes(arg) || arg.startsWith('--existing-root=')), 'Argumento inválido');
assert(args.filter(arg => ['--preview','--print','--simulate'].includes(arg)).length <= 1, 'Elige un solo modo');
assert.equal(args.filter(arg => arg.startsWith('--existing-root=')).length,1,'Indica la carpeta ORIGINAL una sola vez');
const rootArg = args.find(arg=>arg.startsWith('--existing-root='))!.slice('--existing-root='.length);
assert(path.isAbsolute(rootArg) && !/^(?:\\\\|\/\/)/.test(rootArg), 'Usa la ruta local absoluta del paquete original');
const original = realpathSync(rootArg), simulate = args.includes('--simulate'), physical = args.includes('--print');
const mode = simulate ? 'mock' : 'windows';
const directory = path.join(original,'runtime',mode), filename = path.join(directory,`${mode}-jobs.sqlite`);
assert(existsSync(filename),'Falta el registro ORIGINAL. DETENTE; no crees otro registro.');
assert.equal(realpathSync(directory).toLowerCase(),directory.toLowerCase(),'El registro no puede redirigir a otra carpeta');
assert.equal(realpathSync(filename).toLowerCase(),filename.toLowerCase(),'El registro no puede redirigir a otro archivo');
function snapshot(): {jobs:Record<string,unknown>[];sources:Record<string,unknown>[];reviews:Record<string,unknown>[]} {
  const db = new DatabaseSync(filename,{readOnly:true});
  try { return JSON.parse(JSON.stringify({jobs:db.prepare('SELECT * FROM jobs ORDER BY order_id,audience').all(),
    sources:db.prepare('SELECT * FROM sale_sources ORDER BY order_id').all(),reviews:db.prepare('SELECT * FROM recovery_audit ORDER BY request_id').all()})); }
  finally {db.close();}
}
const before = snapshot();assert(before.jobs.length>0,'El registro está vacío. Localiza el ORIGINAL; no uses uno nuevo.');
const beforeHash = createHash('sha256').update(JSON.stringify(before)).digest('hex');
const issuer = readReceiptIssuer({POS_RECEIPT_ISSUER_FILE:path.join(original,'receipt-issuer.json')});
assert(issuer,'Faltan los datos locales del emisor; no inventes ni reemplaces el perfil.');
const sampleFile = path.join(directory,'sample-dual-layout-v9.json');
const order:SavedOrder = existsSync(sampleFile) ? JSON.parse(readFileSync(sampleFile,'utf8').replace(/^\uFEFF/,'')) : {
  id:randomUUID(),ticket_number:'PRUEBA-D2',status:'completed',total:110,customer_name:'María López',order_type:'Para llevar',order_note:'',
  created_at:new Date().toISOString(),payment_method:'efectivo',tender_mxn:150,tender_usd:0,exchange_rate:20,change_mxn:40,
  items:[{id:'sample-matcha',quantity:1,product:{id:'sample-matcha',name:'Iced Matcha Latte',price:110,category:'Bebidas',
    displayExtras:['Leche de avena','Vainilla','1 Shot Espresso'].map(name=>({name,price:0})),note:'NO PREPARAR'}}],
};
assert.equal(order.ticket_number,'PRUEBA-D2');assert.equal(order.items.length,1);assert.equal(order.items[0].quantity,1);
assert.equal(order.total,110);assert.equal(order.tender_mxn,150);assert.equal(order.change_mxn,40);
assert.match(order.items[0].product.note??'',/NO PREPARAR/);
const documents = saleDocuments(order,{issuer,testOnly:true});
assert(!/CFDI|CDFI/i.test(documents.customer.sections.flat().join(' ')),'Esta muestra debe usar el recibo SIN leyendas de CFDI');
assert.equal(documents.barista.labelLayout,'reference-v2');
const pageCounts:Record<string,number>={};
if (!simulate) {
  for(const audience of ['customer','barista'] as const) {
    const label=audience==='barista';
    const result=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/printing/windows-print.ps1'),'-LayoutOnly'],
      {input:JSON.stringify({...documents[audience],fontPoints:9,widthMm:label?56.9:71.88,heightMm:label?32:210.06,
        verticalLabel:label,previewDirectory:path.join(root,'preview',audience)})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    pageCounts[audience]=JSON.parse(result.stdout).length;
  }
  // A readable upright view of the exact label artwork, not a different stock setting.
  const view=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/printing/windows-print.ps1'),'-LayoutOnly'],
    {input:JSON.stringify({...documents.barista,fontPoints:9,widthMm:32,heightMm:56.9,verticalLabel:false,
      previewDirectory:path.join(root,'preview/barista-upright')})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(view.status,0,view.stderr||view.stdout);
  assert.deepEqual(snapshot(),before,'La vista previa no puede modificar el registro');
  assert.equal(pageCounts.customer,1,'La muestra del recibo debe caber en una página. No se imprimió; revisa la vista previa.');
  assert.equal(pageCounts.barista,1,'La muestra de etiqueta debe caber en una etiqueta. No se imprimió; revisa la vista previa.');
}
if (!physical && !simulate) {
  console.log(JSON.stringify({mode:'preview',ticket:order.ticket_number,journal:filename,journalUnchanged:true,physicalPrints:0,
    priorJobs:before.jobs.length,priorAuditRows:before.reviews.length,journalRecordsSha256:beforeHash,pages:pageCounts,preview:path.join(root,'preview')},null,2));
} else {
  if (!existsSync(sampleFile)) {
    assert(!before.jobs.some(job=>job.ticket===order.ticket_number),'Ya existe PRUEBA-D2 pero falta su muestra. DETENTE; no generes otra identidad.');
    writeFileSync(sampleFile,JSON.stringify(order,null,2),{flag:'wx'});
  }
  const config:PrintConfig={mode,directory,queues:{customer:machine.customer.queue,barista:machine.barista.queue},baristaStock:{widthMm:57.15,heightMm:31.75}};
  const adapter=printerAdapter(config);
  const journal=new PrintJournal(filename,{async prepare(job,document){
    assert.equal(job.orderId,order.id,'No se permite enviar otra orden');
    if(job.audience==='barista')assert.equal(document.labelLayout,'reference-v2');
    else assert(!/CFDI|CDFI/i.test(document.sections.flat().join(' ')));
    return adapter.prepare(job,document);
  }});
  let jobs;
  const dispatchStartedUtc=new Date().toISOString();
  try {journal.ensure('physical-test-only',order,config.queues,{issuer,testOnly:true});jobs=await journal.dispatch('physical-test-only',order.id);}
  finally {journal.close();}
  const after=snapshot();
  for(const row of before.jobs) {
    if(row.order_id===order.id && ['queued','blocked','preparing'].includes(String(row.state)))continue;
    assert.deepEqual(after.jobs.find(job=>job.order_id===row.order_id&&job.audience===row.audience),row,'Cambió un trabajo anterior; revisa y no reenvíes');
  }
  for(const row of before.sources)assert.deepEqual(after.sources.find(source=>source.order_id===row.order_id),row);
  assert.deepEqual(after.reviews,before.reviews,'Esta prueba no autoriza reposiciones ni cambios al historial de recuperación');
  assert.equal(jobs.length,2);assert.equal(jobs.filter(job=>job.audience==='customer').length,1);assert.equal(jobs.filter(job=>job.audience==='barista').length,1);
  const result={mode,testCase:'current-dual-layout-v9',ticket:order.ticket_number,saleId:order.id,journal:filename,concurrentDispatch:true,
    dispatchStartedUtc,unrelatedJournalRowsUnchanged:true,recoveryAuditUnchanged:true,priorJobs:before.jobs.length,priorRecordsSha256:beforeHash,
    pages:pageCounts,physicalPaperConfirmed:false,jobs};
  writeFileSync(path.join(directory,'result-dual-layout-v9.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  console.log('Submitted confirma entrega a Windows, NO salida en papel. Conserva esta muestra y el registro; no fuerces reposiciones.');
  if(jobs.some(job=>job.state!=='submitted'))process.exitCode=2;
}
