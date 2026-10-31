import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { saleDocuments } from '../lib/sale-printing';

test('POS generates the exact flowing barista content accepted in the simultaneous physical test', { skip: process.platform !== 'win32' }, () => {
  const doc = saleDocuments({id:'approved-dual',ticket_number:'PRUEBA-D1',status:'completed',total:110,
    items:[{id:'cup',quantity:1,product:{id:'caramelo',name:'Iced coffee caramelo',price:110,category:'Bebidas',
      displayExtras:[{name:'Leche de avena',price:15}],note:'SIN HIELO. NO PREPARAR.'}}],
    customer_name:'ANA (PRUEBA)',order_type:'Llevar',order_note:'',created_at:'2026-10-31T18:13:00Z',
    payment_method:'efectivo',tender_mxn:150,tender_usd:0,exchange_rate:20,change_mxn:40}).barista;
  assert.deepEqual(doc.sections,[['ANA (PRUEBA)','Iced coffee caramelo','Leche de avena','SIN HIELO. NO PREPARAR.','#PRUEBA-D1 · 1/1 · Llevar · 13:13']]);
  assert.equal(doc.cupLabels,undefined);
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    {input:JSON.stringify({...doc,verticalLabel:true,fontPoints:9,widthMm:56.9,heightMm:31.75})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages:{lines:string[]}[]=JSON.parse(result.stdout);
  assert.equal(pages.length,1);
  for(const value of doc.sections[0]) assert.ok(pages[0].lines.join(' ').includes(value),value);
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
    assert.doesNotMatch(label.svg, /font-size="(?!8.5")|font-weight="400"|Arial Narrow/);
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
    if(page.lines.some(line=>line==='Iced coffee vainilla'))secondCup=true;
    assert.match(page.lines.join(' '),new RegExp('#9876 · '+(secondCup?'2':'1')+'/2'),
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
  for (const value of ['ANA Y JOSÉ','#1234 · 1/1','Iced coffee caramelo','Leche de avena','Sin hielo','Entregar juntos','Para Llevar','12:00']) assert.ok(pages[0].lines.join(' ').includes(value), value);
});
