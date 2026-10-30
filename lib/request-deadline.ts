export class RequestTimeout extends Error {
  constructor() { super('La conexión tardó demasiado. Revisa internet e intenta recuperar la misma operación.'); }
}

// A deadline bounds our wait even if an SDK never settles. It does not prove
// that a remote write was rolled back; callers must retain recovery identity.
export async function withDeadline<T>(operation: () => PromiseLike<T>, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  if (options.signal?.aborted) throw options.signal.reason;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestTimeout()), options.timeoutMs ?? 12_000);
    onAbort = () => reject(options.signal?.reason ?? new Error('Operación interrumpida.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(operation()), deadline]);
  } finally {
    clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}
