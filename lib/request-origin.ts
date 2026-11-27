type OriginOptions = { env?: Record<string, string | undefined>; requireOrigin?: boolean; loopbackOnly?: boolean };
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Visible origin comes from private configuration, never forwarded headers. */
export function requestOriginMatches(request: Request, { env = process.env, requireOrigin = false, loopbackOnly = false }: OriginOptions = {}): boolean {
  try {
    const address = new URL(request.url), host = request.headers.get('host') || address.host;
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
    if (env.POS_LAN_MODE === '1') {
      const canonical = new URL(env.POS_PUBLIC_ORIGIN || '');
      const ip = canonical.hostname.split('.').map(Number);
      const privateIp = ip.length === 4 && ip.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
        && (ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168));
      if (!privateIp || canonical.protocol !== 'https:' || canonical.username || canonical.password || canonical.pathname !== '/' || canonical.search || canonical.hash
        || host !== canonical.host || (!loopback.has(address.hostname) && address.hostname !== canonical.hostname)) return false;
      return origin ? origin === canonical.origin : !requireOrigin && !mutations.has(request.method);
    }
    const authority = new URL(`${address.protocol}//${host}`);
    if (loopbackOnly && (!loopback.has(address.hostname) || !loopback.has(authority.hostname))) return false;
    return origin ? origin === authority.origin : !requireOrigin;
  } catch { return false; }
}
