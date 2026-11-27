/** One cookie namespace whether the browser reaches the API directly or via its shop origin. */
export function supabaseStorageKey(api: string): string {
  const url = new URL(api);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    const host = url.hostname.replace(/[^a-z0-9-]/gi, '-');
    return `sb-${host}-${url.port || (url.protocol === 'https:' ? '443' : '80')}-auth-token`;
  }
  return `sb-${url.hostname.split('.')[0]}-auth-token`;
}

/** Cookies are host-scoped, not port-scoped: local databases require distinct names. */
export function supabaseCookieOptions(api: string, visibleOrigin?: string) {
  return { name: supabaseStorageKey(api), path: '/', sameSite: 'lax' as const, secure: new URL(visibleOrigin || api).protocol === 'https:' };
}

export function browserSupabaseUrl(api: string, origin?: string): string {
  return origin ? `${new URL(origin).origin}/api/backend` : api;
}

/** Persist the backend identity so backup/restore remains independent of the shop IP. */
export function canonicalCatalogPhoto(object: string, api: string): string {
  return `${api.replace(/\/$/, '')}/storage/v1/object/public/catalog-photos/${object.split('/').map(encodeURIComponent).join('/')}`;
}

export function proxiedCatalogPhoto(value: string, api: string): string {
  try {
    const url = new URL(value), backend = new URL(api);
    const base = backend.pathname.replace(/\/$/, '');
    if (url.origin === backend.origin && url.pathname.startsWith(`${base}/storage/v1/object/public/catalog-photos/`)) return `/api/backend${url.pathname.slice(base.length)}${url.search}`;
  } catch { /* Relative and third-party illustrations retain their original URL. */ }
  return value;
}
