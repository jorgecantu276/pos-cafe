import { requestOriginMatches } from './request-origin';
type ProxyEnvironment = { [key: string]: string | undefined; NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string; POS_PUBLIC_ORIGIN?: string; POS_LAN_MODE?: string };
const mutation = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const browserTables = new Set(['products', 'extras', 'profiles', 'customers', 'cash_registers', 'pos_option_policies']);
// Enumerated from browser entry points and their drawer/shift/inventory/report maps.
// Provider settlement, backup exports and service-only functions never use this proxy.
const browserRpcs = new Set([
  'pos_smoothies_special', 'pos_set_smoothies_special', 'pos_smoothies_opening_plan', 'pos_count_smoothies_opening',
  'pos_smoothies_recipes', 'pos_smoothies_recipe_trials', 'pos_save_smoothies_recipe_trial', 'pos_publish_smoothies_recipe', 'pos_save_smoothies_extra',
  'pos_login_profiles', 'get_register_shortcuts', 'pos_set_register_shortcuts',
  'pos_checkout', 'pos_abandon_checkout', 'pos_open_shift', 'pos_shift_summary', 'pos_shift_expenses', 'pos_close_shift', 'pos_closed_shift',
  'pos_search_customers', 'pos_enroll_customer', 'pos_edit_customer', 'pos_customer_report', 'pos_customer_history',
  'pos_cancel_sale', 'pos_recent_tickets', 'pos_sales_report', 'pos_shift_history',
  'pos_drawer_status', 'pos_drawer_history', 'pos_set_drawer_rate', 'pos_begin_drawer_handoff', 'pos_accept_drawer_handoff', 'pos_reassign_drawer_handoff', 'pos_manager_close_drawer',
  'pos_inventory_register', 'pos_inventory_catalog', 'pos_inventory_history', 'pos_inventory_state', 'pos_inventory_sale_lines', 'pos_inventory_write', 'pos_inventory_return', 'pos_inventory_set_enabled',
  'pos_save_catalog', 'pos_set_staff_active', 'pos_phone_list', 'pos_phone_get', 'pos_phone_save', 'pos_phone_cancel',
]);
const headersOut = ['authorization', 'accept', 'content-type', 'prefer', 'range', 'range-unit', 'if-match', 'if-none-match', 'x-upsert', 'x-client-info', 'x-supabase-api-version'];
const responseHeaders = ['content-type', 'content-range', 'range-unit', 'etag', 'last-modified', 'x-total-count'];
const maximumBody = 20 * 1024 * 1024;
export class BackendProxyError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function reject(status = 403): never { throw new BackendProxyError(status, 'La solicitud al servicio local no está permitida.'); }

export function backendProxyPath(parts: readonly string[], method: string): string {
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[\\/?#\u0000-\u001f]/.test(part))) reject(404);
  const path = parts.join('/');
  const auth = /^auth\/v1\/(token|user|logout)$/.exec(path);
  if (auth && ((auth[1] === 'token' && method === 'POST') || (auth[1] === 'user' && method === 'GET') || (auth[1] === 'logout' && method === 'POST'))) return path;
  if (path === 'auth/v1/.well-known/jwks.json' && method === 'GET') return path;
  if (parts[0] === 'rest' && parts[1] === 'v1') {
    if (parts.length === 3 && browserTables.has(parts[2]) && ['GET', 'HEAD'].includes(method)) return path;
    if (parts.length === 4 && parts[2] === 'rpc' && browserRpcs.has(parts[3]) && method === 'POST') return path;
  }
  if (parts[0] === 'storage' && parts[1] === 'v1' && parts[2] === 'object') {
    if (parts[3] === 'catalog-photos' && parts.length >= 4 && ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(method)) return parts.map(encodeURIComponent).join('/');
    if (['public', 'authenticated', 'sign', 'list'].includes(parts[3]) && parts[4] === 'catalog-photos' && parts.length >= 5
      && (['GET', 'HEAD'].includes(method) || (['sign', 'list'].includes(parts[3]) && method === 'POST'))) return parts.map(encodeURIComponent).join('/');
  }
  reject(404);
}

export function assertBackendProxyOrigin(request: Request, env: ProxyEnvironment): void {
  if (!requestOriginMatches(request, { env, loopbackOnly: true, requireOrigin: mutation.has(request.method) })) reject();
}

async function boundedBody(request: Request): Promise<Uint8Array | undefined> {
  if (!mutation.has(request.method) || !request.body) return undefined;
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maximumBody) reject(413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > maximumBody) { await reader.cancel(); reject(413); } chunks.push(next.value); }
  const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** Fixed configured upstream only. No Auth admin, bucket admin, functions, arbitrary URLs or server credentials. */
export async function proxyBackendRequest(request: Request, parts: readonly string[], env: ProxyEnvironment, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  try {
    assertBackendProxyOrigin(request, env);
    const path = backendProxyPath(parts, request.method);
    const api = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '');
    if (api.username || api.password || api.search || api.hash || (api.protocol !== 'https:' && !(api.protocol === 'http:' && api.hostname === '127.0.0.1'))) reject(503);
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anon || anon === env.SUPABASE_SERVICE_ROLE_KEY) reject(503);
    const publicImage = /^storage\/v1\/object\/(?:public|sign)\/catalog-photos\//.test(path) && ['GET', 'HEAD'].includes(request.method);
    if (request.headers.get('apikey') !== anon && !publicImage) reject();
    const authorization = request.headers.get('authorization') || `Bearer ${anon}`;
    if (env.SUPABASE_SERVICE_ROLE_KEY && authorization === `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`) reject();
    if (['accept-profile', 'content-profile'].some(name => request.headers.has(name) && request.headers.get(name) !== 'public')) reject();
    const url = new URL(api.href.replace(/\/$/, '') + '/' + path);
    url.search = new URL(request.url).search;
    if (path === 'auth/v1/token' && !['password', 'refresh_token'].includes(url.searchParams.get('grant_type') || '')) reject();
    const headers = new Headers({ apikey: anon, authorization });
    for (const name of headersOut) if (request.headers.has(name)) headers.set(name, request.headers.get(name)!);
    const body = await boundedBody(request);
    const upstream = await upstreamFetch(url, { method: request.method, headers, body: body as BodyInit | undefined, redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
    if (upstream.status >= 300 && upstream.status < 400) reject(502);
    const outgoing = new Headers({ 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie, Authorization' });
    for (const name of responseHeaders) if (upstream.headers.has(name)) outgoing.set(name, upstream.headers.get(name)!);
    return new Response(upstream.body, { status: upstream.status, headers: outgoing });
  } catch (error) {
    const status = error instanceof BackendProxyError ? error.status : 503;
    return Response.json({ error: error instanceof BackendProxyError ? error.message : 'El servicio del negocio no respondió. Conserva cualquier operación pendiente.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
