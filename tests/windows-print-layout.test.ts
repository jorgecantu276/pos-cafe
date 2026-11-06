import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { phoneOrderDocuments,saleDocuments } from '../lib/sale-printing';

const dessertNames=['Brownie tradicional','Galleta de pistache y chocolate blanco','Crookie nutella','Muffin cajeta con queso','Rebanada cheesecake','Cheese danish'];
const dessertItems=()=>dessertNames.map((name,index)=>({id:String(index),quantity:index===0?2:1,product:{id:String(index),name,price:50,category:'Postres',note:index===2?'Calentar por separado':''}}));
const labelLayout=(document:object,previewDirectory?:string)=>spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
  {input:JSON.stringify({...document,verticalLabel:true,fontPoints:9,widthMm:56.9,heightMm:32,previewDirectory})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});

test('the six real-catalog desserts, two brownies and preparation note fit one physical drink-stock sticker', {skip:process.platform!=='win32'},()=>{
  const document=saleDocuments({id:'dessert-layout',ticket_number:4321,status:'completed',total:350,
    items:dessertItems(),customer_name:'Ana López',order_type:'Para Llevar',order_note:'',created_at:'2026-11-05T18:00:00Z',pager_number:12,
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:16,change_mxn:0}).desserts!;
  const directory=mkdtempSync(path.join(tmpdir(),'pos-compact-desserts-'));
  try{
  const result=labelLayout(document,directory);
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);assert.equal(pages.length,1);assert.equal(document.sections.length,1);
  const text=pages[0].lines.join(' ');assert.match(text,/POSTRES/);assert.match(text,/CONTROL 12/);assert.match(text,/#4321/);assert.match(text,/Ana López/);
  assert.match(text,/2 × Brownie tradicional/);assert.match(text,/Calentar por separado/);assert.doesNotMatch(text,/\$|TOTAL|Cambio/);
  for(const name of dessertNames)assert.ok(text.includes(name),`Complete dessert name: ${name}`);
  const svg=readFileSync(path.join(directory,'page-1.svg'),'utf8');
  assert.match(svg,/width="56.9mm" height="32mm"/);assert.match(svg,/rotate\(90\)/);
  for(const point of [...svg.matchAll(/font-size="([\d.]+)"/g)])assert.ok(+point[1]>=6.5&&+point[1]<=8.5,`Readable compact font: ${point[1]}`);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('six normal phone desserts fit one physical sticker retaining unpaid folio and every product', {skip:process.platform!=='win32'},()=>{
  const document=phoneOrderDocuments({id:'phone-dessert-layout',folio:43,contact_name:'Ana de prueba',contact_phone:'8682345678',
    snapshot:{items:dessertItems(),total:350,customer_name:'Ana de prueba',order_type:'Para Llevar',order_note:'',created_at:'2026-11-05T18:00:00Z'}}).desserts!;
  const result=labelLayout(document);
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);assert.equal(pages.length,1);
  for(const page of pages){const text=page.lines.join(' ');assert.match(text,/POSTRES/);assert.match(text,/T0043/);assert.match(text,/SIN PAGAR/);assert.doesNotMatch(text,/CONTROL/);}
  const text=pages[0].lines.join(' ');assert.match(text,/2 × Brownie/);assert.match(text,/Calentar por separado/);
  for(const name of dessertNames)assert.ok(text.includes(name),name);
});

for(const overflow of ['name','note'])test(`an excessive dessert ${overflow} in a six-item order blocks before output instead of creating additional labels`, {skip:process.platform!=='win32'},()=>{
  const document=saleDocuments({id:'oversized-dessert',ticket_number:4321,status:'completed',total:30,
    items:[{id:'dessert',quantity:1,product:{id:'brownie',name:overflow==='name'?'Z'.repeat(220):'Brownie tradicional',price:30,category:'Postres',note:overflow==='note'?'Calentar por separado. '.repeat(30)+'FIN-NOTA':''}},...dessertItems().slice(1)],
    customer_name:'Ana',order_type:'Para Llevar',order_note:'',created_at:'2026-11-05T18:00:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:16,change_mxn:0}).desserts!;
  const directory=mkdtempSync(path.join(tmpdir(),'pos-dessert-overflow-'));
  try{
    const result=labelLayout(document,directory);
    assert.equal(result.status,1,result.stderr||result.stdout);
    assert.deepEqual(JSON.parse(result.stdout),{state:'error',code:'dessert-content-too-long'});
    assert.deepEqual(readdirSync(directory),[],'No partial label preview is emitted');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('a saved reference-v2 dessert snapshot keeps its identified continuation rendering', {skip:process.platform!=='win32'},()=>{
  const document={title:'CM #OLD POSTRES',labelLayout:'reference-v2',sections:[['Ana','POSTRES','2 × Brownie tradicional','Calentar. '.repeat(40)+'FIN-ORIGINAL','#OLD · POSTRES']],
    styles:[['name','drink','preparation-item','note','footer']],referenceLabels:[{folio:'#OLD',cup:'ORDEN',service:'Para Llevar',date:'06/11/26',time:'12:00'}]};
  const result=labelLayout(document);assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);assert.ok(pages.length>1);
  for(const page of pages){assert.match(page.lines.join(' '),/POSTRES/);assert.match(page.lines.join(' '),/#OLD/);}
  const text=pages.flatMap(page=>page.lines).join(' ');assert.equal((text.match(/Calentar\./g)||[]).length,40);assert.match(text,/FIN-ORIGINAL/);
});

test('phone preparation keeps its unpaid identity on every rendered continuation without a payment receipt', {skip:process.platform!=='win32'},()=>{
  const documents=phoneOrderDocuments({id:'phone-layout',folio:43,contact_name:'Ana de prueba',contact_phone:'8682345678',
    snapshot:{items:[{id:'cup',quantity:1,product:{id:'iced',name:'Iced coffee caramelo',price:110,category:'Bebidas',note:'Sin azúcar. '.repeat(80)}}],
      total:110,customer_name:'Ana de prueba',order_type:'Para Llevar',order_note:'',created_at:'2026-11-02T17:00:00Z'}});
  for(const audience of ['customer','barista'] as const){
    const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
      {input:JSON.stringify({...documents[audience],verticalLabel:audience==='barista',fontPoints:9,widthMm:audience==='barista'?56.9:71.88,heightMm:audience==='barista'?32:210.06})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    const pages:{lines:string[]}[]=JSON.parse(result.stdout);
    if(audience==='barista'){
      assert.ok(pages.length>1);
      for(const page of pages){assert.match(page.lines.join(' '),/T0043/);assert.match(page.lines.join(' '),/SIN PAGAR/);}
    }else{
      const output=pages.flatMap(page=>page.lines).join(' ');assert.match(output,/PENDIENTE DE PAGO/);assert.doesNotMatch(output,/TICKET DE VENTA|Recibido MXN/);
    }
  }
});

test('pager identity repeats on every physical barista continuation and is prominent on the customer receipt', {skip:process.platform!=='win32'},()=>{
  const docs=saleDocuments({id:'pager',ticket_number:1288,status:'completed',total:50,pager_number:30,
    items:[{id:'cup',quantity:1,product:{id:'coffee',name:'Café americano',price:50,category:'Bebidas',note:'Sin azúcar. '.repeat(120)}}],
    customer_name:'Ana',order_type:'En Local',order_note:'',created_at:'2026-11-02T17:00:00Z',payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0});
  const render=(audience:'customer'|'barista')=>{
    const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
      {input:JSON.stringify({...docs[audience],verticalLabel:audience==='barista',fontPoints:9,widthMm:audience==='barista'?56.9:71.88,heightMm:audience==='barista'?32:210.06})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout);return JSON.parse(result.stdout) as {lines:string[]}[];
  };
  const barista=render('barista');assert.ok(barista.length>1);
  for(const page of barista){assert.match(page.lines.join(' '),/CONTROL 30/);assert.match(page.lines.join(' '),/#1288/);}
  assert.match(render('customer').flatMap(page=>page.lines).join(' '),/CONTROL: 30/);
});

test('reference design fits customer/folio, large drink, four modifiers and dated footer on one label', { skip: process.platform !== 'win32' }, () => {
  const doc = saleDocuments({id:'reference',ticket_number:1287,status:'completed',total:110,
    items:[{id:'cup',quantity:1,product:{id:'matcha',name:'Iced Matcha Latte',price:110,category:'Bebidas',
      displayExtras:['Leche de avena','Vainilla','Hielo normal','1 Shot Espresso'].map(name=>({name,price:0}))}}],
    customer_name:'María López',order_type:'Para llevar',order_note:'',created_at:'2025-05-12T16:45:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0}).barista;
  assert.equal(doc.labelLayout,'reference-v2');
  assert.deepEqual(doc.referenceLabels,[{folio:'#1287',cup:'1/1',service:'Para llevar',date:'12/05/25',time:'11:45 AM'}]);
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    {input:JSON.stringify({...doc,verticalLabel:true,fontPoints:9,widthMm:56.9,heightMm:31.75})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);
  assert.equal(pages.length,1);
  for(const value of ['María López','#1287','1/1','Iced Matcha Latte','- Leche de avena','- Vainilla','- Hielo normal','- 1 Shot Espresso','Para llevar','12/05/25','11:45 AM']) assert.ok(pages[0].lines.join(' ').includes(value),value);
});

test('accepted receipt weights and fixed columns survive rendering; label rotation keeps the physical stock size', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'cafe-onsite-layout-'));
  const docs = saleDocuments({ id:'onsite-layout',ticket_number:1234,status:'completed',total:110,
    items:[{id:'cup',quantity:1,product:{id:'iced',name:'Iced coffee caramelo',price:110,category:'Bebidas',displayExtras:[{name:'Leche de avena',price:15}],note:'Sin hielo'}}],
    customer_name:'Ana',order_type:'Para Llevar',order_note:'',created_at:'2026-10-31T17:00:00Z',
    payment_method:'efectivo',tender_mxn:150,tender_usd:0,exchange_rate:20,change_mxn:40 });
  function preview(audience: 'customer' | 'barista') {
    const destination = path.join(directory, audience);
    const result = spawnSync(path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
      {input:JSON.stringify({...docs[audience],verticalLabel:audience==='barista',fontPoints:9,
        widthMm:audience==='barista'?56.9:71.88,heightMm:audience==='barista'?32:210.06,previewDirectory:destination})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    return {pages:JSON.parse(result.stdout) as {lines:string[]}[],svg:readFileSync(path.join(destination,'page-1.svg'),'utf8'),png:readFileSync(path.join(destination,'page-1.png'))};
  }
  try {
    const receipt = preview('customer');
    assert.equal(receipt.pages.length,1);
    assert.match(receipt.svg, /data:image\/jpeg;base64,/);
    assert.match(receipt.svg, /font-size="14" font-weight="700">TICKET DE VENTA/);
    assert.match(receipt.svg, /font-size="15" font-weight="700">TOTAL:/);
    assert.match(receipt.svg, /font-size="8.5" font-weight="700">Cambio:/);
    assert.doesNotMatch(receipt.svg, /font-weight="400"|Courier|rotate\(90\)/);
    assert.match(receipt.svg, /shape-rendering="crispEdges"/);
    assert.match(receipt.svg, /MENÚ E INSTAGRAM/);
    assert.match(receipt.svg, /Para el postre y una sonrisa,/);
    const cells = [...receipt.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(CANT\.|P.UNITARIO|IMPORTE|1|\$110.00)<\/text>/g)];
    const header=cells.filter(m=>['CANT.','P.UNITARIO','IMPORTE'].includes(m[3]));
    const amounts=cells.filter(m=>['1','$110.00'].includes(m[3]));
    assert.equal(header.length,3);assert.equal(amounts.length,3);
    for(const row of [header,amounts]) { assert.equal(new Set(row.map(m=>m[2])).size,1);assert(+row[0][1]<+row[1][1]&&+row[1][1]<+row[2][1]); }
    const label = preview('barista');
    assert.equal(label.pages.length,1);
    assert.match(label.svg, /width="56.9mm" height="32mm"/);
    assert.match(label.svg, /<g transform="translate\([\d.]+ 0\) rotate\(90\)">/);
    assert.match(label.svg,/font-size="12" font-weight="700">Iced coffee/);
    assert.match(label.svg,/font-size="8.5" font-weight="700">- Leche de avena/);
    assert.doesNotMatch(label.svg,/font-weight="400"|Arial Narrow|fill="(?:blue|pink|yellow|#[0-9a-fA-F]+)"/);
    assert.equal((label.svg.match(/stroke-width="0.65"/g)||[]).length,2);
    assert.equal(label.png.readUInt32BE(16),455);assert.equal(label.png.readUInt32BE(20),256);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('saved label snapshots retain all notes and cup footers even with obsolete reference metadata', { skip: process.platform !== 'win32' }, () => {
  const note='Sin hielo. '.repeat(20)+'FIN-NOTA';
  const document={title:'CM #PRUEBA BARRA',sections:[['ANA','Iced coffee caramelo',note,'#PRUEBA · 1/1 · Para Llevar · 12:13']],
    styles:[['name','drink','note','footer']],cupLabels:[{folio:'#PRUEBA · 1/1',service:'Para Llevar',date:'31/10/26',time:'12:13'}],
    verticalLabel:true,fontPoints:9,widthMm:56.9,heightMm:32};
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    {input:JSON.stringify(document)+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);
  assert.ok(pages.length>1);
  for(const page of pages) assert.match(page.lines.join(' '),/#PRUEBA · 1\/1 · Para Llevar · 12:13/);
  const content=pages.flatMap(page=>page.lines).join(' ');
  assert.equal((content.match(/Sin hielo\./g)||[]).length,20);assert.match(content,/FIN-NOTA/);
});

test('every overflow label identifies its own cup, including two different drinks with long instructions', { skip: process.platform !== 'win32' }, () => {
  const docs=saleDocuments({id:'overflow-cups',ticket_number:9876,status:'completed',total:220,
    items:['Iced coffee caramelo','Iced coffee vainilla'].map((name,index)=>({id:String(index),quantity:1,
      product:{id:String(index),name,price:110,category:'Bebidas',note:('Sin azúcar. Leche de avena. '+(index?'SEGUNDA BEBIDA. ':'PRIMERA BEBIDA. ')).repeat(12)+'FIN-'+(index+1)}})),
    customer_name:'Ana y José',order_type:'Para Llevar',order_note:'Entregar juntos',created_at:'2026-10-30T17:00:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0});
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    {input:JSON.stringify({...docs.barista,verticalLabel:true,fontPoints:9,widthMm:57.15,heightMm:31.75})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);
  assert.ok(pages.length>4);
  let secondCup=false;
  for(const page of pages){
    if(page.lines.some(line=>/^2\/2(?: CONT\.)?$/.test(line)))secondCup=true;
    assert.match(page.lines.join(' '),new RegExp('#9876.*'+(secondCup?'2':'1')+'/2'),
      'A detached continuation must retain its folio AND cup identity');
  }
  assert.match(pages.flatMap(page=>page.lines).join(' '),/FIN-1/);
  assert.match(pages.flatMap(page=>page.lines).join(' '),/FIN-2/);
});

test('actual Windows helper compiles and paginates long label notes without a spooler call', { skip: process.platform !== 'win32' }, () => {
  const note = 'Sin hielo y sin azúcar '.repeat(80) + 'FIN-DE-NOTA';
  const input = { title: 'CM #1234 BARRA', sections: [['BARRA #1234', 'Ana · Para Llevar', 'Café grande', note], ['BARRA #1234 2/2', 'Segunda bebida']],
    fontPoints: 9, widthMm: 57, heightMm: 32 };
  const result = spawnSync(path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'scripts/printing/windows-print.ps1', '-LayoutOnly'],
    { input: JSON.stringify(input) + '\n', encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const pages: { lines: string[] }[] = JSON.parse(result.stdout);
  assert.ok(pages.length > 3);
  assert.ok(pages.slice(1, -1).every(page => page.lines[0].includes('1234') && page.lines[0].includes('CONT.')));
  assert.ok(pages.at(-1)?.lines[0].includes('2/2'));
  const printed = pages.flatMap(page => page.lines).filter(line => !line.includes(' CONT.')).join(' ').replace(/\s+/g, ' ');
  assert.ok(printed.includes(note.trim()), 'The final preparation text must survive line wrapping and continuation labels');
  assert.match(printed, /FIN-DE-NOTA/);
});

test('normal real-menu cup context fits the selected Hybsk 57.15 x 31.75 mm stock in one label', { skip: process.platform !== 'win32' }, () => {
  const docs = saleDocuments({ id:'test',ticket_number:1234,status:'completed',total:110,
    items:[{id:'cup',quantity:1,product:{id:'iced',name:'Iced coffee caramelo',price:110,category:'Bebidas',displayExtras:[{name:'Leche de avena',price:15}],note:'Sin hielo'}}],
    customer_name:'Ana y José',order_type:'Para Llevar',order_note:'Entregar juntos',created_at:'2026-10-30T17:00:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0 });
  const result = spawnSync(path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    { input:JSON.stringify({...docs.barista,verticalLabel:true,fontPoints:9,widthMm:57.15,heightMm:31.75})+'\n',encoding:'utf8',windowsHide:true,timeout:30_000 });
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages: {lines:string[]}[] = JSON.parse(result.stdout);
  assert.equal(pages.length,1);
  for (const value of ['Ana y José','#1234','1/1','Iced coffee caramelo','Leche de avena','Sin hielo','Entregar juntos','Para Llevar','12:00']) assert.ok(pages[0].lines.join(' ').includes(value), value);
});
