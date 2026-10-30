import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { saleDocuments } from '../lib/sale-printing';

test('every overflow label identifies its own cup, including two different drinks with long instructions', { skip: process.platform !== 'win32' }, () => {
  const docs=saleDocuments({id:'overflow-cups',ticket_number:9876,status:'completed',total:220,
    items:['Iced coffee caramelo','Iced coffee vainilla'].map((name,index)=>({id:String(index),quantity:1,
      product:{id:String(index),name,price:110,category:'Bebidas',stock:0,
        note:('Sin azúcar. Leche de avena. '+(index?'SEGUNDA BEBIDA. ':'PRIMERA BEBIDA. ')).repeat(12)+'FIN-'+(index+1)}})),
    customer_name:'Ana y José',order_type:'Para Llevar',order_note:'Entregar juntos',created_at:'2026-10-30T17:00:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0});
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    {input:JSON.stringify({...docs.barista,fontPoints:9,widthMm:57.15,heightMm:31.75})+'\n',encoding:'utf8',windowsHide:true,timeout:30000});
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
    items:[{id:'cup',quantity:1,product:{id:'iced',name:'Iced coffee caramelo',price:110,category:'Bebidas',stock:0,
      displayExtras:[{name:'Leche de avena',price:15}],note:'Sin hielo'}}],
    customer_name:'Ana y José',order_type:'Para Llevar',order_note:'Entregar juntos',created_at:'2026-10-30T17:00:00Z',
    payment_method:'tarjeta',tender_mxn:0,tender_usd:0,exchange_rate:20,change_mxn:0 });
  const result = spawnSync(path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-File','scripts/printing/windows-print.ps1','-LayoutOnly'],
    { input:JSON.stringify({...docs.barista,fontPoints:9,widthMm:57.15,heightMm:31.75})+'\n',encoding:'utf8',windowsHide:true,timeout:30_000 });
  assert.equal(result.status,0,result.stderr||result.stdout);
  const pages: {lines:string[]}[] = JSON.parse(result.stdout);
  assert.equal(pages.length,1);assert.match(pages[0].lines.join(' '),/ANA Y JOSÉ.*Iced coffee caramelo.*Leche de avena.*Sin hielo.*Entregar juntos.*1234.*Para Llevar/);
});
