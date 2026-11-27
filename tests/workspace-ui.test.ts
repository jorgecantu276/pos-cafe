import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState, type ReactNode, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceRegister,{ WorkspaceOpening, WorkspaceCustomization, WorkspaceCheckout } from '../app/register/WorkspaceRegister';
import { PrototypeCheckout } from '../app/register/PrototypeRegister';
import { favoriteMenuCards, matchesMenuCard, menuCards } from '../lib/menu-cards';

async function render(work: (screen: Document, click: (label: string) => Promise<void>) => Promise<void>, component: ReactNode) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const click = async (label: string) => {
    const button = [...dom.window.document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === label);
    assert.ok(button, `Missing ${label}`); assert.equal(button.disabled, false);
    await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  };
  try { await act(async () => root.render(component)); await work(dom.window.document, click); }
  finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

test('catalog scrolling remains keyboard-accessible while an uncertain payment disables every product',async()=>{
  const product={id:'coffee',name:'Café',price:50,category:'Bebidas',is_active:true};
  const props:ComponentProps<typeof WorkspaceRegister>={products:[product],items:[],total:0,search:'',onSearch:()=>{},userName:'Ana',isAdmin:false,disabled:true,onProduct:()=>assert.fail('Uncertain payment must keep the product gate'),onEdit:()=>{},onQuantity:()=>{},onRemove:()=>{},onClear:()=>{},onCheckout:()=>{},onCloseShift:()=>{},customer:null,customerSearch:'',onCustomerSearch:()=>{},suggestions:[],onCustomer:()=>{},onNewCustomer:()=>{},onRemoveCustomer:()=>{},orderType:'En Local',onOrderType:()=>{},orderNote:'',onOrderNote:()=>{},onReprint:()=>{},notices:createElement('p',{role:'alert'},'Venta sin confirmar. No vuelvas a cobrar.')};
  await render(async screen=>{
    const region=screen.querySelector<HTMLElement>('.workspace-catalog-scroll')!;
    assert.equal(region.getAttribute('role'),'region');assert.equal(region.getAttribute('aria-label'),'Productos del menú');assert.equal(region.tabIndex,0);
    assert.ok([...region.querySelectorAll('button')].every(button=>button.disabled));region.focus();assert.equal(screen.activeElement,region);
    assert.match(screen.body.textContent!,/No vuelvas a cobrar/);
  },createElement(WorkspaceRegister,props));
});

test('drink families match searches and favorites without losing the selected product or price', async () => {
  const product = (id: string, name: string, price: number, is_active = true) => ({ id, name, price, category: 'Bebidas', is_active });
  const cards = menuCards([
    product('c', 'Matcha cariño', 105), product('x', 'Matcha ceremonial', 140), product('f', 'Matcha fresa', 115, false),
    product('i', 'Iced coffee', 95), product('flan', 'Iced coffe flan', 130), product('n', 'Iced coffee nevado', 140),
    product('o', 'Frappe Oreo', 85), product('t', 'Frappe original', 80),
    product('h', 'Te chai caliente', 95), product('j', 'Te chai frio', 95),
  ]);
  assert.deepEqual(cards.map(card => card.name), ['Chai Latte · 16 oz', 'Frappuccino · 16 oz', 'Iced Coffee', 'Matcha', 'Nevado · 20 oz']);
  const matcha = cards.find(card => card.name === 'Matcha')!;
  assert.equal(matcha.price, 105);
  assert.equal(matchesMenuCard(matcha, 'carino'), true);
  assert.equal(matchesMenuCard(matcha, 'fresa'), false);
  assert.equal(matchesMenuCard(cards.find(card => card.name === 'Iced Coffee')!, 'flan'), true);
  assert.deepEqual(favoriteMenuCards(cards, ['c', 'x', 'f']), [matcha]);
  let selected = '';
  await render(async (_screen, click) => {
    await click('Ceremonial$140.00');
    assert.equal(selected, 'x');
  }, createElement(WorkspaceCustomization, { product: null, family: matcha, onVariant: id => { selected = id ?? ''; },
    steps: [], index: 0, extras: [], dbExtras: [], note: '', onNote: () => {}, onStep: () => {}, onOption: () => {},
    onConfirm: () => assert.fail('No se puede agregar una familia sin elegir variante'), onClose: () => {} }));
});

