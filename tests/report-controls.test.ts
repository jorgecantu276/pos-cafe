import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportFilters } from '../app/admin/ReportControls';
import { reportQuery, type ReportQuery } from '../lib/reports';

test('actual report form applies native date values, retains inputs and resets pagination; inverted dates cannot submit', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const changes: ReportQuery[] = [];
  try {
    await act(async () => root.render(createElement(ReportFilters, { query: { ...reportQuery('range'), page: 4, asOf: '2025-02-01T12:00:00Z' }, onChange: value => changes.push(value) })));
    const from = dom.window.document.querySelector<HTMLInputElement>('[name="from"]')!;
    const to = dom.window.document.querySelector<HTMLInputElement>('[name="to"]')!;
    const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    for (const input of [from, to]) await act(async () => { set.call(input, '2025-02-12'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    assert.equal(from.value, '2025-02-12'); assert.equal(to.min, '2025-02-12');
    const submit = () => act(async () => { dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await submit();
    assert.deepEqual(changes, [{ ...reportQuery('range'), from: '2025-02-12', to: '2025-02-12' }]);
    await act(async () => { set.call(to, '2025-02-11'); to.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await submit(); assert.equal(changes.length, 1);
    const buttons = [...dom.window.document.querySelectorAll('button')];
    const today = buttons.find(button => button.textContent === 'Hoy')!;
    const dates = buttons.find(button => button.textContent === 'Fechas')!;
    assert.equal(dates.getAttribute('aria-expanded'), 'true');
    await act(async () => today.click());
    assert.deepEqual(changes[1], reportQuery('today'));
    assert.equal(dates.getAttribute('aria-expanded'), 'false');
    assert.equal(dom.window.document.querySelector('[name="from"]'), null);
    await act(async () => dates.click());
    assert.equal(dates.getAttribute('aria-expanded'), 'true');
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('[name="from"]')?.value, '2025-02-12');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
