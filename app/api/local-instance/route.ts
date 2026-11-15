import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The launcher uses this local identity to reuse its own running process.
export async function GET(request: NextRequest) {
  const { POS_LAUNCH_INSTANCE_TOKEN: instanceToken, POS_LAUNCH_RELEASE_ID: releaseId, POS_LAUNCH_CONFIG_ID: configId } = process.env;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(request.nextUrl.hostname) || !instanceToken || !releaseId || !configId) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ protocol: 1, instanceToken, processId: process.pid, releaseId, configId,
    packageId: process.env.POS_LAUNCH_PACKAGE_ID || undefined }, { headers: { 'Cache-Control': 'no-store' } });
}
