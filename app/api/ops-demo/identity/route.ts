import { localDemoAccess, demoBuildIdentity } from '@/lib/operations-demo.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const access = await localDemoAccess(request, { token: true });
    if (access.phase !== 'ready' || access.appPid !== process.pid) throw Error();
    return Response.json({ ...access.identity, appPid: process.pid, buildIdentity: await demoBuildIdentity(process.cwd()),
      edition: 'demo', printMode: 'mock', clipEnabled: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'No se pudo verificar esta demostración.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } }); }
}
