import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import RecentTickets from '../app/register/RecentTickets';
import type { RecentTicket } from '../lib/recent-tickets';

async function render(component: ReactNode, work: (screen: Document, click: (label: string) => Promise<void>) => Promise<void>) {
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
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  };
  try { await act(async () => root.render(component)); await work(dom.window.document, click); }
  finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

const ticket: RecentTicket = { id: 'original', ticket_number: '194', total: 83.5, created_at: '2026-10-30T17:00:00Z', status: 'completed', cashier_name: 'Ana <test>' };

test('recent list passes only the selected original folio to historical reprint and exposes cancelled/pending states', async () => {
  const prints: string[] = [];
  await render(createElement(RecentTickets, { onReprint: folio => prints.push(folio), loadTickets: async () => [
    ticket, { ...ticket, id: 'cancelled', ticket_number: '195', status: 'cancelled' },
    { ...ticket, id: 'pending', ticket_number: '196', status: 'pending' },
  ] }), async (screen, click) => {
    assert.match(screen.body.textContent!, /83\.50/); assert.match(screen.body.textContent!, /Ana <test>/);
    assert.equal(screen.querySelector('test'), null); assert.equal(screen.querySelectorAll('time').length, 3);
    assert.match(screen.body.textContent!, /Cancelado/); assert.match(screen.body.textContent!, /Pendiente de revisión/);
    assert.equal(screen.querySelector<HTMLButtonElement>('[aria-label="Reimprimir ticket 196"]')?.disabled, true);
    await click('Reimprimir ticket 195'); await click('Reimprimir ticket 194');
    assert.deepEqual(prints, ['195', '194']);
  });
});

test('failed list reads show retry; retry can return a clearly empty permitted history', async () => {
  let loads = 0;
  await render(createElement(RecentTickets, { onReprint: () => assert.fail('Empty history cannot reprint'), loadTickets: async () => {
    if (++loads === 1) throw new Error('Unavailable'); return [];
  } }), async (screen, click) => {
    assert.ok(screen.querySelector('[role="alert"]')); assert.doesNotMatch(screen.body.textContent!, /No hay tickets/);
    await click('Reintentar tickets'); assert.equal(loads, 2);
    assert.match(screen.body.textContent!, /No hay tickets disponibles para esta cuenta/);
    assert.equal(screen.querySelector('[role="alert"]'), null);
  });
});

test('loading is explicit and closing the panel aborts its read without initiating checkout or printing', async () => {
  let signal: AbortSignal | undefined;
  await render(createElement(RecentTickets, { onReprint: () => assert.fail('Loading cannot reprint'), loadTickets: readSignal => {
    signal = readSignal; return new Promise<RecentTicket[]>(() => {});
  } }), async screen => {
    assert.match(screen.querySelector('[role="status"]')?.textContent ?? '', /Cargando tickets/);
    assert.equal(screen.querySelector('button'), null); assert.equal(signal?.aborted, false);
  });
  assert.equal(signal?.aborted, true);
});

test('the existing transaction gate also disables list reprints', async () => {
  await render(createElement(RecentTickets, { onReprint: () => assert.fail('Blocked reprint'), disabled: true, loadTickets: async () => [ticket] }), async screen => {
    assert.equal(screen.querySelector<HTMLButtonElement>('[aria-label="Reimprimir ticket 194"]')?.disabled, true);
  });
});
