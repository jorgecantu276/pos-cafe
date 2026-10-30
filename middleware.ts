import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isAuthUnavailable } from '@/lib/user-management';
import { loginReturnTarget } from '@/lib/login-return';
import { withDeadline } from '@/lib/request-deadline';

export async function middleware(request: NextRequest) {
  const updates = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const authHeaders = new Headers();
  const complete = (response: NextResponse) => {
    updates.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    authHeaders.forEach((value, key) => response.headers.set(key, value));
    const vary = new Set((response.headers.get('Vary') || '').split(',').map(v => v.trim()).filter(Boolean));
    vary.add('Cookie'); response.headers.set('Vary', [...vary].join(', '));
    return response;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, headers) {
          for (const cookie of values) {
            request.cookies.set(cookie.name, cookie.value);
            updates.set(cookie.name, cookie);
          }
          Object.entries(headers).forEach(([key, value]) => authHeaders.set(key, value));
        },
      },
    }
  );

  // Verificamos si hay un usuario activo
  let result;
  try { result = await withDeadline(() => supabase.auth.getUser(), { signal: request.signal }); }
  catch {
    return complete(NextResponse.json({ error: 'No se pudo comprobar el acceso. Intenta de nuevo.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    }));
  }
  const { data: { user }, error } = result;
  if (isAuthUnavailable(error) && ['/tv', '/api/tv'].includes(request.nextUrl.pathname)) {
    return complete(NextResponse.json({ error: 'No se pudo comprobar el acceso. Se intentará de nuevo.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
    }));
  }

  // RUTAS PROTEGIDAS: Si no hay usuario y trata de entrar a cualquier ruta que NO sea /login
  if (!user && request.nextUrl.pathname.startsWith('/api/')) {
    return complete(NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 }));
  }
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    if (request.nextUrl.pathname === '/tv') url.search = '?returnTo=%2Ftv';
    return complete(NextResponse.redirect(url));
  }

  // RUTAS PÚBLICAS: Si ya inició sesión y trata de entrar al /login, lo mandamos al POS
  if (user && request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = loginReturnTarget(request.nextUrl.searchParams.get('returnTo'));
    url.search = '';
    return complete(NextResponse.redirect(url));
  }

  return complete(NextResponse.next({ request: { headers: request.headers } }));
}

// Configuración de las rutas que el middleware debe vigilar
export const config = {
  matcher: [
    /*
     * Ignorar las rutas internas de Next.js y archivos estáticos
     * para no gastar recursos revisando imágenes o el favicon.
     */
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js$|workbox-[^/]+\\.js$|manifest\\.json$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
