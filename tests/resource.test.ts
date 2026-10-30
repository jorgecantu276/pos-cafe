import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useResource } from '../lib/use-resource';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('real React resource handles slow reads, filter changes, stale responses, errors, refresh and unmount', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  let state!: ReturnType<typeof useResource<string[]>>;
  let applied = 0;
  const onLoaded = () => { applied++; };
  const requests: { signal: AbortSignal; result: ReturnType<typeof deferred<string[]>> }[] = [];
  const load = (signal: AbortSignal) => {
    const result = deferred<string[]>(); requests.push({ signal, result }); return result.promise;
  };
  function Probe({ loader }: { loader: typeof load }) {
    state = useResource(loader, [], onLoaded);
    return createElement('output', {}, state.loading ? 'loading' : state.error || state.data.join(','));
  }
  try {
    await act(async () => root.render(createElement(Probe, { loader: load })));
    assert.equal(state.loading, true); assert.equal(requests.length, 1);
    await act(async () => requests[0].result.resolve(['old']));
    assert.deepEqual(state.data, ['old']); assert.equal(state.loading, false);
    const nextLoad: typeof load = signal => load(signal);
    await act(async () => root.render(createElement(Probe, { loader: nextLoad })));
    assert.equal(state.loading, true); assert.equal(requests[0].signal.aborted, true);
    let refresh!: Promise<void>;
    await act(async () => { refresh = state.reload(); });
    assert.equal(requests[1].signal.aborted, true);
    await act(async () => requests[1].result.resolve(['stale filter']));
    assert.deepEqual(state.data, ['old']); assert.equal(state.loading, true);
    await act(async () => { requests[2].result.resolve(['fresh']); await refresh; });
    assert.deepEqual(state.data, ['fresh']); assert.equal(applied, 2);
    await act(async () => { refresh = state.reload(); });
    await act(async () => { requests[3].result.reject(new Error('Connection lost')); await refresh; });
    assert.equal(state.error, 'Connection lost'); assert.equal(state.loading, false);
    assert.deepEqual(state.data, ['fresh']);
    await act(async () => { refresh = state.reload(); });
    await act(async () => root.unmount());
    assert.equal(requests[4].signal.aborted, true);
    await act(async () => { requests[4].result.resolve(['after unmount']); await refresh; });
    assert.equal(applied, 2);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
