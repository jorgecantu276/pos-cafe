import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceOpening, WorkspaceCustomization, WorkspaceCheckout } from '../app/register/WorkspaceRegister';

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
