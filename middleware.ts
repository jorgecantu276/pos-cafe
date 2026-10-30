import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isAuthUnavailable } from '@/lib/user-management';
import { loginReturnTarget } from '@/lib/login-return';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // Verificamos si hay un usuario activo
  const { data: { user }, error } = await supabase.auth.getUser();
  if (isAuthUnavailable(error) && ['/tv', '/api/tv'].includes(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'No se pudo comprobar el acceso. Se intentará de nuevo.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
    });
  }

  // RUTAS PROTEGIDAS: Si no hay usuario y trata de entrar a cualquier ruta que NO sea /login
  if (!user && request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401 });
  }
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    if (request.nextUrl.pathname === '/tv') url.search = '?returnTo=%2Ftv';
    return NextResponse.redirect(url);
  }

  // RUTAS PÚBLICAS: Si ya inició sesión y trata de entrar al /login, lo mandamos al POS
  if (user && request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = loginReturnTarget(request.nextUrl.searchParams.get('returnTo'));
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
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