test('size picker keeps actual sized product identities, notes and quantity while switching the same flavor', async () => {
  const products = [
    { id:'iced16',name:'Iced coffee caramelo 16 oz',price:95,category:'Bebidas',is_active:true },
    { id:'iced20',name:'Iced coffee caramelo 20 oz',price:125,category:'Bebidas',is_active:true },
    { id:'vanilla20',name:'Iced coffee vainilla 20 oz',price:125,category:'Bebidas',is_active:true },
  ];
  const family=menuCards(products)[0];
  assert.deepEqual(family.variants?.map(variant=>variant.label),['Caramelo','Caramelo','Vainilla']);
  let selected='iced16', confirmed='';
  function Editor(){
    const [id,setId]=useState<string|null>('iced16');
    return createElement(WorkspaceCustomization,{family,product:products.find(product=>product.id===id)??null,
      onVariant:value=>{selected=value??'';setId(value);},steps:[],index:0,extras:[],dbExtras:[],quantity:2,
      note:'Sin hielo',onNote:()=>{},onStep:()=>{},onOption:()=>{},onConfirm:()=>{confirmed=id??'';},onClose:()=>{}});
  }
  await render(async(screen,click)=>{
    const picker=screen.querySelector('[role=group][aria-label="Tamaño"]')!;
    assert.ok(picker.closest('header'),'Size belongs beside the drink heading');
    await click('20 oz');assert.equal(selected,'iced20');
    assert.match(screen.querySelector('.workspace-custom-price')!.textContent!,/250\.00/);
    assert.match(screen.querySelector('.workspace-note-toggle')!.textContent!,/Sin hielo/);
    await click('16 oz');assert.equal(selected,'iced16');
    assert.match(screen.querySelector('.workspace-custom-price')!.textContent!,/190\.00/);
    await click('Guardar cambios');assert.equal(confirmed,'iced16');
  },createElement(Editor));
});

test('switching size never substitutes a different preparation and requires an available choice',async()=>{
  const products=[
    {id:'fruit16',name:'Matcha fresa 16 oz',price:115,category:'Bebidas',is_active:true},
    {id:'foam20',name:'Matcha latte cold foam fresa 20 oz',price:140,category:'Bebidas',is_active:true},
  ];
  const family=menuCards(products)[0];let selected:string|null='fruit16';
  function Editor(){const [id,setId]=useState<string|null>('fruit16');return createElement(WorkspaceCustomization,{
    family,product:products.find(product=>product.id===id)??null,onVariant:value=>{selected=value;setId(value);},
    steps:[],index:0,extras:[],dbExtras:[],note:'Sin azúcar',onNote:()=>{},onStep:()=>{},onOption:()=>{},onConfirm:()=>{},onClose:()=>{}});}
  await render(async(screen,click)=>{
    await click('20 oz');assert.equal(selected,null);
    const add=[...screen.querySelectorAll('button')].find(button=>button.textContent==='Agregar a la orden')!;
    assert.equal(add.disabled,true);
    assert.equal(screen.querySelectorAll('.workspace-modifier-group button').length,1);
    await click('Cold foam de fresa$140.00');assert.equal(selected,'foam20');assert.equal(add.disabled,false);
    assert.match(screen.querySelector('.workspace-note-toggle')!.textContent!,/Sin azúcar/);
  },createElement(Editor));
});

test('unsized catalog entries do not receive an invented size or hide their preparations',async()=>{
  const family=menuCards([
    {id:'a',name:'Iced coffee caramelo',price:95,category:'Bebidas',is_active:true},
    {id:'b',name:'Iced coffee vainilla',price:95,category:'Bebidas',is_active:true},
  ])[0];
  await render(async(screen)=>{
    assert.equal(screen.querySelector('[aria-label="Tamaño"]'),null);
    assert.equal(screen.querySelectorAll('.workspace-modifier-group button').length,2);
  },createElement(WorkspaceCustomization,{family,product:null,steps:[],index:0,extras:[],dbExtras:[],note:'',
    onNote:()=>{},onStep:()=>{},onOption:()=>{},onConfirm:()=>{},onClose:()=>{}}));
});

