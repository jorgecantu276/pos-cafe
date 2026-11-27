export const dynamic = 'force-dynamic';

/** Public update signal. Launcher identity and configuration remain PC-only. */
export function GET() {
  const packageId = process.env.POS_LAUNCH_PACKAGE_ID;
  if (!packageId || !/^[a-f0-9]{16}$/.test(packageId)) return new Response(null, { status: 404 });
  return Response.json({ protocol: 1, packageId }, { headers: { 'Cache-Control': 'no-store' } });
}
