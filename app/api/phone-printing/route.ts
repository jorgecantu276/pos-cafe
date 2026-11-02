import path from 'node:path';
import {serverSupabase} from '@/lib/supabase-server';
import {PrintJournal} from '@/lib/print-journal-server';
import {printConfig,printerAdapter} from '@/lib/windows-print-server';
import {handlePhonePrintRequest} from '@/lib/phone-print-dispatch-server';
import {requireLocalPrintRequest} from '@/lib/print-dispatch-server';
import {AccessError} from '@/lib/user-management';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0',Vary:'Cookie'};
async function handle(request:Request){
  let journal:PrintJournal|undefined;
  try{
    requireLocalPrintRequest(request);const config=printConfig();
    journal=new PrintJournal(path.join(config.directory,`${config.mode}-jobs.sqlite`),printerAdapter(config));
    return Response.json(await handlePhonePrintRequest(request,await serverSupabase(),journal,config),{headers});
  }catch(error){
    return Response.json({error:error instanceof AccessError?error.message:'No se pudo abrir la impresión local del pedido. Comprueba su estado antes de imprimir otra copia.'},
      {status:error instanceof AccessError?error.status:503,headers});
  }finally{journal?.close();}
}
export const GET=handle;
export const POST=handle;