for(const isAdmin of [false,true]) test(`workspace ${isAdmin?'admin':'cashier'} opening preserves role navigation, fractional dollars and denomination counts`, async () => {
  let dollars = 0, opened = false;
  function Opening() {
    const [counts, onCounts] = useState<Record<number, number>>({ 100: 0 });
    const [usd, onUSD] = useState<number | ''>('');
    return createElement(WorkspaceOpening, { userName: 'Prueba', isAdmin, denominations: [100], counts, onCounts, rate: '20', onRate: () => {}, dollars: usd,
      onDollars: value => { dollars = Number(value); onUSD(value); }, total: counts[100] * 100 + Number(usd) * 20, busy: false, disabled: false,
      onOpen: () => { opened = true; }, onLogout: () => {} });
  }
  await render(async (screen, click) => {
    const gateway=screen.querySelector<HTMLAnchorElement>('dialog .workspace-admin-gateway');
    if(isAdmin) { assert.equal(gateway?.textContent,'Administración'); assert.equal(gateway?.getAttribute('href'),'/admin'); }
    else assert.equal(gateway,null);
    await click('Agregar una pieza de 100 pesos');
    assert.equal((screen.querySelector('[aria-label="Piezas de 100 pesos"]') as HTMLInputElement).value, '1');
    await click('Teclado para dólares iniciales'); await click('1'); await click('.'); await click('5');
    assert.equal(dollars, 1.5);
    assert.equal((screen.querySelector('[aria-label="Dólares iniciales"]') as HTMLInputElement).value, '1.5');
    assert.match(screen.body.textContent!, /\$130\.00/);
    await click('Listo'); await click('Abrir caja'); assert.equal(opened, true);
  }, createElement(Opening));
});

test('workspace options pass their own phase when groups are selected out of sequence, without a wizard', async () => {
  const selected: [string, number][] = [];
  await render(async (screen, click) => {
    await click('Grande+$10.00'); await click('Almendra+$15.00');
    assert.deepEqual(selected, [['Grande', 1], ['Almendra', 0]]);
    assert.equal([...screen.querySelectorAll('button')].some(button => button.textContent === 'Siguiente'), false);
    assert.equal(screen.querySelectorAll('fieldset.workspace-modifier-group').length, 2);
  }, createElement(WorkspaceCustomization, { product: { id: 'c', name: 'Cappuccino', price: 80, category: 'Bebidas' },
    steps: [{ id: 'Leche alternativa', title: 'Leche', options: ['Almendra'], exclusive: true }, { id: 'Tamaño', title: 'Tamaño', options: ['Grande'], exclusive: true }],
    index: 0, extras: [], dbExtras: [{ id: 'almond', name: 'Almendra', phase: 'Leche alternativa', active: true, price: 15 }, { id: 'large', name: 'Grande', phase: 'Tamaño', active: true, price: 10 }],
    note: '', onNote: () => {}, onStep: () => {}, onOption: (name, index) => selected.push([name, index]), onConfirm: () => {}, onClose: () => {} }));
});

