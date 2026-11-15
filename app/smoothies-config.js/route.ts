import { posProfile } from '@/lib/pos-profile';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/javascript; charset=utf-8' };
  const key = process.env.SMOOTHIES_RUNTIME_ANON_KEY;
  if (posProfile.id !== 'smoothies' || process.env.NEXT_PUBLIC_SMOOTHIES_PORTABLE !== '1' || !key) {
    return new Response(null, { status: 404, headers });
  }
  return new Response(`window.smoothiesPublicKey=${JSON.stringify(key)};`, { headers });
}
