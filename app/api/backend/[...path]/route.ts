import { proxyBackendRequest } from '@/lib/backend-proxy';
import { supabasePublicKey } from '@/lib/supabase-public-config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyBackendRequest(request, path, { ...process.env, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabasePublicKey() });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