test('workspace cash keypad, exact payment and terminal confirmation preserve checkout gates', async () => {
  let confirms = 0;
  function Checkout() {
    const [method, onMethod] = useState('Efectivo'), [mxn, onMXN] = useState(''), [usd, onUSD] = useState('');
    return createElement(WorkspaceCheckout, { total: 165, method, mxn, usd, exchangeRate: 20, orderType: 'Para Llevar', note: '', busy: false, pagerNumber:12,
      insufficient: ['Efectivo', 'Mixto'].includes(method) && Number(mxn) + Number(usd) * 20 < 165,
      onMethod: value => { onMethod(value); onMXN(''); onUSD(''); }, onMXN, onUSD, onOrderType: () => {}, onNote: () => {}, onConfirm: () => { confirms++; }, onClose: () => {} });
  }
  await render(async (screen, click) => {
    const confirm = () => [...screen.querySelectorAll('button')].find(button => button.textContent === 'Confirmar pago')!;
    assert.equal(confirm().disabled, true);
    await click('1'); await click('0'); await click('0');
    assert.equal((screen.querySelector('[aria-label="Recibido MXN"]') as HTMLInputElement).value, '100');
    assert.match(screen.body.textContent!, /Faltan MXN\$65\.00/); assert.equal(confirm().disabled, true);
    await click('Importe exacto'); assert.equal(confirm().disabled, false); await click('Confirmar pago'); assert.equal(confirms, 1);
    await click('Tarjeta'); assert.equal(confirm().disabled, true);
    const checkbox = screen.querySelector('input[type="checkbox"]')!;
    await act(async () => { checkbox.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(confirm().disabled, false); await click('Confirmar pago'); assert.equal(confirms, 2);
    await click('MXN + USD'); assert.equal(confirm().disabled, true);
  }, createElement(Checkout));
});

test('Cafe checkout shows the USD total at the active shift rate for every payment method and phone pickup',async()=>{
  for(const method of ['Efectivo','Mixto','Tarjeta'])for(const [total,exchangeRate,expected] of [[55,16,'$4'],[130,16,'$9'],[130,20,'$7'],[260,18,'$15']] as const){
    await render(async screen=>{
      const summary=screen.querySelector('.workspace-checkout-summary')!;
      assert.match(summary.textContent!,new RegExp(`Total MXN\\$${total}\\.00`));
      const usd=summary.querySelector('.workspace-checkout-usd')!;
      assert.equal(usd.querySelector('b')?.textContent,expected);
      assert.match(usd.textContent!,/Total USD/);
      assert.doesNotMatch(screen.body.textContent!,/Cambio con|1 USD =|Tipo de cambio|Dólares enteros/);
      assert.doesNotMatch(summary.textContent!,/Cambio/);
    },createElement(WorkspaceCheckout,{total,exchangeRate,method,mxn:'',usd:'',orderType:'Para Llevar',note:'',busy:false,insufficient:false,
      phoneOrderLabel:'T0042',onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{}}));
  }
  await render(async screen=>{
    assert.equal(screen.querySelector('.workspace-checkout-usd'),null);
  },createElement(WorkspaceCheckout,{total:130,exchangeRate:16,method:'Efectivo',mxn:'',usd:'',orderType:'En Local',note:'',busy:false,insufficient:false,
    smoothies:true,onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{}}));
});

test('Cafe shows only actual change for peso, whole-dollar and mixed tender',async()=>{
  for(const [mxn,usd,result] of [['','','Faltan MXN$55.00'],['20','','Faltan MXN$35.00'],['55','','Cambio$0.00'],['100','','Cambio$45.00'],['','4','Cambio$9.00'],['','5','Cambio$25.00'],['7','3','Cambio$0.00'],['10','3','Cambio$3.00']] as const){
    await render(async screen=>{
      assert.equal(screen.querySelector('.workspace-change')?.textContent,result);
      assert.doesNotMatch(screen.querySelector('.workspace-checkout-summary')!.textContent!,/Cambio|1 USD/);
      assert.equal(screen.querySelectorAll('.workspace-change').length,1);
    },createElement(WorkspaceCheckout,{total:55,exchangeRate:16,method:'Mixto',mxn,usd,orderType:'En Local',note:'',busy:false,insufficient:false,
      pagerNumber:1,onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{}}));
  }
  await render(async screen=>{
    assert.equal(screen.querySelector('.workspace-change'),null);
  },createElement(WorkspaceCheckout,{total:55,exchangeRate:16,method:'Tarjeta',mxn:'',usd:'',orderType:'En Local',note:'',busy:false,insufficient:false,
    pagerNumber:1,onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{}}));
});

test('prototype Cafe checkout keeps totals together and shows only actual peso change',async()=>{
  for(const usd of ['','4'])await render(async screen=>{
    const summary=screen.querySelector('.prototype-checkout-totals')!;
    assert.match(summary.textContent!,/Total MXN\$55.00Total USD\$4/);
    assert.doesNotMatch(screen.body.textContent!,/Cambio con|Tipo de cambio|Cambio MXN/);
    if(usd)assert.match(screen.body.textContent!,/Cambio: \$9.00/);
    else assert.doesNotMatch(screen.body.textContent!,/Cambio:/);
  },createElement(PrototypeCheckout,{total:55,exchangeRate:16,method:'Mixto',mxn:'',usd,orderType:'En Local',note:'',busy:false,insufficient:!usd,
    pagerNumber:1,onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{}}));
});

test('receiving whole USD uses the real tender and gives peso change without increasing the sale total',async()=>{
  let paid:unknown;
  function Checkout(){
    const [mxn,onMXN]=useState(''),[usd,onUSD]=useState('');
    return createElement(WorkspaceCheckout,{total:130,exchangeRate:16,method:'Mixto',mxn,usd,orderType:'En Local',note:'',busy:false,
      insufficient:Number(mxn)+Number(usd)*16<130,pagerNumber:1,onMethod:()=>{},onMXN,onUSD,onOrderType:()=>{},onNote:()=>{},onClose:()=>{},
      onConfirm:()=>{paid={mxn,usd};}});
  }
  await render(async(screen,click)=>{
    await click('Recibir $9 USD');
    assert.equal((screen.querySelector('[aria-label="Recibido USD"]') as HTMLInputElement).value,'9');
    assert.equal(screen.querySelector('.workspace-change')?.textContent,'Cambio$14.00');
    assert.equal([...screen.querySelectorAll('button')].find(button=>button.textContent==='.')?.disabled,true);
    assert.equal(screen.querySelector('.workspace-checkout-summary strong')?.textContent,'$130.00');
    await click('Confirmar pago');assert.deepEqual(paid,{mxn:'',usd:'9'});
  },createElement(Checkout));
  await render(async screen=>{
    assert.equal([...screen.querySelectorAll('button')].find(button=>button.textContent==='Confirmar pago')?.disabled,true);
  },createElement(WorkspaceCheckout,{total:130,exchangeRate:16,method:'Mixto',mxn:'',usd:'9.25',orderType:'En Local',note:'',busy:false,insufficient:false,
    pagerNumber:1,onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>assert.fail('No USD coins')}));
});


test('Mixto tab splits card and peso cash, keeps approval tied to card amount and leaves MXN+USD separate',async()=>{
  let saved:unknown;
  function Checkout(){
    const [method,setMethod]=useState('Efectivo'),[card,onCard]=useState(''),[mxn,onMXN]=useState(''),[usd,onUSD]=useState('');
    return createElement(WorkspaceCheckout,{total:130,exchangeRate:16,method,card,mxn,usd,onCard,onMXN,onUSD,
      orderType:'En Local',note:'',busy:false,insufficient:false,pagerNumber:1,
      onMethod:value=>{setMethod(value);onCard('');onMXN('');onUSD('');},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},
      onConfirm:()=>{saved={method,card,mxn,usd};}});
  }
  await render(async(screen,click)=>{
    const confirm=()=>[...screen.querySelectorAll('button')].find(button=>button.textContent==='Confirmar pago')!;
    assert.deepEqual([...screen.querySelectorAll('.workspace-payment-methods button')].map(b=>b.textContent),['Efectivo','MXN + USD','Tarjeta','Mixto']);
    await click('Mixto');assert.equal(confirm().disabled,true);
    await click('8');await click('0');
    assert.equal(screen.querySelector<HTMLInputElement>('[aria-label="Tarjeta MXN"]')!.value,'80');
    assert.match(screen.body.textContent!,/Efectivo por pagar: \$50.00/);
    assert.equal(screen.querySelector('[aria-label="Recibido USD"]'),null);
    await click('Efectivo exacto');assert.equal(confirm().disabled,true);
    const approve=async()=>{await act(async()=>screen.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());};
    await approve();assert.equal(confirm().disabled,false);
    const cardInput=screen.querySelector<HTMLInputElement>('[aria-label="Tarjeta MXN"]')!;
    Object.assign(cardInput,{attachEvent:()=>{},detachEvent:()=>{}});
    await act(async()=>cardInput.focus());
    await click('Borrar último dígito');assert.equal(confirm().disabled,true);
    await click('0');await approve();await click('Confirmar pago');
    assert.deepEqual(saved,{method:'efectivo_tarjeta',card:'80',mxn:'50',usd:''});
    await click('MXN + USD');assert.ok(screen.querySelector('[aria-label="Recibido USD"]'));
    assert.equal(screen.querySelector('[aria-label="Tarjeta MXN"]'),null);
    await click('Mixto');assert.equal(confirm().disabled,true);
    assert.equal(screen.querySelector<HTMLInputElement>('[aria-label="Tarjeta MXN"]')!.value,'');
  },createElement(Checkout));
});

for(const component of [WorkspaceCheckout,PrototypeCheckout])test(component.name+' refuses invalid splits and shows only the partial CLIP charge',async()=>{
  for(const card of ['', '0','130','150','-1','NaN','8.001'])await render(async screen=>{
    const button=[...screen.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Cobrar '))!;
    assert.equal(button.disabled,true,card);
  },createElement(component,{total:130,exchangeRate:16,method:'efectivo_tarjeta',card,mxn:'130',usd:'',onCard:()=>{},
    clipEnabled:true,orderType:'En Local',note:'',busy:false,insufficient:false,pagerNumber:1,
    onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>assert.fail()}));
  await render(async(screen,click)=>{
    assert.match(screen.body.textContent!,/Cobrar \$80.00 en CLIP/);
    await click('Cobrar $80.00 en CLIP');
  },createElement(component,{total:130,exchangeRate:16,method:'efectivo_tarjeta',card:'80',mxn:'100',usd:'',onCard:()=>{},
    clipEnabled:true,orderType:'En Local',note:'',busy:false,insufficient:false,phoneOrderLabel:'T0042',
    onMethod:()=>{},onMXN:()=>{},onUSD:()=>{},onOrderType:()=>{},onNote:()=>{},onClose:()=>{},onConfirm:()=>{}}));
});
