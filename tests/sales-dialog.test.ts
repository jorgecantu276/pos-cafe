import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import * as ts from 'typescript';
import AdminDialog from '../app/admin/AdminDialog';
import * as reports from '../lib/reports';
import * as resource from '../lib/use-resource';
import * as types from '../lib/pos-types';
import * as shift from '../lib/shift';
import * as cancellation from '../lib/cancellation';

test('actual ticket dialog moves/restores focus, handles cancel and keeps a pending cancellation protected', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1' }), saved = new Map<string, PropertyDescriptor | undefined>(), alerts: string[] = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, alert: (value: string) => alerts.push(value) })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.confirm = () => true;
  const order = { id: 'order', ticket_number: 1, created_at: '2026-11-02T15:00:00Z', total: 55, payment_method: 'efectivo', status: 'completed', order_items: [{ quantity: 1, total_price: 55, product_snapshot: { name: 'Café' } }] };
  const report = { captured_at: order.created_at, as_of: order.created_at, day: '2026-11-02', page: 0, page_size: 50,
    summary: { rows: 1, completed: 1, pending: 0, cancelled: 0, sales: 55, average: 55 }, orders: [order], payments: [] };
  let release!: (value: unknown) => void, cancellations = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const client = { rpc: (name: string) => {
    if (name === 'pos_cancel_sale') { cancellations++; return pending; }
    assert.equal(name, 'pos_sales_report'); const result = Promise.resolve({ error: null, data: report }); return Object.assign(result, { abortSignal: () => result });
  } };
  const imports: Record<string, unknown> = { '../inventario/InventoryReturn': {default:()=>null,__esModule:true}, '../AdminDialog': { default: AdminDialog, __esModule: true }, '@/lib/reports': reports,
    'next/link': { default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement('a', { href, ...props }, children), __esModule: true },
    '@/lib/use-resource': resource, '@/lib/pos-types': types, '@/lib/shift': shift, '@/lib/cancellation': cancellation, '@/lib/supabase': { supabase: client },
    '@/lib/printing': { openPrintWindow: () => assert.fail('No printing during dialog verification') }, '@/lib/receipt-reprint': {},
    '../ReportControls': { ReportFilters: () => null, ReportPagination: () => null }, '@/app/LoadFailure': { default: () => null, __esModule: true } };
  const compiled = ts.transpileModule(readFileSync(new URL('../app/admin/ventas/page.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { default?: ComponentType } = {}, require = createRequire(import.meta.url);
  new Function('require', 'exports', compiled)((name: string) => imports[name] ?? require(name), exports);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (name: string) => { const node = [...dom.window.document.querySelectorAll('button')].find(e => e.textContent?.trim() === name); assert.ok(node, name); return node; };
  const click = async (node: HTMLElement) => { await act(async () => { node.focus(); node.click(); }); };
  const cancel = async () => { await act(async () => { dom.window.document.querySelector('dialog')!.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); }); };
  try {
    await act(async () => root.render(createElement(exports.default!)));
    const opener = dom.window.document.querySelector('.workspace-sales-list > button') as HTMLButtonElement;
    await click(opener);
    const dialog = dom.window.document.querySelector('dialog')!;
    assert.equal(dialog.getAttribute('aria-modal'), 'true'); assert.equal(dom.window.document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent, 'Ticket #0001');
    assert.equal(dom.window.document.activeElement?.closest('dialog'), dialog);
    await cancel(); assert.equal(dom.window.document.querySelector('dialog'), null); assert.equal(dom.window.document.activeElement, opener);
    await click(opener); await click(button('Cancelar venta')); assert.equal(cancellations, 1);
    await cancel(); assert.ok(dom.window.document.querySelector('dialog'), 'Escape/cancel cannot abandon a submitted cancellation');
    assert.ok((dom.window.document.querySelector('button[aria-label="Cerrar Ticket #0001"]') as HTMLButtonElement).disabled);
    await act(async () => release({ error: { message: 'Sin conexión de prueba' } }));
    assert.match(alerts[0], /Sin conexión/); assert.equal(button('Cancelar venta').disabled, false);
    await cancel(); assert.equal(dom.window.document.querySelector('dialog'), null); assert.equal(dom.window.document.activeElement, opener);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
