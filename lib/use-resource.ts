'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './pos-types';

// Loads are read-only. Mount/filter changes publish only after I/O, while an
// explicit refresh enters loading immediately in the user's event handler.
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, initial: T, onLoaded?: (value: T) => void) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState<{ load: typeof load } | null>(null);
  const current = useRef<AbortController | null>(null);
  const accept = useCallback((request: AbortController, value: T) => {
    if (request.signal.aborted) return;
    onLoaded?.(value);
    setData(value);
    setError(null);
    setLoading(false);
    setSettled({ load });
  }, [load, onLoaded]);
  const reject = useCallback((request: AbortController, failure: unknown) => {
    if (request.signal.aborted) return;
    setError(errorMessage(failure));
    setLoading(false);
    setSettled({ load });
  }, [load]);

  useEffect(() => {
    const request = new AbortController();
    current.current?.abort();
    current.current = request;
    void load(request.signal).then(value => accept(request, value)).catch(failure => reject(request, failure));
    return () => { current.current?.abort(); };
  }, [load, accept, reject]);

  const reload = useCallback(async () => {
    current.current?.abort();
    const request = new AbortController();
    current.current = request;
    setLoading(true);
    setError(null);
    try { accept(request, await load(request.signal)); }
    catch (failure) { reject(request, failure); }
  }, [load, accept, reject]);
  return { data, setData, loading: loading || settled?.load !== load, error, reload };
}
