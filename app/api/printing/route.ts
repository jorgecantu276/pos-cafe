import path from 'node:path';
import { serverSupabase } from '@/lib/supabase-server';
import { PrintJournal } from '@/lib/print-journal-server';
import { printConfig, printerAdapter } from '@/lib/windows-print-server';
import { handlePrintRequest, requireLocalPrintRequest } from '@/lib/print-dispatch-server';
import { AccessError } from '@/lib/user-management';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
async function handle(request: Request) {
  let journal: PrintJournal | undefined;
  try {
    requireLocalPrintRequest(request);
    const config = printConfig();
    // Simulated submissions can never mark real Windows jobs as already sent.
    journal = new PrintJournal(path.join(config.directory, `${config.mode}-jobs.sqlite`), printerAdapter(config));
    const result = await handlePrintRequest(request, await serverSupabase(), journal, config);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AccessError ? error.message
      : 'La impresión no está disponible. Avisa al responsable. No vuelvas a cobrar para imprimir.' },
      { status: error instanceof AccessError ? error.status : 503, headers });
  } finally { journal?.close(); }
}
export const GET = handle;
export const POST = handle;
